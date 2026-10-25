// HADİ Film v3 — oynatıcı (webview / iframe içinde). Sözleşme: film3_spec §5.
//   Giriş (postMessage ya da window.HadiFilm3.cmd): {type:"load", catalog, film, cast, start, quality, subs, audioBase?, aspect?,
//     placeholders?} · play · pause · seek {t} · rate {r} · quality {low|mid|high|auto} · subs {on}
//   Çıkış: ready {dur} · progress {t,dur} · ended · error {msg} · needAsset {pct} · state {playing} · quality {q} · tap
//   Uygulamada (webview) çıkış HadiBridge.postMessage(JSON) ile, web'de (iframe) parent.postMessage ile gider.
// Ana saat WebAudio'dur (audio.js); her kare t'ye göre değerlendirilir (director.js). Varlıklar Cache Storage'da (assets.js).
import * as THREE from 'three';
import { AssetStore } from './assets.js';
import { FilmAudio } from './audio.js';
import { Look, QUALITY } from './fx.js';
import { buildHuman, buildAnimal, findPart } from './character.js';
import { prepareFilm, sceneAt, ScenePlan, CameraDirector, applyHead, blinkAt, visemeWeightsAt } from './director.js';
import { placeholderCatalog, placeholderGltf } from './placeholder.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const FILM3_ROOT = new URL('../', location.href).href;

function post(type, data = {}) {
  const msg = { source: 'hadi-film3', type, ...data };
  try { if (window.HadiBridge && window.HadiBridge.postMessage) window.HadiBridge.postMessage(JSON.stringify(msg)); } catch (_) {}
  try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('film3', { detail: msg })); } catch (_) {}
}

const ORDER = ['high', 'mid', 'low'];

class Player {
  constructor() {
    this.canvas = $('c');
    this.subsEl = $('subs');
    this.fadeEl = $('fade');
    this.xfade = $('xfade');
    this.chip = $('chip');
    // Künye (CC BY atıfları): "i" düğmesi her zaman açar/kapatır; film bitince kendiliğinden açılır.
    this.creditsEl = $('credits');
    this.infoBtn = $('infoBtn');
    this.credits = [];
    if (this.infoBtn) {
      this.infoBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.infoBtn.addEventListener('click', (e) => { e.stopPropagation(); this._showCredits(!this.creditsEl.classList.contains('on')); });
    }
    if (this.creditsEl) this.creditsEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.autoQ = true;
    const q0 = params.get('q') || (matchMedia('(pointer:coarse)').matches ? 'mid' : 'high');
    this.look = new Look(this.canvas, QUALITY[q0] ? q0 : 'mid');
    this.audio = new FilmAudio();
    this.cam = new CameraDirector(this.look.camera);
    this.film = null;
    this.actors = new Map();
    this.worlds = new Map();
    this.plans = new Map();
    this.cur = -1;
    this.subs = true;
    this.ended = false;
    this.dirty = true;
    this._lastProg = 0;
    this._fps = { n: 0, t0: performance.now(), lowRuns: 0 };
    this.stats = { fps: 0, frames: 0, cuts: 0 };
    this.vis = {};
    this.noHead = params.get('nohead') === '1'; // tanı: bakış katmanı kapalı
    window.addEventListener('resize', () => this.layout());
    document.addEventListener('pointerdown', () => { this.audio.unlock().then(() => this._chip()); post('tap'); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.audio.playing) { this.pause(); this._hiddenPause = true; } });
    this.layout();
    requestAnimationFrame((ts) => this.frame(ts));
  }

  // ---------------------------------------------------------------- yerleşim (sinematik oran)

  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const ar = this.aspect || (W / H >= 1.5 ? 2.0 : 16 / 9);
    let w = W, h = Math.round(W / ar);
    if (h > H) { h = H; w = Math.round(H * ar); }
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    for (const el of [this.canvas, this.xfade]) Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    this.xfade.width = Math.max(1, Math.round(w * 0.5));
    this.xfade.height = Math.max(1, Math.round(h * 0.5));
    // Altyazı: alt bantta yer varsa bandın içinde, yoksa görüntünün altında.
    const bar = H - (y + h);
    this.subsEl.style.bottom = (bar >= 70 ? Math.max(8, bar / 2 - 28) : Math.max(14, h * 0.06) + bar) + 'px';
    this.look.resize(w, h);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- yükleme

  async load(msg) {
    try {
      this.ended = false;
      this.aspect = msg.aspect || null;
      this.subs = msg.subs !== false;
      if (msg.quality) this.setQuality(msg.quality);
      this.audioBase = msg.audioBase || null;
      const placeholders = msg.placeholders === true || msg.catalog === 'placeholder';
      this.assets = new AssetStore(FILM3_ROOT, (pct) => post('needAsset', { pct }));
      let cat;
      if (placeholders) cat = placeholderCatalog();
      else {
        try {
          cat = await this.assets.loadCatalog(msg.catalog || new URL('catalog.json', FILM3_ROOT).href);
        } catch (e) {
          if (msg.placeholders !== false && msg.demo) cat = placeholderCatalog();
          else throw new Error('Film dünyası açılamadı (katalog): ' + (e.message || e));
        }
      }
      this.cat = cat;
      const ph = placeholderCatalog();
      let film = msg.film;
      if (typeof film === 'string') film = await (await fetch(new URL(film, location.href).href, { cache: 'no-cache' })).json();
      if (film && film.film && film.cast && !film.scenes) { msg.cast = msg.cast || film.cast; film = film.film; }
      if (!film || !film.scenes) throw new Error('Senaryo yok.');
      this.film = prepareFilm(film);
      const castDefs = new Map((msg.cast || film.castDefs || []).map((c) => [c.id, c]));
      const ids = new Set(this.film.cast || []);
      for (const s of this.film.scenes) { for (const a of s.actors) ids.add(a.id); for (const b of s.beats) if (b.who) ids.add(b.who); }
      for (const l of this.film.lines) ids.add(l.who);
      const defs = [...ids].filter(Boolean).map((id) => castDefs.get(id) || { id, name: id, kind: 'human', morphs: {} });
      this.names = new Map(defs.map((d) => [d.id, d.name || d.id]));
      // Gerekli varlıklar
      const urls = new Set();
      const sizes = {};
      const add = (it) => { if (it && it.url && !String(it.url).startsWith('@ph/')) { const u = this.assets.url(it.url); urls.add(u); if (it.bytes || it.size) sizes[u] = it.bytes || it.size; } };
      const humans = defs.filter((d) => d.kind !== 'animal');
      if (humans.length) { add(cat.human); add(cat.anims); }
      const partOf = (slot, spec) => { const id = typeof spec === 'string' ? spec : spec?.id; return id ? findPart(cat, slot, id) : null; };
      for (const d of humans) for (const slot of ['hair', 'brows', 'beard', 'mustache', 'outfit', 'hat', 'prop_hand']) add(partOf(slot, d[slot === 'prop_hand' ? 'prop_hand' : slot]));
      for (const d of defs.filter((x) => x.kind === 'animal')) add((cat.animals || []).find((a) => a.id === d.animal));
      const envIds = new Set(this.film.scenes.map((s) => s.env));
      for (const e of envIds) add((cat.env || []).find((x) => x.id === e));
      for (const sc of this.film.scenes) { // HDRI (ilk indirme yüzdesine dahil)
        const src = (cat.env || []).find((x) => x.id === sc.env)?.hdri || cat.hdri;
        const h = src && (src[sc.time || 'day'] || src.day);
        if (h) { add({ url: h.hdr }); if (h.bg) add({ url: h.bg }); }
      }
      const propIds = new Set();
      for (const s of this.film.scenes) for (const b of s.beats) if (b.prop) propIds.add(b.prop);
      for (const p of propIds) add((cat.props || []).find((x) => x.id === p));
      const missing = await this.assets.missing([...urls]);
      if (missing.length) this.assets.track(missing, sizes);
      // Yükleyici: '@ph/' yer tutucu; gerçek varlık yoksa (sahne / hayvan / eşya) yer tutucuya düşülür.
      const get = (u) => (String(u).startsWith('@ph/') ? Promise.resolve(placeholderGltf(u)) : this.assets.gltf(u));
      // İnsanlar
      let animClips = [];
      if (humans.length && cat.anims?.url) {
        try { animClips = (await get(cat.anims.url)).animations || []; } catch (e) { console.warn('[film3] anims yok', e); }
      }
      const fit = (c, def) => {
        // Yer tutucu katalogda olmayan parça kimlikleri en yakın parçaya eşlenir (yalnızca yer tutucuda).
        if (!c.placeholder) return def;
        const o = { ...def };
        for (const slot of ['hair', 'brows', 'beard', 'mustache', 'outfit', 'hat']) {
          const v = def[slot];
          if (!v) continue;
          const id = typeof v === 'string' ? v : v.id;
          const list = c.parts[slot] || [];
          if (list.some((p) => p.id === id)) continue;
          let alt = list[0]?.id;
          if (slot === 'outfit') alt = def.age != null && def.age < 15 ? 'village_boy_1' : def.age > 60 ? 'elder_1' : 'village_man_1';
          if (slot === 'hat') alt = /fes|fez/.test(id) ? 'fez_red' : 'cap_wool';
          if (slot === 'hair' && /bun|long|braid|örgü/.test(id)) alt = 'long';
          o[slot] = typeof v === 'string' ? alt : { ...v, id: alt };
        }
        return o;
      };
      for (const d of defs) {
        try {
          let A;
          if (d.kind === 'animal') {
            const has = (cat.animals || []).some((a) => a.id === d.animal);
            A = await buildAnimal(get, has ? cat : ph, d);
          } else {
            A = await buildHuman(get, cat, fit(cat, d), animClips);
          }
          this.actors.set(d.id, A);
        } catch (e) {
          if (d.kind === 'animal') { console.warn('[film3] hayvan kurulamadı', d.id, e); continue; }
          throw new Error(`Oyuncu kurulamadı (${d.name || d.id}): ${e.message || e}`);
        }
      }
      // Künye: bu filmde gerçekten kurulan hayvanların katalogdaki atıf bilgisi (credit / src)
      const cr = new Map();
      for (const d of defs) {
        if (d.kind !== 'animal' || !this.actors.has(d.id)) continue;
        const it = (cat.animals || []).find((a) => a.id === d.animal);
        if (it && (it.credit || /CC BY/i.test(it.src || ''))) cr.set(it.credit?.url || it.src, { label: it.label || it.id, ...(it.credit || { src: it.src }) });
      }
      this._setCredits([...cr.values()]);
      // Eşyalar
      this.propSrc = new Map();
      for (const p of propIds) {
        const it = (cat.props || []).find((x) => x.id === p) || ph.props.find((x) => x.id === p);
        if (!it) continue;
        try { this.propSrc.set(p, { it, g: await get(it.url) }); } catch (e) { console.warn('[film3] eşya yok', p, e); }
      }
      // Sahne kitleri
      for (const e of envIds) {
        const it = (cat.env || []).find((x) => x.id === e) || ph.env.find((x) => x.id === e) || ph.env[0];
        let g;
        try { g = await get(it.url); } catch (err) {
          console.warn('[film3] sahne kiti yok, yer tutucu', e, err);
          const alt = ph.env.find((x) => x.id === e) || ph.env[0];
          g = await get(alt.url);
          this.worlds.set(e, this._world(alt, g));
          continue;
        }
        this.worlds.set(e, this._world(it, g));
      }
      // Gökyüzü ışığı (HDRI)
      if (!cat.placeholder && (cat.hdri || (cat.env || []).some((x) => x.hdri))) {
        await this._loadHdri();
      }
      // Ses
      this._audioEvents();
      if (this.assets._jobs.size) post('needAsset', { pct: 100 });
      this.audio.seek(Math.max(0, +msg.start || 0));
      this.cur = -1;
      this._activate(sceneAt(this.film, this.audio.time()), false);
      this.dirty = true;
      this.ready = true;
      post('ready', { dur: this.film.dur, scenes: this.film.scenes.map((s) => ({ i: s.i, t0: s.t0, t1: s.t1, title: s.title || '' })) });
      if (msg.autoplay) this.play();
    } catch (e) {
      console.error(e);
      post('error', { msg: String(e && e.message ? e.message : e) });
    }
  }

  _world(it, g) {
    const group = g.scene;
    group.traverse((o) => {
      if (o.isMesh) {
        // Gölgeyi yalnızca makul boyuttaki nesneler düşürür (ev, ağaç, çit, eşya). Zemin, tepe, gökyüzü kubbesi gibi büyük
        // mesh'ler gölge kamerasının bütün alanını karartır.
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const sc = o.getWorldScale(new THREE.Vector3());
        const r = (o.geometry.boundingSphere?.radius || 0) * Math.max(sc.x, sc.y, sc.z);
        o.castShadow = !o.userData?.noShadow && r > 0 && r < 12 && !o.material?.transparent;
        o.receiveShadow = true;
      }
      if (o.isLight && !o.isDirectionalLight) o.castShadow = false;
    });
    const spots = {};
    for (const [k, v] of Object.entries(it.spots || {})) {
      if (Array.isArray(v)) spots[k] = new THREE.Vector3(...v);
      else if (v && v.p) spots[k] = { p: new THREE.Vector3(...v.p), yaw: v.yaw };
    }
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      const m = /^spot[_\-. ]?(\w+)$/i.exec(o.name || '');
      if (m && !spots[m[1]]) spots[m[1]] = o.getWorldPosition(new THREE.Vector3());
    });
    // Su: kaydırmalı normal haritası + ortam yansıması (B: water.material, normalTiling).
    const water = [];
    const wname = it.water?.material || 'water';
    group.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && m.name === wname && !water.includes(m)) {
          m.roughness = Math.min(m.roughness ?? 0.1, 0.08); m.metalness = 0; m.envMapIntensity = 1.2;
          if (m.normalMap) { m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping; const k = it.water?.normalTiling || m.userData?.normalTiling; if (k) m.normalMap.repeat.set(k, k); }
          m.needsUpdate = true;
          water.push(m);
        }
      }
    });
        const pts = Object.values(spots).map((s) => (s.isVector3 ? s : s.p));
    const center = new THREE.Vector3();
    for (const p of pts) center.add(p);
    if (pts.length) center.multiplyScalar(1 / pts.length);
    let r = 0;
    for (const p of pts) r = Math.max(r, p.distanceTo(center));
    // Kamera tarafı (180° kuralı): katalogdaki kamera konumu → bakış noktası yönünün tersi; yoksa camera bir yön.
    const side = it.look && it.camera ? new THREE.Vector3(...it.camera).sub(new THREE.Vector3(...it.look)).setY(0).normalize() : new THREE.Vector3(...(it.camera || [0, 0, 1])).setY(0).normalize();
    if (side.lengthSq() < 0.5) side.set(0, 0, 1);
    return { it, group, spots, center, radius: it.radius || r + 4, side, interior: !!it.interior, ceiling: it.ceiling || 3.2, time: it.time, water };
  }

  _resolveAudio(u) {
    if (!u) return null;
    if (/^(https?:|blob:|data:)/.test(u)) return u;
    if (this.audioBase) return new URL(u, this.audioBase).href;
    if (/^(\.|\/)/.test(u)) return new URL(u, location.href).href;
    return null; // imzasız depolama yolu: çalınamaz (visem/altyazı yine çalışır)
  }

  _audioEvents() {
    const ev = [];
    for (const l of this.film.lines) {
      const url = this._resolveAudio(l.audio);
      if (!url) continue;
      ev.push({ key: 'l:' + l.id, t: l.t, d: l.d, url, bus: 'voice', vol: 1 });
    }
    const lookup = (kind, id) => {
      const it = (this.cat[kind] || []).find?.((x) => x.id === id);
      if (it?.url) return this.assets.url(it.url);
      if (this.cat.placeholder || Array.isArray(this.cat[kind])) return null; // katalog listeliyorsa tahmin yok
      return this.assets.url(`${kind}/${id}.mp3`);
    };
    this.film.scenes.forEach((s, si) => {
      (s.sfx || []).forEach((x, i) => { const url = lookup('sfx', x.id); if (url) ev.push({ key: `s:${si}:${i}`, t: x.t, d: x.d, url, bus: 'sfx', vol: x.vol ?? 0.9 }); });
    });
    this.events = ev;
    // Müzik: sahnede verilmezse önceki sahneninki sürer; {id:null} ya da "none" durdurur.
    let m = null;
    this.musicOf = this.film.scenes.map((s) => {
      if (s.music === 'none' || (s.music && s.music.id == null)) m = null;
      else if (s.music && s.music.id) { const url = lookup('music', s.music.id); m = url ? { id: s.music.id, url, vol: s.music.vol ?? 0.4, t0: s.t0 } : null; }
      return m;
    });
    const all = [...ev.map((e) => e.url), ...this.musicOf.filter(Boolean).map((x) => x.url)];
    const fetcher = (u) => (u.startsWith(this.assets.base) ? this.assets.bytes(u) : fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
    // Önce ilk dakikanın sesleri, sonra kalanı (aynı anda en çok 4).
    const sorted = [...new Set(all)];
    let i = 0;
    const next = () => { if (i >= sorted.length) return; const u = sorted[i++]; Promise.resolve(this.audio.preload(u, fetcher)).finally(next); };
    for (let k = 0; k < 4; k++) next();
  }

  // ---------------------------------------------------------------- sahne

  _activate(si, transition) {
    const sc = this.film.scenes[si];
    if (!sc) return;
    if (transition && sc.trans === 'crossfade' && this.cur >= 0) {
      // Önceki sahnenin son karesi küçük tuvalde tutulur, üstte erir.
      try {
        const x = this.xfade.getContext('2d');
        this.look.render(this.audio.time());
        x.drawImage(this.canvas, 0, 0, this.xfade.width, this.xfade.height);
        this.xfade.style.transition = 'none';
        this.xfade.style.opacity = '1';
        requestAnimationFrame(() => { this.xfade.style.transition = 'opacity .7s ease'; this.xfade.style.opacity = '0'; });
      } catch (_) {}
    } else {
      this.xfade.style.transition = 'none';
      this.xfade.style.opacity = '0';
    }
    const prev = this.cur >= 0 ? this.film.scenes[this.cur] : null;
    const w = this.worlds.get(sc.env) || [...this.worlds.values()][0];
    if (prev) { const pw = this.worlds.get(prev.env); if (pw && pw !== w) this.look.scene.remove(pw.group); }
    if (w && w.group.parent !== this.look.scene) this.look.scene.add(w.group);
    let plan = this.plans.get(si);
    if (!plan) { plan = new ScenePlan(this.film, sc, w, this.actors); this.plans.set(si, plan); }
    for (const A of this.actors.values()) {
      const inScene = plan.ids.includes(A.id);
      if (inScene && A.root.parent !== this.look.scene) this.look.scene.add(A.root);
      if (!inScene && A.root.parent) A.root.removeFromParent();
    }
    this.look.setEnv({ time: sc.time || 'day', weather: sc.weather || 'clear', light: sc.light, interior: w?.interior, particles: sc.particles, hdri: this._hdriFor(w, sc) });
    this._practical(w, sc);
    this.look.alphaCoverage(this.look.scene);
    this.cur = si;
    this.stats.cuts++;
  }

  /** Sahne + gün saati + hava için HDRI (yüklenmişse): env (doğrusal), bg (sRGB), sun, yaw, fog. */
  _hdriFor(w, sc) {
    const it = w?.it || {};
    const T = sc.time || 'day', Wx = sc.weather || 'clear';
    const alias = { noon: 'day', afternoon: 'day', evening: 'dusk', sunset: 'dusk', sunrise: 'dawn' };
    const wkey = /rain|storm/.test(Wx) ? (it.hdri?.storm ? 'storm' : 'overcast') : /cloud|overcast/.test(Wx) ? 'overcast' : /fog|mist/.test(Wx) ? 'fog' : null;
    const pick = (src) => src && (src[wkey] || src[T] || src[alias[T]] || src.day);
    const h = pick(it.hdri) || pick(this.cat.hdri);
    if (!h) return null;
    const r = this._hdriTex?.get(h.hdr);
    if (!r || !r.env) return null;
    const fogT = it.fog && (it.fog[T] || it.fog[alias[T]] || it.fog.day);
    return { env: r.env, bg: r.bg, bgExposure: h.bgExposure, sun: h.sun, yaw: it.hdriYaw || 0, fog: fogT || null };
  }

  /** Filmde geçen sahne/zamanların HDRI'lerini önceden yükler (önbellekli, bir kez iner). */
  async _loadHdri() {
    this._hdriTex = new Map();
    const want = new Map();
    for (const sc of this.film.scenes) {
      const w = this.worlds.get(sc.env);
      const it = w?.it || {};
      const T = sc.time || 'day';
      for (const src of [it.hdri, this.cat.hdri]) {
        if (!src) continue;
        const h = src[T] || src[{ noon: 'day', afternoon: 'day', evening: 'dusk' }[T]] || src.day;
        if (h?.hdr) want.set(h.hdr, h);
        for (const k of ['overcast', 'fog', 'storm']) if (src[k]?.hdr && new RegExp(k === 'overcast' ? 'cloud|overcast' : k === 'fog' ? 'fog|mist' : 'rain|storm').test(sc.weather || '')) want.set(src[k].hdr, src[k]);
        break;
      }
    }
    await Promise.all([...want.values()].map(async (h) => {
      try {
        const env = await this.assets.hdr(h.hdr);
        const bg = h.bg ? await this.assets.image(h.bg).catch(() => null) : null;
        this._hdriTex.set(h.hdr, { env, bg });
      } catch (e) { console.warn('[film3] HDRI yüklenemedi', h.hdr, e); }
    }));
  }

  /** İç mekân: sahne kitinde ışık yoksa (ya da katalog lights verdiyse) sıcak pratik ışıklar; gece daha güçlü. */
  _practical(w, sc) {
    if (!w || !w.interior) return;
    if (!w._lights) {
      w._lights = [];
      let has = false;
      w.group.traverse((o) => { if (o.isLight) has = true; });
      const list = Array.isArray(w.it?.lights) && w.it.lights.length ? w.it.lights : has ? [] : [{ pos: [w.center.x, (w.ceiling || 2.8) - 0.5, w.center.z], color: '#ffc27a' }];
      for (const L of list) {
        let l;
        if (L.type === 'window') {
          // Pencereden giren gün ışığı: pencereden içeri bakan yumuşak spot.
          l = new THREE.SpotLight(L.color || '#dfeaff', 1, L.d || 9, 0.75, 0.9, 1.4);
          l.position.fromArray(L.p || L.pos || [0, 2, 0]);
          const d = new THREE.Vector3(...(L.dir || [0, -0.3, 1]));
          l.target.position.copy(l.position).add(d.multiplyScalar(3));
          w.group.add(l.target);
          l.userData.window = true;
        } else {
          l = new THREE.PointLight(L.color || '#ffc27a', 1, L.d || L.range || Math.max(8, w.radius * 2.2), 1.6);
          l.position.fromArray(L.pos || L.p || [0, 2.2, 0]);
        }
        l.userData.base = L.i ?? L.intensity ?? null;
        l.userData.flicker = !!L.flicker;
        w.group.add(l);
        w._lights.push(l);
      }
    }
    const night = /night|evening|dusk/.test(sc.time || '');
    for (const l of w._lights) {
      if (l.userData.window) l.intensity = night ? 0.4 : 9;
      else l.intensity = l.userData.base != null ? l.userData.base * 4 : night ? 14 : 5; // katalog 'i' göreli; fiziksel birime ölçek
      l.userData.i0 = l.intensity;
    }
    this._flicker = w._lights.filter((l) => l.userData.flicker);
  }

  _prop(A, id) {
    A._props = A._props || new Map();
    for (const [k, o] of A._props) o.visible = k === id;
    if (!id || A._props.has(id)) return;
    const src = this.propSrc?.get(id);
    const hand = A.bones.handR;
    if (!src || !hand) return;
    const o = src.g.scene.clone(true);
    o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    const g = src.it.grip || [0, -0.09, 0.03];
    o.position.set(g[0], g[1], g[2]);
    if (src.it.gripRot) o.rotation.set(...src.it.gripRot);
    // Kemiğin dünya ölçeği telafi edilir (bazı iskeletlerde santimetre ölçeği olur).
    hand.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    o.scale.setScalar(1 / Math.max(1e-3, s.x));
    hand.add(o);
    A._props.set(id, o);
  }

  // ---------------------------------------------------------------- denetim

  play() {
    if (!this.film) return;
    if (this.ended || this.audio.time() >= this.film.dur - 0.05) { this.audio.seek(0); this.ended = false; }
    this.audio.unlock().then(() => this._chip());
    this._showCredits(false);
    this.audio.play();
    this._hiddenPause = false;
    post('state', { playing: true });
    this._chip();
  }
  pause() { this.audio.pause(); post('state', { playing: false }); this.dirty = true; this._chip(); }
  seek(t) {
    if (!this.film) return;
    this.audio.seek(Math.min(Math.max(0, +t || 0), this.film.dur - 0.01));
    this._seeked = true;
    this.ended = false;
    this._showCredits(false);
    this.dirty = true;
    this.xfade.style.opacity = '0';
  }
  setRate(r) { this.audio.setRate(Math.min(2, Math.max(0.5, +r || 1))); }
  setQuality(q) {
    if (q === 'auto') { this.autoQ = true; return; }
    if (!QUALITY[q]) return;
    this.autoQ = false;
    this.look.prScale = 1;
    this.look.setQuality(q);
    this.layout();
    post('quality', { q });
  }

  _setCredits(list) {
    this.credits = list || [];
    if (!this.creditsEl) return;
    this.creditsEl.textContent = '';
    this.creditsEl.classList.remove('on');
    this.infoBtn.classList.toggle('on', this.credits.length > 0);
    if (!this.credits.length) return;
    const h = document.createElement('h4'); h.textContent = 'Künye · 3B modeller'; this.creditsEl.appendChild(h);
    const ul = document.createElement('ul');
    for (const c of this.credits) {
      const li = document.createElement('li');
      if (c.title) {
        const t = document.createElement('span'); t.className = 't'; t.textContent = `${c.label}: "${c.title}"`; li.appendChild(t);
        li.appendChild(document.createTextNode(` — ${c.author} — ${c.license || 'CC BY 4.0'}`));
        const u = document.createElement('div'); u.className = 'u'; u.textContent = c.url; li.appendChild(u);
      } else li.textContent = `${c.label}: ${c.src}`;
      ul.appendChild(li);
    }
    this.creditsEl.appendChild(ul);
    const n = document.createElement('div'); n.className = 'n';
    n.textContent = 'Lisans: creativecommons.org/licenses/by/4.0 · Değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi.';
    this.creditsEl.appendChild(n);
  }
  _showCredits(on) {
    if (!this.creditsEl || !this.credits.length) return;
    this.creditsEl.classList.toggle('on', !!on);
  }

  _chip() {
    const needs = this.events?.length || this.musicOf?.some(Boolean);
    this.chip.style.display = this.audio.playing && needs && !this.audio.unlocked ? 'block' : 'none';
  }

  cmd(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'load': this.load(m); break;
      case 'play': this.play(); break;
      case 'pause': this.pause(); break;
      case 'seek': this.seek(m.t); break;
      case 'rate': this.setRate(m.r); break;
      case 'quality': this.setQuality(m.q || m.quality); break;
      case 'subs': this.subs = !!m.on; this._subText = null; this.subsEl.style.display = this.subs ? '' : 'none'; break;
      case 'stats': post('stats', { ...this.stats, q: this.look.qname, pr: this.look.renderer.getPixelRatio() }); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- kare

  frame(ts) {
    requestAnimationFrame((x) => this.frame(x));
    if (!this.film || !this.ready || document.hidden) return;
    const playing = this.audio.playing;
    if (!playing && !this.dirty) return;
    this.dirty = false;
    let t = this.audio.time();
    if (t >= this.film.dur) {
      t = this.film.dur;
      if (playing) { this.audio.pause(); this.audio.seek(this.film.dur); this.ended = true; post('progress', { t, dur: this.film.dur }); this._showCredits(true); post('ended'); post('state', { playing: false }); }
    }
    const si = sceneAt(this.film, t);
    if (si !== this.cur) this._activate(si, playing);
    this.lastT = t;
    const plan = this.plans.get(si);
    this._evaluate(plan, t);
    this.cam.snap = !playing || this._seeked;
    this._wasSeek = this._seeked;
    this._seeked = false;
    const { changed } = this.cam.update(plan, t, plan.world);
    if (changed) this.stats.shots = (this.stats.shots || 0) + 1;
    // Gölge ve odak
    const c = new THREE.Vector3(), tmp = new THREE.Vector3();
    let n = 0;
    for (const id of plan.ids) { c.add(this.actors.get(id).root.position); n++; }
    if (n) c.multiplyScalar(1 / n); else c.copy(plan.world.center);
    let r = 3;
    for (const id of plan.ids) r = Math.max(r, tmp.copy(this.actors.get(id).root.position).distanceTo(c) + 3);
    this.look.fitShadow(c, Math.min(r, 14));
    this.look.setFocus(this.cam.closeup, this.cam.focus, this.cam.dofScale ?? 1);
    this.look.portrait(this.cam.subjectEye, this.look.camera.position, this.cam.portraitW);
    if (changed || this._wasSeek) this.look.cut();
    this._wasSeek = false;
    // Ses
    const line = plan.lineAt(t);
    this.audio.update(t, this.events, this.musicOf[si], !!line);
    this._subtitle(line);
    this._fade(t, si);
    const flow = plan.world.it?.water?.flow || [0, 0, 1];
    for (const m of plan.world.water || []) if (m.normalMap) m.normalMap.offset.set(t * 0.035 * (flow[0] || 0.3), t * 0.035 * (flow[2] || 1));
    for (const l of this._flicker || []) l.intensity = l.userData.i0 * (0.82 + 0.12 * Math.sin(t * 13.1) + 0.06 * Math.sin(t * 29.7 + 1.3));
    this.look.render(t);
    this.stats.frames++;
    this._perf(ts);
    if (playing && ts - this._lastProg > 250) { this._lastProg = ts; post('progress', { t, dur: this.film.dur }); }
    if (!playing) post('progress', { t, dur: this.film.dur });
  }

  /** Sahne zemininin (x,z)'deki yüksekliği: yukarıdan aşağı ışın, yatay yüzeylerin ilki (önbellekli 20 cm ızgara). */
  _groundY(w, x, z) {
    w._gh = w._gh || new Map();
    const key = `${Math.round(x * 5)},${Math.round(z * 5)}`;
    if (w._gh.has(key)) return w._gh.get(key);
    this._gray = this._gray || new THREE.Raycaster();
    this._gray.set(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0));
    this._gray.far = 4;
    let y = 0;
    for (const h of this._gray.intersectObject(w.group, true)) {
      if (h.object.isPoints || h.object.isSprite) continue;
      if (h.face && h.face.normal.y < 0.6) continue;
      if (h.point.y > 0.35 || h.point.y < -0.5) continue; // masa, kuyu ağzı vb. değil; zemin
      y = h.point.y;
      break;
    }
    if (w._gh.size > 20000) w._gh.clear();
    w._gh.set(key, y);
    return y;
  }

  /** Temas gölgesi: ayakların altında yumuşak koyu leke (oyuncuyu zemine "bastırır"). */
  _blob(A) {
    if (A._blob) return;
    if (!this._blobTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.55, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      this._blobTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this._blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    const sx = A.kind === 'animal' ? Math.max(0.8, (A.width || 0.6) * 1.6) : 0.62 * Math.max(0.6, A.eyeH / 1.6);
    const sz = A.kind === 'animal' ? Math.max(1.2, (A.length || 1.8) * 0.9) : sx * 0.85;
    m.scale.set(sx, sz, 1);
    m.position.y = 0.012;
    m.renderOrder = 1;
    m.raycast = () => {};
    A.root.add(m);
    A._blob = m;
  }

  /** Karede yumuşak ayırma (durumsuz): çok yaklaşan iki oyuncu birbirinden itilir. */
  _separate(plan) {
    const L = plan.ids.map((id) => this.actors.get(id));
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i].root.position, b = L[j].root.position;
      const min = (L[i].kind === 'animal' ? 0.8 : 0.3) + (L[j].kind === 'animal' ? 0.8 : 0.3);
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= min) continue;
      const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0, k = (min - d) / 2;
      a.x -= ux * k; a.z -= uz * k; b.x += ux * k; b.z += uz * k;
    }
  }

  _evaluate(plan, t) {
    const tmp = new THREE.Vector3();
    const line = plan.lineAt(t);
    for (const id of plan.ids) { const A = this.actors.get(id); A._pl = plan.placement(id, t, A.root.position); }
    this._separate(plan);
    // Zemine bas: oturma kaldırması (spot y) korunur, üstüne zeminin yüksekliği eklenir.
    for (const id of plan.ids) {
      const A = this.actors.get(id);
      const lift = plan.tracks.get(id)?.init?.seated ? A.root.position.y : 0;
      A.root.position.y = this._groundY(plan.world, A.root.position.x, A.root.position.z) + lift;
      this._blob(A);
    }
    for (const id of plan.ids) {
      const A = this.actors.get(id);
      const pl = A._pl;
      A.root.rotation.y = pl.yaw;
      const expr = plan.exprAt(id, t);
      const sad = (expr.sad || 0) + (expr.cry || 0) > 0.5;
      A.pose(plan.clipsAt(id, t, A, sad));
      this._prop(A, plan.propAt(id, t));
      // Baş: bakış + (klipte yoksa) baş sallama / onaylama
      const extra = { yaw: 0, pitch: 0 };
      const tr = plan.tracks.get(id);
      for (const c of tr.clips) {
        if (c.t > t) break;
        if (t >= c.t + c.d) continue;
        const u = t - c.t, env = Math.min(1, u / 0.2) * Math.min(1, (c.t + c.d - t) / 0.3);
        if (c.clip === 'head_shake' && !A.actions.has('head_shake')) extra.yaw += 0.38 * Math.sin(u * Math.PI * 2 * 1.8) * env;
        if (c.clip === 'nod' && !A.actions.has('nod')) extra.pitch += 0.25 * Math.max(0, Math.sin(u * Math.PI * 2 * 1.4)) * env;
        if (c.clip === 'look_around' && !A.actions.has('look_around')) extra.yaw += 0.6 * Math.sin(u * 1.6) * env;
      }
      const gz = plan.gazeTarget(id, t, line);
      const look = gz && gz !== id ? this.cam.anchor(this.actors.get(gz), 'head') : null;
      if (A.kind === 'human' && !this.noHead) applyHead(A, pl.yaw, look, extra, pl.moving ? 0.35 : 0.75);
      // Yüz
      if (A.faces.length) {
        const b = blinkAt(id, t);
        if (b) { expr.blink_l = Math.max(expr.blink_l || 0, b); expr.blink_r = Math.max(expr.blink_r || 0, b); }
        const vis = this.vis[id] || (this.vis[id] = {});
        if (line && line.who === id) visemeWeightsAt(line.visemes, t - line.t, vis);
        else for (const k in vis) vis[k] = 0;
        A.setFace(expr, vis);
      }
      void tmp;
    }
  }

  _subtitle(line) {
    const key = this.subs && line ? line.id : null;
    if (key === this._subText) return;
    this._subText = key;
    if (!key) { this.subsEl.classList.remove('on'); return; }
    const name = this.names.get(line.who) || '';
    this.subsEl.innerHTML = '';
    if (name) { const n = document.createElement('div'); n.className = 'who'; n.textContent = name; this.subsEl.appendChild(n); }
    const x = document.createElement('div');
    x.className = 'txt';
    x.textContent = line.text || '';
    this.subsEl.appendChild(x);
    this.subsEl.classList.add('on');
  }

  _fade(t, si) {
    const S = this.film.scenes;
    let a = 0;
    const F = 0.45;
    a = Math.max(a, 1 - Math.min(1, t / 0.9)); // açılış
    a = Math.max(a, Math.min(1, Math.max(0, (t - (this.film.dur - 1.2)) / 1.2))); // kapanış
    const fadeIn = (s) => s && (s.trans === 'fade' || s.trans === 'fade_black');
    const sc = S[si], nx = S[si + 1];
    if (si > 0 && fadeIn(sc) && t - sc.t0 < F) a = Math.max(a, 1 - (t - sc.t0) / F);
    if (nx && fadeIn(nx) && nx.t0 - t < F) a = Math.max(a, 1 - (nx.t0 - t) / F);
    this.fadeEl.style.opacity = a.toFixed(3);
  }

  _perf(ts) {
    const f = this._fps;
    f.n++;
    const dt = ts - f.t0;
    if (dt < 2500) return;
    const fps = (f.n * 1000) / dt;
    this.stats.fps = Math.round(fps * 10) / 10;
    f.n = 0; f.t0 = ts;
    if (!this.autoQ || !this.audio.playing) return;
    if (fps < 26) {
      if (++f.lowRuns < 2) return;
      f.lowRuns = 0;
      const i = ORDER.indexOf(this.look.qname);
      if (i < ORDER.length - 1) { this.look.setQuality(ORDER[i + 1]); this.layout(); post('quality', { q: this.look.qname, auto: true }); }
      else if (this.look.prScale > 0.55) { this.look.prScale *= 0.8; this.layout(); post('quality', { q: 'low', pr: this.look.prScale, auto: true }); }
    } else f.lowRuns = 0;
  }
}

const player = new Player();
window.HadiFilm3 = { cmd: (m) => player.cmd(typeof m === 'string' ? JSON.parse(m) : m), player };
window.addEventListener('message', (e) => {
  if (e.source !== window.parent && e.source !== window) return;
  let m = e.data;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return; } }
  if (m && m.source === 'hadi-film3') return; // kendi çıkışımız
  player.cmd(m);
});
window.addEventListener('error', (e) => { if (!player.ready) post('error', { msg: String(e.message || 'hata') }); });
window.addEventListener('unhandledrejection', (e) => { if (!player.ready) post('error', { msg: String(e.reason?.message || e.reason || 'hata') }); });

// Geliştirme / tanıtım: ?demo=1 (yer tutucu varlıklarla demo.json), &film=<url>, &catalog=<url|placeholder>, &auto=1, &t=<sn>
if (params.get('demo') || params.get('film')) {
  const filmUrl = params.get('film') || 'demo.json';
  const cat = params.get('catalog');
  player.load({ type: 'load', film: filmUrl, catalog: cat || (params.get('demo') ? 'placeholder' : undefined), demo: true, start: +params.get('t') || 0, autoplay: params.get('auto') === '1', quality: params.get('q') || undefined });
}
post('boot');
