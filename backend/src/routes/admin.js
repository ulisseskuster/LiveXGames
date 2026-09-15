const express = require('express');
const adminRewardController = require('../controllers/adminRewardController');
const adminStreamerApplicationController = require('../controllers/adminStreamerApplicationController');
const adminStreamerWalletController = require('../controllers/adminStreamerWalletController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Fila de moderação de brindes para aprovação/rejeição (Apenas Admin/Dev)
router.get(
  '/rewards/queue',
  requireAuth,
  requireRole(['admin']),
  adminRewardController.getModerationQueue
);

// Ação de aprovação ou rejeição com parecer técnico (Apenas Admin/Dev)
router.post(
  '/rewards/:rewardId/moderate',
  requireAuth,
  requireRole(['admin']),
  adminRewardController.moderateReward
);

// Fila de candidaturas para virar streamer verificado (Apenas Admin/Dev)
router.get(
  '/streamer-applications/queue',
  requireAuth,
  requireRole(['admin']),
  adminStreamerApplicationController.getModerationQueue
);
router.post(
  '/streamer-applications/:applicationId/moderate',
  requireAuth,
  requireRole(['admin']),
  adminStreamerApplicationController.moderateApplication
);

// Concessão manual de Fichas de Apoio (ferramenta de teste/goodwill do admin)
router.post(
  '/streamer-wallets/grant',
  requireAuth,
  requireRole(['admin']),
  adminStreamerWalletController.grant
);

module.exports = router;
