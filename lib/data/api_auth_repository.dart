import 'api/api_client.dart';
import 'api/api_exception.dart';
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
    // reaproveitada silenciosamente, não gera conflito). Propaga a exceção
    // (ApiException/ApiNetworkException) — `cadastro_screen.dart` trata os
    // dois casos (409 → "email já cadastrado", resto → erro de rede/conexão).
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
  }

  @override
  Future<void> deleteAccount() async {
    // Ao contrário de logout(), aqui NÃO absorvemos erro: só limpamos a
    // sessão local depois de confirmar que a conta foi excluída de verdade
    // no backend — best-effort seria perigoso numa ação destrutiva (usuário
    // acharia que excluiu a conta e ela continuaria existindo no servidor).
    await _apiClient.delete('/auth/account');
    await _apiClient.tokenStore.clear();
  }
}
