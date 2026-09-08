import { RevenueCatApiError } from '../common/errors/app-error';
import { RevenueCatApiService, RevenueCatSubscriberResponse } from './revenuecat-api.service';

/**
 * Testes unitários com `fetch` global mockado — cobrem os 3 caminhos de erro
 * documentados no service (chave ausente, falha de rede, status HTTP não-ok)
 * e o caminho feliz (parse do JSON de resposta), sem bater na RevenueCat de
 * verdade. Segue a convenção do repo: sem `@nestjs/testing`, `new Service(...)`
 * direto, `ConfigService` mockado como `{ get: jest.fn((key) => env[key]) }`.
 */
describe('RevenueCatApiService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function buildService(env: Record<string, string | undefined>) {
    const config = { get: jest.fn((key: string) => env[key]) };
    const service = new RevenueCatApiService(config as never);
    return { service, config };
  }

  it('lança RevenueCatApiError sem chamar fetch quando REVENUECAT_SECRET_API_KEY não está configurada', async () => {
    const { service } = buildService({});
    global.fetch = jest.fn() as never;

    await expect(service.getSubscriber('user-1')).rejects.toBeInstanceOf(RevenueCatApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lança RevenueCatApiError em falha de rede (fetch rejeita)', async () => {
    const { service } = buildService({ REVENUECAT_SECRET_API_KEY: 'sk_test' });
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    await expect(service.getSubscriber('user-1')).rejects.toBeInstanceOf(RevenueCatApiError);
  });

  it('lança RevenueCatApiError quando a resposta não é ok', async () => {
    const { service } = buildService({ REVENUECAT_SECRET_API_KEY: 'sk_test' });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'not found',
    })) as never;

    await expect(service.getSubscriber('user-1')).rejects.toBeInstanceOf(RevenueCatApiError);
  });

  it('monta a URL com o app_user_id codificado, envia Bearer e retorna o JSON parseado', async () => {
    const { service } = buildService({ REVENUECAT_SECRET_API_KEY: 'sk_test' });
    const payload: RevenueCatSubscriberResponse = {
      request_date: '2026-01-01T00:00:00Z',
      request_date_ms: 1,
      subscriber: {
        original_app_user_id: 'user@1',
        first_seen: '2026-01-01T00:00:00Z',
        last_seen: '2026-01-01T00:00:00Z',
        management_url: null,
        original_application_version: null,
        original_purchase_date: null,
        subscriptions: {},
        entitlements: {},
        non_subscriptions: {},
      },
    };
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }));
    global.fetch = fetchMock as never;

    const result = await service.getSubscriber('user@1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v1/subscribers/user%401',
      { method: 'GET', headers: { Authorization: 'Bearer sk_test' } },
    );
    expect(result).toEqual(payload);
  });
});
