import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hadi/core/app_hooks.dart';
import 'package:hadi/core/session.dart';
import 'package:hadi/theme/hadi_colors.dart';

import 'pwa.dart';

/// Giriş yapmış üyeye, uygulamayı biraz kullandıktan sonra bir kez: "HADİ'yi ana ekrana ekle" kartı.
/// Ana ekrandan açıldıysa, tarayıcı desteklemiyorsa ya da üye son 14 günde "şimdi değil" dediyse görünmez.
/// Uygulamanın üstünde, alt menünün hemen üstünde durur; uygulamanın kendi ekranlarına dokunmaz.
class InstallNudge extends StatefulWidget {
  const InstallNudge({super.key, required this.child});
  final Widget child;

  /// Giriş yapıldıktan kaç saniye sonra.
  static const delay = Duration(seconds: 25);

  @override
  State<InstallNudge> createState() => _InstallNudgeState();
}

class _InstallNudgeState extends State<InstallNudge> {
  final _pwa = Pwa.instance;
  Session? _session;
  Timer? _timer, _poll;
  bool _show = false, _iosHelp = false, _busy = false;

  @override
  void initState() {
    super.initState();
    _pwa.canPrompt.addListener(_check);
    // HadiApp oturumu kurunca AppHooks'a bağlanır; o ana kadar kısa aralıklarla bakılır.
    _poll = Timer.periodic(const Duration(seconds: 1), (_) => _attach());
  }

  void _attach() {
    final s = AppHooks.session;
    if (s == null || identical(s, _session)) return;
    _session?.removeListener(_check);
    _session = s..addListener(_check);
    _poll?.cancel();
    _check();
  }

  bool get _eligible =>
      _session?.kind == SessionKind.approved && _pwa.available && !_pwa.recentlyDismissed;

  void _check() {
    if (!mounted) return;
    if (!_eligible) {
      _timer?.cancel();
      _timer = null;
      if (_show) setState(() => _show = false);
      return;
    }
    if (_show || _timer != null) return;
    _timer = Timer(InstallNudge.delay, () {
      if (mounted && _eligible) setState(() => _show = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _poll?.cancel();
    _session?.removeListener(_check);
    _pwa.canPrompt.removeListener(_check);
    super.dispose();
  }

  void _close({bool remember = true}) {
    if (remember) _pwa.dismiss();
    setState(() {
      _show = false;
      _iosHelp = false;
    });
  }

  Future<void> _add() async {
    if (_pwa.isIos && !_pwa.canPrompt.value) {
      setState(() => _iosHelp = true);
      return;
    }
    setState(() => _busy = true);
    final r = await _pwa.prompt();
    if (!mounted) return;
    setState(() => _busy = false);
    // Kabul ettiyse tarayıcı ekler; vazgeçtiyse 14 gün sormayız.
    if (r != 'unavailable') _close();
  }

  @override
  Widget build(BuildContext context) {
    final dark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    final bottom = MediaQuery.paddingOf(context).bottom;
    // MaterialApp'in dışındayız: yön bilgisi burada verilir.
    return Stack(textDirection: TextDirection.ltr, children: [
      widget.child,
      Positioned(
        left: 12,
        right: 12,
        bottom: 92 + bottom,
        child: IgnorePointer(
          ignoring: !_show,
          child: AnimatedSlide(
            offset: _show ? Offset.zero : const Offset(0, .35),
            duration: const Duration(milliseconds: 320),
            curve: Curves.easeOutCubic,
            child: AnimatedOpacity(
              opacity: _show ? 1 : 0,
              duration: const Duration(milliseconds: 240),
              child: _iosHelp ? _IosHelp(dark: dark, onClose: () => _close()) : _Card(dark: dark, busy: _busy, onAdd: _add, onLater: () => _close()),
            ),
          ),
        ),
      ),
    ]);
  }
}

class _Shell extends StatelessWidget {
  const _Shell({required this.dark, required this.child});
  final bool dark;
  final Widget child;

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.ltr,
        child: Material(
          color: dark ? const Color(0xFF1E2833) : Colors.white,
          elevation: 10,
          shadowColor: Colors.black.withValues(alpha: .35),
          borderRadius: BorderRadius.circular(20),
          child: DefaultTextStyle(
            style: TextStyle(fontFamily: 'Bricolage', color: dark ? const Color(0xFFF3EEE8) : const Color(0xFF1F1A16), decoration: TextDecoration.none),
            child: Padding(padding: const EdgeInsets.fromLTRB(14, 12, 8, 12), child: child),
          ),
        ),
      );
}

class _Card extends StatelessWidget {
  const _Card({required this.dark, required this.busy, required this.onAdd, required this.onLater});
  final bool dark, busy;
  final VoidCallback onAdd, onLater;

  @override
  Widget build(BuildContext context) {
    final fill = HadiColors.brandFill(HadiColors.heyecan);
    final sub = dark ? const Color(0xFFB9B1A8) : const Color(0xFF6B5B4E);
    return _Shell(
      dark: dark,
      child: Row(children: [
        ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network('icons/Icon-192.png', width: 44, height: 44, errorBuilder: (_, _, _) => const SizedBox(width: 44, height: 44))),
        const SizedBox(width: 12),
        Expanded(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('HADİ\'yi ana ekrana ekle', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            const SizedBox(height: 2),
            Text('Uygulama gibi tek dokunuşla, tam ekran açılır.', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, height: 1.3, color: sub)),
          ]),
        ),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: busy ? null : onAdd,
          style: FilledButton.styleFrom(backgroundColor: fill.bg, foregroundColor: fill.fg, padding: const EdgeInsets.symmetric(horizontal: 16), minimumSize: const Size(0, 40)),
          child: const Text('Ekle', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
        IconButton(onPressed: onLater, icon: Icon(Icons.close_rounded, size: 20, color: sub)),
      ]),
    );
  }
}

class _IosHelp extends StatelessWidget {
  const _IosHelp({required this.dark, required this.onClose});
  final bool dark;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final sub = dark ? const Color(0xFFB9B1A8) : const Color(0xFF6B5B4E);
    final accent = HadiColors.text(HadiColors.aktivite);
    Widget step(String n, IconData icon, String text) => Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(children: [
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: accent.withValues(alpha: .12), shape: BoxShape.circle),
              child: Text(n, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: accent)),
            ),
            const SizedBox(width: 10),
            Icon(icon, size: 20, color: accent),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5, height: 1.35))),
          ]),
        );
    return _Shell(
      dark: dark,
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Expanded(child: Text('Ana ekrana ekle', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
          IconButton(onPressed: onClose, icon: Icon(Icons.close_rounded, size: 20, color: sub)),
        ]),
        step('1', Icons.ios_share_rounded, 'Safari\'nin alt çubuğundaki Paylaş simgesine dokun.'),
        step('2', Icons.add_box_outlined, '“Ana Ekrana Ekle”yi seç.'),
        step('3', Icons.check_circle_outline_rounded, 'Sağ üstte “Ekle”ye dokun; HADİ ana ekranında.'),
        const SizedBox(height: 6),
      ]),
    );
  }
}
