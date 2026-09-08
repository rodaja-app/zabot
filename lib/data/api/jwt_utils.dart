import 'dart:convert';

/// Extrai o claim `sub` (id interno do usuário) de um JWT já emitido pelo
/// backend, sem validar assinatura — Etapa 18 (integração final, compra
/// nativa RevenueCat).
///
/// Uso: o backend identifica o assinante na RevenueCat pelo MESMO id que
/// assina os tokens (`{sub: userId}`, ver `auth.service.ts`/`jwt-auth.guard
/// .ts`) — `RevenueCatApiService.getSubscriber(userId)`. O SDK do
/// RevenueCat (`Purchases.logIn`/`PurchasesConfiguration.appUserID`)
/// precisa desse mesmo id pra que uma compra feita no aparelho seja
/// visível pro backend depois. Não validar a assinatura aqui é seguro:
/// o token só chega até este ponto porque já veio de uma resposta HTTPS
/// do próprio backend (`ApiAuthRepository`/`AuthTokenStore`), e o valor
/// extraído nunca é usado para autorização — isso continua sendo feito
/// pelo backend, a cada request, via `JwtAuthGuard`.
String? subjectFromJwt(String token) {
  final parts = token.split('.');
  if (parts.length != 3) return null;

  try {
    final normalized = base64Url.normalize(parts[1]);
    final payload = jsonDecode(utf8.decode(base64Url.decode(normalized)));
    if (payload is! Map<String, dynamic>) return null;
    return payload['sub'] as String?;
  } on FormatException {
    return null;
  }
}
