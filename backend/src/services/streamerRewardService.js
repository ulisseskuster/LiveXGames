const crypto = require('crypto');
const StreamerRewardModel = require('../models/streamerRewardModel');
const StreamerWalletService = require('./streamerWalletService');
const UserModel = require('../models/userModel');
const ImageUploadService = require('./imageUploadService');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class StreamerRewardService {
  static async createReward({
    streamer_id,
    streamer_username,
    title,
    description,
    price_coins,
    stock,
    image_url,
    delivery_type
  }) {
    // Os limites superiores espelham o schema (title VARCHAR(120), stock INT,
    // price_coins BIGINT). Sem eles, o valor só era recusado lá no PostgreSQL e
    // o usuário recebia um 500 em vez de uma mensagem de validação — e a
    // descrição, que é TEXT, nem era recusada: entrava no banco em qualquer tamanho.
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      throw new Error('INVALID_TITLE: Título deve ter no mínimo 3 caracteres');
    }
    if (title.trim().length > 120) {
      throw new Error('INVALID_TITLE: Título deve ter no máximo 120 caracteres');
    }
    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      throw new Error('INVALID_DESCRIPTION: Descrição deve ter no mínimo 5 caracteres');
    }
    if (description.trim().length > 2000) {
      throw new Error('INVALID_DESCRIPTION: Descrição deve ter no máximo 2000 caracteres');
    }

    const price = Number(price_coins);
    if (!Number.isSafeInteger(price) || price <= 0 || price > 100_000_000) {
      throw new Error('INVALID_PRICE: O preço deve ser um número inteiro entre 1 e 100.000.000');
    }

    const qty = Number(stock);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1_000_000) {
      throw new Error('INVALID_STOCK: O estoque deve ser um número inteiro entre 1 e 1.000.000');
    }

    if (
      !image_url ||
      typeof image_url !== 'string' ||
      !ImageUploadService.isValidImageInput(image_url.trim())
    ) {
      throw new Error(
        'INVALID_IMAGE: A imagem deve ser uma URL http(s) válida ou um data URI de imagem (png/jpg/gif/webp/avif) de até ~5MB'
      );
    }

    const validDeliveryTypes = ['physical', 'digital'];
    const delivery = validDeliveryTypes.includes(delivery_type) ? delivery_type : 'physical';

    // Se houver Cloudinary configurado, hospeda na nuvem com CDN; senão preserva
    const processedImageUrl = await ImageUploadService.uploadImage(image_url.trim());

    const reward = await StreamerRewardModel.createReward({
      streamer_id,
      streamer_username,
      title: title.trim(),
      description: description.trim(),
      price_coins: price,
      stock: qty,
      image_url: processedImageUrl,
      delivery_type: delivery
    });

    return {
      success: true,
      message: 'Recompensa enviada para fila de moderação dos desenvolvedores!',
      reward
    };
  }

  static async getApprovedCatalog(streamerId = null, deliveryType = null) {
    const rewards = await StreamerRewardModel.findApprovedRewards(streamerId, deliveryType);

    // O catálogo é público: devolve só o que a vitrine precisa. O parecer da
    // moderação (review_notes), quem revisou (reviewed_by) e quando não têm
    // função para quem compra — review_notes inclusive costuma conter texto
    // interno escrito pelos moderadores. Esses campos seguem disponíveis nos
    // endpoints de moderação e de "meus brindes", que exigem papel.
    return rewards.map((reward) => ({
      id: reward.id,
      streamer_id: reward.streamer_id,
      streamer_username: reward.streamer_username,
      title: reward.title,
      description: reward.description,
      price_coins: Number(reward.price_coins),
      stock: Number(reward.stock),
      image_url: reward.image_url,
      delivery_type: reward.delivery_type,
      // Mantido de propósito: aqui é sempre 'approved' (não revela nada) e é o
      // que permite afirmar, em teste, que nenhum item pendente ou rejeitado
      // escapou para a vitrine pública.
      status: reward.status
    }));
  }

  static async getStreamerRewards(streamerId) {
    return await StreamerRewardModel.findRewardsByStreamer(streamerId);
  }

  static async getModerationQueue(statusFilter = null) {
    return await StreamerRewardModel.findRewardsForModeration(statusFilter);
  }

  static async moderateReward(rewardId, { action, notes, adminId, adminUsername, io = null }) {
    if (!['approve', 'reject'].includes(action)) {
      throw new Error('INVALID_ACTION: Ação de moderação deve ser "approve" ou "reject"');
    }

    const reward = await StreamerRewardModel.findById(rewardId);
    if (!reward) {
      throw new Error('REWARD_NOT_FOUND: Item de recompensa não encontrado');
    }

    if (action === 'reject' && (!notes || typeof notes !== 'string' || notes.trim().length < 5)) {
      throw new Error(
        'REJECTION_NOTES_REQUIRED: Motivo da rejeição é obrigatório (mínimo 5 caracteres)'
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const reviewNotes = notes ? notes.trim() : 'Aprovado pelo time de desenvolvimento LiveX Games';

    const updatedReward = await StreamerRewardModel.updateStatus(rewardId, {
      status: newStatus,
      review_notes: reviewNotes,
      reviewed_by: adminId
    });

    // Emite evento em tempo real via WebSockets para toda a plataforma
    if (io) {
      io.emit('streamer-reward:moderated', {
        rewardId,
        title: reward.title,
        status: newStatus,
        notes: reviewNotes,
        streamer_id: reward.streamer_id,
        reviewed_by: adminUsername || 'Moderador Dev'
      });

      if (newStatus === 'approved') {
        io.emit('chat:new-message', {
          author: 'Sistema LiveX',
          role: 'admin',
          message: `🛡️ Novo brinde aprovado na Lojinha: "${reward.title}" por ${reward.price_coins} moedas!`,
          timestamp: new Date().toISOString()
        });
      }
    }

    return {
      success: true,
      message: `Recompensa ${newStatus === 'approved' ? 'aprovada' : 'rejeitada'} com sucesso!`,
      reward: updatedReward
    };
  }

  static async redeemReward({ rewardId, userId, recipient_name, shipping_address, io = null }) {
    if (db.isAvailable()) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // 1. Bloqueia o registro da recompensa com FOR UPDATE para evitar race condition de estoque
        const rewardRes = await client.query(
          `SELECT * FROM streamer_rewards WHERE id = $1 FOR UPDATE`,
          [rewardId]
        );
        const reward = rewardRes.rows[0];
        if (!reward) {
          throw new Error('REWARD_NOT_FOUND: Item de recompensa não encontrado');
        }

        if (reward.status !== 'approved') {
          throw new Error('REWARD_NOT_AVAILABLE: Item não está aprovado para resgate');
        }

        const currentStock = Number(reward.stock);
        if (currentStock <= 0) {
          throw new Error('OUT_OF_STOCK: Item esgotado no estoque');
        }

        if (reward.delivery_type === 'physical') {
          if (!recipient_name || recipient_name.trim().length < 3) {
            throw new Error('MISSING_SHIPPING_INFO: Nome completo do destinatário é obrigatório');
          }
          if (!shipping_address || shipping_address.trim().length < 10) {
            throw new Error(
              'MISSING_SHIPPING_INFO: Endereço completo com CEP é obrigatório para envio físico'
            );
          }
        }

        // 2. Busca o usuário
        const userRes = await client.query(`SELECT id, username FROM users WHERE id = $1`, [
          userId
        ]);
        const user = userRes.rows[0];
        if (!user) {
          throw new Error('USER_NOT_FOUND: Usuário não localizado');
        }

        // A carteira bloqueada pertence ao dono do brinde.
        const walletRes = await client.query(
          `SELECT id, balance FROM channel_wallets WHERE user_id = $1 AND streamer_id = $2 FOR UPDATE`,
          [userId, reward.streamer_id]
        );
        const wallet = walletRes.rows[0];
        if (!wallet) {
          throw new Error('WALLET_NOT_FOUND: Carteira não encontrada');
        }

        const currentBalance = Number(wallet.balance);
        const price = Number(reward.price_coins);
        if (currentBalance < price) {
          throw new Error('INSUFFICIENT_BALANCE: Saldo insuficiente');
        }

        const newBalance = currentBalance - price;

        // 4. Decrementa o estoque de forma atômica
        // Sem `updated_at`: essa coluna nunca existiu em streamer_rewards (ver
        // schema.sql), e era esta a única query que a referenciava. Em produção
        // o resgate morria aqui com "column updated_at does not exist", ou seja,
        // nenhum brinde jamais chegou a ser resgatado. O rastro de quando o item
        // mudou já é coberto por reviewed_at na moderação.
        await client.query(`UPDATE streamer_rewards SET stock = stock - 1 WHERE id = $1`, [
          rewardId
        ]);

        await client.query(
          `UPDATE channel_wallets SET balance = $1, updated_at = NOW()
           WHERE user_id = $2 AND streamer_id = $3`,
          [newBalance, userId, reward.streamer_id]
        );
        await client.query(
          `INSERT INTO channel_wallet_transactions (user_id, streamer_id, type, direction, amount, metadata)
           VALUES ($1, $2, 'reward_redemption', 'debit', $3, $4)`,
          [
            userId,
            reward.streamer_id,
            price,
            JSON.stringify({ rewardId: reward.id, rewardTitle: reward.title })
          ]
        );

        // 7. Gera código seguro se for brinde digital
        let digitalCode = null;
        if (reward.delivery_type === 'digital') {
          digitalCode = `LIVEX-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        }
        const initialStatus =
          reward.delivery_type === 'digital' ? 'completed' : 'pending_fulfillment';

        // 8. Cria o pedido de resgate
        const redemptionRes = await client.query(
          `INSERT INTO reward_redemptions (
            reward_id, streamer_id, user_id, coins_spent, delivery_type,
            recipient_name, shipping_address, digital_code, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            reward.id,
            reward.streamer_id,
            userId,
            price,
            reward.delivery_type,
            recipient_name ? recipient_name.trim() : null,
            shipping_address ? shipping_address.trim() : null,
            digitalCode,
            initialStatus
          ]
        );
        const redemption = {
          ...redemptionRes.rows[0],
          reward_title: reward.title,
          username: user.username
        };

        await client.query('COMMIT');

        // Sincroniza espelho em memória se existir
        const memReward = InMemoryStore.streamerRewards.find((r) => r.id === rewardId);
        if (memReward) memReward.stock -= 1;
        // Não espelha o resgate em memória: com o banco atendendo, o array
        // cresceria indefinidamente.

        if (io) {
          io.emit('streamer-reward:redeemed', {
            rewardId: reward.id,
            rewardTitle: reward.title,
            username: user.username,
            streamer_id: reward.streamer_id,
            delivery_type: reward.delivery_type
          });

          io.emit('chat:new-message', {
            author: 'Sistema LiveX',
            role: 'admin',
            message: `🎁 ${user.username} acabou de resgatar "${reward.title}" na lojinha do streamer!`,
            timestamp: new Date().toISOString()
          });
        }

        return {
          success: true,
          message: 'Brinde resgatado com sucesso!',
          redemption,
          streamerId: reward.streamer_id,
          remainingBalance: newBalance
        };
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }
    }

    // Fallback em memória para testes unitários isolados
    const reward = await StreamerRewardModel.findById(rewardId);
    if (!reward) {
      throw new Error('REWARD_NOT_FOUND: Item de recompensa não encontrado');
    }

    if (reward.status !== 'approved') {
      throw new Error('REWARD_NOT_AVAILABLE: Item não está aprovado para resgate');
    }

    if (reward.stock <= 0) {
      throw new Error('OUT_OF_STOCK: Item esgotado no estoque');
    }

    if (reward.delivery_type === 'physical') {
      if (!recipient_name || recipient_name.trim().length < 3) {
        throw new Error('MISSING_SHIPPING_INFO: Nome completo do destinatário é obrigatório');
      }
      if (!shipping_address || shipping_address.trim().length < 10) {
        throw new Error(
          'MISSING_SHIPPING_INFO: Endereço completo com CEP é obrigatório para envio físico'
        );
      }
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND: Usuário não localizado');
    }

    // 1. Debita Fichas de Apoio do usuário de forma atômica
    const debitResult = await StreamerWalletService.debitForRedemption(
      userId,
      reward.streamer_id,
      reward.price_coins,
      {
        rewardId: reward.id,
        rewardTitle: reward.title
      }
    );

    // 2. Decrementa o estoque da recompensa
    await StreamerRewardModel.decrementStock(rewardId, 1);

    // 3. Gera código digital caso seja voucher
    let digitalCode = null;
    if (reward.delivery_type === 'digital') {
      digitalCode = `LIVEX-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    }

    // 4. Cria registro de resgate/pedido
    const redemption = await StreamerRewardModel.createRedemption({
      reward_id: reward.id,
      reward_title: reward.title,
      streamer_id: reward.streamer_id,
      user_id: userId,
      username: user.username,
      coins_spent: reward.price_coins,
      delivery_type: reward.delivery_type,
      recipient_name: recipient_name ? recipient_name.trim() : null,
      shipping_address: shipping_address ? shipping_address.trim() : null,
      digital_code: digitalCode
    });

    // 5. Notifica chat ao vivo e stream
    if (io) {
      io.emit('streamer-reward:redeemed', {
        rewardId: reward.id,
        rewardTitle: reward.title,
        username: user.username,
        streamer_id: reward.streamer_id,
        delivery_type: reward.delivery_type
      });

      io.emit('chat:new-message', {
        author: 'Sistema LiveX',
        role: 'admin',
        message: `🎁 ${user.username} acabou de resgatar "${reward.title}" na lojinha do streamer!`,
        timestamp: new Date().toISOString()
      });
    }

    return {
      success: true,
      message: 'Brinde resgatado com sucesso!',
      redemption,
      streamerId: reward.streamer_id,
      remainingBalance: debitResult.balance
    };
  }

  static async getUserRedemptions(userId) {
    return await StreamerRewardModel.findRedemptionsByUser(userId);
  }

  static async getStreamerOrders(streamerId) {
    return await StreamerRewardModel.findRedemptionsByStreamer(streamerId);
  }

  static async fulfillOrder(
    redemptionId,
    { status, tracking_code, requesterId = null, requesterRole = null }
  ) {
    const validStatuses = ['pending_fulfillment', 'shipped', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new Error('INVALID_STATUS: Status de pedido inválido');
    }

    const existingOrder = await StreamerRewardModel.findRedemptionById(redemptionId);
    if (!existingOrder) {
      throw new Error('ORDER_NOT_FOUND: Pedido de resgate não encontrado');
    }

    // Evita IDOR: um streamer só pode alterar pedidos do seu próprio canal (admin pode qualquer um)
    if (requesterId && requesterRole !== 'admin' && existingOrder.streamer_id !== requesterId) {
      throw new Error('FORBIDDEN: Você não tem permissão para alterar este pedido');
    }

    const updated = await StreamerRewardModel.updateRedemptionStatus(redemptionId, {
      status,
      tracking_code: tracking_code ? tracking_code.trim() : null
    });

    if (!updated) {
      throw new Error('ORDER_NOT_FOUND: Pedido de resgate não encontrado');
    }

    return {
      success: true,
      message: 'Status do pedido atualizado com sucesso',
      order: updated
    };
  }
}

module.exports = StreamerRewardService;
