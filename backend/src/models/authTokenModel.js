// @ts-check
const crypto = require('crypto');
const db = require('../config/database');

/**
 * Tokens de uso único para redefinição de senha e verificação de e-mail.
 *
 * O que vai no e-mail é um valor aleatório de 32 bytes; o que fica gravado é o
 * SHA-256 dele. Quem obtiver uma cópia do banco não consegue redefinir a senha
 * de ninguém — mesmo raciocínio de guardar password_hash em vez da senha.
 * SHA-256 sem sal basta aqui: o segredo tem 256 bits de entropia, então não há
 * dicionário nem força bruta viável, e a busca precisa ser por igualdade.
 *
 * Sem banco configurado (modo InMemoryStore), guarda em memória para o fluxo
 * continuar testável em desenvolvimento.
 */

const memoria = { password_reset: new Map(), email_verification: new Map() };

const TABELA = {
  password_reset: 'password_reset_tokens',
  email_verification: 'email_verification_tokens'
};

function hashDoToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

class AuthTokenModel {
  /**
   * Cria um token e devolve o valor cru, que só existe neste retorno — depois
   * daqui, só o hash sobrevive.
   *
   * @param {'password_reset'|'email_verification'} tipo
   * @param {{userId: string, ttlMs: number, email?: string}} dados
   */
  static async criar(tipo, { userId, ttlMs, email = null }) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashDoToken(token);
    const expiraEm = new Date(Date.now() + ttlMs);

    if (db.isAvailable()) {
      try {
        // Invalida os pedidos anteriores do mesmo usuário: pedir de novo deve
        // sempre inutilizar o link antigo, senão um e-mail antigo interceptado
        // continua valendo.
        await db.query(`DELETE FROM ${TABELA[tipo]} WHERE user_id = $1`, [userId]);

        if (tipo === 'email_verification') {
          await db.query(
            `INSERT INTO ${TABELA[tipo]} (token_hash, user_id, email, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [tokenHash, userId, email, expiraEm]
          );
        } else {
          await db.query(
            `INSERT INTO ${TABELA[tipo]} (token_hash, user_id, expires_at)
             VALUES ($1, $2, $3)`,
            [tokenHash, userId, expiraEm]
          );
        }
        return token;
      } catch (err) {
        db.fallbackOrThrow(err, `AuthTokenModel.criar(${tipo})`);
      }
    }

    for (const [chave, valor] of memoria[tipo].entries()) {
      if (valor.userId === userId) memoria[tipo].delete(chave);
    }
    memoria[tipo].set(tokenHash, { userId, email, expiraEm, usadoEm: null });
    return token;
  }

  /**
   * Consome um token: valida e marca como usado no mesmo passo.
   *
   * O UPDATE condicional resolve validade e uso único dentro do próprio banco.
   * Conferir antes e marcar depois deixaria duas requisições simultâneas com o
   * mesmo link redefinirem a senha duas vezes.
   *
   * @returns {Promise<{userId: string, email: string|null}|null>} null se o
   *   token não existe, já foi usado ou expirou — os três casos são
   *   indistinguíveis de propósito para quem chama.
   */
  static async consumir(tipo, token) {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashDoToken(token);

    if (db.isAvailable()) {
      try {
        const colunaEmail = tipo === 'email_verification' ? ', email' : '';
        const { rows } = await db.query(
          `UPDATE ${TABELA[tipo]}
           SET used_at = NOW()
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
           RETURNING user_id${colunaEmail}`,
          [tokenHash]
        );
        return rows[0] ? { userId: rows[0].user_id, email: rows[0].email || null } : null;
      } catch (err) {
        db.fallbackOrThrow(err, `AuthTokenModel.consumir(${tipo})`);
      }
    }

    const entrada = memoria[tipo].get(tokenHash);
    if (!entrada || entrada.usadoEm || entrada.expiraEm < new Date()) return null;
    entrada.usadoEm = new Date();
    return { userId: entrada.userId, email: entrada.email || null };
  }

  /** Remove tokens vencidos ou já usados. */
  static async limparVencidos() {
    if (!db.isAvailable()) return 0;
    let total = 0;
    for (const tabela of Object.values(TABELA)) {
      const { rowCount } = await db.query(
        `DELETE FROM ${tabela} WHERE expires_at < NOW() OR used_at IS NOT NULL`
      );
      total += rowCount || 0;
    }
    return total;
  }
}

module.exports = AuthTokenModel;
