// ============================================================
// ASSURE CODE — Spec Impact Analyzer
// Given a new regulation, determines which active workspace
// specs are affected using two strategies:
//   1. Framework/jurisdiction filter (fast, DB-level)
//   2. Semantic similarity check (precise, vector-level)
//      — Only runs on specs that pass the framework filter
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { embedQuery } from '../rag/embeddings';

export interface AffectedSpec {
  specId: string;
  workspaceId: string;
  versionNumber: number;
  frameworks: string[];
  jurisdictions: string[];
  semanticScore: number;   // How strongly does this spec relate to the regulation?
}

// Minimum semantic similarity to consider a spec affected
// Prevents patching specs that technically use GDPR but have
// nothing to do with the specific article
const SEMANTIC_THRESHOLD = 0.65;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Find all active specs affected by a regulation.
 *
 * Strategy:
 * 1. Query DB for specs matching framework + jurisdiction (fast index scan)
 * 2. For each candidate, check semantic similarity of the regulation content
 *    against the spec's master_specification text
 * 3. Return only specs above the semantic threshold
 */
export async function findAffectedSpecs(
  framework: string,
  jurisdiction: string,
  regulationContent?: string,
): Promise<AffectedSpec[]> {
  const supabase = getSupabase();

  console.log(`[ImpactAnalyzer] Scanning for specs: framework=${framework}, jurisdiction=${jurisdiction}`);

  // Step 1: Framework + jurisdiction filter via DB RPC
  const { data: candidates, error } = await supabase.rpc('find_affected_specs', {
    p_framework: framework,
    p_jurisdiction: jurisdiction,
  });

  if (error) {
    throw new Error(`[ImpactAnalyzer] DB query failed: ${error.message}`);
  }

  if (!candidates || candidates.length === 0) {
    console.log('[ImpactAnalyzer] No candidate specs found via framework filter.');
    return [];
  }

  console.log(`[ImpactAnalyzer] ${candidates.length} candidates from framework filter.`);

  // Step 2: If we have regulation content, apply semantic filter
  if (!regulationContent) {
    // No content to embed — return all framework matches as affected
    return candidates.map((c: any) => ({
      specId: c.spec_id,
      workspaceId: c.workspace_id,
      versionNumber: c.version_number,
      frameworks: c.frameworks,
      jurisdictions: c.jurisdictions,
      semanticScore: 1.0,
    }));
  }

  // Embed the regulation content
  const regulationEmbedding = await embedQuery(regulationContent);

  // For each candidate spec, compute semantic similarity against its master spec text
  const results: AffectedSpec[] = [];

  for (const candidate of candidates) {
    // Fetch the spec's master specification text for comparison
    const { data: spec } = await supabase
      .from('spec_versions')
      .select('master_specification')
      .eq('id', candidate.spec_id)
      .single();

    if (!spec?.master_specification) continue;

    // Build a searchable text from the master spec
    const masterSpecText = extractMasterSpecText(spec.master_specification);

    // Embed the spec text
    const specEmbedding = await embedQuery(masterSpecText);

    // Cosine similarity
    const similarity = cosineSimilarity(regulationEmbedding, specEmbedding);

    console.log(
      `[ImpactAnalyzer] Spec ${candidate.spec_id}: semantic score = ${similarity.toFixed(3)}`,
    );

    if (similarity >= SEMANTIC_THRESHOLD) {
      results.push({
        specId: candidate.spec_id,
        workspaceId: candidate.workspace_id,
        versionNumber: candidate.version_number,
        frameworks: candidate.frameworks,
        jurisdictions: candidate.jurisdictions,
        semanticScore: similarity,
      });
    }
  }

  // Sort by semantic score — most affected specs first
  results.sort((a, b) => b.semanticScore - a.semanticScore);

  console.log(
    `[ImpactAnalyzer] ${results.length} / ${candidates.length} specs passed semantic filter (threshold: ${SEMANTIC_THRESHOLD})`,
  );

  return results;
}

// ── Helpers ───────────────────────────────────────────────────

function extractMasterSpecText(masterSpec: any): string {
  if (!masterSpec) return '';

  const parts: string[] = [
    masterSpec.projectName ?? '',
    masterSpec.projectSummary ?? '',
    masterSpec.problemStatement ?? '',
    ...(masterSpec.coreFeatures ?? []).map((f: any) => `${f.name}: ${f.description}`),
    ...(masterSpec.dataFlows ?? []).map((d: any) => `${d.from} → ${d.to}: ${d.dataType}`),
    ...(masterSpec.nonFunctionalRequirements ?? []).map((r: any) => r.requirement),
  ];

  return parts.filter(Boolean).join('\n');
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
