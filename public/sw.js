/* Stint CRM service worker. Caches only the app shell (code, fonts, icons).
   Never caches pages, API calls or /supabase/* data: those always go to the network. */
const VERSION = 'stint-v1';
const OFFLINE = '/offline';
const PRECACHE = [OFFLINE, '/icons/icon-192.png', '/brand/stint-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isStatic(url) {
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') return true;
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: network only (they can hold personal data). Offline -> the plain offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
    return;
  }

  // Static code, fonts, icons: cache first.
  if (isStatic(url)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
  // Everything else (/api, /supabase, data): not handled, straight to the network.
});
