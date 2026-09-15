/**
 * Gera frontend/public/icons/sprite.svg a partir dos ícones do lucide-static
 * listados em scripts/icon-map.js. Roda com `npm run icons:build`.
 *
 * O sprite fica com um <symbol> por ícone (deduplicado), referenciado no HTML
 * via <svg class="icon"><use href="/icons/sprite.svg#nome"></use></svg>.
 */
const fs = require('fs');
const path = require('path');
const emojiMap = require('./icon-map');

const LUCIDE_ICONS_DIR = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const OUT_PATH = path.join(__dirname, '..', 'frontend', 'public', 'icons', 'sprite.svg');

const iconNames = [...new Set(Object.values(emojiMap))].sort();

const symbols = iconNames.map((name) => {
  const svgPath = path.join(LUCIDE_ICONS_DIR, `${name}.svg`);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`Ícone "${name}" não encontrado em lucide-static (${svgPath})`);
  }
  const raw = fs.readFileSync(svgPath, 'utf8');
  const viewBoxMatch = raw.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';
  const inner = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  return `  <symbol id="${name}" viewBox="${viewBox}">\n    ${inner}\n  </symbol>`;
});

const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n' +
  symbols.join('\n') +
  '\n</svg>\n';

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, sprite, 'utf8');

console.log(`Sprite gerado com ${iconNames.length} ícones únicos em ${OUT_PATH}`);
console.log(`Tamanho: ${(Buffer.byteLength(sprite) / 1024).toFixed(1)} KB`);
