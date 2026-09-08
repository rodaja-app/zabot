/// Erro lançado por [MenuRepository.changePlan] quando a compra nativa
/// (RevenueCat) não é concluída — Etapa 18 (integração final).
///
/// Extensão deliberada sobre o contrato mockado original: no mock, trocar
/// de plano nunca falhava; na integração real, a compra passa pela folha de
/// pagamento nativa da loja (App Store/Play Store), que o usuário pode
/// cancelar a qualquer momento — isso é comportamento normal, não um erro
/// de rede, e a tela precisa distinguir os dois casos ([cancelled]) sem
/// depender de tipos do SDK do RevenueCat (`PurchasesErrorCode` fica só em
/// `ApiMenuRepository`, nunca vaza pra `menu_screen.dart`).
class PlanPurchaseException implements Exception {
  const PlanPurchaseException({required this.cancelled, this.message});

  /// `true` quando o próprio usuário cancelou a compra na folha nativa —
  /// nesse caso a tela não deve mostrar nenhum erro, só sair do fluxo.
  final bool cancelled;

  final String? message;

  @override
  String toString() =>
      'PlanPurchaseException(cancelled: $cancelled, message: $message)';
}
