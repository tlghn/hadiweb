# HADİ Film v3 — varlık lisansları

Bu klasördeki üçüncü taraf varlıklar yalnızca serbest lisanslıdır (CC0 / MIT; hayvan modellerinin bir kısmı CC BY 4.0 — atıf aşağıda). Her bölüm, o varlıkları üreten ajanın kendi satırlarıdır.

## İnsan tabanı ve parçalar (Ajan A)

Dosyalar: `human.glb`, `parts/*.glb`, `catalog.human.json`

| Varlık | Kaynak | Lisans |
|---|---|---|
| Temel insan ağı (`base.obj`), biçim hedefleri (`targets/**`: makro, yerel, yüz ifade birimleri) | MakeHuman 1.1 sistem varlıkları — github.com/makehumancommunity/makehuman (`makehuman/data`) | CC0 1.0 (Eylül 2020'de CC0 olarak yayımlandı; dosya başlıklarında belirtilir) |
| İskelet ve deri ağırlıkları (`rig.game_engine.json`, `weights.game_engine.json`; çene ve göz kemikleri `rig.default.json` / `weights.default.json`'dan) | MPFB2 — github.com/makehumancommunity/mpfb2 (`src/mpfb/data/rigs/standard`) | CC0 1.0 (`LICENSE.ASSETS.md`) |
| Saç (short01–04, afro01, long01, braid01, ponytail01, bob02), kaş (eyebrow001/009/010/012), kirpik (eyelashes01/02), göz (high-poly + brown), diş (teeth_base), dil (tongue01), ayakkabı (shoes01/02/03/06), takım/iş giysisi (male_elegantsuit01, male_worksuit01, female_elegantsuit01), fötr (fedora01), ten detay dokusu (young_caucasian_female) | MakeHuman System Assets paketi — files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip (`packs/makehuman_system_assets.json`: her öğe "license": "CC0") | CC0 1.0 |
| Koddan üretilen parçalar: köylü/çocuk/kadın/cübbe/asker/paşa giysileri, şalvar, yelek, kuşak, entari, önlük, sakal/bıyık, kısa kıvırcık/yaşlı seyrek/asker tıraşı saç, fes, kalpak, sarık, yazma, takke, iç giysi; tüm prosedürel dokular | HADİ (tools/film3/human/*.py) — MakeHuman CC0 temel ağından türetilmiştir | HADİ'nin kendi eseri |
| Sıkıştırma aracı: gltfpack 1.3.0 (meshoptimizer) — yalnızca derleme zamanında | npm `gltfpack` | MIT |
| Çalışma zamanı kod çözücü: three.js `meshopt_decoder.module.js` | three.js | MIT |

Değişiklikler: MakeHuman ağı Y-yukarı/metreye çevrildi, ayak tabanı y=0'a alındı; makro hedefler cinsiyet×yaş köşelerine indirgendi; yardımcı geometri atıldı; parçalar temel ağa bağlandı ve hedefleri bağlama üzerinden aktarıldı; dokular küçültülüp gri tonlanabilir hale getirildi.

<!-- Ajan B: hareket, hayvan, ortam, ses varlıklarının satırlarını bu çizginin altına ekleyin. -->

## Hareket, hayvanlar, sahne kitleri, proplar, ses ve müzik (Ajan B)

Dosyalar: `anims.glb`, `animals/*.glb`, `env/*.glb`, `props/*.glb`, `sfx/*`, `music/*`, `catalog.world.json`. Üretim betikleri: `hadimobile/tools/film3/anim/`.

| Varlık | Kaynak | Lisans |
|---|---|---|
| İnsan animasyonları (`anims.glb`; 46 klip) | Carnegie Mellon University Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), Bruce Hahne'nin (cgspeed) BVH dönüşümü, github.com/Shriinivas/cmubvh aynası. Kullanılan çekimler: 02_07, 111_02, 111_12, 111_28, 113_15, 113_21, 115_06, 132_45, 138_01, 139_19, 139_29, 140_08, 141_13, 141_16, 141_21, 142_01, 16_35, 18_08, 18_10, 23_03, 35_01, 77_02, 79_01, 79_04, 79_06, 79_12, 79_16, 79_31, 79_38, 79_55, 79_69, 79_70, 79_71, 79_72, 79_73, 79_74, 79_89, 80_50, 81_06, 82_05, 90_16, 91_13 | CMU: "free to use for any purpose" (ücretsiz, her amaçla). Teşekkür: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| Kodla üretilen animasyonlar (24 klip: head_shake, nod, point, give, take, slap, hug, pray, talk_gesture_2/3, carry, think, listen, look_around, idle_old, walk_old…) ve retarget, döngü, baş kalibrasyonu | HADİ (`build_anims.py`, `f3lib.py`) | HADİ'nin kendi eseri |
| Hayvanlar: Horse (`qvTrSG9pZF`), White Horse (`bEdE4rmZy9`), Donkey (`qmX6nhnvp7`), Cow (`26zM1outCr`), Bull (`a8PIIYwF7r`), Sheep (`rgJXF570ZK`), Shiba Inu (`y4wdQpg767`), Husky (`wcWiuEqwzq`), Wolf (`P1gU3Qkr9r`), Fox (`Bc97C66HKi`), Deer (`T6Cs7tmMHJ`), Alpaca (`bCVFD48i2l`), Cat (`qKICY6xla2`), Pig (`u35l6uP5vj`), Chicken (`Z3RCoCYss4`), Pigeon (`9NGlBTpDEr`) | Quaternius, poly.pizza üzerinden (poly.pizza/m/<kimlik>). Ad değişikliği, ölçek, `trot` ve takma ad klipleri HADİ | CC0 1.0 |
| Sahne/prop modelleri: Pitchfork (`dtLT2Nj0KF`) | CreativeTrio, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne/prop modelleri: Hanging Lantern (`3jzk3YShv1`), Lantern (`CtHBJ1ufeW`), Post Lantern (`ZSQ65S4lEu`) | Kay Lousberg, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne/prop modelleri: Mug (`54cOZNS04L`) | MilkAndBanana, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne/prop modelleri: Open Book (`1A07aI9j2d`), Tree (`2paAm1ja4w`), Crate (`3OEFd1AWfa`), Crate (`3VGWnZPXmG`), Rock (`4MUaQTcDdc`), Table Round Small (`57W671WvS2`), Rug (`7H5qKjuxVY`), Mountain (`7HYR2s9JVi`), Bench (`7uSlZo3n9Y`), Bush (`92EytlU1El`), Sword (`9lLmH8Et4K`), Tree (`9nvGuZlbpE`), Chest Closed (`AngpV0HxD8`), Candles (`AnzHB44wlW`), Sail Boat (`BgSZXwmm7k`), Market Stand (`DGIM5HGISb`), Grass (`Db4UVcNWnF`), Bush (`EoTERLq3z2`), Bucket of Fish (`G61jVPof0G`), Rocks (`Gl3pcrdnpW`), Grass (`GyDYqHAByU`), Chair (`IRLaR71Pyn`), Tall Grass (`JSIYtscPmP`), House (`L7h0SjZX2K`), Book (`LC0w7VI75u`), Barrel (`MraIiFnpAY`), Broken Cart (`NBDHe8J7f9`), Boat (`OknDJkGeJ8`), Pot (`Olu4b0aiiY`), Well (`QlqncKYxXb`), House (`RSwoYSLblu`), Chair (`Rlyhe93NNe`), Rock (`RtLRqYjfMs`), Bush with Berries (`TSbIxkDtxF`), Mountain (`XY4ej3Zg3I`), Hay (`Yu8TOERkpw`), Rock (`Z6M4GNkgWt`), Open Barn (`ZIdWHxYsUv`), Wood Shovel (`ZKayHDWFmd`), Mountain Group (`a52gSEEq8X`), Sail Ship (`cIzO4MBPqI`), Market Stand (`hts7l0NZxW`), Tree (`i4QMw4L64D`), Small Bridge (`j4KsIuJYnq`), Market Stalls (`jSqGy8V0MQ`), Cart (`l7bDe7ak6j`), Willow (`mBrUbIp9Zd`), Rifle (`neEjwx9bBJ`), House (`oJJIRwv6Bo`), Bush (`ooG6CkLyE8`), Coin Pouch (`pTZyPTMH88`), Fence (`r0n40F7FKx`), Bucket (`tKTttwROq7`) | Quaternius, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne/prop modelleri: Wooden Sign (`GGbYyOmVCh`) | iPoly3D, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne/prop modelleri: Clay Jug (`FfvhIuFaLu`) | reyshapes, poly.pizza (poly.pizza/m/<kimlik>) | CC0 1.0 |
| Sahne kitlerindeki duvar, sedir, ocak, çeşme, minare, taht, kürsü, kadırga gövdesi, iskele ve propların (kaşağı, tespih, bavul, sepet, değnek, kaftan, mektup, ekmek, sini, eyer) geometrisi; tüm dokular (çimen, toprak, taş, ahşap, sıva, halı, kumaş, mermer, deniz…) | HADİ (`compose_kits.mjs`, `kits.json`, `kits_more.py`, `gen_textures.py`) | HADİ'nin kendi eseri |
| Ses efektleri: `stream, wind, birds* (park_ambience)` ← opengameart.org/content/park-ambiences; `birds` ← opengameart.org/content/ambient-bird-sounds (isaiah658); `crowd` ← opengameart.org/content/crowd-shoutingspeaking-ambience; `sea_waves` ← opengameart.org/content/sea-and-river-wave-sounds; `wave_crash` ← opengameart.org/content/beach-ocean-waves (jasinski); `fire_crackle` ← opengameart.org/content/fireplace-sound-loop; `rain` ← opengameart.org/content/amb-rain-loop-1; `thunder` ← opengameart.org/content/rain-long-thunder; `hooves_trot, hooves_walk` ← opengameart.org/content/horse-trotting; `footsteps, footstep` ← opengameart.org/content/footsteps-0; `door_open, door_creak, knock, wood_hit, keys` ← opengameart.org/content/100-cc0-metal-and-wood-sfx; `door_close` ← opengameart.org/content/4-door-closes (StarNinjas); `sword_clash, sword_swing` ← opengameart.org/content/20-sword-sound-effects-attacks-and-clashes (StarNinjas); `gunshot` ← opengameart.org/content/gunshot-sound-effect; `heartbeat` ← opengameart.org/content/heartbeat-single-sound; `sheep_baa` ← opengameart.org/content/sheep-baa; `dog_bark` ← opengameart.org/content/dog-barking-mono; `cat_meow` ← opengameart.org/content/meow (kesildi, döngülendi, normalleştirildi) | OpenGameArt.org | CC0 1.0 |
| Sentez ses efektleri: horse_neigh, horse_snort, cow_moo, rooster, chicken, bell, water_pour, slap, body_fall, brush, room_tone, crickets | HADİ (`gen_audio.py`, numpy sentezi) | HADİ'nin kendi eseri |
| Müzik döngüleri (8): calm_strings, tension, sad, joy, eastern (Hicaz; ney, ud, def), village (saz, ney), night, heroic | HADİ (`gen_audio.py`, numpy sentezi: Karplus-Strong tel, ney modeli, yaylı ped, davul) | HADİ'nin kendi eseri |
| Sıkıştırma: gltfpack 0.25 (meshoptimizer); düzenleme: @gltf-transform 4.1 — yalnızca derleme zamanında | npm | MIT |

### Gerçekçilik turu (Ajan B) — Poly Haven / ambientCG CC0

| Varlık | Kaynak | Lisans |
|---|---|---|
| Modeller (sadeleştirilmiş, dokular webp): Lantern_01, brass_pot_01, brass_vase_01, carved_wooden_plate, celandine_01, ceramic_vase_01, coast_rocks_01, dandelion_01, dead_tree_trunk, fern_02, folding_wooden_stool, grass_medium_02, island_tree_01, island_tree_02, jug_01, modular_wooden_pier, nettle_plant, painted_wooden_bench, pot_enamel_01, rock_07, rock_09, rock_moss_set_01, round_wooden_table_01, ship_pinnace, shrub_02, shrub_03, shrub_04, spinning_wheel_01, stone_01, tea_set_01, treasure_chest, tree_stump_01, vintage_oil_lamp, wicker_basket_01, wicker_basket_02, wooden_axe, wooden_barrels_01, wooden_bookshelf_worn, wooden_bowl_01, wooden_bucket_01, wooden_bucket_02, wooden_candlestick, wooden_crate_01, wooden_crate_02, wooden_ladder, wooden_lantern_01, wooden_stool_01, wooden_stool_02 | Poly Haven — polyhaven.com/a/<ad> | CC0 1.0 |
| PBR dokular (renk, normal, AO/pürüzlülük): brown_mud_dry, clay_roof_tiles_02, coast_sand_01, cobblestone_floor_07, marble_01, medieval_wood, muddy_tracks, old_wood_floor, patterned_clay_plaster, roof_planks, rustic_stone_wall, stony_dirt_path, thatch_roof_angled, weathered_plank_siding, weathered_planks, wooden_gate, caban (kumaş normal ayrıntısı) | Poly Haven — polyhaven.com/a/<ad> | CC0 1.0 |
| PBR dokular: Grass001, Grass004, Grass005, Ground037 | ambientCG — ambientcg.com/view?id=<ad> | CC0 1.0 |
| HDRI gökyüzleri (1k .hdr + tonlanmış arka plan .webp): kloofendal_48d_partly_cloudy_puresky, kloofendal_misty_morning_puresky, kloofendal_overcast_puresky, kloppenheim_07_puresky, qwantani_dawn_puresky, qwantani_morning_puresky, qwantani_night_puresky, qwantani_sunset_puresky | Poly Haven — polyhaven.com/a/<ad> | CC0 1.0 |
| Türetilmiş dokular: whitewash (badana), kilim, sedir kumaşı, yelken bezi, tente, toprak/çimen yamaları, su/deniz normal haritası | HADİ (`gen_pbr_extra.py`) — Poly Haven/ambientCG CC0 kaynaklardan türetildi | CC0 türevi / HADİ |
| Mimari (ev, ahır, dükkân, çeşme, minare, kuyu, kağnı, çit, saray, mahkeme, kadırga) | HADİ (`kits_real.py`, `compose_kits.mjs`) | HADİ'nin kendi eseri |
| Hayvan yumuşatma ve türetme (koyun ← Quaternius Alpaca, kedi ← Quaternius Fox) | HADİ (`smooth_animals.mjs`, `derive_animals.mjs`) — kaynaklar Quaternius CC0 | CC0 türevi |
| Gerçekçilik turu 2 — PBR dokular: sandstone_blocks_08, coast_sand_02, damp_beach_sand, wood_cabinet_worn_long | Poly Haven — polyhaven.com/a/<ad> | CC0 1.0 |
| Gerçekçilik turu 2 — üretilmiş dokular: Anadolu kilimi (elibelinde, koçboynuzu, göz, baklava; kök boya tonları), kireç sıva (limewash), duvar dibi kir/is (grime), İznik çini karosu (cini), kurşun (lead); zemin dokularında ışık gradyanı düzleştirme (`flatten_tex.py`) | HADİ (`gen_pbr_extra.py`, `flatten_tex.py`) — Poly Haven/ambientCG CC0 kaynaklardan türetildi | CC0 türevi / HADİ |

## Hayvanlar (Sketchfab, CC BY 4.0)

Bu modeller CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) lisanslıdır: atıf zorunludur, ticari kullanım serbesttir.
Atıf her filmin sonunda ve oynatıcıdaki "i" (Künye) düğmesinde, o filmde kullanılan modeller için gösterilir (kaynak: catalog `animals[].credit`).
Başlık/yazar/URL, kurucunun indirdiği zip'lerdeki `license.txt` dosyalarından aynen alınmıştır.

- `animals/horse.glb` (At): "Horse" — henrysteve973 — CC BY 4.0 — https://sketchfab.com/3d-models/horse-a6f860e43e364619bccb174a1ac7d0c9 — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/dog.glb` (Köpek): "Dog animated" — MAXDESIGN-3D — CC BY 4.0 — https://sketchfab.com/3d-models/dog-animated-21b7336c58a442578ab88fc47233ef11 — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/sheep.glb` (Koyun): "Animated Sheep" — igor-lir — CC BY 4.0 — https://sketchfab.com/3d-models/animated-sheep-b99698502dea4905b916fce0bcf2dfc0 — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/cow.glb` (İnek): "Farm Cow Animated Dairy cattle" — Rukh3D — CC BY 4.0 — https://sketchfab.com/3d-models/farm-cow-animated-dairy-cattle-0e780cb5ab6d457198ded7d4e191a03e — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/chicken.glb` (Tavuk): "Chicken" — MAXDESIGN-3D — CC BY 4.0 — https://sketchfab.com/3d-models/chicken-4ab19d3a675343959815ae770f8b178e — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/donkey.glb` (Eşek): "Realistic Animated Donkey 3D Model" — WildMesh 3D — CC BY 4.0 — https://sketchfab.com/3d-models/realistic-animated-donkey-3d-model-2b4086035df94d9e88fd0f18d34b3872 — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/goat.glb` (Keçi): "Animated Goat – 3D Animal Model" — AnimalMesh 3D — CC BY 4.0 — https://sketchfab.com/3d-models/animated-goat-3d-animal-model-4f3a23b1fc094f75a1d9cf2e5bc1faef — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi
- `animals/pig.glb` (Domuz): "Piglet" — grs — CC BY 4.0 — https://sketchfab.com/3d-models/piglet-8343f141936f4c799ed980a3c7c3ae27 — değişiklik: sadeleştirildi, yeniden yönlendirildi, animasyon adları eşlendi

Ek değişiklik ayrıntıları (HADİ, `hadimobile/tools/film3/anim/sketchfab_animals.mjs` + `quad_walk.mjs`): üçgen sayısı azaltıldı, dokular WebP'ye
küçültüldü (meshopt sıkıştırma), +Z yönüne çevrilip metreye ölçeklendi, kök hareketi yerinde tutuldu, bileşik klipler (köpek, tavuk) ayrı kliplere
bölündü; inek ve koyun için yürüme animasyonu koddan üretildi (koyuna otomatik bacak iskeleti eklendi); domuz/keçi/tavuk bekleme pozu var olan
kliplerin bir karesinden türetildi; keçi ve eşekte spec-gloss malzeme metal-rough'a çevrildi.
Önceki Quaternius (CC0) at/eşek/inek/koyun/köpek/domuz/tavuk dosyaları bu modellerle değiştirildi; `horse_white`, `bull`, `dog_big`, `wolf`, `fox`,
`deer`, `alpaca`, `cat`, `bird` yukarıdaki Quaternius (CC0) satırındaki gibi kalır.
