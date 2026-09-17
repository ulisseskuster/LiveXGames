// @ts-check
const crypto = require('crypto');
const UserModel = require('../models/userModel');
const ShopModel = require('../models/shopModel');
const WalletModel = require('../models/walletModel');
const GameRunModel = require('../models/gameRunModel');
const Economy = require('./economy');
const ChannelInventory = require('../models/channelInventoryModel');
const ChannelWallet = require('../models/streamerWalletModel');
const StreakModel = require('../models/streakModel');
const db = require('../config/database');
const { requireChannel } = require('./channelScope');
const RunVerifier = require('./sim/runVerifier');
const { JWT_SECRET } = require('../config/secrets');
const { lerManifesto } = require('./sim/simRuntime');
const { jogoPorId, telemetriaParaKeyframes } = require('./sim/games');
const { codificarLoadout, MAX_SLOTS } = require('./sim/loadoutCodec');
const { bonusDosItens, itemParaSimulacao } = require('./sim/scoreBonus');
const { comercializavel } = require('./gameCatalog');

/**
 * Rodadas da Arena (README.md, Rodadas da Arena).
 *
 * Jet Launcher, Neon Drifter e Void Walker: o resultado inteiro (duração,
 * distância, pontos e moedas) é sorteado no clique, a partir de uma semente HMAC
 * com chave derivada do JWT_SECRET, e liquidado antes de responder. O navegador só
 * reproduz o filme; nada que ele envie muda a rodada.
 *
 * Sandbox: fundação interativa. O cliente manda o log de entradas e o servidor
 * reexecuta a partida com o mesmo .wasm.
 */

/** Pausa, aba em segundo plano, rede lenta: margem além da duração máxima. */
const MARGEM_EXPIRACAO_MS = 15 * 60 * 1000;
/**
 * Idade a partir da qual uma intenção 'reserving' é considerada órfã. Uma
 * geração normal leva milissegundos; o limiar cobre fila cheia do verificador.
 * Abandonar uma geração ainda viva é seguro: a confirmação dela falha e o
 * estorno acontece uma única vez (ver abandonarEEstornar).
 */
const LIMIAR_ORFA_MS = 2 * 60 * 1000;
/** Um log real de 120 s fica em poucos KB; 64 KB é folga, não meta. */
const MAX_LOG_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HASH = /^[0-9a-f]{16}$/;

const JOGOS_AUTORITATIVOS = new Set(['jet_launcher', 'neon_drifter', 'void_walker']);

/**
 * Chave própria das rodadas, derivada do JWT_SECRET. A semente revelada ao
 * jogador nunca é um HMAC feito direto com o segredo que assina as sessões, então
 * publicá-la não ajuda ninguém a forjar token.
 */
const CHAVE_RODADAS = crypto.createHmac('sha256', JWT_SECRET).update('livex:rodadas:v1').digest();

/**
 * Semente da rodada: HMAC(chave derivada, usuário:jogo:nonce). O nonce aleatório
 * impede prever a próxima rodada mesmo conhecendo o usuário e o jogo.
 *
 * @param {string} userId
 * @param {string} gameId
 * @param {string} nonce
 */
function sementeDaRodada(userId, gameId, nonce) {
  return crypto
    .createHmac('sha256', CHAVE_RODADAS)
    .update(`${userId}:${gameId}:${nonce}`)
    .digest('hex');
}

function compromissoDaPartida(seed, botSeed) {
  return crypto.createHash('sha256').update(`${seed}:${botSeed}`).digest('hex');
}

class GameRunService {
  /**
   * @param {string} userId
   * @param {{gameId?: unknown, itemIds?: unknown, streamerId?: string, requestId?: unknown}} pedido
   */
  static async iniciar(
    userId,
    { gameId, itemIds = [], streamerId = null, requestId } = {},
    io = null
  ) {
    const jogo = typeof gameId === 'string' ? jogoPorId(gameId) : null;
    if (!jogo || !jogo.disponivel()) throw new Error(`INVALID_GAME_ID:${String(gameId)}`);
    const gameIdValido = /** @type {string} */ (gameId);

    // Só rodadas que pagam moedas pertencem a um canal; o sandbox fica no inventário antigo.
    const canal = JOGOS_AUTORITATIVOS.has(gameIdValido) ? await requireChannel(streamerId) : null;

    const ids = Array.isArray(itemIds) ? itemIds : null;
    const loadoutValido =
      ids &&
      ids.length <= MAX_SLOTS &&
      ids.every((id) => typeof id === 'string' && id.length <= 80) &&
      new Set(ids).size === ids.length;
    if (!loadoutValido) throw new Error('INVALID_LOADOUT');

    const manifesto = lerManifesto();
    if (!manifesto) throw new Error('SIM_UNAVAILABLE');

    // Tudo que pode recusar a partida sem custo vem antes de qualquer débito:
    // recusar depois obrigaria a estornar vida e itens.
    const itens = [];
    for (const id of ids) {
      if (JOGOS_AUTORITATIVOS.has(gameIdValido) && !comercializavel(id))
        throw new Error(`ITEM_NOT_FOUND:${id}`);
      const item = await ShopModel.findItemById(id);
      if (!item) throw new Error(`ITEM_NOT_FOUND:${id}`);
      const doJogo = item.gameId || item.game_id || 'all';
      if (doJogo !== gameId && doJogo !== 'all') throw new Error(`ITEM_WRONG_GAME:${id}`);
      itens.push(itemParaSimulacao(item));
    }
    const loadout = codificarLoadout(itens);
    // Congelado na abertura, inclusive quando a rodada usa uma vida normal.
    // Twitch + Kick não acumulam o benefício; dados do pedido não definem cargo.
    const subscriberMultiplier = UserModel.isSubscriber(await UserModel.findById(userId)) ? 1.2 : 1;

    // Recupera uma rodada cujo processo caiu depois de salvar o sorteio.
    // Ela conserva o resultado e os consumíveis, sem sortear novamente.
    await this.recuperarGeradas(userId, io);
    const anteriores = await GameRunModel.abandonarAbertas(userId);
    await this.devolverItens(userId, anteriores);
    // Intenção deste usuário presa em 'reserving' ocupa o índice único de
    // "uma rodada por vez": sem isto, ele só voltaria a jogar depois do job.
    await this.recuperarOrfas({ userId });

    // Repetir o MESMO pedido (mesmo requestId, ex.: nova tentativa após timeout
    // de rede) devolve a mesma rodada ANTES de qualquer débito. Sem requestId,
    // cada chamada é uma rodada nova.
    const requestIdValido =
      typeof requestId === 'string' &&
      requestId.length >= 8 &&
      requestId.length <= 128 &&
      /^[A-Za-z0-9._:-]+$/.test(requestId);
    const idempotencyKey = requestIdValido
      ? crypto.createHash('sha256').update(`${userId}:${gameIdValido}:${requestId}`).digest('hex')
      : null;
    if (idempotencyKey) {
      const existente = await GameRunModel.buscarPorIdempotencia(userId, idempotencyKey);
      if (existente) return this.reabrir(userId, existente, io);
    }

    const autoritativa = JOGOS_AUTORITATIVOS.has(gameIdValido);
    const duracaoMs = (jogo.maxTicks / 60) * 1000;
    const nonce = crypto.randomBytes(16).toString('hex');
    const seed = autoritativa
      ? sementeDaRodada(userId, gameIdValido, nonce)
      : crypto.randomBytes(32).toString('hex');
    const botSeed = autoritativa ? parseInt(seed.slice(0, 8), 16) : crypto.randomInt(0, 0xffffffff);
    const compromisso = compromissoDaPartida(seed, botSeed);
    const bonus = bonusDosItens(itens);
    const scoreMultiplier = Math.round(bonus.multiplier * subscriberMultiplier * 1e6) / 1e6;
    const expiraEm = () => new Date(Date.now() + duracaoMs + MARGEM_EXPIRACAO_MS).toISOString();

    // Vida, itens e intenção persistem juntos (ou nada persiste). A geração
    // fica fora da transação: não se segura lock enquanto o worker simula.
    const intencao = await this.reservar(userId, canal, itens, {
      gameId: gameIdValido,
      seed,
      simVersion: manifesto.simVersion,
      expiresAt: expiraEm(),
      idempotencyKey,
      // Loadout persistido: é o que a verificação do replay usa (loadout.bytes).
      loadout: {
        itemIds: itens.map((i) => i.id),
        bytes: loadout.toString('base64'),
        items: itens.map((i) => ({
          id: i.id,
          name: i.name,
          effect: i.flight_bonus.effect,
          activation: i.flight_bonus.activation,
          charges: i.flight_bonus.charges ?? 1
        }))
      }
    });

    let abertura;
    try {
      // O resultado inteiro existe ANTES de responder ao clique. Reveal é
      // somente leitura; nenhum comando, hash ou log do navegador participa.
      const gerada = autoritativa
        ? await RunVerifier.gerar({
            gameCode: jogo.code,
            seed: Buffer.from(seed, 'hex'),
            loadout,
            botSeed,
            skill: 1
          })
        : null;
      if (autoritativa && (!gerada?.result || !gerada.log)) throw new Error('GENERATION_FAILED');

      // Preços congelados agora: editar a loja não muda uma rodada já sorteada.
      const moedas = Economy.moedasDaRodada(
        gameIdValido,
        gerada ? gerada.result.distance : 0,
        bonus.items
      );

      const resultGerado = gerada
        ? {
            ...gerada.result,
            serverGenerated: true,
            baseScore: gerada.result.score,
            score: Math.round(gerada.result.score * scoreMultiplier),
            scoreMultiplier,
            itemScoreMultiplier: bonus.multiplier,
            subscriberMultiplier,
            scoreBonuses: bonus.items,
            coinsBase: moedas.base,
            coinsBonus: moedas.bonus,
            coinsEarned: moedas.total,
            telemetry: gerada.telemetry,
            provablyFairVersion: 2,
            commitment: compromisso,
            botSeed,
            nonce
          }
        : null;

      // reserving → open, condicional: se a recuperação de órfãs já abandonou
      // esta intenção (e estornou), a rodada não pode mais abrir.
      const run = await GameRunModel.confirmarIntencao(intencao.id, {
        result: resultGerado,
        inputLog: gerada ? Buffer.from(gerada.log) : null,
        expiresAt: expiraEm()
      });
      if (!run) throw new Error('RUN_ABANDONED');
      abertura = this.aberturaDaRodada(run);
    } catch (err) {
      // Só estorna se ESTA chamada abandonar a intenção: se a recuperação de
      // órfãs chegou antes, ela já devolveu tudo.
      await this.abandonarEEstornar(intencao.id, userId);
      throw err;
    }
    if (JOGOS_AUTORITATIVOS.has(gameIdValido)) {
      // A reprodução pode ser fechada, pulada ou nem chegar a abrir.
      // Crédito e consumo pertencem ao clique, nunca ao fim do filme.
      await this.finalizar(userId, abertura.runId, {}, io);
      // Streak diário: rodada autoritativa liquidada conta como dia de atividade.
      // Registrado depois da liquidação para nunca alterar o fluxo de crédito.
      try {
        await StreakModel.registrarAtividade(userId);
      } catch (e) {
        console.warn(`[Streak] Falha ao registrar atividade de ${userId}:`, e.message);
      }
      // Conquistas: verifica e desbloqueia em tempo real, sem esperar um
      // /achievements/check manual. Só com banco disponível (o serviço de
      // conquistas não tem fallback em memória). Falha nunca derruba a rodada.
      try {
        const db = require('../config/database');
        if (db.isAvailable()) {
          const AchievementService = require('./achievementService');
          const novas = await AchievementService.checkAndUnlock(userId);
          if (novas.length && io) {
            io.to(`user_${userId}`).emit('achievements:unlocked', { novas });
            // Web Push (PWA) quando configurado: a notificação é gravada na fila
            // de qualquer forma e o envio real é best-effort (nunca derruba).
            try {
              const PushNotificationService = require('./pushNotificationService');
              await PushNotificationService.sendToUser({
                userId,
                title: '🏆 Nova conquista!',
                body: `Você desbloqueou ${novas.length} ${novas.length === 1 ? 'conquista' : 'conquistas'} na Arena.`,
                url: '/perfil',
                relatedType: 'achievement',
                relatedId: novas.join(',')
              });
            } catch (pushErr) {
              console.warn(
                `[Achievements] Falha ao enviar push de conquista a ${userId}:`,
                pushErr.message
              );
            }
          }
        }
      } catch (e) {
        console.warn(`[Achievements] Falha ao checar conquistas de ${userId}:`, e.message);
      }
    }
    return abertura;
  }

  /**
   * @param {string} userId
   * @param {string} runId
   * @param {{log?: unknown, clientHash?: unknown}} envio
   * @param {any} [io]
   */
  static async finalizar(userId, runId, { log, clientHash } = {}, io = null) {
    if (typeof runId !== 'string' || !UUID.test(runId)) throw new Error('RUN_NOT_FOUND');
    const existente = await GameRunModel.buscar(runId, userId);
    if (!existente) throw new Error('RUN_NOT_FOUND');
    if (
      existente.status === 'verified' &&
      existente.result?.serverGenerated &&
      existente.result.receipt
    ) {
      return existente.result.receipt;
    }
    const autoritativa = Boolean(existente.result?.serverGenerated && existente.input_log);
    if (autoritativa) return this.liquidarGerada(userId, existente, io);
    const limiteBase64 = Math.ceil(MAX_LOG_BYTES / 3) * 4;
    if (typeof log !== 'string' || log.length > limiteBase64 || !BASE64.test(log)) {
      throw new Error('INVALID_LOG');
    }
    const logBytes = Buffer.from(log, 'base64');
    const hashCliente = typeof clientHash === 'string' && HASH.test(clientHash) ? clientHash : null;

    const run = await GameRunModel.reivindicar(runId, userId);
    if (!run) {
      const existente = await GameRunModel.buscar(runId, userId);
      if (!existente) throw new Error('RUN_NOT_FOUND');
      if (existente.status === 'open') {
        const expirada = await GameRunModel.expirar(runId);
        if (expirada) await this.devolverItens(userId, [expirada]);
        throw new Error('RUN_EXPIRED');
      }
      throw new Error('RUN_ALREADY_FINISHED');
    }

    const jogo = jogoPorId(run.game_id);
    const manifesto = lerManifesto();
    if (!jogo || !manifesto || manifesto.simVersion !== run.sim_version) {
      return this.recusarPorVersao(userId, run);
    }

    let verificacao;
    try {
      verificacao = await RunVerifier.verificar({
        gameCode: jogo.code,
        seed: Buffer.from(run.seed, 'hex'),
        loadout: Buffer.from(run.loadout.bytes || '', 'base64'),
        log: logBytes
      });
    } catch (err) {
      // Falha nossa, não do jogador: devolve tudo.
      console.error('[GameRunService.finalizar] Verificador indisponível:', err.message);
      await this.devolverItens(userId, [run]);
      await this.devolverVida(userId, run.used_sub_life);
      await GameRunModel.concluir(runId, { status: 'error', result: { error: err.message } });
      throw new Error('VERIFICATION_FAILED', { cause: err });
    }

    if (verificacao.simVersion !== run.sim_version) {
      return this.recusarPorVersao(userId, run);
    }

    if (!verificacao.ok) {
      // Log recusado. A vida fica gasta (a partida começou), os itens voltam: quem
      // adultera o log não ganha nada, mas também não perde item que não usou.
      await this.devolverItens(userId, [run]);
      await GameRunModel.concluir(runId, {
        status: 'rejected',
        result: { error: verificacao.error },
        inputLog: logBytes
      });
      throw new Error(`RUN_REJECTED:${verificacao.error}`);
    }

    const r = verificacao.result;
    const itemIds = run.loadout.itemIds || [];
    const usou = (i) => ((r.itemsUsedMask >>> i) & 1) === 1;
    const usados = itemIds.filter((_, i) => usou(i));
    const devolvidos = itemIds.filter((_, i) => !usou(i));
    for (const id of devolvidos) await ShopModel.addItemToInventory(userId, id, 1);

    const distanciaPremiada = Math.round(r.distance);
    const moedas = jogo.pagaMoedas ? Economy.coinsFromDistance(run.game_id, distanciaPremiada) : 0;
    if (moedas > 0) {
      await WalletModel.addCredits(userId, moedas, {
        type: 'flight_reward',
        gameId: run.game_id,
        runId,
        distance: distanciaPremiada,
        score: r.score
      });
    }

    // Só o sandbox chega aqui, e ele não entra no ranking nem avisa o chat.
    const keyframes = telemetriaParaKeyframes(jogo, verificacao.telemetry || []);

    // Hash divergente com log aceito = cliente em outra versão ou bug de
    // determinismo. Não muda o resultado (o do servidor vale), mas precisa aparecer.
    if (hashCliente && hashCliente !== r.hash) {
      console.warn(
        `[GameRunService] Hash divergente na partida ${runId}: cliente ${hashCliente}, servidor ${r.hash}`
      );
    }

    const usuario = await UserModel.findById(userId);
    const carteira = await WalletModel.findByUserId(userId);

    const receipt = {
      runId,
      gameId: run.game_id,
      streamerId: run.streamer_id,
      distance: r.distance,
      score: r.score,
      peak: r.peak,
      ticks: r.ticks,
      endReason: r.endReason,
      hash: r.hash,
      commitment: null,
      revealedSeed: run.seed,
      baseScore: r.score,
      scoreMultiplier: 1,
      scoreBonuses: [],
      clientHashMatches: hashCliente ? hashCliente === r.hash : null,
      coinsBase: moedas,
      coinsBonus: 0,
      coinsEarned: moedas,
      itemsUsed: usados,
      itemsReturned: devolvidos,
      livesRemaining: usuario ? usuario.lives : null,
      subLivesRemaining: usuario ? UserModel.getSubLives(usuario) : 0,
      newBalance: carteira ? Number(carteira.balance) : null,
      flightScript: keyframes,
      verifyMs: Math.round(verificacao.ms * 100) / 100
    };
    await GameRunModel.concluir(runId, {
      status: 'verified',
      result: {
        ...r,
        coinsEarned: moedas,
        itemsUsed: usados,
        itemsReturned: devolvidos,
        clientHash: hashCliente,
        verifyMs: verificacao.ms,
        receipt
      },
      inputLog: logBytes
    });
    return receipt;
  }

  static async revelar(userId, runId) {
    const run = await GameRunModel.buscar(runId, userId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (
      !JOGOS_AUTORITATIVOS.has(run.game_id) ||
      !run.result?.serverGenerated ||
      !run.input_log ||
      !['open', 'verified'].includes(run.status)
    ) {
      throw new Error('RUN_NOT_REVEALABLE');
    }
    return {
      runId: run.id,
      gameId: run.game_id,
      streamerId: run.streamer_id,
      seed: run.seed,
      loadout: run.loadout.bytes,
      replayLog: Buffer.from(run.input_log).toString('base64'),
      generatedResult: {
        hash: run.result.hash,
        score: run.result.score,
        baseScore: run.result.baseScore,
        ticks: run.result.ticks,
        scoreMultiplier: run.result.scoreMultiplier,
        itemScoreMultiplier: run.result.itemScoreMultiplier ?? run.result.scoreMultiplier,
        subscriberMultiplier: run.result.subscriberMultiplier ?? 1,
        scoreBonuses: run.result.scoreBonuses,
        coinsEarned: run.result.coinsEarned,
        serverGenerated: true,
        botSeed: run.result.botSeed,
        nonce: run.result.nonce
      },
      commitment: run.result.commitment,
      items:
        run.loadout.items ||
        (run.loadout.itemIds || []).map((id) => ({
          id,
          name: id,
          effect: 'server-generated',
          activation: 'server-generated',
          charges: 0
        })),
      maxTicks: jogoPorId(run.game_id)?.maxTicks || 0,
      expiresAt: run.expires_at,
      gameCode: jogoPorId(run.game_id)?.code || 0,
      simVersion: run.sim_version
    };
  }

  static async recuperarGeradas(userId, io) {
    const runs = await GameRunModel.geradasPendentes(userId);
    for (const run of runs) await this.liquidarGerada(userId, run, io);
  }

  static async liquidarGerada(userId, run, io) {
    const r = run.result;
    if (r.commitment !== compromissoDaPartida(run.seed, r.botSeed))
      throw new Error('RUN_COMMITMENT_MISMATCH');
    const usuario = await UserModel.findById(userId);
    const jogo = jogoPorId(run.game_id);
    // Rodada gerada antes das moedas congeladas na abertura: paga a base, limitada
    // à maior base de hoje, para uma distância da escala antiga não pagar a mais.
    const coinsEarned =
      r.coinsEarned ??
      Math.min(Economy.coinsFromDistance(run.game_id, r.distance), Economy.MOEDAS_MAX_BASE);
    const receipt = {
      runId: run.id,
      gameId: run.game_id,
      streamerId: run.streamer_id,
      distance: r.distance,
      score: r.score,
      peak: r.peak,
      ticks: r.ticks,
      endReason: r.endReason,
      hash: r.hash,
      commitment: r.commitment,
      revealedSeed: run.seed,
      baseScore: r.baseScore,
      scoreMultiplier: r.scoreMultiplier,
      itemScoreMultiplier: r.itemScoreMultiplier ?? r.scoreMultiplier,
      subscriberMultiplier: r.subscriberMultiplier ?? 1,
      scoreBonuses: r.scoreBonuses || [],
      clientHashMatches: null,
      coinsBase: r.coinsBase ?? coinsEarned,
      coinsBonus: r.coinsBonus ?? 0,
      coinsEarned,
      itemsUsed: run.loadout.itemIds || [],
      itemsReturned: [],
      livesRemaining: usuario?.lives ?? null,
      subLivesRemaining: usuario ? UserModel.getSubLives(usuario) : 0,
      newBalance: null,
      flightScript: telemetriaParaKeyframes(jogo, r.telemetry || []),
      verifyMs: 0
    };
    if (run.streamer_id) {
      const wallet = await ChannelWallet.findByUserAndStreamer(userId, run.streamer_id);
      receipt.channelLivesRemaining = Number(wallet.extra_lives || 0);
    }
    const liquidada = await GameRunModel.liquidarGerada(run.id, userId, receipt);
    // O ranking agregado mudou (um voo novo entrou): zera o cache curto na
    // hora para a próxima leitura recalcular, sem esperar o TTL.
    if (liquidada.nova) {
      try {
        const LeaderboardService = require('./leaderboardService');
        LeaderboardService.invalidar();
      } catch (e) {
        console.warn('[Leaderboard] Falha ao invalidar cache:', e.message);
      }
    }
    // Vai para todo socket aberto: só o que o aviso do chat mostra. Id, papel,
    // itens e o filme da rodada não são da conta de quem assiste.
    if (liquidada.nova && io && usuario)
      io.emit('game:flight-launched', {
        gameId: run.game_id,
        streamerId: run.streamer_id,
        user: { username: usuario.username },
        distance: r.distance,
        score: r.score
      });
    return liquidada.receipt;
  }

  /** Deploy com simulação nova no meio da partida: culpa nossa, devolve tudo. */
  static async recusarPorVersao(userId, run) {
    await this.devolverItens(userId, [run]);
    await this.devolverVida(userId, run.used_sub_life);
    await GameRunModel.concluir(run.id, {
      status: 'rejected',
      result: { error: 'SIM_VERSION_CHANGED' }
    });
    throw new Error('SIM_VERSION_CHANGED');
  }

  static async devolverItens(userId, runs) {
    for (const run of runs) {
      for (const id of (run.loadout && run.loadout.itemIds) || []) {
        if (run.streamer_id) await ChannelInventory.add(userId, run.streamer_id, id, 1);
        else await ShopModel.addItemToInventory(userId, id, 1);
      }
    }
  }

  /** Streamer não gasta vida ao abrir, então também não recebe de volta. */
  static async devolverVida(userId, usouDourada, client = null) {
    const usuario = await UserModel.findById(userId);
    if (!usuario || usuario.role === 'streamer') return;
    if (usouDourada) await UserModel.refundSubLife(userId, client);
    else await UserModel.addExtraLife(userId, {}, client);
  }

  /**
   * Resposta de abertura a partir da rodada salva. Serve tanto para a rodada
   * recém-aberta quanto para a repetição do mesmo pedido.
   */
  static aberturaDaRodada(run) {
    const jogo = jogoPorId(run.game_id);
    const autoritativa = JOGOS_AUTORITATIVOS.has(run.game_id);
    return {
      runId: run.id,
      streamerId: run.streamer_id,
      gameId: run.game_id,
      gameCode: jogo?.code || 0,
      seed: autoritativa ? null : run.seed,
      simVersion: run.sim_version,
      loadout: run.loadout.bytes,
      replayLog: null,
      generatedResult: null,
      commitment: autoritativa ? run.result?.commitment || null : null,
      items: run.loadout.items || [],
      maxTicks: jogo?.maxTicks || 0,
      expiresAt: run.expires_at
    };
  }

  /** Repetição de um pedido já processado: devolve a mesma rodada, sem débito. */
  static async reabrir(userId, run, io) {
    if (run.status === 'reserving') throw new Error('RUN_ALREADY_OPEN');
    if (run.status === 'open' && run.result?.serverGenerated) {
      await this.liquidarGerada(userId, run, io);
      return this.aberturaDaRodada(run);
    }
    if (run.status === 'open' || (run.status === 'verified' && run.result?.serverGenerated)) {
      return this.aberturaDaRodada(run);
    }
    throw new Error('RUN_ALREADY_FINISHED');
  }

  /**
   * Transação com o lock consultivo do usuário. É o mesmo lock de
   * GameRunModel.liquidarGerada: tudo que mexe em vida, itens e rodadas de um
   * usuário entra na mesma fila e trava as linhas sempre na mesma ordem. Sem
   * ele, abertura e liquidação simultâneas (clique duplo) podem se bloquear em
   * ordens opostas (channel_wallets × game_runs) → deadlock 40P01.
   */
  static async emTransacaoDoUsuario(userId, fn) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Debita vida e itens e grava a intenção 'reserving' numa única transação.
   * Qualquer recusa (sem vida, sem item, outra rodada aberta) reverte tudo.
   */
  static async reservar(userId, canal, itens, dados) {
    if (!db.isAvailable()) return this.reservarNaMemoria(userId, canal, itens, dados);
    return this.emTransacaoDoUsuario(userId, async (client) => {
      const channelLife = canal ? await ChannelInventory.consumeLife(userId, canal, client) : false;
      const vida = channelLife ? {} : await UserModel.consumeLife(userId, client);
      if (!vida) throw new Error('NO_LIVES_REMAINING');
      for (const item of itens) {
        const reservou = canal
          ? await ChannelInventory.reserve(userId, canal, item.id, client)
          : await ShopModel.reservarItem(userId, item.id, client);
        if (!reservou) throw new Error(`ITEM_NOT_IN_INVENTORY:${item.id}`);
      }
      return GameRunModel.criarIntencao({
        ...dados,
        client,
        userId,
        streamerId: canal,
        usedChannelLife: channelLife,
        usedSubLife: Boolean(vida.usouDourada),
        itemIds: itens.map((i) => i.id)
      });
    });
  }

  /** Sem banco não há transação: estorna à mão o que já tinha sido debitado. */
  static async reservarNaMemoria(userId, canal, itens, dados) {
    const channelLife = canal ? await ChannelInventory.consumeLife(userId, canal) : false;
    const vida = channelLife ? {} : await UserModel.consumeLife(userId);
    if (!vida) throw new Error('NO_LIVES_REMAINING');
    const debitado = {
      user_id: userId,
      streamer_id: canal,
      used_channel_life: channelLife,
      used_sub_life: Boolean(vida.usouDourada),
      loadout: { itemIds: [] }
    };
    try {
      for (const item of itens) {
        const reservou = canal
          ? await ChannelInventory.reserve(userId, canal, item.id)
          : await ShopModel.reservarItem(userId, item.id);
        if (!reservou) throw new Error(`ITEM_NOT_IN_INVENTORY:${item.id}`);
        debitado.loadout.itemIds.push(item.id);
      }
      return await GameRunModel.abrir({
        ...dados,
        userId,
        streamerId: canal,
        usedChannelLife: channelLife,
        usedSubLife: debitado.used_sub_life,
        status: 'reserving'
      });
    } catch (err) {
      await this.estornar(debitado);
      throw err;
    }
  }

  /** Devolve ao DONO da rodada a vida e os itens que ela reservou. */
  static async estornar(run, client = null) {
    const userId = run.user_id;
    for (const id of run.loadout?.itemIds || []) {
      if (run.streamer_id) await ChannelInventory.add(userId, run.streamer_id, id, 1, client);
      else await ShopModel.addItemToInventory(userId, id, 1, client);
    }
    if (run.used_channel_life) await ChannelInventory.addLives(userId, run.streamer_id, 1, client);
    else await this.devolverVida(userId, run.used_sub_life, client);
  }

  /**
   * Abandona a intenção e estorna na mesma transação. Devolve false quando
   * outra chamada já a tinha abandonado (ou ela já abriu): nada a estornar.
   */
  static async abandonarEEstornar(runId, userId) {
    const abandonar = async (client) => {
      const run = await GameRunModel.abandonarIntencao(runId, client);
      if (run) await this.estornar(run, client);
      return Boolean(run);
    };
    return db.isAvailable() ? this.emTransacaoDoUsuario(userId, abandonar) : abandonar(null);
  }

  /**
   * Intenções que ficaram em 'reserving' além do limiar (o processo caiu entre
   * a reserva e a confirmação): abandona e devolve vida e itens ao próprio dono.
   * Roda no boot, periodicamente (server.js) e na abertura do próprio usuário.
   *
   * @param {{userId?: string|null, maxAgeMs?: number}} [opcoes]
   * @returns {Promise<number>} quantas foram estornadas
   */
  static async recuperarOrfas({ userId = null, maxAgeMs = LIMIAR_ORFA_MS } = {}) {
    const orfas = await GameRunModel.listarOrfas({ userId, maxAgeMs });
    let estornadas = 0;
    for (const orfa of orfas) {
      if (await this.abandonarEEstornar(orfa.id, orfa.user_id)) estornadas += 1;
    }
    return estornadas;
  }
}

module.exports = GameRunService;
