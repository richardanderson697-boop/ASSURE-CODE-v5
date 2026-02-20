import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub: string;          // Supabase user ID
  email: string;
  workspaceId: string;  // Active workspace
  plan: 'free' | 'pro' | 'enterprise';
  iat: number;
  exp: number;
}

/**
 * Extracts the authenticated user from the request.
 * Usage: @CurrentUser() user: JwtPayload
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
