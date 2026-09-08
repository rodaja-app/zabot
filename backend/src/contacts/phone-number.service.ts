import { Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * DDDs onde a Anatel exige o 9º dígito para celular (README raiz §5) — os
 * demais DDDs ainda aceitam celular com 8 dígitos (sem o 9). Tabela fixa
 * porque `libphonenumber-js` (lib genérica, não especializada em BR) não
 * cobre esta regra local — é exatamente a "tabela de regras específica para
 * o nono dígito do Brasil" que o README pede.
 */
const DDDS_COM_NONO_DIGITO_OBRIGATORIO = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '24', '27', '28',
]);

/** README raiz §5 passo 2: no máximo N variações testadas por contato — evita sobrecarregar a verificação/o WhatsApp com tentativas infinitas. */
export const DEFAULT_MAX_CANDIDATES = 3;

/**
 * Etapa 13 — motor de canonicalização e geração de candidatos de número
 * (README raiz §5, passos 1 e 2). Lógica pura, sem I/O — a verificação de
 * fato contra o WhatsApp (passo 3, `WhatsAppProvider.checkNumbers`) e o
 * cache do resultado (passo 4) ficam em `ContactsService`/no processor da
 * fila `queue:validate-numbers`, não aqui.
 *
 * Deliberadamente NÃO tenta "corrigir" um DDD para outro: um número com DDD
 * plausível mas talvez desatualizado é candidato a falha categorizada
 * (`numero_invalido`/`nao_encontrado_whatsapp`), nunca a um chute de DDD
 * diferente — enviar para o número errado é pior que marcar como inválido.
 */
@Injectable()
export class PhoneNumberService {
  /** Remove tudo que não for dígito (espaços, hífens, parênteses, pontos, "+") — README §5 passo 1. */
  clean(rawPhone: string): string {
    return rawPhone.replace(/\D/g, '');
  }

  /** Validação estrutural via libphonenumber-js (é um número plausível — não diz se existe no WhatsApp). */
  isStructurallyValid(rawPhone: string): boolean {
    const cleaned = this.clean(rawPhone);
    if (!cleaned) return false;
    const parsed = parsePhoneNumberFromString(`+${cleaned.startsWith('55') ? cleaned : `55${cleaned}`}`, 'BR');
    return parsed?.isValid() ?? false;
  }

  /**
   * Gera candidatos de número nacional (DDI 55 + DDD + assinante, só
   * dígitos — pronto para virar JID via `toJid()`) em ordem de
   * probabilidade, já removendo DDI/zero-de-tronco redundantes do input
   * (README §5 passo 2). Retorna `[]` quando o número não tem estrutura
   * mínima de um telefone brasileiro (não inventa candidato do nada).
   */
  generateCandidates(rawPhone: string, maxCandidates = DEFAULT_MAX_CANDIDATES): string[] {
    const digitsOnly = this.clean(rawPhone);
    if (!digitsOnly) return [];

    let national = digitsOnly;
    if (national.startsWith('55') && national.length > 11) {
      national = national.slice(2); // DDI já presente no input — normaliza para só DDD+assinante
    }
    if (national.startsWith('0') && national.length > 10) {
      national = national.slice(1); // zero de tronco indevido antes do DDD
    }

    if (national.length < 10 || national.length > 11) {
      return []; // nem "DDD + 8 dígitos" nem "DDD + 9 dígitos" — não é um número BR plausível
    }

    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);
    const requiresNinth = DDDS_COM_NONO_DIGITO_OBRIGATORIO.has(ddd);

    const subscriberVariants: string[] = [];
    if (subscriber.length === 9 && subscriber.startsWith('9')) {
      subscriberVariants.push(subscriber, subscriber.slice(1));
    } else if (subscriber.length === 8) {
      subscriberVariants.push(requiresNinth ? `9${subscriber}` : subscriber);
      subscriberVariants.push(requiresNinth ? subscriber : `9${subscriber}`);
    } else {
      subscriberVariants.push(subscriber);
    }

    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const variant of subscriberVariants) {
      const candidate = `55${ddd}${variant}`;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push(candidate);
      if (candidates.length >= maxCandidates) break;
    }

    return candidates;
  }

  /** JID no formato que o Baileys/WhatsApp espera (README §5 — `{ddi}{numero}@s.whatsapp.net`, só dígitos antes do @). */
  toJid(candidateDigits: string): string {
    return `${candidateDigits}@s.whatsapp.net`;
  }

  /** Extrai de volta os dígitos de um JID do WhatsApp (`onWhatsApp` devolve o jid, não o número puro). */
  fromJid(jid: string): string {
    return jid.split('@')[0].split(':')[0];
  }
}
