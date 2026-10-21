(() => {
  'use strict';

  // A signup confirmation link lands here with the session tokens (or an error) in the fragment. Sign-in never
  // uses them, so they leave the address bar and the history entry before anything else runs; only the outcome is kept.
  const arrival = (() => { const f = new URLSearchParams((location.hash || '').slice(1)); return f.has('error') || f.has('error_code') ? 'linkExpired' : f.has('access_token') && f.get('type') === 'signup' ? 'confirmed' : null; })();
  if (/(?:^#|&)(?:access_token|refresh_token|error)=/.test(location.hash || '')) history.replaceState(null, '', location.pathname + location.search);

  // Bytes of UTF-8 the auth provider counts (it accepts at most 72): accents take two, most emoji four.
  const utf8Bytes=value=>{let n=0;for(const ch of value){const c=ch.codePointAt(0);n+=c<0x80?1:c<0x800?2:c<0x10000?3:4;}return n;};

  function safeReturnPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard.html';
    if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/dashboard.html';
    try {
      const parsed = new URL(value, location.origin);
      // Dot segments ('/.//host', '/x/..//host') normalise into '//host', which location.assign reads as another site.
      if (parsed.origin !== location.origin || parsed.pathname.startsWith('//')) return '/dashboard.html';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '/dashboard.html';
    }
  }

  // A scan or a protected page opens sign-in with ?next=. People often detour first (password recovery, or a new
  // account's confirmation email) and come back to sign-in without it, so this device remembers the return for a while.
  // A check-in's one-minute code is not remembered: coming back later, the check-in page shows the person's own
  // confirmation or asks for the screen code, so nobody is checked in by someone else's abandoned scan.
  const RETURN_KEY = 'nodal.returnTo', RETURN_TTL = 30 * 60000;
  const storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  const withoutCode = path => {
    const url = new URL(path, location.origin);
    if (url.pathname === '/fiiu-checkin.html') url.searchParams.delete('c');
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const remembered = () => {
    try {
      const saved = JSON.parse(storage?.getItem(RETURN_KEY) || 'null'), age = Date.now() - Number(saved?.at);
      return typeof saved?.path === 'string' && Number.isFinite(age) && age >= 0 && age < RETURN_TTL ? withoutCode(safeReturnPath(saved.path)) : null;
    } catch { return null; }
  };
  const params = new URLSearchParams(location.search);
  const explicit = params.get('next');
  if (explicit) try { storage?.setItem(RETURN_KEY, JSON.stringify({ path: withoutCode(safeReturnPath(explicit)), at: Date.now() })); } catch { /* storage blocked */ }
  // Without a destination, a sign-in opens the member console.
  const safeNext = safeReturnPath(explicit || remembered() || '/dashboard.html');
  const forgetReturn = () => { try { storage?.removeItem(RETURN_KEY); } catch { /* storage blocked */ } };

  // These messages belong to authentication only; the public homepage dictionary
  // and its cache version do not need to change with form feedback.
  const messages = {
    email:['Enter a valid email address.','Escribe un correo electrónico válido.','Digite um e-mail válido.'],
    name:['Enter your name using at least 2 characters.','Escribe tu nombre con al menos 2 caracteres.','Digite seu nome com pelo menos 2 caracteres.'],
    passwordRequired:['Enter your password.','Escribe tu contraseña.','Digite sua senha.'],
    passwordLength:['Use 8–72 characters for your password (fewer with accents or emoji).','Usa entre 8 y 72 caracteres en tu contraseña (menos con tildes o emojis).','Use entre 8 e 72 caracteres na sua senha (menos com acentos ou emojis).'],
    invalidCredentials:['Email or password is incorrect.','Correo o contraseña incorrectos.','E-mail ou senha incorretos.'],
    confirmEmail:["Confirm your email before signing in. Didn't get the email? Check spam, or use Create account again with the same email and password to get a new link.",'Confirma tu correo antes de iniciar sesión. ¿No te llegó? Revisa el spam o vuelve a usar Crear cuenta con el mismo correo y contraseña para recibir otro enlace.','Confirme seu e-mail antes de entrar. Não recebeu? Confira o spam ou use Criar conta de novo com o mesmo e-mail e senha para receber outro link.'],
    // A confirmation opened in a mail app's own browser loses the way back to a check-in, so the person is told to scan again.
    confirmed:['Email confirmed. Sign in to continue. If you were checking in at the FIIU, scan the screen again (or type its code) after signing in.','Correo confirmado. Inicia sesión para continuar. Si estabas registrando tu asistencia en el FIIU, vuelve a escanear la pantalla (o escribe su código) después de iniciar sesión.','E-mail confirmado. Entre para continuar. Se você estava registrando sua presença no FIIU, escaneie a tela de novo (ou digite o código dela) depois de entrar.'],
    linkExpired:['This link expired or was already used. Try signing in. If we ask you to confirm your email, use Create account again with the same email and password to get a new link.','Este enlace venció o ya se usó. Intenta iniciar sesión; si te pedimos confirmar tu correo, vuelve a usar Crear cuenta con el mismo correo y contraseña para recibir otro.','Este link expirou ou já foi usado. Tente entrar; se pedirmos para confirmar seu e-mail, use Criar conta de novo com o mesmo e-mail e senha para receber outro.'],
    confirmation:['Check your email and confirm your account. If you already confirmed it, sign in.','Revisa tu correo y confirma tu cuenta. Si ya la confirmaste, inicia sesión.','Confira seu e-mail e confirme sua conta. Se já confirmou, entre.'],
    // No account exists yet when the email could not be sent, so this never says to sign in.
    confirmationUnavailable:['We could not send the confirmation email right now. Try again in a few minutes. At the FIIU, ask the registration desk for help.','No pudimos enviar el correo de confirmación en este momento. Inténtalo de nuevo en unos minutos. En el FIIU, pide ayuda en la mesa de registro.','Não foi possível enviar o e-mail de confirmação agora. Tente novamente em alguns minutos. No FIIU, peça ajuda na mesa de credenciamento.'],
    rate:['Too many attempts. Wait a few minutes and try again.','Demasiados intentos. Espera unos minutos e inténtalo de nuevo.','Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    forbidden:['Reload this page and try again.','Recarga esta página e inténtalo de nuevo.','Recarregue esta página e tente novamente.'],
    signupFailure:['We could not create the account. If you already confirmed your email, sign in.','No pudimos crear la cuenta. Si ya confirmaste tu correo, inicia sesión.','Não foi possível criar a conta. Se já confirmou seu e-mail, entre.'],
    unavailable:['Sign-in is temporarily unavailable. Please try again.','El inicio de sesión no está disponible temporalmente. Inténtalo de nuevo.','O acesso está temporariamente indisponível. Tente novamente.'],
    connection:['Connection interrupted. Check your connection and try again.','Conexión interrumpida. Comprueba tu conexión e inténtalo de nuevo.','Conexão interrompida. Verifique sua conexão e tente novamente.'],
    timeout:['The request took too long. Check your connection and try again.','La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.','A solicitação demorou demais. Verifique sua conexão e tente novamente.'],
    signIn:['Sign in','Entrar','Entrar'],
    create:['Create account','Crear cuenta','Criar conta'],
    signingIn:['Signing in…','Entrando…','Entrando…'],
    creating:['Creating account…','Creando cuenta…','Criando conta…'],
    forms:['Sign-in forms','Formularios de acceso','Formulários de acesso'],
  };
  const t = key => messages[key][({en:0,es:1,pt:2})[window.nodalI18n?.lang]??0];
  const $ = id => document.getElementById(id);
  const feedback = new Map(), forms = [];
  // login.html names the region around both forms in English; like the submit labels, its name follows the page language here.
  const region = {node:document.querySelector('.auth-grid'),label:'forms'};
  const nameRegion = () => region.node?.setAttribute('aria-label',t(region.label));
  const render = () => {
    nameRegion();
    feedback.forEach((key,node)=>{node.textContent=t(key);});
    forms.forEach(state=>{state.submit.textContent=t(state.busy?state.pendingLabel:state.label);});
  };
  // Good news reads as good news, not in the red error box.
  const okKeys = new Set(['confirmation','confirmed']);
  const show = (node,key,input) => {
    feedback.set(node,key);node.textContent=t(key);node.hidden=false;node.classList.toggle('is-ok',okKeys.has(key));
    if(input){input.setAttribute('aria-invalid','true');input.focus();}
  };
  const clear = state => {
    feedback.delete(state.error);state.error.textContent='';state.error.hidden=true;
    state.inputs.forEach(input=>input.removeAttribute('aria-invalid'));
  };
  const setBusy = (state,value) => {
    state.busy=value;state.submit.disabled=value;state.form.setAttribute('aria-busy',String(value));render();
  };
  function errorKey(status,detail,signup){
    if(/confirm your email before signing in/i.test(detail))return 'confirmEmail';
    if(/confirmation email is temporarily unavailable/i.test(detail))return 'confirmationUnavailable';
    if(status===429)return 'rate';
    if(status===403)return 'forbidden';
    if(/full name is required/i.test(detail))return 'name';
    if(/valid email is required/i.test(detail))return 'email';
    if(/password must be/i.test(detail))return 'passwordLength';
    if(!signup&&[400,401,422].includes(status))return 'invalidCredentials';
    return signup?'signupFailure':'unavailable';
  }
  async function post(path,body,signup){
    let res,data;
    try{
      // Safari before 16 (every iOS 15 browser) has no AbortSignal.timeout; there the request simply runs without the time limit.
      const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(45000):undefined;
      res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
      try{data=await res.json();}
      catch(error){
        // Error pages can be HTML; their HTTP status still identifies the failure.
        // An unreadable success body cannot confirm authentication.
        if(res.ok)throw error;
        data={};
      }
    }catch(error){throw {key:['AbortError','TimeoutError'].includes(error.name)?'timeout':'connection'};}
    if(!res.ok)throw {key:errorKey(res.status,String(data?.error||''),signup)};
    if(!data?.requiresEmailConfirmation&&!data?.user)throw {key:signup?'signupFailure':'unavailable'};
    return data;
  }
  function setup(signup){
    const prefix=signup?'signup':'login',form=$(prefix+'Form');if(!form)return;
    const email=$(prefix+'Email'),password=$(prefix+'Password'),name=signup?$('signupName'):null;
    const state={form,error:$(prefix+'Error'),submit:form.querySelector('button[type="submit"]'),inputs:[email,password,...(name?[name]:[])],busy:false,label:signup?'create':'signIn',pendingLabel:signup?'creating':'signingIn'};
    forms.push(state);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(state.busy)return;clear(state);
      if(signup&&name.value.trim().length<2){show(state.error,'name',name);return;}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())){show(state.error,'email',email);return;}
      // Existing account passwords must not be rejected by a new signup policy.
      if(!password.value){show(state.error,signup?'passwordLength':'passwordRequired',password);return;}
      // The auth provider accepts at most 72 bytes of UTF-8 (bcrypt); accents and emoji take two to four each.
      if(signup&&(password.value.length<8||utf8Bytes(password.value)>72)){show(state.error,'passwordLength',password);return;}
      // A second tap right after the email went out would only hit the provider's resend cooldown; after a minute it resends.
      const sent=state.sent;if(signup&&sent&&sent.email===email.value.trim().toLowerCase()&&Date.now()-sent.at<60000){show(state.error,'confirmation');return;}
      setBusy(state,true);let redirecting=false,field=null;
      try{
        const data=await post('/api/auth/'+(signup?'signup':'login'),{email:email.value.trim(),password:password.value,...(signup?{fullName:name.value.trim()}:{})},signup);
        if(signup&&data.requiresEmailConfirmation){
          state.sent={email:email.value.trim().toLowerCase(),at:Date.now()};const le=$('loginEmail');if(le&&!le.value)le.value=email.value.trim();
          show(state.error,'confirmation');return;
        }
        redirecting=true;forgetReturn();location.assign(safeNext);
      }catch(error){
        const key=error.key||'connection';
        // A refusal about one field sends the person back to it; a wrong password is selected, ready to retype.
        field=({invalidCredentials:password,passwordLength:password,email,name})[key]||null;
        show(state.error,key,field);if(key==='invalidCredentials')password.select();
      }
      finally{
        if(!redirecting){
          setBusy(state,false);
          // The button was disabled while sending, which drops focus to the page; give it back unless the person moved on.
          if(!field&&(!document.activeElement||document.activeElement===document.body))state.submit.focus();
        }
      }
    });
    state.submit.disabled=false;
  }
  setup(false);setup(true);window.nodalI18n?.onChange(render);nameRegion();
  if(arrival&&$('loginError')){show($('loginError'),arrival);$('loginEmail')?.focus();}
  // On a phone the Create account form sits below the sign-in card; the link brings its first field up with the keyboard.
  $('signupLink')?.addEventListener('click',event=>{event.preventDefault();$('signupName')?.focus();});
})();
