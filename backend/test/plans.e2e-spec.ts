import { INestApplication } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { RevenueCatWebhookEvent, RevenueCatWebhookPayload } from '../src/plans/revenuecat-webhook.service';
import { buildE2eApp, ensurePlansSeeded } from './utils/e2e-app';
import { TestEmailProvider } from './utils/test-email.provider';

/**
 * Etapa 18 — fluxo crítico "Plans" (task #79/#86): webhook RevenueCat
 * assinado (HMAC) → `Subscription` atualizada → enforcement de limite de uso
 * (`PlansService.assertWithinUsageLimit`, exercitado via `POST /campaigns`).
 * Sessions/Contacts aqui são só setup mínimo para ter 1 contato VALIDO capaz
 * de gerar 1 `Envio` — sem isso `assertWithinUsageLimit` nunca roda de
 * verdade (`quantity <= 0` é no-op, ver `plans.service.ts`).
 *
 * A assinatura é calculada sobre os bytes CRUS do corpo (`rawBody: true` em
 * `main.ts`/`e2e-app.ts`) — por isso construímos `rawBody` manualmente
 * (`JSON.stringify`) e mandamos essa MESMA string via `.send()`, em vez de
 * deixar o supertest serializar um objeto (que produziria bytes equivalentes
 * mas não necessariamente idênticos, invalidando o HMAC).
 */
describe('Plans (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: TestEmailProvider;
  const createdEmails: string[] = [];
  const hmacSecret = process.env.REVENUECAT_WEBHOOK_HMAC_SECRET as string;

  const uniqueEmail = (label: string): string => {
    const addr = `e2e-${label}-${randomUUID()}@zabot.test`;
    createdEmails.push(addr);
    return addr;
  };

  beforeAll(async () => {
    const ctx = await buildE2eApp();
    app = ctx.app;
    prisma = ctx.prisma;
    email = ctx.email;
    await ensurePlansSeeded(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
  });

  const registerConfirmedUser = async (label: string): Promise<{ userId: string; accessToken: string }> => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail(label);
    await request(server).post('/auth/register').send({ name: `Usuário ${label}`, email: userEmail, password: 'senha-forte-123' }).expect(201);
    const code = email.lastVerificationCodeFor(userEmail);
    const confirmRes = await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) throw new Error(`Usuário ${userEmail} não encontrado após confirmação.`);
    return { userId: user.id, accessToken: confirmRes.body.accessToken as string };
  };

  /** Monta+assina (HMAC v1) um evento RevenueCat e o posta em `/plans/webhook/revenuecat`, exigindo `expectedStatus` (default 201). */
  const postSignedWebhookEvent = async (event: RevenueCatWebhookEvent, expectedStatus = 201) => {
    const server = app.getHttpServer();
    const payload: RevenueCatWebhookPayload = { api_version: '1.0', event };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto.createHmac('sha256', hmacSecret).update(`${timestamp}.${rawBody}`).digest('hex');

    return request(server)
      .post('/plans/webhook/revenuecat')
      .set('Content-Type', 'application/json')
      .set('X-RevenueCat-Webhook-Signature', `t=${timestamp},v1=${signature}`)
      .send(rawBody)
      .expect(expectedStatus);
  };

  it('rejeita webhook sem assinatura HMAC válida (402 — RevenueCatWebhookAuthError, ErrorCategory.PAGAMENTO)', async () => {
    const server = app.getHttpServer();
    const payload: RevenueCatWebhookPayload = {
      api_version: '1.0',
      event: {
        id: randomUUID(),
        type: 'TEST',
        event_timestamp_ms: Date.now(),
        app_user_id: randomUUID(),
      },
    };
    // Timestamp atual (senão cairia em "fora da tolerância" antes mesmo de comparar a assinatura) com um v1 deliberadamente errado.
    const timestamp = Math.floor(Date.now() / 1000).toString();
    await request(server)
      .post('/plans/webhook/revenuecat')
      .set('Content-Type', 'application/json')
      .set('X-RevenueCat-Webhook-Signature', `t=${timestamp},v1=${'0'.repeat(64)}`)
      .send(JSON.stringify(payload))
      .expect(402);
  });

  it('webhook assinado (INITIAL_PURCHASE) atualiza Subscription para o plano correto, refletido em GET /plans/current', async () => {
    const { userId, accessToken } = await registerConfirmedUser('webhook-purchase');
    const server = app.getHttpServer();

    const nowMs = Date.now();
    await postSignedWebhookEvent({
      id: randomUUID(),
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: nowMs,
      app_user_id: userId,
      product_id: 'zabot_pro_mensal',
      period_type: 'NORMAL',
      purchased_at_ms: nowMs,
      expiration_at_ms: nowMs + 30 * 24 * 60 * 60 * 1000,
      store: 'PLAY_STORE',
      environment: 'SANDBOX',
      price: 99.9,
      currency: 'BRL',
      transaction_id: randomUUID(),
      original_transaction_id: randomUUID(),
    });

    const currentPlan = await request(server).get('/plans/current').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(currentPlan.body).toMatchObject({
      planKey: 'pro',
      planName: 'Plano Pro',
      status: 'ATIVA',
      autoRenew: true,
      messagesUsed: 0,
      messagesLimit: 5000,
    });

    // Reentrega do MESMO evento (mesmo id) é idempotente — não duplica nem falha (RevenueCatEvent.id como PK).
    await postSignedWebhookEvent({
      id: (await prisma.revenueCatEvent.findFirstOrThrow({ where: { appUserId: userId } })).id,
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: nowMs,
      app_user_id: userId,
      product_id: 'zabot_pro_mensal',
    });

    const paymentHistory = await request(server).get('/plans/payment-history').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(paymentHistory.body).toHaveLength(1);
    expect(paymentHistory.body[0]).toMatchObject({ status: 'PAGO', amountCents: 9990, currency: 'BRL' });
  });

  it('enforcement: bloqueia criação de campanha quando Subscription (via webhook) já atingiu o limite de mensagens do plano', async () => {
    const { userId, accessToken } = await registerConfirmedUser('usage-limit');
    const server = app.getHttpServer();
    const authHeader = `Bearer ${accessToken}`;
    const nowMs = Date.now();

    // 1. Subscription ativa no plano "basico" (1000 msgs/mês) via webhook assinado — mesmo caminho de produção.
    await postSignedWebhookEvent({
      id: randomUUID(),
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: nowMs,
      app_user_id: userId,
      product_id: 'zabot_basico_mensal',
      period_type: 'NORMAL',
      purchased_at_ms: nowMs,
      expiration_at_ms: nowMs + 30 * 24 * 60 * 60 * 1000,
    });

    // 2. Sessão conectada (fake) + 1 contato VALIDO — sem ao menos 1 destinatário, `assertWithinUsageLimit`
    //    nunca roda de verdade (`quantity <= 0` é no-op), então o teste de enforcement ficaria vazio sem isso.
    await request(server).post('/whatsapp/session/connect').set('Authorization', authHeader).send({}).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300)); // tempo suficiente para o setImmediate do FakeWhatsAppProvider emitir CONECTADA.

    await request(server).post('/contacts/import').set('Authorization', authHeader).send({ rawText: '+5511988887777,Cliente' }).expect(201);

    const deadline = Date.now() + 15_000;
    let contact: { id: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const res = await request(server).get('/contacts').set('Authorization', authHeader).expect(200);
      if (res.body.length > 0 && res.body[0].status !== 'PENDENTE') {
        contact = res.body[0];
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(contact?.status).toBe('VALIDO');

    // 3. Simula uso já no teto do plano (1000/1000) — escreve direto via withTenantContext, mesmo padrão de escrita usado pelo próprio PlansService/webhook.
    await prisma.withTenantContext(userId, (tx) => tx.subscription.updateMany({ where: { userId }, data: { messagesUsed: 1000 } }));

    // 4. 1 destinatário × 1 mensagem = quantity 1 > remaining (0) → UsageLimitExceededError → 402 (error-categorizer.ts, ErrorCategory.PAGAMENTO).
    await request(server)
      .post('/campaigns')
      .set('Authorization', authHeader)
      .send({ messages: ['Esta campanha não deveria ser criada.'] })
      .expect(402);
  });
});
