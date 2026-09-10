import 'dotenv/config';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * `CORS_ORIGIN` (env, opcional) — lista separada por vírgula de origens
 * autorizadas a chamar a API via navegador com credentials. Vazio/ausente =
 * nenhuma origem cross-site autorizada (seguro por padrão; não afeta o app
 * Flutter nativo, que não passa por CORS). Ver env.validation.ts.
 */
function resolveCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

async function bootstrap(): Promise<void> {
  // `rawBody: true` preserva os bytes crus do corpo em `request.rawBody` para
  // TODAS as rotas, além do parse normal em `request.body` — reservado para
  // a verificação de assinatura do webhook de pagamento Pix/Mercado Pago
  // (carteira de créditos), que precisa assinar exatamente os bytes
  // recebidos, não uma reserialização.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Headers de segurança padrão (HSTS, X-Content-Type-Options, no-sniff,
  // X-Frame-Options etc.) — API pura (sem HTML servido), então o CSP default
  // do helmet não tem efeito prático aqui, mas não atrapalha.
  app.use(helmet());

  // Necessário atrás de proxy reverso (Railway) para o Express enxergar o IP
  // real do cliente via X-Forwarded-For — sem isso, o ThrottlerGuard conta
  // rate limit por IP do proxy (um só, compartilhado por todo mundo) em vez
  // de por cliente real.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Nunca refletir qualquer origem (`origin: true`) junto com
  // `credentials: true` — isso permitiria qualquer site ler respostas
  // autenticadas via navegador. Só as origens explicitamente listadas em
  // CORS_ORIGIN (se houver) recebem `Access-Control-Allow-Origin`; o app
  // Flutter nativo não passa por CORS e não é afetado.
  const corsOrigins = resolveCorsOrigins();
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : false, credentials: true });
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  logger.log(`ZaBot backend rodando na porta ${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Falha na subida do app — antes do Pino existir, então console é o único
  // canal disponível; ainda assim loga a causa real, não silencia.
  // eslint-disable-next-line no-console
  console.error('Falha ao iniciar o backend:', err);
  process.exit(1);
});
