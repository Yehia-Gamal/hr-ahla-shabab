const DIAGNOSTICS_VERSION = "v33-ui-ux-overhaul-101";
const ok = (label, detail = "جاهز", extra = {}) => ({ label, ok: true, level: "ok", detail, ...extra });
const warn = (label, detail = "يحتاج مراجعة", extra = {}) => ({ label, ok: false, level: "warn", detail, ...extra });
const bad = (label, detail = "غير جاهز", extra = {}) => ({ label, ok: false, level: "bad", detail, ...extra });
const text = (value) => String(value ?? "");

function shortUrl(value = "") {
  try { const url = new URL(value); return `${url.protocol}//${url.hostname}`; }
  catch { return value ? "رابط غير صالح" : "غير محدد"; }
}

function normalizePermissionState(value) {
  if (value === "granted") return "مسموح";
  if (value === "denied") return "مرفوض";
  if (value === "prompt") return "ينتظر طلب الإذن";
  if (value === "unsupported") return "غير مدعوم";
  return value || "غير معروف";
}

async function queryPermission(name) {
  try {
    if (!navigator.permissions?.query) return "unsupported";
    const result = await navigator.permissions.query({ name });
    return result.state || "unknown";
  } catch { return "unsupported"; }
}

async function cacheSummary() {
  try {
    if (!("caches" in window)) return warn("Cache Storage", "غير مدعوم في هذا المتصفح");
    const keys = await caches.keys();
    const hrKeys = keys.filter((key) => key.startsWith("hr-attendance"));
    const stale = hrKeys.filter((key) => !key.includes(DIAGNOSTICS_VERSION));
    if (stale.length) return warn("كاش التطبيق", `يوجد ${stale.length} كاش قديم: ${stale.join(" / ")}`);
    return ok("كاش التطبيق", hrKeys.length ? `${hrKeys.length} كاش محدث` : "لا يوجد كاش بعد أول تشغيل");
  } catch (error) { return warn("كاش التطبيق", error?.message || "تعذر فحص الكاش"); }
}

async function serviceWorkerSummary() {
  try {
    if (!("serviceWorker" in navigator)) return warn("Service Worker", "غير مدعوم");
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) return warn("Service Worker", "لم يتم تسجيله بعد — أعد تحميل الصفحة بعد النشر");
    const versions = regs.map((reg) => (reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || reg.scope).split("/").pop());
    const current = versions.some((item) => item.includes(DIAGNOSTICS_VERSION) || item.includes("089"));
    return current ? ok("Service Worker", versions.join(" / ")) : warn("Service Worker", `قد تكون نسخة قديمة: ${versions.join(" / ")}`);
  } catch (error) { return warn("Service Worker", error?.message || "تعذر فحص Service Worker"); }
}

async function browserPermissionChecks() {
  const notificationState = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const geoState = await queryPermission("geolocation");
  const cameraState = await queryPermission("camera");
  return [
    notificationState === "granted" ? ok("إذن الإشعارات", normalizePermissionState(notificationState)) : warn("إذن الإشعارات", normalizePermissionState(notificationState)),
    geoState === "granted" || geoState === "prompt" || geoState === "unsupported" ? ok("إذن الموقع", normalizePermissionState(geoState)) : warn("إذن الموقع", normalizePermissionState(geoState)),
    cameraState === "granted" || cameraState === "prompt" || cameraState === "unsupported" ? ok("إذن الكاميرا/السيلفي", normalizePermissionState(cameraState)) : warn("إذن الكاميرا/السيلفي", normalizePermissionState(cameraState)),
  ];
}

function pwaCapabilityChecks() {
  return [
    "serviceWorker" in navigator ? ok("PWA Service Worker API", "مدعوم") : bad("PWA Service Worker API", "غير مدعوم"),
    "PushManager" in window ? ok("Push API", "مدعوم") : warn("Push API", "غير مدعوم على هذا المتصفح/الوضع"),
    "Notification" in window ? ok("Notification API", "مدعوم") : warn("Notification API", "غير مدعوم"),
    navigator.mediaDevices?.getUserMedia ? ok("Camera API", "مدعوم") : warn("Camera API", "قد لا تعمل سيلفي البصمة"),
    navigator.geolocation ? ok("Geolocation API", "مدعوم") : bad("Geolocation API", "غير مدعوم — الموقع لن يعمل"),
    window.isSecureContext ? ok("HTTPS / Secure Context", "آمن") : warn("HTTPS / Secure Context", "يفضل HTTPS؛ بعض مزايا PWA لا تعمل بدونه"),
  ];
}

function configChecks() {
  const cfg = window.HR_SUPABASE_CONFIG || {};
  const checks = [];
  checks.push(window.__HR_SUPABASE_CONFIG_LOADED__ ? ok("ملف الإعدادات", text(window.__HR_SUPABASE_CONFIG_VERSION__ || DIAGNOSTICS_VERSION)) : bad("ملف الإعدادات", "shared/js/supabase-config.js لم يتم تحميله"));
  const urlOk = /^https:\/\/[^\s]+\.supabase\.co$/.test(text(cfg.url));
  const anonOk = text(cfg.anonKey).length > 20 && !/service_role|secret|password|token/i.test(text(cfg.anonKey));
  checks.push(urlOk ? ok("Supabase URL", shortUrl(cfg.url)) : bad("Supabase URL", shortUrl(cfg.url)));
  checks.push(anonOk ? ok("Supabase Anon Key", "مفتاح public فقط — لا يتم عرضه") : bad("Supabase Anon Key", "مفقود أو يبدو غير صحيح"));
  checks.push(cfg.strict === true ? ok("Strict Mode", "مفعل") : warn("Strict Mode", "يفضل تفعيله في الإنتاج"));
  checks.push(cfg.security?.allowLocalFallback === false ? ok("منع Local Fallback", "مفعل") : warn("منع Local Fallback", "يفضل منعه في الإنتاج"));
  checks.push(cfg.attendance?.branchLocation?.latitude && cfg.attendance?.branchLocation?.longitude ? ok("إحداثيات المجمع", `${cfg.attendance.branchLocation.latitude}, ${cfg.attendance.branchLocation.longitude}`) : bad("إحداثيات المجمع", "غير محددة"));
  checks.push(cfg.push?.vapidPublicKey ? ok("VAPID Public Key", "موجود") : warn("VAPID Public Key", "غير موجود؛ إشعارات Push لن تُفعّل"));
  checks.push(cfg.deployment?.expectedPatch ? ok("SQL Patch المتوقع", cfg.deployment.expectedPatch) : warn("SQL Patch المتوقع", "غير محدد"));
  return checks;
}

async function supabaseConnectivityCheck() {
  const cfg = window.HR_SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) return warn("اختبار اتصال Supabase", "URL أو anon key غير مكتمل");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${cfg.url}/rest/v1/`, { method: "GET", headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` }, signal: controller.signal });
    clearTimeout(timer);
    if ([200, 401, 404].includes(response.status)) return ok("اختبار اتصال Supabase", `وصل الخادم: HTTP ${response.status}`);
    return warn("اختبار اتصال Supabase", `استجابة غير متوقعة: HTTP ${response.status}`);
  } catch (error) { return warn("اختبار اتصال Supabase", error?.name === "AbortError" ? "انتهت مهلة الاتصال" : (error?.message || "فشل الاتصال")); }
}

export async function runRuntimeDiagnostics({ includeNetwork = true } = {}) {
  const results = [...configChecks(), ...pwaCapabilityChecks(), ...(await browserPermissionChecks()), await serviceWorkerSummary(), await cacheSummary()];
  if (includeNetwork) results.push(await supabaseConnectivityCheck());
  const weights = { ok: 1, warn: 0.55, bad: 0 };
  const score = Math.round((results.reduce((sum, item) => sum + (weights[item.level] ?? 0), 0) / Math.max(results.length, 1)) * 100);
  const blockers = results.filter((item) => item.level === "bad");
  const warnings = results.filter((item) => item.level === "warn");
  return { version: DIAGNOSTICS_VERSION, generatedAt: new Date().toISOString(), score, blockers, warnings, results };
}

export async function clearRuntimeCaches({ reload = false } = {}) {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => { try { reg.active?.postMessage?.({ type: "CLEAR_HR_CACHES" }); } catch {} return reg.unregister().catch(() => undefined); }));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("hr-attendance")).map((key) => caches.delete(key)));
  }
  try { Object.keys(localStorage).filter((key) => key.startsWith("hr.runtime.")).forEach((key) => localStorage.removeItem(key)); } catch {}
  if (reload) location.reload();
}

export async function testLocalNotification() {
  if (!("Notification" in window)) throw new Error("هذا المتصفح لا يدعم Notification API.");
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("لم يتم السماح بالإشعارات من المتصفح.");
  }
  const registration = await navigator.serviceWorker?.ready?.catch(() => null);
  const payload = { body: "اختبار محلي للتأكد من ظهور الإشعار على الجهاز.", icon: "./shared/images/icon-192.png", badge: "./shared/images/favicon-64.png", tag: "hr-runtime-diagnostic-test", requireInteraction: false };
  if (registration?.showNotification) return registration.showNotification("اختبار إشعار أحلى شباب HR", payload);
  return new Notification("اختبار إشعار أحلى شباب HR", payload);
}

export function downloadDiagnosticsReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hr-runtime-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
