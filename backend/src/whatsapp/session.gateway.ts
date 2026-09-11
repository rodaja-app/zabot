import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { CampaignStatus } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { Server, Socket } from 'socket.io';
import { MetricsService } from '../metrics/metrics.service';
import { SessionEvent, SessionService, SessionStats } from './session.service';

/**
 * Payload incremental de progresso de campanha (etapa 18) — subconjunto de
 * `CampaignDto` (campaigns/dto/campaign.dto.ts): só os campos que
 * `applyRecipientOutcome` de fato recalcula a cada transição de destinatário.
 * Definido aqui (não importado de `campaigns/`) para não criar dependência
 * de módulo — `WhatsAppModule` não conhece `CampaignsModule`/`SendingModule`,
 * só o inverso.
 */
export interface CampaignProgressEvent {
  id: string;
  status: CampaignStatus;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
}

/**
 * Canal de tempo real de sessão (README §3/13: QR code, pareamento, status
 * de conexão, estatísticas do resumo) — substitui o polling que o front
 * mock faz hoje (`statusStream`/`sessionStream`/`statsStream` da
 * `MockConnectionRepository`, todos `Stream`s locais). Net-new: não existe
 * no contrato atual de `ConnectionRepository` porque o mock não fala com
 * rede nenhuma; a futura `ApiConnectionRepository` (etapa 18) é quem
 * consome este socket e alimenta esses mesmos `Stream`s no front, sem
 * exigir mudança nas telas.
 *
 * Autenticação manual (mesmo padrão de `JwtAuthGuard`, sem
 * `@nestjs/passport`): o handshake do socket.io não passa pelo pipeline de
 * guards HTTP, então o access token (`auth.token` do cliente socket.io) é
 * verificado aqui, uma vez, na conexão. Cada usuário entra numa "room"
 * própria (`user:<id>`) — forma mais simples do socket.io de garantir que
 * um usuário nunca receba evento de outro, sem precisar filtrar manualmente
 * a cada emissão.
 *
 * Adaptador padrão do socket.io (em memória, um processo) — correto
 * enquanto a API roda em 1 réplica. Se o deploy no Railway crescer para
 * múltiplas réplicas (mesma ressalva já registrada em app.module.ts para o
 * ThrottlerStorage), `emit`/`to(room)` só alcançam clients conectados NESTA
 * réplica — nesse ponto entra um adapter com backing em Redis
 * (`@socket.io/redis-adapter`) para as rooms serem compartilhadas entre
 * processos. Não implementado agora por não haver múltiplas réplicas ainda.
 */
@WebSocketGateway({ namespace: 'whatsapp', cors: { origin: true, credentials: true } })
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly sessionService: SessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
    private readonly metrics: MetricsService,
  ) {
    this.sessionService.events$.subscribe((event) => this.emitSessionEvent(event));
    this.sessionService.statsEvents$.subscribe(({ userId, ...stats }) => this.emitStats(userId, stats));
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.authenticate(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    await client.join(roomFor(userId));
    // O cliente só pode pedir QR/código depois de estar na room. Sem este
    // sinal, o POST podia chegar entre o handshake WebSocket e o `join`, e o
    // primeiro evento transitório de QR/pareamento era perdido.
    client.emit('session_ready');
  }

  handleDisconnect(): void {
    // Nada a fazer — socket.io já remove o client de todas as rooms sozinho
    // ao desconectar; nenhum estado deste gateway é por-conexão.
  }

  /** Usado por outros serviços (ex.: futuros motores de contatos/envio) que já têm o snapshot pronto e só precisam publicar. */
  emitStats(userId: string, stats: SessionStats): void {
    this.server.to(roomFor(userId)).emit('stats', stats);
  }

  /**
   * Etapa 18 (integração final) — progresso "ao vivo" de campanha
   * (`campaignsStream` da `MessageRepository` do front, hoje simulado
   * localmente por `MockMessageRepository`). Chamado por
   * `SendMessageProcessorService.applyRecipientOutcome`, o único ponto que já
   * fazia a transição real de `Campaign.sentCount/pendingCount/failedCount` —
   * evento incremental (não a campanha inteira) porque `messages`/`mediaType`
   * não mudam depois de criada; a `ApiMessageRepository` do front funde este
   * delta na lista local por `id`, mesmo espírito de "atualização
   * incremental" do README raiz §6.
   */
  emitCampaignProgress(userId: string, progress: CampaignProgressEvent): void {
    this.server.to(roomFor(userId)).emit('campaign_progress', progress);
  }

  private emitSessionEvent(event: SessionEvent): void {
    const { userId, ...payload } = event;
    this.server.to(roomFor(userId)).emit('session', payload);
    // Etapa 17 — gauge `zabot_sessions_by_status` (README raiz §17):
    // alimentado aqui (não por polling) porque este já é o único ponto por
    // onde toda mudança de `SessionRuntimeStatus` passa, para qualquer
    // usuário, nesta réplica.
    this.metrics.recordSessionStatus(userId, payload.status);
  }

  private authenticate(client: Socket): string | undefined {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      this.logger.warn(
        { event: 'whatsapp_ws_auth_missing_token', socketId: client.id },
        'Conexão WebSocket rejeitada — token de acesso ausente no handshake',
      );
      return undefined;
    }

    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      return payload.sub;
    } catch (err) {
      this.logger.warn(
        { event: 'whatsapp_ws_auth_invalid_token', socketId: client.id, err },
        'Conexão WebSocket rejeitada — token de acesso inválido ou expirado',
      );
      return undefined;
    }
  }
}

function roomFor(userId: string): string {
  return `user:${userId}`;
}
