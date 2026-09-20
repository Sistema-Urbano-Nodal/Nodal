import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/scripts/script.js',import.meta.url),'utf8');
function logo({reduced=false,hidden=false,missing=false}={}) {
 const frames=new Map(),timers=new Map(),events={},observers=[];let serial=0,writes=0;
 const motion={matches:reduced,addEventListener(_event,fn){this.change=fn;}};
 const element=()=>({style:{},attributes:{},children:[],listeners:{},classList:{add(){}},
  setAttribute(key,value){writes++;this.attributes[key]=value;},appendChild(node){this.children.push(node);},
  getTotalLength:()=>100,getBoundingClientRect:()=>({top:0,bottom:100}),addEventListener(name,fn){this.listeners[name]=fn;}});
 const svg=element(),brand=element();brand.getAttribute=()=> '#top';
 const document={hidden,readyState:'complete',getElementById:id=>id==='net'?(missing?null:svg):id==='brand'?brand:null,
  querySelector:()=>null,createElementNS:element,addEventListener(name,fn){events[name]=fn;}};
 const context={document,window:{matchMedia:()=>motion,IntersectionObserver:true},
  IntersectionObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},
  requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 return {svg,frames,timers,writes:()=>writes,frame(time=1000){const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(time));},
  visible(value){observers[0]([{isIntersecting:value}]);},hidden(value){document.hidden=value;events.visibilitychange();},
  reduced(value){motion.matches=value;motion.change({matches:value});},replay(){brand.listeners.click({currentTarget:brand,preventDefault(){}});}};
}

test('logo does no animation work in a hidden tab or under reduced motion',()=>{
 for(const options of [{reduced:true},{hidden:true}]){
  const h=logo(options);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  assert.equal(h.svg.children.filter(node=>node.attributes.r).length,6);
  assert.ok(h.svg.children.filter(node=>node.attributes.r).every(node=>node.style.transform==='scale(1)'));
 }
});

test('logo pauses out of view and resumes one loop without accumulating replay timers',()=>{
 const h=logo();assert.equal(h.frames.size,1);assert.equal(h.timers.size,12);
 h.replay();h.replay();assert.equal(h.timers.size,12);assert.equal(h.frames.size,1);
 h.visible(false);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 const writes=h.writes();h.frame();assert.equal(h.writes(),writes);
 h.visible(true);h.visible(true);assert.equal(h.frames.size,1);
 h.frame();assert.ok(h.writes()>writes);assert.equal(h.frames.size,1);
 h.hidden(true);assert.equal(h.frames.size,0);h.hidden(false);assert.equal(h.frames.size,1);
 h.reduced(true);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 h.reduced(false);assert.equal(h.frames.size,1);
});

test('missing logo does not prevent other page initialization',()=>{
 assert.doesNotThrow(()=>logo({missing:true}));
});
