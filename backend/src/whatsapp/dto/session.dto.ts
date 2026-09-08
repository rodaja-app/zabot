import { SessionStatus } from '@prisma/client';

/**
 * Espelha `ZapSessionInfo` + `ZapConnectionStatus` do front (ver
 * lib/data/models/) — é o retorno de GET /whatsapp/session e o que o
 * gateway WS retransmite a cada mudança. `qr`/`pairingCode` só vêm
 * preenchidos durante o fluxo de conexão (nunca persistidos — ver
 * SessionService.handleProviderUpdate).
 */
export interface SessionDto {
  sessionId: string;
  name: string;
  phoneNumber: string | null;
  status: SessionStatus;
  qr?: string;
  pairingCode?: string;
}

/** Espelha `HomeStats` do front (lib/data/models/home_stats.dart). */
export interface SessionStatsDto {
  contactsImported: number;
  messagesSent: number;
  messagesPending: number;
  failures: number;
}
