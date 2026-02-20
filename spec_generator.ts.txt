// ============================================================
// ASSURE CODE — 5-Module Spec Generator (Gemini)
// Generates all 5 modules as distinct, structured documents.
// Module 4 (Tech Stack Justification) is fully prompted here —
// fixing the gap identified in the Gemini audit screenshots.
// ============================================================

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { RetrievedRegulation, SpecVersion } from '../types';
import { v4 as uuidv4 } from 'uuid';

const GEMINI_MODEL = 'gemini-1.5-pro-latest';

let _model: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (!_model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    _model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 32768,
      },
    });
  }
  return _model;
}

export interface GenerateSpecInput {
  projectIdea: string;
  jurisdictions: string[];
  frameworks: string[];
  regulations: RetrievedRegulation[];
  workspaceId: string;
  createdBy: string;
}

/**
 * Generate all 5 modules in a single Gemini call.
 * Returns a fully populated SpecVersion ready to insert into DB.
 */
export async function generateFullSpec(input: GenerateSpecInput): Promise<SpecVersion> {
  const model = getModel();

  const regulatoryContext = input.regulations
    .map(r => `[${r.framework} ${r.article} | similarity: ${r.similarity.toFixed(2)}]\n${r.title}\n${r.content}`)
    .join('\n\n---\n\n');

  const prompt = buildFullSpecPrompt(input.projectIdea, input.jurisdictions, input.frameworks, regulatoryContext);

  console.log(`[SpecGenerator] Generating 5-module spec for: "${input.projectIdea.slice(0, 80)}..."`);

  const result = await model.generateContent(prompt);
  const rawText = result.response.text();

  let parsed: any;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('[SpecGenerator] Failed to parse Gemini response as JSON.');
  }

  const specVersion: SpecVersion = {
    id: uuidv4(),
    workspaceId: input.workspaceId,
    parentId: null,
    versionNumber: 1,
    versionLabel: 'v1.0.0',
    status: 'draft',
    changeReason: 'Initial creation',
    triggeredBy: 'user',
    jurisdictions: input.jurisdictions,
    frameworks: input.frameworks,
    modules: {
      master_specification: parsed.master_specification,
      security_blueprint: parsed.security_blueprint,
      cost_analysis: parsed.cost_analysis,
      tech_stack_justification: parsed.tech_stack_justification,
      code_scaffolding: parsed.code_scaffolding,
    },
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };

  console.log('[SpecGenerator] All 5 modules generated successfully.');

  return specVersion;
}

// ── The Master Prompt ─────────────────────────────────────────
// All 5 modules with explicit schemas to eliminate hallucination

function buildFullSpecPrompt(
  idea: string,
  jurisdictions: string[],
  frameworks: string[],
  regulatoryContext: string,
): string {
  return `
You are the Assure Code Compliance Architect — a Senior Solutions Architect and Legal Counsel specializing in compliant software systems.

<project_idea>
${idea}
</project_idea>

<jurisdictions>${jurisdictions.join(', ')}</jurisdictions>
<frameworks>${frameworks.join(', ')}</frameworks>

<regulatory_context>
${regulatoryContext}
</regulatory_context>

TASK: Generate a complete Technical Specification in 5 distinct modules.

CRITICAL RULES:
1. Every decision MUST cite specific regulations using format "[FRAMEWORK ARTICLE]"
2. Only cite regulations that appear in the regulatory_context above
3. If a decision cannot be justified by provided regulations, state "Industry best practice — no direct regulatory requirement"
4. Module 4 (tech_stack_justification) MUST include alternatives_considered for every decision
5. Module 5 dockerfile must be production-ready with security hardening
6. All costs in cost_analysis use 0 as monthlyTotalUSD (Claude will not estimate pricing)

Respond with ONLY valid JSON matching this exact schema:

{
  "master_specification": {
    "projectName": "string",
    "projectSummary": "2-3 sentences",
    "problemStatement": "string",
    "targetUsers": ["string"],
    "coreFeatures": [
      {
        "name": "string",
        "description": "string",
        "regulationsCited": ["GDPR Article 5"]
      }
    ],
    "dataFlows": [
      {
        "from": "string",
        "to": "string",
        "dataType": "string",
        "regulationsCited": ["string"]
      }
    ],
    "nonFunctionalRequirements": [
      {
        "category": "compliance|performance|availability|security",
        "requirement": "string",
        "regulationsCited": ["string"]
      }
    ],
    "outOfScope": ["string"],
    "regulationsApplied": ["GDPR Article 5", "SOC2 CC6.1"]
  },

  "security_blueprint": {
    "threatModel": [
      {
        "threat": "string",
        "likelihood": "low|medium|high",
        "impact": "low|medium|high",
        "mitigation": "string",
        "regulationsCited": ["string"]
      }
    ],
    "networkTopology": {
      "description": "string",
      "zones": [
        {
          "name": "Public DMZ|Private App|Data Layer",
          "assets": ["string"],
          "accessRules": ["string"]
        }
      ]
    },
    "encryptionControls": [
      {
        "mechanism": "string",
        "scope": "at-rest|in-transit|in-use",
        "algorithm": "AES-256-GCM|TLS 1.3|etc",
        "regulationsCited": ["string"]
      }
    ],
    "iamRules": [
      {
        "role": "string",
        "permissions": ["string"],
        "principle": "least-privilege|separation-of-duties|etc",
        "regulationsCited": ["string"]
      }
    ],
    "auditLogging": {
      "events": ["user.login", "data.access", "config.change"],
      "retentionDays": 90,
      "storage": "string",
      "regulationsCited": ["string"]
    },
    "incidentResponse": {
      "detectionMethods": ["string"],
      "notificationTimeline": "72 hours per GDPR Article 33",
      "regulationsCited": ["string"]
    },
    "dataResidency": {
      "regions": ["eu-west-1"],
      "justification": "string",
      "regulationsCited": ["string"]
    }
  },

  "cost_analysis": {
    "summary": "string",
    "monthlyTotalUSD": 0,
    "breakdown": [
      {
        "service": "string",
        "provider": "AWS|GCP|Azure|etc",
        "tier": "string",
        "monthlyCostUSD": 0,
        "complianceReason": "string",
        "regulationsCited": ["string"],
        "canReduceIfNonCompliant": false
      }
    ],
    "compliancePremium": {
      "totalUSD": 0,
      "explanation": "string"
    },
    "scalingProjection": [
      { "usersCount": 1000, "estimatedMonthlyCostUSD": 0 },
      { "usersCount": 10000, "estimatedMonthlyCostUSD": 0 },
      { "usersCount": 100000, "estimatedMonthlyCostUSD": 0 }
    ],
    "notes": "Pricing estimated at time of generation. Verify with provider pricing calculators before commitment."
  },

  "tech_stack_justification": {
    "summary": "string",
    "decisions": [
      {
        "category": "language|framework|database|message-queue|auth|monitoring|etc",
        "chosen": "string",
        "alternatives": [
          {
            "name": "string",
            "rejectionReason": "string",
            "complianceIssue": "string or null"
          }
        ],
        "justification": "string — WHY this is the right choice",
        "regulationsCited": ["string"],
        "complianceBenefit": "Specific compliance advantage of this choice"
      }
    ],
    "vendorRiskAssessment": [
      {
        "vendor": "string",
        "service": "string",
        "riskLevel": "low|medium|high",
        "mitigations": ["string"],
        "regulationsCited": ["string"]
      }
    ],
    "openSourceLicenses": [
      {
        "package": "string",
        "license": "MIT|Apache-2.0|GPL-3.0|etc",
        "compatible": true,
        "notes": "string"
      }
    ]
  },

  "code_scaffolding": {
    "fileTree": "project-root/\\n├── src/\\n│   └── ...",
    "dockerfile": "FROM node:20-alpine\\n...(complete production Dockerfile)...",
    "dockerCompose": "version: '3.9'\\n...(complete docker-compose.yml)...",
    "envTemplate": "# Environment variables\\n...",
    "ciPipeline": "name: Compliance CI\\n...(complete GitHub Actions YAML)...",
    "developerPrompt": "You are a developer on this project. COMPLIANCE RULES:\\n1. ...",
    "setupInstructions": "## Setup\\n\\n1. ...",
    "complianceAnnotations": [
      {
        "file": "src/auth/index.ts",
        "annotation": "Implements [GDPR Article 25] privacy by design",
        "regulationsCited": ["string"]
      }
    ]
  }
}`;
}
