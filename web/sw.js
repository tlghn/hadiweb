// HADİ Web service worker.
// 1) Çevrimdışı açılışta boş ekran yerine "bağlantı yok" sayfası.
// 2) Uygulama varlıkları (ikonlar, yazı tipleri, görseller, oyun dosyaları) tarayıcıya BİR KEZ
//    iner (kurucu kuralı, 3 Kasım 2026): derleme her dosyanın içerik parmak izini asset_hashes.json'a yazar
//    (tools/build.ps1). Dosya, parmak iziyle birlikte Cache Storage'da tutulur; sonraki açılışlarda ağa hiç sorulmadan
//    oradan verilir. İçeriği değişen dosyanın parmak izi değişir ve yalnızca o dosya yeniden iner; eskisi silinir.
//    Sayfa (index.html), sürüm etiketi, uygulama kodu (main.dart.js, canvaskit: sürüm etiketli, yeni sürümle uyumsuz eski
//    kopya kullanılmasın) ve üye verisi önbelleğe ALINMAZ. Yayından sonraki ilk açılış eski çalışanla olabilir: içeriği
//    değişmiş bir varlık o açılışta eski hâliyle görünebilir, sonraki açılışta yenisi gelir.
const BUILD = '__HADI_BUILD__'; // tools/build.ps1 yazar: her derlemede bu dosya değişir, tarayıcı yeni çalışanı kurar
const CACHE = 'hadi-offline-v2';
const ASSETS = 'hadi-assets-v1';
// Uygulama kodu (main.dart.wasm/.mjs/.js): her zaman ?v=<sürüm> ile istenir; o adresin içeriği hiç değişmez. Tam adresle
// (sürüm dahil) saklanır, aynı dosyanın eski sürümü silinir. (3 Kasım 2026: 6,5 MB'lık main.dart.wasm bazı tarayıcıların HTTP
// önbelleğine sığmayıp her açılışta yeniden iniyordu.)
const CODE = 'hadi-code-v1';
const CODE_RE = /^main\.dart\.(wasm|mjs|js)$/;
const OFFLINE = ['offline.html', 'splash.webp', 'icons/Icon-192.png'];
const MANIFEST = 'asset_hashes.json?b=' + BUILD;
// Parmak iziyle saklanan dosyaların yolları (tools/build.ps1 › asset_hashes.json ile aynı kapsam).
const STATIC = /^(assets\/|icons\/|favicon\.png$|splash\.webp$)/;

let manifestP = null;
// Bu derlemenin parmak izi listesi ({ "assets/fonts/MaterialIcons-Regular.otf": "9f…", … }); bir kez indirilir.
function manifest() {
  if (!manifestP) {
    manifestP = (async () => {
      const c = await caches.open(ASSETS);
      let r = await c.match(MANIFEST);
      if (!r) {
        r = await fetch(MANIFEST, { cache: 'no-store' });
        if (!r.ok) throw new Error('manifest ' + r.status);
        await c.put(MANIFEST, r.clone());
      }
      return await r.json();
    })().catch(() => { manifestP = null; return null; });
  }
  return manifestP;
}

const base = () => self.registration.scope; // https://hadisosyal.com/

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await caches.open(CACHE).then((c) => c.addAll(OFFLINE)).catch(() => {});
    await manifest();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Kitap filmi (film3) varlıkları kendi sürümlü önbelleğindedir (film3/player/assets.js): silinmez, yoksa her güncellemede
    // film dünyası (~15 MB) yeniden iner.
    for (const k of await caches.keys()) if (k !== CACHE && k !== ASSETS && k !== CODE && !k.startsWith('hadi-film3-')) await caches.delete(k);
    // Bu derlemede artık olmayan ya da içeriği değişmiş dosyaların eski kopyaları ve eski parmak izi listeleri silinir.
    const m = await manifest();
    if (m) {
      const c = await caches.open(ASSETS);
      for (const req of await c.keys()) {
        const u = new URL(req.url);
        const path = u.pathname.slice(new URL(base()).pathname.length);
        const keep = path === 'asset_hashes.json' ? u.searchParams.get('b') === BUILD : m[decodeURIComponent(path)] === u.searchParams.get('h');
        if (!keep) await c.delete(req);
      }
    }
    await self.clients.claim();
  })());
});

async function fromAssets(req, path, hash) {
  const c = await caches.open(ASSETS);
  const key = base() + encodeURI(path) + '?h=' + hash;
  const hit = await c.match(key);
  if (hit) return hit;
  // İlk kez: tarayıcının HTTP önbelleği doğrulanarak indirilir (eski bir kopya yeni parmak iziyle saklanmasın).
  const res = await fetch(new Request(req, { cache: 'no-cache' }));
  if (res.status === 200 && res.type === 'basic') c.put(key, res.clone()).catch(() => {});
  return res;
}

// Yanıt hemen döner (WebAssembly indirilirken derlenmeye başlar); kopyası arka planda saklanır.
async function fromCode(e, req) {
  let c;
  try {
    c = await caches.open(CODE);
    const hit = await c.match(req.url);
    if (hit) return hit;
  } catch (_) {}
  const res = await fetch(req);
  if (c && res.status === 200 && res.type === 'basic') {
    e.waitUntil((async () => {
      await c.put(req.url, res.clone());
      // Aynı dosyanın başka sürümleri silinir (yalnızca son indirilen kalır).
      const p = new URL(req.url).pathname;
      for (const k of await c.keys()) if (new URL(k.url).pathname === p && k.url !== req.url) await c.delete(k);
    })().catch(() => {}));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match('offline.html')) || Response.error()));
    return;
  }
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (!req.url.startsWith(base())) return;
  let path;
  try {
    path = decodeURIComponent(u.pathname.slice(new URL(base()).pathname.length));
  } catch (_) {
    return;
  }
  if (CODE_RE.test(path) && u.searchParams.get('v')) {
    e.respondWith(fromCode(e, req));
    return;
  }
  // Yalnızca uygulama dosyaları bu çalışandan geçer; sayfa, API, sürüm etiketi ve diğer her şey tarayıcının olağan yolundan.
  if (!STATIC.test(path)) return;
  e.respondWith((async () => {
    const m = await manifest();
    const hash = m && m[path];
    if (hash) {
      try {
        return await fromAssets(req, path, hash);
      } catch (_) {}
    }
    // Çevrimdışı sayfanın kendi görselleri (yalnızca ağ yoksa önbellekten).
    if (OFFLINE.includes(path)) return fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || Response.error());
    return fetch(req);
  })());
});
