// Holiday Learning Portal service worker.
// 1. Lets the portal be installed on a phone or computer like an app.
// 2. Keeps a copy of the app's screens, so it still opens when the internet is off
//    (notes and answers already saved on the phone are then shown). Live data always comes from the server.
// 3. Shows phone alerts and opens the site when one is tapped.

const SHELL_CACHE = 'portal-shell-v1';
const ASSET_CACHE = 'portal-assets-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.add('/'))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data is never cached

  // Pages: always try the internet first, so people get the newest version; fall back to the saved copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // App files have unique names that change with every update, so a saved copy is always correct.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(ASSET_CACHE)
                .then((c) => c.put(req, copy))
                .then(trimAssets);
            }
            return res;
          })
      )
    );
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Holiday Learning Portal', body: '', url: '/' };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch (e) {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
