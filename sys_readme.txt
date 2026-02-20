# Assure Code — Full System Architecture

## The Complete Picture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SOURCES                              │
│  Regulation Scraper → Kafka "regulation.new"                        │
│  GitHub Webhooks    → spec.pr_merged / spec.pr_reviewed             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ASSURE CODE HUB                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    KAFKA EVENT BUS                           │    │
│  │  Topics:                                                     │    │
│  │  → regulation.new / regulation.updated                      │    │
│  │  ← spec.created / spec.updated                              │    │
│  │  → spec.pr_requested                                        │    │
│  │  ← spec.pr_created                                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│          │                           │                               │
│          ▼                           ▼                               │
│  ┌───────────────────┐    ┌─────────────────────────────────┐       │
│  │ Regulation Impact │    │          BullMQ Queues           │       │
│  │    Analyzer       │    │  spec-patch (concurrency: 3)     │       │
│  │                   │    │  github-pr  (concurrency: 2)     │       │
│  │ Which workspaces  │    │  compliance-job (from API)       │       │
│  │ are affected?     │    └──────────────────┬──────────────┘       │
│  └────────┬──────────┘                       │                      │
│           │ Per-spec BullMQ job              │                      │
│           ▼                                  ▼                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  CLAUDE DIFF ENGINE                          │    │
│  │  1. detectAffectedModules() — which of 5 modules?           │    │
│  │  2. generateModuleDiffs()   — before/after per clause       │    │
│  │  3. applyDiffsToSpec()      — minimal patch only            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              5-MODULE SPEC VERSION (Versioned)               │    │
│  │                                                              │    │
│  │  Module 1: Master Specification   (projectSummary, flows)   │    │
│  │  Module 2: Security Blueprint     (encryption, IAM, audit)  │    │
│  │  Module 3: Cost Analysis          (breakdown, premium)      │    │
│  │  Module 4: Tech Stack Justification (decisions, alternatives│    │
│  │  Module 5: Code Scaffolding       (Dockerfile, CI, prompts) │    │
│  │                                                              │    │
│  │  parent_id chain: v1.0.0 → v1.1.0 → v1.2.0 → ...          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼ GitHub App (Octokit)
┌─────────────────────────────────────────────────────────────────────┐
│                        GITHUB                                        │
│                                                                      │
│  Branch: compliance/gdpr-article-32-v1.1.0                          │
│  Files committed:                                                    │
│    specs/01-master-specification.md                                  │
│    specs/02-security-blueprint.md       ← amended clauses only      │
│    specs/03-cost-analysis.md                                         │
│    specs/04-tech-stack-justification.md                              │
│    specs/05-code-scaffolding.md                                      │
│    specs/compliance-diff-summary.md     ← before/after diff         │
│    Dockerfile                           ← from Module 5             │
│    docker-compose.yml                   ← from Module 5             │
│    .github/workflows/compliance-ci.yml  ← from Module 5            │
│                                                                      │
│  PR assigned to: Developer (from workspace_members)                  │
│  Labels: compliance, automated, gdpr                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Spec Version Chain
```
spec_versions
  id: uuid (PK)
  parent_id: uuid → spec_versions(id)   ← version chain
  version_number: int (1, 2, 3...)
  version_label: text ('v1.0.0', 'v1.1.0')
  status: draft | active | superseded | archived
  triggered_by: user | regulation_update | scan
  regulation_trigger: 'GDPR Article 32'
  master_specification: JSONB
  security_blueprint: JSONB
  cost_analysis: JSONB
  tech_stack_justification: JSONB
  code_scaffolding: JSONB
```

### Clause Diff Audit
```
spec_diffs
  from_version_id → spec_versions(id)
  to_version_id   → spec_versions(id)
  module: 'security_blueprint'
  clause_path: 'encryptionControls[0].algorithm'
  field_label: 'Encryption Algorithm'
  before_value: 'AES-128'
  after_value: 'AES-256'
  reason: 'GDPR Article 32 requires 256-bit minimum'
  severity: high
```

## Event Flow for a New Regulation

```
1. Scraper publishes → Kafka: regulation.new
   { framework: 'GDPR', article: 'Article 32 (amended)', jurisdiction: 'EU' }

2. RegulationConsumer receives event
   → Calls findAffectedSpecs('GDPR', 'EU')
   → DB: find_affected_specs() returns all active specs using GDPR + EU
   → Semantic filter: eliminate specs with low similarity to this article

3. Per-spec BullMQ job enqueued (spec-patch queue)
   Priority: critical > high > medium > low

4. ComplianceWorker processes job
   → detectAffectedModules() → Claude: ['security_blueprint', 'code_scaffolding']
   → generateModuleDiffs() → Claude: 3 clause diffs
   → applyDiffsToSpec() → Claude: updated module JSON

5. New spec version created in DB
   → version_number: 2, version_label: 'v1.1.0'
   → parent_id: points to v1.0.0
   → DB trigger auto-marks v1.0.0 as 'superseded'

6. Kafka publishes → spec.updated + spec.pr_requested

7. GitHubPRConsumer receives spec.pr_requested
   → Checks workspace has GitHub connection
   → BullMQ github-pr job enqueued

8. GitHub PR created:
   → Branch: compliance/gdpr-article-32-v1.1.0
   → 9 files committed (specs + infra)
   → PR assigned to developers in workspace_members
   → Labels: compliance, automated, gdpr
   → PR URL saved back to spec_versions.github_pr_url
```

## Setup

### 1. Run migrations in order
```sql
-- In Supabase SQL editor:
-- 001_pgvector.sql
-- 002_gateway_tables.sql
-- 003_specs.sql  ← new
```

### 2. Environment
```bash
cp .env.example .env

# Required additions for this module:
KAFKA_BROKERS=localhost:9092
GITHUB_APP_ID=your-app-id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
```

### 3. GitHub App Setup
1. Create a GitHub App at https://github.com/settings/apps/new
2. Required permissions: `Contents: Write`, `Pull Requests: Write`, `Issues: Write`
3. Download the private key and set `GITHUB_APP_PRIVATE_KEY`
4. Users install the app on their repo → webhook delivers `installation.created`
5. Save `installation_id` to `github_connections` table

### 4. Start
```bash
npm run start:dev  # Starts NestJS + all Kafka consumers + BullMQ workers
```

## Workspace Roles

| Role | Can do |
|------|--------|
| `owner` | Create workspace, manage billing, invite members, connect GitHub |
| `compliance_officer` | Create/view specs, trigger scans, approve patch PRs |
| `developer` | View specs (read-only), receive GitHub PR assignments |

## Module 4 — Tech Stack Justification (Fixed)

This was identified as missing in the Gemini audit. Every tech decision now requires:
- `chosen`: The selected technology
- `alternatives`: Array with `name`, `rejectionReason`, `complianceIssue`
- `justification`: Why this is the right compliance choice
- `complianceBenefit`: Specific advantage for the regulatory frameworks in scope
- `regulationsCited`: Which regulations mandate or support this choice
