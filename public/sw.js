// 福州麻将 · Service Worker (PWA 离线 + 添加到主屏幕)
const CACHE_VERSION = 'fz-mahjong-v24-1119';
const CORE = ['/', '/index.html', '/game.js', '/style.css', '/manifest.json', '/voice/voice.mp3'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // 只处理 GET (WS 不受影响)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;  // 仅同源

  // 页面导航: 网络优先, 失败回退缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // 静态资源: 缓存优先, 后台更新 (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
