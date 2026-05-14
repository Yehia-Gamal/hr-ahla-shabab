import { seedDatabase } from "./database.js?v=v47-smart-entry-gateway";
import { supabaseEndpoints, shouldUseSupabase, supabaseModeIsStrict } from "./supabase-api.js?v=v47-smart-entry-gateway";

const debugEnabled = () => Boolean(globalThis.HR_DEBUG_LOGS || globalThis.HR_SUPABASE_CONFIG?.debug === true);
const debugWarn = (...args) => { if (debugEnabled()) globalThis.console?.warn?.(...args); };
const debugError = (...args) => { if (debugEnabled()) globalThis.console?.error?.(...args); };
const debugInfo = (...args) => { if (debugEnabled()) globalThis.console?.info?.(...args); };
const STORAGE_KEY = "hr-attendance.local-db.v19-management-suite";
const LEGACY_KEYS = ["hr-attendance.local-db.v14", "hr-attendance.local-db.v13", "hr-attendance.local-db.v12", "hr-attendance.local-db.v11", "hr-attendance.local-db.v10", "hr-attendance.local-db.v9", "hr-attendance.local-db.v8", "hr-attendance.local-db.v7", "hr-attendance.local-db.v6", "hr-attendance.local-db.v5", "hr-attendance.local-db.v4", "hr-attendance.local-db.v3"];
const SESSION_KEY = "hr-attendance.session-user";
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const DEFAULT_COMPLEX = {
  name: "مجمع منيل شيحة",
  address: "شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912",
  latitude: 29.950738592862045,
  longitude: 31.238094542328678,
  radiusMeters: 180,
  maxAccuracyMeters: 90,
};
const KPI_POLICY_DEFAULTS = {
  evaluationStartDay: 20,
  evaluationEndDay: 25,
  submissionDeadlineDay: 25,
  meetingRequired: true,
  totalScore: 100,
};

function makeId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

function now() {
  return new Date().toISOString();
}

function assertEmployeePunchButtonIntent(body = {}) {
  const action = String(body.eventType || body.type || body.action || "").toLowerCase();
  const expectedType = ["out", "checkout", "check_out", "انصراف"].includes(action) ? "out" : "in";
  const age = Date.now() - Number(body.punchIntentAt || 0);
  if (
    body.punchIntent !== "employee_punch_button"
    || body.punchIntentType !== expectedType
    || !body.punchIntentNonce
    || age < 0
    || age > 90 * 1000
  ) {
    throw new Error("تم رفض تسجيل الحضور: يجب الضغط على زر البصمة مباشرة من شاشة الموظف.");
  }
}

function assertEmployeePunchPasskey(body = {}) {
  const hasPasskey = Boolean(body.passkeyCredentialId || body.credentialId);
  const method = String(body.biometricMethod || "").toLowerCase();
  const identity = body.identityCheck || {};
  const hasVerifiedFallback = identity.passkeyFallbackAccepted === true
    && identity.faceSelfieCaptured === true
    && Boolean(body.deviceFingerprintHash)
    && Number.isFinite(Number(body.latitude))
    && Number.isFinite(Number(body.longitude));
  if ((!hasPasskey || !method.includes("passkey") || identity.passkeyVerified !== true) && !hasVerifiedFallback) {
    throw new Error("تم رفض تسجيل الحضور/الانصراف: يلزم تأكيد بصمة الهاتف أو Passkey قبل الحفظ.");
  }
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(value || "")
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/\s+/g, "")
    .trim();
}

function makeStrongPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const symbols = "!@#$%*?";
  const bytes = new Uint8Array(14);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = Array.from(bytes, (byte, index) => index === 4 ? symbols[byte % symbols.length] : alphabet[byte % alphabet.length]).join("");
  return `Ahla@${random}9`;
}

function inferEmail(db, body = {}, employee = null) {
  const direct = normalizeEmail(body.email || employee?.email || "");
  if (direct) return direct;
  const phone = normalizePhone(body.phone || employee?.phone || "");
  if (phone) return `emp.${phone}@ahla-shabab.local`;
  let email = `employee.${Date.now().toString(36)}@ahla-shabab.local`;
  let i = 1;
  while ((db.users || []).some((u) => normalizeEmail(u.email) === email)) email = `employee.${Date.now().toString(36)}.${i++}@ahla-shabab.local`;
  return email;
}

function findById(items = [], id) {
  return items.find((item) => item.id === id) || null;
}

function normalizeDb(db) {
  const base = clone(seedDatabase);
  if (db?.meta?.orgProfile !== "ahla-shabab-manil-shiha-v2") db = {};
  const merged = { ...base, ...db };
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key])) merged[key] = Array.isArray(merged[key]) ? merged[key] : clone(base[key]);
  }
  for (const key of ["employees", "users"]) {
    for (const seedItem of base[key] || []) {
      const exists = (merged[key] || []).some((item) => item.id === seedItem.id || (seedItem.phone && item.phone === seedItem.phone) || (seedItem.email && item.email === seedItem.email));
      if (!exists) merged[key].push(clone(seedItem));
    }
  }
  for (const seedUser of base.users || []) {
    const user = (merged.users || []).find((item) => item.id === seedUser.id || (seedUser.phone && item.phone === seedUser.phone) || (seedUser.email && item.email === seedUser.email));
    if (!user) continue;
    if (String(seedUser.id || "").startsWith("u-xlsx-")) {
      user.password = seedUser.password;
      user.status = "ACTIVE";
      user.failedLogins = 0;
      user.temporaryPassword = true;
      user.mustChangePassword = true;
      if (seedUser.email && (!user.email || user.email.startsWith("emp."))) user.email = seedUser.email;
      if (seedUser.phone) user.phone = seedUser.phone;
    }
  }
  for (const seedEmployee of base.employees || []) {
    const employee = (merged.employees || []).find((item) => item.id === seedEmployee.id || (seedEmployee.phone && item.phone === seedEmployee.phone) || (seedEmployee.email && item.email === seedEmployee.email));
    if (!employee) continue;
    if (String(seedEmployee.id || "").startsWith("emp-xlsx-")) {
      employee.status = "ACTIVE";
      employee.isDeleted = false;
      if (seedEmployee.email && (!employee.email || employee.email.startsWith("emp."))) employee.email = seedEmployee.email;
      if (seedEmployee.phone) employee.phone = seedEmployee.phone;
      if (seedEmployee.userId) employee.userId = seedEmployee.userId;
    }
  }
  merged.meta = { ...(base.meta || {}), ...(merged.meta || {}), normalizedAt: now() };
  merged.permissions ||= clone(base.permissions);
  if (!merged.permissions.some((permission) => permission.scope === "attendance:self")) merged.permissions.push({ id: "perm-attendance-self", scope: "attendance:self", name: "تسجيل بصمة الموظف" });
  if (!merged.permissions.some((permission) => permission.scope === "kpi:self")) merged.permissions.push({ id: "perm-kpi-self", scope: "kpi:self", name: "تقييم ذاتي للموظف" });
  if (!merged.permissions.some((permission) => permission.scope === "kpi:team")) merged.permissions.push({ id: "perm-kpi-team", scope: "kpi:team", name: "اعتماد تقييمات الفريق المباشر" });
  for (const [scope, name] of [
  ["realtime:view", "عرض اللوحة اللحظية"],
  ["integrations:manage", "إدارة التكاملات"],
  ["ai:view", "تحليلات الذكاء الاصطناعي"],
  ["access_control:manage", "تكامل أجهزة البوابات"],
  ["offline:manage", "مزامنة Offline"],
  ["attendance:review", "مراجعة البصمات المرفوضة"],
  ["devices:manage", "إدارة الأجهزة المعتمدة"],
  ["security:view", "عرض سجل الأمان"],
  ["tasks:manage", "إدارة المهام الداخلية"],
  ["documents:manage", "إدارة مستندات الموظفين"],
  ["leave:balance", "إدارة أرصدة الإجازات"],
  ["announcements:manage", "إدارة الإعلانات والقراءة"],
  ["executive:report", "التقرير التنفيذي المختصر"],
  ["permissions:matrix", "إدارة مصفوفة الصلاحيات"],
  ["maintenance:run", "تشغيل مركز الجودة والإصلاح"],
  ["workflow:manage", "إدارة الأتمتة والتصعيد"],
  ["policies:manage", "إدارة السياسات والتوقيعات"],
  ["policies:self", "قراءة وتوقيع السياسات"],
  ["sla:view", "متابعة اتفاقيات مستوى الخدمة"],
  ["control-room:view", "غرفة التحكم والتنبيهات الذكية"],
  ["data-center:manage", "إدارة مركز البيانات والاستيراد"],
  ["daily-report:self", "إرسال التقرير اليومي"],
  ["daily-report:review", "مراجعة التقارير اليومية"],
  ["executive:mobile", "المتابعة التنفيذية من الموبايل"],
  ["live-location:request", "طلب الموقع المباشر"],
  ["live-location:respond", "الرد على طلب الموقع المباشر"],
  ["admin-gateway:access", "الدخول من بوابة التشغيل"],
  ["sensitive-actions:approve", "اعتماد العمليات الحساسة"],
  ["sensitive-actions:request", "طلب تنفيذ عملية حساسة"],
  ["executive:presence-map", "عرض خريطة الحضور التنفيذية"],
  ["attendance:risk", "مركز تقييم خطر البصمة"],
  ["decisions:manage", "إدارة سجل القرارات الإدارية"],
  ["decisions:acknowledge", "تأكيد الاطلاع على القرارات"],
  ["disputes:minutes", "محاضر لجنة حل الخلافات"],
  ["reports:monthly-pdf-auto", "تقارير PDF شهرية تلقائية"],
  ["manager:team-only", "قصر المدير على فريقه فقط"],
  ["approvals:manage", "إدارة الاعتمادات الحساسة"],
  ["alerts:manage", "إدارة التنبيهات الذكية"],
  ["attendance:rules", "إدارة قواعد الحضور الذكية"],
  ["attendance:smart", "تشغيل تحليل الحضور الذكي"],
  ["employee:archive", "عرض أرشيف الموظف الكامل"],
  ["manager:suite", "لوحة المدير المباشر المتقدمة"],
  ["kpi:monthly", "إدارة التقييم الشهري"],
  ["supabase:diagnostics", "فحص إعداد Supabase"],
  ["database:migrations", "متابعة تحديثات قاعدة البيانات"],
  ["backup:auto", "إدارة النسخ الاحتياطي التلقائي"],
  ["action-center:self", "صفحة مطلوب مني الآن للموظف"],
  ["hr:operations", "لوحة عمليات الموارد البشرية"],
  ["organization:manage", "إدارة هيكل الإدارة والفرق"],
  ["team:dashboard", "لوحة الفريق للمدير المباشر"],
  ["disputes:escalate", "تصعيد الشكاوى للسكرتير والتنفيذي"],
  ["reports:pdf", "تصدير تقارير PDF/HTML"],
  ["reports:excel", "تصدير تقارير Excel/CSV"],
  ]) {
    if (!merged.permissions.some((permission) => permission.scope === scope)) merged.permissions.push({ id: `perm-${scope.replace(/[^a-z0-9]+/gi, "-")}`, scope, name });
  }
  const employeeRole = merged.roles.find((role) => role.slug === "employee" || role.key === "EMPLOYEE");
  if (employeeRole) employeeRole.permissions ||= [];
  if (employeeRole && !employeeRole.permissions.includes("attendance:self")) employeeRole.permissions.push("attendance:self");
  if (employeeRole && !employeeRole.permissions.includes("kpi:self")) employeeRole.permissions.push("kpi:self");
  if (employeeRole && !employeeRole.permissions.includes("disputes:create")) employeeRole.permissions.push("disputes:create");
  if (employeeRole && !employeeRole.permissions.includes("location:self")) employeeRole.permissions.push("location:self");
  if (employeeRole && !employeeRole.permissions.includes("tasks:self")) employeeRole.permissions.push("tasks:self");
  if (employeeRole && !employeeRole.permissions.includes("documents:self")) employeeRole.permissions.push("documents:self");
  if (employeeRole && !employeeRole.permissions.includes("requests:self")) employeeRole.permissions.push("requests:self");
  if (employeeRole && !employeeRole.permissions.includes("daily-report:self")) employeeRole.permissions.push("daily-report:self");
  const rolePermissionProfiles = {
    admin: ["*"],
    "executive-secretary": ["*"],
    "hr-manager": [
      "dashboard:view", "employees:view", "employees:write", "users:manage",
      "attendance:manage", "attendance:review", "attendance:rules", "attendance:smart",
      "requests:approve", "leave:balance", "documents:manage", "reports:export",
      "kpi:hr", "kpi:monthly", "kpi:manage", "daily-report:review",
      "disputes:committee", "disputes:manage", "disputes:escalate", "disputes:minutes", "notifications:manage", "decisions:manage", "attendance:risk", "policies:self", "hr:operations", "team:dashboard", "reports:pdf", "reports:excel", "reports:monthly-pdf-auto"
    ],
    executive: [
      "dashboard:view", "employees:view", "reports:export", "executive:report",
      "executive:mobile", "executive:presence-map", "live-location:request",
      "sensitive-actions:approve", "approvals:manage", "alerts:manage", "attendance:risk", "decisions:manage",
      "control-room:view", "daily-report:review", "kpi:executive", "kpi:final-approve", "reports:pdf", "reports:excel", "reports:monthly-pdf-auto", "disputes:escalate", "disputes:minutes"
    ],
    "direct-manager": [
      "dashboard:view", "employees:view", "manager:team", "manager:suite",
      "attendance:manage", "requests:approve", "reports:export", "kpi:team",
      "daily-report:review", "disputes:manage", "disputes:escalate", "realtime:view", "team:dashboard", "reports:pdf", "reports:excel", "manager:team-only", "decisions:acknowledge"
    ],
    employee: [
      "dashboard:view", "attendance:self", "kpi:self", "disputes:create",
      "location:self", "tasks:self", "documents:self", "requests:self",
      "daily-report:self", "action-center:self", "live-location:respond", "policies:self", "decisions:acknowledge"
    ],
  };
  for (const role of merged.roles || []) {
    const slug = String(role.slug || role.key || role.id || "").toLowerCase();
    if (["role-admin", "admin"].includes(role.id) || slug === "admin") role.permissions = rolePermissionProfiles.admin;
    else if (["role-hr"].includes(role.id) || slug === "hr-manager") role.permissions = rolePermissionProfiles["hr-manager"];
    else if (["role-executive"].includes(role.id) || slug === "executive") role.permissions = rolePermissionProfiles.executive;
    else if (["role-executive-secretary"].includes(role.id) || slug === "executive-secretary") role.permissions = rolePermissionProfiles["executive-secretary"];
    else if (["role-manager"].includes(role.id) || slug === "direct-manager") role.permissions = rolePermissionProfiles["direct-manager"];
    else if (["role-employee"].includes(role.id) || slug === "employee") role.permissions = rolePermissionProfiles.employee;
  }
  if (!findById(merged.employees || [], "emp-hr-manager")) {
    merged.employees.push({
      id: "emp-hr-manager", employeeCode: "EMP-HR", fullName: "مدير الموارد البشرية", phone: "PHONE_PLACEHOLDER_044",
      email: "hr.manager@organization.local", photoUrl: "", jobTitle: "مدير الموارد البشرية", roleId: "role-hr",
      branchId: "b-ahla-manil", departmentId: "d-hr", governorateId: "gov-giza", complexId: "cx-ahla-manil",
      managerEmployeeId: "emp-executive-secretary", status: "ACTIVE", isDeleted: false, hireDate: "2021-01-01", userId: "u-hr-manager"
    });
  }
  if (!findById(merged.users || [], "u-hr-manager")) {
    merged.users.push({
      id: "u-hr-manager", name: "مدير الموارد البشرية", fullName: "مدير الموارد البشرية", email: "hr.manager@organization.local",
      phone: "PHONE_PLACEHOLDER_044", password: "LocalLoginDisabled#RotateInSupabase2026!", roleId: "role-hr", employeeId: "emp-hr-manager",
      branchId: "b-ahla-manil", departmentId: "d-hr", governorateId: "gov-giza", complexId: "cx-ahla-manil",
      status: "ACTIVE", temporaryPassword: true, mustChangePassword: true, passkeyEnabled: false, failedLogins: 0, lastLoginAt: ""
    });
  }
  merged.disputeCommittee = {
    ...(merged.disputeCommittee || {}),
    members: ["السكرتير التنفيذي", "مدير تشغيل 1", "مدير تشغيل 2", "مدير الموارد البشرية"],
    employeeIds: ["emp-executive-secretary", "emp-direct-manager-01", "emp-direct-manager-02", "emp-hr-manager"],
    executiveEscalationTo: "المدير التنفيذي",
    executiveSecretaryEmployeeId: "emp-executive-secretary",
    mandate: "يتم استقبال الشكاوى داخل لجنة حل المشاكل والخلافات، ثم التنسيق أو التصعيد للمدير التنفيذي عن طريق السكرتير التنفيذي.",
  };
  merged.auditLogs ||= [];
  merged.attendanceDaily ||= [];
  merged.locationRequests ||= [];
  merged.attachments ||= [];
  merged.shiftAssignments ||= [];
  merged.kpiPolicy ||= clone(base.kpiPolicy || {});
  merged.kpiCycles ||= clone(base.kpiCycles || []);
  merged.kpiCriteria ||= clone(base.kpiCriteria || []);
  merged.kpiEvaluations ||= clone(base.kpiEvaluations || []);
  merged.kpiSummaries ||= [];
  merged.disputeCommittee ||= clone(base.disputeCommittee || {});
  merged.disputeCases ||= clone(base.disputeCases || []);
  merged.integrationSettings ||= clone(base.integrationSettings || []);
  merged.passkeyCredentials ||= clone(base.passkeyCredentials || []);
  merged.pushSubscriptions ||= clone(base.pushSubscriptions || []);
  merged.offlineQueue ||= clone(base.offlineQueue || []);
  merged.reportSchedules ||= clone(base.reportSchedules || []);
  merged.systemBackups ||= clone(base.systemBackups || []);
  merged.employeeAnnouncements ||= clone(base.employeeAnnouncements || []);
  merged.accessControlEvents ||= clone(base.accessControlEvents || []);
  merged.credentialVault ||= clone(base.credentialVault || []);
  merged.savedSnapshots ||= clone(base.savedSnapshots || []);
  merged.tasks ||= clone(base.tasks || []);
  merged.employeeDocuments ||= clone(base.employeeDocuments || []);
  merged.leaveBalances ||= clone(base.leaveBalances || []);
  merged.announcementReads ||= clone(base.announcementReads || []);
  merged.policyAcknowledgements ||= clone(base.policyAcknowledgements || []);
  merged.workflowEscalations ||= clone(base.workflowEscalations || []);
  merged.attendanceAlerts ||= clone(base.attendanceAlerts || []);
  merged.dailyReports ||= clone(base.dailyReports || []);
  merged.smartAlerts ||= clone(base.smartAlerts || []);
  merged.importBatches ||= clone(base.importBatches || []);
  merged.approvalChains ||= clone(base.approvalChains || []);
  merged.systemRunbooks ||= clone(base.systemRunbooks || []);
  merged.liveLocationRequests ||= clone(base.liveLocationRequests || []);
  merged.liveLocationResponses ||= clone(base.liveLocationResponses || []);
  merged.adminAccessLogs ||= clone(base.adminAccessLogs || []);
  merged.executiveViews ||= clone(base.executiveViews || []);
  merged.sensitiveApprovals ||= clone(base.sensitiveApprovals || []);
  merged.executivePresenceSnapshots ||= clone(base.executivePresenceSnapshots || []);
  merged.employeePolicies ||= clone(base.employeePolicies || [
    { id: "pol-attendance", title: "سياسة الحضور والانصراف", category: "ATTENDANCE", version: "1.0", body: "الالتزام بتسجيل الحضور والانصراف من الموقع المعتمد، وأي بصمة خارج النطاق تحتاج مراجعة الإدارة.", requiresAcknowledgement: true, status: "ACTIVE", createdAt: "2026-04-29T00:00:00.000Z" },
    { id: "pol-disputes", title: "سياسة لجنة حل المشاكل والخلافات", category: "DISPUTES", version: "1.0", body: "تُرفع الشكاوى إلى اللجنة المختصة، ويتم التنسيق أو التصعيد للمدير التنفيذي عبر السكرتير التنفيذي عند الحاجة.", requiresAcknowledgement: true, status: "ACTIVE", createdAt: "2026-04-29T00:00:00.000Z" },
    { id: "pol-data", title: "سياسة حماية البيانات وكلمات المرور", category: "SECURITY", version: "1.0", body: "كلمات المرور المؤقتة لا تُشارك إلا مع صاحب الحساب، ويجب تغييرها بعد أول دخول. لا يتم تداول بيانات الموظفين خارج النظام.", requiresAcknowledgement: true, status: "ACTIVE", createdAt: "2026-04-29T00:00:00.000Z" },
  ]);
  merged.maintenanceRuns ||= clone(base.maintenanceRuns || []);
  merged.committeeActions ||= clone(base.committeeActions || []);
  merged.systemSettings ||= clone(base.systemSettings || {
    attendanceRules: {
      shiftStart: "10:00",
      absentAfter: "11:00",
      earlyExitBefore: "17:00",
      shiftEnd: "18:00",
      duplicateWindowMinutes: 10,
      endOfDayReportAt: "19:00",
      notifyManagerOnAbsence: true,
      requireReviewOutsideGeofence: true,
      requireReviewDuplicatePunch: true,
      requireReviewMissingCheckout: true,
    },
    backupPolicy: { enabled: true, keepLast: 30, dailyAt: "20:00", includeAudit: true },
    supabaseExpectedPatch: "032b_pre_publish_role_portal_consistency.sql",
  });
  merged.attendanceRuleRuns ||= clone(base.attendanceRuleRuns || []);
  merged.endOfDayReports ||= clone(base.endOfDayReports || []);
  merged.autoBackupRuns ||= clone(base.autoBackupRuns || []);
  merged.migrationStatus ||= clone(base.migrationStatus || []);
  return merged;
}

function loadDb() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        raw = legacy;
        break;
      }
    }
  }
  if (!raw) {
    const db = normalizeDb(seedDatabase);
    saveDb(db);
    return db;
  }
  try {
    const db = normalizeDb(JSON.parse(raw));
    saveDb(db);
    return db;
  } catch {
    const db = normalizeDb(seedDatabase);
    saveDb(db);
    return db;
  }
}

function saveDb(db) {
  db.meta = { ...(db.meta || {}), updatedAt: now(), version: 14, orgProfile: "ahla-shabab-manil-shiha-v2" };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    const isQuota = error?.name === "QuotaExceededError" || String(error?.message || "").toLowerCase().includes("quota");
    if (isQuota) throw new Error("تعذر الحفظ لأن مساحة التخزين المحلية امتلأت. قلّل حجم الصور أو استخدم نسخة Supabase/الخادم للحفظ الدائم.");
    throw error;
  }
}

async function ok(value) {
  return clone(value);
}

export function unwrap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload?.data != null) return payload.data;
  return payload;
}

function currentUser(db = loadDb()) {
  const userId = sessionStorage.getItem(SESSION_KEY);
  const user = findById(db.users, userId);
  return user ? enrichUser(db, user) : null;
}

function audit(db, action, entityType, entityId, beforeData, afterData, meta = {}) {
  const actor = currentUser(db);
  db.auditLogs.unshift({
    id: makeId("audit"),
    action,
    entityType,
    entityId: entityId || "",
    actor: actor?.name || actor?.fullName || actor?.email || "System",
    actorUserId: actor?.id || "",
    beforeData: beforeData ? clone(beforeData) : null,
    afterData: afterData ? clone(afterData) : null,
    metadata: meta,
    createdAt: now(),
  });
  db.auditLogs = db.auditLogs.slice(0, 1500);
}

function notify(db, title, body = "", type = "INFO") {
  db.notifications.unshift({
    id: makeId("not"),
    title,
    body,
    status: "UNREAD",
    isRead: false,
    type,
    createdAt: now(),
  });
}

function notifyEmployee(db, employeeId, title, body = "", type = "INFO", extra = {}) {
  if (!employeeId) return;
  const employee = findById(db.employees, employeeId);
  const user = (db.users || []).find((item) => item.employeeId === employeeId) || findById(db.users, employee?.userId);
  db.notifications.unshift({
    id: makeId("not"),
    userId: user?.id || "",
    employeeId,
    title,
    body,
    status: "UNREAD",
    isRead: false,
    type,
    route: extra.route || "",
    data: extra.data || {},
    createdAt: now(),
  });
}

function notifyManyEmployees(db, employeeIds = [], title, body = "", type = "INFO") {
  [...new Set(employeeIds.filter(Boolean))].forEach((employeeId) => notifyEmployee(db, employeeId, title, body, type));
}

function disputeCommitteeEmployeeIds(db) {
  const configured = db.disputeCommittee?.employeeIds;
  if (Array.isArray(configured) && configured.length) return configured.filter(Boolean);
  return ["emp-executive-secretary", "emp-direct-manager-01", "emp-direct-manager-02", "emp-hr-manager"].filter((id) => findById(db.employees, id));
}

function isTechnicalAdmin(user) {
  const role = roleSlugOf(user);
  const permissions = permissionsOf(user);
  return ["role-admin", "admin", "super-admin", "super_admin", "role-executive-secretary", "executive-secretary"].includes(role)
    || permissions.has("*")
    || (permissions.has("settings:manage") && permissions.has("users:manage"));
}

function enrichEmployee(db, employee) {
  if (!employee) return null;
  const user = db.users.find((item) => item.employeeId === employee.id) || findById(db.users, employee.userId);
  return {
    ...employee,
    role: findById(db.roles, employee.roleId),
    branch: findById(db.branches, employee.branchId),
    department: findById(db.departments, employee.departmentId),
    governorate: findById(db.governorates, employee.governorateId),
    complex: findById(db.complexes, employee.complexId),
    manager: findById(db.employees, employee.managerEmployeeId),
    user: user || null,
  };
}

function enrichUser(db, user) {
  if (!user) return null;
  const employee = findById(db.employees, user.employeeId);
  const role = findById(db.roles, user.roleId);
  return {
    ...user,
    fullName: user.name || user.fullName,
    avatarUrl: user.avatarUrl || user.photoUrl || employee?.photoUrl || "",
    photoUrl: user.photoUrl || user.avatarUrl || employee?.photoUrl || "",
    employee: employee ? enrichEmployee(db, employee) : null,
    role,
    permissions: role?.permissions || [],
    branch: findById(db.branches, user.branchId || employee?.branchId),
    department: findById(db.departments, user.departmentId || employee?.departmentId),
    governorate: findById(db.governorates, user.governorateId || employee?.governorateId),
    complex: findById(db.complexes, user.complexId || employee?.complexId),
  };
}

function enrichByEmployee(db, item) {
  const employee = findById(db.employees, item.employeeId);
  return { ...item, employee: employee ? enrichEmployee(db, employee) : null };
}

function visibleEmployees(db) {
  const ids = scopedEmployeeIds(db);
  return db.employees.filter((employee) => !employee.isDeleted && ids.has(employee.id)).map((employee) => enrichEmployee(db, employee));
}

function activeItems(db, key) {
  return (db[key] || []).filter((item) => item.active !== false && !item.isDeleted);
}

function permissionsOf(user) {
  return new Set(user?.permissions || []);
}

function roleSlugOf(user) {
  return String(user?.role?.slug || user?.role?.key || user?.roleId || "").toLowerCase();
}

function isLegacyExecutiveRole(user) {
  return ["role-executive", "executive"].includes(roleSlugOf(user));
}

function hasLocalScope(db, scope) {
  const user = currentUser(db);
  const permissions = permissionsOf(user);
  const role = roleSlugOf(user);
  const fullAccessRole = ["role-admin", "admin", "role-executive-secretary", "executive-secretary"].includes(role);
  if (scope === "*" && isLegacyExecutiveRole(user)) return false;
  return (permissions.has("*") && !isLegacyExecutiveRole(user)) || permissions.has(scope) || fullAccessRole;
}

function isFullAccessUser(db) {
  return hasLocalScope(db, "*");
}

function scopedEmployeeIds(db, { includeTeam = true } = {}) {
  if (isFullAccessUser(db) || hasLocalScope(db, "kpi:hr") || hasLocalScope(db, "hr:attendance") || hasLocalScope(db, "executive:mobile") || hasLocalScope(db, "executive:presence-map")) return new Set((db.employees || []).filter((e) => !e.isDeleted).map((e) => e.id));
  const user = currentUser(db);
  const ids = new Set();
  if (user?.employeeId) ids.add(user.employeeId);
  if (includeTeam && user?.employeeId && hasLocalScope(db, "kpi:team")) {
    const queue = [user.employeeId];
    const seen = new Set(queue);
    while (queue.length) {
      const managerId = queue.shift();
      for (const employee of db.employees || []) {
        if (employee.isDeleted || employee.managerEmployeeId !== managerId || seen.has(employee.id)) continue;
        ids.add(employee.id);
        seen.add(employee.id);
        queue.push(employee.id);
      }
    }
  }
  return ids;
}

function canSeeEmployee(db, employeeId) {
  return scopedEmployeeIds(db).has(employeeId);
}

function scopedRowsByEmployee(db, rows = []) {
  const ids = scopedEmployeeIds(db);
  return rows.filter((row) => !row.employeeId || ids.has(row.employeeId));
}

function normalizedRequestStatus(value = "") {
  return String(value || "").trim().toUpperCase();
}

function isPendingRequestStatus(value = "") {
  return [
    "PENDING",
    "PENDING_MANAGER_REVIEW",
    "MANAGER_REVIEW",
    "SUBMITTED",
    "IN_REVIEW",
    "PENDING_HR_REVIEW",
  ].includes(normalizedRequestStatus(value));
}

function isApprovedRequestStatus(value = "") {
  return ["APPROVED", "COMPLETED", "PENDING_HR_REVIEW", "HR_REVIEWED"].includes(normalizedRequestStatus(value));
}

function isRejectedRequestStatus(value = "") {
  return ["REJECTED", "REJECTED_CONFIRMED", "CANCELLED"].includes(normalizedRequestStatus(value));
}

function distanceMeters(a, b) {
  if (![a?.latitude, a?.longitude, b?.latitude, b?.longitude].every((value) => Number.isFinite(Number(value)))) return null;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(h)));
}

function statusFromTime(db, employee, when = new Date()) {
  // لا نعتمد على جدول دوام منفصل. وقت الدوام الرسمي للمتابعة فقط: 10:00 صباحًا إلى 6:00 مساءً، ولا يمنع البصمة قبل/بعد الوقت طالما داخل المجمع.
  const start = new Date(when);
  start.setHours(10, 0, 0, 0);
  const lateMinutes = Math.max(0, Math.round((when - start) / 60000));
  return { status: lateMinutes > 0 ? "LATE" : "PRESENT", lateMinutes };
}

function activeMissionForEmployee(db, employeeId, at = new Date()) {
  return db.missions.find((mission) => {
    if (mission.employeeId !== employeeId) return false;
    if (!["APPROVED", "IN_PROGRESS"].includes(mission.status)) return false;
    const start = mission.plannedStart ? new Date(mission.plannedStart) : null;
    const end = mission.plannedEnd ? new Date(mission.plannedEnd) : null;
    return (!start || at >= start) && (!end || at <= end);
  }) || null;
}

function branchTarget(branch) {
  if (!branch || !Number.isFinite(Number(branch.latitude)) || !Number.isFinite(Number(branch.longitude))) return null;
  return { latitude: Number(branch.latitude), longitude: Number(branch.longitude) };
}

function geofenceMessage(evaluation = {}) {
  if (evaluation.geofenceStatus === "inside_branch") return "الموقع داخل العنوان المحدد ويمكن تسجيل البصمة.";
  if (evaluation.geofenceStatus === "inside_branch_low_accuracy") return "تم قبول الموقع داخل نطاق المجمع مع دقة GPS ضعيفة. يفضل تشغيل GPS/Location عالي الدقة.";
  if (evaluation.geofenceStatus === "outside_branch") return "أنت خارج نطاق العنوان المحدد. المسافة الحالية " + (evaluation.distanceFromBranchMeters ?? "غير معروفة") + " متر، والنطاق المسموح " + (evaluation.radiusMeters ?? "-") + " متر.";
  if (evaluation.geofenceStatus === "location_low_accuracy") return "دقة الموقع غير كافية. الدقة الحالية " + (evaluation.accuracyMeters ?? "-") + " متر، والحد الأقصى " + (evaluation.maxAccuracyMeters ?? "-") + " متر.";
  if (evaluation.geofenceStatus === "branch_location_missing") return "لم يتم ضبط إحداثيات الفرع/العنوان لهذا الموظف. اضبط Latitude و Longitude ونطاق الحضور من صفحة الفروع.";
  if (evaluation.geofenceStatus === "branch_unknown") return "الموظف غير مربوط بفرع له عنوان حضور.";
  if (evaluation.geofenceStatus === "permission_denied") return "تم رفض صلاحية الموقع. يجب السماح للمتصفح بالموقع قبل تسجيل البصمة.";
  return "تعذر قراءة الموقع الحالي. فعّل GPS/Location ثم حاول مرة أخرى.";
}

function attendanceAddressForEmployee(db, employeeId) {
  const employee = findById(db.employees, employeeId);
  const branch = employee ? findById(db.branches, employee.branchId) : null;
  const target = branchTarget(branch);
  return {
    employee: employee ? enrichEmployee(db, employee) : null,
    branch,
    address: branch?.address || DEFAULT_COMPLEX.address,
    hasConfiguredAddress: Boolean(target),
    latitude: target?.latitude ?? DEFAULT_COMPLEX.latitude,
    longitude: target?.longitude ?? DEFAULT_COMPLEX.longitude,
    radiusMeters: Number(branch?.geofenceRadiusMeters || branch?.radiusMeters || DEFAULT_COMPLEX.radiusMeters),
    maxAccuracyMeters: Number(branch?.maxAccuracyMeters || branch?.max_accuracy_meters || DEFAULT_COMPLEX.maxAccuracyMeters),
    strictGeofence: true,
  };
}

function evaluateAttendance(db, body, eventType) {
  const employee = findById(db.employees, body.employeeId);
  const branch = employee ? findById(db.branches, employee.branchId) : null;
  const currentLocation = Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude))
    ? { latitude: Number(body.latitude), longitude: Number(body.longitude) }
    : null;
  const branchLocation = branchTarget(branch);
  const activeMission = activeMissionForEmployee(db, body.employeeId);
  const timeStatus = statusFromTime(db, employee, new Date());
  const verificationStatus = body.verificationStatus || "verified";
  const riskFlags = [];
  let geofenceStatus = "unknown";
  let distanceFromBranchMeters = null;
  let requiresReview = false;
  let primaryStatus = eventType === "CHECK_OUT" ? "CHECK_OUT" : timeStatus.status;
  const radiusMeters = Number(branch?.geofenceRadiusMeters || branch?.radiusMeters || 300);
  const accuracyMeters = body.accuracyMeters != null ? Number(body.accuracyMeters) : null;
  const maxAccuracyMeters = Number(branch?.maxAccuracyMeters || branch?.max_accuracy_meters || 500);

  if (timeStatus.lateMinutes > 0 && eventType !== "CHECK_OUT") riskFlags.push("late:" + timeStatus.lateMinutes);
  if (verificationStatus !== "verified") {
    requiresReview = true;
    riskFlags.push("verification_not_strong");
  }
  if (!currentLocation) {
    geofenceStatus = body.locationPermission === "denied" ? "permission_denied" : "location_unavailable";
    requiresReview = true;
    riskFlags.push(body.locationPermission === "denied" ? "location_denied" : "location_unknown");
  } else if (!employee || !branch) {
    geofenceStatus = "branch_unknown";
    requiresReview = true;
    riskFlags.push("branch_unknown");
  } else if (!branchLocation) {
    geofenceStatus = "branch_location_missing";
    requiresReview = true;
    riskFlags.push("branch_location_missing");
  } else {
    distanceFromBranchMeters = distanceMeters(currentLocation, branchLocation);
    const weakAccuracy = accuracyMeters != null && accuracyMeters > maxAccuracyMeters;
    const safetyBufferMeters = Number(globalThis.HR_SUPABASE_CONFIG?.attendance?.gpsSafetyBufferMeters || globalThis.HR_SUPABASE_CONFIG?.attendance?.branchLocation?.safetyBufferMeters || 90);
    const effectiveRadius = radiusMeters + safetyBufferMeters + (accuracyMeters ? Math.min(Math.max(accuracyMeters, 0), Math.max(maxAccuracyMeters, 300)) : 0);
    if (distanceFromBranchMeters != null && distanceFromBranchMeters <= radiusMeters) {
      geofenceStatus = weakAccuracy ? "inside_branch_low_accuracy" : "inside_branch";
      if (weakAccuracy) riskFlags.push("location_low_accuracy_accepted");
    } else if (distanceFromBranchMeters != null && weakAccuracy && distanceFromBranchMeters <= effectiveRadius) {
      geofenceStatus = "inside_branch_low_accuracy";
      riskFlags.push("location_low_accuracy_accepted");
    } else if (activeMission && body.allowMissionPunch === true) {
      geofenceStatus = "inside_mission";
      primaryStatus = "MISSION";
    } else {
      geofenceStatus = weakAccuracy ? "location_low_accuracy" : "outside_branch";
      requiresReview = true;
      riskFlags.push(weakAccuracy ? "location_low_accuracy" : "geofence_miss");
      primaryStatus = eventType === "CHECK_OUT" ? "CHECKOUT_REVIEW" : "PRESENT_REVIEW";
    }
  }

  const canRecord = geofenceStatus === "inside_branch" || geofenceStatus === "inside_branch_low_accuracy";
  const blockReason = canRecord ? "" : geofenceMessage({ geofenceStatus, distanceFromBranchMeters, radiusMeters, accuracyMeters, maxAccuracyMeters });
  return {
    type: eventType === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN",
    attendanceStatus: primaryStatus,
    verificationStatus,
    geofenceStatus,
    canRecord,
    blockReason,
    requiresReview,
    riskFlags,
    distanceFromBranchMeters,
    radiusMeters,
    accuracyMeters,
    maxAccuracyMeters,
    latitude: currentLocation?.latitude ?? null,
    longitude: currentLocation?.longitude ?? null,
    branchId: branch?.id || "",
    missionId: activeMission?.id || "",
    notes: body.notes || "",
    lateMinutes: eventType === "CHECK_OUT" ? 0 : timeStatus.lateMinutes,
  };
}

function upsertDailyFromEvent(db, employeeId, event) {
  const day = event.eventAt.slice(0, 10);
  let daily = db.attendanceDaily.find((item) => item.employeeId === employeeId && item.date === day);
  if (!daily) {
    daily = { id: makeId("day"), employeeId, date: day, status: event.type, lateMinutes: event.lateMinutes || 0, workMinutes: 0, requiresReview: Boolean(event.requiresReview), firstCheckInAt: "", lastCheckOutAt: "" };
    db.attendanceDaily.unshift(daily);
  }
  if (event.type === "CHECK_OUT" || event.type === "CHECKOUT_REVIEW") daily.lastCheckOutAt = event.eventAt;
  else {
    daily.firstCheckInAt ||= event.eventAt;
    daily.status = event.type;
    daily.lateMinutes = event.lateMinutes || daily.lateMinutes || 0;
  }
  if (daily.firstCheckInAt && daily.lastCheckOutAt) {
    daily.workMinutes = Math.max(0, Math.round((new Date(daily.lastCheckOutAt) - new Date(daily.firstCheckInAt)) / 60000));
  }
  daily.requiresReview = daily.requiresReview || Boolean(event.requiresReview);
}

function regenerateDailyLocal(db, body = {}) {
  const from = body.from ? new Date(body.from) : new Date(Date.now() - 30 * 86400000);
  const to = body.to ? new Date(body.to) : new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  const employees = body.employeeId ? db.employees.filter((e) => e.id === body.employeeId) : db.employees.filter((e) => !e.isDeleted && e.status !== "TERMINATED");
  let generated = 0;
  for (const employee of employees) {
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const events = db.attendanceEvents.filter((event) => event.employeeId === employee.id && String(event.eventAt).startsWith(key)).sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt));
      let daily = db.attendanceDaily.find((item) => item.employeeId === employee.id && item.date === key);
      if (!daily) {
        daily = { id: makeId("day"), employeeId: employee.id, date: key, status: "ABSENT", lateMinutes: 0, workMinutes: 0, requiresReview: false, firstCheckInAt: "", lastCheckOutAt: "" };
        db.attendanceDaily.unshift(daily);
      }
      const leave = db.leaves.find((leave) => leave.employeeId === employee.id && leave.status === "APPROVED" && String(leave.startDate).slice(0, 10) <= key && String(leave.endDate).slice(0, 10) >= key);
      const mission = db.missions.find((mission) => mission.employeeId === employee.id && ["APPROVED", "IN_PROGRESS", "COMPLETED"].includes(mission.status) && String(mission.plannedStart || "").slice(0, 10) <= key && String(mission.plannedEnd || "").slice(0, 10) >= key);
      const first = events.find((event) => event.type !== "CHECK_OUT");
      const last = [...events].reverse().find((event) => event.type === "CHECK_OUT" || event.type === "CHECKOUT_REVIEW");
      daily.firstCheckInAt = first?.eventAt || "";
      daily.lastCheckOutAt = last?.eventAt || "";
      daily.status = leave ? "ON_LEAVE" : mission && !first ? "ON_MISSION" : first ? first.type : "ABSENT";
      daily.lateMinutes = first?.lateMinutes || 0;
      daily.workMinutes = first && last ? Math.max(0, Math.round((new Date(last.eventAt) - new Date(first.eventAt)) / 60000)) : 0;
      daily.requiresReview = events.some((event) => event.requiresReview) || Boolean(first && !last);
      generated += 1;
    }
  }
  audit(db, "regenerate", "attendance_daily", "bulk", null, { generated, from, to });
  return { generated, employees: employees.length, from: from.toISOString(), to: to.toISOString() };
}

function applyEmployeePayload(db, target, body = {}) {
  const branch = findById(db.branches, body.branchId || target.branchId);
  Object.assign(target, {
    fullName: String(body.fullName ?? target.fullName ?? "موظف جديد").trim() || "موظف جديد",
    phone: normalizePhone(body.phone ?? target.phone ?? ""),
    email: normalizeEmail(body.email ?? target.email ?? ""),
    photoUrl: body.photoUrl || body.avatarUrl || target.photoUrl || "",
    jobTitle: String(body.jobTitle ?? target.jobTitle ?? "").trim(),
    roleId: body.roleId || target.roleId || db.roles.find((role) => role.slug === "employee" || role.key === "EMPLOYEE")?.id || db.roles.at(-1)?.id,
    branchId: body.branchId || target.branchId || db.branches[0]?.id,
    departmentId: body.departmentId || target.departmentId || db.departments[0]?.id || "",
    governorateId: body.governorateId || branch?.governorateId || target.governorateId || db.governorates[0]?.id || "",
    complexId: body.complexId || branch?.complexId || target.complexId || db.complexes[0]?.id || "",
    managerEmployeeId: body.managerEmployeeId ?? target.managerEmployeeId ?? "",
    status: body.status || target.status || "ACTIVE",
    hireDate: body.hireDate || target.hireDate || new Date().toISOString().slice(0, 10),
    updatedAt: now(),
  });
  delete target["employee" + "Code"];
  return target;
}

function createUserRecord(db, body = {}) {
  const employee = findById(db.employees, body.employeeId);
  const email = inferEmail(db, body, employee);
  if (!email) throw new Error("يجب إدخال بريد إلكتروني أو رقم هاتف صالح لإنشاء حساب دخول.");
  if ((db.users || []).some((user) => normalizeEmail(user.email) === email)) throw new Error("البريد الإلكتروني مستخدم بالفعل.");
  const generatedPassword = body.password ? String(body.password) : (normalizePhone(body.phone || employee?.phone || "") || makeStrongPassword());
  const user = {
    id: makeId("u"),
    employeeId: body.employeeId || "",
    name: body.name || body.fullName || employee?.fullName || email,
    fullName: body.name || body.fullName || employee?.fullName || email,
    email,
    phone: normalizePhone(body.phone || employee?.phone || ""),
    avatarUrl: body.avatarUrl || body.photoUrl || employee?.photoUrl || "",
    photoUrl: body.avatarUrl || body.photoUrl || employee?.photoUrl || "",
    password: generatedPassword,
    roleId: body.roleId || employee?.roleId || db.roles.at(-1)?.id,
    branchId: body.branchId || employee?.branchId || "",
    departmentId: body.departmentId || employee?.departmentId || "",
    governorateId: body.governorateId || employee?.governorateId || "",
    complexId: body.complexId || employee?.complexId || "",
    status: body.status || "ACTIVE",
    temporaryPassword: true,
    mustChangePassword: true,
    passkeyEnabled: body.passkeyEnabled === "on" || body.passkeyEnabled === true,
    failedLogins: 0,
    lastLoginAt: "",
  };
  db.users.unshift(user);
  db.credentialVault ||= [];
  db.credentialVault.unshift({ id: makeId("cred"), userId: user.id, employeeId: user.employeeId, email: user.email, temporaryPassword: generatedPassword, status: "ISSUED", createdAt: now(), createdBy: currentUser(db)?.id || "system", note: "كلمة الدخول الافتراضية حسب سياسة الجمعية هي رقم الهاتف/الرقم الشخصي المسجل في قائمة الموظفين المعتمدة." });
  db.credentialVault = db.credentialVault.slice(0, 500);
  audit(db, "create", "user", user.id, null, { ...user, password: "***" });
  notify(db, `تم إنشاء مستخدم ${user.name}`, "تم إنشاء حساب دخول برقم الهاتف وكلمة مرور مطابقة للرقم المسجل.", "SUCCESS");
  return user;
}

function dashboard(db) {
  const allowedIds = scopedEmployeeIds(db);
  const employees = db.employees.filter((employee) => !employee.isDeleted && allowedIds.has(employee.id));
  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = db.attendanceEvents.filter((event) => allowedIds.has(event.employeeId) && (event.eventAt?.startsWith(today) || event.eventAt?.startsWith("2026-04-26")));
  const openRequests = scopedRowsByEmployee(db, db.leaves).filter((item) => item.status === "PENDING").length
    + scopedRowsByEmployee(db, db.missions).filter((item) => item.status === "PENDING").length
    + scopedRowsByEmployee(db, db.exceptions).filter((item) => item.status === "PENDING").length
    + scopedRowsByEmployee(db, db.locationRequests).filter((item) => item.status === "PENDING").length
    + (isFullAccessUser(db) ? (db.disputeCases || []).filter((item) => ["OPEN", "PENDING", "IN_REVIEW"].includes(item.status)).length : 0);
  const byDepartment = db.departments.map((department) => ({
    label: department.name,
    present: todayEvents.filter((event) => findById(db.employees, event.employeeId)?.departmentId === department.id && ["PRESENT", "LATE", "MISSION"].includes(event.type)).length,
    late: todayEvents.filter((event) => findById(db.employees, event.employeeId)?.departmentId === department.id && event.type === "LATE").length,
    mission: todayEvents.filter((event) => findById(db.employees, event.employeeId)?.departmentId === department.id && event.type === "MISSION").length,
  }));
  const readiness = systemReadiness(db);
  const workflow = workflowSummary(db);
  const rejectedReviews = (db.attendanceEvents || []).filter((event) => allowedIds.has(event.employeeId) && (event.requiresReview || event.status === "REJECTED")).length;
  const unlinkedEmployees = employees.filter((employee) => !(db.users || []).some((user) => user.employeeId === employee.id)).length;
  const healthScore = readiness.score;
  return {
    executive: { readiness, workflow, rejectedReviews, unlinkedEmployees },
    metrics: [
      { label: "الموظفون النشطون", value: activeEmployees, helper: `${employees.length} ملف موظف` },
      { label: "حضور اليوم", value: todayEvents.filter((event) => ["PRESENT", "LATE", "MISSION"].includes(event.type)).length, helper: "حضور وتأخير ومأموريات" },
      { label: "طلبات مفتوحة", value: openRequests, helper: "إجازات ومأموريات واستثناءات" },
      { label: "جاهزية النظام", value: `${healthScore}%`, helper: readiness.grade },
      { label: "بصمات للمراجعة", value: rejectedReviews, helper: "خارج النطاق أو دقة ضعيفة" },
      { label: "موظفون بلا حساب", value: unlinkedEmployees, helper: "يحتاجون ربط دخول" },
    ],
    attendanceBreakdown: [
      { label: "حاضر", value: todayEvents.filter((event) => event.type === "PRESENT").length },
      { label: "متأخر", value: todayEvents.filter((event) => event.type === "LATE").length },
      { label: "مأمورية", value: todayEvents.filter((event) => event.type === "MISSION").length },
      { label: "غياب", value: todayEvents.filter((event) => event.type === "ABSENT").length },
    ],
    attendanceTrends: byDepartment,
    latestEvents: db.attendanceEvents.filter((event) => allowedIds.has(event.employeeId)).map((event) => enrichByEmployee(db, event)).sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt)).slice(0, 8),
    latestAudit: isFullAccessUser(db) ? db.auditLogs.slice(0, 6) : [],
    workflowLatest: workflow.latest,
    readiness,
  };
}


function isExecutiveAuthority(db) {
  const user = currentUser(db);
  if (!user) return false;
  return isFullAccessUser(db) || hasLocalScope(db, "sensitive-actions:approve") || hasLocalScope(db, "approvals:manage");
}

function sensitiveApprovalSummary(db) {
  const rows = (db.sensitiveApprovals || []).map((row) => ({ ...row, employee: row.targetEmployeeId ? enrichEmployee(db, findById(db.employees || [], row.targetEmployeeId) || {}) : null }));
  return {
    rows: rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    counts: rows.reduce((acc, row) => { const status = row.status || 'PENDING'; acc.total += 1; acc[status] = (acc[status] || 0) + 1; return acc; }, { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0 }),
  };
}

function createSensitiveApprovalRecord(db, body = {}) {
  const actor = currentUser(db);
  db.sensitiveApprovals ||= [];
  const item = {
    id: makeId('approval'),
    actionType: body.actionType || 'SENSITIVE_ACTION',
    targetType: body.targetType || 'system',
    targetId: body.targetId || '',
    targetEmployeeId: body.targetEmployeeId || body.employeeId || '',
    title: body.title || 'طلب اعتماد عملية حساسة',
    summary: body.summary || body.reason || '',
    payload: body.payload || {},
    status: 'PENDING',
    requestedByUserId: actor?.id || 'system',
    requestedByEmployeeId: actor?.employeeId || '',
    requestedByName: actor?.fullName || actor?.name || 'النظام',
    requestedAt: now(),
    createdAt: now(),
    workflow: [{ at: now(), by: actor?.fullName || actor?.name || 'النظام', action: 'created', note: body.summary || body.reason || '' }],
  };
  db.sensitiveApprovals.unshift(item);
  notifyManyEmployees(db, ['emp-executive-director', 'emp-executive-secretary'], 'طلب اعتماد عملية حساسة', item.title, 'ACTION_REQUIRED');
  audit(db, 'sensitive_approval.request', item.targetType, item.targetId || item.id, null, item);
  return item;
}

function executeApprovedSensitiveAction(db, approval) {
  if (!approval || approval.status !== 'APPROVED') return { executed: false, reason: 'not_approved' };
  const before = clone(approval);
  let result = { executed: false };
  if (approval.actionType === 'DELETE_EMPLOYEE' && approval.targetEmployeeId) {
    const employee = findById(db.employees || [], approval.targetEmployeeId);
    if (!employee) throw new Error('الموظف المطلوب غير موجود.');
    const employeeBefore = clone(employee);
    employee.isDeleted = true;
    employee.status = 'INACTIVE';
    employee.updatedAt = now();
    const user = findById(db.users || [], employee.userId) || (db.users || []).find((u) => u.employeeId === employee.id);
    if (user) user.status = 'DISABLED';
    audit(db, 'sensitive_approval.execute.delete_employee', 'employee', employee.id, employeeBefore, employee);
    result = { executed: true, employeeId: employee.id };
  } else if (approval.actionType === 'DISABLE_USER' && approval.targetId) {
    const user = findById(db.users || [], approval.targetId);
    if (!user) throw new Error('المستخدم غير موجود.');
    const userBefore = clone(user);
    user.status = 'DISABLED';
    audit(db, 'sensitive_approval.execute.disable_user', 'user', user.id, userBefore, user);
    result = { executed: true, userId: user.id };
  }
  approval.status = result.executed ? 'EXECUTED' : approval.status;
  approval.executedAt = result.executed ? now() : approval.executedAt;
  approval.workflow ||= [];
  approval.workflow.unshift({ at: now(), by: currentUser(db)?.name || 'النظام', action: result.executed ? 'executed' : 'skipped', note: result.reason || '' });
  audit(db, 'sensitive_approval.execute', 'sensitive_approval', approval.id, before, approval);
  return result;
}

function executivePresenceSnapshot(db) {
  const day = now().slice(0, 10);
  const events = db.attendanceEvents || [];
  const leaves = db.leaves || [];
  const missions = db.missions || [];
  const latest = latestLocations(db);
  const rows = visibleEmployees(db).map((employee) => {
    const dayEvents = events.filter((event) => event.employeeId === employee.id && String(event.eventAt || event.createdAt || '').slice(0, 10) === day).sort((a, b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
    const checkIn = dayEvents.find((event) => ['CHECK_IN', 'PRESENT', 'LATE'].includes(event.type));
    const checkOut = [...dayEvents].reverse().find((event) => ['CHECK_OUT', 'OUT'].includes(event.type));
    const leave = leaves.find((row) => row.employeeId === employee.id && row.status === 'APPROVED' && String(row.startDate || '').slice(0,10) <= day && String(row.endDate || row.startDate || '').slice(0,10) >= day);
    const mission = missions.find((row) => row.employeeId === employee.id && ['APPROVED', 'IN_PROGRESS'].includes(row.status) && String(row.plannedStart || row.startDate || '').slice(0,10) <= day && String(row.plannedEnd || row.endDate || row.plannedStart || '').slice(0,10) >= day);
    let status = 'ABSENT';
    if (leave) status = 'ON_LEAVE';
    else if (mission && !checkIn) status = 'ON_MISSION';
    else if (checkIn && checkOut) status = 'CHECKED_OUT';
    else if (checkIn) status = String(checkIn.status || checkIn.type || 'PRESENT').includes('LATE') ? 'LATE' : 'PRESENT';
    return { employeeId: employee.id, employee, day, status, checkInAt: checkIn?.eventAt || checkIn?.createdAt || '', checkOutAt: checkOut?.eventAt || checkOut?.createdAt || '', lastLocation: latest.find((loc) => loc.employeeId === employee.id) || null, leave, mission };
  });
  const counts = rows.reduce((acc, row) => { acc.total++; acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, { total: 0, PRESENT: 0, LATE: 0, ABSENT: 0, CHECKED_OUT: 0, ON_LEAVE: 0, ON_MISSION: 0 });
  return { day, counts, rows, generatedAt: now() };
}

const API_BASE = (() => {
  const override = new URLSearchParams(location.search).get("api");
  if (override === "local") return "";
  if (override) return override.replace(/\/$/, "");
  if (location.protocol === "file:") return "";
  if (["localhost", "127.0.0.1", "::1"].includes(location.hostname)) return "";
  if (location.hostname.endsWith("github.io")) return "";
  return "/api";
})();

function localFallbackAllowed() {
  return globalThis.HR_SUPABASE_CONFIG?.security?.allowLocalFallback === true;
}

function shouldUseApi() {
  return Boolean(API_BASE);
}

let csrfToken = "";

function csrfFromCookie() {
  return document.cookie.split("; ").find((part) => part.startsWith("hr_csrf="))?.split("=")[1] || "";
}

async function ensureCsrfToken() {
  if (!API_BASE) return "";
  csrfToken = csrfToken || csrfFromCookie();
  if (csrfToken) return csrfToken;
  await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" }).catch(() => null);
  csrfToken = csrfFromCookie();
  return csrfToken;
}

function queryString(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") q.set(key, String(value));
  });
  const text = q.toString();
  return text ? `?${text}` : "";
}

async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  if (!["GET", "HEAD"].includes(method.toUpperCase())) {
    const token = await ensureCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      method,
      headers,
      body: options.body instanceof FormData ? options.body : options.body != null ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (!["GET", "HEAD"].includes(method.toUpperCase()) && !String(path).includes("/auth/")) {
      return { queued: true, offline: true, item: queueOfflineRequest(path, options), message: "تم حفظ الطلب في قائمة المزامنة لحين عودة الاتصال." };
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false || payload?.success === false) {
    throw new Error(payload?.error?.message || payload?.message || "تعذر تنفيذ الطلب من الخادم.");
  }
  return payload?.data ?? payload?.items ?? payload;
}

async function apiUploadAvatar(file) {
  const form = new FormData();
  form.append("file", file);
  const payload = await apiRequest("/uploads/avatar", { method: "POST", body: form });
  return payload.url || payload.data?.url || "";
}


function browserSupportsWebAuthn() {
  return Boolean(globalThis.PublicKeyCredential && navigator.credentials);
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function queueOfflineRequest(path, options = {}) {
  const db = loadDb();
  const item = { id: makeId("queue"), path, method: options.method || "GET", body: options.body || null, status: "PENDING", attempts: 0, createdAt: now() };
  db.offlineQueue.unshift(item);
  audit(db, "queue", "offline_request", item.id, null, item);
  saveDb(db);
  return item;
}

function latestLocations(db) {
  const latest = new Map();
  for (const loc of db.locations || []) {
    if (!loc.employeeId) continue;
    const old = latest.get(loc.employeeId);
    if (!old || new Date(loc.date || loc.createdAt || 0) > new Date(old.date || old.createdAt || 0)) latest.set(loc.employeeId, loc);
  }
  return [...latest.values()].map((item) => enrichByEmployee(db, item));
}

function analyticsRows(db) {
  const today = new Date().toISOString().slice(0, 10);
  return visibleEmployees(db).map((employee) => {
    const days = (db.attendanceDaily || []).filter((day) => day.employeeId === employee.id).slice(0, 30);
    const absences = days.filter((day) => day.status === "ABSENT").length;
    const lateMinutes = days.reduce((sum, day) => sum + Number(day.lateMinutes || 0), 0);
    const last = latestLocations(db).find((loc) => loc.employeeId === employee.id);
    const riskScore = Math.min(100, absences * 22 + Math.ceil(lateMinutes / 30) * 7);
    return { employee, employeeId: employee.id, today, absences, lateMinutes, riskScore, productivityHint: riskScore >= 60 ? "يحتاج متابعة عاجلة" : riskScore >= 30 ? "متوسط المخاطر" : "مستقر", lastLocation: last || null };
  }).sort((a, b) => b.riskScore - a.riskScore);
}

const remoteEndpoints = {
  me: () => apiRequest("/auth/me").catch((error) => {
    if (error.message.includes("No active session") || error.message.includes("UNAUTHORIZED")) return null;
    throw error;
  }),
  login: (identifier, password) => apiRequest("/auth/login", { method: "POST", body: { identifier, password } }),
  employeeRegister: (body) => apiRequest("/auth/register-employee", { method: "POST", body }),
  logout: () => apiRequest("/auth/logout", { method: "POST" }),
  changePassword: (body) => apiRequest("/auth/change-password", { method: "POST", body }),
  dashboard: () => apiRequest("/dashboard"),
  health: () => apiRequest("/health"),
  employees: () => apiRequest("/employees"),
  employee: (employeeId) => apiRequest(`/employees/${encodeURIComponent(employeeId)}`),
  bulkEmployeeAction: (body) => apiRequest("/employees/bulk", { method: "POST", body }),
  createEmployee: (body) => apiRequest("/employees", { method: "POST", body }),
  updateEmployee: (employeeId, body) => apiRequest(`/employees/${encodeURIComponent(employeeId)}`, { method: "PATCH", body }),
  setEmployeeStatus: (employeeId, status) => apiRequest(`/employees/${encodeURIComponent(employeeId)}/status`, { method: "POST", body: { status } }),
  deleteEmployee: (employeeId) => apiRequest(`/employees/${encodeURIComponent(employeeId)}`, { method: "DELETE" }),
  assignShift: (employeeId, body) => apiRequest(`/employees/${encodeURIComponent(employeeId)}/shift-assignment`, { method: "POST", body }),
  users: () => apiRequest("/users"),
  createUser: (body) => apiRequest("/users", { method: "POST", body }),
  updateUser: (userId, body) => apiRequest(`/users/${encodeURIComponent(userId)}`, { method: "PATCH", body }),
  setUserStatus: (userId, status) => apiRequest(`/users/${encodeURIComponent(userId)}/status`, { method: "POST", body: { status } }),
  attendanceEvents: (params = {}) => apiRequest(`/attendance/events${queryString(params)}`),
  attendanceDaily: (params = {}) => apiRequest(`/attendance/daily${queryString(params)}`),
  attendanceAddress: () => apiRequest("/attendance/my-address"),
  myAttendanceEvents: () => apiRequest("/attendance/my-events"),
  evaluateGeofence: (body) => apiRequest("/geofence/evaluate", { method: "POST", body }),
  checkIn: (body) => apiRequest("/attendance/check-in", { method: "POST", body }),
  checkOut: (body) => apiRequest("/attendance/check-out", { method: "POST", body }),
  recordAttendance: (body = {}) => {
    const action = String(body.eventType || body.type || body.action || "").toLowerCase();
    const out = ["out", "checkout", "check_out", "انصراف"].includes(action);
    assertEmployeePunchButtonIntent(body);
    assertEmployeePunchPasskey(body);
    return apiRequest("/employee/attendance", { method: "POST", body: { ...(body || {}), action: out ? "check_out" : "check_in" } });
  },
  selfCheckIn: (body) => apiRequest("/employee/attendance", { method: "POST", body: { ...(body || {}), action: "check_in" } }),
  selfCheckOut: (body) => apiRequest("/employee/attendance", { method: "POST", body: { ...(body || {}), action: "check_out" } }),
  regenerateAttendance: (body) => apiRequest("/attendance/regenerate", { method: "POST", body }),
  manualAttendance: (body) => apiRequest("/attendance/manual-adjustments", { method: "POST", body }),
  adjustAttendance: (body) => apiRequest("/exceptions", { method: "POST", body }),
  missions: () => apiRequest("/missions"),
  createMission: (body) => apiRequest("/missions", { method: "POST", body }),
  updateMission: (missionId, action, extra = {}) => apiRequest(`/missions/${encodeURIComponent(missionId)}/${action === "complete" ? "complete" : action === "reject" ? "reject" : "approve"}`, { method: "POST", body: extra }),
  leaves: () => apiRequest("/leave"),
  createLeave: (body) => apiRequest("/leave", { method: "POST", body }),
  updateLeave: (leaveId, action, extra = {}) => apiRequest(`/leaves/requests/${encodeURIComponent(leaveId)}/${action === "reject" ? "reject" : "approve"}`, { method: "POST", body: extra }),
  exceptions: () => apiRequest("/exceptions"),
  updateException: (id, action) => apiRequest(`/exceptions/${encodeURIComponent(id)}/${action === "reject" ? "reject" : "approve"}`, { method: "POST" }),
  notifications: () => apiRequest("/notifications"),
  createAnnouncement: (body) => apiRequest("/notifications/announcements", { method: "POST", body }),
  markNotificationRead: (id) => apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  reports: () => apiRequest("/reports"),
  createReport: (body) => apiRequest("/reports", { method: "POST", body }),
  exportReportData: (body) => apiRequest("/reports/export", { method: "POST", body }),
  saveReportSchedule: (body) => apiRequest("/reports/schedules", { method: "POST", body }),
  settings: () => apiRequest("/settings"),
  updateSettings: (body) => apiRequest("/settings", { method: "PATCH", body }),
  kpi: async () => apiRequest("/kpi"),
  saveKpiEvaluation: (body) => apiRequest("/kpi/evaluations", { method: "POST", body }),
  updateKpiEvaluation: (id, body) => apiRequest(`/kpi/evaluations/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  disputes: () => apiRequest("/disputes"),
  disputeEmployees: () => apiRequest("/employees"),
  createDispute: (body) => apiRequest("/disputes", { method: "POST", body }),
  updateDispute: (id, body) => apiRequest(`/disputes/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  locations: () => apiRequest("/location-requests"),
  createLocationRequest: (body) => apiRequest("/location-requests", { method: "POST", body }),
  updateLocationRequest: (id, body) => apiRequest(`/location-requests/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  recordLocation: (body) => apiRequest("/location/record", { method: "POST", body }),
  executiveMobile: () => apiRequest("/executive/mobile"),
  executiveEmployeeDetail: (employeeId) => apiRequest(`/executive/employees/${encodeURIComponent(employeeId)}`),
  requestLiveLocation: (employeeId, body = {}) => apiRequest(`/executive/employees/${encodeURIComponent(employeeId)}/live-location`, { method: "POST", body }),
  myLiveLocationRequests: () => apiRequest("/employee/live-location-requests"),
  respondLiveLocationRequest: (id, body = {}) => apiRequest(`/employee/live-location-requests/${encodeURIComponent(id)}/respond`, { method: "POST", body }),
  adminAccessLog: (body = {}) => apiRequest("/admin/access-log", { method: "POST", body }),
  sensitiveApprovals: () => apiRequest("/sensitive-approvals"),
  createSensitiveApproval: (body = {}) => apiRequest("/sensitive-approvals", { method: "POST", body }),
  decideSensitiveApproval: (id, body = {}) => apiRequest(`/sensitive-approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body }),
  executivePresenceSnapshot: () => apiRequest("/executive/presence-snapshot"),
  queue: () => apiRequest("/queue/status"),
  permissions: () => apiRequest("/permissions"),
  roles: async () => {
    const rows = await apiRequest("/roles");
    return rows.map((role) => ({ ...role, key: role.key || role.slug, permissions: (role.permissions || []).map((item) => item.permission?.scope || item.scope || item).filter(Boolean) }));
  },
  saveRole: (body) => body.id ? apiRequest(`/roles/${encodeURIComponent(body.id)}`, { method: "PATCH", body }) : apiRequest("/roles", { method: "POST", body }),
  branches: () => apiRequest("/organization/branches"),
  departments: () => apiRequest("/organization/departments"),
  governorates: () => apiRequest("/organization/governorates"),
  complexes: () => apiRequest("/organization/complexes"),
  listOrg: (kind) => apiRequest(`/organization/${kind}`),
  saveOrg: (kind, body) => body.id ? apiRequest(`/organization/${kind}/${encodeURIComponent(body.id)}`, { method: "PATCH", body }) : apiRequest(`/organization/${kind}`, { method: "POST", body }),
  deleteOrg: (kind, id) => apiRequest(`/organization/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  auditLogs: () => apiRequest("/audit-logs"),
  backup: () => apiRequest("/system/export"),
  restoreBackup: (db) => Promise.resolve(db),
  saveBackupSnapshot: (body) => apiRequest("/system/backups", { method: "POST", body }),
  importEmployees: (rows) => apiRequest("/system/import/employees", { method: "POST", body: { rows } }),
  uploadAvatar: apiUploadAvatar,
  realtimeSnapshot: () => apiRequest("/realtime/snapshot"),
  aiAnalytics: () => apiRequest("/analytics/ai"),
  integrations: () => apiRequest("/integrations/settings"),
  saveIntegration: (body) => apiRequest("/integrations/settings", { method: "POST", body }),
  accessControlEvents: () => apiRequest("/access-control/events"),
  createAccessEvent: (body) => apiRequest("/access-control/events", { method: "POST", body }),
  subscribePush: (body) => apiRequest("/notifications/subscriptions", { method: "POST", body }),
  passkeyStatus: () => apiRequest("/passkeys"),
  registerPasskey: (body) => apiRequest("/passkeys/register/verify", { method: "POST", body }),
  offlineQueue: () => apiRequest("/offline/queue"),
  syncOfflineQueue: () => apiRequest("/offline/sync", { method: "POST" }),
  reset: () => Promise.resolve({ ok: true, message: "إعادة الضبط متاحة في وضع Live Server المحلي فقط." }),
};

const orgKeyMap = {
  branches: "branches",
  departments: "departments",
  governorates: "governorates",
  complexes: "complexes",
};

function saveOrgLocal(db, kind, body) {
  const key = orgKeyMap[kind] || kind;
  db[key] ||= [];
  if (body.id) {
    const item = findById(db[key], body.id);
    if (!item) throw new Error("العنصر غير موجود.");
    const before = clone(item);
    Object.assign(item, body, { updatedAt: now() });
    audit(db, "update", key, item.id, before, item);
    return item;
  }
  const item = { id: makeId(key.slice(0, 3)), active: true, createdAt: now(), ...body };
  db[key].unshift(item);
  audit(db, "create", key, item.id, null, item);
  notify(db, `تم إنشاء ${item.name || item.code || "عنصر تنظيمي"}`, "", "SUCCESS");
  return item;
}

function requestWorkflow(item, action, actor = "النظام") {
  item.workflow ||= [];
  item.workflow.push({ at: now(), by: actor, action });
}

function clampScore(value, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Number(max || 100), Math.round(number * 10) / 10));
}

function kpiGrade(total) {
  const score = Number(total || 0);
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

function kpiRating(total) {
  const score = Number(total || 0);
  if (score >= 90) return "ممتاز";
  if (score >= 80) return "جيد جدًا";
  if (score >= 70) return "جيد";
  if (score >= 60) return "مقبول";
  return "يحتاج تحسين";
}

function currentKpiCycle(db) {
  const policy = db.kpiPolicy || {};
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const startsOn = new Date(year, month, Number(policy.evaluationStartDay || 20), 12, 0, 0);
  const endsOn = new Date(year, month, Number(policy.evaluationEndDay || 25), 23, 59, 0);
  const id = `${year}-${String(month + 1).padStart(2, "0")}-kpi`;
  let cycle = (db.kpiCycles || []).find((item) => item.id === id) || (db.kpiCycles || [])[0];
  if (!cycle || cycle.id !== id) {
    cycle = {
      id,
      name: `تقييم أداء ${today.toLocaleDateString("ar-EG-u-nu-latn", { month: "long", year: "numeric" })}`,
      periodType: "monthly",
      startsOn: startsOn.toISOString().slice(0, 10),
      endsOn: endsOn.toISOString().slice(0, 10),
      dueOn: endsOn.toISOString().slice(0, 10),
      status: "PENDING",
      createdAt: now(),
    };
    db.kpiCycles.unshift(cycle);
  }
  return cycle;
}

function attendanceScoreForEmployee(db, employeeId, cycle) {
  const from = String(cycle.startsOn || "").slice(0, 10);
  const to = String(cycle.endsOn || "").slice(0, 10);
  const days = (db.attendanceDaily || []).filter((row) => row.employeeId === employeeId && (!from || row.date >= from) && (!to || row.date <= to));
  if (!days.length) return 20;
  const latePenalty = days.reduce((sum, row) => sum + Math.min(4, Math.ceil(Number(row.lateMinutes || 0) / 15)), 0);
  const absencePenalty = days.filter((row) => row.status === "ABSENT").length * 5;
  const reviewPenalty = days.filter((row) => row.requiresReview).length * 2;
  return clampScore(20 - latePenalty - absencePenalty - reviewPenalty, 20);
}

function scoreFromBody(body, scoreKey, percentKey, max) {
  if (body[scoreKey] !== undefined && body[scoreKey] !== "") return clampScore(body[scoreKey], max);
  if (body[percentKey] !== undefined && body[percentKey] !== "") return clampScore(Number(body[percentKey] || 0) * Number(max || 0) / 100, max);
  return 0;
}

function canonicalKpiStatus(value = "", fallback = "DRAFT") {
  const raw = String(value || fallback || "DRAFT").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = {
    EMPLOYEE_SUBMITTED: "SELF_SUBMITTED",
    SELF: "SELF_SUBMITTED",
    SUBMITTED: "SELF_SUBMITTED",
    MANAGER: "MANAGER_APPROVED",
    MANAGER_REVIEWED: "MANAGER_APPROVED",
    HR: "HR_REVIEWED",
    HR_APPROVED: "HR_REVIEWED",
    SECRETARY: "SECRETARY_REVIEWED",
    SECRETARY_APPROVED: "SECRETARY_REVIEWED",
    EXECUTIVE: "EXECUTIVE_APPROVED",
    APPROVED: "EXECUTIVE_APPROVED",
  };
  return aliases[raw] || raw || fallback || "DRAFT";
}

function expectedPreviousKpiStatus(nextStatus) {
  return {
    MANAGER_APPROVED: "SELF_SUBMITTED",
    HR_REVIEWED: "MANAGER_APPROVED",
    SECRETARY_REVIEWED: "HR_REVIEWED",
    EXECUTIVE_APPROVED: "SECRETARY_REVIEWED",
  }[canonicalKpiStatus(nextStatus)] || "";
}

function recalculateKpiTotals(evaluation) {
  const totalScore = ["targetScore", "efficiencyScore", "attendanceScore", "conductScore", "prayerScore", "quranCircleScore", "initiativesScore"].reduce((sum, key) => sum + Number(evaluation[key] || 0), 0);
  evaluation.totalScore = Math.round(totalScore * 10) / 10;
  evaluation.grade = kpiGrade(evaluation.totalScore);
  evaluation.rating = kpiRating(evaluation.totalScore);
  return evaluation;
}

function ensureKpiWorkflowTransition(db, previous, normalized, mode, user) {
  const nextStatus = canonicalKpiStatus(normalized.status);
  normalized.status = nextStatus;
  const previousStatus = canonicalKpiStatus(previous?.status || "", previous ? "DRAFT" : "");
  if (nextStatus === "SELF_SUBMITTED") {
    if (normalized.employeeId !== user?.employeeId && !isFullAccessUser(db)) throw new Error("لا يمكن رفع التقييم الذاتي إلا من حساب الموظف نفسه.");
    if (previous && !["DRAFT", "REJECTED", "SELF_SUBMITTED"].includes(previousStatus)) throw new Error("تم تسليم هذا التقييم بالفعل ولا يمكن للموظف تعديله بعد انتقاله للمدير/HR.");
    return;
  }
  const expected = expectedPreviousKpiStatus(nextStatus);
  if (expected && !previous) throw new Error("لا يمكن إنشاء تقييم من هذه المرحلة. يجب أن يبدأ الموظف بتقييم نفسه أولًا.");
  if (expected && previousStatus !== expected) throw new Error(`هذا التقييم في مرحلة ${kpiStageLabel(previousStatus)}، ولا يمكن نقله إلى ${kpiStageLabel(nextStatus)} قبل اكتمال المرحلة السابقة.`);
  if (nextStatus === "MANAGER_APPROVED") {
    if (mode !== "manager" && !isFullAccessUser(db)) throw new Error("اعتماد المدير متاح للمدير المباشر فقط بعد رفع الموظف لنموذجه.");
    const targetEmployee = findById(db.employees, normalized.employeeId);
    if (mode === "manager" && targetEmployee?.managerEmployeeId !== user?.employeeId) throw new Error("لا يمكنك اعتماد تقييم موظف ليس ضمن فريقك المباشر.");
  }
  if (nextStatus === "HR_REVIEWED" && mode !== "hr" && !isFullAccessUser(db)) throw new Error("مراجعة HR لا تتم إلا من لوحة HR بعد اعتماد المدير.");
  if (nextStatus === "SECRETARY_REVIEWED" && !isFullAccessUser(db)) throw new Error("تسليم السكرتير التنفيذي يحتاج صلاحية إدارية كاملة بعد مراجعة HR.");
  if (nextStatus === "EXECUTIVE_APPROVED" && !hasLocalScope(db, "kpi:final-approve") && !hasLocalScope(db, "kpi:executive") && !isFullAccessUser(db)) throw new Error("الاعتماد النهائي متاح للمدير التنفيذي فقط.");
}

function normalizeKpiEvaluation(db, body = {}) {
  const cycle = currentKpiCycle(db);
  const employee = findById(db.employees, body.employeeId);
  const managerId = body.managerEmployeeId || employee?.managerEmployeeId || "";
  const attendanceScore = body.attendanceScore === undefined || body.attendanceScore === "" ? attendanceScoreForEmployee(db, body.employeeId, cycle) : body.attendanceScore;
  const scores = {
    targetScore: scoreFromBody(body, "targetScore", "targetPercent", 40),
    efficiencyScore: scoreFromBody(body, "efficiencyScore", "efficiencyPercent", 20),
    attendanceScore: clampScore(attendanceScore, 20),
    conductScore: scoreFromBody(body, "conductScore", "conductPercent", 5),
    prayerScore: scoreFromBody(body, "prayerScore", "prayerPercent", 5),
    quranCircleScore: scoreFromBody(body, "quranCircleScore", "quranPercent", 5),
    initiativesScore: scoreFromBody(body, "initiativesScore", "initiativesPercent", 5),
  };
  const totalScore = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    cycleId: body.cycleId || cycle.id,
    employeeId: body.employeeId,
    managerEmployeeId: managerId,
    evaluationDate: body.evaluationDate || now().slice(0, 10),
    meetingHeld: body.meetingHeld === "on" || body.meetingHeld === true || body.meetingHeld === "true",
    status: canonicalKpiStatus(body.status || "DRAFT"),
    ...scores,
    totalScore,
    grade: kpiGrade(totalScore),
    rating: kpiRating(totalScore),
    managerNotes: body.managerNotes || "",
    employeeNotes: body.employeeNotes || "",
    hrNotes: body.hrNotes || "",
    secretaryNotes: body.secretaryNotes || "",
    executiveNotes: body.executiveNotes || "",
    submittedAt: ["SELF_SUBMITTED", "EXECUTIVE_APPROVED"].includes(canonicalKpiStatus(body.status)) ? now() : body.submittedAt || "",
  };
}

function kpiSummaryRows(db, cycle = currentKpiCycle(db)) {
  return (db.kpiEvaluations || [])
    .filter((item) => item.cycleId === cycle.id)
    .map((item) => ({ ...item, employee: enrichEmployee(db, findById(db.employees, item.employeeId)), manager: enrichEmployee(db, findById(db.employees, item.managerEmployeeId)), cycle }))
    .sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function monthBounds(month = new Date().toISOString().slice(0, 7)) {
  const safe = /^\d{4}-\d{2}$/.test(String(month)) ? String(month) : new Date().toISOString().slice(0, 7);
  const start = `${safe}-01`;
  const endDate = new Date(`${start}T00:00:00`);
  endDate.setMonth(endDate.getMonth() + 1);
  return { month: safe, start, end: endDate.toISOString().slice(0, 10) };
}

function monthlyAttendanceSummary(db, month) {
  const { start, end } = monthBounds(month);
  const employees = visibleEmployees(db);
  const rows = employees.map((employee) => {
    const events = (db.attendanceEvents || []).filter((event) => event.employeeId === employee.id && String(event.eventAt || event.createdAt || "").slice(0, 10) >= start && String(event.eventAt || event.createdAt || "").slice(0, 10) < end);
    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      jobTitle: employee.jobTitle || "",
      checkIns: events.filter((event) => ["CHECK_IN", "PRESENT", "LATE"].includes(event.type) || ["PRESENT", "LATE", "MANUAL_APPROVED"].includes(event.status)).length,
      checkOuts: events.filter((event) => event.type === "CHECK_OUT").length,
      rejected: events.filter((event) => event.status === "REJECTED" || event.status === "REJECTED_CONFIRMED").length,
      lateMinutes: events.reduce((sum, event) => sum + Number(event.lateMinutes || event.late_minutes || 0), 0),
      lastEventAt: events.sort((a, b) => new Date(b.eventAt || b.createdAt || 0) - new Date(a.eventAt || a.createdAt || 0))[0]?.eventAt || "",
    };
  });
  const totals = rows.reduce((acc, row) => {
    acc.checkIns += row.checkIns;
    acc.checkOuts += row.checkOuts;
    acc.rejected += row.rejected;
    acc.lateMinutes += row.lateMinutes;
    return acc;
  }, { checkIns: 0, checkOuts: 0, rejected: 0, lateMinutes: 0 });
  return {
    month: monthBounds(month).month,
    rows,
    metrics: [
      { label: "الموظفون", value: rows.length, helper: "داخل الصلاحيات الحالية" },
      { label: "حضور", value: totals.checkIns, helper: "إجمالي الحضور" },
      { label: "انصراف", value: totals.checkOuts, helper: "إجمالي الانصراف" },
      { label: "مرفوض", value: totals.rejected, helper: "يحتاج متابعة" },
      { label: "دقائق التأخير", value: totals.lateMinutes, helper: "إجمالي الشهر" },
    ],
  };
}

function todayEventsByEmployee(db) {
  const today = now().slice(0, 10);
  const map = new Map();
  for (const event of db.attendanceEvents || []) {
    const day = String(event.eventAt || event.createdAt || "").slice(0, 10);
    if (day !== today) continue;
    if (!map.has(event.employeeId) || new Date(event.eventAt || 0) > new Date(map.get(event.employeeId).eventAt || 0)) map.set(event.employeeId, event);
  }
  return map;
}



function attendanceRules(db) {
  return {
    shiftStart: "10:00",
    absentAfter: "11:00",
    earlyExitBefore: "17:00",
    shiftEnd: "18:00",
    duplicateWindowMinutes: 10,
    endOfDayReportAt: "19:00",
    notifyManagerOnAbsence: true,
    requireReviewOutsideGeofence: true,
    requireReviewDuplicatePunch: true,
    requireReviewMissingCheckout: true,
    ...(db.systemSettings?.attendanceRules || {}),
  };
}

function dateKey(value = now()) {
  return String(value || now()).slice(0, 10);
}

function dateTimeForRule(date, hhmm = "00:00") {
  const [h = 0, m = 0] = String(hhmm || "00:00").split(":").map((part) => Number(part || 0));
  const d = new Date(date + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d;
}

function isDateCovered(item = {}, date) {
  const start = String(item.startDate || item.plannedStart || item.date || item.createdAt || "").slice(0, 10);
  const end = String(item.endDate || item.plannedEnd || item.date || item.createdAt || start || "").slice(0, 10);
  return start && date >= start && date <= (end || start);
}

function managerEmployeeIdsFor(db, employeeId) {
  const ids = [];
  let employee = findById(db.employees || [], employeeId);
  const seen = new Set();
  while (employee?.managerEmployeeId && !seen.has(employee.managerEmployeeId)) {
    seen.add(employee.managerEmployeeId);
    ids.push(employee.managerEmployeeId);
    employee = findById(db.employees || [], employee.managerEmployeeId);
  }
  return ids;
}

function smartAlert(db, fingerprint, title, body = "", severity = "MEDIUM", route = "control-room", employeeId = "") {
  db.smartAlerts ||= [];
  let alert = db.smartAlerts.find((row) => row.fingerprint === fingerprint && row.status !== "RESOLVED");
  if (!alert) {
    alert = { id: makeId("alert"), fingerprint, title, body, severity, route, employeeId, status: "OPEN", createdAt: now(), updatedAt: now() };
    db.smartAlerts.unshift(alert);
  } else {
    Object.assign(alert, { title, body, severity, route, employeeId, updatedAt: now() });
  }
  return alert;
}

function notifyManagerChain(db, employeeId, title, body = "", type = "ACTION_REQUIRED") {
  notifyManyEmployees(db, managerEmployeeIdsFor(db, employeeId), title, body, type);
}

function eventsForEmployeeDay(db, employeeId, date) {
  return (db.attendanceEvents || [])
    .filter((event) => event.employeeId === employeeId && String(event.eventAt || event.createdAt || "").slice(0, 10) === date)
    .sort((a, b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
}

function analyseAttendanceForEmployee(db, employee, date = dateKey()) {
  const rules = attendanceRules(db);
  const events = eventsForEmployeeDay(db, employee.id, date);
  const checkIns = events.filter((event) => ["CHECK_IN", "PRESENT", "LATE", "PRESENT_REVIEW", "MANUAL_APPROVED"].includes(event.type) || ["PRESENT", "LATE", "MANUAL_APPROVED"].includes(event.status));
  const checkOuts = events.filter((event) => ["CHECK_OUT", "CHECKOUT_REVIEW"].includes(event.type));
  const firstCheckIn = checkIns[0] || null;
  const lastCheckOut = checkOuts[checkOuts.length - 1] || null;
  const approvedLeave = (db.leaves || []).find((item) => item.employeeId === employee.id && item.status === "APPROVED" && isDateCovered(item, date));
  const approvedMission = (db.missions || []).find((item) => item.employeeId === employee.id && ["APPROVED", "IN_PROGRESS", "COMPLETED"].includes(item.status) && isDateCovered(item, date));
  const flags = [];
  let status = "ABSENT_PENDING";
  let title = "لم يتم تسجيل حضور بعد";
  let severity = "LOW";
  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  const startAt = dateTimeForRule(date, rules.shiftStart);
  const absentAt = dateTimeForRule(date, rules.absentAfter);
  const earlyExitAt = dateTimeForRule(date, rules.earlyExitBefore);
  const shiftEndAt = dateTimeForRule(date, rules.shiftEnd);
  const nowAt = new Date();
  const isToday = date === dateKey();

  if (approvedLeave) {
    status = "ON_LEAVE";
    title = "إجازة معتمدة";
  } else if (approvedMission) {
    status = "ON_MISSION";
    title = "مأمورية معتمدة";
  } else if (!firstCheckIn) {
    if (!isToday || nowAt >= absentAt) {
      status = isToday ? "ABSENT_TEMP" : "ABSENT";
      title = isToday ? "غائب مؤقتًا" : "غائب";
      severity = "HIGH";
      flags.push("missing_check_in");
    }
  } else {
    const inAt = new Date(firstCheckIn.eventAt || firstCheckIn.createdAt);
    if (inAt > startAt) {
      lateMinutes = Math.max(0, Math.round((inAt - startAt) / 60000));
      status = "LATE";
      title = "متأخر " + lateMinutes + " دقيقة";
      severity = lateMinutes >= 60 ? "HIGH" : "MEDIUM";
      flags.push("late");
    } else {
      status = "PRESENT";
      title = "حاضر";
    }
    const outside = events.filter((event) => ["outside_branch", "location_low_accuracy", "permission_denied", "location_unavailable"].includes(event.geofenceStatus) || event.requiresReview);
    if (outside.length) {
      flags.push("outside_geofence");
      status = "REVIEW";
      title = "بصمة تحتاج مراجعة";
      severity = "HIGH";
    }
    const duplicateWindow = Number(rules.duplicateWindowMinutes || 10) * 60000;
    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1];
      const cur = events[i];
      if (prev.type === cur.type && Math.abs(new Date(cur.eventAt || cur.createdAt) - new Date(prev.eventAt || prev.createdAt)) <= duplicateWindow) {
        flags.push("duplicate_punch");
        status = "REVIEW";
        title = "تكرار بصمة مشبوه";
        severity = "MEDIUM";
        break;
      }
    }
    if (lastCheckOut) {
      const outAt = new Date(lastCheckOut.eventAt || lastCheckOut.createdAt);
      if (outAt < earlyExitAt) {
        earlyExitMinutes = Math.max(0, Math.round((earlyExitAt - outAt) / 60000));
        flags.push("early_exit");
        if (status !== "REVIEW") {
          status = "EARLY_EXIT";
          title = "خروج مبكر " + earlyExitMinutes + " دقيقة";
          severity = "MEDIUM";
        }
      }
    } else if (!isToday || nowAt >= shiftEndAt) {
      flags.push("missing_checkout");
      if (status !== "REVIEW") {
        status = "MISSING_CHECKOUT";
        title = "نسيان انصراف";
        severity = "MEDIUM";
      }
    }
  }
  const daily = (db.attendanceDaily || []).find((item) => item.employeeId === employee.id && item.date === date) || null;
  return {
    employeeId: employee.id,
    employee: enrichEmployee(db, employee),
    date,
    status,
    title,
    severity,
    flags: [...new Set(flags)],
    firstCheckInAt: firstCheckIn?.eventAt || firstCheckIn?.createdAt || "",
    lastCheckOutAt: lastCheckOut?.eventAt || lastCheckOut?.createdAt || "",
    lateMinutes,
    earlyExitMinutes,
    eventCount: events.length,
    requiresReview: flags.some((flag) => ["outside_geofence", "duplicate_punch", "missing_checkout"].includes(flag)) || Boolean(daily?.requiresReview),
    leave: approvedLeave || null,
    mission: approvedMission || null,
    recommendation: flags.includes("missing_check_in") ? "تواصل مع الموظف أو المدير المباشر" : flags.includes("outside_geofence") ? "افتح مركز مراجعة البصمات" : flags.includes("missing_checkout") ? "اطلب توضيح أو سجّل انصراف يدوي" : "متابعة عادية",
  };
}

function runSmartAttendanceLocal(db, body = {}) {
  const date = body.date || dateKey();
  const rows = (db.employees || []).filter((employee) => !employee.isDeleted && employee.status !== "TERMINATED").map((employee) => analyseAttendanceForEmployee(db, employee, date));
  let alertsCreated = 0;
  let notificationsCreated = 0;
  db.attendanceDaily ||= [];
  for (const row of rows) {
    let daily = db.attendanceDaily.find((item) => item.employeeId === row.employeeId && item.date === date);
    if (!daily) {
      daily = { id: makeId("day"), employeeId: row.employeeId, date, createdAt: now() };
      db.attendanceDaily.unshift(daily);
    }
    Object.assign(daily, { status: row.status, smartStatus: row.status, firstCheckInAt: row.firstCheckInAt, lastCheckOutAt: row.lastCheckOutAt, lateMinutes: row.lateMinutes, earlyExitMinutes: row.earlyExitMinutes, requiresReview: row.requiresReview, riskFlags: row.flags, recommendation: row.recommendation, updatedAt: now() });
    if (["ABSENT_TEMP", "ABSENT", "EARLY_EXIT", "MISSING_CHECKOUT", "REVIEW"].includes(row.status)) {
      const fp = "smart-attendance:" + date + ":" + row.employeeId + ":" + row.status + ":" + row.flags.join("|");
      smartAlert(db, fp, row.employee.fullName + ": " + row.title, row.recommendation, row.severity, row.status === "REVIEW" ? "attendance-review" : "smart-attendance", row.employeeId);
      alertsCreated += 1;
      const existingNote = (db.notifications || []).some((note) => note.employeeId === row.employeeId && note.type === "SMART_" + row.status && String(note.createdAt || "").startsWith(date));
      if (!existingNote) {
        notifyEmployee(db, row.employeeId, row.title, row.recommendation, "SMART_" + row.status);
        if (attendanceRules(db).notifyManagerOnAbsence || row.status !== "ABSENT_TEMP") notifyManagerChain(db, row.employeeId, row.employee.fullName + ": " + row.title, row.recommendation, "ACTION_REQUIRED");
        notificationsCreated += 1;
      }
    }
  }
  const counts = rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  const run = { id: makeId("smartatt"), date, rows: rows.length, counts, alertsCreated, notificationsCreated, createdAt: now(), createdByUserId: currentUser(db)?.id || "system" };
  db.attendanceRuleRuns ||= [];
  db.attendanceRuleRuns.unshift(run);
  db.attendanceRuleRuns = db.attendanceRuleRuns.slice(0, 100);
  audit(db, "smart_attendance.run", "attendance", date, null, run);
  return { date, rows, counts, alertsCreated, notificationsCreated, run };
}

function buildEndOfDayReport(db, body = {}) {
  const date = body.date || dateKey();
  const smart = runSmartAttendanceLocal(db, { date });
  const rows = smart.rows;
  const counts = smart.counts;
  const reviewRows = rows.filter((row) => row.requiresReview || ["ABSENT_TEMP", "ABSENT", "EARLY_EXIT", "MISSING_CHECKOUT", "REVIEW"].includes(row.status));
  const report = {
    id: makeId("eod"), date, period: body.period || "daily", title: body.title || "تقرير نهاية اليوم " + date,
    counts, totals: { employees: rows.length, review: reviewRows.length, present: (counts.PRESENT || 0) + (counts.LATE || 0), absent: (counts.ABSENT || 0) + (counts.ABSENT_TEMP || 0), leave: counts.ON_LEAVE || 0, mission: counts.ON_MISSION || 0 },
    rows: rows.map((row) => ({ employeeId: row.employeeId, employeeName: row.employee?.fullName || row.employeeId, status: row.status, title: row.title, firstCheckInAt: row.firstCheckInAt, lastCheckOutAt: row.lastCheckOutAt, flags: row.flags, recommendation: row.recommendation })),
    createdAt: now(), createdByUserId: currentUser(db)?.id || "system",
  };
  db.endOfDayReports ||= [];
  db.endOfDayReports.unshift(report);
  db.endOfDayReports = db.endOfDayReports.slice(0, 120);
  audit(db, "report.end_of_day", "attendance_report", report.id, null, { date, counts: report.counts });
  return report;
}

function employeeArchiveLocal(db, employeeId) {
  const employee = findById(db.employees || [], employeeId);
  if (!employee || employee.isDeleted) throw new Error("الموظف غير موجود أو تم حذفه.");
  if (!canSeeEmployee(db, employeeId) && !isFullAccessUser(db)) throw new Error("لا تملك صلاحية عرض أرشيف هذا الموظف.");
  const byNew = (a,b) => new Date(b.eventAt || b.createdAt || b.startDate || b.plannedStart || 0) - new Date(a.eventAt || a.createdAt || a.startDate || a.plannedStart || 0);
  const events = (db.attendanceEvents || []).filter((item) => item.employeeId === employeeId).sort(byNew);
  const daily = (db.attendanceDaily || []).filter((item) => item.employeeId === employeeId).sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const leaves = (db.leaves || []).filter((item) => item.employeeId === employeeId).sort(byNew);
  const missions = (db.missions || []).filter((item) => item.employeeId === employeeId).sort(byNew);
  const tasks = (db.tasks || []).filter((item) => item.employeeId === employeeId).sort(byNew);
  const documents = (db.employeeDocuments || []).filter((item) => item.employeeId === employeeId);
  const disputes = (db.disputeCases || []).filter((item) => item.employeeId === employeeId);
  const locations = [...(db.locations || []), ...(db.liveLocationResponses || [])].filter((item) => item.employeeId === employeeId).sort(byNew);
  const kpi = (db.kpiEvaluations || []).filter((item) => item.employeeId === employeeId).sort(byNew);
  const auditRows = (db.auditLogs || []).filter((log) => JSON.stringify(log).includes(employeeId)).slice(0, 100);
  const summary = { attendanceEvents: events.length, absences: daily.filter((row) => ["ABSENT", "ABSENT_TEMP"].includes(row.status || row.smartStatus)).length, lateMinutes: daily.reduce((sum, row) => sum + Number(row.lateMinutes || 0), 0), openTasks: tasks.filter((task) => !["DONE", "CLOSED", "CANCELLED"].includes(task.status)).length, openRequests: [...leaves, ...missions, ...disputes].filter((item) => isPendingRequestStatus(item.status) || ["OPEN"].includes(normalizedRequestStatus(item.status))).length };
  audit(db, "employee_archive.view", "employee", employeeId, null, { viewer: currentUser(db)?.id || "system" });
  return { employee: enrichEmployee(db, employee), summary, events, daily, leaves, missions, tasks, documents, disputes, locations, kpi, auditRows };
}

function createAutomaticBackup(db, body = {}) {
  const policy = { keepLast: 30, ...(db.systemSettings?.backupPolicy || {}) };
  const snapshot = { id: makeId("autobak"), title: body.title || "Backup تلقائي " + new Date().toLocaleString("ar-EG-u-nu-latn"), reason: body.reason || "manual", createdAt: now(), createdByUserId: currentUser(db)?.id || "system", counts: { employees: (db.employees || []).length, users: (db.users || []).length, attendance: (db.attendanceEvents || []).length, auditLogs: (db.auditLogs || []).length }, data: clone(db) };
  db.systemBackups ||= [];
  db.systemBackups.unshift(snapshot);
  db.systemBackups = db.systemBackups.slice(0, Number(policy.keepLast || 30));
  db.autoBackupRuns ||= [];
  db.autoBackupRuns.unshift({ id: makeId("bakrun"), backupId: snapshot.id, reason: snapshot.reason, createdAt: snapshot.createdAt, counts: snapshot.counts, status: "SUCCESS" });
  db.autoBackupRuns = db.autoBackupRuns.slice(0, 100);
  audit(db, "backup.auto", "system_backup", snapshot.id, null, { reason: snapshot.reason, counts: snapshot.counts });
  return { ...snapshot, data: undefined };
}

function workflowItems(db) {
  const rows = [
    ...(db.leaves || []).map((item) => ({ ...item, kind: "leave", kindLabel: "إجازة", label: item.leaveType?.name || item.leaveType || "إجازة", createdSort: item.createdAt || item.startDate || "" })),
    ...(db.missions || []).map((item) => ({ ...item, kind: "mission", kindLabel: "مأمورية", label: item.title || item.destinationName || "مأمورية", createdSort: item.createdAt || item.plannedStart || "" })),
    ...(db.exceptions || []).map((item) => ({ ...item, kind: "exception", kindLabel: "استثناء حضور", label: item.title || "طلب تعديل حضور", createdSort: item.createdAt || "" })),
    ...(db.locationRequests || []).map((item) => ({ ...item, kind: "location", kindLabel: "طلب موقع", label: item.purpose || "طلب موقع", createdSort: item.requestedAt || item.createdAt || "" })),
  ];
  return scopedRowsByEmployee(db, rows)
    .map((item) => enrichByEmployee(db, item))
    .sort((a, b) => new Date(b.createdSort || b.createdAt || b.requestedAt || 0) - new Date(a.createdSort || a.createdAt || a.requestedAt || 0));
}

function workflowSummary(db) {
  const rows = workflowItems(db);
  const pending = rows.filter((item) => isPendingRequestStatus(item.status));
  const approved = rows.filter((item) => isApprovedRequestStatus(item.status));
  const rejected = rows.filter((item) => isRejectedRequestStatus(item.status));
  const stale = pending.filter((item) => (Date.now() - new Date(item.createdSort || item.createdAt || item.requestedAt || Date.now()).getTime()) > 48 * 60 * 60 * 1000);
  return {
    total: rows.length,
    pending: pending.length,
    approved: approved.length,
    rejected: rejected.length,
    stale: stale.length,
    latest: rows.slice(0, 8),
    byKind: ["leave", "mission", "exception", "location"].map((kind) => ({ kind, count: rows.filter((item) => item.kind === kind).length, pending: pending.filter((item) => item.kind === kind).length })),
  };
}

function systemReadiness(db) {
  const employees = (db.employees || []).filter((employee) => !employee.isDeleted);
  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE");
  const linkedUsers = (db.users || []).filter((user) => user.employeeId && findById(db.employees, user.employeeId));
  const rolesWithPermissions = (db.roles || []).filter((role) => Array.isArray(role.permissions) && role.permissions.length);
  const branchWithLocation = (db.branches || []).some((branch) => Number.isFinite(Number(branch.latitude)) && Number.isFinite(Number(branch.longitude)));
  const pendingRejectedPunches = (db.attendanceEvents || []).filter((event) => event.requiresReview || event.status === "REJECTED").length;
  const wf = workflowSummary(db);
  const parts = [
    { key: "employees", label: "ملفات الموظفين", ok: employees.length > 0, score: employees.length ? 15 : 0, detail: `${employees.length} ملف` },
    { key: "active", label: "الموظفون النشطون", ok: activeEmployees.length > 0, score: employees.length ? Math.round((activeEmployees.length / Math.max(1, employees.length)) * 15) : 0, detail: `${activeEmployees.length}/${employees.length}` },
    { key: "linked", label: "ربط الحسابات", ok: linkedUsers.length === (db.users || []).length, score: (db.users || []).length ? Math.round((linkedUsers.length / Math.max(1, (db.users || []).length)) * 20) : 0, detail: `${linkedUsers.length}/${(db.users || []).length}` },
    { key: "roles", label: "الأدوار والصلاحيات", ok: rolesWithPermissions.length === (db.roles || []).length, score: (db.roles || []).length ? Math.round((rolesWithPermissions.length / Math.max(1, (db.roles || []).length)) * 15) : 0, detail: `${rolesWithPermissions.length}/${(db.roles || []).length}` },
    { key: "location", label: "إحداثيات المجمع", ok: branchWithLocation, score: branchWithLocation ? 15 : 0, detail: branchWithLocation ? "مضبوطة" : "ناقصة" },
    { key: "workflow", label: "طلبات عالقة", ok: wf.stale === 0, score: wf.stale ? Math.max(0, 10 - wf.stale * 2) : 10, detail: `${wf.stale} طلب متأخر` },
    { key: "reviews", label: "مراجعات البصمة", ok: pendingRejectedPunches === 0, score: pendingRejectedPunches ? Math.max(0, 10 - pendingRejectedPunches) : 10, detail: `${pendingRejectedPunches} مراجعة` },
  ];
  const score = Math.max(0, Math.min(100, parts.reduce((sum, item) => sum + Number(item.score || 0), 0)));
  return { score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد جدًا" : score >= 60 ? "جيد" : "يحتاج ضبط", parts };
}

function employeeRequestSummary(db, employeeId) {
  const mine = workflowItems(db).filter((item) => !employeeId || item.employeeId === employeeId);
  return {
    pending: mine.filter((item) => isPendingRequestStatus(item.status)).length,
    approved: mine.filter((item) => isApprovedRequestStatus(item.status)).length,
    rejected: mine.filter((item) => isRejectedRequestStatus(item.status)).length,
    latest: mine.slice(0, 6),
  };
}

function normalizeLoginPhone(value) {
  let text = String(value || "").trim();
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  text = text.replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  let digits = text.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0020")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length >= 12) digits = "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("1")) digits = "0" + digits;
  return digits;
}

function loginMatches(user, identifier) {
  const raw = String(identifier || "").trim();
  const lowered = raw.toLowerCase();
  const phone = normalizeLoginPhone(raw);
  return [user.email, user.name, user.username].filter(Boolean).some((item) => String(item).toLowerCase() === lowered) || (phone && normalizeLoginPhone(user.phone) === phone);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function taskRows(db, filters = {}) {
  let rows = (db.tasks || []).map((task) => enrichByEmployee(db, task));
  const actor = currentUser(db);
  const actorEmployeeId = actor?.employeeId || actor?.employee?.id || "";
  if (!isFullAccessUser(db) && actorEmployeeId) rows = rows.filter((task) => task.employeeId === actorEmployeeId || task.assignedByEmployeeId === actorEmployeeId || canSeeEmployee(db, task.employeeId));
  if (filters.status) rows = rows.filter((task) => task.status === filters.status);
  if (filters.employeeId) rows = rows.filter((task) => task.employeeId === filters.employeeId);
  return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function documentRows(db, filters = {}) {
  let rows = (db.employeeDocuments || []).map((doc) => enrichByEmployee(db, doc));
  const actor = currentUser(db);
  const actorEmployeeId = actor?.employeeId || actor?.employee?.id || "";
  if (!isFullAccessUser(db) && actorEmployeeId) rows = rows.filter((doc) => doc.employeeId === actorEmployeeId || canSeeEmployee(db, doc.employeeId));
  if (filters.employeeId) rows = rows.filter((doc) => doc.employeeId === filters.employeeId);
  if (filters.status) rows = rows.filter((doc) => doc.status === filters.status);
  return rows.sort((a, b) => new Date(b.createdAt || b.expiresOn || 0) - new Date(a.createdAt || a.expiresOn || 0));
}

function policyRows(db, employeeId = "") {
  const policies = (db.employeePolicies || []).filter((item) => item.status !== "ARCHIVED");
  const acknowledgements = db.policyAcknowledgements || [];
  return policies.map((policy) => {
    const ack = acknowledgements.find((row) => row.policyId === policy.id && (!employeeId || row.employeeId === employeeId));
    return { ...policy, acknowledged: Boolean(ack), acknowledgedAt: ack?.acknowledgedAt || ack?.createdAt || "", acknowledgement: ack || null };
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function policySummary(db) {
  const employees = (db.employees || []).filter((employee) => !employee.isDeleted && employee.status === "ACTIVE");
  const policies = (db.employeePolicies || []).filter((policy) => policy.status === "ACTIVE" && policy.requiresAcknowledgement !== false);
  const totalRequired = employees.length * policies.length;
  const signed = (db.policyAcknowledgements || []).filter((ack) => policies.some((p) => p.id === ack.policyId) && employees.some((e) => e.id === ack.employeeId)).length;
  return { policies: policies.length, employees: employees.length, totalRequired, signed, missing: Math.max(0, totalRequired - signed), percent: totalRequired ? Math.round((signed / totalRequired) * 100) : 100 };
}

function detectOrgCycles(db) {
  const cycles = [];
  const byId = new Map((db.employees || []).map((employee) => [employee.id, employee]));
  for (const employee of db.employees || []) {
    const seen = new Set([employee.id]);
    let managerId = employee.managerEmployeeId;
    while (managerId) {
      if (seen.has(managerId)) { cycles.push(employee.id); break; }
      seen.add(managerId);
      managerId = byId.get(managerId)?.managerEmployeeId || "";
    }
  }
  return cycles;
}

function requestAgeHours(item) {
  const created = new Date(item.createdAt || item.requestedAt || item.startDate || item.plannedStart || Date.now());
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - created.getTime()) / 36e5));
}

function runWorkflowAutomation(db, options = {}) {
  const actor = currentUser(db);
  const thresholdHours = Number(options.thresholdHours || 48);
  const executiveId = "emp-executive-director";
  const secretaryId = "emp-executive-secretary";
  db.workflowEscalations ||= [];
  let escalated = 0;
  const rows = workflowItems(db).filter((item) => item.status === "PENDING" && requestAgeHours(item) >= thresholdHours);
  rows.forEach((row) => {
    const fingerprint = `${row.kind}:${row.id}`;
    if (db.workflowEscalations.some((item) => item.fingerprint === fingerprint && item.status !== "CLOSED")) return;
    const employee = findById(db.employees, row.employeeId);
    const targetIds = [employee?.managerEmployeeId, secretaryId, executiveId].filter(Boolean);
    const escalation = { id: makeId("esc"), fingerprint, sourceKind: row.kind, sourceId: row.id, employeeId: row.employeeId, targetEmployeeIds: [...new Set(targetIds)], reason: `طلب متأخر أكثر من ${thresholdHours} ساعة`, status: "OPEN", createdAt: now(), createdByUserId: actor?.id || "system" };
    db.workflowEscalations.unshift(escalation);
    const source = [db.leaves, db.missions, db.exceptions, db.locationRequests].flat().find((item) => item?.id === row.id);
    if (source) {
      source.slaStatus = "OVERDUE";
      source.escalatedAt ||= now();
      requestWorkflow(source, "sla_escalated", actor?.name || "النظام");
    }
    notifyManyEmployees(db, targetIds, "طلب متأخر يحتاج قرار", `${employee?.fullName || "موظف"}: ${row.kindLabel || row.kind}`, "ACTION_REQUIRED");
    escalated += 1;
  });
  audit(db, "workflow.automation", "workflow", "bulk", null, { thresholdHours, escalated });
  return { thresholdHours, checked: rows.length, escalated };
}

function runDataRepair(db, options = {}) {
  const actor = currentUser(db);
  const fixes = [];
  const defaultBranch = db.branches?.[0]?.id || "";
  const defaultDepartment = db.departments?.[0]?.id || "";
  const defaultRole = db.roles.find((role) => role.slug === "employee" || role.key === "EMPLOYEE")?.id || db.roles.at(-1)?.id;
  const emails = new Set();
  const phones = new Set();

  for (const employee of db.employees || []) {
    if (employee.isDeleted) continue;
    if (!employee.branchId && defaultBranch) { employee.branchId = defaultBranch; fixes.push(`تم ربط ${employee.fullName} بالفرع الافتراضي`); }
    if (!employee.departmentId && defaultDepartment) { employee.departmentId = defaultDepartment; fixes.push(`تم ربط ${employee.fullName} بالقسم الافتراضي`); }
    if (!employee.roleId && defaultRole) { employee.roleId = defaultRole; fixes.push(`تم تعيين دور افتراضي لـ ${employee.fullName}`); }
    if (employee.managerEmployeeId === employee.id) { employee.managerEmployeeId = ""; fixes.push(`تم حذف مدير ذاتي خاطئ من ${employee.fullName}`); }
    if (employee.email) {
      const key = normalizeEmail(employee.email);
      if (emails.has(key)) { employee.email = `emp.${employee.id}@ahla-shabab.local`; fixes.push(`تم إصلاح بريد مكرر لـ ${employee.fullName}`); }
      emails.add(normalizeEmail(employee.email));
    }
    if (employee.phone) {
      const key = normalizePhone(employee.phone);
      if (phones.has(key)) { employee.phone = `${key}-${employee.id.slice(-4)}`; fixes.push(`تم تمييز رقم هاتف مكرر لـ ${employee.fullName}`); }
      phones.add(normalizePhone(employee.phone));
    }
    const existingUser = (db.users || []).find((user) => user.employeeId === employee.id || user.id === employee.userId);
    if (!existingUser && options.createMissingUsers !== false) {
      const user = createUserRecord(db, { ...employee, employeeId: employee.id, temporaryPassword: true, password: "" });
      employee.userId = user.id;
      fixes.push(`تم إنشاء حساب دخول مؤقت لـ ${employee.fullName}`);
    } else if (existingUser) {
      employee.userId = existingUser.id;
      existingUser.employeeId = employee.id;
      existingUser.name ||= employee.fullName;
      existingUser.fullName ||= employee.fullName;
      existingUser.phone ||= employee.phone;
      existingUser.email ||= inferEmail(db, {}, employee);
      existingUser.roleId ||= employee.roleId;
    }
  }

  const cycles = detectOrgCycles(db);
  cycles.forEach((employeeId) => {
    const employee = findById(db.employees, employeeId);
    if (employee) { employee.managerEmployeeId = ""; fixes.push(`تم فصل حلقة إدارية خاطئة عند ${employee.fullName}`); }
  });

  db.users ||= [];
  for (const user of db.users) {
    if (user.employeeId && !findById(db.employees, user.employeeId)) {
      user.status = "DISABLED";
      fixes.push(`تم تعطيل مستخدم غير مربوط بموظف: ${user.email || user.name}`);
    }
    if (!user.roleId && defaultRole) user.roleId = defaultRole;
  }

  db.leaveBalances ||= [];
  for (const employee of (db.employees || []).filter((item) => !item.isDeleted)) {
    if (!db.leaveBalances.some((row) => row.employeeId === employee.id)) {
      db.leaveBalances.push({ id: makeId("lb"), employeeId: employee.id, annualTotal: 21, casualTotal: 7, sickTotal: 15, usedDays: 0, remainingDays: 28, notes: "تم الإنشاء تلقائيًا من مركز الجودة", updatedAt: now() });
      fixes.push(`تم إنشاء رصيد إجازات لـ ${employee.fullName}`);
    }
  }

  const repairRoleProfiles = {
    "role-admin": ["*"],
    "role-hr": ["dashboard:view", "employees:view", "employees:write", "users:manage", "attendance:manage", "attendance:review", "attendance:rules", "attendance:smart", "requests:approve", "leave:balance", "documents:manage", "reports:export", "reports:pdf", "reports:excel", "kpi:hr", "kpi:monthly", "kpi:manage", "daily-report:review", "disputes:committee", "disputes:manage", "disputes:escalate", "disputes:minutes", "notifications:manage", "decisions:manage", "attendance:risk", "policies:self", "hr:operations", "team:dashboard", "reports:monthly-pdf-auto"],
    "role-executive": ["dashboard:view", "employees:view", "reports:export", "reports:pdf", "reports:excel", "executive:report", "executive:mobile", "executive:presence-map", "live-location:request", "attendance:risk", "decisions:manage", "reports:monthly-pdf-auto", "sensitive-actions:approve", "approvals:manage", "alerts:manage", "control-room:view", "daily-report:review", "kpi:executive", "kpi:final-approve", "disputes:escalate"],
    "role-executive-secretary": ["*"],
  };
  for (const role of db.roles || []) {
    if (repairRoleProfiles[role.id]) role.permissions = repairRoleProfiles[role.id];
  }

  audit(db, "maintenance.repair", "system", "local-db", null, { fixes: fixes.length, actor: actor?.id || "system" });
  return { fixes, fixed: fixes.length };
}

function deepReadiness(db) {
  const base = systemReadiness(db);
  const cycles = detectOrgCycles(db);
  const policy = policySummary(db);
  const employees = (db.employees || []).filter((e) => !e.isDeleted);
  const users = db.users || [];
  const missingUsers = employees.filter((employee) => !users.some((user) => user.employeeId === employee.id));
  const pendingWorkflow = workflowItems(db).filter((item) => item.status === "PENDING");
  const staleWorkflow = pendingWorkflow.filter((item) => requestAgeHours(item) >= 48);
  const expiringDocs = (db.employeeDocuments || []).filter((doc) => doc.expiresOn && new Date(doc.expiresOn) <= addDays(new Date(), 30));
  const issues = [
    ...missingUsers.map((employee) => ({ severity: "HIGH", area: "users", title: "موظف بلا حساب دخول", detail: employee.fullName })),
    ...cycles.map((employeeId) => ({ severity: "HIGH", area: "org", title: "حلقة إدارية خاطئة", detail: findById(db.employees, employeeId)?.fullName || employeeId })),
    ...staleWorkflow.map((item) => ({ severity: "MEDIUM", area: "workflow", title: "طلب متأخر عن الاعتماد", detail: `${item.kindLabel || item.kind} - ${findById(db.employees, item.employeeId)?.fullName || item.employeeId}` })),
    ...expiringDocs.map((doc) => ({ severity: "MEDIUM", area: "documents", title: "مستند قرب الانتهاء", detail: `${doc.title} - ${findById(db.employees, doc.employeeId)?.fullName || ""}` })),
    ...(policy.missing ? [{ severity: "LOW", area: "policies", title: "سياسات غير موقعة بالكامل", detail: `${policy.signed}/${policy.totalRequired}` }] : []),
  ];
  const score = Math.max(0, Math.min(100, base.score - issues.filter((i) => i.severity === "HIGH").length * 8 - issues.filter((i) => i.severity === "MEDIUM").length * 3 - issues.filter((i) => i.severity === "LOW").length));
  return { ...base, score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد جدًا" : score >= 60 ? "جيد" : "يحتاج إصلاح", issues, policy, missingUsers: missingUsers.length, staleWorkflow: staleWorkflow.length, orgCycles: cycles.length, expiringDocuments: expiringDocs.length };
}

function defaultLeaveBalance(db, employee) {
  const used = (db.leaves || []).filter((leave) => leave.employeeId === employee.id && leave.status === "APPROVED").reduce((sum, leave) => {
    const start = new Date(leave.startDate || leave.start_at || Date.now());
    const end = new Date(leave.endDate || leave.end_at || leave.startDate || Date.now());
    const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
    return sum + days;
  }, 0);
  const existing = (db.leaveBalances || []).find((row) => row.employeeId === employee.id) || {};
  const annual = Number(existing.annualTotal ?? 21);
  const casual = Number(existing.casualTotal ?? 7);
  const sick = Number(existing.sickTotal ?? 15);
  return { id: existing.id || `lb-${employee.id}`, employeeId: employee.id, employee: enrichEmployee(db, employee), annualTotal: annual, casualTotal: casual, sickTotal: sick, usedDays: Number(existing.usedDays ?? used), remainingDays: Math.max(0, Number(existing.remainingDays ?? (annual + casual - used))), updatedAt: existing.updatedAt || now() };
}

function executiveSnapshot(db) {
  const employees = visibleEmployees(db);
  const active = employees.filter((e) => e.status === "ACTIVE");
  const workflow = workflowSummary(db);
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = (db.attendanceEvents || []).filter((event) => String(event.eventAt || event.createdAt || "").slice(0, 10) === today);
  const disputes = db.disputeCases || [];
  const openDisputes = disputes.filter((item) => !["CLOSED", "RESOLVED", "REJECTED"].includes(item.status));
  const tasks = db.tasks || [];
  const overdueTasks = tasks.filter((task) => task.status !== "DONE" && task.dueDate && new Date(task.dueDate) < new Date(today));
  const documentsExpiring = (db.employeeDocuments || []).filter((doc) => doc.expiresOn && new Date(doc.expiresOn) <= addDays(new Date(), 30));
  return {
    generatedAt: now(),
    readiness: systemReadiness(db),
    cards: {
      employees: employees.length,
      activeEmployees: active.length,
      presentToday: todayEvents.filter((e) => e.type === "CHECK_IN").length,
      pendingRequests: workflow.pending,
      openDisputes: openDisputes.length,
      overdueTasks: overdueTasks.length,
      expiringDocuments: documentsExpiring.length,
    },
    workflow,
    openDisputes: openDisputes.slice(0, 8).map((item) => enrichByEmployee(db, item)),
    overdueTasks: overdueTasks.slice(0, 8).map((item) => enrichByEmployee(db, item)),
    documentsExpiring: documentsExpiring.slice(0, 8).map((item) => enrichByEmployee(db, item)),
    managerPerformance: employees.filter((e) => (db.employees || []).some((child) => child.managerEmployeeId === e.id)).map((manager) => {
      const team = employees.filter((e) => e.managerEmployeeId === manager.id);
      const teamIds = team.map((e) => e.id);
      return { manager: enrichEmployee(db, manager), teamCount: team.length, pendingRequests: workflowItems(db).filter((item) => teamIds.includes(item.employeeId) && item.status === "PENDING").length, openTasks: tasks.filter((task) => teamIds.includes(task.employeeId) && task.status !== "DONE").length };
    }),
  };
}

function smartAlertRows(db) {
  db.smartAlerts ||= [];
  const existing = new Map(db.smartAlerts.map((alert) => [alert.fingerprint, alert]));
  const generated = [];
  const push = (fingerprint, severity, title, body, route = "quality-center", targetEmployeeIds = []) => {
    const old = existing.get(fingerprint);
    const row = old || { id: makeId("alert"), fingerprint, createdAt: now(), status: "OPEN" };
    Object.assign(row, { severity, title, body, route, targetEmployeeIds, updatedAt: now() });
    generated.push(row);
  };
  const readiness = deepReadiness(db);
  for (const issue of readiness.issues || []) push(`issue:${issue.area}:${issue.title}:${issue.detail}`, issue.severity || "MEDIUM", issue.title, issue.detail || "", issue.area === "documents" ? "documents" : issue.area === "users" ? "employees" : "quality-center");
  for (const item of workflowItems(db).filter((row) => row.status === "PENDING" && requestAgeHours(row) >= 48)) {
    const emp = findById(db.employees, item.employeeId);
    push(`sla:${item.kind}:${item.id}`, "HIGH", "طلب متأخر عن SLA", `${emp?.fullName || "موظف"} - ${item.kindLabel || item.kind}`, "requests", [emp?.managerEmployeeId, "emp-executive-secretary", "emp-executive-director"].filter(Boolean));
  }
  for (const doc of (db.employeeDocuments || []).filter((item) => item.expiresOn && new Date(item.expiresOn) <= new Date(Date.now() + 14 * 864e5))) {
    const emp = findById(db.employees, doc.employeeId);
    push(`doc-expire:${doc.id}`, "MEDIUM", "مستند ينتهي قريبًا", `${doc.title || "مستند"} - ${emp?.fullName || ""}`, "documents", [doc.employeeId].filter(Boolean));
  }
  const openKeys = new Set(generated.map((row) => row.fingerprint));
  db.smartAlerts = [
    ...generated,
    ...db.smartAlerts.filter((row) => row.status !== "OPEN" || !openKeys.has(row.fingerprint)),
  ].sort((a, b) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[b.severity] || 0) - ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[a.severity] || 0) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)).slice(0, 300);
  return db.smartAlerts;
}

function controlRoomSnapshot(db) {
  const alerts = smartAlertRows(db);
  const requests = workflowItems(db);
  const pendingReports = (db.dailyReports || []).filter((row) => row.status === "SUBMITTED");
  const today = new Date().toISOString().slice(0, 10);
  const todayReports = (db.dailyReports || []).filter((row) => row.reportDate === today);
  const openTasks = (db.tasks || []).filter((task) => !["DONE", "CLOSED", "CANCELLED"].includes(task.status));
  const stale = requests.filter((row) => row.status === "PENDING" && requestAgeHours(row) >= 48);
  const readiness = deepReadiness(db);
  return {
    cards: {
      readiness: readiness.score,
      openAlerts: alerts.filter((row) => row.status === "OPEN").length,
      highAlerts: alerts.filter((row) => row.status === "OPEN" && ["HIGH", "CRITICAL"].includes(row.severity)).length,
      staleRequests: stale.length,
      openTasks: openTasks.length,
      todayReports: todayReports.length,
      pendingReports: pendingReports.length,
    },
    readiness,
    alerts: alerts.slice(0, 80),
    staleRequests: stale.slice(0, 40),
    openTasks: openTasks.slice(0, 40).map((task) => enrichByEmployee(db, task)),
    dailyReports: (db.dailyReports || []).slice(0, 40).map((row) => enrichByEmployee(db, row)),
  };
}

function exportPortableData(db) {
  const snapshot = clone(db);
  for (const user of snapshot.users || []) if (user.password) user.password = "***";
  if (snapshot.credentialVault) snapshot.credentialVault = snapshot.credentialVault.map((item) => ({ ...item, temporaryPassword: "***" }));
  snapshot.exportedAt = now();
  snapshot.exportVersion = 2;
  return snapshot;
}

function validatePortableImport(payload = {}) {
  const issues = [];
  const warnings = [];
  if (!payload || typeof payload !== "object") issues.push("الملف ليس JSON صالحًا للنظام.");
  if (!Array.isArray(payload.employees)) issues.push("لا يوجد employees[] داخل الملف.");
  if (!Array.isArray(payload.users)) warnings.push("لا يوجد users[]؛ سيتم الاعتماد على الموجود أو إنشاء حسابات لاحقًا.");
  const ids = new Set();
  for (const employee of payload.employees || []) {
    if (!employee.id) warnings.push(`موظف بدون ID: ${employee.fullName || employee.name || "غير معروف"}`);
    if (employee.id && ids.has(employee.id)) issues.push(`ID موظف مكرر: ${employee.id}`);
    if (employee.id) ids.add(employee.id);
    if (employee.managerEmployeeId && employee.managerEmployeeId === employee.id) issues.push(`الموظف مدير نفسه: ${employee.fullName || employee.id}`);
  }
  return { ok: issues.length === 0, issues, warnings, employees: (payload.employees || []).length, users: (payload.users || []).length };
}

function dailyReportRows(db, filters = {}) {
  let rows = (db.dailyReports || []).map((row) => enrichByEmployee(db, row));
  if (filters.employeeId) rows = rows.filter((row) => row.employeeId === filters.employeeId);
  if (filters.status) rows = rows.filter((row) => row.status === filters.status);
  return rows.sort((a, b) => new Date(b.reportDate || b.createdAt || 0) - new Date(a.reportDate || a.createdAt || 0));
}

function latestByDate(rows = [], dateFields = ["createdAt"]) {
  return [...rows].sort((a, b) => {
    const av = dateFields.map((key) => a?.[key]).find(Boolean) || 0;
    const bv = dateFields.map((key) => b?.[key]).find(Boolean) || 0;
    return new Date(bv).getTime() - new Date(av).getTime();
  })[0] || null;
}

function executiveTodayForEmployee(db, employeeId) {
  const day = now().slice(0, 10);
  const events = (db.attendanceEvents || [])
    .filter((event) => event.employeeId === employeeId && String(event.eventAt || event.createdAt || "").slice(0, 10) === day)
    .sort((a, b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
  const checkIn = events.find((event) => ["CHECK_IN", "check_in", "checkIn"].includes(event.type || event.action));
  const checkOut = [...events].reverse().find((event) => ["CHECK_OUT", "check_out", "checkOut"].includes(event.type || event.action));
  const leave = (db.leaves || []).find((item) => item.employeeId === employeeId && item.status === "APPROVED" && String(item.startDate || "").slice(0,10) <= day && String(item.endDate || item.startDate || "").slice(0,10) >= day);
  const mission = (db.missions || []).find((item) => item.employeeId === employeeId && ["APPROVED", "IN_PROGRESS"].includes(item.status) && String(item.plannedStart || item.startDate || "").slice(0,10) <= day && String(item.plannedEnd || item.endDate || item.plannedStart || "").slice(0,10) >= day);
  const latestLocation = latestByDate([
    ...(db.locations || []).filter((loc) => loc.employeeId === employeeId),
    ...(db.liveLocationResponses || []).filter((row) => row.employeeId === employeeId && row.status === "APPROVED"),
  ], ["capturedAt", "respondedAt", "date", "createdAt"]);
  const pendingLiveRequest = latestByDate((db.liveLocationRequests || []).filter((row) => row.employeeId === employeeId && row.status === "PENDING"), ["createdAt", "expiresAt"]);
  let status = "ABSENT";
  if (leave) status = "ON_LEAVE";
  else if (mission && !checkIn) status = "ON_MISSION";
  else if (checkIn && checkOut) status = "CHECKED_OUT";
  else if (checkIn) status = String(checkIn.status || checkIn.dailyStatus || "PRESENT").includes("LATE") ? "LATE" : "PRESENT";
  return { day, status, checkInAt: checkIn?.eventAt || checkIn?.createdAt || "", checkOutAt: checkOut?.eventAt || checkOut?.createdAt || "", checkIn, checkOut, leave, mission, latestLocation, pendingLiveRequest, events };
}

function executiveEmployeeCard(db, employee) {
  return { ...enrichEmployee(db, employee), today: executiveTodayForEmployee(db, employee.id) };
}

function attendanceRiskForEmployee(db, employee, { days = 7 } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(days || 7)) * 86400000);
  const events = (db.attendanceEvents || [])
    .filter((event) => event.employeeId === employee.id && new Date(event.eventAt || event.createdAt || 0) >= since)
    .sort((a, b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
  const flags = [];
  const deviceIds = new Set(events.map((event) => event.deviceId || event.deviceFingerprint || event.clientId || event.userAgent).filter(Boolean));
  if (deviceIds.size > 1) flags.push({ code: "NEW_DEVICE", label: "جهاز جديد أو أكثر", points: 20 });
  const outside = events.filter((event) => ["outside_branch", "geofence_miss", "location_low_accuracy", "permission_denied", "location_unavailable"].includes(event.geofenceStatus) || event.requiresReview);
  if (outside.length) flags.push({ code: "OUT_OF_RANGE", label: `بصمات خارج النطاق/ضعيفة: ${outside.length}`, points: Math.min(35, outside.length * 10) });
  let duplicateCount = 0;
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const cur = events[i];
    const sameType = String(prev.type || prev.action || "") === String(cur.type || cur.action || "");
    const gap = Math.abs(new Date(cur.eventAt || cur.createdAt || 0) - new Date(prev.eventAt || prev.createdAt || 0)) / 60000;
    if (sameType && gap <= 10) duplicateCount += 1;
  }
  if (duplicateCount) flags.push({ code: "DUPLICATE_PUNCH", label: `تكرار بصمة سريع: ${duplicateCount}`, points: Math.min(30, duplicateCount * 15) });
  const far = events.filter((event) => Number(event.distanceMeters || event.distanceFromBranchMeters || 0) >= 1000);
  if (far.length) flags.push({ code: "FAR_DISTANCE", label: `حضور من مسافة بعيدة: ${far.length}`, points: Math.min(35, far.length * 12) });
  const missingLocation = events.filter((event) => !event.latitude && !event.location?.latitude && ["CHECK_IN", "CHECK_OUT"].includes(event.type || event.action));
  if (missingLocation.length) flags.push({ code: "MISSING_LOCATION", label: `بصمة بدون موقع: ${missingLocation.length}`, points: Math.min(25, missingLocation.length * 8) });
  const score = Math.min(100, flags.reduce((sum, flag) => sum + Number(flag.points || 0), 0));
  const level = score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : score > 0 ? "LOW" : "CLEAR";
  return { employeeId: employee.id, employee: enrichEmployee(db, employee), score, level, flags, events: events.slice(-12).reverse(), generatedAt: now() };
}

function buildAttendanceRiskCenter(db, options = {}) {
  const days = Number(options.days || 7);
  const rows = visibleEmployees(db).map((employee) => attendanceRiskForEmployee(db, employee, { days })).sort((a, b) => b.score - a.score);
  const counts = rows.reduce((acc, row) => { acc.total += 1; acc[row.level] = (acc[row.level] || 0) + 1; return acc; }, { total: 0, HIGH: 0, MEDIUM: 0, LOW: 0, CLEAR: 0 });
  return { days, counts, rows, generatedAt: now(), rules: ["تكرار بصمة خلال 10 دقائق", "خروج عن نطاق الفرع", "جهاز جديد", "حضور من مسافة بعيدة", "بصمة بدون موقع GPS"] };
}

function managerEmployeeIds(db) {
  const managerIds = new Set((db.employees || [])
    .filter((employee) => !employee.isDeleted && (employee.roleId === "role-manager" || employee.roleId === "role-hr" || employee.roleId === "role-executive" || employee.roleId === "role-executive-secretary"))
    .map((employee) => employee.id));
  (db.employees || []).forEach((employee) => {
    if (!employee.isDeleted && employee.managerEmployeeId) managerIds.add(employee.managerEmployeeId);
  });
  return [...managerIds].filter((id) => findById(db.employees || [], id));
}

function decisionVisibleToEmployee(decision, employeeId, db = null) {
  const scope = decision.scope || "ALL";
  if (scope === "ALL") return true;
  if (scope === "EMPLOYEES") return true;
  if (scope === "MANAGERS") return db ? managerEmployeeIds(db).includes(employeeId) : Array.isArray(decision.targetEmployeeIds) && decision.targetEmployeeIds.includes(employeeId);
  if (scope === "TEAM") return Array.isArray(decision.targetEmployeeIds) && decision.targetEmployeeIds.includes(employeeId);
  if (scope === "SELECTED") return Array.isArray(decision.targetEmployeeIds) && decision.targetEmployeeIds.includes(employeeId);
  return true;
}

function decisionRowsForCurrentUser(db) {
  const user = currentUser(db);
  const employeeId = user?.employeeId || user?.employee?.id || "";
  const rows = (db.adminDecisions || []).filter((row) => row.status !== "DRAFT" && (!employeeId || decisionVisibleToEmployee(row, employeeId, db)));
  return rows.map((decision) => {
    const ack = (db.adminDecisionAcknowledgements || []).find((item) => item.decisionId === decision.id && item.employeeId === employeeId);
    return { ...decision, acknowledged: Boolean(ack), acknowledgedAt: ack?.acknowledgedAt || "", acknowledgement: ack || null };
  }).sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
}

function buildMonthlyAutoPdfReports(db, { month = now().slice(0, 7), scope = "all" } = {}) {
  const attendance = monthlyAttendanceSummary(db, month);
  const evaluations = (db.kpiEvaluations || []).filter((row) => String(row.cycleId || row.month || row.periodMonth || "").startsWith(month));
  const disputes = (db.disputeCases || []).filter((row) => String(row.createdAt || "").startsWith(month));
  const requests = workflowItems(db).filter((row) => String(row.createdAt || "").startsWith(month));
  const managerRows = visibleEmployees(db)
    .filter((employee) => (db.employees || []).some((child) => child.managerEmployeeId === employee.id && !child.isDeleted))
    .map((manager) => {
      const teamIds = (db.employees || []).filter((employee) => employee.managerEmployeeId === manager.id && !employee.isDeleted).map((employee) => employee.id);
      return { manager, teamCount: teamIds.length, attendanceRows: (attendance.rows || []).filter((row) => teamIds.includes(row.employeeId)), kpiRows: evaluations.filter((row) => teamIds.includes(row.employeeId)), disputes: disputes.filter((row) => teamIds.includes(row.employeeId)), requests: requests.filter((row) => teamIds.includes(row.employeeId)) };
    });
  return { month, scope, generatedAt: now(), status: "READY", attendance, evaluations, disputes, requests, managers: managerRows, title: `التقارير الشهرية PDF — ${month}` };
}

function liveRequestVisibleToEmployee(request, employeeId) {
  return request.employeeId === employeeId || request.requestedByEmployeeId === employeeId;
}

function nextEmployeeCode(db) {
  const max = (db.employees || [])
    .map((employee) => String(employee.employeeCode || '').match(/(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number)
    .reduce((highest, value) => Math.max(highest, value), 0);
  return `EMP-${String(max + 1).padStart(3, '0')}`;
}

function defaultEmployeeRoleId(db) {
  return db.roles.find((role) => role.slug === 'employee' || role.key === 'EMPLOYEE')?.id || 'role-employee';
}

function hrCommitteeEmployeeIds(db) {
  const configured = db.disputeCommittee?.employeeIds;
  if (Array.isArray(configured) && configured.length) return configured.filter(Boolean);
  return ['emp-executive-secretary', 'emp-direct-manager-01', 'emp-direct-manager-02', 'emp-hr-manager']
    .filter((id) => findById(db.employees || [], id));
}

function kpiStageLabel(status = '') {
  return {
    DRAFT: 'مسودة',
    SELF_SUBMITTED: 'مرسل من الموظف',
    MANAGER_APPROVED: 'اعتماد المدير المباشر',
    HR_REVIEWED: 'مراجعة الموارد البشرية',
    SECRETARY_REVIEWED: 'مراجعة السكرتير التنفيذي',
    EXECUTIVE_APPROVED: 'اعتماد المدير التنفيذي',
    REJECTED: 'مرفوض/يحتاج تعديل',
    APPROVED: 'معتمد نهائيًا',
  }[status] || status || 'مسودة';
}

function kpiWindowInfo(db, cycle = currentKpiCycle(db), at = new Date()) {
  const policy = db.kpiPolicy || {};
  const startDay = Number(policy.evaluationStartDay || 20);
  const endDay = Number(policy.evaluationEndDay || 25);
  const deadlineDay = Number(policy.submissionDeadlineDay || endDay);
  const base = at instanceof Date ? at : new Date(at);
  const y = base.getFullYear();
  const m = base.getMonth();
  const startsAt = new Date(y, m, startDay, 0, 0, 0);
  const endsAt = new Date(y, m, endDay, 23, 59, 59);
  const deadlineAt = new Date(y, m, deadlineDay, 23, 59, 59);
  const hardCloseAt = new Date(y, m, deadlineDay + 3, 23, 59, 59);
  const isBefore = base < startsAt;
  const isOpen = base >= startsAt && base <= deadlineAt;
  const isLate = base > deadlineAt && base <= hardCloseAt;
  const isClosed = base > hardCloseAt || ['LOCKED', 'CLOSED', 'FINALIZED'].includes(String(cycle.status || '').toUpperCase());
  const daysToStart = Math.max(0, Math.ceil((startsAt - base) / 86400000));
  const daysToDeadline = Math.max(0, Math.ceil((deadlineAt - base) / 86400000));
  return {
    startDay, endDay, deadlineDay,
    startsOn: startsAt.toISOString().slice(0, 10),
    endsOn: endsAt.toISOString().slice(0, 10),
    dueOn: deadlineAt.toISOString().slice(0, 10),
    isBefore, isOpen, isLate, isClosed,
    status: isClosed ? 'CLOSED' : isLate ? 'LATE_REVIEW' : isOpen ? 'OPEN' : 'NOT_OPEN',
    label: isClosed ? 'مغلقة' : isLate ? 'مراجعة متأخرة' : isOpen ? 'مفتوحة الآن' : `تفتح بعد ${daysToStart} يوم`,
    daysToStart,
    daysToDeadline,
    message: isOpen ? `التقييم مفتوح حتى يوم ${deadlineDay} من الشهر.` : isLate ? 'انتهى موعد تسليم الموظف/المدير، ومتاح استكمال HR والسكرتير والتنفيذي.' : isClosed ? 'الدورة مغلقة ولا يراجعها إلا صاحب الصلاحية الكاملة.' : `نافذة التقييم تبدأ يوم ${startDay} من الشهر.`,
  };
}

function kpiProgressMetrics(evaluations = [], pendingEmployees = []) {
  const byStatus = (status) => evaluations.filter((item) => String(item.status || 'DRAFT') === status).length;
  const finalCount = evaluations.filter((item) => ['EXECUTIVE_APPROVED', 'APPROVED'].includes(String(item.status || ''))).length;
  return [
    { label: 'لم يبدأوا', value: pendingEmployees.length, helper: 'موظفون بلا تقييم في الدورة' },
    { label: 'بانتظار المدير', value: byStatus('SELF_SUBMITTED'), helper: 'مرسل من الموظف' },
    { label: 'بانتظار HR', value: byStatus('MANAGER_APPROVED'), helper: 'اعتماد المدير تم' },
    { label: 'بانتظار السكرتير', value: byStatus('HR_REVIEWED'), helper: 'مراجعة HR تمت' },
    { label: 'بانتظار التنفيذي', value: byStatus('SECRETARY_REVIEWED'), helper: 'مراجعة السكرتير تمت' },
    { label: 'اعتماد نهائي', value: finalCount, helper: 'تم اعتماد النتيجة' },
  ];
}

function assertKpiSubmitAllowed(db, mode, cycle = currentKpiCycle(db)) {
  const windowInfo = kpiWindowInfo(db, cycle);
  if (isFullAccessUser(db)) return windowInfo;
  if (mode === 'manager') {
    if (!windowInfo.isOpen) throw new Error(`تقييم المدير متاح فقط من يوم ${windowInfo.startDay} إلى يوم ${windowInfo.deadlineDay} من كل شهر. الحالة الحالية: ${windowInfo.label}.`);
  }
  if (mode === 'hr' && windowInfo.isBefore) throw new Error('مراجعة HR تبدأ بعد فتح دورة التقييم يوم 20 من الشهر.');
  return windowInfo;
}

function directTeamFor(db, managerId) {
  return (db.employees || []).filter((employee) => !employee.isDeleted && employee.managerEmployeeId === managerId).map((employee) => enrichEmployee(db, employee));
}

function allTeamFor(db, managerId) {
  const out = [];
  const queue = [managerId];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const employee of db.employees || []) {
      if (employee.isDeleted || employee.managerEmployeeId !== id || seen.has(employee.id)) continue;
      seen.add(employee.id);
      out.push(enrichEmployee(db, employee));
      queue.push(employee.id);
    }
  }
  return out;
}

function managerCandidates(db) {
  return (db.employees || [])
    .filter((employee) => !employee.isDeleted && (employee.roleId === "role-manager" || employee.roleId === "role-hr" || employee.roleId === "role-executive" || employee.roleId === "role-executive-secretary"))
    .map((employee) => enrichEmployee(db, employee));
}

function employeeKpiStatus(db, employeeId) {
  const cycle = currentKpiCycle(db);
  const row = (db.kpiEvaluations || []).find((item) => item.employeeId === employeeId && item.cycleId === cycle.id);
  return row?.status || "DRAFT";
}

function pendingCountForEmployee(db, employeeId) {
  return workflowItems(db).filter((item) => item.employeeId === employeeId && ["PENDING", "IN_REVIEW", "OPEN"].includes(item.status)).length;
}

function todayStatusForEmployee(db, employeeId) {
  const event = todayEventsByEmployee(db).get(employeeId);
  return { status: event?.status || event?.type || "ABSENT", at: event?.eventAt || event?.createdAt || "" };
}

const localEndpoints = {

  adminAccessLog: async (body = {}) => {
    const db = loadDb();
    db.adminAccessLogs ||= [];
    const actor = currentUser(db);
    const item = { id: makeId("adminlog"), actorUserId: actor?.id || body.userId || "", actorEmployeeId: actor?.employeeId || body.employeeId || "", action: body.action || "admin.gateway", route: body.route || location.hash || "", result: body.result || "INFO", userAgent: navigator.userAgent || "", createdAt: now(), metadata: body.metadata || {} };
    db.adminAccessLogs.unshift(item);
    db.adminAccessLogs = db.adminAccessLogs.slice(0, 1000);
    audit(db, "admin.access", "admin_access_log", item.id, null, item);
    saveDb(db);
    return ok(item);
  },
  sensitiveApprovals: async () => {
    const db = loadDb();
    return ok(sensitiveApprovalSummary(db));
  },
  createSensitiveApproval: async (body = {}) => {
    const db = loadDb();
    const item = createSensitiveApprovalRecord(db, body);
    saveDb(db);
    return ok(item);
  },
  decideSensitiveApproval: async (id, body = {}) => {
    const db = loadDb();
    const approval = findById(db.sensitiveApprovals || [], id);
    if (!approval) throw new Error("طلب الاعتماد غير موجود.");
    if (!isExecutiveAuthority(db)) throw new Error("هذا الإجراء يحتاج المدير التنفيذي أو التقني صاحب الصلاحية.");
    const before = clone(approval);
    const decision = body.decision === "reject" || body.status === "REJECTED" ? "REJECTED" : "APPROVED";
    approval.status = decision;
    approval.decidedAt = now();
    approval.decidedByUserId = currentUser(db)?.id || "system";
    approval.decisionNote = body.note || body.reason || "";
    approval.workflow ||= [];
    approval.workflow.unshift({ at: now(), by: currentUser(db)?.name || "النظام", action: decision.toLowerCase(), note: approval.decisionNote });
    audit(db, "sensitive_approval.decision", "sensitive_approval", id, before, approval);
    const result = decision === "APPROVED" && body.execute !== false ? executeApprovedSensitiveAction(db, approval) : { executed: false };
    saveDb(db);
    return ok({ approval, result });
  },
  executivePresenceSnapshot: async () => {
    const db = loadDb();
    const snapshot = executivePresenceSnapshot(db);
    db.executivePresenceSnapshots ||= [];
    db.executivePresenceSnapshots.unshift({ id: makeId("presence"), ...snapshot });
    db.executivePresenceSnapshots = db.executivePresenceSnapshots.slice(0, 30);
    saveDb(db);
    return ok(snapshot);
  },
  executivePresenceDashboard: async () => {
    const db = loadDb();
    const snapshot = executivePresenceSnapshot(db);
    const rows = snapshot.rows.map((row) => ({
      ...row,
      risk: attendanceRiskForEmployee(db, row.employee || findById(db.employees || [], row.employeeId) || { id: row.employeeId }, { days: 7 }),
      locationStatus: row.lastLocation?.latitude && row.lastLocation?.longitude ? "LIVE_SHARED" : "LOCATION_MISSING",
      mapUrl: row.lastLocation?.latitude && row.lastLocation?.longitude ? `https://www.google.com/maps?q=${row.lastLocation.latitude},${row.lastLocation.longitude}` : "",
    }));
    const missingLocation = rows.filter((row) => !row.lastLocation?.latitude && ["PRESENT", "LATE", "CHECKED_OUT"].includes(row.status)).length;
    const outOfRange = rows.filter((row) => row.risk?.flags?.some((flag) => flag.code === "OUT_OF_RANGE")).length;
    return ok({ ...snapshot, rows, counts: { ...snapshot.counts, missingLocation, outOfRange }, generatedAt: now() });
  },
  attendanceRiskCenter: async (options = {}) => {
    const db = loadDb();
    const center = buildAttendanceRiskCenter(db, options);
    db.attendanceRiskRuns ||= [];
    db.attendanceRiskRuns.unshift({ id: makeId("riskrun"), days: center.days, counts: center.counts, createdAt: now(), createdByUserId: currentUser(db)?.id || "system" });
    db.attendanceRiskRuns = db.attendanceRiskRuns.slice(0, 100);
    saveDb(db);
    return ok(center);
  },
  adminDecisions: async () => {
    const db = loadDb();
    if (hasLocalScope(db, "decisions:manage") || hasLocalScope(db, "executive:report") || hasLocalScope(db, "notifications:manage")) {
      return ok({ decisions: (db.adminDecisions || []).map((decision) => ({ ...decision, acknowledgements: (db.adminDecisionAcknowledgements || []).filter((ack) => ack.decisionId === decision.id) })).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) });
    }
    return ok({ decisions: decisionRowsForCurrentUser(db) });
  },
  createAdminDecision: async (body = {}) => {
    const db = loadDb();
    if (!hasLocalScope(db, "decisions:manage") && !hasLocalScope(db, "notifications:manage") && !hasLocalScope(db, "executive:report")) throw new Error("لا تملك صلاحية إصدار قرار إداري.");
    db.adminDecisions ||= [];
    const actor = currentUser(db);
    const targetEmployeeIds = Array.isArray(body.targetEmployeeIds) ? body.targetEmployeeIds.filter(Boolean) : String(body.targetEmployeeIds || "").split(/[،,\s]+/).filter(Boolean);
    const scope = body.scope || (targetEmployeeIds.length ? "SELECTED" : "ALL");
    const issuerName = body.issuedByName || actor?.fullName || actor?.name || "الإدارة";
    const issuerTitle = body.issuedByTitle || actor?.employee?.jobTitle || "";
    const issuerPrefix = body.issuerPrefix || `قرار إداري من ${issuerName}${issuerTitle ? ` ${issuerTitle}` : ""}`;
    const decision = { id: makeId("decision"), title: body.title || "قرار إداري", body: body.body || body.description || "", category: body.category || "ADMINISTRATIVE", priority: body.priority || "MEDIUM", scope, targetEmployeeIds, requiresAcknowledgement: body.requiresAcknowledgement !== false && body.requiresAcknowledgement !== "false", status: body.status || "PUBLISHED", issuedByUserId: actor?.id || "system", issuedByEmployeeId: actor?.employeeId || "", issuedByName: issuerName, issuedByTitle: issuerTitle, issuerPrefix, publishedAt: now(), createdAt: now(), updatedAt: now() };
    db.adminDecisions.unshift(decision);
    const recipients = decision.scope === "SELECTED"
      ? targetEmployeeIds
      : decision.scope === "MANAGERS"
        ? managerEmployeeIds(db)
        : (db.employees || []).filter((employee) => !employee.isDeleted).map((employee) => employee.id);
    notifyManyEmployees(db, recipients, "قرار إداري جديد يحتاج اطلاع", `${decision.issuerPrefix}: ${decision.title}`, "ACTION_REQUIRED");
    audit(db, "admin_decision.create", "admin_decision", decision.id, null, decision);
    saveDb(db);
    return ok(decision);
  },
  acknowledgeAdminDecision: async (decisionId) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id;
    const decision = findById(db.adminDecisions || [], decisionId);
    if (!decision) throw new Error("القرار غير موجود.");
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بالحساب.");
    if (!decisionVisibleToEmployee(decision, employeeId)) throw new Error("هذا القرار غير موجه لك.");
    db.adminDecisionAcknowledgements ||= [];
    let ack = db.adminDecisionAcknowledgements.find((item) => item.decisionId === decisionId && item.employeeId === employeeId);
    if (!ack) {
      ack = { id: makeId("decisionAck"), decisionId, employeeId, userId: user?.id || "", acknowledgedAt: now(), createdAt: now(), ipHint: "browser" };
      db.adminDecisionAcknowledgements.unshift(ack);
      audit(db, "admin_decision.acknowledge", "admin_decision", decisionId, null, ack);
      saveDb(db);
    }
    return ok(ack);
  },
  disputeMinutes: async (caseId = "") => {
    const db = loadDb();
    const rows = (db.disputeMinutes || []).filter((row) => !caseId || row.caseId === caseId).map((row) => ({ ...row, case: findById(db.disputeCases || [], row.caseId) || null }));
    return ok({ minutes: rows.sort((a,b) => new Date(b.sessionAt || b.createdAt || 0) - new Date(a.sessionAt || a.createdAt || 0)) });
  },
  saveDisputeMinute: async (body = {}) => {
    const db = loadDb();
    if (!hasLocalScope(db, "disputes:committee") && !hasLocalScope(db, "disputes:manage") && !hasLocalScope(db, "executive:mobile")) throw new Error("لا تملك صلاحية حفظ محضر اللجنة.");
    const caseId = body.caseId || body.disputeId || "";
    const item = findById(db.disputeCases || [], caseId);
    if (!item) throw new Error("ملف الشكوى غير موجود.");
    db.disputeMinutes ||= [];
    const actor = currentUser(db);
    const minute = { id: makeId("minute"), caseId, sessionAt: body.sessionAt || now(), members: Array.isArray(body.members) ? body.members : String(body.members || "المدير التنفيذي، السكرتير التنفيذي، HR، المدير المباشر").split(/[،,]/).map((x) => x.trim()).filter(Boolean), decision: body.decision || body.committeeDecision || "", notes: body.notes || body.note || "", attachments: Array.isArray(body.attachments) ? body.attachments : [], signedByUserId: actor?.id || "system", signedByName: actor?.name || actor?.fullName || "النظام", signatureStatus: "SIGNED", createdAt: now() };
    db.disputeMinutes.unshift(minute);
    item.committeeDecision = minute.decision || item.committeeDecision || "تم حفظ محضر لجنة.";
    item.resolution = minute.decision || item.resolution || "";
    item.status = body.status || item.status || "COMMITTEE_REVIEW";
    item.committeeTimeline ||= [];
    item.committeeTimeline.unshift({ at: now(), by: minute.signedByName, action: "minutes", note: minute.decision || minute.notes });
    notifyManyEmployees(db, [item.employeeId, item.managerEmployeeId].filter(Boolean), "تم تحديث محضر لجنة حل الخلافات", item.title || "شكوى", "INFO");
    audit(db, "dispute.minute.save", "dispute_case", caseId, null, minute);
    saveDb(db);
    return ok({ minute, case: enrichByEmployee(db, item) });
  },
  monthlyAutoPdfReports: async (options = {}) => {
    const db = loadDb();
    const report = buildMonthlyAutoPdfReports(db, options);
    db.monthlyPdfReportRuns ||= [];
    db.monthlyPdfReportRuns.unshift({ id: makeId("mpdf"), month: report.month, status: "READY", generatedAt: report.generatedAt, generatedByUserId: currentUser(db)?.id || "system", counts: { employees: visibleEmployees(db).length, managers: report.managers.length, disputes: report.disputes.length, requests: report.requests.length } });
    db.monthlyPdfReportRuns = db.monthlyPdfReportRuns.slice(0, 120);
    saveDb(db);
    return ok({ ...report, runs: db.monthlyPdfReportRuns });
  },
  executiveMobile: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db).map((employee) => executiveEmployeeCard(db, employee));
    const counts = employees.reduce((acc, employee) => {
      const status = employee.today?.status || "ABSENT";
      acc.total += 1;
      if (["PRESENT", "LATE"].includes(status)) acc.present += 1;
      if (status === "LATE") acc.late += 1;
      if (status === "ABSENT") acc.absent += 1;
      if (status === "CHECKED_OUT") acc.checkedOut += 1;
      if (status === "ON_LEAVE") acc.onLeave += 1;
      if (status === "ON_MISSION") acc.onMission += 1;
      if (employee.today?.pendingLiveRequest) acc.pendingLiveLocations += 1;
      return acc;
    }, { total: 0, present: 0, late: 0, absent: 0, checkedOut: 0, onLeave: 0, onMission: 0, pendingLiveLocations: 0 });
    db.executiveViews ||= [];
    db.executiveViews.unshift({ id: makeId("execview"), actorUserId: currentUser(db)?.id || "", route: "executive-mobile", createdAt: now() });
    db.executiveViews = db.executiveViews.slice(0, 500);
    saveDb(db);
    return ok({ counts, employees, generatedAt: now() });
  },
  executiveEmployeeDetail: async (employeeId) => {
    const db = loadDb();
    if (!canSeeEmployee(db, employeeId)) throw new Error("لا توجد صلاحية لرؤية هذا الموظف.");
    const employee = findById(db.employees || [], employeeId);
    if (!employee || employee.isDeleted) throw new Error("الموظف غير موجود.");
    const today = executiveTodayForEmployee(db, employeeId);
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const attendance = (db.attendanceEvents || []).filter((event) => event.employeeId === employeeId && String(event.eventAt || event.createdAt || "") >= since).sort((a,b) => new Date(b.eventAt || b.createdAt || 0) - new Date(a.eventAt || a.createdAt || 0));
    const leaves = (db.leaves || []).filter((item) => item.employeeId === employeeId).slice(0, 10);
    const missions = (db.missions || []).filter((item) => item.employeeId === employeeId).slice(0, 10);
    const liveRequests = (db.liveLocationRequests || []).filter((item) => item.employeeId === employeeId).slice(0, 20);
    const liveResponses = (db.liveLocationResponses || []).filter((item) => item.employeeId === employeeId).slice(0, 20);
    db.executiveViews ||= [];
    db.executiveViews.unshift({ id: makeId("execview"), actorUserId: currentUser(db)?.id || "", employeeId, route: "executive-employee-detail", createdAt: now() });
    audit(db, "executive.view_employee", "employee", employeeId, null, { route: "executive-mobile" });
    saveDb(db);
    return ok({ employee: executiveEmployeeCard(db, employee), today, attendance, leaves, missions, liveRequests, liveResponses });
  },
  requestLiveLocation: async (employeeId, body = {}) => {
    const db = loadDb();
    if (!canSeeEmployee(db, employeeId)) throw new Error("لا توجد صلاحية لطلب موقع هذا الموظف.");
    const employee = findById(db.employees || [], employeeId);
    if (!employee) throw new Error("الموظف غير موجود.");
    const actor = currentUser(db);
    db.liveLocationRequests ||= [];
    const item = { id: makeId("liveLoc"), employeeId, requestedByUserId: actor?.id || "", requestedByEmployeeId: actor?.employeeId || "", requestedByName: body.requestedByName || body.requested_by_name || actor?.fullName || actor?.name || "الإدارة", reason: body.reason || "متابعة تنفيذية مباشرة", status: "PENDING", precision: body.precision || "HIGH", expiresAt: body.expiresAt || new Date(Date.now() + 15 * 60000).toISOString(), createdAt: now() };
    db.liveLocationRequests.unshift(item);
    notifyEmployee(db, employeeId, "طلب مشاركة موقعك الحالي", item.requestedByName + " يطلب إرسال موقعك المباشر الآن. السبب: " + item.reason, "ACTION_REQUIRED", { route: "location", data: { route: "location", type: "LIVE_LOCATION_REQUEST", liveLocationRequestId: item.id, url: "./employee/index.html#location" } });
    audit(db, "live_location.request", "employee", employeeId, null, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  myLiveLocationRequests: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    const rows = (db.liveLocationRequests || []).filter((item) => liveRequestVisibleToEmployee(item, employeeId)).map((item) => enrichByEmployee(db, item));
    return ok(rows);
  },
  respondLiveLocationRequest: async (id, body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    const item = findById(db.liveLocationRequests || [], id);
    if (!item || item.employeeId !== employeeId) throw new Error("طلب الموقع غير موجود أو لا يخص حسابك.");
    const before = clone(item);
    const requestedStatus = String(body.status || body.action || "").toUpperCase();
    const hasCoordinates = body.latitude !== undefined && body.longitude !== undefined && body.latitude !== null && body.longitude !== null;
    const postponed = requestedStatus === "POSTPONED" || body.action === "postpone" || Number(body.postponeMinutes || 0) > 0;
    const temporaryRejected = requestedStatus === "REJECTED_TEMPORARY" || requestedStatus === "TEMP_REJECT";
    const rejected = requestedStatus === "REJECTED" || body.action === "reject" || temporaryRejected;
    const approved = !rejected && !postponed && (requestedStatus === "APPROVED" || requestedStatus === "SEND" || requestedStatus === "SHARED" || hasCoordinates);
    if (approved && !hasCoordinates) throw new Error("لا يمكن إرسال موافقة الموقع بدون إحداثيات فعلية. فعّل GPS ثم أعد المحاولة.");
    item.status = approved ? "APPROVED" : postponed ? "POSTPONED" : "REJECTED_TEMPORARY";
    item.respondedAt = now();
    item.responseNote = body.note || body.reason || (postponed ? "رفض/تأجيل مؤقت" : "رفض مؤقت");
    item.postponeMinutes = postponed ? Number(body.postponeMinutes || 5) : 0;
    db.liveLocationResponses ||= [];
    const response = { id: makeId("liveRes"), requestId: item.id, employeeId, requestedByUserId: item.requestedByUserId || "", status: item.status, latitude: approved ? Number(body.latitude) : null, longitude: approved ? Number(body.longitude) : null, accuracyMeters: approved ? Number(body.accuracyMeters || body.accuracy || 0) : null, capturedAt: body.capturedAt || now(), respondedAt: now(), note: item.responseNote, postponeMinutes: item.postponeMinutes };
    db.liveLocationResponses.unshift(response);
    if (approved && Number.isFinite(response.latitude) && Number.isFinite(response.longitude)) {
      db.locations ||= [];
      db.locations.unshift({ id: makeId("loc"), employeeId, liveLocationRequestId: item.id, latitude: response.latitude, longitude: response.longitude, accuracyMeters: response.accuracyMeters, status: "LIVE_SHARED", date: response.capturedAt, source: "live_location_request" });
    }
    const requester = findById(db.users || [], item.requestedByUserId);
    if (requester?.employeeId) {
      const title = approved ? "تم إرسال الموقع المباشر" : "تم رفض/تأجيل طلب الموقع مؤقتًا";
      const bodyText = (user?.fullName || user?.name || "الموظف") + ": " + (approved ? "أرسل الموقع" : (item.responseNote || "رفض/تأجيل مؤقت"));
      notifyEmployee(db, requester.employeeId, title, bodyText, approved ? "SUCCESS" : "WARNING");
    }
    audit(db, "live_location.respond", "live_location_request", id, before, { request: item, response });
    saveDb(db);
    return ok({ request: enrichByEmployee(db, item), response });
  },
  controlRoom: async () => {
    const db = loadDb();
    const snapshot = controlRoomSnapshot(db);
    saveDb(db);
    return ok(snapshot);
  },
  runSmartAudit: async () => {
    const db = loadDb();
    const before = db.smartAlerts?.length || 0;
    const alerts = smartAlertRows(db);
    audit(db, "smart_audit.run", "system", "control-room", null, { before, after: alerts.length, open: alerts.filter((row) => row.status === "OPEN").length });
    saveDb(db);
    return ok({ alerts, snapshot: controlRoomSnapshot(db) });
  },
  resolveSmartAlert: async (id, body = {}) => {
    const db = loadDb();
    const alert = findById(db.smartAlerts || [], id);
    if (!alert) throw new Error("التنبيه غير موجود.");
    const before = clone(alert);
    alert.status = body.status || "RESOLVED";
    alert.resolutionNote = body.note || "تمت المعالجة";
    alert.resolvedAt = now();
    alert.resolvedByUserId = currentUser(db)?.id || "system";
    audit(db, "smart_alert.resolve", "smart_alert", id, before, alert);
    saveDb(db);
    return ok(alert);
  },
  dataCenter: async () => {
    const db = loadDb();
    return ok({
      meta: db.meta || {},
      counts: {
        employees: (db.employees || []).length,
        users: (db.users || []).length,
        attendance: (db.attendanceEvents || []).length,
        requests: workflowItems(db).length,
        documents: (db.employeeDocuments || []).length,
        dailyReports: (db.dailyReports || []).length,
        audits: (db.auditLogs || []).length,
      },
      importBatches: db.importBatches || [],
      backups: db.systemBackups || [],
    });
  },
  exportFullBackup: async () => ok(exportPortableData(loadDb())),
  validateImportBackup: async (payload = {}) => ok(validatePortableImport(payload)),
  importBackup: async (payload = {}) => {
    const validation = validatePortableImport(payload);
    if (!validation.ok) throw new Error(validation.issues.join(" — "));
    const current = loadDb();
    const before = exportPortableData(current);
    const next = normalizeDb({ ...current, ...payload, meta: { ...(payload.meta || {}), orgProfile: "ahla-shabab-manil-shiha-v2" } });
    next.importBatches ||= [];
    next.importBatches.unshift({ id: makeId("imp"), employees: validation.employees, users: validation.users, warnings: validation.warnings, createdAt: now(), createdByUserId: currentUser(current)?.id || "system" });
    next.systemBackups ||= [];
    next.systemBackups.unshift({ id: makeId("bak"), title: "Backup قبل الاستيراد", payload: before, createdAt: now() });
    audit(next, "data.import", "system", "local-db", { counts: validation }, { imported: true });
    saveDb(next);
    return ok({ validation, counts: { employees: next.employees.length, users: next.users.length } });
  },
  dailyReports: async (filters = {}) => ok(dailyReportRows(loadDb(), filters)),
  myDailyReports: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    return ok(dailyReportRows(db, { employeeId }));
  },
  createDailyReport: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = body.employeeId || user?.employeeId || user?.employee?.id;
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بالحساب.");
    const reportDate = body.reportDate || new Date().toISOString().slice(0, 10);
    db.dailyReports ||= [];
    let report = db.dailyReports.find((row) => row.employeeId === employeeId && row.reportDate === reportDate);
    const before = clone(report);
    if (!report) {
      report = { id: makeId("dr"), employeeId, reportDate, createdAt: now() };
      db.dailyReports.unshift(report);
    }
    Object.assign(report, {
      achievements: body.achievements || body.done || "",
      blockers: body.blockers || "",
      tomorrowPlan: body.tomorrowPlan || body.plan || "",
      supportNeeded: body.supportNeeded || "",
      mood: body.mood || "NORMAL",
      status: body.status || "SUBMITTED",
      updatedAt: now(),
    });
    const employee = findById(db.employees, employeeId);
    notifyManyEmployees(db, [employee?.managerEmployeeId, "emp-executive-secretary"].filter(Boolean), "تقرير يومي جديد", `${employee?.fullName || "موظف"} أرسل تقريره اليومي`, "INFO");
    audit(db, before ? "daily_report.update" : "daily_report.create", "daily_report", report.id, before, report);
    saveDb(db);
    return ok(enrichByEmployee(db, report));
  },
  reviewDailyReport: async (id, body = {}) => {
    const db = loadDb();
    const report = findById(db.dailyReports || [], id);
    if (!report) throw new Error("التقرير غير موجود.");
    const before = clone(report);
    report.status = body.status || "REVIEWED";
    report.managerComment = body.managerComment || body.comment || "تمت المراجعة";
    report.reviewedAt = now();
    report.reviewedByUserId = currentUser(db)?.id || "system";
    audit(db, "daily_report.review", "daily_report", id, before, report);
    notifyEmployee(db, report.employeeId, "تمت مراجعة التقرير اليومي", report.managerComment, "SUCCESS");
    saveDb(db);
    return ok(enrichByEmployee(db, report));
  },
  me: async () => {
    const db = loadDb();
    const userId = sessionStorage.getItem(SESSION_KEY);
    const user = db.users.find((item) => item.id === userId && item.status === "ACTIVE");
    return ok(user ? enrichUser(db, user) : null);
  },
  login: async (identifier, password) => {
    if (!localFallbackAllowed() && !shouldUseApi() && !shouldUseSupabase()) throw new Error("تسجيل الدخول المحلي معطّل في حزمة الإنتاج. فعّل Supabase لاستخدام النظام.");
    const db = loadDb();
    const user = db.users.find((item) => ["ACTIVE", "INVITED"].includes(item.status) && loginMatches(item, identifier));
    if (!user || user.password !== password) {
      if (user) {
        user.failedLogins = Number(user.failedLogins || 0) + 1;
        if (user.failedLogins >= 5) user.status = "LOCKED";
        audit(db, "auth.failed", "user", user.id, null, { failedLogins: user.failedLogins });
        saveDb(db);
      }
      throw new Error(user?.status === "LOCKED" ? "تم قفل الحساب بعد محاولات خاطئة." : "بيانات الدخول غير صحيحة أو الحساب غير مفعل.");
    }
    user.failedLogins = 0;
    user.lastLoginAt = now();
    audit(db, "auth.login", "user", user.id, null, { at: user.lastLoginAt });
    saveDb(db);
    sessionStorage.setItem(SESSION_KEY, user.id);
    return ok(enrichUser(db, user));
  },
  employeeRegister: async () => {
    throw new Error("تم إيقاف التسجيل الذاتي. إضافة الموظفين وإنشاء الحسابات تتم من لوحة HR فقط.");
  },
  forgotPassword: async (identifier) => {
    const db = loadDb();
    const user = db.users.find((item) => loginMatches(item, identifier));
    if (user) {
      notify(db, "طلب إعادة تعيين كلمة المرور", `تم طلب إعادة تعيين كلمة المرور للحساب ${user.email || user.name}.`, "INFO");
      audit(db, "auth.password_reset_requested", "user", user.id, null, { email: user.email || identifier });
      saveDb(db);
    }
    return ok({ sent: true, localOnly: true });
  },
  logout: async () => {
    sessionStorage.removeItem(SESSION_KEY);
    return ok({ ok: true });
  },
  changePassword: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user) throw new Error("يجب تسجيل الدخول أولًا.");
    const raw = findById(db.users, user.id);
    if (!raw) throw new Error("الحساب غير موجود.");
    if (!body.newPassword || String(body.newPassword).length < 8) throw new Error("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.");
    if (body.confirmPassword && body.newPassword !== body.confirmPassword) throw new Error("تأكيد كلمة المرور غير مطابق.");
    const recoveryMode = body.recoveryMode === true || body.recoveryMode === "true";
    if (!recoveryMode && raw.password !== body.currentPassword) throw new Error("كلمة المرور الحالية غير صحيحة.");
    const before = clone(raw);
    raw.password = body.newPassword;
    raw.temporaryPassword = false;
    raw.mustChangePassword = false;
    raw.status = "ACTIVE";
    audit(db, "auth.password_changed", "user", raw.id, before, { changedAt: now(), recoveryMode });
    saveDb(db);
    return ok({ changed: true });
  },
  dashboard: async () => ok(dashboard(loadDb())),
  health: async () => {
    const db = loadDb();
    return ok({
      app: "Live Server / Vanilla Web",
      database: { mode: shouldUseApi() ? "API fallback" : "localStorage", connected: true },
      authEnforced: true,
      queue: { enabled: false },
      version: db.meta?.version || 5,
      counts: {
        employees: db.employees.filter((e) => !e.isDeleted).length,
        users: db.users.length,
        branches: db.branches.length,
        auditLogs: db.auditLogs.length,
      },
      checks: [
        { label: "ربط المستخدمين بالموظفين", ok: db.users.every((user) => !user.employeeId || findById(db.employees, user.employeeId)) },
        { label: "وجود أدوار بصلاحيات", ok: db.roles.every((role) => role.permissions?.length) },
        { label: "سجل تدقيق فعال", ok: Array.isArray(db.auditLogs) },
      ],
    });
  },
  systemDiagnostics: async () => {
    const db = loadDb();
    const usersByEmployee = new Set((db.users || []).map((user) => user.employeeId).filter(Boolean));
    const linkedUsers = (db.users || []).filter((user) => user.employeeId && findById(db.employees, user.employeeId));
    const address = attendanceAddressForEmployee(db, currentUser(db)?.employeeId || db.employees[0]?.id);
    const requiredBuckets = ["avatars", "punch-selfies", "employee-attachments"];
    const employeesWithoutUsers = db.employees.filter((employee) => !employee.isDeleted && !usersByEmployee.has(employee.id)).length;
    return ok({
      backend: shouldUseApi() ? "API/local fallback" : "localStorage",
      generatedAt: now(),
      checks: [
        { label: "الجلسة الحالية", ok: Boolean(currentUser(db)), status: currentUser(db) ? "APPROVED" : "REJECTED", detail: currentUser(db)?.email || "غير مسجل" },
        { label: "ربط المستخدمين بالموظفين", ok: linkedUsers.length === db.users.length, status: linkedUsers.length === db.users.length ? "linked" : "unlinked", detail: String(linkedUsers.length) + "/" + String(db.users.length) },
        { label: "موظفون بلا حساب دخول", ok: employeesWithoutUsers === 0, status: "INFO", detail: String(employeesWithoutUsers) + " ملف" },
        { label: "إحداثيات المجمع", ok: Boolean(address.latitude && address.longitude), status: address.latitude && address.longitude ? "APPROVED" : "REJECTED", detail: String(address.latitude || "-") + ", " + String(address.longitude || "-") },
        { label: "نطاق البصمة", ok: Number(address.radiusMeters || 0) >= 50 && Number(address.maxAccuracyMeters || 0) <= 1000, status: "INFO", detail: "النطاق " + String(address.radiusMeters) + "م / الدقة " + String(address.maxAccuracyMeters) + "م" },
        { label: "Storage Buckets المطلوبة", ok: true, status: "storage_ok", detail: requiredBuckets.join(" / ") },
        { label: "RLS/الصلاحيات", ok: true, status: "INFO", detail: "محليًا غير مطبق؛ افحصه في Supabase عند الإنتاج" },
      ],
    });
  },
  autoLinkUsersByEmail: async () => {
    const db = loadDb();
    let linked = 0;
    for (const user of db.users || []) {
      const employee = (db.employees || []).find((item) => String(item.email || "").toLowerCase() === String(user.email || "").toLowerCase());
      if (!employee) continue;
      if (user.employeeId !== employee.id) { user.employeeId = employee.id; linked += 1; }
      if (employee.userId !== user.id) employee.userId = user.id;
      user.name = user.name || employee.fullName;
      user.fullName = user.fullName || employee.fullName;
      user.roleId = user.roleId || employee.roleId;
      user.branchId = user.branchId || employee.branchId;
      user.departmentId = user.departmentId || employee.departmentId;
      user.governorateId = user.governorateId || employee.governorateId;
      user.complexId = user.complexId || employee.complexId;
    }
    audit(db, "autolink", "users", "email", null, { linked });
    saveDb(db);
    return ok({ linked });
  },
  updateComplexSettings: async (body = {}) => {
    const db = loadDb();
    const branch = db.branches[0] || (db.branches[0] = { id: makeId("b"), name: DEFAULT_COMPLEX.name, active: true });
    const complex = db.complexes[0] || (db.complexes[0] = { id: makeId("cx"), name: DEFAULT_COMPLEX.name, active: true });
    const payload = {
      name: body.name || DEFAULT_COMPLEX.name,
      address: body.address || DEFAULT_COMPLEX.address,
      latitude: Number(body.latitude || DEFAULT_COMPLEX.latitude),
      longitude: Number(body.longitude || DEFAULT_COMPLEX.longitude),
      radiusMeters: Number(body.radiusMeters || DEFAULT_COMPLEX.radiusMeters),
      geofenceRadiusMeters: Number(body.radiusMeters || DEFAULT_COMPLEX.radiusMeters),
      maxAccuracyMeters: Number(body.maxAccuracyMeters || DEFAULT_COMPLEX.maxAccuracyMeters),
    };
    Object.assign(branch, payload);
    Object.assign(complex, payload, { branchId: branch.id });
    for (const key of Object.keys(payload)) {
      const settingKey = `complex.${key}`;
      let setting = db.settings.find((item) => item.key === settingKey);
      if (!setting) db.settings.push({ id: makeId("set"), key: settingKey, value: payload[key], scope: "complex" });
      else setting.value = payload[key];
    }
    audit(db, "update", "complex_settings", branch.id, null, payload);
    saveDb(db);
    return ok({ branch, complex });
  },
  employees: async () => ok(visibleEmployees(loadDb())),
  disputeEmployees: async () => {
    const db = loadDb();
    return ok((db.employees || []).filter((employee) => !employee.isDeleted).map((employee) => enrichEmployee(db, employee)));
  },
  bulkEmployeeAction: async (body = {}) => {
    const db = loadDb();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) throw new Error("حدد موظفًا واحدًا على الأقل.");
    let updated = 0;
    let notified = 0;
    const before = ids.map((id) => clone(findById(db.employees, id))).filter(Boolean);
    for (const id of ids) {
      const employee = findById(db.employees, id);
      if (!employee || employee.isDeleted || !canSeeEmployee(db, id)) continue;
      if (body.action === "delete") {
        employee.isDeleted = true;
        employee.status = "TERMINATED";
        const user = findById(db.users, employee.userId) || (db.users || []).find((u) => u.employeeId === employee.id);
        if (user) user.status = "DISABLED";
      } else if (body.action === "status") {
        employee.status = body.status || body.value || employee.status || "ACTIVE";
        const user = findById(db.users, employee.userId) || (db.users || []).find((u) => u.employeeId === employee.id);
        if (user && ["ACTIVE", "SUSPENDED", "TERMINATED"].includes(employee.status)) user.status = employee.status === "ACTIVE" ? "ACTIVE" : "DISABLED";
      } else if (body.action === "assign") {
        for (const key of ["branchId", "departmentId", "managerEmployeeId", "roleId", "complexId", "governorateId"]) if (body[key] !== undefined) employee[key] = body[key];
        const user = findById(db.users, employee.userId) || (db.users || []).find((u) => u.employeeId === employee.id);
        if (user) {
          for (const key of ["branchId", "departmentId", "roleId", "complexId", "governorateId"]) if (body[key] !== undefined) user[key] = body[key];
        }
      } else if (body.action === "notify") {
        db.notifications.unshift({ id: makeId("not"), userId: employee.userId || "", employeeId: employee.id, title: body.title || "تنبيه من الإدارة", body: body.message || "يرجى مراجعة الإدارة.", status: "UNREAD", isRead: false, type: body.type || "ACTION_REQUIRED", createdAt: now() });
        notified += 1;
      }
      employee.updatedAt = now();
      updated += 1;
    }
    audit(db, `bulk.employee.${body.action || "update"}`, "employee", "bulk", before, { ids, body, updated, notified });
    if (notified) notify(db, "تم إرسال تنبيهات جماعية", `${notified} موظف`, "SUCCESS");
    saveDb(db);
    return ok({ updated, notified });
  },
  employee: async (employeeId) => {
    const db = loadDb();
    const employee = findById(db.employees, employeeId);
    if (!employee || employee.isDeleted || !canSeeEmployee(db, employeeId)) throw new Error("لم يتم العثور على الموظف أو لا تملك صلاحية عرضه.");
    return ok({
      ...enrichEmployee(db, employee),
      attendanceEvents: db.attendanceEvents.filter((item) => item.employeeId === employeeId).sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt)),
      attendanceDaily: db.attendanceDaily.filter((item) => item.employeeId === employeeId).sort((a, b) => b.date.localeCompare(a.date)),
      missions: db.missions.filter((item) => item.employeeId === employeeId),
      leaves: db.leaves.filter((item) => item.employeeId === employeeId),
      exceptions: db.exceptions.filter((item) => item.employeeId === employeeId),
      attachments: db.attachments.filter((item) => item.employeeId === employeeId),
    });
  },
  createEmployee: async (body = {}) => {
    const db = loadDb();
    const employee = applyEmployeePayload(db, { id: makeId("emp"), isDeleted: false, userId: "" }, body);
    if ((body.createUser === "on" || body.createUser === true) && !employee.email) employee.email = inferEmail(db, body, employee);
    db.employees.unshift(employee);
    audit(db, "create", "employee", employee.id, null, employee);
    if (body.createUser === "on" || body.createUser === true) {
      const user = createUserRecord(db, { ...body, employeeId: employee.id, name: employee.fullName, email: employee.email, phone: employee.phone, roleId: employee.roleId, branchId: employee.branchId, departmentId: employee.departmentId, governorateId: employee.governorateId, complexId: employee.complexId });
      employee.userId = user.id;
    }
    notify(db, `تمت إضافة الموظف ${employee.fullName}`, "تم إنشاء ملف موظف جديد وحفظه في التخزين المحلي.", "SUCCESS");
    saveDb(db);
    return ok(enrichEmployee(db, employee));
  },
  updateEmployee: async (employeeId, body) => {
    const db = loadDb();
    const employee = findById(db.employees, employeeId);
    if (!employee) throw new Error("لم يتم العثور على الموظف.");
    const before = clone(employee);
    applyEmployeePayload(db, employee, body);
    const user = db.users.find((item) => item.employeeId === employee.id);
    if (user) {
      user.name = employee.fullName;
      user.fullName = employee.fullName;
      user.email = employee.email || user.email;
      user.phone = employee.phone || user.phone || "";
      user.avatarUrl = employee.photoUrl || user.avatarUrl || "";
      user.photoUrl = user.avatarUrl;
      user.roleId = employee.roleId;
      user.branchId = employee.branchId;
      user.departmentId = employee.departmentId;
      user.governorateId = employee.governorateId;
      user.complexId = employee.complexId;
    }
    if (!user && (body.createUser === "on" || body.createUser === true)) {
      const created = createUserRecord(db, { ...body, employeeId: employee.id, name: employee.fullName, email: employee.email, phone: employee.phone, roleId: employee.roleId, branchId: employee.branchId, departmentId: employee.departmentId, governorateId: employee.governorateId, complexId: employee.complexId });
      employee.userId = created.id;
    }
    audit(db, "update", "employee", employee.id, before, employee);
    saveDb(db);
    return ok(enrichEmployee(db, employee));
  },
  setEmployeeStatus: async (employeeId, status) => {
    const db = loadDb();
    const employee = findById(db.employees, employeeId);
    if (!employee) throw new Error("لم يتم العثور على الموظف.");
    const before = clone(employee);
    employee.status = status;
    const user = db.users.find((item) => item.employeeId === employeeId);
    if (user && ["INACTIVE", "SUSPENDED", "TERMINATED"].includes(status)) user.status = "DISABLED";
    audit(db, "status", "employee", employeeId, before, employee);
    saveDb(db);
    return ok(enrichEmployee(db, employee));
  },
  deleteEmployee: async (employeeId) => {
    const db = loadDb();
    const employee = findById(db.employees, employeeId);
    if (!employee) throw new Error("لم يتم العثور على الموظف.");
    if (!isExecutiveAuthority(db)) {
      const approval = createSensitiveApprovalRecord(db, { actionType: "DELETE_EMPLOYEE", targetType: "employee", targetId: employeeId, targetEmployeeId: employeeId, title: `طلب حذف/تعطيل موظف: ${employee.fullName || employeeId}`, summary: "تم تحويل الحذف إلى اعتماد تنفيذي لحماية البيانات.", payload: { employeeId } });
      saveDb(db);
      return ok({ ok: true, pendingApproval: true, approval });
    }
    const before = clone(employee);
    employee.isDeleted = true;
    employee.status = "INACTIVE";
    const user = db.users.find((item) => item.employeeId === employeeId);
    if (user) user.status = "DISABLED";
    audit(db, "soft_delete", "employee", employeeId, before, employee);
    saveDb(db);
    return ok({ ok: true });
  },
  users: async () => {
    const db = loadDb();
    return ok(db.users.map((user) => enrichUser(db, user)));
  },
  createUser: async (body) => {
    const db = loadDb();
    const user = createUserRecord(db, body);
    const employee = findById(db.employees, user.employeeId);
    if (employee) employee.userId = user.id;
    saveDb(db);
    return ok(enrichUser(db, user));
  },
  updateUser: async (userId, body) => {
    const db = loadDb();
    const user = findById(db.users, userId);
    if (!user) throw new Error("لم يتم العثور على المستخدم.");
    const before = clone(user);
    Object.assign(user, {
      name: body.name || body.fullName || user.name,
      email: body.email || user.email,
      phone: body.phone || user.phone || "",
      avatarUrl: body.avatarUrl || body.photoUrl || user.avatarUrl || user.photoUrl || "",
      roleId: body.roleId || user.roleId,
      employeeId: body.employeeId || "",
      branchId: body.branchId || "",
      departmentId: body.departmentId || "",
      governorateId: body.governorateId || "",
      complexId: body.complexId || "",
      status: body.status || user.status,
      temporaryPassword: body.temporaryPassword === "on" || body.temporaryPassword === true,
      mustChangePassword: body.temporaryPassword === "on" || body.temporaryPassword === true,
      passkeyEnabled: body.passkeyEnabled === "on" || body.passkeyEnabled === true,
    });
    if (body.password) user.password = body.password;
    db.employees.forEach((employee) => {
      if (employee.userId === user.id && employee.id !== user.employeeId) employee.userId = "";
    });
    const employee = findById(db.employees, user.employeeId);
    if (employee) {
      employee.userId = user.id;
      if (body.email) employee.email = body.email;
      if (body.phone) employee.phone = body.phone;
    }
    audit(db, "update", "user", user.id, before, user);
    saveDb(db);
    return ok(enrichUser(db, user));
  },
  updateMyContact: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user) throw new Error("يجب تسجيل الدخول أولًا.");
    const raw = findById(db.users, user.id);
    if (!raw) throw new Error("الحساب غير موجود.");
    const before = clone(raw);
    if (body.email) raw.email = String(body.email).trim().toLowerCase();
    if (body.phone) raw.phone = String(body.phone).trim();
    if (body.avatarUrl || body.photoUrl) {
      raw.avatarUrl = body.avatarUrl || body.photoUrl;
      raw.photoUrl = raw.avatarUrl;
    }
    const employee = findById(db.employees, raw.employeeId);
    if (employee) {
      if (body.email) employee.email = raw.email;
      if (body.phone) employee.phone = raw.phone;
      if (raw.avatarUrl) employee.photoUrl = raw.avatarUrl;
    }
    audit(db, "profile.contact_update", "user", raw.id, before, raw);
    saveDb(db);
    return ok(enrichUser(db, raw));
  },
  setUserStatus: async (userId, status) => {
    const db = loadDb();
    const user = findById(db.users, userId);
    if (!user) throw new Error("لم يتم العثور على المستخدم.");
    const before = clone(user);
    user.status = status;
    audit(db, "status", "user", userId, before, user);
    saveDb(db);
    return ok(enrichUser(db, user));
  },
  attendanceEvents: async (params = {}) => {
    const db = loadDb();
    let rows = scopedRowsByEmployee(db, db.attendanceEvents).filter((event) => {
      const day = String(event.eventAt || event.createdAt || "").slice(0, 10);
      return (!params.from || !day || day >= params.from)
        && (!params.to || !day || day <= params.to)
        && (!params.employeeId || event.employeeId === params.employeeId)
        && (!params.type || event.type === params.type)
        && (!params.review || (params.review === "review" ? Boolean(event.requiresReview) : !event.requiresReview));
    }).map((event) => enrichByEmployee(db, event)).sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt));
    if (params.limit) rows = rows.slice(0, Math.max(Number(params.limit), 1));
    return ok(rows);
  },
  myAttendanceEvents: async () => {
    const db = loadDb();
    const user = currentUser(db);
    return ok(db.attendanceEvents.filter((event) => event.employeeId === user?.employeeId).map((event) => enrichByEmployee(db, event)).sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt)));
  },
  attendanceDaily: async (params = {}) => {
    const db = loadDb();
    let rows = scopedRowsByEmployee(db, db.attendanceDaily).filter((item) => {
      const day = String(item.date || "").slice(0, 10);
      return (!params.from || !day || day >= params.from)
        && (!params.to || !day || day <= params.to)
        && (!params.employeeId || item.employeeId === params.employeeId);
    }).map((item) => enrichByEmployee(db, item)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (params.limit) rows = rows.slice(0, Math.max(Number(params.limit), 1));
    return ok(rows);
  },
  attendanceAddress: async () => {
    const db = loadDb();
    const user = currentUser(db);
    return ok(attendanceAddressForEmployee(db, user?.employeeId || db.employees[0]?.id));
  },
  evaluateGeofence: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = body.employeeId || user?.employeeId || db.employees[0]?.id;
    const evaluation = evaluateAttendance(db, { ...body, employeeId }, "CHECK_IN");
    return ok({ ...evaluation, inside: evaluation.geofenceStatus === "inside_branch", allowed: evaluation.canRecord, message: evaluation.blockReason || geofenceMessage(evaluation), employeeId });
  },
  regenerateAttendance: async (body = {}) => {
    const db = loadDb();
    const result = regenerateDailyLocal(db, body);
    saveDb(db);
    return ok(result);
  },
  manualAttendance: async (body) => {
    const db = loadDb();
    const employeeId = body.employeeId || db.employees[0]?.id;
    const event = { id: makeId("manual"), employeeId, eventAt: body.eventAt || now(), source: "Manual", type: body.type || "MANUAL_ADJUSTMENT", geofenceStatus: "manual_adjustment", verificationStatus: "manual", notes: body.reason || body.notes || "تعديل يدوي", isManual: true, requiresReview: false };
    db.attendanceEvents.unshift(event);
    upsertDailyFromEvent(db, employeeId, event);
    audit(db, "manual_adjustment", "attendance", event.id, null, event);
    saveDb(db);
    return ok(enrichByEmployee(db, event));
  },
  recordPunchRejection: async (body = {}) => {
    const db = loadDb();
    const employeeId = body.employeeId || currentUser(db)?.employeeId || db.employees[0]?.id;
    const event = {
      id: makeId("attrej"),
      employeeId,
      userId: currentUser(db)?.id || "",
      type: body.action === "checkOut" ? "CHECK_OUT" : "CHECK_IN",
      status: "REJECTED",
      eventAt: now(),
      source: "Rejected Punch",
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      accuracyMeters: body.accuracyMeters ?? body.accuracy ?? null,
      geofenceStatus: body.geofenceStatus || "REJECTED",
      distanceFromBranchMeters: body.distanceFromBranchMeters ?? null,
      verificationStatus: "failed",
      biometricMethod: "session_gps",
      notes: body.blockReason || body.notes || "محاولة بصمة مرفوضة",
      requiresReview: true,
      riskFlags: ["rejected_punch"],
    };
    db.attendanceEvents.unshift(event);
    audit(db, "attendance.rejected", "attendance", event.id, null, event);
    saveDb(db);
    return ok(enrichByEmployee(db, event));
  },
  checkIn: async (body) => {
    const db = loadDb();
    const evaluation = evaluateAttendance(db, body, "CHECK_IN");
    const event = { id: makeId("att"), employeeId: body.employeeId, eventAt: now(), source: "Live Server", biometricMethod: body.biometricMethod || "session_gps", passkeyCredentialId: body.passkeyCredentialId || "", trustedDeviceId: body.trustedDeviceId || "", deviceFingerprintHash: body.deviceFingerprintHash || "", browserInstallId: body.browserInstallId || "", branchQrStatus: body.branchQrStatus || "NOT_PROVIDED", branchQrChallengeId: body.branchQrChallengeId || "", antiSpoofingFlags: body.antiSpoofingFlags || [], selfieUrl: body.selfieUrl || "", identityCheck: body.identityCheck || {}, riskScore: body.riskScore || 0, riskLevel: body.riskLevel || "LOW", riskFlags: body.riskFlags || [], ...evaluation, requiresReview: Boolean(body.requiresReview || !evaluation.canRecord || evaluation.requiresReview || (body.riskScore || 0) >= 35) };
    db.attendanceEvents.unshift(event);
    upsertDailyFromEvent(db, body.employeeId, event);
    audit(db, "check_in", "attendance", event.id, null, event);
    saveDb(db);
    return ok({ ok: true, evaluation, event });
  },
  checkOut: async (body) => {
    const db = loadDb();
    const evaluation = evaluateAttendance(db, body, "CHECK_OUT");
    const event = { id: makeId("att"), employeeId: body.employeeId, eventAt: now(), source: "Live Server", biometricMethod: body.biometricMethod || "session_gps", passkeyCredentialId: body.passkeyCredentialId || "", trustedDeviceId: body.trustedDeviceId || "", deviceFingerprintHash: body.deviceFingerprintHash || "", browserInstallId: body.browserInstallId || "", branchQrStatus: body.branchQrStatus || "NOT_PROVIDED", branchQrChallengeId: body.branchQrChallengeId || "", antiSpoofingFlags: body.antiSpoofingFlags || [], selfieUrl: body.selfieUrl || "", identityCheck: body.identityCheck || {}, riskScore: body.riskScore || 0, riskLevel: body.riskLevel || "LOW", riskFlags: body.riskFlags || [], ...evaluation, requiresReview: Boolean(body.requiresReview || !evaluation.canRecord || evaluation.requiresReview || (body.riskScore || 0) >= 35) };
    db.attendanceEvents.unshift(event);
    upsertDailyFromEvent(db, body.employeeId, event);
    audit(db, "check_out", "attendance", event.id, null, event);
    saveDb(db);
    return ok({ ok: true, evaluation, event });
  },
  selfCheckIn: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user?.employeeId) throw new Error("لا يوجد موظف مرتبط بحسابك.");
    return localEndpoints.checkIn({ ...body, employeeId: user.employeeId, verificationStatus: body.verificationStatus || "verified" });
  },
  selfCheckOut: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    if (!user?.employeeId) throw new Error("لا يوجد موظف مرتبط بحسابك.");
    return localEndpoints.checkOut({ ...body, employeeId: user.employeeId, verificationStatus: body.verificationStatus || "verified" });
  },
  recordAttendance: async (body = {}) => {
    const action = String(body.eventType || body.type || body.action || "").toLowerCase();
    const out = ["out", "checkout", "check_out", "انصراف"].includes(action);
    assertEmployeePunchButtonIntent(body);
    assertEmployeePunchPasskey(body);
    return out ? localEndpoints.selfCheckOut(body) : localEndpoints.selfCheckIn(body);
  },
  adjustAttendance: async (body) => {
    const db = loadDb();
    const item = { id: makeId("exc"), employeeId: body.employeeId, title: body.title || "طلب تعديل حضور", reason: body.reason || body.notes || "", status: "PENDING", createdAt: now(), workflow: [] };
    requestWorkflow(item, "created", currentUser(db)?.name || "النظام");
    db.exceptions.unshift(item);
    audit(db, "create", "attendance_exception", item.id, null, item);
    notify(db, "طلب تعديل حضور جديد", item.title, "INFO");
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  exceptions: async () => {
    const db = loadDb();
    return ok(scopedRowsByEmployee(db, db.exceptions).map((item) => enrichByEmployee(db, item)));
  },
  updateException: async (id, action) => {
    const db = loadDb();
    const item = findById(db.exceptions, id);
    if (!item) throw new Error("الطلب غير موجود.");
    const before = clone(item);
    item.status = action === "reject" ? "REJECTED" : "APPROVED";
    requestWorkflow(item, item.status.toLowerCase(), currentUser(db)?.name || "النظام");
    audit(db, "workflow", "attendance_exception", id, before, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  missions: async () => {
    const db = loadDb();
    return ok(scopedRowsByEmployee(db, db.missions).map((mission) => enrichByEmployee(db, mission)));
  },
  createMission: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = (isFullAccessUser(db) ? body.employeeId : user?.employeeId) || body.employeeId || user?.employeeId || db.employees[0]?.id;
    const employee = findById(db.employees, employeeId);
    const item = { id: makeId("mis"), employeeId, title: body.title || "مأمورية", destinationName: body.destinationName || body.destination || "", plannedStart: body.plannedStart || "", plannedEnd: body.plannedEnd || "", status: "PENDING", approvalStatus: "pending", managerEmployeeId: employee?.managerEmployeeId || "", workflow: [], createdBy: user?.id || "", createdAt: now() };
    requestWorkflow(item, "created", user?.name || "النظام");
    db.missions.unshift(item);
    audit(db, "create", "mission", item.id, null, item);
    notifyEmployee(db, employee?.managerEmployeeId, `مأمورية تحتاج اعتماد من ${employee?.fullName || "موظف"}`, item.title, "ACTION_REQUIRED");
    notify(db, "مأمورية جديدة تحتاج اعتماد", item.title, "INFO");
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  updateMission: async (missionId, action) => {
    const db = loadDb();
    const mission = findById(db.missions, missionId);
    if (!mission) throw new Error("المأمورية غير موجودة.");
    const before = clone(mission);
    mission.status = action === "complete" ? "COMPLETED" : action === "reject" ? "REJECTED" : action === "manager_approve" ? "PENDING_HR_REVIEW" : "APPROVED";
    mission.approvalStatus = mission.status.toLowerCase();
    mission.workflowStatus = action === "manager_approve" ? "pending_hr_review" : (mission.workflowStatus || action);
    requestWorkflow(mission, action, currentUser(db)?.name || "النظام");
    audit(db, "workflow", "mission", missionId, before, mission);
    saveDb(db);
    return ok(enrichByEmployee(db, mission));
  },
  leaves: async () => {
    const db = loadDb();
    return ok(scopedRowsByEmployee(db, db.leaves).map((leave) => enrichByEmployee(db, leave)));
  },
  createLeave: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = (isFullAccessUser(db) ? body.employeeId : user?.employeeId) || body.employeeId || user?.employeeId || db.employees[0]?.id;
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بهذا الحساب لإرسال طلب الإجازة.");
    if (!body.startDate || !body.endDate) throw new Error("حدد تاريخ بداية ونهاية الإجازة.");
    if (String(body.endDate) < String(body.startDate)) throw new Error("تاريخ نهاية الإجازة يجب أن يكون بعد تاريخ البداية.");
    const employee = findById(db.employees, employeeId);
    const item = { id: makeId("lv"), employeeId, leaveType: { name: body.leaveType || body.type || "اعتيادية" }, type: body.leaveType || body.type || "اعتيادية", startDate: body.startDate, endDate: body.endDate, reason: body.reason || "", status: "PENDING", managerEmployeeId: employee?.managerEmployeeId || "", workflow: [], createdBy: user?.id || "", createdAt: now() };
    requestWorkflow(item, "created", user?.name || "النظام");
    db.leaves.unshift(item);
    audit(db, "create", "leave", item.id, null, item);
    notifyEmployee(db, employee?.managerEmployeeId, `طلب إجازة من ${employee?.fullName || "موظف"}`, item.reason || item.type, "ACTION_REQUIRED");
    notify(db, "طلب إجازة جديد", `${employee?.fullName || "موظف"}: ${item.reason || item.type}`, "INFO");
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  updateLeave: async (leaveId, action) => {
    const db = loadDb();
    const leave = findById(db.leaves, leaveId);
    if (!leave) throw new Error("طلب الإجازة غير موجود.");
    const before = clone(leave);
    leave.status = action === "reject" ? "REJECTED" : action === "manager_approve" ? "PENDING_HR_REVIEW" : "APPROVED";
    leave.workflowStatus = action === "manager_approve" ? "pending_hr_review" : (leave.workflowStatus || action);
    requestWorkflow(leave, leave.status.toLowerCase(), currentUser(db)?.name || "النظام");
    audit(db, "workflow", "leave", leaveId, before, leave);
    saveDb(db);
    return ok(enrichByEmployee(db, leave));
  },
  locations: async () => {
    const db = loadDb();
    return ok([...(scopedRowsByEmployee(db, db.locationRequests || [])).map((item) => enrichByEmployee(db, item)), ...(scopedRowsByEmployee(db, db.locations || [])).map((item) => enrichByEmployee(db, item))]);
  },
  createLocationRequest: async (body) => {
    const db = loadDb();
    const employee = findById(db.employees, body.employeeId);
    const item = {
      id: makeId("locreq"),
      employeeId: body.employeeId,
      purpose: body.purpose || "فتح الموقع وإرسال اللوكيشن المباشر",
      requestReason: "",
      status: "PENDING",
      requestedAt: now(),
      expiresAt: body.expiresAt || new Date(Date.now() + 30 * 60000).toISOString(),
      workflow: [],
    };
    requestWorkflow(item, "created", currentUser(db)?.name || "النظام");
    db.locationRequests.unshift(item);
    db.notifications.unshift({
      id: makeId("not"),
      userId: employee?.userId || "",
      employeeId: item.employeeId,
      title: "فتح الموقع وإرسال اللوكيشن",
      body: "من فضلك افتح صفحة طلبات وسجل المواقع واضغط إرسال موقعي الآن.",
      status: "UNREAD",
      isRead: false,
      type: "ACTION_REQUIRED",
      createdAt: now(),
    });
    audit(db, "create", "location_request", item.id, null, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  updateLocationRequest: async (id, body) => {
    const db = loadDb();
    const item = findById(db.locationRequests, id);
    if (!item) throw new Error("طلب الموقع غير موجود.");
    const before = clone(item);
    item.status = body.status || "APPROVED";
    item.lastRespondedAt = now();
    if (body.latitude && body.longitude) {
      db.locations.unshift({ id: makeId("loc"), employeeId: item.employeeId, locationRequestId: id, latitude: Number(body.latitude), longitude: Number(body.longitude), accuracyMeters: Number(body.accuracyMeters || 0), status: item.status, date: now(), source: "response" });
    }
    requestWorkflow(item, String(item.status).toLowerCase(), currentUser(db)?.name || "النظام");
    audit(db, "workflow", "location_request", id, before, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  requestCenter: async (filters = {}) => {
    const db = loadDb();
    let rows = workflowItems(db);
    if (filters.status) rows = rows.filter((item) => filters.status === "PENDING" ? isPendingRequestStatus(item.status) : item.status === filters.status);
    if (filters.kind) rows = rows.filter((item) => item.kind === filters.kind);
    return ok({ rows, summary: workflowSummary(db) });
  },
  bulkRequestAction: async (body = {}) => {
    const db = loadDb();
    const items = Array.isArray(body.items) ? body.items : [];
    const action = body.action === "reject" ? "reject" : "approve";
    let updated = 0;
    for (const token of items) {
      const [kind, id] = String(token).split(":");
      const collection = kind === "leave" ? db.leaves : kind === "mission" ? db.missions : kind === "exception" ? db.exceptions : kind === "location" ? db.locationRequests : null;
      const item = collection ? findById(collection, id) : null;
      if (!item || !isPendingRequestStatus(item.status) || !canSeeEmployee(db, item.employeeId)) continue;
      const before = clone(item);
      item.status = action === "reject" ? "REJECTED" : "APPROVED";
      if (kind === "mission") item.approvalStatus = item.status.toLowerCase();
      requestWorkflow(item, action, currentUser(db)?.name || "النظام");
      audit(db, "workflow.bulk", kind, id, before, item);
      updated += 1;
    }
    saveDb(db);
    return ok({ updated });
  },
  recordLocation: async (body) => {
    const db = loadDb();
    const item = { id: makeId("loc"), employeeId: body.employeeId || db.employees[0]?.id, latitude: Number(body.latitude), longitude: Number(body.longitude), accuracyMeters: Number(body.accuracyMeters || 0), status: body.status || "ACTIVE", date: now(), source: body.source || "manual" };
    db.locations.unshift(item);
    audit(db, "record", "employee_location", item.id, null, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  notifications: async () => ok(loadDb().notifications),
  notificationMonitor: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const notifications = db.notifications || [];
    const pushRows = db.pushSubscriptions || [];
    const liveRequests = db.liveLocationRequests || [];
    const liveResponses = db.liveLocationResponses || [];
    const activePush = pushRows.filter((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
    const pushByEmployee = new Map();
    for (const row of pushRows) {
      const key = row.employeeId || row.userId || "";
      if (!key) continue;
      if (!pushByEmployee.has(key)) pushByEmployee.set(key, []);
      pushByEmployee.get(key).push(row);
    }
    const missingPush = employees.filter((employee) => {
      const rows = [...(pushByEmployee.get(employee.id) || []), ...(employee.userId ? (pushByEmployee.get(employee.userId) || []) : [])];
      return !rows.some((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
    });
    const unread = notifications.filter((item) => !item.isRead && String(item.status || "").toUpperCase() !== "READ");
    const actionRequired = notifications.filter((item) => [item.type, item.status, item.priority].some((value) => /ACTION|LIVE_LOCATION|WARNING|HIGH/i.test(String(value || ""))));
    const byEmployee = new Map(employees.map((employee) => [employee.id, employee]));
    const responseByRequest = new Map(liveResponses.map((row) => [row.requestId, row]));
    return ok({
      metrics: { notifications: notifications.length, unread: unread.length, actionRequired: actionRequired.length, pushSubscriptions: pushRows.length, activePush: activePush.length, missingPush: missingPush.length, livePending: liveRequests.filter((row) => row.status === "PENDING").length },
      notifications: notifications.map((item) => ({ ...item, employee: byEmployee.get(item.employeeId) || null })),
      unread,
      actionRequired,
      pushSubscriptions: pushRows,
      employees,
      missingPush,
      locationFlow: liveRequests.slice(0, 100).map((request) => ({ ...request, employee: byEmployee.get(request.employeeId) || null, response: responseByRequest.get(request.id) || null })),
      generatedAt: now(),
    });
  },
  locationMonitor: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const liveRequests = db.liveLocationRequests || [];
    const liveResponses = db.liveLocationResponses || [];
    const stored = db.locations || [];
    const latestLocationFor = (employeeId) => [...stored.filter((row) => row.employeeId === employeeId && row.latitude && row.longitude), ...liveResponses.filter((row) => row.employeeId === employeeId && row.latitude && row.longitude)].sort((a,b) => new Date(b.capturedAt || b.respondedAt || b.date || b.createdAt || 0) - new Date(a.capturedAt || a.respondedAt || a.date || a.createdAt || 0))[0] || null;
    const pendingFor = (employeeId) => liveRequests.filter((row) => row.employeeId === employeeId && String(row.status || "").toUpperCase() === "PENDING").sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
    const rows = employees.map((employee) => {
      const latestLocation = latestLocationFor(employee.id);
      const pendingLiveRequest = pendingFor(employee.id);
      const accuracy = Number(latestLocation?.accuracyMeters || latestLocation?.accuracy || 0);
      const locationAt = latestLocation?.capturedAt || latestLocation?.respondedAt || latestLocation?.date || latestLocation?.createdAt || "";
      const ageMinutes = locationAt ? Math.round((Date.now() - new Date(locationAt).getTime()) / 60000) : null;
      return { employee, employeeId: employee.id, latestLocation, pendingLiveRequest, classicRequests: (db.locationRequests || []).filter((row) => row.employeeId === employee.id), liveRequests: liveRequests.filter((row) => row.employeeId === employee.id), liveResponses: liveResponses.filter((row) => row.employeeId === employee.id), accuracyMeters: accuracy || null, ageMinutes, quality: !latestLocation ? "NO_GPS" : accuracy > 300 ? "LOW_ACCURACY" : ageMinutes != null && ageMinutes > 120 ? "STALE_GPS" : "GOOD" };
    });
    const counts = rows.reduce((acc, row) => { acc.total++; if (row.pendingLiveRequest) acc.pending++; if (!row.latestLocation) acc.noGps++; if (row.quality === "LOW_ACCURACY") acc.lowAccuracy++; if (row.quality === "STALE_GPS") acc.stale++; if (row.quality === "GOOD") acc.good++; return acc; }, { total: 0, pending: 0, noGps: 0, lowAccuracy: 0, stale: 0, good: 0 });
    return ok({ counts, rows, liveRequests, liveResponses, classicRequests: db.locationRequests || [], employeeLocations: stored, generatedAt: now() });
  },
  deviceCenter: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const passkeys = db.passkeyCredentials || [];
    const pushRows = db.pushSubscriptions || [];
    const approvals = db.trustedDeviceApprovalRequests || [];
    const rows = employees.map((employee) => {
      const employeePasskeys = passkeys.filter((row) => row.employeeId === employee.id || row.userId === employee.userId);
      const employeePush = pushRows.filter((row) => row.employeeId === employee.id || row.userId === employee.userId);
      const pendingApprovals = approvals.filter((row) => row.employeeId === employee.id && String(row.status || "").toUpperCase() === "PENDING");
      const activePush = employeePush.filter((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
      return { employee, passkeys: employeePasskeys, pushSubscriptions: employeePush, pendingApprovals, activePush, deviceStatus: pendingApprovals.length ? "PENDING_APPROVAL" : activePush.length ? "PUSH_ACTIVE" : employeePasskeys.length ? "PASSKEY_ONLY" : "NO_DEVICE" };
    });
    const counts = rows.reduce((acc, row) => { acc.total++; acc[row.deviceStatus] = (acc[row.deviceStatus] || 0) + 1; return acc; }, { total: 0, PUSH_ACTIVE: 0, PASSKEY_ONLY: 0, PENDING_APPROVAL: 0, NO_DEVICE: 0 });
    return ok({ counts, rows, passkeys, pushSubscriptions: pushRows, approvals: approvals.map((row) => ({ ...row, employee: employees.find((employee) => employee.id === row.employeeId) || null })), generatedAt: now() });
  },
  employeeDataQuality: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const roleIds = new Set((db.roles || []).map((role) => role.id));
    const pushEmployees = new Set((db.pushSubscriptions || []).filter((row) => row.isActive !== false).map((row) => row.employeeId).filter(Boolean));
    const issues = [];
    const rows = employees.map((employee) => {
      const employeeIssues = [];
      if (!employee.phone) employeeIssues.push({ severity: "HIGH", title: "رقم الهاتف مفقود" });
      if (!employee.managerEmployeeId && String(employee.role?.slug || "employee") === "employee") employeeIssues.push({ severity: "MEDIUM", title: "لا يوجد مدير مباشر" });
      if (!employee.photoUrl && !employee.avatarUrl) employeeIssues.push({ severity: "LOW", title: "الصورة الشخصية غير مضافة" });
      if (!employee.userId) employeeIssues.push({ severity: "HIGH", title: "لا يوجد حساب دخول مرتبط" });
      if (employee.roleId && !roleIds.has(employee.roleId)) employeeIssues.push({ severity: "HIGH", title: "الدور غير موجود في جدول الأدوار" });
      if (!pushEmployees.has(employee.id)) employeeIssues.push({ severity: "MEDIUM", title: "لا يوجد Push نشط" });
      const pendingItems = workflowItems(db).filter((row) => row.employeeId === employee.id && ["PENDING", "OPEN", "IN_REVIEW"].includes(String(row.status || "").toUpperCase())).length;
      const lastEvent = (db.attendanceEvents || []).filter((event) => event.employeeId === employee.id).sort((a,b) => new Date(b.eventAt || 0) - new Date(a.eventAt || 0))[0];
      for (const issue of employeeIssues) issues.push({ ...issue, employeeId: employee.id, employee });
      return { employee, issues: employeeIssues, issueCount: employeeIssues.length, highCount: employeeIssues.filter((x) => x.severity === "HIGH").length, lastAttendanceAt: lastEvent?.eventAt || "", pendingItems };
    });
    const score = Math.max(0, Math.round(100 - (issues.filter((i)=>i.severity==='HIGH').length * 7) - (issues.filter((i)=>i.severity==='MEDIUM').length * 3) - (issues.filter((i)=>i.severity==='LOW').length)));
    return ok({ score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد" : "يحتاج ضبط", rows, issues, counts: { employees: employees.length, issues: issues.length, high: issues.filter((i)=>i.severity==='HIGH').length, medium: issues.filter((i)=>i.severity==='MEDIUM').length, low: issues.filter((i)=>i.severity==='LOW').length }, generatedAt: now() });
  },
  executiveDailyReport: async () => {
    const db = loadDb();
    const mobile = unwrap(await localEndpoints.executiveMobile());
    const req = { summary: workflowSummary(db), rows: workflowItems(db) };
    const notes = unwrap(await localEndpoints.notificationMonitor());
    const quality = unwrap(await localEndpoints.employeeDataQuality());
    const employees = mobile.employees || [];
    const critical = [
      ...employees.filter((e) => e.today?.pendingLiveRequest).map((e) => ({ type: "LOCATION_PENDING", employee: e, title: "طلب موقع بانتظار الرد", route: `executive-mobile?employeeId=${e.id}` })),
      ...employees.filter((e) => !e.today?.latestLocation?.latitude && ["PRESENT", "LATE"].includes(e.today?.status)).map((e) => ({ type: "GPS_MISSING", employee: e, title: "حاضر بدون GPS حديث", route: `executive-mobile?employeeId=${e.id}` })),
      ...(quality.issues || []).filter((i) => i.severity === "HIGH").slice(0, 20).map((i) => ({ type: "DATA_QUALITY", employee: i.employee, title: i.title, route: `employee-archive?id=${i.employeeId}` })),
    ];
    return ok({ day: dateKey(), counts: mobile.counts || {}, requestSummary: req.summary, notificationMetrics: notes.metrics || {}, quality: quality.counts || {}, critical, employees, generatedAt: now() });
  },
  permissionOverview: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const users = db.users || [];
    const rows = (db.roles || []).map((role) => {
      const rolePerms = role.permissions || [];
      const employeeCount = employees.filter((employee) => employee.roleId === role.id || employee.role?.id === role.id || employee.role?.slug === role.slug).length;
      const userCount = users.filter((user) => user.roleId === role.id || user.role?.id === role.id || user.role?.slug === role.slug).length;
      const risk = rolePerms.includes("*") ? "FULL_ACCESS" : rolePerms.some((scope) => /users:manage|settings:manage|sensitive-actions:approve/i.test(scope)) ? "SENSITIVE" : "NORMAL";
      return { ...role, permissions: rolePerms, employeeCount, userCount, risk };
    });
    return ok({ roles: rows, permissions: db.permissions || [], employees, users, generatedAt: now() });
  },
  createAnnouncement: async (body = {}) => {
    const db = loadDb();
    const audience = body.audience || "all";
    const employees = visibleEmployees(db).filter((employee) => audience === "all" || employee.departmentId === audience || employee.branchId === audience);
    for (const employee of employees) {
      db.notifications.unshift({ id: makeId("not"), userId: employee.userId || "", employeeId: employee.id, title: body.title || "إعلان إداري", body: body.body || body.message || "", status: "UNREAD", isRead: false, type: body.type || "ANNOUNCEMENT", createdAt: now() });
    }
    db.employeeAnnouncements.unshift({ id: makeId("ann"), title: body.title || "إعلان إداري", body: body.body || body.message || "", audience, createdAt: now(), createdByUserId: currentUser(db)?.id || "" });
    audit(db, "create", "announcement", "bulk", null, { audience, count: employees.length });
    saveDb(db);
    return ok({ created: employees.length });
  },
  submitPunchNote: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = body.employeeId || user?.employeeId || user?.employee?.id || "";
    const employee = findById(db.employees || [], employeeId) || user?.employee || {};
    const note = String(body.note || "").trim().slice(0, 1000);
    if (!note) return ok({ created: 0 });
    const event = findById(db.attendanceEvents || [], body.attendanceEventId);
    if (event) event.notes = note;
    const recipients = ["emp-executive-secretary", "emp-hr-manager"].filter((id) => findById(db.employees || [], id));
    const title = `ملاحظة بصمة ${body.actionText || (String(body.type || "").includes("OUT") ? "انصراف" : "حضور")}`;
    const message = `${employee.fullName || user?.fullName || "موظف"}: ${note}`;
    notifyManyEmployees(db, recipients, title, message, "ACTION_REQUIRED");
    audit(db, "attendance.punch_note", "attendance_event", body.attendanceEventId || "", null, { employeeId, note, recipients });
    saveDb(db);
    return ok({ created: recipients.length, note });
  },
  markNotificationRead: async (id) => {
    const db = loadDb();
    const item = findById(db.notifications, id);
    if (item) {
      item.isRead = true;
      item.status = "READ";
      item.readAt = now();
    }
    saveDb(db);
    return ok(item);
  },
  reports: async () => {
    const db = loadDb();
    return ok({ jobs: db.reports, schedules: db.reportSchedules || [], templates: [
      { key: "attendance", name: "الحضور والانصراف" },
      { key: "employees", name: "بيانات الموظفين" },
      { key: "requests", name: "الطلبات والموافقات" },
      { key: "kpi", name: "تقييمات الأداء" },
      { key: "security", name: "الأمان ومحاولات الدخول" },
    ] });
  },
  exportReportData: async (body = {}) => {
    const db = loadDb();
    const key = body.reportKey || "attendance";
    if (key === "employees") {
      const headers = ["الاسم", "الهاتف", "البريد", "المسمى", "القسم", "الحالة"];
      const rows = visibleEmployees(db).map((employee) => [employee.fullName, employee.phone, employee.email, employee.jobTitle, employee.department?.name || "", employee.status || ""]);
      return ok({ title: "تقرير الموظفين", headers, rows });
    }
    if (key === "requests") {
      const headers = ["النوع", "العنوان", "الموظف", "الحالة", "آخر تحديث"];
      const rows = workflowItems(db).map((item) => [item.kindLabel, item.label, item.employee?.fullName || "", item.status || "", item.workflow?.at(-1)?.at || item.createdSort || ""]);
      return ok({ title: "تقرير الطلبات", headers, rows });
    }
    if (key === "kpi") {
      const payload = kpiSummaryRows(db, currentKpiCycle(db));
      const headers = ["الموظف", "المدير", "الإجمالي", "التقدير", "الحالة"];
      const rows = payload.map((item) => [item.employee?.fullName || item.employeeId, item.manager?.fullName || "", item.totalScore || "", item.rating || item.grade || "", item.status || ""]);
      return ok({ title: "تقرير تقييم الأداء", headers, rows });
    }
    if (key === "security") {
      const headers = ["العملية", "المستخدم", "الكيان", "الوقت"];
      const rows = (db.auditLogs || []).filter((log) => String(log.action || "").startsWith("auth.") || String(log.action || "").includes("device")).slice(0, 500).map((log) => [log.action, log.actor || "", log.entityType || "", log.createdAt || ""]);
      return ok({ title: "تقرير الأمان", headers, rows });
    }
    const headers = ["الموظف", "النوع", "الحالة", "الوقت", "المصدر", "ملاحظات"];
    const rows = scopedRowsByEmployee(db, db.attendanceEvents || []).map((event) => { const employee = findById(db.employees, event.employeeId); return [employee?.fullName || event.employeeId, event.type || "", event.status || event.geofenceStatus || "", event.eventAt || event.createdAt || "", event.source || "", event.notes || event.blockReason || ""]; });
    return ok({ title: "تقرير الحضور والانصراف", headers, rows });
  },
  saveReportSchedule: async (body = {}) => {
    const db = loadDb();
    const item = { id: makeId("sch"), title: body.title || "جدولة تقرير", reportKey: body.reportKey || "attendance", frequency: body.frequency || "monthly", recipients: body.recipients || "", active: true, createdAt: now() };
    db.reportSchedules.unshift(item);
    audit(db, "schedule", "report", item.id, null, item);
    saveDb(db);
    return ok(item);
  },
  createReport: async (body) => {
    const db = loadDb();
    const item = { id: makeId("rep"), title: body.title || "تقرير", reportKey: body.reportKey || "attendance", format: body.format || "csv", status: "COMPLETED", createdAt: now() };
    db.reports.unshift(item);
    audit(db, "create", "report", item.id, null, item);
    saveDb(db);
    return ok(item);
  },
  settings: async () => ok(loadDb().settings),
  updateSettings: async (body) => {
    const db = loadDb();
    Object.entries(body).forEach(([key, value]) => {
      let setting = db.settings.find((item) => item.key === key);
      if (!setting) {
        setting = { id: makeId("set"), key, value, scope: "custom" };
        db.settings.push(setting);
      } else {
        setting.value = value;
      }
    });
    audit(db, "update", "settings", "system", null, body);
    saveDb(db);
    return ok(db.settings);
  },
  kpi: async () => {
    const db = loadDb();
    const cycle = currentKpiCycle(db);
    const windowInfo = kpiWindowInfo(db, cycle);
    const allEvaluations = kpiSummaryRows(db, cycle);
    const ids = scopedEmployeeIds(db);
    const evaluations = allEvaluations.filter((item) => ids.has(item.employeeId));
    const evaluatedEmployeeIds = new Set(evaluations.map((item) => item.employeeId));
    const pendingEmployees = visibleEmployees(db).filter((employee) => employee.status !== "TERMINATED" && !evaluatedEmployeeIds.has(employee.id));
    const average = evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / evaluations.length) : 0;
    const progressMetrics = kpiProgressMetrics(evaluations, pendingEmployees);
    saveDb(db);
    return ok({
      policy: db.kpiPolicy,
      cycle: { ...cycle, window: windowInfo },
      windowInfo,
      criteria: [...(db.kpiCriteria || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
      evaluations,
      summaries: evaluations,
      pendingEmployees,
      progressMetrics,
      committee: db.disputeCommittee,
      accessMode: isFullAccessUser(db) ? "all" : hasLocalScope(db, "kpi:hr") ? "hr" : hasLocalScope(db, "kpi:team") ? "team" : hasLocalScope(db, "kpi:executive") || hasLocalScope(db, "kpi:final-approve") ? "executive" : "self",
      currentEmployeeId: currentUser(db)?.employeeId || "",
      metrics: [
        { label: "حالة نافذة KPI", value: windowInfo.label, helper: windowInfo.message },
        { label: "إجمالي الدرجة", value: "100", helper: "وفق النموذج المعتمد" },
        { label: "متوسط التقييم", value: average ? `${average}` : "-", helper: "للتقييمات المسجلة" },
        { label: "تم تقييمهم", value: evaluations.length, helper: "داخل الدورة الحالية" },
        { label: "لم يتم تقييمهم", value: pendingEmployees.length, helper: "قبل موعد 25 من الشهر" },
      ],
    });
  },
  saveKpiEvaluation: async (body = {}) => {
    const db = loadDb();
    if (!body.employeeId) throw new Error("اختر الموظف أولًا.");
    if (!canSeeEmployee(db, body.employeeId)) throw new Error("لا يمكنك تقييم هذا الموظف.");
    const user = currentUser(db);
    const isSelfTarget = body.employeeId === user?.employeeId;
    const selfOnly = isSelfTarget || (!isFullAccessUser(db) && !hasLocalScope(db, "kpi:team") && !hasLocalScope(db, "kpi:hr") && !hasLocalScope(db, "kpi:executive") && !hasLocalScope(db, "kpi:final-approve"));
    const managerReview = !isSelfTarget && hasLocalScope(db, "kpi:team") && !hasLocalScope(db, "kpi:hr") && !isFullAccessUser(db);
    const hrReview = !isSelfTarget && hasLocalScope(db, "kpi:hr") && !isFullAccessUser(db);
    const executiveReview = !isSelfTarget && (hasLocalScope(db, "kpi:executive") || hasLocalScope(db, "kpi:final-approve")) && !isFullAccessUser(db);
    const defaultStatus = selfOnly ? "SELF_SUBMITTED" : managerReview ? "MANAGER_APPROVED" : hrReview ? "HR_REVIEWED" : executiveReview ? "EXECUTIVE_APPROVED" : (body.status || "SECRETARY_REVIEWED");
    const mode = selfOnly ? "self" : managerReview ? "manager" : hrReview ? "hr" : executiveReview ? "executive" : "secretary";
    assertKpiSubmitAllowed(db, mode === "secretary" || mode === "executive" ? "admin" : mode);
    const normalized = normalizeKpiEvaluation(db, { ...body, status: canonicalKpiStatus(body.status || defaultStatus) });
    let evaluation = (db.kpiEvaluations || []).find((item) => item.employeeId === normalized.employeeId && item.cycleId === normalized.cycleId);
    const previous = evaluation || null;
    ensureKpiWorkflowTransition(db, previous, normalized, mode, user);
    if (managerReview) {
      normalized.attendanceScore = Number(previous?.attendanceScore ?? attendanceScoreForEmployee(db, normalized.employeeId, currentKpiCycle(db)) ?? 0);
      normalized.prayerScore = Number(previous?.prayerScore ?? 0);
      normalized.quranCircleScore = Number(previous?.quranCircleScore ?? 0);
      normalized.hrNotes = previous?.hrNotes || "";
    }
    if (hrReview) {
      normalized.targetScore = Number(previous?.targetScore ?? normalized.targetScore ?? 0);
      normalized.efficiencyScore = Number(previous?.efficiencyScore ?? normalized.efficiencyScore ?? 0);
      normalized.conductScore = Number(previous?.conductScore ?? normalized.conductScore ?? 0);
      normalized.initiativesScore = Number(previous?.initiativesScore ?? normalized.initiativesScore ?? 0);
      normalized.employeeNotes = previous?.employeeNotes || normalized.employeeNotes || "";
      normalized.managerNotes = previous?.managerNotes || normalized.managerNotes || "";
    }
    normalized.totalScore = ["targetScore", "efficiencyScore", "attendanceScore", "conductScore", "prayerScore", "quranCircleScore", "initiativesScore"].reduce((sum, key) => sum + Number(normalized[key] || 0), 0);
    normalized.grade = kpiGrade(normalized.totalScore);
    normalized.rating = kpiRating(normalized.totalScore);
    normalized.workflow ||= [];
    normalized.workflow.push({ at: now(), by: user?.name || "النظام", action: normalized.status, note: kpiStageLabel(normalized.status) });
    if (selfOnly) { normalized.managerNotes = ""; normalized.managerEmployeeId = findById(db.employees, normalized.employeeId)?.managerEmployeeId || ""; }
    if (evaluation) {
      const before = clone(evaluation);
      Object.assign(evaluation, normalized, { updatedAt: now() });
      audit(db, "update", "kpi_evaluation", evaluation.id, before, evaluation);
    } else {
      evaluation = { id: makeId("kpie"), createdAt: now(), ...normalized };
      db.kpiEvaluations.unshift(evaluation);
      audit(db, "create", "kpi_evaluation", evaluation.id, null, evaluation);
    }
    const targetEmployee = findById(db.employees, normalized.employeeId);
    const nextIds = normalized.status === "SELF_SUBMITTED" ? [targetEmployee?.managerEmployeeId] : normalized.status === "MANAGER_APPROVED" ? ["emp-hr-manager"] : normalized.status === "HR_REVIEWED" ? ["emp-executive-secretary"] : normalized.status === "SECRETARY_REVIEWED" ? ["emp-executive-director"] : [];
    notifyManyEmployees(db, nextIds.filter(Boolean), "تقييم KPI يحتاج متابعة", `${targetEmployee?.fullName || "موظف"} — ${kpiStageLabel(normalized.status)}`, "ACTION_REQUIRED");
    notify(db, "تم حفظ تقييم أداء", `${targetEmployee?.fullName || "موظف"} - ${normalized.totalScore}/100`, "SUCCESS");
    saveDb(db);
    return ok({ ...evaluation, employee: enrichEmployee(db, findById(db.employees, evaluation.employeeId)), manager: enrichEmployee(db, findById(db.employees, evaluation.managerEmployeeId)) });
  },
  updateKpiEvaluation: async (id, body = {}) => {
    const db = loadDb();
    const evaluation = findById(db.kpiEvaluations, id);
    if (!evaluation) throw new Error("التقييم غير موجود.");
    const before = clone(evaluation);
    if (!canSeeEmployee(db, evaluation.employeeId) || (!isFullAccessUser(db) && !hasLocalScope(db, "kpi:team") && !hasLocalScope(db, "kpi:hr") && !hasLocalScope(db, "kpi:manage") && !hasLocalScope(db, "kpi:executive") && !hasLocalScope(db, "kpi:final-approve"))) throw new Error("الاعتماد متاح للمدير المباشر أو HR أو الإدارة التنفيذية فقط.");
    const user = currentUser(db);
    const nextStatus = body.status ? canonicalKpiStatus(body.status) : canonicalKpiStatus(evaluation.status);
    const isSelfTarget = evaluation.employeeId === user?.employeeId;
    const mode = nextStatus === "MANAGER_APPROVED" ? "manager" : nextStatus === "HR_REVIEWED" ? "hr" : nextStatus === "EXECUTIVE_APPROVED" ? "executive" : nextStatus === "SECRETARY_REVIEWED" ? "secretary" : isSelfTarget ? "self" : "admin";
    ensureKpiWorkflowTransition(db, before, { ...evaluation, ...body, status: nextStatus }, mode, user);
    Object.assign(evaluation, body, { status: nextStatus, updatedAt: now(), managerEmployeeId: evaluation.managerEmployeeId || user?.employeeId || "" });
    recalculateKpiTotals(evaluation);
    evaluation.workflow ||= [];
    if (body.status) evaluation.workflow.push({ at: now(), by: user?.name || "النظام", action: nextStatus, note: body.managerNotes || body.hrNotes || body.secretaryNotes || body.executiveNotes || kpiStageLabel(nextStatus) });
    if (["APPROVED", "EXECUTIVE_APPROVED"].includes(nextStatus)) evaluation.approvedAt = now();
    if (["SUBMITTED", "SELF_SUBMITTED"].includes(nextStatus)) evaluation.submittedAt = now();
    const targetEmployee = findById(db.employees, evaluation.employeeId);
    const nextIds = nextStatus === "MANAGER_APPROVED" ? ["emp-hr-manager"] : nextStatus === "HR_REVIEWED" ? ["emp-executive-secretary"] : nextStatus === "SECRETARY_REVIEWED" ? ["emp-executive-director"] : [];
    notifyManyEmployees(db, nextIds.filter(Boolean), "تقييم KPI تم رفعه", `${targetEmployee?.fullName || "موظف"} — ${kpiStageLabel(nextStatus)}`, "ACTION_REQUIRED");
    audit(db, "workflow", "kpi_evaluation", id, before, evaluation);
    saveDb(db);
    return ok(evaluation);
  },
  recomputeKpi: async (body = {}) => {
    const db = loadDb();
    const cycle = currentKpiCycle(db);
    let recomputed = 0;
    visibleEmployees(db).forEach((employee) => {
      if ((db.kpiEvaluations || []).some((item) => item.employeeId === employee.id && item.cycleId === cycle.id)) return;
      const evaluation = { id: makeId("kpie"), createdAt: now(), ...normalizeKpiEvaluation(db, { employeeId: employee.id, managerEmployeeId: employee.managerEmployeeId, attendanceScore: attendanceScoreForEmployee(db, employee.id, cycle), status: "DRAFT", targetScore: 0, efficiencyScore: 0, conductScore: 0, prayerScore: 0, quranCircleScore: 0, initiativesScore: 0 }) };
      db.kpiEvaluations.unshift(evaluation);
      recomputed += 1;
    });
    audit(db, "recompute", "kpi", cycle.id, null, { recomputed, ...body });
    notify(db, "تم تجهيز دورة تقييم الأداء", `${recomputed} تقييم مبدئي`, "SUCCESS");
    saveDb(db);
    return ok({ recomputed, cycleId: cycle.id });
  },
  sendKpiReminders: async () => {
    const db = loadDb();
    const cycle = currentKpiCycle(db);
    const rows = kpiSummaryRows(db, cycle);
    const evaluated = new Set(rows.map((item) => item.employeeId));
    const pending = visibleEmployees(db).filter((employee) => employee.status !== "TERMINATED" && !evaluated.has(employee.id));
    const waitingManagers = rows.filter((item) => item.status === "SELF_SUBMITTED");
    const waitingHr = rows.filter((item) => item.status === "MANAGER_APPROVED");
    const waitingSecretary = rows.filter((item) => item.status === "HR_REVIEWED");
    const waitingExecutive = rows.filter((item) => item.status === "SECRETARY_REVIEWED");
    pending.forEach((employee) => notifyManyEmployees(db, [employee.id], "تذكير KPI", "يرجى إكمال تقييمك الذاتي خلال نافذة 20-25 من الشهر.", "ACTION_REQUIRED"));
    waitingManagers.forEach((item) => notifyManyEmployees(db, [item.managerEmployeeId], "اعتماد KPI مطلوب", `${item.employee?.fullName || item.employeeId} أرسل تقييمه وينتظر اعتمادك.`, "ACTION_REQUIRED"));
    if (waitingHr.length) notifyManyEmployees(db, ["emp-hr-manager"], "مراجعات HR مطلوبة", `${waitingHr.length} تقييم KPI ينتظر جزء HR.`, "ACTION_REQUIRED");
    if (waitingSecretary.length) notifyManyEmployees(db, ["emp-executive-secretary"], "مراجعة السكرتير التنفيذي مطلوبة", `${waitingSecretary.length} تقييم جاهز للمراجعة التنفيذية.`, "ACTION_REQUIRED");
    if (waitingExecutive.length) notifyManyEmployees(db, ["emp-executive-director"], "اعتماد المدير التنفيذي مطلوب", `${waitingExecutive.length} تقييم جاهز للاعتماد النهائي.`, "ACTION_REQUIRED");
    const sent = pending.length + waitingManagers.length + (waitingHr.length ? 1 : 0) + (waitingSecretary.length ? 1 : 0) + (waitingExecutive.length ? 1 : 0);
    audit(db, "remind", "kpi", cycle.id, null, { sent, pending: pending.length, waitingManagers: waitingManagers.length, waitingHr: waitingHr.length, waitingSecretary: waitingSecretary.length, waitingExecutive: waitingExecutive.length });
    saveDb(db);
    return ok({ sent, pending: pending.length, waitingManagers: waitingManagers.length, waitingHr: waitingHr.length, waitingSecretary: waitingSecretary.length, waitingExecutive: waitingExecutive.length });
  },
  closeKpiCycle: async () => {
    const db = loadDb();
    if (!isFullAccessUser(db) && !hasLocalScope(db, "kpi:final-approve")) throw new Error("إغلاق دورة KPI يحتاج السكرتير التنفيذي/التقني أو المدير التنفيذي.");
    const cycle = currentKpiCycle(db);
    const before = clone(cycle);
    cycle.status = "LOCKED";
    cycle.lockedAt = now();
    cycle.lockedByUserId = currentUser(db)?.id || "system";
    audit(db, "lock", "kpi_cycle", cycle.id, before, cycle);
    notify(db, "تم إغلاق دورة KPI", cycle.name || cycle.id, "SUCCESS");
    saveDb(db);
    return ok({ cycle, windowInfo: kpiWindowInfo(db, cycle) });
  },
  setKpiCycleStatus: async (body = {}) => {
    const db = loadDb();
    if (!isFullAccessUser(db) && !hasLocalScope(db, "kpi:final-approve") && !hasLocalScope(db, "kpi:manage")) throw new Error("فتح أو إغلاق دورة KPI يحتاج السكرتير التنفيذي أو HR.");
    const cycle = currentKpiCycle(db);
    const before = clone(cycle);
    const status = String(body.status || body.action || "OPEN").toUpperCase();
    cycle.status = ["LOCKED", "CLOSED"].includes(status) ? "LOCKED" : "OPEN";
    cycle.updatedAt = now();
    if (cycle.status === "LOCKED") {
      cycle.lockedAt = now();
      cycle.lockedByUserId = currentUser(db)?.id || "system";
    } else {
      cycle.openedAt = now();
      cycle.openedByUserId = currentUser(db)?.id || "system";
      cycle.lockedAt = "";
    }
    audit(db, "status", "kpi_cycle", cycle.id, before, cycle);
    notify(db, cycle.status === "OPEN" ? "تم فتح نموذج KPI" : "تم إغلاق نموذج KPI", cycle.name || cycle.id, "SUCCESS");
    saveDb(db);
    return ok({ cycle, windowInfo: kpiWindowInfo(db, cycle) });
  },
  disputes: async () => {
    const db = loadDb();
    return ok({ committee: db.disputeCommittee, cases: (db.disputeCases || []).map((item) => enrichByEmployee(db, item)) });
  },
  createDispute: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = body.employeeId || user?.employeeId || "";
    const employee = findById(db.employees, employeeId);
    const relatedEmployeeId = body.hasRelatedEmployee && body.relatedEmployeeId && body.relatedEmployeeId !== employeeId ? body.relatedEmployeeId : "";
    const relatedEmployee = relatedEmployeeId ? findById(db.employees, relatedEmployeeId) : null;
    const committeeIds = disputeCommitteeEmployeeIds(db);
    const item = { id: makeId("disp"), title: body.title || "شكوى / خلاف", employeeId, category: "شكوى", priority: body.priority || "MEDIUM", severity: body.severity || "MEDIUM", description: body.description || "", hasRelatedEmployee: Boolean(relatedEmployeeId), relatedEmployeeId, status: "IN_REVIEW", assignedCommittee: db.disputeCommittee?.members || [], assignedCommitteeEmployeeIds: committeeIds, committeeDecision: "", escalatedToExecutive: false, escalationPath: "اللجنة ← السكرتير التنفيذي ← المدير التنفيذي", workflow: [{ at: now(), by: user?.name || "النظام", action: "created", note: "تم إخطار لجنة حل المشاكل والخلافات" }], createdAt: now() };
    db.disputeCases.unshift(item);
    audit(db, "create", "dispute_case", item.id, null, item);
    notifyManyEmployees(db, committeeIds, `مشكلة جديدة من ${employee?.fullName || "موظف"}`, item.title, "ACTION_REQUIRED");
    if (relatedEmployee) notifyEmployee(db, relatedEmployee.id, "تم ذكرك كطرف في خلاف", "تم ذكرك كطرف في خلاف مع زميل آخر. سيتم التواصل معك من اللجنة عند الحاجة دون إظهار اسم مقدم الشكوى.", "ACTION_REQUIRED", { route: "action-center", disputeCaseId: item.id, privacyLevel: "anonymous_counterparty" });
    notify(db, "شكوى جديدة للجنة فض الخلافات", `${employee?.fullName || "موظف"}: ${item.title}`, "ACTION_REQUIRED");
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  updateDispute: async (id, body = {}) => {
    const db = loadDb();
    const item = findById(db.disputeCases, id);
    if (!item) throw new Error("الشكوى غير موجودة.");
    const before = clone(item);
    Object.assign(item, {
      status: body.status || item.status,
      committeeDecision: body.committeeDecision ?? item.committeeDecision,
      resolution: body.resolution ?? item.resolution,
      escalatedToExecutive: body.escalatedToExecutive === "on" || body.escalatedToExecutive === true || body.status === "ESCALATED",
      executiveEscalationReason: body.executiveEscalationReason ?? item.executiveEscalationReason,
      updatedAt: now(),
    });
    item.workflow ||= [];
    item.workflow.push({ at: now(), by: currentUser(db)?.name || "النظام", action: item.status });
    if (["RESOLVED", "CLOSED"].includes(item.status)) item.resolvedAt = now();
    if (item.escalatedToExecutive) {
      notifyManyEmployees(db, ["emp-executive-secretary", "emp-executive-director"], `تم رفع مشكلة للمدير التنفيذي`, item.title || item.description || "شكوى", "ACTION_REQUIRED");
    }
    audit(db, "workflow", "dispute_case", id, before, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  queue: async () => ok({ enabled: false }),
  permissions: async () => ok(loadDb().permissions),
  roles: async () => ok(loadDb().roles),
  saveRole: async (body) => {
    const db = loadDb();
    let role = body.id ? findById(db.roles, body.id) : null;
    if (role) {
      const before = clone(role);
      Object.assign(role, { name: body.name, key: body.key || body.slug || role.key, slug: body.slug || body.key || role.slug, description: body.description || "", permissions: Array.isArray(body.permissions) ? body.permissions : String(body.permissions || "").split(",").filter(Boolean) });
      audit(db, "update", "role", role.id, before, role);
    } else {
      role = { id: makeId("role"), name: body.name, key: body.key || body.slug || "CUSTOM", slug: body.slug || body.key || "custom", description: body.description || "", permissions: Array.isArray(body.permissions) ? body.permissions : String(body.permissions || "").split(",").filter(Boolean) };
      db.roles.unshift(role);
      audit(db, "create", "role", role.id, null, role);
    }
    saveDb(db);
    return ok(role);
  },
  branches: async () => ok(activeItems(loadDb(), "branches")),
  departments: async () => ok(activeItems(loadDb(), "departments")),
  governorates: async () => ok(activeItems(loadDb(), "governorates")),
  complexes: async () => ok(activeItems(loadDb(), "complexes")),
  listOrg: async (kind) => {
    const db = loadDb();
    return ok(activeItems(db, orgKeyMap[kind] || kind));
  },
  saveOrg: async (kind, body) => {
    const db = loadDb();
    const item = saveOrgLocal(db, kind, body);
    saveDb(db);
    return ok(item);
  },
  deleteOrg: async (kind, id) => {
    const db = loadDb();
    const key = orgKeyMap[kind] || kind;
    const item = findById(db[key], id);
    if (!item) throw new Error("العنصر غير موجود.");
    const before = clone(item);
    item.active = false;
    item.isDeleted = true;
    audit(db, "soft_delete", key, id, before, item);
    saveDb(db);
    return ok(item);
  },
  attachments: async (scope, entityId) => {
    const db = loadDb();
    return ok(db.attachments.filter((item) => (!scope || item.scope === scope) && (!entityId || item.entityId === entityId || item.employeeId === entityId)));
  },
  uploadAttachment: async (file, body = {}) => {
    if (!file) throw new Error("اختر ملفًا أولًا.");
    if (file.size > 8 * 1024 * 1024) throw new Error("الملف كبير. الحد الحالي 8MB في النسخة المحلية.");
    const url = await localEndpoints.uploadAvatar(file);
    const db = loadDb();
    const item = { id: makeId("attch"), scope: body.scope || "EMPLOYEE", entityId: body.entityId || body.employeeId || "general", employeeId: body.employeeId || body.entityId || "", fileName: file.name, originalName: file.name, mimeType: file.type, sizeBytes: file.size, url, createdAt: now() };
    db.attachments.unshift(item);
    audit(db, "upload", "attachment", item.id, null, { ...item, url: "data-url" });
    saveDb(db);
    return ok(item);
  },
  uploadAvatar: async (file) => {
    if (!file) return "";
    if (!String(file.type || "").startsWith("image/")) throw new Error("اختر صورة فقط.");
    if (file.size > 8 * 1024 * 1024) throw new Error("الصورة كبيرة جدًا. الحد الأقصى 8MB قبل الضغط.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
    const maxSide = 520;
    const scale = Math.min(1, maxSide / Math.max(img.width || maxSide, img.height || maxSide));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.width || maxSide) * scale));
    canvas.height = Math.max(1, Math.round((img.height || maxSide) * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL("image/jpeg", 0.76);
    if (compressed.length > 650_000) throw new Error("تعذر ضغط الصورة بما يكفي للحفظ المحلي. استخدم صورة أصغر أو فعّل Supabase Storage.");
    return compressed;
  },
  backup: async () => ok(loadDb()),
  restoreBackup: async (db) => {
    const restored = normalizeDb(db);
    audit(restored, "restore", "backup", "local", null, { restoredAt: now() });
    saveDb(restored);
    return ok({ ok: true });
  },
  saveBackupSnapshot: async (body = {}) => {
    const db = loadDb();
    const snapshot = { id: makeId("bak"), title: body.title || `نسخة احتياطية ٢٩‏/٤‏/٢٠٢٦، ٢:٥٩:٢٦ م`, createdAt: now(), counts: { employees: (db.employees || []).length, users: (db.users || []).length, attendance: (db.attendanceEvents || []).length }, data: clone(db) };
    db.systemBackups.unshift(snapshot);
    db.systemBackups = db.systemBackups.slice(0, 10);
    audit(db, "snapshot", "backup", snapshot.id, null, { title: snapshot.title, counts: snapshot.counts });
    saveDb(db);
    return ok({ ...snapshot, data: undefined });
  },
  importEmployees: async (rows) => {
    const db = loadDb();
    let created = 0;
    rows.forEach((row) => {
      const employee = applyEmployeePayload(db, { id: makeId("emp"), isDeleted: false, userId: "" }, {
        fullName: row.fullName || row.name || row["الاسم"],
        phone: row.phone || row["الموبايل"],
        email: row.email || row["البريد"],
        jobTitle: row.jobTitle || row["الوظيفة"],
        roleId: row.roleId || "role-employee",
        branchId: row.branchId || db.branches[0]?.id,
        departmentId: row.departmentId || db.departments[0]?.id,
        governorateId: row.governorateId || db.governorates[0]?.id,
        complexId: row.complexId || db.complexes[0]?.id,
        status: row.status || "ACTIVE",
      });
      db.employees.unshift(employee);
      created += 1;
    });
    audit(db, "import", "employees", "bulk", null, { count: created });
    saveDb(db);
    return ok({ created, pushed: 0 });
  },
  realtimeSnapshot: async () => {
    const db = loadDb();
    return ok({ dashboard: dashboard(db), locations: latestLocations(db), heatmap: latestLocations(db).map((loc) => ({ employeeId: loc.employeeId, name: loc.employee?.fullName || loc.employeeId, latitude: loc.latitude, longitude: loc.longitude, weight: 1, date: loc.date || loc.createdAt })), realtime: { transport: "local", updatedAt: now() } });
  },
  aiAnalytics: async () => ok({ generatedAt: now(), rows: analyticsRows(loadDb()), note: "تحليل تقديري محلي يعتمد على التأخير والغياب آخر 30 يومًا وليس بديلاً عن قرار إداري." }),
  integrations: async () => ok(loadDb().integrationSettings || []),
  saveIntegration: async (body = {}) => {
    const db = loadDb();
    let item = (db.integrationSettings || []).find((row) => row.key === body.key || row.id === body.id);
    if (!item) { item = { id: makeId("int"), key: body.key || makeId("key"), name: body.name || body.key || "تكامل", provider: body.provider || "custom", createdAt: now() }; db.integrationSettings.unshift(item); }
    Object.assign(item, { enabled: body.enabled === "on" || body.enabled === true, status: body.status || item.status || "CONFIGURED", notes: body.notes || item.notes || "", updatedAt: now() });
    audit(db, "update", "integration", item.id, null, item);
    saveDb(db);
    return ok(item);
  },
  accessControlEvents: async () => ok((loadDb().accessControlEvents || []).map((event) => enrichByEmployee(loadDb(), event))),
  createAccessEvent: async (body = {}) => {
    const db = loadDb();
    const item = { id: makeId("door"), employeeId: body.employeeId || currentUser(db)?.employeeId || "", deviceId: body.deviceId || "main-gate", direction: body.direction || "ENTRY", decision: body.decision || "ALLOW", reason: body.reason || "تحقق مزدوج: حساب + حضور", date: now() };
    db.accessControlEvents.unshift(item);
    audit(db, "record", "access_control", item.id, null, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  uploadPunchSelfie: async (body = {}) => {
    const file = body.file || null;
    if (!file) return ok({ url: "" });
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("تعذر قراءة صورة السيلفي محليا."));
      reader.readAsDataURL(file);
    });
    return ok({ url, localPreviewOnly: true });
  },
  subscribePush: async (body = {}) => {
    const db = loadDb();
    const item = { id: makeId("push"), userId: currentUser(db)?.id || "local", employeeId: currentUser(db)?.employeeId || currentUser(db)?.employee?.id || "", endpoint: body.endpoint || "local-notification", keys: body.keys || {}, permission: body.permission || globalThis.Notification?.permission || "default", userAgent: body.userAgent || "", platform: body.platform || "browser", isActive: true, createdAt: now() };
    db.pushSubscriptions.unshift(item);
    notify(db, "تم تفعيل إشعارات المتصفح", "ستظهر تنبيهات الحضور والانصراف والطلبات عند السماح من المتصفح.", "SUCCESS");
    saveDb(db);
    return ok(item);
  },
  passkeyStatus: async () => ok(loadDb().passkeyCredentials || []),
  registerPasskey: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const item = { id: makeId("passkey"), userId: user?.id || "local", employeeId: user?.employeeId || "", label: body.label || "مفتاح مرور المتصفح", credentialId: body.credentialId || makeId("credential"), platform: body.platform || navigator.platform || "browser", deviceFingerprintHash: body.deviceFingerprintHash || "", trusted: body.trusted !== false, status: "DEVICE_TRUSTED", createdAt: now(), lastUsedAt: "", browserSupported: browserSupportsWebAuthn() };
    db.passkeyCredentials.unshift(item);
    if (user) { const raw = findById(db.users, user.id); if (raw) raw.passkeyEnabled = true; }
    audit(db, "register", "passkey", item.id, null, { ...item, credentialId: "stored-client-side-demo" });
    saveDb(db);
    return ok(item);
  },
  trustedDeviceApprovalRequests: async () => {
    const db = loadDb();
    db.trustedDeviceApprovalRequests ||= [];
    return ok(db.trustedDeviceApprovalRequests);
  },
  requestTrustedDeviceApproval: async (body = {}) => {
    const db = loadDb();
    db.trustedDeviceApprovalRequests ||= [];
    const employeeId = body.employeeId || currentUser(db)?.employeeId || "";
    let item = db.trustedDeviceApprovalRequests.find((row) => row.employeeId === employeeId && row.deviceFingerprintHash === body.deviceFingerprintHash);
    if (!item) {
      item = { id: makeId("devreq"), employeeId, userId: currentUser(db)?.id || "local", deviceFingerprintHash: body.deviceFingerprintHash || "", deviceName: body.deviceName || "Browser device", userAgent: body.userAgent || "", selfieUrl: body.selfieUrl || "", latitude: body.latitude ?? null, longitude: body.longitude ?? null, accuracyMeters: body.accuracyMeters ?? null, status: "PENDING", createdAt: now() };
      db.trustedDeviceApprovalRequests.unshift(item);
    } else {
      Object.assign(item, { status: item.status === "REJECTED" ? "PENDING" : item.status, updatedAt: now(), selfieUrl: body.selfieUrl || item.selfieUrl });
    }
    audit(db, "request", "trusted_device", item.id, null, item);
    saveDb(db);
    return ok({ requestId: item.id, status: item.status });
  },
  reviewTrustedDeviceApproval: async (body = {}) => {
    const db = loadDb();
    db.trustedDeviceApprovalRequests ||= [];
    const item = db.trustedDeviceApprovalRequests.find((row) => row.id === (body.requestId || body.id));
    if (!item) throw new Error("طلب اعتماد الجهاز غير موجود.");
    item.status = body.decision || "APPROVED";
    item.reason = body.reason || "";
    item.reviewedAt = now();
    audit(db, "review", "trusted_device", item.id, null, item);
    saveDb(db);
    return ok(item);
  },
  validateBranchQrChallenge: async (body = {}) => ({ valid: true, status: "DISABLED", challengeId: "", disabled: true }),
  createBranchQrChallenge: async (body = {}) => ({ disabled: true, status: "DISABLED", message: "QR متوقف في هذه النسخة ولا يتم إنشاء أكواد فرع." }),
  attendanceRiskCenter: async () => {
    const db = loadDb();
    const events = (db.attendanceEvents || []).filter((event) => event.requiresReview || Number(event.riskScore || 0) >= 35 || (event.antiSpoofingFlags || []).length);
    const rows = events.map((event) => { const enriched = enrichByEmployee(db, event); return { ...enriched, employee: enriched.employee, employeeId: enriched.employeeId, score: enriched.riskScore || 0, level: enriched.riskLevel || "MEDIUM", flags: [...(enriched.riskFlags || []), ...(enriched.antiSpoofingFlags || [])].map((flag) => ({ label: flag })), events: [enriched] }; });
    const counts = rows.reduce((acc, row) => { acc[row.level] = (acc[row.level] || 0) + 1; return acc; }, {});
    return ok({ rows, counts, rules: ["اعتماد الجهاز", "QR متوقف", "سيلفي", "GPS anti-spoofing", "تصعيد HR"] });
  },
  acknowledgeAttendancePolicy: async (body = {}) => {
    const db = loadDb();
    db.attendancePolicyAcknowledgements ||= [];
    const employeeId = body.employeeId || currentUser(db)?.employeeId || "";
    const policyVersion = body.policyVersion || "attendance-identity-v3";
    let item = db.attendancePolicyAcknowledgements.find((row) => row.employeeId === employeeId && row.policyVersion === policyVersion);
    if (!item) { item = { id: makeId("ack"), employeeId, userId: currentUser(db)?.id || "local", policyVersion, createdAt: now() }; db.attendancePolicyAcknowledgements.unshift(item); }
    Object.assign(item, { deviceFingerprintHash: body.deviceFingerprintHash || "", browserInstallId: body.browserInstallId || "", userAgent: body.userAgent || "", acknowledgedAt: now() });
    saveDb(db);
    return ok({ id: item.id, ok: true });
  },
  offlineQueue: async () => ok(loadDb().offlineQueue || []),
  syncOfflineQueue: async () => {
    const db = loadDb();
    let synced = 0;
    const MAX_ATTEMPTS = 5;
    for (const item of db.offlineQueue || []) {
      if (item.status !== "PENDING") continue;
      try {
        /* Re-execute the originally-failed HTTP request */
        await apiRequest(item.path, { method: item.method || "POST", body: item.body || undefined });
        item.status = "SYNCED";
        item.syncedAt = now();
        synced += 1;
      } catch (err) {
        item.attempts = (item.attempts || 0) + 1;
        item.error = err?.message || "تعذر المزامنة";
        /* Give up after MAX_ATTEMPTS so stale items don't block the queue indefinitely */
        if (item.attempts >= MAX_ATTEMPTS) item.status = "FAILED";
      }
    }
    audit(db, "sync", "offline_queue", "bulk", null, { synced });
    saveDb(db);
    return ok({ synced, remaining: (db.offlineQueue || []).filter((item) => item.status === "PENDING").length });
  },
  managementStructure: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const candidates = managerCandidates(db);
    const teamManagers = candidates.map((manager) => {
      const team = allTeamFor(db, manager.id);
      const pendingKpi = team.filter((employee) => !["EXECUTIVE_APPROVED", "APPROVED"].includes(employeeKpiStatus(db, employee.id))).length;
      const pendingRequests = team.reduce((sum, employee) => sum + pendingCountForEmployee(db, employee.id), 0);
      return { manager, teamCount: team.length, activeCount: team.filter((employee) => employee.status === "ACTIVE").length, pendingKpi, pendingRequests };
    });
    const byRole = (roleId) => employees.filter((employee) => employee.roleId === roleId).map((employee) => ({ ...employee, teamCount: allTeamFor(db, employee.id).length }));
    const levels = [
      { key: "executive", label: "المدير التنفيذي", people: byRole("role-executive") },
      { key: "secretary", label: "السكرتير التنفيذي/التقني", people: byRole("role-executive-secretary") },
      { key: "first-line", label: "الصف الأول من المديرين", people: employees.filter((employee) => employee.roleId === "role-manager" && employee.managerEmployeeId === "emp-executive-director").map((employee) => ({ ...employee, teamCount: allTeamFor(db, employee.id).length })) },
      { key: "hr", label: "الموارد البشرية", people: byRole("role-hr") },
      { key: "employees", label: "الموظفون", people: employees.filter((employee) => employee.roleId === "role-employee").map((employee) => ({ ...employee, teamCount: 0 })) },
    ];
    return ok({
      metrics: [
        { label: "إجمالي الموظفين", value: employees.length, helper: "داخل صلاحيتك" },
        { label: "مديرون مباشرون", value: candidates.filter((employee) => employee.roleId === "role-manager").length, helper: "صفوف إدارة" },
        { label: "بلا مدير", value: employees.filter((employee) => employee.roleId === "role-employee" && !employee.managerEmployeeId).length, helper: "تحتاج ربط" },
        { label: "فرق نشطة", value: teamManagers.filter((row) => row.teamCount > 0).length, helper: "لديها أعضاء" },
      ],
      employees,
      managerOptions: candidates,
      levels,
      managerTeams: teamManagers,
    });
  },
  assignManager: async (body = {}) => {
    const db = loadDb();
    const employee = findById(db.employees || [], body.employeeId);
    if (!employee) throw new Error("الموظف غير موجود.");
    if (body.managerEmployeeId && body.managerEmployeeId === body.employeeId) throw new Error("لا يمكن جعل الموظف مديرًا لنفسه.");
    const before = clone(employee);
    employee.managerEmployeeId = body.managerEmployeeId || "";
    employee.updatedAt = now();
    audit(db, "organization.assign_manager", "employee", employee.id, before, { managerEmployeeId: employee.managerEmployeeId, note: body.note || "" });
    if (employee.managerEmployeeId) notifyEmployee(db, employee.managerEmployeeId, "تم ربط موظف بفريقك", `${employee.fullName} أصبح ضمن فريقك المباشر.`, "INFO");
    saveDb(db);
    return ok(enrichEmployee(db, employee));
  },
  teamDashboard: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const managerId = body.managerId || user?.employeeId || "";
    const manager = findById(db.employees || [], managerId) || findById(db.employees || [], user?.employeeId);
    const full = isFullAccessUser(db);
    if (!full && manager?.id !== user?.employeeId && !canSeeEmployee(db, manager?.id)) throw new Error("لا تملك صلاحية فتح فريق هذا المدير.");
    const team = allTeamFor(db, manager?.id || user?.employeeId || "").filter((employee) => full || scopedEmployeeIds(db).has(employee.id));
    const rows = team.map((employee) => {
      const today = todayStatusForEmployee(db, employee.id);
      return { ...employee, todayStatus: today.status, lastEventAt: today.at, kpiStatus: employeeKpiStatus(db, employee.id), pendingItems: pendingCountForEmployee(db, employee.id) };
    });
    const present = rows.filter((row) => ["PRESENT", "LATE", "CHECK_IN", "MANUAL_APPROVED"].includes(row.todayStatus)).length;
    const pending = workflowItems(db).filter((item) => rows.some((employee) => employee.id === item.employeeId) && ["PENDING", "IN_REVIEW", "OPEN"].includes(item.status));
    return ok({
      manager: manager ? enrichEmployee(db, manager) : null,
      team: rows,
      pending,
      metrics: [
        { label: "حجم الفريق", value: rows.length, helper: "كل التابعين" },
        { label: "حاضر اليوم", value: present, helper: "حضور/تأخير" },
        { label: "KPI معلق", value: rows.filter((row) => !["APPROVED", "EXECUTIVE_APPROVED"].includes(row.kpiStatus)).length, helper: "لم يغلق" },
        { label: "طلبات معلقة", value: pending.length, helper: "تحتاج متابعة" },
      ],
    });
  },
  sendTeamReminder: async (body = {}) => {
    const db = loadDb();
    const user = currentUser(db);
    const managerId = body.managerId || user?.employeeId || "";
    const team = allTeamFor(db, managerId);
    let sent = 0;
    team.forEach((employee) => { notifyEmployee(db, employee.id, "تذكير من المدير المباشر", body.message || "يرجى مراجعة الحضور والطلبات وKPI المطلوب.", "ACTION_REQUIRED"); sent += 1; });
    audit(db, "team.reminder", "employee", managerId, null, { sent });
    saveDb(db);
    return ok({ sent });
  },
  hrOperations: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const today = dateKey();
    const attendanceIssues = employees.map((employee) => analyseAttendanceForEmployee(db, employee, today)).filter((row) => row.requiresReview || ["ABSENT_TEMP", "ABSENT", "LATE", "MISSING_CHECKOUT", "REVIEW"].includes(row.status)).slice(0, 80);
    const kpiForHr = kpiSummaryRows(db).filter((row) => ["MANAGER_APPROVED", "HR_REVIEWED"].includes(row.status)).slice(0, 80);
    const dataIssues = [];
    employees.forEach((employee) => {
      if (!employee.managerEmployeeId && employee.roleId === "role-employee") dataIssues.push({ employee, issue: "لا يوجد مدير مباشر" });
      if (!employee.userId && !employee.user?.id) dataIssues.push({ employee, issue: "لا يوجد حساب دخول مرتبط" });
      if (!employee.phone && !employee.email) dataIssues.push({ employee, issue: "لا يوجد هاتف أو بريد" });
    });
    return ok({
      metrics: [
        { label: "الموظفون", value: employees.length, helper: "داخل HR" },
        { label: "حضور يحتاج مراجعة", value: attendanceIssues.length, helper: today },
        { label: "KPI عند HR", value: kpiForHr.length, helper: "بنود HR فقط" },
        { label: "بيانات ناقصة", value: dataIssues.length, helper: "تحتاج استكمال" },
      ],
      attendanceIssues,
      kpiForHr,
      dataIssues,
    });
  },
  disputeWorkflow: async () => {
    const db = loadDb();
    const committeeMembers = hrCommitteeEmployeeIds(db).map((id) => enrichEmployee(db, findById(db.employees || [], id))).filter(Boolean);
    const cases = (db.disputeCases || []).map((item) => enrichByEmployee(db, item)).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    return ok({
      workflowSteps: ["الموظف يقدم الشكوى", "المدير المباشر يراجع", "لجنة حل المشكلات تراجع", "السكرتير التنفيذي ينسق ويرفع", "المدير التنفيذي يعتمد عند التصعيد"],
      committeeMembers,
      cases,
    });
  },
  advanceDispute: async (id, body = {}) => {
    const db = loadDb();
    const item = findById(db.disputeCases || [], id);
    if (!item) throw new Error("الشكوى غير موجودة.");
    const before = clone(item);
    item.status = body.status || item.status || "IN_REVIEW";
    item.committeeDecision = body.note || item.committeeDecision || "تمت المراجعة";
    item.escalatedToExecutive = item.status === "ESCALATED" || item.escalatedToExecutive === true;
    item.updatedAt = now();
    item.workflow ||= [];
    item.workflow.push({ at: now(), by: currentUser(db)?.name || "النظام", action: item.status, note: body.note || "" });
    if (item.status === "ESCALATED") notifyManyEmployees(db, ["emp-executive-secretary", "emp-executive-director"], "شكوى مصعدة تحتاج قرار", item.title || "شكوى", "ACTION_REQUIRED");
    if (["RESOLVED", "CLOSED"].includes(item.status)) item.resolvedAt = now();
    audit(db, "dispute.advance", "dispute_case", id, before, item);
    saveDb(db);
    return ok(enrichByEmployee(db, item));
  },
  reportCenter: async () => {
    const db = loadDb();
    const employees = visibleEmployees(db);
    const rows = [
      { key: "attendance", title: "تقرير الحضور والانصراف", description: "حضور، انصراف، تأخير، ومراجعات", scope: "HR/مدير", count: (db.attendanceEvents || []).length, generatedAt: now() },
      { key: "kpi", title: "تقرير KPI الشهري", description: "درجات وتقدم دورة التقييم", scope: "مدير/HR/تنفيذي", count: (db.kpiEvaluations || []).length, generatedAt: now() },
      { key: "teams", title: "تقرير الفرق والمديرين", description: "توزيع الموظفين على المديرين", scope: "الإدارة", count: managerCandidates(db).length, generatedAt: now() },
      { key: "disputes", title: "تقرير الشكاوى والتصعيد", description: "الشكاوى حسب المرحلة والقرار", scope: "اللجنة/السكرتير", count: (db.disputeCases || []).length, generatedAt: now() },
      { key: "hr", title: "تقرير HR التشغيلي", description: "بيانات ناقصة وKPI وحضور يحتاج مراجعة", scope: "HR", count: employees.length, generatedAt: now() },
    ];
    return ok({ rows, metrics: [
      { label: "تقارير جاهزة", value: rows.length, helper: "CSV/Excel/PDF" },
      { label: "موظفون", value: employees.length, helper: "ضمن الصلاحيات" },
      { label: "KPI", value: (db.kpiEvaluations || []).length, helper: "كل الدورات" },
      { label: "شكاوى", value: (db.disputeCases || []).length, helper: "كل الحالات" },
    ] });
  },
  exportManagementReport: async (body = {}) => {
    const db = loadDb();
    const key = body.key || "attendance";
    const titleMap = { attendance: "تقرير الحضور والانصراف", kpi: "تقرير KPI الشهري", teams: "تقرير الفرق والمديرين", disputes: "تقرير الشكاوى والتصعيد", hr: "تقرير HR التشغيلي" };
    let headers = [], rows = [];
    if (key === "kpi") { headers = ["الموظف", "المدير", "الإجمالي", "الحالة", "الدورة"]; rows = kpiSummaryRows(db).map((row) => [row.employee?.fullName || row.employeeId, row.manager?.fullName || "-", row.totalScore || 0, row.status || "DRAFT", row.cycle?.name || row.cycleId]); }
    else if (key === "teams") { headers = ["المدير", "حجم الفريق", "نشط", "KPI معلق", "طلبات معلقة"]; rows = managerCandidates(db).map((manager) => { const team = allTeamFor(db, manager.id); return [manager.fullName, team.length, team.filter((e) => e.status === "ACTIVE").length, team.filter((e) => !["APPROVED", "EXECUTIVE_APPROVED"].includes(employeeKpiStatus(db, e.id))).length, team.reduce((sum, e) => sum + pendingCountForEmployee(db, e.id), 0)]; }); }
    else if (key === "disputes") { headers = ["العنوان", "الموظف", "الحالة", "الأولوية", "القرار"]; rows = (db.disputeCases || []).map((row) => { const emp = findById(db.employees || [], row.employeeId); return [row.title, emp?.fullName || "-", row.status || "OPEN", row.priority || "MEDIUM", row.committeeDecision || row.resolution || ""]; }); }
    else if (key === "hr") { const hr = await localEndpoints.hrOperations().then((r) => r.data || r); headers = ["المؤشر", "القيمة", "ملاحظة"]; rows = (hr.metrics || []).map((m) => [m.label, m.value, m.helper || ""]); }
    else { headers = ["الموظف", "النوع", "التاريخ", "المصدر", "الموقع", "ملاحظات"]; rows = scopedRowsByEmployee(db, db.attendanceEvents || []).map((event) => [enrichByEmployee(db, event).employee?.fullName || event.employeeId, event.type || event.status || "-", event.eventAt || event.createdAt || "", event.source || "-", event.geofenceStatus || "-", event.notes || ""]); }
    return ok({ title: titleMap[key] || "تقرير", fileName: key + "-report", headers, rows, summaryHtml: `<div class="summary"><div><span>عدد السجلات</span><strong>${rows.length}</strong></div><div><span>تاريخ الإصدار</span><strong>${now().slice(0,10)}</strong></div></div>` });
  },
  managerDashboard: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const full = isFullAccessUser(db);
    const teamIds = scopedEmployeeIds(db, { includeTeam: true });
    const todayMap = todayEventsByEmployee(db);
    const today = now().slice(0, 10);
    const team = db.employees
      .filter((employee) => !employee.isDeleted && (full || teamIds.has(employee.id) || employee.managerEmployeeId === user?.employeeId))
      .map((employee) => {
        const event = todayMap.get(employee.id);
        const pendingItems = (db.leaves || []).filter((item) => item.employeeId === employee.id && isPendingRequestStatus(item.status)).length
          + (db.missions || []).filter((item) => item.employeeId === employee.id && isPendingRequestStatus(item.status)).length
          + (db.exceptions || []).filter((item) => item.employeeId === employee.id && isPendingRequestStatus(item.status)).length;
        return { ...enrichEmployee(db, employee), todayStatus: event?.status || event?.type || "ABSENT", lastEventAt: event?.eventAt || "", pendingItems };
      });
    const present = team.filter((item) => ["PRESENT", "LATE", "CHECK_IN"].includes(item.todayStatus)).length;
    const actions = [
      ...team.filter((item) => item.todayStatus === "ABSENT").slice(0, 5).map((item) => ({ title: `لم يسجل ${item.fullName} بصمة اليوم`, body: "يمكن إرسال تنبيه من لوحة المدير.", status: "ACTION_REQUIRED" })),
      ...team.filter((item) => item.pendingItems > 0).slice(0, 5).map((item) => ({ title: `${item.fullName} لديه طلبات معلقة`, body: `${item.pendingItems} طلب/طلبات تحتاج متابعة.`, status: "PENDING" })),
    ];
    return ok({
      team,
      metrics: [
        { label: "الفريق", value: team.length, helper: "حسب صلاحيات المدير" },
        { label: "حاضر اليوم", value: present, helper: "حضور أو تأخير" },
        { label: "لم يبصم", value: Math.max(team.length - present, 0), helper: today },
        { label: "طلبات معلقة", value: team.reduce((sum, item) => sum + item.pendingItems, 0), helper: "إجازات/مأموريات/تعديلات" },
      ],
      actions,
    });
  },
  generateAttendanceAlerts: async () => {
    const db = loadDb();
    const todayMap = todayEventsByEmployee(db);
    const today = now().slice(0, 10);
    let created = 0;
    visibleEmployees(db).forEach((employee) => {
      if (todayMap.has(employee.id)) return;
      const existing = (db.notifications || []).some((item) => item.employeeId === employee.id && item.type === "MISSING_PUNCH" && String(item.createdAt || "").startsWith(today));
      if (existing) return;
      db.notifications.unshift({
        id: makeId("not"),
        userId: employee.userId || "",
        employeeId: employee.id,
        title: "تذكير بتسجيل البصمة",
        body: "لم يتم تسجيل بصمة حضور اليوم حتى الآن. افتح صفحة البصمة وسجل حضورك عند الوصول للمجمع.",
        status: "UNREAD",
        isRead: false,
        type: "MISSING_PUNCH",
        createdAt: now(),
      });
      created += 1;
    });
    audit(db, "notify.missing_punch", "attendance", "bulk", null, { created });
    saveDb(db);
    return ok({ created, pushed: 0 });
  },
  rejectedPunches: async () => {
    const db = loadDb();
    const rows = scopedRowsByEmployee(db, db.attendanceEvents || [])
      .filter((event) => event.status === "REJECTED" || event.requiresReview || (event.riskFlags || []).includes("rejected_punch"))
      .filter((event) => event.status !== "REJECTED_CONFIRMED" && event.verificationStatus !== "manual_approved")
      .map((event) => enrichByEmployee(db, event))
      .sort((a, b) => new Date(b.eventAt || 0) - new Date(a.eventAt || 0));
    return ok(rows);
  },
  reviewRejectedPunch: async (eventId, action = "approve", checkId = "") => {
    const db = loadDb();
    const event = findById(db.attendanceEvents, eventId);
    if (!event) throw new Error("محاولة البصمة غير موجودة.");
    const before = clone(event);
    if (action === "approve") {
      event.status = "MANUAL_APPROVED";
      event.verificationStatus = "manual_approved";
      event.requiresReview = false;
      event.reviewDecision = "APPROVED";
      event.reviewedAt = now();
      event.reviewedByUserId = currentUser(db)?.id || "";
      event.notes = `${event.notes || ""} — تم اعتمادها يدويًا`.trim();
      upsertDailyFromEvent(db, event.employeeId, event);
    } else {
      event.status = "REJECTED_CONFIRMED";
      event.requiresReview = false;
      event.reviewDecision = "REJECTED";
      event.reviewedAt = now();
      event.reviewedByUserId = currentUser(db)?.id || "";
    }
    audit(db, "review.rejected_punch", "attendance", event.id, before, event);
    saveDb(db);
    return ok(enrichByEmployee(db, event));
  },
  trustedDevices: async () => {
    const db = loadDb();
    const rows = (db.passkeyCredentials || []).map((item) => {
      const user = findById(db.users, item.userId);
      const employee = findById(db.employees, item.employeeId || user?.employeeId);
      return { ...item, employee: employee ? enrichEmployee(db, employee) : null, status: item.status || (item.trusted === false ? "DEVICE_DISABLED" : "DEVICE_TRUSTED") };
    });
    return ok(rows);
  },
  updateTrustedDevice: async (deviceId, body = {}) => {
    const db = loadDb();
    const device = findById(db.passkeyCredentials, deviceId);
    if (!device) throw new Error("الجهاز غير موجود.");
    const before = clone(device);
    if (body.action === "disable") {
      device.trusted = false;
      device.status = "DEVICE_DISABLED";
      device.disabledAt = now();
    } else {
      device.trusted = true;
      device.status = "DEVICE_TRUSTED";
      device.trustedAt = now();
    }
    audit(db, "device.trust", "passkey", device.id, before, device);
    saveDb(db);
    return ok(device);
  },
  monthlyReport: async ({ month } = {}) => ok(monthlyAttendanceSummary(loadDb(), month)),
  securityLog: async () => {
    const db = loadDb();
    const keys = ["auth.failed", "auth.login", "auth.password_reset_requested", "auth.password_changed", "device.trust"];
    return ok((db.auditLogs || []).filter((log) => keys.includes(log.action) || String(log.action || "").startsWith("auth.")).slice(0, 500));
  },
  passwordVault: async () => {
    const db = loadDb();
    const actor = currentUser(db);
    if (!isTechnicalAdmin(actor) && !isFullAccessUser(db)) throw new Error("خزنة كلمات المرور المؤقتة متاحة فقط للتقني أو الإدارة العليا.");
    const rows = (db.users || []).map((user) => {
      const employee = findById(db.employees, user.employeeId);
      const issued = (db.credentialVault || []).find((item) => item.userId === user.id);
      return { ...user, password: user.password || issued?.temporaryPassword || "", temporaryPasswordRecord: issued || null, employee: employee ? enrichEmployee(db, employee) : null };
    });
    return ok(rows);
  },
  resetUserPassword: async (userId, password = "") => {
    const db = loadDb();
    const actor = currentUser(db);
    if (!isTechnicalAdmin(actor) && !isFullAccessUser(db)) throw new Error("إعادة تعيين كلمات المرور متاحة فقط للتقني أو الإدارة العليا.");
    const user = findById(db.users, userId);
    if (!user) throw new Error("المستخدم غير موجود.");
    const before = clone(user);
    const generatedPassword = password || makeStrongPassword();
    user.password = generatedPassword;
    user.temporaryPassword = true;
    user.mustChangePassword = true;
    db.credentialVault ||= [];
    db.credentialVault.unshift({ id: makeId("cred"), userId: user.id, employeeId: user.employeeId || "", email: user.email, temporaryPassword: generatedPassword, status: "RESET", createdAt: now(), createdBy: actor?.id || "system", note: "تمت إعادة التعيين ويجب تغييرها من الموظف بعد الدخول." });
    audit(db, "auth.password_reset_by_admin", "user", user.id, { ...before, password: "***" }, { ...user, password: "***" });
    notifyEmployee(db, user.employeeId, "تمت إعادة تعيين كلمة المرور", "راجع الإدارة لاستلام كلمة المرور المؤقتة ثم غيّرها بعد الدخول.", "ACTION_REQUIRED");
    saveDb(db);
    return ok({ user: enrichUser(db, user), temporaryPassword: generatedPassword });
  },
  executiveReport: async () => ok(executiveSnapshot(loadDb())),
  leaveBalances: async () => {
    const db = loadDb();
    return ok(visibleEmployees(db).map((employee) => defaultLeaveBalance(db, employee)));
  },
  saveLeaveBalance: async (employeeId, body = {}) => {
    const db = loadDb();
    const employee = findById(db.employees, employeeId);
    if (!employee) throw new Error("الموظف غير موجود.");
    db.leaveBalances ||= [];
    let row = db.leaveBalances.find((item) => item.employeeId === employeeId);
    const before = clone(row);
    if (!row) {
      row = { id: makeId("lb"), employeeId, createdAt: now() };
      db.leaveBalances.unshift(row);
    }
    Object.assign(row, {
      annualTotal: Number(body.annualTotal ?? row.annualTotal ?? 21),
      casualTotal: Number(body.casualTotal ?? row.casualTotal ?? 7),
      sickTotal: Number(body.sickTotal ?? row.sickTotal ?? 15),
      usedDays: Number(body.usedDays ?? row.usedDays ?? 0),
      remainingDays: Number(body.remainingDays ?? row.remainingDays ?? 0),
      notes: body.notes || row.notes || "",
      updatedAt: now(),
    });
    if (!body.remainingDays) row.remainingDays = Math.max(0, Number(row.annualTotal || 0) + Number(row.casualTotal || 0) - Number(row.usedDays || 0));
    audit(db, "leave_balance.save", "leave_balance", row.id, before, row);
    saveDb(db);
    return ok(defaultLeaveBalance(db, employee));
  },
  tasks: async (filters = {}) => ok(taskRows(loadDb(), filters)),
  myTasks: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    return ok(taskRows(db, { employeeId }));
  },
  createTask: async (body = {}) => {
    const db = loadDb();
    const actor = currentUser(db);
    const employeeId = body.employeeId || actor?.employeeId || actor?.employee?.id;
    if (!employeeId) throw new Error("حدد الموظف صاحب المهمة.");
    const task = { id: makeId("task"), title: body.title || "مهمة جديدة", description: body.description || body.notes || "", employeeId, assignedByEmployeeId: actor?.employeeId || "", priority: body.priority || "MEDIUM", status: body.status || "OPEN", dueDate: body.dueDate || "", createdAt: now(), updatedAt: now() };
    db.tasks ||= [];
    db.tasks.unshift(task);
    audit(db, "task.create", "task", task.id, null, task);
    notifyEmployee(db, employeeId, "مهمة جديدة", task.title, "ACTION_REQUIRED");
    saveDb(db);
    return ok(enrichByEmployee(db, task));
  },
  updateTask: async (id, body = {}) => {
    const db = loadDb();
    const task = findById(db.tasks || [], id);
    if (!task) throw new Error("المهمة غير موجودة.");
    const before = clone(task);
    Object.assign(task, { ...body, updatedAt: now(), completedAt: body.status === "DONE" ? now() : task.completedAt });
    audit(db, "task.update", "task", id, before, task);
    notifyEmployee(db, task.employeeId, "تحديث مهمة", `${task.title}: ${task.status}`, "INFO");
    saveDb(db);
    return ok(enrichByEmployee(db, task));
  },
  employeeDocuments: async (filters = {}) => ok(documentRows(loadDb(), filters)),
  myDocuments: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    return ok(documentRows(db, { employeeId }));
  },
  createEmployeeDocument: async (body = {}) => {
    const db = loadDb();
    const employeeId = body.employeeId || currentUser(db)?.employeeId;
    if (!employeeId) throw new Error("حدد الموظف المرتبط بالمستند.");
    const doc = { id: makeId("doc"), employeeId, title: body.title || "مستند موظف", documentType: body.documentType || "OTHER", status: body.status || "ACTIVE", fileName: body.fileName || "", fileUrl: body.fileUrl || "", expiresOn: body.expiresOn || "", notes: body.notes || "", createdAt: now(), updatedAt: now() };
    db.employeeDocuments ||= [];
    db.employeeDocuments.unshift(doc);
    audit(db, "document.create", "employee_document", doc.id, null, doc);
    saveDb(db);
    return ok(enrichByEmployee(db, doc));
  },
  updateEmployeeDocument: async (id, body = {}) => {
    const db = loadDb();
    const doc = findById(db.employeeDocuments || [], id);
    if (!doc) throw new Error("المستند غير موجود.");
    const before = clone(doc);
    Object.assign(doc, { ...body, updatedAt: now() });
    audit(db, "document.update", "employee_document", id, before, doc);
    saveDb(db);
    return ok(enrichByEmployee(db, doc));
  },
  myRequests: async () => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    return ok(employeeRequestSummary(db, employeeId));
  },
  acknowledgeNotification: async (id) => {
    const db = loadDb();
    const note = findById(db.notifications || [], id);
    if (!note) throw new Error("الإشعار غير موجود.");
    const before = clone(note);
    note.isRead = true;
    note.status = "READ";
    note.readAt = now();
    db.announcementReads ||= [];
    db.announcementReads.unshift({ id: makeId("read"), notificationId: id, employeeId: note.employeeId || currentUser(db)?.employeeId || "", readAt: now() });
    audit(db, "announcement.read", "notification", id, before, note);
    saveDb(db);
    return ok(note);
  },
  permissionMatrix: async () => {
    const db = loadDb();
    return ok({ roles: db.roles || [], permissions: db.permissions || [] });
  },
  savePermissionMatrix: async (body = {}) => {
    const db = loadDb();
    const role = findById(db.roles || [], body.roleId);
    if (!role) throw new Error("الدور غير موجود.");
    const before = clone(role);
    role.permissions = Array.isArray(body.permissions) ? body.permissions : [];
    role.updatedAt = now();
    audit(db, "permission_matrix.save", "role", role.id, before, role);
    saveDb(db);
    return ok(role);
  },
  qualityCenter: async () => {
    const db = loadDb();
    return ok({ readiness: deepReadiness(db), policy: policySummary(db), maintenanceRuns: db.maintenanceRuns || [], escalations: db.workflowEscalations || [], recentFixes: (db.auditLogs || []).filter((log) => String(log.action || "").startsWith("maintenance.") || String(log.action || "").startsWith("workflow.automation")).slice(0, 20) });
  },
  runMaintenance: async (body = {}) => {
    const db = loadDb();
    const beforeScore = deepReadiness(db).score;
    const repair = runDataRepair(db, body);
    const workflow = runWorkflowAutomation(db, body);
    const after = deepReadiness(db);
    const run = { id: makeId("maint"), title: body.title || "تشغيل صيانة شامل", beforeScore, afterScore: after.score, repair, workflow, createdAt: now(), createdByUserId: currentUser(db)?.id || "system" };
    db.maintenanceRuns ||= [];
    db.maintenanceRuns.unshift(run);
    db.maintenanceRuns = db.maintenanceRuns.slice(0, 50);
    saveDb(db);
    return ok({ run, readiness: after });
  },
  policies: async () => {
    const db = loadDb();
    const employeeId = currentUser(db)?.employeeId || currentUser(db)?.employee?.id || "";
    return ok({ policies: policyRows(db, employeeId), summary: policySummary(db), acknowledgements: db.policyAcknowledgements || [] });
  },
  savePolicy: async (body = {}) => {
    const db = loadDb();
    db.employeePolicies ||= [];
    let policy = body.id ? findById(db.employeePolicies, body.id) : null;
    const before = clone(policy);
    if (!policy) {
      policy = { id: makeId("pol"), createdAt: now() };
      db.employeePolicies.unshift(policy);
    }
    Object.assign(policy, { title: body.title || policy.title || "سياسة جديدة", category: body.category || policy.category || "GENERAL", version: body.version || policy.version || "1.0", body: body.body || policy.body || body.description || "", requiresAcknowledgement: body.requiresAcknowledgement !== false && body.requiresAcknowledgement !== "false", status: body.status || policy.status || "ACTIVE", updatedAt: now() });
    audit(db, "policy.save", "policy", policy.id, before, policy);
    if (policy.status === "ACTIVE") notify(db, "سياسة جديدة/محدثة تحتاج قراءة", policy.title, "ACTION_REQUIRED");
    saveDb(db);
    return ok(policy);
  },
  acknowledgePolicy: async (policyId) => {
    const db = loadDb();
    const user = currentUser(db);
    const employeeId = user?.employeeId || user?.employee?.id;
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بالحساب.");
    const policy = findById(db.employeePolicies || [], policyId);
    if (!policy) throw new Error("السياسة غير موجودة.");
    db.policyAcknowledgements ||= [];
    let ack = db.policyAcknowledgements.find((row) => row.policyId === policyId && row.employeeId === employeeId);
    if (!ack) {
      ack = { id: makeId("ack"), policyId, employeeId, userId: user.id, policyVersion: policy.version || "1.0", acknowledgedAt: now(), createdAt: now() };
      db.policyAcknowledgements.unshift(ack);
      audit(db, "policy.acknowledge", "policy", policyId, null, ack);
      saveDb(db);
    }
    return ok(ack);
  },
  addCommitteeAction: async (caseId, body = {}) => {
    const db = loadDb();
    const item = findById(db.disputeCases || [], caseId);
    if (!item) throw new Error("ملف المشكلة غير موجود.");
    const actor = currentUser(db);
    db.committeeActions ||= [];
    const action = { id: makeId("committee"), caseId, employeeId: actor?.employeeId || "", actionType: body.actionType || "NOTE", decision: body.decision || "", note: body.note || body.committeeDecision || "", createdAt: now(), createdByUserId: actor?.id || "system" };
    db.committeeActions.unshift(action);
    item.committeeTimeline ||= [];
    item.committeeTimeline.unshift(action);
    if (body.status) item.status = body.status;
    if (body.escalatedToExecutive) {
      item.status = "ESCALATED";
      item.escalatedToExecutive = true;
      item.escalatedAt = now();
      notifyManyEmployees(db, ["emp-executive-secretary", "emp-executive-director"], "تصعيد مشكلة للمدير التنفيذي", item.title || "مشكلة", "ACTION_REQUIRED");
    }
    audit(db, "dispute.committee_action", "dispute_case", caseId, null, action);
    saveDb(db);
    return ok({ case: enrichByEmployee(db, item), action });
  },

  smartAttendanceRules: async () => {
    const db = loadDb();
    return ok({ rules: attendanceRules(db), runs: db.attendanceRuleRuns || [], settings: db.systemSettings || {} });
  },
  saveSmartAttendanceRules: async (body = {}) => {
    const db = loadDb();
    db.systemSettings ||= {};
    db.systemSettings.attendanceRules = { ...attendanceRules(db), ...body, duplicateWindowMinutes: Number(body.duplicateWindowMinutes || attendanceRules(db).duplicateWindowMinutes || 10) };
    audit(db, "settings.attendance_rules", "settings", "attendanceRules", null, db.systemSettings.attendanceRules);
    saveDb(db);
    return ok({ rules: attendanceRules(db) });
  },
  runSmartAttendance: async (body = {}) => { const db = loadDb(); const result = runSmartAttendanceLocal(db, body); saveDb(db); return ok(result); },
  endOfDayReport: async (body = {}) => { const db = loadDb(); const report = buildEndOfDayReport(db, body); saveDb(db); return ok(report); },
  executivePdfReportData: async (body = {}) => {
    const db = loadDb();
    const report = buildEndOfDayReport(db, { ...body, period: body.period || "daily" });
    const period = body.period || "daily";
    const days = period === "weekly" ? 7 : period === "monthly" ? 30 : 1;
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = (db.attendanceDaily || []).filter((row) => String(row.date || "") >= since).map((row) => ({ ...row, employee: enrichEmployee(db, findById(db.employees || [], row.employeeId)) }));
    saveDb(db);
    return ok({ period, since, generatedAt: now(), report, rows });
  },
  employeeArchive: async (employeeId) => { const db = loadDb(); const archive = employeeArchiveLocal(db, employeeId); saveDb(db); return ok(archive); },
  attendanceReviewCenter: async () => {
    const db = loadDb();
    const today = dateKey();
    const smart = runSmartAttendanceLocal(db, { date: today });
    const flaggedEvents = scopedRowsByEmployee(db, db.attendanceEvents || []).filter((event) => event.requiresReview || ["outside_branch", "location_low_accuracy", "permission_denied", "location_unavailable"].includes(event.geofenceStatus) || (event.riskFlags || []).length).map((event) => enrichByEmployee(db, event)).sort((a, b) => new Date(b.eventAt || b.createdAt || 0) - new Date(a.eventAt || a.createdAt || 0));
    const dailyIssues = smart.rows.filter((row) => row.requiresReview || ["ABSENT_TEMP", "ABSENT", "EARLY_EXIT", "MISSING_CHECKOUT", "REVIEW"].includes(row.status));
    saveDb(db);
    return ok({ flaggedEvents, dailyIssues, generatedAt: now() });
  },
  decideAttendanceReview: async (body = {}) => {
    const db = loadDb();
    const event = findById(db.attendanceEvents || [], body.eventId);
    if (!event) throw new Error("البصمة غير موجودة.");
    const before = clone(event);
    if (body.action === "reject") { event.status = "REJECTED_CONFIRMED"; event.reviewDecision = "REJECTED"; event.requiresReview = false; }
    else if (body.action === "clarify") { event.requiresReview = true; notifyEmployee(db, event.employeeId, "مطلوب توضيح بخصوص البصمة", body.note || "يرجى توضيح سبب البصمة غير الطبيعية.", "ACTION_REQUIRED"); }
    else { event.status = "MANUAL_APPROVED"; event.verificationStatus = "manual_approved"; event.reviewDecision = "APPROVED"; event.requiresReview = false; upsertDailyFromEvent(db, event.employeeId, event); }
    event.reviewNote = body.note || ""; event.reviewedAt = now(); event.reviewedByUserId = currentUser(db)?.id || "system";
    audit(db, "attendance_review.decision", "attendance_event", event.id, before, event);
    saveDb(db);
    return ok(enrichByEmployee(db, event));
  },
  smartAdminAlerts: async () => { const db = loadDb(); const smart = runSmartAttendanceLocal(db, { date: dateKey() }); saveDb(db); return ok({ alerts: (db.smartAlerts || []).slice(0, 200), snapshot: smart }); },
  managerSuite: async () => {
    const db = loadDb();
    const base = await localEndpoints.managerDashboard().then((r) => r.data || r);
    const team = base.team || [];
    const date = dateKey();
    const rows = team.map((employee) => analyseAttendanceForEmployee(db, employee, date));
    const pending = workflowItems(db).filter((item) => item.status === "PENDING" && team.some((employee) => employee.id === item.employeeId));
    return ok({ ...base, smartRows: rows, pending, generatedAt: now() });
  },
  monthlyEvaluations: async (body = {}) => {
    const db = loadDb();
    const cycle = currentKpiCycle(db);
    const month = body.month || now().slice(0, 7);
    const evaluations = visibleEmployees(db).map((employee) => {
      let evalRow = (db.kpiEvaluations || []).find((item) => item.employeeId === employee.id && (item.month === month || item.cycleId === cycle.id));
      if (!evalRow) { const score = attendanceScoreForEmployee(db, employee.id, cycle); evalRow = { id: makeId("kpie"), cycleId: cycle.id, month, employeeId: employee.id, managerEmployeeId: employee.managerEmployeeId || "", attendanceScore: score, targetScore: 0, efficiencyScore: 0, conductScore: 0, prayerScore: 0, quranCircleScore: 0, initiativesScore: 0, totalScore: score, status: "DRAFT", createdAt: now() }; db.kpiEvaluations.unshift(evalRow); }
      return { ...evalRow, employee: enrichEmployee(db, employee), manager: enrichEmployee(db, findById(db.employees || [], evalRow.managerEmployeeId)) };
    });
    saveDb(db);
    return ok({ cycle, month, evaluations });
  },
  saveMonthlyEvaluation: async (id, body = {}) => {
    const db = loadDb();
    const evaluation = findById(db.kpiEvaluations || [], id);
    if (!evaluation) throw new Error("التقييم غير موجود.");
    const before = clone(evaluation);
    for (const key of ["attendanceScore", "targetScore", "efficiencyScore", "conductScore", "prayerScore", "quranCircleScore", "initiativesScore"]) if (body[key] !== undefined) evaluation[key] = Number(body[key] || 0);
    evaluation.managerComment = body.managerComment || evaluation.managerComment || ""; evaluation.status = body.status || evaluation.status || "DRAFT";
    evaluation.totalScore = Math.round((Number(evaluation.attendanceScore || 0) + Number(evaluation.targetScore || 0) + Number(evaluation.efficiencyScore || 0) + Number(evaluation.conductScore || 0) + Number(evaluation.prayerScore || 0) + Number(evaluation.quranCircleScore || 0) + Number(evaluation.initiativesScore || 0)) / 7);
    evaluation.updatedAt = now(); audit(db, "kpi.monthly.save", "kpi_evaluation", id, before, evaluation); saveDb(db); return ok(evaluation);
  },
  supabaseSetupCheck: async () => {
    const cfg = globalThis.HR_SUPABASE_CONFIG || {}; const enabled = Boolean(cfg.enabled && cfg.url && cfg.anonKey);
    return ok({ mode: enabled ? "supabase-configured" : "local-fallback", checks: [
      { label: "Supabase مفعل", ok: Boolean(cfg.enabled), detail: cfg.enabled ? "enabled=true" : "enabled=false" },
      { label: "Project URL", ok: Boolean(cfg.url), detail: cfg.url ? "موجود" : "غير مضبوط" },
      { label: "Anon Key", ok: Boolean(cfg.anonKey), detail: cfg.anonKey ? "موجود" : "غير مضبوط" },
      { label: "Strict Mode", ok: cfg.strict !== false, detail: cfg.strict !== false ? "strict" : "fallback" },
      { label: "Storage Buckets", ok: Boolean(cfg.storage), detail: cfg.storage ? Object.values(cfg.storage || {}).join(" / ") : "اضبط buckets" },
      { label: "آخر Patch مطلوب", ok: true, detail: "041_audit_v7_security_mobile_alignment.sql" },
    ], recommended: enabled ? "اختبر التسجيل الذاتي للموظف ومسار KPI الكامل من موظف إلى مدير تنفيذي." : "فعّل Supabase من shared/js/supabase-config.js ثم شغّل SQL patches حتى 041." });
  },
  databaseMigrationsStatus: async () => {
    const db = loadDb();
    const expected = [
      "001_schema_rls_seed.sql",
      "002_repair_profile_roles.sql",
      "003_user_avatar_and_mobile_ui.sql",
      "004_emergency_admin_access.sql",
      "005_simplify_employee_punch_fields.sql",
      "006_single_branch_locations_disputes_cleanup.sql",
      "007_login_punch_gps_layout_fix.sql",
      "008_supabase_cli_advisor_hardening.sql",
      "009_passkey_attendance_activation.sql",
      "010_simplify_employee_users_remove_payroll_gps_production.sql",
      "011_advanced_uiux_diagnostics_autolink.sql",
      "012_strong_features_review_devices_reports_demo.sql",
      "013_phone_login_identifier.sql",
      "014_location_schema_contact_and_precise_coordinates.sql",
      "015_critical_security_hardening.sql",
      "016_import_employee_roster_from_excel.sql",
      "017_completion_pack_tables.sql",
      "018_ahla_shabab_org_hierarchy.sql",
      "019_stability_passwords_disputes_requests.sql",
      "020_full_operations_pack.sql",
      "021_quality_workflow_policy_center.sql",
      "022_control_room_data_center_daily_reports.sql",
      "023_executive_mobile_gateway_live_location.sql",
      "024_sensitive_approvals_gateway_hardening.sql",
      "025_smart_attendance_executive_archive_backup.sql",
      "026_missing_functions_fix.sql",
      "027_fix_executive_hierarchy_accounts.sql",
      "028_primary_admin_and_runtime_fixes.sql",
      "029_employee_photos.sql",
      "030_executive_role_separation_ui_polish.sql",
      "030a_executive_role_separation_ui_polish.sql",
      "030b_update_employee_roster_from_excel.sql",
      "031_web_guard_mobile_polish.sql",
      "031a_supabase_password_vault.sql",
      "031b_web_guard_mobile_polish.sql",
      "032_pre_publish_role_portal_consistency.sql",
      "032a_fix_phone_login_resolver_priority.sql",
      "032b_pre_publish_role_portal_consistency.sql",
      "033_final_web_production_hardening.sql",
      "033a_final_web_production_hardening.sql",
      "033b_limit_password_vault_to_yahia.sql",
      "034_final_lockdown_cleanup.sql",
      "034a_final_lockdown_cleanup.sql",
      "034b_server_runtime_push_endpoint_completion.sql",
      "035_final_sanitization_live_readiness.sql",
      "036_role_kpi_workflow_access.sql",
      "037_kpi_policy_window_hr_scoring.sql",
      "038_kpi_cycle_control_reports.sql",
      "039_management_hr_reports_workflow.sql",
      "040_runtime_alignment_fix.sql",
      "041_audit_v7_security_mobile_alignment.sql",
      "042_authorized_roster_phone_login_internal_channel.sql",
      "043_executive_presence_risk_decisions_reports.sql",
      "044_encrypt_credential_vault.sql",
      "045_enable_pg_cron_backup.sql",
      "046_performance_indexes.sql",
      "047_mfa_trusted_devices.sql",
      "048_enhanced_audit_log.sql",
      "049_cleanup_old_reports.sql",
      "051_attendance_identity_verification.sql",
      "052_attendance_identity_server_review.sql",
      "053_trusted_device_approval.sql",
      "054_attendance_branch_qr_challenge.sql",
      "055_attendance_anti_spoofing_risk.sql",
      "056_attendance_risk_center.sql",
      "057_employee_requests_two_stage_workflow.sql",
      "058_kpi_advanced_workflow_percentages.sql",
      "059_dispute_committee_privacy_workflow.sql",
      "060_location_readable_labels_and_policy_ack.sql",
      "061_trusted_device_policy_enforcement.sql",
      "062_branch_qr_station_rotation.sql",
      "063_attendance_fraud_ops_snapshot.sql",
      "064_attendance_fallback_workflow.sql",
      "065_live_operations_center.sql",
      "066_face_match_optional_metadata.sql",
      "067_smart_alerts_engine.sql",
      "068_monthly_reports_exports.sql",
      "069_visual_permissions_matrix.sql",
      "070_backup_restore_status_center.sql",
      "071_internal_tasks_enhanced.sql",
      "072_official_messages_read_receipts.sql",
      "073_offline_attendance_sync_queue.sql",
      "074_e2e_and_health_tracking.sql",
      "075_qr_disabled_and_attendance_reminder_runner.sql",
      "076_v13_phone_login_org_permissions_polish.sql",
      "077_remote_deploy_compatibility.sql",
      "078_precise_ahla_manil_location.sql",
      "079_v26_notification_reliability.sql",
      "080_live_location_alert_reliability.sql",
      "088_final_audit_alignment.sql",
      "089_codex_full_deploy_alignment.sql",
      "090_executive_location_selfie_live_request_hotfix.sql",
      "094_workflow_mobile_role_alignment.sql",
      "095_kpi_workflow_polish.sql",
      "096_kpi_automation_mobile_reports.sql",
      "098_location_security_edge_hardening.sql",
      "104_royal_blue_full_migration.sql"
    ];
    db.migrationStatus ||= [];
    const normalizeMigrationName = (name = "") => String(name).replace(/\.sql$/i, "");
    const applied = new Set(db.migrationStatus.flatMap((item) => [item.name, normalizeMigrationName(item.name)]));
    return ok({ expectedPatch: "104_royal_blue_full_migration", rows: expected.map((name, index) => {
      const marker = normalizeMigrationName(name);
      const isApplied = applied.has(name) || applied.has(marker);
      return { name, marker, order: index + 1, status: isApplied ? "APPLIED" : (index === expected.length - 1 ? "NEW" : "CHECK_MANUALLY") };
    }), notes: "في Supabase الحقيقي شغّل RUN_IN_SUPABASE_SQL_EDITOR.sql ثم راجع VERIFY_AFTER_SUPABASE_DEPLOY.sql." });
  },
  markMigrationApplied: async (name) => { const db = loadDb(); db.migrationStatus ||= []; if (!db.migrationStatus.some((item) => item.name === name)) db.migrationStatus.unshift({ id: makeId("mig"), name, status: "APPLIED", appliedAt: now(), appliedByUserId: currentUser(db)?.id || "system" }); saveDb(db); return ok({ applied: name }); },
  autoBackupStatus: async () => { const db = loadDb(); return ok({ policy: { keepLast: 30, ...(db.systemSettings?.backupPolicy || {}) }, backups: (db.systemBackups || []).map((item) => ({ ...item, data: undefined })).slice(0, 30), runs: db.autoBackupRuns || [] }); },
  runAutomaticBackup: async (body = {}) => { const db = loadDb(); const snapshot = createAutomaticBackup(db, body); saveDb(db); return ok(snapshot); },
  myActionCenter: async () => {
    const db = loadDb(); const user = currentUser(db); const employeeId = user?.employeeId || user?.employee?.id || ""; const today = dateKey(); const employee = findById(db.employees || [], employeeId); const attendance = employee ? analyseAttendanceForEmployee(db, employee, today) : null;
    const unsignedPolicies = policyRows(db, employeeId).filter((policy) => policy.requiresAcknowledgement && !policy.acknowledged);
    const liveRequests = (db.liveLocationRequests || []).filter((item) => item.employeeId === employeeId && item.status === "PENDING");
    const tasks = (db.tasks || []).filter((task) => task.employeeId === employeeId && !["DONE", "CLOSED", "CANCELLED"].includes(task.status));
    const docs = documentRows(db, { employeeId }).filter((doc) => ["EXPIRING_SOON", "EXPIRED", "MISSING", "REQUIRED"].includes(doc.status));
    const notes = (db.notifications || []).filter((note) => (!note.employeeId || note.employeeId === employeeId || note.userId === user?.id) && !note.isRead).slice(0, 20);
    const unsignedDecisions = decisionRowsForCurrentUser(db).filter((decision) => decision.requiresAcknowledgement !== false && !decision.acknowledged);
    const actions = [];
    if (attendance && ["ABSENT_TEMP", "MISSING_CHECKOUT", "REVIEW"].includes(attendance.status)) actions.push({ id: "att-" + today, type: "ATTENDANCE", title: attendance.title, body: attendance.recommendation, route: "punch", severity: attendance.severity });
    liveRequests.filter((item) => !item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()).forEach((item) => actions.push({ id: item.id, type: "LIVE_LOCATION", title: "طلب موقع مباشر", body: item.reason || "الإدارة تطلب موقعك الحالي", route: "location", severity: "HIGH" }));
    tasks.slice(0, 10).forEach((task) => actions.push({ id: task.id, type: "TASK", title: task.title, body: task.description || "مهمة مفتوحة", route: "tasks", severity: task.priority || "MEDIUM" }));
    unsignedPolicies.forEach((policy) => actions.push({ id: policy.id, type: "POLICY", title: "توقيع سياسة: " + policy.title, body: policy.category || "سياسة", route: "policies", severity: "MEDIUM" }));
    unsignedDecisions.forEach((decision) => actions.push({ id: decision.id, type: "ADMIN_DECISION", title: "قرار إداري يحتاج اطلاع: " + decision.title, body: decision.body || "قرار رسمي", route: "decisions", severity: decision.priority || "HIGH" }));
    docs.forEach((doc) => actions.push({ id: doc.id, type: "DOCUMENT", title: "مستند يحتاج متابعة: " + doc.title, body: doc.notes || doc.status, route: "documents", severity: "MEDIUM" }));
    notes.slice(0, 10).forEach((note) => actions.push({ id: note.id, type: "NOTIFICATION", title: note.title, body: note.body || "إشعار جديد", route: "notifications", severity: note.type || "LOW" }));
    return ok({ actions, attendance, liveRequests, tasks, unsignedPolicies, unsignedDecisions, documents: docs, notifications: notes, generatedAt: now() });
  },
  reset: async () => {
    const db = normalizeDb(seedDatabase);
    saveDb(db);
    return ok({ ok: true });
  },
};


// 094: local fallback for mobile role alignment and workflow automation.
Object.assign(localEndpoints, {
  mobilePortalAlignment: async () => {
    const db = loadDb();
    const usersByEmployee = new Map((db.users || []).map((u) => [u.employeeId, u]));
    const roleOf = (item = {}) => String(item.role || item.userRole || item.appRole || item.permissions?.__role || '').toUpperCase();
    const deviceRows = db.pushSubscriptions || [];
    const rows = (db.employees || []).map((employee) => {
      const user = usersByEmployee.get(employee.id) || null;
      const teamCount = (db.employees || []).filter((x) => x.managerId === employee.id).length;
      const activePush = deviceRows.filter((d) => d.employeeId === employee.id && d.isActive !== false).length;
      const issues = [];
      if (!user) issues.push('NO_LOGIN_ACCOUNT');
      if (!employee.phone) issues.push('NO_PHONE');
      if (teamCount && !/MANAGER|EXECUTIVE|HR/.test(roleOf(user || employee))) issues.push('MANAGER_ROLE_NEEDS_REVIEW');
      if (!activePush) issues.push('PUSH_NOT_ENABLED');
      return { employee, user, teamCount, isManager: teamCount > 0, isCommittee: Boolean(employee.disputeCommittee || employee.isDisputeCommittee || /DISPUTE|COMMITTEE|HR|EXECUTIVE|SECRETARY|TECH/.test(roleOf(user || employee))), activePush, deviceStatus: activePush ? 'PUSH_ACTIVE' : 'NO_DEVICE', issues };
    });
    return ok({ rows, managers: rows.filter((r) => r.isManager).map((r) => r.employee), committee: rows.filter((r) => r.isCommittee).map((r) => r.employee), qualityIssues: [], generatedAt: now() });
  },
  managerMobileHub: async () => {
    const db = loadDb(); const user = currentUser(db); const employeeId = user?.employeeId || user?.employee?.id || '';
    const team = (db.employees || []).filter((e) => e.managerId === employeeId || e.managerEmployeeId === employeeId || e.directManagerId === employeeId);
    const ids = new Set(team.map((e) => e.id));
    const pendingLeaves = (db.leaveRequests || db.leaves || []).filter((r) => ids.has(r.employeeId) && isPendingRequestStatus(r.status));
    const pendingMissions = (db.missions || []).filter((r) => ids.has(r.employeeId) && isPendingRequestStatus(r.status));
    const kpiPending = (db.kpiEvaluations || []).filter((r) => ids.has(r.employeeId) && ['SELF_SUBMITTED','EMPLOYEE_SUBMITTED'].includes(String(r.status || '').toUpperCase())).map((r) => ({ ...r, employee: enrichEmployee(db, findById(db.employees, r.employeeId)), manager: enrichEmployee(db, findById(db.employees, r.managerEmployeeId || employeeId)) }));
    const notifications = (db.notifications || []).filter((n) => !n.isRead).slice(0, 20);
    return ok({ manager: user?.employee || null, team, pendingLeaves, pendingMissions, kpiPending, notifications, totals: { team: team.length, pendingLeaves: pendingLeaves.length, pendingMissions: pendingMissions.length, kpiPending: kpiPending.length }, generatedAt: now() });
  },
  committeeMobileHub: async () => {
    const db = loadDb(); const user = currentUser(db); const employeeId = user?.employeeId || user?.employee?.id || '';
    const rows = (db.disputeCases || db.disputes || []).filter((d) => {
      const members = d.committeeMemberIds || d.assignedEmployeeIds || [];
      const status = String(d.status || '').toUpperCase();
      return members.includes?.(employeeId) || ['NEW','OPEN','ESCALATED','COMMITTEE_REVIEW','PENDING'].includes(status) || d.employeeId === employeeId || d.createdByEmployeeId === employeeId;
    });
    const urgent = rows.filter((d) => ['NEW','ESCALATED','HIGH','URGENT'].includes(String(d.priority || d.status || '').toUpperCase()));
    const notifications = (db.notifications || []).filter((n) => String(n.route || '').includes('dispute') || String(n.type || '').includes('DISPUTE')).slice(0, 20);
    return ok({ rows, urgent, notifications, totals: { total: rows.length, urgent: urgent.length, open: rows.filter((d) => !['CLOSED','RESOLVED','CANCELLED'].includes(String(d.status || '').toUpperCase())).length }, generatedAt: now() });
  },
  workflowAutomationCenter: async () => {
    const alignment = unwrap(await localEndpoints.mobilePortalAlignment());
    const quality = await localEndpoints.qualityCenter?.().then(unwrap).catch(() => ({ readiness: { issues: [] } }));
    const notificationCenter = await localEndpoints.notificationCenter?.().then(unwrap).catch(() => ({ unread: [] }));
    const locationCenter = await localEndpoints.locationMonitoringCenter?.().then(unwrap).catch(() => ({ pendingRequests: [] }));
    const urgentFixes = [];
    (alignment.rows || []).forEach((row) => row.issues?.forEach((code) => urgentFixes.push({ code, employee: row.employee, title: code === 'PUSH_NOT_ENABLED' ? 'Push غير مفعل' : 'مشكلة ربط مستخدم', route: 'mobile-alignment' })));
    (locationCenter.pendingRequests || []).slice(0, 20).forEach((req) => urgentFixes.push({ code: 'PENDING_LOCATION_REQUEST', title: 'طلب موقع لم يتم الرد عليه', request: req, route: 'locations' }));
    (quality.readiness?.issues || []).slice(0, 20).forEach((issue) => urgentFixes.push({ code: issue.code || 'QUALITY', title: issue.title || issue.label || 'مشكلة جودة بيانات', route: issue.route || 'quality-center', issue }));
    return ok({ alignment, notificationCenter, locationCenter, quality, urgentFixes, totals: { urgentFixes: urgentFixes.length, managers: alignment.managers?.length || 0, committee: alignment.committee?.length || 0 }, generatedAt: now() });
  },
  createWorkflowAutomationAlerts: async () => {
    const db = loadDb();
    const center = unwrap(await localEndpoints.workflowAutomationCenter());
    db.notifications ||= [];
    const rows = (center.urgentFixes || []).slice(0, 50).map((item) => ({ id: makeId('note'), employeeId: item.employee?.id || item.request?.employeeId || null, title: item.title || 'مطلوب متابعة تشغيلية', body: item.code || 'راجع مركز الربط والتشغيل', type: item.code?.includes('PUSH') ? 'PUSH_SETUP' : 'WORKFLOW_ALERT', route: item.route || 'action-center', isRead: false, createdAt: now(), data: { code: item.code || 'WORKFLOW_ALERT' } }));
    db.notifications.unshift(...rows); saveDb(db);
    return ok({ ok: true, created: rows.length, generatedAt: now() });
  },
});

export const endpoints = new Proxy(localEndpoints, {
  get(target, prop) {
    if (prop in supabaseEndpoints) {
      return async (...args) => {
        if (shouldUseSupabase()) {
          try {
            return await supabaseEndpoints[prop](...args);
          } catch (error) {
            if (supabaseModeIsStrict()) throw error;
            debugWarn("Supabase mode failed; falling back to localStorage:", error);
          }
        }
        if (prop in remoteEndpoints) {
          if (shouldUseApi()) {
            try {
              return await remoteEndpoints[prop](...args);
            } catch (error) {
              if (new URLSearchParams(location.search).get("api") && new URLSearchParams(location.search).get("api") !== "local") throw error;
              debugWarn("API mode failed; falling back to localStorage:", error);
            }
          }
        }
        return target[prop](...args);
      };
    }
    if (prop in remoteEndpoints) {
      return async (...args) => {
        if (shouldUseApi()) {
          try {
            return await remoteEndpoints[prop](...args);
          } catch (error) {
            if (new URLSearchParams(location.search).get("api") && new URLSearchParams(location.search).get("api") !== "local") throw error;
            debugWarn("API mode failed; falling back to localStorage:", error);
          }
        }
        return target[prop](...args);
      };
    }
    return target[prop];
  },
});
