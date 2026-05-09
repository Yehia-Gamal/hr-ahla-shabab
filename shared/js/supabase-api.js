const debugEnabled = () => Boolean(globalThis.HR_DEBUG_LOGS || globalThis.HR_SUPABASE_CONFIG?.debug === true);
const debugWarn = (...args) => { if (debugEnabled()) globalThis.console?.warn?.(...args); };
const debugError = (...args) => { if (debugEnabled()) globalThis.console?.error?.(...args); };
const debugInfo = (...args) => { if (debugEnabled()) globalThis.console?.info?.(...args); };
const SUPABASE_CDN = "https://esm.sh/@supabase/supabase-js@2.105.1";
const CONFIG = () => globalThis.HR_SUPABASE_CONFIG || {};
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const now = () => new Date().toISOString();
const makeId = (prefix = "id") => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const toInt = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_COMPLEX = {
  name: "مجمع منيل شيحة",
  address: "شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912",
  latitude: 29.950738592862045,
  longitude: 31.238094542328678,
  radiusMeters: 180,
  maxAccuracyMeters: 90,
};

let clientPromise = null;
let realtimeChannels = [];

export function shouldUseSupabase() {
  const cfg = CONFIG();
  const params = new URLSearchParams(location.search);
  const fallbackAllowed = cfg?.security?.allowLocalFallback === true;
  const localForced = fallbackAllowed && (params.get("backend") === "local" || params.get("api") === "local" || localStorage.getItem("hr.localFallbackMode") === "true");
  const forced = params.get("backend") === "supabase" || params.get("api") === "supabase";
  if (localForced && !forced) return false;
  return Boolean((cfg.enabled || forced) && cfg.url && cfg.anonKey);
}

export function supabaseModeIsStrict() {
  const cfg = CONFIG();
  return shouldUseSupabase() && cfg.strict !== false;
}

async function getSupabase() {
  if (!shouldUseSupabase()) return null;
  if (!clientPromise) {
    clientPromise = import(SUPABASE_CDN).then(({ createClient }) => createClient(CONFIG().url, CONFIG().anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "ahla-shabab-hr.supabase-session",
        lock: async (_name, _acquireTimeout, fn) => await fn(),
      },
      realtime: { params: { eventsPerSecond: 10 } },
    }));
  }
  return clientPromise;
}

async function sb() {
  const client = await getSupabase();
  if (!client) throw new Error("لم يتم تفعيل Supabase بعد. عدّل shared/js/supabase-config.js.");
  return client;
}

function fail(error, fallback = "تعذر تنفيذ العملية على Supabase.") {
  if (!error) return;
  const message = error.message || error.details || error.hint || fallback;
  throw new Error(message);
}

function camelKey(key = "") {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function snakeKey(key = "") {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toCamel(row) {
  if (Array.isArray(row)) return row.map(toCamel);
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) out[camelKey(key)] = value;
  return out;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== undefined));
}

async function ignoreSupabaseError(operation) {
  try { await operation; } catch {}
}

function notificationSnake(row = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  return {
    user_id: row.user_id || row.userId || null,
    employee_id: row.employee_id || row.employeeId || null,
    title: row.title || "تنبيه",
    body: row.body || row.message || "",
    type: row.type || "INFO",
    status: row.status || "UNREAD",
    is_read: row.is_read === true || row.isRead === true,
    route: row.route || data.route || "",
    data,
    created_at: row.created_at || row.createdAt || now(),
  };
}

async function safeCreateNotifications(client, rows, options = {}) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map(notificationSnake);
  if (!list.length) return { created: 0, ids: [] };
  const block = options.block === true;
  const fallbackMessage = options.message || "تعذر إنشاء الإشعار الداخلي.";

  // V26: prefer SECURITY DEFINER bulk RPC to avoid RLS and column-shape 400 errors.
  try {
    const { data, error } = await client.rpc("safe_create_notifications_bulk", { p_rows: list });
    if (!error) return { created: Array.isArray(data) ? data.length : list.length, ids: Array.isArray(data) ? data.map((row) => row.id || row) : [] };
    debugWarn("safe_create_notifications_bulk skipped; apply SQL Patch 079", error.message || error);
  } catch (error) {
    debugWarn("safe_create_notifications_bulk unavailable", error?.message || error);
  }

  try {
    const { data, error } = await client.from("notifications").insert(list).select("id");
    if (error) {
      if (block) fail(error, fallbackMessage);
      debugWarn("notifications fallback insert skipped", error.message || error);
      return { created: 0, ids: [] };
    }
    return { created: Array.isArray(data) ? data.length : list.length, ids: (data || []).map((row) => row.id) };
  } catch (error) {
    if (block) throw error;
    debugWarn("notifications fallback insert failed", error?.message || error);
    return { created: 0, ids: [] };
  }
}

async function safeCreateNotification(client, row, options = {}) {
  const result = await safeCreateNotifications(client, [row], options);
  return result.ids?.[0] || "";
}

function toSnake(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) out[snakeKey(key)] = value;
  return out;
}

function rolePermissions(role) {
  if (!role) return [];
  if (Array.isArray(role.permissions)) return role.permissions;
  if (typeof role.permissions === "string") {
    try { return rolePermissions({ permissions: JSON.parse(role.permissions) }); } catch { return role.permissions.split(/[،,\s]+/).map((s) => s.trim()).filter(Boolean); }
  }
  if (role.permissions && typeof role.permissions === "object") {
    if (Array.isArray(role.permissions.permissions)) return rolePermissions(role.permissions);
    if (Array.isArray(role.permissions.scopes)) return role.permissions.scopes.filter(Boolean).map(String);
    return Object.entries(role.permissions)
      .filter(([, enabled]) => enabled === true || enabled === "true" || enabled === 1 || enabled === "1")
      .map(([scope]) => scope);
  }
  return [];
}

async function selectAll(table, query = "*", options = {}) {
  const client = await sb();
  const pageSize = Math.min(Math.max(Number(options.limit || 1000), 1), 1000);
  const start = Math.max(Number(options.from || 0), 0);
  const maxRows = Math.max(Number(options.maxRows || 20000), pageSize);
  const rows = [];
  for (let from = start; from < start + maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, start + maxRows - 1);
    const { data, error } = await client.from(table).select(query, { count: options.count || undefined }).range(from, to);
    fail(error);
    rows.push(...(data || []));
    if ((data || []).length < (to - from + 1)) break;
  }
  if (rows.length >= maxRows) debugWarn(`[${table}] تم الوصول للحد الأقصى ${maxRows}. استخدم فلترة التاريخ لو الجدول كبير جدًا.`);
  return rows;
}

let _coreCache = null;
let _coreExpiry = 0;
const coreMapKeys = ["roles", "branches", "departments", "governorates", "complexes"];
function serializeCoreCache(cache = {}) {
  const out = {};
  for (const key of coreMapKeys) out[key] = Array.from((cache[key] || new Map()).entries());
  return out;
}
function hydrateCoreCache(cache = {}) {
  const out = {};
  for (const key of coreMapKeys) out[key] = cache[key] instanceof Map ? cache[key] : new Map(Array.isArray(cache[key]) ? cache[key] : Object.entries(cache[key] || {}));
  return out;
}
function fromCoreMap(map, id) {
  if (!map || !id) return null;
  if (typeof map.get === "function") return map.get(id) || null;
  return map[id] || null;
}
async function core({ force = false } = {}) {
  if (!force && _coreCache && Date.now() < _coreExpiry) return _coreCache;
  try {
    const cached = sessionStorage.getItem("hr.core");
    const expiry = Number(sessionStorage.getItem("hr.core.exp") || 0);
    if (!force && cached && Date.now() < expiry) return (_coreCache = hydrateCoreCache(JSON.parse(cached)));
  } catch {}
  const [roles, branches, departments, governorates, complexes] = await Promise.all([
    selectAll("roles", "*", { limit: 1000 }),
    selectAll("branches", "*", { limit: 1000 }),
    selectAll("departments", "*", { limit: 1000 }),
    selectAll("governorates", "*", { limit: 1000 }),
    selectAll("complexes", "*", { limit: 1000 }),
  ]);
  const map = (rows) => new Map(rows.map((row) => [row.id, toCamel(row)]));
  _coreCache = {
    roles: map(roles),
    branches: map(branches),
    departments: map(departments),
    governorates: map(governorates),
    complexes: map(complexes),
  };
  _coreExpiry = Date.now() + 60_000;
  try {
    sessionStorage.setItem("hr.core", JSON.stringify(serializeCoreCache(_coreCache)));
    sessionStorage.setItem("hr.core.exp", String(_coreExpiry));
  } catch {}
  return _coreCache;
}

function enrichEmployee(row, c = {}) {
  const employee = toCamel(row);
  if (!employee) return null;
  return {
    ...employee,
    photoUrl: employee.photoUrl || employee.avatarUrl || "",
    isDeleted: Boolean(employee.isDeleted),
    role: fromCoreMap(c.roles, employee.roleId),
    branch: fromCoreMap(c.branches, employee.branchId),
    department: fromCoreMap(c.departments, employee.departmentId),
    governorate: fromCoreMap(c.governorates, employee.governorateId),
    complex: fromCoreMap(c.complexes, employee.complexId),
    manager: null,
  };
}

function enrichProfile(row, c = {}) {
  const profile = toCamel(row);
  if (!profile) return null;
  const role = fromCoreMap(c.roles, profile.roleId);
  return {
    ...profile,
    name: profile.fullName || profile.name || profile.email,
    fullName: profile.fullName || profile.name || profile.email,
    avatarUrl: profile.avatarUrl || profile.photoUrl || "",
    photoUrl: profile.photoUrl || profile.avatarUrl || "",
    employeeId: profile.employeeId || "",
    role,
    permissions: rolePermissions(role),
    branch: fromCoreMap(c.branches, profile.branchId),
    department: fromCoreMap(c.departments, profile.departmentId),
    governorate: fromCoreMap(c.governorates, profile.governorateId),
    complex: fromCoreMap(c.complexes, profile.complexId),
  };
}

function mapEvent(row, c = {}) {
  const item = toCamel(row);
  if (!item) return null;
  item.eventAt ||= item.createdAt;
  item.distanceFromBranchMeters = item.distanceFromBranchMeters ?? item.distanceMeters;
  return item;
}

function toEmployeePayload(body = {}) {
  return compact({
    full_name: body.fullName,
    phone: body.phone,
    email: body.email,
    photo_url: body.photoUrl,
    job_title: body.jobTitle,
    role_id: body.roleId,
    branch_id: body.branchId,
    department_id: body.departmentId,
    governorate_id: body.governorateId,
    complex_id: body.complexId,
    manager_employee_id: body.managerEmployeeId,
    status: "ACTIVE",
    hire_date: body.hireDate,
    is_active: body.status ? !["INACTIVE", "SUSPENDED", "TERMINATED", "DISABLED"].includes(body.status) : undefined,
    is_deleted: body.isDeleted,
  });
}

function contactPayload(body = {}) {
  return compact({
    email: body.email ? String(body.email).trim().toLowerCase() : undefined,
    phone: body.phone ? String(body.phone).trim() : undefined,
    avatar_url: body.avatarUrl || body.photoUrl || undefined,
  });
}

function locationInsertPayload(body = {}, employeeId) {
  return compact({
    employee_id: employeeId,
    latitude: body.latitude != null ? Number(body.latitude) : undefined,
    longitude: body.longitude != null ? Number(body.longitude) : undefined,
    accuracy_meters: body.accuracyMeters ?? body.accuracy ?? undefined,
    source: body.source || "employee_app",
    attendance_event_id: body.attendanceEventId || body.attendance_event_id || undefined,
    created_at: body.createdAt || now(),
  });
}

function locationRequestPayload(body = {}) {
  return compact({
    employee_id: body.employeeId,
    purpose: body.purpose,
    request_reason: body.requestReason,
    status: body.status,
    requested_by: body.requestedBy,
    decided_by: body.decidedBy,
    decided_at: body.decidedAt || (body.status && body.status !== "PENDING" ? now() : undefined),
  });
}

async function selfEmployeeId() {
  const user = await currentUser();
  return user?.employeeId || "";
}

function leavePayload(body = {}, employeeId = body.employeeId) {
  return compact({
    employee_id: employeeId,
    type: body.leaveType || body.type || "اعتيادية",
    start_date: body.startDate,
    end_date: body.endDate,
    reason: body.reason || "",
    status: body.status || "PENDING",
    manager_employee_id: body.managerEmployeeId,
  });
}

function missionPayload(body = {}, employeeId = body.employeeId) {
  return compact({
    employee_id: employeeId,
    title: body.title || "مأمورية",
    destination: body.destinationName || body.destination || "",
    planned_start: body.plannedStart,
    planned_end: body.plannedEnd,
    status: body.status || "PENDING",
    notes: body.notes || "",
    manager_employee_id: body.managerEmployeeId,
  });
}

function disputePayload(body = {}, employeeId = body.employeeId) {
  return compact({
    title: body.title || "شكوى / خلاف",
    description: body.description || "",
    employee_id: employeeId || undefined,
    status: body.status || "IN_REVIEW",
    severity: body.severity || "MEDIUM",
    committee_decision: body.committeeDecision,
    escalated_to_executive: body.escalatedToExecutive,
  });
}

function distanceMeters(a, b) {
  if (![a?.latitude, a?.longitude, b?.latitude, b?.longitude].every((value) => Number.isFinite(Number(value)))) return null;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(Number(b.latitude) - Number(a.latitude));
  const dLng = toRad(Number(b.longitude) - Number(a.longitude));
  const lat1 = toRad(Number(a.latitude));
  const lat2 = toRad(Number(b.latitude));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(h)));
}

async function currentUser() {
  const client = await sb();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData?.user) return null;
  const c = await core();
  const { data: profile, error } = await client.from("profiles").select("*").eq("id", authData.user.id).maybeSingle();
  fail(error);
  const enriched = enrichProfile(profile || { id: authData.user.id, email: authData.user.email, full_name: authData.user.email }, c);
  let emp = null;
  if (enriched.employeeId) {
    const { data } = await client.from("employees").select("*").eq("id", enriched.employeeId).maybeSingle();
    emp = data || null;
  }
  // Production safety: some older databases have employees.user_id linked but profiles.employee_id still empty.
  // The SQL patch 080 fixes this server-side, and this browser fallback keeps the app functional during rollout.
  if (!emp) {
    const byUser = await client.from("employees").select("*").eq("user_id", authData.user.id).maybeSingle().catch(() => ({ data: null }));
    emp = byUser?.data || null;
  }
  if (!emp && authData.user.email) {
    const byEmail = await client.from("employees").select("*").ilike("email", authData.user.email).maybeSingle().catch(() => ({ data: null }));
    emp = byEmail?.data || null;
  }
  if (emp) {
    enriched.employee = enrichEmployee(emp, c);
    enriched.employeeId = enriched.employee?.id || enriched.employeeId || "";
    enriched.role ||= enriched.employee?.role || null;
    enriched.permissions = enriched.permissions?.length ? enriched.permissions : rolePermissions(enriched.role || enriched.employee?.role);
    if (!enriched.avatarUrl && enriched.employee?.photoUrl) enriched.avatarUrl = enriched.employee.photoUrl;
    if (!enriched.photoUrl && enriched.avatarUrl) enriched.photoUrl = enriched.avatarUrl;
  }
  return enriched;
}

async function audit(action, entityType, entityId, afterData = {}, beforeData = null) {
  // Supabase edition uses database triggers for tamper-resistant audit logs.
  // This client hook is intentionally a no-op to avoid user-forged audit rows.
  return { skipped: true, action, entityType, entityId };
}

async function uploadDataUrl(bucket, folder, dataUrl, fileName = "selfie.jpg") {
  if (!dataUrl) return "";
  const client = await sb();
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const ext = fileName.split(".").pop() || "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(bucket).upload(path, blob, { upsert: false, contentType: blob.type || "image/jpeg" });
  fail(error, "تعذر رفع الصورة.");
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}


async function compressImageFile(file, { maxSide = 900, quality = 0.82 } = {}) {
  if (typeof document === "undefined" || !file || !String(file.type || "").startsWith("image/")) return file;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("ملف الصورة غير صالح."));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(image.width || maxSide, image.height || maxSide));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.width || maxSide) * scale));
  canvas.height = Math.max(1, Math.round((image.height || maxSide) * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#07101f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  return new File([blob], String(file.name || "avatar.jpg").replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() });
}
async function uploadFile(bucket, folder, file, { privateFile = false } = {}) {
  if (!file) return privateFile ? { url: "", bucket, path: "" } : "";
  const client = await sb();
  const safe = String(file.name || "file").replace(/[^\w.\-]+/g, "-");
  const path = `${folder}/${Date.now()}-${safe}`;
  const { error } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  fail(error, "تعذر رفع الملف.");
  if (privateFile) {
    const expiresIn = Number(CONFIG().security?.attachmentSignedUrlSeconds || 3600);
    const { data: signed, error: signError } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
    fail(signError, "تم رفع الملف لكن تعذر إنشاء رابط آمن مؤقت.");
    return { url: signed?.signedUrl || "", bucket, path, expiresIn };
  }
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function signedAttachmentUrl(item) {
  const bucket = item.bucketId || item.bucket_id || "";
  const path = item.storagePath || item.storage_path || "";
  if (!bucket || !path) return item.url || "";
  const client = await sb();
  const expiresIn = Number(CONFIG().security?.attachmentSignedUrlSeconds || 3600);
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) {
    debugWarn("تعذر إنشاء رابط مرفق مؤقت", error.message || error);
    return item.url || "";
  }
  return data?.signedUrl || item.url || "";
}

async function employeeById(employeeId) {
  const client = await sb();
  const c = await core();
  const { data, error } = await client.from("employees").select("*").eq("id", employeeId).maybeSingle();
  fail(error);
  return enrichEmployee(data, c);
}

async function employeeAccountUserId(employeeId) {
  if (!employeeId) return "";
  const client = await sb();
  const { data } = await client.from("profiles").select("id").eq("employee_id", employeeId).maybeSingle().catch(() => ({ data: null }));
  return data?.id || "";
}

function employeeDeliveryScore(employee) {
  const phone = normalizeLoginPhone(employee?.phone);
  const email = String(employee?.email || "");
  let score = employee?.userId ? 100 : 0;
  if (phone) score += 20;
  if (!/^PHONE_PLACEHOLDER_/i.test(String(employee?.phone || ""))) score += 10;
  if (email && !/@ahla\.local$/i.test(email)) score += 5;
  return score;
}

function employeeNameKey(employee) {
  return String(employee?.fullName || employee?.name || "").trim().replace(/\s+/g, " ");
}

function employeeRosterKeys(employee = {}) {
  return [
    employee.employeeCode,
    employee.phone,
    employee.email,
    employeeNameKey(employee),
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

async function authorizedRosterEmployeeKeySet() {
  try {
    const rows = await selectAll("authorized_employee_roster", "*", { limit: 1000 });
    const keys = new Set();
    for (const row of rows || []) {
      for (const value of [row.employee_code, row.phone, row.email, row.full_name]) {
        const key = String(value || "").trim().toLowerCase();
        if (key) keys.add(key);
      }
    }
    return keys;
  } catch {
    return new Set();
  }
}

function orphanDemoEmployee(employee) {
  return !employee?.userId && (/^PHONE_PLACEHOLDER_/i.test(String(employee?.phone || "")) || /^emp\.demo/i.test(String(employee?.email || "")));
}

async function resolveDeliverableEmployee(employeeId) {
  const target = await employeeById(employeeId);
  if (!target?.id) throw new Error("الموظف المطلوب غير موجود.");
  const directUserId = target.userId || await employeeAccountUserId(target.id);
  if (directUserId) return { ...target, userId: directUserId };

  const client = await sb();
  const c = await core();
  const samePhone = normalizeLoginPhone(target.phone);
  let query = client.from("employees").select("*").neq("id", target.id).not("user_id", "is", null).limit(20);
  if (samePhone) query = query.eq("phone", samePhone);
  else query = query.eq("full_name", target.fullName || target.name || "");
  const { data, error } = await query;
  fail(error, "تعذر البحث عن حساب الموظف المرتبط.");
  const candidates = (data || []).map((row) => enrichEmployee(row, c)).filter(Boolean).sort((a, b) => employeeDeliveryScore(b) - employeeDeliveryScore(a));
  const replacement = candidates[0] || null;
  if (!replacement?.id) throw new Error("هذا الموظف غير مربوط بحساب دخول، لذلك لا يمكن إرسال طلب موقع له قبل ربط الحساب بالموظف.");
  const replacementUserId = replacement.userId || await employeeAccountUserId(replacement.id);
  if (!replacementUserId) throw new Error("هذا الموظف غير مربوط بحساب دخول، لذلك لا يمكن إرسال طلب موقع له قبل ربط الحساب بالموظف.");
  return { ...replacement, userId: replacementUserId };
}

async function myEmployee() {
  const user = await currentUser();
  if (!user?.employeeId) throw new Error("هذا الحساب غير مرتبط بملف موظف.");
  return await employeeById(user.employeeId);
}

async function attendanceAddress(employee = null) {
  let emp = employee || null;
  try { if (!emp) emp = await myEmployee(); } catch { emp = null; }
  const c = await core();
  const branch = emp ? (c.branches.get(emp.branchId) || emp.branch || null) : ([...c.branches.values()][0] || null);
  const lat = Number(branch?.latitude);
  const lng = Number(branch?.longitude);
  return {
    employee: emp,
    branch,
    address: branch?.address || DEFAULT_COMPLEX.address,
    hasConfiguredAddress: Number.isFinite(lat) && Number.isFinite(lng),
    latitude: Number.isFinite(lat) ? lat : DEFAULT_COMPLEX.latitude,
    longitude: Number.isFinite(lng) ? lng : DEFAULT_COMPLEX.longitude,
    radiusMeters: Number(branch?.geofenceRadiusMeters || branch?.radiusMeters || DEFAULT_COMPLEX.radiusMeters),
    maxAccuracyMeters: Number(branch?.maxAccuracyMeters || DEFAULT_COMPLEX.maxAccuracyMeters),
    strictGeofence: true,
  };
}

function evaluateGeo(address, body = {}) {
  const current = Number.isFinite(Number(body.latitude)) && Number.isFinite(Number(body.longitude)) ? { latitude: Number(body.latitude), longitude: Number(body.longitude) } : null;
  let geofenceStatus = "unknown";
  let distanceFromBranchMeters = null;
  let allowed = false;
  let message = "تعذر قراءة الموقع الحالي.";
  const accuracyMeters = body.accuracyMeters != null ? Number(body.accuracyMeters) : null;
  if (!current) {
    geofenceStatus = body.locationPermission === "denied" ? "permission_denied" : "location_unavailable";
    message = geofenceStatus === "permission_denied" ? "تم رفض صلاحية الموقع." : "الموقع غير متاح.";
  } else if (!address?.hasConfiguredAddress) {
    geofenceStatus = "branch_location_missing";
    message = "لم يتم ضبط إحداثيات الفرع المعتمد.";
  } else {
    distanceFromBranchMeters = distanceMeters(current, { latitude: address.latitude, longitude: address.longitude });
    const weakAccuracy = accuracyMeters != null && accuracyMeters > address.maxAccuracyMeters;
    const safetyBufferMeters = Number(CONFIG?.().attendance?.gpsSafetyBufferMeters || CONFIG?.().attendance?.branchLocation?.safetyBufferMeters || 90);
    const effectiveRadius = Number(address.radiusMeters || 300) + safetyBufferMeters + (accuracyMeters ? Math.min(Math.max(accuracyMeters, 0), Math.max(Number(address.maxAccuracyMeters || 500), 300)) : 0);
    allowed = distanceFromBranchMeters != null && (distanceFromBranchMeters <= address.radiusMeters || (weakAccuracy && distanceFromBranchMeters <= effectiveRadius));
    geofenceStatus = allowed ? (weakAccuracy ? "inside_branch_low_accuracy" : "inside_branch") : (weakAccuracy ? "location_low_accuracy" : "outside_branch");
    message = allowed
      ? (weakAccuracy ? `تم قبول الموقع مع دقة GPS ضعيفة (${accuracyMeters} متر). يفضل تشغيل الموقع عالي الدقة.` : "الموقع داخل العنوان المحدد ويمكن تسجيل البصمة.")
      : (weakAccuracy ? `دقة الموقع ضعيفة: ${accuracyMeters} متر. اقترب من مكان مفتوح وفعّل GPS عالي الدقة ثم حاول مرة أخرى.` : `أنت خارج نطاق العنوان المحدد. المسافة ${distanceFromBranchMeters} متر والنطاق ${address.radiusMeters} متر.`);
  }
  return { allowed, canRecord: allowed, geofenceStatus, distanceFromBranchMeters, distanceMeters: distanceFromBranchMeters, radiusMeters: address.radiusMeters, maxAccuracyMeters: address.maxAccuracyMeters, accuracyMeters, message, blockReason: allowed ? "" : message };
}

async function upsertDaily(employeeId, event) {
  const client = await sb();
  const { error } = await client.rpc('upsert_attendance_daily_from_event', {
    p_employee_id: employeeId,
    p_type: event.type,
    p_event_at: event.event_at || event.eventAt || now(),
    p_status: event.status || null,
    p_late_minutes: event.late_minutes || event.lateMinutes || 0,
    p_requires_review: Boolean(event.requires_review || event.requiresReview),
  });
  fail(error, 'تعذر تحديث يومية الحضور.');
}

function riskLevelFromScore(score = 0) {
  const value = Math.min(100, Math.max(0, Number(score || 0)));
  if (value >= 70) return "HIGH";
  if (value >= 35) return "MEDIUM";
  return "LOW";
}

async function serverSharedDeviceFlags(client, employeeId, deviceFingerprintHash) {
  if (!deviceFingerprintHash || !employeeId) return [];
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("attendance_events")
    .select("employee_id,event_at")
    .eq("device_fingerprint_hash", deviceFingerprintHash)
    .gte("event_at", since)
    .neq("employee_id", employeeId)
    .limit(5);
  if (error) {
    debugWarn("تعذر فحص استخدام نفس الجهاز على الخادم", error);
    return [];
  }
  return (data || []).length ? ["SERVER_SHARED_DEVICE_RECENT"] : [];
}

async function withServerIdentityRisk(client, employeeId, body = {}) {
  const serverFlags = await serverSharedDeviceFlags(client, employeeId, body.deviceFingerprintHash);
  if (!serverFlags.length) return body;
  const mergedFlags = Array.from(new Set([...(body.riskFlags || []), ...serverFlags]));
  const riskScore = Math.min(100, Math.max(Number(body.riskScore || 0), 70));
  return {
    ...body,
    riskFlags: mergedFlags,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    requiresReview: true,
    identityCheck: {
      ...(body.identityCheck || {}),
      serverSharedDeviceCheck: "MATCHED_OTHER_EMPLOYEE_WITHIN_30_MINUTES",
      serverRiskFlags: serverFlags,
    },
  };
}

async function recordPunch(type, body = {}, forceEmployeeId = "") {
  const client = await sb();
  const user = await currentUser();
  const employee = forceEmployeeId ? await employeeById(forceEmployeeId) : await myEmployee();
  body = await withServerIdentityRisk(client, employee.id, body);
  const address = await attendanceAddress(employee);
  const evaluation = evaluateGeo(address, body);
  const requiresReview = !evaluation.canRecord;
  if (requiresReview) await audit("attendance.accepted_with_review", "attendance_event", employee.id, { type, evaluation });
  const selfieUrl = "";
  const { data: serverNow } = await client.rpc('server_now');
  const eventAt = serverNow || now();
  let lateMinutes = 0;
  if (type === "CHECK_IN") {
    const { data: calculatedLate, error: lateError } = await client.rpc('calculate_late_minutes', { p_employee_id: employee.id, p_event_at: eventAt });
    fail(lateError, 'تعذر حساب التأخير.');
    lateMinutes = Number(calculatedLate || 0);
  }
  const status = type === "CHECK_IN" ? (lateMinutes > 0 ? "LATE" : "PRESENT") : "CHECK_OUT"; // للتقارير فقط، لا يمنع التسجيل
  const basePayload = {
    employee_id: employee.id,
    user_id: user?.id || null,
    type,
    status,
    event_at: eventAt,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    accuracy_meters: body.accuracyMeters ?? body.accuracy ?? null,
    geofence_status: evaluation.geofenceStatus,
    distance_from_branch_meters: evaluation.distanceFromBranchMeters,
    branch_id: employee.branchId || null,
    verification_status: body.verificationStatus || "verified",
    biometric_method: body.biometricMethod || "session_gps",
    passkey_credential_id: body.passkeyCredentialId || null,
    passkey_verified_at: body.passkeyCredentialId ? eventAt : null,
    selfie_url: body.selfieUrl || selfieUrl,
    notes: body.notes || "",
    late_minutes: lateMinutes,
    requires_review: Boolean(requiresReview || body.requiresReview),
  };
  const identityPayload = compact({
    trusted_device_id: body.trustedDeviceId || null,
    device_fingerprint_hash: body.deviceFingerprintHash || null,
    browser_install_id: body.browserInstallId || null,
    branch_qr_status: body.branchQrStatus || null,
    branch_qr_challenge_id: body.branchQrChallengeId || null,
    anti_spoofing_flags: body.antiSpoofingFlags || null,
    identity_check: body.identityCheck || null,
    risk_score: body.riskScore ?? null,
    risk_level: body.riskLevel || null,
    risk_flags: body.riskFlags || null,
  });
  const extendedPayload = { ...basePayload, ...identityPayload };
  let insert = await client.from("attendance_events").insert(extendedPayload).select("*").single();
  if (insert.error && ["42703", "PGRST204"].includes(insert.error.code)) {
    insert = await client.from("attendance_events").insert(basePayload).select("*").single();
  }
  const { data, error } = insert;
  fail(error, "تعذر حفظ البصمة.");
  if (data?.id && (body.identityCheck || body.riskFlags || body.riskScore != null)) {
    await ignoreSupabaseError(client.from("attendance_identity_checks").insert({
      attendance_event_id: data.id,
      employee_id: employee.id,
      user_id: user?.id || null,
      trusted_device_id: body.trustedDeviceId || null,
      device_fingerprint_hash: body.deviceFingerprintHash || null,
      passkey_credential_id: body.passkeyCredentialId || null,
      selfie_url: body.selfieUrl || selfieUrl || "",
      risk_score: body.riskScore ?? 0,
      risk_level: body.riskLevel || "LOW",
      risk_flags: body.riskFlags || [],
      browser_install_id: body.browserInstallId || null,
      branch_qr_status: body.branchQrStatus || "NOT_PROVIDED",
      branch_qr_challenge_id: body.branchQrChallengeId || null,
      anti_spoofing_flags: body.antiSpoofingFlags || [],
      location_trust: body.identityCheck?.locationTrust || {},
      liveness_status: body.identityCheck?.livenessStatus || "SELFIE_ONLY",
      identity_check: body.identityCheck || {},
      requires_review: Boolean(requiresReview || body.requiresReview),
    }));
    for (const flag of body.riskFlags || []) {
      await ignoreSupabaseError(client.from("attendance_risk_events").insert({
        attendance_event_id: data.id,
        employee_id: employee.id,
        risk_flag: flag,
        risk_score: body.riskScore ?? 0,
        details: body.identityCheck || {},
      }));
    }
    if (Number(body.riskScore || 0) >= 70 || (body.requiresReview && (body.riskFlags || []).length)) {
      await ignoreSupabaseError(client.rpc("create_attendance_risk_escalation", {
        p_employee_id: employee.id,
        p_attendance_event_id: data.id,
        p_risk_score: body.riskScore ?? 0,
        p_risk_flags: body.riskFlags || [],
      }));
    }
  }
  const payload = basePayload;
  await upsertDaily(employee.id, payload);
  await client.from("employee_locations").insert({ employee_id: employee.id, latitude: body.latitude, longitude: body.longitude, accuracy_meters: body.accuracyMeters ?? body.accuracy ?? null, source: "attendance", attendance_event_id: data.id, created_at: now() });
  await audit("attendance.punch", "attendance_event", data.id, data);
  return { ...mapEvent(data), evaluation };
}

async function recordManualPunch(type, body = {}, forceEmployeeId = "") {
  const client = await sb();
  const user = await currentUser();
  const employee = forceEmployeeId ? await employeeById(forceEmployeeId) : await myEmployee();
  const { data: serverNow } = await client.rpc('server_now');
  const eventAt = serverNow || now();
  const payload = {
    employee_id: employee.id,
    user_id: user?.id || null,
    type,
    status: type === "CHECK_IN" ? "MANUAL_CHECK_IN" : "MANUAL_CHECK_OUT",
    event_at: eventAt,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    accuracy_meters: body.accuracyMeters ?? body.accuracy ?? null,
    geofence_status: "manual_review_required",
    distance_from_branch_meters: null,
    branch_id: employee.branchId || null,
    verification_status: "manual",
    biometric_method: "manual",
    selfie_url: "",
    notes: body.notes || "تسجيل يدوي — يحتاج مراجعة واعتماد HR",
    late_minutes: 0,
    requires_review: true,
  };
  const { data, error } = await client.from("attendance_events").insert(payload).select("*").single();
  fail(error, "تعذر حفظ البصمة اليدوية.");
  await upsertDaily(employee.id, payload);
  return { ...mapEvent(data), manual: true, requiresReview: true };
}

function queueOffline(action, body = {}) {
  const key = "hr.supabase.offlineQueue.safe";
  const rows = JSON.parse(localStorage.getItem(key) || "[]");
  const item = {
    id: makeId("queue"),
    action,
    status: "PENDING",
    createdAt: now(),
    attempts: 0,
    // No raw coordinates, selfie data, or employee IDs are stored in localStorage.
    summary: { type: body.type || action, hasPasskey: Boolean(body.passkeyCredentialId), hasLocation: Boolean(body.latitude && body.longitude) },
  };
  rows.unshift(item);
  localStorage.setItem(key, JSON.stringify(rows.slice(0, 100)));
  return item;
}

function getQueued() {
  return JSON.parse(localStorage.getItem("hr.supabase.offlineQueue.safe") || "[]");
}

function setQueued(rows) {
  localStorage.setItem("hr.supabase.offlineQueue.safe", JSON.stringify(rows));
}

async function tableRows(table, order = "created_at", ascending = false, options = {}) {
  const client = await sb();
  const pageSize = Math.min(Math.max(Number(options.limit || 1000), 1), 1000);
  const maxRows = Math.max(Number(options.maxRows || 20000), pageSize);
  const start = Math.max(Number(options.page || 0), 0) * pageSize;
  const rows = [];
  for (let from = start; from < start + maxRows; from += pageSize) {
    let query = client.from(table).select(options.query || "*", { count: options.count || undefined }).order(order, { ascending });
    if (options.fromDate && options.dateColumn) query = query.gte(options.dateColumn, options.fromDate);
    if (options.toDate && options.dateColumn) query = query.lte(options.dateColumn, options.toDate);
    const to = Math.min(from + pageSize - 1, start + maxRows - 1);
    const { data, error } = await query.range(from, to);
    fail(error);
    rows.push(...(data || []));
    if ((data || []).length < (to - from + 1)) break;
  }
  if (rows.length >= maxRows) debugWarn(`[${table}] تم الوصول للحد الأقصى ${maxRows}. استخدم فلترة التاريخ لو الجدول كبير جدًا.`);
  return rows;
}

async function createOrUpdate(table, body, id = body?.id) {
  const client = await sb();
  const payload = toSnake(compact(body));
  delete payload.id;
  const query = id ? client.from(table).update(payload).eq("id", id) : client.from(table).insert(payload);
  const { data, error } = await query.select("*").single();
  fail(error);
  await audit(id ? "update" : "create", table, data.id, data);
  return toCamel(data);
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
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

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+$/.test(String(value || "").trim());
}

const loginResolveCache = new Map();
const LOGIN_RESOLVE_CACHE_MS = 10 * 60 * 1000;
const LOGIN_RESOLVE_COOLDOWN_MS = 60 * 1000;

function loginResolveCacheKey(phone) {
  return `hr.login.resolve.${phone}`;
}

function getCachedLoginEmail(phone) {
  const memory = loginResolveCache.get(phone);
  if (memory?.email && memory.expiresAt > Date.now()) return memory.email;
  try {
    const cached = JSON.parse(sessionStorage.getItem(loginResolveCacheKey(phone)) || "null");
    if (cached?.email && cached.expiresAt > Date.now()) {
      loginResolveCache.set(phone, cached);
      return cached.email;
    }
  } catch {}
  return "";
}

function cacheLoginEmail(phone, email) {
  const row = { email, expiresAt: Date.now() + LOGIN_RESOLVE_CACHE_MS };
  loginResolveCache.set(phone, row);
  try { sessionStorage.setItem(loginResolveCacheKey(phone), JSON.stringify(row)); } catch {}
}

function getLoginResolveCooldown(phone) {
  try {
    const until = Number(sessionStorage.getItem(`${loginResolveCacheKey(phone)}.cooldown`) || 0);
    return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
  } catch {
    return 0;
  }
}

function setLoginResolveCooldown(phone) {
  try { sessionStorage.setItem(`${loginResolveCacheKey(phone)}.cooldown`, String(Date.now() + LOGIN_RESOLVE_COOLDOWN_MS)); } catch {}
}

async function resolveLoginEmail(identifier) {
  const client = await sb();
  const raw = String(identifier || "").trim();
  if (!raw) throw new Error("اكتب رقم الهاتف أو البريد الإلكتروني.");
  if (looksLikeEmail(raw)) return raw.toLowerCase();
  const phone = normalizeLoginPhone(raw);
  if (!phone) throw new Error("اكتب رقم هاتف صحيح أو بريد إلكتروني صحيح.");
  const cachedEmail = getCachedLoginEmail(phone);
  if (cachedEmail) return cachedEmail;
  const cooldownSeconds = getLoginResolveCooldown(phone);
  if (cooldownSeconds) throw new Error(`خدمة الدخول برقم الهاتف تم استدعاؤها بشكل متكرر. انتظر ${cooldownSeconds} ثانية أو استخدم البريد الإلكتروني.`);
  const { data, error } = await client.functions.invoke("resolve-login-identifier", { body: { identifier: phone } });
  if (error) {
    debugWarn("resolve-login-identifier function failed", error);
    setLoginResolveCooldown(phone);
    throw new Error("خدمة الدخول برقم الهاتف تواجه مشكلة أو تم تجاوز الحد المسموح. يرجى المحاولة باستخدام البريد الإلكتروني.");
  }
  const email = String(data?.email || "").trim();
  if (!email) throw new Error("لا يوجد حساب دخول مرتبط بهذا الرقم. تواصل مع الإدارة لربط الرقم بالموظف.");
  cacheLoginEmail(phone, email.toLowerCase());
  return email.toLowerCase();
}

async function maybeTableRows(table, order = "created_at", ascending = false) {
  try { return await tableRows(table, order, ascending); } catch { return []; }
}

async function supabaseDailyReportRows(filters = {}) {
  const client = await sb();
  let query = client.from("daily_reports").select("*, employee:employees(*)").order("report_date", { ascending: false }).limit(1000);
  if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  fail(error, "تعذر قراءة التقارير اليومية. تأكد من تطبيق Patch 022.");
  return (data || []).map(({ employee, ...row }) => ({ ...toCamel(row), employee: employee ? enrichEmployee(employee) : null }));
}

function supabaseUserHas(user, scopes = []) {
  const wanted = Array.isArray(scopes) ? scopes : [scopes];
  const permissions = new Set([...(user?.permissions || []), ...(rolePermissions(user?.role) || [])]);
  const slug = String(user?.role?.slug || user?.role?.key || user?.roleId || '').toLowerCase();
  if (permissions.has('*') || ['admin','role-admin','executive-secretary','role-executive-secretary'].includes(slug)) return true;
  return wanted.some((scope) => permissions.has(scope));
}

function scoreSupabaseRisk(employee, attendance = [], days = 7) {
  const since = new Date(Date.now() - Math.max(1, Number(days || 7)) * 86400000);
  const events = attendance
    .filter((event) => event.employeeId === employee.id && new Date(event.eventAt || event.createdAt || 0) >= since)
    .sort((a, b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
  const flags = [];
  const deviceIds = new Set(events.map((event) => event.deviceId || event.deviceFingerprint || event.clientId || event.userAgent).filter(Boolean));
  if (deviceIds.size > 1) flags.push({ code: 'NEW_DEVICE', label: 'جهاز جديد أو أكثر', points: 20 });
  const outside = events.filter((event) => ['outside_branch','geofence_miss','location_low_accuracy','permission_denied','location_unavailable'].includes(event.geofenceStatus) || event.requiresReview);
  if (outside.length) flags.push({ code: 'OUT_OF_RANGE', label: `بصمات خارج النطاق/ضعيفة: ${outside.length}`, points: Math.min(35, outside.length * 10) });
  let duplicateCount = 0;
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const cur = events[i];
    const sameType = String(prev.type || prev.action || '') === String(cur.type || cur.action || '');
    const gap = Math.abs(new Date(cur.eventAt || cur.createdAt || 0) - new Date(prev.eventAt || prev.createdAt || 0)) / 60000;
    if (sameType && gap <= 10) duplicateCount += 1;
  }
  if (duplicateCount) flags.push({ code: 'DUPLICATE_PUNCH', label: `تكرار بصمة سريع: ${duplicateCount}`, points: Math.min(30, duplicateCount * 15) });
  const far = events.filter((event) => Number(event.distanceMeters || event.distanceFromBranchMeters || 0) >= 1000);
  if (far.length) flags.push({ code: 'FAR_DISTANCE', label: `حضور من مسافة بعيدة: ${far.length}`, points: Math.min(35, far.length * 12) });
  const missingLocation = events.filter((event) => !event.latitude && !event.location?.latitude && ['CHECK_IN','CHECK_OUT'].includes(event.type || event.action));
  if (missingLocation.length) flags.push({ code: 'MISSING_LOCATION', label: `بصمة بدون موقع: ${missingLocation.length}`, points: Math.min(25, missingLocation.length * 8) });
  const score = Math.min(100, flags.reduce((sum, flag) => sum + Number(flag.points || 0), 0));
  const level = score >= 70 ? 'HIGH' : score >= 35 ? 'MEDIUM' : score > 0 ? 'LOW' : 'CLEAR';
  return { employeeId: employee.id, employee, score, level, flags, events: events.slice(-12).reverse(), generatedAt: now() };
}

function decisionVisibleToSupabaseUser(decision, user) {
  const employeeId = user?.employeeId || user?.employee?.id || '';
  const scope = decision.scope || 'ALL';
  const ids = Array.isArray(decision.targetEmployeeIds) ? decision.targetEmployeeIds : [];
  return scope === 'ALL' || scope === 'EMPLOYEES' || ids.includes(employeeId);
}


function clampKpiScore(value, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Number(max || 100), Math.round(number * 10) / 10));
}

function canonicalKpiStatus(value = "", fallback = "DRAFT") {
  const raw = String(value || fallback || "DRAFT").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = { EMPLOYEE_SUBMITTED: "SELF_SUBMITTED", SUBMITTED: "SELF_SUBMITTED", APPROVED: "EXECUTIVE_APPROVED", HR_APPROVED: "HR_REVIEWED", MANAGER_REVIEWED: "MANAGER_APPROVED", SECRETARY_APPROVED: "SECRETARY_REVIEWED" };
  return aliases[raw] || raw || fallback || "DRAFT";
}

function kpiStageLabel(status = "") {
  return { DRAFT: "مسودة", SELF_SUBMITTED: "مرسل من الموظف", MANAGER_APPROVED: "اعتماد المدير المباشر", HR_REVIEWED: "مراجعة HR", SECRETARY_REVIEWED: "مراجعة السكرتير التنفيذي", EXECUTIVE_APPROVED: "اعتماد المدير التنفيذي", REJECTED: "يحتاج تعديل" }[canonicalKpiStatus(status)] || status || "مسودة";
}

function expectedPreviousKpiStatus(nextStatus) {
  return { MANAGER_APPROVED: "SELF_SUBMITTED", HR_REVIEWED: "MANAGER_APPROVED", SECRETARY_REVIEWED: "HR_REVIEWED", EXECUTIVE_APPROVED: "SECRETARY_REVIEWED" }[canonicalKpiStatus(nextStatus)] || "";
}

function scoreFromKpiBody(body, scoreKey, percentKey, max) {
  if (body?.[scoreKey] !== undefined && body?.[scoreKey] !== "") return clampKpiScore(body[scoreKey], max);
  if (body?.[percentKey] !== undefined && body?.[percentKey] !== "") return clampKpiScore(Number(body[percentKey] || 0) * Number(max || 0) / 100, max);
  return 0;
}

function normalizeKpiPayload(body = {}, fallbackStatus = "DRAFT", existing = {}) {
  const scores = {
    targetScore: scoreFromKpiBody(body, "targetScore", "targetPercent", 40),
    efficiencyScore: scoreFromKpiBody(body, "efficiencyScore", "efficiencyPercent", 20),
    attendanceScore: body.attendanceScore === undefined || body.attendanceScore === "" ? Number(existing.attendanceScore || 0) : clampKpiScore(body.attendanceScore, 20),
    conductScore: scoreFromKpiBody(body, "conductScore", "conductPercent", 5),
    prayerScore: body.prayerScore === undefined || body.prayerScore === "" ? Number(existing.prayerScore || 0) : clampKpiScore(body.prayerScore, 5),
    quranCircleScore: body.quranCircleScore === undefined || body.quranCircleScore === "" ? Number(existing.quranCircleScore || 0) : clampKpiScore(body.quranCircleScore, 5),
    initiativesScore: scoreFromKpiBody(body, "initiativesScore", "initiativesPercent", 5),
  };
  const totalScore = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    ...body,
    ...scores,
    status: canonicalKpiStatus(body.status || fallbackStatus),
    totalScore: Math.round(totalScore * 10) / 10,
    rating: totalScore >= 90 ? "ممتاز" : totalScore >= 80 ? "جيد جدًا" : totalScore >= 70 ? "جيد" : totalScore >= 60 ? "مقبول" : "يحتاج تحسين",
    updatedAt: now(),
  };
}

function assertSupabaseKpiTransition({ user, employee, existing, nextStatus, accessMode }) {
  nextStatus = canonicalKpiStatus(nextStatus);
  const dayOfMonth = new Date().getDate();
  if (["SELF_SUBMITTED", "MANAGER_APPROVED"].includes(nextStatus) && dayOfMonth > 25 && accessMode !== "all") throw new Error("تم قفل تعديل الموظف والمدير بعد يوم 25؛ تستكمل HR والسكرتير والتنفيذي فقط.");
  const previousStatus = canonicalKpiStatus(existing?.status || "", existing ? "DRAFT" : "");
  if (nextStatus === "SELF_SUBMITTED") {
    if (employee?.id !== user?.employeeId && !user?.permissions?.includes?.("*")) throw new Error("لا يمكن رفع التقييم الذاتي إلا من حساب الموظف نفسه.");
    if (existing && !["DRAFT", "REJECTED", "SELF_SUBMITTED"].includes(previousStatus)) throw new Error("تم انتقال هذا التقييم للمرحلة التالية ولا يمكن تعديله من الموظف.");
    return;
  }
  const expected = expectedPreviousKpiStatus(nextStatus);
  if (expected && !existing) throw new Error("لا يمكن بدء التقييم من هذه المرحلة. يجب أن يبدأ الموظف بتقييم نفسه أولًا.");
  if (expected && previousStatus !== expected) throw new Error(`هذا التقييم في مرحلة ${kpiStageLabel(previousStatus)} ولا يمكن نقله إلى ${kpiStageLabel(nextStatus)} قبل اكتمال المرحلة السابقة.`);
  if (nextStatus === "MANAGER_APPROVED" && accessMode !== "team" && accessMode !== "all") throw new Error("اعتماد المدير يتم من المدير المباشر فقط.");
  if (nextStatus === "MANAGER_APPROVED" && accessMode === "team" && employee?.managerEmployeeId !== user?.employeeId) throw new Error("لا يمكنك اعتماد تقييم موظف خارج فريقك المباشر.");
  if (nextStatus === "HR_REVIEWED" && !["hr", "all"].includes(accessMode)) throw new Error("مراجعة HR تتم من لوحة HR فقط.");
  if (nextStatus === "SECRETARY_REVIEWED" && accessMode !== "all") throw new Error("تسليم السكرتير التنفيذي يحتاج صلاحية كاملة بعد مراجعة HR.");
  if (nextStatus === "EXECUTIVE_APPROVED" && !["executive", "all"].includes(accessMode)) throw new Error("الاعتماد النهائي متاح للمدير التنفيذي فقط.");
}

async function notifySupabaseKpiStage({ employee, saved, nextStatus }) {
  const status = canonicalKpiStatus(nextStatus || saved?.status);
  const nextIds = status === "SELF_SUBMITTED" ? [employee?.managerEmployeeId || employee?.managerId || employee?.directManagerId]
    : status === "MANAGER_APPROVED" ? ["emp-hr-manager"]
    : status === "HR_REVIEWED" ? ["emp-executive-secretary"]
    : status === "SECRETARY_REVIEWED" ? ["emp-executive-director"]
    : [];
  const ids = nextIds.filter(Boolean);
  if (!ids.length) return { notified: 0, pushed: 0 };
  const client = await sb();
  const title = "تقييم KPI يحتاج متابعة";
  const body = `${employee?.fullName || employee?.full_name || saved?.employeeId || "موظف"} — ${kpiStageLabel(status)}`;
  await safeCreateNotifications(client, ids.map((employeeId) => ({ employee_id: employeeId, title, body, type: "ACTION_REQUIRED", status: "UNREAD", is_read: false, route: "kpi", data: { route: "kpi", kpiEvaluationId: saved?.id || "", status } }))).catch(() => null);
  let pushed = 0;
  await client.functions.invoke("send-push-notifications", { body: { title, body, tag: "kpi-stage", targetEmployeeIds: ids, data: { route: "kpi", kpiEvaluationId: saved?.id || "", status } } }).then(({ data, error }) => { if (!error) pushed = Number(data?.attempted || data?.sent || 0); }).catch(() => null);
  return { notified: ids.length, pushed };
}


async function kpiAccessContext() {
  const [employees, user] = await Promise.all([supabaseEndpoints.employees(), currentUser()]);
  const rolePerms = new Set(user?.permissions || []);
  const accessMode = rolePerms.has("*") || rolePerms.has("kpi:manage") ? "all" : rolePerms.has("kpi:hr") ? "hr" : rolePerms.has("kpi:team") ? "team" : (rolePerms.has("kpi:executive") || rolePerms.has("kpi:final-approve")) ? "executive" : "self";
  return { employees, user, rolePerms, accessMode };
}

export const supabaseEndpoints = {
  executivePresenceDashboard: async () => {
    const mobile = await supabaseEndpoints.executiveMobile();
    const risk = await supabaseEndpoints.attendanceRiskCenter({ days: 7 }).catch(() => ({ rows: [] }));
    const riskById = new Map((risk.rows || []).map((row) => [row.employeeId, row]));
    const rows = (mobile.employees || []).map((employee) => {
      const loc = employee.today?.latestLocation || {};
      const mapUrl = loc.latitude && loc.longitude ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : '';
      return {
        employeeId: employee.id,
        employee,
        day: now().slice(0, 10),
        status: employee.today?.status || 'ABSENT',
        checkInAt: employee.today?.checkInAt || '',
        checkOutAt: employee.today?.checkOutAt || '',
        lastLocation: loc || null,
        pendingLiveRequest: employee.today?.pendingLiveRequest || null,
        risk: riskById.get(employee.id) || { score: 0, level: 'CLEAR', flags: [] },
        locationStatus: mapUrl ? 'LIVE_SHARED' : 'LOCATION_MISSING',
        mapUrl,
      };
    });
    const counts = rows.reduce((acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (!row.mapUrl && ['PRESENT','LATE','CHECKED_OUT'].includes(row.status)) acc.missingLocation += 1;
      if (row.risk?.flags?.some((flag) => flag.code === 'OUT_OF_RANGE')) acc.outOfRange += 1;
      return acc;
    }, { total: 0, PRESENT: 0, LATE: 0, ABSENT: 0, CHECKED_OUT: 0, ON_LEAVE: 0, ON_MISSION: 0, missingLocation: 0, outOfRange: 0 });
    return { day: now().slice(0, 10), counts, rows, generatedAt: now() };
  },
  attendanceRiskCenter: async (options = {}) => {
    const days = Number(options.days || 7);
    const [employees, attendance] = await Promise.all([
      supabaseEndpoints.employees(),
      maybeTableRows('attendance_events', 'event_at', false).then(toCamel),
    ]);
    const rows = (employees || []).map((employee) => scoreSupabaseRisk(employee, attendance || [], days)).sort((a, b) => b.score - a.score);
    const counts = rows.reduce((acc, row) => { acc.total += 1; acc[row.level] = (acc[row.level] || 0) + 1; return acc; }, { total: 0, HIGH: 0, MEDIUM: 0, LOW: 0, CLEAR: 0 });
    return { days, counts, rows, generatedAt: now(), rules: ['تكرار بصمة خلال 10 دقائق','خروج عن نطاق الفرع','جهاز جديد','حضور من مسافة بعيدة','بصمة بدون GPS'] };
  },
  adminDecisions: async () => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const manage = supabaseUserHas(user, ['decisions:manage','notifications:manage','executive:report']);
    const [{ data: decisions, error }, { data: acks }] = await Promise.all([
      client.from('admin_decisions').select('*').order('created_at', { ascending: false }).limit(500),
      client.from('admin_decision_acknowledgements').select('*').order('acknowledged_at', { ascending: false }).limit(5000),
    ]);
    fail(error, 'تعذر قراءة سجل القرارات الإدارية. تأكد من تطبيق Patch 043.');
    const ackRows = toCamel(acks || []);
    let rows = toCamel(decisions || []);
    if (!manage) rows = rows.filter((decision) => decisionVisibleToSupabaseUser(decision, user));
    rows = rows.map((decision) => {
      const acknowledgement = ackRows.find((ack) => ack.decisionId === decision.id && ack.employeeId === (user?.employeeId || user?.employee?.id));
      return { ...decision, acknowledgements: ackRows.filter((ack) => ack.decisionId === decision.id), acknowledged: Boolean(acknowledgement), acknowledgedAt: acknowledgement?.acknowledgedAt || '' };
    });
    return { decisions: rows };
  },
  createAdminDecision: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    if (!supabaseUserHas(user, ['decisions:manage','notifications:manage','executive:report'])) throw new Error('لا تملك صلاحية إصدار قرار إداري.');
    const targetEmployeeIds = Array.isArray(body.targetEmployeeIds) ? body.targetEmployeeIds.filter(Boolean) : String(body.targetEmployeeIds || '').split(/[،,\s]+/).filter(Boolean);
    const payload = { title: body.title || 'قرار إداري', body: body.body || body.description || '', category: body.category || 'ADMINISTRATIVE', priority: body.priority || 'MEDIUM', scope: body.scope || (targetEmployeeIds.length ? 'SELECTED' : 'ALL'), target_employee_ids: targetEmployeeIds, requires_acknowledgement: body.requiresAcknowledgement !== false && body.requiresAcknowledgement !== 'false', status: body.status || 'PUBLISHED', issued_by_user_id: user?.id || null, issued_by_employee_id: user?.employeeId || null, published_at: now(), created_at: now(), updated_at: now() };
    const { data, error } = await client.from('admin_decisions').insert(payload).select('*').single();
    fail(error, 'تعذر نشر القرار الإداري. تأكد من تطبيق Patch 043.');
    const employees = await supabaseEndpoints.employees().catch(() => []);
    const recipients = payload.scope === 'SELECTED' ? targetEmployeeIds : (employees || []).map((employee) => employee.id);
    if (recipients.length) {
      await safeCreateNotifications(client, recipients.map((employeeId) => ({ employee_id: employeeId, title: 'قرار إداري جديد يحتاج اطلاع', body: payload.title, type: 'ACTION_REQUIRED', route: 'decisions', data: { route: 'decisions', decisionId: data?.id || '' } })));
      await client.functions.invoke('send-push-notifications', { body: { targetEmployeeIds: recipients, title: 'قرار إداري جديد', body: payload.title, type: 'ACTION_REQUIRED' } }).catch(() => null);
    }
    await audit('admin_decision.create', 'admin_decision', data?.id || '', payload).catch(() => null);
    return toCamel(data);
  },
  acknowledgeAdminDecision: async (decisionId) => {
    const client = await sb();
    const user = await currentUser();
    const employeeId = user?.employeeId || user?.employee?.id;
    if (!employeeId) throw new Error('لا يوجد موظف مرتبط بالحساب.');
    const payload = { decision_id: decisionId, employee_id: employeeId, user_id: user?.id || null, acknowledged_at: now(), created_at: now(), user_agent: navigator.userAgent || '' };
    const { data, error } = await client.from('admin_decision_acknowledgements').upsert(payload, { onConflict: 'decision_id,employee_id' }).select('*').single();
    fail(error, 'تعذر تسجيل الاطلاع على القرار.');
    return toCamel(data);
  },
  disputeMinutes: async (caseId = '') => {
    const client = await sb();
    let query = client.from('dispute_minutes').select('*').order('session_at', { ascending: false }).limit(500);
    if (caseId) query = query.eq('case_id', caseId);
    const { data, error } = await query;
    fail(error, 'تعذر قراءة محاضر لجنة حل الخلافات. تأكد من تطبيق Patch 043.');
    return { minutes: toCamel(data || []) };
  },
  saveDisputeMinute: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const caseId = body.caseId || body.disputeId || '';
    const payload = { case_id: caseId, session_at: body.sessionAt || now(), members: Array.isArray(body.members) ? body.members : String(body.members || 'المدير التنفيذي، السكرتير التنفيذي، HR، المدير المباشر').split(/[،,]/).map((x) => x.trim()).filter(Boolean), decision: body.decision || body.committeeDecision || '', notes: body.notes || body.note || '', attachments: Array.isArray(body.attachments) ? body.attachments : [], signed_by_user_id: user?.id || null, signed_by_name: user?.name || user?.fullName || 'النظام', signature_status: 'SIGNED', created_at: now() };
    const { data, error } = await client.from('dispute_minutes').insert(payload).select('*').single();
    fail(error, 'تعذر حفظ محضر لجنة حل الخلافات. تأكد من تطبيق Patch 043.');
    await ignoreSupabaseError(client.from('dispute_cases').update({ committee_decision: payload.decision, resolution: payload.decision, status: body.status || 'COMMITTEE_REVIEW', updated_at: now() }).eq('id', caseId));
    await audit('dispute.minute.save', 'dispute_case', caseId, payload).catch(() => null);
    return { minute: toCamel(data) };
  },
  monthlyAutoPdfReports: async (options = {}) => {
    const month = options.month || now().slice(0, 7);
    const [attendance, evaluations, disputes, requests, employees] = await Promise.all([
      supabaseEndpoints.monthlyReport({ month }).catch(() => ({ rows: [] })),
      supabaseEndpoints.monthlyEvaluations({ month }).catch(() => ({ evaluations: [] })),
      supabaseEndpoints.disputes().catch(() => ({ cases: [] })),
      supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] })),
      supabaseEndpoints.employees().catch(() => []),
    ]);
    const managers = (employees || []).filter((manager) => (employees || []).some((employee) => employee.managerEmployeeId === manager.id)).map((manager) => {
      const teamIds = (employees || []).filter((employee) => employee.managerEmployeeId === manager.id).map((employee) => employee.id);
      return { manager, teamCount: teamIds.length, attendanceRows: (attendance.rows || []).filter((row) => teamIds.includes(row.employeeId)), kpiRows: (evaluations.evaluations || []).filter((row) => teamIds.includes(row.employeeId)), disputes: (disputes.cases || []).filter((row) => teamIds.includes(row.employeeId)), requests: (requests.rows || []).filter((row) => teamIds.includes(row.employeeId)) };
    });
    const run = { month, status: 'READY', generated_at: now(), counts: { employees: (attendance.rows || []).length, managers: managers.length, disputes: (disputes.cases || []).length, requests: (requests.rows || []).length } };
    const client = await sb();
    await ignoreSupabaseError(client.from('monthly_pdf_report_runs').insert(run));
    const runs = await maybeTableRows('monthly_pdf_report_runs', 'generated_at', false).then(toCamel);
    return { month, title: `التقارير الشهرية PDF — ${month}`, generatedAt: now(), status: 'READY', attendance, evaluations: evaluations.evaluations || [], disputes: disputes.cases || [], requests: requests.rows || [], managers, runs };
  },
  controlRoom: async () => {
    const [quality, requests, tasks, dailyReports, alerts] = await Promise.all([
      supabaseEndpoints.qualityCenter().catch(() => ({ readiness: { score: 0, issues: [] } })),
      supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] })),
      supabaseEndpoints.tasks().catch(() => []),
      supabaseDailyReportRows().catch(() => []),
      maybeTableRows("smart_alerts").then(toCamel),
    ]);
    const staleRequests = (requests.rows || []).filter((row) => row.status === "PENDING" && row.createdAt && Date.now() - new Date(row.createdAt).getTime() > 48 * 36e5);
    const openTasks = (tasks || []).filter((task) => !["DONE", "CLOSED", "CANCELLED"].includes(task.status));
    const openAlerts = (alerts || []).filter((alert) => alert.status === "OPEN");
    return { cards: { readiness: quality.readiness?.score || 0, openAlerts: openAlerts.length, highAlerts: openAlerts.filter((a) => ["HIGH", "CRITICAL"].includes(a.severity)).length, staleRequests: staleRequests.length, openTasks: openTasks.length, todayReports: dailyReports.filter((r) => r.reportDate === new Date().toISOString().slice(0,10)).length, pendingReports: dailyReports.filter((r) => r.status === "SUBMITTED").length }, readiness: quality.readiness || {}, alerts: alerts || [], staleRequests, openTasks, dailyReports };
  },
  runSmartAudit: async () => {
    const client = await sb();
    const room = await supabaseEndpoints.controlRoom();
    const generated = [];
    for (const issue of room.readiness?.issues || []) generated.push({ fingerprint: `issue:${issue.area}:${issue.title}:${issue.detail}`, severity: issue.severity || "MEDIUM", title: issue.title, body: issue.detail || "", route: "quality-center", status: "OPEN", updated_at: now(), created_at: now() });
    for (const row of room.staleRequests || []) generated.push({ fingerprint: `sla:${row.kind}:${row.id}`, severity: "HIGH", title: "طلب متأخر عن SLA", body: row.label || row.kindLabel || row.id, route: "requests", status: "OPEN", updated_at: now(), created_at: now() });
    for (const item of generated) await client.from("smart_alerts").upsert(item, { onConflict: "fingerprint" }).catch(() => null);
    await audit("smart_audit.run", "system", "control-room", { generated: generated.length }).catch(() => null);
    return { alerts: generated, snapshot: await supabaseEndpoints.controlRoom() };
  },
  resolveSmartAlert: async (id, body = {}) => {
    const client = await sb();
    const { data, error } = await client.from("smart_alerts").update({ status: body.status || "RESOLVED", resolution_note: body.note || "تمت المعالجة", resolved_at: now() }).eq("id", id).select("*").single();
    fail(error, "تعذر إغلاق التنبيه.");
    await audit("smart_alert.resolve", "smart_alert", id, body).catch(() => null);
    return toCamel(data);
  },
  dataCenter: async () => {
    const [employees, users, attendance, requests, docs, reports, batches, backups] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []), supabaseEndpoints.users().catch(() => []), maybeTableRows("attendance_events"), supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] })), supabaseEndpoints.employeeDocuments().catch(() => []), supabaseDailyReportRows().catch(() => []), maybeTableRows("import_batches").then(toCamel), maybeTableRows("system_backups").then(toCamel),
    ]);
    return { meta: { backend: "supabase" }, counts: { employees: employees.length, users: users.length, attendance: attendance.length, requests: (requests.rows || []).length, documents: docs.length, dailyReports: reports.length }, importBatches: batches || [], backups: backups || [] };
  },
  exportFullBackup: async () => {
    const [employees, users, attendance, documents, dailyReports] = await Promise.all([supabaseEndpoints.employees(), supabaseEndpoints.users(), maybeTableRows("attendance_events").then(toCamel), supabaseEndpoints.employeeDocuments().catch(() => []), supabaseDailyReportRows().catch(() => [])]);
    return { exportedAt: now(), backend: "supabase", employees, users: users.map((u) => ({ ...u, password: "***" })), attendanceEvents: attendance, employeeDocuments: documents, dailyReports };
  },
  validateImportBackup: async (payload = {}) => ({ ok: Boolean(payload && Array.isArray(payload.employees)), issues: Array.isArray(payload.employees) ? [] : ["لا يوجد employees[] داخل الملف"], warnings: [], employees: payload?.employees?.length || 0, users: payload?.users?.length || 0 }),
  importBackup: async () => { throw new Error("استيراد Supabase يتم عبر ملفات SQL/CSV مراجعَة وليس من المتصفح حفاظًا على البيانات. استخدم التصدير ثم ارفعه للأدمن التقني."); },
  dailyReports: async (filters = {}) => supabaseDailyReportRows(filters),
  myDailyReports: async () => { const user = await currentUser(); return supabaseDailyReportRows({ employeeId: user?.employeeId || user?.employee?.id || "" }); },
  createDailyReport: async (body = {}) => {
    const client = await sb();
    const user = await currentUser();
    const employeeId = body.employeeId || user?.employeeId || user?.employee?.id;
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بالحساب.");
    const payload = { employee_id: employeeId, report_date: body.reportDate || new Date().toISOString().slice(0, 10), achievements: body.achievements || body.done || "", blockers: body.blockers || "", tomorrow_plan: body.tomorrowPlan || body.plan || "", support_needed: body.supportNeeded || "", mood: body.mood || "NORMAL", status: body.status || "SUBMITTED", updated_at: now(), created_at: now() };
    const { data, error } = await client.from("daily_reports").upsert(payload, { onConflict: "employee_id,report_date" }).select("*, employee:employees(*)").single();
    fail(error, "تعذر حفظ التقرير اليومي. تأكد من تطبيق Patch 022.");
    await audit("daily_report.create", "daily_report", data.id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  reviewDailyReport: async (id, body = {}) => {
    const client = await sb();
    const payload = { status: body.status || "REVIEWED", manager_comment: body.managerComment || body.comment || "تمت المراجعة", reviewed_at: now() };
    const { data, error } = await client.from("daily_reports").update(payload).eq("id", id).select("*, employee:employees(*)").single();
    fail(error, "تعذر مراجعة التقرير اليومي.");
    await audit("daily_report.review", "daily_report", id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  me: currentUser,
  login: async (identifier, password) => {
    const client = await sb();
    const email = await resolveLoginEmail(identifier);
    const { error } = await client.auth.signInWithPassword({ email, password });
    fail(error, "بيانات الدخول غير صحيحة. تأكد من رقم الهاتف/البريد وكلمة المرور أو استخدم نسيت كلمة السر.");
    const user = await currentUser();
    await audit("auth.login", "profile", user?.id, { identifier: String(identifier || "").trim(), resolvedEmail: email }).catch(() => null);
    return user;
  },
  employeeRegister: async () => {
    throw new Error("التسجيل الذاتي متوقف. تتم إضافة الموظفين من لوحة HR فقط.");
  },
  forgotPassword: async (identifier) => {
    const client = await sb();
    const email = await resolveLoginEmail(identifier);
    const targetHash = location.pathname.includes("/employee/") ? "" : "#settings";
    const redirectTo = `${location.origin}${location.pathname}${targetHash}`;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    fail(error, "تعذر إرسال رابط إعادة تعيين كلمة المرور.");
    await audit("auth.password_reset_requested", "profile", email, { identifier: String(identifier || "").trim(), resolvedEmail: email }).catch(() => null);
    return { sent: true };
  },
  logout: async () => {
    const client = await sb();
    await client.auth.signOut();
    return { ok: true };
  },
  changePassword: async (body = {}) => {
    const client = await sb();
    const user = await currentUser();
    if (!user?.email) throw new Error("لا توجد جلسة نشطة.");
    if (!body.newPassword || String(body.newPassword).length < 8) throw new Error("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.");
    if (body.confirmPassword && body.newPassword !== body.confirmPassword) throw new Error("تأكيد كلمة المرور غير مطابق.");
    const recoveryMode = body.recoveryMode === true || body.recoveryMode === "true";
    if (!recoveryMode) {
      const verify = await client.auth.signInWithPassword({ email: user.email, password: body.currentPassword });
      fail(verify.error, "كلمة المرور الحالية غير صحيحة.");
    }
    const { error } = await client.auth.updateUser({ password: body.newPassword });
    fail(error, "تعذر تغيير كلمة المرور.");
    await client.from("profiles").update({ must_change_password: false, temporary_password: false, password_changed_at: now() }).eq("id", user.id);
    await audit("auth.password_changed", "profile", user.id, { passwordChangedAt: now(), recoveryMode });
    return { changed: true };
  },
  employees: async () => {
    const c = await core();
    const authorizedKeys = await authorizedRosterEmployeeKeySet();
    const data = (await selectAll("employees", "*", { limit: 1000 }))
      .filter((row) => row.is_deleted !== true)
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "ar"));
    const employeesRaw = (data || []).map((row) => enrichEmployee(row, c));
    const linkedNames = new Set(employeesRaw.filter((employee) => employee?.userId).map(employeeNameKey).filter(Boolean));
    const employees = employeesRaw
      .filter((employee) => !authorizedKeys.size || employeeRosterKeys(employee).some((key) => authorizedKeys.has(key)))
      .filter((employee) => !(orphanDemoEmployee(employee) && linkedNames.has(employeeNameKey(employee))));
    const byId = new Map(employees.map((e) => [e.id, e]));
    employees.forEach((e) => { e.manager = byId.get(e.managerEmployeeId) || null; });
    return employees;
  },
  employee: async (id) => employeeById(id),
  bulkEmployeeAction: async (body = {}) => {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) throw new Error("حدد موظفًا واحدًا على الأقل.");
    let updated = 0;
    for (const id of ids) {
      if (body.action === "delete") await supabaseEndpoints.deleteEmployee(id);
      else if (body.action === "status") await supabaseEndpoints.setEmployeeStatus(id, body.status || body.value || "ACTIVE");
      else if (body.action === "assign") await supabaseEndpoints.updateEmployee(id, compact({ departmentId: body.departmentId, managerEmployeeId: body.managerEmployeeId, branchId: body.branchId, roleId: body.roleId, complexId: body.complexId, governorateId: body.governorateId }));
      else if (body.action === "notify") {
        const client = await sb();
        const { data: employee } = await client.from("employees").select("id,user_id").eq("id", id).maybeSingle();
        await safeCreateNotification(client, { user_id: employee?.user_id || null, employee_id: id, title: body.title || "تنبيه من الإدارة", body: body.message || "يرجى مراجعة الإدارة.", type: body.type || "ACTION_REQUIRED" });
      }
      updated += 1;
    }
    return { updated, notified: body.action === "notify" ? updated : 0 };
  },
  createEmployee: async (body = {}) => {
    const client = await sb();
    const payload = toEmployeePayload(body);
    const { data, error } = await client.from("employees").insert(payload).select("*").single();
    fail(error, "تعذر إنشاء الموظف.");
    if (body.createUser) await supabaseEndpoints.createUser({ ...body, employeeId: data.id, email: body.email || data.email });
    await audit("create", "employee", data.id, data);
    return enrichEmployee(data, await core());
  },
  updateEmployee: async (id, body = {}) => {
    const client = await sb();
    const { data, error } = await client.from("employees").update(toEmployeePayload(body)).eq("id", id).select("*").single();
    fail(error, "تعذر تعديل الموظف.");
    await audit("update", "employee", id, data);
    return enrichEmployee(data, await core());
  },
  setEmployeeStatus: async (id, status) => supabaseEndpoints.updateEmployee(id, { status, isActive: !["INACTIVE", "SUSPENDED", "TERMINATED", "DISABLED"].includes(status) }),
  deleteEmployee: async (id) => supabaseEndpoints.updateEmployee(id, { isDeleted: true, status: "INACTIVE" }),
  users: async () => {
    const c = await core();
    const data = (await selectAll("profiles", "*", { limit: 1000 }))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return (data || []).map((row) => enrichProfile(row, c));
  },
  createUser: async (body = {}) => {
    const client = await sb();
    const payload = { ...body };
    if (!payload.password && payload.phone) payload.password = String(payload.phone || "").replace(/\D/g, "");
    const { data, error } = await client.functions.invoke("admin-create-user", { body: payload });
    fail(error || (data?.error ? new Error(data.error) : null), "تعذر إنشاء مستخدم Supabase. تأكد من نشر Edge Function admin-create-user.");
    const created = data?.user || data;
    if (body.avatarUrl && created?.id) {
      await client.from("profiles").update({ avatar_url: body.avatarUrl }).eq("id", created.id).catch(() => null);
      created.avatarUrl = body.avatarUrl;
    }
    return created;
  },
  updateUser: async (id, body = {}) => {
    const client = await sb();
    if (body.email || body.phone || body.password) {
      const { data, error } = await client.functions.invoke("admin-update-user", { body: { ...body, id, userId: id } });
      fail(error || (data?.error ? new Error(data.error) : null), "تعذر تعديل بيانات المستخدم في Supabase Auth. تأكد من نشر Edge Function admin-update-user.");
      if (data?.user) return enrichProfile(data.user, await core({ force: true }));
    }
    const payload = compact({ full_name: body.name || body.fullName, avatar_url: body.avatarUrl || body.photoUrl, employee_id: body.employeeId, role_id: body.roleId, branch_id: body.branchId, department_id: body.departmentId, governorate_id: body.governorateId, complex_id: body.complexId, status: body.status, ...contactPayload(body) });
    const { data, error } = await client.from("profiles").update(payload).eq("id", id).select("*").single();
    fail(error, "تعذر تعديل المستخدم.");
    if (data?.employee_id && (body.email || body.phone)) {
      await client.from("employees").update(contactPayload(body)).eq("id", data.employee_id).catch(() => null);
    }
    await audit("update", "profile", id, data);
    return enrichProfile(data, await core());
  },
  updateMyContact: async (body = {}) => {
    const client = await sb();
    const user = await currentUser();
    if (!user?.id) throw new Error("لا توجد جلسة نشطة.");
    const avatarUrl = body.avatarUrl || body.photoUrl || "";
    const payload = compact({ ...contactPayload(body), avatar_url: avatarUrl || undefined });
    if (!payload.email && !payload.phone && !payload.avatar_url) throw new Error("اكتب بريدًا إلكترونيًا أو رقم هاتف أو اختر صورة للحفظ.");
    if (payload.email && payload.email !== String(user.email || "").toLowerCase()) {
      const { error: authError } = await client.auth.updateUser({ email: payload.email });
      fail(authError, "تعذر طلب تعديل بريد تسجيل الدخول. قد يحتاج البريد الجديد إلى تأكيد.");
    }
    const { data, error } = await client.from("profiles").update(payload).eq("id", user.id).select("*").single();
    fail(error, "تعذر حفظ بيانات الاتصال.");
    if (user.employeeId || user.employee?.id) {
      const employeePayload = compact({ ...contactPayload(body), photo_url: avatarUrl || undefined, avatar_url: avatarUrl || undefined });
      await client.from("employees").update(employeePayload).eq("id", user.employeeId || user.employee.id).catch(() => null);
    }
    await audit("profile.contact_update", "profile", user.id, payload);
    return enrichProfile(data, await core());
  },
  setUserStatus: async (id, status) => supabaseEndpoints.updateUser(id, { status }),
  dashboard: async () => {
    const client = await sb();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const [empCount, todayEventCount, pendingLeaves, pendingMissions, leavesToday, latestEvents, latestAudit] = await Promise.all([
      client.from('employees').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      client.from('attendance_events').select('id', { count: 'exact', head: true }).gte('event_at', `${today}T00:00:00`).lt('event_at', `${tomorrow}T00:00:00`),
      client.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      client.from('missions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      client.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').lte('start_date', today).gte('end_date', today),
      client.from('attendance_events').select('*, employee:employees(*)').order('event_at', { ascending: false }).limit(8),
      client.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    [empCount, todayEventCount, pendingLeaves, pendingMissions, leavesToday, latestEvents, latestAudit].forEach((res) => fail(res.error));
    const events = (latestEvents.data || []).map((row) => { const { employee, ...event } = row; return { ...mapEvent(event), employee: employee ? enrichEmployee(employee) : null }; });
    return {
      cards: { employees: empCount.count || 0, presentToday: todayEventCount.count || 0, pendingRequests: (pendingLeaves.count || 0) + (pendingMissions.count || 0), leavesToday: leavesToday.count || 0 },
      metrics: [
        { label: 'الموظفون', value: empCount.count || 0, helper: 'حسب صلاحياتك' },
        { label: 'بصمات اليوم', value: todayEventCount.count || 0, helper: 'من قاعدة البيانات مباشرة' },
        { label: 'طلبات معلقة', value: (pendingLeaves.count || 0) + (pendingMissions.count || 0), helper: 'إجازات ومأموريات' },
        { label: 'Supabase', value: 'Live', helper: 'Realtime/RLS' },
      ],
      attendanceBreakdown: [
        { type: 'CHECK_IN', label: 'حضور' },
        { type: 'CHECK_OUT', label: 'انصراف' },
        { type: 'LATE', label: 'تأخير' },
        { type: 'REJECTED', label: 'مرفوض' },
      ].map((item) => ({ label: item.label, value: events.filter((e) => e.type === item.type || e.status === item.type).length })),
      attendanceTrends: [
        { type: 'CHECK_IN', label: 'حضور' },
        { type: 'CHECK_OUT', label: 'انصراف' },
        { type: 'LATE', label: 'تأخير' },
        { type: 'REJECTED', label: 'مرفوض' },
      ].map((item) => ({ label: item.label, present: events.filter((e) => e.type === item.type || e.status === item.type).length, late: 0, mission: 0 })),
      latestEvents: events,
      latestAudit: toCamel(latestAudit.data || []),
    };
  },
  health: async () => {
    const client = await sb();
    const start = performance.now();
    const [roles, employees, profiles, auditLogs] = await Promise.all([
      client.from("roles").select("id", { count: "exact", head: true }),
      client.from("employees").select("id", { count: "exact", head: true }).eq("is_deleted", false),
      client.from("profiles").select("id", { count: "exact", head: true }),
      client.from("audit_logs").select("id", { count: "exact", head: true }),
    ]);
    const errors = [roles.error, employees.error, profiles.error, auditLogs.error].filter(Boolean);
    const latencyMs = Math.round(performance.now() - start);
    return {
      mode: "Supabase",
      database: errors.length ? "ERROR" : "OK",
      latencyMs,
      realtime: CONFIG().realtime?.enabled ? "ENABLED" : "DISABLED",
      storage: "Supabase Storage",
      generatedAt: now(),
      counts: {
        employees: employees.count || 0,
        users: profiles.count || 0,
        roles: roles.count || 0,
        auditLogs: auditLogs.count || 0,
      },
      checks: [
        { label: "اتصال قاعدة البيانات", ok: !errors.length, detail: errors[0]?.message || `${latencyMs}ms` },
        { label: "الأدوار والصلاحيات", ok: (roles.count || 0) > 0, detail: `${roles.count || 0} دور` },
        { label: "ملفات الموظفين", ok: (employees.count || 0) >= 0, detail: `${employees.count || 0} موظف` },
        { label: "Realtime", ok: CONFIG().realtime?.enabled !== false, detail: CONFIG().realtime?.enabled ? "مفعل" : "غير مفعل" },
        { label: "المرفقات الخاصة", ok: true, detail: "تستخدم Signed URLs مؤقتة" },
      ],
    };
  },
  systemDiagnostics: async () => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const [users, employees, health, address] = await Promise.all([
      supabaseEndpoints.users().catch(() => []),
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.health().catch((error) => ({ database: "ERROR", error: error.message })),
      supabaseEndpoints.attendanceAddress().catch(() => ({})),
    ]);
    let bucketDetail = "لم يتم الفحص من المتصفح";
    let bucketOk = false;
    try {
      const required = [CONFIG().storage?.avatarsBucket || "avatars", CONFIG().storage?.punchSelfiesBucket || "punch-selfies", CONFIG().storage?.attachmentsBucket || "employee-attachments"];
      const { data, error } = await client.storage.listBuckets();
      if (error) throw error;
      const existing = new Set((data || []).map((bucket) => bucket.id || bucket.name));
      const missing = required.filter((bucket) => !existing.has(bucket));
      bucketOk = missing.length === 0;
      bucketDetail = missing.length ? "ناقص: " + missing.join(" / ") : required.join(" / ");
    } catch (error) {
      bucketDetail = error.message || "تعذر فحص Storage من المتصفح";
    }
    const usersByEmployee = new Set((users || []).map((item) => item.employeeId).filter(Boolean));
    const linkedUsers = (users || []).filter((item) => item.employeeId);
    const employeesWithoutUsers = (employees || []).filter((employee) => !usersByEmployee.has(employee.id)).length;
    return {
      backend: "Supabase",
      generatedAt: now(),
      checks: [
        { label: "Supabase Auth", ok: Boolean(user), status: user ? "APPROVED" : "REJECTED", detail: user?.email || "لا توجد جلسة" },
        { label: "قاعدة البيانات", ok: health.database !== "ERROR", status: health.database === "ERROR" ? "REJECTED" : "APPROVED", detail: health.database || health.mode || "Supabase" },
        { label: "ربط المستخدمين بالموظفين", ok: linkedUsers.length === users.length, status: linkedUsers.length === users.length ? "linked" : "unlinked", detail: String(linkedUsers.length) + "/" + String(users.length) },
        { label: "موظفون بلا حساب دخول", ok: employeesWithoutUsers === 0, status: "INFO", detail: String(employeesWithoutUsers) + " ملف" },
        { label: "إحداثيات المجمع", ok: Boolean(address.latitude && address.longitude), status: address.latitude && address.longitude ? "APPROVED" : "REJECTED", detail: String(address.latitude || "-") + ", " + String(address.longitude || "-") },
        { label: "Storage Buckets", ok: bucketOk, status: bucketOk ? "storage_ok" : "storage_missing", detail: bucketDetail },
        { label: "RLS", ok: true, status: "INFO", detail: "مفعّل من SQL Policies — راجع Supabase Advisor للإنتاج" },
      ],
    };
  },
  autoLinkUsersByEmail: async () => {
    const client = await sb();
    const [users, employees] = await Promise.all([supabaseEndpoints.users(), supabaseEndpoints.employees()]);
    let linked = 0;
    for (const profile of users || []) {
      const employee = (employees || []).find((item) => String(item.email || "").toLowerCase() === String(profile.email || "").toLowerCase());
      if (!employee) continue;
      const updates = { employee_id: employee.id, full_name: profile.fullName || employee.fullName, role_id: profile.roleId || employee.roleId, branch_id: profile.branchId || employee.branchId, department_id: profile.departmentId || employee.departmentId, governorate_id: profile.governorateId || employee.governorateId, complex_id: profile.complexId || employee.complexId, status: "ACTIVE" };
      const { error } = await client.from("profiles").update(updates).eq("id", profile.id);
      if (error) throw error;
      await client.from("employees").update({ user_id: profile.id }).eq("id", employee.id).catch(() => null);
      linked += 1;
    }
    return { linked };
  },
  updateComplexSettings: async (body = {}) => {
    const client = await sb();
    const branchPayload = { name: body.name || DEFAULT_COMPLEX.name, address: body.address || DEFAULT_COMPLEX.address, latitude: Number(body.latitude || DEFAULT_COMPLEX.latitude), longitude: Number(body.longitude || DEFAULT_COMPLEX.longitude), geofence_radius_meters: Number(body.radiusMeters || DEFAULT_COMPLEX.radiusMeters), max_accuracy_meters: Number(body.maxAccuracyMeters || DEFAULT_COMPLEX.maxAccuracyMeters), active: true, is_deleted: false };
    const complexPayload = { name: body.name || DEFAULT_COMPLEX.name, active: true, is_deleted: false };
    const { data: branches, error: brRead } = await client.from("branches").select("id").eq("is_deleted", false).limit(1);
    if (brRead) throw brRead;
    if (branches?.[0]?.id) await client.from("branches").update(branchPayload).eq("id", branches[0].id).throwOnError();
    else await client.from("branches").insert({ ...branchPayload, code: "AHLA-MANIL" }).throwOnError();
    const { data: complexes, error: cxRead } = await client.from("complexes").select("id").limit(1);
    if (cxRead) throw cxRead;
    if (complexes?.[0]?.id) await client.from("complexes").update(complexPayload).eq("id", complexes[0].id).throwOnError();
    else await client.from("complexes").insert({ ...complexPayload, code: "CX-AHLA-MANIL" }).throwOnError();
    _coreCache = null;
    return { ok: true };
  },
  recordPunchRejection: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const employee = body.employeeId ? await employeeById(body.employeeId).catch(() => null) : await myEmployee().catch(() => null);
    if (!employee?.id) return { skipped: true, reason: "لا يوجد موظف مرتبط" };
    const payload = {
      employee_id: employee.id,
      user_id: user?.id || null,
      type: body.action === "checkOut" ? "CHECK_OUT" : "CHECK_IN",
      status: "REJECTED",
      event_at: now(),
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      accuracy_meters: body.accuracyMeters ?? body.accuracy ?? null,
      geofence_status: body.geofenceStatus || "REJECTED",
      distance_from_branch_meters: body.distanceFromBranchMeters ?? null,
      branch_id: employee.branchId || null,
      verification_status: "failed",
      biometric_method: "passkey",
      selfie_url: "",
      notes: body.blockReason || body.notes || "محاولة بصمة مرفوضة",
      late_minutes: 0,
      requires_review: true,
    };
    const { data, error } = await client.from("attendance_events").insert(payload).select("*").single();
    if (error) throw error;
    return { ...mapEvent(data), employee };
  },
  attendanceEvents: async (params = {}) => {
    const client = await sb();
    const maxRows = Math.max(Number(params.limit || 20000), 1);
    const pageSize = Math.min(maxRows, 1000);
    const rows = [];
    for (let from = 0; from < maxRows; from += pageSize) {
      let query = client.from("attendance_events").select("*, employee:employees(*)").order("event_at", { ascending: false });
      if (params.from) query = query.gte("event_at", `${params.from}T00:00:00`);
      if (params.to) query = query.lte("event_at", `${params.to}T23:59:59`);
      if (params.employeeId) query = query.eq("employee_id", params.employeeId);
      if (params.type) query = query.eq("type", params.type);
      if (params.review === "review") query = query.eq("requires_review", true);
      if (params.review === "approved") query = query.eq("requires_review", false);
      const to = Math.min(from + pageSize - 1, maxRows - 1);
      const { data, error } = await query.range(from, to);
      fail(error);
      rows.push(...(data || []));
      if ((data || []).length < (to - from + 1)) break;
    }
    if (rows.length >= maxRows) debugWarn("[attendance_events] تم الوصول للحد الأقصى، استخدم فلترة التاريخ لتخفيف الحمل.");
    return rows.map((row) => { const { employee, ...event } = row; return { ...mapEvent(event), employee: employee ? enrichEmployee(employee) : null }; });
  },
  attendanceDaily: async (params = {}) => {
    const rows = await tableRows("attendance_daily", "date", false, { fromDate: params.from, toDate: params.to, dateColumn: "date", limit: params.limit || 1000, maxRows: params.maxRows || 20000 });
    const employees = await supabaseEndpoints.employees();
    const byId = new Map(employees.map((e) => [e.id, e]));
    return rows
      .filter((row) => !params.employeeId || row.employee_id === params.employeeId)
      .map((row) => ({ ...toCamel(row), employee: byId.get(row.employee_id) || null }));
  },
  attendanceAddress: async () => attendanceAddress(),
  myAttendanceEvents: async () => {
    const emp = await myEmployee();
    const events = await supabaseEndpoints.attendanceEvents();
    return events.filter((e) => e.employeeId === emp.id);
  },
  evaluateGeofence: async (body = {}) => evaluateGeo(await attendanceAddress(body.employeeId ? await employeeById(body.employeeId) : null), body),
  checkIn: (body = {}) => recordPunch("CHECK_IN", body, body.employeeId),
  checkOut: (body = {}) => recordPunch("CHECK_OUT", body, body.employeeId),
  selfCheckIn: (body = {}) => recordPunch("CHECK_IN", body),
  selfCheckOut: (body = {}) => recordPunch("CHECK_OUT", body),
  recordAttendance: (body = {}) => {
    const action = String(body.eventType || body.type || body.action || "").toLowerCase();
    const out = ["out", "checkout", "check_out", "انصراف"].includes(action);
    return recordPunch(out ? "CHECK_OUT" : "CHECK_IN", body, body.employeeId);
  },
  regenerateAttendance: async () => ({ generated: 0, message: "في Supabase يتم تحديث اليومية عند كل بصمة، ويمكن إضافة Cron لاحقًا." }),
  manualAttendance: async (body = {}) => recordManualPunch(body.type || "CHECK_IN", body, body.employeeId),
  adjustAttendance: async (body = {}) => createOrUpdate("attendance_exceptions", body),
  missions: async () => {
    const rows = await tableRows("missions", "created_at", false);
    const employees = await supabaseEndpoints.employees();
    const byId = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({ ...toCamel(r), employee: byId.get(r.employee_id) || null }));
  },
  createMission: async (body = {}) => {
    const employeeId = body.employeeId || await selfEmployeeId();
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بهذا الحساب لإرسال طلب المأمورية.");
    const row = await createOrUpdate("missions", missionPayload(body, employeeId));
    await supabaseEndpoints.createAnnouncement?.({ audience: "managers", title: "مأمورية جديدة تحتاج اعتماد", body: body.title || "مأمورية" }).catch(() => null);
    return row;
  },
  updateMission: async (id, action, extra = {}) => createOrUpdate("missions", { ...extra, status: action === "reject" ? "REJECTED" : action === "manager_approve" ? "PENDING_HR_REVIEW" : action === "complete" ? "COMPLETED" : "APPROVED", workflow_status: action === "manager_approve" ? "pending_hr_review" : action }, id),
  submitMissionRequest: async (body = {}) => supabaseEndpoints.createMission(body),
  leaves: async () => {
    const rows = await tableRows("leave_requests", "created_at", false);
    const employees = await supabaseEndpoints.employees();
    const byId = new Map(employees.map((e) => [e.id, e]));
    return rows.map((r) => ({ ...toCamel(r), employee: byId.get(r.employee_id) || null }));
  },
  createLeave: async (body = {}) => {
    const employeeId = body.employeeId || await selfEmployeeId();
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بهذا الحساب لإرسال طلب الإجازة.");
    if (!body.startDate || !body.endDate) throw new Error("حدد تاريخ بداية ونهاية الإجازة.");
    if (String(body.endDate) < String(body.startDate)) throw new Error("تاريخ نهاية الإجازة يجب أن يكون بعد تاريخ البداية.");
    return createOrUpdate("leave_requests", leavePayload(body, employeeId));
  },
  updateLeave: async (id, action, extra = {}) => createOrUpdate("leave_requests", { ...extra, status: action === "reject" ? "REJECTED" : action === "manager_approve" ? "PENDING_HR_REVIEW" : "APPROVED", workflow_status: action === "manager_approve" ? "pending_hr_review" : action }, id),
  submitLeaveRequest: async (body = {}) => supabaseEndpoints.createLeave(body),
  exceptions: async () => tableRows("attendance_exceptions", "created_at", false).then(toCamel),
  updateException: async (id, action) => createOrUpdate("attendance_exceptions", { status: action === "reject" ? "REJECTED" : "APPROVED" }, id),
  notifications: async () => tableRows("notifications", "created_at", false).then(toCamel),
  notificationMonitor: async () => {
    const [notifications, employees, pushRows, liveRequests, liveResponses] = await Promise.all([
      tableRows("notifications", "created_at", false, { limit: 1000, maxRows: 5000 }).then(toCamel).catch(() => []),
      supabaseEndpoints.employees().catch(() => []),
      maybeTableRows("push_subscriptions", "created_at", false).then(toCamel).catch(() => []),
      maybeTableRows("live_location_requests", "created_at", false).then(toCamel).catch(() => []),
      maybeTableRows("live_location_responses", "responded_at", false).then(toCamel).catch(() => []),
    ]);
    const byEmployee = new Map((employees || []).map((employee) => [employee.id, employee]));
    const activePush = (pushRows || []).filter((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
    const pushByEmployee = new Map();
    for (const row of pushRows || []) {
      const key = row.employeeId || row.userId || "";
      if (!key) continue;
      if (!pushByEmployee.has(key)) pushByEmployee.set(key, []);
      pushByEmployee.get(key).push(row);
    }
    const missingPush = (employees || []).filter((employee) => {
      const rows = [...(pushByEmployee.get(employee.id) || []), ...(employee.userId ? (pushByEmployee.get(employee.userId) || []) : [])];
      return !rows.some((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
    });
    const unread = (notifications || []).filter((item) => !item.isRead && String(item.status || "").toUpperCase() !== "READ");
    const actionRequired = (notifications || []).filter((item) => [item.type, item.status, item.priority].some((value) => /ACTION|LIVE_LOCATION|WARNING|HIGH/i.test(String(value || ""))));
    const livePending = (liveRequests || []).filter((row) => String(row.status || "").toUpperCase() === "PENDING");
    const responseByRequest = new Map((liveResponses || []).map((row) => [row.requestId, row]));
    const locationFlow = (liveRequests || []).slice(0, 100).map((request) => ({
      ...request,
      employee: byEmployee.get(request.employeeId) || null,
      response: responseByRequest.get(request.id) || null,
    }));
    return {
      metrics: {
        notifications: (notifications || []).length,
        unread: unread.length,
        actionRequired: actionRequired.length,
        pushSubscriptions: pushRows.length,
        activePush: activePush.length,
        missingPush: missingPush.length,
        livePending: livePending.length,
      },
      notifications: (notifications || []).map((item) => ({ ...item, employee: byEmployee.get(item.employeeId) || item.employee || null })),
      unread,
      actionRequired,
      pushSubscriptions: pushRows,
      employees,
      missingPush,
      locationFlow,
      generatedAt: now(),
    };
  },
  locationMonitor: async () => {
    const [employees, executive, classicRequests, liveRequests, liveResponses, employeeLocations] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.executiveMobile().catch(() => ({ employees: [], counts: {} })),
      maybeTableRows("location_requests", "created_at", false).then(toCamel).catch(() => []),
      maybeTableRows("live_location_requests", "created_at", false).then(toCamel).catch(() => []),
      maybeTableRows("live_location_responses", "responded_at", false).then(toCamel).catch(() => []),
      maybeTableRows("employee_locations", "created_at", false).then(toCamel).catch(() => []),
    ]);
    const employeeRows = executive.employees?.length ? executive.employees : employees.map((employee) => ({ ...employee, today: {} }));
    const byEmployee = new Map(employeeRows.map((employee) => [employee.id, employee]));
    const latestLocationFor = (employeeId) => {
      const fromExecutive = byEmployee.get(employeeId)?.today?.latestLocation || null;
      const fromStored = [...(employeeLocations || []).filter((row) => row.employeeId === employeeId)].sort((a,b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0))[0] || null;
      const fromResponse = [...(liveResponses || []).filter((row) => row.employeeId === employeeId && row.latitude && row.longitude)].sort((a,b) => new Date(b.capturedAt || b.respondedAt || 0) - new Date(a.capturedAt || a.respondedAt || 0))[0] || null;
      return fromExecutive || fromStored || fromResponse || null;
    };
    const pendingFor = (employeeId) => [...(liveRequests || []).filter((row) => row.employeeId === employeeId && String(row.status || "").toUpperCase() === "PENDING")].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
    const rows = employeeRows.map((employee) => {
      const latestLocation = latestLocationFor(employee.id);
      const pendingLiveRequest = employee.today?.pendingLiveRequest || pendingFor(employee.id);
      const accuracy = Number(latestLocation?.accuracyMeters || latestLocation?.accuracy || 0);
      const locationAt = latestLocation?.capturedAt || latestLocation?.respondedAt || latestLocation?.createdAt || latestLocation?.date || "";
      const ageMinutes = locationAt ? Math.round((Date.now() - new Date(locationAt).getTime()) / 60000) : null;
      return {
        employee,
        employeeId: employee.id,
        today: employee.today || {},
        latestLocation,
        pendingLiveRequest,
        classicRequests: (classicRequests || []).filter((row) => row.employeeId === employee.id),
        liveRequests: (liveRequests || []).filter((row) => row.employeeId === employee.id),
        liveResponses: (liveResponses || []).filter((row) => row.employeeId === employee.id),
        accuracyMeters: accuracy || null,
        ageMinutes,
        quality: !latestLocation ? "NO_GPS" : accuracy > 300 ? "LOW_ACCURACY" : ageMinutes != null && ageMinutes > 120 ? "STALE_GPS" : "GOOD",
      };
    });
    const counts = rows.reduce((acc, row) => {
      acc.total += 1;
      if (row.pendingLiveRequest) acc.pending += 1;
      if (!row.latestLocation) acc.noGps += 1;
      if (row.quality === "LOW_ACCURACY") acc.lowAccuracy += 1;
      if (row.quality === "STALE_GPS") acc.stale += 1;
      if (row.quality === "GOOD") acc.good += 1;
      return acc;
    }, { total: 0, pending: 0, noGps: 0, lowAccuracy: 0, stale: 0, good: 0 });
    return { counts, rows, liveRequests, liveResponses, classicRequests, employeeLocations, generatedAt: now() };
  },
  deviceCenter: async () => {
    const [employees, passkeys, pushRows, approvals] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.trustedDevices().catch(() => []),
      maybeTableRows("push_subscriptions", "created_at", false).then(toCamel).catch(() => []),
      maybeTableRows("trusted_device_approval_requests", "created_at", false).then(toCamel).catch(() => []),
    ]);
    const byEmployee = new Map((employees || []).map((employee) => [employee.id, employee]));
    const rows = (employees || []).map((employee) => {
      const employeePasskeys = (passkeys || []).filter((row) => row.employeeId === employee.id || row.userId === employee.userId);
      const employeePush = (pushRows || []).filter((row) => row.employeeId === employee.id || row.userId === employee.userId);
      const pendingApprovals = (approvals || []).filter((row) => row.employeeId === employee.id && String(row.status || "").toUpperCase() === "PENDING");
      const activePush = employeePush.filter((row) => row.isActive !== false && !["EXPIRED", "DISABLED", "FAILED"].includes(String(row.status || "").toUpperCase()));
      return { employee, passkeys: employeePasskeys, pushSubscriptions: employeePush, pendingApprovals, activePush, deviceStatus: pendingApprovals.length ? "PENDING_APPROVAL" : activePush.length ? "PUSH_ACTIVE" : employeePasskeys.length ? "PASSKEY_ONLY" : "NO_DEVICE" };
    });
    const counts = rows.reduce((acc, row) => { acc.total++; acc[row.deviceStatus] = (acc[row.deviceStatus] || 0) + 1; return acc; }, { total: 0, PUSH_ACTIVE: 0, PASSKEY_ONLY: 0, PENDING_APPROVAL: 0, NO_DEVICE: 0 });
    return { counts, rows, passkeys, pushSubscriptions: pushRows, approvals: (approvals || []).map((row) => ({ ...row, employee: byEmployee.get(row.employeeId) || null })), generatedAt: now() };
  },
  employeeDataQuality: async () => {
    const [employees, users, roles, attendance, requests, pushRows] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.users().catch(() => []),
      supabaseEndpoints.roles().catch(() => []),
      supabaseEndpoints.attendanceEvents({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10), to: now().slice(0,10), limit: 20000 }).catch(() => []),
      supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] })),
      maybeTableRows("push_subscriptions", "created_at", false).then(toCamel).catch(() => []),
    ]);
    const usersByEmployee = new Set((users || []).map((user) => user.employeeId).filter(Boolean));
    const roleIds = new Set((roles || []).map((role) => role.id));
    const pushEmployees = new Set((pushRows || []).filter((row) => row.isActive !== false).map((row) => row.employeeId).filter(Boolean));
    const attendanceByEmployee = new Map();
    for (const event of attendance || []) if (!attendanceByEmployee.has(event.employeeId) || new Date(event.eventAt || event.createdAt || 0) > new Date(attendanceByEmployee.get(event.employeeId).eventAt || attendanceByEmployee.get(event.employeeId).createdAt || 0)) attendanceByEmployee.set(event.employeeId, event);
    const issues = [];
    const rows = (employees || []).map((employee) => {
      const employeeIssues = [];
      if (!employee.phone) employeeIssues.push({ severity: "HIGH", title: "رقم الهاتف مفقود" });
      if (!employee.managerEmployeeId && String(employee.role?.slug || "employee") === "employee") employeeIssues.push({ severity: "MEDIUM", title: "لا يوجد مدير مباشر" });
      if (!employee.photoUrl && !employee.avatarUrl) employeeIssues.push({ severity: "LOW", title: "الصورة الشخصية غير مضافة" });
      if (!employee.userId && !usersByEmployee.has(employee.id)) employeeIssues.push({ severity: "HIGH", title: "لا يوجد حساب دخول مرتبط" });
      if (employee.roleId && !roleIds.has(employee.roleId)) employeeIssues.push({ severity: "HIGH", title: "الدور غير موجود في جدول الأدوار" });
      if (!pushEmployees.has(employee.id)) employeeIssues.push({ severity: "MEDIUM", title: "لا يوجد Push نشط" });
      const pendingItems = (requests.rows || []).filter((row) => row.employeeId === employee.id && ["PENDING", "OPEN", "IN_REVIEW"].includes(String(row.status || "").toUpperCase()));
      if (pendingItems.length > 3) employeeIssues.push({ severity: "MEDIUM", title: `طلبات معلقة كثيرة (${pendingItems.length})` });
      const lastEvent = attendanceByEmployee.get(employee.id) || null;
      const row = { employee, issues: employeeIssues, issueCount: employeeIssues.length, highCount: employeeIssues.filter((x) => x.severity === "HIGH").length, lastAttendanceAt: lastEvent?.eventAt || lastEvent?.createdAt || "", pendingItems: pendingItems.length };
      for (const issue of employeeIssues) issues.push({ ...issue, employeeId: employee.id, employee });
      return row;
    });
    const score = Math.max(0, Math.round(100 - (issues.filter((i)=>i.severity==='HIGH').length * 7) - (issues.filter((i)=>i.severity==='MEDIUM').length * 3) - (issues.filter((i)=>i.severity==='LOW').length)));
    return { score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد" : "يحتاج ضبط", rows, issues, counts: { employees: employees.length, issues: issues.length, high: issues.filter((i)=>i.severity==='HIGH').length, medium: issues.filter((i)=>i.severity==='MEDIUM').length, low: issues.filter((i)=>i.severity==='LOW').length }, generatedAt: now() };
  },
  executiveDailyReport: async () => {
    const [mobile, requests, notifications, quality] = await Promise.all([
      supabaseEndpoints.executiveMobile().catch(() => ({ counts: {}, employees: [] })),
      supabaseEndpoints.requestCenter({}).catch(() => ({ summary: {}, rows: [] })),
      supabaseEndpoints.notificationMonitor().catch(() => ({ metrics: {}, actionRequired: [] })),
      supabaseEndpoints.employeeDataQuality().catch(() => ({ counts: {}, issues: [] })),
    ]);
    const employees = mobile.employees || [];
    const critical = [
      ...employees.filter((e) => e.today?.pendingLiveRequest).map((e) => ({ type: "LOCATION_PENDING", employee: e, title: "طلب موقع بانتظار الرد", route: `executive-mobile?employeeId=${e.id}` })),
      ...employees.filter((e) => !e.today?.latestLocation?.latitude && ["PRESENT", "LATE"].includes(e.today?.status)).map((e) => ({ type: "GPS_MISSING", employee: e, title: "حاضر بدون GPS حديث", route: `executive-mobile?employeeId=${e.id}` })),
      ...(quality.issues || []).filter((i) => i.severity === "HIGH").slice(0, 20).map((i) => ({ type: "DATA_QUALITY", employee: i.employee, title: i.title, route: `employee-archive?id=${i.employeeId}` })),
    ];
    return { day: now().slice(0,10), counts: mobile.counts || {}, requestSummary: requests.summary || {}, notificationMetrics: notifications.metrics || {}, quality: quality.counts || {}, critical, employees, generatedAt: now() };
  },
  permissionOverview: async () => {
    const [roles, permissions, employees, users] = await Promise.all([
      supabaseEndpoints.roles().catch(() => []),
      supabaseEndpoints.permissions().catch(() => []),
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.users().catch(() => []),
    ]);
    const rows = (roles || []).map((role) => {
      const rolePerms = rolePermissions(role);
      const employeeCount = (employees || []).filter((employee) => employee.roleId === role.id || employee.role?.id === role.id || employee.role?.slug === role.slug).length;
      const userCount = (users || []).filter((user) => user.roleId === role.id || user.role?.id === role.id || user.role?.slug === role.slug).length;
      const risk = rolePerms.includes("*") ? "FULL_ACCESS" : rolePerms.some((scope) => /users:manage|settings:manage|sensitive-actions:approve/i.test(scope)) ? "SENSITIVE" : "NORMAL";
      return { ...role, permissions: rolePerms, employeeCount, userCount, risk };
    });
    return { roles: rows, permissions, employees, users, generatedAt: now() };
  },
  createAnnouncement: async (body = {}) => {
    const client = await sb();
    const employees = await supabaseEndpoints.employees();
    const audience = body.audience || "all";
    const target = employees.filter((employee) => audience === "all" || audience === "managers" ? (audience === "all" || ["manager", "direct-manager", "hr-manager", "executive", "executive-secretary", "admin"].includes(employee.role?.slug)) : (employee.departmentId === audience || employee.branchId === audience));
    if (!target.length) return { created: 0, pushed: 0 };
    const rows = target.map((employee) => ({ user_id: employee.userId || null, employee_id: employee.id, title: body.title || "إعلان إداري", body: body.body || body.message || "", type: body.type || "ANNOUNCEMENT", status: "UNREAD", is_read: false, created_at: now() }));
    const noteResult = await safeCreateNotifications(client, rows, { block: true, message: "تعذر إرسال الإعلان." });
    if (!noteResult.created) throw new Error("لم يتم إنشاء أي إشعار داخلي للإعلان.");
    await createOrUpdate("employee_announcements", {
      title: body.title || "إعلان إداري",
      body: body.body || body.message || "",
      targetScope: audience === "all" ? "ALL" : audience === "managers" ? "MANAGERS" : "FILTER",
      targetValue: audience === "all" ? "" : audience,
    }).catch(() => null);
    let pushed = 0;
    await client.functions.invoke("send-push-notifications", { body: { title: body.title || "إعلان إداري", body: body.body || body.message || "", tag: "announcement", targetEmployeeIds: target.map((employee) => employee.id) } })
      .then(({ data, error }) => { if (!error) pushed = Number(data?.attempted || 0); })
      .catch(() => null);
    return { created: rows.length, pushed };
  },
  markNotificationRead: async (id) => createOrUpdate("notifications", { status: "READ", is_read: true, read_at: now() }, id),
  reports: async () => {
    const schedules = await selectAll("report_schedules", "*", { limit: 100 }).then(toCamel).catch(() => []);
    return { jobs: [], schedules, templates: [
      { key: "attendance", name: "الحضور والانصراف" },
      { key: "employees", name: "بيانات الموظفين" },
      { key: "requests", name: "الطلبات والموافقات" },
      { key: "kpi", name: "تقييمات الأداء" },
      { key: "security", name: "الأمان ومحاولات الدخول" },
    ] };
  },
  exportReportData: async (body = {}) => {
    const key = body.reportKey || "attendance";
    if (key === "employees") {
      const employees = await supabaseEndpoints.employees();
      return { title: "تقرير الموظفين", headers: ["الاسم", "الهاتف", "البريد", "المسمى", "القسم", "الحالة"], rows: employees.map((e) => [e.fullName, e.phone, e.email, e.jobTitle, e.department?.name || "", e.status || ""]) };
    }
    if (key === "requests") {
      const payload = await supabaseEndpoints.requestCenter({});
      return { title: "تقرير الطلبات", headers: ["النوع", "العنوان", "الموظف", "الحالة", "آخر تحديث"], rows: payload.rows.map((item) => [item.kindLabel, item.label, item.employee?.fullName || "", item.status || "", item.workflow?.at?.(-1)?.at || item.createdSort || ""]) };
    }
    if (key === "kpi") {
      const rows = await tableRows("kpi_evaluations", "created_at", false).then(toCamel).catch(() => []);
      return { title: "تقرير تقييم الأداء", headers: ["الموظف", "الإجمالي", "الحالة"], rows: rows.map((item) => [item.employeeId || "", item.totalScore || "", item.status || ""]) };
    }
    if (key === "security") {
      const rows = await supabaseEndpoints.auditLogs({ limit: 500 }).catch(() => []);
      return { title: "تقرير الأمان", headers: ["العملية", "المستخدم", "الكيان", "الوقت"], rows: rows.map((log) => [log.action, log.actor || "", log.entityType || "", log.createdAt || ""]) };
    }
    const events = await supabaseEndpoints.attendanceEvents({ limit: 1000 }).catch(() => []);
    return { title: "تقرير الحضور والانصراف", headers: ["الموظف", "النوع", "الحالة", "الوقت", "المصدر", "ملاحظات"], rows: events.map((event) => [event.employee?.fullName || event.employeeId, event.type || "", event.status || event.geofenceStatus || "", event.eventAt || event.createdAt || "", event.source || "", event.notes || event.blockReason || ""]) };
  },
  saveReportSchedule: async (body = {}) => createOrUpdate("report_schedules", body).catch(() => ({ ...body, id: `client-${Date.now()}`, clientOnly: true })),
  createReport: async () => ({ ok: true }),
  settings: async () => ({ orgName: "جمعية خواطر أحلى شباب الخيرية", backend: "Supabase" }),
  updateSettings: async (body) => body,
  kpi: async () => {
    const [employees, evaluations] = await Promise.all([supabaseEndpoints.employees(), tableRows("kpi_evaluations", "created_at", false).then(toCamel)]);
    const user = await currentUser();
    const rolePerms = new Set(user?.permissions || []);
    const accessMode = rolePerms.has("*") || rolePerms.has("kpi:manage") ? "all" : rolePerms.has("kpi:hr") ? "hr" : rolePerms.has("kpi:team") ? "team" : (rolePerms.has("kpi:executive") || rolePerms.has("kpi:final-approve")) ? "executive" : "self";
    const currentEmployeeId = user?.employeeId || "";
    const visible = accessMode === "self" ? evaluations.filter((e) => e.employeeId === currentEmployeeId) : accessMode === "team" ? evaluations.filter((e) => employees.find((emp) => emp.id === e.employeeId)?.managerEmployeeId === currentEmployeeId) : evaluations;
    const nowDate = new Date();
    const startsAt = new Date(nowDate.getFullYear(), nowDate.getMonth(), 20, 0, 0, 0);
    const deadlineAt = new Date(nowDate.getFullYear(), nowDate.getMonth(), 25, 23, 59, 59);
    const hardCloseAt = new Date(nowDate.getFullYear(), nowDate.getMonth(), 28, 23, 59, 59);
    const windowInfo = { startDay: 20, endDay: 25, deadlineDay: 25, isOpen: nowDate >= startsAt && nowDate <= deadlineAt, isBefore: nowDate < startsAt, isLate: nowDate > deadlineAt && nowDate <= hardCloseAt, isClosed: nowDate > hardCloseAt, label: nowDate >= startsAt && nowDate <= deadlineAt ? "مفتوحة الآن" : nowDate > deadlineAt && nowDate <= hardCloseAt ? "مراجعة متأخرة" : nowDate > hardCloseAt ? "مغلقة" : "لم تبدأ", message: "تقييم الموظف والمدير من يوم 20 إلى 25، ثم HR والسكرتير والتنفيذي للمراجعة والإغلاق." };
    const policy = { evaluationStartDay: 20, evaluationEndDay: 25, submissionDeadlineDay: 25, meetingRequired: true, description: "تقييم شهري من يوم 20 إلى 25، وآخر موعد للتسليم يوم 25. بنود الحضور والانصراف والصلاة في المسجد وحضور حلقة الشيخ وليد يوسف الأسبوعية من تقييم HR فقط." };
    const criteria = [
      { code: "TARGET", name: "تحقيق الأهداف", maxScore: 40, parentCode: "MANAGER_EMPLOYEE" },
      { code: "TASK_EFFICIENCY", name: "الكفاءة في أداء المهام", maxScore: 20, parentCode: "MANAGER_EMPLOYEE" },
      { code: "ATTENDANCE_COMMITMENT", name: "الالتزام بمواعيد العمل حضورًا وانصرافًا", maxScore: 20, parentCode: "HR_ONLY" },
      { code: "CONDUCT", name: "حسن التعامل والسلوك مع الزملاء والمديرين", maxScore: 5, parentCode: "MANAGER_EMPLOYEE" },
      { code: "MOSQUE_PRAYER", name: "الالتزام بالصلاة في المسجد", maxScore: 5, parentCode: "HR_ONLY" },
      { code: "QURAN_CIRCLE", name: "حضور حلقة الشيخ وليد يوسف الأسبوعية", maxScore: 5, parentCode: "HR_ONLY" },
      { code: "INITIATIVES_DONATIONS", name: "المشاركة في التبرعات والمبادرات", maxScore: 5, parentCode: "MANAGER_EMPLOYEE" },
    ];
    const pendingEmployees = employees.filter((emp) => !visible.some((e) => e.employeeId === emp.id));
    const byStatus = (status) => visible.filter((item) => String(item.status || "DRAFT") === status).length;
    const progressMetrics = [
      { label: "لم يبدأوا", value: pendingEmployees.length, helper: "بلا تقييم" },
      { label: "بانتظار المدير", value: byStatus("SELF_SUBMITTED"), helper: "مرسل من الموظف" },
      { label: "بانتظار HR", value: byStatus("MANAGER_APPROVED"), helper: "اعتماد المدير تم" },
      { label: "بانتظار السكرتير", value: byStatus("HR_REVIEWED"), helper: "مراجعة HR تمت" },
      { label: "بانتظار التنفيذي", value: byStatus("SECRETARY_REVIEWED"), helper: "مراجعة السكرتير تمت" },
    ];
    return { accessMode, currentEmployeeId, policy, windowInfo, criteria, cycle: { id: new Date().toISOString().slice(0, 7), name: "تقييم الشهر الحالي", window: windowInfo }, evaluations: visible, pendingEmployees, progressMetrics, metrics: [{ label: "حالة نافذة KPI", value: windowInfo.label, helper: windowInfo.message }, { label: "التقييمات", value: visible.length }, { label: "بانتظار التقييم", value: pendingEmployees.length }] };
  },
  saveKpiEvaluation: async (body = {}) => {
    const { employees, user, accessMode } = await kpiAccessContext();
    const currentEmployeeId = user?.employeeId || "";
    const isSelfTarget = body.employeeId === currentEmployeeId;
    const fallbackStatus = isSelfTarget || accessMode === "self" ? "SELF_SUBMITTED" : accessMode === "team" ? "MANAGER_APPROVED" : accessMode === "hr" ? "HR_REVIEWED" : accessMode === "executive" ? "EXECUTIVE_APPROVED" : "SECRETARY_REVIEWED";
    const cycleId = body.cycleId || new Date().toISOString().slice(0, 7);
    const existingRows = await tableRows("kpi_evaluations", "created_at", false).then(toCamel).catch(() => []);
    const existing = existingRows.find((row) => row.employeeId === body.employeeId && String(row.cycleId || cycleId) === String(cycleId)) || null;
    const employee = employees.find((item) => item.id === body.employeeId) || null;
    const payload = normalizeKpiPayload({ ...body, cycleId, managerEmployeeId: body.managerEmployeeId || employee?.managerEmployeeId || "" }, fallbackStatus, existing || {});
    if (accessMode === "team" && existing) {
      payload.attendanceScore = Number(existing.attendanceScore || 0);
      payload.prayerScore = Number(existing.prayerScore || 0);
      payload.quranCircleScore = Number(existing.quranCircleScore || 0);
      payload.hrNotes = existing.hrNotes || "";
    }
    if (accessMode === "hr" && existing) {
      for (const key of ["targetScore", "efficiencyScore", "conductScore", "initiativesScore", "employeeNotes", "managerNotes"]) payload[key] = existing[key] ?? payload[key];
    }
    payload.status = canonicalKpiStatus(payload.status || fallbackStatus);
    assertSupabaseKpiTransition({ user, employee, existing, nextStatus: payload.status, accessMode: isSelfTarget ? "self" : accessMode });
    const saved = await createOrUpdate("kpi_evaluations", payload, existing?.id);
    await notifySupabaseKpiStage({ employee, saved, nextStatus: payload.status }).catch(() => null);
    return saved;
  },
  updateKpiEvaluation: async (id, body = {}) => {
    const { employees, user, accessMode } = await kpiAccessContext();
    const existingRows = await tableRows("kpi_evaluations", "created_at", false).then(toCamel).catch(() => []);
    const existing = existingRows.find((row) => row.id === id);
    if (!existing) throw new Error("التقييم غير موجود.");
    const employee = employees.find((item) => item.id === existing.employeeId) || null;
    const nextStatus = canonicalKpiStatus(body.status || existing.status);
    assertSupabaseKpiTransition({ user, employee, existing, nextStatus, accessMode });
    const payload = normalizeKpiPayload({ ...existing, ...body, status: nextStatus }, nextStatus, existing);
    const saved = await createOrUpdate("kpi_evaluations", payload, id);
    await notifySupabaseKpiStage({ employee, saved, nextStatus }).catch(() => null);
    return saved;
  },
  disputes: async () => tableRows("dispute_cases", "created_at", false).then(toCamel),
  createDispute: async (body = {}) => {
    const employeeId = body.employeeId || await selfEmployeeId();
    const row = await createOrUpdate("dispute_cases", disputePayload(body, employeeId));
    const committeeEmails = ["direct.manager.03@organization.local", "direct.manager.02@organization.local", "direct.manager.01@organization.local", "executive.secretary@organization.local", "executive.director@organization.local"];
    const client = await sb();
    const { data: profiles } = await client.from("profiles").select("id,employee_id,email").in("email", committeeEmails);
    const notes = (profiles || []).map((profile) => ({ user_id: profile.id, employee_id: profile.employee_id, title: "مشكلة جديدة للجنة حل المشاكل", body: body.title || "شكوى / خلاف", type: "ACTION_REQUIRED", status: "UNREAD", is_read: false }));
    if (notes.length) await safeCreateNotifications(client, notes).catch(() => null);
    return row;
  },
  updateDispute: async (id, body = {}) => createOrUpdate("dispute_cases", disputePayload(body), id),
  submitDisputeCase: async (body = {}) => supabaseEndpoints.createDispute(body),
  locations: async () => {
    const [requests, locations, employees] = await Promise.all([
      tableRows("location_requests", "created_at", false).then(toCamel),
      tableRows("employee_locations", "created_at", false).then(toCamel),
      supabaseEndpoints.employees().catch(() => []),
    ]);
    const byId = new Map((employees || []).map((employee) => [employee.id, employee]));
    return [...requests, ...locations]
      .map((item) => ({ ...item, employee: byId.get(item.employeeId) || null }))
      .sort((a, b) => new Date(b.createdAt || b.requestedAt || b.date || 0) - new Date(a.createdAt || a.requestedAt || a.date || 0));
  },
  createLocationRequest: async (body = {}) => {
    const request = await createOrUpdate("location_requests", {
      employeeId: body.employeeId,
      purpose: body.purpose || "فتح الموقع وإرسال اللوكيشن المباشر",
      requestReason: "",
      status: "PENDING",
      requestedAt: now(),
    });
    try {
      const client = await sb();
      const { data: employee } = await client.from("employees").select("id,user_id,full_name").eq("id", request.employeeId).maybeSingle();
      const title = "فتح الموقع وإرسال اللوكيشن";
      const bodyText = "من فضلك افتح صفحة طلبات وسجل المواقع واضغط إرسال موقعي الآن.";
      const notificationId = await safeCreateNotification(client, {
        user_id: employee?.user_id || null,
        employee_id: request.employeeId,
        title,
        body: bodyText,
        type: "ACTION_REQUIRED",
        route: "location",
        data: { route: "location", type: "LOCATION_REQUEST", locationRequestId: request.id || "", url: "./employee/index.html#location" },
      });
      await client.functions.invoke("send-push-notifications", {
        body: {
          title,
          body: bodyText,
          tag: `location-request-${request.id || request.employeeId}`,
          targetEmployeeIds: [request.employeeId],
          targetUserIds: employee?.user_id ? [employee.user_id] : [],
          notificationId,
          data: { route: "location", type: "LOCATION_REQUEST", locationRequestId: request.id || "", url: "./employee/index.html#location" },
        },
      }).catch((pushError) => debugWarn("send-push-notifications for location request failed", pushError?.message || pushError));
    } catch (error) {
      debugWarn("تعذر إنشاء إشعار الموقع، تم حفظ الطلب فقط.", error);
    }
    return request;
  },
  updateLocationRequest: async (id, body = {}) => {
    const client = await sb();
    const requestPayload = locationRequestPayload(body);
    delete requestPayload.employee_id;
    const { data, error } = await client.from("location_requests").update(requestPayload).eq("id", id).select("*").single();
    fail(error, "تعذر تحديث طلب الموقع.");
    const employeeId = data.employee_id || body.employeeId;
    if (employeeId && body.latitude != null && body.longitude != null) {
      const { error: locError } = await client.from("employee_locations").insert(locationInsertPayload({ ...body, source: body.source || "location_request_response" }, employeeId));
      fail(locError, "تم تحديث الطلب لكن تعذر حفظ سجل الموقع.");
    }
    await audit("update", "location_requests", id, data);
    return toCamel(data);
  },
  requestCenter: async (filters = {}) => {
    const [leaves, missions, exceptions, locations] = await Promise.all([
      supabaseEndpoints.leaves().catch(() => []),
      supabaseEndpoints.missions().catch(() => []),
      supabaseEndpoints.exceptions().catch(() => []),
      supabaseEndpoints.locations().catch(() => []),
    ]);
    let rows = [
      ...leaves.map((item) => ({ ...item, kind: "leave", kindLabel: "إجازة", label: item.leaveType?.name || item.leaveType || "إجازة", createdSort: item.createdAt || item.startDate || "" })),
      ...missions.map((item) => ({ ...item, kind: "mission", kindLabel: "مأمورية", label: item.title || item.destinationName || "مأمورية", createdSort: item.createdAt || item.plannedStart || "" })),
      ...exceptions.map((item) => ({ ...item, kind: "exception", kindLabel: "استثناء حضور", label: item.title || "استثناء حضور", createdSort: item.createdAt || "" })),
      ...locations.filter((item) => item.purpose || item.requestReason).map((item) => ({ ...item, kind: "location", kindLabel: "طلب موقع", label: item.purpose || "طلب موقع", createdSort: item.requestedAt || item.createdAt || "" })),
    ].sort((a, b) => new Date(b.createdSort || b.createdAt || 0) - new Date(a.createdSort || a.createdAt || 0));
    if (filters.status) rows = rows.filter((item) => item.status === filters.status);
    if (filters.kind) rows = rows.filter((item) => item.kind === filters.kind);
    const pending = rows.filter((item) => item.status === "PENDING");
    const summary = { total: rows.length, pending: pending.length, approved: rows.filter((item) => ["APPROVED", "COMPLETED"].includes(item.status)).length, rejected: rows.filter((item) => item.status === "REJECTED").length, stale: pending.filter((item) => (Date.now() - new Date(item.createdSort || item.createdAt || Date.now()).getTime()) > 48 * 60 * 60 * 1000).length };
    return { rows, summary };
  },
  bulkRequestAction: async (body = {}) => {
    const items = Array.isArray(body.items) ? body.items : [];
    const action = body.action === "reject" ? "reject" : "approve";
    let updated = 0;
    for (const token of items) {
      const [kind, id] = String(token).split(":");
      if (kind === "leave") await supabaseEndpoints.updateLeave(id, action);
      else if (kind === "mission") await supabaseEndpoints.updateMission(id, action);
      else if (kind === "exception") await supabaseEndpoints.updateException(id, action);
      else if (kind === "location") await supabaseEndpoints.updateLocationRequest(id, { status: action === "reject" ? "REJECTED" : "APPROVED" });
      else continue;
      updated += 1;
    }
    return { updated };
  },
  recordLocation: async (body = {}) => {
    const client = await sb();
    const employeeId = body.employeeId || (await myEmployee()).id;
    const payload = locationInsertPayload(body, employeeId);
    const { data, error } = await client.from("employee_locations").insert(payload).select("*").single();
    fail(error, "تعذر حفظ الموقع الحالي.");
    await audit("record", "employee_locations", data.id, data);
    return toCamel(data);
  },
  queue: async () => ({ items: getQueued(), pending: getQueued().filter((i) => i.status === "PENDING").length }),
  permissions: async () => selectAll("permissions").then(toCamel),
  roles: async () => selectAll("roles").then((rows) => rows.map((r) => ({ ...toCamel(r), permissions: rolePermissions(toCamel(r)) }))),
  saveRole: async (body = {}) => createOrUpdate("roles", { ...body, permissions: Array.isArray(body.permissions) ? body.permissions : String(body.permissions || "").split(",").map((s) => s.trim()).filter(Boolean) }, body.id),
  branches: async () => selectAll("branches").then(toCamel),
  departments: async () => selectAll("departments").then(toCamel),
  governorates: async () => selectAll("governorates").then(toCamel),
  complexes: async () => selectAll("complexes").then(toCamel),
  listOrg: async (kind) => selectAll(kind).then(toCamel),
  saveOrg: async (kind, body = {}) => createOrUpdate(kind, body, body.id),
  deleteOrg: async (kind, id) => createOrUpdate(kind, { isDeleted: true, active: false }, id),
  auditLogs: async (params = {}) => tableRows("audit_logs", "created_at", false, { limit: params.limit || 100, page: params.page || 0 }).then(toCamel),
  backup: async () => {
    const tables = ["roles", "profiles", "employees", "branches", "departments", "attendance_daily", "leave_requests", "missions", "kpi_evaluations"];
    const out = { note: "نسخة خفيفة من المتصفح. استخدم Edge Function للنسخ الكامل الثقيل." };
    for (const table of tables) out[table] = await selectAll(table, "*", { limit: 1000 }).catch(() => []);
    return out;
  },
  restoreBackup: async () => ({ ok: false, message: "الاسترجاع الكامل في Supabase يجب أن يتم عبر SQL/Edge Function بصلاحية service_role." }),
  saveBackupSnapshot: async (body = {}) => {
    const summary = {
      createdAt: now(),
      source: "browser-lightweight",
      tables: ["roles", "profiles", "employees", "branches", "departments", "attendance_daily", "leave_requests", "missions", "kpi_evaluations"],
      note: "هذه Metadata فقط. النسخ الاحتياطي الكامل يتم من Supabase Backups أو Edge Function بصلاحية service_role."
    };
    const row = await createOrUpdate("system_backups", { name: body.name || `نسخة احتياطية - ${now().slice(0, 10)}`, backupType: "MANUAL", summary }).catch(() => null);
    return row ? { ok: true, snapshot: row, message: "تم حفظ سجل النسخة الاحتياطية. نزّل JSON للاحتفاظ بنسخة محلية." } : { ok: false, message: "تعذر حفظ سجل النسخة الاحتياطية؛ استخدم Supabase Backups للإنتاج." };
  },
  importEmployees: async (rows = []) => {
    const client = await sb();
    const payload = rows.map((row) => toEmployeePayload({ fullName: row.fullName || row.name || row["الاسم"], phone: row.phone || row["الموبايل"], email: row.email || row["البريد"], jobTitle: row.jobTitle || row["الوظيفة"], status: row.status || "ACTIVE" }));
    const { data, error } = await client.from("employees").insert(payload).select("id");
    fail(error, "تعذر استيراد الموظفين.");
    await audit("import", "employees", "bulk", { count: data?.length || 0 });
    return { created: data?.length || 0 };
  },
  uploadAvatar: async (file) => {
    if (!file || !String(file.type || "").startsWith("image/")) throw new Error("اختر ملف صورة صالح.");
    const uploadable = await compressImageFile(file, { maxSide: 900, quality: 0.82 }).catch(() => file);
    if (Number(uploadable.size || file.size || 0) > 2 * 1024 * 1024) throw new Error("حجم الصورة أكبر من 2MB حتى بعد الضغط.");
    return uploadFile(CONFIG().storage?.avatarsBucket || "avatars", "avatars", uploadable);
  },
  attachments: async (scope, entityId) => {
    const rows = toCamel(await tableRows("attachments", "created_at", false));
    const filtered = rows.filter((a) => (!scope || a.scope === scope) && (!entityId || a.entityId === entityId || a.employeeId === entityId));
    return Promise.all(filtered.map(async (item) => ({ ...item, url: await signedAttachmentUrl(item) })));
  },
  uploadAttachment: async (file, body = {}) => {
    const upload = await uploadFile(CONFIG().storage?.attachmentsBucket || "employee-attachments", body.employeeId || body.entityId || "general", file, { privateFile: true });
    return createOrUpdate("attachments", { ...body, fileName: file.name, originalName: file.name, mimeType: file.type, sizeBytes: file.size, url: upload.url, bucketId: upload.bucket, storagePath: upload.path });
  },
  realtimeSnapshot: async () => {
    const dashboard = await supabaseEndpoints.dashboard();
    const locations = await tableRows("employee_locations", "created_at", false).then(toCamel);
    return { dashboard, locations, heatmap: locations.map((loc) => ({ employeeId: loc.employeeId, latitude: loc.latitude, longitude: loc.longitude, weight: 1 })), realtime: { transport: "Supabase Realtime", updatedAt: now() } };
  },
  aiAnalytics: async () => {
    const [employees, daily] = await Promise.all([supabaseEndpoints.employees(), supabaseEndpoints.attendanceDaily()]);
    return { generatedAt: now(), note: "تحليل تقديري مبني على سجلات Supabase. لا يتخذ قرارات تلقائية.", rows: employees.map((employee) => { const days = daily.filter((d) => d.employeeId === employee.id); const absences = days.filter((d) => d.status === "ABSENT").length; const lateMinutes = days.reduce((s, d) => s + Number(d.lateMinutes || 0), 0); const riskScore = Math.min(100, absences * 22 + Math.ceil(lateMinutes / 30) * 7); return { employee, employeeId: employee.id, absences, lateMinutes, riskScore, productivityHint: riskScore >= 60 ? "يحتاج متابعة عاجلة" : riskScore >= 30 ? "متوسط المخاطر" : "مستقر" }; }).sort((a, b) => b.riskScore - a.riskScore) };
  },
  integrations: async () => tableRows("integration_settings", "created_at", false).then(toCamel),
  saveIntegration: async (body = {}) => createOrUpdate("integration_settings", body, body.id),
  accessControlEvents: async () => tableRows("access_control_events", "created_at", false).then(toCamel),
  createAccessEvent: async (body = {}) => createOrUpdate("access_control_events", body),
  subscribePush: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const keys = body.keys || body.payload?.keys || {};
    const payload = {
      user_id: user?.id || null,
      employee_id: user?.employeeId || user?.employee?.id || null,
      endpoint: body.endpoint,
      keys,
      payload: body,
      p256dh: keys.p256dh || "",
      auth: keys.auth || "",
      permission: body.permission || globalThis.Notification?.permission || "default",
      user_agent: body.userAgent || navigator.userAgent || "",
      platform: body.platform || navigator.platform || "browser",
      is_active: true,
      status: "ACTIVE",
      last_seen_at: now(),
      last_error: "",
      updated_at: now(),
    };
    const { data, error } = await client.from("push_subscriptions").upsert(payload, { onConflict: "endpoint" }).select("*").single();
    fail(error, "تعذر حفظ اشتراك Web Push. تأكد من تطبيق Patch 080 أو RUN_IN_SUPABASE_SQL_EDITOR.sql.");
    return toCamel(data);
  },
  uploadPunchSelfie: async (body = {}) => {
    const employee = body.employeeId ? await employeeById(body.employeeId).catch(() => null) : await myEmployee().catch(() => null);
    const bucket = CONFIG().storage?.punchSelfiesBucket || "punch-selfies";
    const folder = `attendance/${employee?.id || body.employeeId || "unknown"}`;
    const file = body.file || null;
    if (!file) return { url: "" };
    const result = await uploadFile(bucket, folder, file, { privateFile: false });
    if (typeof result === "string") return { url: result };
    return { url: result.url || "", bucket: result.bucket, path: result.path };
  },
  passkeyStatus: async () => tableRows("passkey_credentials", "created_at", false).then(toCamel),
  registerPasskey: async (body = {}) => {
    const client = await sb();
    const { data, error } = await client.functions.invoke("passkey-register", { body });
    if (error || data?.error) throw new Error(data?.message || data?.error || error?.message || "تعذر تسجيل بصمة الجهاز. تأكد من فتح الموقع عبر HTTPS ومن تفعيل بصمة/قفل الشاشة على الجهاز.");
    return data;
  },
  offlineQueue: async () => getQueued(),
  syncOfflineQueue: async () => {
    const rows = getQueued();
    let synced = 0;
    for (const item of rows.filter((i) => i.status === "PENDING")) {
      try {
        item.status = "SYNCED"; item.syncedAt = now(); synced += 1;
      } catch (error) { item.attempts = Number(item.attempts || 0) + 1; item.error = error.message; }
    }
    const remainingRows = rows.filter((i) => i.status === "PENDING");
    setQueued(remainingRows);
    return { synced, remaining: remainingRows.length };
  },
  managerDashboard: async () => {
    const [employees, events, leaves, missions, exceptions] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceEvents({ from: now().slice(0, 10), to: now().slice(0, 10), limit: 5000 }).catch(() => []),
      supabaseEndpoints.leaves().catch(() => []),
      supabaseEndpoints.missions().catch(() => []),
      supabaseEndpoints.exceptions().catch(() => []),
    ]);
    const todayMap = new Map();
    for (const event of events || []) if (!todayMap.has(event.employeeId) || new Date(event.eventAt || 0) > new Date(todayMap.get(event.employeeId).eventAt || 0)) todayMap.set(event.employeeId, event);
    const user = await currentUser().catch(() => null);
    const full = rolePermissions(user?.role).includes("*") || (user?.permissions || []).includes("*");
    const team = (employees || []).filter((employee) => full || employee.id === user?.employeeId || employee.managerEmployeeId === user?.employeeId).map((employee) => {
      const event = todayMap.get(employee.id);
      const pendingItems = [...(leaves || []), ...(missions || []), ...(exceptions || [])].filter((item) => item.employeeId === employee.id && item.status === "PENDING").length;
      return { ...employee, todayStatus: event?.status || event?.type || "ABSENT", lastEventAt: event?.eventAt || "", pendingItems };
    });
    const present = team.filter((item) => ["PRESENT", "LATE", "CHECK_IN"].includes(item.todayStatus)).length;
    return {
      team,
      metrics: [
        { label: "الفريق", value: team.length, helper: "حسب الصلاحيات" },
        { label: "حاضر اليوم", value: present, helper: "حضور أو تأخير" },
        { label: "لم يبصم", value: Math.max(team.length - present, 0), helper: now().slice(0, 10) },
        { label: "طلبات معلقة", value: team.reduce((sum, item) => sum + item.pendingItems, 0), helper: "متابعة المدير" },
      ],
      actions: team.filter((item) => item.todayStatus === "ABSENT").slice(0, 8).map((item) => ({ title: `لم يسجل ${item.fullName} بصمة اليوم`, body: "يمكن إرسال تنبيه من لوحة المدير.", status: "ACTION_REQUIRED" })),
    };
  },
  generateAttendanceAlerts: async () => {
    const client = await sb();
    try {
      const { data, error } = await client.functions.invoke("send-attendance-reminders", { body: { source: "admin_manual", sendPush: true } });
      if (!error && data) return data;
      if (error) debugWarn("send-attendance-reminders failed; using local notification fallback", error.message || error);
    } catch (error) {
      debugWarn("send-attendance-reminders unavailable; using local notification fallback", error);
    }
    const [employees, events, existing] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceEvents({ from: now().slice(0, 10), to: now().slice(0, 10), limit: 5000 }).catch(() => []),
      client.from("notifications").select("employee_id,created_at,type").eq("type", "MISSING_PUNCH").gte("created_at", `${now().slice(0, 10)}T00:00:00`).catch(() => ({ data: [] })),
    ]);
    const seen = new Set((events || []).map((event) => event.employeeId).filter(Boolean));
    const already = new Set((existing?.data || []).map((item) => item.employee_id).filter(Boolean));
    let created = 0;
    for (const employee of employees || []) {
      if (seen.has(employee.id) || already.has(employee.id)) continue;
      const result = await safeCreateNotifications(client, [{
        user_id: employee.userId || null,
        employee_id: employee.id,
        title: "تذكير بتسجيل البصمة",
        body: "لم يتم تسجيل بصمة حضور اليوم حتى الآن. افتح صفحة البصمة وسجل حضورك عند الوصول للمجمع.",
        type: "MISSING_PUNCH",
        route: "punch",
        data: { route: "punch" },
      }]);
      if (result.created) created += 1;
    }
    await audit("notify.missing_punch", "attendance", "bulk", { created, pushed: 0, fallback: true }).catch(() => null);
    return { created, pushed: 0, fallback: true };
  },
  rejectedPunches: async () => {
    const client = await sb();
    let query = await client.from("attendance_events").select("*, employee:employees(*), identity_checks:attendance_identity_checks(*)").or("status.eq.REJECTED,requires_review.eq.true").order("event_at", { ascending: false }).limit(500);
    if (query.error && ["PGRST200", "PGRST201", "42P01"].includes(query.error.code)) {
      query = await client.from("attendance_events").select("*, employee:employees(*)").or("status.eq.REJECTED,requires_review.eq.true").order("event_at", { ascending: false }).limit(500);
    }
    const { data, error } = query;
    fail(error, "تعذر قراءة البصمات المرفوضة.");
    return (data || []).map((row) => {
      const { employee, identity_checks: identityChecks = [], ...event } = row;
      const identityCheck = Array.isArray(identityChecks) ? identityChecks[0] : null;
      return { ...mapEvent(event), identityCheckId: identityCheck?.id || "", identityCheck: toCamel(identityCheck || {}), employee: employee ? enrichEmployee(employee) : null };
    }).filter((event) => event.status !== "REJECTED_CONFIRMED" && event.verificationStatus !== "manual_approved");
  },
  reviewRejectedPunch: async (eventId, action = "approve", checkId = "") => {
    const client = await sb();
    if (checkId) {
      const { data, error } = await client.rpc("review_attendance_identity_check", {
        p_check_id: checkId,
        p_decision: action === "approve" ? "APPROVED" : "REJECTED",
        p_notes: action === "approve" ? "اعتماد يدوي من لوحة HR" : "رفض يدوي من لوحة HR",
      });
      if (!error) return toCamel(data || {});
      debugWarn("تعذر استخدام RPC review_attendance_identity_check؛ سيتم استخدام التحديث القديم", error);
    }
    const payload = action === "approve"
      ? { status: "MANUAL_APPROVED", verification_status: "manual_approved", requires_review: false, review_decision: "APPROVED", reviewed_at: now() }
      : { status: "REJECTED_CONFIRMED", requires_review: false, review_decision: "REJECTED", reviewed_at: now() };
    const { data, error } = await client.from("attendance_events").update(payload).eq("id", eventId).select("*").single();
    fail(error, "تعذر مراجعة البصمة.");
    await audit("review.rejected_punch", "attendance_event", eventId, payload).catch(() => null);
    return mapEvent(data);
  },
  trustedDevices: async () => {
    const [devices, employees] = await Promise.all([
      tableRows("passkey_credentials", "created_at", false).then(toCamel).catch(() => []),
      supabaseEndpoints.employees().catch(() => []),
    ]);
    const byId = new Map((employees || []).map((employee) => [employee.id, employee]));
    return (devices || []).map((device) => ({ ...device, employee: byId.get(device.employeeId) || employees.find((e) => e.userId === device.userId) || null, status: device.status || (device.trusted === false ? "DEVICE_DISABLED" : "DEVICE_TRUSTED") }));
  },
  updateTrustedDevice: async (deviceId, body = {}) => {
    const client = await sb();
    const payload = body.action === "disable" ? { trusted: false, status: "DEVICE_DISABLED", disabled_at: now() } : { trusted: true, status: "DEVICE_TRUSTED", trusted_at: now() };
    const { data, error } = await client.from("passkey_credentials").update(payload).eq("id", deviceId).select("*").single();
    fail(error, "تعذر تعديل الجهاز.");
    await audit("device.trust", "passkey_credential", deviceId, payload).catch(() => null);
    return toCamel(data);
  },
  monthlyReport: async ({ month } = {}) => {
    const bounds = (() => {
      const safe = /^\d{4}-\d{2}$/.test(String(month)) ? String(month) : now().slice(0, 7);
      const start = `${safe}-01`;
      const endDate = new Date(`${start}T00:00:00`);
      endDate.setMonth(endDate.getMonth() + 1);
      return { month: safe, start, end: endDate.toISOString().slice(0, 10) };
    })();
    const [employees, events] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceEvents({ from: bounds.start, to: bounds.end, limit: 20000 }).catch(() => []),
    ]);
    const rows = (employees || []).map((employee) => {
      const empEvents = (events || []).filter((event) => event.employeeId === employee.id);
      return {
        employeeId: employee.id,
        employeeName: employee.fullName,
        jobTitle: employee.jobTitle || "",
        checkIns: empEvents.filter((event) => ["CHECK_IN", "PRESENT", "LATE"].includes(event.type) || ["PRESENT", "LATE", "MANUAL_APPROVED"].includes(event.status)).length,
        checkOuts: empEvents.filter((event) => event.type === "CHECK_OUT").length,
        rejected: empEvents.filter((event) => event.status === "REJECTED" || event.status === "REJECTED_CONFIRMED").length,
        lateMinutes: empEvents.reduce((sum, event) => sum + Number(event.lateMinutes || event.late_minutes || 0), 0),
        lastEventAt: empEvents.sort((a, b) => new Date(b.eventAt || 0) - new Date(a.eventAt || 0))[0]?.eventAt || "",
      };
    });
    const totals = rows.reduce((acc, row) => { acc.checkIns += row.checkIns; acc.checkOuts += row.checkOuts; acc.rejected += row.rejected; acc.lateMinutes += row.lateMinutes; return acc; }, { checkIns: 0, checkOuts: 0, rejected: 0, lateMinutes: 0 });
    return { month: bounds.month, rows, metrics: [{ label: "الموظفون", value: rows.length, helper: "كل الموظفين" }, { label: "حضور", value: totals.checkIns, helper: "إجمالي الحضور" }, { label: "انصراف", value: totals.checkOuts, helper: "إجمالي الانصراف" }, { label: "مرفوض", value: totals.rejected, helper: "محاولات مرفوضة" }, { label: "دقائق التأخير", value: totals.lateMinutes, helper: "إجمالي الشهر" }] };
  },
  securityLog: async () => {
    const rows = await supabaseEndpoints.auditLogs({ limit: 500 }).catch(() => []);
    return rows.filter((log) => String(log.action || "").startsWith("auth.") || ["device.trust", "review.rejected_punch"].includes(log.action));
  },
  passwordVault: async () => {
    const users = await supabaseEndpoints.users();
    return users.map((user) => ({ ...user, password: "غير متاحة بعد التفعيل الحقيقي — استخدم إصدار كلمة مؤقتة جديدة", mustChangePassword: user.mustChangePassword }));
  },
  resetUserPassword: async (userId, password = "") => {
    const tempPassword = password || makeRuntimeTemporaryPassword();
    const client = await sb();
    const { data, error } = await client.functions.invoke("admin-update-user", { body: { id: userId, password: tempPassword, temporaryPassword: true, mustChangePassword: true } });
    fail(error || (data?.error ? new Error(data.error) : null), "تعذر إعادة تعيين كلمة المرور. تأكد من نشر admin-update-user.");
    return { user: data?.user || data, temporaryPassword: tempPassword };
  },
  executiveReport: async () => {
    const [employees, requests, disputes, tasks, docs] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.requestCenter({}).catch(() => ({ summary: {}, rows: [] })),
      supabaseEndpoints.disputes().catch(() => []),
      supabaseEndpoints.tasks().catch(() => []),
      supabaseEndpoints.employeeDocuments().catch(() => []),
    ]);
    const today = now().slice(0, 10);
    const events = await supabaseEndpoints.attendanceEvents({ from: today, to: today, limit: 5000 }).catch(() => []);
    const openDisputes = (Array.isArray(disputes) ? disputes : disputes.cases || []).filter((item) => !["CLOSED", "RESOLVED", "REJECTED"].includes(item.status));
    const overdueTasks = tasks.filter((task) => task.status !== "DONE" && task.dueDate && new Date(task.dueDate) < new Date(today));
    const documentsExpiring = docs.filter((doc) => doc.expiresOn && new Date(doc.expiresOn) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const byManager = employees.filter((e) => employees.some((child) => child.managerEmployeeId === e.id)).map((manager) => {
      const team = employees.filter((e) => e.managerEmployeeId === manager.id);
      const teamIds = team.map((e) => e.id);
      return { manager, teamCount: team.length, pendingRequests: (requests.rows || []).filter((item) => teamIds.includes(item.employeeId) && item.status === "PENDING").length, openTasks: tasks.filter((task) => teamIds.includes(task.employeeId) && task.status !== "DONE").length };
    });
    const score = Math.round(Math.min(100, Math.max(0, 40 + (employees.length ? 20 : 0) + (requests.summary?.stale ? 0 : 20) + (documentsExpiring.length ? 5 : 20))));
    return { generatedAt: now(), readiness: { score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد جدًا" : "يحتاج متابعة", parts: [] }, cards: { employees: employees.length, activeEmployees: employees.filter((e) => e.status === "ACTIVE").length, presentToday: events.filter((e) => e.type === "CHECK_IN").length, pendingRequests: requests.summary?.pending || 0, openDisputes: openDisputes.length, overdueTasks: overdueTasks.length, expiringDocuments: documentsExpiring.length }, workflow: requests.summary, openDisputes: openDisputes.slice(0, 8), overdueTasks: overdueTasks.slice(0, 8), documentsExpiring: documentsExpiring.slice(0, 8), managerPerformance: byManager };
  },
  leaveBalances: async () => {
    const client = await sb();
    const employees = await supabaseEndpoints.employees().catch(() => []);
    const { data, error } = await client.from("leave_balances").select("*").limit(5000);
    fail(error, "تعذر قراءة أرصدة الإجازات. تأكد من تطبيق Patch 020.");
    const byEmployee = new Map((toCamel(data || [])).map((row) => [row.employeeId, row]));
    return employees.map((employee) => {
      const row = byEmployee.get(employee.id) || {};
      const annual = Number(row.annualTotal ?? 21);
      const casual = Number(row.casualTotal ?? 7);
      const used = Number(row.usedDays ?? 0);
      return { id: row.id || `lb-${employee.id}`, employeeId: employee.id, employee, annualTotal: annual, casualTotal: casual, sickTotal: Number(row.sickTotal ?? 15), usedDays: used, remainingDays: Number(row.remainingDays ?? (annual + casual - used)), updatedAt: row.updatedAt || "" };
    });
  },
  saveLeaveBalance: async (employeeId, body = {}) => {
    const client = await sb();
    const payload = { employee_id: employeeId, annual_total: Number(body.annualTotal || 21), casual_total: Number(body.casualTotal || 7), sick_total: Number(body.sickTotal || 15), used_days: Number(body.usedDays || 0), remaining_days: Number(body.remainingDays || (Number(body.annualTotal || 21) + Number(body.casualTotal || 7) - Number(body.usedDays || 0))), notes: body.notes || "", updated_at: now() };
    const { data, error } = await client.from("leave_balances").upsert(payload, { onConflict: "employee_id" }).select("*").single();
    fail(error, "تعذر حفظ رصيد الإجازات.");
    await audit("leave_balance.save", "leave_balance", employeeId, payload).catch(() => null);
    return toCamel(data);
  },
  tasks: async (filters = {}) => {
    const client = await sb();
    let query = client.from("employee_tasks").select("*, employee:employees(*)").order("created_at", { ascending: false }).limit(1000);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
    const { data, error } = await query;
    fail(error, "تعذر قراءة المهام. تأكد من تطبيق Patch 020.");
    return (data || []).map(({ employee, ...row }) => ({ ...toCamel(row), employee: employee ? enrichEmployee(employee) : null }));
  },
  myTasks: async () => {
    const user = await currentUser();
    return supabaseEndpoints.tasks({ employeeId: user?.employeeId || user?.employee?.id || "" });
  },
  createTask: async (body = {}) => {
    const client = await sb();
    const user = await currentUser();
    const payload = { employee_id: body.employeeId || user?.employeeId || user?.employee?.id, assigned_by_employee_id: user?.employeeId || null, title: body.title || "مهمة جديدة", description: body.description || "", priority: body.priority || "MEDIUM", status: body.status || "OPEN", due_date: body.dueDate || null, created_at: now(), updated_at: now() };
    const { data, error } = await client.from("employee_tasks").insert(payload).select("*, employee:employees(*)").single();
    fail(error, "تعذر إنشاء المهمة.");
    await safeCreateNotification(client, { employee_id: payload.employee_id, title: "مهمة جديدة", body: payload.title, type: "ACTION_REQUIRED", route: "tasks", data: { route: "tasks", taskId: data?.id || "" } }).catch(() => null);
    await audit("task.create", "employee_task", data.id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  updateTask: async (id, body = {}) => {
    const client = await sb();
    const payload = compact({ status: body.status, title: body.title, description: body.description, priority: body.priority, due_date: body.dueDate || body.due_date, updated_at: now(), completed_at: body.status === "DONE" ? now() : undefined });
    const { data, error } = await client.from("employee_tasks").update(payload).eq("id", id).select("*, employee:employees(*)").single();
    fail(error, "تعذر تعديل المهمة.");
    await audit("task.update", "employee_task", id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  employeeDocuments: async (filters = {}) => {
    const client = await sb();
    let query = client.from("employee_documents").select("*, employee:employees(*)").order("created_at", { ascending: false }).limit(1000);
    if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    fail(error, "تعذر قراءة مستندات الموظفين. تأكد من تطبيق Patch 020.");
    return (data || []).map(({ employee, ...row }) => ({ ...toCamel(row), employee: employee ? enrichEmployee(employee) : null }));
  },
  myDocuments: async () => {
    const user = await currentUser();
    return supabaseEndpoints.employeeDocuments({ employeeId: user?.employeeId || user?.employee?.id || "" });
  },
  createEmployeeDocument: async (body = {}) => {
    const client = await sb();
    const payload = { employee_id: body.employeeId, title: body.title || "مستند موظف", document_type: body.documentType || "OTHER", status: body.status || "ACTIVE", file_name: body.fileName || "", file_url: body.fileUrl || "", expires_on: body.expiresOn || null, notes: body.notes || "", created_at: now(), updated_at: now() };
    const { data, error } = await client.from("employee_documents").insert(payload).select("*, employee:employees(*)").single();
    fail(error, "تعذر حفظ المستند.");
    await audit("document.create", "employee_document", data.id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  updateEmployeeDocument: async (id, body = {}) => {
    const client = await sb();
    const payload = compact({ title: body.title, document_type: body.documentType, status: body.status, file_name: body.fileName, file_url: body.fileUrl, expires_on: body.expiresOn, notes: body.notes, updated_at: now() });
    const { data, error } = await client.from("employee_documents").update(payload).eq("id", id).select("*, employee:employees(*)").single();
    fail(error, "تعذر تعديل المستند.");
    await audit("document.update", "employee_document", id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  myRequests: async () => {
    const user = await currentUser();
    const employeeId = user?.employeeId || user?.employee?.id || "";
    const payload = await supabaseEndpoints.requestCenter({});
    const rows = (payload.rows || []).filter((item) => item.employeeId === employeeId);
    return { pending: rows.filter((item) => item.status === "PENDING").length, approved: rows.filter((item) => ["APPROVED", "COMPLETED"].includes(item.status)).length, rejected: rows.filter((item) => item.status === "REJECTED").length, latest: rows.slice(0, 6) };
  },
  acknowledgeNotification: async (id) => {
    const client = await sb();
    const { data, error } = await client.from("notifications").update({ is_read: true, status: "READ", read_at: now() }).eq("id", id).select("*").single();
    fail(error, "تعذر تأكيد قراءة الإشعار.");
    return toCamel(data);
  },
  permissionMatrix: async () => ({ roles: await supabaseEndpoints.roles(), permissions: await supabaseEndpoints.permissions() }),
  savePermissionMatrix: async (body = {}) => {
    const client = await sb();
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const { data, error } = await client.from("roles").update({ permissions, updated_at: now() }).eq("id", body.roleId).select("*").single();
    fail(error, "تعذر حفظ صلاحيات الدور.");
    await audit("permission_matrix.save", "role", body.roleId, { permissions }).catch(() => null);
    return toCamel(data);
  },
  qualityCenter: async () => {
    const [employees, users, requests, policiesPayload, docs] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.users().catch(() => []),
      supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [], summary: {} })),
      supabaseEndpoints.policies().catch(() => ({ policies: [], summary: {} })),
      supabaseEndpoints.employeeDocuments().catch(() => []),
    ]);
    const missingUsers = (employees || []).filter((employee) => !(users || []).some((user) => user.employeeId === employee.id));
    const staleWorkflow = (requests.rows || []).filter((item) => item.status === "PENDING" && item.createdAt && (Date.now() - new Date(item.createdAt).getTime()) > 48 * 36e5);
    const expiringDocuments = (docs || []).filter((doc) => doc.expiresOn && new Date(doc.expiresOn) <= new Date(Date.now() + 30 * 864e5));
    const issues = [
      ...missingUsers.map((employee) => ({ severity: "HIGH", area: "users", title: "موظف بلا حساب دخول", detail: employee.fullName })),
      ...staleWorkflow.map((item) => ({ severity: "MEDIUM", area: "workflow", title: "طلب متأخر عن الاعتماد", detail: item.label || item.kindLabel || item.id })),
      ...expiringDocuments.map((doc) => ({ severity: "MEDIUM", area: "documents", title: "مستند قرب الانتهاء", detail: doc.title || doc.id })),
    ];
    const score = Math.max(0, Math.min(100, 95 - issues.filter((i) => i.severity === "HIGH").length * 10 - issues.filter((i) => i.severity === "MEDIUM").length * 3));
    const [maintenanceRuns, escalations] = await Promise.all([
      tableRows("maintenance_runs", "created_at", false).catch(() => []),
      tableRows("workflow_escalations", "created_at", false).catch(() => []),
    ]);
    return { readiness: { score, grade: score >= 90 ? "ممتاز" : score >= 75 ? "جيد جدًا" : "يحتاج متابعة", issues, missingUsers: missingUsers.length, staleWorkflow: staleWorkflow.length, expiringDocuments: expiringDocuments.length }, policy: policiesPayload.summary || {}, maintenanceRuns: toCamel(maintenanceRuns || []), escalations: toCamel(escalations || []) };
  },
  runMaintenance: async (body = {}) => {
    const client = await sb();
    const before = await supabaseEndpoints.qualityCenter();
    const employees = await supabaseEndpoints.employees().catch(() => []);
    for (const employee of employees) {
      await client.from("leave_balances").upsert({ employee_id: employee.id, annual_total: 21, casual_total: 7, sick_total: 15, remaining_days: 28, updated_at: now() }, { onConflict: "employee_id" }).catch(() => null);
    }
    const after = await supabaseEndpoints.qualityCenter();
    const payload = { title: body.title || "صيانة Supabase", before_score: before.readiness?.score || 0, after_score: after.readiness?.score || 0, repair: { note: "تم إنشاء أرصدة إجازات ناقصة وفحص الجاهزية. إنشاء الحسابات يتم من Edge Function حفاظًا على الأمان." }, workflow: { checked: after.readiness?.staleWorkflow || 0 }, created_at: now() };
    const { data, error } = await client.from("maintenance_runs").insert(payload).select("*").single();
    fail(error, "تعذر حفظ سجل الصيانة. تأكد من تطبيق Patch 021.");
    await audit("maintenance.run", "system", data.id, payload).catch(() => null);
    return { run: toCamel(data), readiness: after.readiness };
  },
  policies: async () => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    const [{ data: policies, error: pError }, { data: acknowledgements, error: aError }] = await Promise.all([
      client.from("employee_policies").select("*").neq("status", "ARCHIVED").order("created_at", { ascending: false }),
      client.from("policy_acknowledgements").select("*").limit(20000),
    ]);
    fail(pError || aError, "تعذر قراءة السياسات. تأكد من تطبيق Patch 021.");
    const rows = toCamel(policies || []).map((policy) => {
      const ack = toCamel(acknowledgements || []).find((row) => row.policyId === policy.id && (!employeeId || row.employeeId === employeeId));
      return { ...policy, acknowledged: Boolean(ack), acknowledgedAt: ack?.acknowledgedAt || "", acknowledgement: ack || null };
    });
    const active = rows.filter((policy) => policy.status === "ACTIVE" && policy.requiresAcknowledgement !== false);
    const employees = await supabaseEndpoints.employees().catch(() => []);
    const totalRequired = active.length * employees.length;
    const signed = (acknowledgements || []).filter((ack) => active.some((policy) => policy.id === ack.policy_id)).length;
    return { policies: rows, acknowledgements: toCamel(acknowledgements || []), summary: { policies: active.length, employees: employees.length, totalRequired, signed, missing: Math.max(0, totalRequired - signed), percent: totalRequired ? Math.round((signed / totalRequired) * 100) : 100 } };
  },
  savePolicy: async (body = {}) => {
    const payload = { title: body.title || "سياسة جديدة", category: body.category || "GENERAL", version: body.version || "1.0", body: body.body || body.description || "", requires_acknowledgement: body.requiresAcknowledgement !== false && body.requiresAcknowledgement !== "false", status: body.status || "ACTIVE", updated_at: now() };
    const row = await createOrUpdate("employee_policies", payload, body.id);
    await audit("policy.save", "employee_policy", row.id, payload).catch(() => null);
    return row;
  },
  acknowledgePolicy: async (policyId) => {
    const client = await sb();
    const user = await currentUser();
    const employeeId = user?.employeeId || user?.employee?.id;
    if (!employeeId) throw new Error("لا يوجد موظف مرتبط بالحساب.");
    const payload = { policy_id: policyId, employee_id: employeeId, user_id: user.id, acknowledged_at: now(), created_at: now() };
    const { data, error } = await client.from("policy_acknowledgements").upsert(payload, { onConflict: "policy_id,employee_id" }).select("*").single();
    fail(error, "تعذر تأكيد قراءة السياسة.");
    await audit("policy.acknowledge", "employee_policy", policyId, payload).catch(() => null);
    return toCamel(data);
  },
  addCommitteeAction: async (caseId, body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const payload = { case_id: caseId, employee_id: user?.employeeId || null, action_type: body.actionType || "NOTE", decision: body.decision || "", note: body.note || body.committeeDecision || "", created_by_user_id: user?.id || null, created_at: now() };
    const { data, error } = await client.from("committee_actions").insert(payload).select("*").single();
    fail(error, "تعذر حفظ إجراء اللجنة. تأكد من تطبيق Patch 021.");
    if (body.status || body.escalatedToExecutive) {
      await client.from("dispute_cases").update({ status: body.escalatedToExecutive ? "ESCALATED" : body.status, escalated_to_executive: Boolean(body.escalatedToExecutive), escalated_at: body.escalatedToExecutive ? now() : undefined }).eq("id", caseId).catch(() => null);
    }
    await audit("dispute.committee_action", "dispute_case", caseId, payload).catch(() => null);
    return toCamel(data);
  },
  adminAccessLog: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    if (!user?.id) return null;
    const payload = { actor_user_id: user?.id || null, actor_employee_id: user?.employeeId || null, action: body.action || "admin.gateway", route: body.route || location.hash || "", result: body.result || "INFO", user_agent: navigator.userAgent || "", metadata: body.metadata || {}, created_at: now() };
    const { data, error } = await client.from("admin_access_logs").insert(payload).select("*").single();
    if (error && ["401", "403", "42501"].includes(String(error.code || error.status || ""))) return null;
    fail(error, "تعذر حفظ سجل دخول الإدارة. تأكد من تطبيق Patch 023.");
    return toCamel(data);
  },
  executiveMobile: async () => {
    const [employees, attendance, leaves, missions, liveRequests, liveResponses, employeeLocations] = await Promise.all([
      supabaseEndpoints.employees(),
      maybeTableRows("attendance_events", "event_at", false).then(toCamel),
      supabaseEndpoints.leaves().catch(() => []),
      supabaseEndpoints.missions().catch(() => []),
      maybeTableRows("live_location_requests", "created_at", false).then(toCamel),
      maybeTableRows("live_location_responses", "responded_at", false).then(toCamel),
      maybeTableRows("employee_locations", "created_at", false).then(toCamel),
    ]);
    const day = now().slice(0, 10);
    const todayFor = (employee) => {
      const events = attendance.filter((event) => event.employeeId === employee.id && String(event.eventAt || event.createdAt || "").slice(0,10) === day).sort((a,b) => new Date(a.eventAt || a.createdAt || 0) - new Date(b.eventAt || b.createdAt || 0));
      const checkIn = events.find((event) => event.type === "CHECK_IN");
      const checkOut = [...events].reverse().find((event) => event.type === "CHECK_OUT");
      const leave = leaves.find((row) => row.employeeId === employee.id && row.status === "APPROVED" && String(row.startDate || "").slice(0,10) <= day && String(row.endDate || row.startDate || "").slice(0,10) >= day);
      const mission = missions.find((row) => row.employeeId === employee.id && ["APPROVED", "IN_PROGRESS"].includes(row.status) && String(row.plannedStart || row.startDate || "").slice(0,10) <= day && String(row.plannedEnd || row.endDate || row.plannedStart || "").slice(0,10) >= day);
      const latestLiveLocation = [...liveResponses.filter((row) => row.employeeId === employee.id && row.status === "APPROVED")].sort((a,b) => new Date(b.capturedAt || b.respondedAt || 0) - new Date(a.capturedAt || a.respondedAt || 0))[0] || null;
      const latestStoredLocation = [...employeeLocations.filter((row) => row.employeeId === employee.id)].sort((a,b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0))[0] || null;
      const latestLocation = latestStoredLocation || latestLiveLocation || null;
      const pendingLiveRequest = [...liveRequests.filter((row) => row.employeeId === employee.id && row.status === "PENDING" && (!row.expiresAt || new Date(row.expiresAt) > new Date()))].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
      let status = "ABSENT";
      if (leave) status = "ON_LEAVE"; else if (mission && !checkIn) status = "ON_MISSION"; else if (checkIn && checkOut) status = "CHECKED_OUT"; else if (checkIn) status = String(checkIn.status || "PRESENT").includes("LATE") ? "LATE" : "PRESENT";
      return { day, status, checkInAt: checkIn?.eventAt || checkIn?.createdAt || "", checkOutAt: checkOut?.eventAt || checkOut?.createdAt || "", checkIn, checkOut, leave, mission, latestLocation, pendingLiveRequest, events };
    };
    const cards = employees.map((employee) => ({ ...employee, today: todayFor(employee) }));
    const counts = cards.reduce((acc, employee) => { const status = employee.today?.status || "ABSENT"; acc.total++; if (["PRESENT", "LATE"].includes(status)) acc.present++; if (status === "LATE") acc.late++; if (status === "ABSENT") acc.absent++; if (status === "CHECKED_OUT") acc.checkedOut++; if (status === "ON_LEAVE") acc.onLeave++; if (status === "ON_MISSION") acc.onMission++; if (employee.today?.pendingLiveRequest) acc.pendingLiveLocations++; return acc; }, { total: 0, present: 0, late: 0, absent: 0, checkedOut: 0, onLeave: 0, onMission: 0, pendingLiveLocations: 0 });
    return { counts, employees: cards, generatedAt: now() };
  },
  executiveEmployeeDetail: async (employeeId) => {
    const [mobile, attendance, leaves, missions, liveRequests, liveResponses] = await Promise.all([
      supabaseEndpoints.executiveMobile(),
      maybeTableRows("attendance_events", "event_at", false).then(toCamel),
      supabaseEndpoints.leaves().catch(() => []),
      supabaseEndpoints.missions().catch(() => []),
      maybeTableRows("live_location_requests", "created_at", false).then(toCamel),
      maybeTableRows("live_location_responses", "responded_at", false).then(toCamel),
    ]);
    const employee = mobile.employees.find((row) => row.id === employeeId) || await employeeById(employeeId);
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    return { employee, today: employee.today || {}, attendance: attendance.filter((row) => row.employeeId === employeeId && String(row.eventAt || row.createdAt || "") >= since), leaves: leaves.filter((row) => row.employeeId === employeeId).slice(0, 10), missions: missions.filter((row) => row.employeeId === employeeId).slice(0, 10), liveRequests: liveRequests.filter((row) => row.employeeId === employeeId).slice(0, 20), liveResponses: liveResponses.filter((row) => row.employeeId === employeeId).slice(0, 20) };
  },
  requestLiveLocation: async (employeeId, body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const targetEmployee = await resolveDeliverableEmployee(employeeId);
    const targetEmployeeId = targetEmployee.id;
    await client.from("live_location_requests").update({ status: "EXPIRED", responded_at: now(), response_note: "انتهت مهلة الطلب تلقائيًا", updated_at: now() }).eq("employee_id", targetEmployeeId).eq("status", "PENDING").lt("expires_at", now()).catch(() => null);
    await client.from("live_location_requests").update({ status: "SUPERSEDED", responded_at: now(), response_note: "تم إغلاق الطلب بسبب إرسال طلب أحدث", updated_at: now() }).eq("employee_id", targetEmployeeId).eq("status", "PENDING").catch(() => null);
    const payload = { employee_id: targetEmployeeId, requested_by_user_id: user?.id || null, requested_by_employee_id: user?.employeeId || null, requested_by_name: user?.fullName || user?.name || "الإدارة", reason: body.reason || "متابعة تنفيذية مباشرة", status: "PENDING", precision: body.precision || "HIGH", expires_at: body.expiresAt || new Date(Date.now() + 15 * 60000).toISOString(), created_at: now() };
    const { data, error } = await client.from("live_location_requests").insert(payload).select("*").single();
    fail(error, "تعذر إنشاء طلب الموقع المباشر. تأكد من تشغيل ملف SQL النهائي RUN_IN_SUPABASE_SQL_EDITOR.sql.");
    
    const notificationTitle = "طلب مشاركة موقعك الحالي";
    const notificationBody = payload.requested_by_name + " يطلب إرسال موقعك المباشر الآن. السبب: " + payload.reason;
    let notificationId = "";
    // Create notifications through a SECURITY DEFINER RPC to avoid RLS/column-shape 400 errors.
    // If the SQL patch is not applied yet, the live-location request still remains created and push is attempted.
    const notificationInsert = await client.rpc("safe_create_notification", {
      p_user_id: targetEmployee?.userId || null,
      p_employee_id: targetEmployeeId,
      p_title: notificationTitle,
      p_body: notificationBody,
      p_type: "ACTION_REQUIRED",
      p_route: "location",
      p_data: { route: "location", type: "LIVE_LOCATION_REQUEST", liveLocationRequestId: data.id },
    });
    if (!notificationInsert.error && notificationInsert.data) notificationId = String(notificationInsert.data);
    else debugWarn("safe_create_notification skipped; run RUN_IN_SUPABASE_SQL_EDITOR.sql for internal notification rows", notificationInsert.error?.message || notificationInsert.error);
    const pushResult = await client.functions.invoke("send-push-notifications", {
      body: {
        title: notificationTitle,
        body: notificationBody,
        tag: `live-location-${data.id}`,
        targetEmployeeIds: [targetEmployeeId],
        targetUserIds: targetEmployee?.userId ? [targetEmployee.userId] : [],
        notificationId,
        data: { route: "location", url: "./employee/index.html#location", type: "LIVE_LOCATION_REQUEST", liveLocationRequestId: data.id },
      },
    }).catch((error) => {
      debugWarn("send-push-notifications failed; internal request was still created", error?.message || error);
      return null;
    });
    await audit("live_location.request", "employee", targetEmployeeId, { ...payload, requestedEmployeeId: employeeId }).catch(() => null);
    return { ...toCamel(data), notificationId, push: pushResult?.data || null };
  },
  myLiveLocationRequests: async () => {
    const client = await sb();
    const user = await currentUser();
    const employeeId = user?.employeeId || user?.employee?.id || "";
    if (!employeeId) return [];
    await client.from("live_location_requests").update({ status: "EXPIRED", responded_at: now(), response_note: "انتهت مهلة الطلب تلقائيًا", updated_at: now() }).eq("employee_id", employeeId).eq("status", "PENDING").lt("expires_at", now()).catch(() => null);
    const { data, error } = await client.from("live_location_requests").select("*").or(`employee_id.eq.${employeeId},requested_by_employee_id.eq.${employeeId}`).order("created_at", { ascending: false }).limit(100);
    fail(error, "تعذر قراءة طلبات الموقع المباشر.");
    return toCamel(data || []);
  },
  respondLiveLocationRequest: async (id, body = {}) => {
    const client = await sb();
    const user = await currentUser();
    const employeeId = user?.employeeId || user?.employee?.id;
    const requestedStatus = String(body.status || body.action || "").toUpperCase();
    const hasCoordinates = body.latitude !== undefined && body.longitude !== undefined && body.latitude !== null && body.longitude !== null;
    const minutes = Number(body.postponeMinutes || 5);
    const postponed = requestedStatus === "POSTPONED" || body.action === "postpone" || Number(body.postponeMinutes || 0) > 0;
    const temporaryRejected = requestedStatus === "REJECTED_TEMPORARY" || requestedStatus === "TEMP_REJECT";
    const rejected = requestedStatus === "REJECTED" || body.action === "reject" || temporaryRejected;
    const approved = !rejected && !postponed && (requestedStatus === "APPROVED" || requestedStatus === "SEND" || requestedStatus === "SHARED" || hasCoordinates);
    if (approved && !hasCoordinates) throw new Error("لا يمكن إرسال موافقة الموقع بدون إحداثيات فعلية. فعّل GPS ثم أعد المحاولة.");
    const finalStatus = approved ? "APPROVED" : (postponed ? "POSTPONED" : "REJECTED_TEMPORARY");
    const responseNote = body.note || body.reason || (postponed ? `طلب الموظف تأجيل إرسال الموقع ${minutes} دقائق` : rejected ? "رفض/تأجيل مؤقت" : "رد مؤقت بدون إحداثيات");
    const update = { status: finalStatus, responded_at: now(), response_note: responseNote, updated_at: now() };
    const { data: request, error } = await client.from("live_location_requests").update(update).eq("id", id).eq("employee_id", employeeId).eq("status", "PENDING").select("*").maybeSingle();
    fail(error, "تعذر حفظ رد الموقع المباشر.");
    if (!request) throw new Error("طلب الموقع غير موجود أو لا يخص هذا الحساب.");
    const responsePayload = { request_id: id, employee_id: employeeId, requested_by_user_id: request.requested_by_user_id, status: update.status, latitude: approved ? Number(body.latitude) : null, longitude: approved ? Number(body.longitude) : null, accuracy_meters: approved ? Number(body.accuracyMeters || body.accuracy || 0) : null, captured_at: body.capturedAt || now(), responded_at: now(), note: approved ? (body.addressLabel || body.locationLabel || update.response_note || "") : update.response_note };
    const hasValidResponseCoordinates = Number.isFinite(responsePayload.latitude) && Number.isFinite(responsePayload.longitude);
    const { data: response, error: rError } = await client.from("live_location_responses").insert(responsePayload).select("*").single();
    fail(rError, "تم تحديث الطلب لكن تعذر حفظ الاستجابة.");
    const employeeName = user?.fullName || user?.employee?.fullName || "الموظف";
    if (approved && hasValidResponseCoordinates) await ignoreSupabaseError(client.from("employee_locations").insert({ employee_id: employeeId, latitude: responsePayload.latitude, longitude: responsePayload.longitude, accuracy_meters: responsePayload.accuracy_meters, source: "live_location_request", status: "LIVE_SHARED", captured_at: responsePayload.captured_at, address_label: body.addressLabel || body.locationLabel || "", location_status: body.geofenceStatus || body.locationStatus || "", distance_from_branch: body.distanceFromBranchMeters ?? body.distanceFromBranch ?? null }));
    if (request.requested_by_user_id) {
      const title = approved ? "تم إرسال الموقع المباشر" : postponed ? "تم تأجيل طلب الموقع" : "تم رفض/تأجيل طلب الموقع مؤقتًا";
      const note = approved ? `${employeeName} أرسل موقعه الحالي${body.addressLabel ? `: ${body.addressLabel}` : ""}` : postponed ? `${employeeName} طلب تأجيل إرسال الموقع ${minutes} دقائق.` : `${employeeName} رفض/أجّل إرسال الموقع مؤقتًا: ${responseNote}`;
      await client.rpc("safe_create_notification", { p_user_id: request.requested_by_user_id, p_employee_id: request.requested_by_employee_id || null, p_title: title, p_body: note, p_type: "LIVE_LOCATION_RESPONSE", p_route: "employees", p_data: { route: "employees", type: "LIVE_LOCATION_RESPONSE", employeeId, requestId: id, status: update.status } }).catch(() => null);
    }
    await audit("live_location.respond", "live_location_request", id, { request, response }).catch(() => null);
    return { request: toCamel(request), response: toCamel(response) };
  },
  sensitiveApprovals: async () => {
    const rows = await maybeTableRows("sensitive_approvals", "created_at", false).then(toCamel);
    const counts = rows.reduce((acc, row) => { const status = row.status || "PENDING"; acc.total += 1; acc[status] = (acc[status] || 0) + 1; return acc; }, { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0 });
    return { rows, counts };
  },
  createSensitiveApproval: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const payload = { action_type: body.actionType || "SENSITIVE_ACTION", target_type: body.targetType || "system", target_id: body.targetId || "", target_employee_id: body.targetEmployeeId || body.employeeId || null, title: body.title || "طلب اعتماد عملية حساسة", summary: body.summary || body.reason || "", payload: body.payload || {}, status: "PENDING", requested_by_user_id: user?.id || null, requested_by_employee_id: user?.employeeId || null, requested_by_name: user?.fullName || user?.name || "النظام", requested_at: now(), created_at: now() };
    const { data, error } = await client.from("sensitive_approvals").insert(payload).select("*").single();
    fail(error, "تعذر إنشاء طلب الاعتماد الحساس. تأكد من تطبيق Patch 024.");
    await audit("sensitive_approval.request", payload.target_type, payload.target_id, payload).catch(() => null);
    return toCamel(data);
  },
  decideSensitiveApproval: async (id, body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const decision = body.decision === "reject" || body.status === "REJECTED" ? "REJECTED" : "APPROVED";
    const update = { status: decision, decided_at: now(), decided_by_user_id: user?.id || null, decision_note: body.note || body.reason || "" };
    const { data, error } = await client.from("sensitive_approvals").update(update).eq("id", id).select("*").single();
    fail(error, "تعذر حفظ قرار الاعتماد الحساس.");
    await audit("sensitive_approval.decision", "sensitive_approval", id, update).catch(() => null);
    return { approval: toCamel(data), result: { executed: false, note: "في Supabase الحقيقي يتم تنفيذ العمليات الحساسة عبر Edge Function أو RPC آمن بعد الاعتماد." } };
  },
  executivePresenceSnapshot: async () => {
    const mobile = await supabaseEndpoints.executiveMobile();
    return { day: now().slice(0, 10), counts: mobile.counts || {}, rows: mobile.employees || [], generatedAt: now() };
  },
  managementStructure: async () => {
    const employees = await supabaseEndpoints.employees().catch(() => []);
    const managerSlugs = new Set(["admin", "executive", "executive-secretary", "hr-manager", "manager", "direct-manager", "operations-manager-1", "operations-manager-2"]);
    const managerOptions = employees.filter((employee) => managerSlugs.has(employee.role?.slug) || (employee.role?.permissions || []).includes("manager:team") || (employee.role?.permissions || []).includes("*") || employees.some((child) => child.managerEmployeeId === employee.id));
    const teamOf = (managerId) => employees.filter((employee) => employee.managerEmployeeId === managerId);
    const kpiRows = await tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []);
    const requests = await supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] }));
    const managerTeams = managerOptions.map((manager) => {
      const team = teamOf(manager.id);
      return {
        manager,
        teamCount: team.length,
        activeCount: team.filter((employee) => employee.status === "ACTIVE").length,
        pendingKpi: team.filter((employee) => !["EXECUTIVE_APPROVED", "APPROVED"].includes(kpiRows.find((row) => row.employeeId === employee.id)?.status || "DRAFT")).length,
        pendingRequests: (requests.rows || []).filter((row) => team.some((employee) => employee.id === row.employeeId) && ["PENDING", "OPEN", "IN_REVIEW"].includes(row.status)).length,
      };
    });
    const bySlug = (...slugs) => employees.filter((employee) => slugs.includes(employee.role?.slug)).map((employee) => ({ ...employee, teamCount: teamOf(employee.id).length }));
    return {
      metrics: [
        { label: "إجمالي الموظفين", value: employees.length, helper: "من Supabase" },
        { label: "مديرون مباشرون", value: managerOptions.length, helper: "مرشحون لإدارة فرق" },
        { label: "بلا مدير", value: employees.filter((employee) => employee.role?.slug === "employee" && !employee.managerEmployeeId).length, helper: "تحتاج ربط" },
        { label: "فرق نشطة", value: managerTeams.filter((row) => row.teamCount > 0).length, helper: "لديها أعضاء" },
      ],
      employees,
      managerOptions,
      levels: [
        { key: "executive", label: "المدير التنفيذي", people: bySlug("executive") },
        { key: "secretary", label: "السكرتير التنفيذي/التقني", people: bySlug("executive-secretary", "admin") },
        { key: "first-line", label: "الصف الأول من المديرين", people: bySlug("manager", "direct-manager", "operations-manager-1", "operations-manager-2") },
        { key: "hr", label: "الموارد البشرية", people: bySlug("hr-manager") },
        { key: "employees", label: "الموظفون", people: bySlug("employee") },
      ],
      managerTeams,
    };
  },
  assignManager: async (body = {}) => {
    const client = await sb();
    const employeeId = body.employeeId;
    if (!employeeId) throw new Error("اختر الموظف أولًا.");
    if (body.managerEmployeeId && body.managerEmployeeId === employeeId) throw new Error("لا يمكن جعل الموظف مديرًا لنفسه.");
    const payload = { manager_employee_id: body.managerEmployeeId || null, manager_assigned_at: now(), manager_assignment_note: body.note || "", updated_at: now() };
    const { data, error } = await client.from("employees").update(payload).eq("id", employeeId).select("*").single();
    fail(error, "تعذر تحديث المدير المباشر.");
    if (body.managerEmployeeId) await ignoreSupabaseError(client.from("notifications").insert({ employee_id: body.managerEmployeeId, title: "تم ربط موظف بفريقك", body: `${data.full_name || "موظف"} أصبح ضمن فريقك المباشر.`, type: "INFO", status: "UNREAD", is_read: false, created_at: now() }));
    await audit("organization.assign_manager", "employee", employeeId, payload).catch(() => null);
    const c = await core({ force: true });
    return enrichEmployee(data, c);
  },
  teamDashboard: async (body = {}) => {
    const user = await currentUser().catch(() => null);
    const managerId = body.managerId || user?.employeeId || "";
    const [employees, events, requests, kpiRows] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceEvents({ from: now().slice(0, 10), to: now().slice(0, 10), limit: 5000 }).catch(() => []),
      supabaseEndpoints.requestCenter({}).catch(() => ({ rows: [] })),
      tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []),
    ]);
    const full = (user?.permissions || []).includes("*");
    const team = employees.filter((employee) => full ? (body.managerId ? employee.managerEmployeeId === managerId : true) : (employee.managerEmployeeId === managerId || employee.id === managerId));
    const todayMap = new Map();
    for (const event of events) if (!todayMap.has(event.employeeId) || new Date(event.eventAt || 0) > new Date(todayMap.get(event.employeeId).eventAt || 0)) todayMap.set(event.employeeId, event);
    const rows = team.map((employee) => {
      const event = todayMap.get(employee.id);
      return { ...employee, todayStatus: event?.status || event?.type || "ABSENT", lastEventAt: event?.eventAt || "", kpiStatus: kpiRows.find((row) => row.employeeId === employee.id)?.status || "DRAFT", pendingItems: (requests.rows || []).filter((row) => row.employeeId === employee.id && ["PENDING", "OPEN", "IN_REVIEW"].includes(row.status)).length };
    });
    const present = rows.filter((row) => ["PRESENT", "LATE", "CHECK_IN", "MANUAL_APPROVED"].includes(row.todayStatus)).length;
    const pending = (requests.rows || []).filter((item) => rows.some((employee) => employee.id === item.employeeId) && ["PENDING", "IN_REVIEW", "OPEN"].includes(item.status));
    return { manager: employees.find((employee) => employee.id === managerId) || null, team: rows, pending, metrics: [
      { label: "حجم الفريق", value: rows.length, helper: "حسب الصلاحيات" },
      { label: "حاضر اليوم", value: present, helper: "حضور/تأخير" },
      { label: "KPI معلق", value: rows.filter((row) => !["APPROVED", "EXECUTIVE_APPROVED"].includes(row.kpiStatus)).length, helper: "لم يغلق" },
      { label: "طلبات معلقة", value: pending.length, helper: "تحتاج متابعة" },
    ] };
  },
  sendTeamReminder: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const managerId = body.managerId || user?.employeeId || "";
    const team = (await supabaseEndpoints.employees().catch(() => [])).filter((employee) => employee.managerEmployeeId === managerId);
    if (!team.length) return { sent: 0, pushed: 0 };
    const rows = team.map((employee) => ({ employee_id: employee.id, user_id: employee.userId || null, title: "تذكير من المدير المباشر", body: body.message || "يرجى مراجعة الحضور والطلبات وKPI المطلوب.", type: "ACTION_REQUIRED", status: "UNREAD", is_read: false, created_at: now() }));
    const noteResult = await safeCreateNotifications(client, rows, { block: true, message: "تعذر إرسال تذكير الفريق." });
    if (!noteResult.created) throw new Error("لم يتم إنشاء أي إشعار داخلي للفريق.");
    let pushed = 0;
    await client.functions.invoke("send-push-notifications", { body: { title: "تذكير من المدير المباشر", body: body.message || "يرجى مراجعة الحضور والطلبات وKPI المطلوب.", tag: "team-reminder", targetEmployeeIds: team.map((employee) => employee.id) } })
      .then(({ data, error }) => { if (!error) pushed = Number(data?.attempted || 0); })
      .catch(() => null);
    await audit("team.reminder", "employee", managerId, { sent: rows.length, pushed }).catch(() => null);
    return { sent: rows.length, pushed };
  },
  hrOperations: async () => {
    const [employees, daily, kpiRows, users] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceDaily().catch(() => []),
      tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []),
      supabaseEndpoints.users().catch(() => []),
    ]);
    const today = now().slice(0, 10);
    const todayDaily = daily.filter((row) => String(row.date || row.createdAt || "").slice(0, 10) === today);
    const attendanceIssues = employees.map((employee) => {
      const day = todayDaily.find((row) => row.employeeId === employee.id);
      const status = day?.status || "ABSENT";
      return { employee, employeeId: employee.id, status, title: status === "ABSENT" ? "غياب/لم يسجل حضور" : status, requiresReview: Boolean(day?.requiresReview) || ["ABSENT", "LATE", "MISSING_CHECKOUT", "REVIEW", "EARLY_EXIT"].includes(status), recommendation: "مراجعة HR" };
    }).filter((row) => row.requiresReview).slice(0, 100);
    const kpiForHr = kpiRows.filter((row) => ["MANAGER_APPROVED", "HR_REVIEWED"].includes(row.status)).slice(0, 100);
    const dataIssues = employees.flatMap((employee) => {
      const issues = [];
      if (employee.role?.slug === "employee" && !employee.managerEmployeeId) issues.push({ employee, issue: "لا يوجد مدير مباشر" });
      if (!employee.userId && !users.some((user) => user.employeeId === employee.id)) issues.push({ employee, issue: "لا يوجد حساب دخول مرتبط" });
      if (!employee.phone && !employee.email) issues.push({ employee, issue: "لا يوجد هاتف أو بريد" });
      return issues;
    });
    return { metrics: [
      { label: "الموظفون", value: employees.length, helper: "داخل HR" },
      { label: "حضور يحتاج مراجعة", value: attendanceIssues.length, helper: today },
      { label: "KPI عند HR", value: kpiForHr.length, helper: "بنود HR فقط" },
      { label: "بيانات ناقصة", value: dataIssues.length, helper: "تحتاج استكمال" },
    ], attendanceIssues, kpiForHr, dataIssues };
  },
  disputeWorkflow: async () => {
    const [cases, employees] = await Promise.all([supabaseEndpoints.disputes().catch(() => []), supabaseEndpoints.employees().catch(() => [])]);
    const committeeSlugs = new Set(["executive-secretary", "hr-manager", "operations-manager-1", "operations-manager-2", "admin"]);
    return { workflowSteps: ["الموظف يقدم الشكوى", "المدير المباشر يراجع", "لجنة حل المشكلات تراجع", "السكرتير التنفيذي ينسق ويرفع", "المدير التنفيذي يعتمد عند التصعيد"], committeeMembers: employees.filter((employee) => committeeSlugs.has(employee.role?.slug)), cases };
  },
  advanceDispute: async (id, body = {}) => {
    const client = await sb();
    const payload = { status: body.status || "IN_REVIEW", committee_decision: body.note || body.committeeDecision || "تمت المراجعة", escalated_to_executive: body.status === "ESCALATED" || body.escalatedToExecutive === true, current_stage: body.currentStage || body.status || "committee_review", updated_at: now(), escalation_reason: body.escalationReason || body.note || "" };
    const { data, error } = await client.from("dispute_cases").update(payload).eq("id", id).select("*, employee:employees(*)").single();
    fail(error, "تعذر تحديث مسار الشكوى.");
    await audit("dispute.advance", "dispute_case", id, payload).catch(() => null);
    const { employee, ...row } = data;
    return { ...toCamel(row), employee: employee ? enrichEmployee(employee) : null };
  },
  reportCenter: async () => {
    const [employees, attendance, kpiRows, disputes, hr] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.attendanceEvents({ limit: 20000 }).catch(() => []),
      tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []),
      supabaseEndpoints.disputes().catch(() => []),
      supabaseEndpoints.hrOperations().catch(() => ({ metrics: [] })),
    ]);
    const rows = [
      { key: "attendance", title: "تقرير الحضور والانصراف", description: "حضور، انصراف، تأخير، ومراجعات", scope: "HR/مدير", count: attendance.length, generatedAt: now() },
      { key: "kpi", title: "تقرير KPI الشهري", description: "درجات وتقدم دورة التقييم", scope: "مدير/HR/تنفيذي", count: kpiRows.length, generatedAt: now() },
      { key: "teams", title: "تقرير الفرق والمديرين", description: "توزيع الموظفين على المديرين", scope: "الإدارة", count: employees.filter((employee) => employees.some((child) => child.managerEmployeeId === employee.id)).length, generatedAt: now() },
      { key: "disputes", title: "تقرير الشكاوى والتصعيد", description: "الشكاوى حسب المرحلة والقرار", scope: "اللجنة/السكرتير", count: disputes.length, generatedAt: now() },
      { key: "hr", title: "تقرير HR التشغيلي", description: "بيانات ناقصة وKPI وحضور يحتاج مراجعة", scope: "HR", count: employees.length, generatedAt: now() },
    ];
    return { rows, metrics: [{ label: "تقارير جاهزة", value: rows.length, helper: "CSV/Excel/PDF" }, { label: "موظفون", value: employees.length, helper: "ضمن الصلاحيات" }, { label: "KPI", value: kpiRows.length, helper: "كل الدورات" }, { label: "شكاوى", value: disputes.length, helper: "كل الحالات" }], hr };
  },
  exportManagementReport: async (body = {}) => {
    const key = body.key || body.reportKey || "attendance";
    const titleMap = { attendance: "تقرير الحضور والانصراف", kpi: "تقرير KPI الشهري", teams: "تقرير الفرق والمديرين", disputes: "تقرير الشكاوى والتصعيد", hr: "تقرير HR التشغيلي" };
    let headers = [], rows = [];
    if (key === "kpi") {
      const [kpiRows, employees] = await Promise.all([tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []), supabaseEndpoints.employees().catch(() => [])]);
      headers = ["الموظف", "المدير", "الإجمالي", "الحالة", "الدورة"];
      rows = kpiRows.map((row) => { const emp = employees.find((e) => e.id === row.employeeId); const mgr = employees.find((e) => e.id === row.managerEmployeeId || e.id === emp?.managerEmployeeId); return [emp?.fullName || row.employeeId, mgr?.fullName || "-", row.totalScore || 0, row.status || "DRAFT", row.cycleId || ""]; });
    } else if (key === "teams") {
      const structure = await supabaseEndpoints.managementStructure();
      headers = ["المدير", "حجم الفريق", "نشط", "KPI معلق", "طلبات معلقة"];
      rows = structure.managerTeams.map((row) => [row.manager.fullName, row.teamCount, row.activeCount, row.pendingKpi, row.pendingRequests]);
    } else if (key === "disputes") {
      const disputes = await supabaseEndpoints.disputes().catch(() => []);
      headers = ["العنوان", "الموظف", "الحالة", "الأولوية", "القرار"];
      rows = disputes.map((row) => [row.title, row.employee?.fullName || "-", row.status || "OPEN", row.severity || row.priority || "MEDIUM", row.committeeDecision || row.resolution || ""]);
    } else if (key === "hr") {
      const hr = await supabaseEndpoints.hrOperations();
      headers = ["المؤشر", "القيمة", "ملاحظة"];
      rows = (hr.metrics || []).map((m) => [m.label, m.value, m.helper || ""]);
    } else {
      const events = await supabaseEndpoints.attendanceEvents({ limit: 20000 }).catch(() => []);
      headers = ["الموظف", "النوع", "التاريخ", "المصدر", "الموقع", "ملاحظات"];
      rows = events.map((event) => [event.employee?.fullName || event.employeeId, event.type || event.status || "-", event.eventAt || event.createdAt || "", event.source || "-", event.geofenceStatus || "-", event.notes || ""]);
    }
    return { title: titleMap[key] || "تقرير", fileName: key + "-report", headers, rows, summaryHtml: `<div class="summary"><div><span>عدد السجلات</span><strong>${rows.length}</strong></div><div><span>تاريخ الإصدار</span><strong>${now().slice(0,10)}</strong></div></div>` };
  },
  monthlyEvaluations: async (body = {}) => {
    const client = await sb();
    const month = body.month || now().slice(0, 7);
    const [employees, existing] = await Promise.all([supabaseEndpoints.employees().catch(() => []), tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => [])]);
    const existingKeys = new Set(existing.filter((row) => row.cycleId === month).map((row) => row.employeeId));
    const toInsert = employees.filter((employee) => !existingKeys.has(employee.id)).map((employee) => ({ cycle_id: month, employee_id: employee.id, manager_employee_id: employee.managerEmployeeId || null, status: "DRAFT", evaluation_date: `${month}-20`, created_at: now(), updated_at: now() }));
    if (toInsert.length) await client.from("kpi_evaluations").insert(toInsert).catch(() => null);
    const { data, error } = await client.from("kpi_evaluations").select("*, employee:employees(*), manager:manager_employee_id(*)").eq("cycle_id", month).order("updated_at", { ascending: false }).limit(2000);
    fail(error, "تعذر قراءة التقييمات الشهرية.");
    return { month, cycle: { id: month, name: `دورة ${month}` }, evaluations: (data || []).map(({ employee, manager, ...row }) => ({ ...toCamel(row), employee: employee ? enrichEmployee(employee) : null, manager: manager ? enrichEmployee(manager) : null })) };
  },
  saveMonthlyEvaluation: async (id, body = {}) => {
    const payload = compact({ target_score: body.targetScore, efficiency_score: body.efficiencyScore, attendance_score: body.attendanceScore, conduct_score: body.conductScore, prayer_score: body.prayerScore, quran_circle_score: body.quranCircleScore, initiatives_score: body.initiativesScore, manager_notes: body.managerComment || body.managerNotes, hr_notes: body.hrNotes, status: body.status, updated_at: now() });
    const client = await sb();
    const { data, error } = await client.from("kpi_evaluations").update(payload).eq("id", id).select("*").single();
    fail(error, "تعذر حفظ التقييم الشهري.");
    return toCamel(data);
  },
  closeKpiCycle: async (body = {}) => {
    const client = await sb();
    const user = await currentUser().catch(() => null);
    const cycleId = body.cycleId || now().slice(0, 7);
    const payload = { id: cycleId, name: body.name || `دورة ${cycleId}`, status: body.status || "CLOSED", locked_at: now(), locked_by_user_id: user?.id || null, final_report_generated_at: now(), updated_at: now() };
    const { data, error } = await client.from("kpi_cycles").upsert(payload, { onConflict: "id" }).select("*").single();
    fail(error, "تعذر إغلاق دورة KPI. تأكد من تطبيق Patch 038/040.");
    await ignoreSupabaseError(client.from("kpi_evaluations").update({ locked_at: now(), locked_by_user_id: user?.id || null }).eq("cycle_id", cycleId));
    return toCamel(data);
  },
  recomputeKpi: async (body = {}) => supabaseEndpoints.monthlyEvaluations({ month: body.month || body.cycleId || now().slice(0, 7) }),
  sendKpiReminders: async (body = {}) => {
    const payload = await supabaseEndpoints.monthlyEvaluations({ month: body.month || now().slice(0, 7) });
    const pending = (payload.evaluations || []).filter((row) => !["APPROVED", "EXECUTIVE_APPROVED"].includes(row.status));
    const client = await sb();
    if (!pending.length) return { sent: 0, pushed: 0 };
    await client.from("notifications").insert(pending.map((row) => ({ employee_id: row.employeeId, title: "تذكير تقييم KPI", body: "يرجى استكمال تقييم الأداء الشهري قبل الإغلاق.", type: "ACTION_REQUIRED", status: "UNREAD", is_read: false, created_at: now() })));
    let pushed = 0;
    await client.functions.invoke("send-push-notifications", { body: { title: "تذكير تقييم KPI", body: "يرجى استكمال تقييم الأداء الشهري قبل الإغلاق.", tag: "kpi-reminder", targetEmployeeIds: pending.map((row) => row.employeeId) } }).then(({ data, error }) => { if (!error) pushed = Number(data?.attempted || 0); }).catch(() => null);
    return { sent: pending.length, pushed };
  },
  smartAttendanceRules: async () => ({ rules: { absentAfterHour: 12, missingCheckoutAfterHour: 20, duplicateWindowMinutes: 10, maxAccuracyMeters: 90 }, runs: await maybeTableRows("attendance_rule_runs", "created_at", false).then(toCamel), settings: await supabaseEndpoints.settings().catch(() => ({})) }),
  saveSmartAttendanceRules: async (body = {}) => {
    const client = await sb();
    const value = { absentAfterHour: Number(body.absentAfterHour || 12), missingCheckoutAfterHour: Number(body.missingCheckoutAfterHour || 20), duplicateWindowMinutes: Number(body.duplicateWindowMinutes || 10), maxAccuracyMeters: Number(body.maxAccuracyMeters || 500) };
    const { data, error } = await client.from("settings").upsert({ key: "attendance_rules", value, description: "Smart attendance rules", updated_at: now() }, { onConflict: "key" }).select("*").single();
    fail(error, "تعذر حفظ قواعد الحضور الذكية. تأكد من تطبيق Patch 040.");
    return { rules: data.value };
  },
  runSmartAttendance: async (body = {}) => {
    const client = await sb();
    const date = body.date || now().slice(0, 10);
    const [employees, daily] = await Promise.all([supabaseEndpoints.employees().catch(() => []), supabaseEndpoints.attendanceDaily().catch(() => [])]);
    const dayRows = daily.filter((row) => String(row.date || "").slice(0, 10) === date);
    const rows = employees.map((employee) => { const row = dayRows.find((item) => item.employeeId === employee.id); const status = row?.status || "ABSENT"; return { employee, employeeId: employee.id, status, title: status === "ABSENT" ? "لم يسجل حضور" : status, severity: ["ABSENT", "MISSING_CHECKOUT"].includes(status) ? "HIGH" : status === "LATE" ? "MEDIUM" : "LOW", requiresReview: !row || Boolean(row.requiresReview) || ["ABSENT", "LATE", "MISSING_CHECKOUT", "EARLY_EXIT", "REVIEW"].includes(status), recommendation: "مراجعة HR عند الحاجة" }; });
    await client.from("attendance_rule_runs").insert({ run_date: date, status: "COMPLETED", total_employees: employees.length, issues_count: rows.filter((row) => row.requiresReview).length, result: { rows }, created_at: now() }).catch(() => null);
    return { date, rows, issues: rows.filter((row) => row.requiresReview), generatedAt: now() };
  },
  smartAdminAlerts: async () => ({ alerts: await maybeTableRows("smart_alerts", "created_at", false).then(toCamel), snapshot: await supabaseEndpoints.runSmartAttendance({ date: now().slice(0, 10) }).catch(() => null) }),
  managerSuite: async () => { const base = await supabaseEndpoints.managerDashboard(); const smart = await supabaseEndpoints.runSmartAttendance({ date: now().slice(0, 10) }).catch(() => ({ rows: [] })); const ids = new Set((base.team || []).map((employee) => employee.id)); return { ...base, smartRows: (smart.rows || []).filter((row) => ids.has(row.employeeId)), pending: base.pending || [], generatedAt: now() }; },
  autoBackupStatus: async () => ({ policy: { keepLast: 30 }, backups: await maybeTableRows("system_backups", "created_at", false).then(toCamel), runs: await maybeTableRows("auto_backup_runs", "created_at", false).then(toCamel) }),
  trustedDeviceApprovalRequests: async () => {
    const client = await sb();
    const { data, error } = await client.from("trusted_device_approval_requests").select("*").order("created_at", { ascending: false }).limit(200);
    if (error && ["42P01", "PGRST200", "PGRST204"].includes(error.code)) return [];
    fail(error, "تعذر قراءة طلبات اعتماد الأجهزة.");
    return toCamel(data || []);
  },
  requestTrustedDeviceApproval: async (body = {}) => {
    const client = await sb();
    const { data, error } = await client.rpc("request_trusted_device_approval", {
      p_employee_id: body.employeeId,
      p_device_fingerprint_hash: body.deviceFingerprintHash || "",
      p_device_name: body.deviceName || "",
      p_user_agent: body.userAgent || "",
      p_selfie_url: body.selfieUrl || "",
      p_latitude: body.latitude ?? null,
      p_longitude: body.longitude ?? null,
      p_accuracy_meters: body.accuracyMeters ?? body.accuracy ?? null,
    });
    if (error && ["42883", "42P01"].includes(error.code)) return { requestId: "LOCAL_PENDING", status: "PENDING" };
    fail(error, "تعذر إرسال طلب اعتماد الجهاز.");
    return { requestId: data, status: "PENDING" };
  },
  reviewTrustedDeviceApproval: async (body = {}) => {
    const client = await sb();
    const { data, error } = await client.rpc("review_trusted_device_approval", {
      p_request_id: body.requestId || body.id,
      p_decision: body.decision || "APPROVED",
      p_reason: body.reason || "",
    });
    fail(error, "تعذر مراجعة اعتماد الجهاز.");
    return toCamel(data || {});
  },
  validateBranchQrChallenge: async (body = {}) => ({ valid: true, status: "DISABLED", challengeId: "", disabled: true, rpc: "validate_branch_qr_challenge" }),
  createBranchQrChallenge: async (body = {}) => ({ disabled: true, status: "DISABLED", message: "QR متوقف في هذه النسخة ولا يتم إنشاء أكواد فرع." }),
  attendanceRiskCenter: async () => {
    const client = await sb();
    const { data, error } = await client.from("attendance_risk_center").select("*").limit(500);
    if (error && ["42P01", "PGRST200", "PGRST204"].includes(error.code)) {
      const fallback = await supabaseEndpoints.rejectedPunches().catch(() => []);
      return { rows: fallback.map((event) => ({ employeeId: event.employeeId, employee: event.employee, score: event.riskScore || 0, level: event.riskLevel || "MEDIUM", flags: (event.riskFlags || []).map((flag) => ({ label: flag })), events: [event] })), counts: {}, rules: ["Identity Guard fallback"] };
    }
    fail(error, "تعذر قراءة مركز مخاطر الحضور.");
    const rows = toCamel(data || []);
    const counts = rows.reduce((acc, row) => { const level = row.riskLevel || "LOW"; acc[level] = (acc[level] || 0) + 1; return acc; }, {});
    return { rows: rows.map((row) => ({ ...row, employee: { fullName: row.employeeName }, score: row.riskScore || 0, level: row.riskLevel || "LOW", flags: [...(row.riskFlags || []), ...(row.antiSpoofingFlags || [])].map((flag) => ({ label: flag })), events: [row] })), counts, rules: ["اعتماد الجهاز", "QR متوقف", "سيلفي", "GPS anti-spoofing", "تصعيد HR"] };
  },
  acknowledgeAttendancePolicy: async (body = {}) => {
    const client = await sb();
    const { data, error } = await client.rpc("acknowledge_attendance_identity_policy", {
      p_employee_id: body.employeeId,
      p_policy_version: body.policyVersion || "attendance-identity-v3",
      p_device_fingerprint_hash: body.deviceFingerprintHash || "",
      p_browser_install_id: body.browserInstallId || "",
      p_user_agent: body.userAgent || "",
    });
    if (error && ["42883", "42P01"].includes(error.code)) return { ok: true, localOnly: true };
    fail(error, "تعذر حفظ إقرار سياسة الحضور.");
    return { id: data, ok: true };
  },
  acknowledgeAttendanceIdentityPolicy: async (body = {}) => supabaseEndpoints.acknowledgeAttendancePolicy(body),
  runAutomaticBackup: async (body = {}) => {
    const client = await sb();
    const snapshot = await supabaseEndpoints.exportFullBackup();
    const { data, error } = await client.from("system_backups").insert({ name: body.title || "نسخة احتياطية تلقائية", title: body.title || "نسخة احتياطية تلقائية", backup_type: "AUTO", summary: { employees: snapshot.employees?.length || 0, users: snapshot.users?.length || 0, attendanceEvents: snapshot.attendanceEvents?.length || 0 }, snapshot, status: "DONE", created_at: now() }).select("*").single();
    fail(error, "تعذر إنشاء النسخة الاحتياطية.");
    return toCamel(data);
  },
  databaseMigrationsStatus: async () => {
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
      "098_location_security_edge_hardening.sql"
    ];
    const applied = await maybeTableRows("database_migration_status", "applied_at", false).then(toCamel);
    const normalizeMigrationName = (name = "") => String(name).replace(/\.sql$/i, "");
    const appliedSet = new Set(applied.flatMap((row) => [row.name, normalizeMigrationName(row.name)]));
    return { expectedPatch: "098_location_security_edge_hardening", rows: expected.map((name, index) => {
      const marker = normalizeMigrationName(name);
      const isApplied = appliedSet.has(name) || appliedSet.has(marker);
      return { name, marker, order: index + 1, status: isApplied ? "APPLIED" : "CHECK_MANUALLY" };
    }), applied };
  },
  markMigrationApplied: async (name) => createOrUpdate("database_migration_status", { name, status: "APPLIED", appliedAt: now(), notes: "Marked from admin UI" }).catch(async () => {
    const client = await sb();
    const { data, error } = await client.from("database_migration_status").upsert({ name, status: "APPLIED", applied_at: now(), notes: "Marked from admin UI" }, { onConflict: "name" }).select("*").single();
    fail(error, "تعذر تعليم migration كمنفذ.");
    return toCamel(data);
  }),
  supabaseSetupCheck: async () => {
    const cfg = CONFIG();
    const checks = [
      { label: "Supabase مفعل", ok: Boolean(cfg.enabled), detail: cfg.enabled ? "enabled=true" : "enabled=false" },
      { label: "Project URL", ok: Boolean(cfg.url), detail: cfg.url ? "موجود" : "غير مضبوط" },
      { label: "Anon Key", ok: Boolean(cfg.anonKey), detail: cfg.anonKey ? "موجود" : "غير مضبوط" },
      { label: "Strict Mode", ok: cfg.strict !== false, detail: cfg.strict !== false ? "strict" : "fallback" },
      { label: "Patch 040", ok: true, detail: "040_runtime_alignment_fix.sql" },
    ];
    return { mode: shouldUseSupabase() ? "supabase-configured" : "local-fallback", checks, recommended: "شغّل RUN_IN_SUPABASE_SQL_EDITOR.sql ثم انشر Edge Functions وخاصة send-push-notifications." };
  },
  endOfDayReport: async (body = {}) => {
    const date = body.date || now().slice(0, 10);
    const [employees, daily] = await Promise.all([supabaseEndpoints.employees().catch(() => []), supabaseEndpoints.attendanceDaily().catch(() => [])]);
    const rows = daily.filter((row) => String(row.date || "").slice(0, 10) === date);
    return { date, generatedAt: now(), totals: { employees: employees.length, present: rows.filter((row) => ["PRESENT", "LATE"].includes(row.status)).length, absent: Math.max(0, employees.length - rows.length), late: rows.filter((row) => row.status === "LATE").length }, rows };
  },
  executivePdfReportData: async (body = {}) => supabaseEndpoints.endOfDayReport(body),
  employeeArchive: async (employeeId) => {
    const [employee, attendance, leaves, missions, kpiRows, disputes, docs] = await Promise.all([
      employeeById(employeeId),
      supabaseEndpoints.attendanceEvents({ employeeId, limit: 20000 }).catch(() => []),
      supabaseEndpoints.leaves().catch(() => []),
      supabaseEndpoints.missions().catch(() => []),
      tableRows("kpi_evaluations", "updated_at", false).then(toCamel).catch(() => []),
      supabaseEndpoints.disputes().catch(() => []),
      supabaseEndpoints.employeeDocuments({ employeeId }).catch(() => []),
    ]);
    return { employee, attendance, leaves: leaves.filter((row) => row.employeeId === employeeId), missions: missions.filter((row) => row.employeeId === employeeId), kpi: kpiRows.filter((row) => row.employeeId === employeeId), disputes: disputes.filter((row) => row.employeeId === employeeId), documents: docs };
  },
  myActionCenter: async () => {
    const user = await currentUser().catch(() => null);
    const employeeId = user?.employeeId || user?.employee?.id || "";
    const [notifications, tasks, docs, liveRequests] = await Promise.all([
      supabaseEndpoints.notifications().catch(() => []),
      supabaseEndpoints.myTasks().catch(() => []),
      supabaseEndpoints.myDocuments().catch(() => []),
      supabaseEndpoints.myLiveLocationRequests().catch(() => []),
    ]);
    const notes = notifications.filter((note) => (!note.employeeId || note.employeeId === employeeId || note.userId === user?.id) && !note.isRead).slice(0, 20);
    const actions = [
      ...liveRequests.filter((item) => item.employeeId === employeeId && item.status === "PENDING").map((item) => ({ id: item.id, type: "LIVE_LOCATION", title: "طلب موقع مباشر", body: item.reason || "الإدارة تطلب موقعك الحالي", route: "location", severity: "HIGH" })),
      ...tasks.filter((task) => !["DONE", "CLOSED", "CANCELLED"].includes(task.status)).slice(0, 10).map((task) => ({ id: task.id, type: "TASK", title: task.title, body: task.description || "مهمة مفتوحة", route: "tasks", severity: task.priority || "MEDIUM" })),
      ...docs.filter((doc) => ["EXPIRING_SOON", "EXPIRED", "MISSING", "REQUIRED"].includes(doc.status)).map((doc) => ({ id: doc.id, type: "DOCUMENT", title: "مستند يحتاج متابعة: " + doc.title, body: doc.notes || doc.status, route: "documents", severity: "MEDIUM" })),
      ...notes.map((note) => ({ id: note.id, type: "NOTIFICATION", title: note.title, body: note.body || "إشعار جديد", route: "notifications", severity: note.type || "LOW" })),
    ];
    return { actions, tasks, documents: docs, notifications: notes, liveRequests, generatedAt: now() };
  },
  reset: async () => ({ ok: true, message: "إعادة الضبط في Supabase تتم من SQL Editor أو عبر حذف بيانات الجداول." }),
};


// 094: live binding between HR, employee mobile, managers, committee, and executive views.
Object.assign(supabaseEndpoints, {
  mobilePortalAlignment: async () => {
    const [employees, users, roles, quality, devices] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.users?.().catch(() => []),
      supabaseEndpoints.roles?.().catch(() => []),
      supabaseEndpoints.qualityCenter?.().catch(() => ({ readiness: { issues: [] } })),
      supabaseEndpoints.deviceCenter?.().catch(() => ({ rows: [] })),
    ]);
    const roleOf = (item = {}) => String(item.role || item.userRole || item.appRole || item.roleName || item.permissions?.__role || '').toUpperCase();
    const usersByEmployee = new Map((users || []).map((u) => [u.employeeId || u.employee_id, u]));
    const managers = (employees || []).filter((e) => (employees || []).some((x) => x.managerId === e.id || x.manager_id === e.id) || /MANAGER|DIRECT|EXECUTIVE|HR/.test(roleOf(usersByEmployee.get(e.id) || e)));
    const committee = (employees || []).filter((e) => /DISPUTE|COMMITTEE|HR|EXECUTIVE|SECRETARY|TECH/.test(roleOf(usersByEmployee.get(e.id) || e)) || e.disputeCommittee === true || e.isDisputeCommittee === true);
    const deviceRows = devices.rows || [];
    const deviceByEmployee = new Map(deviceRows.map((row) => [row.employee?.id || row.employeeId, row]));
    const rows = (employees || []).map((employee) => {
      const user = usersByEmployee.get(employee.id) || null;
      const device = deviceByEmployee.get(employee.id) || {};
      const teamCount = (employees || []).filter((x) => x.managerId === employee.id || x.manager_id === employee.id).length;
      const issues = [];
      if (!user) issues.push('NO_LOGIN_ACCOUNT');
      if (!employee.phone) issues.push('NO_PHONE');
      if (teamCount && !/MANAGER|EXECUTIVE|HR/.test(roleOf(user || employee))) issues.push('MANAGER_ROLE_NEEDS_REVIEW');
      if (!device.activePush) issues.push('PUSH_NOT_ENABLED');
      return { employee, user, teamCount, isManager: teamCount > 0, isCommittee: committee.some((c) => c.id === employee.id), deviceStatus: device.deviceStatus || 'UNKNOWN', activePush: device.activePush || 0, issues };
    });
    return { rows, managers, committee, roles, qualityIssues: quality.readiness?.issues || [], generatedAt: now() };
  },

  managerMobileHub: async () => {
    const user = await currentUser().catch(() => null);
    const employeeId = user?.employeeId || user?.employee?.id || '';
    const [employees, leaves, missions, kpiRows, notifications] = await Promise.all([
      supabaseEndpoints.employees().catch(() => []),
      supabaseEndpoints.leaves?.().catch(() => []),
      supabaseEndpoints.missions?.().catch(() => []),
      maybeTableRows('kpi_evaluations', 'updated_at', false).then(toCamel).catch(() => []),
      supabaseEndpoints.notifications?.().catch(() => []),
    ]);
    const team = (employees || []).filter((e) => e.managerId === employeeId || e.managerEmployeeId === employeeId || e.directManagerId === employeeId || e.manager_id === employeeId || e.manager_employee_id === employeeId);
    const ids = new Set(team.map((e) => e.id));
    const pendingLeaves = (leaves || []).filter((r) => ids.has(r.employeeId || r.employee_id) && ['PENDING','MANAGER_REVIEW','SUBMITTED'].includes(String(r.status || '').toUpperCase()));
    const pendingMissions = (missions || []).filter((r) => ids.has(r.employeeId || r.employee_id) && ['PENDING','MANAGER_REVIEW','SUBMITTED'].includes(String(r.status || '').toUpperCase()));
    const kpiPending = (kpiRows || []).filter((r) => ids.has(r.employeeId || r.employee_id) && ['SELF_SUBMITTED','EMPLOYEE_SUBMITTED'].includes(String(r.status || '').toUpperCase())).map((r) => ({ ...r, employee: (employees || []).find((e) => e.id === (r.employeeId || r.employee_id)) || null }));
    const unread = (notifications || []).filter((n) => !n.isRead && !n.is_read).slice(0, 20);
    return { manager: user?.employee || null, team, pendingLeaves, pendingMissions, kpiPending, notifications: unread, totals: { team: team.length, pendingLeaves: pendingLeaves.length, pendingMissions: pendingMissions.length, kpiPending: kpiPending.length }, generatedAt: now() };
  },

  committeeMobileHub: async () => {
    const user = await currentUser().catch(() => null);
    const employeeId = user?.employeeId || user?.employee?.id || '';
    const [disputes, notifications] = await Promise.all([
      supabaseEndpoints.disputes?.().catch(() => []),
      supabaseEndpoints.notifications?.().catch(() => []),
    ]);
    const visible = (disputes || []).filter((d) => {
      const members = d.committeeMemberIds || d.committee_member_ids || d.assignedEmployeeIds || [];
      const status = String(d.status || '').toUpperCase();
      return members.includes?.(employeeId) || ['NEW','OPEN','ESCALATED','COMMITTEE_REVIEW','PENDING'].includes(status) || d.employeeId === employeeId || d.createdByEmployeeId === employeeId;
    });
    const urgent = visible.filter((d) => ['NEW','ESCALATED','HIGH','URGENT'].includes(String(d.priority || d.status || '').toUpperCase()));
    const notes = (notifications || []).filter((n) => String(n.route || '').includes('dispute') || String(n.type || '').includes('DISPUTE')).slice(0, 20);
    return { rows: visible, urgent, notifications: notes, totals: { total: visible.length, urgent: urgent.length, open: visible.filter((d) => !['CLOSED','RESOLVED','CANCELLED'].includes(String(d.status || '').toUpperCase())).length }, generatedAt: now() };
  },

  workflowAutomationCenter: async () => {
    const [alignment, notificationCenter, locationCenter, quality] = await Promise.all([
      supabaseEndpoints.mobilePortalAlignment().catch(() => ({ rows: [] })),
      supabaseEndpoints.notificationCenter?.().catch(() => ({ unread: [], notPushReady: [] })),
      supabaseEndpoints.locationMonitoringCenter?.().catch(() => ({ pendingRequests: [], weakAccuracy: [] })),
      supabaseEndpoints.qualityCenter?.().catch(() => ({ readiness: { issues: [] } })),
    ]);
    const urgentFixes = [];
    (alignment.rows || []).forEach((row) => row.issues?.forEach((code) => urgentFixes.push({ code, employee: row.employee, route: 'mobile-alignment', title: code === 'PUSH_NOT_ENABLED' ? 'Push غير مفعل' : 'مشكلة ربط مستخدم' })));
    (locationCenter.pendingRequests || []).slice(0, 20).forEach((req) => urgentFixes.push({ code: 'PENDING_LOCATION_REQUEST', title: 'طلب موقع لم يتم الرد عليه', request: req, route: 'locations' }));
    (quality.readiness?.issues || []).slice(0, 20).forEach((issue) => urgentFixes.push({ code: issue.code || 'QUALITY', title: issue.title || issue.label || 'مشكلة جودة بيانات', route: issue.route || 'quality-center', issue }));
    return { alignment, notificationCenter, locationCenter, quality, urgentFixes, totals: { urgentFixes: urgentFixes.length, managers: alignment.managers?.length || 0, committee: alignment.committee?.length || 0 }, generatedAt: now() };
  },

  createWorkflowAutomationAlerts: async () => {
    const client = await sb();
    const center = await supabaseEndpoints.workflowAutomationCenter();
    const rows = (center.urgentFixes || []).slice(0, 50).map((item) => ({
      employeeId: item.employee?.id || item.request?.employeeId || null,
      title: item.title || 'مطلوب متابعة تشغيلية',
      body: item.code || 'راجع مركز الربط والتشغيل',
      type: item.code?.includes('PUSH') ? 'PUSH_SETUP' : 'WORKFLOW_ALERT',
      route: item.route || 'action-center',
      data: { code: item.code || 'WORKFLOW_ALERT' },
    }));
    const created = await safeCreateNotifications(client, rows, { block: false });
    try { await client.functions.invoke('send-push-notifications', { body: { reason: 'workflow-automation-094', notifications: rows } }); } catch (error) { debugWarn('workflow push dispatch skipped', error?.message || error); }
    return { ok: true, created: created.created || rows.length, generatedAt: now() };
  },
});

export async function subscribeSupabaseRealtime(onChange) {
  if (!shouldUseSupabase()) return () => {};
  const client = await sb();
  realtimeChannels.forEach((channel) => client.removeChannel(channel));
  realtimeChannels = ["attendance_events", "employee_locations", "leave_requests", "missions", "kpi_evaluations", "employee_policies", "policy_acknowledgements", "workflow_escalations", "daily_reports", "smart_alerts", "sensitive_approvals"].map((table) => client.channel(`hr-${table}`).on("postgres_changes", { event: "*", schema: "public", table }, (payload) => onChange?.(table, payload)).subscribe());
  return () => realtimeChannels.forEach((channel) => client.removeChannel(channel));
}
