import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/api/api_client.dart';
import 'data/api/auth_token_store.dart';
import 'data/api/realtime_client.dart';
import 'data/api_auth_repository.dart';
import 'data/api_connection_repository.dart';
import 'data/api_contact_repository.dart';
import 'data/api_menu_repository.dart';
import 'data/api_message_repository.dart';
import 'data/api_wallet_repository.dart';
import 'data/auth_repository.dart';
import 'data/connection_repository.dart';
import 'data/contact_repository.dart';
import 'data/menu_repository.dart';
import 'data/message_repository.dart';
import 'data/wallet_repository.dart';
import 'l10n/generated/app_localizations.dart';
import 'screens/auth/login_screen.dart';
import 'screens/splash_screen.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final tokenStore = AuthTokenStore();
  final apiClient = ApiClient(tokenStore: tokenStore);
  final realtimeClient = RealtimeClient(baseUrl: apiClient.baseUrl, tokenStore: tokenStore);

  final hasSession = await tokenStore.hasSession();

  runApp(ZaBotApp(
    hasSession: hasSession,
    authRepository: ApiAuthRepository(apiClient),
    connectionRepository: ApiConnectionRepository(apiClient, realtimeClient),
    messageRepository: ApiMessageRepository(apiClient, realtimeClient),
    contactRepository: ApiContactRepository(apiClient),
    menuRepository: ApiMenuRepository(apiClient),
    walletRepository: ApiWalletRepository(apiClient),
  ));
}

class ZaBotApp extends StatelessWidget {
  const ZaBotApp({
    super.key,
    required this.hasSession,
    required this.authRepository,
    required this.connectionRepository,
    required this.messageRepository,
    required this.contactRepository,
    required this.menuRepository,
    required this.walletRepository,
  });

  final bool hasSession;
  final AuthRepository authRepository;
  final ConnectionRepository connectionRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final MenuRepository menuRepository;
  final WalletRepository walletRepository;

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
      // Fecha o teclado ao tocar fora de um campo, sem disputar o gesto com
      // botões, listas e outros controles. Como envolve o Navigator inteiro,
      // a regra também vale para telas abertas por rota, diálogos e modais.
      builder: (context, child) => Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => FocusManager.instance.primaryFocus?.unfocus(),
        child: child ?? const SizedBox.shrink(),
      ),
      // Com sessão salva (`AuthTokenStore.hasSession`), pula direto pra tela
      // de abertura — que já cuida de seguir para RootShellScreen sozinha —
      // em vez de pedir login de novo a cada abertura do app. Sem sessão,
      // entrada real é o Login (o bypass "TEMPORÁRIO" que existia aqui foi
      // removido nesta etapa — wiring final).
      home: hasSession
          ? SplashScreen(
              authRepository: authRepository,
              connectionRepository: connectionRepository,
              messageRepository: messageRepository,
              contactRepository: contactRepository,
              menuRepository: menuRepository,
              walletRepository: walletRepository,
            )
          : LoginScreen(
              authRepository: authRepository,
              connectionRepository: connectionRepository,
              messageRepository: messageRepository,
              contactRepository: contactRepository,
              menuRepository: menuRepository,
              walletRepository: walletRepository,
            ),
    );
  }
}
