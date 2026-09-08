import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsService } from './alerts.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Etapa 17 (Observabilidade avançada). `@Global()` como `EmailModule` —
 * `SendMessageProcessorService` e `SessionGateway` injetam `MetricsService`
 * sem precisar importar este módulo nos respectivos módulos (`SendingModule`,
 * `WhatsAppModule`), desde que `MetricsModule` esteja em `AppModule.imports`.
 *
 * `AlertsService` mora aqui (não em um `AlertsModule` separado) porque é o
 * mesmo domínio — observabilidade — e não precisa ser injetado em nenhum
 * outro módulo: só liga (`OnModuleInit`) o próprio timer interno. Depende de
 * `EMAIL_PROVIDER` (`EmailModule`, também `@Global()`) sem precisar importá-lo
 * aqui, pela mesma razão.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [MetricsController],
  providers: [MetricsService, AlertsService],
  exports: [MetricsService],
})
export class MetricsModule {}
