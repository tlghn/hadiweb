// HADİ Film v3 — varlık yükleme ve önbellek. film3/ varlıkları (insan, parçalar, animasyonlar, hayvanlar, sahne kitleri)
// Cache Storage'da catalog.json'daki `v` sürümüyle tutulur: bir kez iner, sürüm değişince eski önbellek silinir.
// İlk indirmede yüzde (needAsset) bildirilir. Replik sesleri filme özeldir: önbelleğe alınmaz.
import { GLTFLoader } from './addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from './addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from './addons/loaders/RGBELoader.js';
import * as THREE from 'three';

const PREFIX = 'hadi-film3-v';

export class AssetStore {
  constructor(base, onProgress) {
    this.base = base; // film3/ kökü (catalog.json'un bulunduğu klasör)
    this.onProgress = onProgress || (() => {});
    this.cache = null;
    this.v = 0;
    this.gltfs = new Map(); // url → Promise<gltf>
    this._jobs = new Map(); // url → {loaded,total,cached}
    this._lastPct = -1;
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL('./addons/libs/draco/gltf/', import.meta.url).href);
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  url(u) { return new URL(u, this.base).href; }

  async loadCatalog(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`catalog ${r.status}`);
    const cat = await r.json();
    this.base = new URL('./', r.url || url).href;
    this.v = cat.v ?? 1;
    await this._openCache();
    return cat;
  }

  async _openCache() {
    try {
      if (!('caches' in self)) return;
      const name = PREFIX + this.v;
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
      this.cache = await caches.open(name);
    } catch (e) {
      console.warn('[film3] önbellek açılamadı', e);
      this.cache = null;
    }
  }

  /** Önbellekte yoksa indirmesi gerekecek URL'ler (ilk indirme göstergesi için). */
  async missing(urls) {
    if (!this.cache) return urls.slice();
    const out = [];
    for (const u of urls) if (!(await this.cache.match(u).catch(() => null))) out.push(u);
    return out;
  }

  /** Bu toplu indirmede izlenecek işler: yüzde yalnızca bunlardan hesaplanır. */
  track(urls, sizes = {}) {
    for (const u of urls) this._jobs.set(u, { loaded: 0, total: sizes[u] || 0, done: false });
    this._emit(true);
  }

  _emit(force) {
    let loaded = 0, total = 0, any = false;
    for (const j of this._jobs.values()) {
      any = true;
      const t = j.total || Math.max(j.loaded, 2e6);
      total += t;
      loaded += j.done ? t : Math.min(j.loaded, t);
    }
    if (!any) return;
    const pct = Math.min(100, Math.floor((loaded / Math.max(1, total)) * 100));
    if (force || pct !== this._lastPct) {
      this._lastPct = pct;
      this.onProgress(pct);
    }
  }

  /** Önbellekli ArrayBuffer (ağdan gelirse önbelleğe yazar). */
  async bytes(u) {
    const url = this.url(u);
    if (this.cache) {
      const hit = await this.cache.match(url).catch(() => null);
      if (hit) return hit.arrayBuffer();
    }
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${u}: ${r.status}`);
    // Sayfa yönlendirmesi (SPA 200 + index.html) varlık sanılmasın, önbelleğe de yazılmasın.
    if (/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error(`${u}: bulunamadı`);
    const job = this._jobs.get(url);
    const total = +r.headers.get('content-length') || 0;
    if (job && total && !job.total) job.total = total;
    let buf;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      const parts = [];
      let n = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        parts.push(value);
        n += value.byteLength;
        if (job) { job.loaded = n; this._emit(); }
      }
      const all = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.byteLength; }
      buf = all.buffer;
    } else {
      buf = await r.arrayBuffer();
    }
    if (job) { job.done = true; this._emit(); }
    if (this.cache) {
      try {
        await this.cache.put(url, new Response(buf.slice(0), { headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' } }));
      } catch (e) { console.warn('[film3] önbelleğe yazılamadı', u, e); }
    }
    return buf;
  }

  /** HDRI (.hdr, önbellekli) → eşdikdörtgen DataTexture (doğrusal, yarım kayan nokta). */
  hdr(u) {
    const url = this.url(u);
    this._hdr = this._hdr || new Map();
    if (!this._hdr.has(url)) {
      this._hdr.set(url, (async () => {
        const d = new RGBELoader().setDataType(THREE.HalfFloatType).parse(await this.bytes(url));
        const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
        t.colorSpace = THREE.LinearSRGBColorSpace;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.flipY = true;
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.needsUpdate = true;
        return t;
      })());
    }
    return this._hdr.get(url);
  }

  /** Resim dokusu (önbellekli; ör. HDRI arka planı .webp). */
  image(u, srgb = true) {
    const url = this.url(u);
    this._img = this._img || new Map();
    if (!this._img.has(url)) {
      this._img.set(url, (async () => {
        const blob = new Blob([await this.bytes(url)]);
        const obj = URL.createObjectURL(blob);
        try {
          const t = await new THREE.TextureLoader().loadAsync(obj);
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          t.mapping = THREE.EquirectangularReflectionMapping;
          return t;
        } finally { URL.revokeObjectURL(obj); }
      })());
    }
    return this._img.get(url);
  }

  /** glTF/glb (aynı URL bir kez çözülür; klonlamak çağıranın işi). */
  gltf(u) {
    const url = this.url(u);
    if (!this.gltfs.has(url)) {
      this.gltfs.set(url, (async () => {
        const buf = await this.bytes(url);
        return await new Promise((res, rej) => this.loader.parse(buf, new URL('./', url).href, res, rej));
      })());
    }
    return this.gltfs.get(url);
  }
}
