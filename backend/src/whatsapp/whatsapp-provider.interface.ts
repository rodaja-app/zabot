import { Observable, Subject } from 'rxjs';

export interface StartSessionParams {
  sessionId: string;
  userId: string;
  /** Se presente, usa fluxo de pareamento por código; senão, fluxo de QR. */
  phoneNumber?: string;
}

export type SessionRuntimeStatus = 'CONECTANDO' | 'CONECTADA' | 'DESCONECTADA';

export interface SessionConnectionUpdate {
  sessionId: string;
  status: SessionRuntimeStatus;
  /** Número confirmado pelo WhatsApp após conectar (com DDI, só dígitos). */
  phoneNumber?: string;
  /** Data URL (`data:image/png;base64,...`) pronta para exibir na tela. */
  qr?: string;
  /** Código de pareamento de 8 caracteres (fluxo por número, sem QR). */
  pairingCode?: string;
  /** Causa categorizada da queda/desconexão — nunca genérica (ver README). */
  disconnectReason?: string;
  /**
   * true = queda definitiva (logout confirmado pelo WhatsApp, sessão
   * substituída por outro dispositivo, ou credenciais inválidas): o auth
   * state já foi apagado, reconectar exige QR/pareamento novo. false/undefined
   * = queda temporária, reconexão automática já foi agendada pelo provider.
   */
  loggedOut?: boolean;
}

/** Resultado de uma verificação de existência no WhatsApp (etapa 13 — README raiz §5 passo 3). `candidate` é só dígitos (DDI+DDD+assinante), sem sufixo de JID. */
export interface NumberCheckResult {
  candidate: string;
  exists: boolean;
}

/**
 * Um arquivo de mídia pronto para envio (etapa 15 — já lido do
 * `MediaStorageProvider` pelo chamador, este módulo nunca fala com storage
 * diretamente). `type` decide a categoria de mensagem Baileys (imagem,
 * áudio, documento) — ver comentário em `BaileysWhatsAppProvider.sendMessage`
 * sobre por que a legenda (`caption`) só vai no primeiro item.
 */
export interface OutgoingMedia {
  buffer: Buffer;
  mimeType: string;
  type: 'IMAGENS' | 'AUDIO' | 'DOCUMENTO';
  /** Só usado para DOCUMENTO — nome de arquivo exibido no WhatsApp. */
  filename?: string;
}

/**
 * Parâmetros de um envio único (etapa 15 — README raiz §6/15). `to` é o
 * mesmo formato de `candidate` em `NumberCheckResult` (DDI+DDD+assinante, só
 * dígitos, sem `@s.whatsapp.net` — a conversão pra JID é responsabilidade do
 * provider). `media` é a lista de anexos da campanha (0+, todos do mesmo
 * `type` — ver `CampaignsService.adoptMedia`), só relevante na mensagem de
 * ordem 0 de cada destinatário (ver `SendMessageProcessor`).
 */
export interface SendMessageParams {
  to: string;
  text?: string;
  media?: OutgoingMedia[];
}

/**
 * Camada de abstração entre o resto do backend e a lib que fala com o
 * WhatsApp de verdade (README §1: "permite trocar de provedor no futuro sem
 * afetar o resto do sistema"). `SessionService` e o gateway conhecem só esta
 * classe — nunca importam nada de `@whiskeysockets/baileys` diretamente.
 * Trocar de implementação (ex.: WhatsApp Cloud API oficial, ou um fake nos
 * testes e2e da etapa 18) é só prover uma outra classe neste mesmo token de
 * DI, sem tocar em SessionService/controller/gateway.
 */
export abstract class WhatsAppProvider {
  protected readonly updates = new Subject<SessionConnectionUpdate>();

  /** Stream único de eventos de conexão de todas as sessões ativas neste processo. */
  readonly connectionUpdates$: Observable<SessionConnectionUpdate> = this.updates.asObservable();

  /** Abre (ou reabre) o socket da sessão. Idempotente: se já ativa, não faz nada. */
  abstract startSession(params: StartSessionParams): Promise<void>;

  /** Encerra a sessão deliberadamente (ação do usuário) — equivale a um logout. */
  abstract stopSession(sessionId: string): Promise<void>;

  /**
   * Verifica em uma única chamada em lote (README §5 passo 3) quais dos
   * candidatos (dígitos DDI+DDD+assinante, sem `@s.whatsapp.net`) existem de
   * fato no WhatsApp — usado pelo motor de contatos (etapa 13) para parar na
   * primeira variação que bater, sem uma chamada por candidato. Lança
   * `SessionNotConnectedError` (categoria `sessao_desconectada`) se a sessão
   * não tiver um socket ativo agora — nunca silenciosamente retorna tudo
   * como inexistente, isso seria confundir "não pude checar" com "não existe".
   */
  abstract checkNumbers(sessionId: string, candidates: string[]): Promise<NumberCheckResult[]>;

  /**
   * Envia uma mensagem (texto e/ou mídia) para um único destinatário (etapa
   * 15 — README raiz §6: "Worker consome o job... envia a mensagem via
   * sessão WhatsApp"). Lança `SessionNotConnectedError` (categoria
   * `sessao_desconectada`) se a sessão não tiver socket ativo agora — o
   * chamador (`SendMessageProcessor`) trata isso como falha recuperável
   * (a própria fila reagenda com backoff, mesmo padrão de `checkNumbers`).
   * Qualquer outra falha (rede, rejeição do WhatsApp etc.) é propagada como
   * veio do Baileys, sem mascarar a causa — a fila decide reciclar/desistir
   * pelo número de tentativas, nunca pelo tipo de erro (ver
   * `SendMessageWorker`).
   */
  abstract sendMessage(sessionId: string, params: SendMessageParams): Promise<void>;
}
