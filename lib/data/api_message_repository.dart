import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../widgets/status_badge.dart';
import 'api/api_client.dart';
import 'api/realtime_client.dart';
import 'message_repository.dart';
import 'models/campaign.dart';
import 'models/campaign_media_type.dart';
import 'models/picked_media.dart';

/// Implementação real de [MessageRepository] (Etapa 18 — integração final),
/// substituindo [MockMessageRepository].
///
/// Duas extensões deliberadas sobre o contrato mockado original (mesmo
/// espírito das extensões já feitas em `ApiConnectionRepository` para
/// QR code/código de pareamento — decisão explícita do usuário para não
/// deixar recursos "de mentirinha" depois da integração):
///
///  1. Upload de mídia de verdade: [createCampaign] recebe [PickedMedia]
///     (bytes reais escolhidos em `nova_campanha_screen.dart`) e chama
///     `POST /campaigns/media` (multipart) para cada arquivo antes de
///     criar a campanha, encadeando os `mediaIds` retornados — só assim a
///     campanha carrega mídia de verdade no backend (ver `MediaService`).
///  2. Destinatários específicos: quando a tela usa o modo "contatos
///     selecionados", `recipientIds` vai no corpo de `POST /campaigns`
///     (em vez de sempre enviar pra todos os contatos VALIDO do usuário).
///
/// Progresso ao vivo chega pelo WebSocket (`RealtimeClient.onCampaignProgress`,
/// evento `campaign_progress` — espelha `CampaignProgressEvent` do backend,
/// `session.gateway.ts`); o snapshot inicial vem de `GET /campaigns`. Rotas
/// mapeadas 1:1 com `backend/src/campaigns/campaigns.controller.ts`.
class ApiMessageRepository implements MessageRepository {
  ApiMessageRepository(this._apiClient, this._realtimeClient) {
    unawaited(_initialize());
  }

  final ApiClient _apiClient;
  final RealtimeClient _realtimeClient;

  final List<Campaign> _campaigns = [];
  final StreamController<List<Campaign>> _controller =
      StreamController<List<Campaign>>.broadcast();
  bool _listenersRegistered = false;

  @override
  Stream<List<Campaign>> get campaignsStream => _controller.stream;

  @override
  List<Campaign> get currentCampaigns => List.unmodifiable(_campaigns);

  void _emit() => _controller.add(List.unmodifiable(_campaigns));

  Future<void> _initialize() async {
    await _realtimeClient.ensureConnected();
    _registerRealtimeListeners();
    try {
      final body = await _apiClient.get('/campaigns') as List<dynamic>;
      _campaigns
        ..clear()
        ..addAll(_campaignsFromJson(body));
      _emit();
    } on Exception {
      // Sem campanhas ainda, ou falha de rede no boot — a tela já mostra a
      // lista vazia por padrão (mesmo raciocínio de `ApiConnectionRepository
      // ._initialize`), e uma nova chamada a `createCampaign`/`clearHistory`
      // (ou o próprio evento `campaign_progress`) corrige o estado depois.
    }
  }

  void _registerRealtimeListeners() {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    _realtimeClient.onCampaignProgress(_handleCampaignProgress);
  }

  /// `CampaignProgressEvent` do backend — delta incremental, não a campanha
  /// inteira (`messages`/`mediaType` não mudam depois de criada). Funde no
  /// item local por `id`; se a campanha ainda não estiver na lista local
  /// (ex.: evento chegou antes do `_initialize` terminar), ignora — o
  /// próximo `GET /campaigns` (ou o próprio evento seguinte, já com a
  /// campanha presente) resolve.
  void _handleCampaignProgress(Map<String, dynamic> data) {
    final id = data['id'] as String;
    final index = _campaigns.indexWhere((c) => c.id == id);
    if (index == -1) return;

    _campaigns[index] = _campaigns[index].copyWith(
      status: _mapStatus(data['status'] as String?),
      sentCount: data['sentCount'] as int,
      pendingCount: data['pendingCount'] as int,
      failedCount: data['failedCount'] as int,
    );
    _emit();
  }

  @override
  Future<void> createCampaign({
    required List<String> messages,
    required int recipientCount,
    required CampaignMediaType mediaType,
    int mediaCount = 0,
    List<PickedMedia> media = const [],
    Set<String>? recipientIds,
  }) async {
    final mediaIds = <String>[];
    if (mediaType != CampaignMediaType.none) {
      for (final file in media) {
        final uploaded = await _uploadMedia(mediaType, file);
        mediaIds.add(uploaded);
      }
    }

    final body = await _apiClient.post('/campaigns', body: {
      'messages': messages,
      if (mediaIds.isNotEmpty) 'mediaIds': mediaIds,
      if (recipientIds != null && recipientIds.isNotEmpty)
        'recipientIds': recipientIds.toList(),
    }) as List<dynamic>;

    _campaigns
      ..clear()
      ..addAll(_campaignsFromJson(body));
    _emit();
  }

  /// `POST /campaigns/media` (multipart) — arquivo "órfão" até
  /// `POST /campaigns` adotá-lo via `mediaIds`. Retorna o id opaco
  /// (`CampaignMediaDto.id`).
  Future<String> _uploadMedia(
    CampaignMediaType mediaType,
    PickedMedia file,
  ) async {
    final body = await _apiClient.postMultipart(
      '/campaigns/media',
      files: [
        http.MultipartFile.fromBytes(
          'file',
          file.bytes,
          filename: file.fileName,
          contentType: MediaType.parse(file.mimeType),
        ),
      ],
      fields: {'type': _uploadTypeFor(mediaType)},
    ) as Map<String, dynamic>;
    return body['id'] as String;
  }

  String _uploadTypeFor(CampaignMediaType mediaType) {
    switch (mediaType) {
      case CampaignMediaType.images:
        return 'IMAGENS';
      case CampaignMediaType.audio:
        return 'AUDIO';
      case CampaignMediaType.document:
        return 'DOCUMENTO';
      case CampaignMediaType.none:
        throw ArgumentError('Não há upload para CampaignMediaType.none.');
    }
  }

  @override
  Future<void> clearHistory() async {
    final body = await _apiClient.delete('/campaigns/history') as List<dynamic>;
    _campaigns
      ..clear()
      ..addAll(_campaignsFromJson(body));
    _emit();
  }

  List<Campaign> _campaignsFromJson(List<dynamic> body) {
    return body
        .map((e) => _campaignFromJson(e as Map<String, dynamic>))
        .toList();
  }

  Campaign _campaignFromJson(Map<String, dynamic> json) {
    return Campaign(
      id: json['id'] as String,
      messages: List<String>.from(json['messages'] as List),
      recipientCount: json['recipientCount'] as int,
      status: _mapStatus(json['status'] as String?),
      mediaType: _mapMediaType(json['mediaType'] as String?),
      mediaCount: json['mediaCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
      sentCount: json['sentCount'] as int,
      pendingCount: json['pendingCount'] as int,
      failedCount: json['failedCount'] as int,
    );
  }

  AppStatus _mapStatus(String? raw) {
    switch (raw) {
      case 'ENVIADA':
        return AppStatus.sent;
      case 'PENDENTE':
      default:
        return AppStatus.pending;
    }
  }

  CampaignMediaType _mapMediaType(String? raw) {
    switch (raw) {
      case 'IMAGENS':
        return CampaignMediaType.images;
      case 'AUDIO':
        return CampaignMediaType.audio;
      case 'DOCUMENTO':
        return CampaignMediaType.document;
      case 'NENHUMA':
      default:
        return CampaignMediaType.none;
    }
  }

  void dispose() {
    _controller.close();
  }
}
