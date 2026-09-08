import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { getRedisConnectionOptions } from '../queue/redis-connection';

export interface CheckResult {
  status: 'up' | 'down';
  message?: string;
}

export interface HealthSnapshot {
  database: CheckResult;
  redis: CheckResult;
  healthy: boolean;
}

/**
 * Extraído de `HealthController` (etapa 9) na etapa 17 para que
 * `AppInfoService.getAppInfo()` (README raiz §13/17 — "configurações e info
 * do app") possa derivar `serviceStatus` (`AppInfo.serviceStatus` do front,
 * lib/data/models/app_info.dart) exatamente dos mesmos checks reais de
 * Postgres/Redis usados pelo `/health` do Railway, em vez de duplicar a
 * lógica ou inventar um terceiro sinal de saúde.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthSnapshot> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return { database, redis, healthy: database.status === 'up' && redis.status === 'up' };
  }

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', message: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    const client = new Redis({
      ...getRedisConnectionOptions(),
      lazyConnect: true,
      connectTimeout: 3000,
    });
    try {
      await client.connect();
      await client.ping();
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', message: (err as Error).message };
    } finally {
      client.disconnect();
    }
  }
}
