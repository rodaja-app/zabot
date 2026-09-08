import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppInfoService } from './app-info.service';
import { AppInfoDto } from './dto/app-info.dto';
import { AppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';
import { SettingsService } from './settings.service';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §17/linha 241). Espelha
 * `MenuRepository.getSettings/updateSettings/getAppInfo` (front) — 3 rotas,
 * todas atrás de `JwtAuthGuard` (mesmo padrão de `PlansController`: guard
 * por rota, não por controller, já que aqui não há nenhuma rota pública).
 */
@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly appInfoService: AppInfoService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('settings')
  getSettings(@CurrentUserId() userId: string): Promise<AppSettingsDto> {
    return this.settingsService.getSettings(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  updateSettings(@CurrentUserId() userId: string, @Body() dto: UpdateAppSettingsDto): Promise<AppSettingsDto> {
    return this.settingsService.updateSettings(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('app-info')
  getAppInfo(): Promise<AppInfoDto> {
    return this.appInfoService.getAppInfo();
  }
}
