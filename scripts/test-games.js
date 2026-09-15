/**
 * Testes dos jogos fora da suíte do backend: `cargo test` da simulação e o
 * typecheck do cliente. Roda com `npm run games:test`.
 */
const path = require('path');
const { CLIENTE_DIR, SIM_DIR, localizarCargo, rodar } = require('./build-games');

rodar(localizarCargo(), ['test', '--release'], { cwd: SIM_DIR });
rodar(
  process.execPath,
  [path.join(CLIENTE_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
  {
    cwd: CLIENTE_DIR
  }
);
