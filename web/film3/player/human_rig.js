// HADİ Film v3 — insan tabanı çalışma zamanı yardımcısı (başvuru uygulaması, Ajan A).
// Oynatıcı (C) bu dosyayı olduğu gibi kopyalayıp kullanabilir: three.js r169+ ile çalışır.
//
// Kullanım:
//   const rig = new HumanRig(gltf.scene, catalog.human);   // human.glb yüklendikten sonra
//   rig.setShape({age: 0.19, gender: 1, weight: 0.35, nose_long: 0.7});  // 0..1, nötr 0.5
//   rig.setSkin('#E2B48E'); rig.setEyes('#5A3A1E');
//   rig.attach(partGltf.scene, {tint: '#E3C16F'});            // saç, kaş, giysi…
//   rig.attach(hat.scene, {hairTint: '#E3C16F'});              // şapka: altındaki kısa saç bu rengi alır (kelse verme)
//   rig.setFace({smile: 0.6}, {aa: 0.8});                   // ifade + visem (her karede)
//
// Not: HumanRig'i her karakter için bozulmamış bir klon üzerinde kurun (SkeletonUtils.clone);
// kurucu dinlenme pozunu o anki kemiklerden okur.
// Kurallar: tüm morph adları (glTF targetNames) human.glb ve parçalarda ortaktır; parçalar
// insanla aynı eklem sırasına sahiptir, bu yüzden insan iskeletine doğrudan bağlanır.
// Vücut biçimi değişince eklem konumları scene.userData.film3.jointDeltas ile yeniden
// hesaplanır ve bağ (bind) matrisleri güncellenir; animasyonlar yalnızca dönme kullanmalıdır
// (kök/pelvis ötelemesi hariç).
import * as THREE from 'three';

export function pl(x, keys) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [x1, y1] = keys[i];
    if (x <= x1) {
      const [x0, y0] = keys[i - 1];
      return y0 + (y1 - y0) * (x - x0) / Math.max(1e-9, x1 - x0);
    }
  }
  return keys[keys.length - 1][1];
}

// MakeHuman yaş ölçeği: yıl → 0..1
export function ageToValue(years) {
  return pl(years, [[1, 0], [11, 0.1875], [25, 0.5], [90, 1]]);
}

export class HumanRig {
  constructor(scene, cat) {
    this.scene = scene;
    this.cat = cat;
    this.meshes = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) this.meshes.push(o); });
    this.base = this.meshes[0];
    this.skeleton = this.base.skeleton;
    this.bones = this.skeleton.bones;
    const ex = (scene.userData && scene.userData.film3) || {};
    this.jd = ex.jointDeltas || {};
    this.params = {};
    this.shapeW = {};
    // armatür uzayındaki dinlenme kareleri (Human düğümüne göre)
    const armature = this.bones[0].parent;
    scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(armature.matrixWorld).invert();
    this.restArm = this.bones.map((b) => new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld));
    this.restHead = this.restArm.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    this.restRot = this.restArm.map((m) => new THREE.Matrix4().extractRotation(m));
    this.restQuat = this.bones.map((b) => b.quaternion.clone());
    this.boneIndex = Object.fromEntries(this.bones.map((b, i) => [b.name, i]));
    this.parentIdx = this.bones.map((b) => (b.parent && b.parent.isBone ? this.boneIndex[b.parent.name] : -1));
    this.skeletons = new Set();
    this.E = new Map();
    // her mesh'in (11 bölge + göz/diş/dil + iç giysi) kendi Skeleton nesnesi olabilir: hepsini kaydet
    for (const m of this.meshes) this._regSkeleton(m.skeleton);
    this.parts = [];
    this.skinMats = [];
    this.irisMats = [];
    for (const m of this.meshes) {
      const mat = m.material;
      const role = mat && mat.userData && mat.userData.role;
      if (mat && (mat.name === 'skin' || role === 'skin')) this.skinMats.push(mat);
      if (mat && (mat.name === 'iris' || role === 'iris')) this.irisMats.push(mat);
    }
  }

  _regSkeleton(sk, boneNames) {
    if (this.E.has(sk)) return;
    // SkeletonUtils.clone klonlar arasında boneInverses Matrix4'lerini paylaşır: yerinde yazmadan önce kopyala
    sk.boneInverses = sk.boneInverses.map((m) => m.clone());
    // E = restArm * boneInverse (gltfpack -vpf ile birim matris; yine de korunur)
    const idx = (i) => (boneNames ? (this.boneIndex[boneNames[i]] ?? 0) : this.boneIndex[sk.bones[i].name] ?? i);
    this.E.set(sk, sk.boneInverses.map((bi, i) => new THREE.Matrix4().multiplyMatrices(this.restArm[idx(i)], bi)));
    this.skeletons.add(sk);
  }

  // Tüm morph sürücülerini değerlendir → hedef ağırlıkları
  evalTargets(params) {
    const P = this.cat.params;
    const val = (id) => (params[id] !== undefined ? params[id] : (P[id] ? P[id].neutral : 0.5));
    const out = {};
    for (const [t, drive] of Object.entries(this.cat.targets)) {
      let w = 1;
      for (const [p, keys] of Object.entries(drive)) {
        w *= pl(val(p), keys);
        if (w === 0) break;
      }
      if (w > 1e-4) out[t] = w;
    }
    return out;
  }

  _applyInfluences(mesh, weights, names) {
    const dict = mesh.morphTargetDictionary;
    const inf = mesh.morphTargetInfluences;
    if (!dict || !inf) return;
    for (const n of names) {
      const i = dict[n];
      if (i !== undefined) inf[i] = weights[n] || 0;
    }
  }

  setShape(params) {
    this.params = { ...params };
    const w = this.evalTargets(this.params);
    this.shapeW = w;
    const names = Object.keys(this.cat.targets);
    for (const m of this.allMeshes()) this._applyInfluences(m, w, names);
    this._updateJoints(w);
  }

  _updateJoints(w) {
    const n = this.bones.length;
    const heads = this.restHead.map((h) => h.clone());
    for (const [t, wt] of Object.entries(w)) {
      const row = this.jd[t];
      if (!row) continue;
      for (const [bn, d] of Object.entries(row)) {
        const i = this.boneIndex[bn];
        if (i !== undefined) heads[i].add(new THREE.Vector3(d[0] * wt, d[1] * wt, d[2] * wt));
      }
    }
    this.heads = heads;
    const tmp = new THREE.Matrix4();
    const newArm = [];
    for (let i = 0; i < n; i++) {
      const p = this.parentIdx[i];
      const b = this.bones[i];
      if (p < 0) b.position.copy(heads[i]);
      else {
        const d = heads[i].clone().sub(heads[p]);
        tmp.copy(this.restRot[p]).transpose();
        b.position.copy(d.applyMatrix4(tmp));
      }
      const M = this.restRot[i].clone();
      M.setPosition(heads[i]);
      newArm.push(M);
    }
    for (const sk of this.skeletons) {
      const E = this.E.get(sk);
      for (let i = 0; i < sk.bones.length; i++) {
        const bi = this.boneIndex[sk.bones[i].name];
        if (bi === undefined) continue;
        sk.boneInverses[i].copy(newArm[bi]).invert().multiply(E[i]);
      }
    }
  }

  allMeshes() {
    const out = [...this.meshes];
    for (const p of this.parts) out.push(...p.meshes);
    return out;
  }

  // ifade ve visem ağırlıkları → yüz birimleri (u_*) etkileri
  setFace(expr = {}, vis = {}) {
    const u = {};
    const add = (recipe, k) => { for (const [n, v] of Object.entries(recipe)) u[n] = (u[n] || 0) + v * k; };
    for (const [e, k] of Object.entries(expr)) if (k && this.cat.expressions[e]) add(this.cat.expressions[e], k);
    for (const [v, k] of Object.entries(vis)) if (k && this.cat.visemes[v]) add(this.cat.visemes[v], k);
    // çocuk yüzü küçük: aynı mutlak deltalar orantısız büyük durmasın
    const ks = this.cat.unitScaleByAge ? pl(this.params.age !== undefined ? this.params.age : 0.5, this.cat.unitScaleByAge) : 1;
    for (const n of this.cat.units) u[n] = Math.min(1, u[n] || 0) * (n.startsWith('u_mouth') ? ks : 1);  // göz kırpma tam kalsın
    for (const m of this.allMeshes()) this._applyInfluences(m, u, this.cat.units);
  }

  // Not: klonlanan karakterler malzemeyi paylaşır; renkler karaktere özgü olsun diye ilk çağrıda klonlanır.
  setSkin(hex) {
    this.skinMats = this._own(this.skinMats);
    for (const m of this.skinMats) m.color.set(hex);
  }

  // göz rengi: catalog.human.eyeColors içinden hex (iris malzemesi rengi)
  setEyes(hex) {
    this.irisMats = this._own(this.irisMats);
    for (const m of this.irisMats) m.color.set(hex);
  }

  _own(mats) {
    if (this._owned && this._owned.has(mats)) return mats;
    const map = new Map(mats.map((m) => [m, m.clone()]));
    for (const mesh of this.meshes) if (map.has(mesh.material)) mesh.material = map.get(mesh.material);
    const out = [...map.values()];
    this._owned = this._owned || new Set();
    this._owned.add(out);
    return out;
  }

  // Parça bağla (aynı eklem sırası). opts.tint: renk; döner: parça kaydı
  attach(partScene, opts = {}) {
    const meshes = [];
    partScene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const rec = { scene: partScene, meshes, hidden: [] };
    for (const m of meshes) {
      // parça kendi iskeletini getirir; kemikleri insanınkilerle değiştir
      const names = m.skeleton.bones.map((b) => b.name);
      const sk = new THREE.Skeleton(names.map((nm) => this.bones[this.boneIndex[nm]] || this.bones[0]),
        m.skeleton.boneInverses.map((b) => b.clone()));
      this._regSkeleton(sk, names);  // E: parçanın bağ matrisleri dinlenmeye göre
      m.bind(sk, m.bindMatrix);  // parçanın kendi bağ matrisi (gltfpack nicemleme dönüşümünü taşır)
      m.frustumCulled = false;
      const ud = (m.material && m.material.userData) || {};
      if (ud.tint === 'hair') {
        // şapka altından görünen kısa saç: karakterin saç rengi; kel karakterde gizli
        if (opts.hairTint) { m.material = m.material.clone(); m.material.color.set(opts.hairTint); } else m.visible = false;
      } else if (opts.tint && ud.tint !== false) {
        const mat = m.material.clone();
        if (ud.tint === 'secondary' && opts.tint2) mat.color.set(opts.tint2);
        else if (ud.tint !== 'secondary') mat.color.set(opts.tint);
        m.material = mat;
      }
    }
    const f3 = partScene.userData.film3 || {};
    rec.kind = f3.kind;
    rec.hidesHair = !!f3.hidesHair;
    this._applyHairVisibility(rec);
    this.base.parent.add(partScene);
    // parçanın gizlediği beden bölgeleri
    const hide = (partScene.userData.film3 && partScene.userData.film3.hide) || [];
    for (const m of this.meshes) {
      const reg = (m.userData && m.userData.region) || (m.parent && m.parent.userData && m.parent.userData.region);
      if (reg && hide.includes(reg)) { m.visible = false; rec.hidden.push(m); }
    }
    this.parts.push(rec);
    // mevcut biçim/yüz ağırlıklarını yeni parçaya da uygula
    if (this.shapeW) {
      const names = Object.keys(this.cat.targets);
      for (const m of meshes) this._applyInfluences(m, this.shapeW, names);
      this._updateJoints(this.shapeW);
    }
    return rec;
  }

  // şapka (hidesHair) takılıyken saç parçası gizlenir; şapka çıkınca geri gelir
  _applyHairVisibility(rec) {
    const hatOn = this.parts.some((p) => p.hidesHair) || rec.hidesHair;
    for (const p of [...this.parts, rec]) if (p.kind === 'hair') p.scene.visible = !hatOn;
  }

  detach(rec) {
    rec.scene.removeFromParent();
    this.parts = this.parts.filter((p) => p !== rec);
    this._applyHairVisibility({});
    for (const m of rec.meshes) { this.skeletons.delete(m.skeleton); this.E.delete(m.skeleton); }
    for (const m of rec.hidden) m.visible = true;
    this.parts = this.parts.filter((p) => p !== rec);
  }
}
