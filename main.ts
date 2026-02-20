import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // ── Global Prefix & Versioning ───────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── CORS ────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? ['https://app.assurecode.io', 'https://admin.assurecode.io']
      : '*',
    credentials: true,
  });

  // ── Global Pipes & Filters ──────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,           // Auto-transform primitives (string → number)
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── Swagger ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Assure Code API')
      .setDescription('Compliance automation platform — API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & token management')
      .addTag('workspaces', 'Workspace & team management')
      .addTag('compliance', 'Compliance pipeline & reports')
      .addTag('billing', 'Subscription & billing management')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    console.log(`\n📖 Swagger docs: http://localhost:${process.env.PORT ?? 4000}/api/docs\n`);
  }

  await app.listen(process.env.PORT ?? 4000);
  console.log(`🚀 API Gateway running on port ${process.env.PORT ?? 4000}`);
}

bootstrap();
