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

const messaging = firebase.messaging();

// "notification" alanı olan iletileri Firebase kendisi gösterir (sunucu webpush.notification + fcmOptions.link yazar).
// Yalnızca veri taşıyan iletiler için yedek gösterim:
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const d = payload.data || {};
  if (!d.title && !d.body) return;
  self.registration.showNotification(d.title || 'HADİ', {
    body: d.body || '',
    icon: '/icons/Icon-192.png',
    badge: '/icons/badge-72.png',
    tag: d.tag || undefined,
    data: { link: d.link || '/' },
  });
});

// Yedek gösterimde dokunma: açık HADİ sekmesine geç ve sayfayı aç; yoksa yeni sekme.
self.addEventListener('notificationclick', (e) => {
  const link = (e.notification.data && (e.notification.data.link || (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.data && e.notification.data.FCM_MSG.data.link))) || '/';
  e.notification.close();
  const url = new URL(link, self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        try { c.postMessage({ type: 'hadi-open', link }); } catch (_) { /* eski sekme */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
