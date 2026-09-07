import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/message_repository.dart';
import '../../data/models/campaign.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../widgets/state_views.dart';
import '../../widgets/status_badge.dart';
import 'mensagens_screen.dart';

/// Tela "Campanhas enviadas" (Menu 2 — Mensagens).
///
/// Histórico separado das campanhas já concluídas com sucesso
/// ([AppStatus.sent]), aberta a partir da aba Campanhas (mesmo padrão de
/// navegação de [NovaCampanhaScreen]: push com [AppPageRoute]). Existe para
/// que a lista principal de campanhas não fique poluída conforme o usuário
/// envia mais e mais campanhas ao longo do tempo.
class CampanhasEnviadasScreen extends StatefulWidget {
  const CampanhasEnviadasScreen({super.key, required this.messageRepository});

  final MessageRepository messageRepository;

  @override
  State<CampanhasEnviadasScreen> createState() =>
      _CampanhasEnviadasScreenState();
}

class _CampanhasEnviadasScreenState extends State<CampanhasEnviadasScreen> {
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

  List<Campaign> get _sentCampaigns =>
      _campaigns.where((c) => c.status == AppStatus.sent).toList();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final sentCampaigns = _sentCampaigns;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.messages_sent_campaigns_title)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: sentCampaigns.isEmpty
              ? AppEmptyView(message: l10n.messages_sent_campaigns_empty)
              : ListView.separated(
                  itemCount: sentCampaigns.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) => CampaignCard(
                    campaign: sentCampaigns[index],
                    l10n: l10n,
                  ),
                ),
        ),
      ),
    );
  }
}
