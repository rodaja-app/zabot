/**
 * Espelha os 3 valores de `AppStatus` que `AppInfo.serviceStatus`
 * (lib/data/models/app_info.dart) reaproveita — o próprio comentário do
 * front já define os nomes em português usados aqui: "`connected` =
 * operacional, `pending` = degradado, `failed` = fora do ar". Mesma
 * convenção do resto do backend (`SessionStatus`, `SubscriptionStatus`):
 * enum em português no DTO, o mapeamento para `AppStatus.connected/pending/failed`
 * fica na camada de integração (etapa 18).
 */
export enum ServiceStatus {
  OPERACIONAL = 'OPERACIONAL',
  DEGRADADO = 'DEGRADADO',
  FORA_DO_AR = 'FORA_DO_AR',
}

/** Espelha `AppInfo` do front (lib/data/models/app_info.dart). */
export interface AppInfoDto {
  version: string;
  serviceStatus: ServiceStatus;
}
