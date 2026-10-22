{{flutter_js}}
{{flutter_build_config}}

// HADİ Web: Flutter'ın eski (artık kullanılmayan) service worker'ı kaydedilmez; HADİ'nin kendi küçük
// service worker'ı (sw.js) index.html'de kaydedilir. Yalnızca çevrimdışı uyarı sayfası içindir, uygulama dosyalarını
// önbelleğe almaz (yeni sürüm her açılışta gelir).
_flutter.loader.load();
