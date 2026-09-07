import 'package:flutter/material.dart';

import '../data/auth_repository.dart';
import '../data/connection_repository.dart';
import '../data/contact_repository.dart';
import '../data/menu_repository.dart';
import '../data/message_repository.dart';
import '../l10n/generated/app_localizations.dart';
import '../widgets/zabot_bottom_nav.dart';
import 'home/inicio_screen.dart';
import 'menu/menu_screen.dart';
import 'messages/mensagens_screen.dart';

/// Shell pós-autenticação: hospeda a navegação inferior (Início / Mensagens
/// / Menu). É o destino real de Login e da Confirmação de código, conforme
/// README.md seção 13.
class RootShellScreen extends StatefulWidget {
  const RootShellScreen({
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
  State<RootShellScreen> createState() => _RootShellScreenState();
}

class _RootShellScreenState extends State<RootShellScreen> {
  int _navIndex = 0;

  String _titleFor(AppLocalizations l10n) {
    switch (_navIndex) {
      case 1:
        return l10n.nav_messages;
      case 2:
        return l10n.nav_menu;
      case 0:
      default:
        return l10n.nav_home;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    final pages = <Widget>[
      InicioScreen(connectionRepository: widget.connectionRepository),
      MensagensScreen(
        messageRepository: widget.messageRepository,
        contactRepository: widget.contactRepository,
      ),
      MenuScreen(
        menuRepository: widget.menuRepository,
        connectionRepository: widget.connectionRepository,
        authRepository: widget.authRepository,
        messageRepository: widget.messageRepository,
        contactRepository: widget.contactRepository,
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(_titleFor(l10n))),
      // Troca de aba com fade suave (Etapa 8, README.md seção 13) em vez de
      // corte seco entre Início / Mensagens / Menu.
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          switchInCurve: Curves.easeOut,
          switchOutCurve: Curves.easeIn,
          child: KeyedSubtree(
            key: ValueKey<int>(_navIndex),
            child: pages[_navIndex],
          ),
        ),
      ),
      bottomNavigationBar: ZaBotBottomNav(
        currentIndex: _navIndex,
        onTap: (index) => setState(() => _navIndex = index),
      ),
    );
  }
}
