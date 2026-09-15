const { defineConfig } = require('@playwright/test');

// Dois projetos:
// - core: testes funcionais de DOM/API.
// - visual: testes que montam cena 3D (WebGL/WebGPU), mais lentos no CI.
// `npm run test:e2e` roda ambos, localmente e no CI; --project permite filtrar.
const VISUAL_SPECS = [
  'e2e/visualArena.spec.js',
  'e2e/hudShop.spec.js',
  'e2e/channelEconomy.spec.js',
  'e2e/jetLauncher.spec.js',
  'e2e/neonDrifter.spec.js',
  'e2e/voidWalker.spec.js'
];

module.exports = defineConfig({
  testDir: './e2e',
  timeout: process.env.CI ? 90000 : 30000,
  fullyParallel: false,
  workers: 1,
  // O workflow publica playwright-report/ em caso de falha.
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'core',
      testIgnore: VISUAL_SPECS
    },
    {
      name: 'visual',
      testMatch: VISUAL_SPECS,
      // Os testes 3D já têm test.setTimeout próprio ampliado no CI; aqui o
      // timeout global do projeto visual é maior para nunca amputar a montagem.
      timeout: process.env.CI ? 360000 : 120000
    }
  ],
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node src/server.js',
    cwd: './backend',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    // Força o modo mock/simulação da Twitch e da Kick independentemente do
    // .env local do desenvolvedor: os testes de OAuth (ver smoke.spec.js)
    // dependem do round-trip mock determinístico, não de credenciais reais.
    // dotenv.config() não sobrescreve variáveis já presentes no ambiente, então
    // strings vazias aqui bloqueiam os valores do .env sem precisar editá-lo.
    env: {
      // O limitador de autenticacao permite 20 chamadas por IP a cada 10 min
      // (server.js, authRateLimiter) e so se desliga com NODE_ENV=test — a
      // valvula que o proprio createRateLimiter ja previa, mas que a suite
      // nunca usou. Cada teste que chama registerNewUser gasta uma dessas 20,
      // entao a suite vinha raspando o teto: passar de ~20 testes com cadastro
      // fazia os ultimos specs falharem no 429, e o erro aparecia longe da
      // causa (o cadastro falha, e a asserção seguinte e que estoura).
      NODE_ENV: 'test',
      // No CI vale o Postgres do workflow; fora dele, memória (nunca o .env local).
      DATABASE_URL: process.env.CI ? process.env.DATABASE_URL || '' : '',
      ADMIN_PASSWORD: 'Local-E2E-Only-2026!',
      ADMIN_USERNAME: 'admin_livex',
      TWITCH_CLIENT_SECRET: '',
      KICK_CLIENT_ID: '',
      KICK_CLIENT_SECRET: ''
    }
  }
});
