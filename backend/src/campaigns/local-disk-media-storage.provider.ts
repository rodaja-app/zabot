import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MediaStorageError } from '../common/errors/app-error';
import { MediaStorageProvider } from './media-storage-provider.interface';

/**
 * Fallback de storage de mídia quando nenhum S3-compatível está configurado
 * (sem `S3_BUCKET` no ambiente — ver env.validation.ts), mesmo padrão de
 * fallback já usado por `LogEmailProvider` (sem SMTP_HOST) e
 * `BaileysWhatsAppProvider` (sem DATAIMPULSE_HOST): dev local funciona sem
 * nenhuma conta de object storage.
 *
 * ATENÇÃO — nunca usar em produção no Railway: o filesystem do Railway não é
 * persistente entre deploys/restarts, então mídia gravada aqui é perdida a
 * qualquer redeploy. Configurar `S3_BUCKET` (+ credenciais) é obrigatório
 * antes de subir para staging/produção — ver backend/README.md "Etapa 14".
 */
@Injectable()
export class LocalDiskMediaStorageProvider implements MediaStorageProvider {
  private readonly baseDir: string;

  constructor(private readonly config: ConfigService) {
    this.baseDir = this.config.get<string>('MEDIA_LOCAL_DIR') || path.join(process.cwd(), 'data', 'media');
  }

  async save(storageKey: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = this.resolve(storageKey);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
    } catch (err) {
      throw new MediaStorageError(
        'Falha ao gravar mídia no disco local — verifique permissão/espaço em MEDIA_LOCAL_DIR',
        { storageKey, baseDir: this.baseDir },
        err,
      );
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(storageKey));
    } catch (err) {
      throw new MediaStorageError('Falha ao ler mídia do disco local — arquivo ausente ou sem permissão de leitura', { storageKey }, err);
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(storageKey));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // já não existe — mesmo comportamento idempotente do S3 DeleteObject
      throw new MediaStorageError('Falha ao remover mídia do disco local', { storageKey }, err);
    }
  }

  /** Impede path traversal (ex.: storageKey contendo "../") — `storageKey` só deveria vir de valores gerados por este próprio serviço, mas validar é mais barato que confiar. */
  private resolve(storageKey: string): string {
    const resolved = path.resolve(this.baseDir, storageKey);
    if (!resolved.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new MediaStorageError('storageKey inválido — fora do diretório de mídia', { storageKey });
    }
    return resolved;
  }
}
