import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {Node,descendants,content,flush,key,createFiiuHarness} from './helpers/fiiu-ui-harness.js';
import {BUC_VOCABULARY} from '../server/buc.js';

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
],links:[{label:'Ver más en la BUC',url:'https://buc.sistemaurbano.org/busqueda?c=3&utm_source=nodal&utm_medium=console',category:3,words:'',more:true}]};
// The knowledge hub with no filters: every BUC category.
const CATEGORY_IDS=[1,2,3,4,5,6,7,8];
const ALL={source:'links',items:[],links:CATEGORY_IDS.map(id=>({label:'c'+id,url:'https://buc.sistemaurbano.org/busqueda?c='+id+'&utm_source=nodal&utm_medium=knowledge',category:id}))};
const NAMES={en:['Childhood','Public space','Environment','Methods','Culture','Governance','Mobility','Inclusion'],es:['Infancia','Espacio público','Ambiente','Metodologías','Cultura','Gobernanza','Movilidad','Inclusión'],pt:['Infância','Espaço público','Ambiente','Metodologias','Cultura','Governança','Mobilidade','Inclusão']};

const readingsOf=requests=>requests.map(r=>typeof r==='string'?r:r.path).filter(p=>String(p).startsWith('/api/readings?'));
const params=p=>Object.fromEntries(new URL(p,'https://nodal.test').searchParams);
const anchors=node=>descendants(node).filter(n=>n.tagName==='a');
const text=node=>content(node).replace(/\s+/g,' ').trim();

// A page with buc.js alone: a body to draw into, the language switch, and a stubbed fetch (a function answer gets the path; an Error is a lost connection).
// now: a clock for the page (Date.now), when a test moves time.
function bucPage(respond=()=>LINKS,{lang='en',now=null}={}){
 const body=new Node('body'),requests=[],listeners=[];
 const document={body,documentElement:{lang},createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx=vm.createContext({document,window:{nodalI18n:{lang,onChange:fn=>listeners.push(fn)}},URL,URLSearchParams,AbortSignal,...(now?{Date:class extends Date{static now(){return now();}}}:{}),
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
 assert.deepEqual(links.map(text),['Mobility','Inclusion · vivienda'],'a category link names its category, and the search words a topic adds');
 assert.equal(descendants(links[1]).find(n=>n.className==='buc-words').lang,'es','BUC’s search words are Spanish');
 p.lang('es');assert.deepEqual(links.map(text),['Movilidad','Inclusión · vivienda']);
 p.lang('pt');assert.deepEqual(links.map(text),['Mobilidade','Inclusão · vivienda']);
});

test('every BUC category id gets its name in English, Spanish and Portuguese, and a link with words only is a search',async()=>{
 for(const lang of ['en','es','pt']){
  const p=bucPage(()=>ALL,{lang}),host=p.host();await p.Buc.mount(host,{context:'knowledge'});
  assert.deepEqual(anchors(host).map(text),NAMES[lang],lang);
 }
 const words={source:'links',items:[],links:[{label:'Buscar',url:'https://buc.sistemaurbano.org/busqueda?q=espacio+p%C3%BAblico&utm_source=nodal&utm_medium=chat',category:null}]};
 const p=bucPage(()=>words,{lang:'es'}),host=p.host();await p.Buc.mount(host,{context:'chat',words:'espacio público'});
 assert.equal(text(anchors(host)[0]),'Buscar «espacio público» en la BUC');
 p.lang('en');assert.equal(text(anchors(host)[0]),'Search “espacio público” on BUC');
 p.lang('pt');assert.equal(text(anchors(host)[0]),'Buscar “espacio público” na BUC');
});

test('with BUC’s feed on, the block lists publications (title, authors, year, category) and one way to see more on BUC',async()=>{
 const p=bucPage(()=>FEED),host=p.host();assert.equal(await p.Buc.mount(host,{topics:['Climate & resilience'],context:'console'}),true);
 const items=host.querySelectorAll('.buc-item');assert.equal(items.length,2);
 const [first,second]=items.map(item=>item.querySelector('a'));
 assert.equal(first.href,'https://buc.sistemaurbano.org/publicacion/1234');assert.equal(first.textContent,'Clima y resiliencia en la mirada urbana');assert.equal(first.target,'_blank');
 assert.equal(second.href,'https://www.example.org/calles-infancia','a publication may live on its author’s portal');
 assert.equal(text(items[0].querySelector('.buc-meta')),'Lima Cómo Vamos · 2025 · Environment');
 assert.equal(text(items[1].querySelector('.buc-meta')),'Ocupa Tu Calle, Fundación Bernard van Leer et al. · Childhood','two authors at most, and no year when there is none');
 const more=host.querySelector('.buc-more');assert.ok(more,'one way to see more');assert.equal(more.href,FEED.links[0].url);assert.equal(text(more),'See more on BUC');
 p.lang('es');assert.equal(text(more),'Ver más en la BUC');assert.equal(text(items[0].querySelector('.buc-meta')),'Lima Cómo Vamos · 2025 · Ambiente');
});

test('with the feed on and nothing asked for, the publications come with BUC’s eight categories as a list of their own; “see more” is the server’s word',async()=>{
 const everything={source:'feed',items:FEED.items,links:ALL.links},p=bucPage(()=>everything),host=p.host();
 assert.equal(await p.Buc.mount(host,{context:'knowledge',limit:6}),true);
 const [items,links]=host.querySelectorAll('.buc-list');
 assert.equal(items.className,'buc-list is-items');assert.equal(links?.className,'buc-list is-links','the categories are a list, not links run together');
 assert.equal(host.children.length,2);assert.ok(links.children.every(li=>li.tagName==='li'&&li.children.length===1&&li.children[0].tagName==='a'),'one link per item');
 assert.deepEqual(anchors(links).map(text),NAMES.en);assert.equal(host.querySelector('.buc-more'),null,'no category is taken for “see more”');
 // One link is not “see more” unless the server says so.
 const one={source:'feed',items:FEED.items,links:[{label:'Movilidad',url:'https://buc.sistemaurbano.org/busqueda?c=7&utm_source=nodal&utm_medium=console',category:7}]};
 const q=bucPage(()=>one),h=q.host();await q.Buc.mount(h,{topics:['Mobility'],context:'console'});
 assert.equal(h.querySelector('.buc-more'),null);assert.deepEqual(anchors(h.querySelector('.is-links')).map(text),['Mobility']);
 const chat=bucPage(()=>everything),line=chat.host();await chat.Buc.suggest(line,'¿Algún libro sobre movilidad?',{block:'day1-am'});
 assert.deepEqual(anchors(line).map(text),FEED.items.map(item=>item.title),'a suggestion line takes the publications, and the server’s “see more” only');
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

test('a failed read is asked again a minute later, not before, by the next block or redraw; an answer is kept for the life of the page',async()=>{
 let now=Date.parse('2026-10-21T09:30:00-05:00'),down=true;
 const p=bucPage(()=>down?{status:429,data:{error:'rate_limited'}}:LINKS,{now:()=>now}),host=p.host(),filters={topics:['Mobility'],context:'console'};
 assert.equal(await p.Buc.mount(host,filters),false);assert.equal(readingsOf(p.requests).length,1);
 down=false;now+=30000;
 assert.equal(await p.Buc.mount(host,filters),false,'a redraw within the minute');const other=p.host();assert.equal(await p.Buc.mount(other,filters),false,'or another block');
 assert.equal(readingsOf(p.requests).length,1,'asks nothing again');
 now+=31000;assert.equal(await p.Buc.mount(host,filters),true,'61 s after the failure, the same query is read once more');assert.equal(host.hidden,false);assert.equal(anchors(host).length,2);
 assert.equal(await p.Buc.mount(other,filters),true,'and every block shares that answer');assert.equal(readingsOf(p.requests).length,2);
 down=true;now+=3600000;assert.equal(await p.Buc.mount(p.host(),filters),true,'an answer is kept');assert.equal(readingsOf(p.requests).length,2);
 const empty=bucPage(()=>({source:'links',items:[],links:[]}),{now:()=>now}),party={block:'day1-pm',context:'session'};
 assert.equal(await empty.Buc.mount(empty.host(),party),false);now+=61000;assert.equal(await empty.Buc.mount(empty.host(),party),false);
 assert.equal(readingsOf(empty.requests).length,1,'an answer with nothing to show is an answer too');
 // A line under a message: the same.
 const chat=bucPage(()=>down?new TypeError('Failed to fetch'):CHAT,{now:()=>now}),slot=chat.host();
 assert.equal(await chat.Buc.suggest(slot,ASK,{block:'day1-am'}),false);down=false;
 now+=59000;assert.equal(await chat.Buc.suggest(chat.host(),ASK,{block:'day1-am'}),false);assert.equal(chatReadings(chat.requests).length,1);
 now+=2000;assert.equal(await chat.Buc.suggest(slot,ASK,{block:'day1-am'}),true);assert.equal(chatReadings(chat.requests).length,2);assert.equal(slot.hidden,false);
});

test('a readings query sends only valid filters, in one order, and a q only as the vocabulary writes it',async()=>{
 const p=bucPage(),host=p.host();
 await p.Buc.mount(host,{topics:['Mobility',' ','Mobility','Housing'],categories:[0,3,'7',9,3,2.5],block:'day1-am',words:'  ESPACIO   publico ',limit:4,context:'session'});
 const [request]=readingsOf(p.requests),query=params(request);
 assert.deepEqual(Object.keys(query),['context','topics','categories','block','q','limit']);
 assert.equal(query.topics,'Mobility,Housing');assert.equal(query.categories,'3,7');assert.equal(query.block,'day1-am');assert.equal(query.limit,'4');
 assert.equal(query.q,'espacio público');
 // Any other words are never sent: the server would refuse them, and they could be someone's name.
 for(const words of ['calles completas','llamo juan pérez','vivienda social','housing']){
  const other=bucPage(),h=other.host();await other.Buc.mount(h,{categories:[6],words,context:'session'});
  assert.deepEqual(params(readingsOf(other.requests)[0]),{context:'session',categories:'6'},words);
 }
 const odd=bucPage(),other=odd.host();await odd.Buc.mount(other,{block:'../x',limit:40,context:'nowhere',topics:'Mobility'});
 assert.deepEqual(params(readingsOf(odd.requests)[0]),{},'no block, limit, context or topics that are not what the contract takes');
});

test('the browser carries the same vocabulary as the server, the one list of what may be searched on BUC',()=>{
 const {Buc}=bucPage();
 assert.deepEqual(JSON.parse(JSON.stringify(Buc.vocabulary)),JSON.parse(JSON.stringify(BUC_VOCABULARY)),'web/scripts/buc.js and server/buc.js list the same entries, in the same order');
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

/* ================= B2: FIIU session pages ================= */

const Q='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIVITY={id:'day1-am',title:'El poder de lo local',date:'2026-10-21',time:'09:00–13:00',venue:'Auditorio MALI, Cercado de Lima',sessions:[['09:00–10:00','¡Bienvenidos al FIIU 11!']],registration:'general',period:'morning'};
const GENERAL={id:'general',period:'general',title:'FIIU General',date:null,time:'',venue:'',sessions:[],registration:'general-space'};
const question=(over={})=>({id:Q,activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'¿Qué te llevas de esta mañana?',status:'open',revision:3,messageCount:2,createdAt:'2026-10-21T13:55:00.000Z',...over});
const message=(id,over={})=>({id,author:'Ana T.',organiser:false,mine:false,body:'Hola a todas',files:[],likeCount:0,liked:false,createdAt:'2026-10-21T14:05:00.000Z',seq:1,...over});
const thread=(messages,over={})=>({question:question(over.question),activity:over.activity||ACTIVITY,messages,before:null,revision:3,me:{draftKey:'viewer-ana',organiser:false,canPost:true}});
const SESSION_LINKS={source:'links',items:[],links:[{label:'Gobernanza',url:'https://buc.sistemaurbano.org/busqueda?c=6&utm_source=nodal&utm_medium=session',category:6}]};
// A clock frozen on the festival's first morning, as the conversation tests use.
const clock=(iso='2026-10-21T09:30:00-05:00')=>{const at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};};
/* fiiu-session.html: fiiu-ui.js and buc.js through the festival harness, then fiiu-talk.js. routes answer 'METHOD path'; readings(path) answers every
   /api/readings read. Unknown requests are 404s. */
async function sessionPage({routes={},readings=()=>SESSION_LINKS,search='?a=day1-am',messages=[message('10000000-0000-4000-8000-000000000001')],activity=ACTIVITY}={}){
 const id=activity.id,table={['GET /api/fiiu/questions?activityId='+id]:{activity,questions:[question({activityId:id})]},['GET /api/fiiu/questions/'+Q]:thread(messages,{activity,question:{activityId:id}}),
  'GET /api/fiiu/pulse':{questions:[[Q,id,3,'open']]},'GET /api/fiiu?kind=news':{event:{id:'fiiu-2026',title:'FIIU Fest 11',activities:[ACTIVITY]},config:{registrationOpen:true}},
  'GET /api/fiiu/registration':{user:{id:'u-ana'},registration:null,attendance:[],isAdmin:false},...routes};
 let n=0;
 const h=await createFiiuHarness(request=>{if(request.path.startsWith('/api/readings?'))return readings(request.path);const answer=table[request.method+' '+request.path];return answer===undefined?{status:404,data:{error:'not found'}}:typeof answer==='function'?answer(request):answer;},
  {page:'buc',search,pathname:'/fiiu-session.html',context:{Date:clock(),crypto:{randomUUID:()=>'cccccccc-cccc-4ccc-8ccc-'+String(n++).padStart(12,'0')}}});
 vm.runInContext(script('fiiu-talk'),h.ctx);await flush();
 return h;
}
const sessionReadings=h=>readingsOf(h.requests).filter(p=>params(p).context==='session');

test('a session page shows a short “Lecturas de la BUC” fold under the session details, asked for by the block alone',async()=>{
 const h=await sessionPage();
 assert.deepEqual(sessionReadings(h).map(params),[{context:'session',block:'day1-am',limit:'3'}],'the block’s BUC categories stay on the server');
 const head=h.root.querySelector('.f-talk-session'),fold=head.querySelector('.f-talk-readings');
 assert.ok(fold,'the readings fold');assert.equal(fold.tagName,'details');assert.equal(fold.hidden,false);
 assert.equal(fold.children[0].tagName,'summary');assert.equal(fold.children[0].dataset.fiiuText,'bucReadings');
 assert.deepEqual(anchors(fold).map(a=>[text(a),a.href]),[['Governance',SESSION_LINKS.links[0].url]]);
 const order=head.children;assert.ok(order.indexOf(fold)>order.indexOf(head.querySelector('.f-talk-talks')),'after the talks');assert.ok(order.indexOf(fold)<order.indexOf(head.querySelector('.f-talk-mine')),'before the person’s status');
 h.lang('es');assert.equal(fold.children[0].textContent,'Lecturas de la BUC');assert.equal(text(anchors(fold)[0]),'Gobernanza');
});

test('General asks for the session context with no filters, and a session page without readings shows no fold',async()=>{
 const general=await sessionPage({search:'?a=general',activity:GENERAL});
 assert.deepEqual(sessionReadings(general).map(params),[{context:'session',limit:'3'}],'every category');
 const down=await sessionPage({readings:()=>({status:503,data:{}})});
 const fold=down.root.querySelector('.f-talk-readings');assert.ok(!fold||fold.hidden,'nothing to fold');
 assert.ok(down.root.querySelector('.f-talk-session').querySelector('h1'),'the session details still show');
});

/* ================= B2: course pages ================= */

// A DOM node for the course pages, as tests/courses-ui.test.js has it (after, firstElementChild and nextElementSibling, and string children).
class CNode{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.hidden=false;this.textContent='';this.value='';this.files=[];this.classList={toggle(){}};}
 append(...nodes){nodes.forEach(n=>{if(typeof n==='object'){cdetach(n);n.parent=this;}this.children.push(n);});}
 prepend(...nodes){nodes.forEach(n=>{cdetach(n);n.parent=this;});this.children.unshift(...nodes);}
 after(node){const p=this.parent;if(p){cdetach(node);node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
 get firstElementChild(){return this.children.find(n=>typeof n==='object')||null;}
 get nextElementSibling(){const siblings=this.parent?.children.filter(n=>typeof n==='object')||[],at=siblings.indexOf(this);return at<0?null:siblings[at+1]||null;}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this[k]=v;}getAttribute(k){return this[k]??null;}removeAttribute(k){delete this[k];}addEventListener(k,f){this.listeners[k]=f;}
 querySelectorAll(selector){return cdescendants(this).filter(n=>selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):selector===n.tagName);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){this.focused=true;}scrollIntoView(){}
}
const cdescendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...cdescendants(n)]:[]);
const cdetach=node=>{if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);};
const MOBILITY={id:'c1',title:'Curso Movilidad Nivel 2',description:'Piloto NODAL: observación en campo.',startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true};
const COURSE_LINKS={source:'links',items:[],links:[{label:'Movilidad',url:'https://buc.sistemaurbano.org/busqueda?c=7&utm_source=nodal&utm_medium=course',category:7}]};
/* course.html?id=c1: pilot-i18n.js, pilot.js, buc.js and courses.js. The course is enrolled with its intake done, one session module, and posts for its
   discussion; readings(path) answers every /api/readings read. */
async function coursePage({course=MOBILITY,posts=[],readings=()=>COURSE_LINKS,lang='en'}={}){
 const body=new CNode('body');body.dataset.page='course';const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new CNode();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[];
 const document={body,documentElement:new CNode('html'),readyState:'loading',createElement:t=>new CNode(t),getElementById:id=>ids[id]||cdescendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const respond=path=>{
  if(path.startsWith('/api/readings?'))return readings(path);
  if(path==='/api/auth/me')return{user:{permission:'member'}};if(path.endsWith('/events'))return{ok:true};
  if(path.split('?')[0].endsWith('/posts'))return{posts,nextCursor:null};
  if(path.endsWith('/modules/m1'))return{module:{id:'m1',title:'Session',description:'Learning',resources:[]}};
  return{course,modules:[{id:'m1',title:'Session',sessionDate:'2026-09-09'}],enrollment:{},intake:{fullName:'Member'},isAdmin:false};
 };
 const ctx=vm.createContext({document,console,Intl,URL,URLSearchParams,Error,Date,AbortSignal,confirm:()=>true,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},
  location:{pathname:'/course.html',search:'?id=c1',href:'https://nodal.test/course.html?id=c1',assign(){},replace(){}},
  fetch:async(path,opts)=>{requests.push({path,method:opts?.method});const r=await respond(path);return{ok:!r.status||r.status<400,status:r.status||200,json:async()=>r.data??r};},
  window:{addEventListener(){},nodalI18n:{lang,onChange:f=>listeners.push(f)}}});
 for(const name of ['pilot-i18n','pilot','buc','courses'])vm.runInContext(script(name),ctx);
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 return{body,root:ids.pilotRoot,requests,lang:l=>{ctx.window.nodalI18n.lang=l;listeners.forEach(f=>f(l));}};
}
const courseReadings=h=>readingsOf(h.requests).filter(p=>params(p).context==='course');

test('a course page shows readings from BUC for the course’s topic, under the course header',async()=>{
 const h=await coursePage();
 assert.deepEqual(courseReadings(h).map(params),[{context:'course',topics:'Mobility',limit:'3'}],'Curso Movilidad is the Mobility topic');
 const hero=h.root.querySelector('.pilot-course-hero'),block=h.root.querySelector('.pilot-buc');
 assert.ok(block,'the readings block');assert.equal(block.hidden,false);
 assert.equal(h.root.children[h.root.children.indexOf(hero)+1],block,'right under the course header');
 assert.equal(block.children[0].tagName,'h2');assert.equal(block.children[0].dataset.pilotText,'bucReadings');
 assert.deepEqual(anchors(block).map(text),['Mobility']);
 h.lang('pt');assert.deepEqual(anchors(block).map(text),['Mobilidade']);
});

test('a course’s topic is read from its title in any of its languages; a title naming no topic, or a failed read, shows no readings',async()=>{
 const translated=await coursePage({course:{...MOBILITY,title:'Pilot course',translations:{es:{title:'Curso de espacio público'},pt:{title:'Curso de espaço público'}}}});
 assert.deepEqual(courseReadings(translated).map(q=>params(q).topics),['Public space']);
 const several=await coursePage({course:{...MOBILITY,title:'Vivienda, clima y movilidad'}});
 assert.deepEqual(courseReadings(several).map(q=>params(q).topics),['Mobility,Housing,Climate & resilience'],'in the console’s topic order');
 const none=await coursePage({course:{...MOBILITY,title:'Taller de fotografía'}});
 assert.equal(courseReadings(none).length,0);assert.equal(none.root.querySelector('.pilot-buc'),null);
 const down=await coursePage({readings:()=>({status:503,data:{}})});
 const block=down.root.querySelector('.pilot-buc');assert.ok(!block||block.hidden,'no readings, no block');
});

/* ================= B3: suggestions when members ask each other for readings ================= */

test('a message asks for readings when it names a reading and asks in the same sentence, or asks what to read, in Spanish, English or Portuguese',()=>{
 const {Buc}=bucPage();
 const asking=['¿Qué libros me recomiendan sobre movilidad?','Alguna BIBLIOGRAFÍA sobre gobernanza','Recomendaciones de lectura para el bloque','¿Qué me recomiendan leer antes del taller?',
  '¿Me recomiendas algo para leer sobre vivienda?','¿LIBROS SOBRE VIVIENDA?','Any good books on public space?','Suggested readings for tomorrow?','What would you recommend I read on housing?',
  'What should I read first?','Any e-books?','Alguém indica livros sobre mobilidade?','Quais leituras vocês sugerem?','Tem bibliografia sobre patrimônio?','O que vocês recomendam ler sobre clima?',
  // What to read, asked without naming a reading.
  '¿Qué deberíamos leer antes del laboratorio?','¿Qué debería leer sobre asentamientos informales?','¿Qué puedo leer sobre gobernanza local?','¿Qué leo sobre gobernanza local?',
  '¿Qué me sugieren leer sobre clima?','¿Algo para leer sobre clima?','Quisiera leer más sobre caminabilidad, ¿alguna sugerencia?','No sé qué leer sobre vivienda',
  'O que devo ler sobre assentamentos informais?','O que posso ler sobre governança local?','Algo pra ler sobre mobilidade?',
  'Anything to read on climate adaptation?','Any suggestions on what to read about climate?','Something to read before the lab?','What can we read before the lab?',
  // A reading named with an ask: a question, or a word that asks the others.
  'Busco lecturas sobre movilidad','¿Algún texto sobre gobernanza?','Algún artículo sobre clima','¿Hay libros sobre el centro histórico?','Hay libros sobre vivienda?','¿Tienen la bibliografía de la sesión?',
  'Me pasan las lecturas de hoy','Compartan sus libros favoritos sobre Lima','Does anyone know of a book on urban forests','Can anyone recommend readings on informal settlements?',
  'Any papers on mobility?','Is there a reading list for this session?','Please suggest a book on walkability','Algum artigo sobre mobilidade?','Alguma indicação de leitura sobre clima?',
  'Procuro livros sobre moradia','Vocês indicam algum texto sobre cuidado?',
  // "Any" opening a request needs no question mark; a bibliography; a request with its pronoun attached; recommendations asked for, for books.
  'Any books on housing','Hi all, any readings on public space','Is there a bibliography for the lab?','Does anyone have the bibliography from this morning?','Any bibliography on housing?',
  'Recomiéndame un libro sobre movilidad','Recomiéndenme lecturas sobre vivienda','Sugiéranme textos sobre vivienda','I need recommendations for books on mobility',
  "I'd appreciate suggestions for readings on housing",'Quiero leer sobre vivienda, ¿alguna recomendación?',
  // A festival errand next to a request is still a request; a book named after an article is a book.
  'La lectura del QR falla, pero ¿alguien recomienda libros sobre movilidad?','Can we book the room? Also, any readings on housing?','Any book the speaker mentioned?','Who has the book a friend of mine wrote on Lima?'];
 const not=['Hola a todas','¡Gracias por la charla!','La lectora de QR no funciona','Reservé por Booking','Lo vi en Facebook','Hay que leer el contexto local','I read the agenda twice',
  'Livre acesso ao parque','La librería del centro cierra a las 8','Obrigado pela leitora de QR','Bookstore at the corner','Tenemos que leer el acta',
  // The festival's errands: the QR check-in, the venue's complaints book, the minutes, booking a taxi or a room, reading the agenda.
  'No me funciona la lectura del QR','La lectura del código QR falla en la puerta','Hagan la lectura del acta, por favor','¿Dónde está el libro de reclamaciones del MALI?','Firmen el libro de visitas',
  'Leí el libro de actas','Who wants to book a taxi?','Can we book the room?','I’ll book tickets for everyone','Let’s book seats near the front',"I'm reading the agenda now",'We are reading the programme',
  'A leitura do QR não funciona','Onde fica o livro de reclamações?','¿Quién trajo el libro de firmas?','¿A qué hora empieza la lectura de conclusiones?','¿Cuándo es la lectura del acuerdo?',
  '¿Dónde está la sala de lectura?','Is the reading room open?',
  // A reading named without an ask: an interpretation, a launch, a thanks, a finished reading, an answer recommending a book.
  'LIBRO','Gracias por la lectura del acuerdo','Mi lectura de la sesión es que faltó hablar de financiamiento','La ponente dio una lectura muy política del proceso',
  'Presentaremos el libro el jueves a las 6pm en el MALI','Ya terminé de leer la bibliografía, gracias!','Comparto mi lectura del caso de la estación Naranjal',
  'Te recomiendo el libro Muerte y vida de las grandes ciudades','I recommend the book Happy City','We’d recommend the reading on page 4','Recomendo o livro Cidades para Pessoas',
  'Somos un book club','La lectura dramatizada empieza a las 5','O lançamento do livro é amanhã','the reading room is on floor 2','Mis recomendaciones de lectura: Jacobs y Gehl',
  'I would recommend the book Happy City',"I'd strongly recommend Jacobs's book",'We also suggest the reading on page 4','Thanks for the recommendations of books!',
  // An obligation, a plural quantifier, or "there are" stated, not asked: the venue's news, and answers to an organiser's "¿qué libro te inspiró?".
  'Hay que leer el libro de Jacobs antes del taller','Tienen que leer el texto antes del taller','Tienes que leer este libro','Temos que ler o livro antes da oficina',
  'Algunas lecturas de la mañana me parecieron muy densas','Algunos libros estarán a la venta en el stand de Sistema Urbano','Alguns livros estão na mesa da entrada',
  'Hay libros gratis en la mesa de Sistema Urbano','En el stand hay libros de la PUCP con descuento','Hay libros sobre el centro histórico',
  'Hay un libro de Gehl que me cambió la forma de ver la ciudad','Algunos libros de Jacobs, sobre todo Muerte y vida','Hay muchos libros buenos, pero me quedo con Jacobs',
  'Bring any book you like to the swap table',"We don't have any readings for today",
  // A question about a book's launch, price or sale, a lost book, an article of the rules, or paper for the workshop: the venue's, not a reading's.
  '¿A qué hora es la presentación del libro?','What time is the book launch?','A que horas começa o lançamento do livro?','Alguém sabe a data do lançamento do livro?',
  '¿Vienen a la presentación de nuestro libro?','Where is the book stand?','¿Cuánto cuesta el libro de la editorial?','How much is the book?','Quanto custa o livro?',
  '¿Alguien vio mi libro? Lo dejé en la sala 2','Has anyone seen my book? I left it in room 2','Alguien dejó un libro en la sala 2','Alguém esqueceu um livro na mesa',
  'Where can I buy the book?','¿Dónde puedo comprar el libro?','Onde compro o livro?','Is there paper and markers for the workshop?','¿Qué dice el artículo 5 del reglamento?',
  'Where do I book?',
  // A reading word in an address, or reading as a verb, asked or not.
  'Miren esto: https://fondoeditorial.pucp.edu.pe/libros/ciudad-y-territorio','Les dejo el link: https://books.google.com.pe/books?id=abc','Todo en www.lecturas-urbanas.pe y biblio@libros.pe',
  "Who's reading the minutes?",'Reading the comments, I think we agree','Are you reading this?',
  '',null,undefined,42];
 for(const text of asking)assert.equal(Buc.asks(text),true,text);
 for(const text of not)assert.equal(Buc.asks(text),false,String(text));
});

const ASK='¿Qué libros me recomiendan sobre movilidad en Lima?';
// The answer for ASK in the day1-am chat: its q in the q's own category, the block's category whole, then the q across BUC.
const CHAT={source:'links',items:[],links:[
 {label:'Movilidad',url:'https://buc.sistemaurbano.org/busqueda?q=movilidad&c=7&utm_source=nodal&utm_medium=chat',category:7},
 {label:'Gobernanza',url:'https://buc.sistemaurbano.org/busqueda?q=&c=6&utm_source=nodal&utm_medium=chat',category:6},
 {label:'Buscar',url:'https://buc.sistemaurbano.org/busqueda?q=movilidad&c=&utm_source=nodal&utm_medium=chat',category:null},
]};
const chatReadings=requests=>readingsOf(requests).filter(p=>params(p).context==='chat');
const M=n=>'10000000-0000-4000-8000-00000000000'+n;
const folded=value=>decodeURIComponent(String(value).replace(/\+/g,' ')).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();

test('a suggestion never sends the message’s words: it asks for the vocabulary topic the message names, with the block’s categories',async()=>{
 // [message, what is asked besides the block, words of the message that must not travel]
 const cases=[[ASK,{categories:'7',q:'movilidad'},['lima','libros','recomiendan']],
  ['Me llamo Juan Pérez, ¿me recomiendan lecturas sobre movilidad?',{categories:'7',q:'movilidad'},['llamo','juan','perez']],
  ['Hola, soy María López, ¿me recomiendan libros sobre vivienda?',{categories:'8',q:'vivienda'},['soy','maria','lopez']],
  ['Sou Pedro Alves, alguém recomenda livros sobre mobilidade?',{categories:'7',q:'movilidad'},['pedro','alves','mobilidade']],
  ['I am John Smith, any books on housing?',{categories:'8',q:'vivienda'},['john','smith','housing']],
  ['Meu nome é Ana Souza, algum livro sobre mobilidade?',{categories:'7',q:'movilidad'},['nome','ana','souza']],
  ['Soy María Fernández de la Municipalidad de Surco, ¿alguien tiene la bibliografía de la sesión?',{},['maria','fernandez','municipalidad','surco']],
  ['Hi Sarah, any book recommendations on public space and housing?',{categories:'2,8',q:'espacio público'},['sarah','housing']],
  ['Alguma indicação de leitura sobre clima?',{categories:'3',q:'clima'},['indicacao','leitura']],
  ['Can anyone recommend readings on informal settlements?',{categories:'8',q:'asentamientos'},['informal','settlements']],
  ['¿Alguna lectura sobre patrimonio y cultura?',{categories:'5',q:'histórico'},['patrimonio','cultura']],
  // "data" is a date in Portuguese and in Spanish "de larga data": no topic. Urban data is one.
  ['Alguém indica um livro para ler antes da data do workshop?',{},['data','workshop']],['Llevo de larga data en vivienda: ¿algún libro?',{categories:'8',q:'vivienda'},['larga','data']],
  ['Any books on urban data?',{categories:'4',q:'datos'},['urban','books']],
  // Contact details are taken out before the topics are looked for: a site, a handle or an address names nothing.
  ['¿Algún libro sobre vivienda? mi web juanperez.pe, IG juanperez.arq, juan_perez_arq',{categories:'8',q:'vivienda'},['juanperez','arq','perez']],
  ['¿Algún libro? Sígueme en @movilidad_lima o en movilidad.pe',{},['movilidad','sigueme']],
  ['¿Alguna bibliografía? https://example.org/vivienda',{},['vivienda','example']],
  ['¿Alguna bibliografía? mi IG: juanperezlima',{},['juanperezlima']],
  ['¿Algún libro sobre vivienda? Escríbanme a juan arroba gmail punto com o al +51 987 654 321',{categories:'8',q:'vivienda'},['juan','arroba','gmail','987']],
  // A request naming no topic asks for the block's categories alone, so no filler or name becomes a search.
  ['¿Dónde puedo encontrar el libro que mencionó Jan Gehl?',{},['gehl','puedo','encontrar']],
  ['¿Me recomiendan libros sobre calidad de vida?',{},['calidad','vida']],
  ['Hola Dora, ¿me pasas la bibliografía que mencionaste?',{},['dora','pasas','mencionaste']],
  ['Is there a reading list for this session?',{},['list','session']]];
 for(const [message,asked,parts] of cases){
  const p=bucPage(()=>CHAT),host=p.host();assert.equal(await p.Buc.suggest(host,message,{block:'day1-am'}),true,message);
  const requests=chatReadings(p.requests);assert.equal(requests.length,1,message);
  assert.deepEqual(params(requests[0]),{context:'chat',...(asked.categories?{categories:asked.categories}:{}),block:'day1-am',...(asked.q?{q:asked.q}:{}),limit:'3'},message);
  for(const part of parts)assert.ok(!folded(requests[0]).includes(part)||part===folded(asked.q||'-'),`${message}: “${part}” must not be in ${requests[0]}`);
 }
 const p=bucPage(()=>CHAT),host=p.host();assert.equal(await p.Buc.suggest(host,'Hola a todas',{block:'day1-am'}),false);
 assert.equal(p.requests.length,0,'a message that does not ask reads nothing');assert.equal(host.hidden,true);
});

test('the line names the topic asked about in the reader’s language, never the person’s own words',async()=>{
 const line=async(message,answer,filters={block:'day1-am'},lang='es')=>{const p=bucPage(()=>answer,{lang}),host=p.host();await p.Buc.suggest(host,message,filters);return{p,host,label:()=>text(host.querySelector('.buc-suggest-label')),links:()=>anchors(host).map(text)};};
 const housing={source:'links',items:[],links:[{label:'Inclusión',url:'https://buc.sistemaurbano.org/busqueda?q=vivienda&c=8&utm_source=nodal&utm_medium=chat',category:8},
  {label:'Gobernanza',url:'https://buc.sistemaurbano.org/busqueda?q=&c=6&utm_source=nodal&utm_medium=chat',category:6},{label:'Buscar',url:'https://buc.sistemaurbano.org/busqueda?q=vivienda&c=&utm_source=nodal&utm_medium=chat',category:null}]};
 const asked=await line('Hola, soy María López, ¿me recomiendan libros sobre viviendas sociales?',housing);
 assert.equal(asked.label(),'Sugerencias de la BUC sobre «vivienda»');assert.deepEqual(asked.links(),['Inclusión','Gobernanza','Buscar «vivienda» en la BUC'],'the q is said once, by the line');
 asked.p.lang('en');assert.equal(asked.label(),'BUC suggestions on “housing”');assert.deepEqual(asked.links(),['Inclusion','Governance','Search “vivienda” on BUC']);
 asked.p.lang('pt');assert.equal(asked.label(),'Sugestões da BUC sobre “moradia”');
 assert.doesNotMatch(content(asked.host),/María|López|sociales/);
 // An English question in an English page.
 const english=await line('Any books on housing, please?',housing,{block:'day1-am'},'en');assert.equal(english.label(),'BUC suggestions on “housing”');
 // No topic named: the plain label over the block's categories.
 const plain=await line('¿Dónde puedo encontrar el libro que mencionó Jan Gehl?',{source:'links',items:[],links:[SESSION_LINKS.links[0]]});
 assert.equal(plain.label(),'Sugerencias de la BUC');assert.deepEqual(plain.links(),['Gobernanza']);
 // With the feed, publications matched to the q are about the topic too.
 const feed=await line('¿Algún libro sobre clima?',{source:'feed',items:[FEED.items[0]],links:[{label:'Ver más',url:'https://buc.sistemaurbano.org/busqueda?q=clima&c=3&utm_source=nodal&utm_medium=chat',category:3,more:true}]});
 assert.equal(feed.label(),'Sugerencias de la BUC sobre «clima»');assert.deepEqual(feed.links(),[FEED.items[0].title,'Ver más en la BUC']);
});

test('under a FIIU chat message asking for readings, a quiet “Sugerencias de la BUC” line, once per message, never under a hidden one',async()=>{
 let revision=3;
 const messages=[message(M(1)),message(M(2),{author:'Beto Q.',body:ASK,seq:2,createdAt:'2026-10-21T14:06:00.000Z'}),message(M(3),{body:'¿Alguna bibliografía sobre esto?',hidden:true,mine:true,seq:3,createdAt:'2026-10-21T14:07:00.000Z'}),
  message(M(4),{author:'Dora P.',body:ASK,seq:4,createdAt:'2026-10-21T14:08:00.000Z'})];
 const h=await sessionPage({messages,readings:path=>params(path).context==='chat'?CHAT:SESSION_LINKS,routes:{
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET /api/fiiu/questions/'+Q+'/messages?since=3']:{revision:4,changes:[{...messages[1],likeCount:1,seq:5}],question:question({revision:4})}}});
 const rowOf=id=>h.root.querySelectorAll('.f-talk-msg').find(node=>node.dataset.id===id),lines=id=>rowOf(id).querySelectorAll('.buc-suggest');
 assert.deepEqual(chatReadings(h.requests).map(params),[{context:'chat',categories:'7',block:'day1-am',q:'movilidad',limit:'3'}],'two messages asking the same: one read');
 assert.equal(lines(M(1)).length,0,'not under a message that does not ask');assert.equal(lines(M(3)).length,0,'never under a hidden message');
 assert.equal(lines(M(2)).length,1);assert.equal(lines(M(4)).length,1);
 const row=rowOf(M(2)),slot=row.querySelector('.f-talk-buc');
 assert.ok(row.children.indexOf(slot)>row.children.indexOf(row.querySelector('.f-talk-body'))&&row.children.indexOf(slot)<row.children.indexOf(row.querySelector('.f-talk-actions')),'under the message, above its actions');
 const line=lines(M(2))[0];assert.equal(text(line.querySelector('.buc-suggest-label')),'BUC suggestions on “mobility”');
 assert.deepEqual(anchors(line).map(a=>[text(a),a.href]),[['Mobility',CHAT.links[0].url],['Governance',CHAT.links[1].url],['Search “movilidad” on BUC',CHAT.links[2].url]],'the topic is said once, in the line');
 assert.ok(!h.requests.some(r=>r.method!=='GET'),'nothing is posted: the line is not a message');
 // A live update redraws the row; the new row gets its line from the read already made.
 revision=4;await h.tickTimers();await flush();
 assert.equal(rowOf(M(2)).querySelector('.f-talk-like-n').textContent,'1','the row was redrawn');
 assert.equal(lines(M(2)).length,1);assert.equal(chatReadings(h.requests).length,1,'still one read');
 h.lang('es');const again=lines(M(2))[0];
 assert.equal(text(again.querySelector('.buc-suggest-label')),'Sugerencias de la BUC sobre «movilidad»');assert.deepEqual(anchors(again).map(text),['Movilidad','Gobernanza','Buscar «movilidad» en la BUC']);
 h.lang('pt');assert.equal(text(again.querySelector('.buc-suggest-label')),'Sugestões da BUC sobre “mobilidade”');
});

// document.activeElement as a browser keeps it: the node focused last while it is still in the page, else the body; contains() as the DOM answers it.
function watchFocus(h){
 let active=null;const {focus}=Node.prototype;
 Node.prototype.focus=function(...args){focus.apply(this,args);active=this;};
 Node.prototype.contains=function(node){return node===this||descendants(this).includes(node);};
 Object.defineProperty(h.ctx.document,'activeElement',{configurable:true,get:()=>active&&descendants(h.body).includes(active)?active:h.body});
 return{restore(){Node.prototype.focus=focus;delete Node.prototype.contains;}};
}

test('a live update that redraws a message keeps focus on the suggestion link the reader was on',async()=>{
 let revision=3;
 const messages=[message(M(2),{author:'Dora P.',body:ASK,seq:2})];
 const h=await sessionPage({messages,readings:path=>params(path).context==='chat'?CHAT:SESSION_LINKS,routes:{
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET /api/fiiu/questions/'+Q+'/messages?since=3']:{revision:4,changes:[{...messages[0],likeCount:1,seq:5}],question:question({revision:4})}}});
 const focus=watchFocus(h);
 try{
  const rowOf=()=>h.root.querySelectorAll('.f-talk-msg').find(node=>node.dataset.id===M(2)),before=rowOf(),[,,search]=before.querySelectorAll('.buc-link');
  search.focus();assert.equal(h.ctx.document.activeElement,search);
  // Beto likes the message: the next poll replaces its row, whose line is drawn again from the read already made.
  revision=4;await h.tickTimers();await flush();
  const after=rowOf();assert.notEqual(after,before,'the row was redrawn');assert.equal(after.querySelector('.f-talk-like-n').textContent,'1');
  const links=after.querySelectorAll('.buc-link');assert.equal(links.length,3);
  assert.equal(h.ctx.document.activeElement,links[2],'the same link, in the new row');assert.equal(text(links[2]),'Search “movilidad” on BUC');
 }finally{focus.restore();}
});

test('a request with nothing to search on (no words, no block, no topic) reads nothing and points into BUC itself',async()=>{
 for(const filters of [{},{topics:[]},{topics:[' '],categories:[0],block:'../x'}]){
  const p=bucPage(()=>CHAT),host=p.host();assert.equal(await p.Buc.suggest(host,'¿Alguna bibliografía?',filters),true,JSON.stringify(filters));
  assert.equal(readingsOf(p.requests).length,0,'the server would refuse a chat query with nothing in it');assert.equal(host.hidden,false);
  const links=anchors(host);assert.equal(links.length,1);assert.equal(links[0].href,'https://buc.sistemaurbano.org/?utm_source=nodal&utm_medium=chat');assert.equal(links[0].target,'_blank');
  assert.equal(text(host.querySelector('.buc-suggest-label')),'BUC suggestions');assert.equal(text(links[0]),'Explore BUC');
  p.lang('es');assert.equal(text(host),'Sugerencias de la BUC Explora la BUC');
  const line=host.children[0];await p.Buc.suggest(host,'¿Alguna bibliografía?',filters);assert.equal(host.children[0],line,'drawn again, the same line');
 }
 const general=await sessionPage({search:'?a=general',activity:GENERAL,messages:[message(M(2),{body:'¿Alguna bibliografía?'})]});
 assert.equal(chatReadings(general.requests).length,0);assert.deepEqual(anchors(general.root.querySelector('.f-talk-buc')).map(text),['Explore BUC']);
});

test('a chat suggestion fails quietly, and General’s messages ask with no block',async()=>{
 const down=await sessionPage({messages:[message(M(2),{body:ASK})],readings:path=>params(path).context==='chat'?{status:503,data:{}}:SESSION_LINKS});
 const slot=down.root.querySelector('.f-talk-buc');assert.ok(slot);assert.equal(slot.hidden,true);assert.equal(slot.children.length,0);
 const general=await sessionPage({search:'?a=general',activity:GENERAL,messages:[message(M(2),{body:'Any books on public space?'})],readings:path=>params(path).context==='chat'?CHAT:SESSION_LINKS});
 assert.deepEqual(chatReadings(general.requests).map(params),[{context:'chat',categories:'2',q:'espacio público',limit:'3'}]);
});

test('under a course discussion contribution asking for readings, BUC suggestions for the course’s topic; none for a submission or once withdrawn',async()=>{
 const post=(id,over)=>({id,authorName:'Ana',staff:false,createdAt:'2026-09-05T12:00:00Z',kind:'question',body:'Discuss this territory',links:[],attachments:[],canEdit:false,canDelete:false,...over});
 const posts=[post('p1'),post('p2',{body:'¿Alguna bibliografía sobre planificación urbana?',createdAt:'2026-09-05T12:01:00Z'}),post('p3',{kind:'comment',parentId:'p2',body:'Yo también busco libros sobre planificación.',createdAt:'2026-09-05T12:02:00Z'}),
  post('p4',{kind:'assignment',body:'Mi entrega: lecturas del barrio',createdAt:'2026-09-05T12:03:00Z'})];
 const answer={source:'links',items:[],links:[{label:'Metodologías',url:'https://buc.sistemaurbano.org/busqueda?q=planificaci%C3%B3n&c=4&utm_source=nodal&utm_medium=chat',category:4},
  {label:'Movilidad',url:'https://buc.sistemaurbano.org/busqueda?q=&c=7&utm_source=nodal&utm_medium=chat',category:7},{label:'Buscar',url:'https://buc.sistemaurbano.org/busqueda?q=planificaci%C3%B3n&c=&utm_source=nodal&utm_medium=chat',category:null}]};
 const h=await coursePage({posts,readings:path=>params(path).context==='chat'?answer:COURSE_LINKS});
 const card=id=>cdescendants(h.body).find(n=>n.id==='post-'+id),lines=id=>card(id).querySelectorAll('.buc-suggest');
 assert.deepEqual(chatReadings(h.requests).map(params),[{context:'chat',topics:'Mobility',categories:'4',q:'planificación',limit:'3'}],'two contributions asking the same: one read');
 assert.equal(lines('p1').length,0);assert.equal(lines('p2').length,1);assert.equal(lines('p3').length,1);assert.equal(lines('p4').length,0,'a submission is not a request');
 const c=card('p2'),slot=c.querySelector('.pilot-post-buc');assert.ok(c.children.indexOf(slot)<c.children.indexOf(c.querySelector('.pilot-post-actions')),'above the contribution’s actions');
 assert.equal(text(lines('p2')[0].querySelector('.buc-suggest-label')),'BUC suggestions on “planning”');assert.deepEqual(anchors(lines('p2')[0]).map(text),['Methods','Mobility','Search “planificación” on BUC']);
 h.lang('es');assert.equal(text(lines('p2')[0].querySelector('.buc-suggest-label')),'Sugerencias de la BUC sobre «planificación»');
 c.updatePost({...posts[1],deleted:true});await flush();
 assert.equal(lines('p2').length,0,'a withdrawn contribution keeps no suggestion');assert.equal(slot.hidden,true);
});
