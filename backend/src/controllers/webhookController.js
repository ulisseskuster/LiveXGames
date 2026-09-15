const LivePixService = require('../services/livepixService');
const KickService = require('../services/kickService');
const { ok, fail } = require('../utils/response');

const KICK_SUBSCRIPTION_EVENTS = new Set([
  'channel.subscription.new',
  'channel.subscription.renewal'
]);

function mapWebhookError(res, error, providerLabel) {
  if (
    error.message === 'MISSING_EXTERNAL_ID' ||
    error.message === 'INVALID_PAYLOAD' ||
    error.message === 'INVALID_AMOUNT'
  ) {
    return fail(res, 400, 'Payload do webhook inválido', error.message);
  }
  if (error.message === 'USER_NOT_FOUND') {
    return fail(res, 404, 'Usuário destinatário não encontrado', error.message);
  }
  if (error.message === 'STREAMER_NOT_FOUND' || error.message === 'MISSING_STREAMER_ID') {
    return fail(res, 404, 'Streamer não encontrado', error.message);
  }
  return fail(res, 500, `Erro ao processar webhook ${providerLabel}`, error.message);
}

class WebhookController {
  static async livepixForStreamer(req, res) {
    try {
      const io = req.app.get('io');
      const payload = req.body;
      const { streamerId } = req.params;

      const result = await LivePixService.processWebhook(payload, io, 'livepix', streamerId);

      return ok(res, result, result.message);
    } catch (error) {
      return mapWebhookError(res, error, 'LivePix');
    }
  }

  static async pixggForStreamer(req, res) {
    try {
      const io = req.app.get('io');
      const payload = req.body;
      const { streamerId } = req.params;

      const result = await LivePixService.processWebhook(payload, io, 'pixgg', streamerId);

      return ok(res, result, result.message);
    } catch (error) {
      return mapWebhookError(res, error, 'PixGG');
    }
  }

  /**
   * Webhook único e global da Kick (não é por streamer: a Kick registra uma
   * URL de callback por app, identificando o canal dentro do payload). A
   * assinatura é RSA (chave pública da Kick), não HMAC compartilhado —
   * ver KickService.verifyWebhookSignature e docs.kick.com/events/webhook-security.
   */
  static async kickChannelWebhook(req, res) {
    try {
      const messageId = req.headers['kick-event-message-id'];
      const timestamp = req.headers['kick-event-message-timestamp'];
      const signature = req.headers['kick-event-signature'];
      const eventType = req.headers['kick-event-type'];
      const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

      const isValid = await KickService.verifyWebhookSignature(
        messageId,
        timestamp,
        rawBody,
        signature
      );
      if (!isValid) {
        return fail(res, 401, 'Assinatura do webhook Kick inválida');
      }

      if (!KICK_SUBSCRIPTION_EVENTS.has(eventType)) {
        // Evento reconhecido pela assinatura, mas de um tipo que a LiveX
        // Games ainda não trata (ex.: chat, follow). Confirma recebimento
        // sem processar, para a Kick não ficar reenviando.
        return ok(res, { ignored: true, eventType }, 'Evento recebido, sem ação necessária');
      }

      const result = await KickService.processSubscriptionEvent(
        eventType,
        req.body,
        req.app.get('io')
      );
      return ok(res, result, 'Evento de assinatura Kick processado');
    } catch (error) {
      console.error('[KickWebhook] Erro ao processar evento:', error.message);
      return fail(res, 500, 'Erro ao processar webhook Kick', error.message);
    }
  }
}

module.exports = WebhookController;
