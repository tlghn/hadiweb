// HADİ Film v3 — karakter ses filtresi işlemcisi (AudioWorklet modülü; voicefx.js yükler). HADİ'nin kendi kodu.
// Ayrı ve aynı kökenli dosyadır: hadisosyal.com CSP'si (script-src 'self', blob: YOK) Blob URL'den modül yüklemeyi engeller —
// 309'da işlemci bu yüzden hiç yüklenmiyordu (perde/formant yok; ses kuru yoldan sürdü). Faz vokoderi: voicefx.js başı.
// HADİ voicefx işlemcisi — faz vokoderi + kepstral formant kaydırma (HADİ'nin kendi kodu).
//
// 25 Ekim (mobil ses): işlemci yalnızca karakter konuşurken çalışır ('on' parametresi; anlatıda giriş gecikmeli olarak
// geçer, FFT yok — filmin büyük kısmında işlemci yükü ≈ 0). İki kip: full (N=1024 @48 kHz, adım N/4) ve cheap (N/2, zarf
// iki karede bir; ≈ %40 yük). Kipten bağımsız toplam gecikme sabittir (LAT = Nfull·3/4): kip değişince kuru yolun
// gecikmesi değişmez. NaN/sonsuz çıkış olursa durum sıfırlanır. Yarım saniyede bir ana iş parçacığına durum bildirir
// (giriş/çıkış enerjisi, NaN sayısı, işlem yükü) — voicefx.js'teki bekçi buna göre kipi düşürür ya da işlemciyi atlar.
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
    const n = this.n, rev = this.rev, C = this.cos, S = this.sin;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    const sg = inv ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = C[k], wi = sg * S[k];
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
      { name: 'on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(opt) {
    super();
    const po = (opt && opt.processorOptions) || {};
    this.NF = sampleRate > 32000 ? 1024 : 512;
    this.LAT = (this.NF * 3) / 4; // toplam gecikme (örnek), kipten bağımsız
    this.dl = new Float32Array(this.LAT + 1); // işlemci kapalıyken geçiş gecikme hattı
    this.dw = 0;
    this.seed = 12345;
    this.params = { pitch: 0, formant: 1, breath: 0 };
    this.st = { blocks: 0, act: 0, nan: 0, busy: 0, ei: 0, eo: 0, t0: Date.now() };
    this.want = po.mode === 'cheap' ? 'cheap' : 'full';
    this._cfg(this.want);
    this.wasOn = false;
    this.port.onmessage = (e) => { const d = e.data || {}; if (d.mode === 'full' || d.mode === 'cheap') this.want = d.mode; };
  }

  /** Kip kurulumu (yalnızca işlemci boştayken çağrılır). */
  _cfg(mode) {
    this.mode = mode;
    const N = mode === 'cheap' ? this.NF / 2 : this.NF, H = N / 4, K = N / 2 + 1;
    this.N = N; this.H = H; this.K = K;
    this.pad = this.LAT - (N - H); // cheap: toplam gecikme sabit kalsın diye ek gecikme
    this.pb = new Float32Array(this.pad + 1); this.pw = 0;
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
    this.envEvery = mode === 'cheap' ? 2 : 1; // cheap: zarf iki karede bir (formantlar yavaş değişir)
    this.fn = 0;
    // Ses düzeyi dengeleyici: perde kaydırmada kareler arası faz uyumsuzluğu düzeyi düşürür (+4 st'de ≈ −4 dB).
    // Giriş ve çıkış enerjisi ~80 ms'lik kayan ortalamayla izlenir, çıkış girişin düzeyine çekilir (0,5–3 sınırlı).
    this.eIn = 0; this.eOut = 0; this.agc = 1;
    this.agcA = Math.exp(-128 / (sampleRate * 0.08));
  }

  rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  frame() {
    const { N, H, K, re, im, cr, ci, win, mag, frq, env, oMag, oFrq, lastPh, sumPh } = this;
    const { pitch, formant, breath } = this.params;
    for (let i = 0; i < N; i++) { re[i] = this.inF[i] * win[i]; im[i] = 0; }
    this.fft.run(re, im, false);
    const TAU = 2 * Math.PI, expct = TAU * H / N, osamp = N / H;
    for (let k = 0; k < K; k++) {
      const a = re[k], b = im[k];
      const m = Math.sqrt(a * a + b * b), ph = Math.atan2(b, a); // (Math.hypot belirgin yavaş)
      let d = ph - lastPh[k] - k * expct;
      lastPh[k] = ph;
      d -= TAU * Math.round(d / TAU);
      mag[k] = m;
      frq[k] = k + d * osamp / TAU; // gerçek frekans (kutu biriminde)
    }
    // Zarf: log genliğin kepstrumu, düşük quefrency süzgeci, geri.
    if (this.fn++ % this.envEvery === 0) {
      for (let k = 0; k < K; k++) { const l = Math.log(mag[k] + 1e-7); cr[k] = l; ci[k] = 0; if (k > 0 && k < N / 2) { cr[N - k] = l; ci[N - k] = 0; } }
      this.fft.run(cr, ci, true);
      const L = this.lift;
      for (let i = 1; i < N; i++) { if (i > L && i < N - L) { cr[i] = 0; ci[i] = 0; } }
      for (let i = 0; i < N; i++) ci[i] = 0;
      this.fft.run(cr, ci, false);
      for (let k = 0; k < K; k++) env[k] = Math.exp(cr[k]);
    }
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
      const m = oMag[k] * ev;
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

  _report() {
    const s = this.st, now = Date.now(), el = now - s.t0;
    if (el < 500) return;
    try {
      this.port.postMessage({ type: 'st', mode: this.mode, blocks: s.blocks, act: s.act, nan: s.nan, load: s.busy / el, ei: s.act ? s.ei / (s.act * 128) : 0, eo: s.act ? s.eo / (s.act * 128) : 0, at: currentTime });
    } catch (_) {}
    this.st = { blocks: 0, act: 0, nan: 0, busy: 0, ei: 0, eo: 0, t0: now };
  }

  process(inputs, outputs, P) {
    const inp = inputs[0], out = outputs[0];
    const x = inp && inp[0];
    const y = out && out[0];
    if (!y) return true;
    const s = this.st;
    s.blocks++;
    if (!(P.on[0] > 0.5)) {
      // Kapalı (anlatı / sessizlik): giriş LAT gecikmeyle geçer, FFT yok. Kip değişikliği burada uygulanır.
      if (this.wasOn || this.want !== this.mode) { this._cfg(this.want); this.wasOn = false; }
      const dl = this.dl, L = dl.length, inF = this.inF, N = this.N, H = this.H, lat = N - H;
      for (let i = 0; i < y.length; i++) {
        const v = x ? x[i] : 0;
        dl[this.dw] = v;
        let r = this.dw - this.LAT; if (r < 0) r += L;
        y[i] = dl[r];
        if (++this.dw >= L) this.dw = 0;
        inF[this.rover] = v; // analiz penceresi sıcak tutulur (açılınca geçmiş hazır)
        if (++this.rover >= N) { this.rover = lat; inF.copyWithin(0, H, N); }
      }
      for (let c = 1; c < out.length; c++) out[c].set(y);
      this._report();
      return true;
    }
    const t0 = Date.now();
    this.wasOn = true;
    s.act++;
    this.params.pitch = P.pitch[0]; this.params.formant = P.formant[0]; this.params.breath = P.breath[0];
    const N = this.N, H = this.H, lat = N - H, pb = this.pb, PL = pb.length, pad = this.pad, dl = this.dl;
    let ei = 0, eo = 0;
    for (let i = 0; i < y.length; i++) {
      const v = x ? x[i] : 0;
      ei += v * v;
      dl[this.dw] = v; if (++this.dw >= dl.length) this.dw = 0; // geçiş hattı da beslenir (kapanınca kesintisiz)
      this.inF[this.rover] = v;
      let o = this.outF[this.rover - lat];
      if (pad > 0) { pb[this.pw] = o; let r = this.pw - pad; if (r < 0) r += PL; o = pb[r]; if (++this.pw >= PL) this.pw = 0; }
      eo += o * o;
      y[i] = o;
      if (++this.rover >= N) { this.rover = lat; this.frame(); }
    }
    if (!(eo < 1e9)) { // NaN / sonsuz: durum sıfırlanır, bu blok sessiz (bir sonraki karede toparlanır)
      s.nan++;
      this._cfg(this.mode);
      y.fill(0);
      eo = 0;
    }
    const A = this.agcA;
    this.eIn = this.eIn * A + ei * (1 - A);
    this.eOut = this.eOut * A + eo * (1 - A);
    const g0 = this.agc;
    if (this.eIn > 1e-9 && this.eOut > 1e-9) this.agc = Math.max(0.5, Math.min(3, Math.sqrt(this.eIn / this.eOut)));
    for (let i = 0, n = y.length; i < n; i++) y[i] *= g0 + (this.agc - g0) * (i / n);
    for (let c = 1; c < out.length; c++) out[c].set(y);
    s.ei += ei; s.eo += eo * this.agc * this.agc;
    s.busy += Date.now() - t0;
    this._report();
    return true;
  }
}
registerProcessor('hadi-voicefx', HadiVoiceFx);
