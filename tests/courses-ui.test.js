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
 getAttribute(k){return this[k]??null;}
 removeAttribute(k){delete this[k];}
 addEventListener(k,f){this.listeners[k]=f;}
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='input,textarea,select,button'?['input','textarea','select','button'].includes(n.tagName):selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
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
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign:s=>{assigned=s;},replace:s=>{assigned=s;}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method,signal:opts?.signal});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>{if(result.jsonError)throw result.jsonError;return result.data??result;}};},window:{addEventListener(k,f){windowEvents[k]=f;},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,documentEvents,windowEvents,run:name=>vm.runInContext(script(name),ctx),assigned:()=>assigned,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}
const course={id:'c1',title:'Real course <img src=x onerror=alert(1)>',description:'Author content',startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true};
test('recording embeds reconstruct trusted provider URLs and reject unsafe or unsupported hosts',()=>{
 const {recordingEmbed:embed}=harness(()=>({})).ctx.window.nodalPilot;
 for(const url of ['https://youtu.be/abcdefghijk?t=30s','https://www.youtube.com/watch?v=abcdefghijk&start=30&autoplay=1','https://www.youtube.com/embed/abcdefghijk?start=30'])assert.equal(embed(url).src,'https://www.youtube-nocookie.com/embed/abcdefghijk?start=30');
 assert.equal(embed('https://drive.google.com/file/d/abcdefghijk/view?usp=sharing&resourcekey=0-example').src,'https://drive.google.com/file/d/abcdefghijk/preview?resourcekey=0-example');
 assert.equal(embed('https://drive.google.com/open?id=abcdefghijk').src,'https://drive.google.com/file/d/abcdefghijk/preview');
 assert.equal(embed('https://vimeo.com/123456789/abcdef1234').src,'https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1');
 assert.equal(embed('https://player.vimeo.com/video/123456789?h=abcdef1234&autoplay=1').src,'https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1');
 for(const url of ['javascript:alert(1)','http://youtube.com/watch?v=abcdefghijk','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://evil.test/recording.mp4','https://drive.google.com:8443/file/d/abcdefghijk/view','https://youtube.com/watch?v=bad','https://vimeo.com/123456789?h=<script>'])assert.equal(embed(url),null,url);
});
function materialHarness(){
 const module={id:'m1',title:'Session',objectives:'Understand the station',instructions:'Observe and photograph the station',translations:{pt:{instructions:'Observe e fotografe a estação'}},resources:[
  {title:'Slides',kind:'slides',url:'https://example.test/slides'},
  {title:'Practice worksheet',kind:'activity',url:'https://example.test/worksheet'},
  {title:'Session recording',kind:'recording',url:'https://drive.google.com/file/d/abcdefghijk/view',translations:{pt:{title:'Gravação da sessão'}}},
  {title:'Other recording',kind:'recording',url:'https://example.test/recording'}
 ]};
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.includes('/posts')?{posts:[],nextCursor:null}:path.endsWith('/modules/m1')?{module}:{course,modules:[module],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1&view=materials'});
 h.run('courses');return h;
}
test('activity instructions and files belong to Activity while objectives and recordings stay in Materials',async()=>{
 const h=materialHarness();await flush();const materials=h.ctx.document.getElementById('module-pane-materials'),activity=h.ctx.document.getElementById('module-pane-assignment');
 assert.match(content(materials),/Understand the station/);assert.doesNotMatch(content(materials),/Observe and photograph|Practice worksheet/);
 assert.match(content(activity),/Observe and photograph the station/);assert.match(content(activity),/Practice worksheet/);assert.doesNotMatch(content(activity),/Understand the station|Session recording/);
 assert.equal(materials.hidden,false);assert.equal(activity.hidden,true);
 await h.ctx.document.getElementById('module-tab-assignment').listeners.click();assert.equal(activity.hidden,false);assert.equal(materials.hidden,true);
 h.lang('pt');assert.match(content(activity),/Observe e fotografe a estação/);
});
test('recording player loads only on demand, logs an opening, and stops on tab change and page exit',async()=>{
 const h=materialHarness();await flush();const nodes=()=>descendants(h.body),trigger=()=>nodes().find(n=>n.dataset.pilotText==='watchHere');
 assert.equal(nodes().filter(n=>n.tagName==='iframe').length,0);assert.equal(nodes().filter(n=>n.dataset.pilotText==='watchHere').length,1);
 assert.ok(nodes().some(n=>n.href==='https://example.test/recording'));assert.ok(nodes().some(n=>n.href==='https://drive.google.com/file/d/abcdefghijk/view'));
 trigger().listeners.click();await flush();const frame=nodes().find(n=>n.tagName==='iframe');assert.equal(frame.src,'https://drive.google.com/file/d/abcdefghijk/preview');assert.equal(frame.title,'Session recording');assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(frame.sandbox,'allow-scripts allow-same-origin allow-presentation');
 assert.equal(h.requests.filter(r=>r.body?.kind==='recording_open').length,1);assert.equal(h.requests.find(r=>r.body?.kind==='recording_open').body.resourceUrl,'https://drive.google.com/file/d/abcdefghijk/view');
 h.lang('pt');assert.equal(frame.title,'Gravação da sessão');
 await h.ctx.document.getElementById('module-tab-assignment').listeners.click();assert.equal(nodes().filter(n=>n.tagName==='iframe').length,0);
 await h.ctx.document.getElementById('module-tab-materials').listeners.click();trigger().listeners.click();nodes().find(n=>n.dataset.pilotText==='closeRecording').listeners.click();assert.equal(nodes().filter(n=>n.tagName==='iframe').length,0);
 trigger().listeners.click();h.windowEvents.pagehide();assert.equal(nodes().filter(n=>n.tagName==='iframe').length,0);
});
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
 },{page:'teaching'});h.run('teaching');await flush();const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));const title=descendants(form).find(n=>n.name==='title');title.value='Unsaved revision';await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.version,7);assert.equal(patch.body.title,'Unsaved revision');assert.equal(title.value,'Unsaved revision');assert.match(content(form),/Someone changed this record/);assert.ok(descendants(form).some(n=>n.dataset.reload));
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
test('deleted contributions are absent from the conversation and offer no reply action',async()=>{
 const h=harness(path=>path==='/api/auth/me'?{user:{permission:'member'}}:path.endsWith('/events')?{ok:true}:path.split('?')[0].endsWith('/posts')?{posts:[{id:'p1',deleted:true,createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'',attachments:[],links:[]}],nextCursor:null}:path.endsWith('/modules/m1')?{module:{id:'m1',title:'Session',resources:[]}}:{course,modules:[{id:'m1',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();
 assert.equal(descendants(h.body).some(n=>n.id==='post-p1'),false);assert.doesNotMatch(content(h.body),/Contribution removed/);assert.equal(descendants(h.body).some(n=>n.dataset.pilotText==='reply'&&!n.hidden),false);
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
 const h=harness((path,opts)=>opts?.method==='PATCH'?{status:409,data:{error:'course changed'}}:path==='/api/admin/courses'?{courses:[translatedCourse]}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[]}:{course:{...translatedCourse,version:7},modules:[translatedModule]},{page:'teaching'});h.run('teaching');await flush();assert.equal(h.requests.filter(r=>r.path==='/api/admin/courses').length,1);const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));const input=name=>descendants(form).find(n=>n.name===name);input('translations.en.title').value='English draft';h.lang('pt');assert.equal(input('translationLanguage').value,'pt');input('translations.pt.title').value='Rascunho português';assert.match(content(h.body),/Curso de mobilidade/);assert.match(content(h.body),/Primeira sessão/);h.lang('es');assert.equal(input('translations.pt.title').value,'Rascunho português');assert.equal(input('translations.en.title').value,'English draft');await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.translations.en.title,'English draft');assert.equal(patch.body.translations.pt.title,'Rascunho português');assert.equal(patch.body.translations.es.title,'Curso de movilidad');assert.equal(patch.body.title,course.title);
});
test('API errors translate on the current screen without another request',async()=>{
 const h=harness(()=>({status:403,data:{error:'enroll and complete the intake before opening modules'}}));const node=new Node();h.body.append(node);try{await h.ctx.window.nodalPilot.api('/api/courses/c1/modules/m1');}catch(err){h.ctx.window.nodalPilot.status(node,err);}assert.match(content(node),/Enroll and complete/);h.lang('pt');assert.match(content(node),/Inscreva-se e preencha/);assert.equal(h.requests.length,1);
});
test('module editor preserves other locales and resource translations in its full-map save',async()=>{
 const h=harness((path,opts)=>opts?.method==='PATCH'?{status:409,data:{error:'module changed'}}:path==='/api/admin/courses'?{courses:[translatedCourse]}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[]}:{course:{...translatedCourse,version:7},modules:[{...translatedModule,version:3}]},{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));const form=forms[1];const ptTitles=descendants(form).filter(n=>n.name==='translations.pt.title');ptTitles[0].value='Sessão editada';ptTitles[1].value='Material editado';await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.path,'/api/admin/courses/c1/modules/m1');assert.equal(patch.body.version,3);assert.equal(patch.body.translations.pt.title,'Sessão editada');assert.equal(patch.body.translations.en.instructions,'Write your case');assert.equal(patch.body.resources[0].translations.pt.title,'Material editado');assert.equal(patch.body.resources[0].translations.en.title,'Session reading');
});
test('saving a staff editor preserves sibling drafts and advances only its own saved version',async()=>{
 let savedCourse={...translatedCourse,version:7};const modules=[{...translatedModule,version:3},{...translatedModule,id:'m2',version:1}];
 const h=harness((path,opts)=>{
  if(opts?.method==='PATCH'){const body=JSON.parse(opts.body);if(path.endsWith('/modules/m1')){Object.assign(modules[0],body,{version:body.version+1});return{module:{...modules[0]}};}savedCourse={...savedCourse,...body,version:body.version+1};return{course:savedCourse};}
  if(path==='/api/admin/courses')return{courses:[savedCourse]};if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};return{course:{...savedCourse},modules:modules.map(m=>({...m}))};
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));const [courseForm,moduleForm,otherModuleForm]=forms;
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
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title')),courseDraft=descendants(forms[0]).find(n=>n.name==='description');courseDraft.value='Keep this course draft';await forms[1].listeners.submit({preventDefault(){}});const reload=descendants(forms[1]).find(n=>n.dataset.reload);await reload.listeners.click();const current=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));assert.notEqual(current[1],forms[1]);assert.ok(descendants(h.body).includes(courseDraft));assert.equal(courseDraft.value,'Keep this course draft');await current[1].listeners.submit({preventDefault(){}});const patches=h.requests.filter(r=>r.method==='PATCH');assert.deepEqual(patches.map(r=>r.body.version),[3,5]);
});
test('creating a module keeps sibling drafts and adds exactly one fresh creation form',async()=>{
 const h=harness((path,opts)=>{
  if(opts?.method==='POST')return{module:{...JSON.parse(opts.body),id:'m3',version:1}};
  if(opts?.method==='PATCH')return{module:{...JSON.parse(opts.body),id:'m3',version:2}};
  if(path==='/api/admin/courses')return{courses:[translatedCourse]};if(path.endsWith('/report'))return{summary:{enrolled:0},participants:[],feedback:[]};return{course:{...translatedCourse,version:7},modules:[{...translatedModule,version:3}]};
 },{page:'teaching'});h.run('teaching');await flush();const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title')),draft=descendants(forms[1]).find(n=>n.name==='instructions'),create=forms[2];draft.value='Unpublished session draft';descendants(create).find(n=>n.name==='title').value='New session';await create.listeners.submit({preventDefault(){}});assert.ok(descendants(h.body).includes(draft));assert.equal(draft.value,'Unpublished session draft');assert.equal(descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title')).length,4);await create.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.requests.find(r=>r.method==='PATCH').path,'/api/admin/courses/c1/modules/m3');assert.equal(descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title')).length,4);
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
 const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title')),form=forms[1];inputNamed(forms[0],'description').value='Unsaved course text';
 const manager=descendants(form).find(n=>n.className==='pilot-file-manager');manager.open=true;manager.listeners.toggle();await flush();
 inputNamed(form,'officialFile').files=[{name:'Territory.pdf',type:'application/pdf',size:10}];await findKey(form,'uploadFile').listeners.click();
 assert.equal(h.requests.find(r=>r.path.endsWith('/m1/attachments')&&r.method==='POST').body.data,'YWJj');assert.match(content(form),/Save changes to make it available/);
 await form.listeners.submit({preventDefault(){}});const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.body.resources[0].attachmentId,'f1');assert.equal('url' in patch.body.resources[0],false);assert.equal('kind' in patch.body,false,'fixed module kind is not patched');assert.equal(inputNamed(forms[0],'description').value,'Unsaved course text');
});
test('staff file validation prevents invalid uploads and an unsaved module asks to save first',async()=>{
 const h=harness(path=>path==='/api/admin/courses'?{courses:[course]}:path.endsWith('/report')?{summary:{},participants:[],feedback:[]}:{course:{...course,version:1},modules:[{id:'m1',title:'Session',resources:[]}]},{page:'teaching'});h.run('teaching');await flush();
 const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));inputNamed(forms[1],'officialFile').files=[{name:'large.pdf',type:'application/pdf',size:4*1024*1024}];await findKey(forms[1],'uploadFile').listeners.click();assert.match(content(forms[1]),/no larger than 3 MB/);
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
 const forms=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'));assert.equal(inputNamed(forms[1],'moduleKind'),undefined);assert.equal(inputNamed(forms[2],'moduleKind'),undefined);assert.match(content(forms[1]),/Module type.*Discussion/s);
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

test('course directory uses its authenticated role flag without a redundant profile request',async()=>{
 for(const isAdmin of [false,true]){const h=harness(()=>({courses:[course],isAdmin}));h.run('courses');await flush();assert.equal(h.ids.teachingLink.hidden,!isAdmin);assert.deepEqual(h.requests.map(r=>r.path),['/api/courses']);}
});
test('reopening the visible module preserves discussion drafts and avoids duplicate reads and activity events',async()=>{
 const h=harness(learningFixture,{page:'course',search:'?id=c1'});h.run('courses');await flush();const draft=inputNamed(h.body,'body');draft.value='Do not discard this question';const requests=h.requests.length;await descendants(h.body).find(n=>n.dataset.module==='m1').listeners.click();await flush();assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Do not discard this question');assert.equal(h.requests.length,requests);
});
test('feedback blocks repeated pending submissions and recovers after a failed save',async()=>{
 const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)));const box=h.ctx.window.nodalPilot.feedback('course',{courseId:'c1'}),form=descendants(box).find(n=>n.tagName==='form');h.body.append(box);descendants(form).find(n=>n.type==='radio'&&n.value==='4').checked=true;
 const first=form.listeners.submit({preventDefault(){},stopPropagation(){}}),second=form.listeners.submit({preventDefault(){},stopPropagation(){}});
 try{assert.equal(h.requests.length,1);assert.equal(form['aria-busy'],'true');}finally{pending.forEach(resolve=>resolve({status:503,data:{error:'unavailable'}}));await Promise.all([first,second]);}
 assert.equal(form['aria-busy'],'false');assert.equal(findKey(form,'sendFeedback').disabled,false);assert.equal(descendants(form).find(n=>n.type==='radio'&&n.value==='4').checked,true);
});
test('intake prevents duplicate writes while pending and keeps every field after a failure',async()=>{
 const pending=[];const h=harness((path,opts)=>opts?.method==='PUT'?new Promise(resolve=>pending.push(resolve)):{course,modules:[],enrollment:{},intake:null,isAdmin:false},{page:'course',search:'?id=c1'});h.run('courses');await flush();const form=descendants(h.body).find(n=>n.tagName==='form');for(const field of descendants(form).filter(n=>n.name))field.value='My intake answer';const first=form.listeners.submit({preventDefault(){}}),second=form.listeners.submit({preventDefault(){}});
 try{assert.equal(h.requests.filter(r=>r.method==='PUT').length,1);assert.equal(form['aria-busy'],'true');}finally{pending.forEach(resolve=>resolve({status:503,data:{error:'unavailable'}}));await Promise.all([first,second]);}
 assert.equal(form['aria-busy'],'false');assert.equal(inputNamed(form,'expectations').value,'My intake answer');assert.equal(findKey(form,'saveIntake').disabled,false);
});
test('discussion composer prevents duplicate writes and preserves the draft on failure',async()=>{
 const pending=[];const h=harness((path,opts)=>opts?.method==='POST'&&path.endsWith('/posts')?new Promise(resolve=>pending.push(resolve)):learningFixture(path,opts),{page:'course',search:'?id=c1'});h.run('courses');await flush();const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,'body'));inputNamed(form,'body').value='A deliberate contribution';const first=form.listeners.submit({preventDefault(){}}),second=form.listeners.submit({preventDefault(){}});
 try{assert.equal(h.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/posts')).length,1);assert.equal(form['aria-busy'],'true');}finally{pending.forEach(resolve=>resolve({status:503,data:{error:'unavailable'}}));await Promise.all([first,second]);}
 assert.equal(form['aria-busy'],'false');assert.equal(inputNamed(form,'body').value,'A deliberate contribution');assert.equal(findKey(form,'post').disabled,false);
});
test('stalled requests have a bounded timeout and return localizable errors without overriding caller cancellation',async()=>{
 let timeout;const h=harness(()=>{throw Object.assign(new Error('sensitive network detail'),{name:'TimeoutError'});});h.ctx.AbortSignal={timeout:ms=>{timeout=ms;return{timeout:ms};}};
 const error=await h.ctx.window.nodalPilot.api('/api/courses/c1').catch(e=>e),node=new Node();h.body.append(node);h.ctx.window.nodalPilot.status(node,error);assert.equal(timeout,45000);assert.match(content(node),/request took too long/);assert.doesNotMatch(content(node),/sensitive/);h.lang('pt');assert.match(content(node),/solicitação demorou/);
 const controlled={aborted:false};await h.ctx.window.nodalPilot.api('/api/courses/c1',undefined,undefined,{signal:controlled}).catch(()=>{});assert.equal(h.requests.at(-1).signal,controlled);
});
test('clicking the current session cancels a pending navigation without refetching or accepting its late response',async()=>{
 let finish;const h=harness((path,opts)=>path.endsWith('/modules/m2')?new Promise(resolve=>{finish=resolve;}):path==='/api/courses/c1'?{...learningFixture(path,opts),modules:[{id:'m1',title:'Current'},{id:'m2',title:'Next'}]}:learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();const draft=inputNamed(h.body,'body');draft.value='Keep this thought';const pending=descendants(h.body).find(n=>n.dataset.module==='m2').listeners.click();await flush();const count=h.requests.length;await descendants(h.body).find(n=>n.dataset.module==='m1').listeners.click();assert.equal(clock.timers.size,1);assert.equal(h.requests.length,count);finish({module:{id:'m2',title:'Late next module',resources:[]}});await pending;assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Keep this thought');assert.doesNotMatch(content(h.body),/Late next module/);
});

test('teaching module creation prevents duplicate requests while a save is pending and allows retry after failure',async()=>{
 const pending=[];const h=harness((path,opts)=>opts?.method==='POST'?new Promise(resolve=>pending.push(resolve)):path==='/api/admin/courses'?{courses:[course]}:path.endsWith('/report')?{summary:{},participants:[],feedback:[]}:{course,modules:[]},{page:'teaching'});h.run('teaching');await flush();const form=descendants(h.body).find(n=>n.tagName==='form'&&descendants(n).some(child=>child.dataset.pilotText==='newModule'));inputNamed(form,'title').value='New session';const first=form.listeners.submit({preventDefault(){}}),second=form.listeners.submit({preventDefault(){}});
 try{assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(form['aria-busy'],'true');}finally{pending.forEach(resolve=>resolve({status:503,data:{error:'unavailable'}}));await Promise.all([first,second]);}
 assert.equal(form['aria-busy'],'false');assert.equal(inputNamed(form,'title').value,'New session');assert.equal(findKey(form,'newModule').disabled,false);
});
test('a truncated successful feedback response never reports saved or discards the comment',async()=>{
 const h=harness(()=>({status:200,jsonError:new SyntaxError('PRIVATE truncated response')})),box=h.ctx.window.nodalPilot.feedback('course',{courseId:'c1'}),form=descendants(box).find(n=>n.tagName==='form');h.body.append(box);descendants(form).find(n=>n.type==='radio'&&n.value==='3').checked=true;inputNamed(form,'optional').value='Keep my detailed feedback';await form.listeners.submit({preventDefault(){},stopPropagation(){}});assert.doesNotMatch(content(box),/Feedback saved/);assert.doesNotMatch(content(box),/PRIVATE/);assert.equal(inputNamed(form,'optional').value,'Keep my detailed feedback');assert.equal(findKey(form,'sendFeedback').disabled,false);h.lang('pt');assert.match(content(box),/interrompida/);
});
test('background activity authentication failure preserves the current draft instead of forcing navigation',async()=>{
 let finish;const h=harness((path,opts)=>path.endsWith('/events')?new Promise(resolve=>{finish=resolve;}):learningFixture(path,opts),{page:'course',search:'?id=c1'});h.run('courses');await flush();const draft=inputNamed(h.body,'body');draft.value='A thought not yet sent';finish({status:401,data:{error:'sign in required'}});await flush();assert.equal(h.assigned(),'');assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'A thought not yet sent');
});
test('failed refresh after editing intake keeps the visible discussion draft and its refresh handlers alive',async()=>{
 let reads=0;const h=harness((path,opts)=>path==='/api/courses/c1'&&++reads>1?{status:503,data:{error:'unavailable'}}:path.endsWith('/intake')?{intake:{fullName:'Updated Member'}}:learningFixture(path,opts),{page:'course',search:'?id=c1'});const clock=fakeClock(h);h.run('courses');await flush();const draft=inputNamed(h.body,'body');draft.value='Keep my discussion draft';await findKey(h.body,'editIntake').listeners.click();const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,'profession'));await form.listeners.submit({preventDefault(){}});assert.equal(inputNamed(h.body,'body'),draft);assert.equal(draft.value,'Keep my discussion draft');const before=h.requests.filter(r=>r.path.includes('/m1/posts')).length;await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();assert.equal(h.requests.filter(r=>r.path.includes('/m1/posts')).length,before+1);assert.equal(clock.timers.size,1);
});

const ownPost={id:'own',authorName:'Member',createdAt:'2026-09-08T10:00:00Z',kind:'question',body:'Original contribution',links:[{title:'Reading',url:'https://example.test/reading'}],attachments:[{id:'file1',name:'Fieldwork.pdf'}],canEdit:true,canDelete:true};
function postHarness({posts=[{...ownPost}],intercept,isAdmin=false}={}){
 let records=posts;const h=harness(async(path,opts)=>{
  const response=await intercept?.(path,opts,records);if(response!==undefined)return response;
  if(path.startsWith('/api/courses/c1/posts/')){
   const id=path.split('/').at(-1),index=records.findIndex(p=>p.id===id);
   if(opts?.method==='PATCH'){records=records.map(p=>p.id===id?{...p,body:JSON.parse(opts.body).body}:p);return{post:records[index]};}
   if(opts?.method==='DELETE'){records=records.map(p=>p.id===id?{...p,body:'',links:[],attachments:[],deleted:true,canEdit:false,canDelete:false}:p);return{ok:true};}
   return{post:records[index]};
  }
  if(path.includes('/modules/m1/posts'))return{posts:records,nextCursor:null,revision:JSON.stringify(records.map(p=>[p.id,p.body,p.deleted]))};
  const data=learningFixture(path,opts);if(path==='/api/courses/c1')return{...data,isAdmin};return data;
 },{page:'course',search:'?id=c1'});h.ctx.confirm=()=>true;return{...h,records:()=>records,setRecords:value=>{records=value;}};
}
const postCard=(h,id='own')=>descendants(h.body).find(n=>n.id==='post-'+id);
const postEditor=card=>descendants(card).find(n=>n.tagName==='form');
test('post editing and deletion controls follow server ownership flags for questions, assignments and replies',async()=>{
 const records=[{...ownPost},{...ownPost,id:'assignment',kind:'assignment'},{...ownPost,id:'reply',parentId:'own',kind:'comment'},{...ownPost,id:'other',canEdit:false,canDelete:false},{...ownPost,id:'removed',deleted:true,canEdit:false,canDelete:false}];
 const h=postHarness({posts:records,isAdmin:true});h.run('courses');await flush();
 for(const id of ['own','assignment','reply']){assert.equal(findKey(postCard(h,id),'editPost').hidden,false);assert.equal(findKey(postCard(h,id),'deleteOwnPost').hidden,false);assert.equal(findKey(postCard(h,id),'moderate').hidden,true);}
 assert.equal(findKey(postCard(h,'other'),'editPost').hidden,true);assert.equal(findKey(postCard(h,'other'),'deleteOwnPost').hidden,true);assert.equal(findKey(postCard(h,'other'),'moderate').hidden,false);assert.equal(postCard(h,'removed'),undefined);
});
test('owner text edit sends expected saved text only and preserves links, files and the contribution composer',async()=>{
 const h=postHarness();h.run('courses');await flush();const composer=inputNamed(h.body,'body');composer.value='Unsent new discussion';const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card);inputNamed(form,'body').value='Updated contribution';await form.listeners.submit({preventDefault(){}});
 const request=h.requests.find(r=>r.method==='PATCH');assert.equal(request.path,'/api/courses/c1/posts/own');assert.deepEqual(request.body,{body:'Updated contribution',expectedBody:'Original contribution'});assert.match(content(postCard(h)),/Updated contribution/);assert.equal(descendants(postCard(h)).find(n=>n.href==='https://example.test/reading').textContent,'Reading');assert.equal(descendants(postCard(h)).find(n=>n.href==='/api/course-attachments/file1').textContent,'Fieldwork.pdf');assert.equal(inputNamed(h.body,'body'),composer);assert.equal(composer.value,'Unsent new discussion');
});
test('post edit cancel and empty input never write, and failed saves preserve the editable draft',async()=>{
 const h=postHarness({intercept:(path,opts)=>opts?.method==='PATCH'?{status:503,data:{error:'unavailable'}}:undefined});h.run('courses');await flush();const card=postCard(h);findKey(card,'editPost').listeners.click();let form=postEditor(card);inputNamed(form,'body').value='';await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.some(r=>r.method==='PATCH'),false);assert.match(content(card),/Write your contribution/);findKey(form,'cancel').listeners.click();assert.equal(postEditor(card),undefined);
 findKey(card,'editPost').listeners.click();form=postEditor(card);inputNamed(form,'body').value='Preserved edit';await form.listeners.submit({preventDefault(){}});assert.equal(inputNamed(form,'body').value,'Preserved edit');assert.equal(findKey(form,'savePost').disabled,false);assert.equal(form['aria-busy'],'false');
});
test('stale post edits retain the draft, explicitly load the current version, and retry with its expectedBody',async()=>{
 let changes=0;const h=postHarness({intercept:(path,opts)=>{
  if(path==='/api/courses/c1/posts/own'&&opts?.method==='PATCH'&&++changes===1)return{status:409,data:{error:'changed'}};
 }});h.run('courses');await flush();const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card);inputNamed(form,'body').value='My intended edit';await form.listeners.submit({preventDefault(){}});assert.equal(inputNamed(form,'body').value,'My intended edit');assert.equal(findKey(form,'savePost').disabled,true);assert.equal(findKey(form,'refreshPostVersion').hidden,false);
 h.setRecords([{...ownPost,body:'Saved in another window'}]);await findKey(form,'refreshPostVersion').listeners.click();assert.equal(inputNamed(form,'body').value,'My intended edit');assert.match(content(form),/Saved in another window/);assert.equal(findKey(form,'savePost').disabled,false);await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='PATCH').at(-1).body.expectedBody,'Saved in another window');assert.match(content(postCard(h)),/My intended edit/);
});
test('conversation refresh preserves inline editors including an older draft outside the newest page',async()=>{
 const h=postHarness({posts:[{...ownPost},{...ownPost,id:'other-own',body:'Second own post'}]});const clock=fakeClock(h);h.run('courses');await flush();const first=postCard(h),second=postCard(h,'other-own');findKey(first,'editPost').listeners.click();findKey(second,'editPost').listeners.click();const a=inputNamed(postEditor(first),'body'),b=inputNamed(postEditor(second),'body');a.value='First draft';b.value='Second draft';
 h.setRecords([{...ownPost,body:'Changed elsewhere'}]);await clock.tick();assert.equal(inputNamed(postEditor(first),'body'),a);await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();assert.equal(postCard(h),first);assert.equal(postCard(h,'other-own'),second);assert.equal(a.value,'First draft');assert.equal(b.value,'Second draft');assert.equal(findKey(postEditor(first),'savePost').disabled,true);assert.match(content(postEditor(first)),/Changed elsewhere/);
});
test('refresh checks an omitted owner draft for deletion while keeping the unsaved text recoverable',async()=>{
 let removed=false;const deleted={...ownPost,authorName:'',body:'',links:[],attachments:[],deleted:true,canEdit:false,canDelete:false};
 const h=postHarness({intercept:path=>removed?path.includes('/modules/m1/posts')?{posts:[],nextCursor:null,revision:2}:path==='/api/courses/c1/posts/own'?{post:deleted}:undefined:undefined});h.run('courses');await flush();
 const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card),draft=inputNamed(form,'body');draft.value='My recoverable edit';removed=true;
 await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();assert.equal(draft.value,'My recoverable edit');assert.equal(findKey(form,'savePost').disabled,true);assert.doesNotMatch(content(card),/Original contribution|Contribution removed/);assert.match(content(card),/no longer available/);
 findKey(form,'cancel').listeners.click();assert.equal(Boolean(postCard(h)),false);
});
test('canceling an omitted draft during its version check does not restore a removed contribution',async()=>{
 let removed=false,finish;const h=postHarness({intercept:path=>removed?path.includes('/modules/m1/posts')?{posts:[],nextCursor:null}:path==='/api/courses/c1/posts/own'?new Promise(resolve=>{finish=resolve;}):undefined:undefined});h.run('courses');await flush();
 const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card);removed=true;
 const refresh=findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();await flush();findKey(form,'cancel').listeners.click();finish({post:{...ownPost,deleted:true,body:'',canEdit:false,canDelete:false}});await refresh;
 assert.equal(Boolean(postCard(h)),false);assert.ok(findKey(h.body,'noPosts'));
});
test('owner deletion requires confirmation, removes the contribution and preserves other members replies',async()=>{
 const h=postHarness({posts:[{...ownPost},{...ownPost,id:'reply',parentId:'own',kind:'comment',body:'Other member reply',links:[],attachments:[],canEdit:false,canDelete:false}]});h.run('courses');await flush();h.ctx.confirm=()=>false;await findKey(postCard(h),'deleteOwnPost').listeners.click();assert.equal(h.requests.some(r=>r.method==='DELETE'),false);h.ctx.confirm=()=>true;await findKey(postCard(h),'deleteOwnPost').listeners.click();const request=h.requests.find(r=>r.method==='DELETE');assert.equal(request.path,'/api/courses/c1/posts/own');assert.ok(postCard(h,'reply'));assert.equal(postCard(h),undefined);assert.match(content(postCard(h,'reply')),/Other member reply/);assert.equal(Boolean(findKey(postCard(h,'reply'),'reply').hidden),false);assert.match(content(h.body),/Your contribution was deleted/);h.lang('es');assert.doesNotMatch(content(h.body),/Contribución retirada/);
});
test('removed entries from a stale page stay hidden and an empty conversation still loads older surviving replies',async()=>{
 const removed={...ownPost,deleted:true,body:'',links:[],attachments:[],canEdit:false,canDelete:false};
 const h=postHarness({intercept:path=>path.includes('/modules/m1/posts')?path.includes('cursor=older')?{posts:[removed,{...ownPost,id:'reply',parentId:'own',body:'Earlier reply',canEdit:false,canDelete:false}],nextCursor:null}:{posts:[removed],nextCursor:'older'}:undefined});h.run('courses');await flush();
 assert.equal(Boolean(postCard(h)),false);assert.ok(findKey(h.body,'noPosts'));const more=findKey(h.body,'loadOlder');assert.equal(more.hidden,false);await more.listeners.click();assert.equal(Boolean(postCard(h)),false);assert.ok(postCard(h,'reply'));assert.equal(Boolean(findKey(h.body,'noPosts')),false);assert.equal(more.hidden,true);h.lang('es');assert.doesNotMatch(content(h.body),/Contribución retirada/);
});
test('successful owner deletion removes the card even when the following conversation refresh fails',async()=>{
 let deleted=false;const h=postHarness({intercept:(path,opts)=>{if(opts?.method==='DELETE'){deleted=true;return{ok:true};}if(deleted&&path.includes('/modules/m1/posts'))return{status:503,data:{error:'unavailable'}};}});h.run('courses');await flush();await findKey(postCard(h),'deleteOwnPost').listeners.click();assert.equal(postCard(h),undefined);assert.match(content(h.ids.pilotStatus),/Could not complete/);
});
test('successful moderation removes the card even when the following conversation refresh fails',async()=>{
 let deleted=false;const h=postHarness({posts:[{...ownPost,canEdit:false,canDelete:false}],isAdmin:true,intercept:(path,opts)=>{if(opts?.method==='DELETE'){deleted=true;return{ok:true};}if(deleted&&path.includes('/modules/m1/posts'))return{status:503,data:{error:'unavailable'}};}});h.run('courses');await flush();await findKey(postCard(h),'moderate').listeners.click();assert.equal(postCard(h),undefined);
});
test('reply navigation only links to a live parent present in the loaded conversation',async()=>{
 let removed=false;const reply={...ownPost,id:'reply',parentId:'own',kind:'comment',body:'Surviving reply',canEdit:false,canDelete:false};
 const h=postHarness({intercept:(path,opts)=>{
  if(opts?.method==='DELETE'){removed=true;return{ok:true};}
  if(path.includes('/modules/m1/posts'))return{posts:removed?[reply]:path.includes('cursor=older')?[ownPost]:[reply],nextCursor:removed||path.includes('cursor=older')?null:'older'};
 }});h.run('courses');await flush();
 const parentLink=()=>descendants(postCard(h,'reply')).find(node=>node.href==='#post-own');assert.equal(parentLink().hidden,true);
 await findKey(h.body,'loadOlder').listeners.click();assert.equal(parentLink().hidden,false);
 await findKey(postCard(h),'deleteOwnPost').listeners.click();assert.equal(Boolean(postCard(h)),false);assert.equal(parentLink().hidden,true);assert.match(content(postCard(h,'reply')),/Surviving reply/);
});
test('post mutation errors do not force sign-in navigation and pending actions ignore repeat clicks',async()=>{
 let finish;const h=postHarness({intercept:(path,opts)=>opts?.method==='PATCH'?new Promise(resolve=>{finish=resolve;}):undefined});h.run('courses');await flush();const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card);inputNamed(form,'body').value='Keep through expired auth';const first=form.listeners.submit({preventDefault(){}});await form.listeners.submit({preventDefault(){}});await findKey(card,'deleteOwnPost').listeners.click();assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);assert.equal(h.requests.some(r=>r.method==='DELETE'),false);finish({status:401,data:{error:'expired'}});await first;assert.equal(h.assigned(),'');assert.equal(inputNamed(form,'body').value,'Keep through expired auth');assert.equal(findKey(form,'savePost').disabled,false);
});
test('intake deletion clears gated module views immediately, keeps enrollment and requires a new intake',async()=>{
 const h=harness((path,opts)=>path.endsWith('/intake')&&opts?.method==='DELETE'?{ok:true}:learningFixture(path,opts),{page:'course',search:'?id=c1'});h.ctx.confirm=()=>true;const clock=fakeClock(h);h.run('courses');await flush();const reads=h.requests.filter(r=>r.path==='/api/courses/c1').length;await findKey(h.body,'deleteIntake').listeners.click();assert.equal(h.requests.find(r=>r.method==='DELETE').path,'/api/courses/c1/intake');assert.equal(h.ctx.document.getElementById('moduleContent'),undefined);assert.equal(clock.timers.size,0);assert.ok(inputNamed(h.body,'profession'));assert.equal(findKey(h.body,'enroll'),undefined);assert.match(content(h.body),/Your intake responses were deleted/);assert.equal(h.requests.filter(r=>r.path==='/api/courses/c1').length,reads);
});
test('intake deletion cancellation and failures preserve the existing access and permit a retry',async()=>{
 const h=harness((path,opts)=>path.endsWith('/intake')&&opts?.method==='DELETE'?{status:503,data:{error:'unavailable'}}:learningFixture(path,opts),{page:'course',search:'?id=c1'});h.ctx.confirm=()=>false;h.run('courses');await flush();const remove=findKey(h.body,'deleteIntake');await remove.listeners.click();assert.equal(h.requests.some(r=>r.method==='DELETE'),false);h.ctx.confirm=()=>true;await remove.listeners.click();assert.ok(h.ctx.document.getElementById('moduleContent'));assert.equal(remove.disabled,false);assert.equal(findKey(h.body,'editIntake').disabled,false);assert.doesNotMatch(content(h.body),/Your intake responses were deleted/);
});
test('reviewing an owner post removed elsewhere preserves the draft but disables saving and removes published identity and files',async()=>{
 const h=postHarness({intercept:(path,opts)=>opts?.method==='PATCH'?{status:409,data:{error:'changed'}}:undefined});h.run('courses');await flush();const card=postCard(h);findKey(card,'editPost').listeners.click();const form=postEditor(card);inputNamed(form,'body').value='Draft kept for copying';await form.listeners.submit({preventDefault(){}});h.setRecords([{...ownPost,authorName:'',body:'',links:[],attachments:[],deleted:true,canEdit:false,canDelete:false}]);await findKey(form,'refreshPostVersion').listeners.click();assert.equal(inputNamed(form,'body').value,'Draft kept for copying');assert.equal(inputNamed(form,'body').disabled,false);assert.equal(findKey(form,'savePost').disabled,true);assert.equal(findKey(card,'deleteOwnPost').hidden,true);assert.equal(descendants(card).some(n=>n.href==='/api/course-attachments/file1'),false);assert.match(content(card),/no longer available/);assert.doesNotMatch(content(card),/Original contribution/);h.lang('es');assert.doesNotMatch(content(card),/Contribución retirada/);findKey(form,'cancel').listeners.click();assert.equal(Boolean(postCard(h)),false);
});
test('pending owner deletion and intake deletion ignore duplicate requests',async()=>{
 let finishPost;const h=postHarness({intercept:(path,opts)=>opts?.method==='DELETE'?new Promise(resolve=>{finishPost=resolve;}):undefined});h.run('courses');await flush();const remove=findKey(postCard(h),'deleteOwnPost'),first=remove.listeners.click();await remove.listeners.click();assert.equal(h.requests.filter(r=>r.method==='DELETE').length,1);finishPost({status:503,data:{error:'unavailable'}});await first;assert.equal(remove.disabled,false);assert.match(content(postCard(h)),/Original contribution/);
 let finishIntake;const intake=harness((path,opts)=>opts?.method==='DELETE'?new Promise(resolve=>{finishIntake=resolve;}):learningFixture(path,opts),{page:'course',search:'?id=c1'});intake.ctx.confirm=()=>true;intake.run('courses');await flush();const button=findKey(intake.body,'deleteIntake'),pending=button.listeners.click();await button.listeners.click();assert.equal(intake.requests.filter(r=>r.method==='DELETE').length,1);finishIntake({status:503,data:{error:'unavailable'}});await pending;assert.equal(button.disabled,false);assert.ok(intake.ctx.document.getElementById('moduleContent'));
});
test('opening course material preserves new feedback drafts and history edits until they are saved or canceled',async()=>{
 const saved={id:'f1',action:'course',courseId:'c1',moduleId:'m1',rating:3,comment:'Original feedback',createdAt:'2026-09-08T12:00:00Z'};
 const h=harness((path,opts)=>{
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',resources:[{title:'Reading',kind:'reading',url:'https://example.test/reading'}]}};
  if(path==='/api/feedback')return opts?.method==='POST'?{feedback:{...saved,id:'f2'}}:{feedback:[saved],nextCursor:null};
  return learningFixture(path,opts);
 },{page:'course',search:'?id=c1'});h.run('courses');await flush();
 const mount=h.ctx.document.getElementById('courseFeedback'),link=descendants(h.body).find(n=>n.href==='https://example.test/reading');
 const initial=mount.children[0],form=descendants(initial).find(n=>n.tagName==='form');inputNamed(form,'optional').value='Still writing my feedback';
 link.listeners.click();assert.equal(mount.children[0],initial);assert.equal(inputNamed(form,'optional').value,'Still writing my feedback');
 descendants(form).find(n=>n.type==='radio'&&n.value==='4').checked=true;await form.listeners.submit({preventDefault(){},stopPropagation(){}});
 link.listeners.click();assert.notEqual(mount.children[0],initial);
 const box=mount.children[0],history=descendants(box).find(n=>n.className==='pilot-feedback-history');history.open=true;await history.listeners.toggle();
 findKey(history,'editFeedback').listeners.click();const editor=descendants(history).find(n=>n.tagName==='form');inputNamed(editor,'optional').value='An unfinished correction';
 link.listeners.click();assert.equal(mount.children[0],box);assert.equal(inputNamed(editor,'optional').value,'An unfinished correction');
 findKey(editor,'cancel').listeners.click();link.listeners.click();assert.notEqual(mount.children[0],box);
});
test('expired-session refresh keeps owner edits and a new contribution draft on screen',async()=>{
 let expired=false;const h=postHarness({intercept:(path)=>expired&&path.includes('/posts?')?{status:401,data:{error:'expired'}}:undefined});h.run('courses');await flush();
 const composer=inputNamed(h.body,'body');composer.value='Unsent question';const card=postCard(h);findKey(card,'editPost').listeners.click();const draft=inputNamed(postEditor(card),'body');draft.value='My unsaved correction';expired=true;
 await findKey(h.ctx.document.getElementById('module-pane-discussion'),'refreshConversation').listeners.click();
 assert.equal(h.assigned(),'');assert.equal(postCard(h),card);assert.equal(draft.value,'My unsaved correction');assert.equal(composer.value,'Unsent question');assert.match(content(h.ids.pilotStatus),/Sign in/);
});
test('expired-session course actions preserve drafts while initial course authentication still redirects',async()=>{
 for(const action of ['module','contribution','intake','savedIntakeRefresh']){
  let expired=false;const h=harness((path,opts)=>{
   if(path==='/api/courses/c1'&&!expired)return{...learningFixture(path,opts),modules:[{id:'m1',title:'Session'},{id:'m2',title:'Next session'}]};
   if(expired&&action==='savedIntakeRefresh'&&opts?.method==='PUT')return{intake:{fullName:'Updated Member'}};
   if(expired&&!path.endsWith('/events'))return{status:401,data:{error:'expired'}};
   return learningFixture(path,opts);
  },{page:'course',search:'?id=c1'});h.run('courses');await flush();const composer=inputNamed(h.body,'body');composer.value='Draft survives '+action;
  if(action==='intake'||action==='savedIntakeRefresh')await findKey(h.body,'editIntake').listeners.click();
  expired=true;
  if(action==='module')await descendants(h.body).find(n=>n.dataset.module==='m2').listeners.click();
  else {const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,action==='contribution'?'body':'profession'));if(action!=='contribution')inputNamed(form,'expectations').value='My updated expectations';await form.listeners.submit({preventDefault(){}});if(action!=='contribution')assert.equal(inputNamed(form,'expectations').value,'My updated expectations');}
  assert.equal(h.assigned(),'',action);assert.equal(inputNamed(h.body,'body'),composer,action);assert.equal(composer.value,'Draft survives '+action);assert.match(content(h.body),/Sign in/);
 }
 const initial=harness(()=>({status:401,data:{error:'expired'}}),{page:'course',search:'?id=c1&module=m1'});initial.run('courses');await flush();assert.match(initial.assigned(),/^\/login.html\?next=%2Fcourse.html%3Fid%3Dc1%26module%3Dm1$/);
});
