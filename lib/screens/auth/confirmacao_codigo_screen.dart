import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

import '../../data/auth_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/contact_repository.dart';
import '../../data/menu_repository.dart';
import '../../data/message_repository.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_text_field.dart';
import '../root_shell_screen.dart';

/// Tela de Confirmação de código (Etapa 3, README.md seção 13).
/// Recebida logo após o Cadastro. Ao confirmar o código, a conta passa a
/// existir de fato e o usuário entra automaticamente — sem precisar
/// passar pela tela de Login.
///
/// Pós-confirmação, o destino é [RootShellScreen] (Tela Início, Etapa 4).
class ConfirmacaoCodigoScreen extends StatefulWidget {
  const ConfirmacaoCodigoScreen({
    super.key,
    required this.authRepository,
    required this.connectionRepository,
    required this.messageRepository,
    required this.contactRepository,
    required this.menuRepository,
    required this.walletRepository,
    required this.email,
  });

  final AuthRepository authRepository;
  final ConnectionRepository connectionRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final MenuRepository menuRepository;
  final WalletRepository walletRepository;
  final String email;

  @override
  State<ConfirmacaoCodigoScreen> createState() =>
      _ConfirmacaoCodigoScreenState();
}

class _ConfirmacaoCodigoScreenState extends State<ConfirmacaoCodigoScreen> {
  final _codeController = TextEditingController();

  bool _isSubmitting = false;
  bool _showSuccess = false;
  String? _codeError;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _handleConfirm(AppLocalizations l10n) async {
    setState(() {
      _codeError = null;
      _isSubmitting = true;
    });

    final success = await widget.authRepository.confirmCode(
      email: widget.email,
      code: _codeController.text.trim(),
    );

    if (!mounted) return;

    if (!success) {
      setState(() {
        _isSubmitting = false;
        _codeError = l10n.auth_codigo_invalid_error;
      });
      return;
    }

    // Mostra a animação de sucesso (success_confirmation.riv) por um
    // instante antes de entrar no app, em vez de navegar imediatamente.
    setState(() => _showSuccess = true);
    await Future.delayed(const Duration(milliseconds: 900));
    if (!mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      AppPageRoute(
        builder: (_) => RootShellScreen(
          authRepository: widget.authRepository,
          connectionRepository: widget.connectionRepository,
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          menuRepository: widget.menuRepository,
          walletRepository: widget.walletRepository,
        ),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.auth_codigo_title)),
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.auth_codigo_subtitle(widget.email),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 24),
                  AppTextField(
                    label: l10n.auth_codigo_label,
                    controller: _codeController,
                    keyboardType: TextInputType.number,
                    errorText: _codeError,
                    textInputAction: TextInputAction.done,
                  ),
                  const SizedBox(height: 24),
                  AppButton(
                    label: _isSubmitting
                        ? l10n.common_loading
                        : l10n.auth_codigo_confirm_button,
                    onPressed: _isSubmitting
                        ? null
                        : () => _handleConfirm(l10n),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: _isSubmitting
                        ? null
                        : () => widget.authRepository.resendCode(
                              email: widget.email,
                            ),
                    child: Text(l10n.auth_codigo_resend_link),
                  ),
                ],
              ),
            ),
            if (_showSuccess)
              Positioned.fill(
                child: Container(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 96,
                          height: 96,
                          child: RiveAnimation.asset(
                            'assets/animations/success_confirmation.riv',
                            fit: BoxFit.contain,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          l10n.auth_codigo_success_message,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
