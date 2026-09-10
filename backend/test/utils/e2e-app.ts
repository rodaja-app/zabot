import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { EMAIL_PROVIDER } from '../../src/email/email-provider.interface';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MercadoPagoApiService } from '../../src/wallet/mercado-pago-api.service';
import { WhatsAppProvider } from '../../src/whatsapp/whatsapp-provider.interface';
import { FakeMercadoPagoApiService } from './fake-mercado-pago-api.provider';
import { FakeWhatsAppProvider } from './fake-whatsapp.provider';
import { TestEmailProvider } from './test-email.provider';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
  whatsapp: FakeWhatsAppProvider;
  email: TestEmailProvider;
  mercadoPago: FakeMercadoPagoApiService;
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
 *  - `MercadoPagoApiService` → `FakeMercadoPagoApiService` (sem isso,
 *    `WalletService.createRecharge` chamaria a API REAL do Mercado Pago com
 *    as credenciais de produção do `.env`, criando uma cobrança Pix de
 *    verdade a cada teste).
 *
 * `rawBody: true` replica o bootstrap de `main.ts` — reservado para a
 * verificação de assinatura do webhook de pagamento Pix/Mercado Pago
 * (carteira de créditos), que vai precisar dos bytes crus do corpo. O
 * `ValidationPipe` global também é o mesmo.
 */
export async function buildE2eApp(): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WhatsAppProvider)
    .useClass(FakeWhatsAppProvider)
    .overrideProvider(EMAIL_PROVIDER)
    .useClass(TestEmailProvider)
    .overrideProvider(MercadoPagoApiService)
    .useClass(FakeMercadoPagoApiService)
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
    mercadoPago: moduleRef.get(MercadoPagoApiService) as unknown as FakeMercadoPagoApiService,
  };
}

/**
 * Credita a carteira de um usuário direto via `withTenantContext` (RLS exige
 * tenant context — mesmo padrão de escrita que `CampaignsService.debitWalletOrThrow`
 * usa em produção, só que somando em vez de subtraindo). `upsert` porque o
 * usuário pode nunca ter tido uma `Wallet` ainda (criada sob demanda, nunca
 * no cadastro) — specs que precisam de saldo (campaigns) ficam
 * auto-contidos, sem depender de um seed externo.
 */
export async function creditWalletForTests(prisma: PrismaService, userId: string, credits: number): Promise<void> {
  await prisma.withTenantContext(userId, (tx) =>
    tx.wallet.upsert({
      where: { userId },
      update: { balance: { increment: credits } },
      create: { userId, balance: credits },
    }),
  );
}
