import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import 'data/api/api_client.dart';
import 'data/api/auth_token_store.dart';
import 'data/api/jwt_utils.dart';
import 'data/api/realtime_client.dart';
import 'data/api_auth_repository.dart';
import 'data/api_connection_repository.dart';
import 'data/api_contact_repository.dart';
import 'data/api_menu_repository.dart';
import 'data/api_message_repository.dart';
import 'data/auth_repository.dart';
import 'data/connection_repository.dart';
import 'data/contact_repository.dart';
import 'data/menu_repository.dart';
import 'data/message_repository.dart';
import 'l10n/generated/app_localizations.dart';
import 'screens/auth/login_screen.dart';
import 'screens/splash_screen.dart';
import 'theme/app_theme.dart';

/// Chave de API do RevenueCat — diferente por loja (App Store/Play Store),
/// por isso duas dart-defines em vez de uma (README RevenueCat: "each
/// platform has its own API key"). Preenchidas em build/run time, ex.:
/// `flutter run --dart-define=REVENUECAT_API_KEY_IOS=... --dart-define=REVENUECAT_API_KEY_ANDROID=...`
/// Pendência do usuário: pegar as chaves reais no dashboard do RevenueCat.
String _revenueCatApiKey() {
  const iosKey = String.fromEnvironment('REVENUECAT_API_KEY_IOS');
  const androidKey = String.fromEnvironment('REVENUECAT_API_KEY_ANDROID');
  final key = Platform.isIOS ? iosKey : androidKey;
  assert(
    key.isNotEmpty,
    'Faltou passar --dart-define=REVENUECAT_API_KEY_${Platform.isIOS ? 'IOS' : 'ANDROID'}=... '
    '(chave do dashboard do RevenueCat).',
  );
  return key;
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final tokenStore = AuthTokenStore();
  final apiClient = ApiClient(tokenStore: tokenStore);
  final realtimeClient = RealtimeClient(baseUrl: apiClient.baseUrl, tokenStore: tokenStore);

  // Identifica o RevenueCat com o mesmo id que assina os tokens (`sub` do
  // JWT — ver doc de `ApiMenuRepository`/`ApiAuthRepository._identifyRevenueCat`)
  // já no boot, para uma sessão retomada (usuário não passou por
  // login/confirmCode nesta execução) também poder comprar/ver o plano
  // corretamente na tela de Menu.
  final hasSession = await tokenStore.hasSession();
  final accessToken = hasSession ? await tokenStore.accessToken : null;
  final appUserId = accessToken != null ? subjectFromJwt(accessToken) : null;

  final configuration = PurchasesConfiguration(_revenueCatApiKey());
  if (appUserId != null) configuration.appUserID = appUserId;
  await Purchases.configure(configuration);

  runApp(ZaBotApp(
    hasSession: hasSession,
    authRepository: ApiAuthRepository(apiClient),
    connectionRepository: ApiConnectionRepository(apiClient, realtimeClient),
    messageRepository: ApiMessageRepository(apiClient, realtimeClient),
    contactRepository: ApiContactRepository(apiClient),
    menuRepository: ApiMenuRepository(apiClient),
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
  });

  final bool hasSession;
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
            )
          : LoginScreen(
              authRepository: authRepository,
              connectionRepository: connectionRepository,
              messageRepository: messageRepository,
              contactRepository: contactRepository,
              menuRepository: menuRepository,
            ),
    );
  }
}
