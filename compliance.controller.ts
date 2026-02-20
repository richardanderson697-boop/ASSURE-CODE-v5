import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Sse,
  MessageEvent,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { Observable, interval, from, switchMap, takeWhile, map, finalize } from 'rxjs';
import { ComplianceService } from './compliance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ── DTOs ─────────────────────────────────────────────────────

export class SubmitComplianceJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  projectIdea: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  jurisdictions: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  frameworks: string[];

  @IsOptional()
  @IsString()
  existingSpec?: string;
}

// ── Controller ───────────────────────────────────────────────

@ApiTags('compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  /**
   * POST /api/v1/compliance/jobs
   * Submit a new compliance analysis job.
   * Returns immediately with a jobId — use GET /jobs/:id/status or SSE to track.
   */
  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a compliance analysis job',
    description:
      'Enqueues a compliance pipeline run. Returns a jobId immediately. ' +
      'Poll GET /jobs/:id/status or subscribe to GET /jobs/:id/stream for live progress.',
  })
  @ApiResponse({ status: 202, description: 'Job accepted and queued.' })
  @ApiResponse({ status: 402, description: 'Monthly report limit reached.' })
  async submitJob(
    @Body() dto: SubmitComplianceJobDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.complianceService.submitJob({
      workspaceId: user.workspaceId,
      userId: user.sub,
      projectIdea: dto.projectIdea,
      jurisdictions: dto.jurisdictions,
      frameworks: dto.frameworks,
      existingSpec: dto.existingSpec,
    });

    return {
      jobId: result.jobId,
      queuePosition: result.queuePosition,
      statusUrl: `/api/v1/compliance/jobs/${result.jobId}/status`,
      streamUrl: `/api/v1/compliance/jobs/${result.jobId}/stream`,
    };
  }

  /**
   * GET /api/v1/compliance/jobs/:jobId/status
   * Poll for job status and progress.
   */
  @Get('jobs/:jobId/status')
  @ApiOperation({ summary: 'Get job status and progress (0–100)' })
  async getStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.complianceService.getJobStatus(jobId, user.workspaceId);
  }

  /**
   * GET /api/v1/compliance/jobs/:jobId/stream
   * Server-Sent Events stream for real-time job progress.
   * Connect from the frontend with EventSource API.
   *
   * Emits: { status, progress, message } every 2 seconds until complete.
   */
  @Sse('jobs/:jobId/stream')
  @ApiOperation({
    summary: 'SSE stream for real-time job progress',
    description: 'Connect with EventSource. Closes automatically when job completes or fails.',
  })
  streamJobProgress(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
  ): Observable<MessageEvent> {
    // Poll the job status every 2 seconds and emit as SSE
    return interval(2000).pipe(
      switchMap(() =>
        from(this.complianceService.getJobStatus(jobId, user.workspaceId)),
      ),
      takeWhile(
        (status) => status.status !== 'completed' && status.status !== 'failed',
        true, // Include the final status before completing
      ),
      map((status) => ({
        data: JSON.stringify({
          jobId,
          status: status.status,
          progress: status.progress,
          message: getProgressMessage(status.progress),
          errorMessage: status.errorMessage,
          completedAt: status.completedAt,
        }),
      })),
    );
  }

  /**
   * GET /api/v1/compliance/jobs/:jobId/report
   * Retrieve the completed compliance report.
   */
  @Get('jobs/:jobId/report')
  @ApiOperation({
    summary: 'Get the completed compliance report',
    description: 'Only available once the job status is "completed".',
  })
  @ApiResponse({ status: 404, description: 'Report not found — job may still be processing.' })
  async getReport(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.complianceService.getReport(jobId, user.workspaceId);
  }

  /**
   * GET /api/v1/compliance/jobs
   * List all jobs for the authenticated workspace.
   */
  @Get('jobs')
  @ApiOperation({ summary: 'List all compliance jobs for the workspace' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listJobs(
    @CurrentUser() user: JwtPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.complianceService.listJobs(user.workspaceId, page, Math.min(limit, 100));
  }
}

// ── Helpers ──────────────────────────────────────────────────

function getProgressMessage(progress: number): string {
  if (progress < 20) return 'Retrieving relevant regulations...';
  if (progress < 50) return 'Generating technical specification with Gemini...';
  if (progress < 80) return 'Running Gold Standard compliance scan...';
  if (progress < 100) return 'Claude is arbitrating final report...';
  return 'Complete!';
}
