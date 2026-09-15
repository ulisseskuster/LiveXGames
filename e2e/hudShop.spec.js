const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals, grantChannel } = require('./helpers');
const { enquadrar } = require('./cinemaHelpers');

test('HUD: três itens por jogo, compra, seleção independente e layout responsivo', async ({
  page
}) => {
  // Monta os três jogos em várias larguras: no runner do CI passou de 1,5 min com limite de 90 s.
  test.setTimeout(process.env.CI ? 360000 : 180000);
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/?webgl=1');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  await grantChannel(page);
  for (const [game, tab, item] of [
    ['jet', '#tabJetLauncher', 'nitro_booster'],
    ['neon', '#tabNeonDrifter', 'nos_injection'],
    ['void', '#tabVoidWalker', 'quantum_jump']
  ]) {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator(tab).click();
    await expect(page.locator('#jogoNovoContainer canvas')).toBeVisible();
    await page.locator('#hudShopToggle').click();
    await expect(page.locator('#hudShopPanel .hud-item')).toHaveCount(3);
    const me = (await (await page.request.get('/api/auth/me')).json()).data;
    const before = (
      await (
        await page.request.get(
          `/api/shop/wallet/${me.user.id}?streamerId=33333333-3333-3333-3333-333333333333`
        )
      ).json()
    ).data;
    const purchase = page.waitForResponse((r) => r.url().endsWith('/api/shop/purchase'));
    await page.locator(`.hud-buy[data-item-id="${item}"]`).click();
    const bought = (await (await purchase).json()).data;
    expect(bought.balance).toBeLessThan(before.balance);
    await expect(page.locator(`#equip_${item}`)).toBeChecked();
    await expect(page.locator('#hudLoadoutCount')).toHaveText('1/3');
    await expect(
      page.locator('.hud-item').filter({ has: page.locator(`#equip_${item}`) })
    ).toContainText('1 no inventário');
    await enquadrar(page, '.game-viewport');
    await page.locator('.game-viewport').screenshot({ path: `artifacts/hud-${game}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await enquadrar(page, '.game-viewport');
    await expect(page.locator('#hudShopClose')).toBeVisible();
    expect(
      await page.locator('#hudShopPanel').evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
    expect(
      await page.locator('.hud-dock-bar').evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 1100 });
    await enquadrar(page, '.game-viewport');
    await page.locator('.game-viewport').screenshot({ path: `artifacts/hud-${game}-mobile.png` });
    await page.locator('#hudShopClose').click();
    await expect(page.locator('#hudShopToggle')).toBeFocused();
    await expect(page.locator('#hudShopPanel')).toBeHidden();
  }
  await page.locator('#tabJetLauncher').click();
  await page.locator('#hudShopToggle').click();
  await expect(page.locator('#equip_nitro_booster')).toBeChecked();
  await page.locator('#equip_nitro_booster').uncheck();
  await expect(page.locator('#hudLoadoutCount')).toHaveText('0/3');
  await page.locator('#hudShopClose').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#hudShopPanel')).toBeHidden();
  await page.locator('#hudShopToggle').click();
  for (const id of ['shield_deflector', 'extra_fuel']) {
    await page.locator(`.hud-buy[data-item-id="${id}"]`).click();
    await expect(page.locator(`#equip_${id}`)).toBeChecked();
  }
  await page.locator('#equip_nitro_booster').check();
  await expect(page.locator('#hudLoadoutCount')).toHaveText('3/3');
  await page.locator('#launchJetBtn').click();
  await expect(page.locator('#hudShopPanel')).toBeHidden();
  await expect(page.locator('#hudShopToggle')).toBeDisabled();
  await expect(page.locator('.jl-pular:visible').first()).toBeVisible();
  await expect(page.locator('.jl-score b')).not.toHaveText('0');
  await page.setViewportSize({ width: 1440, height: 1080 });
  await enquadrar(page, '.game-viewport');
  await page.locator('.game-viewport').screenshot({ path: 'artifacts/hud-jet-flight.png' });
  // No CI lento o canvas WebGPU da reprodução intercepta o pointer do clique e
  // o filme pode acabar antes (o botão some). Clicar via JS, como no
  // jetLauncher.spec.js; o debrief é o sinal de que o pulo valeu.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const pular = document.querySelector('.jl-pular');
    if (pular && !pular.hidden) pular.click();
  });
  await expect(page.locator('#debriefModal')).toBeVisible({ timeout: 30000 });
  const resultado = await page.evaluate(() => window.__livexUltimaPartida.oficial);
  expect(resultado.itemsUsed.sort()).toEqual(['extra_fuel', 'nitro_booster', 'shield_deflector']);
  await dismissPostLoginModals(page);
  await page.locator('#hudShopToggle').click();
  await expect(page.locator('#hudLoadoutCount')).toHaveText('0/3');
  await expect(page.locator('#equip_nitro_booster')).toBeDisabled();
  expect(erros).toEqual([]);
});
