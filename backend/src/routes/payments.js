const express = require('express');
const PaymentController = require('../controllers/paymentController');
const { optionalAuth, requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/donate', optionalAuth, PaymentController.donate);
// Ferramenta do Centro de Simulação & Testes: credita moedas na carteira do
// próprio solicitante, nunca em um userId arbitrário do corpo da requisição.
// Como é uma fonte de moeda, fica restrita a streamers e administradores em
// qualquer ambiente — condicionar a checagem a NODE_ENV deixava a emissão de
// moedas aberta a qualquer viewer autenticado sempre que a variável não
// estivesse definida como 'production' (mesma falha já corrigida em dev.js).
// /simulate emite moeda sem contrapartida em Pix. Como a carteira é única e
// fungível entre canais, uma conta de streamer emitia moeda no próprio canal e
// resgatava brinde FÍSICO de um terceiro — o teto de R$ 5.000 por chamada só
// segurava o volume, e dependia do rate limiter, que era contornável por
// cabeçalho. É ferramenta de demonstração: fora do ar em produção.
//
// A rota continua registrada para responder com uma mensagem que o Centro de
// Simulação consegue exibir, em vez do 404 cru do Express.
function blockInProduction(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'O simulador de doações está disponível apenas em ambiente de testes.'
    });
  }
  return next();
}

router.post(
  '/simulate',
  blockInProduction,
  requireAuth,
  requireRole(['streamer', 'admin']),
  PaymentController.simulate
);

module.exports = router;
