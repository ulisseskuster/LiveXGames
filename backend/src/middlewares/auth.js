// @ts-check
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/secrets');
const UserModel = require('../models/userModel');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');
const { SESSION_COOKIE } = require('../config/session');

function tokenDoCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)) : '';
}

function tokenDaRequisicao(req) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  return bearer && bearer !== 'session' && bearer !== 'null' ? bearer : tokenDoCookie(req);
}

function requireAuth(req, res, next) {
  const token = tokenDaRequisicao(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Acesso negado: Token de autenticação não fornecido'
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido ou expirado'
    });
  }

  // Revogação de sessão (P1 do ESCALA.md): o token carrega a versão da sessão
  // ('tv'). Se o usuário fez logout/trocou a senha, a versão no banco avançou e
  // este token é rejeitado — mesmo sem expirar. Sem consultar o banco a cada
  // request, o logout não revogaria nada (P1 de operação do ESCALA.md).
  return UserModel.findById(decoded.sub)
    .then((user) => {
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Usuário não encontrado'
        });
      }
      if (Number(decoded.tv || 0) !== Number(user.tokenVersion || 0)) {
        return res.status(401).json({
          success: false,
          message: 'Sessão revogada. Faça login novamente.'
        });
      }
      req.user = {
        id: decoded.sub,
        username: decoded.username,
        role: decoded.role
      };
      return next();
    })
    .catch((err) => next(err));
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado: Permissões insuficientes'
      });
    }
    next();
  };
}

/**
 * O corpo fica todo dentro de um try/catch porque o Express 4 não captura
 * rejeição de função async: uma consulta que falhasse aqui virava unhandled
 * rejection, e o Node encerra o processo nesse caso. Como esta rota é pública e
 * não autenticada (quem chama é o gateway), uma instabilidade do banco durante
 * uma entrega de webhook derrubava o serviço inteiro. next(err) entrega o erro
 * ao tratador global, que responde 500.
 */
function validateStreamerWebhookSignature(provider) {
  return async (req, res, next) => {
    try {
      const { streamerId } = req.params;

      // Suporta cabeçalho oficial da PixGG (x-pixgg-signature-256) ou o legado (x-pixgg-signature)
      const signature =
        provider === 'pixgg'
          ? req.headers['x-pixgg-signature-256'] || req.headers['x-pixgg-signature']
          : req.headers['x-livepix-signature-256'] || req.headers['x-livepix-signature'];

      const headerLabel = provider === 'pixgg' ? 'x-pixgg-signature-256' : 'x-livepix-signature';

      if (!signature) {
        return res.status(401).json({
          success: false,
          message: `Assinatura do webhook ausente (cabeçalho ${headerLabel})`
        });
      }

      const config = await StreamerPaymentConfigModel.findByStreamerId(streamerId);

      // Lista de segredos candidatos (client_secret da API ou webhook_secret individual)
      const candidateSecrets = [];
      if (config) {
        if (provider === 'pixgg') {
          if (config.pixgg_client_secret) candidateSecrets.push(config.pixgg_client_secret);
          if (config.pixgg_webhook_secret) candidateSecrets.push(config.pixgg_webhook_secret);
        } else {
          if (config.livepix_webhook_secret) candidateSecrets.push(config.livepix_webhook_secret);
          if (config.livepix_client_secret) candidateSecrets.push(config.livepix_client_secret);
        }
      }

      if (candidateSecrets.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Streamer não encontrado ou sem webhook configurado'
        });
      }

      const bodyContent = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

      // Normaliza assinatura enviada: aceita formato 'sha256=<hex>' da PixGG ou hex direto
      const cleanReceived = signature.startsWith('sha256=') ? signature.slice(7) : signature;

      let isValid = false;
      for (const secret of candidateSecrets) {
        const expectedHex = crypto.createHmac('sha256', secret).update(bodyContent).digest('hex');

        const sigBuffer = Buffer.from(cleanReceived, 'hex');
        const expBuffer = Buffer.from(expectedHex, 'hex');

        if (sigBuffer.length === expBuffer.length && crypto.timingSafeEqual(sigBuffer, expBuffer)) {
          isValid = true;
          break;
        }
      }

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Assinatura HMAC inválida'
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function optionalAuth(req, res, next) {
  const token = tokenDaRequisicao(req);

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: decoded.sub,
        username: decoded.username,
        role: decoded.role
      };
    } catch (e) {}
  }
  return next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  validateStreamerWebhookSignature
};
