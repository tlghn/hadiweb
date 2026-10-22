# Firebase Storage'tan görsel/ses/video indirmeye web uygulamalarının (HADİ Web, Crew, Kurucu Paneli) izin vermesi (CORS).
# Tarayıcıda Flutter görselleri JavaScript ile indirir; kova CORS izni vermezse "blocked by CORS policy" hatası olur ve
# görseller açılmaz. Bu yalnızca OKUMA (GET/HEAD) iznidir ve yalnızca aşağıdaki listedeki sitelere verilir
# (tools\storage_cors.json). Dosyaların kendisi yine yalnızca jetonlu bağlantıyla indirilebilir; kurallar değişmez.
#
# Çalıştırmak için Google Cloud CLI gerekir (gcloud). Yoksa: console.cloud.google.com › üstte Cloud Shell'i aç, storage_cors.json'u
# yükle ve şu komutu yaz:
#   gcloud storage buckets update gs://hadi-a0db3.firebasestorage.app --cors-file=storage_cors.json
$ErrorActionPreference = "Stop"
$file = Join-Path $PSScriptRoot "storage_cors.json"
gcloud storage buckets update gs://hadi-a0db3.firebasestorage.app --cors-file="$file"
if ($LASTEXITCODE -ne 0) { throw "CORS ayarlanamadı (gcloud oturumu açık mı? gcloud auth login)" }
gcloud storage buckets describe gs://hadi-a0db3.firebasestorage.app --format="default(cors_config)"
Write-Host "Tamam: birkaç dakika içinde geçerli olur; sayfayı yenile."
