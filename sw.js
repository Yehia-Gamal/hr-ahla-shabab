const CACHE_NAME = "hr-attendance-v38-mobile-ui-stability-106";
const DEFAULT_OPEN_URL = "./employee/index.html#notifications";
const ASSETS = [
  "./health.html",
  "./index.html",
  "./employee/index.html",
  "./executive/index.html",
  "./operations-gate/index.html",
  "./admin/index.html",
  "./shared/offline.html",
  "./shared/css/styles.css",
  "./shared/css/neon-admin-theme.css",
  "./shared/css/v110-consolidated.css",
  "./shared/js/v102-enhancements.js",
  "./shared/css/employee.css",
    "./shared/js/api.js",
  "./shared/js/supabase-api.js",
  "./shared/js/supabase-config.js",
  "./shared/js/push.js",
  "./shared/js/employee-app.js",
  "./shared/js/attendance-identity.js",
  "./shared/js/attendance-v3-security.js",
  "./shared/js/attendance-v4-ops.js",
  "./shared/js/executive-app.js",
  "./shared/js/register-sw.js",
  "./shared/js/v104-ux-enhancements.js",
  "shared/css/v106-mobile-stability.css",
  "./shared/js/v106-mobile-stability.js",
  "./shared/js/v107-final-ui-polish.js",
  "./shared/js/v108-final-bugfix.js",
  "./shared/js/v109-final-system-fixes.js",
  "shared/css/v105-ui-fixes.css",
  "./shared/js/v105-ui-fixes.js",
  "./shared/js/runtime-diagnostics.js",
  "./shared/js/v9-hardening.js",
  "./shared/js/v10-private-deploy-fixes.js",
  "./shared/js/v101-deep-quality.js",
  "./shared/js/database.js",
  "./shared/js/app-admin.js",
  "./shared/pwa/manifest-admin.json",
  "./admin-login.html",
  "./shared/pwa/manifest.json",
  "./shared/pwa/manifest-employee.json",
  "./shared/pwa/manifest-executive.json",
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
  const data = payload.data || {};
  const urgentLocation = data.route === "location" || data.type === "LIVE_LOCATION_REQUEST";
  event.waitUntil(self.registration.showNotification(payload.title || "نظام الحضور", {
    body: payload.body || "لديك تنبيه جديد",
    icon: "./shared/images/icon-192.png",
    badge: "./shared/images/favicon-64.png",
    tag: payload.tag || "hr-notification",
    data,
    requireInteraction: urgentLocation,
    renotify: urgentLocation,
    silent: false,
    timestamp: Date.now(),
    vibrate: urgentLocation ? [400, 140, 400, 140, 800, 180, 800] : [120, 60, 120],
    actions: urgentLocation ? [
      { action: "open-location", title: "فتح وإرسال الموقع" },
      { action: "open-app", title: "فتح التطبيق" },
    ] : [{ action: "open-app", title: "فتح التطبيق" }],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  /* Handle action button clicks */
  const action = event.action || "";
  const data   = event.notification.data || {};
  let target;
  if (action === "open-location") {
    const scope = self.registration.scope;
    target = scope.includes("/employee/")
      ? new URL("./index.html#location", scope).href
      : new URL("./employee/index.html#location", scope).href;
  } else {
    target = notificationTargetUrl(data);
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const targetUrl = new URL(target);
      /* Try to re-use existing open window */
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        const sameOrigin = clientUrl.origin === targetUrl.origin;
        const sameApp = sameOrigin && (
          (clientUrl.pathname.includes("/employee/") && targetUrl.pathname.includes("/employee/")) ||
          (clientUrl.pathname.includes("/admin/")    && targetUrl.pathname.includes("/admin/"))    ||
          (clientUrl.pathname.includes("/executive/") && targetUrl.pathname.includes("/executive/"))
        );
        if (sameApp) {
          if ("navigate" in client) return client.navigate(target).then((f) => f?.focus?.() ?? f);
          if ("focus"    in client) return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    })
  );
});

function notificationTargetUrl(data = {}) {
  const raw = String(data.url || "").trim();
  if (data.route === "location" || data.type === "LIVE_LOCATION_REQUEST") {
    const basePath = new URL(self.registration.scope).pathname;
    const path = basePath.includes("/employee/") ? "./index.html#location" : "./employee/index.html#location";
    return new URL(path, self.registration.scope).href;
  }
  if (raw.startsWith("/employee/")) {
    const hash = raw.includes("#") ? raw.slice(raw.indexOf("#")) : "";
    const basePath = new URL(self.registration.scope).pathname;
    return new URL(basePath.includes("/employee/") ? `./index.html${hash}` : `.${raw}`, self.registration.scope).href;
  }
  return new URL(raw || DEFAULT_OPEN_URL, self.registration.scope).href;
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
