import { endpoints, unwrap } from "./api.js?v=v39-consolidated-stable-110";

const debugEnabled = () => Boolean(globalThis.HR_DEBUG_LOGS || globalThis.HR_SUPABASE_CONFIG?.debug === true);
const debugWarn = (...args) => { if (debugEnabled()) globalThis.console?.warn?.(...args); };
const debugError = (...args) => { if (debugEnabled()) globalThis.console?.error?.(...args); };
const debugInfo = (...args) => { if (debugEnabled()) globalThis.console?.info?.(...args); };
const app = document.querySelector("#app");
const EMPLOYEE_PORTAL = "../employee/index.html#home";
const ADMIN_PORTAL = "../operations-gate/?next=../admin/";
const DEFAULT_LIVE_LOCATION_REASON = "متابعة تنفيذية مباشرة";

const state = {
  route: location.hash.replace("#", "") || "home",
  user: null,
  message: "",
  error: "",
  loginIdentifier: localStorage.getItem("hr.login.lastIdentifier") || "",
  loginPassword: "",
  lastLoginFailed: false,
  dataCache: null,
};

const bundledEmployeePhotos = Object.freeze({});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function date(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("ar-EG");
}

function dateOnly(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString("ar-EG");
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try { return normalizeList(JSON.parse(trimmed)); } catch { return trimmed.split(/[،,\s]+/).map((item) => item.trim()).filter(Boolean); }
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.permissions)) return normalizeList(value.permissions);
    if (Array.isArray(value.scopes)) return normalizeList(value.scopes);
    return Object.entries(value).filter(([, enabled]) => enabled === true || enabled === "true" || enabled === 1 || enabled === "1").map(([scope]) => scope);
  }
  return [];
}

function roleMeta(user = state.user) {
  const role = user?.role;
  if (role && typeof role === "object") {
    return {
      id: role.id || user?.roleId || "",
      key: role.key || role.slug || role.code || "",
      slug: role.slug || role.key || "",
      name: role.name || role.label || user?.roleName || "",
      permissions: normalizeList(role.permissions),
    };
  }
  return {
    id: user?.roleId || "",
    key: user?.roleKey || user?.roleSlug || user?.role || "",
    slug: user?.roleSlug || user?.roleKey || user?.role || "",
    name: user?.roleName || user?.role || user?.employee?.role?.name || "",
    permissions: normalizeList(user?.employee?.role?.permissions),
  };
}

function currentPermissions(user = state.user) {
  return new Set([
    ...normalizeList(user?.permissions),
    ...normalizeList(user?.permissionScopes),
    ...normalizeList(user?.scopes),
    ...normalizeList(user?.profile?.permissions),
    ...roleMeta(user).permissions,
  ]);
}

function roleLabel(user = state.user) {
  const role = roleMeta(user);
  return role.name || role.key || role.slug || "دور تنفيذي";
}

function isExecutivePortalUser(user = state.user) {
  if (!user) return false;
  const role = roleMeta(user);
  const permissions = currentPermissions(user);
  const text = [role.id, role.key, role.slug, role.name, user?.roleId, user?.jobTitle, user?.employee?.jobTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return permissions.has("*")
    || permissions.has("executive:mobile")
    || permissions.has("live-location:request")
    || text.includes("executive")
    || text.includes("تنفيذي")
    || text.includes("المدير التنفيذي")
    || text.includes("سكرتير");
}

function canOpenAdminPortal(user = state.user) {
  const role = roleMeta(user);
  const permissions = currentPermissions(user);
  const keys = [role.id, role.key, role.slug, role.name].filter(Boolean).map((item) => String(item).toLowerCase());
  const adminRole = keys.some((key) => ["role-admin", "admin", "مدير النظام"].includes(key));
  return adminRole || permissions.has("*") || permissions.has("employees:view") || permissions.has("dashboard:view");
}

function normalizeGateIdentifier(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const digits = raw.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d))).replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.startsWith("0020")) return `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length >= 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
}

function gateIdentityForPortal(target = "executive") {
  if (sessionStorage.getItem("hr.opsGatewayUnlockedTarget") !== target) return "";
  return sessionStorage.getItem("hr.ops.gate.identity") || sessionStorage.getItem("hr.ops.gate.email") || "";
}

function sessionMatchesGateIdentity(user = state.user, target = "executive") {
  const gateIdentity = normalizeGateIdentifier(gateIdentityForPortal(target));
  if (!gateIdentity || !user) return true;
  const employee = user.employee || {};
  const tokens = [
    user.email, user.phone, user.mobile, user.identifier, user.fullName, user.name,
    employee.email, employee.phone, employee.mobile, employee.fullName,
  ].map(normalizeGateIdentifier).filter(Boolean);
  return tokens.includes(gateIdentity);
}

async function enforceGateSessionIdentity(target = "executive") {
  const gateIdentity = gateIdentityForPortal(target);
  if (!gateIdentity || !state.user || sessionMatchesGateIdentity(state.user, target)) return false;
  await endpoints.logout().catch(() => null);
  state.user = null;
  state.dataCache = null;
  state.loginIdentifier = gateIdentity;
  state.loginPassword = "";
  state.lastLoginFailed = false;
  setMessage("", "تم تسجيل خروج الجلسة السابقة لأنها لا تطابق الرقم الذي فتح البوابة. سجل الدخول بالرقم المطلوب.");
  renderLogin();
  return true;
}

function statusLabel(value) {
  return {
    ACTIVE: "نشط",
    INACTIVE: "غير مفعل",
    PRESENT: "حاضر",
    CHECKED_OUT: "انصرف",
    LATE: "متأخر",
    ABSENT: "غائب",
    ON_LEAVE: "إجازة",
    LEAVE: "إجازة",
    ON_MISSION: "مأمورية",
    MISSION: "مأمورية",
    CHECK_IN: "حضور",
    CHECK_OUT: "انصراف",
    PENDING: "قيد المراجعة",
    OPEN: "مفتوحة",
    CLOSED: "مغلقة",
    RESOLVED: "تم الحل",
    ESCALATED: "مرفوعة للتنفيذي",
    IN_REVIEW: "قيد اللجنة",
    APPROVED: "معتمد",
    REJECTED: "مرفوض",
    POSTPONED: "مؤجل 5 دقائق",
    EXPIRED: "منتهي",
    SUPERSEDED: "أغلق بطلب أحدث",
    LIVE_SHARED: "موقع مباشر مرسل",
    ACTION_REQUIRED: "إجراء مطلوب",
    SELF_SUBMITTED: "مرسل من الموظف",
    MANAGER_APPROVED: "اعتماد المدير",
    HR_REVIEWED: "مراجعة HR",
    SECRETARY_REVIEWED: "مراجعة السكرتير",
    EXECUTIVE_APPROVED: "اعتماد المدير التنفيذي",
    inside_branch: "داخل النطاق",
    outside_branch: "خارج النطاق",
    inside_mission: "داخل مأمورية",
    location_unavailable: "الموقع غير متاح",
  }[value] || value || "-";
}

function badge(value) {
  return `<span class="status ${escapeHtml(value || "unknown")}">${escapeHtml(statusLabel(value))}</span>`;
}

function mapUrl(latitude, longitude) {
  if (!latitude || !longitude) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function liveResponseForRequest(detail = {}, request = {}) {
  return (detail.liveResponses || []).find((row) => row.requestId === request.id || row.request_id === request.id) || null;
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "?";
}

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

function avatar(person = {}, size = "") {
  const src = resolveAvatarUrl(person?.photoUrl || person?.avatarUrl || person?.employee?.photoUrl || person?.employee?.avatarUrl || bundledEmployeePhoto(person));
  const label = initials(person?.fullName || person?.name || person?.employee?.fullName || person?.employee?.name);
  if (src) return `<img class="avatar ${size}" src="${escapeHtml(src)}" alt="${escapeHtml(person.fullName || person.name || person?.employee?.fullName || "")}" loading="lazy" decoding="async" fetchpriority="low" />`;
  return `<span class="avatar fallback ${size}">${escapeHtml(label)}</span>`;
}

function userAvatarSubject(user = state.user) {
  const employee = user?.employee || {};
  return {
    ...employee,
    fullName: employee.fullName || user?.fullName || user?.name || user?.email || "مستخدم",
    name: employee.fullName || user?.name || user?.fullName || user?.email || "مستخدم",
    photoUrl: user?.avatarUrl || user?.photoUrl || employee.photoUrl || employee.avatarUrl || "",
    avatarUrl: user?.avatarUrl || user?.photoUrl || employee.photoUrl || employee.avatarUrl || "",
  };
}

function setMessage(message = "", error = "") {
  state.message = message;
  state.error = error;
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

function askText({ title = "طلب بيانات", message = "اكتب التفاصيل", defaultValue = "", confirmLabel = "إرسال", cancelLabel = "إلغاء" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <form class="confirm-modal prompt-modal">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></div>
        <label class="span-2">السبب<textarea name="answer" rows="3">${escapeHtml(defaultValue)}</textarea></label>
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

function readForm(form) {
  return Object.fromEntries(new FormData(form));
}

function table(headers, rows, className = "") {
  return `
    <div class="table-wrap ${className}">
      <table>
        <thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="empty">لا توجد بيانات مطابقة</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function routeKey() {
  return state.route.split("?")[0];
}

function routeParams() {
  return new URLSearchParams(state.route.split("?")[1] || "");
}

function setRoute(key, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(name, String(value));
  });
  location.hash = query.toString() ? `${key}?${query}` : key;
}

function todayText() {
  return new Date().toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function metric(label, value, helper = "") {
  const num = parseFloat(String(value ?? 0).replace(/[^0-9.]/g, ''));
  const dc  = (!isNaN(num) && num >= 0) ? ` data-count="${num}"` : '';
  return `<article class="metric exec-metric"><span>${escapeHtml(label)}</span><strong${dc}>${escapeHtml(value ?? 0)}</strong><small>${escapeHtml(helper)}</small></article>`;
}

function employeeStatus(employee) {
  return employee?.today?.status || "ABSENT";
}

function employeeRisk(employee) {
  const status = employeeStatus(employee);
  if (employee.today?.pendingLiveRequest) return { level: "PENDING", label: "موقع معلق", text: "بانتظار رد الموظف" };
  if (status === "ABSENT") return { level: "HIGH", label: "يحتاج متابعة", text: "غائب اليوم" };
  if (status === "LATE") return { level: "MEDIUM", label: "متأخر", text: "سجل حضور متأخر" };
  if (status === "PRESENT") return { level: "LOW", label: "مستقر", text: "حاضر الآن" };
  return { level: "LOW", label: "متابعة عادية", text: statusLabel(status) };
}

function summaryCounts(data = {}) {
  const counts = data.counts || {};
  return {
    total: counts.total || 0,
    present: counts.present || 0,
    late: counts.late || 0,
    absent: counts.absent || 0,
    onLeave: counts.onLeave || 0,
    onMission: counts.onMission || 0,
    pendingLiveLocations: counts.pendingLiveLocations || 0,
    checkedOut: counts.checkedOut || 0,
  };
}

async function loadExecutiveData(force = false) {
  if (!force && state.dataCache) return state.dataCache;
  state.dataCache = unwrap(await endpoints.executiveMobile());
  return state.dataCache;
}

function shell(content, title = "المتابعة التنفيذية", description = "") {
  const active = routeKey();
  const user = state.user || {};
  app.innerHTML = `
    <div class="executive-shell">
      <header class="executive-topbar">
        <div class="executive-brand">
          <img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" />
          <div><strong>المتابعة التنفيذية</strong><span>Control View — أحلى شباب</span></div>
        </div>
        <nav class="executive-tabs" aria-label="قائمة المدير التنفيذي">
          <button class="${active === "home" ? "is-active" : ""}" data-route="home">الرئيسية</button>
          <button class="${active === "employees" ? "is-active" : ""}" data-route="employees">الموظفون</button>
          <button class="${active === "presence" ? "is-active" : ""}" data-route="presence">خريطة الحضور</button>
          <button class="${active === "risk" ? "is-active" : ""}" data-route="risk">مخاطر البصمة</button>
          <button class="${active === "actions" ? "is-active" : ""}" data-route="actions">مطلوب قرار</button>
          <button class="${active === "decisions" ? "is-active" : ""}" data-route="decisions">قرارات</button>
          <button class="${active === "disputes" ? "is-active" : ""}" data-route="disputes">لجنة الخلافات</button>
        </nav>
        <div class="executive-user">
          <span class="user-chip">${avatar(userAvatarSubject(), "tiny")}<span>${escapeHtml(user.name || user.fullName || "مستخدم")}</span></span>
          <button class="button ghost" data-action="employee-portal">تطبيق الموظف</button>
          ${canOpenAdminPortal() ? `<button class="button ghost" data-action="admin-portal">لوحة الأدمن</button>` : ""}
          <button class="button danger" data-action="logout">خروج</button>
        </div>
      </header>
      <main class="executive-main">
        <section class="executive-page-head">
          <div><p class="panel-kicker">${escapeHtml(todayText())}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>
          <div class="role-chip">${escapeHtml(roleLabel())}</div>
        </section>
        ${state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ""}
        ${state.error ? `<div class="message error">${escapeHtml(state.error)}</div>` : ""}
        ${content}
      </main>
    </div>
  `;
  app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.route)));
  app.querySelector('[data-action="employee-portal"]')?.addEventListener("click", () => { window.location.href = EMPLOYEE_PORTAL; });
  app.querySelector('[data-action="admin-portal"]')?.addEventListener("click", () => { window.location.href = ADMIN_PORTAL; });
  app.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
    const ok = await confirmAction({ title: "تسجيل الخروج", message: "هل تريد الخروج من المتابعة التنفيذية؟", confirmLabel: "خروج", danger: true });
    if (!ok) return;
    await endpoints.logout();
    state.user = null;
    state.dataCache = null;
    renderLogin();
  });
}

function renderLogin() {
  const identifierValue = state.loginIdentifier || gateIdentityForPortal("executive") || "";
  const passwordValue = state.loginPassword || "";
  app.innerHTML = `
    <div class="login-screen executive-login-screen">
      <form class="login-panel executive-login-panel" id="login-form" novalidate>
        <div class="login-logo-mark"><img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" /></div>
        <h1>بوابة المدير التنفيذي</h1>
        ${state.error ? `<div class="message error">${escapeHtml(state.error)}</div>` : ""}
        ${state.lastLoginFailed ? `<div class="message warning compact">تحقق من البريد/الهاتف وكلمة المرور. لن يتم مسح البيانات المكتوبة.</div>` : ""}
        <label>البريد أو رقم الهاتف أو الاسم<input name="identifier" value="${escapeHtml(identifierValue)}" autocomplete="username" required /></label>
        <label>كلمة المرور
          <span class="login-password-field">
            <input name="password" type="password" value="${escapeHtml(passwordValue)}" autocomplete="current-password" required />
            <button class="password-toggle" type="button" data-toggle-password aria-pressed="false">إظهار</button>
          </span>
        </label>
        <button class="button primary full" type="submit">فتح المتابعة التنفيذية</button>
      </form>
    </div>
  `;
  const form = app.querySelector("#login-form");
  const passwordInput = form.querySelector('input[name="password"]');
  const togglePassword = form.querySelector("[data-toggle-password]");
  togglePassword?.addEventListener("click", () => {
    const isHidden = passwordInput?.type === "password";
    if (passwordInput) passwordInput.type = isHidden ? "text" : "password";
    togglePassword.textContent = isHidden ? "إخفاء" : "إظهار";
    togglePassword.setAttribute("aria-pressed", String(isHidden));
  });
  form.addEventListener("input", () => {
    const values = readForm(form);
    state.loginIdentifier = values.identifier || "";
    state.loginPassword = values.password || "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    state.loginIdentifier = values.identifier || "";
    state.loginPassword = values.password || "";
    if (state.loginIdentifier) localStorage.setItem("hr.login.lastIdentifier", state.loginIdentifier);
    try {
      state.user = unwrap(await endpoints.login(values.identifier, values.password));
      await endpoints.adminAccessLog?.({ action: "executive.login.success", result: "SUCCESS", route: location.hash || "executive" }).catch(() => null);
      state.loginPassword = "";
      state.lastLoginFailed = false;
      if (!isExecutivePortalUser(state.user)) {
        window.location.href = EMPLOYEE_PORTAL;
        return;
      }
      setMessage("تم تسجيل الدخول إلى المتابعة التنفيذية.", "");
      render();
    } catch (error) {
      await endpoints.adminAccessLog?.({ action: "executive.login.failed", result: "FAILED", metadata: { identifier: state.loginIdentifier } }).catch(() => null);
      state.lastLoginFailed = true;
      setMessage("", error.message || "تعذر تسجيل الدخول.");
      renderLogin();
    }
  });
}

async function renderHome() {
  const data = await loadExecutiveData();
  const counts = summaryCounts(data);
  const employees = data.employees || [];
  const needsAttention = employees.filter((employee) => ["ABSENT", "LATE"].includes(employeeStatus(employee)) || employee.today?.pendingLiveRequest).slice(0, 8);
  const activeNow = employees.filter((employee) => ["PRESENT", "LATE"].includes(employeeStatus(employee))).slice(0, 8);
  const readiness = counts.total ? Math.round(((counts.present + counts.checkedOut + counts.onLeave + counts.onMission) / counts.total) * 100) : 0;
  shell(`
    <section class="executive-hero panel">
      <div>
        <p class="panel-kicker">Executive Control View</p>
        <h2>نظرة واحدة تكفي لاتخاذ قرار اليوم</h2>
        <p>تم فصل هذه الواجهة عن الأدمن: لا توجد إعدادات تقنية، لا تحديثات Database، ولا إدارة صلاحيات. فقط متابعة وقرارات.</p>
      </div>
      <div class="score-ring"><strong>${escapeHtml(readiness)}%</strong><span>جاهزية اليوم</span></div>
    </section>
    <section class="metric-grid executive-metric-grid">
      ${metric("إجمالي الموظفين", counts.total, "كل الملفات النشطة")}
      ${metric("حاضر الآن", counts.present, "داخل المتابعة اليومية")}
      ${metric("متأخر", counts.late, "يحتاج متابعة")}
      ${metric("غائب", counts.absent, "أولوية تواصل")}
      ${metric("إجازات", counts.onLeave, "موافق عليها")}
      ${metric("مواقع معلقة", counts.pendingLiveLocations, "بانتظار الرد")}
    </section>
    <section class="grid executive-focus-grid">
      <article class="panel span-7">
        <div class="panel-head"><div><h2>مطلوب متابعة الآن</h2><p>أشخاص يحتاجون قرار أو اتصال سريع.</p></div><button class="button ghost" data-route="actions">عرض الكل</button></div>
        <div class="employee-card-grid compact-cards">
          ${needsAttention.map((employee) => employeeCard(employee)).join("") || `<div class="empty">لا توجد عناصر عاجلة حاليًا.</div>`}
        </div>
      </article>
      <article class="panel span-5">
        <div class="panel-head"><div><h2>حاضرون الآن</h2><p>أول عينة من الموظفين المسجلين اليوم.</p></div><button class="button ghost" data-route="employees">الموظفون</button></div>
        ${table(["الموظف", "الحالة", "آخر حركة"], activeNow.map((employee) => `<tr><td class="person-cell">${avatar(employee, "tiny")}<span>${escapeHtml(employee.fullName || "-")}</span></td><td>${badge(employeeStatus(employee))}</td><td>${escapeHtml(date(employee.today?.checkInAt || employee.today?.checkOutAt || employee.today?.latestLocation?.date))}</td></tr>`))}
      </article>
    </section>
  `, "الرئيسية التنفيذية", "مختصر متابعة يومي مناسب للموبايل وللقرارات السريعة.");
  bindEmployeeCardActions();
}

function employeeCard(employee) {
  const risk = employeeRisk(employee);
  const status = employeeStatus(employee);
  return `
    <article class="mini-card executive-employee-card risk-${escapeHtml(risk.level)}">
      <button class="avatar-button" data-view-employee="${escapeHtml(employee.id)}">${avatar(employee, "large")}</button>
      <div class="employee-card-main">
        <strong>${escapeHtml(employee.fullName || "-")}</strong>
        <small>${escapeHtml(employee.jobTitle || "")}${employee.manager?.fullName ? ` — ${escapeHtml(employee.manager.fullName)}` : ""}</small>
        <span class="risk-line">${escapeHtml(risk.label)}: ${escapeHtml(risk.text)}</span>
      </div>
      <div class="mini-card-actions">
        ${badge(status)}
        <button class="button ghost" data-view-employee="${escapeHtml(employee.id)}">تفاصيل</button>
        <button class="button primary" data-request-live="${escapeHtml(employee.id)}">طلب الموقع</button>
      </div>
    </article>
  `;
}

async function renderEmployees() {
  const params = routeParams();
  const data = await loadExecutiveData();
  const q = String(params.get("q") || "").trim().toLowerCase();
  const status = String(params.get("status") || "").trim();
  const employees = (data.employees || []).filter((employee) => {
    const text = [employee.fullName, employee.phone, employee.email, employee.jobTitle, employee.manager?.fullName].join(" ").toLowerCase();
    return (!q || text.includes(q)) && (!status || employeeStatus(employee) === status);
  });
  shell(`
    <section class="panel">
      <div class="panel-head"><div><h2>الموظفون للمتابعة التنفيذية</h2><p>عرض مختصر بدون أدوات تعديل أو حذف أو صلاحيات تقنية.</p></div><button class="button ghost" data-refresh-executive>تحديث البيانات</button></div>
      <form class="filters executive-filters" id="executive-filters">
        <input name="q" placeholder="بحث بالاسم أو الهاتف أو المسمى" value="${escapeHtml(q)}" />
        <select name="status">
          <option value="">كل الحالات</option>
          ${[["PRESENT", "حاضر"], ["LATE", "متأخر"], ["ABSENT", "غائب"], ["ON_LEAVE", "إجازة"], ["ON_MISSION", "مأمورية"], ["CHECKED_OUT", "انصرف"]].map(([value, label]) => `<option value="${escapeHtml(value)}" ${status === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
        <button class="button ghost" type="submit">تطبيق</button>
      </form>
    </section>
    <section class="employee-card-grid executive-list-grid">
      ${employees.map((employee) => employeeCard(employee)).join("") || `<div class="empty panel">لا توجد نتائج مطابقة.</div>`}
    </section>
  `, "قائمة الموظفين", "متابعة تنفيذية مختصرة لكل موظف وحالة اليوم.");
  app.querySelector("#executive-filters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    setRoute("employees", values);
  });
  app.querySelector("[data-refresh-executive]")?.addEventListener("click", async () => { state.dataCache = null; await renderEmployees(); });
  bindEmployeeCardActions();
}

async function renderActions() {
  const data = await loadExecutiveData();
  const employees = data.employees || [];
  const pendingLocation = employees.filter((employee) => employee.today?.pendingLiveRequest);
  const absent = employees.filter((employee) => employeeStatus(employee) === "ABSENT");
  const late = employees.filter((employee) => employeeStatus(employee) === "LATE");
  shell(`
    <section class="grid executive-focus-grid">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>مطلوب قرار أو متابعة</h2><p>هذه الشاشة تجمع الحالات التي تحتاج تدخلًا سريعًا بدون دخول لوحة الأدمن.</p></div><button class="button ghost" data-route="employees">كل الموظفين</button></div>
      </article>
      <article class="panel span-4"><h3>مواقع معلقة</h3>${table(["الموظف", "إجراء"], pendingLocation.map((employee) => `<tr><td class="person-cell">${avatar(employee, "tiny")}<span>${escapeHtml(employee.fullName || "-")}</span></td><td><button class="button small ghost" data-view-employee="${escapeHtml(employee.id)}">فتح</button></td></tr>`))}</article>
      <article class="panel span-4"><h3>غياب اليوم</h3>${table(["الموظف", "إجراء"], absent.slice(0, 40).map((employee) => `<tr><td class="person-cell">${avatar(employee, "tiny")}<span>${escapeHtml(employee.fullName || "-")}</span></td><td><button class="button small primary" data-request-live="${escapeHtml(employee.id)}">طلب موقع</button></td></tr>`))}</article>
      <article class="panel span-4"><h3>تأخير اليوم</h3>${table(["الموظف", "آخر حركة"], late.slice(0, 40).map((employee) => `<tr><td class="person-cell">${avatar(employee, "tiny")}<span>${escapeHtml(employee.fullName || "-")}</span></td><td>${escapeHtml(date(employee.today?.checkInAt))}</td></tr>`))}</article>
    </section>
  `, "مطلوب قرار", "حالات الغياب والتأخير وطلبات الموقع المعلقة.");
  bindEmployeeCardActions();
}


async function renderPresenceMap() {
  const data = await endpoints.executivePresenceDashboard().then(unwrap);
  const rows = data.rows || [];
  const located = rows.filter((row) => row.lastLocation?.latitude && row.lastLocation?.longitude);
  const missing = rows.filter((row) => !row.lastLocation?.latitude && ["PRESENT", "LATE", "CHECKED_OUT"].includes(row.status));
  shell(`
    <section class="grid executive-focus-grid presence-live-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>خريطة حضور لحظية</h2><p>الحضور، التأخير، خارج النطاق، والموظفون الذين لم يرسلوا الموقع.</p></div><button class="button ghost" data-refresh-presence>تحديث</button></div>
        <div class="metric-grid">${metric('حاضر', data.counts?.PRESENT || 0, 'موجود')}${metric('متأخر', data.counts?.LATE || 0, 'متابعة')}${metric('غائب', data.counts?.ABSENT || 0, 'لم يسجل')}${metric('لم يرسل موقع', missing.length, 'حاضر بلا GPS')}${metric('خارج النطاق', data.counts?.outOfRange || 0, 'تحقق')}</div>
      </article>
      <article class="panel span-12"><h3>الخريطة المباشرة</h3><div class="live-map-board">${located.map((row, index) => `<a class="map-pin risk-${escapeHtml(row.risk?.level || 'CLEAR')}" style="--x:${12 + (index * 19) % 74}%;--y:${16 + (index * 29) % 66}%" target="_blank" rel="noopener" href="${escapeHtml(row.mapUrl)}"><strong>${escapeHtml(row.employee?.fullName || row.employeeId)}</strong><span>${escapeHtml(statusLabel(row.status))} · ${escapeHtml(row.risk?.score || 0)}%</span></a>`).join('') || '<div class="empty">لا توجد مواقع متاحة حتى الآن.</div>'}</div></article>
      <article class="panel span-12"><h3>القائمة التفصيلية</h3>${table(['الموظف','الحالة','الموقع','الخطر'], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td>${badge(row.status)}</td><td>${row.mapUrl ? `<a target="_blank" rel="noopener" href="${escapeHtml(row.mapUrl)}">فتح الخريطة</a>` : 'لم يرسل الموقع'}</td><td>${badge(row.risk?.level || 'CLEAR')} ${escapeHtml(row.risk?.score || 0)}%</td></tr>`))}</article>
    </section>
  `, "خريطة الحضور اللحظية", "متابعة تنفيذية مباشرة على الموبايل.");
  app.querySelector('[data-refresh-presence]')?.addEventListener('click', () => renderPresenceMap());
}

async function renderRiskCenter() {
  const data = await endpoints.attendanceRiskCenter({ days: 7 }).then(unwrap);
  const rows = data.rows || [];
  shell(`
    <section class="grid executive-focus-grid attendance-risk-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>نظام تقييم خطر البصمة</h2><p>يكشف التكرار السريع، الجهاز الجديد، الموقع غير الطبيعي، والحضور من مسافة بعيدة.</p></div><button class="button ghost" data-refresh-risk>إعادة فحص</button></div>
        <div class="metric-grid">${metric('عالي', data.counts?.HIGH || 0, 'تحقيق')}${metric('متوسط', data.counts?.MEDIUM || 0, 'مراجعة')}${metric('منخفض', data.counts?.LOW || 0, 'متابعة')}${metric('سليم', data.counts?.CLEAR || 0, 'مستقر')}</div>
      </article>
      <article class="panel span-12">${table(['الموظف','الدرجة','الأسباب','آخر أحداث'], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td>${badge(row.level)} <strong>${escapeHtml(row.score)}%</strong></td><td>${(row.flags || []).map((flag) => `<span class="chip danger-soft">${escapeHtml(flag.label)}</span>`).join('') || '-'}</td><td>${(row.events || []).slice(0,2).map((event) => `${escapeHtml(statusLabel(event.type || event.action || event.status))} ${date(event.eventAt || event.createdAt)}`).join('<br>')}</td></tr>`))}</article>
    </section>
  `, "مخاطر البصمة", "تحليل فوري لمؤشرات التلاعب.");
  app.querySelector('[data-refresh-risk]')?.addEventListener('click', () => renderRiskCenter());
}

async function renderAdminDecisions() {
  const data = await endpoints.adminDecisions().then(unwrap);
  const rows = data.decisions || [];
  shell(`
    <section class="grid executive-focus-grid admin-decisions-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>سجل القرارات الإدارية</h2><p>قرارات رسمية تحتاج تم الاطلاع وتوقيت قراءة من كل موظف.</p></div><button class="button primary" data-new-decision>قرار جديد</button></div></article>
      <article class="panel span-12">${table(['القرار','الأولوية','النشر','الاطلاع','النص'], rows.map((row) => `<tr><td><strong>${escapeHtml(row.title)}</strong></td><td>${badge(row.priority)}</td><td>${date(row.publishedAt || row.createdAt)}</td><td>${escapeHtml((row.acknowledgements || []).length || (row.acknowledged ? 1 : 0))}</td><td>${escapeHtml(row.body || '')}</td></tr>`))}</article>
    </section>
  `, "القرارات الإدارية", "إصدار ومتابعة القرارات الرسمية.");
  app.querySelector('[data-new-decision]')?.addEventListener('click', async () => {
    const title = await askText({ title: 'قرار إداري جديد', message: 'اكتب عنوان القرار.', defaultValue: 'قرار إداري', confirmLabel: 'التالي' });
    if (title === null) return;
    const body = await askText({ title: 'نص القرار', message: 'اكتب نص القرار الذي سيصل للموظفين.', defaultValue: '', confirmLabel: 'نشر' });
    if (body === null) return;
    await endpoints.createAdminDecision({ title, body, priority: 'HIGH', scope: 'ALL' });
    setMessage('تم نشر القرار وإرسال إشعار للموظفين.', '');
    renderAdminDecisions();
  });
}

async function renderExecutiveDisputes() {
  const payload = await endpoints.disputes().then(unwrap).catch(() => ({ cases: [] }));
  const cases = Array.isArray(payload) ? payload : (payload.cases || []);
  const committee = payload.committee || {};
  const openCases = cases.filter((item) => !["CLOSED", "RESOLVED"].includes(String(item.status || "")));
  shell(`
    <section class="grid executive-focus-grid">
      <article class="panel span-12 accent-panel">
        <div class="panel-head">
          <div>
            <h2>لجنة حل المشاكل والخلافات</h2>
            <p>متابعة تنفيذية مباشرة لكل الشكاوى والخلافات الداخلية، مع حفظ القرار والتصعيد عند الحاجة.</p>
          </div>
          <span class="role-chip">${escapeHtml(openCases.length)} حالة مفتوحة</span>
        </div>
        <div class="message compact"><strong>أعضاء اللجنة:</strong> ${escapeHtml((committee.members || ["المدير التنفيذي", "السكرتير التنفيذي", "HR", "مديرو التشغيل"]).join("، "))}</div>
      </article>
      <article class="panel span-12">
        ${table(["الموظف", "العنوان", "الحالة", "الأولوية", "تاريخ", "قرار"], cases.map((item) => `
          <tr>
            <td class="person-cell">${avatar(item.employee || {}, "tiny")}<span>${escapeHtml(item.employee?.fullName || item.employeeName || item.employeeId || "-")}</span></td>
            <td><strong>${escapeHtml(item.title || "شكوى / خلاف")}</strong><br><small>${escapeHtml(item.description || "")}</small></td>
            <td>${badge(item.status || "IN_REVIEW")}</td>
            <td>${badge(item.priority || "MEDIUM")}</td>
            <td>${escapeHtml(date(item.createdAt))}</td>
            <td>
              <button class="button small ghost" data-dispute-minute="${escapeHtml(item.id)}">محضر لجنة</button>
              <button class="button small ghost" data-dispute-decision="${escapeHtml(item.id)}">تسجيل قرار</button>
              <button class="button small primary" data-dispute-escalate="${escapeHtml(item.id)}">تصعيد</button>
            </td>
          </tr>
        `))}
      </article>
    </section>
  `, "لجنة حل المشاكل والخلافات", "إدارة تنفيذية للشكاوى والتصعيد.");
  app.querySelectorAll("[data-dispute-minute]").forEach((button) => button.addEventListener("click", async () => {
    const decision = await askText({ title: "محضر لجنة حل الخلافات", message: "اكتب القرار الرسمي المعتمد في المحضر.", defaultValue: "تمت المراجعة واعتماد القرار.", confirmLabel: "حفظ المحضر" });
    if (decision === null) return;
    const notes = await askText({ title: "ملاحظات المحضر", message: "اكتب الملاحظات أو أسماء الحضور أو المرفقات الورقية.", defaultValue: "الحضور: المدير التنفيذي، السكرتير التنفيذي، HR، المدير المباشر.", confirmLabel: "توقيع وحفظ" });
    if (notes === null) return;
    try {
      await endpoints.saveDisputeMinute({ caseId: button.dataset.disputeMinute, decision, notes, status: "COMMITTEE_REVIEW" });
      setMessage("تم حفظ محضر اللجنة وتوقيعه إلكترونيًا.", "");
      renderExecutiveDisputes();
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ محضر اللجنة.");
      renderExecutiveDisputes();
    }
  }));
  app.querySelectorAll("[data-dispute-decision]").forEach((button) => button.addEventListener("click", async () => {
    const decision = await askText({ title: "تسجيل قرار اللجنة", message: "اكتب قرار اللجنة أو الإجراء المتخذ.", defaultValue: "تمت المراجعة وجاري التنفيذ.", confirmLabel: "حفظ القرار" });
    if (decision === null) return;
    try {
      await endpoints.updateDispute(button.dataset.disputeDecision, { status: "RESOLVED", committeeDecision: decision, resolution: decision });
      setMessage("تم حفظ قرار لجنة حل المشاكل والخلافات.", "");
      renderExecutiveDisputes();
    } catch (error) {
      setMessage("", error.message || "تعذر حفظ القرار.");
      renderExecutiveDisputes();
    }
  }));
  app.querySelectorAll("[data-dispute-escalate]").forEach((button) => button.addEventListener("click", async () => {
    const reason = await askText({ title: "تصعيد للمدير التنفيذي", message: "اكتب سبب التصعيد أو القرار المطلوب.", defaultValue: "تحتاج الحالة إلى قرار تنفيذي.", confirmLabel: "تصعيد الآن" });
    if (reason === null) return;
    try {
      await endpoints.updateDispute(button.dataset.disputeEscalate, { status: "ESCALATED", escalatedToExecutive: true, executiveEscalationReason: reason });
      setMessage("تم تصعيد الحالة للمتابعة التنفيذية.", "");
      renderExecutiveDisputes();
    } catch (error) {
      setMessage("", error.message || "تعذر التصعيد.");
      renderExecutiveDisputes();
    }
  }));
}


async function renderEmployeeDetail(employeeId) {
  const detail = unwrap(await endpoints.executiveEmployeeDetail(employeeId));
  const employee = detail.employee || {};
  const today = detail.today || {};
  const loc = today.latestLocation || {};
  const latestLiveRequest = [...(detail.liveRequests || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  const pendingLiveRequest = (detail.liveRequests || []).find((row) => String(row.status || "").toUpperCase() === "PENDING");
  const latestResponse = latestLiveRequest ? liveResponseForRequest(detail, latestLiveRequest) : null;
  const latestPlace = loc.addressLabel || loc.locationLabel || loc.placeLabel || latestResponse?.note || "";
  const locationMessage = loc.latitude && loc.longitude
    ? `<div class="message"><strong>آخر موقع:</strong> ${escapeHtml(latestPlace || "موقع مباشر مرسل")} — <span>${escapeHtml(loc.latitude)}, ${escapeHtml(loc.longitude)}</span> — <a target="_blank" rel="noopener" href="${escapeHtml(mapUrl(loc.latitude, loc.longitude))}">فتح على الخريطة</a></div>`
    : pendingLiveRequest
      ? `<div class="message warning">تم إرسال طلب الموقع للموظف وهو الآن بانتظار الرد. سيظهر GPS هنا بعد ضغط الموظف على "إرسال موقعي".</div>`
      : latestLiveRequest && String(latestLiveRequest.status || "").toUpperCase() === "POSTPONED"
        ? `<div class="message warning">الموظف طلب تأجيل إرسال الموقع 5 دقائق${latestLiveRequest.responseNote ? `: ${escapeHtml(latestLiveRequest.responseNote)}` : ""}.</div>`
      : latestLiveRequest && String(latestLiveRequest.status || "").toUpperCase() === "REJECTED"
        ? `<div class="message warning">آخر طلب موقع تم رفضه من الموظف${latestLiveRequest.responseNote ? `: ${escapeHtml(latestLiveRequest.responseNote)}` : ""}.</div>`
        : `<div class="message warning">لا يوجد موقع GPS محفوظ أو رد مباشر من الموظف حتى الآن.</div>`;
  shell(`
    <section class="grid executive-detail-grid">
      <article class="panel span-12 employee-detail-hero">
        <div class="panel-head">
          <div class="person-cell large">${avatar(employee, "large")}<span><strong>${escapeHtml(employee.fullName || "-")}</strong><small>${escapeHtml(employee.jobTitle || "")}${employee.manager?.fullName ? ` — ${escapeHtml(employee.manager.fullName)}` : ""}</small></span></div>
          <div class="toolbar"><button class="button ghost" data-route="employees">رجوع للقائمة</button><button class="button primary" data-request-live="${escapeHtml(employee.id || employeeId)}">طلب الموقع المباشر</button></div>
        </div>
        <div class="metric-grid">
          ${metric("حالة اليوم", statusLabel(today.status), dateOnly(today.day))}
          ${metric("الحضور", date(today.checkInAt), "أول بصمة")}
          ${metric("الانصراف", date(today.checkOutAt), "آخر بصمة")}
          ${metric("آخر موقع", loc.latitude && loc.longitude ? `${Math.round(Number(loc.accuracyMeters || 0))} متر` : "لا يوجد", date(loc.capturedAt || loc.respondedAt || loc.date))}
        </div>
        ${locationMessage}
      </article>
      <article class="panel span-6"><h3>آخر حركات الحضور</h3>${table(["النوع", "الوقت", "الحالة", "ملاحظات"], (detail.attendance || []).slice(0, 12).map((row) => `<tr><td>${escapeHtml(statusLabel(row.type || row.action))}</td><td>${escapeHtml(date(row.eventAt || row.createdAt))}</td><td>${badge(row.geofenceStatus || row.status || "")}</td><td>${escapeHtml(row.notes || row.source || "")}</td></tr>`))}</article>
      <article class="panel span-6"><h3>الإجازات والمأموريات</h3>${table(["النوع", "الفترة", "الحالة"], [...(detail.leaves || []).map((row) => [row.leaveType?.name || row.leaveType || "إجازة", `${row.startDate || "-"} → ${row.endDate || "-"}`, row.status]), ...(detail.missions || []).map((row) => [row.destinationName || row.title || "مأمورية", `${row.plannedStart || "-"} → ${row.plannedEnd || "-"}`, row.status])].slice(0, 12).map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${badge(row[2])}</td></tr>`))}</article>
      <article class="panel span-12"><h3>طلبات الموقع المباشر</h3>${table(["الوقت", "الحالة", "السبب", "الرد"], (detail.liveRequests || []).map((row) => {
        const response = liveResponseForRequest(detail, row);
        const responseText = response?.latitude && response?.longitude
          ? `<a target="_blank" rel="noopener" href="${escapeHtml(mapUrl(response.latitude, response.longitude))}">موقع مرسل</a>${response.note ? `<br><small>${escapeHtml(response.note)}</small>` : ""}`
          : (row.responseNote || response?.note || date(row.respondedAt) || "-");
        return `<tr><td>${escapeHtml(date(row.createdAt))}</td><td>${badge(row.status)}</td><td>${escapeHtml(row.reason || "")}</td><td>${responseText}</td></tr>`;
      }))}</article>
    </section>
  `, "تفاصيل موظف", "متابعة حالة موظف واحد دون أدوات إدارية معقدة.");
  bindEmployeeCardActions();
}

function bindEmployeeCardActions() {
  app.querySelectorAll("[data-view-employee]").forEach((button) => button.addEventListener("click", () => setRoute("employee", { id: button.dataset.viewEmployee })));
  app.querySelectorAll("[data-request-live]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "جاري الإرسال...";
    try {
      await endpoints.requestLiveLocation(button.dataset.requestLive, { reason: DEFAULT_LIVE_LOCATION_REASON });
      state.dataCache = null;
      setMessage("تم إنشاء طلب الموقع، وقد لا يصل الإشعار الخارجي إذا كان غير مفعل.", "");
      if (routeKey() === "employee") await renderEmployeeDetail(button.dataset.requestLive);
      else render();
    } catch (error) {
      setMessage("", error.message || "تعذر طلب الموقع.");
      button.disabled = false;
      button.textContent = originalText;
    }
  }));
}

async function renderNoPermission() {
  shell(`
    <section class="panel">
      <h2>هذا الحساب ليس حسابًا تنفيذيًا</h2>
      <p>هذه الواجهة مخصصة للمدير التنفيذي أو من يملك صلاحية المتابعة التنفيذية وطلب الموقع المباشر.</p>
      <div class="toolbar"><button class="button ghost" data-action="employee-portal">فتح تطبيق الموظف</button>${canOpenAdminPortal() ? `<button class="button primary" data-action="admin-portal">فتح لوحة الأدمن</button>` : ""}</div>
    </section>
  `, "صلاحيات غير كافية", "تم منع فتح المتابعة التنفيذية لهذا الحساب.");
}

async function render() {
  try {
    state.error = "";
    if (!state.user) state.user = await endpoints.me().then(unwrap).catch(() => null);
    if (await enforceGateSessionIdentity("executive")) return;
    if (!state.user) return renderLogin();
    if (!isExecutivePortalUser(state.user)) return renderNoPermission();

    const key = routeKey();
    if (key === "home") await renderHome();
    else if (key === "employees") await renderEmployees();
    else if (key === "presence") await renderPresenceMap();
    else if (key === "risk") await renderRiskCenter();
    else if (key === "actions") await renderActions();
    else if (key === "decisions") await renderAdminDecisions();
    else if (key === "disputes") await renderExecutiveDisputes();
    else if (key === "employee") {
      const id = routeParams().get("id") || "";
      if (!id) return setRoute("employees");
      await renderEmployeeDetail(id);
    } else await renderHome();
  } catch (error) {
    debugError(error);
    setMessage("", error.message || "تعذر تحميل المتابعة التنفيذية.");
    shell(`<section class="panel"><h2>تعذر تحميل الصفحة</h2><p>${escapeHtml(error.message || "خطأ غير معروف")}</p><button class="button ghost" data-route="home">العودة للرئيسية</button></section>`, "خطأ", "راجع الاتصال أو أعد التحميل.");
  }
}

window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "home";
  render();
});

/* ── v101: Ripple + count-up + scroll-top (executive) ── */
document.addEventListener('click', e => {
  const btn = e.target.closest('.button');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${((e.clientX-r.left)/r.width*100).toFixed(1)}%`);
  btn.style.setProperty('--y', `${((e.clientY-r.top)/r.height*100).toFixed(1)}%`);
}, { passive: true });

(function() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top';
  btn.textContent = '↑';
  btn.setAttribute('aria-label', 'للأعلى');
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 280), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

const execCountObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const to = parseFloat(String(el.dataset.count || '').replace(/[^0-9.]/g,'')) || 0;
    const from = 0, dur = 900, start = performance.now();
    const isF = String(el.dataset.count||'').includes('.');
    const step = ts => {
      const p = Math.min((ts-start)/dur,1), v = from+(to-from)*(1-Math.pow(1-p,3));
      el.textContent = isF ? v.toFixed(1) : Math.round(v).toLocaleString('ar-EG');
      if(p<1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    execCountObs.unobserve(el);
  });
}, { threshold: 0.3 });
new MutationObserver(() => {
  document.querySelectorAll('[data-count]:not([data-counted])').forEach(el => {
    el.dataset.counted='1'; execCountObs.observe(el);
  });
}).observe(document.body, { childList: true, subtree: true });


if (!location.hash) location.hash = "home";

/* ── v111: Offline Queue Replay ─────────────────────────────────────────────
 * The Service Worker sends SYNC_OFFLINE_QUEUE via Background Sync when the
 * device reconnects.  Ensures executive actions queued while offline are
 * replayed automatically on reconnection.
 * ─────────────────────────────────────────────────────────────────────────── */
(function attachOfflineQueueSyncExec() {
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
