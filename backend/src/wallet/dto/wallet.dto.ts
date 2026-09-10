import { Wallet, WalletTransaction } from '@prisma/client';
import { IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { RECHARGE_PACKAGES, RechargePackage } from '../recharge-packages';

/** Espelha o saldo atual da carteira — front consulta antes/depois de criar campanha para exibir o saldo restante. */
export interface WalletDto {
  balance: number;
}

export function toWalletDto(wallet: Wallet | null): WalletDto {
  return { balance: wallet?.balance ?? 0 };
}

/** Catálogo estático de recargas — sempre os mesmos 5 pacotes (ver recharge-packages.ts), nunca calculado por request. */
export interface RechargePackageDto {
  id: string;
  amountCents: number;
  credits: number;
  bonusPercent: number;
}

export function listRechargePackageDtos(): RechargePackageDto[] {
  return RECHARGE_PACKAGES.map((pkg: RechargePackage) => ({ ...pkg }));
}

export const WALLET_PAYMENT_METHODS = ['pix', 'card'] as const;
export type WalletPaymentMethod = (typeof WALLET_PAYMENT_METHODS)[number];

/**
 * `POST /wallet/recharge` — só escolhe o pacote fixo, nunca um valor livre
 * (catálogo fechado, decisão do usuário). `paymentMethod` decide o resto do
 * shape: `pix` (padrão, se omitido) não exige mais nada; `card` exige um
 * token de cartão já tokenizado no app (nunca dados de cartão em texto puro
 * chegam aqui), o `payment_method_id` da bandeira e o CPF do pagador (exigido
 * pelo Mercado Pago para cartão no Brasil).
 */
export class CreateRechargeDto {
  @IsIn(RECHARGE_PACKAGES.map((pkg) => pkg.id))
  packageId!: string;

  @IsOptional()
  @IsIn(WALLET_PAYMENT_METHODS)
  paymentMethod?: WalletPaymentMethod;

  @ValidateIf((dto: CreateRechargeDto) => dto.paymentMethod === 'card')
  @IsString()
  cardToken!: string;

  @ValidateIf((dto: CreateRechargeDto) => dto.paymentMethod === 'card')
  @IsString()
  paymentMethodId!: string;

  @ValidateIf((dto: CreateRechargeDto) => dto.paymentMethod === 'card')
  @Matches(/^\d{11}$/, { message: 'payerCpf deve conter exatamente 11 dígitos numéricos.' })
  payerCpf!: string;
}

/** Retorno da criação de cobrança (Pix ou cartão) — QR/copia-e-cola só vem preenchido para Pix; cartão já pode voltar `status = PAGO`/`FALHOU` na mesma resposta (aprovação síncrona). */
export interface RechargeResultDto {
  transactionId: string;
  status: WalletTransaction['status'];
  credits: number;
  amountCents: number;
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
}

export function toRechargeResultDto(tx: WalletTransaction): RechargeResultDto {
  return {
    transactionId: tx.id,
    status: tx.status,
    credits: tx.credits,
    amountCents: tx.amountCents ?? 0,
    pixQrCode: tx.pixQrCode,
    pixQrCodeBase64: tx.pixQrCodeBase64,
  };
}

/** `GET /wallet/mercadopago-public-key` — chave pública para o app tokenizar cartão via `/v1/card_tokens` do Mercado Pago. */
export interface MercadoPagoPublicKeyDto {
  publicKey: string | null;
}
