// @ts-check
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class UserModel {
  // Sub (Twitch ou Kick, não acumula) não tem mais vidas normais a mais: tem
  // estas, à parte, que voltam à meia-noite de Brasília. Ver consumeLife.
  static VIDAS_DOURADAS_POR_DIA = 2;

  static getRoleMaxLives(role) {
    if (role === 'streamer' || role === 'admin') return 999;
    return 3;
  }

  /**
   * O dia corrente em Brasília, como AAAA-MM-DD. O servidor roda em UTC: sem o
   * fuso, as douradas voltariam às 21h no horário de Brasília.
   */
  static diaDeBrasilia(agora = new Date()) {
    return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }

  static isSubscriber(user) {
    return Boolean(user && (user.role === 'subscriber' || user.is_sub_twitch || user.is_sub_kick));
  }

  /**
   * Douradas restantes hoje. Não existe job de reset: o uso gravado só vale
   * para o dia em `sub_lives_day`, então virar o dia já as devolve.
   */
  static getSubLives(user) {
    if (!this.isSubscriber(user)) return 0;
    const usadas =
      user.sub_lives_day === this.diaDeBrasilia() ? Number(user.sub_lives_used) || 0 : 0;
    return Math.max(0, UserModel.VIDAS_DOURADAS_POR_DIA - usadas);
  }

  static checkAndRefillLives(user) {
    if (!user) return null;
    const now = new Date();
    const lastRefill = new Date(user.last_life_refill || user.created_at);
    const hoursElapsed = (now.getTime() - lastRefill.getTime()) / (1000 * 60 * 60);

    // 1. Reset diário completo: se passaram 24h ou mais, restaura vidas para o máximo
    if (hoursElapsed >= 24 && user.lives < user.max_lives) {
      user.lives = user.max_lives;
      user.last_life_refill = now.toISOString();
    } else if (hoursElapsed >= 8 && user.lives < user.max_lives) {
      // 2. Regeneração passiva: +1 vida a cada 8 horas de intervalo
      const regen = Math.min(user.max_lives - user.lives, Math.floor(hoursElapsed / 8));
      if (regen > 0) {
        user.lives += regen;
        user.last_life_refill = new Date(
          lastRefill.getTime() + regen * 8 * 60 * 60 * 1000
        ).toISOString();
      }
    }
    return user;
  }

  /**
   * Grava no banco a regeneração que `checkAndRefillLives` calculou na leitura.
   *
   * Sem isto, a regeneração só existia no objeto devolvido: o saldo exibido subia
   * de volta para o máximo, mas `consumeLife` debita pelo valor real da linha, e o
   * jogador via vidas que não conseguia gastar. Escreve apenas quando a leitura de
   * fato regenerou algo, e o `lives < $2` mantém a escrita idempotente entre
   * leituras concorrentes (nunca reduz o saldo, nunca aplica o mesmo ganho duas
   * vezes). Falha aqui não pode derrubar uma leitura de perfil: só registra.
   */
  static persistLifeRefill(userId, livesNoBanco, refreshed) {
    if (!refreshed || refreshed.lives === livesNoBanco) return;

    db.query(`UPDATE users SET lives = $2, last_life_refill = $3 WHERE id = $1 AND lives < $2`, [
      userId,
      refreshed.lives,
      refreshed.last_life_refill
    ]).catch((err) =>
      console.warn('[UserModel.persistLifeRefill] Falha ao persistir regeneração:', err.message)
    );
  }

  /** Revoga todos os tokens ativos do usuário. Chamado no logout e na troca de
   *  senha: incrementa token_version, e qualquer JWT com versão anterior passa
   *  a ser rejeitado pelo requireAuth (P1 do ESCALA.md). */
  static async incrementarTokenVersion(userId) {
    if (!userId) return false;
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
          [userId]
        );
        return rows[0] ? Number(rows[0].token_version) : false;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.incrementarTokenVersion');
      }
    }
    const u = InMemoryStore.users.find((x) => x.id === userId);
    if (u) {
      u.token_version = Number(u.token_version || 0) + 1;
      u.tokenVersion = u.token_version;
      return u.token_version;
    }
    return false;
  }

  static async findById(id) {
    if (!id) return null;

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE id = $1
        `;
        const { rows } = await db.query(query, [id]);
        if (rows[0]) {
          const user = {
            id: rows[0].id,
            name: rows[0].name || null,
            phone: rows[0].phone || null,
            username: rows[0].username,
            email: rows[0].email,
            passwordHash: rows[0].password_hash,
            role: rows[0].role,
            lives: rows[0].lives,
            max_lives: rows[0].max_lives,
            twitch_id: rows[0].twitch_id || null,
            twitch_username: rows[0].twitch_username || null,
            kick_id: rows[0].kick_id || null,
            kick_username: rows[0].kick_username || null,
            is_sub_twitch: Boolean(rows[0].is_sub_twitch),
            is_sub_kick: Boolean(rows[0].is_sub_kick),
            last_life_refill: rows[0].last_life_refill,
            sub_lives_used: rows[0].sub_lives_used,
            sub_lives_day: rows[0].sub_lives_day,
            livepix_url: rows[0].livepix_url || null,
            pixgg_url: rows[0].pixgg_url || null,
            created_at: rows[0].created_at,
            birth_date: rows[0].birth_date || null,
            terms_accepted_at: rows[0].terms_accepted_at || null,
            terms_version: rows[0].terms_version || null,
            email_verified_at: rows[0].email_verified_at || null,
            tokenVersion: Number(rows[0].token_version || 0)
          };
          const refreshed = this.checkAndRefillLives(user);
          this.persistLifeRefill(id, rows[0].lives, refreshed);
          return refreshed;
        }
        return null;
      } catch (err) {
        // Diagnóstico CI: quando o banco está configurado mas a consulta falha,
        // o fallbackOrThrow lança (correto), mas se a tabela ainda não existe
        // (autoMigrate em outro worker), o erro real fica oculto no 404 do
        // getProfile. Loga para o log do CI revelar a causa.
        if (db.isConfigured()) {
          console.warn(
            `[UserModel.findById] Erro ao consultar id=${id} no PostgreSQL: ${err.message}`
          );
        }
        db.fallbackOrThrow(err, 'UserModel.findById');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === id) || null;
    // Garante o formato esperado pelo requireAuth (tokenVersion) no caminho
    // InMemory, onde o objeto cru do store é devolvido.
    if (user && user.tokenVersion === undefined) {
      user.tokenVersion = Number(user.token_version || 0);
    }
    return this.checkAndRefillLives(user);
  }

  static async findByUsername(username) {
    if (!username) return null;
    const cleanUsername = String(username).trim().toLowerCase();

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE LOWER(username) = LOWER($1)
        `;
        const { rows } = await db.query(query, [cleanUsername]);
        if (rows[0]) {
          const user = {
            id: rows[0].id,
            name: rows[0].name || null,
            phone: rows[0].phone || null,
            username: rows[0].username,
            email: rows[0].email,
            passwordHash: rows[0].password_hash,
            role: rows[0].role,
            lives: rows[0].lives,
            max_lives: rows[0].max_lives,
            twitch_id: rows[0].twitch_id || null,
            twitch_username: rows[0].twitch_username || null,
            kick_id: rows[0].kick_id || null,
            kick_username: rows[0].kick_username || null,
            is_sub_twitch: Boolean(rows[0].is_sub_twitch),
            is_sub_kick: Boolean(rows[0].is_sub_kick),
            last_life_refill: rows[0].last_life_refill,
            sub_lives_used: rows[0].sub_lives_used,
            sub_lives_day: rows[0].sub_lives_day,
            livepix_url: rows[0].livepix_url || null,
            pixgg_url: rows[0].pixgg_url || null,
            created_at: rows[0].created_at,
            birth_date: rows[0].birth_date || null,
            terms_accepted_at: rows[0].terms_accepted_at || null,
            terms_version: rows[0].terms_version || null,
            email_verified_at: rows[0].email_verified_at || null,
            tokenVersion: Number(rows[0].token_version || 0)
          };
          return this.checkAndRefillLives(user);
        }
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findByUsername');
      }
    }

    const user =
      InMemoryStore.users.find((u) => u.username.toLowerCase() === cleanUsername) || null;
    return this.checkAndRefillLives(user);
  }

  /**
   * Resolve vários usernames de uma vez. Usado ao procurar menções na mensagem de
   * uma doação, onde consultar palavra por palavra fazia o número de consultas
   * crescer com o tamanho do texto enviado por quem doa.
   *
   * Retorna apenas os encontrados, sem ordem garantida — quem chama decide a
   * prioridade (no webhook, a ordem em que as palavras aparecem no texto).
   */
  static async findManyByUsernames(usernames) {
    if (!Array.isArray(usernames) || usernames.length === 0) return [];
    const limpos = usernames.map((u) => String(u).trim().toLowerCase()).filter(Boolean);
    if (limpos.length === 0) return [];

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE LOWER(username) = ANY($1::text[])
        `;
        const { rows } = await db.query(query, [limpos]);
        const encontrados = rows.map((row) => ({
          id: row.id,
          name: row.name || null,
          phone: row.phone || null,
          username: row.username,
          email: row.email,
          passwordHash: row.password_hash,
          role: row.role,
          lives: row.lives,
          max_lives: row.max_lives,
          twitch_id: row.twitch_id || null,
          twitch_username: row.twitch_username || null,
          kick_id: row.kick_id || null,
          kick_username: row.kick_username || null,
          is_sub_twitch: Boolean(row.is_sub_twitch),
          is_sub_kick: Boolean(row.is_sub_kick),
          last_life_refill: row.last_life_refill,
          sub_lives_used: row.sub_lives_used,
          sub_lives_day: row.sub_lives_day,
          livepix_url: row.livepix_url || null,
          pixgg_url: row.pixgg_url || null,
          created_at: row.created_at,
          birth_date: row.birth_date || null,
          terms_accepted_at: row.terms_accepted_at || null,
          terms_version: row.terms_version || null,
          email_verified_at: row.email_verified_at || null
        }));
        return Promise.all(encontrados.map((u) => this.checkAndRefillLives(u)));
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findManyByUsernames');
      }
    }

    const alvo = new Set(limpos);
    const achados = InMemoryStore.users.filter((u) => alvo.has(u.username.toLowerCase()));
    return Promise.all(achados.map((u) => this.checkAndRefillLives(u)));
  }

  static async findByEmail(email) {
    if (!email) return null;
    const cleanEmail = String(email).trim().toLowerCase();

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE LOWER(email) = LOWER($1)
        `;
        const { rows } = await db.query(query, [cleanEmail]);
        if (rows[0]) {
          return {
            id: rows[0].id,
            name: rows[0].name || null,
            phone: rows[0].phone || null,
            username: rows[0].username,
            email: rows[0].email,
            passwordHash: rows[0].password_hash,
            role: rows[0].role,
            lives: rows[0].lives,
            max_lives: rows[0].max_lives,
            twitch_id: rows[0].twitch_id || null,
            twitch_username: rows[0].twitch_username || null,
            kick_id: rows[0].kick_id || null,
            kick_username: rows[0].kick_username || null,
            is_sub_twitch: Boolean(rows[0].is_sub_twitch),
            is_sub_kick: Boolean(rows[0].is_sub_kick),
            last_life_refill: rows[0].last_life_refill,
            sub_lives_used: rows[0].sub_lives_used,
            sub_lives_day: rows[0].sub_lives_day,
            livepix_url: rows[0].livepix_url || null,
            pixgg_url: rows[0].pixgg_url || null,
            created_at: rows[0].created_at,
            birth_date: rows[0].birth_date || null,
            terms_accepted_at: rows[0].terms_accepted_at || null,
            terms_version: rows[0].terms_version || null,
            email_verified_at: rows[0].email_verified_at || null,
            tokenVersion: Number(rows[0].token_version || 0)
          };
        }
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findByEmail');
      }
    }

    return InMemoryStore.users.find((u) => u.email.toLowerCase() === cleanEmail) || null;
  }

  // Usado pelo webhook de assinaturas da Kick para resolver o usuário local
  // (streamer dono do canal ou espectador que assinou) a partir do id
  // numérico retornado pela Kick, sem depender de um JWT/sessão ativa.
  static async findByKickId(kickId) {
    if (!kickId) return null;
    const cleanId = String(kickId);

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE kick_id = $1
        `;
        const { rows } = await db.query(query, [cleanId]);
        if (rows[0]) {
          const user = {
            id: rows[0].id,
            name: rows[0].name || null,
            phone: rows[0].phone || null,
            username: rows[0].username,
            email: rows[0].email,
            passwordHash: rows[0].password_hash,
            role: rows[0].role,
            lives: rows[0].lives,
            max_lives: rows[0].max_lives,
            twitch_id: rows[0].twitch_id || null,
            twitch_username: rows[0].twitch_username || null,
            kick_id: rows[0].kick_id || null,
            kick_username: rows[0].kick_username || null,
            is_sub_twitch: Boolean(rows[0].is_sub_twitch),
            is_sub_kick: Boolean(rows[0].is_sub_kick),
            last_life_refill: rows[0].last_life_refill,
            sub_lives_used: rows[0].sub_lives_used,
            sub_lives_day: rows[0].sub_lives_day,
            livepix_url: rows[0].livepix_url || null,
            pixgg_url: rows[0].pixgg_url || null,
            created_at: rows[0].created_at,
            birth_date: rows[0].birth_date || null,
            terms_accepted_at: rows[0].terms_accepted_at || null,
            terms_version: rows[0].terms_version || null,
            email_verified_at: rows[0].email_verified_at || null,
            tokenVersion: Number(rows[0].token_version || 0)
          };
          return this.checkAndRefillLives(user);
        }
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findByKickId');
      }
    }

    const user = InMemoryStore.users.find((u) => u.kick_id === cleanId) || null;
    return this.checkAndRefillLives(user);
  }

  static async deleteByUsername(username) {
    if (!username) return false;
    const cleanUsername = String(username).trim().toLowerCase();

    if (db.isAvailable()) {
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM streamer_wallet_transactions WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query(
          'DELETE FROM streamer_wallets WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query(
          'DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query(
          'DELETE FROM user_inventory WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query(
          'DELETE FROM flight_runs WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query(
          'DELETE FROM reward_redemptions WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = LOWER($1))',
          [cleanUsername]
        );
        await client.query('DELETE FROM users WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
        await client.query('COMMIT');
        console.log(
          `[UserModel.deleteByUsername] DB: Usuário '${cleanUsername}' e registros associados removidos com sucesso.`
        );
      } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('[UserModel.deleteByUsername] Erro ao deletar no DB:', err.message);
      } finally {
        if (client) client.release();
      }
    }

    const targetUser = InMemoryStore.users.find((u) => u.username.toLowerCase() === cleanUsername);
    if (targetUser) {
      InMemoryStore.users = InMemoryStore.users.filter(
        (u) => u.username.toLowerCase() !== cleanUsername
      );
      InMemoryStore.wallets = InMemoryStore.wallets.filter((w) => w.user_id !== targetUser.id);
      InMemoryStore.streamerWallets = InMemoryStore.streamerWallets.filter(
        (sw) => sw.user_id !== targetUser.id
      );
    }
    return true;
  }

  static async create({
    name = null,
    phone = null,
    username,
    email,
    password,
    role = 'viewer',
    birthDate = null,
    termsVersion = null
  }) {
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();

    const existingUser = await this.findByUsername(cleanUsername);
    if (existingUser) {
      throw new Error('USERNAME_EXISTS');
    }

    const existingEmail = await this.findByEmail(cleanEmail);
    if (existingEmail) {
      throw new Error('EMAIL_EXISTS');
    }

    const maxLives = this.getRoleMaxLives(role);
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const id = randomUUID();

    if (db.isAvailable()) {
      try {
        // terms_accepted_at sai de NOW() no próprio INSERT: a hora do aceite é a
        // hora em que a conta nasceu, e é esse registro que serve de prova de
        // consentimento. Ver migrations/016.
        const query = `
          INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives, last_life_refill, created_at, birth_date, terms_accepted_at, terms_version)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)
          RETURNING id, name, phone, username, email, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick, created_at, birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
        `;
        const { rows } = await db.query(query, [
          id,
          name,
          phone,
          cleanUsername,
          cleanEmail,
          passwordHash,
          role,
          maxLives,
          maxLives,
          now,
          now,
          birthDate,
          termsVersion
        ]);

        // Cria a carteira inicial no DB
        await db.query(
          `
          INSERT INTO wallets (id, user_id, balance, currency_code)
          VALUES ($1, $2, $3, $4)
        `,
          [randomUUID(), id, 0, 'credits']
        ); // Sem bônus: moedas só existem por canal (migration 022)

        const created = rows[0];
        console.log(
          `[UserModel.create] DB: Novo usuário registrado no PostgreSQL: '${cleanUsername}' (ID: ${created.id})`
        );
        return created;
      } catch (err) {
        if (err.code === '23505') {
          // PostgreSQL unique_violation
          if (err.detail && err.detail.toLowerCase().includes('email')) {
            throw new Error('EMAIL_EXISTS', { cause: err });
          }
          throw new Error('USERNAME_EXISTS', { cause: err });
        }
        console.error('[UserModel.create] Erro no PostgreSQL:', err.message);
        throw err;
      }
    }

    // Criação em memória
    const newUser = {
      id,
      name,
      phone,
      username,
      email,
      passwordHash,
      role,
      lives: maxLives,
      max_lives: maxLives,
      twitch_id: null,
      twitch_username: null,
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      last_life_refill: now,
      created_at: now,
      birth_date: birthDate,
      terms_accepted_at: now,
      terms_version: termsVersion,
      email_verified_at: null,
      token_version: 0,
      tokenVersion: 0
    };

    InMemoryStore.users.push(newUser);
    InMemoryStore.wallets.push({
      id: `w-${id}`,
      user_id: id,
      balance: 0,
      currency_code: 'credits',
      updated_at: now
    });

    return {
      id: newUser.id,
      name: newUser.name,
      phone: newUser.phone,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      lives: newUser.lives,
      max_lives: newUser.max_lives,
      twitch_id: null,
      twitch_username: null,
      kick_id: null,
      kick_username: null,
      is_sub_twitch: false,
      is_sub_kick: false,
      created_at: newUser.created_at,
      birth_date: newUser.birth_date,
      terms_accepted_at: newUser.terms_accepted_at,
      terms_version: newUser.terms_version,
      email_verified_at: null,
      tokenVersion: 0,
      token_version: 0
    };
  }

  /**
   * Debita uma vida de forma atômica e condicional: só consome se ainda houver
   * saldo. Retorna null quando não havia vida disponível, e é isso que autoriza
   * (ou não) a partida.
   *
   * Verificar `lives > 0` numa leitura anterior e debitar depois abre uma janela
   * entre as duas queries — com o banco remoto, centenas de milissegundos. Vários
   * lançamentos paralelos passavam todos pela verificação e jogavam com a mesma
   * vida, multiplicando as moedas ganhas. A condição precisa estar no próprio
   * UPDATE. Streamers jogam sem limite, então nunca são debitados.
   */
  static async consumeLife(userId) {
    // Dourada primeiro: ela some à meia-noite e a normal regenera sozinha.
    // Gastar a normal antes faria o sub perder, no fim do dia, as douradas que
    // não usou. Mesmo cuidado de atomicidade da normal: a condição vai no UPDATE.
    const hoje = this.diaDeBrasilia();

    if (db.isAvailable()) {
      try {
        const { rows: dourada } = await db.query(
          `UPDATE users
           SET sub_lives_used = CASE WHEN sub_lives_day = $2 THEN sub_lives_used + 1 ELSE 1 END,
               sub_lives_day = $2
           WHERE id = $1 AND role <> 'streamer'
             AND (role = 'subscriber' OR is_sub_twitch OR is_sub_kick)
             AND (sub_lives_day IS DISTINCT FROM $2 OR sub_lives_used < $3)
           RETURNING lives, max_lives, role, sub_lives_used`,
          [userId, hoje, UserModel.VIDAS_DOURADAS_POR_DIA]
        );
        if (dourada[0]) {
          const userInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (userInMemory) {
            userInMemory.sub_lives_used = dourada[0].sub_lives_used;
            userInMemory.sub_lives_day = hoje;
          }
          return { ...dourada[0], usouDourada: true };
        }

        const query = `
          UPDATE users
          SET lives = CASE WHEN role = 'streamer' THEN lives ELSE lives - 1 END,
              last_life_refill = CASE
                WHEN role <> 'streamer' AND lives >= max_lives THEN NOW()
                ELSE last_life_refill
              END
          WHERE id = $1 AND (lives > 0 OR role = 'streamer')
          RETURNING lives, max_lives, role, last_life_refill
        `;
        const { rows } = await db.query(query, [userId]);
        if (rows[0]) {
          const userInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (userInMemory) {
            userInMemory.lives = rows[0].lives;
            userInMemory.last_life_refill = rows[0].last_life_refill;
          }
          return rows[0];
        }
        // Nenhuma linha afetada: ou o usuário não existe, ou ficou sem vidas.
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.consumeLife');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    if (user.role === 'streamer') {
      return { lives: user.lives, max_lives: user.max_lives, role: user.role };
    }

    if (this.getSubLives(user) > 0) {
      user.sub_lives_used = user.sub_lives_day === hoje ? (user.sub_lives_used || 0) + 1 : 1;
      user.sub_lives_day = hoje;
      return { lives: user.lives, max_lives: user.max_lives, role: user.role, usouDourada: true };
    }

    if (user.lives <= 0) return null;

    // Sair do saldo cheio inicia o relógio de regeneração. Sem este carimbo,
    // `last_life_refill` ficava preso em `created_at` e `checkAndRefillLives`
    // via 24h+ decorridas na leitura seguinte, devolvendo a vida recém-gasta —
    // era isso que tornava as vidas diárias infinitas.
    if (user.lives >= user.max_lives) {
      user.last_life_refill = new Date().toISOString();
    }

    user.lives -= 1;
    return { lives: user.lives, max_lives: user.max_lives, role: user.role };
  }

  /**
   * Devolve uma dourada debitada para uma partida que não aconteceu. Sem isto o
   * estorno do GameRunService virava vida normal — e, com as normais cheias, nada.
   */
  static async refundSubLife(userId) {
    if (db.isAvailable()) {
      try {
        await db.query(
          'UPDATE users SET sub_lives_used = GREATEST(0, sub_lives_used - 1) WHERE id = $1',
          [userId]
        );
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.refundSubLife');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (user) user.sub_lives_used = Math.max(0, (user.sub_lives_used || 0) - 1);
  }

  /**
   * Adiciona uma vida.
   *
   * @param {string} userId
   * @param {{acimaDoMaximo?: boolean}} [opcoes] `acimaDoMaximo` deixa o saldo
   *   passar de max_lives. É o que um prêmio ou item comprado precisa: com
   *   LEAST(max_lives, ...) fixo, quem estava com as vidas cheias recebia zero —
   *   a "+1 Vida Extra" da roleta gastava o giro do dia sem entregar nada, e a
   *   Bateria de Vidas cobrava 150 moedas por coisa nenhuma. O estorno de uma
   *   partida que não aconteceu (ver GameRunService) usa o padrão, com teto, porque
   *   aí é devolver o que foi debitado, não conceder algo novo.
   *
   *   Ficar acima do máximo é seguro no resto do modelo: checkAndRefillLives só
   *   soma quando lives < max_lives, então o excedente não é zerado pela
   *   regeneração, e consumeLife apenas decrementa.
   */
  static async addExtraLife(userId, { acimaDoMaximo = false } = {}) {
    if (db.isAvailable()) {
      try {
        const query = `
          UPDATE users
          SET lives = CASE WHEN $2 THEN lives + 1 ELSE LEAST(max_lives, lives + 1) END
          WHERE id = $1
          RETURNING lives, max_lives
        `;
        const { rows } = await db.query(query, [userId, acimaDoMaximo]);
        if (rows[0]) {
          const userInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (userInMemory) userInMemory.lives = rows[0].lives;
          return rows[0];
        }
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.addExtraLife');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    user.lives = acimaDoMaximo ? user.lives + 1 : Math.min(user.max_lives, user.lives + 1);
    return { lives: user.lives, max_lives: user.max_lives };
  }

  /**
   * Define o saldo de vidas diretamente. Existe só para o Centro de Simulação
   * (ver routes/dev.js), que precisa montar o estado "sem vidas" e desfazê-lo.
   *
   * Encher também carimba `last_life_refill`: sem o carimbo, a leitura seguinte
   * veria as 24h de `created_at` já vencidas e a regeneração devolveria vidas
   * por conta própria — o mesmo laço que o comentário de consumeLife descreve,
   * que tornaria o botão "Zerar Vidas" incapaz de manter o saldo em zero.
   */
  static async setLives(userId, lives) {
    const alvo = Math.max(0, Math.floor(Number(lives) || 0));

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE users SET lives = $2, last_life_refill = NOW() WHERE id = $1
           RETURNING lives, max_lives`,
          [userId, alvo]
        );
        if (rows[0]) {
          const userInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (userInMemory) {
            userInMemory.lives = rows[0].lives;
            userInMemory.last_life_refill = new Date().toISOString();
          }
          return rows[0];
        }
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.setLives');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    user.lives = alvo;
    user.last_life_refill = new Date().toISOString();
    return { lives: user.lives, max_lives: user.max_lives };
  }

  static async findByPhone(phone) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return null;

    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, name, phone, username, email, password_hash, role, lives, max_lives,
                 twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick,
                 last_life_refill, sub_lives_used, sub_lives_day, livepix_url, pixgg_url, created_at,
                 birth_date, terms_accepted_at, terms_version, email_verified_at, token_version
          FROM users
          WHERE regexp_replace(phone, '\\D', '', 'g') = $1
        `;
        const { rows } = await db.query(query, [cleanPhone]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findByPhone');
      }
    }

    return (
      InMemoryStore.users.find((u) => u.phone && u.phone.replace(/\D/g, '') === cleanPhone) || null
    );
  }

  static async linkStreamAccount(
    userId,
    { provider, accountId = null, accountUsername, isSubscriber = false }
  ) {
    const user = await this.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const normProvider = (provider || '').toLowerCase().trim();
    if (normProvider !== 'twitch' && normProvider !== 'kick') {
      throw new Error('INVALID_PROVIDER');
    }

    if (!accountUsername || !accountUsername.trim()) {
      throw new Error('MISSING_ACCOUNT_USERNAME');
    }

    const cleanUsername = accountUsername.trim();
    const isSub = Boolean(isSubscriber);

    let updatedRole = user.role;
    const maxLives = user.max_lives;
    const lives = user.lives;

    // Sub em Twitch ou Kick vira 'subscriber'. As vidas normais não mudam: o
    // benefício são as douradas, que saem do cargo (ver getSubLives).
    const willBeSub = isSub || (normProvider === 'twitch' ? user.is_sub_kick : user.is_sub_twitch);
    if (willBeSub && updatedRole === 'viewer') updatedRole = 'subscriber';

    const generatedId = accountId || `${normProvider}-${Date.now()}`;

    if (db.isAvailable()) {
      try {
        const query =
          normProvider === 'twitch'
            ? `
          UPDATE users
          SET twitch_id = $2, twitch_username = $3, is_sub_twitch = $4, role = $5, max_lives = $6, lives = $7
          WHERE id = $1
          RETURNING id, name, phone, username, email, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick, last_life_refill, sub_lives_used, sub_lives_day, created_at
        `
            : `
          UPDATE users
          SET kick_id = $2, kick_username = $3, is_sub_kick = $4, role = $5, max_lives = $6, lives = $7
          WHERE id = $1
          RETURNING id, name, phone, username, email, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick, last_life_refill, sub_lives_used, sub_lives_day, created_at
        `;
        const { rows } = await db.query(query, [
          userId,
          generatedId,
          cleanUsername,
          isSub,
          updatedRole,
          maxLives,
          lives
        ]);
        if (rows[0]) {
          const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (uInMemory) Object.assign(uInMemory, rows[0]);
          return rows[0];
        }
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.linkStreamAccount');
      }
    }

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (!uInMemory) throw new Error('USER_NOT_FOUND');

    if (normProvider === 'twitch') {
      uInMemory.twitch_id = generatedId;
      uInMemory.twitch_username = cleanUsername;
      uInMemory.is_sub_twitch = isSub;
    } else {
      uInMemory.kick_id = generatedId;
      uInMemory.kick_username = cleanUsername;
      uInMemory.is_sub_kick = isSub;
    }

    if (willBeSub && uInMemory.role === 'viewer') uInMemory.role = 'subscriber';

    return {
      id: uInMemory.id,
      name: uInMemory.name,
      phone: uInMemory.phone,
      username: uInMemory.username,
      email: uInMemory.email,
      role: uInMemory.role,
      lives: uInMemory.lives,
      max_lives: uInMemory.max_lives,
      twitch_id: uInMemory.twitch_id,
      twitch_username: uInMemory.twitch_username,
      kick_id: uInMemory.kick_id,
      kick_username: uInMemory.kick_username,
      is_sub_twitch: uInMemory.is_sub_twitch,
      is_sub_kick: uInMemory.is_sub_kick,
      sub_lives_used: uInMemory.sub_lives_used,
      sub_lives_day: uInMemory.sub_lives_day,
      created_at: uInMemory.created_at
    };
  }

  static async unlinkStreamAccount(userId, provider) {
    const user = await this.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const normProvider = (provider || '').toLowerCase().trim();
    if (normProvider !== 'twitch' && normProvider !== 'kick') {
      throw new Error('INVALID_PROVIDER');
    }

    const isSubTwitch = normProvider === 'twitch' ? false : user.is_sub_twitch;
    const isSubKick = normProvider === 'kick' ? false : user.is_sub_kick;
    let updatedRole = user.role;
    let maxLives = user.max_lives;
    let lives = user.lives;

    // Se não for mais sub em nenhuma e era subscriber, volta para viewer (3 vidas)
    if (!isSubTwitch && !isSubKick && updatedRole === 'subscriber') {
      updatedRole = 'viewer';
      maxLives = 3;
      if (lives > 3) lives = 3;
    }

    if (db.isAvailable()) {
      try {
        const query =
          normProvider === 'twitch'
            ? `
          UPDATE users
          SET twitch_id = NULL, twitch_username = NULL, is_sub_twitch = FALSE, role = $2, max_lives = $3, lives = $4
          WHERE id = $1
          RETURNING id, name, phone, username, email, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick, last_life_refill, sub_lives_used, sub_lives_day, created_at
        `
            : `
          UPDATE users
          SET kick_id = NULL, kick_username = NULL, is_sub_kick = FALSE, role = $2, max_lives = $3, lives = $4
          WHERE id = $1
          RETURNING id, name, phone, username, email, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username, is_sub_twitch, is_sub_kick, last_life_refill, sub_lives_used, sub_lives_day, created_at
        `;
        const { rows } = await db.query(query, [userId, updatedRole, maxLives, lives]);
        if (rows[0]) {
          const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
          if (uInMemory) Object.assign(uInMemory, rows[0]);
          return rows[0];
        }
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.unlinkStreamAccount');
      }
    }

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (!uInMemory) throw new Error('USER_NOT_FOUND');

    if (normProvider === 'twitch') {
      uInMemory.twitch_id = null;
      uInMemory.twitch_username = null;
      uInMemory.is_sub_twitch = false;
    } else {
      uInMemory.kick_id = null;
      uInMemory.kick_username = null;
      uInMemory.is_sub_kick = false;
    }

    if (!uInMemory.is_sub_twitch && !uInMemory.is_sub_kick && uInMemory.role === 'subscriber') {
      uInMemory.role = 'viewer';
      uInMemory.max_lives = 3;
      if (uInMemory.lives > 3) uInMemory.lives = 3;
    }

    return {
      id: uInMemory.id,
      name: uInMemory.name,
      phone: uInMemory.phone,
      username: uInMemory.username,
      email: uInMemory.email,
      role: uInMemory.role,
      lives: uInMemory.lives,
      max_lives: uInMemory.max_lives,
      twitch_id: uInMemory.twitch_id,
      twitch_username: uInMemory.twitch_username,
      kick_id: uInMemory.kick_id,
      kick_username: uInMemory.kick_username,
      is_sub_twitch: uInMemory.is_sub_twitch,
      is_sub_kick: uInMemory.is_sub_kick,
      sub_lives_used: uInMemory.sub_lives_used,
      sub_lives_day: uInMemory.sub_lives_day,
      created_at: uInMemory.created_at
    };
  }

  /**
   * Troca a senha. Usado pela redefinição por e-mail (ver AuthService).
   *
   * Invalida a sessão antiga por consequência? Não: o JWT já emitido continua
   * válido até expirar (24h). Se o motivo da redefinição for conta invadida,
   * isso é uma janela — vale trocar por um `token_version` na conta no futuro.
   */
  static async updatePassword(userId, novaSenha) {
    const passwordHash = await bcrypt.hash(novaSenha, 10);

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`,
          [userId, passwordHash]
        );
        if (rows[0]) return true;
        return false;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.updatePassword');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user) return false;
    user.passwordHash = passwordHash;
    return true;
  }

  /** Marca o endereço como confirmado, se ainda for o mesmo do cadastro. */
  static async markEmailVerified(userId, email) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE users SET email_verified_at = NOW()
           WHERE id = $1 AND LOWER(email) = LOWER($2)
           RETURNING id`,
          [userId, email]
        );
        return Boolean(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.markEmailVerified');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user || String(user.email).toLowerCase() !== String(email).toLowerCase()) return false;
    user.email_verified_at = new Date().toISOString();
    return true;
  }

  /**
   * Registra o aceite dos termos de uma conta que já existia antes do aceite
   * passar a ser obrigatório no cadastro.
   */
  static async registrarAceiteDeTermos(userId, { versao, birthDate = null }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE users
           SET terms_accepted_at = NOW(),
               terms_version = $2,
               birth_date = COALESCE($3, birth_date)
           WHERE id = $1
           RETURNING id`,
          [userId, versao, birthDate]
        );
        return Boolean(rows[0]);
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.registrarAceiteDeTermos');
      }
    }

    const user = InMemoryStore.users.find((u) => u.id === userId);
    if (!user) return false;
    user.terms_accepted_at = new Date().toISOString();
    user.terms_version = versao;
    if (birthDate) user.birth_date = birthDate;
    return true;
  }

  static async updateStreamerSettings(userId, { livepixUrl, pixggUrl }) {
    const user = await this.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (uInMemory) {
      if (livepixUrl !== undefined) uInMemory.livepix_url = livepixUrl;
      if (pixggUrl !== undefined) uInMemory.pixgg_url = pixggUrl;
    }

    if (db.isAvailable()) {
      try {
        await db.query(`UPDATE users SET livepix_url = $1, pixgg_url = $2 WHERE id = $3`, [
          livepixUrl || null,
          pixggUrl || null,
          userId
        ]);
      } catch (err) {
        // Coluna pode não existir em schema legado, fallback gracioso
        console.warn('[UserModel.updateStreamerSettings] Postgres fallback:', err.message);
      }
    }

    return {
      id: user.id,
      username: user.username,
      livepix_url: livepixUrl !== undefined ? livepixUrl : uInMemory?.livepix_url || null,
      pixgg_url: pixggUrl !== undefined ? pixggUrl : uInMemory?.pixgg_url || null
    };
  }

  static async updateProfile(userId, { name, phone }) {
    const user = await this.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const cleanName = name !== undefined ? (name ? String(name).trim() : null) : user.name;
    const cleanPhone = phone !== undefined ? (phone ? String(phone).trim() : null) : user.phone;

    if (db.isAvailable()) {
      try {
        await db.query(`UPDATE users SET name = $1, phone = $2 WHERE id = $3`, [
          cleanName,
          cleanPhone,
          userId
        ]);
      } catch (err) {
        console.warn('[UserModel.updateProfile] Postgres fallback:', err.message);
      }
    }

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (uInMemory) {
      uInMemory.name = cleanName;
      uInMemory.phone = cleanPhone;
    }

    return this.findById(userId);
  }

  static async promoteToAdmin(userId) {
    const maxLives = this.getRoleMaxLives('admin');

    if (db.isAvailable()) {
      try {
        await db.query(
          `UPDATE users SET role = 'admin', max_lives = $1, lives = $1 WHERE id = $2`,
          [maxLives, userId]
        );
      } catch (err) {
        console.warn('[UserModel.promoteToAdmin] Postgres fallback:', err.message);
      }
    }

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (uInMemory) {
      uInMemory.role = 'admin';
      uInMemory.max_lives = maxLives;
      uInMemory.lives = maxLives;
    }

    return this.findById(userId);
  }

  static async promoteToStreamer(userId) {
    const maxLives = this.getRoleMaxLives('streamer');

    if (db.isAvailable()) {
      try {
        await db.query(
          `UPDATE users SET role = 'streamer', max_lives = $1, lives = $1 WHERE id = $2`,
          [maxLives, userId]
        );
      } catch (err) {
        console.warn('[UserModel.promoteToStreamer] Postgres fallback:', err.message);
      }
    }

    const uInMemory = InMemoryStore.users.find((u) => u.id === userId);
    if (uInMemory) {
      uInMemory.role = 'streamer';
      uInMemory.max_lives = maxLives;
      uInMemory.lives = maxLives;
    }

    return this.findById(userId);
  }

  static async findAllStreamers() {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT id, username, name, role, created_at FROM users WHERE role IN ('streamer') ORDER BY username ASC`
        );
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'UserModel.findAllStreamers');
      }
    }

    return InMemoryStore.users
      .filter((u) => u.role === 'streamer')
      .map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        created_at: u.created_at
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }
}

module.exports = UserModel;
