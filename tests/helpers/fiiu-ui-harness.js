import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../../web/scripts/'+name+'.js',import.meta.url),'utf8');
export const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
export class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.classList={toggle(){}};}
 append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(child=>child!==node);node.parent=this;this.children.push(node);}}
 prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(node=>!nodes.includes(node))];}
 replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
 replaceWith(node){const parent=this.parent;if(parent){node.parent=parent;parent.children.splice(parent.children.indexOf(this),1,node);this.parent=null;}}
 setAttribute(key,value){this[key]=value;}
 getAttribute(key){return this[key]??null;}
 removeAttribute(key){delete this[key];}
 addEventListener(key,listener){this.listeners[key]=listener;}
 querySelectorAll(selector){return descendants(this).filter(node=>selector.split(',').some(part=>part.startsWith('.')?node.className?.split(' ').includes(part.slice(1)):part==='[data-fiiu-text]'?node.dataset.fiiuText:part==='[data-fiiu-date]'?node.dataset.fiiuDate:node.tagName===part));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 get elements(){return Object.fromEntries(descendants(this).filter(node=>node.name).map(node=>[node.name,node]));}
 focus(){this.focused=true;}
 setCustomValidity(message){this.validationMessage=message;}
 reportValidity(){return [this,...descendants(this)].filter(node=>!node.disabled).every(node=>!node.validationMessage&&(!node.required||(node.type==='checkbox'?node.checked:Boolean(node.value))));}
 scrollIntoView(){}
}
class FormData {
 constructor(form){this.values=descendants(form).filter(node=>['input','select','textarea'].includes(node.tagName)&&node.name&&!node.disabled&&(node.type!=='checkbox'||node.checked)).map(node=>[node.name,node.value]);}
 [Symbol.iterator](){return this.values[Symbol.iterator]();}
 get(name){return this.values.find(([key])=>key===name)?.[1]??null;}
 getAll(name){return this.values.filter(([key])=>key===name).map(([,value])=>value);}
}
export const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
export const key=(node,name)=>descendants(node).find(child=>child.dataset.fiiuText===name);
export const field=(node,name)=>descendants(node).find(child=>child.name===name);
export const content=node=>[node.textContent,...node.children.map(content)].join(' ');
export async function createFiiuHarness(respond,{page='fiiu'}={}){
 const body=new Node('body'),root=new Node(),message=new Node(),requests=[],languageListeners=[],timers=[];body.append(root,message);let reloads=0;
 const document={body,visibilityState:'visible',documentElement:{lang:'en'},getElementById:id=>['fiiuRoot','fiiuAdminRoot'].includes(id)?root:message,createElement:tag=>new Node(tag),createTextNode:value=>Object.assign(new Node('text'),{textContent:value}),querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector)};
 const ctx={document,FormData,Intl,Date,Error,AbortSignal,setInterval:(callback,delay)=>timers.push({callback,delay}),location:{hash:'',reload(){reloads++;}},window:{confirm:()=>true,nodalI18n:{lang:'en',onChange:listener=>languageListeners.push(listener)}},fetch:async(path,options)=>{
  const request={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined};requests.push(request);const result=await respond(request);
  return{ok:!result.status||result.status<400,status:result.status||200,json:async()=>result.data??result};
 }};
 vm.createContext(ctx);for(const name of ['fiiu-ui',page])vm.runInContext(source(name),ctx);await flush();
 return{body,root,message,requests,ctx,timers,tickTimers:()=>Promise.all(timers.map(timer=>timer.callback())),visible:value=>{document.visibilityState=value?'visible':'hidden';},reloads:()=>reloads,lang:lang=>{ctx.window.nodalI18n.lang=lang;languageListeners.forEach(listener=>listener());}};
}
