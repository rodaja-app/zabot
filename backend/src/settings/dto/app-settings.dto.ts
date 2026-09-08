import { UserSettings } from '@prisma/client';
import { IsBoolean } from 'class-validator';

/** Espelha `AppSettings` do front (lib/data/models/app_settings.dart). */
export interface AppSettingsDto {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

export function toAppSettingsDto(settings: UserSettings): AppSettingsDto {
  return {
    notificationsEnabled: settings.notificationsEnabled,
    soundEnabled: settings.soundEnabled,
  };
}

/**
 * `PATCH /settings` espelha `MenuRepository.updateSettings(AppSettings)` —
 * recebe sempre o objeto inteiro (mesmo contrato do construtor de
 * `AppSettings` no front, que exige os dois campos), nunca um patch parcial.
 */
export class UpdateAppSettingsDto {
  @IsBoolean()
  notificationsEnabled!: boolean;

  @IsBoolean()
  soundEnabled!: boolean;
}
