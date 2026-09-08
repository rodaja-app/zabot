import { SettingsService } from './settings.service';

/**
 * `getSettings`/`updateSettings` são o MESMO upsert por baixo (ver
 * comentário do serviço) — os testes cobrem os dois casos de cada um: linha
 * já existe (update) e primeiro acesso (create com defaults).
 */
describe('SettingsService', () => {
  function buildService() {
    const txUserSettings = {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'settings-1',
        userId: 'user-1',
        notificationsEnabled: true,
        soundEnabled: true,
        ...create,
      })),
    };
    const tx = { userSettings: txUserSettings };
    const prisma = { withTenantContext: jest.fn((_userId: string, fn: (tx: unknown) => unknown) => fn(tx)) };

    const service = new SettingsService(prisma as never);
    return { service, txUserSettings };
  }

  describe('getSettings', () => {
    it('faz upsert vazio (update: {}) e mapeia o resultado para AppSettingsDto', async () => {
      const { service, txUserSettings } = buildService();

      const result = await service.getSettings('user-1');

      expect(txUserSettings.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: {},
        create: { userId: 'user-1' },
      });
      expect(result).toEqual({ notificationsEnabled: true, soundEnabled: true });
    });
  });

  describe('updateSettings', () => {
    it('faz upsert com os valores recebidos tanto em update quanto em create', async () => {
      const { service, txUserSettings } = buildService();
      txUserSettings.upsert.mockResolvedValueOnce({
        id: 'settings-1',
        userId: 'user-1',
        notificationsEnabled: false,
        soundEnabled: false,
      });

      const result = await service.updateSettings('user-1', { notificationsEnabled: false, soundEnabled: false });

      expect(txUserSettings.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { notificationsEnabled: false, soundEnabled: false },
        create: { userId: 'user-1', notificationsEnabled: false, soundEnabled: false },
      });
      expect(result).toEqual({ notificationsEnabled: false, soundEnabled: false });
    });
  });
});
