/**
 * KickService - Integração Oficial com Kick API (OAuth 2.1 + PKCE, App Access
 * Token e verificação de webhooks assinados com a chave pública da Kick)
 *
 * Diferenças importantes em relação à Twitch (ver twitchService.js):
 * - Login do espectador usa OAuth 2.1 com PKCE (code_verifier/code_challenge),
 *   não apenas client_id/secret.
 * - Não existe um endpoint "está este usuário inscrito neste canal?" que possa
 *   ser consultado a qualquer momento. A Kick informa inscrições via eventos
 *   de webhook (channel.subscription.new / .renewal) entregues de forma
 *   assíncrona. Por isso, o status de sub é atualizado pelo webhookController
 *   quando o evento chega, não durante o login.
 * - A inscrição do app para receber esses eventos de um streamer específico é
 *   feita com um App Access Token (grant client_credentials) + broadcaster_user_id
 *   explícito, e não exige que o streamer conceda o escopo events:subscribe na
 *   própria conta (ver docs.kick.com/events/subscribe-to-events).
 */
const crypto = require('crypto');
const UserModel = require('../models/userModel');
const AuthService = require('./authService');

const AUTH_BASE = 'https://id.kick.com';
const API_BASE = 'https://api.kick.com/public/v1';

let cachedAppToken = null; // { token, expiresAt }
let cachedPublicKey = null; // string PEM, cacheado em memória por processo

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

class KickService {
  static isConfigured() {
    return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
  }

  static getRedirectUri(req = null) {
    if (process.env.KICK_REDIRECT_URI) {
      return process.env.KICK_REDIRECT_URI;
    }
    if (req) {
      const protocol =
        req.headers['x-forwarded-proto'] ||
        req.protocol ||
        (process.env.NODE_ENV === 'production' ? 'https' : 'http');
      const host =
        req.headers['x-forwarded-host'] ||
        req.get('host') ||
        (process.env.NODE_ENV === 'production' ? 'livexgames.onrender.com' : 'localhost:3000');
      return `${protocol}://${host}/api/auth/kick/callback`;
    }
    if (process.env.NODE_ENV === 'production') {
      return 'https://livexgames.onrender.com/api/auth/kick/callback';
    }
    return 'http://localhost:3000/api/auth/kick/callback';
  }

  /**
   * Gera o par PKCE (RFC 7636): code_verifier aleatório e o code_challenge
   * S256 derivado dele. O verifier precisa ser guardado (via OAuthStateStore)
   * para ser reenviado na troca do code por token.
   */
  static generatePkcePair() {
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  static getAuthorizationUrl(state, codeChallenge, req = null) {
    const clientId = process.env.KICK_CLIENT_ID || 'DEMO_KICK_CLIENT_ID';
    const redirectUri = this.getRedirectUri(req);
    const scopes = ['user:read'].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state: state || 'livex_kick_auth',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${AUTH_BASE}/oauth/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(code, redirectUri, codeVerifier) {
    if (!this.isConfigured()) {
      return { access_token: 'mock_kick_access_token', refresh_token: 'mock', expires_in: 3600 };
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier
    });

    const response = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`KICK_TOKEN_ERROR: Falha ao obter token (${response.status}): ${errorData}`);
    }

    return await response.json();
  }

  static async getUserProfile(accessToken) {
    if (!this.isConfigured() || accessToken === 'mock_kick_access_token') {
      return { user_id: 'kick-mock-7711', name: 'kick_viewer_demo', email: 'viewer@kick.demo' };
    }

    const response = await fetch(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`KICK_USER_ERROR: Falha ao carregar perfil (${response.status})`);
    }

    const data = await response.json();
    const user = data?.data?.[0];
    if (!user) {
      throw new Error('KICK_USER_NOT_FOUND: Usuário não retornado pela Kick');
    }
    return user;
  }

  /**
   * App Access Token (client_credentials): identidade do próprio app LiveX
   * Games, usada para operações que não dependem de um usuário logado (ex.:
   * registrar a inscrição de webhooks de um streamer). Cacheado em memória
   * até pouco antes de expirar.
   */
  static async getAppAccessToken() {
    if (!this.isConfigured()) return 'mock_kick_app_token';

    if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 30_000) {
      return cachedAppToken.token;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET
    });

    const response = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `KICK_APP_TOKEN_ERROR: Falha ao obter app access token (${response.status}): ${errorData}`
      );
    }

    const data = await response.json();
    cachedAppToken = {
      token: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    return cachedAppToken.token;
  }

  /**
   * Registra a inscrição do app nos eventos de assinatura do canal de um
   * streamer específico. Deve ser chamado uma vez após o streamer vincular a
   * conta Kick (não exige que ele conceda events:subscribe, pois usamos App
   * Access Token + broadcaster_user_id explícito).
   */
  static async subscribeToChannelSubscriptionEvents(broadcasterUserId) {
    if (!this.isConfigured()) return { skipped: true, reason: 'KICK_NOT_CONFIGURED' };

    const appToken = await this.getAppAccessToken();
    const response = await fetch(`${API_BASE}/events/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        broadcaster_user_id: Number(broadcasterUserId),
        method: 'webhook',
        events: [
          { name: 'channel.subscription.new', version: 1 },
          { name: 'channel.subscription.renewal', version: 1 }
        ]
      })
    });

    if (!response.ok && response.status !== 204) {
      const errorData = await response.text().catch(() => '');
      console.warn(
        `[KickService] Falha ao inscrever eventos para broadcaster ${broadcasterUserId} (${response.status}): ${errorData}`
      );
      return { success: false, status: response.status };
    }
    return { success: true };
  }

  /**
   * Busca (e cacheia em memória) a chave pública RSA da Kick usada para
   * assinar payloads de webhook. Ver docs.kick.com/events/webhook-security.
   */
  static async getWebhookPublicKey() {
    if (cachedPublicKey) return cachedPublicKey;

    const response = await fetch(`${API_BASE}/public-key`);
    if (!response.ok) {
      throw new Error(`KICK_PUBLIC_KEY_ERROR: Falha ao obter chave pública (${response.status})`);
    }
    const data = await response.json();
    cachedPublicKey = data?.data?.public_key || data?.public_key;
    if (!cachedPublicKey) {
      throw new Error('KICK_PUBLIC_KEY_ERROR: Resposta sem public_key');
    }
    return cachedPublicKey;
  }

  /**
   * Verifica a assinatura RSA-SHA256 (PKCS#1 v1.5) de um webhook da Kick.
   * A string assinada é "{messageId}.{timestamp}.{rawBody}" e a assinatura
   * chega em Base64 no header Kick-Event-Signature.
   */
  static async verifyWebhookSignature(messageId, timestamp, rawBody, signatureBase64) {
    if (!messageId || !timestamp || !signatureBase64) return false;

    // A assinatura cobre o timestamp, mas assinatura válida não quer dizer
    // evento recente: sem esta janela, um webhook capturado uma vez valia para
    // sempre e podia ser reenviado à vontade. Cinco minutos é a folga usual para
    // atraso de rede e desvio de relógio entre os dois lados.
    const idadeMs = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(idadeMs) || Math.abs(idadeMs) > MAX_WEBHOOK_AGE_MS) {
      console.warn(`[KickService] Webhook fora da janela de validade (${timestamp}).`);
      return false;
    }

    const publicKey = await this.getWebhookPublicKey();
    const signedPayload = `${messageId}.${timestamp}.${rawBody}`;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedPayload);
    verifier.end();

    try {
      return verifier.verify(publicKey, Buffer.from(signatureBase64, 'base64'));
    } catch (err) {
      console.warn('[KickService] Falha ao verificar assinatura do webhook:', err.message);
      return false;
    }
  }

  /**
   * Processa channel.subscription.new / channel.subscription.renewal já
   * autenticados (assinatura verificada pelo controller antes de chamar
   * este método). Promove o espectador a subscriber (10 vidas) se ele já
   * tiver vinculado a mesma conta Kick à plataforma via OAuth.
   */
  static async processSubscriptionEvent(eventType, payload, io = null) {
    const subscriberKickId = payload?.subscriber?.user_id;
    const broadcasterKickId = payload?.broadcaster?.user_id;

    if (!subscriberKickId || !broadcasterKickId) {
      throw new Error('INVALID_PAYLOAD: subscriber.user_id/broadcaster.user_id ausentes');
    }

    const streamer = await UserModel.findByKickId(broadcasterKickId);
    if (!streamer) {
      // Canal não pertence a nenhum streamer cadastrado na plataforma (ou a
      // inscrição de webhook está desatualizada); nada a fazer.
      return { applied: false, reason: 'STREAMER_NOT_FOUND' };
    }

    const subscriber = await UserModel.findByKickId(subscriberKickId);
    if (!subscriber) {
      // Quem assinou na Kick ainda não vinculou essa conta à LiveX Games
      // (ou vinculou com um usuário diferente do assinante real).
      return { applied: false, reason: 'SUBSCRIBER_NOT_LINKED' };
    }

    await AuthService.linkStreamAccount(subscriber.id, {
      provider: 'kick',
      accountId: subscriber.kick_id,
      accountUsername: subscriber.kick_username,
      isSubscriber: true
    });

    if (io) {
      io.to(`user_${subscriber.id}`).emit('kick:subscription-confirmed', {
        eventType,
        streamerUsername: streamer.username
      });
    }

    return { applied: true, userId: subscriber.id, streamerId: streamer.id };
  }
}

module.exports = KickService;
