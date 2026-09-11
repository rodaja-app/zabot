import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:rive/rive.dart' hide Image;

import '../../data/connection_repository.dart';
import '../../data/models/home_stats.dart';
import '../../data/models/wallet.dart';
import '../../data/models/zap_connection_status.dart';
import '../../data/models/zap_session_info.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_text_field.dart';
import '../../widgets/state_views.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/wallet_summary_card.dart';
import '../wallet/wallet_recharge_screen.dart';

/// Tela Início (Etapa 4, README.md seção 13).
///
/// Mascote robô em destaque (hero) reagindo ao status da conexão do
/// WhatsApp (idle quando conectado, pulso durante o fluxo de QR code,
/// alerta quando desconectado), card de conexão (nome da sessão + telefone
/// quando conectado, com um menu "Gerenciar conexão"; QR code ou número de
/// telefone para conectar) e card de resumo/estatísticas. Tudo consumindo
/// [ConnectionRepository] mockado — trocar pela implementação real só na
/// Etapa 17 (integração final).
class InicioScreen extends StatefulWidget {
  const InicioScreen(
      {super.key,
      required this.connectionRepository,
      required this.walletRepository});

  final ConnectionRepository connectionRepository;
  final WalletRepository walletRepository;

  @override
  State<InicioScreen> createState() => _InicioScreenState();
}

/// Método usado no fluxo de conexão em andamento — controla se o card
/// mostra o placeholder de QR code ou o texto de "aguardando confirmação"
/// do fluxo por número de telefone.
enum _ConnectMethod { qrCode, phoneNumber }

enum _ManageAction { rename, disconnect, reconnect }

enum _ConnectOption { qrCode, phoneNumber }

class _InicioScreenState extends State<InicioScreen> {
  late ZapConnectionStatus _status;
  StreamSubscription<ZapConnectionStatus>? _subscription;
  _ConnectMethod? _connectMethod;

  late ZapSessionInfo _session;
  StreamSubscription<ZapSessionInfo>? _sessionSubscription;

  HomeStats? _stats;
  bool _statsLoading = true;
  bool _statsError = false;
  StreamSubscription<HomeStats>? _statsSubscription;

  // QR code / código de pareamento reais (Etapa 18 — antes disso o card só
  // mostrava um placeholder estático, ver `_QrCodePlaceholder`).
  String? _qrCode;
  StreamSubscription<String?>? _qrCodeSubscription;
  String? _pairingCode;
  StreamSubscription<String?>? _pairingCodeSubscription;
  bool _qrDialogOpen = false;
  bool _phoneDialogOpen = false;
  Future<Wallet>? _walletFuture;

  @override
  void initState() {
    super.initState();
    _status = widget.connectionRepository.currentStatus;
    _subscription = widget.connectionRepository.statusStream.listen((status) {
      if (!mounted) return;
      setState(() {
        _status = status;
        if (status == ZapConnectionStatus.disconnected) {
          _connectMethod = null;
          // O QR code/código de pareamento do fluxo anterior não vale mais
          // depois de desconectar — sem isso, cancelar e iniciar um novo
          // fluxo de QR code podia mostrar por um instante o código antigo
          // até o backend emitir o próximo.
          _qrCode = null;
          _pairingCode = null;
        }
      });
      if (status != ZapConnectionStatus.connecting &&
          (_qrDialogOpen || _phoneDialogOpen)) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted || (!_qrDialogOpen && !_phoneDialogOpen)) return;
          Navigator.of(context, rootNavigator: true).pop();
        });
      }
    });

    _session = widget.connectionRepository.currentSession;
    _sessionSubscription = widget.connectionRepository.sessionStream.listen((
      session,
    ) {
      if (!mounted) return;
      setState(() => _session = session);
    });

    _qrCode = widget.connectionRepository.currentQrCode;
    _qrCodeSubscription = widget.connectionRepository.qrCodeStream.listen((
      qrCode,
    ) {
      if (!mounted) return;
      setState(() => _qrCode = qrCode);
    });

    _pairingCode = widget.connectionRepository.currentPairingCode;
    _pairingCodeSubscription =
        widget.connectionRepository.pairingCodeStream.listen((pairingCode) {
      if (!mounted) return;
      setState(() => _pairingCode = pairingCode);
    });

    _loadStats();
    _refreshWallet();

    // Contadores "ao vivo" (Etapa 7): assim que chega uma atualização pelo
    // stream, ela substitui o valor exibido, sem precisar de um novo
    // carregamento.
    _statsSubscription = widget.connectionRepository.statsStream.listen((
      stats,
    ) {
      if (!mounted) return;
      setState(() => _stats = stats);
    });
  }

  Future<void> _loadStats() async {
    setState(() {
      _statsLoading = true;
      _statsError = false;
    });

    try {
      final stats = await widget.connectionRepository.getStats();
      if (!mounted) return;
      setState(() {
        _stats = stats;
        _statsLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _statsError = true;
        _statsLoading = false;
      });
    }
  }

  void _refreshWallet() =>
      setState(() => _walletFuture = widget.walletRepository.getBalance());

  Future<void> _openWalletRecharge() async {
    final refreshed = await Navigator.of(context).push<bool>(
      AppPageRoute(
          builder: (_) =>
              WalletRechargeScreen(walletRepository: widget.walletRepository)),
    );
    if (refreshed == true) _refreshWallet();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _sessionSubscription?.cancel();
    _statsSubscription?.cancel();
    _qrCodeSubscription?.cancel();
    _pairingCodeSubscription?.cancel();
    super.dispose();
  }

  Future<void> _handleManageConnection(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final action = await showModalBottomSheet<_ManageAction>(
      context: context,
      backgroundColor: AppColors.surfaceCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => _ActionSheet<_ManageAction>(
        title: l10n.home_connection_manage_sheet_title,
        items: [
          _ActionSheetItem(
            icon: Icons.edit_rounded,
            label: l10n.home_connection_manage_rename_option,
            value: _ManageAction.rename,
          ),
          _ActionSheetItem(
            icon: Icons.link_off_rounded,
            label: l10n.home_connection_manage_disconnect_option,
            value: _ManageAction.disconnect,
          ),
          _ActionSheetItem(
            icon: Icons.refresh_rounded,
            label: l10n.home_connection_manage_reconnect_option,
            value: _ManageAction.reconnect,
          ),
        ],
      ),
    );

    if (!mounted || action == null) return;

    switch (action) {
      case _ManageAction.rename:
        await _handleRenameSession(context);
        break;
      case _ManageAction.disconnect:
        await widget.connectionRepository.disconnect();
        break;
      case _ManageAction.reconnect:
        await widget.connectionRepository.disconnect();
        if (!mounted) return;
        setState(() => _connectMethod = _ConnectMethod.qrCode);
        await widget.connectionRepository.connect();
        break;
    }
  }

  Future<void> _handleRenameSession(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final controller = TextEditingController(text: _session.sessionName);
    final newName = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceCard,
        title: Text(l10n.home_connection_rename_dialog_title),
        content: AppTextField(
          label: l10n.home_connection_rename_dialog_label,
          controller: controller,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: Text(l10n.common_save),
          ),
        ],
      ),
    );

    if (newName == null || newName.trim().isEmpty) return;
    await widget.connectionRepository.renameSession(newName);
  }

  Future<void> _handleConnectPressed(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final option = await showModalBottomSheet<_ConnectOption>(
      context: context,
      backgroundColor: AppColors.surfaceCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => _ActionSheet<_ConnectOption>(
        title: l10n.home_connection_connect_sheet_title,
        items: [
          _ActionSheetItem(
            icon: Icons.qr_code_2_rounded,
            label: l10n.home_connection_connect_option_qr,
            value: _ConnectOption.qrCode,
          ),
          _ActionSheetItem(
            icon: Icons.dialpad_rounded,
            label: l10n.home_connection_connect_option_phone,
            value: _ConnectOption.phoneNumber,
          ),
        ],
      ),
    );

    if (!mounted || option == null) return;

    switch (option) {
      case _ConnectOption.qrCode:
        setState(() {
          _connectMethod = _ConnectMethod.qrCode;
          _qrCode = null;
          _pairingCode = null;
        });
        _showQrConnectionDialog(context, l10n);
        await _startConnection(l10n);
        break;
      case _ConnectOption.phoneNumber:
        final phoneNumber = await _promptPhoneNumber(context);
        if (!mounted || phoneNumber == null || phoneNumber.trim().isEmpty) {
          return;
        }
        setState(() {
          _connectMethod = _ConnectMethod.phoneNumber;
          _qrCode = null;
          _pairingCode = null;
        });
        _showPhonePairingDialog(context, l10n);
        await _startConnection(l10n, phoneNumber: phoneNumber);
        break;
    }
  }

  Future<void> _startConnection(
    AppLocalizations l10n, {
    String? phoneNumber,
  }) async {
    try {
      await widget.connectionRepository.connect(phoneNumber: phoneNumber);
    } catch (_) {
      if (!mounted) return;
      await _cancelConnecting(showError: false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.common_error_message)),
      );
    }
  }

  Future<void> _cancelConnecting({bool showError = false}) async {
    // Fecha imediatamente, antes da chamada de rede. Assim um QR expirado ou
    // uma API lenta nunca deixa a pessoa presa em um diálogo bloqueante.
    final shouldCloseDialog = _qrDialogOpen || _phoneDialogOpen;
    _qrDialogOpen = false;
    _phoneDialogOpen = false;
    if (shouldCloseDialog && mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
    try {
      await widget.connectionRepository.disconnect();
    } catch (_) {
      if (mounted && showError) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text(AppLocalizations.of(context)!.common_error_message)),
        );
      }
    }
  }

  Future<String?> _promptPhoneNumber(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceCard,
        title: Text(l10n.home_connection_phone_dialog_title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppTextField(
              label: l10n.home_connection_phone_dialog_label,
              controller: controller,
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            Text(
              l10n.home_connection_phone_dialog_instructions,
              style: Theme.of(dialogContext).textTheme.bodySmall,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.common_cancel),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: Text(l10n.common_save),
          ),
        ],
      ),
    );
  }

  void _showQrConnectionDialog(BuildContext context, AppLocalizations l10n) {
    if (_qrDialogOpen) return;
    _qrDialogOpen = true;
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => WillPopScope(
          onWillPop: () async => false,
          child: AlertDialog(
            backgroundColor: AppColors.surfaceCard,
            title: Text(l10n.home_connection_connect_sheet_title),
            content: StreamBuilder<String?>(
              stream: widget.connectionRepository.qrCodeStream,
              initialData: widget.connectionRepository.currentQrCode,
              builder: (context, snapshot) {
                final qrCode = snapshot.data;
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (qrCode == null)
                      const SizedBox(
                        width: 240,
                        height: 240,
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else
                      _QrCodePlaceholder(qrCode: qrCode),
                    const SizedBox(height: 16),
                    Text(
                      l10n.home_connection_qr_instructions,
                      textAlign: TextAlign.center,
                    ),
                  ],
                );
              },
            ),
            actions: [
              TextButton(
                onPressed: _cancelConnecting,
                child: Text(l10n.home_connection_cancel_button),
              ),
            ],
          ),
        ),
      ).whenComplete(() => _qrDialogOpen = false),
    );
  }

  void _showPhonePairingDialog(BuildContext context, AppLocalizations l10n) {
    if (_phoneDialogOpen) return;
    _phoneDialogOpen = true;
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => WillPopScope(
          onWillPop: () async => false,
          child: AlertDialog(
            backgroundColor: AppColors.surfaceCard,
            title: Text(l10n.home_connection_connect_option_phone),
            content: StreamBuilder<String?>(
              stream: widget.connectionRepository.pairingCodeStream,
              initialData: widget.connectionRepository.currentPairingCode,
              builder: (context, snapshot) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (snapshot.data == null)
                    const SizedBox(
                      width: 180,
                      height: 92,
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else
                    SelectableText(
                      snapshot.data!,
                      style:
                          Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: AppColors.greenPrimary,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 4,
                              ),
                    ),
                  const SizedBox(height: 16),
                  Text(
                    l10n.home_connection_connecting_phone_description,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.home_connection_phone_dialog_instructions,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: _cancelConnecting,
                child: Text(l10n.home_connection_cancel_button),
              ),
            ],
          ),
        ),
      ).whenComplete(() => _phoneDialogOpen = false),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _ReactiveMascot(status: _status),
        const SizedBox(height: 24),
        WalletSummaryCard(
            walletFuture: _walletFuture,
            l10n: l10n,
            onTap: _openWalletRecharge),
        const SizedBox(height: 24),
        _ConnectionCard(
          status: _status,
          session: _session,
          connectMethod: _connectMethod,
          qrCode: _qrCode,
          pairingCode: _pairingCode,
          l10n: l10n,
          onManagePressed: () => _handleManageConnection(context),
          onConnectPressed: () => _handleConnectPressed(context),
          onCancelConnecting: _cancelConnecting,
        ),
        const SizedBox(height: 24),
        _StatsCard(
          stats: _stats,
          isLoading: _statsLoading,
          hasError: _statsError,
          onRetry: _loadStats,
          l10n: l10n,
        ),
      ],
    );
  }
}

/// Mascote robô grande (hero) que reage ao status da conexão.
class _ReactiveMascot extends StatelessWidget {
  const _ReactiveMascot({required this.status});

  final ZapConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Container(
        height: 220,
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: AppColors.heroGradient,
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            RiveAnimation.asset(
              'assets/animations/robot_mascot.riv',
              fit: BoxFit.contain,
              // Toca o State Machine (não uma animação avulsa) para o
              // mascote ficar sempre no ciclo de idle em loop, em vez de
              // depender de qual animação linear vier primeiro no arquivo.
              stateMachines: const ['State Machine 1'],
            ),
            if (status == ZapConnectionStatus.connecting)
              Positioned.fill(
                child: IgnorePointer(
                  child: RiveAnimation.asset(
                    'assets/animations/connection_pulse.riv',
                    fit: BoxFit.contain,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.status,
    required this.session,
    required this.connectMethod,
    required this.qrCode,
    required this.pairingCode,
    required this.l10n,
    required this.onManagePressed,
    required this.onConnectPressed,
    required this.onCancelConnecting,
  });

  final ZapConnectionStatus status;
  final ZapSessionInfo session;
  final _ConnectMethod? connectMethod;
  final String? qrCode;
  final String? pairingCode;
  final AppLocalizations l10n;
  final VoidCallback onManagePressed;
  final VoidCallback onConnectPressed;
  final VoidCallback onCancelConnecting;

  AppStatus get _badgeStatus {
    switch (status) {
      case ZapConnectionStatus.connected:
        return AppStatus.connected;
      case ZapConnectionStatus.connecting:
        return AppStatus.pending;
      case ZapConnectionStatus.disconnected:
        return AppStatus.failed;
    }
  }

  String _badgeLabel() {
    switch (status) {
      case ZapConnectionStatus.connected:
        return l10n.home_connection_status_connected;
      case ZapConnectionStatus.connecting:
        return l10n.home_connection_status_connecting;
      case ZapConnectionStatus.disconnected:
        return l10n.home_connection_status_disconnected;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Envolvido em Expanded: sem isso, o título "Conexão com o
                // WhatsApp" + o badge disputam a mesma largura da Row e,
                // quando não cabem, o badge é empurrado pra fora do Card
                // (ficava com a borda direita cortada/vazando no
                // TestFlight). Com Expanded o texto quebra/encolhe e o
                // badge (mainAxisSize.min) sempre permanece inteiro e
                // visível.
                Expanded(
                  child: Text(
                    l10n.home_connection_card_title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(width: 8),
                StatusBadge(status: _badgeStatus, label: _badgeLabel()),
              ],
            ),
            const SizedBox(height: 16),
            if (status == ZapConnectionStatus.connected) ...[
              Text(
                session.phoneNumber,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 12),
              Text(
                l10n.home_connection_session_name_label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                    ),
              ),
              Text(
                session.sessionName,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ] else if (status == ZapConnectionStatus.connecting) ...[
              if (connectMethod == _ConnectMethod.phoneNumber) ...[
                AppLoadingView(label: l10n.common_loading),
                const SizedBox(height: 12),
                Text(
                  l10n.home_connection_connecting_phone_description,
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                if (pairingCode != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.home_connection_pairing_code_label(pairingCode!),
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          letterSpacing: 2,
                        ),
                    textAlign: TextAlign.center,
                  ),
                ] else if (qrCode != null) ...[
                  // Alguns aparelhos/contas não recebem código por número,
                  // mas o mesmo socket já entrega QR. Exibi-lo aqui evita um
                  // fluxo parado e ainda permite concluir a conexão.
                  const SizedBox(height: 12),
                  _QrCodePlaceholder(qrCode: qrCode),
                  const SizedBox(height: 12),
                  Text(
                    l10n.home_connection_qr_instructions,
                    style: Theme.of(context).textTheme.bodyMedium,
                    textAlign: TextAlign.center,
                  ),
                ],
              ] else ...[
                _QrCodePlaceholder(qrCode: qrCode),
                const SizedBox(height: 12),
                Text(
                  l10n.home_connection_qr_instructions,
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
              ],
            ] else
              Text(
                l10n.home_connection_disconnected_description,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            const SizedBox(height: 16),
            if (status == ZapConnectionStatus.connected)
              OutlinedButton(
                onPressed: onManagePressed,
                child: Text(l10n.home_connection_manage_button),
              )
            else if (status == ZapConnectionStatus.connecting)
              TextButton(
                onPressed: onCancelConnecting,
                child: Text(l10n.home_connection_cancel_button),
              )
            else
              AppButton(
                label: l10n.home_connection_connect_button,
                onPressed: onConnectPressed,
                expand: false,
              ),
          ],
        ),
      ),
    );
  }
}

/// Decodifica um data URL (`data:image/png;base64,...`) — formato do
/// `SessionConnectionUpdate.qr` do backend — para os bytes da imagem.
/// Retorna `null` se o valor não for um data URL base64 válido, para o card
/// cair de volta no ícone de placeholder em vez de quebrar a tela.
Uint8List? _decodeQrCodeDataUrl(String qrCode) {
  final commaIndex = qrCode.indexOf(',');
  final base64Part =
      commaIndex >= 0 ? qrCode.substring(commaIndex + 1) : qrCode;
  try {
    return base64Decode(base64Part);
  } on FormatException {
    return null;
  }
}

/// QR code exibido durante o fluxo de conexão. Renderiza a imagem real
/// (Etapa 18 — `ApiConnectionRepository`, a partir de
/// `SessionConnectionUpdate.qr`) quando [qrCode] chega do backend; até lá
/// (ou se a decodificação falhar), mostra o ícone de placeholder que já
/// existia desde a Etapa 4. Não há moldura/efeito sobreposto: qualquer
/// elemento visual sobre os módulos do QR prejudica a leitura pela câmera.
class _QrCodePlaceholder extends StatelessWidget {
  const _QrCodePlaceholder({this.qrCode});

  final String? qrCode;

  @override
  Widget build(BuildContext context) {
    final qrCode = this.qrCode;
    final imageBytes = qrCode == null ? null : _decodeQrCodeDataUrl(qrCode);

    return Center(
      child: SizedBox(
        width: 240,
        height: 240,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.borderDivider),
          ),
          clipBehavior: Clip.antiAlias,
          child: imageBytes != null
              ? Image.memory(
                  imageBytes,
                  width: 240,
                  height: 240,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.none,
                  gaplessPlayback: true,
                )
              : const Icon(
                  Icons.qr_code_2_rounded,
                  size: 112,
                  color: AppColors.textSecondary,
                ),
        ),
      ),
    );
  }
}

/// Item de uma [_ActionSheet] (ícone + rótulo + valor retornado ao fechar
/// o bottom sheet).
class _ActionSheetItem<T> {
  const _ActionSheetItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final T value;
}

/// Bottom sheet genérico de opções, usado tanto pelo menu "Gerenciar
/// conexão" quanto pela escolha de método de conexão (QR code / número de
/// telefone).
class _ActionSheet<T> extends StatelessWidget {
  const _ActionSheet({required this.title, required this.items});

  final String title;
  final List<_ActionSheetItem<T>> items;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: 20,
                vertical: 8,
              ),
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final item in items)
              ListTile(
                leading: Icon(item.icon, color: AppColors.purplePrimary),
                title: Text(item.label),
                onTap: () => Navigator.of(context).pop(item.value),
              ),
          ],
        ),
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard({
    required this.stats,
    required this.isLoading,
    required this.hasError,
    required this.onRetry,
    required this.l10n,
  });

  final HomeStats? stats;
  final bool isLoading;
  final bool hasError;
  final VoidCallback onRetry;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.home_stats_card_title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            Builder(
              builder: (context) {
                if (hasError) {
                  return AppErrorView(
                    message: l10n.common_error_message,
                    retryLabel: l10n.common_retry,
                    onRetry: onRetry,
                  );
                }
                final stats = this.stats;
                if (isLoading || stats == null) {
                  return AppLoadingView(label: l10n.common_loading);
                }
                return Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _StatItem(
                            value: '${stats.contactsImported}',
                            label: l10n.home_stats_contacts_imported_label,
                          ),
                        ),
                        Expanded(
                          child: _StatItem(
                            value: '${stats.messagesSent}',
                            label: l10n.home_stats_messages_sent_label,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        Expanded(
                          child: _StatItem(
                            value: '${stats.messagesPending}',
                            label: l10n.home_stats_messages_pending_label,
                          ),
                        ),
                        Expanded(
                          child: _StatItem(
                            value: '${stats.failures}',
                            label: l10n.home_stats_failures_label,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    const Divider(color: AppColors.borderDivider),
                    const SizedBox(height: 12),
                    _StatItem(
                      value: '${stats.totalMessages}',
                      label: l10n.home_stats_total_messages_label,
                      emphasize: true,
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.value,
    required this.label,
    this.emphasize = false,
  });

  final String value;
  final String label;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final valueStyle = emphasize
        ? Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: AppColors.purplePrimary,
              fontWeight: FontWeight.bold,
            )
        : Theme.of(context).textTheme.titleLarge;

    return Column(
      children: [
        Text(value, style: valueStyle),
        const SizedBox(height: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
