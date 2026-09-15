const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

/**
 * O catálogo de brindes do canal despejava a lista inteira de uma vez, e com
 * muitos brindes empurrava o mural e o ranking para fora do alcance. Agora abre
 * com 8 e expande sob demanda.
 *
 * O seed de demonstração só tem 2 brindes aprovados, e aprovar mais exigiria
 * conta de admin (que não existe no ambiente de teste). Então a lista é injetada
 * no estado e a função REAL de render é chamada — o que está sob teste é
 * exatamente a lógica de corte e do botão, sem depender de dados do servidor.
 */

function brindesFalsos(quantidade) {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `fake-${i}`,
    title: `Brinde de Teste ${i + 1}`,
    description: 'Item gerado pela suíte para exercitar o corte do catálogo.',
    price_coins: 100 + i,
    stock: 5,
    delivery_type: i % 2 === 0 ? 'physical' : 'digital',
    image_url: '',
    streamer_username: 'nightpilot'
  }));
}

async function montarCatalogo(page, quantidade) {
  await page.evaluate((itens) => {
    // O catalogo vive na aba "Lojas" desde que a Arena virou abas.
    setArenaView('lojas');
    state.streamerRewards = itens;
    state.rewardFilter = 'all';
    state.rewardsExpanded = false;
    renderStreamerRewards();
  }, brindesFalsos(quantidade));
}

test.describe('Catálogo de brindes do canal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
  });

  test('mostra 8 brindes e oferece expandir quando ha mais', async ({ page }) => {
    await montarCatalogo(page, 20);

    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(8);

    const botao = page.locator('#toggleRewardsCatalogBtn');
    await expect(botao).toBeVisible();
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    // O rótulo diz quantos faltam: 20 - 8 = 12.
    await expect(botao).toContainText('+12');
  });

  test('expandir revela o catalogo inteiro e recolher volta para 8', async ({ page }) => {
    await montarCatalogo(page, 20);

    await page.locator('#toggleRewardsCatalogBtn').click();
    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(20);
    await expect(page.locator('#toggleRewardsCatalogBtn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#toggleRewardsCatalogBtn')).toContainText('Mostrar menos');

    await page.locator('#toggleRewardsCatalogBtn').click();
    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(8);
    await expect(page.locator('#toggleRewardsCatalogBtn')).toContainText('+12');
  });

  test('com 8 ou menos o botao nao aparece', async ({ page }) => {
    await montarCatalogo(page, 8);

    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(8);
    await expect(page.locator('#toggleRewardsCatalogBtn')).toBeHidden();
  });

  test('trocar de filtro recolhe o catalogo de volta', async ({ page }) => {
    await montarCatalogo(page, 20);
    await page.locator('#toggleRewardsCatalogBtn').click();
    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(20);

    // 'physical' fica com metade da lista (10), ainda acima do corte de 8.
    await page.locator('#filterPhysicalRewardsBtn').click();

    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(8);
    await expect(page.locator('#toggleRewardsCatalogBtn')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  test('catalogo vazio nao mostra botao de expandir', async ({ page }) => {
    await montarCatalogo(page, 0);

    await expect(page.locator('#streamerRewardsGrid .reward-card')).toHaveCount(0);
    await expect(page.locator('#toggleRewardsCatalogBtn')).toBeHidden();
  });
});
