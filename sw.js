/**
 * sw.js — Service Worker для Jarvis Glasses Assistant PWA (v5).
 * Стратегія: Network-First для актуальності оновлень коду та звукових шлюзів,
 * Cache Fallback для надійної роботи при нестабільному зв'язку на прогулянках.
 */

const CACHE_NAME    = 'jarvis-v6';
const SHELL_ASSETS  = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/audio.js',
  './js/speech.js',
  './js/gestures.js',
  './js/vad.js',
  './js/ui.js',
  './js/state.js',
  './js/tools.js',
];

// ── Install: кешуємо shell ────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: видаляємо старі кеші ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: Network First для файлів додатку ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // WebSocket та API запити — завжди тільки через мережу
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api')) {
    return;
  }

  // Network First з оновленням кешу
  event.respondWith(
    fetch(request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Якщо офлайн — беремо з кешу
        return caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
