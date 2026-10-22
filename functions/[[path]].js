// HADİ Web (hadisosyal.com) — Cloudflare Pages Function. Yalnızca web/_routes.json'daki yollarda çalışır; geri kalan her şey
// statik (uygulama, yasal sayfalar, /hp/ dosyaları) ve Function çağrısı harcamaz (ücretsiz plan: günde 100.000).
//
// Paylaşım bağlantıları (/p/…, /etkinlik/…, /@kullanici, /d/KOD, /uygulama …):
//   • Kişi (tarayıcı)          → HADİ Web açılır ve içeriği kendi ekranında gösterir (uygulamadaki aynı yol).
//   • Bağlantı önizleme botu   → kulüp sitesinin paylaşım sayfası (başlık, açıklama, görsel; Firebase sharePage).
//     (WhatsApp, Telegram, X, Facebook, LinkedIn, Slack, Discord, iMessage, arama motorları …)
// /hp, /elmas-kampanyalari, /api/elmas-kampanyalari, /seffaflik → kulüp sitesindeki Function'ın aynısı (uygulamadan gelişte
// nötr sayfa kuralı dahil).
//
// ../site_functions/share.js, kulüp sitesinin functions/[[path]].js dosyasının birebir kopyasıdır (tools/sync_site.ps1;
// site değiştirilmez). Değişiklik sitede yapılır; HADİ Web yeniden derlenince buraya gelir.
import { onRequest as siteRequest } from "../site_functions/share.js";

const SHARE_RE = /^\/(?:(?:p|yazi|etkinlik|anket|grup|kanal|sonuc|d|ai|davet)\/[^/]+|@[^/]+|uygulama)\/?$/;

// Bağlantı önizleme ve arama botları. Kişi tarayıcıları (Instagram/Facebook uygulama içi tarayıcıları dahil) eşleşmez.
const BOT_RE =
  /bot\b|crawler|spider|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|pinterest|redditbot|skypeuripreview|applebot|embedly|vkshare|quora link preview|bitlybot|google-inspectiontool|googleother|yandex|bingpreview/i;

// Function yanıtlarına _headers uygulanmaz: uygulama sayfası için aynı başlıklar burada (web/_headers › /* ile aynı tut).
const APP_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.gstatic.com https://www.google.com https://apis.google.com https://www.recaptcha.net https://www.googletagmanager.com https://unpkg.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https: wss: blob: data:; frame-src 'self' https:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https:",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self), payment=(self), usb=(), interest-cohort=()",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cache-Control": "no-cache",
  Vary: "User-Agent",
};

/** Bağlantı önizleme botu mu? */
export function isPreviewBot(ua) {
  return BOT_RE.test(ua || "");
}

/** Paylaşım bağlantısı mı? */
export function isSharePath(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    /* olduğu gibi */
  }
  return SHARE_RE.test(p);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const read = request.method === "GET" || request.method === "HEAD";
  if (read && isSharePath(url.pathname) && !isPreviewBot(request.headers.get("User-Agent"))) {
    // Uygulamanın kendisi (index.html); adres çubuğunda yol kalır, uygulama o içeriği açar.
    const res = await env.ASSETS.fetch(new Request(new URL("/", url), request));
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(APP_HEADERS)) headers.set(k, v);
    return new Response(request.method === "HEAD" ? null : res.body, { status: 200, headers });
  }
  return siteRequest(context);
}
