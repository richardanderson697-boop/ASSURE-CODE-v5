// ============================================================
// ASSURE CODE — Application Bootstrap
// Starts all Kafka consumers and BullMQ queues.
// Called at app startup (NestJS onModuleInit or standalone).
// ============================================================

import 'dotenv/config';
import { startRegulationConsumer } from './events/regulationConsumer';
import { startGitHubPRConsumer } from './github/githubPRConsumer';
import { getQueueStats } from './queue/specPatchQueue';

export async function bootstrap(): Promise<void> {
  console.log('\n========================================');
  console.log('  ASSURE CODE — Compliance Engine');
  console.log('========================================\n');

  // ── Validate required env vars ─────────────────────────────
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'REDIS_HOST',
    'KAFKA_BROKERS',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Bootstrap] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // ── Start Kafka consumers ──────────────────────────────────
  console.log('[Bootstrap] Starting Kafka consumers...');

  await startRegulationConsumer(); // regulation.new → spec patch jobs
  await startGitHubPRConsumer();   // spec.pr_requested → GitHub PRs

  // ── Log queue stats ────────────────────────────────────────
  const stats = await getQueueStats();
  console.log('[Bootstrap] Spec patch queue stats:', stats);

  console.log('\n[Bootstrap] ✅ All services running.');
  console.log('[Bootstrap] Listening for:');
  console.log('  - Kafka: regulation.new, regulation.updated');
  console.log('  - Kafka: spec.pr_requested');
  console.log('  - BullMQ: spec-patch (concurrency: 3)');
  console.log('  - BullMQ: github-pr (concurrency: 2)');
  console.log('\n');
}

if (require.main === module) {
  bootstrap().catch(err => {
    console.error('[Bootstrap] Fatal error:', err);
    process.exit(1);
  });
}
