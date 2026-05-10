/* push.js — Web Push Subscription — v103 hardened */
export function webPushSupported() {
  return Boolean("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
}

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = `${base64Url}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function sameBytes(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.every((v, i) => v === b[i]);
}

function publicVapidKey() {
  return String(window.HR_SUPABASE_CONFIG?.push?.vapidPublicKey || "").trim();
}

/* ── Permission explanation dialog ── */
function explainPushPermission() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop push-explain-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "تفعيل الإشعارات");
    overlay.innerHTML = `
      <div class="confirm-modal push-explain-modal">
        <div class="push-explain-icon">🔔</div>
        <div class="panel-head">
          <div>
            <h2>تفعيل الإشعارات</h2>
            <p>سيتم طلب إذن المتصفح لإرسال تنبيهات العمل المهمة على هذا الجهاز.</p>
          </div>
        </div>
        <ul class="push-explain-list">
          <li>📍 طلبات الموقع المباشر العاجلة</li>
          <li>📋 الموافقة على طلباتك أو رفضها</li>
          <li>⚠️ تنبيهات غياب أو تأخير</li>
          <li>✅ مهام جديدة مكلف بها</li>
        </ul>
        <div class="form-actions">
          <button class="button ghost" type="button" data-cancel>لاحقاً</button>
          <button class="button primary" type="button" data-confirm>تفعيل الإشعارات</button>
        </div>
      </div>
    `;
    const cleanup = (answer) => { overlay.remove(); resolve(answer); };
    overlay.querySelector("[data-cancel]").addEventListener("click", () => cleanup(false));
    overlay.querySelector("[data-confirm]").addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
    document.body.appendChild(overlay);
    /* Auto-focus confirm button for accessibility */
    requestAnimationFrame(() => overlay.querySelector("[data-confirm]")?.focus());
  });
}

/* ── Subscribe with retry on stale subscription ── */
export async function enableWebPushSubscription(endpoints) {
  if (!webPushSupported()) {
    throw new Error("هذا المتصفح لا يدعم إشعارات Web Push الحقيقية.");
  }

  /* Check if already denied — give clear guidance */
  if (Notification.permission === "denied") {
    throw new Error(
      "الإشعارات محظورة في إعدادات المتصفح. افتح إعدادات المتصفح → الإشعارات وأزل الحظر عن هذا الموقع."
    );
  }

  const accepted = await explainPushPermission();
  if (!accepted) throw new Error("تم تأجيل تفعيل الإشعارات.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "تم رفض الإشعارات. يمكنك تفعيلها لاحقاً من إعدادات المتصفح."
        : "لم يتم السماح بالإشعارات."
    );
  }

  const vapidPublicKey = publicVapidKey();
  if (!vapidPublicKey) {
    throw new Error(
      "أضف VAPID public key داخل shared/js/supabase-config.js لتفعيل إشعارات Web Push."
    );
  }

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = base64UrlToUint8Array(vapidPublicKey);

  /* Get or create subscription — unsubscribe stale key */
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription?.options?.applicationServerKey &&
    !sameBytes(subscription.options.applicationServerKey, applicationServerKey)
  ) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (err) {
      /* Retry once after clearing old subscription */
      await registration.pushManager.getSubscription()
        .then((s) => s?.unsubscribe())
        .catch(() => {});
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
  }

  const payload = subscription.toJSON ? subscription.toJSON() : { endpoint: subscription.endpoint };
  const result = await endpoints.subscribePush({
    ...payload,
    endpoint: subscription.endpoint,
    permission,
    userAgent: navigator.userAgent,
    platform: navigator.platform || "browser",
    screenSize: `${screen.width}x${screen.height}`,
    createdAt: new Date().toISOString(),
  });
  return result;
}

/* ── Check current push status ── */
export async function getPushStatus() {
  if (!webPushSupported()) return { supported: false, permission: "unsupported", subscribed: false };
  const permission = Notification.permission;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return { supported: true, permission, subscribed: Boolean(subscription), endpoint: subscription?.endpoint };
  } catch {
    return { supported: true, permission, subscribed: false };
  }
}

/* ── Unsubscribe from push ── */
export async function disableWebPushSubscription() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}
