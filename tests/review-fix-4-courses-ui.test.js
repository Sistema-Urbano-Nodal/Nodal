import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// A minimal DOM for web/scripts/courses.js, after the harness in tests/courses-ui.test.js.
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
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){}
 reset(){descendants(this).filter(n=>n.tagName==='input'||n.tagName==='textarea').forEach(n=>{n.value='';n.files=[];});}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
const inputNamed=(node,name)=>descendants(node).find(n=>n.name===name);
function harness(respond,search){
 const body=new Node('body');body.dataset.page='course';const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],urls=[];let uuid=0;
 const document={body,documentElement:new Node('html'),readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,Object,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`},history:{replaceState(_,__,url){urls.push(String(url));}},
  location:{pathname:'/course.html',search,href:'https://nodal.test/course.html'+search,assign(){},replace(){}},
  fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},
  window:{addEventListener(){},nodalI18n:{lang:'en',onChange(){}}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot','courses'])vm.runInContext(script(file),ctx);
 return {ctx,body,requests,urls};
}
const course={id:'c1',title:'Course',description:'',startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true};
const fixture=(posted=()=>({post:{id:'saved'}}))=>(path,opts)=>{
 if(path.endsWith('/events'))return{ok:true};
 if(path.includes('/posts'))return opts?.method==='POST'?posted(JSON.parse(opts.body)):{posts:[],nextCursor:null,revision:'r1'};
 if(path.endsWith('/modules/m1'))return{module:{id:'m1',kind:'session',title:'Session',resources:[]}};
 return{course,modules:[{id:'m1',kind:'session',title:'Session'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
};

// frontend-xss-5: ?view= was looked up with panes[requested], so inherited names (constructor, toString, __proto__)
// passed the check, hid every pane and took every tab out of the tab order.
test('a ?view= naming an inherited property opens the discussion like any unknown view',async()=>{
 for(const view of ['constructor','toString','__proto__','hasOwnProperty','valueOf']){
  const h=harness(fixture(),'?id=c1&view='+view);await flush();
  const pane=key=>h.ctx.document.getElementById('module-pane-'+key),tab=key=>h.ctx.document.getElementById('module-tab-'+key);
  assert.equal(pane('discussion').hidden,false,view);assert.equal(tab('discussion')['aria-selected'],'true',view);assert.equal(tab('discussion').tabIndex,0,view);
  for(const key of ['materials','assignment']){assert.equal(pane(key).hidden,true,view);assert.equal(tab(key).tabIndex,-1,view);}
  assert.match(h.urls.at(-1),/[?&]view=discussion(?:&|$)/,view);
 }
 const known=harness(fixture(),'?id=c1&view=materials');await flush();
 assert.equal(known.ctx.document.getElementById('module-pane-materials').hidden,false,'a real view still opens');
});

// courses-10: after a post whose response was lost, an edited resend under the same clientId is refused with
// alreadySubmitted; the composer kept that id, so every later submit was refused too until a page reload.
test('an edited resend refused as already submitted gets a fresh clientId, so the next submit posts the edited text',async()=>{
 const used=new Map();
 const h=harness(fixture(input=>{
  const previous=used.get(input.clientId);
  if(previous&&previous!==input.body)return{status:409,data:{error:'post identifier is already used'}};
  used.set(input.clientId,input.body);return{post:{id:'p-'+used.size}};
 }),'?id=c1&view=discussion');await flush();
 const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,'body')),body=inputNamed(form,'body');
 const posts=()=>h.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/posts'));
 // The server stored the first attempt, but the participant never saw the answer and edited the text.
 used.set('00000000-0000-4000-8000-000000000001','First wording');
 body.value='Edited wording';await form.listeners.submit({preventDefault(){}});
 assert.equal(posts().at(-1).body.clientId,'00000000-0000-4000-8000-000000000001');
 assert.match(content(form),/already exists/);assert.equal(body.value,'Edited wording','the draft is kept');
 await form.listeners.submit({preventDefault(){}});
 const retry=posts().at(-1).body;assert.notEqual(retry.clientId,'00000000-0000-4000-8000-000000000001','a fresh id');assert.equal(retry.body,'Edited wording');
 assert.match(content(form),/Saved/);assert.equal(body.value,'','the edited contribution was posted');
});

test('an unchanged resend keeps its clientId, so a lost response never posts twice',async()=>{
 let attempts=0;
 const h=harness(fixture(()=>++attempts===1?{status:503,data:{error:'unavailable'}}:{post:{id:'p1'}}),'?id=c1&view=discussion');await flush();
 const form=descendants(h.body).find(n=>n.tagName==='form'&&inputNamed(n,'body'));inputNamed(form,'body').value='Same wording';
 await form.listeners.submit({preventDefault(){}});await form.listeners.submit({preventDefault(){}});
 const ids=h.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/posts')).map(r=>r.body.clientId);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
