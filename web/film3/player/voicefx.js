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
// durumda kuru yoldan çıkışa ulaşır (zincir işlemciyi beklemeden kuruludur). Mobil (25 Ekim): kip seçimi + bekçi, VoiceChain başı.

// İşlemcinin kaynağı: voicefx_worklet.js (aynı kökenli modül dosyası).

const _reg = new WeakMap(); // ctx → Promise<boolean>
const WORKLET_URL = new URL('./voicefx_worklet.js', import.meta.url).href;

/**
 * İşlemciyi bağlama bir kez yükler: önce aynı kökenli dosya (CSP 'self' izin verir), olmazsa dosyanın metni Blob URL'den
 * (CSP'siz ortamlar). Yüklenemezse false: zincir kuru yol + EQ ile çalar (ses kesilmez). Süre sınırı YOK: zincir işlemciyi
 * beklemez (o gelene dek kuru + EQ), telefonda ilk karelerde ana iş parçacığı gölgelendirici derlerken (10–30 sn) sabit
 * süre sınırı yanlışlıkla "yüklenemedi" deyip filtreyi kalıcı kapatıyordu.
 */
export function loadVoiceFx(ctx) {
  if (!ctx) return Promise.resolve(false);
  if (_reg.has(ctx)) return _reg.get(ctx);
  const p = (async () => {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
    try { await ctx.audioWorklet.addModule(WORKLET_URL); return true; } catch (e) {
      console.warn('[film3] ses filtresi (dosya) yüklenemedi', e);
    }
    let url = null;
    try {
      const src = await fetch(WORKLET_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
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

/**
 * Cihaza göre ses filtresi kipi: full (faz vokoderi N=1024), cheap (N/2, zarf iki karede bir), eq (işlemci yok: perde/formant
 * yok, karakter EQ'su + tremolo; yalnızca ≤ 1 GB bellek). Telefon/düşük donanım (≤ 4 çekirdek ya da ≤ 4 GB, dokunmatik) cheap
 * başlar; yalnızca dokunmatik olduğu için seçildiyse bekçi yer görünce full'a çıkar. ?fx=full|cheap|eq ile
 * zorlanabilir (tanı).
 */
export function pickFxMode() {
  try {
    const q = new URLSearchParams(location.search).get('fx');
    if (q === 'full' || q === 'cheap' || q === 'eq') return { mode: q, forced: true };
  } catch (_) {}
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const hc = nav.hardwareConcurrency || 8, dm = nav.deviceMemory || 8;
  let coarse = false;
  try { coarse = matchMedia('(pointer:coarse)').matches; } catch (_) {}
  if (dm <= 1) return { mode: 'eq', why: `hc=${hc} dm=${dm}` };
  if (hc <= 4 || dm <= 4) return { mode: 'cheap', why: `hc=${hc} dm=${dm}` };
  if (coarse) return { mode: 'cheap', up: true, why: 'dokunmatik' };
  return { mode: 'full', why: `hc=${hc} dm=${dm}` };
}

/**
 * Bölüm sesinin ses zinciri. `input`a kaynaklar bağlanır; `out` çıkış veri yolu.
 *
 * Konuşmanın çıkışa giden yolu işlemciye BAĞLI DEĞİLDİR: giriş → gecikme(LAT) → kuru → kapı → çıkış her zaman kuruludur;
 * ıslak yol (işlemci → EQ → tremolo) paraleldir ve bölüt sınırlarında 40 ms'de kuru ile çapraz geçer. İşlemci yalnızca
 * karakter konuşurken çalışır ('on'). Bekçi (watch + işlemcinin yarım saniyelik durum iletileri):
 *   · işlemci hata verirse (processorerror), NaN üretirse, girişi duyulur düzeydeyken çıkışı > 500 ms susarsa ya da hiç
 *     çalışmıyorsa (durum iletisi gelmiyor) → kalıcı atlanır: ıslak yol = gecikmiş kuru + EQ + tremolo (zamanlama aynı);
 *   · işlem yükü yüksekse ya da ses saati duvar saatinin gerisinde kalıyorsa (tampon boşalması) → full → cheap → atla;
 *   · cheap'te (yalnızca dokunmatik olduğu için seçildiyse) 20 sn boyunca yük düşükse → full.
 */
export class VoiceChain {
  constructor(ctx, out, opt = {}) {
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
    this.dryDelay.connect(this.eq[0]); // işlemci gelene dek (ve atlandığında) ıslak yol = gecikmiş kuru + EQ
    this.log = []; // tanı/test: {t (film), ctxT, who, kind, wet, gate}
    this.errors = []; // tanı: son olaylar
    this.onEvent = opt.onEvent || null; // (tür, bilgi) → oynatıcı (tanı / audioError)
    const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext; // çevrimdışı: gerçek zaman yok → full
    const pick = opt.mode ? { mode: opt.mode, forced: true } : offline ? { mode: 'full', why: 'çevrimdışı' } : pickFxMode();
    this.mode = pick.mode === 'eq' ? 'eq' : 'loading';
    this.want = pick.mode; // full | cheap | eq
    this.why = pick.why || (pick.forced ? 'zorlandı' : '');
    this.canUp = !!pick.up;
    this.st = null; // işlemcinin son durum iletisi
    this.wd = { silentMs: 0, hot: 0, cool: 0, nan: 0, lastPerf: 0, lastCtx: 0, under: null, lag: 0, stall: 0, lastWatch: 0 };
    this.ready = pick.mode === 'eq' ? Promise.resolve(false) : loadVoiceFx(ctx).then((ok) => {
      if (!ok) { this._event('fx', 'işlemci yüklenemedi; EQ'); this.mode = 'eq'; return false; }
      if (this.mode === 'bypassed') return false;
      try {
        this.node = new AudioWorkletNode(ctx, 'hadi-voicefx', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: { mode: this.want } });
        const on = this.node.parameters.get('on');
        if (on) on.value = this._wetNow ? 1 : 0;
        this.node.port.onmessage = (e) => this._stat(e.data);
        this.node.onprocessorerror = (e) => this.bypass('processorerror', e);
        this.input.connect(this.node).connect(this.eq[0]);
        try { this.dryDelay.disconnect(this.eq[0]); } catch (_) {} // dryDelay → dry bağlantısı yerinde kalır
        this.mode = this.want;
        this._modeAt = performance.now();
        return true;
      } catch (e) { this._event('fx', 'işlemci kurulamadı: ' + (e && e.message)); this.mode = 'eq'; return false; }
    });
  }

  _event(kind, msg) {
    const e = { at: Math.round(performance.now()), kind, msg: String(msg) };
    this.errors.push(e);
    if (this.errors.length > 12) this.errors.shift();
    if (kind === 'fx') console.warn('[film3] ses filtresi:', msg);
    if (this.onEvent) { try { this.onEvent(kind, e); } catch (_) {} }
  }

  /** İşlemciyi kalıcı atlar: ıslak yol gecikmiş kuru + EQ + tremolo olur (zamanlama değişmez, konuşma susmaz). */
  bypass(reason, err) {
    if (this.mode === 'bypassed') return;
    const n = this.node;
    this.node = null;
    this.mode = 'bypassed';
    this.bypassWhy = reason;
    if (n) {
      try { n.port.onmessage = null; n.onprocessorerror = null; } catch (_) {}
      try { this.input.disconnect(n); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    }
    try { this.dryDelay.connect(this.eq[0]); } catch (_) {}
    this._event('fx', `işlemci atlandı (${reason})${err && err.message ? ': ' + err.message : ''}`);
  }

  _setMode(m) {
    if (!this.node || this.mode === m) return;
    try { this.node.port.postMessage({ mode: m }); } catch (_) {}
    this._event('mode', `${this.mode} → ${m}`);
    this.mode = m;
    this._modeAt = performance.now();
    this.wd.hot = 0; this.wd.cool = 0;
  }

  /** İşlemcinin durum iletisi (≈ 2/sn). */
  _stat(d) {
    if (!d || d.type !== 'st' || !this.node) return;
    this.st = { ...d, perf: performance.now() };
    const w = this.wd, sr = this.ctx.sampleRate;
    const actMs = (d.act * 128 * 1000) / sr;
    if (d.nan) { w.nan += d.nan; if (w.nan > 3) return this.bypass('NaN'); }
    // Sessizlik: giriş duyulur düzeyde (> −50 dBFS), çıkış girişten 30 dB+ düşük → 500 ms'yi aşarsa atla.
    const ri = Math.sqrt(d.ei || 0), ro = Math.sqrt(d.eo || 0);
    if (d.act && ri > 0.003 && ro < ri * 0.0316) { w.silentMs += actMs; if (w.silentMs > 500) return this.bypass('sessiz çıkış'); } else if (d.act) w.silentMs = 0;
    // Yük: işlemci açıkken ölçülen süre / geçen süre (ms çözünürlüğünde, ortalamada doğru).
    if (d.act > 20) {
      const load = d.load * (d.blocks / d.act); // açık olduğu süreye göre
      if (load > (this.mode === 'full' ? 0.45 : 0.6)) { if (++w.hot >= 2) { if (this.mode === 'full') this._setMode('cheap'); else return this.bypass('işlemci yükü'); } } else w.hot = 0;
      if (this.mode === 'cheap' && this.canUp && load < 0.15) { w.cool += actMs; if (w.cool > 20000) { this.canUp = false; this._setMode('full'); } } else if (this.mode === 'cheap') w.cool = Math.max(0, w.cool - actMs);
    }
  }

  /**
   * Ana iş parçacığından (her ses planlamasında) çağrılır: işlemci hiç çalışmıyorsa ya da ses saati gerçek zamanın
   * gerisinde kalıyorsa (işleme yetişemiyor, tampon boşalıyor) kipi düşürür / atlar.
   */
  watch() {
    const ctx = this.ctx, w = this.wd;
    if (!this.node || ctx.state !== 'running') { w.lastPerf = 0; return; }
    const p = performance.now(), c = ctx.currentTime;
    // Durum iletisi gelmiyor (işlemcinin process'i çağrılmıyor): ses saati 4 sn ilerlediği hâlde son ileti eski.
    // (Ana iş parçacığı uzun durduysa — ilk karede gölgelendirici derleme — iletiler kuyrukta bekliyor olabilir: yalnızca
    // aralıkları < 1 sn olan art arda 3 denetimde de sürüyorsa.)
    const at = this.st ? this.st.at : this._bornCtx ?? (this._bornCtx = c);
    const steady = w.lastWatch && p - w.lastWatch < 1000;
    w.lastWatch = p;
    if (steady && c - at > 4) { if (++w.stall >= 3) return this.bypass('işlemci çalışmıyor'); } else w.stall = 0;
    // Tampon boşalması: Chrome'un oynatma istatistikleri (varsa) ya da ses saati / duvar saati oranı.
    const ps = ctx.playbackStats || ctx.playoutStats;
    const und = ps ? (ps.underrunEvents ?? ps.fallbackFramesEvents ?? null) : null;
    if (und != null) {
      if (w.under != null && und > w.under && this.st && this.st.act > 0) { if (this.mode === 'full') this._setMode('cheap'); else if (this.mode === 'cheap' && und - w.under > 2) return this.bypass('tampon boşalması'); }
      w.under = und;
    }
    if (!w.lastPerf) { w.lastPerf = p; w.lastCtx = c; return; }
    const dp = (p - w.lastPerf) / 1000;
    if (dp < 2) return;
    const ratio = (c - w.lastCtx) / dp;
    w.lastPerf = p; w.lastCtx = c;
    this.ratio = ratio;
    if (ratio < 0.9 && dp < 10) { // ana iş parçacığı uzun durduysa (dp büyük) ölçüm güvenilmez
      if (++w.lag >= 2) { w.lag = 0; if (this.mode === 'full') this._setMode('cheap'); else return this.bypass('ses saati geride'); }
    } else w.lag = 0;
  }

  /** Tanı: kısa durum. */
  info() {
    const st = this.st;
    return { mode: this.mode, want: this.want, why: this.bypassWhy || this.why, load: st && st.act ? Math.round(st.load * (st.blocks / st.act) * 100) : 0, on: st ? st.act > 0 : false, ratio: this.ratio ? Math.round(this.ratio * 1000) / 1000 : null, nan: this.wd.nan };
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
    const on = this.node && this.node.parameters.get('on');
    if (on) { try { on.cancelScheduledValues(at); } catch (_) {} }
  }

  /** İşlemciyi aç/kapat (giriş tarafı): açılış bölütten 120 ms önce (ısınma), kapanış kuru geçiş bittikten sonra. */
  _onAt(v, t) {
    const on = this.node && this.node.parameters.get('on');
    if (!on) return;
    const n0 = this.ctx.currentTime;
    t = Math.max(n0, t);
    try {
      if (v) { on.cancelScheduledValues(t); on.setValueAtTime(1, t); } // sonraki (bekleyen) kapanış silinir
      else on.setValueAtTime(0, t);
    } catch (_) {}
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
    this._wetNow = wetV;
    if (fx) this._onAt(1, now ? at : at - 0.12);
    else if (!now) this._onAt(0, o + X + 0.03);
    else this._onAt(0, at);
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
