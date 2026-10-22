import 'package:firebase_core/firebase_core.dart';

/// Firebase web uygulaması ayarları. Değerler koda yazılmaz: derlemede `--dart-define-from-file=web_config.json`
/// (yerel, depoya girmez) ya da CI'da depo gizlileriyle verilir (README › Firebase web ayarları).
/// Bunlar istemci tanımlayıcılarıdır (gizli anahtar değildir); erişimi Firebase kuralları ve sunucu korur.
abstract final class HadiWebOptions {
  static const _apiKey = String.fromEnvironment('FB_API_KEY');
  static const _appId = String.fromEnvironment('FB_APP_ID');
  static const _senderId = String.fromEnvironment('FB_SENDER_ID');
  static const _measurementId = String.fromEnvironment('FB_MEASUREMENT_ID');

  static bool get configured => _apiKey.isNotEmpty && _appId.isNotEmpty && _senderId.isNotEmpty;

  static FirebaseOptions get web => const FirebaseOptions(
        apiKey: _apiKey,
        appId: _appId,
        messagingSenderId: _senderId,
        projectId: 'hadi-a0db3',
        authDomain: 'hadi-a0db3.firebaseapp.com',
        storageBucket: 'hadi-a0db3.firebasestorage.app',
        measurementId: _measurementId == '' ? null : _measurementId,
      );
}
