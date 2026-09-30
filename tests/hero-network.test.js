import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {CITIES, markup, project} from '../scripts/hero-network-geometry.mjs';

const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const source=read('web/scripts/hero-network.js'),html=read('web/pages/index.html'),css=read('web/styles/styles.css'),i18n=read('web/scripts/i18n.js');
const svgBlock=html.match(/<svg class="hero-net"[\s\S]*?<\/svg>/)?.[0]??'';
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const K=2385/828,LEAF='rgb(89,188,83)';

// A fake DOM built from the shipped markup, modelled on landing-motion.test.js.
function heroHarness(o={}) {
 const frames=new Map(),timers=new Map(),observers=[],listeners=[];let serial=0,clock=1000,writes=0,created=0;
 const node=(tagName,attributes={})=>{
  const classes=new Set((attributes.class||'').split(' ').filter(Boolean));
  const n={tagName,attributes,style:{},children:[],listeners:{},hidden:false,textContent:'',parent:null,
   classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove:(...c)=>c.forEach(x=>classes.delete(x)),contains:c=>classes.has(c),
    toggle(c,force){const on=force===undefined?!classes.has(c):!!force;if(on)classes.add(c);else classes.delete(c);return on;}},
   setAttribute(key,value){writes++;this.attributes[key]=String(value);},getAttribute(key){return key in this.attributes?this.attributes[key]:null;},
   appendChild(child){child.parent=this;this.children.push(child);return child;},
   insertBefore(child,ref){const i=ref?this.children.indexOf(ref):-1;child.parent=this;if(i<0)this.children.push(child);else this.children.splice(i,0,child);return child;},
   querySelectorAll(selector){const cls=selector.slice(1),found=[];const walk=x=>x.children.forEach(c=>{if(c.classList.contains(cls))found.push(c);walk(c);});walk(this);return found;},
   querySelector(selector){return this.querySelectorAll(selector)[0]??null;},
   addEventListener(name,fn){listeners.push(name);this.listeners[name]=fn;},
   getBoundingClientRect:()=>o.rects?.[attributes.class]??{left:0,top:0,right:0,bottom:0,width:0,height:0}};
  return n;
 };
 const block=o.markup?o.markup(svgBlock):svgBlock;
 const wrap=node('div',{class:'hero-map'}),img=node('img',{class:'map-outline'}),svg=node('svg',attrs(block.match(/<svg[^>]*>/)[0]));
 Object.assign(img,{complete:true,naturalWidth:1953,decode:()=>Promise.resolve()});
 const group=cls=>svg.appendChild(node('g',{class:cls}));
 const gEdges=group('hn-edges'),gHalos=group('hn-halos'),gNodes=group('hn-nodes');
 for(const m of block.matchAll(/<path class="hn-edge[^"]*"[^>]*\/>/g))gEdges.appendChild(node('path',attrs(m[0])));
 for(const m of block.matchAll(/<circle class="hn-(core|halo)"[^>]*\/>/g))(m[1]==='core'?gNodes:gHalos).appendChild(node('circle',attrs(m[0])));
 const button=node('button',{class:'hn-toggle','aria-pressed':'false'});button.hidden=true;
 wrap.appendChild(img);if(!o.noSvg)wrap.appendChild(svg);wrap.appendChild(button);
 const map={left:790.8,top:0,right:1468.8,bottom:828,width:678,height:828,...o.map};wrap.getBoundingClientRect=()=>map;
 const header=node('header',{class:'navbar'});header.getBoundingClientRect=()=>({left:0,top:0,right:1440,bottom:o.header??101,width:1440,height:o.header??101});
 const roots=Object.fromEntries(['hero-content','headline','hero-kicker','hero-sub'].map(c=>[c,node('div',{class:c})]));
 const lifted=root=>{const span=node('span');span.parentNode=root;span.transform=`matrix(1, 0, 0, 1, 0, ${o.lift})`;return span;};
 // Chromium semantics: reading .matches after the preference flips consumes that list's pending change event
 const mqs={};const mq=(query,value)=>{let read=true;mqs[query]={get matches(){read=true;return value;},set matches(v){value=v;read=false;},
  report(){if(!read)this.change({matches:value});},addEventListener(_name,fn){listeners.push('mq '+query);this.change=fn;}};};
 mq('(prefers-reduced-motion: reduce)',!!o.reduced);mq('(min-width: 1100px)',o.wide??true);mq('(hover: hover) and (pointer: fine)',!!o.fine);
 const store=new Map(Object.entries(o.storage??{}));
 const localStorage=o.throws?{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}}
  :{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const document={hidden:!!o.hidden,readyState:'complete',documentElement:{clientWidth:o.width??1440},
  querySelector:selector=>selector==='.hero-map'?(o.noMap?null:wrap):selector==='.navbar'?header:roots[selector.slice(1)]??null,
  querySelectorAll:()=>[],createElementNS:(_ns,tag)=>{created++;return node(tag);},
  createTreeWalker:root=>{let given=!o.textRects;return {nextNode:()=>given?null:(given=true,{nodeValue:'text',parentNode:o.lift?lifted(root):root})};},
  createRange:()=>({selectNodeContents(){},getClientRects:()=>o.textRects??[]}),
  addEventListener(name,fn){listeners.push('document '+name);this['on'+name]=fn;}};
 const hook={};
 const window={matchMedia:query=>mqs[query]??{matches:false,addEventListener(){}},scrollY:0,localStorage,
  navigator:{hardwareConcurrency:8,...(o.saveData?{connection:{saveData:true}}:{})},
  nodalI18n:{onChange(fn){listeners.push('i18n');this.fn=fn;}},addEventListener(name,fn){listeners.push('window '+name);this['on'+name]=fn;},
  ...(o.noHook?{}:{__nodalHeroTest:hook})};
 const context={document,window,Math,Date,performance:{now:()=>clock},getComputedStyle:el=>({transform:el.transform??'none',getPropertyValue:()=>''}),
  IntersectionObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},
  ...(o.noRaf?{}:{requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)}),
  setTimeout(fn,delay=0){const id=++serial;timers.set(id,{fn,delay,due:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 const cores=gNodes.children,ids=cores.map(c=>c.attributes['data-city']);
 const state=()=>{const s=hook.state();return {...s,reserve:[...s.reserve],culled:[...s.culled]};};
 const h={state,events:()=>[...hook.events()].map(e=>({...e})),svg,wrap,button,hook,frames,timers,observers,listeners,mqs,store,
  writes:()=>writes,created:()=>created,now:()=>clock,advance(ms){clock+=ms;},
  edges:()=>gEdges.children,edge:(a,b)=>gEdges.children.find(e=>e.attributes['data-a']===a&&e.attributes['data-b']===b),
  core:id=>cores[ids.indexOf(id)],halo:id=>gHalos.children[ids.indexOf(id)],ring:id=>svg.children.find(c=>c.classList.contains('hn-rings'))?.children[ids.indexOf(id)],
  slots(){ // the pooled capsules: every aura, then every glow, trail and head, one of each per slot
   const pool=svg.children.find(c=>c.classList.contains('hn-signals'))?.children??[],of=cls=>pool.filter(c=>c.classList.contains(cls));
   const [aura,glow,trail,head]=['hn-aura','hn-glow','hn-trail','hn-head'].map(of);
   return head.map((x,i)=>({aura:aura[i],glow:glow[i],trail:trail[i],head:x,children:[aura[i],glow[i],trail[i],x]}));
  },
  label:()=>svg.children.find(c=>c.classList.contains('hn-label')),
  frame(dt=16){clock+=dt;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(clock));},
  fireTimers(){const [id,next]=[...timers].sort((a,b)=>a[1].due-b[1].due)[0]??[];if(!next)return false;clock=Math.max(clock,next.due);timers.delete(id);next.fn();return true;},
  run(until,each){for(let guard=0;guard<200000&&state().t<until;guard++){if(frames.size)h.frame(16);else if(!h.fireTimers())break;each?.();}},
  drain(){for(let guard=0;guard<10000&&frames.size;guard++)h.frame(16);},
  visible(v){observers[0].fn([{isIntersecting:v}]);},hidden(v){document.hidden=v;document.onvisibilitychange();},
  reduced(v){mqs['(prefers-reduced-motion: reduce)'].matches=v;mqs['(prefers-reduced-motion: reduce)'].change({matches:v});},
  flipReduced(v){mqs['(prefers-reduced-motion: reduce)'].matches=v;},reportReduced(){mqs['(prefers-reduced-motion: reduce)'].report();},
  resize(){window.onresize();},key(key){document.onkeydown({key});},
  wide(v){mqs['(min-width: 1100px)'].matches=v;mqs['(min-width: 1100px)'].change({matches:v});},
  hit:id=>svg.children.find(c=>c.classList.contains('hn-hits'))?.children[ids.indexOf(id)],
  hover(id){h.hit(id).listeners.pointerenter();},leave(id,relatedTarget=null){h.hit(id).listeners.pointerleave({relatedTarget});},
  leaveLabel(relatedTarget=null){h.label().listeners.pointerleave({relatedTarget});},click(){button.listeners.click();},
  running:()=>svg.classList.contains('is-running'),
  signalsOn:()=>h.slots().filter(s=>Number(s.head.attributes['stroke-opacity'])>0).length};
 return h;
}
const opacity=el=>Number(el.attributes['stroke-opacity']??1);

test('hero network does nothing without its markup, and degrades invalid markup to the still',()=>{
 for(const options of [{noMap:true},{noSvg:true}]){
  const h=heroHarness(options);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.deepEqual(h.listeners,[]);assert.equal(h.observers.length,0);assert.equal(h.created(),0);
 }
 const broken=heroHarness({markup:block=>block.replace(/\s*<path class="hn-edge" data-a="uio" data-b="bog"[^>]*\/>/,'')});
 assert.equal(broken.state().invalid,true);assert.equal(broken.state().mode,'still');
 assert.equal(broken.frames.size,0);assert.equal(broken.timers.size,0);assert.ok(broken.svg.classList.contains('is-live'));assert.equal(broken.button.hidden,true);
});

test('hero network is not built below 1100px until the viewport widens',()=>{
 const h=heroHarness({wide:false});
 assert.equal(h.created(),0);assert.equal(h.observers.length,0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 assert.deepEqual(h.listeners,['mq (min-width: 1100px)']);
 h.wide(true);
 assert.ok(h.created()>0);assert.equal(h.frames.size,1);assert.ok(h.svg.classList.contains('is-live'));
});

test('reduced motion at load shows the finished still with no loop',()=>{
 const h=heroHarness({reduced:true});
 assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.ok(h.svg.classList.contains('is-live'));
 assert.equal(h.edges().length,26);
 for(const edge of h.edges()){
  assert.notEqual(edge.style.display,'none');assert.ok([undefined,'none'].includes(edge.attributes['stroke-dasharray']));assert.ok(opacity(edge)>=.4);
 }
 assert.equal(h.edge('bue','sao').attributes.stroke,LEAF);
 assert.ok(Math.abs(Number(h.core('sao').attributes.r)-8*K)<.01);
 for(const id of ['sao','lim','bog','bue'])assert.equal(h.halo(id).attributes['fill-opacity'],'0.42');
 assert.equal(h.halo('scl').attributes['fill-opacity'],'0');
 for(const slot of h.slots())for(const path of slot.children)assert.equal(path.attributes['stroke-opacity'],'0');
 assert.equal(h.button.hidden,true);
});

test('a background tab waits and plays the intro from the start on first view',()=>{
 const h=heroHarness({hidden:true});
 assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 h.hidden(false);
 assert.equal(h.frames.size,1);assert.equal(h.state().t,0);
 h.frame();assert.equal(h.state().t,0);assert.equal(h.core('lim').attributes['fill-opacity'],'0');
});

test('hero network pauses offscreen with a frozen clock and resumes one loop',()=>{
 const h=heroHarness();
 h.run(3000);
 const stale=[...h.frames.values()][0];
 h.visible(false);
 assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 const frozen=h.state().t,writes=h.writes();
 h.advance(10000);stale(h.now());
 assert.equal(h.state().t,frozen);assert.equal(h.writes(),writes);
 h.visible(true);h.visible(true);
 assert.equal(h.frames.size,1);
 h.frame();assert.ok(h.state().t-frozen<=50);
 h.frame();assert.ok(h.state().t>frozen);
});

test('toggling visibility, tab, motion and the pause button never accumulates loops or timers',()=>{
 const h=heroHarness();
 const check=()=>{assert.ok(h.frames.size<=1);assert.ok(h.timers.size<=1);};
 const cycle=()=>{
  for(let i=0;i<20;i++){h.visible(false);check();h.visible(true);check();}
  for(let i=0;i<20;i++){h.hidden(true);check();h.hidden(false);check();}
  for(let i=0;i<20;i++){h.reduced(true);check();h.reduced(false);check();}
  for(const core of ['lim','mex','sdq','mao'].map(h.core))assert.equal(core.attributes['fill-opacity'],'1');
  for(let i=0;i<20;i++){h.click();check();h.click();check();}
 };
 h.run(2000);cycle();
 h.run(h.hook.INTRO_END+500);h.drain();assert.equal(h.state().mode,'ambient');assert.equal(h.frames.size,0);
 const due=[...h.timers.values()][0].due;h.advance(1000);h.visible(true);
 assert.ok(Math.abs([...h.timers.values()][0].due-due)<=1,'a redundant resume does not postpone the next event');
 cycle();
 assert.equal(h.state().userPaused,false);assert.equal(h.store.size,0);
});

test('reduced motion turning on mid-intro reaches the still even where reading .matches would swallow the change event',()=>{
 const h=heroHarness();
 h.run(2600);assert.equal(h.state().mode,'intro');
 h.flipReduced(true);h.frame();h.reportReduced(); // a frame in between: the engine must not have read .matches
 assert.equal(h.state().mode,'still');assert.equal(h.button.hidden,true);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 h.flipReduced(false);h.reportReduced();
 assert.equal(h.state().mode,'ambient');assert.equal(h.button.hidden,false);assert.equal(h.frames.size,0);assert.equal(h.timers.size,1);
 assert.equal(h.hook.state().reserve.length,0);
 for(const id of ['lim','mex','sdq','mao','asu'])assert.equal(h.core(id).attributes['fill-opacity'],'1'); // complete, never replayed
 for(const edge of h.edges())assert.ok(opacity(edge)>=.55);
});

test('without requestAnimationFrame the network shows the still and never throws',()=>{
 let h;assert.doesNotThrow(()=>{h=heroHarness({noRaf:true});});
 assert.equal(h.state().mode,'still');assert.ok(h.svg.classList.contains('is-live'));assert.equal(h.button.hidden,true);assert.equal(h.timers.size,0);
 assert.doesNotThrow(()=>{h.visible(false);h.visible(true);h.hidden(true);h.hidden(false);h.reduced(true);h.reduced(false);});
 assert.equal(h.state().mode,'still');
});

test('a signal travels on a quiet tie, and the tie glows only once it lands',()=>{
 const h=heroHarness(),climax=h.hook.plan.intros.find(i=>i.kind==='climax'),series=[];
 for(let at=climax.s;at<climax.s+800;at+=10){h.hook.renderAt(at);series.push(opacity(h.edge('scl','bue')));} // the relay's first hop, bue to scl
 const lit=series.findIndex(v=>v>.88);
 assert.ok(lit>=30,`lit at +${lit*10} ms`);assert.ok(series.slice(0,lit).every(v=>v<.78),'nearly at rest while the capsule travels');
 h.hook.renderAt(climax.s+100);assert.ok(h.signalsOn()>=1);
});

test('a signal is a glowing capsule: two wide faint glows under a bright head and a long trail, all at one front',()=>{
 const h=heroHarness(),climax=h.hook.plan.intros.find(i=>i.kind==='climax');
 h.hook.renderAt(climax.s+200);
 const slot=h.slots().find(s=>Number(s.head.attributes['stroke-opacity'])>0),n=(p,k)=>Number(p.attributes[k]);
 const w=p=>n(p,'stroke-width')/K,dash=p=>Number(p.attributes['stroke-dasharray'].split(' ')[0]),front=p=>dash(p)-n(p,'stroke-dashoffset');
 assert.ok(w(slot.aura)>=12&&w(slot.aura)<=14,`aura ${w(slot.aura)}`);assert.ok(w(slot.glow)>=7&&w(slot.glow)<=10,`glow ${w(slot.glow)}`);
 assert.ok(w(slot.head)>w(slot.trail)&&w(slot.head)>=3.5);
 assert.ok(n(slot.aura,'stroke-opacity')<n(slot.glow,'stroke-opacity')&&n(slot.glow,'stroke-opacity')<=.25&&n(slot.glow,'stroke-opacity')>=.15);
 assert.equal(n(slot.head,'stroke-opacity'),1);assert.ok(n(slot.trail,'stroke-opacity')>=.7);
 assert.ok(dash(slot.trail)>dash(slot.aura)&&dash(slot.aura)>=dash(slot.glow)&&dash(slot.glow)>dash(slot.head),'trail longest, head shortest');
 for(const p of [slot.aura,slot.glow,slot.trail])assert.ok(Math.abs(front(p)-front(slot.head))<.02,'one front');
 for(const p of slot.children)assert.equal(p.attributes.d,slot.head.attributes.d);
 // the leaf accent hands its colour to a signal travelling on it, and takes it back as the signal lands
 const proofS=climax.proofS,dur=climax.proofEnd-climax.proofS;
 h.hook.renderAt(proofS+dur/2);assert.notEqual(h.edge('bue','sao').attributes.stroke,LEAF);
 h.hook.renderAt(climax.proofEnd+40);assert.equal(h.edge('bue','sao').attributes.stroke,LEAF);
});

test('Lima ignites with presence: a heavier ring, a soft bloom and a core that pops before it settles',()=>{
 const h=heroHarness(),ring=h.svg.children.find(c=>c.classList.contains('hn-rings')).children[8]; // Lima is the ninth city
 h.hook.renderAt(1100+280);
 assert.ok(Number(h.halo('lim').attributes['fill-opacity'])>=.35,'bloom');assert.ok(Number(h.halo('lim').attributes.r)/K>10);
 assert.ok(Number(h.core('lim').attributes.r)/K>=4.5,'pop');assert.ok(Math.abs(Number(ring.attributes['stroke-width'])/K-2)<.01);
 assert.ok(Number(ring.attributes['stroke-opacity'])>.5);
 h.hook.renderAt(1100+700);assert.ok(Math.abs(Number(h.core('lim').attributes.r)/K-3.5)<.05,'settled before its first tie lands');
 h.hook.renderAt(1100+1400);assert.equal(h.halo('lim').attributes['fill-opacity'],'0');
});

test('signals stay bounded, loops and timers never pile up, and no element is created after setup',()=>{
 const h=heroHarness(),made=h.created();let peak=0,ambientPeak=0,maxWrites=0,last=h.writes(),piled=0;
 h.run(h.hook.INTRO_END+240000,()=>{
  const on=h.signalsOn(),t=h.state().t;peak=Math.max(peak,on);if(t>h.hook.INTRO_END)ambientPeak=Math.max(ambientPeak,on);
  maxWrites=Math.max(maxWrites,h.writes()-last);last=h.writes();
  if(h.frames.size+h.timers.size!==1)piled++; // exactly one of: the next frame, or the timer for the next event
 });
 assert.ok(peak<=4&&peak>=2,`peak ${peak}`);assert.equal(ambientPeak,2,`ambient ${ambientPeak}`);assert.equal(piled,0);
 assert.equal(h.created(),made);assert.equal(made,2+4*4+20+1); // signal and ring groups, aura/glow/trail/head per slot, rings, label
 assert.ok(66+3+made+1+20<=130,'svg element budget'); // static shapes and groups, dynamic elements, hit group and circles
 assert.equal(heroHarness({fine:true}).created(),made+1+20);
 assert.ok(maxWrites<=180,`writes per step ${maxWrites}`);
});

test('the ambient life keeps going while the hero is visible, at a lively cadence, and costs nothing when it is not',()=>{
 const h=heroHarness(),{INTRO_END}=h.hook;
 h.run(INTRO_END+300000); // five minutes of life
 assert.equal(h.state().mode,'ambient');assert.equal(h.frames.size+h.timers.size,1);assert.ok(h.running());
 const ev=h.events(),intros=ev.filter(e=>e.type==='intro');
 assert.deepEqual(intros.map(e=>e.edge),['asu bue','bog sdq','asu cor']);assert.deepEqual(h.state().reserve,[]);
 const late=ev.filter(e=>e.start>INTRO_END+240000);assert.ok(late.length>=14,`${late.length} exchanges in the fifth minute`);
 // exchanges fire every ~3-4 s; now and then a second one follows within a second, on a tie that shares no city with the first
 const ex=ev.filter(e=>e.type==='exchange'),fires=ex.filter((e,i)=>!i||e.start-ex[i-1].start>=1000),pairs=ex.filter((e,i)=>i&&e.start-ex[i-1].start<1000);
 const gaps=fires.slice(1).map((e,i)=>e.start-fires[i].start).sort((a,b)=>a-b),median=gaps[gaps.length>>1];
 assert.ok(median>=2800&&median<=4400,`median gap ${median}`);assert.ok(gaps[0]>=2000,`shortest gap ${gaps[0]}`);
 assert.ok(pairs.length>=8&&pairs.length<=fires.length*.5,`${pairs.length} pairs in ${fires.length}`);
 for(const e of pairs){const prev=ex[ex.indexOf(e)-1],a=e.edge.split(' ');assert.ok(!prev.edge.split(' ').some(id=>a.includes(id)),`${prev.edge} / ${e.edge}`);}
 for(let i=2;i<ex.length;i++)assert.ok(![ex[i-1].edge,ex[i-2].edge].includes(ex[i].edge),'a tie rests for a while after an exchange');
 // hidden, offscreen, reduced motion and the pause button: no frame, no timer, a frozen clock, no breathing
 for(const [name,off,on] of [['offscreen',()=>h.visible(false),()=>h.visible(true)],['hidden',()=>h.hidden(true),()=>h.hidden(false)],
  ['reduced',()=>h.reduced(true),()=>h.reduced(false)],['paused',()=>h.click(),()=>h.click()]]){
  off();assert.equal(h.frames.size,0,name);assert.equal(h.timers.size,0,name);assert.ok(!h.running(),name);
  const n=h.events().length,t=h.state().t;h.advance(120000);assert.equal(h.fireTimers(),false,name);assert.equal(h.events().length,n);assert.equal(h.state().t,t,name);
  on();assert.ok(h.running(),name);assert.equal(h.frames.size+h.timers.size,1,name);
  h.run(h.state().t+12000);assert.ok(h.events().length>=n+2,`${name}: the life picks up again`);
 }
 assert.equal(h.state().userPaused,false);assert.equal(h.store.size,0);
});

test('an exchange lands with a bloom: the receiving city flashes, rings and swells its halo, then settles',()=>{
 const h=heroHarness();h.run(h.hook.INTRO_END+500);h.drain();
 h.fireTimers();
 const e=h.events().at(-1),[a,b]=e.edge.split(' '),to=e.from===a?b:a,num=(el,k)=>Number(el.attributes[k]??0),rest=num(h.halo(to),'fill-opacity');
 let bloom=0,ring=0,green=0;
 for(let guard=0;guard<1000&&h.frames.size;guard++){
  h.frame(16);bloom=Math.max(bloom,num(h.halo(to),'fill-opacity'));ring=Math.max(ring,num(h.ring(to),'stroke-opacity'));
  green=Math.max(green,Number(/rgb\(\d+,(\d+),/.exec(h.core(to).attributes.fill)[1]));
 }
 assert.ok(bloom>=rest+.15,`bloom ${bloom} over ${rest}`);assert.ok(ring>=.4,`ring ${ring}`);assert.ok(green>=170,'the core flashes leaf');
 assert.equal(num(h.halo(to),'fill-opacity'),rest);assert.equal(num(h.ring(to),'stroke-opacity'),0);assert.equal(h.timers.size,1);
});

test('the hub halos breathe (CSS) only while the life runs',()=>{
 const h=heroHarness(),hubs=['bog','lim','sao','bue'];
 const marked=h.svg.children.find(c=>c.classList.contains('hn-halos')).children.filter(c=>c.classList.contains('is-hub'));
 assert.deepEqual(marked.map(c=>c.attributes['data-city']).sort(),[...hubs].sort());
 const phase=hubs.map(id=>`${h.halo(id).style.animationDelay} ${h.halo(id).style.animationDuration}`);
 assert.equal(new Set(phase).size,4,'each hub its own phase and period');
 for(const id of hubs){const d=parseFloat(h.halo(id).style.animationDuration);assert.ok(d>=3&&d<=4.2,`${id} ${d}s`);}
 assert.ok(h.running(),'the intro runs');
 h.visible(false);assert.ok(!h.running());h.visible(true);assert.ok(h.running());
 h.hidden(true);assert.ok(!h.running());h.hidden(false);assert.ok(h.running());
 h.run(h.hook.INTRO_END+500);h.drain();assert.equal(h.frames.size,0);assert.ok(h.running(),'between events a timer waits and the hubs keep breathing');
 h.reduced(true);assert.ok(!h.running());h.reduced(false);assert.ok(h.running());
 h.click();assert.ok(!h.running());h.click();assert.ok(h.running());
 for(const o of [{reduced:true},{storage:{'nodal.heroMotion':'off'}},{noRaf:true},{hidden:true},{textRects:[{left:1100,top:280,right:1120,bottom:296,width:20,height:16}]}])
  assert.ok(!heroHarness(o).running(),JSON.stringify(o));
 assert.ok(heroHarness({saveData:true}).running(),'lite mode breathes too');
 const late=heroHarness({hidden:true});assert.ok(!late.running());late.hidden(false);assert.ok(late.running());
 const broken=heroHarness({markup:block=>block.replace(/\s*<path class="hn-edge" data-a="uio" data-b="bog"[^>]*\/>/,'')});
 assert.ok(!broken.running());assert.ok(!broken.halo('lim').classList.contains('is-hub'));
});

test('the hub pulse is a transform-only keyframe, gated on .is-running and off under reduced motion',()=>{
 const frames=css.match(/@keyframes hn-breathe \{(.*)\}\n/)?.[1]??'';
 assert.match(frames,/transform: scale\(1\)/);assert.doesNotMatch(frames,/opacity|fill|stroke|\br:|display/);
 assert.match(css,/\.hero-net\.is-running \.hn-halo\.is-hub \{ animation: hn-breathe [^}]*infinite; \}/);
 assert.match(css,/\.hn-halo \{[^}]*transform-box: fill-box; transform-origin: center; \}/);
 const animated=[...css.matchAll(/([^{}]*)\{[^}]*\banimation:\s*hn-[^}]*\}/g)].map(m=>m[1].trim());
 assert.deepEqual(animated,['.hero-net.is-running .hn-halo.is-hub']);
 assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.hero-net \.hn-halo \{ animation: none; \}/);
 assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{\n {2}\* \{ animation: none !important;/);
 assert.doesNotMatch(source,/\.style\.(opacity|transform|animation)\s*=/,'JS never animates the halo itself');
});

test('the intro plan is a valid introduction story with the designed timing',()=>{
 const {plan,INTRO_END}=heroHarness().hook;
 const key=(a,b)=>[a,b].sort().join(' ');
 assert.equal(plan.seed,'lim');assert.equal(plan.tree.length,19);
 const reached=new Set(['lim']);for(const e of plan.tree){assert.ok(reached.has(e.a),`${e.a} is active before ${e.b}`);reached.add(e.b);}
 assert.equal(reached.size,20);
 const endOf=Object.fromEntries(plan.tree.map(e=>[key(e.a,e.b),e.end])),order=[...svgBlock.matchAll(/data-a="(\w+)" data-b="(\w+)"/g)].map(m=>key(m[1],m[2]));
 assert.equal(order.length,26);assert.equal(new Set(order).size,26);
 for(const intro of plan.intros){
  const path=[intro.a,...intro.via,intro.b];
  assert.equal(path.length,intro.kind==='climax'?4:3);
  for(let i=1;i<path.length;i++){const k=key(path[i-1],path[i]);assert.ok(order.indexOf(k)<order.indexOf(key(intro.a,intro.b)));assert.ok(endOf[k]<=intro.s,`${k} ends before ${intro.a}-${intro.b}`);}
  endOf[key(intro.a,intro.b)]=intro.end;
 }
 assert.equal(plan.intros.filter(i=>i.kind==='climax').length,1);
 const scheduled=[...plan.tree,...plan.intros,...plan.reserve].map(e=>key(e.a,e.b));
 assert.deepEqual([...scheduled].sort(),[...order].sort());
 for(let t=0;t<=INTRO_END;t++){
  const on=plan.draws.filter(d=>d.s<=t&&t<d.e);
  assert.ok(on.filter(d=>d.kind==='tree').length<=3,`tree lines at ${t}`);assert.ok(on.length<=4,`lines at ${t}`);
 }
 const near=(v,want)=>assert.ok(Math.abs(v-want)<=2,`${v} vs ${want}`);
 near(INTRO_END,8983);near(plan.intros.find(i=>i.kind==='climax').end,8105);near(plan.tree.find(e=>e.b==='mex').end,5490);
 near(plan.busyUntil,9683);
 const final={};for(const e of [...plan.tree,...plan.intros,...plan.reserve])for(const id of [e.a,e.b])final[id]=(final[id]??0)+1;
 assert.deepEqual([final.sao,final.lim,final.bog,final.bue],[6,5,5,5]);
});

test('the ambient life is deterministic',()=>{
 const runOnce=()=>{const h=heroHarness();h.run(h.hook.INTRO_END+120000);return h.events().map(({type,edge,from,start})=>({type,edge,from,start}));};
 const first=runOnce();
 assert.ok(first.length>=35,`${first.length} events`);assert.deepEqual(runOnce(),first);
});

test('hovering a city names it, shows its ties and sends one exchange',()=>{
 const h=heroHarness({fine:true});
 assert.equal(h.hit('bog').style.display,'none');
 h.run(h.hook.INTRO_END+500);h.drain(); // idle after the intro's last ring, before the first ambient event
 assert.equal(h.state().mode,'ambient');assert.equal(h.hit('bog').style.display,'');assert.equal(h.timers.size,1);
 const before=h.events().length;
 h.hover('bog');
 assert.ok(h.svg.classList.contains('is-focus'));assert.equal(h.label().textContent,'BOGOTÁ');assert.ok(h.label().classList.contains('is-on'));
 assert.equal(h.edges().filter(e=>e.classList.contains('is-near')).length,4);
 assert.ok(!h.edge('sdq','bog').classList.contains('is-near'));
 assert.ok(h.core('bog').classList.contains('is-focus'));assert.ok(h.core('lim').classList.contains('is-near'));
 const sent=h.events().slice(before);
 assert.equal(sent.length,1);assert.equal(sent[0].from,'bog');assert.equal(sent[0].type,'hover');assert.equal(h.frames.size,1);assert.equal(h.timers.size,0);
 h.leave('bog');h.frame();h.hover('bog');
 assert.equal(h.events().length,before+1);
 h.leave('bog');
 assert.ok(!h.svg.classList.contains('is-focus'));assert.equal(h.edges().filter(e=>e.classList.contains('is-near')).length,0);assert.ok(!h.label().classList.contains('is-on'));
 const still=heroHarness({fine:true,reduced:true});
 still.hover('sao');
 assert.equal(still.label().textContent,'SÃO PAULO');assert.equal(still.edges().filter(e=>e.classList.contains('is-near')).length,6);
 assert.equal(still.frames.size,0);assert.equal(still.timers.size,0);
 assert.equal(still.label().attributes['text-anchor'],'end'); // near the right edge: to the left
 still.leave('sao');still.hover('rio'); // left of Rio sits São Paulo, so the label goes above
 assert.ok(Number(still.label().attributes.y)<1342-10);assert.equal(still.label().attributes['text-anchor'],'end');
 still.leave('rio');still.hover('bog');assert.equal(still.label().attributes['text-anchor'],'start');
 const touch=heroHarness();assert.equal(touch.hit('bog'),undefined);
});

test('a city can send again 1.5 s of wall time later, between events and deep into the life',()=>{
 const h=heroHarness({fine:true}),sends=()=>h.events().filter(e=>e.type==='hover').length;
 h.run(h.hook.INTRO_END+500);h.drain();
 h.hover('bog');h.leave('bog');assert.equal(sends(),1);
 h.drain();h.hover('bog');h.leave('bog');assert.equal(sends(),1,'not within 1.5 s');
 h.advance(1600);h.hover('bog');h.leave('bog');assert.equal(sends(),2,'idle time counts');
 h.run(h.hook.INTRO_END+120000);h.drain();assert.equal(h.state().mode,'ambient');assert.equal(h.timers.size,1);
 const before=sends();
 h.hover('bog');h.leave('bog');assert.equal(sends(),before+1);assert.equal(h.timers.size,0);assert.equal(h.frames.size,1);
 h.drain();assert.equal(h.frames.size,0);assert.equal(h.timers.size,1,'the life re-arms after a hover exchange');
});

test('the label can be hovered, is dismissed with Escape, and keeps clear of a hub halo',()=>{
 const h=heroHarness({fine:true,reduced:true}),on=()=>h.label().classList.contains('is-on'),r=id=>Number(h.hit(id).attributes.r);
 const rest=r('lim');
 h.hover('lim');assert.ok(on());assert.ok(r('lim')>rest,'the hit circle reaches the label');
 h.leave('lim',h.label());assert.ok(on(),'pointer moved onto the label');
 h.leaveLabel(h.hit('lim'));assert.ok(on(),'and back onto the city');
 h.leaveLabel(null);assert.ok(!on());assert.ok(!h.svg.classList.contains('is-focus'));assert.equal(r('lim'),rest);
 h.hover('lim');h.key('Enter');assert.ok(on());h.key('Escape');assert.ok(!on());assert.ok(!h.svg.classList.contains('is-focus'));assert.equal(r('lim'),rest);
 assert.doesNotThrow(()=>h.key('Escape'));
 h.hover('bog');assert.equal(h.label().attributes['text-anchor'],'start');
 assert.ok(Math.abs(Number(h.label().attributes.x)-(1021+(7.1+8+6)*K))<.05,'6 px beyond the halo'); // Bogotá: degree 5, r 7.1
 h.leave('bog');h.hover('lpb');assert.ok(Math.abs(Number(h.label().attributes.x)-(1157+(3.5+2+6)*K))<.05,'6 px beyond the knockout'); // La Paz: degree 1, r 3.5
 assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});

test('a reserve introduction waits while one of its cities is culled, then plays once the viewport shows it',()=>{
 const o={header:122},h=heroHarness(o),intros=()=>h.events().filter(e=>e.type==='intro').map(e=>e.edge);
 assert.deepEqual(h.state().culled,['mex','sdq']);assert.equal(h.state().hideAll,false);
 h.run(h.hook.INTRO_END+60000);
 assert.deepEqual(intros(),['asu bue','asu cor']);assert.deepEqual(h.state().reserve,['bog sdq']);
 assert.ok(h.events().every(e=>!e.edge.split(' ').some(id=>id==='mex'||id==='sdq')),'nothing plays on a hidden city');
 o.header=101;h.resize();h.run(h.state().t+4000);
 assert.deepEqual(h.state().culled,[]);assert.deepEqual(intros(),['asu bue','asu cor','bog sdq']);assert.deepEqual(h.state().reserve,[]);
 const late=h.events().filter(e=>e.type==='intro').at(-1);assert.equal(late.from,'ccs');
});

test('rings stop short of the header, and a disc keeps 7 px clear of it',()=>{
 const ringTop=h=>{ // Ciudad de México (cy 372, the first city) rings as its tie lands at 5490
  const ring=h.svg.children.find(c=>c.classList.contains('hn-rings')).children[0];let top=Infinity;
  for(let at=5400;at<6400;at+=10){h.hook.renderAt(at);if(Number(ring.attributes['stroke-opacity'])>0)top=Math.min(top,(372-Number(ring.attributes.r))/K);}
  return top;
 };
 assert.ok(ringTop(heroHarness())<129.1-13,'uncapped: +10 px beyond the disc');
 const tight=heroHarness({header:114});
 assert.deepEqual(tight.state().culled,[]);assert.ok(ringTop(tight)>=114+6-.01,'capped 6 px under the header');
 assert.deepEqual(heroHarness({header:120}).state().culled,['mex']);assert.deepEqual(heroHarness({header:122}).state().culled,['mex','sdq']); // Santo Domingo's disc top, knockout included, sits at 127.95
});

test('at the measured map boxes, 1366×768 loses only Ciudad de México and 1280×720 also Santo Domingo',()=>{
 const at=(width,left,height)=>heroHarness({width,map:{left,top:0,right:left+height*1953/2385,bottom:height,width:height*1953/2385,height}}).state();
 for(const [width,left,height,culled] of [[1366,814.75,706.547,['mex']],[1280,763.188,662.391,['mex','sdq']],[1280,702.922,736,[]],[1440,790.781,828,[]]]){
  const s=at(width,left,height);assert.deepEqual(s.culled,culled,`${width} px wide, map ${height} px high`);assert.equal(s.hideAll,false);
 }
});

test('a hover label never covers the hero text: it takes the next spot, or the one that intrudes least on a neighbour',()=>{
 const box=h=>{const l=h.label(),x=Number(l.attributes.x)/K+790.8,y=Number(l.attributes.y)/K,w=l.textContent.length*10,x0=l.attributes['text-anchor']==='start'?x:x-w;return [x0,x0+w,y-8.5,y+1.5];};
 const clear=([l,r,t,b],{left,right,top,bottom})=>r<left-6||l>right+6||b<top-6||t>bottom+6;
 const words={left:1175,top:244,right:1225,bottom:254,width:50,height:10},h=heroHarness({fine:true,reduced:true,textRects:[words]}); // over Bogotá's right-hand spot
 assert.deepEqual(h.state().culled,[]);h.hover('bog');
 assert.equal(h.label().attributes['text-anchor'],'end');assert.ok(clear(box(h),words),'moved left of Bogotá');
 const free=heroHarness({fine:true,reduced:true});free.hover('pty');assert.equal(free.label().attributes['text-anchor'],'end'); // Panamá's only city-clear spot: below left
 // a headline line ending 70 px left of Panamá (as at 1100×900 EN): below right, where only Bogotá's translucent halo is grazed
 const headline={left:700,top:220,right:1030,bottom:250,width:330,height:30},p=heroHarness({fine:true,reduced:true,textRects:[headline]});
 assert.deepEqual(p.state().culled,[]);p.hover('pty');
 assert.equal(p.label().attributes['text-anchor'],'start');assert.ok(Number(p.label().attributes.y)>620);assert.ok(clear(box(p),headline));
 assert.ok(Math.abs(Number(p.label().attributes.x)-(896-4.4*K))<.05);
});

test('cities under the header or text are culled, and a covered hub hides the whole network',()=>{
 const h=heroHarness({header:118});
 assert.deepEqual(h.state().culled,['mex']);
 assert.equal(h.core('mex').style.display,'none');assert.equal(h.edge('gua','mex').style.display,'none');
 assert.equal(h.edges().filter(e=>e.style.display==='none').length,1);assert.notEqual(h.core('sdq').style.display,'none');
 assert.equal(h.state().hideAll,false);assert.equal(h.button.hidden,false);
 const covered=heroHarness({textRects:[{left:1100,top:280,right:1120,bottom:296,width:20,height:16}]});
 // text still rising into place (translateY 18px) is measured where it lands: this rect covers Quito only once it has landed
 const rising={textRects:[{left:1100,top:326,right:1120,bottom:342,width:20,height:16}]};
 assert.equal(heroHarness(rising).state().hideAll,false);
 const landed=heroHarness({...rising,lift:18});
 assert.ok(landed.state().culled.includes('uio'));assert.equal(landed.state().hideAll,true);assert.equal(landed.frames.size,0);
 assert.ok(landed.listeners.includes('animationend'),'re-measured once the entrance ends');
 assert.ok(covered.state().culled.includes('uio'));assert.equal(covered.state().hideAll,true);
 assert.ok(covered.svg.classList.contains('is-off'));assert.equal(covered.button.hidden,true);assert.equal(covered.frames.size,0);
});

test('lite mode skips to the finished intro and slows the ambient life',()=>{
 const h=heroHarness({saveData:true}),{INTRO_END}=h.hook;
 assert.equal(h.state().t,INTRO_END);assert.equal(h.state().lite,true);assert.equal(h.frames.size,0);assert.equal(h.timers.size,1);
 assert.ok(Math.abs([...h.timers.values()][0].delay-3600)<=1);
 const reserve=h.edges().filter(e=>e.attributes['data-role']==='reserve');
 assert.equal(h.edges().filter(e=>!reserve.includes(e)&&opacity(e)>=.4).length,23);
 for(const edge of reserve)assert.equal(edge.attributes['stroke-opacity'],'0');
 h.run(INTRO_END+200000);
 const ex=h.events().filter(e=>e.type==='exchange'),gaps=ex.slice(1).map((e,i)=>e.start-ex[i].start).sort((a,b)=>a-b);
 assert.ok(gaps[0]>=4000,'never a pair, and twice the interval');assert.ok(gaps[gaps.length>>1]>=6000,`median ${gaps[gaps.length>>1]}`);
});

test('a persisted pause shows the still, and play resumes without replaying the intro',()=>{
 const h=heroHarness({storage:{'nodal.heroMotion':'off'}});
 assert.equal(h.state().mode,'still');assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 assert.equal(h.button.attributes['aria-pressed'],'true');assert.equal(h.button.hidden,false);
 h.click();
 assert.equal(h.state().mode,'ambient');assert.equal(h.timers.size,1);assert.equal(h.frames.size,0);
 assert.equal(h.button.attributes['aria-pressed'],'false');assert.equal(h.store.has('nodal.heroMotion'),false);
 assert.equal(h.edge('bue','sao').attributes.stroke,LEAF);assert.equal(h.edge('lim','sao').attributes.stroke,'rgb(61,92,56)'); // the accent stays: every end state matches the still
 h.click();assert.equal(h.store.get('nodal.heroMotion'),'off');assert.equal(h.state().mode,'still');
 assert.doesNotThrow(()=>{const x=heroHarness({throws:true});x.click();x.click();});
});

test('the static network ships in index.html, registered to the map and generated from the geometry',()=>{
 assert.equal((html.match(/<div class="hero-map">/g)||[]).length,1);
 const wrapper=html.match(/<div class="hero-map">([\s\S]*?)\n {2}<\/div>/)[1];
 const children=[...wrapper.matchAll(/\n {2}<(img|svg|button)\b([^>]*)>/g)].map(m=>[m[1],attrs(m[0])]);
 assert.deepEqual(children.map(([tag,a])=>tag+'.'+a.class),['img.map-outline','svg.hero-net','button.hn-toggle']);
 const [,svgAttrs]=children[1],[,buttonAttrs]=children[2];
 assert.equal(svgAttrs.viewBox,'0 0 1953 2385');assert.equal(svgAttrs['aria-hidden'],'true');
 assert.match(children[2][1]['data-i18n-aria-label'],/^hero\.motionPause$/);assert.equal(buttonAttrs['aria-pressed'],'false');assert.match(wrapper,/<button[^>]*\shidden><\/button>/);
 assert.equal((svgBlock.match(/class="hn-edge[ "]/g)||[]).length,26);assert.equal((svgBlock.match(/class="hn-core"/g)||[]).length,20);assert.equal((svgBlock.match(/class="hn-halo"/g)||[]).length,20);
 for(const m of svgBlock.matchAll(/ d="([^"]+)"/g))m[1].match(/-?[\d.]+/g).map(Number).forEach((v,i)=>assert.ok(v>=0&&v<=(i%2?2385:1953),m[0]));
 for(const m of svgBlock.matchAll(/ cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g))assert.ok(+m[1]>=0&&+m[1]<=1953&&+m[2]>=0&&+m[2]<=2385,m[0]);
 const squash=s=>s.replace(/\s+/g,' ').trim();
 assert.equal(squash(svgBlock),squash(markup()));
 const nudged=['gua','sjo','pty','sdq','ccs','lim','sao','rio','bue','mvd'];
 for(const c of CITIES){const [x,y]=project(c.lat,c.lon),off=Math.hypot(x-c.x,y-c.y);assert.ok(off<=(nudged.includes(c.id)?30:1.5),`${c.id} ${off.toFixed(1)}px`);}
 assert.match(css,/@media \(scripting: none\) \{ \.hero-net \{ visibility: visible; \} \}/);
 for(const rule of css.matchAll(/([^{}]*\.map-outline[^{}]*)\{([^}]*)\}/g))assert.doesNotMatch(rule[2],/(?:^|[\s;])(?:top|right)\s*:/,rule[0]);
 assert.match(css,/\.hero-map > \.map-outline, \.hero-map > \.hero-net \{[^}]*inset: 0;/);
 const head=html.slice(0,html.indexOf('</head>'));
 assert.match(head,/<script defer src="hero-network\.js\?v=\d+"><\/script>/);
 assert.ok(head.indexOf('hero-network.js')>head.indexOf('script.js?'));
 assert.doesNotMatch(html,/hn-link|pathLength/);
 assert.doesNotMatch(read('web/scripts/script.js'),/hero-net/);
});

test('the pause label is translated on the home page only',()=>{
 const dict=name=>{const start=i18n.indexOf(`const ${name} = {`);return i18n.slice(start,i18n.indexOf('\n  };',start));};
 assert.match(dict('HOME_ES'),/'hero\.motionPause': 'Pausar la animación del mapa'/);
 assert.match(dict('HOME_PT'),/'hero\.motionPause': 'Pausar a animação do mapa'/);
 for(const name of ['ES','PT','DASH_ES','DASH_PT'])assert.doesNotMatch(dict(name),/hero\.motionPause/);
 assert.match(html,/aria-label="Pause map animation" data-i18n-aria-label="hero\.motionPause"/);
});
