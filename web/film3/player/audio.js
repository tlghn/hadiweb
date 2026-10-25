// HADİ Film v3 — ses ve ana saat. Filmin saati WebAudio saatidir (AudioContext.currentTime); bağlam askıdaysa
// (otomatik oynatma izni yok) performance.now ile sürer, ses açılınca kaldığı yerden WebAudio'ya geçer.
//
// v2 (25 Ekim, kurucu kararı): bölüm TEK sestir — sesli kitabın kendi sesi (film.audio: parçalar + beklemeler + konuşan
// bölütleri + karakter ses filtreleri). Parçalar tek bir zaman çizelgesi gibi boşluksuz çalar (örnek doğruluğunda
// planlama); beklemelerde (hold) ses kelime sınırında N sn durur, film sürer. Ses gelmediyse (indirme sürüyor) saat
// bekler: görüntü sesin önüne geçmez. Konuşma bölütlerinde konuşanın filtresi (voicefx.js) 40 ms'lik geçişle açılır,
// anlatı kuru çalar; "Anlatıcı sesi" kapalıysa anlatı bölütleri susar (müzik/efekt sürer, sahneler zamanında oynar).
// v1 filmler (replik başına ses: line.audio) eski yoldan çalar. Müzik sahneye bağlı döngü; seste müzik kısılır (ducking).

import { VoiceChain, normFx } from './voicefx.js';

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
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.voice = this._bus(1.0);
      this.sfx = this._bus(0.8);
      this.music = this._bus(1.0);
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

  _bus(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Kullanıcı dokunuşu / oynat: bağlamı açmayı dener. */
  async unlock() {
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
  }

  stopAll() {
    for (const a of this.active.values()) { try { a.node.stop(); } catch (_) {} }
    this.active.clear();
    for (const a of this._chSrc.values()) { try { a.node && a.node.stop(); } catch (_) {} }
    this._chSrc.clear();
    this._chFresh = true;
    if (this.musicNow) { try { this.musicNow.node.stop(); } catch (_) {} this.musicNow = null; }
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

  /** film.audio (v2) + çözümlenmiş parça adresleri. Ses yoksa (urls boş) saat metinden gelen zaman çizelgesiyle sürer. */
  setChapter(au, urls, fetcher) {
    for (const a of this._chSrc.values()) { try { a.node && a.node.stop(); } catch (_) {} }
    this._chSrc.clear();
    this.ch = chapterPlan(au, urls);
    this._fetcher = fetcher || null;
    this._chBytes = new Map(); // parça → Promise<ArrayBuffer|null>
    this._chDec = new Map(); // parça → AudioBuffer | Promise | null
    this._chFail = new Map(); // parça → {n, at, err} (yeniden deneme)
    this._chFresh = true;
    this.waiting = false;
    if (this.ch && this.ch.has && this.ctx && !this.chain) this.chain = new VoiceChain(this.ctx, this.voice);
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

  _fetchPart(i) {
    const p = this.ch.parts[i];
    if (!p || !p.url) return null;
    if (!this._chBytes.has(i)) {
      const f = this._fetcher || ((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
      this._chBytes.set(i, Promise.race([Promise.resolve().then(() => f(p.url)), new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), 30000))])
        .catch((e) => { console.warn('[film3] bölüm sesi parçası yüklenemedi', i, e); this._failed(i, e); return null; }));
    }
    return this._chBytes.get(i);
  }

  _decodePart(i) {
    if (this._chDec.has(i)) return this._chDec.get(i);
    const bytes = this._fetchPart(i);
    if (!bytes) { this._chDec.set(i, null); return null; }
    const p = bytes.then(async (ab) => {
      if (!ab) return null;
      try { return await this.ctx.decodeAudioData(ab.slice(0)); } catch (e) { console.warn('[film3] bölüm sesi çözülemedi', i, e); this._failed(i, e); return null; }
    }).then((buf) => { if (this._chDec.get(i) === p) this._chDec.set(i, buf); return buf; });
    this._chDec.set(i, p);
    return p;
  }

  /**
   * Parça indirilemedi/çözülemedi: 2, 4 sn sonra yeniden denenir (en çok 3 deneme; denerken saat bekler — sessiz film yerine
   * "yükleniyor"). Üçüncüden sonra parça sessiz geçer ve oynatıcıya bildirilir (onState 'audioError').
   */
  _failed(i, e) {
    const F = this._chFail || (this._chFail = new Map());
    const f = F.get(i) || { n: 0, at: 0 };
    f.n++; f.at = performance.now(); f.err = String(e && e.message ? e.message : e);
    F.set(i, f);
    if (f.n >= 3 && this.onState) this.onState('audioError', { part: i, err: f.err });
  }

  /** Bellek penceresi: [i−1, i+2] çözülür, [i, i+4] indirilir; uzaktaki çözülmüş parçalar bırakılır (uzun bölümde bellek). */
  _window(i) {
    if (!this.ch?.has || !this.ctx) return;
    const n = this.ch.parts.length;
    for (const [k, f] of this._chFail || []) {
      if (f.n < 3 && this._chDec.get(k) === null && performance.now() - f.at > 2000 * f.n) { this._chBytes.delete(k); this._chDec.delete(k); }
    }
    for (let k = i; k < Math.min(n, i + 5); k++) this._fetchPart(k);
    for (let k = Math.max(0, i - 1); k < Math.min(n, i + 3); k++) this._decodePart(k);
    for (const k of [...this._chDec.keys()]) if (k < i - 2 || k > i + 3) this._chDec.delete(k);
    for (const k of [...this._chBytes.keys()]) if (k < i - 3 || k > i + 8) this._chBytes.delete(k);
  }

  _partBuf(i) { const b = this._chDec.get(i); return b && !(b instanceof Promise) ? b : null; }
  /** Parça bekleniyor: indiriliyor/çözülüyor ya da başarısız olup yeniden denenecek (saat bekler). */
  _partPending(i) {
    const d = this._chDec.get(i);
    if (d instanceof Promise) return true;
    const f = this._chFail?.get(i);
    return d === null && !!f && f.n < 3 && !!this.ch?.parts[i]?.url;
  }

  _fxOf(seg) { return seg && seg.kind === 'say' ? this.ch.fx[seg.who] || null : null; }
  _gateOf(seg) { return seg && seg.kind === 'narr' && !this.narration ? 0 : 1; }

  /** Her kare: bölüm sesi dilimlerini ve bölüt sınırlarını ~1 sn ileriye planlar. */
  _chTick() {
    const ch = this.ch;
    if (!ch || !ch.has || !this.ctx || !this.playing || !this.unlocked) return;
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
        for (const s of this._chSrc.values()) { try { s.node && s.node.stop(); } catch (_) {} }
        this._chSrc.clear();
        this._chFresh = true;
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
    // Ses dilimleri: parça × bekleme aralıkları, boşluksuz (ardışık dilimler örnek doğruluğunda uç uca).
    this._stallAt = null;
    for (const pc of ch.pieces) {
      if (pc.f >= t + ahead) break;
      const len = pc.b - pc.a;
      if (pc.f + len <= t + 0.005 || this._chSrc.has(pc.i)) continue;
      const buf = this._partBuf(pc.part);
      if (!buf) {
        if (!this._partPending(pc.part)) this._chSrc.set(pc.i, { node: null, gain: null }); // yüklenemedi: sessiz geçer
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
      try { node.start(when, startOff, playLen); } catch (_) { continue; }
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
    }
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
      node.connect(g).connect(this[ev.bus] || this.sfx);
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
    if (this.musicNow) {
      const target = this.musicNow.vol * (speaking ? 0.32 : 1);
      if (Math.abs((this._duckTarget ?? -1) - target) > 1e-3) {
        this.musicNow.gain.gain.setTargetAtTime(target, now, 0.18);
        this._duckTarget = target;
      }
    }
  }
}
