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

function browser({saved='pt', cookie='', url='https://nodal.test/privacy.html#en-10', blocked=false, navigator}={}) {
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
  },...(navigator ? {navigator} : {})});
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

test('a first visit reads the policy in the browser language without saving it, and a click saves the choice', () => {
  const h = browser({saved:null,navigator:{languages:['es-PE','es']}});
  assert.equal(h.html.lang,'es');
  assert.equal(h.document.title,'NODAL · Política de privacidad');
  assert.equal(h.window.location.hash,'#es-10');
  assert.equal(h.storage.size,0);
  assert.equal(h.document.cookie,'');
  h.restore();
  assert.equal(h.storage.size,0);
  assert.equal(h.document.cookie,'');
  h.click('en');
  assert.equal(h.storage.get('nodal.lang'),'en');
  assert.equal(h.storage.get('nodal.lang.chosen'),'1');
  assert.equal(h.document.title,'NODAL · Privacy policy');
});

test('festival conversations are described in every language: their data row after the festival, who sees them and what account deletion does', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  for (const [lang, festival, row, audience, deletion] of [
    ['en', 'FIIU festival', 'FIIU conversations', 'People registered for the FIIU festival', 'In FIIU conversations'],
    ['es', 'Festival FIIU', 'Conversaciones del FIIU', 'Personas inscritas en el festival FIIU', 'En las conversaciones del FIIU'],
    ['pt', 'Festival FIIU', 'Conversas do FIIU', 'Pessoas inscritas no festival FIIU', 'Nas conversas do FIIU'],
  ]) {
    assert.equal((articles[lang].match(/<section /g) || []).length, 12, lang);
    const rowOf = category => table.indexOf(`<tr role="row"><td role="cell">${category}</td>`);
    const table = section(lang, 2), before = rowOf(festival), at = rowOf(row);
    assert.ok(before > -1 && at > before, `${lang}: the conversations row follows the festival row`);
    assert.equal(table.slice(before, at).match(/<tr[\s>]/g).length, 1, `${lang}: directly after it`);
    assert.ok(section(lang, 4).includes(`<strong>${audience}:</strong>`), `${lang}: section 4 names who sees the messages`);
    assert.ok(section(lang, 9).includes(deletion), `${lang}: section 9 says what account deletion does to them`);
  }
  // The row promises only what the chat page does: authors keep and can delete their hidden messages, and after cancelling (the page then needs a
  // registration, which may be closed) the way to remove them is deleting the account, not registering again.
  for (const [lang, hidden, own, cancel, never] of [
    ['en', 'it then stays visible only to you and to administrators', 'You can delete your own messages, including hidden ones', 'after canceling, the way to remove them is deleting your account', 'registering again'],
    ['es', 'desde entonces solo lo ven tú y los administradores', 'Puedes eliminar tus propios mensajes, también los ocultos', 'Después de cancelar, la forma de borrarlos es eliminar tu cuenta', 'volver a inscribirte'],
    ['pt', 'a partir daí, só você e os administradores a veem', 'Você pode excluir suas próprias mensagens, inclusive as ocultas', 'Depois de cancelar, a forma de removê-las é excluir sua conta', 'se inscrever de novo'],
  ]) {
    const table = section(lang, 2);
    for (const phrase of [hidden, own, cancel]) assert.ok(table.includes(phrase), `${lang}: ${phrase}`);
    assert.ok(!table.includes(never), `${lang}: no promise the page cannot keep`);
  }
});

test('rating answers and one-off festival notices are described in every language', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const table = lang => articles[lang].match(new RegExp(`<section id="${lang}-2">([\\s\\S]*?)</section>`))[1];
  for (const [lang, ratings, notices] of [
    ['en', 'Rating answers are stored with your account so you can change them, and are only ever shown as anonymous totals.', 'We record one-off festival notices sent to you, so nobody receives the same one twice.'],
    ['es', 'Las valoraciones se guardan con tu cuenta para que puedas cambiarlas, y solo se muestran como totales anónimos.', 'Registramos los avisos puntuales del festival que te enviamos, para que nadie reciba el mismo dos veces.'],
    ['pt', 'As avaliações são guardadas com a sua conta para que você possa alterá-las, e só aparecem como totais anônimos.', 'Registramos os avisos pontuais do festival enviados a você, para que ninguém receba o mesmo duas vezes.'],
  ]) {
    assert.ok(table(lang).includes(ratings), `${lang}: ratings`);
    assert.ok(table(lang).includes(notices), `${lang}: notices`);
  }
});

test('Mercado Pago is named, in every language, as the processor of the Supporting membership payments', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const providers = lang => articles[lang].match(new RegExp(`<section id="${lang}-7">([\\s\\S]*?)</section>`))[1];
  for (const [lang, sentence] of [
    ['en', 'Mercado Pago processes the Supporting membership payments: you pay on its page and give your payment details to Mercado Pago, never to NODAL.'],
    ['es', 'Mercado Pago procesa los pagos de la membresía de apoyo: pagas en su página y entregas tus datos de pago a Mercado Pago, nunca a NODAL.'],
    ['pt', 'O Mercado Pago processa os pagamentos da assinatura de apoio: você paga na página dele e entrega seus dados de pagamento ao Mercado Pago, nunca à NODAL.'],
  ]) assert.ok(providers(lang).includes(sentence), lang);
});

test('Sentry is named, in every language, as the recipient of technical server error reports, and what it never receives', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const providers = lang => articles[lang].match(new RegExp(`<section id="${lang}-7">([\\s\\S]*?)</section>`))[1];
  for (const [lang, receives, never] of [
    ['en', 'When error tracking is on, Sentry receives technical reports about server errors', 'It never receives passwords, cookies, form contents or IP addresses.'],
    ['es', 'Cuando el seguimiento de errores está activo, Sentry recibe informes técnicos sobre errores del servidor', 'Nunca recibe contraseñas, cookies, contenidos de formularios ni direcciones IP.'],
    ['pt', 'Quando o rastreamento de erros está ativo, o Sentry recebe relatórios técnicos sobre erros do servidor', 'Ele nunca recebe senhas, cookies, conteúdos de formulários nem endereços IP.'],
  ]) { assert.ok(providers(lang).includes(receives), lang); assert.ok(providers(lang).includes(never), lang + ' never'); }
});

// The stylesheet's rules, with the media query each sits in ('' at the top level).
function cssRules(css) {
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i); if (open === -1) break;
      const head = text.slice(i, open).trim();
      if (head.startsWith('@media')) {
        let depth = 1, j = open + 1;
        for (; depth && j < text.length; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
        walk(text.slice(open + 1, j - 1), head); i = j;
      } else {
        const close = text.indexOf('}', open);
        rules.push({media, selectors: head.split(',').map(s => s.trim()), body: text.slice(open + 1, close)}); i = close + 1;
      }
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  return rules;
}
const declarations = (rules, selector, media) => rules.filter(rule => rule.selectors.includes(selector) && media(rule.media)).map(rule => rule.body).join(';');

test('on phones the data table reflows at body size, and the policy links and buttons are full touch targets', () => {
  const css = read('web/styles/privacy.css'), rules = cssRules(css);
  const phone = media => /max-width:\s*600px/.test(media);
  // Each row stacks: the category over its explanation, full width, instead of a 99px column of 13px text broken mid-word.
  for (const element of ['table', 'tbody', 'tr', 'td']) assert.match(declarations(rules, element, phone), /display:\s*block/, element);
  assert.match(declarations(rules, 'thead', phone), /position:\s*absolute/, 'the header row stays for screen readers only');
  assert.doesNotMatch(declarations(rules, 'thead', phone), /display:\s*none/);
  const cells = declarations(rules, 'td', phone) + ';' + declarations(rules, 'td:first-child', phone);
  assert.doesNotMatch(cells, /font-size:\s*1[0-4]px|overflow-wrap:\s*anywhere/, 'no shrunken text or broken words');
  assert.match(declarations(rules, 'td:first-child', phone), /width:\s*auto/);
  // Phone-sized or touch: every target is at least 44px.
  const touch = media => phone(media) || /pointer:\s*coarse/.test(media);
  for (const selector of ['.policy-contents a', '.policy-languages button', '.policy-home', '.policy-footer a', '.policy-top']) {
    assert.match(declarations(rules, selector, touch), /min-height:\s*44px/, selector);
  }
  assert.match(declarations(rules, '.policy-contents a', touch), /display:\s*(?:block|flex)/);
  assert.match(declarations(rules, '.policy-languages button', touch), /min-width:\s*44px/);
  assert.doesNotMatch(declarations(rules, '.policy-home', phone), /font-size:\s*1[0-2]px/);
  assert.doesNotMatch(css, /border-left/, 'no left accent bars');
});

/* On phones the stacked rows use display:block, which can strip a table's semantics (Safari and VoiceOver), and the
   visually hidden header row then names no cell. Explicit roles keep the table, its rows, headers and cells. */
test('the data table keeps explicit table roles, so its stacked phone layout is still read as a table', async () => {
  const html = read('web/pages/privacy.html');
  const count = pattern => (html.match(pattern) || []).length;
  const tables = count(/<table[\s>]/g);
  assert.ok(tables >= 3, 'one table per language at least');
  assert.equal(count(/<table role="table">/g), tables);
  assert.equal(count(/<thead role="rowgroup">/g), tables);
  assert.equal(count(/<tbody role="rowgroup">/g), tables);
  assert.equal(count(/<tr role="row">/g), count(/<tr[\s>]/g));
  assert.equal(count(/<th role="columnheader" scope="col">/g), count(/<th[\s>]/g));
  assert.equal(count(/<td role="cell">/g), count(/<td[\s>]/g));
});
