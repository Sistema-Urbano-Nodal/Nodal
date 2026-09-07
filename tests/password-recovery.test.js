import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSupabaseRepository } from '../server/supabase.js';
import { createApp } from '../server/server.js';

const env = { NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test-key', SUPABASE_SECRET_KEY:'server-test-key', PUBLIC_BASE_URL:'https://nodal.example', NODE_ENV:'production' };
const userId='00000000-0000-0000-0000-000000000001';
const response=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status});
function provider({method='recovery',expired=false,wrongOwner=false,recoverStatus=200,updateStatus=200,logoutStatus=204}={}) {
  const calls=[];let challenge,used=false;
  const now=Math.floor(Date.now()/1000);
  const claims={sub:wrongOwner?'different-user':userId,iss:env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1',aud:'authenticated',exp:now+(expired?-1:3600),amr:[{method,timestamp:now}]};
  const token=['header',Buffer.from(JSON.stringify(claims)).toString('base64url'),'provider-signature'].join('.');
  const fetchImpl=async(raw,options)=>{
    const url=new URL(raw),body=options.body?JSON.parse(options.body):null;
    calls.push({url,options,body});
    if(url.pathname==='/auth/v1/recover'){challenge=body.code_challenge;return response(recoverStatus===200?{}:{msg:'private provider detail'},recoverStatus);}
    if(url.pathname==='/auth/v1/token'){
      assert.equal(url.searchParams.get('grant_type'),'pkce');
      if(used||body.auth_code!=='one-use-code'||createHash('sha256').update(body.code_verifier).digest('base64url')!==challenge)return response({msg:'bad code'},400);
      used=true;return response({access_token:token,refresh_token:'never-expose-refresh',user:{id:userId},expires_in:3600});
    }
    if(url.pathname==='/auth/v1/user'&&options.method==='PUT'){
      assert.equal(options.headers.Authorization,'Bearer '+token);return response(updateStatus===200?{id:userId}:{error_code:'weak_password',msg:'private strength detail'},updateStatus);
    }
    if(url.pathname==='/auth/v1/logout')return response(logoutStatus===204?null:{msg:'private logout error'},logoutStatus);
    throw new Error('Unexpected provider call '+url.pathname);
  };
  return {calls,repo:createSupabaseRepository({env,fetchImpl}),token};
}
const req=cookie=>({headers:{cookie}});
async function request(p){const result=await p.repo.requestPasswordRecovery({email:'member@example.test'});return result.cookies[0].split(';')[0];}

test('recovery request pins redirect and uses separate HttpOnly PKCE cookie without exposing a verifier',async()=>{
  const p=provider();const result=await p.repo.requestPasswordRecovery({email:'member@example.test',redirectTo:'https://attacker.test'});
  assert.equal(result.status,202);assert.deepEqual(Object.keys(result).sort(),['cookies','status']);
  assert.match(result.cookies[0],/^nodal_recovery=/);assert.match(result.cookies[0],/HttpOnly/);assert.match(result.cookies[0],/Secure/);assert.match(result.cookies[0],/SameSite=Lax/);
  assert.equal(p.calls[0].url.searchParams.get('redirect_to'),'https://nodal.example/reset-password.html');
  assert.equal(p.calls[0].body.code_challenge_method,'s256');assert.equal(p.calls[0].body.code_challenge.length,43);
  assert.equal(p.calls[0].options.headers.apikey,'public-test-key');assert.ok(p.calls[0].options.signal);
});
test('recovery completion consumes provider code once, updates only its owner and globally revokes sessions',async()=>{
  const p=provider(),cookie=await request(p);
  const result=await p.repo.completePasswordRecovery({req:req(cookie),code:'one-use-code',password:'a-new-password',userId:'victim'});
  assert.equal(result.status,200);assert.equal(result.passwordChanged,true);
  assert.ok(result.cookies.every(c=>c.includes('Max-Age=0')));assert.equal(result.cookies.length,3);
  const update=p.calls.find(c=>c.options.method==='PUT');assert.deepEqual(update.body,{password:'a-new-password'});
  assert.equal(p.calls.at(-1).url.searchParams.get('scope'),'global');
  assert.equal((await p.repo.completePasswordRecovery({req:req(cookie),code:'one-use-code',password:'other-password'})).status,400);
  assert.equal(p.calls.filter(c=>c.options.method==='PUT').length,1);
  assert.doesNotMatch(JSON.stringify(result),/provider-signature|never-expose-refresh/);
});
test('ordinary auth, wrong owner and expired provider tokens never authorize recovery updates',async()=>{
  for(const options of[{method:'password'},{method:'magiclink'},{wrongOwner:true},{expired:true}]){
    const p=provider(options),cookie=await request(p);
    assert.equal((await p.repo.completePasswordRecovery({req:req(cookie),code:'one-use-code',password:'a-new-password'})).status,400);
    assert.equal(p.calls.some(c=>c.options.method==='PUT'),false);
  }
});
test('missing or tampered recovery cookie and invalid passwords cannot consume the code',async()=>{
  const p=provider(),cookie=await request(p);
  for(const args of[{req:req(''),password:'a-new-password'},{req:req(cookie+'tampered'),password:'a-new-password'},{req:req(cookie),password:'short'},{req:req(cookie),password:'x'.repeat(161)}]){
    assert.equal((await p.repo.completePasswordRecovery({...args,code:'one-use-code'})).status,400);
  }
  assert.equal(p.calls.length,1);
});
test('provider recovery responses never expose account existence or provider messages',async()=>{
  for(const status of[200,400,404,422,429]){
    const p=provider({recoverStatus:status});assert.equal((await p.repo.requestPasswordRecovery({email:'absent@example.test'})).status,202);
  }
  const p=provider({recoverStatus:500});const result=await p.repo.requestPasswordRecovery({email:'member@example.test'});assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result),/private provider/);
});
test('provider cooldown retains the browser verifier and signed state expires server-side',async()=>{
  const p=provider({recoverStatus:429}),cookie=await request(p);
  const next=await p.repo.requestPasswordRecovery({email:'member@example.test',req:req(cookie)});
  assert.equal(next.cookies[0].split('.')[0],cookie.split('.')[0]);assert.equal(p.calls[0].body.code_challenge,p.calls[1].body.code_challenge);
  const verifier=cookie.split('=')[1].split('.')[0],value=verifier+'.'+(Date.now()-3600_001);
  const signature=createHmac('sha256',env.SUPABASE_SECRET_KEY).update('nodal-password-recovery:'+value).digest('base64url');
  assert.equal((await p.repo.completePasswordRecovery({req:req('nodal_recovery='+value+'.'+signature),code:'one-use-code',password:'new-password'})).status,400);
  assert.equal(p.calls.length,2);
});
test('missing or unsafe recovery base URL fails closed before calling the provider',async()=>{
  for(const origin of['','http://nodal.example','https://user:password@nodal.example']){
    let calls=0;const repository=createSupabaseRepository({env:{...env,PUBLIC_BASE_URL:origin},fetchImpl:async()=>{calls++;throw Error('must not call');}});
    assert.equal((await repository.requestPasswordRecovery({email:'member@example.test'})).status,503);assert.equal(calls,0);
  }
});
test('a renewed email gets a fresh server expiry while retaining the verifier for prior cooldown links',async()=>{
  const originalNow=Date.now,started=originalNow(),verifier='a'.repeat(43),value=verifier+'.'+started;
  const signature=createHmac('sha256',env.SUPABASE_SECRET_KEY).update('nodal-password-recovery:'+value).digest('base64url');
  try {
    Date.now=()=>started+55*60_000;
    const p=provider();
    const renewed=await p.repo.requestPasswordRecovery({email:'member@example.test',req:req('nodal_recovery='+value+'.'+signature)});
    const cookie=renewed.cookies[0].split(';')[0];
    assert.equal(cookie.split('.')[1],String(Date.now()));
    Date.now=()=>started+61*60_000;
    assert.equal((await p.repo.completePasswordRecovery({req:req(cookie),code:'one-use-code',password:'a-new-password'})).status,200);
  } finally { Date.now=originalNow; }
});
test('password policy and post-update revocation failures have honest sanitized outcomes',async()=>{
  const p=provider({updateStatus:422}),cookie=await request(p);
  const failed=await p.repo.completePasswordRecovery({req:req(cookie),code:'one-use-code',password:'a-new-password'});
  assert.equal(failed.status,400);assert.equal(failed.code,'recovery_password_rejected');assert.notEqual(failed.passwordChanged,true);
  const q=provider({logoutStatus:500}),otherCookie=await request(q);
  const partial=await q.repo.completePasswordRecovery({req:req(otherCookie),code:'one-use-code',password:'a-new-password'});
  assert.equal(partial.passwordChanged,true);assert.equal(partial.code,'recovery_changed');assert.ok(partial.cookies.every(c=>c.includes('Max-Age=0')));
});
async function boot(t,repository){const server=createApp({repository,courseStore:null});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());return 'http://127.0.0.1:'+server.address().port;}
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('recovery API is anonymous, same-origin, rate limited by email, and ignores caller redirect and target',async t=>{
  const calls=[];const repository={resolveSession:async()=>({user:null,cookies:[]}),requestPasswordRecovery:async args=>{calls.push(args);return{status:202,cookies:['nodal_recovery=opaque; HttpOnly']};},completePasswordRecovery:async args=>{calls.push(args);return{status:200,passwordChanged:true,cookies:[]};}};
  const base=await boot(t,repository),path='/api/auth/recovery/request';
  assert.equal((await post(base,path,{email:'member@example.test'},{Origin:'https://attacker.test'})).status,403);
  const first=await post(base,path,{email:' Member@example.test ',redirectTo:'https://attacker.test'});assert.equal(first.status,202);assert.equal(calls[0].email,'member@example.test');assert.equal(calls[0].redirectTo,undefined);
  for(let i=0;i<4;i++)await post(base,path,{email:'member@example.test'});
  assert.equal(calls.length,3);
  const complete=await post(base,'/api/auth/recovery/complete',{code:'provider-code',password:'valid-password',userId:'victim'});assert.equal(complete.status,200);assert.equal(calls.at(-1).userId,undefined);
  const page=await fetch(base+'/reset-password.html');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('referrer-policy'),'no-referrer');
});

function ui(fetchImpl,{search='?code=one-use-code',hash=''}={}){
  const nodes=new Map();const node=id=>({id,attributes:{},setAttribute(k,v){this.attributes[k]=v;},value:'',dataset:{},hidden:false,disabled:false,textContent:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},focus(){this.focused=true;},checkValidity:()=>true,reportValidity(){},querySelector(){return nodes.get(id+'Button');}});
  for(const id of['recoveryLanguages','recoveryTitle','recoveryRequest','recoveryReset','recoveryMessage','recoveryEmail','recoveryPassword','recoveryConfirm','recoveryAnother','recoveryRequestButton','recoveryResetButton'])nodes.set(id,node(id));
  let change;const history=[];const calls=[];
  const context={URLSearchParams,AbortSignal,fetch:async(path,options)=>{calls.push({path,options,body:JSON.parse(options.body)});return fetchImpl(path,options);},location:{search,hash},history:{replaceState(...args){history.push(args);}},document:{body:{dataset:{page:'password-recovery'}},getElementById:id=>nodes.get(id),querySelector:selector=>selector==='.recovery-languages'?nodes.get('recoveryLanguages'):null,querySelectorAll:selector=>selector==='[data-recovery-text]'?[...nodes.values()].filter(n=>n.dataset.recoveryText):[]}};
  context.window=context;context.nodalI18n={lang:'en',onChange(fn){change=fn;}};
  vm.runInNewContext(readFileSync(new URL('../web/scripts/recovery-i18n.js',import.meta.url),'utf8'),context);
  vm.runInNewContext(readFileSync(new URL('../web/scripts/password-recovery.js',import.meta.url),'utf8'),context);
  return {nodes,calls,history,context,lang(language){context.nodalI18n.lang=language;change();},submit(id){return nodes.get(id).listeners.submit({preventDefault(){}});}};
}
test('reset UI removes callback code immediately, waits for explicit submit and preserves passwords across language changes',async()=>{
  const h=ui(async()=>response({ok:true,passwordChanged:true}));
  assert.equal(h.calls.length,0);assert.equal(h.history[0][2],'/reset-password.html');assert.equal(h.nodes.get('recoveryRequest').hidden,true);
  assert.equal(h.nodes.get('recoveryTitle').textContent,'Choose a new password');assert.equal(h.nodes.get('recoveryAnother').hidden,false);
  h.nodes.get('recoveryPassword').value='safe-new-password';h.nodes.get('recoveryConfirm').value='safe-new-password';
  h.lang('pt');assert.equal(h.nodes.get('recoveryPassword').value,'safe-new-password');assert.equal(h.nodes.get('recoveryLanguages').attributes['aria-label'],'Idioma');
  await h.submit('recoveryReset');assert.deepEqual(h.calls[0].body,{code:'one-use-code',password:'safe-new-password'});
  assert.equal(h.nodes.get('recoveryPassword').value,'');assert.match(h.nodes.get('recoveryMessage').textContent,/Sua senha foi alterada/);
  assert.equal(h.nodes.get('recoveryTitle').textContent,'Senha atualizada');
  h.lang('es');assert.match(h.nodes.get('recoveryMessage').textContent,/Tu contraseña ha sido cambiada/);
});
test('reset UI blocks mismatched passwords and renders consumed-proof or ambiguous failures without a false success',async()=>{
  const h=ui(async()=>response({ok:false,code:'recovery_password_rejected'},400));
  h.nodes.get('recoveryPassword').value='safe-new-password';h.nodes.get('recoveryConfirm').value='other-password';await h.submit('recoveryReset');assert.equal(h.calls.length,0);
  h.nodes.get('recoveryConfirm').value='safe-new-password';await h.submit('recoveryReset');assert.equal(h.nodes.get('recoveryRequest').hidden,false);assert.match(h.nodes.get('recoveryMessage').textContent,/could not be accepted/);
  const q=ui(async()=>{throw Error('connection lost');});q.nodes.get('recoveryPassword').value=q.nodes.get('recoveryConfirm').value='safe-new-password';await q.submit('recoveryReset');assert.match(q.nodes.get('recoveryMessage').textContent,/could not confirm whether/);assert.equal(q.nodes.get('recoveryReset').hidden,true);
});
test('recovery UI rejects fragment sessions and provides account-neutral trilingual request feedback',async()=>{
  const h=ui(async()=>response({ok:true},202),{search:'',hash:'#access_token=arbitrary&type=recovery'});
  assert.equal(h.nodes.get('recoveryReset').hidden,true);assert.equal(h.calls.length,0);assert.match(h.nodes.get('recoveryMessage').textContent,/invalid, expired/);
  assert.equal(h.nodes.get('recoveryAnother').hidden,true);assert.equal(h.nodes.get('recoveryTitle').textContent,'Reset your password');
  h.nodes.get('recoveryEmail').value='member@example.test';h.lang('pt');await h.submit('recoveryRequest');assert.deepEqual(h.calls[0].body,{email:'member@example.test'});assert.match(h.nodes.get('recoveryMessage').textContent,/Se houver uma conta/);
  for(const values of Object.values(h.context.nodalRecoveryI18n.rows))assert.ok(values.length===3&&values.every(v=>typeof v==='string'&&v.trim()));
  const html=readFileSync(new URL('../web/pages/reset-password.html',import.meta.url),'utf8');assert.match(html,/recovery\.css\?v=/);
  const css=readFileSync(new URL('../web/styles/recovery.css',import.meta.url),'utf8');assert.match(css,/\[hidden\]\{display:none!important\}/);
  const source=readFileSync(new URL('../web/scripts/password-recovery.js',import.meta.url),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage/);
});
