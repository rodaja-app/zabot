import { Body, Controller, Get, HttpCode, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateRechargeDto, MercadoPagoPublicKeyDto, RechargePackageDto, RechargeResultDto, WalletDto } from './dto/wallet.dto';
import { WalletService } from './wallet.service';

/**
 * Carteira de créditos (substitui o antigo `PlansController`/assinatura
 * mensal). 3 rotas atrás de `JwtAuthGuard` (guard por rota, mesmo padrão de
 * `SettingsController`) + 1 rota pública: o webhook do Mercado Pago não tem
 * como mandar um Bearer token nosso, então a autenticidade da chamada é
 * garantida pela verificação de assinatura (`x-signature`) dentro de
 * `WalletService.handleMercadoPagoWebhook`, não por `JwtAuthGuard`.
 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getWallet(@CurrentUserId() userId: string): Promise<WalletDto> {
    return this.walletService.getWallet(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('packages')
  listPackages(): RechargePackageDto[] {
    return this.walletService.listPackages();
  }

  @UseGuards(JwtAuthGuard)
  @Post('recharge')
  createRecharge(@CurrentUserId() userId: string, @Body() dto: CreateRechargeDto): Promise<RechargeResultDto> {
    return this.walletService.createRecharge(userId, dto);
  }

  /**
   * Chave pública do Mercado Pago para o app tokenizar cartão (`POST
   * /v1/card_tokens` direto na API deles). Não é segredo, mas mesmo assim
   * nunca fica hardcoded no app nem em `.env.example` — só aqui, lida em
   * runtime do `.env` local (ver `MercadoPagoApiService.publicKey`).
   */
  @UseGuards(JwtAuthGuard)
  @Get('mercadopago-public-key')
  getMercadoPagoPublicKey(): MercadoPagoPublicKeyDto {
    return { publicKey: this.walletService.getMercadoPagoPublicKey() };
  }

  /**
   * Rota pública (sem `JwtAuthGuard`, de propósito — ver comentário da
   * classe). `data.id` normalmente vem via query string (`?data.id=...&type=payment`,
   * formato de notificação do Mercado Pago); alguns eventos mandam só no
   * corpo — aceita os dois, priorizando a query. Sempre responde 200 mesmo
   * quando ignora a notificação (ex.: `data.id` ausente) — devolver erro
   * faria o Mercado Pago reentregar o mesmo webhook indefinidamente; só uma
   * assinatura inválida de fato vira erro (`PixPaymentError` → 402), porque
   * aí sim queremos visibilidade de uma tentativa forjada.
   */
  @Post('webhook/mercadopago')
  @HttpCode(200)
  async mercadoPagoWebhook(
    @Query('data.id') dataIdQuery: string | undefined,
    @Body() body: { data?: { id?: string } } | undefined,
    @Headers('x-signature') signatureHeader: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ): Promise<{ received: true }> {
    const dataId = dataIdQuery ?? body?.data?.id;
    await this.walletService.handleMercadoPagoWebhook(dataId, { signatureHeader, requestId, dataId });
    return { received: true };
  }
}
