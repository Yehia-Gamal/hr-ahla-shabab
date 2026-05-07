export function webPushSupported() {
  return Boolean("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
}

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = `${base64Url}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function sameBytes(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.every((value, index) => value === b[index]);
}

function publicVapidKey() {
  return String(window.HR_SUPABASE_CONFIG?.push?.vapidPublicKey || "").trim();
}

function explainPushPermission() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="confirm-modal">
        <div class="panel-head"><div><h2>تفعيل الإشعارات</h2><p>سنطلب إذن المتصفح لإرسال تنبيهات العمل المهمة على هذا الجهاز فقط.</p></div></div>
        <div class="form-actions">
          <button class="button ghost" type="button" data-cancel>لاحقاً</button>
          <button class="button primary" type="button" data-confirm>متابعة</button>
        </div>
      </div>
    `;
    const cleanup = (answer) => { overlay.remove(); resolve(answer); };
    overlay.querySelector("[data-cancel]").addEventListener("click", () => cleanup(false));
    overlay.querySelector("[data-confirm]").addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (event) => { if (event.target === overlay) cleanup(false); });
    document.body.appendChild(overlay);
  });
}

export async function enableWebPushSubscription(endpoints) {
  if (!webPushSupported()) throw new Error("هذا المتصفح لا يدعم إشعارات Web Push الحقيقية.");
  const accepted = await explainPushPermission();
  if (!accepted) throw new Error("لم يتم طلب إذن الإشعارات.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("لم يتم السماح بالإشعارات من المتصفح.");
  const vapidPublicKey = publicVapidKey();
  if (!vapidPublicKey) throw new Error("أضف VAPID public key داخل shared/js/supabase-config.js قبل تفعيل إشعارات Web Push الحقيقية.");
  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = base64UrlToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options?.applicationServerKey && !sameBytes(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  const payload = subscription.toJSON ? subscription.toJSON() : { endpoint: subscription.endpoint };
  const result = await endpoints.subscribePush({
    ...payload,
    endpoint: subscription.endpoint,
    permission,
    userAgent: navigator.userAgent,
    platform: navigator.platform || "browser",
    createdAt: new Date().toISOString(),
  });
  return result;
}
