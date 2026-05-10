(function HR_v106_MobileStability(){
  'use strict';
  const VERSION = 'v39-consolidated-stable-110';
  const root = document.documentElement;
  if (root.dataset.v106MobileStability === '1') return;
  root.dataset.v106MobileStability = '1';

  function normalizeBrokenMetrics(scope=document){
    scope.querySelectorAll('.metric strong,.metric-card strong,.exec-metric strong,.employee-stat strong,.compact-metric-badge strong').forEach((el)=>{
      const value = String(el.textContent || '').trim();
      if (!value || value === '.' || value === '-' || value.toLowerCase() === 'nan' || value.toLowerCase() === 'undefined') {
        el.textContent = '0';
      }
    });
  }

  function fixButtons(scope=document){
    scope.querySelectorAll('button:not([type])').forEach((btn)=>{ btn.type = 'button'; });
    scope.querySelectorAll('.password-toggle').forEach((btn)=>{
      btn.type = 'button';
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      const txt = (btn.textContent || '').trim();
      if (!txt || txt === 'عرض' || txt === 'Show') btn.textContent = pressed ? 'إخفاء' : 'إظهار';
    });
  }

  function scrollActiveNav(){
    document.querySelector('.executive-tabs .is-active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    document.querySelector('.employee-bottom-nav .is-active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
  }

  function showLocalCorsWarning(message){
    if (document.querySelector('.hr-cors-local-warning')) return;
    const isLocal = /^127\.0\.0\.1$|^localhost$/.test(location.hostname);
    if (!isLocal) return;
    const box = document.createElement('div');
    box.className = 'hr-cors-local-warning';
    box.setAttribute('role','status');
    box.innerHTML = '<strong>تنبيه تشغيل محلي</strong><br>' +
      'Supabase يرفض هذا المنفذ المحلي. شغّل المشروع على <b>127.0.0.1:5500</b> أو أضف المنفذ الحالي لقائمة CORS/Allowed Origins في Supabase.<br>' +
      '<button type="button">إخفاء</button>';
    box.querySelector('button')?.addEventListener('click',()=>box.remove());
    document.body.appendChild(box);
    setTimeout(()=>box.remove(), 16000);
  }

  // Detect the exact repeated CORS case from local testing without crashing the UI.
  window.addEventListener('unhandledrejection', (event)=>{
    const reason = String(event.reason?.message || event.reason || '');
    if (/Failed to fetch|NetworkError|ERR_FAILED/i.test(reason) && /^127\.0\.0\.1$|^localhost$/.test(location.hostname)) {
      showLocalCorsWarning(reason);
    }
  });
  window.addEventListener('error', (event)=>{
    const msg = String(event.message || '');
    if (/Access-Control-Allow-Origin|CORS|Failed to fetch|ERR_FAILED/i.test(msg)) showLocalCorsWarning(msg);
  }, true);
  window.addEventListener('hr:local-cors-warning', (event)=>{
    showLocalCorsWarning(String(event.detail?.message || 'CORS'));
  });

  // Catch browser console CORS text emitted as fetch failures by wrapping fetch lightly for local diagnostics only.
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function' && !window.__HR_V106_FETCH_WRAPPED__) {
    window.__HR_V106_FETCH_WRAPPED__ = true;
    window.fetch = async function(input, init){
      try {
        return await nativeFetch(input, init);
      } catch (error) {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (/supabase\.co\/rest\/v1\//.test(url) && /^127\.0\.0\.1$|^localhost$/.test(location.hostname)) {
          showLocalCorsWarning(error?.message || 'CORS');
        }
        throw error;
      }
    };
  }

  function apply(scope=document){
    normalizeBrokenMetrics(scope);
    fixButtons(scope);
    scrollActiveNav();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>apply(), { once:true });
  else apply();

  let timer = null;
  new MutationObserver((mutations)=>{
    if (!mutations.some((m)=>m.addedNodes.length)) return;
    clearTimeout(timer);
    timer = setTimeout(()=>apply(), 80);
  }).observe(document.body || root, { childList:true, subtree:true });

  window.addEventListener('hashchange', ()=>setTimeout(scrollActiveNav, 80), { passive:true });
  window.addEventListener('resize', ()=>setTimeout(scrollActiveNav, 120), { passive:true });
  console.info('[HR v106] mobile stability loaded ✓', VERSION);
})();
