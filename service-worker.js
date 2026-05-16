// ── AppianCertPrep service worker (StrideVault pattern) ──────────────────────
const CACHE_NAME   = 'appiancertprep-v3';
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

  // Network-first for Google Sheets CSV (so questions stay fresh)
  if (url.hostname === 'docs.google.com') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Return offline message as CSV-shaped response
          return new Response(
            'Sr. No.,Category,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer(s),Explanation\n' +
            '0,Offline,You are offline and no cached questions are available. Please reconnect and reload.,,,,,,,',
            { headers: { 'Content-Type': 'text/csv' } }
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
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
