import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/auth_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/contact_repository.dart';
import '../../data/menu_repository.dart';
import '../../data/message_repository.dart';
import '../../data/models/app_info.dart';
import '../../data/models/app_settings.dart';
import '../../data/models/user_account.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/state_views.dart';
import '../../widgets/status_badge.dart';
import '../auth/login_screen.dart';

/// Tela Menu (Etapa 6, README.md seção 13).
///
/// Conta, carteira de créditos, configurações e conexão do WhatsApp — tudo
/// sobre [MenuRepository]/[WalletRepository] e [ConnectionRepository]
/// mockados. A gestão da conexão (conectar/desconectar) continua exclusiva
/// da Tela Início; aqui ela só é exibida em modo leitura, para evitar dois
/// pontos de mutação para o mesmo estado.
///
/// Recebe também [messageRepository] e [contactRepository] só para poder
/// reconstruir a árvore de navegação até [LoginScreen] no logout (mesmo
/// padrão de repositórios que já é passado adiante pelas telas de auth).
class MenuScreen extends StatefulWidget {
  const MenuScreen({
    super.key,
    required this.menuRepository,
    required this.connectionRepository,
    required this.authRepository,
    required this.messageRepository,
    required this.contactRepository,
    required this.walletRepository,
  });

  final MenuRepository menuRepository;
  final ConnectionRepository connectionRepository;
  final AuthRepository authRepository;
  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final WalletRepository walletRepository;

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  Future<UserAccount>? _accountFuture;
  Future<AppInfo>? _appInfoFuture;
  AppSettings? _settings;

  bool _isLoggingOut = false;
  bool _isDeletingAccount = false;

  @override
  void initState() {
    super.initState();
    _loadAccount();
    _appInfoFuture = widget.menuRepository.getAppInfo();
    widget.menuRepository.getSettings().then((settings) {
      if (!mounted) return;
      setState(() => _settings = settings);
    });
  }

  void _loadAccount() {
    setState(() {
      _accountFuture = widget.menuRepository.getAccount();
    });
  }

  void _updateSettings(AppSettings settings) {
    setState(() => _settings = settings);
    widget.menuRepository.updateSettings(settings);
  }

  Future<void> _goToLogin() async {
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      AppPageRoute(
        builder: (_) => LoginScreen(
          authRepository: widget.authRepository,
          connectionRepository: widget.connectionRepository,
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          menuRepository: widget.menuRepository,
          walletRepository: widget.walletRepository,
        ),
      ),
      (route) => false,
    );
  }

  Future<void> _handleLogout() async {
    setState(() => _isLoggingOut = true);
    await widget.authRepository.logout();
    await _goToLogin();
  }

  Future<void> _handleDeleteAccount() async {
    setState(() => _isDeletingAccount = true);
    await widget.authRepository.deleteAccount();
    await _goToLogin();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _AccountCard(
          accountFuture: _accountFuture,
          l10n: l10n,
          onRetry: _loadAccount,
        ),
        const SizedBox(height: 24),
        _SettingsCard(
          settings: _settings,
          l10n: l10n,
          onChanged: _updateSettings,
        ),
        const SizedBox(height: 24),
        _SupportCard(l10n: l10n),
        const SizedBox(height: 24),
        _LegalCard(l10n: l10n),
        const SizedBox(height: 24),
        _AboutCard(appInfoFuture: _appInfoFuture, l10n: l10n),
        const SizedBox(height: 24),
        _DangerZoneCard(
          l10n: l10n,
          isLoggingOut: _isLoggingOut,
          isDeletingAccount: _isDeletingAccount,
          onLogout: _handleLogout,
          onDeleteAccount: _handleDeleteAccount,
        ),
      ],
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({
    required this.accountFuture,
    required this.l10n,
    required this.onRetry,
  });

  final Future<UserAccount>? accountFuture;
  final AppLocalizations l10n;
  final VoidCallback onRetry;

  /// Conteúdo (nome/e-mail) só aparece dentro do modal, ao clicar no botão
  /// "Minha Conta" — evita expor o e-mail direto na lista do Menu.
  ///
  /// Antes usava FutureBuilder dentro do AlertDialog: mesmo com o Future já
  /// resolvido (carregado no initState da tela), o FutureBuilder sempre
  /// renderiza um primeiro frame em "waiting" antes do microtask resolver,
  /// o que aparecia como um loading piscando rápido toda vez que o modal
  /// abria. Agora aguardamos o Future ANTES de abrir o diálogo, então ele
  /// já nasce com o conteúdo final pronto.
  Future<void> _showAccountDialog(BuildContext context) async {
    UserAccount account;
    try {
      account = await accountFuture!;
    } catch (_) {
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l10n.menu_account_card_title),
          content: AppErrorView(
            message: l10n.common_error_message,
            retryLabel: l10n.common_retry,
            onRetry: () {
              Navigator.of(dialogContext).pop();
              onRetry();
            },
          ),
        ),
      );
      return;
    }
    if (!context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.menu_account_card_title),
        content: SizedBox(
          width: double.maxFinite,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircleAvatar(
                radius: 24,
                backgroundColor: AppColors.purpleDark,
                child: Icon(
                  Icons.person_rounded,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(width: 16),
              Flexible(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      account.name,
                      style: Theme.of(dialogContext).textTheme.bodyLarge,
                    ),
                    Text(
                      account.email,
                      style: Theme.of(dialogContext).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(20),
        title: Text(
          l10n.menu_account_card_title,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => _showAccountDialog(context),
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({
    required this.settings,
    required this.l10n,
    required this.onChanged,
  });

  final AppSettings? settings;
  final AppLocalizations l10n;
  final ValueChanged<AppSettings> onChanged;

  /// Notificações e som só aparecem dentro do modal de Configurações — não
  /// ficam expostos direto na lista do Menu.
  Future<void> _showSettingsDialog(BuildContext context) {
    final initial = settings;
    if (initial == null) return Future.value();
    return showDialog<void>(
      context: context,
      builder: (dialogContext) {
        var current = initial;
        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: Text(l10n.menu_settings_card_title),
            content: SizedBox(
              width: double.maxFinite,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: current.notificationsEnabled,
                    onChanged: (value) {
                      final updated = current.copyWith(
                        notificationsEnabled: value,
                      );
                      onChanged(updated);
                      setDialogState(() => current = updated);
                    },
                    title: Text(l10n.menu_settings_notifications_label),
                    activeColor: AppColors.purplePrimary,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: current.soundEnabled,
                    onChanged: (value) {
                      final updated = current.copyWith(soundEnabled: value);
                      onChanged(updated);
                      setDialogState(() => current = updated);
                    },
                    title: Text(l10n.menu_settings_sound_label),
                    activeColor: AppColors.purplePrimary,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(l10n.common_cancel),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final settings = this.settings;

    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(20),
        title: Text(
          l10n.menu_settings_card_title,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        trailing: settings == null
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.chevron_right_rounded),
        onTap: settings == null ? null : () => _showSettingsDialog(context),
      ),
    );
  }
}

class _SupportCard extends StatelessWidget {
  const _SupportCard({required this.l10n});

  final AppLocalizations l10n;

  Future<void> _copyEmail(BuildContext context) async {
    await Clipboard.setData(
      ClipboardData(text: l10n.menu_support_email_address),
    );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.menu_support_email_copied)),
    );
  }

  /// E-mail só aparece dentro do modal, ao clicar em "Suporte".
  Future<void> _showSupportDialog(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.menu_support_card_title),
        content: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                l10n.menu_support_email_address,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ),
            IconButton(
              tooltip: l10n.menu_support_copy_tooltip,
              icon: const Icon(Icons.copy_rounded),
              onPressed: () => _copyEmail(dialogContext),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(20),
        title: Text(
          l10n.menu_support_card_title,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => _showSupportDialog(context),
      ),
    );
  }
}

class _LegalCard extends StatelessWidget {
  const _LegalCard({required this.l10n});

  final AppLocalizations l10n;

  Future<void> _showTextDialog(
    BuildContext context, {
    required String title,
    required String body,
  }) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(body)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.menu_legal_card_title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.menu_legal_terms_label),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => _showTextDialog(
                context,
                title: l10n.menu_legal_terms_label,
                body: l10n.menu_legal_terms_body,
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.menu_legal_privacy_label),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => _showTextDialog(
                context,
                title: l10n.menu_legal_privacy_label,
                body: l10n.menu_legal_privacy_body,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AboutCard extends StatelessWidget {
  const _AboutCard({required this.appInfoFuture, required this.l10n});

  final Future<AppInfo>? appInfoFuture;
  final AppLocalizations l10n;

  String _serviceStatusLabel(AppStatus status) {
    switch (status) {
      case AppStatus.connected:
        return l10n.menu_about_service_status_operational;
      case AppStatus.pending:
        return l10n.menu_about_service_status_degraded;
      case AppStatus.failed:
        return l10n.menu_about_service_status_down;
      case AppStatus.sent:
        return l10n.menu_about_service_status_operational;
    }
  }

  /// Versão/descrição/status só aparecem dentro do modal, ao clicar em
  /// "Sobre".
  // Mesma correção: aguarda o Future cacheado antes de abrir o modal, em
  // vez de deixar o FutureBuilder piscar "waiting" por um frame.
  Future<void> _showAboutDialog(BuildContext context) async {
    if (appInfoFuture == null) return;
    final info = await appInfoFuture!;
    if (!context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.menu_about_card_title),
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.menu_about_version_label(info.version),
                style: Theme.of(dialogContext).textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              Text(
                l10n.menu_about_app_description,
                style: Theme.of(dialogContext).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    l10n.menu_about_service_status_label,
                    style: Theme.of(dialogContext).textTheme.bodyMedium,
                  ),
                  const SizedBox(width: 8),
                  StatusBadge(
                    status: info.serviceStatus,
                    label: _serviceStatusLabel(info.serviceStatus),
                  ),
                ],
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(20),
        title: Text(
          l10n.menu_about_card_title,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => _showAboutDialog(context),
      ),
    );
  }
}

class _DangerZoneCard extends StatelessWidget {
  const _DangerZoneCard({
    required this.l10n,
    required this.isLoggingOut,
    required this.isDeletingAccount,
    required this.onLogout,
    required this.onDeleteAccount,
  });

  final AppLocalizations l10n;
  final bool isLoggingOut;
  final bool isDeletingAccount;
  final VoidCallback onLogout;
  final VoidCallback onDeleteAccount;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.menu_danger_delete_confirm_title),
        content: Text(l10n.menu_danger_delete_confirm_message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.common_cancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.menu_danger_delete_confirm_button),
          ),
        ],
      ),
    );
    if (confirmed == true) onDeleteAccount();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.menu_danger_card_title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: isLoggingOut ? null : onLogout,
              child: Text(
                isLoggingOut
                    ? l10n.common_loading
                    : l10n.menu_account_logout_button,
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.statusError,
                side: const BorderSide(color: AppColors.statusError),
              ),
              onPressed: isDeletingAccount
                  ? null
                  : () => _confirmDelete(context),
              child: Text(
                isDeletingAccount
                    ? l10n.common_loading
                    : l10n.menu_danger_delete_account_button,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
