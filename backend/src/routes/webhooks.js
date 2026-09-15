const express = require('express');
const WebhookController = require('../controllers/webhookController');
const { validateStreamerWebhookSignature } = require('../middlewares/auth');

const router = express.Router();

// Webhooks por streamer: cada streamer conecta sua própria conta LivePix/PixGG e
// recebe uma URL exclusiva (gerada na Central do Criador) validada com seu próprio
// segredo HMAC, em vez de um segredo único global da plataforma.
router.post(
  '/livepix/:streamerId',
  validateStreamerWebhookSignature('livepix'),
  WebhookController.livepixForStreamer
);
router.post(
  '/pixgg/:streamerId',
  validateStreamerWebhookSignature('pixgg'),
  WebhookController.pixggForStreamer
);

// Webhook global da Kick (um único endpoint por app, não por streamer — ver
// comentário em WebhookController.kickChannelWebhook). Autenticado via
// assinatura RSA verificada dentro do próprio controller.
router.post('/kick', WebhookController.kickChannelWebhook);

module.exports = router;
