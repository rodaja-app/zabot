import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'auth_token_store.dart';

/// Wrapper HTTP fino sobre `package:http` — único ponto do front que
/// conhece a URL base do backend, o formato de erro do `AllExceptionsFilter`
/// e a rotação de refresh token. Todo `Api*Repository` (Etapa 18) usa esta
/// classe em vez de falar com `http` diretamente, do mesmo jeito que hoje
/// nenhuma tela fala com um repositório de mock além da interface abstrata.
///
/// URL base configurável via `--dart-define=API_BASE_URL=...` — usar para
/// apontar pro backend local (`main.ts`: sem prefixo global, porta 3000)
/// durante desenvolvimento. Sem o dart-define, o padrão é o backend de
/// produção no Railway.
class ApiClient {
  ApiClient({
    http.Client? httpClient,
    AuthTokenStore? tokenStore,
    String? baseUrl,
    this.onSessionExpired,
  })  : _http = httpClient ?? http.Client(),
        tokenStore = tokenStore ?? AuthTokenStore(),
        baseUrl = baseUrl ??
            const String.fromEnvironment(
              'API_BASE_URL',
              defaultValue: 'https://zabot-production.up.railway.app',
            );

  final http.Client _http;
  final AuthTokenStore tokenStore;
  final String baseUrl;

  /// Chamado quando um refresh automático falha (refresh token também
  /// inválido/expirado/revogado — ex.: reuso detectado, logout em outro
  /// aparelho). É a única forma deste client — que não conhece
  /// `Navigator`/telas — avisar o resto do app para forçar volta ao Login;
  /// wiring feito na tarefa "wiring final" (main.dart).
  void Function()? onSessionExpired;

  Future<dynamic> get(String path, {Map<String, String>? query}) => _send('GET', path, query: query);

  Future<dynamic> post(String path, {Object? body}) => _send('POST', path, body: body);

  Future<dynamic> patch(String path, {Object? body}) => _send('PATCH', path, body: body);

  Future<dynamic> delete(String path, {Object? body}) => _send('DELETE', path, body: body);

  /// Upload multipart (mídia de campanha — `ApiMessageRepository`, Etapa 18).
  Future<dynamic> postMultipart(
    String path, {
    required List<http.MultipartFile> files,
    Map<String, String>? fields,
  }) =>
      _sendMultipart(path, files: files, fields: fields);

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool isRetry = false,
  }) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final accessToken = await tokenStore.accessToken;
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    };

    http.Response response;
    try {
      response = await _dispatch(method, uri, headers, body);
    } on ApiNetworkException {
      rethrow;
    } on Exception catch (e) {
      throw ApiNetworkException(e.toString());
    }

    if (response.statusCode == 401 && !isRetry && await _tryRefresh()) {
      return _send(method, path, query: query, body: body, isRetry: true);
    }

    return _decode(response);
  }

  Future<http.Response> _dispatch(
    String method,
    Uri uri,
    Map<String, String> headers,
    Object? body,
  ) {
    final encoded = body == null ? null : jsonEncode(body);
    switch (method) {
      case 'GET':
        return _http.get(uri, headers: headers);
      case 'POST':
        return _http.post(uri, headers: headers, body: encoded);
      case 'PATCH':
        return _http.patch(uri, headers: headers, body: encoded);
      case 'DELETE':
        return _http.delete(uri, headers: headers, body: encoded);
      default:
        throw ArgumentError('Método HTTP não suportado: $method');
    }
  }

  Future<dynamic> _sendMultipart(
    String path, {
    required List<http.MultipartFile> files,
    Map<String, String>? fields,
    bool isRetry = false,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final accessToken = await tokenStore.accessToken;

    final request = http.MultipartRequest('POST', uri)..files.addAll(files);
    if (fields != null) request.fields.addAll(fields);
    if (accessToken != null) request.headers['Authorization'] = 'Bearer $accessToken';

    http.Response response;
    try {
      final streamed = await _http.send(request);
      response = await http.Response.fromStream(streamed);
    } on Exception catch (e) {
      throw ApiNetworkException(e.toString());
    }

    if (response.statusCode == 401 && !isRetry && await _tryRefresh()) {
      return _sendMultipart(path, files: files, fields: fields, isRetry: true);
    }

    return _decode(response);
  }

  dynamic _decode(http.Response response) {
    final hasBody = response.bodyBytes.isNotEmpty;
    final decoded = hasBody ? jsonDecode(utf8.decode(response.bodyBytes)) : null;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    if (decoded is Map<String, dynamic>) {
      throw ApiException.fromResponseBody(response.statusCode, decoded);
    }
    throw ApiException(
      statusCode: response.statusCode,
      category: 'DESCONHECIDO',
      message: 'Ocorreu um erro inesperado (${response.statusCode}).',
    );
  }

  /// Tenta rotacionar o refresh token (backend README §10). Só retorna
  /// `true` se um novo par de tokens foi salvo com sucesso — caso contrário
  /// limpa a sessão local e avisa [onSessionExpired], já que um refresh
  /// malsucedido normalmente significa token revogado/expirado de vez (não
  /// vale a pena tentar de novo sozinho).
  Future<bool> _tryRefresh() async {
    final refreshToken = await tokenStore.refreshToken;
    if (refreshToken == null) {
      await _handleSessionExpired();
      return false;
    }

    try {
      final response = await _http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (response.statusCode != 200) {
        await _handleSessionExpired();
        return false;
      }
      final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      await tokenStore.save(
        accessToken: body['accessToken'] as String,
        refreshToken: body['refreshToken'] as String,
      );
      return true;
    } on Exception {
      // Erro de rede durante o refresh (não uma rejeição do backend) — não
      // limpa a sessão, pode ser só conectividade instável. A chamada
      // original simplesmente falha como ApiNetworkException e quem chamou
      // pode tentar de novo mais tarde.
      return false;
    }
  }

  Future<void> _handleSessionExpired() async {
    await tokenStore.clear();
    onSessionExpired?.call();
  }
}
