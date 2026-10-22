# Kulüp sitesinden (D:\hadietkinlikkulubu) hadisosyal.com'da da sunulan sayfaların anlık görüntüsünü günceller.
# Site YALNIZCA OKUNUR; hiçbir dosyasına yazılmaz. Görüntü hadiweb\site\ ve hadiweb\site_functions\share.js'e yazılır
# (depoya girer: GitHub'daki derleme de aynı sayfaları yayınlar). build.ps1 her derlemede çağırır.
param([string]$Site = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Site) { $Site = Join-Path (Split-Path -Parent $root) "hadietkinlikkulubu" }
if (-not (Test-Path (Join-Path $Site "kvkk.html"))) { Write-Warning "Kulüp sitesi bulunamadı ($Site); depodaki anlık görüntü kullanılacak."; return }
# Yasal metinler, kampanyalar, web Elmas ödemesi (/hp/), ortak stil/betik/görseller, Universal Links / App Links.
$files = @(
  "kvkk.html", "kullanim-kosullari.html", "katilim-kosullari.html", "topluluk-kurallari.html", "cerez-politikasi.html",
  "sanal-para-kurallari.html", "elmas-kampanyalari.html",
  "hp\index.html", "hp\basarili.html", "hp\basarisiz.html", "hp\odeme-yontemlerim.html", "hp\hp.css", "hp\hp.js", "hp\kartlarim.js",
  "assets\css\style.css", "assets\css\elmas.css", "assets\js\main.js", "assets\js\elmas.js", "assets\js\forms-config.js",
  "assets\img\favicon.png", "assets\img\hadi-logo-512.jpg", "assets\img\hadi-logo.jpg", "assets\img\hadi-logo-hero.png", "assets\img\og-hadi.jpg",
  "panel\config.js",
  ".well-known\apple-app-site-association", ".well-known\assetlinks.json"
)
$dst = Join-Path $root "site"
foreach ($f in $files) {
  $src = Join-Path $Site $f
  if (-not (Test-Path $src)) { Write-Warning "Sitede yok: $f"; continue }
  $to = Join-Path $dst $f
  New-Item -ItemType Directory -Force (Split-Path -Parent $to) | Out-Null
  Copy-Item -LiteralPath $src $to -Force
}
# Paylaşım sayfaları / kampanyalar / şeffaflık Function'ı (köşeli parantezli ad: -LiteralPath).
$fn = Join-Path $Site "functions\[[path]].js"
if (Test-Path -LiteralPath $fn) { Copy-Item -LiteralPath $fn (Join-Path $root "site_functions\share.js") -Force }
Write-Host "Kulüp sitesi sayfaları güncellendi (site\)."
