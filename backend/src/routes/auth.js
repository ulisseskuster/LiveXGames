const express = require('express');
const AuthController = require('../controllers/authController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', AuthController.login);
router.post('/register', AuthController.register);
// /reset-test-state e /test-user/:username apagavam uma conta pelo nome sem
// exigir autenticação alguma, barrados apenas por NODE_ENV === 'production'.
// Removidos: nenhuma suíte deste repositório os consumia, e a suíte E2E isola
// o ambiente gerando usuários novos a cada execução (ver e2e/helpers.js).
router.post('/logout', AuthController.logout);

// Recuperação de senha. Ambas sem autenticação, por definição: quem esqueceu a
// senha não consegue se autenticar. O limite de tentativas vem do rate limiter
// aplicado em server.js.
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);

// Confirmação de e-mail: o link chega por e-mail, então também é pública.
router.post('/verify-email', AuthController.verifyEmail);
router.post('/resend-verification', requireAuth, AuthController.resendVerification);

// Aceite dos termos por quem criou conta antes de ele ser obrigatório.
router.post('/accept-terms', requireAuth, AuthController.acceptTerms);
router.get('/me', requireAuth, AuthController.me);
router.put('/profile', requireAuth, AuthController.updateProfile);
router.post('/unlink-stream', requireAuth, AuthController.unlinkStream);

// Rotas Oficiais OAuth 2.0 da Twitch
router.get('/twitch/authorize', AuthController.twitchAuthorize);
router.get('/twitch/callback', AuthController.twitchCallback);

// Rotas Oficiais OAuth 2.1 + PKCE da Kick
router.get('/kick/authorize', AuthController.kickAuthorize);
router.get('/kick/callback', AuthController.kickCallback);

module.exports = router;
