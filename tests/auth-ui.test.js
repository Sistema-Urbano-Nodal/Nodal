import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/scripts/auth.js',import.meta.url),'utf8');
function harness(reply=async()=>({ok:true,status:200,data:{user:{id:'u1'}}}),search=''){
 const nodes={},listeners=[],requests=[];let assigned='',timeout;
 for(const id of ['loginForm','signupForm','loginError','signupError','loginEmail','loginPassword','signupName','signupEmail','signupPassword'])nodes[id]={id,value:'',textContent:'',hidden:true,listeners:{},dataset:{},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(k,f){this.listeners[k]=f;},focus(){this.focused=true;}};
 for(const id of ['loginForm','signupForm']){nodes[id].button={disabled:false,textContent:'',dataset:{},setAttribute(k,v){this[k]=v;}};nodes[id].querySelector=()=>nodes[id].button;}
 const context={document:{getElementById:id=>nodes[id]},URL,URLSearchParams,Error,window:{nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}},location:{origin:'https://nodal.test',search,assign:path=>assigned=path},AbortSignal:{timeout:ms=>{timeout=ms;return{timeout:ms};}},fetch:async(path,options)=>{requests.push({path,options,body:JSON.parse(options.body)});const result=await reply(path,options);return{ok:result.ok,status:result.status,json:async()=>result.data};}};
 vm.createContext(context);vm.runInContext(source,context);
 const submit=id=>nodes[id].listeners.submit({preventDefault(){}});
 const valid=()=>{nodes.loginEmail.value='member@example.test';nodes.loginPassword.value='password123';nodes.signupName.value='Test Member';nodes.signupEmail.value='new@example.test';nodes.signupPassword.value='newpassword123';};
 return{nodes,requests,submit,valid,assigned:()=>assigned,timeout:()=>timeout,lang:value=>{context.window.nodalI18n.lang=value;nodes.loginForm.button.textContent='main i18n sign-in label';nodes.signupForm.button.textContent='main i18n create label';listeners.forEach(f=>f());}};
}
test('login validates email and required password locally with translated field feedback',async()=>{
 const h=harness();h.lang('pt');await h.submit('loginForm');assert.equal(h.requests.length,0);assert.match(h.nodes.loginError.textContent,/e-mail válido/);assert.equal(h.nodes.loginEmail['aria-invalid'],'true');assert.equal(h.nodes.loginEmail.focused,true);
 h.nodes.loginEmail.value='member@example.test';await h.submit('loginForm');assert.equal(h.requests.length,0);assert.match(h.nodes.loginError.textContent,/senha/);assert.equal(h.nodes.loginPassword['aria-invalid'],'true');assert.equal(h.nodes.loginEmail['aria-invalid'],undefined);
});
test('signup validates name, email and server password limits before requests',async()=>{
 const h=harness();h.valid();h.nodes.signupName.value=' A ';await h.submit('signupForm');assert.equal(h.requests.length,0);assert.match(h.nodes.signupError.textContent,/at least 2/);
 h.nodes.signupName.value='Member';h.nodes.signupEmail.value='invalid';await h.submit('signupForm');assert.equal(h.requests.length,0);
 h.nodes.signupEmail.value='new@example.test';for(const password of ['short','x'.repeat(161)]){h.nodes.signupPassword.value=password;await h.submit('signupForm');assert.equal(h.requests.length,0);assert.match(h.nodes.signupError.textContent,/8.160/);}
 h.nodes.signupPassword.value='x'.repeat(160);await h.submit('signupForm');assert.equal(h.requests.length,1);
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
 for(const next of ['https://attacker.test','//attacker.test','/\\attacker.test','/\nattacker.test']){const h=harness(undefined,'?next='+encodeURIComponent(next));h.valid();await h.submit('loginForm');assert.equal(h.assigned(),'/dashboard.html');}
});
test('email-confirmation requirement maps separately from forbidden requests',async()=>{
 const h=harness(async()=>({ok:false,status:403,data:{error:'Confirm your email before signing in.'}}));h.valid();h.lang('pt');await h.submit('loginForm');assert.match(h.nodes.loginError.textContent,/Confirme seu e-mail/);assert.equal(h.assigned(),'');
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
