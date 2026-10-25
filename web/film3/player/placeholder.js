// HADİ Film v3 — yer tutucu varlıklar (geliştirme / test). Gerçek varlıklar (human.glb, parts, anims.glb, animals, env)
// hazır olmadan oynatıcının bütün yolunu sınamak için kodla kurulur: MakeHuman "game_engine" kemik adlarıyla kapsül insan
// (gövde morph'ları + eklem kaydırma extras'ı, ifade ve visem morph'ları), parçalar (saç, kaş, sakal, giysi, şapka, el eşyası),
// prosedürel animasyon klipleri, kutu at ve köy avlusu. Biçim gerçek varlıklarla aynıdır (glTF yükleyicinin verdiği nesneler).
import * as THREE from 'three';
import { mergeGeometries } from './addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ iskelet + parça kurucu

class Rig {
  constructor(defs) {
    this.defs = defs; // [{name,parent,p:[x,y,z]}]
    this.byName = Object.fromEntries(defs.map((d, i) => [d.name, i]));
    this.items = new Map(); // malzeme → [{geo,tag,bone,axis}]
  }

  add(mat, geo, tag, bone, axis) {
    if (!this.items.has(mat)) this.items.set(mat, []);
    this.items.get(mat).push({ geo, tag, bone, axis });
    return this;
  }

  bones() {
    const out = this.defs.map((d) => { const b = new THREE.Bone(); b.name = d.name; return b; });
    this.defs.forEach((d, i) => {
      const pi = d.parent != null ? this.byName[d.parent] : -1;
      const pp = pi >= 0 ? this.defs[pi].p : [0, 0, 0];
      out[i].position.set(d.p[0] - pp[0], d.p[1] - pp[1], d.p[2] - pp[2]);
      if (pi >= 0) out[pi].add(out[i]);
    });
    return out;
  }

  /**
   * materials: {key: Material}; morphs: {ad: (p, tag, out, item) => void}; jointMorphs: kemik konumunu da değiştiren
   * morph'lar (body mesh'in userData.jointDeltas'ına yazılır — A'nın human.glb extras sözleşmesiyle aynı).
   */
  build(materials, morphs = {}, { jointMorphs = [], bodyKey = null, rigid = false } = {}) {
    const group = new THREE.Group();
    const bones = this.bones();
    group.add(bones[0]);
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const names = Object.keys(morphs);
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    for (const [key, list] of this.items) {
      const geos = list.map((it) => {
        const g = it.geo.index ? it.geo : it.geo; // üçlü ilkel geometriler zaten indeksli
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        const pos = g.attributes.position;
        const n = pos.count;
        if (!rigid) {
          const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
          for (let i = 0; i < n; i++) {
            p.fromBufferAttribute(pos, i);
            const bn = typeof it.bone === 'function' ? it.bone(p) : it.bone;
            si[i * 4] = this.byName[bn] ?? 0;
            sw[i * 4] = 1;
          }
          g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
          g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        }
        g.morphAttributes.position = names.map((nm) => {
          const arr = new Float32Array(n * 3);
          const fn = morphs[nm];
          for (let i = 0; i < n; i++) {
            p.fromBufferAttribute(pos, i);
            d.set(0, 0, 0);
            fn(p, it.tag, d, it);
            arr[i * 3] = d.x; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = d.z;
          }
          const a = new THREE.Float32BufferAttribute(arr, 3);
          a.name = nm;
          return a;
        });
        g.morphTargetsRelative = true;
        return g;
      });
      const merged = mergeGeometries(geos, false);
      merged.morphTargetsRelative = true;
      // Hiç etkisi olmayan morph'lar atılır.
      const keep = [];
      (merged.morphAttributes.position || []).forEach((a, i) => {
        a.name = names[i];
        if (a.array.some((x) => Math.abs(x) > 1e-7)) keep.push(a);
      });
      if (keep.length) merged.morphAttributes.position = keep; else delete merged.morphAttributes.position;
      merged.computeVertexNormals();
      // Morph normalleri: yaklaşık (morph uygulanmış geometriden) — ifade/visem için yeterli.
      if (keep.length) {
        merged.morphAttributes.normal = keep.map((a) => {
          const g2 = merged.clone();
          const pp = g2.attributes.position;
          for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) + a.getX(i), pp.getY(i) + a.getY(i), pp.getZ(i) + a.getZ(i));
          g2.morphAttributes = {};
          g2.computeVertexNormals();
          const nn = g2.attributes.normal, n0 = merged.attributes.normal;
          const arr = new Float32Array(nn.count * 3);
          for (let i = 0; i < nn.count; i++) { arr[i * 3] = nn.getX(i) - n0.getX(i); arr[i * 3 + 1] = nn.getY(i) - n0.getY(i); arr[i * 3 + 2] = nn.getZ(i) - n0.getZ(i); }
          const na = new THREE.Float32BufferAttribute(arr, 3);
          na.name = a.name;
          return na;
        });
      }
      const mesh = rigid ? new THREE.Mesh(merged, materials[key]) : new THREE.SkinnedMesh(merged, materials[key]);
      mesh.name = key;
      if (keep.length) {
        mesh.morphTargetDictionary = Object.fromEntries(keep.map((a, i) => [a.name, i]));
        mesh.morphTargetInfluences = keep.map(() => 0);
      }
      if (!rigid) mesh.bind(skeleton, new THREE.Matrix4());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (key === bodyKey && jointMorphs.length) {
        const jd = {};
        for (const nm of jointMorphs) {
          jd[nm] = {};
          for (const def of this.defs) {
            p.fromArray(def.p); d.set(0, 0, 0);
            morphs[nm](p, 'bone:' + def.name, d, { axis: null });
            if (d.lengthSq() > 1e-10) jd[nm][def.name] = [d.x, d.y, d.z];
          }
        }
        mesh.userData.jointDeltas = jd;
      }
    }
    if (rigid) group.remove(bones[0]);
    return group;
  }
}

function sphere(r, c, s = [1, 1, 1], seg = [22, 14], phi) {
  const g = phi ? new THREE.SphereGeometry(r, seg[0], seg[1], 0, TAU, phi[0], phi[1]) : new THREE.SphereGeometry(r, seg[0], seg[1]);
  g.scale(s[0], s[1], s[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}
function capsule(a, b, r, seg = 12) {
  const A = v3(a), B = v3(b);
  const len = Math.max(0.001, A.distanceTo(B));
  const g = new THREE.CapsuleGeometry(r, len, 4, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  const m = A.clone().add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
function box(s, c, rot) {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(c[0], c[1], c[2]);
  return g;
}
function cyl(rt, rb, h, c, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// ------------------------------------------------------------------ insan

const HUMAN = [
  { name: 'root', p: [0, 0, 0] },
  { name: 'pelvis', parent: 'root', p: [0, 0.95, 0] },
  { name: 'spine_01', parent: 'pelvis', p: [0, 1.04, 0] },
  { name: 'spine_02', parent: 'spine_01', p: [0, 1.17, 0] },
  { name: 'spine_03', parent: 'spine_02', p: [0, 1.3, 0] },
  { name: 'neck_01', parent: 'spine_03', p: [0, 1.47, 0] },
  { name: 'head', parent: 'neck_01', p: [0, 1.56, 0] },
];
for (const [s, x] of [['l', 1], ['r', -1]]) {
  HUMAN.push(
    { name: `clavicle_${s}`, parent: 'spine_03', p: [0.03 * x, 1.43, 0] },
    { name: `upperarm_${s}`, parent: `clavicle_${s}`, p: [0.18 * x, 1.42, 0] },
    { name: `lowerarm_${s}`, parent: `upperarm_${s}`, p: [0.2 * x, 1.13, -0.01] },
    { name: `hand_${s}`, parent: `lowerarm_${s}`, p: [0.21 * x, 0.87, 0.01] },
    { name: `thigh_${s}`, parent: 'pelvis', p: [0.095 * x, 0.92, 0] },
    { name: `calf_${s}`, parent: `thigh_${s}`, p: [0.1 * x, 0.5, 0.01] },
    { name: `foot_${s}`, parent: `calf_${s}`, p: [0.1 * x, 0.08, -0.01] },
    { name: `ball_${s}`, parent: `foot_${s}`, p: [0.1 * x, 0.02, 0.11] },
  );
}
const HP = Object.fromEntries(HUMAN.map((d) => [d.name, d.p]));
const HEAD_C = new THREE.Vector3(0, 1.67, 0.005);
const MOUTH = new THREE.Vector3(0, 1.613, 0.1);
const isHeadTag = (t) => /^(head|eye|pupil|mouth|hair|brow|beard|mus|ear|nose|hat|bone:head)/.test(t);

function closestOnSeg(p, a, b, out) {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  return out.copy(a).addScaledVector(ab, t);
}
const _c = new THREE.Vector3();
function radial(p, it, k, out) {
  if (!it || !it.axis) return;
  closestOnSeg(p, it.axis[0], it.axis[1], _c);
  out.x += (p.x - _c.x) * k;
  out.z += (p.z - _c.z) * k;
  if (Math.abs(it.axis[0].y - it.axis[1].y) < 0.05) out.y += (p.y - _c.y) * k; // yatay eksen (ayak)
}

/** Gövde morph'ları (yer tutucu): yaş, cinsiyet, kilo, kas, boy, göbek. */
const BODY_MORPHS = {
  // Çocuk: gövde %60, baş kendi merkezine göre %85 (çocuk başı gövdeye göre büyüktür).
  age_dec(p, tag, out) {
    let q;
    if (isHeadTag(tag)) q = HEAD_C.clone().multiplyScalar(0.6).add(p.clone().sub(HEAD_C).multiplyScalar(0.85));
    else q = new THREE.Vector3(p.x * 0.66, p.y * 0.6, p.z * 0.66);
    out.add(q.sub(p));
  },
  // Yaşlı: hafif çökme, kambur.
  age_inc(p, tag, out) {
    out.y += -p.y * 0.035;
    out.z += 0.06 * smooth(1.15, 1.6, p.y);
  },
  height(p, tag, out) { out.y += p.y * 0.12; },
  gender(p, tag, out) {
    if (tag === 'torso' && p.y > 1.25) out.x += p.x * 0.1;
    if (tag === 'pelvis') out.x -= p.x * 0.12;
  },
  weight(p, tag, out, it) {
    if (tag.startsWith('bone:')) return;
    if (tag === 'torso' || tag === 'pelvis') { out.x += p.x * 0.3; out.z += p.z * 0.35 + (p.z > 0 ? 0.03 * smooth(0.95, 1.15, p.y) * (1 - smooth(1.2, 1.35, p.y)) : 0); }
    else if (/arm|leg/.test(tag)) radial(p, it, 0.3, out);
    else if (tag === 'head') { out.x += (p.x - HEAD_C.x) * 0.07 * (1 - smooth(1.62, 1.7, p.y)); }
  },
  muscle(p, tag, out, it) {
    if (/arm|leg/.test(tag)) radial(p, it, 0.22, out);
    if (tag === 'torso' && p.y > 1.2) out.x += p.x * 0.08;
  },
  belly(p, tag, out) {
    if (tag === 'torso' && p.z > 0) out.z += 0.09 * smooth(0.98, 1.12, p.y) * (1 - smooth(1.15, 1.32, p.y));
  },
};
const JOINT_MORPHS = ['age_dec', 'age_inc', 'height'];

/** Ağız/göz/kaş ifade ve visem morph'ları (yer tutucu yüz). */
function faceMorphs() {
  const m = {};
  const mouth = (fx, fy, fz = 0, corner = 0, asym = 0) => (p, tag, out) => {
    if (tag !== 'mouth') return;
    const dx = p.x - MOUTH.x, dy = p.y - MOUTH.y;
    out.x += dx * (fx - 1);
    out.y += dy * (fy - 1) + corner * Math.pow(Math.abs(dx) / 0.03, 2) + asym * (dx / 0.03);
    out.z += fz;
  };
  const eyes = (fy, side = 0) => (p, tag, out) => {
    if (!(tag.startsWith('eye') || tag.startsWith('pupil'))) return;
    if (side && Math.sign(p.x) !== side) return;
    const cy = 1.675;
    out.y += (p.y - cy) * (fy - 1);
  };
  const brows = (inner, outer) => (p, tag, out) => {
    if (tag !== 'brow') return;
    const k = Math.min(1, Math.abs(p.x) / 0.07);
    out.y += inner * (1 - k) + outer * k;
  };
  const sum = (...fs) => (p, tag, out, it) => { for (const f of fs) f(p, tag, out, it); };
  // ifadeler
  m.smile = sum(mouth(1.15, 1, 0, 0.011), eyes(0.85));
  m.laugh = sum(mouth(1.2, 2.6, 0, 0.012), eyes(0.45), brows(0.004, 0.004));
  m.sad = sum(mouth(0.95, 1, 0, -0.009), brows(0.009, -0.004), eyes(0.8));
  m.cry = sum(mouth(1.05, 1.8, 0, -0.011), brows(0.011, -0.004), eyes(0.45));
  m.angry = sum(mouth(0.85, 0.9, 0, -0.004), brows(-0.011, 0.002), eyes(0.75));
  m.fear = sum(mouth(1.2, 1.6, 0, -0.006), brows(0.012, 0.006), eyes(1.25));
  m.surprise = sum(mouth(0.7, 2.6), brows(0.014, 0.012), eyes(1.3));
  m.disgust = sum(mouth(0.9, 1.1, 0, 0, 0.006), brows(-0.006, 0), eyes(0.8));
  m.think = sum(mouth(0.8, 0.9, 0, 0, -0.004), (p, tag, out) => { if (tag === 'brow' && p.x > 0) out.y += 0.01; });
  m.shout = sum(mouth(1.15, 3.2), brows(-0.008, 0.004));
  m.blink_l = eyes(0.08, 1);
  m.blink_r = eyes(0.08, -1);
  // visemler
  const V = { PP: [1, 0.25], FF: [1, 0.55], TH: [1, 0.9], DD: [1, 1.5], kk: [1, 1.7], CH: [0.8, 1.3, 0.004], SS: [1.1, 0.8], nn: [1, 1.1],
    RR: [0.85, 1.2], aa: [1.05, 3.2], E: [1.25, 1.7], I: [1.2, 1.3], O: [0.6, 2.1, 0.005], U: [0.45, 1.3, 0.008] };
  for (const [k, a] of Object.entries(V)) m[k] = mouth(a[0], a[1], a[2] || 0);
  return m;
}

function torsoBone(p) { return p.y < 1.1 ? 'spine_01' : p.y < 1.24 ? 'spine_02' : 'spine_03'; }
function limbs(rig, mat, rr = 1, opts = {}) {
  for (const s of ['l', 'r']) {
    const ua = HP[`upperarm_${s}`], la = HP[`lowerarm_${s}`], ha = HP[`hand_${s}`];
    const th = HP[`thigh_${s}`], ca = HP[`calf_${s}`], fo = HP[`foot_${s}`];
    const ax = (a, b) => [v3(a), v3(b)];
    rig.add(mat, sphere(0.058 * rr, ua), 'arm', `upperarm_${s}`, ax(ua, ua));
    rig.add(mat, capsule(ua, la, 0.046 * rr), 'arm', `upperarm_${s}`, ax(ua, la));
    const laEnd = opts.sleeve ? [la[0] + (ha[0] - la[0]) * opts.sleeve, la[1] + (ha[1] - la[1]) * opts.sleeve, la[2]] : ha;
    rig.add(mat, capsule(la, laEnd, 0.039 * rr), 'arm', `lowerarm_${s}`, ax(la, ha));
    if (!opts.noHands) rig.add(mat, sphere(0.045, [ha[0], ha[1] - 0.07, ha[2] + 0.005], [0.55, 1.1, 0.9]), 'hand', `hand_${s}`);
    rig.add(mat, capsule(th, ca, 0.072 * rr), 'leg', `thigh_${s}`, ax(th, ca));
    const caEnd = opts.pantsEnd ? [fo[0], fo[1] + opts.pantsEnd, fo[2]] : fo;
    rig.add(mat, capsule(ca, caEnd, 0.052 * rr), 'leg', `calf_${s}`, ax(ca, fo));
    if (!opts.noFeet) rig.add(opts.footMat || mat, box([0.095 * (opts.shoe || 1), 0.065, 0.25 * (opts.shoe || 1)], [fo[0], 0.035, fo[2] + 0.055]), 'foot', `foot_${s}`, ax([fo[0], 0.035, fo[2] - 0.07], [fo[0], 0.035, fo[2] + 0.17]));
  }
}

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0, ...o });

function buildHuman() {
  const rig = new Rig(HUMAN);
  rig.add('skin', sphere(0.115, HEAD_C.toArray(), [0.86, 1, 0.94], [28, 18]), 'head', 'head');
  rig.add('skin', box([0.022, 0.04, 0.03], [0, 1.65, 0.113], [-0.25, 0, 0]), 'nose', 'head');
  for (const x of [1, -1]) rig.add('skin', sphere(0.03, [0.098 * x, 1.665, -0.005], [0.35, 0.65, 0.5]), 'ear', 'head');
  rig.add('skin', capsule([0, 1.44, -0.005], [0, 1.58, 0], 0.048), 'neck', 'neck_01');
  rig.add('skin', capsule([0, 1.03, 0], [0, 1.36, 0], 0.15), 'torso', torsoBone, [v3([0, 1.03, 0]), v3([0, 1.36, 0])]);
  rig.add('skin', sphere(0.155, [0, 0.95, 0], [1, 0.7, 0.75]), 'pelvis', 'pelvis');
  limbs(rig, 'skin');
  for (const x of [1, -1]) {
    rig.add('eye', sphere(0.019, [0.038 * x, 1.675, 0.088], [1, 1, 1], [16, 12]), x > 0 ? 'eye_l' : 'eye_r', 'head');
    rig.add('pupil', sphere(0.0095, [0.038 * x, 1.675, 0.104], [1, 1, 0.6], [12, 8]), x > 0 ? 'pupil_l' : 'pupil_r', 'head');
  }
  rig.add('mouth', sphere(1, MOUTH.toArray(), [0.03, 0.008, 0.012], [18, 10]), 'mouth', 'head');
  const mats = {
    skin: std('#ffffff', { roughness: 0.62, name: 'skin' }),
    eye: std('#f4f1ea', { roughness: 0.25, name: 'eye' }),
    pupil: std('#1f1a17', { roughness: 0.2, name: 'pupil' }),
    mouth: std('#6b2a28', { roughness: 0.5, name: 'mouth' }),
  };
  const g = rig.build(mats, { ...BODY_MORPHS, ...faceMorphs() }, { jointMorphs: JOINT_MORPHS, bodyKey: 'skin' });
  g.name = 'human';
  return { scene: g, animations: [] };
}

/** Saç, kaş, sakal, bıyık, giysi (iskelete bağlı), şapka ve el eşyası (sert). */
function buildPart(id) {
  const rig = new Rig(HUMAN);
  const morphs = { ...BODY_MORPHS };
  const tint = (c, o) => std(c, { name: 'tint', ...o });
  let mats = {}, rigid = false;
  switch (id) {
    case 'hair_short_straight':
    case 'hair_short_curly': {
      const g = sphere(0.124, [0, 0, 0], [0.92, 1, 1.02], [24, 12], [0, Math.PI * 0.56]);
      g.rotateX(-0.42);
      g.translate(HEAD_C.x, HEAD_C.y + 0.012, HEAD_C.z - 0.008);
      rig.add('hair', g, 'hair', 'head');
      mats = { hair: tint('#ffffff', { roughness: 0.8 }) };
      break;
    }
    case 'hair_long': {
      const g = sphere(0.126, [0, 0, 0], [0.94, 1, 1.03], [24, 12], [0, Math.PI * 0.58]);
      g.rotateX(-0.35);
      g.translate(HEAD_C.x, HEAD_C.y + 0.012, HEAD_C.z - 0.01);
      rig.add('hair', g, 'hair', 'head');
      rig.add('hair', box([0.2, 0.26, 0.06], [0, 1.56, -0.085]), 'hair', 'head');
      mats = { hair: tint('#ffffff', { roughness: 0.8 }) };
      break;
    }
    case 'brows_thin':
    case 'brows_thick': {
      const h = id === 'brows_thick' ? 0.011 : 0.006;
      for (const x of [1, -1]) rig.add('brow', box([0.036, h, 0.009], [0.04 * x, 1.703, 0.1], [0, 0, 0.1 * x]), 'brow', 'head');
      Object.assign(morphs, faceMorphs());
      mats = { brow: tint('#ffffff') };
      break;
    }
    case 'beard_full': {
      rig.add('beard', sphere(0.104, [0, 1.622, 0.012], [0.9, 0.85, 0.98], [22, 10], [Math.PI * 0.52, Math.PI * 0.42]), 'beard', 'head');
      mats = { beard: tint('#ffffff', { roughness: 0.9 }) };
      break;
    }
    case 'beard_short': {
      rig.add('beard', sphere(0.102, [0, 1.625, 0.01], [0.88, 0.8, 0.96], [22, 10], [Math.PI * 0.6, Math.PI * 0.32]), 'beard', 'head');
      mats = { beard: tint('#ffffff', { roughness: 0.9 }) };
      break;
    }
    case 'mustache_classic': {
      for (const x of [1, -1]) rig.add('mus', box([0.04, 0.012, 0.014], [0.019 * x, 1.63, 0.107], [0, 0, -0.25 * x]), 'mus', 'head');
      mats = { mus: tint('#ffffff', { roughness: 0.9 }) };
      break;
    }
    case 'outfit_village_boy_1':
    case 'outfit_village_man_1':
    case 'outfit_elder_1': {
      const man = id !== 'outfit_village_boy_1';
      const elder = id === 'outfit_elder_1';
      rig.add('shirt', capsule([0, 1.02, 0], [0, 1.37, 0], 0.163), 'torso', torsoBone, [v3([0, 1.02, 0]), v3([0, 1.37, 0])]);
      rig.add('pants', sphere(0.168, [0, 0.95, 0], [1, 0.72, 0.78]), 'pelvis', 'pelvis');
      const arm = new Rig(HUMAN); // kollar gömlek rengiyle, bacaklar pantolon
      limbs(arm, 'shirt', 1.12, { noHands: true, noFeet: true, sleeve: man ? 0.85 : 0.6 });
      for (const it of arm.items.get('shirt')) if (it.tag === 'arm') rig.add('shirt', it.geo, it.tag, it.bone, it.axis);
      const leg = new Rig(HUMAN);
      limbs(leg, 'pants', 1.1, { noHands: true, pantsEnd: 0.09, footMat: 'shoe', shoe: 1.12 });
      for (const [k, list] of leg.items) for (const it of list) if (it.tag === 'leg' || it.tag === 'foot') rig.add(k, it.geo, it.tag, it.bone, it.axis);
      if (man) rig.add('vest', capsule([0, 1.06, 0.004], [0, 1.36, 0.004], 0.17), 'torso', torsoBone, [v3([0, 1.02, 0]), v3([0, 1.37, 0])]);
      if (elder) rig.add('vest', cyl(0.2, 0.25, 0.5, [0, 0.82, 0]), 'pelvis', (p) => (p.y > 0.9 ? 'pelvis' : p.x > 0 ? 'thigh_l' : 'thigh_r'));
      mats = {
        shirt: std(man ? '#cfc4ae' : '#e2d8c2', { roughness: 0.92, name: 'tint' }),
        pants: std(man ? '#3e3a35' : '#5a4a3a', { roughness: 0.95 }),
        shoe: std('#2a1d14', { roughness: 0.6 }),
        vest: std(elder ? '#4b3b2c' : '#5b3b25', { roughness: 0.9 }),
      };
      break;
    }
    case 'hat_fez_red': {
      rigid = true;
      rig.add('fez', cyl(0.07, 0.088, 0.115, [0, 1.79, -0.008], 20), 'hat', 'head');
      rig.add('tassel', cyl(0.006, 0.006, 0.09, [0.05, 1.79, -0.06]), 'hat', 'head');
      mats = { fez: std('#9c1b1f', { roughness: 0.85, name: 'tint' }), tassel: std('#1a1414') };
      break;
    }
    case 'hat_cap_wool': {
      rigid = true;
      rig.add('cap', sphere(0.125, [HEAD_C.x, HEAD_C.y + 0.025, HEAD_C.z - 0.005], [0.95, 0.8, 1.02], [20, 10], [0, Math.PI * 0.5]), 'hat', 'head');
      mats = { cap: std('#5b4a3a', { roughness: 0.95, name: 'tint' }) };
      break;
    }
    case 'prop_curry_comb': {
      rigid = true;
      const h = HP.hand_r;
      rig.add('metal', box([0.11, 0.025, 0.06], [h[0] - 0.005, h[1] - 0.115, h[2] + 0.04]), 'prop', 'hand_r');
      rig.add('wood', box([0.03, 0.05, 0.03], [h[0], h[1] - 0.085, h[2] + 0.04]), 'prop', 'hand_r');
      mats = { metal: std('#c9ccd0', { metalness: 0.9, roughness: 0.3 }), wood: std('#6a4528') };
      break;
    }
    default:
      return null;
  }
  const g = rig.build(mats, rigid ? {} : morphs, { rigid });
  g.name = id;
  return { scene: g, animations: [] };
}

// ------------------------------------------------------------------ prosedürel klipler (yer tutucu iskeleti)

function makeClip(name, dur, fn, { fps = 30, defs = HUMAN, hips = 'pelvis' } = {}) {
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(n);
  const rot = new Map(), pos = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    times[i] = u * dur;
    const pose = fn(u, u * dur) || {};
    for (const d of defs) {
      const r = pose[d.name];
      if (!rot.has(d.name)) rot.set(d.name, []);
      e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'YXZ');
      q.setFromEuler(e);
      rot.get(d.name).push(q.x, q.y, q.z, q.w);
    }
    const hp = defs.find((d) => d.name === hips).p;
    const parent = defs.find((d) => d.name === hips).parent;
    const pp = parent ? defs.find((d) => d.name === parent).p : [0, 0, 0];
    const o = pose._hips || [0, 0, 0];
    pos.push(hp[0] - pp[0] + o[0], hp[1] - pp[1] + o[1], hp[2] - pp[2] + o[2]);
  }
  const tracks = [];
  for (const [b, vals] of rot) {
    if (vals.every((x, i) => (i % 4 === 3 ? Math.abs(x - 1) < 1e-6 : Math.abs(x) < 1e-6))) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, vals));
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hips}.position`, times, pos));
  return new THREE.AnimationClip(name, dur, tracks);
}

const S = Math.sin, C = Math.cos;
const env = (u, a = 0.18, b = 0.82) => smooth(0, a, u) * (1 - smooth(b, 1, u));

function gait(u, k) {
  const s = S(TAU * u), c = C(TAU * u);
  const kneeL = 0.12 + k.knee * Math.max(0, c) ** 1.5;
  const kneeR = 0.12 + k.knee * Math.max(0, -c) ** 1.5;
  return {
    thigh_l: [-k.leg * s, 0, 0], thigh_r: [k.leg * s, 0, 0],
    calf_l: [kneeL, 0, 0], calf_r: [kneeR, 0, 0],
    foot_l: [-0.15 * s - kneeL * 0.3, 0, 0], foot_r: [0.15 * s - kneeR * 0.3, 0, 0],
    upperarm_l: [k.arm * s, 0, 0.09], upperarm_r: [-k.arm * s, 0, -0.09],
    lowerarm_l: [-k.elbow, 0, 0], lowerarm_r: [-k.elbow, 0, 0],
    pelvis: [0, 0.08 * s, 0], spine_01: [k.lean, 0, 0], spine_03: [0, -0.07 * s, 0], head: [-k.lean * 0.6, 0.03 * s, 0],
    _hips: [0, k.bob * C(2 * TAU * u) - k.bob, 0],
  };
}
const idlePose = (u, t, sad = 0) => {
  const b = S(TAU * u);
  return {
    spine_02: [0.015 * b + 0.08 * sad, 0, 0], spine_03: [0.01 * b + 0.12 * sad, 0, 0],
    upperarm_l: [0.03 * b, 0, 0.07 - 0.03 * sad], upperarm_r: [-0.02 * b, 0, -0.07 + 0.03 * sad],
    lowerarm_l: [-0.12, 0, 0], lowerarm_r: [-0.12, 0, 0],
    head: [0.03 * S(TAU * u * 2) + 0.38 * sad, 0.06 * S(TAU * u), 0],
    clavicle_l: [0, 0, -0.06 * sad], clavicle_r: [0, 0, 0.06 * sad],
    _hips: [0, -0.004 * (1 + b), 0],
  };
};
function merge(a, b, w = 1) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const x = o[k] || [0, 0, 0];
    o[k] = [x[0] + v[0] * w, x[1] + v[1] * w, x[2] + v[2] * w];
  }
  return o;
}

function humanClips() {
  const L = [];
  L.push(makeClip('idle', 4, (u, t) => idlePose(u, t)));
  L.push(makeClip('idle_sad', 4, (u, t) => idlePose(u, t, 1)));
  L.push(makeClip('walk', 1.05, (u) => gait(u, { leg: 0.42, knee: 0.75, arm: 0.32, elbow: 0.25, lean: 0.03, bob: 0.025 })));
  L.push(makeClip('walk_slow', 1.4, (u) => gait(u, { leg: 0.3, knee: 0.55, arm: 0.18, elbow: 0.2, lean: 0.06, bob: 0.015 })));
  L.push(makeClip('run', 0.66, (u) => gait(u, { leg: 0.75, knee: 1.4, arm: 0.7, elbow: 1.2, lean: 0.22, bob: 0.05 })));
  L.push(makeClip('head_shake', 1.6, (u, t) => merge(idlePose(u, t), { head: [0.05, 0.42 * S(TAU * u * 3) * env(u, 0.1, 0.9), 0], spine_03: [0, 0.05 * S(TAU * u * 3) * env(u), 0] })));
  L.push(makeClip('nod', 1.4, (u, t) => merge(idlePose(u, t), { head: [0.28 * Math.max(0, S(TAU * u * 2)) * env(u, 0.1, 0.9), 0, 0] })));
  L.push(makeClip('point', 2.2, (u, t) => { const k = env(u, 0.2, 0.85); return merge(idlePose(u, t), { upperarm_r: [-1.35 * k, -0.15 * k, 0.05 * k], lowerarm_r: [0.1 * k, 0, 0], spine_03: [0, -0.15 * k, 0] }); }));
  L.push(makeClip('wave', 2.4, (u, t) => { const k = env(u, 0.15, 0.85); return merge(idlePose(u, t), { upperarm_r: [-0.2 * k, 0, -2.4 * k], lowerarm_r: [-0.4 * k, 0, -0.35 * S(TAU * u * 4) * k] }); }));
  L.push(makeClip('cry', 3, (u, t) => {
    const k = env(u, 0.15, 0.9), sh = 0.035 * S(TAU * u * 9) * k;
    return merge(idlePose(u, t, 0.6), { upperarm_l: [-0.95 * k, 0, -0.38 * k], upperarm_r: [-0.95 * k, 0, 0.38 * k], lowerarm_l: [-1.85 * k, 0.25 * k, 0], lowerarm_r: [-1.85 * k, -0.25 * k, 0], head: [0.35 * k, 0, 0], spine_03: [0.1 * k + sh, 0, 0] });
  }));
  L.push(makeClip('talk_gesture_1', 3, (u, t) => merge(idlePose(u, t), { upperarm_r: [-0.35, 0, -0.12], lowerarm_r: [-1.0 + 0.25 * S(TAU * u * 3), 0.2 * S(TAU * u * 2), 0], head: [0, 0.06 * S(TAU * u * 2), 0.03 * S(TAU * u * 3)] })));
  L.push(makeClip('talk_gesture_2', 3, (u, t) => merge(idlePose(u, t), { upperarm_l: [-0.3, 0, 0.22], upperarm_r: [-0.3, 0, -0.22], lowerarm_l: [-0.95 + 0.2 * S(TAU * u * 2), 0.3, 0], lowerarm_r: [-0.95 + 0.2 * S(TAU * u * 2 + 1), -0.3, 0], head: [0.04 * S(TAU * u * 3), 0, 0] })));
  L.push(makeClip('kneel', 2, (u, t) => ({ thigh_l: [-1.5, 0, 0.05], calf_l: [1.55, 0, 0], thigh_r: [-0.1, 0, -0.05], calf_r: [1.7, 0, 0], foot_r: [-0.9, 0, 0], spine_01: [0.1, 0, 0], _hips: [0, -0.43, -0.05], ...idlePose(u, t) })));
  const sitPose = (u, t, k = 1) => merge(idlePose(u, t), { thigh_l: [-1.5 * k, 0, 0.04 * k], thigh_r: [-1.5 * k, 0, -0.04 * k], calf_l: [1.5 * k, 0, 0], calf_r: [1.5 * k, 0, 0], _hips: [0, -0.43 * k, -0.02 * k] });
  L.push(makeClip('sit', 1.5, (u, t) => sitPose(u, t, smooth(0, 1, u))));
  L.push(makeClip('sit_idle', 4, (u, t) => sitPose(u, t)));
  L.push(makeClip('stand_up', 1.5, (u, t) => sitPose(u, t, 1 - smooth(0, 1, u))));
  L.push(makeClip('pick_up', 2, (u, t) => { const k = env(u, 0.35, 0.65); return merge(idlePose(u, t), { spine_01: [0.75 * k, 0, 0], spine_02: [0.25 * k, 0, 0], thigh_l: [-0.5 * k, 0, 0], thigh_r: [-0.5 * k, 0, 0], calf_l: [0.8 * k, 0, 0], calf_r: [0.8 * k, 0, 0], upperarm_r: [-0.7 * k, 0, 0], _hips: [0, -0.12 * k, -0.08 * k] }); }));
  L.push(makeClip('give', 2, (u, t) => { const k = env(u, 0.3, 0.8); return merge(idlePose(u, t), { upperarm_r: [-1.05 * k, 0, 0.05 * k], lowerarm_r: [-0.35 * k, 0, 0], spine_03: [0.08 * k, 0, 0] }); }));
  L.push(makeClip('slap', 1.4, (u, t) => {
    const up = smooth(0, 0.4, u) * (1 - smooth(0.42, 0.55, u)), swing = smooth(0.4, 0.55, u) * (1 - smooth(0.7, 1, u));
    return merge(idlePose(u, t), { upperarm_r: [-1.1 * up - 0.9 * swing, 0.6 * swing, -1.2 * up - 0.2 * swing], lowerarm_r: [-0.9 * up - 0.2 * swing, 0, 0], spine_03: [0, 0.25 * up - 0.35 * swing, 0] });
  }));
  L.push(makeClip('hug', 2.5, (u, t) => { const k = env(u, 0.25, 0.85); return merge(idlePose(u, t), { upperarm_l: [-1.2 * k, 0, -0.45 * k], upperarm_r: [-1.2 * k, 0, 0.45 * k], lowerarm_l: [-0.7 * k, 0.6 * k, 0], lowerarm_r: [-0.7 * k, -0.6 * k, 0] }); }));
  L.push(makeClip('bow', 2, (u, t) => { const k = env(u, 0.3, 0.75); return merge(idlePose(u, t), { spine_01: [0.55 * k, 0, 0], head: [0.25 * k, 0, 0] }); }));
  L.push(makeClip('look_around', 4, (u, t) => merge(idlePose(u, t), { head: [0, 0.7 * S(TAU * u), 0], spine_03: [0, 0.2 * S(TAU * u), 0] })));
  L.push(makeClip('fall', 1.2, (u) => { const k = smooth(0, 0.8, u); return { pelvis: [-1.45 * k, 0, 0], thigh_l: [-0.3 * k, 0, 0], thigh_r: [-0.2 * k, 0, 0], upperarm_l: [0, 0, 0.9 * k], upperarm_r: [0, 0, -0.9 * k], _hips: [0, -0.8 * k, -0.2 * k] }; }));
  L.push(makeClip('lie', 4, (u) => ({ pelvis: [-1.5, 0, 0], upperarm_l: [0, 0, 0.3], upperarm_r: [0, 0, -0.3], spine_02: [0.01 * S(TAU * u), 0, 0], _hips: [0, -0.8, -0.2] })));
  return L;
}

// ------------------------------------------------------------------ at (Tosun)

const HORSE = [
  { name: 'root', p: [0, 0, 0] },
  { name: 'body', parent: 'root', p: [0, 1.2, 0] },
  { name: 'neck', parent: 'body', p: [0, 1.38, 0.62] },
  { name: 'head', parent: 'neck', p: [0, 1.8, 0.95] },
  { name: 'tail', parent: 'body', p: [0, 1.38, -0.74] },
];
for (const [s, x, z] of [['fl', 1, 0.56], ['fr', -1, 0.56], ['bl', 1, -0.56], ['br', -1, -0.56]]) {
  HORSE.push(
    { name: `leg_${s}`, parent: 'body', p: [0.17 * x, 1.02, z] },
    { name: `knee_${s}`, parent: `leg_${s}`, p: [0.17 * x, 0.55, z + (z > 0 ? 0.02 : -0.05)] },
    { name: `hoof_${s}`, parent: `knee_${s}`, p: [0.17 * x, 0.07, z] },
  );
}
const XP = Object.fromEntries(HORSE.map((d) => [d.name, d.p]));

function buildHorse() {
  const rig = new Rig(HORSE);
  rig.add('coat', sphere(0.4, [0, 1.2, 0], [0.82, 0.92, 2.0], [28, 16]), 'body', 'body');
  rig.add('coat', capsule([0, 1.36, 0.58], [0, 1.76, 0.9], 0.15), 'neck', 'neck');
  rig.add('coat', capsule([0, 1.82, 0.93], [0, 1.6, 1.3], 0.105), 'head', 'head');
  for (const x of [1, -1]) {
    rig.add('coat', cyl(0.004, 0.03, 0.1, [0.055 * x, 1.95, 0.93], 8), 'head', 'head');
    rig.add('dark', sphere(0.022, [0.085 * x, 1.79, 1.04], [1, 1, 1], [10, 8]), 'head', 'head');
  }
  for (const s of ['fl', 'fr', 'bl', 'br']) {
    rig.add('coat', capsule(XP[`leg_${s}`], XP[`knee_${s}`], 0.075), 'leg', `leg_${s}`);
    rig.add('coat', capsule(XP[`knee_${s}`], XP[`hoof_${s}`], 0.048), 'leg', `knee_${s}`);
    const h = XP[`hoof_${s}`];
    rig.add('dark', cyl(0.06, 0.07, 0.09, [h[0], 0.045, h[2]], 12), 'hoof', `knee_${s}`);
  }
  rig.add('mane', capsule([0, 1.38, -0.74], [0, 0.82, -0.9], 0.055), 'tail', 'tail');
  const mane = new THREE.BoxGeometry(0.05, 0.1, 0.5);
  mane.rotateX(-0.85);
  mane.translate(0, 1.7, 0.73);
  rig.add('mane', mane, 'neck', 'neck');
  const mats = { coat: std('#ffffff', { roughness: 0.55, name: 'tint' }), dark: std('#1c1512', { roughness: 0.4 }), mane: std('#1e1712', { roughness: 0.85 }) };
  const g = rig.build(mats, {});
  g.name = 'horse';
  const quad = (u, k) => {
    const o = {};
    for (const [s, ph] of Object.entries(k.ph)) {
      const a = TAU * (u + ph);
      const hind = s[0] === 'b';
      o[`leg_${s}`] = [-k.leg * S(a), 0, 0];
      o[`knee_${s}`] = [(hind ? -1 : 1) * (0.1 + k.knee * Math.max(0, C(a)) ** 1.5), 0, 0];
    }
    o.body = [k.pitch * S(TAU * u), 0, 0];
    o.neck = [0.05 * S(2 * TAU * u) + k.neck, 0, 0];
    o.tail = [-0.2 - 0.1 * S(TAU * u), 0, 0.1 * S(TAU * u)];
    o._hips = [0, k.bob * C(2 * TAU * u), 0];
    return o;
  };
  const opt = { defs: HORSE, hips: 'body' };
  g.userData.clips = [
    makeClip('idle', 4, (u) => ({ tail: [-0.15, 0, 0.25 * S(TAU * u * 2)], neck: [0.04 * S(TAU * u), 0.08 * S(TAU * u), 0], head: [0.05 * S(TAU * u * 2), 0, 0], body: [0.008 * S(TAU * u), 0, 0] }), opt),
    makeClip('walk', 1.2, (u) => quad(u, { ph: { bl: 0, fl: 0.25, br: 0.5, fr: 0.75 }, leg: 0.32, knee: 0.55, pitch: 0.01, neck: 0, bob: 0.015 }), opt),
    makeClip('trot', 0.7, (u) => quad(u, { ph: { fl: 0, br: 0, fr: 0.5, bl: 0.5 }, leg: 0.48, knee: 0.85, pitch: 0.015, neck: -0.08, bob: 0.04 }), opt),
    makeClip('gallop', 0.5, (u) => quad(u, { ph: { bl: 0, br: 0.1, fl: 0.45, fr: 0.55 }, leg: 0.7, knee: 1.1, pitch: 0.07, neck: -0.12, bob: 0.07 }), opt),
    makeClip('eat', 4, (u) => ({ neck: [0.95, 0, 0], head: [0.35 + 0.06 * S(TAU * u * 6), 0, 0], tail: [-0.15, 0, 0.2 * S(TAU * u * 1.5)] }), opt),
    makeClip('neigh', 2, (u) => { const k = env(u, 0.2, 0.8); return { neck: [-0.35 * k, 0, 0], head: [-0.4 * k, 0.15 * S(TAU * u * 4) * k, 0], body: [-0.05 * k, 0, 0], tail: [-0.3, 0, 0.3 * S(TAU * u * 3)] }; }, opt),
  ];
  return { scene: g, animations: g.userData.clips };
}

// ------------------------------------------------------------------ köy avlusu

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function buildYard() {
  const g = new THREE.Group();
  g.name = 'village_yard';
  const R = rng(7);
  const grass = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#6f7a3f'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = R();
      x.fillStyle = v < 0.33 ? '#5d6a33' : v < 0.66 ? '#86904c' : '#7a6a42';
      x.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 5);
    }
  }, 14);
  const dirt = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#8a7353'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) { const v = R(); x.fillStyle = v < 0.5 ? '#7a6447' : v < 0.8 ? '#9c8562' : '#6b573e'; x.fillRect(R() * w, R() * h, 1 + R() * 4, 1 + R() * 3); }
  }, 4);
  const stoneT = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#8f8678'; x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 32) for (let xx = (yy / 32) % 2 ? -24 : 0; xx < w; xx += 48) {
      const v = 120 + Math.floor(R() * 50);
      x.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      x.fillRect(xx + 2, yy + 2, 44, 28);
    }
  }, 1);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  const yard = new THREE.Mesh(new THREE.CircleGeometry(9.5, 48), new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }));
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.01;
  yard.receiveShadow = true;
  g.add(yard);
  const stone = new THREE.MeshStandardMaterial({ map: stoneT, roughness: 0.9 });
  const add = (geo, mat, p, r = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(p[0], p[1], p[2]); m.rotation.y = r; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // Ahır
  const wallT = stoneT.clone(); wallT.repeat.set(3, 1.2);
  const wallM = new THREE.MeshStandardMaterial({ map: wallT, roughness: 0.92 });
  add(new THREE.BoxGeometry(8, 3.2, 5), wallM, [-5, 1.6, -7.5]);
  const roof = new THREE.CylinderGeometry(0.01, 3.4, 1.8, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.7, 1, 1.1);
  add(roof, new THREE.MeshStandardMaterial({ color: '#7d4b33', roughness: 0.85 }), [-5, 4.1, -7.5]);
  add(new THREE.BoxGeometry(1.8, 2.3, 0.1), new THREE.MeshStandardMaterial({ color: '#1b130e', roughness: 1 }), [-4.2, 1.15, -4.97]);
  add(new THREE.BoxGeometry(2.0, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: '#5a3a24' }), [-4.2, 2.35, -4.9]);
  // Çeşme ve yalak
  add(new THREE.BoxGeometry(2.0, 0.55, 0.7), stone, [4.6, 0.275, 1.2], -0.35);
  const water = add(new THREE.BoxGeometry(1.8, 0.02, 0.5), new THREE.MeshStandardMaterial({ color: '#3b5a63', roughness: 0.08, metalness: 0.2 }), [4.6, 0.5, 1.2], -0.35);
  water.castShadow = false;
  add(new THREE.BoxGeometry(0.6, 1.7, 0.45), stone, [5.0, 0.85, 1.75], -0.35);
  // Alçak taş duvar (kapı +Z'de)
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    if (Math.abs(a - Math.PI / 2) < 0.22) continue;
    const r = 10.5;
    add(new THREE.BoxGeometry(2.45, 0.9 + R() * 0.15, 0.55), stone, [Math.cos(a) * r, 0.45, Math.sin(a) * r], -a + Math.PI / 2);
  }
  // Ağaçlar (söğüt, kestane) ve uzak tepeler
  const bark = new THREE.MeshStandardMaterial({ color: '#4a3626', roughness: 1 });
  const leafA = new THREE.MeshStandardMaterial({ color: '#4e6b35', roughness: 0.9 });
  const leafB = new THREE.MeshStandardMaterial({ color: '#6f8a4a', roughness: 0.9 });
  const tree = (x, z, s, m) => {
    add(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 2.6 * s, 8), bark, [x, 1.3 * s, z]);
    for (let k = 0; k < 4; k++) add(new THREE.IcosahedronGeometry(1.2 * s * (0.8 + R() * 0.4), 1), m, [x + (R() - 0.5) * 1.6 * s, 3.0 * s + R() * 1.0 * s, z + (R() - 0.5) * 1.6 * s]);
  };
  tree(6.5, -6, 1.25, leafA); tree(-9, 3, 1.1, leafB); tree(9.5, 6, 1.4, leafA); tree(-13, -9, 1.6, leafA); tree(14, -12, 1.8, leafB);
  tree(-3, 15, 1.5, leafB); tree(5, 18, 1.7, leafA); tree(-16, 12, 1.4, leafA);
  const hill = new THREE.MeshStandardMaterial({ color: '#6c7a52', roughness: 1 });
  for (const [x, z, s] of [[-40, -55, 26], [10, -70, 34], [55, -40, 24], [-65, 10, 22], [60, 35, 26]]) {
    const m = add(new THREE.SphereGeometry(s, 24, 12, 0, TAU, 0, Math.PI / 2), hill, [x, -s * 0.35, z]);
    m.scale.y = 0.45;
    m.castShadow = false;
  }
  // Saman balyası, tahta çit
  const hay = new THREE.MeshStandardMaterial({ color: '#c8a85a', roughness: 1 });
  add(new THREE.BoxGeometry(1.1, 0.5, 0.6), hay, [-1.6, 0.25, -4.3], 0.3);
  add(new THREE.BoxGeometry(1.1, 0.5, 0.6), hay, [-1.2, 0.75, -4.4], 0.1);
  const wood = new THREE.MeshStandardMaterial({ color: '#6a4a30', roughness: 0.9 });
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.1, 1.1, 0.1), wood, [-8 + i * 0.9, 0.55, -2.6]);
  add(new THREE.BoxGeometry(5, 0.08, 0.06), wood, [-5.75, 0.9, -2.6]);
  add(new THREE.BoxGeometry(5, 0.08, 0.06), wood, [-5.75, 0.5, -2.6]);
  return { scene: g, animations: [] };
}

// ------------------------------------------------------------------ iç mekânlar (ahır, oda) — içe dönük kabuk: kamera
// dışarıdan baksa da yakın duvar görünmez ("dördüncü duvar").

function shell(g, w, h, d, wallMat, floorMat, ceilMat) {
  const add = (geo, mat, p, r = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.receiveShadow = true; g.add(m); return m; };
  const floor = add(new THREE.PlaneGeometry(w, d), floorMat, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  void floor;
  add(new THREE.PlaneGeometry(w, h), wallMat, [0, h / 2, -d / 2]);
  add(new THREE.PlaneGeometry(w, h), wallMat, [0, h / 2, d / 2], [0, Math.PI, 0]);
  add(new THREE.PlaneGeometry(d, h), wallMat, [-w / 2, h / 2, 0], [0, Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(d, h), wallMat, [w / 2, h / 2, 0], [0, -Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(w, d), ceilMat, [0, h, 0], [Math.PI / 2, 0, 0]);
}

function buildStable() {
  const g = new THREE.Group();
  g.name = 'stable';
  const R = rng(11);
  const planks = canvasTex(256, 256, (x, w, h) => {
    for (let i = 0; i < 8; i++) { const v = 70 + Math.floor(R() * 40); x.fillStyle = `rgb(${v + 30},${v + 12},${v - 8})`; x.fillRect(0, i * 32, w, 31); x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, i * 32 + 31, w, 1); }
  }, 1);
  planks.repeat.set(4, 1.4);
  const straw = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#8c7344'; x.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { x.strokeStyle = R() < 0.5 ? '#c3a35c' : '#6d5634'; x.beginPath(); const a = R() * w, b = R() * h, t = R() * 6.28; x.moveTo(a, b); x.lineTo(a + Math.cos(t) * 9, b + Math.sin(t) * 9); x.stroke(); } }, 5);
  const wall = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.92, side: THREE.FrontSide });
  shell(g, 10, 3.4, 8, wall, new THREE.MeshStandardMaterial({ map: straw, roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 1 }));
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3b24', roughness: 0.85 });
  const add = (geo, mat, p, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // Bölmeler, kirişler, yemlik, saman
  for (const x of [-4.2, -1.6]) add(new THREE.BoxGeometry(0.12, 1.4, 2.6), wood, [x, 0.7, -2.6]);
  for (const x of [-4, -1, 2, 4.4]) add(new THREE.BoxGeometry(0.22, 0.22, 8), wood, [x, 3.1, 0]);
  add(new THREE.BoxGeometry(2.2, 0.5, 0.5), wood, [-2.9, 0.7, -3.7]);
  const hay = new THREE.MeshStandardMaterial({ color: '#c6a457', roughness: 1 });
  add(new THREE.BoxGeometry(1.2, 0.55, 0.65), hay, [3.6, 0.28, -3.2], 0.2);
  add(new THREE.BoxGeometry(1.2, 0.55, 0.65), hay, [3.9, 0.83, -3.3], -0.1);
  add(new THREE.BoxGeometry(0.6, 0.9, 0.6), wood, [4.2, 0.45, 2.6]);
  // Kapı ve pencere aydınlığı
  const glow = new THREE.MeshBasicMaterial({ color: '#fff1d0' });
  add(new THREE.PlaneGeometry(1.6, 2.3), glow, [4.98, 1.15, 0.5], -Math.PI / 2).castShadow = false;
  add(new THREE.PlaneGeometry(0.9, 0.6), glow, [-2, 2.4, -3.98]).castShadow = false;
  const lamp = new THREE.PointLight('#ffcf8a', 6, 9, 1.6);
  lamp.position.set(0.5, 2.7, 0.5);
  g.add(lamp);
  return { scene: g, animations: [] };
}

function buildRoom() {
  const g = new THREE.Group();
  g.name = 'house_room';
  const R = rng(5);
  const plaster = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#d8ccb4'; x.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.08)' : 'rgba(90,70,40,.08)'; x.fillRect(R() * w, R() * h, 3, 3); } }, 2);
  const boards = canvasTex(256, 256, (x, w, h) => { for (let i = 0; i < 8; i++) { const v = 90 + Math.floor(R() * 30); x.fillStyle = `rgb(${v + 20},${v},${v - 25})`; x.fillRect(i * 32, 0, 31, h); } }, 3);
  shell(g, 6, 2.8, 5.4, new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: boards, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#6b5238', roughness: 1 }));
  const add = (geo, mat, p, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const red = new THREE.MeshStandardMaterial({ color: '#7d2a22', roughness: 0.9 });
  add(new THREE.BoxGeometry(2.6, 0.42, 0.85), red, [-1.2, 0.21, -2.2]); // sedir
  add(new THREE.BoxGeometry(2.6, 0.5, 0.18), red, [-1.2, 0.55, -2.58]);
  add(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 20), new THREE.MeshStandardMaterial({ color: '#5a3b24' }), [0.6, 0.16, -0.6]); // sini
  const rug = add(new THREE.PlaneGeometry(2.8, 1.9), new THREE.MeshStandardMaterial({ color: '#8a3b2a', roughness: 1 }), [0.2, 0.012, 0.1]);
  rug.rotation.x = -Math.PI / 2; rug.castShadow = false;
  add(new THREE.BoxGeometry(0.5, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: '#4a3220' }), [2.5, 0.6, -2.3]); // sandık
  const win = add(new THREE.PlaneGeometry(1.0, 1.1), new THREE.MeshBasicMaterial({ color: '#cfe0f0' }), [1.2, 1.6, -2.69]);
  win.castShadow = false;
  const lampM = new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb860', emissiveIntensity: 2.5 });
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12), lampM, [0.6, 0.43, -0.6]).castShadow = false;
  const lamp = new THREE.PointLight('#ffbf70', 5, 8, 1.6);
  lamp.position.set(0.6, 0.7, -0.6);
  g.add(lamp);
  return { scene: g, animations: [] };
}

function buildPropComb() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.06), std('#c9ccd0', { metalness: 0.9, roughness: 0.3 }));
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), std('#6a4528'));
  h.position.y = 0.035;
  g.add(m, h);
  return { scene: g, animations: [] };
}

// ------------------------------------------------------------------ katalog

export const PH_SPOTS = { a: [0, 0, 0.8], b: [1.9, 0, 0.1], c: [-2.4, 0, -1.4], d: [3.7, 0, 1.9], e: [0.4, 0, 8.4], f: [-0.6, 0, 2.6], g: [-3.9, 0, -3.8] };

export function placeholderCatalog() {
  const exprs = ['neutral', 'smile', 'laugh', 'sad', 'cry', 'angry', 'fear', 'surprise', 'disgust', 'think', 'shout', 'blink_l', 'blink_r'];
  const P = (id, tint = true) => ({ id, url: `@ph/${id}`, tint });
  return {
    v: 0,
    placeholder: true,
    human: {
      url: '@ph/human',
      morphs: [
        { id: 'age', neutral: 0.5, label: 'Yaş' }, { id: 'gender', neutral: 0.5, label: 'Cinsiyet' }, { id: 'weight', neutral: 0.5, label: 'Kilo' },
        { id: 'muscle', neutral: 0.5, label: 'Kas' }, { id: 'height', neutral: 0.5, label: 'Boy' }, { id: 'belly', neutral: 0, label: 'Göbek' },
      ],
      skin: ['#F1D3BC', '#E2B48E', '#C68E62', '#8D5A3B', '#5B3A29'],
      expressions: exprs,
      visemes: ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'],
    },
    parts: {
      hair: [P('short_straight'), P('short_curly'), P('long'), { id: 'bald', url: null }].map((p) => ({ ...p, url: p.url && p.url.replace('@ph/', '@ph/hair_') })),
      brows: [P('thin'), P('thick')].map((p) => ({ ...p, url: p.url.replace('@ph/', '@ph/brows_') })),
      beard: [P('full'), P('short')].map((p) => ({ ...p, url: p.url.replace('@ph/', '@ph/beard_') })),
      mustache: [P('classic')].map((p) => ({ ...p, url: p.url.replace('@ph/', '@ph/mustache_') })),
      outfit: [P('village_boy_1', false), P('village_man_1', false), P('elder_1', false)].map((p) => ({ ...p, url: p.url.replace('@ph/', '@ph/outfit_') })),
      hat: [P('fez_red'), P('cap_wool')].map((p) => ({ ...p, url: p.url.replace('@ph/', '@ph/hat_'), bone: 'head' })),
      prop_hand: [{ id: 'curry_comb', url: '@ph/prop_curry_comb', tint: false, bone: 'hand_r' }],
    },
    anims: { url: '@ph/anims', clips: humanClips().map((c) => c.name), speeds: { walk: 1.25, walk_slow: 0.7, run: 3.3 } },
    animals: [{ id: 'horse', url: '@ph/horse', clips: ['idle', 'walk', 'trot', 'gallop', 'eat', 'neigh'], speeds: { walk: 1.5, trot: 3.4, gallop: 7.5 } }],
    env: [
      { id: 'village_yard', url: '@ph/yard', spots: PH_SPOTS, time: ['dawn', 'day', 'dusk', 'night'], camera: [0, 0, 1] },
      { id: 'stable', url: '@ph/stable', interior: true, radius: 4.4, ceiling: 3.4, camera: [0, 0, 1], spots: { a: [0.6, 0, 1.2], b: [1.8, 0, 0.2], c: [-0.6, 0, 0.1], d: [-2.9, 0, -2.4], e: [2.6, 0, 2.2] } },
      { id: 'house_room', url: '@ph/room', interior: true, radius: 2.5, ceiling: 2.8, camera: [0, 0, 1], spots: { a: [-0.8, 0, 0.6], b: [0.9, 0, 0.3], c: [0.2, 0, -1.2], d: [-1.6, 0, -1.4] } },
    ],
    props: [{ id: 'curry_comb', url: '@ph/propo_curry_comb', grip: [0, -0.09, 0.04] }],
  };
}

/** '@ph/...' adresleri için glTF benzeri nesne. */
export function placeholderGltf(url) {
  const id = url.replace(/^.*@ph\//, '');
  if (id === 'human') return buildHuman();
  if (id === 'anims') { const g = new THREE.Group(); return { scene: g, animations: humanClips() }; }
  if (id === 'horse') return buildHorse();
  if (id === 'yard') return buildYard();
  if (id === 'stable') return buildStable();
  if (id === 'room') return buildRoom();
  if (id === 'propo_curry_comb') return buildPropComb();
  const p = buildPart(id);
  if (p) return p;
  throw new Error('yer tutucu yok: ' + id);
}
