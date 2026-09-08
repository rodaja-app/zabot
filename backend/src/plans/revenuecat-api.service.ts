import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RevenueCatApiError } from '../common/errors/app-error';

/**
 * Subconjunto do "Customer Info Model" que a RevenueCat devolve em
 * `GET /subscribers/{app_user_id}` — só os campos que este backend
 * efetivamente usa (ver README raiz "Etapa 16" e a doc oficial:
 * https://www.revenuecat.com/docs/api-v1#tag/customers/operation/get-subscriber).
 * `subscriptions` vem indexado por `product_id`; como cada `Plan.revenueCatProductId`
 * é único e cada usuário só pode ter 1 produto ativo por vez neste catálogo,
 * `PlansService.syncFromRevenueCat` escolhe a assinatura com o
 * `expires_date` mais distante no futuro (ou sem `expires_date` — vitalícia)
 * entre as presentes, em vez de assumir que só existe uma entrada.
 */
export interface RevenueCatSubscriptionInfo {
  expires_date: string | null;
  purchase_date: string;
  original_purchase_date: string;
  period_type: 'trial' | 'intro' | 'normal' | 'promotional' | 'prepaid';
  store: string;
  is_sandbox: boolean;
  unsubscribe_detected_at: string | null;
  billing_issues_detected_at: string | null;
  auto_resume_date: string | null;
  ownership_type: string;
  refunded_at: string | null;
  store_transaction_id: string;
}

export interface RevenueCatSubscriberResponse {
  request_date: string;
  request_date_ms: number;
  subscriber: {
    original_app_user_id: string;
    first_seen: string;
    last_seen: string;
    management_url: string | null;
    original_application_version: string | null;
    original_purchase_date: string | null;
    subscriptions: Record<string, RevenueCatSubscriptionInfo>;
    entitlements: Record<string, unknown>;
    non_subscriptions: Record<string, unknown>;
    subscriber_attributes?: Record<string, unknown>;
  };
}

/**
 * Cliente REST da RevenueCat (API v1 — https://api.revenuecat.com/v1).
 * Único ponto do backend que fala com a RevenueCat via HTTP (o resto da
 * integração é passiva: recebe webhook). Usa o `fetch` global do Node
 * (disponível desde o Node 18, `@types/node ^20` já tipa) em vez de trazer
 * `axios`/`@nestjs/axios` como dependência nova só para 1 endpoint.
 *
 * Chamado por `PlansService.syncFromRevenueCat` — nunca direto por um
 * controller — para reconciliar o estado local (`Subscription`) com o
 * canônico da RevenueCat logo após uma compra nativa no app (`POST /plans/sync`),
 * já que o webhook pode levar alguns segundos para chegar (ver README raiz
 * "Etapa 16"). Processar o webhook em si NÃO chama esta API — o payload do
 * evento já traz os campos necessários, e chamar a REST API a cada webhook
 * (como a doc da RevenueCat sugere) acoplaria a velocidade de processamento
 * do webhook à disponibilidade da API deles, decisão deliberada de não fazer.
 */
@Injectable()
export class RevenueCatApiService {
  constructor(private readonly config: ConfigService) {}

  async getSubscriber(appUserId: string): Promise<RevenueCatSubscriberResponse> {
    const apiKey = this.config.get<string>('REVENUECAT_SECRET_API_KEY');
    if (!apiKey) {
      throw new RevenueCatApiError(
        'REVENUECAT_SECRET_API_KEY não configurada — não é possível consultar a RevenueCat.',
      );
    }

    const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      throw new RevenueCatApiError('Falha de rede ao consultar a RevenueCat.', { appUserId }, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new RevenueCatApiError(
        `RevenueCat retornou ${response.status} ao consultar o assinante.`,
        { appUserId, status: response.status, body },
      );
    }

    return (await response.json()) as RevenueCatSubscriberResponse;
  }
}
