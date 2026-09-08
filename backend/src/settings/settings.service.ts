import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsDto, toAppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';

/**
 * Etapa 17 (Observabilidade avançada — README raiz §17/linha 241). Espelha
 * `MenuRepository.getSettings/updateSettings` (front) sobre a tabela
 * `UserSettings` (ver comentário do model em schema.prisma).
 *
 * A linha em `user_settings` nunca é criada no cadastro (`AuthService`) —
 * `getSettings` cria sob demanda na primeira leitura, com os mesmos
 * defaults do mock (`notificationsEnabled`/`soundEnabled` = true), igual
 * `SessionService.getOrCreateSession`. `updateSettings` faz o mesmo upsert,
 * já com os valores recebidos, pelo mesmo motivo (usuário pode nunca ter
 * lido `GET /settings` antes de dar `PATCH`).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string): Promise<AppSettingsDto> {
    const settings = await this.prisma.withTenantContext(userId, (tx) =>
      tx.userSettings.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }),
    );
    return toAppSettingsDto(settings);
  }

  async updateSettings(userId: string, dto: UpdateAppSettingsDto): Promise<AppSettingsDto> {
    const shared = {
      notificationsEnabled: dto.notificationsEnabled,
      soundEnabled: dto.soundEnabled,
    };
    const settings = await this.prisma.withTenantContext(userId, (tx) =>
      tx.userSettings.upsert({
        where: { userId },
        update: shared,
        create: { userId, ...shared },
      }),
    );
    return toAppSettingsDto(settings);
  }
}
