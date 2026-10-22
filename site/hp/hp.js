/* Elmas yükleme (web). Firebase ayarları ../panel/config.js'ten okunur (yalnızca okunur).
   Sunucu: `payments` çağrısı (functions/src/payments.ts). Tutar ve Elmas her zaman sunucuda belirlenir. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tl = (n) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " TL";
  const hp = (n) => Number(n).toLocaleString("tr-TR") + " Elmas";
  const page = document.body.dataset.page;
  const errText = (e) => (e && (e.message || e.code)) ? String(e.message || e.code).replace(/^.*?:\s*/, "") : "Bir sorun oldu.";

  if (!window.HADI_FIREBASE || !window.HADI_FIREBASE.apiKey) {
    const c = $("#cfgErr");
    if (c) c.classList.remove("hide");
    return;
  }
  firebase.initializeApp(window.HADI_FIREBASE);
  const auth = firebase.auth();
  auth.languageCode = "tr";
  const fns = firebase.app().functions(window.HADI_REGION || "europe-west1");
  const call = async (data) => (await fns.httpsCallable("payments", { timeout: 60000 })(data)).data;

  // ------------------------------------------------------------ sonuç sayfaları
  if (page === "ok" || page === "fail") {
    const q = new URLSearchParams(location.search);
    const orderId = q.get("o") || "";
    const out = $("#result");
    // Kartla ödeme (fiziksel ürün/hizmet ya da "Kart ekle"; functions/src/card_pay.ts): dönüş ?k=card&o=cp_…&s=<durum>.
    if (q.get("k") === "card") {
      const s = q.get("s") || "";
      let back = "";
      try { back = sessionStorage.getItem("hadi_card_back") || ""; sessionStorage.removeItem("hadi_card_back"); } catch (_) { /* yok */ }
      const link = back && back.startsWith(location.origin) ? ` <a href="${esc(back)}">Ödeme yöntemlerime dön</a>` : "";
      if (page === "fail") {
        out.innerHTML = (s === "refunded"
          ? "Ödemen alındı ancak işlem tamamlanamadığı için kartına iade edildi."
          : s === "review" ? "Ödemen alındı; ek kontrol sonrası işlenecek."
          : "Kartla ödeme tamamlanmadı; kartından ücret alınmadı.") + link;
      } else {
        out.innerHTML = (s === "refunded"
          ? "Kartın doğrulandı; doğrulama tutarı iptal edildi."
          : "Kartla ödemen alındı. Uygulamaya dönebilirsin; işlemin otomatik tamamlanır.") + link;
      }
      return;
    }
    if (page === "fail") {
      const s = q.get("s");
      if (s === "review") out.textContent = "Ödemen alındı ancak ek kontrol gerekiyor. Elmas, kontrol sonrası hesabına eklenecek; sorun olursa info@hadietkinlikkulubu.com adresine yaz.";
      return;
    }
    auth.onAuthStateChanged(async (u) => {
      if (!u || !orderId) {
        out.textContent = "Ödemen alındı. Elmas birkaç saniye içinde uygulamadaki hesabına eklenir.";
        return;
      }
      for (let i = 0; i < 10; i++) {
        try {
          const r = await call({ op: "status", orderId });
          if (r.status === "paid") {
            out.innerHTML = `<b>${esc(hp(r.hp))}</b> hesabına eklendi (${esc(tl(r.tl))} · ${esc(r.label)}). Uygulamada bakiyen hemen güncellenir.`;
            return;
          }
          if (r.status === "failed") {
            location.replace("basarisiz.html?o=" + encodeURIComponent(orderId));
            return;
          }
          if (r.status === "review") {
            out.textContent = "Ödemen alındı ancak ek kontrol gerekiyor; Elmas kontrol sonrası eklenecek.";
            return;
          }
        } catch (e) {
          out.textContent = errText(e);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      out.textContent = "Ödeme onayı bekleniyor. Elmas onaylanınca hesabına eklenir; birkaç dakika içinde uygulamada görünmezse bize yaz.";
    });
    return;
  }

  // ------------------------------------------------------------ giriş
  let confirmation = null;
  let verifier = null;
  const loginErr = (m) => ($("#loginErr").textContent = m || "");
  $("#sendCode").onclick = async () => {
    loginErr("");
    let p = $("#phone").value.replace(/\D/g, "");
    if (p.startsWith("90")) p = p.slice(2);
    if (p.startsWith("0")) p = p.slice(1);
    if (!/^5\d{9}$/.test(p)) return loginErr("Numarayı 5xx xxx xx xx biçiminde yaz.");
    $("#sendCode").disabled = true;
    try {
      verifier = verifier || new firebase.auth.RecaptchaVerifier("recaptcha", { size: "invisible" });
      confirmation = await auth.signInWithPhoneNumber("+90" + p, verifier);
      $("#stepPhone").classList.add("hide");
      $("#stepCode").classList.remove("hide");
      $("#smsCode").focus();
    } catch (e) {
      loginErr("Kod gönderilemedi: " + errText(e));
    } finally {
      $("#sendCode").disabled = false;
    }
  };
  $("#verify").onclick = async () => {
    loginErr("");
    try {
      await confirmation.confirm($("#smsCode").value.trim());
    } catch (e) {
      loginErr("Kod hatalı ya da süresi doldu.");
    }
  };
  $("#redeem").onclick = async () => {
    loginErr("");
    const code = $("#appCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) return loginErr("Kod 8 karakter olmalı.");
    $("#redeem").disabled = true;
    try {
      const r = await call({ op: "redeemCode", code });
      await auth.signInWithCustomToken(r.token);
    } catch (e) {
      loginErr(errText(e));
    } finally {
      $("#redeem").disabled = false;
    }
  };
  $("#logout").onclick = () => auth.signOut();

  // ------------------------------------------------------------ paketler
  let unsubWallet = null;
  auth.onAuthStateChanged(async (u) => {
    if (unsubWallet) { unsubWallet(); unsubWallet = null; }
    $("#logout").classList.toggle("hide", !u);
    $("#who").textContent = u ? (u.phoneNumber || "Giriş yapıldı") : "";
    if (!u) {
      $("#shop").classList.add("hide");
      $("#login").classList.remove("hide");
      $("#stepPhone").classList.remove("hide");
      $("#stepCode").classList.add("hide");
      return;
    }
    $("#login").classList.add("hide");
    $("#shop").classList.remove("hide");
    $("#channels").innerHTML = '<p class="muted">Ödeme yöntemleri yükleniyor…</p>';
    try {
      unsubWallet = firebase.firestore().doc("wallets/" + u.uid).onSnapshot((d) => {
        const b = d.exists ? d.data().balance : null;
        $("#balance").classList.toggle("hide", b == null);
        if (b != null) $("#balance").textContent = "Bakiyen: " + hp(b);
      }, () => {});
    } catch (_) { /* bakiye gösterimi isteğe bağlı */ }
    try {
      const r = await call({ op: "channels", platform: "web" });
      render(r.channels || []);
    } catch (e) {
      $("#channels").innerHTML = "";
      $("#shopErr").textContent = errText(e);
    }
  });

  function render(list) {
    $("#empty").classList.toggle("hide", list.length > 0);
    $("#channels").innerHTML = list.map((c) => `
      <section class="hp-card hp-chan" data-ch="${esc(c.id)}">
        <h2>${esc(c.label)}${c.sandbox ? ' <span class="hp-tag">TEST MODU · gerçek ödeme alınmaz</span>' : ""}</h2>
        ${c.note ? `<p class="muted small">${esc(c.note)}</p>` : ""}
        <div class="hp-pkgs">
          ${c.packages.map((p) => `<button class="hp-pkg" type="button" data-ch="${esc(c.id)}" data-pkg="${esc(p.id)}"><b>${esc(hp(p.hp))}</b><span>${esc(tl(p.tl))} → ${esc(hp(p.hp))}</span></button>`).join("")}
        </div>
        ${c.custom ? `<div class="hp-custom">
          <div><label for="amt-${esc(c.id)}">Tutar (${esc(tl(c.custom.minTl))} – ${esc(tl(c.custom.maxTl))})</label>
          <input id="amt-${esc(c.id)}" type="number" min="${c.custom.minTl}" max="${c.custom.maxTl}" step="1" data-rate="${c.custom.hpPerTry}" placeholder="TL"></div>
          <div>= <output id="out-${esc(c.id)}">0 Elmas</output></div>
          <button class="btn btn--h btn--sm" type="button" data-ch="${esc(c.id)}" data-custom="1">Öde</button>
        </div>` : ""}
      </section>`).join("");
    document.querySelectorAll(".hp-custom input").forEach((i) => {
      i.addEventListener("input", () => {
        const v = Number(i.value) || 0;
        $("#out-" + i.id.slice(4)).textContent = hp(Math.floor(v * Number(i.dataset.rate)));
      });
    });
    document.querySelectorAll("#channels [data-ch][data-pkg], #channels [data-custom]").forEach((b) => (b.onclick = () => pay(b)));
  }

  async function pay(btn) {
    $("#shopErr").textContent = "";
    if (!$("#consent").checked) {
      $("#shopErr").textContent = "Devam etmek için ön bilgilendirme ve mesafeli satış sözleşmesini onayla.";
      $("#consent").focus();
      return;
    }
    const data = { op: "start", channel: btn.dataset.ch, platform: "web" };
    if (btn.dataset.custom) {
      const v = Number($("#amt-" + btn.dataset.ch).value);
      if (!v) return ($("#shopErr").textContent = "Tutar gir.");
      data.tl = v;
    } else {
      data.packageId = btn.dataset.pkg;
    }
    document.querySelectorAll("#channels button").forEach((b) => (b.disabled = true));
    try {
      const r = await call(data);
      location.assign(r.redirectUrl);
    } catch (e) {
      $("#shopErr").textContent = errText(e);
      document.querySelectorAll("#channels button").forEach((b) => (b.disabled = false));
    }
  }
})();
