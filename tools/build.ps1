# HADİ Web: web derlemesi (+ isteğe bağlı Cloudflare Pages'e yükleme). Adres: https://hadisosyal.com (kök, izole proje).
#   powershell -ExecutionPolicy Bypass -File tools\build.ps1            → yalnızca derle (build\web)
#   powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Deploy    → derle + Cloudflare Pages "hadi-web" projesine yükle
# Yüklemeden önce bir kez: npx wrangler login  (tarayıcıda Cloudflare hesabınla onay verirsin)
#
# Kulüp sitesi (D:\hadietkinlikkulubu, hadietkinlikkulubu.com) ayrı projedir ve DEĞİŞTİRİLMEZ. Yasal metinler, /hp/ (web
# Elmas ödemesi), kampanya ve paylaşım sayfaları her derlemede oradan OKUNUP kopyalanır (tools\sync_site.ps1 → site\,
# site_functions\) ve hadisosyal.com'da da yayınlanır.
param([switch]$Deploy, [string]$Flutter = "", [string]$Site = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $Flutter) {
  $cmd = Get-Command flutter -ErrorAction SilentlyContinue
  $Flutter = if ($cmd) { $cmd.Source } else { "D:\flutter\flutter\bin\flutter.bat" }
}
if (-not (Test-Path "..\hadimobile\pubspec.yaml")) { throw "..\hadimobile bulunamadı: klasörler yan yana olmalı (D:\hadimobile, D:\hadiweb)." }
if (-not (Test-Path "web_config.json")) { & (Join-Path $PSScriptRoot "make_web_config.ps1") }
$wc = Get-Content -Raw -Encoding UTF8 "web_config.json" | ConvertFrom-Json
if (-not $wc.FB_API_KEY -or -not $wc.FB_APP_ID -or -not $wc.FB_SENDER_ID) { throw "web_config.json boş: README › Kurulum › 0" }

# 1) Kulüp sitesinin sayfaları (salt okuma; site yoksa depodaki son anlık görüntü kullanılır)
if ($Site) { & (Join-Path $PSScriptRoot "sync_site.ps1") -Site $Site } else { & (Join-Path $PSScriptRoot "sync_site.ps1") }

# 2) Uygulama
& (Join-Path $PSScriptRoot "sync_assets.ps1")
& $Flutter pub get
if ($LASTEXITCODE -ne 0) { throw "pub get başarısız" }
# HADI_BUILD: oyun dosyalarının sürüm etiketi (game_web_frame_web.dart; tarayıcı önbelleğindeki eski oyun dosyası kullanılmasın).
$stamp = Get-Date -Format "yyyyMMddHHmmss"
& $Flutter build web --release --no-web-resources-cdn --no-wasm-dry-run --dart-define-from-file=web_config.json --dart-define=HADI_BUILD=$stamp
if ($LASTEXITCODE -ne 0) { throw "web derlemesi başarısız" }

# 3) Pakete kulüp sitesi sayfaları (.well-known dahil; uygulamanın dosyalarıyla çakışmaz)
Copy-Item -Recurse -Force "site\*" "build\web\"
New-Item -ItemType Directory -Force "build\web\.well-known" | Out-Null
Copy-Item -Force "site\.well-known\*" "build\web\.well-known\"
# Kökte 404.html olmamalı: bilinmeyen her yol uygulamayı (index.html) açar.
if (Test-Path "build\web\404.html") { Remove-Item "build\web\404.html" }
Write-Host "Derleme hazır: $root\build\web"
if ($Deploy) {
  # functions\ (proje kökünde) Pages Function olarak birlikte yüklenir; site_functions\share.js onun içine paketlenir.
  npx --yes wrangler pages deploy build/web --project-name=hadi-web --branch=main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare yüklemesi başarısız" }
}
