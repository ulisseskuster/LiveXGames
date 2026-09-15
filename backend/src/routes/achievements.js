// Rotas de conquistas

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const AchievementController = require('../controllers/achievementController');

// Minhas conquistas (privado)
router.get('/me', requireAuth, AchievementController.me);

// Recalcular/desbloquear (privado, chamado pelo front após ações)
router.post('/check', requireAuth, AchievementController.check);

// Conquistas visíveis de um usuário (público/perfis)
router.get('/user/:userId', AchievementController.userPublic);

// Ranking de conquistas por canal (privado no futuro; hoje público)
router.get('/streamer/:streamerId/ranking', AchievementController.streamerRanking);

module.exports = router;
