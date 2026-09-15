// @ts-check
const crypto = require('crypto');
const db = require('../config/database');

/**
 * Vínculo entre um "state" OAuth opaco e o usuário que iniciou o fluxo.
 *
 * Existe para o JWT não trafegar como parâmetro de URL até a Twitch/Kick e
 * voltar (o que o exporia em log de terceiros, histórico do navegador e
 * cabeçalho Referer). O state é de uso único e expira em 10 minutos.
 *
 * Fica no banco, não na memória do processo. Guardado num Map, o retorno do
 * provedor caía em qualquer instância — e só uma delas conhecia aquele state,
 * então o login social falhava de forma aleatória assim que houvesse mais de uma
 * instância no ar. O Map continua como caminho de quando não há banco
 * configurado (desenvolvimento e testes), onde há um processo só.
 */
const STATE_TTL_MS = 10 * 60 * 1000;

const memoria = new Map();

setInterval(
  () => {
    const agora = Date.now();
    for (const [state, entrada] of memoria.entries()) {
      if (agora - entrada.createdAt > STATE_TTL_MS) memoria.delete(state);
    }
  },
  5 * 60 * 1000
).unref();

/**
 * Cria um state opaco. Assíncrono porque pode gravar no banco — quem chama
 * precisa aguardar antes de redirecionar o usuário ao provedor.
 *
 * @param {string|null} userId Quem iniciou o fluxo, ou null para convidado.
 * @param {object|null} extra Carga que precisa sobreviver ao round-trip (o
 *   code_verifier do PKCE da Kick).
 */
async function createState(userId = null, extra = null) {
  const state = crypto.randomBytes(24).toString('hex');

  if (db.isAvailable()) {
    try {
      await db.query(
        `INSERT INTO oauth_states (state, user_id, extra, expires_at)
         VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))`,
        [state, userId, extra ? JSON.stringify(extra) : null, STATE_TTL_MS / 1000]
      );
      return state;
    } catch (err) {
      // Não derruba o início do login por causa disto: o state segue válido em
      // memória e o fluxo funciona enquanto o retorno cair nesta instância.
      console.warn('[OAuthState] Falha ao gravar no banco, usando memória:', err.message);
    }
  }

  memoria.set(state, { userId, extra, createdAt: Date.now() });
  return state;
}

/**
 * Consome o state e devolve o userId e o payload extra.
 *
 * O DELETE ... RETURNING garante o uso único dentro do próprio banco: duas
 * requisições simultâneas com o mesmo state, e só uma leva a linha. Ler e
 * apagar em dois passos deixaria as duas passarem.
 */
async function consumeStateWithExtra(state) {
  const vazio = { userId: null, extra: null };
  if (!state || typeof state !== 'string') return vazio;

  if (db.isAvailable()) {
    try {
      const { rows } = await db.query(
        `DELETE FROM oauth_states
         WHERE state = $1 AND expires_at > NOW()
         RETURNING user_id, extra`,
        [state]
      );
      if (rows[0]) {
        return { userId: rows[0].user_id, extra: rows[0].extra };
      }
    } catch (err) {
      console.warn('[OAuthState] Falha ao consultar o banco, tentando memória:', err.message);
    }
  }

  if (!memoria.has(state)) return vazio;
  const entrada = memoria.get(state);
  memoria.delete(state);
  if (Date.now() - entrada.createdAt > STATE_TTL_MS) return vazio;
  return { userId: entrada.userId, extra: entrada.extra };
}

/** Versão que devolve só o userId, usada pelo fluxo da Twitch (sem PKCE). */
async function consumeState(state) {
  const { userId } = await consumeStateWithExtra(state);
  return userId;
}

/** Remove states vencidos que ninguém chegou a consumir. */
async function limparStatesVencidos() {
  if (!db.isAvailable()) return 0;
  const { rowCount } = await db.query(`DELETE FROM oauth_states WHERE expires_at < NOW()`);
  return rowCount || 0;
}

module.exports = { createState, consumeState, consumeStateWithExtra, limparStatesVencidos };
