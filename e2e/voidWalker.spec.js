const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');
const { enquadrar, replayNoNavegador } = require('./cinemaHelpers');

test('Void: expedição reproduz resultado registrado e funciona no celular', async ({ page }) => {
  test.slow(); // WebGL por software no CI: ~25-30s, no limite do timeout padrão.
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/?webgl=1');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  await page.locator('#tabVoidWalker').click();
  await expect(page.locator('.cinema-palco--void canvas')).toBeVisible();
  const reveal = page.waitForResponse((r) => r.url().includes('/reveal'));
  await page.click('#launchJetBtn');
  const gerada = (await (await reveal).json()).data;
  const replay = await replayNoNavegador(page, gerada);
  expect(replay.hash).toBe(gerada.generatedResult.hash);
  expect(replay.score).toBe(gerada.generatedResult.baseScore);
  await expect(page.locator('.cinema-skip')).toBeVisible();
  await page.waitForTimeout(3000);
  await enquadrar(page, '.cinema-palco--void');
  await page
    .locator('.cinema-palco--void')
    .screenshot({ path: 'artifacts/void-walker-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await enquadrar(page, '.cinema-palco--void');
  await page
    .locator('.cinema-palco--void')
    .screenshot({ path: 'artifacts/void-walker-mobile.png' });
  // No CI lento a reprodução pode acabar durante as capturas e o botão some;
  // clicar só se ainda visível, sem esperar. Esc não serve: fecha o debrief.
  await page.evaluate(() => {
    const pular = document.querySelector('.cinema-skip');
    if (pular && !pular.hidden) pular.click();
  });
  await expect(page.locator('#debriefModal')).toBeVisible();
  const partida = await page.evaluate(() => window.__livexUltimaPartida);
  expect(partida.oficial.score).toBe(gerada.generatedResult.score);
  expect(partida.oficial.hash).toBe(gerada.generatedResult.hash);
  expect(partida.oficial.coinsEarned).toBeGreaterThan(0);
  expect(erros).toEqual([]);
});
