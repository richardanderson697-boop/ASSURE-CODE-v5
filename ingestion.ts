// ============================================================
// ASSURE CODE — Regulation Ingestion Pipeline
// This is the "missing piece" — how new regulations get into
// the vector store. Supports seed data + incremental updates.
// ============================================================

import { Regulation, IngestionResult } from '../types';
import { upsertRegulations } from './vectorStore';

// ============================================================
// SEED DATA
// A baseline set of regulations to bootstrap the knowledge base.
// Extend this by adding more articles or loading from JSON files.
// ============================================================

const SEED_REGULATIONS: Omit<Regulation, 'id' | 'embedding' | 'createdAt' | 'updatedAt'>[] = [
  // --- GDPR ---
  {
    framework: 'GDPR',
    article: 'Article 5',
    title: 'Principles relating to processing of personal data',
    content: 'Personal data shall be processed lawfully, fairly and in a transparent manner in relation to the data subject. Collected for specified, explicit and legitimate purposes and not further processed in a manner incompatible with those purposes. Adequate, relevant and limited to what is necessary in relation to the purposes for which they are processed (data minimisation). Accurate and, where necessary, kept up to date. Kept in a form which permits identification of data subjects for no longer than is necessary. Processed in a manner that ensures appropriate security of the personal data.',
    jurisdiction: 'EU',
    severity: 'critical',
    tags: ['data-minimisation', 'lawfulness', 'transparency', 'storage-limitation'],
  },
  {
    framework: 'GDPR',
    article: 'Article 17',
    title: 'Right to erasure ("right to be forgotten")',
    content: 'The data subject shall have the right to obtain from the controller the erasure of personal data without undue delay. This applies where data is no longer necessary, consent is withdrawn, the data subject objects, or data has been unlawfully processed. The controller must take reasonable steps to inform other controllers processing the data of the erasure request.',
    jurisdiction: 'EU',
    severity: 'high',
    tags: ['data-erasure', 'right-to-be-forgotten', 'data-subject-rights'],
  },
  {
    framework: 'GDPR',
    article: 'Article 25',
    title: 'Data protection by design and by default',
    content: 'The controller shall implement appropriate technical and organisational measures, both at the time of the determination of the means for processing and at the time of the processing itself, designed to implement data-protection principles. Only personal data necessary for each specific purpose shall be processed by default.',
    jurisdiction: 'EU',
    severity: 'high',
    tags: ['privacy-by-design', 'data-minimisation', 'encryption', 'technical-measures'],
  },
  {
    framework: 'GDPR',
    article: 'Article 32',
    title: 'Security of processing',
    content: 'The controller and processor shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including: pseudonymisation and encryption of personal data; ongoing confidentiality, integrity, availability and resilience; ability to restore availability after incidents; regular testing and evaluation of security measures.',
    jurisdiction: 'EU',
    severity: 'critical',
    tags: ['encryption', 'pseudonymisation', 'security', 'resilience', 'incident-response'],
  },
  {
    framework: 'GDPR',
    article: 'Article 33',
    title: 'Notification of a personal data breach',
    content: 'In the case of a personal data breach, the controller shall without undue delay and, where feasible, not later than 72 hours after having become aware of it, notify the personal data breach to the supervisory authority. The notification shall describe the nature of the breach, categories of data, approximate number of individuals affected, and measures taken or proposed.',
    jurisdiction: 'EU',
    severity: 'critical',
    tags: ['breach-notification', 'incident-response', '72-hour-rule', 'supervisory-authority'],
  },

  // --- SOC 2 ---
  {
    framework: 'SOC2',
    article: 'CC6.1',
    title: 'Logical and Physical Access Controls',
    content: 'The entity implements logical access security software, infrastructure, and architectures over protected information assets to protect them from security events to meet the entity\'s objectives. This includes identification and authentication of users, authorization of access, and restriction of access to authorized users.',
    jurisdiction: 'US',
    severity: 'critical',
    tags: ['access-control', 'authentication', 'authorization', 'IAM'],
  },
  {
    framework: 'SOC2',
    article: 'CC6.7',
    title: 'Transmission of Data',
    content: 'The entity restricts the transmission, movement, and removal of information to authorized internal and external users and processes, and protects it during transmission, movement, or removal to meet the entity\'s objectives. Encryption in transit is required for all data moving across networks.',
    jurisdiction: 'US',
    severity: 'high',
    tags: ['encryption-in-transit', 'TLS', 'data-transmission', 'network-security'],
  },
  {
    framework: 'SOC2',
    article: 'CC7.2',
    title: 'Monitoring of System Components',
    content: 'The entity monitors system components and the operation of those controls on an ongoing basis to detect anomalies that are indicative of malicious acts, natural disasters, and errors affecting the entity\'s ability to meet its objectives. Automated monitoring, alerting, and logging must be implemented.',
    jurisdiction: 'US',
    severity: 'high',
    tags: ['monitoring', 'logging', 'alerting', 'anomaly-detection', 'SIEM'],
  },
  {
    framework: 'SOC2',
    article: 'A1.2',
    title: 'Availability — Environmental Protections',
    content: 'The entity authorizes, designs, develops or acquires, implements, operates, approves, maintains, and monitors environmental protections, software, data back-up processes, and recovery infrastructure to meet its availability objectives. Redundancy, failover, and disaster recovery procedures must be documented and tested.',
    jurisdiction: 'US',
    severity: 'high',
    tags: ['availability', 'disaster-recovery', 'backup', 'redundancy', 'RTO', 'RPO'],
  },

  // --- HIPAA ---
  {
    framework: 'HIPAA',
    article: '164.312(a)(1)',
    title: 'Access Control — Technical Safeguards',
    content: 'Implement technical policies and procedures for electronic information systems that maintain electronic protected health information to allow access only to those persons or software programs that have been granted access rights. Unique user identification, emergency access procedures, automatic logoff, and encryption/decryption must be implemented.',
    jurisdiction: 'US',
    severity: 'critical',
    tags: ['PHI', 'access-control', 'authentication', 'encryption', 'ePHI'],
  },
  {
    framework: 'HIPAA',
    article: '164.312(e)(1)',
    title: 'Transmission Security',
    content: 'Implement technical security measures to guard against unauthorized access to electronic protected health information that is being transmitted over an electronic communications network. Encryption of ePHI in transit is required. Network controls and integrity controls must be implemented.',
    jurisdiction: 'US',
    severity: 'critical',
    tags: ['PHI', 'encryption-in-transit', 'network-security', 'ePHI', 'TLS'],
  },
  {
    framework: 'HIPAA',
    article: '164.308(a)(1)',
    title: 'Security Management Process',
    content: 'Implement policies and procedures to prevent, detect, contain, and correct security violations. Risk analysis, risk management, sanction policy, and information system activity review are required components. Organizations must conduct an accurate and thorough assessment of the potential risks and vulnerabilities to the confidentiality, integrity, and availability of ePHI.',
    jurisdiction: 'US',
    severity: 'critical',
    tags: ['risk-management', 'risk-analysis', 'security-policy', 'PHI', 'vulnerability-management'],
  },
];

// ============================================================
// INGESTION FUNCTIONS
// ============================================================

/**
 * Seed the vector store with the baseline regulation set.
 * Safe to run multiple times — uses upsert.
 */
export async function seedRegulations(): Promise<IngestionResult> {
  console.log(`[Ingestion] Starting seed with ${SEED_REGULATIONS.length} regulations...`);

  const result = await upsertRegulations(SEED_REGULATIONS);

  const ingestionResult: IngestionResult = {
    total: SEED_REGULATIONS.length,
    succeeded: result.succeeded,
    failed: result.failed,
    errors: result.errors.map(e => ({ regulation: 'batch', error: e })),
  };

  console.log(`[Ingestion] Seed complete: ${ingestionResult.succeeded} succeeded, ${ingestionResult.failed} failed.`);

  return ingestionResult;
}

/**
 * Ingest a custom set of regulations from an external source.
 * Use this for incremental updates when new guidance is published.
 *
 * Example: Fetch from a regulatory API, parse a PDF, or load a JSON file,
 * then pass the structured records here.
 */
export async function ingestRegulations(
  regulations: Omit<Regulation, 'id' | 'embedding' | 'createdAt' | 'updatedAt'>[]
): Promise<IngestionResult> {
  if (regulations.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  }

  console.log(`[Ingestion] Ingesting ${regulations.length} regulations...`);

  const result = await upsertRegulations(regulations);

  return {
    total: regulations.length,
    succeeded: result.succeeded,
    failed: result.failed,
    errors: result.errors.map(e => ({ regulation: 'batch', error: e })),
  };
}

/**
 * Load regulations from a JSON file and ingest them.
 * Useful for bulk imports of structured regulatory data.
 *
 * Expected JSON format: Array of Regulation objects (without id/embedding).
 */
export async function ingestFromJsonFile(filePath: string): Promise<IngestionResult> {
  const fs = await import('fs/promises');
  const raw = await fs.readFile(filePath, 'utf-8');
  const regulations = JSON.parse(raw);

  if (!Array.isArray(regulations)) {
    throw new Error(`[Ingestion] JSON file must export an array of regulations.`);
  }

  return ingestRegulations(regulations);
}

// ============================================================
// CLI RUNNER — node -r ts-node/register src/rag/ingestion.ts
// ============================================================
if (require.main === module) {
  seedRegulations()
    .then(result => {
      console.log('[Ingestion] Done:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Ingestion] Fatal error:', err);
      process.exit(1);
    });
}
