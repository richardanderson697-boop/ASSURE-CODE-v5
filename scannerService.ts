// ============================================================
// ASSURE CODE — Scanner Service (OpenAI)
// Validates a draft spec against retrieved regulations.
// Acts as a second opinion / adversarial reviewer.
// Returns a score against the "Gold Standard" threshold.
// ============================================================

import OpenAI from 'openai';
import { DraftSpecification, RetrievedRegulation, ScanResult, ScanFinding } from '../types';

const SCANNER_MODEL = 'gpt-4o';

// The Gold Standard threshold — drafts scoring below this FAIL
// and are not delivered to the user without human review.
export const GOLD_STANDARD_THRESHOLD = 0.80;

// Drafts in this range trigger human review flag but still pass
const HUMAN_REVIEW_THRESHOLD = 0.85;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set in environment variables.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildScanPrompt(
  draft: DraftSpecification,
  regulations: RetrievedRegulation[]
): string {
  const regulatoryContext = regulations
    .map(r => `[${r.framework} ${r.article}]: ${r.content}`)
    .join('\n\n');

  // Serialize only the compliance-critical parts of the draft
  const draftSummary = JSON.stringify({
    techStack: draft.techStack,
    securityBlueprint: draft.securityBlueprint,
    regulationsApplied: draft.regulationsApplied,
  }, null, 2);

  return `
You are a hostile compliance auditor. Your job is to FIND GAPS in the provided Technical Specification, not to validate it. Be rigorous, adversarial, and specific.

<regulatory_requirements>
${regulatoryContext}
</regulatory_requirements>

<draft_specification>
${draftSummary}
</draft_specification>

EVALUATION CRITERIA:
1. Does every regulatory requirement have a corresponding control in the spec?
2. Are the cited regulations accurate and applied correctly?
3. Are there regulatory requirements in the context that the spec IGNORES?
4. Are the security controls sufficient for the severity of the requirements?
5. Are there internal contradictions in the spec?

SCORING:
Assign a score from 0.0 to 1.0:
- 1.0 = Fully compliant, all requirements addressed with appropriate controls
- 0.8 = Mostly compliant, minor gaps that are low-risk
- 0.6 = Partial compliance, significant gaps that must be addressed
- Below 0.6 = Non-compliant, critical gaps present

Respond with ONLY valid JSON:
{
  "score": 0.0,
  "passed": true,
  "status": "compliant|non_compliant|partial",
  "executiveSummary": "<2-3 sentences for a non-technical stakeholder>",
  "findings": [
    {
      "issue": "<specific compliance issue found>",
      "regulation": "<FRAMEWORK ARTICLE>",
      "gap": "<why the spec fails this specific requirement>",
      "remediation": "<concrete technical or process fix>",
      "riskLevel": "high|medium|low",
      "affectedSection": "<techStack|securityBlueprint|codeScaffolding|general>"
    }
  ],
  "suggestedControls": ["<control 1>", "<control 2>"]
}`;
}

// ============================================================
// SCAN EXECUTION
// ============================================================

/**
 * Scan a draft specification against the retrieved regulations.
 * Returns a structured ScanResult with score and findings.
 */
export async function scanDraft(
  draft: DraftSpecification,
  regulations: RetrievedRegulation[]
): Promise<ScanResult> {
  const client = getClient();

  console.log(`[Scanner] Starting Gold Standard scan. Threshold: ${GOLD_STANDARD_THRESHOLD}`);

  const response = await client.chat.completions.create({
    model: SCANNER_MODEL,
    temperature: 0.1, // Very low — we want deterministic adversarial analysis
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a hostile compliance auditor. Return only valid JSON. Be specific about every gap you find.',
      },
      {
        role: 'user',
        content: buildScanPrompt(draft, regulations),
      },
    ],
  });

  const rawContent = response.choices[0].message.content;
  if (!rawContent) {
    throw new Error('[Scanner] OpenAI returned an empty response.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`[Scanner] Failed to parse OpenAI response as JSON: ${rawContent.slice(0, 200)}`);
  }

  const score = typeof parsed.score === 'number' ? parsed.score : 0;
  const passed = score >= GOLD_STANDARD_THRESHOLD;

  const result: ScanResult = {
    passed,
    score,
    threshold: GOLD_STANDARD_THRESHOLD,
    status: parsed.status ?? (passed ? 'compliant' : 'non_compliant'),
    findings: (parsed.findings ?? []) as ScanFinding[],
    executiveSummary: parsed.executiveSummary ?? '',
    suggestedControls: parsed.suggestedControls ?? [],
    scannedAt: new Date().toISOString(),
  };

  console.log(`[Scanner] Score: ${score.toFixed(2)} | Passed: ${passed} | Findings: ${result.findings.length}`);

  if (!passed) {
    console.warn(`[Scanner] Spec FAILED Gold Standard threshold (${GOLD_STANDARD_THRESHOLD}). ${result.findings.filter(f => f.riskLevel === 'high').length} high-risk findings.`);
  }

  return result;
}

/**
 * Determines if a scan result requires human review.
 * This is true for borderline passes (good score but not great)
 * or when critical-severity findings exist despite passing.
 */
export function requiresHumanReview(scanResult: ScanResult): boolean {
  if (!scanResult.passed) return true;
  if (scanResult.score < HUMAN_REVIEW_THRESHOLD) return true;
  const hasCriticalFindings = scanResult.findings.some(f => f.riskLevel === 'high');
  return hasCriticalFindings;
}
