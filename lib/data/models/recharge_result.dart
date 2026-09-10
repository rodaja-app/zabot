/// Resultado da criação de uma cobrança Pix (`POST /wallet/recharge`, ver
/// backend `wallet.dto.ts#RechargeResultDto`). `status` começa sempre
/// `RechargeStatus.pending` — a tela de recarga faz polling de `GET /wallet`
/// para detectar a confirmação (não existe push/socket para isso ainda, ver
/// README do backend).
enum RechargeStatus { pending, paid, failed }

RechargeStatus rechargeStatusFromApi(String status) {
  switch (status) {
    case 'PAGO':
      return RechargeStatus.paid;
    case 'FALHOU':
      return RechargeStatus.failed;
    case 'PENDENTE':
    default:
      return RechargeStatus.pending;
  }
}

class RechargeResult {
  const RechargeResult({
    required this.transactionId,
    required this.status,
    required this.credits,
    required this.priceLabel,
    required this.pixQrCode,
    required this.pixQrCodeBase64,
  });

  final String transactionId;
  final RechargeStatus status;
  final int credits;
  final String priceLabel;

  /// Payload "copia e cola" do Pix — texto puro para o botão de copiar.
  final String? pixQrCode;

  /// QR code já renderizado como PNG em base64 (sem o prefixo
  /// `data:image/...;base64,`) — decodificar com o mesmo helper usado para
  /// o QR de conexão do WhatsApp (`inicio_screen.dart`).
  final String? pixQrCodeBase64;
}
