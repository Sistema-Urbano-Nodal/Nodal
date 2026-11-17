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
