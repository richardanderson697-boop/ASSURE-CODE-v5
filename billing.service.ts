import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SupabaseService } from '../common/supabase.service';

type PlanTier = 'pro' | 'enterprise';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-09-30.acacia',
    });
  }

  /**
   * Create a Stripe Checkout session for a plan upgrade.
   * Returns a URL to redirect the user to.
   */
  async createCheckoutSession(
    workspaceId: string,
    userId: string,
    userEmail: string,
    plan: PlanTier,
    returnUrl: string,
  ): Promise<{ checkoutUrl: string }> {
    const priceId = plan === 'pro'
      ? this.config.getOrThrow<string>('STRIPE_PRO_PRICE_ID')
      : this.config.getOrThrow<string>('STRIPE_ENTERPRISE_PRICE_ID');

    // Get or create Stripe customer
    const customerId = await this.getOrCreateCustomer(workspaceId, userId, userEmail);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${returnUrl}?status=cancelled`,
      metadata: { workspaceId, userId, plan },
      subscription_data: {
        metadata: { workspaceId, userId },
      },
    });

    this.logger.log(`Checkout session created for workspace ${workspaceId} (plan: ${plan})`);

    return { checkoutUrl: session.url! };
  }

  /**
   * Create a Stripe Customer Portal session for managing subscriptions.
   */
  async createPortalSession(
    workspaceId: string,
    returnUrl: string,
  ): Promise<{ portalUrl: string }> {
    const { data: workspace } = await this.supabase.db
      .from('workspaces')
      .select('stripe_customer_id')
      .eq('id', workspaceId)
      .single();

    if (!workspace?.stripe_customer_id) {
      throw new BadRequestException('No billing account found for this workspace.');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: workspace.stripe_customer_id,
      return_url: returnUrl,
    });

    return { portalUrl: session.url };
  }

  /**
   * Handle incoming Stripe webhooks.
   * Verifies signature, then routes to appropriate handler.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Webhook error: ${err.message}`);
    }

    this.logger.log(`Received Stripe event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }
  }

  // ── Private Handlers ──────────────────────────────────────

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const workspaceId = session.metadata?.workspaceId;
    const plan = session.metadata?.plan;

    if (!workspaceId || !plan) return;

    await this.supabase.db
      .from('workspaces')
      .update({
        plan,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        monthly_report_count: 0, // Reset on upgrade
      })
      .eq('id', workspaceId);

    this.logger.log(`Workspace ${workspaceId} upgraded to ${plan}.`);
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const workspaceId = subscription.metadata?.workspaceId;
    if (!workspaceId) return;

    const priceId = subscription.items.data[0]?.price?.id;
    const proPriceId = this.config.get<string>('STRIPE_PRO_PRICE_ID');
    const plan = priceId === proPriceId ? 'pro' : 'enterprise';

    await this.supabase.db
      .from('workspaces')
      .update({ plan })
      .eq('id', workspaceId);

    this.logger.log(`Workspace ${workspaceId} plan updated to ${plan}.`);
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const workspaceId = subscription.metadata?.workspaceId;
    if (!workspaceId) return;

    await this.supabase.db
      .from('workspaces')
      .update({
        plan: 'free',
        stripe_subscription_id: null,
      })
      .eq('id', workspaceId);

    this.logger.log(`Workspace ${workspaceId} downgraded to free (subscription cancelled).`);
  }

  private async getOrCreateCustomer(
    workspaceId: string,
    userId: string,
    email: string,
  ): Promise<string> {
    const { data: workspace } = await this.supabase.db
      .from('workspaces')
      .select('stripe_customer_id')
      .eq('id', workspaceId)
      .single();

    if (workspace?.stripe_customer_id) return workspace.stripe_customer_id;

    const customer = await this.stripe.customers.create({
      email,
      metadata: { workspaceId, userId },
    });

    await this.supabase.db
      .from('workspaces')
      .update({ stripe_customer_id: customer.id })
      .eq('id', workspaceId);

    return customer.id;
  }
}
