import '../widgets/status_badge.dart';
import 'models/app_info.dart';
import 'models/app_settings.dart';
import 'models/payment_history_entry.dart';
import 'models/plan_option.dart';
import 'models/subscription_plan.dart';
import 'models/user_account.dart';

/// Abstração dos dados da Tela Menu — conta, plano/assinatura e
/// configurações (Etapa 6, README.md seção 13). A implementação real
/// (Etapa 17) troca [MockMenuRepository] por uma versão que fala com o
/// backend de verdade, sem exigir mudanças na tela.
abstract class MenuRepository {
  Future<UserAccount> getAccount();

  Future<SubscriptionPlan> getPlan();

  Future<AppSettings> getSettings();

  /// Persiste as novas configurações. Chamadas seguintes de [getSettings]
  /// devolvem o valor atualizado.
  Future<void> updateSettings(AppSettings settings);

  /// Planos disponíveis para o diálogo "Comparar planos" (Menu 3).
  Future<List<PlanOption>> getAvailablePlans();

  /// Troca o plano atual para [planId] (diálogo "Assinar/alterar plano",
  /// Menu 3). Retorna o novo plano já atualizado.
  Future<SubscriptionPlan> changePlan(String planId);

  /// Histórico de cobranças exibido no diálogo "Histórico de pagamentos"
  /// (Menu 3), mais recente primeiro.
  Future<List<PaymentHistoryEntry>> getPaymentHistory();

  /// Versão do app e status do serviço, exibidos no card "Sobre" (Menu 3).
  Future<AppInfo> getAppInfo();
}

class MockMenuRepository implements MenuRepository {
  final UserAccount _account = const UserAccount(
    name: 'Rafael Andrade',
    email: 'rafael.andrade@exemplo.com',
  );

  SubscriptionPlan _plan = const SubscriptionPlan(
    name: 'Plano Pro',
    priceLabel: 'R\$ 99,90/mês',
    status: AppStatus.connected,
    renewalDateLabel: '05/10/2026',
    messagesUsed: 3120,
    messagesLimit: 5000,
  );

  AppSettings _settings = const AppSettings(
    notificationsEnabled: true,
    soundEnabled: true,
  );

  final List<PlanOption> _availablePlans = const [
    PlanOption(
      id: 'basico',
      name: 'Plano Básico',
      priceLabel: 'R\$ 39,90/mês',
      messagesLimit: 1000,
    ),
    PlanOption(
      id: 'pro',
      name: 'Plano Pro',
      priceLabel: 'R\$ 99,90/mês',
      messagesLimit: 5000,
      isCurrent: true,
    ),
    PlanOption(
      id: 'premium',
      name: 'Plano Premium',
      priceLabel: 'R\$ 199,90/mês',
      messagesLimit: 15000,
    ),
  ];

  final List<PaymentHistoryEntry> _paymentHistory = const [
    PaymentHistoryEntry(
      id: 'p3',
      dateLabel: '05/09/2026',
      amountLabel: 'R\$ 99,90',
      status: AppStatus.sent,
    ),
    PaymentHistoryEntry(
      id: 'p2',
      dateLabel: '05/08/2026',
      amountLabel: 'R\$ 99,90',
      status: AppStatus.sent,
    ),
    PaymentHistoryEntry(
      id: 'p1',
      dateLabel: '05/07/2026',
      amountLabel: 'R\$ 99,90',
      status: AppStatus.failed,
    ),
  ];

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
  Future<SubscriptionPlan> getPlan() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    return _plan;
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
  Future<List<PlanOption>> getAvailablePlans() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    return List.unmodifiable(_availablePlans);
  }

  @override
  Future<SubscriptionPlan> changePlan(String planId) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final option = _availablePlans.firstWhere((plan) => plan.id == planId);
    _plan = SubscriptionPlan(
      name: option.name,
      priceLabel: option.priceLabel,
      status: AppStatus.connected,
      renewalDateLabel: _plan.renewalDateLabel,
      messagesUsed: _plan.messagesUsed,
      messagesLimit: _plan.messagesLimit,
    );
    return _plan;
  }

  @override
  Future<List<PaymentHistoryEntry>> getPaymentHistory() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    return List.unmodifiable(_paymentHistory);
  }

  @override
  Future<AppInfo> getAppInfo() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return _appInfo;
  }
}
