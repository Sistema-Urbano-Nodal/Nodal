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
 const requests=[],listeners=[];let assigned='';
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),addEventListener(){}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign:s=>{assigned=s;},replace:s=>{assigned=s;}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},window:{nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,run:name=>vm.runInContext(script(name),ctx),assigned:()=>assigned,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
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
test('pilot mask is a render-blocking stylesheet on existing public pages',()=>{
 for(const name of ['index','login','profile','dashboard','payments']){const html=readFileSync(new URL('../web/pages/'+name+'.html',import.meta.url),'utf8');const css=html.match(/href="courses\.css(?:\?[^"]*)?"/);assert.ok(css,name+' must load the billing mask');assert.ok(css.index<html.indexOf('</head>'));const pilot=html.match(/src="pilot\.js(?:\?[^"]*)?"/);assert.ok(pilot,name+' must load configuration');assert.ok(pilot.index<html.lastIndexOf('</body>'));}
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
  if(path.endsWith('/posts')){if(opts?.method==='POST')return{post:{id:'p2'}};return{posts,nextCursor:null};}
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',description:'Learning',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session',sessionDate:'2026-09-09'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();const reply=descendants(h.body).find(n=>n.tagName==='button'&&n.dataset.pilotText==='reply');reply.listeners.click();const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='body'));descendants(form).find(n=>n.name==='body').value='My response';await form.listeners.submit({preventDefault(){}});const post=h.requests.find(r=>r.path.endsWith('/posts')&&r.method==='POST');assert.equal(post.body.kind,'comment');assert.equal(post.body.parentId,'p1');assert.equal(post.body.body,'My response');assert.deepEqual(post.body.attachmentIds,[]);assert.equal(descendants(form).find(n=>n.name==='body').value,'');
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
  if(path.endsWith('/posts'))return opts?.method==='POST'?{post:{id:'p2'}}:{posts:[{id:'p1',authorName:'Ana',createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'A question',attachments:[],links:[]}],nextCursor:null};
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',description:'Read and discuss',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const box=descendants(h.body).find(n=>n.className==='pilot-composer');assert.notEqual(box.open,true);
 const reply=descendants(h.body).find(n=>n.tagName==='button'&&n.dataset.pilotText==='reply');reply.listeners.click();assert.equal(box.open,true);
 const form=descendants(box).find(n=>n.tagName==='form');descendants(form).find(n=>n.name==='body').value='My answer';await form.listeners.submit({preventDefault(){}});assert.equal(box.open,false);
 const feedbacks=descendants(h.body).filter(n=>n.className==='pilot-feedback');assert.equal(feedbacks.length,1);assert.match(content(feedbacks[0]),/take part in this conversation/);
});
test('deleted contributions preserve their thread without offering an invalid reply',async()=>{
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.endsWith('/posts')?{posts:[{id:'p1',deleted:true,createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'',attachments:[],links:[]}],nextCursor:null}:path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[]}}:{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const deleted=descendants(h.body).find(n=>n.id==='post-p1');assert.match(content(deleted),/removed by the teaching team/);assert.equal(descendants(deleted).some(n=>n.dataset.pilotText==='reply'),false);
});
test('initial discussion failure stays visible and offers a working retry',async()=>{
 let failed=true;const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.endsWith('/posts')?(failed?{status:503,data:{error:'Discussion unavailable'}}:{posts:[],nextCursor:null}):path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[]}}:{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();
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
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();const more=descendants(h.body).find(n=>n.dataset.pilotText==='more');more.listeners.click();await flush();
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
 const h=harness(path=>path.endsWith('/events')?{ok:true}:path.endsWith('/posts')?{posts:[],nextCursor:null}:path.endsWith('/modules/m1')?{module:translatedModule}:{course:translatedCourse,modules:[translatedModule],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();const input=descendants(h.body).find(n=>n.name==='body');input.value='Draft stays exactly as typed';const reads=h.requests.length;h.lang('pt');
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
