import 'dart:async';
import 'dart:math';

import '../widgets/status_badge.dart';
import 'models/campaign.dart';
import 'models/campaign_media_type.dart';

/// Abstração de campanhas de envio em massa (Etapa 5, README.md seção 13;
/// Menu 2 — Mensagens). A implementação real (Etapa 17) troca
/// [MockMessageRepository] pelo envio de verdade via WhatsApp, sem exigir
/// mudanças nas telas.
abstract class MessageRepository {
  Stream<List<Campaign>> get campaignsStream;

  List<Campaign> get currentCampaigns;

  /// Cria e "envia" uma campanha (Menu 2, seção "Iniciar envio").
  /// [recipientCount] é o total de contatos já curados na aba Contatos —
  /// esta tela não escolhe destinatários, envia para todos os contatos
  /// importados. O progresso do envio (enviados/pendentes/falhas) é
  /// emitido em tempo real por [campaignsStream].
  Future<void> createCampaign({
    required List<String> messages,
    required int recipientCount,
    required CampaignMediaType mediaType,
    int mediaCount = 0,
  });

  /// Limpa todo o histórico de campanhas (enviadas, pendentes e com falha).
  /// Usado pelo botão "Limpar histórico de envio" (Menu 2 — Mensagens).
  Future<void> clearHistory();
}

class MockMessageRepository implements MessageRepository {
  MockMessageRepository()
      : _controller = StreamController<List<Campaign>>.broadcast() {
    _campaigns.addAll([
      Campaign(
        id: 'seed-1',
        messages: const ['Nosso novo produto chegou! Confira as novidades.'],
        recipientCount: 240,
        status: AppStatus.sent,
        mediaType: CampaignMediaType.images,
        mediaCount: 2,
        createdAt: DateTime.now().subtract(const Duration(days: 2)),
        sentCount: 240,
      ),
      Campaign(
        id: 'seed-2',
        messages: const [
          'Aproveite 20% de desconto só até domingo.',
          'Use o cupom FIMDESEMANA no checkout.',
        ],
        recipientCount: 512,
        status: AppStatus.sent,
        mediaType: CampaignMediaType.none,
        createdAt: DateTime.now().subtract(const Duration(days: 1)),
        sentCount: 498,
        failedCount: 14,
      ),
      Campaign(
        id: 'seed-3',
        messages: const ['Sua fatura vence amanhã. Evite juros pagando hoje.'],
        recipientCount: 87,
        status: AppStatus.pending,
        mediaType: CampaignMediaType.document,
        createdAt: DateTime.now(),
        sentCount: 40,
        pendingCount: 47,
      ),
    ]);
  }

  final List<Campaign> _campaigns = [];
  final StreamController<List<Campaign>> _controller;
  final List<Timer> _timers = [];
  final Random _random = Random();
  int _sequence = 0;

  @override
  Stream<List<Campaign>> get campaignsStream => _controller.stream;

  @override
  List<Campaign> get currentCampaigns => List.unmodifiable(_campaigns);

  void _emit() => _controller.add(List.unmodifiable(_campaigns));

  @override
  Future<void> createCampaign({
    required List<String> messages,
    required int recipientCount,
    required CampaignMediaType mediaType,
    int mediaCount = 0,
  }) async {
    _sequence++;
    final id = 'campaign-$_sequence';

    final campaign = Campaign(
      id: id,
      messages: messages,
      recipientCount: recipientCount,
      status: AppStatus.pending,
      mediaType: mediaType,
      mediaCount: mediaCount,
      createdAt: DateTime.now(),
      pendingCount: recipientCount,
    );

    _campaigns.insert(0, campaign);
    _emit();

    if (recipientCount <= 0) {
      // Nada para enviar (aba Contatos vazia) — mantém a campanha só como
      // registro, sem timer de progresso.
      _campaigns[0] = campaign.copyWith(status: AppStatus.sent);
      _emit();
      return;
    }

    // Simula o progresso "ao vivo" do envio (Menu 2, seção "Iniciar
    // envio"): a cada tique, um lote de contatos pendentes vira enviado
    // (ou, às vezes, falha), até a fila zerar.
    late final Timer timer;
    timer = Timer.periodic(const Duration(milliseconds: 500), (t) {
      final index = _campaigns.indexWhere((c) => c.id == id);
      if (index == -1) {
        t.cancel();
        return;
      }

      var current = _campaigns[index];
      if (current.pendingCount <= 0) {
        t.cancel();
        return;
      }

      final batch = min(1 + _random.nextInt(4), current.pendingCount);
      final willFail = _random.nextDouble() < 0.08;

      current = current.copyWith(
        pendingCount: current.pendingCount - batch,
        sentCount: current.sentCount + (willFail ? 0 : batch),
        failedCount: current.failedCount + (willFail ? batch : 0),
      );

      if (current.pendingCount <= 0) {
        current = current.copyWith(status: AppStatus.sent);
        t.cancel();
      }

      _campaigns[index] = current;
      _emit();
    });
    _timers.add(timer);
  }

  @override
  Future<void> clearHistory() async {
    for (final timer in _timers) {
      timer.cancel();
    }
    _timers.clear();
    _campaigns.clear();
    _emit();
  }

  void dispose() {
    for (final timer in _timers) {
      timer.cancel();
    }
    _controller.close();
  }
}
