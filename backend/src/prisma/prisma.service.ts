import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma único da aplicação. Loga eventos de erro/warn do próprio
 * Prisma (query inválida, conexão perdida, etc.) através do Pino central em
 * vez de deixá-los cair no console — mantém a regra de "todo erro tem log
 * estruturado com causa real".
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: Logger) {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // Tipagem do Prisma para `$on` de eventos customizados exige o cast abaixo;
    // é o padrão documentado do próprio Prisma para logs via evento.
    (this as unknown as { $on: (e: string, cb: (arg: unknown) => void) => void }).$on(
      'error',
      (e) => this.logger.error({ event: 'prisma_error', details: e }, 'Erro do Prisma'),
    );
    (this as unknown as { $on: (e: string, cb: (arg: unknown) => void) => void }).$on(
      'warn',
      (e) => this.logger.warn({ event: 'prisma_warn', details: e }, 'Aviso do Prisma'),
    );

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Roda `fn` dentro de uma transação com `app.current_user_id` definido no
   * Postgres via `set_config(..., true)` — o `true` final restringe o escopo
   * à transação atual, então o contexto de um usuário nunca vaza para a
   * próxima query que reaproveitar a mesma conexão do pool. Parametrizado
   * via tagged template do Prisma (nunca interpolação de string) para não
   * abrir brecha de SQL injection no próprio mecanismo que sustenta o RLS.
   *
   * Infra reutilizável desde a etapa 10; passa a ter efeito real a partir da
   * etapa 11, quando as primeiras tabelas com política RLS (sessões,
   * contatos, campanhas etc.) existirem — `User` propositalmente não usa RLS
   * (ver comentário em prisma/schema.prisma).
   */
  async withTenantContext<T>(
    userId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });
  }
}
