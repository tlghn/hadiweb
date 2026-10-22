// HADİ Web — fotoğraf düzenleyicisinin tarayıcı yardımcıları (window.hadiPhoto).
//
// Dart tarafı: hadimobile/lib/core/web_photo_web.dart (ilk kullanımda bu dosyayı <script> ile yükler; dosya yoksa
// düzenleyici saf Dart yollarıyla çalışır). Uygulamada (Android/iPhone) kullanılmaz.
//
//  • normalize: tarayıcı çözücüsüyle aç (EXIF yönü uygulanır; Safari'de HEIC de açılır), en uzun kenarı sınırla,
//    JPEG olarak yeniden kodla → EXIF/konum dahil tüm meta veri silinir. Düzenleyicinin tabanı bu baytlardır.
//  • encodeJpeg: ham RGBA → JPEG (OffscreenCanvas, tarayıcının yerel kodlayıcısı; Dart kodlayıcısından ~20× hızlı).
//  • detect: MediaPipe Tasks Vision (Apache-2.0) — Face Landmarker (478 nokta, ifade katsayıları, baş dönüşü) ve
//    kişi bölütleme (selfie segmenter). Güzelleştir ve Yüz efekti bunu kullanır (uygulamada ML Kit'in yerine).
//  • person: yalnızca kişi maskesi (Çıkartma yap › Otomatik kesim).
//  • magic: Interactive Segmenter ("magic touch"; uygulamadaki Nesne sil › Sihirli dokunuşla aynı model).
// KVKK: görüntüler yalnızca bu sekmede işlenir; hiçbir yere gönderilmez. Kütüphane ve modeller herkese açık CDN'den
// (cdn.jsdelivr.net, storage.googleapis.com) indirilir; CSP (web/_headers ve functions/[[path]].js) buna izin verir.
(function () {
  'use strict';
  if (window.hadiPhoto) return;

  var MP_VER = '0.10.21';
  var MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER;
  var MODELS = {
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    selfie: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    magic: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite',
  };

  // ------------------------------------------------------------------ tuval yardımcıları

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function toBlob(c, type, quality) {
    if (c.convertToBlob) return c.convertToBlob({ type: type, quality: quality });
    return new Promise(function (res, rej) {
      c.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob')); }, type, quality);
    });
  }

  async function blobBytes(b) {
    return new Uint8Array(await b.arrayBuffer());
  }

  async function decode(bytes) {
    var blob = new Blob([bytes]);
    try {
      // EXIF yönü uygulanır (Chrome/Edge/Firefox/Safari).
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) {
      // Bazı biçimler (ör. Safari'de HEIC) yalnızca <img> ile açılır.
      var url = URL.createObjectURL(blob);
      try {
        var img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
      } finally {
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      }
    }
  }

  function dims(img) {
    return [img.naturalWidth || img.width, img.naturalHeight || img.height];
  }

  /// Fotoğrafı dik, sınırlı boyutlu, meta verisiz JPEG'e çevirir. Dönen: {bytes, width, height} ya da hata.
  async function normalize(bytes, maxSide, quality) {
    var img = await decode(bytes);
    var d = dims(img);
    var w = d[0], h = d[1];
    if (!w || !h) throw new Error('boş görüntü');
    var s = Math.min(1, (maxSide || 4096) / Math.max(w, h));
    var ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(h * s));
    var c = makeCanvas(ow, oh);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (s < 0.5 && typeof createImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      // Büyük küçültmede tarayıcının yüksek kaliteli yeniden örneklemesi (kademelenme olmasın).
      try {
        var r = await createImageBitmap(img, { resizeWidth: ow, resizeHeight: oh, resizeQuality: 'high' });
        ctx.drawImage(r, 0, 0);
        r.close && r.close();
      } catch (e) {
        ctx.drawImage(img, 0, 0, ow, oh);
      }
    } else {
      ctx.drawImage(img, 0, 0, ow, oh);
    }
    if (img.close) img.close();
    var out = await blobBytes(await toBlob(c, 'image/jpeg', quality == null ? 0.95 : quality));
    return { bytes: out, width: ow, height: oh };
  }

  /// Ham RGBA (w×h) → JPEG baytları.
  async function encodeJpeg(rgba, w, h, quality) {
    var c = makeCanvas(w, h);
    var ctx = c.getContext('2d');
    var data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
    ctx.putImageData(data, 0, 0);
    return blobBytes(await toBlob(c, 'image/jpeg', quality == null ? 0.92 : quality));
  }

  // ------------------------------------------------------------------ MediaPipe

  var visionP = null, faceP = null, selfieP = null, magicP = null;

  function vision() {
    if (!visionP) {
      visionP = (async function () {
        var mod = await import(MP_BASE + '/vision_bundle.mjs');
        var fileset = await mod.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
        return { mod: mod, fileset: fileset };
      })();
      visionP.catch(function () { visionP = null; });
    }
    return visionP;
  }

  function lazy(get, set, make) {
    var p = get();
    if (!p) {
      p = make();
      set(p);
      p.catch(function () { set(null); });
    }
    return p;
  }

  function faceLandmarker() {
    return lazy(function () { return faceP; }, function (v) { faceP = v; }, async function () {
      var v = await vision();
      return v.mod.FaceLandmarker.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: MODELS.face, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 4,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    });
  }

  function selfieSegmenter() {
    return lazy(function () { return selfieP; }, function (v) { selfieP = v; }, async function () {
      var v = await vision();
      return v.mod.ImageSegmenter.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: MODELS.selfie, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    });
  }

  function magicSegmenter() {
    return lazy(function () { return magicP; }, function (v) { magicP = v; }, async function () {
      var v = await vision();
      return v.mod.InteractiveSegmenter.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: MODELS.magic, delegate: 'CPU' },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    });
  }

  function imageData(rgba, w, h) {
    return new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
  }

  var BLEND = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight'];

  /// Yüzler (ve istenirse kişi maskesi). Dönen:
  /// {faces: [{pts: Float32Array(n*3, normalize x,y,z), blend: {ad: skor}, matrix: Float32Array(16)|null}],
  ///  seg: {w, h, conf: Float32Array}|null}
  async function detect(rgba, w, h, wantSeg) {
    var fl = await faceLandmarker();
    var img = imageData(rgba, w, h);
    var r = fl.detect(img);
    var faces = [];
    var list = r.faceLandmarks || [];
    for (var i = 0; i < list.length; i++) {
      var lm = list[i];
      var pts = new Float32Array(lm.length * 3);
      for (var j = 0; j < lm.length; j++) {
        pts[j * 3] = lm[j].x;
        pts[j * 3 + 1] = lm[j].y;
        pts[j * 3 + 2] = lm[j].z;
      }
      var blend = {};
      var bs = r.faceBlendshapes && r.faceBlendshapes[i];
      if (bs && bs.categories) {
        for (var k = 0; k < bs.categories.length; k++) {
          var c = bs.categories[k];
          if (BLEND.indexOf(c.categoryName) >= 0) blend[c.categoryName] = c.score;
        }
      }
      var mx = r.facialTransformationMatrixes && r.facialTransformationMatrixes[i];
      faces.push({ pts: pts, blend: blend, matrix: mx && mx.data ? Float32Array.from(mx.data) : null });
    }
    var seg = null;
    if (wantSeg && faces.length) {
      try {
        var ss = await selfieSegmenter();
        var sr = ss.segment(img);
        try {
          var masks = sr.confidenceMasks || [];
          var m = masks[masks.length - 1];
          if (m) seg = { w: m.width, h: m.height, conf: m.getAsFloat32Array().slice() };
        } finally {
          sr.close && sr.close();
        }
      } catch (e) {
        console.warn('hadiPhoto: kişi bölütleme olmadı', e);
      }
    }
    return { faces: faces, seg: seg };
  }

  /// Yalnızca kişi maskesi (Çıkartma yap › Otomatik kesim). Dönen: {w, h, conf} ya da null.
  async function person(rgba, w, h) {
    var ss = await selfieSegmenter();
    var sr = ss.segment(imageData(rgba, w, h));
    try {
      var masks = sr.confidenceMasks || [];
      var m = masks[masks.length - 1];
      return m ? { w: m.width, h: m.height, conf: m.getAsFloat32Array().slice() } : null;
    } finally {
      sr.close && sr.close();
    }
  }

  /// Sihirli dokunuş: RGBA (w×h) ve normalize nokta → w×h olasılık (Float32Array).
  async function magic(rgba, w, h, x, y) {
    var ms = await magicSegmenter();
    var r = ms.segment(imageData(rgba, w, h), { keypoint: { x: x, y: y } });
    try {
      var masks = r.confidenceMasks || [];
      var m = masks[0];
      if (!m) return null;
      var f = m.getAsFloat32Array();
      if (m.width === w && m.height === h) return f.slice();
      // Farklı boyuttaysa en yakın komşuyla w×h'e.
      var out = new Float32Array(w * h);
      for (var yy = 0; yy < h; yy++) {
        var sy = Math.min(m.height - 1, Math.floor((yy + 0.5) * m.height / h));
        for (var xx = 0; xx < w; xx++) {
          out[yy * w + xx] = f[sy * m.width + Math.min(m.width - 1, Math.floor((xx + 0.5) * m.width / w))];
        }
      }
      return out;
    } finally {
      r.close && r.close();
    }
  }

  /// Arka planda modelleri hazırlar (araç açılınca; beklemek gerekmez).
  function warm(kind) {
    var p = kind === 'magic' ? magicSegmenter() : faceLandmarker();
    p.catch(function (e) { console.warn('hadiPhoto: model hazırlanamadı', e); });
    return p.then(function () { return true; }, function () { return false; });
  }

  window.hadiPhoto = { version: 1, normalize: normalize, encodeJpeg: encodeJpeg, detect: detect, person: person, magic: magic, warm: warm };
})();
