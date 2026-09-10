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

/** Carteira/créditos (substitui o antigo modelo de assinatura RevenueCat) — saldo insuficiente para cobrir a campanha inteira ("tudo ou nada": nenhum envio parcial é enfileirado), ou webhook de pagamento Pix/Mercado Pago com assinatura inválida. */
export class InsufficientBalanceError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}

/** Cobrança Pix/Mercado Pago: falha ao criar o pagamento na API deles, credenciais ausentes/inválidas, ou webhook com assinatura/header inválido. */
export class PixPaymentError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}

/** Cartão de crédito recusado pelo Mercado Pago (`status: 'rejected'`) — mensagem carrega o `status_detail` (ex.: saldo insuficiente, CVV inválido) para o app mostrar algo específico em vez de um erro genérico. */
export class CardPaymentRejectedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, ErrorCategory.PAGAMENTO, details, cause);
  }
}
