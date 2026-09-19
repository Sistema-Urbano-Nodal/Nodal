import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import vm from 'node:vm';
import {renderPrivacyPage} from '../scripts/build-privacy-page.js';
import {createApp} from '../server/server.js';
import {createDatabase} from '../server/db.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('published policy matches reviewed source files with complete, linked translations and explicit draft status', async () => {
  const html = read('web/pages/privacy.html');
  assert.equal(html, await renderPrivacyPage(), 'regenerate the page after editing a policy');
  assert.doesNotMatch(html, /\{\{|\}\}|undefined/);
  const articles = [...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(articles.length, 3);
  for (const [ , lang, body] of articles) {
    assert.equal((body.match(/<section /g) || []).length, 12);
    assert.match(body, /class="policy-draft"/);
    for (let n = 1; n <= 12; n++) {
      assert.ok(body.includes(`id="${lang}-${n}"`));
      assert.ok(body.includes(`href="#${lang}-${n}"`));
    }
    assert.match(body, /href="index.html#contact"/);
  }
});

test('privacy page and all its resources are accessible without an account, including in the CDN build', async t => {
  const db = createDatabase({filename:':memory:'});
  const server = createApp({db});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/privacy.html', {redirect:'manual'});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const html = await response.text();
  assert.match(html, /<h1>Privacy policy<\/h1>/);
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|woff2|webp)(?:\?[^"#]*)?)"/g)].map(match => match[1]);
  for (const asset of assets) assert.equal((await fetch(base + '/' + asset)).status, 200, asset);
  const deployment = JSON.parse(read('vercel.json'));
  const policyHeaders = deployment.headers.find(route => new RegExp(`^${route.source}$`).test('/privacy.html'));
  assert.ok(policyHeaders.headers.some(({key,value}) => key === 'Content-Security-Policy' && value.includes("frame-ancestors 'none'")));
  assert.ok(policyHeaders.headers.some(({key,value}) => key === 'Cache-Control' && value.includes('public')));
});

function browser({saved='pt', cookie='', url='https://nodal.test/privacy.html#en-10', blocked=false}={}) {
  const storage = new Map(saved ? [['nodal.lang',saved]] : []);
  const events = new Map();
  const html = {lang:'en',dataset:{}};
  const buttons = ['en','es','pt'].map(lang => ({dataset:{lang}, attributes:{}, setAttribute(key,value){this.attributes[key]=value;}, addEventListener(name,fn){this[name]=fn;}}));
  const titles = {en:'Privacy policy',es:'Política de privacidad',pt:'Política de privacidade'};
  const scrolls = [];
  const document = {
    documentElement:html, cookie, readyState:'loading',
    addEventListener(){},
    querySelectorAll(selector){return selector==='[data-lang]' ? buttons : [];},
    querySelector(selector){
      if(selector==='[data-policy-label="language"]')return {setAttribute(){}};
      return {dataset:{title:titles[selector.match(/"(en|es|pt)"/)[1]]}};
    },
    getElementById(id){return {scrollIntoView(){scrolls.push(id);}};},
  };
  const window = {
    location:new URL(url),
    history:{state:null,replaceState(state,title,next){window.location=new URL(next,window.location);}},
    addEventListener(name,fn){events.set(name,[...(events.get(name)||[]),fn]);},
  };
  const context = vm.createContext({document,window,URL,URLSearchParams,localStorage:{
    getItem(key){if(blocked)throw Error('blocked'); return storage.get(key);},
    setItem(key,value){if(blocked)throw Error('blocked');storage.set(key,value);},
  }});
  vm.runInContext(read('web/scripts/locale.js'),context);
  const bootLanguage = html.lang;
  document.readyState='interactive';
  vm.runInContext(read('web/scripts/privacy.js'),context);
  return {document,window,html,storage,bootLanguage,scrolls,click:lang=>buttons.find(b=>b.dataset.lang===lang).click(),buttons,
    restore:()=>events.get('pageshow').forEach(fn=>fn({persisted:true}))};
}

test('saved language wins on arrival, switches persist, and deep links retain their policy section', () => {
  const h = browser({url:'https://nodal.test/privacy.html?lang=es#en-10'});
  assert.equal(h.bootLanguage, 'pt');
  assert.equal(h.html.lang, 'pt');
  assert.equal(h.document.title, 'NODAL · Política de privacidade');
  assert.equal(h.window.location.hash, '#pt-10');
  assert.equal(h.html.dataset.localePending, undefined);
  h.click('es');
  assert.equal(h.storage.get('nodal.lang'),'es');
  assert.match(h.document.cookie,/nodal.lang=es/);
  assert.equal(h.window.location.search,'?lang=es');
  assert.equal(h.window.location.hash,'#es-10');
  assert.equal(h.scrolls.at(-1),'es-10');
  assert.equal(h.buttons.find(b=>b.dataset.lang==='es').attributes['aria-pressed'],'true');
  const reload = browser({saved:h.storage.get('nodal.lang'),url:h.window.location.href});
  assert.equal(reload.document.title,'NODAL · Política de privacidad');
  h.storage.set('nodal.lang','en'); h.restore();
  assert.equal(h.html.lang,'en');
  assert.equal(h.document.title,'NODAL · Privacy policy');
  assert.equal(h.window.location.hash,'#en-10');
});

test('cookie language works when browser storage is blocked and first visits can choose a language through the URL', () => {
  const h = browser({saved:null,blocked:true,cookie:'nodal.lang=es'});
  assert.equal(h.html.lang,'es');
  h.click('pt');
  const reload = browser({saved:null,blocked:true,cookie:h.document.cookie});
  assert.equal(reload.html.lang,'pt');
  const first = browser({saved:null,url:'https://nodal.test/privacy.html?lang=pt'});
  assert.equal(first.bootLanguage,'pt');
});
