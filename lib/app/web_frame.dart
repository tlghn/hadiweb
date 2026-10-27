import 'package:flutter/material.dart';
import 'package:hadi/core/links.dart';
import 'package:hadi/theme/hadi_colors.dart';
import 'package:hadi/widgets/hadi_logo_animation.dart' show HadiLogoAnimation;
import 'package:url_launcher/url_launcher.dart';

import 'pwa.dart';
import 'package:hadi/core/immersive.dart';

/// Telefon genişliğinin altında (< 640 px) uygulama tam ekran. Daha geniş ekranda uygulama, okunur bir sütunda
/// (en çok 480 px) yumuşak gölgeli bir kart olarak ortalanır; masaüstü genişliğinde (≥ 1100 px) solda HADİ tanıtımı ve
/// uygulama bağlantısı görünür.
///
/// Uygulamanın bütün ekranları telefon için tasarlandı: geniş ekranda gerilmek yerine telefondaki gibi görünür. İçerideki
/// her şey (pencereler, alt sayfalar, bildirim şeritleri) kartın içinde kalır; ekran ölçüsü [MediaQuery] ile karta göre verilir.
class WebFrame extends StatelessWidget {
  const WebFrame({super.key, required this.child});
  final Widget child;

  static const double phoneMax = 640;
  static const double desktopMin = 1100;
  static const double columnWidth = 480;

  /// Uygulama ağacının sabit anahtarı: pencere boyutu değişip düzen (tam ekran ↔ kart ↔ masaüstü) değişince uygulama
  /// yeniden kurulmasın (yönlendirici baştan başlayıp ana sayfaya atmasın); GlobalKey ile durum korunarak taşınır.
  static final GlobalKey _appKey = GlobalKey(debugLabel: 'hadi-app');

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        // Tam ekran içerik (ör. kitap filmi) çerçevesiz, bütün pencerede çizilir.
        valueListenable: appImmersive,
        builder: (context, immersive, _) => _build(context, immersive),
      );

  Widget _build(BuildContext context, bool immersive) {
    final mq = MediaQuery.of(context);
    final size = mq.size;
    final child = KeyedSubtree(key: _appKey, child: this.child);
    if (immersive || size.width < phoneMax) return child;
    final dark = mq.platformBrightness == Brightness.dark;
    final desktop = size.width >= desktopMin;
    final vMargin = size.height >= 760 ? 24.0 : 0.0;
    final frameH = size.height - vMargin * 2;
    final frame = SizedBox(
      width: columnWidth,
      height: frameH,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(vMargin > 0 ? 28 : 0),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: dark ? .45 : .14), blurRadius: 48, offset: const Offset(0, 18)),
            BoxShadow(color: Colors.black.withValues(alpha: dark ? .3 : .06), blurRadius: 6, offset: const Offset(0, 2)),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(vMargin > 0 ? 28 : 0),
          child: MediaQuery(
            data: mq.copyWith(
              size: Size(columnWidth, frameH),
              padding: EdgeInsets.zero,
              viewPadding: EdgeInsets.zero,
              viewInsets: EdgeInsets.zero,
            ),
            child: child,
          ),
        ),
      ),
    );
    return Directionality(
      textDirection: TextDirection.ltr,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: dark
                ? const [Color(0xFF121820), Color(0xFF1B2430), Color(0xFF14202B)]
                : const [Color(0xFFFFF4E8), Color(0xFFFFF8F1), Color(0xFFEAF3FB)],
          ),
        ),
        child: Center(
          child: desktop
              ? Row(mainAxisSize: MainAxisSize.min, children: [
                  SizedBox(width: 380, child: _Intro(dark: dark)),
                  const SizedBox(width: 72),
                  frame,
                ])
              : frame,
        ),
      ),
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final ink = dark ? const Color(0xFFF3EEE8) : const Color(0xFF1F1A16);
    final ink2 = dark ? const Color(0xFFB9B1A8) : const Color(0xFF6B5B4E);
    final fill = HadiColors.brandFill(HadiColors.heyecan);
    return DefaultTextStyle(
      style: TextStyle(fontFamily: 'Bricolage', color: ink, decoration: TextDecoration.none),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Uygulamanın açılışındaki logo (15 katman; sitedeki animasyonun aynısı): giriş bir kez, figürler hareketli.
        // Büyük ve sütunda ortalı (kurucu, 24 Ekim 2026).
        // Figürler 20 sn oynar, sonra durur; fare logonun üstüne gelince bir tur daha (27 Ekim 2026, kurucu: "sekme %100
        // işlemci harcıyor"). Eskiden döngü hiç durmuyordu: panel uygulamanın DIŞINDA olduğundan güç bütçesine
        // (hadi › core/power_budget.dart) takılmıyor, masaüstünde her sayfada (profil dahil) saniyede 60 tam kare çizdiriyordu.
        // Döngü ayrıca boşta, gizli sekmede ve hareketi azaltta durur.
        const Center(child: SizedBox(width: 240, height: 240, child: HadiLogoAnimation(loopFor: Duration(seconds: 20)))),
        const SizedBox(height: 28),
        Text('Hadi, buluşalım.', style: TextStyle(fontSize: 40, height: 1.1, fontWeight: FontWeight.w700, color: ink)),
        const SizedBox(height: 14),
        Text(
          'Etkinliklere katıl, topluluklarda sohbet et, yeni insanlarla tanış. HADİ artık tarayıcında da; '
          'hesabın, mesajların ve Elmas bakiyen uygulamayla aynı.',
          style: TextStyle(fontSize: 16.5, height: 1.5, color: ink2),
        ),
        const SizedBox(height: 28),
        Wrap(spacing: 12, runSpacing: 12, children: [
          _Pill(
            bg: fill.bg,
            fg: fill.fg,
            icon: Icons.phone_iphone_rounded,
            label: 'Uygulamayı indir',
            onTap: () => launchUrl(Uri.parse(Links.app()), mode: LaunchMode.externalApplication),
          ),
          // Chrome / Edge: HADİ'yi bu bilgisayara uygulama olarak yükle (kendi penceresinde açılır).
          ValueListenableBuilder<bool>(
            valueListenable: Pwa.instance.canPrompt,
            builder: (context, can, _) => !can || Pwa.instance.standalone
                ? const SizedBox.shrink()
                : _Pill(
                    bg: dark ? const Color(0xFF26313D) : Colors.white,
                    fg: ink,
                    border: dark ? const Color(0xFF3A4652) : const Color(0xFFE6DCD2),
                    icon: Icons.install_desktop_rounded,
                    label: 'Bu bilgisayara yükle',
                    onTap: () => Pwa.instance.prompt(),
                  ),
          ),
        ]),
        const SizedBox(height: 14),
        Text('Canlı yayın ve fotoğraf düzenleyici (filtre, Güzelleştir, yüz efektleri) tarayıcıda da var. Video düzenleyici ve kimlik doğrulama gibi telefona özel özellikler uygulamada.',
            style: TextStyle(fontSize: 13, height: 1.45, color: ink2)),
      ]),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.bg, required this.fg, required this.icon, required this.label, required this.onTap, this.border});
  final Color bg, fg;
  final Color? border;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: bg,
        shape: StadiumBorder(side: border == null ? BorderSide.none : BorderSide(color: border!)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 20, color: fg),
              const SizedBox(width: 10),
              Text(label, style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 15.5)),
            ]),
          ),
        ),
      );
}

/// Derleme Firebase web ayarları olmadan yapıldıysa (README › Kurulum › 0).
class WebConfigMissing extends StatelessWidget {
  const WebConfigMissing({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('Firebase web ayarları eksik. Derlemeyi web_config.json ile yapın (README › Kurulum › 0).', textAlign: TextAlign.center),
            ),
          ),
        ),
      );
}
