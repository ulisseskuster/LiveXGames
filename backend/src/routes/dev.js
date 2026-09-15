const express = require('express');
const LivePixService = require('../services/livepixService');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');
const UserModel = require('../models/userModel');
const { ok, fail } = require('../utils/response');
const { optionalAuth, requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

/**
 * Mesma guarda do simulador de doações (ver routes/payments.js): ferramenta de
 * demonstração não atende em produção.
 */
function blockInProduction(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'O Centro de Simulação está disponível apenas em ambiente de testes.'
    });
  }
  return next();
}

/**
 * Ferramenta de QA/teste: assina no servidor (usando o segredo real do streamer,
 * nunca exposto ao cliente) um payload de webhook, para uso pelo Dock de Simulação
 * e pelo painel de testes ponta a ponta (/tests.html). Em produção, é restrito
 * ao próprio streamer autenticado ou administradores.
 */
router.post('/sign-webhook', optionalAuth, async (req, res, next) => {
  const { payload, provider = 'livepix', streamerId } = req.body || {};
  if (!payload || typeof payload !== 'object') {
    return fail(res, 400, 'payload é obrigatório');
  }
  if (!streamerId) {
    return fail(res, 400, 'streamerId é obrigatório');
  }

  // Este endpoint assina payloads com o segredo real do streamer: quem obtém uma
  // assinatura válida consegue forjar um webhook de doação e creditar fichas.
  // A verificação vale em qualquer ambiente — condicioná-la a NODE_ENV deixava o
  // gerador de assinaturas aberto a requisições anônimas sempre que a variável
  // não estivesse definida como 'production'. Testes locais autenticam como o
  // streamer dono ou como admin, igual em produção.
  const isOwnerStreamer = req.user && req.user.role === 'streamer' && req.user.id === streamerId;
  const isAdmin = req.user && req.user.role === 'admin';
  if (!isOwnerStreamer && !isAdmin) {
    return fail(
      res,
      403,
      'Acesso restrito: apenas o próprio streamer autenticado ou administradores podem gerar assinaturas de teste'
    );
  }

  const normalizedProvider = provider === 'pixgg' ? 'pixgg' : 'livepix';

  // try/catch obrigatório: o Express 4 não captura rejeição de função async, e
  // uma rejeição solta encerra o processo no Node.
  try {
    const config = await StreamerPaymentConfigModel.ensureSecrets(streamerId);
    const secret =
      normalizedProvider === 'pixgg' ? config.pixgg_webhook_secret : config.livepix_webhook_secret;
    const signature = LivePixService.generateSignature(payload, secret, normalizedProvider);
    return ok(res, { signature }, 'Assinatura gerada com sucesso');
  } catch (err) {
    return next(err);
  }
});

/**
 * Ajusta as vidas do próprio usuário, para o Centro de Simulação.
 *
 * Os botões "Restaurar Vidas" e "Zerar Vidas" mexiam apenas em
 * `state.user.lives` no navegador. O contador mudava na tela e o servidor
 * seguia com o valor antigo, então "Zerar Vidas" não testava a recusa de voo
 * (o backend ainda tinha vidas) e "Restaurar Vidas" produzia uma decolagem
 * recusada com NO_LIVES_REMAINING logo depois. Um painel de teste que mente
 * sobre o estado do servidor é pior que não ter painel: valida o que não existe.
 */
router.post(
  '/lives',
  blockInProduction,
  requireAuth,
  requireRole(['streamer', 'admin']),
  async (req, res, next) => {
    const { action } = req.body || {};
    if (!['refill', 'drain'].includes(action)) {
      return fail(res, 400, 'action deve ser "refill" ou "drain"');
    }

    try {
      const maxLives = UserModel.getRoleMaxLives(req.user.role);
      const resultado = await UserModel.setLives(req.user.id, action === 'refill' ? maxLives : 0);
      if (!resultado) return fail(res, 404, 'Usuário não encontrado');

      return ok(
        res,
        { lives: resultado.lives, maxLives: resultado.max_lives },
        action === 'refill' ? 'Vidas restauradas para o máximo' : 'Vidas zeradas'
      );
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
