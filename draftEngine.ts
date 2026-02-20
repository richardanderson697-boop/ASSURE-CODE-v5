// ============================================================
// ASSURE CODE — Draft Engine (Google Gemini)
// Generates a full Technical Specification draft from a
// project idea and a set of retrieved regulations.
// ============================================================

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { RetrievedRegulation, SpecificationRequest, DraftSpecification } from '../types';

const GEMINI_MODEL = 'gemini-1.5-pro-latest';

// Minimum score a regulation needs to be included in the draft context
const MIN_REGULATION_SIMILARITY = 0.72;

let _model: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (!_model) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in environment variables.');
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    _model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json', // Force structured output
        temperature: 0.2, // Low temp for deterministic compliance output
      },
    });
  }
  return _model;
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildDraftPrompt(
  request: SpecificationRequest,
  regulations: RetrievedRegulation[]
): string {
  // Filter to only high-confidence regulations
  const relevantLaws = regulations
    .filter(r => r.similarity >= MIN_REGULATION_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity);

  const regulatoryContext = relevantLaws
    .map(r => `[${r.framework} ${r.article} | Similarity: ${r.similarity.toFixed(2)}]\nTitle: ${r.title}\n${r.content}`)
    .join('\n\n---\n\n');

  // IMPORTANT: XML tags protect against prompt injection from the project idea
  return `
You are the Assure Code Compliance Architect — a Senior Solutions Architect and Legal Counsel specializing in building compliant software systems.

<project_idea>
${request.projectIdea}
</project_idea>

<jurisdictions>
${request.jurisdictions.join(', ')}
</jurisdictions>

<target_frameworks>
${request.frameworks.join(', ')}
</target_frameworks>

<regulatory_context>
${regulatoryContext}
</regulatory_context>

${request.existingSpec ? `<existing_specification>\n${request.existingSpec}\n</existing_specification>\n\nThis is an UPDATE request. Amend the existing spec to address compliance gaps.` : ''}

TASK: Generate a complete, production-ready Technical Specification. Every architectural decision MUST cite a specific regulation from the regulatory_context above using the format [FRAMEWORK ARTICLE]. If a decision cannot be justified by the provided regulations, state "No direct regulatory requirement — industry best practice."

CRITICAL RULES:
1. Do NOT invent regulation citations that are not in the regulatory_context.
2. The developerPrompt must be a ready-to-paste system prompt for an IDE like Cursor or Windsurf.
3. The dockerfile must be production-ready, not a development stub.
4. Cost estimates should use service names and tiers — not dollar amounts (pricing changes).
5. The fileTree should use tree format with compliance annotations as comments.

Respond with ONLY a valid JSON object matching this exact schema:
{
  "version": "1.0.0",
  "generatedAt": "<ISO timestamp>",
  "projectSummary": "<2-3 sentence summary of what this system does and its compliance posture>",
  "techStack": {
    "languages": [{ "name": "", "role": "", "complianceJustification": "", "regulationsCited": [] }],
    "cloudProviders": [{ "name": "", "role": "", "complianceJustification": "", "regulationsCited": [] }],
    "databases": [{ "name": "", "role": "", "complianceJustification": "", "regulationsCited": [] }],
    "thirdPartyServices": [{ "name": "", "role": "", "complianceJustification": "", "regulationsCited": [] }]
  },
  "securityBlueprint": {
    "networkTopology": "<describe VPC, subnets, DMZ, ingress/egress rules>",
    "encryptionControls": [{ "mechanism": "", "description": "", "regulationsCited": [], "implementation": "" }],
    "iamRules": [{ "rule": "", "principle": "", "regulationsCited": [] }],
    "dataResidency": "<where data lives and why, citing jurisdiction requirements>",
    "auditLogging": "<what must be logged, retention period, storage>",
  },
  "costEstimate": {
    "monthlyTotalUSD": 0,
    "breakdown": [{ "service": "", "monthlyCostUSD": 0, "complianceReason": "", "tier": "" }],
    "notes": "<disclaimer about pricing variability>"
  },
  "codeScaffolding": {
    "fileTree": "<tree format string>",
    "dockerfile": "<complete Dockerfile content>",
    "dockerCompose": "<complete docker-compose.yml content>"
  },
  "developerPrompt": "<full IDE system prompt enforcing these compliance rules>",
  "regulationsApplied": ["<list of FRAMEWORK ARTICLE strings that were applied>"]
}`;
}

// ============================================================
// DRAFT GENERATION
// ============================================================

/**
 * Generate a compliant technical specification draft using Gemini.
 */
export async function generateDraft(
  request: SpecificationRequest,
  regulations: RetrievedRegulation[]
): Promise<DraftSpecification> {
  if (regulations.length === 0) {
    throw new Error('[DraftEngine] Cannot generate spec: no regulations were retrieved. Check your frameworks/jurisdictions or lower the similarity threshold.');
  }

  const model = getModel();
  const prompt = buildDraftPrompt(request, regulations);

  console.log(`[DraftEngine] Generating spec for: "${request.projectIdea.slice(0, 80)}..."`);
  console.log(`[DraftEngine] Using ${regulations.length} retrieved regulations.`);

  const result = await model.generateContent(prompt);
  const rawText = result.response.text();

  let draft: DraftSpecification;
  try {
    draft = JSON.parse(rawText);
  } catch (err) {
    // Gemini sometimes wraps JSON in markdown fences despite responseMimeType
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    try {
      draft = JSON.parse(cleaned);
    } catch {
      console.error('[DraftEngine] Raw response:', rawText.slice(0, 500));
      throw new Error('[DraftEngine] Failed to parse Gemini response as JSON.');
    }
  }

  // Stamp generation metadata
  draft.generatedAt = new Date().toISOString();
  draft.version = draft.version || '1.0.0';

  console.log(`[DraftEngine] Draft generated. Regulations applied: ${draft.regulationsApplied?.length ?? 0}`);

  return draft;
}
