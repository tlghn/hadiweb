// HADİ Web: tarayıcı bildirimleri (Firebase Cloud Messaging, web push).
// Sekme kapalıyken ya da arka plandayken gelen bildirimi gösterir; dokununca ilgili sayfayı açar (sekme açıksa ona geçer).
// Firebase yapılandırması derlemede web_config.json'dan yazılır (tools/build.ps1 › __FB_*__). Sekme ön plandayken bildirim
// uygulama içinde (üstteki kart) gösterilir; bu dosya yalnızca arka planı yönetir.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '__FB_API_KEY__',
  authDomain: 'hadi-a0db3.firebaseapp.com',
  projectId: 'hadi-a0db3',
  messagingSenderId: '__FB_SENDER_ID__',
  appId: '__FB_APP_ID__',
});

// Bildirime dokunma (Firebase'in kendi bildirimleri dahil). Firebase'in işleyicisinden ÖNCE kaydedilir ve onu durdurur:
// Firebase açık HADİ sekmesi olsa bile her dokunuşta yeni sekme açıyordu. Burada: açık HADİ sekmesine (iframe değil,
// üst pencere) geçilir ve sayfa uygulama içinde açılır; sekme yoksa yeni sekme. Bildirim Stüdyosu düğmeleri (b0, b1…)
// kendi bağlantısını açar. Yedek gösterim ve sekme odak dışıyken uygulamanın gösterdiği bildirimler data.link taşır.
self.addEventListener('notificationclick', (e) => {
  const nd = e.notification.data || {};
  const fcm = nd.FCM_MSG || null;
  const fd = (fcm && fcm.data) || {};
  let link = (e.action && (fd[e.action] || nd[e.action])) || nd.link || fd.link || (fcm && fcm.fcmOptions && fcm.fcmOptions.link) || '/';
  e.stopImmediatePropagation();
  e.notification.close();
  const abs = new URL(link, self.location.origin);
  // Aynı kökenli mutlak adres uygulama yoluna çevrilir (sunucu fcmOptions.link'i https://hadisosyal.com/... yazar).
  const inApp = abs.origin === self.location.origin;
  if (inApp) link = abs.pathname + abs.search + abs.hash;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tabs = all.filter((c) => new URL(c.url).origin === self.location.origin && c.frameType !== 'nested' && !new URL(c.url).pathname.startsWith('/film3/'));
    if (inApp && tabs.length) {
      const c = tabs.find((x) => x.focused) || tabs.find((x) => x.visibilityState === 'visible') || tabs[0];
      try { await c.focus(); } catch (_) { /* odak izni yok */ }
      try { c.postMessage({ type: 'hadi-open', link }); } catch (_) { /* eski sekme */ }
      return;
    }
    await self.clients.openWindow(abs.href);
  })());
});

const messaging = firebase.messaging();

// "notification" alanı olan iletileri Firebase kendisi gösterir (sunucu webpush.notification + fcmOptions.link yazar).
// Yalnızca veri taşıyan iletiler için yedek gösterim:
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const d = payload.data || {};
  if (!d.title && !d.body) return;
  return self.registration.showNotification(d.title || 'HADİ', {
    body: d.body || '',
    icon: '/icons/Icon-192.png',
    badge: '/icons/badge-72.png',
    tag: d.tag || undefined,
    data: { link: d.link || '/' },
  });
});
