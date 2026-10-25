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
// AudioWorklet yoksa (eski WebView) yalnızca EQ + tremolo uygulanır (perde/formant yok).

const WORKLET_SRC = String.raw`
// HADİ voicefx işlemcisi — faz vokoderi + kepstral formant kaydırma (HADİ'nin kendi kodu).
class HadiFFT {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = Math.sin(2 * Math.PI * i / n); }
  }
  // Yerinde karmaşık FFT. inv=true: ters (1/n ölçekli).
  run(re, im, inv) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    const sg = inv ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cos[k], wi = sg * this.sin[k];
          const a = i + j, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inv) { const s = 1 / n; for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } }
  }
}

class HadiVoiceFx extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 1, minValue: 0.6, maxValue: 1.6, automationRate: 'k-rate' },
      { name: 'breath', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    const N = sampleRate > 32000 ? 1024 : 512, H = N / 4, K = N / 2 + 1;
    this.N = N; this.H = H; this.K = K;
    this.fft = new HadiFFT(N);
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    this.inF = new Float32Array(N); this.outF = new Float32Array(N); this.acc = new Float32Array(2 * N);
    this.rover = N - H;
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.cr = new Float32Array(N); this.ci = new Float32Array(N);
    this.mag = new Float32Array(K); this.frq = new Float32Array(K); this.env = new Float32Array(K);
    this.oMag = new Float32Array(K); this.oFrq = new Float32Array(K);
    this.lastPh = new Float32Array(K); this.sumPh = new Float32Array(K);
    this.lift = Math.max(8, Math.min(Math.round(sampleRate * 0.0016), N / 4)); // kepstrum kesimi ≈ 1,6 ms (perde periyodunun altı)
    this.seed = 12345;
    // Ses düzeyi dengeleyici: perde kaydırmada kareler arası faz uyumsuzluğu düzeyi düşürür (+4 st'de ≈ −4 dB).
    // Giriş ve çıkış enerjisi ~80 ms'lik kayan ortalamayla izlenir, çıkış girişin düzeyine çekilir (0,5–3 sınırlı).
    this.eIn = 0; this.eOut = 0; this.agc = 1;
    this.agcA = Math.exp(-128 / (sampleRate * 0.08));
    this.params = { pitch: 0, formant: 1, breath: 0 };
  }
  rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  frame() {
    const { N, H, K, re, im, cr, ci, win, mag, frq, env, oMag, oFrq, lastPh, sumPh } = this;
    const { pitch, formant, breath } = this.params;
    for (let i = 0; i < N; i++) { re[i] = this.inF[i] * win[i]; im[i] = 0; }
    this.fft.run(re, im, false);
    const TAU = 2 * Math.PI, expct = TAU * H / N, osamp = N / H;
    for (let k = 0; k < K; k++) {
      const m = Math.hypot(re[k], im[k]), ph = Math.atan2(im[k], re[k]);
      let d = ph - lastPh[k] - k * expct;
      lastPh[k] = ph;
      d -= TAU * Math.round(d / TAU);
      mag[k] = m;
      frq[k] = k + d * osamp / TAU; // gerçek frekans (kutu biriminde)
    }
    // Zarf: log genliğin kepstrumu, düşük quefrency süzgeci, geri.
    for (let k = 0; k < K; k++) { const l = Math.log(mag[k] + 1e-7); cr[k] = l; ci[k] = 0; if (k > 0 && k < N / 2) { cr[N - k] = l; ci[N - k] = 0; } }
    this.fft.run(cr, ci, true);
    const L = this.lift;
    for (let i = 1; i < N; i++) { if (i > L && i < N - L) { cr[i] = 0; ci[i] = 0; } }
    for (let i = 0; i < N; i++) ci[i] = 0;
    this.fft.run(cr, ci, false);
    for (let k = 0; k < K; k++) env[k] = Math.exp(cr[k]);
    // Perde: uyarımı yeniden yerleştir.
    const r = Math.pow(2, pitch / 12);
    oMag.fill(0); oFrq.fill(0);
    for (let k = 0; k < K; k++) {
      const j = Math.round(k * r);
      if (j >= K) break;
      const e = mag[k] / (env[k] + 1e-9);
      if (e > oMag[j]) oFrq[j] = frq[k] * r; // en güçlü katkının frekansı
      oMag[j] += e;
    }
    // Formant kaydırılmış zarf ile birleştir, faz biriktir, (ayna simetrik) ters dönüşüm.
    const fr = Math.max(0.6, Math.min(1.6, formant));
    const bk = Math.round(1800 / (sampleRate / N));
    for (let k = 0; k < K; k++) {
      const src = k / fr, i0 = Math.floor(src), a = src - i0;
      const ev = i0 + 1 < K ? env[i0] * (1 - a) + env[i0 + 1] * a : env[K - 1] * 0.2;
      let m = oMag[k] * ev;
      sumPh[k] += oFrq[k] * expct;
      sumPh[k] -= TAU * Math.floor(sumPh[k] / TAU);
      let x = m * Math.cos(sumPh[k]), y = m * Math.sin(sumPh[k]);
      if (breath > 0 && k > bk) { const n = breath * 0.35 * ev * this.rnd(), p = TAU * this.rnd(); x += n * Math.cos(p); y += n * Math.sin(p); }
      re[k] = x; im[k] = y;
      if (k > 0 && k < N / 2) { re[N - k] = x; im[N - k] = -y; }
    }
    im[0] = 0; im[N / 2] = 0;
    this.fft.run(re, im, true);
    const g = 1 / 1.5; // Hann² örtüşme toplamı (adım N/4) = 1,5
    for (let i = 0; i < N; i++) this.acc[i] += re[i] * win[i] * g;
    for (let i = 0; i < H; i++) this.outF[i] = this.acc[i];
    this.acc.copyWithin(0, H, 2 * N);
    this.acc.fill(0, 2 * N - H);
    this.inF.copyWithin(0, H, N);
  }

  process(inputs, outputs, P) {
    const inp = inputs[0], out = outputs[0];
    const x = inp && inp[0];
    const y = out && out[0];
    if (!y) return true;
    this.params.pitch = P.pitch[0]; this.params.formant = P.formant[0]; this.params.breath = P.breath[0];
    const N = this.N, H = this.H, lat = N - H;
    let ei = 0, eo = 0;
    for (let i = 0; i < y.length; i++) {
      const v = x ? x[i] : 0;
      ei += v * v;
      this.inF[this.rover] = v;
      const o = this.outF[this.rover - lat];
      eo += o * o;
      y[i] = o;
      if (++this.rover >= N) { this.rover = lat; this.frame(); }
    }
    const A = this.agcA;
    this.eIn = this.eIn * A + ei * (1 - A);
    this.eOut = this.eOut * A + eo * (1 - A);
    const g0 = this.agc;
    if (this.eIn > 1e-9 && this.eOut > 1e-9) this.agc = Math.max(0.5, Math.min(3, Math.sqrt(this.eIn / this.eOut)));
    for (let i = 0, n = y.length; i < n; i++) y[i] *= g0 + (this.agc - g0) * (i / n);
    for (let c = 1; c < out.length; c++) out[c].set(y);
    return true;
  }
}
registerProcessor('hadi-voicefx', HadiVoiceFx);
`;

const _reg = new WeakMap(); // ctx → Promise<boolean>

/** İşlemciyi bağlama bir kez yükler (Blob URL; dış adres yok). AudioWorklet yoksa false. */
export function loadVoiceFx(ctx) {
  if (!ctx) return Promise.resolve(false);
  if (_reg.has(ctx)) return _reg.get(ctx);
  const p = (async () => {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); return true; } catch (e) { console.warn('[film3] ses filtresi yüklenemedi', e); return false; } finally { URL.revokeObjectURL(url); }
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
