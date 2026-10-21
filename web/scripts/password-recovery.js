(() => {
  'use strict';
  const {rt,apply}=window.nodalRecoveryI18n;
  // Bytes of UTF-8 the auth provider counts (it accepts at most 72): accents take two, most emoji four.
  const utf8Bytes=value=>{let n=0;for(const ch of value){const c=ch.codePointAt(0);n+=c<0x80?1:c<0x800?2:c<0x10000?3:4;}return n;};
  const requestForm=document.getElementById('recoveryRequest');
  const resetForm=document.getElementById('recoveryReset');
  const message=document.getElementById('recoveryMessage');
  const email=document.getElementById('recoveryEmail');
  const password=document.getElementById('recoveryPassword');
  const confirm=document.getElementById('recoveryConfirm');
  const title=document.getElementById('recoveryTitle');
  const another=document.getElementById('recoveryAnother');
  const params=new URLSearchParams(location.search);
  // unsure: an earlier save got no answer, so the password may already be saved with this code.
  let code=params.get('code')||'',busy=false,unsure=false;
  const providerError=params.has('error')||Boolean(location.hash);
  // No credentials enter storage or a general NODAL session. Remove callback
  // parameters before users follow links; keep the one-use code only in memory.
  history.replaceState(null,'','/reset-password.html');
  function show(key){message.dataset.recoveryText=key;message.textContent=rt(key);message.hidden=false;}
  // Emptied, not hidden, while a request is sent: a live region that stays on the page announces its next text even
  // when it repeats the last one (two lost answers in a row); one that reappears may not be announced at all.
  function clear(){delete message.dataset.recoveryText;message.textContent='';}
  function heading(key){title.dataset.recoveryText=key;title.textContent=rt(key);}
  function requestMode(){code='';resetForm.hidden=true;requestForm.hidden=false;another.hidden=true;heading('requestTitle');}
  requestForm.hidden=Boolean(code);resetForm.hidden=!code;
  another.hidden=!code;heading(code?'newTitle':'requestTitle');
  if(providerError&&!code)show('recovery_invalid');
  another.addEventListener('click',()=>{if(busy)return;requestMode();clear();email.focus();});
  function setBusy(form,value){
    busy=value;form.setAttribute('aria-busy',String(value));another.disabled=value;
    for(const input of [email,password,confirm])input.disabled=value;
    for(const current of [requestForm,resetForm])current.querySelector('button[type="submit"]').disabled=value;
  }
  // A request without a readable answer throws {lost}: 'offline' when fetch rejects (no network, or the connection
  // dropped), 'timeout' after 45 s, 'unreadable' when the reply is not NODAL's JSON (a gateway error page, a venue
  // Wi-Fi sign-in page). None of them says whether the server acted on it.
  async function post(path,body){
    // Safari before 16 (every iOS 15 browser) has no AbortSignal.timeout; there the request simply runs without the time limit.
    const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(45000):undefined;
    let response;
    try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),...(signal?{signal}:{})});}
    catch(error){throw {lost:error?.name==='TypeError'||globalThis.navigator?.onLine===false?'offline':'timeout'};}
    // Vercel's Security Checkpoint (x-vercel-mitigated) or another non-JSON 403 stopped the request before NODAL: only a
    // page load passes it, so the page says to reload, as sign-in does.
    if(response.headers?.get('x-vercel-mitigated'))return {status:response.status,code:'recovery_forbidden'};
    try{return {status:response.status,...await response.json()};}
    catch{if(response.status===403)return {status:403,code:'recovery_forbidden'};throw {lost:'unreadable'};}
  }
  // The submit button is disabled while sending, which drops focus to the page; give it back unless the person moved on.
  // gone: a form just hidden. Chrome leaves focus on its button until the next frame, then drops it to the page.
  function refocus(target,gone){const active=document.activeElement;if(!active||active===document.body||gone?.contains(active))target.focus();}
  // When an answer ends the reset, the form that held focus is gone; the heading names what the page offers now.
  function focusTitle(){title.tabIndex=-1;refocus(title,resetForm);}
  requestForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||requestForm.hidden)return;
    if(!requestForm.checkValidity()){requestForm.reportValidity();return;}
    const button=requestForm.querySelector('button[type="submit"]');setBusy(requestForm,true);clear();button.dataset.recoveryText='sending';apply();
    try{
      const result=await post('/api/auth/recovery/request',{email:email.value.trim()});
      show(result.ok?'sent':result.code in window.nodalRecoveryI18n.rows?result.code:'recovery_unavailable');
    }catch(error){show(error?.lost==='unreadable'?'recovery_unavailable':'connection');}
    finally{setBusy(requestForm,false);button.dataset.recoveryText='request';apply();refocus(button);}
  });
  resetForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||resetForm.hidden)return;
    if(!code){show('recovery_invalid');requestMode();return;}
    if(password.value.length<8||utf8Bytes(password.value)>72){show('recovery_password_length');return;}
    if(password.value!==confirm.value){show('mismatch');return;}
    const button=resetForm.querySelector('button[type="submit"]');setBusy(resetForm,true);clear();button.dataset.recoveryText='saving';apply();
    try{
      const result=await post('/api/auth/recovery/complete',{code,password:password.value});
      if(result.passwordChanged){code='';resetForm.hidden=true;password.value='';confirm.value='';heading('doneTitle');show(result.code||'done');}
      else{
        // After a save that got no answer, "already used" most likely means that save went through.
        show(unsure&&result.code==='recovery_invalid'?'recovery_uncertain':result.code in window.nodalRecoveryI18n.rows?result.code:'recovery_uncertain');
        if(!['recovery_password_length','recovery_rate','recovery_forbidden','recovery_unavailable'].includes(result.code))requestMode();
      }
    }catch(error){
      // No answer: the code and the form stay, so trying again costs nothing. A retry cannot save twice, because the
      // server refuses a used code with recovery_invalid, and only a server answer lets the link go.
      unsure=true;show(error?.lost==='offline'?'recovery_connection':'recovery_retry');
    }
    finally{setBusy(resetForm,false);button.dataset.recoveryText='save';apply();if(resetForm.hidden)focusTitle();else refocus(button);}
  });
  for(const form of [requestForm,resetForm])form.querySelector('button[type="submit"]').disabled=false;
})();
