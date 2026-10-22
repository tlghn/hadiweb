/* HADİ — Ödeme yöntemlerim (web; uygulamadaki ekranla aynı). Sunucu: `cardPay` çağrısı (functions/src/card_pay.ts).
   Kart numarası bu sayfaya hiç girmez: kart ekleme iyzico'nun sayfasında yapılır. Firebase ayarları ../panel/config.js'ten
   (yalnızca okunur). Giriş akışı hp.js ile aynıdır (telefon ya da uygulamadan alınan 8 karakterlik kod). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const errText = (e) => (e && (e.message || e.code)) ? String(e.message || e.code).replace(/^.*?:\s*/, "") : "Bir sorun oldu.";
  const brand = (b) => ({ MASTER_CARD: "Mastercard", VISA: "Visa", TROY: "Troy", AMERICAN_EXPRESS: "Amex" }[b] || b || "Kart");

  if (!window.HADI_FIREBASE || !window.HADI_FIREBASE.apiKey) {
    $("#cfgErr").classList.remove("hide");
    return;
  }
  firebase.initializeApp(window.HADI_FIREBASE);
  const auth = firebase.auth();
  auth.languageCode = "tr";
  const fns = firebase.app().functions(window.HADI_REGION || "europe-west1");
  const pay = async (data) => (await fns.httpsCallable("payments", { timeout: 60000 })(data)).data;
  const card = async (data) => (await fns.httpsCallable("cardPay", { timeout: 60000 })({ clientPlatform: "web", ...data })).data;

  // ---- giriş (hp.js ile aynı)
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
      const r = await pay({ op: "redeemCode", code });
      await auth.signInWithCustomToken(r.token);
    } catch (e) {
      loginErr(errText(e));
    } finally {
      $("#redeem").disabled = false;
    }
  };
  $("#logout").onclick = () => auth.signOut();

  auth.onAuthStateChanged(async (u) => {
    $("#logout").classList.toggle("hide", !u);
    $("#who").textContent = u ? (u.phoneNumber || "Giriş yapıldı") : "";
    $("#login").classList.toggle("hide", !!u);
    $("#cardsBox").classList.toggle("hide", !u);
    if (u) load();
  });

  const err = (m) => ($("#err").textContent = m || "");

  async function load() {
    err("");
    $("#cards").innerHTML = '<p class="muted">Kartlar yükleniyor…</p>';
    try {
      render(await card({ op: "savedCards" }));
    } catch (e) {
      $("#cards").innerHTML = "";
      err(errText(e));
    }
  }

  function render(r) {
    const list = r.cards || [];
    const on = r.savedCardsOn !== false;
    $("#off").classList.toggle("hide", on);
    $("#add").classList.toggle("hide", !on);
    $("#empty").classList.toggle("hide", list.length > 0);
    if (r.error) err(r.error);
    $("#cards").innerHTML = list.map((c) => `
      <section class="hp-card" data-t="${esc(c.cardToken)}">
        <h2>${esc(c.alias)}${c.isDefault ? ' <span class="hp-tag">Varsayılan</span>' : ""}</h2>
        <p class="muted">${esc(brand(c.brand))} •••• ${esc(c.last4)}${c.bank ? " · " + esc(c.bank) : ""}${c.family ? " · " + esc(c.family) : ""}${c.expiry ? " · SKT " + esc(c.expiry) : ""}</p>
        <div class="hp-row" style="flex-wrap:wrap">
          ${on ? `<button class="btn btn--ghost btn--sm" type="button" data-act="default">${c.isDefault ? "Varsayılanı kaldır" : "Varsayılan yap"}</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="rename">Yeniden adlandır</button>` : ""}
          <button class="btn btn--ghost btn--sm" type="button" data-act="delete">Sil</button>
        </div>
      </section>`).join("");
    document.querySelectorAll("#cards [data-act]").forEach((b) => (b.onclick = () => act(b, list)));
  }

  async function act(btn, list) {
    const t = btn.closest("[data-t]").dataset.t;
    const c = list.find((x) => x.cardToken === t);
    if (!c) return;
    err("");
    try {
      if (btn.dataset.act === "delete") {
        if (!confirm(`${c.alias} (•••• ${c.last4}) iyzico'daki kayıtlı kartlarından silinsin mi?`)) return;
        render(await card({ op: "savedCardDelete", cardToken: t }));
      } else if (btn.dataset.act === "rename") {
        const a = prompt("Kartın adı (en çok 30 karakter)", c.alias);
        if (!a || !a.trim()) return;
        render(await card({ op: "savedCardAlias", cardToken: t, alias: a.trim().slice(0, 30) }));
      } else {
        render(await card({ op: "savedCardDefault", cardToken: c.isDefault ? null : t }));
      }
    } catch (e) {
      err(errText(e));
    }
  }

  $("#add").onclick = async () => {
    err("");
    $("#add").disabled = true;
    try {
      const r = await card({ op: "savedCardAdd", payMethod: "card" });
      if (r && r.cardPay && r.cardPay.paymentPageUrl) {
        // iyzico sayfası; dönüşte basarili.html?k=card → bu sayfaya geri bağlantı.
        try { sessionStorage.setItem("hadi_card_back", location.href); } catch (_) { /* yok */ }
        location.assign(r.cardPay.paymentPageUrl);
        return;
      }
      await load();
    } catch (e) {
      err(errText(e));
    } finally {
      $("#add").disabled = false;
    }
  };
})();
