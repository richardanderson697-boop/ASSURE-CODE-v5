// ============================================================
// ASSURE CODE — Entry Point
// Run this to test the full compliance pipeline end-to-end.
// ============================================================

import 'dotenv/config';
import { runCompliancePipeline, saveReport } from './compliance/complianceOrchestrator';
import { seedRegulations } from './rag/ingestion';
import { SpecificationRequest } from './types';
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // ── Command: seed ─────────────────────────────────────────
  // npx ts-node src/index.ts seed
  if (command === 'seed') {
    console.log('Seeding regulation knowledge base...');
    const result = await seedRegulations();
    console.log('Seed complete:', result);
    return;
  }

  // ── Command: run ──────────────────────────────────────────
  // npx ts-node src/index.ts run
  // Uses the example request below — replace with your own
  const exampleRequest: SpecificationRequest = {
    projectIdea: `
      A healthcare SaaS platform that allows patients in the EU and US to upload 
      medical records, receive AI-powered health insights, and share data securely 
      with their physicians. The platform will store electronic Protected Health 
      Information (ePHI) and Personal Data including names, dates of birth, 
      diagnoses, and treatment history. It needs a mobile app (iOS/Android), 
      a web dashboard, and an API for third-party EHR integrations.
    `.trim(),
    jurisdictions: ['EU', 'US'],
    frameworks: ['GDPR', 'HIPAA', 'SOC2'],
  };

  console.log('Running compliance pipeline...\n');

  try {
    const report = await runCompliancePipeline(exampleRequest);

    // Save to Supabase audit log
    await saveReport(report);

    // Write report to disk for inspection
    const outputPath = path.join(process.cwd(), 'compliance-report.json');
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\nFull report written to: ${outputPath}`);

    // Print summary
    console.log('\n──── COMPLIANCE SUMMARY ────');
    console.log(`Status: ${report.finalStatus.toUpperCase()}`);
    console.log(`Scan Score: ${(report.scanResult.score * 100).toFixed(0)}%`);
    console.log(`Human Review: ${report.requiresHumanReview ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`Regulations Applied: ${report.draft.regulationsApplied?.join(', ')}`);
    console.log(`Findings: ${report.scanResult.findings.length}`);

    if (report.scanResult.findings.length > 0) {
      console.log('\n──── FINDINGS ────');
      report.scanResult.findings.forEach((f, i) => {
        console.log(`${i + 1}. [${f.riskLevel.toUpperCase()}] ${f.issue}`);
        console.log(`   Regulation: ${f.regulation}`);
        console.log(`   Fix: ${f.remediation}\n`);
      });
    }

  } catch (err: any) {
    console.error('\n[FATAL] Pipeline failed:', err.message);
    if (err.message.includes('No regulations found')) {
      console.error('\nHint: Run the seed command first:');
      console.error('  npx ts-node src/index.ts seed');
    }
    process.exit(1);
  }
}

main();
