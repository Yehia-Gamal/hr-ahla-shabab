/* ═══════════════════════════════════════════════════════════════
   HR v104 — UX Enhancements: Connectivity, Count-up, Ripple
   ═══════════════════════════════════════════════════════════════ */
(function v104UX() {
  'use strict';

  /* ── Offline / Online Banners ── */
  let offlineBanner = null;
  let onlineTimer = null;

  function createBanner(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  function showOfflineBanner() {
    if (offlineBanner) return;
    offlineBanner = createBanner('offline-banner', '⚡ لا يوجد اتصال بالإنترنت — يتم العمل بالوضع المحلي');
    document.body.appendChild(offlineBanner);
  }

  function hideOfflineBanner() {
    if (offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
  }

  function showOnlineBanner() {
    clearTimeout(onlineTimer);
    document.querySelectorAll('.online-restored-banner').forEach((el) => el.remove());
    const banner = createBanner('online-restored-banner', '✅ تم استعادة الاتصال بالإنترنت');
    document.body.appendChild(banner);
    onlineTimer = setTimeout(() => banner.remove(), 3500);
  }

  if (!navigator.onLine) showOfflineBanner();

  window.addEventListener('offline', () => {
    showOfflineBanner();
    console.warn('[HR v104] تم فقدان الاتصال بالإنترنت');
  });

  window.addEventListener('online', () => {
    hideOfflineBanner();
    showOnlineBanner();
    console.info('[HR v104] تم استعادة الاتصال بالإنترنت');
    // Trigger offline queue flush if available
    if (typeof window.HR_FLUSH_OFFLINE_QUEUE === 'function') {
      window.HR_FLUSH_OFFLINE_QUEUE().catch((e) => console.error('[HR v104] Offline queue flush error:', e));
    }
  });

  /* ── Count-up Animation ── */
  function animateCountUp(el, target, duration = 900) {
    const start = Date.now();
    const startVal = 0;
    const endVal = parseFloat(target) || 0;
    const isFloat = String(target).includes('.');
    const decimals = isFloat ? (String(target).split('.')[1] || '').length : 0;

    function step() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * eased;
      el.textContent = isFloat ? current.toFixed(decimals) : Math.round(current).toLocaleString('en-US');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  let countUpObserver = null;
  function initCountUpObserver() {
    if (!('IntersectionObserver' in window)) return;
    if (!countUpObserver) countUpObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.dataset.countedUp) return;
        el.dataset.countedUp = '1';
        const target = el.dataset.countTarget || el.textContent.replace(/[^\d.]/g, '');
        if (target && !isNaN(target)) animateCountUp(el, target);
        countUpObserver.unobserve(el);
      });
    }, { threshold: 0.3 });

    document.querySelectorAll('.count-up, .stat-value, .live-stat-number, .kpi-number').forEach((el) => {
      if (el.dataset.countObserved || el.dataset.countedUp) return;
      if (!el.dataset.countTarget) el.dataset.countTarget = el.textContent.replace(/[^\d.]/g, '');
      el.dataset.countObserved = '1';
      countUpObserver.observe(el);
    });
  }

  /* ── Button Ripple Effect ── */
  function addRipple(e) {
    const btn = e.currentTarget;
    const existing = btn.querySelector('.ripple-effect');
    if (existing) existing.remove();

    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    ripple.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      transform: translate(-50%, -50%) scale(0);
      width: ${Math.max(rect.width, rect.height) * 2}px;
      height: ${Math.max(rect.width, rect.height) * 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,.15);
      pointer-events: none;
      animation: ripple-expand .5s ease forwards;
    `;
    btn.style.position = btn.style.position || 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  // Inject ripple keyframes
  if (!document.getElementById('hr-v104-ripple-style')) {
    const style = document.createElement('style');
    style.id = 'hr-v104-ripple-style';
    style.textContent = `
      @keyframes ripple-expand {
        to { transform: translate(-50%, -50%) scale(1); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function initRipple() {
    document.querySelectorAll('.button, button.primary, button.ghost, button.danger, .quick-action-item').forEach((btn) => {
      if (btn.dataset.rippleInit) return;
      btn.dataset.rippleInit = '1';
      btn.addEventListener('click', addRipple);
    });
  }

  /* ── Mobile Table to Cards ── */
  function initMobileTables() {
    if (window.innerWidth > 640) return;
    document.querySelectorAll('table').forEach((table) => {
      if (table.dataset.mobileInit) return;
      table.dataset.mobileInit = '1';
      const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!headers.length) return;
      table.querySelectorAll('tbody td').forEach((td, i) => {
        const headerIndex = i % headers.length;
        if (headers[headerIndex] && !td.dataset.label) {
          td.dataset.label = headers[headerIndex];
        }
      });
      // Add wrapper class for CSS targeting
      const wrapper = table.closest('.table-wrapper, .table-container');
      if (wrapper) wrapper.classList.add('table-to-cards');
      else {
        const wrap = document.createElement('div');
        wrap.className = 'table-to-cards';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });
  }

  /* ── Service Worker Update Banner ── */
  function watchForSWUpdate() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    }).catch(() => {});
  }

  function showUpdateBanner() {
    if (document.querySelector('.sw-update-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'sw-update-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = `
      position:fixed;top:0;inset-inline:0;z-index:9999;
      background:linear-gradient(135deg,rgba(26,110,255,.96),rgba(139,92,246,.95));
      color:#fff;padding:10px 20px;text-align:center;
      display:flex;align-items:center;justify-content:center;gap:12px;
      font-weight:800;font-size:13px;
      box-shadow:0 4px 20px rgba(0,0,0,.4);
    `;
    const text = document.createElement('span');
    text.textContent = '🔄 يوجد تحديث جديد للتطبيق';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'تحديث الآن';
    refresh.style.cssText = 'background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:999px;padding:6px 16px;font-weight:900;cursor:pointer;font-size:12px;font-family:inherit;';
    refresh.addEventListener('click', () => location.reload());
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'إغلاق إشعار التحديث');
    close.textContent = '×';
    close.style.cssText = 'background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;';
    close.addEventListener('click', () => banner.remove());
    banner.append(text, refresh, close);
    document.body.appendChild(banner);
  }

  /* ── Init on DOM Ready ── */
  function init() {
    initCountUpObserver();
    initRipple();
    initMobileTables();
    watchForSWUpdate();

    // Re-init on dynamic content changes (for SPA navigation)
    const observer = new MutationObserver(() => {
      initCountUpObserver();
      initRipple();
      if (window.innerWidth <= 640) initMobileTables();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose globally for debugging
  window.HR_V104_UX = { animateCountUp, showOfflineBanner, hideOfflineBanner };
})();

// QC4: replace inline image error handlers with a single delegated safe handler.
(function setupSafeImageErrorHandling() {
  if (window.__HR_V104_IMAGE_ERROR_GUARD__) return;
  window.__HR_V104_IMAGE_ERROR_GUARD__ = true;
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.fallbackAvatar === '1') {
      img.style.display = 'none';
      const fallback = img.nextElementSibling;
      if (fallback) fallback.classList.remove('hidden');
      return;
    }
    if (img.dataset.hideOnError === '1') {
      img.style.display = 'none';
    }
  }, true);
})();
