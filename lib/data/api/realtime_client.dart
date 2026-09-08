import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import 'auth_token_store.dart';

/// Wrapper sobre `socket_io_client` para o namespace `/whatsapp` (ver
/// `backend/src/whatsapp/session.gateway.ts`) — único canal WebSocket do
/// backend. Compartilhado entre `ApiConnectionRepository` (eventos `session`
/// e `stats`) e `ApiMessageRepository` (evento `campaign_progress`, Etapa
/// 18): uma única conexão por app, não uma por repositório — do mesmo jeito
/// que o backend também isola tudo numa única room por usuário
/// (`user:<id>`, ver `roomFor` no gateway).
///
/// Autenticação manual via `auth.token` no handshake (mesmo padrão do
/// `JwtAuthGuard`, ver comentário em `session.gateway.ts`) — não há reconexão
/// automática de token: se o access token expira, o socket cai e precisa de
/// [reconnectWithFreshToken] depois que `ApiClient` rotacionar via
/// `/auth/refresh`.
class RealtimeClient {
  RealtimeClient({required this.baseUrl, required this.tokenStore});

  final String baseUrl;
  final AuthTokenStore tokenStore;

  socket_io.Socket? _socket;

  /// Garante uma conexão viva com o access token atual. Idempotente — se já
  /// conectado, não faz nada. Deve ser chamado (e aguardado) antes de
  /// registrar qualquer listener (`onSession`/`onStats`/`onCampaignProgress`),
  /// já que eles são no-ops enquanto não existe socket.
  Future<void> ensureConnected() async {
    if (_socket != null && _socket!.connected) return;

    final accessToken = await tokenStore.accessToken;
    if (accessToken == null) return;

    _socket?.dispose();
    _socket = socket_io.io(
      '$baseUrl/whatsapp',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .enableReconnection()
          .build(),
    );
    _socket!.connect();
  }

  /// O socket não relê o token sozinho — o `auth.token` do handshake só é
  /// verificado na conexão (ver `SessionGateway.authenticate`). Chamado
  /// depois que `ApiClient` rotaciona os tokens (via `onSessionExpired`/pós
  /// refresh bem-sucedido) para reconectar já com o token novo.
  Future<void> reconnectWithFreshToken() async {
    _socket?.dispose();
    _socket = null;
    await ensureConnected();
  }

  void onSession(void Function(Map<String, dynamic> data) handler) {
    _socket?.on('session', (data) => handler(Map<String, dynamic>.from(data as Map)));
  }

  void onStats(void Function(Map<String, dynamic> data) handler) {
    _socket?.on('stats', (data) => handler(Map<String, dynamic>.from(data as Map)));
  }

  /// Delta incremental de campanha (`CampaignProgressEvent` do backend —
  /// `id/status/sentCount/pendingCount/failedCount`), emitido depois que
  /// `SendMessageProcessorService.applyRecipientOutcome` commita a transação
  /// (Etapa 18).
  void onCampaignProgress(void Function(Map<String, dynamic> data) handler) {
    _socket?.on('campaign_progress', (data) => handler(Map<String, dynamic>.from(data as Map)));
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
