// @ts-check
const { test, expect } = require('@playwright/test');
const { registerNewUser, dismissPostLoginModals } = require('./helpers');

// Fluxo do sino de notificações + streak no perfil (frontend real).
// Usa cadastro real (mesmo caminho dos demais e2e) com a persona fresca.

test.describe('Notificações e streak — frontend', () => {
  test('sino aparece logado, painel abre, streak renderiza', async ({ page }) => {
    await page.goto('/');
    const username = await registerNewUser(page, { selectChannel: true });
    await dismissPostLoginModals(page);

    // A autenticação funciona (username no topo)
    await expect(page.locator(`#currentUsername:text-is("${username}")`)).toBeVisible();

    // Streak: elemento existe (pode estar vazio ou com valor, sem rodada ainda)
    const streak = page.locator('#streakDisplay');
    await expect(streak).toBeAttached();

    // Sino visível para autenticado (topbar da Arena)
    const bell = page.locator('#notifBell');
    await expect(bell).toBeVisible();

    // Badge existe (pode estar oculto se 0)
    const badge = page.locator('#notifBadge');
    await expect(badge).toBeAttached();

    // Abrir painel via evaluate: o topbar da Arena pode estar além do viewport
    // e o Playwright recusa mesmo com force. O clique via JS contorna.
    await page.evaluate(() => document.getElementById('notifBellBtn')?.click());
    const panel = page.locator('#notifPanel');
    await expect(panel).toHaveClass(/open/);
    await expect(page.locator('#notifList')).toBeAttached();
  });

  test('sino invisível para visitante', async ({ page }) => {
    await page.goto('/');
    const bell = page.locator('#notifBell');
    await expect(bell).not.toBeVisible();
    // Na landing, o visitante tem o botão Entrar (landingLoginBtn) e o
    // #topbarLoginBtn fica no topbar da Arena, oculto nesta tela.
    await expect(page.locator('#landingLoginBtn')).toBeVisible();
  });

  test('visitante na Arena não vê notificações nem streak de usuário', async ({ page }) => {
    await page.goto('/game?webgl=1');
    await expect(page.locator('#notifBell')).toBeHidden();
    await expect(page.locator('#streakDisplay')).toBeEmpty();
  });
});
