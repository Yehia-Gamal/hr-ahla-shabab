// Attendance identity verification helpers
// This module reduces shared-device abuse by binding punch attempts to:
// 1) employee passkey, 2) a stable browser/device fingerprint, 3) a live selfie, and 4) a risk score.

const SHARED_DEVICE_WINDOW_MS = 30 * 60 * 1000;
const SELFIE_MAX_PX = 720;
const SELFIE_QUALITY = 0.78;

function base64UrlToBuffer(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Text(text = "") {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getDeviceFingerprintHash() {
  const parts = [
    navigator.userAgent || "",
    navigator.platform || "",
    navigator.language || "",
    String(navigator.hardwareConcurrency || ""),
    String(navigator.deviceMemory || ""),
    `${screen?.width || 0}x${screen?.height || 0}x${screen?.colorDepth || 0}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ];
  return sha256Text(parts.join("|"));
}

export function filterEmployeePasskeys(passkeys = [], user = {}, employee = {}) {
  const userId = user?.id || "";
  const employeeId = employee?.id || user?.employeeId || user?.employee?.id || "";
  return (passkeys || [])
    .filter((item) => item?.credentialId)
    .filter((item) => {
      const sameUser = !item.userId || !userId || String(item.userId) === String(userId);
      const sameEmployee = !item.employeeId || !employeeId || String(item.employeeId) === String(employeeId);
      return sameUser && sameEmployee && item.trusted !== false && !["DISABLED", "REVOKED"].includes(String(item.status || "").toUpperCase());
    });
}

export async function requestEmployeePasskey({ endpoints, user, employee, label = "تأكيد العملية" }) {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error(`${label}: بصمة الجهاز/Passkey غير مدعومة هنا. افتح التطبيق من HTTPS وموبايل يدعم البصمة.`);
  }
  const deviceFingerprintHash = await getDeviceFingerprintHash();
  const passkeys = await endpoints.passkeyStatus().then((rows) => rows?.data || rows || []).catch(() => []);
  const allowed = filterEmployeePasskeys(passkeys, user, employee);
  if (!allowed.length) {
    throw new Error("لا توجد بصمة جهاز موثوقة لهذا الموظف. سجّل/اعتمد الجهاز أولاً من زر تسجيل بصمة الجهاز أو من HR.");
  }
  const allowCredentials = allowed.map((item) => ({ id: base64UrlToBuffer(item.credentialId), type: "public-key" }));
  let credential = null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials,
        timeout: 60000,
        userVerification: "required",
      },
    });
  } catch {
    throw new Error(`${label}: تم إلغاء أو رفض بصمة الجهاز، أو أن مفتاح المرور لا يخص هذا الموظف.`);
  }
  if (!credential?.rawId) throw new Error("لم يتم استلام تأكيد البصمة.");
  const credentialId = bufferToBase64Url(credential.rawId);
  const matched = allowed.find((item) => String(item.credentialId) === credentialId) || null;
  const riskFlags = [];
  if (!matched) riskFlags.push("PASSKEY_NOT_IN_EMPLOYEE_ALLOWLIST");
  if (matched?.deviceFingerprintHash && matched.deviceFingerprintHash !== deviceFingerprintHash) riskFlags.push("DEVICE_FINGERPRINT_CHANGED");
  return {
    credentialId,
    passkeyCredentialId: credentialId,
    trustedDeviceId: matched?.id || "",
    deviceFingerprintHash,
    passkeyUserVerified: true,
    deviceRiskFlags: riskFlags,
  };
}

function stopStream(stream) {
  try { stream?.getTracks?.().forEach((track) => track.stop()); } catch {}
}

export async function requestPunchCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "CAMERA_UNAVAILABLE", message: "الكاميرا غير متاحة على هذا الجهاز." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false,
    });
    return { ok: true, stream };
  } catch {
    return {
      ok: false,
      reason: "CAMERA_DENIED",
      message: "لم يتم السماح بالكاميرا. افتح إعدادات الموقع من المتصفح واسمح بالكاميرا ثم حاول مرة أخرى.",
    };
  }
}

async function blobFromVideo(video) {
  const sourceWidth = video.videoWidth || 720;
  const sourceHeight = video.videoHeight || 720;
  const scale = Math.min(1, SELFIE_MAX_PX / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", SELFIE_QUALITY));
}

export async function capturePunchSelfie({ endpoints = null, employeeId = "", employeeName = "الموظف", stream: providedStream = null } = {}) {
  const camera = providedStream ? { ok: true, stream: providedStream } : await requestPunchCameraStream();
  if (!camera.ok) return camera;
  const stream = camera.stream;
  return await new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "identity-selfie-overlay";
    overlay.innerHTML = `
      <div class="identity-selfie-panel" role="dialog" aria-modal="true" aria-label="سيلفي البصمة">
        <h2>تأكيد هوية ${employeeName}</h2>
        <p>التقط صورة سيلفي واضحة الآن. ستُستخدم للمراجعة ومنع تسجيل موظف عن موظف آخر.</p>
        <video autoplay playsinline muted></video>
        <div class="identity-selfie-actions">
          <button class="button primary" type="button" data-selfie-capture>التقاط السيلفي</button>
          <button class="button ghost" type="button" data-selfie-cancel>إلغاء</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector("video");
    video.srcObject = stream;
    overlay.querySelector("[data-selfie-cancel]").addEventListener("click", () => {
      stopStream(stream);
      overlay.remove();
      resolve({ ok: false, reason: "SELFIE_CANCELLED", message: "تم إلغاء السيلفي." });
    });
    overlay.querySelector("[data-selfie-capture]").addEventListener("click", async () => {
      const blob = await blobFromVideo(video);
      stopStream(stream);
      overlay.remove();
      if (!blob) return resolve({ ok: false, reason: "SELFIE_CAPTURE_FAILED", message: "تعذر التقاط صورة السيلفي." });
      const file = new File([blob], `punch-selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
      let upload = {};
      if (endpoints?.uploadPunchSelfie) {
        try { upload = await endpoints.uploadPunchSelfie({ employeeId, file }).then((rows) => rows?.data || rows || {}); }
        catch (error) { return resolve({ ok: false, reason: "SELFIE_UPLOAD_FAILED", message: error?.message || "تعذر رفع صورة التحقق.", file }); }
      }
      resolve({ ok: true, file, capturedAt: new Date().toISOString(), selfieUrl: upload.url || upload.selfieUrl || "" });
    });
  });
}

export function getRecentSharedDeviceFlags(deviceFingerprintHash, employeeId) {
  if (!deviceFingerprintHash || !employeeId) return [];
  const key = `hr.identity.device.${deviceFingerprintHash}.recentPunches`;
  const now = Date.now();
  let rows = [];
  try { rows = JSON.parse(localStorage.getItem(key) || "[]"); } catch { rows = []; }
  rows = rows.filter((row) => now - Number(row.at || 0) < SHARED_DEVICE_WINDOW_MS);
  const otherEmployees = new Set(rows.filter((row) => String(row.employeeId) !== String(employeeId)).map((row) => String(row.employeeId)));
  return otherEmployees.size ? ["SHARED_DEVICE_RECENT"] : [];
}

export function rememberDevicePunch(deviceFingerprintHash, employeeId) {
  if (!deviceFingerprintHash || !employeeId) return;
  const key = `hr.identity.device.${deviceFingerprintHash}.recentPunches`;
  const now = Date.now();
  let rows = [];
  try { rows = JSON.parse(localStorage.getItem(key) || "[]"); } catch { rows = []; }
  rows = rows.filter((row) => now - Number(row.at || 0) < SHARED_DEVICE_WINDOW_MS);
  rows.unshift({ employeeId, at: now });
  localStorage.setItem(key, JSON.stringify(rows.slice(0, 20)));
}

export function calculateAttendanceRisk({ employeeId, device = {}, selfie = {}, location = {}, evaluation = {} } = {}) {
  const flags = new Set([...(device.deviceRiskFlags || [])]);
  let score = 0;
  if (!device.passkeyCredentialId && !device.credentialId) { flags.add("MISSING_PASSKEY"); score += 45; }
  if (device.deviceRiskFlags?.includes("PASSKEY_NOT_IN_EMPLOYEE_ALLOWLIST")) score += 55;
  if (device.deviceRiskFlags?.includes("DEVICE_FINGERPRINT_CHANGED")) score += 25;
  for (const flag of getRecentSharedDeviceFlags(device.deviceFingerprintHash, employeeId)) { flags.add(flag); score += 60; }
  if (!selfie?.ok) { flags.add(selfie?.reason || "MISSING_SELFIE"); score += 30; }
  const accuracy = Number(location.accuracyMeters ?? location.accuracy ?? 0);
  if (accuracy && accuracy > 250) { flags.add("LOW_GPS_ACCURACY"); score += 20; }
  const status = String(evaluation.geofenceStatus || "").toLowerCase();
  if (status.includes("outside")) { flags.add("OUTSIDE_GEOFENCE"); score += 50; }
  if (status.includes("permission") || location.locationPermission !== "granted") { flags.add("GPS_PERMISSION_ISSUE"); score += 40; }
  score = Math.min(100, score);
  const riskLevel = score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
  return {
    riskScore: score,
    riskLevel,
    riskFlags: Array.from(flags),
    requiresReview: score >= 35 || Boolean(evaluation.requiresReview) || evaluation.canRecord === false,
  };
}
