import 'api/api_client.dart';
import 'contact_repository.dart';
import 'models/contact.dart';
import 'models/contact_import_result.dart';

/// Implementação real de [ContactRepository] (Etapa 18 — integração final),
/// substituindo [MockContactRepository] sem exigir mudanças na Tela
/// Mensagens — mesmo contrato documentado em `contact_repository.dart`.
/// Rotas mapeadas 1:1 com `backend/src/contacts/contacts.controller.ts`.
///
/// `ContactDto` do backend carrega dois campos a mais que o front nunca leu
/// (`status`/`failureReason`, README §5 passo 5 — registro auditável da
/// validação de número) — [_contactFromJson] os ignora de propósito, mesmo
/// espírito aditivo do comentário em `contact.dto.ts`.
class ApiContactRepository implements ContactRepository {
  ApiContactRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<List<Contact>> getContacts() async {
    final body = await _apiClient.get('/contacts') as List<dynamic>;
    return _contactsFromJson(body);
  }

  @override
  Future<ContactImportResult> importContacts(String rawText) async {
    final body = await _apiClient.post('/contacts/import', body: {
      'rawText': rawText,
    }) as Map<String, dynamic>;
    return ContactImportResult(
      contacts: _contactsFromJson(body['contacts'] as List<dynamic>),
      imported: body['imported'] as int,
      skipped: body['skipped'] as int,
    );
  }

  @override
  Future<List<Contact>> addContact(
    String phone,
    Map<String, String> customFields,
  ) async {
    final body = await _apiClient.post('/contacts', body: {
      'phone': phone,
      'customFields': customFields,
    }) as List<dynamic>;
    return _contactsFromJson(body);
  }

  @override
  Future<List<Contact>> updateContact(Contact contact) async {
    final body = await _apiClient.patch('/contacts/${contact.id}', body: {
      'phone': contact.phone,
      'customFields': contact.customFields,
    }) as List<dynamic>;
    return _contactsFromJson(body);
  }

  @override
  Future<List<Contact>> removeContact(String id) async {
    final body = await _apiClient.delete('/contacts/$id') as List<dynamic>;
    return _contactsFromJson(body);
  }

  List<Contact> _contactsFromJson(List<dynamic> body) {
    return body
        .map((e) => _contactFromJson(e as Map<String, dynamic>))
        .toList();
  }

  Contact _contactFromJson(Map<String, dynamic> json) {
    return Contact(
      id: json['id'] as String,
      phone: json['phone'] as String,
      customFields: Map<String, String>.from(
        (json['customFields'] as Map?) ?? const {},
      ),
    );
  }
}
