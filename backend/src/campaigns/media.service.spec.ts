import { AppError } from '../common/errors/app-error';
import { ErrorCategory } from '../common/errors/error-category.enum';
import { MediaService } from './media.service';

/**
 * Testes unitários com Prisma/storage mockados — cobrem as regras de
 * validação por categoria (mimetype + tamanho, causa específica no erro) e a
 * gravação do registro `CampaignMedia` sem `campaignId` ainda (órfão até
 * `CampaignsService.createCampaign` adotar via `mediaIds`).
 */
describe('MediaService', () => {
  function buildService() {
    const txCampaignMedia = {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'media-1',
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      })),
    };
    const prisma = {
      withTenantContext: jest.fn((_userId: string, fn: (tx: { campaignMedia: typeof txCampaignMedia }) => unknown) =>
        fn({ campaignMedia: txCampaignMedia }),
      ),
    };
    const storage = { save: jest.fn(async () => undefined), read: jest.fn(), delete: jest.fn() };

    const service = new MediaService(prisma as never, storage as never);
    return { service, prisma, txCampaignMedia, storage };
  }

  it('rejeita mimetype não aceito para IMAGENS com a causa específica no erro', async () => {
    const { service, storage } = buildService();

    const promise = service.upload('user-1', 'IMAGENS', { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 10 });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ category: ErrorCategory.VALIDACAO });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejeita arquivo acima do limite de tamanho da categoria', async () => {
    const { service, storage } = buildService();
    const oversized = { buffer: Buffer.from('x'), mimetype: 'image/png', size: 17 * 1024 * 1024 };

    await expect(service.upload('user-1', 'IMAGENS', oversized)).rejects.toMatchObject({ category: ErrorCategory.VALIDACAO });
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('aceita qualquer mimetype para DOCUMENTO (catch-all) respeitando só o limite de 100MB', async () => {
    const { service, storage, txCampaignMedia } = buildService();
    const file = { buffer: Buffer.from('conteudo'), mimetype: 'application/x-anything', size: 1024 };

    const dto = await service.upload('user-1', 'DOCUMENTO', file);

    expect(storage.save).toHaveBeenCalledWith(expect.stringContaining('user-1/'), file.buffer, file.mimetype);
    expect(txCampaignMedia.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', type: 'DOCUMENTO', storageKey: expect.stringContaining('user-1/'), mimeType: file.mimetype, sizeBytes: file.size },
    });
    expect(dto).toEqual({ id: 'media-1', mimeType: file.mimetype, sizeBytes: file.size });
  });

  it('aceita AUDIO dentro do limite e do whitelist de mimetypes', async () => {
    const { service, storage } = buildService();
    const file = { buffer: Buffer.from('audio'), mimetype: 'audio/ogg', size: 1024 };

    await expect(service.upload('user-1', 'AUDIO', file)).resolves.toMatchObject({ mimeType: 'audio/ogg' });
    expect(storage.save).toHaveBeenCalled();
  });

  it('propaga o erro do storage sem mascará-lo (categorização real fica no provider — ver MediaStorageError)', async () => {
    const { service, storage, txCampaignMedia } = buildService();
    const storageError = new Error('S3 fora do ar');
    storage.save.mockRejectedValueOnce(storageError);

    await expect(
      service.upload('user-1', 'IMAGENS', { buffer: Buffer.from('x'), mimetype: 'image/png', size: 10 }),
    ).rejects.toBe(storageError);
    expect(txCampaignMedia.create).not.toHaveBeenCalled();
  });
});
