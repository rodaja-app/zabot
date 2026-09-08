import { UnauthorizedException } from '@nestjs/common';
import { ErrorCategory } from './error-category.enum';
import { ProxyError, RateLimitError } from './app-error';
import { categorizeError } from './error-categorizer';

describe('categorizeError', () => {
  it('preserva a categoria de um AppError customizado (proxy)', () => {
    const result = categorizeError(new ProxyError('IP sticky expirado'));
    expect(result.category).toBe(ErrorCategory.PROXY);
    expect(result.statusCode).toBe(502);
  });

  it('categoriza RateLimitError como rate_limit (429)', () => {
    const result = categorizeError(new RateLimitError('limite por sessão excedido'));
    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.statusCode).toBe(429);
  });

  it('categoriza HttpException 401 como autenticacao', () => {
    const result = categorizeError(new UnauthorizedException());
    expect(result.category).toBe(ErrorCategory.AUTENTICACAO);
  });

  it('categoriza erro de rede pelo código (ECONNREFUSED)', () => {
    const err = Object.assign(new Error('conexão recusada'), { code: 'ECONNREFUSED' });
    const result = categorizeError(err);
    expect(result.category).toBe(ErrorCategory.REDE);
    expect(result.statusCode).toBe(502);
  });

  it('categoriza erro de proxy pelo código (EPROXYAUTH)', () => {
    const err = Object.assign(new Error('autenticação de proxy recusada'), {
      code: 'EPROXYAUTH',
    });
    const result = categorizeError(err);
    expect(result.category).toBe(ErrorCategory.PROXY);
  });

  it('categoriza código de erro do Prisma (Pxxxx) como banco_de_dados', () => {
    const err = Object.assign(new Error('unique constraint failed'), { code: 'P2002' });
    const result = categorizeError(err);
    expect(result.category).toBe(ErrorCategory.BANCO_DE_DADOS);
  });

  it('cai em desconhecido quando não reconhece nada', () => {
    const result = categorizeError(new Error('algo bizarro'));
    expect(result.category).toBe(ErrorCategory.DESCONHECIDO);
    expect(result.statusCode).toBe(500);
  });

  it('nunca lança — mesmo recebendo algo que não é um Error', () => {
    expect(() => categorizeError('string qualquer')).not.toThrow();
    expect(() => categorizeError(undefined)).not.toThrow();
    expect(() => categorizeError({ foo: 'bar' })).not.toThrow();
  });
});
