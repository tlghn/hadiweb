# Firebase web ayarlarını web_config.json'a yazar (depoya girmez).
# Kaynak: web sitesinin yönetim paneli ayarı D:\hadietkinlikkulubu\panel\config.js (yalnızca OKUNUR, değiştirilmez).
# Orada değer yoksa web_config.example.json kopyalanır; değerleri Firebase Console'dan alıp web_config.json'a yaz.
# web_config.json zaten doluysa bu betiği çalıştırmaya gerek yok (build.ps1 yalnızca dosya yoksa çağırır).
param([string]$Source = "D:\hadietkinlikkulubu\panel\config.js")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# Kurucu Paneli'nin dolu ayarı varsa aynısı kullanılır (aynı Firebase web uygulaması).
$founder = Join-Path (Split-Path -Parent $root) "hadifounder\web_config.json"
if (Test-Path $founder) {
  $f = Get-Content -Raw -Encoding UTF8 $founder | ConvertFrom-Json
  if ($f.FB_API_KEY -and $f.FB_APP_ID -and $f.FB_SENDER_ID) {
    Copy-Item $founder (Join-Path $root "web_config.json")
    Write-Host "web_config.json Kurucu Paneli'nden kopyalandı."
    return
  }
}
if (-not (Test-Path $Source)) { throw "Bulunamadı: $Source" }
$js = Get-Content -Raw -Encoding UTF8 $Source
function Pick($name) {
  $m = [regex]::Match($js, "$name\s*:\s*[""']([^""']+)[""']")
  if ($m.Success) { return $m.Groups[1].Value } else { return "" }
}
$cfg = [ordered]@{
  FB_API_KEY        = Pick "apiKey"
  FB_APP_ID         = Pick "appId"
  FB_SENDER_ID      = Pick "messagingSenderId"
  FB_MEASUREMENT_ID = Pick "measurementId"
}
if (-not $cfg.FB_API_KEY -or -not $cfg.FB_APP_ID -or -not $cfg.FB_SENDER_ID) {
  $target = Join-Path $root "web_config.json"
  if (-not (Test-Path $target)) { Copy-Item (Join-Path $root "web_config.example.json") $target }
  throw "Firebase web ayarları yok: config.js'te apiKey/appId boş. Firebase Console › Proje ayarları › Uygulamalarınız › Web uygulaması ekle; verilen apiKey, appId, messagingSenderId (ve measurementId) değerlerini $target dosyasına yaz (README › Kurulum › 0)."
}
$cfg | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $root "web_config.json")
Write-Host "web_config.json hazır."
