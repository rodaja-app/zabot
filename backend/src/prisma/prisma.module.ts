import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global para não precisar importar em cada módulo de feature — todo
 * módulo que precisar de acesso a banco injeta `PrismaService` direto.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
