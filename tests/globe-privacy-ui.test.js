import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

class Element {
  constructor() { this.children=[];this.listeners={};this.dataset={};this.style={};this.hidden=false;this.textContent='';this.value='';this.classList={add(){},remove(){}}; }
  append(...nodes) { for(const node of nodes){node.parent=this;this.children.push(node);} }
  appendChild(node) { this.append(node);return node; }
  prepend(node) { node.parent=this;this.children.unshift(node); }
  replaceChildren(...nodes) { this.children.forEach(node=>{node.parent=null;});this.children=[];this.append(...nodes); }
  remove() { if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this); }
  get lastElementChild() { return this.children.at(-1); }
  removeAttribute(name) { if(name==='hidden')this.hidden=false;else delete this[name]; }
  addEventListener(type,listener) { this.listeners[type]=listener; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
  getBoundingClientRect() { return {left:0,top:0,width:500,height:500}; }
}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const content=node=>[node.textContent,...node.children.map(content)].join(' ');
const member=(id,name,role='Researcher')=>({id,name,role,linkedin:'',joinedAt:'2026-09-01T00:00:00Z'});
const city=(name,people)=>({city:name,label:name,lat:20,lon:-70,members:people.length,named:people.length,people});
const snapshot=(places)=>({places,links:[],topics:[{name:'Mobility',members:places.reduce((n,p)=>n+p.members,0)}],you:{listed:true,hasCity:true,onMap:false,city:'Private hometown'}});
const reply=(data,status=200)=>({status,ok:status>=200&&status<300,headers:{get:()=>`snapshot-${status}`},json:async()=>data});

function harness(initial) {
  const ids=Object.fromEntries(['globeCanvas','globeCard','globeCity','globeLabel','globeCount','globePeople','globeLinks','globeEyebrow','globeYou','globeYouCta','globeEmpty','globeFeed','globeFeedLabel','globeTopics','globeSince','globeSinceLabel','globePlay'].map(id=>[id,new Element()]));
  const requests=[],timers=new Map(),intervals=new Map(),windowEvents={},documentEvents={},draws=[];let timerId=0,frame;
  let respond=()=>reply(initial);
  const drawing=new Proxy({createRadialGradient:()=>({addColorStop(){}})}, {get(target,key){return target[key]??((...args)=>draws.push({kind:key,args}));}});
  ids.globeCanvas.getContext=()=>drawing;
  const window={devicePixelRatio:1,matchMedia:()=>({matches:true}),addEventListener(type,listener){windowEvents[type]=listener;},nodalI18n:{lang:'en',t:(key,vars)=>key+JSON.stringify(vars||{}),onChange(){}}};
  const document={hidden:false,getElementById:id=>ids[id]||null,createElement:()=>new Element(),addEventListener(type,listener){documentEvents[type]=listener;}};
  const context=vm.createContext({window,document,console,Event,AbortSignal,performance:{now:()=>1000},IntersectionObserver:class{observe(){}},
    requestAnimationFrame:callback=>{frame=callback;},setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:callback=>{const id=++timerId;intervals.set(id,callback);return id;},clearInterval:id=>intervals.delete(id),
    fetch:async(path,options)=>{requests.push({path,headers:options.headers});return respond(path,options);},
  });
  for(const file of ['globe-geo','globe'])vm.runInContext(readFileSync(new URL(`../web/scripts/${file}.js`,import.meta.url),'utf8'),context);
  return {ids,requests,timers,intervals,draws,respond:fn=>{respond=fn;},refresh:()=>documentEvents.visibilitychange(),draw:()=>frame(1000),
    key:()=>ids.globeCanvas.dispatchEvent({type:'keydown',key:'ArrowRight',preventDefault(){}}),
  };
}

test('authoritative snapshots remove a hidden member from arrival feed even when another member shares the name',async()=>{
  const ana=member('ana','Ana'),bob=member('bob','Shared name'),other=member('other','Shared name');
  const h=harness(snapshot([city('Boston',[ana,other])]));await flush();
  h.respond(()=>reply(snapshot([city('Boston',[ana,other,bob])])));h.refresh();await flush();
  assert.match(content(h.ids.globeFeed),/Shared name/);
  h.respond(()=>reply(snapshot([city('Boston',[ana,other])])));h.refresh();await flush();
  assert.equal(h.ids.globeFeed.children.length,0,'the remaining namesake cannot keep the hidden person in the feed');
  assert.equal(h.ids.globeFeed.hidden,true);assert.equal(h.ids.globeFeedLabel.hidden,true);
});

test('arrival feed refreshes the current name and role of a still-visible member',async()=>{
  const ana=member('ana','Ana'),bob=member('bob','Old name','Old role');
  const h=harness(snapshot([city('Boston',[ana])]));await flush();
  h.respond(()=>reply(snapshot([city('Boston',[ana,bob])])));h.refresh();await flush();
  h.respond(()=>reply(snapshot([city('Boston',[ana,member('bob','Current name','Current role')])])));h.refresh();await flush();
  assert.doesNotMatch(content(h.ids.globeFeed),/Old name|Old role/);
  assert.match(content(h.ids.globeFeed),/Current name/);assert.equal(h.ids.globeFeed.children.length,1);
});

test('selection follows its city across snapshot reordering and clears when that city disappears',async()=>{
  const a=city('Boston',[member('a','Ana')]),b=city('Cambridge',[member('b','Ben')]);
  const h=harness(snapshot([a,b]));await flush();h.key();h.key();assert.equal(h.ids.globeCity.textContent,'Cambridge');
  h.respond(()=>reply(snapshot([b,a])));h.refresh();await flush();
  assert.equal(h.ids.globeCity.textContent,'Cambridge','selection must track city identity, not the previous index');
  h.respond(()=>reply(snapshot([a])));h.refresh();await flush();
  assert.equal(h.ids.globeCard.hidden,true);assert.equal(content(h.ids.globePeople).trim(),'');assert.equal(h.ids.globeCity.textContent,'');
});

test('removing the final city hides and erases its selected people card',async()=>{
  const h=harness(snapshot([city('Boston',[member('a','Ana')])]));await flush();h.key();
  h.respond(()=>reply(snapshot([])));h.refresh();await flush();
  assert.equal(h.ids.globeCard.hidden,true);assert.equal(content(h.ids.globePeople).trim(),'');assert.equal(h.ids.globeCity.textContent,'');
});

test('authentication loss clears map data, arrivals, selection and timeline before another frame',async()=>{
  const a=member('a','Ana'),b=member('b','Ben');
  const h=harness(snapshot([city('Boston',[a])]));await flush();
  h.respond(()=>reply(snapshot([city('Boston',[a,b])])));h.refresh();await flush();h.ids.globePlay.dispatchEvent({type:'click'});h.draw();
  assert.equal(h.intervals.size,1);assert.match(content(h.ids.globeFeed),/Ben/);
  const before=h.draws.filter(draw=>draw.kind==='clearRect').length;
  h.respond(()=>reply({},401));h.refresh();await flush();
  assert.equal(h.ids.globeCard.hidden,true);assert.equal(content(h.ids.globePeople).trim(),'');assert.equal(h.ids.globeFeed.children.length,0);
  assert.equal(h.ids.globeTopics.children.length,0);assert.equal(h.ids.globeSince.hidden,true);assert.equal(h.ids.globePlay.hidden,true);assert.equal(h.intervals.size,0);
  assert.equal(h.ids.globeYou.textContent,'');assert.equal(h.ids.globeSinceLabel.textContent,'');
  assert.ok(h.draws.filter(draw=>draw.kind==='clearRect').length>before,'erase previously painted private nodes immediately');
  h.key();assert.equal(h.ids.globeCard.hidden,true,'keyboard navigation cannot recover erased map entries');
  h.respond(()=>reply(snapshot([city('Boston',[a,b])])));h.refresh();await flush();
  assert.equal(h.requests.at(-1).headers['If-None-Match'],undefined);assert.equal(h.ids.globeFeed.children.length,0,'a new session starts with no old arrival history');
});

test('topic changes invalidate an in-flight snapshot and immediately fetch the selected filter',async()=>{
  const first=snapshot([city('Boston',[member('a','Ana')])]);
  const h=harness(first);await flush();const old=deferred(),fresh=deferred();let count=0;
  h.respond(()=>++count===1?old.promise:fresh.promise);h.refresh();await flush();
  h.ids.globeTopics.children[1].dispatchEvent({type:'click'});
  old.resolve(reply(snapshot([city('Stale city',[member('stale','Stale name')])])));await flush();
  assert.equal(h.requests.at(-1).path,'/api/network/places?topic=Mobility');
  assert.equal(h.requests.at(-1).headers['If-None-Match'],undefined);
  assert.doesNotMatch(content(h.ids.globeFeed)+content(h.ids.globePeople)+content(h.ids.globeCity),/Stale/);
  fresh.resolve(reply(snapshot([city('Current city',[member('current','Current name')])])));await flush();
  assert.doesNotMatch(content(h.ids.globeFeed)+content(h.ids.globePeople)+content(h.ids.globeCity),/Stale/);
  assert.match(content(h.ids.globePeople),/Current name/);
});
