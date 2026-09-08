import { Controller, Get, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ProxyError } from '../src/common/errors/app-error';
import { ErrorCategory } from '../src/common/errors/error-category.enum';

/**
 * Testa o filtro global de exceção fim a fim via HTTP real (Supertest),
 * mas SEM subir o AppModule de verdade (sem Postgres/Redis) — por isso um
 * controller descartável só para este teste, nunca uma rota de teste na
 * API de produção. Cobre a promessa "sem endpoint exclusivo de teste":
 * aqui quem sobe é um app Nest isolado, a API real nunca ganha rota extra.
 */
@Controller('__test-only')
class ThrowingController {
  @Get('proxy-error')
  throwProxyError(): never {
    throw new ProxyError('IP sticky expirado', { proxyHost: '1.2.3.4:9999' });
  }

  @Get('http-exception')
  throwHttpException(): never {
    throw new UnauthorizedException('token inválido');
  }

  @Get('unknown-error')
  throwUnknown(): never {
    throw new Error('algo bizarro e inesperado');
  }
}

describe('AllExceptionsFilter (e2e isolado)', () => {
  let app: INestApplication;
  const fakeLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: Logger, useValue: fakeLogger },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('categoriza AppError customizado (proxy) e responde 502 com a categoria certa', async () => {
    const res = await request(app.getHttpServer()).get('/__test-only/proxy-error');
    expect(res.status).toBe(502);
    expect(res.body.category).toBe(ErrorCategory.PROXY);
    expect(res.body.message).toBe('IP sticky expirado');
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it('categoriza HttpException nativa (401) corretamente', async () => {
    const res = await request(app.getHttpServer()).get('/__test-only/http-exception');
    expect(res.status).toBe(401);
    expect(res.body.category).toBe(ErrorCategory.AUTENTICACAO);
  });

  it('cai em desconhecido/500 para erro não mapeado, mas ainda responde com JSON estruturado', async () => {
    const res = await request(app.getHttpServer()).get('/__test-only/unknown-error');
    expect(res.status).toBe(500);
    expect(res.body.category).toBe(ErrorCategory.DESCONHECIDO);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.path).toBe('/__test-only/unknown-error');
  });
});
