// ============================================================
// ASSURE CODE — GitHub App Service
// Handles the full GitHub integration:
//   1. GitHub App installation OAuth
//   2. Branch creation per spec update
//   3. Commit spec markdown files + Dockerfile + CI yaml
//   4. Open PR with formatted compliance diff summary
//   5. Assign developers from workspace_members
// ============================================================

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { createClient } from '@supabase/supabase-js';
import {
  SpecVersion,
  ClauseDiff,
  ModuleKey,
} from '../types';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── GitHub App Auth ────────────────────────────────────────────

async function getOctokitForWorkspace(workspaceId: string): Promise<{
  octokit: Octokit;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
}> {
  const supabase = getSupabase();

  const { data: conn, error } = await supabase
    .from('github_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();

  if (error || !conn) {
    throw new Error(
      `[GitHub] No GitHub connection found for workspace ${workspaceId}. ` +
      'The workspace owner must install the GitHub App first.',
    );
  }

  // GitHub App auth — generates a short-lived installation token
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    installationId: parseInt(conn.github_installation_id),
  });

  const { token } = await auth({ type: 'installation' });

  const octokit = new Octokit({ auth: token });

  return {
    octokit,
    repoOwner: conn.repo_owner,
    repoName: conn.repo_name,
    defaultBranch: conn.default_branch ?? 'main',
  };
}

// ── PR Creation ────────────────────────────────────────────────

export interface CreateCompliancePRInput {
  workspaceId: string;
  specVersion: SpecVersion;
  previousVersionId: string;
  regulationTrigger: string;
  affectedModules: ModuleKey[];
  diffs: ClauseDiff[];
  versionLabel: string;
}

/**
 * Create a GitHub PR containing:
 * - spec markdown files (one per module)
 * - Dockerfile (from code_scaffolding)
 * - docker-compose.yml
 * - GitHub Actions CI pipeline
 * - compliance-diff-summary.md (the before/after diff report)
 */
export async function createCompliancePR(
  input: CreateCompliancePRInput,
): Promise<string> {
  const { workspaceId, specVersion, regulationTrigger, affectedModules, diffs, versionLabel } = input;

  const { octokit, repoOwner, repoName, defaultBranch } =
    await getOctokitForWorkspace(workspaceId);

  console.log(`[GitHub] Creating compliance PR for ${repoOwner}/${repoName}`);

  // ── Create branch ────────────────────────────────────────────
  const safeTrigger = regulationTrigger.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const branchName = `compliance/${safeTrigger}-${versionLabel}`;

  // Get the SHA of the default branch HEAD
  const { data: refData } = await octokit.git.getRef({
    owner: repoOwner,
    repo: repoName,
    ref: `heads/${defaultBranch}`,
  });

  const baseSha = refData.object.sha;

  // Create the new branch
  await octokit.git.createRef({
    owner: repoOwner,
    repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  console.log(`[GitHub] Branch created: ${branchName}`);

  // ── Build file tree ──────────────────────────────────────────
  const files = buildFileTree(specVersion, diffs, regulationTrigger, versionLabel);

  // ── Commit all files ─────────────────────────────────────────
  // Create a tree with all files at once (single commit)
  const blobs = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner: repoOwner,
        repo: repoName,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      });
      return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    }),
  );

  const { data: tree } = await octokit.git.createTree({
    owner: repoOwner,
    repo: repoName,
    base_tree: baseSha,
    tree: blobs,
  });

  const { data: commit } = await octokit.git.createCommit({
    owner: repoOwner,
    repo: repoName,
    message: `compliance(${safeTrigger}): update spec to ${versionLabel}\n\nAffected modules: ${affectedModules.join(', ')}\n${diffs.length} clause(s) patched`,
    tree: tree.sha,
    parents: [baseSha],
  });

  await octokit.git.updateRef({
    owner: repoOwner,
    repo: repoName,
    ref: `heads/${branchName}`,
    sha: commit.sha,
  });

  console.log(`[GitHub] Committed ${files.length} files to ${branchName}`);

  // ── Get developer assignees from workspace_members ───────────
  const supabase = getSupabase();
  const { data: developers } = await supabase
    .from('workspace_members')
    .select('github_login')
    .eq('workspace_id', workspaceId)
    .eq('role', 'developer')
    .not('github_login', 'is', null);

  const assignees = (developers ?? [])
    .map((d: any) => d.github_login)
    .filter(Boolean)
    .slice(0, 10); // GitHub PR assignee limit

  // ── Open PR ──────────────────────────────────────────────────
  const prBody = buildPRBody(specVersion, diffs, affectedModules, regulationTrigger, versionLabel);

  const { data: pr } = await octokit.pulls.create({
    owner: repoOwner,
    repo: repoName,
    title: `[Compliance] ${regulationTrigger} — Spec updated to ${versionLabel}`,
    body: prBody,
    head: branchName,
    base: defaultBranch,
    draft: false,
  });

  // Assign developers
  if (assignees.length > 0) {
    await octokit.issues.addAssignees({
      owner: repoOwner,
      repo: repoName,
      issue_number: pr.number,
      assignees,
    });
  }

  // Add compliance label
  try {
    await octokit.issues.addLabels({
      owner: repoOwner,
      repo: repoName,
      issue_number: pr.number,
      labels: ['compliance', 'automated', regulationTrigger.split(' ')[0].toLowerCase()],
    });
  } catch {
    // Labels may not exist — non-critical
  }

  // ── Update spec with PR URL ───────────────────────────────────
  await supabase
    .from('spec_versions')
    .update({ github_pr_url: pr.html_url })
    .eq('id', specVersion.id);

  await supabase
    .from('regulation_impact_log')
    .update({ status: 'pr_created', github_pr_url: pr.html_url })
    .eq('new_spec_version_id', specVersion.id);

  console.log(`[GitHub] ✅ PR #${pr.number} created: ${pr.html_url}`);

  return pr.html_url;
}

// ── File Tree Builder ─────────────────────────────────────────

interface FileEntry {
  path: string;
  content: string;
}

function buildFileTree(
  spec: SpecVersion,
  diffs: ClauseDiff[],
  regulationTrigger: string,
  versionLabel: string,
): FileEntry[] {
  const files: FileEntry[] = [];
  const modules = spec.modules;

  // Module 1: Master Specification
  if (modules.master_specification) {
    files.push({
      path: 'specs/01-master-specification.md',
      content: renderMasterSpec(modules.master_specification),
    });
  }

  // Module 2: Security Blueprint
  if (modules.security_blueprint) {
    files.push({
      path: 'specs/02-security-blueprint.md',
      content: renderSecurityBlueprint(modules.security_blueprint),
    });
  }

  // Module 3: Cost Analysis
  if (modules.cost_analysis) {
    files.push({
      path: 'specs/03-cost-analysis.md',
      content: renderCostAnalysis(modules.cost_analysis),
    });
  }

  // Module 4: Tech Stack Justification
  if (modules.tech_stack_justification) {
    files.push({
      path: 'specs/04-tech-stack-justification.md',
      content: renderTechStackJustification(modules.tech_stack_justification),
    });
  }

  // Module 5: Code Scaffolding — actual infra files
  if (modules.code_scaffolding) {
    const scaffold = modules.code_scaffolding;

    if (scaffold.dockerfile) {
      files.push({ path: 'Dockerfile', content: scaffold.dockerfile });
    }

    if (scaffold.dockerCompose) {
      files.push({ path: 'docker-compose.yml', content: scaffold.dockerCompose });
    }

    if (scaffold.envTemplate) {
      files.push({ path: '.env.example', content: scaffold.envTemplate });
    }

    if (scaffold.ciPipeline) {
      files.push({
        path: '.github/workflows/compliance-ci.yml',
        content: scaffold.ciPipeline,
      });
    }

    files.push({
      path: 'specs/05-code-scaffolding.md',
      content: `# Code Scaffolding\n\n## File Tree\n\`\`\`\n${scaffold.fileTree}\n\`\`\`\n\n## Developer Prompt\n\n${scaffold.developerPrompt}\n\n## Setup\n\n${scaffold.setupInstructions}`,
    });
  }

  // Compliance diff summary
  files.push({
    path: 'specs/compliance-diff-summary.md',
    content: renderDiffSummary(diffs, regulationTrigger, versionLabel),
  });

  return files;
}

// ── PR Body ────────────────────────────────────────────────────

function buildPRBody(
  spec: SpecVersion,
  diffs: ClauseDiff[],
  affectedModules: ModuleKey[],
  regulationTrigger: string,
  versionLabel: string,
): string {
  const criticalDiffs = diffs.filter(d => d.severity === 'critical');
  const highDiffs = diffs.filter(d => d.severity === 'high');
  const mediumDiffs = diffs.filter(d => d.severity === 'medium');
  const lowDiffs = diffs.filter(d => d.severity === 'low');

  return `## 🔒 Compliance Update — ${regulationTrigger}

**Spec Version:** ${versionLabel}  
**Triggered by:** New regulation scraped from official source  
**Affected modules:** ${affectedModules.map(m => `\`${m}\``).join(', ')}  
**Total clause changes:** ${diffs.length}

---

## Summary

This PR was **automatically generated by Assure Code** in response to a new or updated regulation. The changes below are the **minimum required amendments** to maintain compliance — no other sections have been modified.

${criticalDiffs.length > 0 ? `> ⛔ **${criticalDiffs.length} CRITICAL changes require immediate review**` : ''}
${highDiffs.length > 0 ? `> 🔴 **${highDiffs.length} HIGH severity changes**` : ''}

---

## Clause-Level Changes

${diffs.map(d => `
### ${d.fieldLabel} \`${d.clausePath}\`

**Module:** \`${d.module}\`  
**Severity:** ${severityBadge(d.severity)}  
**Regulation:** \`${d.regulationTrigger}\`

| | Value |
|---|---|
| **Before** | \`${d.before}\` |
| **After** | \`${d.after}\` |

**Reason:** ${d.reason}
`).join('\n---\n')}

---

## Review Checklist

- [ ] Verify each changed clause aligns with the referenced regulation
- [ ] Confirm infrastructure changes in \`Dockerfile\` and \`docker-compose.yml\` are compatible with your environment
- [ ] Run the CI pipeline and ensure all checks pass
- [ ] Merge within **72 hours** if any CRITICAL severity changes are present

---

*Generated by [Assure Code](https://assure.code.app) — Compliance Automation Platform*  
*Spec ID: \`${spec.id}\` | Parent: \`${spec.parentId ?? 'initial'}\`*`;
}

// ── Markdown Renderers ────────────────────────────────────────

function renderMasterSpec(m: any): string {
  return `# Master Specification

## Project Summary
${m.projectSummary ?? ''}

## Problem Statement
${m.problemStatement ?? ''}

## Target Users
${(m.targetUsers ?? []).map((u: string) => `- ${u}`).join('\n')}

## Core Features
${(m.coreFeatures ?? []).map((f: any) => `
### ${f.name}
${f.description}

**Regulations cited:** ${(f.regulationsCited ?? []).join(', ')}
`).join('\n')}

## Data Flows
${(m.dataFlows ?? []).map((d: any) =>
  `- **${d.from}** → **${d.to}**: ${d.dataType} _(${(d.regulationsCited ?? []).join(', ')})_`
).join('\n')}

## Non-Functional Requirements
${(m.nonFunctionalRequirements ?? []).map((r: any) =>
  `- **[${r.category}]** ${r.requirement} _(${(r.regulationsCited ?? []).join(', ')})_`
).join('\n')}

## Out of Scope
${(m.outOfScope ?? []).map((s: string) => `- ${s}`).join('\n')}

## Regulations Applied
${(m.regulationsApplied ?? []).map((r: string) => `- \`${r}\``).join('\n')}
`;
}

function renderSecurityBlueprint(m: any): string {
  return `# Security Blueprint

## Network Topology
${m.networkTopology?.description ?? ''}

${(m.networkTopology?.zones ?? []).map((z: any) => `
### Zone: ${z.name}
**Assets:** ${z.assets?.join(', ')}  
**Access rules:** ${z.accessRules?.join('; ')}
`).join('\n')}

## Encryption Controls
${(m.encryptionControls ?? []).map((e: any) => `
### ${e.mechanism} (${e.scope})
- **Algorithm:** ${e.algorithm}
- **Regulations:** ${(e.regulationsCited ?? []).join(', ')}
`).join('\n')}

## IAM Rules
${(m.iamRules ?? []).map((r: any) => `
### Role: ${r.role}
- **Permissions:** ${(r.permissions ?? []).join(', ')}
- **Principle:** ${r.principle}
- **Regulations:** ${(r.regulationsCited ?? []).join(', ')}
`).join('\n')}

## Audit Logging
- **Events:** ${(m.auditLogging?.events ?? []).join(', ')}
- **Retention:** ${m.auditLogging?.retentionDays} days
- **Storage:** ${m.auditLogging?.storage}
- **Regulations:** ${(m.auditLogging?.regulationsCited ?? []).join(', ')}

## Incident Response
- **Detection:** ${(m.incidentResponse?.detectionMethods ?? []).join(', ')}
- **Notification timeline:** ${m.incidentResponse?.notificationTimeline}
- **Regulations:** ${(m.incidentResponse?.regulationsCited ?? []).join(', ')}

## Data Residency
- **Regions:** ${(m.dataResidency?.regions ?? []).join(', ')}
- **Justification:** ${m.dataResidency?.justification}
`;
}

function renderCostAnalysis(m: any): string {
  return `# Cost Analysis

## Summary
${m.summary ?? ''}

**Estimated Monthly Total:** $${m.monthlyTotalUSD?.toLocaleString() ?? 'TBD'}

### Compliance Premium
$${m.compliancePremium?.totalUSD?.toLocaleString() ?? '0'}/month above non-compliant equivalent  
_${m.compliancePremium?.explanation ?? ''}_

## Cost Breakdown
| Service | Provider | Tier | Monthly (USD) | Compliance Reason |
|---------|----------|------|--------------|-------------------|
${(m.breakdown ?? []).map((b: any) =>
  `| ${b.service} | ${b.provider} | ${b.tier} | $${b.monthlyCostUSD} | ${b.complianceReason} |`
).join('\n')}

## Scaling Projections
| Users | Estimated Monthly |
|-------|------------------|
${(m.scalingProjection ?? []).map((s: any) =>
  `| ${s.usersCount.toLocaleString()} | $${s.estimatedMonthlyCostUSD.toLocaleString()} |`
).join('\n')}

_${m.notes ?? ''}_
`;
}

function renderTechStackJustification(m: any): string {
  return `# Tech Stack Justification

${m.summary ?? ''}

## Technology Decisions
${(m.decisions ?? []).map((d: any) => `
### ${d.category}: ${d.chosen}

**Compliance benefit:** ${d.complianceBenefit}  
**Regulations cited:** ${(d.regulationsCited ?? []).join(', ')}

**Justification:** ${d.justification}

**Alternatives considered:**
${(d.alternatives ?? []).map((a: any) =>
  `- **${a.name}**: ${a.rejectionReason}${a.complianceIssue ? ` _(Compliance issue: ${a.complianceIssue})_` : ''}`
).join('\n')}
`).join('\n---\n')}

## Vendor Risk Assessment
${(m.vendorRiskAssessment ?? []).map((v: any) => `
### ${v.vendor} — ${v.service}
- **Risk level:** ${v.riskLevel}
- **Mitigations:** ${(v.mitigations ?? []).join('; ')}
- **Regulations:** ${(v.regulationsCited ?? []).join(', ')}
`).join('\n')}
`;
}

function renderDiffSummary(diffs: ClauseDiff[], regulationTrigger: string, versionLabel: string): string {
  return `# Compliance Diff Summary — ${versionLabel}

**Triggered by:** ${regulationTrigger}  
**Generated:** ${new Date().toISOString()}  
**Total changes:** ${diffs.length}

## Changes by Severity

| Severity | Count |
|----------|-------|
| Critical | ${diffs.filter(d => d.severity === 'critical').length} |
| High | ${diffs.filter(d => d.severity === 'high').length} |
| Medium | ${diffs.filter(d => d.severity === 'medium').length} |
| Low | ${diffs.filter(d => d.severity === 'low').length} |

## Full Diff

${diffs.map(d => `
### ${d.fieldLabel}

\`\`\`diff
- ${d.before}
+ ${d.after}
\`\`\`

**Module:** \`${d.module}\` | **Path:** \`${d.clausePath}\` | **Severity:** ${d.severity}  
**Reason:** ${d.reason}  
**Regulation:** ${d.regulationTrigger}
`).join('\n---\n')}
`;
}

function severityBadge(severity: string): string {
  const badges: Record<string, string> = {
    critical: '⛔ CRITICAL',
    high: '🔴 HIGH',
    medium: '🟡 MEDIUM',
    low: '🟢 LOW',
  };
  return badges[severity] ?? severity;
}
