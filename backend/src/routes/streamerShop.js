const express = require('express');
const streamerRewardController = require('../controllers/streamerRewardController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Catálogo público de brindes aprovados
router.get('/catalog', streamerRewardController.getPublicCatalog);

// Criação de novos brindes (Streamer ou Admin)
router.post(
  '/rewards',
  requireAuth,
  requireRole(['streamer', 'admin']),
  streamerRewardController.createReward
);

// Meus brindes criados (Streamer)
router.get(
  '/my-rewards',
  requireAuth,
  requireRole(['streamer', 'admin']),
  streamerRewardController.getMyRewards
);

// Resgate de brinde com moedas virtuais (Qualquer usuário autenticado)
router.post('/redeem', requireAuth, streamerRewardController.redeem);

// Meus resgates/pedidos como espectador
router.get('/my-redemptions', requireAuth, streamerRewardController.getMyRedemptions);

// Pedidos recebidos para entrega (Streamer)
router.get(
  '/orders',
  requireAuth,
  requireRole(['streamer', 'admin']),
  streamerRewardController.getMyOrders
);

// Atualização de status de envio/rastreio (Streamer)
router.patch(
  '/orders/:redemptionId',
  requireAuth,
  requireRole(['streamer', 'admin']),
  streamerRewardController.updateOrderStatus
);

module.exports = router;
