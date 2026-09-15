const express = require('express');
const LeaderboardController = require('../controllers/leaderboardController');

const router = express.Router();

// Ranking de jogadores por jogo/período: /weekly, /monthly ou /all
// (ver LeaderboardService.PERIODOS).
router.get('/:periodo', LeaderboardController.get);

// Ranking de streamers por atividade do canal (rodadas + doações no período).
// Registrado ANTES de '/:periodo' seria colidir — na verdade precisa vir depois
// porque '/:periodo' casaria 'streamers' como período. Este padrão é seguro:
// 'streamers' não é um período válido, então o caso 'streamers/weekly' passa
// pelo prefixo fixo primeiro.
router.get('/streamers/:periodo', LeaderboardController.streamers);

module.exports = router;
