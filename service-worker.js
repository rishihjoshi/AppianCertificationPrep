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

  // Network-first for Google Sheets CSV (so questions stay fresh).
  // Use a fresh Request with credentials:'omit' so Google's auth redirect
  // doesn't loop, and iOS Safari doesn't block it as a CORS credentials issue.
  if (url.hostname === 'docs.google.com') {
    const freshReq = new Request(request.url, {
      method:      'GET',
      mode:        'cors',
      credentials: 'omit',
      redirect:    'follow',
      cache:       'no-store',
    });
    e.respondWith(
      fetch(freshReq)
        .then(res => {
          if (res.ok) {
            // Cache under the original request URL so match() finds it later.
            // Silence put() errors (e.g. opaque/redirect response on some iOS builds).
            caches.open(CACHE_NAME)
              .then(c => c.put(request.url, res.clone()))
              .catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request.url).catch(() => null);
          if (cached) return cached;
          // Offline fallback: return header row only so parseCSV yields 0 questions
          // (the app will show the retry UI rather than a phantom offline question).
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
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
