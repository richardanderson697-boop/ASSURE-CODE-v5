import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: 'free' | 'pro' | 'enterprise';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  monthlyReportCount: number;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  ownerId: string;
}

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    // Check slug uniqueness
    const { data: existing } = await this.supabase.db
      .from('workspaces')
      .select('id')
      .eq('slug', input.slug)
      .single();

    if (existing) {
      throw new ConflictException(`Slug "${input.slug}" is already taken.`);
    }

    const { data, error } = await this.supabase.db
      .from('workspaces')
      .insert({
        name: input.name,
        slug: input.slug,
        owner_id: input.ownerId,
        plan: 'free',
        monthly_report_count: 0,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create workspace: ${error.message}`);
    return this.mapRow(data);
  }

  async findById(id: string, requestingUserId: string): Promise<Workspace> {
    const { data, error } = await this.supabase.db
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Workspace not found.');

    // Tenant isolation — only owners can access their workspace
    if (data.owner_id !== requestingUserId) {
      throw new ForbiddenException('Access denied.');
    }

    return this.mapRow(data);
  }

  /**
   * Increment monthly report count.
   * Called by the compliance pipeline before starting a job.
   */
  async incrementReportCount(workspaceId: string): Promise<void> {
    const { error } = await this.supabase.db.rpc('increment_report_count', {
      workspace_id: workspaceId,
    });

    if (error) {
      this.logger.error(`Failed to increment report count: ${error.message}`);
    }
  }

  /**
   * Check if a workspace is within its plan limits.
   */
  async checkReportLimit(workspaceId: string): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
  }> {
    const { data } = await this.supabase.db
      .from('workspaces')
      .select('plan, monthly_report_count')
      .eq('id', workspaceId)
      .single();

    if (!data) throw new NotFoundException('Workspace not found.');

    const limits: Record<string, number> = {
      free: 3,
      pro: 50,
      enterprise: Infinity,
    };

    const limit = limits[data.plan] ?? 3;
    const used = data.monthly_report_count ?? 0;

    return { allowed: used < limit, used, limit };
  }

  private mapRow(row: any): Workspace {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      plan: row.plan,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      monthlyReportCount: row.monthly_report_count,
      createdAt: row.created_at,
    };
  }
}
