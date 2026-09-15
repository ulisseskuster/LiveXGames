const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

/**
 * Jet Launcher: a rodada é sorteada e liquidada no clique; o navegador só
 * reproduz o filme de 15–20 s, que pode ser pulado sem mudar o resultado.
 *
 * ?webgl=1 força o fallback WebGL2: o Chrome headless do CI não tem adaptador
 * WebGPU, e o que se testa aqui é o ciclo da rodada, não o backend gráfico.
 */
test.describe('Jet Launcher', () => {
  async function jogarEPular(page) {
    await page.click('#launchJetBtn');
    await expect(page.locator('.jl-pular')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1000);
    // No CI lento o filme pode acabar antes do clique e o botão some; clicar só
    // se ainda visível, sem esperar. Esc não serve: fecha o debrief.
    await page.evaluate(() => {
      const pular = document.querySelector('.jl-pular');
      if (pular && !pular.hidden) pular.click();
    });
    await expect(page.locator('#debriefModal')).toBeVisible({ timeout: 30000 });
    return page.evaluate(() => window.__livexUltimaPartida);
  }

  test('rodada valendo volta liquidada, credita moedas e pode ser pulada', async ({ page }) => {
    test.slow(); // WebGL por software no CI.
    const errosDeCsp = [];
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) errosDeCsp.push(msg.text());
    });

    await page.goto('/?webgl=1');
    await registerNewUser(page);
    await dismissPostLoginModals(page);

    const desfecho = await jogarEPular(page);
    expect(desfecho.valendo).toBe(true);
    expect(desfecho.oficial.gameId).toBe('jet_launcher');
    expect(desfecho.oficial.clientHashMatches).toBe(null);
    // O local é só a reprodução até o jogador pular; o oficial é a rodada inteira.
    expect(desfecho.oficial.distance).toBeGreaterThanOrEqual(desfecho.local.distancia);
    expect(desfecho.oficial.ticks).toBeGreaterThanOrEqual(15 * 60);
    expect(desfecho.oficial.ticks).toBeLessThanOrEqual(20 * 60);
    expect(desfecho.oficial.coinsEarned).toBeGreaterThan(0);

    await expect(page.locator('#debriefCoins')).toContainText(`+${desfecho.oficial.coinsEarned}`);
    // Uma vida gasta (3 → 2).
    await expect(page.locator('#livesNumeric')).toContainText('2/3');
    expect(errosDeCsp).toEqual([]);
  });
});
