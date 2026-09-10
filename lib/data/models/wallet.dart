/// Saldo de créditos do usuário (`GET /wallet`, ver backend
/// `wallet.dto.ts#WalletDto`). Substitui o antigo `SubscriptionPlan` —
/// não há mais plano/assinatura mensal, só um saldo pré-pago em créditos
/// que nunca expira (1 crédito = 1 envio de mensagem enfileirado).
class Wallet {
  const Wallet({required this.balance});

  /// Saldo atual em créditos inteiros (espelha `WalletDto.balance`).
  final int balance;
}
