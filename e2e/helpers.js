/**
 * Registra um novo piloto de teste e retorna o username gerado.
 * Assume que `page` já está em '/' com o modal de autenticação fechado.
 */
async function registerNewUser(page, { selectChannel = true } = {}) {
  const username = 'e2e_' + Date.now().toString().slice(-9);

  await page.click('text=Criar Conta Grátis');
  await page.waitForSelector('#registerForm', { state: 'visible' });
  await page.click('#tabRegisterBtn');
  await page.fill('#regName', 'Playwright E2E');
  await page.fill('#regPhone', '11999998888');
  await page.fill('#regUsername', username);
  await page.fill('#regEmail', username + '@example.com');
  await page.fill('#regPassword', 'senha123456');
  // Data de nascimento e aceite dos Termos passaram a ser obrigatórios no
  // cadastro (ver AuthService.register): a suíte precisa preencher os dois,
  // porque é exatamente o caminho que um usuário real percorre.
  await page.fill('#regBirthDate', '1990-05-20');
  await page.check('#regAcceptTerms');
  await page.click('#registerForm button[type=submit]');
  // Ancora no chip da Arena em vez de "text=<username>": o nome aparece em mais
  // de um lugar (topbar da Arena e botao "Arena · <user>" da homepage), e o
  // seletor por texto pegava o primeiro do DOM, que fica oculto com a Arena
  // aberta — a espera estourava mesmo com o cadastro tendo dado certo.
  await page.waitForSelector(`#currentUsername:text-is("${username}")`, { timeout: 10000 });

  await dismissPostLoginModals(page);
  if (selectChannel) {
    await page.evaluate(() => window.selectStreamer('nightpilot'));
    // Sem canal, "Começar" não abre rodada: só segue com o canal carregado.
    await page.waitForFunction(() => state.currentChannel?.username === 'nightpilot');
  }
  return username;
}

/**
 * Fecha modais que abrem automaticamente após o registro/login (Diretório de
 * Streamers, vínculo de Twitch/Kick) para liberar cliques em elementos por trás.
 */
async function dismissPostLoginModals(page) {
  for (let i = 0; i < 6; i++) {
    const stillOpen = await page.evaluate(() => {
      const open = document.querySelectorAll('.modal-overlay:not(.hidden)');
      open.forEach((m) => m.classList.add('hidden'));
      return open.length;
    });
    if (stillOpen === 0) break;
    await page.waitForTimeout(300);
  }
}

module.exports = { registerNewUser, dismissPostLoginModals };

// Financia somente a carteira de teste indicada, pela rota administrativa real.
async function grantChannel(
  page,
  amount = 1000,
  streamerId = '33333333-3333-3333-3333-333333333333'
) {
  const { request } = require('@playwright/test');
  const me = (await (await page.request.get('/api/auth/me')).json()).data;
  const admin = await request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const login = await admin.post('/api/auth/login', {
      data: { username: 'admin_livex', password: 'Local-E2E-Only-2026!' }
    });
    if (!login.ok()) throw new Error('Não foi possível autenticar o admin local de testes');
    const result = await admin.post('/api/admin/streamer-wallets/grant', {
      data: { userId: me.user.id, streamerId, amount }
    });
    if (!result.ok()) throw new Error(await result.text());
  } finally {
    await admin.dispose();
  }
  await page.evaluate(() => window.loadChannelWallet());
}
module.exports.grantChannel = grantChannel;
