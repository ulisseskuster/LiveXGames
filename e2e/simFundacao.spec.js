const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');
const { SimRuntime } = require('../backend/src/services/sim/simRuntime');

/**
 * Fundação dos jogos (README.md, Determinismo): o .wasm do navegador precisa se
 * comportar bit a bit como o do servidor, e uma partida jogada na página precisa
 * voltar verificada pelo replay.
 */
test.describe('Fundação dos jogos', () => {
  const SEMENTE = 'a1'.repeat(32);

  test('o navegador e o Node produzem o mesmo hash e o mesmo log', async ({ page }) => {
    await page.goto(`/games/sandbox.html?selftest=1&seed=${SEMENTE}&bot=7`);
    const handle = await page.waitForFunction(() => window.__simSelfTest, null, {
      timeout: 20000
    });
    const doNavegador = await handle.jsonValue();
    expect(doNavegador.erro).toBeUndefined();

    const rt = await SimRuntime.load();
    const doNode = rt.jogarComBot({
      gameCode: 0,
      seed: Buffer.from(SEMENTE, 'hex'),
      botSeed: 7
    });

    expect(doNavegador.versao).toBe(rt.version);
    expect(doNavegador.hash).toBe(doNode.result.hash);
    expect(doNavegador.distancia).toBe(doNode.result.distance);
    expect(doNavegador.log).toBe(doNode.log.toString('base64'));
  });

  test('partida jogada no teclado volta verificada, com o mesmo resultado do navegador', async ({
    page
  }) => {
    const errosDeCsp = [];
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) errosDeCsp.push(msg.text());
    });

    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);

    await page.goto('/games/sandbox.html?webgl=1');
    await page.click('#jogarServidor');
    await expect(page.locator('#status')).toContainText('Partida em andamento', {
      timeout: 20000
    });

    await page.keyboard.down('KeyA');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');

    await expect(page.locator('#status')).toContainText('verificada pelo servidor', {
      timeout: 20000
    });
    const { local, oficial } = await page.evaluate(() => window.__ultimoResultado);

    expect(oficial.clientHashMatches).toBe(true);
    expect(oficial.distance).toBe(local.distancia);
    expect(oficial.endReason).toBe(local.motivoFim);
    expect(oficial.ticks).toBeGreaterThan(120);
    expect(errosDeCsp).toEqual([]);
  });
});
