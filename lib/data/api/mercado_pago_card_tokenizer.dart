import 'dart:convert';

import 'package:http/http.dart' as http;

/// Bandeiras de cartão suportadas pelo fluxo de recarga com cartão (Etapa
/// 19). O valor de [mercadoPagoPaymentMethodId] é exatamente o que o Mercado
/// Pago espera em `payment_method_id` na cobrança (`POST /v1/payments`, ver
/// backend `mercado-pago-api.service.ts#createCardPayment`) — mesmo valor
/// também usado pelo backend para nada além de repassar adiante (ele não
/// valida bandeira, confia no que o app manda).
enum CardBrand { visa, master, amex, elo, hipercard, unknown }

extension CardBrandMercadoPagoId on CardBrand {
  String? get mercadoPagoPaymentMethodId {
    switch (this) {
      case CardBrand.visa:
        return 'visa';
      case CardBrand.master:
        return 'master';
      case CardBrand.amex:
        return 'amex';
      case CardBrand.elo:
        return 'elo';
      case CardBrand.hipercard:
        return 'hipercard';
      case CardBrand.unknown:
        return null;
    }
  }
}

/// Detecta a bandeira do cartão a partir do BIN (dígitos iniciais do
/// número) — resolvido localmente (tabela fixa de prefixos, a mesma que
/// bandeiras/adquirentes documentam publicamente) em vez de bater na API do
/// Mercado Pago (`/v1/payment_methods/search?bin=...`) só para isso: evita
/// um round-trip de rede a cada tecla digitada no número do cartão.
class CardBrandDetector {
  const CardBrandDetector._();

  static CardBrand detect(String rawCardNumber) {
    final digits = rawCardNumber.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 2) return CardBrand.unknown;

    if (digits.startsWith('4')) return CardBrand.visa;

    final bin2 = digits.substring(0, 2);
    if (bin2 == '34' || bin2 == '37') return CardBrand.amex;

    final bin6 = digits.length >= 6 ? digits.substring(0, 6) : digits;
    if (_isHipercard(bin6, digits)) return CardBrand.hipercard;
    if (_isElo(bin6)) return CardBrand.elo;
    if (_isMastercard(bin2, digits)) return CardBrand.master;

    return CardBrand.unknown;
  }

  static bool _isMastercard(String bin2, String digits) {
    final twoDigit = int.tryParse(bin2);
    if (twoDigit != null && twoDigit >= 51 && twoDigit <= 55) return true;

    if (digits.length < 4) return false;
    final fourDigit = int.tryParse(digits.substring(0, 4));
    return fourDigit != null && fourDigit >= 2221 && fourDigit <= 2720;
  }

  static bool _isHipercard(String bin6, String digits) {
    return bin6 == '606282' || digits.startsWith('3841');
  }

  static const _eloExactBins = {
    '401178', '401179', '431274', '438935', '451416', '457631', '457632',
    '504175', '636297', '636368',
  };

  static bool _isElo(String bin6) {
    if (_eloExactBins.contains(bin6)) return true;

    final n = int.tryParse(bin6);
    if (n == null) return false;

    // Faixas numéricas de BIN da bandeira Elo (tabela pública de ranges).
    if (n >= 506699 && n <= 506778) return true;
    if (n >= 509000 && n <= 509999) return true;
    if (n >= 650031 && n <= 650033) return true;
    if (n >= 650035 && n <= 650051) return true;
    if (n >= 650405 && n <= 650439) return true;
    if (n >= 650485 && n <= 650538) return true;
    if (n >= 650541 && n <= 650598) return true;
    if (n >= 650700 && n <= 650718) return true;
    if (n >= 650720 && n <= 650727) return true;
    if (n >= 650901 && n <= 650920) return true;
    if (n >= 651652 && n <= 651679) return true;
    if (n >= 655000 && n <= 655019) return true;
    if (n >= 655021 && n <= 655058) return true;
    return false;
  }
}

/// Erro de tokenização — cobre tanto falha de rede quanto recusa do Mercado
/// Pago (ex.: número de cartão inválido, CVV com tamanho errado). Sempre
/// tratado na tela como uma mensagem genérica de "verifique os dados do
/// cartão" (nunca expõe o corpo cru da resposta do Mercado Pago na UI).
class CardTokenizationException implements Exception {
  CardTokenizationException(this.message);

  final String message;

  @override
  String toString() => 'CardTokenizationException($message)';
}

/// Cliente para `POST https://api.mercadopago.com/v1/card_tokens` — a
/// tokenização do cartão acontece direto no app, nunca passando pelo
/// backend do ZaBot (dado de cartão em texto puro jamais deve tocar nossa
/// API). Usa `package:http` diretamente (não [ApiClient]: URL base e
/// autenticação diferentes — aqui é a chave pública do Mercado Pago via
/// query string, não o Bearer token do ZaBot).
///
/// A chave pública em si vem de `GET /wallet/mercadopago-public-key`
/// (`ApiWalletRepository.getMercadoPagoPublicKey`), nunca hardcoded no app.
class MercadoPagoCardTokenizer {
  MercadoPagoCardTokenizer({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;

  static const _tokenUrl = 'https://api.mercadopago.com/v1/card_tokens';

  /// Retorna o `id` do token gerado — único valor derivado do cartão que
  /// chega ao backend (`CreateRechargeDto.cardToken`).
  Future<String> tokenize({
    required String publicKey,
    required String cardNumber,
    required String cardholderName,
    required int expirationMonth,
    required int expirationYear,
    required String securityCode,
    required String cpf,
  }) async {
    final uri = Uri.parse(_tokenUrl).replace(queryParameters: {'public_key': publicKey});
    final cardDigits = cardNumber.replaceAll(RegExp(r'\D'), '');
    final cpfDigits = cpf.replaceAll(RegExp(r'\D'), '');

    http.Response response;
    try {
      response = await _http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'card_number': cardDigits,
          'security_code': securityCode,
          'expiration_month': expirationMonth,
          'expiration_year': expirationYear,
          'cardholder': {
            'name': cardholderName,
            'identification': {'type': 'CPF', 'number': cpfDigits},
          },
        }),
      );
    } on Exception catch (e) {
      throw CardTokenizationException('Falha de rede ao tokenizar o cartão: $e');
    }

    Map<String, dynamic>? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>?;
    } on FormatException {
      decoded = null;
    }

    final tokenId = decoded?['id'];
    if (response.statusCode < 200 || response.statusCode >= 300 || tokenId is! String) {
      throw CardTokenizationException('Mercado Pago recusou os dados do cartão.');
    }

    return tokenId;
  }
}
