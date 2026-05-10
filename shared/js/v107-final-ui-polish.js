(function hrV107FinalPolish(){
  'use strict';
  const log=(msg)=>console.info(`[HR v107] ${msg}`);
  function isCoordText(text='') { return /^\s*-?\d{1,3}\.\d+\s*[,،]\s*-?\d{1,3}\.\d+\s*$/.test(String(text)); }
  function polish(scope=document){
    document.documentElement.classList.add('hr-v107-final-ui');
    // Keep More menu usable on small screens
    document.querySelectorAll('.more-drawer-body,.employee-more-sheet').forEach(el=>{
      el.style.overflowY='auto';
      el.style.webkitOverflowScrolling='touch';
    });
    // Replace raw coordinate labels with user friendly Arabic text while keeping map buttons.
    scope.querySelectorAll('.location-history-item small,.employee-list-item small').forEach(el=>{
      const t=(el.textContent||'').trim();
      if(isCoordText(t)) el.textContent='موقع محفوظ على الخريطة — اضغط زر الخريطة للعرض';
    });
    // Limit notification activation action blocks to one clear primary button where possible.
    scope.querySelectorAll('.compact-actions,.employee-actions-row').forEach(row=>{
      const pushButtons=[...row.querySelectorAll('[data-enable-push],[data-enable-notifications]')];
      if(pushButtons.length>1) pushButtons.slice(1).forEach(btn=>btn.remove());
      pushButtons.forEach(btn=>{
        btn.classList.remove('ghost'); btn.classList.add('primary');
        if(!btn.dataset.v107Label){ btn.dataset.v107Label='1'; btn.textContent='تفعيل إشعارات الجهاز'; }
      });
    });
    // Avoid oversized side buttons inside lists.
    scope.querySelectorAll('.list-item-side .button').forEach(btn=>{
      if(!btn.classList.contains('small')) btn.classList.add('small');
    });
    // Remove KPI approval path if an older cached route renders it.
    scope.querySelectorAll('article.employee-card h2').forEach(h=>{
      if((h.textContent||'').trim()==='مسار الاعتماد') h.closest('article')?.remove();
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>polish(),{once:true}); else polish();
  new MutationObserver(muts=>muts.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType===1) polish(n); }))).observe(document.documentElement,{childList:true,subtree:true});
  log('final UI polish loaded');
})();
