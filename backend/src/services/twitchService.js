/**
 * TwitchService - Integração Oficial com Twitch API (OAuth 2.0 + Helix)
 * Permite autenticação do espectador e verificação autoritativa de inscrição (Sub)
 */
const VALID_TWITCH_CLIENT_ID = 'kd1unb4gahabc4rr63680b7axtcf6u';
const DEFAULT_AUTH_ENDPOINT = 'https://id.twitch.tv/oauth2/authorize';

class TwitchService {
  static isConfigured() {
    const clientId = process.env.TWITCH_CLIENT_ID || VALID_TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    return Boolean(clientId && clientSecret && clientId !== 'DEMO_TWITCH_CLIENT_ID');
  }

  static getAuthEndpoint() {
    return process.env.TWITCH_AUTH_ENDPOINT || DEFAULT_AUTH_ENDPOINT;
  }

  static getRedirectUri(req = null) {
    if (process.env.TWITCH_REDIRECT_URI) {
      return process.env.TWITCH_REDIRECT_URI;
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
      return `${protocol}://${host}/api/auth/twitch/callback`;
    }
    if (process.env.NODE_ENV === 'production') {
      return 'https://livexgames.onrender.com/api/auth/twitch/callback';
    }
    return 'http://localhost:3000/api/auth/twitch/callback';
  }

  /**
   * Gera a URL para redirecionar o usuário para autorização na Twitch
   */
  static getAuthorizationUrl(state = '', req = null) {
    const clientId = process.env.TWITCH_CLIENT_ID || VALID_TWITCH_CLIENT_ID;
    const redirectUri = this.getRedirectUri(req);
    const authEndpoint = this.getAuthEndpoint();
    const scopes = ['user:read:subscriptions', 'user:read:email'].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state: state || 'livex_auth',
      force_verify: 'false'
    });

    return `${authEndpoint}?${params.toString()}`;
  }

  /**
   * Troca o authorization code pelo access token da Twitch
   */
  static async exchangeCodeForToken(code, redirectUri) {
    if (!this.isConfigured()) {
      return {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expires_in: 3600
      };
    }

    const params = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID || VALID_TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `TWITCH_TOKEN_ERROR: Falha ao obter token (${response.status}): ${errorData}`
      );
    }

    return await response.json();
  }

  /**
   * Obtém o perfil do usuário logado na Twitch
   */
  static async getUserProfile(accessToken) {
    if (!this.isConfigured() || accessToken === 'mock_access_token') {
      return {
        id: 'ttv-mock-9988',
        login: 'twitch_viewer_demo',
        display_name: 'TwitchViewerDemo',
        email: 'viewer@twitch.demo'
      };
    }

    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID || VALID_TWITCH_CLIENT_ID
      }
    });

    if (!response.ok) {
      throw new Error(`TWITCH_USER_ERROR: Falha ao carregar perfil (${response.status})`);
    }

    const data = await response.json();
    if (!data.data || !data.data[0]) {
      throw new Error('TWITCH_USER_NOT_FOUND: Usuário não retornado pela Twitch');
    }

    return data.data[0];
  }

  /**
   * Verifica se o usuário é inscrito (Sub) no canal do streamer
   */
  static async checkUserSubscription(accessToken, broadcasterId, userId) {
    // Em produção, nunca conceder status de "subscriber" sem verificação real: se a
    // integração Twitch não estiver configurada, falha fechado (isSub:false) para
    // impedir que uma configuração incompleta conceda benefícios indevidos.
    // Fora de produção, mantém o modo de simulação para desenvolvimento/testes.
    if (!this.isConfigured()) {
      return process.env.NODE_ENV === 'production'
        ? { isSub: false, tier: null }
        : { isSub: true, tier: '1000' };
    }

    if (!broadcasterId) {
      broadcasterId = process.env.TWITCH_BROADCASTER_ID;
    }

    if (!broadcasterId) {
      // Sem canal específico configurado: em produção, falha fechado; em dev, simula sucesso.
      return process.env.NODE_ENV === 'production'
        ? { isSub: false, tier: null }
        : { isSub: true, tier: '1000' };
    }

    const endpoint = `https://api.twitch.tv/helix/subscriptions/user?broadcaster_id=${broadcasterId}&user_id=${userId}`;
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID || VALID_TWITCH_CLIENT_ID
      }
    });

    if (response.status === 404) {
      return { isSub: false, tier: null };
    }

    if (!response.ok) {
      console.warn(`[TwitchService] Verificação de sub retornou status ${response.status}`);
      return { isSub: false, tier: null };
    }

    const result = await response.json();
    const isSub = Boolean(result.data && result.data.length > 0);
    const tier = isSub ? result.data[0].tier : null;

    return { isSub, tier };
  }
}

module.exports = TwitchService;
