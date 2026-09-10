/// Pacote de recarga do catálogo fixo (`GET /wallet/packages`, ver backend
/// `recharge-packages.ts`) — 5 tiers discretos com bônus progressivo, nunca
/// um valor livre. `priceLabel` já vem formatado em Reais (ex.: "R$ 20,00")
/// para exibição direta na lista de pacotes, seguindo o mesmo padrão de
/// `PaymentHistoryEntry.amountLabel`.
class RechargePackage {
  const RechargePackage({
    required this.id,
    required this.priceLabel,
    required this.credits,
    required this.bonusPercent,
  });

  /// Id estável do pacote (ex.: "recarga-20") — enviado de volta em
  /// `POST /wallet/recharge`.
  final String id;
  final String priceLabel;
  final int credits;
  final int bonusPercent;
}
