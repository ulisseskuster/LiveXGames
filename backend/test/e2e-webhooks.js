const crypto = require('crypto');
require('dotenv').config();
const StreamerPaymentConfigModel = require('../src/models/streamerPaymentConfigModel');

// Streamer semente (NightPilot) usado como alvo dos testes de webhook por streamer
const NIGHTPILOT_ID = '33333333-3333-3333-3333-333333333333';

async function generateHmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex');
}

// A sessão só existe no cookie HttpOnly livex_session (o JWT saiu do corpo do
// login), e o fetch do Node não guarda cookie como o navegador: este guarda um.
let cookieDeSessao = '';
const fetchNativo = globalThis.fetch;
async function fetch(url, opcoes = {}) {
  const headers = { ...opcoes.headers, ...(cookieDeSessao ? { Cookie: cookieDeSessao } : {}) };
  const res = await fetchNativo(url, { ...opcoes, headers });
  const sessao = res.headers.getSetCookie().find((c) => c.startsWith('livex_session='));
  if (sessao) cookieDeSessao = sessao.split(';')[0];
  return res;
}

async function runE2ETests() {
  const API = 'http://localhost:3000';
  let passed = 0,
    failed = 0;
  let startedServer = null;

  try {
    await fetch(`${API}/health`);
  } catch (e) {
    const { server } = require('../src/server');
    await new Promise((resolve) => {
      startedServer = server.listen(3000, resolve);
    });
  }

  let createdRewardId = null;

  const tests = [
    {
      id: 'auth_jwt',
      name: '1. Autenticação JWT e Verificação de Senha Bcrypt',
      run: async () => {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
        });
        const data = await res.json();
        if (!data.success || !data.data.user) throw new Error('Login não abriu sessão');
        if (data.data.token) throw new Error('O JWT não pode voltar no corpo do login');
        if (!cookieDeSessao) throw new Error('Login não deixou o cookie de sessão');
        return data.data.user.username;
      }
    },
    {
      id: 'lives_system',
      name: '2. Sistema de Vidas Diárias por Perfil',
      run: async () => {
        const loginViewer = await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
          })
        ).json();

        const loginSub = await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'sub_beta', password: 'demo123' })
          })
        ).json();

        if (loginViewer.data.user.max_lives !== 3)
          throw new Error('Viewer deveria ter 3 vidas máximas');
        if (loginSub.data.user.max_sub_lives !== 2)
          throw new Error('Subscriber deveria ter 2 vidas douradas por dia');
        return 'OK';
      }
    },
    {
      id: 'shop_catalog',
      name: '3. Catálogo da Loja (Supply Bay)',
      run: async () => {
        const res = await fetch(`${API}/api/shop/items`);
        const data = await res.json();
        if (!data.success || !Array.isArray(data.data))
          throw new Error('Falha ao carregar catálogo');
        const hasNitro = data.data.some((i) => i.id === 'nitro_booster');
        const hasShield = data.data.some((i) => i.id === 'shield_deflector');
        if (!hasNitro || !hasShield) throw new Error('Itens essenciais ausentes na loja');
        return 'OK';
      }
    },
    {
      id: 'wallet_purchase',
      name: '4. Compra Atômica de Item e Atualização de Inventário',
      run: async () => {
        await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'sub_beta', password: 'demo123' })
          })
        ).json();

        const purchaseRes = await fetch(`${API}/api/shop/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: 'nitro_booster', quantity: 1 })
        });
        const purchaseData = await purchaseRes.json();
        if (!purchaseData.success) throw new Error(purchaseData.message);
        return 'OK';
      }
    },
    {
      id: 'insufficient_funds',
      name: '5. Proteção de Saldo Insuficiente na Loja',
      run: async () => {
        const unique = `pobre_${Date.now()}`;
        await (
          await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: unique,
              email: `${unique}@test.com`,
              password: 'demoPassword123'
            })
          })
        ).json();

        const res = await fetch(`${API}/api/shop/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: 'vip_hangar', quantity: 1 }) // Custa 800, saldo inicial é 500
        });
        await res.json();
        if (res.status !== 400 && res.status !== 409)
          throw new Error('Esperava erro 400 por saldo insuficiente');
        return 'OK';
      }
    },
    {
      id: 'flight_simulation',
      name: '6. Rodada Sorteada no Servidor (Jet Launcher, 15-20 s)',
      run: async () => {
        await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'nightpilot', password: 'streamer123' })
        });

        const abertura = await (
          await fetch(`${API}/api/game/runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: 'jet_launcher', itemIds: [] })
          })
        ).json();
        if (!abertura.success) throw new Error(abertura.message);
        const recibo = await (
          await fetch(`${API}/api/game/runs/${abertura.data.runId}/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          })
        ).json();
        if (!recibo.success) throw new Error(recibo.message);
        const segundos = recibo.data.ticks / 60;
        if (segundos < 15 || segundos > 20) throw new Error(`Duração fora de 15-20 s: ${segundos}`);
        return 'OK';
      }
    },
    {
      id: 'webhook_valid_hmac',
      name: '7. Processamento de Webhook LivePix por Streamer com Assinatura HMAC Válida',
      run: async () => {
        const payload = {
          provider: 'livepix',
          external_id: `ext-test-${Date.now()}`,
          amount: 30.0,
          message: 'Validação HMAC E2E'
        };
        const config = await StreamerPaymentConfigModel.ensureSecrets(NIGHTPILOT_ID);
        const signature = await generateHmac(payload, config.livepix_webhook_secret);

        const res = await fetch(`${API}/webhooks/livepix/${NIGHTPILOT_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-livepix-signature': signature },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        return 'OK';
      }
    },
    {
      id: 'webhook_invalid_hmac',
      name: '8. Rejeição de Assinatura HMAC Falsa',
      run: async () => {
        const payload = {
          provider: 'livepix',
          external_id: `ext-fake-${Date.now()}`,
          amount: 99.0
        };
        const res = await fetch(`${API}/webhooks/livepix/${NIGHTPILOT_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-livepix-signature': 'assinatura_invalida_falsa'
          },
          body: JSON.stringify(payload)
        });
        if (res.status !== 401) throw new Error(`Esperava HTTP 401, recebeu ${res.status}`);
        return 'OK';
      }
    },
    {
      id: 'webhook_idempotence',
      name: '9. Garantia de Idempotência contra Reenvio Duplicado',
      run: async () => {
        const extId = `ext-idempotente-${Date.now()}`;
        const payload = { provider: 'livepix', external_id: extId, amount: 20.0 };
        const config = await StreamerPaymentConfigModel.ensureSecrets(NIGHTPILOT_ID);
        const signature = await generateHmac(payload, config.livepix_webhook_secret);

        const r1 = await (
          await fetch(`${API}/webhooks/livepix/${NIGHTPILOT_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-livepix-signature': signature },
            body: JSON.stringify(payload)
          })
        ).json();

        const r2 = await (
          await fetch(`${API}/webhooks/livepix/${NIGHTPILOT_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-livepix-signature': signature },
            body: JSON.stringify(payload)
          })
        ).json();

        if (r1.data.idempotent !== false) throw new Error('1ª chamada deveria ser nova');
        if (r2.data.idempotent !== true)
          throw new Error('2ª chamada deveria ser detectada como idempotente');
        return 'OK';
      }
    },
    {
      id: 'leaderboard_realtime',
      name: '10. Ranking Semanal e Agregação de Líderes',
      run: async () => {
        const res = await fetch(`${API}/api/leaderboard/weekly`);
        const data = await res.json();
        if (!data.success || !Array.isArray(data.data)) throw new Error('Falha no leaderboard');
        return 'OK';
      }
    },
    {
      id: 'multigame_physics',
      name: '11. Neon Drifter & Void Walker: Abertura e Filme da Rodada',
      run: async () => {
        await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'nightpilot', password: 'streamer123' })
        });

        for (const gameId of ['neon_drifter', 'void_walker']) {
          const abertura = await (
            await fetch(`${API}/api/game/runs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gameId, itemIds: [] })
            })
          ).json();
          if (!abertura.success) throw new Error(`Falha ${gameId}: ${abertura.message}`);
          const filme = await (
            await fetch(`${API}/api/game/runs/${abertura.data.runId}/reveal`)
          ).json();
          if (!filme.success || !filme.data.replayLog)
            throw new Error(`Reveal sem filme em ${gameId}`);
        }
        return 'OK';
      }
    },
    {
      id: 'streamer_reward_creation',
      name: '12. Criação de Brinde pelo Streamer com Status Inicial Pendente',
      run: async () => {
        await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'nightpilot', password: 'streamer123' })
          })
        ).json();

        const res = await (
          await fetch(`${API}/api/streamer-shop/rewards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Teclado Mecânico Streamer E2E #${Date.now().toString().slice(-4)}`,
              description: 'Teclado gamer switches azuis autografado pelo NightPilot.',
              price_coins: 1800,
              stock: 5,
              delivery_type: 'physical',
              image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500'
            })
          })
        ).json();

        if (!res.success || !res.reward) throw new Error(res.message || 'Falha ao criar brinde');
        if (res.reward.status !== 'pending')
          throw new Error(`Esperava status "pending", obteve "${res.reward.status}"`);
        createdRewardId = res.reward.id;
        return 'OK';
      }
    },
    {
      id: 'developer_moderation_review',
      name: '13. Auditoria e Aprovação pelo Desenvolvedor',
      run: async () => {
        const rewardId = createdRewardId || 'rew-seed-3';
        const adminUser = process.env.ADMIN_USERNAME || 'admin_livex';
        const adminPass = process.env.ADMIN_PASSWORD;

        const loginRes = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: adminUser, password: adminPass })
        });
        const login = await loginRes.json();
        if (!login.success || !login.data || !login.data.user) {
          throw new Error(
            `Falha na autenticação do administrador: ${login.message || loginRes.statusText}`
          );
        }

        const modRes = await (
          await fetch(`${API}/api/admin/rewards/${rewardId}/moderate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'approve',
              notes: 'Auditado por administrador oficial.'
            })
          })
        ).json();

        if (!modRes.success || modRes.reward.status !== 'approved')
          throw new Error(modRes.message || 'Falha ao aprovar');
        return 'OK';
      }
    },
    {
      id: 'viewer_reward_redemption',
      name: '15. Resgate Autoritativo com Moedas da Live',
      run: async () => {
        await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'viewer_alpha', password: 'demo123' })
          })
        ).json();

        // Garante saldo suficiente de Fichas de Apoio com o NightPilot, caso outros
        // testes tenham debitado fichas. Usa o webhook assinado (caminho real de
        // uma doação, creditando pelo @nick citado na mensagem) em vez de
        // /api/payments/simulate, que é restrito a streamers e administradores.
        const recarga = {
          provider: 'livepix',
          external_id: `ext-recarga-${Date.now()}`,
          amount: 10.0,
          message: 'Recarga para teste E2E @viewer_alpha'
        };
        const cfgRecarga = await StreamerPaymentConfigModel.ensureSecrets(NIGHTPILOT_ID);
        const assinaturaRecarga = await generateHmac(recarga, cfgRecarga.livepix_webhook_secret);
        await fetch(`${API}/webhooks/livepix/${NIGHTPILOT_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-livepix-signature': assinaturaRecarga
          },
          body: JSON.stringify(recarga)
        });

        const res = await (
          await fetch(`${API}/api/streamer-shop/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rewardId: 'rew-seed-2' })
          })
        ).json();

        if (!res.success || !res.redemption) throw new Error(res.message || 'Falha ao resgatar');
        return 'OK';
      }
    },
    {
      id: 'native_registration_fields',
      name: '16. Cadastro Nativo Completo (Nome, Telefone/WhatsApp, Email e Senha)',
      run: async () => {
        const unique = `piloto_e2e_${Date.now()}`;
        const res = await fetch(`${API}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Piloto Oficial Brasil',
            phone: '(11) 98765-4321',
            username: unique,
            email: `${unique}@livexgames.dev`,
            password: 'senhaSegura123',
            role: 'viewer'
          })
        });
        const data = await res.json();
        if (!data.success || !data.data.user) throw new Error('Falha no cadastro nativo');
        if (data.data.user.name !== 'Piloto Oficial Brasil')
          throw new Error('Nome completo não foi gravado');
        if (data.data.user.phone !== '(11) 98765-4321') throw new Error('Telefone não foi gravado');
        if (data.data.user.max_lives !== 3) throw new Error('Viewer deve iniciar com 3 vidas');
        return 'OK';
      }
    },
    {
      id: 'twitch_link_sub_upgrade',
      name: '17. Vínculo de Conta Twitch via OAuth e Promoção a Subscriber (2 Vidas Douradas)',
      run: async () => {
        const unique = `pilot_ttv_${Date.now()}`;
        await (
          await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Piloto Twitch E2E',
              phone: '(21) 99111-2233',
              username: unique,
              email: `${unique}@livexgames.dev`,
              password: 'senhaSegura123',
              role: 'viewer'
            })
          })
        ).json();

        // Vínculo agora só acontece pelo fluxo oficial OAuth (nunca por nome de
        // usuário digitado). O modo JSON só serve para checar se há credenciais
        // reais configuradas; a navegação real (sem esse header) é quem decide
        // o redirect — para o provedor real, ou para o callback mock, se não
        // houver credenciais configuradas neste ambiente.
        const authCheck = await (
          await fetch(`${API}/api/auth/twitch/authorize`, {
            headers: { Accept: 'application/json' }
          })
        ).json();

        if (authCheck.data.configured) {
          return 'PULADO: credenciais reais da Twitch configuradas neste ambiente (login real exige navegador)';
        }

        await fetch(`${API}/api/auth/twitch/authorize`, {
          redirect: 'follow'
        });

        const me = await (await fetch(`${API}/api/auth/me`)).json();

        if (me.data.user.role !== 'subscriber')
          throw new Error('Usuário deveria ter sido promovido a subscriber');
        if (me.data.user.max_sub_lives !== 2)
          throw new Error('Subscriber deve receber 2 vidas douradas por dia');
        if (!me.data.user.is_sub_twitch) throw new Error('Flag is_sub_twitch deve ser verdadeira');
        if (!me.data.user.twitch_username)
          throw new Error('twitch_username deveria estar preenchido após o callback OAuth');
        return 'OK';
      }
    },
    {
      id: 'kick_link_and_unlink',
      name: '18. Vínculo de Conta Kick via OAuth e Desvinculação de Contas',
      run: async () => {
        const unique = `pilot_kick_${Date.now()}`;
        await (
          await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Piloto Kick E2E',
              phone: '(31) 98888-9999',
              username: unique,
              email: `${unique}@livexgames.dev`,
              password: 'senhaSegura123',
              role: 'viewer'
            })
          })
        ).json();

        // Mesmo princípio da Twitch: vínculo só via OAuth (mock quando sem
        // credenciais reais da Kick neste ambiente).
        const authCheck = await (
          await fetch(`${API}/api/auth/kick/authorize`, {
            headers: { Accept: 'application/json' }
          })
        ).json();

        if (authCheck.data.configured) {
          return 'PULADO: credenciais reais da Kick configuradas neste ambiente (login real exige navegador)';
        }

        await fetch(`${API}/api/auth/kick/authorize`, {
          redirect: 'follow'
        });

        const me = await (await fetch(`${API}/api/auth/me`)).json();

        if (!me.data.user.kick_username) {
          throw new Error('Falha ao vincular Kick via OAuth mock');
        }

        const unlinkRes = await (
          await fetch(`${API}/api/auth/unlink-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'kick' })
          })
        ).json();

        if (!unlinkRes.success || unlinkRes.data.user.kick_username !== null) {
          throw new Error('Falha ao desvincular Kick');
        }
        return 'OK';
      }
    },
    {
      id: 'pixgg_webhook_and_sub_bonus',
      name: '19. Webhook PixGG por Streamer com Assinatura HMAC e Bônus Subscritor (+10% Fichas)',
      run: async () => {
        // sub_beta possui perfil subscriber e twitch_username ativo
        const subLogin = await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'sub_beta', password: 'demo123' })
          })
        ).json();

        const subUserId = subLogin.data.user.id;

        // Saldo de Fichas de Apoio é específico do NightPilot, não a carteira global
        const channelBefore = await (await fetch(`${API}/api/streamer/nightpilot`)).json();
        const balanceBefore = Number(channelBefore.data.viewerWalletBalance || 0);

        const payload = {
          provider: 'pixgg',
          external_id: `pixgg-e2e-${Date.now()}`,
          userId: subUserId,
          amount: 20.0, // R$ 20 -> 2.000 fichas base + 10% (200) = 2.200 fichas
          message: 'Apoio PixGG E2E com bônus sub!'
        };

        const config = await StreamerPaymentConfigModel.ensureSecrets(NIGHTPILOT_ID);
        const signature = await generateHmac(payload, config.pixgg_webhook_secret);

        const res = await fetch(`${API}/webhooks/pixgg/${NIGHTPILOT_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pixgg-signature': signature },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!data.success) throw new Error(data.message || 'Falha no webhook PixGG');
        if (data.data.coinsCredited !== 2200)
          throw new Error(
            `Esperava 2.200 fichas com bônus sub, recebeu ${data.data.coinsCredited}`
          );
        if (data.data.subBonusCoins !== 200)
          throw new Error(`Esperava 200 fichas de bônus sub, recebeu ${data.data.subBonusCoins}`);
        if (Number(data.data.newBalance) !== balanceBefore + 2200)
          throw new Error('Saldo de Fichas de Apoio não refletiu o crédito');
        return 'OK';
      }
    },
    {
      id: 'streamer_application_approval',
      name: '20. Candidatura de Streamer: Envio, Aprovação e Promoção de Papel',
      run: async () => {
        const unique = `aspirante_e2e_${Date.now()}`;
        const reg = await (
          await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: unique,
              email: `${unique}@test.com`,
              password: 'senhaSegura123'
            })
          })
        ).json();
        const applicantId = reg.data.user.id;

        const appRes = await (
          await fetch(`${API}/api/streamer-applications`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              channelPlatform: 'twitch',
              channelUrl: `https://twitch.tv/${unique}`,
              pitch:
                'Transmito jogos indie e testes E2E todos os dias, adoraria fazer parte do LiveX Games.'
            })
          })
        ).json();
        if (!appRes.success) throw new Error(appRes.message || 'Falha ao enviar candidatura');
        const applicationId = appRes.data.application.id;

        const adminUser = process.env.ADMIN_USERNAME || 'admin_livex';
        const adminPass = process.env.ADMIN_PASSWORD;
        await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: adminUser, password: adminPass })
          })
        ).json();

        const modRes = await (
          await fetch(`${API}/api/admin/streamer-applications/${applicationId}/moderate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve' })
          })
        ).json();
        if (!modRes.success || modRes.application.status !== 'approved')
          throw new Error(modRes.message || 'Falha ao aprovar candidatura');

        const reLogin = await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: unique, password: 'senhaSegura123' })
          })
        ).json();
        if (reLogin.data.user.role !== 'streamer')
          throw new Error('Usuário deveria ter sido promovido a streamer');
        if (reLogin.data.user.id !== applicantId)
          throw new Error('Inconsistência de identidade do candidato');
        return 'OK';
      }
    },
    {
      id: 'daily_roulette',
      name: '21. Roleta Diária por Streamer: Prêmio Garantido e Bloqueio de Segundo Giro no Mesmo Dia',
      run: async () => {
        await (
          await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'sub_beta', password: 'demo123' })
          })
        ).json();

        const spin1 = await (
          await fetch(`${API}/api/streamer/${NIGHTPILOT_ID}/roulette/spin`, {
            method: 'POST'
          })
        ).json();
        if (!spin1.success || !spin1.data.prize)
          throw new Error(spin1.message || 'Falha ao girar a roleta');
        if (typeof spin1.data.segmentIndex !== 'number' || spin1.data.totalSegments !== 8) {
          throw new Error(
            'Retorno da roleta deve conter segmentIndex numérico e totalSegments === 8'
          );
        }

        const spin2 = await fetch(`${API}/api/streamer/${NIGHTPILOT_ID}/roulette/spin`, {
          method: 'POST'
        });
        if (spin2.status !== 409)
          throw new Error(`Esperava HTTP 409 no segundo giro do dia, recebeu ${spin2.status}`);
        return 'OK';
      }
    }
  ];

  for (const t of tests) {
    try {
      const result = await t.run();
      if (typeof result === 'string' && result.startsWith('PULADO')) {
        console.log(`⏭ PULADO: ${t.name} -> ${result}`);
      } else {
        console.log(`✔ PASSOU: ${t.name}`);
      }
      passed++;
    } catch (e) {
      console.error(`✖ FALHOU: ${t.name} -> ${e.message}`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Resultado Final: ${passed} passaram, ${failed} falharam.`);
  console.log(`========================================`);

  if (startedServer) {
    startedServer.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runE2ETests().catch(console.error);
