import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Único ponto de hash/verificação de senha da API. argon2id (não bcrypt):
 * vencedor da Password Hashing Competition, resistente a ataque por
 * hardware dedicado (GPU/ASIC) — a escolha mais robusta entre as duas
 * opções citadas no README ("argon2/bcrypt"), sem custo de código extra
 * (a lib já expõe hash/verify prontos, com salt e parâmetros embutidos no
 * próprio hash de saída — nada para o resto do app gerenciar).
 */
@Injectable()
export class PasswordService {
  hash(plainTextPassword: string): Promise<string> {
    return argon2.hash(plainTextPassword, { type: argon2.argon2id });
  }

  async verify(hash: string, plainTextPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainTextPassword);
    } catch {
      // Hash corrompido/formato inesperado — trata como "não bateu" em vez
      // de deixar a exceção do argon2 vazar para fora do fluxo de login.
      return false;
    }
  }
}
