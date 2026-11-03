{{flutter_js}}
{{flutter_build_config}}

// HADİ Web: Flutter'ın eski (artık kullanılmayan) service worker'ı kaydedilmez; HADİ'nin kendi küçük
// service worker'ı (sw.js) index.html'de kaydedilir: çevrimdışı uyarı sayfası ve uygulama dosyalarının içerik parmak
// iziyle bir kez indirilmesi (değişen dosya yeniden iner; yeni sürüm her açılışta gelir).
// main.dart.js sürüm etiketiyle istenir (index.html › HADI_BUILD; önbellekteki eski kopya kullanılmaz).
if (window.HADI_BUILD && _flutter.buildConfig && _flutter.buildConfig.builds) {
  for (const b of _flutter.buildConfig.builds) {
    if (b.mainJsPath) b.mainJsPath += (b.mainJsPath.indexOf('?') < 0 ? '?' : '&') + 'v=' + window.HADI_BUILD;
  }
}
_flutter.loader.load();
