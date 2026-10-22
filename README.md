# HADİ Web

Üye uygulamasının web sürümü. Aynı kod tabanından derlenir (Flutter Web): ekranlar, veri katmanı ve tema `../hadimobile` paketinden (`hadi`) gelir. Hesap, mesajlar, etkinlikler, Elmas ve Akçe bakiyesi uygulamayla aynıdır. **https://hadisosyal.com** adresinde, kökte ve **izole** olarak yayınlanır: kendi Cloudflare Pages projesi (`hadi-web`, ücretsiz plan) vardır. Kulüp sitesi (`D:\hadietkinlikkulubu`, hadietkinlikkulubu.com) ayrı bir projedir; HADİ Web ona hiçbir şey yazmaz.

- **Giriş:** Yalnızca cep telefonu (SMS kodu). Web'de Firebase görünmez reCAPTCHA kullanır; e-posta ile giriş web'de gösterilmez.
- **Yerleşim:** Mobil öncelikli. Telefonda (< 640 px) tam ekran. Tablet ve masaüstünde uygulama okunur bir sütunda (480 px) ortalanır; geniş masaüstünde (≥ 1100 px) solda HADİ tanıtımı ve "Uygulamayı indir" bağlantısı görünür (`lib/app/web_frame.dart`).
- **Web uyumu kuralı** (`hadimobile/lib/core/web_support.dart`):
  1. Özellik web'de de tam çalışır.
  2. Olmuyorsa eşdeğer yöntem kullanılır (telefon girişi için reCAPTCHA, mağaza yerine web ödeme kanalı, dosyadan seçme).
  3. O da olmuyorsa düğme hiç gösterilmez.
  4. Gösterilmesi gerekiyorsa dokununca nazik bir "Bu özellik uygulamada" penceresi açılır (uygulamayı indirme bağlantısıyla).
- **Ödemeler:** Web bir mağaza derlemesi değildir. Elmas paketleri, yönetimde web için açılan ödeme kanallarıyla (`showInApp.web`, ör. kart) satılır. Premium web'de Elmas ile alınır; aylık/yıllık mağaza aboneliği uygulamadan başlatılır. Kartla ödemeler (etkinlik, bağış vb.) iyzico sayfasında açılır.
- **Kamera, canlı yayın ve canlı destek web'de de var:** tarayıcı izin ister; kamera sade çekim ekranıyla açılır (`hadimobile/lib/features/camera/web_camera_screen.dart`). Canlı yayın ve sesli oda başlatma / sesli odada konuşma LiveKit web istemcisiyle çalışır: ücret alınmadan önce kamera/mikrofon izni ve cihaz seçimi yapılır (`features/live/live_web_preflight.dart`), yayında kamera/mikrofon değiştirilebilir, yayın açıkken sekmeyi kapatmadan önce tarayıcı onay ister; yapay zekâ denetimi sunucudaki denetim ajanıyla uygulamadakiyle aynıdır (`moderation_agent/`). HADİ Destek sesli sohbeti tarayıcı mikrofonu ve Web Audio ile çalışır (`features/support/live/live_audio_backend_web.dart`, `live_socket_web.dart`).
- **Fotoğraf düzenleyici web'de tam:** gönderi, story, An, snap ve profil fotoğrafında uygulamadaki düzenleyicinin aynısı açılır (kırp/döndür/düzelt, filtreler, ayarlar, yazı, çıkartma/GIF/Çıkartma yap, çizim, çerçeve, katmanlar, geri al/yinele, karşılaştır, Güzelleştir, Yüz efekti, AI araçları, Nesne sil › Sihirli dokunuş). Yüz bulma/bölütleme tarayıcıda MediaPipe Tasks Vision ile (`web/hadi_photo.js`; kütüphane cdn.jsdelivr.net, modeller storage.googleapis.com — CSP buna izinli), fotoğraf sekmeden çıkmaz. Seçilen fotoğraf tarayıcıda dik çevrilir (EXIF yönü), en uzun kenar 4096 px'e sınırlanır ve meta verisi (konum dahil) silinir; çıktı uygulamadakiyle aynı kurallarla JPEG (kalite 92). Masaüstü: fare tekerleği katmanı büyütür (Shift: döndürür), Ctrl/⌘+Z/Y geri al/yinele, Delete siler, oklar kaydırır, + / − ölçekler, [ ] döndürür, Esc geri. Video içeren seçimde sade önizleme açılır (video düzenleme uygulamada).
- **Web'de olmayanlar:** Video düzenleyici, kamerada canlı filtre/yüz efekti, kimlik çipi (NFC) doğrulaması, sağlık verileri, rehber, uygulama kilidi, ekran görüntüsü koruması, telefon bildirimleri (bildirimler uygulama içi Bildirimler ekranında görünür). Yüz korumalı medya web'de her zaman "korunan yüzler bulanık" sürümüyle görünür.

## Ana ekrana ekleme (PWA)

- Telefonda: giriş yapmış üyeye, biraz kullandıktan sonra bir kez "HADİ'yi ana ekrana ekle" kartı çıkar (alt menünün üstünde). Android/Chrome'da tarayıcının yükleme penceresi açılır; iPhone'da Paylaş › Ana Ekrana Ekle adımları gösterilir. "Şimdi değil" denirse 14 gün sorulmaz; ana ekrandan açıldıysa hiç görünmez.
- Masaüstünde (Chrome/Edge): soldaki tanıtımda "Bu bilgisayara yükle" düğmesi.
- Ana ekrandaki uygulama `https://hadisosyal.com/` adresini açar (`manifest.json` › `start_url`).
- Ana ekrandan HADİ kendi penceresinde, tam ekran açılır; simgeye basılı tutunca Etkinlikler, Mesajlar, Bildirimler kısayolları.
- `web/sw.js` yalnızca çevrimdışı açılışta "İnternet bağlantın yok" sayfasını (`web/offline.html`) gösterir; uygulama dosyalarını ve üye verisini önbelleğe almaz, her açılışta en yeni sürüm gelir.

## Klasör düzeni

```
lib/main.dart              Firebase (web), web uyumu, uygulama kökü (HadiApp)
lib/app/web_frame.dart     geniş ekran çerçevesi ve tanıtım
lib/app/install_nudge.dart "Ana ekrana ekle" kartı;  lib/app/pwa.dart: tarayıcı köprüsü
lib/app/web_options.dart   Firebase web ayarları (derlemede web_config.json'dan)
web/index.html             açılış ekranı, PWA köprüsü, service worker kaydı
web/manifest.json          ana ekrana ekleme (PWA): ad, simgeler, kısayollar
web/sw.js, offline.html    çevrimdışı açılışta "bağlantı yok" sayfası (önbellek yok)
web/_headers               Cloudflare güvenlik başlıkları (CSP, izinler, noindex, önbellek)
web/_routes.json           Function'ın çalıştığı yollar (paylaşım, /hp/, kampanyalar, şeffaflık)
web/_redirects             tanıtım sayfaları → hadietkinlikkulubu.com
web/robots.txt             uygulama kapalı, yasal metinler açık
functions/[[path]].js      paylaşım bağlantıları (kişi → uygulama, bot → önizleme sayfası) + sitenin Function'ı
site/, site_functions/     kulüp sitesinden alınan sayfaların anlık görüntüsü (tools/sync_site.ps1)
tools/sync_assets.ps1      ..\hadimobile\assets → assets (görseller, oyunlar, yazı tipleri; depoya girmez)
tools/sync_site.ps1        kulüp sitesindeki yasal metin, /hp/, .well-known … → site/ (site yalnızca okunur)
tools/make_web_config.ps1  Firebase web ayarları → web_config.json (Kurucu Paneli'nden kopyalar)
tools/build.ps1            derle (+ -Deploy ile Cloudflare Pages "hadi-web"e yükle)
.github/workflows/deploy.yml  main dalına her gönderimde derle + yayınla
```

## Adres ve yollar

hadisosyal.com **yalnızca HADİ Web'dir**, kendi Cloudflare Pages projesindedir (`hadi-web`). Kulüp sitesi (`D:\hadietkinlikkulubu`, hadietkinlikkulubu.com) ayrı projedir ve **değiştirilmez**.

| Yol | Ne açılır |
|---|---|
| `/`, `/etkinlikler`, `/mesajlar`, … (bilinmeyen her yol) | HADİ Web (kökte `404.html` olmadığı için Pages tek sayfa uygulaması gibi `index.html`'i sunar) |
| `/p/…`, `/yazi/…`, `/etkinlik/…`, `/anket/…`, `/grup/…`, `/kanal/…`, `/sonuc/…`, `/d/…`, `/ai/…`, `/davet/…`, `/@kullanici`, `/uygulama` | **Kişi:** HADİ Web o içeriği açar. **Bağlantı önizleme botu** (WhatsApp, Telegram, X, Facebook…): paylaşım sayfası (başlık + görsel). Uygulama yüklüyse telefon bağlantıyı uygulamada açar. `functions/[[path]].js` |
| `/kvkk`, `/kullanim-kosullari`, `/katilim-kosullari`, `/topluluk-kurallari`, `/cerez-politikasi`, `/sanal-para-kurallari` | Yasal metinler (sitedekiyle aynı sayfalar) |
| `/hp/` | Web Elmas ödemesi (sitedekiyle aynı; uygulamadan gelişte nötr sayfa kuralı korunur) |
| `/seffaflik`, `/elmas-kampanyalari`, `/api/elmas-kampanyalari` | Şeffaflık raporu ve Elmas kampanyaları (sitedeki Function ile aynı) |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | iPhone Universal Links ve Android App Links |
| `/hakkimizda`, `/galeri`, `/kurucular`, … (tanıtım sayfaları) | hadietkinlikkulubu.com'a yönlenir (`web/_redirects`; yasal sayfaların menü bağlantıları için) |

**Kulüp sitesinden gelenler:** `site/` klasörü sitedeki bu sayfaların (ve stil/betik/görsellerinin) anlık görüntüsüdür; `site_functions/share.js` sitenin `functions/[[path]].js` dosyasının kopyasıdır. `tools\sync_site.ps1` her derlemede bunları siteden **okuyup** günceller (site değiştirilmez) ve depoya girer; böylece GitHub'daki derleme de aynısını yayınlar. Yasal metni değiştirmek için siteyi düzenle, sonra HADİ Web'i yeniden derle.

## Kurulum (bir kez)

0. **Firebase web uygulaması:** Kurucu Paneli ile aynı. `D:\hadifounder\web_config.json` doluysa `tools\make_web_config.ps1` (ve `build.ps1`) onu kopyalar.
1. **Cloudflare Pages:** Workers & Pages › Create › Pages › Direct Upload, proje adı `hadi-web`. **Custom domains** › `hadisosyal.com` (ve `www.hadisosyal.com`). hadisosyal.com şu an başka bir Pages projesine bağlıysa önce oradan kaldır (kulüp sitesinin dosyalarına dokunulmaz; yalnızca Cloudflare'deki alan adı bağlantısı).
2. **Firebase Authentication › Settings › Authorized domains:** `hadisosyal.com`, `www.hadisosyal.com`, `hadi-web.pages.dev`. Telefonla giriş başka alan adlarında çalışmaz.
3. **Firebase Storage CORS (görseller için şart):** tarayıcı, Storage'daki görselleri ancak kova bu siteye izin verirse açar; yoksa konsolda "blocked by CORS policy" görünür ve fotoğraflar boş kalır. Bir kez: `node tools\set_storage_cors.mjs` (bilgisayardaki Firebase CLI oturumunu kullanır; gcloud/Cloud Shell gerekmez). gcloud kuruluysa alternatif: `tools\set_storage_cors.ps1`. Yalnızca okuma (GET/HEAD) ve yalnızca `tools\storage_cors.json`'daki sitelere (hadisosyal.com, Crew, Kurucu Paneli) izin verir.
4. **Elmas web kanalı:** Kurucu paneli › Ödemeler'de web'de görünecek kanalı aç (`showInApp.web`). Kapalıysa web'de "Elmas'ı uygulamadan alabilirsin" yazar.
5. **İlk yayın:**
   ```powershell
   cd D:\hadiweb
   npx wrangler login          # bir kez
   powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Deploy
   ```

## GitHub

1. Özel depo `tlghn/hadiweb`:
   ```powershell
   cd D:\hadiweb
   git init -b main
   git add .
   git commit -m "HADİ Web"
   git remote add origin https://github.com/tlghn/hadiweb.git
   git push -u origin main
   ```
2. Gizliler Kurucu Paneli ile aynı: `HADIMOBILE_READ_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FB_API_KEY`, `FB_APP_ID`, `FB_SENDER_ID`, `FB_MEASUREMENT_ID`.
3. Uygulamanın kodu (`hadimobile`) değişince web'i de yeniden yayınla: **Actions › HADİ Web yayını › Run workflow**. CI kulüp sitesine erişemez; `site/` klasöründeki anlık görüntüyü kullanır. Sitede yasal metin vb. değiştiğinde bilgisayarda `build.ps1` çalıştır (görüntü güncellenir) ve depoya gönder.

## Yerelde deneme

```powershell
powershell -File tools\sync_assets.ps1
flutter run -d chrome --dart-define-from-file=web_config.json      
# Firebase'siz demo (yalnızca arayüz): numara serbest, kod 123456
flutter run -d chrome --dart-define=PANEL_DEMO=true
```
