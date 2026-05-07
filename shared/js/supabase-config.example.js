// Production-safe Supabase config example. Copy to shared/js/supabase-config.js for deployment.
// Do not put service_role keys in browser files.
// Local/production Supabase configuration.
// IMPORTANT:
// - Never put service_role keys in browser files.
// - Fill url + anonKey after rotating any previously exposed keys.
// - Keep enabled=true only after the real Supabase project is migrated and Edge Functions are deployed.
window.HR_SUPABASE_CONFIG = Object.freeze({
  enabled: true,
  strict: true,
  projectId: "your-production-project",
  projectRef: "your-project-ref",
  url: "https://your-project-ref.supabase.co",
  anonKey: "your-rotated-publishable-or-anon-key",
  storage: {
    avatarsBucket: "avatars",
    punchSelfiesBucket: "punch-selfies",
    attachmentsBucket: "employee-attachments",
  },
  realtime: {
    enabled: true,
  },
  security: {
    allowLocalFallback: false,
    requireStrongPasswords: true,
    attachmentSignedUrlSeconds: 3600,
  },
  push: {
    // مطلوب لتفعيل Web Push الحقيقي. اتركه فارغًا حتى تولد VAPID keys وتضيف المفتاح العام هنا.
    vapidPublicKey: "",
  },
  cacheVersion: "v31-production-hardening-089",
});

window.__HR_SUPABASE_CONFIG_LOADED__ = true;
window.__HR_SUPABASE_CONFIG_VERSION__ = "full-workflow-live-20260504";

(function showSupabaseModeBanner() {
  const cfg = window.HR_SUPABASE_CONFIG || {};
  const configured = Boolean(cfg.enabled === true && /^https:\/\/[^\s]+\.supabase\.co$/.test(String(cfg.url || "")) && String(cfg.anonKey || "").length > 20);
  if (configured) {
    document.documentElement.dataset.supabaseMode = "enabled";
    return;
  }
  document.documentElement.dataset.supabaseMode = "local";
  const render = () => {
    if (document.getElementById("supabase-mode-banner")) return;
    const banner = document.createElement("div");
    banner.id = "supabase-mode-banner";
    banner.setAttribute("role", "status");
    banner.style.cssText = "position:sticky;top:0;z-index:99999;background:#f59e0b;color:#1c1917;padding:10px 14px;text-align:center;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.25)";
    banner.textContent = "وضع محلي احتياطي: Supabase غير مكتمل الإعداد. في نسخة الإنتاج تم تعطيل التشغيل المحلي الاحتياطي، ولن تُستخدم البيانات المحلية إلا إذا كانت الإعدادات غير صالحة وبشكل تحذيري فقط.";
    document.body.prepend(banner);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();
