// Suíte do InMemoryStore (IDs fictícios, fixtures direto na memória): roda
// sem banco mesmo quando o ambiente define DATABASE_URL, como no CI. Antes ela
// só passava ali porque gravava antes de o pool conectar.
process.env.DATABASE_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const StreamerRewardService = require('../src/services/streamerRewardService');
const StreamerRewardModel = require('../src/models/streamerRewardModel');
const StreamerWalletModel = require('../src/models/streamerWalletModel');
const WalletModel = require('../src/models/walletModel');
const UserModel = require('../src/models/userModel');

const STREAMER_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';
const VIEWER_ID = '11111111-1111-1111-1111-111111111111';

test('StreamerRewardService: criação de brinde pelo streamer deve iniciar com status "pending"', async () => {
  const result = await StreamerRewardService.createReward({
    streamer_id: STREAMER_ID,
    streamer_username: 'nightpilot',
    title: 'Mousepad Gamer Speed XL NightPilot',
    description: 'Mousepad 900x400mm com bordas costuradas e iluminação RGB.',
    price_coins: 750,
    stock: 10,
    image_url: 'https://example.com/mousepad.png',
    delivery_type: 'physical'
  });

  assert.equal(result.success, true);
  assert.ok(result.reward.id);
  assert.equal(result.reward.status, 'pending');
  assert.equal(result.reward.price_coins, 750);
  assert.equal(result.reward.stock, 10);
});

test('StreamerRewardService: validações de campos obrigatórios na criação de brinde', async () => {
  // Título muito curto
  await assert.rejects(async () => {
    await StreamerRewardService.createReward({
      streamer_id: STREAMER_ID,
      title: 'Oi',
      description: 'Descrição válida',
      price_coins: 100,
      stock: 5,
      image_url: 'https://example.com/img.png'
    });
  }, /INVALID_TITLE/);

  // Preço inválido
  await assert.rejects(async () => {
    await StreamerRewardService.createReward({
      streamer_id: STREAMER_ID,
      title: 'Item Teste',
      description: 'Descrição válida',
      price_coins: 0,
      stock: 5,
      image_url: 'https://example.com/img.png'
    });
  }, /INVALID_PRICE/);
});

test('StreamerRewardService: catálogo público deve conter apenas brindes aprovados', async () => {
  const catalog = await StreamerRewardService.getApprovedCatalog();

  assert.ok(Array.isArray(catalog));
  // Nenhum item no catálogo público pode estar com status diferente de 'approved'
  const nonApproved = catalog.filter((i) => i.status !== 'approved');
  assert.equal(
    nonApproved.length,
    0,
    'Itens pendentes ou rejeitados não podem estar no catálogo público'
  );

  // Os itens aprovados devem ter estoque positivo
  const zeroStock = catalog.filter((i) => i.stock <= 0);
  assert.equal(zeroStock.length, 0, 'Itens sem estoque não devem estar visíveis');
});

test('StreamerRewardService: rejeição de brinde por moderador exige justificativa', async () => {
  // Criar brinde pendente
  const { reward } = await StreamerRewardService.createReward({
    streamer_id: STREAMER_ID,
    streamer_username: 'nightpilot',
    title: 'Item Duvidoso Para Rejeitar',
    description: 'Item que viola diretrizes de premiação.',
    price_coins: 300,
    stock: 2,
    image_url: 'https://example.com/item.png',
    delivery_type: 'digital'
  });

  // Tentar rejeitar sem motivo deve falhar
  await assert.rejects(async () => {
    await StreamerRewardService.moderateReward(reward.id, {
      action: 'reject',
      notes: '',
      adminId: ADMIN_ID,
      adminUsername: 'dev_admin'
    });
  }, /REJECTION_NOTES_REQUIRED/);

  // Rejeitar com motivo de compliance válido
  const modResult = await StreamerRewardService.moderateReward(reward.id, {
    action: 'reject',
    notes: 'Rejeitado por violar políticas de brindes permitidos da plataforma.',
    adminId: ADMIN_ID,
    adminUsername: 'dev_admin'
  });

  assert.equal(modResult.success, true);
  assert.equal(modResult.reward.status, 'rejected');
  assert.ok(modResult.reward.review_notes.includes('violar políticas'));
});

test('StreamerRewardService: aprovação por desenvolvedor disponibiliza brinde no catálogo', async () => {
  // 1. Streamer cria o brinde
  const { reward } = await StreamerRewardService.createReward({
    streamer_id: STREAMER_ID,
    streamer_username: 'nightpilot',
    title: 'Caneca Térmica LiveX Jet Pilot',
    description: 'Caneca térmica inox 500ml personalizada.',
    price_coins: 450,
    stock: 8,
    image_url: 'https://example.com/caneca.png',
    delivery_type: 'physical'
  });

  assert.equal(reward.status, 'pending');

  // Não deve estar no catálogo ainda
  let catalog = await StreamerRewardService.getApprovedCatalog();
  assert.equal(
    catalog.some((i) => i.id === reward.id),
    false
  );

  // 2. Dev/Admin aprova o item
  const approval = await StreamerRewardService.moderateReward(reward.id, {
    action: 'approve',
    notes: 'Item aprovado e em conformidade técnica e legal.',
    adminId: ADMIN_ID,
    adminUsername: 'dev_admin'
  });

  assert.equal(approval.success, true);
  assert.equal(approval.reward.status, 'approved');

  // 3. Agora deve estar presente no catálogo
  catalog = await StreamerRewardService.getApprovedCatalog();
  assert.equal(
    catalog.some((i) => i.id === reward.id),
    true
  );
});

test('StreamerRewardService: resgate debita moedas do espectador e gera pedido', async () => {
  // O saldo global não participa da autorização do resgate.
  await WalletModel.addCredits(VIEWER_ID, 2000, { type: 'test_setup' });
  await StreamerWalletModel.addBalance(VIEWER_ID, STREAMER_ID, 2000);
  const initialWallet = await StreamerWalletModel.findByUserAndStreamer(VIEWER_ID, STREAMER_ID);
  const startBalance = Number(initialWallet.balance);

  // Usa o item aprovado seed 'rew-seed-1' (Camiseta, 1200 coins, physical)
  const initialReward = await StreamerRewardModel.findById('rew-seed-1');
  const initialStock = initialReward.stock;

  const redeemResult = await StreamerRewardService.redeemReward({
    rewardId: 'rew-seed-1',
    userId: VIEWER_ID,
    recipient_name: 'Carlos Oliveira',
    shipping_address: 'Av. Paulista 1000, Apto 52, Bela Vista - São Paulo/SP - CEP 01310-100'
  });

  assert.equal(redeemResult.success, true);
  assert.equal(redeemResult.remainingBalance, startBalance - 1200);

  // Verifica que o estoque decrementou
  const updatedReward = await StreamerRewardModel.findById('rew-seed-1');
  assert.equal(updatedReward.stock, initialStock - 1);

  // Verifica o registro do pedido
  assert.ok(redeemResult.redemption.id);
  assert.equal(redeemResult.redemption.status, 'pending_fulfillment');
  assert.equal(redeemResult.redemption.recipient_name, 'Carlos Oliveira');
});

test('StreamerRewardService: resgate de brinde digital gera código de voucher', async () => {
  await WalletModel.addCredits(VIEWER_ID, 1000, { type: 'test_setup' });
  await StreamerWalletModel.addBalance(VIEWER_ID, STREAMER_ID, 1000);

  // Item 'rew-seed-2' (VIP Pass Discord, 600 coins, digital)
  const redeemResult = await StreamerRewardService.redeemReward({
    rewardId: 'rew-seed-2',
    userId: VIEWER_ID
  });

  assert.equal(redeemResult.success, true);
  assert.ok(redeemResult.redemption.digital_code);
  assert.ok(redeemResult.redemption.digital_code.startsWith('LIVEX-'));
  assert.equal(redeemResult.redemption.status, 'completed');
});

test('StreamerRewardService: resgate sem moedas suficientes deve ser bloqueado', async () => {
  const brokeUser = await UserModel.create({
    username: 'pobre_' + Date.now(),
    email: `pobre_${Date.now()}@example.com`,
    password: 'password123',
    role: 'viewer'
  });
  // Quem barra o resgate é a carteira única: zerar só o extrato do canal não
  // testava nada, porque não é ele que autoriza o gasto.
  const wallet = await WalletModel.findByUserId(brokeUser.id);
  wallet.balance = 0;
  const streamerWallet = await StreamerWalletModel.findByUserAndStreamer(brokeUser.id, STREAMER_ID);
  streamerWallet.balance = 0;

  await assert.rejects(async () => {
    await StreamerRewardService.redeemReward({
      rewardId: 'rew-seed-1',
      userId: brokeUser.id,
      recipient_name: 'Sem Dinheiro',
      shipping_address: 'Rua Teste 123, Bairro Centro, CEP 01000-000'
    });
  }, /INSUFFICIENT_BALANCE/);
});

test('StreamerRewardService: resgate de brinde físico sem endereço deve falhar', async () => {
  await assert.rejects(async () => {
    await StreamerRewardService.redeemReward({
      rewardId: 'rew-seed-1',
      userId: VIEWER_ID,
      recipient_name: '',
      shipping_address: ''
    });
  }, /MISSING_SHIPPING_INFO/);
});

test('StreamerRewardService: atualização de status do pedido pelo streamer', async () => {
  const orders = await StreamerRewardService.getStreamerOrders(STREAMER_ID);
  assert.ok(orders.length > 0);

  const orderToFulfill = orders.find((o) => o.delivery_type === 'physical');
  if (orderToFulfill) {
    const updated = await StreamerRewardService.fulfillOrder(orderToFulfill.id, {
      status: 'shipped',
      tracking_code: 'BR123456789BR'
    });

    assert.equal(updated.success, true);
    assert.equal(updated.order.status, 'shipped');
    assert.equal(updated.order.tracking_code, 'BR123456789BR');
  }
});
