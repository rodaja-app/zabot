/// Contato mockado usado na Tela Mensagens (Etapa 5, README.md seção 13;
/// Menu 2 — Mensagens).
///
/// [customFields] guarda os dados de personalização opcionais informados na
/// importação (chaves "ID1", "ID2", "ID3"…), usados para substituir
/// marcadores como {ID1} no texto das mensagens (seção "Personalização").
class Contact {
  const Contact({
    required this.id,
    required this.phone,
    this.customFields = const {},
  });

  final String id;
  final String phone;
  final Map<String, String> customFields;

  /// Rótulo de exibição na lista de contatos: usa ID1 (geralmente o nome,
  /// quando informado na importação) e cai para o telefone quando não há
  /// personalização cadastrada.
  String get displayLabel {
    final id1 = customFields['ID1'];
    if (id1 != null && id1.trim().isNotEmpty) return id1;
    return phone;
  }

  Contact copyWith({String? phone, Map<String, String>? customFields}) {
    return Contact(
      id: id,
      phone: phone ?? this.phone,
      customFields: customFields ?? this.customFields,
    );
  }
}
