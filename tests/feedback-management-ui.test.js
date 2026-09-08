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
 const ctx={confirm:()=>true,document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign:s=>{assigned=s;},replace:s=>{assigned=s;}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method,signal:opts?.signal});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>{if(result.jsonError)throw result.jsonError;return result.data??result;}};},window:{addEventListener(k,f){windowEvents[k]=f;},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,documentEvents,windowEvents,run:name=>vm.runInContext(script(name),ctx),assigned:()=>assigned,lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}

const key=(node,name)=>descendants(node).find(n=>n.dataset.pilotText===name);
const input=(node,name)=>descendants(node).find(n=>n.name===name);
const response={id:'f1',action:'assignment',courseId:'c1',moduleId:'m1',rating:2,comment:'Original feedback',createdAt:'2026-09-07T12:00:00Z'};
async function openHistory(h,box){const history=descendants(box).find(n=>n.tagName==='details'&&key(n,'myFeedback'));assert.ok(history,'saved feedback must remain discoverable after reload');history.open=true;await history.listeners.toggle();return history;}
test('saved feedback can be loaded after reload, edited and deleted without a duplicate response',async()=>{
 let saved={...response};const h=harness((path,options)=>options?.method==='PATCH'?{feedback:(saved={...saved,...JSON.parse(options.body)})}:options?.method==='DELETE'?(saved=null,{ok:true}):{feedback:saved?[saved]:[],nextCursor:null});
 const box=h.ctx.window.nodalPilot.feedback('course',{courseId:'c1'});h.body.append(box);assert.equal(h.requests.length,0,'history must not add startup requests');const history=await openHistory(h,box);assert.match(content(history),/Original feedback/);
 await key(history,'editFeedback').listeners.click();const form=descendants(history).find(n=>n.tagName==='form');input(form,'optional').value='Edited feedback';descendants(form).filter(n=>n.type==='radio').forEach(n=>{n.checked=n.value==='5';});await form.listeners.submit({preventDefault(){},stopPropagation(){}});
 assert.equal(saved.comment,'Edited feedback');assert.equal(saved.rating,5);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);assert.match(content(history),/Edited feedback/);assert.doesNotMatch(content(history),/Original feedback/);
 await key(history,'deleteFeedback').listeners.click();assert.equal(saved,null);assert.doesNotMatch(content(history),/Edited feedback/);assert.match(content(history),/No saved feedback/);
});
test('failed feedback editing preserves its draft and cancels safely without a write',async()=>{
 const h=harness((path,options)=>options?.method==='PATCH'?{status:503,data:{error:'unavailable'}}:{feedback:[response],nextCursor:null});const box=h.ctx.window.nodalPilot.feedback('course');h.body.append(box);const history=await openHistory(h,box);await key(history,'editFeedback').listeners.click();const form=descendants(history).find(n=>n.tagName==='form');input(form,'optional').value='Keep this draft';await form.listeners.submit({preventDefault(){},stopPropagation(){}});
 assert.equal(input(form,'optional').value,'Keep this draft');assert.equal(key(form,'saveFeedback').disabled,false);assert.doesNotMatch(content(form),/Feedback saved/);await key(form,'cancel').listeners.click();assert.match(content(history),/Original feedback/);assert.equal(h.requests.filter(r=>r.method==='PATCH').length,1);h.lang('pt');assert.match(content(history),/Editar/);
});
test('feedback history paginates on demand without losing an open edit draft',async()=>{
 const h=harness(path=>path.includes('cursor=')?{feedback:[{...response,id:'f2',comment:'Older response'}],nextCursor:null}:{feedback:[response],nextCursor:'next-page'});const box=h.ctx.window.nodalPilot.feedback('course');h.body.append(box);const history=await openHistory(h,box);await key(history,'editFeedback').listeners.click();const form=descendants(history).find(n=>n.tagName==='form');input(form,'optional').value='Unsaved edit';await key(history,'moreFeedback').listeners.click();assert.equal(input(form,'optional').value,'Unsaved edit');assert.ok(descendants(history).includes(form));assert.match(content(history),/Older response/);assert.match(h.requests.at(-1).path,/cursor=next-page/);
});
