import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart' show SemanticsBinding;
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:hadi/app.dart' show HadiApp;
import 'package:hadi/core/analytics.dart';
import 'package:hadi/core/keep_awake.dart';
import 'package:hadi/core/money.dart' show CurrencyRate;
import 'package:hadi/core/recent_errors.dart';
import 'package:hadi/core/reliability/crash_reporting.dart';
import 'package:hadi/core/theme_presets.dart' show ThemeController;
import 'package:hadi/core/web_url.dart';
import 'package:hadi/core/web_support.dart';
import 'package:hadi/data/demo_services.dart' show DemoApplicationService;
import 'package:hadi/data/services.dart';
import 'package:hadi/features/wallet/card_checkout.dart' show installCardCheckout;
import 'package:hadi/features/secondhand/sh_routes.dart' show registerSecondhandHooks;
import 'package:hadi/features/creator_subs/creator_page.dart' show registerCreatorSubsHooks;

import 'app/web_options.dart';
import 'app/install_nudge.dart';
import 'app/update_check.dart';
import 'app/web_frame.dart';

/// Yalnızca yerel deneme: `--dart-define=PANEL_DEMO=true` ile Firebase'siz, uygulamanın demo verisiyle açılır.
const _demo = bool.fromEnvironment('PANEL_DEMO');

Future<void> main() => CrashReporting.runGuarded(_main);

Future<void> _main() async {
  WidgetsFlutterBinding.ensureInitialized();
  usePathUrlStrategy(); // hadisosyal.com/... bağlantıları uygulamadaki yollarla aynı (#'siz)
  WebUrl.install(); // gezinince adres çubuğu değişir; adres kopyalanıp paylaşılabilir (hadi › core/web_url.dart)
  WebSupport.install();
  Services services;
  var firebaseOk = false;
  if (_demo) {
    SemanticsBinding.instance.ensureSemantics(); // otomatik deneme (erişilebilirlik ağacıyla tıklama)
    services = Services.demo();
    (services.applications as DemoApplicationService).approve();
  } else if (!HadiWebOptions.configured) {
    runApp(const WebConfigMissing());
    return;
  } else {
    await Firebase.initializeApp(options: HadiWebOptions.web);
    firebaseOk = true;
    services = Services.firebase();
    CurrencyRate.start();
  }
  await Analytics.instance.loadConsent();
  await ThemeController.instance.load();
  KeepAwake.instance.init();
  await CrashReporting.instance.init(firebaseReady: firebaseOk);
  RecentErrors.install();
  registerSecondhandHooks(); // HADİ 2. El: grup bit pazarı + profesyonel profil kancaları
  registerCreatorSubsHooks(); // Üye abonelikleri: profesyonel profilde kademeler + Abone ol
  installCardCheckout(); // Kartla ödeme: web'de iyzico sayfası yeni sekmede (card_checkout.dart)
  // Uygulamanın dışındaki düğmeler (tanıtım, "ana ekrana ekle" kartı) için odak sırası widget sırasıyla belirlenir:
  // varsayılan (konuma göre) sıralama, tarayıcı sekmesi odak alınca ilk kare çizilmeden çalışıp
  // "RenderBox was not laid out" hatası veriyordu. Uygulamanın içindeki sıra değişmez.
  runApp(FocusTraversalGroup(
    policy: WidgetOrderTraversalPolicy(),
    child: WebFrame(child: UpdateCheck(child: InstallNudge(child: HadiApp(services: services)))),
  ));
}
