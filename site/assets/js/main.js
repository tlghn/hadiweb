/* ==========================================================================
   HADİ Etkinlik Kulübü — etkileşim katmanı
   Kütüphane kullanılmaz; tüm sayfalarda tek dosya çalışır.
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Etkinlik verisi ----------------
     Takvimi güncellemek için yalnızca bu listeyi düzenleyin. */
  var CATS = {
    kultur:  { ad: "Kültür & Gezi",     renk: "var(--h)" },
    sanat:   { ad: "Sanat",             renk: "var(--i)" },
    doga:    { ad: "Doğa",              renk: "var(--d)" },
    spor:    { ad: "Spor & Hareket",    renk: "var(--a)" },
    atolye:  { ad: "Atölye",            renk: "var(--pink)" },
    soylesi: { ad: "Söyleşi & Buluşma", renk: "var(--ink)" }
  };

  var EVENTS = [
    { id: "e1", t: "Tarihi Yarımada’da Kültür Yürüyüşü", c: "kultur", d: "2026-10-18T10:00", sure: "4 saat", yer: "Sultanahmet, İstanbul", kap: 20, dolu: 14, ucret: "350 ₺", seviye: "Kolay tempo",
      acik: "Rehberimiz eşliğinde Hipodrom’dan Sokullu Mehmet Paşa Camii’ne uzanan, bilinen ve az bilinen durakları birleştiren bir rota. Yürüyüş, mahalle aralarında bir çay molasıyla biter." },
    { id: "e2", t: "Belgrad Ormanı Sonbahar Rotası", c: "doga", d: "2026-10-24T09:30", sure: "3,5 saat", yer: "Neşet Suyu girişi, Sarıyer", kap: 18, dolu: 9, ucret: "200 ₺", seviye: "Orta tempo · 8 km",
      acik: "Yaprak dökümünün en güzel haftasında, orman içi patikalarda keyifli bir yürüyüş. Grup en yavaş katılımcının temposunda ilerler; kimse geride kalmaz." },
    { id: "e3", t: "Seramik & Çömlek Atölyesi", c: "atolye", d: "2026-10-31T14:00", sure: "3 saat", yer: "Kadıköy’de partner atölye", kap: 12, dolu: 11, ucret: "950 ₺", seviye: "Başlangıç",
      acik: "Çamura ilk kez dokunanlar için tasarlandı. Kendi kupanızı şekillendiriyor, sırlıyorsunuz; fırınlanan eseriniz iki hafta sonra teslim ediliyor. Malzeme ücrete dahildir." },
    { id: "e4", t: "Söyleşi: Şehirde Yavaş Yaşamak", c: "soylesi", d: "2026-11-07T19:00", sure: "2 saat", yer: "Moda, Kadıköy", kap: 30, dolu: 12, ucret: "Ücretsiz", seviye: "Herkese açık",
      acik: "Kalabalık şehirde ritmi yavaşlatmanın yollarını konuşuyoruz. Kısa bir sunumun ardından sohbet çemberi: herkes söz alabilir, kimse zorunda değil." },
    { id: "e5", t: "Sahil Koşusu & Pazar Kahvaltısı", c: "spor", d: "2026-11-08T08:30", sure: "3 saat", yer: "Caddebostan Sahili", kap: 25, dolu: 8, ucret: "300 ₺", seviye: "5 km · her seviye",
      acik: "Koşmak da yürümek de serbest; iki ayrı tempo grubu oluşturuyoruz. Sonrasında sahildeki kahvaltı noktasında hep birlikte uzun bir masa." },
    { id: "e6", t: "Rehberli Çağdaş Sanat Turu", c: "sanat", d: "2026-11-14T13:00", sure: "2,5 saat", yer: "Karaköy, İstanbul", kap: 16, dolu: 13, ucret: "450 ₺", seviye: "Herkese açık",
      acik: "Bir sanat tarihçisi eşliğinde güncel sergiyi geziyor, ardından eserler üzerine kısa bir değerlendirme sohbeti yapıyoruz. Müze girişi ücrete dahildir." },
    { id: "e7", t: "Kutu Oyunları & Tanışma Akşamı", c: "soylesi", d: "2026-11-22T18:30", sure: "3 saat", yer: "Beşiktaş’ta oyun kafe", kap: 24, dolu: 6, ucret: "250 ₺", seviye: "Yeni üyelere ideal",
      acik: "Kulübe yeni katılanlar ile eski dostları aynı masalarda buluşturan, buz kıran oyunlarla dolu bir akşam. İçecek ikramı dahildir." },
    { id: "e8", t: "Cumalıkızık Günübirlik Gezisi", c: "kultur", d: "2026-11-29T07:00", sure: "Tam gün", yer: "Kalkış: Kadıköy", kap: 30, dolu: 21, ucret: "1.450 ₺", seviye: "Kolay tempo",
      acik: "700 yıllık Osmanlı köyünde köy kahvaltısı, sokak yürüyüşü ve Bursa’da kısa bir şehir turu. Ulaşım, kahvaltı ve rehberlik ücrete dahildir." },
    { id: "e9", t: "Balat’ta Fotoğraf Yürüyüşü", c: "sanat", d: "2026-12-06T10:30", sure: "3 saat", yer: "Balat, Fatih", kap: 15, dolu: 4, ucret: "300 ₺", seviye: "Telefon kamerası yeterli",
      acik: "Kompozisyon ve ışık üzerine kısa bir giriş, ardından renkli sokaklarda uygulama. Günün sonunda herkes en sevdiği karesini grupla paylaşır." },
    { id: "e10", t: "Yoga & Nefes Buluşması", c: "spor", d: "2026-12-13T10:00", sure: "1,5 saat", yer: "Cihangir’de stüdyo", kap: 14, dolu: 10, ucret: "400 ₺", seviye: "Başlangıç",
      acik: "Sertifikalı eğitmen eşliğinde nazik bir akış ve nefes çalışması. Mat stüdyoda mevcuttur; rahat kıyafet yeterlidir." },
    { id: "e11", t: "El Yapımı Yılbaşı Hediyesi Atölyesi", c: "atolye", d: "2026-12-20T14:00", sure: "3 saat", yer: "Kadıköy’de partner atölye", kap: 16, dolu: 3, ucret: "750 ₺", seviye: "Başlangıç",
      acik: "Mum, kurutulmuş çiçek ve kâğıt sanatlarıyla sevdikleriniz için kişisel hediyeler hazırlıyoruz. Tüm malzemeler ücrete dahildir." },
    { id: "e12", t: "Yıl Sonu Buluşması", c: "soylesi", d: "2026-12-27T19:00", sure: "4 saat", yer: "Duyurulacak", kap: 60, dolu: 22, ucret: "Ücretsiz", seviye: "Tüm üyeler",
      acik: "Yılın en sevilen anlarını birlikte hatırlıyor, yeni yılın etkinlik takvimini topluluk olarak oyluyoruz. Kulübün en sıcak gecesi." }
  ];

  var AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  var AYLAR_UZUN = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

  var ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    lvl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V14M10 20V9M16 20V4"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1-1.2 2 .8c-.2 1.3-1.2 2-2.5 1.8C11 15 8.9 12.9 8.5 10c-.2-1.3.5-2.3 1.8-2.5l.8 2z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  function dt(e) { return new Date(e.d); }
  function waLink(e) {
    var d = dt(e);
    var txt = "HADİ Etkinlik Kulübü: " + e.t + " – " + d.getDate() + " " + AYLAR_UZUN[d.getMonth()] + " " + saat(d) + ", " + e.yer + ". Birlikte gidelim mi? https://hadietkinlikkulubu.com/etkinlikler";
    return "https://wa.me/?text=" + encodeURIComponent(txt);
  }
  function icsFor(e) {
    var d = dt(e), hrs = parseFloat(String(e.sure).replace(",", ".")) || 3, end = new Date(d.getTime() + (isNaN(hrs) ? 3 : hrs) * 3600e3);
    var f = function (x) { return x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); };
    var esc = function (t) { return String(t).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n"); };
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HADI Etkinlik Kulubu//TR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      "UID:" + e.id + "@hadietkinlikkulubu.com", "DTSTAMP:" + f(new Date()), "DTSTART:" + f(d), "DTEND:" + f(end),
      "SUMMARY:" + esc("HADİ · " + e.t), "LOCATION:" + esc(e.yer), "DESCRIPTION:" + esc(e.acik || ""),
      "URL:https://hadietkinlikkulubu.com/etkinlikler", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-ics]"); if (!b) return;
    var e = EVENTS.filter(function (x) { return x.id === b.dataset.ics; })[0]; if (!e) return;
    var url = URL.createObjectURL(new Blob([icsFor(e)], { type: "text/calendar;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = "hadi-" + e.id + ".ics"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });
  function saat(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function upcoming() {
    var now = new Date();
    return EVENTS.filter(function (e) { return dt(e) > now; }).sort(function (a, b) { return dt(a) - dt(b); });
  }

  function card(e) {
    var d = dt(e), cat = CATS[e.c], kalan = e.kap - e.dolu, pct = Math.round(e.dolu / e.kap * 100);
    return '<article class="event" data-cat="' + e.c + '" style="--c:' + cat.renk + '">' +
      '<div class="event-top"><div class="event-date"><b>' + d.getDate() + '</b><small>' + AYLAR[d.getMonth()] + '</small></div>' +
      '<div><span class="event-cat">' + cat.ad + '</span><h3>' + e.t + '</h3></div></div>' +
      '<div class="event-body"><ul class="event-info">' +
      '<li>' + ICON.cal + GUNLER[d.getDay()] + ', ' + saat(d) + ' · ' + e.sure + '</li>' +
      '<li>' + ICON.pin + e.yer + '</li></ul>' +
      '<div class="seats"><div class="seats-bar"><span data-w="' + pct + '%"></span></div>' +
      '<div class="seats-label"><span>' + (kalan <= 3 ? 'Son ' + kalan + ' yer' : kalan + ' kişilik yer kaldı') + '</span><span>' + e.kap + ' kişilik grup</span></div></div>' +
      '<div class="event-foot"><span class="price">' + e.ucret + '</span>' +
      '<span class="ev-actions">' +
      '<button class="ev-ic" type="button" data-ics="' + e.id + '" aria-label="Takvime ekle" title="Takvime ekle">' + ICON.cal + '</button>' +
      '<a class="ev-ic" href="' + waLink(e) + '" target="_blank" rel="noopener" aria-label="WhatsApp’ta paylaş" title="WhatsApp’ta paylaş">' + ICON.wa + '</a>' +
      '</span></div></div></article>';
  }

  function fillSeats(root) {
    var bars = $$(".seats-bar span", root);
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { x.target.style.width = x.target.dataset.w; io.unobserve(x.target); } });
    }, { threshold: .4 }) : null;
    bars.forEach(function (b) { io ? io.observe(b) : (b.style.width = b.dataset.w); });
  }

  /* ---------------- Genel: başlık, ilerleme, menü ---------------- */
  var header = $(".site-header"), prog = $(".progress");
  function onScroll() {
    var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
    if (prog) prog.style.setProperty("--p", max > 0 ? (h.scrollTop / max).toFixed(4) : 0);
    if (header) header.classList.toggle("is-scrolled", h.scrollTop > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  var toggle = $(".nav-toggle");
  if (toggle) toggle.addEventListener("click", function () {
    var open = document.body.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", open);
  });
  $$(".nav-links a").forEach(function (a) { a.addEventListener("click", function () { document.body.classList.remove("nav-open"); }); });

  /* ---------------- Görünüme girince ---------------- */
  if ("IntersectionObserver" in window && !reduce) {
    var rio = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); rio.unobserve(x.target); } });
    }, { threshold: .15 });
    $$(".reveal").forEach(function (el) { rio.observe(el); });
  } else { $$(".reveal").forEach(function (el) { el.classList.add("in"); }); }

  /* ---------------- Sayaçlar ---------------- */
  $$("[data-count]").forEach(function (el) {
    var target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || "", prefix = el.dataset.prefix || "", done = false;
    function run() {
      if (done) return; done = true;
      if (reduce) { el.textContent = prefix + target + suffix; return; }
      var t0 = null;
      function step(t) {
        if (!t0) t0 = t;
        var p = Math.min((t - t0) / 1400, 1), v = Math.round(target * (1 - Math.pow(1 - p, 3)));
        el.textContent = prefix + v + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { run(); o.disconnect(); } }, { threshold: .6 }).observe(el);
    } else run();
  });

  /* ---------------- Kahraman: daktilo + yörünge ---------------- */
  var typed = $("#typed");
  if (typed) {
    var PHRASES = [
      { k: "h", w: "Heyecan", s: "yeni bir şey deneyelim." },
      { k: "a", w: "Aktivite", s: "müzeye gidelim." },
      { k: "d", w: "Dostluk", s: "aynı sofrada buluşalım." },
      { k: "i", w: "İletişim", s: "uzun uzun sohbet edelim." },
      { k: "a", w: "Aktivite", s: "ormanda yürüyelim." },
      { k: "h", w: "Heyecan", s: "rotayı değiştirelim." },
      { k: "a", w: "Aktivite", s: "çömlek yapalım." },
      { k: "d", w: "Dostluk", s: "yeni dostlar edinelim." }
    ];
    var COLORS = { h: "var(--h)", a: "var(--a)", d: "var(--d)", i: "var(--i)" };
    var line = typed.parentElement;
    var pi = 0;
    function light(k, w) {
      var la = $("#logo-anim"); if (la) la.dataset.active = k;
      line.style.setProperty("--tc", COLORS[k]);
    }
    if (reduce) {
      typed.textContent = PHRASES[0].s; light("h", "Heyecan");
    } else {
      (function cycle() {
        var p = PHRASES[pi % PHRASES.length], i = 0;
        light(p.k, p.w);
        (function type() {
          typed.textContent = p.s.slice(0, ++i);
          if (i < p.s.length) setTimeout(type, 55 + Math.random() * 55);
          else setTimeout(erase, 2100);
        })();
        function erase() {
          typed.textContent = typed.textContent.slice(0, -1);
          if (typed.textContent.length) setTimeout(erase, 26);
          else { pi++; setTimeout(cycle, 320); }
        }
      })();
    }
  }

  /* ---------------- Canlı logo ---------------- */
  var logo = $("#logo-anim");
  if (logo && !reduce) {
    var play = function () { logo.classList.remove("play"); void logo.offsetWidth; logo.classList.add("play"); };
    play();
    logo.addEventListener("click", play);
    logo.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });
    var hero = logo.closest(".hero") || logo;
    if (window.matchMedia("(hover: hover)").matches) {
      hero.addEventListener("pointermove", function (e) {
        var r = logo.getBoundingClientRect();
        var x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        logo.style.setProperty("--mx", Math.max(-1, Math.min(1, x)).toFixed(3));
        logo.style.setProperty("--my", Math.max(-1, Math.min(1, y)).toFixed(3));
      });
      hero.addEventListener("pointerleave", function () { logo.style.setProperty("--mx", 0); logo.style.setProperty("--my", 0); });
    }
  }

  /* ---------------- Kayan şerit: sürükle, kaydır, fırlat ----------------
     Şerit kendi hızında sola akar. Fare ya da parmakla tutulup sürüklenebilir;
     bırakıldığı andaki hıza göre süzülür, sonra yavaşça olağan hızına döner. */
  var mq = $(".marquee"), mqTrack = mq && $(".marquee-track", mq);
  if (mq && mqTrack) {
    mq.classList.add("js-driven");
    var items = $$(".marquee-item", mqTrack);
    var BASE = reduce ? 0 : -42;            // px/sn, eksi = sola
    var x = 0, v = BASE, period = 0, dragging = false, visible = true, last = 0;
    var samples = [], startX = 0, startPos = 0, pid = null;
    var measure = function () {
      var half = items.length / 2;
      period = items.length > 1 ? items[half].offsetLeft - items[0].offsetLeft : mqTrack.scrollWidth / 2;
    };
    var wrap = function () { if (period > 0) { x = x % period; if (x > 0) x -= period; } };
    var tick = function (t) {
      var dt = last ? Math.min((t - last) / 1000, .05) : 0; last = t;
      if (!dragging && visible) {
        v = BASE + (v - BASE) * Math.exp(-dt * 1.6);   // sürtünme: fırlatma hızı olağan hıza süzülür
        x += v * dt;
      }
      wrap();
      mqTrack.style.transform = "translate3d(" + x.toFixed(2) + "px,0,0)";
      requestAnimationFrame(tick);
    };
    measure();
    window.addEventListener("resize", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(mq);
    requestAnimationFrame(tick);

    mq.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; pid = e.pointerId; startX = e.clientX; startPos = x;
      samples = [{ x: e.clientX, t: e.timeStamp }];
      mq.classList.add("is-dragging");
      try { mq.setPointerCapture(pid); } catch (err) {}
    });
    mq.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pid) return;
      x = startPos + (e.clientX - startX);
      samples.push({ x: e.clientX, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
    });
    var release = function (e) {
      if (!dragging || (e && e.pointerId !== pid)) return;
      dragging = false; mq.classList.remove("is-dragging");
      var a = samples[0], b = samples[samples.length - 1], dt = (b.t - a.t) / 1000;
      if (dt > 0 && e && e.timeStamp - b.t < 80) v = Math.max(-4000, Math.min(4000, (b.x - a.x) / dt));
      else v = BASE;
    };
    mq.addEventListener("pointerup", release);
    mq.addEventListener("pointercancel", release);
    mq.addEventListener("lostpointercapture", release);
    /* Dokunmatik yüzeyde yatay kaydırma (iki parmak) da şeridi iter */
    mq.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); v -= e.deltaX * 6; }
    }, { passive: false });
    mq.addEventListener("dragstart", function (e) { e.preventDefault(); });
  }

  /* ---------------- "1 dakikada H.A.D.İ." anlatımı ----------------
     Basit bir zaman çizelgesi: her sahne data-dur saniye sürer. Sahne
     içindeki CSS animasyonları sahne açıldığında baştan başlar; duraklatınca
     hem saat hem animasyonlar durur. */
  var hv = $("#hv");
  if (hv) {
    var hvStage = $(".hv-stage", hv), hvScreen = $(".hv-screen", hv), hvBar = $(".hv-bar", hv), hvTime = $(".hv-time", hv);
    var hvScenes = $$(".hv-scene", hv), starts = [], total = 0;
    hvScenes.forEach(function (sc) { starts.push(total); total += parseFloat(sc.dataset.dur); });
    var segs = hvScenes.map(function (sc, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "hv-seg"; b.style.setProperty("--f", sc.dataset.dur);
      b.setAttribute("aria-label", (i + 1) + ". bölüm: " + sc.dataset.title);
      b.innerHTML = "<i></i><span>" + sc.dataset.title + "</span>";
      b.addEventListener("click", function () { hvSeek(i); hvPlay(); });
      hvBar.appendChild(b); return b;
    });
    var hvT = 0, hvCur = -1, hvPlaying = false, hvLast = 0, hvRaf = null, hvOpener = null;
    var fmt = function (t) { t = Math.floor(t); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
    var fit = function () { hvStage.style.transform = "scale(" + (hvScreen.clientWidth / 960) + ")"; };
    var activate = function (i) {
      hvScenes.forEach(function (sc) { sc.classList.remove("on"); var la = $(".logo-anim", sc); if (la) la.classList.remove("play"); });
      void hvStage.offsetWidth;
      var sc = hvScenes[i]; sc.classList.add("on");
      var la = $(".logo-anim", sc); if (la) la.classList.add("play");
      hvCur = i;
      segs.forEach(function (b, k) { b.classList.toggle("cur", k === i); });
    };
    var counters = function (sc, local) {
      $$("[data-to]", sc).forEach(function (el) {
        var at = parseFloat(el.dataset.at || 0), len = parseFloat(el.dataset.len || 1.2), to = parseFloat(el.dataset.to);
        var p = Math.max(0, Math.min(1, (local - at) / len)); p = 1 - Math.pow(1 - p, 3);
        el.textContent = (el.dataset.prefix || "") + Math.round(to * p) + (el.dataset.suffix || "");
      });
    };
    var render = function () {
      var i = hvScenes.length - 1;
      while (i > 0 && hvT < starts[i]) i--;
      if (i !== hvCur) activate(i);
      segs.forEach(function (b, k) {
        var d = parseFloat(hvScenes[k].dataset.dur), p = Math.max(0, Math.min(1, (hvT - starts[k]) / d));
        $("i", b).style.width = (p * 100) + "%";
      });
      counters(hvScenes[i], hvT - starts[i]);
      hvTime.textContent = fmt(hvT) + " / " + fmt(total);
    };
    var loop = function (ts) {
      var dt = hvLast ? Math.min((ts - hvLast) / 1000, .1) : 0; hvLast = ts;
      if (hvPlaying) { hvT += dt; if (hvT >= total) { hvT = total - .001; hvPause(); } }
      render();
      hvRaf = requestAnimationFrame(loop);
    };
    var hvPlay = function () { hvPlaying = true; hv.classList.remove("is-paused"); $(".hv-play", hv).setAttribute("aria-label", "Duraklat"); };
    var hvPause = function () { hvPlaying = false; hv.classList.add("is-paused"); $(".hv-play", hv).setAttribute("aria-label", "Oynat"); };
    var hvSeek = function (i) { hvT = starts[i]; hvCur = -1; render(); };
    var hvOpen = function (e) {
      hvOpener = e && e.currentTarget;
      hv.hidden = false; document.body.style.overflow = "hidden";
      fit(); hvSeek(0); hvPlay(); hvLast = 0;
      if (!hvRaf) hvRaf = requestAnimationFrame(loop);
      $(".hv-x", hv).focus({ preventScroll: true });
    };
    var hvClose = function () {
      hvPause(); hv.hidden = true; document.body.style.overflow = "";
      cancelAnimationFrame(hvRaf); hvRaf = null; hvCur = -1;
      hvScenes.forEach(function (sc) { sc.classList.remove("on"); });
      if (hvOpener) hvOpener.focus({ preventScroll: true });
    };
    $$("[data-hv-open]").forEach(function (b) { b.addEventListener("click", hvOpen); });
    $$("[data-hv-close]", hv).forEach(function (b) { b.addEventListener("click", hvClose); });
    $$("[data-hv-replay]", hv).forEach(function (b) { b.addEventListener("click", function () { hvSeek(0); hvPlay(); }); });
    $(".hv-play", hv).addEventListener("click", function () {
      if (hvPlaying) hvPause(); else { if (hvT >= total - .01) hvSeek(0); hvPlay(); }
    });
    $(".hv-screen", hv).addEventListener("click", function (e) {
      if (e.target.closest("a, button")) return;
      if (hvPlaying) hvPause(); else { if (hvT >= total - .01) hvSeek(0); hvPlay(); }
    });
    window.addEventListener("resize", function () { if (!hv.hidden) fit(); });
    document.addEventListener("keydown", function (e) {
      if (hv.hidden) return;
      if (e.key === "Escape") hvClose();
      if (e.key === " " && !e.target.closest("a, button")) { e.preventDefault(); $(".hv-play", hv).click(); }
      if (e.key === "ArrowRight" && hvCur < hvScenes.length - 1) { hvSeek(hvCur + 1); }
      if (e.key === "ArrowLeft") { hvSeek(Math.max(0, hvCur - (hvT - starts[hvCur] < 1 ? 1 : 0))); }
    });
  }

  /* ---------------- Etkinlik öner: fikir çekici ---------------- */
  var ideaEl = $("#idea");
  if (ideaEl && window.HADI_IDEAS) {
    var ideas = window.HADI_IDEAS.slice(), ii = Math.floor(Math.random() * ideas.length);
    var showIdea = function () {
      ideaEl.classList.remove("spin"); void ideaEl.offsetWidth; ideaEl.classList.add("spin");
      ideaEl.textContent = ideas[ii % ideas.length];
    };
    showIdea();
    $("#idea-next").addEventListener("click", function () { ii += 1 + Math.floor(Math.random() * 5); showIdea(); });
    $("#idea-use").addEventListener("click", function () {
      var f = $("#o-baslik"); f.value = ideaEl.textContent; f.dispatchEvent(new Event("input"));
      f.focus({ preventScroll: true }); f.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
  }

  /* ---------------- Galeri ışık kutusu ---------------- */
  var lb = $("#lb");
  if (lb) {
    var lbImg = $("img", lb), lbCap = $("p", lb);
    $$("[data-lightbox]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault(); lbImg.src = a.href; lbImg.alt = $("img", a).alt; lbCap.textContent = $("img", a).alt;
        lb.hidden = false; document.body.style.overflow = "hidden"; $(".lb-x", lb).focus();
      });
    });
    var lbClose = function () { lb.hidden = true; document.body.style.overflow = ""; };
    lb.addEventListener("click", function (e) { if (e.target === lb || e.target.closest(".lb-x")) lbClose(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !lb.hidden) lbClose(); });
  }

  /* ---------------- Sen hangi harfsin? ---------------- */
  var quiz = $("#quiz");
  if (quiz && window.HADI_QUIZ) {
    var QZ = window.HADI_QUIZ, answers = [], qi = 0, scores = null, winner = null;
    var steps = { intro: $('[data-step="intro"]', quiz), q: $('[data-step="q"]', quiz), result: $('[data-step="result"]', quiz) };
    var KEYS = ["h", "a", "d", "i"], NAMES = { h: "Heyecan", a: "Aktivite", d: "Dostluk", i: "İletişim" };
    var go = function (name) {
      Object.keys(steps).forEach(function (k) { steps[k].hidden = k !== name; });
      var el = steps[name]; el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
      var top = quiz.getBoundingClientRect().top + window.scrollY - 100;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    };
    var renderQ = function () {
      var q = QZ.q[qi];
      $(".quiz-progress span", quiz).style.width = (qi / QZ.q.length * 100) + "%";
      $(".quiz-count", quiz).textContent = (qi + 1) + " / " + QZ.q.length;
      $(".quiz-title", quiz).textContent = q[0];
      var box = $(".quiz-answers", quiz); box.innerHTML = "";
      var opts = q[1].slice().sort(function () { return Math.random() - .5; });
      opts.forEach(function (o, n) {
        var b = document.createElement("button"); b.type = "button"; b.className = "quiz-a";
        b.style.setProperty("--n", n); b.dataset.k = o[0]; b.textContent = o[1];
        if (answers[qi] === o[0]) b.classList.add("picked");
        b.addEventListener("click", function () {
          answers[qi] = o[0]; b.classList.add("picked");
          setTimeout(function () { qi++; if (qi < QZ.q.length) { go("q"); renderQ(); } else finish(); }, 320);
        });
        box.appendChild(b);
      });
      $("[data-quiz-back]", quiz).style.visibility = qi > 0 ? "visible" : "hidden";
    };
    var showResult = function (k, sc) {
      winner = k; var r = QZ.r[k];
      var card = $(".qr-card", quiz); card.style.setProperty("--c", r.renk);
      $(".qr-letter", quiz).textContent = r.harf;
      $(".qr-title", quiz).textContent = r.harf + (k === "a" ? "’sın: " : "’sin: ") + r.ad + "!";
      $(".qr-text", quiz).textContent = r.metin;
      var total = KEYS.reduce(function (t, x) { return t + (sc[x] || 0); }, 0) || 1;
      $(".qr-bars", quiz).innerHTML = KEYS.map(function (x) {
        var p = Math.round((sc[x] || 0) / total * 100);
        return '<div class="qr-bar" style="--c:' + QZ.r[x].renk + ';--p:' + p + '%"><b>' + QZ.r[x].harf + '</b><span class="qr-track"><i></i></span><em>%' + p + '</em><small>' + NAMES[x] + '</small></div>';
      }).join("");
      $(".qr-chips", quiz).innerHTML = r.oneri.map(function (o) { return '<span class="hv-chip" style="--c:' + r.renk + '"><i></i>' + o + '</span>'; }).join("");
      go("result");
      requestAnimationFrame(function () { $$(".qr-bar", quiz).forEach(function (b) { b.classList.add("grow"); }); });
      if (history.replaceState) history.replaceState(null, "", "?sonuc=" + k);
    };
    var finish = function () {
      scores = { h: 0, a: 0, d: 0, i: 0 };
      answers.forEach(function (k, n) { scores[k] += 1 + n * 0.01; });   // eşitlikte son cevaplar biraz ağır basar
      var best = KEYS.sort(function (x, y) { return scores[y] - scores[x]; })[0];
      KEYS = ["h", "a", "d", "i"];
      var rounded = {}; KEYS.forEach(function (x) { rounded[x] = Math.round(scores[x]); });
      showResult(best, rounded);
      try { localStorage.setItem("hadi-harf", best); } catch (e) {}
    };
    $("[data-quiz-start]", quiz).addEventListener("click", function () { answers = []; qi = 0; go("q"); renderQ(); });
    $("[data-quiz-back]", quiz).addEventListener("click", function () { if (qi > 0) { qi--; go("q"); renderQ(); } });
    $("[data-quiz-again]", quiz).addEventListener("click", function () {
      answers = []; qi = 0; if (history.replaceState) history.replaceState(null, "", location.pathname); go("q"); renderQ();
    });
    var shareUrl = function () { return location.origin && location.origin !== "null" ? location.origin + location.pathname + "?sonuc=" + winner : "https://hadietkinlikkulubu.com/test?sonuc=" + winner; };
    $("[data-quiz-share]", quiz).addEventListener("click", function () {
      var r = QZ.r[winner], text = "H.A.D.İ. testinde ben " + r.harf + " çıktım: " + r.ad + "! Sen hangi harfsin?";
      if (navigator.share) { navigator.share({ title: "Sen hangi harfsin?", text: text, url: shareUrl() }).catch(function () {}); }
      else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + shareUrl()), "_blank", "noopener");
    });
    $("[data-quiz-download]", quiz).addEventListener("click", function () {
      var r = QZ.r[winner], W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      var c = cv.getContext("2d"), disp = '"Bricolage Grotesque", "Figtree", sans-serif', body = '"Figtree", sans-serif';
      c.fillStyle = "#fff"; c.fillRect(0, 0, W, H);
      var cols = ["#F2801F", "#1D9AD6", "#78BE3A", "#A3338C"];
      cols.forEach(function (col, n) { c.fillStyle = col; c.fillRect(n * W / 4, 0, W / 4, 18); });
      c.strokeStyle = r.renk; c.lineCap = "round";
      [[380, 26, 3.6, 5.4], [340, 16, .3, 2.2], [300, 10, 2.6, 3.4]].forEach(function (a) { c.lineWidth = a[1]; c.globalAlpha = .9; c.beginPath(); c.arc(W / 2, 520, a[0], a[2], a[3]); c.stroke(); });
      c.globalAlpha = 1; c.fillStyle = r.renk; c.textAlign = "center"; c.textBaseline = "alphabetic";
      c.font = "800 520px " + disp; c.fillText(r.harf, W / 2, 700);
      c.fillStyle = "#17344F"; c.font = "600 44px " + body; c.fillText("Sen bir", W / 2, 960);
      c.font = "800 92px " + disp; c.fillText(r.ad + "!", W / 2, 1060);
      c.fillStyle = "#3E5770"; c.font = "500 34px " + body;
      var words = r.metin.split(" "), line = "", y = 1140, lines = 0;
      words.forEach(function (w) { var t = line ? line + " " + w : w; if (c.measureText(t).width > 880 && lines < 2) { c.fillText(line, W / 2, y); y += 46; lines++; line = w; } else line = t; });
      if (lines < 3) c.fillText(line.length > 70 ? line.slice(0, 68) + "…" : line, W / 2, y);
      c.fillStyle = "#6B7F92"; c.font = "700 30px " + body; c.fillText("hadietkinlikkulubu.com/test · Sen hangi harfsin?", W / 2, 1300);
      var fname = "hadi-" + r.ad.toLowerCase().replace(/[^a-zğüşıöç]/g, "") + ".png";
      var save = function (url) { var a = document.createElement("a"); a.download = fname; a.href = url; document.body.appendChild(a); a.click(); a.remove(); };
      var plain = cv.toDataURL("image/png");             // logosuz yedek
      var logo = new Image();
      logo.onload = function () {
        c.drawImage(logo, 60, 60, 150, 150);
        try { save(cv.toDataURL("image/png")); } catch (err) { save(plain); }   // dosyadan açıldığında tarayıcı logoyu engelleyebilir
      };
      logo.onerror = function () { save(plain); };
      logo.src = "assets/img/hadi-logo-512.jpg";
    });
    var pre = new URLSearchParams(location.search).get("sonuc");
    if (pre && QZ.r[pre]) { var z = { h: 0, a: 0, d: 0, i: 0 }; z[pre] = 1; showResult(pre, z); $(".qr-bars", quiz).previousElementSibling.hidden = true; $(".qr-bars", quiz).hidden = true; $("[data-quiz-again]", quiz).textContent = "Sen de çöz"; }
  }

  (function () {
  /* =====================================================================
     YARATICI EKLER
     ===================================================================== */
  var HEX = { h: "#F2801F", a: "#1D9AD6", d: "#78BE3A", i: "#A3338C", pink: "#E0407A", ink: "#17344F" };
  var qp = new URLSearchParams(location.search);
  var clean = function (t, n) { return String(t || "").replace(/[<>]/g, "").trim().slice(0, n || 32); };

  /* Konfeti + logodaki figürler (gizli sürpriz ve davetiye karşılaması) */
  var confetti = function () {
    if (reduce) return;
    var box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
    var cols = [HEX.h, HEX.a, HEX.d, HEX.i, HEX.pink], html = "";
    for (var n = 0; n < 80; n++) {
      html += '<i style="--x:' + (Math.random() * 100).toFixed(1) + 'vw;--dx:' + ((Math.random() - .5) * 30).toFixed(1) + 'vw;--r:' + Math.round(Math.random() * 900 - 450) + 'deg;--d:' + (Math.random() * .7).toFixed(2) + 's;--t:' + (2.2 + Math.random() * 1.6).toFixed(2) + 's;--s:' + Math.round(8 + Math.random() * 9) + 'px;--c:' + cols[n % 5] + '"></i>';
    }
    ["runner", "jumper", "duo", "emblem"].forEach(function (f, n) {
      html += '<img class="cf-fig" src="assets/img/logo-anim/' + f + '.webp" alt="" style="--x:' + (10 + n * 22 + Math.random() * 6).toFixed(1) + 'vw;--d:' + (n * .15).toFixed(2) + 's;--r:' + (n % 2 ? 18 : -18) + 'deg">';
    });
    box.innerHTML = html; document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 5200);
  };
  window.hadiConfetti = confetti;

  /* Gizli sürpriz: "hadi" yaz ya da alt bilgideki logoya 5 kez dokun */
  var eggBuf = "";
  document.addEventListener("keydown", function (e) {
    var t = e.target; if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    if (!e.key || e.key.length !== 1) return;
    eggBuf = (eggBuf + e.key.toLocaleLowerCase("tr")).slice(-4);
    if (eggBuf === "hadi") { eggBuf = ""; confetti(); toast("Hadi! 🎉 Gizli sürprizi buldun."); }
  });
  var footLogo = $(".foot-brand img");
  if (footLogo) {
    var taps = [];
    footLogo.style.cursor = "pointer";
    footLogo.addEventListener("click", function () {
      var now = Date.now(); taps = taps.filter(function (x) { return now - x < 2500; }); taps.push(now);
      footLogo.classList.remove("tap"); void footLogo.offsetWidth; footLogo.classList.add("tap");
      if (taps.length >= 5) { taps = []; confetti(); toast("Hadi! 🎉 Gizli sürprizi buldun."); }
    });
  }

  /* Saate ve güne göre karşılama */
  var greet = $("#greet");
  if (greet) {
    var now = new Date(), d = now.getDay(), h = now.getHours(), msg;
    if (h < 5 || h >= 23) msg = "Uyuyamadın mı? Bir etkinlik öner bakalım.";
    else if (d === 5 && h >= 16) msg = "Cuma akşamı! Hafta sonu planın hazır mı?";
    else if (d === 6) msg = "Cumartesi geldi. Bugün kendine ne ısmarlıyorsun?";
    else if (d === 0) msg = h < 18 ? "Pazar keyfi… Haftaya ne yapsak?" : "Pazar akşamı hüznü mü? Haftaya bir plan yapalım.";
    else if (d === 1 && h < 12) msg = "Hafta zor başladı ama cumartesi bizimle.";
    else if (h < 11) msg = "Günaydın! Bugün yeni bir şeye hazır mısın?";
    else if (h < 17) msg = "İyi günler! Öğle arasında hafta sonunu planlayalım mı?";
    else msg = "İyi akşamlar! Hafta sonu için fikir lazım mı?";
    greet.textContent = msg;
  }

  /* Etkinlik öner: ?fikir= ile gelen fikri forma yaz */
  var fikir = clean(qp.get("fikir"), 60), ob = $("#o-baslik");
  if (fikir && ob) ob.value = fikir;

  /* ---------------- Hadi davetiyesi ---------------- */
  var inv = $("#inv-card");
  if (inv && window.HADI_ACTS) {
    var ACTS = window.HADI_ACTS;
    var f = { kime: $("#inv-kime"), ne: $("#inv-ne"), kendi: $("#inv-kendi"), zaman: $("#inv-ne-zaman"), kimden: $("#inv-kimden") };
    var color = "h";
    var findAct = function (name) { return ACTS.filter(function (a) { return a.ad === name; })[0]; };
    var state = function () {
      var custom = f.ne.value === "__kendi", act = findAct(f.ne.value);
      return {
        kime: clean(f.kime.value, 24) || "Ayşe",
        ne: custom ? (clean(f.kendi.value, 32) || "Kendi fikrim") : f.ne.value,
        e: custom ? "✨" : (act ? act.e : "✨"),
        z: f.zaman.value, k: clean(f.kimden.value, 24), c: color
      };
    };
    var paint = function (st) {
      inv.style.setProperty("--c", "var(--" + st.c + ")");
      $("#ic-kime").textContent = st.kime;
      $("#ic-zaman").textContent = st.z + " birlikte";
      $("#ic-emoji").textContent = st.e;
      $("#ic-ne").textContent = st.ne;
      $("#ic-kimden").textContent = st.k ? "— " + st.k : "";
    };
    var link = function (st) {
      var base = location.origin && location.origin !== "null" ? location.origin + location.pathname : "https://hadietkinlikkulubu.com/davetiye";
      var p = new URLSearchParams({ kime: st.kime, ne: st.ne, e: st.e, z: st.z, c: st.c }); if (st.k) p.set("k", st.k);
      return base + "?" + p.toString();
    };
    var update = function () { $("#inv-kendi-wrap").hidden = f.ne.value !== "__kendi"; paint(state()); };
    ["input", "change"].forEach(function (ev) { Object.keys(f).forEach(function (k) { f[k].addEventListener(ev, update); }); });
    $$(".inv-colors button").forEach(function (b) {
      b.addEventListener("click", function () {
        color = b.dataset.c;
        $$(".inv-colors button").forEach(function (x) { x.setAttribute("aria-checked", x === b); });
        update();
      });
    });
    var need = function () { if (!clean(f.kime.value)) { f.kime.focus(); toast("Önce davet ettiğin kişinin adını yaz."); return false; } return true; };
    $("#inv-wa").addEventListener("click", function () {
      if (!need()) return; var st = state();
      var text = "Hadi " + st.kime + "! " + st.z + " birlikte: " + st.ne + " " + st.e + "\nGelir misin? 💌\n" + link(st);
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    });
    $("#inv-copy").addEventListener("click", function () {
      if (!need()) return; var url = link(state());
      var ok = function () { toast("Davetiye bağlantısı kopyalandı."); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { prompt("Bağlantıyı kopyala:", url); });
      else prompt("Bağlantıyı kopyala:", url);
    });
    $("#inv-png").addEventListener("click", function () {
      if (!need()) return; var st = state(), col = HEX[st.c] || HEX.h;
      var W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      var c = cv.getContext("2d"), disp = '"Bricolage Grotesque", "Figtree", sans-serif', body = '"Figtree", sans-serif';
      c.fillStyle = col; c.fillRect(0, 0, W, H);
      c.strokeStyle = "rgba(255,255,255,.22)"; c.lineCap = "round";
      [[520, 46, 3.4, 5.6], [460, 30, .2, 2.3], [400, 18, 2.6, 3.6]].forEach(function (a) { c.lineWidth = a[1]; c.beginPath(); c.arc(W - 120, 380, a[0], a[2], a[3]); c.stroke(); });
      c.fillStyle = "#fff"; c.textAlign = "left";
      c.font = "700 40px " + body; c.fillText("Bir davetin var 💌", 90, 170);
      c.font = "800 128px " + disp; c.fillText("Hadi,", 90, 360);
      var name = st.kime + "!"; var fs = 128; c.font = "800 " + fs + "px " + disp;
      while (c.measureText(name).width > W - 180 && fs > 60) { fs -= 6; c.font = "800 " + fs + "px " + disp; }
      c.fillText(name, 90, 360 + fs + 10);
      c.font = "600 46px " + body; c.fillText(st.z + " birlikte", 90, 680);
      c.font = "120px serif"; c.fillText(st.e, 90, 860);
      fs = 76; c.font = "800 " + fs + "px " + disp;
      while (c.measureText(st.ne).width > W - 180 && fs > 40) { fs -= 4; c.font = "800 " + fs + "px " + disp; }
      c.fillText(st.ne, 90, 980);
      c.font = "700 54px " + body; c.fillText("Gelir misin?", 90, 1090);
      if (st.k) { c.font = "600 40px " + body; c.fillText("— " + st.k, 90, 1170); }
      c.globalAlpha = .85; c.font = "700 30px " + body; c.fillText("hadietkinlikkulubu.com", 90, 1270); c.globalAlpha = 1;
      var a = document.createElement("a"); a.download = "hadi-davetiye.png"; a.href = cv.toDataURL("image/png"); document.body.appendChild(a); a.click(); a.remove();
    });
    // ön seçim (çarktan gelen ?ne=)
    var preNe = clean(qp.get("ne"), 32);
    if (preNe) { if (findAct(preNe)) f.ne.value = preNe; else { f.ne.value = "__kendi"; f.kendi.value = preNe; } }
    // alıcı görünümü
    var kime = clean(qp.get("kime"), 24);
    if (kime) {
      f.kime.value = kime; f.kimden.value = clean(qp.get("k"), 24);
      var z = clean(qp.get("z"), 20); if (z) f.zaman.value = z;
      var cc = qp.get("c"); if (HEX[cc]) color = cc;
      update();
      var e = clean(qp.get("e"), 8); if (e) $("#ic-emoji").textContent = e;
      document.body.classList.add("inv-received-mode");
      $(".inv-received").hidden = false; $(".inv-reply").hidden = false;
      setTimeout(confetti, 600);
    } else update();
  }

  /* ---------------- Ne yapsak? çarkı ---------------- */
  var wheelG = $("#wheel-g");
  if (wheelG && window.HADI_ACTS) {
    var ALL = window.HADI_ACTS, segs = [], rot = 0, spinning = false, N = 10, SEGC = ["h", "a", "d", "i", "pink"];
    var shuffle = function (arr) { arr = arr.slice(); for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    var poolFor = function (mode) {
      var by = function (t) { return ALL.filter(function (a) { return a.tur === t; }); };
      if (mode === "acik") return shuffle(by("acik")).slice(0, 6).concat(shuffle(by("her")).slice(0, 2), shuffle(by("kapali")).slice(0, 2));
      if (mode === "yagmur") return shuffle(by("kapali")).slice(0, 8).concat(shuffle(by("her")).slice(0, 2));
      if (mode === "kar") return by("kar").concat(shuffle(by("kapali")).slice(0, 7), shuffle(by("her")).slice(0, 2));
      return shuffle(by("acik")).slice(0, 4).concat(shuffle(by("kapali")).slice(0, 4), shuffle(by("her")).slice(0, 2));
    };
    var draw = function (mode) {
      segs = shuffle(poolFor(mode)).slice(0, N);
      var html = "", step = 360 / N, R = 190;
      segs.forEach(function (a, i) {
        var a0 = (i * step - 90) * Math.PI / 180, a1 = ((i + 1) * step - 90) * Math.PI / 180;
        var x0 = R * Math.cos(a0), y0 = R * Math.sin(a0), x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
        var mid = i * step + step / 2;
        var label = a.ad.length > 14 ? a.ad.slice(0, 13) + "…" : a.ad;
        html += '<path d="M0 0 L' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R + ' ' + R + ' 0 0 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Z" fill="' + HEX[SEGC[i % 5]] + '" stroke="#fff" stroke-width="3"/>' +
          '<g transform="rotate(' + (mid - 90) + ')"><text x="102" y="0" text-anchor="middle" dominant-baseline="middle" class="w-txt">' + label + '</text><text x="168" y="0" text-anchor="middle" dominant-baseline="middle" class="w-emo">' + a.e + '</text></g>';
      });
      wheelG.innerHTML = html;
      $("#w-result").hidden = true;
    };
    var spin = function () {
      if (spinning) return; spinning = true; $("#w-result").hidden = true;
      var i = Math.floor(Math.random() * N), step = 360 / N, center = i * step + step / 2;
      var jitter = (Math.random() - .5) * step * .6;
      var target = rot - (rot % 360) + 360 * 6 + ((360 - center) % 360) + jitter;
      rot = target;
      wheelG.style.transition = reduce ? "none" : "transform 4.6s cubic-bezier(.12,.72,.1,1)";
      wheelG.style.transform = "rotate(" + rot + "deg)";
      var done = function () {
        spinning = false; var a = segs[i];
        var r = $("#w-result"); r.hidden = false; r.classList.remove("pop"); void r.offsetWidth; r.classList.add("pop");
        $(".w-res-emoji", r).textContent = a.e; $(".w-res-name", r).textContent = a.ad;
        $("#w-invite").href = "davetiye.html?ne=" + encodeURIComponent(a.ad);
        $("#w-suggest").href = "oner.html?fikir=" + encodeURIComponent(a.ad);
        confetti();
      };
      if (reduce) done(); else setTimeout(done, 4700);
    };
    $("#wheel-spin").addEventListener("click", spin);
    $("#wheel").addEventListener("click", spin);

    var WICON = function (code) {
      if (code === 0) return "☀️"; if (code <= 2) return "🌤️"; if (code === 3) return "☁️"; if (code <= 48) return "🌫️";
      if (code <= 67 || (code >= 80 && code <= 82)) return "🌧️"; if (code <= 77 || code === 85 || code === 86) return "❄️"; return "⛈️";
    };
    var classify = function (code, tmax, pp) {
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "kar";
      if (pp >= 55 || (code >= 51 && code <= 67) || code >= 80) return "yagmur";
      return tmax >= 15 ? "acik" : "serin";
    };
    var GUN = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
    var wInfo = $("#w-weather"), wIl = $("#w-il");
    var applyCity = function (il) {
      try { localStorage.setItem("hadi-il", il); } catch (e) {}
      if (!il) { wInfo.textContent = "İl seçmezsen çark, açık ve kapalı mekân etkinliklerini karışık getirir."; draw("karisik"); return; }
      wInfo.textContent = il + " için hafta sonu hava tahmini alınıyor…";
      fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=tr&countryCode=TR&name=" + encodeURIComponent(il))
        .then(function (r) { return r.json(); })
        .then(function (g) {
          var p = g.results && g.results[0]; if (!p) throw new Error("konum");
          return fetch("https://api.open-meteo.com/v1/forecast?latitude=" + p.latitude + "&longitude=" + p.longitude + "&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Europe%2FIstanbul&forecast_days=8");
        })
        .then(function (r) { return r.json(); })
        .then(function (w) {
          var d = w.daily, days = [];
          d.time.forEach(function (t, n) { var day = new Date(t + "T12:00:00").getDay(); if ((day === 6 || day === 0) && days.length < 2) days.push({ day: day, code: d.weather_code[n], t: Math.round(d.temperature_2m_max[n]), pp: d.precipitation_probability_max[n] || 0 }); });
          if (!days.length) throw new Error("gün");
          var kinds = days.map(function (x) { return classify(x.code, x.t, x.pp); });
          var mode = kinds.indexOf("kar") > -1 ? "kar" : kinds.every(function (k) { return k === "yagmur"; }) ? "yagmur" : kinds.indexOf("yagmur") > -1 ? "karisik" : kinds.every(function (k) { return k === "acik"; }) ? "acik" : "karisik";
          var MSGS = { acik: "Güzel bir hafta sonu: çark açık hava ağırlıklı!", yagmur: "Yağmurlu görünüyor: çark kapalı mekânlara göre ayarlandı.", kar: "Kar var! Kayak da çarkta, sıcak mekânlar da.", karisik: "Hava kararsız: çarkta hem açık hem kapalı mekânlar var." };
          wInfo.innerHTML = "<b>" + il + "</b> · " + days.map(function (x) { return GUN[x.day] + " " + x.t + "° " + WICON(x.code); }).join(" · ") + "<br>" + MSGS[mode];
          draw(mode);
        })
        .catch(function () { wInfo.textContent = "Hava durumuna şu an ulaşılamadı; çark karışık önerilerle hazır."; draw("karisik"); });
    };
    wIl.addEventListener("change", function () { applyCity(wIl.value); });
    var savedIl = null; try { savedIl = localStorage.getItem("hadi-il"); } catch (e) {}
    if (savedIl && $$("option", wIl).some(function (o) { return o.value === savedIl; })) { wIl.value = savedIl; applyCity(savedIl); } else draw("karisik");
  }

  /* ---------------- Dijital üyelik kartı ---------------- */
  var uyForm = $('form[data-form="uyelik"]'), mwrap = $("#mcard-wrap");
  if (uyForm && mwrap) {
    uyForm.addEventListener("hadi:sent", function () {
      var ad = clean($("[name=ad]", uyForm).value, 40), il = $("[name=il]", uyForm) ? $("[name=il]", uyForm).value : "";
      var harf = null; try { harf = localStorage.getItem("hadi-harf"); } catch (e) {}
      var L = { h: ["H", "Heyecan"], a: ["A", "Aktivite"], d: ["D", "Dostluk"], i: ["İ", "İletişim"] };
      var now = new Date(), since = AYLAR_UZUN[now.getMonth()] + " " + now.getFullYear();
      var col = harf && HEX[harf] ? HEX[harf] : HEX.ink;
      mwrap.innerHTML = '<div class="mcard" style="--c:' + col + '">' +
        '<div class="mc-top"><img src="assets/img/hadi-logo-512.jpg" alt=""><span>H.A.D.İ. Üyesi</span></div>' +
        '<div class="mc-letter">' + (harf && L[harf] ? L[harf][0] : '<i style="--c:' + HEX.h + '"></i><i style="--c:' + HEX.a + '"></i><i style="--c:' + HEX.d + '"></i><i style="--c:' + HEX.i + '"></i>') + '</div>' +
        '<strong class="mc-name"></strong>' +
        '<span class="mc-meta">' + (harf && L[harf] ? L[harf][1] + " ruhlu · " : "") + (il ? il + " · " : "") + since + '’den beri</span>' +
        '<span class="mc-plan">Temel üye · Tamamen ücretsiz</span></div>' +
        '<div class="btn-row mc-actions"><button class="btn btn--sm" type="button" id="mc-dl">Üyelik kartımı indir</button>' +
        (harf ? "" : '<a class="btn btn--sm btn--ghost" href="test.html">Harfini öğren, kartın renklensin</a>') + '</div>';
      $(".mc-name", mwrap).textContent = ad;
      mwrap.hidden = false;
      $("#mc-dl").addEventListener("click", function () {
        var W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var c = cv.getContext("2d"), disp = '"Bricolage Grotesque", "Figtree", sans-serif', body = '"Figtree", sans-serif';
        c.fillStyle = "#fff"; c.fillRect(0, 0, W, H);
        c.fillStyle = col; c.beginPath(); c.roundRect ? c.roundRect(70, 160, W - 140, 900, 56) : c.rect(70, 160, W - 140, 900); c.fill();
        c.strokeStyle = "rgba(255,255,255,.2)"; c.lineCap = "round";
        [[360, 36, 3.6, 5.6], [310, 22, .2, 2.4]].forEach(function (a) { c.lineWidth = a[1]; c.beginPath(); c.arc(W - 220, 470, a[0], a[2], a[3]); c.stroke(); });
        c.fillStyle = "#fff"; c.textAlign = "left";
        c.font = "700 40px " + body; c.fillText("H.A.D.İ. Üyesi", 140, 270);
        c.font = "800 300px " + disp; c.fillText(harf && L[harf] ? L[harf][0] : "H.A.D.İ"[0], 130, 620);
        var fs = 84; c.font = "800 " + fs + "px " + disp; while (c.measureText(ad).width > W - 280 && fs > 44) { fs -= 4; c.font = "800 " + fs + "px " + disp; }
        c.fillText(ad, 140, 800);
        c.font = "600 36px " + body; c.fillText((harf && L[harf] ? L[harf][1] + " ruhlu · " : "") + (il ? il + " · " : "") + since + "’den beri", 140, 870);
        c.font = "700 34px " + body; c.globalAlpha = .9; c.fillText("Temel üye · Tamamen ücretsiz", 140, 990); c.globalAlpha = 1;
        c.fillStyle = HEX.ink; c.textAlign = "center"; c.font = "800 54px " + disp; c.fillText("Hadi, aramıza hoş geldin!", W / 2, 1180);
        c.fillStyle = "#6B7F92"; c.font = "700 30px " + body; c.fillText("hadietkinlikkulubu.com", W / 2, 1260);
        var save = function () { var a = document.createElement("a"); a.download = "hadi-uyelik-karti.png"; a.href = cv.toDataURL("image/png"); document.body.appendChild(a); a.click(); a.remove(); };
        save();
      });
    });
  }

  /* ---------------- Manifesto ---------------- */
  var mf = $(".mf");
  if (mf) {
    var lines = $$(".mf-line", mf), bar = $(".mf-progress span", mf);
    if ("IntersectionObserver" in window && !reduce) {
      var mio = new IntersectionObserver(function (en) { en.forEach(function (x) { x.target.classList.toggle("in", x.isIntersecting); }); }, { threshold: .55 });
      lines.forEach(function (l) { mio.observe(l); });
    } else lines.forEach(function (l) { l.classList.add("in"); });
    var mfScroll = function () {
      var r = mf.getBoundingClientRect(), total = mf.offsetHeight - window.innerHeight;
      bar.style.transform = "scaleX(" + Math.max(0, Math.min(1, -r.top / Math.max(1, total))).toFixed(4) + ")";
    };
    window.addEventListener("scroll", mfScroll, { passive: true }); mfScroll();
    var endObs = $(".mf-end", mf);
    if (endObs && "IntersectionObserver" in window) new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { endObs.classList.add("in"); } }, { threshold: .4 }).observe(endObs);
  }

  })();

  /* ---------------- Dört harf akordeonu ---------------- */
  var pillars = $$(".pillar");
  function openPillar(p) {
    pillars.forEach(function (x) { x.classList.toggle("is-open", x === p); x.setAttribute("aria-expanded", x === p); });
  }
  pillars.forEach(function (p) {
    p.addEventListener("click", function () { openPillar(p); });
    p.addEventListener("mouseenter", function () { if (window.matchMedia("(hover:hover) and (min-width: 921px)").matches) openPillar(p); });
  });

  /* ---------------- Biliyor muydunuz? ---------------- */
  var FACTS = [
    { n: "85 yıl", c: "var(--h)", t: "Harvard Yetişkin Gelişimi Araştırması 1938’den beri katılımcılarını izliyor. Vardığı en net sonuç: uzun ve sağlıklı bir yaşamı en iyi öngören şey, ilişkilerimizin kalitesi.", s: "Kaynak: Harvard Study of Adult Development" },
    { n: "200 saat", c: "var(--a)", t: "Bir tanıdığın yakın arkadaşa dönüşmesi için birlikte yaklaşık 200 saat geçirmek gerekiyor. Düzenli buluşmalar bu saatleri kendiliğinden biriktirir.", s: "Kaynak: Hall, J. A. (2018), Journal of Social and Personal Relationships" },
    { n: "120 dk", c: "var(--d)", t: "Haftada en az 120 dakikayı doğada geçiren kişiler, belirgin biçimde daha yüksek sağlık ve iyi oluş bildiriyor. Bu süre tek seferde ya da parça parça toplanabilir.", s: "Kaynak: White ve ark. (2019), Scientific Reports" },
    { n: "30 kat", c: "var(--i)", t: "Başkalarıyla birlikteyken gülme olasılığımız, yalnızken olduğundan yaklaşık 30 kat daha yüksek. Kahkaha büyük ölçüde sosyal bir davranış.", s: "Kaynak: Robert R. Provine, Laughter: A Scientific Investigation" },
    { n: "%50", c: "var(--pink)", t: "148 çalışmayı inceleyen bir meta-analiz, güçlü sosyal bağları olan kişilerin hayatta kalma olasılığının yaklaşık %50 daha yüksek olduğunu gösterdi.", s: "Kaynak: Holt-Lunstad ve ark. (2010), PLOS Medicine" },
    { n: "150", c: "var(--h)", t: "Antropolog Robin Dunbar’a göre insan zihni aynı anda yaklaşık 150 anlamlı ilişkiyi sürdürebiliyor. En yakın çember ise yalnızca 5 kişiden oluşuyor.", s: "Kaynak: Robin Dunbar, Friends (2021)" }
  ];
  var factCard = $("#fact");
  if (factCard) {
    var fi = 0, inner = $(".fact-inner", factCard), dots = $(".fact-dots", factCard), auto;
    FACTS.forEach(function (_, i) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("aria-label", (i + 1) + ". bilgi");
      b.addEventListener("click", function () { show(i); restart(); });
      dots.appendChild(b);
    });
    function render() {
      var f = FACTS[fi];
      $(".fact-num", factCard).textContent = f.n;
      factCard.style.setProperty("--fc", f.c);
      $(".fact-text", factCard).textContent = f.t;
      $(".fact-src", factCard).textContent = f.s;
      $$("button", dots).forEach(function (b, i) { b.setAttribute("aria-current", i === fi); });
    }
    function show(i) {
      if (reduce) { fi = i; render(); return; }
      inner.classList.add("out");
      setTimeout(function () { fi = i; render(); inner.classList.remove("out"); }, 320);
    }
    function restart() { clearInterval(auto); auto = setInterval(function () { show((fi + 1) % FACTS.length); }, 8000); }
    $("#fact-next").addEventListener("click", function () { show((fi + 1) % FACTS.length); restart(); });
    render(); restart();
  }

  /* ---------------- Ruh hali seçici ---------------- */
  var MOODS = {
    enerji: { c: "spor",    t: "Spor & Hareket", e: "Sahil koşuları, bisiklet turları, yoga ve takım oyunları.", m: "Enerjini paylaşacak bir ekip seni bekliyor." },
    kafa:   { c: "doga",    t: "Doğa",           e: "Orman yürüyüşleri, kamp ateşi akşamları ve şehirden kaçamak rotalar.", m: "Biraz yavaşlamak için birebir." },
    ogren:  { c: "atolye",  t: "Atölye",         e: "Seramik, fotoğraf, el sanatları ve yaratıcı yazarlık atölyeleri.", m: "Yeni bir beceri, yeni bir bakış açısı." },
    sohbet: { c: "soylesi", t: "Söyleşi & Buluşma", e: "Söyleşiler, sohbet çemberleri ve kutu oyunu akşamları.", m: "Muhabbet hiç bu kadar yakın olmamıştı." }
  };
  var moodOut = $("#mood-result");
  if (moodOut) {
    $$(".mood-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".mood-btn").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        var m = MOODS[b.dataset.mood], cat = CATS[m.c];
        moodOut.classList.remove("pop"); void moodOut.offsetWidth; moodOut.classList.add("pop");
        moodOut.innerHTML = '<p class="muted" style="margin-bottom:.4rem">' + m.m + '</p>' +
          '<span class="event-cat" style="--c:' + cat.renk + '">Sana göre</span>' +
          '<h3 style="margin:.3rem 0 .75rem">' + m.t + '</h3><p>' + m.e + '</p>' +
          '<p class="muted" style="font-size:.95rem">Bu türdeki etkinlikler üyelerimize duyuruluyor.</p>' +
          '<div class="btn-row"><a class="btn" href="katil.html">Ücretsiz üye ol ' + ICON.arrow + '</a></div>';
      });
    });
  }

  /* ---------------- Etkinlik listeleri ---------------- */
  var homeList = $("#home-events");
  if (homeList) { homeList.innerHTML = EVENTS.slice(0, 6).map(card).join(""); fillSeats(homeList); }

  var allList = $("#all-events");
  if (allList) { allList.innerHTML = EVENTS.slice(0, 6).map(card).join(""); fillSeats(allList); }

  /* Geri sayım */
  var cd = $("#countdown");
  if (cd) {
    var nxt = upcoming()[0], box = $("#next-event");
    if (!nxt) { if (box) box.hidden = true; }
    else {
      $("#next-title").textContent = nxt.t;
      var nd = dt(nxt);
      $("#next-meta").textContent = nd.getDate() + " " + AYLAR_UZUN[nd.getMonth()] + " " + GUNLER[nd.getDay()] + ", " + saat(nd) + " · " + nxt.yer;
      var tick = function () {
        var ms = Math.max(0, dt(nxt) - new Date()), s = Math.floor(ms / 1000);
        var vals = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
        $$("b", cd).forEach(function (b, i) { b.textContent = String(vals[i]).padStart(2, "0"); });
      };
      tick(); setInterval(tick, 1000);
    }
  }

  /* ---------------- Modal ---------------- */
  var modal = $("#modal"), lastFocus;
  function openModal(id) {
    var e = EVENTS.filter(function (x) { return x.id === id; })[0];
    if (!e || !modal) return;
    var d = dt(e), cat = CATS[e.c], kalan = e.kap - e.dolu;
    $(".modal-content", modal).innerHTML =
      '<span class="event-cat" style="--c:' + cat.renk + '">' + cat.ad + '</span>' +
      '<h2 id="modal-title">' + e.t + '</h2><p>' + e.acik + '</p>' +
      '<ul class="event-info">' +
      '<li>' + ICON.cal + d.getDate() + ' ' + AYLAR_UZUN[d.getMonth()] + ' ' + d.getFullYear() + ', ' + GUNLER[d.getDay()] + ' · ' + saat(d) + '</li>' +
      '<li>' + ICON.clock + 'Süre: ' + e.sure + '</li>' +
      '<li>' + ICON.pin + e.yer + '</li>' +
      '<li>' + ICON.lvl + e.seviye + ' · ' + kalan + ' / ' + e.kap + ' yer boş</li></ul>' +
      '<div class="event-foot" style="border:0;padding:0"><span class="price">' + e.ucret + '</span>' +
      '<a class="btn" href="katil.html?etkinlik=' + e.id + '">Yerimi ayır ' + ICON.arrow + '</a></div>' +
      '<p class="form-note">Kayıt, <a href="katilim-kosullari.html">Etkinlik Katılım Koşulları</a>’nın kabulü anlamına gelir. Etkinlikten 48 saat öncesine kadar ücretsiz iptal.</p>';
    lastFocus = document.activeElement;
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(function () { $(".modal-close", modal).focus(); }, 50);
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-open]");
    if (t) { ev.preventDefault(); openModal(t.dataset.open); }
    if (ev.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeModal(); });

  /* ---------------- Formlar → Google Forms ----------------
     Ayarlar assets/js/forms-config.js dosyasındadır. Her form için Google
     Forms'un "önceden doldurulmuş bağlantısı" yapıştırılır; bağlantıdaki
     cevaplar sitedeki alan adlarıdır (ad, eposta…). Bağlantı yoksa gönderim
     e-posta uygulamasıyla yapılır, böylece hiçbir başvuru kaybolmaz. */
  var CFG = window.HADI_FORMS || {}, FALLBACK_MAIL = CFG.yedekEposta || "info@hadietkinlikkulubu.com";
  var parsePrefill = function (link) {
    if (!link) return null;
    try {
      var u = new URL(link), map = {};
      u.searchParams.forEach(function (val, key) { if (/^entry\.\d+$/.test(key)) map[val.trim()] = key; });
      var action = u.origin + u.pathname.replace(/\/viewform$/, "/formResponse");
      return Object.keys(map).length ? { action: action, map: map } : null;
    } catch (e) { return null; }
  };
  var collect = function (form) {
    var data = {}, order = [];
    $$("[name]", form).forEach(function (el) {
      var k = el.name; if (order.indexOf(k) < 0) order.push(k);
      if (el.type === "checkbox") {
        var group = $$('[name="' + k + '"]', form);
        if (group.length > 1) { if (el.checked) data[k] = (data[k] ? data[k] + ", " : "") + el.value; else if (!(k in data)) data[k] = ""; }
        else data[k] = el.checked ? "Evet" : "Hayır";
      } else data[k] = el.value.trim();
    });
    return { data: data, order: order };
  };
  var sendForm = function (form) {
    var key = form.dataset.form, conf = parsePrefill(CFG[key]), c = collect(form);
    if (conf) {
      var fd = new FormData();
      Object.keys(conf.map).forEach(function (field) { if (field in c.data) fd.append(conf.map[field], c.data[field]); });
      var post = fetch(conf.action, { method: "POST", mode: "no-cors", body: fd }).then(function () { return "sent"; }, function () { return "sent"; });
      var timeout = new Promise(function (res) { setTimeout(function () { res("sent"); }, 6000); });
      return Promise.race([post, timeout]);
    }
    var labels = { uyelik: "Üyelik başvurusu", iletisim: "İletişim formu", bulten: "Bülten kaydı", oner: "Etkinlik önerisi", evsahibi: "Ev sahibi başvurusu" };
    var body = c.order.map(function (k) { return k + ": " + (c.data[k] || "-"); }).join("\n");
    location.href = "mailto:" + FALLBACK_MAIL + "?subject=" + encodeURIComponent((labels[key] || "Form") + " – hadietkinlikkulubu.com") + "&body=" + encodeURIComponent(body);
    return Promise.resolve("mail");
  };

  var MSG = { required: "Bu alan zorunludur.", email: "Geçerli bir e-posta adresi girin.", tel: "Geçerli bir telefon numarası girin." };
  var validate = function (form) {
    var ok = true, first = null;
    $$("[required]", form).forEach(function (inp) {
      var wrap = inp.closest(".field") || inp.closest(".check"), err = wrap && $(".err", wrap), m = "";
      if (inp.type === "checkbox") { if (!inp.checked) m = MSG.required; }
      else if (!inp.value.trim()) m = MSG.required;
      else if (inp.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inp.value)) m = MSG.email;
      else if (inp.type === "tel" && inp.value.replace(/\D/g, "").length < 10) m = MSG.tel;
      if (wrap) wrap.classList.toggle("invalid", !!m);
      if (err) err.textContent = m;
      inp.setAttribute("aria-invalid", !!m);
      if (m) { ok = false; if (!first) first = inp; }
    });
    if (!ok) first.focus();
    return ok;
  };
  $$("form[data-validate]").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!validate(form)) return;
      var btn = $("[type=submit]", form); if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = "Gönderiliyor…"; }
      sendForm(form).then(function (how) {
        var card = form.closest(".form-card");
        card.classList.add("form-done");
        if (how === "mail") { var note = $(".form-mailnote", card); if (note) note.hidden = false; }
        var nm = $("[name=ad]", form), who = $(".who", card);
        if (who && nm) who.textContent = nm.value.trim().split(" ")[0];
        card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
        form.dispatchEvent(new CustomEvent("hadi:sent", { detail: { how: how } }));
      });
    });
    $$("input, select, textarea", form).forEach(function (inp) {
      inp.addEventListener("input", function () { var w = inp.closest(".field") || inp.closest(".check"); if (w) w.classList.remove("invalid"); });
      inp.addEventListener("change", function () { var w = inp.closest(".field") || inp.closest(".check"); if (w) w.classList.remove("invalid"); });
    });
  });

  /* Bülten */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 3600);
  }
  window.hadiToast = toast;
  $$(".newsletter").forEach(function (f) {
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var i = $("input", f);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value)) { toast("Lütfen geçerli bir e-posta adresi girin."); i.focus(); return; }
      sendForm(f).then(function (how) {
        i.value = "";
        toast(how === "mail" ? "E-posta uygulamanız açıldı; gönderdiğinizde kaydınız tamamlanır." : "Bültene kaydoldunuz. Yeni takvim ilk size gelecek.");
      });
    });
  });

  /* ---------------- Çerez bandı ve izne bağlı analitik ---------------- */
  var loadAnalytics = function () {
    var id = CFG.googleAnalyticsId;
    if (!id || window.__hadiGA) return;
    window.__hadiGA = true;
    var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id, { anonymize_ip: true });
  };
  var cookie = $("#cookie"), stored = null;
  try { stored = localStorage.getItem("hadi-cerez"); } catch (e) {}
  if (stored === "all") loadAnalytics();
  if (cookie && !stored) {
    setTimeout(function () { cookie.classList.add("show"); }, 1200);
    $$("[data-cookie]", cookie).forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem("hadi-cerez", b.dataset.cookie); } catch (e) {}
        cookie.classList.remove("show");
        if (b.dataset.cookie === "all") loadAnalytics();
      });
    });
  }
  $$("[data-cookie-reset]").forEach(function (b) {
    b.addEventListener("click", function () {
      try { localStorage.removeItem("hadi-cerez"); } catch (e) {}
      toast("Çerez tercihiniz sıfırlandı. Sayfayı yenilediğinizde yeniden seçebilirsiniz.");
    });
  });

  /* ---------------- Yasal sayfa içindekiler ---------------- */
  var tocLinks = $$(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var tio = new IntersectionObserver(function (en) {
      en.forEach(function (x) {
        if (x.isIntersecting) { tocLinks.forEach(function (a) { a.classList.remove("active"); }); var a = map[x.target.id]; if (a) a.classList.add("active"); }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    $$(".legal-body section[id]").forEach(function (s) { tio.observe(s); });
  }

  /* ---------------- Kurucular ---------------- */
  var stage = $(".fd-stage");
  if (stage) {
    var fdBtns = $$(".fd", stage), current = null, opener = null;
    var panelOf = function (b) { return document.getElementById(b.getAttribute("aria-controls")); };
    var fdOpen = function (btn, fromKey) {
      fdBtns.forEach(function (b) { b.setAttribute("aria-expanded", b === btn); panelOf(b).hidden = b !== btn; });
      stage.classList.add("is-open");
      current = btn; if (!opener) opener = btn;
      var pnl = panelOf(btn); $(".fd-text", pnl).scrollTop = 0;
      $(".fd-close", pnl).focus({ preventScroll: true });
      if (history.replaceState) history.replaceState(null, "", "#" + btn.dataset.id);
    };
    var fdClose = function () {
      if (!current) return;
      fdBtns.forEach(function (b) { b.setAttribute("aria-expanded", "false"); panelOf(b).hidden = true; });
      stage.classList.remove("is-open");
      (opener || current).focus({ preventScroll: true });
      current = null; opener = null;
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    };
    fdBtns.forEach(function (b) { b.addEventListener("click", function () { opener = b; fdOpen(b); }); });
    $$("[data-fd-close]", stage).forEach(function (el) { el.addEventListener("click", fdClose); });
    $$("[data-fd-step]", stage).forEach(function (el) {
      el.addEventListener("click", function () {
        var i = fdBtns.indexOf(current), n = fdBtns.length;
        fdOpen(fdBtns[(i + parseInt(el.dataset.fdStep, 10) + n) % n]);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (!current) return;
      if (e.key === "Escape") fdClose();
      if (e.key === "ArrowRight") { e.preventDefault(); fdOpen(fdBtns[(fdBtns.indexOf(current) + 1) % fdBtns.length]); }
      if (e.key === "ArrowLeft") { e.preventDefault(); fdOpen(fdBtns[(fdBtns.indexOf(current) - 1 + fdBtns.length) % fdBtns.length]); }
    });
    var fromHash = location.hash && $('.fd[data-id="' + location.hash.slice(1) + '"]', stage);
    if (fromHash) fdOpen(fromHash);

    /* V çizgisi: Gül → Mehmet → Tolgahan → Ersel → Tuğçe */
    var pyr = $(".fd-pyramid", stage), svg = $(".fd-lines", stage), path = $("path", svg);
    var drawLines = function () {
      var pr = pyr.getBoundingClientRect();
      var c = $$(".fd-photo", pyr).map(function (ph) { var r = ph.getBoundingClientRect(); return [r.left - pr.left + r.width / 2, r.top - pr.top + r.height / 2]; });
      if (c.length < 5) return;
      svg.setAttribute("viewBox", "0 0 " + pr.width + " " + pr.height);
      path.setAttribute("d", "M" + [c[0], c[2], c[4], c[3], c[1]].map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L"));
    };
    drawLines();
    window.addEventListener("resize", drawLines);
    window.addEventListener("load", drawLines);
  }

  /* Yıl */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
