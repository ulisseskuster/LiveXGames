const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

/**
 * O indicador era um <span> inline com `letter-spacing: 2px`, herança de quando
 * os corações eram emoji de texto. Com SVG no lugar, os ícones embrulhavam para
 * a linha de baixo assim que a barra apertava — a fileira virava uma coluna.
 */
test.describe('Indicador de vidas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
  });

  test('os coracoes ficam numa linha so, inclusive em tela estreita', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.evaluate(() => renderLivesIndicator(2, 3, false));

    const topos = await page.evaluate(() =>
      [...document.querySelectorAll('.life-pip')].map((p) =>
        Math.round(p.getBoundingClientRect().top)
      )
    );

    expect(topos).toHaveLength(3);
    // Mesmo topo para todos = mesma linha. Era exatamente isto que quebrava.
    expect(new Set(topos).size).toBe(1);
  });

  test('desenha um lugar por vida, preenchendo so as disponiveis', async ({ page }) => {
    await page.evaluate(() => renderLivesIndicator(2, 3, false));

    await expect(page.locator('.life-pip')).toHaveCount(3);
    await expect(page.locator('.life-pip.is-filled')).toHaveCount(2);
    await expect(page.locator('#livesNumeric')).toHaveText('2/3');
    await expect(page.locator('.lives-indicator')).not.toHaveClass(/is-empty/);
  });

  test('sub ve as vidas douradas a parte, na mesma fileira', async ({ page }) => {
    await page.evaluate(() => renderLivesIndicator(0, 3, false, 1, 2));

    await expect(page.locator('.life-pip.is-gold')).toHaveCount(2);
    await expect(page.locator('.life-pip.is-gold.is-filled')).toHaveCount(1);
    await expect(page.locator('#livesNumeric')).toHaveText('0/3+1');
    // Sem normal mas com dourada ainda decola: nao e estado vazio.
    await expect(page.locator('.lives-indicator')).not.toHaveClass(/is-empty/);
  });

  test('saldo alto nao vira fileira gigante (Bateria de Vidas passa do maximo)', async ({
    page
  }) => {
    await page.evaluate(() => renderLivesIndicator(7, 10, false));

    // Um coracao e o numero, nunca dez icones espremendo a barra superior.
    await expect(page.locator('.life-pip')).toHaveCount(0);
    await expect(page.locator('#livesNumeric')).toHaveText('7/10');
  });

  test('estados extremos mudam a moldura', async ({ page }) => {
    const pill = page.locator('.lives-indicator');

    await page.evaluate(() => renderLivesIndicator(1, 3, false));
    await expect(pill).toHaveClass(/is-low/);

    await page.evaluate(() => renderLivesIndicator(0, 3, false));
    await expect(pill).toHaveClass(/is-empty/);

    await page.evaluate(() => renderLivesIndicator(3, 3, false));
    await expect(pill).toHaveClass(/is-full/);
  });

  test('streamer e admin veem infinito, nao coracoes', async ({ page }) => {
    await page.evaluate(() => renderLivesIndicator(0, 999, true));

    await expect(page.locator('.lives-indicator')).toHaveClass(/is-unlimited/);
    await expect(page.locator('#livesNumeric')).toHaveText('Ilimitadas');
    await expect(page.locator('.life-pip')).toHaveCount(0);
  });
});
