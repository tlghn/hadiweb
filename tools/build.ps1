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
# Kilit: aynı anda iki derleme build\web'i karıştırmasın (2 Kasım 2026: 483 ve 484 birlikte derlenince index.html bir
# derlemenin, hadi_build.txt diğerinin etiketini taşıdı → açık uygulamada sonsuz "HADİ güncellendi"). Dosya özel açılır;
# süreç bitince (hata ya da kapanma dahil) Windows kilidi kendiliğinden bırakır. İkinci derleme ilki bitene kadar bekler.
$lockPath = Join-Path $root "build.lock"
$lock = $null
$waitUntil = (Get-Date).AddMinutes(60)
while (-not $lock) {
  try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  catch [System.IO.IOException] {
    if ((Get-Date) -gt $waitUntil) { throw "Başka bir web derlemesi 60 dakikadır sürüyor; build.lock bırakılmadı." }
    Write-Host "Başka bir web derlemesi sürüyor; bitmesi bekleniyor..."
    Start-Sleep -Seconds 10
  }
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
# --wasm (hız, 3 Kasım 2026): WebAssembly + JavaScript birlikte derlenir; tarayıcı destekliyorsa WebAssembly açılır
# (yerel ölçüm: ilk ekran 1,67–1,92 sn → 1,19–1,37 sn). Desteklemeyen tarayıcı main.dart.js ile açılır.
& $Flutter build web --release --wasm --no-web-resources-cdn --dart-define-from-file=web_config.json --dart-define=HADI_BUILD=$stamp
if ($LASTEXITCODE -ne 0) { throw "web derlemesi başarısız" }
# Sürüm etiketi: index.html ve flutter_bootstrap.js içindeki __HADI_BUILD__ yerine yazılır (uygulama dosyaları etiketle istenir;
# telefon tarayıcısında Ctrl+F5 gerekmez). hadi_build.txt: açık uygulama yeni sürümü bununla fark eder (lib/app/update_check.dart).
foreach ($f in @("build\web\index.html", "build\web\flutter_bootstrap.js")) {
  $t = [IO.File]::ReadAllText((Join-Path $root $f)); [IO.File]::WriteAllText((Join-Path $root $f), $t.Replace("__HADI_BUILD__", $stamp))
}
[IO.File]::WriteAllText((Join-Path $root "build\web\hadi_build.txt"), $stamp)
# Tarayıcı bildirimleri (web push): service worker'a Firebase yapılandırması yazılır (web_config.json; gizli değildir).
$swp = Join-Path $root "build\web\firebase-messaging-sw.js"
if (Test-Path $swp) {
  $t = [IO.File]::ReadAllText($swp)
  $t = $t.Replace("__FB_API_KEY__", $wc.FB_API_KEY).Replace("__FB_SENDER_ID__", $wc.FB_SENDER_ID).Replace("__FB_APP_ID__", $wc.FB_APP_ID)
  [IO.File]::WriteAllText($swp, $t)
}

# 3) Pakete kulüp sitesi sayfaları (.well-known dahil; uygulamanın dosyalarıyla çakışmaz)
Copy-Item -Recurse -Force "site\*" "build\web\"
New-Item -ItemType Directory -Force "build\web\.well-known" | Out-Null
Copy-Item -Force "site\.well-known\*" "build\web\.well-known\"
# Kökte 404.html olmamalı: bilinmeyen her yol uygulamayı (index.html) açar.
if (Test-Path "build\web\404.html") { Remove-Item "build\web\404.html" }
# Uygulama dosyaları tarayıcıya bir kez iner (web/sw.js; kurucu kuralı, 3 Kasım 2026): her dosyanın içerik parmak izi
# asset_hashes.json'a yazılır; service worker dosyayı parmak iziyle saklar, yalnızca içeriği değişeni yeniden indirir.
# sw.js'e sürüm etiketi yazılır: her derlemede değişir, tarayıcı yeni çalışanı kurar ve yeni listeyi okur.
$web = Join-Path $root "build\web"
$rx = '^(assets/|icons/|favicon\.png$|splash\.webp$)'
$sha = [Security.Cryptography.SHA256]::Create()
$hashes = [ordered]@{}
Get-ChildItem -Recurse -File $web | Sort-Object FullName | ForEach-Object {
  $rel = $_.FullName.Substring($web.Length + 1).Replace('\', '/')
  if ($rel -match $rx) {
    $hashes[$rel] = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($_.FullName))) -replace '-', '').Substring(0, 16).ToLower()
  }
}
[IO.File]::WriteAllText((Join-Path $web "asset_hashes.json"), ($hashes | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
$swf = Join-Path $web "sw.js"
[IO.File]::WriteAllText($swf, [IO.File]::ReadAllText($swf).Replace("__HADI_BUILD__", $stamp), (New-Object Text.UTF8Encoding $false))
if ($hashes.Count -lt 50 -or [IO.File]::ReadAllText($swf).Contains("__HADI_BUILD__")) { throw "asset_hashes.json / sw.js hazırlanamadı; yayın yapılmadı." }

# Son denetim: sayfanın istediği sürüm, açık uygulamanın denetlediği sürüm ve uygulamanın kendi etiketi aynı olmalı.
$idx = [IO.File]::ReadAllText((Join-Path $root "build\web\index.html"))
$bt = [IO.File]::ReadAllText((Join-Path $root "build\web\hadi_build.txt")).Trim()
$mj = [IO.File]::ReadAllText((Join-Path $root "build\web\main.dart.js"))
if ($bt -ne $stamp -or -not $idx.Contains("'$stamp'") -or $idx.Contains("__HADI_BUILD__") -or -not $mj.Contains($stamp) -or -not (Test-Path (Join-Path $root "build\web\main.dart.wasm"))) {
  throw "Sürüm etiketleri tutarsız (beklenen $stamp); yayın yapılmadı."
}
Write-Host "Derleme hazır: $root\build\web"
if ($Deploy) {
  # functions\ (proje kökünde) Pages Function olarak birlikte yüklenir; site_functions\share.js onun içine paketlenir.
  npx --yes wrangler pages deploy build/web --project-name=hadi-web --branch=main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare yüklemesi başarısız" }
}
$lock.Dispose()
