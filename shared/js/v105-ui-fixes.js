/* ═══════════════════════════════════════════════════════════════════════
   HR v105 — JavaScript Fixes & UX Enhancements
   Fixes: v10RippleBound crash, count-up, keyboard nav, sidebar search,
          form validation, scroll-to-top, live clock, network indicator
   ═══════════════════════════════════════════════════════════════════════ */
(function HR_v105() {
  'use strict';

  /* ── Guard: only run once ── */
  if (document.documentElement.dataset.v105Loaded) return;
  document.documentElement.dataset.v105Loaded = 'true';

  const log = (msg) => console.info('[HR v105]', msg);

  /* ─────────────────────────────────────────────────────────────────────
     1. RIPPLE EFFECT — tracks pointer position for directional ripple
     Fixes the crash: document.dataset is undefined (document ≠ HTMLElement)
     ──────────────────────────────────────────────────────────────────── */
  // Mark ripple as bound via documentElement (not document which has no .dataset)
  if (!document.documentElement.dataset.v105RippleBound) {
    document.documentElement.dataset.v105RippleBound = 'true';
    document.addEventListener('pointerdown', function (e) {
      const btn = e.target.closest(
        'button:not([disabled]), .button:not([disabled]), ' +
        '.compact-metric-badge, .quick-action-card, .target, ' +
        '.employee-bottom-nav button'
      );
      if (!btn || btn.disabled) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      requestAnimationFrame(function () {
        if (!btn.isConnected) return;
        const r = btn.getBoundingClientRect();
        if (!r.width || !r.height) return;
        btn.style.setProperty('--x', ((clientX - r.left) / r.width * 100).toFixed(1) + '%');
        btn.style.setProperty('--y', ((clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
    log('Ripple initialized ✓');
  }

  /* ─────────────────────────────────────────────────────────────────────
     2. COUNT-UP ANIMATION
     Animates numbers on any element with data-count="N"
     Also retroactively patches metric cards without data-count
     ──────────────────────────────────────────────────────────────────── */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateCount(el, target, duration) {
    duration = duration || 900;
    const isFloat   = /\./.test(String(target));
    const targetNum = parseFloat(String(target).replace(/[^0-9.]/g, '')) || 0;
    if (targetNum === 0) { el.textContent = '0'; return; }
    const startTime = performance.now();
    function tick(now) {
      const p = Math.min((now - startTime) / duration, 1);
      const v = targetNum * easeOutCubic(p);
      try {
        el.textContent = isFloat
          ? v.toFixed(1)
          : Math.round(v).toLocaleString('ar-EG');
      } catch (_) {
        el.textContent = Math.round(v);
      }
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.classList.add('counting-up');
        setTimeout(() => el.classList.remove('counting-up'), 350);
      }
    }
    requestAnimationFrame(tick);
  }

  const countObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      animateCount(el, el.dataset.count);
      countObserver.unobserve(el);
    });
  }, { threshold: 0.15 });

  function patchCountUp(root) {
    root = root || document;
    // Attach to explicitly marked elements
    root.querySelectorAll('[data-count]:not([data-counted])').forEach(function (el) {
      el.dataset.counted = '1';
      countObserver.observe(el);
    });
    // Auto-detect numeric values in metric cards
    const selectors = [
      '.metric-card strong', '.metric strong', '.stat-card strong',
      '.compact-metric-badge strong', '.employee-stat strong',
      '.kpi-value', '.score-value',
    ].join(', ');
    root.querySelectorAll(selectors).forEach(function (el) {
      if (el.dataset.count !== undefined || el.dataset.counted) return;
      const text = (el.textContent || '').trim().replace(/,/g, '');
      const num  = parseFloat(text);
      if (!isNaN(num) && num > 0 && text.length <= 10) {
        el.dataset.count  = num;
        el.dataset.counted = '1';
        countObserver.observe(el);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     3. DOM WATCHER — re-run patches after every render
     ──────────────────────────────────────────────────────────────────── */
  const appRoot = document.getElementById('app') || document.body;
  let debounce  = null;

  new MutationObserver(function (mutations) {
    const added = mutations.some(m => m.addedNodes.length > 0);
    if (!added) return;
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      patchCountUp(appRoot);
      injectTableLabels(appRoot);
      injectEmptyIcons(appRoot);
      tryInjectSidebarSearch();
      injectKbdHints();
    }, 90);
  }).observe(appRoot, { childList: true, subtree: true });

  /* Run once at boot */
  setTimeout(function () {
    patchCountUp(appRoot);
    injectTableLabels(appRoot);
    injectEmptyIcons(appRoot);
    tryInjectSidebarSearch();
    injectKbdHints();
  }, 300);

  /* ─────────────────────────────────────────────────────────────────────
     4. TABLE MOBILE LABELS
     ──────────────────────────────────────────────────────────────────── */
  function injectTableLabels(root) {
    root.querySelectorAll('table').forEach(function (table) {
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      if (!headers.length) return;
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        Array.from(tr.querySelectorAll('td')).forEach(function (td, i) {
          if (!td.dataset.label && headers[i]) td.dataset.label = headers[i];
        });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     5. EMPTY STATE ICONS
     ──────────────────────────────────────────────────────────────────── */
  const EMPTY_ICONS = {
    'موظف': '👥', 'بصمة': '🕐', 'حضور': '📋', 'إجازة': '🏖', 'طلب': '📄',
    'مأمورية': '🚗', 'مهام': '✅', 'إشعار': '🔔', 'شكوى': '⚖️', 'قرار': '📢',
    'بيانات': '📊', 'مستند': '📁', 'تقرير': '📈', 'خريطة': '🗺️',
  };

  function injectEmptyIcons(root) {
    root.querySelectorAll('.empty-state:not([data-v105-icon])').forEach(function (el) {
      el.dataset.v105Icon = '1';
      if (el.querySelector('.empty-icon')) return;
      const text = el.textContent || '';
      let icon = '📭';
      for (const [key, val] of Object.entries(EMPTY_ICONS)) {
        if (text.includes(key)) { icon = val; break; }
      }
      const span = document.createElement('span');
      span.className = 'empty-icon';
      span.textContent = icon;
      span.setAttribute('aria-hidden', 'true');
      el.insertBefore(span, el.firstChild);
    });
  }

  /* ─────────────────────────────────────────────────────────────────────
     6. SIDEBAR SEARCH FIX
     The original targets '.sidebar-nav'/'nav.sidebar' but admin uses '.sidebar'
     ──────────────────────────────────────────────────────────────────── */
  let sidebarSearchDone = false;
  function tryInjectSidebarSearch() {
    if (sidebarSearchDone) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    if (sidebar.querySelector('#v105-sidebar-search')) { sidebarSearchDone = true; return; }
    const nav = sidebar.querySelector('.nav') || sidebar;
    if (!nav) return;

    const wrap = document.createElement('div');
    wrap.className = 'sidebar-search';
    wrap.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'margin:0 0 10px', 'padding:9px 13px',
      'border:1px solid rgba(26,110,255,.18)', 'border-radius:12px',
      'background:rgba(8,14,32,.72)',
      'transition:border-color .18s, box-shadow .18s',
    ].join(';');

    const icon = document.createElement('span');
    icon.textContent = '🔍';
    icon.style.cssText = 'font-size:13px;flex-shrink:0;color:#647A9B';
    icon.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.id = 'v105-sidebar-search';
    input.type = 'search';
    input.placeholder = 'ابحث في القائمة... (Alt+/)';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'بحث في القائمة');
    input.style.cssText = [
      'flex:1', 'min-width:0', 'background:none', 'border:none',
      'outline:none', 'color:#EEF5FF', 'font-size:13px', 'font-family:inherit',
    ].join(';');

    wrap.appendChild(icon);
    wrap.appendChild(input);
    nav.insertBefore(wrap, nav.firstChild);

    // Focus style
    wrap.addEventListener('focusin',  () => { wrap.style.borderColor = '#00C2FF'; wrap.style.boxShadow = '0 0 0 3px rgba(0,194,255,.12)'; });
    wrap.addEventListener('focusout', () => { wrap.style.borderColor = 'rgba(26,110,255,.18)'; wrap.style.boxShadow = ''; });

    input.addEventListener('input', function () {
      const q = input.value.trim().toLowerCase();
      nav.querySelectorAll('button:not(#v105-sidebar-search), .nav-link').forEach(function (btn) {
        const show = !q || (btn.textContent || '').toLowerCase().includes(q);
        btn.style.display = show ? '' : 'none';
        const li = btn.closest('li');
        if (li) li.style.display = show ? '' : 'none';
      });
      nav.querySelectorAll('.nav-group, [class*="nav-section"]').forEach(function (group) {
        if (!q) { group.style.display = ''; return; }
        const hasVisible = Array.from(group.querySelectorAll('button')).some(b => b.style.display !== 'none');
        group.style.display = hasVisible ? '' : 'none';
      });
    });

    sidebarSearchDone = true;
    log('Sidebar search injected ✓');
  }

  /* ─────────────────────────────────────────────────────────────────────
     7. KEYBOARD SHORTCUT HINTS IN SIDEBAR
     ──────────────────────────────────────────────────────────────────── */
  const KBD_MAP = {
    dashboard:'D', employees:'E', attendance:'A', reports:'R',
    notifications:'N', settings:'S', users:'U', locations:'L', kpi:'K',
    home:'H', leaves:'V', missions:'M', complaints:'C', profile:'P',
  };
  let kbdDone = false;
  function injectKbdHints() {
    if (kbdDone) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const btns = sidebar.querySelectorAll('[data-route]');
    if (!btns.length) return;
    btns.forEach(function (btn) {
      if (btn.querySelector('.kbd-hint')) return;
      const route = btn.dataset.route || '';
      const key   = KBD_MAP[route];
      if (!key) return;
      const hint = document.createElement('span');
      hint.className = 'kbd-hint';
      hint.textContent = 'Alt+' + key;
      hint.setAttribute('aria-hidden', 'true');
      hint.style.cssText = [
        'margin-inline-start:auto', 'font-size:9px', 'padding:1px 6px',
        'border-radius:4px', 'border:1px solid rgba(0,194,255,.22)',
        'background:rgba(0,194,255,.08)', 'color:#00C2FF',
        'font-family:ui-monospace,monospace', 'opacity:0',
        'transition:opacity .18s', 'flex-shrink:0', 'white-space:nowrap',
      ].join(';');
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.appendChild(hint);
      btn.addEventListener('mouseenter', () => { hint.style.opacity = '0.75'; });
      btn.addEventListener('mouseleave', () => { hint.style.opacity = '0'; });
    });
    kbdDone = true;
  }

  /* ─────────────────────────────────────────────────────────────────────
     8. KEYBOARD SHORTCUTS
     ──────────────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    const tag = (document.activeElement || {}).tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

    // Alt+/ → focus sidebar search
    if (e.altKey && (e.key === '/' || e.key === 'Divide')) {
      e.preventDefault();
      const s = document.getElementById('v105-sidebar-search');
      if (s) { s.focus(); s.select(); }
      return;
    }
    // Alt+T → scroll to top
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Escape → close modals
    if (e.key === 'Escape') {
      const backdrop = document.querySelector('.modal-backdrop, .confirm-backdrop');
      if (backdrop) {
        const closeBtn = backdrop.querySelector('[data-cancel], [data-action="cancel"], .btn-cancel, .modal-close');
        if (closeBtn) closeBtn.click();
      }
    }
  }, false);

  /* ─────────────────────────────────────────────────────────────────────
     9. SCROLL-TO-TOP BUTTON
     ──────────────────────────────────────────────────────────────────── */
  (function initScrollTop() {
    if (document.querySelector('.v105-scroll-top')) return;
    const btn = document.createElement('button');
    btn.className = 'v105-scroll-top';
    btn.type = 'button';
    btn.innerHTML = '↑';
    btn.setAttribute('aria-label', 'العودة للأعلى');
    btn.style.cssText = [
      'position:fixed', 'bottom:104px', 'inset-inline-end:18px',
      'width:42px', 'height:42px', 'border-radius:50%',
      'border:1px solid rgba(26,110,255,.28)',
      'background:rgba(5,10,26,.92)',
      'color:#00C2FF', 'font-size:18px', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'opacity:0', 'transform:translateY(14px) scale(0.8)',
      'transition:opacity .22s, transform .22s cubic-bezier(0.34,1.4,0.64,1)',
      'box-shadow:0 8px 24px rgba(0,0,0,.32)', 'z-index:78',
      'font-family:inherit',
    ].join(';');
    document.body.appendChild(btn);

    window.addEventListener('scroll', function () {
      const show = window.scrollY > 280;
      btn.style.opacity = show ? '1' : '0';
      btn.style.transform = show ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.8)';
    }, { passive: true });

    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(26,110,255,.16)'; btn.style.transform = 'translateY(-3px) scale(1.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(5,10,26,.92)'; btn.style.transform = window.scrollY > 280 ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.8)'; });
  })();

  /* ─────────────────────────────────────────────────────────────────────
     10. PAGE PROGRESS BAR (on hash navigation)
     ──────────────────────────────────────────────────────────────────── */
  function showProgress() {
    document.querySelectorAll('.v105-progress').forEach(el => el.remove());
    const bar = document.createElement('div');
    bar.className = 'v105-progress progress-bar-top';
    document.body.appendChild(bar);
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 1100);
  }
  window.addEventListener('hashchange', showProgress, { passive: true });

  /* ─────────────────────────────────────────────────────────────────────
     11. FORM VALIDATION ENHANCEMENT
     ──────────────────────────────────────────────────────────────────── */
  document.addEventListener('blur', function (e) {
    const f = e.target;
    if (!f || !['INPUT', 'SELECT', 'TEXTAREA'].includes(f.tagName)) return;
    if (!f.required) return;
    if (f.value.trim()) {
      f.classList.add('is-valid');
      f.classList.remove('is-invalid');
    } else {
      f.classList.add('is-invalid');
      f.classList.remove('is-valid');
    }
  }, true);

  document.addEventListener('input', function (e) {
    const f = e.target;
    if (!f || !['INPUT', 'SELECT', 'TEXTAREA'].includes(f.tagName)) return;
    if (f.classList.contains('is-invalid') && f.value.trim()) {
      f.classList.remove('is-invalid');
      f.classList.add('is-valid');
    }
  }, true);

  /* ─────────────────────────────────────────────────────────────────────
     12. ACCESSIBILITY — focus trap in modals
     ──────────────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector('.modal-backdrop[aria-modal="true"], .confirm-backdrop[aria-modal="true"]');
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, false);

  /* ─────────────────────────────────────────────────────────────────────
     13. IMAGE ERROR HANDLER (logo fallback)
     ──────────────────────────────────────────────────────────────────── */
  document.querySelectorAll('img[data-hide-on-error]').forEach(function (img) {
    img.addEventListener('error', function () {
      img.style.display = 'none';
    });
  });
  // Also watch for newly added images
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IMG' && node.dataset.hideOnError) {
          node.addEventListener('error', () => { node.style.display = 'none'; });
        }
        node.querySelectorAll?.('img[data-hide-on-error]').forEach(function (img) {
          img.addEventListener('error', () => { img.style.display = 'none'; });
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  /* ─────────────────────────────────────────────────────────────────────
     14. EXECUTIVE TABS — SCROLL ACTIVE TAB INTO VIEW
     ──────────────────────────────────────────────────────────────────── */
  function scrollActiveTabIntoView() {
    const activeTab = document.querySelector('.executive-tabs button.is-active');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }
  window.addEventListener('hashchange', function () {
    setTimeout(scrollActiveTabIntoView, 120);
  }, { passive: true });
  setTimeout(scrollActiveTabIntoView, 400);

  /* ─────────────────────────────────────────────────────────────────────
     15. LIVE MINI CLOCK (update every minute on employee home)
     ──────────────────────────────────────────────────────────────────── */
  setInterval(function () {
    document.querySelectorAll('[data-live-clock]').forEach(function (el) {
      try {
        el.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      } catch (_) {}
    });
  }, 60000);

  log('v105 fully loaded ✓');
})();
