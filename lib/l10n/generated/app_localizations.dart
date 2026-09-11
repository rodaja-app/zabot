import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_pt.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('pt')];

  /// Nome do aplicativo, exibido no título/splash
  ///
  /// In pt, this message translates to:
  /// **'ZaBot'**
  String get app_title;

  /// Texto genérico de carregamento
  ///
  /// In pt, this message translates to:
  /// **'Carregando...'**
  String get common_loading;

  /// Botão genérico de nova tentativa em telas de erro
  ///
  /// In pt, this message translates to:
  /// **'Tentar novamente'**
  String get common_retry;

  /// Mensagem genérica exibida em estados de erro (Etapa 7)
  ///
  /// In pt, this message translates to:
  /// **'Não foi possível carregar os dados. Tente novamente.'**
  String get common_error_message;

  /// Botão genérico de salvar em diálogos
  ///
  /// In pt, this message translates to:
  /// **'Salvar'**
  String get common_save;

  /// Botão genérico de cancelar em diálogos
  ///
  /// In pt, this message translates to:
  /// **'Cancelar'**
  String get common_cancel;

  /// Rótulo da aba Início na navegação inferior
  ///
  /// In pt, this message translates to:
  /// **'Início'**
  String get nav_home;

  /// Rótulo da aba Mensagens na navegação inferior
  ///
  /// In pt, this message translates to:
  /// **'Mensagens'**
  String get nav_messages;

  /// Rótulo da aba Menu na navegação inferior
  ///
  /// In pt, this message translates to:
  /// **'Menu'**
  String get nav_menu;

  /// Título da tela de Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Criar conta'**
  String get auth_cadastro_title;

  /// Rótulo do campo Nome no Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Nome'**
  String get auth_cadastro_name_label;

  /// Rótulo do campo Email no Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Email'**
  String get auth_cadastro_email_label;

  /// Rótulo do campo Senha no Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Senha'**
  String get auth_cadastro_password_label;

  /// Rótulo do campo Confirmar senha no Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Confirmar senha'**
  String get auth_cadastro_confirm_password_label;

  /// Erro exibido quando Senha e Confirmar senha são diferentes
  ///
  /// In pt, this message translates to:
  /// **'As senhas não coincidem'**
  String get auth_cadastro_password_mismatch_error;

  /// Botão de envio do formulário de Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Cadastrar'**
  String get auth_cadastro_submit_button;

  /// Erro exibido quando o backend responde 409 (email já cadastrado) no Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Este email já está cadastrado'**
  String get auth_cadastro_email_in_use_error;

  /// Erro exibido quando a requisição de Cadastro falha por problema de rede/conexão
  ///
  /// In pt, this message translates to:
  /// **'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.'**
  String get auth_cadastro_network_error;

  /// Link no Cadastro que leva à tela de Login
  ///
  /// In pt, this message translates to:
  /// **'Já tem uma conta? Entrar'**
  String get auth_cadastro_login_link;

  /// Título da tela de Confirmação de código
  ///
  /// In pt, this message translates to:
  /// **'Confirme seu email'**
  String get auth_codigo_title;

  /// Subtítulo da tela de Confirmação de código, mostrando o email de destino
  ///
  /// In pt, this message translates to:
  /// **'Enviamos um código de confirmação para {email}.'**
  String auth_codigo_subtitle(String email);

  /// Rótulo do campo de código na tela de Confirmação
  ///
  /// In pt, this message translates to:
  /// **'Código de confirmação'**
  String get auth_codigo_label;

  /// Erro exibido quando o código digitado está incorreto
  ///
  /// In pt, this message translates to:
  /// **'Código inválido. Tente novamente.'**
  String get auth_codigo_invalid_error;

  /// Botão de confirmação do código
  ///
  /// In pt, this message translates to:
  /// **'Confirmar'**
  String get auth_codigo_confirm_button;

  /// Link para reenviar o código de confirmação por email
  ///
  /// In pt, this message translates to:
  /// **'Reenviar código'**
  String get auth_codigo_resend_link;

  /// Mensagem exibida por instantes após o código ser confirmado com sucesso, antes de entrar no app
  ///
  /// In pt, this message translates to:
  /// **'Conta confirmada!'**
  String get auth_codigo_success_message;

  /// Título da tela de Login
  ///
  /// In pt, this message translates to:
  /// **'Entrar'**
  String get auth_login_title;

  /// Rótulo do campo Email no Login
  ///
  /// In pt, this message translates to:
  /// **'Email'**
  String get auth_login_email_label;

  /// Rótulo do campo Senha no Login
  ///
  /// In pt, this message translates to:
  /// **'Senha'**
  String get auth_login_password_label;

  /// Botão de envio do formulário de Login
  ///
  /// In pt, this message translates to:
  /// **'Entrar'**
  String get auth_login_submit_button;

  /// Erro exibido quando as credenciais de Login estão incorretas
  ///
  /// In pt, this message translates to:
  /// **'Email ou senha inválidos'**
  String get auth_login_invalid_error;

  /// Link no Login que leva à tela de Cadastro
  ///
  /// In pt, this message translates to:
  /// **'Não tem conta? Cadastre-se'**
  String get auth_login_signup_link;

  /// Título do card de conexão na Tela Início
  ///
  /// In pt, this message translates to:
  /// **'Conexão com o WhatsApp'**
  String get home_connection_card_title;

  /// Rótulo do badge de status quando o WhatsApp está conectado
  ///
  /// In pt, this message translates to:
  /// **'Conectado'**
  String get home_connection_status_connected;

  /// Rótulo do badge de status durante a conexão (QR code)
  ///
  /// In pt, this message translates to:
  /// **'Conectando'**
  String get home_connection_status_connecting;

  /// Rótulo do badge de status quando o WhatsApp está desconectado
  ///
  /// In pt, this message translates to:
  /// **'Desconectado'**
  String get home_connection_status_disconnected;

  /// Texto do card de conexão quando conectado
  ///
  /// In pt, this message translates to:
  /// **'Seu WhatsApp está conectado e pronto para enviar mensagens.'**
  String get home_connection_connected_description;

  /// Texto do card de conexão quando desconectado
  ///
  /// In pt, this message translates to:
  /// **'Conecte seu WhatsApp para começar a enviar mensagens em massa.'**
  String get home_connection_disconnected_description;

  /// Texto do card de conexão durante o fluxo de conexão por número de telefone
  ///
  /// In pt, this message translates to:
  /// **'Aguardando confirmação no WhatsApp do número informado...'**
  String get home_connection_connecting_phone_description;

  /// Código de pareamento exibido durante o fluxo de conexão por número de telefone, quando o backend retorna um código para digitar no WhatsApp
  ///
  /// In pt, this message translates to:
  /// **'Código de pareamento: {code}'**
  String home_connection_pairing_code_label(String code);

  /// Instruções exibidas durante o fluxo de QR code
  ///
  /// In pt, this message translates to:
  /// **'Abra o WhatsApp no celular, toque em Aparelhos conectados e escaneie o código acima.'**
  String get home_connection_qr_instructions;

  /// Botão para iniciar a conexão do WhatsApp
  ///
  /// In pt, this message translates to:
  /// **'Conectar WhatsApp'**
  String get home_connection_connect_button;

  /// Botão para desconectar o WhatsApp já conectado
  ///
  /// In pt, this message translates to:
  /// **'Desconectar'**
  String get home_connection_disconnect_button;

  /// Botão para cancelar o fluxo de conexão em andamento
  ///
  /// In pt, this message translates to:
  /// **'Cancelar'**
  String get home_connection_cancel_button;

  /// Rótulo acima do nome da sessão, quando conectado
  ///
  /// In pt, this message translates to:
  /// **'Nome da sessão'**
  String get home_connection_session_name_label;

  /// Botão que abre as opções de gerenciamento da conexão, quando conectado
  ///
  /// In pt, this message translates to:
  /// **'Gerenciar conexão'**
  String get home_connection_manage_button;

  /// Título do menu de opções de "Gerenciar conexão"
  ///
  /// In pt, this message translates to:
  /// **'Gerenciar conexão'**
  String get home_connection_manage_sheet_title;

  /// Opção do menu "Gerenciar conexão" para renomear a sessão
  ///
  /// In pt, this message translates to:
  /// **'Alterar nome da sessão'**
  String get home_connection_manage_rename_option;

  /// Opção do menu "Gerenciar conexão" para desconectar
  ///
  /// In pt, this message translates to:
  /// **'Desconectar WhatsApp'**
  String get home_connection_manage_disconnect_option;

  /// Opção do menu "Gerenciar conexão" para desconectar e conectar de novo
  ///
  /// In pt, this message translates to:
  /// **'Reconectar WhatsApp'**
  String get home_connection_manage_reconnect_option;

  /// Título do menu de opções para iniciar a conexão
  ///
  /// In pt, this message translates to:
  /// **'Conectar WhatsApp'**
  String get home_connection_connect_sheet_title;

  /// Opção de conectar escaneando um QR Code
  ///
  /// In pt, this message translates to:
  /// **'QR Code'**
  String get home_connection_connect_option_qr;

  /// Opção de conectar informando o número de telefone
  ///
  /// In pt, this message translates to:
  /// **'Número de telefone'**
  String get home_connection_connect_option_phone;

  /// Título do diálogo de renomear a sessão
  ///
  /// In pt, this message translates to:
  /// **'Alterar nome da sessão'**
  String get home_connection_rename_dialog_title;

  /// Rótulo do campo de texto do diálogo de renomear a sessão
  ///
  /// In pt, this message translates to:
  /// **'Nome da sessão'**
  String get home_connection_rename_dialog_label;

  /// Título do diálogo de conectar por número de telefone
  ///
  /// In pt, this message translates to:
  /// **'Conectar por número de telefone'**
  String get home_connection_phone_dialog_title;

  /// Rótulo do campo de texto do diálogo de conectar por número de telefone
  ///
  /// In pt, this message translates to:
  /// **'Número internacional (DDI + número)'**
  String get home_connection_phone_dialog_label;

  /// Instruções exibidas no diálogo de conectar por número de telefone
  ///
  /// In pt, this message translates to:
  /// **'Informe o número internacional completo em formato E.164: DDI + código de área + número, apenas dígitos (ex.: 14155552671). O código de pareamento aparecerá aqui no ZaBot.'**
  String get home_connection_phone_dialog_instructions;

  /// Título do card de resumo/estatísticas na Tela Início
  ///
  /// In pt, this message translates to:
  /// **'Resumo'**
  String get home_stats_card_title;

  /// Rótulo do número de contatos importados
  ///
  /// In pt, this message translates to:
  /// **'Contatos importados'**
  String get home_stats_contacts_imported_label;

  /// Rótulo do número de mensagens enviadas
  ///
  /// In pt, this message translates to:
  /// **'Mensagens enviadas'**
  String get home_stats_messages_sent_label;

  /// Rótulo do número de mensagens pendentes de envio
  ///
  /// In pt, this message translates to:
  /// **'Mensagens pendentes'**
  String get home_stats_messages_pending_label;

  /// Rótulo do número de mensagens que falharam
  ///
  /// In pt, this message translates to:
  /// **'Falhas'**
  String get home_stats_failures_label;

  /// Rótulo do total de mensagens (enviadas + pendentes + falhas)
  ///
  /// In pt, this message translates to:
  /// **'Total de mensagens'**
  String get home_stats_total_messages_label;

  /// Aba de campanhas na Tela Mensagens
  ///
  /// In pt, this message translates to:
  /// **'Campanhas'**
  String get messages_tab_campaigns;

  /// Aba de contatos na Tela Mensagens
  ///
  /// In pt, this message translates to:
  /// **'Contatos'**
  String get messages_tab_contacts;

  /// Botão para iniciar a criação de uma nova campanha
  ///
  /// In pt, this message translates to:
  /// **'Nova campanha'**
  String get messages_campaigns_new_button;

  /// Texto exibido quando não há campanhas
  ///
  /// In pt, this message translates to:
  /// **'Nenhuma campanha ainda'**
  String get messages_campaigns_empty;

  /// Contagem de destinatários de uma campanha
  ///
  /// In pt, this message translates to:
  /// **'{count, plural, one{{count} destinatário} other{{count} destinatários}}'**
  String messages_campaign_recipients_count(int count);

  /// Rótulo de status de campanha enviada com sucesso
  ///
  /// In pt, this message translates to:
  /// **'Enviada'**
  String get messages_status_sent_label;

  /// Rótulo de status de campanha que falhou ao enviar
  ///
  /// In pt, this message translates to:
  /// **'Falhou'**
  String get messages_status_failed_label;

  /// Rótulo de status de campanha em andamento/pendente
  ///
  /// In pt, this message translates to:
  /// **'Enviando'**
  String get messages_status_pending_label;

  /// Rótulo do contador de mensagens enviadas no card de campanha
  ///
  /// In pt, this message translates to:
  /// **'Enviados'**
  String get messages_campaign_sent_count_label;

  /// Rótulo do contador de mensagens pendentes no card de campanha
  ///
  /// In pt, this message translates to:
  /// **'Pendentes'**
  String get messages_campaign_pending_count_label;

  /// Rótulo do contador de mensagens que falharam no card de campanha
  ///
  /// In pt, this message translates to:
  /// **'Falhas'**
  String get messages_campaign_failed_count_label;

  /// Rótulo do contador total de mensagens no card de campanha
  ///
  /// In pt, this message translates to:
  /// **'Total'**
  String get messages_campaign_total_count_label;

  /// Resumo de falhas exibido em campanhas já concluídas com falhas
  ///
  /// In pt, this message translates to:
  /// **'{count, plural, one{{count} falha no envio} other{{count} falhas no envio}}'**
  String messages_campaign_failed_summary(int count);

  /// Botão que abre a tela de campanhas já enviadas, com a contagem entre parênteses
  ///
  /// In pt, this message translates to:
  /// **'Ver campanhas enviadas ({count})'**
  String messages_campaigns_view_sent_button(int count);

  /// Título da tela que lista as campanhas já enviadas
  ///
  /// In pt, this message translates to:
  /// **'Campanhas enviadas'**
  String get messages_sent_campaigns_title;

  /// Texto exibido quando não há campanhas enviadas
  ///
  /// In pt, this message translates to:
  /// **'Nenhuma campanha enviada ainda'**
  String get messages_sent_campaigns_empty;

  /// Botão destrutivo que apaga todo o histórico de campanhas (enviadas, pendentes e falhas)
  ///
  /// In pt, this message translates to:
  /// **'Limpar histórico de envio'**
  String get messages_campaigns_clear_history_button;

  /// Título do diálogo de confirmação antes de limpar o histórico de campanhas
  ///
  /// In pt, this message translates to:
  /// **'Limpar histórico de envio?'**
  String get messages_campaigns_clear_history_confirm_title;

  /// Mensagem de aviso do diálogo de confirmação de limpeza de histórico
  ///
  /// In pt, this message translates to:
  /// **'Isso vai apagar todas as campanhas enviadas, pendentes e com falha. Essa ação não pode ser desfeita.'**
  String get messages_campaigns_clear_history_confirm_message;

  /// Botão de confirmação final da limpeza de histórico
  ///
  /// In pt, this message translates to:
  /// **'Limpar tudo'**
  String get messages_campaigns_clear_history_confirm_button;

  /// Snackbar exibida após limpar o histórico de campanhas com sucesso
  ///
  /// In pt, this message translates to:
  /// **'Histórico de envio limpo.'**
  String get messages_campaigns_clear_history_success;

  /// Botão para importar novos contatos
  ///
  /// In pt, this message translates to:
  /// **'Importar contatos'**
  String get messages_contacts_import_button;

  /// Botão que abre o modal de contatos importados na aba Campanhas
  ///
  /// In pt, this message translates to:
  /// **'Contatos importados'**
  String get messages_contacts_directory_button;

  /// Título do modal que lista os contatos importados
  ///
  /// In pt, this message translates to:
  /// **'Contatos importados'**
  String get messages_contacts_directory_title;

  /// Explicação exibida no modal de contatos importados
  ///
  /// In pt, this message translates to:
  /// **'Pesquise, edite ou remova um contato antes de iniciar uma campanha.'**
  String get messages_contacts_directory_description;

  /// Rótulo do campo de busca de contatos
  ///
  /// In pt, this message translates to:
  /// **'Buscar contato'**
  String get messages_contacts_search_hint;

  /// Texto exibido quando a lista de contatos está vazia
  ///
  /// In pt, this message translates to:
  /// **'Nenhum contato encontrado'**
  String get messages_contacts_empty;

  /// Título do diálogo de importação de contatos
  ///
  /// In pt, this message translates to:
  /// **'Importar contatos'**
  String get messages_contacts_import_dialog_title;

  /// Texto de introdução perguntando o modo de importação
  ///
  /// In pt, this message translates to:
  /// **'Escolha como deseja adicionar contatos:'**
  String get messages_contacts_import_mode_prompt;

  /// Opção de importar colando vários contatos de uma vez
  ///
  /// In pt, this message translates to:
  /// **'Colar lista'**
  String get messages_contacts_import_mode_paste_title;

  /// Descrição da opção de colar lista de contatos
  ///
  /// In pt, this message translates to:
  /// **'Cole vários contatos de uma vez, um por linha.'**
  String get messages_contacts_import_mode_paste_description;

  /// Opção de cadastrar um contato individualmente
  ///
  /// In pt, this message translates to:
  /// **'Adicionar um por um'**
  String get messages_contacts_import_mode_manual_title;

  /// Descrição da opção de adicionar contato individualmente
  ///
  /// In pt, this message translates to:
  /// **'Cadastre um contato individualmente, com campos personalizados.'**
  String get messages_contacts_import_mode_manual_description;

  /// Botão de confirmação do cadastro manual de contato
  ///
  /// In pt, this message translates to:
  /// **'Adicionar contato'**
  String get messages_contacts_manual_submit_button;

  /// Rótulo do campo de colar a lista de contatos
  ///
  /// In pt, this message translates to:
  /// **'Cole a lista de contatos'**
  String get messages_contacts_import_hint;

  /// Texto de ajuda explicando o formato esperado para colar os contatos
  ///
  /// In pt, this message translates to:
  /// **'Um contato por linha, com código do país (ex: +5511999999999). Opcional: adicione dados separados por vírgula para ID1, ID2, ID3...'**
  String get messages_contacts_import_helper;

  /// Botão de confirmação do diálogo de importação de contatos
  ///
  /// In pt, this message translates to:
  /// **'Importar'**
  String get messages_contacts_import_submit_button;

  /// Resultado da importação quando não há linhas inválidas
  ///
  /// In pt, this message translates to:
  /// **'{imported, plural, one{{imported} contato importado} other{{imported} contatos importados}}'**
  String messages_contacts_import_result(int imported);

  /// Resultado da importação quando há linhas inválidas ignoradas
  ///
  /// In pt, this message translates to:
  /// **'{imported, plural, one{{imported} contato importado} other{{imported} contatos importados}}, {skipped, plural, one{{skipped} linha ignorada} other{{skipped} linhas ignoradas}}'**
  String messages_contacts_import_result_with_skipped(
      int imported, int skipped);

  /// Título do diálogo de edição de contato
  ///
  /// In pt, this message translates to:
  /// **'Editar contato'**
  String get messages_contacts_edit_dialog_title;

  /// Rótulo do campo de telefone no diálogo de edição de contato
  ///
  /// In pt, this message translates to:
  /// **'Telefone'**
  String get messages_contacts_phone_label;

  /// Botão para adicionar um novo campo de personalização (ID) ao contato
  ///
  /// In pt, this message translates to:
  /// **'Adicionar campo'**
  String get messages_contacts_add_field_button;

  /// Botão genérico de remover em diálogos
  ///
  /// In pt, this message translates to:
  /// **'Remover'**
  String get common_remove;

  /// Título da tela de criação de campanha
  ///
  /// In pt, this message translates to:
  /// **'Nova campanha'**
  String get messages_nova_campanha_title;

  /// Título da seção de composição das mensagens da campanha
  ///
  /// In pt, this message translates to:
  /// **'Mensagens'**
  String get messages_nova_campanha_messages_section_title;

  /// Texto explicando o limite de 5 mensagens por campanha
  ///
  /// In pt, this message translates to:
  /// **'Você pode adicionar até 5 mensagens diferentes; elas serão intercaladas entre os contatos.'**
  String get messages_nova_campanha_max_messages_hint;

  /// Rótulo de cada campo de mensagem, numerado
  ///
  /// In pt, this message translates to:
  /// **'Mensagem {index}'**
  String messages_nova_campanha_message_field_label(int index);

  /// Dica do botão de aplicar negrito no texto selecionado
  ///
  /// In pt, this message translates to:
  /// **'Negrito'**
  String get messages_nova_campanha_bold_tooltip;

  /// Dica do botão de aplicar itálico no texto selecionado
  ///
  /// In pt, this message translates to:
  /// **'Itálico'**
  String get messages_nova_campanha_italic_tooltip;

  /// Dica do botão de abrir o seletor de emojis
  ///
  /// In pt, this message translates to:
  /// **'Emoji'**
  String get messages_nova_campanha_emoji_tooltip;

  /// Dica do botão de remover um campo de mensagem
  ///
  /// In pt, this message translates to:
  /// **'Remover mensagem'**
  String get messages_nova_campanha_remove_message_tooltip;

  /// Botão para adicionar outro campo de mensagem
  ///
  /// In pt, this message translates to:
  /// **'Adicionar mensagem'**
  String get messages_nova_campanha_add_message_button;

  /// Título da seção de personalização por IDs
  ///
  /// In pt, this message translates to:
  /// **'Personalização'**
  String get messages_nova_campanha_personalization_section_title;

  /// Texto exibido quando nenhum contato tem campos de personalização (ID1, ID2...)
  ///
  /// In pt, this message translates to:
  /// **'Nenhum dado de personalização disponível nos contatos importados.'**
  String get messages_nova_campanha_personalization_empty;

  /// Título do guia de personalização exibido sem campos ID disponíveis
  ///
  /// In pt, this message translates to:
  /// **'Faça cada mensagem parecer pessoal'**
  String get messages_nova_campanha_personalization_guide_title;

  /// Explicação de como o marcador ID é substituído na mensagem
  ///
  /// In pt, this message translates to:
  /// **'Use {ID1} para trocar o marcador pelo dado salvo em cada contato, como o nome.'**
  String get messages_nova_campanha_personalization_guide_description;

  /// Primeiro passo para configurar personalização
  ///
  /// In pt, this message translates to:
  /// **'Ao importar um contato, salve o nome no campo ID1.'**
  String get messages_nova_campanha_personalization_guide_step_one;

  /// Segundo passo para usar personalização
  ///
  /// In pt, this message translates to:
  /// **'Depois, toque em {ID1} aqui para inserir o nome na sua mensagem.'**
  String get messages_nova_campanha_personalization_guide_step_two;

  /// Rótulo acima do exemplo de mensagem personalizada
  ///
  /// In pt, this message translates to:
  /// **'EXEMPLO DE MENSAGEM'**
  String get messages_nova_campanha_personalization_guide_example_label;

  /// Exemplo completo de um contato e uma mensagem com marcador ID1
  ///
  /// In pt, this message translates to:
  /// **'Contato salvo: Ana no ID1\\nMensagem: Olá, {ID1}! Temos uma novidade para você.'**
  String get messages_nova_campanha_personalization_guide_example;

  /// Texto explicando como usar os chips de personalização
  ///
  /// In pt, this message translates to:
  /// **'Toque em um dos campos abaixo para inserir na mensagem selecionada.'**
  String get messages_nova_campanha_personalization_hint;

  /// Título da seção de seleção de mídia
  ///
  /// In pt, this message translates to:
  /// **'Mídia (opcional)'**
  String get messages_nova_campanha_media_section_title;

  /// Opção de mídia: imagem(ns)
  ///
  /// In pt, this message translates to:
  /// **'Imagem'**
  String get messages_nova_campanha_media_images_option;

  /// Contagem de imagens anexadas à campanha
  ///
  /// In pt, this message translates to:
  /// **'{count, plural, one{{count} imagem anexada} other{{count} imagens anexadas}}'**
  String messages_nova_campanha_media_images_count_label(int count);

  /// Opção de mídia: documento
  ///
  /// In pt, this message translates to:
  /// **'Documento'**
  String get messages_nova_campanha_media_document;

  /// Opção de mídia: áudio
  ///
  /// In pt, this message translates to:
  /// **'Áudio'**
  String get messages_nova_campanha_media_audio;

  /// Botão que abre o seletor de arquivos nativo para anexar mídia à campanha
  ///
  /// In pt, this message translates to:
  /// **'Selecionar arquivo'**
  String get messages_nova_campanha_media_pick_file_button;

  /// Botão que reabre o seletor de arquivos para substituir a mídia já escolhida
  ///
  /// In pt, this message translates to:
  /// **'Trocar arquivo'**
  String get messages_nova_campanha_media_change_file_button;

  /// Botão que remove a mídia escolhida e volta a seção de mídia para "nenhuma"
  ///
  /// In pt, this message translates to:
  /// **'Remover mídia'**
  String get messages_nova_campanha_media_remove_file_button;

  /// Aviso exibido quando um tipo de mídia está marcado mas nenhum arquivo foi escolhido ainda
  ///
  /// In pt, this message translates to:
  /// **'Selecione um arquivo para continuar.'**
  String get messages_nova_campanha_media_no_file_warning;

  /// Snackbar exibida quando o seletor de arquivos nativo falha
  ///
  /// In pt, this message translates to:
  /// **'Não foi possível selecionar o arquivo. Tente novamente.'**
  String get messages_nova_campanha_media_pick_error;

  /// Aviso exibido quando o usuário tenta iniciar uma campanha sem uma sessão WhatsApp conectada
  ///
  /// In pt, this message translates to:
  /// **'Conecte seu WhatsApp na tela Início antes de iniciar uma campanha.'**
  String get messages_nova_campanha_whatsapp_required;

  /// Aviso exibido antes de abrir a recarga quando o saldo não cobre todos os envios
  ///
  /// In pt, this message translates to:
  /// **'Você não tem créditos suficientes para esta campanha. Vamos abrir a recarga.'**
  String get messages_nova_campanha_balance_required;

  /// Título da seção de intervalo aleatório entre envios
  ///
  /// In pt, this message translates to:
  /// **'Intervalo de envio'**
  String get messages_nova_campanha_interval_section_title;

  /// Texto explicando o intervalo aleatório entre envios
  ///
  /// In pt, this message translates to:
  /// **'Cada mensagem será enviada em um tempo aleatório dentro do intervalo definido, para simular um envio mais natural.'**
  String get messages_nova_campanha_interval_hint;

  /// Rótulo do contador de intervalo mínimo, em minutos
  ///
  /// In pt, this message translates to:
  /// **'Mínimo'**
  String get messages_nova_campanha_interval_min_label;

  /// Rótulo do contador de intervalo máximo, em minutos
  ///
  /// In pt, this message translates to:
  /// **'Máximo'**
  String get messages_nova_campanha_interval_max_label;

  /// Valor do contador de intervalo, em minutos
  ///
  /// In pt, this message translates to:
  /// **'{value} min'**
  String messages_nova_campanha_interval_minutes_value(int value);

  /// Título da seção de envio da campanha
  ///
  /// In pt, this message translates to:
  /// **'Enviar'**
  String get messages_nova_campanha_send_section_title;

  /// Aviso exibido quando não há contatos importados, bloqueando o envio
  ///
  /// In pt, this message translates to:
  /// **'Importe contatos na aba Contatos antes de iniciar o envio.'**
  String get messages_nova_campanha_no_contacts_warning;

  /// Opção de enviar para todos os contatos importados
  ///
  /// In pt, this message translates to:
  /// **'Todos os contatos'**
  String get messages_nova_campanha_recipients_all_option;

  /// Opção de escolher manualmente os contatos que vão receber o envio
  ///
  /// In pt, this message translates to:
  /// **'Selecionar contatos'**
  String get messages_nova_campanha_recipients_manual_option;

  /// Botão que abre o modal de seleção manual de contatos
  ///
  /// In pt, this message translates to:
  /// **'Selecionar contatos'**
  String get messages_nova_campanha_recipients_select_button;

  /// Botão que reabre o modal de seleção, mostrando quantos contatos já foram escolhidos
  ///
  /// In pt, this message translates to:
  /// **'{count, plural, one{{count} contato selecionado} other{{count} contatos selecionados}}'**
  String messages_nova_campanha_recipients_edit_selection_button(int count);

  /// Aviso exibido quando o modo de seleção manual está ativo mas nenhum contato foi escolhido
  ///
  /// In pt, this message translates to:
  /// **'Selecione ao menos um contato para continuar.'**
  String get messages_nova_campanha_recipients_none_selected_warning;

  /// Título do modal de seleção manual de contatos
  ///
  /// In pt, this message translates to:
  /// **'Selecionar contatos'**
  String get messages_nova_campanha_recipients_dialog_title;

  /// Botão para marcar todos os contatos filtrados no modal de seleção
  ///
  /// In pt, this message translates to:
  /// **'Selecionar todos'**
  String get messages_nova_campanha_recipients_dialog_select_all;

  /// Botão para desmarcar todos os contatos selecionados no modal de seleção
  ///
  /// In pt, this message translates to:
  /// **'Limpar seleção'**
  String get messages_nova_campanha_recipients_dialog_clear_all;

  /// Botão de confirmação da seleção manual de contatos, com a contagem selecionada
  ///
  /// In pt, this message translates to:
  /// **'Confirmar ({count})'**
  String messages_nova_campanha_recipients_dialog_confirm_button(int count);

  /// Botão para iniciar o envio da campanha
  ///
  /// In pt, this message translates to:
  /// **'Iniciar envio'**
  String get messages_nova_campanha_submit_button;

  /// Título do card de conta na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Minha conta'**
  String get menu_account_card_title;

  /// Botão de logout na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Sair'**
  String get menu_account_logout_button;

  /// Título do card de carteira na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Carteira de créditos'**
  String get wallet_card_title;

  /// Saldo atual exibido no card de carteira na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'{balance} créditos disponíveis'**
  String wallet_card_balance_label(int balance);

  /// Título da tela de recarga de créditos
  ///
  /// In pt, this message translates to:
  /// **'Recarregar créditos'**
  String get wallet_recharge_screen_title;

  /// Título da lista de pacotes de recarga
  ///
  /// In pt, this message translates to:
  /// **'Escolha um pacote'**
  String get wallet_packages_section_title;

  String get wallet_custom_amount_title;
  String get wallet_custom_amount_description;
  String get wallet_custom_amount_label;
  String get wallet_custom_amount_continue;
  String get wallet_credits_explanation;
  String get wallet_bonus_explanation;

  /// Quantidade de créditos de um pacote de recarga
  ///
  /// In pt, this message translates to:
  /// **'{credits} créditos'**
  String wallet_package_credits_label(int credits);

  /// Percentual de bônus de um pacote de recarga
  ///
  /// In pt, this message translates to:
  /// **'+{bonusPercent}% de bônus'**
  String wallet_package_bonus_label(int bonusPercent);

  /// Mensagem exibida quando a criação da recarga Pix falha
  ///
  /// In pt, this message translates to:
  /// **'Não foi possível gerar a cobrança Pix. Tente novamente.'**
  String get wallet_create_recharge_error;

  /// Valor e créditos da cobrança Pix em andamento
  ///
  /// In pt, this message translates to:
  /// **'{priceLabel} · {credits} créditos'**
  String wallet_pix_amount_label(String priceLabel, int credits);

  /// Instruções de pagamento exibidas junto ao QR code do Pix
  ///
  /// In pt, this message translates to:
  /// **'Escaneie o QR code com o app do seu banco ou copie o código Pix abaixo para concluir o pagamento.'**
  String get wallet_pix_instructions;

  /// Botão que copia o código Pix copia-e-cola
  ///
  /// In pt, this message translates to:
  /// **'Copiar código Pix'**
  String get wallet_pix_copy_button;

  /// Confirmação exibida após copiar o código Pix
  ///
  /// In pt, this message translates to:
  /// **'Código Pix copiado!'**
  String get wallet_pix_copied_message;

  /// Mensagem exibida enquanto aguarda a confirmação do Pix
  ///
  /// In pt, this message translates to:
  /// **'Aguardando confirmação do pagamento...'**
  String get wallet_pix_waiting_label;

  /// Título da tela de sucesso após a confirmação da recarga
  ///
  /// In pt, this message translates to:
  /// **'Pagamento confirmado!'**
  String get wallet_success_title;

  /// Mensagem de sucesso após a confirmação da recarga
  ///
  /// In pt, this message translates to:
  /// **'{credits} créditos adicionados à sua carteira.'**
  String wallet_success_message(int credits);

  /// Botão que fecha a tela de recarga após o sucesso
  ///
  /// In pt, this message translates to:
  /// **'Concluir'**
  String get wallet_success_button;

  /// Título da etapa de escolha do método de pagamento (Pix ou cartão)
  ///
  /// In pt, this message translates to:
  /// **'Como você quer pagar?'**
  String get wallet_method_choice_title;

  /// Rótulo da opção de pagamento via Pix
  ///
  /// In pt, this message translates to:
  /// **'Pix'**
  String get wallet_method_pix_label;

  /// Descrição da opção de pagamento via Pix
  ///
  /// In pt, this message translates to:
  /// **'Pagamento instantâneo via QR code'**
  String get wallet_method_pix_description;

  /// Rótulo da opção de pagamento via cartão de crédito
  ///
  /// In pt, this message translates to:
  /// **'Cartão de crédito'**
  String get wallet_method_card_label;

  /// Descrição da opção de pagamento via cartão de crédito
  ///
  /// In pt, this message translates to:
  /// **'Pagamento à vista, aprovação na hora'**
  String get wallet_method_card_description;

  /// Título do formulário de dados do cartão
  ///
  /// In pt, this message translates to:
  /// **'Dados do cartão'**
  String get wallet_card_form_title;

  /// Rótulo do campo de número do cartão
  ///
  /// In pt, this message translates to:
  /// **'Número do cartão'**
  String get wallet_card_number_label;

  /// Rótulo do campo de nome do titular do cartão
  ///
  /// In pt, this message translates to:
  /// **'Nome impresso no cartão'**
  String get wallet_card_holder_name_label;

  /// Rótulo do campo de mês de validade do cartão
  ///
  /// In pt, this message translates to:
  /// **'Mês (MM)'**
  String get wallet_card_expiry_month_label;

  /// Rótulo do campo de ano de validade do cartão
  ///
  /// In pt, this message translates to:
  /// **'Ano (AA)'**
  String get wallet_card_expiry_year_label;

  /// Rótulo do campo de código de segurança do cartão
  ///
  /// In pt, this message translates to:
  /// **'CVV'**
  String get wallet_card_cvv_label;

  /// Rótulo do campo de CPF do titular do cartão
  ///
  /// In pt, this message translates to:
  /// **'CPF do titular'**
  String get wallet_card_cpf_label;

  /// Botão que confirma o pagamento com cartão
  ///
  /// In pt, this message translates to:
  /// **'Pagar'**
  String get wallet_card_submit_button;

  /// Mensagem exibida enquanto o pagamento com cartão está sendo processado
  ///
  /// In pt, this message translates to:
  /// **'Processando pagamento...'**
  String get wallet_card_processing_label;

  /// Erro exibido quando o formulário de cartão tem campos inválidos ou incompletos
  ///
  /// In pt, this message translates to:
  /// **'Preencha todos os campos corretamente antes de continuar.'**
  String get wallet_card_form_invalid_error;

  /// Erro genérico exibido quando o pagamento com cartão falha por motivo não específico (rede, tokenização etc.)
  ///
  /// In pt, this message translates to:
  /// **'Não foi possível concluir o pagamento com cartão. Tente novamente ou use Pix.'**
  String get wallet_card_generic_error;

  /// Título do card de configurações na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Configurações'**
  String get menu_settings_card_title;

  /// Rótulo do switch de notificações
  ///
  /// In pt, this message translates to:
  /// **'Notificações'**
  String get menu_settings_notifications_label;

  /// Rótulo do switch de som
  ///
  /// In pt, this message translates to:
  /// **'Som'**
  String get menu_settings_sound_label;

  /// Título do card de conexões na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Conexão do WhatsApp'**
  String get menu_connections_card_title;

  /// Título do card de suporte na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Suporte'**
  String get menu_support_card_title;

  /// Endereço de e-mail de suporte exibido na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'suporte@zabot.com.br'**
  String get menu_support_email_address;

  /// Tooltip do botão que copia o e-mail de suporte
  ///
  /// In pt, this message translates to:
  /// **'Copiar e-mail'**
  String get menu_support_copy_tooltip;

  /// Mensagem exibida após copiar o e-mail de suporte
  ///
  /// In pt, this message translates to:
  /// **'E-mail copiado'**
  String get menu_support_email_copied;

  /// Título do card de termos e privacidade na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Termos e Privacidade'**
  String get menu_legal_card_title;

  /// Item que abre os Termos de Uso
  ///
  /// In pt, this message translates to:
  /// **'Termos de Uso'**
  String get menu_legal_terms_label;

  /// Texto placeholder dos Termos de Uso
  ///
  /// In pt, this message translates to:
  /// **'Ao usar o ZaBot, você concorda em utilizar a plataforma apenas para o envio de mensagens a contatos que consentiram em recebê-las, respeitando as políticas do WhatsApp e a legislação aplicável. O uso indevido pode resultar em suspensão da conta.'**
  String get menu_legal_terms_body;

  /// Item que abre a Política de Privacidade
  ///
  /// In pt, this message translates to:
  /// **'Política de Privacidade'**
  String get menu_legal_privacy_label;

  /// Texto placeholder da Política de Privacidade
  ///
  /// In pt, this message translates to:
  /// **'O ZaBot armazena apenas os dados necessários para o funcionamento do serviço, como contatos importados e mensagens configuradas. Nenhum dado é compartilhado com terceiros sem consentimento do usuário.'**
  String get menu_legal_privacy_body;

  /// Título do card de informações do app na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Sobre'**
  String get menu_about_card_title;

  /// Versão do aplicativo exibida no card Sobre
  ///
  /// In pt, this message translates to:
  /// **'Versão {version}'**
  String menu_about_version_label(String version);

  /// Descrição curta do app exibida no card Sobre
  ///
  /// In pt, this message translates to:
  /// **'ZaBot é um app de disparo em massa via WhatsApp com sessões, contatos inteligentes e campanhas.'**
  String get menu_about_app_description;

  /// Rótulo antes do badge de status do serviço
  ///
  /// In pt, this message translates to:
  /// **'Status do serviço:'**
  String get menu_about_service_status_label;

  /// Status do serviço quando tudo está funcionando normalmente
  ///
  /// In pt, this message translates to:
  /// **'Operacional'**
  String get menu_about_service_status_operational;

  /// Status do serviço quando há instabilidade parcial
  ///
  /// In pt, this message translates to:
  /// **'Degradado'**
  String get menu_about_service_status_degraded;

  /// Status do serviço quando está indisponível
  ///
  /// In pt, this message translates to:
  /// **'Fora do ar'**
  String get menu_about_service_status_down;

  /// Título do card de ações sensíveis de conta na Tela Menu
  ///
  /// In pt, this message translates to:
  /// **'Conta'**
  String get menu_danger_card_title;

  /// Botão que inicia a exclusão da conta
  ///
  /// In pt, this message translates to:
  /// **'Excluir conta'**
  String get menu_danger_delete_account_button;

  /// Título do diálogo de confirmação de exclusão de conta
  ///
  /// In pt, this message translates to:
  /// **'Excluir conta'**
  String get menu_danger_delete_confirm_title;

  /// Mensagem do diálogo de confirmação de exclusão de conta
  ///
  /// In pt, this message translates to:
  /// **'Essa ação é permanente e não pode ser desfeita. Todos os seus dados, contatos e campanhas serão apagados. Deseja continuar?'**
  String get menu_danger_delete_confirm_message;

  /// Botão de confirmação final da exclusão de conta
  ///
  /// In pt, this message translates to:
  /// **'Excluir'**
  String get menu_danger_delete_confirm_button;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['pt'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'pt':
      return AppLocalizationsPt();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
