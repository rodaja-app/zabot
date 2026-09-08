import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  campaignId?: string;
  contactId?: string;
  jobId?: string;
  [key: string]: unknown;
}

/**
 * Singleton de módulo — de propósito fora do DI do Nest. O mixin do Pino e
 * qualquer worker/listener (fila BullMQ, sessão WhatsApp/proxy) importam
 * isso direto, sem depender da árvore de injeção estar montada. É o que
 * permite todo log carregar sessão/campanha/contato automaticamente sem
 * repetir esse contexto em cada `logger.error(...)` do sistema.
 */
export const requestContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext {
  return requestContextStorage.getStore() ?? {};
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  const parent = getLogContext();
  return requestContextStorage.run({ ...parent, ...context }, fn);
}

export function setLogContext(patch: LogContext): void {
  const store = requestContextStorage.getStore();
  if (store) Object.assign(store, patch);
}
