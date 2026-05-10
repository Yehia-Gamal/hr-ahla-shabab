(function(){
  const cfg = (window.HR_SUPABASE_CONFIG = window.HR_SUPABASE_CONFIG || {});
  cfg.attendance = Object.assign({
    qrRequired:false,
    reminderInPageHour:10,
    reminderPushHour:9,
    reminderPushMinute:30,
    gpsSamples:18,
    gpsSampleWindowMs:30000,
    gpsTargetAccuracyMeters:15,
    gpsMaxAcceptableAccuracyMeters:90,
    gpsSafetyBufferMeters:50,
    gpsUncertainReviewOnly:true
  }, cfg.attendance || {}, { qrRequired:false, gpsSafetyBufferMeters: Math.max(50, Number(cfg.attendance?.gpsSafetyBufferMeters || 0)) });
  if (cfg.attendance.branchLocation) cfg.attendance.branchLocation.safetyBufferMeters = Math.max(50, Number(cfg.attendance.branchLocation.safetyBufferMeters || 0));
  cfg.security = Object.assign({ allowLocalFallback:false, blockInsecureGatewayDefaults:true }, cfg.security || {});
  try { delete cfg.security.allowLocalDemo; } catch {}
  cfg.cacheVersion = cfg.cacheVersion || 'v39-consolidated-stable-110';
  cfg.deployment = Object.assign({}, cfg.deployment || {}, {
    packageVersion: 'v39-consolidated-stable-110',
    expectedPatch: cfg.deployment?.expectedPatch || '104_royal_blue_full_migration'
  });
  window.HR_QR_REQUIRED = false;
  window.HR_PRIVATE_DEPLOY_BUNDLE = true;

  function toast(msg,type='ok',ms=5000){
    if(!msg) return;
    document.querySelectorAll('.hr-toast.v10').forEach(t=>t.remove());
    const el=document.createElement('div');
    el.className='hr-toast v10 '+(type==='error'?'error':type==='warn'?'warn':'ok');
    el.textContent=msg;
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    document.body.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('is-visible'));
    setTimeout(()=>{el.classList.remove('is-visible'); setTimeout(()=>el.remove(),260)},ms);
  }

  function confirmDialog({title='تأكيد', message='', confirmLabel='تأكيد', cancelLabel='لاحقًا'}={}){
    return new Promise(resolve=>{
      const overlay=document.createElement('div');
      overlay.className='modal-backdrop v10-confirm-backdrop';
      overlay.setAttribute('role','dialog');
      overlay.setAttribute('aria-modal','true');
      overlay.innerHTML='<div class="confirm-modal v10-confirm-modal" role="document"><div class="panel-head"><div><h2></h2><p></p></div></div><div class="form-actions"><button class="button ghost" type="button" data-cancel></button><button class="button primary" type="button" data-confirm></button></div></div>';
      overlay.querySelector('h2').textContent=title;
      overlay.querySelector('p').textContent=message;
      overlay.querySelector('[data-cancel]').textContent=cancelLabel;
      overlay.querySelector('[data-confirm]').textContent=confirmLabel;
      const cleanup=(answer)=>{overlay.remove(); document.removeEventListener('keydown', onKey); resolve(answer);};
      const onKey=(event)=>{if(event.key==='Escape') cleanup(false);};
      overlay.addEventListener('click', event=>{if(event.target===overlay) cleanup(false);});
      overlay.querySelector('[data-cancel]').addEventListener('click', ()=>cleanup(false));
      overlay.querySelector('[data-confirm]').addEventListener('click', ()=>cleanup(true));
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-confirm]').focus();
    });
  }

  function cssEscape(value){
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function numericValue(text){
    const latin = String(text || '')
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    const match = latin.replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function animateCount(el){
    if (!el || el.dataset.countDone === 'true') return;
    const end = numericValue(el.textContent);
    if (!Number.isFinite(end)) return;
    const suffix = String(el.textContent || '').trim().replace(/[-+\d٠-٩۰-۹.,\s]/g,'');
    el.dataset.countDone = 'true';
    el.dataset.count = String(end);
    const start = performance.now();
    const duration = Math.min(1400, Math.max(650, Math.abs(end) * 22));
    const formatter = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: Number.isInteger(end) ? 0 : 1 });
    function tick(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatter.format(end * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick); else el.textContent = formatter.format(end) + suffix;
    }
    requestAnimationFrame(tick);
  }

  let metricObserver;
  function setupCountUp(root=document){
    const targets = root.querySelectorAll('.metric-card strong,.stat-card strong,.metric strong,.employee-stat strong,.compact-metric-badge strong,.mini-stats strong,.score-ring strong,.kpi-card strong');
    if (!targets.length) return;
    if ('IntersectionObserver' in window) {
      metricObserver = metricObserver || new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) { animateCount(entry.target); metricObserver.unobserve(entry.target); } });
      }, { threshold:.35 });
      targets.forEach(el => { if (el.dataset.countDone !== 'true') metricObserver.observe(el); });
    } else targets.forEach(animateCount);
  }

  function enhanceTables(root=document){
    root.querySelectorAll('.table-wrap table, table.data-table, table').forEach(table=>{
      if (table.dataset.v10TableEnhanced === 'true') return;
      table.dataset.v10TableEnhanced = 'true';
      table.classList.add('v10-table');
      const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row=>{
        [...row.children].forEach((cell,index)=>{ if(headers[index] && !cell.dataset.label) cell.dataset.label=headers[index]; });
      });
    });
    root.querySelectorAll('.empty,.empty-state,td').forEach(el=>{
      const text=(el.textContent||'').trim();
      if (!text || el.dataset.v10EmptyEnhanced === 'true') return;
      if (/لا توجد|لا يوجد|لا بيانات|فارغ|empty|No data/i.test(text)) {
        el.dataset.v10EmptyEnhanced='true';
        el.classList.add('v10-empty-enhanced');
        if (!el.querySelector('.v10-empty-icon')) {
          const original=text;
          el.innerHTML='<span class="v10-empty-icon" aria-hidden="true">∅</span><strong>لا توجد بيانات حالياً</strong><small></small>';
          const small=el.querySelector('small');
          small.textContent = original === 'لا توجد بيانات حالياً' ? 'ستظهر النتائج هنا بمجرد تسجيل بيانات جديدة أو تغيير الفلتر.' : original;
        }
      }
    });
  }

  function validateField(input){
    if (!input || input.disabled || input.readOnly || !/^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName)) return true;
    const value=String(input.value || '').trim();
    const required=input.required || input.getAttribute('aria-required') === 'true';
    let valid=true;
    let message='';
    if (required && !value) { valid=false; message='هذا الحقل مطلوب.'; }
    if (valid && input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { valid=false; message='صيغة البريد الإلكتروني غير صحيحة.'; }
    if (valid && (input.name === 'phone' || input.name === 'mobile' || input.inputMode === 'tel') && value && !/^01\d{8,10}$/.test(value.replace(/\s+/g,''))) { valid=false; message='اكتب رقم موبايل مصري صحيح يبدأ بـ 01.'; }
    if (valid && input.minLength > 0 && value && value.length < input.minLength) { valid=false; message=`الحد الأدنى ${input.minLength} أحرف.`; }
    const host=input.closest('label,.field,.form-field') || input.parentElement;
    if (!host) return valid;
    let error=host.querySelector(':scope > .field-error.v10');
    if (!error) {
      error=document.createElement('small');
      error.className='field-error v10';
      error.setAttribute('aria-live','polite');
      host.appendChild(error);
    }
    input.classList.toggle('is-invalid', !valid);
    input.classList.toggle('is-valid', valid && Boolean(value));
    host.classList.toggle('has-error', !valid);
    error.textContent=valid ? '' : message;
    error.hidden=valid;
    return valid;
  }

  function setupForms(root=document){
    root.querySelectorAll('input,select,textarea').forEach(input=>{
      if (input.dataset.v10ValidationBound === 'true') return;
      input.dataset.v10ValidationBound='true';
      input.addEventListener('blur', ()=>validateField(input));
      input.addEventListener('input', ()=>{ if(input.classList.contains('is-invalid') || input.classList.contains('is-valid')) validateField(input); });
    });
    root.querySelectorAll('form').forEach(form=>{
      if (form.dataset.v10SubmitBound === 'true') return;
      form.dataset.v10SubmitBound='true';
      form.addEventListener('submit', event=>{
        const fields=[...form.querySelectorAll('input,select,textarea')];
        const ok=fields.every(validateField);
        if(!ok){
          event.preventDefault();
          event.stopPropagation();
          form.querySelector('.is-invalid')?.focus?.();
          toast('راجع الحقول المظللة بالأحمر قبل المتابعة.', 'error');
          return;
        }
        const submitter = event.submitter || form.querySelector('button[type="submit"],.submit');
        if (submitter && !submitter.dataset.noLoading) {
          submitter.classList.add('is-loading');
          submitter.setAttribute('aria-busy','true');
          setTimeout(()=>{ submitter.classList.remove('is-loading'); submitter.removeAttribute('aria-busy'); }, 4000);
        }
      }, true);
    });
  }

  function setupRipple(){
    const host = document.documentElement || document.body;
    if (!host || host.dataset.v10RippleBound === 'true') return;
    host.dataset.v10RippleBound='true';
    document.addEventListener('click', event=>{
      const button=event.target.closest('button,.button,.quick-action,.action-card,[role="button"]');
      if(!button || button.disabled || button.classList.contains('no-ripple')) return;
      const clientX = event.clientX;
      const clientY = event.clientY;
      requestAnimationFrame(()=>{
        if (!button.isConnected) return;
        const rect=button.getBoundingClientRect();
        const ripple=document.createElement('span');
        ripple.className='v10-ripple';
        const size=Math.max(rect.width, rect.height);
        ripple.style.width=ripple.style.height=size+'px';
        ripple.style.left=(clientX - rect.left - size/2)+'px';
        ripple.style.top=(clientY - rect.top - size/2)+'px';
        button.appendChild(ripple);
        setTimeout(()=>ripple.remove(),650);
      });
    }, true);
  }

  function clickRoute(route){
    const safe=cssEscape(route);
    const target=document.querySelector(`[data-route="${safe}"]`);
    if (target) { target.click(); return true; }
    if (location.hash !== '#'+route) location.hash = route;
    return true;
  }

  function setupAdminShortcuts(root=document){
    const isAdmin = document.querySelector('.admin-app,#app.admin-app') || location.pathname.includes('/admin/');
    if (!isAdmin) return;
    const nav=root.querySelector('.sidebar .nav,.nav');
    if (nav && !document.querySelector('.v10-nav-search')) {
      const box=document.createElement('label');
      box.className='v10-nav-search';
      box.innerHTML='<span>بحث سريع في القائمة</span><input type="search" placeholder="اكتب للبحث… Alt+/" autocomplete="off" />';
      nav.prepend(box);
      const input=box.querySelector('input');
      input.addEventListener('input', ()=>{
        const q=input.value.trim().toLowerCase();
        document.querySelectorAll('.nav button[data-route]').forEach(btn=>{
          const hit=!q || (btn.textContent||'').toLowerCase().includes(q) || String(btn.dataset.route||'').toLowerCase().includes(q);
          btn.closest('button,li')?.classList.toggle('v10-nav-hidden', !hit);
        });
      });
    }
    const hints={dashboard:'Alt+D',employees:'Alt+E',attendance:'Alt+A',requests:'Alt+R',notifications:'Alt+N',settings:'Alt+S',users:'Alt+U',audit:'Alt+L',kpi:'Alt+K'};
    Object.entries(hints).forEach(([route,hint])=>{
      document.querySelectorAll(`.nav button[data-route="${route}"]`).forEach(btn=>{
        if (!btn.querySelector('.kbd')) {
          const k=document.createElement('span'); k.className='kbd'; k.textContent=hint; btn.appendChild(k);
        }
      });
    });
    const shortcutHost = document.documentElement || document.body;
    if (!shortcutHost || shortcutHost.dataset.v10ShortcutsBound === 'true') return;
    shortcutHost.dataset.v10ShortcutsBound='true';
    document.addEventListener('keydown', event=>{
      if (event.defaultPrevented) return;
      const active=document.activeElement;
      const typing=active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
      if (event.altKey && event.key === '/') {
        event.preventDefault(); document.querySelector('.v10-nav-search input')?.focus(); return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || typing) return;
      const map={d:'dashboard',e:'employees',a:'attendance',r:'requests',n:'notifications',s:'settings',u:'users',l:'audit',k:'kpi'};
      const route=map[event.key.toLowerCase()];
      if (route) { event.preventDefault(); clickRoute(route); toast(`تم فتح: ${route}`, 'ok', 1600); }
    });
  }

  function setupProgressBar(){
    if (document.querySelector('.v10-progress')) return;
    const bar=document.createElement('div');
    bar.className='v10-progress';
    document.body.appendChild(bar);
    const run=()=>{bar.classList.add('is-running'); setTimeout(()=>bar.classList.remove('is-running'),650);};
    window.addEventListener('hashchange', run);
    document.addEventListener('click', e=>{ if(e.target.closest('[data-route],a[href^="#"]')) run(); }, true);
  }

  function setupScrollTop(){
    if (document.querySelector('.v10-scroll-top')) return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='v10-scroll-top';
    btn.setAttribute('aria-label','العودة للأعلى');
    btn.textContent='↑';
    btn.addEventListener('click', ()=>window.scrollTo({top:0,behavior:'smooth'}));
    document.body.appendChild(btn);
    const toggle=()=>btn.classList.toggle('is-visible', window.scrollY > 420);
    window.addEventListener('scroll', toggle, {passive:true}); toggle();
  }

  function polish(root=document){
    document.documentElement.classList.add('v10-polished','v101-deep-fix');
    setupCountUp(root);
    enhanceTables(root);
    setupForms(root);
    setupAdminShortcuts(root);
  }

  window.HRToast = toast;
  window.HRConfirmDialog = confirmDialog;
  window.HREnhanceTables = enhanceTables;
  window.HRExplainAndEnablePush = async function(){
    if(!('Notification' in window)) { toast('هذا المتصفح لا يدعم الإشعارات.', 'error'); return false; }
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('إشعارات Web Push غير مدعومة على هذا الجهاز.', 'error'); return false; }
    const ok = await confirmDialog({
      title:'تفعيل الإشعارات',
      message:'سيتم تفعيل إشعارات البصمة وطلب الموقع والقرارات الإدارية على هذا الجهاز. يمكنك إيقافها لاحقًا من إعدادات المتصفح.',
      confirmLabel:'تفعيل',
      cancelLabel:'لاحقًا'
    });
    if(!ok) return false;
    const perm = await Notification.requestPermission();
    toast(perm==='granted'?'تم السماح بالإشعارات.':'لم يتم السماح بالإشعارات.', perm==='granted'?'ok':'error');
    return perm==='granted';
  };

  window.HRExplainAndEnableLocation = async function(){
    if(!navigator.geolocation) { toast('هذا الجهاز لا يدعم تحديد الموقع.', 'error'); return null; }
    return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
      pos=>{ toast('تم تفعيل الموقع وقراءة GPS بنجاح.'); resolve(pos); },
      err=>{ toast(err && err.code === 1 ? 'تم رفض صلاحية الموقع. فعّل Location من إعدادات المتصفح.' : 'تعذر قراءة GPS الآن. جرّب في مكان مفتوح ثم أعد المحاولة.', 'error'); resolve(null); },
      {enableHighAccuracy:true,timeout:22000,maximumAge:0}
    ));
  };

  document.addEventListener('click', (e)=>{
    const btn=e.target.closest('[data-enable-push],[data-enable-notifications]');
    if(btn && !btn.dataset.hrPushBound){ e.preventDefault(); window.HRExplainAndEnablePush(); }
    const loc=e.target.closest('[data-enable-location]');
    if(loc && !loc.dataset.hrLocationBound){ e.preventDefault(); window.HRExplainAndEnableLocation(); }
  });

  setupRipple();
  const ready=()=>{ polish(document); setupProgressBar(); setupScrollTop(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once:true }); else ready();
  const observer = new MutationObserver(records=>{
    let should=false;
    for (const record of records) { if ([...record.addedNodes].some(node=>node.nodeType===1)) { should=true; break; } }
    if (should) requestAnimationFrame(()=>polish(document));
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList:true, subtree:true });
})();

/* ── v110: Offline/online detection ── */
(function initNetworkStatus() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = '⚠️ لا يوجد اتصال بالإنترنت — بعض الخدمات قد لا تعمل';
  document.body.insertBefore(banner, document.body.firstChild);

  const update = () => {
    const isOnline = navigator.onLine;
    document.body.classList.toggle('is-offline', !isOnline);

    if (!isOnline) {
      /* Going offline: register Background Sync tag so the browser fires it
         automatically when connectivity is restored.  Silently ignored on
         browsers without BG-Sync support (Firefox, old Safari). */
      navigator.serviceWorker?.ready?.then(sw => {
        sw.sync?.register?.('hr-offline-sync').catch(() => {});
      }).catch(() => {});
    } else {
      /* Coming back online: trigger the queue flush immediately as a direct
         fallback for browsers that do not support the Background Sync API.
         App files (employee-app / app-admin / executive-app) also listen for
         this event and call endpoints.syncOfflineQueue() themselves; the hook
         below is a belt-and-suspenders call in case they are not yet loaded. */
      if (typeof window.HR_FLUSH_OFFLINE_QUEUE === 'function') {
        window.HR_FLUSH_OFFLINE_QUEUE('v10-online-event');
      }
    }
  };

  window.addEventListener('online',  update, { passive: true });
  window.addEventListener('offline', update, { passive: true });
  update();
})();

/* ── v110: Pull-to-refresh indicator ── */
(function initPullRefresh() {
  const ptr = document.createElement('div');
  ptr.className = 'ptr-indicator';
  document.body.appendChild(ptr);

  let startY = 0, pulling = false;
  document.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (window.scrollY > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 40) { pulling = true; ptr.classList.add('active'); }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (pulling) { pulling = false; ptr.classList.remove('active'); window.location.reload(); }
  }, { passive: true });
})();

/* ── v110: Register PWA install prompt ── */
(function initPWAInstall() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    deferredPrompt = e;
    // Show install banner after 8 seconds if not already installed
    setTimeout(() => {
      if (!deferredPrompt) return;
      const dismissed = sessionStorage.getItem('hr.pwaInstallDismissed');
      if (dismissed) return;
      const banner = document.createElement('div');
      banner.className = 'hr102-install-banner is-visible';
      banner.innerHTML = `
        <span>📲 أضف التطبيق لشاشتك الرئيسية للوصول السريع</span>
        <button class="hr102-install-btn" type="button">تثبيت</button>
        <button class="hr102-install-dismiss" type="button" aria-label="إغلاق">✕</button>
      `;
      banner.querySelector('.hr102-install-btn').addEventListener('click', async () => {
        banner.remove();
        if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
      });
      banner.querySelector('.hr102-install-dismiss').addEventListener('click', () => {
        sessionStorage.setItem('hr.pwaInstallDismissed','1');
        banner.remove();
      });
      document.body.appendChild(banner);
    }, 8000);
  });
})();
