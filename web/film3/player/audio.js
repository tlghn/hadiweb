// HADİ Film v3 — ses ve ana saat. Filmin saati WebAudio saatidir (AudioContext.currentTime); bağlam askıdaysa
// (otomatik oynatma izni yok) performance.now ile sürer, ses açılınca kaldığı yerden WebAudio'ya geçer.
// Replikler, efektler (sfx) ve müzik zaman çizelgesine bağlı planlanır; konuşmada müzik kısılır (ducking).

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
    this.rate = 1;
    this._t0 = 0; // film saati (sabitleme anında)
    this._c0 = 0; // kaynak saati (sabitleme anında)
    this._src = null;
    this._lastT = 0;
    this.buffers = new Map(); // url → AudioBuffer | Promise | null
    this.active = new Map(); // olay anahtarı → {node, gain}
    this.musicNow = null; // {id, node, gain}
    this.events = []; // {key, t, d, url, bus, vol}
    this.music = this.music || null;
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

  /** Filmin şimdiki saati (sn). */
  time() {
    if (!this.playing) return this._t0;
    const src = this._curSrc();
    if (src !== this._src) { // saat kaynağı değişti (ses açıldı): kaldığı yerden sürer
      this._t0 = this._lastT;
      this._c0 = this._nowOf(src);
      this._src = src;
    }
    this._lastT = this._t0 + (this._nowOf(src) - this._c0) * this.rate;
    return this._lastT;
  }

  _anchor(t) {
    this._src = this._curSrc();
    this._t0 = this._lastT = t;
    this._c0 = this._nowOf(this._src);
  }

  play() { if (!this.playing) { this._anchor(this._t0); this.playing = true; } }
  pause() { if (this.playing) { this._t0 = this.time(); this.playing = false; this.stopAll(); } }
  seek(t) { this._anchor(Math.max(0, t)); this.stopAll(); }
  setRate(r) { const t = this.time(); this.rate = r; this._anchor(t); this.stopAll(); }

  stopAll() {
    for (const a of this.active.values()) { try { a.node.stop(); } catch (_) {} }
    this.active.clear();
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

  _buf(url) { const b = this.buffers.get(url); return b && !(b instanceof Promise) ? b : null; }

  /**
   * Her karede: [t] film saatine göre olayları planlar. events: {key,t,d,url,bus,vol}; music: {id,url,vol}|null;
   * speaking: konuşma var mı (müzik kısılır).
   */
  update(t, events, music, speaking) {
    if (!this.ctx || !this.playing || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const ahead = 0.25 * this.rate;
    for (const ev of events) {
      if (this.active.has(ev.key)) continue;
      const buf = this._buf(ev.url);
      if (!buf) continue;
      const len = Math.min(ev.d || buf.duration, buf.duration);
      if (t > ev.t + len - 0.05 || ev.t > t + ahead) continue;
      const node = this.ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = this.rate;
      const g = this.ctx.createGain();
      g.gain.value = ev.vol ?? 1;
      node.connect(g).connect(this[ev.bus] || this.sfx);
      const when = ev.t > t ? now + (ev.t - t) / this.rate : now;
      const off = ev.t > t ? 0 : t - ev.t;
      try { node.start(when, off); } catch (_) { continue; }
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
