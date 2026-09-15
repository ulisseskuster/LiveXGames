const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');
const { enquadrar } = require('./cinemaHelpers');

// O renderer pode levar mais de 5 s no CI; o timeout total do teste não
// aumenta o timeout das asserções. A captura da falha já mostrava a cena pronta.
const montagemTimeout = process.env.CI ? 60000 : 30000;

// Além das imagens para revisão, verifica os pontos frágeis do novo cockpit:
// loja estreita, arte carregada, fechamento fixo e recibo sem intervenção.
for (const [game, tab] of [
  ['jet', '#tabJetLauncher'],
  ['neon', '#tabNeonDrifter'],
  ['void', '#tabVoidWalker']
]) {
  test(`${game}: arte e suprimentos responsivos; filme completo mantém recibo`, async ({
    page
  }) => {
    test.setTimeout(process.env.CI ? 300000 : 120000);
    const erros = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await page.goto('/?webgl=1');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
    await page.locator(tab).click();
    await expect(page.locator('#jogoNovoContainer canvas')).toBeVisible({
      timeout: montagemTimeout
    });
    // O canvas aparece antes de a cena terminar de compilar os materiais.
    // eslint-disable-next-line no-undef -- estado léxico do app.js, executado na página
    await page.waitForFunction(() => jogoNovo.controle?.temRender && !jogoNovo.montando, null, {
      timeout: montagemTimeout
    });

    for (const largura of [1440, 768, 390, 360, 320]) {
      await page.setViewportSize({ width: largura, height: 1000 });
      await expect(page.locator('#arenaIntroTitle')).toHaveText(
        await page.locator(`${tab} .tab-title`).innerText(),
        { ignoreCase: true }
      );
      expect(
        await page.locator('.arena-intro').evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      await enquadrar(page, '.game-viewport');
      await page.locator('.game-viewport').screenshot({
        path: `artifacts/apresentacao-2026-09-14/${game}-${largura}-pronto.png`
      });
      await page.locator('#hudShopToggle').click();
      await expect(page.locator('.arena-intro')).toBeHidden();
      await expect(page.locator('.hud-item-icon img')).toHaveCount(3);
      await expect
        .poll(() =>
          page
            .locator('.hud-item-icon img')
            .evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0))
        )
        .toBe(true);
      const layout = await page.locator('#hudShopPanel').evaluate((el) => {
        const grid = el.querySelector('.hud-shop-grid');
        const close = el.querySelector('.hud-close');
        const antes = close.getBoundingClientRect().top;
        grid.scrollTop = grid.scrollHeight;
        return {
          semOverflow: el.scrollWidth <= el.clientWidth && grid.scrollWidth <= grid.clientWidth,
          fechamentoFixo: close.getBoundingClientRect().top === antes
        };
      });
      expect(layout).toEqual({ semOverflow: true, fechamentoFixo: true });
      if (largura === 320)
        await page.locator('.game-viewport').screenshot({
          path: `artifacts/apresentacao-2026-09-14/${game}-320-loja.png`
        });
      await page.locator('#hudShopClose').click();
      await expect(page.locator('#hudShopToggle')).toBeFocused();
      if (largura === 320) {
        await page.locator('.arena-gallery summary').click();
        const galeria = page.locator('.arena-gallery-track');
        await galeria.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => galeria.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        expect(
          await page.locator('.game-bay').evaluate((el) => el.scrollWidth <= el.clientWidth)
        ).toBe(true);
        await page.locator('.arena-gallery summary').click();
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.arena-gallery summary').click();
    await expect(page.locator('.arena-gallery img')).toHaveCount(3);
    await expect
      .poll(() =>
        page
          .locator('.arena-gallery img')
          .evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0))
      )
      .toBe(true);
    await page
      .locator('.arena-gallery')
      .screenshot({ path: `artifacts/apresentacao-2026-09-14/${game}-galeria.png` });
    await page.locator('.arena-gallery summary').click();
    const resposta = page.waitForResponse((r) => r.url().includes('/reveal'));
    await page.locator('#launchJetBtn').click();
    const rodada = (await (await resposta).json()).data;
    await enquadrar(page, '.game-viewport');
    await expect(page.locator('.arena-intro')).toBeHidden();
    const palco = page.locator('#jogoNovoContainer');
    await page.waitForTimeout(1200);
    await palco.screenshot({ path: `artifacts/apresentacao-2026-09-14/${game}-inicio.png` });
    await page.waitForTimeout(5500);
    await palco.screenshot({ path: `artifacts/apresentacao-2026-09-14/${game}-meio.png` });
    await page.waitForTimeout(5500);
    await palco.screenshot({ path: `artifacts/apresentacao-2026-09-14/${game}-climax.png` });
    await expect(page.locator('#debriefModal')).toBeVisible({ timeout: 15000 });
    const resultado = await page.evaluate(() => window.__livexUltimaPartida.oficial);
    expect(resultado.score).toBe(rodada.generatedResult.score);
    expect(resultado.hash).toBe(rodada.generatedResult.hash);
    await expect(page.locator('#debriefVehicle')).toBeVisible();
    await expect(page.locator('#debriefCrew')).not.toBeEmpty();
    await expect(page.locator('#debriefItems')).toHaveText('Nenhum consumível usado nesta rodada.');
    await page.locator('.debrief-card').screenshot({
      path: `artifacts/apresentacao-2026-09-14/${game}-resultado.png`
    });
    expect(erros).toEqual([]);
  });
}

test('pintura dourada e movimento reduzido carregam pelo renderer automático', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240000 : 90000);
  const erros = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  await expect(page.locator('#jogoNovoContainer canvas')).toBeVisible({
    timeout: montagemTimeout
  });
  await expect(page.locator('#arenaIntroVehicle')).toHaveCSS('animation-name', 'none');
  for (const game of ['jet_launcher', 'neon_drifter', 'void_walker']) {
    // Usa a API pública de montagem: só demonstração local, sem promover conta
    // ou produzir recompensas. Também exercita a liberação dos recursos gráficos.
    const montado = await page.evaluate(async (gameId) => {
      const palco = document.createElement('div');
      palco.id = 'palcoVisualTeste';
      palco.style.cssText = 'position:fixed;top:90px;left:0;width:920px;height:520px;z-index:10000';
      document.body.prepend(palco);
      window.__visualTeste = await window.LiveXJogos.montar(gameId, palco, {
        assinante: true,
        lendario: false
      });
      return window.__visualTeste.temRender;
    }, game);
    expect(montado).toBe(true);
    await page.locator('#palcoVisualTeste').screenshot({
      path: `artifacts/apresentacao-2026-09-14/${game}-dourado-reduzido.png`
    });
    await page.evaluate(() => {
      window.__visualTeste.destruir();
      document.getElementById('palcoVisualTeste').remove();
      delete window.__visualTeste;
    });
  }
  expect(erros).toEqual([]);
});
