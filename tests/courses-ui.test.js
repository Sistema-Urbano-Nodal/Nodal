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
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
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
 let fail=true;const h=harness(()=>fail?{status:500,data:{error:'Retry required'}}:{feedback:{id:'saved'}});const box=h.ctx.window.nodalPilot.feedback('assignment',{courseId:'c1',moduleId:'m1'});h.body.append(box);const form=descendants(box).find(n=>n.tagName==='form');descendants(form).find(n=>n.type==='radio'&&n.value==='4').checked=true;await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.match(content(box),/Retry required/);assert.doesNotMatch(content(box),/Feedback saved/);fail=false;await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.match(content(box),/Feedback saved/);assert.equal(h.requests[1].body.action,'assignment');assert.equal(h.requests[1].body.moduleId,'m1');assert.equal(h.requests[1].body.rating,4);
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
 assert.match(content(h.ids.pilotStatus),/Discussion unavailable/);const retry=descendants(h.body).find(n=>n.dataset.pilotText==='retry');assert.ok(retry);failed=false;await retry.listeners.click();await flush();assert.match(content(h.body),/Start the conversation/);
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
