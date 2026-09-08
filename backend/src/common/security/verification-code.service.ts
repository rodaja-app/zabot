import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';

export interface GeneratedVerificationCode {
  /** Código em texto puro — só existe em memória, nunca é persistido. */
  code: string;
  /** sha256 do código — o que de fato vai para o banco. */
  hash: string;
}

/**
 * Códigos de verificação (6 dígitos, e-mail de cadastro) usam sha256 em vez
 * de argon2: são de baixa entropia (10^6 combinações) e curta duração (ver
 * `ttlMinutes`), então o custo computacional do argon2 não compra proteção
 * real aqui — o que protege de fato é `maxAttempts` + expiração, aplicados
 * pelo chamador (AuthService). sha256 simples é a escolha mais robusta
 * *para este caso específico* com o mínimo de código.
 */
@Injectable()
export class VerificationCodeService {
  readonly ttlMinutes = 15;
  readonly maxAttempts = 5;

  generate(): GeneratedVerificationCode {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    return { code, hash: this.hash(code) };
  }

  hash(code: string): string {
    return createHash('sha256').update(code.trim()).digest('hex');
  }
}
