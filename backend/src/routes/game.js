const express = require('express');
const GameController = require('../controllers/gameController');
const GameRunController = require('../controllers/gameRunController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/history', requireAuth, GameController.history);

// Jet, Neon e Void: a rodada é sorteada e liquidada no POST /runs; reveal entrega
// o filme e finish devolve o recibo salvo. Sandbox: finish manda o log e o
// servidor verifica por replay.
router.post('/runs', requireAuth, GameRunController.iniciar);
router.get('/runs/:runId/reveal', requireAuth, GameRunController.revelar);
router.post('/runs/:runId/finish', requireAuth, GameRunController.finalizar);

module.exports = router;
