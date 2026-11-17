import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/* The teaching workspace (teaching.js) after the code overview of 16 Nov 2026: the fixes of its staff batch.
   The harness is the courses tests' (tests/course-participants-ui.test.js): a light DOM, pilot-i18n.js and pilot.js run first,
   a stubbed fetch, and a window that keeps its listeners, as the page runs. */
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
 click(){return this.listeners.click?.({type:'click'});}
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='input,textarea,select,button'?['input','textarea','select','button'].includes(n.tagName):selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector==='#staffCourses button'?n.tagName==='button'&&n.parent?.id==='staffCourses':selector==='[data-reload]'?n.dataset.reload:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){this.focused=true;}
 checkValidity(){return this.type!=='email'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);}
 reportValidity(){this.reported=true;return this.checkValidity();}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
// respond(path, options) answers each request: {status, data} or the data alone.
function harness(respond,{search=''}={}){
 const body=new Node('body');body.dataset.page='teaching';const html=new Node('html');const ids={};
 for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[],windowEvents={};
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,AbortSignal,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},
  location:{pathname:'/teaching.html',search,href:'https://nodal.test/teaching.html'+search,assign(){},replace(){}},confirm:()=>true,
  fetch:async(path,opts)=>{requests.push({path,method:opts?.method||'GET',body:opts?.body?JSON.parse(opts.body):undefined});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},
  window:{addEventListener(k,f){windowEvents[k]=f;},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 vm.runInContext(script('teaching'),ctx);
 const leaveAsks=()=>{let asked=false;windowEvents.beforeunload?.({preventDefault(){asked=true;}});return asked;};
 return{ctx,body,ids,requests,windowEvents,leaveAsks,status:()=>ids.pilotStatus.textContent,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}
const course={id:'c1',title:'Mobility course',description:'Course',status:'published',version:1,enrollmentOpen:true};
const report=(patch={})=>({summary:{enrolled:0},participants:[],feedback:[],invitations:[],...patch});
// The usual answers for one course; over(path, options) can take any request first.
const routes=(over=()=>undefined)=>async(path,opts)=>{
 const own=await over(path,opts);if(own!==undefined)return own;
 if(path==='/api/admin/courses')return{courses:[course]};
 if(path.endsWith('/report'))return report();
 return{course,modules:[]};
};
const byName=(node,name)=>descendants(node).find(n=>n.name===name);
const findKey=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);

test('M61/M141: the workspace tells the staff bar about unsaved editors, and once signed out its leave prompt asks nothing more',async()=>{
 const h=harness(routes(),{search:'?course=c1&tab=courseSetup'});await flush();
 assert.equal(h.ctx.window.nodalUnsaved(),false,'a course just opened has nothing unsaved');
 assert.equal(h.leaveAsks(),false);
 const form=descendants(h.body).find(n=>n.tagName==='form'&&byName(n,'description'));
 const description=byName(form,'description');description.value='A description not saved yet';form.listeners.input({target:description});
 assert.equal(h.ctx.window.nodalUnsaved(),true);
 assert.equal(h.leaveAsks(),true,'leaving still asks');
 h.ctx.window.nodalSignedOut=true;
 assert.equal(h.leaveAsks(),false,'signed out from the staff bar: the session is closed, so the page does not ask a second time');
});

test('M59: a course that cannot be read on opening keeps its error on the status line, and New course clears the line itself',async()=>{
 const h=harness(routes(path=>path.endsWith('/report')?{status:503,data:{error:'unavailable'}}:undefined),{search:'?course=c1&tab=participants'});await flush();
 assert.equal(h.status(),'Could not complete this request.','the reason stays next to the empty workspace');
 assert.equal(h.ctx.document.getElementById('staff-pane-participants'),undefined);
 findKey(h.body,'newCourse').click();
 assert.equal(h.status(),'','New course replaces the workspace and clears the line');
 // Pressed while the first course is still loading: nothing stays on "Loading…".
 let release;const slow=harness(routes(path=>path.endsWith('/report')?new Promise(resolve=>{release=resolve;}):undefined));await flush();
 assert.equal(slow.status(),'Loading…');
 findKey(slow.body,'newCourse').click();
 assert.equal(slow.status(),'');
 release(report());await flush();
 assert.equal(slow.status(),'');
 assert.ok(descendants(slow.body).some(n=>n.tagName==='form'),'the late course does not replace the New course form');
 assert.equal(slow.ctx.document.getElementById('staff-pane-responses'),undefined);
 // No course yet: the New course form opens with nothing on the line.
 const empty=harness(routes(path=>path==='/api/admin/courses'?{courses:[]}:undefined));await flush();
 assert.equal(empty.status(),'');assert.ok(descendants(empty.body).some(n=>n.tagName==='form'));
});

test('M62: a created course whose list cannot be read again still reads as saved, joins the list and opens on Course setup',async()=>{
 const created={id:'c9',title:'Curso nuevo',description:'',status:'draft',version:1,enrollmentOpen:true,translations:{}};let listReads=0;
 const h=harness(routes((path,opts)=>{
  if(path==='/api/admin/courses'&&opts?.method==='POST')return{status:201,data:{course:created}};
  if(path==='/api/admin/courses'){listReads++;return listReads===1?{courses:[]}:{status:503,data:{error:'unavailable'}};}
  if(path==='/api/courses/c9')return{course:created,modules:[]};
  return undefined;
 }));await flush();
 const form=descendants(h.body).find(n=>n.tagName==='form'),title=byName(form,'title');
 title.value='Curso nuevo';form.listeners.input({target:title});
 await form.listeners.submit({preventDefault(){}});await flush();
 assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(listReads,2,'the list was asked for again');
 assert.deepEqual(descendants(h.ctx.document.getElementById('staffCourses')).filter(n=>n.tagName==='button').map(n=>n.dataset.course),['c9'],'the new course is on the list');
 assert.equal(h.ctx.document.getElementById('staff-pane-courseSetup')?.hidden,false,'and open on Course setup');
 assert.doesNotMatch(content(h.body),/Could not complete this request/);
 assert.equal(h.ctx.window.nodalUnsaved(),false,'nothing left unsaved');
});

test('M65: a participant list cut at 500 says so and points to the CSV; a whole list, or one where only feedback passed 500, does not',async()=>{
 const people=n=>Array.from({length:n},(_,i)=>({userId:'u'+i,name:'Person '+i,email:'p'+i+'@example.test',enrolledAt:'2026-09-01T00:00:00Z',intake:null}));
 const english='Preview is limited to 500 records. Export CSV for the complete data.',spanish='La vista se limita a 500 registros. Exporta CSV para obtener todos los datos.';
 for(const [data,shown,label] of [[report({summary:{enrolled:501},participants:people(500),truncated:true}),true,'cut at 500'],[report({summary:{enrolled:3},participants:people(3)}),false,'whole'],[report({summary:{enrolled:3},participants:people(3),truncated:true}),false,'only feedback passed 500']]){
  const h=harness(routes(path=>path.endsWith('/report')?data:undefined),{search:'?course=c1&tab=participants'});await flush();
  const pane=()=>h.ctx.document.getElementById('staff-pane-participants');
  assert.equal(content(pane()).includes(english),shown,label);
  if(!shown)continue;
  assert.ok(descendants(pane()).some(n=>n.href==='/api/admin/courses/c1/export?type=participants'),'the CSV with every participant is in the same pane');
  h.lang('es');assert.ok(content(pane()).includes(spanish));
 }
});
