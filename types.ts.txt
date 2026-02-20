// ============================================================
// ASSURE CODE — Spec System Types
// 5 modules as first-class documents with full version chain
// ============================================================

export type SpecStatus = 'draft' | 'active' | 'superseded' | 'archived';
export type ModuleKey =
  | 'master_specification'
  | 'security_blueprint'
  | 'cost_analysis'
  | 'tech_stack_justification'
  | 'code_scaffolding';

export type MemberRole = 'owner' | 'compliance_officer' | 'developer';
export type Framework = 'GDPR' | 'SOC2' | 'HIPAA' | 'PCI_DSS' | 'ISO27001' | string;

// ── Module 1: Master Specification ───────────────────────────
export interface MasterSpecification {
  projectName: string;
  projectSummary: string;
  problemStatement: string;
  targetUsers: string[];
  coreFeatures: Array<{
    name: string;
    description: string;
    regulationsCited: string[];
  }>;
  dataFlows: Array<{
    from: string;
    to: string;
    dataType: string;
    regulationsCited: string[];
  }>;
  nonFunctionalRequirements: Array<{
    category: string; // performance, availability, compliance
    requirement: string;
    regulationsCited: string[];
  }>;
  outOfScope: string[];
  regulationsApplied: string[];
}

// ── Module 2: Security Blueprint ─────────────────────────────
export interface SecurityBlueprint {
  threatModel: Array<{
    threat: string;
    likelihood: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
    regulationsCited: string[];
  }>;
  networkTopology: {
    description: string;
    zones: Array<{ name: string; assets: string[]; accessRules: string[] }>;
  };
  encryptionControls: Array<{
    mechanism: string;
    scope: string; // at-rest, in-transit, in-use
    algorithm: string;
    regulationsCited: string[];
  }>;
  iamRules: Array<{
    role: string;
    permissions: string[];
    principle: string;
    regulationsCited: string[];
  }>;
  auditLogging: {
    events: string[];
    retentionDays: number;
    storage: string;
    regulationsCited: string[];
  };
  incidentResponse: {
    detectionMethods: string[];
    notificationTimeline: string; // e.g. "72 hours per GDPR Art 33"
    regulationsCited: string[];
  };
  dataResidency: {
    regions: string[];
    justification: string;
    regulationsCited: string[];
  };
}

// ── Module 3: Cost Analysis ───────────────────────────────────
export interface CostAnalysis {
  summary: string;
  monthlyTotalUSD: number;
  breakdown: Array<{
    service: string;
    provider: string;
    tier: string;
    monthlyCostUSD: number;
    complianceReason: string;
    regulationsCited: string[];
    canReduceIfNonCompliant: boolean;
  }>;
  compliancePremium: {
    totalUSD: number;
    explanation: string; // Cost delta vs non-compliant equivalent
  };
  scalingProjection: Array<{
    usersCount: number;
    estimatedMonthlyCostUSD: number;
  }>;
  notes: string;
}

// ── Module 4: Tech Stack Justification ───────────────────────
export interface TechStackJustification {
  summary: string;
  decisions: Array<{
    category: string; // language, framework, database, queue, etc.
    chosen: string;
    alternatives: Array<{
      name: string;
      rejectionReason: string;
      complianceIssue?: string;
    }>;
    justification: string;
    regulationsCited: string[];
    complianceBenefit: string;
  }>;
  vendorRiskAssessment: Array<{
    vendor: string;
    service: string;
    riskLevel: 'low' | 'medium' | 'high';
    mitigations: string[];
    regulationsCited: string[];
  }>;
  openSourceLicenses: Array<{
    package: string;
    license: string;
    compatible: boolean;
    notes: string;
  }>;
}

// ── Module 5: Code Scaffolding ────────────────────────────────
export interface CodeScaffolding {
  fileTree: string;
  dockerfile: string;
  dockerCompose: string;
  envTemplate: string;
  ciPipeline: string; // GitHub Actions YAML
  developerPrompt: string; // IDE system prompt enforcing compliance
  setupInstructions: string;
  complianceAnnotations: Array<{
    file: string;
    annotation: string;
    regulationsCited: string[];
  }>;
}

// ── Versioned Spec (the container) ───────────────────────────
export interface SpecVersion {
  id: string;
  workspaceId: string;
  parentId: string | null;    // null = first version
  versionNumber: number;      // 1, 2, 3...
  versionLabel: string;       // "v1.0.0", "v1.1.0"
  status: SpecStatus;
  changeReason: string;       // "Initial creation" | "Regulation update: GDPR Art 17"
  triggeredBy: 'user' | 'regulation_update' | 'scan';
  regulationTrigger?: string; // e.g. "GDPR Article 17" if auto-triggered
  jurisdictions: string[];
  frameworks: Framework[];
  // The 5 modules
  modules: {
    master_specification: MasterSpecification;
    security_blueprint: SecurityBlueprint;
    cost_analysis: CostAnalysis;
    tech_stack_justification: TechStackJustification;
    code_scaffolding: CodeScaffolding;
  };
  createdBy: string;          // userId
  createdAt: string;
  scanScore?: number;
  githubPrUrl?: string;
}

// ── Clause-Level Diff ─────────────────────────────────────────
export interface ClauseDiff {
  module: ModuleKey;
  clausePath: string;         // e.g. "encryptionControls[2].algorithm"
  fieldLabel: string;         // Human readable: "Encryption Algorithm"
  before: string;
  after: string;
  reason: string;
  regulationTrigger: string;  // e.g. "GDPR Article 32"
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SpecPatchResult {
  specVersionId: string;
  newVersionId: string;
  newVersionNumber: number;
  diffs: ClauseDiff[];
  affectedModules: ModuleKey[];
  regulationTrigger: string;
  patchedAt: string;
}

// ── Kafka Events ──────────────────────────────────────────────
export interface RegulationNewEvent {
  eventId: string;
  eventType: 'regulation.new' | 'regulation.updated';
  regulation: {
    id: string;
    framework: string;
    article: string;
    title: string;
    content: string;
    jurisdiction: string;
    severity: string;
  };
  scrapedAt: string;
}

export interface SpecUpdatedEvent {
  eventId: string;
  eventType: 'spec.updated';
  workspaceId: string;
  specVersionId: string;
  newVersionId: string;
  regulationTrigger: string;
  affectedModules: ModuleKey[];
  diffs: ClauseDiff[];
  githubPrRequested: boolean;
}

// ── Workspace Members ──────────────────────────────────────────
export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  role: MemberRole;
  githubLogin?: string;       // For PR assignment
  joinedAt: string;
}
