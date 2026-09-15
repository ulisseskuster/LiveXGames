// LiveX Games Service Worker (PWA)
//
// Ao publicar frontend novo, suba este número junto. O precache abaixo guarda
// os caminhos SEM a query de versão, e o fallback de offline usa
// `ignoreSearch: true` — então uma cópia velha de /app.js continua atendendo
// pedidos de /app.js?v=<hash novo> quando a rede falha. Trocar o nome do cache
// é o que faz o 'activate' descartar a geração anterior.
const CACHE_NAME = 'livex-cache-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/arena-hud.css',
  '/app.js',
  '/sound.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Falha ao pré-carregar alguns assets estáticos:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Só intercepta GET da própria origem. Interceptar recurso de outra origem
  // (Google Fonts, imagens do Unsplash) ou de extensão do navegador
  // (chrome-extension:) reclassifica o pedido como fetch(), que passa a ser
  // barrado pelo connect-src da CSP — o <link>/<img> original seria liberado
  // por style-src/img-src. Sair sem respondWith deixa o navegador buscar direto.
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
    return;
  }

  // Não intercepta chamadas de API ou WebSockets
  if (requestUrl.pathname.startsWith('/api') || requestUrl.pathname.startsWith('/socket.io')) {
    return;
  }

  // Jogos (/games/): arquivos com hash no nome e cache imutável no servidor. O
  // cache HTTP do navegador já resolve; copiar megabytes de Three.js e .wasm para
  // o Cache Storage a cada versão só ocuparia espaço do aparelho.
  if (requestUrl.pathname.startsWith('/games/')) {
    return;
  }

  // Network First com fallback para cache para assets estáticos
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // caches.match resolve undefined quando não há cópia salva, e
        // respondWith(undefined) estoura "Failed to convert value to 'Response'".
        const cached = await caches.match(event.request, { ignoreSearch: true });
        return cached || Response.error();
      })
  );
});

// ── Notificações Push ──────────────────────────────────────────────────────
// Recebe push do servidor e exibe a notificação nativa do navegador.
// O payload vem no event.data (texto) ou usa um fallback genérico.
// Um `data.url` no push permite deep-linking ao clique.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const fallback = {
    titulo: 'LiveX Games',
    corpo: '',
    url: '/',
    icone: '/icons/icon-192.png'
  };

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    // Se não for JSON válido, trata como texto puro.
    payload = { ...fallback, corpo: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.titulo || fallback.titulo, {
      body: payload.corpo || fallback.corpo,
      icon: payload.icone || fallback.icone,
      badge: '/icons/icon-192.png',
      data: { url: payload.url || fallback.url },
      tag: 'livex-notification',
      renotify: true,
      vibrate: [100, 50, 100]
    })
  );
});

// Ao clicar na notificação: foca/abre a janela do LiveX e fecha a notificação.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Se já há uma janela aberta, foca nela; senão abre uma nova.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
