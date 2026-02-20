// ============================================================
// ASSURE CODE — Clause-Level Diff Engine (Claude-powered)
// Given an existing spec and a new regulation, Claude identifies
// exactly which clauses need to change and generates before/after
// diffs per clause — never rewrites the whole module.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import {
  SpecVersion,
  ClauseDiff,
  ModuleKey,
  MasterSpecification,
  SecurityBlueprint,
  CostAnalysis,
  TechStackJustification,
  CodeScaffolding,
} from '../types';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

// ── Module Impact Detection ────────────────────────────────────

/**
 * Determine which of the 5 modules are likely affected by a regulation.
 * Fast pre-filter before running expensive diff generation.
 */
export async function detectAffectedModules(
  regulation: { framework: string; article: string; content: string },
  spec: SpecVersion,
): Promise<ModuleKey[]> {
  const client = getClient();

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `
You are a compliance analyst. Given a new regulation and a technical spec summary, 
identify which spec modules are affected.

<regulation>
Framework: ${regulation.framework}
Article: ${regulation.article}
Content: ${regulation.content}
</regulation>

<spec_summary>
Project: ${spec.modules.master_specification?.projectName ?? 'Unknown'}
Tech Stack: ${JSON.stringify(spec.modules.tech_stack_justification?.decisions?.map(d => d.chosen) ?? [])}
Security Controls: ${JSON.stringify(spec.modules.security_blueprint?.encryptionControls?.map(e => e.mechanism) ?? [])}
</spec_summary>

The 5 modules are:
- master_specification: Project overview, features, data flows, NFRs
- security_blueprint: Threat model, encryption, IAM, audit logging, incident response
- cost_analysis: Infrastructure costs, compliance premium
- tech_stack_justification: Technology decisions, vendor risk
- code_scaffolding: Dockerfile, CI pipeline, env template

Respond with ONLY a JSON array of affected module keys. Example: ["security_blueprint", "code_scaffolding"]
Only include modules genuinely affected by this specific regulation.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned) as ModuleKey[];
  } catch {
    // Default to security and master spec as safe fallback
    return ['master_specification', 'security_blueprint'];
  }
}

// ── Clause Diff Generation ─────────────────────────────────────

/**
 * Generate clause-level diffs for a specific module.
 * Claude produces before/after for only the exact clauses that change.
 */
export async function generateModuleDiffs(
  regulation: { framework: string; article: string; title: string; content: string },
  moduleKey: ModuleKey,
  currentModuleData: any,
): Promise<ClauseDiff[]> {
  const client = getClient();

  const prompt = buildDiffPrompt(regulation, moduleKey, currentModuleData);

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const diffs = JSON.parse(cleaned) as ClauseDiff[];

    // Stamp module and regulation on each diff
    return diffs.map(d => ({
      ...d,
      module: moduleKey,
      regulationTrigger: `${regulation.framework} ${regulation.article}`,
    }));
  } catch (err) {
    console.error(`[DiffEngine] Failed to parse diffs for module ${moduleKey}:`, err);
    return [];
  }
}

// ── Apply Diffs to Spec ────────────────────────────────────────

/**
 * Apply a set of clause diffs to the current spec modules,
 * producing updated module data.
 */
export async function applyDiffsToSpec(
  spec: SpecVersion,
  diffs: ClauseDiff[],
): Promise<SpecVersion['modules']> {
  const client = getClient();

  // Group diffs by module
  const diffsByModule: Partial<Record<ModuleKey, ClauseDiff[]>> = {};
  for (const diff of diffs) {
    if (!diffsByModule[diff.module]) diffsByModule[diff.module] = [];
    diffsByModule[diff.module]!.push(diff);
  }

  const updatedModules = { ...spec.modules };

  for (const [moduleKey, moduleDiffs] of Object.entries(diffsByModule)) {
    const key = moduleKey as ModuleKey;
    const currentModule = spec.modules[key];

    if (!currentModule || moduleDiffs.length === 0) continue;

    // Ask Claude to apply the diffs to the module JSON
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `
You are applying compliance patches to a technical specification module.

<current_module key="${key}">
${JSON.stringify(currentModule, null, 2)}
</current_module>

<diffs_to_apply>
${moduleDiffs.map(d => `
Clause: ${d.clausePath} (${d.fieldLabel})
Before: ${d.before}
After: ${d.after}
Reason: ${d.reason}
`).join('\n---\n')}
</diffs_to_apply>

Apply ONLY the changes described in the diffs. Do not change anything else.
Preserve all existing structure, formatting, and content that is not in the diffs.
Return ONLY the updated module as valid JSON with the exact same schema.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      (updatedModules as any)[key] = JSON.parse(cleaned);
    } catch {
      console.error(`[DiffEngine] Failed to apply diffs to module ${key}. Keeping original.`);
    }
  }

  return updatedModules;
}

// ── Prompt Builder ─────────────────────────────────────────────

function buildDiffPrompt(
  regulation: { framework: string; article: string; title: string; content: string },
  moduleKey: ModuleKey,
  currentModuleData: any,
): string {
  return `
You are a precise compliance engineer. A new regulation requires specific changes to a technical specification module.

<new_regulation>
Framework: ${regulation.framework}
Article: ${regulation.article}
Title: ${regulation.title}
Content: ${regulation.content}
</new_regulation>

<current_module key="${moduleKey}">
${JSON.stringify(currentModuleData, null, 2)}
</current_module>

TASK:
Identify the MINIMUM set of clause-level changes required to make this module compliant with the new regulation.

RULES:
1. Only change clauses that are directly affected by this specific regulation
2. Do NOT rewrite sections that are already compliant
3. Be precise — identify the exact field path using dot notation and array indices
4. The "before" must be the exact current value from the module above
5. The "after" must be the minimal change to achieve compliance
6. If no changes are needed, return an empty array []

Respond with ONLY a valid JSON array:
[
  {
    "clausePath": "encryptionControls[0].algorithm",
    "fieldLabel": "Encryption Algorithm for Data at Rest",
    "before": "AES-128",
    "after": "AES-256",
    "reason": "${regulation.framework} ${regulation.article} requires 256-bit encryption for data at rest",
    "severity": "high"
  }
]`;
}
