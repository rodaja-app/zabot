import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { EMAIL_PROVIDER } from '../../src/email/email-provider.interface';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WhatsAppProvider } from '../../src/whatsapp/whatsapp-provider.interface';
import { FakeWhatsAppProvider } from './fake-whatsapp.provider';
import { TestEmailProvider } from './test-email.provider';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
  whatsapp: FakeWhatsAppProvider;
  email: TestEmailProvider;
}

/**
 * Sobe o `AppModule` de verdade (mesmas rotas/guards/pipes de produção,
 * `main.ts` como referência) contra Postgres/Redis reais — só troca 3 peças
 * pontuais via override de DI, no mesmo padrão já usado pelo resto do
 * backend para trocar implementação sem tocar em código de negócio:
 *
 *  - `WhatsAppProvider` → `FakeWhatsAppProvider` (sem isso, qualquer teste
 *    que conectasse uma sessão tentaria abrir um socket Baileys de verdade).
 *  - `EMAIL_PROVIDER` → `TestEmailProvider` (captura o código de verificação
 *    em memória em vez de mandar/logar um email de verdade).
 *  - `ThrottlerGuard` (global via `APP_GUARD` em `app.module.ts`) → guard
 *    que sempre libera, para os testes poderem bater várias vezes seguidas
 *    em `/auth/register`, `/auth/confirm-code` etc. (limites de
 *    5-10/min/IP) sem tomar 429 por causa da velocidade do próprio teste,
 *    não de um bug.
 *
 * `rawBody: true` replica o bootstrap de `main.ts` — obrigatório para
 * `plans.e2e-spec.ts` (verificação HMAC do webhook RevenueCat precisa dos
 * bytes crus do corpo). O `ValidationPipe` global também é o mesmo.
 */
export async function buildE2eApp(): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WhatsAppProvider)
    .useClass(FakeWhatsAppProvider)
    .overrideProvider(EMAIL_PROVIDER)
    .useClass(TestEmailProvider)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return {
    app,
    prisma: moduleRef.get(PrismaService),
    whatsapp: moduleRef.get(WhatsAppProvider) as unknown as FakeWhatsAppProvider,
    email: moduleRef.get(EMAIL_PROVIDER) as unknown as TestEmailProvider,
  };
}

/**
 * Popula o catálogo de planos direto (mesmos valores de `prisma/seed.ts`,
 * `upsert` por `key` — idempotente) em vez de depender de `npm run
 * prisma:seed` já ter rodado no banco de teste: os specs que precisam de um
 * plano (campaigns, plans) ficam auto-contidos, sem pré-requisito externo
 * além de "banco migrado com as RLS policies aplicadas".
 */
export async function ensurePlansSeeded(prisma: PrismaService): Promise<void> {
  const plans = [
    { key: 'basico', name: 'Plano Básico', priceLabel: 'R$ 39,90/mês', messagesLimit: 1000, revenueCatProductId: 'zabot_basico_mensal' },
    { key: 'pro', name: 'Plano Pro', priceLabel: 'R$ 99,90/mês', messagesLimit: 5000, revenueCatProductId: 'zabot_pro_mensal' },
    { key: 'premium', name: 'Plano Premium', priceLabel: 'R$ 199,90/mês', messagesLimit: 15000, revenueCatProductId: 'zabot_premium_mensal' },
  ];
  for (const plan of plans) {
    await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
  }
}
