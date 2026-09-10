import 'dart:async';

import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

import '../data/auth_repository.dart';
import '../data/connection_repository.dart';
import '../data/contact_repository.dart';
import '../data/menu_repository.dart';
import '../data/message_repository.dart';
import '../data/wallet_repository.dart';
import '../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';
import 'root_shell_screen.dart';

/// Tela de abertura exibida assim que o Flutter assume a renderização
/// (substitui a tela branca nativa do Android, que só aparece por uma
/// fração de segundo antes desta). Mostra o mesmo mascote animado da tela
/// Início (idle em loop) com o nome do app, e depois de um tempo mínimo
/// segue automaticamente para [RootShellScreen] com um fade suave —
/// assim o carregamento inicial passa a sensação de algo intencional, em
/// vez de uma tela branca travada.
class SplashScreen extends StatefulWidget {
  const SplashScreen({
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
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Timer(const Duration(milliseconds: 1600), _goToApp);
  }

  void _goToApp() {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 400),
        pageBuilder: (_, __, ___) => RootShellScreen(
          authRepository: widget.authRepository,
          connectionRepository: widget.connectionRepository,
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          menuRepository: widget.menuRepository,
          walletRepository: widget.walletRepository,
        ),
        transitionsBuilder: (_, animation, __, child) =>
            FadeTransition(opacity: animation, child: child),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Mesmo tratamento visual do mascote da tela Início
            // (_ReactiveMascot): caixa com o degradê roxo/verde por trás,
            // cantos arredondados. Sem isso, o robô aparece "cru" (sem o
            // fundo para o qual a arte foi desenhada) e destoante.
            SizedBox(
              height: 220,
              width: 260,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(24),
                child: Container(
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
            ),
            const SizedBox(height: 16),
            ShaderMask(
              shaderCallback: (bounds) =>
                  AppColors.heroGradient.createShader(bounds),
              child: Text(
                l10n.app_title,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
