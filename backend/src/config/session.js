// @ts-check
/**
 * Cookie de sessão usado pelas navegações de página que não podem mandar o
 * cabeçalho Authorization (/tests.html) e pelo diagnóstico detalhado de /health
 * e /status. As chamadas de API continuam usando `Authorization: Bearer`.
 *
 * HttpOnly mantém o valor fora do alcance de qualquer script da página, e
 * SameSite=Strict impede que uma navegação vinda de outro site o carregue junto.
 * Secure fica ligado em produção (em desenvolvimento o host é http://localhost,
 * onde um cookie Secure seria descartado pelo navegador).
 */
const SESSION_COOKIE = 'livex_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // espelha o expiresIn do JWT

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  };
}

module.exports = { SESSION_COOKIE, SESSION_MAX_AGE_MS, sessionCookieOptions };
