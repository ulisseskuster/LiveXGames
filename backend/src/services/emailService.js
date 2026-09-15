// @ts-check
const nodemailer = require('nodemailer');

/**
 * Envio de e-mail transacional (redefinição de senha, verificação de endereço).
 *
 * Sem SMTP_HOST configurado, nada é enviado: a mensagem é impressa no log, com
 * o link completo. É o que permite desenvolver e rodar a suíte sem depender de
 * um provedor — e, em produção, um envio que falha nunca derruba a operação que
 * o originou (ver sendEmail).
 *
 * Funciona com qualquer provedor SMTP (Resend, Brevo, SendGrid, Amazon SES,
 * Gmail). Variáveis: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
 */

const FROM_PADRAO = 'LiveX Games <nao-responda@livexgames.com>';

let transporteCache = null;
let avisoConfiguracaoEmitido = false;

function estaConfigurado() {
  return Boolean((process.env.SMTP_HOST || '').trim());
}

function obterTransporte() {
  if (transporteCache) return transporteCache;

  const porta = Number(process.env.SMTP_PORT) || 587;
  transporteCache = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    // 465 é a porta de TLS implícito; 587 negocia com STARTTLS depois de conectar.
    secure: porta === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
  });
  return transporteCache;
}

/**
 * Envia um e-mail via API HTTP do Brevo (bypass de firewall SMTP).
 */
async function sendEmailBrevoAPI({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = (process.env.MAIL_FROM || FROM_PADRAO).trim();

  // Extrai nome e email se estiver no formato "Nome <email@site.com>"
  let senderEmail = fromEmail;
  let senderName = undefined;

  const match = fromEmail.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    senderName = match[1].replace(/["']/g, '').trim() || undefined;
    senderEmail = match[2].trim();
  }

  // Fallback de segurança se o usuário preencher o MAIL_FROM sem @ (ex: apenas o nome "LiveX Games")
  if (!senderEmail.includes('@')) {
    senderName = senderEmail;
    senderEmail = 'nao-responda@livexgames.com';
  }

  // Remove aspas acidentais se o usuário tiver digitado a variável com aspas
  senderEmail = senderEmail.replace(/["']/g, '').trim();

  console.log('[Email Debug] Tentando enviar pela API Brevo com sender:', {
    name: senderName,
    email: senderEmail
  });

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html,
      textContent: text
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Brevo API Error (${response.status}): ${errorData}`);
  }

  console.log('[Email] Enviado com sucesso via API do Brevo para', to);
  return { enviado: true };
}

/**
 * Envia um e-mail. Nunca lança.
 *
 * Quem chama está no meio de um cadastro ou de um pedido de redefinição: uma
 * indisponibilidade do provedor de e-mail não pode desfazer a conta criada nem
 * virar 500 para o usuário. O resultado diz se saiu, e quem chama decide o que
 * contar — sem revelar, no caso de redefinição, se o endereço existe.
 *
 * @returns {Promise<{enviado: boolean, motivo?: string}>}
 */
async function sendEmail({ to, subject, text, html }) {
  if (!estaConfigurado() && !process.env.BREVO_API_KEY) {
    // Nunca registrar o corpo: links de confirmação e reset carregam tokens
    // reutilizáveis. Em testes, também não repetir o mesmo aviso por cadastro.
    if (process.env.NODE_ENV !== 'test' && !avisoConfiguracaoEmitido) {
      avisoConfiguracaoEmitido = true;
      console.warn('[Email] SMTP/API não configurado; mensagens transacionais não serão enviadas.');
    }
    return { enviado: false, motivo: 'NAO_CONFIGURADO' };
  }

  try {
    if (process.env.BREVO_API_KEY) {
      await sendEmailBrevoAPI({ to, subject, text, html });
    } else {
      await obterTransporte().sendMail({
        from: process.env.MAIL_FROM || FROM_PADRAO,
        to,
        subject,
        text,
        html
      });
    }
    return { enviado: true };
  } catch (err) {
    console.error('[Email] Falha ao enviar para', to, '-', err.message);
    return { enviado: false, motivo: err.message };
  }
}

/** Moldura visual compartilhada. Todo texto interpolado aqui é gerado por nós. */
function moldura(titulo, corpo, botao) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#0b1120;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
  <div style="max-width:520px;margin:0 auto;background:#131c24;border:1px solid #26323d;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 20px;font-size:20px;color:#48b3c0;">${titulo}</h1>
    ${corpo}
    ${botao}
    <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #26323d;font-size:12px;color:#8593a1;">
      LiveX Games — este é um e-mail automático, não responda.
    </p>
  </div>
</body></html>`;
}

function botao(url, rotulo) {
  return `<p style="margin:24px 0;">
    <a href="${url}" style="display:inline-block;background:#48b3c0;color:#0b1120;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">${rotulo}</a>
  </p>
  <p style="margin:0;font-size:12px;color:#8593a1;word-break:break-all;">
    Se o botão não funcionar, copie este endereço: ${url}
  </p>`;
}

async function enviarRedefinicaoDeSenha(email, username, url, validadeMinutos) {
  return sendEmail({
    to: email,
    subject: 'Redefinição de senha — LiveX Games',
    text:
      `Olá, ${username}.\n\n` +
      `Recebemos um pedido para redefinir a senha da sua conta LiveX Games.\n` +
      `Abra o endereço abaixo para escolher uma senha nova. Ele vale por ${validadeMinutos} minutos e só pode ser usado uma vez.\n\n` +
      `${url}\n\n` +
      `Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: moldura(
      'Redefinir sua senha',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Olá, <strong>${username}</strong>.</p>
       <p style="margin:0;font-size:15px;line-height:1.6;">Recebemos um pedido para redefinir a senha da sua conta.
       O link vale por ${validadeMinutos} minutos e só pode ser usado uma vez.
       Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.</p>`,
      botao(url, 'Escolher senha nova')
    )
  });
}

async function enviarVerificacaoDeEmail(email, username, url, validadeHoras) {
  return sendEmail({
    to: email,
    subject: 'Confirme seu e-mail — LiveX Games',
    text:
      `Bem-vindo, ${username}!\n\n` +
      `Confirme seu endereço de e-mail abrindo o link abaixo. Ele vale por ${validadeHoras} horas.\n\n` +
      `${url}\n\n` +
      `Confirmar o e-mail é o que permite recuperar sua conta caso você esqueça a senha.`,
    html: moldura(
      'Confirme seu e-mail',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Bem-vindo, <strong>${username}</strong>!</p>
       <p style="margin:0;font-size:15px;line-height:1.6;">Confirme seu endereço de e-mail para poder recuperar a conta
       caso esqueça a senha. O link vale por ${validadeHoras} horas.</p>`,
      botao(url, 'Confirmar e-mail')
    )
  });
}

module.exports = {
  sendEmail,
  estaConfigurado,
  enviarRedefinicaoDeSenha,
  enviarVerificacaoDeEmail
};
