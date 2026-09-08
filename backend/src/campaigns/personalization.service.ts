import { Injectable } from '@nestjs/common';

/** Casa `{ID1}`, `{ID2}`, `{ID10}`... — mesma sintaxe que o front insere no texto (ver `nova_campanha_screen.dart`, `ActionChip` de personalização). */
const TOKEN_PATTERN = /\{(ID\d+)\}/g;

/**
 * Etapa 14 (README raiz §5/6/13 — "Personalização: substituição de ID1,
 * ID2, ... pelos dados do contato"). Função pura, sem I/O — o worker de
 * envio (etapa 15) chama `render()` uma vez por (destinatário × mensagem)
 * antes de enviar via `WhatsAppProvider`.
 *
 * Dois cuidados deliberados:
 *  - Token sem correspondência em `customFields` (contato sem aquele campo
 *    preenchido) permanece como texto literal (`{ID2}`) em vez de virar
 *    string vazia — apagar silenciosamente esconderia um erro de
 *    preenchimento da planilha de importação; deixar visível é mais fácil
 *    de notar e corrigir.
 *  - Marcações de formatação do WhatsApp (`*negrito*`, `_itálico_`,
 *    `~tachado~`) já vêm embutidas no mesmo texto pelo front
 *    (`_wrapSelection()`) — este serviço nunca as interpreta nem escapa,
 *    só substitui os tokens `{IDn}` e devolve o resto do texto intacto.
 */
@Injectable()
export class PersonalizationService {
  render(template: string, customFields: Record<string, string>): string {
    return template.replace(TOKEN_PATTERN, (match, key: string) => {
      const value = customFields[key];
      return value !== undefined && value !== '' ? value : match;
    });
  }
}
