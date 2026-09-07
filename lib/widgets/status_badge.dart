import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Status possíveis exibidos em badges pelo app (conexão, envio de
/// mensagens etc.). O verde de `connected`/`sent` é o verde de marca do app
/// (README.md, seção 14) — a borda do badge ganha uma tinta sutil dessa cor
/// de status para reforçar a presença do verde na interface.
enum AppStatus { connected, pending, failed, sent }

class StatusBadge extends StatefulWidget {
  const StatusBadge({super.key, required this.status, required this.label});

  final AppStatus status;
  final String label;

  @override
  State<StatusBadge> createState() => _StatusBadgeState();
}

class _StatusBadgeState extends State<StatusBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _syncPulse();
  }

  @override
  void didUpdateWidget(covariant StatusBadge oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) _syncPulse();
  }

  // Pulso sutil no indicador (Etapa 8, README.md seção 13: microinterações)
  // enquanto o status é "pending" — conexão em andamento ou envio em curso.
  // Fica parado (opacidade fixa) em qualquer outro status.
  void _syncPulse() {
    if (widget.status == AppStatus.pending) {
      _pulseController.repeat(reverse: true);
    } else {
      _pulseController
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Color get _dotColor {
    switch (widget.status) {
      case AppStatus.connected:
      case AppStatus.sent:
        return AppColors.statusGreen;
      case AppStatus.pending:
        return AppColors.textSecondary;
      case AppStatus.failed:
        return AppColors.statusError;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _dotColor.withOpacity(0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          FadeTransition(
            opacity: Tween<double>(
              begin: 1,
              end: 0.35,
            ).animate(_pulseController),
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: _dotColor,
                shape: BoxShape.circle,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            widget.label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
