// ============================================================
// ASSURE CODE — GitHub PR Consumer
// Listens on Kafka for "spec.pr_requested" events and
// dispatches GitHub PR creation via BullMQ to keep it
// non-blocking and retryable.
// ============================================================

import Bull, { Queue, Job } from 'bull';
import { createConsumer, TOPICS } from '../events/kafka.client';
import { createCompliancePR, CreateCompliancePRInput } from './githubService';
import { createClient } from '@supabase/supabase-js';

const GITHUB_PR_QUEUE_NAME = 'github-pr';

let _queue: Queue | null = null;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getPRQueue(): Queue {
  if (!_queue) {
    _queue = new Bull(GITHUB_PR_QUEUE_NAME, {
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    // Worker: one PR at a time per workspace to avoid rate limit conflicts
    _queue.process(GITHUB_PR_QUEUE_NAME, 2, async (job: Job) => {
      const input = job.data as CreateCompliancePRInput;

      console.log(`[GitHubWorker] Creating PR for workspace ${input.workspaceId} — ${input.regulationTrigger}`);

      const prUrl = await createCompliancePR(input);

      console.log(`[GitHubWorker] ✅ PR created: ${prUrl}`);

      return { prUrl };
    });

    _queue.on('failed', (job, err) => {
      console.error(`[GitHubWorker] ❌ PR job ${job.id} failed: ${err.message}`);
    });

    console.log('[GitHubWorker] PR queue worker started.');
  }

  return _queue;
}

/**
 * Start the Kafka consumer that triggers GitHub PR creation.
 */
export async function startGitHubPRConsumer(): Promise<void> {
  getPRQueue(); // Initialize worker

  await createConsumer(
    'assure-github-pr-group',
    [TOPICS.SPEC_PR_REQUESTED],
    {
      [TOPICS.SPEC_PR_REQUESTED]: async (event) => {
        const { workspaceId, specVersionId, previousVersionId, regulationTrigger, affectedModules, diffs, versionLabel } = event;

        // Check if workspace has a GitHub connection before enqueuing
        const supabase = getSupabase();
        const { data: conn } = await supabase
          .from('github_connections')
          .select('id')
          .eq('workspace_id', workspaceId)
          .single();

        if (!conn) {
          console.log(`[GitHubConsumer] Workspace ${workspaceId} has no GitHub connection. Skipping PR.`);
          return;
        }

        // Fetch the new spec version
        const { data: specRow } = await supabase
          .from('spec_versions')
          .select('*')
          .eq('id', specVersionId)
          .single();

        if (!specRow) {
          console.error(`[GitHubConsumer] Spec ${specVersionId} not found.`);
          return;
        }

        const specVersion = {
          id: specRow.id,
          workspaceId: specRow.workspace_id,
          parentId: specRow.parent_id,
          versionNumber: specRow.version_number,
          versionLabel: specRow.version_label,
          status: specRow.status,
          changeReason: specRow.change_reason,
          triggeredBy: specRow.triggered_by,
          regulationTrigger: specRow.regulation_trigger,
          jurisdictions: specRow.jurisdictions,
          frameworks: specRow.frameworks,
          modules: {
            master_specification: specRow.master_specification,
            security_blueprint: specRow.security_blueprint,
            cost_analysis: specRow.cost_analysis,
            tech_stack_justification: specRow.tech_stack_justification,
            code_scaffolding: specRow.code_scaffolding,
          },
          createdBy: specRow.created_by,
          createdAt: specRow.created_at,
        };

        const queue = getPRQueue();
        await queue.add(GITHUB_PR_QUEUE_NAME, {
          workspaceId,
          specVersion,
          previousVersionId,
          regulationTrigger,
          affectedModules,
          diffs,
          versionLabel,
        } as CreateCompliancePRInput);

        console.log(`[GitHubConsumer] PR job enqueued for workspace ${workspaceId}`);
      },
    },
  );

  console.log('[GitHubConsumer] Listening for spec.pr_requested events...');
}
