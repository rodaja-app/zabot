import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildE2eApp } from './utils/e2e-app';
import { TestEmailProvider } from './utils/test-email.provider';

/**
 * Etapa 18 — fluxo crítico "Auth" (task #79): registro→código→confirmação→
 * login→refresh (com detecção de reuso)→logout→me, mais isolamento de RLS
 * entre dois usuários via `Contact` (o recurso RLS-protegido mais simples
 * de exercitar — sessão/campanha teriam overhead desnecessário só para
 * provar isolamento de dado).
 *
 * Sobe o `AppModule` real contra Postgres/Redis (ver `utils/e2e-app.ts`) —
 * requer `docker-compose up -d postgres redis` e migrations aplicadas
 * (README "Testes e2e").
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: TestEmailProvider;
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
  });

  afterAll(async () => {
    // Cascade (schema.prisma) cuida de VerificationCode/RefreshToken/Contact
    // etc. — `users` não tem RLS (ver README RLS), então um delete direto
    // (sem withTenantContext) é suficiente para limpar tudo que os testes
    // deste arquivo criaram.
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
  });

  it('cobre o fluxo completo: registro → confirmação → login → refresh → reuso detectado → logout → me', async () => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail('flow');
    const password = 'senha-forte-123';

    // 1. Registro
    await request(server)
      .post('/auth/register')
      .send({ name: 'Fluxo Completo', email: userEmail, password })
      .expect(201);

    // 2. Confirmação com o código capturado pelo TestEmailProvider
    const code = email.lastVerificationCodeFor(userEmail);
    const confirmRes = await request(server)
      .post('/auth/confirm-code')
      .send({ email: userEmail, code })
      .expect(200);
    expect(confirmRes.body.accessToken).toEqual(expect.any(String));
    expect(confirmRes.body.refreshToken).toEqual(expect.any(String));

    // 3. GET /auth/me com o access token da confirmação (login automático pós-confirmação)
    const meAfterConfirm = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${confirmRes.body.accessToken}`)
      .expect(200);
    expect(meAfterConfirm.body).toEqual({ name: 'Fluxo Completo', email: userEmail });

    // 4. Login normal (nova sessão, tokens diferentes dos da confirmação)
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(200);
    expect(loginRes.body.refreshToken).not.toBe(confirmRes.body.refreshToken);

    // 5. Refresh rotaciona o par
    const refreshRes = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);
    expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);

    // 6. Reapresentar o refresh token já rotacionado (reuso) é rejeitado...
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    // ...e revoga a família inteira: o token novo (passo 5), ainda não usado,
    // também deixa de funcionar (AuthService.refresh — detecção de reuso).
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);

    // 7. Logout é best-effort e sempre 204, mesmo com refresh token inválido
    await request(server).post('/auth/logout').send({ refreshToken: refreshRes.body.refreshToken }).expect(204);

    // 8. Sem token, /auth/me é 401
    await request(server).get('/auth/me').expect(401);
  });

  it('rejeita login com senha errada e confirm-code com código errado', async () => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail('bad-creds');

    await request(server)
      .post('/auth/register')
      .send({ name: 'Credenciais', email: userEmail, password: 'senha-correta-123' })
      .expect(201);

    await request(server)
      .post('/auth/confirm-code')
      .send({ email: userEmail, code: '000000' })
      .expect(401);

    const code = email.lastVerificationCodeFor(userEmail);
    await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);

    await request(server)
      .post('/auth/login')
      .send({ email: userEmail, password: 'senha-errada' })
      .expect(401);
  });

  it('rejeita cadastro duplicado para email já confirmado (409)', async () => {
    const server = app.getHttpServer();
    const userEmail = uniqueEmail('dup');

    await request(server)
      .post('/auth/register')
      .send({ name: 'Original', email: userEmail, password: 'senha-forte-123' })
      .expect(201);
    const code = email.lastVerificationCodeFor(userEmail);
    await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);

    await request(server)
      .post('/auth/register')
      .send({ name: 'Duplicado', email: userEmail, password: 'outra-senha-123' })
      .expect(409);
  });

  it('isola dados entre usuários via RLS (Contact de um usuário nunca aparece para o outro)', async () => {
    const server = app.getHttpServer();
    const emailA = uniqueEmail('rls-a');
    const emailB = uniqueEmail('rls-b');

    const registerAndLogin = async (userEmail: string, name: string): Promise<string> => {
      await request(server).post('/auth/register').send({ name, email: userEmail, password: 'senha-forte-123' }).expect(201);
      const code = email.lastVerificationCodeFor(userEmail);
      const res = await request(server).post('/auth/confirm-code').send({ email: userEmail, code }).expect(200);
      return res.body.accessToken as string;
    };

    const tokenA = await registerAndLogin(emailA, 'Usuário A');
    const tokenB = await registerAndLogin(emailB, 'Usuário B');

    await request(server)
      .post('/contacts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ phone: '+5511988887777', customFields: {} })
      .expect(201);

    await request(server)
      .post('/contacts')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ phone: '+5511977776666', customFields: {} })
      .expect(201);

    const listA = await request(server).get('/contacts').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const listB = await request(server).get('/contacts').set('Authorization', `Bearer ${tokenB}`).expect(200);

    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].phone).toBe('+5511988887777');
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].phone).toBe('+5511977776666');
  });
});
