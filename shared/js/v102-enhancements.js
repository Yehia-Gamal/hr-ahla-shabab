/* v102 Dynamic Enhancements — runs after v101-deep-quality.js */
(function v102Enhancements() {
  if (window.__HR_V102__) return;
  window.__HR_V102__ = true;

  const doc = document;

  /* ── Debounce helper ── */
  function debounce(fn, ms) {
    let t;
    return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  /* ── 1. Compact Metric Badge Enhancement ── */
  function enhanceCompactMetrics(scope = doc) {
    scope.querySelectorAll('.compact-metric-badge,.compactMetricCard').forEach(card => {
      if (card.dataset.v102Enhanced) return;
      card.dataset.v102Enhanced = 'true';

      /* Keyboard accessible */
      if (!card.hasAttribute('tabindex') && card.tagName !== 'BUTTON' && card.tagName !== 'A') {
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
        });
      }

      /* Hover state feedback */
      const strong = card.querySelector('strong:last-of-type, b, [data-count]');
      if (strong && !strong.dataset.countDone) {
        const raw = String(strong.textContent || '').trim();
        const num = Number(raw.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(num) && num > 0 && num < 99999) {
          strong.dataset.count = num;
        }
      }
    });
  }

  /* ── 2. Table Sort UI (visual only, data sorted server-side) ── */
  function enhanceTableSort(scope = doc) {
    scope.querySelectorAll('thead th[data-sort]').forEach(th => {
      if (th.dataset.v102Sort) return;
      th.dataset.v102Sort = 'true';
      th.style.cursor = 'pointer';
      th.setAttribute('tabindex', '0');
      th.setAttribute('aria-sort', 'none');

      const arrow = doc.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = ' ⇅';
      arrow.style.cssText = 'opacity:.45;font-size:11px;margin-inline-start:5px;';
      th.appendChild(arrow);

      const toggle = () => {
        const ascending = th.getAttribute('aria-sort') !== 'ascending';
        th.closest('thead')?.querySelectorAll('th').forEach(t => {
          t.setAttribute('aria-sort', 'none');
          const a = t.querySelector('.sort-arrow');
          if (a) { a.textContent = ' ⇅'; a.style.opacity = '.45'; }
        });
        th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        arrow.textContent = ascending ? ' ↑' : ' ↓';
        arrow.style.opacity = '1';
      };

      th.addEventListener('click', toggle);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  /* ── 3. Copy-to-clipboard on cells with data-copy ── */
  function enhanceCopyable(scope = doc) {
    scope.querySelectorAll('[data-copy]').forEach(el => {
      if (el.dataset.v102Copy) return;
      el.dataset.v102Copy = 'true';
      el.style.cursor = 'copy';
      el.title = 'انقر للنسخ';
      el.addEventListener('click', async () => {
        const text = el.dataset.copy || el.textContent.trim();
        try {
          await navigator.clipboard.writeText(text);
          const orig = el.textContent;
          el.textContent = '✓ نُسخ';
          setTimeout(() => { el.textContent = orig; }, 1400);
        } catch {
          /* silent */
        }
      });
    });
  }

  /* ── 4. Auto-focus first invalid on submit fail ── */
  function enhanceFormFocus(scope = doc) {
    scope.querySelectorAll('form').forEach(form => {
      if (form.dataset.v102Form) return;
      form.dataset.v102Form = 'true';
      form.addEventListener('submit', () => {
        requestAnimationFrame(() => {
          const invalid = form.querySelector('.is-invalid,input:invalid,select:invalid,textarea:invalid');
          invalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          invalid?.focus({ preventScroll: true });
        });
      }, true);
    });
  }

  /* ── 5. PWA Install banner ── */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    const existingBanner = doc.querySelector('.hr102-install-banner');
    if (existingBanner || !doc.body) return;
    const banner = doc.createElement('div');
    banner.className = 'hr102-install-banner';
    banner.innerHTML = `
      <span>📱 أضف التطبيق إلى شاشة البداية لتجربة أفضل</span>
      <button class="hr102-install-btn" type="button">تثبيت</button>
      <button class="hr102-install-dismiss" type="button" aria-label="إغلاق">✕</button>
    `;
    doc.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('is-visible'));

    banner.querySelector('.hr102-install-btn')?.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      deferredInstall = null;
      banner.remove();
      if (outcome === 'accepted' && window.HRToast) window.HRToast('تم تثبيت التطبيق بنجاح!', 'ok', 3000);
    });

    banner.querySelector('.hr102-install-dismiss')?.addEventListener('click', () => {
      banner.classList.remove('is-visible');
      setTimeout(() => banner.remove(), 280);
      sessionStorage.setItem('hr102-install-dismissed', '1');
    });

    /* Don't re-show if already dismissed this session */
    if (sessionStorage.getItem('hr102-install-dismissed')) banner.remove();
  });

  /* ── 6. Detect slow connection and show warning ── */
  (function checkConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return;
    if (['slow-2g','2g'].includes(conn.effectiveType)) {
      const warn = doc.createElement('div');
      warn.className = 'hr102-slow-conn';
      warn.textContent = '⚠ اتصالك ببطء — قد تستغرق البيانات وقتاً أطول للظهور.';
      doc.body?.appendChild(warn);
      requestAnimationFrame(() => warn.classList.add('is-visible'));
      setTimeout(() => warn.classList.remove('is-visible'), 5000);
      setTimeout(() => warn.remove(), 5300);
    }
  })();

  /* ── 7. Page title update on hash change ── */
  function updateTitle() {
    const hash = location.hash.replace('#','');
    const labels = {
      dashboard: 'لوحة المتابعة', employees: 'الموظفون', attendance: 'الحضور والانصراف',
      requests: 'مركز الطلبات', notifications: 'الإشعارات', settings: 'الإعدادات',
      reports: 'التقارير', users: 'المستخدمون', locations: 'المواقع المباشرة',
      kpi: 'تقييم الأداء', audit: 'سجل العمليات', quality: 'جودة البيانات',
      home: 'الرئيسية', punch: 'البصمة', profile: 'حسابي', leaves: 'الإجازات',
      missions: 'المأموريات', tasks: 'المهام', disputes: 'الشكاوى',
    };
    if (hash && labels[hash]) {
      doc.title = `${labels[hash]} — أحلى شباب HR`;
    }
  }

  window.addEventListener('hashchange', updateTitle);
  updateTitle();

  /* ── 8. Long press on mobile for context actions ── */
  function setupLongPress(scope = doc) {
    scope.querySelectorAll('[data-long-press-route]').forEach(el => {
      if (el.dataset.v102LongPress) return;
      el.dataset.v102LongPress = 'true';
      let timer;
      el.addEventListener('pointerdown', () => {
        timer = setTimeout(() => {
          const route = el.dataset.longPressRoute;
          if (route) location.hash = route;
        }, 600);
      });
      el.addEventListener('pointerup', () => clearTimeout(timer));
      el.addEventListener('pointercancel', () => clearTimeout(timer));
    });
  }

  /* ── 9. Confirm before destructive buttons ── */
  function setupDestructiveConfirm(scope = doc) {
    scope.querySelectorAll('[data-confirm]').forEach(btn => {
      if (btn.dataset.v102Confirm) return;
      btn.dataset.v102Confirm = 'true';
      btn.addEventListener('click', async e => {
        if (btn.dataset.confirmApproved === 'true') {
          delete btn.dataset.confirmApproved;
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        const msg = btn.dataset.confirm || 'هل أنت متأكد من هذا الإجراء؟';
        const ok = typeof window.HRConfirmDialog === 'function'
          ? await window.HRConfirmDialog({ title: 'تأكيد الإجراء', message: msg, confirmLabel: 'تنفيذ', cancelLabel: 'إلغاء' })
          : true;
        if (!ok) return;
        btn.dataset.confirmApproved = 'true';
        btn.click();
      }, true);
    });
  }

  /* ── 10. Auto-resize textarea ── */
  function setupAutoResize(scope = doc) {
    scope.querySelectorAll('textarea[data-auto-resize]').forEach(textarea => {
      if (textarea.dataset.v102Resize) return;
      textarea.dataset.v102Resize = 'true';
      const resize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      };
      textarea.addEventListener('input', resize);
      resize();
    });
  }

  /* ── 11. Input Arabic numerals normalization ── */
  function setupNormalizeArabicDigits(scope = doc) {
    scope.querySelectorAll('input[type="number"],input[inputmode="numeric"],input[inputmode="decimal"]').forEach(input => {
      if (input.dataset.v102Digits) return;
      input.dataset.v102Digits = 'true';
      input.addEventListener('blur', () => {
        const v = input.value
          .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
          .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
        if (v !== input.value) input.value = v;
      });
    });
  }

  /* ── 12. Better hash-link anchors for SPA navigation ── */
  function setupHashAnchors(scope = doc) {
    scope.querySelectorAll('a[href^="#"]').forEach(anchor => {
      if (anchor.dataset.v102Hash) return;
      anchor.dataset.v102Hash = 'true';
      anchor.addEventListener('click', e => {
        const href = anchor.getAttribute('href');
        const route = href?.replace('#', '');
        if (route && !href.startsWith('#/')) {
          const btn = doc.querySelector(`[data-route="${CSS.escape(route)}"]`);
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }
      });
    });
  }

  /* ── Run all enhancements ── */
  function runAll(scope = doc) {
    enhanceCompactMetrics(scope);
    enhanceTableSort(scope);
    enhanceCopyable(scope);
    enhanceFormFocus(scope);
    setupLongPress(scope);
    setupDestructiveConfirm(scope);
    setupAutoResize(scope);
    setupNormalizeArabicDigits(scope);
    setupHashAnchors(scope);
  }

  /* Run on DOM ready */
  const init = () => {
    runAll();
    /* Watch for SPA re-renders */
    const mo = new MutationObserver(debounce(() => runAll(), 120));
    mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  /* Expose API */
  window.HREnhancementsV102 = Object.freeze({ runAll });
})();
