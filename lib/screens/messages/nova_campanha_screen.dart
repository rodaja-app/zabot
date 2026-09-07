import 'package:flutter/material.dart';

import '../../data/contact_repository.dart';
import '../../data/message_repository.dart';
import '../../data/models/campaign_media_type.dart';
import '../../data/models/contact.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_text_field.dart';
import '../../widgets/state_views.dart';

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
  });

  final MessageRepository messageRepository;
  final ContactRepository contactRepository;

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

  CampaignMediaType _mediaType = CampaignMediaType.none;
  int _imageCount = 1;

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

  void _toggleMedia(CampaignMediaType type) {
    setState(() {
      if (_mediaType == type) {
        _mediaType = CampaignMediaType.none;
      } else {
        _mediaType = type;
        if (type == CampaignMediaType.images) _imageCount = 1;
      }
    });
  }

  void _adjustImageCount(int delta) {
    setState(() => _imageCount = (_imageCount + delta).clamp(1, 10));
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
      (_sendToAll || _selectedContactIds.isNotEmpty);

  Future<void> _handleSubmit() async {
    if (!_canSubmit) return;
    setState(() => _isSubmitting = true);

    await widget.messageRepository.createCampaign(
      messages: _nonEmptyMessages,
      recipientCount: _recipientCount,
      mediaType: _mediaType,
      mediaCount: _mediaType == CampaignMediaType.images ? _imageCount : 0,
    );

    if (!mounted) return;
    Navigator.of(context).pop();
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
            Text(
              l10n.messages_nova_campanha_messages_section_title,
              style: Theme.of(context).textTheme.titleMedium,
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
            Text(
              l10n.messages_nova_campanha_personalization_section_title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (_isLoadingContacts)
              AppLoadingView(label: l10n.common_loading)
            else if (personalizationIds.isEmpty)
              Text(
                l10n.messages_nova_campanha_personalization_empty,
                style: Theme.of(context).textTheme.bodyMedium,
              )
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
            Text(
              l10n.messages_nova_campanha_media_section_title,
              style: Theme.of(context).textTheme.titleMedium,
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
                  onTap: () => _toggleMedia(CampaignMediaType.images),
                ),
                _MediaOption(
                  icon: Icons.mic_rounded,
                  label: l10n.messages_nova_campanha_media_audio,
                  selected: _mediaType == CampaignMediaType.audio,
                  onTap: () => _toggleMedia(CampaignMediaType.audio),
                ),
                _MediaOption(
                  icon: Icons.description_rounded,
                  label: l10n.messages_nova_campanha_media_document,
                  selected: _mediaType == CampaignMediaType.document,
                  onTap: () => _toggleMedia(CampaignMediaType.document),
                ),
              ],
            ),
            if (_mediaType == CampaignMediaType.images) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  IconButton(
                    onPressed: _imageCount > 1
                        ? () => _adjustImageCount(-1)
                        : null,
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                  ),
                  Text(
                    l10n.messages_nova_campanha_media_images_count_label(
                      _imageCount,
                    ),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  IconButton(
                    onPressed: _imageCount < 10
                        ? () => _adjustImageCount(1)
                        : null,
                    icon: const Icon(Icons.add_circle_outline_rounded),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 24),
            Text(
              l10n.messages_nova_campanha_interval_section_title,
              style: Theme.of(context).textTheme.titleMedium,
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
            Text(
              l10n.messages_nova_campanha_send_section_title,
              style: Theme.of(context).textTheme.titleMedium,
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderDivider),
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
              border: InputBorder.none,
              isDense: true,
            ),
          ),
          const SizedBox(height: 4),
        ],
      ),
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
          color: selected ? AppColors.purplePrimary : AppColors.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? AppColors.purplePrimary
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
