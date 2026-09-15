const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

// Persona fixa de streamer do seed de demonstração (ver db/autoMigrate.js).
const NIGHTPILOT_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Cria uma doação real no canal do nightpilot pelo caminho de produção: assina
 * o payload com o segredo do streamer e entrega no webhook.
 *
 * Sem `username` no payload o livepixService não identifica doador e grava a
 * doação como "não vinculada" (user_id NULL) — que é justamente o caso em que
 * qualquer viewer pode reagir, sem esbarrar na trava de auto-reação.
 */
async function criarDoacaoComMensagem(request, mensagem, username = null) {
  const login = await request.post('/api/auth/login', {
    data: { username: 'nightpilot', password: 'streamer123' }
  });
  expect(login.ok()).toBeTruthy();

  const payload = {
    provider: 'livepix',
    external_id: `e2e-wall-${Date.now()}`,
    amount: 42.0,
    message: mensagem,
    // Com username de uma conta, o livepixService vincula a doação a ela.
    ...(username ? { username } : {})
  };

  // A sessão vai no cookie que o login deixou neste contexto de requisição.
  const assinatura = await request.post('/api/dev/sign-webhook', {
    data: { payload, provider: 'livepix', streamerId: NIGHTPILOT_ID }
  });
  expect(assinatura.ok()).toBeTruthy();
  const signature = (await assinatura.json()).data.signature;

  // O corpo é assinado byte a byte (req.rawBody), então vai como string crua —
  // a mesma que o endpoint de assinatura serializou.
  const entrega = await request.post(`/webhooks/livepix/${NIGHTPILOT_ID}`, {
    headers: { 'Content-Type': 'application/json', 'x-livepix-signature': signature },
    data: JSON.stringify(payload)
  });
  expect(
    entrega.ok(),
    `webhook recusou a doacao de apoio do teste: ${entrega.status()} ${await entrega.text()}`
  ).toBeTruthy();
}

test.describe('Mural Social de Doações', () => {
  test('viewer abre o canal, ve a doacao no mural, curte e o voto sobrevive ao reload', async ({
    page,
    request
  }) => {
    const mensagem = `Salve da suite E2E ${Date.now()}`;
    await criarDoacaoComMensagem(request, mensagem);

    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);

    await page.evaluate(() => window.selectStreamer('nightpilot'));
    await page.evaluate(() => setArenaView('mural'));

    const mural = page.locator('#donationWallSection');
    await expect(mural).toBeVisible();

    const card = page.locator('.wall-card').filter({ hasText: mensagem });
    await expect(card).toBeVisible();

    const botaoLike = card.locator('[data-action="like"]');
    await expect(botaoLike).toHaveAttribute('aria-pressed', 'false');
    await expect(botaoLike.locator('[data-count="like"]')).toHaveText('0');

    await botaoLike.click();

    // Atualização otimista: o contador sobe com a resposta do POST, sem esperar
    // o socket — o socket é para os outros espectadores.
    await expect(botaoLike.locator('[data-count="like"]')).toHaveText('1');
    await expect(botaoLike).toHaveAttribute('aria-pressed', 'true');

    // O voto está no banco, não só na tela.
    await page.reload();
    await dismissPostLoginModals(page);
    await page.evaluate(() => window.selectStreamer('nightpilot'));
    await page.evaluate(() => setArenaView('mural'));

    const cardDepois = page.locator('.wall-card').filter({ hasText: mensagem });
    await expect(cardDepois.locator('[data-count="like"]')).toHaveText('1');
    await expect(cardDepois.locator('[data-action="like"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Clicar de novo é toggle: o voto sai, não vira dois.
    await cardDepois.locator('[data-action="like"]').click();
    await expect(cardDepois.locator('[data-count="like"]')).toHaveText('0');
    await expect(cardDepois.locator('[data-action="like"]')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  test('o mural fica oculto enquanto nenhum canal esta selecionado', async ({ page }) => {
    await page.goto('/');
    await registerNewUser(page);
    await dismissPostLoginModals(page);

    // O atributo hidden do HTML vale por uma regra da folha do agente, que
    // perde para qualquer display do autor — e .wall-bay e display:flex. Sem o
    // override no CSS a secao aparecia vazia antes de escolher um streamer.
    await expect(page.locator('#donationWallSection')).toBeHidden();
  });

  test('visitante deslogado ve o mural mas nao consegue reagir', async ({ page, request }) => {
    const mensagem = `Mensagem publica ${Date.now()}`;
    await criarDoacaoComMensagem(request, mensagem);

    await page.goto('/');
    await page.click('#landingStreamersBtn');
    await page.click('#streamerDirectoryGrid .streamer-directory-card[data-username="nightpilot"]');
    await page.waitForTimeout(600);
    await page.evaluate(() => setArenaView('mural'));

    const card = page.locator('.wall-card').filter({ hasText: mensagem });
    await expect(card).toBeVisible();

    // Sem sessão não há voto: o servidor recusa com 401 e a interface manda
    // fazer login em vez de contar um like fantasma.
    await card.locator('[data-action="like"]').click();
    await expect(card.locator('[data-count="like"]')).toHaveText('0');
  });

  test('maiores doadores lista quem doou, pelo nome', async ({ page, request }) => {
    await page.goto('/');
    const username = await registerNewUser(page);
    await dismissPostLoginModals(page);
    await criarDoacaoComMensagem(request, `Doação identificada ${Date.now()}`, username);

    await page.evaluate(() => setArenaView('mural'));
    await page.locator('#wallSortFilters [data-sort="donors"]').click();

    await expect(page.locator('#wallPodium')).toContainText('Maiores Doadores');
    await expect(
      page.locator('#wallPodium, #wallFeed').getByText(username, { exact: true })
    ).toBeVisible();
  });
});
