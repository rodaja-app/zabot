import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RevenueCatWebhookAuthError } from '../common/errors/app-error';
import { CurrentPlanDto } from './dto/current-plan.dto';
import { PaymentHistoryEntryDto } from './dto/payment-history-entry.dto';
import { PlanOptionDto } from './dto/plan-option.dto';
import { PlansService } from './plans.service';
import { RevenueCatWebhookPayload, RevenueCatWebhookService } from './revenuecat-webhook.service';

/**
 * 4 primeiras rotas mapeiam 1:1 com `MenuRepository` do front (plano/uso —
 * README §13/16), cada uma atrás de `JwtAuthGuard` individualmente (não a
 * nível de controller, como em `CampaignsController`) justamente para deixar
 * `POST /plans/webhook/revenuecat` pública — ela é chamada pela RevenueCat,
 * não pelo app, e autenticada por header/HMAC, nunca por JWT (ver
 * `RevenueCatWebhookService.verifyRequest`).
 *
 * Divergência deliberada do mock (`MockMenuRepository.changePlan`, ver
 * README raiz "Etapa 16"): NÃO existe uma rota "trocar plano" aqui. A troca
 * de plano de verdade só acontece via compra nativa pelo SDK da RevenueCat
 * dentro do app (App Store/Play Store não permitem outro caminho para
 * desbloquear função paga em app nativo — Guideline 3.1.1 da Apple / Google
 * Play Billing policy); este backend só reflete esse estado, via webhook
 * (assíncrono) ou `POST /plans/sync` (síncrono, chamado pelo app logo depois
 * da compra completar, sem esperar o webhook).
 */
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly webhookService: RevenueCatWebhookService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('current')
  getCurrentPlan(@CurrentUserId() userId: string): Promise<CurrentPlanDto> {
    return this.plansService.getCurrentPlan(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('available')
  getAvailablePlans(@CurrentUserId() userId: string): Promise<PlanOptionDto[]> {
    return this.plansService.getAvailablePlans(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payment-history')
  getPaymentHistory(@CurrentUserId() userId: string): Promise<PaymentHistoryEntryDto[]> {
    return this.plansService.getPaymentHistory(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  syncPlan(@CurrentUserId() userId: string): Promise<CurrentPlanDto> {
    return this.plansService.syncFromRevenueCat(userId);
  }

  /**
   * `rawBody` vem do `rawBody: true` habilitado em `main.ts` — exigido aqui
   * (nunca reserializa `body` como fallback) porque a verificação HMAC
   * precisa dos bytes EXATOS recebidos; reserializar poderia produzir bytes
   * diferentes dos originais e invalidar uma assinatura legítima, ou pior,
   * mascarar silenciosamente uma verificação que não está rodando de
   * verdade.
   *
   * Rota pública (sem JwtAuthGuard) — limite próprio, mais generoso que o de
   * auth (é chamada pela RevenueCat, não por um usuário final, mas ainda
   * assim vale limitar para não virar alvo fácil de flood).
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('webhook/revenuecat')
  async handleRevenueCatWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: RevenueCatWebhookPayload,
  ): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new RevenueCatWebhookAuthError('rawBody indisponível — confirme que "rawBody: true" está habilitado em main.ts.');
    }

    this.webhookService.verifyRequest(request.rawBody, {
      authorization: request.headers.authorization,
      'x-revenuecat-webhook-signature': request.headers['x-revenuecat-webhook-signature'] as string | undefined,
    });

    await this.webhookService.processEvent(body);
    return { received: true };
  }
}
