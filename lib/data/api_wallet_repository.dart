import 'package:intl/intl.dart';

import 'api/api_client.dart';
import 'models/recharge_package.dart';
import 'models/recharge_result.dart';
import 'models/wallet.dart';
import 'wallet_repository.dart';

final _currencyFormat =
    NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$', decimalDigits: 2);

/// Implementação real de [WalletRepository] (Etapa 18), falando com o
/// módulo de carteira do backend (`backend/src/wallet/wallet.controller.ts`)
/// — substitui de vez o antigo `plans.controller.ts`/RevenueCat.
class ApiWalletRepository implements WalletRepository {
  ApiWalletRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<Wallet> getBalance() async {
    final body = await _apiClient.get('/wallet') as Map<String, dynamic>;
    return Wallet(balance: body['balance'] as int);
  }

  @override
  Future<List<RechargePackage>> getPackages() async {
    final body = await _apiClient.get('/wallet/packages') as List<dynamic>;
    return body
        .map((e) => _packageFromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<RechargeResult> createRecharge(
    String packageId, {
    String? cardToken,
    String? paymentMethodId,
    String? payerCpf,
  }) async {
    final body = await _apiClient.post('/wallet/recharge', body: {
      'packageId': packageId,
      // Omitido (default 'pix' no backend) quando não é recarga de cartão —
      // mantém o corpo idêntico ao de antes da Etapa 19 para o fluxo Pix.
      if (cardToken != null) ...{
        'paymentMethod': 'card',
        'cardToken': cardToken,
        'paymentMethodId': paymentMethodId,
        'payerCpf': payerCpf,
      },
    }) as Map<String, dynamic>;
    return _resultFromJson(body);
  }

  @override
  Future<String?> getMercadoPagoPublicKey() async {
    final body = await _apiClient.get('/wallet/mercadopago-public-key') as Map<String, dynamic>;
    return body['publicKey'] as String?;
  }

  RechargePackage _packageFromJson(Map<String, dynamic> json) {
    final amountCents = json['amountCents'] as int;
    return RechargePackage(
      id: json['id'] as String,
      priceLabel: _currencyFormat.format(amountCents / 100),
      credits: json['credits'] as int,
      bonusPercent: json['bonusPercent'] as int,
    );
  }

  RechargeResult _resultFromJson(Map<String, dynamic> json) {
    final amountCents = json['amountCents'] as int;
    return RechargeResult(
      transactionId: json['transactionId'] as String,
      status: rechargeStatusFromApi(json['status'] as String),
      credits: json['credits'] as int,
      priceLabel: _currencyFormat.format(amountCents / 100),
      pixQrCode: json['pixQrCode'] as String?,
      pixQrCodeBase64: json['pixQrCodeBase64'] as String?,
    );
  }
}
