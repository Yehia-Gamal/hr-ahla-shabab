// V9 frontend hardening helpers: onboarding, push explainer, image compression, and polling guard.
(function () {
  const NS = (window.HRV9 = window.HRV9 || {});

  NS.shouldShowOnboarding = function shouldShowOnboarding(profile = {}) {
    return Boolean(profile.must_change_password || profile.temporary_password || profile.needs_onboarding);
  };

  NS.showPushPermissionExplainer = async function showPushPermissionExplainer() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    const ok = window.confirm ? window.confirm('تفعيل الإشعارات يساعدك على استقبال طلبات الموقع وتذكيرات البصمة والقرارات الإدارية. هل تريد المتابعة؟') : true;
    if (!ok) return 'denied-by-user';
    return await Notification.requestPermission();
  };

  NS.createVisibilityAwarePolling = function createVisibilityAwarePolling(callback, activeMs = 60000, hiddenMs = 180000) {
    let timer = null;
    const start = () => {
      stop();
      timer = setInterval(callback, document.hidden ? hiddenMs : activeMs);
    };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { start(); } else { start(); callback?.(); }
    });
    start();
    return { start, stop };
  };

  NS.compressImage = async function compressImage(file, maxSize = 1280, quality = 0.82) {
    if (!file || !file.type?.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: Date.now() });
  };
})();
