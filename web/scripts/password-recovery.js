(() => {
  'use strict';
  const {rt,apply}=window.nodalRecoveryI18n;
  const requestForm=document.getElementById('recoveryRequest');
  const resetForm=document.getElementById('recoveryReset');
  const message=document.getElementById('recoveryMessage');
  const email=document.getElementById('recoveryEmail');
  const password=document.getElementById('recoveryPassword');
  const confirm=document.getElementById('recoveryConfirm');
  const title=document.getElementById('recoveryTitle');
  const another=document.getElementById('recoveryAnother');
  const params=new URLSearchParams(location.search);
  let code=params.get('code')||'',busy=false;
  const providerError=params.has('error')||Boolean(location.hash);
  // No credentials enter storage or a general NODAL session. Remove callback
  // parameters before users follow links; keep the one-use code only in memory.
  history.replaceState(null,'','/reset-password.html');
  function show(key){message.dataset.recoveryText=key;message.textContent=rt(key);message.hidden=false;}
  function heading(key){title.dataset.recoveryText=key;title.textContent=rt(key);}
  function requestMode(){code='';resetForm.hidden=true;requestForm.hidden=false;another.hidden=true;heading('requestTitle');}
  requestForm.hidden=Boolean(code);resetForm.hidden=!code;
  another.hidden=!code;heading(code?'newTitle':'requestTitle');
  if(providerError&&!code)show('recovery_invalid');
  another.addEventListener('click',()=>{if(busy)return;requestMode();message.hidden=true;email.focus();});
  function setBusy(form,value){
    busy=value;form.setAttribute('aria-busy',String(value));another.disabled=value;
    for(const input of [email,password,confirm])input.disabled=value;
    for(const current of [requestForm,resetForm])current.querySelector('button[type="submit"]').disabled=value;
  }
  async function post(path,body){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    const data=await response.json();
    return {status:response.status,...data};
  }
  requestForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||requestForm.hidden)return;
    if(!requestForm.checkValidity()){requestForm.reportValidity();return;}
    const button=requestForm.querySelector('button[type="submit"]');setBusy(requestForm,true);button.dataset.recoveryText='sending';apply();
    try{
      const result=await post('/api/auth/recovery/request',{email:email.value.trim()});
      show(result.ok?'sent':result.code in window.nodalRecoveryI18n.rows?result.code:'recovery_unavailable');
    }catch{show('recovery_unavailable');}
    finally{setBusy(requestForm,false);button.dataset.recoveryText='request';apply();}
  });
  resetForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||resetForm.hidden)return;
    if(!code){show('recovery_invalid');requestMode();return;}
    if(password.value.length<8||password.value.length>160){show('recovery_password_length');return;}
    if(password.value!==confirm.value){show('mismatch');return;}
    const button=resetForm.querySelector('button[type="submit"]');setBusy(resetForm,true);button.dataset.recoveryText='saving';apply();
    try{
      const result=await post('/api/auth/recovery/complete',{code,password:password.value});
      if(result.passwordChanged){code='';resetForm.hidden=true;password.value='';confirm.value='';heading('doneTitle');show(result.code||'done');}
      else{
        show(result.code in window.nodalRecoveryI18n.rows?result.code:'recovery_uncertain');
        if(!['recovery_password_length','recovery_rate','recovery_forbidden'].includes(result.code))requestMode();
      }
    }catch{show('recovery_uncertain');requestMode();}
    finally{setBusy(resetForm,false);button.dataset.recoveryText='save';apply();}
  });
})();
