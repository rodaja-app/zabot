import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Único ponto de criptografia em repouso do auth state das sessões
 * WhatsApp (`session_auth_keys` — ver comentário do model em
 * schema.prisma). AES-256-GCM: cifra autenticada (o `authTag` detecta
 * qualquer adulteração/corrupção do ciphertext na hora de decifrar, em vez
 * de silenciosamente devolver lixo para o Baileys), padrão da indústria e
 * nativo do módulo `crypto` do Node — sem dependência extra para algo tão
 * sensível quanto "a credencial de login do WhatsApp da pessoa".
 *
 * `SESSION_ENCRYPTION_KEY` é validada no boot (env.validation.ts) como hex
 * de 32 bytes — falha rápido e com causa clara se estiver ausente/mal
 * formada, em vez de quebrar na primeira tentativa de conexão de sessão.
 */
@Injectable()
export class SessionCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('SESSION_ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: Buffer): EncryptedPayload {
    const iv = randomBytes(12); // 96 bits — tamanho recomendado para GCM
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
  }

  decrypt(payload: EncryptedPayload): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.iv);
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  }
}
