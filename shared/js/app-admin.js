import { endpoints, unwrap } from "./api.js?v=v116-location-ui-numbers";
import { enableWebPushSubscription } from "./push.js?v=v39-consolidated-stable-110";
import { runRuntimeDiagnostics, clearRuntimeCaches } from "./runtime-diagnostics.js?v=v39-consolidated-stable-110";

const debugEnabled = () => Boolean(globalThis.HR_DEBUG_LOGS || globalThis.HR_SUPABASE_CONFIG?.debug === true);
const debugWarn = (...args) => { if (debugEnabled()) globalThis.console?.warn?.(...args); };
const debugError = (...args) => { if (debugEnabled()) globalThis.console?.error?.(...args); };
const debugInfo = (...args) => { if (debugEnabled()) globalThis.console?.info?.(...args); };
const app = document.querySelector("#app");
const DEFAULT_LIVE_LOCATION_REASON = "متابعة تنفيذية مباشرة";
const EXECUTIVE_REQUESTER_NAME = "الشيخ محمد يوسف";

const state = {
  route: location.hash.replace("#", "") || "dashboard",
  user: null,
  message: "",
  error: "",
  sidebarCollapsed: localStorage.getItem("hr.sidebarCollapsed") === "true",
  sidebarScrollTop: Number(sessionStorage.getItem("hr.sidebarScrollTop") || 0),
  loginIdentifier: localStorage.getItem("hr.login.lastIdentifier") || "",
  loginPassword: "",
  lastLoginFailed: false,
};

const navGroups = [
  ["مركز HR الأساسي", [["dashboard", "لوحة المتابعة"], ["hr-operations", "عمليات HR"], ["employees", "الموظفون"], ["attendance", "الحضور"], ["attendance-review", "مراجعة البصمات"], ["requests", "الطلبات والموافقات"], ["kpi", "KPI والتقييم"], ["kpi-month-center", "متابعة KPI الشهر"], ["kpi-executive-report", "تقرير KPI تنفيذي"], ["kpi-cycle-lock", "قفل دورة KPI"], ["report-center", "التقارير والتصدير"], ["notifications", "مراقبة الإشعارات"]]],
  ["الموظفون والهيكل", [["management-structure", "هيكل الإدارة والفرق"], ["team-dashboard", "فريق المدير"], ["employee-archive", "صفحة موظف موحدة"], ["leave-balances", "أرصدة الإجازات"], ["documents", "مستندات الموظفين"], ["trusted-devices", "الأجهزة المعتمدة"], ["org-chart", "الهيكل الوظيفي"]]],
  ["الحضور والموقع", [["presence-map", "خريطة الحضور"], ["attendance-risk", "مخاطر البصمة"], ["smart-attendance", "قواعد الحضور"], ["attendance-calendar", "تقويم الحضور"], ["locations", "مراقبة اللوكيشن"], ["employee-punch", "بصمة الموظف"]]],
  ["الإدارة والاعتمادات", [["manager-suite", "لوحة المدير المباشر"], ["roles", "الأدوار"], ["permission-matrix", "مصفوفة الصلاحيات"], ["password-vault", "خزنة كلمات المرور"], ["sensitive-approvals", "اعتمادات حساسة"], ["disputes", "الشكاوى"], ["admin-decisions", "القرارات الإدارية"], ["policies", "السياسات والتوقيعات"]]],
  ["التقارير والجودة", [["monthly-report", "تقرير شهري"], ["daily-reports", "التقارير اليومية"], ["control-room", "غرفة التحكم"], ["smart-alerts", "التنبيهات الذكية"], ["quality-center", "مركز الجودة"], ["workflow-automation", "مركز الربط والتشغيل"], ["audit", "سجل التدقيق"], ["security-log", "سجل الأمان"]]],
  ["النظام", [["settings", "الإعدادات"], ["system-diagnostics", "تشخيص النظام"], ["mobile-alignment", "ربط الموبايل والصلاحيات"], ["health", "حالة النظام"], ["supabase-setup", "Supabase"], ["db-updates", "Database"], ["backup", "نسخ واستيراد"]]],
];

// خريطة دمج بصري: هذه الصفحات ما زالت موجودة ومحمية بالصلاحيات،
// لكنها لم تعد تزحم قائمة HR الرئيسية لأنها تُفتح من مراكزها المناسبة.
const navAliasMap = {
  "executive-report": "dashboard",
  "executive-mobile": "presence-map",
  "manager-dashboard": "manager-suite",
  realtime: "presence-map",
  users: "employees",
  tasks: "requests",
  missions: "requests",
  leaves: "requests",
  "dispute-workflow": "disputes",
  reports: "report-center",
  "advanced-reports": "report-center",
  "executive-pdf": "report-center",
  "monthly-auto-pdf": "report-center",
  "monthly-evaluations": "kpi-month-center",
  "kpi-manager-mobile": "kpi",
  "kpi-executive-report": "kpi",
  "kpi-cycle-lock": "kpi",
  "ai-analytics": "quality-center",
  "data-center": "backup",
  "auto-backup": "backup",
  "complex-settings": "settings",
  "route-access": "settings",
  integrations: "settings",
  "access-control": "settings",
  "offline-sync": "settings",
  "workflow-automation": "quality-center",
  "mobile-alignment": "settings",
};

const routePermissions = {
  dashboard: ["dashboard:view"],
  "executive-report": ["executive:report", "dashboard:view", "reports:export"],
  "executive-mobile": ["executive:mobile", "dashboard:view", "live-location:request"],
  "presence-map": ["executive:presence-map", "executive:mobile", "dashboard:view"],
  "attendance-risk": ["attendance:risk", "attendance:review", "attendance:manage", "executive:mobile"],
  realtime: ["realtime:view", "dashboard:view", "reports:export"],
  "manager-dashboard": ["dashboard:view", "manager:team", "kpi:team", "attendance:manage", "requests:approve"],
  employees: ["employees:view", "employees:write", "users:manage"],
  "management-structure": ["organization:manage", "employees:view", "manager:team"],
  "team-dashboard": ["team:dashboard", "manager:team", "manager:suite", "kpi:team"],
  "hr-operations": ["hr:operations", "attendance:manage", "kpi:hr", "employees:write"],
  "employee-profile": ["employees:view", "employees:write", "users:manage"],
  users: ["users:manage"],
  "leave-balances": ["leave:balance", "employees:view", "requests:approve"],
  documents: ["documents:manage", "employees:view"],
  "trusted-devices": ["users:manage", "attendance:manage", "attendance:self"],
  "org-chart": ["employees:view"],
  roles: ["users:manage"],
  "permission-matrix": ["permissions:matrix", "users:manage"],
  "password-vault": ["users:manage"],
  "sensitive-approvals": ["sensitive-actions:approve", "approvals:manage", "audit:view", "users:manage"],
  "employee-punch": ["dashboard:view", "attendance:self", "attendance:manage"],
  "smart-attendance": ["attendance:smart", "attendance:rules", "attendance:manage"],
  "manager-suite": ["manager:suite", "manager:team", "kpi:team", "attendance:manage", "requests:approve"],
  "executive-pdf": ["executive:report", "reports:export"],
  "monthly-auto-pdf": ["reports:pdf", "reports:export", "executive:report"],
  "employee-archive": ["employee:archive", "employees:view", "audit:view"],
  "smart-alerts": ["alerts:manage", "control-room:view", "dashboard:view"],
  "monthly-evaluations": ["kpi:monthly", "kpi:team", "kpi:manage", "kpi:hr", "kpi:executive"],
  "supabase-setup": ["supabase:diagnostics", "settings:manage"],
  "db-updates": ["database:migrations", "settings:manage"],
  "auto-backup": ["backup:auto", "settings:manage", "reports:export"],
  attendance: ["attendance:manage", "employees:write"],
  "attendance-review": ["attendance:manage", "attendance:review", "requests:approve"],
  "attendance-calendar": ["attendance:manage", "employees:view"],
  requests: ["requests:approve", "attendance:manage"],
  tasks: ["tasks:manage", "dashboard:view"],
  missions: ["dashboard:view"],
  leaves: ["dashboard:view"],
  locations: ["dashboard:view", "attendance:self", "attendance:manage", "requests:approve"],
  disputes: ["dashboard:view", "disputes:manage", "disputes:committee", "requests:approve", "users:manage"],
  "dispute-workflow": ["disputes:committee", "disputes:manage", "disputes:escalate", "requests:approve"],
  "admin-decisions": ["decisions:manage", "notifications:manage", "executive:report"],
  kpi: ["kpi:manage", "kpi:team", "kpi:self", "kpi:hr", "kpi:executive", "kpi:final-approve", "reports:export"],
  "kpi-month-center": ["kpi:manage", "kpi:team", "kpi:hr", "kpi:executive", "reports:export"],
  "kpi-executive-report": ["kpi:executive", "kpi:final-approve", "reports:export", "dashboard:view"],
  "kpi-cycle-lock": ["kpi:final-approve", "kpi:executive", "settings:manage"],
  reports: ["reports:export"],
  "report-center": ["reports:export", "reports:pdf", "reports:excel"],
  "advanced-reports": ["reports:export"],
  "monthly-report": ["reports:export", "attendance:manage"],
  "ai-analytics": ["ai:view", "reports:export"],
  audit: ["audit:view"],
  "security-log": ["audit:view", "security:view", "settings:manage"],
  "control-room": ["control-room:view", "maintenance:run", "audit:view", "dashboard:view"],
  "daily-reports": ["daily-report:review", "dashboard:view", "reports:export"],
  notifications: ["dashboard:view"],
  "workflow-automation": ["maintenance:run", "workflow:manage", "settings:manage", "dashboard:view"],
  "mobile-alignment": ["settings:manage", "users:manage", "dashboard:view", "permissions:matrix"],
  "data-center": ["data-center:manage", "settings:manage", "reports:export"],
  settings: ["settings:manage"],
  "complex-settings": ["settings:manage", "attendance:manage"],
  "system-diagnostics": ["settings:manage", "audit:view", "users:manage"],
  "quality-center": ["maintenance:run", "workflow:manage", "settings:manage", "audit:view"],
  policies: ["policies:manage", "policies:self", "settings:manage"],
  "route-access": ["settings:manage", "users:manage"],
  health: ["settings:manage", "audit:view"],
  backup: ["settings:manage", "reports:export"],
  integrations: ["integrations:manage", "settings:manage"],
  "access-control": ["access_control:manage", "attendance:manage"],
  "offline-sync": ["offline:manage", "settings:manage", "attendance:self"],
};

const FULL_ACCESS_ROLE_KEYS = new Set([
  "admin",
  "super-admin",
  "super_admin",
  "role-admin",
  "executive-secretary",
  "role-executive-secretary",
  "مدير النظام",
  "السكرتير التنفيذي",
]);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDashboardPayload(value = {}) {
  const dashboard = value && typeof value === "object" ? value : {};
  const cards = dashboard.cards && typeof dashboard.cards === "object" ? dashboard.cards : {};
  const metrics = safeList(dashboard.metrics);
  const attendanceBreakdown = safeList(dashboard.attendanceBreakdown);
  const attendanceTrends = safeList(dashboard.attendanceTrends);
  const fallbackMetrics = [
    { label: "الموظفون", value: cards.employees ?? 0, helper: "إجمالي الملفات المتاحة" },
    { label: "حضور اليوم", value: cards.presentToday ?? 0, helper: "الحركات المسجلة اليوم" },
    { label: "طلبات معلقة", value: cards.pendingRequests ?? 0, helper: "تحتاج مراجعة" },
    { label: "إجازات اليوم", value: cards.leavesToday ?? 0, helper: "الموافق عليها اليوم" },
  ];
  const fallbackBreakdown = [
    { label: "حضور", value: cards.presentToday ?? 0 },
    { label: "طلبات", value: cards.pendingRequests ?? 0 },
    { label: "إجازات", value: cards.leavesToday ?? 0 },
  ];
  const normalizedBreakdown = attendanceBreakdown.length ? attendanceBreakdown : fallbackBreakdown;
  const normalizedTrends = attendanceTrends.length
    ? attendanceTrends
    : normalizedBreakdown.map((item) => ({ label: item.label, present: Number(item.value || 0), late: 0, mission: 0 }));
  return {
    ...dashboard,
    metrics: metrics.length ? metrics : fallbackMetrics,
    attendanceBreakdown: normalizedBreakdown,
    attendanceTrends: normalizedTrends,
    latestEvents: safeList(dashboard.latestEvents),
    latestAudit: safeList(dashboard.latestAudit),
  };
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

function roleMeta(user = state.user) {
  const role = user?.role;
  if (role && typeof role === "object") {
    return {
      id: role.id || user?.roleId || "",
      key: role.key || role.slug || role.code || "",
      slug: role.slug || role.key || "",
      name: role.name || role.label || user?.roleName || user?.role || "",
      permissions: normalizePermissionList(role.permissions),
    };
  }
  return {
    id: user?.roleId || "",
    key: user?.roleKey || user?.roleSlug || user?.role || "",
    slug: user?.roleSlug || user?.roleKey || user?.role || "",
    name: user?.roleName || user?.role || user?.employee?.role?.name || "",
    permissions: normalizePermissionList(user?.employee?.role?.permissions),
  };
}

function currentPermissions(user = state.user) {
  return new Set([
    ...normalizePermissionList(user?.permissions),
    ...normalizePermissionList(user?.permissionScopes),
    ...normalizePermissionList(user?.scopes),
    ...normalizePermissionList(user?.profile?.permissions),
    ...roleMeta(user).permissions,
  ]);
}

function isExecutiveOnlyRole(user = state.user) {
  const role = roleMeta(user);
  const keys = [role.id, role.key, role.slug, role.name].filter(Boolean).map((item) => String(item).toLowerCase());
  return keys.some((key) => ["role-executive", "executive", "المدير التنفيذي"].includes(key));
}

function hasFullAccess(user = state.user) {
  if (isExecutiveOnlyRole(user)) return false;
  const role = roleMeta(user);
  const rawKeys = [role.id, role.key, role.slug, role.name].filter(Boolean).map(String);
  const lowerKeys = rawKeys.map((item) => item.toLowerCase());
  const permissions = currentPermissions(user);
  return permissions.has("*") || rawKeys.some((key) => FULL_ACCESS_ROLE_KEYS.has(key)) || lowerKeys.some((key) => FULL_ACCESS_ROLE_KEYS.has(key));
}

function isTechnicalAdmin(user = state.user) {
  const role = roleMeta(user);
  const keys = [role.id, role.key, role.slug, user?.roleId, user?.roleKey, user?.roleSlug]
    .filter(Boolean)
    .map((item) => String(item).toLowerCase());
  return hasFullAccess(user) || keys.some((key) => ["role-admin", "admin", "super-admin", "super_admin"].includes(key));
}

function hasAnyPermission(scopes = []) {
  const permissions = currentPermissions();
  if (!scopes.length || hasFullAccess()) return true;
  return scopes.some((scope) => permissions.has(scope));
}

function roleLabel(user = state.user) {
  const role = roleMeta(user);
  return role.name || role.key || role.slug || "بدون دور محدد";
}

function activeNavKey(key = routeKey()) {
  const baseKey = key === "employee-profile" ? "employees" : key;
  return navAliasMap[baseKey] || baseKey;
}

function canRoute(key) {
  if (key === "password-vault") return isTechnicalAdmin() || hasFullAccess();
  return hasAnyPermission(routePermissions[key] || []);
}

function isAdminPortalUser(user = state.user) {
  if (!user) return false;
  if (isExecutiveOnlyRole(user)) return true;
  if (hasFullAccess(user)) return true;
  const previousUser = state.user;
  state.user = user;
  const allowed = hasAnyPermission([
    "employees:view",
    "users:manage",
    "attendance:manage",
    "requests:approve",
    "reports:export",
    "settings:manage",
    "audit:view",
    "kpi:team",
    "team:dashboard",
    "hr:operations",
    "organization:manage",
  ]);
  state.user = previousUser;
  return allowed;
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

function gateIdentityForPortal(target = "admin") {
  const unlockedTarget = localStorage.getItem("hr.opsGatewayUnlockedTarget") || sessionStorage.getItem("hr.opsGatewayUnlockedTarget");
  if (unlockedTarget !== target) return "";
  return localStorage.getItem("hr.ops.gate.identity") || sessionStorage.getItem("hr.ops.gate.identity") || localStorage.getItem("hr.ops.gate.email") || sessionStorage.getItem("hr.ops.gate.email") || "";
}

function sessionMatchesGateIdentity(user = state.user, target = "admin") {
  const gateIdentity = normalizeGateIdentifier(gateIdentityForPortal(target));
  if (!gateIdentity || !user) return true;
  const employee = user.employee || {};
  const tokens = [
    user.email, user.phone, user.mobile, user.identifier, user.fullName, user.name,
    employee.email, employee.phone, employee.mobile, employee.fullName,
  ].map(normalizeGateIdentifier).filter(Boolean);
  return tokens.includes(gateIdentity);
}

async function enforceGateSessionIdentity(target = "admin") {
  const gateIdentity = gateIdentityForPortal(target);
  if (!gateIdentity || !state.user || sessionMatchesGateIdentity(state.user, target)) return false;
  await endpoints.logout().catch(() => null);
  state.user = null;
  state.loginIdentifier = gateIdentity;
  state.loginPassword = "";
  state.lastLoginFailed = false;
  setMessage("", "تم تسجيل خروج الجلسة السابقة لأنها لا تطابق الرقم الذي فتح البوابة. سجل الدخول بالرقم المطلوب.");
  renderLogin();
  return true;
}

function goEmployeePortal(route = "home") {
  window.location.href = "../employee/index.html#" + encodeURIComponent(route);
}

function goExecutivePortal(route = "home") {
  window.location.href = "../operations-gate/?next=" + encodeURIComponent("../executive/#" + route);
}

window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "dashboard";
  render();
});

function routeKey() {
  return state.route.split("?")[0];
}

function routeParams() {
  return new URLSearchParams(state.route.split("?")[1] || "");
}

function inputDate(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function setRouteQuery(key, values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([name, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") params.set(name, String(value));
  });
  const query = params.toString();
  location.hash = query ? `${key}?${query}` : key;
}

function attendanceFiltersFromRoute() {
  const params = routeParams();
  const today = inputDate(new Date());
  const monthAgo = inputDate(addDays(new Date(), -30));
  const limit = Math.min(Math.max(Number(params.get("limit") || 500), 100), 5000);
  return {
    from: params.get("from") || monthAgo,
    to: params.get("to") || today,
    employeeId: params.get("employeeId") || "",
    type: params.get("type") || "",
    review: params.get("review") || "",
    limit,
  };
}

function eventDay(event) {
  return String(event?.eventAt || event?.createdAt || event?.date || "").slice(0, 10);
}

function filterAttendanceEvents(events = [], filters = {}) {
  return events.filter((event) => {
    const day = eventDay(event);
    return (!filters.from || !day || day >= filters.from)
      && (!filters.to || !day || day <= filters.to)
      && (!filters.employeeId || event.employeeId === filters.employeeId)
      && (!filters.type || event.type === filters.type)
      && (!filters.review || (filters.review === "review" ? Boolean(event.requiresReview) : !event.requiresReview));
  }).sort((a, b) => new Date(b.eventAt || b.createdAt || 0) - new Date(a.eventAt || a.createdAt || 0));
}

function routeDisplayName(key) {
  for (const [, routes] of navGroups) {
    const found = routes.find(([routeKey]) => routeKey === key);
    if (found) return found[1];
  }
  if (key === "employee-profile") return "ملف الموظف";
  return key;
}

function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait); };
}

function setMessage(message = "", error = "") {
  state.message = message;
  state.error = error;
}

function englishDigits(value = "") {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
}

function escapeHtml(value) {
  return englishDigits(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function date(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? englishDigits(value) : englishDigits(parsed.toLocaleString("ar-EG-u-nu-latn"));
}

function dateOnly(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? englishDigits(String(value).slice(0, 10)) : englishDigits(parsed.toLocaleDateString("ar-EG-u-nu-latn"));
}

function metric(label, value, helper = "") {
  const num = parseFloat(String(value ?? 0).replace(/[^0-9.]/g, ''));
  const dc  = (!isNaN(num) && num >= 0) ? ` data-count="${num}"` : '';
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong${dc}>${escapeHtml(value ?? 0)}</strong><small>${escapeHtml(helper)}</small></article>`;
}

function statusLabel(value) {
  return {
    ACTIVE: "نشط",
    INACTIVE: "غير مفعل",
    INVITED: "دعوة مؤقتة",
    LOCKED: "مغلق",
    TERMINATED: "منتهي",
    SUSPENDED: "موقوف",
    DISABLED: "معطل",
    ON_LEAVE: "إجازة",
    LEAVE: "إجازة",
    REMOTE: "عن بعد",
    PRESENT: "حاضر",
    PRESENT_REVIEW: "حضور للمراجعة",
    LATE: "متأخر",
    ABSENT: "غائب",
    MISSION: "مأمورية",
    CHECK_IN: "حضور",
    CHECK_OUT: "انصراف",
    CHECKED_OUT: "انصرف",
    ON_MISSION: "مأمورية",
    LIVE_SHARED: "موقع مباشر مُرسل",
    ACTION_REQUIRED: "إجراء مطلوب",
    SELF_SUBMITTED: "مرسل من الموظف",
    MANAGER_APPROVED: "اعتماد المدير",
    HR_REVIEWED: "مراجعة HR",
    SECRETARY_REVIEWED: "مراجعة السكرتير",
    EXECUTIVE_APPROVED: "اعتماد المدير التنفيذي",
    CHECKOUT_REVIEW: "انصراف للمراجعة",
    APPROVED: "معتمد",
    REJECTED: "مرفوض",
    DRAFT: "مسودة",
    PENDING: "قيد المراجعة",
    SUBMITTED: "تم التسليم",
    IN_REVIEW: "قيد فحص اللجنة",
    OPEN: "مفتوحة",
    RESOLVED: "تم الحل",
    CLOSED: "مغلقة",
    ESCALATED: "مرفوعة للإدارة التنفيذية",
    MEDIUM: "متوسطة",
    HIGH: "عالية",
    LOW: "منخفضة",
    COMPLETED: "مكتمل",
    READ: "مقروء",
    UNREAD: "جديد",
    INFO: "معلومة",
    SUCCESS: "نجاح",
    verified: "تحقق ناجح",
    not_checked: "بدون تحقق",
    failed: "فشل التحقق",
    inside_branch: "داخل الفرع",
    outside_branch: "خارج النطاق",
    inside_mission: "داخل مأمورية",
    location_unavailable: "الموقع غير متاح",
    permission_denied: "صلاحية الموقع مرفوضة",
    branch_unknown: "مجمع غير محدد",
    branch_location_missing: "عنوان الفرع غير مضبوط",
    location_low_accuracy: "دقة الموقع ضعيفة",
    inside_branch_low_accuracy: "داخل النطاق بدقة ضعيفة",
    biometric_pending: "بانتظار البصمة",
    storage_ok: "Storage سليم",
    storage_missing: "Bucket ناقص",
    linked: "مرتبط",
    unlinked: "غير مرتبط",
    fixed: "تم التصحيح",

    APPROVE: "اعتماد",
    REJECT: "رفض",
    REVIEWED: "تمت المراجعة",
    REVIEW_PENDING: "بانتظار المراجعة",
    REJECTED_CONFIRMED: "رفض مؤكد",
    MANUAL_APPROVED: "اعتماد يدوي",
    DEVICE_TRUSTED: "جهاز معتمد",
    DEVICE_DISABLED: "جهاز معطل",
    PUSH_ACTIVE: "Push نشط",
    PASSKEY_ONLY: "Passkey فقط",
    PENDING_APPROVAL: "بانتظار اعتماد",
    NO_DEVICE: "بلا جهاز",
    NORMAL: "عادي",
    SENSITIVE: "حساس",
    FULL_ACCESS: "صلاحية كاملة",
    ACTIVE: "نشط",
    DISABLED: "معطل",
    unknown: "غير معروف",
  }[value] || value || "-";
}

function badge(value) {
  return `<span class="status ${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</span>`;
}

function healthBadge(ok, label = "") {
  return `<span class="status ${ok ? "APPROVED" : "REJECTED"}">${escapeHtml(label || (ok ? "سليم" : "يحتاج مراجعة"))}</span>`;
}

function formatMeters(value) {
  return value == null || value === "" || Number.isNaN(Number(value)) ? "-" : `${Math.round(Number(value))} متر`;
}

function locationPlaceLabel(record = {}) {
  const status = String(record.locationStatus || record.geofenceStatus || record.status || "").toLowerCase();
  if (record.addressLabel || record.locationLabel || record.placeLabel || record.address) return record.addressLabel || record.locationLabel || record.placeLabel || record.address;
  if (status.includes("inside")) return "مجمع أحلى شباب — منيل شيحة";
  if (status.includes("outside")) return "موقع خارج نطاق المجمع";
  if (record.latitude && record.longitude) return "موقع GPS محفوظ — افتح الخريطة للتفاصيل";
  return "لا يوجد موقع محفوظ";
}

function locationStatusText(record = {}) {
  const status = String(record.locationStatus || record.geofenceStatus || record.status || "").toLowerCase();
  if (status.includes("inside")) return "داخل نطاق مجمع أحلى شباب";
  if (status.includes("outside")) return "خارج نطاق المجمع";
  if (status.includes("uncertain") || status.includes("low_accuracy")) return "موقع يحتاج مراجعة";
  return "موقع GPS محفوظ";
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "?";
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

function avatar(person, size = "") {
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
function isStrongPassword(value) {
  return new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{10,}$").test(String(value || ""));
}

function readForm(form, options = {}) {
  const values = Object.fromEntries(new FormData(form));
  const errors = [];
  const emailPattern = new RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  const phonePattern = new RegExp("^01[0-9]{8,10}$");
  const passwordPolicy = options.passwordPolicy || form.dataset.passwordPolicy || "none";
  for (const [name, value] of Object.entries(values)) {
    const text = String(value || "").trim();
    if (["email", "mail"].includes(name) && text && !emailPattern.test(text)) errors.push("البريد الإلكتروني غير صحيح.");
    if (["phone", "mobile"].includes(name) && text && !phonePattern.test(text.replace(/\s+/g, ""))) errors.push("رقم الموبايل يجب أن يكون رقمًا مصريًا صحيحًا يبدأ بـ 01.");
    const shouldValidatePassword = name === "newPassword" || (name === "password" && passwordPolicy === "strong");
    if (shouldValidatePassword && text && !isStrongPassword(text)) errors.push("كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف وتحتوي على حرف كبير وصغير ورقم ورمز.");
  }
  if (errors.length) throw new Error([...new Set(errors)].join("\n"));
  return values;
}

function optionList(items = [], selected = "", empty = "") {
  return `${empty ? `<option value="">${escapeHtml(empty)}</option>` : ""}${items.map((item) => {
    const value = item.id ?? item.value ?? item.name;
    return `<option value="${escapeHtml(value)}" ${String(selected || "") === String(value || "") ? "selected" : ""}>${escapeHtml(item.name ?? item.fullName ?? item.label ?? value)}</option>`;
  }).join("")}`;
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

function enhanceResponsiveTables(scope = app) {
  scope.querySelectorAll(".table-wrap table").forEach((tableElement) => {
    const headers = [...tableElement.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    tableElement.querySelectorAll("tbody tr").forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (!cell.dataset.label && headers[index]) cell.dataset.label = headers[index];
      });
    });
  });
}

function simpleForm(id, fields, submitText) {
  return `<form id="${id}" class="form-grid compact-form">${fields.map(([name, label, type = "text", opts = "", value = ""]) => `<label>${escapeHtml(label)}${type === "select" ? `<select name="${name}">${opts}</select>` : type === "textarea" ? `<textarea name="${name}">${escapeHtml(value)}</textarea>` : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${type !== "checkbox" ? "required" : ""}/>`}</label>`).join("")}<div class="form-actions"><button class="button primary" type="submit">${escapeHtml(submitText)}</button></div></form>`;
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

function askText({ title = "طلب بيانات", message = "اكتب التفاصيل", defaultValue = "", confirmLabel = "حفظ", cancelLabel = "إلغاء", required = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <form class="confirm-modal prompt-modal">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div></div>
        <label><span class="sr-only">${escapeHtml(title)}</span><textarea name="answer" ${required ? "required" : ""}>${escapeHtml(defaultValue)}</textarea></label>
        <div class="form-actions">
          <button class="button ghost" type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="button primary" type="submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    const form = overlay.querySelector("form");
    const input = overlay.querySelector("textarea");
    const cleanup = (answer) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(answer); };
    const onKey = (event) => { if (event.key === "Escape") cleanup(null); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) cleanup(null); });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => cleanup(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = String(input.value || "").trim();
      if (required && !value) { input.focus(); return; }
      cleanup(value);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

function downloadFile(name, content, type = "text/plain;charset=utf-8") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function exportHtmlTable(name, headers, rows) {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif;direction:rtl}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:right}th{background:#f3f4f6}</style></head><body><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  downloadFile(name, html, "application/vnd.ms-excel;charset=utf-8");
}

function printReport(title, headers, rows) {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;direction:rtl;color:#111827}h1{font-size:22px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d1d5db;padding:8px;text-align:right;font-size:12px}th{background:#f3f4f6}.meta{color:#6b7280;margin-bottom:12px}@media print{button{display:none}}</style></head><body><button id="print-report-btn" type="button">طباعة / حفظ PDF</button><h1>${escapeHtml(title)}</h1><div class="meta">تاريخ التقرير: ${englishDigits(new Date().toLocaleString("ar-EG-u-nu-latn"))}</div><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><script>document.getElementById("print-report-btn")?.addEventListener("click",()=>window.print());<\/script></body></html>`);
  win.document.close();
}
function printBrandedReport(title, summaryHtml, headers, rows) {
  const win = window.open("", "_blank", "width=1200,height=850");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>body{font-family:Arial,Tahoma,sans-serif;padding:28px;direction:rtl;color:#0f172a}.brand{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0ea5e9;padding-bottom:16px;margin-bottom:18px}.brand img{width:68px;height:68px;object-fit:contain}.brand h1{margin:0;font-size:24px}.brand p{margin:4px 0 0;color:#64748b}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.summary div{border:1px solid #dbeafe;background:#eff6ff;border-radius:14px;padding:10px}.summary strong{display:block;font-size:20px;color:#0369a1}.qr-print{display:block;margin:18px auto;width:300px;height:300px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d1d5db;padding:8px;text-align:right;font-size:12px}th{background:#e0f2fe}.meta{color:#64748b;margin:10px 0}.actions{margin-bottom:16px}@media print{.actions{display:none}.summary{break-inside:avoid}}</style></head><body><div class="actions"><button id="print-report-btn" type="button">طباعة / حفظ PDF</button></div><div class="brand"><img src="../shared/images/ahla-shabab-logo.png" data-hide-on-error="1" /><div><h1>${escapeHtml(title)}</h1><p>جمعية خواطر أحلى شباب الخيرية — مجمع منيل شيحة</p><p class="meta">تاريخ التقرير: ${englishDigits(new Date().toLocaleString("ar-EG-u-nu-latn"))}</p></div></div>${summaryHtml}<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><script>document.getElementById("print-report-btn")?.addEventListener("click",()=>window.print());<\/script></body></html>`);
  win.document.close();
}

function punchUrlForEmployee(employee = {}) {
  const url = new URL(location.href);
  url.pathname = url.pathname.replace(/\/admin\/.*$/, "/employee/index.html");
  url.hash = `punch${employee.id ? `?employeeId=${encodeURIComponent(employee.id)}` : ""}`;
  return url.toString();
}

function qrImageUrl(value, size = 220) {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#071120"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="16" font-family="Arial">QR متوقف</text></svg>`);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}


async function getBrowserLocation() {
  if (!navigator.geolocation) return { locationPermission: "unavailable", accuracyMeters: null };
  return await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracyMeters = Math.round(Number(position.coords.accuracy || 0));
        resolve({
          locationPermission: "granted",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: accuracyMeters,
          accuracyMeters,
          capturedAt: new Date().toISOString(),
        });
      },
      (error) => resolve({ locationPermission: error.code === error.PERMISSION_DENIED ? "denied" : "unknown", accuracyMeters: null }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

const referenceDataCache = { ts: 0, data: null };
async function referenceData({ force = false } = {}) {
  if (!force && referenceDataCache.data && Date.now() - referenceDataCache.ts < 120000) return referenceDataCache.data;
  const safe = async (reader, fallback = []) => {
    try {
      return unwrap(await reader());
    } catch {
      return fallback;
    }
  };
  const fallbackEmployee = state.user?.employee ? [state.user.employee] : [];
  const fallbackRole = state.user?.role ? [state.user.role] : [];
  const fallbackBranch = state.user?.branch ? [state.user.branch] : state.user?.employee?.branch ? [state.user.employee.branch] : [];
  const fallbackDepartment = state.user?.department ? [state.user.department] : state.user?.employee?.department ? [state.user.employee.department] : [];
  const fallbackGovernorate = state.user?.governorate ? [state.user.governorate] : state.user?.employee?.governorate ? [state.user.employee.governorate] : [];
  const fallbackComplex = state.user?.complex ? [state.user.complex] : state.user?.employee?.complex ? [state.user.employee.complex] : [];
  const [roles, branches, departments, governorates, complexes, employees, permissions] = await Promise.all([
    safe(() => endpoints.roles(), fallbackRole),
    safe(() => endpoints.branches(), fallbackBranch),
    safe(() => endpoints.departments(), fallbackDepartment),
    safe(() => endpoints.governorates(), fallbackGovernorate),
    safe(() => endpoints.complexes(), fallbackComplex),
    safe(() => endpoints.employees(), fallbackEmployee),
    safe(() => endpoints.permissions(), []),
  ]);
  referenceDataCache.ts = Date.now();
  referenceDataCache.data = { roles, branches, departments, governorates, complexes, employees, permissions };
  return referenceDataCache.data;
}

function shell(content, title, description = "") {
  const previousSidebar = app.querySelector(".sidebar");
  if (previousSidebar) {
    state.sidebarScrollTop = previousSidebar.scrollTop;
    sessionStorage.setItem("hr.sidebarScrollTop", String(state.sidebarScrollTop));
  }
  const current = activeNavKey(routeKey());
  document.body.classList.remove("nav-open");
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  app.innerHTML = `
    <div class="app-shell">
      <div class="sidebar-overlay" data-action="nav-close"></div>
      <aside class="sidebar ${state.sidebarCollapsed ? "is-collapsed" : ""}">
        <button class="sidebar-close" type="button" data-action="nav-close" aria-label="إغلاق القائمة">×</button>
        <div class="brand">
          <img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" />
          <div><strong>نظام الحضور</strong><span>HR Operations SaaS</span></div>
        </div>
        <div class="sidebar-account-section">
          <div class="user-info" data-route="settings">
            ${avatar(userAvatarSubject(), "small")}
            <div>
              <strong>${escapeHtml(state.user?.name || state.user?.fullName || "مستخدم")}</strong>
              <small>${escapeHtml(roleLabel())}</small>
            </div>
          </div>
          <button class="button ghost full" type="button" data-action="logout">تسجيل الخروج</button>
        </div>
        <nav class="nav" aria-label="القائمة الرئيسية">
          ${navGroups.map(([group, routes]) => {
            const visibleRoutes = routes.filter(([key]) => canRoute(key));
            if (!visibleRoutes.length) return "";
            return `
            <section class="nav-group">
              <p>${escapeHtml(group)}</p>
              ${visibleRoutes.map(([key, label]) => `<button class="${current === key ? "is-active" : ""}" data-route="${key}" aria-current="${current === key ? "page" : "false"}"><span>${escapeHtml(label)}</span></button>`).join("")}
            </section>`;
          }).join("")}
          <section class="nav-group portal-links">
            <p>الانتقال للأنظمة</p>
            <button data-action="employee-portal"><span>تطبيق الموظف</span></button>
            <button data-action="executive-portal"><span>بوابة المدير التنفيذي</span></button>
          </section>
        </nav>
        <button class="collapse-button" type="button" data-action="collapse-sidebar">${state.sidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}</button>
      </aside>
      <button class="nav-fab" type="button" data-action="sidebar-expand" aria-label="فتح القائمة" title="فتح القائمة">☰</button>
      <main class="main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="button ghost mobile-menu" type="button" data-action="nav-open" aria-expanded="false">القائمة</button>
            <div class="compact-user-info desktop-hidden">
               ${avatar(userAvatarSubject(), "tiny")}
               <div><strong>${escapeHtml(state.user?.name || state.user?.fullName || "مستخدم")}</strong><small>${escapeHtml(roleLabel())}</small></div>
            </div>
          </div>
          <div class="page-title mobile-hidden"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>
          <div class="toolbar mobile-hidden">
            <span class="user-chip" title="${escapeHtml(roleLabel())}">${avatar(userAvatarSubject(), "tiny")}<span>${escapeHtml(state.user?.name || state.user?.fullName || "مستخدم")}</span></span>
            <button class="button ghost" data-action="refresh">تحديث</button>
            <button class="button danger" data-action="logout">تسجيل الخروج</button>
          </div>
        </header>
        ${state.user?.mustChangePassword ? `<div class="message warning">كلمة المرور الحالية مؤقتة. افتح الإعدادات وغير كلمة المرور قبل الاعتماد على الحساب.</div>` : ""}
        ${state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ""}
        ${state.error ? `<div class="message error">${escapeHtml(state.error)}</div>` : ""}
        ${content}
      </main>
    </div>
  `;

  enhanceResponsiveTables(app);
  const sidebar = app.querySelector(".sidebar");
  if (sidebar) {
    requestAnimationFrame(() => {
      sidebar.scrollTop = Number(state.sidebarScrollTop || 0);
      sidebar.querySelector('.nav button.is-active')?.scrollIntoView?.({ block: 'nearest' });
    });
    sidebar.addEventListener("scroll", () => {
      state.sidebarScrollTop = sidebar.scrollTop;
      sessionStorage.setItem("hr.sidebarScrollTop", String(state.sidebarScrollTop));
    }, { passive: true });
  }

  const closeMobileNav = () => {
    document.body.classList.remove("nav-open");
    app.querySelectorAll('[data-action="nav-open"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  };
  const openMobileNav = () => {
    document.body.classList.add("nav-open");
    app.querySelectorAll('[data-action="nav-open"]').forEach((button) => button.setAttribute("aria-expanded", "true"));
  };
  app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
    const currentSidebar = app.querySelector(".sidebar");
    if (currentSidebar) {
      state.sidebarScrollTop = currentSidebar.scrollTop;
      sessionStorage.setItem("hr.sidebarScrollTop", String(state.sidebarScrollTop));
    }
    closeMobileNav();
    location.hash = button.dataset.route;
  }));
  app.querySelectorAll('[data-action="nav-open"]').forEach((button) => button.addEventListener("click", openMobileNav));
  app.querySelectorAll('[data-action="nav-close"]').forEach((button) => button.addEventListener("click", closeMobileNav));
  app.querySelectorAll('[data-action="sidebar-expand"]').forEach((button) => button.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 1180px)").matches) {
      openMobileNav();
      return;
    }
    state.sidebarCollapsed = false;
    localStorage.setItem("hr.sidebarCollapsed", "false");
    render();
  }));
  app.querySelector('[data-action="collapse-sidebar"]')?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem("hr.sidebarCollapsed", String(state.sidebarCollapsed));
    render();
  });
  app.querySelectorAll('[data-action="employee-portal"]').forEach(btn => btn.addEventListener("click", () => goEmployeePortal("home")));
  app.querySelectorAll('[data-action="executive-portal"]').forEach(btn => btn.addEventListener("click", () => goExecutivePortal("home")));
  app.querySelectorAll('[data-action="refresh"]').forEach(btn => btn.addEventListener("click", render));
  app.querySelectorAll('[data-action="logout"]').forEach(btn => btn.addEventListener("click", async () => {
    await endpoints.logout();
    clearPersistentGateSession("admin");
    state.user = null;
    renderLogin();
  }));
}

function clearPersistentGateSession(target = "admin") {
  ["hr.opsGatewayUnlockedUntil", "hr.opsGatewayUnlockedTarget", "hr.opsGatewayToken", "hr.ops.gate.target", "hr.ops.gate.email", "hr.ops.gate.identity", "hr.ops.gate.ok"].forEach((key) => {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  });
  sessionStorage.removeItem(`hr.opsGatewayToken.${target}`);
  localStorage.removeItem(`hr.opsGatewayToken.${target}`);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.body.classList.remove("nav-open");
});

async function renderLogin() {
  const identifierValue = state.loginIdentifier || gateIdentityForPortal("admin") || "";
  const passwordValue = state.loginPassword || "";
  app.innerHTML = `
    <div class="login-screen">
      <form class="login-panel" id="login-form" data-password-policy="none" novalidate>
        <div class="login-logo-mark"><img src="../shared/images/ahla-shabab-logo.png" alt="" data-hide-on-error="1" /></div>
        <h1>بوابة الإدارة</h1>
        ${state.error ? `<div class="message error">${escapeHtml(state.error)}</div>` : ""}
        ${state.lastLoginFailed ? `<div class="message warning compact">تعذر تسجيل الدخول. تأكد من البيانات ثم أعد المحاولة.</div>` : ""}
        <label>البريد أو الاسم<input name="identifier" value="${escapeHtml(identifierValue)}" autocomplete="username" required /></label>
        <label>كلمة المرور
          <span class="login-password-field">
            <input name="password" type="password" value="${escapeHtml(passwordValue)}" autocomplete="current-password" required />
            <button class="password-toggle" type="button" data-toggle-password aria-pressed="false">إظهار</button>
          </span>
        </label>
        <button class="button primary full" type="submit">دخول</button>
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
      await endpoints.adminAccessLog?.({ action: "admin.login.success", result: "SUCCESS", route: location.hash || "login" }).catch(() => null);
      state.loginPassword = "";
      state.lastLoginFailed = false;
      if (!isAdminPortalUser(state.user)) return isExecutiveOnlyRole(state.user) ? goExecutivePortal("home") : goEmployeePortal("home");
      setMessage("تم تسجيل الدخول.", "");
      render();
    } catch (error) {
      await endpoints.adminAccessLog?.({ action: "admin.login.failed", result: "FAILED", metadata: { identifier: state.loginIdentifier } }).catch(() => null);
      state.lastLoginFailed = true;
      setMessage("", error.message || "تعذر تسجيل الدخول.");
      renderLogin();
    }
  });
}

async function renderDashboard() {
  const [dashboardRaw, executiveDaily] = await Promise.all([
    endpoints.dashboard(),
    endpoints.executiveDailyReport().then(unwrap).catch(() => ({ critical: [], counts: {}, requestSummary: {}, notificationMetrics: {}, quality: {} })),
  ]);
  const dashboard = normalizeDashboardPayload(unwrap(dashboardRaw));
  const trends = safeList(dashboard.attendanceTrends);
  const breakdown = safeList(dashboard.attendanceBreakdown);
  const latestEvents = safeList(dashboard.latestEvents);
  const latestAudit = safeList(dashboard.latestAudit);
  const workflowLatest = safeList(dashboard.workflowLatest);
  const readiness = dashboard.readiness || dashboard.executive?.readiness || { score: 0, grade: "-", parts: [] };
  const workflow = dashboard.executive?.workflow || { pending: 0, approved: 0, rejected: 0, stale: 0, byKind: [] };
  const max = Math.max(1, ...trends.map((item) => Number(item.present || 0) + Number(item.late || 0) + Number(item.mission || 0)));
  shell(
    `<section class="grid dashboard-grid executive-dashboard">
      ${safeList(dashboard.metrics).map((metric) => `<article class="metric"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.helper || "")}</small></article>`).join("")}
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>لوحة تنفيذية ذكية</h2><p>مؤشر الجاهزية، الطلبات العالقة، ومراجعات الحضور في شاشة واحدة.</p></div><div class="score-ring"><strong>${escapeHtml(readiness.score || 0)}%</strong><span>${escapeHtml(readiness.grade || "-")}</span></div></div>
        <div class="readiness-grid">${safeList(readiness.parts).map((part) => `<div class="readiness-item ${part.ok ? "ok" : "warn"}"><strong>${escapeHtml(part.label)}</strong><span>${escapeHtml(part.detail || "")}</span><small>${escapeHtml(part.score || 0)} نقطة</small></div>`).join("")}</div>
      </article>
      <article class="panel span-12 executive-daily-strip">
        <div class="panel-head"><div><h2>تقرير اليوم التنفيذي</h2><p>بيانات حية من الحضور، طلبات الموقع، الإشعارات، وجودة بيانات الموظفين.</p></div><div class="toolbar"><button class="button ghost" data-route="executive-mobile">غرفة المدير التنفيذي</button><button class="button ghost" data-route="quality-center">جودة البيانات</button></div></div>
        <div class="metric-grid">
          ${metric("حاضر", executiveDaily.counts?.present ?? 0, "اليوم")}
          ${metric("غائب", executiveDaily.counts?.absent ?? 0, "اليوم")}
          ${metric("موقع معلق", executiveDaily.counts?.pendingLiveLocations ?? 0, "طلبات مباشرة")}
          ${metric("طلبات HR", executiveDaily.requestSummary?.pending ?? 0, "بانتظار إجراء")}
          ${metric("إشعارات عاجلة", executiveDaily.notificationMetrics?.actionRequired ?? 0, "مطلوب إجراء")}
          ${metric("مشاكل بيانات", executiveDaily.quality?.issues ?? 0, "موظفين/Push/مدير")}
        </div>
        ${table(["النوع", "الموظف", "التفاصيل", "فتح"], safeList(executiveDaily.critical).slice(0, 12).map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${escapeHtml(item.title || "-")}</td><td><button class="button ghost" data-route="${escapeHtml(item.route || 'quality-center')}">فتح</button></td></tr>`))}
      </article>
      <article class="panel span-7">
        <div class="panel-head"><div><h2>توزيع الحضور حسب القسم</h2><p>مقارنة تشغيلية سريعة</p></div><span>اليوم</span></div>
        <div class="chart">${trends.map((item) => `<div class="bar"><div class="bar-fill" style="height:${((Number(item.present || 0) + Number(item.late || 0) + Number(item.mission || 0)) / max) * 150}px"></div><span>${escapeHtml(item.label)}</span></div>`).join("") || `<div class="empty-state">لا توجد بيانات اتجاهات بعد.</div>`}</div>
      </article>
      <article class="panel span-5">
        <div class="panel-head"><div><h2>ملخص الطلبات</h2><p>Workflow الموافقات</p></div><button class="button ghost" data-route="requests">فتح المركز</button></div>
        <div class="mini-stats">
          <div><span>معلقة</span><strong>${escapeHtml(workflow.pending || 0)}</strong></div>
          <div><span>متأخرة</span><strong>${escapeHtml(workflow.stale || 0)}</strong></div>
          <div><span>مقبولة</span><strong>${escapeHtml(workflow.approved || 0)}</strong></div>
          <div><span>مرفوضة</span><strong>${escapeHtml(workflow.rejected || 0)}</strong></div>
        </div>
        ${table(["النوع", "الإجمالي", "معلق"], safeList(workflow.byKind).map((item) => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.count)}</td><td>${escapeHtml(item.pending)}</td></tr>`))}
      </article>
      <article class="panel span-8">
        <div class="panel-head"><div><h2>آخر أحداث الحضور</h2><p>آخر الحركات المسجلة</p></div><button class="button ghost" data-route="attendance">فتح الحضور</button></div>
        ${table(["الموظف", "النوع", "الوقت", "المصدر"], latestEvents.map((event) => `<tr><td class="person-cell">${avatar(event.employee, "tiny")}<span>${escapeHtml(event.employee?.fullName || event.employeeId || "-")}</span></td><td>${badge(event.type)}</td><td>${date(event.eventAt)}</td><td>${escapeHtml(event.source || "-")}</td></tr>`))}
      </article>
      <article class="panel span-4">
        <div class="panel-head"><div><h2>طلبات تحتاج قرار</h2><p>آخر عناصر مركز الطلبات</p></div><button class="button ghost" data-route="requests">مراجعة</button></div>
        ${table(["الطلب", "الموظف", "الحالة"], workflowLatest.map((item) => `<tr><td>${escapeHtml(item.kindLabel || item.kind)}<br><small>${escapeHtml(item.label || "")}</small></td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${badge(item.status)}</td></tr>`))}
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>آخر عمليات النظام</h2><p>Audit Log</p></div><button class="button ghost" data-route="audit">عرض الكل</button></div>
        ${table(["العملية", "الكيان", "الوقت"], latestAudit.map((item) => `<tr><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entityType)}</td><td>${date(item.createdAt)}</td></tr>`))}
      </article>
    </section>`,
    "لوحة المتابعة",
    "لوحة قيادة تنفيذية تجمع الحضور والطلبات وجاهزية النظام.",
  );
}


function employeeFilters(ref) {
  return `
    <form class="filters" id="employee-filters">
      <input name="q" placeholder="بحث بالاسم أو الهاتف أو البريد أو المسمى الوظيفي" />
      <select name="managerEmployeeId">${optionList(ref.employees.map((item) => ({ id: item.id, name: item.fullName })), "", "كل المديرين")}</select>
    </form>`;
}

function filterEmployees(employees) {
  const values = readForm(app.querySelector("#employee-filters"));
  const q = (values.q || "").trim().toLowerCase();
  return employees.filter((employee) => {
    const text = [employee.fullName, employee.phone, employee.email, employee.jobTitle].join(" ").toLowerCase();
    return (!q || text.includes(q))
      && (!values.managerEmployeeId || employee.managerEmployeeId === values.managerEmployeeId);
  });
}

async function renderEmployees() {
  const [employees, ref] = await Promise.all([endpoints.employees().then(unwrap), referenceData()]);
  shell(
    `<section class="stack employees-control-center">
      <article class="panel">
        <div class="panel-head">
          <div><h2>قائمة الأشخاص والموظفين</h2><p>إدارة بيانات الموظفين، الربط بالحسابات، والتحديث الجماعي من شاشة واحدة.</p></div>
          <div class="toolbar"><button class="button primary" data-action="new-employee">إضافة موظف</button><button class="button ghost" data-export-employees>تصدير CSV</button><button class="button ghost" data-export-employees-xls>Excel</button><button class="button ghost" data-print-employees>طباعة</button></div>
        </div>
        ${employeeFilters(ref)}
        <div class="bulk-bar advanced-bulk" id="employees-bulk-bar">
          <label class="check-row"><input type="checkbox" id="employee-select-all" /> تحديد النتائج الظاهرة</label>
          <span id="employee-selected-count">لم يتم تحديد موظفين</span>
          <select id="bulk-status"><option value="ACTIVE">تنشيط</option><option value="SUSPENDED">إيقاف مؤقت</option><option value="TERMINATED">إنهاء خدمة</option></select>
          <button class="button ghost" data-bulk-employee-status disabled>تطبيق الحالة</button>
          <select id="bulk-department"><option value="">نقل لقسم...</option>${optionList(ref.departments)}</select>
          <select id="bulk-manager"><option value="">تغيير المدير...</option>${optionList(ref.employees.map((item) => ({ id: item.id, name: item.fullName })))}</select>
          <button class="button ghost" data-bulk-employee-assign disabled>تطبيق النقل</button>
          <button class="button ghost" data-bulk-employee-notify disabled>إرسال تنبيه</button>
          <button class="button danger ghost" data-bulk-employee-delete disabled>حذف منطقي</button>
        </div>
        <div id="employees-list" class="people-grid"></div>
      </article>
      <article id="employee-editor" class="panel hidden"></article>
    </section>`,
    "الأشخاص والموظفون",
    "ملفات فعلية قابلة للإضافة والتعديل والربط والحذف المنطقي والتحديث الجماعي.",
  );

  const selectedEmployees = new Set();
  const selectedCountText = () => selectedEmployees.size ? `تم تحديد ${selectedEmployees.size} موظف` : "لم يتم تحديد موظفين";
  const updateBulkBar = () => {
    const count = selectedEmployees.size;
    app.querySelector("#employee-selected-count").textContent = selectedCountText();
    app.querySelectorAll("[data-bulk-employee-delete],[data-bulk-employee-status],[data-bulk-employee-assign],[data-bulk-employee-notify]").forEach((button) => { button.disabled = count === 0; });
  };
  const selectedIds = () => [...selectedEmployees];
  const runBulk = async (body, success) => {
    const result = await endpoints.bulkEmployeeAction({ ids: selectedIds(), ...body });
    setMessage(`${success} — تم تحديث ${result.updated || 0} موظف.`, "");
    render();
  };

  const draw = () => {
    const filtered = filterEmployees(employees);
    const visibleIds = new Set(filtered.map((employee) => employee.id));
    [...selectedEmployees].forEach((id) => { if (!visibleIds.has(id)) selectedEmployees.delete(id); });
    app.querySelector("#employees-list").innerHTML = filtered.map((employee) => `
      <article class="person-card executive-person-card ${selectedEmployees.has(employee.id) ? "is-selected" : ""}">
        <div class="card-selection"><input type="checkbox" data-select-employee="${employee.id}" ${selectedEmployees.has(employee.id) ? "checked" : ""} /></div>
        <div class="card-header">
          <div class="avatar-wrapper" data-view="${employee.id}">
            ${avatar(employee, "large")}
            <div class="status-badge-corner">${badge(employee.status || "ACTIVE")}</div>
          </div>
        </div>
        <div class="card-body">
          <h3 class="emp-name">${escapeHtml(employee.fullName)}</h3>
          <p class="emp-job">${escapeHtml(employee.jobTitle || "موظف")}</p>
          <div class="emp-details-grid">
            <div class="detail-item"><span>الهاتف</span><strong>${escapeHtml(employee.phone || "-")}</strong></div>
            <div class="detail-item"><span>القسم</span><strong>${escapeHtml(employee.department?.name || "-")}</strong></div>
            <div class="detail-item full"><span>البريد</span><strong>${escapeHtml(employee.email || "-")}</strong></div>
            <div class="detail-item full"><span>المدير</span><strong>${escapeHtml(employee.manager?.fullName || "بدون")}</strong></div>
          </div>
        </div>
        <div class="card-footer-actions">
          <button class="button primary" data-view="${employee.id}">عرض</button>
          <button class="button ghost" data-edit="${employee.id}">تعديل</button>
          <button class="button danger ghost" data-delete="${employee.id}">حذف</button>
        </div>
      </article>
    `).join("") || `<div class="empty-box">لا توجد نتائج مطابقة.</div>`;
    bindEmployeeActions(ref);
    app.querySelectorAll("[data-select-employee]").forEach((input) => input.addEventListener("change", () => {
      if (input.checked) selectedEmployees.add(input.dataset.selectEmployee);
      else selectedEmployees.delete(input.dataset.selectEmployee);
      input.closest(".person-card")?.classList.toggle("is-selected", input.checked);
      updateBulkBar();
    }));
    const selectAll = app.querySelector("#employee-select-all");
    if (selectAll) selectAll.checked = filtered.length > 0 && filtered.every((employee) => selectedEmployees.has(employee.id));
    updateBulkBar();
  };

  app.querySelector("#employee-filters").addEventListener("input", debounce(draw, 250));
  app.querySelector("#employee-select-all").addEventListener("change", (event) => {
    const filtered = filterEmployees(employees);
    filtered.forEach((employee) => event.target.checked ? selectedEmployees.add(employee.id) : selectedEmployees.delete(employee.id));
    draw();
  });
  app.querySelector("[data-bulk-employee-delete]").addEventListener("click", async () => {
    if (!await confirmAction({ title: "حذف منطقي جماعي", message: `سيتم حذف ${selectedEmployees.size} موظف منطقيًا وتعطيل حساباتهم المرتبطة.`, confirmLabel: "حذف المحدد", danger: true })) return;
    await runBulk({ action: "delete" }, "تم الحذف المنطقي الجماعي");
  });
  app.querySelector("[data-bulk-employee-status]").addEventListener("click", async () => {
    const status = app.querySelector("#bulk-status")?.value || "ACTIVE";
    await runBulk({ action: "status", status }, "تم تغيير الحالة الجماعية");
  });
  app.querySelector("[data-bulk-employee-assign]").addEventListener("click", async () => {
    const departmentId = app.querySelector("#bulk-department")?.value || undefined;
    const managerEmployeeId = app.querySelector("#bulk-manager")?.value || undefined;
    if (!departmentId && !managerEmployeeId) return setMessage("", "اختر قسمًا أو مديرًا قبل تطبيق النقل.");
    await runBulk({ action: "assign", departmentId, managerEmployeeId }, "تم تطبيق النقل الجماعي");
  });
  app.querySelector("[data-bulk-employee-notify]").addEventListener("click", async () => {
    const message = await askText({ title: "تنبيه جماعي", message: "اكتب نص التنبيه الذي سيصل للموظفين المحددين.", defaultValue: "يرجى مراجعة الإدارة عند التفرغ.", confirmLabel: "إرسال التنبيه", required: true });
    if (!message) return;
    await runBulk({ action: "notify", title: "تنبيه من إدارة الجمعية", message }, "تم إرسال التنبيه الجماعي");
  });
  app.querySelector('[data-action="new-employee"]').addEventListener("click", () => showEmployeeEditor(ref));
  const employeeExportRows = () => filterEmployees(employees).map((e) => [e.fullName, e.phone, e.email, e.jobTitle, e.department?.name, e.manager?.fullName || "", e.status || ""]);
  const employeeExportHeaders = ["الاسم","الهاتف","البريد","المسمى الوظيفي","القسم","المدير المباشر", "الحالة"];
  app.querySelector("[data-export-employees]").addEventListener("click", () => downloadFile("employees.csv", `\ufeff${toCsv([employeeExportHeaders, ...employeeExportRows()])}`, "text/csv;charset=utf-8"));
  app.querySelector("[data-export-employees-xls]").addEventListener("click", () => exportHtmlTable("employees.xls", employeeExportHeaders, employeeExportRows()));
  app.querySelector("[data-print-employees]").addEventListener("click", () => printReport("تقرير الموظفين", employeeExportHeaders, employeeExportRows()));
  draw();
}


function bindEmployeeActions(ref) {
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => (location.hash = `employee-profile?id=${button.dataset.view}`)));
  app.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", async () => showEmployeeEditor(ref, await endpoints.employee(button.dataset.edit))));
  app.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!await confirmAction({ title: "حذف موظف", message: "سيتم حذف الموظف منطقيًا وتعطيل حسابه المرتبط دون حذف السجل التاريخي.", confirmLabel: "حذف منطقي", danger: true })) return;
    await endpoints.deleteEmployee(button.dataset.delete);
    setMessage("تم حذف الموظف منطقيًا.", "");
    render();
  }));
}

function defaultEmployeeRefs(ref = {}, employee = null) {
  const defaultBranch = ref.branches?.[0] || {};
  const defaultRole = ref.roles?.find((role) => ["employee", "role-employee", "staff"].includes(String(role.slug || role.key || "").toLowerCase())) || ref.roles?.at(-1) || {};
  return {
    roleId: employee?.roleId || defaultRole.id || "",
    branchId: employee?.branchId || defaultBranch.id || "",
    governorateId: employee?.governorateId || defaultBranch.governorateId || ref.governorates?.[0]?.id || "",
    complexId: employee?.complexId || defaultBranch.complexId || ref.complexes?.[0]?.id || "",
    status: "ACTIVE",
  };
}

function showEmployeeEditor(ref, employee = null) {
  const editor = app.querySelector("#employee-editor");
  const defaults = defaultEmployeeRefs(ref, employee);
  const managerOptions = ref.employees
    .filter((item) => item.id !== employee?.id)
    .map((item) => ({ id: item.id, name: `${item.fullName}${item.jobTitle ? " — " + item.jobTitle : ""}` }));
  editor.classList.remove("hidden");
  editor.innerHTML = `
    <div class="panel-head"><div><h2>${employee ? "تعديل موظف" : "إضافة موظف جديد"}</h2><p>كل تعديل يتم حفظه فورًا. في الوضع المحلي يُحفظ داخل المتصفح، وفي Supabase يُحفظ في قاعدة البيانات.</p></div><button class="button ghost" data-close-editor>إغلاق</button></div>
    <form id="employee-form" class="editor-grid" data-password-policy="none">
      <div class="photo-box"><div id="photo-preview">${avatar(employee || { fullName: "موظف جديد" })}</div><label>الصورة الشخصية<input name="photo" type="file" accept="image/*" /></label></div>
      <label>الاسم الكامل<input name="fullName" required value="${escapeHtml(employee?.fullName || "")}" /></label>
      <label>رقم الموبايل<input name="phone" value="${escapeHtml(employee?.phone || "")}" /></label>
      <label>البريد الإلكتروني<input name="email" type="email" required value="${escapeHtml(employee?.email || "")}" placeholder="name@ahla-shabab.org" /></label>
      <label>المسمى الوظيفي<input name="jobTitle" value="${escapeHtml(employee?.jobTitle || "")}" /></label>
      <label>المدير المباشر<select name="managerEmployeeId">${optionList(managerOptions, employee?.managerEmployeeId, "بدون مدير")}</select></label>
      <input type="hidden" name="roleId" value="${escapeHtml(defaults.roleId)}" />
      <input type="hidden" name="branchId" value="${escapeHtml(defaults.branchId)}" />
      <input type="hidden" name="governorateId" value="${escapeHtml(defaults.governorateId)}" />
      <input type="hidden" name="complexId" value="${escapeHtml(defaults.complexId)}" />
      <input type="hidden" name="status" value="ACTIVE" />
      ${employee ? `<label class="check-row"><input type="checkbox" name="createUser" /> إنشاء حساب مستخدم إذا لم يكن مرتبطًا</label><label>كلمة مرور مؤقتة جديدة<input name="password" value="" placeholder="اتركه فارغًا إن لم تنشئ حسابًا" /></label>` : `<label class="check-row"><input type="checkbox" name="createUser" checked /> إنشاء حساب مستخدم مرتبط</label><label>كلمة مرور مؤقتة<input name="password" value="" placeholder="اتركه فارغًا لاستخدام رقم الهاتف ككلمة مرور" /></label>`}
      <div class="message compact span-2">البريد الإلكتروني مطلوب لإنشاء حساب. يتم إنشاء الحساب من لوحة HR فقط. عند ترك كلمة المرور فارغة تصبح كلمة المرور الافتراضية هي رقم الهاتف/الرقم الشخصي المسجل.</div>
      <div class="form-actions wide"><button class="button primary" type="submit">حفظ الملف</button></div>
    </form>
  `;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  const photoInput = editor.querySelector('[name="photo"]');
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const url = await endpoints.uploadAvatar(file);
    editor.querySelector("#photo-preview").innerHTML = `<img class="avatar large" src="${escapeHtml(url)}" alt="" />`;
    photoInput.dataset.uploadedUrl = url;
    setMessage("تم تجهيز الصورة وضغطها. اضغط حفظ الملف لتثبيتها.", "");
  });
  editor.querySelector("[data-close-editor]").addEventListener("click", () => editor.classList.add("hidden"));
  editor.querySelector("#employee-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const values = readForm(event.currentTarget);
      values.photoUrl = photoInput.dataset.uploadedUrl || employee?.photoUrl || "";
      values.status = "ACTIVE";
      delete values.photo;
      if (employee) await endpoints.updateEmployee(employee.id, values);
      else await endpoints.createEmployee(values);
      setMessage(employee ? "تم تعديل ملف الموظف وحفظه." : "تم إنشاء ملف الموظف وحساب الدخول. كلمة المرور الافتراضية هي رقم الهاتف/الرقم الشخصي المسجل.", "");
      render();
    } catch (error) {
      setMessage("", error.message);
      render();
    }
  });
}

async function renderEmployeeProfile() {
  const employee = await endpoints.employee(routeParams().get("id"));
  const attachments = await endpoints.attachments?.("EMPLOYEE", employee.id).catch(() => employee.attachments || []) || employee.attachments || [];
  const totalLate = (employee.attendanceDaily || []).reduce((sum, item) => sum + Number(item.lateMinutes || 0), 0);
  const locations = await endpoints.locations().then(unwrap).catch(() => []);
  const latestLocation = (locations || []).filter((item) => item.employeeId === employee.id && item.latitude && item.longitude).sort((a, b) => new Date(b.date || b.requestedAt || 0) - new Date(a.date || a.requestedAt || 0))[0];
  shell(
    `<section class="profile-layout">
      <article class="panel profile-card">
        ${avatar(employee, "large")}
        <h2>${escapeHtml(employee.fullName)}</h2>
        <p>${escapeHtml(employee.jobTitle || "-")}</p>
        <div class="profile-actions"><button class="button" data-route="employees">رجوع للقائمة</button></div>
      </article>
      <article class="panel profile-details">
        <div class="panel-head"><h2>الموقع الحالي</h2></div>
        <div class="status-location-card">
          <strong>آخر موقع مسجل</strong>
          <p>${latestLocation ? `آخر موقع مرسل: ${date(latestLocation.date || latestLocation.requestedAt)}` : "لم يرسل الموظف موقعًا حديثًا بعد."}</p>
          ${latestLocation ? `<div class="meta-grid"><span>المكان: ${escapeHtml(locationPlaceLabel(latestLocation))}</span><span>الدقة: ${escapeHtml(latestLocation.accuracyMeters || "-")} متر</span><span>الحالة: ${escapeHtml(locationStatusText(latestLocation))}</span><span>المصدر: ${escapeHtml(latestLocation.source || latestLocation.purpose || "-")}</span></div><a class="button ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${escapeHtml(latestLocation.latitude)},${escapeHtml(latestLocation.longitude)}">فتح على الخريطة</a>` : ""}
        </div>
      </article>
      <article class="panel profile-details">
        <div class="panel-head"><h2>البيانات الأساسية</h2><span>${escapeHtml(employee.jobTitle || "")}</span></div>
        ${table(["البند", "القيمة"], [
          ["الهاتف", employee.phone], ["البريد", employee.email], ["المسمى الوظيفي", employee.jobTitle], ["المدير المباشر", employee.manager?.fullName], ["حساب المستخدم", employee.user ? employee.user.email : "غير مرتبط"], ["إجمالي التأخير", `${totalLate} دقيقة`],
        ].map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value || "-")}</td></tr>`))}
      </article>
      <article class="panel span-4"><h2>الحضور اليومي</h2>${table(["اليوم", "الحالة", "تأخير"], (employee.attendanceDaily || []).map((item) => `<tr><td>${dateOnly(item.date)}</td><td>${badge(item.status)}</td><td>${escapeHtml(item.lateMinutes || 0)} د</td></tr>`))}</article>
      <article class="panel span-4"><h2>المأموريات</h2>${table(["العنوان", "الحالة"], (employee.missions || []).map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${badge(item.status)}</td></tr>`))}</article>
      <article class="panel span-4"><h2>الإجازات والاستثناءات</h2>${table(["النوع", "الحالة"], [...(employee.leaves || []).map((item) => ({ name: item.leaveType?.name, status: item.status })), ...(employee.exceptions || []).map((item) => ({ name: item.title, status: item.status }))].map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${badge(item.status)}</td></tr>`))}</article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>المرفقات</h2><p>عقود، بطاقات، شهادات، أو أي مستند مرتبط بالموظف.</p></div><div class="toolbar"><input type="file" id="employee-attachment" /><button class="button" id="upload-employee-attachment">رفع مرفق</button></div></div>
        ${table(["الملف", "النوع", "الحجم", "التاريخ"], attachments.map((item) => `<tr><td>${item.url || item.filePath ? `<a href="${escapeHtml(item.url || item.filePath)}" target="_blank" rel="noopener">${escapeHtml(item.originalName || item.fileName)} <small>(رابط آمن مؤقت)</small></a>` : escapeHtml(item.originalName || item.fileName)}</td><td>${escapeHtml(item.mimeType || item.scope || "-")}</td><td>${Math.round(Number(item.sizeBytes || 0) / 1024)} KB</td><td>${date(item.createdAt)}</td></tr>`))}
      </article>
    </section>`,
    "ملف الموظف",
    "مركز موحد للبيانات الأساسية والحضور والطلبات.",
  );
  app.querySelector("[data-route=employees]")?.addEventListener("click", () => { location.hash = "employees"; });
  app.querySelector("#upload-employee-attachment")?.addEventListener("click", async () => {
    const file = app.querySelector("#employee-attachment")?.files?.[0];
    if (!file) return setMessage("", "اختر ملفًا أولًا.");
    await endpoints.uploadAttachment(file, { scope: "EMPLOYEE", entityId: employee.id, employeeId: employee.id });
    setMessage("تم رفع المرفق.", "");
    render();
  });
}

async function renderUsers() {
  const [users, ref] = await Promise.all([endpoints.users().then(unwrap), referenceData()]);
  shell(
    `<section class="stack users-lite-page">
      <article class="panel">
        <div class="panel-head"><div><h2>إدارة المستخدمين</h2><p>شاشة مبسطة مثل الموظفين: الاسم، البريد، الصورة، والموظف المرتبط فقط. الصلاحيات تُستمد تلقائيًا من ملف الموظف أو تبقى كما هي عند التعديل.</p></div><div class="toolbar"><button class="button ghost" data-autolink-users>ربط تلقائي حسب البريد</button><button class="button primary" data-new-user>إضافة مستخدم</button></div></div>
        <form class="filters" id="user-filters"><input name="q" placeholder="بحث بالاسم أو البريد أو الموظف المرتبط" /></form>
        <div id="users-table"></div>
      </article>
      <article id="user-editor" class="panel hidden"></article>
    </section>`,
    "المستخدمون",
    "إدارة حسابات الدخول بشكل مبسط بدون فرع أو قسم أو كود أو دوام.",
  );
  const draw = () => {
    const values = readForm(app.querySelector("#user-filters"));
    const q = (values.q || "").toLowerCase();
    const filtered = users.filter((user) => !q || [user.name, user.fullName, user.email, user.employee?.fullName].join(" ").toLowerCase().includes(q));
    app.querySelector("#users-table").innerHTML = table(["المستخدم", "الموظف المرتبط", "آخر دخول", "الحالة", "إجراءات"], filtered.map((user) => `
      <tr>
        <td class="person-cell">${avatar(userAvatarSubject(user), "tiny")}<span>${escapeHtml(user.name || user.fullName || "مستخدم")}<small>${escapeHtml(user.email)}</small></span></td>
        <td>${escapeHtml(user.employee?.fullName || "غير مرتبط")}</td>
        <td>${date(user.lastLoginAt)}</td>
        <td>${badge(user.status || "ACTIVE")} ${user.temporaryPassword ? badge("INVITED") : ""}</td>
        <td><button class="button ghost" data-edit-user="${user.id}">تعديل</button><button class="button ghost" data-toggle-user="${user.id}">${user.status === "ACTIVE" ? "تعطيل" : "تنشيط"}</button></td>
      </tr>`));
    bindUserActions(ref, users);
  };
  app.querySelector("#user-filters").addEventListener("input", debounce(draw, 250));
  app.querySelector("[data-new-user]").addEventListener("click", () => showUserEditor(ref));
  app.querySelector("[data-autolink-users]").addEventListener("click", async () => {
    try {
      const result = await endpoints.autoLinkUsersByEmail();
      setMessage(`تم الربط التلقائي: ${result.linked || 0} مستخدم/موظف.`, "");
      render();
    } catch (error) {
      setMessage("", error.message || "تعذر الربط التلقائي.");
      render();
    }
  });
  draw();
}

function bindUserActions(ref, users = []) {
  app.querySelectorAll("[data-edit-user]").forEach((button) => button.addEventListener("click", () => {
    showUserEditor(ref, users.find((user) => user.id === button.dataset.editUser));
  }));
  app.querySelectorAll("[data-toggle-user]").forEach((button) => button.addEventListener("click", async () => {
    const user = users.find((item) => item.id === button.dataset.toggleUser);
    if (!user) return setMessage("", "تعذر العثور على المستخدم المطلوب.");
    await endpoints.setUserStatus(user.id, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE");
    setMessage("تم تحديث حالة المستخدم.", "");
    render();
  }));
}

function userDefaultsFromEmployee(ref, user = null) {
  const linkedEmployee = (ref.employees || []).find((employee) => employee.id === user?.employeeId);
  const fallbackRole = ref.roles?.find((role) => ["employee", "role-employee", "staff"].includes(String(role.slug || role.key || role.id || "").toLowerCase())) || ref.roles?.at(-1) || {};
  return {
    roleId: user?.roleId || linkedEmployee?.roleId || fallbackRole.id || "",
    branchId: user?.branchId || linkedEmployee?.branchId || ref.branches?.[0]?.id || "",
    departmentId: user?.departmentId || linkedEmployee?.departmentId || ref.departments?.[0]?.id || "",
    governorateId: user?.governorateId || linkedEmployee?.governorateId || ref.governorates?.[0]?.id || "",
    complexId: user?.complexId || linkedEmployee?.complexId || ref.complexes?.[0]?.id || "",
    status: user?.status || "ACTIVE",
  };
}

function showUserEditor(ref, user = null) {
  const editor = app.querySelector("#user-editor");
  const defaults = userDefaultsFromEmployee(ref, user);
  editor.classList.remove("hidden");
  editor.innerHTML = `
    <div class="panel-head"><div><h2>${user ? "تعديل مستخدم" : "إضافة مستخدم"}</h2><p>لا تحتاج لاختيار فرع أو قسم أو دور يدويًا. اربط الحساب بالموظف وسيتم ضبط البيانات الأساسية تلقائيًا.</p></div><button class="button ghost" data-close-user>إغلاق</button></div>
    <form id="user-form" class="editor-grid simplified-user-form" data-password-policy="none">
      <div class="photo-box user-avatar-editor">
        <div id="user-avatar-preview">${avatar(userAvatarSubject(user || { name: "مستخدم جديد" }), "large")}</div>
        <label>صورة المستخدم<input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
        <small>الصورة اختيارية وتظهر في الشريط العلوي وجدول المستخدمين.</small>
      </div>
      <label>الاسم<input name="name" required value="${escapeHtml(user?.name || user?.fullName || "")}" /></label>
      <label>البريد<input name="email" type="email" required value="${escapeHtml(user?.email || "")}" /></label>
      <label>الموظف المرتبط<select name="employeeId">${optionList(ref.employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })), user?.employeeId, "بدون")}</select></label>
      <label>كلمة المرور المؤقتة<input name="password" value="" placeholder="${user ? "اتركه فارغًا للإبقاء عليها" : "اتركه فارغًا لاستخدام رقم هاتف الموظف"}" /></label>
      <input type="hidden" name="roleId" value="${escapeHtml(defaults.roleId)}" />
      <input type="hidden" name="branchId" value="${escapeHtml(defaults.branchId)}" />
      <input type="hidden" name="departmentId" value="${escapeHtml(defaults.departmentId)}" />
      <input type="hidden" name="governorateId" value="${escapeHtml(defaults.governorateId)}" />
      <input type="hidden" name="complexId" value="${escapeHtml(defaults.complexId)}" />
      <input type="hidden" name="status" value="${escapeHtml(defaults.status)}" />
      <label class="check-row"><input type="checkbox" name="temporaryPassword" ${user?.temporaryPassword ?? true ? "checked" : ""} /> كلمة مرور مؤقتة</label>
      <label class="check-row"><input type="checkbox" name="passkeyEnabled" ${user?.passkeyEnabled ? "checked" : ""} /> Passkey مفعلة</label>
      <div class="message compact span-2">تم حذف حقول الفرع، القسم، المحافظة، المجمع، الدور، والكود من شاشة المستخدمين. يتم ضبطها داخليًا فقط لتوافق قاعدة البيانات.</div>
      <div class="form-actions wide"><button class="button primary" type="submit">حفظ المستخدم</button></div>
    </form>
  `;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  const avatarInput = editor.querySelector('[name="avatar"]');
  const employeeSelect = editor.querySelector('[name="employeeId"]');
  const refreshHiddenDefaults = () => {
    const linkedEmployee = (ref.employees || []).find((employee) => employee.id === employeeSelect?.value);
    if (!linkedEmployee) return;
    editor.querySelector('[name="roleId"]').value = linkedEmployee.roleId || defaults.roleId || "";
    editor.querySelector('[name="branchId"]').value = linkedEmployee.branchId || defaults.branchId || "";
    editor.querySelector('[name="departmentId"]').value = linkedEmployee.departmentId || defaults.departmentId || "";
    editor.querySelector('[name="governorateId"]').value = linkedEmployee.governorateId || defaults.governorateId || "";
    editor.querySelector('[name="complexId"]').value = linkedEmployee.complexId || defaults.complexId || "";
  };
  employeeSelect?.addEventListener("change", refreshHiddenDefaults);
  avatarInput?.addEventListener("change", async () => {
    try {
      const file = avatarInput.files?.[0];
      if (!file) return;
      const url = await endpoints.uploadAvatar(file);
      editor.querySelector("#user-avatar-preview").innerHTML = `<img class="avatar large" src="${escapeHtml(url)}" alt="صورة المستخدم" />`;
      avatarInput.dataset.uploadedUrl = url;
      setMessage("تم تجهيز صورة المستخدم. اضغط حفظ المستخدم لتثبيتها.", "");
    } catch (error) {
      setMessage("", error.message);
    }
  });
  editor.querySelector("[data-close-user]").addEventListener("click", () => editor.classList.add("hidden"));
  editor.querySelector("#user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      refreshHiddenDefaults();
      const values = readForm(event.currentTarget);
      values.avatarUrl = avatarInput?.dataset?.uploadedUrl || user?.avatarUrl || user?.photoUrl || "";
      delete values.avatar;
      if (!values.password) delete values.password;
      if (user) await endpoints.updateUser(user.id, values);
      else await endpoints.createUser(values);
      setMessage(user ? "تم تعديل المستخدم." : "تم إنشاء المستخدم.", "");
      render();
    } catch (error) {
      setMessage("", error.message);
      render();
    }
  });
}

async function enableBrowserNotifications() {
  await enableWebPushSubscription(endpoints);
  new Notification("تم تفعيل إشعارات النظام", { body: "سيتم إرسال التنبيهات الحقيقية عند ضبط VAPID و Edge Function." });
}

async function registerBrowserPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) throw new Error("هذا المتصفح أو هذا البروتوكول لا يدعم WebAuthn. استخدم localhost أو HTTPS.");
  const toBase64Url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const userName = state.user?.email || state.user?.fullName || "hr-user";
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "نظام الحضور والانصراف" },
      user: { id: userId, name: userName, displayName: state.user?.fullName || userName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
      timeout: 60000,
      attestation: "none",
    },
  });
  const rawId = toBase64Url(credential.rawId);
  const attestationObject = credential.response?.attestationObject ? toBase64Url(credential.response.attestationObject) : "";
  const clientDataJSON = credential.response?.clientDataJSON ? toBase64Url(credential.response.clientDataJSON) : "";
  const transports = typeof credential.response?.getTransports === "function" ? credential.response.getTransports() : [];
  await endpoints.registerPasskey({ credentialId: rawId, attestationObject, clientDataJSON, transports, label: "مفتاح مرور لهذا الجهاز", platform: navigator.platform || "browser" });
  return rawId;
}

async function requestBrowserPasskeyForPunch() {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("بصمة الإصبع/Passkey غير مدعومة هنا. افتح النظام من موبايل يدعم البصمة أو من Chrome على localhost/HTTPS.");
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let credential;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
      },
    });
  } catch (error) {
    throw new Error("لم يتم تأكيد بصمة الإصبع أو تم إلغاء التحقق.");
  }
  if (!credential?.rawId) throw new Error("لم يتم استلام تأكيد البصمة من الجهاز.");
  return btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cleanAddressText(value = "") {
  const text = String(value || "").replace(/https?:\/\/\S+/gi, "").replace(/Google Maps\s*[:：]?/gi, "").replace(/[—-]\s*$/g, "").trim();
  return text || "مجمع منيل شيحة";
}

function mapsUrlForAddress(address = {}) {
  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function renderEmployeePunch() {
  let address;
  let events = [];
  try {
    [address, events] = await Promise.all([
      endpoints.attendanceAddress().then(unwrap),
      endpoints.myAttendanceEvents().then(unwrap).catch(() => []),
    ]);
  } catch (error) {
    shell(
      `<section class="panel empty-state-panel">
        <h2>لا يمكن فتح بصمة الموظف لهذا الحساب</h2>
        <p>${escapeHtml(error.message || "هذا الحساب غير مرتبط بملف موظف.")}</p>
        <div class="message warning">اربط هذا المستخدم بموظف من صفحة المستخدمين، أو افتح صفحة الأشخاص والموظفين وأنشئ ملف موظف بنفس البريد الإلكتروني.</div>
        <div class="toolbar spaced">
          <button class="button primary" data-route="users">فتح المستخدمين</button>
          <button class="button ghost" data-route="employees">فتح الموظفين</button>
          <button class="button ghost" data-route="route-access">فحص الصلاحيات</button>
        </div>
      </section>`,
      "بصمة الموظف",
      "يلزم ربط الحساب بملف موظف قبل تسجيل الحضور والانصراف.",
    );
    return;
  }
  const employee = address.employee || state.user?.employee || {};
  const branch = address.branch || employee.branch || {};
  const employeeEvents = (events || []).filter((event) => event.employeeId === employee.id).slice(0, 10);
  shell(
    `<section class="grid punch-page">
      <article class="panel span-6 punch-hero">
        <div class="person-cell large">${avatar(employee, "large")}<span><strong>${escapeHtml(employee.fullName || state.user?.fullName || "الموظف")}</strong><small>${escapeHtml(employee.jobTitle || "")}</small></span></div>
        <div class="address-card">
          <h2>نطاق المجمع المعتمد للبصمة</h2>
          <p>${escapeHtml(branch.name || "مجمع غير محدد")}</p>
          <strong>${escapeHtml(cleanAddressText(address.address || branch.address || "مجمع منيل شيحة"))}</strong>
          <div class="meta-grid">
            <span>المكان: ${escapeHtml(cleanAddressText(address.address || branch.address || "مجمع منيل شيحة"))}</span>
            <span>الحالة: نطاق بصمة معتمد</span>
            <span>النطاق: ${escapeHtml(address.radiusMeters || branch.radiusMeters || 300)} متر</span>
            <span>أقصى دقة GPS: ${escapeHtml(address.maxAccuracyMeters || 500)} متر</span>
          </div>
          ${mapsUrlForAddress(address) ? `<a class="button ghost map-open-btn" target="_blank" rel="noopener" href="${escapeHtml(mapsUrlForAddress(address))}">فتح المجمع على Google Maps</a>` : ""}
        </div>
        <label>ملاحظات اختيارية<input id="self-punch-notes" placeholder="مثال: حضور من البوابة الرئيسية" /></label>
        <div class="biometric-box"><strong>التحقق المطلوب: بصمة الإصبع / Passkey</strong><p>لا يتم استخدام صورة سيلفي. عند الضغط على حضور أو انصراف سيطلب المتصفح بصمة الجهاز أولًا، ثم يقرأ GPS ويحفظ الموقع مع البصمة.</p><button class="button ghost" type="button" data-register-passkey>تسجيل/تحديث بصمة الجهاز</button></div>
        <div class="toolbar spaced punch-actions">
          <button class="button ghost" data-test-location>اختبار موقعي</button>
          <button class="button primary" data-self-punch="checkIn">بصمة حضور</button>
          <button class="button" data-self-punch="checkOut">بصمة انصراف</button>
        </div>
        <div id="self-punch-result" class="risk-box ${address.hasConfiguredAddress === false ? "" : "hidden"}">${address.hasConfiguredAddress === false ? "يجب ضبط إحداثيات المجمع قبل السماح بالبصمة." : ""}</div>
      </article>
      <article class="panel span-6 latest-punches-panel">
        <div class="panel-head"><div><h2>آخر بصماتي</h2><p>الحضور والانصراف لا يُحفظان إلا داخل نطاق المجمع، وأي محاولة مرفوضة تُسجل للمراجعة بالسبب والمسافة والدقة.</p></div></div>
        ${table(["النوع", "الموقع", "المسافة", "الدقة", "الوقت"], employeeEvents.map((event) => `<tr><td>${badge(event.type)}</td><td>${badge(event.geofenceStatus || "unknown")}</td><td>${formatMeters(event.distanceFromBranchMeters)}</td><td>${formatMeters(event.accuracyMeters)}</td><td>${date(event.eventAt)}</td></tr>`))}
      </article>
      <article class="panel span-12 guidance-panel">
        <h2>قواعد البصمة</h2>
        <div class="steps"><span>1. افتح الصفحة من الموبايل أو جهاز يدعم Passkey.</span><span>2. اضغط تسجيل/تحديث بصمة الجهاز أول مرة فقط.</span><span>3. عند الحضور أو الانصراف أكّد ببصمة الإصبع.</span><span>4. اسمح للمتصفح بقراءة GPS.</span><span>5. طالما أنت داخل المجمع يتم حفظ البصمة حتى لو قبل أو بعد وقت الدوام الرسمي 10ص إلى 6م.</span></div>
      </article>
    </section>`,
    "بصمة الموظف",
    "تسجيل حضور وانصراف ذاتي داخل نطاق المجمع فقط.",
  );
  const resultBox = app.querySelector("#self-punch-result");
  app.querySelector("[data-register-passkey]")?.addEventListener("click", async () => {
    try {
      await registerBrowserPasskey();
      setMessage("تم تسجيل بصمة الجهاز/Passkey بنجاح.", "");
    } catch (error) {
      setMessage("", error.message);
    }
  });
  const showResult = (title, evaluation = {}, error = false) => {
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="toolbar spaced">${badge(evaluation.geofenceStatus || evaluation.status || "unknown")}${evaluation.allowed || evaluation.canRecord ? badge("APPROVED") : badge("REJECTED")}</div><p>${escapeHtml(evaluation.message || evaluation.blockReason || "")}</p>${evaluation.distanceFromBranchMeters != null || evaluation.distanceMeters != null ? `<p>المسافة عن العنوان: ${escapeHtml(evaluation.distanceFromBranchMeters ?? evaluation.distanceMeters)} متر.</p>` : ""}`;
    resultBox.classList.toggle("danger-box", Boolean(error));
  };
  const logRejectedPunch = async (action, current = {}, evaluation = {}, reason = "") => {
    try {
      await endpoints.recordPunchRejection({
        employeeId: employee.id,
        action,
        ...current,
        geofenceStatus: evaluation.geofenceStatus || "REJECTED",
        distanceFromBranchMeters: evaluation.distanceFromBranchMeters ?? evaluation.distanceMeters ?? null,
        blockReason: reason || evaluation.blockReason || evaluation.message || "تم رفض البصمة",
        notes: app.querySelector("#self-punch-notes")?.value || "",
      });
    } catch (logError) {
      debugWarn("تعذر تسجيل محاولة البصمة المرفوضة", logError);
    }
  };
  const readLocationAndEvaluate = async () => {
    resultBox.classList.remove("hidden");
    resultBox.textContent = "جاري قراءة الموقع الحالي بدقة عالية...";
    let current = await getBrowserLocation();
    if (current.accuracyMeters == null || Number(current.accuracyMeters) > Number(address.maxAccuracyMeters || 500)) {
      resultBox.textContent = "دقة GPS ضعيفة، جاري إعادة المحاولة خلال ثوانٍ...";
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const retry = await getBrowserLocation();
      if ((Number(retry.accuracyMeters || 999999) < Number(current.accuracyMeters || 999999)) || !current.latitude) current = retry;
    }
    const evaluation = await endpoints.evaluateGeofence({ ...current, employeeId: employee.id });
    showResult(evaluation.allowed || evaluation.canRecord ? "موقعك مقبول للبصمة" : "موقعك غير مقبول للبصمة", evaluation, !(evaluation.allowed || evaluation.canRecord));
    return { current, evaluation };
  };
  app.querySelector("[data-test-location]").addEventListener("click", () => readLocationAndEvaluate().catch((error) => showResult(error.message, { message: error.message }, true)));
  app.querySelectorAll("[data-self-punch]").forEach((button) => button.addEventListener("click", async () => {
    try {
      showResult("جاري تأكيد بصمة الإصبع", { message: "استخدم بصمة الجهاز أو Passkey لإكمال التسجيل.", geofenceStatus: "biometric_pending", allowed: true }, false);
      const passkeyCredentialId = await requestBrowserPasskeyForPunch();
      const { current, evaluation } = await readLocationAndEvaluate();
      if (!evaluation.allowed && !evaluation.canRecord) {
        await logRejectedPunch(button.dataset.selfPunch, current, evaluation);
        setMessage("", evaluation.blockReason || evaluation.message || "تم رفض البصمة خارج نطاق المجمع.");
        return;
      }
      const body = { ...current, notes: app.querySelector("#self-punch-notes").value, verificationStatus: "verified", biometricMethod: "passkey", passkeyCredentialId };
      const response = button.dataset.selfPunch === "checkIn" ? await endpoints.selfCheckIn(body) : await endpoints.selfCheckOut(body);
      showResult(button.dataset.selfPunch === "checkIn" ? "تم تسجيل بصمة الحضور" : "تم تسجيل بصمة الانصراف", response.evaluation || evaluation, false);
      setMessage(button.dataset.selfPunch === "checkIn" ? "تم حفظ بصمة الحضور داخل نطاق المجمع." : "تم حفظ بصمة الانصراف داخل نطاق المجمع.", "");
      await render();
    } catch (error) {
      await logRejectedPunch(button.dataset.selfPunch, {}, { message: error.message, geofenceStatus: "REJECTED" }, error.message);
      showResult("تم رفض البصمة", { message: error.message, geofenceStatus: "REJECTED" }, true);
      setMessage("", error.message);
    }
  }));
}


async function renderAttendance() {
  const filters = attendanceFiltersFromRoute();
  const maxSafeLimit = 2000;
  if (filters.limit > maxSafeLimit) setMessage("السجلات كثيرة جدًا؛ استخدم فترة أضيق أو حدًا أقل من 2000.", "");
  const queryFilters = { ...filters, limit: Math.min(filters.limit + 1, maxSafeLimit) };
  const [employees, eventsPayload] = await Promise.all([endpoints.employees().then(unwrap), endpoints.attendanceEvents(queryFilters).then(unwrap)]);
  const events = filterAttendanceEvents(eventsPayload || [], filters);
  const visibleEvents = events.slice(0, filters.limit);
  const hasMore = events.length > filters.limit || (eventsPayload || []).length >= queryFilters.limit;
  const employeeOptions = employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` }));
  const employeeSelect = optionList(employeeOptions);
  const employeeFilterSelect = optionList(employeeOptions, filters.employeeId, "كل الموظفين");
  const typeFilterSelect = optionList([
    { id: "CHECK_IN", name: "حضور" },
    { id: "CHECK_OUT", name: "انصراف" },
    { id: "MANUAL_ADJUSTMENT", name: "تعديل يدوي" },
    { id: "PRESENT", name: "حاضر" },
    { id: "LATE", name: "متأخر" },
    { id: "MISSION", name: "مأمورية" },
  ], filters.type, "كل الأنواع");
  const reviewFilterSelect = optionList([{ id: "approved", name: "المعتمد فقط" }, { id: "review", name: "يحتاج مراجعة" }], filters.review, "كل حالات المراجعة");
  shell(
    `<section class="grid">
      <article class="panel span-4">
        <div class="panel-head"><div><h2>تسجيل سريع</h2><p>يسجل الحركة مع الموقع الجغرافي وحالة التحقق.</p></div></div>
        <label>الموظف<select id="attendance-employee">${employeeSelect}</select></label>
        <label>ملاحظات<input id="attendance-notes" placeholder="اختياري: سبب أو توضيح" /></label>
        <label>حالة التحقق<select id="attendance-verification"><option value="verified">تم التحقق من الجهاز</option><option value="not_checked">بدون تحقق</option><option value="failed">فشل التحقق</option></select></label>
        <div class="toolbar spaced"><button class="button primary" data-attendance="checkIn">حضور</button><button class="button" data-attendance="checkOut">انصراف</button></div>
        <div id="attendance-result" class="risk-box hidden"></div>
      </article>
      <article class="panel span-8">
        <div class="panel-head"><div><h2>سجل الحضور</h2><p>التحميل الافتراضي آخر 30 يوم لتقليل الحمل، ويمكن توسيع الفترة من الفلاتر.</p></div><div class="toolbar"><button class="button ghost" data-regenerate-attendance>إعادة حساب اليوميات</button><button class="button ghost" data-export-attendance>تصدير CSV</button></div></div>
        <form id="attendance-filters" class="filters attendance-filters">
          <label>من<input name="from" type="date" value="${escapeHtml(filters.from)}" /></label>
          <label>إلى<input name="to" type="date" value="${escapeHtml(filters.to)}" /></label>
          <label>الموظف<select name="employeeId">${employeeFilterSelect}</select></label>
          <label>نوع الحركة<select name="type">${typeFilterSelect}</select></label>
          <label>المراجعة<select name="review">${reviewFilterSelect}</select></label>
          <div class="form-actions"><button class="button primary" type="submit">تطبيق الفلتر</button><button class="button ghost" type="button" data-reset-attendance-filters>آخر 30 يوم</button></div>
        </form>
        <div class="table-summary"><strong>يعرض ${escapeHtml(visibleEvents.length)} من ${escapeHtml(events.length)} حركة</strong><span>المدى: ${escapeHtml(filters.from)} إلى ${escapeHtml(filters.to)}</span></div>
        ${table(["الموظف", "النوع", "الموقع", "المراجعة", "المخاطر", "سيلفي", "الوقت"], visibleEvents.map((event) => `<tr><td class="person-cell">${avatar(event.employee, "tiny")}<span>${escapeHtml(event.employee?.fullName || event.employeeId)}<small>${escapeHtml(event.notes || "")}</small></span></td><td>${badge(event.type)}</td><td>${badge(event.geofenceStatus || "unknown")}<small>${event.distanceFromBranchMeters != null ? `${event.distanceFromBranchMeters} متر` : ""}</small></td><td>${event.requiresReview ? badge("PENDING") : badge("APPROVED")}</td><td><strong>${escapeHtml(event.riskScore ?? 0)}%</strong> ${event.riskLevel ? badge(event.riskLevel) : ""}<br>${(event.riskFlags || []).length ? event.riskFlags.map((flag) => `<span class="status warning">${escapeHtml(flag)}</span>`).join(" ") : `<span class="status ACTIVE">آمن</span>`}</td><td>${event.selfieUrl ? `<a target="_blank" rel="noopener" href="${escapeHtml(event.selfieUrl)}">عرض</a>` : `<span class="status warning">لا يوجد</span>`}</td><td>${date(event.eventAt)}</td></tr>`), "attendance-table")}
        ${hasMore ? `<div class="load-more-row"><button class="button ghost" data-attendance-more>عرض 500 حركة أخرى</button><small>استخدم فلاتر أضيق عند السجلات الكبيرة جدًا.</small></div>` : ""}
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>طلب تعديل حضور</h2><p>يتم حفظه في مركز الطلبات وسجل التدقيق</p></div></div>
        ${simpleForm("adjust-form", [["employeeId", "الموظف", "select", employeeSelect], ["title", "نوع الطلب", "select", optionList([{ name: "نسيان بصمة حضور" }, { name: "نسيان بصمة انصراف" }, { name: "تعديل تأخير" }])], ["reason", "السبب", "textarea"]], "إرسال الطلب")}
        <hr class="soft-separator" />
        <h3>تعديل يدوي مباشر بصلاحية HR</h3>
        <form id="manual-attendance-form" class="form-grid compact-form"><label>الموظف<select name="employeeId">${employeeSelect}</select></label><label>نوع الحركة<select name="type"><option value="CHECK_IN">حضور</option><option value="CHECK_OUT">انصراف</option><option value="MANUAL_ADJUSTMENT">تعديل يدوي</option></select></label><label>التاريخ والوقت<input type="datetime-local" name="eventAt" /></label><label>السبب<input name="reason" required /></label><div class="form-actions"><button class="button">حفظ تعديل يدوي</button></div></form>
      </article>
    </section>`,
    "الحضور",
    "تسجيل ومراجعة أحداث الحضور مع تقييم الموقع والقواعد.",
  );
  app.querySelector("#attendance-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    setRouteQuery("attendance", { ...readForm(event.currentTarget), limit: 500 });
  });
  app.querySelector("[data-reset-attendance-filters]").addEventListener("click", () => setRouteQuery("attendance", {}));
  app.querySelector("[data-attendance-more]")?.addEventListener("click", () => setRouteQuery("attendance", { ...filters, limit: filters.limit + 500 }));

  const recordAttendance = async (action) => {
    const resultBox = app.querySelector("#attendance-result");
    try {
      resultBox.classList.remove("hidden");
      resultBox.classList.remove("danger-box");
      resultBox.textContent = "جاري قراءة الموقع وتقييم الحركة...";
      const location = await getBrowserLocation();
      const body = { employeeId: app.querySelector("#attendance-employee").value, notes: app.querySelector("#attendance-notes").value, verificationStatus: app.querySelector("#attendance-verification").value, ...location };
      const response = action === "checkIn" ? await endpoints.checkIn(body) : await endpoints.checkOut(body);
      const evaluation = response.evaluation || response.event?.evaluation || {};
      resultBox.innerHTML = `<strong>${evaluation.requiresReview ? "الحركة تحتاج مراجعة" : "الحركة مقبولة داخل نطاق المجمع"}</strong><div class="toolbar spaced">${badge(evaluation.type || response.type)}${badge(evaluation.geofenceStatus || response.geofenceStatus)}${badge(evaluation.verificationStatus || response.verificationStatus)}</div><p>${evaluation.distanceFromBranchMeters != null || response.distanceFromBranchMeters != null ? `المسافة عن الفرع: ${escapeHtml(evaluation.distanceFromBranchMeters ?? response.distanceFromBranchMeters)} متر.` : "تم التحقق من نطاق المجمع."}</p>`;
      setMessage(action === "checkIn" ? "تم تسجيل الحضور داخل نطاق المجمع." : "تم تسجيل الانصراف داخل نطاق المجمع.", "");
      await render();
    } catch (error) {
      resultBox.classList.remove("hidden");
      resultBox.classList.add("danger-box");
      resultBox.innerHTML = `<strong>تم رفض البصمة</strong><p>${escapeHtml(error.message)}</p>`;
      setMessage("", error.message);
    }
  };

  app.querySelector('[data-attendance="checkIn"]').addEventListener("click", () => recordAttendance("checkIn"));
  app.querySelector('[data-attendance="checkOut"]').addEventListener("click", () => recordAttendance("checkOut"));
  app.querySelector("#adjust-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await endpoints.adjustAttendance(readForm(event.currentTarget));
    setMessage("تم إرسال طلب تعديل الحضور.", "");
    render();
  });
  app.querySelector("#manual-attendance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await endpoints.manualAttendance(readForm(event.currentTarget));
    setMessage("تم حفظ التعديل اليدوي وإعادة حساب اليوميات.", "");
    render();
  });
  app.querySelector("[data-regenerate-attendance]").addEventListener("click", async () => {
    const result = await endpoints.regenerateAttendance({});
    setMessage(`تمت إعادة حساب ${result.generated || 0} سجل يومي.`, "");
    render();
  });
  app.querySelector("[data-export-attendance]").addEventListener("click", () => {
    const rows = [["الموظف","النوع","الوقت","الموقع","المراجعة"], ...events.map((e) => [e.employee?.fullName || e.employeeId, statusLabel(e.type), e.eventAt, statusLabel(e.geofenceStatus), e.requiresReview ? "نعم" : "لا"])];
    downloadFile(`attendance-${filters.from || "all"}-${filters.to || "all"}.csv`, `\ufeff${toCsv(rows)}`, "text/csv;charset=utf-8");
  });
}

async function renderAttendanceCalendar() {
  const [employees, daily, events] = await Promise.all([endpoints.employees().then(unwrap), endpoints.attendanceDaily().then(unwrap), endpoints.attendanceEvents().then(unwrap)]);
  const employeeId = routeParams().get("employeeId") || employees[0]?.id || "";
  const employee = employees.find((item) => item.id === employeeId);
  const days = Array.from({ length: 31 }).map((_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (30 - index));
    const key = d.toISOString().slice(0, 10);
    const record = daily.find((item) => item.employeeId === employeeId && String(item.date).startsWith(key));
    const event = events.find((item) => item.employeeId === employeeId && String(item.eventAt).startsWith(key));
    return { key, status: record?.status || event?.type || "ABSENT", lateMinutes: record?.lateMinutes || event?.lateMinutes || 0 };
  });
  shell(
    `<section class="stack">
      <article class="panel">
        <div class="panel-head"><div><h2>تقويم حضور ${escapeHtml(employee?.fullName || "")}</h2><p>آخر 31 يوم</p></div><select id="calendar-employee">${optionList(employees.map((e) => ({ id: e.id, name: `${e.fullName}${e.jobTitle ? " — " + e.jobTitle : ""}` })), employeeId)}</select></div>
        <div class="calendar-grid">${days.map((day) => `<div class="calendar-day ${day.status}"><strong>${dateOnly(day.key)}</strong>${badge(day.status)}<small>${day.lateMinutes ? `${day.lateMinutes} دقيقة تأخير` : ""}</small></div>`).join("")}</div>
      </article>
    </section>`,
    "تقويم الحضور",
    "رؤية شهرية سريعة لحضور كل موظف.",
  );
  app.querySelector("#calendar-employee").addEventListener("change", (event) => {
    location.hash = `attendance-calendar?employeeId=${event.target.value}`;
  });
}

async function renderMissions() {
  const [employees, missions] = await Promise.all([endpoints.employees().then(unwrap), endpoints.missions().then(unwrap)]);
  const employeeSelect = optionList(employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })));
  shell(
    `<section class="grid">
      <article class="panel span-4"><h2>مأمورية جديدة</h2>${simpleForm("mission-form", [["employeeId", "الموظف", "select", employeeSelect], ["title", "العنوان"], ["destinationName", "الوجهة"], ["plannedStart", "البداية", "datetime-local"], ["plannedEnd", "النهاية", "datetime-local"]], "إنشاء")}</article>
      <article class="panel span-8"><h2>المأموريات</h2>${table(["العنوان", "الموظف", "الوجهة", "الحالة", "إجراءات"], missions.map((mission) => `<tr><td>${escapeHtml(mission.title)}</td><td>${escapeHtml(mission.employee?.fullName || "-")}</td><td>${escapeHtml(mission.destinationName)}</td><td>${badge(mission.status)}</td><td><button class="button ghost" data-mission="${mission.id}" data-action-name="approve">اعتماد</button><button class="button ghost" data-mission="${mission.id}" data-action-name="complete">إكمال</button><button class="button danger ghost" data-mission="${mission.id}" data-action-name="reject">رفض</button></td></tr>`))}</article>
    </section>`,
    "المأموريات",
    "إنشاء واعتماد وإكمال المأموريات مع Timeline داخلي.",
  );
  app.querySelector("#mission-form").addEventListener("submit", submitForm(endpoints.createMission, "تم إنشاء المأمورية."));
  app.querySelectorAll("[data-mission]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.updateMission(button.dataset.mission, button.dataset.actionName);
    setMessage("تم تحديث المأمورية.", "");
    render();
  }));
}

async function renderLeaves() {
  const [employees, leaves] = await Promise.all([endpoints.employees().then(unwrap), endpoints.leaves().then(unwrap)]);
  const employeeSelect = optionList(employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })));
  shell(
    `<section class="grid">
      <article class="panel span-4"><h2>طلب إجازة</h2>${simpleForm("leave-form", [["employeeId", "الموظف", "select", employeeSelect], ["leaveType", "نوع الإجازة", "select", optionList([{ name: "اعتيادية" }, { name: "مرضية" }, { name: "طارئة" }])], ["startDate", "من", "date"], ["endDate", "إلى", "date"], ["reason", "السبب"]], "إرسال")}</article>
      <article class="panel span-8"><h2>طلبات الإجازة</h2>${table(["الموظف", "النوع", "من", "إلى", "الحالة", "إجراءات"], leaves.map((leave) => `<tr><td>${escapeHtml(leave.employee?.fullName || "-")}</td><td>${escapeHtml(leave.leaveType?.name)}</td><td>${dateOnly(leave.startDate)}</td><td>${dateOnly(leave.endDate)}</td><td>${badge(leave.status)}</td><td><button class="button ghost" data-leave="${leave.id}" data-action-name="approve">اعتماد</button><button class="button danger ghost" data-leave="${leave.id}" data-action-name="reject">رفض</button></td></tr>`))}</article>
    </section>`,
    "الإجازات",
    "إرسال واعتماد ورفض طلبات الإجازة.",
  );
  app.querySelector("#leave-form").addEventListener("submit", submitForm(endpoints.createLeave, "تم إرسال طلب الإجازة."));
  app.querySelectorAll("[data-leave]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.updateLeave(button.dataset.leave, button.dataset.actionName);
    setMessage("تم تحديث طلب الإجازة.", "");
    render();
  }));
}

async function renderRequests() {
  const params = routeParams();
  const filters = { status: params.get("status") || "", kind: params.get("kind") || "" };
  const payload = endpoints.requestCenter ? await endpoints.requestCenter(filters).then(unwrap) : null;
  let rows = payload?.rows;
  let summary = payload?.summary;
  if (!rows) {
    const [leaves, missions, exceptions, locations] = await Promise.all([endpoints.leaves().then(unwrap), endpoints.missions().then(unwrap), endpoints.exceptions().then(unwrap), endpoints.locations().then(unwrap)]);
    rows = [
      ...leaves.map((item) => ({ ...item, kind: "leave", kindLabel: "إجازة", label: item.leaveType?.name || "إجازة" })),
      ...missions.map((item) => ({ ...item, kind: "mission", kindLabel: "مأمورية", label: item.title || "مأمورية" })),
      ...exceptions.map((item) => ({ ...item, kind: "exception", kindLabel: "استثناء حضور", label: item.title || "استثناء حضور" })),
      ...locations.filter((item) => item.purpose).map((item) => ({ ...item, kind: "location", kindLabel: "طلب موقع", label: item.purpose || "طلب موقع" })),
    ].sort((a, b) => new Date(b.createdAt || b.requestedAt || 0) - new Date(a.createdAt || a.requestedAt || 0));
    summary = { pending: rows.filter((i) => i.status === "PENDING").length, approved: rows.filter((i) => i.status === "APPROVED").length, rejected: rows.filter((i) => i.status === "REJECTED").length, stale: 0 };
  }
  const pendingRows = rows.filter((item) => item.status === "PENDING");
  shell(
    `<section class="grid request-center-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>مركز الطلبات والموافقات</h2><p>Workflow موحد للإجازات والمأموريات والاستثناءات وطلبات الموقع مع قرارات جماعية.</p></div><div class="toolbar"><button class="button ghost" data-route="leaves">الإجازات</button><button class="button ghost" data-route="missions">المأموريات</button></div></div>
        <div class="mini-stats"><div><span>معلقة</span><strong>${escapeHtml(summary?.pending || 0)}</strong></div><div><span>متأخرة</span><strong>${escapeHtml(summary?.stale || 0)}</strong></div><div><span>معتمدة</span><strong>${escapeHtml(summary?.approved || 0)}</strong></div><div><span>مرفوضة</span><strong>${escapeHtml(summary?.rejected || 0)}</strong></div></div>
      </article>
      <article class="panel span-12">
        <form class="filters" id="request-filters">
          <select name="status"><option value="">كل الحالات</option>${optionList([{ value: "PENDING", name: "قيد المراجعة" }, { value: "APPROVED", name: "معتمد" }, { value: "REJECTED", name: "مرفوض" }], filters.status)}</select>
          <select name="kind"><option value="">كل الأنواع</option>${optionList([{ value: "leave", name: "إجازة" }, { value: "mission", name: "مأمورية" }, { value: "exception", name: "استثناء حضور" }, { value: "location", name: "طلب موقع" }], filters.kind)}</select>
        </form>
        <div class="request-card-grid">
          ${rows.map((item) => `
            <article class="request-card ${item.status === 'PENDING' ? 'is-pending' : ''}">
              <div class="card-top">
                <div class="requester-info">
                  ${avatar(item.employee, "small")}
                  <div>
                    <strong>${escapeHtml(item.employee?.fullName || "-")}</strong>
                    <small>${escapeHtml(item.kindLabel || item.kind)}</small>
                  </div>
                </div>
                <div class="status-side">${badge(item.status)}</div>
              </div>
              <div class="card-body">
                <h3>${escapeHtml(item.label)}</h3>
                <div class="request-meta">
                   <span>تاريخ الطلب: ${escapeHtml(date(item.createdAt || item.requestedAt))}</span>
                   ${item.workflow?.length ? `<div class="workflow-hint">آخر إجراء: ${escapeHtml(item.workflow[item.workflow.length-1].action)} — ${escapeHtml(date(item.workflow[item.workflow.length-1].at))}</div>` : ''}
                </div>
              </div>
              <div class="card-footer">
                ${item.status === "PENDING" ? `
                  <div class="selection-area"><input type="checkbox" data-select-request="${escapeHtml(item.kind + ':' + item.id)}" /><span>تحديد للجماعي</span></div>
                  <div class="action-buttons">
                    <button class="button primary" data-request="${escapeHtml(item.kind + ':' + item.id)}" data-action-name="approve">اعتماد</button>
                    <button class="button danger ghost" data-request="${escapeHtml(item.kind + ':' + item.id)}" data-action-name="reject">رفض</button>
                  </div>
                ` : `<div class="decision-made">تمت المعالجة بنجاح</div>`}
              </div>
            </article>
          `).join("") || `<div class="empty-state">لا توجد طلبات حالياً.</div>`}
        </div>
      </article>
    </section>`,
    "مركز الطلبات",
    "مراجعة واعتماد ورفض كل الطلبات من مكان واحد.",
  );
  app.querySelector("#request-filters")?.addEventListener("change", (event) => {
    const values = readForm(event.currentTarget);
    const q = new URLSearchParams();
    if (values.status) q.set("status", values.status);
    if (values.kind) q.set("kind", values.kind);
    location.hash = `requests${q.toString() ? `?${q}` : ""}`;
  });
  const selected = new Set();
  const updateBulk = () => {
    app.querySelector("#request-selected-count").textContent = selected.size ? `تم تحديد ${selected.size} طلب` : "لم يتم تحديد طلبات";
    app.querySelectorAll("[data-bulk-request]").forEach((button) => { button.disabled = selected.size === 0; });
  };
  app.querySelectorAll("[data-select-request]").forEach((input) => input.addEventListener("change", () => { input.checked ? selected.add(input.dataset.selectRequest) : selected.delete(input.dataset.selectRequest); updateBulk(); }));
  app.querySelector("#request-select-all")?.addEventListener("change", (event) => {
    pendingRows.forEach((item) => event.target.checked ? selected.add(`${item.kind}:${item.id}`) : selected.delete(`${item.kind}:${item.id}`));
    app.querySelectorAll("[data-select-request]").forEach((input) => { input.checked = selected.has(input.dataset.selectRequest); });
    updateBulk();
  });
  app.querySelectorAll("[data-bulk-request]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.bulkRequest;
    if (!await confirmAction({ title: action === "approve" ? "اعتماد جماعي" : "رفض جماعي", message: `سيتم ${action === "approve" ? "اعتماد" : "رفض"} ${selected.size} طلب.`, confirmLabel: action === "approve" ? "اعتماد" : "رفض", danger: action !== "approve" })) return;
    const result = endpoints.bulkRequestAction ? await endpoints.bulkRequestAction({ items: [...selected], action }) : { updated: 0 };
    setMessage(`تم تحديث ${result.updated || 0} طلب.`, "");
    render();
  }));
  app.querySelectorAll("[data-request]").forEach((button) => button.addEventListener("click", async () => {
    const [kind, id] = button.dataset.request.split(":");
    const action = button.dataset.actionName;
    if (kind === "leave") await endpoints.updateLeave(id, action);
    else if (kind === "mission") await endpoints.updateMission(id, action);
    else if (kind === "exception") await endpoints.updateException(id, action);
    else if (kind === "location") await endpoints.updateLocationRequest(id, { status: action === "reject" ? "REJECTED" : "APPROVED" });
    setMessage("تم تحديث الطلب.", "");
    render();
  }));
}


async function renderOrganization() {
  const ref = await referenceData();
  const config = [
    ["governorates", "المحافظات", ref.governorates, [["code","الكود"], ["name","الاسم"]]],
    ["complexes", "المجمعات", ref.complexes, [["code","الكود"], ["name","الاسم"], ["governorateId","المحافظة","select", optionList(ref.governorates)]]],
    ["branches", "الفروع", ref.branches, [["code","الكود"], ["name","الاسم"], ["governorateId","المحافظة","select", optionList(ref.governorates)], ["complexId","المجمع","select", optionList(ref.complexes)], ["address","العنوان"], ["latitude","Lat","number"], ["longitude","Lng","number"], ["geofenceRadiusMeters","نطاق الحضور/متر","number"]]],
    ["departments", "الأقسام", ref.departments, [["code","الكود"], ["name","الاسم"], ["branchId","الفرع","select", optionList(ref.branches)], ["managerEmployeeId","المدير","select", optionList(ref.employees.map((e) => ({ id: e.id, name: e.fullName })), "", "بدون")]]],
  ];
  shell(
    `<section class="grid">${config.map(([kind, title, items, fields]) => `
      <article class="panel span-6">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>CRUD فعلي مع حذف منطقي</p></div></div>
        ${simpleOrgForm(kind, fields)}
        ${table(["الاسم", "الكود", "الحالة", "إجراءات"], items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.code || "-")}</td><td>${badge(item.active === false ? "INACTIVE" : "ACTIVE")}</td><td><button class="button ghost" data-edit-org="${kind}:${item.id}">تعديل</button><button class="button danger ghost" data-delete-org="${kind}:${item.id}">تعطيل</button></td></tr>`))}
      </article>`).join("")}</section>`,
    "الفروع والأقسام",
    "إدارة الهيكل الإداري الأساسي: محافظات، مجمعات، فروع، أقسام.",
  );
  config.forEach(([kind, _title, _items, fields]) => {
    app.querySelector(`#form-${kind}`).addEventListener("submit", async (event) => {
      event.preventDefault();
      await endpoints.saveOrg(kind, readForm(event.currentTarget));
      setMessage("تم حفظ العنصر التنظيمي.", "");
      render();
    });
  });
  app.querySelectorAll("[data-use-current-location]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const current = await getBrowserLocation();
      const form = button.closest("form");
      if (current.latitude != null && form.elements.latitude) form.elements.latitude.value = current.latitude;
      if (current.longitude != null && form.elements.longitude) form.elements.longitude.value = current.longitude;
      if (form.elements.geofenceRadiusMeters && !form.elements.geofenceRadiusMeters.value) form.elements.geofenceRadiusMeters.value = 200;
      setMessage("تم وضع موقعك الحالي كعنوان حضور للفرع. اضغط حفظ لتثبيته.", "");
    } catch (error) {
      setMessage("", error.message);
    }
  }));
  app.querySelectorAll("[data-edit-org]").forEach((button) => button.addEventListener("click", async () => {
    const [kind, id] = button.dataset.editOrg.split(":");
    const items = await endpoints.listOrg(kind);
    const item = items.find((row) => row.id === id);
    const form = app.querySelector(`#form-${kind}`);
    Object.entries(item || {}).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value ?? "";
    });
    form.elements.id.value = id;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  app.querySelectorAll("[data-delete-org]").forEach((button) => button.addEventListener("click", async () => {
    const [kind, id] = button.dataset.deleteOrg.split(":");
    await endpoints.deleteOrg(kind, id);
    setMessage("تم تعطيل العنصر تنظيميًا.", "");
    render();
  }));
}

function simpleOrgForm(kind, fields) {
  const locationButton = kind === "branches" ? `<button class="button ghost" type="button" data-use-current-location="${kind}">استخدم موقعي الحالي كعنوان للفرع</button>` : "";
  return `<form id="form-${kind}" class="form-grid compact-form"><input type="hidden" name="id" />${fields.map(([name, label, type = "text", opts = ""]) => `<label>${escapeHtml(label)}${type === "select" ? `<select name="${name}">${opts}</select>` : `<input name="${name}" type="${type}" step="any" />`}</label>`).join("")}<div class="form-actions">${locationButton}<button class="button primary" type="submit">حفظ</button></div></form>`;
}

async function renderRoles() {
  const [roles, rawPermissions] = await Promise.all([endpoints.roles().then(unwrap), endpoints.permissions().then(unwrap)]);
  const permissions = rawPermissions;
  shell(
    `<section class="grid">
      <article class="panel span-5">
        <div class="panel-head"><div><h2>دور جديد / تعديل</h2><p>صلاحيات دقيقة قابلة للتخصيص</p></div></div>
        <form id="role-form" class="form-grid">
          <input type="hidden" name="id" />
          <label>اسم الدور<input name="name" required /></label>
          <label>الكود<input name="key" required /></label>
          <label>الوصف<input name="description" /></label>
          <div class="permissions-list">${permissions.map((p) => `<label class="check-row"><input type="checkbox" name="perm" value="${escapeHtml(p.scope)}" /> ${escapeHtml(p.name)}</label>`).join("")}</div>
          <div class="form-actions"><button class="button primary" type="submit">حفظ الدور</button></div>
        </form>
      </article>
      <article class="panel span-7">
        <h2>الأدوار الحالية</h2>
        ${table(["الدور", "الكود", "عدد الصلاحيات", "إجراءات"], roles.map((role) => `<tr><td>${escapeHtml(role.name)}</td><td>${escapeHtml(role.key || role.slug)}</td><td>${escapeHtml(role.permissions?.length || 0)}</td><td><button class="button ghost" data-edit-role="${role.id}">تعديل</button></td></tr>`))}
      </article>
    </section>`,
    "الأدوار والصلاحيات",
    "RBAC عملي لاستخدامه في تنظيم الوصول للنظام.",
  );
  app.querySelector("#role-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readForm(form);
    values.permissions = [...form.querySelectorAll('[name="perm"]:checked')].map((input) => input.value);
    await endpoints.saveRole(values);
    setMessage("تم حفظ الدور والصلاحيات.", "");
    render();
  });
  app.querySelectorAll("[data-edit-role]").forEach((button) => button.addEventListener("click", () => {
    const role = roles.find((item) => item.id === button.dataset.editRole);
    const form = app.querySelector("#role-form");
    form.elements.id.value = role.id;
    form.elements.name.value = role.name || "";
    form.elements.key.value = role.key || role.slug || "";
    form.elements.description.value = role.description || "";
    form.querySelectorAll('[name="perm"]').forEach((input) => { input.checked = (role.permissions || []).includes(input.value); });
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

async function renderOrgChart() {
  const employees = await endpoints.employees().then(unwrap);
  const active = employees.filter((employee) => employee.status !== "TERMINATED" && !employee.isDeleted);
  const byId = new Map(active.map((employee) => [employee.id, employee]));
  const childrenOf = (id) => active
    .filter((employee) => employee.managerEmployeeId === id)
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ar"));
  const roots = active
    .filter((employee) => !employee.managerEmployeeId || !byId.has(employee.managerEmployeeId))
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ar"));
  const countDescendants = (id) => childrenOf(id).reduce((total, child) => total + 1 + countDescendants(child.id), 0);
  const levelOf = (employee) => {
    let depth = 0;
    let current = employee;
    const seen = new Set();
    while (current?.managerEmployeeId && byId.has(current.managerEmployeeId) && !seen.has(current.managerEmployeeId)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.managerEmployeeId);
    }
    return depth;
  };
  const directToExecutive = active.filter((employee) => byId.get(employee.managerEmployeeId)?.roleId === "role-executive" || employee.managerEmployeeId === "emp-executive-director").length;
  const managers = active.filter((employee) => childrenOf(employee.id).length);
  const leaves = active.filter((employee) => !childrenOf(employee.id).length);
  const maxDepth = active.reduce((max, employee) => Math.max(max, levelOf(employee)), 0);
  const rows = active.map((employee) => [
    employee.fullName,
    employee.jobTitle || "-",
    employee.manager?.fullName || byId.get(employee.managerEmployeeId)?.fullName || "مدير أعلى / لا يوجد",
    childrenOf(employee.id).length,
    countDescendants(employee.id),
  ]);
  const node = (employee, depth = 0) => {
    const children = childrenOf(employee.id);
    return `<div class="org-tree-item" style="--depth:${depth}">
      <div class="org-node enhanced">
        ${avatar(employee, "tiny")}
        <span><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(employee.jobTitle || "")}</small></span>
        <em>${children.length ? `${children.length} مباشر / ${countDescendants(employee.id)} إجمالي` : "بدون تابعين"}</em>
      </div>
      ${children.length ? `<div class="org-children">${children.map((child) => node(child, depth + 1)).join("")}</div>` : ""}
    </div>`;
  };
  const roleSlugOf = (employee) => String(employee.role?.slug || employee.roleSlug || "").toLowerCase();
  const normalizedName = (employee) => String(employee.fullName || employee.name || "").trim();
  const sortPeople = (list) => list
    .filter(Boolean)
    .filter((employee, index, self) => self.findIndex((item) => item.id === employee.id) === index)
    .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "ar"));
  const executive = active.find((employee) => roleSlugOf(employee) === "executive")
    || active.find((employee) => String(employee.jobTitle || "").includes("تنفيذي"))
    || roots[0];
  const secretary = active.find((employee) => ["executive-secretary", "admin"].includes(roleSlugOf(employee)) && employee.id !== executive?.id)
    || active.find((employee) => String(employee.jobTitle || "").includes("سكرتير"));
  const managerLike = active.filter((employee) => employee.id !== executive?.id && employee.id !== secretary?.id)
    .filter((employee) => childrenOf(employee.id).length || ["manager", "direct-manager", "operations-manager-1", "operations-manager-2", "hr-manager"].includes(roleSlugOf(employee)));
  const firstLine = sortPeople([
    ...(executive ? childrenOf(executive.id).filter((employee) => employee.id !== secretary?.id) : []),
    ...managerLike.filter((employee) => !employee.managerEmployeeId || employee.managerEmployeeId === executive?.id),
  ]);
  const firstLineIds = new Set(firstLine.map((employee) => employee.id));
  const branchNode = (employee, depth = 0) => {
    const children = childrenOf(employee.id).filter((child) => child.id !== secretary?.id && !firstLineIds.has(child.id));
    return `<div class="org-feature-branch" style="--depth:${depth}">
      <div class="org-feature-node ${depth === 0 ? "is-manager" : ""}">
        ${avatar(employee, "tiny")}
        <span><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(employee.jobTitle || employee.role?.name || "")}</small></span>
        <em>${children.length ? `${children.length} مباشر` : "تنفيذ"}</em>
      </div>
      ${children.length ? `<div class="org-feature-children">${children.map((child) => branchNode(child, depth + 1)).join("")}</div>` : ""}
    </div>`;
  };
  const featuredChart = executive ? `<div class="org-featured-chart">
    <div class="org-feature-top">
      <div class="org-feature-node is-executive">${avatar(executive, "tiny")}<span><strong>${escapeHtml(executive.fullName)}</strong><small>${escapeHtml(executive.jobTitle || "المدير التنفيذي")}</small></span></div>
      ${secretary ? `<div class="org-feature-node is-secretary">${avatar(secretary, "tiny")}<span><strong>${escapeHtml(secretary.fullName)}</strong><small>${escapeHtml(secretary.jobTitle || secretary.role?.name || "السكرتير التنفيذي")}</small></span></div>` : ""}
    </div>
    <div class="org-feature-line" aria-hidden="true"></div>
    <div class="org-feature-managers">${firstLine.length ? firstLine.map((employee) => branchNode(employee)).join("") : roots.filter((employee) => employee.id !== executive.id && employee.id !== secretary?.id).map((employee) => branchNode(employee)).join("")}</div>
  </div>` : "";
  const fallbackRoots = roots.filter((employee) => employee.id !== executive?.id && employee.id !== secretary?.id && !firstLineIds.has(employee.id));
  shell(`
    <section class="stack">
      <div class="metric-grid org-summary-grid">
        ${[
          ["إجمالي الأفراد", active.length, "كل الملفات النشطة في الهيكل"],
          ["مديرون لديهم فرق", managers.length, "لديهم موظف واحد على الأقل"],
          ["تابعون مباشرة للمدير التنفيذي", directToExecutive, "المستوى الأول"],
          ["أكبر عمق إداري", maxDepth + 1, "عدد المستويات من القمة"],
          ["موظفون بلا تابعين", leaves.length, "أفراد تنفيذ"],
        ].map(([label, value, helper]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(helper)}</small></article>`).join("")}
      </div>
      <section class="panel">
        <div class="panel-head">
          <div><h2>الهيكل الوظيفي لجمعية خواطر أحلى شباب</h2><p>حسب المدير المباشر المسجل في ملفات الموظفين — يدعم أكثر من مستوى إداري.</p></div>
          <div class="toolbar"><button class="button ghost" data-export-org>تصدير CSV</button><button class="button ghost" data-print-org>طباعة</button></div>
        </div>
        <div class="org-chart org-tree">${featuredChart || roots.map((employee) => node(employee)).join("")}${fallbackRoots.length && featuredChart ? `<div class="org-fallback-tree">${fallbackRoots.map((employee) => node(employee)).join("")}</div>` : ""}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>جدول العلاقات الإدارية</h2><p>مراجعة سريعة لكل موظف ومديره وعدد التابعين.</p></div></div>
        ${table(["الموظف", "الوظيفة", "المدير المباشر", "تابعون مباشرون", "إجمالي تحت الإدارة"], rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`))}
      </section>
    </section>`, "الهيكل الوظيفي", "عرض علاقات المديرين والفرق كما وصفتها.");
  app.querySelector("[data-export-org]")?.addEventListener("click", () => downloadFile("org-hierarchy.csv", `\ufeff${toCsv([["الموظف", "الوظيفة", "المدير المباشر", "تابعون مباشرون", "إجمالي تحت الإدارة"], ...rows])}`, "text/csv;charset=utf-8"));
  app.querySelector("[data-print-org]")?.addEventListener("click", () => printReport("الهيكل الوظيفي", ["الموظف", "الوظيفة", "المدير المباشر", "تابعون مباشرون", "إجمالي تحت الإدارة"], rows));
}

async function renderLocations() {
  const data = await endpoints.locationMonitor().then(unwrap).catch(async () => {
    const [employees, rawLocations] = await Promise.all([endpoints.employees().then(unwrap), endpoints.locations().then(unwrap).catch(() => [])]);
    return { counts: {}, rows: employees.map((employee) => ({ employee, employeeId: employee.id, latestLocation: safeList(rawLocations).find((loc) => loc.employeeId === employee.id) || null, liveRequests: [], liveResponses: [], classicRequests: [], quality: "UNKNOWN" })) };
  });
  const rows = safeList(data.rows);
  const counts = data.counts || {};
  const qualityLabel = (quality) => ({ GOOD: "GPS جيد", LOW_ACCURACY: "دقة ضعيفة", STALE_GPS: "موقع قديم", NO_GPS: "لا يوجد GPS", UNKNOWN: "غير معروف" }[quality] || quality || "-");
  const qualityBadge = (quality) => badge(quality === "GOOD" ? "APPROVED" : quality === "NO_GPS" ? "REJECTED" : "PENDING");
  const problemRows = rows.filter((row) => row.quality !== "GOOD" || row.pendingLiveRequest).slice(0, 80);
  const employeeCards = rows.map((row) => {
    const employee = row.employee || {};
    const latest = row.latestLocation || {};
    const pending = row.pendingLiveRequest || null;
    const accuracy = Number(row.accuracyMeters || latest.accuracyMeters || latest.accuracy || 0);
    const at = latest.capturedAt || latest.respondedAt || latest.createdAt || latest.date || "";
    return `<article class="employee-location-card ops-card" data-location-card="${escapeHtml(employee.id || row.employeeId)}">
      <button class="location-card-head" type="button" data-toggle-location-details="${escapeHtml(employee.id || row.employeeId)}">
        ${avatar(employee, "medium")}
        <span><strong>${escapeHtml(employee.fullName || "-")}</strong><small>${escapeHtml(employee.jobTitle || employee.phone || "")}</small></span>
        ${pending ? badge("PENDING") : qualityBadge(row.quality)}
      </button>
      <div class="location-card-actions">
        <button class="button primary" type="button" data-request-live-location="${escapeHtml(employee.id || row.employeeId)}">طلب موقع مباشر</button>
        <button class="button ghost" type="button" data-route="employee-archive?id=${escapeHtml(employee.id || row.employeeId)}">ملف الموظف</button>
        ${latest.latitude && latest.longitude ? `<a class="button ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${escapeHtml(latest.latitude)},${escapeHtml(latest.longitude)}">فتح الخريطة</a>` : ""}
      </div>
      <div class="location-details hidden" id="location-details-${escapeHtml(employee.id || row.employeeId)}">
        <div class="meta-grid">
          <span>الحالة: ${escapeHtml(qualityLabel(row.quality))}</span>
          <span>حالة اليوم: ${escapeHtml(statusLabel(row.today?.status || "-"))}</span>
          <span>آخر تحديث: ${date(at)}</span>
          <span>عمر الموقع: ${row.ageMinutes == null ? "-" : `${escapeHtml(row.ageMinutes)} دقيقة`}</span>
          <span>دقة GPS: ${latest.latitude ? formatMeters(accuracy) : "لا يوجد"}</span>
          <span>طلبات مباشرة: ${escapeHtml(safeList(row.liveRequests).length)}</span>
        </div>
        ${pending ? `<div class="message warning compact">طلب الموقع مُرسل مباشرة للموظف. الرد المتوقع الآن هو إرسال الموقع فقط.</div>` : ""}
        ${latest.latitude && latest.longitude ? `<div class="map-line"><span>المكان: ${escapeHtml(locationPlaceLabel(latest))}</span><span>الدقة: ${escapeHtml(accuracy || "-")} متر</span><span>${escapeHtml(locationStatusText(latest))}</span></div>` : `<div class="empty-box">لم يتم حفظ GPS لهذا الموظف بعد.</div>`}
        ${table(["المصدر", "الحالة", "الوقت", "الرد"], [...safeList(row.liveRequests), ...safeList(row.classicRequests), ...safeList(row.liveResponses)].slice(0, 12).map((item) => `<tr><td>${escapeHtml(item.requestId ? "استجابة" : item.precision ? "طلب مباشر" : "طلب عادي")}</td><td>${badge(item.status || "ACTIVE")}</td><td>${date(item.createdAt || item.respondedAt || item.capturedAt || item.date)}</td><td>${escapeHtml(item.responseNote || item.note || item.reason || "-")}</td></tr>`))}
      </div>
    </article>`;
  }).join("");
  shell(
    `<section class="grid locations-page ops-monitor-page live-bound-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>مركز مراقبة اللوكيشن الحقيقي</h2><p>مربوط بجداول live_location_requests و live_location_responses و employee_locations، ولا يعرض أرقامًا وهمية.</p></div><div class="toolbar"><button class="button ghost" type="button" data-route="presence-map">خريطة الحضور</button><button class="button primary" type="button" data-route="executive-mobile">غرفة المدير التنفيذي</button></div></div>
        <div class="metric-grid">
          ${metric("إجمالي الموظفين", counts.total ?? rows.length, "في المتابعة")}
          ${metric("GPS جيد", counts.good ?? rows.filter((r)=>r.quality==='GOOD').length, "حديث ودقته مقبولة")}
          ${metric("طلبات معلقة", counts.pending ?? 0, "بانتظار الموظف")}
          ${metric("بدون GPS", counts.noGps ?? 0, "يحتاج طلب مباشر")}
          ${metric("دقة ضعيفة", counts.lowAccuracy ?? 0, "أكبر من الحد المسموح")}
          ${metric("موقع قديم", counts.stale ?? 0, "لم يتحدث منذ ساعتين+")}
        </div>
        <div class="message compact">طلب الموقع من المدير التنفيذي يتم اعتماده وإرساله فورًا للموظف، ثم يظهر هنا رد الموظف عند إرسال الموقع.</div>
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>مشاكل تحتاج متابعة</h2><p>بدون GPS، دقة ضعيفة، موقع قديم، أو طلبات معلقة.</p></div><button class="button ghost" id="export-location-monitor">تصدير JSON</button></div>
        ${table(["الموظف", "الحالة", "الدقة", "آخر تحديث", "إجراء"], problemRows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,"tiny")}<span>${escapeHtml(row.employee?.fullName || row.employeeId || "-")}</span></td><td>${escapeHtml(qualityLabel(row.quality))}${row.pendingLiveRequest ? " — طلب معلق" : ""}</td><td>${formatMeters(row.accuracyMeters)}</td><td>${date(row.latestLocation?.capturedAt || row.latestLocation?.createdAt || row.latestLocation?.respondedAt || row.latestLocation?.date)}</td><td><button class="button primary" data-request-live-location="${escapeHtml(row.employeeId)}">طلب موقع</button><button class="button ghost" data-route="executive-mobile?employeeId=${escapeHtml(row.employeeId)}">تفاصيل</button></td></tr>`))}
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>كل الموظفين وحالة الموقع</h2><p>اضغط على الكارت لعرض الطلبات والاستجابات المحفوظة.</p></div></div>
        <div class="employee-location-grid">${employeeCards || `<div class="empty-state">لا يوجد موظفون مسجلون.</div>`}</div>
      </article>
    </section>`,
    "مركز مراقبة اللوكيشن",
    "مراقبة GPS وطلبات الموقع المباشر من قاعدة البيانات.",
  );
  app.querySelectorAll("[data-toggle-location-details]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggleLocationDetails;
    app.querySelector(`#location-details-${CSS.escape(id)}`)?.classList.toggle("hidden");
  }));
  app.querySelector("#export-location-monitor")?.addEventListener("click", () => downloadFile("location-monitor.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8"));
  app.querySelectorAll("[data-request-live-location]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await endpoints.requestLiveLocation(button.dataset.requestLiveLocation, { reason: DEFAULT_LIVE_LOCATION_REASON, requestedByName: EXECUTIVE_REQUESTER_NAME });
      setMessage("تم اعتماد طلب الموقع وإرساله مباشرة للموظف. بانتظار إرسال الموقع من الموظف.", "");
    } catch (error) {
      setMessage("", error.message || "تعذر طلب الموقع.");
    }
    render();
  }));
}

async function renderKpi() {
  const payload = unwrap(await endpoints.kpi());
  const ref = await referenceData();
  const policy = payload.policy || {};
  const cycle = payload.cycle || {};
  const criteria = payload.criteria || [];
  const evaluations = payload.evaluations || payload.summaries || [];
  const progressMetrics = payload.progressMetrics || [];
  const windowInfo = payload.windowInfo || cycle.window || {};
  const pendingEmployees = payload.pendingEmployees || [];
  const isSelf = payload.accessMode === "self";
  const isTeam = payload.accessMode === "team";
  const isHr = payload.accessMode === "hr";
  const isExecutive = payload.accessMode === "executive";
  const isSecretaryStage = payload.accessMode === "all";
  const stageConfig = isSelf
    ? { input: ["DRAFT", "REJECTED", "SELF_SUBMITTED"], output: "SELF_SUBMITTED", title: "تقييم ذاتي", action: "رفع للمدير المباشر" }
    : isTeam
      ? { input: ["SELF_SUBMITTED"], output: "MANAGER_APPROVED", title: "مراجعة المدير المباشر", action: "اعتماد المدير وتسليم HR" }
      : isHr
        ? { input: ["MANAGER_APPROVED"], output: "HR_REVIEWED", title: "مراجعة HR", action: "إكمال HR وتسليم السكرتير" }
        : isExecutive
          ? { input: ["SECRETARY_REVIEWED"], output: "EXECUTIVE_APPROVED", title: "اعتماد المدير التنفيذي", action: "اعتماد نهائي" }
          : { input: ["HR_REVIEWED"], output: "SECRETARY_REVIEWED", title: "مراجعة السكرتير التنفيذي/التقني", action: "تسليم للمدير التنفيذي" };
  const nextKpiStatus = stageConfig.output;
  const actionableEvaluations = isSelf ? evaluations : evaluations.filter((item) => stageConfig.input.includes(String(item.status || "DRAFT")));
  const formEvaluation = actionableEvaluations[0] || (isSelf ? evaluations.find((item) => item.employeeId === payload.currentEmployeeId) : null) || {};
  const employees = isSelf
    ? (ref.employees || []).filter((employee) => employee.id === payload.currentEmployeeId)
    : actionableEvaluations.map((item) => item.employee || (ref.employees || []).find((employee) => employee.id === item.employeeId)).filter(Boolean);
  const employeeOptions = optionList(employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })), isSelf ? payload.currentEmployeeId : (formEvaluation.employeeId || ""), isSelf ? "" : "اختر نموذجًا جاهزًا لهذه المرحلة");
  const managerOptions = optionList(ref.employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })), formEvaluation.managerEmployeeId || state.user?.employeeId || "", "المدير المباشر من ملف الموظف");
  const metricCards = (payload.metrics || []).map((metric) => `<article class="metric span-3"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.helper || "")}</small></article>`).join("");
  const progressCards = progressMetrics.map((metric) => `<article class="metric span-2"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><small>${escapeHtml(metric.helper || "")}</small></article>`).join("");
  shell(
    `<section class="grid kpi-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head">
          <div>
            <h2>${stageConfig.title}</h2>
            <p>${escapeHtml(policy.description || "يبدأ التقييم من يوم 20 وينتهي يوم 25 من نفس الشهر.")}</p>
          </div>
          ${payload.accessMode === "all" ? `<div class="toolbar"><button class="button primary" id="recompute-kpi">تجهيز تقييمات ناقصة</button><button class="button ghost" id="send-kpi-reminders">إرسال تذكيرات KPI</button><button class="button danger" id="close-kpi-cycle">إغلاق الدورة</button></div>` : isExecutive ? `<button class="button primary" id="close-kpi-cycle">إغلاق/اعتماد إغلاق الدورة</button>` : ""}
        </div>
        <div class="kpi-policy-strip">
          <span>بداية التقييم: يوم ${escapeHtml(policy.evaluationStartDay || 20)}</span>
          <span>نهاية التقييم: يوم ${escapeHtml(policy.evaluationEndDay || 25)}</span>
          <span>آخر موعد للتسليم: يوم ${escapeHtml(policy.submissionDeadlineDay || 25)}</span>
          <span>الحالة الحالية: ${escapeHtml(windowInfo.label || "-")}</span>
          <span>${escapeHtml(windowInfo.message || "الموظف يرفع تقييمه للمدير المباشر ثم يعتمد المدير أو يعدل قبل التسليم")}</span>
        </div>
      </article>
      ${metricCards}
      ${progressCards ? `<article class="panel span-12"><div class="panel-head"><div><h2>متابعة مراحل الاعتماد</h2><p>من الموظف حتى المدير التنفيذي</p></div></div><div class="grid nested-metrics">${progressCards}</div></article>` : ""}
      <article class="panel span-5">
        <h2>${isSelf ? "إرسال تقييمي لمديري المباشر" : stageConfig.title}</h2>
        ${!isSelf && !actionableEvaluations.length ? `<div class="notice">لا توجد نماذج جاهزة لهذه المرحلة الآن. المدير لا يستطيع بدء تقييم من الصفر؛ يجب أن يبدأ الموظف أولًا.</div>` : ""}
        <form id="kpi-form" class="form-grid compact-form">
          <label>الموظف<select name="employeeId" required ${isSelf ? "disabled" : ""}>${employeeOptions}</select></label>
          ${isSelf ? `<input type="hidden" name="employeeId" value="${escapeHtml(payload.currentEmployeeId || "")}" />` : ""}
          <label>المدير المباشر<select name="managerEmployeeId" ${isSelf ? "disabled" : ""}>${managerOptions}</select></label>
          ${isSelf ? `<input type="hidden" name="managerEmployeeId" value="${escapeHtml(state.user?.employee?.managerEmployeeId || "")}" />` : ""}
          <label>تاريخ الجلسة<input name="evaluationDate" type="date" value="${escapeHtml(cycle.startsOn || new Date().toISOString().slice(0, 10))}" required /></label>
          <label>حالة التقييم<select name="status">${optionList([{ value: stageConfig.output, name: stageConfig.action }], stageConfig.output)}</select></label>
          ${!isHr ? `<label>تحقيق الأهداف / 40<input name="targetScore" type="number" min="0" max="40" step="0.5" value="${escapeHtml(formEvaluation.targetScore ?? 0)}" /></label>
          <label>الكفاءة في أداء المهام / 20<input name="efficiencyScore" type="number" min="0" max="20" step="0.5" value="${escapeHtml(formEvaluation.efficiencyScore ?? 0)}" /></label>
          <label>حسن التعامل والسلوك / 5<input name="conductScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(formEvaluation.conductScore ?? 0)}" /></label>
          <label>التبرعات والمبادرات / 5<input name="initiativesScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(formEvaluation.initiativesScore ?? 0)}" /></label>` : ""}
          ${(isHr || payload.accessMode === "all") ? `<label>الالتزام بمواعيد العمل حضورًا وانصرافًا / 20<input name="attendanceScore" type="number" min="0" max="20" step="0.5" value="${escapeHtml(formEvaluation.attendanceScore ?? "")}" placeholder="يحسب تلقائيًا إن تُرك فارغًا" /></label>
          <label>الالتزام بالصلاة في المسجد / 5<input name="prayerScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(formEvaluation.prayerScore ?? 0)}" /></label>
          <label>حضور حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد / 5<input name="quranCircleScore" type="number" min="0" max="5" step="0.5" value="${escapeHtml(formEvaluation.quranCircleScore ?? 0)}" /></label>` : `<div class="notice span-2">خاص بـ HR — بنود HR فقط: الحضور والانصراف /20، الصلاة في المسجد /5، حضور حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد /5.</div>`}
          <label class="span-2">${isSelf ? "ملاحظات الموظف" : isHr ? "ملاحظات HR" : isExecutive ? "ملاحظات المدير التنفيذي" : isSecretaryStage ? "ملاحظات السكرتير التنفيذي/التقني" : "ملاحظات المدير"}<textarea name="${isSelf ? "employeeNotes" : isHr ? "hrNotes" : isExecutive ? "executiveNotes" : isSecretaryStage ? "secretaryNotes" : "managerNotes"}" placeholder="${isSelf ? "اكتب ملخص تقييمك الذاتي" : "اكتب ملاحظات المرحلة الحالية"}">${escapeHtml(isSelf ? formEvaluation.employeeNotes || "" : isHr ? formEvaluation.hrNotes || "" : isExecutive ? formEvaluation.executiveNotes || "" : isSecretaryStage ? formEvaluation.secretaryNotes || "" : formEvaluation.managerNotes || "")}</textarea></label>
          <label class="checkbox-row"><input name="meetingHeld" type="checkbox" checked /> تمت جلسة التقييم بين الموظف ومديره المباشر</label>
          <div class="form-actions"><button class="button primary" type="submit" ${(isSelf && windowInfo.isOpen === false) || (!isSelf && !actionableEvaluations.length) ? "disabled" : ""}>${isSelf ? "رفع التقييم للمدير" : stageConfig.action}</button></div>
        </form>
      </article>
      <article class="panel span-7">
        <div class="panel-head"><div><h2>معايير التقييم</h2><p>إجمالي النموذج 100 درجة</p></div><strong>${escapeHtml(cycle.name || "الدورة الحالية")}</strong></div>
        ${table(["المعيار", "الدرجة", "النوع", "الوصف"], criteria.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.maxScore || item.weight || item.weightPercentage)} درجة</td><td>${escapeHtml(item.parentCode || item.scoringType || "-")}</td><td>${escapeHtml(item.description || "-")}</td></tr>`))}
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>${isSelf ? "تقييمي الحالي" : "تقييمات الدورة الحالية"}</h2><p>آخر موعد لتسليم التقييمات يوم 25 من الشهر — الفترة الرسمية من يوم 20 إلى 25</p></div>${payload.accessMode !== "self" ? `<button class="button ghost" id="export-kpi-csv">تصدير CSV</button>` : ""}</div>
        ${table(["الترتيب", "الموظف", "المدير", "الأهداف", "الكفاءة", "الحضور", "السلوكيات", "المبادرات", "الإجمالي", "التقدير", "الحالة", "إجراءات"], evaluations.map((item) => `<tr>
          <td>${escapeHtml(item.rank || "-")}</td>
          <td>${escapeHtml(item.employee?.fullName || item.employeeId)}</td>
          <td>${escapeHtml(item.manager?.fullName || item.managerEmployeeId || "-")}</td>
          <td>${escapeHtml(item.targetScore ?? "-")}/40</td>
          <td>${escapeHtml(item.efficiencyScore ?? "-")}/20</td>
          <td>${escapeHtml(item.attendanceScore ?? "-")}/20</td>
          <td>${escapeHtml((Number(item.conductScore || 0) + Number(item.prayerScore || 0) + Number(item.quranCircleScore || 0)).toFixed(1))}/15</td>
          <td>${escapeHtml(item.initiativesScore ?? "-")}/5</td>
          <td><strong>${escapeHtml(item.totalScore ?? "-")}/100</strong></td>
          <td>${escapeHtml(item.rating || item.grade || "-")}</td>
          <td>${badge(item.status || "DRAFT")}</td>
          <td>${payload.accessMode === "self" ? "-" : stageConfig.input.includes(String(item.status || "DRAFT")) ? `<button class="button ghost" data-kpi-action="approve" data-next-status="${escapeHtml(nextKpiStatus)}" data-id="${escapeHtml(item.id)}">${escapeHtml(stageConfig.action)}</button>` : `<span class="muted">بانتظار المرحلة السابقة</span>`}</td>
        </tr>`))}
      </article>
      <article class="panel span-12">
        <h2>${isSelf ? "الخطوة التالية" : "موظفون لم يتم تقييمهم بعد"}</h2>
        <div class="chips">${isSelf ? `<span class="chip">بعد رفع تقييمك، يظهر للمدير المباشر لاعتماده أو تعديله، ثم ينتقل إلى HR، ثم السكرتير التنفيذي، ثم المدير التنفيذي.</span>` : actionableEvaluations.length ? actionableEvaluations.map((item) => `<span class="chip">${escapeHtml(item.employee?.fullName || item.employeeId)} — ${escapeHtml(stageConfig.action)}</span>`).join("") : pendingEmployees.length ? pendingEmployees.slice(0, 20).map((employee) => `<span class="chip muted">${escapeHtml(employee.fullName)} لم يبدأ التقييم الذاتي</span>`).join("") : `<span class="chip success">لا توجد تقييمات ناقصة</span>`}</div>
      </article>
    </section>`,
    "مؤشرات وتقييم الأداء",
    isSelf ? "الموظف يرى تقييمه فقط ويرفعه لمديره المباشر." : "نموذج KPI شهري يبدأ من يوم 20 إلى 25، مع فصل بنود HR عن بنود الموظف والمدير.",
  );
  app.querySelector("#kpi-form").addEventListener("submit", submitForm(endpoints.saveKpiEvaluation, isSelf ? "تم رفع تقييمك للمدير المباشر." : `تم تنفيذ المرحلة: ${stageConfig.action}`));
  app.querySelector("#recompute-kpi")?.addEventListener("click", async () => {
    const result = await endpoints.recomputeKpi({});
    setMessage(`تم تجهيز ${result.recomputed || 0} تقييم ناقص.`, "");
    render();
  });
  app.querySelector("#send-kpi-reminders")?.addEventListener("click", async () => {
    const result = await endpoints.sendKpiReminders();
    setMessage(`تم إرسال ${result.sent || 0} تذكير KPI حسب المرحلة.`, "");
    render();
  });
  app.querySelector("#close-kpi-cycle")?.addEventListener("click", async () => {
    await endpoints.closeKpiCycle();
    setMessage("تم إغلاق دورة KPI الحالية.", "");
    render();
  });
  app.querySelectorAll("[data-kpi-action]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.updateKpiEvaluation(button.dataset.id, { status: button.dataset.nextStatus || nextKpiStatus });
    setMessage("تم اعتماد التقييم وتسليمه.", "");
    render();
  }));
  app.querySelector("#export-kpi-csv")?.addEventListener("click", () => {
    const rows = [["الموظف", "المدير", "الأهداف", "الكفاءة", "الحضور", "السلوكيات", "المبادرات", "الإجمالي", "الحالة"], ...evaluations.map((item) => [item.employee?.fullName || item.employeeId, item.manager?.fullName || "", item.targetScore, item.efficiencyScore, item.attendanceScore, Number(item.conductScore || 0) + Number(item.prayerScore || 0) + Number(item.quranCircleScore || 0), item.initiativesScore, item.totalScore, statusLabel(item.status)])];
    downloadFile("monthly-kpi-evaluations.csv", `\ufeff${toCsv(rows)}`, "text/csv;charset=utf-8");
  });
}

function kpiStatusGroups(evaluations = [], pendingEmployees = []) {
  const canonical = (value = "") => String(value || "DRAFT").toUpperCase();
  const group = (status) => evaluations.filter((item) => canonical(item.status) === status);
  return {
    pendingSelf: pendingEmployees || [],
    waitingManager: group("SELF_SUBMITTED"),
    waitingHr: group("MANAGER_APPROVED"),
    waitingSecretary: group("HR_REVIEWED"),
    waitingExecutive: group("SECRETARY_REVIEWED"),
    finalized: evaluations.filter((item) => ["EXECUTIVE_APPROVED", "APPROVED"].includes(canonical(item.status))),
  };
}

function kpiWorkflowTimeline() {
  return `<div class="kpi-workflow-timeline"><span><b>1</b>الموظف يقيّم نفسه</span><span><b>2</b>المدير المباشر يؤكد/يعدل</span><span><b>3</b>HR يكمل بنود HR</span><span><b>4</b>السكرتير التنفيذي يراجع</span><span><b>5</b>المدير التنفيذي يعتمد</span></div>`;
}

function kpiRowsForReport(evaluations = []) {
  return evaluations.map((item) => [item.employee?.fullName || item.employeeId || "-", item.manager?.fullName || item.managerEmployeeId || "-", item.targetScore ?? 0, item.efficiencyScore ?? 0, item.attendanceScore ?? 0, Number(item.conductScore || 0) + Number(item.prayerScore || 0) + Number(item.quranCircleScore || 0), item.initiativesScore ?? 0, item.totalScore ?? 0, item.rating || item.grade || "-", statusLabel(item.status || "DRAFT")]);
}

function employeeChipList(employees = [], label = "") {
  return `<div class="chips scrollable-chips">${employees.length ? employees.slice(0, 80).map((employee) => `<span class="chip muted">${escapeHtml(employee.fullName || employee.name || employee.id)}${label ? ` — ${escapeHtml(label)}` : ""}</span>`).join("") : `<span class="chip success">لا توجد عناصر في هذه المرحلة</span>`}</div>`;
}

function kpiMiniRows(rows = [], actionLabel = "") {
  return table(["الموظف", "المدير", "الإجمالي", "الحالة", "إجراء"], rows.map((item) => `<tr><td>${escapeHtml(item.employee?.fullName || item.employeeId || "-")}</td><td>${escapeHtml(item.manager?.fullName || item.managerEmployeeId || "-")}</td><td><strong>${escapeHtml(item.totalScore ?? "-")}/100</strong></td><td>${badge(item.status || "DRAFT")}</td><td><button class="button ghost small" data-route="kpi">${escapeHtml(actionLabel || "فتح")}</button></td></tr>`));
}

async function renderKpiMonthCenter() {
  const payload = unwrap(await endpoints.kpi());
  const evaluations = payload.evaluations || payload.summaries || [];
  const pendingEmployees = payload.pendingEmployees || [];
  const groups = kpiStatusGroups(evaluations, pendingEmployees);
  const windowInfo = payload.windowInfo || payload.cycle?.window || {};
  const stageCards = [["لم يبدأوا", groups.pendingSelf.length, "موظفون لم يرفعوا التقييم الذاتي", "pending"], ["بانتظار المدير", groups.waitingManager.length, "نماذج رفعها الموظفون وتنتظر المدير", "manager"], ["بانتظار HR", groups.waitingHr.length, "اعتمدها المدير وتحتاج بنود HR", "hr"], ["بانتظار السكرتير", groups.waitingSecretary.length, "اكتملت HR وتحتاج مراجعة تنفيذية", "secretary"], ["بانتظار المدير التنفيذي", groups.waitingExecutive.length, "جاهزة للاعتماد النهائي", "executive"], ["اعتماد نهائي", groups.finalized.length, "نماذج مكتملة", "done"]].map(([label, value, helper, tone]) => `<article class="metric kpi-stage-${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(helper)}</small></article>`).join("");
  shell(`<section class="grid kpi-month-center"><article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>مركز HR لتقييمات الشهر</h2><p>متابعة حقيقية لكل مرحلة: من الموظف حتى الاعتماد النهائي.</p></div><div class="toolbar"><button class="button ghost" id="kpi-remind-all">إرسال تذكيرات حسب المرحلة</button><button class="button primary" data-route="kpi">فتح نموذج المرحلة الحالية</button></div></div>${kpiWorkflowTimeline()}<div class="message compact">الحالة الحالية: ${escapeHtml(windowInfo.label || "-")} — ${escapeHtml(windowInfo.message || "")}</div></article><article class="panel span-12"><div class="grid nested-metrics">${stageCards}</div></article><article class="panel span-6"><h2>بانتظار التقييم الذاتي</h2>${employeeChipList(groups.pendingSelf, "لم يبدأ")}</article><article class="panel span-6"><h2>بانتظار المدير المباشر</h2>${kpiMiniRows(groups.waitingManager, "اعتماد المدير")}</article><article class="panel span-6"><h2>بانتظار HR</h2>${kpiMiniRows(groups.waitingHr, "إكمال HR")}</article><article class="panel span-6"><h2>بانتظار السكرتير التنفيذي</h2>${kpiMiniRows(groups.waitingSecretary, "مراجعة السكرتير")}</article><article class="panel span-6"><h2>بانتظار المدير التنفيذي</h2>${kpiMiniRows(groups.waitingExecutive, "اعتماد نهائي")}</article><article class="panel span-6"><h2>المكتمل</h2>${kpiMiniRows(groups.finalized, "مكتمل")}</article></section>`, "متابعة KPI الشهر", "لوحة HR لمعرفة أين توقف كل نموذج تقييم.");
  app.querySelector("#kpi-remind-all")?.addEventListener("click", async () => { const result = await endpoints.sendKpiReminders(); setMessage(`تم إرسال ${result.sent || 0} تذكير حسب المرحلة.`, ""); render(); });
}

async function renderKpiExecutiveReport() {
  const payload = unwrap(await endpoints.kpi());
  const evaluations = [...(payload.evaluations || payload.summaries || [])].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0));
  const rows = kpiRowsForReport(evaluations);
  const groups = kpiStatusGroups(evaluations, payload.pendingEmployees || []);
  shell(`<section class="grid kpi-executive-report"><article class="panel span-12 accent-panel print-area"><div class="panel-head"><div><h2>تقرير KPI للمدير التنفيذي</h2><p>النسب النهائية لكل موظف، مع حالة الاعتماد وملخص مراحل الدورة.</p></div><div class="toolbar no-print"><button class="button primary" id="print-kpi-report">طباعة / PDF</button><button class="button ghost" id="export-kpi-executive-csv">تصدير CSV</button></div></div>${kpiWorkflowTimeline()}<div class="executive-report-summary"><div><span>إجمالي النماذج</span><strong>${escapeHtml(evaluations.length)}</strong></div><div><span>مكتمل</span><strong>${escapeHtml(groups.finalized.length)}</strong></div><div><span>بانتظار التنفيذي</span><strong>${escapeHtml(groups.waitingExecutive.length)}</strong></div><div><span>لم يبدأوا</span><strong>${escapeHtml(groups.pendingSelf.length)}</strong></div></div></article><article class="panel span-12 print-area">${table(["الموظف", "المدير", "الأهداف", "الكفاءة", "الحضور", "السلوكيات", "المبادرات", "الإجمالي", "التقدير", "الحالة"], rows.map((row) => `<tr>${row.map((cell, index) => index === 7 ? `<td><strong>${escapeHtml(cell)}/100</strong></td>` : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`))}</article></section>`, "تقرير KPI تنفيذي", "جاهز للطباعة أو التصدير مع النسب النهائية.");
  app.querySelector("#print-kpi-report")?.addEventListener("click", () => window.print());
  app.querySelector("#export-kpi-executive-csv")?.addEventListener("click", () => downloadFile("executive-kpi-report.csv", `\ufeff${toCsv([["الموظف", "المدير", "الأهداف", "الكفاءة", "الحضور", "السلوكيات", "المبادرات", "الإجمالي", "التقدير", "الحالة"], ...rows])}`, "text/csv;charset=utf-8"));
}

async function renderKpiCycleLock() {
  const payload = unwrap(await endpoints.kpi());
  const windowInfo = payload.windowInfo || payload.cycle?.window || {};
  const evaluations = payload.evaluations || payload.summaries || [];
  const groups = kpiStatusGroups(evaluations, payload.pendingEmployees || []);
  const blockers = [groups.pendingSelf.length ? `${groups.pendingSelf.length} موظف لم يرفع التقييم الذاتي` : "", groups.waitingManager.length ? `${groups.waitingManager.length} نموذج ينتظر المدير` : "", groups.waitingHr.length ? `${groups.waitingHr.length} نموذج ينتظر HR` : "", groups.waitingSecretary.length ? `${groups.waitingSecretary.length} نموذج ينتظر السكرتير` : "", groups.waitingExecutive.length ? `${groups.waitingExecutive.length} نموذج ينتظر المدير التنفيذي` : ""].filter(Boolean);
  shell(`<section class="grid kpi-cycle-lock"><article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>القفل الذكي لدورة KPI</h2><p>بعد يوم 25 يمنع الموظف والمدير من التعديل، وتستكمل HR والسكرتير والمدير التنفيذي الاعتماد فقط.</p></div><button class="button danger" id="lock-kpi-cycle">إغلاق الدورة الآن</button></div><div class="message ${windowInfo.isClosed ? "success" : "warning"}">الحالة: ${escapeHtml(windowInfo.label || "-")} — ${escapeHtml(windowInfo.message || "")}</div></article><article class="panel span-6"><h2>ما قبل الإغلاق</h2><div class="readiness-grid">${blockers.length ? blockers.map((item) => `<div class="readiness-item warn"><strong>${escapeHtml(item)}</strong><span>يفضل إرسال تذكير قبل القفل.</span></div>`).join("") : `<div class="empty-state">لا توجد عوائق ظاهرة قبل الإغلاق.</div>`}</div></article><article class="panel span-6"><h2>إجراءات سريعة</h2><div class="toolbar stacked"><button class="button ghost" id="kpi-lock-reminders">إرسال تذكير لكل مرحلة</button><button class="button ghost" data-route="kpi-month-center">فتح متابعة الشهر</button><button class="button primary" data-route="kpi-executive-report">تقرير المدير التنفيذي</button></div></article></section>`, "قفل دورة KPI", "تحكم آمن في نهاية دورة التقييم.");
  app.querySelector("#kpi-lock-reminders")?.addEventListener("click", async () => { const result = await endpoints.sendKpiReminders(); setMessage(`تم إرسال ${result.sent || 0} تذكير.`, ""); render(); });
  app.querySelector("#lock-kpi-cycle")?.addEventListener("click", async () => { if (!await confirmAction({ title: "إغلاق دورة KPI", message: "سيتم قفل تعديل الموظف والمدير، وتستكمل المراحل التنفيذية حسب الصلاحيات.", confirmLabel: "إغلاق الدورة", danger: true })) return; await endpoints.closeKpiCycle(); setMessage("تم إغلاق دورة KPI الحالية.", ""); render(); });
}


async function renderReports() {
  const payload = await endpoints.reports();
  const jobs = payload.jobs || [];
  const schedules = payload.schedules || [];
  const templates = payload.templates || [
    { key: "attendance", name: "الحضور والانصراف" },
    { key: "employees", name: "بيانات الموظفين" },
    { key: "requests", name: "الطلبات والموافقات" },
  ];
  shell(
    `<section class="grid reports-hub-page">
      <article class="panel span-4"><h2>طلب تقرير</h2>${simpleForm("report-form", [["title", "العنوان"], ["reportKey", "النوع", "select", optionList(templates.map((item) => ({ value: item.key, name: item.name })))], ["format", "الصيغة", "select", optionList([{ name: "csv" }, { name: "excel" }, { name: "pdf" }, { name: "json" }])]], "إنشاء")}</article>
      <article class="panel span-8">
        <div class="panel-head"><div><h2>مركز التصدير</h2><p>تصدير فوري CSV/Excel/PDF مع قالب الجمعية.</p></div></div>
        <form id="quick-report-form" class="form-grid compact-form">
          <label>نوع التقرير<select name="reportKey">${optionList(templates.map((item) => ({ value: item.key, name: item.name })))}</select></label>
          <label>الفترة من<input name="from" type="date" /></label>
          <label>إلى<input name="to" type="date" /></label>
          <div class="form-actions"><button class="button ghost" type="button" data-export-format="csv">CSV</button><button class="button ghost" type="button" data-export-format="xls">Excel</button><button class="button primary" type="button" data-export-format="pdf">طباعة / PDF</button></div>
        </form>
      </article>
      <article class="panel span-5">
        <h2>جدولة التقارير</h2>
        <form id="report-schedule-form" class="form-grid compact-form">
          <label>اسم الجدولة<input name="title" value="تقرير شهري للإدارة" /></label>
          <label>نوع التقرير<select name="reportKey">${optionList(templates.map((item) => ({ value: item.key, name: item.name })))}</select></label>
          <label>التكرار<select name="frequency"><option value="weekly">أسبوعي</option><option value="monthly" selected>شهري</option></select></label>
          <label>المستلمون<input name="recipients" placeholder="email@example.com" /></label>
          <div class="form-actions"><button class="button primary">حفظ الجدولة</button></div>
        </form>
      </article>
      <article class="panel span-7"><h2>الجداول المحفوظة</h2>${table(["الاسم", "النوع", "التكرار", "المستلمون", "التاريخ"], schedules.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.reportKey)}</td><td>${escapeHtml(item.frequency)}</td><td>${escapeHtml(item.recipients || "-")}</td><td>${date(item.createdAt)}</td></tr>`))}</article>
      <article class="panel span-12"><div class="panel-head"><h2>التقارير المنشأة</h2><div class="toolbar"><button class="button ghost" id="export-system-json">Backup JSON</button></div></div>${table(["العنوان", "النوع", "الصيغة", "الحالة", "التاريخ"], jobs.map((job) => `<tr><td>${escapeHtml(job.title)}</td><td>${escapeHtml(job.reportKey)}</td><td>${escapeHtml(job.format)}</td><td>${badge(job.status)}</td><td>${date(job.createdAt)}</td></tr>`))}</article>
    </section>`,
    "التقارير",
    "إنشاء وتصدير وجدولة التقارير التشغيلية.",
  );
  app.querySelector("#report-form").addEventListener("submit", submitForm(endpoints.createReport, "تم إنشاء التقرير."));
  app.querySelector("#report-schedule-form")?.addEventListener("submit", submitForm(endpoints.saveReportSchedule, "تم حفظ جدولة التقرير."));
  const exportQuick = async (format) => {
    const values = readForm(app.querySelector("#quick-report-form"));
    const report = await endpoints.exportReportData(values).then(unwrap);
    const headers = report.headers || [];
    const rows = report.rows || [];
    const name = `${values.reportKey || "report"}-${new Date().toISOString().slice(0,10)}`;
    if (format === "csv") return downloadFile(`${name}.csv`, `\ufeff${toCsv([headers, ...rows])}`, "text/csv;charset=utf-8");
    if (format === "xls") return exportHtmlTable(`${name}.xls`, headers, rows);
    return printBrandedReport(report.title || "تقرير", `<div class="summary"><div><span>عدد السجلات</span><strong>${rows.length}</strong></div><div><span>نوع التقرير</span><strong>${escapeHtml(values.reportKey || "attendance")}</strong></div></div>`, headers, rows);
  };
  app.querySelectorAll("[data-export-format]").forEach((button) => button.addEventListener("click", () => exportQuick(button.dataset.exportFormat)));
  app.querySelector("#export-system-json").addEventListener("click", async () => downloadFile("hr-backup.json", JSON.stringify(await endpoints.backup(), null, 2), "application/json;charset=utf-8"));
}


async function renderAudit() {
  const logs = await endpoints.auditLogs().then(unwrap);
  shell(
    `<section class="panel">
      <div class="panel-head"><div><h2>سجل التدقيق</h2><p>كل العمليات المهمة تحفظ هنا للمراجعة</p></div><button class="button ghost" id="export-audit">تصدير</button></div>
      ${table(["العملية", "الكيان", "المعرف", "المستخدم", "التاريخ"], logs.map((log) => `<tr><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entityType)}</td><td>${escapeHtml(log.entityId)}</td><td>${escapeHtml(log.actor || log.actorUserId || "-")}</td><td>${date(log.createdAt)}</td></tr>`))}
    </section>`,
    "سجل التدقيق",
    "Audit Log للعمليات المهمة.",
  );
  app.querySelector("#export-audit").addEventListener("click", () => downloadFile("audit-log.csv", `\ufeff${toCsv([["action","entity","id","actor","date"], ...logs.map((l) => [l.action, l.entityType, l.entityId, l.actor, l.createdAt])])}`, "text/csv;charset=utf-8"));
}

async function renderNotifications() {
  const monitor = await endpoints.notificationMonitor().then(unwrap).catch(async () => {
    const [items, ref] = await Promise.all([endpoints.notifications().then(unwrap), referenceData()]);
    return { metrics: {}, notifications: safeList(items), employees: safeList(ref.employees), pushSubscriptions: [], missingPush: [], locationFlow: [] };
  });
  const rows = safeList(monitor.notifications);
  const employees = safeList(monitor.employees);
  const metrics = monitor.metrics || {};
  const recent = rows.slice(0, 120);
  const urgentRows = safeList(monitor.actionRequired).length ? safeList(monitor.actionRequired).slice(0, 20) : recent.filter((item) => !item.isRead || ["ACTION_REQUIRED", "WARNING", "HIGH"].includes(String(item.type || item.status || item.priority || "").toUpperCase())).slice(0, 20);
  const byEmployee = new Map(employees.map((employee) => [employee.id, employee]));
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const swReady = Boolean(navigator.serviceWorker);
  let pushStatus = "غير مفعل";
  try {
    const reg = swReady ? await navigator.serviceWorker.ready : null;
    const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
    pushStatus = sub ? "مشترك فعليًا" : "لا يوجد اشتراك محفوظ على هذا الجهاز";
  } catch {
    pushStatus = "تعذر قراءة اشتراك الجهاز";
  }
  const subscriptionRows = safeList(monitor.pushSubscriptions).slice(0, 80);
  const missingPushRows = safeList(monitor.missingPush).slice(0, 30);
  const flowRows = safeList(monitor.locationFlow).slice(0, 30);
  shell(
    `<section class="grid notifications-hub-page ops-monitor-page live-bound-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>مركز مراقبة الإشعارات الحقيقي</h2><p>مربوط بجدول notifications و push_subscriptions وطلبات الموقع المباشر، ويعرض ما وصل وما يحتاج إصلاحًا.</p></div><div class="toolbar"><button class="button ghost" type="button" id="enable-browser-notifications">تفعيل/تحديث Push</button><button class="button primary" type="button" id="test-local-notification">اختبار إشعار محلي</button></div></div>
        <div class="metric-grid">
          ${metric("كل الإشعارات", metrics.notifications ?? rows.length, "من جدول notifications")}
          ${metric("غير مقروء", metrics.unread ?? rows.filter((item)=>!item.isRead).length, "يحتاج متابعة")}
          ${metric("مطلوب إجراء", metrics.actionRequired ?? urgentRows.length, "موقع/قرار/تنبيه")}
          ${metric("Push نشط", `${metrics.activePush ?? 0}/${metrics.pushSubscriptions ?? 0}`, pushStatus)}
          ${metric("موظفون بلا Push", metrics.missingPush ?? missingPushRows.length, "قد لا تصلهم إشعارات خارج التطبيق")}
          ${metric("طلبات موقع معلقة", metrics.livePending ?? 0, "بانتظار رد الموظف")}
        </div>
        <div class="health-strip">${healthBadge(permission === "granted", "إذن الإشعارات")} ${healthBadge(swReady, "Service Worker")} ${healthBadge(pushStatus === "مشترك فعليًا", "اشتراك الجهاز الحالي")}</div>
      </article>
      <article class="panel span-5">
        <div class="panel-head"><div><h2>إرسال إعلان أو تنبيه</h2><p>يُسجّل كإشعار داخلي ويُدفع عبر Web Push عند توفر اشتراك الموظف.</p></div></div>
        <form id="announcement-form" class="form-grid compact-form">
          <label>نوع الرسالة<select name="type"><option value="ANNOUNCEMENT">إعلان إداري</option><option value="REMINDER">تذكير</option><option value="ACTION_REQUIRED">مطلوب إجراء</option><option value="DECISION">قرار إداري</option></select></label>
          <label>العنوان<input name="title" value="تذكير إداري مهم" /></label>
          <label>الجمهور<select name="audience"><option value="all">كل الموظفين</option><option value="managers">المديرون فقط</option></select></label>
          <label class="span-2">المحتوى<textarea name="body" placeholder="اكتب نص الإعلان أو التذكير أو التعليمات"></textarea></label>
          <div class="form-actions"><button class="button primary">إرسال عبر القناة الداخلية</button></div>
        </form>
      </article>
      <article class="panel span-7">
        <div class="panel-head"><div><h2>العاجل أولًا</h2><p>غير المقروء والمطلوب إجراء وطلبات الموقع.</p></div><button class="button ghost" data-route="locations">مركز اللوكيشن</button></div>
        ${table(["العنوان", "الموظف", "النوع", "الحالة", "التاريخ", "إجراء"], urgentRows.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body || "")}</small></td><td>${escapeHtml(byEmployee.get(item.employeeId)?.fullName || item.employee?.fullName || item.employeeId || "عام")}</td><td>${escapeHtml(item.type || "-")}</td><td>${badge(item.isRead ? "READ" : "UNREAD")}</td><td>${date(item.createdAt)}</td><td>${item.isRead ? "" : `<button class="button ghost" data-read="${escapeHtml(item.id)}">تعليم كمقروء</button>`}</td></tr>`))}
      </article>
      <article class="panel span-6">
        <div class="panel-head"><div><h2>حالة أجهزة Push</h2><p>أي موظف بلا اشتراك نشط لن يصله التنبيه خارج التطبيق.</p></div><button class="button ghost" data-route="trusted-devices">مركز الأجهزة</button></div>
        ${table(["الموظف", "الهاتف", "الحالة", "إجراء"], missingPushRows.map((employee) => `<tr><td class="person-cell">${avatar(employee,"tiny")}<span>${escapeHtml(employee.fullName || "-")}</span></td><td>${escapeHtml(employee.phone || "-")}</td><td>${badge("NO_DEVICE")}</td><td><button class="button ghost" data-route="employee-archive?id=${escapeHtml(employee.id)}">ملف الموظف</button></td></tr>`))}
      </article>
      <article class="panel span-6">
        <div class="panel-head"><div><h2>مسار طلبات الموقع</h2><p>يربط طلب المدير التنفيذي برد الموظف.</p></div></div>
        ${table(["الموظف", "الطلب", "الرد", "التاريخ"], flowRows.map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || byEmployee.get(row.employeeId)?.fullName || row.employeeId || "-")}</td><td>${badge(row.status || "PENDING")}<br><small>${escapeHtml(row.reason || "")}</small></td><td>${row.response ? badge(row.response.status || row.responseStatus || "LIVE_SHARED") : "بانتظار الرد"}</td><td>${date(row.createdAt || row.respondedAt)}</td></tr>`))}
      </article>
      <article class="panel span-12">
        <div class="panel-head"><div><h2>سجل الإشعارات الكامل</h2><p>آخر 120 إشعارًا من قاعدة البيانات.</p></div><button class="button ghost" id="export-notification-monitor">تصدير JSON</button></div>
        ${table(["العنوان", "المحتوى", "الموظف", "الحالة", "التاريخ"], recent.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.body || "")}</td><td>${escapeHtml(byEmployee.get(item.employeeId)?.fullName || item.employee?.fullName || item.employeeId || "عام")}</td><td>${badge(item.isRead ? "READ" : "UNREAD")}</td><td>${date(item.createdAt)}</td></tr>`))}
      </article>
    </section>`,
    "مركز مراقبة الإشعارات",
    "تتبع الإرسال والقراءة وحالة Push وربطها بطلبات الموقع.",
  );
  app.querySelector("#announcement-form")?.addEventListener("submit", submitForm(endpoints.createAnnouncement, "تم إرسال الإعلان للموظفين."));
  app.querySelector("#enable-browser-notifications")?.addEventListener("click", async () => { try { await enableWebPushSubscription(endpoints); setMessage("تم تفعيل/تحديث اشتراك Web Push الحقيقي لهذا المتصفح.", ""); } catch (error) { setMessage("", error.message || "تعذر تفعيل الإشعارات."); } render(); });
  app.querySelector("#test-local-notification")?.addEventListener("click", async () => { try { await enableBrowserNotifications(); setMessage("تم إرسال إشعار اختبار محلي على هذا الجهاز.", ""); } catch (error) { setMessage("", error.message || "تعذر اختبار الإشعار."); } });
  app.querySelector("#export-notification-monitor")?.addEventListener("click", () => downloadFile("notification-monitor.json", JSON.stringify(monitor, null, 2), "application/json;charset=utf-8"));
  app.querySelectorAll("[data-read]").forEach((button) => button.addEventListener("click", async () => { await endpoints.markNotificationRead(button.dataset.read); render(); }));
}


function renderRouteAccess() {
  const permissions = [...currentPermissions()].sort();
  const rows = Object.entries(routePermissions).map(([key, scopes]) => {
    const allowed = canRoute(key);
    const matched = hasFullAccess() ? ["*"] : scopes.filter((scope) => currentPermissions().has(scope));
    return `<tr>
      <td><strong>${escapeHtml(routeDisplayName(key))}</strong><small>${escapeHtml(key)}</small></td>
      <td><div class="scope-list">${scopes.length ? scopes.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("") : `<span>عام</span>`}</div></td>
      <td><div class="scope-list matched">${matched.length ? matched.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("") : `<span>لا يوجد تطابق</span>`}</div></td>
      <td>${allowed ? badge("APPROVED") : badge("REJECTED")}</td>
    </tr>`;
  });
  shell(
    `<section class="grid">
      <article class="panel span-4">
        <h2>ملخص دورك الحالي</h2>
        <div class="meta-grid">
          <span><strong>الدور</strong>${escapeHtml(roleLabel())}</span>
          <span><strong>نوع الوصول</strong>${hasFullAccess() ? "صلاحيات كاملة" : "حسب الصلاحيات"}</span>
          <span><strong>عدد الصلاحيات المقروءة</strong>${escapeHtml(permissions.length)}</span>
        </div>
        <div class="scope-list all-scopes">${permissions.length ? permissions.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("") : `<span>لا توجد صلاحيات مباشرة؛ راجع ربط الدور بالملف.</span>`}</div>
      </article>
      <article class="panel span-8">
        <div class="panel-head"><div><h2>سبب ظهور أو اختفاء الصفحات</h2><p>هذه الصفحة تساعدك على معرفة الـ Route المطلوب والصلاحية التي تسمح بفتحه.</p></div></div>
        ${table(["الصفحة", "الصلاحيات المطلوبة", "المتطابق مع حسابك", "الحالة"], rows, "route-access-table")}
      </article>
    </section>`,
    "صلاحيات الواجهة",
    "تشخيص واضح لمسارات النظام بناءً على الدور والصلاحيات الحالية.",
  );
}

async function renderSettings() {
  const [health, settingsPayload] = await Promise.all([endpoints.health(), endpoints.settings().then(unwrap)]);
  const settingsRows = Array.isArray(settingsPayload)
    ? settingsPayload
    : Object.entries(settingsPayload || {}).map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : value }));
  shell(
    `<section class="grid">
      <article class="panel span-6"><h2>حالة التشغيل السريعة</h2>${table(["البند", "القيمة"], [`<tr><td>التطبيق</td><td>${escapeHtml(health.app || health.mode || "HR")}</td></tr>`, `<tr><td>قاعدة البيانات</td><td>${escapeHtml(health.database?.mode || health.database || "-")} / متصلة</td></tr>`, `<tr><td>الجلسات</td><td>${health.authEnforced ? "مفعلة" : "اختيارية"}</td></tr>`, `<tr><td>الإصدار</td><td>${escapeHtml(health.version || "-")}</td></tr>`])}</article>
      <article class="panel span-6 account-avatar-panel"><div class="panel-head"><div><h2>صورة حسابي</h2><p>تعديل Avatar المستخدم الحالي ويظهر في أعلى النظام وقائمة المستخدمين.</p></div>${avatar(userAvatarSubject(), "large")}</div><div class="toolbar spaced"><input type="file" id="current-user-avatar" accept="image/png,image/jpeg,image/webp,image/gif" /><button class="button primary" id="save-current-avatar" type="button">حفظ صورة الحساب</button></div></article>
      <article class="panel span-6"><h2>تعديل الإعدادات</h2><form id="settings-form" class="form-grid">${settingsRows.map((item) => `<label>${escapeHtml(item.key)}<input name="${escapeHtml(item.key)}" value="${escapeHtml(item.value)}" /></label>`).join("")}<div class="form-actions"><button class="button primary">حفظ الإعدادات</button></div></form></article>
      <article class="panel span-6"><h2>تغيير كلمة المرور</h2><form id="password-form" class="form-grid"><label>كلمة المرور الحالية<input type="password" name="currentPassword" required /></label><label>كلمة المرور الجديدة<input type="password" name="newPassword" minlength="8" required /></label><div class="form-actions"><button class="button primary">تغيير كلمة المرور</button></div></form></article>
      <article class="panel span-6"><h2>اختبار GPS سريع</h2><p>اختبار مباشر من الإعدادات لمعرفة دقة الموقع والمسافة من المجمع.</p><button class="button ghost" type="button" data-settings-gps-test>اختبار GPS الآن</button><div id="settings-gps-result" class="risk-box hidden"></div></article>
      <article class="panel span-12"><h2>سياسات الأمان المقترحة</h2>${table(["السياسة", "الحالة"], [["قفل الحساب بعد محاولات فاشلة", "مفعل عند تشغيل Backend"], ["تغيير كلمة المرور المؤقتة", "مدعوم عبر mustChangePassword"], ["سجل آخر IP وجهاز", "مدعوم في قاعدة البيانات"], ["Passkeys", "جاهز كنموذج بيانات وينتظر HTTPS/Domain"]].map(([a,b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`))}</article>
    </section>`,
    "الإعدادات",
    "إعدادات عامة قابلة للتعديل.",
  );
  app.querySelector("#save-current-avatar")?.addEventListener("click", async () => {
    try {
      const file = app.querySelector("#current-user-avatar")?.files?.[0];
      if (!file) return setMessage("", "اختر صورة أولًا.");
      const url = await endpoints.uploadAvatar(file);
      await endpoints.updateUser(state.user.id, { avatarUrl: url, name: state.user.name || state.user.fullName || state.user.email });
      state.user = { ...state.user, avatarUrl: url, photoUrl: url };
      setMessage("تم تحديث صورة الحساب.", "");
      render();
    } catch (error) {
      setMessage("", error.message);
      render();
    }
  });
  app.querySelector("[data-settings-gps-test]")?.addEventListener("click", async () => {
    const box = app.querySelector("#settings-gps-result");
    box.classList.remove("hidden", "danger-box");
    box.textContent = "جاري اختبار GPS...";
    try {
      const current = await getBrowserLocation();
      const evaluation = await endpoints.evaluateGeofence(current);
      const ok = evaluation.allowed || evaluation.canRecord;
      box.classList.toggle("danger-box", !ok);
      box.innerHTML = `<strong>${ok ? "مقبول" : "غير مقبول"}</strong><p>${escapeHtml(evaluation.message || "")}</p><div class="meta-grid"><span>الدقة: ${formatMeters(current.accuracyMeters)}</span><span>المسافة: ${formatMeters(evaluation.distanceFromBranchMeters ?? evaluation.distanceMeters)}</span></div>`;
    } catch (error) {
      box.classList.add("danger-box");
      box.textContent = error.message;
    }
  });
  app.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await endpoints.updateSettings(readForm(event.currentTarget));
    setMessage("تم حفظ الإعدادات.", "");
    render();
  });
  app.querySelector("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await endpoints.changePassword(readForm(event.currentTarget));
    event.currentTarget.reset();
    setMessage("تم تغيير كلمة المرور بنجاح.", "");
    render();
  });
}

async function renderComplexSettings() {
  const [address, settingsPayload] = await Promise.all([
    endpoints.attendanceAddress().then(unwrap).catch(() => ({})),
    endpoints.settings().then(unwrap).catch(() => []),
  ]);
  const settingsRows = Array.isArray(settingsPayload) ? settingsPayload : [];
  const getSetting = (key, fallback) => settingsRows.find((item) => item.key === key)?.value ?? fallback;
  const current = {
    name: address.branch?.name || address.name || getSetting("complex.name", "مجمع منيل شيحة"),
    address: cleanAddressText(address.address || address.branch?.address || getSetting("complex.address", "شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912")),
    latitude: address.latitude ?? getSetting("complex.latitude", "29.950738592862045"),
    longitude: address.longitude ?? getSetting("complex.longitude", "31.238094542328678"),
    radiusMeters: address.radiusMeters || getSetting("complex.radiusMeters", 300),
    maxAccuracyMeters: address.maxAccuracyMeters || getSetting("complex.maxAccuracyMeters", 500),
  };
  shell(
    `<section class="grid complex-settings-page">
      <article class="panel span-7">
        <div class="panel-head"><div><h2>إعدادات المجمع الواحد</h2><p>بديل بسيط لصفحات الفروع والأقسام لأن النظام يعمل على مجمع واحد فقط.</p></div>${healthBadge(Boolean(current.latitude && current.longitude), current.latitude && current.longitude ? "إحداثيات موجودة" : "إحداثيات ناقصة")}</div>
        <form id="complex-settings-form" class="form-grid">
          <label>اسم المجمع<input name="name" value="${escapeHtml(current.name)}" required /></label>
          <label>وصف العنوان<input name="address" value="${escapeHtml(current.address)}" required /></label>
          <label>Latitude<input name="latitude" type="number" step="0.00000000000001" value="${escapeHtml(current.latitude)}" required /></label>
          <label>Longitude<input name="longitude" type="number" step="0.00000000000001" value="${escapeHtml(current.longitude)}" required /></label>
          <label>نطاق البصمة بالمتر<input name="radiusMeters" type="number" min="50" max="2000" value="${escapeHtml(current.radiusMeters)}" required /></label>
          <label>أقصى دقة GPS مقبولة<input name="maxAccuracyMeters" type="number" min="50" max="2000" value="${escapeHtml(current.maxAccuracyMeters)}" required /></label>
          <div class="form-actions wide"><button class="button primary" type="submit">حفظ إعدادات المجمع</button><button class="button ghost" type="button" data-test-gps>اختبار GPS الآن</button></div>
        </form>
      </article>
      <article class="panel span-5">
        <h2>اختبار سريع للموقع</h2>
        <div id="gps-test-result" class="risk-box hidden"></div>
        <div class="address-card compact-address-card">
          <strong>${escapeHtml(current.name)}</strong>
          <p>${escapeHtml(current.address)}</p>
          <div class="meta-grid"><span>المكان: ${escapeHtml(current.address)}</span><span>الحالة: نقطة GPS محفوظة</span><span>النطاق: ${escapeHtml(current.radiusMeters)} متر</span><span>الدقة: ${escapeHtml(current.maxAccuracyMeters)} متر</span></div>
          <a class="button ghost map-open-btn" target="_blank" rel="noopener" href="https://maps.google.com/?q=${escapeHtml(current.latitude)},${escapeHtml(current.longitude)}">فتح على Google Maps</a>
        </div>
      </article>
    </section>`,
    "إعدادات المجمع",
    "إحداثيات ونطاق البصمة للمجمع الواحد.",
  );
  const result = app.querySelector("#gps-test-result");
  const runGpsTest = async () => {
    result.classList.remove("hidden", "danger-box");
    result.textContent = "جاري قراءة GPS وتقييمه على نطاق المجمع...";
    try {
      const currentLocation = await getBrowserLocation();
      const evaluation = await endpoints.evaluateGeofence(currentLocation);
      const ok = evaluation.allowed || evaluation.canRecord;
      result.classList.toggle("danger-box", !ok);
      result.innerHTML = `<strong>${ok ? "الموقع مقبول" : "الموقع يحتاج مراجعة"}</strong><p>${escapeHtml(evaluation.message || "")}</p><div class="meta-grid"><span>المكان: ${escapeHtml(locationPlaceLabel(currentLocation))}</span><span>دقة جهازك: ${formatMeters(currentLocation.accuracyMeters)}</span><span>المسافة: ${formatMeters(evaluation.distanceFromBranchMeters ?? evaluation.distanceMeters)}</span></div>`;
    } catch (error) {
      result.classList.add("danger-box");
      result.textContent = error.message;
    }
  };
  app.querySelector("[data-test-gps]")?.addEventListener("click", runGpsTest);
  app.querySelector("#complex-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    await endpoints.updateComplexSettings(values);
    setMessage("تم حفظ إعدادات المجمع ونطاق البصمة.", "");
    render();
  });
}

async function renderSystemDiagnostics() {
  const [diag, users, employees, browserDiag] = await Promise.all([
    endpoints.systemDiagnostics().catch((error) => ({ error: error.message, checks: [] })),
    endpoints.users().then(unwrap).catch(() => []),
    endpoints.employees().then(unwrap).catch(() => []),
    runRuntimeDiagnostics({ includeNetwork: true }).catch((error) => ({ score: 0, results: [{ label: "فحص المتصفح", level: "bad", detail: error.message }], blockers: [], warnings: [] })),
  ]);
  const unlinkedUsers = (users || []).filter((user) => !user.employeeId);
  const usersByEmployee = new Set((users || []).map((user) => user.employeeId).filter(Boolean));
  const unlinkedEmployees = (employees || []).filter((employee) => !usersByEmployee.has(employee.id));
  shell(
    `<section class="grid diagnostics-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>مركز اختبار النظام</h2><p>يفحص Supabase/Auth/Storage وربط المستخدمين بالموظفين وإعدادات البصمة من صفحة واحدة.</p></div><div class="toolbar"><button class="button ghost" data-run-autolink>ربط المستخدمين بالموظفين حسب البريد</button><button class="button primary" data-route="complex-settings">إعدادات المجمع</button></div></div>
      </article>
      <article class="panel span-7"><h2>الفحوصات الأساسية</h2>${table(["الفحص", "الحالة", "التفاصيل"], (diag.checks || []).map((check) => `<tr><td>${escapeHtml(check.label)}</td><td>${healthBadge(check.ok, check.status || "")}</td><td>${escapeHtml(check.detail || "-")}</td></tr>`))}</article>
      <article class="panel span-5"><h2>مؤشرات سريعة</h2>${table(["البند", "العدد"], [["المستخدمون", users.length], ["الموظفون", employees.length], ["مستخدمون غير مربوطين", unlinkedUsers.length], ["موظفون بلا حساب", unlinkedEmployees.length], ["جاهزية المتصفح", `${browserDiag.score || 0}%`]].map(([a,b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`))}<div class="toolbar"><button class="button ghost" data-export-runtime-diagnostics>تصدير فحص المتصفح</button><button class="button danger" data-clear-runtime-cache>تنظيف كاش الجهاز</button></div></article>
      <article class="panel span-12"><h2>فحص المتصفح والجهاز الحالي</h2>${table(["الفحص", "الحالة", "التفاصيل"], (browserDiag.results || []).map((check) => `<tr><td>${escapeHtml(check.label)}</td><td>${badge(check.level === "ok" ? "APPROVED" : check.level === "bad" ? "REJECTED" : "PENDING")}</td><td>${escapeHtml(check.detail || "-")}</td></tr>`))}</article>
      <article class="panel span-6"><h2>مستخدمون غير مربوطين</h2>${table(["المستخدم", "البريد"], unlinkedUsers.map((user) => `<tr><td>${escapeHtml(user.name || user.fullName || "-")}</td><td>${escapeHtml(user.email || "-")}</td></tr>`))}</article>
      <article class="panel span-6"><h2>موظفون بلا حساب دخول</h2>${table(["الموظف", "البريد"], unlinkedEmployees.map((employee) => `<tr><td>${escapeHtml(employee.fullName || "-")}</td><td>${escapeHtml(employee.email || "-")}</td></tr>`))}</article>
    </section>`,
    "اختبار النظام",
    "فحص جاهزية النظام قبل التجربة أو التسليم.",
  );

  app.querySelector("[data-export-runtime-diagnostics]")?.addEventListener("click", () => downloadFile("runtime-diagnostics.json", JSON.stringify(browserDiag, null, 2), "application/json;charset=utf-8"));
  app.querySelector("[data-clear-runtime-cache]")?.addEventListener("click", async () => {
    if (!await confirmAction({ title: "تنظيف الكاش", message: "سيتم تنظيف كاش هذا الجهاز وإعادة تحميل الصفحة. هل تريد المتابعة؟", confirmLabel: "تنظيف وإعادة تحميل", danger: true })) return;
    await clearRuntimeCaches({ reload: true });
  });
  app.querySelector("[data-run-autolink]")?.addEventListener("click", async () => {
    try {
      const result = await endpoints.autoLinkUsersByEmail();
      setMessage(`تم الربط التلقائي: ${result.linked || 0} سجل.`, "");
      render();
    } catch (error) {
      setMessage("", error.message || "تعذر الربط التلقائي.");
      render();
    }
  });
}

async function renderHealth() {
  const health = await endpoints.health();
  const readiness = health.readiness || { score: 0, grade: "-", parts: [] };
  shell(
    `<section class="grid health-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>مركز فحص النظام</h2><p>نتيجة الجاهزية العامة وفحوصات التشغيل قبل الاعتماد.</p></div><div class="score-ring"><strong>${escapeHtml(readiness.score || 0)}%</strong><span>${escapeHtml(readiness.grade || "-")}</span></div></div><div class="toolbar"><button class="button ghost" id="export-health-json">تصدير تقرير الفحص JSON</button><button class="button ghost" data-route="system-diagnostics">تشخيص أعمق</button></div></article>
      <article class="panel span-5"><h2>ملخص الحالة</h2>${table(["البند", "القيمة"], Object.entries(health.counts || {}).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`))}</article>
      <article class="panel span-7"><h2>الفحوصات</h2>${table(["الفحص", "الحالة", "التفاصيل"], (health.checks || []).map((check) => `<tr><td>${escapeHtml(check.label)}</td><td>${check.ok ? badge("APPROVED") : badge(check.status || "PENDING")}</td><td>${escapeHtml(check.detail || "-")}</td></tr>`))}</article>
      <article class="panel span-12"><h2>خطة المعالجة السريعة</h2><div class="readiness-grid">${safeList(readiness.parts).filter((part) => !part.ok).map((part) => `<div class="readiness-item warn"><strong>${escapeHtml(part.label)}</strong><span>${escapeHtml(part.detail || "")}</span><small>ابدأ من صفحة ${part.key === "location" ? "إعدادات المجمع" : part.key === "linked" ? "المستخدمون" : part.key === "workflow" ? "مركز الطلبات" : "الإعدادات"}</small></div>`).join("") || `<div class="empty-state">لا توجد مشاكل ظاهرة في الفحص المحلي.</div>`}</div></article>
    </section>`,
    "حالة النظام",
    "System Health للتأكد من جاهزية التشغيل.",
  );
  app.querySelector("#export-health-json")?.addEventListener("click", () => downloadFile("system-health-report.json", JSON.stringify(health, null, 2), "application/json;charset=utf-8"));
}

async function renderBackup() {
  const backup = await endpoints.backup().catch(() => ({}));
  const snapshots = backup.systemBackups || [];
  shell(
    `<section class="grid backup-page">
      <article class="panel span-3"><h2>نسخة احتياطية</h2><p>تصدير كل بيانات النظام بصيغة JSON.</p><button class="button primary" id="download-backup">تحميل Backup</button></article>
      <article class="panel span-3"><h2>Snapshot داخلي</h2><p>حفظ آخر 10 نسخ داخل التخزين المحلي للاختبار الداخلي فقط.</p><button class="button" id="save-snapshot">حفظ Snapshot</button></article>
      <article class="panel span-3"><h2>استرجاع Backup</h2><input type="file" id="backup-file" accept="application/json" /><button class="button" id="restore-backup">استرجاع</button></article>
      <article class="panel span-3"><h2>استيراد موظفين</h2><p>ارفع JSON Array للموظفين أو CSV بسيط.</p><input type="file" id="employees-import" accept=".json,.csv,text/csv,application/json" /><button class="button" id="import-employees">استيراد</button></article>
      <article class="panel span-8"><h2>آخر Snapshots</h2>${table(["العنوان", "الموظفون", "المستخدمون", "الحضور", "التاريخ"], snapshots.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.counts?.employees || 0)}</td><td>${escapeHtml(item.counts?.users || 0)}</td><td>${escapeHtml(item.counts?.attendance || 0)}</td><td>${date(item.createdAt)}</td></tr>`))}</article>
      <article class="panel span-4"><h2>إعادة ضبط</h2><p>ترجع البيانات الأولية للنسخة المحلية.</p><button class="button danger" id="reset-data">استرجاع البيانات الأولية</button></article>
    </section>`,
    "نسخ واستيراد",
    "Backup/Restore و Import للموظفين مع Snapshot داخلي.",
  );
  app.querySelector("#download-backup").addEventListener("click", async () => downloadFile("hr-system-backup.json", JSON.stringify(await endpoints.backup(), null, 2), "application/json;charset=utf-8"));
  app.querySelector("#save-snapshot").addEventListener("click", async () => { await endpoints.saveBackupSnapshot({}); setMessage("تم حفظ Snapshot داخلي.", ""); render(); });
  app.querySelector("#restore-backup").addEventListener("click", async () => {
    const file = app.querySelector("#backup-file").files?.[0];
    if (!file) return setMessage("", "اختر ملف Backup أولًا.");
    const db = JSON.parse(await file.text());
    if (!db || typeof db !== "object" || !Array.isArray(db.employees)) return setMessage("", "ملف النسخة غير صالح أو لا يحتوي جدول الموظفين.");
    await endpoints.restoreBackup(db);
    setMessage("تم استرجاع النسخة الاحتياطية.", "");
    render();
  });
  app.querySelector("#import-employees").addEventListener("click", async () => {
    const file = app.querySelector("#employees-import").files?.[0];
    if (!file) return setMessage("", "اختر ملف الاستيراد أولًا.");
    const text = await file.text();
    let rows;
    if (file.name.endsWith(".json")) rows = JSON.parse(text);
    else {
      const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
      const keys = head.split(",").map((x) => x.replaceAll('"', "").trim());
      rows = lines.map((line) => Object.fromEntries(line.split(",").map((cell, index) => [keys[index], cell.replaceAll('"', "").trim()])));
    }
    const result = await endpoints.importEmployees(rows);
    setMessage(`تم استيراد ${result.created} موظف.`, "");
    render();
  });
  app.querySelector("#reset-data").addEventListener("click", async () => {
    if (!await confirmAction({ title: "إعادة ضبط البيانات", message: "سيتم حذف بيانات المتصفح المحلية واسترجاع البيانات الأولية.", confirmLabel: "إعادة الضبط", danger: true })) return;
    await endpoints.reset();
    setMessage("تم استرجاع البيانات الأولية.", "");
    render();
  });
}



async function renderPasswordVault() {
  const rows = await endpoints.passwordVault().then(unwrap);
  shell(
    `<section class="grid">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>خزنة كلمات المرور المؤقتة</h2><p>مخصصة للتقني/الإدارة العليا. في Supabase الحقيقي لا يمكن قراءة كلمة المرور الأصلية بعد إنشائها؛ المتاح أمنيًا هو إصدار كلمة مؤقتة جديدة وإجبار الموظف على تغييرها.</p></div></div>
        <div class="message warning">لا تشارك هذه البيانات إلا مع صاحب الحساب. الأفضل دائمًا استخدام إعادة تعيين كلمة مرور مؤقتة بدل الاحتفاظ بكلمات مرور دائمة.</div>
      </article>
      <article class="panel span-12">
        ${table(["المستخدم", "البريد", "كلمة المرور المؤقتة", "الحالة", "إجراءات"], rows.map((user) => `<tr>
          <td class="person-cell">${avatar(user.employee || user, "tiny")}<span>${escapeHtml(user.name || user.fullName || "-")}<small>${escapeHtml(user.employee?.jobTitle || "")}</small></span></td>
          <td>${escapeHtml(user.email || "-")}</td>
          <td><code class="password-chip">${escapeHtml(user.password || "غير متاحة")}</code></td>
          <td>${badge(user.mustChangePassword ? "INVITED" : user.status || "ACTIVE")}</td>
          <td><button class="button ghost" data-copy-password="${escapeHtml(user.password || "")}">نسخ</button><button class="button danger ghost" data-reset-password="${escapeHtml(user.id)}">إصدار كلمة جديدة</button></td>
        </tr>`))}
      </article>
    </section>`,
    "خزنة كلمات المرور",
    "عرض كلمات المرور المؤقتة وإعادة تعيينها بشكل آمن."
  );
  app.querySelectorAll("[data-copy-password]").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(button.dataset.copyPassword || "");
    setMessage("تم نسخ كلمة المرور المؤقتة.", "");
    render();
  }));
  app.querySelectorAll("[data-reset-password]").forEach((button) => button.addEventListener("click", async () => {
    if (!await confirmAction({ title: "إصدار كلمة مرور جديدة", message: "سيتم إنشاء كلمة مرور مؤقتة جديدة وإجبار الموظف على تغييرها بعد الدخول.", confirmLabel: "إصدار", danger: true })) return;
    const result = await endpoints.resetUserPassword(button.dataset.resetPassword);
    setMessage(`تم إصدار كلمة مؤقتة جديدة: ${result.temporaryPassword}`, "");
    render();
  }));
}


async function renderDisputes() {
  const payload = unwrap(await endpoints.disputes());
  const ref = await referenceData();
  const employees = ref.employees || [];
  const cases = Array.isArray(payload) ? payload : (payload.cases || []);
  const committee = Array.isArray(payload) ? { members: ["مدير مباشر ثالث", "مدير مباشر ثانٍ", "مدير مباشر أول", "السكرتير التنفيذي", "المدير التنفيذي"], mandate: "أي مشكلة تُرفع تلقائيًا إلى مدير مباشر ثالث ومدير مباشر ثانٍ ومدير مباشر أول والسكرتير التنفيذي والمدير التنفيذي، ثم يتم التنسيق والحل أو التصعيد للمدير التنفيذي عبر السكرتير التنفيذي." } : (payload.committee || {});
  const currentEmployeeId = state.user?.employeeId || state.user?.employee?.id || "";
  const employeeOptions = optionList(employees.map((employee) => ({ id: employee.id, name: `${employee.fullName}${employee.jobTitle ? " — " + employee.jobTitle : ""}` })), currentEmployeeId, "اختر الموظف");
  shell(
    `<section class="grid disputes-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>لجنة حل المشاكل والخلافات</h2><p>${escapeHtml(committee.mandate || "أي مشكلة تُرفع تلقائيًا إلى مدير مباشر ثالث ومدير مباشر ثانٍ ومدير مباشر أول والسكرتير التنفيذي والمدير التنفيذي، ثم يتم التنسيق والحل أو التصعيد للمدير التنفيذي عبر السكرتير التنفيذي.")}</p></div></div>
        <div class="chips">${(committee.members || ["لجنة حل المشاكل والخلافات"]).map((member) => `<span class="chip">${escapeHtml(member)}</span>`).join("")}</div>
      </article>
      <article class="panel span-4">
        <h2>طلب شكوى جديد</h2>
        <form id="dispute-form" class="form-grid compact-form">
          <label>عنوان الشكوى<input name="title" required placeholder="مثال: مشكلة إدارية أو خلاف عمل" /></label>
          <label>صاحب الشكوى<select name="employeeId" required>${employeeOptions}</select></label>
          <input type="hidden" name="status" value="IN_REVIEW" />
          <input type="hidden" name="severity" value="MEDIUM" />
          <label class="span-2">سبب الشكوى والتفاصيل<textarea name="description" required placeholder="اكتب السبب والتفاصيل التي تريد عرضها على اللجنة"></textarea></label>
          <div class="form-actions"><button class="button primary" type="submit">رفع الشكوى للجنة</button></div>
        </form>
      </article>
      <article class="panel span-8">
        <h2>سجل الشكاوى</h2>
        ${table(["العنوان", "صاحب الشكوى", "الحالة", "قرار اللجنة", "إجراءات"], cases.map((item) => `<tr>
          <td>${escapeHtml(item.title || "-")}</td>
          <td>${escapeHtml(item.employee?.fullName || employees.find((employee) => employee.id === item.employeeId)?.fullName || "-")}</td>
          <td>${badge(item.status || "IN_REVIEW")}</td>
          <td>${escapeHtml(item.committeeDecision || item.resolution || "لم يصدر قرار بعد")}</td>
          <td><button class="button ghost" data-dispute="${escapeHtml(item.id)}" data-status="RESOLVED">تم الحل</button><button class="button danger ghost" data-dispute="${escapeHtml(item.id)}" data-status="ESCALATED">رفع للإدارة</button></td>
        </tr>`))}
      </article>
    </section>`,
    "الشكاوى وفض الخلافات",
    "تسجيل شكوى بسبب واضح ثم إحالتها للجنة حل المشاكل والخلافات.",
  );
  app.querySelector("#dispute-form").addEventListener("submit", submitForm(endpoints.createDispute, "تم رفع الشكوى إلى لجنة حل المشاكل والخلافات."));
  app.querySelectorAll("[data-dispute]").forEach((button) => button.addEventListener("click", async () => {
    const status = button.dataset.status;
    const committeeDecision = status === "RESOLVED" ? "تم حل الشكوى بواسطة لجنة حل المشاكل والخلافات." : "تم رفع الشكوى للإدارة لاستكمال القرار.";
    await endpoints.updateDispute(button.dataset.dispute, { status, committeeDecision, escalatedToExecutive: status === "ESCALATED" });
    setMessage(status === "RESOLVED" ? "تم إغلاق الشكوى بقرار اللجنة." : "تم رفع الشكوى للإدارة.", "");
    render();
  }));
}

async function renderRealtime() {
  const snapshot = await endpoints.realtimeSnapshot();
  const data = snapshot.dashboard || snapshot;
  const locations = snapshot.locations || [];
  shell(
    `<section class="grid">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>لوحة مباشرة Real-time</h2><p>تعمل عبر Supabase Realtime عند تفعيل Supabase، ومع Live Server تستخدم Snapshot محلي.</p></div><strong id="live-state">${escapeHtml(snapshot.realtime?.transport || "snapshot")}</strong></div><div class="toolbar"><button class="button ghost" id="connect-live">اتصال Realtime</button><button class="button ghost" data-route="dashboard">الداشبورد</button></div></article>
      <article class="panel span-7"><h2>خريطة حرارة الموظفين</h2><div class="heatmap-card">${(locations || []).map((loc, index) => `<span class="heat-dot" style="--x:${12 + (index * 17) % 76}%;--y:${18 + (index * 29) % 66}%" title="${escapeHtml(loc.employee?.fullName || loc.employeeId)}"></span>`).join("") || `<div class="empty-box">لا توجد مواقع حديثة بعد.</div>`}</div></article>
      <article class="panel span-5"><h2>KPIs لحظية</h2>${table(["المؤشر", "القيمة"], [["الموظفون", data.cards?.employees ?? "-"], ["الحضور اليوم", data.cards?.presentToday ?? "-"], ["طلبات معلقة", data.cards?.pendingRequests ?? "-"], ["إجازات", data.cards?.leavesToday ?? "-"]].map(([a,b]) => `<tr><td>${escapeHtml(a)}</td><td><strong>${escapeHtml(b)}</strong></td></tr>`))}</article>
    </section>`,
    "لوحة Live",
    "متابعة لحظية للحضور والمواقع والمؤشرات.",
  );
  app.querySelector("#connect-live")?.addEventListener("click", () => {
    if (!("WebSocket" in window)) return setMessage("", "المتصفح لا يدعم WebSocket.");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws/live`);
    ws.onopen = () => { app.querySelector("#live-state").textContent = "متصل"; setMessage("تم الاتصال باللوحة اللحظية.", ""); };
    ws.onerror = () => setMessage("", "تعذر الاتصال اللحظي. تأكد من تفعيل Supabase Realtime أو تشغيل الخادم المحلي.");
    ws.onmessage = (event) => { try { const msg = JSON.parse(event.data); if (msg.type === "dashboard.snapshot") app.querySelector("#live-state").textContent = `آخر تحديث ${englishDigits(new Date().toLocaleTimeString("ar-EG-u-nu-latn"))}`; } catch {} };
  });
}

async function renderAdvancedReports() {
  const employees = await endpoints.employees().then(unwrap);
  const events = await endpoints.attendanceEvents().then(unwrap);
  const fields = ["employee", "type", "date", "source", "geofence", "notes"];
  shell(`<section class="grid"><article class="panel span-4"><h2>منشئ التقارير</h2><p>اختر الحقول المطلوبة ثم صدّر التقرير.</p><form id="report-builder" class="form-grid">${fields.map((field) => `<label class="check-row"><input type="checkbox" name="fields" value="${field}" checked /> ${field}</label>`).join("")}<label>إرسال مجدول إلى<input name="email" type="email" placeholder="manager@example.com" /></label><div class="form-actions"><button class="button primary">تجهيز CSV</button></div></form></article><article class="panel span-8"><h2>تقارير الفروقات</h2>${table(["الموظف", "ساعات فعلية", "ساعات مخططة", "الفرق"], employees.map((employee) => { const empEvents = events.filter((e) => e.employeeId === employee.id); const actual = Math.round(empEvents.length * 4 * 10) / 10; const planned = 8; return `<tr><td>${escapeHtml(employee.fullName)}</td><td>${actual}</td><td>${planned}</td><td>${actual - planned}</td></tr>`; }))}</article></section>`, "منشئ التقارير", "تصدير ذكي CSV/Excel/PDF وجدولة بريدية مبدئية.");
  app.querySelector("#report-builder").addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = [...new FormData(event.currentTarget).getAll("fields")];
    const rows = events.map((ev) => selected.map((field) => ({ employee: ev.employee?.fullName || ev.employeeId, type: statusLabel(ev.type), date: date(ev.eventAt), source: ev.source || "-", geofence: statusLabel(ev.geofenceStatus), notes: ev.notes || "" })[field]));
    downloadFile("custom-attendance-report.csv", `\ufeff${toCsv([selected, ...rows])}`, "text/csv;charset=utf-8");
  });
}

async function renderAiAnalytics() {
  const payload = await endpoints.aiAnalytics();
  const rows = payload.rows || [];
  shell(`<section class="grid"><article class="panel span-12 accent-panel"><h2>تحليلات AI</h2><p>${escapeHtml(payload.note || "تحليل تقديري يساعد الإدارة ولا يتخذ قرارات تلقائية.")}</p></article><article class="panel span-12">${table(["الموظف", "درجة خطر الغياب", "غياب", "تأخير بالدقائق", "ملاحظة"], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee, "tiny")}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td><strong>${escapeHtml(row.riskScore)}</strong></td><td>${escapeHtml(row.absences)}</td><td>${escapeHtml(row.lateMinutes)}</td><td>${escapeHtml(row.productivityHint)}</td></tr>`))}</article></section>`, "تحليلات الذكاء الاصطناعي", "توقعات غياب وإنتاجية مبنية على سجلات الحضور.");
}

async function renderIntegrations() {
  const items = await endpoints.integrations().then(unwrap);
  shell(`<section class="grid"><article class="panel span-7"><h2>التكاملات</h2>${table(["التكامل", "المزوّد", "الحالة", "ملاحظات"], items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.provider)}</td><td>${badge(item.status)}</td><td>${escapeHtml(item.notes || "")}</td></tr>`))}</article><article class="panel span-5"><h2>WebAuthn / Passkeys</h2><p>يسمح باستخدام Touch ID / Face ID / Windows Hello / YubiKey على localhost أو HTTPS.</p><div class="toolbar"><button class="button primary" id="register-passkey">تسجيل Passkey لهذا الجهاز</button><button class="button ghost" id="enable-push">تفعيل إشعارات المتصفح</button></div><div class="message compact">التكاملات الخارجية والبوابات تحتاج API Key أو جهاز فعلي.</div></article></section>`, "التكاملات والبيومترية", "إعداد WebAuthn وPush والبوابات.");
  app.querySelector("#register-passkey")?.addEventListener("click", async () => { try { await registerBrowserPasskey(); setMessage("تم تسجيل Passkey للجهاز الحالي.", ""); render(); } catch (error) { setMessage("", error.message); } });
  app.querySelector("#enable-push")?.addEventListener("click", async () => { try { await enableBrowserNotifications(); setMessage("تم تفعيل الإشعارات.", ""); } catch (error) { setMessage("", error.message); } });
}

async function renderAccessControl() {
  const [events, employees] = await Promise.all([endpoints.accessControlEvents().then(unwrap), endpoints.employees().then(unwrap)]);
  const employeeOptions = optionList(employees.map((employee) => ({ id: employee.id, name: employee.fullName })));
  shell(`<section class="grid"><article class="panel span-4"><h2>محاكاة بوابة/باب ذكي</h2><form id="access-form" class="form-grid"><label>الموظف<select name="employeeId">${employeeOptions}</select></label><label>الجهاز<input name="deviceId" value="main-gate" /></label><label>الاتجاه<select name="direction"><option value="ENTRY">دخول</option><option value="EXIT">خروج</option></select></label><label>القرار<select name="decision"><option value="ALLOW">سماح</option><option value="DENY">رفض</option></select></label><label>السبب<input name="reason" value="تحقق مزدوج" /></label><div class="form-actions"><button class="button primary">تسجيل حدث</button></div></form></article><article class="panel span-8"><h2>سجل البوابات</h2>${table(["الموظف", "الجهاز", "الاتجاه", "القرار", "الوقت"], events.map((event) => `<tr><td>${escapeHtml(event.employee?.fullName || event.employeeId)}</td><td>${escapeHtml(event.deviceId)}</td><td>${badge(event.direction)}</td><td>${badge(event.decision)}</td><td>${date(event.date)}</td></tr>`))}</article></section>`, "تكامل الأجهزة والبوابات", "جاهز للربط مع Turnstiles أو Door API عند توفر الجهاز.");
  app.querySelector("#access-form").addEventListener("submit", submitForm(endpoints.createAccessEvent, "تم تسجيل حدث البوابة."));
}

async function renderOfflineSync() {
  const rows = await endpoints.offlineQueue().then(unwrap).catch(() => []);
  shell(`<section class="grid"><article class="panel span-5"><h2>Offline-first</h2><p>عند فشل الشبكة يتم حفظ الطلبات غير GET في قائمة محلية ثم مزامنتها عند عودة الاتصال.</p><div class="toolbar"><button class="button primary" id="sync-offline">مزامنة الآن</button><button class="button ghost" id="register-bg-sync">تفعيل Background Sync</button></div></article><article class="panel span-7"><h2>قائمة الانتظار</h2>${table(["المسار", "النوع", "الحالة", "التاريخ"], rows.map((row) => `<tr><td>${escapeHtml(row.path)}</td><td>${escapeHtml(row.method)}</td><td>${badge(row.status)}</td><td>${date(row.createdAt)}</td></tr>`))}</article></section>`, "المزامنة دون اتصال", "IndexedDB/Queue-ready مع Background Sync عبر Service Worker عند دعم المتصفح.");
  app.querySelector("#sync-offline")?.addEventListener("click", async () => { const result = await endpoints.syncOfflineQueue(); setMessage(`تمت مزامنة ${result.synced || 0} طلب.`, ""); render(); });
  app.querySelector("#register-bg-sync")?.addEventListener("click", async () => { try { const reg = await navigator.serviceWorker.ready; await reg.sync?.register?.("hr-offline-sync"); setMessage("تم تفعيل Background Sync إن كان المتصفح يدعمه.", ""); } catch (error) { setMessage("", "المتصفح لا يدعم Background Sync أو لم يتم تسجيل Service Worker."); } });
}

async function renderManagementStructure() {
  const data = await endpoints.managementStructure().then(unwrap);
  const employees = data.employees || [];
  const managers = data.managerOptions || [];
  const employeeOptions = optionList(employees.map((employee) => ({ id: employee.id, name: employee.fullName })), "", "اختر موظفًا");
  const managerOptions = optionList(managers.map((employee) => ({ id: employee.id, name: employee.fullName })), "", "بدون مدير مباشر");
  const levelRows = (data.levels || []).flatMap((level) => (level.people || []).map((person) => `<tr><td>${escapeHtml(level.label)}</td><td class="person-cell">${avatar(person, "tiny")}<span><strong>${escapeHtml(person.fullName || "-")}</strong><small>${escapeHtml(person.jobTitle || "")}</small></span></td><td>${escapeHtml(person.manager?.fullName || "-")}</td><td>${escapeHtml(person.teamCount || 0)}</td><td>${badge(person.role?.slug || person.role?.key || person.roleId || "-")}</td></tr>`));
  const teamRows = (data.managerTeams || []).map((row) => `<tr><td class="person-cell">${avatar(row.manager, "tiny")}<span><strong>${escapeHtml(row.manager?.fullName || "-")}</strong><small>${escapeHtml(row.manager?.jobTitle || "")}</small></span></td><td>${escapeHtml(row.teamCount || 0)}</td><td>${escapeHtml(row.activeCount || 0)}</td><td>${escapeHtml(row.pendingKpi || 0)}</td><td>${escapeHtml(row.pendingRequests || 0)}</td><td><button class="button ghost" data-route="team-dashboard?managerId=${escapeHtml(row.manager?.id || "")}">فتح الفريق</button></td></tr>`);
  shell(`<section class="stack management-structure-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>هيكل الإدارة والفرق</h2><p>تحديد المدير المباشر لكل موظف؛ ويعتمد عليه ظهور الفريق، KPI، الطلبات، والتصعيد.</p></div><button class="button ghost" data-export-structure>تصدير الهيكل CSV</button></div><div class="mini-stats">${(data.metrics || []).map((m) => `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || "")}</small></div>`).join("")}</div></article>
    <article class="panel"><h2>تغيير المدير المباشر</h2><form id="assign-manager-form" class="form-grid compact-form"><label>الموظف<select name="employeeId" required>${employeeOptions}</select></label><label>المدير المباشر<select name="managerEmployeeId">${managerOptions}</select></label><label class="span-2">ملاحظة النقل<input name="note" placeholder="سبب النقل أو قرار الإدارة" /></label><div class="form-actions"><button class="button primary">حفظ النقل</button></div></form></article>
    <article class="panel"><h2>الصف الإداري</h2>${table(["المستوى", "الشخص", "المدير الأعلى", "حجم الفريق", "الدور"], levelRows)}</article>
    <article class="panel"><h2>الفرق حسب المدير</h2>${table(["المدير", "إجمالي الفريق", "نشط", "KPI معلق", "طلبات معلقة", "إجراء"], teamRows)}</article>
  </section>`, "هيكل الإدارة", "تنظيم المديرين والفرق.");
  app.querySelector('#assign-manager-form')?.addEventListener('submit', submitForm((values) => endpoints.assignManager(values), 'تم تحديث المدير المباشر.'));
  app.querySelector('[data-export-structure]')?.addEventListener('click', () => downloadFile('management-structure.csv', `\ufeff${toCsv([["المستوى","الشخص","المدير","حجم الفريق"], ...(data.levels || []).flatMap((level) => (level.people || []).map((person) => [level.label, person.fullName, person.manager?.fullName || '-', person.teamCount || 0]))])}`, 'text/csv;charset=utf-8'));
}

async function renderTeamDashboard() {
  const managerId = routeParams().get('managerId') || '';
  const data = await endpoints.teamDashboard({ managerId }).then(unwrap);
  const rows = data.team || [];
  shell(`<section class="stack team-dashboard-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>فريق المدير المباشر</h2><p>${escapeHtml(data.manager?.fullName || 'فريقي')} — متابعة يومية للانضباط، الطلبات، وKPI.</p></div><div class="toolbar"><button class="button primary" data-remind-team>إرسال تذكير للفريق</button><button class="button ghost" data-export-team>تصدير CSV</button></div></div><div class="mini-stats">${(data.metrics || []).map((m) => `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || '')}</small></div>`).join('')}</div></article>
    <article class="panel"><h2>أعضاء الفريق</h2>${table(['الموظف','حالة اليوم','آخر بصمة','KPI','طلبات','إجراء'], rows.map((item) => `<tr><td class="person-cell">${avatar(item,'tiny')}<span><strong>${escapeHtml(item.fullName)}</strong><small>${escapeHtml(item.jobTitle || '')}</small></span></td><td>${badge(item.todayStatus || 'ABSENT')}</td><td>${date(item.lastEventAt)}</td><td>${badge(item.kpiStatus || 'DRAFT')}</td><td>${escapeHtml(item.pendingItems || 0)}</td><td><button class="button ghost" data-route="employee-archive?id=${escapeHtml(item.id)}">أرشيف</button><button class="button ghost" data-route="kpi?employeeId=${escapeHtml(item.id)}">KPI</button></td></tr>`))}</article>
    <article class="panel"><h2>طلبات ومهام الفريق</h2>${table(['النوع','الموظف','الحالة','العنوان','التاريخ'], (data.pending || []).map((item) => `<tr><td>${escapeHtml(item.kindLabel || item.kind)}</td><td>${escapeHtml(item.employee?.fullName || '-')}</td><td>${badge(item.status)}</td><td>${escapeHtml(item.label || item.title || '-')}</td><td>${date(item.createdAt || item.createdSort)}</td></tr>`))}</article>
  </section>`, "فريق المدير", "لوحة تشغيل يومية للمدير المباشر.");
  app.querySelector('[data-export-team]')?.addEventListener('click', () => downloadFile('team-dashboard.csv', `\ufeff${toCsv([['الموظف','الوظيفة','حالة اليوم','آخر بصمة','KPI','طلبات'], ...rows.map((r) => [r.fullName, r.jobTitle || '', statusLabel(r.todayStatus), date(r.lastEventAt), statusLabel(r.kpiStatus), r.pendingItems || 0])])}`, 'text/csv;charset=utf-8'));
  app.querySelector('[data-remind-team]')?.addEventListener('click', async () => { const result = await endpoints.sendTeamReminder({ managerId }); setMessage(`تم إرسال ${result.sent || 0} تذكير للفريق.`, ''); renderTeamDashboard(); });
}

async function renderHrOperations() {
  const data = await endpoints.hrOperations().then(unwrap);
  shell(`<section class="stack hr-ops-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>عمليات الموارد البشرية</h2><p>صفحة HR مستقلة: حضور، KPI، ملفات، بيانات ناقصة، وشكاوى بدون أدوات تقنية كاملة.</p></div><div class="toolbar"><button class="button ghost" data-export-hr>تصدير تقرير HR</button><button class="button primary" data-route="kpi">مراجعة KPI</button></div></div><div class="mini-stats">${(data.metrics || []).map((m) => `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || '')}</small></div>`).join('')}</div></article>
    <article class="panel"><h2>حضور وانصراف يحتاج مراجعة</h2>${table(['الموظف','الحالة','التفاصيل','التاريخ','إجراء'], (data.attendanceIssues || []).map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || row.employeeName || '-')}</td><td>${badge(row.status || row.smartStatus || 'REVIEW')}</td><td>${escapeHtml(row.recommendation || row.title || row.notes || '-')}</td><td>${date(row.date || row.eventAt || row.createdAt)}</td><td><button class="button ghost" data-route="attendance-review">مراجعة</button></td></tr>`))}</article>
    <article class="panel"><h2>KPI بانتظار HR</h2>${table(['الموظف','المدير','الحضور','الصلاة','الحلقة','الحالة'], (data.kpiForHr || []).map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || '-')}</td><td>${escapeHtml(row.manager?.fullName || '-')}</td><td>${escapeHtml(row.attendanceScore || 0)}/20</td><td>${escapeHtml(row.prayerScore || 0)}/5</td><td>${escapeHtml(row.quranCircleScore || 0)}/5</td><td>${badge(row.status || 'MANAGER_APPROVED')}</td></tr>`))}</article>
    <article class="panel"><h2>بيانات ناقصة أو تحتاج استكمال</h2>${table(['الموظف','المشكلة','إجراء'], (data.dataIssues || []).map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || '-')}</td><td>${escapeHtml(row.issue)}</td><td><button class="button ghost" data-route="employee-profile?id=${escapeHtml(row.employee?.id || row.employeeId || '')}">فتح الملف</button></td></tr>`))}</article>
  </section>`, "عمليات HR", "مركز الموارد البشرية اليومي.");
  app.querySelector('[data-export-hr]')?.addEventListener('click', () => downloadFile('hr-operations.csv', `\ufeff${toCsv([['المؤشر','القيمة'], ...(data.metrics || []).map((m) => [m.label, m.value])])}`, 'text/csv;charset=utf-8'));
}

async function renderDisputeWorkflow() {
  const data = await endpoints.disputeWorkflow().then(unwrap);
  const cases = data.cases || [];
  shell(`<section class="stack dispute-workflow-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>مسار الشكاوى وحل المشكلات</h2><p>المسار الرسمي: الموظف ← المدير المباشر ← لجنة حل المشكلات ← السكرتير التنفيذي ← المدير التنفيذي عند التصعيد.</p></div><button class="button ghost" data-export-disputes>تصدير الشكاوى CSV</button></div><div class="workflow-steps">${(data.workflowSteps || []).map((step, index) => `<div class="workflow-step"><strong>${index + 1}</strong><span>${escapeHtml(step)}</span></div>`).join('')}</div></article>
    <article class="panel"><h2>أعضاء اللجنة</h2><div class="committee-grid">${(data.committeeMembers || []).map((member) => `<div class="mini-card person-cell">${avatar(member,'small')}<span><strong>${escapeHtml(member.fullName || '-')}</strong><small>${escapeHtml(member.jobTitle || '')}</small></span></div>`).join('')}</div></article>
    <article class="panel"><h2>الشكاوى حسب المرحلة</h2>${table(['العنوان','صاحب الشكوى','المرحلة','الأولوية','قرار/ملاحظة','إجراءات'], cases.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description || '')}</small></td><td>${escapeHtml(item.employee?.fullName || '-')}</td><td>${badge(item.status || 'OPEN')}</td><td>${badge(item.priority || 'MEDIUM')}</td><td>${escapeHtml(item.committeeDecision || item.resolution || '-')}</td><td><button class="button primary" data-dispute-stage="${escapeHtml(item.id)}" data-status="COMMITTEE_REVIEW">لجنة</button><button class="button ghost" data-dispute-stage="${escapeHtml(item.id)}" data-status="ESCALATED">تصعيد</button><button class="button ghost" data-dispute-stage="${escapeHtml(item.id)}" data-status="RESOLVED">حل</button></td></tr>`))}</article>
  </section>`, "مسار الشكاوى", "Workflow واضح للتصعيد والقرارات.");
  app.querySelectorAll('[data-dispute-stage]').forEach((button) => button.addEventListener('click', async () => { const note = await askText({ title: 'ملاحظة القرار', message: 'اكتب ملخص القرار أو سبب التصعيد.', defaultValue: button.dataset.status === 'ESCALATED' ? 'يحتاج قرار المدير التنفيذي' : 'تمت المراجعة', confirmLabel: 'حفظ' }); if (note === null) return; await endpoints.advanceDispute(button.dataset.disputeStage, { status: button.dataset.status, note }); setMessage('تم تحديث مسار الشكوى.', ''); renderDisputeWorkflow(); }));
  app.querySelector('[data-export-disputes]')?.addEventListener('click', () => downloadFile('dispute-workflow.csv', `\ufeff${toCsv([['العنوان','الموظف','الحالة','الأولوية','القرار'], ...cases.map((c) => [c.title, c.employee?.fullName || '', statusLabel(c.status), statusLabel(c.priority), c.committeeDecision || c.resolution || ''])])}`, 'text/csv;charset=utf-8'));
}

async function renderReportCenter() {
  const data = await endpoints.reportCenter().then(unwrap);
  const rows = data.rows || [];
  const headers = ['التقرير','النطاق','عدد السجلات','آخر تحديث','إجراءات'];
  shell(`<section class="stack report-center-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>مركز التقارير والتصدير</h2><p>تصدير تقارير الإدارة، HR، الحضور، KPI، الفرق، والشكاوى بصيغ CSV/Excel أو فتح تقرير قابل للحفظ PDF.</p></div></div><div class="mini-stats">${(data.metrics || []).map((m) => `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || '')}</small></div>`).join('')}</div></article>
    <article class="panel">${table(headers, rows.map((row) => `<tr><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.description || '')}</small></td><td>${escapeHtml(row.scope || '-')}</td><td>${escapeHtml(row.count || 0)}</td><td>${date(row.updatedAt || row.generatedAt)}</td><td><button class="button ghost" data-export-report="${escapeHtml(row.key)}" data-format="csv">CSV</button><button class="button ghost" data-export-report="${escapeHtml(row.key)}" data-format="xls">Excel</button><button class="button primary" data-export-report="${escapeHtml(row.key)}" data-format="pdf">PDF</button></td></tr>`))}</article>
  </section>`, "مركز التقارير", "تصدير وتجهيز تقارير للإدارة.");
  app.querySelectorAll('[data-export-report]').forEach((button) => button.addEventListener('click', async () => { const result = await endpoints.exportManagementReport({ key: button.dataset.exportReport, format: button.dataset.format }).then(unwrap); if (button.dataset.format === 'pdf') printBrandedReport(result.title, result.summaryHtml || '', result.headers || [], result.rows || []); else if (button.dataset.format === 'xls') exportHtmlTable(`${result.fileName || button.dataset.exportReport}.xls`, result.headers || [], result.rows || []); else downloadFile(`${result.fileName || button.dataset.exportReport}.csv`, `\ufeff${toCsv([result.headers || [], ...(result.rows || [])])}`, 'text/csv;charset=utf-8'); }));
}

async function renderManagerDashboard() {
  const data = await endpoints.managerDashboard().then(unwrap);
  const team = data.team || [];
  const rows = team.map((item) => `<tr><td><div class="person-cell">${avatar(item, "small")}<span><strong>${escapeHtml(item.fullName)}</strong><small>${escapeHtml(item.jobTitle || "")}</small></span></div></td><td>${badge(item.todayStatus || "ABSENT")}</td><td>${date(item.lastEventAt)}</td><td>${escapeHtml(item.pendingItems || 0)}</td><td><button class="button ghost" data-profile="${escapeHtml(item.id)}">فتح الملف</button></td></tr>`);
  shell(
    `<section class="grid manager-dashboard-page">
      <article class="panel span-12"><div class="panel-head"><div><h2>لوحة المدير المباشر</h2><p>متابعة الفريق، الحضور، الطلبات، والتنبيهات من مكان واحد.</p></div><div class="toolbar"><button class="button primary" data-generate-attendance-alerts>تنبيه المتأخرين عن البصمة</button><button class="button ghost" data-route="monthly-report">تقرير شهري</button></div></div><div class="metric-grid">${(data.metrics || []).map((m) => `<div class="metric-card"><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || "")}</small></div>`).join("")}</div></article>
      <article class="panel span-8"><h2>فريقي اليوم</h2>${table(["الموظف", "الحالة", "آخر بصمة", "طلبات معلقة", "إجراءات"], rows)}</article>
      <article class="panel span-4"><h2>المهام العاجلة</h2><div class="stack-list">${(data.actions || []).map((a) => `<div class="task-card"><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.body || "")}</p>${badge(a.status || "INFO")}</div>`).join("") || `<div class="empty-state">لا توجد مهام عاجلة الآن.</div>`}</div></article>
    </section>`,
    "لوحة المدير المباشر",
    "رؤية مختصرة للفريق والحضور والتنبيهات.",
  );
  app.querySelectorAll("[data-profile]").forEach((button) => button.addEventListener("click", () => { location.hash = `employee-profile?id=${button.dataset.profile}`; }));
  app.querySelector("[data-generate-attendance-alerts]")?.addEventListener("click", async () => {
    const result = await endpoints.generateAttendanceAlerts();
    setMessage(`تم إنشاء ${result.created || 0} إشعار، وتم إرسال ${result.pushed || result.attempted || 0} Push للموبايلات المشتركة.`, "");
    render();
  });
}

async function renderAttendanceReview() {
  const rows = await endpoints.rejectedPunches().then(unwrap);
  shell(
    `<section class="panel attendance-review-page">
      <div class="panel-head"><div><h2>مراجعة البصمات المرفوضة</h2><p>أي محاولة مرفوضة بسبب الموقع أو الدقة أو فشل البصمة تظهر هنا لاعتمادها يدويًا أو تثبيت رفضها.</p></div><button class="button ghost" data-route="attendance">كل الحضور</button></div>
      ${table(["الموظف", "النوع", "السبب", "المخاطر", "سيلفي", "المسافة", "الدقة", "التاريخ", "الإجراء"], rows.map((event) => `<tr><td>${escapeHtml(event.employee?.fullName || event.employeeId || "-")}</td><td>${badge(event.type)}</td><td>${escapeHtml(event.notes || event.blockReason || "-")}</td><td><strong>${escapeHtml(event.riskScore ?? 0)}%</strong> ${event.riskLevel ? badge(event.riskLevel) : ""}<br>${(event.riskFlags || []).map((flag) => `<span class="status warning">${escapeHtml(flag)}</span>`).join(" ") || "-"}</td><td>${event.selfieUrl ? `<a target="_blank" rel="noopener" href="${escapeHtml(event.selfieUrl)}">عرض السيلفي</a>` : `<span class="status warning">لا يوجد</span>`}</td><td>${formatMeters(event.distanceFromBranchMeters)}</td><td>${formatMeters(event.accuracyMeters)}</td><td>${date(event.eventAt)}</td><td><div class="toolbar"><button class="button primary" data-review-punch="approve" data-id="${escapeHtml(event.id)}" data-check-id="${escapeHtml(event.identityCheckId || '')}">اعتماد</button><button class="button danger" data-review-punch="reject" data-id="${escapeHtml(event.id)}" data-check-id="${escapeHtml(event.identityCheckId || '')}">رفض نهائي</button></div></td></tr>`))}
    </section>`,
    "مراجعة البصمات",
    "اعتماد أو رفض محاولات البصمة المرفوضة.",
  );
  app.querySelectorAll("[data-review-punch]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.reviewPunch;
    const ok = await confirmAction({ title: action === "approve" ? "اعتماد محاولة البصمة" : "رفض محاولة البصمة", message: action === "approve" ? "سيتم اعتماد المحاولة يدويًا وإزالة علامة المراجعة." : "سيتم تثبيت الرفض وإغلاق المراجعة.", confirmLabel: action === "approve" ? "اعتماد" : "رفض نهائي", danger: action !== "approve" });
    if (!ok) return;
    await endpoints.reviewRejectedPunch(button.dataset.id, action, button.dataset.checkId || "");
    setMessage(action === "approve" ? "تم اعتماد البصمة يدويًا." : "تم تثبيت رفض البصمة.", "");
    render();
  }));
}

async function renderEmployeeQr() {
  shell(`
    <section class="grid qr-page">
      <article class="panel span-12">
        <div class="panel-kicker">QR متوقف</div>
        <h2>تم إيقاف QR البصمة بالكامل</h2>
        <p>تم حذف QR من مسار البصمة ومنع إنشاء QR الفرع في هذه النسخة. البصمة تعتمد الآن على Passkey + GPS عالي الدقة + سيلفي + مراجعة HR عند الشك.</p>
        <div class="message warning">لا يوجد مسح QR ولا إنشاء QR ولا اعتماد على أي خدمة QR خارجية.</div>
      </article>
    </section>
  `, "QR متوقف", "تم إيقاف QR من التشغيل والواجهة.");
}


async function renderTrustedDevices() {
  const data = await endpoints.deviceCenter().then(unwrap).catch(async () => {
    const [devices, employees, requests] = await Promise.all([endpoints.trustedDevices().then(unwrap), endpoints.employees().then(unwrap), endpoints.trustedDeviceApprovalRequests().then(unwrap).catch(() => [])]);
    return { counts: {}, rows: employees.map((employee) => ({ employee, passkeys: devices.filter((d)=>d.employeeId===employee.id || d.userId===employee.userId), pushSubscriptions: [], pendingApprovals: requests.filter((r)=>r.employeeId===employee.id), activePush: [], deviceStatus: "PASSKEY_ONLY" })), passkeys: devices, approvals: requests, pushSubscriptions: [] };
  });
  const rows = safeList(data.rows);
  const approvals = safeList(data.approvals);
  const passkeys = safeList(data.passkeys);
  const pushRows = safeList(data.pushSubscriptions);
  shell(
    `<section class="grid devices-page live-bound-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>مركز أجهزة الموظفين</h2><p>يربط Passkeys وPush Subscriptions وطلبات اعتماد الأجهزة بملف الموظف حتى لا تبقى الصفحة شكلية.</p></div><div class="toolbar"><button class="button ghost" data-route="notifications">مراقبة الإشعارات</button><button class="button primary" data-route="employee-punch">تسجيل بصمة جهاز</button></div></div>
        <div class="metric-grid">
          ${metric("الموظفون", data.counts?.total ?? rows.length, "إجمالي المتابعة")}
          ${metric("Push نشط", data.counts?.PUSH_ACTIVE ?? rows.filter((r)=>r.deviceStatus==='PUSH_ACTIVE').length, "جاهز لإشعارات خارج التطبيق")}
          ${metric("Passkey فقط", data.counts?.PASSKEY_ONLY ?? rows.filter((r)=>r.deviceStatus==='PASSKEY_ONLY').length, "بصمة/دخول بدون Push")}
          ${metric("طلبات اعتماد", data.counts?.PENDING_APPROVAL ?? rows.filter((r)=>r.deviceStatus==='PENDING_APPROVAL').length, "تحتاج HR/مدير")}
          ${metric("بلا جهاز", data.counts?.NO_DEVICE ?? rows.filter((r)=>r.deviceStatus==='NO_DEVICE').length, "يحتاج تفعيل")}
        </div>
      </article>
      <article class="panel span-12"><div class="panel-head"><div><h2>حالة كل موظف</h2><p>هل لديه جهاز معتمد؟ هل Push نشط؟ هل هناك طلب اعتماد؟</p></div><button class="button ghost" id="export-device-center">تصدير JSON</button></div>
      ${table(["الموظف", "Push", "Passkeys", "طلبات اعتماد", "الحالة", "إجراء"], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,"tiny")}<span><strong>${escapeHtml(row.employee?.fullName || "-")}</strong><small>${escapeHtml(row.employee?.phone || row.employee?.jobTitle || "")}</small></span></td><td>${escapeHtml(safeList(row.activePush).length)} نشط / ${escapeHtml(safeList(row.pushSubscriptions).length)} إجمالي</td><td>${escapeHtml(safeList(row.passkeys).length)}</td><td>${escapeHtml(safeList(row.pendingApprovals).length)}</td><td>${badge(row.deviceStatus || "NO_DEVICE")}</td><td><button class="button ghost" data-route="employee-archive?id=${escapeHtml(row.employee?.id || "")}">ملف الموظف</button></td></tr>`))}</article>
      <article class="panel span-12"><div class="panel-head"><div><h2>طلبات اعتماد الأجهزة الجديدة</h2><p>أي جهاز جديد أو غير معتمد يتحول إلى هذه القائمة قبل اعتماد بصمته تلقائيًا.</p></div></div>
      ${table(["الموظف", "الجهاز", "الحالة", "السيلفي", "الموقع", "التاريخ", "إجراء"], approvals.map((r) => { const employee = r.employee || rows.find((row)=>row.employee?.id===r.employeeId)?.employee || {}; return `<tr><td>${escapeHtml(employee.fullName || r.employeeName || r.employeeId || "-")}</td><td><strong>${escapeHtml(r.deviceName || "جهاز متصفح")}</strong><br><small>${escapeHtml(String(r.deviceFingerprintHash || "").slice(0,16))}</small></td><td>${badge(r.status || "PENDING")}</td><td>${r.selfieUrl ? `<a target="_blank" rel="noopener" href="${escapeHtml(r.selfieUrl)}">عرض</a>` : "-"}</td><td>${r.latitude ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${escapeHtml(r.latitude)},${escapeHtml(r.longitude)}">خريطة</a>` : "-"}</td><td>${date(r.createdAt)}</td><td><div class="toolbar"><button class="button primary" data-device-review="APPROVED" data-request-id="${escapeHtml(r.id)}">اعتماد</button><button class="button danger" data-device-review="REJECTED" data-request-id="${escapeHtml(r.id)}">رفض</button></div></td></tr>`; }))}</article>
      <article class="panel span-6"><div class="panel-head"><div><h2>Passkeys / أجهزة البصمة</h2><p>قائمة الأجهزة المحفوظة.</p></div></div>
      ${table(["الموظف", "الجهاز", "المنصة", "الحالة", "آخر استخدام", "إجراءات"], passkeys.slice(0, 160).map((d) => { const row = rows.find((r)=>r.employee?.id===d.employeeId || r.employee?.userId===d.userId); const employee = d.employee || row?.employee || {}; return `<tr><td>${escapeHtml(employee.fullName || d.employeeId || d.userId || "-")}</td><td>${escapeHtml(d.label || d.deviceLabel || "مفتاح مرور")}</td><td>${escapeHtml(d.platform || d.userAgent || "-")}</td><td>${badge(d.approvalStatus || d.status || (d.trusted === false ? "DEVICE_DISABLED" : "DEVICE_TRUSTED"))}</td><td>${date(d.lastUsedAt)}</td><td><div class="toolbar"><button class="button ghost" data-device-action="trust" data-id="${escapeHtml(d.id)}">اعتماد</button><button class="button danger" data-device-action="disable" data-id="${escapeHtml(d.id)}">تعطيل</button></div></td></tr>`; }))}</article>
      <article class="panel span-6"><div class="panel-head"><div><h2>Push Subscriptions</h2><p>اشتراكات Web Push التي تعتمد عليها إشعارات الموبايل والمتصفح.</p></div></div>
      ${table(["الموظف/المستخدم", "الحالة", "آخر إرسال", "آخر خطأ"], pushRows.slice(0, 160).map((row) => `<tr><td>${escapeHtml(rows.find((r)=>r.employee?.id===row.employeeId || r.employee?.userId===row.userId)?.employee?.fullName || row.employeeId || row.userId || "-")}</td><td>${badge(row.status || (row.isActive === false ? "DISABLED" : "ACTIVE"))}</td><td>${date(row.lastSentAt || row.updatedAt || row.createdAt)}</td><td>${escapeHtml(row.lastError || "-")}</td></tr>`))}</article>
    </section>`,
    "مركز أجهزة الموظفين",
    "ربط الأجهزة، Passkeys، وWeb Push ببيانات الموظفين.",
  );
  app.querySelector("#export-device-center")?.addEventListener("click", () => downloadFile("device-center.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8"));
  app.querySelectorAll("[data-device-review]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.reviewTrustedDeviceApproval({ requestId: button.dataset.requestId, decision: button.dataset.deviceReview });
    setMessage(button.dataset.deviceReview === "APPROVED" ? "تم اعتماد الجهاز." : "تم رفض الجهاز.", "");
    renderTrustedDevices();
  }));
  app.querySelectorAll("[data-device-action]").forEach((button) => button.addEventListener("click", async () => {
    await endpoints.updateTrustedDevice(button.dataset.id, { action: button.dataset.deviceAction });
    setMessage(button.dataset.deviceAction === "trust" ? "تم اعتماد الجهاز." : "تم تعطيل الجهاز.", "");
    renderTrustedDevices();
  }));
}

async function renderMonthlyReport() {
  const params = routeParams();
  const month = params.get("month") || new Date().toISOString().slice(0, 7);
  const report = await endpoints.monthlyReport({ month }).then(unwrap);
  const rows = report.rows || [];
  shell(
    `<section class="grid monthly-report-page">
      <article class="panel span-12"><div class="panel-head"><div><h2>التقرير الشهري</h2><p>تقرير حضور وانصراف قابل للطباعة PDF بتصميم الجمعية.</p></div><div class="toolbar"><input id="report-month" type="month" value="${escapeHtml(month)}" /><button class="button primary" id="print-monthly-report">طباعة / PDF</button><button class="button ghost" id="export-monthly-csv">CSV</button></div></div><div class="metric-grid">${(report.metrics || []).map((m) => `<div class="metric-card"><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || "")}</small></div>`).join("")}</div></article>
      <article class="panel span-12">${table(["الموظف", "حضور", "انصراف", "مرفوض", "تأخير", "آخر بصمة"], rows.map((r) => `<tr><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.checkIns)}</td><td>${escapeHtml(r.checkOuts)}</td><td>${escapeHtml(r.rejected)}</td><td>${escapeHtml(r.lateMinutes)} دقيقة</td><td>${date(r.lastEventAt)}</td></tr>`))}</article>
    </section>`,
    "تقرير شهري",
    "ملخص شهري للحضور والانصراف.",
  );
  app.querySelector("#report-month")?.addEventListener("change", (event) => { location.hash = `monthly-report?month=${event.target.value}`; });
  const headers = ["الموظف", "حضور", "انصراف", "مرفوض", "تأخير", "آخر بصمة"];
  const tableRows = rows.map((r) => [r.employeeName, r.checkIns, r.checkOuts, r.rejected, `${r.lateMinutes} دقيقة`, r.lastEventAt || "-"]);
  app.querySelector("#export-monthly-csv")?.addEventListener("click", () => downloadFile(`monthly-attendance-${month}.csv`, `\ufeff${toCsv([headers, ...tableRows])}`, "text/csv;charset=utf-8"));
  app.querySelector("#print-monthly-report")?.addEventListener("click", () => {
    const summary = `<div class="summary">${(report.metrics || []).map((m) => `<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper || "")}</small></div>`).join("")}</div>`;
    printBrandedReport(`تقرير الحضور الشهري ${month}`, summary, headers, tableRows);
  });
}

async function renderSecurityLog() {
  const logs = await endpoints.securityLog().then(unwrap);
  shell(
    `<section class="panel security-log-page"><div class="panel-head"><div><h2>سجل الأمان</h2><p>محاولات الدخول الفاشلة، تسجيل الدخول، طلبات نسيت كلمة السر، وتغيير كلمة المرور.</p></div><button class="button ghost" id="export-security-log">تصدير</button></div>${table(["العملية", "المستخدم", "الكيان", "التاريخ", "التفاصيل"], logs.map((log) => `<tr><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.actor || log.actorUserId || "-")}</td><td>${escapeHtml(log.entityType || "-")}</td><td>${date(log.createdAt)}</td><td><small>${escapeHtml(JSON.stringify(log.metadata || log.afterData || {}))}</small></td></tr>`))}</section>`,
    "سجل الأمان",
    "مراقبة الدخول وكلمات المرور.",
  );
  app.querySelector("#export-security-log")?.addEventListener("click", () => downloadFile("security-log.csv", `\ufeff${toCsv([["action","actor","entity","date"], ...logs.map((l) => [l.action, l.actor || l.actorUserId || "", l.entityType || "", l.createdAt || ""])])}`, "text/csv;charset=utf-8"));
}


async function renderExecutiveReport() {
  const data = unwrap(await endpoints.executiveReport());
  const cards = data.cards || {};
  shell(
    `<section class="grid executive-report-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>التقرير التنفيذي المختصر للمدير التنفيذي</h2><p>ملخص واحد يجمع الحضور والطلبات والمشاكل والمهام والمستندات التي تحتاج قرارًا.</p></div><div class="score-ring"><strong>${escapeHtml(data.readiness?.score || 0)}%</strong><span>${escapeHtml(data.readiness?.grade || "-")}</span></div></div>
      </article>
      ${[
        ["الموظفون", cards.employees],
        ["النشطون", cards.activeEmployees],
        ["حضور اليوم", cards.presentToday],
        ["طلبات معلقة", cards.pendingRequests],
        ["مشاكل مفتوحة", cards.openDisputes],
        ["مهام متأخرة", cards.overdueTasks],
        ["مستندات قرب الانتهاء", cards.expiringDocuments],
      ].map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong><small>مؤشر تنفيذي مباشر</small></article>`).join("")}
      <article class="panel span-6"><div class="panel-head"><div><h2>أداء المديرين</h2><p>عدد الفريق والمهام والطلبات المفتوحة.</p></div></div>${table(["المدير", "الفريق", "طلبات معلقة", "مهام مفتوحة"], safeList(data.managerPerformance).map((row) => `<tr><td>${escapeHtml(row.manager?.fullName || "-")}</td><td>${escapeHtml(row.teamCount || 0)}</td><td>${escapeHtml(row.pendingRequests || 0)}</td><td>${escapeHtml(row.openTasks || 0)}</td></tr>`))}</article>
      <article class="panel span-6"><div class="panel-head"><div><h2>مشاكل تحتاج متابعة</h2><p>قضايا لجنة حل الخلافات غير المغلقة.</p></div><button class="button ghost" data-route="disputes">فتح اللجنة</button></div>${table(["العنوان", "الموظف", "الأولوية", "الحالة"], safeList(data.openDisputes).map((item) => `<tr><td>${escapeHtml(item.title || "-")}</td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${badge(item.priority || "-")}</td><td>${badge(item.status || "-")}</td></tr>`))}</article>
      <article class="panel span-6"><div class="panel-head"><div><h2>مهام متأخرة</h2><p>المهام التي تجاوزت تاريخ الاستحقاق.</p></div><button class="button ghost" data-route="tasks">فتح المهام</button></div>${table(["المهمة", "الموظف", "الأولوية", "الاستحقاق"], safeList(data.overdueTasks).map((item) => `<tr><td>${escapeHtml(item.title || "-")}</td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${badge(item.priority || "-")}</td><td>${escapeHtml(item.dueDate || "-")}</td></tr>`))}</article>
      <article class="panel span-6"><div class="panel-head"><div><h2>مستندات قرب الانتهاء</h2><p>تنبيهات قبل انتهاء المستندات.</p></div><button class="button ghost" data-route="documents">فتح المستندات</button></div>${table(["المستند", "الموظف", "النوع", "ينتهي في"], safeList(data.documentsExpiring).map((item) => `<tr><td>${escapeHtml(item.title || "-")}</td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${escapeHtml(item.documentType || "-")}</td><td>${escapeHtml(item.expiresOn || "-")}</td></tr>`))}</article>
    </section>`,
    "التقرير التنفيذي",
    "صفحة خاصة بالمدير التنفيذي والسكرتير التنفيذي.",
  );
}

async function renderLeaveBalances() {
  const [balances, employees] = await Promise.all([endpoints.leaveBalances().then(unwrap), endpoints.employees().then(unwrap)]);
  shell(
    `<section class="grid">
      <article class="panel span-12"><div class="panel-head"><div><h2>أرصدة الإجازات</h2><p>إدارة الرصيد السنوي والعارض والمرضي، مع احتساب المستخدم والمتبقي.</p></div></div>
        <form id="leave-balance-form" class="form-grid compact-form">
          <label>الموظف<select name="employeeId" required>${optionList(employees, "", "اختر الموظف")}</select></label>
          <label>سنوي<input name="annualTotal" type="number" value="21" min="0" required /></label>
          <label>عارض<input name="casualTotal" type="number" value="7" min="0" required /></label>
          <label>مرضي<input name="sickTotal" type="number" value="15" min="0" required /></label>
          <label>مستخدم<input name="usedDays" type="number" value="0" min="0" required /></label>
          <label>ملاحظات<input name="notes" placeholder="اختياري" /></label>
          <div class="form-actions"><button class="button primary" type="submit">حفظ الرصيد</button></div>
        </form>
        ${table(["الموظف", "سنوي", "عارض", "مرضي", "مستخدم", "متبقي", "آخر تحديث"], balances.map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || row.employeeId)}</td><td>${escapeHtml(row.annualTotal)}</td><td>${escapeHtml(row.casualTotal)}</td><td>${escapeHtml(row.sickTotal)}</td><td>${escapeHtml(row.usedDays)}</td><td>${escapeHtml(row.remainingDays)}</td><td>${date(row.updatedAt)}</td></tr>`))}
      </article>
    </section>`,
    "أرصدة الإجازات",
    "تحويل الإجازات إلى رصيد واضح قبل الموافقات.",
  );
  app.querySelector("#leave-balance-form")?.addEventListener("submit", submitForm(async (values) => endpoints.saveLeaveBalance(values.employeeId, values), "تم حفظ رصيد الإجازة."));
}

async function renderTasks() {
  const [tasks, employees] = await Promise.all([endpoints.tasks().then(unwrap), endpoints.employees().then(unwrap)]);
  shell(
    `<section class="grid">
      <article class="panel span-12"><div class="panel-head"><div><h2>المهام الداخلية</h2><p>تكليف ومتابعة مهام الموظفين والمديرين بدل المتابعة الشفوية.</p></div></div>
        <form id="task-form" class="form-grid compact-form">
          <label>الموظف<select name="employeeId" required>${optionList(employees, "", "اختر الموظف")}</select></label>
          <label>عنوان المهمة<input name="title" required /></label>
          <label>الأولوية<select name="priority"><option value="LOW">منخفضة</option><option value="MEDIUM" selected>متوسطة</option><option value="HIGH">عالية</option></select></label>
          <label>تاريخ الاستحقاق<input name="dueDate" type="date" /></label>
          <label class="span-2">التفاصيل<textarea name="description"></textarea></label>
          <div class="form-actions"><button class="button primary" type="submit">إنشاء مهمة</button></div>
        </form>
        ${table(["المهمة", "الموظف", "الأولوية", "الحالة", "الاستحقاق", "إجراء"], tasks.map((task) => `<tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.employee?.fullName || "-")}</td><td>${badge(task.priority)}</td><td>${badge(task.status)}</td><td>${escapeHtml(task.dueDate || "-")}</td><td><button class="button ghost small" data-task-done="${escapeHtml(task.id)}">تم الإنجاز</button></td></tr>`))}
      </article>
    </section>`,
    "المهام",
    "نظام مهام داخلي مرتبط بالموظفين.",
  );
  app.querySelector("#task-form")?.addEventListener("submit", submitForm((values) => endpoints.createTask(values), "تم إنشاء المهمة وإرسال إشعار للموظف."));
  app.querySelectorAll("[data-task-done]").forEach((btn) => btn.addEventListener("click", async () => { await endpoints.updateTask(btn.dataset.taskDone, { status: "DONE" }); setMessage("تم إغلاق المهمة.", ""); renderTasks(); }));
}

async function renderDocuments() {
  const [docs, employees] = await Promise.all([endpoints.employeeDocuments().then(unwrap), endpoints.employees().then(unwrap)]);
  shell(
    `<section class="grid">
      <article class="panel span-12"><div class="panel-head"><div><h2>مستندات الموظفين</h2><p>أرشفة المستندات ومتابعة تاريخ انتهاء البطاقة/العقد/أي ملف مهم.</p></div></div>
        <form id="doc-form" class="form-grid compact-form">
          <label>الموظف<select name="employeeId" required>${optionList(employees, "", "اختر الموظف")}</select></label>
          <label>اسم المستند<input name="title" required /></label>
          <label>النوع<select name="documentType"><option value="ID_CARD">بطاقة</option><option value="CONTRACT">عقد</option><option value="MEDICAL">طبي</option><option value="OTHER">أخرى</option></select></label>
          <label>ينتهي في<input name="expiresOn" type="date" /></label>
          <label>رابط الملف<input name="fileUrl" placeholder="رابط خاص أو Signed URL" /></label>
          <label>ملاحظات<input name="notes" /></label>
          <div class="form-actions"><button class="button primary" type="submit">إضافة مستند</button></div>
        </form>
        ${table(["المستند", "الموظف", "النوع", "الحالة", "ينتهي في", "ملاحظات"], docs.map((doc) => `<tr><td>${doc.fileUrl ? `<a href="${escapeHtml(doc.fileUrl)}" target="_blank" rel="noopener">${escapeHtml(doc.title)}</a>` : escapeHtml(doc.title)}</td><td>${escapeHtml(doc.employee?.fullName || "-")}</td><td>${escapeHtml(doc.documentType || "-")}</td><td>${badge(doc.status || "ACTIVE")}</td><td>${escapeHtml(doc.expiresOn || "-")}</td><td>${escapeHtml(doc.notes || "")}</td></tr>`))}
      </article>
    </section>`,
    "مستندات الموظفين",
    "أرشيف منظم مع تنبيهات انتهاء الصلاحية.",
  );
  app.querySelector("#doc-form")?.addEventListener("submit", submitForm((values) => endpoints.createEmployeeDocument(values), "تم حفظ المستند."));
}

async function renderPermissionMatrix() {
  const [data, overview] = await Promise.all([
    endpoints.permissionMatrix().then(unwrap),
    endpoints.permissionOverview().then(unwrap).catch(() => ({ roles: [], permissions: [], employees: [], users: [] })),
  ]);
  const roles = safeList(overview.roles).length ? safeList(overview.roles) : safeList(data.roles);
  const permissions = safeList(overview.permissions).length ? safeList(overview.permissions) : safeList(data.permissions);
  const firstRole = roles[0] || {};
  shell(
    `<section class="grid live-bound-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>مركز صلاحيات مبسط</h2><p>يعرض الدور وما يراه المستخدم فعليًا وعدد الموظفين المرتبطين به، ثم يسمح بتعديل المصفوفة.</p></div><button class="button ghost" id="export-permission-overview">تصدير JSON</button></div>
        <div class="metric-grid">
          ${metric("الأدوار", roles.length, "من جدول roles")}
          ${metric("الصلاحيات", permissions.length, "Scopes")}
          ${metric("مستخدمون", safeList(overview.users).length, "Profiles")}
          ${metric("موظفون", safeList(overview.employees).length, "Employees")}
          ${metric("أدوار كاملة", roles.filter((r)=>r.risk==='FULL_ACCESS' || safeList(r.permissions).includes('*')).length, "Full access")}
        </div>
      </article>
      <article class="panel span-12"><div class="panel-head"><div><h2>ملخص الأدوار</h2><p>قبل تعديل الصلاحيات، راجع من يستخدم كل دور.</p></div></div>
        ${table(["الدور", "الموظفون", "المستخدمون", "مستوى الحساسية", "أهم الصلاحيات"], roles.map((role) => `<tr><td><strong>${escapeHtml(role.name || role.key || role.slug)}</strong><small>${escapeHtml(role.slug || role.key || '')}</small></td><td>${escapeHtml(role.employeeCount ?? '-')}</td><td>${escapeHtml(role.userCount ?? '-')}</td><td>${badge(role.risk || 'NORMAL')}</td><td><div class="scope-list">${safeList(role.permissions).slice(0,8).map((scope)=>`<span>${escapeHtml(scope)}</span>`).join('')}${safeList(role.permissions).length>8?`<span>+${safeList(role.permissions).length-8}</span>`:''}</div></td></tr>`))}
      </article>
      <article class="panel span-12"><div class="panel-head"><div><h2>مصفوفة الصلاحيات</h2><p>تحكم تفصيلي في صلاحيات كل دور داخل النظام.</p></div></div>
        <form id="matrix-form" class="matrix-form">
          <label>الدور<select name="roleId" id="matrix-role">${optionList(roles, firstRole.id, "اختر الدور")}</select></label>
          <div class="permission-grid">${permissions.map((perm) => `<label class="permission-check"><input type="checkbox" name="permissions" value="${escapeHtml(perm.scope)}" ${safeList(firstRole.permissions).includes(perm.scope) ? "checked" : ""}/><span><strong>${escapeHtml(perm.name || perm.scope)}</strong><small>${escapeHtml(perm.scope)}</small></span></label>`).join("")}</div>
          <div class="form-actions"><button class="button primary" type="submit">حفظ الصلاحيات</button></div>
        </form>
      </article>
    </section>`,
    "مركز الصلاحيات",
    "عرض وتعديل الصلاحيات مع ربطها بالموظفين والمستخدمين.",
  );
  const applyRoleChecks = () => {
    const role = roles.find((item) => item.id === app.querySelector("#matrix-role")?.value) || {};
    app.querySelectorAll('input[name="permissions"]').forEach((input) => { input.checked = safeList(role.permissions).includes(input.value); });
  };
  app.querySelector("#matrix-role")?.addEventListener("change", applyRoleChecks);
  app.querySelector("#matrix-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const roleId = app.querySelector("#matrix-role").value;
    const permissions = [...app.querySelectorAll('input[name="permissions"]:checked')].map((input) => input.value);
    await endpoints.savePermissionMatrix({ roleId, permissions });
    setMessage("تم حفظ مصفوفة الصلاحيات.", "");
    renderPermissionMatrix();
  });
  app.querySelector("#export-permission-overview")?.addEventListener("click", () => downloadFile("permission-overview.json", JSON.stringify(overview, null, 2), "application/json;charset=utf-8"));
}


async function renderQualityCenter() {
  const [data, quality] = await Promise.all([
    endpoints.qualityCenter().then(unwrap).catch(() => ({ readiness: { score: 0, grade: "غير متاح", issues: [] }, policy: {}, maintenanceRuns: [], escalations: [] })),
    endpoints.employeeDataQuality().then(unwrap).catch(() => ({ score: 0, grade: "غير متاح", rows: [], issues: [], counts: {} })),
  ]);
  const readiness = data.readiness || {};
  const issues = [...safeList(readiness.issues), ...safeList(quality.issues).map((issue) => ({ ...issue, area: "بيانات الموظفين", detail: issue.employee?.fullName || issue.employeeId || "" }))];
  const policy = data.policy || {};
  const employeeRows = safeList(quality.rows).filter((row) => row.issueCount || row.pendingItems).slice(0, 80);
  shell(
    `<section class="grid quality-center-page live-bound-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head">
          <div><h2>مركز جودة البيانات والترابط</h2><p>يفحص الربط الحقيقي بين الموظفين، المستخدمين، الأجهزة، الإشعارات، المديرين، الطلبات، والسياسات.</p></div>
          <div class="toolbar"><button class="button primary" id="run-maintenance">تشغيل إصلاح شامل الآن</button><button class="button ghost" id="export-quality-report">تصدير تقرير JSON</button></div>
        </div>
        <div class="metric-grid">
          ${metric("جاهزية النظام", `${escapeHtml(readiness.score ?? quality.score ?? 0)}%`, readiness.grade || quality.grade || "-")}
          ${metric("جودة بيانات الموظفين", `${escapeHtml(quality.score ?? 0)}%`, quality.grade || "-")}
          ${metric("مشاكل عالية", quality.counts?.high ?? issues.filter((item) => item.severity === "HIGH").length, "تحتاج تصحيح")}
          ${metric("موظفون", quality.counts?.employees ?? 0, "ملفات مربوطة")}
          ${metric("طلبات متأخرة", readiness.staleWorkflow || 0, "SLA أكثر من 48 ساعة")}
          ${metric("توقيع السياسات", `${policy.percent ?? 100}%`, `${policy.signed || 0} من ${policy.totalRequired || 0}`)}
        </div>
      </article>
      <article class="panel span-12"><div class="panel-head"><div><h2>مشاكل بيانات الموظفين</h2><p>أرقام الهاتف، المدير المباشر، حساب الدخول، Push، والصورة الشخصية.</p></div><button class="button ghost" data-route="employees">فتح الموظفين</button></div>
        ${table(["الموظف", "مشاكل", "عالي", "آخر حضور", "طلبات معلقة", "إجراء"], employeeRows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,"tiny")}<span><strong>${escapeHtml(row.employee?.fullName || "-")}</strong><small>${escapeHtml(row.employee?.phone || row.employee?.jobTitle || "")}</small></span></td><td>${safeList(row.issues).map((issue)=>`<span class="tag ${issue.severity==='HIGH'?'danger':issue.severity==='MEDIUM'?'warning':'info'}">${escapeHtml(issue.title)}</span>`).join(' ')}</td><td>${escapeHtml(row.highCount || 0)}</td><td>${date(row.lastAttendanceAt)}</td><td>${escapeHtml(row.pendingItems || 0)}</td><td><button class="button ghost" data-route="employee-archive?id=${escapeHtml(row.employee?.id || '')}">ملف الموظف</button></td></tr>`))}
      </article>
      <article class="panel span-8"><h2>كل المشاكل المكتشفة</h2>${table(["الخطورة", "المجال", "المشكلة", "التفاصيل"], issues.slice(0, 120).map((item) => `<tr><td>${badge(item.severity)}</td><td>${escapeHtml(item.area || "النظام")}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.detail || item.employee?.fullName || "-")}</td></tr>`))}</article>
      <article class="panel span-4"><h2>آخر عمليات الصيانة</h2>${table(["قبل", "بعد", "إصلاحات", "تصعيد"], (data.maintenanceRuns || []).slice(0, 8).map((run) => `<tr><td>${escapeHtml(run.beforeScore ?? "-")}</td><td>${escapeHtml(run.afterScore ?? "-")}</td><td>${escapeHtml(run.repair?.fixed ?? 0)}</td><td>${escapeHtml(run.workflow?.escalated ?? 0)}</td></tr>`))}</article>
      <article class="panel span-12"><h2>التصعيدات المفتوحة</h2>${table(["النوع", "الموظف", "السبب", "الحالة", "التاريخ"], (data.escalations || []).slice(0, 50).map((item) => `<tr><td>${escapeHtml(item.sourceKind)}</td><td>${escapeHtml(item.employeeId)}</td><td>${escapeHtml(item.reason)}</td><td>${badge(item.status)}</td><td>${date(item.createdAt)}</td></tr>`))}</article>
    </section>`,
    "مركز الجودة والإصلاح",
    "تشغيل صيانة ذكية وفحص جاهزية النظام وربط الصفحات ببيانات Supabase.",
  );
  app.querySelector("#run-maintenance")?.addEventListener("click", async () => {
    if (!await confirmAction({ title: "تشغيل الإصلاح الشامل", message: "سيتم إصلاح الروابط الناقصة وإنشاء حسابات مؤقتة للموظفين بلا حساب وتصعيد الطلبات المتأخرة.", confirmLabel: "تشغيل الآن" })) return;
    const result = await endpoints.runMaintenance({ thresholdHours: 48 }).then(unwrap);
    setMessage(`تم التشغيل: ${result.run?.repair?.fixed || 0} إصلاحات، ${result.run?.workflow?.escalated || 0} تصعيدات.`, "");
    renderQualityCenter();
  });
  app.querySelector("#export-quality-report")?.addEventListener("click", () => downloadFile("quality-center-report.json", JSON.stringify({ ...data, employeeDataQuality: quality }, null, 2), "application/json;charset=utf-8"));
}

async function renderPolicies() {
  const data = await endpoints.policies().then(unwrap).catch(() => ({ policies: [], summary: {}, acknowledgements: [] }));
  const policies = data.policies || [];
  shell(
    `<section class="grid policies-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>السياسات والتوقيعات</h2><p>إدارة سياسات الجمعية وإثبات قراءة الموظفين لها.</p></div></div></article>
      <article class="panel span-3"><span class="panel-kicker">السياسات</span><strong class="big-number">${escapeHtml(data.summary?.policies || policies.length)}</strong><p>فعالة ومؤرشفة</p></article>
      <article class="panel span-3"><span class="panel-kicker">التوقيعات</span><strong class="big-number">${escapeHtml(data.summary?.signed || 0)}</strong><p>تمت القراءة</p></article>
      <article class="panel span-3"><span class="panel-kicker">المتبقي</span><strong class="big-number">${escapeHtml(data.summary?.missing || 0)}</strong><p>تحتاج متابعة</p></article>
      <article class="panel span-3"><span class="panel-kicker">النسبة</span><strong class="big-number">${escapeHtml(data.summary?.percent ?? 100)}%</strong><p>اكتمال الالتزام</p></article>
      <article class="panel span-5">
        <h2>سياسة جديدة</h2>
        <form id="policy-form" class="form-grid compact-form">
          <label>العنوان<input name="title" required placeholder="مثال: سياسة الحضور" /></label>
          <label>التصنيف<select name="category"><option value="ATTENDANCE">الحضور</option><option value="SECURITY">الأمان</option><option value="DISPUTES">الخلافات</option><option value="GENERAL">عام</option></select></label>
          <label>الإصدار<input name="version" value="1.0" /></label>
          <label>الحالة<select name="status"><option value="ACTIVE">فعالة</option><option value="DRAFT">مسودة</option><option value="ARCHIVED">أرشيف</option></select></label>
          <label class="span-2">النص<textarea name="body" rows="6" required></textarea></label>
          <label class="checkbox-line span-2"><input type="checkbox" name="requiresAcknowledgement" checked /> تحتاج توقيع/قراءة من الموظفين</label>
          <div class="form-actions"><button class="button primary">حفظ السياسة</button></div>
        </form>
      </article>
      <article class="panel span-7"><h2>السياسات الحالية</h2>${table(["العنوان", "التصنيف", "الإصدار", "الحالة", "التوقيع"], policies.map((policy) => `<tr><td>${escapeHtml(policy.title)}</td><td>${escapeHtml(policy.category || "-")}</td><td>${escapeHtml(policy.version || "-")}</td><td>${badge(policy.status)}</td><td>${policy.requiresAcknowledgement === false ? "غير مطلوب" : "مطلوب"}</td></tr>`))}</article>
    </section>`,
    "السياسات والتوقيعات",
    "مركز الالتزام الداخلي."
  );
  app.querySelector("#policy-form")?.addEventListener("submit", submitForm(endpoints.savePolicy, "تم حفظ السياسة وإخطار الموظفين."));
}

async function renderControlRoom() {
  const data = await endpoints.controlRoom().then(unwrap).catch(() => ({ cards: {}, readiness: {}, alerts: [], staleRequests: [], openTasks: [], dailyReports: [] }));
  const cards = data.cards || {};
  shell(
    `<section class="grid control-room-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>غرفة التحكم والتنبيهات الذكية</h2><p>لوحة واحدة تعرض أخطر ما يحتاج قرارًا الآن: SLA، جودة البيانات، المهام، التقارير اليومية والتنبيهات.</p></div><div class="toolbar"><button class="button primary" id="run-smart-audit">تحديث التحليل الذكي</button><button class="button ghost" id="export-control-room">تصدير JSON</button></div></div></article>
      <article class="panel span-2"><span class="panel-kicker">جاهزية</span><strong class="big-number">${escapeHtml(cards.readiness ?? 0)}%</strong><p>${escapeHtml(data.readiness?.grade || "-")}</p></article>
      <article class="panel span-2"><span class="panel-kicker">تنبيهات مفتوحة</span><strong class="big-number">${escapeHtml(cards.openAlerts ?? 0)}</strong><p>تحتاج متابعة</p></article>
      <article class="panel span-2"><span class="panel-kicker">خطيرة</span><strong class="big-number">${escapeHtml(cards.highAlerts ?? 0)}</strong><p>أولوية عالية</p></article>
      <article class="panel span-2"><span class="panel-kicker">طلبات متأخرة</span><strong class="big-number">${escapeHtml(cards.staleRequests ?? 0)}</strong><p>أكثر من 48 ساعة</p></article>
      <article class="panel span-2"><span class="panel-kicker">مهام مفتوحة</span><strong class="big-number">${escapeHtml(cards.openTasks ?? 0)}</strong><p>قيد التنفيذ</p></article>
      <article class="panel span-2"><span class="panel-kicker">تقارير اليوم</span><strong class="big-number">${escapeHtml(cards.todayReports ?? 0)}</strong><p>${escapeHtml(cards.pendingReports ?? 0)} للمراجعة</p></article>
      <article class="panel span-7"><h2>التنبيهات الذكية</h2>${table(["الخطورة", "العنوان", "التفاصيل", "المسار", "إجراء"], (data.alerts || []).slice(0, 60).map((alert) => `<tr><td>${badge(alert.severity)}</td><td>${escapeHtml(alert.title)}</td><td>${escapeHtml(alert.body || "-")}</td><td><button class="button ghost small" data-route="${escapeHtml(alert.route || "quality-center")}">فتح</button></td><td>${alert.status === "OPEN" ? `<button class="button small" data-resolve-alert="${escapeHtml(alert.id)}">إغلاق</button>` : badge(alert.status)}</td></tr>`))}</article>
      <article class="panel span-5"><h2>طلبات متأخرة</h2>${table(["النوع", "الموظف", "العمر", "الحالة"], (data.staleRequests || []).map((item) => `<tr><td>${escapeHtml(item.kindLabel || item.kind)}</td><td>${escapeHtml(item.employee?.fullName || item.employeeId || "-")}</td><td>${escapeHtml(item.ageHours || "48+")} ساعة</td><td>${badge(item.status)}</td></tr>`))}</article>
      <article class="panel span-6"><h2>مهام مفتوحة</h2>${table(["المهمة", "الموظف", "الأولوية", "التاريخ"], (data.openTasks || []).slice(0, 30).map((task) => `<tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.employee?.fullName || "-")}</td><td>${badge(task.priority)}</td><td>${escapeHtml(task.dueDate || "-")}</td></tr>`))}</article>
      <article class="panel span-6"><h2>آخر التقارير اليومية</h2>${table(["الموظف", "اليوم", "الحالة", "العوائق"], (data.dailyReports || []).slice(0, 30).map((report) => `<tr><td>${escapeHtml(report.employee?.fullName || "-")}</td><td>${escapeHtml(report.reportDate || "-")}</td><td>${badge(report.status)}</td><td>${escapeHtml(report.blockers || "-")}</td></tr>`))}</article>
    </section>`,
    "غرفة التحكم",
    "تنبيهات ذكية ومتابعة فورية لأخطر نقاط التشغيل.",
  );
  app.querySelector("#run-smart-audit")?.addEventListener("click", async () => { await endpoints.runSmartAudit(); setMessage("تم تحديث التنبيهات الذكية.", ""); renderControlRoom(); });
  app.querySelector("#export-control-room")?.addEventListener("click", () => downloadFile("control-room.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8"));
  app.querySelectorAll("[data-resolve-alert]").forEach((button) => button.addEventListener("click", async () => { await endpoints.resolveSmartAlert(button.dataset.resolveAlert, { note: "تم الإغلاق من غرفة التحكم" }); setMessage("تم إغلاق التنبيه.", ""); renderControlRoom(); }));
}

async function renderDataCenter() {
  const data = await endpoints.dataCenter().then(unwrap).catch(() => ({ counts: {}, importBatches: [], backups: [] }));
  const counts = data.counts || {};
  shell(
    `<section class="grid data-center-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>مركز البيانات والاستيراد الآمن</h2><p>تصدير نسخة كاملة، اختبار ملف استيراد قبل تطبيقه، وحفظ Snapshot قبل أي عملية حساسة.</p></div><div class="toolbar"><button class="button primary" id="download-full-backup">تنزيل Backup كامل</button></div></div></article>
      ${["employees","users","attendance","requests","documents","dailyReports","audits"].map((key) => `<article class="panel span-2"><span class="panel-kicker">${escapeHtml(key)}</span><strong class="big-number">${escapeHtml(counts[key] ?? 0)}</strong><p>سجل</p></article>`).join("")}
      <article class="panel span-6"><h2>اختبار ملف استيراد JSON</h2><p>ضع محتوى النسخة هنا أولًا، وسيخبرك النظام بالمشاكل قبل التطبيق.</p><form id="validate-import-form" class="form-grid compact-form"><label class="span-2">JSON<textarea name="payload" rows="10" placeholder='{ "employees": [], "users": [] }'></textarea></label><div class="form-actions"><button class="button ghost" name="mode" value="validate">فحص فقط</button><button class="button danger" name="mode" value="import">استيراد بعد الفحص</button></div></form><div id="import-result" class="message"></div></article>
      <article class="panel span-6"><h2>آخر عمليات الاستيراد والنسخ</h2>${table(["النوع", "العدد", "التاريخ"], [...(data.importBatches || []).map((row) => ({ type: "استيراد", count: row.employees || row.employeesCount || 0, date: row.createdAt })), ...(data.backups || []).map((row) => ({ type: row.title || "Backup", count: "-", date: row.createdAt }))].slice(0, 20).map((row) => `<tr><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.count)}</td><td>${date(row.date)}</td></tr>`))}</article>
    </section>`,
    "مركز البيانات",
    "أدوات أمان للتصدير والاستيراد وفحص البيانات.",
  );
  app.querySelector("#download-full-backup")?.addEventListener("click", async () => { const backup = await endpoints.exportFullBackup().then(unwrap); downloadFile(`ahla-shabab-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8"); });
  app.querySelector("#validate-import-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = event.submitter?.value || "validate";
    const box = app.querySelector("#import-result");
    try {
      const payload = JSON.parse(new FormData(event.currentTarget).get("payload") || "{}");
      const validation = await endpoints.validateImportBackup(payload).then(unwrap);
      if (mode === "import") {
        if (!await confirmAction({ title: "استيراد بيانات", message: "سيتم حفظ Backup قبل الاستيراد ثم تطبيق البيانات الجديدة على الوضع المحلي.", confirmLabel: "استيراد" })) return;
        const result = await endpoints.importBackup(payload).then(unwrap);
        box.className = "message success"; box.textContent = `تم الاستيراد: ${result.counts?.employees || 0} موظف.`;
      } else {
        box.className = validation.ok ? "message success" : "message error";
        box.textContent = `${validation.ok ? "صالح" : "به أخطاء"}: ${[...(validation.issues || []), ...(validation.warnings || [])].join(" — ") || "لا توجد مشاكل ظاهرة."}`;
      }
    } catch (error) { box.className = "message error"; box.textContent = error.message; }
  });
}

async function renderDailyReports() {
  const reports = await endpoints.dailyReports().then(unwrap).catch(() => []);
  shell(
    `<section class="grid daily-reports-page">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>التقارير اليومية للموظفين</h2><p>متابعة إنجازات اليوم والعوائق وخطة الغد لكل موظف ومدير.</p></div><div class="toolbar"><button class="button ghost" id="export-daily-reports">تصدير CSV</button></div></div></article>
      <article class="panel span-3"><span class="panel-kicker">الإجمالي</span><strong class="big-number">${reports.length}</strong><p>تقرير</p></article>
      <article class="panel span-3"><span class="panel-kicker">للمراجعة</span><strong class="big-number">${reports.filter((r) => r.status === "SUBMITTED").length}</strong><p>تحتاج مدير</p></article>
      <article class="panel span-3"><span class="panel-kicker">بها عوائق</span><strong class="big-number">${reports.filter((r) => r.blockers).length}</strong><p>تحتاج دعم</p></article>
      <article class="panel span-3"><span class="panel-kicker">اليوم</span><strong class="big-number">${reports.filter((r) => r.reportDate === new Date().toISOString().slice(0,10)).length}</strong><p>تم الإرسال</p></article>
      <article class="panel span-12">${table(["الموظف", "اليوم", "الإنجاز", "العوائق", "خطة الغد", "الحالة", "إجراء"], reports.map((report) => `<tr><td>${escapeHtml(report.employee?.fullName || "-")}</td><td>${escapeHtml(report.reportDate || "-")}</td><td>${escapeHtml(report.achievements || "-")}</td><td>${escapeHtml(report.blockers || "-")}</td><td>${escapeHtml(report.tomorrowPlan || "-")}</td><td>${badge(report.status)}</td><td>${report.status === "SUBMITTED" ? `<button class="button small" data-review-report="${escapeHtml(report.id)}">مراجعة</button>` : "-"}</td></tr>`))}</article>
    </section>`,
    "التقارير اليومية",
    "إدارة تقارير إنجاز الموظفين اليومية.",
  );
  app.querySelector("#export-daily-reports")?.addEventListener("click", () => downloadFile("daily-reports.csv", `\ufeff${toCsv([["الموظف","اليوم","الإنجاز","العوائق","خطة الغد","الحالة"], ...reports.map((r) => [r.employee?.fullName || "", r.reportDate || "", r.achievements || "", r.blockers || "", r.tomorrowPlan || "", r.status || ""])])}`, "text/csv;charset=utf-8"));
  app.querySelectorAll("[data-review-report]").forEach((button) => button.addEventListener("click", async () => { const comment = await askText({ title: "تعليق المراجعة", message: "اكتب تعليق المراجعة للتقرير اليومي.", defaultValue: "تمت المراجعة", confirmLabel: "حفظ المراجعة" }); if (comment === null) return; await endpoints.reviewDailyReport(button.dataset.reviewReport, { managerComment: comment }); setMessage("تمت مراجعة التقرير.", ""); renderDailyReports(); }));
}

async function renderExecutiveMobile() {
  const params = routeParams();
  const employeeId = params.get("employeeId") || "";
  if (employeeId) {
    const detail = await endpoints.executiveEmployeeDetail(employeeId).then(unwrap);
    const employee = detail.employee || {};
    const today = detail.today || {};
    const loc = today.latestLocation || {};
    const latestLiveRequest = [...(detail.liveRequests || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
    const pendingLiveRequest = (detail.liveRequests || []).find((row) => String(row.status || "").toUpperCase() === "PENDING");
    const locationMessage = loc.latitude && loc.longitude
      ? `<div class="executive-location-card"><div><span>آخر موقع فعلي</span><strong>${escapeHtml(locationPlaceLabel(loc))}</strong><small>${escapeHtml(date(loc.capturedAt || loc.respondedAt || loc.createdAt || loc.date))}</small></div><div class="executive-location-meta"><span>الدقة: ${escapeHtml(formatMeters(loc.accuracyMeters || loc.accuracy))}</span><span>${escapeHtml(locationStatusText(loc))}</span></div><a class="button primary" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${escapeHtml(loc.latitude)},${escapeHtml(loc.longitude)}">فتح اللوكيشن على الخريطة</a></div>`
      : pendingLiveRequest
        ? `<div class="message warning">تم إرسال طلب الموقع للموظف وهو الآن بانتظار الرد. سيظهر GPS هنا بعد ضغط الموظف على "إرسال موقعي".</div>`
        : latestLiveRequest && String(latestLiveRequest.status || "").toUpperCase() === "REJECTED"
          ? `<div class="message warning">آخر طلب موقع تم رفضه من الموظف${latestLiveRequest.responseNote ? `: ${escapeHtml(latestLiveRequest.responseNote)}` : ""}.</div>`
          : `<div class="message warning">لا يوجد موقع مباشر/بصمة GPS محفوظة لهذا الموظف حتى الآن.</div>`;
    shell(`
      <section class="grid executive-mobile-view">
        <article class="panel span-12">
          <div class="panel-head">
            <div><h2>متابعة تنفيذية — ${escapeHtml(employee.fullName || "موظف")}</h2><p>صفحة موبايل مختصرة للمدير التنفيذي: حالة اليوم، الحضور، الانصراف، الإجازة، والموقع الأخير.</p></div>
            <div class="toolbar"><button class="button ghost" data-route="executive-mobile">كل الموظفين</button><button class="button primary" data-request-live="${escapeHtml(employee.id || employeeId)}">طلب الموقع المباشر الآن</button></div>
          </div>
          <div class="executive-detail-header">
            <div class="detail-avatar-side">
              ${avatar(employee, "large")}
              <div class="detail-status-badge">${badge(today.status || "ABSENT")}</div>
            </div>
            <div class="detail-info-side">
              <h2 class="detail-name">${escapeHtml(employee.fullName || "-")}</h2>
              <div class="detail-job-title">${escapeHtml(employee.jobTitle || "موظف")}</div>
              <div class="detail-meta-tags">
                ${today.status === 'LEAVE' ? '<span class="tag warning">في إجازة رسمية</span>' : ''}
                ${today.checkInAt ? `<span class="tag success">حضر الساعة ${escapeHtml(date(today.checkInAt).split(' ').pop())}</span>` : '<span class="tag danger">لم يحضر بعد</span>'}
              </div>
            </div>
          </div>
          <div class="metric-grid">
            <article class="metric"><span>حالة اليوم</span><strong>${escapeHtml(statusLabel(today.status))}</strong><small>${escapeHtml(today.day || "")}</small></article>
            <article class="metric"><span>وقت الحضور</span><strong>${escapeHtml(date(today.checkInAt))}</strong><small>أول بصمة حضور</small></article>
            <article class="metric"><span>وقت الانصراف</span><strong>${escapeHtml(date(today.checkOutAt))}</strong><small>آخر بصمة انصراف</small></article>
            <article class="metric"><span>آخر موقع</span><strong>${loc.latitude && loc.longitude ? locationPlaceLabel(loc) : "لا يوجد"}</strong><small>${escapeHtml(date(loc.capturedAt || loc.respondedAt || loc.date))}</small></article>
          </div>
          ${locationMessage}
        </article>
        <article class="panel span-6"><h3>آخر 7 أيام حضور</h3>${table(["النوع", "الوقت", "الحالة", "ملاحظات"], (detail.attendance || []).slice(0, 12).map((row) => `<tr><td>${escapeHtml(statusLabel(row.type || row.action))}</td><td>${escapeHtml(date(row.eventAt || row.createdAt))}</td><td>${badge(row.geofenceStatus || row.status || "")}</td><td>${escapeHtml(row.notes || row.source || "")}</td></tr>`))}</article>
        <article class="panel span-6"><h3>الإجازات والمأموريات</h3>${table(["النوع", "الفترة", "الحالة"], [...(detail.leaves || []).map((row) => [row.leaveType?.name || row.leaveType || "إجازة", `${row.startDate || "-"} → ${row.endDate || "-"}`, row.status]), ...(detail.missions || []).map((row) => [row.destinationName || row.title || "مأمورية", `${row.plannedStart || "-"} → ${row.plannedEnd || "-"}`, row.status])].slice(0, 12).map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${badge(row[2])}</td></tr>`))}</article>
        <article class="panel span-12"><h3>طلبات الموقع المباشر</h3>${table(["الوقت", "الحالة", "السبب", "رد الموظف"], (detail.liveRequests || []).map((row) => `<tr><td>${escapeHtml(date(row.createdAt))}</td><td>${badge(row.status)}</td><td>${escapeHtml(row.reason || "")}</td><td>${escapeHtml(row.responseNote || row.note || (row.status === "APPROVED" ? "أرسل الموقع" : row.status === "POSTPONED" ? "رفض/تأجيل مؤقت" : row.status === "REJECTED" || row.status === "REJECTED_TEMPORARY" ? "رفض مؤقت" : "بانتظار الرد"))}<br><small>${escapeHtml(date(row.respondedAt))}</small></td></tr>`))}</article>
      </section>
    `, "المتابعة التنفيذية", "تفاصيل موظف من شاشة المدير التنفيذي.");
    app.querySelector("[data-request-live]")?.addEventListener("click", async (event) => {
      try { await endpoints.requestLiveLocation(event.currentTarget.dataset.requestLive, { reason: DEFAULT_LIVE_LOCATION_REASON, requestedByName: EXECUTIVE_REQUESTER_NAME }); setMessage("تم اعتماد طلب الموقع وإرساله مباشرة للموظف. سيظهر رد الموظف هنا عند إرسال الموقع.", ""); location.hash = `executive-mobile?employeeId=${encodeURIComponent(event.currentTarget.dataset.requestLive)}`; render(); } catch (error) { setMessage("", error.message || "تعذر طلب الموقع."); render(); }
    });
    return;
  }
  const data = await endpoints.executiveMobile().then(unwrap);
  const q = String(params.get("q") || "").trim();
  const employees = (data.employees || []).filter((employee) => !q || String(employee.fullName || "").includes(q) || String(employee.phone || "").includes(q));
  const missingLocation = employees.filter((employee) => !employee.today?.latestLocation?.latitude);
  const pendingLocation = employees.filter((employee) => employee.today?.pendingLiveRequest);
  const outOfRange = employees.filter((employee) => Number(employee.today?.latestLocation?.accuracyMeters || 0) > 300);
  shell(`
    <section class="grid executive-mobile-view executive-ops-page">
      <article class="panel span-12 accent-panel">
        <div class="panel-head"><div><h2>غرفة عمليات المدير التنفيذي</h2><p>متابعة فورية للحضور وطلبات الموقع: الطلب يُعتمد ويرسل مباشرة للموظف، والرد المطلوب هو إرسال الموقع الحالي فقط.</p></div><div class="toolbar"><button class="button ghost" data-action="refresh">تحديث</button><button class="button primary" data-route="locations">مراقبة اللوكيشن</button></div></div>
        <div class="metric-grid">
          ${[["إجمالي", data.counts?.total], ["حاضر", data.counts?.present], ["متأخر", data.counts?.late], ["غائب", data.counts?.absent], ["مواقع معلقة", pendingLocation.length], ["بدون GPS", missingLocation.length], ["دقة ضعيفة", outOfRange.length]].map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong><small>اليوم</small></article>`).join("")}
        </div>
        <form class="toolbar" id="exec-search"><input name="q" placeholder="بحث باسم الموظف أو الهاتف" value="${escapeHtml(q)}" /><button class="button ghost" type="submit">بحث</button></form>
      </article>
      <article class="panel span-12"><div class="employee-card-grid">
        ${employees.map((employee) => `
          <article class="mini-card executive-employee-card">
            <div class="card-status-corner">${badge(employee.today?.status || "ABSENT")}</div>
            <div class="card-avatar-box">
              ${avatar(employee, "large")}
            </div>
            <div class="card-info-box">
              <strong class="emp-name">${escapeHtml(employee.fullName || "-")}</strong>
              <div class="emp-job-title">${escapeHtml(employee.jobTitle || "موظف")}</div>
              ${employee.today?.pendingLiveRequest ? '<div class="tag warning">طلب موقع بانتظار الرد</div>' : employee.today?.latestLocation?.latitude ? '<div class="tag success">GPS متاح</div>' : '<div class="tag danger">لا يوجد GPS حديث</div>'}
            </div>
            <div class="card-actions-row">
              <button class="button primary" data-request-live="${escapeHtml(employee.id)}">طلب موقع مباشر</button>
              <button class="button ghost" data-view-exec="${escapeHtml(employee.id)}">التفاصيل</button>
            </div>
          </article>
        `).join("") || `<div class="empty">لا توجد نتائج.</div>`}
      </div></article>
    </section>
  `, "المتابعة التنفيذية", "كل الموظفين في شاشة موبايل تنفيذية.");
  app.querySelector("#exec-search")?.addEventListener("submit", (event) => { event.preventDefault(); const values = readForm(event.currentTarget, { passwordPolicy: "none" }); location.hash = `executive-mobile?q=${encodeURIComponent(values.q || "")}`; });
  app.querySelectorAll("[data-view-exec]").forEach((button) => button.addEventListener("click", () => { location.hash = `executive-mobile?employeeId=${encodeURIComponent(button.dataset.viewExec)}`; }));
  app.querySelectorAll("[data-request-live]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "جاري الإرسال...";
    try {
      await endpoints.requestLiveLocation(button.dataset.requestLive, { reason: DEFAULT_LIVE_LOCATION_REASON, requestedByName: EXECUTIVE_REQUESTER_NAME });
      setMessage("تم اعتماد طلب الموقع وإرساله مباشرة للموظف. بانتظار إرسال الموقع من الموظف.", "");
      renderExecutiveMobile();
    } catch (error) {
      setMessage("", error.message || "تعذر طلب الموقع.");
      button.disabled = false;
      button.textContent = originalText;
    }
  }));
}

async function renderSensitiveApprovals() {
  const data = await endpoints.sensitiveApprovals().then(unwrap).catch(() => ({ rows: [], counts: {} }));
  const rows = data.rows || [];
  const counts = data.counts || {};
  shell(
    `<section class="grid approvals-page">
      <article class="panel span-12">
        <div class="panel-head"><div><h2>مركز الاعتمادات الحساسة</h2><p>أي حذف أو تعطيل حساس يتحول إلى طلب اعتماد تنفيذي بدل التنفيذ المباشر، لحماية بيانات الموظفين ومنع الأخطاء.</p></div><div class="toolbar"><button class="button ghost" data-action="refresh">تحديث</button></div></div>
        <div class="metric-grid">
          ${[["إجمالي", counts.total || 0], ["معلق", counts.PENDING || 0], ["منفذ", counts.EXECUTED || 0], ["مرفوض", counts.REJECTED || 0]].map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>اعتمادات</small></article>`).join("")}
        </div>
      </article>
      <article class="panel span-12">
        ${table(["الطلب", "المستهدف", "الطالب", "الحالة", "الوقت", "إجراء"], rows.map((row) => `
          <tr>
            <td><strong>${escapeHtml(row.title || row.actionType)}</strong><small>${escapeHtml(row.summary || "")}</small></td>
            <td>${escapeHtml(row.employee?.fullName || row.targetId || "-")}</td>
            <td>${escapeHtml(row.requestedByName || "-")}</td>
            <td>${badge(row.status || "PENDING")}</td>
            <td>${escapeHtml(date(row.createdAt || row.requestedAt))}</td>
            <td>${row.status === "PENDING" ? `<button class="button primary" data-approve-sensitive="${escapeHtml(row.id)}">اعتماد وتنفيذ</button><button class="button danger" data-reject-sensitive="${escapeHtml(row.id)}">رفض</button>` : `<small>${escapeHtml(row.decisionNote || row.executedAt || "تمت المراجعة")}</small>`}</td>
          </tr>`))}
      </article>
    </section>`,
    "اعتمادات حساسة",
    "اعتماد العمليات التي قد تؤثر على بيانات الموظفين أو الحسابات.",
  );
  app.querySelectorAll("[data-approve-sensitive]").forEach((button) => button.addEventListener("click", async () => {
    const note = await askText({ title: "ملاحظة الاعتماد", message: "اكتب ملاحظة الاعتماد والتنفيذ.", defaultValue: "معتمد من الإدارة التنفيذية", confirmLabel: "اعتماد وتنفيذ" }) || "معتمد";
    try { await endpoints.decideSensitiveApproval(button.dataset.approveSensitive, { decision: "approve", note, execute: true }); setMessage("تم اعتماد وتنفيذ الطلب.", ""); renderSensitiveApprovals(); } catch (error) { setMessage("", error.message || "تعذر تنفيذ الاعتماد."); renderSensitiveApprovals(); }
  }));
  app.querySelectorAll("[data-reject-sensitive]").forEach((button) => button.addEventListener("click", async () => {
    const note = await askText({ title: "سبب الرفض", message: "اكتب سبب رفض الطلب الحساس.", defaultValue: "غير مناسب للتنفيذ", confirmLabel: "رفض الطلب" }) || "مرفوض";
    try { await endpoints.decideSensitiveApproval(button.dataset.rejectSensitive, { decision: "reject", note, execute: false }); setMessage("تم رفض الطلب.", ""); renderSensitiveApprovals(); } catch (error) { setMessage("", error.message || "تعذر رفض الطلب."); renderSensitiveApprovals(); }
  }));
}

async function renderGeneric(title, description, loader) {
  const rows = unwrap(await loader());
  shell(`<section class="grid"><article class="panel"><h2>${escapeHtml(title)}</h2>${table(["المعرف", "العنوان/الاسم", "الموظف", "الحالة", "التاريخ"], rows.map((item) => `<tr><td>${escapeHtml(item.id || "-")}</td><td>${escapeHtml(item.title || item.name || item.fullName || item.key || "-")}</td><td>${escapeHtml(item.employee?.fullName || "-")}</td><td>${badge(item.status || item.type || "-")}</td><td>${date(item.createdAt || item.updatedAt || item.date)}</td></tr>`))}</article></section>`, title, description);
}

function submitForm(handler, successMessage) {
  return async (event) => {
    event.preventDefault();
    try {
      await handler(readForm(event.currentTarget));
      setMessage(successMessage, "");
      render();
    } catch (error) {
      setMessage("", error.message);
      render();
    }
  };
}

async function attendanceExportRows() {
  const events = await endpoints.attendanceEvents().then(unwrap);
  return events.map((event) => [event.employee?.fullName || event.employeeId, statusLabel(event.type), date(event.eventAt), event.source || "-", statusLabel(event.geofenceStatus), event.notes || ""]);
}

async function exportAttendanceCsv() {
  const headers = ["الموظف", "النوع", "التاريخ", "المصدر", "الموقع", "ملاحظات"];
  downloadFile("attendance-report.csv", `\ufeff${toCsv([headers, ...(await attendanceExportRows())])}`, "text/csv;charset=utf-8");
}

async function exportAttendanceExcel() {
  exportHtmlTable("attendance-report.xls", ["الموظف", "النوع", "التاريخ", "المصدر", "الموقع", "ملاحظات"], await attendanceExportRows());
}

async function printAttendanceReport() {
  printReport("تقرير الحضور والانصراف", ["الموظف", "النوع", "التاريخ", "المصدر", "الموقع", "ملاحظات"], await attendanceExportRows());
}

function smartStatusLabel(value = "") {
  const map = { PRESENT: "حاضر", LATE: "متأخر", ABSENT_TEMP: "غائب مؤقتًا", ABSENT: "غائب", EARLY_EXIT: "خروج مبكر", MISSING_CHECKOUT: "نسيان انصراف", REVIEW: "مراجعة", ON_LEAVE: "إجازة", ON_MISSION: "مأمورية", ABSENT_PENDING: "لم يحضر بعد" };
  return map[value] || statusLabel(value);
}

async function renderSmartAttendance() {
  const [rulesData, runData] = await Promise.all([
    endpoints.smartAttendanceRules().then(unwrap).catch(() => ({ rules: {} })),
    endpoints.runSmartAttendance({ date: todayIso() }).then(unwrap).catch(() => ({ rows: [], counts: {} })),
  ]);
  const rules = rulesData.rules || {};
  const rows = runData.rows || [];
  shell(`
    <section class="stack">
      <article class="panel accent-panel">
        <div class="panel-head"><div><h2>قواعد الحضور الذكية</h2><p>تحديد التأخير والغياب المؤقت والخروج المبكر ونسيان الانصراف وتكرار البصمات المشبوهة.</p></div><button class="button primary" data-run-smart-attendance>تشغيل التحليل الآن</button></div>
        <form class="form-grid" id="smart-rules-form">
          <label>بداية الدوام<input type="time" name="shiftStart" value="${escapeHtml(rules.shiftStart || '10:00')}" /></label>
          <label>اعتبار غياب مؤقت بعد<input type="time" name="absentAfter" value="${escapeHtml(rules.absentAfter || '11:00')}" /></label>
          <label>الخروج المبكر قبل<input type="time" name="earlyExitBefore" value="${escapeHtml(rules.earlyExitBefore || '17:00')}" /></label>
          <label>نهاية الدوام<input type="time" name="shiftEnd" value="${escapeHtml(rules.shiftEnd || '18:00')}" /></label>
          <label>نافذة التكرار المشبوه بالدقائق<input type="number" min="1" name="duplicateWindowMinutes" value="${escapeHtml(rules.duplicateWindowMinutes || 10)}" /></label>
          <label>تقرير آخر اليوم في<input type="time" name="endOfDayReportAt" value="${escapeHtml(rules.endOfDayReportAt || '19:00')}" /></label>
          <label class="check-row"><input type="checkbox" name="notifyManagerOnAbsence" ${rules.notifyManagerOnAbsence !== false ? 'checked' : ''} /> إخطار المدير عند الغياب/المشكلة</label>
          <button class="button primary" type="submit">حفظ القواعد</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-head"><div><h2>تحليل اليوم</h2><p>آخر تشغيل: ${escapeHtml(date(runData.run?.createdAt || new Date().toISOString()))}</p></div><button class="button ghost" data-generate-eod>تقرير تلقائي آخر اليوم</button></div>
        <div class="mini-stats">${Object.entries(runData.counts || {}).map(([k,v]) => `<div><span>${escapeHtml(smartStatusLabel(k))}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}</div>
        ${table(["الموظف", "الحالة", "حضور", "انصراف", "ملاحظات"], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee, 'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td>${badge(smartStatusLabel(row.status))}</td><td>${date(row.firstCheckInAt)}</td><td>${date(row.lastCheckOutAt)}</td><td>${escapeHtml(row.recommendation || '')}<br><small>${escapeHtml((row.flags || []).join(' / '))}</small></td></tr>`))}
      </article>
    </section>`,
    "قواعد الحضور الذكية",
    "تشغيل تلقائي ومنطقي لكل حالات الحضور غير الطبيعية.",
  );
  app.querySelector('#smart-rules-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    values.notifyManagerOnAbsence = Boolean(event.currentTarget.querySelector('[name="notifyManagerOnAbsence"]')?.checked);
    await endpoints.saveSmartAttendanceRules(values);
    setMessage('تم حفظ قواعد الحضور الذكية.', '');
    renderSmartAttendance();
  });
  app.querySelector('[data-run-smart-attendance]')?.addEventListener('click', async () => {
    await endpoints.runSmartAttendance({ date: todayIso() });
    setMessage('تم تشغيل تحليل الحضور الذكي وإرسال التنبيهات اللازمة.', '');
    renderSmartAttendance();
  });
  app.querySelector('[data-generate-eod]')?.addEventListener('click', async () => {
    const report = unwrap(await endpoints.endOfDayReport({ date: todayIso() }));
    setMessage(`تم إنشاء تقرير آخر اليوم: ${report.title}`, '');
    renderSmartAttendance();
  });
}

async function renderExecutivePdfReports() {
  shell(`
    <section class="grid">
      <article class="panel span-12 accent-panel"><div class="panel-head"><div><h2>تقارير تنفيذية PDF للمدير التنفيذي</h2><p>تصدير تقرير اليوم أو الأسبوع أو الشهر بصيغة قابلة للطباعة PDF من المتصفح.</p></div></div>
        <div class="quick-action-grid"><button class="button primary" data-exec-report="daily">تقرير اليوم</button><button class="button ghost" data-exec-report="weekly">تقرير الأسبوع</button><button class="button ghost" data-exec-report="monthly">تقرير الشهر</button></div>
      </article>
      <article class="panel span-12"><h2>محتوى التقرير</h2><p>يشمل الحضور، الغياب، التأخير، الإجازات، المأموريات، المشاكل المفتوحة، والتنبيهات الذكية.</p></article>
    </section>
  `, "تقارير المدير التنفيذي PDF", "طباعة وحفظ تقارير تنفيذية للمدير التنفيذي.");
  app.querySelectorAll('[data-exec-report]').forEach((button) => button.addEventListener('click', async () => {
    const period = button.dataset.execReport;
    const data = unwrap(await endpoints.executivePdfReportData({ period }));
    const title = period === 'daily' ? 'تقرير اليوم التنفيذي' : period === 'weekly' ? 'تقرير الأسبوع التنفيذي' : 'تقرير الشهر التنفيذي';
    const report = data.report || {};
    const summary = `<div class="summary"><div><span>الموظفون</span><strong>${report.totals?.employees || 0}</strong></div><div><span>حاضر</span><strong>${report.totals?.present || 0}</strong></div><div><span>غائب</span><strong>${report.totals?.absent || 0}</strong></div><div><span>يحتاج مراجعة</span><strong>${report.totals?.review || 0}</strong></div></div>`;
    printBrandedReport(title, summary, ["الموظف", "الحالة", "حضور", "انصراف", "توصية"], (report.rows || []).map((row) => [row.employeeName, smartStatusLabel(row.status), date(row.firstCheckInAt), date(row.lastCheckOutAt), row.recommendation || '']));
  }));
}

async function renderEmployeeArchive() {
  const employees = await endpoints.employees().then(unwrap).catch(() => []);
  const params = new URLSearchParams((state.route || '').split('?')[1] || '');
  const selectedId = params.get('id') || employees[0]?.id || '';
  const archive = selectedId ? await endpoints.employeeArchive(selectedId).then(unwrap).catch((error) => ({ error: error.message })) : null;
  const employee = archive?.employee || employees.find((item) => item.id === selectedId) || null;
  const latestDaily = safeList(archive?.daily).find((row) => row.firstCheckInAt || row.lastCheckOutAt || row.status) || null;
  const latestRequest = [...safeList(archive?.leaves).map((item) => ({ kind: 'إجازة', title: item.leaveType || item.reason || '-', status: item.status, at: item.createdAt || item.startDate })), ...safeList(archive?.missions).map((item) => ({ kind: 'مأمورية', title: item.title || item.destinationName || '-', status: item.status, at: item.createdAt || item.plannedStart }))].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0))[0];
  const latestKpi = safeList(archive?.kpi).sort((a,b)=>String(b.month||b.cycleId||'').localeCompare(String(a.month||a.cycleId||'')))[0];
  const profileMetrics = archive && !archive.error ? `
    <div class="metric-grid unified-profile-metrics">
      ${metric('بصمات', archive.summary?.attendanceEvents || 0, 'إجمالي محفوظ')}
      ${metric('غياب', archive.summary?.absences || 0, 'ضمن السجل')}
      ${metric('تأخير', `${archive.summary?.lateMinutes || 0} د`, 'إجمالي دقائق')}
      ${metric('مهام مفتوحة', archive.summary?.openTasks || 0, 'تحتاج متابعة')}
    </div>` : '';
  shell(`
    <section class="stack unified-employee-profile">
      <article class="panel accent-panel"><div class="panel-head"><div><h2>صفحة موظف موحدة</h2><p>ملف HR مختصر وقوي يجمع بيانات الموظف، الحضور، الطلبات، المستندات، والتقييمات في صفحة واحدة.</p></div><div class="toolbar"><button class="button ghost" data-print-archive>طباعة PDF</button><button class="button primary" type="button" data-route="employees">إدارة الموظفين</button></div></div>
        <form class="filters" id="archive-filter"><select name="employeeId">${optionList(employees.map((e) => ({ id: e.id, name: e.fullName })), selectedId, 'اختر موظف')}</select><button class="button primary">فتح الملف</button></form>
      </article>
      ${archive?.error ? `<article class="panel"><div class="message error">${escapeHtml(archive.error)}</div></article>` : archive ? `
      <article class="panel profile-card employee-unified-hero"><div class="person-cell large">${avatar(employee, 'large')}<span><strong>${escapeHtml(employee?.fullName || '')}</strong><small>${escapeHtml(employee?.jobTitle || '')}</small><small>${escapeHtml(employee?.phone || employee?.email || '')}</small></span></div>${profileMetrics}
        <div class="quick-insight-grid">
          <div><span>حالة آخر يوم</span><strong>${escapeHtml(smartStatusLabel(latestDaily?.smartStatus || latestDaily?.status || '-'))}</strong><small>${escapeHtml(latestDaily?.date || '-')}</small></div>
          <div><span>آخر طلب</span><strong>${escapeHtml(latestRequest?.kind || '-')}</strong><small>${escapeHtml(latestRequest ? `${latestRequest.title} — ${latestRequest.status || '-'}` : 'لا توجد طلبات')}</small></div>
          <div><span>آخر KPI</span><strong>${escapeHtml(latestKpi?.totalScore || 0)}</strong><small>${escapeHtml(latestKpi?.status || 'لا يوجد تقييم')}</small></div>
          <div><span>المدير المباشر</span><strong>${escapeHtml(employee?.manager?.fullName || '-')}</strong><small>حسب الهيكل الحالي</small></div>
        </div>
      </article>
      <article class="panel"><div class="panel-head"><div><h2>الحضور اليومي</h2><p>آخر 30 سجل حضور وانصراف مع التوصية.</p></div><button class="button ghost" type="button" data-route="attendance">فتح الحضور</button></div>${table(['اليوم','الحالة','حضور','انصراف','ملاحظات'], safeList(archive.daily).slice(0,30).map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${badge(smartStatusLabel(row.smartStatus || row.status))}</td><td>${date(row.firstCheckInAt)}</td><td>${date(row.lastCheckOutAt)}</td><td>${escapeHtml(row.recommendation || '')}</td></tr>`))}</article>
      <article class="panel"><div class="panel-head"><div><h2>الطلبات والمستندات</h2><p>إجازات، مأموريات، ومرفقات الموظف في شاشة واحدة.</p></div><button class="button ghost" type="button" data-route="requests">فتح الطلبات</button></div>${table(['النوع','العنوان','الحالة','التاريخ'], [...safeList(archive.leaves).map(i=>['إجازة', i.leaveType || i.reason || '-', i.status, i.createdAt || i.startDate]), ...safeList(archive.missions).map(i=>['مأمورية', i.title || i.destinationName || '-', i.status, i.createdAt || i.plannedStart]), ...safeList(archive.documents).map(i=>['مستند', i.title || i.fileName || '-', i.status, i.expiresOn])].map((row)=>`<tr>${row.map((c)=>`<td>${escapeHtml(c || '-')}</td>`).join('')}</tr>`))}</article>
      <article class="panel"><div class="panel-head"><div><h2>التقييمات KPI</h2><p>آخر تقييمات الموظف ودرجاته الشهرية.</p></div><button class="button ghost" type="button" data-route="kpi">فتح KPI</button></div>${table(['الشهر/الدورة','الحضور','الإجمالي','الحالة'], safeList(archive.kpi).slice(0,20).map((row) => `<tr><td>${escapeHtml(row.month || row.cycleId || '-')}</td><td>${escapeHtml(row.attendanceScore || 0)}</td><td>${escapeHtml(row.totalScore || 0)}</td><td>${badge(row.status || 'DRAFT')}</td></tr>`))}</article>` : `<article class="panel"><div class="empty-state">اختر موظفًا لعرض الملف الموحد.</div></article>`}
    </section>
  `, "صفحة موظف موحدة", "ملف شامل لكل موظف بدون تشتيت صفحات HR.");
  app.querySelector('#archive-filter')?.addEventListener('submit', (event) => { event.preventDefault(); const values = readForm(event.currentTarget); location.hash = `employee-archive?id=${encodeURIComponent(values.employeeId)}`; });
  app.querySelector('[data-print-archive]')?.addEventListener('click', () => window.print());
}

async function renderSmartAlerts() {
  const data = await endpoints.smartAdminAlerts().then(unwrap).catch(() => ({ alerts: [] }));
  const alerts = data.alerts || [];
  shell(`<section class="panel"><div class="panel-head"><div><h2>التنبيهات الذكية للإدارة</h2><p>تنبيهات تلقائية عن الغياب، التأخير، نسيان الانصراف، المستندات، والطلبات المتأخرة.</p></div><button class="button primary" data-refresh-smart-alerts>تحديث التنبيهات</button></div>${table(['العنوان','الخطورة','المسار','الوقت'], alerts.map((a)=>`<tr><td>${escapeHtml(a.title)}<br><small>${escapeHtml(a.body || '')}</small></td><td>${badge(a.severity || 'MEDIUM')}</td><td>${escapeHtml(a.route || '-')}</td><td>${date(a.updatedAt || a.createdAt)}</td></tr>`))}</section>`, "التنبيهات الذكية", "متابعة استباقية بدون بحث يدوي.");
  app.querySelector('[data-refresh-smart-alerts]')?.addEventListener('click', async () => { await endpoints.smartAdminAlerts(); setMessage('تم تحديث التنبيهات.', ''); renderSmartAlerts(); });
}

async function renderManagerSuite() {
  const data = await endpoints.managerSuite().then(unwrap);
  const rows = data.smartRows || [];
  shell(`<section class="stack"><article class="panel accent-panel"><div class="panel-head"><div><h2>لوحة المدير المباشر</h2><p>كل مدير يرى فريقه فقط: حضور اليوم، طلبات معلقة، مهام، وتنبيهات.</p></div></div><div class="mini-stats">${(data.metrics||[]).map((m)=>`<div><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong><small>${escapeHtml(m.helper||'')}</small></div>`).join('')}</div></article><article class="panel"><h2>فريقك اليوم</h2>${table(['الموظف','الحالة','حضور','انصراف','إجراء'], rows.map((row)=>`<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName||row.employeeId)}</span></td><td>${badge(smartStatusLabel(row.status))}</td><td>${date(row.firstCheckInAt)}</td><td>${date(row.lastCheckOutAt)}</td><td><button class="button ghost" data-route="employee-archive?id=${escapeHtml(row.employeeId)}">أرشيف</button></td></tr>`))}</article><article class="panel"><h2>طلبات الفريق المعلقة</h2>${table(['النوع','الموظف','الحالة','التاريخ'], (data.pending||[]).map((item)=>`<tr><td>${escapeHtml(item.kindLabel||item.kind)}</td><td>${escapeHtml(item.employee?.fullName||'-')}</td><td>${badge(item.status)}</td><td>${date(item.createdAt||item.createdSort)}</td></tr>`))}</article></section>`, "لوحة المدير المباشر", "إدارة الفريق اليومي.");
}

async function renderMonthlyEvaluations() {
  const data = await endpoints.monthlyEvaluations({ month: new Date().toISOString().slice(0,7) }).then(unwrap);
  const rows = data.evaluations || [];
  shell(`<section class="panel"><div class="panel-head"><div><h2>التقييم الشهري</h2><p>تقييم شهري يجمع الالتزام بالحضور والأداء والسلوك والمبادرات.</p></div><button class="button ghost" data-export-evaluations>تصدير CSV</button></div>${table(['الموظف','الحضور','الأداء','السلوك','الإجمالي','الحالة','حفظ'], rows.map((row)=>`<tr data-eval-row="${escapeHtml(row.id)}"><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName||row.employeeId)}</span></td><td><input class="mini-input" name="attendanceScore" value="${escapeHtml(row.attendanceScore||0)}" /></td><td><input class="mini-input" name="efficiencyScore" value="${escapeHtml(row.efficiencyScore||0)}" /></td><td><input class="mini-input" name="conductScore" value="${escapeHtml(row.conductScore||0)}" /></td><td><strong>${escapeHtml(row.totalScore||0)}</strong></td><td>${badge(row.status||'DRAFT')}</td><td><button class="button primary" data-save-eval="${escapeHtml(row.id)}">حفظ</button></td></tr>`))}</section>`, "التقييم الشهري", "إدارة تقييمات الأداء.");
  app.querySelectorAll('[data-save-eval]').forEach((button)=>button.addEventListener('click', async ()=>{ const tr=button.closest('tr'); const values=Object.fromEntries([...tr.querySelectorAll('input')].map((i)=>[i.name,i.value])); await endpoints.saveMonthlyEvaluation(button.dataset.saveEval, values); setMessage('تم حفظ التقييم.', ''); renderMonthlyEvaluations(); }));
  app.querySelector('[data-export-evaluations]')?.addEventListener('click', ()=>downloadFile('monthly-evaluations.csv', `\ufeff${toCsv([['الموظف','الحضور','الأداء','السلوك','الإجمالي'], ...rows.map((r)=>[r.employee?.fullName||r.employeeId,r.attendanceScore,r.efficiencyScore,r.conductScore,r.totalScore])])}`, 'text/csv;charset=utf-8'));
}

async function renderPresenceMap() {
  const data = await endpoints.executivePresenceDashboard().then(unwrap);
  const rows = data.rows || [];
  const missing = rows.filter((row) => !row.lastLocation?.latitude && ["PRESENT", "LATE", "CHECKED_OUT"].includes(row.status));
  const located = rows.filter((row) => row.lastLocation?.latitude && row.lastLocation?.longitude);
  shell(`<section class="stack presence-live-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>لوحة حضور لحظية للمدير التنفيذي</h2><p>خريطة مباشرة توضّح الحضور، التأخير، الخروج عن النطاق، ومن لم يرسل موقعه.</p></div><button class="button primary" data-refresh-presence>تحديث الآن</button></div>
      <div class="metric-grid">${metric("حاضر", data.counts?.PRESENT || 0, "داخل المتابعة")}${metric("متأخر", data.counts?.LATE || 0, "يحتاج متابعة")}${metric("غائب", data.counts?.ABSENT || 0, "لم يسجل حضور")}${metric("لم يرسل موقع", missing.length, "حاضر بلا GPS")}${metric("خارج النطاق", data.counts?.outOfRange || 0, "بصمة مشكوك بها")}</div>
    </article>
    <article class="panel"><div class="panel-head"><div><h2>الخريطة المباشرة</h2><p>نقاط الموظفين المتاحة تظهر كرابط مباشر على Google Maps، والباقي يظهر في قائمة "لم يرسل الموقع".</p></div></div>
      <div class="live-map-board">${located.map((row, index) => `<a class="map-pin risk-${escapeHtml(row.risk?.level || 'CLEAR')}" style="--x:${12 + (index * 17) % 76}%;--y:${18 + (index * 23) % 64}%" target="_blank" rel="noopener" href="${escapeHtml(row.mapUrl)}"><strong>${escapeHtml(row.employee?.fullName || row.employeeId)}</strong><span>${escapeHtml(statusLabel(row.status))} · خطر ${escapeHtml(row.risk?.score || 0)}%</span></a>`).join('') || `<div class="empty">لا توجد مواقع GPS متاحة على الخريطة الآن.</div>`}</div>
    </article>
    <article class="panel"><h2>تفاصيل الحضور والموقع</h2>${table(['الموظف','الحالة','الحضور','الانصراف','الموقع','مخاطر'], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td>${badge(row.status)}</td><td>${date(row.checkInAt)}</td><td>${date(row.checkOutAt)}</td><td>${row.mapUrl ? `<a target="_blank" rel="noopener" href="${escapeHtml(row.mapUrl)}">فتح الخريطة</a>` : '<span class="status warning">لم يرسل الموقع</span>'}</td><td>${badge(row.risk?.level || 'CLEAR')} ${escapeHtml(row.risk?.score || 0)}%</td></tr>`))}</article>
  </section>`, "خريطة الحضور اللحظية", "متابعة تنفيذية مباشرة للحضور والموقع.");
  app.querySelector('[data-refresh-presence]')?.addEventListener('click', () => renderPresenceMap());
}

async function renderAttendanceRisk() {
  const data = await endpoints.attendanceRiskCenter({ days: 7 }).then(unwrap);
  const rows = data.rows || [];
  shell(`<section class="stack attendance-risk-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>نظام تقييم خطر البصمة</h2><p>يرصد تكرار البصمة، الموقع غير الطبيعي، الجهاز الجديد، الحضور من مكان بعيد، والبصمة بدون GPS.</p></div><button class="button ghost" data-refresh-risk>إعادة التقييم</button></div>
      <div class="chips">${(data.rules || []).map((rule) => `<span class="chip">${escapeHtml(rule)}</span>`).join('')}</div>
      <div class="metric-grid">${metric('عالي', data.counts?.HIGH || 0, 'تحقيق فوري')}${metric('متوسط', data.counts?.MEDIUM || 0, 'مراجعة المدير')}${metric('منخفض', data.counts?.LOW || 0, 'متابعة')}${metric('سليم', data.counts?.CLEAR || 0, 'لا مؤشرات')}</div>
    </article>
    <article class="panel"><h2>الموظفون حسب درجة الخطر</h2>${table(['الموظف','الدرجة','المستوى','الأسباب','آخر أحداث'], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employeeId)}</span></td><td><strong>${escapeHtml(row.score)}%</strong></td><td>${badge(row.level)}</td><td>${(row.flags || []).map((flag) => `<span class="chip danger-soft">${escapeHtml(flag.label)}</span>`).join('') || '—'}</td><td>${(row.events || []).slice(0,3).map((event) => `${escapeHtml(statusLabel(event.type || event.action || event.status))} ${date(event.eventAt || event.createdAt)}`).join('<br>')}</td></tr>`))}</article>
  </section>`, "مخاطر البصمة", "كشف التلاعب أو البصمات غير الطبيعية.");
  app.querySelector('[data-refresh-risk]')?.addEventListener('click', () => renderAttendanceRisk());
}

async function renderAdminDecisions() {
  const data = await endpoints.adminDecisions().then(unwrap);
  const rows = data.decisions || [];
  shell(`<section class="stack admin-decisions-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>سجل القرارات الإدارية الرسمي</h2><p>كل قرار يصل للموظفين ويحتاج "تم الاطلاع" مع توقيت القراءة.</p></div></div>
      <form id="decision-form" class="form-grid compact-form"><label>عنوان القرار<input name="title" required /></label><label>الأولوية<select name="priority"><option value="MEDIUM">متوسطة</option><option value="HIGH">عالية</option><option value="LOW">منخفضة</option></select></label><label class="span-2">نص القرار<textarea name="body" rows="4" required></textarea></label><label>النطاق<select name="scope"><option value="ALL">كل الموظفين</option><option value="SELECTED">موظفون محددون</option></select></label><label>أكواد الموظفين المحددين<input name="targetEmployeeIds" placeholder="اختياري: employee ids مفصولة بفاصلة" /></label><button class="button primary" type="submit">نشر القرار وإرسال إشعار</button></form>
    </article>
    <article class="panel"><h2>القرارات المنشورة</h2>${table(['العنوان','الأولوية','النطاق','النشر','الاطلاع','النص'], rows.map((row) => `<tr><td><strong>${escapeHtml(row.title)}</strong></td><td>${badge(row.priority)}</td><td>${escapeHtml(row.scope || 'ALL')}</td><td>${date(row.publishedAt || row.createdAt)}</td><td><strong>${escapeHtml((row.acknowledgements || []).length || (row.acknowledged ? 1 : 0))}</strong></td><td>${escapeHtml(row.body || '')}</td></tr>`))}</article>
  </section>`, "سجل القرارات الإدارية", "قرارات رسمية قابلة للتوقيع والاطلاع.");
  app.querySelector('#decision-form')?.addEventListener('submit', async (event) => { event.preventDefault(); await endpoints.createAdminDecision(readForm(event.currentTarget)); setMessage('تم نشر القرار وإرسال الإشعارات.', ''); renderAdminDecisions(); });
}

async function renderMonthlyAutoPdfReports() {
  const month = new Date().toISOString().slice(0,7);
  const data = await endpoints.monthlyAutoPdfReports({ month }).then(unwrap);
  shell(`<section class="stack monthly-pdf-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>تقارير PDF شهرية تلقائية</h2><p>تجميع تلقائي للحضور، التأخير، الغياب، KPI، الشكاوى والطلبات لكل موظف ولكل مدير.</p></div><div class="toolbar"><button class="button primary" data-print-monthly>طباعة / حفظ PDF</button><button class="button ghost" data-regenerate-monthly>إعادة التوليد</button></div></div>
      <div class="metric-grid">${metric('الموظفون', data.attendance?.rows?.length || 0, 'داخل التقرير')}${metric('المديرون', data.managers?.length || 0, 'تقارير فرق')}${metric('الشكاوى', data.disputes?.length || 0, 'هذا الشهر')}${metric('الطلبات', data.requests?.length || 0, 'هذا الشهر')}</div>
    </article>
    <article class="panel print-area"><h2>${escapeHtml(data.title)}</h2><p>تاريخ التوليد: ${date(data.generatedAt)}</p><h3>ملخص الموظفين</h3>${table(['الموظف','حضور','تأخير','غياب','ملاحظات'], (data.attendance?.rows || []).map((row) => `<tr><td>${escapeHtml(row.employee?.fullName || row.employeeName || row.employeeId)}</td><td>${escapeHtml(row.presentDays || row.present || 0)}</td><td>${escapeHtml(row.lateMinutes || 0)} دقيقة</td><td>${escapeHtml(row.absentDays || row.absences || 0)}</td><td>${escapeHtml(row.recommendation || row.status || '')}</td></tr>`))}<h3>تقارير المديرين</h3>${table(['المدير','عدد الفريق','KPI','الشكاوى','الطلبات'], (data.managers || []).map((row) => `<tr><td>${escapeHtml(row.manager?.fullName || row.manager?.name || '')}</td><td>${escapeHtml(row.teamCount || 0)}</td><td>${escapeHtml(row.kpiRows?.length || 0)}</td><td>${escapeHtml(row.disputes?.length || 0)}</td><td>${escapeHtml(row.requests?.length || 0)}</td></tr>`))}</article>
    <article class="panel"><h2>سجل التوليد</h2>${table(['الشهر','الحالة','التاريخ','الأعداد'], (data.runs || []).map((run) => `<tr><td>${escapeHtml(run.month)}</td><td>${badge(run.status)}</td><td>${date(run.generatedAt)}</td><td>${escapeHtml(JSON.stringify(run.counts || {}))}</td></tr>`))}</article>
  </section>`, "PDF شهري تلقائي", "تقارير شهرية جاهزة للطباعة والحفظ PDF.");
  app.querySelector('[data-print-monthly]')?.addEventListener('click', () => window.print());
  app.querySelector('[data-regenerate-monthly]')?.addEventListener('click', () => renderMonthlyAutoPdfReports());
}


async function renderWorkflowAutomation() {
  const data = await endpoints.workflowAutomationCenter().then(unwrap);
  const fixes = data.urgentFixes || [];
  shell(`<section class="stack workflow-automation-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>مركز الربط والتشغيل</h2><p>يربط HR، المدير التنفيذي، تطبيق الموظف، المديرين، ولجنة الخلافات ببيانات Supabase الفعلية بدل صفحات ثابتة.</p></div><button class="button primary" data-create-workflow-alerts>إرسال تنبيهات إصلاح</button></div>
      <div class="metric-grid">${metric('مطلوب إصلاحه', data.totals?.urgentFixes || fixes.length, 'مشاكل تشغيلية')}${metric('مديرون مربوطون', data.totals?.managers || 0, 'يرون فريقهم من الموبايل')}${metric('أعضاء لجنة', data.totals?.committee || 0, 'يتابعون الخلافات')}${metric('وقت الفحص', date(data.generatedAt), 'آخر تحديث')}</div>
    </article>
    <article class="panel"><h2>قائمة مطلوب إصلاحه الآن</h2>${table(['المشكلة','الموظف/الطلب','المسار','الإجراء'], fixes.map((item) => `<tr><td><strong>${escapeHtml(item.title || item.code || 'مشكلة')}</strong><br><small>${escapeHtml(item.code || '')}</small></td><td>${escapeHtml(item.employee?.fullName || item.request?.employeeName || item.request?.employeeId || '-')}</td><td>${escapeHtml(item.route || '-')}</td><td><button class="button ghost" data-route="${escapeHtml(item.route || 'quality-center')}">فتح</button></td></tr>`))}</article>
    <article class="panel"><h2>مشاكل ربط الموبايل والصلاحيات</h2>${table(['الموظف','مدير؟','لجنة؟','Push','مشاكل'], (data.alignment?.rows || []).map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employee?.name || row.employee?.id || '-')}</span></td><td>${row.isManager ? badge('YES') : '—'}</td><td>${row.isCommittee ? badge('YES') : '—'}</td><td>${escapeHtml(row.activePush || 0)}</td><td>${(row.issues || []).map((x) => `<span class="tag warning">${escapeHtml(x)}</span>`).join('') || '—'}</td></tr>`))}</article>
  </section>`, 'مركز الربط والتشغيل', 'تشغيل موحد لكل لوحات النظام.');
  app.querySelector('[data-create-workflow-alerts]')?.addEventListener('click', async () => { await endpoints.createWorkflowAutomationAlerts(); setMessage('تم إنشاء تنبيهات الإصلاح وإرسالها قدر الإمكان.', ''); renderWorkflowAutomation(); });
}

async function renderMobileAlignment() {
  const data = await endpoints.mobilePortalAlignment().then(unwrap);
  const rows = data.rows || [];
  shell(`<section class="stack mobile-alignment-page">
    <article class="panel accent-panel"><div class="panel-head"><div><h2>ربط الموبايل والصلاحيات</h2><p>كل الموظفين يدخلون من نفس تطبيق الموظف، وتظهر إضافات المدير أو اللجنة حسب الفريق والدور.</p></div></div>
      <div class="metric-grid">${metric('الموظفون', rows.length, 'تطبيق موحد')}${metric('المديرون', data.managers?.length || 0, 'إضافات داخل الموبايل')}${metric('لجنة الخلافات', data.committee?.length || 0, 'متابعة الشكاوى')}${metric('مشاكل الربط', rows.reduce((sum,row)=>sum+(row.issues?.length||0),0), 'تحتاج تصحيح')}</div>
    </article>
    <article class="panel"><h2>جدول ربط الموظفين</h2>${table(['الموظف','حساب دخول','مدير لفريق','عضو لجنة','Push','الملاحظات'], rows.map((row) => `<tr><td class="person-cell">${avatar(row.employee,'tiny')}<span>${escapeHtml(row.employee?.fullName || row.employee?.name || row.employee?.id || '-')}</span></td><td>${row.user ? badge('OK') : badge('MISSING')}</td><td>${row.isManager ? escapeHtml(row.teamCount || 0) : '—'}</td><td>${row.isCommittee ? badge('YES') : '—'}</td><td>${escapeHtml(row.activePush || 0)}</td><td>${(row.issues || []).map((issue) => `<span class="tag warning">${escapeHtml(issue)}</span>`).join('') || '—'}</td></tr>`))}</article>
  </section>`, 'ربط الموبايل والصلاحيات', 'توحيد الموظفين والمديرين واللجان داخل تطبيق واحد.');
}

async function renderSupabaseSetup() {
  const data = await endpoints.supabaseSetupCheck().then(unwrap);
  shell(`<section class="panel"><div class="panel-head"><div><h2>لوحة إعداد Supabase</h2><p>فحص سريع لمعرفة هل النظام جاهز للحفظ الحقيقي بين كل الأجهزة.</p></div></div>${table(['الفحص','النتيجة','التفاصيل'], (data.checks||[]).map((c)=>`<tr><td>${escapeHtml(c.label)}</td><td>${c.ok ? badge('APPROVED') : badge('PENDING')}</td><td>${escapeHtml(c.detail||'')}</td></tr>`))}<div class="message warning">${escapeHtml(data.recommended || '')}</div></section>`, "إعداد Supabase", "فحص الاتصال والتجهيز.");
}

async function renderDatabaseUpdates() {
  const data = await endpoints.databaseMigrationsStatus().then(unwrap);
  shell(`<section class="panel"><div class="panel-head"><div><h2>تحديثات Database</h2><p>آخر Patch مطلوب: ${escapeHtml(data.expectedPatch)}</p></div></div>${table(['الترتيب','الملف','الحالة','إجراء'], (data.rows||[]).map((row)=>`<tr><td>${escapeHtml(row.order)}</td><td>${escapeHtml(row.name)}</td><td>${badge(row.status)}</td><td><button class="button ghost" data-mark-migration="${escapeHtml(row.name)}">تم تشغيله</button></td></tr>`))}<div class="message warning">${escapeHtml(data.notes||'')}</div></section>`, "تحديثات Database", "متابعة ملفات SQL المطلوبة.");
  app.querySelectorAll('[data-mark-migration]').forEach((button)=>button.addEventListener('click', async ()=>{ await endpoints.markMigrationApplied(button.dataset.markMigration); setMessage('تم تعليم الملف كمطبق محليًا.', ''); renderDatabaseUpdates(); }));
}

async function renderAutoBackup() {
  const data = await endpoints.autoBackupStatus().then(unwrap);
  const backups = data.backups || [];
  shell(`<section class="stack"><article class="panel accent-panel"><div class="panel-head"><div><h2>Backup تلقائي حقيقي</h2><p>في الوضع المحلي يتم حفظ Snapshot داخلي. في Supabase الحقيقي يُنصح بجدولة Edge Function/Storage يوميًا.</p></div><button class="button primary" data-run-auto-backup>تشغيل Backup الآن</button></div><div class="mini-stats"><div><span>الاحتفاظ بآخر</span><strong>${escapeHtml(data.policy?.keepLast||30)}</strong></div><div><span>عدد النسخ</span><strong>${backups.length}</strong></div><div><span>آخر نسخة</span><strong>${escapeHtml(backups[0] ? date(backups[0].createdAt) : '-')}</strong></div></div></article><article class="panel"><h2>سجل النسخ</h2>${table(['العنوان','السبب','الوقت','الأعداد'], backups.map((b)=>`<tr><td>${escapeHtml(b.title)}</td><td>${escapeHtml(b.reason||'-')}</td><td>${date(b.createdAt)}</td><td>${escapeHtml(JSON.stringify(b.counts||{}))}</td></tr>`))}</article></section>`, "Backup تلقائي", "نسخ احتياطي وتشغيل يدوي.");
  app.querySelector('[data-run-auto-backup]')?.addEventListener('click', async ()=>{ await endpoints.runAutomaticBackup({ reason: 'manual-admin' }); setMessage('تم إنشاء Backup بنجاح.', ''); renderAutoBackup(); });
}

async function render() {
  try {
    state.error = "";
    if (!state.user) state.user = await endpoints.me().then(unwrap).catch(() => null);
    if (await enforceGateSessionIdentity("admin")) return;
    if (!state.user && routeKey() !== "login") return renderLogin();
    if (state.user && !isAdminPortalUser(state.user)) return isExecutiveOnlyRole(state.user) ? goExecutivePortal("home") : goEmployeePortal("home");

    const key = routeKey();
    if (!canRoute(key)) {
      return shell(`<section class="panel"><h2>لا توجد صلاحية</h2><p>حسابك لا يملك صلاحية فتح هذه الصفحة. اطلب من مدير النظام تعديل الدور أو الصلاحيات.</p></section>`, "صلاحيات غير كافية", "تم منع الوصول للصفحة المطلوبة.");
    }
    if (key === "dashboard") await renderDashboard();
    else if (key === "executive-report") await renderExecutiveReport();
    else if (key === "executive-mobile") await renderExecutiveMobile();
    else if (key === "presence-map") await renderPresenceMap();
    else if (key === "attendance-risk") await renderAttendanceRisk();
    else if (key === "manager-dashboard") await renderManagerDashboard();
    else if (key === "management-structure") await renderManagementStructure();
    else if (key === "team-dashboard") await renderTeamDashboard();
    else if (key === "hr-operations") await renderHrOperations();
    else if (key === "manager-suite") await renderManagerSuite();
    else if (key === "realtime") await renderRealtime();
    else if (key === "employees") await renderEmployees();
    else if (key === "employee-archive") await renderEmployeeArchive();
    else if (key === "employee-profile") await renderEmployeeProfile();
    else if (key === "users") await renderUsers();
    else if (key === "leave-balances") await renderLeaveBalances();
    else if (key === "documents") await renderDocuments();
    else if (key === "trusted-devices") await renderTrustedDevices();
    else if (key === "employee-punch") await renderEmployeePunch();
    else if (key === "employee-qr") await renderEmployeeQr();
    else if (key === "attendance") await renderAttendance();
    else if (key === "attendance-review") await renderAttendanceReview();
    else if (key === "smart-attendance") await renderSmartAttendance();
    else if (key === "attendance-calendar") await renderAttendanceCalendar();
    else if (key === "missions") await renderMissions();
    else if (key === "leaves") await renderLeaves();
    else if (key === "requests") await renderRequests();
    else if (key === "tasks") await renderTasks();
    else if (key === "locations") await renderLocations();
    else if (key === "disputes") await renderDisputes();
    else if (key === "dispute-workflow") await renderDisputeWorkflow();
    else if (key === "admin-decisions") await renderAdminDecisions();
    else if (key === "roles") await renderRoles();
    else if (key === "permission-matrix") await renderPermissionMatrix();
    else if (key === "password-vault") await renderPasswordVault();
    else if (key === "sensitive-approvals") await renderSensitiveApprovals();
    else if (key === "org-chart") await renderOrgChart();
    else if (key === "reports") await renderReports();
    else if (key === "report-center") await renderReportCenter();
    else if (key === "executive-pdf") await renderExecutivePdfReports();
    else if (key === "monthly-auto-pdf") await renderMonthlyAutoPdfReports();
    else if (key === "monthly-report") await renderMonthlyReport();
    else if (key === "advanced-reports") await renderAdvancedReports();
    else if (key === "control-room") await renderControlRoom();
    else if (key === "smart-alerts") await renderSmartAlerts();
    else if (key === "daily-reports") await renderDailyReports();
    else if (key === "workflow-automation") await renderWorkflowAutomation();
    else if (key === "mobile-alignment") await renderMobileAlignment();
    else if (key === "ai-analytics") await renderAiAnalytics();
    else if (key === "data-center") await renderDataCenter();
    else if (key === "settings") await renderSettings();
    else if (key === "supabase-setup") await renderSupabaseSetup();
    else if (key === "db-updates") await renderDatabaseUpdates();
    else if (key === "auto-backup") await renderAutoBackup();
    else if (key === "complex-settings") await renderComplexSettings();
    else if (key === "system-diagnostics") await renderSystemDiagnostics();
    else if (key === "quality-center") await renderQualityCenter();
    else if (key === "policies") await renderPolicies();
    else if (key === "route-access") await renderRouteAccess();
    else if (key === "integrations") await renderIntegrations();
    else if (key === "access-control") await renderAccessControl();
    else if (key === "offline-sync") await renderOfflineSync();
    else if (key === "health") await renderHealth();
    else if (key === "backup") await renderBackup();
    else if (key === "audit") await renderAudit();
    else if (key === "security-log") await renderSecurityLog();
    else if (key === "kpi") await renderKpi();
    else if (key === "kpi-month-center") await renderKpiMonthCenter();
    else if (key === "kpi-executive-report") await renderKpiExecutiveReport();
    else if (key === "kpi-cycle-lock") await renderKpiCycleLock();
    else if (key === "monthly-evaluations") await renderMonthlyEvaluations();
    else if (key === "notifications") await renderNotifications();
    else await renderDashboard();
  } catch (error) {
    debugError(error);
    setMessage("", error.message);
    shell(`<section class="panel"><h2>تعذر تحميل الصفحة</h2><p>${escapeHtml(error.message)}</p></section>`, "خطأ", "راجع البيانات أو أعد تحميل الصفحة.");
  }
}

/* ── v101: Admin keyboard shortcuts ── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  const alt = e.altKey;
  const shortcuts = {
    'd': 'dashboard', 'e': 'employees', 'a': 'attendance',
    'r': 'reports',   'n': 'notifications', 's': 'settings',
    'u': 'users',     'l': 'locations',     'k': 'kpi',
  };
  if (alt && shortcuts[e.key]) {
    e.preventDefault();
    location.hash = shortcuts[e.key];
  }
  // Alt+/ → focus sidebar search
  if (alt && e.key === '/') {
    e.preventDefault();
    document.getElementById('sidebar-search-input')?.focus();
  }
  // Escape → close modals/sheets
  if (e.key === 'Escape') {
    document.querySelector('.modal-close')?.click();
    document.querySelector('.sheet-close')?.click();
  }
});

/* ── v101: Sidebar search ── */
(function initSidebarSearch() {
  const sidebar = document.querySelector('.sidebar-nav') || document.querySelector('nav.sidebar') || document.querySelector('.sidebar');
  if (!sidebar) return;
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-search';
  wrap.innerHTML = '<span class="search-icon">🔍</span><input id="sidebar-search-input" type="search" placeholder="ابحث في القائمة... (Alt+/)" autocomplete="off" />';
  sidebar.insertBefore(wrap, sidebar.firstChild);
  const input = wrap.querySelector('input');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    sidebar.querySelectorAll('.nav-link').forEach(link => {
      const text = link.textContent.toLowerCase();
      link.closest('li')
        ? (link.closest('li').style.display = (!q || text.includes(q)) ? '' : 'none')
        : (link.style.display = (!q || text.includes(q)) ? '' : 'none');
    });
    sidebar.querySelectorAll('.nav-section-label').forEach(label => {
      const section = label.nextElementSibling;
      const visible = section?.querySelectorAll('.nav-link:not([style*="none"])').length > 0;
      label.style.display = (visible || !q) ? '' : 'none';
    });
  });
})();

/* ── v101: Ripple effect ── */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.button');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${((e.clientX - rect.left) / rect.width * 100).toFixed(1)}%`);
  btn.style.setProperty('--y', `${((e.clientY - rect.top) / rect.height * 100).toFixed(1)}%`);
}, { passive: true });

/* ── v101: Count-up animation ── */
function countUp(el, target, duration = 1000) {
  const from = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
  const to = parseFloat(String(target).replace(/[^0-9.]/g, '')) || 0;
  const isFloat = String(target).includes('.');
  const start = performance.now();
  const step = (ts) => {
    const p = Math.min((ts - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = from + (to - from) * eased;
    el.textContent = isFloat ? val.toFixed(1) : Math.round(val).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(step);
    else { el.classList.add('counting'); setTimeout(() => el.classList.remove('counting'), 300); }
  };
  requestAnimationFrame(step);
}
const countObsAdmin = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target;
    if (el.dataset.count !== undefined) { countUp(el, el.dataset.count); countObsAdmin.unobserve(el); }
  });
}, { threshold: 0.3 });
const appAdminEl = document.getElementById('app') || document.body;
new MutationObserver(() => {
  appAdminEl.querySelectorAll('[data-count]:not([data-counted])').forEach(el => {
    el.dataset.counted = '1'; countObsAdmin.observe(el);
  });
}).observe(appAdminEl, { childList: true, subtree: true });

/* ── v101: Scroll-to-top ── */
(function() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top';
  btn.innerHTML = '↑';
  btn.setAttribute('aria-label', 'العودة للأعلى');
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 300), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

/* ── v101: Table data-label auto-set ── */
new MutationObserver(() => {
  document.querySelectorAll('table.data-table').forEach(t => {
    const headers = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.querySelectorAll('td')].forEach((td, i) => {
        if (!td.dataset.label && headers[i]) td.dataset.label = headers[i];
      });
    });
  });
}).observe(document.body, { childList: true, subtree: true });


/* ── v111: Offline Queue Replay ─────────────────────────────────────────────
 * The Service Worker sends SYNC_OFFLINE_QUEUE via Background Sync when the
 * device reconnects.  Without this listener admin actions queued offline
 * (approvals, KPI updates, etc.) would be permanently stuck.
 *
 * A plain window 'online' event acts as a direct fallback for browsers that
 * do not implement the Background Sync API (Firefox, Safari < 17.4).
 * ─────────────────────────────────────────────────────────────────────────── */
(function attachOfflineQueueSyncAdmin() {
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

/* ── v103: Admin Mobile Bottom Nav ── */
(function initAdminMobileNav() {
  if (window.__HR_ADMIN_MOBILE_NAV__) return;
  window.__HR_ADMIN_MOBILE_NAV__ = true;

  const nav = document.createElement('nav');
  nav.className = 'admin-mobile-nav';
  nav.setAttribute('aria-label', 'تنقل الإدارة');

  const items = [
    ['dashboard',  '🏠', 'الرئيسية'],
    ['employees',  '👥', 'الموظفون'],
    ['attendance', '📊', 'الحضور'],
    ['requests',   '📋', 'الطلبات'],
    ['notifications','🔔', 'الإشعارات'],
  ];

  const setActive = (hash) => {
    nav.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.route === hash);
    });
  };

  nav.innerHTML = items.map(([route, icon, label]) => `
    <button type="button" data-route="${route}" aria-label="${label}">
      <span class="mob-icon">${icon}</span>
      <span>${label}</span>
    </button>
  `).join('');

  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      location.hash = btn.dataset.route;
      setActive(btn.dataset.route);
    });
  });

  document.body.appendChild(nav);

  /* Sync with hash changes */
  window.addEventListener('hashchange', () => {
    setActive(location.hash.replace('#', ''));
  });
  setActive(location.hash.replace('#', '') || 'dashboard');
})();
