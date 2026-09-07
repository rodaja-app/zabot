import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:rive/rive.dart';

import '../l10n/generated/app_localizations.dart';

/// Nav bar inferior com as 3 abas do app: Início, Mensagens, Menu.
/// Os ícones vêm de `bottom_nav_icons.riv` — um único arquivo com vários
/// artboards de ícone (HOME, CHAT, USER, entre outros não usados aqui).
/// Cada artboard usado tem seu próprio state machine "*_Interactivity"
/// com um input booleano `active`, ligado conforme a aba selecionada.
class ZaBotBottomNav extends StatelessWidget {
  const ZaBotBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return BottomNavigationBar(
      currentIndex: currentIndex,
      onTap: onTap,
      items: [
        BottomNavigationBarItem(
          icon: _NavRiveIcon(
            artboardName: 'HOME',
            stateMachineName: 'HOME_interactivity',
            isActive: currentIndex == 0,
          ),
          label: l10n.nav_home,
        ),
        BottomNavigationBarItem(
          icon: _NavRiveIcon(
            artboardName: 'CHAT',
            stateMachineName: 'CHAT_Interactivity',
            isActive: currentIndex == 1,
          ),
          label: l10n.nav_messages,
        ),
        BottomNavigationBarItem(
          icon: _NavRiveIcon(
            artboardName: 'USER',
            stateMachineName: 'USER_Interactivity',
            isActive: currentIndex == 2,
          ),
          label: l10n.nav_menu,
        ),
      ],
    );
  }
}

/// Um ícone animado de `bottom_nav_icons.riv`, isolado por artboard.
///
/// Nota de manutenção: mesma ressalva de `app_button.dart` sobre a API do
/// pacote `rive` podendo mudar entre versões — este widget usa o mesmo
/// padrão estável `rootBundle.load` + `RiveFile.import` +
/// `StateMachineController`.
class _NavRiveIcon extends StatefulWidget {
  const _NavRiveIcon({
    required this.artboardName,
    required this.stateMachineName,
    required this.isActive,
  });

  final String artboardName;
  final String stateMachineName;
  final bool isActive;

  static const String _asset = 'assets/animations/bottom_nav_icons.riv';

  @override
  State<_NavRiveIcon> createState() => _NavRiveIconState();
}

class _NavRiveIconState extends State<_NavRiveIcon> {
  Artboard? _artboard;
  SMIInput<bool>? _activeInput;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await rootBundle.load(_NavRiveIcon._asset);
      final file = RiveFile.import(data);
      final artboard =
          file.artboardByName(widget.artboardName) ?? file.mainArtboard;
      final controller = StateMachineController.fromArtboard(
        artboard,
        widget.stateMachineName,
      );
      if (controller != null) {
        artboard.addController(controller);
        _activeInput = controller.findInput<bool>('active');
        _activeInput?.value = widget.isActive;
      }
      if (mounted) setState(() => _artboard = artboard);
    } catch (_) {
      // Se o asset não carregar, o item de navegação fica só com o
      // rótulo de texto em vez de quebrar a barra inteira.
    }
  }

  @override
  void didUpdateWidget(covariant _NavRiveIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isActive != widget.isActive) {
      _activeInput?.value = widget.isActive;
    }
  }

  @override
  Widget build(BuildContext context) {
    final artboard = _artboard;
    if (artboard == null) {
      return const SizedBox(width: 24, height: 24);
    }
    return SizedBox(
      width: 26,
      height: 26,
      child: Rive(artboard: artboard, fit: BoxFit.contain),
    );
  }
}
