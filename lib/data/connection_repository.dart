import 'dart:async';
import 'dart:math';

import 'models/home_stats.dart';
import 'models/zap_connection_status.dart';
import 'models/zap_session_info.dart';

/// Abstração da conexão do WhatsApp e das estatísticas da Tela Início
/// (Etapa 4, README.md seção 13). A implementação real (Etapa 17) troca
/// [MockConnectionRepository] por uma versão que fala com o backend/QR code
/// de verdade, sem exigir mudanças nas telas.
abstract class ConnectionRepository {
  /// Emite o novo status sempre que a conexão muda (ex.: início do fluxo de
  /// QR code, conexão concluída, desconexão).
  Stream<ZapConnectionStatus> get statusStream;

  ZapConnectionStatus get currentStatus;

  /// Nome da sessão + telefone vinculado, exibidos quando conectado.
  ZapSessionInfo get currentSession;

  /// Emite sempre que os dados da sessão mudam (ex.: usuário renomeia a
  /// sessão, ou uma nova conexão é concluída com outro número).
  Stream<ZapSessionInfo> get sessionStream;

  /// Inicia o fluxo de conexão e, ao concluir, emite
  /// [ZapConnectionStatus.connected]. [phoneNumber] é informado só quando o
  /// usuário escolhe o fluxo "Número de telefone" em vez de QR code — no
  /// mock, isso só é usado para preencher [currentSession] ao final.
  Future<void> connect({String? phoneNumber});

  /// QR code atual do fluxo de conexão, como data URL
  /// (`data:image/png;base64,...`) — mesmo formato de
  /// `SessionConnectionUpdate.qr` no backend (Etapa 18). `null` fora do
  /// fluxo de QR code em andamento. No mock, sempre `null`: a Etapa 4 nunca
  /// modelou um QR code de verdade, só o placeholder visual em
  /// `inicio_screen.dart`.
  String? get currentQrCode;

  /// Emite sempre que um novo QR code chega durante o fluxo de conexão
  /// (o backend gera um novo a cada expiração, até o usuário escanear ou o
  /// fluxo ser cancelado).
  Stream<String?> get qrCodeStream;

  /// Código de pareamento atual do fluxo de conexão por número de telefone
  /// (`SessionConnectionUpdate.pairingCode` no backend, Etapa 18) — `null`
  /// fora desse fluxo. No mock, sempre `null`.
  String? get currentPairingCode;

  /// Emite sempre que um novo código de pareamento chega durante o fluxo de
  /// conexão por número de telefone.
  Stream<String?> get pairingCodeStream;

  /// Desconecta o WhatsApp (ou cancela um fluxo de conexão em andamento).
  Future<void> disconnect();

  /// Renomeia a sessão atual (ação "Alterar nome da sessão" do menu
  /// "Gerenciar conexão").
  Future<void> renameSession(String newName);

  Future<HomeStats> getStats();

  /// Emite atualizações periódicas dos contadores enquanto o WhatsApp está
  /// conectado — simulação de tempo real (Etapa 7, README.md seção 13) para
  /// já validar a UX antes do WebSocket real existir (Etapa 17).
  Stream<HomeStats> get statsStream;
}

class MockConnectionRepository implements ConnectionRepository {
  MockConnectionRepository()
      : _status = ZapConnectionStatus.disconnected,
        _session = const ZapSessionInfo(
          sessionName: 'Minha Empresa',
          phoneNumber: '+55 11 99999-9999',
        ),
        _controller = StreamController<ZapConnectionStatus>.broadcast(),
        _sessionController = StreamController<ZapSessionInfo>.broadcast(),
        _statsController = StreamController<HomeStats>.broadcast();

  ZapConnectionStatus _status;
  ZapSessionInfo _session;
  final StreamController<ZapConnectionStatus> _controller;
  final StreamController<ZapSessionInfo> _sessionController;
  final StreamController<HomeStats> _statsController;
  Timer? _autoConnectTimer;
  Timer? _statsTimer;
  final Random _random = Random();

  HomeStats _stats = const HomeStats(
    contactsImported: 250,
    messagesSent: 1180,
    messagesPending: 70,
    failures: 12,
  );

  @override
  Stream<ZapConnectionStatus> get statusStream => _controller.stream;

  @override
  ZapConnectionStatus get currentStatus => _status;

  @override
  ZapSessionInfo get currentSession => _session;

  @override
  Stream<ZapSessionInfo> get sessionStream => _sessionController.stream;

  @override
  Stream<HomeStats> get statsStream => _statsController.stream;

  // O mock nunca modelou QR code/código de pareamento reais (Etapa 4 é só
  // front, ver `_QrCodePlaceholder` em `inicio_screen.dart`) — a
  // implementação real (`ApiConnectionRepository`, Etapa 18) é quem
  // preenche isto de verdade, a partir de `SessionConnectionUpdate.qr`/
  // `.pairingCode`.
  @override
  String? get currentQrCode => null;

  @override
  Stream<String?> get qrCodeStream => Stream<String?>.empty();

  @override
  String? get currentPairingCode => null;

  @override
  Stream<String?> get pairingCodeStream => Stream<String?>.empty();

  void _setStatus(ZapConnectionStatus status) {
    _status = status;
    _controller.add(status);
  }

  @override
  Future<void> connect({String? phoneNumber}) async {
    _autoConnectTimer?.cancel();
    _setStatus(ZapConnectionStatus.connecting);

    // Simula o tempo de escaneamento do QR code (ou validação do número)
    // pelo usuário.
    _autoConnectTimer = Timer(const Duration(seconds: 3), () {
      if (phoneNumber != null && phoneNumber.trim().isNotEmpty) {
        _session = _session.copyWith(phoneNumber: phoneNumber.trim());
        _sessionController.add(_session);
      }
      _setStatus(ZapConnectionStatus.connected);
    });
  }

  @override
  Future<void> disconnect() async {
    _autoConnectTimer?.cancel();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _setStatus(ZapConnectionStatus.disconnected);
  }

  @override
  Future<void> renameSession(String newName) async {
    if (newName.trim().isEmpty) return;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _session = _session.copyWith(sessionName: newName.trim());
    _sessionController.add(_session);
  }

  @override
  Future<HomeStats> getStats() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _ensureStatsTimer();
    return _stats;
  }

  /// Inicia (uma única vez) o timer que simula, "ao vivo", o andamento de um
  /// envio em massa: mensagens pendentes viram enviadas (ou, às vezes,
  /// falhas), só enquanto o WhatsApp estiver conectado.
  void _ensureStatsTimer() {
    _statsTimer ??= Timer.periodic(const Duration(seconds: 4), (_) {
      if (_status != ZapConnectionStatus.connected) return;
      if (_stats.messagesPending <= 0) return;

      final processed = min(1 + _random.nextInt(3), _stats.messagesPending);
      final willFail = _random.nextDouble() < 0.15;

      _stats = HomeStats(
        contactsImported: _stats.contactsImported,
        messagesSent: _stats.messagesSent + (willFail ? 0 : processed),
        messagesPending: _stats.messagesPending - processed,
        failures: _stats.failures + (willFail ? processed : 0),
      );
      _statsController.add(_stats);
    });
  }

  void dispose() {
    _autoConnectTimer?.cancel();
    _statsTimer?.cancel();
    _controller.close();
    _sessionController.close();
    _statsController.close();
  }
}
