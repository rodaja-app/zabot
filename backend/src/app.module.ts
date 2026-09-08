import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { envValidationSchema } from './config/env.validation';
import { AppLoggingModule } from './common/logging/logging.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { SecurityModule } from './common/security/security.module';
import { EmailModule } from './email/email.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { ContactsModule } from './contacts/contacts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SendingModule } from './sending/sending.module';
import { PlansModule } from './plans/plans.module';
import { SettingsModule } from './settings/settings.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // Limite global generoso; rotas sensíveis (auth) sobrescrevem com
    // @Throttle() para um limite mais apertado — ver auth.controller.ts.
    // Storage em memória (padrão da lib): correto para uma única réplica da
    // API. Se o deploy no Railway crescer para múltiplas réplicas (seção 10
    // do README), trocar por um ThrottlerStorage com backing em Redis para
    // o contador ser compartilhado entre instâncias.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
    AppLoggingModule,
    PrismaModule,
    SecurityModule,
    EmailModule,
    HealthModule,
    AuthModule,
    WhatsAppModule,
    ContactsModule,
    CampaignsModule,
    SendingModule,
    PlansModule,
    SettingsModule,
    MetricsModule,
  ],
  providers: [
    // Único ponto de captura de erro da API inteira — ver all-exceptions.filter.ts.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Aplica a TODA rota, antes de qualquer outra coisa, para que requestId
    // e contexto de log já existam quando o primeiro log da requisição sair.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
