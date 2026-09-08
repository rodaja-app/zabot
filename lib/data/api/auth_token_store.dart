import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persistência local dos tokens de sessão (Etapa 18 — integração final).
///
/// O backend emite `{accessToken, refreshToken}` (ver
/// `backend/src/auth/dto/auth-tokens.dto.ts`) em `confirm-code`, `login` e
/// `refresh`. Guardamos em `flutter_secure_storage` (Keychain no iOS/macOS,
/// Keystore no Android) em vez de `SharedPreferences` porque são
/// credenciais de sessão — o refresh token em particular vive até ser
/// rotacionado ou revogado (ver backend README §10, rotação com detecção de
/// reuso), não é um dado qualquer de preferência do app.
///
/// Único ponto do front que sabe onde os tokens ficam guardados — `ApiClient`
/// e `RealtimeClient` só conhecem esta classe, nunca o storage por trás dela.
class AuthTokenStore {
  AuthTokenStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessTokenKey = 'zabot_access_token';
  static const _refreshTokenKey = 'zabot_refresh_token';

  Future<void> save({required String accessToken, required String refreshToken}) async {
    await Future.wait([
      _storage.write(key: _accessTokenKey, value: accessToken),
      _storage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<String?> get accessToken => _storage.read(key: _accessTokenKey);

  Future<String?> get refreshToken => _storage.read(key: _refreshTokenKey);

  /// Usado no boot do app (Etapa 18, tarefa "wiring final") para decidir se
  /// mostra a tela de Login ou pula direto pro app — equivalente ao que hoje
  /// é um bypass "TEMPORÁRIO" fixo em `main.dart`.
  Future<bool> hasSession() async => (await accessToken) != null;

  /// Chamado em `logout()`/`deleteAccount()` (sucesso) e quando um refresh
  /// falha (ver `ApiClient._handleSessionExpired`) — os dois casos em que a
  /// sessão local deixa de ser válida.
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _accessTokenKey),
      _storage.delete(key: _refreshTokenKey),
    ]);
  }
}
