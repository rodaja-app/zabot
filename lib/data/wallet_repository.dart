import 'models/recharge_package.dart';
import 'models/recharge_result.dart';
import 'models/wallet.dart';

/// Abstração da carteira de créditos (Etapa 18, substitui o antigo
/// plano/assinatura do RevenueCat) — saldo, catálogo de pacotes e criação
/// de recarga via Pix. A implementação real ([ApiWalletRepository]) fala
/// com `GET /wallet`, `GET /wallet/packages` e `POST /wallet/recharge`
/// (ver backend `wallet.controller.ts`).
abstract class WalletRepository {
  Future<Wallet> getBalance();

  /// Catálogo fixo de pacotes de recarga (sempre os mesmos 5 tiers).
  Future<List<RechargePackage>> getPackages();

  /// Cria uma cobrança para o pacote [packageId]. Sem os parâmetros de
  /// cartão, cria uma cobrança Pix — retorna o QR/copia-e-cola com
  /// `status = RechargeStatus.pending`, confirmação via polling de
  /// [getBalance] (não há push/socket para isso ainda). Com [cardToken]
  /// preenchido (tokenizado no app via `MercadoPagoCardTokenizer`, nunca
  /// dado de cartão em texto puro), cria uma cobrança de cartão — resposta
  /// já vem síncrona (`status = paid` ou `failed`, ver backend
  /// `wallet.service.ts#createCardRecharge`), sem precisar de polling.
  Future<RechargeResult> createRecharge(
    String packageId, {
    String? cardToken,
    String? paymentMethodId,
    String? payerCpf,
  });

  /// Chave pública do Mercado Pago para tokenizar cartão no app
  /// (`GET /wallet/mercadopago-public-key`) — nunca hardcoded no código-fonte
  /// (ver `MercadoPagoApiService.publicKey` no backend).
  Future<String?> getMercadoPagoPublicKey();
}

class MockWalletRepository implements WalletRepository {
  int _balance = 480;

  final List<RechargePackage> _packages = const [
    RechargePackage(id: 'recarga-20', priceLabel: 'R\$ 20,00', credits: 220, bonusPercent: 10),
    RechargePackage(id: 'recarga-50', priceLabel: 'R\$ 50,00', credits: 600, bonusPercent: 20),
    RechargePackage(id: 'recarga-100', priceLabel: 'R\$ 100,00', credits: 1350, bonusPercent: 35),
    RechargePackage(id: 'recarga-300', priceLabel: 'R\$ 300,00', credits: 4500, bonusPercent: 50),
    RechargePackage(id: 'recarga-500', priceLabel: 'R\$ 500,00', credits: 8250, bonusPercent: 65),
  ];

  @override
  Future<Wallet> getBalance() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return Wallet(balance: _balance);
  }

  @override
  Future<List<RechargePackage>> getPackages() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return List.unmodifiable(_packages);
  }

  @override
  Future<RechargeResult> createRecharge(
    String packageId, {
    String? cardToken,
    String? paymentMethodId,
    String? payerCpf,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    final package = _packages.firstWhere((pkg) => pkg.id == packageId);

    if (cardToken != null) {
      // Cartão é síncrono de verdade (nem no mock faz sentido simular
      // polling) — credita na hora, igual ao backend real.
      _balance += package.credits;
      return RechargeResult(
        transactionId: 'mock-card-${DateTime.now().millisecondsSinceEpoch}',
        status: RechargeStatus.paid,
        credits: package.credits,
        priceLabel: package.priceLabel,
        pixQrCode: null,
        pixQrCodeBase64: null,
      );
    }

    // Simula confirmação automática do pagamento Pix após um tempo, só para
    // o mock ter algum estado observável em telas de desenvolvimento sem
    // backend (o app real depende do webhook do Mercado Pago).
    Future<void>.delayed(const Duration(seconds: 6), () {
      _balance += package.credits;
    });
    return RechargeResult(
      transactionId: 'mock-${DateTime.now().millisecondsSinceEpoch}',
      status: RechargeStatus.pending,
      credits: package.credits,
      priceLabel: package.priceLabel,
      pixQrCode: '00020126360014BR.GOV.BCB.PIX0114mock-copia-e-cola',
      pixQrCodeBase64: null,
    );
  }

  @override
  Future<String?> getMercadoPagoPublicKey() async {
    await Future<void>.delayed(const Duration(milliseconds: 100));
    return 'TEST-mock-public-key';
  }
}
