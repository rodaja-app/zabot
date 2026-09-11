import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { CardPaymentRejectedError, PixPaymentError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRechargeDto,
  RechargePackageDto,
  RechargeResultDto,
  WalletDto,
  listRechargePackageDtos,
  toRechargeResultDto,
  toWalletDto,
} from './dto/wallet.dto';
import { CardPaymentResult, MercadoPagoApiService, WebhookSignature } from './mercado-pago-api.service';
import { findRechargePackage } from './recharge-packages';

/**
 * Separador do `external_reference` enviado ao Mercado Pago na criação da
 * cobrança — carrega o `userId` (necessário para reabrir `withTenantContext`
 * no webhook, que não tem JWT) junto com o id da `WalletTransaction`
 * (identifica exatamente qual recarga aquele pagamento cobre). Nunca um
 * caractere que possa aparecer num uuid.
 */
const EXTERNAL_REFERENCE_SEPARATOR = '|';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoApiService,
    private readonly logger: Logger,
  ) {}

  async getWallet(userId: string): Promise<WalletDto> {
    // Recupera pagamentos aprovados cujo webhook atrasou/perdeu. Assim, até
    // uma tela já aberta numa versão anterior do app volta a atualizar pelo
    // polling de saldo que ela já faz.
    await this.syncPendingRecharges(userId);
    const wallet = await this.prisma.withTenantContext(userId, (tx) => tx.wallet.findUnique({ where: { userId } }));
    return toWalletDto(wallet);
  }

  listPackages(): RechargePackageDto[] {
    return listRechargePackageDtos();
  }

  /** Chave pública do Mercado Pago para o app tokenizar cartão — ver comentário em `MercadoPagoApiService.publicKey`. */
  getMercadoPagoPublicKey(): string | null {
    return this.mercadoPago.publicKey;
  }

  /**
   * Cria a cobrança (Pix ou cartão, conforme `dto.paymentMethod`). Em 2
   * passos, nunca 1 transação Prisma só: primeiro persiste a
   * `WalletTransaction` PENDENTE (rápido, commita de verdade), depois chama
   * a API do Mercado Pago (rede, pode demorar/falhar) — manter uma transação
   * de banco aberta durante uma chamada HTTP externa prende conexões do pool
   * sem necessidade (mesmo cuidado já tomado em
   * `CampaignsService.createCampaign`, que só enfileira depois do commit).
   * Se a chamada falhar, a `WalletTransaction` já persistida é marcada
   * FALHOU em vez de ficar PENDENTE para sempre.
   */
  async createRecharge(userId: string, dto: CreateRechargeDto): Promise<RechargeResultDto> {
    const pkg = findRechargePackage(dto.packageId);
    if (!pkg) {
      throw new BadRequestException(`Pacote de recarga desconhecido: ${dto.packageId}.`);
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const pending = await this.prisma.withTenantContext(userId, async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0 },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: WalletTransactionType.RECARGA,
          status: WalletTransactionStatus.PENDENTE,
          credits: pkg.credits,
          amountCents: pkg.amountCents,
        },
      });
    });

    if (dto.paymentMethod === 'card') {
      return this.createCardRecharge(userId, pending.id, pkg, user.email, dto);
    }
    return this.createPixRecharge(userId, pending.id, pkg, user.email);
  }

  /** Confirma uma recarga pendente sem depender da entrega do webhook. */
  async syncRechargeStatus(userId: string, transactionId: string): Promise<RechargeResultDto> {
    const transaction = await this.prisma.withTenantContext(userId, (tx) =>
      tx.walletTransaction.findUnique({ where: { id: transactionId } }),
    );
    if (!transaction || transaction.type !== WalletTransactionType.RECARGA) {
      throw new BadRequestException('Recarga não encontrada.');
    }
    if (transaction.status !== WalletTransactionStatus.PENDENTE || !transaction.pixPaymentId) {
      return toRechargeResultDto(transaction);
    }

    const payment = await this.mercadoPago.getPayment(transaction.pixPaymentId);
    const expectedReference = `${userId}${EXTERNAL_REFERENCE_SEPARATOR}${transactionId}`;
    if (payment.externalReference !== expectedReference) {
      this.logger.error(
        { event: 'mercadopago_recharge_reference_mismatch', transactionId, paymentId: payment.id },
        'Pagamento Mercado Pago não corresponde à recarga solicitada',
      );
      throw new PixPaymentError('Não foi possível confirmar esta recarga.', { transactionId, paymentId: payment.id });
    }

    return this.prisma.withTenantContext(userId, async (tx) => {
      await this.applyPaymentUpdate(tx, transactionId, payment);
      return toRechargeResultDto(await tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } }));
    });
  }

  private async syncPendingRecharges(userId: string): Promise<void> {
    const pending = await this.prisma.withTenantContext(userId, (tx) =>
      tx.walletTransaction.findMany({
        where: {
          type: WalletTransactionType.RECARGA,
          status: WalletTransactionStatus.PENDENTE,
          pixPaymentId: { not: null },
        },
        select: { id: true },
      }),
    );
    for (const transaction of pending) {
      await this.syncRechargeStatus(userId, transaction.id).catch((err) =>
        this.logger.warn(
          { event: 'mercadopago_pending_recharge_sync_failed', transactionId: transaction.id, err },
          'Não foi possível sincronizar recarga Pix pendente agora',
        ),
      );
    }
  }

  private async createPixRecharge(
    userId: string,
    transactionId: string,
    pkg: { credits: number; amountCents: number },
    payerEmail: string,
  ): Promise<RechargeResultDto> {
    try {
      const payment = await this.mercadoPago.createPixPayment({
        idempotencyKey: transactionId,
        transactionAmountCents: pkg.amountCents,
        description: `ZaBot — recarga de ${pkg.credits} créditos`,
        payerEmail,
        externalReference: `${userId}${EXTERNAL_REFERENCE_SEPARATOR}${transactionId}`,
      });

      const updated = await this.prisma.withTenantContext(userId, (tx) =>
        tx.walletTransaction.update({
          where: { id: transactionId },
          data: { pixPaymentId: payment.paymentId, pixQrCode: payment.qrCode, pixQrCodeBase64: payment.qrCodeBase64 },
        }),
      );
      return toRechargeResultDto(updated);
    } catch (err) {
      await this.markFailed(userId, transactionId, err, 'criação da cobrança Pix');
      throw err;
    }
  }

  /**
   * Cartão responde SÍNCRONO (`approved`/`rejected`/`in_process` já vêm na
   * mesma chamada, diferente do Pix que fica sempre PENDENTE até o webhook).
   * Por isso credita/rejeita direto aqui em vez de esperar o webhook — que
   * ainda pode chegar depois (duplicado), mas `applyPaymentUpdate` já é
   * idempotente (só reage a `status === PENDENTE`).
   */
  private async createCardRecharge(
    userId: string,
    transactionId: string,
    pkg: { credits: number; amountCents: number },
    payerEmail: string,
    dto: CreateRechargeDto,
  ): Promise<RechargeResultDto> {
    let payment: CardPaymentResult;
    try {
      payment = await this.mercadoPago.createCardPayment({
        idempotencyKey: transactionId,
        transactionAmountCents: pkg.amountCents,
        description: `ZaBot — recarga de ${pkg.credits} créditos`,
        payerEmail,
        payerCpf: dto.payerCpf,
        cardToken: dto.cardToken,
        paymentMethodId: dto.paymentMethodId,
        externalReference: `${userId}${EXTERNAL_REFERENCE_SEPARATOR}${transactionId}`,
      });
    } catch (err) {
      await this.markFailed(userId, transactionId, err, 'criação da cobrança de cartão');
      throw err;
    }

    await this.prisma.withTenantContext(userId, (tx) =>
      tx.walletTransaction.update({ where: { id: transactionId }, data: { pixPaymentId: payment.paymentId } }),
    );

    await this.prisma.withTenantContext(userId, (tx) =>
      this.applyPaymentUpdate(tx, transactionId, { id: payment.paymentId, status: payment.status }),
    );

    const updated = await this.prisma.withTenantContext(userId, (tx) =>
      tx.walletTransaction.findUniqueOrThrow({ where: { id: transactionId } }),
    );

    if (updated.status === WalletTransactionStatus.FALHOU) {
      throw new CardPaymentRejectedError(cardRejectionMessage(payment.statusDetail), {
        transactionId,
        statusDetail: payment.statusDetail,
      });
    }

    return toRechargeResultDto(updated);
  }

  private async markFailed(userId: string, transactionId: string, err: unknown, context: string): Promise<void> {
    await this.prisma
      .withTenantContext(userId, (tx) =>
        tx.walletTransaction.update({ where: { id: transactionId }, data: { status: WalletTransactionStatus.FALHOU } }),
      )
      .catch((persistErr) =>
        this.logger.error(
          { event: 'wallet_recharge_mark_failed_error', transactionId, err: persistErr },
          `Falha ao marcar recarga como FALHOU após erro na ${context}`,
        ),
      );
  }

  /**
   * Webhook do Mercado Pago (rota pública, sem JWT). `dataId` vem do query
   * param `data.id` (formato de notificação legado/IPN) — o corpo da
   * notificação moderna também tem `data.id`, o controller repassa o que
   * encontrar primeiro. A assinatura é verificada ANTES de qualquer consulta
   * à API do Mercado Pago ou ao banco — nunca gastar uma chamada de API ou
   * tocar no banco por causa de um request não autenticado.
   */
  async handleMercadoPagoWebhook(dataId: string | undefined, signature: WebhookSignature): Promise<void> {
    if (!dataId) {
      this.logger.warn({ event: 'mercadopago_webhook_missing_data_id' }, 'Webhook Mercado Pago sem data.id — ignorado');
      return;
    }

    if (!this.mercadoPago.verifyWebhookSignature(signature)) {
      throw new PixPaymentError('Assinatura inválida no webhook do Mercado Pago.', { dataId });
    }

    // Notificação é só um aviso — a fonte de verdade é sempre a consulta
    // direta ao pagamento na API do Mercado Pago (status e external_reference).
    const payment = await this.mercadoPago.getPayment(dataId);

    const [userId, transactionId] = (payment.externalReference ?? '').split(EXTERNAL_REFERENCE_SEPARATOR);
    if (!userId || !transactionId) {
      this.logger.error(
        { event: 'mercadopago_webhook_missing_external_reference', paymentId: payment.id },
        'Webhook Mercado Pago sem external_reference reconhecível — não é possível identificar a recarga',
      );
      return;
    }

    await this.prisma.withTenantContext(userId, (tx) => this.applyPaymentUpdate(tx, transactionId, payment));
  }

  private async applyPaymentUpdate(
    tx: Prisma.TransactionClient,
    transactionId: string,
    payment: { id: string; status: string },
  ): Promise<void> {
    const walletTransaction = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
    if (!walletTransaction || walletTransaction.type !== WalletTransactionType.RECARGA) {
      this.logger.error(
        { event: 'mercadopago_webhook_transaction_not_found', transactionId, paymentId: payment.id },
        'Webhook Mercado Pago referencia uma WalletTransaction inexistente ou que não é RECARGA',
      );
      return;
    }

    // Idempotência: webhook pode ser entregue mais de uma vez (documentado
    // pelo próprio Mercado Pago) — já PAGO/FALHOU não reaplica nada.
    if (walletTransaction.status !== WalletTransactionStatus.PENDENTE) return;

    if (payment.status !== 'approved') {
      // "rejected"/"cancelled"/outros terminais — ainda "pending"/"in_process"
      // não muda nada (nova notificação chega quando o Pix for pago/expirar).
      if (payment.status === 'rejected' || payment.status === 'cancelled') {
        await tx.walletTransaction.update({
          where: { id: walletTransaction.id },
          data: { status: WalletTransactionStatus.FALHOU },
        });
      }
      return;
    }

    // Credita o saldo via compare-and-swap (mesmo padrão de
    // `CampaignsService.debitWalletOrThrow`, só que somando) — evita
    // creditar duas vezes se, por alguma corrida, este handler rodar
    // concorrentemente para a mesma WalletTransaction.
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletTransaction.walletId } });
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: wallet.balance },
      data: { balance: { increment: walletTransaction.credits } },
    });
    if (updated.count === 0) {
      throw new PixPaymentError('Conflito ao creditar a carteira — tente novamente.', { transactionId });
    }

    await tx.walletTransaction.update({
      where: { id: walletTransaction.id },
      data: { status: WalletTransactionStatus.PAGO, paidAt: new Date(), pixPaymentId: payment.id },
    });
  }
}

/**
 * Mapeia os códigos mais comuns de `status_detail` do Mercado Pago (cartão
 * recusado) para uma mensagem em PT-BR específica — nunca expõe o código cru
 * pro usuário final. Códigos não mapeados caem no genérico. Lista baseada na
 * documentação pública do Mercado Pago ("Checkout API > Response handling").
 */
function cardRejectionMessage(statusDetail: string | undefined): string {
  switch (statusDetail) {
    case 'cc_rejected_insufficient_amount':
      return 'Cartão recusado: saldo/limite insuficiente.';
    case 'cc_rejected_bad_filled_security_code':
      return 'Cartão recusado: código de segurança (CVV) inválido.';
    case 'cc_rejected_bad_filled_date':
      return 'Cartão recusado: data de validade inválida.';
    case 'cc_rejected_bad_filled_card_number':
      return 'Cartão recusado: número do cartão inválido.';
    case 'cc_rejected_bad_filled_other':
      return 'Cartão recusado: verifique os dados informados.';
    case 'cc_rejected_call_for_authorize':
      return 'Cartão recusado: é necessário autorizar o pagamento junto ao banco emissor.';
    case 'cc_rejected_card_disabled':
      return 'Cartão recusado: cartão desabilitado. Contate o banco emissor.';
    case 'cc_rejected_duplicated_payment':
      return 'Pagamento duplicado — uma cobrança igual já foi feita recentemente.';
    case 'cc_rejected_high_risk':
    case 'cc_rejected_blacklist':
      return 'Cartão recusado por segurança. Tente outro cartão ou use Pix.';
    case 'cc_rejected_max_attempts':
      return 'Número máximo de tentativas excedido. Tente outro cartão ou use Pix.';
    case 'cc_rejected_card_type_not_allowed':
      return 'Cartão recusado: tipo de cartão não aceito.';
    default:
      return 'Pagamento recusado pelo cartão. Tente outro cartão ou use Pix.';
  }
}
