import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  PaymentRequiredException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { COMPLIANCE_QUEUE, ComplianceJobPayload } from '../queue/queue.module';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SupabaseService } from '../common/supabase.service';

export interface SubmitJobInput {
  workspaceId: string;
  userId: string;
  projectIdea: string;
  jurisdictions: string[];
  frameworks: string[];
  existingSpec?: string;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectQueue(COMPLIANCE_QUEUE) private readonly queue: Queue,
    private readonly workspaces: WorkspacesService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Submit a new compliance job.
   * Checks plan limits, creates a DB record, and enqueues the job.
   */
  async submitJob(input: SubmitJobInput): Promise<{ jobId: string; queuePosition: number }> {
    // 1. Check plan limits
    const { allowed, used, limit } = await this.workspaces.checkReportLimit(
      input.workspaceId,
    );

    if (!allowed) {
      throw new PaymentRequiredException(
        `Monthly report limit reached (${used}/${limit}). Upgrade your plan to continue.`,
      );
    }

    // 2. Create job record in DB
    const jobId = uuidv4();
    const { error } = await this.supabase.db.from('compliance_jobs').insert({
      id: jobId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      project_idea: input.projectIdea,
      jurisdictions: input.jurisdictions,
      frameworks: input.frameworks,
      status: 'queued',
    });

    if (error) {
      throw new Error(`Failed to create job record: ${error.message}`);
    }

    // 3. Increment usage counter
    await this.workspaces.incrementReportCount(input.workspaceId);

    // 4. Enqueue the job
    const payload: ComplianceJobPayload = {
      jobId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectIdea: input.projectIdea,
      jurisdictions: input.jurisdictions,
      frameworks: input.frameworks,
      existingSpec: input.existingSpec,
    };

    const bullJob = await this.queue.add(payload, {
      jobId, // Use our UUID as the BullMQ job ID for correlation
    });

    const queueCount = await this.queue.getWaitingCount();

    this.logger.log(
      `[Job ${jobId}] Enqueued for workspace ${input.workspaceId}. Queue depth: ${queueCount}`,
    );

    return { jobId, queuePosition: queueCount };
  }

  /**
   * Get the current status of a job.
   */
  async getJobStatus(jobId: string, workspaceId: string): Promise<{
    jobId: string;
    status: string;
    progress: number;
    errorMessage?: string;
    completedAt?: string;
  }> {
    // Verify the job belongs to this workspace (tenant isolation)
    const { data, error } = await this.supabase.db
      .from('compliance_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Job ${jobId} not found.`);
    }

    // Also get Bull progress
    const bullJob = await this.queue.getJob(jobId);
    const progress = bullJob ? await bullJob.progress() : 0;

    return {
      jobId: data.id,
      status: data.status,
      progress: typeof progress === 'number' ? progress : 0,
      errorMessage: data.error_message,
      completedAt: data.completed_at,
    };
  }

  /**
   * Retrieve the completed compliance report for a job.
   */
  async getReport(jobId: string, workspaceId: string): Promise<any> {
    const { data, error } = await this.supabase.db
      .from('workspace_reports')
      .select('report_json, final_status, scan_score, requires_human_review, created_at')
      .eq('job_id', jobId)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !data) {
      throw new NotFoundException(
        `Report for job ${jobId} not found. The job may still be processing.`,
      );
    }

    return data;
  }

  /**
   * List all jobs for a workspace (paginated).
   */
  async listJobs(
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ jobs: any[]; total: number }> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await this.supabase.db
      .from('compliance_jobs')
      .select('id, status, project_idea, created_at, completed_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Failed to list jobs: ${error.message}`);

    return { jobs: data ?? [], total: count ?? 0 };
  }
}
