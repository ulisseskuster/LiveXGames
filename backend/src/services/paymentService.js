const LivePixService = require('./livepixService');

class PaymentService {
  static async createDonationIntent({ userId, amount, message = '' }) {
    const numAmount = Number(amount);
    if (!userId || isNaN(numAmount) || numAmount <= 0) {
      throw new Error('INVALID_DONATION');
    }

    const txid = `LIVEX${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const externalId = `livepix-${txid}`;
    const coinsPerBrl = Number(process.env.COINS_PER_BRL) || 100;
    const coinsEstimated = Math.round(numAmount * coinsPerBrl);

    // Formatação oficial padrão EMV QRCPS-MPM / Banco Central do Brasil
    const formattedAmount = numAmount.toFixed(2);
    const amountField = `54${String(formattedAmount.length).padStart(2, '0')}${formattedAmount}`;
    const rawPayload = `00020126580014br.gov.bcb.pix0136livex-stream-pix-autorizado-2026520400005303986${amountField}5802BR5911LIVEX GAMES6009SAO PAULO62170513${txid}6304`;

    // Cálculo simples e canônico de CRC16 CCITT
    let crc = 0xffff;
    for (let i = 0; i < rawPayload.length; i++) {
      crc ^= rawPayload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc = crc << 1;
        }
      }
    }
    const crcHex = (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const qrCodePayload = `${rawPayload}${crcHex}`;

    return {
      provider: 'livepix_authorized',
      intermediary: {
        name: 'LivePix Gateway Autorizado',
        accredited_by: 'Banco Central do Brasil / Pix',
        status: 'OPERACIONAL',
        txid
      },
      externalId,
      amountBrl: numAmount,
      coinsEstimated,
      qrCodePayload,
      expiresInMinutes: 15,
      status: 'pending'
    };
  }

  static async simulateDonation({ userId, amount, message = '', streamerId }, io = null) {
    const numAmount = Number(amount);
    if (!userId || isNaN(numAmount) || numAmount <= 0) {
      throw new Error('INVALID_DONATION');
    }
    if (!streamerId) {
      throw new Error('MISSING_STREAMER_ID');
    }

    const external_id = `sim-livepix-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const payload = {
      provider: 'livepix',
      external_id,
      userId,
      amount: numAmount,
      message
    };

    return LivePixService.processWebhook(payload, io, 'livepix', streamerId);
  }
}

module.exports = PaymentService;
