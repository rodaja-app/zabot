import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUserId } from './current-user-id.decorator';
import { AccountDto } from './dto/account.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Rotas mapeadas 1:1 com `lib/data/auth_repository.dart` (contrato do
 * front, imutável — ver README seção 13). Limites de `@Throttle` mais
 * apertados que o padrão global (ver app.module.ts) nas rotas sensíveis,
 * conforme README seção 9 ("rate limiting nas rotas de autenticação").
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<void> {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-code')
  resendCode(@Body() dto: ResendCodeDto): Promise<void> {
    return this.authService.resendCode(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('confirm-code')
  confirmCode(@Body() dto: ConfirmCodeDto): Promise<AuthTokensDto> {
    return this.authService.confirmCode(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthTokensDto> {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Get('me')
  getAccount(@CurrentUserId() userId: string): Promise<AccountDto> {
    return this.authService.getAccount(userId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('account')
  deleteAccount(@CurrentUserId() userId: string): Promise<void> {
    return this.authService.deleteAccount(userId);
  }
}
