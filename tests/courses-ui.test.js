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
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){}
 reset(){descendants(this).filter(n=>n.tagName==='input'||n.tagName==='textarea').forEach(n=>{n.value='';n.files=[];});}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(respond,{page='courses',search=''}={}){
 const body=new Node('body');body.dataset.page=page;const html=new Node('html');const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[],documentEvents={},windowEvents={};let assigned='';
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(k,f){(documentEvents[k]??=new Set()).add(f);},removeEventListener(k,f){documentEvents[k]?.delete(f);}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign:s=>{assigned=s;},replace:s=>{assigned=s;}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method,signal:opts?.signal});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},window:{addEventListener(k,f){windowEvents[k]=f;},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,documentEvents,windowEvents,run:name=>vm.runInContext(script(name),ctx),assigned:()=>assigned,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}
const course={id:'c1',title:'Real course <img src=x onerror=alert(1)>',description:'Author content',startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true};
test('directory uses live course data as text and links to its explicit ID',async()=>{
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:{courses:[course]});h.run('courses');await flush();assert.match(content(h.ids.pilotRoot),/Real course <img/);assert.equal(descendants(h.body).filter(n=>n.tagName==='img').length,0);assert.equal(descendants(h.body).find(n=>n.href==='course.html?id=c1')?.textContent,'Open course');assert.equal(h.ids.teachingLink.hidden,true);
});
test('unenrolled member cannot open modules; enrolling reveals intake before content',async()=>{
 let enrolled=false;const h=harness(path=>{if(path==='/api/auth/me')return{user:{permission:'member'}};if(path.endsWith('/enroll')){enrolled=true;return{enrollment:{}};}return{course,modules:[{id:'m1',title:'Published session',sessionDate:'2026-09-09'}],enrollment:enrolled?{}:null,intake:null,isAdmin:false};},{page:'course',search:'?id=c1'});h.run('courses');await flush();assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);const enroll=descendants(h.body).find(n=>n.dataset.pilotText==='enroll');await enroll.listeners.click();await flush();assert.match(content(h.body),/Your intake is private/);assert.equal(descendants(h.body).filter(n=>n.tagName==='form').length,1);assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
});
test('intake saves all private fields with PUT and server response gates content',async()=>{
 let saved=false;const intake={fullName:'A',profession:'B',city:'C',motivation:'D',experience:'E',expectations:'F',caseStudy:'G',digitalFamiliarity:'H'};
 const h=harness((path,opts)=>{if(path==='/api/auth/me')return{user:{permission:'member'}};if(path.endsWith('/intake')){saved=true;return{intake};}return{course,modules:[],enrollment:{},intake:saved?intake:null,isAdmin:false};},{page:'course',search:'?id=c1'});h.run('courses');await flush();const form=descendants(h.body).find(n=>n.tagName==='form');for(const n of descendants(form))if(n.name in intake)n.value=intake[n.name];await form.listeners.submit({preventDefault(){}});await flush();const put=h.requests.find(r=>r.path.endsWith('/intake'));assert.equal(put.method,'PUT');assert.deepEqual(put.body,intake);assert.match(content(h.body),/not published modules yet/);
});
test('feedback submits real action/context/rating and does not claim success on failure',async()=>{
 let fail=true;const h=harness(()=>fail?{status:500,data:{error:'Retry required'}}:{feedback:{id:'saved'}});const box=h.ctx.window.nodalPilot.feedback('assignment',{courseId:'c1',moduleId:'m1'});h.body.append(box);const form=descendants(box).find(n=>n.tagName==='form');descendants(form).find(n=>n.type==='radio'&&n.value==='4').checked=true;await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.match(content(box),/Could not complete this request/);assert.doesNotMatch(content(box),/Feedback saved/);fail=false;await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.match(content(box),/Feedback saved/);assert.equal(h.requests[1].body.action,'assignment');assert.equal(h.requests[1].body.moduleId,'m1');assert.equal(h.requests[1].body.rating,4);
});
test('safe links reject executable protocols and credentials, and authentication preserves course return',async()=>{
 const h=harness(()=>({status:401,data:{error:'login'}}),{page:'course',search:'?id=c1&module=m1'});const p=h.ctx.window.nodalPilot;assert.equal(p.safeUrl('javascript:alert(1)'),null);assert.equal(p.safeUrl('https://user:pass@example.com'),null);assert.equal(p.safeUrl('https://example.com/read'),'https://example.com/read');await assert.rejects(p.api('/api/courses/c1'));assert.match(h.assigned(),/next=%2Fcourse.html%3Fid%3Dc1%26module%3Dm1/);
});
test('pilot UI translates current labels in EN, ES and PT',()=>{
 const h=harness(()=>({}));h.body.append(h.ctx.window.nodalPilot.button('enroll'));h.lang('es');assert.match(content(h.body),/Inscribirme/);h.lang('pt');assert.match(content(h.body),/Inscrever-me/);for(const [key,values]of Object.entries(h.ctx.window.pilotI18n.rows)){assert.equal(values.length,3,key);assert.ok(values.every(v=>typeof v==='string'&&v.length),key);}
});
test('pilot mask is a render-blocking stylesheet on member and authentication pages',()=>{
 for(const name of ['login','profile','dashboard','payments']){const html=readFileSync(new URL('../web/pages/'+name+'.html',import.meta.url),'utf8');const css=html.match(/href="courses\.css(?:\?[^"]*)?"/);assert.ok(css,name+' must load the billing mask');assert.ok(css.index<html.indexOf('</head>'));const pilot=html.match(/src="pilot\.js(?:\?[^"]*)?"/);assert.ok(pilot,name+' must load configuration');assert.ok(pilot.index<html.lastIndexOf('</body>'));}
 const home=readFileSync(new URL('../web/pages/index.html',import.meta.url),'utf8');assert.doesNotMatch(home,/(?:src|href)="(?:courses\.css|pilot(?:-i18n)?\.js)/);
 const css=readFileSync(new URL('../web/styles/courses.css',import.meta.url),'utf8');assert.match(css,/html:not\(\[data-pilot="false"\]\)/);assert.match(css,/data-billing-only/);
});
test('feedback requires a deliberate star choice before issuing any write',async()=>{
 const h=harness(()=>({feedback:{id:'saved'}}));const box=h.ctx.window.nodalPilot.feedback('matching');const form=descendants(box).find(n=>n.tagName==='form');await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.equal(h.requests.length,0);assert.match(content(box),/Choose a rating/);assert.equal(descendants(box).filter(n=>n.type==='radio').length,5);assert.equal(descendants(box).some(n=>n.type==='radio'&&n.checked),false);
});
test('reply submits parent-linked comment and resets composer only after persistence',async()=>{
 const posts=[{id:'p1',authorName:'Teacher',staff:true,createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'Discuss this territory',links:[],attachments:[]}];
 const h=harness((path,opts)=>{
  if(path==='/api/auth/me')return{user:{permission:'member'}};
  if(path.endsWith('/events'))return{ok:true};
  if(path.split('?')[0].endsWith('/posts')){if(opts?.method==='POST')return{post:{id:'p2'}};return{posts,nextCursor:null};}
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',description:'Learning',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session',sessionDate:'2026-09-09'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();const reply=descendants(h.body).find(n=>n.tagName==='button'&&n.dataset.pilotText==='reply');reply.listeners.click();const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='body'));descendants(form).find(n=>n.name==='body').value='My response';await form.listeners.submit({preventDefault(){}});const post=h.requests.find(r=>r.path.split('?')[0].endsWith('/posts')&&r.method==='POST');assert.equal(post.body.kind,'comment');assert.equal(post.body.parentId,'p1');assert.equal(post.body.body,'My response');assert.deepEqual(post.body.attachmentIds,[]);assert.equal(descendants(form).find(n=>n.name==='body').value,'');
});
test('staff editor preserves unsaved values and version after a conflict',async()=>{
 const h=harness((path,opts)=>{
  if(opts?.method==='PATCH')return{status:409,data:{error:'conflict'}};
  if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};
  if(path==='/api/admin/courses')return{courses:[course]};
  return{course:{...course,version:7},modules:[]};
 },{page:'teaching'});h.run('teaching');await flush();const form=descendants(h.body).find(n=>n.tagName==='form');const title=descendants(form).find(n=>n.name==='title');title.value='Unsaved revision';await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.version,7);assert.equal(patch.body.title,'Unsaved revision');assert.equal(title.value,'Unsaved revision');assert.match(content(form),/Someone changed this record/);assert.ok(descendants(form).some(n=>n.dataset.reload));
});
test('teaching opens responses first, supports tabs without losing edits, and filters real feedback',async()=>{
 const data={summary:{enrolled:2},participants:[],feedback:[
  {name:'Ana',email:'ana@example.test',action:'content',rating:5,comment:'Found the document',createdAt:'2026-09-05T12:00:00Z'},
  {name:'Luis',email:'luis@example.test',action:'recording',rating:2,comment:'Playback took time',createdAt:'2026-09-05T13:00:00Z'}
 ]};
 const h=harness(path=>path==='/api/admin/courses'?{courses:[course]}:path.endsWith('/report')?data:{course:{...course,version:7},modules:[]},{page:'teaching'});
 h.run('teaching');await flush();const nodes=descendants(h.body),responses=nodes.find(n=>n.id==='staff-pane-responses'),setup=nodes.find(n=>n.id==='staff-pane-courseSetup');
 assert.equal(responses.hidden,false);assert.equal(setup.hidden,true);
 const input=descendants(setup).find(n=>n.name==='title');input.value='Draft text survives tab changes';
 nodes.find(n=>n.id==='staff-tab-courseSetup').listeners.click();assert.equal(setup.hidden,false);assert.equal(responses.hidden,true);
 nodes.find(n=>n.id==='staff-tab-responses').listeners.click();assert.equal(input.value,'Draft text survives tab changes');
 const search=descendants(responses).find(n=>n.name==='searchResponses');search.value='ana@example.test';search.listeners.input();
 assert.match(content(responses),/Found the document/);assert.doesNotMatch(content(responses),/Playback took time/);
 const action=descendants(responses).find(n=>n.name==='feedbackAction');action.value='recording';action.listeners.change();assert.match(content(responses),/No responses match/);
 assert.ok(descendants(responses).some(n=>n.href==='/api/admin/courses/c1/export?type=feedback'));
});
test('course keeps contribution composer collapsed and replaces contextual feedback after a reply',async()=>{
 const h=harness((path,opts)=>{
  if(path==='/api/auth/me')return{user:{permission:'member'}};
  if(path.endsWith('/events'))return{ok:true};
  if(path.split('?')[0].endsWith('/posts'))return opts?.method==='POST'?{post:{id:'p2'}}:{posts:[{id:'p1',authorName:'Ana',createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'A question',attachments:[],links:[]}],nextCursor:null};
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',description:'Read and discuss',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const box=descendants(h.body).find(n=>n.className==='pilot-composer');assert.notEqual(box.open,true);
 const reply=descendants(h.body).find(n=>n.tagName==='button'&&n.dataset.pilotText==='reply');reply.listeners.click();assert.equal(box.open,true);
 const form=descendants(box).find(n=>n.tagName==='form');descendants(form).find(n=>n.name==='body').value='My answer';await form.listeners.submit({preventDefault(){}});assert.equal(box.open,false);
 const feedbacks=descendants(h.body).filter(n=>n.className==='pilot-feedback');assert.equal(feedbacks.length,1);assert.match(content(feedbacks[0]),/take part in this conversation/);
});
test('deleted contributions preserve their thread without offering an invalid reply',async()=>{
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.split('?')[0].endsWith('/posts')?{posts:[{id:'p1',deleted:true,createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'',attachments:[],links:[]}],nextCursor:null}:path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[]}}:{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const deleted=descendants(h.body).find(n=>n.id==='post-p1');assert.match(content(deleted),/removed by the teaching team/);assert.equal(descendants(deleted).some(n=>n.dataset.pilotText==='reply'),false);
});
test('initial discussion failure stays visible and offers a working retry',async()=>{
 let failed=true;const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.split('?')[0].endsWith('/posts')?(failed?{status:503,data:{error:'Discussion unavailable'}}:{posts:[],nextCursor:null}):path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[]}}:{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();
 assert.match(content(h.ids.pilotStatus),/Could not complete this request/);const retry=descendants(h.body).find(n=>n.dataset.pilotText==='retry');assert.ok(retry);failed=false;await retry.listeners.click();await flush();assert.match(content(h.body),/Start the conversation/);
});
function recHarness(fail=false){
 const h=harness((path)=>path==='/api/auth/state'?{authenticated:true}:path==='/api/recommendations/me'?{recommendations:[{id:'u1',name:'Ana',role:'Planner',city:'Lima',interests:[],reasons:{},matchPct:60}]}:fail?{status:503,data:{error:'Unavailable'}}:{ok:true});
 const stack=new Node(),card=new Node();card.style={};const nodes={};for(const key of ['.leader-initial','.match-name','.match-role','.tags','.match-why','.m-skip','.m-like'])nodes[key]=new Node();card.querySelector=s=>nodes[s];stack.querySelector=()=>card;h.ids.matchStack=stack;h.body.append(stack);const timers=[];h.ctx.setTimeout=f=>timers.push(f);h.ctx.requestAnimationFrame=f=>f();h.ctx.window.nodalI18n.t=k=>k;
 h.run('recs');return{...h,nodes,timers};
}
test('matching ignores repeat clicks during animation and pending persistence',async()=>{
 const h=recHarness();await flush();h.nodes['.m-like'].listeners.click();h.nodes['.m-like'].listeners.click();assert.equal(h.timers.length,1);assert.equal(h.nodes['.m-like'].disabled,true);h.timers.shift()();await flush();assert.equal(h.requests.filter(r=>r.path==='/api/users/me/follow').length,1);
});
test('failed matching action keeps skip disabled and only exposes retry',async()=>{
 const h=recHarness(true);await flush();h.nodes['.m-like'].listeners.click();h.timers.shift()();await flush();assert.equal(h.nodes['.m-skip'].disabled,true);assert.equal(h.nodes['.m-like'].disabled,false);assert.equal(h.nodes['.m-like']['aria-label'],'recs.retry');
});
test('publishing while an older discussion page loads still refreshes the saved contribution',async()=>{
 let reads=0,finishPage;const saved={id:'p2',authorName:'Member',createdAt:'2026-09-05T13:00:00Z',kind:'question',body:'New saved question',links:[],attachments:[]};
 const h=harness((path,opts)=>{
  if(path==='/api/auth/me')return{user:{permission:'member'}};
  if(path.endsWith('/events'))return{ok:true};
  if(path.includes('/posts')){if(opts?.method==='POST')return{post:saved};reads++;if(reads===2)return new Promise(resolve=>{finishPage=resolve;});return{posts:reads>2?[saved]:[{...saved,id:'p1',body:'Earlier question'}],nextCursor:reads===1?'next':null};}
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();const more=descendants(h.body).find(n=>n.dataset.pilotText==='loadOlder');more.listeners.click();await flush();
 const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='body'));descendants(form).find(n=>n.name==='body').value=saved.body;await form.listeners.submit({preventDefault(){}});finishPage({posts:[],nextCursor:null});await flush();assert.equal(reads,3);assert.match(content(h.body),/New saved question/);
});
const translatedCourse={...course,translations:{en:{title:'Mobility course',description:'Shared learning'},es:{title:'Curso de movilidad',description:'Aprendizaje compartido'},pt:{title:'Curso de mobilidade',description:'Aprendizagem compartilhada'}}};
const translatedModule={id:'m1',title:'Sesión original',description:'Descripción original',objectives:'Objetivos originales',instructions:'Instrucciones originales',sessionDate:'2026-09-09',resources:[{title:'Lectura original',url:'https://example.test/material',kind:'reading',translations:{en:{title:'Session reading'},pt:{title:'Leitura da sessão'}}}],translations:{en:{title:'First session',description:'Session description',objectives:'Learning objectives in English',instructions:'Write your case'},es:{title:'Primera sesión',description:'Descripción de la sesión',objectives:'Objetivos de aprendizaje',instructions:'Escribe tu caso'},pt:{title:'Primeira sessão',description:'Descrição da sessão',objectives:'Objetivos de aprendizagem',instructions:'Escreva seu caso'}}};
test('directory translates persisted course fields and page title without additional requests',async()=>{
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:{courses:[translatedCourse]});h.lang('pt');h.run('courses');await flush();assert.match(content(h.body),/Curso de mobilidade/);assert.match(content(h.body),/Aprendizagem compartilhada/);assert.equal(h.ctx.document.title,'Cursos · NODAL');const reads=h.requests.length;h.lang('en');assert.match(content(h.body),/Mobility course/);assert.doesNotMatch(content(h.body),/Curso de mobilidade/);assert.equal(h.requests.length,reads);
});
test('course previews translate title and sessions before enrollment without requesting private content',async()=>{
 const h=harness(()=>({course:translatedCourse,modules:[{id:'m1',title:translatedModule.title,sessionDate:translatedModule.sessionDate,translations:translatedModule.translations}],enrollment:null,intake:null,isAdmin:false}),{page:'course',search:'?id=c1'});h.run('courses');await flush();const reads=h.requests.length;h.lang('pt');assert.match(content(h.body),/Curso de mobilidade/);assert.match(content(h.body),/Primeira sessão/);assert.equal(h.ctx.document.title,'Curso de mobilidade · NODAL');assert.equal(h.requests.length,reads);assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
});
test('module content, resources and rail switch languages without losing a contribution draft or creating events',async()=>{
 const h=harness(path=>path.endsWith('/events')?{ok:true}:path.split('?')[0].endsWith('/posts')?{posts:[],nextCursor:null}:path.endsWith('/modules/m1')?{module:translatedModule}:{course:translatedCourse,modules:[translatedModule],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();const input=descendants(h.body).find(n=>n.name==='body');input.value='Draft stays exactly as typed';const reads=h.requests.length;h.lang('pt');
 for(const text of ['Curso de mobilidade','Primeira sessão','Descrição da sessão','Objetivos de aprendizagem','Escreva seu caso','Leitura da sessão'])assert.ok(content(h.body).includes(text),text);
 assert.equal(input.value,'Draft stays exactly as typed');assert.equal(h.requests.length,reads);h.lang('es');assert.match(content(h.body),/Primera sesión/);assert.match(content(h.body),/Lectura original/);assert.equal(h.requests.length,reads);
});
test('translation fallback is per field and translated markup remains plain text',()=>{
 const h=harness(()=>({}));const record={title:'Original title',description:'Original description',translations:{pt:{title:'<img src=x>',description:'   '}}};h.lang('pt');h.body.append(h.ctx.window.nodalPilot.source('h2',record,'title'),h.ctx.window.nodalPilot.source('p',record,'description'));assert.match(content(h.body),/<img src=x>/);assert.match(content(h.body),/Original description/);assert.equal(descendants(h.body).some(n=>n.tagName==='img'),false);
});
test('staff locale drafts survive language switches and save the full translations map',async()=>{
 const h=harness((path,opts)=>opts?.method==='PATCH'?{status:409,data:{error:'course changed'}}:path==='/api/admin/courses'?{courses:[translatedCourse]}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[]}:{course:{...translatedCourse,version:7},modules:[translatedModule]},{page:'teaching'});h.run('teaching');await flush();assert.equal(h.requests.filter(r=>r.path==='/api/admin/courses').length,1);const form=descendants(h.body).find(n=>n.tagName==='form');const input=name=>descendants(form).find(n=>n.name===name);input('translations.en.title').value='English draft';h.lang('pt');assert.equal(input('translationLanguage').value,'pt');input('translations.pt.title').value='Rascunho português';assert.match(content(h.body),/Curso de mobilidade/);assert.match(content(h.body),/Primeira sessão/);h.lang('es');assert.equal(input('translations.pt.title').value,'Rascunho português');assert.equal(input('translations.en.title').value,'English draft');await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.translations.en.title,'English draft');assert.equal(patch.body.translations.pt.title,'Rascunho português');assert.equal(patch.body.translations.es.title,'Curso de movilidad');assert.equal(patch.body.title,course.title);
});
test('API errors translate on the current screen without another request',async()=>{
 const h=harness(()=>({status:403,data:{error:'enroll and complete the intake before opening modules'}}));const node=new Node();h.body.append(node);try{await h.ctx.window.nodalPilot.api('/api/courses/c1/modules/m1');}catch(err){h.ctx.window.nodalPilot.status(node,err);}assert.match(content(node),/Enroll and complete/);h.lang('pt');assert.match(content(node),/Inscreva-se e preencha/);assert.equal(h.requests.length,1);
});
test('module editor preserves other locales and resource translations in its full-map save',async()=>{
 const h=harness((path,opts)=>opts?.method==='PATCH'?{status:409,data:{error:'module changed'}}:path==='/api/admin/courses'?{courses:[translatedCourse]}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[]}:{course:{...translatedCourse,version:7},modules:[{...translatedModule,version:3}]},{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form');const form=forms[1];const ptTitles=descendants(form).filter(n=>n.name==='translations.pt.title');ptTitles[0].value='Sessão editada';ptTitles[1].value='Material editado';await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.path,'/api/admin/courses/c1/modules/m1');assert.equal(patch.body.version,3);assert.equal(patch.body.translations.pt.title,'Sessão editada');assert.equal(patch.body.translations.en.instructions,'Write your case');assert.equal(patch.body.resources[0].translations.pt.title,'Material editado');assert.equal(patch.body.resources[0].translations.en.title,'Session reading');
});
test('saving a staff editor preserves sibling drafts and advances only its own saved version',async()=>{
 let savedCourse={...translatedCourse,version:7};const modules=[{...translatedModule,version:3},{...translatedModule,id:'m2',version:1}];
 const h=harness((path,opts)=>{
  if(opts?.method==='PATCH'){const body=JSON.parse(opts.body);if(path.endsWith('/modules/m1')){Object.assign(modules[0],body,{version:body.version+1});return{module:{...modules[0]}};}savedCourse={...savedCourse,...body,version:body.version+1};return{course:savedCourse};}
  if(path==='/api/admin/courses')return{courses:[savedCourse]};if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};return{course:{...savedCourse},modules:modules.map(m=>({...m}))};
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form');const [courseForm,moduleForm,otherModuleForm]=forms;
 const field=(form,name)=>descendants(form).find(n=>n.name===name);
 const moduleDraft=field(moduleForm,'translations.pt.title'),otherDraft=field(otherModuleForm,'instructions');moduleDraft.value='Unsaved module translation';otherDraft.value='Unsaved second session instructions';
 field(courseForm,'translations.en.title').value='Saved course name';await courseForm.listeners.submit({preventDefault(){}});
 assert.ok(descendants(h.body).includes(moduleDraft),'saving course keeps sibling module input mounted');assert.equal(moduleDraft.value,'Unsaved module translation');assert.ok(descendants(h.body).includes(otherDraft));assert.equal(otherDraft.value,'Unsaved second session instructions');
 const courseDraft=field(courseForm,'description');courseDraft.value='New unsaved course description';await moduleForm.listeners.submit({preventDefault(){}});assert.ok(descendants(h.body).includes(courseDraft));assert.equal(courseDraft.value,'New unsaved course description');assert.equal(otherDraft.value,'Unsaved second session instructions');
 moduleDraft.value='Saved a second time';await moduleForm.listeners.submit({preventDefault(){}});const writes=h.requests.filter(r=>r.method==='PATCH'&&r.path.endsWith('/modules/m1'));assert.deepEqual(writes.map(r=>r.body.version),[3,4]);assert.equal(h.requests.filter(r=>r.method===undefined).length,3,'saving does not rebuild or refetch the workspace');
});
test('reloading one conflicted module replaces only that form and uses its refreshed version',async()=>{
 let writes=0;const fresh={...translatedModule,version:5};const h=harness((path,opts)=>{
  if(opts?.method==='PATCH'){writes++;return writes===1?{status:409,data:{error:'module changed'}}:{module:{...fresh,...JSON.parse(opts.body),version:6}};}
  if(path==='/api/admin/courses')return{courses:[translatedCourse]};if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};if(path.endsWith('/modules/m1'))return{module:fresh};return{course:{...translatedCourse,version:7},modules:[{...translatedModule,version:3}]};
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'),courseDraft=descendants(forms[0]).find(n=>n.name==='description');courseDraft.value='Keep this course draft';await forms[1].listeners.submit({preventDefault(){}});const reload=descendants(forms[1]).find(n=>n.dataset.reload);await reload.listeners.click();const current=descendants(h.body).filter(n=>n.tagName==='form');assert.notEqual(current[1],forms[1]);assert.ok(descendants(h.body).includes(courseDraft));assert.equal(courseDraft.value,'Keep this course draft');await current[1].listeners.submit({preventDefault(){}});const patches=h.requests.filter(r=>r.method==='PATCH');assert.deepEqual(patches.map(r=>r.body.version),[3,5]);
});
test('creating a module keeps sibling drafts and adds exactly one fresh creation form',async()=>{
 const h=harness((path,opts)=>{
  if(opts?.method==='POST')return{module:{...JSON.parse(opts.body),id:'m3',version:1}};
  if(opts?.method==='PATCH')return{module:{...JSON.parse(opts.body),id:'m3',version:2}};
  if(path==='/api/admin/courses')return{courses:[translatedCourse]};if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};return{course:{...translatedCourse,version:7},modules:[{...translatedModule,version:3}]};
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'),draft=descendants(forms[1]).find(n=>n.name==='instructions'),create=forms[2];draft.value='Unpublished session draft';descendants(create).find(n=>n.name==='title').value='New session';await create.listeners.submit({preventDefault(){}});assert.ok(descendants(h.body).includes(draft));assert.equal(draft.value,'Unpublished session draft');assert.equal(descendants(h.body).filter(n=>n.tagName==='form').length,4);await create.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.requests.find(r=>r.method==='PATCH').path,'/api/admin/courses/c1/modules/m3');assert.equal(descendants(h.body).filter(n=>n.tagName==='form').length,4);
});

const learningFixture=(path,opts)=>{
 if(path.endsWith('/events'))return{ok:true};
 if(path.includes('/posts'))return opts?.method==='POST'?{post:{id:'saved'}}:{posts:[],nextCursor:null,revision:'r1'};
 if(path.endsWith('/modules/general'))return{module:{id:'general',kind:'discussion',title:'General discussion',resources:[]}};
 if(path.endsWith('/modules/m1'))return{module:{id:'m1',kind:'session',title:'Session',resources:[]}};
 return{course,modules:[{id:'general',kind:'discussion',title:'General discussion'},{id:'m1',kind:'session',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
};
const findKey=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
const inputNamed=(node,name)=>descendants(node).find(n=>n.name===name);
function fakeClock(h){
 const timers=new Map();let next=0;h.ctx.AbortController=AbortController;
 h.ctx.setTimeout=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;};h.ctx.clearTimeout=id=>timers.delete(id);
 return{timers,async tick(){const [id,timer]=timers.entries().next().value||[];assert.ok(timer,'expected one scheduled update check');timers.delete(id);await timer.fn();await flush();},visibility(value){h.ctx.document.visibilityState=value;h.documentEvents.visibilitychange?.forEach(fn=>fn());}};
}
test('session tabs lazily filter histories, retain independent drafts, and support keyboard navigation',async()=>{
 const h=harness(learningFixture,{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const discussion=h.ctx.document.getElementById('module-pane-discussion'),assignment=h.ctx.document.getElementById('module-pane-assignment');
 assert.equal(discussion.hidden,false);assert.equal(assignment.hidden,true);
 assert.equal(h.requests.filter(r=>r.path.includes('/posts')).length,1);assert.match(h.requests.find(r=>r.path.includes('/posts')).path,/kind=discussion&order=desc/);
 inputNamed(discussion,'body').value='Question draft';await h.ctx.document.getElementById('module-tab-assignment').listeners.click();
 inputNamed(assignment,'body').value='Assignment draft';assert.equal(discussion.hidden,true);assert.equal(assignment.hidden,false);
 assert.match(h.requests.filter(r=>r.path.includes('/posts')).at(-1).path,/kind=assignment&order=desc/);
 await h.ctx.document.getElementById('module-tab-discussion').listeners.click();assert.equal(inputNamed(discussion,'body').value,'Question draft');
 await h.ctx.document.getElementById('module-tab-assignment').listeners.click();assert.equal(inputNamed(assignment,'body').value,'Assignment draft');
 assert.equal(h.requests.filter(r=>r.path.includes('/posts')).length,2,'returning to a loaded view does not refetch');
 h.ctx.document.getElementById('module-tab-assignment').listeners.keydown({key:'Home',preventDefault(){}});assert.equal(h.ctx.document.getElementById('module-tab-materials')['aria-selected'],'true');
 h.lang('pt');assert.equal(h.ctx.document.getElementById('module-tab-discussion').textContent,'Discussão');assert.equal(h.ctx.document.getElementById('module-tab-assignment').textContent,'Atividades');
});
test('general discussion sits outside the session rail and never exposes assignment publication',async()=>{
 const h=harness(learningFixture,{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const community=descendants(h.body).find(n=>n.className==='pilot-course-community'),rail=descendants(h.body).find(n=>n.tagName==='ol');
 assert.equal(descendants(rail).filter(n=>n.dataset.module).length,1);assert.equal(descendants(rail).some(n=>n.dataset.module==='general'),false);
 await findKey(community,'generalDiscussion').listeners.click();await flush();assert.equal(h.ctx.document.getElementById('module-tab-assignment'),undefined);
 const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,'body'));inputNamed(form,'body').value='A course-wide question';await form.listeners.submit({preventDefault(){}});
 assert.equal(h.requests.find(r=>r.path.endsWith('/general/posts')&&r.method==='POST').body.kind,'question');
 inputNamed(form,'body').value='Another question';await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.path.endsWith('/general/posts')&&r.method==='POST').at(-1).body.kind,'question');
});
test('background checks request only the latest revision and manual refresh preserves the focused draft',async()=>{
 let changed=false;const post={id:'p2',authorName:'Ana',createdAt:'2026-09-07T12:00:00Z',kind:'question',body:'New discussion',links:[],attachments:[]};
 const h=harness((path,opts)=>path.includes('/posts')?{posts:changed?[post]:[],nextCursor:null,revision:changed?'r2':'r1'}:learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();
 const draft=inputNamed(h.body,'body');draft.value='Keep this draft';let focusChanges=0;draft.focus=()=>focusChanges++;
 assert.equal(clock.timers.size,1);assert.equal([...clock.timers.values()][0].delay,30000);changed=true;await clock.tick();
 assert.match(h.requests.at(-1).path,/kind=discussion&latest=1/);assert.match(content(h.body),/New activity is available/);assert.equal(h.ctx.document.getElementById('post-p2'),undefined);assert.equal(draft.value,'Keep this draft');assert.equal(clock.timers.size,0,'waits for the reader after detecting activity');
 await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();assert.ok(h.ctx.document.getElementById('post-p2'));assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Keep this draft');assert.equal(focusChanges,0);assert.equal(clock.timers.size,1);
 clock.visibility('hidden');assert.equal(clock.timers.size,0);clock.visibility('visible');assert.equal(clock.timers.size,1);
 await h.ctx.document.getElementById('module-tab-materials').listeners.click();assert.equal(clock.timers.size,0);await h.ctx.document.getElementById('module-tab-discussion').listeners.click();assert.equal(clock.timers.size,1);
 h.windowEvents.pagehide();assert.equal(clock.timers.size,0);h.windowEvents.pageshow();assert.equal(clock.timers.size,1,'bfcache return resumes the current view');await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();assert.equal(draft.value,'Keep this draft');
});
test('polling aborts on module navigation and authentication expiry does not navigate away from a draft',async()=>{
 let finish,expire=false;const h=harness((path,opts)=>path.includes('latest=1')?expire?{status:401,data:{error:'expired'}}:new Promise(resolve=>finish=resolve):learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();
 const pending=clock.tick();await flush();const signal=h.requests.at(-1).signal;assert.equal(signal.aborted,false);
 await findKey(descendants(h.body).find(n=>n.className==='pilot-course-community'),'generalDiscussion').listeners.click();assert.equal(signal.aborted,true);finish({posts:[],revision:'r2'});await pending;
 expire=true;inputNamed(h.body,'body').value='Unsaved question';await clock.tick();assert.equal(h.assigned(),'');assert.equal(inputNamed(h.body,'body').value,'Unsaved question');assert.match(content(h.body),/Automatic updates paused/);assert.equal(clock.timers.size,0);
});
test('uploaded material downloads use an authenticated attachment path and record the exact resource',async()=>{
 const h=harness((path,opts)=>path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[{title:'Actual PDF',kind:'reading',attachmentId:'f1'}]}}:learningFixture(path,opts),{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const link=descendants(h.body).find(n=>n.href==='/api/course-attachments/f1');assert.ok(link);assert.equal(link.target,undefined);link.listeners.click();await flush();assert.equal(h.requests.find(r=>r.body?.kind==='content_open').body.resourceUrl,'/api/course-attachments/f1');
});
test('staff uploads a course-owned file and saves an attachment resource without losing sibling drafts',async()=>{
 let module={id:'m1',title:'Session',kind:'session',resources:[],version:1};
 const h=harness((path,opts)=>{
  if(path.endsWith('/attachments'))return opts?.method==='POST'?{attachment:{id:'f1',name:'Territory.pdf',mime:'application/pdf',size:10}}:{attachments:[{id:'f1',name:'Territory.pdf',status:'ready',referenced:false}]};
  if(opts?.method==='PATCH'){module={...module,...JSON.parse(opts.body),version:2};return{module};}
  if(path==='/api/admin/courses')return{courses:[course]};if(path.endsWith('/report'))return{summary:{},participants:[],feedback:[]};return{course:{...course,version:1},modules:[module]};
 },{page:'teaching'});h.ctx.FileReader=class{readAsDataURL(){this.result='data:application/pdf;base64,YWJj';this.onload();}};h.run('teaching');await flush();
 const forms=descendants(h.body).filter(n=>n.tagName==='form'),form=forms[1];inputNamed(forms[0],'description').value='Unsaved course text';
 const manager=descendants(form).find(n=>n.className==='pilot-file-manager');manager.open=true;manager.listeners.toggle();await flush();
 inputNamed(form,'officialFile').files=[{name:'Territory.pdf',type:'application/pdf',size:10}];await findKey(form,'uploadFile').listeners.click();
 assert.equal(h.requests.find(r=>r.path.endsWith('/m1/attachments')&&r.method==='POST').body.data,'YWJj');assert.match(content(form),/Save changes to make it available/);
 await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.resources[0].attachmentId,'f1');assert.equal('url' in patch.body.resources[0],false);assert.equal('kind' in patch.body,false,'fixed module kind is not patched');assert.equal(inputNamed(forms[0],'description').value,'Unsaved course text');
});
test('staff file validation prevents invalid uploads and an unsaved module asks to save first',async()=>{
 const h=harness(path=>path==='/api/admin/courses'?{courses:[course]}:path.endsWith('/report')?{summary:{},participants:[],feedback:[]}:{course:{...course,version:1},modules:[{id:'m1',title:'Session',resources:[]}]},{page:'teaching'});h.run('teaching');await flush();
 const forms=descendants(h.body).filter(n=>n.tagName==='form');inputNamed(forms[1],'officialFile').files=[{name:'large.pdf',type:'application/pdf',size:4*1024*1024}];await findKey(forms[1],'uploadFile').listeners.click();assert.match(content(forms[1]),/no larger than 3 MB/);
 await findKey(forms[2],'uploadFile').listeners.click();assert.match(content(forms[2]),/Save this module first/);assert.equal(h.requests.some(r=>r.method==='POST'),false);
});
test('staff can reclaim an unlinked official upload but linked files have no delete action',async()=>{
 let removed=false;const h=harness((path,opts)=>{
  if(opts?.method==='DELETE'){removed=true;return{ok:true};}
  if(path.endsWith('/attachments'))return{attachments:[{id:'linked',name:'Published.pdf',status:'ready',referenced:true},...removed?[]:[{id:'orphan',name:'Unused.pdf',status:'ready',referenced:false}]]};
  if(path==='/api/admin/courses')return{courses:[course]};if(path.endsWith('/report'))return{summary:{},participants:[],feedback:[]};return{course:{...course,version:1},modules:[{id:'m1',title:'Session',resources:[{title:'Published PDF',attachmentId:'linked',kind:'reading'}]}]};
 },{page:'teaching'});h.ctx.confirm=()=>true;h.run('teaching');await flush();const manager=descendants(h.body).find(n=>n.className==='pilot-file-manager');manager.open=true;await manager.listeners.toggle();await flush();
 const rows=descendants(manager).filter(n=>n.className==='pilot-managed-file');assert.equal(findKey(rows[0],'deleteFile'),undefined);assert.ok(findKey(rows[1],'deleteFile'));await findKey(rows[1],'deleteFile').listeners.click();assert.equal(h.requests.find(r=>r.method==='DELETE').path,'/api/admin/courses/c1/modules/m1/attachments/orphan');assert.doesNotMatch(content(manager),/Unused.pdf/);assert.match(content(manager),/File deleted/);
});

test('staff module type is read-only and new modules use the backend session default',async()=>{
 const h=harness((path,opts)=>opts?.method==='POST'?{module:{id:'m2',...JSON.parse(opts.body),kind:'session',version:1}}:path==='/api/admin/courses'?{courses:[course]}:path.endsWith('/report')?{summary:{},participants:[],feedback:[]}:{course:{...course,version:1},modules:[{id:'general',title:'General discussion',kind:'discussion',resources:[]}]},{page:'teaching'});h.run('teaching');await flush();
 const forms=descendants(h.body).filter(n=>n.tagName==='form');assert.equal(inputNamed(forms[1],'moduleKind'),undefined);assert.equal(inputNamed(forms[2],'moduleKind'),undefined);assert.match(content(forms[1]),/Module type.*Discussion/s);
 inputNamed(forms[2],'title').value='New session';await forms[2].listeners.submit({preventDefault(){}});const request=h.requests.find(r=>r.method==='POST');assert.equal('kind' in request.body,false);
});
test('failed module navigation preserves the current draft and functional refresh while loading and after failure',async()=>{
 let finishNavigation;const h=harness((path,opts)=>path.endsWith('/modules/m2')?new Promise(resolve=>{finishNavigation=resolve;}):path==='/api/courses/c1'?{...learningFixture(path,opts),modules:[{id:'m1',title:'Session'},{id:'m2',title:'Next session'}]}:learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();
 const draft=inputNamed(h.body,'body'),refresh=findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation');draft.value='Keep my current discussion draft';
 const pending=descendants(h.body).find(n=>n.dataset.module==='m2').listeners.click();await flush();assert.equal(clock.timers.size,0,'background polling pauses during navigation');
 const reads=h.requests.filter(r=>r.path.includes('/m1/posts')).length;await refresh.listeners.click();assert.equal(h.requests.filter(r=>r.path.includes('/m1/posts')).length,reads+1,'current visible refresh remains functional while loading');assert.equal(clock.timers.size,0);
 finishNavigation({status:503,data:{error:'unavailable'}});await pending;assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Keep my current discussion draft');assert.equal(clock.timers.size,1,'current conversation resumes after failure');
 await refresh.listeners.click();assert.equal(h.requests.filter(r=>r.path.includes('/m1/posts')).length,reads+2);assert.equal(descendants(h.body).find(n=>n.dataset.module==='m1')['aria-current'],'step');
});
test('a failed latest navigation cannot activate an earlier late module response',async()=>{
 let finishEarlier,finishLatest;const h=harness((path,opts)=>path.endsWith('/modules/m2')?new Promise(resolve=>{finishEarlier=resolve;}):path.endsWith('/modules/m3')?new Promise(resolve=>{finishLatest=resolve;}):path==='/api/courses/c1'?{...learningFixture(path,opts),modules:[{id:'m1',title:'Current session'},{id:'m2',title:'Earlier request'},{id:'m3',title:'Latest request'}]}:learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();
 const draft=inputNamed(h.body,'body');draft.value='Current session draft';const earlier=descendants(h.body).find(n=>n.dataset.module==='m2').listeners.click();await flush();const latest=descendants(h.body).find(n=>n.dataset.module==='m3').listeners.click();await flush();
 finishLatest({status:503,data:{error:'unavailable'}});await latest;assert.equal(clock.timers.size,1);
 finishEarlier({module:{id:'m2',title:'Late stale session',resources:[]}});await earlier;
 assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Current session draft');assert.doesNotMatch(content(h.body),/Late stale session/);assert.equal(h.requests.some(r=>r.path.includes('/m2/posts')),false);assert.equal(descendants(h.body).find(n=>n.dataset.module==='m1')['aria-current'],'step');
 await clock.tick();assert.match(h.requests.at(-1).path,/\/m1\/posts\?kind=discussion&latest=1/);
});
