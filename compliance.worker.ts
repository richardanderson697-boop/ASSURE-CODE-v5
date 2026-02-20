import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { COMPLIANCE_QUEUE } from './queue.module';
import { SupabaseService } from '../common/supabase.service';

// Dynamic imports from the compliance engine (separate package)
// In the monorepo, these would be resolved via package.json workspace paths
async function getOrchestrator() {
  const { runCompliancePipeline, saveReport } = await import(
    '../../compliance-engine/src/compliance/complianceOrchestrator'
  );
  return { runCompliancePipeline, saveReport };
}

export interface ComplianceJobPayload {
  jobId: string;
  workspaceId: string;
  userId: string;
  projectIdea: string;
  jurisdictions: string[];
  frameworks: string[];
  existingSpec?: string;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

@Processor(COMPLIANCE_QUEUE)
export class ComplianceWorker {
  private readonly logger = new Logger(ComplianceWorker.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Process({ concurrency: 2 }) // Run max 2 pipelines in parallel per worker
  async handleComplianceJob(job: Job<ComplianceJobPayload>): Promise<void> {
    const { jobId, workspaceId, projectIdea, jurisdictions, frameworks, existingSpec } =
      job.data;

    this.logger.log(`[Job ${jobId}] Starting compliance pipeline...`);

    // Update job status to 'processing'
    await this.updateJobStatus(jobId, 'processing');
    await job.progress(10);

    try {
      const { runCompliancePipeline, saveReport } = await getOrchestrator();

      await job.progress(20);

      const report = await runCompliancePipeline({
        projectIdea,
        jurisdictions,
        frameworks,
        existingSpec,
      });

      await job.progress(80);

      // Persist the report
      await saveReport(report);

      // Also store a workspace-scoped reference for the dashboard
      await this.supabase.db.from('workspace_reports').insert({
        job_id: jobId,
        workspace_id: workspaceId,
        request_id: report.requestId,
        final_status: report.finalStatus,
        scan_score: report.scanResult.score,
        requires_human_review: report.requiresHumanReview,
        report_json: report,
      });

      await job.progress(100);
      await this.updateJobStatus(jobId, 'completed');

      this.logger.log(`[Job ${jobId}] Completed. Status: ${report.finalStatus} | Score: ${report.scanResult.score.toFixed(2)}`);
    } catch (err: any) {
      this.logger.error(`[Job ${jobId}] Failed: ${err.message}`);
      await this.updateJobStatus(jobId, 'failed', err.message);
      throw err; // Re-throw so BullMQ retries
    }
  }

  @OnQueueFailed()
  onFailed(job: Job<ComplianceJobPayload>, error: Error) {
    this.logger.error(
      `[Job ${job.data.jobId}] All attempts exhausted. Error: ${error.message}`,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job<ComplianceJobPayload>) {
    this.logger.log(`[Job ${job.data.jobId}] Bull job completed.`);
  }

  private async updateJobStatus(
    jobId: string,
    status: JobStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.supabase.db
      .from('compliance_jobs')
      .update({
        status,
        error_message: errorMessage ?? null,
        updated_at: new Date().toISOString(),
        ...(status === 'completed' || status === 'failed'
          ? { completed_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', jobId);
  }
}
