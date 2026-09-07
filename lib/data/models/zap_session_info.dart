/// Dados da sessão do WhatsApp conectado, exibidos na Tela Início
/// (nome da sessão + número de telefone vinculado).
class ZapSessionInfo {
  const ZapSessionInfo({required this.sessionName, required this.phoneNumber});

  final String sessionName;
  final String phoneNumber;

  ZapSessionInfo copyWith({String? sessionName, String? phoneNumber}) {
    return ZapSessionInfo(
      sessionName: sessionName ?? this.sessionName,
      phoneNumber: phoneNumber ?? this.phoneNumber,
    );
  }
}
