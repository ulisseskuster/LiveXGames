const express = require('express');
const StreamerChannelController = require('../controllers/streamerChannelController');
const StreamerDashboardController = require('../controllers/streamerDashboardController');
const StreamerRouletteController = require('../controllers/streamerRouletteController');
const DonationWallController = require('../controllers/donationWallController');
const { requireAuth, optionalAuth, requireRole } = require('../middlewares/auth');
const { createRateLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

const streamerAuth = [requireAuth, requireRole(['streamer', 'admin'])];

// Bucket próprio do mural: a chave do limitador inclui a rota, então este teto
// não consome (nem é consumido por) o de login ou o da roleta. 30/min é folgado
// para quem navega e curte, e estreito para clique automatizado.
const wallReactionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Calma no gatilho! Aguarde um instante antes de reagir de novo.'
});

// Diretório público de streamers (registrado antes de '/:username' para não colidir)
router.get('/list', StreamerChannelController.listStreamers);

// Painel de gestão do próprio streamer (webhooks/segredos, resumo de brindes/pedidos)
router.get(
  '/dashboard/me',
  requireAuth,
  requireRole(['streamer', 'admin']),
  StreamerChannelController.getStreamerDashboard
);
router.post(
  '/dashboard/api-credentials',
  requireAuth,
  requireRole(['streamer', 'admin']),
  StreamerChannelController.updateApiCredentials
);
router.post(
  '/dashboard/verify-api',
  requireAuth,
  requireRole(['streamer', 'admin']),
  StreamerChannelController.verifyApiCredentials
);
router.post(
  '/dashboard/regenerate-secret',
  requireAuth,
  requireRole(['streamer', 'admin']),
  StreamerChannelController.regenerateWebhookSecret
);

// ── Métricas do dashboard (novo serviço) ──────────────────────────────────
router.get('/dashboard/stats', ...streamerAuth, StreamerDashboardController.stats);
router.get('/dashboard/series', ...streamerAuth, StreamerDashboardController.series);
router.get('/dashboard/top-items', ...streamerAuth, StreamerDashboardController.topItems);
router.get('/dashboard/top-players', ...streamerAuth, StreamerDashboardController.topPlayers);

// Roleta diária por streamer
router.get('/:streamerId/roulette/status', requireAuth, StreamerRouletteController.getStatus);
router.post('/:streamerId/roulette/spin', requireAuth, StreamerRouletteController.spin);

// Mural Social de Doações. Feed e ranking saem da MESMA rota: o que muda entre
// eles é só ?sort= e ?period=, ambos de allowlist.
//
// Como o '/list' logo acima, estas rotas precisam vir antes de '/:username',
// senão o Express casa '/:username' primeiro e o mural nunca é alcançado.
router.get('/:streamerId/wall', optionalAuth, DonationWallController.getWall);
// Público como o mural: nome, papel, total e número de doações, sem ids.
router.get('/:streamerId/wall/top-donors', DonationWallController.getTopDonors);
router.post(
  '/:streamerId/wall/:donationId/react',
  requireAuth,
  wallReactionLimiter,
  DonationWallController.react
);
// requireRole é a primeira barreira (só streamer/admin chegam aqui); a segunda,
// no serviço, confere o dono do canal contra o streamer_id gravado na doação —
// senão um streamer apagaria o mural de outro.
router.delete(
  '/:streamerId/wall/:donationId',
  requireAuth,
  requireRole(['streamer', 'admin']),
  DonationWallController.remove
);

// Edição de configurações (LivePix / PixGG) pelo streamer logado
router.put(
  '/settings',
  requireAuth,
  requireRole(['streamer', 'admin']),
  StreamerChannelController.updateSettings
);

// Consulta pública de canal do streamer e sua lojinha (autenticação opcional
// para incluir o saldo de fichas do viewer com esse streamer, quando logado)
router.get('/:username', optionalAuth, StreamerChannelController.getChannel);

module.exports = router;
