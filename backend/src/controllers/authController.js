const jwt = require('jsonwebtoken');
const AuthService = require('../services/authService');
const OAuthStateStore = require('../services/oauthStateStore');
const { JWT_SECRET } = require('../config/secrets');
const { ok, created, fail } = require('../utils/response');
const { SESSION_COOKIE, sessionCookieOptions } = require('../config/session');

// Atributo nonce da CSP para os <script> inline destas paginas geradas pelo
// backend. res.locals e populado pelo middleware em server.js; o fallback vazio
// cobre chamadas diretas ao controller (testes) sem quebrar a renderizacao.
const nonceAttr = (res) =>
  res.locals && res.locals.cspNonce ? ` nonce="${res.locals.cspNonce}"` : '';

// A sessão vive só neste cookie HttpOnly. O JWT saiu do corpo da resposta de
// login e cadastro (auditoria H-01): cópia no JSON fica ao alcance de qualquer
// script da página, extensão ou log de proxy, e o HttpOnly não protege cópia.
function emitirCookieDeSessao(res, token) {
  if (token) res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Identifica quem iniciou um fluxo de OAuth, a partir do cookie de sessao.
 *
 * Estas rotas sao navegacao de pagina (uma popup indo para o provedor), entao
 * nao carregam o header Authorization e recebiam o JWT em `?token=`. O token nao
 * chegava a Twitch nem a Kick, mas ficava na URL desta requisicao: log de acesso
 * do provedor de hospedagem, historico do navegador e cabecalho Referer da
 * navegacao seguinte. Com validade de 24h, cada um desses lugares guardava uma
 * credencial viva. Pelo cookie, nao ha nada na URL.
 *
 * Sem identidade, o fluxo segue como convidado e a vinculacao nao acontece ao
 * final -- mesmo comportamento que ja existia para token invalido.
 */
function usuarioDoFluxoOAuth(req) {
  const cabecalho = req.headers.cookie || '';
  const par = cabecalho.split(';').find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!par) return null;

  try {
    const token = decodeURIComponent(par.split('=').slice(1).join('=').trim());
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.sub || decoded.id || null;
  } catch (e) {
    return null;
  }
}

class AuthController {
  static async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return fail(res, 400, 'Nome de usuário e senha são obrigatórios');
      }

      const { token, ...sessao } = await AuthService.login(username, password);
      emitirCookieDeSessao(res, token);
      return ok(res, sessao, 'Login realizado com sucesso');
    } catch (error) {
      if (
        error.message === 'USER_NOT_FOUND' ||
        error.message === 'INVALID_PASSWORD' ||
        error.message === 'INVALID_CREDENTIALS'
      ) {
        return fail(res, 401, 'Credenciais inválidas');
      }
      return fail(res, 500, 'Erro ao autenticar usuário', error.message);
    }
  }

  /**
   * Encerra a sessão apagando o cookie E revogando o token atual. O cookie é
   * HttpOnly, então o cliente não consegue removê-lo sozinho; e sem revogação,
   * um token copiado (log, extensão) seguiria vivo por 24h. Incrementar
   * token_version invalida todos os JWTs emitidos antes (P1 do ESCALA.md).
   */
  static async logout(req, res) {
    try {
      // req.user só é preenchido pelo requireAuth; logout é rota aberta (apaga o
      // cookie de qualquer forma), então a revogação é best-effort.
      const userId = (req.user && req.user.id) || usuarioDoFluxoOAuth(req);
      if (userId) {
        const UserModel = require('../models/userModel');
        await UserModel.incrementarTokenVersion(userId).catch(() => {});
      }
    } catch (e) {
      // Revogar é best-effort: o cookie é sempre apagado.
    }
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    return ok(res, null, 'Sessão encerrada');
  }

  static async register(req, res) {
    try {
      const { name, phone, username, email, password, birthDate, acceptedTerms } = req.body;
      if (!username || !email || !password) {
        return fail(res, 400, 'username, email e password são obrigatórios');
      }

      // O cabeçalho x-test-reset (ou resetIfExists no corpo) apagava a conta de
      // mesmo nome antes de registrar, sem autenticação, barrado apenas por
      // NODE_ENV !== 'production'. Removido: qualquer requisição anônima podia
      // apagar uma conta existente sempre que a variável não estivesse definida
      // exatamente como 'production'.
      const { token, ...sessao } = await AuthService.register({
        name,
        phone,
        username,
        email,
        password,
        birthDate,
        acceptedTerms
      });
      emitirCookieDeSessao(res, token);
      return created(res, sessao, 'Usuário registrado com sucesso');
    } catch (error) {
      if (error.message === 'USERNAME_EXISTS') {
        return fail(res, 409, 'Nome de usuário já cadastrado');
      }
      if (error.message === 'EMAIL_EXISTS') {
        return fail(res, 409, 'E-mail já cadastrado');
      }
      if (error.message === 'WEAK_PASSWORD') {
        return fail(res, 400, 'A senha deve conter no mínimo 6 caracteres');
      }
      if (error.message === 'INVALID_PASSWORD_LENGTH') {
        return fail(res, 400, 'A senha deve conter no máximo 200 caracteres');
      }
      if (error.message === 'TERMS_NOT_ACCEPTED') {
        return fail(res, 400, 'É necessário aceitar os Termos de Uso para criar a conta');
      }
      if (error.message === 'INVALID_BIRTH_DATE') {
        return fail(res, 400, 'Informe uma data de nascimento válida');
      }
      if (error.message === 'UNDERAGE') {
        return fail(res, 403, 'É necessário ter 18 anos ou mais para usar a plataforma');
      }
      if (error.message === 'INVALID_EMAIL') {
        return fail(res, 400, 'Informe um e-mail válido (máximo de 160 caracteres)');
      }
      if (error.message === 'INVALID_NAME_LENGTH') {
        return fail(res, 400, 'O nome deve ter no máximo 120 caracteres');
      }
      if (error.message === 'INVALID_PHONE_LENGTH') {
        return fail(res, 400, 'O telefone deve ter no máximo 30 caracteres');
      }
      if (error.message === 'INVALID_USERNAME') {
        return fail(
          res,
          400,
          'Nome de usuário deve conter de 3 a 32 caracteres (letras, números ou "_")'
        );
      }
      if (error.message === 'INVALID_INPUT') {
        return fail(res, 400, 'Dados de cadastro inválidos');
      }
      return fail(res, 500, 'Erro ao registrar usuário', error.message);
    }
  }

  static async me(req, res) {
    try {
      const userId = req.user.id;
      const result = await AuthService.getProfile(userId);
      return ok(res, result, 'Perfil carregado com sucesso');
    } catch (error) {
      if (error.message === 'USER_NOT_FOUND') {
        return fail(res, 404, 'Usuário não encontrado');
      }
      return fail(res, 500, 'Erro ao obter perfil do usuário', error.message);
    }
  }

  static async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { name, phone } = req.body;
      const result = await AuthService.updateProfile(userId, { name, phone });
      return ok(res, result, 'Perfil atualizado com sucesso');
    } catch (error) {
      if (error.message === 'INVALID_NAME') {
        return fail(res, 400, 'Nome deve conter no mínimo 3 caracteres');
      }
      if (error.message === 'USER_NOT_FOUND') {
        return fail(res, 404, 'Usuário não encontrado');
      }
      return fail(res, 500, 'Erro ao atualizar perfil', error.message);
    }
  }

  static async unlinkStream(req, res) {
    try {
      const userId = req.user.id;
      const { provider } = req.body;
      if (!provider) {
        return fail(res, 400, 'provider é obrigatório');
      }

      const result = await AuthService.unlinkStreamAccount(userId, provider);
      return ok(res, result, `Conta da ${provider.toUpperCase()} desvinculada com sucesso!`);
    } catch (error) {
      if (error.message === 'INVALID_PROVIDER') {
        return fail(res, 400, 'Provedor inválido. Escolha "twitch" ou "kick"');
      }
      if (error.message === 'USER_NOT_FOUND') {
        return fail(res, 404, 'Usuário não encontrado');
      }
      return fail(res, 500, 'Erro ao desvincular conta de transmissão', error.message);
    }
  }

  /**
   * Pede a redefinição de senha. Responde 200 sempre, exista a conta ou não —
   * uma resposta diferente por endereço inexistente transformaria esta rota
   * num verificador de quem tem cadastro.
   */
  static async forgotPassword(req, res) {
    try {
      const { identifier } = req.body || {};
      await AuthService.requestPasswordReset(identifier);
      return ok(
        res,
        null,
        'Se houver uma conta com esses dados, enviamos um link de redefinição para o e-mail cadastrado.'
      );
    } catch (error) {
      console.error('[ForgotPassword]', error.message);
      return ok(
        res,
        null,
        'Se houver uma conta com esses dados, enviamos um link de redefinição para o e-mail cadastrado.'
      );
    }
  }

  static async resetPassword(req, res) {
    try {
      const { token, password } = req.body || {};
      await AuthService.resetPassword(token, password);
      return ok(res, null, 'Senha redefinida com sucesso! Faça login com a nova senha.');
    } catch (error) {
      if (error.message === 'WEAK_PASSWORD') {
        return fail(res, 400, 'A senha deve conter no mínimo 6 caracteres');
      }
      if (error.message === 'INVALID_PASSWORD_LENGTH') {
        return fail(res, 400, 'A senha deve conter no máximo 200 caracteres');
      }
      if (error.message === 'INVALID_OR_EXPIRED_TOKEN') {
        return fail(res, 400, 'Este link de redefinição é inválido ou já expirou. Peça um novo.');
      }
      return fail(res, 500, 'Erro ao redefinir a senha', error.message);
    }
  }

  static async verifyEmail(req, res) {
    try {
      const token = req.body?.token || req.query.token;
      await AuthService.verifyEmail(token);
      return ok(res, null, 'E-mail confirmado com sucesso!');
    } catch (error) {
      if (error.message === 'INVALID_OR_EXPIRED_TOKEN') {
        return fail(res, 400, 'Este link de confirmação é inválido ou já expirou.');
      }
      if (error.message === 'EMAIL_CHANGED') {
        return fail(
          res,
          400,
          'O e-mail da conta mudou depois deste pedido. Solicite um novo link.'
        );
      }
      return fail(res, 500, 'Erro ao confirmar o e-mail', error.message);
    }
  }

  static async resendVerification(req, res) {
    try {
      const resultado = await AuthService.reenviarVerificacao(req.user.id);
      return ok(
        res,
        resultado,
        resultado.jaVerificado
          ? 'Seu e-mail já está confirmado.'
          : 'Enviamos um novo link de confirmação.'
      );
    } catch (error) {
      return fail(res, 500, 'Erro ao reenviar a confirmação', error.message);
    }
  }

  static async acceptTerms(req, res) {
    try {
      const { birthDate } = req.body || {};
      const result = await AuthService.aceitarTermos(req.user.id, birthDate);
      return ok(res, result, 'Termos aceitos com sucesso!');
    } catch (error) {
      if (error.message === 'INVALID_BIRTH_DATE') {
        return fail(res, 400, 'Informe uma data de nascimento válida');
      }
      if (error.message === 'UNDERAGE') {
        return fail(res, 403, 'É necessário ter 18 anos ou mais para usar a plataforma');
      }
      return fail(res, 500, 'Erro ao registrar o aceite dos termos', error.message);
    }
  }

  static async twitchAuthorize(req, res) {
    try {
      const TwitchService = require('../services/twitchService');

      // A identidade sai do cookie de sessão e vira um "state" opaco de uso
      // único: nada de token na URL, nem repassado à Twitch.
      const userId = usuarioDoFluxoOAuth(req);

      const state = await OAuthStateStore.createState(userId);
      const isConfigured = TwitchService.isConfigured();
      const authUrl = TwitchService.getAuthorizationUrl(state, req);

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return ok(res, {
          url: authUrl,
          configured: isConfigured,
          clientId: process.env.TWITCH_CLIENT_ID || 'kd1unb4gahabc4rr63680b7axtcf6u',
          redirectUri: TwitchService.getRedirectUri(req),
          authEndpoint: TwitchService.getAuthEndpoint()
        });
      }

      // Se a integração da Twitch não estiver configurada com chaves de produção no .env,
      // utiliza modo seguro de fallback para não quebrar a tela do usuário com 400 da Twitch.
      // Modo de simulação é de desenvolvimento, não de produção.
      //
      // Sem credenciais, o fluxo pula o provedor e volta direto pelo callback com
      // um code falso, e o perfil "obtido" e uma identidade fixa embutida no
      // serviço. Em produção isso vinculava TODAS as contas ao mesmo id de
      // Twitch e anunciava "conta conectada" para uma ligação que não existe.
      // Falha fechado, mesmo princípio que checkUserSubscription já aplicava.
      //
      // O erro volta pela própria rota de callback para reaproveitar a página que
      // avisa o app e fecha a popup.
      const redirectUri = TwitchService.getRedirectUri(req);
      if (!isConfigured) {
        if (process.env.NODE_ENV === 'production') {
          const motivo = encodeURIComponent(
            'A integração com a Twitch não está configurada neste servidor. Avise a equipe da LiveX Games.'
          );
          return res.redirect(`${redirectUri}?error=NOT_CONFIGURED&error_description=${motivo}`);
        }
        return res.redirect(
          `${redirectUri}?code=mock_oauth_code&state=${encodeURIComponent(state)}`
        );
      }

      return res.redirect(authUrl);
    } catch (error) {
      return fail(res, 500, 'Erro ao iniciar autorização da Twitch', error.message);
    }
  }

  static async twitchCallback(req, res) {
    const respondWithError = (errorMsg) => {
      return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Twitch OAuth - Aviso</title></head>
<body style="font-family:sans-serif;background:#0d0e15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;">
  <script${nonceAttr(res)}>
    (function () {
      var payload = { type: 'TWITCH_AUTH_ERROR', error: ${JSON.stringify(errorMsg)} };
      // Canal de reserva: sobrevive mesmo se o provedor de OAuth tiver
      // desvinculado window.opener via Cross-Origin-Opener-Policy.
      try { localStorage.setItem('livex_oauth_result', JSON.stringify(payload)); } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      var btn = document.getElementById('closeWindowBtn');
      if (btn) btn.addEventListener('click', function () { window.close(); });
      try { window.close(); } catch (e) {}
      // Se esta janela não foi aberta via script (window.close() é ignorado
      // pelo navegador nesse caso), continua viva até aqui: navega para o
      // app normalmente em vez de deixar a tela de callback parada.
      setTimeout(function () {
        window.location.href = '/?twitch_error=' + encodeURIComponent(${JSON.stringify(errorMsg)});
      }, 400);
    })();
  </script>
  <div style="background:#161824;border:1px solid rgba(255,51,102,0.4);border-radius:12px;padding:28px 36px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
    <h3 style="color:#ff3366;margin:0 0 10px 0;">Autorização Twitch Não Concluída</h3>
    <p style="color:#ccc;font-size:14px;line-height:1.5;margin-bottom:20px;">${errorMsg}</p>
    <button id="closeWindowBtn" style="background:#9146ff;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;">Fechar Janela</button>
  </div>
</body>
</html>`);
    };

    try {
      const TwitchService = require('../services/twitchService');
      const { code, state, error: twitchError, error_description } = req.query;

      if (twitchError) {
        return respondWithError(error_description || twitchError);
      }

      if (!code) {
        return respondWithError('MISSING_CODE: Código de autorização não retornado pela Twitch');
      }

      const redirectUri = TwitchService.getRedirectUri(req);
      const tokenData = await TwitchService.exchangeCodeForToken(code, redirectUri);
      const twitchUser = await TwitchService.getUserProfile(tokenData.access_token);
      const subStatus = await TwitchService.checkUserSubscription(
        tokenData.access_token,
        null,
        twitchUser.id
      );

      // Recupera o userId vinculado ao state opaco gerado em twitchAuthorize (uso único)
      const userId = await OAuthStateStore.consumeState(state);
      if (userId) {
        try {
          await AuthService.linkStreamAccount(userId, {
            provider: 'twitch',
            accountId: twitchUser.id,
            accountUsername: twitchUser.login,
            isSubscriber: subStatus.isSub
          });
        } catch (linkErr) {
          console.warn('[TwitchCallback] Falha ao vincular conta Twitch:', linkErr.message);
        }
      }

      const subParam = subStatus.isSub ? 'true' : 'false';
      return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Twitch OAuth - Sucesso</title></head>
<body style="font-family:sans-serif;background:#0d0e15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;">
  <script${nonceAttr(res)}>
    (function () {
      var payload = {
        type: 'TWITCH_AUTH_SUCCESS',
        username: ${JSON.stringify(twitchUser.login)},
        isSub: ${subStatus.isSub ? 'true' : 'false'}
      };
      // Canal de reserva: sobrevive mesmo se o provedor de OAuth tiver
      // desvinculado window.opener via Cross-Origin-Opener-Policy.
      try { localStorage.setItem('livex_oauth_result', JSON.stringify(payload)); } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      var btn = document.getElementById('closeWindowBtn');
      if (btn) btn.addEventListener('click', function () { window.close(); });
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        window.location.href = '/?twitch_linked=true&username=' + encodeURIComponent(${JSON.stringify(twitchUser.login)}) + '&is_sub=${subParam}';
      }, 400);
    })();
  </script>
  <div style="background:#161824;border:1px solid rgba(0,255,136,0.4);border-radius:12px;padding:28px 36px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div style="font-size:36px;margin-bottom:12px;">🟣</div>
    <h3 style="color:#00ff88;margin:0 0 10px 0;">Twitch Conectada!</h3>
    <p style="color:#ccc;font-size:14px;margin-bottom:20px;">Conta @${twitchUser.login} vinculada com sucesso ao LiveX Games.</p>
    <p style="color:#888;font-size:12px;">Retornando à aplicação...</p>
  </div>
</body>
</html>`);
    } catch (error) {
      console.error('[TwitchCallback] Erro no callback:', error.message);
      return respondWithError(error.message);
    }
  }

  static async kickAuthorize(req, res) {
    try {
      const KickService = require('../services/kickService');

      // Mesmo princípio do fluxo da Twitch: a identidade vem do cookie de sessão
      // e vira um state opaco de uso único. O code_verifier do PKCE também
      // precisa sobreviver ao round-trip, então viaja junto no state.
      const userId = usuarioDoFluxoOAuth(req);

      const { codeVerifier, codeChallenge } = KickService.generatePkcePair();
      const state = await OAuthStateStore.createState(userId, { codeVerifier });
      const isConfigured = KickService.isConfigured();
      const authUrl = KickService.getAuthorizationUrl(state, codeChallenge, req);

      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return ok(res, {
          url: authUrl,
          configured: isConfigured,
          redirectUri: KickService.getRedirectUri(req)
        });
      }

      // Modo de simulação é de desenvolvimento, não de produção.
      //
      // Sem credenciais, o fluxo pula o provedor e volta direto pelo callback com
      // um code falso, e o perfil "obtido" e uma identidade fixa embutida no
      // serviço. Em produção isso vinculava TODAS as contas ao mesmo id de
      // Kick e anunciava "conta conectada" para uma ligação que não existe.
      // Falha fechado, mesmo princípio que checkUserSubscription já aplicava.
      //
      // O erro volta pela própria rota de callback para reaproveitar a página que
      // avisa o app e fecha a popup.
      const redirectUri = KickService.getRedirectUri(req);
      if (!isConfigured) {
        if (process.env.NODE_ENV === 'production') {
          const motivo = encodeURIComponent(
            'A integração com a Kick não está configurada neste servidor. Avise a equipe da LiveX Games.'
          );
          return res.redirect(`${redirectUri}?error=NOT_CONFIGURED&error_description=${motivo}`);
        }
        return res.redirect(
          `${redirectUri}?code=mock_oauth_code&state=${encodeURIComponent(state)}`
        );
      }

      return res.redirect(authUrl);
    } catch (error) {
      return fail(res, 500, 'Erro ao iniciar autorização da Kick', error.message);
    }
  }

  static async kickCallback(req, res) {
    const respondWithError = (errorMsg) => {
      return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Kick OAuth - Aviso</title></head>
<body style="font-family:sans-serif;background:#0d0e15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;">
  <script${nonceAttr(res)}>
    (function () {
      var payload = { type: 'KICK_AUTH_ERROR', error: ${JSON.stringify(errorMsg)} };
      // Canal de reserva: sobrevive mesmo se o provedor de OAuth tiver
      // desvinculado window.opener via Cross-Origin-Opener-Policy.
      try { localStorage.setItem('livex_oauth_result', JSON.stringify(payload)); } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      var btn = document.getElementById('closeWindowBtn');
      if (btn) btn.addEventListener('click', function () { window.close(); });
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        window.location.href = '/?kick_error=' + encodeURIComponent(${JSON.stringify(errorMsg)});
      }, 400);
    })();
  </script>
  <div style="background:#161824;border:1px solid rgba(255,51,102,0.4);border-radius:12px;padding:28px 36px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
    <h3 style="color:#ff3366;margin:0 0 10px 0;">Autorização Kick Não Concluída</h3>
    <p style="color:#ccc;font-size:14px;line-height:1.5;margin-bottom:20px;">${errorMsg}</p>
    <button id="closeWindowBtn" style="background:#53fc18;color:#000;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;">Fechar Janela</button>
  </div>
</body>
</html>`);
    };

    try {
      const KickService = require('../services/kickService');
      const { code, state, error: kickError, error_description } = req.query;

      if (kickError) {
        return respondWithError(error_description || kickError);
      }
      if (!code) {
        return respondWithError('MISSING_CODE: Código de autorização não retornado pela Kick');
      }

      const { userId, extra } = await OAuthStateStore.consumeStateWithExtra(state);
      const codeVerifier = extra?.codeVerifier;
      if (!codeVerifier && KickService.isConfigured()) {
        return respondWithError(
          'MISSING_VERIFIER: Sessão de autorização expirada, tente novamente'
        );
      }

      const redirectUri = KickService.getRedirectUri(req);
      const tokenData = await KickService.exchangeCodeForToken(code, redirectUri, codeVerifier);
      const kickUser = await KickService.getUserProfile(tokenData.access_token);

      // A Kick não tem um endpoint para consultar "é sub?" sob demanda: o
      // status inicial fica false e só é promovido quando o webhook de
      // channel.subscription.new/.renewal chegar (ver webhookController).
      if (userId) {
        try {
          const linkResult = await AuthService.linkStreamAccount(userId, {
            provider: 'kick',
            accountId: kickUser.user_id,
            accountUsername: kickUser.name,
            isSubscriber: false
          });

          // Se quem vinculou é streamer/admin (dono de canal na plataforma),
          // registra a inscrição de webhooks para o canal dele na Kick.
          if (linkResult?.user?.role === 'streamer' || linkResult?.user?.role === 'admin') {
            KickService.subscribeToChannelSubscriptionEvents(kickUser.user_id).catch((err) =>
              console.warn('[KickCallback] Falha ao inscrever eventos de canal:', err.message)
            );
          }
        } catch (linkErr) {
          console.warn('[KickCallback] Falha ao vincular conta Kick:', linkErr.message);
        }
      }

      return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Kick OAuth - Sucesso</title></head>
<body style="font-family:sans-serif;background:#0d0e15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;">
  <script${nonceAttr(res)}>
    (function () {
      var payload = {
        type: 'KICK_AUTH_SUCCESS',
        username: ${JSON.stringify(kickUser.name)}
      };
      // Canal de reserva: sobrevive mesmo se o provedor de OAuth tiver
      // desvinculado window.opener via Cross-Origin-Opener-Policy.
      try { localStorage.setItem('livex_oauth_result', JSON.stringify(payload)); } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      var btn = document.getElementById('closeWindowBtn');
      if (btn) btn.addEventListener('click', function () { window.close(); });
      try { window.close(); } catch (e) {}
      setTimeout(function () {
        window.location.href = '/?kick_linked=true&username=' + encodeURIComponent(${JSON.stringify(kickUser.name)});
      }, 400);
    })();
  </script>
  <div style="background:#161824;border:1px solid rgba(83,252,24,0.4);border-radius:12px;padding:28px 36px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div style="font-size:36px;margin-bottom:12px;">🟢</div>
    <h3 style="color:#53fc18;margin:0 0 10px 0;">Kick Conectada!</h3>
    <p style="color:#ccc;font-size:14px;margin-bottom:20px;">Conta @${kickUser.name} vinculada com sucesso ao LiveX Games.</p>
    <p style="color:#888;font-size:12px;">Retornando à aplicação...</p>
  </div>
</body>
</html>`);
    } catch (error) {
      console.error('[KickCallback] Erro no callback:', error.message);
      return respondWithError(error.message);
    }
  }
}

module.exports = AuthController;
