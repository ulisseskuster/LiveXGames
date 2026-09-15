const { randomUUID, randomBytes } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class StreamerPaymentConfigModel {
  static async findByStreamerId(streamerId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT * FROM streamer_payment_configs WHERE streamer_id = $1`,
          [streamerId]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerPaymentConfigModel.findByStreamerId');
      }
    }

    return InMemoryStore.streamerPaymentConfigs.find((c) => c.streamer_id === streamerId) || null;
  }

  static async ensureSecrets(streamerId) {
    const existing = await this.findByStreamerId(streamerId);
    if (existing && existing.livepix_webhook_secret && existing.pixgg_webhook_secret) {
      return existing;
    }

    const livepixSecret =
      (existing && existing.livepix_webhook_secret) || randomBytes(32).toString('hex');
    const pixggSecret =
      (existing && existing.pixgg_webhook_secret) || randomBytes(32).toString('hex');

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO streamer_payment_configs (streamer_id, livepix_webhook_secret, pixgg_webhook_secret)
           VALUES ($1, $2, $3)
           ON CONFLICT (streamer_id) DO UPDATE SET
             livepix_webhook_secret = COALESCE(streamer_payment_configs.livepix_webhook_secret, EXCLUDED.livepix_webhook_secret),
             pixgg_webhook_secret = COALESCE(streamer_payment_configs.pixgg_webhook_secret, EXCLUDED.pixgg_webhook_secret),
             updated_at = NOW()
           RETURNING *`,
          [streamerId, livepixSecret, pixggSecret]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerPaymentConfigModel.ensureSecrets');
      }
    }

    let config = InMemoryStore.streamerPaymentConfigs.find((c) => c.streamer_id === streamerId);
    if (!config) {
      config = {
        id: randomUUID(),
        streamer_id: streamerId,
        livepix_webhook_secret: livepixSecret,
        pixgg_webhook_secret: pixggSecret,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      InMemoryStore.streamerPaymentConfigs.push(config);
    } else {
      config.livepix_webhook_secret = config.livepix_webhook_secret || livepixSecret;
      config.pixgg_webhook_secret = config.pixgg_webhook_secret || pixggSecret;
      config.updated_at = new Date().toISOString();
    }
    return config;
  }

  static async regenerateSecret(streamerId, provider) {
    if (!['livepix', 'pixgg'].includes(provider)) {
      throw new Error('INVALID_PROVIDER');
    }
    await this.ensureSecrets(streamerId);
    const newSecret = randomBytes(32).toString('hex');
    const column = provider === 'livepix' ? 'livepix_webhook_secret' : 'pixgg_webhook_secret';

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE streamer_payment_configs SET ${column} = $1, updated_at = NOW() WHERE streamer_id = $2 RETURNING *`,
          [newSecret, streamerId]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerPaymentConfigModel.regenerateSecret');
      }
    }

    const config = InMemoryStore.streamerPaymentConfigs.find((c) => c.streamer_id === streamerId);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    config[column] = newSecret;
    config.updated_at = new Date().toISOString();
    return config;
  }

  static maskSecret(secret) {
    if (!secret || typeof secret !== 'string') return null;
    if (secret.length <= 8) return '••••••••';
    return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
  }

  static async updateApiCredentials(streamerId, credentials = {}) {
    await this.ensureSecrets(streamerId);
    const { pixgg_client_id, pixgg_client_secret, livepix_client_id, livepix_client_secret } =
      credentials;

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE streamer_payment_configs
           SET
             pixgg_client_id = CASE WHEN $1::text IS NOT NULL THEN $1::text ELSE pixgg_client_id END,
             pixgg_client_secret = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE pixgg_client_secret END,
             livepix_client_id = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE livepix_client_id END,
             livepix_client_secret = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE livepix_client_secret END,
             updated_at = NOW()
           WHERE streamer_id = $5
           RETURNING *`,
          [
            pixgg_client_id !== undefined ? pixgg_client_id : null,
            pixgg_client_secret !== undefined ? pixgg_client_secret : null,
            livepix_client_id !== undefined ? livepix_client_id : null,
            livepix_client_secret !== undefined ? livepix_client_secret : null,
            streamerId
          ]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerPaymentConfigModel.updateApiCredentials');
      }
    }

    const config = InMemoryStore.streamerPaymentConfigs.find((c) => c.streamer_id === streamerId);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    if (pixgg_client_id !== undefined) config.pixgg_client_id = pixgg_client_id;
    if (pixgg_client_secret !== undefined) config.pixgg_client_secret = pixgg_client_secret;
    if (livepix_client_id !== undefined) config.livepix_client_id = livepix_client_id;
    if (livepix_client_secret !== undefined) config.livepix_client_secret = livepix_client_secret;
    config.updated_at = new Date().toISOString();
    return config;
  }

  /**
   * Kill-switch do Mural de Doações do canal.
   *
   * Ausência de config (streamer que nunca abriu o painel) conta como ligado:
   * o padrão da coluna é TRUE e o mural não deve depender de o streamer ter
   * configurado gateway nenhum.
   */
  static async isWallEnabled(streamerId) {
    const config = await this.findByStreamerId(streamerId);
    if (!config) return true;
    return config.wall_enabled !== false;
  }

  static async setWallEnabled(streamerId, enabled) {
    await this.ensureSecrets(streamerId);

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE streamer_payment_configs SET wall_enabled = $1, updated_at = NOW()
           WHERE streamer_id = $2 RETURNING *`,
          [enabled, streamerId]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerPaymentConfigModel.setWallEnabled');
      }
    }

    const config = InMemoryStore.streamerPaymentConfigs.find((c) => c.streamer_id === streamerId);
    if (!config) throw new Error('CONFIG_NOT_FOUND');
    config.wall_enabled = enabled;
    config.updated_at = new Date().toISOString();
    return config;
  }
}

module.exports = StreamerPaymentConfigModel;
