// HADİ Film v3 — Türkçe harf → visem kuralı (sunucudaki books_film3 ile aynı küme: Oculus 15 visem).
// Repliğin visem zamanları yoksa (ör. ses henüz hizalanmadı) metinden yaklaşık zaman çizelgesi üretilir.
// DOM'a bağımlı değildir: node ile de çalışır (demo.json üretimi).

export const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];

const MAP = {
  a: 'aa', â: 'aa', e: 'E', ı: 'I', i: 'I', î: 'I', o: 'O', ö: 'O', u: 'U', û: 'U', ü: 'U',
  b: 'PP', p: 'PP', m: 'PP', f: 'FF', v: 'FF', t: 'DD', d: 'DD', k: 'kk', g: 'kk', h: 'kk', ğ: null,
  c: 'CH', ç: 'CH', j: 'CH', ş: 'CH', s: 'SS', z: 'SS', n: 'nn', l: 'nn', r: 'RR', y: 'I',
};
const VOWEL = new Set(['aa', 'E', 'I', 'O', 'U']);

/** Metinden [[sn, visem], ...] üretir; toplam süre [dur] saniyeye yayılır (baş ve son sessiz). */
export function visemesFromText(text, dur) {
  const units = [];
  const s = String(text || '').toLocaleLowerCase('tr-TR');
  for (const ch of s) {
    if (ch in MAP) {
      const v = MAP[ch];
      if (v === null) { // yumuşak g: önceki ünlüyü uzatır
        if (units.length) units[units.length - 1].w += 0.6;
        continue;
      }
      units.push({ v, w: VOWEL.has(v) ? 1.0 : 0.62 });
    } else if (/[.!?…;:]/.test(ch)) {
      units.push({ v: 'sil', w: 1.6 });
    } else if (/[,—–-]/.test(ch)) {
      units.push({ v: 'sil', w: 0.9 });
    } else if (/\s/.test(ch)) {
      if (units.length && units[units.length - 1].v !== 'sil') units.push({ v: 'sil', w: 0.18 });
    }
  }
  const out = [[0, 'sil']];
  if (!units.length || !(dur > 0)) return out;
  const lead = Math.min(0.08, dur * 0.05), tail = Math.min(0.15, dur * 0.08);
  const span = Math.max(0.05, dur - lead - tail);
  const total = units.reduce((a, u) => a + u.w, 0);
  let t = lead;
  for (const u of units) {
    const last = out[out.length - 1];
    if (last[1] !== u.v) out.push([+t.toFixed(3), u.v]);
    t += (u.w / total) * span;
  }
  if (out[out.length - 1][1] !== 'sil') out.push([+(lead + span).toFixed(3), 'sil']);
  return out;
}

/** [t] anındaki (repliğin başına göre) visem ağırlıkları: önceki visemden 70 ms'lik geçiş. */
export function visemeWeightsAt(list, t, out = {}) {
  for (const k in out) out[k] = 0;
  if (!list || !list.length || t < 0) return out;
  let i = 0;
  // ikili arama
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (list[m][0] <= t) { i = m; lo = m + 1; } else hi = m - 1;
  }
  const cur = list[i][1];
  const prev = i > 0 ? list[i - 1][1] : 'sil';
  const k = Math.min(1, (t - list[i][0]) / 0.07);
  const amp = 0.85;
  if (cur !== 'sil') out[cur] = (out[cur] || 0) + amp * k;
  if (prev !== 'sil' && k < 1) out[prev] = (out[prev] || 0) + amp * (1 - k);
  return out;
}
