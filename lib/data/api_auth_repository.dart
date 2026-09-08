import 'package:purchases_flutter/purchases_flutter.dart';

import 'api/api_client.dart';
import 'api/api_exception.dart';
import 'api/jwt_utils.dart';
import 'auth_repository.dart';

/// Implementação real de [AuthRepository] (Etapa 18 — integração final),
/// substituindo [MockAuthRepository] sem exigir nenhuma mudança nas telas de
/// Cadastro/Confirmação/Login/Menu — mesmo contrato imutável documentado em
/// `auth_repository.dart`. Rotas mapeadas 1:1 com
/// `backend/src/auth/auth.controller.ts`.
class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<void> register({
    required String name,
    required String email,
    required String password,
  }) async {
    // Backend responde 409 (ConflictException) quando já existe conta
    // CONFIRMADA com este email (AuthService.register — conta pendente é
    // reaproveitada silenciosamente, não gera conflito). A tela de Cadastro
    // ainda não trata nenhum erro aqui (o mock nunca lançava, ver
    // `cadastro_screen.dart`), então por ora isto só propaga a exceção; sinalizado
    // como pendência para a tarefa de wiring final (Etapa 18).
    await _apiClient.post('/auth/register', body: {
      'name': name,
      'email': email,
      'password': password,
    });
  }

  @override
  Future<void> resendCode({required String email}) async {
    await _apiClient.post('/auth/resend-code', body: {'email': email});
  }

  @override
  Future<bool> confirmCode({required String email, required String code}) async {
    try {
      final body = await _apiClient.post('/auth/confirm-code', body: {
        'email': email,
        'code': code,
      }) as Map<String, dynamic>;
      final accessToken = body['accessToken'] as String;
      await _apiClient.tokenStore.save(
        accessToken: accessToken,
        refreshToken: body['refreshToken'] as String,
      );
      await _identifyRevenueCat(accessToken);
      return true;
    } on ApiException catch (e) {
      // 401 é a resposta do backend para código errado/expirado/tentativas
      // excedidas (AuthService.confirmCode) — mesmo "código inválido"
      // genérico que a tela já mostra para o mock quando `confirmCode`
      // retorna `false`. Qualquer outro erro (rede, 5xx) propaga, porque não
      // é isso que `false` significa aqui.
      if (e.isAuthError) return false;
      rethrow;
    }
  }

  @override
  Future<bool> login({required String email, required String password}) async {
    try {
      final body = await _apiClient.post('/auth/login', body: {
        'email': email,
        'password': password,
      }) as Map<String, dynamic>;
      final accessToken = body['accessToken'] as String;
      await _apiClient.tokenStore.save(
        accessToken: accessToken,
        refreshToken: body['refreshToken'] as String,
      );
      await _identifyRevenueCat(accessToken);
      return true;
    } on ApiException catch (e) {
      // 401 cobre email inexistente, senha errada e conta ainda não
      // confirmada (AuthService.login) — os três viram o mesmo
      // "credenciais inválidas" genérico que a tela já mostra para o mock.
      if (e.isAuthError) return false;
      rethrow;
    }
  }

  @override
  Future<void> logout() async {
    final refreshToken = await _apiClient.tokenStore.refreshToken;
    try {
      await _apiClient.post('/auth/logout', body: {
        if (refreshToken != null) 'refreshToken': refreshToken,
      });
    } on Exception {
      // Logout é best-effort tanto no backend quanto aqui (ver
      // `LogoutDto`/`AuthService.logout`, README backend §10) — o que
      // importa é o app esquecer a sessão local; não vale travar a tela de
      // Menu (`_handleLogout`, que sempre navega pro Login depois do
      // await) por causa de uma falha de rede numa ação que o usuário já
      // decidiu fazer.
    }
    await _apiClient.tokenStore.clear();
    await _forgetRevenueCat();
  }

  @override
  Future<void> deleteAccount() async {
    // Ao contrário de logout(), aqui NÃO absorvemos erro: só limpamos a
    // sessão local depois de confirmar que a conta foi excluída de verdade
    // no backend — best-effort seria perigoso numa ação destrutiva (usuário
    // acharia que excluiu a conta e ela continuaria existindo no servidor).
    await _apiClient.delete('/auth/account');
    await _apiClient.tokenStore.clear();
    await _forgetRevenueCat();
  }

  /// Identifica o SDK do RevenueCat com o MESMO id interno (`sub` do JWT)
  /// que o backend usa pra buscar o assinante (`RevenueCatApiService
  /// .getSubscriber`, ver doc de `ApiMenuRepository`) — sem isso, uma compra
  /// feita logo após login/confirmação ficaria anônima pro RevenueCat e
  /// nunca seria encontrada pelo backend. Best-effort: um token sem `sub`
  /// decodificável (não deveria acontecer, o backend sempre assina com
  /// `sub`) não pode travar o login por causa de um SDK de pagamento.
  Future<void> _identifyRevenueCat(String accessToken) async {
    final userId = subjectFromJwt(accessToken);
    if (userId == null) return;
    try {
      await Purchases.logIn(userId);
    } on Exception {
      // Falha aqui não impede o login (rede indisponível, SDK não
      // configurado etc.) — a compra ainda funcionaria depois, na tela de
      // Menu, contanto que o SDK já esteja configurado a essa altura
      // (`main.dart` também tenta identificar no boot quando já há sessão).
    }
  }

  /// Best-effort: gera um novo id anônimo no RevenueCat pro próximo usuário
  /// que fizer login neste aparelho não herdar a identidade do anterior.
  Future<void> _forgetRevenueCat() async {
    try {
      await Purchases.logOut();
    } on Exception {
      // Sem sessão ativa no RevenueCat (ex.: usuário nunca abriu a tela de
      // Menu) é um erro esperado do SDK, não um problema — logout local já
      // aconteceu de qualquer forma.
    }
  }
}
