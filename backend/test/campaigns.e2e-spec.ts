import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildE2eApp, ensurePlansSeeded } from './utils/e2e-app';
import { FakeWhatsAppProvider } from './utils/fake-whatsapp.provider';
import { TestEmailProvider } from './utils/test-email.provider';

/**
 * Etapa 18 — fluxo crítico "Campanhas" (task #79/#85): sessão fake
 * conectada → importar/validar contatos → criar campanha → worker processa
 * (via `FakeWhatsAppProvider`) → status ENVIADA. Sessions/Contacts não são
 * suites separadas por decisão do usuário — só passos de setup aqui.
 *
 * Requer uma `Subscription` ativa (`assertWithinUsageLimit`,
 * `plans.service.ts`) — sem ela `POST /campaigns` sempre falharia com
 * `UsageLimitExceededError` antes mesmo de chegar no envio, então o teste
 * semeia uma diretamente via `prisma.withTenantContext` (mesmo padrão de
 * escrita usado pelo `PlansService`/webhook — RLS exige tenant context).
 */
describe('Campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: TestEmailProvider;
  let whatsapp: FakeWhatsAppProvider;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string): string => {
    const addr = `e2e-${label}-${randomUUID()}@zabot.test`;
    createdEmails.push(addr);
    return addr;
  };

  /** Polling genérico — várias etapas aqui dependem de fila BullMQ (Redis real) processando de forma assíncrona. */
  const waitUntil = async <T>(fn: () => Promise<T>, predicate: (value: T) => boolean, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<T> => {
    const timeoutMs = opts?.timeoutMs ?? 15_000;
    const intervalMs = opts?.intervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (predicate(value)) return value;
      if (Date.now() > deadline) {
        throw new Error(`waitUntil: timeout após ${timeoutMs}ms. Último valor: ${JSON.stringify(value)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };

  beforeAll(async () => {
    const ctx = await buildE2eApp();
    app = ctx.app;
    prisma = ctx.prisma;
    email = ctx.email;
    whatsapp = ctx.whatsapp;
    await ensurePlansSeeded(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
  });

  /** Registra+confirma um usuário e semeia uma Subscription ATIVA no plano `pro` (5000 msgs) — sem isso `createCampaign` rejeita por `UsageLimitExceededError`. */
  const registerConfirmedUserWithActiveSubscription = async (label: string): Promise<{ userId: string; accessToken: string; userEmail: string }> => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail(label);

    await request(server)
      .post('/auth/register')
      .send({ name: `Usuário ${label}`, email: userEmail, password: 'senha-forte-123' })
      .expect(201);
    const code = email.lastVerificationCodeFor(userEmail);
    const confirmRes = await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);
    const accessToken = confirmRes.body.accessToken as string;

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) throw new Error(`Usuário ${userEmail} não encontrado após confirmação.`);

    const plan = await prisma.plan.findUnique({ where: { key: 'pro' } });
    if (!plan) throw new Error('Plano "pro" não encontrado — ensurePlansSeeded não rodou?');

    await prisma.withTenantContext(user.id, (tx) =>
      tx.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'ATIVA',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    );

    return { userId: user.id, accessToken, userEmail };
  };

  it('cobre o fluxo completo: sessão conectada → importar/validar contatos → criar campanha → worker envia → ENVIADA', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await registerConfirmedUserWithActiveSubscription('campaign-flow');
    const authHeader = `Bearer ${accessToken}`;

    // 1. Conectar sessão (fire-and-forget, 202) — FakeWhatsAppProvider emite CONECTADA via setImmediate.
    await request(server).post('/whatsapp/session/connect').set('Authorization', authHeader).send({}).expect(202);

    await waitUntil(
      () => request(server).get('/whatsapp/session').set('Authorization', authHeader).expect(200).then((r) => r.body),
      (session) => session.status === 'CONECTADA',
    );

    // 2. Importar contato — FakeWhatsAppProvider.checkNumbers aceita qualquer candidato não marcado inválido.
    await request(server)
      .post('/contacts/import')
      .set('Authorization', authHeader)
      .send({ rawText: '+5511988887777,João' })
      .expect(201);

    const validatedContact = await waitUntil(
      () => request(server).get('/contacts').set('Authorization', authHeader).expect(200).then((r) => r.body),
      (contacts) => contacts.length > 0 && contacts[0].status !== 'PENDENTE',
    ).then((contacts) => contacts[0]);

    expect(validatedContact.status).toBe('VALIDO');
    expect(validatedContact.phone).toBe('+5511988887777');

    // 3. Criar campanha — sem recipientIds, envia para todos os contatos VALIDO (aqui, só 1).
    const createRes = await request(server)
      .post('/campaigns')
      .set('Authorization', authHeader)
      .send({ messages: ['Olá {ID1}, tudo bem?'] })
      .expect(201);
    expect(createRes.body).toHaveLength(1);
    const campaignId = createRes.body[0].id as string;
    expect(createRes.body[0].recipientCount).toBe(1);

    // 4. Worker (SendMessageWorker, fila real por sessão) processa e a campanha vira ENVIADA.
    type CampaignListItem = { id: string; status: string; pendingCount: number; sentCount: number; failedCount: number };
    const sentCampaign = await waitUntil(
      () =>
        request(server)
          .get('/campaigns')
          .set('Authorization', authHeader)
          .expect(200)
          .then((r) => (r.body as CampaignListItem[]).find((c) => c.id === campaignId)),
      (campaign) => campaign?.status === 'ENVIADA',
    );
    expect(sentCampaign?.pendingCount).toBe(0);
    expect(sentCampaign?.sentCount).toBe(1);
    expect(sentCampaign?.failedCount).toBe(0);

    // 5. A mensagem realmente "chegou" no fake provider, já personalizada com o {ID1} do contato (João).
    const sent = whatsapp.sentMessages.find((m) => m.params.text?.includes('João'));
    expect(sent).toBeDefined();
    expect(sent?.params.text).toBe('Olá João, tudo bem?');
  });

  it('bloqueia criação de campanha sem plano ativo (limite de uso, sem Subscription)', async () => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail('no-sub');

    await request(server).post('/auth/register').send({ name: 'Sem Plano', email: userEmail, password: 'senha-forte-123' }).expect(201);
    const code = email.lastVerificationCodeFor(userEmail);
    const confirmRes = await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);
    const authHeader = `Bearer ${confirmRes.body.accessToken}`;

    // Sem Subscription semeada — createCampaign deve rejeitar antes de qualquer envio.
    // UsageLimitExceededError → ErrorCategory.PAGAMENTO → 402 (error-categorizer.ts).
    await request(server)
      .post('/campaigns')
      .set('Authorization', authHeader)
      .send({ messages: ['Mensagem qualquer'] })
      .expect(402);
  });
});
