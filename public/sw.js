// Service worker : l'application s'ouvre même si le serveur de l'officine est éteint.
const V = 'lgo-v3'
const COQUE = ['/', '/index.html', '/css/app.css', '/js/core.js', '/js/comptoir.js', '/js/gestion.js', '/js/achats.js', '/js/clients.js', '/js/pilotage.js', '/manifest.webmanifest', '/icon.svg']
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(COQUE)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return
  e.respondWith(fetch(e.request).then((r) => { const copie = r.clone(); caches.open(V).then((c) => c.put(e.request, copie)); return r }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))))
})
