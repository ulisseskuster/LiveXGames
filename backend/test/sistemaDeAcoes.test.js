const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

/**
 * O gradiente magenta do .primary-btn tinha chegado a 25 botões — de "Fechar" a
 * "Confirmar Resgate". Com tudo em destaque, nenhuma cor informava nada, e
 * dispensar um aviso pesava visualmente o mesmo que gastar moedas.
 *
 * O teto abaixo é o que impede a volta do problema: magenta é para converter
 * (criar conta, entrar na Arena) e mais nada. Se um botão novo precisa de
 * destaque, quase sempre ele quer .economy-btn, .chance-btn ou .config-btn —
 * e se realmente for conversão, suba o teto junto com a justificativa.
 */
const TETO_PRIMARY = 8;

/**
 * Conta ocorrências reais, ignorando comentários.
 *
 * O index.html tem um comentário que cita ".primary-btn" ao explicar por que um
 * botão do hero deixou de ser primário — uma nota de design, não um botão. Sem
 * descontar isso, o teto acusaria um uso que não existe na tela.
 */
function contarOcorrencias(texto, alvo, { html = false } = {}) {
  const limpo = html
    ? texto.replace(/<!--[\s\S]*?-->/g, '')
    : texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return limpo.split(alvo).length - 1;
}

test('magenta continua reservado: .primary-btn não volta a ser a cor de tudo', () => {
  const noHtml = contarOcorrencias(HTML, 'primary-btn', { html: true });
  const noJs = contarOcorrencias(APP_JS, 'primary-btn');
  const total = noHtml + noJs;

  assert.ok(
    total <= TETO_PRIMARY,
    `.primary-btn aparece ${total}x (${noHtml} no HTML, ${noJs} no app.js), acima do teto de ${TETO_PRIMARY}. ` +
      'Magenta é só para converter. Para outras ações use .economy-btn (moeda), ' +
      '.chance-btn (sorte/apoio), .config-btn (salvar), .ghost-btn (ferramenta), ' +
      '.secondary-btn (dispensar) ou .danger-btn (destruir).'
  );
});

test('os sete papéis do sistema de ações existem no CSS', () => {
  for (const classe of [
    'primary-btn',
    'economy-btn',
    'chance-btn',
    'config-btn',
    'ghost-btn',
    'secondary-btn',
    'danger-btn'
  ]) {
    assert.ok(
      CSS.includes(`.${classe} {`),
      `.${classe} precisa estar definida em styles.css para o sistema fazer sentido`
    );
  }
});

test('os tokens novos são declarados antes de serem usados', () => {
  for (const token of ['--amber', '--indigo', '--indigo-solid']) {
    assert.ok(CSS.includes(`${token}:`), `token ${token} não declarado no :root`);
  }
});

test('ação destrutiva não veste a cor de ferramenta', () => {
  // Desvincular conta usava `ghost-btn danger-text`: borda ciano de ferramenta
  // com texto vermelho por cima, as duas cores discordando no mesmo botão.
  for (const ident of ['unlinkTwitchBtn', 'unlinkKickBtn']) {
    const tag = HTML.match(new RegExp(`<button[^>]*id="${ident}"[^>]*>`));
    assert.ok(tag, `${ident} não encontrado no HTML`);
    assert.ok(tag[0].includes('danger-btn'), `${ident} deveria usar .danger-btn`);
    assert.ok(!tag[0].includes('ghost-btn'), `${ident} não pode ser .ghost-btn: é destrutivo`);
  }
});

test('fechar e voltar não usam a cor de converter', () => {
  for (const ident of ['closeDebriefBtn', 'closeRedeemSuccessBtn', 'finishStreamLinkBtn']) {
    const tag = HTML.match(new RegExp(`<button[^>]*id="${ident}"[^>]*>`));
    assert.ok(tag, `${ident} não encontrado no HTML`);
    assert.ok(
      !tag[0].includes('primary-btn'),
      `${ident} dispensa um fluxo: não pode competir com a ação principal da tela`
    );
  }
});

test('gastar moeda usa a cor da economia', () => {
  const tag = HTML.match(/<button[^>]*id="confirmRedeemBtn"[^>]*>/);
  assert.ok(tag, 'confirmRedeemBtn não encontrado');
  assert.ok(
    tag[0].includes('economy-btn'),
    'Confirmar Resgate debita moedas do jogador: precisa vestir o verde da economia'
  );
});
