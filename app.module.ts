import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ComplianceModule } from './compliance/compliance.module';
import { BillingModule } from './billing/billing.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    // ── Config (loads .env) ────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Rate Limiting ──────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL', 60),
          limit: config.get<number>('THROTTLE_LIMIT', 30),
        },
      ],
    }),

    // ── Redis / BullMQ ─────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 200,
        },
      }),
    }),

    // ── Feature Modules ────────────────────────────────────
    AuthModule,
    WorkspacesModule,
    ComplianceModule,
    BillingModule,
    QueueModule,
  ],
})
export class AppModule {}
