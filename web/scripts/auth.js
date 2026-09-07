(() => {
  'use strict';

  function safeReturnPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard.html';
    if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/dashboard.html';
    try {
      const parsed = new URL(value, location.origin);
      if (parsed.origin !== location.origin) return '/dashboard.html';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '/dashboard.html';
    }
  }

  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/courses.html';
  const safeNext = safeReturnPath(next);

  // These messages belong to authentication only; the public homepage dictionary
  // and its cache version do not need to change with form feedback.
  const messages = {
    email:['Enter a valid email address.','Escribe un correo electrónico válido.','Digite um e-mail válido.'],
    name:['Enter your name using at least 2 characters.','Escribe tu nombre con al menos 2 caracteres.','Digite seu nome com pelo menos 2 caracteres.'],
    passwordRequired:['Enter your password.','Escribe tu contraseña.','Digite sua senha.'],
    passwordLength:['Use 8–160 characters for your password.','Usa entre 8 y 160 caracteres en tu contraseña.','Use entre 8 e 160 caracteres na sua senha.'],
    invalidCredentials:['Email or password is incorrect.','Correo o contraseña incorrectos.','E-mail ou senha incorretos.'],
    confirmEmail:['Confirm your email before signing in.','Confirma tu correo antes de iniciar sesión.','Confirme seu e-mail antes de entrar.'],
    confirmation:['Check your email and confirm your account. If you already confirmed it, sign in.','Revisa tu correo y confirma tu cuenta. Si ya la confirmaste, inicia sesión.','Confira seu e-mail e confirme sua conta. Se já confirmou, entre.'],
    confirmationUnavailable:['Confirmation email is temporarily unavailable. Try again later.','El correo de confirmación no está disponible temporalmente. Inténtalo más tarde.','O e-mail de confirmação está temporariamente indisponível. Tente novamente mais tarde.'],
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
  };
  const t = key => messages[key][({en:0,es:1,pt:2})[window.nodalI18n?.lang]??0];
  const $ = id => document.getElementById(id);
  const feedback = new Map(), forms = [];
  const render = () => {
    feedback.forEach((key,node)=>{node.textContent=t(key);});
    forms.forEach(state=>{state.submit.textContent=t(state.busy?state.pendingLabel:state.label);});
  };
  const show = (node,key,input) => {
    feedback.set(node,key);node.textContent=t(key);node.hidden=false;
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
      res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
      data=await res.json();
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
      if(signup&&(password.value.length<8||password.value.length>160)){show(state.error,'passwordLength',password);return;}
      setBusy(state,true);let redirecting=false;
      try{
        const data=await post('/api/auth/'+(signup?'signup':'login'),{email:email.value.trim(),password:password.value,...(signup?{fullName:name.value.trim()}:{})},signup);
        if(signup&&data.requiresEmailConfirmation){show(state.error,'confirmation');return;}
        redirecting=true;location.assign(safeNext);
      }catch(error){show(state.error,error.key||'connection');}
      finally{if(!redirecting)setBusy(state,false);}
    });
  }
  setup(false);setup(true);window.nodalI18n?.onChange(render);
})();
