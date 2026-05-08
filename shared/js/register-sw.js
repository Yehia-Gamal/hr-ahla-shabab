// Service Worker registration is portal-scoped so employee devices do not cache admin UI.
const HR_SW_CACHE_NAME = "hr-attendance-v31-production-hardening-089-exec-gps-live";
const HR_SW_VERSION = "v31-production-hardening-089-exec-gps-live";

function portalServiceWorkerConfig() {
  const path = location.pathname.toLowerCase();
  if (path.includes("/admin/")) return { url: "../sw-admin.js", scope: "./" };
  if (path.includes("/executive/")) return { url: "../sw-executive.js", scope: "./" };
  if (path.includes("/employee/")) return { url: "../sw-employee.js", scope: "./" };
  return { url: "./sw-employee.js", scope: "./employee/" };
}

async function clearOldHrCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("hr-attendance") && !key.includes(HR_SW_VERSION))
      .map((key) => caches.delete(key)),
  );
}

async function unregisterLegacyRootWorkers(expectedUrl) {
  const regs = await navigator.serviceWorker.getRegistrations();
  const expectedName = String(expectedUrl || "").split("?")[0].split("/").pop();
  await Promise.all(regs.map(async (reg) => {
    const script = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || "";
    const scriptName = script.split("?")[0].split("/").pop();
    const scopePath = new URL(reg.scope).pathname;
    const rootScope = scopePath === "/" || scopePath === "/HR-Operations-Platform/";
    // Keep the current portal worker; only remove old root/global workers that can hijack fetches.
    if (rootScope && scriptName !== expectedName) {
      await reg.unregister().catch(() => undefined);
    }
  }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notifyWaitingWorker(registration) {
  const worker = registration?.waiting;
  if (!worker) return;
  try { worker.postMessage({ type: "SKIP_WAITING" }); } catch {}
}

function watchServiceWorkerUpdates(registration) {
  if (!registration) return;
  notifyWaitingWorker(registration);
  registration.addEventListener?.("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener?.("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) notifyWaitingWorker(registration);
    });
  });
}


async function registerPortalServiceWorker(swUrl, scope) {
  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope, updateViaCache: "none" });
    await registration.update().catch(() => null);
    return registration;
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    const existing = await navigator.serviceWorker.getRegistration(scope).catch(() => null);
    await existing?.unregister?.().catch(() => undefined);
    await wait(600);
    try {
      const registration = await navigator.serviceWorker.register(swUrl, { scope, updateViaCache: "none" });
      await registration.update().catch(() => null);
      return registration;
    } catch (retryError) {
      console.info("تأجيل تسجيل Service Worker لهذه الزيارة بعد تضارب تحديث مؤقت.", retryError?.message || retryError);
      return existing || null;
    }
  }
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (sessionStorage.getItem("hr.sw.controllerReloaded") === HR_SW_VERSION) return;
    sessionStorage.setItem("hr.sw.controllerReloaded", HR_SW_VERSION);
    location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      await clearOldHrCaches();
      const cfg = portalServiceWorkerConfig();
      const swUrl = `${cfg.url}?v=${HR_SW_VERSION}`;
      await unregisterLegacyRootWorkers(cfg.url);
      const registration = await registerPortalServiceWorker(swUrl, cfg.scope);
      watchServiceWorkerUpdates(registration);
    } catch (error) {
      console.info("تعذر تحديث Service Worker مؤقتاً، سيعمل التطبيق بدون كاش محدث في هذه الزيارة.", error?.message || error);
    }
  });
}

window.HR_CLEAR_APP_CACHE = async function HR_CLEAR_APP_CACHE() {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => { try { reg.active?.postMessage?.({ type: "CLEAR_HR_CACHES" }); } catch {} return reg.unregister(); }));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  location.reload();
};
