const DonationModel = require('../models/donationModel');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');

const REACTION_TYPES = ['like', 'dislike'];
const MAX_LIMIT = 50;

/**
 * Mural Social de Doações.
 *
 * O que é do banco fica no DonationModel; o que é de HTTP fica no controller.
 * Aqui mora o que não é nenhum dos dois: autorização, normalização do card e
 * os eventos de socket.
 *
 * Erros são sentinelas string, como o ALREADY_SPUN_TODAY da roleta — o
 * controller traduz para status HTTP.
 */
class DonationWallService {
  /**
   * Normaliza a linha do banco no card que o front consome.
   *
   * O caminho de "doador não vinculado" do livepixService grava a doação com
   * user_id NULL (o canal recebeu, mas ninguém foi identificado). O card cai
   * para o nome que veio no metadata do webhook e, sem ele, para "Apoiador
   * Anônimo" — nunca para `null` aparecendo na tela.
   */
  static toCard(row) {
    const anonimo = !row.donor_id;
    return {
      id: row.id,
      donor: {
        id: row.donor_id || null,
        username: row.donor_username || row.metadata_username || 'Apoiador Anônimo',
        role: row.role || null,
        anonymous: anonimo
      },
      amountBrl: Number(row.amount_cents) / 100,
      message: row.message || '',
      likesCount: Number(row.likes_count) || 0,
      dislikesCount: Number(row.dislikes_count) || 0,
      myReaction: row.my_reaction || null,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  /**
   * Feed e ranking na mesma chamada: `sort` e `period` mudam a ordenação e a
   * janela, o resto é idêntico.
   *
   * `sort`/`period` inválidos não estouram erro — caem no padrão. São valores
   * vindos da URL, e a allowlist do model já garante que nada disso chega ao
   * SQL; recusar com 400 só daria ao atacante um oráculo e ao usuário comum
   * uma página quebrada por um link velho.
   */
  static async listWall(streamerId, { sort, period, limit, offset, viewerId } = {}) {
    if (!streamerId) throw new Error('STREAMER_NOT_FOUND');

    const habilitado = await StreamerPaymentConfigModel.isWallEnabled(streamerId);
    if (!habilitado) throw new Error('WALL_DISABLED');

    const { rows, hasMore } = await DonationModel.listWall({
      streamerId,
      sort: Object.prototype.hasOwnProperty.call(DonationModel.WALL_SORTS, sort) ? sort : 'recent',
      period: Object.prototype.hasOwnProperty.call(DonationModel.WALL_PERIODS, period)
        ? period
        : 'all',
      limit: DonationWallService.sanitizeLimit(limit),
      offset: DonationWallService.sanitizeOffset(offset),
      viewerId: viewerId || null
    });

    return { items: rows.map(DonationWallService.toCard), hasMore };
  }

  /** Quem mais doou ao canal no período (ver DonationModel.topDonors). Sem ids. */
  static async topDonors(streamerId, { period, limit } = {}) {
    if (!streamerId) throw new Error('STREAMER_NOT_FOUND');

    const habilitado = await StreamerPaymentConfigModel.isWallEnabled(streamerId);
    if (!habilitado) throw new Error('WALL_DISABLED');

    const rows = await DonationModel.topDonors({
      streamerId,
      period: Object.prototype.hasOwnProperty.call(DonationModel.WALL_PERIODS, period)
        ? period
        : 'all',
      limit: DonationWallService.sanitizeLimit(limit)
    });

    return rows.map((row) => ({
      donor: {
        username: row.donor_username || row.metadata_username,
        role: row.role || null
      },
      totalBrl: Number(row.total_cents) / 100,
      donationsCount: Number(row.donations_count),
      lastDonationAt: new Date(row.last_donation_at).toISOString()
    }));
  }

  /** Teto de 50 por página: sem ele, `?limit=100000` é um DoS de uma linha. */
  static sanitizeLimit(valor) {
    const n = Number.parseInt(valor, 10);
    if (!Number.isFinite(n) || n < 1) return MAX_LIMIT;
    return Math.min(n, MAX_LIMIT);
  }

  static sanitizeOffset(valor) {
    const n = Number.parseInt(valor, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  /**
   * Reage a uma doação. Toggle e troca de lado são decididos no model, numa
   * instrução só — aqui ficam as regras de quem pode reagir.
   */
  static async react({ streamerId, donationId, userId, type }, io = null) {
    if (!REACTION_TYPES.includes(type)) throw new Error('INVALID_REACTION_TYPE');

    const donation = await DonationModel.findById(donationId);

    // Doação de outro canal responde igual a doação inexistente: confirmar que
    // o id existe, mas é de outro streamer, transformaria a rota num verificador
    // de ids de doação alheia.
    if (!donation || donation.streamer_id !== streamerId) {
      throw new Error('DONATION_NOT_FOUND');
    }
    if (donation.hidden_from_wall) throw new Error('DONATION_NOT_FOUND');

    const habilitado = await StreamerPaymentConfigModel.isWallEnabled(streamerId);
    if (!habilitado) throw new Error('WALL_DISABLED');

    // Curtir a própria doação é inflar o próprio ranking com dinheiro que já
    // foi pago. O ranking só vale se quem vota é outra pessoa.
    if (donation.user_id && donation.user_id === userId) {
      throw new Error('CANNOT_REACT_OWN_DONATION');
    }

    const myReaction = await DonationModel.react({ donationId, userId, type });
    const { likesCount, dislikesCount } = await DonationModel.countReactions(donationId);

    // Quem reagiu já atualizou o botão de forma otimista com esta resposta; o
    // evento é para os OUTROS espectadores com o mural aberto.
    if (io) {
      io.emit('donation-wall:reaction-updated', {
        streamerId,
        donationId,
        likesCount,
        dislikesCount
      });
    }

    return { donationId, likesCount, dislikesCount, myReaction };
  }

  /**
   * Remoção do card pelo dono do canal.
   *
   * A autorização confere o streamer_id gravado NA DOAÇÃO contra o usuário do
   * token — nunca o :streamerId do path, que é escrito por quem chama.
   */
  static async hideFromWall({ streamerId, donationId, requester }, io = null) {
    const donation = await DonationModel.findById(donationId);
    if (!donation || donation.streamer_id !== streamerId) {
      throw new Error('DONATION_NOT_FOUND');
    }

    const ehDono = requester.role === 'admin' || donation.streamer_id === requester.id;
    if (!ehDono) throw new Error('NOT_CHANNEL_OWNER');

    // hidden_from_wall, não DELETE: a doação é registro financeiro e continua
    // no banco. O que sai é a mensagem do mural.
    const atualizado = await DonationModel.setHiddenFromWall(donationId, true);
    if (!atualizado) throw new Error('DONATION_NOT_FOUND');

    if (io) {
      io.emit('donation-wall:removed', { streamerId, donationId });
    }

    return { donationId, hidden: true };
  }
}

module.exports = DonationWallService;
