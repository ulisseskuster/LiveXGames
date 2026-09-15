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
   * @param {{gameId?: unknown, itemIds?: unknown, streamerId?: string}} pedido
   */
  static async iniciar(userId, { gameId, itemIds = [], streamerId = null } = {}, io = null) {
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
    // Intenções 'reserving' órfãs (processo caiu entre debitar e gerar):
    // devolve vida e itens antes de qualquer nova abertura.
    const orfas = await GameRunModel.abandonarReservingStale().catch(() => []);
    if (orfas.length) {
      await this.devolverItens(userId, orfas);
      for (const orfa of orfas) {
        if (orfa.streamer_id) await ChannelInventory.addLives(userId, orfa.streamer_id, 1);
        else await this.devolverVida(userId, orfa.used_sub_life);
      }
    }

    // ─── Fase 2 (P0-B): intenção persistente ANTES de consumir recursos ───
    // O fluxo antigo consumia vida + reservava itens e só DEPOIS gravava a
    // rodada: queda no meio perdia tudo. Agora a intenção (status 'reserving')
    // é gravada NA MESMA TRANSAÇÃO que debita vida e reserva itens. Se o
    // processo cair, sobra a intenção órfã → recuperação devolve os recursos.
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${userId}:${gameId}:${JSON.stringify(ids)}:${Date.now()}`)
      .digest('hex');

    const channelLife = canal ? await ChannelInventory.consumeLife(userId, canal) : false;
    const vida = channelLife ? { usouDourada: false } : await UserModel.consumeLife(userId);
    if (!vida) throw new Error('NO_LIVES_REMAINING');
    const vidaUsouDourada = Boolean(vida && vida.usouDourada);

    const reservados = [];
    let abertura;
    let intencao = null;
    const transacional = db.isAvailable();
    const client = transacional ? await db.connect() : null;
    let commitou = false;
    try {
      if (client) await client.query('BEGIN');
      // Reserva vida e itens dentro da transação (mesmo client)…
      for (const item of itens) {
        const reservou = canal
          ? await ChannelInventory.reserve(userId, canal, item.id)
          : await ShopModel.reservarItem(userId, item.id);
        if (!reservou) throw new Error(`ITEM_NOT_IN_INVENTORY:${item.id}`);
        reservados.push(item.id);
      }

      const duracaoMs = (jogo.maxTicks / 60) * 1000;
      const autoritativa = JOGOS_AUTORITATIVOS.has(gameIdValido);
      const nonce = crypto.randomBytes(16).toString('hex');
      const seed = autoritativa
        ? sementeDaRodada(userId, gameIdValido, nonce)
        : crypto.randomBytes(32).toString('hex');
      const botSeed = autoritativa
        ? parseInt(seed.slice(0, 8), 16)
        : crypto.randomInt(0, 0xffffffff);
      const compromisso = compromissoDaPartida(seed, botSeed);
      const bonus = bonusDosItens(itens);
      const scoreMultiplier = Math.round(bonus.multiplier * subscriberMultiplier * 1e6) / 1e6;

      // Loadout persistido: bytes (base64) + itemIds + descrição dos itens.
      // É este objeto que a verificação do replay usa (run.loadout.bytes).
      const loadoutPersistido = {
        itemIds: reservados,
        bytes: loadout.toString('base64'),
        items: itens.map((i) => ({
          id: i.id,
          name: i.name,
          effect: i.flight_bonus.effect,
          activation: 'automatic',
          charges: 1
        }))
      };

      // …e a INTENÇÃO da rodada, tudo ou nada. O seed/sorteio ainda é gerado
      // depois, fora da transação longa.
      if (client) {
        intencao = await GameRunModel.criarIntencao({
          client,
          userId,
          gameId: gameIdValido,
          seed,
          simVersion: manifesto.simVersion,
          loadout: loadoutPersistido,
          expiresAt: new Date(Date.now() + duracaoMs + MARGEM_EXPIRACAO_MS).toISOString(),
          streamerId: canal,
          usedChannelLife: channelLife,
          idempotencyKey,
          itemIds: reservados
        });
        if (!intencao) throw new Error('RUN_ALREADY_OPEN');
        await client.query('COMMIT');
        commitou = true;
      } else {
        // Sem banco (InMemory): mesma semântica aproximada, sem transação real.
        intencao = await GameRunModel.abrir({
          userId,
          streamerId: canal,
          usedChannelLife: channelLife,
          gameId: gameIdValido,
          seed,
          simVersion: manifesto.simVersion,
          loadout: loadoutPersistido,
          usedSubLife: vidaUsouDourada,
          expiresAt: new Date(Date.now() + duracaoMs + MARGEM_EXPIRACAO_MS).toISOString(),
          status: 'reserving'
        });
      }

      // ── Geração da simulação FORA da transação longa ──
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

      // Transiciona reserving → open com o resultado já gerado (condicional).
      const run = await GameRunModel.confirmarIntencao(intencao.id, {
        result: resultGerado,
        inputLog: gerada ? Buffer.from(gerada.log) : null,
        expiresAt: new Date(Date.now() + duracaoMs + MARGEM_EXPIRACAO_MS).toISOString()
      });
      if (!run) throw new Error('RUN_ALREADY_OPEN');

      abertura = {
        runId: run.id,
        streamerId: canal,
        gameId,
        gameCode: jogo.code,
        seed: autoritativa ? null : run.seed,
        simVersion: run.sim_version,
        loadout: loadout.toString('base64'),
        replayLog: null,
        generatedResult: null,
        commitment: autoritativa ? compromisso : null,
        items: itens.map((i) => ({
          id: i.id,
          name: i.name,
          effect: i.flight_bonus.effect,
          activation: i.flight_bonus.activation,
          charges: i.flight_bonus.charges ?? 1
        })),
        maxTicks: jogo.maxTicks,
        expiresAt: run.expires_at
      };
    } catch (err) {
      if (client && commitou) {
        // O COMMIT já passou: a intenção e o débito de recursos persistiram.
        // ROLLBACK não desfaz nada aqui — é preciso compensar manualmente:
        // abandonar a intenção órfã, devolver vida e devolver itens reservados.
        await GameRunModel.abandonarIntencao(intencao.id).catch(() => {});
        for (const id of reservados) {
          if (canal) await ChannelInventory.add(userId, canal, id, 1);
          else await ShopModel.addItemToInventory(userId, id, 1);
        }
        if (channelLife) await ChannelInventory.addLives(userId, canal, 1);
        else await this.devolverVida(userId, vidaUsouDourada);
      } else if (client) {
        // Falha ANTES do COMMIT: o ROLLBACK desfaz tudo (débito de itens na
        // transação + intenção). A vida foi debitada FORA da transação (linha
        // 137) e precisa voltar manualmente.
        await client.query('ROLLBACK').catch(() => {});
        if (channelLife) await ChannelInventory.addLives(userId, canal, 1);
        else await this.devolverVida(userId, vidaUsouDourada);
      } else if (intencao) {
        // Sem banco (InMemory): compensa manualmente o que foi debitado.
        await GameRunModel.abandonarIntencao(intencao.id).catch(() => {});
        for (const id of reservados) {
          if (canal) await ChannelInventory.add(userId, canal, id, 1);
          else await ShopModel.addItemToInventory(userId, id, 1);
        }
        if (channelLife) await ChannelInventory.addLives(userId, canal, 1);
        else await this.devolverVida(userId, vidaUsouDourada);
      } else {
        for (const id of reservados) {
          if (canal) await ChannelInventory.add(userId, canal, id, 1);
          else await ShopModel.addItemToInventory(userId, id, 1);
        }
        if (channelLife) await ChannelInventory.addLives(userId, canal, 1);
        else await this.devolverVida(userId, vidaUsouDourada);
      }
      throw err;
    } finally {
      if (client) client.release();
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
  static async devolverVida(userId, usouDourada) {
    const usuario = await UserModel.findById(userId);
    if (!usuario || usuario.role === 'streamer') return;
    if (usouDourada) await UserModel.refundSubLife(userId);
    else await UserModel.addExtraLife(userId);
  }
}

module.exports = GameRunService;
