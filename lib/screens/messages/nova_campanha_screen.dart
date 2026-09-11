import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../data/api/api_exception.dart';
import '../../data/contact_repository.dart';
import '../../data/connection_repository.dart';
import '../../data/message_repository.dart';
import '../../data/models/campaign_media_type.dart';
import '../../data/models/contact.dart';
import '../../data/models/picked_media.dart';
import '../../data/models/zap_connection_status.dart';
import '../../data/wallet_repository.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_page_route.dart';
import '../../widgets/app_text_field.dart';
import '../../widgets/state_views.dart';
import '../wallet/wallet_recharge_screen.dart';

/// Tela de criação de campanha (Etapa 5, README.md seção 13; Menu 2 —
/// Mensagens, seções "Criar mensagem", "Personalização", "Mídia" e
/// "Iniciar envio").
///
/// Não escolhe destinatários: envia para todos os contatos já curados na
/// aba Contatos (importados/editados na seção "Lista de contatos"). Ao
/// enviar, chama [MessageRepository.createCampaign] e volta para a lista de
/// campanhas, onde o progresso do envio aparece em tempo real.
class NovaCampanhaScreen extends StatefulWidget {
  const NovaCampanhaScreen({
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
  State<NovaCampanhaScreen> createState() => _NovaCampanhaScreenState();
}

class _NovaCampanhaScreenState extends State<NovaCampanhaScreen> {
  static const _maxMessages = 5;

  final List<TextEditingController> _messageControllers = [
    TextEditingController(),
  ];
  final List<FocusNode> _messageFocusNodes = [FocusNode()];
  int _focusedMessageIndex = 0;

  List<Contact> _contacts = [];
  bool _isLoadingContacts = true;

  static const _maxImageFiles = 10;
  static const _imageExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  static const _audioExtensions = ['mp3', 'ogg', 'm4a', 'aac', 'amr', 'wav'];

  CampaignMediaType _mediaType = CampaignMediaType.none;

  /// Arquivos reais escolhidos no seletor nativo (Etapa 18 — decisão
  /// explícita do usuário: upload de mídia de verdade em vez de deixar
  /// [_mediaType] como seleção só visual). Vazio enquanto nenhum arquivo
  /// foi escolhido, mesmo que [_mediaType] já esteja marcado.
  List<PickedMedia> _mediaFiles = [];
  final ImagePicker _imagePicker = ImagePicker();

  /// Limites do intervalo aleatório entre um envio e outro (Menu 2, seção
  /// "Intervalo de envio"). Só a interface é implementada por enquanto —
  /// o backend real de envio (Etapa 17) ainda vai consumir esses valores.
  static const _intervalLowerBound = 1;
  static const _intervalUpperBound = 60;
  int _intervalMinMinutes = 2;
  int _intervalMaxMinutes = 10;

  /// Se `true`, envia para todos os contatos importados; se `false`, só
  /// para os contatos escolhidos manualmente em [_selectedContactIds]
  /// (Menu 2, seção "Iniciar envio").
  bool _sendToAll = true;
  Set<String> _selectedContactIds = {};

  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadContacts();
    _messageControllers[0].addListener(() => setState(() {}));
    _messageFocusNodes[0].addListener(() => _handleFocusChange(0));
  }

  void _handleFocusChange(int index) {
    if (_messageFocusNodes[index].hasFocus && mounted) {
      setState(() => _focusedMessageIndex = index);
    }
  }

  Future<void> _loadContacts() async {
    try {
      final contacts = await widget.contactRepository.getContacts();
      if (!mounted) return;
      setState(() {
        _contacts = contacts;
        _isLoadingContacts = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _isLoadingContacts = false);
    }
  }

  @override
  void dispose() {
    for (final controller in _messageControllers) {
      controller.dispose();
    }
    for (final node in _messageFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  void _addMessage() {
    if (_messageControllers.length >= _maxMessages) return;
    final index = _messageControllers.length;
    final controller = TextEditingController()..addListener(() => setState(() {}));
    final node = FocusNode()..addListener(() => _handleFocusChange(index));
    setState(() {
      _messageControllers.add(controller);
      _messageFocusNodes.add(node);
    });
  }

  void _removeMessage(int index) {
    if (_messageControllers.length <= 1) return;
    setState(() {
      _messageControllers.removeAt(index).dispose();
      _messageFocusNodes.removeAt(index).dispose();
      if (_focusedMessageIndex >= _messageControllers.length) {
        _focusedMessageIndex = _messageControllers.length - 1;
      }
    });
  }

  /// Envolve o texto selecionado (ou insere o par de marcadores no cursor)
  /// com o marcador de formatação do WhatsApp: `*negrito*` / `_itálico_`.
  void _wrapSelection(String marker) {
    final controller = _messageControllers[_focusedMessageIndex];
    final text = controller.text;
    final selection = controller.selection;

    if (!selection.isValid) {
      final newText = '$text$marker$marker';
      controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(
          offset: newText.length - marker.length,
        ),
      );
      return;
    }

    final start = selection.start;
    final end = selection.end;

    if (start == end) {
      final newText = text.replaceRange(start, end, '$marker$marker');
      controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: start + marker.length),
      );
    } else {
      final selected = text.substring(start, end);
      final newText = text.replaceRange(start, end, '$marker$selected$marker');
      controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: end + marker.length * 2),
      );
    }
  }

  /// Insere texto (emoji ou marcador de personalização `{ID1}`) no cursor
  /// da mensagem em foco.
  void _insertText(String insert) {
    final controller = _messageControllers[_focusedMessageIndex];
    final text = controller.text;
    final selection = controller.selection;
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    final newText = text.replaceRange(start, end, insert);
    controller.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: start + insert.length),
    );
  }

  Future<void> _showEmojiPicker() async {
    final emoji = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surfaceCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _EmojiPickerSheet(),
    );
    if (emoji == null) return;
    _insertText(emoji);
  }

  /// Abre a galeria nativa para imagens e o seletor de arquivos para áudio e
  /// documentos. Cancelar não muda nada — só mídia escolhida de verdade marca
  /// [_mediaType]. No iOS, a galeria mostra a permissão/sistema de seleção
  /// apropriado; a justificativa está em `NSPhotoLibraryUsageDescription`.
  Future<void> _pickMedia(CampaignMediaType type) async {
    if (type == CampaignMediaType.images) {
      await _pickImagesFromGallery();
      return;
    }

    FilePickerResult? result;
    try {
      result = await FilePicker.platform.pickFiles(
        type: type == CampaignMediaType.document
            ? FileType.any
            : FileType.custom,
        allowedExtensions: switch (type) {
          CampaignMediaType.audio => _audioExtensions,
          CampaignMediaType.images || CampaignMediaType.document || CampaignMediaType.none => null,
        },
        allowMultiple: false,
        withData: true,
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context)!.messages_nova_campanha_media_pick_error,
          ),
        ),
      );
      return;
    }
    if (result == null || !mounted) return;

    final picked = result.files
        .where((file) => file.bytes != null)
        .take(1)
        .map(
          (file) => PickedMedia(
            bytes: file.bytes!,
            mimeType: _guessMimeType(file.extension),
            fileName: file.name,
          ),
        )
        .toList();
    if (picked.isEmpty) return;

    setState(() {
      _mediaType = type;
      _mediaFiles = picked;
    });
  }

  Future<void> _pickImagesFromGallery() async {
    try {
      final images = await _imagePicker.pickMultiImage();
      if (images.isEmpty || !mounted) return;

      final picked = <PickedMedia>[];
      for (final image in images.take(_maxImageFiles)) {
        final bytes = await image.readAsBytes();
        picked.add(
          PickedMedia(
            bytes: bytes,
            mimeType: _guessMimeType(_extensionFromFileName(image.name)),
            fileName: image.name,
          ),
        );
      }
      if (!mounted || picked.isEmpty) return;
      setState(() {
        _mediaType = CampaignMediaType.images;
        _mediaFiles = picked;
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.messages_nova_campanha_media_pick_error)),
      );
    }
  }

  String? _extensionFromFileName(String fileName) {
    final dot = fileName.lastIndexOf('.');
    return dot < 0 ? null : fileName.substring(dot + 1);
  }

  void _clearMedia() {
    setState(() {
      _mediaType = CampaignMediaType.none;
      _mediaFiles = [];
    });
  }

  /// Deriva o mimetype pela extensão (`file_picker` não expõe o mimetype
  /// direto) — cobre exatamente os tipos que `MediaService.MEDIA_RULES`
  /// aceita para IMAGENS/AUDIO no backend; DOCUMENTO é catch-all lá, então
  /// um mimetype genérico é aceito sem restrição.
  String _guessMimeType(String? extension) {
    switch (extension?.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'mp3':
        return 'audio/mpeg';
      case 'ogg':
        return 'audio/ogg';
      case 'm4a':
        return 'audio/mp4';
      case 'aac':
        return 'audio/aac';
      case 'amr':
        return 'audio/amr';
      case 'wav':
        return 'audio/wav';
      default:
        return 'application/octet-stream';
    }
  }

  void _adjustIntervalMin(int delta) {
    setState(() {
      _intervalMinMinutes = (_intervalMinMinutes + delta).clamp(
        _intervalLowerBound,
        _intervalMaxMinutes,
      );
    });
  }

  void _adjustIntervalMax(int delta) {
    setState(() {
      _intervalMaxMinutes = (_intervalMaxMinutes + delta).clamp(
        _intervalMinMinutes,
        _intervalUpperBound,
      );
    });
  }

  void _setSendToAll(bool sendToAll) {
    setState(() => _sendToAll = sendToAll);
  }

  Future<void> _openSelectContacts() async {
    final result = await showDialog<Set<String>>(
      context: context,
      builder: (_) => _SelectContactsDialog(
        contacts: _contacts,
        initialSelected: _selectedContactIds,
      ),
    );
    if (result == null || !mounted) return;
    setState(() => _selectedContactIds = result);
  }

  int get _recipientCount =>
      _sendToAll ? _contacts.length : _selectedContactIds.length;

  List<String> get _nonEmptyMessages => _messageControllers
      .map((controller) => controller.text.trim())
      .where((text) => text.isNotEmpty)
      .toList();

  /// Chaves de personalização (ID1, ID2…) disponíveis em pelo menos um dos
  /// contatos importados, em ordem numérica (Menu 2, seção
  /// "Personalização").
  List<String> get _availablePersonalizationIds {
    final ids = <String>{};
    for (final contact in _contacts) {
      ids.addAll(contact.customFields.keys);
    }
    final sorted = ids.toList()
      ..sort(
        (a, b) => (int.tryParse(a.replaceFirst('ID', '')) ?? 0).compareTo(
          int.tryParse(b.replaceFirst('ID', '')) ?? 0,
        ),
      );
    return sorted;
  }

  bool get _canSubmit =>
      !_isSubmitting &&
      _nonEmptyMessages.isNotEmpty &&
      _contacts.isNotEmpty &&
      (_sendToAll || _selectedContactIds.isNotEmpty) &&
      (_mediaType == CampaignMediaType.none || _mediaFiles.isNotEmpty);

  Future<void> _handleSubmit() async {
    if (!_canSubmit) return;
    // O botão continua visível e o fluxo fica claro mesmo quando a pessoa
    // acaba de terminar de digitar a última mensagem.
    FocusManager.instance.primaryFocus?.unfocus();
    final l10n = AppLocalizations.of(context)!;

    // Não cria uma campanha (nem atualiza o histórico) antes de existir uma
    // sessão pronta para enviá-la. A orientação é só informativa: a pessoa
    // continua nesta tela e conecta o WhatsApp quando desejar, pela Início.
    if (widget.connectionRepository.currentStatus !=
        ZapConnectionStatus.connected) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.messages_nova_campanha_whatsapp_required)),
      );
      return;
    }

    final requiredCredits = _recipientCount * _nonEmptyMessages.length;
    try {
      final wallet = await widget.walletRepository.getBalance();
      if (!mounted) return;
      if (wallet.balance < requiredCredits) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.messages_nova_campanha_balance_required)),
        );
        await Navigator.of(context).push(
          AppPageRoute(
            builder: (_) => WalletRechargeScreen(
              walletRepository: widget.walletRepository,
            ),
          ),
        );
        return;
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      return;
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.common_error_message)),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      await widget.messageRepository.createCampaign(
        messages: _nonEmptyMessages,
        recipientCount: _recipientCount,
        mediaType: _mediaType,
        mediaCount: _mediaFiles.length,
        media: _mediaFiles,
        recipientIds: _sendToAll ? null : _selectedContactIds,
      );

      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _isSubmitting = false);
      if (error.isPaymentRejected) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.messages_nova_campanha_balance_required)),
        );
        await Navigator.of(context).push(
          AppPageRoute(
            builder: (_) => WalletRechargeScreen(
              walletRepository: widget.walletRepository,
            ),
          ),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSubmitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.common_error_message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final personalizationIds = _availablePersonalizationIds;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.messages_nova_campanha_title)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            _CampaignSectionTitle(
              icon: Icons.chat_bubble_rounded,
              title: l10n.messages_nova_campanha_messages_section_title,
              trailing: '${_messageControllers.length}/$_maxMessages',
            ),
            const SizedBox(height: 4),
            Text(
              l10n.messages_nova_campanha_max_messages_hint,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < _messageControllers.length; i++) ...[
              _MessageComposerField(
                label: l10n.messages_nova_campanha_message_field_label(i + 1),
                controller: _messageControllers[i],
                focusNode: _messageFocusNodes[i],
                isFocused: _focusedMessageIndex == i,
                canRemove: _messageControllers.length > 1,
                onRemove: () => _removeMessage(i),
                onBold: () {
                  setState(() => _focusedMessageIndex = i);
                  _messageFocusNodes[i].requestFocus();
                  _wrapSelection('*');
                },
                onItalic: () {
                  setState(() => _focusedMessageIndex = i);
                  _messageFocusNodes[i].requestFocus();
                  _wrapSelection('_');
                },
                onEmoji: () {
                  setState(() => _focusedMessageIndex = i);
                  _showEmojiPicker();
                },
                boldTooltip: l10n.messages_nova_campanha_bold_tooltip,
                italicTooltip: l10n.messages_nova_campanha_italic_tooltip,
                emojiTooltip: l10n.messages_nova_campanha_emoji_tooltip,
                removeTooltip:
                    l10n.messages_nova_campanha_remove_message_tooltip,
              ),
              const SizedBox(height: 12),
            ],
            if (_messageControllers.length < _maxMessages)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _addMessage,
                  icon: const Icon(Icons.add_rounded),
                  label: Text(l10n.messages_nova_campanha_add_message_button),
                ),
              ),
            const SizedBox(height: 24),
            _CampaignSectionTitle(
              icon: Icons.auto_awesome_rounded,
              title: l10n.messages_nova_campanha_personalization_section_title,
              greenAccent: true,
            ),
            const SizedBox(height: 8),
            if (_isLoadingContacts)
              AppLoadingView(label: l10n.common_loading)
            else if (personalizationIds.isEmpty)
              _PersonalizationGuide(l10n: l10n)
            else ...[
                Text(
                  l10n.messages_nova_campanha_personalization_hint,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final id in personalizationIds)
                      ActionChip(
                        label: Text('{$id}'),
                        backgroundColor: AppColors.surfaceCard,
                        side: const BorderSide(color: AppColors.borderDivider),
                        labelStyle: const TextStyle(
                          color: AppColors.textPrimary,
                        ),
                        onPressed: () => _insertText('{$id}'),
                      ),
                  ],
                ),
            ],
            const SizedBox(height: 24),
            _CampaignSectionTitle(
              icon: Icons.perm_media_rounded,
              title: l10n.messages_nova_campanha_media_section_title,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _MediaOption(
                  icon: Icons.photo_library_rounded,
                  label: l10n.messages_nova_campanha_media_images_option,
                  selected: _mediaType == CampaignMediaType.images,
                  onTap: () => _pickMedia(CampaignMediaType.images),
                ),
                _MediaOption(
                  icon: Icons.mic_rounded,
                  label: l10n.messages_nova_campanha_media_audio,
                  selected: _mediaType == CampaignMediaType.audio,
                  onTap: () => _pickMedia(CampaignMediaType.audio),
                ),
                _MediaOption(
                  icon: Icons.description_rounded,
                  label: l10n.messages_nova_campanha_media_document,
                  selected: _mediaType == CampaignMediaType.document,
                  onTap: () => _pickMedia(CampaignMediaType.document),
                ),
              ],
            ),
            if (_mediaType != CampaignMediaType.none) ...[
              const SizedBox(height: 12),
              if (_mediaFiles.isEmpty)
                Text(
                  l10n.messages_nova_campanha_media_no_file_warning,
                  style: Theme.of(
                    context,
                  ).textTheme.bodyMedium?.copyWith(color: AppColors.statusError),
                )
              else ...[
                if (_mediaType == CampaignMediaType.images)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      l10n.messages_nova_campanha_media_images_count_label(
                        _mediaFiles.length,
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final file in _mediaFiles)
                      Chip(
                        label: Text(
                          file.fileName,
                          overflow: TextOverflow.ellipsis,
                        ),
                        backgroundColor: AppColors.surfaceCard,
                        side: const BorderSide(
                          color: AppColors.borderDivider,
                        ),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: () => _pickMedia(_mediaType),
                    icon: const Icon(Icons.attach_file_rounded, size: 18),
                    label: Text(
                      _mediaFiles.isEmpty
                          ? l10n.messages_nova_campanha_media_pick_file_button
                          : l10n
                                .messages_nova_campanha_media_change_file_button,
                    ),
                  ),
                  if (_mediaFiles.isNotEmpty)
                    TextButton.icon(
                      onPressed: _clearMedia,
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 18,
                        color: AppColors.statusError,
                      ),
                      label: Text(
                        l10n.messages_nova_campanha_media_remove_file_button,
                        style: const TextStyle(color: AppColors.statusError),
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 24),
            _CampaignSectionTitle(
              icon: Icons.timer_outlined,
              title: l10n.messages_nova_campanha_interval_section_title,
              greenAccent: true,
            ),
            const SizedBox(height: 4),
            Text(
              l10n.messages_nova_campanha_interval_hint,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _IntervalStepper(
                    label: l10n.messages_nova_campanha_interval_min_label,
                    value: _intervalMinMinutes,
                    valueLabel: l10n.messages_nova_campanha_interval_minutes_value(
                      _intervalMinMinutes,
                    ),
                    onDecrement: () => _adjustIntervalMin(-1),
                    onIncrement: () => _adjustIntervalMin(1),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _IntervalStepper(
                    label: l10n.messages_nova_campanha_interval_max_label,
                    value: _intervalMaxMinutes,
                    valueLabel: l10n.messages_nova_campanha_interval_minutes_value(
                      _intervalMaxMinutes,
                    ),
                    onDecrement: () => _adjustIntervalMax(-1),
                    onIncrement: () => _adjustIntervalMax(1),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            _CampaignSectionTitle(
              icon: Icons.rocket_launch_rounded,
              title: l10n.messages_nova_campanha_send_section_title,
            ),
            const SizedBox(height: 8),
            if (_isLoadingContacts)
              AppLoadingView(label: l10n.common_loading)
            else if (_contacts.isEmpty)
              Text(
                l10n.messages_nova_campanha_no_contacts_warning,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: AppColors.statusError),
              )
            else ...[
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _MediaOption(
                    icon: Icons.groups_rounded,
                    label: l10n.messages_nova_campanha_recipients_all_option,
                    selected: _sendToAll,
                    onTap: () => _setSendToAll(true),
                  ),
                  _MediaOption(
                    icon: Icons.fact_check_rounded,
                    label:
                        l10n.messages_nova_campanha_recipients_manual_option,
                    selected: !_sendToAll,
                    onTap: () => _setSendToAll(false),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (_sendToAll)
                Row(
                  children: [
                    const Icon(
                      Icons.people_alt_rounded,
                      size: 18,
                      color: AppColors.textSecondary,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      l10n.messages_campaign_recipients_count(
                        _contacts.length,
                      ),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                )
              else ...[
                AppButton(
                  label: _selectedContactIds.isEmpty
                      ? l10n.messages_nova_campanha_recipients_select_button
                      : l10n
                            .messages_nova_campanha_recipients_edit_selection_button(
                              _selectedContactIds.length,
                            ),
                  onPressed: _openSelectContacts,
                  expand: false,
                ),
                if (_selectedContactIds.isEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    l10n
                        .messages_nova_campanha_recipients_none_selected_warning,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.statusError,
                    ),
                  ),
                ],
              ],
            ],
            const SizedBox(height: 20),
            AppButton(
              label: _isSubmitting
                  ? l10n.common_loading
                  : l10n.messages_nova_campanha_submit_button,
              onPressed: _canSubmit ? _handleSubmit : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// Campo de composição de uma mensagem (até 5 por campanha), com barra de
/// ações para negrito, itálico e emoji (Menu 2, seção "Criar mensagem").
class _MessageComposerField extends StatelessWidget {
  const _MessageComposerField({
    required this.label,
    required this.controller,
    required this.focusNode,
    required this.isFocused,
    required this.canRemove,
    required this.onRemove,
    required this.onBold,
    required this.onItalic,
    required this.onEmoji,
    required this.boldTooltip,
    required this.italicTooltip,
    required this.emojiTooltip,
    required this.removeTooltip,
  });

  final String label;
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isFocused;
  final bool canRemove;
  final VoidCallback onRemove;
  final VoidCallback onBold;
  final VoidCallback onItalic;
  final VoidCallback onEmoji;
  final String boldTooltip;
  final String italicTooltip;
  final String emojiTooltip;
  final String removeTooltip;

  @override
  Widget build(BuildContext context) {
    // `onPointerDown` recebe o toque em qualquer espaço do card, inclusive
    // ao lado do texto. Assim quem não conhece o app não precisa descobrir
    // uma área pequena e invisível para abrir o teclado.
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: (_) => focusNode.requestFocus(),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          gradient: isFocused
              ? const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF312651), AppColors.surfaceCard],
                )
              : null,
          color: isFocused ? null : AppColors.surfaceCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isFocused ? AppColors.purplePrimary : AppColors.borderDivider,
            width: isFocused ? 1.5 : 1,
          ),
          boxShadow: isFocused
              ? const [
                  BoxShadow(
                    color: Color(0x336C56C9),
                    blurRadius: 16,
                    offset: Offset(0, 6),
                  ),
                ]
              : null,
        ),
        child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              IconButton(
                tooltip: boldTooltip,
                icon: const Icon(Icons.format_bold_rounded, size: 20),
                visualDensity: VisualDensity.compact,
                onPressed: onBold,
              ),
              IconButton(
                tooltip: italicTooltip,
                icon: const Icon(Icons.format_italic_rounded, size: 20),
                visualDensity: VisualDensity.compact,
                onPressed: onItalic,
              ),
              IconButton(
                tooltip: emojiTooltip,
                icon: const Icon(Icons.emoji_emotions_outlined, size: 20),
                visualDensity: VisualDensity.compact,
                onPressed: onEmoji,
              ),
              if (canRemove)
                IconButton(
                  tooltip: removeTooltip,
                  icon: const Icon(
                    Icons.delete_outline_rounded,
                    size: 20,
                    color: AppColors.statusError,
                  ),
                  visualDensity: VisualDensity.compact,
                  onPressed: onRemove,
                ),
            ],
          ),
          TextField(
            controller: controller,
            focusNode: focusNode,
            maxLines: 3,
            style: const TextStyle(color: AppColors.textPrimary),
            decoration: const InputDecoration(
              hintText: 'Toque aqui para escrever sua mensagem',
              hintStyle: TextStyle(color: AppColors.textSecondary),
              border: InputBorder.none,
              isDense: true,
            ),
          ),
          const SizedBox(height: 4),
        ],
        ),
      ),
    );
  }
}

/// Cabeçalho colorido e consistente das etapas da campanha. O ícone e a
/// pílula tornam a sequência mais escaneável sem depender apenas de texto.
class _CampaignSectionTitle extends StatelessWidget {
  const _CampaignSectionTitle({
    required this.icon,
    required this.title,
    this.trailing,
    this.greenAccent = false,
  });

  final IconData icon;
  final String title;
  final String? trailing;
  final bool greenAccent;

  @override
  Widget build(BuildContext context) {
    final accent = greenAccent ? AppColors.greenPrimary : AppColors.purplePrimary;
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: accent.withOpacity(0.18),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 18, color: accent),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        if (trailing != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(
              color: accent.withOpacity(0.16),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              trailing!,
              style: TextStyle(color: accent, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
      ],
    );
  }
}

/// Guia mostrado quando os contatos ainda não possuem campos ID. Em vez de
/// uma mensagem passiva de "não encontrado", ensina o caminho completo para
/// salvar o dado e usar a personalização na campanha.
class _PersonalizationGuide extends StatelessWidget {
  const _PersonalizationGuide({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2B2545), Color(0xFF182E29)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.greenPrimary.withOpacity(0.38)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.tips_and_updates_rounded,
                color: AppColors.greenPrimary,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.messages_nova_campanha_personalization_guide_title,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            l10n.messages_nova_campanha_personalization_guide_description,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 14),
          _GuideLine(
            number: '1',
            text: l10n.messages_nova_campanha_personalization_guide_step_one,
          ),
          const SizedBox(height: 8),
          _GuideLine(
            number: '2',
            text: l10n.messages_nova_campanha_personalization_guide_step_two,
          ),
          const SizedBox(height: 14),
          Text(
            l10n.messages_nova_campanha_personalization_guide_example_label,
            style: const TextStyle(
              color: AppColors.greenPrimary,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.background.withOpacity(0.55),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              l10n.messages_nova_campanha_personalization_guide_example,
              style: const TextStyle(
                color: AppColors.textPrimary,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GuideLine extends StatelessWidget {
  const _GuideLine({required this.number, required this.text});

  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 22,
          height: 22,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: AppColors.purplePrimary,
            shape: BoxShape.circle,
          ),
          child: Text(
            number,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
          ),
        ),
        const SizedBox(width: 9),
        Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }
}

/// Grade simples de emojis comuns (Menu 2, seção "Criar mensagem").
class _EmojiPickerSheet extends StatelessWidget {
  const _EmojiPickerSheet();

  static const List<String> _emojis = [
    '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😉', '😎', '🤔',
    '👍', '👎', '🙏', '👏', '🎉', '🔥', '❤️', '💜', '✅', '⚠️',
    '📷', '🎁', '⏰', '📌',
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final emoji in _emojis)
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => Navigator.of(context).pop(emoji),
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Text(emoji, style: const TextStyle(fontSize: 26)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MediaOption extends StatelessWidget {
  const _MediaOption({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          gradient: selected ? AppColors.heroGradient : null,
          color: selected ? null : AppColors.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? Colors.transparent
                : AppColors.borderDivider,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 18,
              color: selected
                  ? AppColors.textPrimary
                  : AppColors.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: selected
                    ? AppColors.textPrimary
                    : AppColors.textSecondary,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Contador usado para definir os limites (mínimo/máximo) do intervalo
/// aleatório entre um envio e outro (Menu 2, seção "Intervalo de envio").
class _IntervalStepper extends StatelessWidget {
  const _IntervalStepper({
    required this.label,
    required this.value,
    required this.valueLabel,
    required this.onDecrement,
    required this.onIncrement,
  });

  final String label;
  final int value;
  final String valueLabel;
  final VoidCallback onDecrement;
  final VoidCallback onIncrement;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderDivider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, top: 6),
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                onPressed: onDecrement,
                icon: const Icon(Icons.remove_circle_outline_rounded),
                visualDensity: VisualDensity.compact,
              ),
              Text(
                valueLabel,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              IconButton(
                onPressed: onIncrement,
                icon: const Icon(Icons.add_circle_outline_rounded),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Diálogo de seleção manual de destinatários (Menu 2, seção "Iniciar
/// envio", opção "Selecionar contatos"). Permite buscar e marcar/desmarcar
/// contatos individualmente antes de confirmar.
class _SelectContactsDialog extends StatefulWidget {
  const _SelectContactsDialog({
    required this.contacts,
    required this.initialSelected,
  });

  final List<Contact> contacts;
  final Set<String> initialSelected;

  @override
  State<_SelectContactsDialog> createState() => _SelectContactsDialogState();
}

class _SelectContactsDialogState extends State<_SelectContactsDialog> {
  late Set<String> _selected;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _selected = {...widget.initialSelected};
    _searchController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Contact> get _filteredContacts {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return widget.contacts;
    return widget.contacts
        .where(
          (contact) =>
              contact.displayLabel.toLowerCase().contains(query) ||
              contact.phone.toLowerCase().contains(query),
        )
        .toList();
  }

  void _toggle(String id, bool? value) {
    setState(() {
      if (value ?? false) {
        _selected.add(id);
      } else {
        _selected.remove(id);
      }
    });
  }

  void _selectAllFiltered() {
    setState(() => _selected.addAll(_filteredContacts.map((c) => c.id)));
  }

  void _clearAll() {
    setState(() => _selected.clear());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final filtered = _filteredContacts;

    return AlertDialog(
      backgroundColor: AppColors.surfaceCard,
      title: Text(l10n.messages_nova_campanha_recipients_dialog_title),
      content: SizedBox(
        width: double.maxFinite,
        height: 420,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppTextField(
              label: l10n.messages_contacts_search_hint,
              controller: _searchController,
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                TextButton(
                  onPressed: _selectAllFiltered,
                  child: Text(
                    l10n.messages_nova_campanha_recipients_dialog_select_all,
                  ),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _clearAll,
                  child: Text(
                    l10n.messages_nova_campanha_recipients_dialog_clear_all,
                  ),
                ),
              ],
            ),
            const Divider(height: 1, color: AppColors.borderDivider),
            Expanded(
              child: filtered.isEmpty
                  ? AppEmptyView(message: l10n.messages_contacts_empty)
                  : ListView.builder(
                      itemCount: filtered.length,
                      itemBuilder: (context, index) {
                        final contact = filtered[index];
                        final hasName = contact.displayLabel != contact.phone;
                        return CheckboxListTile(
                          value: _selected.contains(contact.id),
                          onChanged: (value) => _toggle(contact.id, value),
                          controlAffinity: ListTileControlAffinity.leading,
                          activeColor: AppColors.purplePrimary,
                          title: Text(contact.displayLabel),
                          subtitle: hasName ? Text(contact.phone) : null,
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
        TextButton(
          onPressed: () => Navigator.of(context).pop(_selected),
          child: Text(
            l10n.messages_nova_campanha_recipients_dialog_confirm_button(
              _selected.length,
            ),
          ),
        ),
      ],
    );
  }
}
