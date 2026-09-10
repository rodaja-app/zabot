import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MercadoPagoApiService } from './mercado-pago-api.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Carteira de créditos + recarga Pix via Mercado Pago — substitui por
 * completo o antigo `PlansModule`/assinatura mensal. `CampaignsService`
 * continua acessando `Wallet`/`WalletTransaction` direto via `PrismaService`
 * para o débito (ver comentário em `campaigns.module.ts`) — este módulo cobre
 * só a metade "crédito" (consultar saldo, listar pacotes, criar cobrança
 * Pix, processar o webhook de confirmação de pagamento).
 */
@Module({
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [WalletController],
  providers: [WalletService, MercadoPagoApiService],
  exports: [WalletService],
})
export class WalletModule {}
