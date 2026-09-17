const GameRunService = require('../services/gameRunService');
const { ok, fail } = require('../utils/response');

/**
 * Tradução dos erros do GameRunService para HTTP. Ordem importa: o primeiro
 * padrão que casar decide. Mensagens para o jogador, não para quem depura — o
 * código técnico vai no campo de detalhe (só fora de produção, ver utils/response).
 */
const ERROS = [
  [/^INVALID_STREAMER$/, 400, 'Selecione um canal de streamer válido'],
  [/^INVALID_GAME_ID/, 400, 'Jogo indisponível'],
  [/^INVALID_LOADOUT$/, 400, 'Equipe até 3 itens diferentes'],
  [/^ITEM_NOT_FOUND/, 400, 'Item não encontrado na loja'],
  [/^ITEM_WRONG_GAME/, 400, 'Esse item é de outro jogo'],
  [/^ITEM_NOT_EQUIPPABLE/, 400, 'Esse item não é equipável na partida'],
  [/^ITEM_NOT_IN_INVENTORY/, 400, 'Você não tem esse item no inventário'],
  [/^NO_LIVES_REMAINING$/, 403, 'Você não possui vidas restantes para jogar agora'],
  [
    /^RUN_ALREADY_OPEN$/,
    409,
    'Sua partida anterior ainda está sendo verificada. Tente em instantes.'
  ],
  [/^SIM_UNAVAILABLE$/, 503, 'Os jogos estão sendo atualizados. Tente em instantes.'],
  [/^RUN_NOT_FOUND$/, 404, 'Partida não encontrada'],
  [/^INVALID_LOG$/, 400, 'Registro da partida inválido'],
  [/^RUN_EXPIRED$/, 410, 'A partida expirou. Seus itens voltaram ao inventário.'],
  [/^RUN_ALREADY_FINISHED$/, 409, 'Essa partida já foi encerrada'],
  [/^RUN_NOT_REVEALABLE$/, 409, 'Essa partida não pode mais ser retomada'],
  [
    /^SIM_VERSION_CHANGED$/,
    409,
    'O jogo foi atualizado durante a sua partida. Vida e itens foram devolvidos.'
  ],
  [
    /^VERIFICATION_FAILED$/,
    503,
    'Não foi possível verificar a partida agora. Vida e itens foram devolvidos.'
  ],
  [/^VERIFIER_QUEUE_FULL$/, 503, 'Muitas partidas em andamento. Tente novamente em instantes.'],
  [
    /^(GENERATION_FAILED|RUN_ABANDONED)$/,
    503,
    'Não foi possível gerar a partida agora. Vida e itens foram devolvidos.'
  ],
  [/^RUN_REJECTED/, 422, 'A partida não passou na verificação do servidor'],
  [/^USER_NOT_FOUND$/, 404, 'Usuário não encontrado']
];

function responderErro(res, error, contexto) {
  const mensagem = error && error.message ? error.message : String(error);
  const conhecido = ERROS.find(([padrao]) => padrao.test(mensagem));
  if (conhecido) return fail(res, conhecido[1], conhecido[2], mensagem);
  console.error(`[GameRunController.${contexto}]`, error);
  return fail(res, 500, 'Erro ao processar a partida', mensagem);
}

class GameRunController {
  static async iniciar(req, res) {
    try {
      const { gameId, itemIds, streamerId, requestId } = req.body || {};
      const abertura = await GameRunService.iniciar(
        req.user.id,
        { gameId, itemIds, streamerId, requestId },
        req.app.get('io')
      );
      return ok(res, abertura, 'Partida aberta');
    } catch (error) {
      return responderErro(res, error, 'iniciar');
    }
  }

  static async finalizar(req, res) {
    try {
      const { log, clientHash } = req.body || {};
      const resultado = await GameRunService.finalizar(
        req.user.id,
        req.params.runId,
        { log, clientHash },
        req.app.get('io')
      );
      return ok(res, resultado, 'Partida verificada pelo servidor');
    } catch (error) {
      return responderErro(res, error, 'finalizar');
    }
  }

  static async revelar(req, res) {
    try {
      const resultado = await GameRunService.revelar(req.user.id, req.params.runId);
      return ok(res, resultado, 'Rodada revelada para reprodução');
    } catch (error) {
      return responderErro(res, error, 'revelar');
    }
  }
}

module.exports = GameRunController;
