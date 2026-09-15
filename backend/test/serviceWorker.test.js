// Garante que o service worker do frontend só intercepta GET da própria origem.
// Interceptar outra origem transforma <link>/<img> em fetch(), que a CSP barra
// por connect-src, e requests chrome-extension: estouram no cache.put.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const swPath = path.join(__dirname, '../../frontend/public/sw.js');

function carregarHandlerDeFetch() {
  const listeners = {};
  const self = {
    location: { origin: 'https://livex.app' },
    addEventListener: (tipo, fn) => {
      listeners[tipo] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: () => {} }
  };
  const contexto = {
    self,
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      match: async () => undefined
    },
    fetch: async () => ({ status: 200, type: 'basic', clone: () => ({}) }),
    URL,
    Response,
    console,
    Promise
  };
  vm.runInNewContext(fs.readFileSync(swPath, 'utf8'), contexto);
  return listeners.fetch;
}

function interceptou(url, method = 'GET') {
  const onFetch = carregarHandlerDeFetch();
  let chamou = false;
  onFetch({
    request: { url, method },
    respondWith: () => {
      chamou = true;
    }
  });
  return chamou;
}

test('intercepta assets estáticos da própria origem', () => {
  assert.equal(interceptou('https://livex.app/styles.css?v=1'), true);
  assert.equal(interceptou('https://livex.app/'), true);
});

test('não intercepta recursos de outra origem', () => {
  assert.equal(interceptou('https://fonts.googleapis.com/css2?family=Orbitron'), false);
  assert.equal(interceptou('https://images.unsplash.com/photo-123?w=500'), false);
});

test('não intercepta requests de extensão do navegador', () => {
  assert.equal(interceptou('chrome-extension://abc/content-script.js'), false);
});

test('não intercepta API, socket.io nem métodos além de GET', () => {
  assert.equal(interceptou('https://livex.app/api/me'), false);
  assert.equal(interceptou('https://livex.app/socket.io/socket.io.js'), false);
  assert.equal(interceptou('https://livex.app/styles.css', 'POST'), false);
});
