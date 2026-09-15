const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

const NIGHTPILOT_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Painel de doações ao vivo, no estilo das placas de LED de estádio.
 *
 * O risco embutido: uma faixa com `white-space: nowrap` dentro de um item de
 * grid (que nasce com `min-width: auto`) estoura a coluna inteira. Medido antes
 * da correção: a .game-bay ia a 3065px num viewport de 1280.
 */
async function semearDoacoes(request, mensagens) {
  // A sessão fica no cookie deste contexto de requisição.
  await request.post('/api/auth/login', {
    data: { username: 'nightpilot', password: 'streamer123' }
  });

  for (const message of mensagens) {
    const payload = {
      provider: 'livepix',
      external_id: `pnl-${Date.now()}-${Math.random()}`,
      amount: 25,
      message
    };
    const sig = await request.post('/api/dev/sign-webhook', {
      data: { payload, provider: 'livepix', streamerId: NIGHTPILOT_ID }
    });
    await request.post(`/webhooks/livepix/${NIGHTPILOT_ID}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-livepix-signature': (await sig.json()).data.signature
      },
      data: JSON.stringify(payload)
    });
  }
}

async function abrirArena(page) {
  await page.goto('/');
  await registerNewUser(page);
  await dismissPostLoginModals(page);
  await page.evaluate(() => window.selectStreamer('nightpilot'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => setArenaView('jogar'));
  await page.waitForTimeout(700);
}

test.describe('Painel de doações ao vivo', () => {
  test('a faixa NAO estoura a largura da coluna', async ({ page, request }) => {
    // Mensagens longas: e com elas que o nowrap estourava o layout.
    await semearDoacoes(request, [
      'Mensagem bem comprida para esticar a faixa ao maximo possivel aqui',
      'Outra mensagem longa de proposito para forcar a largura da trilha',
      'E mais uma terceira igualmente comprida para nao dar sorte ao acaso'
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await abrirArena(page);

    const medidas = await page.evaluate(() => ({
      gameBay: Math.round(document.querySelector('.game-bay').getBoundingClientRect().width),
      paginaRola: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));

    // Antes da correcao (min-width: 0 na cadeia): 3065px e a pagina inteira ia junto.
    expect(medidas.gameBay).toBeLessThan(1280);
    expect(medidas.paginaRola).toBe(false);
  });

  test('mostra as doacoes com botoes de like e dislike', async ({ page, request }) => {
    await semearDoacoes(request, ['Salve da suite', 'Boa live']);
    await abrirArena(page);

    await expect(page.locator('#donationTicker')).toBeVisible();

    // O feed ordena por mais recente, entao 'Boa live' entra na frente de
    // 'Salve da suite'. Filtra pelo texto em vez de assumir a posicao.
    const item = page.locator('.ticker-item').filter({ hasText: 'Salve da suite' }).first();
    await expect(item).toBeVisible();
    await expect(item.locator('[data-action="like"]')).toBeVisible();
    await expect(item.locator('[data-action="dislike"]')).toBeVisible();
  });

  test('a animacao para no hover: botao em movimento e inclicavel', async ({ page, request }) => {
    await semearDoacoes(request, ['Teste de pausa no hover']);
    await abrirArena(page);

    const trilha = page.locator('#donationTickerTrack');
    expect(await trilha.evaluate((e) => getComputedStyle(e).animationPlayState)).toBe('running');

    await page.locator('#donationTicker').hover();
    expect(await trilha.evaluate((e) => getComputedStyle(e).animationPlayState)).toBe('paused');
  });

  test('o botao de pausa segura a faixa', async ({ page, request }) => {
    await semearDoacoes(request, ['Teste do botao de pausa']);
    await abrirArena(page);

    await page.locator('#tickerPauseBtn').click();

    await expect(page.locator('#donationTicker')).toHaveClass(/is-paused/);
    await expect(page.locator('#tickerPauseBtn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('curtir na faixa conta de verdade e bate com o mural', async ({ page, request }) => {
    // Texto único: o servidor acumula doações (de outros testes e de repetições).
    const texto = `Doacao para curtir pela faixa ${Date.now()}`;
    await semearDoacoes(request, [texto]);
    await abrirArena(page);

    // Para o movimento antes de mirar o botao.
    await page.locator('#tickerPauseBtn').click();

    // dispatchEvent: pausada, a faixa pode parar com o item cortado na borda ou
    // sob o topo fixo, e o clique real estourava 30 s no CI. Aqui se testa a
    // contagem; a mira no botão em movimento é o teste do hover.
    const item = page.locator('.ticker-item').filter({ hasText: texto }).first();
    await item.locator('[data-action="like"]').dispatchEvent('click');
    await expect(item.locator('[data-count="like"]')).toHaveText('1');

    // A mesma doacao no mural precisa refletir o voto: e o mesmo registro.
    await page.evaluate(() => setArenaView('mural'));
    await page.waitForTimeout(500);
    const card = page.locator('.wall-card').filter({ hasText: texto });
    await expect(card.locator('[data-count="like"]')).toHaveText('1');
    await expect(card.locator('[data-action="like"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a faixa so aparece depois de escolher um canal', async ({ page }) => {
    // Sem canal selecionado nao ha doacoes a mostrar. (Nao da para testar
    // "zero doacoes no canal": o InMemoryStore acumula o que os outros testes
    // semearam durante a mesma execucao do servidor.)
    await page.goto('/');
    await registerNewUser(page, { selectChannel: false });
    await dismissPostLoginModals(page);

    await expect(page.locator('#donationTicker')).toBeHidden();
  });
});
