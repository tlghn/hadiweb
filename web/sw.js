// HADİ Web service worker: ana ekrana eklenen uygulamanın çevrimdışı açılışında boş ekran yerine
// "bağlantı yok" sayfası gösterir. Uygulama dosyalarını ve üye verisini ÖNBELLEĞE ALMAZ; her istek ağa gider.
const CACHE = 'hadi-offline-v2';
const OFFLINE = ['offline.html', 'splash.webp', 'icons/Icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Kitap filmi (film3) varlıkları kendi sürümlü önbelleğindedir (film3/player/assets.js): silinmez, yoksa her güncellemede
    // film dünyası (~15 MB) yeniden iner.
    for (const k of await caches.keys()) if (k !== CACHE && !k.startsWith('hadi-film3-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(async () => (await caches.match('offline.html')) || Response.error()));
    return;
  }
  // Çevrimdışı sayfanın kendi görselleri (yalnızca ağ yoksa önbellekten); diğer her şey tarayıcının olağan yolundan.
  const path = new URL(e.request.url).pathname;
  if (OFFLINE.some((f) => path.endsWith('/' + f))) {
    e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || Response.error()));
  }
});
