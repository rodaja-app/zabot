// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Portuguese (`pt`).
class AppLocalizationsPt extends AppLocalizations {
  AppLocalizationsPt([String locale = 'pt']) : super(locale);

  @override
  String get app_title => 'ZaBot';

  @override
  String get common_loading => 'Carregando...';

  @override
  String get common_retry => 'Tentar novamente';

  @override
  String get common_error_message =>
      'Não foi possível carregar os dados. Tente novamente.';

  @override
  String get common_save => 'Salvar';

  @override
  String get common_cancel => 'Cancelar';

  @override
  String get nav_home => 'Início';

  @override
  String get nav_messages => 'Mensagens';

  @override
  String get nav_menu => 'Menu';

  @override
  String get auth_cadastro_title => 'Criar conta';

  @override
  String get auth_cadastro_name_label => 'Nome';

  @override
  String get auth_cadastro_email_label => 'Email';

  @override
  String get auth_cadastro_password_label => 'Senha';

  @override
  String get auth_cadastro_confirm_password_label => 'Confirmar senha';

  @override
  String get auth_cadastro_password_mismatch_error => 'As senhas não coincidem';

  @override
  String get auth_cadastro_submit_button => 'Cadastrar';

  @override
  String get auth_cadastro_login_link => 'Já tem uma conta? Entrar';

  @override
  String get auth_codigo_title => 'Confirme seu email';

  @override
  String auth_codigo_subtitle(String email) {
    return 'Enviamos um código de confirmação para $email.';
  }

  @override
  String get auth_codigo_label => 'Código de confirmação';

  @override
  String get auth_codigo_invalid_error => 'Código inválido. Tente novamente.';

  @override
  String get auth_codigo_confirm_button => 'Confirmar';

  @override
  String get auth_codigo_resend_link => 'Reenviar código';

  @override
  String get auth_codigo_success_message => 'Conta confirmada!';

  @override
  String get auth_login_title => 'Entrar';

  @override
  String get auth_login_email_label => 'Email';

  @override
  String get auth_login_password_label => 'Senha';

  @override
  String get auth_login_submit_button => 'Entrar';

  @override
  String get auth_login_invalid_error => 'Email ou senha inválidos';

  @override
  String get auth_login_signup_link => 'Não tem conta? Cadastre-se';

  @override
  String get home_connection_card_title => 'Conexão com o WhatsApp';

  @override
  String get home_connection_status_connected => 'Conectado';

  @override
  String get home_connection_status_connecting => 'Conectando';

  @override
  String get home_connection_status_disconnected => 'Desconectado';

  @override
  String get home_connection_connected_description =>
      'Seu WhatsApp está conectado e pronto para enviar mensagens.';

  @override
  String get home_connection_disconnected_description =>
      'Conecte seu WhatsApp para começar a enviar mensagens em massa.';

  @override
  String get home_connection_connecting_phone_description =>
      'Aguardando confirmação no WhatsApp do número informado...';

  @override
  String home_connection_pairing_code_label(String code) {
    return 'Código de pareamento: $code';
  }

  @override
  String get home_connection_qr_instructions =>
      'Abra o WhatsApp no celular, toque em Aparelhos conectados e escaneie o código acima.';

  @override
  String get home_connection_connect_button => 'Conectar WhatsApp';

  @override
  String get home_connection_disconnect_button => 'Desconectar';

  @override
  String get home_connection_cancel_button => 'Cancelar';

  @override
  String get home_connection_session_name_label => 'Nome da sessão';

  @override
  String get home_connection_manage_button => 'Gerenciar conexão';

  @override
  String get home_connection_manage_sheet_title => 'Gerenciar conexão';

  @override
  String get home_connection_manage_rename_option => 'Alterar nome da sessão';

  @override
  String get home_connection_manage_disconnect_option => 'Desconectar WhatsApp';

  @override
  String get home_connection_manage_reconnect_option => 'Reconectar WhatsApp';

  @override
  String get home_connection_connect_sheet_title => 'Conectar WhatsApp';

  @override
  String get home_connection_connect_option_qr => 'QR Code';

  @override
  String get home_connection_connect_option_phone => 'Número de telefone';

  @override
  String get home_connection_rename_dialog_title => 'Alterar nome da sessão';

  @override
  String get home_connection_rename_dialog_label => 'Nome da sessão';

  @override
  String get home_connection_phone_dialog_title =>
      'Conectar por número de telefone';

  @override
  String get home_connection_phone_dialog_label => 'Número de telefone';

  @override
  String get home_connection_phone_dialog_instructions =>
      'Você vai receber um código no WhatsApp desse número para confirmar a conexão.';

  @override
  String get home_stats_card_title => 'Resumo';

  @override
  String get home_stats_contacts_imported_label => 'Contatos importados';

  @override
  String get home_stats_messages_sent_label => 'Mensagens enviadas';

  @override
  String get home_stats_messages_pending_label => 'Mensagens pendentes';

  @override
  String get home_stats_failures_label => 'Falhas';

  @override
  String get home_stats_total_messages_label => 'Total de mensagens';

  @override
  String get messages_tab_campaigns => 'Campanhas';

  @override
  String get messages_tab_contacts => 'Contatos';

  @override
  String get messages_campaigns_new_button => 'Nova campanha';

  @override
  String get messages_campaigns_empty => 'Nenhuma campanha ainda';

  @override
  String messages_campaign_recipients_count(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count destinatários',
      one: '$count destinatário',
    );
    return '$_temp0';
  }

  @override
  String get messages_status_sent_label => 'Enviada';

  @override
  String get messages_status_failed_label => 'Falhou';

  @override
  String get messages_status_pending_label => 'Enviando';

  @override
  String get messages_campaign_sent_count_label => 'Enviados';

  @override
  String get messages_campaign_pending_count_label => 'Pendentes';

  @override
  String get messages_campaign_failed_count_label => 'Falhas';

  @override
  String get messages_campaign_total_count_label => 'Total';

  @override
  String messages_campaign_failed_summary(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count falhas no envio',
      one: '$count falha no envio',
    );
    return '$_temp0';
  }

  @override
  String messages_campaigns_view_sent_button(int count) {
    return 'Ver campanhas enviadas ($count)';
  }

  @override
  String get messages_sent_campaigns_title => 'Campanhas enviadas';

  @override
  String get messages_sent_campaigns_empty => 'Nenhuma campanha enviada ainda';

  @override
  String get messages_campaigns_clear_history_button =>
      'Limpar histórico de envio';

  @override
  String get messages_campaigns_clear_history_confirm_title =>
      'Limpar histórico de envio?';

  @override
  String get messages_campaigns_clear_history_confirm_message =>
      'Isso vai apagar todas as campanhas enviadas, pendentes e com falha. Essa ação não pode ser desfeita.';

  @override
  String get messages_campaigns_clear_history_confirm_button => 'Limpar tudo';

  @override
  String get messages_campaigns_clear_history_success =>
      'Histórico de envio limpo.';

  @override
  String get messages_contacts_import_button => 'Importar contatos';

  @override
  String get messages_contacts_search_hint => 'Buscar contato';

  @override
  String get messages_contacts_empty => 'Nenhum contato encontrado';

  @override
  String get messages_contacts_import_dialog_title => 'Importar contatos';

  @override
  String get messages_contacts_import_mode_prompt =>
      'Escolha como deseja adicionar contatos:';

  @override
  String get messages_contacts_import_mode_paste_title => 'Colar lista';

  @override
  String get messages_contacts_import_mode_paste_description =>
      'Cole vários contatos de uma vez, um por linha.';

  @override
  String get messages_contacts_import_mode_manual_title =>
      'Adicionar um por um';

  @override
  String get messages_contacts_import_mode_manual_description =>
      'Cadastre um contato individualmente, com campos personalizados.';

  @override
  String get messages_contacts_manual_submit_button => 'Adicionar contato';

  @override
  String get messages_contacts_import_hint => 'Cole a lista de contatos';

  @override
  String get messages_contacts_import_helper =>
      'Um contato por linha, com código do país (ex: +5511999999999). Opcional: adicione dados separados por vírgula para ID1, ID2, ID3...';

  @override
  String get messages_contacts_import_submit_button => 'Importar';

  @override
  String messages_contacts_import_result(int imported) {
    String _temp0 = intl.Intl.pluralLogic(
      imported,
      locale: localeName,
      other: '$imported contatos importados',
      one: '$imported contato importado',
    );
    return '$_temp0';
  }

  @override
  String messages_contacts_import_result_with_skipped(
      int imported, int skipped) {
    String _temp0 = intl.Intl.pluralLogic(
      imported,
      locale: localeName,
      other: '$imported contatos importados',
      one: '$imported contato importado',
    );
    String _temp1 = intl.Intl.pluralLogic(
      skipped,
      locale: localeName,
      other: '$skipped linhas ignoradas',
      one: '$skipped linha ignorada',
    );
    return '$_temp0, $_temp1';
  }

  @override
  String get messages_contacts_edit_dialog_title => 'Editar contato';

  @override
  String get messages_contacts_phone_label => 'Telefone';

  @override
  String get messages_contacts_add_field_button => 'Adicionar campo';

  @override
  String get common_remove => 'Remover';

  @override
  String get messages_nova_campanha_title => 'Nova campanha';

  @override
  String get messages_nova_campanha_messages_section_title => 'Mensagens';

  @override
  String get messages_nova_campanha_max_messages_hint =>
      'Você pode adicionar até 5 mensagens diferentes; elas serão intercaladas entre os contatos.';

  @override
  String messages_nova_campanha_message_field_label(int index) {
    return 'Mensagem $index';
  }

  @override
  String get messages_nova_campanha_bold_tooltip => 'Negrito';

  @override
  String get messages_nova_campanha_italic_tooltip => 'Itálico';

  @override
  String get messages_nova_campanha_emoji_tooltip => 'Emoji';

  @override
  String get messages_nova_campanha_remove_message_tooltip =>
      'Remover mensagem';

  @override
  String get messages_nova_campanha_add_message_button => 'Adicionar mensagem';

  @override
  String get messages_nova_campanha_personalization_section_title =>
      'Personalização';

  @override
  String get messages_nova_campanha_personalization_empty =>
      'Nenhum dado de personalização disponível nos contatos importados.';

  @override
  String get messages_nova_campanha_personalization_hint =>
      'Toque em um dos campos abaixo para inserir na mensagem selecionada.';

  @override
  String get messages_nova_campanha_media_section_title => 'Mídia (opcional)';

  @override
  String get messages_nova_campanha_media_images_option => 'Imagem';

  @override
  String messages_nova_campanha_media_images_count_label(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count imagens anexadas',
      one: '$count imagem anexada',
    );
    return '$_temp0';
  }

  @override
  String get messages_nova_campanha_media_document => 'Documento';

  @override
  String get messages_nova_campanha_media_audio => 'Áudio';

  @override
  String get messages_nova_campanha_media_pick_file_button =>
      'Selecionar arquivo';

  @override
  String get messages_nova_campanha_media_change_file_button =>
      'Trocar arquivo';

  @override
  String get messages_nova_campanha_media_remove_file_button =>
      'Remover mídia';

  @override
  String get messages_nova_campanha_media_no_file_warning =>
      'Selecione um arquivo para continuar.';

  @override
  String get messages_nova_campanha_media_pick_error =>
      'Não foi possível selecionar o arquivo. Tente novamente.';

  @override
  String get messages_nova_campanha_interval_section_title =>
      'Intervalo de envio';

  @override
  String get messages_nova_campanha_interval_hint =>
      'Cada mensagem será enviada em um tempo aleatório dentro do intervalo definido, para simular um envio mais natural.';

  @override
  String get messages_nova_campanha_interval_min_label => 'Mínimo';

  @override
  String get messages_nova_campanha_interval_max_label => 'Máximo';

  @override
  String messages_nova_campanha_interval_minutes_value(int value) {
    return '$value min';
  }

  @override
  String get messages_nova_campanha_send_section_title => 'Enviar';

  @override
  String get messages_nova_campanha_no_contacts_warning =>
      'Importe contatos na aba Contatos antes de iniciar o envio.';

  @override
  String get messages_nova_campanha_recipients_all_option =>
      'Todos os contatos';

  @override
  String get messages_nova_campanha_recipients_manual_option =>
      'Selecionar contatos';

  @override
  String get messages_nova_campanha_recipients_select_button =>
      'Selecionar contatos';

  @override
  String messages_nova_campanha_recipients_edit_selection_button(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count contatos selecionados',
      one: '$count contato selecionado',
    );
    return '$_temp0';
  }

  @override
  String get messages_nova_campanha_recipients_none_selected_warning =>
      'Selecione ao menos um contato para continuar.';

  @override
  String get messages_nova_campanha_recipients_dialog_title =>
      'Selecionar contatos';

  @override
  String get messages_nova_campanha_recipients_dialog_select_all =>
      'Selecionar todos';

  @override
  String get messages_nova_campanha_recipients_dialog_clear_all =>
      'Limpar seleção';

  @override
  String messages_nova_campanha_recipients_dialog_confirm_button(int count) {
    return 'Confirmar ($count)';
  }

  @override
  String get messages_nova_campanha_submit_button => 'Iniciar envio';

  @override
  String get menu_account_card_title => 'Minha conta';

  @override
  String get menu_account_logout_button => 'Sair';

  @override
  String get wallet_card_title => 'Carteira de créditos';

  @override
  String wallet_card_balance_label(int balance) {
    return '$balance créditos disponíveis';
  }

  @override
  String get wallet_recharge_screen_title => 'Recarregar créditos';

  @override
  String get wallet_packages_section_title => 'Escolha um pacote';

  @override
  String wallet_package_credits_label(int credits) {
    return '$credits créditos';
  }

  @override
  String wallet_package_bonus_label(int bonusPercent) {
    return '+$bonusPercent% de bônus';
  }

  @override
  String get wallet_create_recharge_error =>
      'Não foi possível gerar a cobrança Pix. Tente novamente.';

  @override
  String wallet_pix_amount_label(String priceLabel, int credits) {
    return '$priceLabel · $credits créditos';
  }

  @override
  String get wallet_pix_instructions =>
      'Escaneie o QR code com o app do seu banco ou copie o código Pix abaixo para concluir o pagamento.';

  @override
  String get wallet_pix_copy_button => 'Copiar código Pix';

  @override
  String get wallet_pix_copied_message => 'Código Pix copiado!';

  @override
  String get wallet_pix_waiting_label =>
      'Aguardando confirmação do pagamento...';

  @override
  String get wallet_success_title => 'Pagamento confirmado!';

  @override
  String wallet_success_message(int credits) {
    return '$credits créditos adicionados à sua carteira.';
  }

  @override
  String get wallet_success_button => 'Concluir';

  @override
  String get wallet_method_choice_title => 'Como você quer pagar?';

  @override
  String get wallet_method_pix_label => 'Pix';

  @override
  String get wallet_method_pix_description => 'Pagamento instantâneo via QR code';

  @override
  String get wallet_method_card_label => 'Cartão de crédito';

  @override
  String get wallet_method_card_description => 'Pagamento à vista, aprovação na hora';

  @override
  String get wallet_card_form_title => 'Dados do cartão';

  @override
  String get wallet_card_number_label => 'Número do cartão';

  @override
  String get wallet_card_holder_name_label => 'Nome impresso no cartão';

  @override
  String get wallet_card_expiry_month_label => 'Mês (MM)';

  @override
  String get wallet_card_expiry_year_label => 'Ano (AA)';

  @override
  String get wallet_card_cvv_label => 'CVV';

  @override
  String get wallet_card_cpf_label => 'CPF do titular';

  @override
  String get wallet_card_submit_button => 'Pagar';

  @override
  String get wallet_card_processing_label => 'Processando pagamento...';

  @override
  String get wallet_card_form_invalid_error => 'Preencha todos os campos corretamente antes de continuar.';

  @override
  String get wallet_card_generic_error => 'Não foi possível concluir o pagamento com cartão. Tente novamente ou use Pix.';

  @override
  String get menu_settings_card_title => 'Configurações';

  @override
  String get menu_settings_notifications_label => 'Notificações';

  @override
  String get menu_settings_sound_label => 'Som';

  @override
  String get menu_connections_card_title => 'Conexão do WhatsApp';

  @override
  String get menu_support_card_title => 'Suporte';

  @override
  String get menu_support_email_address => 'suporte@zabot.com.br';

  @override
  String get menu_support_copy_tooltip => 'Copiar e-mail';

  @override
  String get menu_support_email_copied => 'E-mail copiado';

  @override
  String get menu_legal_card_title => 'Termos e Privacidade';

  @override
  String get menu_legal_terms_label => 'Termos de Uso';

  @override
  String get menu_legal_terms_body =>
      'Ao usar o ZaBot, você concorda em utilizar a plataforma apenas para o envio de mensagens a contatos que consentiram em recebê-las, respeitando as políticas do WhatsApp e a legislação aplicável. O uso indevido pode resultar em suspensão da conta.';

  @override
  String get menu_legal_privacy_label => 'Política de Privacidade';

  @override
  String get menu_legal_privacy_body =>
      'O ZaBot armazena apenas os dados necessários para o funcionamento do serviço, como contatos importados e mensagens configuradas. Nenhum dado é compartilhado com terceiros sem consentimento do usuário.';

  @override
  String get menu_about_card_title => 'Sobre';

  @override
  String menu_about_version_label(String version) {
    return 'Versão $version';
  }

  @override
  String get menu_about_app_description =>
      'ZaBot é um app de disparo em massa via WhatsApp com sessões, contatos inteligentes e campanhas.';

  @override
  String get menu_about_service_status_label => 'Status do serviço:';

  @override
  String get menu_about_service_status_operational => 'Operacional';

  @override
  String get menu_about_service_status_degraded => 'Degradado';

  @override
  String get menu_about_service_status_down => 'Fora do ar';

  @override
  String get menu_danger_card_title => 'Conta';

  @override
  String get menu_danger_delete_account_button => 'Excluir conta';

  @override
  String get menu_danger_delete_confirm_title => 'Excluir conta';

  @override
  String get menu_danger_delete_confirm_message =>
      'Essa ação é permanente e não pode ser desfeita. Todos os seus dados, contatos e campanhas serão apagados. Deseja continuar?';

  @override
  String get menu_danger_delete_confirm_button => 'Excluir';
}
