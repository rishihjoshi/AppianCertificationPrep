// ── AppianCertPrep service worker (StrideVault pattern) ──────────────────────
const CACHE_NAME   = 'appiancertprep-v4';
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/AppIcon.png',
  './icons/AssociateExamHeroImage.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Network-first for Google Sheets CSV.
  // Fresh Request with credentials:'omit' prevents Google auth redirects on iOS Safari.
  if (url.hostname === 'docs.google.com') {
    e.respondWith(
      fetch(new Request(request.url, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store',
      }))
        .then(res => {
          // Cache by URL string — request.url is stable; put() failures are silenced for iOS opaque responses.
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(request.url, res.clone())).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request.url).catch(() => null);
          if (cached) return cached;
          // Header-only CSV → parseCSV yields 0 questions → app shows the retry UI.
          return new Response(
            'Sr. No.,Category,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer(s),Explanation\n',
            { status: 200, headers: { 'Content-Type': 'text/csv' } }
          );
        })
    );
    return;
  }

  // Cache-first for all static local assets
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(c => c.put(request.url, res.clone())).catch(() => {});
        }
        return res;
      });
    })
  );
});
