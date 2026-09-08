import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { ErrorCategory } from './error-category.enum';

export interface CategorizedError {
  category: ErrorCategory;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
  raw: unknown;
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
]);

const PROXY_CODES = new Set(['EPROXYAUTH', 'ERR_PROXY_CONNECTION', 'ERR_INVALID_PROXY']);

/**
 * Ponto único de "por que isso quebrou". Toda função que loga um erro
 * (filtro global da API, listener de fila, listener de sessão/proxy) chama
 * isto em vez de reimplementar a própria lógica de categorização — é o que
 * mantém o log robusto (motivo real, não só "erro") com pouco código
 * espalhado pelo resto do sistema.
 */
export function categorizeError(err: unknown): CategorizedError {
  if (err instanceof AppError) {
    return {
      category: err.category,
      message: err.message,
      statusCode: statusForCategory(err.category),
      details: err.details,
      raw: err,
    };
  }

  if (err instanceof HttpException) {
    const status = err.getStatus();
    const category =
      status === 401 || status === 403
        ? ErrorCategory.AUTENTICACAO
        : status === 400 || status === 422 || status === 409
          ? ErrorCategory.VALIDACAO
          : status === 429
            ? ErrorCategory.RATE_LIMIT
            : ErrorCategory.DESCONHECIDO;
    return { category, message: err.message, statusCode: status, raw: err };
  }

  const code = (err as { code?: string } | undefined)?.code;

  if (code && NETWORK_CODES.has(code)) {
    return {
      category: ErrorCategory.REDE,
      message: (err as Error).message,
      statusCode: 502,
      details: { code },
      raw: err,
    };
  }

  if (code && PROXY_CODES.has(code)) {
    return {
      category: ErrorCategory.PROXY,
      message: (err as Error).message,
      statusCode: 502,
      details: { code },
      raw: err,
    };
  }

  if (typeof code === 'string' && /^P\d{4}$/.test(code)) {
    // Código de erro do Prisma (ex.: P2002 = violação de unicidade).
    return {
      category: ErrorCategory.BANCO_DE_DADOS,
      message: (err as Error).message,
      statusCode: 500,
      details: { code },
      raw: err,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { category: ErrorCategory.DESCONHECIDO, message, statusCode: 500, raw: err };
}

function statusForCategory(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.AUTENTICACAO:
      return 401;
    case ErrorCategory.VALIDACAO:
      return 400;
    case ErrorCategory.RATE_LIMIT:
      return 429;
    case ErrorCategory.NUMERO_INVALIDO:
      return 422;
    case ErrorCategory.PROXY:
    case ErrorCategory.REDE:
      return 502;
    case ErrorCategory.ENTREGA_NAO_CONFIRMADA:
      return 202;
    case ErrorCategory.BANCO_DE_DADOS:
      return 500;
    case ErrorCategory.ARMAZENAMENTO:
      return 500;
    case ErrorCategory.SESSAO_DESCONECTADA:
      return 409;
    case ErrorCategory.PAGAMENTO:
      // Cobre tanto "limite de mensagens do plano atingido" (bloqueio de novo
      // envio) quanto falha de autenticação/assinatura de webhook da
      // RevenueCat — em ambos os casos 402 é mais preciso que 500/401
      // genéricos (nunca é erro do servidor, e não é o JWT do próprio ZaBot).
      return 402;
    default:
      return 500;
  }
}
