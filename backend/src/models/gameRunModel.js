// @ts-check
const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

/**
 * Ciclo de vida de uma partida verificada (migration 019).
 *
 * Toda transição de status é um UPDATE condicional ao status anterior. É isso que
 * impede terminar a mesma partida duas vezes (dois POST /finish simultâneos): só
 * um deles encontra a linha em 'open' e a leva para 'verifying'.
 */

const EM_ANDAMENTO = ['open', 'verifying', 'reserving'];

function normalizar(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    game_id: row.game_id,
    streamer_id: row.streamer_id || null,
    used_channel_life: Boolean(row.used_channel_life),
    seed: row.seed,
    sim_version: Number(row.sim_version),
    loadout: typeof row.loadout === 'string' ? JSON.parse(row.loadout) : row.loadout || {},
    used_sub_life: Boolean(row.used_sub_life),
    idempotency_key: row.idempotency_key || null,
    status: row.status,
    input_log: row.input_log || null,
    result: row.result || null,
    flight_run_id: row.flight_run_id || null,
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null
  };
}

function naMemoria(runId, userId) {
  return InMemoryStore.gameRuns.find((r) => r.id === runId && (!userId || r.user_id === userId));
}

class GameRunModel {
  static async geradasPendentes(userId) {
    if (db.isAvailable()) {
      const { rows } = await db.query(
        `SELECT * FROM game_runs WHERE user_id = $1 AND status = 'open' AND result->>'serverGenerated' = 'true'`,
        [userId]
      );
      return rows.map(normalizar);
    }
    return InMemoryStore.gameRuns
      .filter((r) => r.user_id === userId && r.status === 'open' && r.result?.serverGenerated)
      .map(normalizar);
  }
  /** Crédito, histórico e recibo são uma única liquidação. Se o processo cair,
   * o Postgres reverte tudo; repetir a consulta retorna o mesmo recibo. */
  static async liquidarGerada(runId, userId, receipt) {
    const flightId = randomUUID();
    const now = new Date().toISOString();
    const metadata = {
      type: 'flight_reward',
      runId,
      gameId: receipt.gameId,
      distance: receipt.distance,
      score: receipt.score
    };
    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT * FROM game_runs WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [runId, userId]
        );
        const run = rows[0];
        if (!run) throw new Error('RUN_NOT_FOUND');
        if (run.status === 'verified' && run.result?.receipt) {
          await client.query('COMMIT');
          return { receipt: run.result.receipt, nova: false, flightId: run.flight_run_id };
        }
        if (run.status !== 'open' || !run.result?.serverGenerated)
          throw new Error('RUN_ALREADY_FINISHED');
        // Rodadas antigas sem canal continuam somente no saldo histórico.
        const scoped = Boolean(run.streamer_id);
        const wallet = await client.query(
          scoped
            ? `INSERT INTO channel_wallets (user_id, streamer_id, balance) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, streamer_id) DO UPDATE
             SET balance = channel_wallets.balance + EXCLUDED.balance, updated_at = NOW() RETURNING balance`
            : `INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + EXCLUDED.balance RETURNING balance`,
          scoped ? [userId, run.streamer_id, receipt.coinsEarned] : [userId, receipt.coinsEarned]
        );
        receipt = {
          ...receipt,
          streamerId: run.streamer_id || null,
          newBalance: Number(wallet.rows[0].balance)
        };
        await client.query(
          scoped
            ? `INSERT INTO channel_wallet_transactions (user_id, streamer_id, type, direction, amount, metadata)
             VALUES ($1, $2, 'flight_reward', 'credit', $3, $4)`
            : `INSERT INTO transactions (user_id, type, direction, amount, currency_code, status, metadata)
             VALUES ($1, 'flight_reward', 'credit', $2, 'credits', 'completed', $3)`,
          scoped
            ? [userId, run.streamer_id, receipt.coinsEarned, JSON.stringify(metadata)]
            : [userId, receipt.coinsEarned, JSON.stringify(metadata)]
        );
        await client.query(
          `INSERT INTO flight_runs (id, user_id, game_id, distance, max_altitude, score, coins_earned, items_used, flight_script, created_at, streamer_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            flightId,
            userId,
            receipt.gameId,
            receipt.distance,
            receipt.peak,
            receipt.score,
            receipt.coinsEarned,
            JSON.stringify(receipt.itemsUsed),
            JSON.stringify(receipt.flightScript),
            now,
            run.streamer_id || null
          ]
        );
        await client.query(
          `UPDATE game_runs SET status = 'verified', result = $2, flight_run_id = $3, finished_at = NOW() WHERE id = $1`,
          [
            runId,
            JSON.stringify({
              ...run.result,
              coinsEarned: receipt.coinsEarned,
              itemsUsed: receipt.itemsUsed,
              itemsReturned: [],
              receipt
            }),
            flightId
          ]
        );
        await client.query('COMMIT');
        return { receipt, nova: true, flightId };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    // Sem awaits entre a checagem e as escritas: seção crítica equivalente em memória.
    const run = naMemoria(runId, userId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (run.status === 'verified' && run.result?.receipt)
      return { receipt: run.result.receipt, nova: false, flightId: run.flight_run_id };
    if (run.status !== 'open' || !run.result?.serverGenerated)
      throw new Error('RUN_ALREADY_FINISHED');
    const wallets = run.streamer_id ? InMemoryStore.channelWallets : InMemoryStore.wallets;
    let wallet = wallets.find(
      (w) => w.user_id === userId && (!run.streamer_id || w.streamer_id === run.streamer_id)
    );
    if (!wallet) {
      wallet = {
        id: randomUUID(),
        user_id: userId,
        streamer_id: run.streamer_id || null,
        balance: 0,
        currency_code: 'credits',
        updated_at: now
      };
      wallets.push(wallet);
    }
    wallet.balance = Number(wallet.balance) + receipt.coinsEarned;
    wallet.updated_at = now;
    receipt = { ...receipt, streamerId: run.streamer_id || null, newBalance: wallet.balance };
    (run.streamer_id ? InMemoryStore.channelWalletTransactions : InMemoryStore.transactions).push({
      streamer_id: run.streamer_id || null,
      id: randomUUID(),
      user_id: userId,
      item_id: null,
      type: 'flight_reward',
      direction: 'credit',
      amount: receipt.coinsEarned,
      currency_code: 'credits',
      status: 'completed',
      metadata,
      created_at: now
    });
    InMemoryStore.flightRuns.unshift({
      id: flightId,
      user_id: userId,
      game_id: receipt.gameId,
      streamer_id: run.streamer_id || null,
      distance: receipt.distance,
      max_altitude: receipt.peak,
      score: receipt.score,
      coins_earned: receipt.coinsEarned,
      items_used: receipt.itemsUsed,
      flight_script: receipt.flightScript,
      created_at: now
    });
    Object.assign(run, {
      status: 'verified',
      result: {
        ...run.result,
        coinsEarned: receipt.coinsEarned,
        itemsUsed: receipt.itemsUsed,
        itemsReturned: [],
        receipt
      },
      flight_run_id: flightId,
      finished_at: now
    });
    return { receipt, nova: true, flightId };
  }

  static async abrir({
    userId,
    streamerId = null,
    usedChannelLife = false,
    gameId,
    seed,
    simVersion,
    loadout,
    usedSubLife,
    expiresAt,
    inputLog = null,
    result = null,
    status = 'open'
  }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO game_runs (user_id, game_id, seed, sim_version, loadout, used_sub_life, input_log, result, expires_at, streamer_id, used_channel_life, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            userId,
            gameId,
            seed,
            simVersion,
            JSON.stringify(loadout),
            usedSubLife,
            inputLog,
            result ? JSON.stringify(result) : null,
            expiresAt,
            streamerId,
            usedChannelLife,
            status
          ]
        );
        return normalizar(rows[0]);
      } catch (err) {
        // O índice único parcial é quem decide a corrida entre duas aberturas.
        if (err.code === '23505') throw new Error('RUN_ALREADY_OPEN', { cause: err });
        db.fallbackOrThrow(err, 'GameRunModel.abrir');
      }
    }

    const jaTem = InMemoryStore.gameRuns.some(
      (r) => r.user_id === userId && EM_ANDAMENTO.includes(r.status)
    );
    if (jaTem) throw new Error('RUN_ALREADY_OPEN');

    const run = {
      id: randomUUID(),
      user_id: userId,
      game_id: gameId,
      streamer_id: streamerId,
      used_channel_life: usedChannelLife,
      seed,
      sim_version: simVersion,
      loadout,
      used_sub_life: Boolean(usedSubLife),
      status,
      idempotency_key: null,
      input_log: inputLog,
      result,
      flight_run_id: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      finished_at: null
    };
    InMemoryStore.gameRuns.unshift(run);
    return normalizar(run);
  }

  /**
   * Fase 2 (P0-B): grava a INTENÇÃO da rodada (status 'reserving') ANTES de
   * consumir vida/itens, dentro da mesma transação que reserva os recursos.
   * Se o processo cair depois, a intenção fica órfã e é recuperável (vida e
   * itens devolvidos) — nada se perde.
   */
  static async criarIntencao({
    client,
    userId,
    gameId,
    seed,
    simVersion,
    loadout,
    expiresAt,
    streamerId = null,
    usedChannelLife = false,
    idempotencyKey,
    itemIds = []
  }) {
    const id = randomUUID();
    const usedSubLife = false;
    const loadoutComItens = {
      ...loadout,
      itemIds
    };
    const query = `
      INSERT INTO game_runs (id, user_id, game_id, seed, sim_version, loadout, used_sub_life, input_log, result, expires_at, streamer_id, used_channel_life, status, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'reserving', $13)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *`;
    const { rows } = await client.query(query, [
      id,
      userId,
      gameId,
      seed,
      simVersion,
      JSON.stringify(loadoutComItens),
      usedSubLife,
      null,
      null,
      expiresAt,
      streamerId,
      usedChannelLife,
      idempotencyKey
    ]);
    return rows[0] ? normalizar(rows[0]) : null;
  }

  /**
   * Transiciona uma intenção 'reserving' para 'open' após a geração concluir.
   * Condicional ao status atual: se outra entrega já transicionou, devolve null.
   */
  static async confirmarIntencao(runId, { result, inputLog, expiresAt }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET status = 'open', result = $2, input_log = $3, expires_at = $4
           WHERE id = $1 AND status = 'reserving'
           RETURNING *`,
          [runId, result ? JSON.stringify(result) : null, inputLog, expiresAt]
        );
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.confirmarIntencao');
      }
    }
    const r = InMemoryStore.gameRuns.find((x) => x.id === runId);
    if (!r || r.status !== 'reserving') return null;
    r.status = 'open';
    r.result = result;
    r.input_log = inputLog;
    r.expires_at = new Date(expiresAt).toISOString();
    return normalizar(r);
  }

  /**
   * Abandona UMA intenção 'reserving' específica (por id). Usada na
   * compensação pós-commit: a geração falhou depois do COMMIT e a intenção
   * precisa ser fechada sem devolver recursos de outras intenções.
   */
  static async abandonarIntencao(runId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET status = 'abandoned', finished_at = NOW()
           WHERE id = $1 AND status = 'reserving'
           RETURNING *`,
          [runId]
        );
        return rows[0] ? normalizar(rows[0]) : null;
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.abandonarIntencao');
      }
    }
    const r = InMemoryStore.gameRuns.find((x) => x.id === runId);
    if (!r || r.status !== 'reserving') return null;
    r.status = 'abandoned';
    r.finished_at = new Date().toISOString();
    return normalizar(r);
  }

  /**
   * Intenções 'reserving' órfãs (processo caiu logo após criar a intenção):
   * devolve os recursos e marca como abandonadas. Chamada na inicialização e
   * periodicamente.
   */
  static async abandonarReservingStale({ maxAgeMs = 60_000 } = {}) {
    const limite = new Date(Date.now() - maxAgeMs).toISOString();
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET status = 'abandoned', finished_at = NOW()
           WHERE status = 'reserving' AND created_at < $1
           RETURNING *`,
          [limite]
        );
        return rows.map(normalizar);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.abandonarReservingStale');
      }
    }
    const agora = Date.now();
    const stale = InMemoryStore.gameRuns.filter(
      (r) => r.status === 'reserving' && Date.parse(r.created_at) < agora - maxAgeMs
    );
    stale.forEach((r) => {
      r.status = 'abandoned';
      r.finished_at = new Date().toISOString();
    });
    return stale.map(normalizar);
  }

  /**
   * Fecha como abandonadas as partidas abertas do usuário. Também libera a que
   * ficou presa em 'verifying' depois de vencer (processo reiniciado no meio da
   * verificação): sem isto, o índice único deixaria o usuário sem jogar nunca mais.
   * ponytail: a presa em 'verifying' pode ter creditado moeda antes de cair; se
   * isso aparecer, conferir `result` antes de devolver itens.
   */
  static async abandonarAbertas(userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs
           SET status = 'abandoned', finished_at = NOW()
           WHERE user_id = $1
             AND (status = 'open' OR (status = 'verifying' AND expires_at < NOW()))
             AND COALESCE(result->>'serverGenerated', 'false') <> 'true'
           RETURNING *`,
          [userId]
        );
        return rows.map(normalizar);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.abandonarAbertas');
      }
    }

    const agora = Date.now();
    const fechadas = [];
    for (const r of InMemoryStore.gameRuns) {
      const presa = r.status === 'verifying' && Date.parse(r.expires_at) < agora;
      if (r.user_id === userId && (r.status === 'open' || presa) && !r.result?.serverGenerated) {
        r.status = 'abandoned';
        r.finished_at = new Date().toISOString();
        fechadas.push(normalizar(r));
      }
    }
    return fechadas;
  }

  /** Leva a partida de 'open' para 'verifying'. null se não estava aberta e válida. */
  static async reivindicar(runId, userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET status = 'verifying'
           WHERE id = $1 AND user_id = $2 AND status = 'open' AND expires_at > NOW()
           RETURNING *`,
          [runId, userId]
        );
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.reivindicar');
      }
    }

    const r = naMemoria(runId, userId);
    if (!r || r.status !== 'open' || Date.parse(r.expires_at) <= Date.now()) return null;
    r.status = 'verifying';
    return normalizar(r);
  }

  static async buscar(runId, userId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(`SELECT * FROM game_runs WHERE id = $1 AND user_id = $2`, [
          runId,
          userId
        ]);
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.buscar');
      }
    }
    return normalizar(naMemoria(runId, userId));
  }

  /** Marca como expirada uma partida aberta vencida. null se não se aplica. */
  static async expirar(runId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET status = 'expired', finished_at = NOW()
           WHERE id = $1 AND status = 'open' AND expires_at <= NOW()
           RETURNING *`,
          [runId]
        );
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.expirar');
      }
    }

    const r = naMemoria(runId);
    if (!r || r.status !== 'open' || Date.parse(r.expires_at) > Date.now()) return null;
    r.status = 'expired';
    r.finished_at = new Date().toISOString();
    return normalizar(r);
  }

  static async concluir(runId, { status, result, inputLog = null, flightRunId = null }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs
           SET status = $2, result = $3, input_log = $4, flight_run_id = $5, finished_at = NOW()
           WHERE id = $1 AND status = 'verifying'
           RETURNING *`,
          [runId, status, JSON.stringify(result), inputLog, flightRunId]
        );
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.concluir');
      }
    }

    const r = naMemoria(runId);
    if (!r || r.status !== 'verifying') return null;
    Object.assign(r, {
      status,
      result,
      input_log: inputLog,
      flight_run_id: flightRunId,
      finished_at: new Date().toISOString()
    });
    return normalizar(r);
  }

  static async atualizarResultado(runId, result, inputLog) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE game_runs SET result = $2, input_log = $3
           WHERE id = $1 AND status = 'open' RETURNING *`,
          [runId, JSON.stringify(result), inputLog]
        );
        return normalizar(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'GameRunModel.atualizarResultado');
      }
    }
    const r = naMemoria(runId);
    if (!r || r.status !== 'open') return null;
    r.result = result;
    r.input_log = inputLog;
    return normalizar(r);
  }
}

module.exports = GameRunModel;
