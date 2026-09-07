import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script=name=>readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8');
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.hidden=false;this.textContent='';this.value='';this.files=[];this.classList={toggle(){}};}
 append(...nodes){nodes.forEach(n=>{if(typeof n==='object')n.parent=this;this.children.push(n);});}
 prepend(...nodes){nodes.forEach(n=>n.parent=this);this.children.unshift(...nodes);}
 after(node){const p=this.parent;if(p){node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this[k]=v;}
 removeAttribute(k){delete this[k];}
 addEventListener(k,f){this.listeners[k]=f;}
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='input,textarea,select,button'?['input','textarea','select','button'].includes(n.tagName):selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){this.focused=true;}
 checkValidity(){return this.type!=='email'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);}
 reportValidity(){this.reported=true;return this.checkValidity();}
 reset(){descendants(this).filter(n=>n.tagName==='input'||n.tagName==='textarea').forEach(n=>{n.value='';n.files=[];});}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(respond,{page='courses',search=''}={}){
 const body=new Node('body');body.dataset.page=page;const html=new Node('html');const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[],documentEvents={},windowEvents={};let assigned='';
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(k,f){(documentEvents[k]??=new Set()).add(f);},removeEventListener(k,f){documentEvents[k]?.delete(f);}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,AbortSignal,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign:s=>{assigned=s;},replace:s=>{assigned=s;}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method,signal:opts?.signal});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},window:{addEventListener(k,f){windowEvents[k]=f;},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,documentEvents,windowEvents,run:name=>vm.runInContext(script(name),ctx),assigned:()=>assigned,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}
const course={id:'c1',title:'Mobility course',description:'Course',status:'published',version:1,enrollmentOpen:true};
const findKey=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
const byName=(node,name)=>descendants(node).find(n=>n.name===name);
const participantForm=h=>descendants(h.body).find(n=>n.className==='pilot-form pilot-participant-form');
function teachingHarness(write,{invitations=[],courses=[course]}={}){
 const h=harness((path,options)=>options?.method==='POST'?write(path,JSON.parse(options.body)):path==='/api/admin/courses'?{courses}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[],invitations}:{course:courses.find(c=>path.endsWith('/'+c.id))||course,modules:[]},{page:'teaching'});h.run('teaching');return h;
}
test('adding a participant performs only explicit enrollment and preserves translated success after refresh',async()=>{
 const h=teachingHarness(()=>({result:'enrolled',participant:{id:'u1'}}));await flush();h.ctx.document.getElementById('staff-tab-participants').listeners.click();const form=participantForm(h);byName(form,'email').value=' person@example.test ';await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.requests.find(r=>r.method==='POST').path,'/api/admin/courses/c1/participants');assert.deepEqual(h.requests.find(r=>r.method==='POST').body,{email:'person@example.test'});assert.equal(h.ctx.document.getElementById('staff-pane-participants').hidden,false);assert.match(content(h.body),/Participant added with student access/);h.lang('pt');assert.match(content(h.body),/Participante adicionado como estudante/);
});
test('missing or unconfirmed accounts offer an explicit invitation without sending automatically',async()=>{
 for(const code of ['participant_not_found','participant_unconfirmed']){
  const h=teachingHarness(path=>path.endsWith('/participants')?{status:code==='participant_not_found'?404:409,data:{code}}:{result:'invited'});await flush();const form=participantForm(h);byName(form,'email').value='new@example.test';await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);const invite=findKey(form,'sendInvitation');assert.equal(invite.hidden,false);h.lang('es');assert.match(content(h.body),/invitación/);await invite.listeners.click();assert.equal(h.requests.filter(r=>r.method==='POST').length,2);assert.equal(h.requests.filter(r=>r.method==='POST')[1].path,'/api/admin/courses/c1/invitations');assert.match(content(h.body),/Invitación enviada/);
 }
});
test('email edits hide an invitation offered for a different address, and disabled accounts do not offer invitations',async()=>{
 const h=teachingHarness(()=>({status:404,data:{code:'participant_not_found'}}));await flush();const form=participantForm(h),email=byName(form,'email');email.value='unknown@example.test';await form.listeners.submit({preventDefault(){}});email.value='another@example.test';email.listeners.input();assert.equal(findKey(form,'sendInvitation').hidden,true);
 const denied=teachingHarness(()=>({status:403,data:{code:'participant_unavailable'}}));await flush();const blocked=participantForm(denied);byName(blocked,'email').value='blocked@example.test';await blocked.listeners.submit({preventDefault(){}});assert.equal(findKey(blocked,'sendInvitation').hidden,true);assert.match(content(denied.body),/This account cannot be added/);
});
test('invitation list uses text only, omits accepted entries and resends only after a deliberate click',async()=>{
 const h=teachingHarness(()=>({result:'invited'}),{invitations:[{email:'safe@example.test',deliveryStatus:'sent'},{email:'<img src=x>@example.test',deliveryStatus:'failed'},{email:'accepted@example.test',deliveryStatus:'sent',acceptedAt:'2026-09-07'}]});await flush();assert.match(content(h.body),/<img src=x>@example.test/);assert.equal(descendants(h.body).some(n=>n.tagName==='img'),false);assert.doesNotMatch(content(h.body),/accepted@example.test/);assert.equal(h.requests.some(r=>r.method==='POST'),false);await findKey(h.body,'resendInvitation').listeners.click();assert.equal(h.requests.find(r=>r.method==='POST').body.email,'safe@example.test');
});
test('pending enrollment prevents duplicate submissions, and late responses never navigate away from a new course',async()=>{
 let resolve;const h=teachingHarness(()=>new Promise(r=>{resolve=r;}),{courses:[course,{...course,id:'c2',title:'Other course'}]});await flush();const form=participantForm(h);byName(form,'email').value='person@example.test';const pending=form.listeners.submit({preventDefault(){}});await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(form['aria-busy'],'true');h.lang('pt');assert.equal(findKey(form,'addingParticipant').textContent,'Adicionando…');await descendants(h.body).find(n=>n.dataset.course==='c2').listeners.click();await flush();resolve({result:'enrolled'});await pending;assert.equal(h.ctx.document.getElementById('staff-pane-responses').hidden,false);assert.match(content(h.body),/Other course/);assert.doesNotMatch(content(h.body),/Participante adicionado como estudante/);
});
test('invitation failures and cooldowns are localized and never reported as sent',async()=>{
 for(const code of ['invitation_uncertain','invitation_unavailable','invitation_rate']){const h=teachingHarness(()=>({status:code==='invitation_rate'?429:503,data:{code}}),{invitations:[{email:'person@example.test',deliveryStatus:'uncertain'}]});await flush();h.lang('pt');await findKey(h.body,'resendInvitation').listeners.click();assert.doesNotMatch(content(h.body),/Convite enviado\./);assert.match(content(h.body),/Não foi possível|Aguarde/);assert.equal(participantForm(h)['aria-busy'],'false');}
});

function acceptanceHarness({hash='#token_hash='+ 'a'.repeat(56),reply=async()=>({passwordChanged:true,courseIds:['00000000-0000-4000-8000-000000000001']})}={}){
 const body=new Node('body'),nodes={},listeners={},requests=[],historyCalls=[],stored=[];
 for(const id of ['invitationForm','recoveryMessage','invitationTitle','invitationName','invitationPassword','invitationConfirm','invitationSubmit','invitationSignIn']){const node=new Node(id==='invitationForm'?'form':'div');node.id=id;nodes[id]=node;body.append(node);}
 nodes.invitationForm.hidden=true;nodes.invitationSubmit.dataset.invitationText='accept';const languageGroup=new Node('div');languageGroup.className='recovery-languages';body.append(languageGroup);for(const lang of ['en','es','pt']){const b=new Node('button');b.className='lang-btn';b.dataset.lang=lang;languageGroup.append(b);}
 const document={body,documentElement:{},readyState:'loading',getElementById:id=>nodes[id],querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>selector==='[data-invitation-text]'?descendants(body).filter(n=>n.dataset.invitationText):body.querySelectorAll(selector),addEventListener:(key,fn)=>{listeners[key]=fn;}};
 const ctx={document,URLSearchParams,AbortSignal,window:{},location:{hash,search:'?ignored=1'},history:{replaceState:(_state,_title,path)=>{historyCalls.push(path);}},localStorage:{getItem:()=>null,setItem:(key,value)=>stored.push({key,value})},fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body),options});return{json:async()=>await reply()};}};
 vm.createContext(ctx);vm.runInContext(script('accept-invitation'),ctx);vm.runInContext(script('invitation-i18n'),ctx);listeners.DOMContentLoaded();
 return{body,nodes,ctx,requests,historyCalls,stored,submit:()=>nodes.invitationForm.listeners.submit({preventDefault(){}}),valid:()=>{nodes.invitationName.value='New Member';nodes.invitationPassword.value=' secure password ';nodes.invitationConfirm.value=' secure password ';},lang:lang=>descendants(body).find(n=>n.dataset.lang===lang).listeners.click()};
}
test('invitation token is stripped before initialization and transmitted only in the completion request body',async()=>{
 const h=acceptanceHarness();assert.deepEqual(h.historyCalls,['/accept-invitation.html']);assert.equal(h.requests.length,0);assert.equal(h.stored.length,0);assert.equal(h.nodes.invitationForm.hidden,false);h.valid();await h.submit();assert.equal(h.requests[0].path,'/api/auth/course-invitation/complete');assert.equal(h.requests[0].body.tokenHash,'a'.repeat(56));assert.equal(h.requests[0].body.password,' secure password ');assert.equal(h.nodes.invitationPassword.value,'');assert.equal(h.nodes.invitationForm.hidden,true);assert.equal(h.nodes.invitationSignIn.href,'/login.html?next=%2Fcourse.html%3Fid%3D00000000-0000-4000-8000-000000000001');assert.match(h.nodes.recoveryMessage.textContent,/enrollment is confirmed/);await h.submit();assert.equal(h.requests.length,1);
});
test('missing, malformed, access-token or refresh-token callbacks never create an acceptance request',async()=>{
 for(const hash of ['', '#token_hash=short','#access_token=secret&token_hash='+ 'a'.repeat(56),'#refresh_token=secret&token_hash='+ 'a'.repeat(56)]){const h=acceptanceHarness({hash});h.valid();await h.submit();assert.equal(h.nodes.invitationForm.hidden,true);assert.equal(h.requests.length,0);assert.match(h.nodes.recoveryMessage.textContent,/missing, expired or already used/);}
});
test('acceptance validates names and passwords locally, preserves token for correctable errors, and ignores duplicate submits',async()=>{
 let resolve;const h=acceptanceHarness({reply:()=>new Promise(r=>{resolve=r;})});h.valid();h.nodes.invitationName.value='A';await h.submit();assert.equal(h.requests.length,0);h.valid();h.nodes.invitationConfirm.value='other';await h.submit();assert.equal(h.requests.length,0);h.valid();const first=h.submit();await h.submit();assert.equal(h.requests.length,1);assert.equal(h.nodes.invitationForm['aria-busy'],'true');h.lang('pt');assert.equal(h.nodes.invitationSubmit.textContent,'Preparando sua conta…');resolve({code:'invitation_rate'});await first;assert.equal(h.nodes.invitationForm.hidden,false);assert.equal(h.nodes.invitationSubmit.disabled,false);assert.match(h.nodes.recoveryMessage.textContent,/Muitas tentativas/);
});
test('partial success confirms the password without claiming enrollment, and hostile course IDs cannot redirect outside NODAL',async()=>{
 const h=acceptanceHarness({reply:async()=>({passwordChanged:true,code:'invitation_partial',courseIds:['//evil.test','x&next=https://evil.test']})});h.valid();await h.submit();assert.equal(h.nodes.invitationSignIn.href,undefined);assert.doesNotMatch(h.nodes.recoveryMessage.textContent,/enrollment is confirmed/);assert.match(h.nodes.recoveryMessage.textContent,/password is saved/);h.lang('es');assert.match(h.nodes.recoveryMessage.textContent,/contraseña está guardada/);
});
test('consumed invitation errors and network uncertainty direct users to sign in or password recovery',async()=>{
 for(const reply of [async()=>({code:'invitation_password_rejected'}),async()=>{throw new Error('private provider internals');}]){const h=acceptanceHarness({reply});h.valid();await h.submit();assert.equal(h.nodes.invitationForm.hidden,true);assert.equal(h.nodes.invitationPassword.value,'');assert.doesNotMatch(h.nodes.recoveryMessage.textContent,/private provider internals|new invitation/);assert.match(h.nodes.recoveryMessage.textContent,/reset|password reset/);assert.equal(h.nodes.invitationSubmit.disabled,false);}
});
test('public invitation document has a self-only security policy and no external scripts or styles',()=>{
 const html=readFileSync(new URL('../web/pages/accept-invitation.html',import.meta.url),'utf8');assert.match(html,/name="referrer" content="no-referrer"/);assert.match(html,/script-src 'self'; style-src 'self'; font-src 'self'/);assert.doesNotMatch(html,/(?:src|href)="https?:/);assert.ok(html.indexOf('src="accept-invitation.js')<html.indexOf('<link'));assert.equal((html.match(/<script /g)||[]).length,2);const h=acceptanceHarness();for(const [key,values]of Object.entries(h.ctx.window.nodalInvitationI18n.rows)){assert.equal(values.length,3,key);assert.ok(values.every(v=>typeof v==='string'&&v.length),key);}
});

test('enrollment refresh preserves module drafts, active editor tab, and updates participant data for subsequent actions',async()=>{
 let finish,added=false;
 const h=harness((path,options)=>{if(options?.method==='POST')return new Promise(resolve=>{finish=()=>{added=true;resolve({result:'enrolled'});};});if(path==='/api/admin/courses')return{courses:[course]};if(path.endsWith('/report'))return{summary:{enrolled:added?1:0},participants:added?[{name:'New Student',email:'student@example.test',enrolledAt:'2026-09-07T12:00:00Z'}]:[],feedback:[]};return{course,modules:[{id:'m1',title:'Session one',instructions:'Original instructions',resources:[]}]};},{page:'teaching'});h.run('teaching');await flush();
 const draft=byName(h.body,'instructions');draft.value='Keep these unpublished teaching instructions';h.ctx.document.getElementById('staff-tab-participants').listeners.click();const form=participantForm(h);byName(form,'email').value='student@example.test';const pending=form.listeners.submit({preventDefault(){}});h.ctx.document.getElementById('staff-tab-courseSetup').listeners.click();finish();await pending;
 assert.equal(byName(h.body,'instructions'),draft);assert.equal(draft.value,'Keep these unpublished teaching instructions');assert.equal(h.ctx.document.getElementById('staff-pane-courseSetup').hidden,false);assert.equal(h.ctx.document.getElementById('staff-pane-participants').hidden,true);assert.match(content(h.ctx.document.getElementById('staff-pane-participants')),/New Student/);assert.match(content(h.body),/Participant added with student access/);assert.equal(h.requests.filter(r=>r.path==='/api/courses/c1').length,1);
 h.ctx.document.getElementById('staff-tab-participants').listeners.click();const fresh=participantForm(h);assert.notEqual(fresh,form);byName(fresh,'email').value='second@example.test';const second=fresh.listeners.submit({preventDefault(){}});finish();await second;assert.equal(h.requests.filter(r=>r.method==='POST').length,2);assert.equal(byName(h.body,'instructions'),draft);
});
