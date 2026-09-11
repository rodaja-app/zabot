import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/api/api_exception.dart';
import '../../data/api/mercado_pago_card_tokenizer.dart';
import '../../data/models/recharge_package.dart';
import '../../data/models/recharge_result.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_text_field.dart';
import '../../widgets/state_views.dart';

/// Tela de recarga de créditos (Etapa 18 — substitui o antigo fluxo de
/// compra de plano via RevenueCat). Fluxo: escolher um pacote do catálogo
/// fixo → escolher método de pagamento (Etapa 19: Pix ou Cartão) → Pix cria
/// a cobrança (`POST /wallet/recharge`) e exibe QR/copia-e-cola; Cartão
/// tokeniza os dados direto com o Mercado Pago e só então chama a mesma
/// rota com o token, recebendo uma resposta já síncrona (aprovado/recusado).
///
/// Não existe push/socket para avisar quando o Pix é pago (ver README do
/// backend) — a confirmação é detectada por polling de `GET /wallet`,
/// comparando o saldo atual com o saldo capturado antes de criar a cobrança.
/// O fluxo de cartão não precisa de polling (resposta síncrona).
class WalletRechargeScreen extends StatefulWidget {
  const WalletRechargeScreen({super.key, required this.walletRepository});

  final WalletRepository walletRepository;

  @override
  State<WalletRechargeScreen> createState() => _WalletRechargeScreenState();
}

enum _Stage { packages, methodChoice, cardForm, paying, success }

class _WalletRechargeScreenState extends State<WalletRechargeScreen> {
  Future<List<RechargePackage>>? _packagesFuture;

  _Stage _stage = _Stage.packages;
  bool _isCreatingRecharge = false;
  RechargeResult? _rechargeResult;
  Timer? _pollTimer;

  RechargePackage? _selectedPackage;

  final _cardTokenizer = MercadoPagoCardTokenizer();
  final _cardNumberController = TextEditingController();
  final _cardHolderController = TextEditingController();
  final _cardExpiryMonthController = TextEditingController();
  final _cardExpiryYearController = TextEditingController();
  final _cardCvvController = TextEditingController();
  final _cardCpfController = TextEditingController();
  bool _isSubmittingCard = false;
  String? _cardFormError;

  @override
  void initState() {
    super.initState();
    _loadPackages();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _cardNumberController.dispose();
    _cardHolderController.dispose();
    _cardExpiryMonthController.dispose();
    _cardExpiryYearController.dispose();
    _cardCvvController.dispose();
    _cardCpfController.dispose();
    super.dispose();
  }

  void _loadPackages() {
    setState(() {
      _packagesFuture = widget.walletRepository.getPackages();
    });
  }

  void _choosePackage(RechargePackage package) {
    setState(() {
      _selectedPackage = package;
      _cardFormError = null;
      _stage = _Stage.methodChoice;
    });
  }

  Future<void> _chooseCustomAmount(AppLocalizations l10n) async {
    final controller = TextEditingController();
    final amount = await showDialog<double>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceCard,
        title: Text(l10n.wallet_custom_amount_title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.wallet_custom_amount_description),
            const SizedBox(height: 16),
            AppTextField(
              label: l10n.wallet_custom_amount_label,
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(l10n.common_cancel)),
          TextButton(
            onPressed: () {
              final value = double.tryParse(controller.text.replaceAll(',', '.'));
              Navigator.of(dialogContext).pop(value);
            },
            child: Text(l10n.wallet_custom_amount_continue),
          ),
        ],
      ),
    );
    controller.dispose();
    if (amount == null || amount < 10) return;

    final cents = (amount * 100).round();
    final bonus = _bonusForAmount(cents);
    final credits = ((cents / 10) * (1 + bonus / 100)).floor();
    _choosePackage(
      RechargePackage(
        id: 'personalizada-$cents',
        priceLabel: 'R\$ ${amount.toStringAsFixed(2).replaceAll('.', ',')}',
        credits: credits,
        bonusPercent: bonus,
      ),
    );
  }

  int _bonusForAmount(int cents) {
    if (cents >= 50000) return 65;
    if (cents >= 30000) return 50;
    if (cents >= 10000) return 35;
    if (cents >= 5000) return 20;
    return 10;
  }

  void _handleBack() {
    setState(() {
      if (_stage == _Stage.cardForm) {
        _cardFormError = null;
        _stage = _Stage.methodChoice;
      } else if (_stage == _Stage.methodChoice) {
        _selectedPackage = null;
        _stage = _Stage.packages;
      }
    });
  }

  Future<void> _startPixRecharge(RechargePackage package, AppLocalizations l10n) async {
    setState(() => _isCreatingRecharge = true);
    try {
      final result = await widget.walletRepository.createRecharge(package.id);
      if (!mounted) return;
      setState(() {
        _rechargeResult = result;
        _isCreatingRecharge = false;
        _stage = _Stage.paying;
      });
      _startPolling();
    } on ApiException catch (_) {
      if (!mounted) return;
      setState(() => _isCreatingRecharge = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.wallet_create_recharge_error)),
      );
    } on ApiNetworkException catch (_) {
      if (!mounted) return;
      setState(() => _isCreatingRecharge = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.wallet_create_recharge_error)),
      );
    }
  }

  /// Valida o formulário, tokeniza o cartão direto com o Mercado Pago
  /// (`MercadoPagoCardTokenizer` — dado de cartão nunca passa pelo backend
  /// do ZaBot) e só então chama `POST /wallet/recharge` com o token. A
  /// resposta já vem síncrona (aprovado/recusado), sem precisar de polling
  /// como no Pix.
  Future<void> _submitCardPayment(AppLocalizations l10n) async {
    final package = _selectedPackage;
    if (package == null) return;

    final cardNumber = _cardNumberController.text;
    final holderName = _cardHolderController.text.trim();
    final month = int.tryParse(_cardExpiryMonthController.text);
    final rawYear = _cardExpiryYearController.text;
    final year = rawYear.length == 2 ? int.tryParse('20$rawYear') : int.tryParse(rawYear);
    final cvv = _cardCvvController.text;
    final cpfDigits = _cardCpfController.text.replaceAll(RegExp(r'\D'), '');
    final brand = CardBrandDetector.detect(cardNumber);
    final paymentMethodId = brand.mercadoPagoPaymentMethodId;

    final isValid = cardNumber.replaceAll(RegExp(r'\D'), '').length >= 13 &&
        holderName.isNotEmpty &&
        month != null &&
        month >= 1 &&
        month <= 12 &&
        year != null &&
        cvv.length >= 3 &&
        cpfDigits.length == 11 &&
        paymentMethodId != null;

    if (!isValid) {
      setState(() => _cardFormError = l10n.wallet_card_form_invalid_error);
      return;
    }

    setState(() {
      _isSubmittingCard = true;
      _cardFormError = null;
    });

    try {
      final publicKey = await widget.walletRepository.getMercadoPagoPublicKey();
      if (publicKey == null) {
        throw CardTokenizationException('Chave pública do Mercado Pago indisponível.');
      }

      final cardToken = await _cardTokenizer.tokenize(
        publicKey: publicKey,
        cardNumber: cardNumber,
        cardholderName: holderName,
        expirationMonth: month,
        expirationYear: year,
        securityCode: cvv,
        cpf: cpfDigits,
      );

      final result = await widget.walletRepository.createRecharge(
        package.id,
        cardToken: cardToken,
        paymentMethodId: paymentMethodId,
        payerCpf: cpfDigits,
      );

      if (!mounted) return;
      setState(() {
        _rechargeResult = result;
        _isSubmittingCard = false;
        _stage = _Stage.success;
      });
    } on CardTokenizationException catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmittingCard = false;
        _cardFormError = l10n.wallet_card_generic_error;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmittingCard = false;
        // Recusa de cartão (`CardPaymentRejectedError`, HTTP 402) já vem com
        // uma mensagem específica e apresentável do backend (ver
        // `wallet.service.ts#cardRejectionMessage`); qualquer outro erro usa
        // a mensagem genérica.
        _cardFormError = e.isPaymentRejected ? e.message : l10n.wallet_card_generic_error;
      });
    } on ApiNetworkException catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmittingCard = false;
        _cardFormError = l10n.wallet_card_generic_error;
      });
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      final recharge = _rechargeResult;
      if (recharge == null) return;
      try {
        final status = await widget.walletRepository.getRechargeStatus(recharge.transactionId);
        if (!mounted) return;
        if (status.status == RechargeStatus.paid) {
          _pollTimer?.cancel();
          setState(() => _stage = _Stage.success);
        }
      } on Exception {
        // Falha isolada de uma tentativa de polling não deve derrubar o
        // fluxo — só tenta de novo no próximo tick.
      }
    });
  }

  Future<void> _copyPixCode(String code, AppLocalizations l10n) async {
    await Clipboard.setData(ClipboardData(text: code));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.wallet_pix_copied_message)),
    );
  }

  void _finish() {
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.wallet_recharge_screen_title),
        leading: (_stage == _Stage.methodChoice || _stage == _Stage.cardForm)
            ? IconButton(
                icon: const Icon(Icons.arrow_back_rounded),
                onPressed: _handleBack,
              )
            : null,
      ),
      body: SafeArea(
        child: switch (_stage) {
          _Stage.packages => _buildPackagesStage(l10n),
          _Stage.methodChoice => _buildMethodChoiceStage(l10n),
          _Stage.cardForm => _buildCardFormStage(l10n),
          _Stage.paying => _buildPayingStage(l10n),
          _Stage.success => _buildSuccessStage(l10n),
        },
      ),
    );
  }

  Widget _buildPackagesStage(AppLocalizations l10n) {
    return FutureBuilder<List<RechargePackage>>(
      future: _packagesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return AppLoadingView(label: l10n.common_loading);
        }
        if (snapshot.hasError) {
          return AppErrorView(
            message: l10n.common_error_message,
            retryLabel: l10n.common_retry,
            onRetry: _loadPackages,
          );
        }

        final packages = snapshot.data ?? const [];
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              l10n.wallet_packages_section_title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(l10n.wallet_credits_explanation, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(l10n.wallet_bonus_explanation, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            for (final package in packages) ...[
              _PackageTile(
                package: package,
                enabled: !_isCreatingRecharge,
                l10n: l10n,
                onTap: () => _choosePackage(package),
              ),
              const SizedBox(height: 12),
            ],
            OutlinedButton.icon(
              onPressed: _isCreatingRecharge ? null : () => _chooseCustomAmount(l10n),
              icon: const Icon(Icons.edit_rounded),
              label: Text(l10n.wallet_custom_amount_title),
            ),
            if (_isCreatingRecharge) ...[
              const SizedBox(height: 12),
              const Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _buildMethodChoiceStage(AppLocalizations l10n) {
    final package = _selectedPackage;
    if (package == null) return const SizedBox.shrink();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.wallet_pix_amount_label(package.priceLabel, package.credits),
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          Text(
            l10n.wallet_method_choice_title,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 16),
          _PaymentMethodTile(
            icon: Icons.pix_rounded,
            title: l10n.wallet_method_pix_label,
            description: l10n.wallet_method_pix_description,
            onTap: () => _startPixRecharge(package, l10n),
          ),
          const SizedBox(height: 12),
          _PaymentMethodTile(
            icon: Icons.credit_card_rounded,
            title: l10n.wallet_method_card_label,
            description: l10n.wallet_method_card_description,
            onTap: () => setState(() => _stage = _Stage.cardForm),
          ),
          if (_isCreatingRecharge) ...[
            const SizedBox(height: 16),
            const Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCardFormStage(AppLocalizations l10n) {
    final package = _selectedPackage;
    if (package == null) return const SizedBox.shrink();

    final digitsOnly = FilteringTextInputFormatter.digitsOnly;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.wallet_pix_amount_label(package.priceLabel, package.credits),
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          Text(
            l10n.wallet_card_form_title,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 16),
          AppTextField(
            label: l10n.wallet_card_number_label,
            controller: _cardNumberController,
            keyboardType: TextInputType.number,
            inputFormatters: [digitsOnly, LengthLimitingTextInputFormatter(16)],
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 16),
          AppTextField(
            label: l10n.wallet_card_holder_name_label,
            controller: _cardHolderController,
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: AppTextField(
                  label: l10n.wallet_card_expiry_month_label,
                  controller: _cardExpiryMonthController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [digitsOnly, LengthLimitingTextInputFormatter(2)],
                  textInputAction: TextInputAction.next,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: AppTextField(
                  label: l10n.wallet_card_expiry_year_label,
                  controller: _cardExpiryYearController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [digitsOnly, LengthLimitingTextInputFormatter(2)],
                  textInputAction: TextInputAction.next,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: AppTextField(
                  label: l10n.wallet_card_cvv_label,
                  controller: _cardCvvController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [digitsOnly, LengthLimitingTextInputFormatter(4)],
                  textInputAction: TextInputAction.next,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          AppTextField(
            label: l10n.wallet_card_cpf_label,
            controller: _cardCpfController,
            keyboardType: TextInputType.number,
            inputFormatters: [digitsOnly, LengthLimitingTextInputFormatter(11)],
            textInputAction: TextInputAction.done,
          ),
          if (_cardFormError != null) ...[
            const SizedBox(height: 16),
            Text(
              _cardFormError!,
              style: const TextStyle(color: AppColors.statusError),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 24),
          if (_isSubmittingCard) ...[
            Center(
              child: Column(
                children: [
                  const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.wallet_card_processing_label,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          AppButton(
            label: l10n.wallet_card_submit_button,
            onPressed: _isSubmittingCard ? null : () => _submitCardPayment(l10n),
          ),
        ],
      ),
    );
  }

  Widget _buildPayingStage(AppLocalizations l10n) {
    final result = _rechargeResult;
    if (result == null) return const SizedBox.shrink();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.wallet_pix_amount_label(result.priceLabel, result.credits),
            style: Theme.of(context).textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          _PixQrCode(base64: result.pixQrCodeBase64),
          const SizedBox(height: 16),
          Text(
            l10n.wallet_pix_instructions,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          if (result.pixQrCode != null)
            OutlinedButton.icon(
              icon: const Icon(Icons.copy_rounded),
              label: Text(l10n.wallet_pix_copy_button),
              onPressed: () => _copyPixCode(result.pixQrCode!, l10n),
            ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Text(
                l10n.wallet_pix_waiting_label,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSuccessStage(AppLocalizations l10n) {
    final result = _rechargeResult;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.check_circle_rounded,
              color: AppColors.greenPrimary,
              size: 72,
            ),
            const SizedBox(height: 16),
            Text(
              l10n.wallet_success_title,
              style: Theme.of(context).textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            if (result != null) ...[
              const SizedBox(height: 8),
              Text(
                l10n.wallet_success_message(result.credits),
                style: Theme.of(context).textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
            ],
            const SizedBox(height: 24),
            AppButton(
              label: l10n.wallet_success_button,
              onPressed: _finish,
            ),
          ],
        ),
      ),
    );
  }
}

class _PackageTile extends StatelessWidget {
  const _PackageTile({
    required this.package,
    required this.enabled,
    required this.l10n,
    required this.onTap,
  });

  final RechargePackage package;
  final bool enabled;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: enabled ? onTap : null,
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderDivider),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        package.priceLabel,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        l10n.wallet_package_credits_label(package.credits),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      Text(
                        l10n.wallet_package_bonus_label(package.bonusPercent),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.greenPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Opção de método de pagamento (Pix/Cartão) na tela de recarga — exibida
/// depois de escolher o pacote (Etapa 19).
class _PaymentMethodTile extends StatelessWidget {
  const _PaymentMethodTile({
    required this.icon,
    required this.title,
    required this.description,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String description;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderDivider),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(icon, color: AppColors.purplePrimary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text(
                        description,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Decodifica um valor base64 de imagem — igual ao QR de conexão do
/// WhatsApp (`inicio_screen.dart#_decodeQrCodeDataUrl`), aceitando tanto um
/// data URL completo (`data:image/...;base64,...`) quanto o base64 puro que
/// o Mercado Pago devolve (`point_of_interaction.transaction_data
/// .qr_code_base64`, sem prefixo).
Uint8List? _decodeQrCodeDataUrl(String value) {
  final commaIndex = value.indexOf(',');
  final base64Part = commaIndex >= 0 ? value.substring(commaIndex + 1) : value;
  try {
    return base64Decode(base64Part);
  } on FormatException {
    return null;
  }
}

class _PixQrCode extends StatelessWidget {
  const _PixQrCode({this.base64});

  final String? base64;

  @override
  Widget build(BuildContext context) {
    final base64 = this.base64;
    final imageBytes = base64 == null ? null : _decodeQrCodeDataUrl(base64);

    return Center(
      child: Container(
        width: 220,
        height: 220,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.borderDivider),
        ),
        clipBehavior: Clip.antiAlias,
        child: imageBytes != null
            ? Image.memory(
                imageBytes,
                width: 220,
                height: 220,
                fit: BoxFit.contain,
                gaplessPlayback: true,
              )
            : const Icon(
                Icons.qr_code_2_rounded,
                size: 96,
                color: AppColors.textSecondary,
              ),
      ),
    );
  }
}
