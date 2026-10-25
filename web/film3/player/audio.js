// HADİ Film v3 — ses ve ana saat. Filmin saati WebAudio saatidir (AudioContext.currentTime); bağlam askıdaysa
// (otomatik oynatma izni yok) performance.now ile sürer, ses açılınca kaldığı yerden WebAudio'ya geçer.
//
// v2 (25 Ekim, kurucu kararı): bölüm TEK sestir — sesli kitabın kendi sesi (film.audio: parçalar + beklemeler + konuşan
// bölütleri + karakter ses filtreleri). Parçalar tek bir zaman çizelgesi gibi boşluksuz çalar (örnek doğruluğunda
// planlama); beklemelerde (hold) ses kelime sınırında N sn durur, film sürer. Ses gelmediyse (indirme sürüyor) saat
// bekler: görüntü sesin önüne geçmez. Konuşma bölütlerinde konuşanın filtresi (voicefx.js) 40 ms'lik geçişle açılır,
// anlatı kuru çalar; "Anlatıcı sesi" kapalıysa anlatı bölütleri susar (müzik/efekt sürer, sahneler zamanında oynar).
// v1 filmler (replik başına ses: line.audio) eski yoldan çalar. Müzik sahneye bağlı döngü; seste müzik kısılır (ducking).
//
// 25 Ekim (mobil ses + anlaşılırlık):
//  · Parçalar sırayla indirilir (önce çalınacak olan; o gelene dek tek indirme), sabit 30 sn sınırı yerine "15 sn hiç veri
//    gelmezse" kesilir. Eskiden 5 parça aynı anda iner ve 30 sn'de kesilirdi: yavaş mobil bağlantıda (≈1 Mbit/sn) hepsi
//    aşıyor, üç denemeden sonra tüm konuşma sessiz geçiyordu (müzik/efekt Cache Storage'dan geldiği için çalıyordu).
//  · Çözme (decodeAudioData) tek tek ve 20 sn sınırlı; indirme iki kez ya da çözme bir kez başarısız olursa parça
//    HTMLAudioElement + MediaElementSource ile akıştan çalar (crossOrigin='anonymous'; kova CORS'u izin verir).
//  · Konuşma veri yolu: varlık EQ'su (3 kHz +2,5 dB) → hafif kompresör → +3 dB; ana çıkışta sınırlayıcı. Konuşma varken (ses zarfından, anlatı kapalıysa
//    yalnızca replikler) müzik ve ortam sesi −14 dB, kısa efektler −8 dB kısılır (atak ≈100 ms, önden 80 ms; bırakma ≈500 ms;
//    0,4 sn'den kısa kelime aralarında kısık kalır, cümle aralarında yumuşakça döner). Kısma örnek doğruluğunda planlanır.
//  · Tanı: diag() (oynatıcıda ?f3debug=1).

import { VoiceChain, normFx } from './voicefx.js';

const DUCK = { music: Math.pow(10, -14 / 20), amb: Math.pow(10, -14 / 20), short: Math.pow(10, -8 / 20), atk: 0.1 / 3, rel: 0.5 / 3, pre: 0.08, gap: 0.4 };
// 10 ms sessiz WAV (8 kHz, 8 bit): ses öğelerini dokunuşta açmak için.
const SILENT_WAV = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const within = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'zaman aşımı')), ms))]);

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Ses saati → film saati. start=true: o anda başlayan bekleme sayılmaz; false: sayılır (sunucuyla aynı kural). */
export function filmTimeOf(a, holds, start = true) {
  let f = a;
  for (const h of holds) if (h.at < a || (!start && h.at === a)) f += h.d;
  return f;
}

/** Film saati → ses saati (beklemenin içindeyse beklemenin noktası). */
export function audioTimeOf(f, holds) {
  let shift = 0;
  for (const h of holds) {
    const fs = h.at + shift;
    if (f < fs) break;
    if (f < fs + h.d) return h.at;
    shift += h.d;
  }
  return f - shift;
}

/** film.audio → oynatma planı (parçalar, beklemeler, parça×bekleme dilimleri, bölütler film saatinde). */
export function chapterPlan(au, urls) {
  if (!au || !Array.isArray(au.parts) || !au.parts.length) return null;
  let a0 = 0;
  const parts = au.parts.map((p, i) => { const o = { i, url: urls ? urls[i] || null : null, sec: Math.max(0, +p.sec || 0), a0 }; a0 += o.sec; return o; });
  const dur = a0;
  const holds = (au.holds || []).filter((h) => h && h.at > 0 && h.at < dur && h.d > 0).map((h) => ({ at: +h.at, d: Math.min(3, +h.d) })).sort((x, y) => x.at - y.at);
  const cuts = new Set([0, dur]);
  for (const p of parts) cuts.add(p.a0);
  for (const h of holds) cuts.add(h.at);
  const cs = [...cuts].filter((x) => x >= 0 && x <= dur).sort((x, y) => x - y);
  const holdAt = new Set(holds.map((h) => h.at));
  const pieces = [];
  for (let k = 0; k + 1 < cs.length; k++) {
    const a = cs[k], b = cs[k + 1];
    if (b - a < 1e-4) continue;
    const part = parts.find((p) => a >= p.a0 - 1e-6 && a < p.a0 + p.sec - 1e-6) || parts[parts.length - 1];
    pieces.push({ i: pieces.length, part: part.i, a, b, f: filmTimeOf(a, holds, false), off: a - part.a0, holdIn: holdAt.has(a), holdOut: holdAt.has(b) });
  }
  const fx = {};
  for (const [id, v] of Object.entries(au.fx || {})) fx[id] = normFx(v);
  const segs = (au.segs || []).map((s) => ({
    a0: +s.t0, a1: +s.t1, f0: filmTimeOf(+s.t0, holds, false), f1: filmTimeOf(+s.t1, holds, true), who: s.who, kind: s.kind === 'say' ? 'say' : 'narr', w0: s.w0, w1: s.w1,
  })).sort((x, y) => x.a0 - y.a0);
  return { parts, holds: holds.map((h) => ({ ...h, t: filmTimeOf(h.at, holds, true) })), pieces, segs, fx, dur, filmDur: dur + holds.reduce((s, h) => s + h.d, 0), has: parts.some((p) => p.url) };
}

export class FilmAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC({ latencyHint: 'playback' }) : null;
    this.errs = []; // tanı: son ses olayları/hataları
    if (this.ctx) {
      const ctx = this.ctx;
      this.master = ctx.createGain();
      // Son aşama sınırlayıcı: konuşma yükseltmesi + müzik + efekt toplamı 0 dBFS'i aşmasın (kırpma yok).
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
      this.master.connect(this.limiter).connect(ctx.destination);
      // Konuşma: varlık EQ'su → kompresör → yükseltme → ana çıkış
      this.voice = ctx.createGain();
      this.vPres = ctx.createBiquadFilter();
      this.vPres.type = 'peaking'; this.vPres.frequency.value = 3000; this.vPres.Q.value = 0.9; this.vPres.gain.value = 2.5;
      this.vComp = ctx.createDynamicsCompressor();
      this.vComp.threshold.value = -24; this.vComp.knee.value = 10; this.vComp.ratio.value = 3; this.vComp.attack.value = 0.006; this.vComp.release.value = 0.18;
      this.vMake = ctx.createGain();
      this.vMake.gain.value = Math.pow(10, 3 / 20);
      this.voice.connect(this.vPres).connect(this.vComp).connect(this.vMake).connect(this.master);
      // Efekt: ortam (uzun) ve kısa efektler ayrı kısılır; müzik kendi kısma düğümünden geçer.
      this.sfx = this._bus(0.8);
      this.duckA = this._bus(1.0, this.sfx);
      this.duckS = this._bus(1.0, this.sfx);
      this.duckM = this._bus(1.0);
      this.music = this._bus(1.0, this.duckM);
      ctx.onstatechange = () => this._ctxState();
    }
    this.playing = false;
    this.waiting = false; // bölüm sesi bekleniyor (saat durur)
    this.rate = 1;
    this.narration = true; // "Anlatıcı sesi"
    this._t0 = 0; // film saati (sabitleme anında)
    this._c0 = 0; // kaynak saati (sabitleme anında)
    this._src = null;
    this._lastT = 0;
    this.buffers = new Map(); // url → AudioBuffer | Promise | null
    this.active = new Map(); // olay anahtarı → {node, gain}
    this.musicNow = null; // {id, node, gain}
    this.events = []; // {key, t, d, url, bus, vol}
    this.ch = null; // bölüm sesi planı (v2)
    this.chain = null; // VoiceChain
    this._chSrc = new Map(); // dilim → {node, gain}
    this._chFresh = true;
    this._segNext = 0;
    this._stallAt = null; // bu film saatinde ses dilimi hazır değilse saat durur
    this.onState = null; // (durum) → oynatıcıya: 'buffering' | 'ready'
  }

  _bus(v, to) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(to || this.master);
    return g;
  }

  _err(kind, msg) {
    const e = { at: Math.round(performance.now()), kind, msg: String(msg && msg.message ? msg.message : msg) };
    this.errs.push(e);
    if (this.errs.length > 14) this.errs.shift();
    return e;
  }

  /** Bağlam askıya alındı / kesildi (çağrı, başka uygulama, 'interrupted'): çalan dilimler bırakılır, açılınca kaldığı yerden yeniden planlanır. */
  _ctxState() {
    const st = this.ctx.state;
    this._err('ctx', st);
    if (st !== 'running' && this.playing) {
      this._stopChapter();
      if (!document.hidden) { try { this.ctx.resume().catch(() => {}); } catch (_) {} }
    }
  }

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Kullanıcı dokunuşu / oynat: bağlamı açmayı dener. */
  async unlock() {
    this._blessMedia();
    if (!this.ctx || this.ctx.state === 'running') return this.unlocked;
    try { await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 400))]); } catch (_) {}
    return this.unlocked;
  }

  _nowOf(src) { return src === 'ctx' ? this.ctx.currentTime : performance.now() / 1000; }
  _curSrc() { return this.unlocked ? 'ctx' : 'perf'; }

  /** Sesin saati (planlama için; çıkış gecikmesi düşülmemiş). */
  _raw() {
    if (!this.playing || this.waiting) return this._t0;
    const src = this._curSrc();
    if (src !== this._src) { // saat kaynağı değişti (ses açıldı): kaldığı yerden sürer
      this._t0 = this._lastT;
      this._c0 = this._nowOf(src);
      this._src = src;
      this._chFresh = true;
      this._hold0 = true;
    }
    if (this._hold0 && src === 'ctx' && this.ch?.has) {
      // Bölüm sesi henüz planlanmadı (oynat/atla/ses açıldıktan sonraki ilk planlama yapılmadı: ilk kareler gölgelendirici
      // derlerken ana iş parçacığı meşgul olabilir): saat ilerlemez, anlatının başı atlanmaz.
      this._c0 = this._nowOf(src);
      this._lastT = this._t0;
      return this._t0;
    }
    this._lastT = this._t0 + (this._nowOf(src) - this._c0) * this.rate;
    if (this._stallAt != null && this._lastT >= this._stallAt) {
      // Sıradaki ses dilimi henüz çözülmedi: saat tam dilimin başında durur (görüntü sesin önüne geçmez).
      this._t0 = this._lastT = this._stallAt;
      this._stallAt = null;
      this.waiting = true;
      this._chFresh = true;
      if (this.onState) this.onState('buffering');
    }
    return this._lastT;
  }

  /** Filmin şimdiki saati (sn) — görüntü için: hoparlöre ulaşan an (çıkış gecikmesi düşülür, dudak senkronu). */
  time() {
    const t = this._raw();
    if (!this.playing || this.waiting || this._src !== 'ctx') return t;
    const lat = Math.min(0.15, Math.max(0, this.ctx.outputLatency || this.ctx.baseLatency || 0));
    return Math.max(this._tA ?? 0, t - lat * this.rate);
  }

  _anchor(t) {
    this._src = this._curSrc();
    this._t0 = this._lastT = this._tA = t;
    this._c0 = this._nowOf(this._src);
    this._chFresh = true;
    this._hold0 = true; // ilk _chTick'e kadar saat durur (yalnızca bölüm sesi varken ve ses açıkken)
  }

  play() { if (!this.playing) { this._anchor(this._t0); this.playing = true; } }
  pause() { if (this.playing) { this._t0 = this._raw(); this.playing = false; this.waiting = false; this._stallAt = null; this.stopAll(); } }
  seek(t) { this._anchor(Math.max(0, t)); this.waiting = false; this._stallAt = null; this.stopAll(); }
  setRate(r) { const t = this._raw(); this.rate = r; this._anchor(t); this.stopAll(); }

  /** "Anlatıcı sesi": kapalıyken anlatı bölütleri susar (konuşmalar, müzik, efekt sürer). */
  setNarration(on) {
    on = !!on;
    if (on === this.narration) return;
    this.narration = on;
    this._chFresh = true; // kapı planı şimdiden yeniden kurulur (çalan dilimler sürer)
    if (this.ctx && this.ch?.has) this._reduck();
  }

  /** Bölüm sesi dilimleri (tampon + akış) durur, kısma planı silinir. */
  _stopChapter() {
    for (const a of this._chSrc.values()) { try { a.node && a.node.stop(); } catch (_) {} }
    this._chSrc.clear();
    for (const m of (this._chMed || new Map()).values()) { try { if (!m.el.paused) m.el.pause(); } catch (_) {} m.pc = -1; }
    this._chFresh = true;
    this._unduck();
  }

  stopAll() {
    for (const a of this.active.values()) { try { a.node.stop(); } catch (_) {} }
    this.active.clear();
    this._stopChapter();
    if (this.musicNow) { try { this.musicNow.node.stop(); } catch (_) {} this.musicNow = null; }
  }

  // ---------------------------------------------------------------- kısma (ducking)

  _duckNodes() { return this.ctx ? [[this.duckM, DUCK.music], [this.duckA, DUCK.amb], [this.duckS, DUCK.short]] : []; }

  /** Planlı kısmalar silinir, düzey yumuşakça geri döner. */
  _unduck() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [n] of this._duckNodes()) {
      try { const v = n.gain.value; n.gain.cancelScheduledValues(now); n.gain.setValueAtTime(v, now); n.gain.setTargetAtTime(1, now, DUCK.rel); } catch (_) {}
    }
    this._duckEnd = 0;
    this._duckSpans = [];
  }

  /** Konuşma aralıkları (bağlam saatinde) için kısma planlar: [a,b] → a−80 ms'de atak, b'de bırakma. Sıralı ve çakışmasız eklenir. */
  _duckSpan(a, b) {
    if (b - a < 0.06) return;
    const now = this.ctx.currentTime;
    a = Math.max(now, a - DUCK.pre);
    if (b <= a) return;
    const L = this._duckSpans || (this._duckSpans = []);
    const last = L[L.length - 1];
    if (last && a <= last[1] + 0.05) { // önceki aralığa bitişik/çakışık: birleştir (bırakma yeniden planlanır)
      if (b <= last[1]) return;
      for (const [n] of this._duckNodes()) { try { n.gain.cancelScheduledValues(last[1]); } catch (_) {} }
      last[1] = b;
      for (const [n] of this._duckNodes()) { try { n.gain.setTargetAtTime(1, b, DUCK.rel); } catch (_) {} }
      return;
    }
    if (last && a < last[1]) a = last[1];
    L.push([a, b]);
    if (L.length > 64) L.splice(0, L.length - 64);
    for (const [n, lv] of this._duckNodes()) {
      try { n.gain.setTargetAtTime(lv, a, DUCK.atk); n.gain.setTargetAtTime(1, b, DUCK.rel); } catch (_) {}
    }
  }

  /** v1 (replik başına ses) için: kare başına konuşma bilgisiyle kısma. */
  _duckTick(speaking) {
    if (this._duckV1 === speaking) return;
    this._duckV1 = speaking;
    const now = this.ctx.currentTime;
    for (const [n, lv] of this._duckNodes()) { try { n.gain.cancelScheduledValues(now); n.gain.setTargetAtTime(speaking ? lv : 1, now, speaking ? DUCK.atk : DUCK.rel); } catch (_) {} }
  }

  /**
   * Parça tamponunun konuşma zarfı (parça saatinde [s,e] aralıkları): 20 ms RMS > max(−50 dBFS, %90'lık düzey − 26 dB);
   * 0,4 sn'den kısa boşluklar (kelime araları) birleştirilir.
   */
  _actOf(buf) {
    const C = this._acts || (this._acts = new WeakMap());
    if (C.has(buf)) return C.get(buf);
    const d = buf.getChannelData(0), sr = buf.sampleRate, W = Math.max(1, Math.round(sr * 0.02));
    const n = Math.floor(d.length / W);
    const rms = new Float32Array(n);
    for (let k = 0; k < n; k++) { let s = 0; for (let i = k * W, e = i + W; i < e; i++) s += d[i] * d[i]; rms[k] = Math.sqrt(s / W); }
    const sorted = Array.from(rms).filter((x) => x > 1e-5).sort((x, y) => x - y);
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
    const TH = Math.max(Math.pow(10, -50 / 20), p90 * Math.pow(10, -26 / 20));
    const out = [];
    let s0 = -1;
    for (let k = 0; k <= n; k++) {
      const on = k < n && rms[k] > TH;
      if (on && s0 < 0) s0 = k;
      if (!on && s0 >= 0) {
        const a = (s0 * W) / sr, b = (k * W) / sr;
        const last = out[out.length - 1];
        if (last && a - last[1] < DUCK.gap) last[1] = b; else out.push([a, b]);
        s0 = -1;
      }
    }
    const res = out.filter(([a, b]) => b - a >= 0.08);
    C.set(buf, res);
    return res;
  }

  /** Bir bölüm sesi diliminin kısma planı: konuşma zarfı ∩ duyulan bölütler (anlatı kapalıysa yalnızca replikler). */
  _duckPiece(pc, buf, when, startOff, endOff) {
    const ch = this.ch, part = ch.parts[pc.part], r = this.rate;
    const acts = buf ? this._actOf(buf) : [[startOff, endOff]];
    const a0 = part.a0; // parça → ses saati
    for (const [s, e] of acts) {
      const x0 = Math.max(s, startOff), x1 = Math.min(e, endOff);
      if (x1 - x0 < 0.05) continue;
      // Duyulan bölütlerle kesişim (ses saatinde)
      let k = this._segIdx(a0 + x0);
      for (; k < ch.segs.length; k++) {
        const sg = ch.segs[k];
        if (sg.a0 >= a0 + x1) break;
        if (this._gateOf(sg) === 0) continue;
        const y0 = Math.max(x0, sg.a0 - a0), y1 = Math.min(x1, sg.a1 - a0);
        if (y1 - y0 < 0.05) continue;
        this._duckSpan(when + (y0 - startOff) / r + this._duckLat(), when + (y1 - startOff) / r + this._duckLat());
      }
      if (!ch.segs.length) this._duckSpan(when + (x0 - startOff) / r + this._duckLat(), when + (x1 - startOff) / r + this._duckLat());
    }
  }

  /** Konuşma zincirinin gecikmesi (kuru/ıslak yol LAT gecikmeli çıkar). */
  _duckLat() { return this.chain ? this.chain.lat : 0; }

  /** Anlatıcı sesi değişince planlı kısmalar şimdiden yeniden kurulur (çalan dilimler için). */
  _reduck() {
    this._unduck();
    for (const [k, a] of this._chSrc) {
      if (!a.node || a.done) continue;
      const pc = this.ch.pieces[k];
      const buf = this._partBuf(pc.part);
      if (pc && buf) this._duckPiece(pc, buf, a.when, a.startOff, a.startOff + a.playLen);
    }
  }

  /** Arka planda indirip çözer (CORS yoksa sessiz geçer). */
  preload(url, fetcher) {
    if (!url || !this.ctx || this.buffers.has(url)) return this.buffers.get(url);
    const p = (async () => {
      try {
        const ab = await (fetcher ? fetcher(url) : fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
        const buf = await this.ctx.decodeAudioData(ab.slice(0));
        this.buffers.set(url, buf);
        return buf;
      } catch (e) {
        console.warn('[film3] ses yüklenemedi', url, e);
        this.buffers.set(url, null);
        return null;
      }
    })();
    this.buffers.set(url, p);
    return p;
  }

  /** Repliğin anlamlı sonu (sn): son −45 dBFS üstü örnek + 40 ms (tampon başına bir kez hesaplanır). */
  _tail(buf) {
    const C = this._tails || (this._tails = new WeakMap());
    if (C.has(buf)) return C.get(buf);
    const TH = Math.pow(10, -45 / 20); // ≈ 0,0056
    let last = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > TH) { last = i; break; }
    }
    const end = last > 0 ? Math.min(buf.duration, last / buf.sampleRate + 0.04) : buf.duration;
    C.set(buf, end);
    return end;
  }

  /**
   * Bölüm sesi parçasının konuşma sonu (sn): eski (kaynağında temizlenmemiş) parçaların sonundaki TTS hışırtısı için.
   * 20 ms pencerelerin RMS'i; eşik = max(−45 dBFS, konuşmanın %90'lık düzeyi − 26 dB). Yalnızca son 1,5 sn'ye bakılır.
   */
  _partTail(buf) {
    const C = this._ptails || (this._ptails = new WeakMap());
    if (C.has(buf)) return C.get(buf);
    const d = buf.getChannelData(0), sr = buf.sampleRate, W = Math.max(1, Math.round(sr * 0.02));
    const n = Math.floor(d.length / W);
    const rms = new Float32Array(n);
    for (let k = 0; k < n; k++) { let s = 0; for (let i = k * W, e = i + W; i < e; i++) s += d[i] * d[i]; rms[k] = Math.sqrt(s / W); }
    const sorted = Array.from(rms).filter((x) => x > 1e-5).sort((x, y) => x - y);
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
    const TH = Math.max(Math.pow(10, -45 / 20), p90 * Math.pow(10, -26 / 20));
    const from = Math.max(0, n - Math.round(1.5 / 0.02));
    let last = -1;
    for (let k = n - 1; k >= from; k--) if (rms[k] > TH) { last = k; break; }
    const end = last < 0 ? (from > 0 ? (from * W) / sr : buf.duration) : Math.min(buf.duration, ((last + 1) * W) / sr + 0.05);
    C.set(buf, end);
    return end;
  }

  _buf(url) { const b = this.buffers.get(url); return b && !(b instanceof Promise) ? b : null; }

  // ---------------------------------------------------------------- bölüm sesi (v2)

  /**
   * film.audio (v2) + çözümlenmiş parça adresleri. Ses yoksa (urls boş) saat metinden gelen zaman çizelgesiyle sürer.
   * fetcher: aynı kökenli varlık adresleri için (Cache Storage); isAsset(url) hangisi olduğunu söyler. Diğer adresler (imzalı
   * depolama) akışla indirilir.
   */
  setChapter(au, urls, fetcher, isAsset) {
    this._stopChapter();
    for (const m of (this._chMed || new Map()).values()) this._dropMedia(m);
    this.ch = chapterPlan(au, urls);
    this._gen = (this._gen || 0) + 1;
    this._fetcher = fetcher || null;
    this._isAsset = isAsset || null;
    this._chBytes = new Map(); // parça → Promise<ArrayBuffer|null>
    this._chDec = new Map(); // parça → AudioBuffer | Promise | null
    this._chFail = new Map(); // parça → {n, at, err} (yeniden deneme)
    this._chMed = new Map(); // parça → {el, src, g, pc} (akış yedeği)
    this._chDead = new Set(); // hiçbir yolla çalınamayan parçalar (sessiz geçer)
    this._chInfo = new Map(); // tanı: parça → {kb, fetchMs, decMs, via}
    this._fq = []; this._fActive = 0; this._fBusy = new Set(); this._decQ = Promise.resolve();
    this._curPart = 0;
    this._chFresh = true;
    this.waiting = false;
    if (this.ch && this.ch.has && this.ctx && !this.chain) {
      this.chain = new VoiceChain(this.ctx, this.voice, { onEvent: (k, e) => { this.errs.push(e); if (this.errs.length > 14) this.errs.shift(); } });
    }
    if (this.ch && this.ch.has) this._window(0);
    return this.ch;
  }

  /** Film saatindeki bölüt (yoksa null). */
  segAt(t) {
    const S = this.ch?.segs;
    if (!S || !S.length) return null;
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].f0 <= t) lo = m; else hi = m - 1; }
    const s = S[lo];
    return t >= s.f0 && t < s.f1 ? s : null;
  }

  _segIdx(a) {
    const S = this.ch.segs;
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].a0 <= a + 1e-6) lo = m; else hi = m - 1; }
    return lo;
  }

  _partAt(a) {
    const P = this.ch.parts;
    for (let i = P.length - 1; i >= 0; i--) if (a >= P[i].a0 - 1e-6) return i;
    return 0;
  }

  /**
   * İmzalı adresin baytları: akışla okunur; 15 sn hiç veri gelmezse kesilir (toplam süre sınırı yok — yavaş bağlantıda
   * da iner). Aynı kökenli varlıklar fetcher ile (Cache Storage).
   */
  async _get(url, i) {
    if (this._fetcher && this._isAsset && this._isAsset(url)) return this._fetcher(url);
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = 0, stalled = false;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; if (ac) ac.abort(); }, 15000); };
    arm();
    try {
      const r = await fetch(url, { signal: ac ? ac.signal : undefined, mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (!r.body || !r.body.getReader) return await r.arrayBuffer();
      const rd = r.body.getReader();
      const chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(value); n += value.length; arm();
        const inf = this._chInfo?.get(i); if (inf) inf.kb = Math.round(n / 1024);
      }
      const out = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return out.buffer;
    } catch (e) {
      throw stalled ? new Error('zaman aşımı (15 sn veri yok)') : e;
    } finally { clearTimeout(timer); }
  }

  /** İndirme sırası: önce çalınacak parça (o gelene dek tek indirme), sonra en çok iki paralel. */
  _pump() {
    const gen = this._gen;
    for (;;) {
      const cur = this._curPart || 0;
      const curDone = !this._fq.some((j) => j.i === cur) && !this._fBusy?.has(cur);
      const max = curDone ? 2 : 1;
      if (this._fActive >= max || !this._fq.length) return;
      const key = (k) => (k >= cur ? k - cur : 100 + cur - k);
      this._fq.sort((x, y) => key(x.i) - key(y.i));
      if (!curDone && this._fq[0].i !== cur && this._fActive > 0) return;
      const job = this._fq.shift();
      if (this._chBytes.get(job.i) !== job.pr) { job.res(null); continue; } // pencereden çıktı
      this._fActive++;
      (this._fBusy || (this._fBusy = new Set())).add(job.i);
      const t0 = performance.now();
      const inf = { kb: 0, fetchMs: null, decMs: null, via: 'buf' };
      this._chInfo.set(job.i, inf);
      this._get(job.url, job.i).then((ab) => {
        if (gen !== this._gen) return job.res(null);
        inf.fetchMs = Math.round(performance.now() - t0);
        if (ab) inf.kb = Math.round(ab.byteLength / 1024);
        job.res(ab);
      }, (e) => {
        if (gen !== this._gen) return job.res(null);
        console.warn('[film3] bölüm sesi parçası yüklenemedi', job.i, e);
        this._failed(job.i, e, 'indirme');
        job.res(null);
      }).finally(() => {
        if (gen !== this._gen) return;
        this._fActive--;
        this._fBusy.delete(job.i);
        this._pump();
      });
    }
  }

  _fetchPart(i) {
    const p = this.ch.parts[i];
    if (!p || !p.url) return null;
    if (!this._chBytes.has(i)) {
      let res;
      const pr = new Promise((r) => { res = r; });
      this._chBytes.set(i, pr);
      this._fq.push({ i, url: p.url, res, pr });
      this._pump();
    }
    return this._chBytes.get(i);
  }

  _decodePart(i) {
    if (this._chDec.has(i)) return this._chDec.get(i);
    if (this._chMed.has(i) || this._chDead.has(i)) return null;
    const bytes = this._fetchPart(i);
    if (!bytes) { this._chDec.set(i, null); return null; }
    const gen = this._gen;
    const p = bytes.then((ab) => {
      if (!ab || gen !== this._gen) return null;
      // Çözme sırayla (telefonda bellek tepesi ve işlemci): her biri en çok 20 sn.
      const run = this._decQ.then(async () => {
        const t0 = performance.now();
        const buf = await within(this.ctx.decodeAudioData(ab.slice(0)), 20000, 'çözme zaman aşımı (20 sn)');
        const inf = this._chInfo.get(i); if (inf) inf.decMs = Math.round(performance.now() - t0);
        return buf;
      });
      this._decQ = run.catch(() => {});
      return run.catch((e) => { console.warn('[film3] bölüm sesi çözülemedi', i, e); if (gen === this._gen) this._failed(i, e, 'çözme'); return null; });
    }).then((buf) => { if (gen === this._gen && this._chDec.get(i) === p) this._chDec.set(i, buf); return buf; });
    this._chDec.set(i, p);
    return p;
  }

  /**
   * Parça indirilemedi/çözülemedi. İndirme bir kez 2 sn sonra yeniden denenir (denerken saat bekler — sessiz film yerine
   * "yükleniyor"); ikinci indirme hatasında ya da çözme hatasında parça akıştan (HTMLAudioElement) çalınır. O da olmazsa
   * parça sessiz geçer ve oynatıcıya bildirilir (onState 'audioError').
   */
  _failed(i, e, stage) {
    const F = this._chFail || (this._chFail = new Map());
    const f = F.get(i) || { n: 0, at: 0 };
    f.n++; f.at = performance.now(); f.err = `${stage}: ${String(e && e.message ? e.message : e)}`;
    F.set(i, f);
    this._err('parça ' + i, f.err);
    if (stage === 'çözme' || f.n >= 2) this._toMedia(i, f.err);
  }

  _dead(i, err) {
    this._chDead.add(i);
    this._err('parça ' + i, 'çalınamıyor: ' + err);
    if (this.onState) this.onState('audioError', { part: i, err });
  }

  /** Akış yedeği: parça HTMLAudioElement'ten MediaElementSource ile konuşma zincirine bağlanır. */
  _toMedia(i, why) {
    if (this._chMed.has(i) || this._chDead.has(i)) return;
    const url = this.ch?.parts[i]?.url;
    if (!url || !this.ctx.createMediaElementSource || typeof Audio === 'undefined') return this._dead(i, why);
    try {
      const el = (this._pool && this._pool.shift()) || new Audio();
      try { el.pause(); } catch (_) {}
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      const src = this.ctx.createMediaElementSource(el);
      const g = this.ctx.createGain();
      src.connect(g).connect(this.chain ? this.chain.input : this.voice);
      const m = { i, el, src, g, pc: -1, err: null };
      el.addEventListener('error', () => {
        m.err = 'akış: ' + (el.error ? `kod ${el.error.code} ${el.error.message || ''}` : 'hata');
        this._chMed.delete(i);
        this._dropMedia(m);
        this._dead(i, `${why}; ${m.err}`);
      });
      el.src = url;
      try { el.load(); } catch (_) {}
      this._chMed.set(i, m);
      this._chDec.delete(i);
      const inf = this._chInfo.get(i) || {}; inf.via = 'akış'; this._chInfo.set(i, inf);
      this._err('parça ' + i, 'akış yedeğine geçti (' + why + ')');
    } catch (e) { this._dead(i, `${why}; akış kurulamadı: ${e && e.message}`); }
  }

  /**
   * Akış yedeği için ses öğeleri dokunuşun İÇİNDE "kutsanır" (sessiz bir örnekle play/pause): sonradan (dokunuş dışında)
   * play() otomatik oynatma kuralına takılmasın. Her dokunuşta havuz 2 öğeye tamamlanır.
   */
  _blessMedia() {
    if (typeof Audio === 'undefined') return;
    // Akıştan çalan (ya da otomatik oynatmaya takılmış) öğeler: dokunuşta oynat → saat zaten çalıyorsa sürer, değilse durur.
    for (const m of (this._chMed || new Map()).values()) {
      if (m.err || m.blessed) continue;
      m.denied = false;
      try {
        const el = m.el, wasPaused = el.paused, pr = el.play();
        m.blessed = true;
        if (wasPaused && m.pc < 0) { if (pr && pr.then) pr.then(() => { if (m.pc < 0) el.pause(); }, () => { m.blessed = false; }); else el.pause(); }
        else m.pc = -1; // _mediaTick konumu düzeltip yeniden başlatır
      } catch (_) {}
    }
    const P = this._pool || (this._pool = []);
    while (P.length < 2) {
      try {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.src = SILENT_WAV;
        const pr = el.play();
        if (pr && pr.then) pr.then(() => el.pause(), () => {});
        P.push(el);
      } catch (_) { return; }
    }
  }

  _dropMedia(m) {
    try { m.el.pause(); } catch (_) {}
    try { m.src.disconnect(); m.g.disconnect(); } catch (_) {}
    try { m.el.removeAttribute('src'); m.el.load(); } catch (_) {}
  }

  /** Bellek penceresi: [i−1, i+2] çözülür, [i, i+4] indirilir; uzaktaki çözülmüş parçalar bırakılır (uzun bölümde bellek). */
  _window(i) {
    if (!this.ch?.has || !this.ctx) return;
    const n = this.ch.parts.length;
    if (this._curPart !== i) { this._curPart = i; this._pump(); }
    for (const [k, f] of this._chFail || []) {
      if (f.n < 2 && this._chDec.get(k) === null && !this._chMed.has(k) && !this._chDead.has(k) && performance.now() - f.at > 2000) { this._chBytes.delete(k); this._chDec.delete(k); }
    }
    for (let k = i; k < Math.min(n, i + 5); k++) if (!this._chMed.has(k) && !this._chDead.has(k)) this._fetchPart(k);
    for (let k = Math.max(0, i - 1); k < Math.min(n, i + 3); k++) this._decodePart(k);
    for (const k of [...this._chDec.keys()]) if (k < i - 2 || k > i + 3) this._chDec.delete(k);
    for (const k of [...this._chBytes.keys()]) if (k < i - 3 || k > i + 8) this._chBytes.delete(k);
    for (const [k, m] of [...this._chMed]) if (k < i - 2 || k > i + 3) { this._dropMedia(m); this._chMed.delete(k); this._chFail.delete(k); }
  }

  _partBuf(i) { const b = this._chDec.get(i); return b && !(b instanceof Promise) ? b : null; }
  /** Parça bekleniyor: indiriliyor/çözülüyor, yeniden denenecek ya da akış henüz yeterince dolmadı (saat bekler). */
  _partPending(i) {
    if (this._chDead.has(i)) return false;
    const m = this._chMed.get(i);
    if (m) return !m.err && m.el.readyState < 3;
    const d = this._chDec.get(i);
    if (d instanceof Promise) return true;
    const f = this._chFail?.get(i);
    return d === null && !!f && f.n < 2 && !!this.ch?.parts[i]?.url;
  }

  _fxOf(seg) { return seg && seg.kind === 'say' ? this.ch.fx[seg.who] || null : null; }
  _gateOf(seg) { return seg && seg.kind === 'narr' && !this.narration ? 0 : 1; }

  /** Akış yedeğindeki parçalar: saate göre oynat/duraklat, 250 ms'den fazla kayarsa düzelt. */
  _mediaTick(t, inHold) {
    if (!this._chMed.size) return;
    const ch = this.ch;
    for (const m of this._chMed.values()) {
      if (m.err) continue;
      let pc = null;
      if (!inHold && !this.waiting) for (const x of ch.pieces) { if (x.part === m.i && t >= x.f - 0.01 && t < x.f + (x.b - x.a) - 0.02) { pc = x; break; } }
      if (!pc) { if (!m.el.paused) { try { m.el.pause(); } catch (_) {} } m.pc = -1; continue; }
      const want = pc.off + (t - pc.f);
      if (m.denied) continue; // otomatik oynatma izni yok: bir sonraki dokunuşta (_blessMedia)
      try {
        if (Math.abs(m.el.playbackRate - this.rate) > 1e-3) m.el.playbackRate = this.rate;
        if (m.pc !== pc.i || m.el.paused) {
          m.el.currentTime = want;
          m.pc = pc.i;
          const pr = m.el.play();
          if (pr && pr.catch) pr.catch((e) => { m.blessed = false; m.pc = -1; if (e && e.name === 'NotAllowedError') m.denied = true; this._err('parça ' + m.i, 'akış oynatılamadı: ' + (e && e.message)); });
          // Kısma: akışta zarf yok, duyulan bölütler boyunca
          const now = this.ctx.currentTime;
          this._duckPiece(pc, null, now, want, pc.off + (pc.b - pc.a));
        } else if (Math.abs(m.el.currentTime - want) > 0.25 && performance.now() - (m.seekAt || 0) > 2000) { m.el.currentTime = want; m.seekAt = performance.now(); } // konum atlatılamıyorsa (Range yok) döngüye girmesin
      } catch (_) {}
    }
  }

  /** Her kare: bölüm sesi dilimlerini ve bölüt sınırlarını ~2 sn ileriye planlar. */
  _chTick() {
    const ch = this.ch;
    if (!ch || !ch.has || !this.ctx || !this.playing || !this.unlocked) return;
    if (this.chain) this.chain.watch();
    let t = this._raw();
    const a = audioTimeOf(t, ch.holds);
    const pi = this._partAt(a);
    this._window(pi);
    // Saat sesi bekler: çalınması gereken parça henüz gelmediyse (indirme/çözme sürüyor) film durur.
    const inHold = ch.holds.some((h) => t >= h.t && t < h.t + h.d);
    const need = !inHold && a < ch.dur - 0.02 && ch.parts[pi].url && !this._partBuf(pi) && this._partPending(pi);
    if (need) {
      if (!this.waiting) {
        this._t0 = t; this.waiting = true; this._stallAt = null;
        this._stopChapter();
        if (this.onState) this.onState('buffering');
      }
      return;
    }
    if (this.waiting) {
      this.waiting = false;
      this._anchor(this._t0);
      t = this._raw();
      if (this.onState) this.onState('ready');
    }
    const now = this.ctx.currentTime;
    const ahead = 2.0 * this.rate; // kare hızı düşse de (ağır sahne) ses ~2 sn önceden planlıdır
    const ctxOf = (f) => now + Math.max(0, f - t) / this.rate;
    const chain = this.chain;
    // Bölütler (filtre + anlatı kapısı)
    if (chain && ch.segs.length) {
      if (this._chFresh) {
        const k = this._segIdx(a);
        const s = ch.segs[k];
        chain.reset(this._fxOf(s), this._gateOf(s));
        chain.log.push({ t: r3(t), who: s.who, kind: s.kind, ctxT: r3(now), wet: this._fxOf(s) ? 1 : 0, gate: this._gateOf(s), reset: true });
        this._segNext = k + 1;
      }
      while (this._segNext < ch.segs.length && ch.segs[this._segNext].f0 < t + ahead) {
        const s = ch.segs[this._segNext++];
        chain.set(ctxOf(s.f0), this._fxOf(s), this._gateOf(s), false, { t: r3(s.f0), who: s.who, kind: s.kind });
      }
    }
    this._chFresh = false;
    this._hold0 = false; // planlama yapıldı: saat sürer
    this._mediaTick(t, inHold);
    // Ses dilimleri: parça × bekleme aralıkları, boşluksuz (ardışık dilimler örnek doğruluğunda uç uca). Saat geç kaldıysa
    // (uzun ilk kare, gölgelendirici derleme) dilim doğru konumdan (startOff = off + gecikme) başlar; atlanmaz.
    this._stallAt = null;
    for (const pc of ch.pieces) {
      if (pc.f >= t + ahead) break;
      const len = pc.b - pc.a;
      if (pc.f + len <= t + 0.005 || this._chSrc.has(pc.i)) continue;
      if (this._chMed.has(pc.part)) continue; // akış yedeği (_mediaTick)
      const buf = this._partBuf(pc.part);
      if (!buf) {
        if (!this._partPending(pc.part)) this._chSrc.set(pc.i, { node: null, gain: null }); // çalınamıyor: sessiz geçer
        else { this._stallAt = Math.max(t, pc.f); break; } // indiriliyor: saat dilimin başında bekleyecek
        continue;
      }
      const late = Math.max(0, t - pc.f);
      const startOff = pc.off + late;
      const tailEnd = this._partTail(buf);
      const endOff = Math.min(pc.off + len, buf.duration, tailEnd);
      const playLen = endOff - startOff;
      if (playLen <= 0.004) { this._chSrc.set(pc.i, { node: null, gain: null }); continue; }
      const node = this.ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = this.rate;
      const g = this.ctx.createGain();
      node.connect(g).connect(chain ? chain.input : this.voice);
      const when = pc.f > t ? ctxOf(pc.f) : now;
      const stopAt = when + playLen / this.rate;
      try { node.start(when, startOff, playLen); } catch (e) { this._err('dilim', 'başlatılamadı: ' + (e && e.message)); continue; }
      try {
        const FI = (late > 0.002 || pc.holdIn) ? 0.012 : 0;
        if (FI) { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(1, when + FI / this.rate); }
        const clipped = endOff < Math.min(pc.off + len, buf.duration) - 1e-3;
        const FO = clipped ? 0.06 : pc.holdOut ? 0.012 : 0; // kuyruk hışırtısı kesildiyse 60 ms'de söner
        if (FO) { g.gain.setValueAtTime(1, Math.max(when, stopAt - FO / this.rate)); g.gain.linearRampToValueAtTime(0, stopAt); }
        node.stop(stopAt + 0.005);
      } catch (_) {}
      const key = pc.i;
      node.onended = () => { if (this._chSrc.get(key)?.node === node) this._chSrc.set(key, { node: null, gain: null, done: true }); };
      this._chSrc.set(key, { node, gain: g, when, startOff, playLen });
      this._duckPiece(pc, buf, when, startOff, endOff);
      this._started = (this._started || 0) + 1;
    }
  }

  /** Tanı (?f3debug=1): bağlam, parçalar, filtre kipi, son hatalar. */
  diag() {
    const c = this.ctx;
    const parts = [];
    if (this.ch?.has) {
      for (const p of this.ch.parts) {
        const i = p.i, d = this._chDec?.get(i), inf = this._chInfo?.get(i) || {};
        const st = this._chDead?.has(i) ? 'X' : this._chMed?.has(i) ? (this._chMed.get(i).el.readyState >= 3 ? 'A' : 'a') : d instanceof Promise ? 'P' : d ? 'B' : d === null ? '0' : '-';
        parts.push({ i, st, kb: inf.kb || 0, fetchMs: inf.fetchMs ?? null, decMs: inf.decMs ?? null, fail: this._chFail?.get(i)?.n || 0 });
      }
    }
    return {
      state: c ? c.state : 'yok', sr: c ? c.sampleRate : 0, base: c ? Math.round((c.baseLatency || 0) * 1000) : 0, out: c ? Math.round((c.outputLatency || 0) * 1000) : 0,
      t: Math.round(this._lastT * 10) / 10, playing: this.playing, waiting: this.waiting, narration: this.narration,
      chapter: !!this.ch?.has, parts, src: this._chSrc ? [...this._chSrc.values()].filter((x) => x.node).length : 0, started: this._started || 0,
      fx: this.chain ? this.chain.info() : null, errs: [...this.errs, ...(this.chain ? [] : [])].slice(-8),
    };
  }

  /** Tanı: konuşma ve arka plan (müzik+efekt) ölçerleri (yalnızca tanı açıkken kurulur). */
  meters() {
    if (!this.ctx) return null;
    if (!this._meters) {
      const mk = (n) => { const a = this.ctx.createAnalyser(); a.fftSize = 1024; n.connect(a); return a; };
      this._meters = { speech: mk(this.vMake), bg: [mk(this.duckM), mk(this.sfx)] };
      this._mbuf = new Float32Array(1024);
    }
    const rms = (a) => { a.getFloatTimeDomainData(this._mbuf); let s = 0; for (let i = 0; i < this._mbuf.length; i++) s += this._mbuf[i] * this._mbuf[i]; return s / this._mbuf.length; };
    const sp = Math.sqrt(rms(this._meters.speech)), bg = Math.sqrt(this._meters.bg.reduce((s, a) => s + rms(a), 0));
    return { speech: sp, bg };
  }

  /**
   * Her karede: [t] film saatine göre olayları planlar. events: {key,t,d,url,bus,vol}; music: {id,url,vol}|null;
   * speaking: ses var mı (müzik kısılır).
   */
  update(t, events, music, speaking) {
    if (!this.ctx || !this.playing || !this.unlocked) return;
    this._chTick();
    if (this.waiting) return;
    t = this._raw();
    const now = this.ctx.currentTime;
    const ahead = 0.25 * this.rate;
    for (const ev of events) {
      if (this.active.has(ev.key)) continue;
      const buf = this._buf(ev.url);
      if (!buf) continue;
      const voice = ev.bus === 'voice';
      // Replik: TTS sonundaki hışırtı/gürültü kuyruğu kesilir (son −45 dBFS üstü örnek + 40 ms) ve 90 ms'de söner.
      const end = voice ? this._tail(buf) : buf.duration;
      const len = Math.min(ev.d || end, end);
      if (t > ev.t + len - 0.05 || ev.t > t + ahead) continue;
      const node = this.ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = this.rate;
      const g = this.ctx.createGain();
      const vol = ev.vol ?? 1;
      g.gain.value = vol;
      // Efekt: uzun (ortam, > 3,5 sn) ve kısa efektler ayrı kısılır (konuşmada −14 / −8 dB).
      const dest = ev.bus === 'sfx' || !this[ev.bus] ? ((ev.d || buf.duration) > 3.5 ? this.duckA : this.duckS) : this[ev.bus];
      node.connect(g).connect(dest);
      const when = ev.t > t ? now + (ev.t - t) / this.rate : now;
      const off = ev.t > t ? 0 : t - ev.t;
      try { node.start(when, off); } catch (_) { continue; }
      if (voice) {
        const stopAt = when + Math.max(0, len - off) / this.rate;
        const FADE = 0.09 / this.rate;
        const fadeAt = Math.max(when, stopAt - FADE);
        try {
          g.gain.setValueAtTime(vol, fadeAt);
          g.gain.linearRampToValueAtTime(0, stopAt);
          node.stop(stopAt + 0.01);
        } catch (_) {}
      }
      const key = ev.key;
      node.onended = () => { if (this.active.get(key)?.node === node) this.active.delete(key); };
      this.active.set(key, { node, gain: g });
    }
    // Müzik: sahnenin parçası döngüde; değişince 1 sn geçiş.
    const want = music && this._buf(music.url) ? music : null;
    if ((this.musicNow?.id || null) !== (want?.id || null)) {
      if (this.musicNow) {
        const old = this.musicNow;
        old.gain.gain.setTargetAtTime(0, now, 0.35);
        try { old.node.stop(now + 1.6); } catch (_) {}
        this.musicNow = null;
      }
      if (want) {
        const buf = this._buf(want.url);
        const node = this.ctx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        node.playbackRate.value = this.rate;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        node.connect(g).connect(this.music);
        node.start(now, (Math.max(0, t - (want.t0 || 0))) % buf.duration);
        g.gain.setTargetAtTime(want.vol ?? 0.4, now, 0.4);
        this.musicNow = { id: want.id, node, gain: g, vol: want.vol ?? 0.4 };
        this._duckTarget = undefined;
      }
    }
    // Kısma: bölüm sesinde (v2) dilimlerle örnek doğruluğunda planlanır (_duckPiece); v1'de kareden.
    if (!this.ch?.has) this._duckTick(!!speaking);
  }
}
