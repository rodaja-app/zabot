import 'dart:typed_data';

/// Um arquivo de mídia escolhido pelo usuário no composer de campanha (Menu
/// 2, seção "Mídia") — os bytes reais, prontos para upload via
/// `POST /campaigns/media` (Etapa 18, `ApiMessageRepository`). Só existe na
/// integração real: o mock nunca modelou arquivo de verdade, apenas o
/// tipo/contagem visual (`CampaignMediaType`/`mediaCount`) — ver decisão em
/// `message_repository.dart`.
class PickedMedia {
  const PickedMedia({
    required this.bytes,
    required this.mimeType,
    required this.fileName,
  });

  final Uint8List bytes;

  /// Mimetype real do arquivo (ex.: `image/png`) — validado pelo backend
  /// (`MediaService.assertValid`) por categoria de mídia.
  final String mimeType;
  final String fileName;
}
