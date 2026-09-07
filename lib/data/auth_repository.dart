/// Camada de repositório de autenticação (ver README.md, seção 13).
///
/// Nas etapas de front-end, toda tela fala só com esta interface — nunca
/// com uma API diretamente. [MockAuthRepository] simula o backend em
/// memória. Na Etapa 17 (integração final), uma implementação real
/// (`ApiAuthRepository`, por exemplo) substitui o mock aqui, sem exigir
/// nenhuma mudança nas telas de Cadastro/Confirmação/Login.
abstract class AuthRepository {
  /// Cria a conta (ainda não confirmada) e dispara o envio do código de
  /// verificação para [email].
  Future<void> register({
    required String name,
    required String email,
    required String password,
  });

  /// Reenvia o código de verificação para [email].
  Future<void> resendCode({required String email});

  /// Confirma o código recebido por email. Retorna `true` se o código
  /// estiver correto — nesse caso a conta passa a existir de fato e o
  /// usuário já está autenticado (login automático).
  Future<bool> confirmCode({required String email, required String code});

  /// Login de usuário já cadastrado. Retorna `true` se as credenciais
  /// baterem.
  Future<bool> login({required String email, required String password});

  /// Encerra a sessão do usuário atual (Etapa 6, tela Menu).
  Future<void> logout();

  /// Exclui definitivamente a conta do usuário atual (Menu 3, seção
  /// "Conta" — ação destrutiva, exige confirmação na tela antes de chamar).
  Future<void> deleteAccount();
}

class MockAuthRepository implements AuthRepository {
  /// Código fixo aceito por qualquer confirmação, só para o front
  /// funcionar de ponta a ponta antes do backend existir.
  static const String fixedCode = '123456';

  final Map<String, String> _passwordsByEmail = {};

  @override
  Future<void> register({
    required String name,
    required String email,
    required String password,
  }) async {
    await Future.delayed(const Duration(milliseconds: 600));
    _passwordsByEmail[email] = password;
  }

  @override
  Future<void> resendCode({required String email}) async {
    await Future.delayed(const Duration(milliseconds: 400));
  }

  @override
  Future<bool> confirmCode({required String email, required String code}) async {
    await Future.delayed(const Duration(milliseconds: 500));
    return code.trim() == fixedCode;
  }

  @override
  Future<bool> login({required String email, required String password}) async {
    await Future.delayed(const Duration(milliseconds: 600));
    return _passwordsByEmail[email] == password;
  }

  @override
  Future<void> logout() async {
    await Future.delayed(const Duration(milliseconds: 300));
  }

  @override
  Future<void> deleteAccount() async {
    await Future.delayed(const Duration(milliseconds: 600));
  }
}
