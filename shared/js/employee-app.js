import { endpoints, unwrap } from "./api.js?v=v117-system-cleanup";
import { enableWebPushSubscription } from "./push.js?v=v39-consolidated-stable-110";
import { getDeviceFingerprintHash, requestEmployeePasskey, filterEmployeePasskeys, calculateAttendanceRisk, rememberDevicePunch, capturePunchSelfie } from "./attendance-identity.js?v=v39-consolidated-stable-110";
import { ensureAttendancePolicyAcknowledged, ensureTrustedDeviceApproval, requestBranchQrChallenge, analyzeLocationTrust, mergeRiskSignals, submitFallbackAttendanceRequest } from "./attendance-v3-security.js?v=v39-consolidated-stable-110";
import { evaluateAttendanceV4Controls, mergeV4RiskSignals, createFormalFallbackRequest } from "./attendance-v4-ops.js?v=v39-consolidated-stable-110";

const debugEnabled = () => Boolean(globalThis.HR_DEBUG_LOGS || globalThis.HR_SUPABASE_CONFIG?.debug === true);
const debugWarn = (...args) => { if (debugEnabled()) globalThis.console?.warn?.(...args); };
const debugError = (...args) => { if (debugEnabled()) globalThis.console?.error?.(...args); };
const debugInfo = (...args) => { if (debugEnabled()) globalThis.console?.info?.(...args); };
document.documentElement.classList.add("employee-portal-root");
document.body.classList.add("employee-portal");

const app = document.querySelector("#app");
const FLASH_KEY = "hr.employee.flash";
const EMPLOYEE_TAB_SESSION_KEY = "hr.employee.authenticatedThisTab";
const EMPLOYEE_PERSIST_SESSION_KEY = "hr.employee.keepSignedIn";
const ATTENDANCE_FLOATING_SEEN_KEY = "hr.employee.attendanceFloatingReminderSeen";
const ATTENDANCE_BROWSER_SEEN_KEY = "hr.employee.attendanceBrowserReminderSeen";
const IDLE_MS = 30 * 60 * 1000;
let idleTimer = null;
let attendanceReminderTimer = null;
const state = {
  route: location.hash.replace("#", "") || "home",
  user: null,
  message: "",
  error: "",
  loginIdentifier: "",
  loginPassword: "",
  lastLoginFailed: false,
  recoveryMode: location.hash.includes("type=recovery") || location.search.includes("type=recovery"),
  registerMode: false,
};

const adminScopes = new Set(["*", "users:manage", "employees:write", "settings:manage", "audit:view"]);
const fullAccessRoles = new Set(["admin", "super-admin", "super_admin", "role-admin", "executive-secretary", "role-executive-secretary", "مدير النظام", "السكرتير التنفيذي"]);
const executiveOnlyRoles = new Set(["executive", "role-executive", "المدير التنفيذي"]);
const legacyEmployeeRoutes = [
  ["home", "الرئيسية", "⌂"],
  ["action-center", "مطلوب مني", "★"],
  ["kpi", "تقييمي", "◎"],
  ["punch", "البصمة", "◉"],
  ["location", "الموقع", "⌖"],
  ["leaves", "الإجازات", "✦"],
  ["missions", "المأموريات", "⇄"],
  ["requests", "طلباتي", "☰"],
  ["tasks", "مهامي", "✓"],
  ["daily-report", "تقريري", "✎"],
  ["documents", "مستنداتي", "▣"],
  ["policies", "السياسات", "§"],
  ["disputes", "شكوى", "!"],
  ["notifications", "الإشعارات", "●"],
  ["profile", "حسابي", "☺"],
];

const employeeRoutes = [
  ["home", "الرئيسية", "🏠"],
  ["action-center", "مطلوب مني", "⚡"],
  ["punch", "البصمة", "👁"],
  ["team", "فريقي", "👥"],
  ["more", "المزيد", "☰"],
];

const moreEmployeeRoutes = [
  ["notifications", "الإشعارات", "🔔"],
  ["manager-hub", "إدارة فريقي", "🧭"],
  ["manager-kpi", "KPI فريقي", "📊"],
  ["committee-hub", "لجنة الخلافات", "⚖️"],
  ["kpi", "تقييمي", "⭐"],
  ["leaves", "الإجازات", "🏖"],
  ["missions", "المأموريات", "🚗"],
  ["requests", "طلباتي", "📋"],
  ["tasks", "مهامي", "✅"],
  ["daily-report", "تقريري", "📝"],
  ["documents", "مستنداتي", "📁"],
  ["policies", "السياسات", "📜"],
  ["decisions", "القرارات", "📢"],
  ["disputes", "شكوى", "⚠️"],
  ["location", "الموقع", "📍"],
  ["profile", "حسابي", "👤"],
];

const routeSubtitles = {
  home: "ملخص يومك، اختصارات سريعة، وآخر نشاطاتك.",
  "action-center": "كل المطلوب منك الآن في شاشة واحدة: موقع، سياسة، مهمة، أو بصمة.",
  kpi: "قيّم نفسك شهريًا ثم ارفع النموذج لمديرك المباشر للاعتماد.",
  punch: "سجّل حضورك أو انصرافك مباشرة بعد قراءة GPS.",
  location: "أرسل موقعك المباشر عند طلب الإدارة بضغطة واحدة.",
  leaves: "قدّم طلب إجازة وتابع حالته بدون أوراق.",
  missions: "قدّم طلب مأمورية وتابع موافقة الإدارة.",
  requests: "تابع كل طلباتك من إجازات ومأموريات ومواقع وتعديلات.",
  tasks: "تابع المهام المكلف بها وحدّث حالتها.",
  "daily-report": "أرسل تقرير إنجازك اليومي والعوائق واحتياجات الدعم.",
  documents: "مستنداتك الشخصية والتنبيهات الخاصة بانتهاء الصلاحية.",
  policies: "اقرأ سياسات الجمعية ووقّع عليها إلكترونيًا.",
  decisions: "قرارات إدارية رسمية تحتاج تأكيد الاطلاع مع توقيت القراءة.",
  disputes: "ارفع شكوى أو طلب فض خلاف للجنة المختصة.",
  notifications: "كل التنبيهات والطلبات المهمة في مكان واحد.",
  profile: "بيانات حسابك ووسائل الاتصال وكلمة المرور.",
  team: "إدارة فريقك وطلبات الإجازات والمأموريات بخصوصية ووضوح.",
  "manager-hub": "إضافات المدير المباشر داخل نفس تطبيق الموظف: فريقك، إجازات، مأموريات، وتقييمات.",
  "manager-kpi": "مراجعة تقييمات الفريق التي رفعها الموظفون ذاتيًا؛ لا يبدأ المدير نموذجًا من الصفر.",
  "committee-hub": "متابعة مشاكل وخلافات جديدة لأعضاء لجنة الحل مع التنبيهات والقرارات.",
};

function employeeMiniTable(headers = [], rows = []) {
  return `<div class="employee-table-wrap"><table class="employee-mini-table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length || 1}">لا توجد بيانات حالياً.</td></tr>`}</tbody></table></div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "صباح الخير";
  if (h >= 12 && h < 14) return "نهارك سعيد";
  if (h >= 14 && h < 18) return "طاب مساؤكم";
  if (h >= 18 && h < 21) return "مساء النور";
  if (h >= 21 && h < 24) return "تصبحون على خير";
  return "أهلاً بك";          /* midnight–5 am */
}

function timeNowText() {
  try { return englishDigits(new Date().toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })); } catch { return ""; }
}

function fullDateText() {
  try { return englishDigits(new Date().toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })); } catch { return ""; }
}

function actionCard(route, icon, title, text) {
  return `<button type="button" class="quick-action-card" data-route="${escapeHtml(route)}"><span class="quick-icon">${icon}</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></button>`;
}

function metricCard(label, value, hint, icon = "📊") {
  const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  const dc  = (!isNaN(num) && num >= 0) ? ` data-count="${num}"` : '';
  return `<article class="employee-stat"><div class="stat-icon">${icon}</div><div class="stat-body"><span>${escapeHtml(label)}</span><strong${dc}>${escapeHtml(String(value))}</strong><small>${escapeHtml(hint)}</small></div></article>`;
}

function compactMetric(label, value, icon, route = "") {
  const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  const dc  = (!isNaN(num) && num >= 0) ? ` data-count="${num}"` : '';
  return `<button type="button" class="compact-metric-badge" ${route ? `data-route="${escapeHtml(route)}"` : ''}><span class="badge-icon">${icon}</span><strong${dc}>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></button>`;
}

function confirmAction({ title = "تأكيد العملية", message = "هل تريد المتابعة؟", confirmLabel = "تأكيد", cancelLabel = "إلغاء", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="confirm-modal">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></div>
        <div class="form-actions">
          <button class="button ghost" type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="button ${danger ? "danger" : "primary"}" type="button" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const cleanup = (answer) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(answer); };
    const onKey = (event) => { if (event.key === "Escape") cleanup(false); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) cleanup(false); });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => cleanup(false));
    overlay.querySelector("[data-confirm]").addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector("[data-confirm]").focus();
  });
}

function askText({ title = "إضافة ملاحظة", message = "اكتب التفاصيل", defaultValue = "", confirmLabel = "حفظ", cancelLabel = "إلغاء" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <form class="confirm-modal prompt-modal">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></div>
        <label class="span-2">التفاصيل<textarea name="answer" rows="3">${escapeHtml(defaultValue)}</textarea></label>
        <div class="form-actions">
          <button class="button ghost" type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="button primary" type="submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    const form = overlay.querySelector("form");
    const cleanup = (answer) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(answer); };
    const onKey = (event) => { if (event.key === "Escape") cleanup(null); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) cleanup(null); });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => cleanup(null));
    form.addEventListener("submit", (event) => { event.preventDefault(); cleanup(String(new FormData(form).get("answer") || "").trim()); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    form.elements.answer.focus();
  });
}


window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "home";
  if (routeKey() === "register") { state.route = "home"; history.replaceState(null, "", "#home"); }
  render();
});

function routeKey() {
  return (state.route || "home").split("?")[0] || "home";
}

function showToast(message = "", type = "info") {
  if (!message) return;
  if (window.HRToast && !showToast.__delegating) {
    try { showToast.__delegating = true; window.HRToast(message, type === "error" ? "error" : "ok"); return; }
    finally { showToast.__delegating = false; }
  }
  document.querySelectorAll(".hr-toast").forEach((toast) => toast.remove());
  const toast = document.createElement("div");
  toast.className = `hr-toast ${type === "error" ? "error" : "ok"}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add("is-visible"), 20);
  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 240);
  }, 5000);
}

function isFriday(dateValue = new Date()) {
  return new Date(dateValue).getDay() === 5;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dailySeen(key) {
  try { return localStorage.getItem(key) === todayKey(); } catch { return false; }
}

function markDailySeen(key) {
  try { localStorage.setItem(key, todayKey()); } catch {}
}

function hasCheckInToday(events = []) {
  return (events || []).some((event) => {
    const parts = [event.type, event.eventType, event.status].map((value) => String(value || "").trim().toLowerCase());
    return parts.some((value) => value === "check_in" || value === "in" || value === "present" || value.includes("حضور"));
  });
}

function showAttendanceFloatingReminder() {
  if (dailySeen(ATTENDANCE_FLOATING_SEEN_KEY) || document.querySelector("[data-attendance-floating-reminder]")) return;
  markDailySeen(ATTENDANCE_FLOATING_SEEN_KEY);
  const toast = document.createElement("div");
  toast.className = "attendance-floating-reminder";
  toast.dataset.attendanceFloatingReminder = "1";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <button class="attendance-floating-close" type="button" data-floating-dismiss aria-label="إغلاق التذكير">×</button>
    <div class="attendance-floating-icon" aria-hidden="true">👁</div>
    <div class="attendance-floating-copy">
      <strong>تذكير بصمة الحضور</strong>
      <span>لم يتم تسجيل حضور اليوم حتى الآن. سجّل البصمة عند الوصول.</span>
    </div>
    <div class="attendance-floating-actions compact">
      <button class="button primary" type="button" data-floating-punch>تسجيل البصمة</button>
    </div>
  `;
  toast.querySelector("[data-floating-punch]")?.addEventListener("click", () => {
    toast.remove();
    location.hash = "punch";
  });
  toast.querySelector("[data-floating-dismiss]")?.addEventListener("click", () => toast.remove());
  window.setTimeout(() => toast.remove(), 12000);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add("is-visible"), 20);
}

async function showAttendanceBrowserNotification() {
  if (dailySeen(ATTENDANCE_BROWSER_SEEN_KEY)) return;
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  markDailySeen(ATTENDANCE_BROWSER_SEEN_KEY);
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("تذكير بصمة الحضور", {
      body: "لم يتم تسجيل حضور اليوم حتى الآن. افتح تطبيق أحلى شباب وسجّل البصمة عند الوصول.",
      icon: "../shared/images/icon-192.png",
      badge: "../shared/images/favicon-64.png",
      tag: `attendance-reminder-${todayKey()}`,
      requireInteraction: false,
      renotify: true,
      silent: false,
      timestamp: Date.now(),
      vibrate: [180, 80, 260],
      actions: [
        { action: "open-punch", title: "تسجيل البصمة" },
      ],
      data: { route: "punch", type: "ATTENDANCE_REMINDER", url: "./index.html#punch" },
    });
  } catch {}
}

function consumeFlashMessage() {
  if (state.message || state.error) return;
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    const flash = JSON.parse(raw);
    state.message = flash.message || "";
    state.error = flash.error || "";
  } catch {
    sessionStorage.removeItem(FLASH_KEY);
  }
}

function setMessage(message = "", error = "") {
  state.message = message;
  state.error = error;
  if (message || error) {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, error }));
    showToast(error || message, error ? "error" : "ok");
    haptic(error ? [200, 100, 200] : [30, 50, 80]);
  }
}

function resetIdleTimer() {
  window.clearTimeout(idleTimer);
  idleTimer = null;
  return;
  idleTimer = window.setTimeout(async () => {
    if (!state.user) return;
    await endpoints.logout().catch(() => {});
    sessionStorage.removeItem(EMPLOYEE_TAB_SESSION_KEY);
    localStorage.removeItem("hr-attendance.local-db.v7");
    sessionStorage.removeItem("hr.core");
    sessionStorage.removeItem("hr.core.exp");
    state.user = null;
    state.message = "";
    state.error = "";
    setMessage("تم تسجيل خروجك تلقائياً بعد 30 دقيقة من عدم النشاط.", "");
    renderLogin();
  }, IDLE_MS);
}

function startIdleTimer() {
  ["click", "keydown", "touchstart", "scroll", "pointermove"].forEach((eventName) => {
    document.addEventListener(eventName, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}


const NOTIFICATION_SOUND_SEEN_KEY = "hr.employee.seenNotificationIds";
const LIVE_LOCATION_ALERT_SEEN_KEY = "hr.employee.seenLiveLocationRequestIds";
let notificationPollTimer = null;
let liveLocationPollTimer = null;
let alertAudioContext = null;
let activeLiveLocationAlertId = "";
function onLiveLocationVisibilityChange() {
  if (!document.hidden) pollLiveLocationRequestsUrgent();
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function registerBrowserPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("هذا المتصفح لا يدعم بصمة الجهاز/Passkey. استخدم HTTPS أو localhost وموبايل يدعم البصمة.");
  }
  const userName = state.user?.email || state.user?.phone || state.user?.fullName || "employee";
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "نظام أحلى شباب HR" },
      user: { id: userId, name: userName, displayName: state.user?.fullName || state.user?.employee?.fullName || userName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
      attestation: "none",
    },
  });
  const rawId = toBase64Url(credential.rawId);
  const attestationObject = credential.response?.attestationObject ? toBase64Url(credential.response.attestationObject) : "";
  const clientDataJSON = credential.response?.clientDataJSON ? toBase64Url(credential.response.clientDataJSON) : "";
  const transports = typeof credential.response?.getTransports === "function" ? credential.response.getTransports() : [];
  const deviceFingerprintHash = await getDeviceFingerprintHash();
  const registered = unwrap(await endpoints.registerPasskey({ credentialId: rawId, attestationObject, clientDataJSON, transports, label: "بصمة جهاز الموظف", platform: navigator.platform || "browser", deviceFingerprintHash, trusted: true }));
  const credentialRow = registered?.credential || registered?.data || registered || {};
  state.user = { ...(state.user || {}), passkeyEnabled: true };
  if (state.user.employee) state.user.employee = { ...state.user.employee, passkeyEnabled: true };
  return {
    ok: true,
    credentialId: rawId,
    passkeyCredentialId: rawId,
    trustedDeviceId: credentialRow.id || credentialRow.trustedDeviceId || credentialRow.trusted_device_id || "",
    deviceFingerprintHash,
    passkeyUserVerified: true,
    deviceRiskFlags: [],
    justRegistered: true,
  };
}

function isMissingTrustedDeviceError(error) {
  const message = String(error?.message || error || "");
  return /لا توجد بصمة جهاز|بصمة جهاز موثوقة|مفتاح المرور|Passkey|passkey|MISSING_PASSKEY/i.test(message);
}

async function requestBrowserPasskeyForAction(label = "تأكيد العملية", employee = {}, options = {}) {
  try {
    return { ok: true, ...(await requestEmployeePasskey({ endpoints, user: state.user, employee, label })) };
  } catch (error) {
    if (!options.autoRegisterOnMissing || !isMissingTrustedDeviceError(error)) throw error;
    if (options.resultBox) options.resultBox.textContent = "لا توجد بصمة جهاز مسجلة لهذا الحساب. سيتم تسجيل بصمة هذا الموبايل الآن ثم إكمال العملية.";
    const registered = await registerBrowserPasskey();
    if (options.resultBox) options.resultBox.textContent = "تم تسجيل بصمة الجهاز. جارٍ إكمال العملية...";
    return registered;
  }
}

function unlockAlertAudio(event) {
  try {
    // Chrome يمنع تشغيل AudioContext قبل تفاعل المستخدم الحقيقي.
    // لذلك لا ننشئه ولا نستدعي resume إلا من حدث موثوق مثل click/touch/key.
    if (event && event.isTrusted === false) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!alertAudioContext) alertAudioContext = new AudioContext();
    if (alertAudioContext.state === "suspended") alertAudioContext.resume?.().catch(() => null);
    return alertAudioContext;
  } catch {
    return null;
  }
}

document.addEventListener("pointerup", unlockAlertAudio, { once: true, passive: true });
document.addEventListener("touchend", unlockAlertAudio, { once: true, passive: true });
document.addEventListener("keydown", unlockAlertAudio, { once: true });

function playInternalAlertSound({ repeat = 5 } = {}) {
  try {
    const ctx = unlockAlertAudio();
    if (!ctx) return;
    const startAt = Math.max(ctx.currentTime + 0.03, ctx.currentTime);
    for (let i = 0; i < repeat; i += 1) {
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      gain.gain.setValueAtTime(0.0001, startAt + i * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + i * 0.3 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + i * 0.3 + 0.22);
      osc.frequency.setValueAtTime(i % 2 ? 1320 : 980, startAt + i * 0.3);
      osc.type = "square";
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt + i * 0.3);
      osc.stop(startAt + i * 0.3 + 0.24);
    }
  } catch {}
}

function seenNotificationIds() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFICATION_SOUND_SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}

function saveSeenNotificationIds(ids) {
  try { localStorage.setItem(NOTIFICATION_SOUND_SEEN_KEY, JSON.stringify([...ids].slice(-200))); } catch {}
}

function seenLiveLocationRequestIds() {
  try { return new Set(JSON.parse(localStorage.getItem(LIVE_LOCATION_ALERT_SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}

function saveSeenLiveLocationRequestIds(ids) {
  try { localStorage.setItem(LIVE_LOCATION_ALERT_SEEN_KEY, JSON.stringify([...ids].slice(-200))); } catch {}
}

function pendingLiveLocationRequest(rows = []) {
  const employeeId = state.user?.employeeId || state.user?.employee?.id || "";
  const nowMs = Date.now();
  return rows
    .filter((item) => String(item.status || "").toUpperCase() === "PENDING")
    .filter((item) => employeeId && String(item.employeeId || "") === String(employeeId))
    .filter((item) => !item.expiresAt || new Date(item.expiresAt).getTime() > nowMs)
    .filter((item) => {
      const created = new Date(item.createdAt || item.requestedAt || 0).getTime();
      return item.expiresAt || !created || (nowMs - created) <= 30 * 60 * 1000;
    })
    .sort((a, b) => new Date(b.createdAt || b.requestedAt || 0) - new Date(a.createdAt || a.requestedAt || 0))[0] || null;
}

function liveLocationRequesterName(item = {}) {
  const name = String(item.requestedByName || item.requested_by_name || "").trim();
  const reason = String(item.reason || "").trim();
  if (reason.includes("متابعة تنفيذية") && name.includes("يحيي")) return "الشيخ محمد يوسف";
  return name || "الإدارة";
}

async function showBrowserLocalNotificationForLiveRequest(item = {}) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("طلب مشاركة موقعك الحالي", {
      body: `${liveLocationRequesterName(item)} يطلب إرسال موقعك الآن. ${item.reason ? `السبب: ${item.reason}` : ""}`.trim(),
      icon: "../shared/images/icon-192.png",
      badge: "../shared/images/favicon-64.png",
      tag: `live-location-${item.id}`,
      requireInteraction: true,
      renotify: true,
      silent: false,
      timestamp: Date.now(),
      vibrate: [400, 140, 400, 140, 800, 180, 800],
      actions: [
        { action: "open-location", title: "فتح وإرسال الموقع" },
        { action: "open-app", title: "فتح التطبيق" },
      ],
      data: { route: "location", type: "LIVE_LOCATION_REQUEST", liveLocationRequestId: item.id, url: "./index.html#location" },
    });
  } catch {}
}

function showLiveLocationUrgentAlert(item = {}) {
  if (!item?.id || activeLiveLocationAlertId === item.id) return;
  activeLiveLocationAlertId = item.id;
  document.querySelectorAll("[data-live-location-alert]").forEach((node) => node.remove());
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop live-location-alert-backdrop";
  overlay.dataset.liveLocationAlert = item.id;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="confirm-modal live-location-alert-modal">
      <div class="live-location-alert-icon" aria-hidden="true">📍</div>
      <div class="live-location-alert-copy">
        <div class="panel-kicker">طلب موقع مباشر</div>
        <h2>مشاركة موقعك الحالي</h2>
        <p>${escapeHtml(liveLocationRequesterName(item))} يطلب تأكيد موقعك الآن. افتح صفحة الموقع واضغط إرسال GPS الحالي مباشرة.</p>
      </div>
      <div class="live-location-alert-actions">
        <button class="button primary" type="button" data-open-live-location>فتح وإرسال الموقع الآن</button>
      </div>
    </div>
  `;
  const cleanup = () => { overlay.remove(); activeLiveLocationAlertId = ""; };
  false && overlay.querySelector("[data-postpone-live-location]")?.addEventListener("click", async () => {
    try {
      await endpoints.respondLiveLocationRequest(item.id, { status: "POSTPONED", reason: "طلب الموظف تأجيل إرسال الموقع 5 دقائق", postponeMinutes: 5 });
      setMessage("تم إبلاغ الإدارة بتأجيل إرسال الموقع 5 دقائق.", "");
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ التأجيل.");
    } finally {
      cleanup();
      if (routeKey() === "location") renderLocation();
    }
  });
  overlay.querySelector("[data-open-live-location]")?.addEventListener("click", () => {
    cleanup();
    location.hash = "location";
    render();
  });
  document.body.appendChild(overlay);
  overlay.querySelector("[data-open-live-location]")?.focus?.();
}

async function pollNotificationsForSound() {
  if (!state.user) return;
  const rows = await endpoints.notifications().then(unwrap).catch(() => []);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const relevant = rows.filter((item) => !item.isRead && (!item.employeeId || item.employeeId === employeeId || item.userId === state.user?.id));
  const seen = seenNotificationIds();
  const fresh = relevant.filter((item) => item.id && !seen.has(item.id));
  if (fresh.length) {
    fresh.forEach((item) => seen.add(item.id));
    saveSeenNotificationIds(seen);
    playInternalAlertSound({ repeat: 4 });
    haptic([160, 70, 160, 70, 260]);
    const first = fresh[0];
    showToast(first.title || "وصل تنبيه داخلي جديد", "ok");
    // Live location modal is shown only from myLiveLocationRequests() after strict employee/expiry validation.
  }
}

async function pollLiveLocationRequestsUrgent() {
  if (!state.user) return;
  const rows = await endpoints.myLiveLocationRequests().then(unwrap).catch(() => []);
  const pending = pendingLiveLocationRequest(rows);
  if (!pending?.id) return;
  const seen = seenLiveLocationRequestIds();
  const isFresh = !seen.has(pending.id);
  if (isFresh) {
    seen.add(pending.id);
    saveSeenLiveLocationRequestIds(seen);
    playInternalAlertSound({ repeat: 7 });
    haptic([300, 120, 300, 120, 600, 180, 600]);
    showToast("طلب موقع مباشر من الإدارة — افتح صفحة الموقع الآن", "ok");
    await showBrowserLocalNotificationForLiveRequest(pending);
  }
  if (routeKey() !== "location") showLiveLocationUrgentAlert(pending);
  if (routeKey() === "action-center" || routeKey() === "notifications") render();
}

function startNotificationPolling() {
  if (!notificationPollTimer) {
    pollNotificationsForSound();
    notificationPollTimer = window.setInterval(pollNotificationsForSound, 30000);
  }
  startLiveLocationPolling();
  startAttendanceReminderPolling();
}

function startLiveLocationPolling() {
  if (liveLocationPollTimer) return;
  pollLiveLocationRequestsUrgent();
  liveLocationPollTimer = window.setInterval(pollLiveLocationRequestsUrgent, 10000);
  window.addEventListener("focus", pollLiveLocationRequestsUrgent);
  document.addEventListener("visibilitychange", onLiveLocationVisibilityChange);
}

function stopNotificationPolling() {
  window.clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  stopLiveLocationPolling();
  stopAttendanceReminderPolling();
}

function stopLiveLocationPolling() {
  window.clearInterval(liveLocationPollTimer);
  liveLocationPollTimer = null;
  window.removeEventListener("focus", pollLiveLocationRequestsUrgent);
  document.removeEventListener("visibilitychange", onLiveLocationVisibilityChange);
  document.querySelectorAll("[data-live-location-alert]").forEach((node) => node.remove());
  activeLiveLocationAlertId = "";
}

async function checkAttendanceReminderNow() {
  if (!state.user || isFriday()) return;
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const events = await endpoints.myAttendanceEvents().then(unwrap).catch(() => []);
  const todayEvents = events
    .filter((event) => !employeeId || event.employeeId === employeeId)
    .filter((event) => String(event.eventAt || event.createdAt || "").startsWith(todayIso()));
  if (!todayReminderDue(todayEvents)) return;
  showAttendanceFloatingReminder();
  await showAttendanceBrowserNotification();
}

function startAttendanceReminderPolling() {
  if (attendanceReminderTimer) return;
  checkAttendanceReminderNow();
  attendanceReminderTimer = window.setInterval(checkAttendanceReminderNow, 60000);
  window.addEventListener("focus", checkAttendanceReminderNow);
}

function stopAttendanceReminderPolling() {
  window.clearInterval(attendanceReminderTimer);
  attendanceReminderTimer = null;
  window.removeEventListener("focus", checkAttendanceReminderNow);
  document.querySelectorAll("[data-attendance-floating-reminder]").forEach((node) => node.remove());
}


function passwordStrengthLevel(value = "") {
  const text = String(value || "");
  let score = 0;
  if (text.length >= 8) score += 1;
  if (text.length >= 12) score += 1;
  if (/[A-Z]/.test(text) && /[a-z]/.test(text)) score += 1;
  if (/\d/.test(text)) score += 1;
  if (/[^A-Za-z0-9]/.test(text)) score += 1;
  if (score >= 5) return { key: "strong", label: "قوية" };
  if (score >= 3) return { key: "medium", label: "متوسطة" };
  return { key: "weak", label: "ضعيفة" };
}

function passwordStrengthMarkup() {
  return `<div class="password-strength" data-password-strength><span></span><strong>اكتب كلمة مرور قوية</strong></div>`;
}

function bindPasswordStrength(form) {
  const input = form?.querySelector('[name="newPassword"], [name="password"]');
  const meter = form?.querySelector('[data-password-strength]');
  if (!input || !meter) return;
  const update = () => {
    const level = passwordStrengthLevel(input.value);
    meter.dataset.level = level.key;
    meter.querySelector('strong').textContent = input.value ? `قوة كلمة المرور: ${level.label}` : 'اكتب كلمة مرور قوية';
  };
  input.addEventListener('input', update);
  update();
}

function renderLoadingSkeleton(title = "جاري التحميل", subtitle = "نجهز البيانات الآن...") {
  const current = routeKey();
  app.innerHTML = `
    <div class="employee-shell">
      <header class="employee-topbar"><div class="employee-brand"><img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" /><div><strong>أحلى شباب</strong><span>تطبيق الموظفين</span></div></div></header>
      <main class="employee-main">
        <section class="employee-page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></section>
        <section class="employee-grid" aria-busy="true" aria-live="polite" aria-label="جاري التحميل">
          <article class="employee-card full" style="gap:12px;display:grid">
            <div class="emp-skeleton" style="height:18px;width:60%;border-radius:8px"></div>
            <div class="emp-skeleton" style="height:14px;width:85%;border-radius:8px"></div>
            <div class="emp-skeleton" style="height:14px;width:45%;border-radius:8px"></div>
            <div class="emp-skeleton" style="height:48px;border-radius:14px;margin-top:6px"></div>
          </article>
          <article class="employee-card" style="gap:10px;display:grid">
            <div class="emp-skeleton" style="height:16px;width:70%;border-radius:8px"></div>
            <div class="emp-skeleton" style="height:12px;width:50%;border-radius:8px"></div>
          </article>
          <article class="employee-card" style="gap:10px;display:grid">
            <div class="emp-skeleton" style="height:16px;width:55%;border-radius:8px"></div>
            <div class="emp-skeleton" style="height:12px;width:40%;border-radius:8px"></div>
          </article>
        </section>
      </main>
      <nav class="employee-bottom-nav" aria-label="تنقل تطبيق الموظف">
        ${employeeRoutes.map(([key, label, icon]) => `<button class="${current === key || (key === "more" && isMoreRoute(current)) ? "is-active" : ""}" type="button" disabled><strong>${icon}</strong><span>${escapeHtml(label)}</span></button>`).join("")}
      </nav>
    </div>`;
}

function escapeHtml(value = "") {
  return englishDigits(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function safeLocationDisplayRecord(record = {}) {
  const safe = { ...(record || {}) };
  ["addressLabel", "locationLabel", "placeLabel", "address", "destinationName", "geofenceStatus", "locationStatus", "status", "type", "eventType"].forEach((key) => {
    if (safe[key] !== undefined && safe[key] !== null) safe[key] = String(safe[key]).slice(0, 240);
  });
  ["latitude", "longitude", "accuracy", "gpsAccuracy", "accuracyMeters", "distanceFromBranchMeters", "distanceFromBranch", "distanceMeters", "localRadiusMeters"].forEach((key) => {
    if (safe[key] !== undefined && safe[key] !== null && safe[key] !== "") {
      const number = Number(safe[key]);
      safe[key] = Number.isFinite(number) ? number : 0;
    }
  });
  return safe;
}

function normalizePermissionList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try { return normalizePermissionList(JSON.parse(trimmed)); } catch { return trimmed.split(/[،,\s]+/).map((item) => item.trim()).filter(Boolean); }
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.permissions)) return normalizePermissionList(value.permissions);
    if (Array.isArray(value.scopes)) return normalizePermissionList(value.scopes);
    return Object.entries(value).filter(([, enabled]) => enabled === true || enabled === "true" || enabled === 1 || enabled === "1").map(([scope]) => scope);
  }
  return [];
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function normalizeEgyptPhone(value = "") {
  let text = String(value || "").trim();
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  text = text.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return digits;
}

function validEgyptPhone(value = "") {
  return /^01[0125][0-9]{8}$/.test(normalizeEgyptPhone(value));
}

function englishDigits(value = "") {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
}

function fileToAvatarDataUrl(file) {
  if (!file || !String(file.type || "").startsWith("image/")) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));
    reader.onload = () => { image.src = reader.result; };
    image.onerror = () => reject(new Error("ملف الصورة غير صالح."));
    image.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", .82));
    };
    reader.readAsDataURL(file);
  });
}

async function reverseGeocode(latitude, longitude) {
  if (latitude == null || longitude == null) return "";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&accept-language=ar`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    const data = response.ok ? await response.json() : {};
    return data.display_name || data.name || "";
  } catch {
    return "";
  } finally {
    window.clearTimeout(timer);
  }
}

function date(value) {
  if (!value) return "-";
  try { return englishDigits(new Date(value).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })); } catch { return englishDigits(value); }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(value = "") {
  const map = {
    CHECK_IN: "حضور",
    CHECK_OUT: "انصراف",
    PRESENT: "حاضر",
    LATE: "متأخر",
    ABSENT: "غائب",
    PENDING: "قيد المراجعة",
    APPROVED: "مقبول",
    REJECTED: "مرفوض",
    POSTPONED: "مؤجل 5 دقائق",
    EXPIRED: "منتهي",
    SUPERSEDED: "أغلق بطلب أحدث",
    REJECTED_CONFIRMED: "رفض نهائي",
    MANUAL_APPROVED: "اعتماد يدوي",
    UNREAD: "جديد",
    READ: "مقروء",
    IN_REVIEW: "أمام اللجنة",
    ON_LEAVE: "إجازة",
    ON_MISSION: "مأمورية",
    CHECKED_OUT: "انصرف",
    LIVE_SHARED: "موقع مباشر مُرسل",
    ACTION_REQUIRED: "إجراء مطلوب",
    DRAFT: "مسودة محفوظة",
    SELF_SUBMITTED: "مرسل من الموظف",
    MANAGER_APPROVED: "اعتماد المدير",
    HR_REVIEWED: "مراجعة HR",
    SECRETARY_REVIEWED: "مراجعة السكرتير",
    EXECUTIVE_APPROVED: "اعتماد المدير التنفيذي",
  };
  return map[value] || value || "-";
}

function badge(value, extra = "") {
  const key = String(value || "").toLowerCase();
  return `<span class="badge ${extra} status-${escapeHtml(key)}">${escapeHtml(statusLabel(value))}</span>`;
}


const bundledEmployeePhotos = Object.freeze({});

function bundledEmployeePhoto() {
  return "";
}

function resolveAvatarUrl(value) {
  const src = String(value || "").trim();
  if (!src) return "";
  if (/^(data:|blob:|https?:|\/)/i.test(src)) return src;
  if (src.startsWith("employee-avatars/") || src.startsWith("avatars/employee-avatars/")) {
    const cfg = window.HR_SUPABASE_CONFIG || {};
    const bucket = cfg.storage?.avatarsBucket || "avatars";
    const path = src.replace(/^avatars\//, "").split("/").map(encodeURIComponent).join("/");
    if (cfg.url) return `${String(cfg.url).replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
  }
  return src;
}

function avatar(subject = {}, size = "") {
  const url = resolveAvatarUrl(subject?.avatarUrl || subject?.photoUrl || subject?.employee?.photoUrl || subject?.employee?.avatarUrl || bundledEmployeePhoto(subject) || "");
  const name = subject?.fullName || subject?.name || subject?.email || subject?.employee?.fullName || "م";
  return url
    ? `<img class="avatar ${size}" src="${escapeHtml(url)}" alt="" loading="lazy" />`
    : `<span class="avatar ${size}">${escapeHtml(String(name).trim().charAt(0) || "م")}</span>`;
}

function permissionsOf(user = state.user) {
  const fromRole = user?.role?.permissions || [];
  return new Set([
    ...normalizePermissionList(user?.permissions),
    ...normalizePermissionList(user?.permissionScopes),
    ...normalizePermissionList(user?.scopes),
    ...normalizePermissionList(user?.profile?.permissions),
    ...normalizePermissionList(fromRole),
  ]);
}

function roleKey(user = state.user) {
  const role = user?.role || {};
  return String(role.slug || role.key || role.id || user?.roleSlug || user?.roleKey || user?.role || "").toLowerCase();
}

function isAdminUser(user = state.user) {
  const role = roleKey(user);
  if (executiveOnlyRoles.has(role)) return false;
  if (fullAccessRoles.has(role)) return true;
  const permissions = permissionsOf(user);
  return [...permissions].some((scope) => adminScopes.has(scope));
}

function employeeSubject() {
  const user = state.user || {};
  const employee = user?.employee || {};
  if (!employee || !Object.keys(employee).length) return user;
  const freshAvatar = user.avatarUrl || user.photoUrl || employee.avatarUrl || employee.photoUrl || "";
  return {
    ...employee,
    avatarUrl: freshAvatar,
    photoUrl: freshAvatar,
  };
}


const BRANCH_DISPLAY_NAME = "مجمع أحلى شباب";
const BRANCH_DISPLAY_AREA = "منيل شيحة - الجيزة";
const ATTENDANCE_REMINDER_HOUR = 10;
const ATTENDANCE_REMINDER_MINUTE = 0;
const FACE_SELFIE_TEMP_DISABLED = true;

function attendanceConfig() {
  return (window.HR_SUPABASE_CONFIG && window.HR_SUPABASE_CONFIG.attendance) || {};
}
function branchConfig() {
  return attendanceConfig().branchLocation || {};
}
function branchName() { return branchConfig().name || BRANCH_DISPLAY_NAME; }
function branchArea() { return branchConfig().area || BRANCH_DISPLAY_AREA; }
function isQrDisabled() { return attendanceConfig().qrRequired === false || window.HR_QR_REQUIRED === false; }
function isFaceSelfieDisabled() { return FACE_SELFIE_TEMP_DISABLED || attendanceConfig().faceSelfieRequired === false || window.HR_FACE_SELFIE_REQUIRED === false; }
function gpsPolicy() {
  const cfg = attendanceConfig();
  return {
    samples: Number(cfg.gpsSamples || 12),
    windowMs: Number(cfg.gpsSampleWindowMs || 30000),
    targetAccuracy: Number(cfg.gpsTargetAccuracyMeters || 25),
    maxAcceptableAccuracy: Number(cfg.gpsMaxAcceptableAccuracyMeters || 180),
    safetyBuffer: Number(cfg.gpsSafetyBufferMeters || 90),
    uncertainReviewOnly: cfg.gpsUncertainReviewOnly !== false,
  };
}

function distanceMetersBetween(a = {}, b = {}) {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every((value) => Number.isFinite(Number(value)))) return null;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(Number(b.latitude) - Number(a.latitude));
  const dLng = toRad(Number(b.longitude) - Number(a.longitude));
  const lat1 = toRad(Number(a.latitude));
  const lat2 = toRad(Number(b.latitude));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(h)));
}

function configuredBranchTarget() {
  const cfg = branchConfig();
  const latitude = Number(cfg.latitude);
  const longitude = Number(cfg.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    radiusMeters: Number(cfg.radiusMeters || 300),
    safetyBufferMeters: Number(cfg.safetyBufferMeters || gpsPolicy().safetyBuffer),
    maxAccuracyMeters: Number(cfg.maxAccuracyMeters || gpsPolicy().maxAcceptableAccuracy),
  };
}

function localGeofenceEvaluation(location = {}) {
  const target = configuredBranchTarget();
  if (!target || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return {};
  const distance = distanceMetersBetween(location, target);
  const accuracy = Number(location.accuracyMeters ?? location.accuracy ?? 0);
  const radius = Number(target.radiusMeters || 300);
  const reviewRadius = radius + Math.max(Number(target.safetyBufferMeters || 0), Math.min(Math.max(accuracy || 0, 0), Number(target.maxAccuracyMeters || 90)));
  const insideHard = distance != null && distance <= radius;
  const insideReview = distance != null && distance > radius && distance <= reviewRadius;
  return {
    distanceFromBranchMeters: distance,
    localDistanceFromBranchMeters: distance,
    localRadiusMeters: radius,
    localEffectiveRadiusMeters: reviewRadius,
    localInsideBranch: insideHard,
    localInsideSoft: insideReview,
  };
}

function formatMeters(value) {
  const meters = Number(value || 0);
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} كم`;
  return `${Math.round(meters)} م`;
}

function mapUrlForLocation(record = {}) {
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function osmEmbedUrl(record = {}) {
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const delta = 0.006;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function geofenceMapPreview(record = {}) {
  const safeRecord = safeLocationDisplayRecord(record);
  const target = configuredBranchTarget();
  const distance = Number(safeRecord.distanceFromBranchMeters ?? safeRecord.distanceFromBranch ?? safeRecord.distanceMeters ?? 0);
  const radius = Number(safeRecord.localRadiusMeters || target?.radiusMeters || 300);
  const outside = !safeRecord.insideBranch && !String(safeRecord.geofenceStatus || safeRecord.locationStatus || "").toLowerCase().includes("inside");
  const ratio = radius > 0 && distance > 0 ? Math.min(1, distance / radius) : 0;
  const markerOffset = outside ? 96 : Math.max(8, Math.round(ratio * 82));
  const markerClass = outside ? "outside" : "inside";
  const embedUrl = osmEmbedUrl(safeRecord);
  const mapsUrl = mapUrlForLocation(safeRecord);
  return `<div class="gps-real-map">
    <div class="gps-geofence-diagram ${markerClass}" style="--marker-offset:${markerOffset}%">
      <div class="gps-geofence-ring"><span>دائرة 300 متر</span><i></i></div>
      <small>${outside ? `أنت خارج النطاق: ${escapeHtml(formatMeters(distance))}` : "أنت داخل دائرة المجمع"}</small>
    </div>
    ${embedUrl ? `<iframe title="خريطة الموقع الفعلي" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${escapeHtml(embedUrl)}"></iframe>` : ""}
    ${mapsUrl ? `<a class="button ghost small" target="_blank" rel="noopener" href="${escapeHtml(mapsUrl)}">فتح الخريطة الحقيقية</a>` : ""}
  </div>`;
}

function renderRequestList(requests = []) {
  if (!requests || !requests.length) return `<div class="empty-state">لا توجد طلبات مسجلة.</div>`;
  return `<div class="employee-list">${requests.map((item) => `<div class="employee-list-item"><div><strong>${escapeHtml(item.title || item.leaveType?.name || item.leaveType || item.type || "طلب")}</strong><span>${escapeHtml(date(item.createdAt || item.startDate || item.plannedStart || "-"))}</span><small>${escapeHtml(item.reason || item.notes || item.destinationName || "-")}</small></div><div class="list-item-side">${badge(item.finalStatus || item.workflowStatus || item.status)}</div></div>`).join("")}</div>`;
}

function currentEmployeeLabel(subject = employeeSubject()) {
  return subject?.fullName || state.user?.fullName || state.user?.name || "الموظف";
}

function currentJobLabel(subject = employeeSubject()) {
  return subject?.jobTitle || subject?.position || state.user?.role?.name || "موظف";
}

function employeeHeaderCell(subject = employeeSubject()) {
  return `<div class="employee-header-card person-cell large">${avatar(subject, "large")}<span><strong>${escapeHtml(currentEmployeeLabel(subject))}</strong><small>${escapeHtml(currentJobLabel(subject))}</small></span></div>`;
}

function locationLabelFromRecord(record = {}) {
  const locationStatus = String(record.locationStatus || record.geofenceStatus || "").toLowerCase();
  const attendanceStatus = String(record.status || record.type || record.eventType || "").toLowerCase();
  const branchish = ["inside_branch", "inside_branch_low_accuracy", "inside", "in_range", "active", "approved"].includes(locationStatus)
    || (!locationStatus && ["check_in", "check_out", "present", "late", "checked_out", "manual_approved"].includes(attendanceStatus) && !record.requiresReview);
  if (branchish) return `${branchName()} — ${branchArea()}`;
  return record.addressLabel || record.locationLabel || record.placeLabel || record.address || record.destinationName || (record.latitude && record.longitude ? "موقع فعلي محفوظ — افتح الخريطة للتفاصيل" : "لم يتم إرسال موقع بعد");
}

function locationStatusBadge(record = {}) {
  const status = String(record.locationStatus || record.geofenceStatus || "").toLowerCase();
  const attendanceStatus = String(record.status || record.type || record.eventType || "").toLowerCase();
  const inside = status.includes("inside") || status.includes("in_range") || status === "active" || status === "approved";
  const uncertain = status.includes("uncertain") || status.includes("low_accuracy") || status.includes("unavailable") || status.includes("unknown") || record.locationUncertain;
  const outside = status.includes("outside") || status.includes("out_of_range") || status.includes("geofence_miss");
  const acceptedAttendance = ["check_in", "check_out", "present", "late", "checked_out", "manual_approved"].includes(attendanceStatus);
  if (uncertain) return `<span class="pill warning">الموقع غير مؤكد</span>`;
  if (inside) return `<span class="pill success">داخل المجمع</span>`;
  if (outside) return `<span class="pill danger">خارج المجمع</span>`;
  if (acceptedAttendance && !record.requiresReview) return `<span class="pill success">تم التسجيل</span>`;
  return `<span class="pill warning">بحاجة للتحقق</span>`;
}

function readableLocationBlock(record = {}, { compact = false } = {}) {
  const safeRecord = safeLocationDisplayRecord(record);
  const label = locationLabelFromRecord(safeRecord);
  const accuracy = Number(safeRecord.accuracy || safeRecord.gpsAccuracy || safeRecord.accuracyMeters || 0);
  const distance = Number(safeRecord.distanceFromBranchMeters ?? safeRecord.distanceFromBranch ?? safeRecord.distanceMeters ?? 0);
  const hasDistance = Number.isFinite(distance) && distance > 0;
  const map = safeRecord.latitude && safeRecord.longitude ? `https://www.google.com/maps?q=${encodeURIComponent(`${safeRecord.latitude},${safeRecord.longitude}`)}` : "";
  const distanceLabel = hasDistance && distance > 1500 ? "خارج نطاق مجمع أحلى شباب" : hasDistance ? `يبعد تقريبًا ${formatMeters(distance)} عن المجمع` : "";
  return `<div class="readable-location ${compact ? "compact" : ""}">
    <div>${locationStatusBadge(safeRecord)}<strong>${escapeHtml(label)}</strong><small>${escapeHtml(label.includes(BRANCH_DISPLAY_NAME) ? BRANCH_DISPLAY_AREA : "الموقع الفعلي المسجل")}</small></div>
    <div class="location-meta-row">${accuracy ? `<span>الدقة ±${escapeHtml(Math.round(accuracy))} م</span>` : ""}${distanceLabel ? `<span>${escapeHtml(distanceLabel)}</span>` : ""}${map ? `<a class="button ghost small" target="_blank" rel="noopener" href="${map}">فتح الخريطة</a>` : ""}</div>
  </div>`;
}

function attendanceNoteField(value = "") {
  return `<label class="span-2 punch-note-field">ملاحظة مع البصمة<textarea id="punch-notes" name="notes" rows="2" placeholder="اكتب ملاحظة إن وجدت: مأمورية، ظرف طارئ، تأخير مواصلات...">${escapeHtml(value)}</textarea></label>`;
}

function isMorningPunchTime() {
  const h = new Date().getHours();
  return h < 15;
}

function todayReminderDue(events = []) {
  const now = new Date();
  if (isFriday(now)) return false;
  if (now.getHours() < ATTENDANCE_REMINDER_HOUR || (now.getHours() === ATTENDANCE_REMINDER_HOUR && now.getMinutes() < ATTENDANCE_REMINDER_MINUTE)) return false;
  return !hasCheckInToday(events);
}

function kpiSlider({ name, label, weight, value = 0, readonly = false }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  const calculated = (pct * weight / 100).toFixed(1);
  return `<label class="kpi-slider-field ${readonly ? "is-readonly" : ""}"><span>${escapeHtml(label)}</span><input type="range" name="${escapeHtml(name)}" min="0" max="100" step="1" value="${pct}" ${readonly ? "disabled" : ""} data-weight="${weight}" /><div class="kpi-slider-meta"><b>${pct}%</b><small>الوزن ${weight} — المحتسب ${calculated}/${weight}</small></div><div class="kpi-progress"><i style="width:${pct}%"></i></div></label>`;
}

function getManagerLikeRole() {
  const role = roleKey();
  const perms = permissionsOf();
  return role.includes("manager") || role.includes("مدير") || perms.has("team:manage") || perms.has("employees:team");
}

function isMoreRoute(key = routeKey()) {
  return moreEmployeeRoutes.some(([route]) => route === key);
}

function shell(content, title = "تطبيق الموظف", subtitle = "") {
  const current = routeKey();
  const user = state.user || {};
  const employee = employeeSubject();
  app.innerHTML = `
    <div class="employee-shell">
      <header class="employee-topbar">
        <div class="employee-brand is-larger-logo">
          <img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" />
          <div><strong>أحلى شباب</strong><span>تطبيق الموظفين</span></div>
        </div>
        <div class="employee-user" title="${escapeHtml(user.fullName || user.name || user.email || "مستخدم")}">
          ${avatar(user, "tiny")}
          <span><strong>${escapeHtml(user.fullName || user.name || employee.fullName || "مستخدم")}</strong><small>${escapeHtml(employee.jobTitle || "تطبيق الموظفين")}</small></span>
        </div>
      </header>
      <main class="employee-main">
        <section class="employee-page-head">
          <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || routeSubtitles[current] || "")}</p></div>
        </section>
        ${(user.mustChangePassword || user.temporaryPassword) && current !== "profile" ? `<section class="employee-card full must-change-card"><strong>كلمة المرور مؤقتة</strong><span>من فضلك غيّر كلمة المرور من صفحة حسابي لتأمين حسابك.</span><button class="button primary small" type="button" data-route="profile">تغيير الآن</button></section>` : ""}
        ${content}
      </main>
      <nav class="employee-bottom-nav" aria-label="تنقل تطبيق الموظف">
        ${employeeRoutes.map(([key, label, icon]) => key === "more"
          ? `<button class="${isMoreRoute(current) ? "is-active" : ""}" type="button" data-more-menu aria-expanded="false"><strong>${icon}</strong><span>${escapeHtml(label)}</span></button>`
          : `<button class="${current === key ? "is-active" : ""}" type="button" data-route="${key}"><strong>${icon}</strong><span>${escapeHtml(label)}</span></button>`).join("")}
      </nav>
    </div>
  `;
  const moreButton = app.querySelector("[data-more-menu]");
  const closeMore = () => {
    moreButton?.setAttribute("aria-expanded", "false");
    closeMoreDrawer();
  };
  const openMore = () => {
    moreButton?.setAttribute("aria-expanded", "true");
    openMoreDrawer();
  };
  moreButton?.addEventListener("click", openMore);
  document.onkeydown = (event) => { if (event.key === "Escape") closeMore(); };
  app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => { closeMore(); location.hash = button.dataset.route; }));

  /* ── v103: More Drawer ── */
  initMoreDrawer();
  app.querySelectorAll("[data-enable-notifications]").forEach((button) => button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.dataset.hrPushBound = "1";
    try {
      button.disabled = true;
      await enableWebPushSubscription(endpoints);
      document.querySelectorAll('.push-explain-overlay,.attendance-floating-reminder').forEach((el) => el.remove());
      setMessage("تم تفعيل إشعارات الموبايل لهذا الجهاز.", "");
    } catch (error) {
      setMessage("", friendlyError(error, "تعذر تفعيل الإشعارات."));
    } finally {
      button.disabled = false;
    }
  }));
  app.querySelectorAll("[data-enable-location]").forEach((button) => button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.dataset.hrLocationBound = "1";
    try { await window.HRExplainAndEnableLocation?.(); }
    catch (error) { setMessage("", friendlyError(error, "تعذر تفعيل الموقع.")); }
  }));
  app.querySelectorAll("form[data-ajax]").forEach((form) => form.addEventListener("submit", handleFormSubmit));
  app.querySelector("[data-logout]")?.addEventListener("click", async () => {
    const ok = await confirmAction({ title: "تسجيل الخروج", message: "هل تريد تسجيل الخروج من تطبيق الموظفين؟", confirmLabel: "خروج", danger: true });
    if (!ok) return;
    stopNotificationPolling();
    await endpoints.logout();
    sessionStorage.removeItem(EMPLOYEE_TAB_SESSION_KEY);
    localStorage.removeItem(EMPLOYEE_PERSIST_SESSION_KEY);
    localStorage.removeItem("hr-attendance.local-db.v7");
    sessionStorage.removeItem("hr.core");
    sessionStorage.removeItem("hr.core.exp");
    state.user = null;
    location.hash = "home";
    renderLogin();
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const action = form.dataset.ajax;
  const values = readForm(form);
  try {
    if (action === "leave") {
      if (values.startDate && values.endDate && values.startDate > values.endDate) {
        setMessage("", "تاريخ نهاية الإجازة يجب أن يكون بعد تاريخ البداية.");
        renderLeaves();
        return;
      }
      await endpoints.createLeave({ ...values, workflowStatus: "pending_manager_review", status: "PENDING_MANAGER_REVIEW" });
      setMessage("تم إرسال طلب الإجازة للمدير المباشر.", "");
      location.hash = "leaves";
    }
    if (action === "mission") {
      await endpoints.createMission({ ...values, workflowStatus: "pending_manager_review", status: "PENDING_MANAGER_REVIEW" });
      setMessage("تم إرسال طلب المأمورية للمدير المباشر.", "");
      location.hash = "missions";
    }
    if (action === "dispute") {
      await endpoints.createDispute({ ...values, employeeId: state.user?.employeeId || state.user?.employee?.id || "", status: "committee_review", privacyLevel: "committee_only" });
      setMessage("تم رفع الشكوى إلى لجنة حل المشاكل والخلافات.", "");
      location.hash = "disputes";
    }
    render();
  } catch (error) {
    setMessage("", error.message || "حدث خطأ أثناء الحفظ.");
    render();
  }
}

async function renderLogin() {
  if (routeKey() === "register") {
    state.registerMode = false;
    history.replaceState(null, "", "#home");
  }
  const identifierValue = state.loginIdentifier || "";
  const passwordValue = state.loginPassword || "";
  app.innerHTML = `
    <div class="employee-login-screen">
      <form class="employee-login-card refined-login-card" id="employee-login-form" autocomplete="off" novalidate>
        <div class="login-brand-row">
          <img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" />
          <div><strong>أحلى شباب</strong><span>بوابة الدخول</span></div>
        </div>
        ${state.error ? `<div class="message error">${escapeHtml(state.error)}</div>` : ""}
        ${state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ""}
        ${state.lastLoginFailed ? `<div class="message warning compact">تعذر تسجيل الدخول. تأكد من الرقم وكلمة المرور ثم أعد المحاولة.</div>` : ""}
        <label>رقم الهاتف<input name="identifier" value="${escapeHtml(identifierValue)}" autocomplete="off" inputmode="tel" placeholder="01xxxxxxxxx" required /></label>
        <label>كلمة المرور
          <span class="login-password-field">
            <input name="password" type="password" value="${escapeHtml(passwordValue)}" autocomplete="current-password" placeholder="أدخل كلمة المرور" />
            <button class="password-toggle" type="button" aria-label="إظهار كلمة المرور" aria-pressed="false" data-toggle-password>عرض</button>
          </span>
        </label>
        <button class="button primary full" type="submit">دخول التطبيق</button>
      </form>
    </div>
  `;
  const form = app.querySelector("#employee-login-form");
  form.addEventListener("input", () => {
    const values = readForm(form);
    state.loginIdentifier = values.identifier || state.loginIdentifier || "";
    state.loginPassword = values.password || values.identifier || "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    try {
      state.loginIdentifier = values.identifier || "";
      state.loginPassword = values.password || values.identifier || "";
      state.user = unwrap(await endpoints.login(state.loginIdentifier, state.loginPassword));
      sessionStorage.setItem(EMPLOYEE_TAB_SESSION_KEY, "1");
      localStorage.setItem(EMPLOYEE_PERSIST_SESSION_KEY, "1");
      state.loginPassword = "";
      state.lastLoginFailed = false;
      setMessage("تم تسجيل الدخول بنجاح.", "");
      startNotificationPolling();
      render();
    } catch (error) {
      state.lastLoginFailed = true;
      setMessage("", error.message || "تعذر تسجيل الدخول.");
      renderLogin();
    }
  });
  const passwordInput = form.querySelector('[name="password"]');
  const togglePassword = app.querySelector("[data-toggle-password]");
  togglePassword?.addEventListener("click", () => {
    const visible = passwordInput?.type === "text";
    if (passwordInput) passwordInput.type = visible ? "password" : "text";
    togglePassword.setAttribute("aria-pressed", String(!visible));
    togglePassword.setAttribute("aria-label", visible ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
    togglePassword.textContent = visible ? "عرض" : "إخفاء";
    passwordInput?.focus?.();
  });
}

async function getBrowserLocation(options = {}) {
  if (!navigator.geolocation) return { locationPermission: "unavailable", accuracyMeters: null };
  const basePolicy = gpsPolicy();
  const policy = {
    ...basePolicy,
    samples: Number(options.samples || basePolicy.samples),
    windowMs: Number(options.windowMs || basePolicy.windowMs),
    targetAccuracy: Number(options.targetAccuracy || basePolicy.targetAccuracy),
    maxAcceptableAccuracy: Number(options.maxAcceptableAccuracy || basePolicy.maxAcceptableAccuracy),
  };
  return await new Promise((resolve) => {
    const samples = [];
    let watcher = null;
    let timer = null;
    const normalize = (position) => ({
      locationPermission: "granted",
      latitude: Number(position.coords.latitude),
      longitude: Number(position.coords.longitude),
      accuracy: Math.round(Number(position.coords.accuracy || 9999)),
      accuracyMeters: Math.round(Number(position.coords.accuracy || 9999)),
      altitude: position.coords.altitude,
      speed: position.coords.speed,
      heading: position.coords.heading,
      timestamp: position.timestamp || Date.now(),
      capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
    });
    const best = () => samples.slice().sort((a, b) => (a.accuracyMeters || 9999) - (b.accuracyMeters || 9999) || (b.timestamp || 0) - (a.timestamp || 0))[0] || null;
    const finish = (fallback = null) => {
      try { if (watcher != null) navigator.geolocation.clearWatch(watcher); } catch {}
      try { if (timer) window.clearTimeout(timer); } catch {}
      const value = best() || fallback || { locationPermission: "timeout", accuracyMeters: null };
      if (value.accuracyMeters && value.accuracyMeters > policy.maxAcceptableAccuracy) {
        value.locationWarning = "GPS_UNRELIABLE";
        value.locationError = "قراءة الموقع غير دقيقة كفاية للحكم داخل/خارج المجمع. أعد المحاولة في مكان مفتوح أو أرسلها للمراجعة.";
      }
      resolve(value);
    };
    watcher = navigator.geolocation.watchPosition(
      (position) => {
        const row = normalize(position);
        samples.push(row);
        if (samples.length >= policy.samples || row.accuracyMeters <= policy.targetAccuracy) finish(row);
      },
      (error) => {
        if (!samples.length) finish({ locationPermission: error.code === error.PERMISSION_DENIED ? "denied" : "unknown", accuracyMeters: null, error: error.message || "GPS error" });
      },
      { enableHighAccuracy: true, timeout: Math.min(12000, policy.windowMs), maximumAge: 15000 }
    );
    timer = window.setTimeout(() => finish(), policy.windowMs);
  });
}


async function getVerifiedBrowserLocation(employeeId = "", options = {}) {
  const raw = await getBrowserLocation(options);
  let evaluation = {};
  try {
    evaluation = unwrap(await endpoints.evaluateGeofence({ ...raw, employeeId, accuracyMeters: raw.accuracyMeters || raw.accuracy }));
  } catch (error) {
    evaluation = {};
  }
  const local = localGeofenceEvaluation(raw);
  const policy = gpsPolicy();
  const status = String(evaluation.geofenceStatus || raw.geofenceStatus || "").toLowerCase();
  const accuracy = Number(raw.accuracyMeters || raw.accuracy || evaluation.accuracyMeters || 0);
  const weak = Boolean(accuracy && accuracy > policy.maxAcceptableAccuracy);
  const serverOutside = status.includes("outside") || status.includes("geofence_miss");
  const localInsideHard = local.localInsideBranch === true;
  const localInsideReview = local.localInsideSoft === true;
  const uncertain = (weak && localInsideReview) || status.includes("low_accuracy") || status.includes("unavailable") || status.includes("unknown") || (serverOutside && localInsideReview && policy.uncertainReviewOnly);
  const inside = localInsideHard;
  const finalStatus = inside
    ? (weak ? "inside_branch_low_accuracy_review" : "inside_branch")
    : (uncertain ? "location_uncertain" : (evaluation.geofenceStatus || "outside_branch"));
  const merged = {
    ...raw,
    ...evaluation,
    ...local,
    accuracyMeters: accuracy || evaluation.accuracyMeters || raw.accuracyMeters,
    insideBranch: Boolean(inside),
    locationUncertain: Boolean(uncertain && !inside),
    geofenceStatus: finalStatus,
    canRecord: Boolean(inside && !weak),
    allowed: Boolean(inside && !weak),
    requiresReview: Boolean((uncertain && !inside) || evaluation.requiresReview),
  };
  const placeName = await reverseGeocode(merged.latitude, merged.longitude);
  merged.placeLabel = placeName || merged.placeLabel || merged.locationLabel || "";
  if (merged.insideBranch) merged.addressLabel = `${branchName()} — ${branchArea()}`;
  else if (merged.locationUncertain) merged.addressLabel = placeName || "الموقع غير مؤكد — سيتم إرساله للمراجعة بدل الحكم الخاطئ";
  else merged.addressLabel = placeName || merged.addressLabel || "موقع خارج المجمع";
  return merged;
}


function friendlyError(error, fallback = "تعذر تنفيذ العملية.") {
  const text = String(error?.message || error || fallback);
  if (text.includes("permission") || text.includes("صلاحية") || text.includes("الموقع")) return "لم نتمكن من تحديد موقعك. فعّل GPS واسمح للتطبيق بالوصول للموقع ثم حاول مرة أخرى.";
  if (text.includes("network") || text.includes("fetch")) return "الاتصال غير مستقر. تأكد من الإنترنت ثم أعد المحاولة.";
  if (text.includes("quota") || text.includes("مساحة")) return "مساحة التخزين المحلية امتلأت. استخدم صورة أصغر أو اطلب من الإدارة تفعيل Supabase.";
  if (text.includes("خارج") || text.includes("outside")) return "أنت خارج نطاق الجمعية. سيتم إرسال البصمة للمراجعة إذا كان ذلك مسموحًا.";
  return text || fallback;
}

async function renderRecoveryPassword() {
  shell(`
    <section class="employee-grid">
      <form class="employee-card full" id="recovery-password-form">
        <h2>تعيين كلمة مرور جديدة</h2>
        <p>تم فتح رابط استعادة كلمة المرور. اكتب كلمة مرور جديدة لا تقل عن 8 أحرف.</p>
        <label>كلمة المرور الجديدة<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required /></label>
        ${passwordStrengthMarkup()}
        <label>تأكيد كلمة المرور الجديدة<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></label>
        <button class="button primary full" type="submit">حفظ كلمة المرور الجديدة</button>
      </form>
    </section>
  `, "استعادة كلمة المرور", "تعيين كلمة مرور جديدة بعد فتح رابط الاستعادة.");
  bindPasswordStrength(app.querySelector("#recovery-password-form"));
  app.querySelector("#recovery-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    if (values.newPassword !== values.confirmPassword) { setMessage("", "تأكيد كلمة المرور غير مطابق."); return renderRecoveryPassword(); }
    try {
      await endpoints.changePassword({ ...values, recoveryMode: true });
      state.recoveryMode = false;
      setMessage("تم حفظ كلمة المرور الجديدة. يمكنك استخدام الحساب الآن.", "");
      location.hash = "profile";
      renderProfile();
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ كلمة المرور الجديدة.");
      renderRecoveryPassword();
    }
  });
}

async function renderHome() {
  if (window.HRV9?.shouldShowOnboarding?.(state.user?.profile || state.user || {})) {
    location.hash = "profile";
    return;
  }
  const [events, leaves, notifications, missions, tasks, liveRequests] = await Promise.all([
    endpoints.myAttendanceEvents().then(unwrap).catch(() => []),
    endpoints.leaves().then(unwrap).catch(() => []),
    endpoints.notifications().then(unwrap).catch(() => []),
    endpoints.missions().then(unwrap).catch(() => []),
    endpoints.myTasks().then(unwrap).catch(() => []),
    endpoints.myLiveLocationRequests().then(unwrap).catch(() => []),
  ]);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const employee = employeeSubject();
  const myEvents = events.filter((event) => !employeeId || event.employeeId === employeeId);
  const todayEvents = myEvents.filter((event) => String(event.eventAt || event.createdAt || "").startsWith(todayIso()));
  const lastEvent = myEvents[0] || {};
  const pendingLeaves = leaves.filter((item) => item.employeeId === employeeId && String(item.status || "").includes("PENDING")).length;
  const pendingMissions = missions.filter((item) => item.employeeId === employeeId && String(item.status || "").includes("PENDING")).length;
  const unread = notifications.filter((item) => !item.isRead && (!item.employeeId || item.employeeId === employeeId || item.userId === state.user?.id)).length;
  const nowMsForLive = Date.now();
  const pendingLive = (liveRequests || []).filter((item) => String(item.status || "").toUpperCase() === "PENDING" && employeeId && String(item.employeeId || "") === String(employeeId) && (!item.expiresAt || new Date(item.expiresAt).getTime() > nowMsForLive) && (item.expiresAt || !item.createdAt || (nowMsForLive - new Date(item.createdAt || item.requestedAt || 0).getTime()) <= 30 * 60 * 1000)).length;
  const reminder = todayReminderDue(todayEvents);
  const fridayHoliday = isFriday();
  const lastStatus = lastEvent.status || lastEvent.locationStatus || lastEvent.geofenceStatus || "";
  const inside = String(lastStatus).toLowerCase().includes("inside") || String(lastStatus).toLowerCase().includes("active") || String(lastStatus).toLowerCase().includes("in_range");
  const pendingTotal = pendingLeaves + pendingMissions;
  const activeTasks = tasks.filter((t) => t.status !== "COMPLETED").length;
  const allPending = [...leaves.filter((x) => x.employeeId === employeeId && String(x.status || "").includes("PENDING")),
                      ...missions.filter((x) => x.employeeId === employeeId && String(x.status || "").includes("PENDING"))];

  shell(`
    <section class="employee-home-flow">

      <!-- Hero Card with live clock -->
      <article class="employee-hero-card home-welcome ${pendingLive > 0 ? "has-live-alert" : ""}">
        ${employeeHeaderCell(employee)}
        <div class="hero-greeting-block">
          <div class="hero-text">
            <strong class="hero-greeting-label">${escapeHtml(greeting())} 👋</strong>
            <p>${fridayHoliday ? "الجمعة إجازة — أخذ راحة واستمتع بيومك. 🌴" : "كل ما تحتاجه يومياً في شاشة واحدة."}</p>
          </div>
          <div class="hero-live-clock" id="hr-home-clock" aria-live="off">
            <strong>${escapeHtml(timeNowText())}</strong>
            <small>${escapeHtml(fullDateText())}</small>
          </div>
        </div>
        <div class="hero-meta">
          ${fridayHoliday
            ? `<span class="hero-chip holiday">🎉 إجازة سعيدة</span>`
            : todayEvents.length
              ? `<span class="hero-chip success">✓ ${todayEvents.length} بصمة اليوم</span>`
              : `<span class="hero-chip warning">⚠ لم تُسجّل حضورك بعد</span>`}
          ${pendingLive > 0 ? `<span class="hero-chip urgent hr-pulse">🔴 ${pendingLive} طلب موقع عاجل</span>` : ""}
          ${unread > 0 ? `<span class="hero-chip info">🔔 ${unread} إشعار جديد</span>` : ""}
          ${inside ? `<span class="hero-chip success-soft">📍 داخل النطاق</span>` : ""}
        </div>
      </article>

      <!-- Urgent live location alert -->
      ${pendingLive > 0 ? `
        <article class="employee-card full hr-urgent-card">
          <div class="hr-urgent-header">
            <span class="hr-urgent-icon hr-pulse">🔴</span>
            <div>
              <div class="panel-kicker" style="color:#FF3B6B;border-color:rgba(255,59,107,.44);background:rgba(255,59,107,.1)">عاجل — مطلوب فوراً</div>
              <h2 style="margin:6px 0 4px">طلب موقع مباشر بانتظارك</h2>
              <p style="margin:0;color:var(--muted)">الإدارة تطلب تأكيد موقعك الآن. الرد المتأخر يُسجَّل تلقائياً.</p>
            </div>
          </div>
          <div class="employee-actions-row" style="margin-top:14px">
            <button class="button primary" data-route="location" style="min-height:52px;font-size:17px">📍 إرسال موقعي الآن</button>
            <button class="button ghost" data-enable-notifications type="button">🔔 تفعيل صوت الإشعار خارج التطبيق</button>
          </div>
        </article>` : ""}

      <!-- Friday holiday card -->
      ${fridayHoliday ? `
        <article class="employee-card full holiday-card">
          <div class="holiday-icon" aria-hidden="true">🌴</div>
          <div>
            <div class="panel-kicker">الجمعة إجازة</div>
            <h2>إجازة سعيدة</h2>
            <p>لا يوجد تذكير حضور اليوم. راجع إشعاراتك أو قدّم طلبات عند الحاجة.</p>
          </div>
          <div class="employee-actions-row">
            <button class="button ghost" data-route="notifications">🔔 الإشعارات</button>
            <button class="button ghost" data-route="requests">📋 طلباتي</button>
          </div>
        </article>` : ""}

      <!-- Punch CTA -->
      <article class="employee-card full punch-primary-card ${!fridayHoliday && !todayEvents.length ? "punch-cta-glow" : ""}">
        <div class="panel-kicker">البصمة اليومية</div>
        <h2>${fridayHoliday ? "لا توجد بصمة مطلوبة اليوم" : todayEvents.length ? `✓ تم تسجيل ${todayEvents.length} حركة اليوم` : "⏳ لم تُسجّل حضورك بعد"}</h2>
        <p>${fridayHoliday ? "الجمعة إجازة أسبوعية." : todayEvents.length ? `آخر حركة: ${escapeHtml(date(lastEvent.eventAt || lastEvent.createdAt))} — ${escapeHtml(statusLabel(lastEvent.type || lastEvent.eventType || ""))}` : "سجّل حضورك عند وصولك أو أرسل موقعك عند طلب الإدارة."}</p>
        <div class="employee-actions-row">
          ${fridayHoliday
            ? `<button class="button ghost" data-route="notifications">عرض الإشعارات</button><button class="button ghost" data-route="location">إرسال موقعي</button>`
            : `<button class="button primary full" data-route="punch" style="min-height:52px;font-size:17px">👁 فتح البصمة</button><button class="button ghost" data-route="location">📍 موقعي</button>`}
        </div>
      </article>

      <!-- Stats grid -->
      <section class="quick-actions-grid unified-actions home-stats-grid" aria-label="إحصائيات سريعة">
        ${compactMetric("بصمات اليوم", todayEvents.length, "👁", "punch")}
        ${compactMetric("إشعارات", unread, "🔔", "notifications")}
        ${compactMetric("طلبات موقع", pendingLive, "📍", "location")}
        ${compactMetric("إجازات معلقة", pendingLeaves, "🏖", "leaves")}
        ${compactMetric("مأموريات معلقة", pendingMissions, "🚗", "missions")}
        ${compactMetric("مهامي", activeTasks, "✅", "tasks")}
        ${compactMetric("تقييمي KPI", "فتح", "📊", "kpi")}
        ${compactMetric("شكوى/خلاف", "رفع", "⚖️", "disputes")}
        ${getManagerLikeRole() ? compactMetric("فريقي", "إدارة", "👥", "team") : ""}
        ${getManagerLikeRole() ? compactMetric("KPI فريقي", "مراجعة", "📊", "manager-kpi") : ""}
      </section>

      <!-- Location card -->
      <article class="employee-card full location-status-card">
        <div class="panel-head" style="margin-bottom:12px">
          <div><div class="panel-kicker">آخر موقع مسجل</div></div>
          <span class="${inside ? "pill success" : "pill warning"}">${inside ? "داخل النطاق ✓" : "خارج النطاق"}</span>
        </div>
        ${lastEvent?.id ? readableLocationBlock(lastEvent) : `<div class="readable-location"><div><span class="pill warning">لم يتم التحقق بعد</span><strong>${branchName()}</strong><small>${branchArea()}</small></div></div>`}
        <div class="employee-actions-row" style="margin-top:12px">
          <button class="button ghost small" data-route="punch">🗺 الخريطة واختبار GPS</button>
          <button class="button ghost small" data-route="location">📍 إرسال موقعي</button>
        </div>
      </article>

      <!-- Last 5 punches -->
      <article class="employee-card full">
        <div class="panel-head" style="margin-bottom:12px">
          <div><div class="panel-kicker">سجل البصمات</div><h2 style="margin:4px 0 0">آخر بصماتي</h2></div>
          <button class="button ghost small" data-route="punch">عرض الكل</button>
        </div>
        ${myEvents.length
          ? `<div class="employee-list">${myEvents.slice(0, 5).map((item) => `
              <div class="employee-list-item hr-punch-row" data-punch-type="${item.type?.includes("OUT") || item.eventType?.includes("OUT") ? "out" : "in"}">
                <div class="hr-punch-type-dot"></div>
                <div style="flex:1;min-width:0">
                  <strong>${escapeHtml(statusLabel(item.type || item.eventType || "حركة"))}</strong>
                  <span>${escapeHtml(date(item.eventAt || item.createdAt))}</span>
                  <small style="display:block;margin-top:2px;color:var(--muted)">${escapeHtml(locationLabelFromRecord(item))}</small>
                </div>
                <div class="list-item-side">${locationStatusBadge(item)}</div>
              </div>`).join("")}
            </div>`
          : `<div class="empty-state"><span class="hr-empty-icon">👁</span><strong>لا توجد بصمات بعد</strong><small>سجّل حضورك أولاً من صفحة البصمة.</small></div>`}
      </article>

      <!-- Pending requests summary (only if any) -->
      ${allPending.length > 0 ? `
        <article class="employee-card full">
          <div class="panel-head" style="margin-bottom:12px">
            <div><div class="panel-kicker">طلبات معلقة</div><h2 style="margin:4px 0 0">${allPending.length} طلب ينتظر رد الإدارة</h2></div>
            <button class="button ghost small" data-route="requests">عرض الكل</button>
          </div>
          ${renderRequestList(allPending.slice(0, 3))}
        </article>` : ""}

      <!-- Permissions row -->
      <div class="employee-actions-row v10-permissions-row hr-permissions-row">
        <button class="button ghost small" data-enable-notifications type="button">🔔 تفعيل الإشعارات</button>
        <button class="button ghost small" data-enable-location type="button">📍 تفعيل الموقع</button>
      </div>

    </section>
  `, "الرئيسية", `${escapeHtml(greeting())} — ${escapeHtml(currentEmployeeLabel(employee))}`);

  // Live clock update every minute
  const clockEl = app.querySelector("#hr-home-clock strong");
  if (clockEl) {
    const tick = () => { try { clockEl.textContent = timeNowText(); } catch { clearInterval(iv); } };
    const iv = setInterval(tick, 30000);
  }

  if (reminder) {
    showAttendanceFloatingReminder();
    showAttendanceBrowserNotification();
  }
}

async function renderActionCenter() {
  const data = await endpoints.myActionCenter().then(unwrap).catch(() => ({ actions: [] }));
  const actions = data.actions || [];
  shell(`
    <section class="employee-grid">
      <article class="employee-card full ${actions.length ? 'urgent-card' : ''}">
        <div class="panel-kicker">مطلوب مني الآن</div>
        <h2>${actions.length ? `لديك ${actions.length} إجراء مطلوب` : 'لا توجد إجراءات مطلوبة'}</h2>
        <p>هذه الصفحة تجمع المطلوب منك بدل البحث داخل الصفحات: طلب موقع، سياسة، مهمة، مستند، أو بصمة تحتاج متابعة.</p>
      </article>
      ${actions.length ? actions.map((item) => `
        <article class="employee-card full">
          <div class="panel-kicker">${escapeHtml(item.type || 'ACTION')} — ${escapeHtml(item.severity || '')}</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.body || '')}</p>
          <button class="button primary" data-route="${escapeHtml(item.route || 'home')}">فتح الإجراء</button>
        </article>
      `).join('') : `<article class="employee-card full"><div class="empty-state">كل شيء مكتمل حاليًا. تابع الإشعارات والمهام يوميًا.</div></article>`}
    </section>
  `, "مطلوب مني الآن", "مركز الإجراءات العاجلة للموظف.");
}


async function renderPunch() {
  let address = {};
  let events = [];
  try {
    [address, events] = await Promise.all([
      endpoints.attendanceAddress().then(unwrap),
      endpoints.myAttendanceEvents().then(unwrap).catch(() => []),
    ]);
  } catch (error) {
    shell(`<section class="employee-card"><h2>لا يمكن فتح البصمة</h2><p>${escapeHtml(error.message || "الحساب غير مرتبط بموظف.")}</p></section>`, "البصمة", "يلزم ربط الحساب بموظف.");
    return;
  }
  const employee = address.employee || state.user?.employee || employeeSubject();
  const employeeId = state.user?.employeeId || state.user?.employee?.id || employee.id;
  const myEvents = events.filter((event) => !employeeId || event.employeeId === employeeId);
  const todayEvents = myEvents.filter((event) => String(event.eventAt || event.createdAt || "").startsWith(todayIso()));
  const suggestedType = todayEvents.length && isMorningPunchTime() === false ? "out" : (todayEvents.some((e)=>String(e.type||e.eventType||"").toLowerCase().includes("in")) ? "out" : "in");
  const primaryLabel = suggestedType === "in" ? "بصمة حضور الآن" : "بصمة انصراف الآن";
  const secondaryLabel = suggestedType === "in" ? "بصمة انصراف" : "بصمة حضور";
  shell(`
    <section class="employee-grid punch-mobile punch-redesigned">
      <article class="employee-card full">
        <div class="punch-focus">${employeeHeaderCell(employee)}<div class="punch-orb">👁</div></div>
        <div class="branch-readable-card">
          <div class="branch-circle">📍</div>
          <div><strong>${branchName()}</strong><small>${branchArea()}</small></div>
        </div>
        <div id="gps-map-preview" class="gps-map-preview"><div class="gps-geofence-diagram"><div class="gps-geofence-ring"><span>دائرة 300 متر</span><i></i></div><small>اضغط اختبار الموقع لعرض مكانك الحقيقي داخل/خارج النطاق.</small></div></div>
        ${attendanceNoteField()}
        <div class="employee-actions-stack punch-actions-clear">
          <button class="button primary full" data-punch-type="${suggestedType}">${primaryLabel}</button>
          <button class="button ghost full" data-punch-type="${suggestedType === "in" ? "out" : "in"}">${secondaryLabel}</button>
          <button class="button ghost small" data-test-gps type="button">اختبار الموقع / عرض الخريطة</button>
        </div>
        <div id="punch-result" class="message compact hidden"></div>
        <p class="form-hint">تسجيل/تحديث بصمة الجهاز انتقل إلى: حسابي ← أمان الجهاز، حتى لا يختلط بزر البصمة.</p>
      </article>
      <article class="employee-card full"><h2>آخر بصماتي</h2>${myEvents.length ? `<div class="employee-list">${myEvents.slice(0, 5).map((item) => `<div class="employee-list-item"><div><strong>${escapeHtml(statusLabel(item.type || item.eventType || "حركة"))}</strong><span>${escapeHtml(date(item.eventAt || item.createdAt))}</span><small>${escapeHtml(locationLabelFromRecord(item))}</small>${item.notes ? `<small>ملاحظة: ${escapeHtml(item.notes)}</small>` : ""}</div><div class="list-item-side">${locationStatusBadge(item)}${badge(item.riskLevel || item.status || "")}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد بصمات مسجلة.</div>`}</article>
    </section>
  `, "البصمة", "تسجيل حضور أو انصراف ببصمة الجهاز + GPS.");

  const resultBox = app.querySelector("#punch-result");
  app.querySelector("[data-test-gps]")?.addEventListener("click", async () => {
    try {
      resultBox?.classList.remove("hidden", "danger-box");
      if (resultBox) resultBox.textContent = "جاري اختبار الموقع بدقة عالية...";
      const current = await getVerifiedBrowserLocation(employeeId);
      const normalized = safeLocationDisplayRecord({ ...current, status: current.geofenceStatus || (current.canRecord ? "inside_branch" : (current.locationUncertain ? "location_uncertain" : "outside_branch")), addressLabel: current.canRecord ? `${branchName()} — ${branchArea()}` : (current.addressLabel || (current.locationUncertain ? "الموقع غير مؤكد" : "موقع خارج المجمع")) });
      sessionStorage.setItem("hr.employee.lastGpsTest", JSON.stringify({ ...normalized, testedAt: new Date().toISOString() }));
      const preview = app.querySelector("#gps-map-preview");
      if (preview) preview.innerHTML = `${readableLocationBlock(normalized)}${geofenceMapPreview(normalized)}`;
      if (resultBox) resultBox.textContent = current.canRecord ? "أنت داخل دائرة 300 متر الخاصة بمجمع أحلى شباب." : (current.locationUncertain ? "الموقع قريب أو دقته غير كافية؛ سيظهر للمراجعة مع المسافة والدقة." : `أنت خارج دائرة 300 متر. المسافة التقريبية: ${formatMeters(current.distanceFromBranchMeters)}.`);
    } catch (error) {
      resultBox?.classList.remove("hidden");
      resultBox?.classList.add("danger-box");
      if (resultBox) resultBox.textContent = friendlyError(error, "تعذر اختبار الموقع.");
    }
  });

  app.querySelectorAll("[data-punch-type]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.punchType || "in";
    const actionText = type === "out" ? "انصراف" : "حضور";
    try {
      resultBox?.classList.remove("hidden", "danger-box");
      if (resultBox) resultBox.textContent = `جاري تأكيد بصمة الجهاز ثم GPS لتسجيل ${actionText}...`;
      const preFingerprint = await getDeviceFingerprintHash().catch(() => "");
      const policyAck = await ensureAttendancePolicyAcknowledged({ endpoints, employee, deviceFingerprintHash: preFingerprint });
      const device = await requestBrowserPasskeyForAction(`تأكيد بصمة ${actionText}`, employee, { autoRegisterOnMissing: true, resultBox });
      if (!state.lastLocation) await window.HRExplainAndEnableLocation?.();
      if (resultBox) resultBox.textContent = "جاري قراءة GPS والتقاط صورة تحقق...";
      const current = await getVerifiedBrowserLocation(employeeId, { samples: 4, windowMs: 10000, targetAccuracy: 60 });
      state.lastLocation = current;
      const selfie = await capturePunchSelfie({ endpoints, employeeId, resultBox }).catch((error) => ({ ok: false, reason: "SELFIE_CAPTURE_FAILED", message: error?.message || "تعذر التقاط صورة التحقق.", selfieUrl: "" }));
      if (!selfie.ok) throw new Error(selfie.message || "يلزم التقاط صورة تحقق قبل تسجيل البصمة.");
      if (!current.latitude || !current.longitude || current.locationPermission === "denied") throw new Error("لم يتم استلام إحداثيات GPS. فعّل الموقع من المتصفح واضغط اختبار الموقع أولاً.");
      const qr = isQrDisabled() ? { valid: true, status: "DISABLED", riskFlags: [], requiresReview: false } : await requestBranchQrChallenge({ endpoints, branchId: address.branch?.id || address.branchId || "main" }).catch(() => ({ status: "NOT_PROVIDED" }));
      const trustedDevice = await ensureTrustedDeviceApproval({ endpoints, employee, device: { ...device, deviceFingerprintHash: device.deviceFingerprintHash || preFingerprint }, selfieUrl: selfie.selfieUrl || selfie.url || "", location: current }).catch(() => ({ status: "PENDING_REVIEW", requiresReview: true, riskFlags: ["DEVICE_APPROVAL_CHECK_FAILED"] }));
      const status = current.canRecord ? "inside_branch" : (current.locationUncertain ? "location_uncertain" : "outside_branch");
      const locationTrust = analyzeLocationTrust(current, { branch: address.branch || address, geofenceStatus: current.geofenceStatus || status });
      const risk = mergeRiskSignals(calculateAttendanceRisk({ employeeId, location: current, device, selfie, evaluation: { ...(trustedDevice || {}), geofenceStatus: status } }), locationTrust, qr, trustedDevice);
      const v4 = await evaluateAttendanceV4Controls({ endpoints, employee, device: { ...device, deviceFingerprintHash: device.deviceFingerprintHash || preFingerprint }, location: current, risk }).catch(() => ({}));
      const merged = mergeV4RiskSignals ? mergeV4RiskSignals(risk, v4) : risk;
      const faceDisabled = isFaceSelfieDisabled();
      const insideBranch = status === "inside_branch" && current.canRecord === true;
      const finalRiskFlags = Array.from(new Set(merged.riskFlags || risk.riskFlags || []))
        .filter((flag) => !(faceDisabled && ["MISSING_SELFIE", "FACE_SELFIE_TEMP_DISABLED", "SELFIE_CAPTURE_FAILED"].includes(String(flag))));
      const directRecord = insideBranch && device.ok !== false && current.locationPermission === "granted";
      const finalRequiresReview = directRecord ? false : Boolean(merged.requiresReview || risk.requiresReview || status !== "inside_branch");
      const finalRiskScore = directRecord ? 0 : Number(merged.riskScore ?? risk.riskScore ?? 0);
      const finalRiskLevel = directRecord ? "LOW" : (merged.riskLevel || risk.riskLevel || "MEDIUM");
      const notes = app.querySelector("#punch-notes")?.value || "";
      const body = { ...current, type: type === "out" ? "CHECK_OUT" : "CHECK_IN", eventType: type, employeeId, notes, status, locationStatus: status, addressLabel: current.canRecord ? `${branchName()} — ${branchArea()}` : (current.addressLabel || current.locationLabel || (current.locationUncertain ? "الموقع غير مؤكد — مراجعة" : "خارج نطاق المجمع")), verificationStatus: "verified", biometricMethod: isQrDisabled() ? "passkey+gps" : "passkey+gps+qr", passkeyCredentialId: device.passkeyCredentialId, trustedDeviceId: device.trustedDeviceId, deviceFingerprintHash: device.deviceFingerprintHash || preFingerprint, browserInstallId: policyAck.browserInstallId || "", selfieUrl: selfie.selfieUrl || selfie.url || "", branchQrStatus: qr.status, branchQrChallengeId: qr.challengeId || "", antiSpoofingFlags: locationTrust.flags || [], riskScore: finalRiskScore, riskLevel: finalRiskLevel, riskFlags: finalRiskFlags, requiresReview: finalRequiresReview };
      if (!device.ok || !selfie.ok || current.locationPermission === "denied") await createFormalFallbackRequest?.({ endpoints, reason: "IDENTITY_COMPONENT_FAILED", body }).catch(() => submitFallbackAttendanceRequest({ endpoints, reason: "IDENTITY_COMPONENT_FAILED", body }).catch(() => null));
      await endpoints.recordAttendance(body);
      rememberDevicePunch(body.deviceFingerprintHash, employeeId);
      setMessage(status === "inside_branch" ? `تم تسجيل بصمة ${actionText} داخل مجمع أحلى شباب.` : (status === "location_uncertain" ? `تم تسجيل بصمة ${actionText} كموقع غير مؤكد وستظهر للمراجعة بدل الحكم بالخروج.` : `تم تسجيل بصمة ${actionText} خارج المجمع وستظهر للمراجعة مع المكان والملاحظة.`), "");
      renderPunch();
    } catch (error) {
      resultBox?.classList.remove("hidden");
      resultBox?.classList.add("danger-box");
      if (resultBox) resultBox.textContent = friendlyError(error, "تعذر تسجيل البصمة.");
    }
  }));
}

async function renderLocation() {
  const [rows, liveRequests, _actionCenter, passkeys] = await Promise.all([
    endpoints.locations().then(unwrap).catch(() => []),
    endpoints.myLiveLocationRequests().then(unwrap).catch(() => []),
    endpoints.myActionCenter().then(unwrap).catch(() => ({ actions: [] })),
    endpoints.passkeyStatus().then(unwrap).catch(() => []),
  ]);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const employee = state.user?.employee || { id: employeeId, fullName: state.user?.fullName || "الموظف" };
  const trustedPasskeys = filterEmployeePasskeys(passkeys || [], state.user || {}, employee);
  const hasTrustedDevice = trustedPasskeys.length > 0;
  const mine = rows.filter((item) => !item.employeeId || item.employeeId === employeeId).slice(0, 20);
  const nowMsForLocation = Date.now();
  const pending = liveRequests.filter((item) => String(item.status || "").toUpperCase() === "PENDING" && employeeId && String(item.employeeId || "") === String(employeeId) && (!item.expiresAt || new Date(item.expiresAt).getTime() > nowMsForLocation) && (item.expiresAt || !item.createdAt || (nowMsForLocation - new Date(item.createdAt || item.requestedAt || 0).getTime()) <= 30 * 60 * 1000)).slice(0, 5);
  shell(`
    <section class="employee-grid">
      ${pending.length ? `<article class="employee-card full urgent-card live-location-section"><div class="panel-kicker">إجراء مطلوب</div><h2>طلبات موقع مباشر من الإدارة</h2><p>شارك موقعك الحالي الآن. لا يوجد تأجيل أو رفض في طلب الموقع المباشر؛ المطلوب فقط إرسال GPS الحالي للتأكد من الموقع.</p><div class="employee-list live-location-card-list">${pending.map((item) => `<div class="employee-list-item live-location-request-card"><div><strong>${escapeHtml(liveLocationRequesterName(item))}</strong><span>${escapeHtml(item.reason || "طلب موقع مباشر")}</span><small>ينتهي: ${escapeHtml(date(item.expiresAt))}</small></div><div class="list-item-side"><button class="button primary" data-live-send="${escapeHtml(item.id)}">إرسال موقعي الآن</button></div></div>`).join("")}</div></article>` : ""}
      <article class="employee-card full">
        <div class="panel-kicker">موقع مباشر</div>
        <h2>إرسال موقعي الحالي</h2>
        <p>استخدم هذا الزر لإرسال موقعك الحالي طوعًا أو عند وجود طلب من الإدارة. لا يوجد تتبع مستمر في الخلفية.</p>
        <button class="button primary full" data-send-location>إرسال موقعي الآن</button>
        <div class="location-fast-note">
          <strong>إرسال سريع للموقع</strong>
          <span>لا يلزم تأكيد بصمة الجهاز هنا. سيتم إرسال GPS الحالي فقط بعد سماحك بقراءة الموقع.</span>
        </div>
        <div id="location-result" class="risk-box hidden"></div>
      </article>
      <article class="employee-card full location-history-card"><h2>سجل المواقع والطلبات</h2>${mine.length ? `<div class="employee-list">${mine.map((item) => `<div class="employee-list-item location-history-item"><div class="location-history-main"><strong>${statusLabel(item.status)}</strong><span>${date(item.requestedAt || item.date || item.createdAt)}</span>${item.latitude && item.longitude ? readableLocationBlock(item, { compact: true }) : `<small>لم يتم إرسال موقع بعد</small>`}</div><div class="list-item-side">${item.latitude && item.longitude ? `<a target="_blank" rel="noopener" class="button ghost small" href="https://www.google.com/maps?q=${escapeHtml(item.latitude)},${escapeHtml(item.longitude)}">خريطة</a>` : badge(item.status || "PENDING")}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد طلبات موقع بعد.</div>`}</article>
      <article class="employee-card full live-location-section"><h2>طلبات الموقع المباشر</h2>${liveRequests.length ? `<div class="employee-list live-location-card-list">${liveRequests.slice(0, 10).map((item) => `<div class="employee-list-item live-location-request-card"><div><strong>${escapeHtml(liveLocationRequesterName(item))}</strong><span>${escapeHtml(item.reason || "طلب موقع")}</span><small>${escapeHtml(date(item.createdAt))}</small></div><div class="list-item-side">${badge(item.status)}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد طلبات مباشرة.</div>`}</article>
    </section>
  `, "الموقع", "مشاركة الموقع المباشر بموافقة الموظف عند الطلب.");
  const result = app.querySelector("#location-result");
  const sendLive = async (id) => {
    result?.classList.remove("hidden", "danger-box");
    if (result) result.textContent = "جاري قراءة الموقع بدقة عالية...";
    const current = await getVerifiedBrowserLocation(employeeId);
    if (current.locationPermission !== "granted") throw new Error("لم يتم السماح بقراءة الموقع. فعّل GPS واسمح للتطبيق بالوصول للموقع.");
    await endpoints.respondLiveLocationRequest(id, { status: "APPROVED", ...current, biometricMethod: "gps" });
    document.querySelectorAll("[data-live-location-alert]").forEach((node) => { if (node.dataset.liveLocationAlert === id) node.remove(); });
    activeLiveLocationAlertId = "";
  };
  app.querySelectorAll("[data-live-send]").forEach((button) => button.addEventListener("click", async () => {
    try { await sendLive(button.dataset.liveSend); setMessage("تم إرسال موقعك المباشر للإدارة.", ""); renderLocation(); } catch (error) { setMessage("", friendlyError(error, "تعذر إرسال الموقع.")); renderLocation(); }
  }));
  false && app.querySelectorAll("[data-live-postpone]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await endpoints.respondLiveLocationRequest(button.dataset.livePostpone, { status: "POSTPONED", reason: "طلب الموظف تأجيل إرسال الموقع 5 دقائق", postponeMinutes: 5 });
      setMessage("تم إبلاغ الإدارة برفض/تأجيل مؤقت لمدة 5 دقائق، وتم إغلاق الطلب الحالي.", "");
      renderLocation();
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ التأجيل.");
      renderLocation();
    }
  }));
  false && app.querySelectorAll("[data-live-reject]").forEach((button) => button.addEventListener("click", async () => {
    const reason = await askText({ title: "رفض/تأجيل مؤقت لإرسال الموقع", message: "اكتب سبب الرفض المؤقت حتى يظهر للمدير التنفيذي.", defaultValue: "غير متاح الآن", confirmLabel: "إرسال الرد المؤقت" });
    if (reason === null) return;
    try { await endpoints.respondLiveLocationRequest(button.dataset.liveReject, { status: "REJECTED_TEMPORARY", reason }); setMessage("تم إرسال سبب الرفض/التأجيل المؤقت للإدارة.", ""); renderLocation(); } catch (error) { setMessage("", error.message || "تعذر حفظ الرد."); renderLocation(); }
  }));
  app.querySelector("[data-register-location-passkey]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      result?.classList.remove("hidden", "danger-box");
      if (result) result.textContent = "افتح بصمة الهاتف أو قفل الشاشة لتسجيل بصمة هذا الجهاز...";
      await registerBrowserPasskey();
      if (result) result.textContent = "تم تسجيل بصمة الجهاز بنجاح. يمكنك الآن إرسال موقعك أو تسجيل البصمة.";
      setMessage("تم تسجيل بصمة الجهاز بنجاح.", "");
      renderLocation();
    } catch (error) {
      result?.classList.remove("hidden");
      result?.classList.add("danger-box");
      if (result) result.textContent = friendlyError(error, "تعذر تسجيل بصمة الجهاز.");
    } finally {
      button.disabled = false;
    }
  });
  app.querySelector("[data-send-location]")?.addEventListener("click", async () => {
    try {
      result?.classList.remove("hidden", "danger-box");
      if (result) result.textContent = "جاري قراءة الموقع...";
      const current = await getVerifiedBrowserLocation(employeeId);
      if (current.locationPermission !== "granted") throw new Error("لم يتم السماح بقراءة الموقع.");
      const pendingLocationRequest = mine.find((item) => item.status === "PENDING" && item.id && String(item.id).startsWith("locreq"));
      if (pendingLocationRequest) await endpoints.updateLocationRequest(pendingLocationRequest.id, { status: "APPROVED", ...current, biometricMethod: "gps" });
      else await endpoints.recordLocation({ employeeId, source: "employee_app", status: "ACTIVE", ...current, biometricMethod: "gps" });
      setMessage("تم إرسال موقعك الحالي بنجاح.", "");
      renderLocation();
    } catch (error) {
      if (result) { result.classList.remove("hidden"); result.classList.add("danger-box"); result.textContent = friendlyError(error, "تعذر إرسال الموقع."); }
    }
  });
}


async function renderLeaves() {
  const leaves = await endpoints.leaves().then(unwrap).catch(() => []);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const mine = leaves.filter((item) => !employeeId || item.employeeId === employeeId).slice(0, 30);
  shell(`
    <section class="employee-grid">
      <form class="employee-card full" data-ajax="leave">
        <div class="panel-kicker">مسار اعتماد: المدير المباشر ثم HR</div>
        <h2>طلب إجازة</h2>
        <p>يتم إرسال الطلب أولًا إلى المدير المباشر، وبعد موافقته ينتقل إلى HR للاعتماد النهائي.</p>
        <div class="employee-form-grid">
          <label>نوع الإجازة<select name="leaveType"><option>اعتيادية</option><option>مرضية</option><option>طارئة</option></select></label>
          <label>من تاريخ<input type="date" name="startDate" required /></label>
          <label>إلى تاريخ<input type="date" name="endDate" required /></label>
          <label class="span-2">السبب<textarea name="reason" rows="3" required></textarea></label>
        </div>
        <input type="hidden" name="workflowStatus" value="pending_manager_review" />
        <button class="button primary full" type="submit">إرسال للمدير المباشر</button>
      </form>
      <article class="employee-card full"><h2>طلباتي</h2>${mine.length ? `<div class="employee-list">${mine.map((item) => `<div class="employee-list-item"><div><strong>${escapeHtml(item.leaveType?.name || item.leaveType || "إجازة")}</strong><span>${escapeHtml(item.startDate || "-")} إلى ${escapeHtml(item.endDate || "-")}</span><small>${escapeHtml(item.managerDecision ? `قرار المدير: ${item.managerDecision}` : "بانتظار مسار الاعتماد")}</small></div><div class="list-item-side">${badge(item.finalStatus || item.workflowStatus || item.status)}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد طلبات إجازة.</div>`}</article>
    </section>
  `, "الإجازات", "تقديم طلب إجازة ومتابعة الاعتماد.");
}

async function renderMissions() {
  const missions = await endpoints.missions().then(unwrap).catch(() => []);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const mine = missions.filter((item) => !employeeId || item.employeeId === employeeId).slice(0, 30);
  shell(`
    <section class="employee-grid">
      <form class="employee-card full" data-ajax="mission">
        <div class="panel-kicker">مسار اعتماد: المدير المباشر ثم HR</div>
        <h2>طلب مأمورية</h2>
        <p>اكتب تفاصيل المأمورية والوجهة وموعد البداية والنهاية. ينتقل الطلب للمدير المباشر ثم HR.</p>
        <label>عنوان المأمورية<input name="title" required placeholder="مثال: زيارة حالة / توصيل مستندات" /></label>
        <label>الوجهة<input name="destinationName" required placeholder="اسم المكان أو العنوان" /></label>
        <label>بداية المأمورية<input name="plannedStart" type="datetime-local" required /></label>
        <label>نهاية المأمورية<input name="plannedEnd" type="datetime-local" required /></label>
        <label>ملاحظات إضافية<textarea name="notes" rows="2" placeholder="اكتب تفاصيل مختصرة إن وجدت"></textarea></label>
        <input type="hidden" name="workflowStatus" value="pending_manager_review" />
        <div class="employee-actions-stack"><button class="button primary">إرسال للمدير المباشر</button></div>
      </form>
      <article class="employee-card full"><h2>مأمورياتي</h2>${renderRequestList(mine)}</article>
    </section>
  `, "المأموريات", "طلب ومتابعة المأموريات المعتمدة.");
}

async function renderDisputes() {
  const [payload, employees] = await Promise.all([
    endpoints.disputes().then(unwrap).catch(() => ({ cases: [] })),
    endpoints.employees().then(unwrap).catch(() => []),
  ]);
  const cases = Array.isArray(payload) ? payload : (payload.cases || []);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const mine = cases.filter((item) => !item.employeeId || item.employeeId === employeeId).slice(0, 20);
  shell(`
    <section class="employee-grid disputes-polished-page">
      <article class="employee-card full disputes-hero-card">
        <div class="panel-kicker">لجنة حل المشاكل والخلافات</div>
        <h2>تقديم شكوى أو طلب فض خلاف</h2>
        <p>يتم رفع الطلب للجنة المختصة بسرية، ثم المتابعة عبر السكرتير التنفيذي والتصعيد للمدير التنفيذي عند الحاجة.</p>
        <div class="workflow-steps compact-workflow">
          ${["الموظف", "اللجنة", "السكرتير التنفيذي", "المدير التنفيذي"].map((step, index) => `<span><strong>${index + 1}</strong>${escapeHtml(step)}</span>`).join("")}
        </div>
      </article>
      <form class="employee-card full dispute-form-card" data-ajax="dispute">
        <div class="employee-form-grid">
          <div class="span-2 segmented-field">
            <span>نوع الطلب</span>
            <label><input type="radio" name="category" value="شكوى" checked /> شكوى</label>
            <label><input type="radio" name="category" value="فض خلاف" /> فض خلاف</label>
            <label><input type="radio" name="category" value="ملاحظة سلوكية" /> ملاحظة سلوكية</label>
          </div>
          <div class="span-2 segmented-field danger-levels">
            <span>الأولوية</span>
            <label><input type="radio" name="priority" value="LOW" /> عادية</label>
            <label><input type="radio" name="priority" value="MEDIUM" checked /> متوسطة</label>
            <label><input type="radio" name="priority" value="HIGH" /> عاجلة</label>
          </div>
          <label class="span-2 checkbox-line polished-check"><input type="checkbox" name="hasRelatedEmployee" value="yes" data-toggle-related-employee /> الطلب متعلق بموظف معين</label>
          <label class="span-2 related-employee-field hidden">اختيار الموظف<select name="relatedEmployeeId"><option value="">اختر الموظف</option>${employees.map((e)=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.fullName || e.name || e.email || e.id)}</option>`).join("")}</select></label>
          <label class="span-2">عنوان مختصر<input name="title" required placeholder="مثال: خلاف في تسليم مهمة" /></label>
          <div class="span-2 repeat-grid">
            <label class="checkbox-line polished-check"><input type="checkbox" name="repeatedBefore" value="yes" /> تكررت سابقًا</label>
            <label class="checkbox-line polished-check"><input type="checkbox" name="repeatedWithSamePerson" value="yes" /> تكررت مع نفس الشخص</label>
          </div>
          <label class="span-2">التفاصيل كاملة<textarea name="description" rows="7" required placeholder="اكتب ماذا حدث، متى، أين، ومن الأطراف إن وجدوا. كلما كانت التفاصيل أوضح كان القرار أسرع."></textarea></label>
          <label class="span-2">ملاحظات أو شهود<input name="notes" placeholder="اختياري" /></label>
          <label class="span-2">مرفقات داعمة<input name="attachmentNote" placeholder="اذكر أسماء الملفات أو سلمها للجنة عند الطلب" /></label>
        </div>
        <button class="button primary full" type="submit">رفع الطلب للجنة</button>
      </form>
      <article class="employee-card full"><h2>طلباتي السابقة</h2>${mine.length ? `<div class="employee-list polished-history-list">${mine.map((item) => `<div class="employee-list-item"><div><strong>${escapeHtml(item.title)}</strong><span>${date(item.createdAt)}</span><small>${escapeHtml(item.publicUpdate || item.committeeDecision || "قيد مراجعة اللجنة")}</small></div><div class="list-item-side">${badge(item.priority || item.severity || "MEDIUM")} ${badge(item.status)}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد شكاوى مسجلة.</div>`}</article>
    </section>
  `, "الشكاوى", "طلب شكوى أو فض خلاف بسرية ووضوح.");
  const toggle = app.querySelector("[data-toggle-related-employee]");
  const field = app.querySelector(".related-employee-field");
  toggle?.addEventListener("change", () => field?.classList.toggle("hidden", !toggle.checked));
}


async function renderKpi() {
  const payload = await endpoints.kpi().then(unwrap).catch(() => ({ metrics: [], evaluations: [], pendingEmployees: [], currentEmployeeId: state.user?.employeeId || state.user?.employee?.id || "" }));
  const employeeId = state.user?.employeeId || state.user?.employee?.id || payload.currentEmployeeId || "";
  const mine = (payload.evaluations || []).find((item) => item.employeeId === employeeId) || {};
  const cycle = payload.cycle || {};
  const windowInfo = payload.windowInfo || cycle.window || {};
  const monthName = cycle.name || `تقييم شهر ${englishDigits(new Date().toLocaleDateString("ar-EG-u-nu-latn", { month: "long", year: "numeric" }))}`;
  const scoreToPercent = (value, max) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.min(100, n <= max ? Math.round((n / max) * 100) : n));
  };
  const percentValue = (percentKey, scoreKey, max) => mine[percentKey] ?? scoreToPercent(mine[scoreKey], max);
  const totalFromPercents = (row = mine) => [
    [row.targetPercent ?? scoreToPercent(row.targetScore, 40), 40],
    [row.efficiencyPercent ?? scoreToPercent(row.efficiencyScore, 20), 20],
    [row.attendancePercent ?? scoreToPercent(row.attendanceScore, 20), 20],
    [row.quranPercent ?? scoreToPercent(row.quranCircleScore, 5), 5],
    [row.prayerPercent ?? scoreToPercent(row.prayerScore, 5), 5],
    [row.conductPercent ?? scoreToPercent(row.conductScore, 5), 5],
    [row.initiativesPercent ?? scoreToPercent(row.initiativesScore, 5), 5],
  ].reduce((sum, [pct, weight]) => sum + (Number(pct || 0) * weight / 100), 0).toFixed(1);
  const total = totalFromPercents();
  shell(`
    <section class="employee-grid kpi-advanced v108-kpi-page">
      <article class="employee-card full accent-card kpi-hero-card">
        <div class="panel-kicker">KPI شهري — ${escapeHtml(monthName)}</div>
        <h2>تقييمي الذاتي</h2>
        <p>لا يتم فتح التقييم إلا بقرار من السكرتير التنفيذي. عند الفتح ترفع تقييمك مباشرة للمدير المباشر ثم تستكمل مراحل المدير وHR والاعتماد.</p>
        <div class="employee-actions-row kpi-summary-row">
          <span class="login-feature">الحالة: ${badge(mine.status || "DRAFT")}</span>
          <span class="login-feature kpi-total-chip">النسبة الحالية: <b data-kpi-total>${escapeHtml(total)}%</b></span>
          <span class="login-feature">نافذة التقييم: ${escapeHtml(windowInfo.label || (windowInfo.isOpen === false ? "مغلقة" : "متاحة"))}</span>
        </div>
      </article>
      <form class="employee-card full" id="kpi-self-form">
        <div class="kpi-slider-stack">
          ${kpiSlider({ name: "targetPercent", label: "تحقيق الأهداف", weight: 40, value: percentValue("targetPercent", "targetScore", 40) })}
          ${kpiSlider({ name: "efficiencyPercent", label: "الكفاءة في أداء المهام", weight: 20, value: percentValue("efficiencyPercent", "efficiencyScore", 20) })}
          ${kpiSlider({ name: "conductPercent", label: "حسن التعامل والسلوك", weight: 5, value: percentValue("conductPercent", "conductScore", 5) })}
          ${kpiSlider({ name: "initiativesPercent", label: "التبرعات والمبادرات", weight: 5, value: percentValue("initiativesPercent", "initiativesScore", 5) })}
          <div class="employee-card-subtle v108-hr-estimate-note"><strong>بنود HR — تقدير مبدئي فقط</strong><p>يمكنك وضع تقديرك المبدئي، ثم يراجع HR الحضور والصلاة وحلقة الشيخ وليد ويعدّلها رسميًا.</p></div>
          ${kpiSlider({ name: "attendancePercent", label: "الحضور والانصراف", weight: 20, value: percentValue("attendancePercent", "attendanceScore", 20) })}
          ${kpiSlider({ name: "quranPercent", label: "حلقة الشيخ وليد", weight: 5, value: percentValue("quranPercent", "quranCircleScore", 5) })}
          ${kpiSlider({ name: "prayerPercent", label: "الصلاة في المسجد", weight: 5, value: percentValue("prayerPercent", "prayerScore", 5) })}
          <label>ملاحظاتي للمدير<textarea name="employeeNotes" rows="4">${escapeHtml(mine.employeeNotes || "")}</textarea></label>
        </div>
        <input type="hidden" name="employeeId" value="${escapeHtml(employeeId)}" />
        <input type="hidden" name="cycleName" value="${escapeHtml(monthName)}" />
        <input type="hidden" name="status" value="DRAFT" data-kpi-status />
        <div class="employee-actions-row v108-kpi-actions">
          <button class="button primary" type="submit" data-kpi-submit="submit" ${windowInfo.isOpen ? "" : "disabled"}>${windowInfo.isOpen ? "رفع للمدير" : "التقييم مغلق"}</button>
        </div>
        ${windowInfo.message ? `<p class="form-hint">${escapeHtml(windowInfo.message)}</p>` : ""}
      </form>
      ${mine.status ? `<article class="employee-card full compact-status-card"><div class="panel-kicker">حالة النموذج</div><h2>${escapeHtml(statusLabel(mine.status))}</h2><p>تظهر لك النتيجة الحالية كنسبة مئوية، ثم يتم اعتمادها بعد مراجعة المدير وHR.</p></article>` : ""}
    </section>
  `, "تقييمي", "نموذج KPI الشهري الخاص بالموظف.");
  const updateKpiTotal = () => {
    const values = readForm(app.querySelector("#kpi-self-form") || document.createElement("form"));
    const total = [
      [values.targetPercent, 40],
      [values.efficiencyPercent, 20],
      [values.attendancePercent, 20],
      [values.quranPercent, 5],
      [values.prayerPercent, 5],
      [values.conductPercent, 5],
      [values.initiativesPercent, 5],
    ].reduce((sum, [pct, weight]) => sum + (Number(pct || 0) * weight / 100), 0).toFixed(1);
    app.querySelector("[data-kpi-total]")?.replaceChildren(document.createTextNode(`${total}%`));
  };
  app.querySelectorAll('.kpi-slider-field input[type="range"]').forEach((input) => input.addEventListener("input", () => {
    const weight = Number(input.dataset.weight || 0);
    const pct = Number(input.value || 0);
    const meta = input.closest('.kpi-slider-field')?.querySelector('.kpi-slider-meta');
    const bar = input.closest('.kpi-slider-field')?.querySelector('.kpi-progress i');
    if (meta) {
      const percentEl = document.createElement("b");
      const detailEl = document.createElement("small");
      percentEl.textContent = `${pct}%`;
      detailEl.textContent = `الوزن ${weight} — المحتسب ${(pct * weight / 100).toFixed(1)}/${weight}`;
      meta.replaceChildren(percentEl, detailEl);
    }
    if (bar) bar.style.width = `${pct}%`;
    updateKpiTotal();
  }));
  app.querySelector("#kpi-self-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const statusInput = event.currentTarget.querySelector("[data-kpi-status]");
    if (!windowInfo.isOpen) { setMessage("", "التقييم مغلق حاليًا ولا يمكن الرفع إلا بعد فتحه من السكرتير التنفيذي."); return renderKpi(); }
    if (statusInput) statusInput.value = "SELF_SUBMITTED";
    try {
      await endpoints.saveKpiEvaluation(readForm(event.currentTarget));
      setMessage("تم رفع تقييمك للمدير المباشر بنجاح.", "");
      renderKpi();
    } catch (error) { setMessage("", error.message || "تعذر حفظ التقييم."); renderKpi(); }
  });
}

async function renderRequests() {
  const summary = await endpoints.myRequests().then(unwrap).catch(() => ({ pending: 0, approved: 0, rejected: 0, latest: [] }));
  shell(`
    <section class="employee-grid">
      <article class="employee-card"><span class="panel-kicker">قيد المراجعة</span><strong class="big-number">${escapeHtml(summary.pending || 0)}</strong><p>طلبات تنتظر قرار الإدارة أو المدير المباشر.</p></article>
      <article class="employee-card"><span class="panel-kicker">مقبولة</span><strong class="big-number">${escapeHtml(summary.approved || 0)}</strong><p>طلبات تمت الموافقة عليها.</p></article>
      <article class="employee-card"><span class="panel-kicker">مرفوضة</span><strong class="big-number">${escapeHtml(summary.rejected || 0)}</strong><p>طلبات تم رفضها مع متابعة السبب.</p></article>
      <article class="employee-card full"><h2>آخر طلباتي</h2>${renderRequestList(summary.latest || [])}</article>
      <article class="employee-card full"><h2>إنشاء طلب سريع</h2><div class="employee-actions-row"><button class="button primary" data-route="leaves">طلب إجازة</button><button class="button ghost" data-route="missions">طلب مأمورية</button><button class="button ghost" data-route="disputes">شكوى/خلاف</button><button class="button ghost" data-route="location">إرسال موقع</button></div></article>
    </section>
  `, "طلباتي", "كل طلباتك وحالتها في شاشة واحدة.");
}

async function renderTasks() {
  const tasks = await endpoints.myTasks().then(unwrap).catch(() => []);
  shell(`
    <section class="employee-card full">
      <div class="panel-kicker">المهام</div>
      <h2>مهامي الحالية</h2>
      ${tasks.length ? `<div class="employee-list">${tasks.map((task) => `<div class="employee-list-item"><div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.description || "")}</span><small>الأولوية: ${escapeHtml(statusLabel(task.priority))} — الاستحقاق: ${escapeHtml(task.dueDate || "-")}</small></div><div class="list-item-side">${badge(task.status)}${task.status !== "DONE" ? `<button class="button ghost small" data-task-done="${escapeHtml(task.id)}">تم</button>` : ""}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد مهام مكلف بها الآن.</div>`}
    </section>
  `, "مهامي", "تابع التكليفات اليومية وحدّث حالتها.");
  app.querySelectorAll("[data-task-done]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.updateTask(button.dataset.taskDone, { status: "DONE" });
    setMessage("تم تحديث المهمة.", "");
    renderTasks();
  }));
}

async function renderDailyReport() {
  const reports = await endpoints.myDailyReports().then(unwrap).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const todayReport = reports.find((row) => row.reportDate === today) || {};
  shell(
    `<section class="employee-grid">
      <article class="employee-card full accent-card"><h2>التقرير اليومي</h2><p>اكتب ما تم إنجازه اليوم، العوائق التي تحتاج دعمًا، وخطة الغد. يتم إرسال التقرير لمديرك والسكرتير التنفيذي للمتابعة التشغيلية.</p></article>
      <article class="employee-card full">
        <form id="daily-report-form" class="employee-form">
          <label>تاريخ التقرير<input type="date" name="reportDate" value="${escapeHtml(todayReport.reportDate || today)}" required /></label>
          <label>ما تم إنجازه اليوم<textarea name="achievements" rows="4" required>${escapeHtml(todayReport.achievements || "")}</textarea></label>
          <label>العوائق أو المشاكل<textarea name="blockers" rows="3">${escapeHtml(todayReport.blockers || "")}</textarea></label>
          <label>خطة الغد<textarea name="tomorrowPlan" rows="3">${escapeHtml(todayReport.tomorrowPlan || "")}</textarea></label>
          <label>الدعم المطلوب<textarea name="supportNeeded" rows="2">${escapeHtml(todayReport.supportNeeded || "")}</textarea></label>
          <label>الحالة النفسية/ضغط العمل<select name="mood"><option value="NORMAL">طبيعي</option><option value="GOOD">جيد</option><option value="STRESSED">ضغط عالي</option><option value="NEEDS_SUPPORT">أحتاج دعم</option></select></label>
          <button class="button primary" type="submit">إرسال التقرير</button>
        </form>
      </article>
      <article class="employee-card full"><h2>تقاريري السابقة</h2>${reports.length ? `<div class="employee-list">${reports.slice(0, 20).map((report) => `<div class="employee-list-item"><div><strong>${escapeHtml(report.reportDate || "-")}</strong><span>${escapeHtml(report.achievements || "-")}</span><small>${escapeHtml(report.blockers ? `عوائق: ${report.blockers}` : "بدون عوائق")}</small></div><div class="list-item-side">${badge(report.status)}${report.managerComment ? `<small>${escapeHtml(report.managerComment)}</small>` : ""}</div></div>`).join("")}</div>` : `<div class="empty-state">لم ترسل تقارير يومية بعد.</div>`}</article>
    </section>`,
    "التقرير اليومي",
    "متابعة إنجازاتك واحتياجات الدعم.",
  );
  app.querySelector("#daily-report-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await endpoints.createDailyReport(readForm(event.currentTarget));
      setMessage("تم إرسال التقرير اليومي بنجاح.", "");
      renderDailyReport();
    } catch (error) { setMessage("", error.message); renderDailyReport(); }
  });
}

async function renderDocuments() {
  const docs = await endpoints.myDocuments().then(unwrap).catch(() => []);
  shell(`
    <section class="employee-card full">
      <div class="panel-kicker">المستندات</div>
      <h2>مستنداتي</h2>
      <p>راجع مستنداتك المسجلة، وفي حالة وجود مستند منتهي أو ناقص تواصل مع الإدارة.</p>
      ${docs.length ? `<div class="employee-list">${docs.map((doc) => `<div class="employee-list-item"><div><strong>${doc.fileUrl ? `<a href="${escapeHtml(doc.fileUrl)}" target="_blank" rel="noopener">${escapeHtml(doc.title)}</a>` : escapeHtml(doc.title)}</strong><span>${escapeHtml(doc.documentType || "مستند")}</span><small>ينتهي: ${escapeHtml(doc.expiresOn || "-")} — ${escapeHtml(doc.notes || "")}</small></div><div class="list-item-side">${badge(doc.status || "ACTIVE")}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد مستندات مسجلة لك بعد.</div>`}
    </section>
  `, "مستنداتي", "أرشيف الملفات والتنبيهات الخاصة بك.");
}


async function renderPolicies() {
  const data = await endpoints.policies().then(unwrap).catch(() => ({ policies: [], summary: {} }));
  const policies = data.policies || [];
  shell(`
    <section class="employee-grid">
      <article class="employee-card full">
        <div class="panel-kicker">السياسات والتوقيعات</div>
        <h2>سياسات الجمعية</h2>
        <p>اقرأ كل سياسة واضغط تأكيد القراءة. هذا يساعد الإدارة على توثيق الالتزام الداخلي بدون ورق.</p>
      </article>
      ${policies.length ? policies.map((policy) => `
        <article class="employee-card full">
          <div class="panel-kicker">${escapeHtml(policy.category || "GENERAL")} — إصدار ${escapeHtml(policy.version || "1.0")}</div>
          <h2>${escapeHtml(policy.title)}</h2>
          <p>${escapeHtml(policy.body || "")}</p>
          <div class="employee-actions-row">
            ${policy.acknowledged ? `<span class="pill success">تم التأكيد ${escapeHtml(policy.acknowledgedAt ? date(policy.acknowledgedAt) : "")}</span>` : `<button class="button primary" data-ack-policy="${escapeHtml(policy.id)}">أؤكد القراءة والالتزام</button>`}
          </div>
        </article>
      `).join("") : `<article class="employee-card full"><div class="empty-state">لا توجد سياسات مطلوبة الآن.</div></article>`}
    </section>
  `, "السياسات", "قراءة وتوقيع سياسات الجمعية.");
  app.querySelectorAll("[data-ack-policy]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.acknowledgePolicy(button.dataset.ackPolicy);
    setMessage("تم تأكيد قراءة السياسة.", "");
    renderPolicies();
  }));
}

async function renderAdminDecisions() {
  const data = await endpoints.adminDecisions().then(unwrap).catch(() => ({ decisions: [] }));
  const decisions = data.decisions || [];
  shell(`
    <section class="employee-grid">
      <article class="employee-card full">
        <div class="panel-kicker">القرارات الإدارية</div>
        <h2>سجل القرارات الرسمية</h2>
        <p>كل قرار يظهر هنا يحتاج تأكيد "تم الاطلاع" ليتم حفظ توقيت القراءة رسميًا.</p>
      </article>
      ${decisions.length ? decisions.map((decision) => `
        <article class="employee-card full decision-card ${decision.acknowledged ? 'is-acknowledged' : ''}">
          <div class="panel-kicker">${escapeHtml(decision.category || 'ADMINISTRATIVE')} — ${escapeHtml(decision.priority || 'MEDIUM')}</div>
          <h2>${escapeHtml(decision.title)}</h2>
          <p>${escapeHtml(decision.body || '')}</p>
          <small>تاريخ النشر: ${date(decision.publishedAt || decision.createdAt)}</small>
          <div class="employee-actions-row">
            ${decision.acknowledged ? `<span class="pill success">تم الاطلاع ${escapeHtml(decision.acknowledgedAt ? date(decision.acknowledgedAt) : '')}</span>` : `<button class="button primary" data-ack-decision="${escapeHtml(decision.id)}">تم الاطلاع</button>`}
          </div>
        </article>
      `).join('') : `<article class="employee-card full"><div class="empty-state">لا توجد قرارات إدارية مطلوبة الآن.</div></article>`}
    </section>
  `, "القرارات", "تأكيد الاطلاع على القرارات الرسمية.");
  app.querySelectorAll('[data-ack-decision]').forEach((button) => button.addEventListener('click', async () => {
    await endpoints.acknowledgeAdminDecision(button.dataset.ackDecision);
    setMessage('تم تسجيل اطلاعك على القرار.', '');
    renderAdminDecisions();
  }));
}

async function renderNotifications() {
  const rows = await endpoints.notifications().then(unwrap).catch(() => []);
  const employeeId = state.user?.employeeId || state.user?.employee?.id;
  const mine = rows.filter((item) => !item.employeeId || item.employeeId === employeeId || item.userId === state.user?.id).slice(0, 50);
  shell(`
    <section class="employee-card full">
      <div class="panel-kicker">التنبيهات</div>
      <h2>الإشعارات</h2>
      <div class="employee-actions-row compact-actions"><button class="button primary" data-enable-push>تفعيل إشعارات الجهاز</button></div>
      ${mine.length ? `<div class="employee-list">${mine.map((item) => `<div class="employee-list-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body || "")}</span><small>${date(item.createdAt)}</small></div><div class="list-item-side">${badge(item.status || (item.isRead ? "READ" : "UNREAD"))}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد إشعارات.</div>`}
    </section>
  `, "الإشعارات", "كل التنبيهات والطلبات المهمة.");
  app.querySelector("[data-enable-push]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      await enableWebPushSubscription(endpoints);
      document.querySelectorAll('.push-explain-overlay,.attendance-floating-reminder').forEach((el) => el.remove());
      setMessage("تم تفعيل اشتراك Web Push الحقيقي لهذا الجهاز.", "");
      renderNotifications();
    } catch (error) {
      setMessage("", error.message || "تعذر تفعيل الإشعارات.");
      renderNotifications();
    } finally {
      button.disabled = false;
    }
  });
}


function employeeRoleSlug(employee = {}) {
  return String(employee.role?.slug || employee.role?.key || employee.roleId || employee.role || "").toLowerCase();
}

function sortHierarchyChildren(children = [], priorityId = "") {
  return [...children].sort((a, b) => {
    const aSlug = employeeRoleSlug(a);
    const bSlug = employeeRoleSlug(b);
    const aIsExecutiveDirector = aSlug.includes("executive") && !aSlug.includes("secretary");
    const bIsExecutiveDirector = bSlug.includes("executive") && !bSlug.includes("secretary");
    const aScore = aIsExecutiveDirector ? -40 : a.id === priorityId ? -20 : aSlug.includes("executive-secretary") || aSlug.includes("admin") ? -10 : aSlug.includes("manager") ? 0 : 10;
    const bScore = bIsExecutiveDirector ? -40 : b.id === priorityId ? -20 : bSlug.includes("executive-secretary") || bSlug.includes("admin") ? -10 : bSlug.includes("manager") ? 0 : 10;
    return aScore - bScore || String(a.fullName || "").localeCompare(String(b.fullName || ""), "ar");
  });
}

function collectDescendants(employeeId, byManager = new Map()) {
  const direct = byManager.get(employeeId) || [];
  return direct.flatMap((child) => [child, ...collectDescendants(child.id, byManager)]);
}

function renderEmployeeOrgTree(roots = [], byManager = new Map(), options = {}) {
  const currentId = options.currentEmployeeId || "";
  const myManagerId = options.myManagerId || "";
  const myTeamIds = options.myTeamIds || new Set();
  const renderNode = (employee, depth = 0) => {
    const children = sortHierarchyChildren(byManager.get(employee.id) || [], options.secretaryId || "");
    const classes = ["employee-org-node"];
    if (employee.id === currentId) classes.push("is-me");
    if (employee.id === myManagerId) classes.push("is-my-manager");
    if (myTeamIds.has(employee.id)) classes.push("is-direct-report");
    const childMeta = children.length ? `${children.length} مباشر / ${collectDescendants(employee.id, byManager).length} إجمالي` : "بدون تابعين";
    return `<div class="employee-org-tree-item" style="--org-depth:${depth}">
      <article class="${classes.join(" ")}">
        <div class="org-node-head">
          ${avatar(employee, "medium")}
          <div class="org-node-copy">
            <strong>${escapeHtml(employee.fullName || "-")}</strong>
            <span>${escapeHtml(employee.jobTitle || employee.role?.name || "-")}</span>
          </div>
        </div>
        <div class="org-node-meta">
          <span class="org-chip">${escapeHtml(employee.department?.name || employee.branch?.name || employee.role?.name || "الهيكل الوظيفي")}</span>
          <span class="org-chip org-chip-muted">${escapeHtml(childMeta)}</span>
        </div>
      </article>
      ${children.length ? `<div class="employee-org-children">${children.map((child) => renderNode(child, depth + 1)).join("")}</div>` : ""}
    </div>`;
  };
  return `<div class="employee-org-tree">${roots.map((root) => renderNode(root)).join("")}</div>`;
}

function buildEmployeeOrgModel(employees = []) {
  const active = employees.filter((employee) => !employee.isDeleted && String(employee.status || "ACTIVE").toUpperCase() !== "DELETED");
  const byId = new Map(active.map((employee) => [employee.id, employee]));
  const byManager = new Map();
  active.forEach((employee) => {
    const managerId = employee.managerEmployeeId || employee.managerId || employee.directManagerId || employee.manager?.id || "";
    if (!managerId) return;
    if (!byManager.has(managerId)) byManager.set(managerId, []);
    byManager.get(managerId).push(employee);
  });
  const executiveDirector = active.find((employee) => String(employee.fullName || employee.name || "").includes("الشيخ محمد يوسف")) || active.find((employee) => {
    const slug = employeeRoleSlug(employee);
    return slug.includes("executive") && !slug.includes("secretary");
  }) || active.find((employee) => !(employee.managerEmployeeId || employee.managerId || employee.directManagerId || employee.manager?.id || "")) || active[0] || null;
  const secretary = active.find((employee) => {
    const slug = employeeRoleSlug(employee);
    const title = String(employee.jobTitle || employee.role?.name || "");
    return slug.includes("executive-secretary") || title.includes("السكرتير التنفيذي");
  }) || null;
  if (executiveDirector && secretary && secretary.id !== executiveDirector.id) {
    for (const [managerId, list] of byManager.entries()) {
      if (managerId !== executiveDirector.id) byManager.set(managerId, list.filter((employee) => employee.id !== secretary.id));
    }
    const topChildren = byManager.get(executiveDirector.id) || [];
    if (!topChildren.some((employee) => employee.id === secretary.id)) byManager.set(executiveDirector.id, [secretary, ...topChildren]);
  }
  if (executiveDirector && secretary) {
    const assigned = new Set([...byManager.values()].flat().map((employee) => employee.id));
    const secretaryChildren = byManager.get(secretary.id) || [];
    active.forEach((employee) => {
      const hasManager = employee.managerEmployeeId || employee.managerId || employee.directManagerId || employee.manager?.id || "";
      const isTop = employee.id === executiveDirector.id || employee.id === secretary.id;
      if (!hasManager && !isTop && !assigned.has(employee.id) && !secretaryChildren.some((child) => child.id === employee.id)) secretaryChildren.push(employee);
    });
    byManager.set(secretary.id, secretaryChildren);
  }
  const allRoots = active.filter((employee) => !byId.has(employee.managerEmployeeId || employee.managerId || employee.directManagerId || employee.manager?.id || "") && employee.id !== secretary?.id);
  const roots = executiveDirector ? [executiveDirector] : allRoots;
  return { active, byId, byManager, roots: sortHierarchyChildren(roots, secretary?.id || ""), executiveDirector, secretary };
}


async function renderTeam() {
  const [employees, leaves, missions] = await Promise.all([
    endpoints.employees().then(unwrap).catch(() => []),
    endpoints.leaves().then(unwrap).catch(() => []),
    endpoints.missions().then(unwrap).catch(() => []),
  ]);
  const myId = state.user?.employeeId || state.user?.employee?.id;
  const team = employees.filter((e) => e.managerId === myId || e.directManagerId === myId || e.managerEmployeeId === myId);
  const teamIds = new Set(team.map((e) => e.id));
  const pendingLeaves = leaves.filter((x) => teamIds.has(x.employeeId) && /pending/i.test(String(x.workflowStatus || x.status || "")));
  const pendingMissions = missions.filter((x) => teamIds.has(x.employeeId) && /pending/i.test(String(x.workflowStatus || x.status || "")));
  const org = buildEmployeeOrgModel(employees || []);
  const managerLike = (org.byManager.get(myId) || []).length > 0;
  const descendantsCount = collectDescendants(myId, org.byManager).length;
  const managerNode = org.byId.get(myId) || state.user?.employee || null;
  const myManagerId = managerNode?.managerEmployeeId || managerNode?.managerId || managerNode?.directManagerId || managerNode?.manager?.id || "";
  const hierarchyMarkup = renderEmployeeOrgTree(org.roots, org.byManager, { currentEmployeeId: myId, myManagerId, myTeamIds: teamIds, secretaryId: org.secretary?.id || "" });
  shell(`
    <section class="employee-grid team-manager-page">
      <article class="employee-card full employee-org-shell">
        <div class="panel-kicker">الهيكل الوظيفي</div>
        <h2>فريقي والهيكل الوظيفي</h2>
        <p>عرض احترافي متصل يبدأ من المدير التنفيذي ثم السكرتير التنفيذي ثم المديرين ثم الموظفين مع إبراز موقعك وفريقك داخل الشبكة.</p>
        <div class="team-overview-grid">
          <article class="team-summary-card"><span>قمة الهيكل</span><strong>${escapeHtml(org.executiveDirector?.fullName || "المدير التنفيذي")}</strong><small>${escapeHtml(org.executiveDirector?.jobTitle || "القيادة التنفيذية")}</small></article>
          <article class="team-summary-card"><span>السكرتير التنفيذي</span><strong>${escapeHtml(org.secretary?.fullName || "-")}</strong><small>${escapeHtml(org.secretary?.jobTitle || "-")}</small></article>
          <article class="team-summary-card"><span>فريقي المباشر</span><strong>${escapeHtml(team.length)}</strong><small>${managerLike ? "تابعون مباشرون" : "لا يوجد فريق مباشر"}</small></article>
          <article class="team-summary-card"><span>إجمالي تحت مسؤوليتي</span><strong>${escapeHtml(descendantsCount)}</strong><small>مباشر + غير مباشر</small></article>
        </div>
        <div class="employee-org-legend">
          <span class="org-legend-item"><i class="legend-dot executive"></i>القيادة العليا</span>
          <span class="org-legend-item"><i class="legend-dot me"></i>حسابي</span>
          <span class="org-legend-item"><i class="legend-dot team"></i>فريقي المباشر</span>
          <span class="org-legend-item"><i class="legend-dot manager"></i>مديري المباشر</span>
        </div>
        ${hierarchyMarkup}
      </article>
      <article class="employee-card full">
        <div class="panel-kicker">فريقي المباشر</div>
        <h2>موظفو فريقي</h2>
        ${team.length ? `<div class="employee-list my-team-focus-grid">${team.map((e)=>`<div class="employee-list-item"><div>${employeeHeaderCell(e)}</div><div class="list-item-side">${badge(e.status || "ACTIVE")}</div></div>`).join("")}</div>` : `<div class="empty-state">لا توجد بيانات فريق مرتبطة بحسابك حتى الآن.</div>`}
      </article>
      <article class="employee-card full"><h2>طلبات إجازة تنتظر مراجعتي</h2>${pendingLeaves.length ? renderManagerReviewList(pendingLeaves, "leave") : `<div class="empty-state">لا توجد إجازات معلقة للمدير.</div>`}</article>
      <article class="employee-card full"><h2>طلبات مأمورية تنتظر مراجعتي</h2>${pendingMissions.length ? renderManagerReviewList(pendingMissions, "mission") : `<div class="empty-state">لا توجد مأموريات معلقة للمدير.</div>`}</article>
    </section>
  `, "فريقي", "الهيكل الوظيفي الكامل ومراجعات الفريق.");
  app.querySelectorAll("[data-manager-review]").forEach((button)=>button.addEventListener("click", async()=>{
    const [kind, id, action] = button.dataset.managerReview.split(":");
    const note = "";
    try {
      if (kind === "leave") await endpoints.updateLeave(id, action === "approve" ? "manager_approve" : "reject", { managerNote: note });
      if (kind === "mission") await endpoints.updateMission(id, action === "approve" ? "manager_approve" : "reject", { managerNote: note });
      setMessage(action === "approve" ? "تم اعتماد الطلب وتحويله إلى HR." : "تم رفض الطلب.", "");
      renderTeam();
    } catch (error) { setMessage("", error.message || "تعذر حفظ قرار المدير."); renderTeam(); }
  }));
}

function renderManagerReviewList(items = [], kind = "leave") {
  return `<div class="employee-list">${items.map((item)=>`<div class="employee-list-item"><div><strong>${escapeHtml(item.title || item.leaveType || item.destinationName || "طلب")}</strong><span>${escapeHtml(item.startDate || item.plannedStart || item.createdAt || "-")}</span><small>${escapeHtml(item.reason || item.notes || item.destinationName || "")}</small></div><div class="list-item-side"><button class="button primary small" data-manager-review="${kind}:${escapeHtml(item.id)}:approve">اعتماد</button><button class="button danger small" data-manager-review="${kind}:${escapeHtml(item.id)}:reject">رفض</button></div></div>`).join("")}</div>`;
}



async function renderManagerKpi() {
  const data = await endpoints.managerMobileHub().then(unwrap);
  const rows = data.kpiPending || [];
  const cards = rows.map((row) => {
    const employeeName = row.employeeName || row.employee?.fullName || row.employeeId || "-";
    return `<form class="employee-card full manager-kpi-review-card" data-manager-kpi-form="${escapeHtml(row.id)}"><div class="panel-head"><div><div class="panel-kicker">بانتظار مراجعة المدير</div><h2>${escapeHtml(employeeName)}</h2><p>هذا النموذج بدأه الموظف ذاتيًا، ويمكنك تأكيد النسب أو تعديلها ثم تسليمها إلى HR.</p></div>${badge(row.status || "SELF_SUBMITTED")}</div><input type="hidden" name="status" value="MANAGER_APPROVED" /><div class="kpi-mobile-score-grid"><label>الأهداف /40<input name="targetScore" type="number" min="0" max="40" step="0.5" value="${escapeHtml(row.targetScore ?? 0)}" /></label><label>الكفاءة /20<input name="efficiencyScore" type="number" min="0" max="20" step="0.5" value="${escapeHtml(row.efficiencyScore ?? 0)}" /></label><label>السلوك /5<input name="conductScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(row.conductScore ?? 0)}" /></label><label>المبادرات /5<input name="initiativesScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(row.initiativesScore ?? 0)}" /></label></div><label>ملاحظات المدير<textarea name="managerNotes" placeholder="اكتب سبب التعديل أو التأكيد">${escapeHtml(row.managerNotes || "")}</textarea></label><div class="employee-actions-row"><button class="button primary" type="submit">اعتماد وتسليم HR</button><button class="button ghost" type="button" data-route="team">عرض الفريق</button></div></form>`;
  }).join("");
  shell(`<section class="stack manager-kpi-mobile-page"><article class="employee-card accent-card"><h2>KPI فريقي</h2><p>المدير لا يبدأ تقييم الموظف من الصفر. تظهر هنا فقط النماذج التي أرسلها الموظفون ذاتيًا، ثم تعدّل/تؤكد وتسلمها إلى HR.</p><div class="employee-metrics"><div><span>بانتظار مراجعتي</span><strong>${escapeHtml(rows.length)}</strong></div><div><span>أعضاء الفريق</span><strong>${escapeHtml(data.totals?.team || data.team?.length || 0)}</strong></div></div></article>${cards || `<article class="employee-card full"><div class="empty-state">لا توجد نماذج KPI مرسلة من الموظفين بانتظار المدير الآن.</div></article>`}</section>`, 'KPI فريقي', 'مراجعة واعتماد تقييمات فريقك من الموبايل.');
  app.querySelectorAll('[data-manager-kpi-form]').forEach((form) => form.addEventListener('submit', async (event) => { event.preventDefault(); try { await endpoints.updateKpiEvaluation(form.dataset.managerKpiForm, readForm(form)); setMessage('تم اعتماد تقييم الموظف وتسليمه إلى HR.', ''); renderManagerKpi(); } catch (error) { setMessage('', error.message || 'تعذر اعتماد تقييم الفريق.'); } }));
}

async function renderManagerHub() {
  const data = await endpoints.managerMobileHub().then(unwrap);
  shell(`<section class="stack manager-mobile-hub">
    <article class="employee-card accent-card"><h2>إدارة فريقي</h2><p>هذه الإضافات تظهر للمديرين داخل نفس تطبيق الموظف بدون تطبيق منفصل.</p><div class="employee-metrics"><div><span>الفريق</span><strong>${escapeHtml(data.totals?.team || data.team?.length || 0)}</strong></div><div><span>إجازات معلقة</span><strong>${escapeHtml(data.totals?.pendingLeaves || 0)}</strong></div><div><span>مأموريات معلقة</span><strong>${escapeHtml(data.totals?.pendingMissions || 0)}</strong></div><div><span>KPI ينتظر مراجعة</span><strong>${escapeHtml(data.totals?.kpiPending || 0)}</strong></div></div></article>
    <article class="employee-card"><h3>أعضاء الفريق</h3>${employeeMiniTable(['الموظف','الهاتف','الحالة'], (data.team || []).map((employee) => `<tr><td>${escapeHtml(employee.fullName || employee.name || employee.id)}</td><td>${escapeHtml(employee.phone || '-')}</td><td>${escapeHtml(employee.status || employee.isActive ? 'نشط' : '—')}</td></tr>`))}</article>
    <article class="employee-card"><h3>موافقات معلقة</h3>${employeeMiniTable(['النوع','الموظف','الحالة','التاريخ'], [...(data.pendingLeaves || []).map((r) => ({...r, kind: 'إجازة'})), ...(data.pendingMissions || []).map((r) => ({...r, kind: 'مأمورية'}))].map((row) => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.employeeName || row.employee?.fullName || row.employeeId || '-')}</td><td>${escapeHtml(row.status || '-')}</td><td>${date(row.createdAt || row.requestedAt)}</td></tr>`))}</article>
    <article class="employee-card"><div class="panel-head"><div><h3>تقييمات الفريق</h3><p>تظهر فقط النماذج التي رفعها الموظف بنفسه.</p></div><button class="button ghost small" data-route="manager-kpi">فتح مركز KPI</button></div>${employeeMiniTable(['الموظف','الحالة','الشهر'], (data.kpiPending || []).map((row) => `<tr><td>${escapeHtml(row.employeeName || row.employee?.fullName || row.employeeId || '-')}</td><td>${escapeHtml(row.status || '-')}</td><td>${escapeHtml(row.month || row.cycleId || '-')}</td></tr>`))}</article>
  </section>`, 'إدارة فريقي', 'متابعة مباشرة بدون مغادرة تطبيق الموظف.');
}

async function renderCommitteeHub() {
  const data = await endpoints.committeeMobileHub().then(unwrap);
  shell(`<section class="stack committee-mobile-hub">
    <article class="employee-card disputes-hero-card"><h2>لجنة حل المشاكل والخلافات</h2><p>كل مشكلة جديدة تظهر هنا لأعضاء اللجنة مع إشعارات وتنبيهات متابعة.</p><div class="employee-metrics"><div><span>إجمالي الملفات</span><strong>${escapeHtml(data.totals?.total || data.rows?.length || 0)}</strong></div><div><span>عاجل</span><strong>${escapeHtml(data.totals?.urgent || 0)}</strong></div><div><span>مفتوح</span><strong>${escapeHtml(data.totals?.open || 0)}</strong></div></div></article>
    <article class="employee-card"><h3>المشاكل الجديدة والمفتوحة</h3>${employeeMiniTable(['العنوان','الحالة','الأولوية','آخر تحديث'], (data.rows || []).map((row) => `<tr><td>${escapeHtml(row.title || row.subject || row.id || 'مشكلة')}</td><td>${escapeHtml(row.status || '-')}</td><td>${escapeHtml(row.priority || '-')}</td><td>${date(row.updatedAt || row.createdAt)}</td></tr>`))}</article>
    <article class="employee-card"><h3>تنبيهات اللجنة</h3>${employeeMiniTable(['العنوان','المسار','الوقت'], (data.notifications || []).map((note) => `<tr><td>${escapeHtml(note.title || 'تنبيه')}</td><td>${escapeHtml(note.route || '-')}</td><td>${date(note.createdAt)}</td></tr>`))}</article>
  </section>`, 'لجنة الخلافات', 'متابعة وحل المشاكل داخل الموبايل.');
}

async function renderProfile() {
  const user = state.user || {};
  const employee = user.employee || {};
  shell(`
    <section class="employee-grid">
      <article class="employee-card full profile-card">
        <div class="profile-hero">
          <div class="person-cell large">${avatar(user, "large")}<span><strong>${escapeHtml(user.fullName || user.name || employee.fullName || "الموظف")}</strong><small>${escapeHtml(employee.jobTitle || "تطبيق الموظفين")}</small></span></div>
        </div>
        <dl class="profile-list">
          <div><dt>الموبايل</dt><dd>${escapeHtml(employee.phone || user.phone || "-")}</dd></div>
          <div><dt>المسمى الوظيفي</dt><dd>${escapeHtml(employee.jobTitle || "-")}</dd></div>
        </dl>
        <div class="employee-actions-stack"><button class="button danger" data-logout>خروج</button></div>
      </article>
      <form class="employee-card full" id="employee-contact-form">
        <div class="panel-kicker">قائمة التعديلات</div>
        <h2>تعديل الصورة والبريد ورقم الهاتف</h2>
        <p>يمكنك تحديث الصورة ورقم الهاتف والبريد. يتم ضغط الصورة قبل الرفع لتسريع التطبيق، ورقم الهاتف يجب أن يكون رقمًا مصريًا صحيحًا.</p>
        <div class="profile-photo-editor">
          <div data-avatar-preview>${avatar(user, "large")}</div>
          <div class="profile-photo-actions">
            <label class="button ghost">تغيير الصورة<input class="hidden-file" type="file" name="avatarFile" accept="image/*" /></label>
            <small>معاينة فورية وضغط تلقائي قبل الحفظ</small>
          </div>
        </div>
        <div class="employee-form-grid">
          <label class="span-2">البريد الإلكتروني<input type="email" name="email" autocomplete="email" value="${escapeHtml(user.email || employee.email || "")}" required /></label>
          <label class="span-2">رقم الهاتف<input name="phone" inputmode="tel" autocomplete="tel" pattern="01[0125][0-9]{8}" value="${escapeHtml(employee.phone || user.phone || "")}" placeholder="01xxxxxxxxx" required /></label>
          <input type="hidden" name="avatarUrl" value="${escapeHtml(user.avatarUrl || user.photoUrl || employee.photoUrl || "")}" />
        </div>
        <button class="button primary full" type="submit">حفظ التعديلات</button>
      </form>
      <article class="employee-card full device-security-card" id="employee-device-security">
        <div class="panel-kicker">أمان الجهاز</div>
        <h2>تسجيل بصمة الجهاز لهذا الحساب</h2>
        <p>اضغط الزر من نفس الموبايل لتسجيل Passkey/بصمة الجهاز. بعدها سيطلب النظام بصمة الهاتف قبل إرسال الموقع أو تسجيل الحضور/الانصراف.</p>
        <div class="employee-actions-stack">
          <button class="button primary full" type="button" data-register-passkey>تسجيل / تحديث بصمة الجهاز</button>
          <button class="button ghost full" type="button" data-test-gps>اختبار الموقع قبل البصمة</button>
        </div>
        <div id="device-security-result" class="message compact hidden"></div>
      </article>
      <form class="employee-card full password-change-card" id="employee-password-form">
        <div class="panel-kicker">الأمان</div>
        <h2>تغيير كلمة المرور</h2>
        <div class="employee-form-grid">
          <input class="visually-hidden" type="text" name="username" autocomplete="username" value="${escapeHtml(user.email || employee.email || employee.phone || user.phone || "")}" tabindex="-1" aria-hidden="true" />
          <label class="span-2">كلمة المرور الحالية<input type="password" name="currentPassword" autocomplete="current-password" required /></label>
          <label class="span-2">كلمة المرور الجديدة<input type="password" name="newPassword" autocomplete="new-password" minlength="8" placeholder="8 أحرف على الأقل" required /></label>
          <div class="span-2">${passwordStrengthMarkup()}</div>
          <label class="span-2">تأكيد كلمة المرور الجديدة<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></label>
        </div>
        <button class="button primary full" type="submit">حفظ كلمة المرور</button>
      </form>
    </section>
  `, "حسابي", "بياناتي ووسائل الاتصال.");
  bindPasswordStrength(app.querySelector("#employee-password-form"));
  const profileForm = app.querySelector("#employee-contact-form");
  profileForm?.querySelector("[name='avatarFile']")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const preview = profileForm.querySelector("[data-avatar-preview]");
      if (preview && dataUrl) preview.innerHTML = `<img class="person-avatar large" src="${escapeHtml(dataUrl)}" alt="معاينة الصورة" />`;
    } catch (error) {
      setMessage("", error.message || "تعذر معاينة الصورة.");
    }
  });
  app.querySelector("[data-register-passkey]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const box = app.querySelector("#device-security-result");
    try {
      button.disabled = true;
      box?.classList.remove("hidden", "danger-box");
      if (box) box.textContent = "افتح بصمة الهاتف/قفل الشاشة لتسجيل الجهاز...";
      await registerBrowserPasskey();
      if (box) box.textContent = "تم تسجيل بصمة الجهاز وربطها بحسابك. يمكنك الآن إرسال الموقع وتسجيل الحضور/الانصراف.";
      setMessage("تم تسجيل بصمة الجهاز بنجاح.", "");
    } catch (error) {
      box?.classList.remove("hidden");
      box?.classList.add("danger-box");
      if (box) box.textContent = friendlyError(error, "تعذر تسجيل بصمة الجهاز.");
    } finally {
      button.disabled = false;
    }
  });
  app.querySelector("#employee-device-security [data-test-gps]")?.addEventListener("click", async () => {
    const box = app.querySelector("#device-security-result");
    try {
      box?.classList.remove("hidden", "danger-box");
      if (box) box.textContent = "جاري اختبار GPS بدقة عالية...";
      const current = safeLocationDisplayRecord(await getVerifiedBrowserLocation(user.employeeId || employee.id || state.user?.employeeId || ""));
      if (box) box.innerHTML = `${readableLocationBlock(current)}${current.latitude && current.longitude ? `<a class="button ghost small" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(`${current.latitude},${current.longitude}`)}">فتح الخريطة</a>` : ""}`;
    } catch (error) {
      box?.classList.remove("hidden");
      box?.classList.add("danger-box");
      if (box) box.textContent = friendlyError(error, "تعذر اختبار الموقع.");
    }
  });
  app.querySelector("#employee-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const values = readForm(form);
    if (values.newPassword !== values.confirmPassword) { setMessage("", "تأكيد كلمة المرور غير مطابق."); return renderProfile(); }
    try {
      if (submit) submit.disabled = true;
      await endpoints.changePassword(values);
      state.user = { ...(state.user || {}), mustChangePassword: false, temporaryPassword: false };
      setMessage("تم تغيير كلمة المرور بنجاح. استخدم كلمة المرور الجديدة في الدخول القادم.", "");
    } catch (error) {
      setMessage("", error.message || "تعذر تغيير كلمة المرور.");
    } finally {
      if (submit) submit.disabled = false;
    }
    renderProfile();
  });
  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    values.phone = normalizeEgyptPhone(values.phone || "");
    if (!validEgyptPhone(values.phone)) { setMessage("", "اكتب رقم هاتف مصري صحيح يبدأ بـ 01."); return renderProfile(); }
    try {
      const file = event.currentTarget.querySelector("[name='avatarFile']")?.files?.[0];
      if (file) {
        try { values.avatarUrl = await endpoints.uploadAvatar(file); }
        catch { values.avatarUrl = await fileToAvatarDataUrl(file); }
      }
      delete values.avatarFile;
      const updated = unwrap(await endpoints.updateMyContact(values));
      state.user = updated || state.user;
      setMessage("تم حفظ التعديلات. إذا غيرت البريد قد تحتاج تأكيد البريد الجديد قبل استخدامه في تسجيل الدخول.", "");
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ التعديلات.");
    }
    renderProfile();
  });
}

async function render() {
  try {
    consumeFlashMessage();
    if (false && !state.user && !state.recoveryMode && sessionStorage.getItem(EMPLOYEE_TAB_SESSION_KEY) !== "1") {
      await endpoints.logout().catch(() => {});
      sessionStorage.removeItem("hr.core");
      sessionStorage.removeItem("hr.core.exp");
      return renderLogin();
    }
    if (!state.user) state.user = await endpoints.me().then(unwrap).catch(() => null);
    if (!state.user) return renderLogin();
    startNotificationPolling();
    if (state.recoveryMode) return renderRecoveryPassword();
    const key = routeKey();
    renderLoadingSkeleton(routeSubtitles[key] ? (moreEmployeeRoutes.concat(employeeRoutes).find(([route]) => route === key)?.[1] || "تطبيق الموظف") : "تطبيق الموظف", routeSubtitles[key] || "جاري تجهيز البيانات...");
    if (key === "action-center") return renderActionCenter();
    if (key === "kpi") return renderKpi();
    if (key === "punch") return renderPunch();
    if (key === "location") return renderLocation();
    if (key === "leaves") return renderLeaves();
    if (key === "missions") return renderMissions();
    if (key === "requests") return renderRequests();
    if (key === "tasks") return renderTasks();
    if (key === "daily-report") return renderDailyReport();
    if (key === "documents") return renderDocuments();
    if (key === "policies") return renderPolicies();
    if (key === "decisions") return renderAdminDecisions();
    if (key === "disputes") return renderDisputes();
    if (key === "notifications") return renderNotifications();
    if (key === "manager-hub") return renderManagerHub();
    if (key === "manager-kpi") return renderManagerKpi();
    if (key === "committee-hub") return renderCommitteeHub();
    if (key === "team") return renderTeam();
    if (key === "profile") return renderProfile();
    return renderHome();
  } catch (error) {
    debugError(error);
    setMessage("", error.message || "تعذر تحميل الصفحة.");
    shell(`<section class="employee-card"><h2>تعذر تحميل الصفحة</h2><p>${escapeHtml(error.message || "حدث خطأ")}</p></section>`, "خطأ", "راجع الاتصال أو أعد المحاولة.");
  }
}

/* ── v101: Ripple effect handler ── */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.button');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
  const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
  btn.style.setProperty('--x', `${x}%`);
  btn.style.setProperty('--y', `${y}%`);
}, { passive: true });

/* ── v101: Scroll-to-top button ── */
(function initScrollTop() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top';
  btn.textContent = '↑';
  btn.setAttribute('aria-label', 'العودة للأعلى');
  btn.title = 'العودة للأعلى';
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 320);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

/* ── v101: Form field validation helper ── */
function validateField(input, test, msg) {
  const valid = typeof test === 'function' ? test(input.value) : test;
  input.classList.toggle('is-valid',   valid);
  input.classList.toggle('is-invalid', !valid);
  let err = input.parentElement?.querySelector('.field-error');
  if (!err) { err = document.createElement('span'); err.className = 'field-error'; input.after(err); }
  err.textContent = valid ? '' : (msg || '');
  err.classList.toggle('visible', !valid && Boolean(msg));
  return valid;
}
globalThis.HR_validateField = validateField;

/* ── v101: Count-up animation for stat values ── */
function countUp(el, target, duration = 900) {
  const start = performance.now();
  const from = parseInt(el.textContent) || 0;
  const to = parseInt(target) || 0;
  if (from === to) return;
  const step = (ts) => {
    const p = Math.min((ts - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else { el.textContent = to; el.classList.add('counting'); setTimeout(() => el.classList.remove('counting'), 300); }
  };
  requestAnimationFrame(step);
}
globalThis.HR_countUp = countUp;

/* ── v101: Auto count-up on [data-count] elements ── */
const countObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const target = el.dataset.count;
    if (target !== undefined) { countUp(el, target); countObs.unobserve(el); }
  });
}, { threshold: 0.3 });
const reobserveCounters = () => {
  document.querySelectorAll('[data-count]:not([data-counted])').forEach(el => {
    el.dataset.counted = '1';
    countObs.observe(el);
  });
};
const appEl = document.getElementById('app') || document.body;
new MutationObserver(reobserveCounters).observe(appEl, { childList: true, subtree: true });

/* ── v101: Data-label auto-populate for mobile tables ── */
const labelObs = new MutationObserver(() => {
  document.querySelectorAll('table.data-table').forEach(table => {
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.querySelectorAll('td')].forEach((td, i) => {
        if (!td.dataset.label && headers[i]) td.dataset.label = headers[i];
      });
    });
  });
});
labelObs.observe(document.body, { childList: true, subtree: true });


/* ── v103: More Drawer (replaces old sheet) ── */
let _drawerOpen = false;
let _drawerOverlay = null;
let _drawerEl = null;

function initMoreDrawer() {
  /* Remove any existing drawer */
  document.querySelector('.more-drawer-overlay')?.remove();
  document.querySelector('.more-drawer')?.remove();

  const moreRoutes = [
    { section: "الإشعارات والطلبات" },
    ["notifications", "الإشعارات",  "🔔"],
    ["requests",      "طلباتي",     "📋"],
    ["leaves",        "الإجازات",   "🏖"],
    ["missions",      "المأموريات", "🚗"],
    { section: "الفريق والتقييم" },
    ["manager-hub",   "إدارة فريقي","🧭"],
    ["manager-kpi",   "KPI فريقي",  "📊"],
    ["kpi",           "تقييمي",     "⭐"],
    ["committee-hub", "لجنة الخلافات","⚖️"],
    { section: "العمل اليومي" },
    ["tasks",         "مهامي",      "✅"],
    ["daily-report",  "تقريري",     "📝"],
    ["disputes",      "شكوى",       "⚠️"],
    ["location",      "موقعي",      "📍"],
    { section: "المعلومات" },
    ["documents",     "مستنداتي",   "📁"],
    ["policies",      "السياسات",   "📜"],
    ["decisions",     "القرارات",   "📢"],
    ["profile",       "حسابي",      "👤"],
  ];

  /* Build overlay */
  const overlay = document.createElement('div');
  overlay.className = 'more-drawer-overlay';

  /* Build drawer */
  const drawer = document.createElement('div');
  drawer.className = 'more-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'قائمة إضافية');

  const currentRoute = location.hash.replace('#', '') || 'home';
  let sectionsHtml = '';
  let gridHtml = '';

  moreRoutes.forEach(item => {
    if (item.section !== undefined) {
      if (gridHtml) {
        sectionsHtml += `<div class="more-drawer-section-label">${escapeHtml(item.section)}</div><div class="more-drawer-grid">${gridHtml}</div>`;
        gridHtml = '';
      } else {
        sectionsHtml += `<div class="more-drawer-section-label">${escapeHtml(item.section)}</div>`;
      }
    } else {
      const [key, label, icon] = item;
      const active = currentRoute === key ? ' is-active' : '';
      gridHtml += `<button class="more-drawer-item${active}" type="button" data-route="${escapeHtml(key)}" aria-label="${escapeHtml(label)}">
        <span class="di-icon" aria-hidden="true">${icon}</span>
        <span class="di-label">${escapeHtml(label)}</span>
      </button>`;
    }
  });
  if (gridHtml) {
    sectionsHtml += `<div class="more-drawer-grid">${gridHtml}</div>`;
  }

  drawer.innerHTML = `
    <div class="more-drawer-handle" aria-hidden="true"></div>
    <div class="more-drawer-header">
      <span class="more-drawer-title">المزيد</span>
      <button class="more-drawer-close" type="button" aria-label="إغلاق القائمة">✕</button>
    </div>
    <div class="more-drawer-body">${sectionsHtml}</div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  _drawerOverlay = overlay;
  _drawerEl = drawer;

  /* Events */
  overlay.addEventListener('click', closeMoreDrawer);
  drawer.querySelector('.more-drawer-close').addEventListener('click', closeMoreDrawer);
  drawer.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeMoreDrawer();
      location.hash = btn.dataset.route;
    });
  });

  /* Swipe-down to close */
  let startY = 0;
  drawer.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  drawer.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - startY;
    if (dy > 60 && drawer.querySelector('.more-drawer-body').scrollTop === 0) {
      closeMoreDrawer();
    }
  }, { passive: true });
}

function openMoreDrawer() {
  if (!_drawerEl) initMoreDrawer();
  _drawerOpen = true;
  _drawerOverlay?.classList.add('is-open');
  _drawerEl?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  /* Trap focus */
  _drawerEl?.querySelector('.more-drawer-close')?.focus();
}

function closeMoreDrawer() {
  _drawerOpen = false;
  _drawerOverlay?.classList.remove('is-open');
  _drawerEl?.classList.remove('is-open');
  document.body.style.overflow = '';
}

/* Keyboard: Escape closes drawer */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _drawerOpen) closeMoreDrawer();
});

/* Override the old more button to open drawer instead */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route="more"]');
  if (btn) { e.preventDefault(); e.stopPropagation(); openMoreDrawer(); }
}, true);


startIdleTimer();

/* ── v111: Offline Queue Replay ─────────────────────────────────────────────
 * The Service Worker sends SYNC_OFFLINE_QUEUE via Background Sync when the
 * device reconnects.  Without this listener the queued attendance punches and
 * leave requests would be permanently stuck.
 *
 * A plain window 'online' event acts as a direct fallback for browsers that
 * do not implement the Background Sync API (Firefox, Safari < 17.4).
 * ─────────────────────────────────────────────────────────────────────────── */
(function attachOfflineQueueSync() {
  let _syncInFlight = false;

  async function flushOfflineQueue(source) {
    if (_syncInFlight) return;
    _syncInFlight = true;
    try {
      const result = await endpoints.syncOfflineQueue();
      const count = result?.synced ?? result?.data?.synced ?? 0;
      if (count > 0) {
        if (window.HRToast) window.HRToast(`تمت مزامنة ${count} طلب محفوظ بنجاح.`, 'ok');
        render();
      }
    } catch (_err) {
      /* silent — network may still be flaky */
    } finally {
      _syncInFlight = false;
    }
  }

  /* Expose globally so v10-private-deploy-fixes.js can trigger on 'online' */
  window.HR_FLUSH_OFFLINE_QUEUE = flushOfflineQueue;

  /* Service Worker → client message (Background Sync path) */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event?.data?.type === 'SYNC_OFFLINE_QUEUE') {
        flushOfflineQueue('sw-background-sync');
      }
    });
  }

  /* Direct fallback: browser comes back online */
  window.addEventListener('online', () => flushOfflineQueue('online-event'), { passive: true });
})();

render();
