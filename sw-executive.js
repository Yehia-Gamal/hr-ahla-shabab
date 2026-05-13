// Versioned cache name; bump when updating deployment.packageVersion or cacheVersion
const CACHE_NAME = "hr-attendance-v45-punch-note-session-fix";
const DEFAULT_OPEN_URL = "./executive/index.html";
const ASSETS = [
  "./health.html",
  "./executive/index.html",
  "./operations-gate/index.html",
  "./shared/offline.html",
  "./shared/js/executive-app.js",
  "./shared/js/database.js",
  "./shared/pwa/manifest-executive.json",
  "./index.html",
  "./shared/css/styles.css",
  "./shared/css/neon-admin-theme.css",
  "./shared/css/v110-consolidated.css",
  "./shared/js/v102-enhancements.js",
  "./shared/js/api.js",
  "./shared/js/supabase-api.js",
  "./shared/js/supabase-config.js",
  "./shared/js/push.js",
  "./shared/js/register-sw.js",
  "./shared/js/runtime-diagnostics.js",
  "./shared/js/v9-hardening.js",
  "./shared/js/v10-private-deploy-fixes.js",
  "./shared/js/v101-deep-quality.js",
  "./shared/js/v106-mobile-stability.js",
  "./shared/js/v107-final-ui-polish.js",
  "./shared/js/v108-final-bugfix.js",
  "./shared/js/v109-final-system-fixes.js",
  "./shared/js/v105-ui-fixes.js",
  "./shared/pwa/manifest.json",
  "./shared/images/ahla-shabab-logo.png",
  "./shared/images/favicon-64.png",
  "./shared/images/icon-192.png",
  "./shared/images/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => undefined));
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
  const target = notificationTargetUrl(event.notification.data || {}, event.action || "");
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    const targetUrl = new URL(target);
    for (const client of clientList) {
      const clientUrl = new URL(client.url);
      const sameOrigin = clientUrl.origin === targetUrl.origin;
      const sameApp = sameOrigin && (
        (clientUrl.pathname.includes("/employee/") && targetUrl.pathname.includes("/employee/")) ||
        (clientUrl.pathname.includes("/admin/") && targetUrl.pathname.includes("/admin/")) ||
        (clientUrl.pathname.includes("/executive/") && targetUrl.pathname.includes("/executive/")) ||
        (!clientUrl.pathname.includes("/employee/") && !clientUrl.pathname.includes("/admin/") && !clientUrl.pathname.includes("/executive/"))
      );
      if (sameApp && "navigate" in client) return client.navigate(target).then((focused) => focused?.focus?.() || focused);
      if (sameApp && "focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
    return undefined;
  }));
});

function notificationTargetUrl(data = {}, action = "") {
  const scope = self.registration.scope;
  const basePath = new URL(scope).pathname;
  const requested = String(data.url || "").trim();
  const isLocation = action === "open-location" || data.route === "location" || data.type === "LIVE_LOCATION_REQUEST";
  if (isLocation) {
    return new URL(basePath.includes("/employee/") ? "./index.html#location" : "./employee/index.html#location", scope).href;
  }
  if (requested.startsWith("/employee/") || requested.startsWith("/admin/") || requested.startsWith("/executive/")) {
    return new URL(`.${requested}`, scope).href;
  }
  if (requested.startsWith("#")) return new URL(`./index.html${requested}`, scope).href;
  try {
    const absolute = new URL(requested, scope);
    if (absolute.origin === new URL(scope).origin) return absolute.href;
  } catch {}
  return new URL(DEFAULT_OPEN_URL, scope).href;
}

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
