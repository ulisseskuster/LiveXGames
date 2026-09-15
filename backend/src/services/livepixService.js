const crypto = require('crypto');
const StreamerWalletService = require('./streamerWalletService');
const StreamerWalletModel = require('../models/streamerWalletModel');
const db = require('../config/database');
const DonationModel = require('../models/donationModel');
const UserModel = require('../models/userModel');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');
const StreamerGatewayService = require('./streamerGatewayService');
const { LIVEPIX_WEBHOOK_SECRET, PIXGG_WEBHOOK_SECRET } = require('../config/secrets');

// Teto de palavras da mensagem consideradas como possível @menção de usuário.
// Uma menção real aparece no começo do texto; o limite evita varrer mensagens
// enormes só para achar um apelido.
const MAX_USERNAME_CANDIDATES = 40;

class LivePixService {
  static generateSignature(payload, secretOverride = null, provider = 'livepix') {
    const defaultSecret = provider === 'pixgg' ? PIXGG_WEBHOOK_SECRET : LIVEPIX_WEBHOOK_SECRET;
    const secret = secretOverride || defaultSecret;
    const bodyContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(bodyContent).digest('hex');
  }

  static async findTargetUser(payload) {
    const { userId, username, email, phone, message = '', comment = '' } = payload;

    // 1. Busca por ID direto
    if (userId) {
      const user = await UserModel.findById(userId);
      if (user) return user;
    }

    // 2. Busca por username explícito
    if (username) {
      const user = await UserModel.findByUsername(username);
      if (user) return user;
    }

    // 3. Busca por email
    if (email) {
      const user = await UserModel.findByEmail(email);
      if (user) return user;
    }

    // 4. Busca por telefone
    if (phone) {
      const user = await UserModel.findByPhone(phone);
      if (user) return user;
    }

    // 5. Varredura inteligente no texto da mensagem/comentário (usuário digita nick ou email no LivePix/PixGG)
    const combinedText = `${message} ${comment}`.trim();
    if (combinedText) {
      // Procura por padrão de email
      const emailMatch = combinedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        const userByMsgEmail = await UserModel.findByEmail(emailMatch[0]);
        if (userByMsgEmail) return userByMsgEmail;
      }

      // Procura por usernames conhecidos no texto. A mensagem é escrita por quem
      // doa, então pode ter centenas de palavras: consultar uma por uma fazia o
      // processamento do webhook crescer linearmente com o tamanho do texto
      // (300 palavras = 300 consultas em série), a ponto de estourar o tempo do
      // provedor e perder a doação. Aqui os candidatos viram uma consulta só, e a
      // ordem original do texto decide qual vale, preservando o comportamento.
      const candidatos = [];
      for (const word of combinedText.split(/[\s,;:!?-]+/)) {
        const cleanWord = word.replace(/^@/, '').toLowerCase();
        if (cleanWord.length >= 3 && cleanWord.length <= 32 && !candidatos.includes(cleanWord)) {
          candidatos.push(cleanWord);
          if (candidatos.length >= MAX_USERNAME_CANDIDATES) break;
        }
      }

      if (candidatos.length > 0) {
        const encontrados = await UserModel.findManyByUsernames(candidatos);
        for (const candidato of candidatos) {
          const achado = encontrados.find((u) => u.username.toLowerCase() === candidato);
          if (achado) return achado;
        }
      }
    }

    // 6. Fallback para viewer_alpha apenas em ambiente de teste ou desenvolvimento local
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development' ||
      !process.env.NODE_ENV
    ) {
      return await UserModel.findByUsername('viewer_alpha');
    }
    return null;
  }

  /**
   * Recupera uma doação pendente (crédito ainda não aplicado). Usada quando a
   * reentrega do webhook encontra a doação gravada mas sem credited_at, e pela
   * rotina de reconciliação. Nunca credita duas vezes: a carteira só ganha se
   * ainda não há extrato com este external_id.
   *
   * @param {object} donation Linha de donations (camelCase j� normalizado ou cru)
   * @param {object} targetUser Usuário destinatário
   * @param {object} streamer Streamer do canal
   * @param {object|null} io
   */
  static async tentarCreditarPendente(donation, targetUser, streamer, io = null) {
    const externalId = donation.external_id;
    if (!externalId) throw new Error('MISSING_EXTERNAL_ID');

    // Idempotência real: se o extrato da carteira já tem este external_id,
    // o crédito já aconteceu (mesmo que a flag demore) — não credita de novo.
    const jaCreditado = await StreamerWalletService.jaCreditado(
      targetUser.id,
      streamer.id,
      externalId
    );
    if (jaCreditado) {
      await DonationModel.confirmarCredito(donation.id).catch(() => {});
      const saldo = await StreamerWalletService.getBalance(targetUser.id, streamer.id);
      return {
        success: true,
        idempotent: true,
        recovered: true,
        message: 'Doação já havia sido creditada (recuperada da reconciliação)',
        donation: { ...donation, status: 'completed' },
        newBalance: Number(saldo.balance)
      };
    }

    const updatedWallet = await StreamerWalletService.creditFromDonation(
      targetUser.id,
      streamer.id,
      Number(donation.coins_credited),
      {
        provider: donation.provider,
        external_id: externalId,
        amountBrl: Number(donation.amount_cents) / 100,
        recovered: true
      }
    );
    await DonationModel.confirmarCredito(donation.id);
    return {
      success: true,
      idempotent: true,
      recovered: true,
      message: 'Doação pendente creditada com sucesso (recuperada)',
      donation: { ...donation, status: 'completed' },
      newBalance: updatedWallet.balance
    };
  }

  static async processWebhook(payload, io = null, defaultProvider = 'livepix', streamerId = null) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('INVALID_PAYLOAD');
    }

    if (!streamerId) {
      throw new Error('MISSING_STREAMER_ID');
    }

    const streamer = await UserModel.findById(streamerId);
    if (!streamer || (streamer.role !== 'streamer' && streamer.role !== 'admin')) {
      throw new Error('STREAMER_NOT_FOUND');
    }

    const provider = (payload.provider || defaultProvider || 'livepix').toLowerCase();
    const config = await StreamerPaymentConfigModel.findByStreamerId(streamerId);

    // Normalização para LivePix oficial { event: 'new', resource: { id, type } }
    let livepixDetails = null;
    if (
      provider === 'livepix' &&
      payload.resource &&
      payload.resource.id &&
      payload.amount === undefined &&
      payload.value === undefined
    ) {
      if (config && config.livepix_client_id && config.livepix_client_secret) {
        livepixDetails = await StreamerGatewayService.fetchLivepixResourceDetails(
          config.livepix_client_id,
          config.livepix_client_secret,
          payload.resource.id,
          payload.resource.type || 'message'
        );
      } else if (
        process.env.NODE_ENV === 'test' ||
        payload.userId?.startsWith('test_') ||
        payload.userId?.startsWith('demo_')
      ) {
        livepixDetails = {
          id: payload.resource.id,
          amount: 10.0,
          username: 'viewer_alpha',
          message: 'Doação de teste LivePix'
        };
      } else {
        throw new Error('LIVEPIX_API_NOT_CONFIGURED');
      }
    }

    // Normalização dos campos considerando:
    // 1. LivePix oficial (via livepixDetails)
    // 2. PixGG oficial (payload.data: transactionPublicId, totalAmount, donatorUsername, message)
    // 3. Payload direto legado ({ external_id, amount, username, message })
    const externalId =
      livepixDetails?.id ||
      payload.data?.transactionPublicId ||
      payload.external_id ||
      payload.id ||
      payload.transactionId;

    const rawAmount =
      livepixDetails?.amount ?? payload.data?.totalAmount ?? payload.amount ?? payload.value;

    const message =
      livepixDetails?.message || payload.data?.message || payload.message || payload.comment || '';

    if (!externalId) {
      throw new Error('MISSING_EXTERNAL_ID');
    }

    // 1. Verificação de Idempotência: Se já foi processado, retorna sucesso sem duplicar créditos
    const existingDonation = await DonationModel.findByExternalId(externalId);
    if (existingDonation) {
      return {
        idempotent: true,
        message: `Doação ${provider.toUpperCase()} já processada anteriormente (idempotência garantida)`,
        donation: existingDonation
      };
    }

    const numAmount = Number(rawAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    const normalizedTargetPayload = {
      ...payload,
      ...(payload.data || {}),
      username: livepixDetails?.username || payload.data?.donatorUsername || payload.username,
      message
    };

    // Identifica o usuário destinatário
    const targetUser = await this.findTargetUser(normalizedTargetPayload);
    if (!targetUser) {
      const amountCents = Math.round(numAmount * 100);
      const donationRecord = await DonationModel.create({
        userId: null,
        provider,
        externalId,
        amountCents,
        coinsCredited: 0,
        streamerId,
        metadata: {
          username: normalizedTargetPayload.username || 'Anônimo',
          amountBrl: numAmount,
          provider,
          message,
          streamerUsername: streamer.username,
          unlinked: true
        }
      });
      if (!donationRecord) {
        return {
          idempotent: true,
          message: `Doação ${provider.toUpperCase()} já processada anteriormente (idempotência garantida)`,
          donation: await DonationModel.findByExternalId(externalId)
        };
      }

      return {
        success: true,
        unlinked: true,
        message: 'Doação registrada com sucesso para o canal do streamer (doador não vinculado)',
        donation: donationRecord
      };
    }

    // Conversão de R$ para moedas: R$ 1,00 = 100 moedas
    const coinsPerBrl = Number(process.env.COINS_PER_BRL) || 100;
    const baseCoins = Math.round(numAmount * coinsPerBrl);

    // Bônus especial de +10% para Subscritores (Twitch / Kick / Sub Role)
    const isSubscriber =
      targetUser.role === 'subscriber' || targetUser.is_sub_twitch || targetUser.is_sub_kick;
    const subBonusCoins = isSubscriber ? Math.round(baseCoins * 0.1) : 0;
    const coinsCredited = baseCoins + subBonusCoins;
    const amountCents = Math.round(numAmount * 100);

    // 2. Registra a doação ANTES de creditar qualquer moeda.
    //
    // É este INSERT que reserva o external_id e decide, no índice único do
    // banco, quem processa a entrega: quem perder a corrida recebe null e sai
    // sem creditar nada. A verificação de findByExternalId lá em cima é só um
    // atalho barato para a reentrega comum — sozinha ela era um TOCTOU, porque
    // duas entregas simultâneas do mesmo webhook passavam as duas por ela e
    // creditavam as duas. Creditar primeiro e gravar depois deixava a moeda já
    // emitida quando o INSERT falhava.
    // 2+3+4. DOAÇÃO + CRÉDITO + EXTRATO numa única transação.
    //
    // Antes, o INSERT da doação (status 'completed') acontecia fora de
    // transação, e o crédito em outra conexão: uma queda entre os dois deixava
    // doação 'completed' com saldo 0 e a reentrega era engolida como
    // idempotente (P0-A). Agora quem controla é um único client: BEGIN →
    // INSERT donation → upsert carteira → INSERT extrato → COMMIT. Se qualquer
    // passo falhar, tudo reverte e a doação nem aparece como concluída.
    const transacional = db.isAvailable();
    const client = transacional ? await db.connect() : null;
    let donationRecord;
    let updatedWallet;
    try {
      if (client) await client.query('BEGIN');
      donationRecord = transacional
        ? await DonationModel.createWithClient(client, {
            userId: targetUser.id,
            provider,
            externalId,
            amountCents,
            coinsCredited,
            streamerId,
            metadata: {
              username: targetUser.username,
              userRole: targetUser.role,
              isSubscriber,
              amountBrl: numAmount,
              baseCoins,
              subBonusCoins,
              provider,
              message,
              streamerUsername: streamer.username
            }
          })
        : await DonationModel.create({
            userId: targetUser.id,
            provider,
            externalId,
            amountCents,
            coinsCredited,
            streamerId,
            metadata: {
              username: targetUser.username,
              userRole: targetUser.role,
              isSubscriber,
              amountBrl: numAmount,
              baseCoins,
              subBonusCoins,
              provider,
              message,
              streamerUsername: streamer.username
            }
          });

      if (!donationRecord) {
        // Reentrega do mesmo external_id: a transação atual não inseriu nada.
        // Se ainda não há crédito (pending ou completed sem credited_at),
        // recupera; senão, idempotente.
        if (client) await client.query('ROLLBACK');
        const existente = await DonationModel.findByExternalId(externalId);
        if (existente?.user_id && existente.status !== 'completed' && !existente.credited_at) {
          return LivePixService.tentarCreditarPendente(existente, targetUser, streamer, io);
        }
        return {
          idempotent: true,
          message: `Doação ${provider.toUpperCase()} já processada anteriormente (idempotência garantida)`,
          donation: existente
        };
      }

      if (client) {
        updatedWallet = await StreamerWalletModel.creditFromDonationAtomic(
          client,
          targetUser.id,
          streamerId,
          coinsCredited,
          {
            provider,
            external_id: externalId,
            amountBrl: numAmount,
            baseCoins,
            subBonusCoins,
            isSubscriber,
            message
          }
        );
        await client.query('COMMIT');
      } else {
        updatedWallet = await StreamerWalletService.creditFromDonation(
          targetUser.id,
          streamerId,
          coinsCredited,
          {
            provider,
            external_id: externalId,
            amountBrl: numAmount,
            baseCoins,
            subBonusCoins,
            isSubscriber,
            message
          }
        );
        await DonationModel.confirmarCredito(donationRecord.id);
      }
      donationRecord.status = 'completed';
      donationRecord.credited_at = new Date().toISOString();
      donationRecord.newBalance = updatedWallet.balance;
    } catch (creditErr) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      } else {
        // Sem transação (InMemory/dev), tenta deixar a doação marcada pending
        // para recuperação — o crédito falhou depois do INSERT isolado.
        await DonationModel.marcarPendente(donationRecord.id).catch(() => {});
      }
      console.error(
        `[LivePixService] Falha ao processar doação ${externalId} (transação revertida ou pendente):`,
        creditErr.message
      );
      throw creditErr;
    } finally {
      if (client) client.release();
    }

    // 4. Emite eventos em tempo real via Socket.IO
    if (io) {
      io.emit('stream:donation-received', {
        // O id da doação vai junto para que o card que acabou de cair no Mural
        // Social consiga reagir sem precisar recarregar o feed inteiro.
        donationId: donationRecord.id,
        userId: targetUser.id,
        username: targetUser.username,
        streamerId,
        streamerUsername: streamer.username,
        provider,
        amountBrl: numAmount,
        coinsCredited,
        subBonusCoins,
        isSubscriber,
        message: message || `Apoio via ${provider === 'pixgg' ? 'PixGG' : 'LivePix'}!`,
        timestamp: new Date().toISOString()
      });

      io.to(`user_${targetUser.id}`).emit('streamer-wallet:balance-updated', {
        userId: targetUser.id,
        streamerId,
        balance: updatedWallet.balance
      });
    }

    return {
      success: true,
      idempotent: false,
      message:
        `Doação via ${provider === 'pixgg' ? 'PixGG' : 'LivePix'} processada com sucesso! ${subBonusCoins > 0 ? `(+${subBonusCoins} bônus Sub)` : ''}`.trim(),
      donation: donationRecord,
      newBalance: updatedWallet.balance,
      coinsCredited,
      fichasEarned: coinsCredited,
      subBonusCoins
    };
  }
}

module.exports = LivePixService;
