/* HADİ — Web Elmas kampanyaları (istemci). Ayrıntı: uygulama deposu docs/odemeler.md › Web Elmas kampanyaları.
 *
 * 1) UYGULAMADAN GELİŞ (mağaza anti-steering): adres `?src=app` taşıyorsa ya da HADİ uygulamasının kendi WebView'ı
 *    ("HADIApp/" kullanıcı aracısı) ise `hadi_src=app` çerezi yazılır (yalnızca bayrak, 24 saat, her işaretli ziyarette
 *    yenilenir). Çerez varken bu oturumda hiçbir Elmas şeridi, kampanya bağlantısı, fiyat ya da satın al düğmesi
 *    gösterilmez; kampanya ve satın alma sayfası nötr metin gösterir. Aynı kural sunucuda: functions/[[path]].js.
 *    Instagram / WhatsApp / TikTok uygulama içi tarayıcıları uygulamadan geliş SAYILMAZ.
 * 2) Diğer ziyaretçiler: /api/elmas-kampanyalari (aynı alan adı; kimlik/çerez göndermez, kişisel veri dönmez) okunur;
 *    canlı kampanya varsa site sayfalarına şerit + altbilgi bağlantısı, kampanya sayfasına içerik, /hp/ paketlerine
 *    bonus rozeti eklenir. Kampanya yoksa ya da hizmet (web_elmas_campaigns) gizliyse hiçbir şey eklenmez.
 * Varsayılan kapalıdır: [data-elmas] öğeleri `hidden` gelir; betik çalışmazsa satın alma içeriği görünmez.
 */
(function () {
  "use strict";
  var COOKIE = "hadi_src";
  var MAX_AGE = 86400;
  var UA_RE = /\bHADIApp\/[\w.]+/;

  function hasAppCookie() {
    try { return /(?:^|;\s*)hadi_src=app(?:;|$)/.test(document.cookie || ""); } catch (e) { return false; }
  }
  var marked = false;
  try { marked = new URLSearchParams(location.search).get("src") === "app" || UA_RE.test(navigator.userAgent || ""); } catch (e) { /* eski tarayıcı */ }
  if (marked) {
    try { document.cookie = COOKIE + "=app; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) { /* çerez kapalı */ }
  }
  var app = marked || hasAppCookie();
  var root = document.documentElement;
  if (app) root.classList.add("hadi-app-src");
  var body = document.body;
  var page = (body && body.getAttribute("data-elmas-page")) || "";
  var isBuy = !!(body && body.getAttribute("data-page") === "buy");

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var nf = function (n) { return Number(n).toLocaleString("tr-TR"); };
  var tl = function (n) { return Number(n).toLocaleString("tr-TR", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " TL"; };
  var fmtDate = function (ms) {
    try { return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(ms)); } catch (e) { return new Date(ms).toLocaleString("tr-TR"); }
  };

  function neutral() {
    var m = $("main");
    if (!m) return;
    m.innerHTML = '<h1 style="font-size:1.4rem">Bu sayfa şu an görüntülenemiyor</h1><p><a class="ek-btn" href="/">Ana sayfaya dön</a></p>';
    m.removeAttribute("hidden");
  }

  if (app) {
    var gated = document.querySelectorAll("[data-elmas]");
    for (var i = 0; i < gated.length; i++) gated[i].parentNode.removeChild(gated[i]);
    if (page === "campaigns" || isBuy) neutral();
    return;
  }

  // Uygulamadan gelinmedi: sayfadaki sabit kampanya bağlantıları ([data-elmas-reveal]) görünür.
  var rv = document.querySelectorAll("[data-elmas-reveal][hidden]");
  for (var k = 0; k < rv.length; k++) rv[k].removeAttribute("hidden");

  // ------------------------------------------------------------------ kampanya verisi

  function loadCss() {
    if ($("link[data-elmas-css]")) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "/assets/css/elmas.css";
    l.setAttribute("data-elmas-css", "");
    document.head.appendChild(l);
  }

  var skew = 0; // sunucu saati − yerel saat
  var now = function () { return Date.now() + skew; };

  function leadOf(c) {
    if (c.kind === "volume") {
      var mx = 0;
      for (var i = 0; i < c.tiers.length; i++) mx = Math.max(mx, c.tiers[i].pct);
      return "%" + mx + "'e varan bonus Elmas";
    }
    if (c.kind === "first") return "İlk web alımına %" + c.pct + " bonus Elmas";
    return "Her pakete %" + c.pct + " bonus Elmas";
  }

  function left(ms) {
    var s = Math.max(0, Math.floor((ms - now()) / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, done: s <= 0 };
  }
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function shortLeft(ms) {
    var l = left(ms);
    if (l.done) return "sona erdi";
    return (l.d ? l.d + " gün " : "") + pad(l.h) + ":" + pad(l.m) + ":" + pad(l.s);
  }

  /** Geri sayımlar: [data-ek-end] (kısa) ve [data-ek-count] (kutulu). Saniyede bir. */
  function tick() {
    var a = document.querySelectorAll("[data-ek-end]");
    for (var i = 0; i < a.length; i++) a[i].textContent = shortLeft(Number(a[i].getAttribute("data-ek-end")));
    var b = document.querySelectorAll("[data-ek-count]");
    for (var j = 0; j < b.length; j++) {
      var l = left(Number(b[j].getAttribute("data-ek-count")));
      b[j].innerHTML = l.done ? "<span>Sona erdi</span>" :
        "<span>" + l.d + "<small>gün</small></span><span>" + pad(l.h) + "<small>saat</small></span><span>" + pad(l.m) + "<small>dakika</small></span><span>" + pad(l.s) + "<small>saniye</small></span>";
    }
  }

  function dismissed(id) { try { return sessionStorage.getItem("ek-x-" + id) === "1"; } catch (e) { return false; } }
  function dismiss(id) { try { sessionStorage.setItem("ek-x-" + id, "1"); } catch (e) { /* önemsiz */ } }

  function strip(c, href) {
    var el = document.createElement("aside");
    el.className = "ek-strip";
    el.setAttribute("aria-label", "Elmas kampanyası");
    el.setAttribute("data-elmas", "");
    var end = c.endAt ? (c.countdown ? ' · <span>bitimine <time data-ek-end="' + c.endAt + '"></time></span>' : " · " + esc(fmtDate(c.endAt)) + "'e kadar") : "";
    el.innerHTML = '<div class="ek-strip__in"><p class="ek-strip__txt" style="margin:0">' + (c.badge ? '<span class="ek-badge">' + esc(c.badge) + "</span>" : "") +
      "💎 " + esc(leadOf(c)) + end + "</p>" +
      (href ? '<a class="ek-btn" href="' + href + '">Kampanyaları gör</a>' : "") +
      '<button class="ek-x" type="button" aria-label="Şeridi kapat">×</button></div>';
    el.querySelector(".ek-x").onclick = function () { dismiss(c.id); el.parentNode && el.parentNode.removeChild(el); };
    return el;
  }

  function sitePage(d) {
    var live = d.campaigns.filter(function (c) { return c.live; });
    if (!live.length) return;
    var c = live[0];
    if (!dismissed(c.id)) {
      var hdr = $("header.site-header") || $("header");
      var s = strip(c, "/elmas-kampanyalari");
      if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(s, hdr.nextSibling);
      else if (document.body.firstChild) document.body.insertBefore(s, document.body.firstChild);
    }
    var ul = $(".site-footer .foot-grid ul");
    if (ul && !$("[data-ek-footlink]")) {
      var li = document.createElement("li");
      li.setAttribute("data-elmas", "");
      li.setAttribute("data-ek-footlink", "");
      li.innerHTML = '<a href="/elmas-kampanyalari">Elmas kampanyaları</a>';
      ul.appendChild(li);
    }
  }

  function campaignCard(c) {
    var when = c.live ? (c.endAt ? "Bitiş: " + esc(fmtDate(c.endAt)) : "Süresiz") : "Başlangıç: " + esc(fmtDate(c.startAt));
    var tiers = c.kind === "volume" ? '<ul class="ek-tiers">' + c.tiers.map(function (t) { return "<li><b>+%" + esc(t.pct) + "</b>" + esc(tl(t.minTl)) + " ve üzeri</li>"; }).join("") + "</ul>" : "";
    var cap = c.maxBonusElmas > 0 ? "<p>Tek alımda en çok " + nf(c.maxBonusElmas) + "💎 bonus.</p>" : "";
    return '<article class="ek-card">' + (c.badge ? '<span class="ek-badge">' + esc(c.badge) + "</span>" : "") +
      "<h3>" + esc(c.title) + "</h3>" + (c.subtitle ? "<p>" + esc(c.subtitle) + "</p>" : "") +
      "<p><b>" + esc(leadOf(c)) + "</b> · " + when + "</p>" + tiers + cap +
      (c.live && c.countdown && c.endAt ? '<div class="ek-count" role="timer" aria-label="Kalan süre" data-ek-count="' + c.endAt + '"></div>' : "") +
      "</article>";
  }

  function campaignsPage(d) {
    var box = $("#ek-content");
    if (!box) return;
    var list = d.on ? d.campaigns : [];
    var html = "";
    if (!list.length) {
      html = '<p class="ek-empty">Şu an süren bir Elmas kampanyası yok. Yeni kampanyalar bu sayfada duyurulur.</p>';
    } else {
      html = "<h2>Kampanyalar</h2>" + list.map(campaignCard).join("");
      var pk = (d.packages || []).filter(function (p) { return p.tl > 0; });
      if (pk.length) {
        html += "<h2>Web paketleri</h2><div class=\"ek-pkgs\">" + pk.map(function (p) {
          return '<div class="ek-pkg"><b>' + nf(p.elmas) + "💎</b>" + (p.bonus > 0 ? '<span class="ek-plus">+' + nf(p.bonus) + "💎 bonus</span>" : "") +
            "<span>" + esc(tl(p.tl)) + " · " + esc(p.label) + "</span></div>";
        }).join("") + "</div>";
        if (d.firstPct > 0) html += '<p class="ek-lead" style="margin-top:10px">İlk web satın alımında ayrıca %' + esc(d.firstPct) + " bonus (ödeme onaylanınca hesaplanır).</p>";
      }
      html += '<div class="ek-cta"><a class="ek-btn" href="/hp/">Elmas al</a><span class="ek-lead" style="margin:0">Bonus, ödeme onaylandığında Elmas\'la birlikte hesabına yüklenir.</span></div>';
    }
    box.innerHTML = html;
    var terms = $("#ek-terms");
    if (terms) terms.removeAttribute("hidden");
  }

  function buyPage(d) {
    var byKey = {};
    (d.packages || []).forEach(function (p) { byKey[p.channel + "|" + p.id] = p; });
    var live = d.campaigns.filter(function (c) { return c.live; });
    var shop = $("#shop");
    if (live.length && shop && !$(".ek-strip", shop)) {
      var s = strip(live[0], "/elmas-kampanyalari");
      s.style.borderRadius = "18px";
      s.style.margin = "0 0 12px";
      shop.insertBefore(s, shop.firstChild);
    }
    var decorate = function () {
      var btns = document.querySelectorAll("#channels .hp-pkg[data-ch][data-pkg]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if ($(".ek-pkg-bonus", b)) continue;
        var p = byKey[b.getAttribute("data-ch") + "|" + b.getAttribute("data-pkg")];
        if (!p || !(p.bonus > 0)) continue;
        var tag = document.createElement("span");
        tag.className = "ek-pkg-bonus";
        tag.setAttribute("data-elmas", "");
        tag.textContent = "+" + nf(p.bonus) + "💎 bonus";
        b.appendChild(tag);
      }
    };
    decorate();
    var ch = $("#channels");
    if (ch && window.MutationObserver) new MutationObserver(decorate).observe(ch, { childList: true, subtree: true });
  }

  var wantsData = page === "campaigns" || isBuy || !!$("header.site-header");
  if (!wantsData) return;
  // Çerez/kimlik gönderilmez (uygulamadan geliş zaten yukarıda yerel çerezle elendi).
  fetch("/api/elmas-kampanyalari", { credentials: "omit", headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : { on: false }; })
    .catch(function () { return { on: false }; })
    .then(function (d) {
      d = d || { on: false };
      if (typeof d.now === "number") skew = d.now - Date.now();
      d.campaigns = Array.isArray(d.campaigns) ? d.campaigns : [];
      if (page === "campaigns") {
        loadCss();
        campaignsPage(d);
      } else if (!d.on) {
        return;
      } else {
        loadCss();
        if (isBuy) buyPage(d);
        else sitePage(d);
      }
      tick();
      if (document.querySelector("[data-ek-end],[data-ek-count]")) setInterval(tick, 1000);
    });
})();
