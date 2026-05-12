(function v101DeepQuality(){
  if (window.__HR_V101_DEEP_QUALITY__) return;
  window.__HR_V101_DEEP_QUALITY__ = true;

  const doc = document;
  const root = doc.documentElement;
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTyping = () => {
    const el = doc.activeElement;
    return el && (/^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName) || el.isContentEditable);
  };
  const escapeCss = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };
  const normalizeDigits = (value) => String(value || '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const numericValue = (text) => {
    const match = normalizeDigits(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  function toast(message, type = 'ok', timeout = 4200) {
    if (!message || !doc.body) return;
    doc.querySelectorAll('.hr-qc-toast').forEach(el => el.remove());
    const el = doc.createElement('div');
    el.className = `hr-qc-toast ${type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'ok'}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.textContent = String(message);
    doc.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    window.setTimeout(() => {
      el.classList.remove('is-visible');
      window.setTimeout(() => el.remove(), 260);
    }, timeout);
  }

  function confirmDialog({ title = 'تأكيد', message = '', confirmLabel = 'تأكيد', cancelLabel = 'إلغاء' } = {}) {
    if (typeof window.HRConfirmDialog === 'function' && window.HRConfirmDialog !== confirmDialog) {
      return window.HRConfirmDialog({ title, message, confirmLabel, cancelLabel });
    }
    return new Promise((resolve) => {
      if (!doc.body) return resolve(true);
      const overlay = doc.createElement('div');
      overlay.className = 'modal-backdrop hr-qc-confirm-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const box = doc.createElement('div');
      box.className = 'confirm-modal hr-qc-confirm-modal';
      const heading = doc.createElement('h2');
      heading.textContent = title;
      const body = doc.createElement('p');
      body.textContent = message;
      const actions = doc.createElement('div');
      actions.className = 'form-actions';
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button ghost';
      cancel.textContent = cancelLabel;
      const confirm = doc.createElement('button');
      confirm.type = 'button';
      confirm.className = 'button primary';
      confirm.textContent = confirmLabel;
      actions.append(cancel, confirm);
      box.append(heading, body, actions);
      overlay.appendChild(box);
      const cleanup = (answer) => { overlay.remove(); doc.removeEventListener('keydown', onKey); resolve(answer); };
      const onKey = (event) => { if (event.key === 'Escape') cleanup(false); };
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(false); });
      cancel.addEventListener('click', () => cleanup(false));
      confirm.addEventListener('click', () => cleanup(true));
      doc.addEventListener('keydown', onKey);
      doc.body.appendChild(overlay);
      confirm.focus({ preventScroll: true });
    });
  }

  function setupGlobalErrorGuard() {
    if (doc.documentElement.dataset.v101ErrorGuard === 'true') return;
    doc.documentElement.dataset.v101ErrorGuard = 'true';
    window.addEventListener('error', (event) => {
      if (/ResizeObserver loop|Script error/i.test(event.message || '')) return;
      console.error('[HR v101 UI error]', event.error || event.message);
      toast('حدث خطأ في الواجهة. تم تسجيله في Console للمراجعة.', 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const message = reason && (reason.message || String(reason));
      if (/AbortError|cancelled|canceled/i.test(message || '')) return;
      console.error('[HR v101 async error]', reason);
      toast('تعذر إكمال عملية. راجع الاتصال أو الصلاحيات.', 'error');
    });
  }

  function setupNetworkBanner() {
    if (doc.querySelector('.hr-qc-network') || !doc.body) return;
    const banner = doc.createElement('div');
    banner.className = 'hr-qc-network';
    banner.textContent = 'أنت غير متصل بالإنترنت الآن — سيتم استخدام البيانات المتاحة محليًا قدر الإمكان.';
    doc.body.appendChild(banner);
    const sync = () => banner.classList.toggle('is-visible', navigator.onLine === false);
    window.addEventListener('online', () => { sync(); toast('عاد الاتصال بالإنترنت.', 'ok', 2200); });
    window.addEventListener('offline', sync);
    sync();
  }

  function animateNumber(el) {
    if (!el || el.dataset.countDone === 'true' || reducedMotion()) return;
    const original = String(el.textContent || '').trim();
    const end = numericValue(original);
    if (!Number.isFinite(end)) return;
    const suffix = original.replace(/[-+\d٠-٩۰-۹.,\s]/g, '');
    const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: Number.isInteger(end) ? 0 : 1 });
    const start = performance.now();
    const duration = Math.min(1450, Math.max(680, Math.abs(end) * 18));
    el.dataset.countDone = 'true';
    function frame(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${formatter.format(end * eased)}${suffix}`;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = `${formatter.format(end)}${suffix}`;
    }
    requestAnimationFrame(frame);
  }

  let counterObserver;
  function setupCounters(scope = doc) {
    const selector = [
      '.metric-card strong', '.stat-card strong', '.metric strong', '.employee-stat strong',
      '.compact-metric-badge strong', '.mini-stats strong', '.kpi-card strong', '[data-count]'
    ].join(',');
    const targets = [...scope.querySelectorAll(selector)].filter(el => el.dataset.countDone !== 'true');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) return targets.forEach(animateNumber);
    counterObserver = counterObserver || new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        animateNumber(entry.target);
        counterObserver.unobserve(entry.target);
      });
    }, { threshold: 0.28 });
    targets.forEach(el => counterObserver.observe(el));
  }

  function enhanceTables(scope = doc) {
    scope.querySelectorAll('table').forEach(table => {
      if (!table.dataset.v101Table) {
        table.dataset.v101Table = 'true';
        table.classList.add('v101-mobile-table');
        if (!table.closest('.table-wrap,.table-scroll,.table-card')) {
          const wrap = doc.createElement('div');
          wrap.className = 'table-wrap v101-table-wrap';
          table.parentNode.insertBefore(wrap, table);
          wrap.appendChild(table);
        }
      }
      const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      if (headers.length) {
        table.querySelectorAll('tbody tr').forEach(row => {
          [...row.children].forEach((cell, index) => {
            if (headers[index] && !cell.dataset.label) cell.dataset.label = headers[index];
          });
        });
      }
    });
  }

  function enhanceEmptyStates(scope = doc) {
    scope.querySelectorAll('.empty-state,.empty,[data-empty],td').forEach(el => {
      if (el.dataset.v101Empty === 'true') return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      if (!/لا توجد|لا يوجد|لا بيانات|فارغ|No data|empty|لم يتم العثور/i.test(text)) return;
      el.dataset.v101Empty = 'true';
      el.classList.add('hr-empty-state');
      if (!el.querySelector('.hr-empty-icon')) {
        const original = text;
        el.textContent = '';
        const icon = doc.createElement('span');
        icon.className = 'hr-empty-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '∅';
        const strong = doc.createElement('strong');
        strong.textContent = 'لا توجد بيانات حالياً';
        const small = doc.createElement('small');
        small.textContent = original === 'لا توجد بيانات حالياً' ? 'ستظهر البيانات هنا بعد التسجيل أو تغيير الفلتر.' : original;
        el.append(icon, strong, small);
      }
    });
  }

  function validateField(input) {
    if (!input || input.disabled || input.readOnly || !/^(INPUT|SELECT|TEXTAREA)$/i.test(input.tagName)) return true;
    const value = String(input.value || '').trim();
    const required = input.required || input.getAttribute('aria-required') === 'true';
    let valid = true;
    let message = '';
    if (required && !value) { valid = false; message = 'هذا الحقل مطلوب.'; }
    if (valid && input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { valid = false; message = 'صيغة البريد الإلكتروني غير صحيحة.'; }
    if (valid && (input.type === 'tel' || input.inputMode === 'tel' || /phone|mobile|tel/i.test(input.name || '')) && value) {
      const phone = normalizeDigits(value).replace(/\D/g, '');
      if (!/^01\d{8,10}$/.test(phone) && !/^201\d{8,10}$/.test(phone)) { valid = false; message = 'اكتب رقم موبايل مصري صحيح يبدأ بـ 01.'; }
    }
    if (valid && input.type === 'number' && value) {
      const number = Number(value);
      if (Number.isFinite(Number(input.min)) && number < Number(input.min)) { valid = false; message = `القيمة لا تقل عن ${input.min}.`; }
      if (Number.isFinite(Number(input.max)) && number > Number(input.max)) { valid = false; message = `القيمة لا تزيد عن ${input.max}.`; }
    }
    if (valid && input.minLength > 0 && value && value.length < input.minLength) { valid = false; message = `الحد الأدنى ${input.minLength} أحرف.`; }
    const host = input.closest('label,.field,.form-field,.input-group') || input.parentElement;
    if (host) {
      let error = host.querySelector(':scope > .hr-field-error');
      if (!error) {
        error = doc.createElement('small');
        error.className = 'hr-field-error';
        error.setAttribute('aria-live', 'polite');
        host.appendChild(error);
      }
      error.textContent = valid ? '' : message;
      error.hidden = valid;
      host.classList.toggle('has-error', !valid);
    }
    input.classList.toggle('is-invalid', !valid);
    input.classList.toggle('is-valid', valid && Boolean(value));
    return valid;
  }

  function enhanceForms(scope = doc) {
    scope.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.dataset.v101Field === 'true') return;
      input.dataset.v101Field = 'true';
      input.addEventListener('blur', () => validateField(input));
      input.addEventListener('input', () => {
        if (input.classList.contains('is-invalid') || input.classList.contains('is-valid')) validateField(input);
      });
    });
    scope.querySelectorAll('form').forEach(form => {
      if (form.dataset.v101Form === 'true') return;
      form.dataset.v101Form = 'true';
      form.addEventListener('submit', event => {
        const fields = [...form.querySelectorAll('input,select,textarea')];
        const ok = fields.every(validateField);
        if (!ok) {
          event.preventDefault();
          event.stopPropagation();
          form.querySelector('.is-invalid')?.focus?.();
          toast('راجع الحقول المظللة قبل المتابعة.', 'error');
          return;
        }
        const submitter = event.submitter || form.querySelector('button[type="submit"],.submit,.button.primary');
        if (submitter && !submitter.dataset.noLoading) {
          submitter.classList.add('is-loading');
          submitter.setAttribute('aria-busy', 'true');
          window.setTimeout(() => {
            submitter.classList.remove('is-loading');
            submitter.removeAttribute('aria-busy');
          }, 4500);
        }
      }, true);
    });
  }

  function setupPasswordToggles(scope = doc) {
    scope.querySelectorAll('input[type="password"]').forEach(input => {
      if (input.dataset.v101PasswordToggle === 'true') return;
      if (input.closest('.password-field')?.querySelector('[data-toggle-code],.password-toggle,.hr-password-toggle')) {
        input.dataset.v101PasswordToggle = 'true';
        return;
      }
      input.dataset.v101PasswordToggle = 'true';
      const wrapper = doc.createElement('span');
      wrapper.className = 'password-field hr-password-field';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'hr-password-toggle';
      btn.textContent = 'إظهار';
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        btn.textContent = hidden ? 'إخفاء' : 'إظهار';
        btn.setAttribute('aria-pressed', String(hidden));
      });
      wrapper.appendChild(btn);
    });
  }

  function setupRipple() {
    if (doc.documentElement.dataset.v101Ripple === 'true') return;
    doc.documentElement.dataset.v101Ripple = 'true';
    doc.addEventListener('click', event => {
      const target = event.target.closest('button,.button,.quick-action,.quick-action-card,.target');
      if (!target || target.disabled || target.dataset.noRipple) return;
      const rect = target.getBoundingClientRect();
      const ripple = doc.createElement('span');
      ripple.className = 'hr-ripple';
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      target.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 700);
    }, true);
  }

  function setupProgress() {
    if (doc.querySelector('.v101-progress') || !doc.body) return;
    const bar = doc.createElement('div');
    bar.className = 'v101-progress';
    doc.body.appendChild(bar);
    const run = () => {
      bar.classList.remove('is-running');
      void bar.offsetWidth;
      bar.classList.add('is-running');
      window.setTimeout(() => bar.classList.remove('is-running'), 760);
    };
    window.addEventListener('hashchange', run);
    doc.addEventListener('click', event => { if (event.target.closest('[data-route],a[href^="#"]')) run(); }, true);
  }

  function setupScrollTop() {
    if (doc.querySelector('.v101-scroll-top') || !doc.body) return;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'v101-scroll-top';
    button.textContent = '↑';
    button.setAttribute('aria-label', 'العودة للأعلى');
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
    doc.body.appendChild(button);
    const sync = () => button.classList.toggle('is-visible', window.scrollY > 360);
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  function clickRoute(route) {
    const button = doc.querySelector(`[data-route="${escapeCss(route)}"]`);
    if (button) { button.click(); return; }
    location.hash = route;
  }

  function setupAdminNavigation(scope = doc) {
    if (!location.pathname.includes('/admin/') && !doc.querySelector('#app.admin-app,.admin-app')) return;
    const nav = scope.querySelector('.sidebar .nav,.sidebar-nav,nav.sidebar,.nav');
    if (nav && !doc.querySelector('.v101-nav-search')) {
      const label = doc.createElement('label');
      label.className = 'v101-nav-search';
      const caption = doc.createElement('span');
      caption.textContent = 'بحث سريع في القائمة';
      const input = doc.createElement('input');
      input.id = 'v101-sidebar-search-input';
      input.type = 'search';
      input.placeholder = 'ابحث… Alt+/';
      input.autocomplete = 'off';
      label.append(caption, input);
      nav.prepend(label);
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        nav.querySelectorAll('[data-route],.nav-link').forEach(item => {
          const text = (item.textContent || '').toLowerCase();
          item.classList.toggle('v101-nav-hidden', Boolean(q) && !text.includes(q));
        });
      });
    }
    const shortcutHints = { dashboard:'Alt+D', employees:'Alt+E', attendance:'Alt+A', reports:'Alt+R', notifications:'Alt+N', settings:'Alt+S', users:'Alt+U', locations:'Alt+L', kpi:'Alt+K' };
    Object.entries(shortcutHints).forEach(([route, hint]) => {
      doc.querySelectorAll(`[data-route="${route}"]`).forEach(button => {
        if (!button.querySelector('.shortcut-hint,.kbd')) {
          const span = doc.createElement('span');
          span.className = 'shortcut-hint';
          span.textContent = hint;
          button.appendChild(span);
        }
      });
    });
    if (doc.documentElement.dataset.v101AdminKeys === 'true') return;
    doc.documentElement.dataset.v101AdminKeys = 'true';
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented || isTyping()) return;
      if (event.altKey && event.key === '/') {
        event.preventDefault();
        (doc.getElementById('v101-sidebar-search-input') || doc.getElementById('sidebar-search-input') || doc.querySelector('.v10-nav-search input'))?.focus?.();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const map = { d:'dashboard', e:'employees', a:'attendance', r:'reports', n:'notifications', s:'settings', u:'users', l:'locations', k:'kpi' };
      const route = map[event.key.toLowerCase()];
      if (route) { event.preventDefault(); clickRoute(route); }
    });
  }

  function setupGatewaySafety() {
    if (!location.pathname.includes('/operations-gate/')) return;
    const form = doc.getElementById('gate-form');
    if (!form || form.dataset.v101Gate === 'true') return;
    form.dataset.v101Gate = 'true';
    form.addEventListener('submit', () => toast('جارٍ فحص الكود والصلاحية…', 'ok', 1800), true);
  }

  function setupServiceWorkerUpdateHint() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      toast('تم تحديث ملفات التطبيق. يفضل إعادة تحميل الصفحة لضمان أحدث نسخة.', 'warn', 7000);
    });
  }

  function polish(scope = doc) {
    root.classList.add('v101-quality-ready');
    setupCounters(scope);
    enhanceTables(scope);
    enhanceEmptyStates(scope);
    enhanceForms(scope);
    setupPasswordToggles(scope);
    setupAdminNavigation(scope);
    setupGatewaySafety();
  }

  window.HRDeepQuality = Object.freeze({ polish, toast, confirmDialog, validateField, enhanceTables });
  window.HRToast = window.HRToast || toast;
  window.HRConfirmDialog = window.HRConfirmDialog || confirmDialog;

  function ready() {
    setupGlobalErrorGuard();
    setupNetworkBanner();
    setupRipple();
    setupProgress();
    setupScrollTop();
    setupServiceWorkerUpdateHint();
    polish(doc);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if ([...record.addedNodes].some(node => node.nodeType === 1)) {
          requestAnimationFrame(() => polish(doc));
          break;
        }
      }
    });
    observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
