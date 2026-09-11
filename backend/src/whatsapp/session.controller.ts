import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConnectSessionDto } from './dto/connect-session.dto';
import { RenameSessionDto } from './dto/rename-session.dto';
import { SessionDto, SessionStatsDto } from './dto/session.dto';
import { SessionService } from './session.service';

/**
 * Rotas mapeadas 1:1 com `ConnectionRepository` do front (README §13):
 * `connect`/`disconnect`/`renameSession`/`getStats` viram POST/PATCH/GET
 * aqui; `statusStream`/`sessionStream`/`statsStream` (tempo real) são
 * servidos pelo gateway WS (tarefa #17), não por polling REST.
 */
@UseGuards(JwtAuthGuard)
@Controller('whatsapp/session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  async getSession(@CurrentUserId() userId: string): Promise<SessionDto> {
    const session = await this.sessionService.getSessionSnapshot(userId);
    return toSessionDto(session);
  }

  @Get('stats')
  getStats(@CurrentUserId() userId: string): Promise<SessionStatsDto> {
    return this.sessionService.getStats(userId);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('connect')
  async connect(@CurrentUserId() userId: string, @Body() dto: ConnectSessionDto): Promise<void> {
    // Assíncrono de propósito (202, não 200/201): QR/pairing code/CONECTADA
    // chegam depois, via evento no gateway WS — este endpoint só dispara o
    // fluxo (mesmo contrato "fire-and-forget" de `ConnectionRepository.connect()`).
    await this.sessionService.connect(userId, dto.phoneNumber);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('disconnect')
  disconnect(@CurrentUserId() userId: string): Promise<void> {
    return this.sessionService.disconnect(userId);
  }

  @Patch('name')
  async rename(@CurrentUserId() userId: string, @Body() dto: RenameSessionDto): Promise<SessionDto> {
    const session = await this.sessionService.rename(userId, dto.name);
    return toSessionDto(session);
  }
}

function toSessionDto(session: {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: SessionDto['status'];
  qr?: string;
  pairingCode?: string;
}): SessionDto {
  return {
    sessionId: session.id,
    name: session.name,
    phoneNumber: session.phoneNumber,
    status: session.status,
    qr: session.qr,
    pairingCode: session.pairingCode,
  };
}
