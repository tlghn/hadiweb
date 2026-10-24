// HADİ Web — canlı yayın / sesli oda filtreleri (window.hadiLiveFx). 24 Ekim 2026.
//
// Dart tarafı: hadimobile/lib/features/live/live_fx_web.dart (ilk kullanımda bu dosyayı <script> ile yükler; dosya yoksa
// web'de filtre düğmeleri gizlenir). Uygulamada (Android/iPhone) kullanılmaz.
//
// Nasıl yayına gider: navigator.mediaDevices.getUserMedia sarılır. Filtre açıkken LiveKit'in (ve yayın öncesi kontrolün)
// aldığı kamera / mikrofon izi burada işlenmiş izle değiştirilir; LiveKit işlenmiş izi YAYINLAR → izleyiciler filtreyi
// görür / duyar. Ayar değişince (set) çalışan işlem hattı anında güncellenir; filtre ilk kez açıldığında ya da tamamen
// kapatıldığında Dart tarafı izi yeniden başlatır (restartTrack) ki yeni yakalama bu sarmalayıcıdan geçsin.
//
//  • Ses (WebAudio): bas / tiz (raf filtreleri), ses efektleri: kalın, ince (sincap), robot (halka modülasyonu),
//    yankı (geri beslemeli gecikme), radyo (bant geçiren + hafif bozulma). Gürültü/yankı engelleme ve otomatik
//    kazanç tarayıcının kendi işlemcisidir (getUserMedia kısıtları; Dart tarafı LiveKit AudioCaptureOptions ile verir).
//    Perde kaydırma: Chris Wilson'ın "Jungle" yöntemi (iki modüle gecikme hattı + çapraz geçiş; AudioWorklet gerekmez).
//  • Görüntü (WebGL): ten yumuşatma (ten rengi maskeli kenar koruyan bulanıklık), parlaklık, kontrast, sıcaklık,
//    canlılık, renk ön ayarları (LUT benzeri: ton çarpanı + kaldırma + gri/sepya), vinyet, arka plan bulanıklığı ve
//    sanal arka plan (MediaPipe selfie segmenter, Apache-2.0; hadi_photo.js ile aynı CDN ve model).
// KVKK: görüntü ve ses yalnızca bu sekmede işlenir; hiçbir yere gönderilmez (yalnızca zaten yapılan yayına gider).
(function () {
  'use strict';
  if (window.hadiLiveFx) return;

  var MP_VER = '0.10.21';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var SELFIE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

  // Güncel ayarlar (Dart → set). Nötr değerler: işlem yok.
  var P = {
    audioOn: false, voice: 'none', bass: 0, treble: 0,
    videoOn: false, smooth: 0, bright: 0, contrast: 0, warm: 0, sat: 0, vign: 0,
    tint: [1, 1, 1], lift: [0, 0, 0], gray: 0, sepia: 0, bg: 'none', bgA: [0.1, 0.2, 0.35], bgB: [0.05, 0.08, 0.15],
  };
  var audioChains = [];
  var videoChains = [];
  var origGUM = null;

  // ------------------------------------------------------------------ yetenekler

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }
  function hasAudio() { return !!(window.AudioContext || window.webkitAudioContext); }
  function hasCapture() {
    try { return typeof document.createElement('canvas').captureStream === 'function'; } catch (e) { return false; }
  }
  var CAPS = {
    audio: hasAudio() && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    video: hasWebGL() && hasCapture(),
    background: false, // segmenter yüklenince true
  };

  // ------------------------------------------------------------------ ses

  var actx = null;
  function audioCtx() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      actx = new C({ latencyHint: 'interactive' });
    }
    if (actx.state === 'suspended') actx.resume().catch(function () {});
    return actx;
  }

  function fadeBuffer(ctx, active, fade) {
    var sr = ctx.sampleRate, l1 = Math.floor(active * sr), l2 = Math.floor((active - 2 * fade) * sr), len = l1 + l2;
    var b = ctx.createBuffer(1, len, sr), p = b.getChannelData(0), fl = fade * sr, f1 = fl, f2 = l1 - fl;
    for (var i = 0; i < l1; i++) p[i] = i < f1 ? Math.sqrt(i / fl) : (i >= f2 ? Math.sqrt(1 - (i - f2) / fl) : 1);
    for (var j = l1; j < len; j++) p[j] = 0;
    return b;
  }
  function delayBuffer(ctx, active, fade, up) {
    var sr = ctx.sampleRate, l1 = Math.floor(active * sr), l2 = Math.floor((active - 2 * fade) * sr), len = l1 + l2;
    var b = ctx.createBuffer(1, len, sr), p = b.getChannelData(0);
    for (var i = 0; i < l1; i++) p[i] = up ? (l1 - i) / len : i / l1;
    for (var j = l1; j < len; j++) p[j] = 0;
    return b;
  }

  /** Perde kaydırıcı ("Jungle"): mult < 0 kalın, > 0 ince. */
  function pitchShifter(ctx, mult) {
    var delayTime = 0.1, fadeTime = 0.05, bufferTime = 0.1;
    var input = ctx.createGain(), output = ctx.createGain();
    var down = delayBuffer(ctx, bufferTime, fadeTime, false), up = delayBuffer(ctx, bufferTime, fadeTime, true);
    var mods = [down, down, up, up].map(function (buf) { var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s; });
    var mg = mods.map(function () { return ctx.createGain(); });
    var modGain1 = ctx.createGain(), modGain2 = ctx.createGain();
    var d1 = ctx.createDelay(), d2 = ctx.createDelay();
    mods.forEach(function (m, i) { m.connect(mg[i]); });
    mg[0].connect(modGain1); mg[1].connect(modGain2); mg[2].connect(modGain1); mg[3].connect(modGain2);
    modGain1.connect(d1.delayTime); modGain2.connect(d2.delayTime);
    var fb = fadeBuffer(ctx, bufferTime, fadeTime);
    var f1 = ctx.createBufferSource(), f2 = ctx.createBufferSource();
    f1.buffer = fb; f2.buffer = fb; f1.loop = true; f2.loop = true;
    var mix1 = ctx.createGain(), mix2 = ctx.createGain();
    mix1.gain.value = 0; mix2.gain.value = 0;
    f1.connect(mix1.gain); f2.connect(mix2.gain);
    input.connect(d1); input.connect(d2);
    d1.connect(mix1); d2.connect(mix2);
    mix1.connect(output); mix2.connect(output);
    var t = ctx.currentTime + 0.05, t2 = t + bufferTime - fadeTime;
    mods[0].start(t); mods[1].start(t2); mods[2].start(t); mods[3].start(t2); f1.start(t); f2.start(t2);
    var upOn = mult > 0;
    mg[0].gain.value = upOn ? 0 : 1; mg[1].gain.value = upOn ? 0 : 1; mg[2].gain.value = upOn ? 1 : 0; mg[3].gain.value = upOn ? 1 : 0;
    modGain1.gain.value = 0.5 * delayTime * Math.abs(mult);
    modGain2.gain.value = 0.5 * delayTime * Math.abs(mult);
    return {
      input: input, output: output,
      stop: function () { mods.concat([f1, f2]).forEach(function (s) { try { s.stop(); } catch (e) {} }); },
    };
  }

  function distortionCurve(k) {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return c;
  }

  /** Efekt düğümü: {input, output, stop}. */
  function effect(ctx, voice) {
    var inp = ctx.createGain(), out = ctx.createGain(), stops = [];
    switch (voice) {
      case 'deep':
      case 'bright': {
        var ps = pitchShifter(ctx, voice === 'deep' ? -0.45 : 0.6);
        inp.connect(ps.input); ps.output.connect(out); stops.push(ps.stop);
        break;
      }
      case 'robot': {
        var ring = ctx.createGain(); ring.gain.value = 0;
        var osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 55;
        osc.connect(ring.gain); osc.start();
        var dry = ctx.createGain(); dry.gain.value = 0.25;
        inp.connect(ring); ring.connect(out); inp.connect(dry); dry.connect(out);
        stops.push(function () { try { osc.stop(); } catch (e) {} });
        break;
      }
      case 'echo': {
        var dl = ctx.createDelay(1.0); dl.delayTime.value = 0.26;
        var fbk = ctx.createGain(); fbk.gain.value = 0.38;
        var wet = ctx.createGain(); wet.gain.value = 0.5;
        inp.connect(out); inp.connect(dl); dl.connect(fbk); fbk.connect(dl); dl.connect(wet); wet.connect(out);
        break;
      }
      case 'radio': {
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
        var ws = ctx.createWaveShaper(); ws.curve = distortionCurve(6); ws.oversample = '2x';
        var g = ctx.createGain(); g.gain.value = 0.8;
        inp.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(g); g.connect(out);
        break;
      }
      default:
        inp.connect(out);
    }
    return { input: inp, output: out, stop: function () { stops.forEach(function (f) { f(); }); } };
  }

  function makeAudioChain(srcTrack) {
    var ctx = audioCtx();
    var src = ctx.createMediaStreamSource(new MediaStream([srcTrack]));
    var bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 220;
    var treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3200;
    var dest = ctx.createMediaStreamDestination();
    src.connect(bass); bass.connect(treble);
    var chain = { src: srcTrack, fx: null, voice: null, dest: dest, track: dest.stream.getAudioTracks()[0] };
    chain.apply = function () {
      bass.gain.setTargetAtTime(P.bass * 12, ctx.currentTime, 0.03);
      treble.gain.setTargetAtTime(P.treble * 12, ctx.currentTime, 0.03);
      if (chain.voice !== P.voice) {
        if (chain.fx) { try { treble.disconnect(); chain.fx.output.disconnect(); } catch (e) {} chain.fx.stop(); }
        chain.fx = effect(ctx, P.voice);
        treble.connect(chain.fx.input);
        chain.fx.output.connect(dest);
        chain.voice = P.voice;
      }
    };
    chain.apply();
    chain.dispose = function () {
      try { src.disconnect(); } catch (e) {}
      if (chain.fx) chain.fx.stop();
      try { srcTrack.stop(); } catch (e) {}
      audioChains = audioChains.filter(function (c) { return c !== chain; });
    };
    wrapStop(chain.track, chain.dispose, srcTrack);
    audioChains.push(chain);
    return chain.track;
  }

  /** İşlenmiş iz durdurulunca / etkisizleştirilince kaynağı da yönet (LiveKit mute → stop / enabled). */
  function wrapStop(track, dispose, srcTrack) {
    var stop = track.stop.bind(track);
    track.stop = function () { stop(); dispose(); };
    try {
      Object.defineProperty(track, 'enabled', {
        configurable: true,
        get: function () { return srcTrack.enabled; },
        set: function (v) { srcTrack.enabled = v; },
      });
    } catch (e) {}
    // Kaynak aygıtın etiketi / ayarları (LiveKit cihaz adı için okur).
    try {
      var gs = srcTrack.getSettings ? srcTrack.getSettings.bind(srcTrack) : null;
      var own = track.getSettings ? track.getSettings.bind(track) : null;
      if (gs) track.getSettings = function () { var a = own ? own() : {}; var b = gs(); for (var k in b) if (!(k in a) || k === 'deviceId' || k === 'facingMode') a[k] = b[k]; return a; };
      Object.defineProperty(track, 'label', { configurable: true, get: function () { return srcTrack.label; } });
    } catch (e) {}
  }

  // ------------------------------------------------------------------ görüntü (WebGL)

  var VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision mediump float;',
    'uniform sampler2D f,m;uniform vec2 px;varying vec2 v;',
    'uniform float sm,br,ct,wm,st,vg,gr,sp,hm,bgm;uniform vec3 tn,lf,ba,bb;',
    'float skin(vec3 c){float cb=-0.1687*c.r-0.3313*c.g+0.5*c.b;float cr=0.5*c.r-0.4187*c.g-0.0813*c.b;',
    ' return smoothstep(0.015,0.05,cr)*(1.-smoothstep(0.17,0.24,cr))*smoothstep(-0.22,-0.15,cb)*(1.-smoothstep(0.0,0.05,cb));}',
    'vec3 bil(vec2 uv,vec3 c){vec3 s=c;float w=1.;',
    ' for(int i=0;i<12;i++){float a=float(i)*0.5236;for(int k=1;k<3;k++){float r=float(k)*3.;',
    '  vec3 q=texture2D(f,uv+vec2(cos(a),sin(a))*px*r).rgb;float d=distance(q,c);float wi=exp(-d*d*60.);s+=q*wi;w+=wi;}}',
    ' return s/w;}',
    'vec3 blr(vec2 uv){vec3 s=vec3(0.);float w=0.;',
    ' for(int i=0;i<16;i++){float a=float(i)*0.3927;for(int k=1;k<4;k++){float r=float(k)*7.;',
    '  s+=texture2D(f,uv+vec2(cos(a),sin(a))*px*r).rgb;w+=1.;}}',
    ' return s/w;}',
    'void main(){vec3 c=texture2D(f,v).rgb;',
    ' if(sm>0.001){c=mix(c,bil(v,c),sm*skin(c));}',
    ' if(bgm>0.5&&hm>0.5){float k=smoothstep(0.35,0.75,texture2D(m,vec2(v.x,v.y)).r);',
    '  vec3 bg=bgm<1.5?blr(v):mix(bb,ba,v.y);c=mix(bg,c,k);}',
    ' c+=br*0.22;c=(c-0.5)*(1.+ct*0.55)+0.5;c.r+=wm*0.06;c.b-=wm*0.07;',
    ' float g=dot(c,vec3(0.299,0.587,0.114));c=mix(vec3(g),c,1.+st);',
    ' c=c*tn+lf;g=dot(c,vec3(0.299,0.587,0.114));c=mix(c,vec3(g),gr);',
    ' c=mix(c,vec3(g*1.07+0.04,g*0.9+0.03,g*0.72),sp);',
    ' vec2 d=v-0.5;c*=1.-vg*dot(d,d)*1.6;',
    ' gl_FragColor=vec4(clamp(c,0.,1.),1.);}',
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function videoNeutral() {
    return P.smooth < 0.01 && Math.abs(P.bright) < 0.01 && Math.abs(P.contrast) < 0.01 && Math.abs(P.warm) < 0.01 &&
      Math.abs(P.sat) < 0.01 && P.vign < 0.01 && P.gray < 0.01 && P.sepia < 0.01 && P.bg === 'none' &&
      P.tint[0] === 1 && P.tint[1] === 1 && P.tint[2] === 1 && !P.lift[0] && !P.lift[1] && !P.lift[2];
  }

  // Arka plan bölütleyici (isteğe bağlı; yüklenemezse arka plan seçenekleri etkisiz).
  var segP = null;
  function segmenter() {
    if (!segP) {
      segP = (async function () {
        var mod = await import(MP_BASE + '/vision_bundle.mjs');
        var fs = await mod.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
        var s = await mod.ImageSegmenter.createFromOptions(fs, {
          baseOptions: { modelAssetPath: SELFIE, delegate: 'GPU' },
          runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
        }).catch(function () {
          return mod.ImageSegmenter.createFromOptions(fs, {
            baseOptions: { modelAssetPath: SELFIE, delegate: 'CPU' },
            runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
          });
        });
        CAPS.background = true;
        return s;
      })();
      segP.catch(function () { segP = null; });
    }
    return segP;
  }

  function makeVideoChain(srcTrack) {
    var st = srcTrack.getSettings ? srcTrack.getSettings() : {};
    var w = st.width || 1280, h = st.height || 720, fps = Math.min(30, st.frameRate || 30);
    var video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.autoplay = true;
    video.srcObject = new MediaStream([srcTrack]);
    video.play().catch(function () {});
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false }) || canvas.getContext('experimental-webgl');
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    function tex(unit) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }
    var tf = tex(0), tm = tex(1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    var U = {};
    ['f', 'm', 'px', 'sm', 'br', 'ct', 'wm', 'st', 'vg', 'gr', 'sp', 'hm', 'bgm', 'tn', 'lf', 'ba', 'bb'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.f, 0); gl.uniform1i(U.m, 1);

    // Bölütleme küçük bir tuvalde (256×144) yapılır; maske 8 bit doku olarak yüklenir.
    var segW = 256, segH = Math.max(1, Math.round(256 * h / w));
    var small = document.createElement('canvas'); small.width = segW; small.height = segH;
    var sctx = small.getContext('2d', { willReadFrequently: false });
    var mask8 = new Uint8Array(segW * segH), hasMask = false, segBusy = false, frame = 0;
    var seg = null;

    var out = canvas.captureStream(fps);
    var track = out.getVideoTracks()[0];
    var alive = true, timer = null;

    function draw() {
      if (!alive) return;
      if (video.readyState >= 2) {
        var vw = video.videoWidth || w, vh = video.videoHeight || h;
        if (vw !== canvas.width || vh !== canvas.height) {
          canvas.width = vw; canvas.height = vh; gl.viewport(0, 0, vw, vh);
          segH = Math.max(1, Math.round(256 * vh / vw)); small.height = segH; mask8 = new Uint8Array(segW * segH); hasMask = false;
        }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tf);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        // Arka plan: her 2 karede bir maske.
        if (P.bg !== 'none') {
          if (!seg && !segBusy) { segBusy = true; segmenter().then(function (s) { seg = s; segBusy = false; }, function () { segBusy = false; }); }
          if (seg && (frame++ & 1) === 0) {
            try {
              sctx.drawImage(video, 0, 0, segW, segH);
              var r = seg.segmentForVideo(small, performance.now());
              var cm = r && r.confidenceMasks && r.confidenceMasks[0];
              if (cm) {
                var fa = cm.getAsFloat32Array();
                // Maske görüntüyle aynı yönde; doku Y ekseni çevrildiğinden satırları ters yaz.
                for (var y = 0; y < segH; y++) {
                  var src = y * segW, dst = (segH - 1 - y) * segW;
                  for (var x = 0; x < segW; x++) mask8[dst + x] = Math.max(0, Math.min(255, fa[src + x] * 255)) | 0;
                }
                cm.close && cm.close();
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tm);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, segW, segH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask8);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                hasMask = true;
              }
            } catch (e) { /* bir kare atlanır */ }
          }
        }
        gl.uniform2f(U.px, 1 / canvas.width, 1 / canvas.height);
        gl.uniform1f(U.sm, P.smooth); gl.uniform1f(U.br, P.bright); gl.uniform1f(U.ct, P.contrast); gl.uniform1f(U.wm, P.warm);
        gl.uniform1f(U.st, P.sat); gl.uniform1f(U.vg, P.vign); gl.uniform1f(U.gr, P.gray); gl.uniform1f(U.sp, P.sepia);
        gl.uniform1f(U.hm, hasMask ? 1 : 0); gl.uniform1f(U.bgm, P.bg === 'blur' ? 1 : (P.bg === 'none' ? 0 : 2));
        gl.uniform3fv(U.tn, P.tint); gl.uniform3fv(U.lf, P.lift); gl.uniform3fv(U.ba, P.bgA); gl.uniform3fv(U.bb, P.bgB);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      schedule();
    }
    // Görünür sekmede ekran yenilemesiyle; arka planda (rAF durur) zamanlayıcıyla devam.
    function schedule() {
      if (!alive) return;
      if (document.hidden || !video.requestVideoFrameCallback) timer = setTimeout(draw, 1000 / fps);
      else video.requestVideoFrameCallback(function () { draw(); });
    }
    schedule();

    var chain = { src: srcTrack, track: track };
    chain.dispose = function () {
      alive = false; clearTimeout(timer);
      try { srcTrack.stop(); } catch (e) {}
      try { video.srcObject = null; } catch (e) {}
      videoChains = videoChains.filter(function (c) { return c !== chain; });
    };
    wrapStop(track, chain.dispose, srcTrack);
    videoChains.push(chain);
    return track;
  }

  // ------------------------------------------------------------------ getUserMedia sarmalayıcı

  function install() {
    if (origGUM || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return !!origGUM;
    origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      return origGUM(constraints).then(function (stream) {
        try {
          var wantA = P.audioOn && CAPS.audio, wantV = P.videoOn && CAPS.video && !videoNeutral();
          if (!wantA && !wantV) return stream;
          var tracks = [];
          stream.getAudioTracks().forEach(function (t) { tracks.push(wantA ? makeAudioChain(t) : t); });
          stream.getVideoTracks().forEach(function (t) { tracks.push(wantV ? makeVideoChain(t) : t); });
          return new MediaStream(tracks);
        } catch (e) {
          console.warn('hadiLiveFx', e);
          return stream;
        }
      });
    };
    return true;
  }

  /** Ayarları uygula (JSON). Dönen: { audio, video } — işlenen iz var mı (yoksa Dart izi yeniden başlatır). */
  function set(json) {
    try {
      var n = JSON.parse(json);
      for (var k in n) if (Object.prototype.hasOwnProperty.call(P, k)) P[k] = n[k];
    } catch (e) {}
    audioChains.forEach(function (c) { try { c.apply(); } catch (e) {} });
    if (P.bg !== 'none') segmenter().catch(function () {});
    return { audio: audioChains.length > 0, video: videoChains.length > 0 };
  }

  window.hadiLiveFx = {
    caps: function () { return { audio: CAPS.audio, video: CAPS.video, background: CAPS.video }; },
    install: install,
    set: set,
    /** İşlenen canlı izler var mı. */
    active: function () { return { audio: audioChains.length > 0, video: videoChains.length > 0 }; },
    /** Video işlem hattı nötr mü (hiç filtre yok). */
    videoNeutral: videoNeutral,
  };
})();
