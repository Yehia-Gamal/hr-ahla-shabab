// Versioned cache name; bump when updating deployment.packageVersion or cacheVersion
const CACHE_NAME = "hr-attendance-v31-production-hardening-089-direct-location";
const DEFAULT_OPEN_URL = "./admin/index.html";
const ASSETS = [
  "./health.html",
  "./admin/index.html",
  "./admin-login.html",
  "./operations-gate/index.html",
  "./shared/offline.html",
  "./shared/js/app-admin.js",
  "./shared/pwa/manifest-admin.json",
  "./index.html",
  "./shared/css/styles.css",
  "./shared/css/neon-admin-theme.css",
  "./shared/css/v10-private-deploy-theme.css",
  "./shared/js/api.js",
  "./shared/js/supabase-api.js",
  "./shared/js/supabase-config.js",
  "./shared/js/push.js",
  "./shared/js/register-sw.js",
  "./shared/js/runtime-diagnostics.js",
  "./shared/js/v9-hardening.js",
  "./shared/js/v10-private-deploy-fixes.js",
  "./shared/pwa/manifest.json",
  "./shared/images/ahla-shabab-logo.png",
  "./shared/images/favicon-64.png",
  "./shared/images/icon-192.png",
  "./shared/images/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch((error) => console.warn("HR cache install skipped", error)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("hr-attendance") && key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

function fallbackFor(request) {
  const url = new URL(request.url);
  if (url.pathname.includes("/admin/")) return caches.match("./admin/index.html");
  if (url.pathname.includes("/executive/")) return caches.match("./executive/index.html");
  if (url.pathname.includes("/employee/")) return caches.match("./employee/index.html");
  return caches.match("./index.html");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/rest/v1/") || url.pathname.includes("/functions/v1/") || url.hostname.endsWith("supabase.co")) {
    return;
  }
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || fallbackFor(event.request) || caches.match("./shared/offline.html"))),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "نظام الحضور", body: "لديك تنبيه جديد" };
  try { payload = event.data ? event.data.json() : payload; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || "نظام الحضور", {
    body: payload.body || "لديك تنبيه جديد",
    icon: "./shared/images/icon-192.png",
    badge: "./shared/images/favicon-64.png",
    tag: payload.tag || "hr-notification",
    data: payload.data || {},
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || DEFAULT_OPEN_URL;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ("focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
    return undefined;
  }));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "hr-offline-sync") {
    event.waitUntil(self.clients.matchAll().then((clientsList) => clientsList.forEach((client) => client.postMessage({ type: "SYNC_OFFLINE_QUEUE" }))));
  }
});


self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "CLEAR_HR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("hr-attendance")).map((key) => caches.delete(key)))));
  }
});
