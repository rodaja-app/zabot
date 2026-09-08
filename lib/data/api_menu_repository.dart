import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import '../widgets/status_badge.dart';
import 'api/api_client.dart';
import 'menu_repository.dart';
import 'models/app_info.dart';
import 'models/app_settings.dart';
import 'models/payment_history_entry.dart';
import 'models/plan_option.dart';
import 'models/plan_purchase_exception.dart';
import 'models/subscription_plan.dart';
import 'models/user_account.dart';

/// Implementação real de [MenuRepository] (Etapa 18 — integração final),
/// substituindo [MockMenuRepository].
///
/// Extensão deliberada sobre o contrato mockado original (mesmo espírito das
/// já feitas em `ApiConnectionRepository`/`ApiMessageRepository`): o backend
/// não expõe nenhuma rota para trocar de plano diretamente — `plans
/// .controller.ts` documenta que isso é proposital (App Store Guideline
/// 3.1.1 / política de billing da Play Store: mudança de plano só pode
/// acontecer via compra nativa). Então [changePlan] aqui não é um simples
/// `POST`: ele decide o produto RevenueCat correspondente ao [planId]
/// (cache interna [_productIdByPlanId], populada por [getAvailablePlans] —
/// nunca exposta em [PlanOption], que é o mesmo contrato que a tela usa),
/// dispara a compra nativa via SDK do RevenueCat e só depois sincroniza o
/// resultado com o backend (`POST /plans/sync`) — sem esperar o webhook
/// assíncrono, que pode levar até ~1 minuto (ver `plans.service.ts
/// .syncFromRevenueCat`).
///
/// Cancelamento da compra pelo usuário na folha nativa é fluxo normal, não
/// erro — mapeado para `PlanPurchaseException(cancelled: true)` para a tela
/// distinguir (`menu_screen.dart._showChangePlanDialog`) sem depender de
/// tipos do SDK do RevenueCat.
///
/// Rotas mapeadas 1:1 com `backend/src/plans/plans.controller.ts`,
/// `backend/src/settings/settings.controller.ts` e
/// `backend/src/auth/auth.controller.ts` (`GET /auth/me`, adicionada nesta
/// mesma etapa especificamente para [getAccount]).
class ApiMenuRepository implements MenuRepository {
  ApiMenuRepository(this._apiClient);

  final ApiClient _apiClient;

  /// planId (`Plan.id`, o que [changePlan] recebe) → productId RevenueCat.
  /// Populada por [getAvailablePlans]; [changePlan] busca o catálogo antes
  /// se ainda estiver vazia (ex.: usuário abre "Assinar/alterar plano" sem
  /// nunca ter aberto "Comparar planos" na mesma sessão do app).
  final Map<String, String> _productIdByPlanId = {};

  @override
  Future<UserAccount> getAccount() async {
    final body = await _apiClient.get('/auth/me') as Map<String, dynamic>;
    return UserAccount(
      name: body['name'] as String,
      email: body['email'] as String,
    );
  }

  @override
  Future<SubscriptionPlan> getPlan() async {
    final body = await _apiClient.get('/plans/current') as Map<String, dynamic>;
    return _planFromJson(body);
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
  Future<List<PlanOption>> getAvailablePlans() async {
    final body = await _apiClient.get('/plans/available') as List<dynamic>;
    final plans = body.map((e) => e as Map<String, dynamic>).toList();

    _productIdByPlanId
      ..clear()
      ..addEntries(plans.map(
        (json) => MapEntry(
          json['id'] as String,
          json['revenueCatProductId'] as String,
        ),
      ));

    return plans
        .map((json) => PlanOption(
              id: json['id'] as String,
              name: json['name'] as String,
              priceLabel: json['priceLabel'] as String,
              messagesLimit: json['messagesLimit'] as int,
              isCurrent: json['isCurrent'] as bool,
            ))
        .toList();
  }

  /// Compra nativa via RevenueCat (ver doc da classe). [planId] é o mesmo
  /// `Plan.id` recebido em [getAvailablePlans] — resolvido aqui para o
  /// `revenueCatProductId` correspondente antes de acionar o SDK.
  @override
  Future<SubscriptionPlan> changePlan(String planId) async {
    if (!_productIdByPlanId.containsKey(planId)) {
      await getAvailablePlans();
    }
    final productId = _productIdByPlanId[planId];
    if (productId == null) {
      throw PlanPurchaseException(
        cancelled: false,
        message: 'Plano desconhecido: $planId',
      );
    }

    try {
      final products = await Purchases.getProducts([productId]);
      if (products.isEmpty) {
        throw PlanPurchaseException(
          cancelled: false,
          message: 'Produto não encontrado no RevenueCat: $productId',
        );
      }
      await Purchases.purchaseStoreProduct(products.first);
    } on PlatformException catch (e) {
      final cancelled =
          PurchasesErrorHelper.getErrorCode(e) ==
              PurchasesErrorCode.purchaseCancelledError;
      throw PlanPurchaseException(cancelled: cancelled, message: e.message);
    }

    // Sincroniza na hora em vez de esperar o webhook assíncrono do
    // RevenueCat (que pode levar até ~1 minuto — plans.service.ts).
    final body = await _apiClient.post('/plans/sync') as Map<String, dynamic>;
    return _planFromJson(body);
  }

  @override
  Future<List<PaymentHistoryEntry>> getPaymentHistory() async {
    final body =
        await _apiClient.get('/plans/payment-history') as List<dynamic>;
    return body
        .map((e) => _paymentFromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<AppInfo> getAppInfo() async {
    final body = await _apiClient.get('/app-info') as Map<String, dynamic>;
    return AppInfo(
      version: body['version'] as String,
      serviceStatus: _mapServiceStatus(body['serviceStatus'] as String?),
    );
  }

  SubscriptionPlan _planFromJson(Map<String, dynamic> json) {
    final periodEndRaw = json['currentPeriodEnd'] as String?;
    return SubscriptionPlan(
      // Sem assinatura (ou EXPIRADA sem plano — plans.controller.ts: não
      // existe 4º estado "sem plano"), os campos de plano vêm todos nulos;
      // os fallbacks abaixo são o único texto fixo fora do sistema l10n
      // neste repositório — decisão deliberada, já que o repositório não
      // tem acesso a `BuildContext`/`AppLocalizations`.
      name: json['planName'] as String? ?? 'Nenhum plano ativo',
      priceLabel: json['priceLabel'] as String? ?? '—',
      status: _mapPlanStatus(json['status'] as String?),
      renewalDateLabel:
          periodEndRaw != null ? DateFormat('dd/MM/yyyy').format(DateTime.parse(periodEndRaw)) : '—',
      messagesUsed: json['messagesUsed'] as int,
      messagesLimit: json['messagesLimit'] as int? ?? 0,
    );
  }

  AppSettings _settingsFromJson(Map<String, dynamic> json) {
    return AppSettings(
      notificationsEnabled: json['notificationsEnabled'] as bool,
      soundEnabled: json['soundEnabled'] as bool,
    );
  }

  PaymentHistoryEntry _paymentFromJson(Map<String, dynamic> json) {
    final amountCents = json['amountCents'] as int?;
    final currency = json['currency'] as String?;
    final amountLabel = amountCents != null && currency != null
        ? NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$', decimalDigits: 2)
            .format(amountCents / 100)
        : '—';

    return PaymentHistoryEntry(
      id: json['id'] as String,
      dateLabel: DateFormat('dd/MM/yyyy')
          .format(DateTime.parse(json['occurredAt'] as String)),
      amountLabel: amountLabel,
      status: _mapPaymentStatus(json['status'] as String?),
    );
  }

  AppStatus _mapPlanStatus(String? raw) {
    switch (raw) {
      case 'ATIVA':
        return AppStatus.connected;
      case 'TRIAL':
        return AppStatus.pending;
      case 'EXPIRADA':
      default:
        return AppStatus.failed;
    }
  }

  AppStatus _mapPaymentStatus(String? raw) {
    switch (raw) {
      case 'PAGO':
        return AppStatus.sent;
      case 'PENDENTE':
        return AppStatus.pending;
      case 'FALHOU':
      default:
        return AppStatus.failed;
    }
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
