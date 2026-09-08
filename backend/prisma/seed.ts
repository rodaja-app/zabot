import { PrismaClient } from '@prisma/client';

/**
 * Etapa 16 (Planos e uso) — popula o catálogo ESTÁTICO de planos (ver
 * comentário do model `Plan` em schema.prisma). `upsert` por `key` torna o
 * script idempotente: rodar de novo depois de ajustar um preço/limite só
 * atualiza a linha existente, nunca duplica.
 *
 * `revenueCatProductId` aqui são placeholders — trocar pelos `product_id`
 * reais configurados no dashboard da RevenueCat (Products) antes de ir para
 * produção; não há como o backend adivinhar esse valor (ele é definido do
 * lado da RevenueCat/lojas, não neste projeto).
 *
 * Rodar com: npm run prisma:seed (ver package.json — usa `prisma db seed`,
 * que por sua vez chama este arquivo via ts-node).
 */
const PLANS = [
  {
    key: 'basico',
    name: 'Plano Básico',
    priceLabel: 'R$ 39,90/mês',
    messagesLimit: 1000,
    revenueCatProductId: 'zabot_basico_mensal',
  },
  {
    key: 'pro',
    name: 'Plano Pro',
    priceLabel: 'R$ 99,90/mês',
    messagesLimit: 5000,
    revenueCatProductId: 'zabot_pro_mensal',
  },
  {
    key: 'premium',
    name: 'Plano Premium',
    priceLabel: 'R$ 199,90/mês',
    messagesLimit: 15000,
    revenueCatProductId: 'zabot_premium_mensal',
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const plan of PLANS) {
      await prisma.plan.upsert({
        where: { key: plan.key },
        update: plan,
        create: plan,
      });
    }
    // eslint-disable-next-line no-console
    console.log(`Seed de planos concluído (${PLANS.length} planos).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao rodar o seed de planos:', err);
  process.exit(1);
});
