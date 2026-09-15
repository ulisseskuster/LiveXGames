const db = require('../config/database');
const InMemoryStore = require('../data/store');

/**
 * Modelo de inscrições Web Push e fila de notificações.
 *
 * Uma inscrição por (usuário, endpoint): o mesmo navegador não pode se
 * inscrever duas vezes. `endpoint` é a URL única que o push service entrega.
 */
class NotificationModel {
  /** Salva (ou renova) uma inscrição de Web Push para um usuário. */
  static async upsertSubscription({ userId, endpoint, keysAuth, keysP256dh, userAgent }) {
    if (!userId || !endpoint || !keysAuth || !keysP256dh) {
      throw new Error('INVALID_SUBSCRIPTION');
    }
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO push_subscriptions (user_id, endpoint, keys_auth, keys_p256dh, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (endpoint) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             keys_auth = EXCLUDED.keys_auth,
             keys_p256dh = EXCLUDED.keys_p256dh,
             user_agent = EXCLUDED.user_agent,
             last_seen_at = NOW()
           RETURNING id`,
          [userId, endpoint, keysAuth, keysP256dh, userAgent || null]
        );
        return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.upsertSubscription');
      }
    }

    // Fallback em memória
    const idx = InMemoryStore.pushSubscriptions.findIndex((s) => s.endpoint === endpoint);
    if (idx >= 0) {
      InMemoryStore.pushSubscriptions[idx] = {
        ...InMemoryStore.pushSubscriptions[idx],
        user_id: userId,
        keys_auth: keysAuth,
        keys_p256dh: keysP256dh,
        user_agent: userAgent || null,
        last_seen_at: new Date().toISOString()
      };
      return InMemoryStore.pushSubscriptions[idx];
    }
    const nova = {
      id: `ps-${userId.slice(0, 8)}-${Date.now()}`,
      user_id: userId,
      endpoint,
      keys_auth: keysAuth,
      keys_p256dh: keysP256dh,
      user_agent: userAgent || null,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    InMemoryStore.pushSubscriptions.push(nova);
    return nova;
  }

  /** Remove uma inscrição (usuário desativou ou endpoint expirou). */
  static async deleteSubscription(endpoint, userId) {
    if (!endpoint || !userId) return null;
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2 RETURNING id',
          [endpoint, userId]
        );
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.deleteSubscription');
      }
    }
    const idx = InMemoryStore.pushSubscriptions.findIndex(
      (s) => s.endpoint === endpoint && s.user_id === userId
    );
    if (idx < 0) return null;
    const [removida] = InMemoryStore.pushSubscriptions.splice(idx, 1);
    return { id: removida.id };
  }

  /** Todas as inscrições ativas de um usuário. */
  static async subscriptionsForUser(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT id, endpoint, keys_auth, keys_p256dh
           FROM push_subscriptions
           WHERE user_id = $1
           ORDER BY created_at ASC`,
          [userId]
        );
        return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.subscriptionsForUser');
      }
    }
    return InMemoryStore.pushSubscriptions.filter((s) => s.user_id === userId);
  }

  /** Cria uma notificação na fila. Retorna o registro completo. */
  static async createNotification({ userId, title, body, icon, url, relatedType, relatedId }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO notifications (user_id, title, body, icon, url, related_type, related_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [userId, title, body, icon || null, url || null, relatedType || null, relatedId || null]
        );
        return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.createNotification');
      }
    }
    const nova = {
      id: `nt-${userId.slice(0, 8)}-${Date.now()}`,
      user_id: userId,
      title,
      body,
      icon: icon || null,
      url: url || null,
      related_type: relatedType || null,
      related_id: relatedId || null,
      delivered_at: null,
      read_at: null,
      created_at: new Date().toISOString()
    };
    InMemoryStore.notifications.unshift(nova);
    return nova;
  }

  /** Lista notificações de um usuário, mais recentes primeiro. */
  static async listForUser(userId, { limit = 20, offset = 0 } = {}) {
    const numLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const numOffset = Math.max(0, parseInt(offset, 10) || 0);
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT id, title, body, icon, url, related_type, related_id, delivered_at, read_at, created_at
           FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, numLimit, numOffset]
        );
        return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.listForUser');
      }
    }
    return InMemoryStore.notifications
      .filter((n) => n.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(numOffset, numOffset + numLimit);
  }

  /** Conta notificações não lidas (para o badge da interface). */
  static async countUnread(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS total
           FROM notifications
           WHERE user_id = $1 AND read_at IS NULL`,
          [userId]
        );
        return rows[0].total;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.countUnread');
      }
    }
    return InMemoryStore.notifications.filter((n) => n.user_id === userId && !n.read_at).length;
  }

  /** Marca uma notificação como lida. Só o dono. */
  static async markRead(userId, notificationId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE notifications
           SET read_at = COALESCE(read_at, NOW())
           WHERE id = $1 AND user_id = $2
           RETURNING id`,
          [notificationId, userId]
        );
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.markRead');
      }
    }
    const alvo = InMemoryStore.notifications.find(
      (n) => n.id === notificationId && n.user_id === userId
    );
    if (!alvo) return null;
    alvo.read_at = alvo.read_at || new Date().toISOString();
    return { id: alvo.id };
  }

  /** Marca todas como lidas. Retorna quantas mudaram. */
  static async markAllRead(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE notifications
           SET read_at = COALESCE(read_at, NOW())
           WHERE user_id = $1 AND read_at IS NULL
           RETURNING id`,
          [userId]
        );
        return rows.length;
      } catch (err) {
        db.fallbackOrThrow(err, 'NotificationModel.markAllRead');
      }
    }
    let mudadas = 0;
    for (const n of InMemoryStore.notifications) {
      if (n.user_id === userId && !n.read_at) {
        n.read_at = new Date().toISOString();
        mudadas += 1;
      }
    }
    return mudadas;
  }
}

module.exports = NotificationModel;
