// HADİ Film v3 — oynatıcı kabuğu köprüsü (25 Ekim 2026). Denetimler Flutter'dadır (hadi › film_chrome.dart); bu sayfa
// dokunuş ALMAZ (web: iframe pointer-events:none, uygulama: webview IgnorePointer). Bu dosya player.js'e dokunmadan:
//   chrome {top, bottom, scale}: Flutter denetimleri görünürken kapladıkları üst/alt yükseklik (CSS px). Altyazı alt çubuğun,
//     "Sesi açmak için dokun" çipi üst çubuğun dışına itilir; künye alt çubuğun üstünde açılır. scale: üyenin yazı ölçeği
//     (altyazı onunla büyür, en çok 1,6×).
//   credits: künyeyi aç/kapat (oynatıcının kendi "i" düğmesi gizlenir; Flutter'da Ayarlar › Künye).
//   unlock: ses bağlamını açar (üye Flutter katmanına dokundu). Web'de aynı kökenli çağrı dokunuşun içinde gelir:
//     window.HadiFilm3Chrome.unlock().
// Çıkış: chromeInfo {credits: n} (film hazır olunca; n > 0 ise Flutter "Künye"yi gösterir).
// Komutlar uygulamada HadiFilm3.cmd(...) ile, web'de postMessage ile gelir; ikisi de burada süzülür, geri kalanı oynatıcıya gider.

const $ = (id) => document.getElementById(id);
const css = document.createElement('style');
css.textContent = `
  #infoBtn, #infoBtn.on { display: none !important; }
  #subs { transition: opacity .18s ease, transform .22s cubic-bezier(.2,.8,.2,1); }
  #subs .txt { font-size: calc(clamp(15px, 2.4vw, 22px) * var(--hadi-scale, 1)); }
  #subs .who { font-size: calc(12px * var(--hadi-scale, 1)); }
  #chip { transition: top .22s cubic-bezier(.2,.8,.2,1); }
  #credits { transition: bottom .22s cubic-bezier(.2,.8,.2,1); }
`;
document.head.appendChild(css);

let inset = { top: 0, bottom: 0 };

function post(type, data = {}) {
  const msg = { source: 'hadi-film3', type, ...data };
  try { if (window.HadiBridge && window.HadiBridge.postMessage) window.HadiBridge.postMessage(JSON.stringify(msg)); } catch (_) {}
  try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (_) {}
}

function player() { return window.HadiFilm3 && window.HadiFilm3.player; }

/// Altyazının alt kenarı Flutter alt çubuğunun üstünde kalsın (player.js altyazıyı alt banda yerleştirir; burada yalnızca kaydırılır).
function place() {
  const subs = $('subs'), chip = $('chip'), credits = $('credits');
  if (subs) {
    const b = parseFloat(subs.style.bottom || getComputedStyle(subs).bottom) || 0;
    const up = inset.bottom > 0 ? Math.max(0, inset.bottom + 10 - b) : 0;
    subs.style.transform = up ? `translateY(${-up}px)` : '';
  }
  if (chip) chip.style.top = (14 + inset.top) + 'px';
  if (credits) credits.style.bottom = (12 + inset.bottom) + 'px';
}

function unlock() {
  const p = player();
  if (!p || !p.audio || !p.audio.unlock) return;
  try { p.audio.unlock().then(() => { try { p._chip(); } catch (_) {} }); } catch (_) {}
}

function handle(m) {
  if (!m || typeof m !== 'object') return false;
  switch (m.type) {
    case 'chrome':
      inset = { top: Math.max(0, +m.top || 0), bottom: Math.max(0, +m.bottom || 0) };
      document.documentElement.style.setProperty('--hadi-scale', String(Math.min(1.6, Math.max(1, +m.scale || 1))));
      place();
      return true;
    case 'credits': {
      const p = player(), el = $('credits');
      if (p && el && p._showCredits) p._showCredits(m.on === undefined ? !el.classList.contains('on') : !!m.on);
      return true;
    }
    case 'unlock':
      unlock();
      return true;
    default:
      return false;
  }
}

function parse(m) {
  if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return null; } }
  return m;
}

// Uygulama yolu: HadiFilm3.cmd sarılır (bizim komutlar oynatıcıya gitmez; diğerleri olduğu gibi geçer).
if (window.HadiFilm3 && typeof window.HadiFilm3.cmd === 'function') {
  const orig = window.HadiFilm3.cmd;
  window.HadiFilm3.cmd = (m) => { const x = parse(m); if (!handle(x)) orig(m); };
}
// Web yolu: player.js de aynı iletiyi alır, tanımadığı türleri yok sayar.
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = parse(e.data);
  if (m && m.source !== 'hadi-film3') handle(m);
});
window.addEventListener('resize', () => requestAnimationFrame(place));
// Film hazır: künye var mı? (player.js çıkışları ayrıca 'film3' olayıyla da yayınlanır.)
window.addEventListener('film3', (e) => {
  const d = e.detail || {};
  if (d.type === 'ready') {
    requestAnimationFrame(place);
    const p = player();
    post('chromeInfo', { credits: p && Array.isArray(p.credits) ? p.credits.length : 0 });
  }
});

window.HadiFilm3Chrome = { unlock, place };
