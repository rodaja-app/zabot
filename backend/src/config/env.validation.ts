import * as Joi from 'joi';

/**
 * Validação de env na subida do app — falha rápido e com mensagem clara em
 * vez de deixar uma variável faltando quebrar em algum ponto aleatório do
 * código minutos/horas depois (mesma filosofia de "causa real, não erro
 * genérico" aplicada à configuração).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  // Chave AES-256 (32 bytes) em hex — 64 caracteres hex — usada por
  // SessionCryptoService para criptografar em repouso o auth state do
  // Baileys (session_auth_keys). Gerar com: openssl rand -hex 32
  SESSION_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
  // Etapa 18 (checklist de produção). Lista de origens (separadas por
  // vírgula) autorizadas a chamar a API com cookies/credentials via
  // navegador (CORS) — ex.: "https://app.zabot.com,https://admin.zabot.com".
  // Opcional: sem ela, CORS fica fechado (nenhuma origem cross-site
  // autorizada) — o app Flutter nativo não é afetado, pois CORS só existe no
  // navegador. Setar em produção só se houver um cliente web/admin real.
  // Nunca usar "*"/refletir qualquer origem junto com credentials: true —
  // isso permite qualquer site ler respostas autenticadas (main.ts).
  CORS_ORIGIN: Joi.string().allow('').optional(),
  // Identifica esta instância/processo no registro de sharding de sessões
  // (Session.workerId — ver schema.prisma). Opcional: se ausente, cada
  // processo gera um uuid próprio ao subir (suficiente para 1 réplica; ao
  // escalar workers de sessão no Railway, setar um valor estável por
  // serviço/réplica deixa os logs e o registro mais legíveis).
  WORKER_ID: Joi.string().optional(),
  // Proxy por sessão (etapa 12 — README §4). Todos opcionais: sem
  // DATAIMPULSE_HOST, o BaileysWhatsAppProvider conecta direto (sem proxy) —
  // suficiente para dev local sem conta DataImpulse. Uma vez presente,
  // HOST/USERNAME/PASSWORD passam a ser exigidos de fato pelo próprio uso
  // (ProxyConfigService falha com causa clara se só parte estiver setada).
  DATAIMPULSE_HOST: Joi.string().optional(),
  DATAIMPULSE_PORT: Joi.number().optional(),
  DATAIMPULSE_USERNAME: Joi.string().optional(),
  DATAIMPULSE_PASSWORD: Joi.string().optional(),
  // HTTP usa porta 823, SOCKS5 usa 824 (default do DataImpulse) — só precisa
  // setar DATAIMPULSE_PORT se a conta usar portas diferentes das padrão.
  DATAIMPULSE_PROTOCOL: Joi.string().valid('HTTP', 'SOCKS5').default('SOCKS5'),
  // Duração da sessão sticky (mesmo IP) contratada no DataImpulse — padrão
  // 30 min, configurável até 120 min conforme o plano. O worker renova a
  // `stickyKey` (novo IP) um pouco antes deste limite, nunca depois.
  DATAIMPULSE_STICKY_MINUTES: Joi.number().min(1).max(120).default(30),
  // SMTP opcional — sem ele, EmailModule cai no provedor log-only (ver
  // src/email/email.module.ts). Se SMTP_HOST for definido, os demais campos
  // passam a ser esperados pela própria lib (nodemailer) na hora de enviar.
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),
  // Etapa 13 (README raiz §5 passo 2) — máximo de tentativas reais de
  // verificação contra o WhatsApp por contato (cada tentativa testa em lote
  // até N variações de formato numa única chamada `onWhatsApp`). Esgotado
  // sem nenhum candidato confirmado, o contato vira INVALIDO em vez de ficar
  // reenfileirado para sempre.
  CONTACT_MAX_VERIFICATION_ATTEMPTS: Joi.number().min(1).max(10).default(3),
  // Storage de mídia de campanha (etapa 14) — opcional: sem S3_BUCKET, o
  // MediaModule cai no provedor de disco local (ver campaigns.module.ts),
  // suficiente para dev local. S3_ENDPOINT/S3_FORCE_PATH_STYLE só são
  // necessários para S3-compatíveis fora da AWS (Cloudflare R2, MinIO).
  S3_BUCKET: Joi.string().optional(),
  S3_REGION: Joi.string().optional(),
  S3_ENDPOINT: Joi.string().uri().optional(),
  S3_ACCESS_KEY_ID: Joi.string().optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  S3_FORCE_PATH_STYLE: Joi.boolean().optional(),
  // Diretório usado pelo LocalDiskMediaStorageProvider quando S3_BUCKET não
  // está configurado. Padrão: ./data/media (relativo ao cwd do processo).
  // Atenção: no Railway o filesystem não é persistente entre deploys — usar
  // S3-compatível em produção.
  MEDIA_LOCAL_DIR: Joi.string().optional(),
  // Etapa 15 (Fila, envio e anti-ban — README raiz §6/15). O front
  // (`nova_campanha_screen.dart`) não transmite nenhum intervalo hoje (ver
  // backend/README.md "Etapa 15") — estes bounds são a única fonte de
  // verdade do delay humano/jitter entre envios de uma mesma sessão.
  // "WARMUP" vale enquanto a sessão tem menos de SEND_WARMUP_DAYS de criada
  // (Session.createdAt); depois disso valem os bounds "MATURE" (maior
  // vazão). Em ambos os casos o delay real é sorteado uniformemente entre
  // MIN e MAX a cada envio — isso já é o rate limit (concorrência 1 por
  // sessão) e o jitter ao mesmo tempo, sem precisar de um limiter separado.
  SEND_WARMUP_DAYS: Joi.number().min(0).default(3),
  SEND_WARMUP_MIN_DELAY_MS: Joi.number().min(0).default(20_000),
  SEND_WARMUP_MAX_DELAY_MS: Joi.number().min(0).default(45_000),
  SEND_MATURE_MIN_DELAY_MS: Joi.number().min(0).default(4_000),
  SEND_MATURE_MAX_DELAY_MS: Joi.number().min(0).default(12_000),
  // Janela de horário permitida para envio, no fuso LOCAL do contato
  // (derivado do DDD — ver TimezoneService). Fora da janela, o job é
  // reagendado para o próximo início de janela, sem consumir tentativa.
  SEND_WINDOW_START_HOUR: Joi.number().min(0).max(23).default(8),
  SEND_WINDOW_END_HOUR: Joi.number().min(1).max(24).default(20),
  // Tentativas/backoff da fila queue:send-message:<sessionId> — esgotadas,
  // o Envio vira FALHOU definitivo e o job vai para queue:dead-letter (ver
  // SendMessageWorker).
  SEND_MAX_ATTEMPTS: Joi.number().min(1).max(20).default(5),
  SEND_BACKOFF_DELAY_MS: Joi.number().min(0).default(10_000),
  // Etapa 16 (Planos e uso — README raiz §16). `REVENUECAT_SECRET_API_KEY`
  // (dashboard RevenueCat → Project Settings → API Keys → "Secret API Key")
  // autentica `RevenueCatApiService` contra a REST API v1 deles — opcional
  // aqui (Joi) mas `RevenueCatApiService` falha com causa clara se faltar na
  // hora de sincronizar um plano (`POST /plans/sync`). `REVENUECAT_WEBHOOK_AUTH_HEADER`
  // é o valor exigido no header `Authorization` de todo webhook recebido
  // (configurado do lado da RevenueCat, dashboard → Integrations → Webhooks)
  // — verificação básica sempre feita; `REVENUECAT_WEBHOOK_HMAC_SECRET` liga
  // a verificação HMAC opcional e mais forte (`X-RevenueCat-Webhook-Signature`),
  // ver `RevenueCatWebhookService`.
  REVENUECAT_SECRET_API_KEY: Joi.string().optional(),
  REVENUECAT_WEBHOOK_AUTH_HEADER: Joi.string().optional(),
  REVENUECAT_WEBHOOK_HMAC_SECRET: Joi.string().optional(),
  // Etapa 17 (Observabilidade avançada — README raiz §17). `AppInfoService`
  // usa isto para `AppInfo.version` (lib/data/models/app_info.dart) se
  // definido; senão cai no `version` de package.json (mesmo binário, então
  // normalmente coincidem — só existe para permitir sobrescrever sem
  // republish, ex.: hotfix com mesma versão de package.json mas patch
  // identificável para o usuário).
  APP_VERSION: Joi.string().optional(),
  // Protege `GET /metrics` (formato Prometheus, sem dado de usuário mas
  // ainda assim operacional/interno) — se definido, exige
  // `Authorization: Bearer <METRICS_TOKEN>`; sem ele, o endpoint fica aberto
  // (aceitável em dev local; em produção, setar sempre, ou restringir por
  // rede/proxy reverso no Railway).
  METRICS_TOKEN: Joi.string().optional(),
  // AlertsService (README raiz §8, "alertas") — destinatário dos e-mails de
  // alerta operacional (sessão caída, fila travada, taxa de falha alta).
  // Opcional: sem ele, os alertas ainda são logados (warn) e enviados ao
  // Sentry se configurado, só o e-mail é pulado.
  ALERT_EMAIL_TO: Joi.string().email().optional(),
  ALERTS_CHECK_INTERVAL_MS: Joi.number().min(10_000).default(60_000),
  // Não repetir o mesmo alerta (mesma chave, ex. "session_down:<userId>")
  // com mais frequência que isto — evita inbox/log spam enquanto a condição
  // persiste.
  ALERTS_COOLDOWN_MS: Joi.number().min(0).default(30 * 60_000),
  // Sessão com `workerHeartbeatAt` mais velho que isto, e status ≠
  // DESCONECTADA (usuário não pediu para desconectar), dispara alerta.
  ALERT_SESSION_DOWN_MINUTES: Joi.number().min(1).default(10),
  // Envio em PENDENTE (na fila BullMQ) sem transicionar há mais que isto
  // dispara alerta de "fila travada".
  ALERT_STUCK_QUEUE_MINUTES: Joi.number().min(1).default(15),
  // Proporção de FALHOU entre os envios concluídos na janela abaixo, acima
  // da qual dispara alerta de "taxa de falha alta" — só avaliada se houver
  // pelo menos ALERT_FAILURE_RATE_MIN_SAMPLES envios concluídos na janela
  // (evita alerta com amostra pequena, ex. 1 de 1 falhou).
  ALERT_FAILURE_RATE_THRESHOLD: Joi.number().min(0).max(1).default(0.3),
  ALERT_FAILURE_RATE_WINDOW_MINUTES: Joi.number().min(1).default(30),
  ALERT_FAILURE_RATE_MIN_SAMPLES: Joi.number().min(1).default(10),
});
