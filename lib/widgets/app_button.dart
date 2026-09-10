import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Botão de ação principal do ZaBot.
///
/// O fundo é um degradê fosco roxo → verde ([AppColors.heroGradient]),
/// mantendo o toque com `Ink` + `InkWell` para preservar o efeito de
/// ondulação (ripple) do Material. Quando desabilitado, o botão perde o
/// degradê e usa um cinza-roxo fosco e sólido.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.expand = true,
    this.gradient,
    this.boxShadow,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool expand;

  /// Degradê de fundo do botão. Usa [AppColors.heroGradient] por padrão;
  /// pode ser trocado (ex.: [AppColors.dangerGradient]) para ações
  /// destrutivas/irreversíveis.
  final Gradient? gradient;

  /// Sombra do botão (ex.: sombra avermelhada em ações destrutivas).
  final List<BoxShadow>? boxShadow;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;

    final button = Ink(
      decoration: BoxDecoration(
        gradient: enabled ? (gradient ?? AppColors.heroGradient) : null,
        color: enabled ? null : AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: enabled ? null : Border.all(color: AppColors.borderDivider),
        boxShadow: enabled ? boxShadow : null,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                color: enabled ? AppColors.textPrimary : AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ),
    );

    return SizedBox(
      width: expand ? double.infinity : null,
      child: button,
    );
  }
}
