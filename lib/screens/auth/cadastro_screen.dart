import 'package:flutter/material.dart';

import '../../data/api/api_exception.dart';
import '../../data/auth_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/contact_repository.dart';
import '../../data/menu_repository.dart';
import '../../data/message_repository.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_password_field.dart';
import '../../widgets/app_text_field.dart';
import 'confirmacao_codigo_screen.dart';
import 'login_screen.dart';

/// Tela de Cadastro (Etapa 3, README.md seção 13).
/// Nome, Email, Senha e Confirmar senha — sem o robô mascote (ele aparece
/// só no Login). Ao enviar, dispara o código de verificação por email e
/// navega para [ConfirmacaoCodigoScreen].
class CadastroScreen extends StatefulWidget {
  const CadastroScreen({
    super.key,
    required this.authRepository,
    required this.connectionRepository,
    required this.messageRepository,
    required this.contactRepository,
    required this.menuRepository,
    required this.walletRepository,
  });

  final AuthRepository authRepository;
  final ConnectionRepository connectionRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final MenuRepository menuRepository;
  final WalletRepository walletRepository;

  @override
  State<CadastroScreen> createState() => _CadastroScreenState();
}

class _CadastroScreenState extends State<CadastroScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isSubmitting = false;
  String? _passwordError;
  String? _formError;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit(AppLocalizations l10n) async {
    if (_passwordController.text != _confirmPasswordController.text) {
      setState(() {
        _passwordError = l10n.auth_cadastro_password_mismatch_error;
      });
      return;
    }

    setState(() {
      _passwordError = null;
      _formError = null;
      _isSubmitting = true;
    });

    final email = _emailController.text.trim();

    try {
      await widget.authRepository.register(
        name: _nameController.text.trim(),
        email: email,
        password: _passwordController.text,
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _formError = e.isConflict
            ? l10n.auth_cadastro_email_in_use_error
            : l10n.auth_cadastro_network_error;
      });
      return;
    } on Exception {
      // Erro de rede (sem resposta do backend) ou qualquer outra falha
      // inesperada — sem isto, o botão ficava travado em "Carregando..."
      // pra sempre (exceção propagava sem ninguém desligar _isSubmitting).
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _formError = l10n.auth_cadastro_network_error;
      });
      return;
    }

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    Navigator.of(context).push(
      AppPageRoute(
        builder: (_) => ConfirmacaoCodigoScreen(
          authRepository: widget.authRepository,
          connectionRepository: widget.connectionRepository,
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          menuRepository: widget.menuRepository,
          walletRepository: widget.walletRepository,
          email: email,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.auth_cadastro_title)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppTextField(
                label: l10n.auth_cadastro_name_label,
                controller: _nameController,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              AppTextField(
                label: l10n.auth_cadastro_email_label,
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              AppPasswordField(
                label: l10n.auth_cadastro_password_label,
                controller: _passwordController,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              AppPasswordField(
                label: l10n.auth_cadastro_confirm_password_label,
                controller: _confirmPasswordController,
                errorText: _passwordError,
                textInputAction: TextInputAction.done,
              ),
              if (_formError != null) ...[
                const SizedBox(height: 16),
                Text(
                  _formError!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 24),
              AppButton(
                label: _isSubmitting
                    ? l10n.common_loading
                    : l10n.auth_cadastro_submit_button,
                onPressed: _isSubmitting ? null : () => _handleSubmit(l10n),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _isSubmitting
                    ? null
                    : () => Navigator.of(context).push(
                          AppPageRoute(
                            builder: (_) => LoginScreen(
                              authRepository: widget.authRepository,
                              connectionRepository: widget.connectionRepository,
                              messageRepository: widget.messageRepository,
                              contactRepository: widget.contactRepository,
                              menuRepository: widget.menuRepository,
                              walletRepository: widget.walletRepository,
                            ),
                          ),
                        ),
                child: Text(l10n.auth_cadastro_login_link),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
