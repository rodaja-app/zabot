import '../widgets/status_badge.dart';
import 'api/api_client.dart';
import 'menu_repository.dart';
import 'models/app_info.dart';
import 'models/app_settings.dart';
import 'models/user_account.dart';

/// Implementação real de [MenuRepository] (Etapa 18 — integração final),
/// substituindo [MockMenuRepository].
///
/// A carteira/recarga (antigo plano/assinatura via RevenueCat, removido
/// nesta etapa — ver `ApiWalletRepository`) não faz mais parte deste
/// repositório: `changePlan`/`getAvailablePlans`/`getPaymentHistory` não
/// existem mais, junto com toda a integração do SDK do RevenueCat.
///
/// Rotas mapeadas 1:1 com `backend/src/settings/settings.controller.ts` e
/// `backend/src/auth/auth.controller.ts` (`GET /auth/me`, adicionada nesta
/// mesma etapa especificamente para [getAccount]).
class ApiMenuRepository implements MenuRepository {
  ApiMenuRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<UserAccount> getAccount() async {
    final body = await _apiClient.get('/auth/me') as Map<String, dynamic>;
    return UserAccount(
      name: body['name'] as String,
      email: body['email'] as String,
    );
  }

  @override
  Future<AppSettings> getSettings() async {
    final body = await _apiClient.get('/settings') as Map<String, dynamic>;
    return _settingsFromJson(body);
  }

  @override
  Future<void> updateSettings(AppSettings settings) async {
    await _apiClient.patch('/settings', body: {
      'notificationsEnabled': settings.notificationsEnabled,
      'soundEnabled': settings.soundEnabled,
    });
  }

  @override
  Future<AppInfo> getAppInfo() async {
    final body = await _apiClient.get('/app-info') as Map<String, dynamic>;
    return AppInfo(
      version: body['version'] as String,
      serviceStatus: _mapServiceStatus(body['serviceStatus'] as String?),
    );
  }

  AppSettings _settingsFromJson(Map<String, dynamic> json) {
    return AppSettings(
      notificationsEnabled: json['notificationsEnabled'] as bool,
      soundEnabled: json['soundEnabled'] as bool,
    );
  }

  AppStatus _mapServiceStatus(String? raw) {
    switch (raw) {
      case 'OPERACIONAL':
        return AppStatus.connected;
      case 'DEGRADADO':
        return AppStatus.pending;
      case 'FORA_DO_AR':
      default:
        return AppStatus.failed;
    }
  }
}
