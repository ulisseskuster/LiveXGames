// @ts-check
const webpush = require('web-push');
const NotificationModel = require('../models/notificationModel');

/**
 * Envio de Web Push (PWA).
 *
 * A infra de inscrições (push_subscriptions) e a fila de notificações existiam,
 * mas o envio real nunca foi ligado (ESCALA.md — "envio Web Push ... incompletos").
 *
 * Configuração: VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (geradas com
 * `npx web-push generate-vapid-keys`), e VAPID_SUBJECT (mailto: do time).
 * Sem as chaves, o serviço NUNCA falha o fluxo chamador: grava a notificação na
 * fila e devolve { skipped: 'vapid' }. Quando as chaves existirem, envia para
 * todas as inscrições do usuário e remove as que o push service rejeitar
 * (endpoint expirado/cadastrado em outro dispositivo).
 */

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:dev@livexgames.dev').trim();

const configurado = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (configurado) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn(
    '[WebPush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não definidos: envio Web Push desativado (notificações seguem gravadas na fila).'
  );
}

class PushNotificationService {
  /**
   * Envia uma notificação push para todas as inscrições do usuário.
   * @param {{userId: string, title: string, body: string, icon?: string, url?: string, relatedType?: string, relatedId?: string}} dados
   */
  static async sendToUser({ userId, title, body, icon, url, relatedType, relatedId }) {
    if (!userId) return { skipped: 'no-user' };

    // Grava na fila SEMPRE: o app mostra no sino mesmo sem push.
    const notification = await NotificationModel.createNotification({
      userId,
      title,
      body,
      icon,
      url,
      relatedType,
      relatedId
    });

    if (!configurado) return { skipped: 'vapid', notification };

    const subscriptions = await NotificationModel.subscriptionsForUser(userId);
    const resultados = [];
    for (const sub of subscriptions) {
      const payload = JSON.stringify({
        title,
        body,
        icon: icon || null,
        url: url || null,
        relatedType: relatedType || null,
        relatedId: relatedId || null
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { auth: sub.keys_auth, p256dh: sub.keys_p256dh } },
          payload
        );
        resultados.push({ endpoint: sub.endpoint, ok: true });
      } catch (err) {
        // 404/410 = endpoint morto (navegador desinstalou/expirou): remove.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await NotificationModel.deleteSubscription(sub.endpoint, userId).catch(() => {});
          resultados.push({ endpoint: sub.endpoint, ok: false, removida: true });
        } else {
          resultados.push({ endpoint: sub.endpoint, ok: false, erro: err.message });
        }
      }
    }
    return { sent: resultados.filter((r) => r.ok).length, notification, resultados };
  }

  static estaConfigurado() {
    return configurado;
  }
}

module.exports = PushNotificationService;
