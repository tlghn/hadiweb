// HADİ Film v3 — görüntü: PBR + ACES ton eşleme, tek güneşle yumuşak gölgeler, gökyüzü (Sky) + gün saati / hava, sis,
// ortam ışığı (gökyüzünden PMREM), hafif bloom, alan derinliği (yakın planda, yüksek kalitede), renk derecelendirme, film
// greni ve vinyet; parçacıklar (toz, yaprak, yağmur, kar). Kalite kademeleri: low | mid | high.
import * as THREE from 'three';
import { Sky } from './addons/objects/Sky.js';
import { EffectComposer } from './addons/postprocessing/EffectComposer.js';
import { RenderPass } from './addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from './addons/postprocessing/BokehPass.js';
import { OutputPass } from './addons/postprocessing/OutputPass.js';
import { ShaderPass } from './addons/postprocessing/ShaderPass.js';
import { GTAOPass } from './addons/postprocessing/GTAOPass.js';

export const QUALITY = {
  low: { pr: 0.75, shadow: 0, post: false, bloom: false, dof: false, grain: false, particles: 0.35, pmrem: false, msaa: 0, ao: false, ca: 0 },
  mid: { pr: 1.25, shadow: 1024, post: true, bloom: true, dof: false, grain: true, particles: 0.7, pmrem: true, msaa: 0, ao: false, ca: 0.6 },
  high: { pr: 2, shadow: 2048, post: true, bloom: true, dof: true, grain: true, particles: 1, pmrem: true, msaa: 4, ao: true, ca: 1, vsm: true, shafts: true, mblur: true },
};

// Gün saati: güneş yüksekliği (derece), ışık rengi / şiddeti, gökyüzü ve derecelendirme.
const TIMES = {
  dawn: { elev: 6, az: 100, sun: '#ffc08a', si: 1.5, hemi: 0.3, sky: '#c9a993', ground: '#5d5040', turb: 5, ray: 2, warm: 0.5, exp: 0.8 },
  morning: { elev: 24, az: 120, sun: '#ffe2bd', si: 2.2, hemi: 0.32, sky: '#9fbbd8', ground: '#6a6048', turb: 2.4, ray: 1.3, warm: 0.25, exp: 0.72 },
  day: { elev: 50, az: 160, sun: '#fff3e0', si: 2.6, hemi: 0.35, sky: '#95b8de', ground: '#6d6550', turb: 2, ray: 1.0, warm: 0.08, exp: 0.7 },
  noon: { elev: 70, az: 180, sun: '#fffaf0', si: 2.8, hemi: 0.38, sky: '#93b6de', ground: '#6d6550', turb: 2, ray: 0.9, warm: 0, exp: 0.68 },
  afternoon: { elev: 32, az: 230, sun: '#ffe7c2', si: 2.4, hemi: 0.33, sky: '#a2bfdc', ground: '#6d6050', turb: 2.6, ray: 1.3, warm: 0.2, exp: 0.72 },
  dusk: { elev: 3, az: 255, sun: '#ff9a5c', si: 1.4, hemi: 0.26, sky: '#b08a80', ground: '#4a3c34', turb: 6, ray: 2.6, warm: 0.6, exp: 0.8 },
  evening: { elev: -2, az: 265, sun: '#d07a5a', si: 0.55, hemi: 0.22, sky: '#5b5470', ground: '#2a2630', turb: 9, ray: 3, warm: 0.2, exp: 1.05 },
  night: { elev: -12, az: 300, sun: '#8fa6d8', si: 0.45, hemi: 0.16, sky: '#1a2236', ground: '#0e1016', turb: 1, ray: 0.3, warm: -0.35, exp: 1.25, moon: true },
};
const WEATHER = {
  clear: { fog: 0.0028, cloud: 0, sat: 1, dim: 1, parts: [] },
  cloudy: { fog: 0.008, cloud: 0.6, sat: 0.85, dim: 0.6, parts: [] },
  fog: { fog: 0.05, cloud: 0.8, sat: 0.75, dim: 0.55, parts: [] },
  rain: { fog: 0.025, cloud: 1, sat: 0.7, dim: 0.45, parts: ['rain'] },
  storm: { fog: 0.03, cloud: 1, sat: 0.6, dim: 0.35, parts: ['rain'] },
  snow: { fog: 0.03, cloud: 0.9, sat: 0.75, dim: 0.7, parts: ['snow'] },
  wind: { fog: 0.004, cloud: 0.3, sat: 0.95, dim: 0.9, parts: ['leaves'] },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVig: { value: 0.32 }, uSat: { value: 1 },
    uContrast: { value: 1.06 }, uWarm: { value: 0 }, uLift: { value: 0.012 }, uRes: { value: new THREE.Vector2(1, 1) }, uCA: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uSat, uContrast, uWarm, uLift, uCA; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Sinematik lens: kenarlara doğru çok hafif kromatik sapma.
      if (uCA > 0.0) {
        vec2 dir = (vUv - 0.5) * uCA * 0.004 * dot(vUv - 0.5, vUv - 0.5) * 4.0;
        col.r = texture2D(tDiffuse, vUv + dir).r;
        col.b = texture2D(tDiffuse, vUv - dir).b;
      }
      // Film eğrisi: yumuşak omuz ve hafif soğuk gölge / sıcak ışık ayrımı (LUT benzeri).
      col = col / (1.0 + max(col - 0.85, 0.0) * 0.6);
      float lum0 = dot(col, vec3(0.2126,0.7152,0.0722));
      col += (vec3(-0.012, 0.0, 0.022) * (1.0 - smoothstep(0.0, 0.45, lum0)) + vec3(0.018, 0.008, -0.012) * smoothstep(0.55, 1.0, lum0));
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col += vec3(0.035, 0.012, -0.03) * uWarm * (1.0 - l) + vec3(0.02, 0.0, -0.025) * uWarm * l;
      col = col * (1.0 - uLift) + uLift * vec3(0.9, 0.95, 1.05);
      vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
      col *= 1.0 - uVig * smoothstep(0.35, 1.05, length(d));
      float g = h(vUv * uRes + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (1.0 - l * 0.6);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

// Güneş huzmesi (ekran uzayı, "god rays"): güneşe doğru parlak gökyüzü piksellerinden radyal bulanıklık; ağaç/çatı
// arasından sızan ışık. Yalnızca güneş kadrajın yakınındayken.
const ShaftShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uOn: { value: 0 }, uColor: { value: new THREE.Color('#ffe2b8') } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uOn; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uOn < 0.001) { gl_FragColor = base; return; }
      vec2 d = (vUv - uSun) * (1.0 / 40.0) * 0.85;
      vec2 uv = vUv; float illum = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        uv -= d;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = max(0.0, dot(c, vec3(0.2126,0.7152,0.0722)) - 1.2);
        acc += c * min(l, 4.0) * illum;
        illum *= 0.955;
      }
      acc *= 1.0 / 40.0;
      gl_FragColor = vec4(base.rgb + acc * uColor * uOn * 0.9, base.a);
    }`,
};

// Kamera hareket bulanıklığı (yüksek kalite): dönme/kaydırma kaynaklı (sonsuz uzaklık varsayımı), ~180° obtüratör.
const MotionShader = {
  uniforms: { tDiffuse: { value: null }, uInv: { value: new THREE.Matrix4() }, uPrev: { value: new THREE.Matrix4() }, uAmt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform mat4 uInv, uPrev; uniform float uAmt; varying vec2 vUv;
    void main(){
      if (uAmt < 0.001) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 w = uInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(w.xyz / w.w);
      vec4 p = uPrev * vec4(dir, 0.0);
      vec2 prev = (p.xy / max(1e-4, p.w)) * 0.5 + 0.5;
      vec2 v = (vUv - prev) * uAmt;
      float L = length(v); if (L > 0.03) v *= 0.03 / L;
      vec4 c = vec4(0.0);
      for (int i = 0; i < 8; i++) c += texture2D(tDiffuse, vUv - v * (float(i) / 7.0 - 0.5));
      gl_FragColor = c / 8.0;
    }`,
};

// ------------------------------------------------------------------ parçacıklar (zamana bağlı, seek'e dayanıklı)

const PART_DEF = {
  dust: { n: 420, box: [14, 5, 14], size: 0.035, vel: [0.05, 0.02, 0.03], sway: 0.25, color: '#fff2d6', opacity: 0.55, add: true, kind: 0 },
  leaves: { n: 140, box: [18, 8, 18], size: 0.14, vel: [0.25, -0.55, 0.1], sway: 0.9, color: '#b8862e', opacity: 0.95, add: false, kind: 1 },
  rain: { n: 2600, box: [22, 12, 22], size: 0.5, vel: [0.4, -9, 0.2], sway: 0, color: '#b9c6d2', opacity: 0.38, add: false, kind: 2 },
  snow: { n: 1600, box: [20, 10, 20], size: 0.07, vel: [0.15, -0.8, 0.05], sway: 0.6, color: '#ffffff', opacity: 0.9, add: false, kind: 3 },
  embers: { n: 90, box: [6, 4, 6], size: 0.03, vel: [0.02, 0.35, 0.02], sway: 0.3, color: '#ffb46a', opacity: 0.9, add: true, kind: 0 },
};

function makeParticles(id, scale) {
  const d = PART_DEF[id];
  const n = Math.max(8, Math.round(d.n * scale));
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: d.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...d.box) }, uVel: { value: new THREE.Vector3(...d.vel) },
      uSway: { value: d.sway }, uSize: { value: d.size }, uPx: { value: 600 }, uColor: { value: new THREE.Color(d.color) }, uOpacity: { value: d.opacity },
      uKind: { value: d.kind }, uLight: { value: 1 },
    },
    vertexShader: `
      attribute vec4 seed; uniform float uTime, uSway, uSize, uPx; uniform vec3 uCenter, uBox, uVel; varying vec4 vS; varying float vFade;
      void main(){
        vS = seed;
        vec3 p = seed.xyz * uBox + uVel * (0.6 + 0.8 * seed.w) * uTime;
        p.x += sin(uTime * (0.6 + seed.w) + seed.y * 30.0) * uSway;
        p.z += cos(uTime * (0.5 + seed.x) + seed.z * 20.0) * uSway * 0.6;
        vec3 lo = uCenter - uBox * 0.5;
        p = lo + mod(p - lo, uBox);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 q = (p - uCenter) / (uBox * 0.5);
        vFade = 1.0 - smoothstep(0.75, 1.0, max(abs(q.x), max(abs(q.y), abs(q.z))));
        gl_PointSize = uSize * (0.6 + 0.8 * seed.w) * uPx / max(0.3, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity, uKind, uTime, uLight; varying vec4 vS; varying float vFade;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float a;
        if (uKind < 0.5) { a = smoothstep(0.5, 0.0, length(c)); a *= 0.55 + 0.45 * sin(uTime * 2.0 + vS.x * 40.0); }
        else if (uKind < 1.5) {
          float r = uTime * (1.0 + vS.y * 2.0) + vS.x * 6.28; mat2 R = mat2(cos(r), -sin(r), sin(r), cos(r)); vec2 q = R * c;
          a = smoothstep(0.03, 0.0, (q.x * q.x) / 0.06 + (q.y * q.y) / 0.012 - 0.9) ; a = step(0.5, a);
        }
        else if (uKind < 2.5) { a = smoothstep(0.035, 0.0, abs(c.x)) * smoothstep(0.5, 0.2, abs(c.y)); }
        else { a = smoothstep(0.5, 0.15, length(c)); }
        if (a < 0.01) discard;
        vec3 col = uColor * (uKind > 0.5 && uKind < 1.5 ? (0.65 + 0.5 * vS.z) : 1.0) * uLight;
        gl_FragColor = vec4(col, a * uOpacity * vFade);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

// ------------------------------------------------------------------ görünüm

export class Look {
  constructor(canvas, quality = 'mid') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // AgX: parlak beyazlar (keten gömlek, açık ten) ACES'e göre daha yumuşak sıkışır, "patlamaz".
    r.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 3000);
    this.sky = new Sky();
    this.sky.scale.setScalar(2500);
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight('#fff3e0', 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#a9c8e8', '#6d6550', 0.5);
    this.scene.add(this.hemi);
    // Üç nokta portre ışığı (yakın / orta planda konuşana): anahtar (sıcak, yumuşak), dolgu (karşı yan, zayıf), kenar
    // (arkadan, başı ayırır). Yalnızca özne çevresini aydınlatan yumuşak spotlar; geniş planda sönük.
    const spot = (c) => { const l = new THREE.SpotLight(c, 0, 7, 0.42, 1, 2); l.castShadow = false; this.scene.add(l, l.target); return l; };
    this.key = spot('#ffd6aa');
    this.fillL = spot('#dfe8ff');
    this.rim = spot('#fff6ea');
    this._portrait = 0;
    this.scene.fog = new THREE.FogExp2('#a9c8e8', 0.006);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.skyScene = new THREE.Scene();
    this.skyCopy = new Sky();
    this.skyCopy.scale.setScalar(100);
    this.skyScene.add(this.skyCopy);
    this.envRT = null;
    this.particles = new Map();
    this.partWant = [];
    this.grade = { sat: 1, warm: 0, contrast: 1.06 };
    this.w = 1; this.h = 1;
    this.setQuality(quality);
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'mid';
    this.qname = q;
    this.q = QUALITY[q];
    this.prScale = this.prScale || 1;
    const r = this.renderer;
    r.shadowMap.enabled = this.q.shadow > 0;
    // Yüksek: VSM (geniş, yumuşak yarı gölge); orta: PCF yumuşak.
    r.shadowMap.type = this.q.vsm ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
    this.sun.shadow.radius = this.q.vsm ? 9 : 3;
    this.sun.shadow.blurSamples = this.q.vsm ? 16 : 8;
    this.sun.shadow.bias = this.q.vsm ? -0.0008 : -0.0004;
    if (this.q.shadow) {
      this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    this._buildComposer();
    this.resize(this.w, this.h);
    this._rebuildParticles();
    if (this._env) this.setEnv(this._env);
  }

  _buildComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.q.post) return;
    const rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples: this.q.msaa });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.ao) {
      // Ortam kapatma (GTAO): temas gölgeleri, kıvrımlar; parçacıklar AO derinliğine girmez.
      const ao = new GTAOPass(this.scene, this.camera, this.w, this.h);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      const orig = ao.render.bind(ao);
      ao.render = (...args) => {
        const vis = [];
        for (const p of this.particles.values()) { vis.push(p.visible); p.visible = false; }
        this.sky.visible = false;
        try { orig(...args); } finally {
          let i = 0;
          for (const p of this.particles.values()) p.visible = vis[i++];
          this.sky.visible = !this._env?.interior;
        }
      };
      this.ao = ao;
      c.addPass(ao);
    } else this.ao = null;
    if (this.q.dof) {
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 3, aperture: 0.0012, maxblur: 0.008 });
      this.bokeh.enabled = false;
      c.addPass(this.bokeh);
    } else this.bokeh = null;
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w / 2, this.h / 2), 0.14, 0.4, 1.15);
      c.addPass(this.bloom);
    }
    if (this.q.shafts) { this.shafts = new ShaderPass(ShaftShader); c.addPass(this.shafts); } else this.shafts = null;
    if (this.q.mblur) { this.mblur = new ShaderPass(MotionShader); c.addPass(this.mblur); this._prevVP = null; } else this.mblur = null;
    c.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    c.addPass(this.gradePass);
    this.composer = c;
  }

  resize(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pr) * this.prScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.w, this.h);
      if (this.gradePass) this.gradePass.uniforms.uRes.value.set(this.w * pr, this.h * pr);
    }
    for (const p of this.particles.values()) p.material.uniforms.uPx.value = (this.h * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Sahne ortamı: zaman, hava, (isteğe bağlı) ışık geçersiz kılma, iç mekân. */
  setEnv(e) {
    this._env = e;
    const T = TIMES[e.time] || TIMES.day;
    const W = WEATHER[e.weather] || WEATHER.clear;
    const interior = !!e.interior;
    // Güneş yönü
    const dir = new THREE.Vector3();
    if (e.light?.sun) dir.fromArray(e.light.sun).normalize();
    else {
      const el = THREE.MathUtils.degToRad(Math.max(T.elev, T.moon ? 28 : 2)), az = THREE.MathUtils.degToRad(T.az);
      dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    }
    this.sunDir = dir.clone();
    const skyDir = new THREE.Vector3();
    {
      const el = THREE.MathUtils.degToRad(e.light?.sun ? Math.asin(dir.y) * 57.3 : T.elev), az = Math.atan2(dir.x, dir.z);
      skyDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    }
    for (const s of [this.sky, this.skyCopy]) {
      const u = s.material.uniforms;
      u.turbidity.value = T.turb + W.cloud * 8;
      u.rayleigh.value = T.ray * (1 - W.cloud * 0.6);
      u.mieCoefficient.value = 0.005 + W.cloud * 0.02;
      u.mieDirectionalG.value = 0.8;
      u.sunPosition.value.copy(skyDir);
    }
    this.sky.visible = !interior && !e.hdri;
    const col = new THREE.Color(e.light?.color || T.sun);
    this.sun.color.copy(col);
    const sunI = T.si * W.dim * (interior ? 0.85 : 1);
    this.sun.intensity = sunI;
    this.hemi.color.set(T.sky);
    this.hemi.groundColor.set(T.ground);
    this.hemi.intensity = (e.light?.ambient != null ? 0.25 + e.light.ambient * 0.6 : T.hemi) * (interior ? 0.7 : 1);
    const fogC = new THREE.Color(T.sky).lerp(new THREE.Color('#9a9ea4'), W.cloud * 0.6);
    if (interior) fogC.set(T.moon ? '#0b0c12' : '#2a241e');
    this.scene.fog.color.copy(fogC);
    this.scene.fog.density = interior ? 0.012 : (e.light?.fog != null ? Math.max(W.fog, Math.min(0.03, e.light.fog * 0.04)) : W.fog);
    this.scene.background = interior ? fogC.clone() : null;
    this.renderer.toneMappingExposure = T.exp * 0.92 * (W.cloud > 0.5 ? 1.1 : 1);
    this.grade = { sat: W.sat * (T.moon ? 0.7 : 1), warm: T.warm, contrast: 1.06 + (T.moon ? 0.04 : 0) };
    // Ortam haritası: B'nin HDRI'si (gerçek gökyüzü ışığı + arka plan) varsa o; yoksa Sky'dan PMREM.
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    const H = e.hdri;
    if (H && H.env) {
      this._pmremCache = this._pmremCache || new Map();
      let rt = this._pmremCache.get(H.env);
      if (!rt) { rt = this.pmrem.fromEquirectangular(H.env); this._pmremCache.set(H.env, rt); }
      const yaw = THREE.MathUtils.degToRad(H.yaw || 0);
      this.scene.environment = rt.texture;
      this.scene.environmentRotation.set(0, yaw, 0);
      this.scene.environmentIntensity = interior ? 0.35 : 1;
      if (!interior && H.bg) {
        this.scene.background = H.bg;
        this.scene.backgroundRotation.set(0, yaw, 0);
        this.scene.backgroundIntensity = H.bgExposure ?? 1;
      }
      if (H.sun && H.sun.dir) {
        const d = new THREE.Vector3(...H.sun.dir).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        this.sunDir = d;
        this.sun.color.set(H.sun.color || '#ffffff');
        this.sun.intensity = Math.min(3.2, Math.max(0.3, (H.sun.strength ?? 3) * 0.3)) * (interior ? 0.85 : 1);
      }
      this.hemi.intensity *= 0.35; // HDRI ortam ışığını verir
      if (H.fog) { this.scene.fog.density = interior ? 0.01 : H.fog[0]; this.scene.fog.color.set(H.fog[1]); }
      this.renderer.toneMappingExposure = interior ? 0.95 : 0.78;
    } else if (this.q.pmrem && !interior) {
      this.envRT = this.pmrem.fromScene(this.skyScene, 0, 0.1, 1000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = T.moon ? 0.15 : 0.45 * W.dim;
    } else {
      this.scene.environment = null;
      if (!interior) this.hemi.intensity *= 2.2; // ortam haritası yok (düşük kalite): gökyüzü ışığı telafisi
    }
    // Parçacıklar
    const want = new Set(e.particles || []);
    for (const p of W.parts) want.add(p);
    if (!e.particles && !interior && !W.parts.length && (e.time === 'day' || e.time === 'morning' || e.time === 'afternoon' || e.time === 'dawn')) want.add('dust');
    if (interior && !T.moon) want.add('dust');
    this.partWant = [...want].filter((k) => PART_DEF[k]);
    this._rebuildParticles();
    this.lightTint = T.moon ? 0.35 : 1;
  }

  _rebuildParticles() {
    for (const [k, p] of this.particles) { this.scene.remove(p); p.geometry.dispose(); p.material.dispose(); }
    this.particles.clear();
    if (!this.q || !this.partWant) return;
    for (const k of this.partWant) {
      const p = makeParticles(k, this.q.particles);
      this.particles.set(k, p);
      this.scene.add(p);
    }
    this.resize(this.w, this.h);
  }

  /** Konuşanın yüzü her zaman okunur: göz konumu + kamera konumuna göre anahtar/dolgu/kenar ışıkları. w: 0..1 (plan tipine göre). */
  portrait(eye, camPos, w) {
    this._portrait += ((w || 0) - this._portrait) * 0.15;
    const k = this._portrait;
    if (!eye || k < 0.01) { this.key.intensity = this.fillL.intensity = this.rim.intensity = 0; return; }
    const toCam = camPos.clone().sub(eye).setY(0).normalize();
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x);
    const night = this._env && /night|evening/.test(this._env.time || '') ? 1.6 : 1;
    const inter = this._env?.interior ? 1.25 : 1;
    const put = (l, dir, up, d, I) => {
      l.position.copy(eye).addScaledVector(dir, d).add(new THREE.Vector3(0, up, 0));
      l.target.position.copy(eye);
      l.intensity = I * k * night * inter;
    };
    put(this.key, toCam.clone().multiplyScalar(0.75).addScaledVector(side, 0.65).normalize(), 0.55, 1.5, 2.2);
    put(this.fillL, toCam.clone().multiplyScalar(0.8).addScaledVector(side, -0.6).normalize(), 0.1, 1.7, 0.9);
    put(this.rim, toCam.clone().multiplyScalar(-0.85).addScaledVector(side, -0.4).normalize(), 0.75, 1.4, 2.6);
  }

  /** Saç kartı / yaprak gibi alfa kesimli malzemelerde kenar yumuşatma (yalnızca MSAA'lı yüksek kalitede). */
  alphaCoverage(root) {
    const on = (this.q.msaa || 0) > 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      // Giysi/şapka/beden hariç: alfa kapsaması uzak mip'lerde kumaşı delip içini gösterebiliyor (geniş planda "yeleksiz").
      const part = o.userData?.part;
      const ok = on && (!part ? !o.isSkinnedMesh : /hair|brows|beard|mustache|lashes/.test(part));
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && m.alphaTest > 0 && m.alphaToCoverage !== ok) { m.alphaToCoverage = ok; m.needsUpdate = true; }
      }
    });
  }

  /** Kesmede / sarmada hareket bulanıklığı sıfırlanır. */
  cut() { this._cut = true; }

  /** Gölge kamerası odak çevresine oturur (keskin gölge). */
  fitShadow(center, radius) {
    const s = this.sun;
    const d = this.sunDir || new THREE.Vector3(0.4, 0.8, 0.2);
    s.position.copy(center).addScaledVector(d, 40);
    s.target.position.copy(center);
    const c = s.shadow.camera;
    const r = Math.max(4, radius);
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 90;
    c.updateProjectionMatrix();
  }

  setFocus(on, dist, scale = 1) {
    if (!this.bokeh) return;
    this.bokeh.enabled = !!on;
    if (on) {
      this.bokeh.uniforms.focus.value = dist;
      this.bokeh.uniforms.aperture.value = (0.0009 * scale) / Math.max(0.6, dist * 0.6);
    }
  }

  render(t) {
    for (const p of this.particles.values()) {
      const u = p.material.uniforms;
      u.uTime.value = t;
      u.uLight.value = this.lightTint ?? 1;
      this.camera.getWorldDirection(u.uCenter.value).multiplyScalar(u.uBox.value.x * 0.32).add(this.camera.position);
    }
    if (this.composer) {
      if (this.shafts) {
        const sp = this.camera.position.clone().addScaledVector(this.sunDir || new THREE.Vector3(0, 1, 0), 500).project(this.camera);
        const facing = this.camera.getWorldDirection(new THREE.Vector3()).dot(this.sunDir || new THREE.Vector3(0, 1, 0));
        const near = Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) / 1.6);
        const on = this._env?.interior ? 0 : Math.max(0, facing) * near * ((this.sunDir?.y ?? 1) < 0.85 ? 1 : 0.3);
        this.shafts.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
        this.shafts.uniforms.uOn.value = on;
      }
      if (this.mblur) {
        // Yalnızca dönme: görünüm matrisinin öteleme kısmı atılır.
        const v = this.camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
        const vp = this.camera.projectionMatrix.clone().multiply(v);
        const u = this.mblur.uniforms;
        u.uInv.value.copy(vp).invert();
        u.uPrev.value.copy(this._prevVP && !this._cut ? this._prevVP : vp);
        u.uAmt.value = this._cut ? 0 : 0.5;
        this._prevVP = vp;
        this._cut = false;
      }
      const g = this.gradePass.uniforms;
      g.uTime.value = t;
      g.uSat.value = this.grade.sat * (this.renderer.toneMapping === THREE.AgXToneMapping ? 1.14 : 1); // AgX doygunluğu düşürür; ten ve kumaş renkleri geri kazanılır
      g.uWarm.value = this.grade.warm;
      g.uContrast.value = this.grade.contrast;
      g.uGrain.value = this.q.grain ? 0.025 : 0;
      g.uCA.value = this.q.ca || 0;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
