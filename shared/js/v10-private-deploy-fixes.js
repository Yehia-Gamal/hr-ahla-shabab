(function(){
  const cfg = (window.HR_SUPABASE_CONFIG = window.HR_SUPABASE_CONFIG || {});
  cfg.attendance = Object.assign({
    qrRequired:false,
    reminderInPageHour:10,
    reminderPushHour:10,
    reminderPushMinute:0,
    gpsSamples:18,
    gpsSampleWindowMs:30000,
    gpsTargetAccuracyMeters:15,
    gpsMaxAcceptableAccuracyMeters:90,
    gpsSafetyBufferMeters:90,
    gpsUncertainReviewOnly:true
  }, cfg.attendance || {}, { qrRequired:false });
  cfg.security = Object.assign({ allowLocalFallback:false }, cfg.security || {});
  try { delete cfg.security.allowLocalDemo; } catch {}
  cfg.cacheVersion = cfg.cacheVersion || 'v31-production-hardening-089';
  cfg.deployment = Object.assign({}, cfg.deployment || {}, { packageVersion: 'v31-production-hardening-089' });
  window.HR_QR_REQUIRED = false;
  window.HR_PRIVATE_DEPLOY_BUNDLE = true;

  function toast(msg,type='ok',ms=5000){
    if(!msg) return;
    document.querySelectorAll('.hr-toast.v10').forEach(t=>t.remove());
    const el=document.createElement('div');
    el.className='hr-toast v10 '+(type==='error'?'error':'ok');
    el.textContent=msg;
    el.setAttribute('role','status');
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

  window.HRToast = toast;
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
      err=>{ toast('لم يتم السماح بالموقع. فعل صلاحية الموقع من إعدادات المتصفح.', 'error'); resolve(null); },
      {enableHighAccuracy:true,timeout:20000,maximumAge:0}
    ));
  };

  document.addEventListener('click', (e)=>{
    const btn=e.target.closest('[data-enable-push],[data-enable-notifications]');
    if(btn && !btn.dataset.hrPushBound){ e.preventDefault(); window.HRExplainAndEnablePush(); }
    const loc=e.target.closest('[data-enable-location]');
    if(loc && !loc.dataset.hrLocationBound){ e.preventDefault(); window.HRExplainAndEnableLocation(); }
  });
})();
