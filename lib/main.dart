import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/auth_repository.dart';
import 'data/connection_repository.dart';
import 'data/contact_repository.dart';
import 'data/menu_repository.dart';
import 'data/message_repository.dart';
import 'l10n/generated/app_localizations.dart';
import 'screens/splash_screen.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(ZaBotApp());
}

class ZaBotApp extends StatelessWidget {
  ZaBotApp({super.key})
      : authRepository = MockAuthRepository(),
        connectionRepository = MockConnectionRepository(),
        messageRepository = MockMessageRepository(),
        contactRepository = MockContactRepository(),
        menuRepository = MockMenuRepository();

  final AuthRepository authRepository;
  final ConnectionRepository connectionRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final MenuRepository menuRepository;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) => AppLocalizations.of(context)!.app_title,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('pt'),
      ],
      // TEMPORÁRIO: pulando Login/Cadastro (Etapa 3) para pré-visualizar o
      // design das telas pós-auth direto no emulador. As telas de auth
      // continuam intactas em screens/auth/ — reverter este `home` para
      // LoginScreen(...) quando o fluxo de autenticação voltar a ser a
      // entrada real do app. A tela de abertura (SplashScreen) já cuida de
      // seguir para RootShellScreen sozinha.
      home: SplashScreen(
        authRepository: authRepository,
        connectionRepository: connectionRepository,
        messageRepository: messageRepository,
        contactRepository: contactRepository,
        menuRepository: menuRepository,
      ),
    );
  }
}
