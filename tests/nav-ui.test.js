import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/scripts/nav.js',import.meta.url),'utf8');
function harness(){
  const classes=new Set(),listeners={},attributes={};let focused=false;
  const link={addEventListener:(name,fn)=>{listeners['link:'+name]=fn;}};
  const nav={
    classList:{contains:name=>classes.has(name),remove:name=>classes.delete(name),toggle(name,force){const value=force??!classes.has(name);if(value)classes.add(name);else classes.delete(name);return value;}},
    querySelector:()=>null,querySelectorAll:selector=>selector==='a'?[link]:[],
    addEventListener:(name,fn)=>{listeners['nav:'+name]=fn;},
  };
  const toggle={setAttribute:(name,value)=>{attributes[name]=value;},addEventListener:(name,fn)=>{listeners['toggle:'+name]=fn;},focus:()=>{focused=true;}};
  vm.runInNewContext(source,{document:{querySelector:()=>nav,getElementById:()=>toggle,querySelectorAll:()=>[]}});
  return{classes,attributes,listeners,focused:()=>focused};
}

test('mobile menu announces its collapsed and expanded state through opening and link navigation',()=>{
  const h=harness();
  assert.equal(h.attributes['aria-expanded'],'false');
  h.listeners['toggle:click']();assert.equal(h.classes.has('open'),true);assert.equal(h.attributes['aria-expanded'],'true');
  h.listeners['toggle:click']();assert.equal(h.classes.has('open'),false);assert.equal(h.attributes['aria-expanded'],'false');
  h.listeners['toggle:click']();h.listeners['link:click']();
  assert.equal(h.classes.has('open'),false);assert.equal(h.attributes['aria-expanded'],'false');
});

test('Escape closes the open mobile menu and returns keyboard focus to its button',()=>{
  const h=harness();h.listeners['toggle:click']();let prevented=false;
  h.listeners['nav:keydown']?.({key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(h.classes.has('open'),false);assert.equal(h.attributes['aria-expanded'],'false');
  assert.equal(h.focused(),true);assert.equal(prevented,true);
});

test('unrelated keys and Escape on a closed menu leave keyboard navigation alone',()=>{
  const h=harness();const event=key=>({key,preventDefault(){assert.fail('key must retain its default behavior');}});
  h.listeners['nav:keydown']?.(event('Escape'));
  assert.equal(h.focused(),false);h.listeners['toggle:click']();
  h.listeners['nav:keydown']?.(event('Tab'));
  assert.equal(h.classes.has('open'),true);assert.equal(h.focused(),false);
});
