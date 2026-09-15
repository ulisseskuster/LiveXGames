const UserModel = require('../models/userModel');
const StreamerRewardService = require('../services/streamerRewardService');
const StreamerWalletService = require('../services/streamerWalletService');
const StreamerRouletteService = require('../services/streamerRouletteService');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');
const StreamerGatewayService = require('../services/streamerGatewayService');
const { ok, fail } = require('../utils/response');

class StreamerChannelController {
  static async listStreamers(req, res) {
    try {
      const streamers = await UserModel.findAllStreamers();
      return ok(res, streamers, 'Diretório de streamers carregado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar diretório de streamers', error.message);
    }
  }

  static async getChannel(req, res) {
    try {
      const { username } = req.params;
      const streamer = await UserModel.findByUsername(username);

      if (!streamer) {
        return fail(res, 404, 'Canal de streamer não encontrado');
      }

      if (streamer.role !== 'streamer' && streamer.role !== 'admin') {
        return fail(res, 400, 'O usuário informado não possui perfil de streamer');
      }

      const rewards = await StreamerRewardService.getApprovedCatalog(streamer.id);

      const livepixHandle = streamer.livepix_url || streamer.username;
      const pixggHandle = streamer.pixgg_url || streamer.username;

      const livepixUrl = livepixHandle.startsWith('http')
        ? livepixHandle
        : `https://livepix.gg/${livepixHandle}`;

      const pixggUrl = pixggHandle.startsWith('http')
        ? pixggHandle
        : `https://pix.gg/${pixggHandle}`;

      const payload = {
        id: streamer.id,
        username: streamer.username,
        name: streamer.name || streamer.username,
        role: streamer.role,
        twitch_username: streamer.twitch_username,
        kick_username: streamer.kick_username,
        is_sub_twitch: streamer.is_sub_twitch,
        is_sub_kick: streamer.is_sub_kick,
        donation_links: {
          livepix: livepixUrl,
          pixgg: pixggUrl
        },
        rewards,
        // Kill-switch do Mural de Doações: o front nem monta a seção quando o
        // streamer desligou, em vez de montar e tomar 403 na primeira busca.
        wall_enabled: await StreamerPaymentConfigModel.isWallEnabled(streamer.id)
      };

      // Quando autenticado, inclui o saldo do viewer especificamente com esse
      // streamer e se ele ainda pode girar a roleta diária desse canal hoje.
      if (req.user) {
        const wallet = await StreamerWalletService.getBalance(req.user.id, streamer.id);
        const rouletteStatus = await StreamerRouletteService.getStatus(req.user.id, streamer.id);
        payload.viewerWalletBalance = wallet.balance;
        payload.viewerExtraLives = wallet.extraLives;
        payload.viewerRoulette = rouletteStatus;
      }

      return ok(res, payload, 'Canal do streamer carregado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar canal do streamer', error.message);
    }
  }

  static async updateSettings(req, res) {
    try {
      const userId = req.user.id;
      const user = await UserModel.findById(userId);

      if (!user) {
        return fail(res, 404, 'Usuário não encontrado');
      }

      if (user.role !== 'streamer' && user.role !== 'admin') {
        return fail(
          res,
          403,
          'Apenas streamers e administradores podem editar configurações de canal'
        );
      }

      const { livepixUrl, pixggUrl, wallEnabled } = req.body;
      const updated = await UserModel.updateStreamerSettings(userId, { livepixUrl, pixggUrl });

      // Só mexe no mural se o campo veio no corpo: um PUT que só troca a URL do
      // LivePix não pode religar um mural que o streamer desligou.
      if (wallEnabled !== undefined) {
        await StreamerPaymentConfigModel.setWallEnabled(userId, Boolean(wallEnabled));
      }

      return ok(
        res,
        { ...updated, wall_enabled: await StreamerPaymentConfigModel.isWallEnabled(userId) },
        'Configurações do canal do streamer atualizadas com sucesso'
      );
    } catch (error) {
      return fail(res, 500, 'Erro ao atualizar configurações do streamer', error.message);
    }
  }

  /**
   * Base pública usada para montar a URL de webhook que o streamer copia para o
   * painel do gateway.
   *
   * PUBLIC_BASE_URL manda quando está definida. Sem ela, o valor era derivado de
   * `x-forwarded-host`, que é um cabeçalho que o cliente escreve — quem chamasse
   * a API podia envenenar a URL exibida no painel e induzir o streamer a apontar
   * o webhook das próprias doações para outro host. O fallback por `req.get`
   * continua para desenvolvimento local, onde não há proxy na frente.
   */
  static getPublicBaseUrl(req) {
    const configurada = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configurada) return configurada;

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PUBLIC_BASE_URL obrigatória em produção para evitar host-header injection em webhooks.'
      );
    }

    const host = req.get('host') || 'localhost:3000';
    const proto = req.protocol || 'http';
    return `${proto}://${host}`;
  }

  static async getStreamerDashboard(req, res) {
    try {
      const streamerId = req.user.id;
      const baseUrl = StreamerChannelController.getPublicBaseUrl(req);

      const config = await StreamerPaymentConfigModel.ensureSecrets(streamerId);
      const rewards = await StreamerRewardService.getStreamerRewards(streamerId);
      const orders = await StreamerRewardService.getStreamerOrders(streamerId);

      return ok(
        res,
        {
          livepix: {
            webhookUrl: `${baseUrl}/webhooks/livepix/${streamerId}`,
            secret: config.livepix_webhook_secret,
            clientId: config.livepix_client_id || '',
            clientSecretMasked: StreamerPaymentConfigModel.maskSecret(config.livepix_client_secret),
            connected: Boolean(config.livepix_client_id && config.livepix_client_secret)
          },
          pixgg: {
            webhookUrl: `${baseUrl}/webhooks/pixgg/${streamerId}`,
            secret: config.pixgg_webhook_secret,
            clientId: config.pixgg_client_id || '',
            clientSecretMasked: StreamerPaymentConfigModel.maskSecret(config.pixgg_client_secret),
            connected: Boolean(config.pixgg_client_id && config.pixgg_client_secret)
          },
          // Kill-switch do Mural Social. `config` já veio do ensureSecrets
          // acima, então não custa uma consulta a mais: ausente é ligado.
          wallEnabled: config.wall_enabled !== false,
          rewards,
          orders,
          rewardsCount: rewards.length,
          ordersCount: orders.length,
          pendingOrdersCount: orders.filter((o) => o.status === 'pending_fulfillment').length
        },
        'Painel do criador carregado com sucesso'
      );
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar painel do criador', error.message);
    }
  }

  static async updateApiCredentials(req, res) {
    try {
      const streamerId = req.user.id;
      const { provider, clientId, clientSecret } = req.body;

      if (!['pixgg', 'livepix'].includes(provider)) {
        return fail(res, 400, 'provider deve ser "pixgg" ou "livepix"');
      }
      if (!clientId || !clientSecret) {
        return fail(res, 400, 'clientId e clientSecret são obrigatórios');
      }

      const updatePayload =
        provider === 'pixgg'
          ? { pixgg_client_id: clientId.trim(), pixgg_client_secret: clientSecret.trim() }
          : { livepix_client_id: clientId.trim(), livepix_client_secret: clientSecret.trim() };

      const updatedConfig = await StreamerPaymentConfigModel.updateApiCredentials(
        streamerId,
        updatePayload
      );

      // Tenta registrar o webhook automaticamente na plataforma do gateway
      const baseUrl = StreamerChannelController.getPublicBaseUrl(req);
      let autoRegistration = null;

      if (provider === 'pixgg') {
        const webhookUrl = `${baseUrl}/webhooks/pixgg/${streamerId}`;
        autoRegistration = await StreamerGatewayService.setPixggWebhookUrl(
          clientId.trim(),
          clientSecret.trim(),
          webhookUrl
        );
      } else if (provider === 'livepix') {
        const webhookUrl = `${baseUrl}/webhooks/livepix/${streamerId}`;
        autoRegistration = await StreamerGatewayService.setLivepixWebhookUrl(
          clientId.trim(),
          clientSecret.trim(),
          webhookUrl
        );
      }

      const savedSecret =
        provider === 'pixgg'
          ? updatedConfig.pixgg_client_secret
          : updatedConfig.livepix_client_secret;
      const webhookUrl = `${baseUrl}/webhooks/${provider}/${streamerId}`;

      const responseMessage =
        provider === 'pixgg'
          ? 'Credenciais PixGG salvas! Copie a URL do Webhook HTTPS e cole em https://beta.pixgg.com/aplicacoes'
          : autoRegistration && autoRegistration.success
            ? 'Credenciais LivePix conectadas e Webhook registrado com sucesso!'
            : 'Credenciais LivePix salvas com sucesso! Configure a URL do Webhook HTTPS em dashboard.livepix.gg/settings/api';

      return ok(
        res,
        {
          provider,
          clientId:
            provider === 'pixgg' ? updatedConfig.pixgg_client_id : updatedConfig.livepix_client_id,
          clientSecretMasked: StreamerPaymentConfigModel.maskSecret(savedSecret),
          webhookUrl,
          connected: true,
          autoRegistration
        },
        responseMessage
      );
    } catch (error) {
      return fail(res, 500, 'Erro ao salvar credenciais da API', error.message);
    }
  }

  static async regenerateWebhookSecret(req, res) {
    try {
      const streamerId = req.user.id;
      const { provider } = req.body;

      if (!['livepix', 'pixgg'].includes(provider)) {
        return fail(res, 400, 'provider deve ser "livepix" ou "pixgg"');
      }

      const config = await StreamerPaymentConfigModel.regenerateSecret(streamerId, provider);
      const secret =
        provider === 'livepix' ? config.livepix_webhook_secret : config.pixgg_webhook_secret;

      return ok(res, { provider, secret }, 'Segredo de webhook regenerado com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao regenerar segredo de webhook', error.message);
    }
  }

  static async verifyApiCredentials(req, res) {
    try {
      const streamerId = req.user.id;
      const { provider, clientId, clientSecret } = req.body;

      if (!['pixgg', 'livepix'].includes(provider)) {
        return fail(res, 400, 'provider deve ser "pixgg" ou "livepix"');
      }

      let finalClientId = clientId;
      let finalClientSecret = clientSecret;

      if (!finalClientId || !finalClientSecret) {
        const config = await StreamerPaymentConfigModel.findByStreamerId(streamerId);
        if (config) {
          finalClientId = provider === 'pixgg' ? config.pixgg_client_id : config.livepix_client_id;
          finalClientSecret =
            provider === 'pixgg' ? config.pixgg_client_secret : config.livepix_client_secret;
        }
      }

      if (!finalClientId || !finalClientSecret) {
        return fail(
          res,
          400,
          `Nenhuma credencial encontrada para ${provider.toUpperCase()}. Preencha os campos e salve primeiro.`
        );
      }

      const result = await StreamerGatewayService.verifyApi(
        provider,
        finalClientId,
        finalClientSecret
      );
      return ok(res, result, result.message);
    } catch (error) {
      return fail(res, 500, 'Erro ao verificar credenciais da API', error.message);
    }
  }
}

module.exports = StreamerChannelController;
