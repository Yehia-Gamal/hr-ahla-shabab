(function HR_v109_FinalSystemFixes(){
  'use strict';
  const VERSION='v109-final-system-fixes';
  const root=document.documentElement;
  if(root.dataset.v109FinalSystemFixes==='1') return;
  root.dataset.v109FinalSystemFixes='1';

  function removeStaleLiveLocationModals(){
    document.querySelectorAll('[data-live-location-alert]').forEach((node)=>{
      const id=node.getAttribute('data-live-location-alert')||'';
      if(!id || id.startsWith('note') || id.startsWith('notif')) node.remove();
    });
  }

  function compactFloatingUi(){
    document.querySelectorAll('.attendance-floating-reminder,.push-explain-overlay,.live-location-alert-backdrop').forEach((el)=>{
      el.classList.add('v109-compact-floating');
      if(el.matches('.attendance-floating-reminder') && (Notification.permission==='granted'||Notification.permission==='denied')) el.remove();
    });
    document.querySelectorAll('.hr-toast,.hr-qc-toast').forEach((el,idx)=>{ if(idx>0) el.remove(); });
  }

  function normalizeButtons(scope=document){
    scope.querySelectorAll('button,.button').forEach((btn)=>{
      btn.classList.add('v109-safe-button');
      if(btn.tagName==='BUTTON' && !btn.type) btn.type='button';
    });
  }

  function closeMoreOnRoute(){
    document.querySelectorAll('.employee-more-sheet').forEach((s)=>s.classList.add('hidden'));
    document.querySelectorAll('.employee-more-backdrop').forEach((b)=>b.classList.add('hidden'));
    document.querySelector('[data-more-menu]')?.setAttribute('aria-expanded','false');
  }

  function fixMoreSheet(){
    const sheet=document.querySelector('.employee-more-sheet:not(.hidden)');
    if(!sheet) return;
    sheet.querySelector('.more-sheet-grid')?.scrollTo({top:0,behavior:'instant'});
    const close=sheet.querySelector('[data-close-more]');
    if(close){ close.textContent='×'; close.setAttribute('aria-label','إغلاق'); }
  }

  function annotateKpiGate(){
    const form=document.querySelector('#kpi-self-form');
    if(!form || form.dataset.v109Gate) return;
    form.dataset.v109Gate='1';
    const disabled=form.querySelector('button[disabled]');
    if(disabled && !form.querySelector('.v109-kpi-closed-note')){
      const note=document.createElement('div');
      note.className='v109-kpi-closed-note';
      note.textContent='التقييم مغلق حاليًا. لا يمكن الرفع إلا بعد فتح دورة التقييم رسميًا من السكرتير التنفيذي.';
      form.prepend(note);
    }
  }

  function enhanceLocationCards(scope=document){
    scope.querySelectorAll('.location-history-item').forEach((item)=>{
      item.classList.add('v109-location-card');
      item.querySelectorAll('small').forEach((small)=>{
        if(/لم يتم تحديد عنوان نصي بعد/.test(small.textContent||'')) small.textContent='آخر موقع فعلي مسجل — افتح الخريطة للتفاصيل';
      });
    });
  }

  function apply(scope=document){
    normalizeButtons(scope);
    compactFloatingUi();
    removeStaleLiveLocationModals();
    enhanceLocationCards(scope);
    annotateKpiGate();
  }

  document.addEventListener('click',(event)=>{
    if(event.target.closest('[data-route]')) setTimeout(closeMoreOnRoute,50);
    if(event.target.closest('[data-more-menu]')) setTimeout(fixMoreSheet,80);
    if(event.target.closest('[data-confirm], [data-cancel], .push-explain-overlay button, .attendance-floating-reminder button')) setTimeout(compactFloatingUi,120);
  },true);
  window.addEventListener('hashchange',()=>setTimeout(()=>{closeMoreOnRoute(); apply();},80));
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>apply(),{once:true}); else apply();
  let timer=0;
  new MutationObserver((mutations)=>{
    if(!mutations.some((m)=>m.addedNodes.length)) return;
    clearTimeout(timer); timer=setTimeout(()=>apply(),120);
  }).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[HR v109] final system fixes loaded ✓', VERSION);
})();
