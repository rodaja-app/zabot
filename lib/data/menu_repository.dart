import '../widgets/status_badge.dart';
import 'models/app_info.dart';
import 'models/app_settings.dart';
import 'models/user_account.dart';

/// Abstração dos dados da Tela Menu — conta e configurações (Etapa 6,
/// README.md seção 13). A carteira/recarga (antigo plano/assinatura) vive
/// em [WalletRepository] à parte, desde a substituição do RevenueCat pelo
/// saldo pré-pago via Pix (ver README do backend). A implementação real
/// (Etapa 17) troca [MockMenuRepository] por uma versão que fala com o
/// backend de verdade, sem exigir mudanças na tela.
abstract class MenuRepository {
  Future<UserAccount> getAccount();

  Future<AppSettings> getSettings();

  /// Persiste as novas configurações. Chamadas seguintes de [getSettings]
  /// devolvem o valor atualizado.
  Future<void> updateSettings(AppSettings settings);

  /// Versão do app e status do serviço, exibidos no card "Sobre" (Menu 3).
  Future<AppInfo> getAppInfo();
}

class MockMenuRepository implements MenuRepository {
  final UserAccount _account = const UserAccount(
    name: 'Rafael Andrade',
    email: 'rafael.andrade@exemplo.com',
  );

  AppSettings _settings = const AppSettings(
    notificationsEnabled: true,
    soundEnabled: true,
  );

  static const AppInfo _appInfo = AppInfo(
    version: '1.0.0',
    serviceStatus: AppStatus.connected,
  );

  /// Falha só na primeira tentativa de carregar a conta (Etapa 7,
  /// README.md seção 13) — dá pra validar o estado de erro + retry sem
  /// depender de falha aleatória a cada teste.
  bool _firstLoadFailed = false;

  @override
  Future<UserAccount> getAccount() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (!_firstLoadFailed) {
      _firstLoadFailed = true;
      throw StateError('Falha simulada ao carregar a conta (Etapa 7).');
    }
    return _account;
  }

  @override
  Future<AppSettings> getSettings() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return _settings;
  }

  @override
  Future<void> updateSettings(AppSettings settings) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    _settings = settings;
  }

  @override
  Future<AppInfo> getAppInfo() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return _appInfo;
  }
}
