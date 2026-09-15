// @ts-check
const db = require('../config/database');

/**
 * Rate limiting compartilhado entre instâncias.
 *
 * A contagem vivia num Map dentro do processo. Com uma instância só funciona;
 * a partir da segunda, cada uma conta a sua metade e nenhuma chega ao limite —
 * um atacante ganha tantas tentativas quantas forem as instâncias. Com o
 * contador no banco, todas somam na mesma linha.
 *
 * O Map continua como caminho de quando não há banco configurado (modo
 * InMemoryStore, usado em desenvolvimento e nos testes), onde há por definição
 * um processo só.
 */

// Fallback em memória, usado apenas sem DATABASE_URL.
const memoria = new Map();

setInterval(
  () => {
    const agora = Date.now();
    for (const [chave, dados] of memoria.entries()) {
      if (agora - dados.windowStart > dados.windowMs) memoria.delete(chave);
    }
  },
  5 * 60 * 1000
).unref();

/**
 * Incrementa o contador da janela atual e devolve quantos acessos já houve.
 *
 * Uma instrução só, atômica: o ON CONFLICT decide, dentro do próprio banco, se
 * a janela expirou (reinicia em 1) ou se ainda vale (soma 1). Ler e depois
 * escrever abriria espaço para duas requisições simultâneas lerem o mesmo valor
 * e o limite ser ultrapassado.
 */
async function registrarAcessoNoBanco(chave, windowMs) {
  const { rows } = await db.query(
    `INSERT INTO rate_limit_counters (bucket_key, hits, window_started_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (bucket_key) DO UPDATE SET
       hits = CASE
         WHEN rate_limit_counters.window_started_at < NOW() - make_interval(secs => $2)
         THEN 1
         ELSE rate_limit_counters.hits + 1
       END,
       window_started_at = CASE
         WHEN rate_limit_counters.window_started_at < NOW() - make_interval(secs => $2)
         THEN NOW()
         ELSE rate_limit_counters.window_started_at
       END
     RETURNING hits, EXTRACT(EPOCH FROM (NOW() - window_started_at)) AS idade_segundos`,
    [chave, windowMs / 1000]
  );
  return {
    hits: Number(rows[0].hits),
    idadeMs: Number(rows[0].idade_segundos) * 1000
  };
}

function registrarAcessoNaMemoria(chave, windowMs) {
  const agora = Date.now();
  const atual = memoria.get(chave);

  if (!atual || agora - atual.windowStart > windowMs) {
    memoria.set(chave, { hits: 1, windowStart: agora, windowMs });
    return { hits: 1, idadeMs: 0 };
  }

  atual.hits += 1;
  return { hits: atual.hits, idadeMs: agora - atual.windowStart };
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 20,
  message = 'Muitas tentativas. Tente novamente mais tarde.'
}) {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    // req.ip, não o cabeçalho cru. Com `app.set('trust proxy', 1)` (ver
    // server.js) o Express já resolve o IP real a partir do último salto
    // confiável. Ler x-forwarded-for direto e pegar o primeiro item pegava um
    // valor escrito pelo cliente: um header diferente por requisição criava um
    // bucket por requisição e o limitador não limitava nada.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // A rota entra na chave para que o teto de /login não seja consumido por
    // chamadas a /game/launch, que tem limite próprio.
    const chave = `${req.baseUrl || req.path}|${ip}`.slice(0, 200);

    try {
      const { hits, idadeMs } = db.isAvailable()
        ? await registrarAcessoNoBanco(chave, windowMs)
        : registrarAcessoNaMemoria(chave, windowMs);

      if (hits > max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - idadeMs) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ success: false, message, retryAfterSeconds });
      }

      return next();
    } catch (err) {
      console.warn('[RateLimiter] Contador indisponível, requisição liberada:', err.message);
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          success: false,
          message: 'Serviço temporariamente indisponível. Tente novamente em instantes.'
        });
      }
      return next();
    }
  };
}

/**
 * Remove janelas vencidas. Sem isto a tabela cresceria um registro por IP/rota
 * para sempre. Chamada periodicamente pelo servidor.
 */
async function limparContadoresVencidos(maxIdadeMs = 24 * 60 * 60 * 1000) {
  if (!db.isAvailable()) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM rate_limit_counters WHERE window_started_at < NOW() - make_interval(secs => $1)`,
    [maxIdadeMs / 1000]
  );
  return rowCount || 0;
}

module.exports = { createRateLimiter, limparContadoresVencidos };
