import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:rive/rive.dart';

import '../theme/app_theme.dart';

/// Botão de ação principal do ZaBot.
///
/// Ao ser tocado, dispara a animação `button_tap_burst.riv` (efeito de
/// círculos se dispersando) sobreposta ao botão, além de chamar [onPressed].
/// O fundo é um degradê fosco roxo → verde ([AppColors.heroGradient]),
/// mantendo o toque com `Ink` + `InkWell` para preservar o efeito de
/// ondulação (ripple) do Material. Quando desabilitado, o botão perde o
/// degradê e usa um cinza-roxo fosco e sólido.
///
/// Nota de manutenção: a API do pacote `rive` pode mudar entre versões.
/// Este arquivo usa o padrão estável `rootBundle.load` + `RiveFile.import`
/// + `OneShotAnimation`. Se `flutter pub get` resolver uma versão do `rive`
/// com API diferente, ajustar conforme a documentação da versão instalada.
class AppButton extends StatefulWidget {
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

  static const String _burstAsset = 'assets/animations/button_tap_burst.riv';

  @override
  State<AppButton> createState() => _AppButtonState();
}

class _AppButtonState extends State<AppButton> {
  Artboard? _burstArtboard;
  OneShotAnimation? _burstController;
  bool _showBurst = false;

  @override
  void initState() {
    super.initState();
    _loadBurstAnimation();
  }

  Future<void> _loadBurstAnimation() async {
    try {
      final data = await rootBundle.load(AppButton._burstAsset);
      final file = RiveFile.import(data);
      final artboard = file.mainArtboard;
      if (artboard.animations.isEmpty) return;

      final controller = OneShotAnimation(
        artboard.animations.first.name,
        autoplay: false,
        onStop: () {
          if (mounted) setState(() => _showBurst = false);
        },
      );
      artboard.addController(controller);

      if (mounted) {
        setState(() {
          _burstArtboard = artboard;
          _burstController = controller;
        });
      }
    } catch (_) {
      // Se o asset não carregar por algum motivo, o botão continua
      // funcional normalmente, só sem o efeito visual do toque.
    }
  }

  void _handleTap() {
    final controller = _burstController;
    if (controller != null) {
      setState(() => _showBurst = true);
      controller.isActive = true;
    }
    widget.onPressed?.call();
  }

  @override
  void dispose() {
    _burstController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;

    final button = Ink(
      decoration: BoxDecoration(
        gradient: enabled ? (widget.gradient ?? AppColors.heroGradient) : null,
        color: enabled ? null : AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: enabled
            ? null
            : Border.all(color: AppColors.borderDivider),
        boxShadow: enabled ? widget.boxShadow : null,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: enabled ? _handleTap : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          child: Center(
            child: Text(
              widget.label,
              style: TextStyle(
                color: enabled
                    ? AppColors.textPrimary
                    : AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ),
    );

    return SizedBox(
      width: widget.expand ? double.infinity : null,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          button,
          if (_showBurst && _burstArtboard != null)
            Positioned.fill(
              child: IgnorePointer(
                child: Rive(artboard: _burstArtboard!, fit: BoxFit.contain),
              ),
            ),
        ],
      ),
    );
  }
}
