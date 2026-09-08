import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MediaStorageError } from '../common/errors/app-error';
import { MediaStorageProvider } from './media-storage-provider.interface';

/**
 * Storage S3-compatível (README raiz §1: "S3 real, Cloudflare R2 ou MinIO se
 * autogerenciado") — os três são compatíveis com a mesma API S3, o que muda
 * é só `S3_ENDPOINT`/`S3_REGION`/`S3_FORCE_PATH_STYLE`:
 *   - AWS S3 real: deixar `S3_ENDPOINT` vazio, `S3_REGION` a região de verdade.
 *   - Cloudflare R2: `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
 *   - MinIO autogerenciado: `S3_ENDPOINT` apontando pro serviço, `S3_FORCE_PATH_STYLE=true`
 *     (MinIO não suporta o estilo virtual-hosted de bucket por subdomínio).
 */
@Injectable()
export class S3MediaStorageProvider implements MediaStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION') || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE') ?? false,
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
    });
  }

  async save(storageKey: string, buffer: Buffer, mimeType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: buffer, ContentType: mimeType }),
      );
    } catch (err) {
      throw new MediaStorageError('Falha ao enviar mídia para o storage S3-compatível', { storageKey, bucket: this.bucket }, err);
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      const bytes = await result.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      throw new MediaStorageError('Falha ao ler mídia do storage S3-compatível', { storageKey, bucket: this.bucket }, err);
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    } catch (err) {
      throw new MediaStorageError('Falha ao remover mídia do storage S3-compatível', { storageKey, bucket: this.bucket }, err);
    }
  }
}
