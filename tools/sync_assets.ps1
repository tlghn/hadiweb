# Uygulamanın görsellerini, oyun sahnelerini, yazı tiplerini ve 3B nokta bulutlarını ..\hadimobile\assets'ten kopyalar.
# HADİ Web bu dosyaları uygulamadaki yollarıyla (assets/...) okur; depoya girmez (.gitignore). build.ps1 her derlemede çağırır.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path (Split-Path -Parent $root) "hadimobile\assets"
if (-not (Test-Path $src)) { throw "Bulunamadı: $src (klasörler yan yana olmalı: D:\hadimobile, D:\hadiweb)" }
$dst = Join-Path $root "assets"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse $src $dst
Write-Host "assets kopyalandı."
