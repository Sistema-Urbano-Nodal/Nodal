import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/scripts/auth.js',import.meta.url),'utf8');
function harness(reply=async()=>({ok:true,status:200,data:{user:{id:'u1'}}}),search='',storage=null,hash=''){
 const nodes={},listeners=[],requests=[];let assigned='',timeout;
 for(const id of ['loginForm','signupForm','loginError','signupError','loginEmail','loginPassword','signupName','signupEmail','signupPassword'])nodes[id]={id,value:'',textContent:'',hidden:true,listeners:{},dataset:{},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(k,f){this.listeners[k]=f;},focus(){this.focused=true;}};
 for(const id of ['loginForm','signupForm']){nodes[id].button={disabled:true,textContent:'',dataset:{},setAttribute(k,v){this[k]=v;}};nodes[id].querySelector=()=>nodes[id].button;}
 const context={document:{getElementById:id=>nodes[id]},URL,URLSearchParams,Error,window:{nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}},location:{origin:'https://nodal.test',pathname:'/login.html',search,hash,assign:path=>assigned=path},history:{calls:[],replaceState(state,title,url){this.calls.push(url);}},...(storage?{localStorage:storage}:{}),AbortSignal:{timeout:ms=>{timeout=ms;return{timeout:ms};}},fetch:async(path,options)=>{requests.push({path,options,body:JSON.parse(options.body)});const result=await reply(path,options);return{ok:result.ok,status:result.status,json:async()=>{if(result.jsonError)throw result.jsonError;return result.data;}};}};
 vm.createContext(context);vm.runInContext(source,context);
 const submit=id=>nodes[id].listeners.submit({preventDefault(){}});
 const valid=()=>{nodes.loginEmail.value='member@example.test';nodes.loginPassword.value='password123';nodes.signupName.value='Test Member';nodes.signupEmail.value='new@example.test';nodes.signupPassword.value='newpassword123';};
 return{nodes,requests,submit,valid,context,assigned:()=>assigned,timeout:()=>timeout,lang:value=>{context.window.nodalI18n.lang=value;nodes.loginForm.button.textContent='main i18n sign-in label';nodes.signupForm.button.textContent='main i18n create label';listeners.forEach(f=>f());}};
}
test('sign-in and signup become usable only after their submit handlers are installed',()=>{
 const h=harness();
 for(const id of ['loginForm','signupForm']){
  assert.equal(typeof h.nodes[id].listeners.submit,'function');
  assert.equal(h.nodes[id].button.disabled,false);
 }
 assert.equal(h.requests.length,0);
});
test('login validates email and required password locally with translated field feedback',async()=>{
 const h=harness();h.lang('pt');await h.submit('loginForm');assert.equal(h.requests.length,0);assert.match(h.nodes.loginError.textContent,/e-mail válido/);assert.equal(h.nodes.loginEmail['aria-invalid'],'true');assert.equal(h.nodes.loginEmail.focused,true);
 h.nodes.loginEmail.value='member@example.test';await h.submit('loginForm');assert.equal(h.requests.length,0);assert.match(h.nodes.loginError.textContent,/senha/);assert.equal(h.nodes.loginPassword['aria-invalid'],'true');assert.equal(h.nodes.loginEmail['aria-invalid'],undefined);
});
test('signup validates name, email and server password limits before requests',async()=>{
 const h=harness();h.valid();h.nodes.signupName.value=' A ';await h.submit('signupForm');assert.equal(h.requests.length,0);assert.match(h.nodes.signupError.textContent,/at least 2/);
 h.nodes.signupName.value='Member';h.nodes.signupEmail.value='invalid';await h.submit('signupForm');assert.equal(h.requests.length,0);
 // The provider counts UTF-8 bytes (at most 72): 37 accented letters are 74 bytes, a 19-emoji password is 76.
 h.nodes.signupEmail.value='new@example.test';for(const password of ['short','x'.repeat(73),'é'.repeat(37),'\u{1F600}'.repeat(19)]){h.nodes.signupPassword.value=password;await h.submit('signupForm');assert.equal(h.requests.length,0);assert.match(h.nodes.signupError.textContent,/8.72/);}
 h.nodes.signupPassword.value='x'.repeat(72);await h.submit('signupForm');assert.equal(h.requests.length,1);
 const accented=harness();accented.valid();accented.nodes.signupPassword.value='é'.repeat(36);await accented.submit('signupForm');assert.equal(accented.requests.length,1);
});
test('login permits existing short passwords and preserves password bytes and safe return query',async()=>{
 const h=harness(undefined,'?next=%2Fcourse.html%3Fid%3Dc1%26module%3Dm1');h.valid();h.nodes.loginEmail.value=' member@example.test ';h.nodes.loginPassword.value=' a ';await h.submit('loginForm');assert.equal(h.requests[0].body.email,'member@example.test');assert.equal(h.requests[0].body.password,' a ');assert.equal(h.assigned(),'/course.html?id=c1&module=m1');
});
test('API errors are localized and visible messages update on a language change without another request',async()=>{
 const h=harness(async()=>({ok:false,status:401,data:{error:'invalid email or password'}}));h.valid();h.lang('pt');await h.submit('loginForm');assert.match(h.nodes.loginError.textContent,/E-mail ou senha/);h.lang('es');assert.match(h.nodes.loginError.textContent,/Correo o contraseña/);assert.equal(h.requests.length,1);assert.equal(h.nodes.loginForm.button.disabled,false);
});
test('confirmation and signup failures remain localizable without leaking provider errors',async()=>{
 const h=harness(async()=>({ok:true,status:202,data:{requiresEmailConfirmation:true}}));h.valid();await h.submit('signupForm');assert.equal(h.assigned(),'');h.lang('pt');assert.match(h.nodes.signupError.textContent,/confirme sua conta/);assert.equal(h.nodes.signupForm.button.disabled,false);
 const failed=harness(async()=>({ok:false,status:502,data:{error:'PRIVATE PROVIDER DETAIL'}}));failed.valid();failed.lang('es');await failed.submit('signupForm');assert.doesNotMatch(failed.nodes.signupError.textContent,/PRIVATE/);assert.match(failed.nodes.signupError.textContent,/crear la cuenta/);
});
test('timeout and offline errors re-enable submission, retain inputs and localize retry feedback',async()=>{
 for(const name of ['TimeoutError','TypeError']){const h=harness(async()=>{throw Object.assign(new Error('sensitive network internals'),{name});});h.valid();h.lang('es');await h.submit('loginForm');assert.equal(h.timeout(),45000);assert.equal(h.nodes.loginForm.button.disabled,false);assert.equal(h.nodes.loginForm['aria-busy'],'false');assert.equal(h.nodes.loginPassword.value,'password123');assert.doesNotMatch(h.nodes.loginError.textContent,/sensitive/);assert.match(h.nodes.loginError.textContent,/conexión|tardó/);}
});
test('pending submissions ignore duplicate submit and busy labels follow language changes',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));h.valid();const first=h.submit('loginForm');await h.submit('loginForm');assert.equal(h.requests.length,1);assert.equal(h.nodes.loginForm['aria-busy'],'true');h.lang('pt');assert.equal(h.nodes.loginForm.button.textContent,'Entrando…');resolve({ok:false,status:429,data:{error:'too many authentication attempts'}});await first;assert.equal(h.nodes.loginForm.button.disabled,false);assert.equal(h.nodes.loginForm.button.textContent,'Entrar');assert.match(h.nodes.loginError.textContent,/Muitas tentativas/);
});
test('return-path guards retain same-origin navigation and reject external and malformed destinations',async()=>{
 for(const next of ['https://attacker.test','//attacker.test','/\\attacker.test','/\nattacker.test','/.//attacker.test/x','/%2e//attacker.test','/x/..//attacker.test','/..//attacker.test','/./%2e/.//attacker.test']){const h=harness(undefined,'?next='+encodeURIComponent(next));h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/dashboard.html');}
});
test('email-confirmation requirement maps separately from forbidden requests',async()=>{
 const h=harness(async()=>({ok:false,status:403,data:{error:'Confirm your email before signing in.'}}));h.valid();h.lang('pt');await h.submit('loginForm');assert.match(h.nodes.loginError.textContent,/Confirme seu e-mail/);assert.equal(h.assigned(),'');
});

test('HTML error responses retain HTTP-specific login and signup guidance',async()=>{
 const cases=[
  [429,'loginForm',/Muitas tentativas/],
  [429,'signupForm',/Muitas tentativas/],
  [403,'loginForm',/Recarregue esta página/],
  [503,'loginForm',/temporariamente indisponível/],
  [503,'signupForm',/Não foi possível criar a conta/],
 ];
 for(const [status,form,expected] of cases){
  const h=harness(async()=>({ok:false,status,jsonError:new SyntaxError('Unexpected token <')}));h.valid();h.lang('pt');
  await h.submit(form);
  assert.match(h.nodes[form==='loginForm'?'loginError':'signupError'].textContent,expected);
  assert.equal(h.nodes[form].button.disabled,false);assert.equal(h.assigned(),'');
  assert.equal(h.nodes.loginPassword.value,'password123');
 }
});

test('unreadable successful authentication responses never redirect and permit retry',async()=>{
 for(const jsonError of [new SyntaxError('Truncated body'),Object.assign(new Error('Timeout'),{name:'TimeoutError'})]){
  const h=harness(async()=>({ok:true,status:200,jsonError}));h.valid();h.lang('pt');await h.submit('loginForm');
  assert.equal(h.assigned(),'');assert.equal(h.nodes.loginForm.button.disabled,false);
  assert.match(h.nodes.loginError.textContent,jsonError.name==='TimeoutError'?/demorou demais/:/Conexão interrompida/);
 }
});

test('real API status variants map to specific feedback and malformed success never redirects',async()=>{
 const cases=[
  [429,'Confirmation email is temporarily unavailable. Please try again later.','signupForm',/correo de confirmación/],
  [429,'too many authentication attempts','loginForm',/Demasiados intentos/],
  [403,'cross-origin request rejected','loginForm',/Recarga esta página/],
  [409,'signup could not be completed','signupForm',/crear la cuenta/],
  [502,'provider unreachable','loginForm',/temporalmente/],
 ];
 for(const [status,error,form,expected] of cases){const h=harness(async()=>({ok:false,status,data:{error}}));h.valid();h.lang('es');await h.submit(form);assert.match(h.nodes[form==='loginForm'?'loginError':'signupError'].textContent,expected);assert.equal(h.nodes[form].button.disabled,false);assert.equal(h.assigned(),'');}
 const h=harness(async()=>({ok:true,status:200,data:{}}));h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'');assert.equal(h.nodes.loginForm.button.disabled,false);
});
test('sign-in and signup still send their request where AbortSignal has no timeout (Safari before 16, every iOS 15 browser)',async()=>{
 for(const form of ['loginForm','signupForm']){const h=harness();h.context.AbortSignal={};h.valid();await h.submit(form);assert.equal(h.requests.length,1,form);assert.equal(h.requests[0].options.signal,undefined);assert.match(h.assigned(),/^\/[a-z]+\.html$/,'the account opens as usual');}
});

// A tiny localStorage: the login page remembers where a sign-in should return to.
const memoryStorage=(entries={})=>({data:{...entries},getItem(k){return k in this.data?this.data[k]:null;},setItem(k,v){this.data[k]=String(v);},removeItem(k){delete this.data[k];}});
test('a sign-in without a destination opens the member console, not the course pilot',async()=>{
 const h=harness();h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/dashboard.html');
});
test('a destination survives a detour through password recovery or email confirmation on the same device',async()=>{
 const storage=memoryStorage(),checkin='/fiiu-checkin.html?a=day0-lab&c=AbCdEfGhIjKlMnOpQrStUv';
 // The scan opens sign-in with its own return; the person goes to "Forgot password?" instead of signing in.
 harness(undefined,'?next='+encodeURIComponent(checkin),storage);
 // Back from the email link, sign-in opens without a next and still returns to the check-in, once.
 // The one-minute screen code is not kept: back at the check-in, the page shows the confirmation or asks for the code.
 const back=harness(undefined,'',storage);back.valid();await back.submit('loginForm');assert.equal(back.assigned(),'/fiiu-checkin.html?a=day0-lab');
 assert.equal(storage.getItem('nodal.returnTo'),null,'a used return is forgotten');
 const later=harness(undefined,'',storage);later.valid();await later.submit('loginForm');assert.equal(later.assigned(),'/dashboard.html');
});
test('a remembered destination is ignored when it is old, foreign or malformed, and an explicit next always wins',async()=>{
 const old=JSON.stringify({path:'/fiiu-checkin.html?a=day0-lab',at:Date.now()-31*60000});
 for(const value of [old,JSON.stringify({path:'https://attacker.test/x',at:Date.now()}),JSON.stringify({path:'//attacker.test',at:Date.now()}),'not json']){
  const h=harness(undefined,'',memoryStorage({'nodal.returnTo':value}));h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/dashboard.html',value);
 }
 const fresh=memoryStorage({'nodal.returnTo':JSON.stringify({path:'/fiiu-checkin.html?a=day0-lab',at:Date.now()})});
 const h=harness(undefined,'?next=%2Fopportunities.html',fresh);h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/opportunities.html');
 // Storage that throws (private mode, blocked site data) never blocks sign-in.
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const b=harness(undefined,'?next=%2Ffiiu.html',broken);b.valid();await b.submit('loginForm');assert.equal(b.assigned(),'/fiiu.html');
});
test('a remembered check-in never carries its one-minute code, so a later sign-in cannot check anyone in by itself',async()=>{
 const storage=memoryStorage(),checkin='/fiiu-checkin.html?a=day0-lab&c=AbCdEfGhIjKlMnOpQrStUv';
 const first=harness(undefined,'?next='+encodeURIComponent(checkin),storage);first.valid();
 assert.equal(JSON.parse(storage.getItem('nodal.returnTo')).path,'/fiiu-checkin.html?a=day0-lab');
 await first.submit('loginForm');assert.equal(first.assigned(),checkin,'signing in straight away still finishes the scan');
 storage.setItem('nodal.returnTo',JSON.stringify({path:checkin,at:Date.now()}));
 const later=harness(undefined,'',storage);later.valid();await later.submit('loginForm');assert.equal(later.assigned(),'/fiiu-checkin.html?a=day0-lab');
});
test('a remembered destination stamped in the future is ignored, so a wrong phone clock cannot keep it alive',async()=>{
 for(const at of [Date.now()+5*60000,'soon',null]){
  const h=harness(undefined,'',memoryStorage({'nodal.returnTo':JSON.stringify({path:'/fiiu.html',at})}));h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/dashboard.html',String(at));
 }
});
test('a confirmation link’s session tokens are removed from the address bar at once, and other pages keep their address',()=>{
 for(const hash of ['#access_token=a.b.c&refresh_token=r&type=signup','#error=access_denied&error_code=otp_expired']){
  const h=harness(undefined,'?next=%2Ffiiu.html',null,hash);assert.deepEqual(h.context.history.calls,['/login.html?next=%2Ffiiu.html'],hash);
 }
 assert.deepEqual(harness(undefined,'',null,'#signup').context.history.calls,[]);
});
