import 'dart:async';
import 'dart:js_interop';

import 'package:pointer_interceptor/pointer_interceptor.dart';
import 'package:flutter/material.dart';
import 'package:hadi/theme/hadi_colors.dart';
import 'package:web/web.dart' as web;

/// Açık HADİ Web sekmesi yeni sürümü fark eder (telefon tarayıcısında Ctrl+F5 yok).
///
/// Derleme etiketi (`--dart-define=HADI_BUILD`, tools/build.ps1) sunucudaki `hadi_build.txt` ile karşılaştırılır:
/// açılışta, 5 dakikada bir ve sekmeye geri dönülünce. Farklıysa altta "HADİ güncellendi · Yenile" kartı çıkar; Yenile
/// sayfayı yeniden yükler. index.html önbelleğe alınmaz ve uygulama dosyaları etiketle istenir (index.html), bu yüzden
/// yenileme kesin olarak yeni sürümü açar.
class UpdateCheck extends StatefulWidget {
  const UpdateCheck({super.key, required this.child, this.bottomOffset = 92});
  final Widget child;

  /// Kartın alttan uzaklığı (HADİ Web'de alt menünün üstü; panellerde alt menü yok).
  final double bottomOffset;

  static const build = String.fromEnvironment('HADI_BUILD');

  @override
  State<UpdateCheck> createState() => _UpdateCheckState();
}

class _UpdateCheckState extends State<UpdateCheck> {
  Timer? _timer;
  bool _newer = false;
  bool _dismissed = false;
  JSFunction? _onVisible;

  @override
  void initState() {
    super.initState();
    if (UpdateCheck.build.isEmpty) return; // yerel geliştirme derlemesi
    Future<void>.delayed(const Duration(seconds: 20), _check);
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => _check());
    _onVisible = ((web.Event _) {
      if (web.document.visibilityState == 'visible') _check();
    }).toJS;
    web.document.addEventListener('visibilitychange', _onVisible);
  }

  Future<void> _check() async {
    if (!mounted || _newer) return;
    try {
      final r = await web.window
          .fetch('hadi_build.txt?t=${DateTime.now().millisecondsSinceEpoch}'.toJS, web.RequestInit(cache: 'no-store'))
          .toDart;
      if (!r.ok) return;
      final remote = (await r.text().toDart).toDart.trim();
      // Etiket yalnızca rakamdır (yyyyMMddHHmmss); başka bir yanıt (ör. uygulama sayfası) yok sayılır.
      if (remote.isEmpty || !RegExp(r'^\d{8,}$').hasMatch(remote)) return;
      if (remote != UpdateCheck.build && remote.compareTo(UpdateCheck.build) > 0 && mounted) setState(() => _newer = true);
    } catch (_) {}
  }

  @override
  void dispose() {
    _timer?.cancel();
    final f = _onVisible;
    if (f != null) web.document.removeEventListener('visibilitychange', f);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final show = _newer && !_dismissed;
    final bottom = MediaQuery.paddingOf(context).bottom;
    final dark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    final fill = HadiColors.brandFill(HadiColors.heyecan);
    return Stack(textDirection: TextDirection.ltr, children: [
      widget.child,
      if (show)
        Positioned(
          left: 12,
          right: 12,
          bottom: widget.bottomOffset + bottom,
          // PointerInterceptor: oyun sahnesinin (iframe) üstünde de Yenile'ye dokunulabilsin.
          child: PointerInterceptor(
            child: Directionality(
            textDirection: TextDirection.ltr,
            child: Material(
              color: dark ? const Color(0xFF1E2833) : Colors.white,
              elevation: 10,
              shadowColor: Colors.black.withValues(alpha: .35),
              borderRadius: BorderRadius.circular(20),
              child: DefaultTextStyle(
                style: TextStyle(fontFamily: 'Bricolage', color: dark ? const Color(0xFFF3EEE8) : const Color(0xFF1F1A16), decoration: TextDecoration.none),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
                  child: Row(children: [
                    Icon(Icons.system_update_rounded, color: fill.bg, size: 26),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('HADİ güncellendi', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                        SizedBox(height: 2),
                        Text('Yeni sürümü açmak için yenile.', style: TextStyle(fontSize: 12.5, height: 1.3)),
                      ]),
                    ),
                    FilledButton(
                      onPressed: () => web.window.location.reload(),
                      style: FilledButton.styleFrom(backgroundColor: fill.bg, foregroundColor: fill.fg, minimumSize: const Size(0, 40)),
                      child: const Text('Yenile', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                    IconButton(onPressed: () => setState(() => _dismissed = true), icon: const Icon(Icons.close_rounded, size: 20)),
                  ]),
                ),
              ),
            ),
          ),
          ),
        ),
    ]);
  }
}
