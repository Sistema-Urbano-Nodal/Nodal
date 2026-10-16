import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {Node,descendants,content,flush,key} from './helpers/fiiu-ui-harness.js';

/* BUC (Biblioteca Urbana Colaborativa, https://buc.sistemaurbano.org/) as NODAL's source of readings, in the browser: web/scripts/buc.js draws the
   readings that NODAL's GET /api/readings answers (built by the server lane, docs/superpowers/plans/2026-10-16-buc-readings.md), in the console's
   Learning band, the knowledge hub, FIIU session pages, course pages, and under chat messages that ask for readings. The route is stubbed here with
   answers in the contract's shape; nothing in these tests (or in buc.js) ever talks to BUC itself. */
const ROOT=path.resolve(import.meta.dirname,'..');
const read=(...parts)=>readFileSync(path.join(ROOT,...parts),'utf8');
const script=name=>read('web','scripts',name+'.js');

// Answers in the contract's shape: links into BUC's search (the feed off), and publications from the feed.
const LINKS={source:'links',items:[],links:[
 {label:'Movilidad',url:'https://buc.sistemaurbano.org/busqueda?c=7&utm_source=nodal&utm_medium=console',category:7},
 {label:'Inclusión',url:'https://buc.sistemaurbano.org/busqueda?q=vivienda&c=8&utm_source=nodal&utm_medium=console',category:8},
]};
const FEED={source:'feed',items:[
 {id:'1234',title:'Clima y resiliencia en la mirada urbana',authors:['Lima Cómo Vamos'],year:2025,country:'Perú',category:3,format:'Documento',url:'https://buc.sistemaurbano.org/publicacion/1234',summary:'Percepciones sobre cambio climático en Lima y Callao.'},
 {id:'88',title:'Calles para la infancia',authors:['Ocupa Tu Calle','Fundación Bernard van Leer','Urban95'],year:null,country:null,category:1,format:'Guía',url:'https://www.example.org/calles-infancia',summary:''},
],links:[{label:'Ver más en la BUC',url:'https://buc.sistemaurbano.org/busqueda?c=3&utm_source=nodal&utm_medium=console',category:3}]};
// The knowledge hub with no filters: every BUC category.
const CATEGORY_IDS=[1,2,3,4,5,6,7,8];
const ALL={source:'links',items:[],links:CATEGORY_IDS.map(id=>({label:'c'+id,url:'https://buc.sistemaurbano.org/busqueda?c='+id+'&utm_source=nodal&utm_medium=knowledge',category:id}))};
const NAMES={en:['Childhood','Public space','Environment','Methods','Culture','Governance','Mobility','Inclusion'],es:['Infancia','Espacio público','Ambiente','Metodologías','Cultura','Gobernanza','Movilidad','Inclusión'],pt:['Infância','Espaço público','Ambiente','Metodologias','Cultura','Governança','Mobilidade','Inclusão']};

const readingsOf=requests=>requests.map(r=>typeof r==='string'?r:r.path).filter(p=>String(p).startsWith('/api/readings?'));
const params=p=>Object.fromEntries(new URL(p,'https://nodal.test').searchParams);
const anchors=node=>descendants(node).filter(n=>n.tagName==='a');
const text=node=>content(node).replace(/\s+/g,' ').trim();

// A page with buc.js alone: a body to draw into, the language switch, and a stubbed fetch (a function answer gets the path; an Error is a lost connection).
function bucPage(respond=()=>LINKS,{lang='en'}={}){
 const body=new Node('body'),requests=[],listeners=[];
 const document={body,documentElement:{lang},createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx=vm.createContext({document,window:{nodalI18n:{lang,onChange:fn=>listeners.push(fn)}},URL,URLSearchParams,AbortSignal,
  fetch:async(path,options={})=>{requests.push({path,options});const r=await respond(path);if(r instanceof Error)throw r;return{ok:!r.status||r.status<400,status:r.status||200,json:async()=>{if(r.badJson)throw new SyntaxError('bad json');return r.data??r;}};}});
 vm.runInContext(script('buc'),ctx);
 const host=()=>{const n=new Node('section');n.hidden=true;body.append(n);return n;};
 return{ctx,body,Buc:ctx.window.Buc,requests,host,lang:l=>{ctx.window.nodalI18n.lang=l;listeners.forEach(fn=>fn(l));}};
}

/* ================= B1: the renderer ================= */

test('a readings block draws BUC search links named by category, in the reader’s language, under the page’s heading',async()=>{
 const p=bucPage();const host=p.host(),heading=new Node('h3');heading.textContent='Readings from BUC';
 const done=p.Buc.mount(host,{topics:['Mobility','Housing'],context:'console',heading});
 assert.equal(host.hidden,true,'nothing shows before the answer');
 assert.equal(await done,true);
 assert.equal(host.hidden,false);assert.equal(host.children[0],heading,'the page’s heading comes first');
 const [request]=readingsOf(p.requests);assert.deepEqual(params(request),{context:'console',topics:'Mobility,Housing'});
 assert.equal(p.requests[0].options.credentials,'omit','the readings read carries no cookie: it is the same public answer for everyone');
 const links=anchors(host);
 assert.deepEqual(links.map(a=>a.href),LINKS.links.map(l=>l.url),'the server’s BUC links, as they are (with their utm)');
 assert.ok(links.every(a=>a.target==='_blank'&&a.rel==='noopener noreferrer'),'BUC opens in its own tab');
 assert.deepEqual(links.map(text),['Mobility','Inclusion vivienda'],'a category link names its category, and the search words a topic adds');
 assert.equal(descendants(links[1]).find(n=>n.className==='buc-words').lang,'es','BUC’s search words are Spanish');
 p.lang('es');assert.deepEqual(links.map(text),['Movilidad','Inclusión vivienda']);
 p.lang('pt');assert.deepEqual(links.map(text),['Mobilidade','Inclusão vivienda']);
});

test('every BUC category id gets its name in English, Spanish and Portuguese, and a link with words only is a search',async()=>{
 for(const lang of ['en','es','pt']){
  const p=bucPage(()=>ALL,{lang}),host=p.host();await p.Buc.mount(host,{context:'knowledge'});
  assert.deepEqual(anchors(host).map(text),NAMES[lang],lang);
 }
 const words={source:'links',items:[],links:[{label:'Buscar',url:'https://buc.sistemaurbano.org/busqueda?q=calles+completas&utm_source=nodal&utm_medium=chat',category:null}]};
 const p=bucPage(()=>words,{lang:'es'}),host=p.host();await p.Buc.mount(host,{context:'chat',words:'calles completas'});
 assert.equal(text(anchors(host)[0]),'Buscar «calles completas» en la BUC');
 p.lang('en');assert.equal(text(anchors(host)[0]),'Search “calles completas” on BUC');
 p.lang('pt');assert.equal(text(anchors(host)[0]),'Buscar “calles completas” na BUC');
});

test('with BUC’s feed on, the block lists publications (title, authors, year, category) and one way to see more on BUC',async()=>{
 const p=bucPage(()=>FEED),host=p.host();assert.equal(await p.Buc.mount(host,{topics:['Climate & resilience'],context:'console'}),true);
 const items=host.querySelectorAll('.buc-item');assert.equal(items.length,2);
 const [first,second]=items.map(item=>item.querySelector('a'));
 assert.equal(first.href,'https://buc.sistemaurbano.org/publicacion/1234');assert.equal(first.textContent,'Clima y resiliencia en la mirada urbana');assert.equal(first.target,'_blank');
 assert.equal(second.href,'https://www.example.org/calles-infancia','a publication may live on its author’s portal');
 assert.equal(text(items[0].querySelector('.buc-meta')),'Lima Cómo Vamos 2025 Environment');
 assert.equal(text(items[1].querySelector('.buc-meta')),'Ocupa Tu Calle, Fundación Bernard van Leer et al. Childhood','two authors at most, and no year when there is none');
 const more=host.querySelector('.buc-more');assert.ok(more,'one way to see more');assert.equal(more.href,FEED.links[0].url);assert.equal(text(more),'See more on BUC');
 p.lang('es');assert.equal(text(more),'Ver más en la BUC');assert.equal(text(items[0].querySelector('.buc-meta')),'Lima Cómo Vamos 2025 Ambiente');
});

test('a readings block fails quietly: an outage, a lost connection, an odd answer or links that leave BUC draw nothing',async()=>{
 const answers=[{status:503,data:{error:'unavailable'}},{status:400,data:{code:'invalid_readings_query'}},new TypeError('Failed to fetch'),{badJson:true},{},[],{source:'other',items:[],links:LINKS.links},{source:'links',items:[],links:[]},
  {source:'links',items:[],links:[{label:'x',url:'https://evil.test/busqueda?c=7',category:7},{label:'x',url:'javascript:alert(1)',category:7},{label:'x',url:'http://buc.sistemaurbano.org/busqueda?c=7',category:7},{label:'x',url:'https://user:pw@buc.sistemaurbano.org/busqueda',category:7}]},
  {source:'feed',items:[{title:'Sin enlace',url:'',category:2},{title:'',url:'https://buc.sistemaurbano.org/publicacion/1',category:2},{title:'x'.repeat(301),url:'https://buc.sistemaurbano.org/publicacion/2',category:2},{title:'HTTP',url:'http://example.org/a',category:2}],links:[]}];
 for(const answer of answers){
  const p=bucPage(()=>answer),host=p.host();
  assert.equal(await p.Buc.mount(host,{topics:['Mobility'],context:'console'}),false,JSON.stringify(answer));
  assert.equal(host.hidden,true);assert.equal(host.children.length,0);
 }
});

test('one read per distinct query serves every block, a redraw with the same query keeps what is drawn, and a newer query wins',async()=>{
 const p=bucPage(),a=p.host(),b=p.host();
 await Promise.all([p.Buc.mount(a,{topics:['Mobility'],context:'console'}),p.Buc.mount(b,{topics:['Mobility'],context:'console'})]);
 assert.equal(readingsOf(p.requests).length,1,'two blocks, one query, one read');
 const drawn=a.children[0];await p.Buc.mount(a,{topics:['Mobility'],context:'console'});
 assert.equal(a.children[0],drawn,'the same query does not redraw');assert.equal(readingsOf(p.requests).length,1);
 // A slow first answer must not overwrite the block once a newer query was asked for.
 let release;const slow=new Promise(resolve=>{release=resolve;});
 const q=bucPage(path=>params(path).topics==='Mobility'?slow.then(()=>LINKS):ALL),host=q.host();
 const first=q.Buc.mount(host,{topics:['Mobility'],context:'console'});const second=q.Buc.mount(host,{topics:['Heritage'],context:'console'});
 assert.equal(await second,true);release();assert.equal(await first,false);
 assert.equal(anchors(host).length,8,'the newer answer stays');
});

test('a readings query sends only valid filters, in one order, with search words cut at 80 characters on a word',async()=>{
 const p=bucPage(),host=p.host();
 await p.Buc.mount(host,{topics:['Mobility',' ','Mobility','Housing'],categories:[0,3,'7',9,3,2.5],block:'day1-am',words:'  espacio   público '+'barrio '.repeat(20),limit:4,context:'session'});
 const [request]=readingsOf(p.requests),query=params(request);
 assert.deepEqual(Object.keys(query),['context','topics','categories','block','q','limit']);
 assert.equal(query.topics,'Mobility,Housing');assert.equal(query.categories,'3,7');assert.equal(query.block,'day1-am');assert.equal(query.limit,'4');
 assert.ok(query.q.length<=80&&query.q.startsWith('espacio público barrio')&&!query.q.endsWith(' ')&&query.q.split(' ').every(word=>['espacio','público','barrio'].includes(word)),query.q);
 const odd=bucPage(),other=odd.host();await odd.Buc.mount(other,{block:'../x',limit:40,context:'nowhere',topics:'Mobility'});
 assert.deepEqual(params(readingsOf(odd.requests)[0]),{},'no block, limit, context or topics that are not what the contract takes');
});

test('the shared BUC strings carry English, Spanish and Portuguese',()=>{
 const {Buc}=bucPage();
 for(const [name,values] of Object.entries(Buc.rows))assert.ok(values.length===3&&values.every(v=>typeof v==='string'&&v.trim()),name);
 CATEGORY_IDS.forEach((id,i)=>assert.deepEqual([...Buc.rows['cat'+id]],[NAMES.en[i],NAMES.es[i],NAMES.pt[i]],'category '+id));
});

/* ================= B1: the console's Learning band ================= */

const dash=()=>{const ctx={window:{}};vm.runInNewContext(script('i18n-dashboard'),ctx);return ctx.window.NODAL_I18N_DASH;};
// One piece of dashboard.js: from its opening line to the next section marker.
function piece(source,opening,closing){const start=source.indexOf(opening),end=source.indexOf(closing,start+opening.length);assert.ok(start>=0&&end>start,`${opening.trim()} must stay discoverable in dashboard.js`);return source.slice(start,end);}
// The readings section of dashboard.js, run against buc.js and the console's real dictionary, with the band's markup from dashboard.html.
function consoleBand({topics=[],lang='en',respond=()=>LINKS}={}){
 const p=bucPage(respond,{lang}),nodes={bucReadings:new Node('section'),bucReadingsSub:new Node('p'),bucReadingsBody:new Node('div')};
 nodes.bucReadings.hidden=true;nodes.bucReadings.append(nodes.bucReadingsSub,nodes.bucReadingsBody);p.body.append(nodes.bucReadings);
 p.ctx.document.getElementById=id=>nodes[id]||null;p.ctx.dict=dash()[lang];
 const section=piece(script('dashboard'),'  /* ================= BUC readings','  /* ================= recognition');
 vm.runInContext(`const t=(key)=>dict[key]??key;const byId=(id)=>document.getElementById(id);let U=${JSON.stringify({topics})};\n${section}\nglobalThis.render=()=>renderReadings();globalThis.setTopics=(list)=>{U.topics=list;};`,p.ctx,{filename:'dashboard-readings.js'});
 return{...p,nodes,setTopics:list=>p.ctx.setTopics(list),render:async()=>{p.ctx.render();await flush();}};
}
const topic=(name,level=1)=>({name,level,validatedAt:0,endorsedAt:0});

test('the console’s Learning band reads BUC for the member’s topics, highest rated first and three at most',async()=>{
 const band=consoleBand({topics:[topic('Housing'),topic('Mobility',3),topic('Care & gender',2),topic('Heritage')]});
 await band.render();
 const [request]=readingsOf(band.requests);assert.deepEqual(params(request),{context:'console',topics:'Mobility,Care & gender,Housing',limit:'4'});
 assert.equal(band.nodes.bucReadings.hidden,false);assert.equal(anchors(band.nodes.bucReadingsBody).length,2);
 assert.equal(band.nodes.bucReadingsSub.dataset.i18n,'d.buc.sub');assert.equal(band.nodes.bucReadingsSub.textContent,dash().en['d.buc.sub']);
 await band.render();assert.equal(readingsOf(band.requests).length,1,'the console redraws often; the readings are read once');
});

test('before any topic is chosen the band offers one way into BUC and reads nothing; a failed read hides the band',async()=>{
 const band=consoleBand();await band.render();
 assert.equal(readingsOf(band.requests).length,0);assert.equal(band.nodes.bucReadings.hidden,false);
 const links=anchors(band.nodes.bucReadingsBody);assert.equal(links.length,1);
 assert.equal(links[0].href,'https://buc.sistemaurbano.org/?utm_source=nodal&utm_medium=console');assert.equal(text(links[0]),'Explore BUC');assert.equal(links[0].target,'_blank');
 assert.equal(band.nodes.bucReadingsSub.dataset.i18n,'d.buc.subNoTopics');
 band.lang('es');assert.equal(text(links[0]),'Explora la BUC');
 // Topics chosen, then all removed, then chosen again: each state draws its own content.
 band.setTopics([topic('Mobility')]);await band.render();assert.equal(anchors(band.nodes.bucReadingsBody).length,2);
 band.setTopics([]);await band.render();assert.equal(anchors(band.nodes.bucReadingsBody).length,1);
 band.setTopics([topic('Mobility')]);await band.render();assert.equal(anchors(band.nodes.bucReadingsBody).length,2,'the readings come back');
 const down=consoleBand({topics:[topic('Mobility')],respond:()=>({status:503,data:{}})});await down.render();
 assert.equal(down.nodes.bucReadings.hidden,true,'no readings, no band');
});

test('dashboard.html carries the readings block in the Learning band, hidden until there is something to show, and the console draws it',()=>{
 const html=read('web','pages','dashboard.html'),growth=html.slice(html.indexOf('id="growth"'),html.indexOf('id="badges"'));
 assert.match(growth,/<section class="buc-readings" id="bucReadings"[^>]*\bhidden\b/);
 assert.match(growth,/id="bucReadingsTitle" data-i18n="d\.buc\.title"/);assert.match(growth,/id="bucReadingsSub"[^>]*data-i18n="d\.buc\.sub"/);assert.match(growth,/id="bucReadingsBody"/);
 assert.match(piece(script('dashboard'),'  function applyAll() {','\n  }\n'),/renderReadings\(\);/);
 const d=dash();for(const lang of ['en','es','pt'])for(const name of ['d.buc.title','d.buc.sub','d.buc.subNoTopics'])assert.ok(d[lang][name]?.trim(),`${lang} ${name}`);
 assert.equal(d.es['d.buc.title'],'Lecturas de la BUC');
});

/* ================= B1: the knowledge hub ================= */

// knowledge.html: fiiu-ui.js, buc.js and fiiu-hubs.js drawing into #fiiuHub.
async function knowledgeHub(respond=()=>ALL,{lang='en'}={}){
 const body=new Node('body'),hub=new Node('div'),status=new Node('p'),requests=[],listeners=[];hub.dataset.hub='knowledge';body.append(status,hub);
 const document={body,documentElement:{lang},getElementById:id=>({fiiuHub:hub,fiiuStatus:status})[id]||null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx=vm.createContext({document,window:{nodalI18n:{lang,onChange:fn=>listeners.push(fn)}},Intl,Date,Error,URL,URLSearchParams,AbortSignal,
  fetch:async path=>{requests.push(path);const r=await respond(path);return{ok:!r.status||r.status<400,status:r.status||200,json:async()=>r.data??r};}});
 for(const name of ['fiiu-ui','buc','fiiu-hubs'])vm.runInContext(script(name),ctx);await flush();
 return{hub,requests,lang:l=>{ctx.window.nodalI18n.lang=l;listeners.forEach(fn=>fn(l));}};
}

test('the knowledge hub has a Biblioteca Urbana Colaborativa block with BUC’s eight categories as links',async()=>{
 const h=await knowledgeHub(path=>path.startsWith('/api/readings?')?ALL:{status:404,data:{}});
 const [request]=readingsOf(h.requests);assert.deepEqual(params(request),{context:'knowledge',limit:'6'},'no filters: every category');
 const block=h.hub.querySelector('.f-buc');assert.ok(block,'the library block');assert.equal(block.hidden,false);
 assert.ok(h.hub.querySelector('.f-hub-grid').children.includes(block),'it sits with the hub’s other blocks');
 assert.equal(block.children[0].tagName,'h2');assert.equal(block.children[0].dataset.fiiuText,'bucLibrary');assert.ok(key(block,'bucLibraryHint'));
 assert.deepEqual(anchors(block).map(text),NAMES.en);assert.ok(anchors(block).every(a=>a.href.startsWith('https://buc.sistemaurbano.org/busqueda?')));
 h.lang('es');assert.deepEqual(anchors(block).map(text),NAMES.es);
 const down=await knowledgeHub(()=>({status:503,data:{}}));const none=down.hub.querySelector('.f-buc');
 assert.ok(!none||none.hidden,'no answer, no block');assert.ok(down.hub.querySelector('.f-hub-card'),'the rest of the hub is untouched');
});

/* ================= B1: strings and script tags ================= */

test('the festival and course pages carry their BUC headings in three languages',()=>{
 const fiiu={window:{},document:{documentElement:{},querySelectorAll:()=>[]}};vm.runInNewContext(script('fiiu-ui'),fiiu);
 for(const name of ['bucReadings','bucLibrary','bucLibraryHint'])assert.ok(fiiu.window.Fiiu.rows[name]?.length===3,name);
 assert.equal(fiiu.window.Fiiu.rows.bucReadings[1],'Lecturas de la BUC');
 const pilot={window:{}};vm.runInNewContext(script('pilot-i18n'),pilot);assert.ok(pilot.window.pilotI18n.rows.bucReadings?.length===3);
});

test('every page with readings loads buc.js with its own cache key, after i18n.js and before the script that uses it',()=>{
 const consumers={'dashboard.html':'dashboard.js','knowledge.html':'fiiu-hubs.js','fiiu-session.html':'fiiu-talk.js','fiiu-talk.html':'fiiu-talk.js','course.html':'courses.js','courses.html':'courses.js'};
 for(const [page,consumer] of Object.entries(consumers)){
  const html=read('web','pages',page),files=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]);
  const buc=files.findIndex(f=>/^buc\.js\?v=\d{8}[a-z]$/.test(f));
  assert.ok(buc>=0,`${page} loads buc.js with a ?v= key`);
  assert.match(html,/<script defer src="buc\.js\?v=/,`${page}: deferred, like the rest`);
  assert.ok(files.findIndex(f=>f.startsWith('i18n.js?'))<buc,`${page}: buc.js follows the language switch`);
  assert.ok(buc<files.findIndex(f=>f.startsWith(consumer+'?')),`${page}: buc.js comes before ${consumer}`);
 }
});
