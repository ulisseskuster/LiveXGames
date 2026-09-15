const { test, expect } = require('@playwright/test');

// A regra global `* { max-width: 100% }` tinha !important e anulava a largura
// máxima de todo modal: em tela larga o debrief ocupava 90% da janela.
test('modais respeitam a largura máxima e cabem no celular', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1905, height: 832 });
  await page.goto('/game');
  await page.evaluate(() => document.getElementById('debriefModal').classList.remove('hidden'));
  const card = page.locator('#debriefModal .modal-card');
  expect((await card.boundingBox()).width).toBeLessThanOrEqual(520);
  await page.screenshot({ path: testInfo.outputPath('debrief-desktop.png') });

  await page.setViewportSize({ width: 360, height: 800 });
  const box = await card.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('debrief-360.png') });
});
