import 'contact.dart';

/// Resultado de uma importação de contatos colados (Menu 2, seção
/// "Importar contatos"). [imported] e [skipped] alimentam o feedback dado
/// ao usuário logo após o botão "Importar" (quantos entraram, quantas
/// linhas foram ignoradas por número inválido).
class ContactImportResult {
  const ContactImportResult({
    required this.contacts,
    required this.imported,
    required this.skipped,
  });

  final List<Contact> contacts;
  final int imported;
  final int skipped;
}
