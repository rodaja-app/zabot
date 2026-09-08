import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { VerificationCodeService } from './verification-code.service';
import { SessionCryptoService } from './session-crypto.service';

/**
 * Global — hash de senha, geração/validação de código de verificação e
 * criptografia de auth state de sessão são usados pelos módulos Auth e
 * WhatsApp agora e potencialmente por outros pontos no futuro (ex.: troca de
 * senha). Evita reimportar em cada módulo.
 */
@Global()
@Module({
  providers: [PasswordService, VerificationCodeService, SessionCryptoService],
  exports: [PasswordService, VerificationCodeService, SessionCryptoService],
})
export class SecurityModule {}
