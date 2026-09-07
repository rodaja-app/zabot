import '../../widgets/status_badge.dart';

/// Item do histórico de pagamentos exibido na Tela Menu (Menu 3).
///
/// Reaproveita [AppStatus] para o badge de cada cobrança: `sent` = paga,
/// `pending` = pendente, `failed` = recusada/falhou.
class PaymentHistoryEntry {
  const PaymentHistoryEntry({
    required this.id,
    required this.dateLabel,
    required this.amountLabel,
    required this.status,
  });

  final String id;
  final String dateLabel;
  final String amountLabel;
  final AppStatus status;
}
