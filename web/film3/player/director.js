// HADİ Film v3 — yönetmen. Senaryo (spec §4) sahne sahne bir kez "planlanır" (aktörlerin yolları, dönüşleri, klip dizisi,
// ifadeler, eşyalar); sonra her kare yalnızca t'ye bakarak değerlendirilir: seek/hız her zaman doğru, durum birikmez.
// Kamera: çekim tipleri (establishing, wide, medium, close, over_shoulder/ots, two_shot, pov, insert) ve hareketler
// (static, dolly_in/out, pan / pan_l / pan_r, orbit, crane, track, handheld). Çekim yoksa ya da "auto" ise: konuşana yakın
// plan / omuz üstü (180° kuralıyla aynı taraftan karşı açı), hareket edene orta plan takip, aksi hâlde geniş plan.
import * as THREE from 'three';
import { visemesFromText, visemeWeightsAt } from './visemes.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

const MOVE = new Set(['walk', 'walk_slow', 'run', 'trot', 'gallop']);
const ONCE = new Set(['point', 'wave', 'nod', 'pick_up', 'give', 'slap', 'hug', 'bow', 'stand_up', 'sit', 'kneel', 'fall', 'head_shake', 'neigh']);
const HOLD = new Set(['sit', 'kneel', 'fall', 'lie']);
const SAD = new Set(['sad', 'cry']);
const FX = 0.35; // klip geçişi (sn)

/** Filmi normalleştirir: sahneler t'ye göre, beat/shot sıralı, replikler id'yle, eksik visemler metinden. */
export function prepareFilm(film) {
  const f = JSON.parse(JSON.stringify(film || {}));
  f.scenes = (f.scenes || []).slice().sort((a, b) => a.t0 - b.t0);
  let end = 0;
  f.scenes.forEach((s, i) => {
    s._i = i;
    s.beats = (s.beats || []).slice().sort((a, b) => a.t - b.t);
    s.shots = (s.shots || []).slice().sort((a, b) => a.t - b.t);
    s.actors = s.actors || [];
    if (!(s.t1 > s.t0)) s.t1 = Math.max(s.t0 + 1, ...s.beats.map((b) => b.t + (b.d || 0)));
    end = Math.max(end, s.t1);
  });
  f.lines = (f.lines || []).map((l) => ({ ...l, visemes: l.visemes && l.visemes.length ? l.visemes : visemesFromText(l.text, l.d || 1.5) }));
  f.lineById = new Map(f.lines.map((l) => [l.id, l]));
  f.dur = f.dur > 0 ? f.dur : end;
  return f;
}

export function sceneAt(film, t) {
  const S = film.scenes;
  for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].t0) return i;
  return 0;
}

// ------------------------------------------------------------------ sahne planı

export class ScenePlan {
  /** world: {spots: {ad: Vector3|{p,yaw}}, center, radius, side}; actors: Map id → Actor. */
  constructor(film, scene, world, actors) {
    this.film = film;
    this.scene = scene;
    this.world = world;
    this.actors = actors;
    this.ids = [];
    this.tracks = new Map();
    this.lines = film.lines.filter((l) => l.t < scene.t1 && l.t + (l.d || 0) > scene.t0);
    this._build();
  }

  spot(id, fallbackIndex = 0) {
    const s = this.world.spots[id];
    if (s) return (s.isVector3 ? s : s.p).clone();
    const keys = Object.keys(this.world.spots);
    if (keys.length && fallbackIndex < keys.length && !id) return this.spot(keys[fallbackIndex]);
    const a = (fallbackIndex / Math.max(3, this.scene.actors.length)) * Math.PI * 2;
    return this.world.center.clone().add(V(Math.sin(a) * 2, 0, Math.cos(a) * 2));
  }

  _build() {
    const sc = this.scene;
    const st = new Map();
    const ids = new Set(sc.actors.map((a) => a.id));
    for (const b of sc.beats) if (b.who && this.actors.has(b.who)) ids.add(b.who);
    for (const l of this.lines) if (this.actors.has(l.who)) ids.add(l.who);
    this.ids = [...ids].filter((id) => this.actors.has(id));
    const used = new Set();
    this.ids.forEach((id, i) => {
      const def = sc.actors.find((a) => a.id === id);
      let pos;
      if (def?.spot && this.world.spots[def.spot]) { pos = this.spot(def.spot); used.add(def.spot); }
      else if (def?.pos) pos = V(...def.pos);
      else {
        const free = Object.keys(this.world.spots).find((k) => !used.has(k));
        if (free) { used.add(free); pos = this.spot(free); } else pos = this.spot(null, i + 7);
      }
      for (const o of st.values()) if (o.pos.distanceTo(pos) < 0.7) pos.add(V(0.9, 0, 0.35)); // aynı spot: yana
      st.set(id, { pos, yaw: 0 });
      this.tracks.set(id, { init: null, segs: [], turns: [], clips: [], exprs: [], props: [] });
    });
    const centroid = V();
    for (const s of st.values()) centroid.add(s.pos);
    if (st.size) centroid.multiplyScalar(1 / st.size);
    // Başlangıç yönleri: face (aktör/spot) ya da topluluğun ortası.
    for (const id of this.ids) {
      const def = sc.actors.find((a) => a.id === id) || {};
      const s = st.get(id);
      const tgt = def.face ? this._target(def.face, st, id) : null;
      if (def.yaw != null) s.yaw = def.yaw;
      else if (tgt) s.yaw = yawTo(s.pos, tgt);
      else if (this.actors.get(id).kind === 'animal') {
        // Hayvan: kameraya dik bakmasın — kamera tarafına profilden (yan) durur, başı sahnenin ortasına dönük.
        const ys = Math.atan2(this.world.side.x, this.world.side.z);
        const toC = centroid.clone().sub(s.pos);
        const a1 = ys + Math.PI / 2, a2 = ys - Math.PI / 2;
        const f1 = V(Math.sin(a1), 0, Math.cos(a1));
        s.yaw = f1.dot(toC) >= 0 ? a1 : a2;
      }
      else if (centroid.distanceTo(s.pos) > 0.3) s.yaw = yawTo(s.pos, centroid);
      else s.yaw = Math.atan2(this.world.side.x, this.world.side.z);
      // Yükseltilmiş spot (sedir, sandalye): yerde durur, oturma klibiyle kalça o yüksekliğe iner.
      const seated = s.pos.y > 0.25 && this.actors.get(id).kind === 'human';
      // Sedir/sandalye: kök, oturma klibinin kalça yüksekliği oturağın üstüne gelecek kadar kaldırılır (klip yere yakın oturuyorsa).
      const Ac = this.actors.get(id);
      // B: spot y = oturak yüzeyi; oturma klibinin oturak yüksekliği (meta.sit_idle.seatHeight) kadarı klipten gelir.
      const lift = !seated ? 0 : Ac.seatH != null ? Math.max(0, Math.min(0.5, s.pos.y - Ac.seatH)) : Math.max(0, Math.min(0.35, s.pos.y + 0.08 - (Ac.sitH || s.pos.y + 0.08)));
      if (seated) s.pos.y = lift;
      this.tracks.get(id).init = { pos: s.pos.clone(), yaw: s.yaw, seated };
    }
    let gest = 0;
    const lineBy = this.film.lineById;
    const busy = new Map(); // id → hareket bitiş anı
    for (const b of sc.beats) {
      const id = b.who;
      if (!id || !st.has(id)) continue;
      const A = this.actors.get(id), s = st.get(id), tr = this.tracks.get(id);
      const line = b.say ? lineBy.get(b.say) : null;
      const d = Math.max(0.4, b.d || line?.d || 1.2);
      let doName = b.do || null;
      if (doName === 'run' && A.kind === 'animal') doName = 'gallop';
      const t0 = Math.max(b.t, busy.get(id) && MOVE.has(doName) ? busy.get(id) : b.t);
      // Hareket
      if (doName && MOVE.has(doName)) {
        let to = b.to ? this._target(b.to, st, id, true) : null;
        if (!to) {
          const fw = V(Math.sin(s.yaw), 0, Math.cos(s.yaw));
          to = s.pos.clone().addScaledVector(fw, Math.min(2.5, (A.speeds[doName] || 1.2) * d * 0.6));
          const c = this.world.center, r = this.world.radius * 0.85;
          if (to.distanceTo(c) > r) to = s.pos.clone().lerp(c, 0.5);
        }
        // Hedefte başka biri duruyorsa önünde (yanında) durulur: iki oyuncu üst üste binmez.
        for (const [oid, o] of st) {
          if (oid === id) continue;
          const rr = this.actors.get(oid).kind === 'animal' ? 1.1 : 0.75;
          if (o.pos.distanceTo(to) < rr) {
            const back = s.pos.clone().sub(o.pos).setY(0);
            if (back.lengthSq() < 1e-4) back.set(0.7, 0, 0.7);
            to = o.pos.clone().addScaledVector(back.normalize(), rr + 0.1);
          }
        }
        const dist = s.pos.distanceTo(to);
        if (dist > 0.15) {
          const sp = A.speeds[A.clipFor(doName)] || A.speeds[doName] || (doName === 'run' ? 3.2 : doName === 'gallop' ? 7 : doName === 'trot' ? 3.2 : 1.25);
          let dur = dist / sp;
          if (dur > d) dur = Math.max(d, dist / (sp * 1.5));
          const yaw1 = yawTo(s.pos, to);
          tr.turns.push({ t0, t1: t0 + 0.35, y0: s.yaw, y1: yaw1 });
          tr.segs.push({ t0, t1: t0 + dur, from: s.pos.clone(), to: to.clone(), clip: doName, speed: dist / dur });
          tr.clips.push({ t: t0, d: dur, clip: doName, move: tr.segs[tr.segs.length - 1] });
          s.pos.copy(to);
          s.yaw = yaw1;
          busy.set(id, t0 + dur);
          const ft = b.face ? this._target(b.face, st, id) : b.to && this.actors.has(b.to) ? st.get(b.to)?.pos : null;
          if (ft) { const y2 = yawTo(s.pos, ft); tr.turns.push({ t0: t0 + dur, t1: t0 + dur + 0.5, y0: s.yaw, y1: y2 }); s.yaw = y2; }
        }
      } else {
        const ft = b.face ? this._target(b.face, st, id) : b.to ? this._target(b.to, st, id) : null;
        if (ft && ft.distanceTo(s.pos) > 0.2) {
          const y2 = yawTo(s.pos, ft);
          if (Math.abs(angDiff(s.yaw, y2)) > 0.08) { tr.turns.push({ t0: b.t, t1: b.t + 0.55, y0: s.yaw, y1: y2 }); s.yaw = y2; }
        }
        if (doName && doName !== 'idle') tr.clips.push({ t: b.t, d, clip: doName });
        else if (line && !doName && A.kind === 'human' && d > 1.3) tr.clips.push({ t: b.t, d, clip: (gest++ % 2) ? 'talk_gesture_2' : 'talk_gesture_1', soft: true });
      }
      const ex = b.expr || (line && line.emo && line.emo !== 'neutral' ? line.emo : null);
      if (ex) tr.exprs.push({ t: b.t, d: Math.max(d, 1.2), name: ex });
      if (b.prop) tr.props.push({ t: b.t, id: b.prop });
    }
    for (const tr of this.tracks.values()) {
      tr.clips.sort((a, b) => a.t - b.t);
      tr.turns.sort((a, b) => a.t0 - b.t0);
      tr.segs.sort((a, b) => a.t0 - b.t0);
    }
    this.final = st;
  }

  /** Hedef: spot adı, aktör kimliği (yaklaşma mesafesiyle) ya da [x,y,z]. */
  _target(x, st, self, approach = false) {
    if (Array.isArray(x)) return V(...x);
    if (this.world.spots[x]) return this.spot(x);
    const o = st.get(x);
    if (o && x !== self) {
      if (!approach) return o.pos.clone();
      const me = st.get(self).pos;
      const A = this.actors.get(x);
      const dir = me.clone().sub(o.pos);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      let r = 0.85;
      if (A?.kind === 'animal') {
        // Hayvanın yanına (böğrüne) yaklaş.
        const side = V(Math.cos(st.get(x).yaw), 0, -Math.sin(st.get(x).yaw));
        if (side.dot(dir) < 0) side.negate();
        return o.pos.clone().addScaledVector(side, Math.max(0.7, (A.width || 0.8) * 0.5 + 0.45));
      }
      return o.pos.clone().addScaledVector(dir, r);
    }
    return null;
  }

  // ---------------------------------------------------------------- değerlendirme

  /** t anında aktörün konumu ve yönü. */
  placement(id, t, outPos) {
    const tr = this.tracks.get(id);
    let pos = tr.init.pos, yaw = tr.init.yaw, moving = null;
    for (const s of tr.segs) {
      if (s.t0 > t) break;
      if (t < s.t1) {
        const u = (t - s.t0) / (s.t1 - s.t0);
        const e = u < 0.12 ? (u * u) / 0.24 : u > 0.88 ? 1 - ((1 - u) * (1 - u)) / 0.24 : (u - 0.06) / 0.88; // yumuşak kalkış/duruş
        outPos.copy(s.from).lerp(s.to, Math.min(1, Math.max(0, e)));
        pos = null;
        moving = s;
        break;
      }
      pos = s.to;
    }
    if (pos) outPos.copy(pos);
    for (const r of tr.turns) {
      if (r.t0 > t) break;
      yaw = t >= r.t1 ? r.y1 : r.y0 + angDiff(r.y0, r.y1) * smooth((t - r.t0) / (r.t1 - r.t0));
    }
    return { yaw, moving };
  }

  exprAt(id, t) {
    const tr = this.tracks.get(id);
    let cur = null;
    for (const e of tr.exprs) { if (e.t > t) break; cur = e; }
    const out = {};
    if (!cur) return out;
    const k = smooth((t - cur.t) / 0.35) * (1 - smooth((t - (cur.t + cur.d + 1.6)) / 0.6));
    if (k > 0 && cur.name !== 'neutral') out[cur.name] = k;
    return out;
  }

  propAt(id, t) {
    const tr = this.tracks.get(id);
    let cur = null;
    for (const p of tr.props) { if (p.t > t) break; cur = p; }
    return cur ? cur.id : null;
  }

  lineAt(t) {
    for (const l of this.lines) if (t >= l.t && t < l.t + (l.d || 0)) return l;
    return null;
  }

  /** Aktörün t anındaki klip karışımı (önceki klipten geçişle). */
  clipsAt(id, t, A, sad) {
    const tr = this.tracks.get(id);
    const idle = A.kind === 'animal' ? 'idle' : tr.init.seated ? 'sit_idle' : sad ? 'idle_sad' : 'idle';
    let cur = null, prev = null, prevEnd = this.scene.t0 - 10;
    for (const c of tr.clips) {
      if (c.t > t) break;
      if (cur) { prev = cur; prevEnd = cur.t + cur.d; }
      cur = c;
    }
    const time = (c, at) => {
      const name = A.clipFor(c.clip);
      if (!name) return null;
      if (c.move) {
        const s = c.move;
        const dist = s.from.distanceTo(s.to) * clamp01((Math.min(at, s.t1) - s.t0) / (s.t1 - s.t0));
        const stride = (A.speeds[name] || s.speed) * A.clipDur(name);
        return { clip: name, time: (dist / Math.max(0.05, stride)) * A.clipDur(name) + 0.1, loop: true };
      }
      const once = A.loops && name in A.loops ? !A.loops[name] : ONCE.has(c.clip) || HOLD.has(c.clip);
      return { clip: name, time: at - c.t, loop: !once };
    };
    const idleOf = (from) => ({ clip: A.clipFor(idle), time: t - from + hash(id) * 4, loop: true });
    const out = [];
    if (cur && t < cur.t + cur.d + (HOLD.has(cur.clip) ? 1e9 : 0)) {
      const w = smooth((t - cur.t) / FX);
      const a = time(cur, t);
      const before = prev && cur.t < prev.t + prev.d ? time(prev, t) : idleOf(prevEnd);
      if (before && w < 1) out.push({ ...before, weight: 1 - w });
      if (a) out.push({ ...a, weight: w * (cur.soft ? 1 : 1) });
    } else {
      const from = cur ? cur.t + cur.d : this.scene.t0 - 10;
      const w = smooth((t - from) / FX);
      if (cur && w < 1) { const a = time(cur, Math.min(t, cur.t + cur.d)); if (a) out.push({ ...a, weight: 1 - w }); }
      out.push({ ...idleOf(from), weight: cur ? w : 1 });
    }
    return out.filter((x) => x.clip);
  }

  /** Bir aktörün baktığı yer (konuşan, face hedefi). */
  /** Kararlı bakış hedefi: ham hedef (_gazeRaw) en az GAZE_HOLD sn sürmedikçe baş ona dönmez — kısa replikler ve
   * art arda konuşan değişimleri başları sağa sola savurmaz (eskiden her replikte 40–50°/sn'lik dönüş, dinleyenler
   * zamanının ~%40'ında baş çeviriyordu). Durumsuz: yalnızca t'ye bakar (seek doğru), 0,1 sn ızgarada önbellekli. */
  gazeTarget(id, t, line, depth = 0) {
    const G = 0.1, HOLD = 0.7;
    const raw = (tt) => {
      const M = this._gzM || (this._gzM = new Map());
      const k = id + '|' + Math.round(tt / G);
      if (!M.has(k)) { if (M.size > 20000) M.clear(); M.set(k, this._gazeRaw(id, tt, this.lineAt(tt))); }
      return M.get(k);
    };
    const cur = this._gazeRaw(id, t, line);
    const t0 = this.scene.t0 ?? 0;
    let s0 = Math.floor(t / G) * G;
    while (s0 - G >= t0 && t - s0 < HOLD && raw(s0 - G) === cur) s0 -= G;
    if (t - s0 >= HOLD || s0 - G < t0 || depth > 4) return cur;
    return this.gazeTarget(id, s0 - G, this.lineAt(s0 - G), depth + 1);
  }

  _gazeRaw(id, t, line) {
    if (line && line.who !== id && this.tracks.has(line.who)) return line.who;
    const sc = this.scene;
    let tgt = null;
    for (const b of sc.beats) {
      if (b.t > t) break;
      if (b.who === id && b.face && this.tracks.has(b.face)) tgt = b.face;
    }
    if (line && line.who === id) {
      // Konuşan: muhatabına (son face hedefi, yoksa en yakın insan)
      if (tgt) return tgt;
      let best = null, bd = 1e9;
      for (const o of this.ids) {
        if (o === id) continue;
        const A = this.actors.get(o);
        const d = A.root.position.distanceTo(this.actors.get(id).root.position) + (A.kind === 'animal' ? 3 : 0);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    return tgt;
  }
}

// ------------------------------------------------------------------ yüz / baş

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _va = V(), _vb = V(), _vc = V();

/** Kemiğe dünya uzayında ek dönüş (iskeletin yerel eksenlerinden bağımsız). */
function rotateBoneWorld(bone, qDelta) {
  if (!bone || !bone.parent) return;
  bone.parent.getWorldQuaternion(_qp);
  _qa.copy(_qp).multiply(bone.quaternion);
  _qb.copy(qDelta).multiply(_qa);
  bone.quaternion.copy(_qp.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

/** Bakış (yaw/pitch, aktörün önüne göre), baş sallama / onaylama (klipte yoksa yordamsal).
 * Bakış DURUMLU ve sakindir: hedef açı ölü bölgeli (küçük kaymalar hedefi değiştirmez), baş kritik sönümlü yayla
 * (ω≈3 rad/sn, ≤35°/sn) döner; hedef noktası çağıranın verdiği SABİT göz noktasıdır (karşıdakinin animasyonla oynayan
 * baş kemiği değil) — baş başı izleyip titremez. extra: {yaw, pitch} yumuşak ek (boşta salınım, vurgu, yordamsal jest);
 * dt: film saniyesi, snap: arama/kesme (anında yerleşir). */
const LOOK_DEAD = THREE.MathUtils.degToRad(4);
// 25 Ekim: ω 3→2,4 ve hız sınırı eksen başına değil BİLEŞKE (yaw+pitch) 22°/sn (eskiden eksen başına 35 → ~50°/sn).
const LOOK_W = 2.4, LOOK_VMAX = THREE.MathUtils.degToRad(22);
export function applyHead(A, yaw0, lookAt, extra, weight = 0.75, dt = 0, snap = true) {
  const head = A.bones.head, neck = A.bones.neck;
  if (!head) return;
  A.root.updateMatrixWorld(true);
  let ty = 0, tp = 0;
  if (lookAt) {
    if (A._eyeS) _va.copy(A.root.position).add(A._eyeS); else head.getWorldPosition(_va);
    _vb.copy(lookAt).sub(_va);
    const yaw = Math.atan2(_vb.x, _vb.z);
    const hor = Math.hypot(_vb.x, _vb.z);
    ty = THREE.MathUtils.clamp(angDiff(yaw0, yaw), -1.1, 1.1) * weight;
    tp = THREE.MathUtils.clamp(-Math.atan2(_vb.y, hor), -0.45, 0.5) * weight;
  }
  const H = A._look || (A._look = { y: ty, p: tp, vy: 0, vp: 0, hy: ty, hp: tp });
  // Ölü bölge: hedef ancak belirgin değişince (>4°) güncellenir.
  if (snap || Math.abs(ty - H.hy) > LOOK_DEAD || Math.abs(tp - H.hp) > LOOK_DEAD || (!lookAt && (H.hy || H.hp))) { H.hy = ty; H.hp = tp; }
  if (snap || !(dt > 0)) { H.y = H.hy; H.p = H.hp; H.vy = H.vp = 0; }
  else {
    const h = Math.min(dt, 0.1);
    let vy = H.vy + (-2 * LOOK_W * H.vy - LOOK_W * LOOK_W * (H.y - H.hy)) * h;
    let vp = H.vp + (-2 * LOOK_W * H.vp - LOOK_W * LOOK_W * (H.p - H.hp)) * h;
    const sp = Math.hypot(vy, vp);
    if (sp > LOOK_VMAX) { vy *= LOOK_VMAX / sp; vp *= LOOK_VMAX / sp; }
    H.vy = vy; H.vp = vp;
    H.y += vy * h; H.p += vp * h;
  }
  const dy = H.y + (extra.yaw || 0);
  const dp = H.p + (extra.pitch || 0);
  if (Math.abs(dy) < 1e-4 && Math.abs(dp) < 1e-4) return;
  const right = V(Math.cos(yaw0), 0, -Math.sin(yaw0)); // aktörün sağ ekseni (bakış +Z)
  const split = neck ? [[neck, 0.4], [head, 0.6]] : [[head, 1]];
  for (const [b, k] of split) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, dy * k).multiply(new THREE.Quaternion().setFromAxisAngle(right, dp * k));
    rotateBoneWorld(b, q);
  }
  for (const e of A.bones.eyes) rotateBoneWorld(e, new THREE.Quaternion().setFromAxisAngle(UP, dy * 0.3));
}

/** Boşta baş salınımı: ≤ ~1,5° genlik, 0,08–0,22 Hz (nefes ritminde, kişiye göre evreli). */
export function idleSway(id, t) {
  const h = hash(id), D = Math.PI / 180;
  const yaw = D * (1.1 * Math.sin(2 * Math.PI * (0.09 + h * 0.04) * t + h * 17) + 0.4 * Math.sin(2 * Math.PI * 0.21 * t + h * 5));
  const pitch = D * (0.8 * Math.sin(2 * Math.PI * (0.13 + h * 0.05) * t + h * 11));
  return { yaw, pitch };
}

export function blinkAt(id, t) {
  const h = hash(id);
  const period = 3.2 + h * 1.8;
  const k = (t + h * 10) % period;
  const b = k < 0.16 ? 1 - Math.abs(k - 0.08) / 0.08 : 0;
  return b;
}

export { visemeWeightsAt };

// ------------------------------------------------------------------ kamera

// Gerçek lens odak uzaklıkları (35 mm tam kare, yatay 36 mm): geniş açıdan portre lensine.
const LENS = { establishing: 24, wide: 32, two_shot: 40, medium: 50, over_shoulder: 65, ots: 65, close: 85, insert: 100, pov: 35 };
/** Odak uzaklığından düşey görüş açısı (derece), görüntü oranına göre. */
function lensFov(mm, aspect) {
  const h = 2 * Math.atan(18 / mm);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / Math.max(0.5, aspect)));
}

const CAM_VMAX = 0.3; // m/sn (kaydırma)
const CAM_WMAX = THREE.MathUtils.degToRad(10); // rad/sn (çevirme)
const CAM_W = 1.8; // takip yayı (rad/sn)

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.focus = 3;
    this.closeup = false;
    this.shotKey = '';
  }

  anchor(A, part = 'head') {
    const p = A.root.position.clone();
    if (A.kind === 'animal') {
      const y = A.eyeH || 1.6;
      if (part === 'head') { const f = V(Math.sin(A.root.rotation.y), 0, Math.cos(A.root.rotation.y)); return p.addScaledVector(f, A.headZ || 1).setY(p.y + y * 0.95); }
      return p.setY(p.y + y * 0.7);
    }
    const k = part === 'head' ? 1 : part === 'chest' ? 0.8 : part === 'hands' ? 0.58 : 0.55;
    // Başın gerçek yeri (oturma, diz çökme, eğilme…): kemikten, yumuşatılarak; yoksa sabit göz yüksekliği.
    const hb = A.bones?.head;
    if (A._eyeS) {
      // Oynatıcının karede bir kez güncellediği, zamanda süzülmüş göz noktası (kökten): baş kemiğinin anlık sallantısı
      // kadraja geçmez.
      if (part === 'head') return p.add(A._eyeS);
      p.y += A._eyeS.y * k;
      if (part === 'hands') p.addScaledVector(V(Math.sin(A.root.rotation.y), 0, Math.cos(A.root.rotation.y)), 0.28);
      return p;
    }
    if (hb) {
      // "head" = GÖZ hizası (göz kemikleri varsa onların ortası): kadraj gözlere göre kurulur.
      const E = A.bones.eyes;
      if (E && E.length) {
        _va.set(0, 0, 0);
        for (const e of E) _va.add(e.getWorldPosition(_vc));
        _va.multiplyScalar(1 / E.length);
        _vb.copy(_va).sub(A.root.position);
      } else {
        hb.getWorldPosition(_va);
        _vb.copy(_va).sub(A.root.position);
        _vb.y += 0.07;
      }
      if (!A._hs || this.snap || A._hs.distanceTo(_vb) > 0.6) A._hs = _vb.clone(); else A._hs.lerp(_vb, 0.18);
      if (part === 'head') return p.add(A._hs);
      p.y += A._hs.y * k;
      if (part === 'hands') p.addScaledVector(V(Math.sin(A.root.rotation.y), 0, Math.cos(A.root.rotation.y)), 0.28);
      return p;
    }
    p.y += A.eyeH * k;
    if (part === 'hands') p.addScaledVector(V(Math.sin(A.root.rotation.y), 0, Math.cos(A.root.rotation.y)), 0.28);
    return p;
  }

  /** Kamera ile bakış noktası arasında başka oyuncu ya da sahne duvarı varsa: kamerayı bakış noktası çevresinde döndürerek
   * açık bir açı arar (çekim başına ve 0,6 sn'de bir), bulamazsa engelin önüne çeker. */
  _clear(plan, world, pos, look, ids, key, t) {
    // Çekim başında tam arama; çekim içinde 1 sn'de bir yalnızca seçili açının hâlâ açık olup olmadığına bakılır (açı
    // gereksiz yere değişip kamera yeniden kadraj aramaz — histerezis).
    const fresh = this._occKey !== key;
    if (!fresh && Math.abs(t - this._occT) > 1.0) {
      this._occT = t;
      const off = pos.clone().sub(look).applyAxisAngle(UP, this._occAng || 0).multiplyScalar(this._occPull || 1);
      if (this._blocked(plan, world, look, look.clone().add(off), ids)) this._occKey = null;
    }
    if (this._occKey !== key) {
      this._occKey = key;
      this._occT = t;
      this._occAng = 0;
      this._occPull = 1;
      const off = pos.clone().sub(look);
      const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1];
      let found = false, firstHit = null;
      for (const a of tries) {
        const c = look.clone().add(off.clone().applyAxisAngle(UP, a));
        const hit = this._blocked(plan, world, look, c, ids);
        if (!hit) { this._occAng = a; found = true; break; }
        if (a === 0 && hit.env) firstHit = hit.d;
      }
      if (!found && firstHit) this._occPull = Math.max(0.25, (firstHit - 0.25) / off.length());
    }
    if (this._occAng || this._occPull !== 1) {
      const off = pos.clone().sub(look).applyAxisAngle(UP, this._occAng).multiplyScalar(this._occPull);
      pos.copy(look).add(off);
    }
  }

  /** Engel ({d, env}) ya da null. Oyuncu engelinde kamera öne çekilmez (özneye yapışır), yalnızca açı değişir. */
  _blocked(plan, world, a, b, ids) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 0.05) return 0;
    const dir = d.clone().multiplyScalar(1 / len);
    // Oyuncular: dikey eksene en yakın geçiş
    for (const id of plan.ids) {
      if (ids.includes(id)) continue;
      const X = plan.actors.get(id);
      const p = X.root.position;
      const r = X.kind === 'animal' ? Math.max(0.5, (X.length || 1.6) * 0.45) : 0.48; // kollar dahil
      const h = X.kind === 'animal' ? (X.height || 1.6) : X.eyeH + 0.2;
      // XZ düzleminde en yakın nokta
      const dx = dir.x, dz = dir.z, hx = Math.hypot(dx, dz);
      let s = hx > 1e-4 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / (hx * hx) : 0;
      s = Math.min(len, Math.max(0, s));
      const q = a.clone().addScaledVector(dir, s);
      if (Math.hypot(q.x - p.x, q.z - p.z) < r && q.y > p.y && q.y < p.y + h && s > 0.2) return { d: s, env: false };
    }
    // Sahne: duvar, ağaç, ev (zemin sayılmaz)
    if (world.group) {
      this._ray = this._ray || new THREE.Raycaster();
      this._ray.set(a, dir);
      this._ray.far = len;
      const hits = this._ray.intersectObject(world.group, true);
      for (const h of hits) {
        if (h.distance < 0.25) continue;
        if (h.face && Math.abs(h.face.normal.y) > 0.8 && h.point.y < 0.5) continue;
        if (h.object.isPoints || h.object.isSprite) continue;
        return { d: h.distance, env: true };
      }
      // Ön plan kalabalığı: kameranın hemen önünde kadrajın bir bölümünü kapatan ağaç/duvar (merkez ışını değmese de).
      const right = V(dir.z, 0, -dir.x).normalize();
      const half = len * 0.42; // kadrajın yatay yarı genişliğine yakın
      for (const [sx, sy] of [[0.9, 0], [-0.9, 0], [0, 0.7], [0, -0.8], [0.8, -0.7], [-0.8, -0.7], [0.8, 0.6], [-0.8, 0.6], [0.45, -0.4], [-0.45, -0.4]]) {
        const tgt = a.clone().addScaledVector(right, sx * half).addScaledVector(UP, sy * half * 0.5);
        const d2 = b.clone().sub(tgt);
        const l2 = d2.length();
        this._ray.set(b, d2.multiplyScalar(-1 / l2));
        this._ray.far = Math.min(12, l2 * 0.7);
        for (const h of this._ray.intersectObject(world.group, true)) {
          if (h.object.isPoints || h.object.isSprite) continue;
          if (h.face && Math.abs(h.face.normal.y) > 0.8 && h.point.y < 0.5) continue;
          return { d: Math.max(0.5, len - h.distance - 0.4), env: true, clutter: true };
        }
      }
    }
    return null;
  }

  /** Bu sahnenin bu anındaki çekim (film çekimi ya da otomatik). */
  shotAt(plan, t) {
    const cur = this._explicitAt(plan, t);
    if (cur) return cur;
    // Otomatik: sahne başına bir kez planlanır (en kısa çekim ~3 sn; kısa replikler birleşir).
    const A = this._autoPlan(plan);
    for (let i = A.length - 1; i >= 0; i--) if (t >= A[i].t) return A[i];
    return A[0] || this._rawAuto(plan, t);
  }

  _explicitAt(plan, t) {
    let cur = null;
    for (const s of this._explicit(plan)) { if (s.t > t) break; if (t < s.t + (s.d || 0)) cur = s; }
    return cur && cur.type !== 'auto' ? cur : null;
  }

  /** Senaryonun çekimleri, kurgu temizliğiyle (sahne başına bir kez): art arda aynı plan (tür + hedef + hareket) tek
   * çekim olur (aynı kadraja "kesme" yok); bitişik komşusu olan 2,5 sn'den kısa çekim komşusuna katılır (kısa replik
   * başına bir kesme yok). Komşusuz kısa çekimler olduğu gibi kalır. */
  _explicit(plan) {
    if (plan._explShots) return plan._explShots;
    const MIN = 2.5, GAP = 0.08;
    const WIDTH = (ty) => ({ establishing: 6, wide: 5, two_shot: 4, two: 4, medium: 3, ots: 2, close: 1, insert: 0 })[ty] ?? 3;
    const L = plan.scene.shots.map((x) => ({ ...x })).sort((a, b) => a.t - b.t);
    const end = (x) => x.t + (x.d || 0);
    const same = (a, b) => a.type === b.type && [].concat(a.target).join(',') === [].concat(b.target).join(',') && (a.move || 'static') === (b.move || 'static');
    const adj = (a, b) => a && b && a.type !== 'auto' && b.type !== 'auto' && b.t - end(a) < GAP && b.t >= a.t;
    for (let i = 0; i + 1 < L.length; ) {
      if (adj(L[i], L[i + 1]) && same(L[i], L[i + 1])) { L[i].d = Math.max(end(L[i]), end(L[i + 1])) - L[i].t; L.splice(i + 1, 1); } else i++;
    }
    for (let guard = 0; guard < 500; guard++) {
      let k = -1, best = MIN;
      for (let i = 0; i < L.length; i++) {
        if (L[i].type === 'auto' || !((L[i].d || 0) < best)) continue;
        if (adj(L[i - 1], L[i]) || adj(L[i], L[i + 1])) { best = L[i].d || 0; k = i; }
      }
      if (k < 0) break;
      const pv = adj(L[k - 1], L[k]) ? L[k - 1] : null, nx = adj(L[k], L[k + 1]) ? L[k + 1] : null;
      const keep = pv && (!nx || (pv.d || 0) <= (nx.d || 0)) ? pv : nx;
      // Birleşen çekim ikisinden GENİŞ olanın kadrajını alır (yürüyüş/eylem kadrajda kalsın, kamera koşmasın).
      if (WIDTH(L[k].type) > WIDTH(keep.type)) { keep.type = L[k].type; keep.target = L[k].target; keep.move = L[k].move; }
      if (keep === pv) pv.d = end(L[k]) - pv.t;
      else { nx.d = end(nx) - L[k].t; nx.t = L[k].t; }
      L.splice(k, 1);
    }
    plan._explShots = L;
    return L;
  }

  /** Senaryonun çekim vermediği aralıklar için otomatik çekim dizisi: 0,1 sn adımla ham öneriler, aynı öneriler tek çekim;
   * MIN_SHOT'tan kısa çekimler komşusuyla birleşir (iki farklı konuşan → sabit iki kişilik plan). Diyalog sabit çekimle. */
  _autoPlan(plan) {
    if (plan._autoShots) return plan._autoShots;
    const MIN_SHOT = 3;
    const sc = plan.scene, segs = [];
    let gap = 0, prevExplicit = true;
    for (let t = sc.t0; t < sc.t1; t += 0.1) {
      if (this._explicitAt(plan, t)) { prevExplicit = true; continue; }
      if (prevExplicit) { gap++; prevExplicit = false; }
      const r = this._rawAuto(plan, t);
      const key = `${r.type}|${[].concat(r.target).join(',')}|${r.t}`;
      const last = segs[segs.length - 1];
      if (last && last.gap === gap && last.key === key) last.t1 = t + 0.1;
      else segs.push({ gap, key, t0: t, t1: t + 0.1, shot: r });
    }
    const merge = (a, b) => {
      const L = a.t1 - a.t0 >= b.t1 - b.t0 ? a : b;
      const ta = [].concat(a.shot.target)[0], tb = [].concat(b.shot.target)[0];
      let shot = { ...L.shot };
      const dlg = (x) => x.shot.type === 'close' || x.shot.type === 'ots';
      if (dlg(a) && dlg(b) && ta !== tb) shot = { type: 'two_shot', target: [ta, tb], move: 'static' };
      else if (a.shot.type === 'wide' || b.shot.type === 'wide') shot = { type: 'wide', target: [...new Set([...[].concat(a.shot.target), ...[].concat(b.shot.target)])], move: 'static' };
      return { gap: a.gap, key: a.key + '+' + b.key, t0: a.t0, t1: b.t1, shot };
    };
    for (let guard = 0; guard < 400; guard++) {
      let k = -1, best = MIN_SHOT;
      for (let i = 0; i < segs.length; i++) {
        const d = segs[i].t1 - segs[i].t0;
        const hasN = (segs[i - 1] && segs[i - 1].gap === segs[i].gap) || (segs[i + 1] && segs[i + 1].gap === segs[i].gap);
        if (d < best && hasN) { best = d; k = i; }
      }
      if (k < 0) break;
      const pv = segs[k - 1] && segs[k - 1].gap === segs[k].gap ? segs[k - 1] : null;
      const nx = segs[k + 1] && segs[k + 1].gap === segs[k].gap ? segs[k + 1] : null;
      if (pv && (!nx || pv.t1 - pv.t0 <= nx.t1 - nx.t0)) segs.splice(k - 1, 2, merge(pv, segs[k]));
      else segs.splice(k, 2, merge(segs[k], nx));
    }
    plan._autoShots = segs.map((g) => ({ ...g.shot, t: +g.t0.toFixed(2), d: +(g.t1 - g.t0).toFixed(2), _auto: true }));
    return plan._autoShots;
  }

  _rawAuto(plan, t) {
    const line = plan.lineAt(t);
    if (line && plan.tracks.has(line.who)) {
      const idx = plan.lines.indexOf(line);
      const listener = plan.gazeTarget(line.who, t, line);
      const ots = listener && (line.d || 0) > 2.6 && idx % 3 === 2;
      return { t: line.t, d: line.d, type: ots ? 'ots' : 'close', target: listener ? [line.who, listener] : line.who, move: 'static', _auto: true };
    }
    for (const id of plan.ids) {
      const tr = plan.tracks.get(id);
      const s = tr.segs.find((x) => t >= x.t0 && t < x.t1);
      if (s) return { t: s.t0, d: s.t1 - s.t0, type: 'medium', target: id, move: 'track', _auto: true };
    }
    const humans = plan.ids.filter((id) => plan.actors.get(id).kind === 'human');
    const t0 = plan.scene.t0;
    const k = Math.floor((t - t0) / 8);
    return { t: t0 + k * 8, d: 8, type: humans.length === 2 && k % 2 ? 'two_shot' : 'wide', target: plan.ids, move: k % 2 ? 'static' : 'dolly_in', _auto: true };
  }

  /** Kamerayı t anına göre yerleştirir. Dönen: {key, closeup, focus}. */
  update(plan, t, world, cut) {
    const shot = this.shotAt(plan, t);
    const cam = this.camera;
    const ids = (Array.isArray(shot.target) ? shot.target : [shot.target]).filter((x) => plan.tracks.has(x));
    if (!ids.length) ids.push(...plan.ids);
    const A = plan.actors.get(ids[0]);
    const B = ids[1] ? plan.actors.get(ids[1]) : null;
    const p = clamp01((t - shot.t) / Math.max(0.5, shot.d || 4));
    const e = p * p * (3 - 2 * p) * 0.6 + p * 0.4;
    let type = shot.type || 'wide';
    if (type === 'over_shoulder') type = 'ots';
    if (type === 'two' || type === 'twoshot' || type === 'two-shot') type = 'two_shot'; // senaryo adı: "two"
    // Omuz üstü, dinleyen konuşandan çok uzunsa (yetişkin–çocuk) dinleyenin gövdesi kadrajı kaplar: karşı açıdan yakın plan.
    if (type === 'ots' && B && A.kind === 'human' && B.kind === 'human' && Math.abs(B.eyeH - A.eyeH) > 0.25) type = 'close';
    const side = world.side.clone();
    let pos = V(), look = V(), fov = lensFov(LENS[type] || 35, cam.aspect);
    const frameDist = (H) => (H / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2); // kadraj yüksekliği H (m) için uzaklık
    const sOf = (X) => (X && X.kind === 'human' ? THREE.MathUtils.clamp(X.eyeH / 1.6, 0.6, 1.2) : 1);
    // 180° kuralı: konuşma ekseninin hep aynı (sahnenin kamera tarafı) yanı.
    const axisSide = (P, Q) => {
      const ax = Q.clone().sub(P); ax.y = 0;
      if (ax.lengthSq() < 1e-4) return side.clone();
      ax.normalize();
      const n = V(ax.z, 0, -ax.x);
      if (n.dot(side) < 0) n.negate();
      return n;
    };
    const groupFit = (list, padK = 1) => {
      const box = new THREE.Box3();
      for (const id of list) { const X = plan.actors.get(id); box.expandByPoint(X.root.position); box.expandByPoint(this.anchor(X, 'head').add(V(0, 0.15, 0))); }
      const c = box.getCenter(V());
      const r = Math.max(1.1, box.getSize(V()).length() * 0.5) * padK;
      return { c, r };
    };
    const hfov = (f) => 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(f) / 2) * Math.max(0.5, cam.aspect));
    const fitDist = (r, f) => r / Math.sin(Math.min(hfov(f), THREE.MathUtils.degToRad(f)) / 2);
    const facing = (X) => V(Math.sin(X.root.rotation.y), 0, Math.cos(X.root.rotation.y));
    switch (type) {
      case 'close':
      case 'insert': {
        // Yakın plan: kamera GÖZ hizasında (aşağıdan bakmaz), gözler kadrajın üst üçte birinde, başın üstünde boşluk; özne
        // baktığı yönün tersindeki üçte birde (bakış payı).
        const s = sOf(A);
        const eye = this.anchor(A, type === 'insert' ? 'hands' : 'head');
        let dir, gaze = null;
        const gid = plan.gazeTarget(ids[0], t, plan.lineAt(t));
        const other = B || (gid ? plan.actors.get(gid) : null);
        if (other && other !== A) {
          const toO = other.root.position.clone().sub(A.root.position).setY(0).normalize();
          const n = axisSide(A.root.position, other.root.position);
          dir = toO.clone().multiplyScalar(Math.cos(0.62)).addScaledVector(n, Math.sin(0.62)).normalize();
          gaze = toO;
        } else {
          dir = facing(A).addScaledVector(side, 0.45).setY(0).normalize();
        }
        const H = (type === 'insert' ? 0.34 : 0.5) * s * (A.kind === 'animal' ? 2.4 : 1);
        const dist = frameDist(H);
        pos.copy(eye).addScaledVector(dir, dist);
        if (type === 'insert') pos.y += 0.3;
        look.copy(eye);
        if (type === 'close') {
          pos.y = eye.y + 0.01;
          look.y = eye.y - H / 6;
          if (gaze) {
            const r = V(-dir.z, 0, dir.x); // kameranın sağı (kameradan özneye bakarken)
            look.addScaledVector(r, Math.sign(gaze.dot(r)) * (H * cam.aspect) / 6);
          }
        }
        this.focus = dist;
        break;
      }
      case 'medium': {
        // Orta plan (bel üstü): kamera göz ile göğüs arası yükseklikte, gözler üst üçte birde.
        const s = sOf(A);
        const eye = this.anchor(A, 'head');
        let dir = facing(A).addScaledVector(side, 0.6).setY(0).normalize();
        if (B) dir = axisSide(A.root.position, B.root.position).addScaledVector(facing(A), 0.5).normalize();
        const H = (A.kind === 'animal' ? 1.9 : 1.0) * s;
        const dist = frameDist(H);
        pos.copy(eye).addScaledVector(dir, dist);
        pos.y = eye.y - 0.08 * s;
        look.copy(eye);
        look.y = eye.y - H / 6;
        if (B) {
          const toB = B.root.position.clone().sub(A.root.position).setY(0).normalize();
          const r = V(-dir.z, 0, dir.x);
          look.addScaledVector(r, Math.sign(toB.dot(r)) * (H * cam.aspect) / 7);
        }
        this.focus = dist;
        break;
      }
      case 'two_shot': {
        const P = A.root.position, Q = (B || plan.actors.get(plan.ids.find((x) => x !== ids[0]) || ids[0])).root.position;
        const n = axisSide(P, Q);
        const c = P.clone().add(Q).multiplyScalar(0.5);
        const h = (this.anchor(A, 'chest').y + (B ? this.anchor(B, 'chest').y : this.anchor(A, 'chest').y)) / 2;
        const dist = fitDist(P.distanceTo(Q) * 0.5 + 0.7, fov) * 0.9;
        pos.copy(c).addScaledVector(n, dist).setY(h + 0.1);
        look.copy(c).setY(h);
        this.focus = dist;
        break;
      }
      case 'ots': {
        // Omuz üstü: kamera dinleyenin omzunun arkasında ve yanında (ön plan omzu kadrajın en çok ~%30'u), yükseklik iki göz
        // hizası arasında (çocuk dinleyende kamera yetişkine aşağıdan bakmaz); konuşan karşı üçte birde, gözleri üst üçte birde.
        const L = B || plan.actors.get(plan.gazeTarget(ids[0], t, plan.lineAt(t)) || '') || null;
        const eye = this.anchor(A, 'head');
        if (!L || L === A) { pos.copy(eye).addScaledVector(facing(A), 1.2); look.copy(eye); this.focus = 1.2; break; }
        const le = this.anchor(L, 'head');
        const ax = eye.clone().sub(le).setY(0).normalize();
        const n = axisSide(le, eye);
        pos.copy(le).addScaledVector(ax, -1.15).addScaledVector(n, 0.62);
        pos.y = Math.max(le.y + 0.02, eye.y - 0.06);
        const H = 0.62 * sOf(A);
        look.copy(eye);
        look.y = eye.y - H / 6;
        look.addScaledVector(n, -0.12);
        // Ön plan omzu kadrajın kenarında, en çok ~%22 alan: omuz noktası ekranın dış %20'lik şeridine itilir.
        {
          const sh = le.clone().addScaledVector(V(0, -1, 0), 0.22 * sOf(L)).addScaledVector(n, 0.16);
          const f = look.clone().sub(pos).normalize();
          const r = V().crossVectors(f, UP).normalize();
          const hf = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * cam.aspect;
          for (let it = 0; it < 6; it++) {
            const q = sh.clone().sub(pos);
            const x = q.dot(r) / Math.max(1e-3, q.dot(f)) / hf; // -1..1 yatay
            if (Math.abs(x) >= 0.78) break;
            const sgn = Math.sign(x) || 1;
            look.addScaledVector(r, -sgn * 0.08 * pos.distanceTo(look));
            f.copy(look).sub(pos).normalize();
            r.crossVectors(f, UP).normalize();
          }
        }
        this.focus = pos.distanceTo(eye);
        break;
      }
      case 'pov': {
        const head = this.anchor(A, 'head');
        pos.copy(head).addScaledVector(facing(A), 0.12);
        look.copy(B ? this.anchor(B, 'head') : head.clone().addScaledVector(facing(A), 5));
        this.focus = pos.distanceTo(look);
        break;
      }
      case 'establishing': {
        // Sahne kitinin tasarlanmış kuruluş açısı (B: camera/look) varsa o — ağaçların ardında kalmaz.
        if (world.it?.camera && world.it?.look && !world.interior) {
          pos.fromArray(world.it.camera);
          look.fromArray(world.it.look);
          this.focus = pos.distanceTo(look);
          break;
        }
        const { c, r } = groupFit(plan.ids.length ? plan.ids : ids, 1.4);
        const R = Math.max(world.radius * 0.9, fitDist(r, fov));
        pos.copy(c).addScaledVector(side, R * 0.85).setY(Math.max(6.5, R * 0.55));
        look.copy(c).setY(1.0);
        this.focus = R;
        break;
      }
      default: { // wide
        const { c, r } = groupFit(ids, 1.15);
        const dist = Math.max(3.2, fitDist(r, fov));
        let dir = side.clone();
        if (ids.length >= 2) {
          const P = plan.actors.get(ids[0]).root.position, Q = plan.actors.get(ids[1]).root.position;
          dir = axisSide(P, Q).addScaledVector(side, 0.6).normalize();
        }
        pos.copy(c).addScaledVector(dir, dist).setY(c.y + 0.9 + dist * 0.12);
        look.copy(c).setY(c.y + 0.1);
        this.focus = dist;
      }
    }
    // Yakın / orta / omuz üstü: kameranın özneye göre yönü (kerteriz) çekim başında kilitlenir, en çok 8°/sn kayar —
    // özne dönünce ya da yürürken yön değiştirince kamera onun çevresinde savrulmaz.
    if (type === 'medium' || type === 'close' || type === 'insert' || type === 'ots') {
      const bk = `${plan.scene._i}:${shot.t}:${type}`;
      const o = pos.clone().sub(look);
      const th = Math.atan2(o.x, o.z);
      if (this._bKey !== bk || this.snap || this._bTh == null) { this._bKey = bk; this._bTh = th; this._bT = t; }
      else {
        const step = THREE.MathUtils.degToRad(8) * Math.max(0, t - this._bT);
        this._bT = t;
        this._bTh += THREE.MathUtils.clamp(angDiff(this._bTh, th), -step, step);
        pos.copy(look).add(o.applyAxisAngle(UP, angDiff(th, this._bTh)));
      }
    }
    // Geniş / kuruluş / iki kişilik planlarda kamera ayağı çekim başındaki yerinde durur (özne yürüse de kamera onunla
    // birlikte kaymaz, yalnızca yavaşça çevrilir); kadraj gerekirse en çok 0,2 m/sn sürüklenir.
    if (type === 'wide' || type === 'establishing' || type === 'two_shot') {
      const wk = `${plan.scene._i}:${shot.t}:${type}`;
      if (this._wKey !== wk || this.snap || !this._wPos) { this._wKey = wk; this._wPos = pos.clone(); this._wT = t; }
      else {
        const dd = pos.clone().sub(this._wPos);
        const lim = 0.2 * Math.max(0, t - this._wT);
        if (dd.length() > lim) dd.setLength(lim);
        pos.copy(this._wPos).add(dd);
      }
    }
    // Hareketler — sinema hızında: kaydırma (dolly/crane/track) ≤ 0,3 m/sn, çevirme (pan/orbit) ≤ 10°/sn. Genlik çekim
    // süresine göre kısılır (yumuşatılmış eğrinin tepe hızı ortalamanın ~1,3 katı); kısa çekimde hareket küçülür.
    const mv = shot.move || 'static';
    const off = pos.clone().sub(look);
    const seed = hash(String(shot.t));
    const yawRot = (ang) => off.applyAxisAngle(UP, ang);
    const D = Math.max(0.5, shot.d || 4), PEAK = 1.3;
    const maxLin = (CAM_VMAX * D) / PEAK, maxAng = (CAM_WMAX * D) / PEAK;
    const R = Math.max(0.3, off.length());
    switch (mv) {
      case 'dolly_in': { const a = Math.min(0.3, maxLin / R); off.multiplyScalar(1 + 0.73 * a - a * e); break; }
      case 'dolly_out': { const a = Math.min(0.3, maxLin / R); off.multiplyScalar(1 - 0.27 * a + a * e); break; }
      case 'orbit': { const a = Math.min(0.44, maxAng, maxLin / Math.max(0.3, Math.hypot(off.x, off.z))); yawRot((seed > 0.5 ? 1 : -1) * (-a / 2 + a * e)); break; }
      case 'crane': { const a = Math.min(2.2, maxLin); off.y += a * (1 - e) - 0.2 * (a / 2.2); break; }
      case 'pan':
      case 'pan_r':
      case 'pan_l': {
        const dir = mv === 'pan_l' ? -1 : 1;
        const right = V(off.z, 0, -off.x).normalize();
        const W = Math.min(1.6, R * 0.18, maxAng * R, maxLin);
        look.addScaledVector(right, dir * (-0.5 + e) * W);
        break;
      }
      case 'track': {
        const right = V(off.z, 0, -off.x).normalize();
        const W = Math.min(0.5, maxLin);
        pos.addScaledVector(right, (-0.5 + e) * W);
        break;
      }
      default: break;
    }
    if (mv !== 'track') pos.copy(look).add(off);
    // El kamerası ya da durağanda hafif nefes (yavaş, milimetrik).
    const hk = mv === 'handheld' ? 0.5 : 0.1;
    const tt = t * 0.6;
    pos.x += hk * 0.018 * (Math.sin(tt * 1.3 + seed * 9) + 0.5 * Math.sin(tt * 2.7));
    pos.y += hk * 0.012 * Math.sin(tt * 1.7 + seed * 5);
    look.x += hk * 0.01 * Math.sin(tt * 0.9 + 2);
    // İç mekânda sınır
    if (world.interior && world.radius) {
      const c = world.center;
      const d = V(pos.x - c.x, 0, pos.z - c.z);
      if (d.length() > world.radius) { d.setLength(world.radius); pos.x = c.x + d.x; pos.z = c.z + d.z; }
      pos.y = Math.min(pos.y, (world.ceiling || 3) - 0.25);
    }
    pos.y = Math.max(0.25, pos.y);
    this._clear(plan, world, pos, look, type === 'ots' || type === 'wide' || type === 'establishing' || type === 'two_shot' ? plan.ids : ids.slice(0, 1), `${plan.scene._i}:${shot.t}:${type}`, t);
    if (world.interior && world.radius) {
      const c = world.center;
      const d = V(pos.x - c.x, 0, pos.z - c.z);
      if (d.length() > world.radius) { d.setLength(world.radius); pos.x = c.x + d.x; pos.z = c.z + d.z; }
    }
    const key = `${plan.scene._i}:${shot.t}:${type}:${ids.join(',')}`;
    const changed = key !== this.shotKey;
    // Ağır takip: aynı çekim içinde kamera ve bakış noktası kritik sönümlü yayla (ω≈1,8 rad/sn) izler; hız sınırı
    // 0,3 m/sn + öznenin kendi hızı, bakış yönü dönüşü ≤ 10°/sn + öznenin açısal hızı (savrulma yok). Kesmede, aramada ve
    // duraklatmada anında yerleşir. dt film saatinden (kare hızından bağımsız).
    const dt = this._t == null ? 0 : t - this._t;
    this._t = t;
    let vSub = 0;
    for (const id of ids) {
      const X = plan.actors.get(id), P0 = X.root.position;
      if (X._camP && dt > 0) vSub = Math.max(vSub, Math.hypot(P0.x - X._camP.x, P0.z - X._camP.z) / dt);
      (X._camP || (X._camP = V())).copy(P0);
    }
    this._vSub = this._vSub == null ? vSub : this._vSub + (vSub - this._vSub) * Math.min(1, dt * 3);
    if (!changed && !this.snap && this._pos && dt > 0 && dt < 0.25) {
      const fixedLeg = type === 'wide' || type === 'establishing' || type === 'two_shot';
      const vcap = CAM_VMAX + (fixedLeg ? 0 : this._vSub * 1.1); // geniş planda ayak sabit: özne hızı eklenmez
      const spring = (cur, vel, tgt) => {
        const a = tgt.clone().sub(cur).multiplyScalar(CAM_W * CAM_W).addScaledVector(vel, -2 * CAM_W);
        vel.addScaledVector(a, dt);
        if (vel.length() > vcap) vel.setLength(vcap);
        cur.addScaledVector(vel, dt);
      };
      const d0 = this._look.clone().sub(this._pos).normalize();
      spring(this._pos, this._vp, pos);
      spring(this._look, this._vl, look);
      // Bakış yönü açısal sınırı
      const d1 = this._look.clone().sub(this._pos);
      const L1 = d1.length();
      d1.multiplyScalar(1 / Math.max(1e-4, L1));
      const wcap = (CAM_WMAX + this._vSub / Math.max(0.8, L1)) * dt;
      const ang = Math.acos(THREE.MathUtils.clamp(d0.dot(d1), -1, 1));
      if (ang > wcap) {
        const q = new THREE.Quaternion().setFromUnitVectors(d0, d1);
        const qs = new THREE.Quaternion().slerp(q, wcap / ang);
        this._look.copy(this._pos).addScaledVector(d0.applyQuaternion(qs), L1);
      }
    } else {
      this._pos = pos.clone();
      this._look = look.clone();
      this._vp = V();
      this._vl = V();
    }
    cam.position.copy(this._pos);
    cam.lookAt(this._look);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.shotKey = key;
    this.closeup = type === 'close' || type === 'ots' || type === 'insert';
    this.dofScale = type === 'ots' ? 0.4 : type === 'insert' ? 0.8 : 1; // omuz üstünde hafif alan derinliği
    this.primary = A;
    // Portre ışığı: konuşanın (yoksa öznenin) gözü; plan sıkılaştıkça güçlenir.
    const line = plan.lineAt(t);
    const subj = line && plan.tracks.has(line.who) && ids.includes(line.who) ? plan.actors.get(line.who) : A;
    this.subjectEye = subj && subj.kind === 'human' ? this.anchor(subj, 'head') : null;
    this.portraitW = { close: 1, ots: 1, insert: 0.6, medium: 0.8, two_shot: 0.55, pov: 0.4, wide: 0.25, establishing: 0 }[type] ?? 0.3;
    return { key, changed, shot, type };
  }
}
