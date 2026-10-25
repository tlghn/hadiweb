// HADİ Film v3 — karakter ses filtresi (gerçek zamanlı, cihazda). HADİ'nin kendi kodu; dış kütüphane/CDN yok.
//
// Bölüm TEK sesle (sesli kitabın anlatıcı sesi) okunur; konuşma bölütlerinde (audio.segs, kind:'say') bu ses konuşan
// karakterin ön ayarına (audio.fx[who] = {pitch, formant, eq[], breath, tremolo, tremRate}) göre o anda dönüştürülür.
// Asıl ses dosyası hiç değişmez (sesli kitapla ortak); anlatı bölütleri kuru (filtresiz) çalar.
//
// Zincir:  giriş ─┬─ gecikme(LAT) ─────────────────────────── kuru ─┐
//                 └─ ses-dönüştürücü (AudioWorklet) ─ EQ ─ tremolo ─ ıslak ─┴─ kapı (anlatıcı sesi aç/kapa) ─ çıkış
// Dönüştürücü: kısa süreli Fourier dönüşümü (Hann, N=1024 @48 kHz, adım N/4) üstünde faz vokoderi.
//   1) Her kutunun gerçek frekansı faz farkından bulunur.
//   2) Spektral zarf (formantlar) kepstrum süzgeciyle (düşük quefrency) çıkarılır; uyarım = genlik / zarf.
//   3) Perde: uyarım kutuları 2^(st/12) oranıyla yeniden yerleştirilir (süre değişmez, saat kaymaz).
//   4) Formant: zarf ayrıca `formant` oranıyla kaydırılır (>1 ince/çocuksu, <1 kalın/iri) — perdeden bağımsız.
//   5) İsteğe bağlı nefes: üst bantta zarfa uyan gürültü. Ters dönüşüm + örtüşerek toplama.
// Gecikme N−N/4 örnek (≈16 ms); kuru yol da aynı kadar geciktirilir, böylece 40 ms'lik kuru↔ıslak geçişleri temiz olur.
// AudioWorklet yoksa (eski WebView) ya da işlemci yüklenemezse yalnızca EQ + tremolo uygulanır (perde/formant yok); ses her
// durumda kuru yoldan çıkışa ulaşır (zincir işlemciyi beklemeden kuruludur).

// İşlemcinin kaynağı: voicefx_worklet.js (aynı kökenli modül dosyası).

const _reg = new WeakMap(); // ctx → Promise<boolean>
const WORKLET_URL = new URL('./voicefx_worklet.js', import.meta.url).href;

/**
 * İşlemciyi bağlama bir kez yükler: önce aynı kökenli dosya (CSP 'self' izin verir), olmazsa dosyanın metni Blob URL'den
 * (CSP'siz ortamlar). En çok 6 sn beklenir. Yüklenemezse false: zincir kuru yol + EQ ile çalar (ses kesilmez).
 */
export function loadVoiceFx(ctx) {
  if (!ctx) return Promise.resolve(false);
  if (_reg.has(ctx)) return _reg.get(ctx);
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);
  const p = (async () => {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
    try { await within(ctx.audioWorklet.addModule(WORKLET_URL), 8000); return true; } catch (e) {
      console.warn('[film3] ses filtresi (dosya) yüklenemedi', e);
      if (/zaman aşımı/.test(String(e && e.message))) return false; // yükleme sürüyor olabilir: aynı adı ikinci kez kaydetme
    }
    let url = null;
    try {
      const src = await within(fetch(WORKLET_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }), 6000);
      url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await within(ctx.audioWorklet.addModule(url), 6000);
      return true;
    } catch (e) { console.warn('[film3] ses filtresi yüklenemedi; kuru ses + EQ', e); return false; } finally { if (url) URL.revokeObjectURL(url); }
  })();
  _reg.set(ctx, p);
  return p;
}

/** Dönüştürücünün gecikmesi (sn): N − N/4 örnek. */
export const fxLatency = (rate) => ((rate > 32000 ? 1024 : 512) * 3) / 4 / rate;

// EQ: sabit topoloji (tüm değerler otomasyonla değişir; filtre türü değişmez). Nötr değerler etkisizdir.
const EQ_SLOTS = [
  { type: 'highpass', f: 20, q: 0.7, g: 0 },
  { type: 'lowshelf', f: 200, q: 0.7, g: 0 },
  { type: 'peaking', f: 1300, q: 1, g: 0 },
  { type: 'peaking', f: 3000, q: 1, g: 0 },
  { type: 'highshelf', f: 6000, q: 0.7, g: 0 },
  { type: 'lowpass', f: 20000, q: 0.7, g: 0 },
];

/** Karakter ön ayarını EQ yuvalarına dağıtır (aynı türden ikincisi sıradaki boş peaking yuvasına). */
export function eqSlotsOf(eq) {
  const s = EQ_SLOTS.map((x) => ({ ...x }));
  const used = new Set();
  for (const e of Array.isArray(eq) ? eq : []) {
    if (!e || !isFinite(+e.f)) continue;
    let i = s.findIndex((x, k) => x.type === e.type && !used.has(k));
    if (i < 0 && (e.type === 'lowshelf' || e.type === 'highshelf')) continue;
    if (i < 0) i = s.findIndex((x, k) => x.type === 'peaking' && !used.has(k));
    if (i < 0) continue;
    used.add(i);
    s[i] = { type: s[i].type, f: Math.max(20, Math.min(20000, +e.f)), q: Math.max(0.1, Math.min(18, +(e.q ?? s[i].q))), g: Math.max(-18, Math.min(18, +(e.g ?? 0))) };
  }
  return s;
}

/** Bir ön ayarı sınırlar içine alır; null → filtresiz (kuru). */
export function normFx(fx) {
  if (!fx || typeof fx !== 'object') return null;
  const c = (v, a, b, d) => (isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d);
  const o = {
    pitch: c(fx.pitch, -12, 12, 0), formant: c(fx.formant, 0.6, 1.6, 1), breath: c(fx.breath, 0, 1, 0),
    tremolo: c(fx.tremolo, 0, 0.6, 0), tremRate: c(fx.tremRate, 0.5, 12, 5), eq: eqSlotsOf(fx.eq),
  };
  const flat = Math.abs(o.pitch) < 0.05 && Math.abs(o.formant - 1) < 0.005 && !o.breath && !o.tremolo && o.eq.every((x, i) => x.f === EQ_SLOTS[i].f && x.g === EQ_SLOTS[i].g);
  return flat ? null : o;
}

/** Bölüm sesinin ses zinciri. `input`a kaynaklar bağlanır; `out` çıkış veri yolu. */
export class VoiceChain {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.lat = fxLatency(ctx.sampleRate);
    this.dryDelay = ctx.createDelay(0.2);
    this.dryDelay.delayTime.value = this.lat;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.gate = ctx.createGain();
    this.eq = EQ_SLOTS.map((s) => { const b = ctx.createBiquadFilter(); b.type = s.type; b.frequency.value = s.f; b.Q.value = s.q; b.gain.value = s.g; return b; });
    this.trem = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.trem.gain);
    try { this.lfo.start(); } catch (_) {}
    this.input.connect(this.dryDelay).connect(this.dry).connect(this.gate);
    for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
    this.eq[this.eq.length - 1].connect(this.trem).connect(this.wet).connect(this.gate);
    this.gate.connect(out);
    this.node = null; // AudioWorkletNode (yüklenince)
    this.dryDelay.connect(this.eq[0]); // geçici: işlemci gelene dek ıslak yol = gecikmiş kuru + EQ
    this.log = []; // tanı/test: {t (film), ctxT, who, kind, wet, gate}
    this.ready = loadVoiceFx(ctx).then((ok) => {
      if (!ok) return false;
      try {
        this.node = new AudioWorkletNode(ctx, 'hadi-voicefx', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
        this.input.connect(this.node).connect(this.eq[0]);
        this.dryDelay.disconnect(this.eq[0]); // dryDelay → dry bağlantısı yerinde kalır
        // İşlemci çalışırken hata verirse ıslak yol gecikmiş kuru + EQ'ya döner (karakter sesi susmaz).
        this.node.onprocessorerror = (e) => {
          console.warn('[film3] ses filtresi durdu; kuru ses + EQ', e);
          try { this.input.disconnect(this.node); this.node.disconnect(); } catch (_) {}
          this.node = null;
          try { this.dryDelay.connect(this.eq[0]); } catch (_) {}
        };
        return true;
      } catch (e) { console.warn('[film3] ses filtresi kurulamadı', e); return false; }
    });
  }

  _params() {
    const P = [this.wet.gain, this.dry.gain, this.gate.gain, this.trem.gain, this.lfoDepth.gain, this.lfo.frequency];
    for (const b of this.eq) P.push(b.frequency, b.Q, b.gain);
    if (this.node) for (const k of ['pitch', 'formant', 'breath']) P.push(this.node.parameters.get(k));
    return P;
  }

  /** [at] (bağlam saati) ve sonrasındaki planlı değişiklikleri siler. */
  cancel(at) {
    for (const p of this._params()) {
      try {
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
        else { const v = p.value; p.cancelScheduledValues(at); p.setValueAtTime(v, at); }
      } catch (_) {}
    }
  }

  /**
   * Bölüt sınırı: [at] bağlam saatinde (giriş tarafı) yeni durum. fx: normFx() sonucu ya da null (kuru);
   * gate: 0/1 (anlatıcı sesi kapalıysa anlatı bölütünde 0). now=true: geçişsiz, hemen.
   */
  set(at, fx, gate, now = false, info = null) {
    const X = now ? 0.004 : 0.02; // ±20 ms → 40 ms'lik geçiş
    const o = at + this.lat; // çıkış tarafı (kuru da ıslak da LAT gecikmeli)
    const rampAt = (p, v, t) => {
      // Geçişin başladığı ana kadarki değer korunur, sonra doğrusal geçiş.
      const n0 = this.ctx.currentTime, a0 = Math.max(n0, t - X), a1 = Math.max(a0 + 0.001, t + X);
      try { p.setValueAtTime(this._last.get(p) ?? p.value, a0); p.linearRampToValueAtTime(v, a1); } catch (_) {}
      this._last.set(p, v);
    };
    this._last = this._last || new Map();
    const wetV = fx ? 1 : 0;
    rampAt(this.wet.gain, wetV, o);
    rampAt(this.dry.gain, 1 - wetV, o);
    rampAt(this.gate.gain, gate, o);
    if (fx) {
      // Dönüştürücü değerleri giriş tarafında (bölüt başlamadan hemen önce), EQ ve tremolo çıkış tarafında.
      if (this.node) {
        rampAt(this.node.parameters.get('pitch'), fx.pitch, at - 0.01);
        rampAt(this.node.parameters.get('formant'), fx.formant, at - 0.01);
        rampAt(this.node.parameters.get('breath'), fx.breath, at - 0.01);
      }
      fx.eq.forEach((s, i) => { rampAt(this.eq[i].frequency, s.f, o); rampAt(this.eq[i].Q, s.q, o); rampAt(this.eq[i].gain, s.g, o); });
      rampAt(this.trem.gain, 1 - fx.tremolo / 2, o);
      rampAt(this.lfoDepth.gain, fx.tremolo / 2, o);
      rampAt(this.lfo.frequency, fx.tremRate, o);
    }
    if (info) {
      this.log.push({ ...info, ctxT: Math.round(o * 1000) / 1000, wet: wetV, gate, pitch: fx ? fx.pitch : 0, formant: fx ? fx.formant : 1 });
      if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    }
  }

  /** Durdurma/atlama: değişiklikler silinir, hemen [fx/gate] durumu. */
  reset(fx, gate) {
    const now = this.ctx.currentTime;
    this.cancel(now);
    this._last = new Map();
    this.set(now, fx, gate, true);
  }
}
