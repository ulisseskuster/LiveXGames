const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'frontend/public/js/vendor/**',
      // Saída do Vite (módulos ES minificados). A fonte é games/client, em TS.
      'frontend/public/games/**',
      'games/sim/target/**',
      '**/dist/**',
      '**/build/**',
      // Artefatos do Playwright (traces com JS de terceiros): lint local durante o e2e.
      'test-results/**',
      'artifacts/**',
      'scratch/**',
      'playwright-report/**',
      'temp_app.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },
  {
    // Testes Node/CommonJS que também recebem callbacks executados no
    // navegador via page.evaluate() (por isso precisam dos globals de browser).
    files: ['e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
        // Globais do app.js alcancaveis de dentro de page.evaluate(): o app e um
        // script classico, entao o `const state` do topo vive no escopo lexico
        // global da pagina e as function declarations viram propriedades dele.
        state: 'readonly',
        renderStreamerRewards: 'readonly',
        renderLivesIndicator: 'readonly',
        setArenaView: 'readonly',
        irParaSecao: 'readonly'
      }
    }
  },
  {
    files: ['backend/**/*.js', 'database/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn'
    }
  },
  {
    files: ['frontend/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URLSearchParams: 'readonly',
        Event: 'readonly',
        io: 'readonly',
        // Funções expostas via `window.x = function` em outro escopo do mesmo
        // arquivo (padrão usado para handlers chamados por atributos onclick=""
        // ou por closures registradas fora de sua função de definição).
        updateLiveRewardPreview: 'writable',
        handleApplicationModeration: 'writable',
        handleModerationAction: 'writable'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // O mural mora em arquivo próprio (app.js já passa de 240 KB), mas consome
    // o estado e os utilitários definidos no app.js — que é um script clássico,
    // então esses nomes são globais do escopo léxico da página. Declará-los aqui
    // documenta a dependência e mantém o no-undef valendo para o resto.
    files: ['frontend/public/js/donationWall.js'],
    languageOptions: {
      globals: {
        state: 'readonly',
        API_URL: 'readonly',
        escapeHtml: 'readonly',
        icon: 'readonly',
        showToast: 'readonly',
        setArenaView: 'readonly'
      }
    }
  },
  {
    files: ['frontend/public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker
      }
    }
  },
  eslintConfigPrettier
];
