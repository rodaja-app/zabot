import { ErrorCategory } from './error-category.enum';

/**
 * Erro base com categoria explícita. Qualquer módulo que já sabe o motivo
 * de um erro (proxy, número inválido, rate limit, entrega não confirmada)
 * lança uma destas em vez de um Error genérico — o categorizador central
 * (error-categorizer.ts) preserva essa categoria em vez de tentar adivinhar.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly details?: Record<string, unknown>,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProxyError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PROXY, details, cause);
  }
}

export class InvalidNumberError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.NUMERO_INVALIDO, details, cause);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.RATE_LIMIT, details, cause);
  }
}

/** Ack 2 (servidor) sem ack 3 (entregue) dentro do prazo — ver README seção 15. */
export class DeliveryUnconfirmedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.ENTREGA_NAO_CONFIRMADA, details, cause);
  }
}

/** Verificação de número (etapa 13) pedida sem um socket Baileys ativo para a sessão — nunca tratado como "número inválido". */
export class SessionNotConnectedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.SESSAO_DESCONECTADA, details, cause);
  }
}

/** Falha do provider de storage de mídia (etapa 14) — S3-compatível fora do ar, credenciais inválidas, disco local sem espaço/permissão etc. */
export class MediaStorageError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.ARMAZENAMENTO, details, cause);
  }
}

/** Etapa 16 — REST API da RevenueCat indisponível, retornou erro, ou `REVENUECAT_SECRET_API_KEY` ausente/inválida. */
export class RevenueCatApiError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}

/** Etapa 16 — webhook da RevenueCat sem header de Authorization esperado, ou (quando configurada) assinatura HMAC inválida/expirada. */
export class RevenueCatWebhookAuthError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}

/** Etapa 16 — usuário sem plano usável (sem `Subscription` ou `status = EXPIRADA`) ou que atingiria `Plan.messagesLimit` com o envio pedido. */
export class UsageLimitExceededError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}
