import '../../widgets/status_badge.dart';
import 'campaign_media_type.dart';

/// Campanha de envio em massa (Etapa 5, README.md seção 13; Menu 2 —
/// Mensagens). Suporta de 1 a 5 mensagens por contato (seção "Criar
/// mensagem") e contadores ao vivo durante o envio (seção "Iniciar envio":
/// enviados / pendentes / falhas / total).
class Campaign {
  const Campaign({
    required this.id,
    required this.messages,
    required this.recipientCount,
    required this.status,
    required this.mediaType,
    this.mediaCount = 0,
    required this.createdAt,
    this.sentCount = 0,
    this.pendingCount = 0,
    this.failedCount = 0,
  });

  final String id;

  /// De 1 a 5 mensagens (Menu 2, seção "Criar mensagem"). A primeira é
  /// usada como título/prévia nos cards da lista.
  final List<String> messages;
  final int recipientCount;
  final AppStatus status;
  final CampaignMediaType mediaType;

  /// Só relevante quando [mediaType] é [CampaignMediaType.images] —
  /// quantas imagens foram anexadas ("Várias imagens na mesma mensagem").
  final int mediaCount;
  final DateTime createdAt;

  /// Contadores "ao vivo" durante o envio (Menu 2, seção "Iniciar envio").
  final int sentCount;
  final int pendingCount;
  final int failedCount;

  String get messagePreview => messages.isEmpty ? '' : messages.first;

  String get title {
    final first = messagePreview;
    return first.length > 30 ? '${first.substring(0, 30)}...' : first;
  }

  /// Sempre a soma de enviadas + pendentes + falhas — nunca um valor
  /// independente, seguindo a mesma regra do resumo da Tela Início.
  int get totalCount => sentCount + pendingCount + failedCount;

  double get progress =>
      recipientCount == 0 ? 0 : (sentCount + failedCount) / recipientCount;

  Campaign copyWith({
    AppStatus? status,
    int? sentCount,
    int? pendingCount,
    int? failedCount,
  }) {
    return Campaign(
      id: id,
      messages: messages,
      recipientCount: recipientCount,
      status: status ?? this.status,
      mediaType: mediaType,
      mediaCount: mediaCount,
      createdAt: createdAt,
      sentCount: sentCount ?? this.sentCount,
      pendingCount: pendingCount ?? this.pendingCount,
      failedCount: failedCount ?? this.failedCount,
    );
  }
}
