import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const aqui = (caminho: string) => fileURLToPath(new URL(caminho, import.meta.url));

/**
 * O build sai direto em frontend/public/games, servido pelo Express do backend.
 * Não rode `vite build` sozinho: scripts/build-games.js compila o .wasm antes e
 * injeta a URL versionada dele (LIVEX_SIM_WASM_URL).
 */
export default defineConfig({
  base: '/games/',
  define: {
    __SIM_WASM_URL__: JSON.stringify(process.env.LIVEX_SIM_WASM_URL || '/games/livex_sim.wasm')
  },
  build: {
    outDir: aqui('../../frontend/public/games'),
    emptyOutDir: true,
    target: 'es2022',
    // O polyfill de modulepreload é injetado como <script> inline, que a CSP do
    // site bloqueia (script-src sem 'unsafe-inline').
    modulePreload: { polyfill: false },
    // O nome do bundle de embed muda a cada build (hash); o manifesto diz qual é,
    // e scripts/build-games.js escreve o games/loader.js apontando para ele.
    manifest: true,
    rolldownOptions: {
      input: {
        sandbox: aqui('sandbox.html'),
        embed: aqui('src/embed/main.ts')
      }
    }
  },
  worker: { format: 'es' }
});
