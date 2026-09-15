// Rotas de notificações push PWA e central de notificações.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const NotificationController = require('../controllers/notificationController');

// Central de notificações (ler/marcar como lida)
router.get('/', requireAuth, NotificationController.list);
router.get('/unread-count', requireAuth, NotificationController.unreadCount);
router.post('/:notificationId/read', requireAuth, NotificationController.markRead);
router.post('/read-all', requireAuth, NotificationController.markAllRead);

// Inscrição/desinscrição Web Push
router.post('/push/subscribe', requireAuth, NotificationController.subscribe);
router.post('/push/unsubscribe', requireAuth, NotificationController.unsubscribe);

module.exports = router;
