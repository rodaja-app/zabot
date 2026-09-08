/// Espelha o corpo de erro padrão emitido por todo o backend
/// (`AllExceptionsFilter`, `backend/src/common/filters/all-exceptions.filter.ts`):
/// `{statusCode, category, message, timestamp, path}` — em toda resposta de
/// erro, incluindo erros de validação do `ValidationPipe` global (`main.ts`).
///
/// Cada `Api*Repository` (Etapa 18) captura isto para decidir: relançar como
/// está, tratar como caso especial (ex.: 404 → lista vazia) ou mapear para
/// uma mensagem localizada específica da tela (ex.: `cadastro_screen.dart`
/// checando `isConflict` para "email já cadastrado").
class ApiException implements Exception {
  ApiException({
    required this.statusCode,
    required this.category,
    required this.message,
    this.path,
  });

  factory ApiException.fromResponseBody(int statusCode, Map<String, dynamic> body) {
    return ApiException(
      statusCode: statusCode,
      category: (body['category'] as String?) ?? 'DESCONHECIDO',
      message: (body['message'] as String?) ?? 'Ocorreu um erro inesperado.',
      path: body['path'] as String?,
    );
  }

  final int statusCode;
  final String category;
  final String message;
  final String? path;

  bool get isAuthError => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;
  bool get isValidation => statusCode == 400 || statusCode == 422;
  bool get isRateLimit => statusCode == 429;

  @override
  String toString() => 'ApiException($statusCode $category: $message)';
}

/// Erro de rede — sem resposta do servidor (DNS, timeout, conexão recusada).
/// Separado de [ApiException] porque as telas normalmente distinguem os dois
/// casos (ex.: `AppErrorView` com mensagem "sem conexão" vs. a mensagem
/// específica que o backend mandou).
class ApiNetworkException implements Exception {
  ApiNetworkException(this.message);

  final String message;

  @override
  String toString() => 'ApiNetworkException($message)';
}
