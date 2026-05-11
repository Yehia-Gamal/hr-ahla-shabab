// Production Supabase configuration.
// IMPORTANT: This browser file may contain public values only (Supabase URL, anon/publishable key, VAPID public key).
// Never place service_role keys, DB passwords, GitHub tokens, VAPID private keys, or any server-only secret here.
window.HR_SUPABASE_CONFIG = Object.freeze({
  enabled: true,
  strict: true,
  projectId: "ahla-shabab-hr",
  projectRef: "yemradvxmwadlldnxtpz",
  url: "https://yemradvxmwadlldnxtpz.supabase.co",
  anonKey: "sb_publishable_zd51Cc4KSDbUzrQ53maaOw_NbjHC__T",
  storage: {
    avatarsBucket: "avatars",
    punchSelfiesBucket: "punch-selfies",
    attachmentsBucket: "employee-attachments",
  },
  realtime: {
    enabled: true,
    eventsPerSecond: 10,
  },
  push: {
    vapidPublicKey: "BFO13DLR--4dck34L6GN144yabyNosxX5ZndloXvrLHiGBInFXBrRpKSvLI8Suyy-i07br6cwxi274PPaoo2yfI",
    locationRequestUrgent: true,
    foregroundSound: true,
  },
  security: {
    allowLocalFallback: false,
    requireStrongPasswords: true,
    attachmentSignedUrlSeconds: 3600,
    blockInsecureGatewayDefaults: true,
  },
  attendance: {
    qrRequired: false,
    reminderInPageHour: 10,
    reminderPushHour: 10,
    reminderPushMinute: 0,
    gpsSamples: 18,
    gpsSampleWindowMs: 30000,
    gpsTargetAccuracyMeters: 15,
    gpsMaxAcceptableAccuracyMeters: 90,
    gpsSafetyBufferMeters: 50,
    gpsUncertainReviewOnly: true,
    branchLocation: {
      name: "مجمع أحلى شباب",
      area: "منيل شيحة - الجيزة",
      latitude: 29.95109939158933,
      longitude: 31.238741920853883,
      radiusMeters: 300,
      safetyBufferMeters: 50,
      maxAccuracyMeters: 90,
    },
  },
  gateways: {
    admin: {
      enabled: true,
      label: "بوابة HR / الإدارة",
      codeSha256: "73e5cf364e1b17e792dedd526fed5e7683179fcf44994bd69d55e0de719b9c43",
      allowedEmails: ["yahia.gamal.idh@gmail.com"],
      allowedPhones: ["01154869616", "01004045849", "01028403239"],
      allowedIdentifiers: ["yahia.gamal.idh@gmail.com", "01154869616", "01004045849", "01028403239"],
      target: "../admin/",
      sessionMinutes: 43200,
      maxAttempts: 5,
      lockMinutes: 15,
    },
    executive: {
      enabled: true,
      label: "بوابة المدير التنفيذي",
      codeSha256: "34022e6e00033b7b1a1b5347dc079e4a6254e7e10e8b3df5f04ffba6f47b7cd9",
      allowedEmails: ["yahia.gamal.idh@gmail.com"],
      allowedPhones: ["01154869616", "01004045849"],
      allowedIdentifiers: ["yahia.gamal.idh@gmail.com", "01154869616", "01004045849"],
      target: "../executive/",
      sessionMinutes: 43200,
      maxAttempts: 5,
      lockMinutes: 15,
    },
  },
  adminGateway: {
    enabled: true,
    sessionMinutes: 43200,
    maxAttempts: 5,
    lockMinutes: 15,
  },
  deployment: {
    expectedPatch: "110_consolidated_stable_full_audit",
    packageVersion: "v39-consolidated-stable-110",
    hardeningLevel: "production-clean-secure-gate-csp-pwa",
  },
  cacheVersion: "v39-consolidated-stable-110",
});

window.__HR_SUPABASE_CONFIG_LOADED__ = true;
window.__HR_SUPABASE_CONFIG_VERSION__ = "v39-consolidated-stable-110";

(function markSupabaseMode() {
  const cfg = window.HR_SUPABASE_CONFIG || {};
  const configured = Boolean(cfg.enabled === true && /^https:\/\/[^\s]+\.supabase\.co$/.test(String(cfg.url || "")) && String(cfg.anonKey || "").length > 20);
  document.documentElement.dataset.supabaseMode = configured ? "enabled" : "local";
})();
