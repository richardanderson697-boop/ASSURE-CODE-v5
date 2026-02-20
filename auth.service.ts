import {
  Injectable,
  UnauthorizedException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../common/supabase.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Exchange a Supabase access token for an Assure Code JWT.
   * The client (web app) calls Supabase Auth directly, then
   * passes the resulting token here to get a scoped JWT that
   * includes workspaceId and plan tier.
   */
  async exchangeToken(supabaseAccessToken: string): Promise<{
    accessToken: string;
    user: { id: string; email: string };
  }> {
    // 1. Verify the Supabase token and get the user
    const { data: { user }, error } = await this.supabase.db.auth.getUser(
      supabaseAccessToken,
    );

    if (error || !user) {
      throw new UnauthorizedException('Invalid Supabase token.');
    }

    // 2. Look up the user's workspace and plan
    const { data: workspace, error: wsError } = await this.supabase.db
      .from('workspaces')
      .select('id, plan')
      .eq('owner_id', user.id)
      .single();

    if (wsError || !workspace) {
      throw new BadRequestException(
        'No workspace found for this user. Complete onboarding first.',
      );
    }

    // 3. Mint our own JWT with workspace context
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email!,
      workspaceId: workspace.id,
      plan: workspace.plan,
    };

    const accessToken = this.jwt.sign(payload);

    this.logger.log(`Token issued for user ${user.id} (workspace: ${workspace.id})`);

    return {
      accessToken,
      user: { id: user.id, email: user.email! },
    };
  }

  /**
   * Verify a raw JWT string (used internally for WebSocket/SSE auth).
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token verification failed.');
    }
  }
}
