import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Offset fixo (horas em relação ao UTC) por DDD — Brasil não tem mais
 * horário de verão desde 2019 (Decreto 9.958/2019), então um offset
 * constante por DDD é suficiente, sem precisar de uma lib de fuso horário
 * completa (IANA tzdata) só para isto.
 *
 * Duas aproximações deliberadas, documentadas em vez de "resolvidas" com
 * código a mais sem dado suficiente para decidir certo (mesmo espírito de
 * `PhoneNumberService`: nunca inventar uma correção sem base):
 *  - DDD 81 (Pernambuco) também cobre Fernando de Noronha (UTC-2, ilha
 *    oceânica) — sem outro dado além do DDD não dá para diferenciar, então
 *    fica no offset do estado (UTC-3). Volume de contatos afetado é
 *    desprezível (poucos milhares de habitantes na ilha).
 *  - DDD 97 (interior do Amazonas) também cobre o extremo oeste do estado
 *    (UTC-5) — a maioria da população do DDD está no offset do estado
 *    (UTC-4), que é o valor usado aqui.
 *
 * DDDs fora desta tabela (a maior parte do país) usam o padrão UTC-3
 * ("horário de Brasília").
 */
const DDD_UTC_OFFSET: Record<string, number> = {
  '68': -5, // Acre
  '69': -4, // Rondônia
  '92': -4, // Amazonas (Manaus)
  '97': -4, // Amazonas (interior — aproximação, ver comentário acima)
  '95': -4, // Roraima
  '65': -4, // Mato Grosso
  '66': -4, // Mato Grosso
  '67': -4, // Mato Grosso do Sul
};

const DEFAULT_UTC_OFFSET = -3;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Etapa 15 (README raiz §15 — "horário de envio conforme fuso do contato").
 * Deriva o fuso a partir do DDD do número já normalizado (`Contact.normalizedPhone`,
 * formato `55DDD...` — mesma saída de `PhoneNumberService.generateCandidates`),
 * sem depender de nenhum campo novo no schema (Contact não tem timezone
 * persistido — é sempre recalculado a partir do número).
 */
@Injectable()
export class TimezoneService {
  private readonly windowStartHour: number;
  private readonly windowEndHour: number;

  constructor(config: ConfigService) {
    this.windowStartHour = config.get<number>('SEND_WINDOW_START_HOUR') ?? 8;
    this.windowEndHour = config.get<number>('SEND_WINDOW_END_HOUR') ?? 20;
  }

  /** Offset UTC (em horas, ex.: -3) a partir do DDD extraído de `55DDDassinante`. `undefined`/formato inesperado cai no padrão UTC-3. */
  offsetFor(normalizedPhone: string | null | undefined): number {
    const ddd = normalizedPhone?.slice(2, 4);
    return (ddd && DDD_UTC_OFFSET[ddd]) ?? DEFAULT_UTC_OFFSET;
  }

  /** true se `now` (instante UTC) cai dentro de [SEND_WINDOW_START_HOUR, SEND_WINDOW_END_HOUR) no horário local do contato. */
  isWithinSendingWindow(normalizedPhone: string | null | undefined, now: Date): boolean {
    const localHour = this.localHour(normalizedPhone, now);
    return localHour >= this.windowStartHour && localHour < this.windowEndHour;
  }

  /** Quantos ms faltam, a partir de `now`, até o próximo início de janela no horário local do contato (0 se já está dentro da janela agora). */
  msUntilNextWindow(normalizedPhone: string | null | undefined, now: Date): number {
    if (this.isWithinSendingWindow(normalizedPhone, now)) return 0;

    const offset = this.offsetFor(normalizedPhone);
    const localNow = new Date(now.getTime() + offset * HOUR_MS);
    const nextWindowLocal = new Date(
      Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), this.windowStartHour, 0, 0, 0),
    );
    // Se já passou do início da janela hoje (estamos depois do fim, ex.: 21h
    // com janela 8-20h), o próximo início é amanhã.
    if (localNow.getUTCHours() >= this.windowEndHour) {
      nextWindowLocal.setUTCDate(nextWindowLocal.getUTCDate() + 1);
    }

    const nextWindowUtc = nextWindowLocal.getTime() - offset * HOUR_MS;
    return Math.max(0, nextWindowUtc - now.getTime());
  }

  private localHour(normalizedPhone: string | null | undefined, now: Date): number {
    const offset = this.offsetFor(normalizedPhone);
    const localMs = now.getTime() + offset * HOUR_MS;
    return new Date(localMs).getUTCHours();
  }
}
