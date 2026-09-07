import '../../widgets/status_badge.dart';

/// Plano/assinatura do usuário, exibido na Tela Menu (Etapa 6, README.md
/// seção 13).
///
/// Reaproveita [AppStatus] para o badge de status do plano (mesmo padrão já
/// usado em [Campaign]): `connected` = ativo, `pending` = período de teste,
/// `failed` = expirado. O rótulo textual de cada status vem de chaves ARB
/// próprias do Menu, não das chaves de conexão/campanha.
class SubscriptionPlan {
  const SubscriptionPlan({
    required this.name,
    required this.priceLabel,
    required this.status,
    required this.renewalDateLabel,
    required this.messagesUsed,
    required this.messagesLimit,
  });

  final String name;
  final String priceLabel;
  final AppStatus status;
  final String renewalDateLabel;
  final int messagesUsed;
  final int messagesLimit;
}
