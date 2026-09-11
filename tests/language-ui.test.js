import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script=name=>readFileSync(new URL(`../web/scripts/${name}.js`,import.meta.url),'utf8');
class Node {
 constructor(tag='div'){this.tagName=tag;this.dataset={};this.children=[];this.listeners={};this.attributes={};this.classList={toggle(){},contains:()=>false};this.hidden=false;this.value='';this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
 append(...nodes){for(const node of nodes){if(typeof node==='object')node.parent=this;this.children.push(node);}}
 appendChild(node){this.append(node);return node;}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 replaceWith(node){const i=this.parent.children.indexOf(this);node.parent=this.parent;this.parent.children.splice(i,1,node);}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(name,fn){this.listeners[name]=fn;}
 matches(selector){return selector[0]==='.'?this.className?.split(' ').includes(selector.slice(1)):selector[0]==='['?this.dataset[selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]!==undefined:selector==='input:checked'?this.tagName==='input'&&this.checked:this.tagName===selector;}
 querySelectorAll(selector){return this.children.flatMap(child=>typeof child==='object'?[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]:[]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness({url='https://nodal.test/profile.html',saved='en',nodes=[],respond=()=>({user:{fullName:'Member'}}),storage=new Map([['nodal.lang',saved]])}={}){
 const body=new Node('body');body.append(...nodes);const location=new URL(url),requests=[],errors=[],historyCalls=[];
 const document={body,documentElement:{},addEventListener(){},querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s),getElementById:id=>find(body,node=>node.id===id),createElement:tag=>new Node(tag)};
 const history={state:{keep:'navigation state'},replaceState(state,unused,next){historyCalls.push({state,next});location.href=new URL(next,location).href;}};
 const context={document,URL,URLSearchParams,location,history,console:{error:(...args)=>errors.push(args)},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setTimeout(){},fetch:async path=>{requests.push(path);const data=await respond(path);return{ok:data.status===undefined||data.status<400,status:data.status||200,json:async()=>data};}};
 context.window={location,history,addEventListener(){}};vm.createContext(context);vm.runInContext(script('i18n'),context);
 return{context,body,document,storage,location,requests,errors,historyCalls,api:context.window.nodalI18n,run:name=>vm.runInContext(script(name),context)};
}
function find(node,predicate){if(predicate(node))return node;for(const child of node.children||[]){if(typeof child!=='object')continue;const found=find(child,predicate);if(found)return found;}return null;}
function node(id,key,text){const n=new Node();n.id=id;if(key)n.dataset.i18n=key;if(text)n.textContent=text;return n;}

test('choosing a locale updates an explicit URL override and survives reload without losing navigation state',()=>{
 const h=harness({url:'https://nodal.test/login.html?lang=pt&next=%2Fcourse.html%3Fid%3Dc1#signin',saved:'en'});assert.equal(h.api.lang,'pt');h.api.apply('es');
 assert.equal(h.location.searchParams.get('lang'),'es');assert.equal(h.location.searchParams.get('next'),'/course.html?id=c1');assert.equal(h.location.hash,'#signin');assert.equal(h.storage.get('nodal.lang'),'es');assert.equal(h.historyCalls.at(-1).state.keep,'navigation state');
 assert.equal(harness({url:h.location.href,storage:h.storage}).api.lang,'es');
});
test('invalid and inherited URL locale names never override a supported saved preference',()=>{
 for(const lang of ['fr','constructor','__proto__',''])assert.equal(harness({url:'https://nodal.test/course.html?lang='+lang,saved:'pt'}).api.lang,'pt',lang);
 const h=harness({saved:'es'});h.api.apply('pt');assert.equal(h.location.searchParams.has('lang'),false);
});
test('reselecting the current locale leaves stateful labels alone and scoped refresh translates inserted navigation',()=>{
 const button=node('submit','a.signinBtn','Sign in'),h=harness({nodes:[button],saved:'pt'});let notifications=0;h.api.onChange(()=>notifications++);button.textContent='Entrando…';h.api.apply('pt');
 assert.equal(notifications,0);assert.equal(button.textContent,'Entrando…');h.storage.set('nodal.lang','es');h.api.apply('pt');assert.equal(h.storage.get('nodal.lang'),'pt');assert.equal(notifications,0);
 const link=node('join','nav.panel','My console');h.body.append(link);h.api.refresh(link);assert.equal(link.textContent,'Meu painel');assert.equal(notifications,0);assert.equal(button.textContent,'Entrando…');
});
test('authenticated navigation translates its new label without triggering whole-page language subscribers',async()=>{
 const nav=node('navbar'),toggle=node('navToggle'),link=node('join','nav.join','Join NODAL');nav.className='navbar';link.tagName='a';nav.append(link);
 const query=nav.querySelector.bind(nav);nav.querySelector=selector=>selector==='[data-i18n="nav.join"]'?link:query(selector);
 const h=harness({nodes:[nav,toggle],saved:'pt',respond:()=>({authenticated:true})});let calls=0;h.api.onChange(()=>calls++);h.run('nav');await flush();assert.equal(link.textContent,'Meu painel');assert.equal(calls,0);assert.deepEqual(h.requests,['/api/auth/state']);
});
test('one failing locale subscriber cannot prevent other views updating',async()=>{
 const h=harness();let translated=false;h.api.onChange(()=>{throw new Error('broken view');});h.api.onChange(()=>Promise.reject(new Error('async broken view')));h.api.onChange(()=>{translated=true;});
 assert.doesNotThrow(()=>h.api.apply('pt'));await flush();assert.equal(translated,true);assert.equal(h.api.lang,'pt');assert.equal(h.errors.length,2);
});

function profileHarness(options={}){
 const ids=['pfName','pfKicker','pfRole','pfCoord','pfInitial','pfTags','pfMeta','pfLinkedin','pfLinkedinText','pfMatch','pfBtns','pfAbout','pfQuote','pfProjects','pfActConn','pfActProj','pfActCourses','pfActSince','pfConnList'];
 const nodes=ids.map(id=>node(id)),signals=node('signals');signals.className='pf-locked';nodes.push(signals,node('title','p.title','NODAL member profile'));
 const user={id:'member',fullName:'Ana Silva',title:'Planner',city:'Lima',topics:[{name:'Mobility',level:2}],partC:{},createdAt:'2026-01-01T00:00:00Z'};
 return harness({nodes,respond:path=>path==='/api/users'?{users:[{id:'other',name:'Other member',role:'Architect'}]}:{user},...options});
}
test('profile dynamic labels and signals follow language changes without reloading data or replacing user content',async()=>{
 const h=profileHarness();h.run('profile');await flush();const about=h.document.getElementById('pfAbout'),tags=h.document.getElementById('pfTags');assert.match(about.textContent,/No bio yet/);assert.equal(tags.textContent,'Mobility');
 h.api.apply('pt');assert.match(about.textContent,/Ainda sem bio/);assert.equal(tags.textContent,'Mobilidade');assert.match(h.document.getElementById('pfBtns').textContent,/Copiar/);assert.match(h.body.textContent,/Disponibilidade/);assert.equal(h.document.getElementById('pfName').textContent,'Ana Silva');assert.deepEqual(h.requests,['/api/auth/me','/api/users']);
 h.api.apply('es');assert.match(about.textContent,/Aún sin bio/);assert.equal(tags.textContent,'Movilidad');assert.match(h.body.textContent,/Disponibilidad/);assert.deepEqual(h.requests,['/api/auth/me','/api/users']);
});
test('profile failure messages follow the chosen language without retrying the failed request',async()=>{
 const h=profileHarness({respond:()=>({status:404,error:'missing'})});h.run('profile');await flush();const initial=h.document.getElementById('pfRole').textContent;h.api.apply('pt');assert.notEqual(h.document.getElementById('pfRole').textContent,initial);assert.equal(h.document.getElementById('pfRole').textContent,h.api.t('p.notFoundWhy'));assert.equal(h.requests.length,1);
});

test('an open dashboard profile dialog translates its labels while preserving typed fields and checked topics',async()=>{
 const ids=['userDialog','userForm','userBtn','ucName','ucCity','ucCityOptions','ucRole','ucTopics','ucError','ucTitle','ucSub','ucSubmit'];
 const nodes=ids.map(id=>node(id)),dialog=nodes[0];dialog.showModal=()=>{dialog.open=true;};
 const h=harness({url:'https://nodal.test/dashboard.html',nodes,respond:()=>({user:{id:'member',fullName:'Ana',title:'Planner',city:'Lima',topics:[{name:'Mobility',level:2}],partC:{}}})});h.run('dashboard');await flush();h.document.getElementById('userBtn').listeners.click();
 const name=h.document.getElementById('ucName'),city=h.document.getElementById('ucCity'),topics=h.document.getElementById('ucTopics');name.value='Unsaved name';city.value='Unsent city';const topic=topics.children[1].children[0];topic.checked=true;
 h.api.apply('pt');assert.equal(h.document.getElementById('ucTitle').textContent,'Edite seu perfil');assert.equal(h.document.getElementById('ucSubmit').textContent,h.api.t('d.uc.submitSave'));assert.equal(name.value,'Unsaved name');assert.equal(city.value,'Unsent city');assert.equal(topic.checked,true);assert.equal(topics.children[1].children[0],topic);assert.equal(dialog.open,true);assert.deepEqual(h.requests,['/api/auth/me']);
});

test('a previous-language catalog response cannot paint during the new-language debounce',async()=>{
 const input=node('searchInput'),pop=node('searchPop'),chips=node('searchChips'),chip=node('chip');chip.dataset.scope='Projects';chip.className='chip is-on';chips.append(chip);chips.querySelector=()=>chip;input.value='metro';
 const replies=[];const h=harness({url:'https://nodal.test/dashboard.html',nodes:[input,pop,chips],respond:path=>path.startsWith('/api/catalog')?new Promise(resolve=>replies.push(resolve)):{user:{id:'member',fullName:'Ana',title:'Planner',city:'Lima',topics:[],partC:{}}}});
 let timerId=0;const timers=new Map();h.context.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};h.context.clearTimeout=id=>timers.delete(id);h.context.AbortController=AbortController;
 const fireTimer=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);return fn();};h.run('dashboard');await flush();input.listeners.input();const old=fireTimer();await flush();h.api.apply('pt');
 replies[0]({items:[{id:'project',title:'English project title',kind:'project'}]});await old;assert.doesNotMatch(pop.textContent,/English project title/);assert.equal(input.value,'metro');
 const current=fireTimer();await flush();replies[1]({items:[{id:'project',title:'Projeto em português',kind:'project'}]});await current;assert.match(pop.textContent,/Projeto em português/);assert.equal(h.requests.filter(path=>path.startsWith('/api/catalog')).length,2);
});
