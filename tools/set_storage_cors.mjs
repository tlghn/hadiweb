// Firebase Storage kovasına web uygulamaları için CORS (yalnızca okuma) izni verir — gcloud / Cloud Shell gerekmez.
// Bilgisayarda zaten oturum açık olan Firebase CLI'nin (firebase login; fonksiyon yayınlarında kullanılan) yetkisini kullanır;
// hiçbir anahtar ya da parola istemez, hiçbir yere yazmaz. İzin listesi: tools/storage_cors.json.
//   node tools\set_storage_cors.mjs           → uygula ve sonucu göster
//   node tools\set_storage_cors.mjs --show    → yalnızca mevcut ayarı göster
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "hadi-a0db3.firebasestorage.app";
const here = path.dirname(fileURLToPath(import.meta.url));
const show = process.argv.includes("--show");

function fail(msg) {
  console.error("HATA: " + msg);
  process.exit(1);
}

// Firebase CLI'nin kayıtlı oturumu (firebase login).
const cfgPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
if (!fs.existsSync(cfgPath)) fail(`Firebase CLI oturumu bulunamadı (${cfgPath}). Önce: firebase login`);
const refresh = JSON.parse(fs.readFileSync(cfgPath, "utf8"))?.tokens?.refresh_token;
if (!refresh) fail("Firebase CLI oturumu yok. Önce: firebase login");

// Firebase CLI'nin kendi OAuth istemci kimliği (kurulu firebase-tools paketinden okunur).
let api;
try {
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  const req = createRequire(path.join(globalRoot, "firebase-tools", "package.json"));
  api = req("./lib/api.js");
} catch {
  fail("Global firebase-tools bulunamadı (npm i -g firebase-tools).");
}
const val = (x) => (typeof x === "function" ? x() : x);
const clientId = val(api.clientId);
const clientSecret = val(api.clientSecret);
if (!clientId || !clientSecret) fail("firebase-tools istemci kimliği okunamadı (sürüm uyumsuz).");

const tr = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }),
});
const tok = await tr.json();
if (!tok.access_token) fail("Erişim anahtarı alınamadı: " + JSON.stringify(tok).slice(0, 200) + " — firebase login --reauth deneyin.");
const auth = { Authorization: "Bearer " + tok.access_token };
const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}?fields=cors`;

if (!show) {
  const cors = JSON.parse(fs.readFileSync(path.join(here, "storage_cors.json"), "utf8"));
  const r = await fetch(url, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ cors }) });
  if (!r.ok) fail(`Kova güncellenemedi (${r.status}): ${(await r.text()).slice(0, 300)}`);
  console.log("CORS ayarlandı. Birkaç dakika içinde geçerli olur; sayfayı yenile.");
}
const g = await fetch(url, { headers: auth });
console.log(JSON.stringify(await g.json(), null, 2));
