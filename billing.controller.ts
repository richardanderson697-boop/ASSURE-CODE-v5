import {
  Controller,
  Post,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { IsEnum, IsString, IsUrl } from 'class-validator';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { JwtAuthGuard, Public } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

export class CreateCheckoutDto {
  @IsEnum(['pro', 'enterprise'])
  plan: 'pro' | 'enterprise';

  @IsString()
  @IsUrl()
  returnUrl: string;
}

export class CreatePortalDto {
  @IsString()
  @IsUrl()
  returnUrl: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Stripe Checkout session for a plan upgrade',
    description: 'Returns a URL — redirect the user to this URL to complete payment.',
  })
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.createCheckoutSession(
      user.workspaceId,
      user.sub,
      user.email,
      dto.plan,
      dto.returnUrl,
    );
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Stripe Customer Portal session',
    description:
      'Redirects the user to Stripe to manage their subscription, payment methods, and invoices.',
  })
  async createPortal(
    @Body() dto: CreatePortalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.createPortalSession(user.workspaceId, dto.returnUrl);
  }

  /**
   * Stripe sends events here. Must be @Public() — no JWT on webhook calls.
   * IMPORTANT: This endpoint needs the raw body to verify the Stripe signature.
   * Ensure your Express setup preserves raw bodies for this route.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // Don't expose in Swagger — Stripe-facing only
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    await this.billingService.handleWebhook(req.rawBody!, signature);
    return { received: true };
  }
}
