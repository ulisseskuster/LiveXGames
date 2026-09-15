const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class DonationModel {
  static async findByExternalId(externalId) {
    if (db.isAvailable()) {
      try {
        const query = `
          SELECT id, user_id, provider, external_id, amount_cents, coins_credited, status, credited_at, metadata, created_at
          FROM donations
          WHERE external_id = $1
        `;
        const { rows } = await db.query(query, [externalId]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.findByExternalId');
      }
    }

    return InMemoryStore.donations.find((d) => d.external_id === externalId) || null;
  }

  static async create({
    userId,
    provider = 'livepix',
    externalId,
    amountCents,
    coinsCredited,
    streamerId = null,
    metadata = {},
    status = 'completed'
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();

    if (db.isAvailable()) {
      try {
        // ON CONFLICT DO NOTHING é o que torna a idempotência real: o índice
        // único idx_donations_external_id (migração 004) decide quem grava, e a
        // ausência de linha na volta significa "este external_id já foi
        // processado". Antes o INSERT duplicado estourava 23505, o catch engolia
        // o erro e a chamada devolvia sucesso — com as moedas já creditadas.
        const query = `
          INSERT INTO donations (id, user_id, provider, external_id, amount_cents, coins_credited, streamer_id, status, metadata, created_at, credited_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (external_id) DO NOTHING
          RETURNING *
        `;
        const { rows } = await db.query(query, [
          id,
          userId,
          provider,
          externalId,
          amountCents,
          coinsCredited,
          streamerId,
          status,
          JSON.stringify(metadata),
          now,
          status === 'completed' ? now : null
        ]);

        // Sem linha de volta: outra entrega do mesmo webhook chegou primeiro.
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.create');
      }
    }

    // Mesma garantia no modo sem banco, para os testes unitários valerem.
    if (InMemoryStore.donations.some((d) => d.external_id === externalId)) {
      return null;
    }

    const donation = {
      id,
      user_id: userId,
      provider,
      external_id: externalId,
      amount_cents: amountCents,
      coins_credited: coinsCredited,
      streamer_id: streamerId,
      status,
      credited_at: status === 'completed' ? now : null,
      metadata,
      created_at: now
    };

    InMemoryStore.donations.push(donation);
    return donation;
  }

  /**
   * Versão transacional de create: insere a doação usando um client já em
   * BEGIN, devolvendo a linha ou null se o external_id já existir (ON CONFLICT
   * DO NOTHING). Usada pelo LivePixService para gravar doação + crédito na
   * mesma transação (P0-A).
   */
  static async createWithClient(client, fields) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const {
      userId,
      provider = 'livepix',
      externalId,
      amountCents,
      coinsCredited,
      streamerId = null,
      metadata = {},
      status = 'completed'
    } = fields;

    const { rows } = await client.query(
      `INSERT INTO donations (id, user_id, provider, external_id, amount_cents, coins_credited, streamer_id, status, metadata, created_at, credited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (external_id) DO NOTHING
       RETURNING *`,
      [
        id,
        userId,
        provider,
        externalId,
        amountCents,
        coinsCredited,
        streamerId,
        status,
        JSON.stringify(metadata),
        now,
        status === 'completed' ? now : null
      ]
    );
    return rows[0] || null;
  }

  // ─── Reconciliação de crédito (P0-A) ─────────────────────────────────────
  // Uma doação pode ficar 'pending' por dois motivos:
  //   - o crédito falhou depois do INSERT (a transação antiga não era atômica);
  //   - o processo caiu entre gravar a doação e creditar a carteira.
  // Em ambos os casos o valor já foi recebido do gateway e o usuário tem
  // direito ao saldo. Reconciliação é idempotente: só credita se ainda não há
  // comprovante (channel_wallet_transactions com donation.external_id).

  static async listarPendentes({ limit = 50 } = {}) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT * FROM donations
           WHERE status = 'pending'
           ORDER BY created_at ASC
           LIMIT $1`,
          [limit]
        );
        return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.listarPendentes');
      }
    }
    return InMemoryStore.donations.filter((d) => d.status === 'pending').slice(0, limit);
  }

  /** Marca uma doação como pendente de crédito (só se ainda estiver completed/pending e sem credited_at). */
  static async marcarPendente(donationId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE donations SET status = 'pending', credited_at = NULL
           WHERE id = $1 AND credited_at IS NULL
           RETURNING *`,
          [donationId]
        );
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.marcarPendente');
      }
    }
    const d = InMemoryStore.donations.find((x) => x.id === donationId);
    if (!d || d.credited_at) return null;
    d.status = 'pending';
    d.credited_at = null;
    return d;
  }

  /** Confirma o crédito: status completed + credited_at, só se ainda não estava confirmado. */
  static async confirmarCredito(donationId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE donations SET status = 'completed', credited_at = NOW()
           WHERE id = $1 AND credited_at IS NULL
           RETURNING *`,
          [donationId]
        );
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.confirmarCredito');
      }
    }
    const d = InMemoryStore.donations.find((x) => x.id === donationId);
    if (!d || d.credited_at) return null;
    d.status = 'completed';
    d.credited_at = new Date().toISOString();
    return d;
  }

  // ─── Mural Social de Doações ──────────────────────────────────────────────

  /**
   * Ordenações do mural, de allowlist.
   *
   * Query param NUNCA é interpolado em SQL: o valor recebido só escolhe uma
   * chave deste objeto, e qualquer coisa fora dele cai no padrão 'recent'.
   */
  static WALL_SORTS = {
    recent: 'd.created_at DESC',
    likes: 'likes_count DESC, d.created_at DESC',
    dislikes: 'dislikes_count DESC, d.created_at DESC'
  };

  /** Janelas do ranking, também de allowlist. `all` não filtra data. */
  static WALL_PERIODS = {
    all: null,
    weekly: '7 days',
    monthly: '30 days'
  };

  static async findById(donationId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(`SELECT * FROM donations WHERE id = $1`, [donationId]);
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.findById');
      }
    }

    return InMemoryStore.donations.find((d) => d.id === donationId) || null;
  }

  /**
   * A query única do feed E do ranking: a diferença entre os dois é só o
   * ORDER BY e a janela de data, ambos vindos de allowlist.
   *
   * Busca `limit + 1` linhas para saber se há próxima página sem um COUNT(*)
   * separado sobre a tabela inteira.
   */
  static async listWall({
    streamerId,
    sort = 'recent',
    period = 'all',
    limit = 50,
    offset = 0,
    viewerId = null
  }) {
    const orderBy = DonationModel.WALL_SORTS[sort] || DonationModel.WALL_SORTS.recent;
    const interval = Object.prototype.hasOwnProperty.call(DonationModel.WALL_PERIODS, period)
      ? DonationModel.WALL_PERIODS[period]
      : null;

    if (db.isAvailable()) {
      try {
        // `orderBy` vem da allowlist WALL_SORTS, nunca do query param cru.
        const query = `
          SELECT
            d.id,
            d.amount_cents,
            d.created_at,
            d.user_id AS donor_id,
            d.metadata->>'message' AS message,
            d.metadata->>'username' AS metadata_username,
            u.username AS donor_username,
            u.role,
            COUNT(*) FILTER (WHERE r.reaction_type = 'like')    AS likes_count,
            COUNT(*) FILTER (WHERE r.reaction_type = 'dislike') AS dislikes_count,
            MAX(CASE WHEN r.user_id = $4::uuid THEN r.reaction_type END) AS my_reaction
          FROM donations d
          LEFT JOIN users u              ON u.id = d.user_id
          LEFT JOIN donation_reactions r ON r.donation_id = d.id
          WHERE d.streamer_id = $1
            AND d.status = 'completed'
            AND d.hidden_from_wall = FALSE
            AND COALESCE(d.metadata->>'message', '') <> ''
            AND ($5::interval IS NULL OR d.created_at >= NOW() - $5::interval)
          GROUP BY d.id, u.id
          ORDER BY ${orderBy}
          LIMIT $2 OFFSET $3
        `;
        const { rows } = await db.query(query, [streamerId, limit + 1, offset, viewerId, interval]);
        return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.listWall');
      }
    }

    const cutoff = interval ? Date.now() - parseInt(interval, 10) * 24 * 60 * 60 * 1000 : null;

    const linhas = InMemoryStore.donations
      .filter(
        (d) =>
          d.streamer_id === streamerId &&
          d.status === 'completed' &&
          !d.hidden_from_wall &&
          String((d.metadata && d.metadata.message) || '') !== '' &&
          (cutoff === null || new Date(d.created_at).getTime() >= cutoff)
      )
      .map((d) => {
        const reacoes = InMemoryStore.donationReactions.filter((r) => r.donation_id === d.id);
        const donor = InMemoryStore.users.find((u) => u.id === d.user_id) || null;
        const minha = viewerId ? reacoes.find((r) => r.user_id === viewerId) : null;
        return {
          id: d.id,
          amount_cents: d.amount_cents,
          created_at: d.created_at,
          donor_id: d.user_id,
          message: (d.metadata && d.metadata.message) || null,
          metadata_username: (d.metadata && d.metadata.username) || null,
          donor_username: donor ? donor.username : null,
          role: donor ? donor.role : null,
          likes_count: reacoes.filter((r) => r.reaction_type === 'like').length,
          dislikes_count: reacoes.filter((r) => r.reaction_type === 'dislike').length,
          my_reaction: minha ? minha.reaction_type : null
        };
      });

    const porData = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    if (sort === 'likes') {
      linhas.sort((a, b) => b.likes_count - a.likes_count || porData(a, b));
    } else if (sort === 'dislikes') {
      linhas.sort((a, b) => b.dislikes_count - a.dislikes_count || porData(a, b));
    } else {
      linhas.sort(porData);
    }

    const pagina = linhas.slice(offset, offset + limit + 1);
    return { rows: pagina.slice(0, limit), hasMore: pagina.length > limit };
  }

  /**
   * Maiores doadores do canal no período. Soma todas as doações concluídas, com
   * ou sem mensagem e mesmo as ocultadas do mural: o ranking é do dinheiro doado,
   * não do card. Doação vinculada agrupa pelo usuário; não vinculada, pelo nome
   * informado no webhook; sem nenhum dos dois é anônima e fica de fora.
   */
  static async topDonors({ streamerId, period = 'all', limit = 10 }) {
    const interval = Object.prototype.hasOwnProperty.call(DonationModel.WALL_PERIODS, period)
      ? DonationModel.WALL_PERIODS[period]
      : null;

    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT
             COALESCE(d.user_id::text, 'nome:' || LOWER(d.metadata->>'username')) AS donor_key,
             MAX(u.username)              AS donor_username,
             MAX(d.metadata->>'username') AS metadata_username,
             MAX(u.role)                  AS role,
             SUM(d.amount_cents)          AS total_cents,
             COUNT(*)                     AS donations_count,
             MAX(d.created_at)            AS last_donation_at
           FROM donations d
           LEFT JOIN users u ON u.id = d.user_id
           WHERE d.streamer_id = $1
             AND d.status = 'completed'
             AND (
               d.user_id IS NOT NULL
               OR LOWER(COALESCE(d.metadata->>'username', '')) NOT IN ('', 'anônimo')
             )
             AND ($3::interval IS NULL OR d.created_at >= NOW() - $3::interval)
           GROUP BY donor_key
           ORDER BY total_cents DESC, last_donation_at DESC
           LIMIT $2`,
          [streamerId, limit, interval]
        );
        return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.topDonors');
      }
    }

    const cutoff = interval ? Date.now() - parseInt(interval, 10) * 24 * 60 * 60 * 1000 : null;
    const grupos = new Map();
    for (const d of InMemoryStore.donations) {
      const nome = (d.metadata && d.metadata.username) || '';
      if (d.streamer_id !== streamerId || d.status !== 'completed') continue;
      // O webhook grava 'Anônimo' quando a doação chega sem nome: não é um doador.
      if (!d.user_id && (!nome || nome.toLowerCase() === 'anônimo')) continue;
      if (cutoff !== null && new Date(d.created_at).getTime() < cutoff) continue;

      const chave = d.user_id || `nome:${nome.toLowerCase()}`;
      const doador = d.user_id ? InMemoryStore.users.find((u) => u.id === d.user_id) : null;
      const grupo = grupos.get(chave) || {
        donor_key: chave,
        donor_username: doador ? doador.username : null,
        metadata_username: nome || null,
        role: doador ? doador.role : null,
        total_cents: 0,
        donations_count: 0,
        last_donation_at: d.created_at
      };
      grupo.total_cents += Number(d.amount_cents) || 0;
      grupo.donations_count += 1;
      if (new Date(d.created_at) > new Date(grupo.last_donation_at)) {
        grupo.last_donation_at = d.created_at;
      }
      grupos.set(chave, grupo);
    }

    return [...grupos.values()]
      .sort(
        (a, b) =>
          b.total_cents - a.total_cents ||
          new Date(b.last_donation_at) - new Date(a.last_donation_at)
      )
      .slice(0, limit);
  }

  /**
   * Reage, troca de lado ou remove — os três casos numa ida ao banco na maioria
   * das vezes.
   *
   * O ON CONFLICT com WHERE só grava quando o tipo MUDA. Linha de volta =
   * reagiu ou trocou de lado. Sem linha = clicou no mesmo botão de novo, e aí o
   * DELETE remove a reação. Ler-depois-escrever abriria corrida entre dois
   * cliques simultâneos; o UNIQUE(donation_id, user_id) resolve dentro do banco.
   *
   * @returns {Promise<'like'|'dislike'|null>} a reação que ficou valendo.
   */
  static async react({ donationId, userId, type }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO donation_reactions (donation_id, user_id, reaction_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (donation_id, user_id) DO UPDATE
             SET reaction_type = EXCLUDED.reaction_type,
                 created_at    = NOW()
             WHERE donation_reactions.reaction_type <> EXCLUDED.reaction_type
           RETURNING reaction_type`,
          [donationId, userId, type]
        );
        if (rows[0]) return rows[0].reaction_type;

        await db.query(`DELETE FROM donation_reactions WHERE donation_id = $1 AND user_id = $2`, [
          donationId,
          userId
        ]);
        return null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.react');
      }
    }

    const idx = InMemoryStore.donationReactions.findIndex(
      (r) => r.donation_id === donationId && r.user_id === userId
    );

    if (idx === -1) {
      InMemoryStore.donationReactions.push({
        id: randomUUID(),
        donation_id: donationId,
        user_id: userId,
        reaction_type: type,
        created_at: new Date().toISOString()
      });
      return type;
    }

    if (InMemoryStore.donationReactions[idx].reaction_type === type) {
      InMemoryStore.donationReactions.splice(idx, 1);
      return null;
    }

    InMemoryStore.donationReactions[idx].reaction_type = type;
    InMemoryStore.donationReactions[idx].created_at = new Date().toISOString();
    return type;
  }

  static async countReactions(donationId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT
             COUNT(*) FILTER (WHERE reaction_type = 'like')    AS likes_count,
             COUNT(*) FILTER (WHERE reaction_type = 'dislike') AS dislikes_count
           FROM donation_reactions WHERE donation_id = $1`,
          [donationId]
        );
        return {
          likesCount: Number(rows[0].likes_count),
          dislikesCount: Number(rows[0].dislikes_count)
        };
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.countReactions');
      }
    }

    const reacoes = InMemoryStore.donationReactions.filter((r) => r.donation_id === donationId);
    return {
      likesCount: reacoes.filter((r) => r.reaction_type === 'like').length,
      dislikesCount: reacoes.filter((r) => r.reaction_type === 'dislike').length
    };
  }

  /** Soft delete do mural. A doação continua no banco: é registro financeiro. */
  static async setHiddenFromWall(donationId, hidden) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE donations SET hidden_from_wall = $2 WHERE id = $1 RETURNING id, hidden_from_wall`,
          [donationId, hidden]
        );
        return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'DonationModel.setHiddenFromWall');
      }
    }

    const donation = InMemoryStore.donations.find((d) => d.id === donationId);
    if (!donation) return null;
    donation.hidden_from_wall = hidden;
    return { id: donation.id, hidden_from_wall: hidden };
  }
}

module.exports = DonationModel;
