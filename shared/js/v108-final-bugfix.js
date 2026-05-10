(function HR_v108_FinalBugfix(){
  'use strict';
  const VERSION='v108-final-bugfix';
  const root=document.documentElement;
  if(root.dataset.v108FinalBugfix==='1') return;
  root.dataset.v108FinalBugfix='1';
  const isLocal=()=>/^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const fakeJson=(payload)=>new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});

  // Preempt the repeated local CORS storm for employee_tasks in local testing only.
  if(typeof window.fetch==='function'&&!window.__HR_V108_FETCH_GUARD__){
    const nativeFetch=window.fetch.bind(window);
    window.__HR_V108_FETCH_GUARD__=true;
    window.fetch=function(input,init){
      const url=typeof input==='string'?input:String(input&&input.url||'');
      if(isLocal() && /supabase\.co\/rest\/v1\/employee_tasks\b/.test(url) && location.port && location.port!=='5502'){
        window.dispatchEvent(new CustomEvent('hr:local-cors-warning',{detail:{message:'employee_tasks تم تعطيلها محليًا لهذا المنفذ لتجنب CORS. استخدم 5502 أو أضف المنفذ في Supabase.'}}));
        return Promise.resolve(fakeJson([]));
      }
      return nativeFetch(input,init);
    };
  }

  function normalizePasswordToggles(scope=document){
    scope.querySelectorAll('[data-toggle-password],.password-toggle').forEach((btn)=>{
      btn.type='button';
      btn.classList.add('v108-password-toggle');
      const input=btn.closest('.login-password-field,.password-field,label,.employee-form-grid,.gate')?.querySelector('input[type="password"],input[type="text"]');
      if(input) {
        const wrap=input.closest('.login-password-field,.password-field') || input.parentElement;
        wrap?.classList?.add('v108-password-wrap');
      }
      const visible=input?.type==='text' || btn.getAttribute('aria-pressed')==='true';
      btn.textContent=visible?'إخفاء':'إظهار';
    });
  }

  function cleanupPushOverlays(){
    document.querySelectorAll('.push-explain-overlay').forEach((overlay)=>{
      if(overlay.dataset.v108Clean) return;
      overlay.dataset.v108Clean='1';
      overlay.addEventListener('click',(event)=>{
        if(event.target.matches('[data-confirm],[data-cancel],button')) setTimeout(()=>overlay.remove(),120);
      },true);
      setTimeout(()=>{ if(document.body.contains(overlay)) overlay.remove(); }, 30000);
    });
  }

  function fixMoreDrawer(scope=document){
    scope.querySelectorAll('.more-drawer-body,.more-sheet-grid').forEach((el)=>{
      el.style.overflowY='auto';
      el.style.webkitOverflowScrolling='touch';
    });
    scope.querySelectorAll('.more-drawer.is-open,.employee-more-sheet:not(.hidden)').forEach((el)=>{
      const body=el.querySelector('.more-drawer-body,.more-sheet-grid');
      if(body && !el.dataset.v108Opened){ body.scrollTop=0; el.dataset.v108Opened='1'; }
    });
  }

  function compactToasts(scope=document){
    scope.querySelectorAll('.hr-toast,.hr-qc-toast,.online-restored-banner,.offline-banner,.sw-update-banner').forEach((el)=>{
      el.classList.add('v108-compact-toast');
      if((el.textContent||'').length>140) el.textContent=(el.textContent||'').trim().slice(0,140)+'…';
    });
    document.querySelectorAll('.hr-toast,.hr-qc-toast').forEach((el,idx)=>{ if(idx>0) el.remove(); });
  }

  function trimPushButtons(scope=document){
    scope.querySelectorAll('.v10-permissions-row,.hr-permissions-row,.compact-actions').forEach((row)=>{
      const push=[...row.querySelectorAll('[data-enable-push],[data-enable-notifications]')];
      push.slice(1).forEach((btn)=>btn.remove());
      push.forEach((btn)=>{ btn.textContent='🔔 تفعيل الإشعارات'; btn.classList.add('primary'); btn.classList.remove('ghost'); });
    });
  }

  function closeFloatingAfterPermission(){
    if(!('Notification' in window)) return;
    if(Notification.permission==='granted' || Notification.permission==='denied'){
      document.querySelectorAll('.attendance-floating-reminder').forEach((el)=>el.remove());
    }
  }

  function makeKpiTotalSticky(scope=document){
    const form=scope.querySelector?.('#kpi-self-form') || document.querySelector('#kpi-self-form');
    if(!form || form.dataset.v108Kpi) return;
    form.dataset.v108Kpi='1';
    const update=()=>{
      const weights={targetPercent:40,efficiencyPercent:20,attendancePercent:20,quranPercent:5,prayerPercent:5,conductPercent:5,initiativesPercent:5};
      const total=Object.entries(weights).reduce((sum,[name,w])=>sum+(Number(form.elements[name]?.value||0)*w/100),0).toFixed(1);
      document.querySelector('[data-kpi-total]')?.replaceChildren(document.createTextNode(total+'%'));
    };
    form.addEventListener('input',update,true);
    update();
  }

  function apply(scope=document){
    normalizePasswordToggles(scope);
    cleanupPushOverlays();
    fixMoreDrawer(scope);
    compactToasts(scope);
    trimPushButtons(scope);
    closeFloatingAfterPermission();
    makeKpiTotalSticky(scope);
  }

  document.addEventListener('click',(event)=>{
    const toggle=event.target.closest('[data-toggle-password],.password-toggle');
    if(toggle){
      setTimeout(()=>normalizePasswordToggles(document),0);
      return;
    }
    if(event.target.closest('[data-enable-push],[data-enable-notifications],[data-cancel],[data-confirm]')){
      setTimeout(()=>{ cleanupPushOverlays(); closeFloatingAfterPermission(); compactToasts(); },260);
    }
    if(event.target.closest('[data-more-menu],[data-route="more"]')) setTimeout(()=>fixMoreDrawer(),80);
  },true);

  window.addEventListener('hr:local-cors-warning',(event)=>{
    if(document.querySelector('.hr-cors-local-warning')) return;
    const box=document.createElement('div');
    box.className='hr-cors-local-warning hr-toast ok is-visible';
    box.textContent=String(event.detail?.message||'تنبيه تشغيل محلي');
    document.body.appendChild(box);
    setTimeout(()=>box.remove(),9000);
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>apply(),{once:true}); else apply();
  let t=0;
  new MutationObserver((mutations)=>{
    if(!mutations.some(m=>m.addedNodes.length)) return;
    clearTimeout(t); t=setTimeout(()=>apply(),80);
  }).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[HR v108] final bugfix loaded ✓', VERSION);
})();
