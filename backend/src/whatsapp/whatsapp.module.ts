import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BaileysWhatsAppProvider } from './baileys-whatsapp.provider';
import { ProxyConfigService } from './proxy-config.service';
import { SessionController } from './session.controller';
import { SessionGateway } from './session.gateway';
import { SessionService } from './session.service';
import { WhatsAppProvider } from './whatsapp-provider.interface';

/**
 * Etapa 11 (Sessões WhatsApp — README §3/13). `WhatsAppProvider` é o token
 * de DI que o resto do backend conhece; `BaileysWhatsAppProvider` é a única
 * implementação hoje (troca de provedor futura = só mudar este `useClass`,
 * ver comentário em whatsapp-provider.interface.ts). `JwtModule.register({})`
 * repete o padrão de auth.module.ts: sem segredo/TTL fixos aqui porque
 * `SessionGateway` só *verifica* o access token (mesmo segredo/algoritmo do
 * `JwtAuthGuard`), nunca emite um novo.
 */
@Module({
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [SessionController],
  providers: [
    { provide: WhatsAppProvider, useClass: BaileysWhatsAppProvider },
    ProxyConfigService,
    SessionService,
    SessionGateway,
  ],
  // WhatsAppProvider exportado a partir da etapa 13 — ContactsModule precisa
  // dele para `checkNumbers()` (verificação de número), sem reabrir a
  // abstração: continua sendo o único token de DI conhecido fora deste módulo.
  // SessionGateway exportado a partir da etapa 18 — `SendMessageProcessorService`
  // (SendingModule, que já importa este módulo) reaproveita o mesmo socket/room
  // por usuário para emitir progresso de campanha em tempo real, em vez de abrir
  // um segundo canal WebSocket.
  exports: [SessionService, WhatsAppProvider, SessionGateway],
})
export class WhatsAppModule {}
