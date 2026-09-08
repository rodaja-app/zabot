import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Etapa 15 (README raiz §15 — "delay humano/jitter" + "rampa de aquecimento
 * para sessão nova"). Um único mecanismo resolve as duas exigências ao
 * mesmo tempo: o worker de envio (`SendMessageWorker`) roda com concorrência
 * 1 por sessão, e antes de cada envio espera um delay sorteado dentro dos
 * bounds abaixo — isso já É o rate limit (throughput = 1 / delay médio) e o
 * jitter (nunca o mesmo intervalo duas vezes), sem precisar de um limiter
 * BullMQ separado por cima.
 *
 * A "idade" da sessão é `Session.createdAt` (criada uma única vez, no
 * primeiro acesso — ver `SessionService.getOrCreateSession`): serve como
 * proxy de "há quanto tempo este número está registrado no app", que é o
 * que a rampa de aquecimento do WhatsApp de fato quer proteger (número novo
 * enviando em volume alto desde o primeiro dia é o padrão que gera ban).
 */
@Injectable()
export class AntiBanService {
  private readonly warmupDays: number;
  private readonly warmupMinDelayMs: number;
  private readonly warmupMaxDelayMs: number;
  private readonly matureMinDelayMs: number;
  private readonly matureMaxDelayMs: number;

  constructor(config: ConfigService) {
    this.warmupDays = config.get<number>('SEND_WARMUP_DAYS') ?? 3;
    this.warmupMinDelayMs = config.get<number>('SEND_WARMUP_MIN_DELAY_MS') ?? 20_000;
    this.warmupMaxDelayMs = config.get<number>('SEND_WARMUP_MAX_DELAY_MS') ?? 45_000;
    this.matureMinDelayMs = config.get<number>('SEND_MATURE_MIN_DELAY_MS') ?? 4_000;
    this.matureMaxDelayMs = config.get<number>('SEND_MATURE_MAX_DELAY_MS') ?? 12_000;
  }

  /** Delay (ms) sorteado uniformemente dentro do bound apropriado para a idade da sessão em `now`. */
  computeDelayMs(sessionCreatedAt: Date, now: Date = new Date()): number {
    const ageDays = (now.getTime() - sessionCreatedAt.getTime()) / DAY_MS;
    const [min, max] =
      ageDays < this.warmupDays
        ? [this.warmupMinDelayMs, this.warmupMaxDelayMs]
        : [this.matureMinDelayMs, this.matureMaxDelayMs];

    return Math.round(min + Math.random() * Math.max(0, max - min));
  }
}
