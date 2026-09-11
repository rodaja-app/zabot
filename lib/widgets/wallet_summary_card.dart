import 'package:flutter/material.dart';

import '../data/models/wallet.dart';
import '../l10n/generated/app_localizations.dart';
import '../theme/app_theme.dart';

/// Cartão de carteira compartilhado: o mesmo visual é exibido na Início.
class WalletSummaryCard extends StatelessWidget {
  const WalletSummaryCard({
    super.key,
    required this.walletFuture,
    required this.l10n,
    required this.onTap,
  });

  final Future<Wallet>? walletFuture;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Ink(
            decoration: BoxDecoration(
              gradient: AppColors.heroGradient,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.wallet_card_title, style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 4),
                        FutureBuilder<Wallet>(
                          future: walletFuture,
                          builder: (context, snapshot) => snapshot.hasData
                              ? Text(
                                  l10n.wallet_card_balance_label(snapshot.data!.balance),
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textPrimary),
                                )
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.textPrimary),
                ],
              ),
            ),
          ),
        ),
      );
}
