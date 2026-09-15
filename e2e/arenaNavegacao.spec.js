const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

/**
 * A coluna central da Arena era um rolo único de ~4000px com seis seções
 * empilhadas: para chegar ao ranking o usuário atravessava duas lojas
 * inteiras. Cada seção passou a pertencer a uma aba (data-view).
 */
test.describe('Navegação da Arena', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);
    await page.evaluate(() => window.selectStreamer('nightpilot'));
    await page.waitForTimeout(800);
  });

  test('abre em Jogar e mostra uma area por vez', async ({ page }) => {
    await page.evaluate(() => setArenaView('jogar'));

    const visiveis = await page.evaluate(() =>
      [...document.querySelectorAll('.game-main-content [data-view]')]
        .filter((s) => !s.hidden)
        .map((s) => s.dataset.view)
    );

    // As duas lojas dividem a mesma aba; fora isso, nada de outra aba aparece.
    expect(new Set(visiveis)).toEqual(new Set(['jogar']));
  });

  test('trocar de aba troca a area visivel', async ({ page }) => {
    await page.locator('[data-arena-tab="ranking"]').click();

    await expect(page.locator('.leaderboard-bay')).toBeVisible();
    await expect(page.locator('.game-bay')).toBeHidden();
    await expect(page.locator('[data-arena-tab="ranking"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('ranking escolhe jogo e período: semanal, mensal e desde o início', async ({ page }) => {
    await page.locator('[data-arena-tab="ranking"]').click();
    const mensalNeon = page.waitForRequest(/\/api\/leaderboard\/monthly\?gameId=neon_drifter/);
    await page.locator('[data-ranking-game="neon_drifter"]').click();
    await page.locator('[data-ranking-period="monthly"]').click();
    await mensalNeon;
    await expect(page.locator('#leaderboardTitle')).toContainText('Ranking Mensal');
    await expect(page.locator('#leaderboardTitle')).toContainText('Neon Drifter', {
      ignoreCase: true
    });
    await expect(page.locator('[data-ranking-period="monthly"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const geralJet = page.waitForRequest(/\/api\/leaderboard\/all\?gameId=jet_launcher/);
    await page.locator('[data-ranking-game="jet_launcher"]').click();
    await page.locator('[data-ranking-period="all"]').click();
    await geralJet;
    await expect(page.locator('#leaderboardTitle')).toContainText('Desde o Início');
  });

  test('a aba escolhida sobrevive ao reload', async ({ page }) => {
    await page.locator('[data-arena-tab="lojas"]').click();
    await expect(page.locator('#platformShopSection')).toBeVisible();

    await page.reload();
    await dismissPostLoginModals(page);
    await page.waitForTimeout(800);

    await expect(page.locator('#platformShopSection')).toBeVisible();
    await expect(page.locator('.game-bay')).toBeHidden();
  });

  test('a pagina encolhe: era um rolo de ~4000px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => setArenaView('jogar'));
    await page.waitForTimeout(400);

    const altura = await page.evaluate(() => document.body.scrollHeight);
    // Antes da remodelagem: 4052px com tudo empilhado.
    expect(altura).toBeLessThan(2600);
  });

  test('atalhos que rolavam ate uma secao trocam de aba antes', async ({ page }) => {
    await page.evaluate(() => setArenaView('jogar'));
    // Rolar ate um elemento escondido nao faz nada: o clique pareceria quebrado.
    await page.evaluate(() => irParaSecao('platformShopSection'));
    await page.waitForTimeout(400);

    await expect(page.locator('#platformShopSection')).toBeVisible();
  });

  test('as setas do teclado percorrem as abas', async ({ page }) => {
    await page.locator('[data-arena-tab="jogar"]').focus();
    await page.keyboard.press('ArrowRight');

    await expect(page.locator('[data-arena-tab="lojas"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('as duas lojas da aba Lojas se identificam como coisas diferentes', async ({ page }) => {
    await page.locator('[data-arena-tab="lojas"]').click();

    const plataforma = page.locator('#platformShopSection');
    const canal = page.locator('#streamerShopSection');

    // Sao dois grids de cards parecidos, lado a lado, mas compram coisas de
    // natureza diferente: item virtual de partida x brinde real do streamer.
    // Cada uma precisa dizer isso sem depender de o usuario ler o paragrafo.
    await expect(plataforma).toContainText('LOJA DA PLATAFORMA');
    await expect(plataforma).toContainText('Entrega instantânea');
    await expect(plataforma).toContainText('Vale em todos os canais');

    await expect(canal).toContainText('LOJINHA OFICIAL DO CANAL');
    await expect(canal).toContainText('Enviado pelo streamer');
    await expect(canal).toContainText('Exclusivo deste canal');

    // A faixa de fatos e o que carrega a distincao: se sumir, as duas voltam
    // a ser a mesma vitrine repetida.
    await expect(plataforma.locator('.shop-identity li')).toHaveCount(3);
    await expect(canal.locator('.shop-identity li')).toHaveCount(3);
  });

  test('no celular a pagina nao rola na horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-arena-tab="ranking"]').click();
    await page.waitForTimeout(500);

    const { scrollW, clientW, tabelaRolaSozinha } = await page.evaluate(() => {
      const c = document.querySelector('.leaderboard-table-container');
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        tabelaRolaSozinha: c ? c.scrollWidth > c.clientWidth : false
      };
    });

    // A tabela do ranking tem 6 colunas e nao cabe em 390px — ela rola dentro
    // do proprio quadro, sem arrastar a pagina junto.
    expect(scrollW).toBe(clientW);
    expect(tabelaRolaSozinha).toBe(true);
  });

  // Fixa, a barra do topo quebrava em ~430px e cobria mais da metade da tela.
  test('no celular o cabecalho nao cobre a Arena', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(500);
    const { fixo, topoAbas, fimCabecalho } = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const topbar = document.querySelector('.topbar');
      return {
        fixo: getComputedStyle(topbar).position === 'fixed',
        topoAbas: document.querySelector('.arena-tabs').getBoundingClientRect().top,
        fimCabecalho: topbar.getBoundingClientRect().bottom
      };
    });
    expect(fixo).toBe(false);
    expect(topoAbas).toBeGreaterThanOrEqual(fimCabecalho);
  });
});
