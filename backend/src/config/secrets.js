// @ts-check
const crypto = require('crypto');

/**
 * Resolve segredos criptográficos a partir do ambiente, sem nunca cair em um
 * valor fixo conhecido publicamente (evita segredos hardcoded no repositório).
 *
 * - Se a variável de ambiente estiver definida, ela é sempre usada.
 * - Em produção, a ausência da variável é um erro fatal de inicialização
 *   (o serviço deve ser configurado corretamente antes de subir).
 * - Fora de produção (dev/test), gera um segredo aleatório efêmero por
 *   processo, para que o ambiente continue funcional sem exigir configuração
 *   manual, mas sem reutilizar um segredo público e previsível.
 */
function resolveSecret(envVar, label) {
  const value = process.env[envVar];
  if (value && value.trim()) {
    return value.trim();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[Secrets] Variável de ambiente obrigatória ausente em produção: ${envVar} (${label}). ` +
        `Configure-a nas Environment Variables do serviço antes de iniciar.`
    );
  }

  console.warn(
    `[Secrets] ${envVar} não definido no ambiente. Gerando segredo aleatório efêmero para ${label} ` +
      `(válido apenas para este processo). Defina ${envVar} em .env para persistência local.`
  );
  return crypto.randomBytes(48).toString('hex');
}

module.exports = {
  JWT_SECRET: resolveSecret('JWT_SECRET', 'assinatura de tokens JWT'),
  LIVEPIX_WEBHOOK_SECRET: resolveSecret(
    'LIVEPIX_WEBHOOK_SECRET',
    'validação HMAC do webhook LivePix'
  ),
  PIXGG_WEBHOOK_SECRET: resolveSecret('PIXGG_WEBHOOK_SECRET', 'validação HMAC do webhook PixGG')
};
