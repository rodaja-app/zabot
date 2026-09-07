import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

import '../../data/auth_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/contact_repository.dart';
import '../../data/menu_repository.dart';
import '../../data/message_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_password_field.dart';
import '../../widgets/app_text_field.dart';
import '../../theme/app_theme.dart';
import '../root_shell_screen.dart';
import 'cadastro_screen.dart';

/// Tela de Login (Etapa 3, README.md seção 13).
/// Email + Senha, para quem já tem conta. Única tela de autenticação com
/// o robô mascote — grande, em destaque, no topo (Cadastro não tem robô).
///
/// Pós-login, o destino é [RootShellScreen] (Tela Início, Etapa 4).
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.authRepository,
    required this.connectionRepository,
    required this.messageRepository,
    required this.contactRepository,
    required this.menuRepository,
  });

  final AuthRepository authRepository;
  final ConnectionRepository connectionRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final MenuRepository menuRepository;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isSubmitting = false;
  String? _formError;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin(AppLocalizations l10n) async {
    setState(() {
      _formError = null;
      _isSubmitting = true;
    });

    final success = await widget.authRepository.login(
      email: _emailController.text.trim(),
      password: _passwordController.text,
    );

    if (!mounted) return;

    if (!success) {
      setState(() {
        _isSubmitting = false;
        _formError = l10n.auth_login_invalid_error;
      });
      return;
    }

    Navigator.of(context).pushAndRemoveUntil(
      AppPageRoute(
        builder: (_) => RootShellScreen(
          authRepository: widget.authRepository,
          connectionRepository: widget.connectionRepository,
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          menuRepository: widget.menuRepository,
        ),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.auth_login_title)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Mascote robô grande — só aparece no Login (ver README,
              // seção 13, "Fluxo de autenticação").
              ClipRRect(
                borderRadius: BorderRadius.circular(24),
                child: Container(
                  height: 180,
                  decoration: const BoxDecoration(
                    gradient: AppColors.heroGradient,
                  ),
                  child: RiveAnimation.asset(
                    'assets/animations/robot_mascot.riv',
                    fit: BoxFit.contain,
                    stateMachines: const ['State Machine 1'],
                  ),
                ),
              ),
              const SizedBox(height: 24),
              AppTextField(
                label: l10n.auth_login_email_label,
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              AppPasswordField(
                label: l10n.auth_login_password_label,
                controller: _passwordController,
                errorText: _formError,
                textInputAction: TextInputAction.done,
              ),
              const SizedBox(height: 24),
              AppButton(
                label: _isSubmitting
                    ? l10n.common_loading
                    : l10n.auth_login_submit_button,
                onPressed: _isSubmitting ? null : () => _handleLogin(l10n),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _isSubmitting
                    ? null
                    : () => Navigator.of(context).push(
                          AppPageRoute(
                            builder: (_) => CadastroScreen(
                              authRepository: widget.authRepository,
                              connectionRepository: widget.connectionRepository,
                              messageRepository: widget.messageRepository,
                              contactRepository: widget.contactRepository,
                              menuRepository: widget.menuRepository,
                            ),
                          ),
                        ),
                child: Text(l10n.auth_login_signup_link),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
