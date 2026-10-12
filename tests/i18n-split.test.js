import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* The member console's strings (d.*, p.*, y.*, ops.*) live in i18n-dashboard.js, which only the console pages load,
   so the festival pages and sign-in no longer wait for ~107 KB of dictionaries they never show. A key missing from the
   dictionaries a page loads does not fail loudly: translate() falls back to English, or to the bare key. These tests
   make every page carry the dictionaries its markup and scripts ask for. */
const ROOT=path.resolve(import.meta.dirname,'..');
const read=(...parts)=>readFileSync(path.join(ROOT,...parts),'utf8');
const BASE=read('web','scripts','i18n.js');
const DASH_FILE='i18n-dashboard.js';
const dashSource=()=>read('web','scripts',DASH_FILE);

// An object literal `const NAME = {…}` cut out of i18n.js by a brace scan that skips strings and comments, then evaluated.
function literal(src,name){
  const start=src.indexOf(`const ${name} = {`);assert.notEqual(start,-1,`${name} dictionary is missing`);
  const from=src.indexOf('{',start);let depth=0,quote='',i=from;
  for(;i<src.length;i++){
    const c=src[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';}
    else if(c==='/'&&src[i+1]==='/')i=src.indexOf('\n',i);else if(c==='/'&&src[i+1]==='*')i=src.indexOf('*/',i)+1;
    else if(`'"\``.includes(c))quote=c;else if(c==='{')depth++;else if(c==='}'&&--depth===0)break;
  }
  return vm.runInNewContext('('+src.slice(from,i+1)+')');
}
function dashboard(){
  const context={window:{}};vm.runInNewContext(dashSource(),context);
  const dict=context.window.NODAL_I18N_DASH;
  assert.ok(dict&&['en','es','pt'].every(lang=>dict[lang]&&typeof dict[lang]==='object'),`${DASH_FILE} must define window.NODAL_I18N_DASH = {en, es, pt}`);
  return dict;
}
const base={en:literal(BASE,'DASH_EN'),es:{...literal(BASE,'ES'),...literal(BASE,'DASH_ES')},pt:{...literal(BASE,'PT'),...literal(BASE,'DASH_PT')}};
const home={es:literal(BASE,'HOME_ES'),pt:literal(BASE,'HOME_PT')};

const pages=()=>readdirSync(path.join(ROOT,'web/pages')).filter(name=>name.endsWith('.html')).map(name=>{
  const html=read('web','pages',name);
  return {name,html,scripts:[...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map(m=>m[1]),home:/<body[^>]+data-page="home"/.test(html)};
});
/* What a page asks for: its data-i18n* attributes, plus every quoted key-shaped literal and every template head
   (`d.badge.${id}`) in the scripts it loads. A template head stands for every key it starts. */
const KEY=/(['"`])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+)\1|`([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)*\.)\$\{/g;
function references(page,known){
  const keys=new Map();
  for(const m of page.html.matchAll(/\bdata-i18n(?:-[a-z-]+)?="([^"]+)"/g))keys.set(m[1],page.name);
  for(const script of page.scripts.filter(s=>s!=='i18n.js'&&s!==DASH_FILE)){
    for(const m of read('web','scripts',script).matchAll(KEY)){
      if(m[2])keys.set(m[2],script);
      else for(const key of known)if(key.startsWith(m[3]))keys.set(key,script);
    }
  }
  return keys;
}

test('the console dictionary is its own file and never redefines a shared key',()=>{
  const dash=dashboard();
  assert.ok(Object.keys(dash.es).length>600&&Object.keys(dash.pt).length>600,'the console strings moved out of i18n.js');
  for(const lang of ['en','es','pt']){
    for(const [key,value] of Object.entries(dash[lang])){
      assert.equal(typeof value,'string',`${lang} ${key}`);
      // With no overlap the merge order cannot change what any page shows.
      assert.ok(!(key in base[lang])&&!(key in (home[lang]||{})),`${lang} ${key} is defined in both ${DASH_FILE} and i18n.js`);
    }
  }
  assert.ok(Object.keys(dash.es).every(key=>/^(?:d|p|y|ops)\./.test(key)),'only console keys move');
  assert.ok(BASE.length<80000,`i18n.js is ${BASE.length} bytes; console strings belong in ${DASH_FILE}`);
});

test('every page loads a dictionary for each key it uses, and only console pages load the console strings',()=>{
  const dash=dashboard();
  const known=new Set(['en','es','pt'].flatMap(lang=>[...Object.keys(base[lang]),...Object.keys(dash[lang]),...Object.keys(home[lang]||{})]));
  const dashKeys=new Set(['en','es','pt'].flatMap(lang=>Object.keys(dash[lang])));
  const missing=[],needing=[],loading=[];
  for(const page of pages().filter(page=>page.scripts.includes('i18n.js'))){
    const loads=page.scripts.includes(DASH_FILE);
    if(loads)loading.push(page.name);
    const refs=references(page,known);
    if([...refs.keys()].some(key=>dashKeys.has(key)))needing.push(page.name);
    for(const [key,from] of refs){
      if(!known.has(key))continue;
      for(const lang of ['en','es','pt']){
        const anywhere=key in base[lang]||key in dash[lang]||key in (home[lang]||{});
        const here=key in base[lang]||(loads&&key in dash[lang])||(page.home&&key in (home[lang]||{}));
        if(anywhere&&!here)missing.push(`${page.name} (${from}): '${key}' has ${lang} text only in a dictionary the page does not load`);
      }
    }
  }
  assert.deepEqual(missing,[],missing.join('\n'));
  assert.deepEqual(loading.sort(),needing.sort(),'a page loads the console strings exactly when it uses them');
  // The festival, its hubs and sign-in are the pages attendees open on venue Wi-Fi.
  for(const name of ['fiiu.html','fiiu-talk.html','fiiu-checkin.html','fiiu-qr.html','fiiu-admin.html','organisers-only.html','community.html','knowledge.html','resources.html','login.html','reset-password.html','index.html'])assert.ok(!loading.includes(name),`${name} must not wait for the console strings`);
  for(const name of ['dashboard.html','profile.html','payments.html','admin.html'])assert.ok(loading.includes(name),name);
});

function run(page,{withDash}){
  const context={document:{body:{dataset:{page}},documentElement:{},querySelectorAll:()=>[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams,console};
  vm.createContext(context);
  if(withDash)vm.runInContext(dashSource(),context);
  vm.runInContext(BASE,context);
  return context.window.nodalI18n;
}

test('pages without the console strings keep the shared navigation labels, and console pages get both',()=>{
  const festival=run('fiiu',{withDash:false});
  for(const [lang,main,menu] of [['en','Main navigation','Menu'],['es','Navegación principal','Menú'],['pt','Navegação principal','Menu']]){
    festival.apply(lang,{persist:false});
    assert.equal(festival.t('nav.mainLabel'),main,lang);assert.equal(festival.t('nav.menuLabel'),menu,lang);
    assert.notEqual(festival.t('nav.languageLabel'),'nav.languageLabel',lang);assert.notEqual(festival.t('nav.accountLabel'),'nav.accountLabel',lang);
  }
  assert.equal(festival.t('d.title'),'d.title','without the file a console key is not translated');
  const console_=run('dashboard',{withDash:true});
  console_.apply('es',{persist:false});
  assert.equal(console_.t('d.title'),'NODAL · Panel de miembro');assert.equal(console_.t('nav.mainLabel'),'Navegación principal');
  assert.equal(console_.t('d.greet.hello'),'Hola');
  console_.apply('en',{persist:false});
  assert.equal(console_.t('d.aria.partC'),'Part C · profile depth','English console text still comes from the dictionary');
  console_.apply('pt',{persist:false});
  assert.equal(console_.t('ops.title'),'Mesa de publicação');
});
