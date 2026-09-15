const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals, grantChannel } = require('./helpers');

/**
 * Duas regressões que andavam juntas:
 *
 * 1. O markup da loja da plataforma não existia. renderShopItems() procurava
 *    #shopGrid, não encontrava e desistia em silêncio — o catálogo inteiro de
 *    /api/shop/items ficava invisível, inclusive a Bateria de Vidas.
 * 2. O banner de vidas esgotadas oferecia "Restaurar Vidas", que só escrevia
 *    state.user.lives no navegador. A tela enchia os corações e o servidor
 *    seguia em zero, recusando a decolagem seguinte.
 */

test.describe('Hangar de Suprimentos e vidas', () => {
  test('a loja da plataforma renderiza o catalogo, com a Bateria de Vidas', async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
    await page.evaluate(() => setArenaView('lojas'));

    const loja = page.locator('#platformShopSection');
    await expect(loja).toBeVisible();

    // O grid existir vazio era exatamente o sintoma antigo.
    const cards = page.locator('#shopGrid .shop-card');
    await expect(cards.first()).toBeVisible();

    const bateria = page.locator('#shopGrid .shop-card').filter({ hasText: 'Bateria de Vidas' });
    await expect(bateria).toBeVisible();
    await expect(bateria.locator('.buy-btn')).toBeVisible();
  });

  test('a Bateria de Vidas credita vidas de verdade, nao so na tela', async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
    await page.evaluate(() => setArenaView('lojas'));

    await grantChannel(page);
    // Vidas compradas pertencem ao canal selecionado.
    const antes = await page.evaluate(async () => {
      const r = await fetch('/api/shop/wallet?streamerId=33333333-3333-3333-3333-333333333333');
      return (await r.json()).data.extraLives;
    });

    const bateria = page.locator('#shopGrid .shop-card').filter({ hasText: 'Bateria de Vidas' });
    await expect(bateria).toBeVisible();
    await bateria.locator('.buy-btn').click();

    // A prova é o servidor, não o contador desenhado: relê /api/auth/me.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const r = await fetch(
              '/api/shop/wallet?streamerId=33333333-3333-3333-3333-333333333333'
            );
            return (await r.json()).data.extraLives;
          }),
        { timeout: 10000 }
      )
      .toBe(antes + 2);
  });

  test('o banner de vidas esgotadas nao promete restauracao falsa', async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);

    // O botão antigo dizia "Restaurar Vidas" e não chamava o servidor. O texto
    // do banner também mandava "restaurar no simulador para continuar testando",
    // linguagem de teste exposta ao espectador.
    const banner = page.locator('#exhaustedLivesBanner');
    await expect(banner).toContainText('Bateria de Vidas');
    await expect(banner).not.toContainText('simulador');
    await expect(page.locator('#quickRefillLivesBtn')).not.toContainText('Restaurar Vidas');
  });
});
