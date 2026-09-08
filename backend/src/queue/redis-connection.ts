import type { RedisOptions } from 'ioredis';

/**
 * Opções de conexão Redis compartilhadas por todas as filas BullMQ
 * (import, validar-números, enviar-mensagem por sessão, dead-letter) e pelo
 * health check. Único lugar que interpreta `REDIS_URL` — evita cada
 * consumidor reimplementar o parsing e divergir em configuração (ex.: TLS,
 * retry). Tipado como `RedisOptions` (ioredis) em vez do `ConnectionOptions`
 * mais amplo do BullMQ (que também aceita uma instância de `Redis` já
 * conectada) — aqui sempre devolvemos um objeto de opções puro, nunca uma
 * instância, então o tipo mais estrito evita ambiguidade em quem consome.
 */
export function getRedisConnectionOptions(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL não definido — obrigatório para as filas BullMQ.');
  }

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
