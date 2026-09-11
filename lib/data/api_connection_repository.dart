import 'dart:async';

import 'api/api_client.dart';
import 'api/realtime_client.dart';
import 'connection_repository.dart';
import 'models/home_stats.dart';
import 'models/zap_connection_status.dart';
import 'models/zap_session_info.dart';

/// Implementação real de [ConnectionRepository] (Etapa 18 — integração
/// final), substituindo [MockConnectionRepository]. Ao contrário do resto da
/// Etapa 18 (troca 1:1 sob o contrato imutável), esta classe também
/// implementa os quatro membros novos (`currentQrCode`/`qrCodeStream`/
/// `currentPairingCode`/`pairingCodeStream`) adicionados a
/// `ConnectionRepository` para o QR code/código de pareamento reais — decisão
/// explícita para não deixar o fluxo de conexão do WhatsApp com um
/// placeholder estático depois da integração (ver `inicio_screen.dart`).
///
/// Status/sessão/QR code/código de pareamento chegam pelo WebSocket
/// (`RealtimeClient.onSession`, evento `session` — espelha
/// `SessionConnectionUpdate` do backend, `session.gateway.ts`); estatísticas
/// pelo evento `stats`. O snapshot inicial (antes do primeiro evento chegar)
/// vem de `GET /whatsapp/session`. Rotas mapeadas 1:1 com
/// `backend/src/whatsapp/session.controller.ts`.
class ApiConnectionRepository implements ConnectionRepository {
  ApiConnectionRepository(this._apiClient, this._realtimeClient) {
    unawaited(_initialize());
  }

  final ApiClient _apiClient;
  final RealtimeClient _realtimeClient;

  ZapConnectionStatus _status = ZapConnectionStatus.disconnected;
  ZapSessionInfo _session =
      const ZapSessionInfo(sessionName: '', phoneNumber: '');
  String? _qrCode;
  String? _pairingCode;
  bool _listenersRegistered = false;

  final StreamController<ZapConnectionStatus> _statusController =
      StreamController<ZapConnectionStatus>.broadcast();
  final StreamController<ZapSessionInfo> _sessionController =
      StreamController<ZapSessionInfo>.broadcast();
  final StreamController<String?> _qrCodeController =
      StreamController<String?>.broadcast();
  final StreamController<String?> _pairingCodeController =
      StreamController<String?>.broadcast();
  final StreamController<HomeStats> _statsController =
      StreamController<HomeStats>.broadcast();

  @override
  Stream<ZapConnectionStatus> get statusStream => _statusController.stream;

  @override
  ZapConnectionStatus get currentStatus => _status;

  @override
  ZapSessionInfo get currentSession => _session;

  @override
  Stream<ZapSessionInfo> get sessionStream => _sessionController.stream;

  @override
  String? get currentQrCode => _qrCode;

  @override
  Stream<String?> get qrCodeStream => _qrCodeController.stream;

  @override
  String? get currentPairingCode => _pairingCode;

  @override
  Stream<String?> get pairingCodeStream => _pairingCodeController.stream;

  @override
  Stream<HomeStats> get statsStream => _statsController.stream;

  /// Conecta o WebSocket, registra os listeners e carrega o snapshot inicial
  /// via REST. Chamado uma vez no construtor — as telas leem [currentStatus]/
  /// [currentSession] de forma síncrona (mesmo contrato do mock), então até
  /// isto terminar elas partem do estado seguro "desconectado" já inicializado
  /// nos campos acima, e são atualizadas assim que o snapshot chegar.
  Future<void> _initialize() async {
    await _realtimeClient.ensureConnected();
    _registerRealtimeListeners();
    try {
      final body =
          await _apiClient.get('/whatsapp/session') as Map<String, dynamic>;
      _applySessionSnapshot(body);
    } on Exception {
      // Sem sessão criada ainda (usuário nunca conectou) ou falha de rede no
      // boot — sem estado de erro dedicado aqui: a tela já mostra
      // "desconectado" por padrão, e o WebSocket (ou uma chamada explícita a
      // connect()) corrige assim que algo acontecer de verdade.
    }
  }

  void _registerRealtimeListeners() {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    _realtimeClient.onSession(_handleSessionEvent);
    _realtimeClient.onStats(_handleStatsEvent);
  }

  /// Snapshot de `GET /whatsapp/session` (`SessionDto`) — inclui `name`, que
  /// o evento `session` do WebSocket não carrega (ver
  /// `SessionGateway.emitSessionEvent`, que repassa só
  /// `SessionConnectionUpdate`).
  void _applySessionSnapshot(Map<String, dynamic> body) {
    _status = _mapStatus(body['status'] as String?);
    _session = ZapSessionInfo(
      sessionName: (body['name'] as String?) ?? '',
      phoneNumber: (body['phoneNumber'] as String?) ?? '',
    );
    _qrCode = body['qr'] as String?;
    _pairingCode = body['pairingCode'] as String?;

    _statusController.add(_status);
    _sessionController.add(_session);
    _qrCodeController.add(_qrCode);
    _pairingCodeController.add(_pairingCode);
  }

  /// Evento `session` (`SessionConnectionUpdate`, sem `name`) — atualiza
  /// status, telefone (quando presente), QR code e código de pareamento;
  /// nunca mexe em `_session.sessionName` (não vem neste evento).
  void _handleSessionEvent(Map<String, dynamic> data) {
    _status = _mapStatus(data['status'] as String?);
    _statusController.add(_status);

    final phoneNumber = data['phoneNumber'] as String?;
    if (phoneNumber != null && phoneNumber.isNotEmpty) {
      _session = _session.copyWith(phoneNumber: phoneNumber);
      _sessionController.add(_session);
    }

    // Um fluxo de conexão concluído (ou cancelado/desconectado) não deixa QR
    // code/código de pareamento válidos para trás — sem isso, reconectar
    // podia mostrar por um instante o código do fluxo anterior.
    if (_status != ZapConnectionStatus.connecting) {
      _qrCode = null;
      _pairingCode = null;
    } else {
      // Updates do Baileys são parciais: depois de enviar um QR/código ele
      // pode informar apenas `connection: connecting`. Não transformar a
      // ausência desses campos em `null`, pois isso apagava o QR/código
      // ainda válido da tela antes de o usuário conseguir usá-lo.
      if (data.containsKey('qr')) _qrCode = data['qr'] as String?;
      if (data.containsKey('pairingCode'))
        _pairingCode = data['pairingCode'] as String?;
    }
    _qrCodeController.add(_qrCode);
    _pairingCodeController.add(_pairingCode);
  }

  void _handleStatsEvent(Map<String, dynamic> data) {
    _statsController.add(_statsFromJson(data));
  }

  ZapConnectionStatus _mapStatus(String? raw) {
    switch (raw) {
      case 'CONECTADA':
        return ZapConnectionStatus.connected;
      case 'CONECTANDO':
        return ZapConnectionStatus.connecting;
      case 'DESCONECTADA':
      default:
        return ZapConnectionStatus.disconnected;
    }
  }

  HomeStats _statsFromJson(Map<String, dynamic> body) {
    return HomeStats(
      contactsImported: body['contactsImported'] as int,
      messagesSent: body['messagesSent'] as int,
      messagesPending: body['messagesPending'] as int,
      failures: body['failures'] as int,
    );
  }

  @override
  Future<void> connect({String? phoneNumber}) async {
    await _realtimeClient.ensureConnected();
    _registerRealtimeListeners();
    // Não dependemos exclusivamente do primeiro evento WS para dar retorno
    // visual. Se ele atrasar, o modal já abre em estado de conexão e nunca
    // parece travado; QR/código reais continuam chegando pelo socket.
    _status = ZapConnectionStatus.connecting;
    _qrCode = null;
    _pairingCode = null;
    _statusController.add(_status);
    _qrCodeController.add(null);
    _pairingCodeController.add(null);
    // 202 fire-and-forget (SessionController.connect) — o backend não
    // devolve o novo status na resposta. O estado real (CONECTANDO, depois o
    // QR code/código de pareamento, depois CONECTADA) chega pelo evento
    // `session` do WebSocket registrado acima; não há nada para aplicar aqui.
    try {
      await _apiClient.post('/whatsapp/session/connect', body: {
        if (phoneNumber != null && phoneNumber.trim().isNotEmpty)
          'phoneNumber': phoneNumber.trim(),
      });
    } catch (_) {
      _status = ZapConnectionStatus.disconnected;
      _statusController.add(_status);
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    // Mesmo raciocínio de connect(): 204 sem corpo, o status DESCONECTADA
    // "de verdade" chega pelo WebSocket.
    // Atualização otimista: cancelar não pode depender de uma resposta WS
    // tardia para fechar um modal de QR/pareamento.
    _status = ZapConnectionStatus.disconnected;
    _qrCode = null;
    _pairingCode = null;
    _statusController.add(_status);
    _qrCodeController.add(null);
    _pairingCodeController.add(null);
    await _apiClient.post('/whatsapp/session/disconnect');
  }

  @override
  Future<void> renameSession(String newName) async {
    final trimmed = newName.trim();
    if (trimmed.isEmpty) return;
    final body = await _apiClient.patch('/whatsapp/session/name', body: {
      'name': trimmed,
    }) as Map<String, dynamic>;
    _session =
        _session.copyWith(sessionName: (body['name'] as String?) ?? trimmed);
    _sessionController.add(_session);
  }

  @override
  Future<HomeStats> getStats() async {
    final body =
        await _apiClient.get('/whatsapp/session/stats') as Map<String, dynamic>;
    return _statsFromJson(body);
  }

  void dispose() {
    _statusController.close();
    _sessionController.close();
    _qrCodeController.close();
    _pairingCodeController.close();
    _statsController.close();
  }
}
