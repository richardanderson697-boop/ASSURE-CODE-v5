// ============================================================
// ASSURE CODE — Shared Types
// ============================================================

// --------------- Regulatory Knowledge Base ------------------

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ComplianceStatus = 'compliant' | 'non_compliant' | 'partial';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Framework = 'GDPR' | 'SOC2' | 'HIPAA' | 'PCI_DSS' | 'ISO27001' | string;

export interface Regulation {
  id: string;
  framework: Framework;
  article: string;         // e.g. "Article 17", "CC6.1"
  title: string;           // Short human-readable title
  content: string;         // Full regulatory text
  jurisdiction: string;    // e.g. "EU", "US", "GLOBAL"
  severity: Severity;
  tags: string[];          // e.g. ["data-retention", "encryption"]
  embedding?: number[];    // Populated during ingestion
  createdAt?: string;
  updatedAt?: string;
}

export interface RetrievedRegulation extends Regulation {
  similarity: number;      // Cosine similarity score from pgvector
}

// --------------- Ingestion ----------------------------------

export interface IngestionResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ regulation: string; error: string }>;
}

// --------------- Draft Engine (Gemini) ----------------------

export interface SpecificationRequest {
  projectIdea: string;
  jurisdictions: string[];
  frameworks: Framework[];
  existingSpec?: string;   // For update flows (PR amendments)
}

export interface TechStackItem {
  name: string;
  role: string;
  complianceJustification: string;
  regulationsCited: string[];
}

export interface SecurityControl {
  mechanism: string;
  description: string;
  regulationsCited: string[];
  implementation: string;
}

export interface IAMRule {
  rule: string;
  principle: string;       // e.g. "least privilege"
  regulationsCited: string[];
}

export interface CostLineItem {
  service: string;
  monthlyCostUSD: number;
  complianceReason: string;
  tier: string;
}

export interface DraftSpecification {
  version: string;
  generatedAt: string;
  projectSummary: string;
  techStack: {
    languages: TechStackItem[];
    cloudProviders: TechStackItem[];
    databases: TechStackItem[];
    thirdPartyServices: TechStackItem[];
  };
  securityBlueprint: {
    networkTopology: string;
    encryptionControls: SecurityControl[];
    iamRules: IAMRule[];
    dataResidency: string;
    auditLogging: string;
  };
  costEstimate: {
    monthlyTotalUSD: number;
    breakdown: CostLineItem[];
    notes: string;
  };
  codeScaffolding: {
    fileTree: string;
    dockerfile: string;
    dockerCompose?: string;
  };
  developerPrompt: string;  // The "Master Prompt" for IDE injection
  regulationsApplied: string[];
}

// --------------- Scanner Service (OpenAI) -------------------

export interface ScanFinding {
  issue: string;
  regulation: string;      // Framework + Article
  gap: string;
  remediation: string;
  riskLevel: RiskLevel;
  affectedSection: string; // Which part of the spec this targets
}

export interface ScanResult {
  passed: boolean;
  score: number;           // 0.0 – 1.0 (Gold Standard threshold)
  threshold: number;       // Configured minimum to pass
  status: ComplianceStatus;
  findings: ScanFinding[];
  executiveSummary: string;
  suggestedControls: string[];
  scannedAt: string;
}

// --------------- Orchestrator Output ------------------------

export interface ComplianceReport {
  requestId: string;
  projectIdea: string;
  jurisdictions: string[];
  frameworks: Framework[];
  retrievedRegulations: RetrievedRegulation[];
  draft: DraftSpecification;
  scanResult: ScanResult;
  finalStatus: ComplianceStatus;
  requiresHumanReview: boolean;   // True if score is in ambiguous range
  completedAt: string;
}
