/**
 * Sem catálogo estático para popular hoje — o antigo seed de planos
 * (RevenueCat/assinatura mensal) foi removido junto com `Plan`/`Subscription`
 * (ver comentário do model `Wallet` em schema.prisma). Carteira de créditos
 * não tem catálogo: `Wallet` é criada sob demanda (saldo 0) na primeira vez
 * que o usuário precisa dela, mesmo padrão de `UserSettings`/`Session`
 * (`getOrCreate*`), nunca por seed.
 *
 * Mantido como no-op (em vez de apagar o arquivo) para não quebrar
 * `npm run prisma:seed` / `prisma db seed` (ver package.json) caso algum
 * catálogo global volte a existir no futuro (ex.: tabela de preços da
 * recarga Pix, se deixar de ser hardcoded no backend).
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Nenhum seed necessário no momento (sem catálogo estático — ver comentário acima).');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao rodar o seed:', err);
  process.exit(1);
});
