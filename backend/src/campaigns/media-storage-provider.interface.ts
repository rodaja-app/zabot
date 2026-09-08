export const MEDIA_STORAGE_PROVIDER = Symbol('MEDIA_STORAGE_PROVIDER');

/**
 * Abstração de storage de mídia de campanha (README raiz §1 — "Object
 * storage compatível com S3: S3 real, Cloudflare R2 ou MinIO se
 * autogerenciado"). Mesmo padrão arquitetural do `EmailProvider`/
 * `WhatsAppProvider`: `MediaService` nunca fala com `@aws-sdk/client-s3` ou
 * `fs` diretamente, só com esta interface — trocar de provider (ou rodar sem
 * nenhum configurado, caindo no disco local em dev) é só escolher a
 * implementação em `campaigns.module.ts`, sem tocar no resto do módulo.
 *
 * `storageKey` é opaco para quem chama (nunca uma URL) — cada implementação
 * decide seu próprio formato (chave de objeto S3, caminho relativo em
 * disco), e é o único dado que `CampaignMedia.storageKey` persiste.
 */
export interface MediaStorageProvider {
  save(storageKey: string, buffer: Buffer, mimeType: string): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
