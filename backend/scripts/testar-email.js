#!/usr/bin/env node
// @ts-check
/**
 * Diagnóstico da configuração de e-mail.
 *
 *   npm run email:test                    -> só confere a conexão com o SMTP
 *   npm run email:test seu@email.com      -> confere e envia uma mensagem real
 *
 * Existe para transformar "configurei e torço" em uma resposta em dez segundos.
 * Erro de SMTP em produção aparece tarde e de forma indireta: o usuário pede a
 * redefinição, recebe "enviamos o link" e nada chega — e no log fica só um
 * aviso. Aqui o erro aparece na hora, com a causa provável e o que fazer.
 */
require('dotenv').config();

const nodemailer = require('nodemailer');
const EmailService = require('../src/services/emailService');

const destino = process.argv[2] || null;

const CORES = {
  ok: '\x1b[32m',
  erro: '\x1b[31m',
  aviso: '\x1b[33m',
  info: '\x1b[36m',
  fim: '\x1b[0m'
};

const linha = (cor, simbolo, texto) => console.log(`${CORES[cor]}${simbolo}${CORES.fim} ${texto}`);

/**
 * Traduz os erros mais comuns de SMTP para o que fazer a respeito. As
 * mensagens cruas ("EAUTH", "ECONNREFUSED") não dizem nada a quem está só
 * tentando ligar o envio de e-mail.
 */
function explicar(err) {
  const codigo = err.code || '';
  const texto = String(err.message || '');

  if (codigo === 'EAUTH' || /535|authentication/i.test(texto)) {
    return [
      'Usuário ou senha recusados pelo provedor.',
      'Confira SMTP_USER e SMTP_PASS. Em vários provedores o usuário NÃO é o seu e-mail:',
      '  Brevo    -> SMTP_USER é o login SMTP mostrado no painel (algo como 91abc1@smtp-brevo.com)',
      '  Resend   -> SMTP_USER é literalmente a palavra "resend" e SMTP_PASS é a API key',
      '  SendGrid -> SMTP_USER é literalmente "apikey"'
    ];
  }
  if (codigo === 'ECONNREFUSED' || codigo === 'ENOTFOUND' || codigo === 'EDNS') {
    return [
      'Não foi possível chegar ao servidor SMTP.',
      'Confira SMTP_HOST (erro de digitação é a causa mais comum) e se a porta não está bloqueada.'
    ];
  }
  if (codigo === 'ETIMEDOUT' || codigo === 'ESOCKET') {
    return [
      'A conexão expirou ou o TLS falhou.',
      'Quase sempre é porta errada: use 587 (STARTTLS) ou 465 (TLS direto).',
      `Você está usando a porta ${process.env.SMTP_PORT || 587}.`
    ];
  }
  if (/from|sender|domain|not verified/i.test(texto)) {
    return [
      'O remetente foi recusado.',
      'O domínio do MAIL_FROM precisa estar verificado no painel do provedor.',
      `MAIL_FROM atual: ${process.env.MAIL_FROM || '(não definido)'}`
    ];
  }
  return ['Erro não reconhecido. A mensagem crua do provedor está acima.'];
}

async function principal() {
  console.log('\n=== Diagnóstico de e-mail — LiveX Games ===\n');

  if (!EmailService.estaConfigurado()) {
    linha('aviso', '!', 'SMTP_HOST não está definido.');
    console.log('');
    console.log('  Sem ele nenhum e-mail sai: o link de redefinição só aparece no log do');
    console.log('  servidor. O fluxo "esqueci minha senha" responde ao usuário mas não');
    console.log('  entrega nada.');
    console.log('');
    console.log('  Preencha no backend/.env (ou nas variáveis do Render):');
    console.log('    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM');
    console.log('');
    process.exit(1);
  }

  // Confusão comum: o login SMTP não é um endereço de remetente. No Brevo ele
  // tem cara de e-mail (91abc1@smtp-brevo.com), o que convida a colá-lo também
  // no MAIL_FROM — e aí toda mensagem é recusada.
  const remetente = process.env.MAIL_FROM || '';
  if (/@smtp-brevo\.com|@smtp\./i.test(remetente)) {
    linha('erro', '✗', 'MAIL_FROM está usando o login SMTP como remetente.');
    console.log('');
    console.log('  O login SMTP é só um identificador de autenticação, não um endereço.');
    console.log('  MAIL_FROM precisa ser um remetente verificado no painel do provedor.');
    console.log('');
    process.exit(1);
  }

  const dominioRemetente = (remetente.match(/@([^\s>]+)/) || [])[1] || '';
  if (/^(gmail|hotmail|outlook|yahoo|live|icloud|bol|uol|terra)\./i.test(dominioRemetente)) {
    linha('aviso', '!', `MAIL_FROM usa um domínio gratuito (${dominioRemetente}).`);
    console.log('');
    console.log('  Desde 2024, Gmail e Yahoo recusam ou mandam para spam mensagens enviadas');
    console.log('  por um provedor em nome de um endereço @gmail.com, @outlook.com e afins.');
    console.log('  Serve para testar; para valer, use um domínio seu, autenticado no painel.');
    console.log('');
  }

  const porta = Number(process.env.SMTP_PORT) || 587;
  linha('info', '·', `Servidor : ${process.env.SMTP_HOST}:${porta}`);
  linha('info', '·', `Usuário  : ${process.env.SMTP_USER || '(sem autenticação)'}`);
  linha('info', '·', `Senha    : ${process.env.SMTP_PASS ? '(definida)' : '(não definida)'}`);
  linha('info', '·', `Remetente: ${process.env.MAIL_FROM || '(usando o padrão)'}`);
  console.log('');

  // 1. Conexão e autenticação, sem enviar nada.
  const transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    secure: porta === 465,
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
  });

  try {
    await transporte.verify();
    linha('ok', '✓', 'Conexão e autenticação com o servidor SMTP funcionaram.');
  } catch (err) {
    linha('erro', '✗', `Falhou: ${err.message}`);
    console.log('');
    for (const dica of explicar(err)) console.log(`  ${dica}`);
    console.log('');
    process.exit(1);
  }

  // 2. Envio de verdade, que é o que prova a ponta a ponta. Autenticar não
  //    garante entrega: remetente não verificado costuma passar na conexão e
  //    ser recusado só no envio.
  if (!destino) {
    console.log('');
    linha('aviso', '!', 'Nenhum destinatário informado — nada foi enviado.');
    console.log('  Para testar o envio de verdade:  npm run email:test seu@email.com');
    console.log('');
    process.exit(0);
  }

  console.log('');
  linha('info', '·', `Enviando mensagem de teste para ${destino}...`);

  const resultado = await EmailService.sendEmail({
    to: destino,
    subject: 'Teste de configuração — LiveX Games',
    text:
      'Se você está lendo isto, o envio de e-mail da LiveX Games está funcionando.\n\n' +
      'Significa que "esqueci minha senha" e a confirmação de cadastro chegam aos usuários.\n\n' +
      `Enviado em ${new Date().toLocaleString('pt-BR')}.`,
    html:
      '<p>Se você está lendo isto, o envio de e-mail da <strong>LiveX Games</strong> está funcionando.</p>' +
      '<p>Significa que &ldquo;esqueci minha senha&rdquo; e a confirmação de cadastro chegam aos usuários.</p>' +
      `<p style="color:#888;font-size:12px">Enviado em ${new Date().toLocaleString('pt-BR')}.</p>`
  });

  console.log('');
  if (resultado.enviado) {
    linha('ok', '✓', 'Mensagem enviada com sucesso.');
    console.log('');
    console.log(`  Confira a caixa de ${destino} — inclusive o spam, que é onde a`);
    console.log('  primeira mensagem de um domínio recém-configurado costuma cair.');
    console.log('');
    console.log('  Se caiu no spam: verifique SPF e DKIM no painel do provedor.');
    console.log('');
  } else {
    linha('erro', '✗', `Não enviou: ${resultado.motivo}`);
    console.log('');
    for (const dica of explicar(new Error(resultado.motivo || ''))) console.log(`  ${dica}`);
    console.log('');
    process.exit(1);
  }
}

principal().catch((err) => {
  linha('erro', '✗', `Erro inesperado: ${err.message}`);
  process.exit(1);
});
