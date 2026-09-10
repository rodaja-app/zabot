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
      // `err.details` sozinho escondia a causa raiz de erros encadeados (ex.:
      // SmtpEmailProvider embrulha a falha real do nodemailer num AppError —
      // sem isto, o log só mostrava "Falha ao enviar email via SMTP", nunca
      // o ECONNREFUSED/ETIMEDOUT/EAUTH que de fato explica o motivo).
      details: { ...err.details, ...describeCause(err.cause) },
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
    return { category, message: extractHttpExceptionMessage(err), statusCode: status, raw: err };
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

/**
 * O `ValidationPipe` global (main.ts) lança `BadRequestException(errors)`
 * onde `errors` é um array de mensagens (uma por regra de `class-validator`
 * violada, ex.: "Senha deve ter ao menos 8 caracteres."). Como o array não é
 * uma string, `HttpException.initMessage()` não o usa como `.message` — cai
 * no fallback genérico do nome da classe ("Bad Request Exception"),
 * escondendo o motivo real que o front precisa mostrar ao usuário. Aqui
 * extraímos a mensagem de verdade direto do corpo da resposta
 * (`err.getResponse()`), já que é lá que o array realmente está.
 */
function extractHttpExceptionMessage(err: HttpException): string {
  const response = err.getResponse();
  if (typeof response === 'string') return response;

  const message = (response as Record<string, unknown>)?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string') return message;

  return err.message;
}

/**
 * Extrai `message`/`code` da causa original de um `AppError` (ex.: erro cru
 * do nodemailer/driver de rede) para o log — sem isto, erros encadeados só
 * mostravam a mensagem genérica do `AppError` que os embrulha, escondendo o
 * motivo real (ECONNREFUSED, ETIMEDOUT, EAUTH etc.).
 */
function describeCause(cause: unknown): Record<string, unknown> {
  if (!cause) return {};
  const code = (cause as { code?: string } | undefined)?.code;
  const message = cause instanceof Error ? cause.message : undefined;
  if (!code && !message) return {};
  return {
    causeCode: code,
    causeMessage: message,
  };
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
      // Cobre tanto "saldo insuficiente na carteira" (bloqueio de criação de
      // campanha, InsufficientBalanceError) quanto falha ao criar/consultar
      // cobrança Pix ou webhook do Mercado Pago com assinatura/header
      // inválido (PixPaymentError) — em ambos os casos 402 é mais preciso
      // que 500/401 genéricos (nunca é erro do servidor, e não é o JWT do
      // próprio ZaBot).
      return 402;
    default:
      return 500;
  }
}
