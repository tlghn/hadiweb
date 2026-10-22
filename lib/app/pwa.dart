import 'dart:js_interop';

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

// index.html'deki `window.hadiPwa` köprüsü: tarayıcının "yükle" isteğini (beforeinstallprompt) saklar.
@JS('hadiPwa.canPrompt')
external bool _canPrompt();
@JS('hadiPwa.prompt')
external JSPromise<JSString> _prompt();
@JS('hadiPwa.standalone')
external bool _standalone();
@JS('hadiPwa.isIos')
external bool _isIos();
@JS('hadiPwa')
external JSObject? get _bridge;

/// Ana ekrana ekleme (PWA) durumu. Android Chrome, Edge ve masaüstü Chrome'da tarayıcının kendi yükleme penceresi açılır;
/// iPhone/iPad'de böyle bir pencere yoktur, Paylaş › Ana Ekrana Ekle adımları gösterilir.
class Pwa {
  Pwa._() {
    if (_bridge == null) return;
    _refresh();
    web.window.addEventListener('hadi-install-ready', ((web.Event _) => _refresh()).toJS);
    web.window.addEventListener('appinstalled', ((web.Event _) => _refresh()).toJS);
  }

  static final instance = Pwa._();

  /// Tarayıcı yükleme penceresi açılabilir mi?
  final ValueNotifier<bool> canPrompt = ValueNotifier(false);

  bool get _ok => _bridge != null;

  /// Zaten ana ekrandan (uygulama penceresinde) açıldı mı?
  bool get standalone => _ok && _standalone();

  /// iPhone / iPad (yükleme penceresi yok; elle eklenir).
  bool get isIos => _ok && _isIos();

  /// Bu tarayıcıda ana ekrana eklemek mümkün mü?
  bool get available => !standalone && (canPrompt.value || isIos);

  void _refresh() => canPrompt.value = _ok && _canPrompt();

  /// Tarayıcının yükleme penceresini açar. Sonuç: 'accepted' | 'dismissed' | 'unavailable'.
  Future<String> prompt() async {
    if (!_ok) return 'unavailable';
    try {
      final r = (await _prompt().toDart).toDart;
      _refresh();
      return r;
    } catch (_) {
      _refresh();
      return 'unavailable';
    }
  }

  // ---- Bu tarayıcıda hatırlananlar (localStorage; erişilemezse sessizce geçer)

  static const _dismissKey = 'hadi.pwa.dismissedAt';

  /// Üye "şimdi değil" dediyse 14 gün sormayız.
  bool get recentlyDismissed {
    try {
      final v = web.window.localStorage.getItem(_dismissKey);
      final at = int.tryParse(v ?? '');
      if (at == null) return false;
      return DateTime.now().millisecondsSinceEpoch - at < const Duration(days: 14).inMilliseconds;
    } catch (_) {
      return false;
    }
  }

  void dismiss() {
    try {
      web.window.localStorage.setItem(_dismissKey, '${DateTime.now().millisecondsSinceEpoch}');
    } catch (_) {}
  }
}
