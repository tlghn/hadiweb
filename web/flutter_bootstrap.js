{{flutter_js}}
{{flutter_build_config}}

// HADİ Web: Flutter'ın eski (artık kullanılmayan) service worker'ı kaydedilmez; HADİ'nin kendi küçük
// service worker'ı (sw.js) index.html'de kaydedilir: çevrimdışı uyarı sayfası ve uygulama dosyalarının içerik parmak
// iziyle bir kez indirilmesi (değişen dosya yeniden iner; yeni sürüm her açılışta gelir).
// main.dart.js sürüm etiketiyle istenir (index.html › HADI_BUILD; önbellekteki eski kopya kullanılmaz).
// WebAssembly derlemesi (3 Kasım 2026; tools/build.ps1 --wasm): main.dart.wasm ve main.dart.mjs de aynı etiketle istenir.
if (window.HADI_BUILD && _flutter.buildConfig && _flutter.buildConfig.builds) {
  for (const b of _flutter.buildConfig.builds) {
    for (const k of ['mainJsPath', 'mainWasmPath', 'jsSupportRuntimePath']) {
      if (b[k]) b[k] += (b[k].indexOf('?') < 0 ? '?' : '&') + 'v=' + window.HADI_BUILD;
    }
  }
}
// 5 Kasım 2026: çizim yeniden CanvasKit (main.dart.js). skwasm (3 Kasım) telefonda harfleri bozuyordu; açınca düzeliyordu.
// Derleme ikisini de üretir; yalnızca bu satır seçer.
_flutter.loader.load({ config: { renderer: 'canvaskit' } });
