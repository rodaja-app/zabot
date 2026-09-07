import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

import '../theme/app_theme.dart';
import 'app_button.dart';

/// Widgets de estado reutilizáveis (Etapa 7, README.md seção 13):
/// carregamento, vazio (com o mascote reaparecendo) e erro. Todos recebem
/// texto já traduzido pelo chamador — não conhecem l10n, seguindo o mesmo
/// padrão "burro" dos demais widgets de `lib/widgets/`.

/// Indicador de carregamento padrão do app.
class AppLoadingView extends StatelessWidget {
  const AppLoadingView({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 64,
            height: 64,
            child: RiveAnimation.asset(
              'assets/animations/generic_loading.riv',
              fit: BoxFit.contain,
            ),
          ),
          if (label != null) ...[
            const SizedBox(height: 12),
            Text(
              label!,
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}

/// Estado vazio: o mascote robô reaparece (em tamanho reduzido, sem as
/// reações de conexão da Tela Início) junto de uma mensagem contextual.
class AppEmptyView extends StatelessWidget {
  const AppEmptyView({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            height: 120,
            child: RiveAnimation.asset(
              'assets/animations/robot_mascot.riv',
              fit: BoxFit.contain,
              stateMachines: const ['State Machine 1'],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            message,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Estado de erro: ícone, mensagem e botão de nova tentativa.
class AppErrorView extends StatelessWidget {
  const AppErrorView({
    super.key,
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              size: 48,
              color: AppColors.statusError,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            AppButton(label: retryLabel, onPressed: onRetry, expand: false),
          ],
        ),
      ),
    );
  }
}
