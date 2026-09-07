/// Resumo/estatísticas exibidos no card de resumo da Tela Início (Etapa 4).
///
/// [totalMessages] é sempre a soma de enviadas + pendentes + falhas — não é
/// um campo independente, pra nunca ficar inconsistente com os outros três.
class HomeStats {
  const HomeStats({
    required this.contactsImported,
    required this.messagesSent,
    required this.messagesPending,
    required this.failures,
  });

  final int contactsImported;
  final int messagesSent;
  final int messagesPending;
  final int failures;

  int get totalMessages => messagesSent + messagesPending + failures;
}
