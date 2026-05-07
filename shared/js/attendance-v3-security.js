// Attendance Identity Guard V3
// Adds policy acknowledgement, HR-approved devices, branch QR challenge, anti-GPS-spoofing signals,
// browser install id, and fallback attendance request helpers.

const POLICY_VERSION = "attendance-identity-v3";
const BROWSER_INSTALL_KEY = "hr.identity.browserInstallId.v3";
const QR_REQUIRED_KEY = "hr.identity.branchQr.required";

async function sha256Text(text = "") {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uuidLike() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getBrowserInstallId() {
  let value = "";
  try { value = localStorage.getItem(BROWSER_INSTALL_KEY) || ""; } catch { value = ""; }
  if (!value) {
    value = uuidLike();
    try { localStorage.setItem(BROWSER_INSTALL_KEY, value); } catch {}
  }
  return value;
}

function htmlEscape(value = "") {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[ch]));
}

export async function ensureAttendancePolicyAcknowledged({ endpoints, employee, deviceFingerprintHash = "" } = {}) {
  const employeeId = employee?.id || "";
  const key = `hr.identity.policy.${POLICY_VERSION}.${employeeId}`;
  try { if (localStorage.getItem(key) === "1") return { acknowledged: true, policyVersion: POLICY_VERSION }; } catch {}
  const agreed = await new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "identity-policy-overlay";
    overlay.innerHTML = `
      <div class="identity-policy-panel" role="dialog" aria-modal="true" aria-label="إقرار سياسة الحضور">
        <h2>إقرار سياسة الحضور والبصمة</h2>
        <p>أقر أن تسجيل الحضور والانصراف يجب أن يتم بواسطتي شخصيًا ومن جهازي المعتمد فقط، وأن مشاركة الحساب أو الجهاز أو تسجيل بصمة لشخص آخر مخالفة إدارية.</p>
        <ul>
          <li>سيتم استخدام Passkey خاص بحسابي.</li>
          <li>سيتم التقاط سيلفي وموقع GPS عالي الدقة. تم إيقاف QR بالكامل في هذه النسخة.</li>
          <li>أي بصمة مشبوهة قد تتحول إلى مراجعة HR أو تصعيد إداري.</li>
        </ul>
        <div class="identity-selfie-actions">
          <button class="button primary" type="button" data-policy-accept>أوافق وأكمل</button>
          <button class="button ghost" type="button" data-policy-cancel>إلغاء</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-policy-accept]")?.addEventListener("click", () => { overlay.remove(); resolve(true); });
    overlay.querySelector("[data-policy-cancel]")?.addEventListener("click", () => { overlay.remove(); resolve(false); });
  });
  if (!agreed) throw new Error("يجب الموافقة على إقرار سياسة الحضور قبل تسجيل البصمة.");
  try { localStorage.setItem(key, "1"); } catch {}
  const browserInstallId = getBrowserInstallId();
  try {
    await endpoints?.acknowledgeAttendancePolicy?.({
      employeeId,
      policyVersion: POLICY_VERSION,
      deviceFingerprintHash,
      browserInstallId,
      userAgent: navigator.userAgent || "",
    });
  } catch (error) {
    console.warn("تعذر حفظ إقرار سياسة الحضور على الخادم؛ تم حفظه محليًا فقط", error);
  }
  return { acknowledged: true, policyVersion: POLICY_VERSION, browserInstallId };
}

export async function ensureTrustedDeviceApproval({ endpoints, employee, device = {}, selfieUrl = "", location = {} } = {}) {
  const employeeId = employee?.id || "";
  const flags = [];
  const deviceFingerprintHash = device.deviceFingerprintHash || "";
  const trustedDeviceId = device.trustedDeviceId || "";
  let status = "UNKNOWN";
  let requestId = "";
  try {
    const rows = await endpoints?.trustedDeviceApprovalRequests?.().then((r) => r?.data || r || []);
    const match = (rows || []).find((row) =>
      String(row.employeeId || row.employee_id || "") === String(employeeId) &&
      String(row.deviceFingerprintHash || row.device_fingerprint_hash || "") === String(deviceFingerprintHash)
    );
    status = String(match?.status || match?.approvalStatus || match?.approval_status || "").toUpperCase() || status;
  } catch {}
  if (!trustedDeviceId || !["APPROVED", "ACTIVE", "TRUSTED"].includes(status)) {
    flags.push("DEVICE_APPROVAL_REQUIRED");
    try {
      const response = await endpoints?.requestTrustedDeviceApproval?.({
        employeeId,
        deviceFingerprintHash,
        deviceName: navigator.platform || "Browser device",
        userAgent: navigator.userAgent || "",
        selfieUrl,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters ?? location.accuracy,
      });
      requestId = response?.id || response?.requestId || response || "";
    } catch (error) {
      console.warn("تعذر إرسال طلب اعتماد الجهاز", error);
      flags.push("DEVICE_APPROVAL_REQUEST_FAILED");
    }
  }
  return { status, requestId, riskFlags: flags, requiresReview: flags.length > 0 };
}

export function analyzeLocationTrust(location = {}, evaluation = {}) {
  const flags = [];
  const accuracy = Number(location.accuracyMeters ?? location.accuracy ?? 0);
  const speed = Number(location.speed ?? 0);
  const altitude = Number(location.altitude ?? 0);
  const ageMs = location.timestamp ? Math.abs(Date.now() - Number(location.timestamp)) : 0;
  if (accuracy && accuracy > 80) flags.push("GPS_ACCURACY_WEAK");
  if (accuracy && accuracy > 250) flags.push("GPS_ACCURACY_VERY_WEAK");
  if (speed && speed > 35) flags.push("GPS_SPEED_SUSPICIOUS");
  if (ageMs && ageMs > 120000) flags.push("GPS_READING_STALE");
  if (!window.isSecureContext) flags.push("INSECURE_CONTEXT");
  if (String(evaluation.geofenceStatus || "").toLowerCase().includes("outside")) flags.push("OUTSIDE_GEOFENCE_V3");
  return {
    accuracyMeters: accuracy || null,
    speed: speed || null,
    altitude: altitude || null,
    readingAgeMs: ageMs || null,
    flags,
    isMockSuspected: flags.some((flag) => ["GPS_SPEED_SUSPICIOUS", "GPS_READING_STALE", "GPS_ACCURACY_VERY_WEAK"].includes(flag)),
  };
}

async function scanQrWithCamera() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return "";
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); } catch { return ""; }
  return await new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "identity-selfie-overlay";
    overlay.innerHTML = `
      <div class="identity-selfie-panel" role="dialog" aria-modal="true" aria-label="مسح QR الفرع">
        <h2>مسح QR الفرع</h2>
        <p>وجه الكاميرا إلى كود QR الظاهر داخل الفرع.</p>
        <video autoplay playsinline muted></video>
        <div class="identity-selfie-actions"><button class="button ghost" type="button" data-qr-cancel>إلغاء</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector("video");
    video.srcObject = stream;
    let stopped = false;
    const stop = (value = "") => {
      if (stopped) return;
      stopped = true;
      try { stream?.getTracks?.().forEach((track) => track.stop()); } catch {}
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector("[data-qr-cancel]")?.addEventListener("click", () => stop(""));
    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes?.[0]?.rawValue) return stop(codes[0].rawValue);
      } catch {}
      requestAnimationFrame(loop);
    };
    setTimeout(() => stop(""), 20000);
    video.addEventListener("loadeddata", loop, { once: true });
  });
}

export async function requestBranchQrChallenge({ endpoints, branchId = "", required = false } = {}) {
  // QR is intentionally disabled for this deployment. Keep the function as a no-op
  // so older callers and database columns remain compatible without showing QR UI.
  return { valid: true, status: "DISABLED", challengeId: "", riskFlags: ["BRANCH_QR_DISABLED"], requiresReview: false };

  const cfg = window.HR_SUPABASE_CONFIG || {};
  const qrGloballyDisabled = cfg?.attendance?.qrRequired === false || window.HR_QR_REQUIRED === false;
  if (qrGloballyDisabled) {
    return { valid: true, status: "DISABLED", challengeId: "", riskFlags: [], requiresReview: false };
  }
  const qrRequired = required || localStorage.getItem(QR_REQUIRED_KEY) === "1";
  let code = await scanQrWithCamera();
  if (!code) {
    code = await new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "identity-policy-overlay";
      overlay.innerHTML = `
        <div class="identity-policy-panel" role="dialog" aria-modal="true" aria-label="كود QR الفرع">
          <h2>كود QR الفرع</h2>
          <p>أدخل الكود الموجود داخل الفرع. إذا لم يكن متاحًا، ستتحول البصمة للمراجعة بدل الاعتماد المباشر.</p>
          <input class="input" data-qr-code placeholder="مثال: A1B2C3D4" autocomplete="one-time-code" />
          <div class="identity-selfie-actions">
            <button class="button primary" type="button" data-qr-confirm>تأكيد الكود</button>
            <button class="button ghost" type="button" data-qr-skip>غير متاح الآن</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-qr-confirm]")?.addEventListener("click", () => {
        const value = overlay.querySelector("[data-qr-code]")?.value || "";
        overlay.remove();
        resolve(value.trim());
      });
      overlay.querySelector("[data-qr-skip]")?.addEventListener("click", () => { overlay.remove(); resolve(""); });
    });
  }
  if (!code) {
    if (qrRequired) return { valid: false, status: "MISSING", riskFlags: ["BRANCH_QR_MISSING"], requiresReview: true };
    return { valid: false, status: "NOT_PROVIDED", riskFlags: ["BRANCH_QR_NOT_PROVIDED"], requiresReview: true };
  }
  try {
    const validation = await endpoints?.validateBranchQrChallenge?.({ branchId, code });
    const valid = Boolean(validation?.valid || validation?.data?.valid);
    return {
      valid,
      status: valid ? "VALID" : "INVALID_OR_EXPIRED",
      challengeId: validation?.challengeId || validation?.challenge_id || validation?.data?.challenge_id || "",
      riskFlags: valid ? [] : ["BRANCH_QR_INVALID"],
      requiresReview: !valid,
    };
  } catch (error) {
    console.warn("تعذر التحقق من QR الفرع", error);
    return { valid: false, status: "VALIDATION_FAILED", riskFlags: ["BRANCH_QR_VALIDATION_FAILED"], requiresReview: true };
  }
}

export function mergeRiskSignals(baseRisk = {}, ...signals) {
  const flags = new Set(baseRisk.riskFlags || []);
  let score = Number(baseRisk.riskScore || 0);
  let requiresReview = Boolean(baseRisk.requiresReview);
  for (const signal of signals) {
    for (const flag of signal?.riskFlags || signal?.flags || []) flags.add(flag);
    if (signal?.requiresReview) requiresReview = true;
  }
  const flagList = Array.from(flags);
  if (flagList.includes("DEVICE_APPROVAL_REQUIRED")) score = Math.max(score, 65);
  if (flagList.includes("BRANCH_QR_MISSING") || flagList.includes("BRANCH_QR_INVALID")) score = Math.max(score, 55);
  if (flagList.includes("GPS_SPEED_SUSPICIOUS") || flagList.includes("GPS_READING_STALE")) score = Math.max(score, 60);
  if (flagList.includes("GPS_ACCURACY_VERY_WEAK")) score = Math.max(score, 45);
  score = Math.min(100, score);
  const riskLevel = score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
  return { ...baseRisk, riskScore: score, riskLevel, riskFlags: flagList, requiresReview: requiresReview || score >= 35 };
}

export async function submitFallbackAttendanceRequest({ endpoints, employee, action = "checkIn", reason = "", location = {}, deviceFingerprintHash = "" } = {}) {
  try {
    await endpoints?.recordPunchRejection?.({
      employeeId: employee?.id || "",
      action,
      ...location,
      geofenceStatus: "FALLBACK_REQUESTED",
      blockReason: reason || "تعذر إكمال تحقق الهوية؛ تم إرسال طلب حضور احتياطي.",
      notes: "حضور احتياطي يحتاج مراجعة HR",
      deviceFingerprintHash,
      riskScore: 80,
      riskLevel: "HIGH",
      riskFlags: ["FALLBACK_ATTENDANCE_REQUEST"],
    });
    return { ok: true };
  } catch (error) {
    console.warn("تعذر تسجيل طلب الحضور الاحتياطي", error);
    return { ok: false, error };
  }
}

export function describeIdentityFlags(flags = []) {
  const labels = {
    DEVICE_APPROVAL_REQUIRED: "الجهاز يحتاج اعتماد HR",
    BRANCH_QR_DISABLED: "QR متوقف في هذه النسخة",
    BRANCH_QR_MISSING: "QR متوقف ولا يتم طلبه",
    BRANCH_QR_INVALID: "QR متوقف ولا يتم التحقق منه",
    GPS_ACCURACY_WEAK: "دقة GPS ضعيفة",
    GPS_ACCURACY_VERY_WEAK: "دقة GPS ضعيفة جدًا",
    GPS_SPEED_SUSPICIOUS: "سرعة انتقال GPS غير منطقية",
    GPS_READING_STALE: "قراءة GPS قديمة",
    BROWSER_SHARED_ACCOUNTS: "نفس المتصفح استخدم أكثر من حساب",
    FALLBACK_ATTENDANCE_REQUEST: "طلب حضور احتياطي",
  };
  return flags.map((flag) => labels[flag] || htmlEscape(flag));
}
