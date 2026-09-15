const NotificationModel = require('../models/notificationModel');
const { ok, fail } = require('../utils/response');

class NotificationController {
  /** GET /api/notifications — lista, com paginação. */
  static async list(req, res) {
    try {
      const { limit, offset } = req.query;
      const items = await NotificationModel.listForUser(req.user.id, { limit, offset });
      const unread = await NotificationModel.countUnread(req.user.id);
      return ok(res, { items, unread }, 'Notificações carregadas com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar notificações', error.message);
    }
  }

  /** GET /api/notifications/unread-count — badge da interface. */
  static async unreadCount(req, res) {
    try {
      const unread = await NotificationModel.countUnread(req.user.id);
      return ok(res, { unread }, 'Contagem de não lidas carregada');
    } catch (error) {
      return fail(res, 500, 'Erro ao contar notificações', error.message);
    }
  }

  /** POST /api/notifications/:id/read — marca uma como lida. */
  static async markRead(req, res) {
    try {
      const { notificationId } = req.params;
      const marcada = await NotificationModel.markRead(req.user.id, notificationId);
      if (!marcada) {
        return fail(res, 404, 'Notificação não encontrada');
      }
      return ok(res, { id: marcada.id }, 'Notificação marcada como lida');
    } catch (error) {
      return fail(res, 500, 'Erro ao marcar notificação', error.message);
    }
  }

  /** POST /api/notifications/read-all — marca todas como lidas. */
  static async markAllRead(req, res) {
    try {
      const mudadas = await NotificationModel.markAllRead(req.user.id);
      return ok(res, { marked: mudadas }, 'Todas as notificações foram marcadas como lidas');
    } catch (error) {
      return fail(res, 500, 'Erro ao marcar notificações', error.message);
    }
  }

  /**
   * POST /api/notifications/push/subscribe
   * Registra uma inscrição de Web Push (endpoint + chaves). O navegador monta
   * essa inscrição via `registration.pushManager.subscribe()`, e o cliente
   * entrega aqui o JSON cru dela.
   */
  static async subscribe(req, res) {
    try {
      const { endpoint, keys } = req.body || {};
      const userAgent = req.get('user-agent') || '';

      if (!endpoint || !keys || !keys.auth || !keys.p256dh) {
        return fail(
          res,
          400,
          'Inscrição inválida: endpoint, keys.auth e keys.p256dh são obrigatórios'
        );
      }

      const inscricao = await NotificationModel.upsertSubscription({
        userId: req.user.id,
        endpoint,
        keysAuth: keys.auth,
        keysP256dh: keys.p256dh,
        userAgent
      });

      return ok(res, { id: inscricao.id }, 'Notificações push ativadas com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_SUBSCRIPTION') {
        return fail(res, 400, 'Inscrição inválida', error.message);
      }
      return fail(res, 500, 'Erro ao ativar notificações push', error.message);
    }
  }

  /** POST /api/notifications/push/unsubscribe — remove a inscrição. */
  static async unsubscribe(req, res) {
    try {
      const { endpoint } = req.body || {};
      if (!endpoint) {
        return fail(res, 400, 'endpoint é obrigatório');
      }
      const removida = await NotificationModel.deleteSubscription(endpoint, req.user.id);
      return ok(
        res,
        { removed: Boolean(removida) },
        removida ? 'Notificações push desativadas' : 'Inscrição não encontrada (nada a remover)'
      );
    } catch (error) {
      return fail(res, 500, 'Erro ao desativar notificações push', error.message);
    }
  }
}

module.exports = NotificationController;
