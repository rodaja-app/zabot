/**
 * Etapa 18 — Testes e2e. Roda como Jest `setupFiles` (jest-e2e.json), ou
 * seja, ANTES de qualquer arquivo `*.e2e-spec.ts` ser importado — condição
 * necessária porque `ConfigModule.forRoot({ validationSchema })` valida
 * `process.env` de forma síncrona no momento em que `app.module.ts` é
 * carregado (primeiro `import` de `AppModule` em qualquer teste, via
 * `utils/e2e-app.ts`). Se estas variáveis fossem setadas só num `beforeAll`,
 * a validação já teria rodado (e provavelmente falhado) antes disso.
 *
 * Valores aqui cobrem só o "fluxo crítico" (auth, campanhas, plans — ver
 * task #79): não tenta ser um `.env` completo, só o suficiente pra esses tês
 * specs subirem o `AppModule` real contra Postgres/Redis locais
 * (`docker-compose up -d postgres redis`, ver README).
 *
 * `DATABASE_URL`/`REDIS_URL` podem ser sobrescritos pelo ambiente de quem
 * roda `npm run test:e2e` (ex.: CI com serviços em outro host) — só caem
 * nestes defaults (mesmas credenciais do `docker-compose.yml` da raiz do
 * backend, banco `zabot_test` dedicado para não colidir com dados de dev
 * local) se ainda não estiverem definidos.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://zabot:zabot@localhost:5432/zabot_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

process.env.JWT_ACCESS_SECRET ??= 'e2e-jwt-access-secret-32-chars-min';
process.env.JWT_REFRESH_SECRET ??= 'e2e-jwt-refresh-secret-32-chars-min';

// 32 bytes em hex (64 caracteres) — exigido por SESSION_ENCRYPTION_KEY
// (Joi.hex().length(64)), mesmo não sendo exercitado pelo fluxo crítico
// (nenhum spec grava auth state real do Baileys — FakeWhatsAppProvider
// substitui o provider inteiro).
process.env.SESSION_ENCRYPTION_KEY ??= 'e2'.repeat(32);

// Reduz ruído de log durante os testes sem violar o enum aceito por
// LOG_LEVEL (fatal/error/warn/info/debug/trace — não há "silent").
process.env.LOG_LEVEL ??= 'error';
process.env.SENTRY_DSN = '';

// Segredo HMAC do webhook RevenueCat (plans.e2e-spec.ts assina o corpo com
// este mesmo valor via RevenueCatWebhookService.verifyHmacSignature).
process.env.REVENUECAT_WEBHOOK_HMAC_SECRET ??= 'e2e-revenuecat-hmac-secret';
// Sem REVENUECAT_WEBHOOK_AUTH_HEADER: verificação básica de Authorization
// fica desligada (comportamento "dev local" documentado em
// RevenueCatWebhookService.verifyRequest), só a assinatura HMAC é exigida.

// Janela de envio sempre aberta — sem isto, SendMessageProcessor reagendaria
// (via TimezoneService.isWithinSendingWindow) sempre que o teste rodar fora
// do horário 8h-20h no fuso do DDD do contato de teste, tornando o teste
// dependente do horário do dia em que roda.
process.env.SEND_WINDOW_START_HOUR = '0';
process.env.SEND_WINDOW_END_HOUR = '24';

// Delays de anti-ban (warmup/mature) reduzidos a ~0 — sem isto, cada envio
// de campanha esperaria de 4 a 45 segundos de verdade (AntiBanService),
// tornando campaigns.e2e-spec.ts lento sem ganhar nenhuma cobertura real
// (a lógica de cálculo do delay já tem teste unitário próprio).
process.env.SEND_WARMUP_MIN_DELAY_MS = '1';
process.env.SEND_WARMUP_MAX_DELAY_MS = '5';
process.env.SEND_MATURE_MIN_DELAY_MS = '1';
process.env.SEND_MATURE_MAX_DELAY_MS = '5';

// Backoff/tentativas da fila de envio reduzidos — só relevante se um teste
// futuro exercitar o caminho de falha definitiva (fora do escopo atual,
// mantido pequeno por segurança/velocidade).
process.env.SEND_BACKOFF_DELAY_MS = '50';
process.env.SEND_MAX_ATTEMPTS = '2';
