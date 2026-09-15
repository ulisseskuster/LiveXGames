const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { carimbar, hashDoArquivo, INDEX_PATH } = require('../../scripts/stamp-assets');

/**
 * O servidor marca todo .js/.css com `?v=` como `max-age=30 dias, immutable`
 * (server.js, VERSIONED_ASSET_MAX_AGE). `immutable` instrui o navegador a nem
 * revalidar: publicar um arquivo alterado mantendo a mesma string de versão
 * prende quem já visitou o site na versão antiga por um mês, sem erro visível.
 *
 * Foi assim que uma correção de vidas foi ao ar e não chegou a ninguém com
 * cache: o app.js era o novo, a URL era a velha. Este teste é o que impede a
 * repetição — se o conteúdo mudou e o carimbo não, ele falha aqui, não em
 * produção.
 */
test('todo asset versionado no index.html carrega o hash do seu conteúdo atual', () => {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { mudancas, ausentes } = carimbar(html);

  assert.deepEqual(ausentes, [], 'index.html referencia asset que não existe no disco');

  assert.deepEqual(
    mudancas,
    [],
    `Asset(s) alterados sem recarimbar a versão: ${mudancas
      .map((m) => `${m.asset} (${m.de} -> ${m.para})`)
      .join(', ')}. Rode "npm run assets:stamp" e comite o index.html.`
  );
});

test('o carimbo muda quando o conteúdo do arquivo muda', () => {
  // Garante que o hash é do conteúdo, e não algo fixo: um carimbo que não
  // reage a mudança não protegeria de nada.
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const versaoNoHtml = html.match(/src="app\.js\?v=([^"]+)"/);

  assert.ok(versaoNoHtml, 'index.html precisa referenciar app.js com ?v=');
  assert.equal(versaoNoHtml[1], hashDoArquivo('app.js'));
  assert.notEqual(hashDoArquivo('app.js'), hashDoArquivo('sound.js'));
});
