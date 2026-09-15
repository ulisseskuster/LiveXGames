const express = require('express');
const authRoutes = require('./auth');
const shopRoutes = require('./shop');
const paymentsRoutes = require('./payments');
const gameRoutes = require('./game');
const leaderboardRoutes = require('./leaderboard');
const streamerShopRoutes = require('./streamerShop');
const streamerChannelRoutes = require('./streamerChannel');
const streamerApplicationsRoutes = require('./streamerApplications');
const adminRoutes = require('./admin');
const devRoutes = require('./dev');
const achievementsRoutes = require('./achievements');
const notificationsRoutes = require('./notifications');
const shopController = require('../controllers/shopController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// Rotas modulares
router.use('/auth', authRoutes);
router.use('/shop', shopRoutes);
router.use('/streamer-shop', streamerShopRoutes);
router.use('/streamer', streamerChannelRoutes);
router.use('/streamer-applications', streamerApplicationsRoutes);
router.use('/admin', adminRoutes);
router.use('/dev', devRoutes);
router.use('/payments', paymentsRoutes);
router.use('/game', gameRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/achievements', achievementsRoutes);
router.use('/notifications', notificationsRoutes);

// Rotas de compatibilidade direta com a base anterior
router.get('/wallet/:userId', requireAuth, shopController.getWallet);

module.exports = router;
