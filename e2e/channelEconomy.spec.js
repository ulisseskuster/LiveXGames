const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals, grantChannel } = require('./helpers');
const A = '33333333-3333-3333-3333-333333333333';
const B = '44444444-4444-4444-4444-444444444444';

test('trocar streamer troca carteira e inventário; respostas atrasadas não restauram outro canal', async ({
  page
}) => {
  test.slow();
  await page.goto('/?webgl=1');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  await expect(page.locator('#walletBalance')).toHaveText('0');
  await grantChannel(page, 500, A);
  await grantChannel(page, 25, B);
  await page.locator('#hudShopToggle').click();
  await page.locator('.hud-buy[data-item-id="nitro_booster"]').click();
  await expect(page.locator('#equip_nitro_booster')).toBeChecked();
  await expect(page.locator('#walletBalance')).toHaveText('450');
  await page.evaluate(() => window.selectStreamer('admin_livex'));
  await expect(page.locator('#walletBalance')).toHaveText('25');
  await expect(page.locator('#equip_nitro_booster')).not.toBeChecked();
  await expect(page.locator('#equip_nitro_booster')).toBeDisabled();
  const denied = await page.request.post('/api/shop/purchase', {
    data: { itemId: 'nitro_booster', quantity: 1, streamerId: B }
  });
  expect(denied.status()).toBe(400);
  await page.evaluate(() => window.selectStreamer('nightpilot'));
  await expect(page.locator('#walletBalance')).toHaveText('450');
  await expect(page.locator('#equip_nitro_booster')).toBeEnabled();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let intercepted;
  const ready = new Promise((resolve) => {
    intercepted = resolve;
  });
  await page.route('**/api/streamer/nightpilot', async (route) => {
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => {
    void window.selectStreamer('nightpilot');
  });
  await ready;
  await page.evaluate(() => window.selectStreamer('admin_livex'));
  release();
  await expect(page.locator('#walletBalance')).toHaveText('25');
  await expect.poll(() => page.evaluate(() => state.currentChannel.id)).toBe(B);
  await page.unrouteAll({ behavior: 'wait' });
  expect(await page.evaluate(() => state.wallet.balance)).toBe(25);
});

test('falha no reveal da última vida retoma a mesma rodada sem novo débito', async ({ page }) => {
  test.slow();
  await page.goto('/?webgl=1');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post('/api/game/runs', {
      data: { gameId: 'jet_launcher', streamerId: A }
    });
    expect(response.ok()).toBe(true);
  }
  await page.evaluate(() => window.loadUserProfile());
  let openings = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/game/runs')) openings++;
  });
  await page.route(
    '**/api/game/runs/*/reveal',
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Falha temporária de teste' })
      });
    },
    { times: 1 }
  );
  await page.locator('#launchJetBtn').click();
  await expect(page.locator('#launchJetBtn')).toBeEnabled();
  await expect
    .poll(async () => (await (await page.request.get('/api/auth/me')).json()).data.user.lives)
    .toBe(0);
  await page.locator('#launchJetBtn').click();
  await expect(page.locator('.jl-pular')).toBeVisible();
  await page.locator('.jl-pular').click();
  await expect(page.locator('#debriefModal')).toBeVisible();
  expect(openings).toBe(1);
  expect(await page.evaluate(() => window.__livexUltimaPartida.oficial.streamerId)).toBe(A);
});

test('HUD cabe em 320 e 360 px nos três jogos', async ({ page }) => {
  // Monta os três jogos duas vezes: no runner do CI já passava de 28 s com limite de 30.
  test.slow();
  test.setTimeout(process.env.CI ? 240000 : 120000);
  await page.goto('/?webgl=1');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ['#tabJetLauncher', '#tabNeonDrifter', '#tabVoidWalker']) {
      await page.locator(tab).click();
      await page.evaluate(() => window.abrirSuprimentosHud(true));
      await expect(page.locator('#hudShopPanel .hud-item')).toHaveCount(3);
      for (const selector of ['#hudShopPanel', '.hud-dock-bar']) {
        expect(
          await page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth)
        ).toBe(true);
      }
      await page.locator('.game-viewport').screenshot({
        path: `artifacts/auditoria-2026-09-13/channel-${width}-${tab.slice(1)}.png`
      });
      await page.evaluate(() => window.abrirSuprimentosHud(false));
    }
  }
});

test('reabrir o canal atual não esvazia canal, saldo e inventário', async ({ page }) => {
  await page.goto('/');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  // A restauração pós-login chama selectStreamer de novo; esvaziar o canal ali fazia
  // "Começar" ser ignorado enquanto a resposta não chegava.
  const semCanal = await page.evaluate(() => {
    void window.selectStreamer('nightpilot');
    return state.currentChannel === null;
  });
  expect(semCanal).toBe(false);
});
