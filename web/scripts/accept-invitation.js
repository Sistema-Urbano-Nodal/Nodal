(() => {
  'use strict';
  // Capture only the invitation hash, then remove every callback parameter
  // before any other page script, link or resource can use the URL.
  const fragment=new URLSearchParams(location.hash.slice(1));
  let tokenHash=!fragment.has('access_token')&&!fragment.has('refresh_token')?fragment.get('token_hash')||'':'';
  for(const key of [...fragment.keys()])fragment.delete(key);
  if(!/^[a-zA-Z0-9_-]{32,512}$/.test(tokenHash))tokenHash='';
  history.replaceState(null,'','/accept-invitation.html');
  function start(){
    const {t,apply,rows}=window.nodalInvitationI18n;
    const form=document.getElementById('invitationForm'),message=document.getElementById('recoveryMessage'),title=document.getElementById('invitationTitle');
    const name=document.getElementById('invitationName'),password=document.getElementById('invitationPassword'),confirmation=document.getElementById('invitationConfirm');
    const submit=document.getElementById('invitationSubmit'),signIn=document.getElementById('invitationSignIn');
    let busy=false;
    function show(key){message.dataset.invitationText=key;message.textContent=t(key);message.hidden=false;}
    function finish(key,heading='invalidTitle'){
      tokenHash='';form.hidden=true;password.value='';confirmation.value='';title.dataset.invitationText=heading;show(key);apply();
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
      if(password.value.length<8||password.value.length>160){invalid(password,'invitation_password_length');return;}
      if(password.value!==confirmation.value){invalid(confirmation,'mismatch');return;}
      busy=true;form.setAttribute('aria-busy','true');submit.disabled=true;submit.dataset.invitationText='saving';message.hidden=true;apply();
      try{
        const response=await fetch('/api/auth/course-invitation/complete',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({tokenHash,password:password.value,fullName:name.value.trim()}),signal:AbortSignal.timeout(45000)});
        const result=await response.json();
        if(result.passwordChanged===true){
          const courseId=Array.isArray(result.courseIds)?result.courseIds.find(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)):null;
          if(courseId)signIn.href='/login.html?next='+encodeURIComponent('/course.html?id='+courseId);
          finish(!courseId||['invitation_enrollment_pending','invitation_partial'].includes(result.code)?'invitation_enrollment_pending':'done','doneTitle');
        }else{
          const key=Object.hasOwn(rows,result.code)?result.code:'invitation_uncertain';
          if(['invitation_password_length','invitation_rate','invitation_forbidden','invitation_name'].includes(key))show(key);
          else finish(key);
        }
      }catch{finish('invitation_uncertain');}
      finally{busy=false;form.setAttribute('aria-busy','false');submit.disabled=false;submit.dataset.invitationText='accept';apply();}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
