/**
 * Categorias de erro usadas em todo o backend (API, fila, sessões WhatsApp,
 * proxy). O objetivo é nunca logar "deu erro" genérico — todo erro cai em
 * uma destas categorias, com uma causa identificável.
 */
export enum ErrorCategory {
  REDE = 'rede',
  PROXY = 'proxy',
  NUMERO_INVALIDO = 'numero_invalido',
  RATE_LIMIT = 'rate_limit',
  AUTENTICACAO = 'autenticacao',
  VALIDACAO = 'validacao',
  BANCO_DE_DADOS = 'banco_de_dados',
  ENTREGA_NAO_CONFIRMADA = 'entrega_nao_confirmada',
  /** Ação exigia um socket Baileys ativo (ex.: verificar número — etapa 13) e a sessão não está CONECTADA agora. */
  SESSAO_DESCONECTADA = 'sessao_desconectada',
  /** Falha ao gravar/ler mídia de campanha (etapa 14) no provider de storage escolhido (S3-compatível ou disco local) — nunca confundido com REDE genérica, para diferenciar "S3 fora do ar" de "disco local sem espaço/permissão". */
  ARMAZENAMENTO = 'armazenamento',
  /** Etapa 16 (Planos e uso) — falha ao chamar a REST API da RevenueCat, webhook com assinatura/header inválido, ou limite de mensagens do plano atingido. Nunca envolve dado de cartão (isso é 100% RevenueCat/lojas, nunca toca este backend). */
  PAGAMENTO = 'pagamento',
  DESCONHECIDO = 'desconhecido',
}
