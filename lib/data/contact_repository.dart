import 'models/contact.dart';
import 'models/contact_import_result.dart';

/// Abstração de contatos usados na Tela Mensagens (Etapa 5, README.md
/// seção 13; Menu 2 — Mensagens). A implementação real (Etapa 17) troca
/// [MockContactRepository] por integração de verdade (importação do
/// dispositivo/CSV, API), sem exigir mudanças nas telas.
abstract class ContactRepository {
  Future<List<Contact>> getContacts();

  /// Importa contatos colados pelo usuário (Menu 2, seção "Importar
  /// contatos"). Cada linha vira um contato: telefone obrigatório, com
  /// código do país (ex.: +5511999999999), seguido opcionalmente por
  /// campos extras separados por vírgula, atribuídos em ordem a ID1, ID2,
  /// ID3… (personalização, totalmente opcional). Linhas com telefone
  /// ausente ou inválido são ignoradas e contabilizadas em
  /// [ContactImportResult.skipped].
  Future<ContactImportResult> importContacts(String rawText);

  /// Adiciona um único contato cadastrado manualmente (Menu 2, seção
  /// "Importar contatos" — modo "Adicionar um por um"). Retorna a lista
  /// completa já atualizada.
  Future<List<Contact>> addContact(String phone, Map<String, String> customFields);

  /// Atualiza um contato já importado (edição antes do envio). Retorna a
  /// lista completa já atualizada.
  Future<List<Contact>> updateContact(Contact contact);

  /// Remove um contato antes do envio. Retorna a lista completa já
  /// atualizada.
  Future<List<Contact>> removeContact(String id);
}

class MockContactRepository implements ContactRepository {
  final List<Contact> _contacts = [
    const Contact(
      id: 'c1',
      phone: '+5511912345678',
      customFields: {'ID1': 'Ana Souza'},
    ),
    const Contact(
      id: 'c2',
      phone: '+5521998765432',
      customFields: {'ID1': 'Bruno Lima', 'ID2': 'São Paulo'},
    ),
    const Contact(
      id: 'c3',
      phone: '+5531987654321',
      customFields: {'ID1': 'Carla Mendes'},
    ),
    const Contact(id: 'c4', phone: '+5541976543210'),
    const Contact(
      id: 'c5',
      phone: '+5551965432109',
      customFields: {'ID1': 'Elisa Rocha', 'ID2': 'Curitiba', 'ID3': 'VIP'},
    ),
    const Contact(id: 'c6', phone: '+5561954321098'),
  ];

  int _sequence = 6;

  /// Falha só na primeira tentativa de carregar contatos (Etapa 7,
  /// README.md seção 13) — dá pra validar o estado de erro + retry sem
  /// depender de falha aleatória a cada teste.
  bool _firstLoadFailed = false;

  /// Exige "+" seguido só de dígitos (código do país + DDD + número), ex.:
  /// +5511999999999 — regra do Menu 2, seção "Importar contatos".
  static final RegExp _phonePattern = RegExp(r'^\+\d{8,15}$');

  @override
  Future<List<Contact>> getContacts() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (!_firstLoadFailed) {
      _firstLoadFailed = true;
      throw StateError('Falha simulada ao carregar contatos (Etapa 7).');
    }
    return List.unmodifiable(_contacts);
  }

  @override
  Future<ContactImportResult> importContacts(String rawText) async {
    await Future<void>.delayed(const Duration(milliseconds: 700));

    var imported = 0;
    var skipped = 0;

    for (final rawLine in rawText.split('\n')) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;

      final parts = line.split(',').map((part) => part.trim()).toList();
      final phone = parts.first.replaceAll(' ', '');

      if (!_phonePattern.hasMatch(phone)) {
        skipped++;
        continue;
      }

      final customFields = <String, String>{};
      for (var i = 1; i < parts.length; i++) {
        if (parts[i].isEmpty) continue;
        customFields['ID$i'] = parts[i];
      }

      _sequence++;
      _contacts.add(
        Contact(
          id: 'contact-$_sequence',
          phone: phone,
          customFields: customFields,
        ),
      );
      imported++;
    }

    return ContactImportResult(
      contacts: List.unmodifiable(_contacts),
      imported: imported,
      skipped: skipped,
    );
  }

  @override
  Future<List<Contact>> addContact(
    String phone,
    Map<String, String> customFields,
  ) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    _sequence++;
    _contacts.add(
      Contact(
        id: 'contact-$_sequence',
        phone: phone,
        customFields: customFields,
      ),
    );
    return List.unmodifiable(_contacts);
  }

  @override
  Future<List<Contact>> updateContact(Contact contact) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    final index = _contacts.indexWhere((c) => c.id == contact.id);
    if (index != -1) {
      _contacts[index] = contact;
    }
    return List.unmodifiable(_contacts);
  }

  @override
  Future<List<Contact>> removeContact(String id) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    _contacts.removeWhere((c) => c.id == id);
    return List.unmodifiable(_contacts);
  }
}
