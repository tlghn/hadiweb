// HADİ Film v3 — karakter kurulumu. human.glb her karakter için klonlanır (SkeletonUtils); gövde morph'ları (yaş, kilo,
// boy, yüz biçimi…) BİR KEZ CPU'da fırınlanır (konum + normal) ve geometriden çıkarılır; yalnızca ifade ve visem
// morph'ları canlı kalır (karede maliyet yok). İskelet, A'nın extras'ına göre yeni bedene oturtulur:
//   userData.jointDeltas = { "<morph hedefi>": { "<kemik>": [dx,dy,dz] } }   (hedef ağırlığıyla çarpılıp toplanır), ya da
//   userData.joints      = { "<kemik>": [köşe indeksleri] }                   (fırınlanmış köşelerin ortalaması).
// Parçalar (saç, kaş, sakal, bıyık, giysi) aynı iskelete bağlanır: aynı adlı gövde morph'larını taşıyorlarsa onlar da
// fırınlanır (yeni bedene tam oturur); taşımıyorlarsa kemiklerin yeni yerine göre taşınır. Şapka / el eşyası (iskeletsiz)
// ilgili kemiğe takılır. Hayvanlar: animals/*.glb klonu + renk tonu.
import * as THREE from 'three';
import * as SkeletonUtils from './addons/utils/SkeletonUtils.js';
import { HumanRig, ageToValue } from './human_rig.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _qs = new THREE.Quaternion();

export const EXPR_FALLBACK = {
  cry: { sad: 1, blink_l: 0.35, blink_r: 0.35 },
  laugh: { smile: 1, aa: 0.45 },
  shout: { angry: 0.6, aa: 0.8 },
  fear: { surprise: 0.6, sad: 0.4 },
  disgust: { angry: 0.4 },
  think: {},
};
const CALM = /^(idle|wait|listen|walk|run|march|sneak|carry|talk_gesture|sit_idle|idle_hands|idle_arms)/;
// Hareket yakalama kliplerinin baş/boyun izleri ham (CMU): yüksek frekanslı titreme, döngü dikişinde sıçrama (≤1500°/sn)
// ve duygu kliplerinde (gülme, ağlama, korku) sürekli baş sallama taşır — "kafalar hiç durmuyor" şikâyetinin ana nedeni.
// Baş/boyun klipten yalnızca bu kazançla alınır (0 = boyun ebeveynine göre dinlenme pozu, gövdeyle birlikte gider);
// baş hareketi senaryo isterse (nod / head_shake / look_around…) ve yalnızca o beat süresince gelir.
// 25 Ekim (gerçek film ölçümü, Kaşağı): baş jestleri 0,6–0,8 kazançla 70–140°/sn (head_shake, head_down), duygu klipleri
// (gülme 0,2) 130°/sn'ye çıkıyordu → kazançlar yarıya yakın indirildi; hız ayrıca filterHead'de sınırlanır (HEAD_SLEW).
const HEAD_GAIN = {
  nod: 0.45, head_shake: 0.35, look_around: 0.35, head_down: 0.5, think: 0.2, bow: 0.5, pray: 0.4,
  cry: 0.1, cry_face: 0.15, laugh: 0.08, happy: 0.06, scared: 0.08, upset: 0.08, angry_gesture: 0.06, shrug: 0.1,
  fall: 0.6, lie: 0.6, lie_idle: 0.6, get_up: 0.5, stand_up: 0.4, sit: 0.4, sit_ground: 0.4, kneel: 0.4, kneel_idle: 0.4,
  pick_up: 0.3, drink: 0.3, eat: 0.2, dig: 0.2, sweep: 0.2, write_board: 0.2, hold_baby: 0.2, comb_horse: 0.12,
};
const headGain = (clip) => (clip in HEAD_GAIN ? HEAD_GAIN[clip] : CALM.test(clip) ? 0 : 0.06);
// Baş/boyun kemiği başına en çok açısal hız (°/sn, klipten gelen poz): sakin 12 (baş+boyun ≤ ~24), senaryodaki baş jesti
// (onaylama, baş sallama, etrafa bakma, başı eğme) 32, gövde duruşu değişimi (yatma, kalkma, eğilme, diz çökme) 60.
const HEAD_GEST = /^(nod|head_shake|look_around|head_down|think)$/;
const HEAD_BODY = /^(fall|lie|lie_idle|get_up|stand_up|sit|sit_ground|kneel|kneel_idle|bow|pray|pick_up)$/;
const HEAD_SLEW = { calm: 12, gest: 32, body: 60 };
const EXPR_ALIAS = { happy: 'smile', joy: 'smile', scared: 'fear', afraid: 'fear', surprised: 'surprise', anger: 'angry', mad: 'angry', crying: 'cry', thinking: 'think', worried: 'sad', calm: 'neutral' };
const EXPR_PREFIX =['', 'expr_', 'ex_', 'exp_', 'face_', 'expression_'];
const VIS_PREFIX = ['', 'viseme_', 'vis_', 'v_', 'viseme-'];
const PAIRS = [['_dec', '_inc'], ['-', '+'], ['_down', '_up'], ['_min', '_max'], ['_less', '_more'], ['_decr', '_incr'], ['_neg', '_pos']];

function findBone(root, re, not) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.isBone && re.test(o.name) && !(not && not.test(o.name))) hit = o; });
  return hit;
}

/** Katalogdaki morph tanımları: id → {neutral,min,max,targets}. */
function morphDefs(cat) {
  const out = new Map();
  for (const m of cat?.human?.morphs || []) {
    if (typeof m === 'string') out.set(m, {});
    else if (m && (m.id || m.name)) out.set(m.id || m.name, m);
  }
  return out;
}

/** Karakterin morph değerlerinden (0..1) bu mesh'in hedef ağırlıkları. */
function targetWeights(dict, values, defs) {
  const out = {};
  for (const [id, raw] of Object.entries(values || {})) {
    if (typeof raw !== 'number' || !isFinite(raw)) continue;
    const def = defs.get(id) || {};
    const lo = def.min ?? 0, hi = def.max ?? 1;
    const v = (Math.min(hi, Math.max(lo, raw)) - lo) / Math.max(1e-6, hi - lo);
    let dec = def.targets?.lo || def.targets?.dec, inc = def.targets?.hi || def.targets?.inc;
    if (!dec || !inc) for (const [a, b] of PAIRS) if (`${id}${a}` in dict && `${id}${b}` in dict) { dec = `${id}${a}`; inc = `${id}${b}`; break; }
    if (dec && inc && dec in dict && inc in dict) {
      const n = def.neutral ?? 0.5;
      out[inc] = v > n ? (v - n) / Math.max(1e-6, 1 - n) : 0;
      out[dec] = v < n ? (n - v) / Math.max(1e-6, n) : 0;
      continue;
    }
    const t = def.target || id;
    if (t in dict) {
      const n = def.neutral ?? 0;
      out[t] = v >= n ? (n < 1 ? (v - n) / (1 - n) : 0) : (n > 0 ? (v - n) / n : 0);
    }
  }
  return out;
}

function liveName(name, live) {
  if (live.has(name)) return true;
  return /^(expr|ex|exp|face|expression|viseme|vis|v)[_-]/i.test(name);
}

/** Gövde morph'larını fırınlar; canlı (ifade/visem) olanları bırakır. Fırınlanmış konum dizisini döndürür. */
function bakeMesh(mesh, weights, live) {
  const g0 = mesh.geometry;
  const dict = mesh.morphTargetDictionary;
  if (!dict || !g0.morphAttributes.position) return null;
  // Yeni geometri: kaynak öznitelikler PAYLAŞILIR (yalnızca konum/normal yeni). g0.clone() nicemlenmiş, iç içe (interleaved)
  // özniteliklerde morph verisini yanlış eşleyebiliyor (konum iki kez eklenmiş çıkıyordu).
  const g = new THREE.BufferGeometry();
  if (g0.index) g.setIndex(g0.index);
  for (const [k, v] of Object.entries(g0.attributes)) if (k !== 'position' && k !== 'normal') g.setAttribute(k, v);
  for (const gr of g0.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.morphTargetsRelative = g0.morphTargetsRelative;
  g.userData = { ...g0.userData };
  const pos = g0.attributes.position, nor = g0.attributes.normal;
  const n = pos.count;
  const P = new Float32Array(n * 3), N = nor ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
    if (N) { N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i); }
  }
  const mp = g0.morphAttributes.position, mn = g0.morphAttributes.normal;
  const rel = g.morphTargetsRelative;
  const keep = [];
  for (const [name, idx] of Object.entries(dict)) {
    if (liveName(name, live)) { keep.push([name, idx]); continue; }
    const w = weights[name] || 0;
    if (!w) continue;
    const a = mp[idx];
    for (let i = 0; i < n; i++) {
      P[i * 3] += w * (a.getX(i) - (rel ? 0 : pos.getX(i)));
      P[i * 3 + 1] += w * (a.getY(i) - (rel ? 0 : pos.getY(i)));
      P[i * 3 + 2] += w * (a.getZ(i) - (rel ? 0 : pos.getZ(i)));
    }
    if (N && mn && mn[idx]) {
      const b = mn[idx];
      for (let i = 0; i < n; i++) {
        N[i * 3] += w * (b.getX(i) - (rel ? 0 : nor.getX(i)));
        N[i * 3 + 1] += w * (b.getY(i) - (rel ? 0 : nor.getY(i)));
        N[i * 3 + 2] += w * (b.getZ(i) - (rel ? 0 : nor.getZ(i)));
      }
    }
  }
  if (N) for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  }
  // Canlı morph'lar göreli olmalı: değilse tabana göre farka çevrilir (taban değiştiği için).
  const relOf = (arr, base) => {
    if (rel) return arr;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { out[i * 3] = arr.getX(i) - base.getX(i); out[i * 3 + 1] = arr.getY(i) - base.getY(i); out[i * 3 + 2] = arr.getZ(i) - base.getZ(i); }
    return new THREE.Float32BufferAttribute(out, 3);
  };
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const newDict = {};
  if (keep.length) {
    g.morphAttributes.position = keep.map(([nm, i]) => relOf(mp[i], pos));
    if (mn) g.morphAttributes.normal = keep.map(([nm, i]) => (mn[i] ? relOf(mn[i], nor) : new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)));
    else delete g.morphAttributes.normal;
    keep.forEach(([nm], i) => { newDict[nm] = i; });
    g.morphTargetsRelative = true;
  } else {
    g.morphAttributes = {};
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  mesh.geometry = g;
  if (keep.length) {
    mesh.morphTargetDictionary = newDict;
    mesh.morphTargetInfluences = keep.map(() => 0);
  } else {
    mesh.morphTargetDictionary = undefined;
    mesh.morphTargetInfluences = undefined;
  }
  return P;
}

/** Gerçekçilik: deri (yumuşak saçılma benzeri sheen), saç/kaş/sakal (anizotropik parlama), göz (kornea yansıması). */
function physical(m) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return m;
  const x = m.userData || {}; // A'nın malzeme extras'ı: role, sss, sheen, specular, hair, fabric
  const n = (m.name || '') + ' ' + (x.role || '');
  const skin = x.role === 'skin' || /^skin\b/i.test(m.name || '');
  const hair = !/[?&]nohair=1/.test(globalThis.location?.search || '') && (!!x.hair || /hair|brow|beard|must|lash/i.test(n));
  const eye = x.role === 'cornea' || /cornea/i.test(n);
  const fabric = typeof x.fabric === 'string' ? x.fabric : null;
  if (!skin && !hair && !eye && !fabric) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.name = m.name;
  p.userData = { ...x };
  if (skin) {
    // Deri: yüzey altı saçılma benzeri yumuşaklık (sıcak sheen) + düşük speküler.
    const sh = x.sheen || {}, ss = x.sss || {};
    p.sheen = Math.min(0.16, (sh.strength ?? 0.12) * 0.6 + (ss.strength ?? 0.3) * 0.2); // yalnızca kenarda sıcak yumuşaklık (fazlası teni ağartır)
    p.sheenColor.set(ss.color || sh.color || '#ff8f7a');
    p.sheenRoughness = sh.roughness ?? 0.6;
    p.specularIntensity = Math.min(0.4, typeof x.specular === 'number' ? x.specular : 0.4);
    p.roughness = Math.min(0.7, Math.max(0.42, m.roughness));
  }
  if (hair) {
    const h = typeof x.hair === 'object' ? x.hair : {};
    // Not: three r170 anizotropisi tanjant özniteliği olmayan (türevden tanjant) saç kartlarında NaN üretebiliyor; bloom bunu
    // siyah bloklara yayıyor. Tanjant varsa açılır; yoksa saç parlaması sheen ile verilir.
    if (h.anisotropy && m.userData?.hasTangents) { p.anisotropy = h.anisotropy; p.anisotropyRotation = h.rotation ?? 0; }
    p.roughness = Math.max(0.3, m.roughness * 0.85);
    p.sheen = 0.25; p.sheenRoughness = 0.4; p.sheenColor.copy(m.color || new THREE.Color('#ffffff'));
  }
  if (eye) { p.clearcoat = 1; p.clearcoatRoughness = 0.02; p.roughness = 0.04; p.specularIntensity = 1; }
  if (fabric) {
    const F = { wool: [0.6, 0.9], felt: [0.7, 0.95], cotton: [0.35, 0.85], linen: [0.3, 0.8], silk: [0.45, 0.35], leather: [0.1, 0.55] };
    const tr = { keten: 'linen', pamuk: 'cotton', yün: 'wool', yun: 'wool', ipek: 'silk', deri: 'leather', keçe: 'felt', kece: 'felt' };
    const f = F[tr[fabric] || fabric] || [0.4, 0.85];
    p.sheen = f[0]; p.sheenRoughness = 0.7; p.sheenColor.copy(m.color || new THREE.Color('#ffffff')).lerp(new THREE.Color('#ffffff'), 0.3);
    p.roughness = Math.max(m.roughness, f[1] * 0.9);
    if ((tr[fabric] || fabric) === 'leather') { p.clearcoat = 0.25; p.clearcoatRoughness = 0.5; }
  }
  return p;
}

function cloneMaterials(obj) {
  obj.traverse((o) => {
    // SkeletonUtils.clone bağ matrislerini (boneInverses) kaynakla ve öteki klonlarla PAYLAŞIR: eklemler her karaktere göre
    // yeniden hesaplandığı için her mesh kendi kopyasını almalı (yoksa son kurulan karakterin bedeni herkese uygulanır).
    if (o.isSkinnedMesh) o.skeleton.boneInverses = o.skeleton.boneInverses.map((m) => m.clone());
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => physical(m.clone())) : physical(o.material.clone());
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
  });
}
function mats(o) { return Array.isArray(o.material) ? o.material : [o.material]; }

function tintObject(obj, color, pick) {
  if (!color) return;
  const c = new THREE.Color(color);
  let largest = null, best = -1;
  const named = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of mats(o)) {
      if (pick ? pick.test(m.name || '') : true) named.push(m);
      const n = o.geometry.attributes.position.count;
      if (n > best) { best = n; largest = m; }
    }
  });
  const list = pick ? (named.length ? named : largest ? [largest] : []) : named;
  for (const m of list) if (m.color) m.color.copy(c);
}

/** Bütün kemikler, adla. */
function boneMap(root) {
  const out = {};
  root.traverse((o) => { if (o.isBone) out[o.name] = o; });
  return out;
}

function depth(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }

/** İskeleti yeni (morph'lu) bedene oturtur. */
function repositionJoints(model, body, tw, bakedP) {
  let jd = null, jv = null;
  model.traverse((o) => {
    const u = o.userData || {};
    if (!jd && u.jointDeltas) jd = u.jointDeltas;
    if (!jv && u.joints) jv = u.joints;
  });
  if (!jd && !jv) return false;
  const skel = body.skeleton;
  skel.pose();
  model.updateMatrixWorld(true);
  const desired = new Map();
  const lin = new THREE.Matrix3().setFromMatrix4(body.bindMatrix);
  const pos = (b) => desired.get(b) || new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  const bones = boneMap(model);
  if (jd) for (const [t, w] of Object.entries(tw)) {
    if (!w || !jd[t]) continue;
    for (const [bn, d] of Object.entries(jd[t])) {
      const b = bones[bn];
      if (!b) continue;
      const p = pos(b);
      p.add(_v.fromArray(d).applyMatrix3(lin).multiplyScalar(w));
      desired.set(b, p);
    }
  }
  if (jv && bakedP) for (const [bn, idx] of Object.entries(jv)) {
    const b = bones[bn];
    if (!b || !idx || !idx.length) continue;
    const p = new THREE.Vector3();
    for (const i of idx) p.x += bakedP[i * 3], p.y += bakedP[i * 3 + 1], p.z += bakedP[i * 3 + 2];
    p.multiplyScalar(1 / idx.length).applyMatrix4(body.bindMatrix);
    desired.set(b, p);
  }
  const order = [...desired.keys()].sort((a, b) => depth(a) - depth(b));
  for (const b of order) {
    const w = desired.get(b);
    b.parent.updateMatrixWorld(true);
    _m.copy(b.parent.matrixWorld).invert();
    b.position.copy(w).applyMatrix4(_m);
    b.updateMatrixWorld(true);
  }
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.calculateInverses(); });
  return true;
}

export class Actor {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name || def.id;
    this.kind = def.kind || 'human';
    this.root = new THREE.Group();
    this.root.name = 'actor:' + def.id;
    this.model = null;
    this.mixer = null;
    this.actions = new Map();
    this.speeds = {};
    this.faces = [];
    this.height = 1.7;
    this.eyeH = 1.6;
    this.rest = new Map();
    this._active = new Set();
  }

  _finish(model, clips, speeds) {
    this.model = model;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) {
      const a = this.mixer.clipAction(c);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = true;
      this.actions.set(c.name, a);
    }
    this.speeds = speeds || {};
    const b = this.bones = {
      head: findBone(model, /^head$/i) || findBone(model, /head/i, /end|top|nub/i),
      neck: findBone(model, /^neck(_01)?$/i) || findBone(model, /neck/i),
      hips: findBone(model, /^(pelvis|hips?)$/i) || findBone(model, /pelvis|hips/i) || findBone(model, /body|spine/i),
      handR: findBone(model, /^hand_r$/i) || findBone(model, /(hand.?r|r.?hand|righthand)/i),
      eyes: [],
    };
    model.traverse((o) => { if (o.isBone && /^eye/i.test(o.name)) b.eyes.push(o); });
    for (const x of [b.head, b.neck, ...b.eyes]) if (x) this.rest.set(x, x.quaternion.clone());
    // Boy ve göz yüksekliği: bağlanma pozundaki sınır kutusu.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    if (!box.isEmpty()) {
      this.height = box.max.y - Math.min(0, box.min.y);
      this.length = box.max.z - box.min.z;
      this.width = box.max.x - box.min.x;
    }
    const hb = b.head;
    if (hb && this.kind === 'human') {
      hb.getWorldPosition(_v);
      this.eyeH = Math.min(this.height * 0.97, _v.y + (this.height - _v.y) * 0.42);
    } else if (hb) {
      hb.getWorldPosition(_v);
      this.eyeH = _v.y;
      this.headZ = _v.z;
    } else {
      this.eyeH = this.height * 0.93;
    }
  }

  /** İfade/visem morph indeksleri (her mesh için). */
  _collectFaces(cat) {
    const H = cat?.human || {};
    if (H.units && H.expressions && !Array.isArray(H.expressions)) {
      // A'nın yüzü: ifade/visem = yüz birimleri (u_*) tarifleri; mesh'lerde yalnızca birimler canlı.
      this.recipes = { expr: H.expressions, vis: H.visemes || {} };
      this.faces = [];
      this.model.traverse((o) => {
        if (!o.isMesh || !o.morphTargetDictionary) return;
        const map = {};
        for (const u of H.units) if (u in o.morphTargetDictionary) map[u] = o.morphTargetDictionary[u];
        if (Object.keys(map).length) this.faces.push({ mesh: o, map });
      });
      this.has = new Set([...Object.keys(H.expressions), ...Object.keys(H.visemes || {})]);
      return;
    }
    const ex = new Set(Array.isArray(H.expressions) ? H.expressions : Object.keys(H.expressions || {}));
    const vs = new Set(Array.isArray(H.visemes) ? H.visemes : Object.keys(H.visemes || {}));
    for (const k of Object.keys(EXPR_FALLBACK)) ex.add(k);
    ex.add('blink_l'); ex.add('blink_r');
    this.faces = [];
    this.model.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary) return;
      const d = o.morphTargetDictionary;
      const map = {};
      const look = (n, prefixes) => { for (const p of prefixes) { if (`${p}${n}` in d) return d[`${p}${n}`]; if (`${p}${n.toLowerCase()}` in d) return d[`${p}${n.toLowerCase()}`]; } return -1; };
      for (const n of ex) { const i = look(n, EXPR_PREFIX); if (i >= 0) map[n] = i; }
      for (const n of vs) { const i = look(n, VIS_PREFIX); if (i >= 0) map[n] = i; }
      if (Object.keys(map).length) this.faces.push({ mesh: o, map });
    });
    this.has = new Set(this.faces.flatMap((f) => Object.keys(f.map)));
  }

  /** expr: {ad: ağırlık}; vis: {visem: ağırlık}. Eksik ifade benzerleriyle kurulur. */
  setFace(expr, vis) {
    if (!this.faces.length) return;
    const w = this._w || (this._w = {});
    for (const k in w) w[k] = 0;
    if (this.recipes) {
      const add = (r, k) => { if (r) for (const [u, v] of Object.entries(r)) w[u] = (w[u] || 0) + v * k; };
      for (const [k, v] of Object.entries(expr)) if (v) add(this.recipes.expr[k] || this.recipes.expr[EXPR_ALIAS[k]], v);
      for (const [k, v] of Object.entries(vis)) if (v) add(this.recipes.vis[k], v);
      for (const f of this.faces) {
        const inf = f.mesh.morphTargetInfluences;
        for (const [u, i] of Object.entries(f.map)) inf[i] = Math.min(1, w[u] || 0);
      }
      return;
    }
    for (const [k, v] of Object.entries(expr)) {
      if (!v) continue;
      if (this.has.has(k)) w[k] = (w[k] || 0) + v;
      else if (EXPR_FALLBACK[k]) for (const [k2, v2] of Object.entries(EXPR_FALLBACK[k])) w[k2] = (w[k2] || 0) + v * v2;
    }
    for (const [k, v] of Object.entries(vis)) if (v) w[k] = (w[k] || 0) + v;
    for (const f of this.faces) {
      const inf = f.mesh.morphTargetInfluences;
      inf.fill(0);
      for (const [k, i] of Object.entries(f.map)) if (w[k]) inf[i] = Math.min(1, w[k]);
    }
  }

  /** Klipleri uygular: list = [{clip, time, weight}] (zamanı ve ağırlığı yönetmen belirler; seek'e dayanıklı). */
  pose(list) {
    if (!this.mixer) return;
    for (const [x, q] of this.rest) x.quaternion.copy(q); // izi olmayan kemikler birikmesin
    const now = new Set();
    for (const it of list) {
      const a = this.actions.get(it.clip);
      if (!a || it.weight <= 0.001) continue;
      if (!a.isRunning()) { a.reset(); a.play(); }
      a.enabled = true;
      a.paused = false;
      a.timeScale = 0;
      const dur = a.getClip().duration || 1;
      a.time = it.loop === false ? Math.min(dur - 1e-3, Math.max(0, it.time)) : ((it.time % dur) + dur) % dur;
      a.weight = it.weight;
      now.add(a);
    }
    for (const a of this._active) if (!now.has(a)) { a.stop(); }
    this._active = now;
    this.mixer.update(0);
    // Sakin kliplerde (bekleme, yürüme, konuşma jesti) hareket yakalamanın baş/boyun salınımı yumuşatılır: bakışı yönetmen
    // verir (yakın planda başın kendiliğinden yukarı bakması tuhaf durur).
    let g = 0, wsum = 0;
    let mode = 'calm';
    for (const it of list) {
      if (it.weight <= 0.001) continue;
      g += headGain(it.clip) * it.weight; wsum += it.weight;
      if (it.weight > 0.2) { if (HEAD_BODY.test(it.clip)) mode = 'body'; else if (mode === 'calm' && HEAD_GEST.test(it.clip)) mode = 'gest'; }
    }
    g = wsum > 0 ? g / Math.max(1, wsum) : 0;
    this._headMode = mode;
    for (const x of [this.bones.neck, this.bones.head]) { const q = this.rest.get(x); if (q && x) x.quaternion.slerp(q, 1 - g); }
  }

  /** Klip pozunu zamanda süzer (kemik başına tek kutuplu alçak geçiren): ham hareket yakalamanın titremesi, tek karelik
   * sıçramaları (ör. idle'da 2,4. sn'de omurgada ~3°) ve döngü dikişleri görünmez. Omurga/boyun/baş τ≈80 ms (onaylama ve
   * baş sallama ≈1–1,5 Hz korunur), diğer kemikler τ≈40 ms (tokat, el sallama keskin kalır). snap: arama/kesme — anında. */
  filterHead(dt, snap) {
    const F = this._hf || (this._hf = new Map());
    if (!this._fb) {
      this._fb = [];
      this.model.traverse((o) => { if (o.isBone) this._fb.push([o, /spine|neck|head|clavicle|chest/i.test(o.name) ? 0.08 : 0.04]); });
    }
    const h = snap || !(dt > 0) ? 0 : Math.min(0.1, dt);
    const lim = new Set([this.bones?.neck, this.bones?.head].filter(Boolean));
    const vmax = THREE.MathUtils.degToRad(HEAD_SLEW[this._headMode] || HEAD_SLEW.calm) * h;
    for (const [x, tau] of this._fb) {
      let q = F.get(x);
      if (!q) { q = x.quaternion.clone(); F.set(x, q); }
      if (!h) q.copy(x.quaternion);
      else if (lim.has(x)) {
        // Baş/boyun: alçak geçiren + hız sınırı (klip geçişleri ve jestler başı savurmaz).
        _qs.copy(q).slerp(x.quaternion, 1 - Math.exp(-h / tau));
        const ang = q.angleTo(_qs);
        if (ang > vmax && ang > 1e-6) q.slerp(_qs, vmax / ang); else q.copy(_qs);
      } else q.slerp(x.quaternion, 1 - Math.exp(-h / tau));
      x.quaternion.copy(q);
    }
  }

  clipFor(name) {
    if (this.actions.has(name)) return name;
    const alias = { walk_slow: 'walk', run: this.kind === 'animal' ? 'gallop' : 'walk', trot: 'walk', gallop: 'run', idle_sad: 'idle', sit_idle: 'sit', talk_gesture_2: 'talk_gesture_1', neigh: 'idle', eat: 'idle' };
    let n = alias[name];
    for (let i = 0; i < 3 && n; i++) { if (this.actions.has(n)) return n; n = alias[n]; }
    return this.actions.has('idle') ? 'idle' : null;
  }

  clipDur(name) { return this.actions.get(name)?.getClip().duration || 1; }
}

/** Animasyon kliplerini aktöre uyarlar: kalça dışındaki konum/ölçek izleri atılır; kalça izi yeni boya ölçeklenir ve
 * yatay kök hareketi silinir (yönetmen yürütür). Kalça izi ebeveyn (Root) YEREL çerçevesindedir ve Root'un rest dönüşü
 * olabilir (A'nın iskeletinde ~90°: yükseklik yerel Z'de) — yükseklik ekseni [up] ebeveynin dünya dönüşünden gelir. */
function retarget(clips, hipsName, refLocal, newLocal, up, mode) {
  const U = (up || new THREE.Vector3(0, 1, 0)).clone().normalize();
  const out = [];
  const refH = refLocal ? refLocal.dot(U) : 0;
  const newH = newLocal ? newLocal.dot(U) : 0;
  const scale = refLocal && newLocal && Math.abs(refH) > 0.01 ? newH / refH : 1;
  const d = new THREE.Vector3();
  for (const c0 of clips) {
    const tracks = [];
    for (const t of c0.tracks) {
      const [node, prop] = t.name.split('.');
      if (prop === 'scale') continue;
      if (prop === 'position') {
        if (node !== hipsName) continue;
        const v = t.values.slice();
        const ref = refLocal || new THREE.Vector3(v[0], v[1], v[2]);
        const base = newLocal || ref;
        // B: kalça ötelemesi rest'e göre FARK (delta) olarak da gelebilir — ilk kare rest boyunun çok altındaysa fark sayılır.
        const delta = mode === 'delta' || (mode !== 'abs' && Math.abs(new THREE.Vector3(v[0], v[1], v[2]).dot(U)) < Math.abs(refH) * 0.3);
        for (let i = 0; i < v.length; i += 3) {
          if (delta) d.set(v[i], v[i + 1], v[i + 2]);
          else d.set(v[i] - ref.x, v[i + 1] - ref.y, v[i + 2] - ref.z);
          const h = d.dot(U) * scale; // yalnızca dikey bileşen (zıplama, oturma, eğilme); yatay kök hareketi yok
          v[i] = base.x + U.x * h;
          v[i + 1] = base.y + U.y * h;
          v[i + 2] = base.z + U.z * h;
        }
        tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
        continue;
      }
      tracks.push(t);
    }
    out.push(new THREE.AnimationClip(c0.name, c0.duration, tracks));
  }
  return out;
}

/** Kalçanın ebeveyn çerçevesinde dünya "yukarı" ekseni (bağlanma pozunda). */
function upInParent(bone) {
  if (!bone || !bone.parent) return new THREE.Vector3(0, 1, 0);
  bone.parent.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion();
  bone.parent.getWorldQuaternion(q);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(q.invert());
}

function clipName(n) {
  const s = String(n || '').split('|').pop().trim().toLowerCase().replace(/\s+/g, '_');
  return s;
}

/** Parça: tam kimlik, yoksa ek sayısız / önekli eşleşme (ör. "village_boy_1" → "village_boy"). */
export function findPart(cat, slot, id) {
  const list = cat.parts?.[slot] || [];
  if (!id || id === 'none') return null;
  const base = String(id).replace(/_\d+$/, '');
  return list.find((p) => p.id === id) || list.find((p) => p.id === base) || list.find((p) => p.id.startsWith(base) || base.startsWith(p.id)) || null;
}

/** D'nin karakter parametreleri → A'nın parametreleri (yaş yıl olarak da gelebilir; cinsiyet aralığı A'nın notuna göre). */
export function shapeParams(cat, def) {
  const p = { ...(def.morphs || {}) };
  if (p.age == null && typeof def.age === 'number') p.age = ageToValue(def.age);
  if (def.sex === 'f') p.gender = Math.min(p.gender ?? 0.05, 0.1);
  else if (def.sex === 'm') p.gender = Math.max(p.gender ?? 0.95, 0.9);
  const P = cat.human.params || {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'number' || !isFinite(v)) { delete p[k]; continue; }
    const d = P[k];
    if (d) p[k] = Math.min(d.max ?? 1, Math.max(d.min ?? 0, v));
  }
  return p;
}

/** Giysi parçası yoksa (henüz üretilmemiş / yüklenemedi) taban gövde ASLA çıplak görünmez: gövde bölgeleri düz kumaşla
 * örtülür (uzun kollu gömlek + pantolon / uzun etek, ayakkabı). HADİ'de çıplaklık yok. */
function modestyOutfit(rig, def) {
  const h = Math.floor(hashStr(def.id || 'x') * 1000);
  const shirts = ['#d9cfb8', '#a9b2ba', '#8a6f52', '#6f7a5a', '#b9a58a'];
  const pants = ['#3e3a35', '#4a4038', '#2f3338', '#5a4a3a'];
  const female = def.sex === 'f';
  const cloth = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, name: 'modesty' });
  const top = cloth(shirts[h % shirts.length]);
  const bottom = cloth(female ? shirts[(h + 2) % shirts.length] : pants[h % pants.length]);
  const shoe = cloth('#2a1d14');
  const map = { chest: top, belly: top, upperarm: top, lowerarm: top, hips: bottom, thigh: bottom, calf: bottom, foot: shoe };
  for (const m of rig.meshes) {
    const reg = m.userData?.region || m.parent?.userData?.region;
    const mat = reg ? map[reg] : undefined;
    if (mat) { m.material = mat; m.userData.modesty = true; }
  }
}
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }

/** Bağlanma pozunda (ya da şimdiki pozda) mesh köşelerinin dünya konumları üzerinden kutu: deriyi kemiklerle dönüştürür. */
function skinnedWorldBox(mesh, step = 3) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  if (mesh.isSkinnedMesh) mesh.skeleton.update();
  const n = mesh.geometry.attributes.position.count;
  for (let i = 0; i < n; i += step) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); box.expandByPoint(v); }
  return box;
}

/** Konum özniteliğini yazılabilir Float32 kopyaya çevirir (nicemlenmiş / iç içe olsa da); diğerleri paylaşılır. */
function ownPositions(mesh) {
  const g0 = mesh.geometry, p0 = g0.attributes.position;
  if (p0.isBufferAttribute && p0.array instanceof Float32Array && !p0.isInterleavedBufferAttribute && g0.userData.ownPos) return;
  const g = new THREE.BufferGeometry();
  if (g0.index) g.setIndex(g0.index);
  for (const [k, v] of Object.entries(g0.attributes)) if (k !== 'position') g.setAttribute(k, v);
  for (const [k, v] of Object.entries(g0.morphAttributes)) g.morphAttributes[k] = v;
  g.morphTargetsRelative = g0.morphTargetsRelative;
  for (const gr of g0.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  const P = new Float32Array(p0.count * 3);
  for (let i = 0; i < p0.count; i++) { P[i * 3] = p0.getX(i); P[i * 3 + 1] = p0.getY(i); P[i * 3 + 2] = p0.getZ(i); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.userData = { ...g0.userData, ownPos: true };
  mesh.geometry = g;
}

/** Biçim hedefi taşımayan şapkayı yeni başa oturtur: taban baş kutusu (c0, genişlik w0) → yeni baş kutusu (c1, w1).
 * Dünya uzayındaki kayma, köşenin kemik dönüşümünün tersiyle ham (nicemlenmiş) uzaya çevrilir. */
/** Deri bağlı mesh'in köşelerini DÜNYA uzayında fn(w) ile dönüştürür (nicemlenmiş ham uzaya geri çevirerek). */
function transformSkinned(mesh, fn) {
  if (!mesh.isSkinnedMesh) return;
  ownPositions(mesh);
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = mesh.skeleton;
  sk.update();
  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), Mi = new THREE.Matrix4(), v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const wt = sw.getComponent(i, j);
      if (!wt) continue;
      T.multiplyMatrices(sk.bones[si.getComponent(i, j)].matrixWorld, sk.boneInverses[si.getComponent(i, j)]);
      for (let e = 0; e < 16; e++) M.elements[e] += T.elements[e] * wt;
    }
    M.multiply(mesh.bindMatrix);
    v.fromBufferAttribute(pos, i);
    w.copy(v).applyMatrix4(M);
    fn(w);
    Mi.copy(M).invert();
    w.applyMatrix4(Mi);
    pos.setXYZ(i, w.x, w.y, w.z);
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
}

function translateSkinned(mesh, dWorld) {
  if (!mesh.isSkinnedMesh) return;
  ownPositions(mesh);
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = mesh.skeleton;
  sk.update();
  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), L = new THREE.Matrix3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const wt = sw.getComponent(i, j);
      if (!wt) continue;
      T.multiplyMatrices(sk.bones[si.getComponent(i, j)].matrixWorld, sk.boneInverses[si.getComponent(i, j)]);
      for (let e = 0; e < 16; e++) M.elements[e] += T.elements[e] * wt;
    }
    M.multiply(mesh.bindMatrix);
    L.setFromMatrix4(M).invert();
    d.copy(dWorld).applyMatrix3(L);
    pos.setXYZ(i, pos.getX(i) + d.x, pos.getY(i) + d.y, pos.getZ(i) + d.z);
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
}

/** Şapka kutusu: {c: (orta x, ALT y, orta z)}. */
function hatInfo(obj) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { if (o.isSkinnedMesh && o.visible && !/hair/i.test(o.material?.name || '')) box.union(skinnedWorldBox(o)); });
  if (box.isEmpty()) return null;
  return { c: new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2) };
}

function fitToHead(mesh, h0, h1) {
  if (!mesh.isSkinnedMesh || !h0 || !h1) return;
  ownPositions(mesh);
  const g = mesh.geometry, pos = g.attributes.position;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const sk = mesh.skeleton;
  sk.update();
  const k = (h1.w / Math.max(1e-4, h0.w));
  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), L = new THREE.Matrix3(), v = new THREE.Vector3(), w = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const wt = sw.getComponent(i, j);
      if (!wt) continue;
      const b = si.getComponent(i, j);
      T.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
      for (let e = 0; e < 16; e++) M.elements[e] += T.elements[e] * wt;
    }
    M.multiply(mesh.bindMatrix);
    v.fromBufferAttribute(pos, i);
    w.copy(v).applyMatrix4(M);
    d.set(h1.c.x + (w.x - h0.c.x) * k, h1.c.y + (w.y - h0.c.y) * k, h1.c.z + (w.z - h0.c.z) * k).sub(w);
    L.setFromMatrix4(M).invert();
    d.applyMatrix3(L);
    pos.setXYZ(i, v.x + d.x, v.y + d.y, v.z + d.z);
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
}

/** Baş bölgesinin kutusu → {c: (orta x, tepe y, orta z), w: genişlik}. */
function headInfo(model) {
  let head = null;
  model.traverse((o) => { if (!head && o.isSkinnedMesh && (o.userData?.region === 'head' || o.parent?.userData?.region === 'head' || o.name === 'body_head')) head = o; });
  if (!head) return null;
  const b = skinnedWorldBox(head);
  return { c: new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2), w: b.max.x - b.min.x };
}

/** Giysi albedo'su en çok 0,8 (beyaz keten/pamuk ışıkta patlamasın). */
function clampAlbedo(obj, max = 0.8) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.color) continue;
      const hi = Math.max(m.color.r, m.color.g, m.color.b);
      if (hi > max) m.color.multiplyScalar(max / hi);
    }
  });
}

/** İnsan karakteri (A'nın human.glb'si: catalog.human.targets sürücü tablosu + userData.film3.jointDeltas). */
async function buildHumanA(get, cat, def, animClips) {
  const a = new Actor(def);
  const src = await get(cat.human.url);
  const model = SkeletonUtils.clone(src.scene);
  cloneMaterials(model);
  model.updateMatrixWorld(true);
  const rig = new HumanRig(model, cat.human);
  for (const m of rig.meshes) rig._regSkeleton(m.skeleton); // her bölge mesh'inin kendi iskelet nesnesi var
  const hips0 = findBone(model, /^(pelvis|hips?)$/i);
  const hipsRef = hips0 ? hips0.position.clone() : null;
  const params = shapeParams(cat, def);
  const w = rig.evalTargets(params);
  rig.params = params;
  rig.shapeW = w;
  const live = new Set(cat.human.units || []);
  const head0 = headInfo(model); // taban baş (şapka oturtma için)
  const NOBAKE = /[?&]nobake=1/.test(globalThis.location?.search || ''); // tanı: fırınlamadan (canlı morph)
  if (NOBAKE) rig.setShape(params);
  else {
    model.traverse((o) => { if (o.isMesh && o.morphTargetDictionary) bakeMesh(o, w, live); });
    rig._updateJoints(w);
  }
  model.updateMatrixWorld(true);
  const head1 = headInfo(model);
  rig.setSkin(def.skin || (typeof def.age === 'number' && def.age < 15 && cat.human.skinChildDefault) || cat.human.skin?.[1] || '#E2B48E');
  if (rig.setEyes) {
    const E = cat.human.eyeColors || {};
    const e = def.eyes || def.eye || cat.human.eyeColorDefault || 'brown';
    try { rig.setEyes(E[e] || (/^#/.test(e) ? e : E.brown || '#5A3A1E')); } catch (_) {}
  }
  const bones = boneMap(model);
  for (const [slot, spec] of [['hair', def.hair], ['brows', def.brows], ['beard', def.beard], ['mustache', def.mustache], ['outfit', def.outfit], ['hat', def.hat], ['prop_hand', def.prop_hand]]) {
    if (!spec) continue;
    const id = typeof spec === 'string' ? spec : spec.id;
    const color = typeof spec === 'object' ? spec.color : null;
    const item = findPart(cat, slot, id);
    if (!item || !item.url) continue;
    try {
      const pg = await get(item.url);
      const ps = SkeletonUtils.clone(pg.scene);
      cloneMaterials(ps);
      const hat0 = slot === 'hat' ? hatInfo(ps) : null; // taban baştaki şapka yeri (parçanın kendi iskeletiyle)
      let skinned = 0, fitted = false;
      ps.traverse((o) => {
        if (o.isSkinnedMesh) skinned++;
        if (o.isMesh && o.morphTargetDictionary) { if (Object.keys(o.morphTargetDictionary).some((n) => n in w)) fitted = true; bakeMesh(o, w, live); }
      });
      if (skinned) {
        // Şapka saçı gizlerse (hidesHair) altındaki kısa saç karakterin saç rengini alır (kel değilse).
        const hc = def.hair && typeof def.hair === 'object' ? def.hair.color : null;
        rig.attach(ps, { tint: color || undefined, tint2: typeof spec === 'object' ? spec.color2 : undefined, hairTint: slot === 'hat' && def.hair && def.hair !== 'bald' && def.hair?.id !== 'bald' ? hc || '#2a1e18' : undefined });
        const loose = [];
        ps.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone)) loose.push(o); });
        for (const b of loose) b.removeFromParent(); // parçanın kendi iskeleti artık kullanılmıyor (kare maliyeti)
        ps.traverse((o) => { if (o.isMesh) { o.userData.part = slot; o.castShadow = true; } });
        // Şapka biçim hedefi taşımıyorsa yeni başa oturtulur (yoksa çocukta havada, yaşlıda gömük durur).
        if (slot === 'hat' && !fitted) { model.updateMatrixWorld(true); ps.traverse((o) => { if (o.isSkinnedMesh) fitToHead(o, head0, head1); }); }
        // Şapka (biçim hedefli olsa da) yeni başa oturtulur: taban modeldeki baş–şapka ilişkisi korunur (havada / kayık durmaz).
        if (slot === 'hat' && hat0 && head0 && head1) {
          model.updateMatrixWorld(true);
          const hat1 = hatInfo(ps);
          if (hat1) {
            const k = head1.w / Math.max(1e-4, head0.w);
            const target = head1.c.clone().add(hat0.c.clone().sub(head0.c).multiplyScalar(k));
            const d = target.sub(hat1.c);
            if (d.length() > 0.004 && d.length() < 0.4) ps.traverse((o) => { if (o.isSkinnedMesh) translateSkinned(o, d); });
            // Takılış: tabanı alın çizgisinin hemen üstüne (biraz aşağı) ve hafif öne eğik (~6°); eksen başın yan ekseni.
            const fwd = item.tilt ?? 6, drop = (item.drop ?? 0.012) * k;
            const pivot = head1.c.clone();
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(fwd));
            ps.traverse((o) => { if (o.isSkinnedMesh) transformSkinned(o, (w) => { w.sub(pivot).applyQuaternion(q).add(pivot); w.y -= drop; }); });
          }
        }
        if (slot === 'outfit' || slot === 'hat') clampAlbedo(ps);
      } else {
        attachPart(model, rig.base, bones, {}, { scene: ps }, item, color, {}, new Map(), live, slot);
      }
    } catch (e) {
      console.warn('[film3] parça takılamadı', slot, id, e);
    }
  }
  if (!rig.parts.some((p) => p.meshes.some((m) => m.userData.part === 'outfit'))) modestyOutfit(rig, def);
  const hips = findBone(model, /^(pelvis|hips?)$/i);
  const clips = hips ? retarget(animClips || [], hips.name, cat.anims?.restHips ? new THREE.Vector3().fromArray(cat.anims.restHips) : hipsRef, hips.position.clone(), upInParent(hips), cat.anims?.hipsMode || cat.anims?.hipsTranslation) : animClips || [];
  a.rig = rig;
  // Klip hızları (m/sn) katalogdaki kalça yüksekliği içindir: karakterin boyuna ölçeklenir (çocuk daha yavaş ilerler).
  const U = upInParent(hips);
  const refH = cat.anims?.restHips ? new THREE.Vector3().fromArray(cat.anims.restHips).dot(U) : hipsRef ? hipsRef.dot(U) : 0;
  const k = hips && Math.abs(refH) > 0.01 ? hips.position.dot(U) / refH : 1;
  const speeds = {};
  for (const [n, v] of Object.entries(cat.anims?.speeds || {})) speeds[n] = v * k;
  for (const [n, m] of Object.entries(cat.anims?.meta || {})) if (m && m.rootSpeed > 0 && speeds[n] == null) speeds[n] = m.rootSpeed * k;
  { // oturma klibinde kalça yüksekliği (sedir yerleşimi için)
    const sc = clips.find((c) => c.name === 'sit_idle');
    const tr = sc && hips ? sc.tracks.find((x) => x.name === hips.name + '.position') : null;
    if (tr) a.sitH = new THREE.Vector3(tr.values[0], tr.values[1], tr.values[2]).dot(U);
  }
  if (cat.anims?.meta?.sit_idle?.seatHeight != null) a.seatH = cat.anims.meta.sit_idle.seatHeight * k;
  a.loops = Object.fromEntries(Object.entries(cat.anims?.meta || {}).map(([n, m]) => [n, m?.loop !== false]));
  a._finish(model, clips, speeds);
  a._collectFaces(cat);
  return a;
}

/** İnsan karakteri. */
export async function buildHuman(get, cat, def, animClips) {
  if (cat.human?.targets && !Array.isArray(cat.human.targets)) return buildHumanA(get, cat, def, animClips);
  const a = new Actor(def);
  const src = await get(cat.human.url);
  const model = SkeletonUtils.clone(src.scene);
  cloneMaterials(model);
  model.updateMatrixWorld(true);
  const defs = morphDefs(cat);
  const live = new Set([...(cat.human.expressions || []), ...(cat.human.visemes || []), 'blink_l', 'blink_r']);
  let body = null, bodyN = -1;
  model.traverse((o) => { if (o.isSkinnedMesh && o.geometry.attributes.position.count > bodyN) { body = o; bodyN = o.geometry.attributes.position.count; } });
  if (!body) throw new Error('human.glb: iskeletli mesh yok');
  const bones0 = boneMap(model);
  const hips0 = findBone(model, /^(pelvis|hips?)$/i) || findBone(model, /pelvis|hips/i);
  const hipsRef = hips0 ? hips0.position.clone() : null;
  const baseInv = {};
  body.skeleton.bones.forEach((b, i) => { baseInv[b.name] = body.skeleton.boneInverses[i].clone(); });
  // Fırınla
  let bodyTW = {}, bodyP = null;
  model.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary) return;
    const tw = targetWeights(o.morphTargetDictionary, shapeParams(cat, def), defs);
    const P = bakeMesh(o, tw, live);
    if (o === body) { bodyTW = tw; bodyP = P; }
  });
  repositionJoints(model, body, bodyTW, bodyP);
  // Ten rengi
  const skin = def.skin || cat.human.skin?.[1] || '#E2B48E';
  let skinned = false;
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of mats(o)) if (/skin|body|human/i.test(m.name || '') && m.color) { m.color.set(skin); skinned = true; }
  });
  if (!skinned) for (const m of mats(body)) if (m.color) m.color.set(skin);
  // Parçalar
  const parts = [
    ['hair', def.hair], ['brows', def.brows], ['beard', def.beard], ['mustache', def.mustache],
    ['outfit', def.outfit], ['hat', def.hat], ['prop_hand', def.prop_hand || def.prop],
  ];
  const bones = boneMap(model);
  for (const [slot, spec] of parts) {
    if (!spec) continue;
    const id = typeof spec === 'string' ? spec : spec.id;
    const color = typeof spec === 'object' ? spec.color : null;
    const item = (cat.parts?.[slot] || []).find((p) => p.id === id);
    if (!item || !item.url) continue;
    try {
      const pg = await get(item.url);
      attachPart(model, body, bones, baseInv, pg, item, color, def.morphs, defs, live, slot);
    } catch (e) {
      console.warn('[film3] parça takılamadı', slot, id, e);
    }
  }
  // Klipler
  const hips = findBone(model, /^(pelvis|hips?)$/i) || findBone(model, /pelvis|hips/i);
  const clips = hips ? retarget(animClips || [], hips.name, cat.anims?.restHips ? new THREE.Vector3().fromArray(cat.anims.restHips) : hipsRef, hips.position.clone(), upInParent(hips), cat.anims?.hipsMode || cat.anims?.hipsTranslation) : animClips || [];
  a._finish(model, clips, cat.anims?.speeds);
  a._collectFaces(cat);
  void bones0;
  return a;
}

function attachPart(model, body, bones, baseInv, pg, item, color, values, defs, live, slot) {
  const s = SkeletonUtils.clone(pg.scene);
  cloneMaterials(s);
  s.updateMatrixWorld(true);
  const skinnedList = [], rigidList = [];
  s.traverse((o) => { if (o.isSkinnedMesh) skinnedList.push(o); else if (o.isMesh) rigidList.push(o); });
  if (color && item.tint !== false) tintObject(s, color, /tint|hair|brow|beard|mus|color/i);
  for (const o of skinnedList) {
    let fitted = !!o.userData?.fitted;
    if (o.morphTargetDictionary) {
      const tw = targetWeights(o.morphTargetDictionary, values, defs);
      fitted = fitted || Object.keys(tw).length > 0;
      bakeMesh(o, tw, live);
    }
    const bl = o.skeleton.bones.map((b) => bones[b.name] || bones[body.skeleton.bones[0].name]);
    const inv = o.skeleton.bones.map((b, i) => {
      const nb = bones[b.name];
      if (!nb) return o.skeleton.boneInverses[i].clone();
      if (fitted) { const j = body.skeleton.bones.indexOf(nb); return j >= 0 ? body.skeleton.boneInverses[j].clone() : new THREE.Matrix4().copy(nb.matrixWorld).invert(); }
      return baseInv[b.name] ? baseInv[b.name].clone() : o.skeleton.boneInverses[i].clone();
    });
    o.removeFromParent();
    body.parent.add(o);
    o.position.copy(body.position); o.quaternion.copy(body.quaternion); o.scale.copy(body.scale);
    o.bind(new THREE.Skeleton(bl, inv), body.bindMatrix.clone());
    o.userData.part = slot;
  }
  if (rigidList.length) {
    const bn = item.bone || (slot === 'hat' ? 'head' : slot === 'prop_hand' ? 'hand_r' : null);
    const bone = (bn && bones[bn]) || (slot === 'hat' ? findBone(model, /head/i, /end|top/i) : findBone(model, /hand.?r|r.?hand/i));
    if (bone) {
      // Parça bağlanma pozundaki dünyada yazılmıştır: kemiğin TABAN pozuna göre yerel konum (yeni kemikle taşınır).
      const inv0 = baseInv[bone.name] || new THREE.Matrix4().copy(bone.matrixWorld).invert();
      for (const o of rigidList) {
        o.updateMatrixWorld(true);
        const w = o.matrixWorld.clone();
        o.removeFromParent();
        _m.multiplyMatrices(inv0, w);
        _m.decompose(o.position, o.quaternion, o.scale);
        o.userData.part = slot;
        bone.add(o);
      }
    }
  }
}

/** Hayvan karakteri. */
export async function buildAnimal(get, cat, def) {
  const a = new Actor({ ...def, kind: 'animal' });
  const item = (cat.animals || []).find((x) => x.id === def.animal) || (cat.animals || [])[0];
  if (!item) throw new Error('hayvan yok: ' + def.animal);
  const src = await get(item.url);
  const model = SkeletonUtils.clone(src.scene);
  cloneMaterials(model);
  const tm = item.tint?.materials;
  // Gerçekçi (dokulu) hayvanlarda katalog tint:false → renk tonu uygulanmaz (doku rengi korunur).
  if (item.tint !== false) tintObject(model, def.color, tm && tm.length ? new RegExp('^(' + tm.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i') : /tint|main|body|coat|fur|skin/i);
  if (item.scale) model.scale.setScalar(item.scale);
  if (item.yaw) model.rotation.y = item.yaw;
  if (item.height) {
    model.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(model);
    const h = b.max.y - b.min.y;
    if (h > 0.01) model.scale.multiplyScalar(item.height / h);
  }
  const clips = (src.animations || []).map((c) => {
    const k = c.clone();
    k.name = clipName(c.name);
    // Hayvanlarda da yatay kök hareketi yönetmende.
    k.tracks = k.tracks.filter((t) => !t.name.endsWith('.scale'));
    return k;
  });
  // Katalog adlarını eşleştir (ör. "Idle_2" → idle, "Gallop" → gallop, "Eating" → eat).
  const want = item.clips || ['idle', 'walk', 'trot', 'gallop', 'eat', 'neigh'];
  for (const [w, src] of Object.entries(item.alias || {})) {
    if (clips.some((c) => c.name === w)) continue;
    const hit = clips.find((c) => c.name === src);
    if (hit) { const k = hit.clone(); k.name = w; clips.push(k); }
  }
  for (const w of want) {
    if (clips.some((c) => c.name === w)) continue;
    const hit = clips.find((c) => c.name.includes(w) || (w === 'eat' && /eat|graz/.test(c.name)) || (w === 'neigh' && /neigh|attack|headbutt/.test(c.name)));
    if (hit) { const k = hit.clone(); k.name = w; clips.push(k); }
  }
  a._finish(model, clips, item.speeds || { walk: 1.5, trot: 3.4, gallop: 7.5 });
  a._collectFaces(cat);
  return a;
}
