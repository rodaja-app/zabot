import { version as packageVersion } from '../../package.json';
import { AppInfoService } from './app-info.service';
import { ServiceStatus } from './dto/app-info.dto';

/**
 * `serviceStatus` deriva dos MESMOS 2 checks de `HealthService.check()`
 * (nunca reimplementados aqui) — os 3 casos possíveis (0/1/2 checks "down")
 * mapeiam 1:1 para OPERACIONAL/DEGRADADO/FORA_DO_AR (ver comentário do
 * serviço). `version` cai no `APP_VERSION` do env se setado, senão no
 * `version` de package.json.
 */
describe('AppInfoService', () => {
  function buildService(env: Record<string, string> = {}) {
    const health = {
      check: jest.fn(async () => ({
        database: { status: 'up' as const },
        redis: { status: 'up' as const },
        healthy: true,
      })),
    };
    const config = { get: jest.fn((key: string) => env[key]) };

    const service = new AppInfoService(health as never, config as never);
    return { service, health, config };
  }

  it('OPERACIONAL quando database e redis estão up', async () => {
    const { service } = buildService();

    const result = await service.getAppInfo();

    expect(result.serviceStatus).toBe(ServiceStatus.OPERACIONAL);
  });

  it('DEGRADADO quando exatamente um dos dois está down', async () => {
    const { service, health } = buildService();
    health.check.mockResolvedValueOnce({
      database: { status: 'down', message: 'timeout' },
      redis: { status: 'up' },
      healthy: false,
    });

    const result = await service.getAppInfo();

    expect(result.serviceStatus).toBe(ServiceStatus.DEGRADADO);
  });

  it('FORA_DO_AR quando os dois estão down', async () => {
    const { service, health } = buildService();
    health.check.mockResolvedValueOnce({
      database: { status: 'down', message: 'timeout' },
      redis: { status: 'down', message: 'timeout' },
      healthy: false,
    });

    const result = await service.getAppInfo();

    expect(result.serviceStatus).toBe(ServiceStatus.FORA_DO_AR);
  });

  it('usa o version de package.json quando APP_VERSION não está setado', async () => {
    const { service } = buildService();

    const result = await service.getAppInfo();

    expect(result.version).toBe(packageVersion);
  });

  it('usa APP_VERSION do env quando setado, sobrescrevendo package.json', async () => {
    const { service } = buildService({ APP_VERSION: '9.9.9-hotfix' });

    const result = await service.getAppInfo();

    expect(result.version).toBe('9.9.9-hotfix');
  });
});
