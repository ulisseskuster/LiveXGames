/**
 * Carimba `?v=` dos assets de frontend com um hash do próprio conteúdo.
 * Roda com `npm run assets:stamp`.
 *
 * Por que isto existe: server.js serve todo .js/.css com `?v=` como
 * `max-age=30 dias, immutable` (ver VERSIONED_ASSET_MAX_AGE). `immutable` diz ao
 * navegador para nem revalidar — então editar app.js sem trocar a string de
 * versão deixa todo mundo que já visitou o site preso na versão antiga por um
 * mês, sem erro nenhum, sem aviso. Aconteceu: um deploy saiu com app.js novo e
 * `?v=` velho, e a correção simplesmente não chegou a quem tinha cache.
 *
 * Com a versão derivada do conteúdo, esquecer de trocar deixa de ser possível:
 * mudou o arquivo, mudou o hash, mudou a URL.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'frontend', 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

// Captura src="app.js?v=..." e href="styles.css?v=..." (com ou sem query atual).
const REFERENCIA = /(src|href)="([^"?]+\.(?:js|css))\?v=([^"]*)"/g;

function hashDoArquivo(relPath) {
  const filePath = path.join(PUBLIC_DIR, relPath);
  if (!fs.existsSync(filePath)) return null;
  // Hash do texto com LF: no Windows o checkout pode trazer CRLF, mas o git grava e
  // o CI/Render servem LF. Com os bytes crus o carimbo local não batia com o publicado.
  const conteudo = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(conteudo).digest('hex').slice(0, 10);
}

/**
 * @returns {{html: string, mudancas: Array<{asset: string, de: string, para: string}>,
 *            ausentes: string[]}}
 */
function carimbar(html) {
  const mudancas = [];
  const ausentes = [];

  const novo = html.replace(REFERENCIA, (match, attr, asset, versaoAtual) => {
    const hash = hashDoArquivo(asset);
    if (!hash) {
      ausentes.push(asset);
      return match;
    }
    if (hash !== versaoAtual) {
      mudancas.push({ asset, de: versaoAtual, para: hash });
    }
    return `${attr}="${asset}?v=${hash}"`;
  });

  return { html: novo, mudancas, ausentes };
}

function main() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const { html: novo, mudancas, ausentes } = carimbar(html);

  for (const asset of ausentes) {
    console.warn(`[stamp-assets] Referência sem arquivo correspondente: ${asset}`);
  }

  if (mudancas.length === 0) {
    console.log('[stamp-assets] Todos os assets já estão carimbados com o hash atual.');
    return;
  }

  fs.writeFileSync(INDEX_PATH, novo, 'utf8');
  for (const { asset, de, para } of mudancas) {
    console.log(`[stamp-assets] ${asset}: ${de || '(sem versão)'} -> ${para}`);
  }
  console.log(`[stamp-assets] ${mudancas.length} asset(s) recarimbado(s) em index.html.`);
}

if (require.main === module) {
  main();
}

module.exports = { carimbar, hashDoArquivo, INDEX_PATH, PUBLIC_DIR };
