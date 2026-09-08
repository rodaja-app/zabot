import { Injectable } from '@nestjs/common';
import { SessionNotConnectedError } from '../../src/common/errors/app-error';
import {
  NumberCheckResult,
  SendMessageParams,
  StartSessionParams,
  WhatsAppProvider,
} from '../../src/whatsapp/whatsapp-provider.interface';

/**
 * Substitui `BaileysWhatsAppProvider` nos testes e2e (override de DI no
 * token `WhatsAppProvider`, ver `utils/e2e-app.ts`) — mesmo padrão descrito
 * no comentário da classe abstrata original ("trocar de implementação... é
 * só prover uma outra classe neste mesmo token de DI").
 *
 * `startSession` "conecta" sem QR/pairing de verdade, emitindo CONECTADA em
 * `this.updates` (herdado de `WhatsAppProvider`) de forma assíncrona
 * (`setImmediate`) para respeitar o mesmo timing que `SessionService.connect`
 * já assume de um provider real: ele registra a sessão como "owned" (mapa
 * `sessionOwners`) e só DEPOIS chama `provider.startSession(...)` — emitir
 * de forma síncrona dentro de `startSession` correria o risco de o handler
 * de update (`SessionService.handleProviderUpdate`) rodar antes desse
 * registro, e ele ignora updates de sessões que ainda não são "owned".
 */
@Injectable()
export class FakeWhatsAppProvider extends WhatsAppProvider {
  private readonly connectedSessions = new Set<string>();
  private readonly invalidCandidates = new Set<string>();
  readonly sentMessages: { sessionId: string; params: SendMessageParams }[] = [];

  async startSession(params: StartSessionParams): Promise<void> {
    this.connectedSessions.add(params.sessionId);
    setImmediate(() => {
      this.updates.next({
        sessionId: params.sessionId,
        status: 'CONECTADA',
        phoneNumber: params.phoneNumber ?? '5511999990000',
      });
    });
  }

  async stopSession(sessionId: string): Promise<void> {
    this.connectedSessions.delete(sessionId);
    this.updates.next({ sessionId, status: 'DESCONECTADA', loggedOut: true });
  }

  async checkNumbers(sessionId: string, candidates: string[]): Promise<NumberCheckResult[]> {
    if (!this.connectedSessions.has(sessionId)) {
      throw new SessionNotConnectedError('Sessão fake não conectada (checkNumbers).', { sessionId });
    }
    return candidates.map((candidate) => ({ candidate, exists: !this.invalidCandidates.has(candidate) }));
  }

  async sendMessage(sessionId: string, params: SendMessageParams): Promise<void> {
    if (!this.connectedSessions.has(sessionId)) {
      throw new SessionNotConnectedError('Sessão fake não conectada (sendMessage).', { sessionId });
    }
    this.sentMessages.push({ sessionId, params });
  }

  /** Testes usam isto para simular um candidato que o WhatsApp real rejeitaria (`exists: false`). */
  markCandidateInvalid(candidate: string): void {
    this.invalidCandidates.add(candidate);
  }

  /** Estado do fake é global ao processo de teste (singleton DI) — limpar entre specs evita vazamento. */
  reset(): void {
    this.connectedSessions.clear();
    this.invalidCandidates.clear();
    this.sentMessages.length = 0;
  }
}
