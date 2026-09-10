import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildE2eApp } from './utils/e2e-app';
import { FakeMercadoPagoApiService } from './utils/fake-mercado-pago-api.provider';
import { TestEmailProvider } from './utils/test-email.provider';

/**
 * Etapa de recarga (carteira de créditos, Pix/Mercado Pago) — fluxo:
 * consultar catálogo → criar cobrança (PENDENTE) → webhook de confirmação
 * credita o saldo → segunda entrega do mesmo webhook não credita de novo
 * (idempotência). `MercadoPagoApiService` é substituído por
 * `FakeMercadoPagoApiService` em `buildE2eApp` — nenhum destes testes chama a
 * API real do Mercado Pago.
 */
describe('Wallet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: TestEmailProvider;
  let mercadoPago: FakeMercadoPagoApiService;
  const createdEmails: string[] = [];

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
    mercadoPago = ctx.mercadoPago;
  });

  afterEach(() => {
    mercadoPago.reset();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
  });

  const registerConfirmedUser = async (label: string): Promise<{ accessToken: string }> => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail(label);

    await request(server)
      .post('/auth/register')
      .send({ name: `Usuário ${label}`, email: userEmail, password: 'senha-forte-123' })
      .expect(201);
    const code = email.lastVerificationCodeFor(userEmail);
    const confirmRes = await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);
    return { accessToken: confirmRes.body.accessToken as string };
  };

  it('lista o catálogo fixo de 5 pacotes de recarga', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await registerConfirmedUser('wallet-packages');

    const res = await request(server)
      .get('/wallet/packages')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(5);
    expect(res.body.find((p: { id: string }) => p.id === 'recarga-20')).toMatchObject({
      amountCents: 2_000,
      credits: 220,
      bonusPercent: 10,
    });
    expect(res.body.find((p: { id: string }) => p.id === 'recarga-500')).toMatchObject({
      amountCents: 50_000,
      credits: 8_250,
      bonusPercent: 65,
    });
  });

  it('cobre o fluxo completo: saldo 0 → criar recarga PENDENTE → webhook aprova → saldo creditado → webhook repetido não credita de novo', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await registerConfirmedUser('wallet-flow');
    const authHeader = `Bearer ${accessToken}`;

    const initialWallet = await request(server).get('/wallet').set('Authorization', authHeader).expect(200);
    expect(initialWallet.body).toEqual({ balance: 0 });

    const rechargeRes = await request(server)
      .post('/wallet/recharge')
      .set('Authorization', authHeader)
      .send({ packageId: 'recarga-20' })
      .expect(201);

    expect(rechargeRes.body).toMatchObject({ status: 'PENDENTE', credits: 220, amountCents: 2_000 });
    expect(rechargeRes.body.pixQrCode).toBeTruthy();

    const fakePaymentId = mercadoPago.lastCreatedPaymentId();
    mercadoPago.markApproved(fakePaymentId);

    await request(server)
      .post(`/wallet/webhook/mercadopago?data.id=${fakePaymentId}`)
      .send({})
      .expect(200);

    const walletAfterWebhook = await request(server).get('/wallet').set('Authorization', authHeader).expect(200);
    expect(walletAfterWebhook.body).toEqual({ balance: 220 });

    // Reentrega do mesmo webhook (documentado como possível pelo próprio
    // Mercado Pago) — idempotente via checagem de status PENDENTE dentro de
    // `WalletService.applyPaymentUpdate`, nunca credita duas vezes.
    await request(server)
      .post(`/wallet/webhook/mercadopago?data.id=${fakePaymentId}`)
      .send({})
      .expect(200);

    const walletAfterSecondWebhook = await request(server).get('/wallet').set('Authorization', authHeader).expect(200);
    expect(walletAfterSecondWebhook.body).toEqual({ balance: 220 });
  });

  it('bloqueia recarga com pacote desconhecido', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await registerConfirmedUser('wallet-bad-package');

    await request(server)
      .post('/wallet/recharge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ packageId: 'recarga-inexistente' })
      .expect(400);
  });

  it('nenhuma rota de carteira (exceto o webhook) funciona sem token', async () => {
    const server = app.getHttpServer();
    await request(server).get('/wallet').expect(401);
    await request(server).get('/wallet/packages').expect(401);
    await request(server).post('/wallet/recharge').send({ packageId: 'recarga-20' }).expect(401);
  });
});
