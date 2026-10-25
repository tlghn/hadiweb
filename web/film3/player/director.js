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

/**
 * Etkileşimli eylemler (26 Ekim, kurucu: "atı tımar ediyor ama önünde at yok"). Hedefi olan her eylem SAHNELENİR: hedef
 * (insan/hayvan) sahnede bulunur (yoksa kadrodan getirilir), oyuncu hedefin doğru yerine yürür (tımar: böğür, yem: baş önü,
 * tokat: hayvanda sağrı / insanda yüz, sarılma: 0,4 m karşı), ona döner, gereken eşya elindedir, eli hedefe uzanır (kol IK),
 * hedef tepki verir (at kıpırdamadan durur ve başını çevirir, tokat yiyen başını eğer, alan elini uzatır), kamera ikisini birlikte
 * çeker (ikili plan; tımar/yemlemede ellere yakın plan).
 *   tk: hedef türü (animal | human | any); zone: hayvanda yer (flank | rump | head); gap: hayvan yüzeyinden uzaklık (m);
 *   hgap: insanla göğüs–göğüs uzaklığı; reach: el hedefi (stroke | hit | mid | chest); react: hedefin klibi; at: temas anı
 *   (klip oranı); pass: eşya alıcıya geçer; hands: anlamlıysa ellere yakın plan.
 */
export const INTERACT = {
  comb_horse: { tk: 'animal', zone: 'flank', gap: 0.3, hgap: 0.55, reach: 'stroke', prop: 'curry_comb', react: { animal: 'idle', human: null }, hands: true },
  slap: { tk: 'any', zone: 'rump', gap: 0.32, hgap: 0.62, reach: 'hit', react: { animal: 'neigh', human: 'head_down' }, at: 0.42 },
  hug: { tk: 'human', hgap: 0.4, react: { human: 'hug' } },
  give: { tk: 'any', zone: 'head', gap: 0.45, hgap: 0.66, reach: 'mid', react: { human: 'take', animal: 'idle_headlow' }, at: 0.5, pass: true, hands: true },
  take: { tk: 'human', hgap: 0.66, reach: 'mid', react: { human: 'give' }, at: 0.5, pass: 'back' },
  handshake: { tk: 'human', hgap: 0.72, reach: 'mid', react: { human: 'handshake' } },
  // "push" klibi ağır bir şeyi itmek: yalnızca senaryo açıkça hedef yazdıysa (yüz döndüğü kişiyi itmez).
  push: { tk: 'any', zone: 'flank', gap: 0.3, hgap: 0.52, reach: 'chest', react: { human: 'upset', animal: null }, at: 0.3, explicit: true },
};
/** Türkçe/İngilizce eş anlamlar → etkileşim klibi (senaryoda bilinmeyen ad gelirse). */
const INTERACT_ALIAS = { groom: 'comb_horse', brush: 'comb_horse', pet: 'comb_horse', stroke: 'comb_horse', feed: 'give', hand: 'give', embrace: 'hug' };
const ARRIVE_GAP = 0.25;
/** Yerinde yapılan sakin jestler (konuşurken el hareketi, bekleme, düşünme): oyuncuyu "meşgul" saymaz. */
const CALM_CLIP = /^(idle|talk_gesture|look_around|think|nod|shrug|listen|wait|head_down|smile|happy)/; // varıştan sonra eyleme başlamadan önce kısa durak (sn)

/** Filmi normalleştirir: sahneler t'ye göre, beat/shot sıralı, replikler id'yle, eksik visemler metinden. */
export function prepareFilm(film) {
  const f = JSON.parse(JSON.stringify(film || {}));
  f.scenes = (f.scenes || []).slice().sort((a, b) => a.t0 - b.t0);
  let end = 0;
  f.scenes.forEach((s, i) => {
    s._i = i;
    s.beats = (s.beats || []).slice().sort((a, b) => a.t - b.t);
    // Güvenlik ağı (eski senaryolar): etkileşim klibinin eşyası yoksa eklenir (oynatıcı eşyaları bu listeden yükler).
    for (const b of s.beats) {
      if (b.do && INTERACT_ALIAS[b.do]) b.do = INTERACT_ALIAS[b.do];
      const spec = b.do ? INTERACT[b.do] : null;
      if (spec?.prop && !b.prop && b.target === undefined) b.prop = spec.prop; // yeni senaryoda eşyayı sunucu yazar (okşamada yok)
    }
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
    // Etkileşim hedefleri: senaryoda sahnede olmasa da kadrodaysa sahneye getirilir (havaya pandomim yok).
    this.inter = [];
    for (const b of sc.beats) {
      b._tgt = null;
      const spec = b.do ? INTERACT[b.do] : null;
      if (!spec || !b.who || !this.actors.has(b.who)) continue;
      b._tgt = this._interTarget(b, spec, ids);
      if (b._tgt) ids.add(b._tgt);
    }
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
      } else if (b._tgt && st.has(b._tgt) && A.kind === 'human') {
        this._stage(b, id, A, s, tr, d, st, busy);
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
      tr.props.sort((a, b) => a.t - b.t);
    }
    this.inter.sort((a, b) => a.t0 - b.t0);
    this.final = st;
  }

  // ---------------------------------------------------------------- etkileşim sahneleme

  /** Etkileşimin hedefi: açık `target`, sonra face / to (tür uyuyorsa), sonra sahnedekiler, en son kadro (sahneye getirilir). */
  _interTarget(b, spec, ids) {
    const kindOk = (X) => spec.tk === 'any' || X.kind === spec.tk;
    const ok = (x) => typeof x === 'string' && x !== b.who && this.actors.has(x) && kindOk(this.actors.get(x));
    if (spec.explicit) return ok(b.target) ? b.target : null;
    for (const x of [b.target, b.face, b.to]) if (ok(x)) return x;
    // Tercih: tımarda at/eşek, "any" eylemde (tokat, verme) önce insan.
    const rank = (x) => {
      const X = this.actors.get(x);
      if (spec.tk === 'animal') return /horse|donkey|mule/i.test(X.def?.animal || '') ? 0 : 1;
      return X.kind === 'human' ? 0 : 1;
    };
    const pick = (list) => list.filter(ok).sort((a, z) => rank(a) - rank(z))[0] || null;
    return pick([...ids]) || pick([...this.actors.keys()]);
  }

  /** Hayvanın gövde yarı genişliği (sınır kutusu bacak/kuyruk açıklığı içerebilir: sınırlanır). */
  _halfW(T) { return THREE.MathUtils.clamp((T.width || 0.6) * 0.5, 0.2, 0.42); }

  /** Duruş noktası ve yönü: hayvanda bölgeye göre (böğür / sağrı / baş önü) oyuncunun geldiği yanda (orası doluysa öbür
   * yanda ya da biraz ileride); insanda karşısında. */
  _geo(spec, A, T, apos, ts, st, self, tid) {
    const p = ts.pos, ya = ts.yaw;
    const f = V(Math.sin(ya), 0, Math.cos(ya)), r = V(Math.cos(ya), 0, -Math.sin(ya));
    const taken = (q) => [...st].some(([oid, o]) => oid !== self && oid !== tid && o.pos.distanceTo(q) < 0.55);
    // Duvar/çit dibi: o yanda oyuncuya ve kameraya yer yoksa öbür yan (at duvara yanaşık durabilir).
    const walled = (from, dir, len) => {
      const g = this.world.group;
      if (!g) return false;
      const ray = this._ray || (this._ray = new THREE.Raycaster());
      for (const h of [0.5, 1.2]) {
        ray.set(from.clone().setY(from.y + h), dir.clone().normalize());
        ray.far = len;
        for (const x of ray.intersectObject(g, true)) {
          if (x.object.isPoints || x.object.isSprite || x.object.isSkinnedMesh) continue;
          if (x.face && Math.abs(x.face.normal.y) > 0.8) continue;
          return true;
        }
      }
      return false;
    };
    if (T.kind === 'animal') {
      const hw = this._halfW(T), L = T.length || 2;
      const zone = spec.zone || 'flank';
      const near = r.dot(apos.clone().sub(p)) >= 0 ? 1 : -1;
      const make = (sgn, shift) => {
        const side = r.clone().multiplyScalar(sgn);
        let contact, stand;
        if (zone === 'head') {
          contact = p.clone().addScaledVector(f, L * 0.47);
          stand = contact.clone().addScaledVector(f, spec.gap).addScaledVector(side, 0.32);
        } else {
          contact = p.clone().addScaledVector(f, (zone === 'rump' ? -0.28 * L : 0.06 * L) + shift).addScaledVector(side, hw);
          stand = contact.clone().addScaledVector(side, spec.gap + 0.12);
        }
        stand.y = 0;
        return { stand, yaw: yawTo(stand, contact), sgn, zone };
      };
      const opts = [[near, 0], [-near, 0], [near, 0.55], [near, -0.55], [-near, 0.55], [-near, -0.55]];
      for (const pass of [0, 1]) for (const [sgn, sh] of opts) {
        const g = make(sgn, sh);
        if (taken(g.stand)) continue;
        if (pass === 0 && zone !== 'head' && walled(g.stand, r.clone().multiplyScalar(sgn), 1.4)) continue;
        return g;
      }
      return make(near, 0);
    }
    const dir = apos.clone().sub(p).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(ya), 0, Math.cos(ya));
    dir.normalize();
    // İnsan: geldiği yönden karşısına; arada duvar/korkuluk ya da orada başkası varsa yan açılar denenir.
    const hg = spec.hgap || 0.7;
    for (const pass of [0, 1]) for (const a of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      const d2 = dir.clone().applyAxisAngle(UP, a);
      const stand = p.clone().addScaledVector(d2, hg).setY(0);
      if (taken(stand)) continue;
      if (pass === 0 && walled(p.clone().setY(0), d2, hg + 0.25)) continue;
      return { stand, yaw: yawTo(stand, p), sgn: 1, zone: 'front' };
    }
    const stand = p.clone().addScaledVector(dir, hg).setY(0);
    return { stand, yaw: yawTo(stand, p), sgn: 1, zone: 'front' };
  }

  /** Bir oyuncunun t'den önce serbest kaldığı an (yumuşak jestler — konuşurken el hareketi — sayılmaz). */
  _freeAt(tr, t, busy, id) {
    let free = this.scene.t0;
    for (const c of tr.clips) if (!c.soft && !c.react && !CALM_CLIP.test(c.clip) && c.t < t) free = Math.max(free, Math.min(c.t + c.d, t));
    for (const g of tr.segs) if (g.t0 < t) free = Math.max(free, Math.min(g.t1, t));
    return Math.max(free, Math.min(t, busy.get(id) || 0));
  }

  /** Yürüyüş ekler (yaklaşma): t0'dan, gerekirse koşarak. Dönen: varış anı. */
  _walk(A, tr, s, to, t0, latest, busy, id) {
    const dist = s.pos.distanceTo(to);
    if (dist <= 0.12) return t0;
    let clip = 'walk', sp = A.speeds[A.clipFor('walk')] || 1.25;
    if (dist / sp > Math.max(0, latest - t0) + 1.5 && dist > 3.5) { const rs = A.speeds[A.clipFor('run')] || 3; if (rs > sp) { clip = 'run'; sp = rs; } }
    const dur = Math.max(0.5, dist / sp);
    const tw0 = Math.max(t0, latest - dur);
    const yaw1 = yawTo(s.pos, to);
    tr.turns.push({ t0: tw0, t1: tw0 + 0.35, y0: s.yaw, y1: yaw1 });
    const seg = { t0: tw0, t1: tw0 + dur, from: s.pos.clone(), to: to.clone(), clip, speed: dist / dur };
    tr.segs.push(seg);
    tr.clips.push({ t: tw0, d: dur, clip, move: seg });
    s.pos.copy(to);
    s.yaw = yaw1;
    busy.set(id, Math.max(busy.get(id) || 0, tw0 + dur));
    return tw0 + dur;
  }

  /** Etkileşim beat'ini sahneler: yaklaşma (gerekirse hedef insan karşılamaya gelir), hedefe dönüş, eylem klibi, hedefin
   * tepkisi, eşya geçişi. Döngülü el işi (tımar) oyuncunun bir sonraki eylemine kadar sürer (en çok 12 sn). */
  _stage(b, id, A, s, tr, d, st, busy) {
    const spec = INTERACT[b.do], tid = b._tgt, T = this.actors.get(tid), ts = st.get(tid), ttr = this.tracks.get(tid);
    const freeA = this._freeAt(tr, b.t, busy, id);
    let tc = Math.max(b.t, freeA), arrive = tc;
    // İnsan hedef daha önce boşa çıktıysa (ör. çocuk bekliyor, Dadaruh tımar ediyor) hedef gelir; değilse oyuncu gider.
    const freeT = T.kind === 'human' ? this._freeAt(ttr, b.t, busy, tid) : Infinity;
    const far = s.pos.distanceTo(ts.pos) - (spec.hgap || 0.7);
    let geo;
    if (T.kind === 'human' && far > 0.3 && freeT + 0.5 < freeA) {
      const meet = this._geo(spec, T, A, ts.pos, s, st, tid, id).stand;
      arrive = this._walk(T, ttr, ts, meet, freeT, b.t, busy, tid);
      tc = Math.max(tc, arrive + ARRIVE_GAP);
      geo = { stand: s.pos.clone(), yaw: yawTo(s.pos, ts.pos), sgn: 1, zone: 'front' };
    } else {
      geo = this._geo(spec, A, T, s.pos, ts, st, id, tid);
      if (s.pos.distanceTo(geo.stand) > 0.12) {
        arrive = this._walk(A, tr, s, geo.stand, freeA, b.t, busy, id);
        tc = Math.max(b.t, arrive + ARRIVE_GAP);
      }
    }
    const tt0 = Math.max(arrive, tc - 0.45);
    if (Math.abs(angDiff(s.yaw, geo.yaw)) > 0.05) tr.turns.push({ t0: tt0, t1: Math.max(tt0 + 0.35, tc), y0: s.yaw, y1: geo.yaw });
    s.yaw = geo.yaw;
    const name = A.clipFor(b.do);
    const cd = A.clipDur(name);
    const loop = A.loops && name in A.loops ? A.loops[name] : !ONCE.has(b.do);
    let dc = loop ? Math.max(1.6, b.t + d - tc) : Math.max(1.2, Math.min(cd + 0.2, Math.max(b.t + d - tc, cd * 0.85)));
    if (loop) {
      // El işi bir sonraki eyleme (ya da konuşmaya) kadar sürer: "tık… tık… tık…" anlatılırken tımar ekranda kalır.
      const next = this.scene.beats.find((x) => x !== b && x.who === id && x.t > b.t + 0.05 && (x.do || x.say));
      const until = Math.min(next ? next.t : this.scene.t1, tc + 12);
      dc = Math.max(dc, until - tc - 0.1);
    }
    tr.clips.push({ t: tc, d: dc, clip: b.do });
    busy.set(id, Math.max(busy.get(id) || 0, tc));
    const it = { who: id, target: tid, kind: b.do, spec, t0: tc, t1: tc + dc, arrive, cd: loop ? 1 : cd, sgn: geo.sgn, zone: geo.zone };
    this.inter.push(it);
    // Hedefin tepkisi (hedef o arada yürümüyorsa): insan oyuncuya döner; tepki klibi temas anında.
    const moving = ttr.segs.some((g) => g.t0 < it.t1 && g.t1 > tc - 0.3);
    if (!moving) {
      if (T.kind === 'human') {
        const y2 = yawTo(ts.pos, s.pos);
        if (Math.abs(angDiff(ts.yaw, y2)) > 0.08) { ttr.turns.push({ t0: Math.max(this.scene.t0, tc - 0.6), t1: tc, y0: ts.yaw, y1: y2 }); ts.yaw = y2; }
      }
      const rc = spec.react?.[T.kind];
      if (rc && T.actions.has(T.clipFor(rc))) {
        const delay = (spec.at || 0) * cd;
        const rd = rc === 'idle' || rc === 'hug' ? dc - delay : Math.max(1.2, Math.min(T.clipDur(T.clipFor(rc)), dc));
        ttr.clips.push({ t: tc + delay, d: rd, clip: rc, react: true });
      }
    } else if (T.kind === 'human') {
      // Karşılamaya gelen hedef varınca oyuncuya döner.
      const g = ttr.segs[ttr.segs.length - 1];
      const y2 = yawTo(ts.pos, s.pos);
      ttr.turns.push({ t0: g.t1, t1: g.t1 + 0.4, y0: ts.yaw, y1: y2 });
      ts.yaw = y2;
      const rc = spec.react?.human;
      if (rc && T.actions.has(T.clipFor(rc))) ttr.clips.push({ t: tc + (spec.at || 0) * cd, d: Math.max(1.2, Math.min(T.clipDur(T.clipFor(rc)), dc)), clip: rc, react: true });
    }
    // Eşya geçişi: verme → alıcının eline, alma → alanın eline.
    const pt = tc + dc * (spec.at || 0.5) + 0.15;
    const prop = b.prop || null;
    if (prop && spec.pass === true) { tr.props.push({ t: pt, id: null }); ttr.props.push({ t: pt, id: prop }); }
    if (prop && spec.pass === 'back') { ttr.props.push({ t: pt, id: null }); tr.props.push({ t: pt, id: prop }); }
  }

  /** İki oyuncu şu an birbiriyle etkileşimde mi (karede ayırma bunları itmez). */
  engaged(a, b, t) {
    for (const it of this.inter) {
      if (t < it.arrive - 0.2 || t > it.t1 + 0.6) continue;
      if ((it.who === a && it.target === b) || (it.who === b && it.target === a)) return true;
    }
    return false;
  }

  /** t anında aktörün etkin etkileşimi ve el/bakış hedefleri (dünya noktaları, karedeki gerçek konumlardan). */
  interactAt(id, t) {
    for (const it of this.inter) {
      if (t < it.t0 || t > it.t1) continue;
      if (it.who !== id && it.target !== id) continue;
      const r = this._reach(it, id, t);
      if (r) return r;
    }
    return null;
  }

  _reach(it, id, t) {
    const A = this.actors.get(it.who), T = this.actors.get(it.target);
    const role = it.who === id ? 'actor' : 'target';
    const u = t - it.t0;
    let w = smooth(u / 0.45) * smooth((it.t1 - t) / 0.45);
    // Anlık temaslı eylemlerde (tokat, verme): klibin temas anı çevresinde çan.
    if (it.spec.at != null) { const k = u / Math.max(0.3, it.cd); w *= smooth((k - (it.spec.at - 0.3)) / 0.2) * (1 - smooth((k - (it.spec.at + 0.22)) / 0.2)); }
    const out = { kind: it.kind, who: it.who, target: it.target, role, w, point: null, r: null, l: null, look: null };
    const P = T.root.position, ya = T.root.rotation.y;
    const f = V(Math.sin(ya), 0, Math.cos(ya)), rr = V(Math.cos(ya), 0, -Math.sin(ya));
    const ay = A.root.rotation.y, aR = V(Math.cos(ay), 0, -Math.sin(ay));
    const shY = A.root.position.y + A.eyeH * 0.82; // omuz hizası (yaklaşık)
    const midPoint = () => {
      const c = P.clone().lerp(A.root.position, 0.5);
      // İki göğüs hizasının ortası (yetişkin–çocukta ikisinin de kolu yetişir).
      c.y = (P.y + T.eyeH * 0.72 + A.root.position.y + A.eyeH * 0.72) / 2 - 0.06;
      return c;
    };
    if (role === 'target') {
      if (T.kind === 'animal') out.look = A.root.position.clone().setY(A.root.position.y + A.eyeH * 0.9);
      else if (it.spec.reach === 'mid') { const c = midPoint(); out.r = { p: c, w: w * 0.85 }; out.point = c.toArray(); }
      return out.r || out.look ? out : null;
    }
    let c = null;
    if (T.kind === 'animal') {
      const H = T.height || 1.6, L = T.length || 2;
      const side = rr.clone().multiplyScalar(it.sgn);
      if (it.zone === 'head') {
        c = P.clone().addScaledVector(f, L * 0.46);
        c.y = THREE.MathUtils.clamp(P.y + (T.eyeH || H * 0.8) * 0.8, shY - 0.45, shY + 0.1);
      } else {
        // Böğür / sağrı yüzeyi, oyuncunun hizasında (el çaprazlanmaz).
        c = A.root.position.clone().addScaledVector(side, -(it.spec.gap + 0.12) + 0.03).addScaledVector(aR, 0.1);
        c.y = THREE.MathUtils.clamp(P.y + H * (it.zone === 'rump' ? 0.52 : 0.5), shY - 0.42, shY + 0.02);
      }
      if (it.spec.reach === 'stroke') {
        // Kaşağı dairesel sürülür (tık… tık… tık… bir saat gibi): ~1,1 Hz, böğür boyunca.
        const c0 = c.clone();
        const ph = u * Math.PI * 2 * 1.1;
        c.addScaledVector(f, 0.085 * Math.cos(ph)).y += 0.06 * Math.sin(ph);
        // Boştaki (sol) el atın üstünde DİNLENİR (25 Ekim, kurucu: "tımarlarken diğer kol sallanıyor"): sabit nokta
        // (kaşağının yanında, omuz hizasının ~20 cm altı), avuç böğre dönük, parmaklar yukarı-öne, gevşek; dirsek aşağı-dışa
        // (kutup) — klipten bağımsız, kol kıpırdamaz. Bilek yüzeyden ~3 cm açıkta (avuç yüzeye oturur).
        const aL = aR.clone(), aF = V(Math.sin(ay), 0, Math.cos(ay)); // aR = (cos, 0, −sin): +Z'ye bakan oyuncunun SOL yanı (sol omuz bu yanda)
        const fing = V(0, 0.8, 0).addScaledVector(aL, 0.6).normalize();
        // Yüzey: atın orta çizgisinden böğür yarı genişliği kadar dışarı (oyuncunun sol omzu hizasında).
        // Yer: kaşağının değdiği yüzey derinliğinde (atın ekseni boyunca) sol omzun hizasında, omzun ~15–20 cm altında —
        // kolun rahat yettiği yer; yetişmiyorsa (çocuk, at uzak) Actor kolu yanda sakin bırakır.
        const sh = A.root.position.clone().addScaledVector(aL, 0.18);
        // Omuzdan ileri, kaşağının değdiği yüzey düzlemine (normali side) kadar.
        const den = aF.dot(side);
        const tt = Math.abs(den) > 0.2 ? THREE.MathUtils.clamp(c0.clone().sub(sh).dot(side) / den, 0.1, 0.6) : 0.35;
        const l = sh.clone().addScaledVector(aF, tt).addScaledVector(side, 0.02);
        l.y = shY; // shY (göz×0,82) gerçek omuzdan ~15–20 cm aşağıda: el omzun biraz altında, kol rahat yetişir
        out.l = { p: l, w, pole: V(0, -1, 0).addScaledVector(aL, 0.7).addScaledVector(aF, -0.35).normalize(), palm: side.clone().negate(), fingers: fing, curl: 0.12 };
      }
      if (it.spec.reach === 'chest') out.l = { p: c.clone().addScaledVector(aR, -0.3), w };
    } else {
      const eye = P.clone().add(T._eyeS || V(0, T.eyeH, 0));
      const toA = A.root.position.clone().sub(P).setY(0).normalize();
      if (it.spec.reach === 'hit') c = eye.clone().addScaledVector(aR, 0.08).addScaledVector(toA, 0.07).add(V(0, -0.07, 0));
      else if (it.spec.reach === 'chest') {
        c = P.clone().addScaledVector(toA, 0.14).setY(P.y + T.eyeH * 0.72);
        out.l = { p: c.clone().addScaledVector(aR, -0.32), w };
      } else if (it.spec.reach === 'mid') c = midPoint();
    }
    if (c) { out.r = { p: c, w }; out.point = c.toArray(); }
    return out;
  }

  /** Kamera için: çekimin öznelerinden birinin şu anki (varıştan itibaren) etkileşimi. */
  interactShot(t, ids) {
    for (const it of this.inter) {
      if (t < it.arrive - 0.05 || t > it.t1 + 0.3) continue;
      if (ids.includes(it.who) || ids.includes(it.target)) return it;
    }
    return null;
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
    const res = out.filter((x) => x.clip);
    // Etkileşim: el (IK) / baş (hayvan) hedefleri pozdan sonra uygulanır (Actor.pose).
    const it = this.inter.length ? this.interactAt(id, t) : null;
    if (it) res.reach = it;
    return res;
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
      if (b.who === id && (b._tgt || b.face) && this.tracks.has(b._tgt || b.face)) tgt = b._tgt || b.face;
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
// 25 Ekim (2): ω 2,4→2,0, bakış dönüşü ≤16°/sn; dönüş baş/boyun/üst göğse 60/25/15 paylaştırılır (yalnız baş dönmez,
// doğal görünür) ve en sonda Actor.stabilizeHead başı gövdeye göre ≤18°/sn (jestte ≤45°/sn) sınırlar.
const LOOK_W = 2.0, LOOK_VMAX = THREE.MathUtils.degToRad(16);
const LOOK_SPLIT = [0.15, 0.25, 0.6]; // üst göğüs, boyun, baş
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
  if (Math.abs(dy) >= 1e-4 || Math.abs(dp) >= 1e-4) {
    const right = V(Math.cos(yaw0), 0, -Math.sin(yaw0)); // aktörün sağ ekseni (bakış +Z)
    // Etkileşimde (el IK ile hedefte) göğüs dönmez: el hedeften kaymaz.
    const chest = !A._reachOn && neck && neck.parent && neck.parent.isBone && /spine|chest/i.test(neck.parent.name) ? neck.parent : null;
    const split = neck ? (chest ? [[chest, LOOK_SPLIT[0]], [neck, LOOK_SPLIT[1]], [head, LOOK_SPLIT[2]]] : [[neck, 0.4], [head, 0.6]]) : [[head, 1]];
    for (const [b, k] of split) {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, dy * k).multiply(new THREE.Quaternion().setFromAxisAngle(right, dp * k));
      rotateBoneWorld(b, q);
    }
    for (const e of A.bones.eyes) rotateBoneWorld(e, new THREE.Quaternion().setFromAxisAngle(UP, dy * 0.3));
  }
  // Son aşama: başın gövdeye göre hızı sınırlanır, kritik sönümlü (klip/geçiş sarsıntısı başa geçmez).
  if (A.stabilizeHead) A.stabilizeHead(dt, snap);
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

  /** Tek kişilik planda kadraj kusuru (yoksa null): özne dışındaki bir insanın gövdesi (göğüs/kalça) kadrajda ama gözleri
   * dışarıda (başsız gövde — yetişkinin beli/kasığı), ya da kamera onun kişisel alanında (minD). Dönen: {id, why}. */
  _frameBad(plan, pos, look, fovDeg, aspect, subj, minD, skip = null, mg = 1) {
    const f = look.clone().sub(pos).normalize();
    const r = V().crossVectors(f, UP).normalize(), u = V().crossVectors(r, f);
    const tv = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2), th = tv * aspect;
    const pr = (p) => { const d = p.clone().sub(pos), z = d.dot(f); return z < 0.1 ? null : [d.dot(r) / (z * th), d.dot(u) / (z * tv)]; };
    const inF = (q, mx, my) => q && Math.abs(q[0]) <= mx && Math.abs(q[1]) <= my;
    // Öznenin kendisi: kamera kişisel alanında olmasın.
    for (const id of plan.ids) {
      const X = plan.actors.get(id);
      if (X.kind !== 'human') continue;
      const R = X.root.position, eh = X._eyeS ? X._eyeS.y : X.eyeH;
      const s = THREE.MathUtils.clamp((pos.y - R.y) / Math.max(0.3, eh), 0, 1);
      const dAx = Math.hypot(pos.x - R.x, pos.z - R.z);
      if (dAx < (X === subj ? minD : Math.max(0.8, minD - 0.2)) && s > 0) return { id, why: 'near' };
      if (X === subj || id === skip) continue;
      const eye = R.clone().setY(R.y + eh);
      const qe = pr(eye), qc = pr(R.clone().setY(R.y + eh * 0.8)), qh = pr(R.clone().setY(R.y + eh * 0.56));
      // mg > 1: seçimde pay bırakılır (çekim boyunca kamera yayı/kerteriz kayması ve oyuncu kıpırdaması kadrajı bozmasın).
      const body = inF(qc, mg, mg) || inF(qh, mg, mg);
      if (body && !inF(qe, 0.95 / mg, 0.9 / mg)) return { id, why: 'headless' };
    }
    return null;
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
  _clear(plan, world, pos, look, ids, key, t, lift = false) {
    // Çekim başında tam arama; çekim içinde 1 sn'de bir yalnızca seçili açının hâlâ açık olup olmadığına bakılır (açı
    // gereksiz yere değişip kamera yeniden kadraj aramaz — histerezis).
    const fresh = this._occKey !== key;
    if (!fresh && Math.abs(t - this._occT) > 1.0) {
      this._occT = t;
      const off = pos.clone().sub(look).applyAxisAngle(UP, this._occAng || 0).multiplyScalar(this._occPull || 1);
      off.y += this._occLift || 0;
      if (this._blocked(plan, world, look, look.clone().add(off), ids)) this._occKey = null;
    }
    if (this._occKey !== key) {
      this._occKey = key;
      this._occT = t;
      this._occAng = 0;
      this._occPull = 1;
      this._occLift = 0;
      const off = pos.clone().sub(look);
      const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1];
      let found = false, firstHit = null;
      // Etkileşim planında önce açı, sonra yükseklik denenir (önde masa/sedir/çit: kamera üstünden bakar, öne çekilmez).
      for (const dy of lift ? [0, 0.6, 1.2] : [0]) {
        for (const a of tries) {
          const c = look.clone().add(off.clone().applyAxisAngle(UP, a));
          c.y += dy;
          const hit = this._blocked(plan, world, look, c, ids);
          if (!hit) { this._occAng = a; this._occLift = dy; found = true; break; }
          if (a === 0 && dy === 0 && hit.env) firstHit = hit.d;
        }
        if (found) break;
      }
      if (!found && firstHit) this._occPull = Math.max(0.25, (firstHit - 0.25) / off.length());
    }
    if (this._occAng || this._occPull !== 1 || this._occLift) {
      const off = pos.clone().sub(look).applyAxisAngle(UP, this._occAng).multiplyScalar(this._occPull);
      off.y += this._occLift || 0;
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
    // Etkileşim (tımar, tokat, verme…): eylemi yapan ve hedefi birlikte kadrajda — hedef çekim listesinde olmasa da.
    const IT = shot.type !== 'establishing' && plan.interactShot ? plan.interactShot(t, ids) : null;
    if (IT) {
      const rest = ids.filter((x) => x !== IT.who && x !== IT.target);
      ids.length = 0;
      ids.push(IT.who, IT.target, ...rest);
    }
    let A = plan.actors.get(ids[0]);
    let B = ids[1] ? plan.actors.get(ids[1]) : null;
    const p = clamp01((t - shot.t) / Math.max(0.5, shot.d || 4));
    const e = p * p * (3 - 2 * p) * 0.6 + p * 0.4;
    let type = shot.type || 'wide';
    if (type === 'over_shoulder') type = 'ots';
    if (type === 'two' || type === 'twoshot' || type === 'two-shot') type = 'two_shot'; // senaryo adı: "two"
    // Omuz üstü, dinleyen konuşandan çok uzunsa (yetişkin–çocuk) dinleyenin gövdesi kadrajı kaplar: karşı açıdan yakın plan.
    if (type === 'ots' && B && A.kind === 'human' && B.kind === 'human' && Math.abs(B.eyeH - A.eyeH) > 0.25) type = 'close';
    // Ek çekim (insert, ellere yakın): baş kadraj dışında kalır — en çok 2,5 sn; uzun ek çekimin kalanı orta plan.
    if (type === 'insert' && !IT && (shot.d || 0) > 3 && t - shot.t > 2.5) type = 'medium';
    if (IT && type !== 'wide' && type !== 'establishing' && type !== 'pov') {
      // Yakın plan → ikili etkileşim planı; el işi (tımar, yemleme) uzun yakın plansa ikinci yarısı ellere yakın plan.
      const s0 = Math.max(shot.t, IT.arrive), left = shot.t + (shot.d || 4) - s0;
      // 25 Ekim (kurucu: "kamera geride durması gerekirken çok yakın"): eylem (tımar, verme) geniş planda kalır; ellere
      // yakın plan yalnızca senaryo açıkça ek çekim (insert) istediyse.
      void left;
      const hands = IT.spec.hands && type === 'insert';
      type = hands ? 'inter_hands' : 'inter';
    }
    const side = world.side.clone();
    let pos = V(), look = V(), fov = lensFov(LENS[type] || (type === 'inter' ? 40 : type === 'inter_hands' ? 85 : 35), cam.aspect);
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
    const compose = (type) => {
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
          // Kadraj yüksekliği: gözler üst üçte birde; başın tepesi (şapka dahil) + ~4 cm boşluk kadraja sığar (H/3 ≥ gereken).
          const need = A.kind === 'human' ? (0.13 + (A.def?.hat ? 0.11 : 0)) * s + 0.04 : 0;
          const H = type === 'insert' ? 0.34 * s * (A.kind === 'animal' ? 2.4 : 1) : Math.max(0.55 * s * (A.kind === 'animal' ? 2.4 : 1), need * 3);
          const dist = Math.max(0.8, frameDist(H));
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
          const dist = Math.max(1.2, frameDist(H));
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
          // İkili plan (25 Ekim): iki baş da boşluğuyla, alt kenar en çok dizde (yetişkin–çocukta yetişkin bel hizasından
          // kesilmez); kamera alçak gözün biraz üstünde (çocuğa tepeden, yetişkine kasıktan bakmaz).
          const Bx = B || plan.actors.get(plan.ids.find((x) => x !== ids[0]) || ids[0]);
          const P = A.root.position, Q = Bx.root.position;
          const n = axisSide(P, Q);
          const c = P.clone().add(Q).multiplyScalar(0.5);
          const eA = this.anchor(A, 'head'), eB = this.anchor(Bx, 'head');
          const hum = (X) => X.kind === 'human';
          const top = Math.max(eA.y + (hum(A) ? 0.17 + (A.def?.hat ? 0.11 : 0) : 0.3), eB.y + (hum(Bx) ? 0.17 + (Bx.def?.hat ? 0.11 : 0) : 0.3));
          const bot = Math.min(P.y, Q.y) + 0.38;
          const vf = THREE.MathUtils.degToRad(fov);
          const half = P.distanceTo(Q) * 0.5 + 0.45;
          const dist = Math.max(2.2, ((top - bot) / 2) / Math.tan(vf / 2) * 1.06, half / Math.tan(hfov(fov) / 2) * 1.06);
          const lowEye = Math.min(hum(A) ? eA.y : 9, hum(Bx) ? eB.y : 9);
          const cy = (top + bot) / 2;
          pos.copy(c).addScaledVector(n, dist).setY(Math.max(cy, Math.min(lowEye < 9 ? lowEye + 0.05 : cy, cy + 0.4)));
          look.copy(c).setY(cy);
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
        case 'inter':
        case 'inter_hands': {
          // Etkileşim planı: hayvanda öne-yandan 3/4 (oyuncunun durduğu yanda, hayvanın başı tarafından: oyuncu profilden,
          // eli hayvanın üstünde görünür); insanda konuşma ekseninin kamera tarafından ikili plan.
          const W = plan.actors.get(IT.who), T = plan.actors.get(IT.target);
          const live = plan._reach(IT, IT.who, Math.min(Math.max(t, IT.t0), IT.t1));
          const cp = live?.r?.p ? live.r.p.clone() : W.root.position.clone().lerp(T.root.position, 0.5).setY(W.root.position.y + W.eyeH * 0.6);
          let dir;
          if (T.kind === 'animal') {
            const ya = T.root.rotation.y;
            const f = V(Math.sin(ya), 0, Math.cos(ya)), r = V(Math.cos(ya), 0, -Math.sin(ya)).multiplyScalar(IT.sgn);
            dir = type === 'inter_hands' ? f.clone().addScaledVector(r, 0.5).normalize() : f.clone().multiplyScalar(IT.zone === 'head' ? 0.25 : 0.8).add(r).normalize();
          } else dir = axisSide(W.root.position, T.root.position);
          if (type === 'inter_hands') {
            const H = 0.62;
            const dist = frameDist(H);
            look.copy(cp);
            pos.copy(cp).addScaledVector(dir, dist);
            pos.y = cp.y + 0.28;
            this.focus = dist;
            break;
          }
          const box = new THREE.Box3();
          box.expandByPoint(W.root.position).expandByPoint(this.anchor(W, 'head').add(V(0, 0.12, 0))).expandByPoint(cp);
          if (T.kind === 'animal') {
            // Hayvanın başı ve temas bölgesi (tüm gövde değil: kadraj insanı küçültmesin).
            box.expandByPoint(this.anchor(T, 'head'));
            box.expandByPoint(T.root.position.clone().setY(T.root.position.y + (T.height || 1.6) * 0.55));
          } else box.expandByPoint(this.anchor(T, 'head').add(V(0, 0.12, 0))).expandByPoint(T.root.position);
          const c = box.getCenter(V());
          const r = Math.max(0.9, box.getSize(V()).length() * 0.5);
          const dist = Math.max(2.2, fitDist(r * 1.05, fov));
          pos.copy(c).addScaledVector(dir, dist);
          // Hafif yukarıdan (göz hizasının biraz üstü): önde masa/çit/sedir varsa onların üstünden görür.
          pos.y = Math.max(c.y + 0.35 + dist * 0.05, box.max.y - 0.1);
          look.copy(c);
          this.focus = dist;
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
    };
    compose(type);
    // Tek kişilik plan (yakın / orta / omuz üstü / ek) kadraj denetimi (25 Ekim, kurucu: çocuğun göz hizasındaki kamera
    // yetişkinin belini/kasığını çekiyordu): başka bir oyuncunun gövdesi kadrajda ama başı dışarıdaysa ya da kamera onun kişisel
    // alanındaysa (yakın <0,8 m, orta <1,2 m) kamera özne çevresinde döndürülerek temiz açı aranır; yoksa ikisini baştan
    // ayağa (en az dizden yukarı) gösteren ikili plana genişlenir. Karar çekim başında verilir, sn'de bir yeniden denetlenir.
    if ((type === 'close' || type === 'medium' || type === 'insert' || type === 'ots') && A.kind === 'human') {
      const fk = `${plan.scene._i}:${shot.t}:${type}:${A.id}`;
      let F = this._fr;
      const pivot = this.anchor(A, 'head');
      const turn = (ang) => {
        const P2 = pos.clone().sub(pivot).applyAxisAngle(UP, ang).add(pivot);
        const L2 = look.clone().sub(pivot).applyAxisAngle(UP, ang).add(pivot);
        return [P2, L2];
      };
      const minD = type === 'medium' ? 1.2 : 0.8;
      const skip = type === 'ots' ? (B ? B.id : plan.gazeTarget(ids[0], t, plan.lineAt(t))) : null; // omuz üstünde ön plandaki dinleyen
      if (!F || F.k !== fk || this.snap) {
        F = this._fr = { k: fk, off: 0, wide: null, tc: t };
        let found = false, worst = null;
        for (const a of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25]) {
          const bad = this._frameBad(plan, ...turn(a), fov, cam.aspect, A, minD, skip, 1.2);
          if (!bad) { F.off = a; found = true; break; }
          if (!worst) worst = bad;
        }
        if (!found) F.wide = worst.id;
      } else if (!F.wide && t - F.tc > 0.25) {
        // Çekim içinde ¼ sn'de bir: GERÇEK kamera (yay + kerteriz sonrası) kadrajı bozulduysa açı aranmaz (kamera savrulmaz),
        // ikili plana geçilir (bir kesme) ve çekim sonuna dek öyle kalır.
        F.tc = t;
        const live = this._pos && this._look ? this._frameBad(plan, this._pos, this._look, fov, cam.aspect, A, minD, skip) : null;
        const bad = live || this._frameBad(plan, ...turn(F.off), fov, cam.aspect, A, minD, skip);
        if (bad) F.wide = bad.id;
      }
      if (F.wide && plan.actors.get(F.wide)) {
        type = 'two_shot';
        B = plan.actors.get(F.wide);
        ids.length = 0;
        ids.push(A.id, B.id);
        fov = lensFov(LENS.two_shot, cam.aspect);
        compose(type);
      } else if (F.off) {
        const [P2, L2] = turn(F.off);
        pos.copy(P2);
        look.copy(L2);
      }
    }
    // Yakın / orta / omuz üstü: kameranın özneye göre yönü (kerteriz) çekim başında kilitlenir, en çok 8°/sn kayar —
    // özne dönünce ya da yürürken yön değiştirince kamera onun çevresinde savrulmaz.
    if (type === 'medium' || type === 'close' || type === 'insert' || type === 'ots' || type === 'inter_hands') {
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
    if (type === 'wide' || type === 'establishing' || type === 'two_shot' || type === 'inter') {
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
    this._clear(plan, world, pos, look, type === 'ots' || type === 'wide' || type === 'establishing' || type === 'two_shot' ? plan.ids : IT ? ids.slice(0, 2) : ids.slice(0, 1), `${plan.scene._i}:${shot.t}:${type}`, t, type === 'inter' || type === 'inter_hands');
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
    // Kare atlamasında (≤1 sn, telefonda kesme anında olabiliyor) kamera oturtulmaz; yaylar 1/30 sn alt adımlarla ilerler.
    if (!changed && !this.snap && this._pos && dt > 0 && dt < 1) for (let left = dt; left > 1e-6; ) {
      const dt = Math.min(left, 1 / 30);
      left -= dt;
      const fixedLeg = type === 'wide' || type === 'establishing' || type === 'two_shot' || type === 'inter';
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
    }
    else {
      this._pos = pos.clone();
      this._look = look.clone();
      this._vp = V();
      this._vl = V();
    }
    cam.position.copy(this._pos);
    cam.lookAt(this._look);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.shotKey = key;
    this.closeup = type === 'close' || type === 'ots' || type === 'insert' || type === 'inter_hands';
    this.dofScale = type === 'ots' ? 0.4 : type === 'insert' || type === 'inter_hands' ? 0.8 : 1; // omuz üstünde hafif alan derinliği
    this.primary = A;
    // Portre ışığı: konuşanın (yoksa öznenin) gözü; plan sıkılaştıkça güçlenir.
    const line = plan.lineAt(t);
    const subj = line && plan.tracks.has(line.who) && ids.includes(line.who) ? plan.actors.get(line.who) : A;
    this.subjectEye = subj && subj.kind === 'human' ? this.anchor(subj, 'head') : null;
    this.portraitW = { close: 1, ots: 1, insert: 0.6, inter_hands: 0.5, medium: 0.8, two_shot: 0.55, inter: 0.6, pov: 0.4, wide: 0.25, establishing: 0 }[type] ?? 0.3;
    return { key, changed, shot, type };
  }
}
