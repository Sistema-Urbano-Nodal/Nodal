(() => {
  'use strict';
  // Capture only the invitation hash, then remove every callback parameter
  // before any other page script, link or resource can use the URL.
  const fragment=new URLSearchParams(location.hash.slice(1));
  let tokenHash=!fragment.has('access_token')&&!fragment.has('refresh_token')?fragment.get('token_hash')||'':'';
  for(const key of [...fragment.keys()])fragment.delete(key);
  if(!/^[a-zA-Z0-9_-]{32,512}$/.test(tokenHash))tokenHash='';
  history.replaceState(null,'','/accept-invitation.html');
  // Bytes of UTF-8 the auth provider counts (it accepts at most 72): accents take two, most emoji four.
  const utf8Bytes=value=>{let n=0;for(const ch of value){const c=ch.codePointAt(0);n+=c<0x80?1:c<0x800?2:c<0x10000?3:4;}return n;};
  function start(){
    const {t,apply,rows}=window.nodalInvitationI18n;
    const form=document.getElementById('invitationForm'),message=document.getElementById('recoveryMessage'),title=document.getElementById('invitationTitle');
    const name=document.getElementById('invitationName'),password=document.getElementById('invitationPassword'),confirmation=document.getElementById('invitationConfirm');
    const submit=document.getElementById('invitationSubmit'),signIn=document.getElementById('invitationSignIn');
    // unsure: an earlier try got no answer, so the invitation may already have been used to save the password.
    let busy=false,unsure=false;
    function show(key){message.dataset.invitationText=key;message.textContent=t(key);message.hidden=false;}
    function finish(key,heading='invalidTitle'){
      tokenHash='';form.hidden=true;password.value='';confirmation.value='';title.dataset.invitationText=heading;show(key);apply();
    }
    // A request without a readable answer throws {lost}: 'offline' when fetch rejects (no network, or the connection
    // dropped), 'timeout' after 45 s, 'unreadable' when the reply is not NODAL's JSON (a gateway error page, a venue
    // Wi-Fi sign-in page). None of them says whether the server acted on it.
    async function send(body){
      // Safari before 16 (every iOS 15 browser) has no AbortSignal.timeout; there the request simply runs without the time limit.
      const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(45000):undefined;
      let response;
      try{response=await fetch('/api/auth/course-invitation/complete',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),...(signal?{signal}:{})});}
      catch(error){throw {lost:error?.name==='TypeError'||globalThis.navigator?.onLine===false?'offline':'timeout'};}
      try{return await response.json();}catch{throw {lost:'unreadable'};}
    }
    function invalid(input,key){
      input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby','recoveryMessage');show(key);input.focus();
    }
    if(tokenHash){form.hidden=false;}else finish('invitation_invalid');
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      if(!tokenHash){finish('invitation_invalid');return;}
      for(const input of [name,password,confirmation]){input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');}
      if(name.value.trim().length<2||name.value.trim().length>120||/[\u0000-\u001f\u007f]/.test(name.value)){invalid(name,'nameLength');return;}
      if(password.value.length<8||utf8Bytes(password.value)>72){invalid(password,'invitation_password_length');return;}
      if(password.value!==confirmation.value){invalid(confirmation,'mismatch');return;}
      busy=true;form.setAttribute('aria-busy','true');submit.disabled=true;submit.dataset.invitationText='saving';message.hidden=true;apply();
      try{
        const result=await send({tokenHash,password:password.value,fullName:name.value.trim()});
        if(result.passwordChanged===true){
          const courseId=Array.isArray(result.courseIds)?result.courseIds.find(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)):null;
          if(result.code==='invitation_enrollment_closed'){finish('invitation_enrollment_closed','doneTitle');return;}
          if(courseId)signIn.href='/login.html?next='+encodeURIComponent('/course.html?id='+courseId);
          finish(!courseId||['invitation_enrollment_pending','invitation_partial'].includes(result.code)?'invitation_enrollment_pending':'done','doneTitle');
        }else{
          // After a try that got no answer, "already used" most likely means that try went through.
          const key=unsure&&result.code==='invitation_invalid'?'invitation_uncertain':Object.hasOwn(rows,result.code)?result.code:'invitation_uncertain';
          if(['invitation_password_length','invitation_rate','invitation_forbidden','invitation_name'].includes(key))show(key);
          else finish(key);
        }
      }catch(error){
        // No answer: the token and the form stay, so trying again costs nothing. A retry cannot use the invitation
        // twice, because the provider refuses a used token; only a server answer lets the invitation go.
        if(error?.lost){unsure=true;show(error.lost==='offline'?'invitation_connection':'invitation_retry');}
        else finish('invitation_uncertain');
      }
      finally{
        busy=false;form.setAttribute('aria-busy','false');submit.disabled=false;submit.dataset.invitationText='accept';apply();
        // Disabling the button while sending dropped focus to the page; give it back unless the person moved on.
        if(!form.hidden&&(!document.activeElement||document.activeElement===document.body))submit.focus();
      }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
