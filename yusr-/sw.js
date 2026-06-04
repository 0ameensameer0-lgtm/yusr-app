// اسم الكاش يتغير مع كل إصدار حتى يحصل المستخدم على أحدث ملفات التطبيق.
const CACHE_NAME = "yusr-cache-v343";

// الملفات الأساسية التي يجب توفرها عند فتح التطبيق بدون إنترنت.
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./styles/responsive.css",
  "./assets/icons/lucide.min.js",
  "./vendor/xlsx.full.min.js",
  "./firebase-config.js",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./assets/icon-192.svg",
  "./assets/icon-512.svg",
  "./assets/yusr-app-icon.png",
  "./assets/yusr-logo.png",
  "./assets/assistant-robot.json",
  "./assets/payments/alkuraimi.png",
  "./assets/payments/jeeb.png",
  "./assets/payments/floosak.png",
  "./utils/dom.js",
  "./utils/i18n.js",
  "./utils/security.js",
  "./utils/demo-data.js",
  "./components/toast.js",
  "./components/modal.js",
  "./components/charts.js",
  "./services/firebase-service.js",
  "./services/store.js",
  "./services/sync-service.js",
  "./services/export-service.js",
  "./services/license-service.js",
  "./services/notification-service.js",
  "./services/assistant-service.js",
  "./roles/index.js",
  "./roles/teacher-role.js",
  "./roles/managed-teacher-role.js",
  "./roles/delegate-role.js",
  "./roles/managed-delegate-role.js",
  "./roles/supervisor-role.js",
  "./pages/home.js",
  "./pages/subject.js",
  "./pages/schedule.js",
  "./pages/settings.js",
  "./pages/admin.js"
];

// عند تثبيت Service Worker نخزن ملفات التطبيق الأساسية مباشرة.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

// عند تفعيل نسخة جديدة نحذف الكاش القديم حتى لا تظهر ملفات قديمة.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// تستخدمها نافذة التحديث لإجبار Service Worker الجديد على العمل فورًا.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// عند الضغط على إشعار الحصة نفتح التطبيق على صفحة الحصص.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "#/schedule";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((item) => "focus" in item);
      if (client) {
        client.navigate(targetUrl);
        return client.focus();
      }
      return self.clients.openWindow(`./index.html${targetUrl}`);
    })
  );
});

// استراتيجية التحميل: الشبكة أولًا للصفحات والملفات المرئية، والكاش احتياط عند انقطاع النت.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isVersionedAsset = url.origin === self.location.origin && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"));
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  if (isVersionedAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request) || caches.match(url.pathname))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((exactCached) => {
      const cachedPromise = exactCached ? Promise.resolve(exactCached) : caches.match(event.request, { ignoreSearch: true });
      return cachedPromise.then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("./index.html"));
      return cached || network;
      });
    })
  );
});
