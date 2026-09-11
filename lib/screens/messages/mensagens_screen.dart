import 'dart:async';

import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

import '../../data/contact_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/message_repository.dart';
import '../../data/wallet_repository.dart';
import '../../data/models/campaign.dart';
import '../../data/models/campaign_media_type.dart';
import '../../data/models/contact.dart';
import '../../data/models/contact_import_result.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_text_field.dart';
import '../../widgets/state_views.dart';
import '../../widgets/status_badge.dart';
import 'campanhas_enviadas_screen.dart';
import 'nova_campanha_screen.dart';

/// Tela Mensagens (Etapa 5, README.md seção 13; Menu 2 — Mensagens).
///
/// Duas abas: Campanhas (lista + criação, com progresso de envio ao vivo) e
/// Contatos (importação por texto colado + lista com edição/remoção antes
/// do envio). Tudo consumindo [MessageRepository] e [ContactRepository]
/// mockados — trocar pelas implementações reais só na Etapa 17.
class MensagensScreen extends StatefulWidget {
  const MensagensScreen({
    super.key,
    required this.messageRepository,
    required this.contactRepository,
    required this.connectionRepository,
    required this.walletRepository,
  });

  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final ConnectionRepository connectionRepository;
  final WalletRepository walletRepository;

  @override
  State<MensagensScreen> createState() => _MensagensScreenState();
}

class _MensagensScreenState extends State<MensagensScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Column(
      children: [
        SizedBox(
          height: 140,
          width: double.infinity,
          child: ClipRect(
            child: RiveAnimation.asset(
              'assets/animations/Robo2.riv',
              fit: BoxFit.cover,
              alignment: Alignment.topCenter,
            ),
          ),
        ),
        TabBar(
          controller: _tabController,
          labelColor: AppColors.greenPrimary,
          unselectedLabelColor: AppColors.textSecondary,
          indicatorColor: AppColors.greenPrimary,
          indicatorWeight: 3,
          labelStyle: const TextStyle(fontWeight: FontWeight.w700),
          tabs: [
            Tab(
              icon: const Icon(Icons.campaign_outlined),
              text: l10n.messages_tab_campaigns,
            ),
            Tab(
              icon: const Icon(Icons.people_outline_rounded),
              text: l10n.messages_tab_contacts,
            ),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            // Sem isso, dava pra arrastar o dedo pro lado e trocar de aba
            // (Campanhas/Contatos) por gesto, duplicando o clique nas abas
            // do TabBar acima — troca de aba agora só pelo toque no nome.
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _CampaignsTab(
                messageRepository: widget.messageRepository,
                contactRepository: widget.contactRepository,
                connectionRepository: widget.connectionRepository,
                walletRepository: widget.walletRepository,
              ),
              _ContactsTab(contactRepository: widget.contactRepository),
            ],
          ),
        ),
      ],
    );
  }
}

class _CampaignsTab extends StatefulWidget {
  const _CampaignsTab({
    required this.messageRepository,
    required this.contactRepository,
    required this.connectionRepository,
    required this.walletRepository,
  });

  final MessageRepository messageRepository;
  final ContactRepository contactRepository;
  final ConnectionRepository connectionRepository;
  final WalletRepository walletRepository;

  @override
  State<_CampaignsTab> createState() => _CampaignsTabState();
}

class _CampaignsTabState extends State<_CampaignsTab> {
  late List<Campaign> _campaigns;
  StreamSubscription<List<Campaign>>? _subscription;

  @override
  void initState() {
    super.initState();
    _campaigns = widget.messageRepository.currentCampaigns;
    _subscription = widget.messageRepository.campaignsStream.listen((
      campaigns,
    ) {
      if (!mounted) return;
      setState(() => _campaigns = campaigns);
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  Future<void> _openNovaCampanha() async {
    await Navigator.of(context).push(
      AppPageRoute(
        builder: (_) => NovaCampanhaScreen(
          messageRepository: widget.messageRepository,
          contactRepository: widget.contactRepository,
          connectionRepository: widget.connectionRepository,
          walletRepository: widget.walletRepository,
        ),
      ),
    );
  }

  Future<void> _openContactsDirectory() async {
    await showDialog<void>(
      context: context,
      builder: (_) => _ContactsDirectoryDialog(
        contactRepository: widget.contactRepository,
      ),
    );
  }

  Future<void> _openCampanhasEnviadas() async {
    await Navigator.of(context).push(
      AppPageRoute(
        builder: (_) => CampanhasEnviadasScreen(
          messageRepository: widget.messageRepository,
        ),
      ),
    );
  }

  Future<void> _handleImportContacts() async {
    final l10n = AppLocalizations.of(context)!;
    final result = await showDialog<ContactImportResult>(
      context: context,
      builder: (_) =>
          _ImportContactsDialog(contactRepository: widget.contactRepository),
    );
    if (result == null || !mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result.skipped > 0
              ? l10n.messages_contacts_import_result_with_skipped(
                  result.imported,
                  result.skipped,
                )
              : l10n.messages_contacts_import_result(result.imported),
        ),
      ),
    );
  }

  Future<void> _handleClearHistory() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceCard,
        title: Text(l10n.messages_campaigns_clear_history_confirm_title),
        content: Text(l10n.messages_campaigns_clear_history_confirm_message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.common_cancel),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.statusError),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.messages_campaigns_clear_history_confirm_button),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    await widget.messageRepository.clearHistory();
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.messages_campaigns_clear_history_success)),
    );
  }

  /// Só campanhas em andamento ou com falha ficam na lista principal —
  /// as já enviadas com sucesso vão para a tela separada de histórico
  /// (evita a lista crescer indefinidamente e virar poluição visual).
  List<Campaign> get _activeCampaigns =>
      _campaigns.where((c) => c.status != AppStatus.sent).toList();

  int get _sentCount =>
      _campaigns.where((c) => c.status == AppStatus.sent).length;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final activeCampaigns = _activeCampaigns;
    final sentCount = _sentCount;

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppButton(
            label: l10n.messages_campaigns_new_button,
            onPressed: _openNovaCampanha,
            expand: false,
          ),
          const SizedBox(height: 12),
          AppButton(
            label: l10n.messages_contacts_import_button,
            onPressed: _handleImportContacts,
            expand: false,
          ),
          const SizedBox(height: 12),
          AppButton(
            label: l10n.messages_contacts_directory_button,
            onPressed: _openContactsDirectory,
            expand: false,
          ),
          if (sentCount > 0) ...[
            const SizedBox(height: 12),
            AppButton(
              label: l10n.messages_campaigns_view_sent_button(sentCount),
              onPressed: _openCampanhasEnviadas,
              expand: false,
            ),
          ],
          if (_campaigns.isNotEmpty) ...[
            const SizedBox(height: 12),
            AppButton(
              label: l10n.messages_campaigns_clear_history_button,
              onPressed: _handleClearHistory,
              expand: false,
              gradient: AppColors.dangerGradient,
              boxShadow: [
                BoxShadow(
                  color: AppColors.statusError.withOpacity(0.35),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          Expanded(
            child: activeCampaigns.isEmpty
                ? AppEmptyView(message: l10n.messages_campaigns_empty)
                : ListView.separated(
                    itemCount: activeCampaigns.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) => CampaignCard(
                      campaign: activeCampaigns[index],
                      l10n: l10n,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Card de campanha (Menu 2). Público porque também é reaproveitado pela
/// tela de histórico [../messages/campanhas_enviadas_screen.dart].
class CampaignCard extends StatelessWidget {
  const CampaignCard({super.key, required this.campaign, required this.l10n});

  final Campaign campaign;
  final AppLocalizations l10n;

  String _statusLabel() {
    switch (campaign.status) {
      case AppStatus.sent:
        return l10n.messages_status_sent_label;
      case AppStatus.failed:
        return l10n.messages_status_failed_label;
      case AppStatus.pending:
        return l10n.messages_status_pending_label;
      case AppStatus.connected:
        return l10n.messages_status_sent_label;
    }
  }

  IconData? get _mediaIcon {
    switch (campaign.mediaType) {
      case CampaignMediaType.images:
        return Icons.photo_rounded;
      case CampaignMediaType.document:
        return Icons.description_rounded;
      case CampaignMediaType.audio:
        return Icons.mic_rounded;
      case CampaignMediaType.none:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSending = campaign.status == AppStatus.pending;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    campaign.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(width: 8),
                StatusBadge(status: campaign.status, label: _statusLabel()),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              campaign.messagePreview,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(
                  Icons.people_alt_rounded,
                  size: 16,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(width: 4),
                Text(
                  l10n.messages_campaign_recipients_count(
                    campaign.recipientCount,
                  ),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                if (campaign.messages.length > 1) ...[
                  const SizedBox(width: 16),
                  const Icon(
                    Icons.forum_rounded,
                    size: 16,
                    color: AppColors.textSecondary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${campaign.messages.length}',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
                if (_mediaIcon != null) ...[
                  const SizedBox(width: 16),
                  Icon(_mediaIcon, size: 16, color: AppColors.textSecondary),
                  if (campaign.mediaType == CampaignMediaType.images &&
                      campaign.mediaCount > 1) ...[
                    const SizedBox(width: 4),
                    Text(
                      '${campaign.mediaCount}',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ],
              ],
            ),
            if (isSending) ...[
              const SizedBox(height: 14),
              _SendProgressBar(progress: campaign.progress),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _MiniStat(
                      label: l10n.messages_campaign_sent_count_label,
                      value: '${campaign.sentCount}',
                    ),
                  ),
                  Expanded(
                    child: _MiniStat(
                      label: l10n.messages_campaign_pending_count_label,
                      value: '${campaign.pendingCount}',
                    ),
                  ),
                  Expanded(
                    child: _MiniStat(
                      label: l10n.messages_campaign_failed_count_label,
                      value: '${campaign.failedCount}',
                    ),
                  ),
                  Expanded(
                    child: _MiniStat(
                      label: l10n.messages_campaign_total_count_label,
                      value: '${campaign.recipientCount}',
                    ),
                  ),
                ],
              ),
            ] else if (campaign.failedCount > 0) ...[
              const SizedBox(height: 10),
              Text(
                l10n.messages_campaign_failed_summary(campaign.failedCount),
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: AppColors.statusError),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Barra de progresso nativa do envio (Menu 2, seção "Iniciar envio").
/// Substitui a animação Rive antiga: reflete o [progress] real da campanha
/// (enviados + falhas / total) e mantém as pontas sempre arredondadas, sem
/// risco de corte visual.
class _SendProgressBar extends StatelessWidget {
  const _SendProgressBar({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: SizedBox(
        height: 10,
        child: Stack(
          children: [
            Container(color: AppColors.borderDivider),
            FractionallySizedBox(
              widthFactor: progress.clamp(0.0, 1.0),
              child: DecoratedBox(
                decoration: const BoxDecoration(gradient: AppColors.heroGradient),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Contador compacto usado na barra de progresso de envio do card de
/// campanha (Menu 2, seção "Iniciar envio").
class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontSize: 16),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

/// Modal de consulta rápida dos contatos importados. Fica acessível já na
/// primeira tela de Mensagens, sem obrigar a pessoa a descobrir a outra aba
/// ou entrar no fluxo de criação de campanha.
class _ContactsDirectoryDialog extends StatefulWidget {
  const _ContactsDirectoryDialog({required this.contactRepository});

  final ContactRepository contactRepository;

  @override
  State<_ContactsDirectoryDialog> createState() =>
      _ContactsDirectoryDialogState();
}

class _ContactsDirectoryDialogState extends State<_ContactsDirectoryDialog> {
  final _searchController = TextEditingController();
  List<Contact> _contacts = [];
  bool _isLoading = true;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() => setState(() {}));
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    setState(() {
      _isLoading = true;
      _hasError = false;
    });
    try {
      final contacts = await widget.contactRepository.getContacts();
      if (!mounted) return;
      setState(() {
        _contacts = contacts;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _isLoading = false;
      });
    }
  }

  List<Contact> get _filteredContacts {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return _contacts;
    return _contacts
        .where(
          (contact) =>
              contact.displayLabel.toLowerCase().contains(query) ||
              contact.phone.toLowerCase().contains(query),
        )
        .toList();
  }

  Future<void> _editContact(Contact contact) async {
    final contacts = await showDialog<List<Contact>>(
      context: context,
      builder: (_) => _EditContactDialog(
        contact: contact,
        contactRepository: widget.contactRepository,
      ),
    );
    if (contacts == null || !mounted) return;
    setState(() => _contacts = contacts);
  }

  Future<void> _removeContact(Contact contact) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceCard,
        title: Text(l10n.common_remove),
        content: Text(contact.displayLabel),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.common_cancel),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.statusError),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.common_remove),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final contacts = await widget.contactRepository.removeContact(contact.id);
      if (!mounted) return;
      setState(() => _contacts = contacts);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.common_error_message)),
      );
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final contacts = _filteredContacts;
    return AlertDialog(
      backgroundColor: AppColors.surfaceCard,
      title: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.greenPrimary.withOpacity(0.18),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.people_alt_rounded,
              color: AppColors.greenPrimary,
              size: 19,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(l10n.messages_contacts_directory_title)),
        ],
      ),
      content: SizedBox(
        width: double.maxFinite,
        height: 440,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.messages_contacts_directory_description,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 14),
            AppTextField(
              label: l10n.messages_contacts_search_hint,
              controller: _searchController,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _isLoading
                  ? AppLoadingView(label: l10n.common_loading)
                  : _hasError
                  ? AppErrorView(
                      message: l10n.common_error_message,
                      retryLabel: l10n.common_retry,
                      onRetry: _loadContacts,
                    )
                  : contacts.isEmpty
                  ? AppEmptyView(message: l10n.messages_contacts_empty)
                  : ListView.separated(
                      itemCount: contacts.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final contact = contacts[index];
                        final hasName = contact.displayLabel != contact.phone;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          onTap: () => _editContact(contact),
                          leading: CircleAvatar(
                            backgroundColor: AppColors.purplePrimary
                                .withOpacity(0.22),
                            child: Text(
                              contact.displayLabel.substring(0, 1).toUpperCase(),
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          title: Text(contact.displayLabel),
                          subtitle: hasName ? Text(contact.phone) : null,
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                tooltip: l10n.common_save,
                                onPressed: () => _editContact(contact),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                              IconButton(
                                tooltip: l10n.common_remove,
                                onPressed: () => _removeContact(contact),
                                icon: const Icon(
                                  Icons.delete_outline_rounded,
                                  color: AppColors.statusError,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.common_cancel),
        ),
      ],
    );
  }
}

class _ContactsTab extends StatefulWidget {
  const _ContactsTab({required this.contactRepository});

  final ContactRepository contactRepository;

  @override
  State<_ContactsTab> createState() => _ContactsTabState();
}

class _ContactsTabState extends State<_ContactsTab> {
  List<Contact> _contacts = [];
  bool _isLoading = true;
  bool _hasError = false;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadContacts();
    _searchController.addListener(() => setState(() {}));
  }

  Future<void> _loadContacts() async {
    setState(() {
      _isLoading = true;
      _hasError = false;
    });

    try {
      final contacts = await widget.contactRepository.getContacts();
      if (!mounted) return;
      setState(() {
        _contacts = contacts;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _isLoading = false;
      });
    }
  }

  Future<void> _handleImport() async {
    final l10n = AppLocalizations.of(context)!;
    final result = await showDialog<ContactImportResult>(
      context: context,
      builder: (_) =>
          _ImportContactsDialog(contactRepository: widget.contactRepository),
    );
    if (result == null || !mounted) return;

    setState(() => _contacts = result.contacts);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result.skipped > 0
              ? l10n.messages_contacts_import_result_with_skipped(
                  result.imported,
                  result.skipped,
                )
              : l10n.messages_contacts_import_result(result.imported),
        ),
      ),
    );
  }

  Future<void> _handleContactTap(Contact contact) async {
    final contacts = await showDialog<List<Contact>>(
      context: context,
      builder: (_) => _EditContactDialog(
        contact: contact,
        contactRepository: widget.contactRepository,
      ),
    );
    if (contacts == null || !mounted) return;
    setState(() => _contacts = contacts);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Contact> get _filteredContacts {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return _contacts;
    return _contacts
        .where(
          (contact) =>
              contact.displayLabel.toLowerCase().contains(query) ||
              contact.phone.toLowerCase().contains(query),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppButton(
            label: l10n.messages_contacts_import_button,
            onPressed: _handleImport,
            expand: false,
          ),
          const SizedBox(height: 16),
          AppTextField(
            label: l10n.messages_contacts_search_hint,
            controller: _searchController,
          ),
          const SizedBox(height: 16),
          Expanded(
            child: _isLoading
                ? AppLoadingView(label: l10n.common_loading)
                : _hasError
                ? AppErrorView(
                    message: l10n.common_error_message,
                    retryLabel: l10n.common_retry,
                    onRetry: _loadContacts,
                  )
                : _filteredContacts.isEmpty
                ? AppEmptyView(message: l10n.messages_contacts_empty)
                : ListView.separated(
                    itemCount: _filteredContacts.length,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, color: AppColors.borderDivider),
                    itemBuilder: (context, index) {
                      final contact = _filteredContacts[index];
                      final hasName =
                          contact.displayLabel != contact.phone;
                      final extraFieldsCount =
                          contact.customFields.length - (hasName ? 1 : 0);
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        onTap: () => _handleContactTap(contact),
                        title: Text(
                          contact.displayLabel,
                          style: Theme.of(context).textTheme.bodyLarge,
                        ),
                        subtitle: hasName
                            ? Text(
                                contact.phone,
                                style: Theme.of(context).textTheme.bodyMedium,
                              )
                            : null,
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (extraFieldsCount > 0)
                              Padding(
                                padding: const EdgeInsets.only(right: 4),
                                child: Text(
                                  '+$extraFieldsCount',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ),
                            const Icon(
                              Icons.chevron_right_rounded,
                              color: AppColors.textSecondary,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// Diálogo de importação de contatos (Menu 2, seção "Importar contatos"):
/// colar a lista (telefone com código do país + IDs opcionais separados por
/// vírgula) e confirmar no botão "Importar".
class _ImportContactsDialog extends StatefulWidget {
  const _ImportContactsDialog({required this.contactRepository});

  final ContactRepository contactRepository;

  @override
  State<_ImportContactsDialog> createState() => _ImportContactsDialogState();
}

enum _ImportMode { paste, manual }

class _ImportContactsDialogState extends State<_ImportContactsDialog> {
  _ImportMode? _mode;
  bool _isSubmitting = false;

  final _pasteController = TextEditingController();

  final _manualPhoneController = TextEditingController();
  List<MapEntry<String, TextEditingController>> _manualFields = [
    MapEntry('ID1', TextEditingController()),
  ];

  @override
  void dispose() {
    _pasteController.dispose();
    _manualPhoneController.dispose();
    for (final field in _manualFields) {
      field.value.dispose();
    }
    super.dispose();
  }

  bool get _canSubmitPaste =>
      !_isSubmitting && _pasteController.text.trim().isNotEmpty;

  bool get _canSubmitManual =>
      !_isSubmitting && _manualPhoneController.text.trim().isNotEmpty;

  Future<void> _handleSubmitPaste() async {
    if (!_canSubmitPaste) return;
    setState(() => _isSubmitting = true);
    final result = await widget.contactRepository.importContacts(
      _pasteController.text,
    );
    if (!mounted) return;
    Navigator.of(context).pop(result);
  }

  void _addManualField() {
    setState(() {
      _manualFields = [
        ..._manualFields,
        MapEntry('ID${_manualFields.length + 1}', TextEditingController()),
      ];
    });
  }

  void _removeManualField(int index) {
    setState(() {
      _manualFields[index].value.dispose();
      _manualFields = [..._manualFields]..removeAt(index);
    });
  }

  Future<void> _handleSubmitManual() async {
    if (!_canSubmitManual) return;
    setState(() => _isSubmitting = true);
    final customFields = <String, String>{
      for (final field in _manualFields)
        if (field.value.text.trim().isNotEmpty)
          field.key: field.value.text.trim(),
    };
    final contacts = await widget.contactRepository.addContact(
      _manualPhoneController.text.trim(),
      customFields,
    );
    if (!mounted) return;
    Navigator.of(context).pop(
      ContactImportResult(contacts: contacts, imported: 1, skipped: 0),
    );
  }

  Widget _buildModeSelector(AppLocalizations l10n) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.messages_contacts_import_mode_prompt,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 16),
        _ImportModeOption(
          icon: Icons.content_paste_rounded,
          title: l10n.messages_contacts_import_mode_paste_title,
          description: l10n.messages_contacts_import_mode_paste_description,
          onTap: () => setState(() => _mode = _ImportMode.paste),
        ),
        const SizedBox(height: 12),
        _ImportModeOption(
          icon: Icons.person_add_alt_1_rounded,
          title: l10n.messages_contacts_import_mode_manual_title,
          description: l10n.messages_contacts_import_mode_manual_description,
          onTap: () => setState(() => _mode = _ImportMode.manual),
        ),
      ],
    );
  }

  Widget _buildPasteForm(AppLocalizations l10n) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppTextField(
          label: l10n.messages_contacts_import_hint,
          controller: _pasteController,
          maxLines: 6,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        Text(
          l10n.messages_contacts_import_helper,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _buildManualForm(AppLocalizations l10n) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppTextField(
          label: l10n.messages_contacts_phone_label,
          controller: _manualPhoneController,
          keyboardType: TextInputType.phone,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < _manualFields.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: AppTextField(
                    label: _manualFields[i].key,
                    controller: _manualFields[i].value,
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.close_rounded,
                    color: AppColors.textSecondary,
                  ),
                  onPressed: () => _removeManualField(i),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _addManualField,
            icon: const Icon(Icons.add_rounded),
            label: Text(l10n.messages_contacts_add_field_button),
          ),
        ),
      ],
    );
  }

  List<Widget> _buildActions(AppLocalizations l10n) {
    final cancelButton = TextButton(
      onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
      child: Text(l10n.common_cancel),
    );

    if (_mode == null) return [cancelButton];

    final spinner = const SizedBox(
      width: 16,
      height: 16,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: AppColors.purplePrimary,
      ),
    );

    if (_mode == _ImportMode.paste) {
      return [
        cancelButton,
        TextButton(
          onPressed: _canSubmitPaste ? _handleSubmitPaste : null,
          child: _isSubmitting
              ? spinner
              : Text(l10n.messages_contacts_import_submit_button),
        ),
      ];
    }

    return [
      cancelButton,
      TextButton(
        onPressed: _canSubmitManual ? _handleSubmitManual : null,
        child: _isSubmitting
            ? spinner
            : Text(l10n.messages_contacts_manual_submit_button),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      backgroundColor: AppColors.surfaceCard,
      title: Row(
        children: [
          if (_mode != null) ...[
            IconButton(
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              icon: const Icon(Icons.arrow_back_rounded, size: 20),
              onPressed: _isSubmitting
                  ? null
                  : () => setState(() => _mode = null),
            ),
            const SizedBox(width: 8),
          ],
          Text(l10n.messages_contacts_import_dialog_title),
        ],
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: _mode == null
              ? _buildModeSelector(l10n)
              : _mode == _ImportMode.paste
              ? _buildPasteForm(l10n)
              : _buildManualForm(l10n),
        ),
      ),
      actions: _buildActions(l10n),
    );
  }
}

/// Opção de modo de importação (colar lista / adicionar um por um) exibida
/// na tela inicial do diálogo de "Importar contatos".
class _ImportModeOption extends StatelessWidget {
  const _ImportModeOption({
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
      color: AppColors.background,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Icon(icon, color: AppColors.purplePrimary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Diálogo de edição de um contato já importado (Menu 2, seção "Lista de
/// contatos": "Editar ou remover contatos antes do envio"). Os campos ID1,
/// ID2, ID3… são dinâmicos — o próprio usuário pode adicionar ou remover
/// campos de personalização.
class _EditContactDialog extends StatefulWidget {
  const _EditContactDialog({
    required this.contact,
    required this.contactRepository,
  });

  final Contact contact;
  final ContactRepository contactRepository;

  @override
  State<_EditContactDialog> createState() => _EditContactDialogState();
}

class _EditContactDialogState extends State<_EditContactDialog> {
  late final TextEditingController _phoneController;
  late List<MapEntry<String, TextEditingController>> _fields;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController(text: widget.contact.phone);
    final keys = widget.contact.customFields.keys.toList()
      ..sort((a, b) => _idIndex(a).compareTo(_idIndex(b)));
    _fields = [
      for (final key in keys)
        MapEntry(
          key,
          TextEditingController(text: widget.contact.customFields[key]),
        ),
    ];
  }

  int _idIndex(String key) =>
      int.tryParse(key.replaceFirst('ID', '')) ?? 0;

  @override
  void dispose() {
    _phoneController.dispose();
    for (final field in _fields) {
      field.value.dispose();
    }
    super.dispose();
  }

  void _addField() {
    setState(() {
      _fields = [
        ..._fields,
        MapEntry('ID${_fields.length + 1}', TextEditingController()),
      ];
    });
  }

  void _removeField(int index) {
    setState(() {
      _fields[index].value.dispose();
      _fields = [..._fields]..removeAt(index);
    });
  }

  Future<void> _handleSave() async {
    setState(() => _isSubmitting = true);
    final customFields = <String, String>{
      for (final field in _fields)
        if (field.value.text.trim().isNotEmpty)
          field.key: field.value.text.trim(),
    };
    final updated = widget.contact.copyWith(
      phone: _phoneController.text.trim(),
      customFields: customFields,
    );
    final contacts = await widget.contactRepository.updateContact(updated);
    if (!mounted) return;
    Navigator.of(context).pop(contacts);
  }

  Future<void> _handleRemove() async {
    setState(() => _isSubmitting = true);
    final contacts = await widget.contactRepository.removeContact(
      widget.contact.id,
    );
    if (!mounted) return;
    Navigator.of(context).pop(contacts);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      backgroundColor: AppColors.surfaceCard,
      title: Text(l10n.messages_contacts_edit_dialog_title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppTextField(
              label: l10n.messages_contacts_phone_label,
              controller: _phoneController,
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < _fields.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: AppTextField(
                        label: _fields[i].key,
                        controller: _fields[i].value,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.close_rounded,
                        color: AppColors.textSecondary,
                      ),
                      onPressed: () => _removeField(i),
                    ),
                  ],
                ),
              ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _addField,
                icon: const Icon(Icons.add_rounded),
                label: Text(l10n.messages_contacts_add_field_button),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSubmitting ? null : _handleRemove,
          style: TextButton.styleFrom(foregroundColor: AppColors.statusError),
          child: Text(l10n.common_remove),
        ),
        TextButton(
          onPressed: _isSubmitting
              ? null
              : () => Navigator.of(context).pop(),
          child: Text(l10n.common_cancel),
        ),
        TextButton(
          onPressed: _isSubmitting ? null : _handleSave,
          child: Text(l10n.common_save),
        ),
      ],
    );
  }
}
