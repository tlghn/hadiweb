// HADİ — Cloudflare Pages Function: uygulamadan dışarı paylaşılan bağlantıların sayfası.
//
// Hangi yollar buraya gelir? Kök klasördeki _routes.json belirler (yalnızca aşağıdakiler;
// sitenin geri kalanı statik olarak, Function çalışmadan sunulur):
//   /p/{id}  /yazi/{id}  /etkinlik/{id}  /anket/{id}  /grup/{id}  /kanal/{id}  /sonuc/{id}  /@{kullanici}  /uygulama  /ai/{id}  /davet/{token}  /d/{KOD}
//   /api/elmas-kampanyalari  /elmas-kampanyalari(.html)  /hp  /hp/  /hp/index.html   (Web Elmas kampanyaları, aşağıda)
//   /seffaflik  /seffaflik/   (Şeffaflık raporu; Firebase transparencyPage vekili)
//
// Sayfayı Firebase'deki sharePage fonksiyonu üretir (izin/gizlilik denetimi orada):
//   https://europe-west1-hadi-a0db3.cloudfunctions.net/sharePage?kind=…&id=…[&a=1]
// a=1: ziyaretçi Android'de → "Uygulamada aç" düğmesi intent:// bağlantısı olur.
// i=1: ziyaretçi iPhone/iPad'de → "Uygulamada aç" hadi:// şemasıyla açar (aynı alan adındaki sayfadan dokunulan
//      https bağlantısı iOS'ta Universal Link olarak açılmaz); "Uygulamayı indir" App Store'a gider.
// Universal Links doğrulaması: /.well-known/apple-app-site-association (statik dosya; bu Function'a gelmez).
// Yanıt Cloudflare'de 5 dk önbelleğe alınır (her yol + Android/diğer için ayrı).
//
// Not: _headers dosyasındaki başlıklar Function yanıtlarına uygulanmaz; güvenlik başlıkları burada eklenir.
//
// Web Elmas kampanyaları (21 Ekim 2026; app repo docs/odemeler.md › Web Elmas kampanyaları):
//   /api/elmas-kampanyalari   Firebase webElmasCampaigns vekili (aynı alan adı → sayfaların CSP connect-src 'self' yeter)
//   /elmas-kampanyalari       statik sayfa (elmas-kampanyalari.html); uygulamadan gelen oturumda nötr sayfa
//   /hp/                      Elmas satın alma sayfası; uygulamadan gelen oturumda nötr sayfa
//   paylaşım sayfaları        uygulamadan gelinmediyse ve canlı kampanya varsa sayfa altına kampanya şeridi eklenir
// UYGULAMADAN GELİŞ (mağaza anti-steering — Apple 3.1.1, Google Play Ödemeler politikası): uygulamanın açtığı her site
// bağlantısı `?src=app` taşır (lib/core/site_links.dart). Böyle bir ziyarette `hadi_src=app` çerezi (yalnızca bu bayrak;
// kimlik yok, 24 saat, her işaretli ziyarette yenilenir) yazılır ve o oturumda hiçbir Elmas satın alma şeridi, kampanya
// bağlantısı, fiyat ya da satın al düğmesi gösterilmez. Statik sayfalarda aynı kural assets/js/elmas.js'tedir.

const ORIGIN = "https://europe-west1-hadi-a0db3.cloudfunctions.net/sharePage";
const CAMPAIGNS_ORIGIN = "https://europe-west1-hadi-a0db3.cloudfunctions.net/webElmasCampaigns";
// Şeffaflık raporu (privacy_hub.ts › transparencyPage): /seffaflik[?period=YYYY-Hn] → Firebase sayfası (aynı alan adı).
const TRANSPARENCY_ORIGIN = "https://europe-west1-hadi-a0db3.cloudfunctions.net/transparencyPage";
const TRANSPARENCY_RE = /^\/seffaflik\/?$/;
const PERIOD_RE = /^[0-9A-Za-z_-]{1,10}$/;

/** /seffaflik vekili: yalnızca "period" parametresi geçer; Firebase'e ulaşılamazsa kısa bir hata sayfası. */
async function transparencyRoute(url) {
  const period = url.searchParams.get("period") || "";
  const target = TRANSPARENCY_ORIGIN + (PERIOD_RE.test(period) ? `?period=${encodeURIComponent(period)}` : "");
  try {
    const r = await fetch(target, { headers: { Accept: "text/html" }, cf: { cacheTtl: 600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    const h = secure(new Headers({ "Content-Type": r.headers.get("Content-Type") || "text/html; charset=utf-8", "Cache-Control": r.ok ? "public, max-age=600" : "no-store" }));
    return new Response(await r.text(), { status: r.status, headers: h });
  } catch {
    return new Response("Rapor şu an açılamadı.", { status: 503, headers: secure(new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })) });
  }
}

// ------------------------------------------------------------------ uygulamadan geliş (saf yardımcılar; tools/web_src_test.mjs)

export const APP_SRC_COOKIE = "hadi_src";
export const APP_SRC_MAX_AGE = 86400; // 24 saat
/**
 * Yalnızca HADİ uygulamasının KENDİ WebView imzası. Instagram / WhatsApp / TikTok / Facebook uygulama içi tarayıcıları
 * bilerek eşleşmez (oradan gelen ziyaretçi normal web ziyaretçisidir). Uygulama sitemizi kendi WebView'ında açarsa
 * kullanıcı aracısına "HADIApp/<sürüm>" eklemelidir; Özel Sekme / SFSafariViewController algılanamaz → `?src=app`.
 */
export const HADI_APP_UA_RE = /\bHADIApp\/[\w.]+/;

/** Cookie başlığını {ad: değer} nesnesine çevirir. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Ziyaret uygulamadan mı? { app, mark }
 *   mark: bu istek uygulama işaretli (?src=app ya da HADİ WebView) → çerez yazılır/yenilenir
 *   app:  işaretli ya da oturumda hadi_src=app çerezi var → Elmas satın alma içeriği gizlenir
 */
export function appSource(url, headers) {
  const u = typeof url === "string" ? new URL(url) : url;
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]) || "";
  const mark = u.searchParams.get("src") === "app" || HADI_APP_UA_RE.test(get("User-Agent"));
  const app = mark || parseCookies(get("Cookie"))[APP_SRC_COOKIE] === "app";
  return { app, mark };
}

/** Set-Cookie değeri: yalnızca bayrak; 24 saat; tüm site; JS de okur (statik sayfalar için HttpOnly değil). */
export const appSrcCookie = () => `${APP_SRC_COOKIE}=app; Max-Age=${APP_SRC_MAX_AGE}; Path=/; Secure; SameSite=Lax`;

/** Yanıta (gerekirse) çerezi ekler ve önbelleği kişiye özel yapar (aynı adres çerezli/çerezsiz farklı görünür). */
export function withAppSrc(res, src) {
  const r = new Response(res.body, res);
  if (src.mark) r.headers.append("Set-Cookie", appSrcCookie());
  r.headers.set("Vary", [r.headers.get("Vary"), "Cookie"].filter(Boolean).join(", "));
  const cc = r.headers.get("Cache-Control") || "";
  if (!/private|no-store/.test(cc)) r.headers.set("Cache-Control", "private, no-cache");
  return r;
}

const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtEnd = (ms) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(ms));

/**
 * Paylaşım sayfasına eklenecek kampanya şeridi (betiksiz: paylaşım sayfası CSP'si betiğe izin vermez; geri sayım yerine
 * bitiş zamanı yazılır). Canlı kampanya yoksa "".
 */
export function campaignStripHtml(data) {
  const live = (data && data.on && Array.isArray(data.campaigns) ? data.campaigns : []).filter((c) => c.live);
  if (!live.length) return "";
  const c = live[0];
  const pct = c.kind === "volume" ? Math.max(...c.tiers.map((t) => t.pct)) : c.pct;
  const lead = c.kind === "volume" ? `%${pct}'e varan bonus Elmas` : c.kind === "first" ? `İlk web alımına %${pct} bonus Elmas` : `%${pct} bonus Elmas`;
  const end = c.endAt ? ` · ${escHtml(fmtEnd(c.endAt))}'e kadar` : "";
  return `<aside class="hadi-ek" aria-label="Elmas kampanyası" style="max-width:560px;margin:16px auto 0;padding:14px 16px;border-radius:18px;background:#17344F;color:#fff;font:600 15px/1.4 system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;box-sizing:border-box;width:calc(100% - 32px)">` +
    `<span style="min-width:0;overflow-wrap:anywhere">${c.badge ? `<b style="background:#F6DD8A;color:#5b440d;border-radius:99px;padding:2px 8px;font-size:12px;margin-right:6px">${escHtml(c.badge)}</b>` : ""}💎 ${escHtml(lead)}${end}</span>` +
    `<a href="/elmas-kampanyalari" style="display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:#F2801F;color:#17344F;font-weight:800;text-decoration:none">Kampanyaları gör</a></aside>`;
}

/** Firebase kampanya özeti (60 sn kenar önbelleği). Hata/zaman aşımı → { on: false }. */
async function fetchCampaigns() {
  try {
    const r = await fetch(CAMPAIGNS_ORIGIN, { headers: { Accept: "application/json" }, cf: { cacheTtl: 60, cacheEverything: true }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { on: false };
    return await r.json();
  } catch {
    return { on: false };
  }
}

/** Uygulamadan gelen oturumda kampanya / satın alma sayfası yerine gösterilen nötr sayfa (fiyat, bağlantı, düğme yok). */
export function neutralPage() {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HADİ Etkinlik Kulübü</title><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><style>body{font-family:system-ui,sans-serif;background:#F2F6F9;color:#17344F;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center;box-sizing:border-box}a{display:inline-flex;align-items:center;min-height:44px;margin-top:8px;padding:0 22px;border-radius:999px;background:#17344F;color:#fff;text-decoration:none;font-weight:700}@media (prefers-color-scheme:dark){body{background:#0e1d2b;color:#eef3f7}a{background:#eef3f7;color:#0e1d2b}}</style></head><body><main><h1 style="font-size:1.4rem">Bu sayfa şu an görüntülenemiyor</h1><a href="/">Ana sayfaya dön</a></main></body></html>`;
  return new Response(html, { status: 200, headers: secure(new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" })) });
}

const CAMPAIGN_PAGE_RE = /^\/elmas-kampanyalari(\.html)?\/?$/;
const BUY_PAGE_RE = /^\/hp(\/|\/index\.html)?$/;

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return context.next();
  const url = new URL(request.url);
  const src = appSource(url, request.headers);
  if (url.pathname === "/api/elmas-kampanyalari") {
    // Uygulamadan gelen oturum: Firebase'e hiç sorulmaz, boş yanıt.
    const data = src.app ? { on: false, campaigns: [], packages: [] } : await fetchCampaigns();
    const res = new Response(request.method === "HEAD" ? null : JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=60", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" },
    });
    return withAppSrc(res, src);
  }
  if (TRANSPARENCY_RE.test(url.pathname)) return transparencyRoute(url);
  if (CAMPAIGN_PAGE_RE.test(url.pathname) || BUY_PAGE_RE.test(url.pathname)) {
    return withAppSrc(src.app ? neutralPage() : await context.next(), src);
  }
  const res = await shareRoute(context, url, src);
  return src.mark || src.app ? withAppSrc(res, src) : res;
}

// ------------------------------------------------------------------ paylaşım sayfaları

// d: kişisel davet bağlantısı (/d/{KOD}; invite_rewards.ts, share_page.ts kind "invite"; 20 Ekim 2026)
const KINDS = { p: "post", yazi: "text", etkinlik: "event", anket: "poll", grup: "group", kanal: "channel", sonuc: "result", d: "invite" };
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const USER_RE = /^[A-Za-z0-9._]{3,30}$/;

const CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Yolu {kind, id}'ye çevirir; tanınmazsa null. */
function parse(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  path = path.replace(/\/+$/, "") || "/";
  if (path === "/uygulama") return { kind: "app", id: "" };
  const at = /^\/@([^/]+)$/.exec(path);
  if (at) return USER_RE.test(at[1]) ? { kind: "profile", id: at[1].toLowerCase() } : null;
  const m = /^\/([a-z]+)\/([^/]+)$/.exec(path);
  if (m && KINDS[m[1]] && ID_RE.test(m[2])) return { kind: KINDS[m[1]], id: m[2] };
  return null;
}

function secure(headers) {
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return headers;
}

function fallback(target, ios = false) {
  // Firebase'e ulaşılamazsa: kısa bir yönlendirme sayfası (önbelleğe alınmaz).
  // iPhone: hadi:///yol (uygulamanın kendi şeması); App Store bağlantısı burada bilinmediği için indirme düğmesi gösterilmez.
  const path = target.replace(/^https:\/\/hadietkinlikkulubu\.com/, "") || "/";
  const open = ios ? `hadi://${path}` : target;
  const dl = ios ? "" : `<a href="https://play.google.com/store/apps/details?id=com.hadietkinlikkulubu.app">Uygulamayı indir</a>`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HADİ Etkinlik Kulübü</title><meta name="robots" content="noindex"><meta property="og:title" content="Bu içerik HADİ'de"><meta property="og:image" content="https://hadietkinlikkulubu.com/assets/img/og-hadi.jpg"><style>body{font-family:system-ui,sans-serif;background:#F2F6F9;color:#17344F;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}a{display:inline-block;margin:6px;padding:14px 22px;border-radius:999px;background:#17344F;color:#fff;text-decoration:none;font-weight:700}a+a{background:#fff;color:#17344F;border:2px solid #17344F}</style></head><body><main><h1>Bu içerik HADİ'de</h1><p>Görmek için uygulamayı aç.</p><a href="${open}">Uygulamada aç</a>${dl}</main></body></html>`;
  return new Response(html, { status: 200, headers: secure(new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })) });
}

async function shareRoute(context, url, src) {
  const { request } = context;
  // AI video (/ai/{id}): içerik yalnızca uygulamada, üyelere açılır; web'de yalnızca "Uygulamada aç" sayfası.
  const ua = request.headers.get("User-Agent") || "";
  const ios = !/Android/i.test(ua) && /iPhone|iPad|iPod/i.test(ua);
  if (/^\/ai\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname)) return fallback(`https://hadietkinlikkulubu.com${url.pathname}`, ios);
  // Grup davet bağlantısı (/davet/{token}): grup bilgisi web'de gösterilmez; yalnızca "Uygulamada aç".
  if (/^\/davet\/[A-Za-z0-9_-]{8,80}\/?$/.test(url.pathname)) return fallback(`https://hadietkinlikkulubu.com${url.pathname}`, ios);
  const r = parse(url.pathname);
  if (!r) return context.next(); // statik dosya / 404.html

  const android = /Android/i.test(ua);
  const up = new URL(ORIGIN);
  up.searchParams.set("kind", r.kind);
  if (r.id) up.searchParams.set("id", r.id);
  if (android) up.searchParams.set("a", "1");
  else if (ios) up.searchParams.set("i", "1");

  try {
    // Kampanya şeridi yalnızca uygulamadan GELİNMEYEN ziyarette ve davet sayfası dışında (paralel, 60 sn önbellekli).
    const wantStrip = !src.app && r.kind !== "invite" && request.method !== "HEAD";
    const [res, camp] = await Promise.all([
      fetch(up.toString(), {
        method: "GET",
        headers: { Accept: "text/html" },
        cf: { cacheTtl: 300, cacheEverything: true },
      }),
      wantStrip ? fetchCampaigns() : Promise.resolve(null),
    ]);
    if (!res.ok) return fallback(`https://hadietkinlikkulubu.com${url.pathname}`, ios);
    const strip = camp ? campaignStripHtml(camp) : "";
    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    // Şeritli yanıt kişiye özel (aynı adres uygulamadan gelen oturumda şeritsiz görünmeli).
    headers.set("Cache-Control", strip ? "private, no-cache" : res.headers.get("Cache-Control") || "public, max-age=60, s-maxage=300");
    const robots = res.headers.get("X-Robots-Tag");
    if (robots) headers.set("X-Robots-Tag", robots);
    headers.set("Vary", "Accept-Encoding, User-Agent, Cookie"); // Android: intent:// · iPhone: hadi:// düğmesi · hadi_src
    secure(headers);
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    let body = res.body;
    if (strip && typeof HTMLRewriter !== "undefined") {
      let done = false;
      body = new HTMLRewriter()
        .on("main", { element(e) { if (!done) { done = true; e.after(strip, { html: true }); } } })
        .transform(new Response(res.body)).body;
    }
    return new Response(body, { status: 200, headers });
  } catch {
    return fallback(`https://hadietkinlikkulubu.com${url.pathname}`, ios);
  }
}
