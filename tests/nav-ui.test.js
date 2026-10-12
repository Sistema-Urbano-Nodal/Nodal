import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/scripts/nav.js',import.meta.url),'utf8');
const read=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
// The shared header: nav.js on a navbar with its two menu groups, the language buttons and the toggle.
// on: the language i18n.js has marked .is-on; ariaKey: the toggle's data-i18n-aria-label (payments.html has none).
function harness({on='es',ariaKey='nav.menuLabel',ids={}}={}){
  const classes=new Set(),listeners={},attributes={},observers=[],refreshed=[];let focused=false,darkSelector='';
  const link={addEventListener:(name,fn)=>{listeners['link:'+name]=fn;}};
  const group=id=>({id,className:''});
  const main=group(ids.main??''),account=group(ids.account??'');
  const langs=['en','es','pt'].map(lang=>{
    const set=new Set(lang===on?['is-on']:[]),button={dataset:{lang},attributes:{},listeners:{},
      classList:{contains:name=>set.has(name),toggle(name,force){if(force??!set.has(name))set.add(name);else set.delete(name);observers.forEach(fn=>fn([{target:button}]));}},
      setAttribute(name,value){this.attributes[name]=String(value);},addEventListener(name,fn){this.listeners[name]=fn;}};
    return button;
  });
  const nav={
    classList:{contains:name=>classes.has(name),remove:name=>classes.delete(name),toggle(name,force){const value=force??!classes.has(name);if(value)classes.add(name);else classes.delete(name);return value;}},
    querySelector:selector=>({'.nav-main':main,'.nav-account':account})[selector]??null,
    querySelectorAll:selector=>selector==='a'?[link]:selector==='.lang-btn'?langs:[],
    addEventListener:(name,fn)=>{listeners['nav:'+name]=fn;},
  };
  const toggle={dataset:ariaKey?{i18nAriaLabel:ariaKey}:{},setAttribute:(name,value)=>{attributes[name]=value;},addEventListener:(name,fn)=>{listeners['toggle:'+name]=fn;},focus:()=>{focused=true;}};
  const document={querySelector:()=>nav,getElementById:()=>toggle,querySelectorAll:selector=>{if(selector==='.lang-btn')return langs;darkSelector=selector;return [];}};
  vm.runInNewContext(source,{document,window:{nodalI18n:{refresh:node=>refreshed.push(node)}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}}});
  const pick=lang=>{const button=langs.find(b=>b.dataset.lang===lang);langs.forEach(b=>b.classList.toggle('is-on',b===button));button.listeners.click?.();};
  return{classes,attributes,listeners,focused:()=>focused,langs,pick,toggle,main,account,refreshed,darkSelector:()=>darkSelector};
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

// Finding 36: the sheet stayed open over the sign-in form after a language was picked.
test('picking a language closes the open menu like a link does, and keeps keyboard focus on the toggle',()=>{
  const h=harness();h.listeners['toggle:click']();
  h.pick('en');
  assert.equal(h.classes.has('open'),false);assert.equal(h.attributes['aria-expanded'],'false');
  assert.equal(h.focused(),true,'the picked button disappears with the sheet, so focus goes back to the toggle');
  const desktop=harness();desktop.pick('pt');
  assert.equal(desktop.focused(),false,'on the desktop header, where there is no open menu, focus stays put');
});

test('the toggle names the menu groups it opens and closes',()=>{
  const h=harness();
  assert.ok(h.main.id&&h.account.id,'unnamed groups get ids');
  assert.equal(h.attributes['aria-controls'],`${h.main.id} ${h.account.id}`);
  const named=harness({ids:{main:'siteNav',account:'accountNav'}});
  assert.equal(named.attributes['aria-controls'],'siteNav accountNav','existing ids are kept');
});

test('a toggle without a translated name gets one (payments.html), and the login and profile toggles carry it in markup',()=>{
  const bare=harness({ariaKey:''});
  assert.equal(bare.toggle.dataset.i18nAriaLabel,'nav.menuLabel');assert.deepEqual(bare.refreshed,[bare.toggle]);
  const marked=harness();assert.deepEqual(marked.refreshed,[],'a marked toggle is left to i18n.js');
  for(const page of ['login.html','profile.html'])assert.match(read('pages/'+page),/<button type="button" class="nav-toggle" id="navToggle" aria-label="Menu" data-i18n-aria-label="nav\.menuLabel">/,page);
});

// Finding 52: a screen reader heard English, Español, Português and never which one was on.
test('the language buttons say which language is on, and follow every change',()=>{
  const h=harness({on:'es'});
  assert.deepEqual(h.langs.map(b=>b.attributes['aria-pressed']),['false','true','false']);
  h.pick('pt');
  assert.deepEqual(h.langs.map(b=>b.attributes['aria-pressed']),['false','false','true']);
});

/* ---------------- shared header CSS (findings 36, 39, 52) ---------------- */
const css=()=>read('styles/styles.css');
function block(sheet,header){
  const start=sheet.indexOf(header);assert.notEqual(start,-1,`${header} is missing`);let depth=0;
  for(let i=sheet.indexOf('{',start);i<sheet.length;i++){if(sheet[i]==='{')depth++;else if(sheet[i]==='}'&&--depth===0)return sheet.slice(start,i+1);}
  return '';
}

test('the open phone menu keeps its toggle at the top right, left-aligned, with 44px controls',()=>{
  const menu=block(css(),'@media (max-width: 1080px)');
  // The toggle is last in the markup: without an order the full-width groups wrapped it under them.
  assert.match(menu,/\.navbar\.open \.nav-main,\s*\.navbar\.open \.nav-account\s*\{[^}]*order:\s*2/);
  assert.match(menu,/\.navbar\.open \.nav-account\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(menu,/\.nav-toggle\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  assert.match(menu,/\.navbar\.open \.lang-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  assert.match(menu,/\.navbar\.open \.nav-main a,\s*\.navbar\.open \.nav-account a\s*\{[^}]*min-height:\s*44px/);
});

test('the open toggle turns into a close mark, still when motion is reduced',()=>{
  const sheet=css();
  assert.match(sheet,/\.nav-toggle\[aria-expanded="true"\] span:nth-child\(1\)\s*\{[^}]*rotate\(45deg\)/);
  assert.match(sheet,/\.nav-toggle\[aria-expanded="true"\] span:nth-child\(2\)\s*\{[^}]*opacity:\s*0/);
  assert.match(sheet,/\.nav-toggle\[aria-expanded="true"\] span:nth-child\(3\)\s*\{[^}]*rotate\(-45deg\)/);
  const calm=[...sheet.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)].map(m=>block(sheet.slice(m.index),'@media (prefers-reduced-motion: reduce)')).join('\n');
  assert.match(calm,/\.nav-toggle span\s*\{\s*transition:\s*none/,'the mark changes without animating');
});

test('language buttons reach 44px on touch screens in the desktop header too',()=>{
  assert.match(block(css(),'@media (pointer: coarse)'),/\.lang-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
});

