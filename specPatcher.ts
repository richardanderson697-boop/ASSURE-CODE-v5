// ============================================================
// ASSURE CODE — Spec Patcher
// Orchestrates the full patch flow for one spec:
//   1. Detect affected modules
//   2. Generate clause-level diffs per module
//   3. Apply diffs → create new spec version (version_number + 1)
//   4. Save diffs to audit table
//   5. Publish spec.updated Kafka event
//   6. Trigger GitHub PR via spec.pr_requested event
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { detectAffectedModules, generateModuleDiffs, applyDiffsToSpec } from './diffEngine';
import { publishEvent, TOPICS } from '../events/kafka.client';
import {
  SpecVersion,
  ClauseDiff,
  ModuleKey,
  SpecPatchResult,
  SpecUpdatedEvent,
  RegulationNewEvent,
} from '../types';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface PatchSpecInput {
  specVersionId: string;
  workspaceId: string;
  regulation: {
    id: string;
    framework: string;
    article: string;
    title: string;
    content: string;
    jurisdiction: string;
    severity: string;
  };
}

/**
 * Main patch entry point — called by BullMQ worker per spec.
 */
export async function patchSpec(input: PatchSpecInput): Promise<SpecPatchResult> {
  const supabase = getSupabase();
  const { specVersionId, workspaceId, regulation } = input;

  console.log(`[Patcher] Patching spec ${specVersionId} for ${regulation.framework} ${regulation.article}`);

  // ── Step 1: Load the current spec version ─────────────────
  const { data: specRow, error: fetchError } = await supabase
    .from('spec_versions')
    .select('*')
    .eq('id', specVersionId)
    .single();

  if (fetchError || !specRow) {
    throw new Error(`[Patcher] Spec ${specVersionId} not found: ${fetchError?.message}`);
  }

  const currentSpec = mapRowToSpec(specRow);

  // ── Step 2: Detect which modules are affected ──────────────
  const affectedModules = await detectAffectedModules(regulation, currentSpec);

  if (affectedModules.length === 0) {
    console.log(`[Patcher] No modules affected for spec ${specVersionId}. Skipping.`);
    return {
      specVersionId,
      newVersionId: specVersionId,
      newVersionNumber: currentSpec.versionNumber,
      diffs: [],
      affectedModules: [],
      regulationTrigger: `${regulation.framework} ${regulation.article}`,
      patchedAt: new Date().toISOString(),
    };
  }

  console.log(`[Patcher] Affected modules: ${affectedModules.join(', ')}`);

  // ── Step 3: Generate clause diffs per module ───────────────
  const allDiffs: ClauseDiff[] = [];

  for (const moduleKey of affectedModules) {
    const moduleData = currentSpec.modules[moduleKey];
    if (!moduleData) continue;

    console.log(`[Patcher] Generating diffs for module: ${moduleKey}`);

    const moduleDiffs = await generateModuleDiffs(regulation, moduleKey, moduleData);
    allDiffs.push(...moduleDiffs);

    console.log(`[Patcher] ${moduleDiffs.length} diffs found in ${moduleKey}`);
  }

  if (allDiffs.length === 0) {
    console.log(`[Patcher] Regulation analyzed but no clause changes required. Spec already compliant.`);
    return {
      specVersionId,
      newVersionId: specVersionId,
      newVersionNumber: currentSpec.versionNumber,
      diffs: [],
      affectedModules,
      regulationTrigger: `${regulation.framework} ${regulation.article}`,
      patchedAt: new Date().toISOString(),
    };
  }

  // ── Step 4: Apply diffs → produce updated modules ─────────
  const updatedModules = await applyDiffsToSpec(currentSpec, allDiffs);

  // ── Step 5: Create new spec version ───────────────────────
  const newVersionId = uuidv4();
  const newVersionNumber = currentSpec.versionNumber + 1;
  const versionLabel = bumpMinorVersion(currentSpec.versionLabel ?? 'v1.0.0');

  const { error: insertError } = await supabase.from('spec_versions').insert({
    id: newVersionId,
    workspace_id: workspaceId,
    parent_id: specVersionId,        // Links the version chain
    version_number: newVersionNumber,
    version_label: versionLabel,
    status: 'active',               // Trigger auto-supersedes parent via DB trigger
    change_reason: `Compliance update: ${regulation.framework} ${regulation.article} — ${allDiffs.length} clause(s) patched`,
    triggered_by: 'regulation_update',
    regulation_trigger: `${regulation.framework} ${regulation.article}`,
    jurisdictions: currentSpec.jurisdictions,
    frameworks: currentSpec.frameworks,
    master_specification: updatedModules.master_specification,
    security_blueprint: updatedModules.security_blueprint,
    cost_analysis: updatedModules.cost_analysis,
    tech_stack_justification: updatedModules.tech_stack_justification,
    code_scaffolding: updatedModules.code_scaffolding,
    created_by: null, // System-generated
  });

  if (insertError) {
    throw new Error(`[Patcher] Failed to create new spec version: ${insertError.message}`);
  }

  // ── Step 6: Save diffs to audit table ─────────────────────
  const diffRows = allDiffs.map(d => ({
    from_version_id: specVersionId,
    to_version_id: newVersionId,
    module: d.module,
    clause_path: d.clausePath,
    field_label: d.fieldLabel,
    before_value: d.before,
    after_value: d.after,
    reason: d.reason,
    regulation_trigger: d.regulationTrigger,
    severity: d.severity,
  }));

  await supabase.from('spec_diffs').insert(diffRows);

  // ── Step 7: Log the impact ─────────────────────────────────
  await supabase.from('regulation_impact_log').insert({
    regulation_id: regulation.id,
    regulation_ref: `${regulation.framework} ${regulation.article}`,
    workspace_id: workspaceId,
    spec_version_id: specVersionId,
    new_spec_version_id: newVersionId,
    affected_modules: affectedModules,
    diff_count: allDiffs.length,
    status: 'patched',
  });

  // ── Step 8: Publish events ─────────────────────────────────

  // Notify the ecosystem that a spec was updated
  const specUpdatedEvent: SpecUpdatedEvent = {
    eventId: uuidv4(),
    eventType: 'spec.updated',
    workspaceId,
    specVersionId,
    newVersionId,
    regulationTrigger: `${regulation.framework} ${regulation.article}`,
    affectedModules,
    diffs: allDiffs,
    githubPrRequested: true,
  };

  await publishEvent(TOPICS.SPEC_UPDATED, specUpdatedEvent, workspaceId);

  // Request GitHub PR creation
  await publishEvent(TOPICS.SPEC_PR_REQUESTED, {
    eventId: uuidv4(),
    workspaceId,
    specVersionId: newVersionId,
    previousVersionId: specVersionId,
    regulationTrigger: `${regulation.framework} ${regulation.article}`,
    affectedModules,
    diffs: allDiffs,
    versionLabel,
  }, workspaceId);

  console.log(
    `[Patcher] ✅ Spec ${specVersionId} → ${newVersionId} (${versionLabel}) | ` +
    `${allDiffs.length} diffs across ${affectedModules.length} modules`,
  );

  return {
    specVersionId,
    newVersionId,
    newVersionNumber,
    diffs: allDiffs,
    affectedModules,
    regulationTrigger: `${regulation.framework} ${regulation.article}`,
    patchedAt: new Date().toISOString(),
  };
}

// ── Helpers ────────────────────────────────────────────────────

function mapRowToSpec(row: any): SpecVersion {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    versionNumber: row.version_number,
    versionLabel: row.version_label,
    status: row.status,
    changeReason: row.change_reason,
    triggeredBy: row.triggered_by,
    regulationTrigger: row.regulation_trigger,
    jurisdictions: row.jurisdictions,
    frameworks: row.frameworks,
    modules: {
      master_specification: row.master_specification,
      security_blueprint: row.security_blueprint,
      cost_analysis: row.cost_analysis,
      tech_stack_justification: row.tech_stack_justification,
      code_scaffolding: row.code_scaffolding,
    },
    createdBy: row.created_by,
    createdAt: row.created_at,
    scanScore: row.scan_score,
    githubPrUrl: row.github_pr_url,
  };
}

function bumpMinorVersion(current: string): string {
  // "v1.2.3" → "v1.3.0"
  const match = current.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return `${current}.1`;
  const [, major, minor] = match;
  return `v${major}.${parseInt(minor) + 1}.0`;
}
