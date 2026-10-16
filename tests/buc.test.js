import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {BUC_CATEGORIES,TOPIC_TO_BUC,BLOCK_TO_BUC,BUC_VOCABULARY,BUC_FEED_LIMITS,READINGS_FEED_WAIT_MS,bucLinks,vocabularyEntry,foldText,createBucFeed,bucFeedFromEnv,bucReadings} from '../server/buc.js';
import {ALL_FIIU_ACTIVITIES} from '../server/fiiu-domain.js';
import {GENERAL_SPACE} from '../server/fiiu-talk-domain.js';
import {createApp} from '../server/server.js';
import {createDatabase} from '../server/db.js';
import {createRepository} from '../server/repository.js';

/* BUC (https://buc.sistemaurbano.org/) is never contacted from these tests: links are only strings, and the feed reader
   runs on fake fetches with fixtures. */
const SEARCH='https://buc.sistemaurbano.org/busqueda';
const params=link=>Object.fromEntries(new URL(link.url).searchParams);

test('the eight BUC categories carry their Spanish names under BUC ids', () => {
  assert.deepEqual({...BUC_CATEGORIES},{1:'Infancia',2:'Espacio público',3:'Ambiente',4:'Metodologías',5:'Cultura',6:'Gobernanza',7:'Movilidad',8:'Inclusión'});
});

test('every NODAL topic maps onto a BUC category and, where BUC finds it there, the topic’s own Spanish word', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TOPIC_TO_BUC).map(([name,{category,words}])=>[name,[category,words]])),{
    'Mobility':[7,''],
    'Public space':[2,''],
    'Housing':[8,'vivienda'],
    'Climate & resilience':[3,'clima'],
    'Care & gender':[8,'género'],
    'Governance & participation':[6,''],
    'Safety':[2,'seguridad'],
    // BUC finds nothing for "informalidad" or "patrimonio" (checked by hand), so these open the whole category.
    'Informality':[8,''],
    'Heritage':[5,''],
    'Urban data & tech':[4,'datos'],
    'Land use & planning':[4,'planificación'],
    'Environment & nature':[3,''],
  });
  // A topic's word is one the vocabulary checked against BUC, in the same category.
  for(const [name,{category,words}] of Object.entries(TOPIC_TO_BUC))
    if(words)assert.equal(vocabularyEntry(words)?.category,category,name);
});

/* ---------------------------------------------------------------- the vocabulary */

const entryOf=term=>BUC_VOCABULARY.find(entry=>entry.terms.some(own=>foldText(own)===foldText(term)));

test('the vocabulary: each entry has its ES/EN/PT terms, one BUC category, a Spanish q and a name in each language', () => {
  assert.ok(BUC_VOCABULARY.length>=16);
  const terms=new Set(),queries=new Set();
  for(const entry of BUC_VOCABULARY){
    assert.deepEqual(Object.keys(entry).sort(),['category','label','q','terms'],entry.q);
    assert.ok(Object.hasOwn(BUC_CATEGORIES,entry.category),entry.q);
    assert.ok(Array.isArray(entry.terms)&&entry.terms.length>=3,entry.q);
    for(const term of entry.terms){
      assert.ok(typeof term==='string'&&term===term.trim()&&term===term.toLowerCase()&&/^[\p{L} ]+$/u.test(term),term);
      assert.ok(!terms.has(foldText(term)),`${term} is in one entry only`);terms.add(foldText(term));
    }
    assert.equal(typeof entry.q,'string');
    if(entry.q){assert.ok(entry.q.length<=40&&/^[\p{L} ]+$/u.test(entry.q),entry.q);assert.ok(!queries.has(foldText(entry.q)),entry.q);queries.add(foldText(entry.q));}
    // The name the line shows, in English, Spanish and Portuguese, is one of the entry's own terms (accents aside: "patrimonio" is also "patrimônio").
    assert.equal(entry.label.length,3,entry.q);
    for(const name of entry.label)assert.ok(entry.terms.some(own=>foldText(own)===foldText(name)),`${name} is a term of its entry`);
  }
  assert.ok(Object.isFrozen(BUC_VOCABULARY)&&BUC_VOCABULARY.every(entry=>Object.isFrozen(entry)&&Object.isFrozen(entry.terms)&&Object.isFrozen(entry.label)));
});

test('the vocabulary covers the twelve NODAL topics and the festival’s themes, in Spanish, English and Portuguese, singular and plural', () => {
  // Each NODAL topic's English words find an entry in the topic's own BUC category.
  const topicWords={'Mobility':['mobility'],'Public space':['public space'],'Housing':['housing'],'Climate & resilience':['climate','resilience'],'Care & gender':['care','gender'],
    'Governance & participation':['governance','participation'],'Safety':['safety'],'Informality':['informality'],'Heritage':['heritage'],'Urban data & tech':['urban data','technology'],
    'Land use & planning':['land use','planning'],'Environment & nature':['environment','nature']};
  assert.deepEqual(Object.keys(topicWords).sort(),Object.keys(TOPIC_TO_BUC).sort());
  for(const [name,words] of Object.entries(topicWords))for(const word of words)assert.equal(entryOf(word)?.category,TOPIC_TO_BUC[name].category,`${name}: ${word}`);
  const covered={
    7:['movilidad','mobility','mobilidade','transporte','transport','caminabilidad','walkability','caminhabilidade'],
    8:['vivienda','viviendas','housing','moradia','habitação','cuidado','cuidados','care','género','gender','gênero','informalidad','informality','informalidade','asentamientos informales','inclusión','inclusion','inclusão'],
    2:['espacio público','espacios públicos','public space','public spaces','espaço público','espaços públicos','seguridad','safety','segurança','acupuntura urbana'],
    3:['clima','climate','cambio climático','climate change','resiliencia','resilience','ambiente','medio ambiente','environment','meio ambiente','naturaleza','nature'],
    6:['gobernanza','governance','governança','participación','participation','participação'],
    5:['patrimonio','heritage','património','patrimônio','cultura','culture','centro histórico'],
    4:['datos','urban data','open data','big data','data science','dados','tecnología','technology','planificación','planning','planejamento','uso de suelo','land use','metodología','metodologías','methods'],
    1:['infancia','childhood','niñez','infância','niños'],
  };
  for(const [category,terms] of Object.entries(covered))for(const term of terms)assert.equal(entryOf(term)?.category,Number(category),term);
  // "data" alone is Portuguese for a date ("a data do lançamento") and Spanish "de larga data": the English topic is named as a phrase.
  assert.equal(entryOf('data'),undefined);
  // Matching is accent- and case-free, so an unaccented or capitalised q is the same q.
  assert.equal(vocabularyEntry('Planificacion')?.q,'planificación');
  assert.equal(vocabularyEntry('  ESPACIO   publico ')?.q,'espacio público');
  for(const other of ['','housing','vivienda social','llamo juan pérez','movilidad lima',undefined,null,42])assert.equal(vocabularyEntry(other),null,String(other));
});

test('every festival block has its BUC categories, in one place, and only known ids', () => {
  assert.deepEqual(Object.keys(BLOCK_TO_BUC).sort(),ALL_FIIU_ACTIVITIES.map(activity=>activity.id).sort(),'a block added to the programme needs a line here');
  for(const [id,categories] of Object.entries(BLOCK_TO_BUC)){
    assert.ok(Array.isArray(categories),id);
    for(const category of categories)assert.ok(Object.hasOwn(BUC_CATEGORIES,category),`${id}: ${category}`);
  }
  // The conference blocks follow the spec.
  assert.deepEqual(BLOCK_TO_BUC['day0-lab'],[6]);
  assert.deepEqual(BLOCK_TO_BUC['day1-am'],[6]);
  assert.deepEqual(BLOCK_TO_BUC['day1-pm'],[2]);
  assert.deepEqual(BLOCK_TO_BUC['day2-am'],[8,7]);
  assert.deepEqual(BLOCK_TO_BUC['day2-pm'],[5,2]);
  assert.deepEqual(BLOCK_TO_BUC['day3-am'],[3]);
  // The party has no readings; workshops and routes take the category closest to their titles.
  assert.deepEqual(BLOCK_TO_BUC['closing-party'],[]);
  assert.deepEqual(BLOCK_TO_BUC['workshop-mapa-empatia'],[1],'the view of a city from childhood');
  assert.deepEqual(BLOCK_TO_BUC['workshop-bosques-urbanos'],[3],'urban forests');
  assert.deepEqual(BLOCK_TO_BUC['workshop-calles-gente'],[7],'walkability');
  assert.deepEqual(BLOCK_TO_BUC['route-restauracion-chl'],[5],'restoring the historic centre');
});

test('a topic link searches its category with its words, labelled with the category, tagged for BUC analytics', () => {
  const [link]=bucLinks({topics:['Housing'],context:'console'});
  assert.equal(link.url.split('?')[0],SEARCH);
  assert.deepEqual(params(link),{q:'vivienda',c:'8',utm_source:'nodal',utm_medium:'console'});
  assert.deepEqual({label:link.label,category:link.category,words:link.words},{label:'Inclusión',category:8,words:'vivienda'});
  // A topic without extra words searches the whole category; the empty q is what BUC's own form sends.
  const [mobility]=bucLinks({topics:['Mobility'],context:'course'});
  assert.equal(mobility.url,`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=course`);
  assert.deepEqual({label:mobility.label,category:mobility.category,words:mobility.words},{label:'Movilidad',category:7,words:''});
});

test('a q is URL-encoded, accents included, and the words-only link searches every category', () => {
  const [land]=bucLinks({topics:['Land use & planning'],context:'console'});
  assert.match(land.url,/\?q=planificaci%C3%B3n&c=4&/);
  const links=bucLinks({words:'espacio público',context:'chat'});
  assert.deepEqual(links.map(link=>link.url),[`${SEARCH}?q=espacio+p%C3%BAblico&c=2&utm_source=nodal&utm_medium=chat`,`${SEARCH}?q=espacio+p%C3%BAblico&c=&utm_source=nodal&utm_medium=chat`]);
  assert.deepEqual({label:links[1].label,category:links[1].category,words:links[1].words},{label:'Buscar «espacio público» en la BUC',category:null,words:'espacio público'});
  // Words that are not a vocabulary q never reach a link, so none can add a parameter either.
  const tricky=bucLinks({words:'calle=plaza&c=7 #barrio ?ruta',categories:[2],context:'chat'});
  assert.deepEqual(tricky.map(link=>[link.category,link.words]),[[2,'']]);
  for(const link of [...links,...tricky]){
    const url=new URL(link.url);
    assert.equal(url.origin+url.pathname,SEARCH);assert.equal(url.hash,'');
    assert.deepEqual([...url.searchParams.keys()],['q','c','utm_source','utm_medium']);
  }
});

test('a q searches its own category and all of BUC; any other category is searched whole, a topic with its own word', () => {
  // "vivienda" was checked in Inclusión (8): the block's Gobernanza (6) is opened whole, not searched for a word BUC may not have there.
  assert.deepEqual(bucLinks({categories:[6],words:'vivienda',context:'chat'}).map(link=>[link.category,link.words]),[[8,'vivienda'],[6,''],[null,'vivienda']]);
  // The q's own category asked for again is one link, and it is not also opened whole.
  assert.deepEqual(bucLinks({categories:[8,7],words:'Vivienda',context:'chat'}).map(link=>[link.category,link.words]),[[8,'vivienda'],[7,''],[null,'vivienda']]);
  assert.deepEqual(bucLinks({topics:['Mobility'],words:'movilidad',context:'chat'}).map(link=>[link.category,link.words]),[[7,'movilidad'],[null,'movilidad']]);
  // A topic keeps the word that was checked for it.
  assert.deepEqual(bucLinks({topics:['Housing'],words:'movilidad',context:'chat'}).map(link=>[link.category,link.words]),[[7,'movilidad'],[8,'vivienda'],[null,'movilidad']]);
  // Free text, a name or a word the vocabulary only matches on (not its q) is no q at all.
  for(const words of ['llamo juan pérez','vivienda social','housing','vivienda juanperez'])
    assert.deepEqual(bucLinks({categories:[6],words,context:'chat'}).map(link=>[link.category,link.words]),[[6,'']],words);
});

test('topics and categories: duplicates collapse, at most four links, in the order asked', () => {
  // A topic and its own category, asked twice, are one link.
  assert.deepEqual(bucLinks({topics:['Mobility','Mobility'],categories:[7,7],context:'course'}).map(link=>link.url),[`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=course`]);
  const many=bucLinks({topics:['Housing','Care & gender','Informality','Heritage','Safety'],context:'console'});
  assert.equal(many.length,4);
  assert.deepEqual(many.map(link=>[link.category,link.words]),[[8,'vivienda'],[8,'género'],[8,''],[5,'']],'in the order asked');
});

test('unknown topics and categories are ignored; nothing specific opens all eight categories', () => {
  assert.deepEqual(bucLinks({topics:['Transporte','__proto__','constructor'],categories:[0,9,'7x'],context:'knowledge'}).map(link=>link.category),[1,2,3,4,5,6,7,8]);
  const all=bucLinks({context:'knowledge'});
  assert.deepEqual(all.map(link=>link.label),Object.values(BUC_CATEGORIES));
  assert.deepEqual(all.map(link=>params(link)),[1,2,3,4,5,6,7,8].map(c=>({q:'',c:String(c),utm_source:'nodal',utm_medium:'knowledge'})));
  // Words that are no q are just as unspecific.
  assert.equal(bucLinks({words:'¿me recomiendan libros?',context:'chat'}).length,8);
});

test('without a context the links still say they come from NODAL', () => {
  assert.deepEqual(params(bucLinks({topics:['Mobility']})[0]),{q:'',c:'7',utm_source:'nodal'});
  assert.deepEqual(params(bucLinks({topics:['Mobility'],context:'elsewhere'})[0]),{q:'',c:'7',utm_source:'nodal'});
});

/* ---------------------------------------------------------------- the feed reader (switched off by default) */

const FEED_URL='https://feed.example/api/publicaciones.json';
const HOUR=60*60*1000;
const publication=(id,extra={})=>({id:String(id),title:`Publicación ${id}`,category:3,url:`https://buc.sistemaurbano.org/publicacion/${id}`,...extra});
const feedBody=(items,extra={})=>JSON.stringify({version:1,generatedAt:'2026-10-16T12:00:00Z',items,...extra});
const json=(body,{status=200,headers={}}={})=>new Response(body,{status,headers:{'Content-Type':'application/json',...headers}});
// A fetch that answers from a list of replies (a Response, a function of the request, or an Error to throw) and records every request.
function fakeFetch(...replies){
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options,headers:new Headers(options.headers)});
    const reply=replies.length>1?replies.shift():replies[0];
    const value=typeof reply==='function'?await reply(url,options):reply;
    if(value instanceof Error)throw value;
    return value?.clone?value.clone():value;
  };
  return {fetchImpl,calls};
}
const fakeClock=(start=Date.parse('2026-10-16T12:00:00Z'))=>{let now=start;const clock=()=>now;clock.advance=ms=>{now+=ms;};return clock;};
const logger=()=>{const lines=[];const log=line=>lines.push(line);log.lines=lines;return log;};
const feedWith=(fetch,options={})=>createBucFeed({url:FEED_URL,fetchImpl:fetch.fetchImpl,clock:options.clock??fakeClock(),log:options.log??logger(),...options});

test('the feed reader reads every 6 hours at most, waits at most 10 s, and takes at most 5 MB', () => {
  assert.deepEqual({...BUC_FEED_LIMITS},{ttlMs:6*HOUR,timeoutMs:10000,maxBytes:5*1024*1024,retryMs:15*60*1000});
});

test('without BUC_FEED_URL, or with one that is not https, the reader is off and never makes a request', async () => {
  for(const url of [undefined,'','   ','http://buc.sistemaurbano.org/feed.json','ftp://x.example/feed','not a url','https://user:pass@feed.example/x.json']){
    const fetch=fakeFetch(json(feedBody([publication(1)]))),log=logger();
    const feed=createBucFeed({url,fetchImpl:fetch.fetchImpl,log});
    assert.equal(feed.enabled,false,String(url));
    assert.equal(await feed.items(),null);assert.equal(await feed.recommend({categories:[3]}),null);
    assert.equal(fetch.calls.length,0,String(url));
    assert.equal(log.lines.length,url&&url.trim()?1:0,'a set but unusable address is said once');
  }
  const fetch=fakeFetch(json(feedBody([publication(1)])));
  assert.equal(bucFeedFromEnv({},{fetchImpl:fetch.fetchImpl}).enabled,false);
  const on=bucFeedFromEnv({BUC_FEED_URL:` ${FEED_URL} `},{fetchImpl:fetch.fetchImpl,log:logger()});
  assert.equal(on.enabled,true);assert.equal((await on.items()).length,1);
  assert.equal(fetch.calls[0].url,FEED_URL);
});

test('a feed read asks for JSON, follows no redirect and can be cancelled', async () => {
  const fetch=fakeFetch(json(feedBody([publication(1)])));
  await feedWith(fetch).items();
  const [{options,headers}]=fetch.calls;
  assert.equal(headers.get('accept'),'application/json');assert.equal(headers.get('if-none-match'),null);
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.method??'GET','GET');assert.equal(options.body,undefined);
});

test('every publication is checked against the feed spec; the rest are used and the skipped ones counted', async () => {
  const good=publication(1,{title:'  Clima y resiliencia\nen la mirada urbana  ',authors:['Lima Cómo Vamos'],year:2025,country:'Perú',format:'Documento',
    sourceUrl:'https://www.limacomovamos.org/x',summary:'Dos o tres frases.',language:'es',updatedAt:'2026-09-30T00:00:00Z'});
  const bare={id:'2',title:'Sólo lo requerido',category:7,url:'https://buc.sistemaurbano.org/publicacion/2'};
  const broken=[
    {...publication(10),id:undefined},{...publication(11),id:''},{...publication(12),id:{}},publication(1,{title:'Same id again'}),
    publication(13,{title:''}),publication(14,{title:'   '}),publication(15,{title:'x'.repeat(301)}),publication(16,{title:'<b>Bold</b> title'}),publication(17,{title:42}),
    publication(18,{category:0}),publication(19,{category:9}),publication(20,{category:'3'}),publication(21,{category:2.5}),{...publication(22),category:undefined},
    publication(23,{url:'http://buc.sistemaurbano.org/publicacion/23'}),publication(24,{url:'javascript:alert(1)'}),publication(25,{url:'not a url'}),publication(26,{url:'https://u:p@buc.sistemaurbano.org/x'}),{...publication(27),url:undefined},
    publication(28,{year:1899}),publication(29,{year:2101}),publication(30,{year:'2020'}),publication(31,{year:2020.5}),
    publication(32,{authors:'Lima Cómo Vamos'}),publication(33,{authors:['ok',7]}),publication(34,{authors:['']}),
    publication(35,{country:12}),publication(36,{format:'x'.repeat(61)}),publication(37,{sourceUrl:'http://insecure.example/'}),
    publication(38,{summary:'x'.repeat(601)}),publication(39,{summary:'<p>Hola</p>'}),publication(40,{summary:['no']}),
    publication(41,{language:'Spanish!'}),publication(42,{updatedAt:'yesterday'}),
    null,'a string',[1,2],
  ];
  const fetch=fakeFetch(json(feedBody([good,...broken,bare]))),log=logger();
  const items=await feedWith(fetch,{log}).items();
  assert.deepEqual(items,[
    {id:'1',title:'Clima y resiliencia en la mirada urbana',authors:['Lima Cómo Vamos'],year:2025,country:'Perú',category:3,format:'Documento',url:'https://buc.sistemaurbano.org/publicacion/1',summary:'Dos o tres frases.'},
    {id:'2',title:'Sólo lo requerido',authors:[],year:null,country:null,category:7,format:null,url:'https://buc.sistemaurbano.org/publicacion/2',summary:null},
  ]);
  assert.deepEqual(log.lines,[`BUC feed: 2 publications, ${broken.length} skipped`]);
  // A numeric id is a stable id too, and a null optional field is as good as a missing one.
  const numeric=await feedWith(fakeFetch(json(feedBody([{...bare,id:7,year:null,country:null,summary:null,authors:null}])))).items();
  assert.equal(numeric[0].id,'7');
});

test('a feed that is not the documented shape is a failed read', async () => {
  for(const body of ['not json','null','[]',JSON.stringify({items:'x'}),JSON.stringify({version:2,items:[]}),JSON.stringify({})]){
    const log=logger();
    assert.equal(await feedWith(fakeFetch(json(body)),{log}).items(),null,body);
    assert.equal(log.lines.length,1,body);assert.match(log.lines[0],/^BUC feed read failed/);
  }
  // A version-less feed and a byte order mark are fine.
  assert.equal((await feedWith(fakeFetch(json('\uFEFF'+JSON.stringify({items:[publication(1)]})))).items()).length,1);
});

test('an unchanged feed (304 to the ETag) keeps the copy for another 6 hours', async () => {
  const clock=fakeClock(),log=logger();
  const fetch=fakeFetch(json(feedBody([publication(1)]),{headers:{ETag:'"v1"'}}),new Response(null,{status:304}));
  const feed=feedWith(fetch,{clock,log});
  const first=await feed.items();
  clock.advance(6*HOUR);
  assert.deepEqual(await feed.items(),first,'the copy is served while it is checked');
  await feed.whenIdle();
  assert.equal(fetch.calls.length,2);assert.equal(fetch.calls[1].headers.get('if-none-match'),'"v1"');
  assert.deepEqual(await feed.items(),first);
  clock.advance(6*HOUR-1);await feed.items();
  assert.equal(fetch.calls.length,2,'the 304 renewed the memo');
  assert.deepEqual(log.lines,['BUC feed: 1 publication, 0 skipped'],'a 304 says nothing');
});

test('a feed that does not answer within the timeout is a failed read, headers or body', async () => {
  const never=()=>new Promise(()=>{});
  const log=logger(),started=Date.now();
  assert.equal(await feedWith(fakeFetch(never),{log,timeoutMs:30}).items(),null);
  assert.ok(Date.now()-started<2000);
  assert.match(log.lines[0],/timed out/);
  // Headers on time, then a body that never finishes.
  const trickle=()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"items":['));}}),{status:200});
  const slow=logger();
  assert.equal(await feedWith(fakeFetch(trickle),{log:slow,timeoutMs:30}).items(),null);
  assert.match(slow.lines[0],/timed out/);
  // The request is aborted, not left running.
  const fetch=fakeFetch(never);await feedWith(fetch,{timeoutMs:10}).items();
  assert.equal(fetch.calls[0].options.signal.aborted,true);
});

test('a feed over 5 MB is a failed read, whether it says so or not', async () => {
  const {maxBytes}=BUC_FEED_LIMITS,small=feedBody([publication(1)]);
  const under=small+' '.repeat(maxBytes-Buffer.byteLength(small));
  assert.equal((await feedWith(fakeFetch(json(under))).items()).length,1,'exactly 5 MB is fine');
  const over=logger();
  assert.equal(await feedWith(fakeFetch(json(under+' ')),{log:over}).items(),null);
  assert.match(over.lines[0],/too large/);
  const declared=logger();
  assert.equal(await feedWith(fakeFetch(json(small,{headers:{'Content-Length':String(maxBytes+1)}})),{log:declared}).items(),null);
  assert.match(declared.lines[0],/too large/);
});

test('a failed read keeps the last good copy, says so in one line and is not retried for 15 minutes', async () => {
  const clock=fakeClock(),log=logger();
  const fetch=fakeFetch(json(feedBody([publication(1)])),json('{}',{status:500}),new Error('getaddrinfo ENOTFOUND'),json(feedBody([publication(1),publication(2)])));
  const feed=feedWith(fetch,{clock,log});
  const first=await feed.items();
  clock.advance(6*HOUR);
  assert.deepEqual(await feed.items(),first);await feed.whenIdle();
  assert.deepEqual(await feed.items(),first,'kept after the 500');
  assert.equal(log.lines.at(-1),'BUC feed read failed (status 500); keeping the last copy');
  clock.advance(15*60*1000-1);await feed.items();
  assert.equal(fetch.calls.length,2,'no retry before 15 minutes');
  clock.advance(1);await feed.items();await feed.whenIdle();
  assert.equal(log.lines.at(-1),'BUC feed read failed (getaddrinfo ENOTFOUND); keeping the last copy');
  clock.advance(15*60*1000);await feed.items();await feed.whenIdle();
  assert.equal((await feed.items()).length,2,'a later good read replaces the copy');
  assert.equal(log.lines.length,4,'one line per read');
});

test('with no copy yet, a failed read gives nothing (the caller falls back to links)', async () => {
  const log=logger(),feed=feedWith(fakeFetch(new Error('ECONNREFUSED')),{log});
  assert.equal(await feed.items(),null);assert.equal(await feed.recommend({categories:[3]}),null);
  assert.deepEqual(log.lines,['BUC feed read failed (ECONNREFUSED); serving links']);
});

test('the copy is kept for 6 hours on the server clock, then served while a fresh one is read', async () => {
  const clock=fakeClock();
  const fetch=fakeFetch(json(feedBody([publication(1)])),json(feedBody([publication(1),publication(2)])));
  const feed=feedWith(fetch,{clock});
  assert.equal((await feed.items()).length,1);
  clock.advance(6*HOUR-1);
  assert.equal((await feed.items()).length,1);assert.equal(fetch.calls.length,1);
  clock.advance(1);
  assert.equal((await feed.items()).length,1,'never waits when it has a copy');
  await feed.whenIdle();
  assert.equal(fetch.calls.length,2);assert.equal((await feed.items()).length,2);
});

test('requests that arrive during a read share it', async () => {
  let release;
  const fetch=fakeFetch(()=>new Promise(resolve=>{release=()=>resolve(json(feedBody([publication(1)])));}));
  const feed=feedWith(fetch);
  const pending=[feed.items(),feed.recommend({categories:[3]}),feed.items()];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fetch.calls.length,1);
  release();
  const [a,b,c]=await Promise.all(pending);
  assert.equal(a.length,1);assert.equal(b.length,1);assert.deepEqual(a,c);
  assert.equal(fetch.calls.length,1);
});

test('recommendations keep the asked categories; words asked for must match, ranking words only rank; then newest', async () => {
  const items=[
    publication('old-match',{category:8,year:2010,title:'Vivienda social en Lima'}),
    publication('new',{category:8,year:2024,title:'Barrios y cuidado'}),
    publication('newest',{category:8,year:2025,title:'Informe anual'}),
    publication('two-words',{category:8,year:2012,title:'Vivienda',summary:'Políticas de vivienda y suelo urbano en Lima.'}),
    publication('undated',{category:8,title:'Sin fecha'}),
    publication('updated',{category:8,year:2025,title:'Informe actualizado',updatedAt:'2026-09-30T00:00:00Z'}),
    publication('other',{category:3,year:2026,title:'Vivienda y clima'}),
    publication('candidatos',{category:8,year:2026,title:'Candidatos y elecciones'}),
  ];
  const feed=feedWith(fakeFetch(json(feedBody(items))));
  const ids=list=>list.map(item=>item.id);
  // Words asked for keep only the publications that match one, in a category too, so a line about them shows nothing else; more of them rank first,
  // then the newer year.
  assert.deepEqual(ids(await feed.recommend({categories:[8],words:['vivienda','lima'],limit:12})),['two-words','old-match']);
  assert.deepEqual(ids(await feed.recommend({categories:[8],words:['clima'],limit:12})),[],'nothing in the category matches');
  // Ranking words (a topic's own) put matches first and keep the rest: between equals the newer year wins, then the later update, and an undated one
  // comes last.
  assert.deepEqual(ids(await feed.recommend({categories:[8],rank:['vivienda'],limit:12})),['two-words','old-match','candidatos','updated','newest','new','undated']);
  assert.deepEqual(ids(await feed.recommend({categories:[8],limit:3})),['candidatos','updated','newest'],'no words: newest first');
  assert.deepEqual(ids(await feed.recommend({categories:[8],words:'Viviénda',limit:2})),['two-words','old-match'],'accents and case are folded; one string is one phrase');
  // A phrase is matched whole, at word starts, as BUC's own search matches it.
  assert.deepEqual(ids(await feed.recommend({words:['vivienda social'],limit:12})),['old-match']);
  assert.deepEqual(ids(await feed.recommend({words:['vivienda'],limit:12})),['other','two-words','old-match'],'words alone search every category');
  assert.deepEqual(ids(await feed.recommend({words:['datos'],limit:12})),[],'"datos" is not inside "candidatos"');
  assert.equal((await feed.recommend({})).length,4,'four by default');
  assert.deepEqual(ids(await feed.recommend({categories:[1]})),[]);
});

/* ---------------------------------------------------------------- GET /api/readings */

const READINGS_CACHE='public, max-age=0, s-maxage=300, stale-while-revalidate=600';
const OFF=createBucFeed({});
async function readingsServer(t,{bucFeed=OFF}={}){
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  const repository=createRepository({db});
  // A session read here would be slow and clear the cookies: the readings route must never get this far.
  const sessionReads={count:0};
  repository.resolveSession=async()=>{sessionReads.count++;await new Promise(resolve=>setTimeout(resolve,1500));return {user:null,cookies:['nodal_session=; Max-Age=0; Path=/']};};
  const server=createApp({db,repository,bucFeed,fiiuConfirmation:null,fiiuPartyNotice:null,citySearch:{search:async()=>({cities:[]})}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(query,options={})=>fetch(`${base}/api/readings${query}`,options);
  const read=async(query,options)=>{const res=await get(query,options);return {status:res.status,headers:res.headers,body:await res.json()};};
  return {get,read,sessionReads};
}
const feedServer=(t,items)=>readingsServer(t,{bucFeed:createBucFeed({url:FEED_URL,fetchImpl:fakeFetch(json(feedBody(items))).fetchImpl,log:()=>{}})});

test('readings are public links into BUC, the same for everyone, cached by the CDN and cookie-free', async t => {
  const {read,sessionReads}=await readingsServer(t);
  const answer=await read('?topics=Mobility,Housing&context=console',{headers:{Cookie:'nodal_session=not-a-session; nodal_refresh=nor-this'}});
  assert.equal(answer.status,200);
  assert.equal(answer.headers.get('cache-control'),READINGS_CACHE);
  assert.equal(answer.headers.get('set-cookie'),null);
  assert.match(answer.headers.get('content-type'),/^application\/json/);
  assert.equal(sessionReads.count,0,'the session is never read');
  assert.deepEqual(answer.body,{source:'links',items:[],links:[
    {label:'Movilidad',url:`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=console`,category:7,words:''},
    {label:'Inclusión',url:`${SEARCH}?q=vivienda&c=8&utm_source=nodal&utm_medium=console`,category:8,words:'vivienda'},
  ]});
});

test('a festival block brings its own BUC categories, which stay on the server', async t => {
  const {read}=await readingsServer(t);
  const session=await read('?block=day2-am&context=session');
  assert.deepEqual(session.body.links.map(link=>[link.category,params(link).utm_medium]),[[8,'session'],[7,'session']]);
  // In the block's chat, a request naming a vocabulary topic searches its q in the q's own category, opens the block's other categories whole, then
  // searches its q across BUC.
  const chat=await read(`?categories=8&block=day2-am&q=${encodeURIComponent('cuidado')}&context=chat`);
  assert.deepEqual(chat.body.links.map(link=>[link.category,link.words]),[[8,'cuidado'],[7,''],[null,'cuidado']]);
  // The q's own category comes with the q even when it was not asked for.
  assert.deepEqual((await read('?block=day1-am&q=movilidad&context=chat')).body.links.map(link=>[link.category,link.words]),[[7,'movilidad'],[6,''],[null,'movilidad']]);
  // Categories asked for are added to the block's.
  assert.deepEqual((await read('?block=day1-pm&categories=3&context=session')).body.links.map(link=>link.category),[3,2]);
  // The party has no readings.
  assert.deepEqual((await read('?block=closing-party&context=session')).body,{source:'links',items:[],links:[]});
  const unknown=await read('?block=day9-am&context=session');
  assert.equal(unknown.status,400);assert.deepEqual(unknown.body,{code:'invalid_readings_query'});
  assert.equal((await read('?block=__proto__&context=session')).status,400);
});

test('a q that is not one of the vocabulary’s is refused, so no name, handle or free text reaches a BUC link, the logs or the CDN’s keys', async t => {
  const {read}=await readingsServer(t);
  for(const q of ['llamo juan pérez','soy maría lópez vivienda','john smith housing','vivienda juanperez','juan_perez_arq','¿Algún libro? escríbanme a juan.perez@gmail.com',
    'Recomiendan lecturas? mi cel es +51 987 654 321','libros en https://example.com/path?x=1','vivienda social','calidad vida','housing','mobilidade','dora pasas mencionaste']){
    const answer=await read(`?block=day1-am&q=${encodeURIComponent(q)}&context=chat`);
    assert.equal(answer.status,400,q);assert.deepEqual(answer.body,{code:'invalid_readings_query'},q);
  }
  // Any spelling of a q is that q, and the links carry it as the vocabulary writes it.
  for(const q of ['vivienda','VIVIENDA','Vivienda ','planificacion','Espacio Publico']){
    const answer=await read(`?q=${encodeURIComponent(q)}&context=chat`);
    assert.equal(answer.status,200,q);assert.ok(answer.body.links.length>=2,q);
  }
  assert.deepEqual((await read('?q=planificacion&context=chat')).body.links.map(link=>params(link).q),['planificación','planificación']);
});

test('the General space is all of BUC, on its page and in its chat', async t => {
  const {read}=await readingsServer(t);
  const general=GENERAL_SPACE.id;
  const page=await read(`?block=${general}&context=session`);
  assert.equal(page.status,200);
  assert.deepEqual(page.body.links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
  const chat=await read(`?block=${general}&categories=8&q=vivienda&context=chat`);
  assert.equal(chat.status,200);
  assert.deepEqual(chat.body.links.map(link=>[link.category,link.words,params(link).c]),[[8,'vivienda','8'],[null,'vivienda','']]);
  // A request without a vocabulary topic is as open as the page.
  assert.deepEqual((await read(`?block=${general}&context=chat`)).body.links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
  // The readings layer itself (the future assistant) agrees: General is not the party.
  assert.deepEqual((await bucReadings({block:general,context:'session'})).links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
});

test('the knowledge hub and the General space ask for nothing and get all eight categories', async t => {
  const {read}=await readingsServer(t);
  for(const context of ['knowledge','session']){
    const answer=await read(`?context=${context}`);
    assert.equal(answer.status,200,context);
    assert.deepEqual(answer.body.links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
    assert.ok(answer.body.links.every(link=>params(link).utm_medium===context));
  }
});

test('a bad readings query is refused with one code', async t => {
  const {get,read}=await readingsServer(t);
  for(const query of [
    '','?context=console','?context=chat','?context=course',
    '?categories=0&context=console','?categories=9&context=console','?categories=7x&context=console','?categories=7,,8&context=console','?categories=1,2,3,4,5,6,7,8,1&context=console',
    `?q=${'x'.repeat(81)}&context=chat`,'?q=lima&context=chat','?q=vivienda&q=clima&context=chat',
    '?topics=Mobility&limit=0','?topics=Mobility&limit=13','?topics=Mobility&limit=abc','?topics=Mobility&limit=4.5','?topics=Mobility&limit=04',
    '?topics=Mobility&context=elsewhere','?topics=Mobility&topics=Housing&context=console','?topics=Mobility&context=console&context=chat',
    `?topics=${Array(13).fill('Mobility').join(',')}&context=console`,`?topics=${'x'.repeat(61)}&context=console`,
  ]){
    const answer=await read(query);
    assert.equal(answer.status,400,query);assert.deepEqual(answer.body,{code:'invalid_readings_query'},query);
  }
  assert.equal((await get('?context=chat')).headers.get('cache-control'),'no-store','a refusal is not cached');
  // Within the rules: 80 characters of words, twelve topics, eight categories, 1 to 12 publications.
  for(const query of ['?q=vivienda&context=chat',`?topics=${Array(12).fill('Mobility').join(',')}&context=console`,'?categories=1,2,3,4,5,6,7,8&context=console','?topics=Mobility&limit=1&context=console','?topics=Mobility&limit=12&context=console','?topics=Mobility'])
    assert.equal((await get(query)).status,200,query);
  // A topic NODAL does not know (an old free-text one) is skipped rather than failing the whole block.
  assert.deepEqual((await read('?topics=Transporte,Mobility&context=console')).body.links.map(link=>link.category),[7]);
  assert.deepEqual((await read('?topics=Transporte&context=console')).body.links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
});

test('the readings route answers GET and HEAD only', async t => {
  const {get}=await readingsServer(t);
  const head=await get('?topics=Mobility&context=console',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),READINGS_CACHE);assert.equal(await head.text(),'');
  const post=await get('?topics=Mobility&context=console',{method:'POST'});
  assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
});

test('with the feed on, readings are publications plus one link to see more in BUC', async t => {
  const items=[
    publication('m1',{category:7,year:2024,title:'Calles para caminar'}),
    publication('m2',{category:7,year:2020,title:'Movilidad del cuidado',summary:'Viajes de cuidado en Lima.'}),
    publication('c1',{category:3,year:2025,title:'Clima y resiliencia'}),
  ];
  const {read}=await feedServer(t,items);
  const console_=await read('?topics=Mobility&context=console');
  assert.equal(console_.headers.get('cache-control'),READINGS_CACHE);
  assert.deepEqual(console_.body,{source:'feed',
    items:[
      {id:'m1',title:'Calles para caminar',authors:[],year:2024,country:null,category:7,format:null,url:'https://buc.sistemaurbano.org/publicacion/m1?utm_source=nodal&utm_medium=console',summary:null},
      {id:'m2',title:'Movilidad del cuidado',authors:[],year:2020,country:null,category:7,format:null,url:'https://buc.sistemaurbano.org/publicacion/m2?utm_source=nodal&utm_medium=console',summary:'Viajes de cuidado en Lima.'},
    ],
    links:[{label:'Ver más en la BUC',url:`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=console`,category:7,words:'',more:true}]});
  assert.deepEqual((await read('?categories=7&q=cuidado&context=chat')).body.items.map(item=>item.id),['m2'],'a q keeps only the publications that match it');
  assert.deepEqual((await read('?topics=Mobility&limit=1&context=console')).body.items.map(item=>item.id),['m1']);
  // The knowledge hub gets the newest publications and still all eight categories.
  const knowledge=await read('?context=knowledge');
  assert.deepEqual(knowledge.body.items.map(item=>item.id),['c1','m1','m2']);
  assert.deepEqual(knowledge.body.links.map(link=>link.category),[1,2,3,4,5,6,7,8]);
  // Nothing in the feed for the request: the search links are more use than an empty list.
  assert.deepEqual((await read('?topics=Heritage&context=console')).body,{source:'links',items:[],links:[
    {label:'Cultura',url:`${SEARCH}?q=&c=5&utm_source=nodal&utm_medium=console`,category:5,words:''}]});
});

test('with the feed on, a q shows only publications that match it, else the search links', async t => {
  const items=[
    publication('g1',{category:6,year:2026,title:'Calidad de vida en Lima'}),
    publication('v1',{category:8,year:2020,title:'Vivienda social y suelo'}),
    publication('v2',{category:6,year:2018,title:'Convivienda: un ensayo'}),
  ];
  const {read}=await feedServer(t,items);
  // In the Gobernanza block's chat, a question about vivienda gets the publication about it, never the block's newest one about something else.
  const chat=await read('?categories=8&block=day1-am&q=vivienda&context=chat&limit=3');
  assert.equal(chat.body.source,'feed');
  assert.deepEqual(chat.body.items.map(item=>item.id),['v1'],'"convivienda" is not "vivienda"');
  assert.deepEqual(chat.body.links.map(link=>[link.category,link.words]),[[null,'vivienda']]);
  // Nothing matches: the links, which search the q where it was checked.
  const none=await read('?block=day1-am&q=clima&context=chat');
  assert.equal(none.body.source,'links');
  assert.deepEqual(none.body.links.map(link=>[link.category,link.words]),[[3,'clima'],[6,''],[null,'clima']]);
});

test('with the feed on, a publication on BUC is tagged for BUC’s analytics like its search links; one on an author’s portal is left as it is', async t => {
  const items=[
    publication('b1',{category:7,year:2025,url:'https://buc.sistemaurbano.org/publicacion/b1?ref=feed#top'}),
    publication('a1',{category:7,year:2024,url:'https://www.limacomovamos.org/informe'}),
  ];
  const {read}=await feedServer(t,items);
  for(const context of ['console','knowledge','session','course','chat']){
    const query=context==='knowledge'?'?context=knowledge':context==='session'?'?block=day1-pm&categories=7&context=session':`?topics=Mobility&context=${context}`;
    const answer=await read(query);
    assert.equal(answer.body.source,'feed',context);
    assert.deepEqual(answer.body.items.map(item=>item.url),[`https://buc.sistemaurbano.org/publicacion/b1?ref=feed&utm_source=nodal&utm_medium=${context}#top`,'https://www.limacomovamos.org/informe'],context);
  }
  // Without a context, still from NODAL.
  assert.equal((await bucReadings({topics:['Mobility']},{feed:createBucFeed({url:FEED_URL,fetchImpl:fakeFetch(json(feedBody(items))).fetchImpl,log:()=>{}})})).items[0].url,'https://buc.sistemaurbano.org/publicacion/b1?ref=feed&utm_source=nodal#top');
});

test('with the feed on, "see more" searches what the publications were drawn from', async t => {
  const items=[
    publication('i1',{category:8,year:2024,title:'Cuidado y barrio'}),
    publication('m1',{category:7,year:2025,title:'Calles para caminar'}),
    publication('c1',{category:3,year:2026,title:'Clima'}),
  ];
  const {read}=await feedServer(t,items);
  // A block over two categories lists both, so "see more" searches all of BUC rather than only the first.
  const session=await read('?block=day2-am&context=session');
  assert.equal(session.body.source,'feed');
  assert.deepEqual(session.body.items.map(item=>item.id),['m1','i1']);
  assert.deepEqual(session.body.links,[{label:'Ver más en la BUC',url:`${SEARCH}?q=&c=&utm_source=nodal&utm_medium=session`,category:null,words:'',more:true}]);
  const chat=await read('?block=day2-am&q=cuidado&context=chat');
  assert.deepEqual(chat.body.links.map(link=>[link.url,link.more]),[[`${SEARCH}?q=cuidado&c=&utm_source=nodal&utm_medium=chat`,true]]);
  // Two profile topics: across BUC when their categories differ, the whole category when they share one.
  assert.deepEqual(params((await read(`?topics=${encodeURIComponent('Mobility,Care & gender')}&context=console`)).body.links[0]),{q:'',c:'',utm_source:'nodal',utm_medium:'console'});
  assert.deepEqual(params((await read(`?topics=${encodeURIComponent('Housing,Care & gender')}&context=console`)).body.links[0]),{q:'',c:'8',utm_source:'nodal',utm_medium:'console'});
  // One topic keeps its own search.
  assert.deepEqual(params((await read('?topics=Housing&context=console')).body.links[0]),{q:'vivienda',c:'8',utm_source:'nodal',utm_medium:'console'});
});

test('a feed that fails or hangs never breaks readings: they fall back to links', async t => {
  const {read}=await readingsServer(t,{bucFeed:{recommend:async()=>{throw new Error('boom');}}});
  assert.deepEqual((await read('?topics=Mobility&context=console')).body.links.map(link=>link.category),[7]);
  assert.equal(READINGS_FEED_WAIT_MS,2000,'a cold instance waits at most 2 s for its first read');
  const started=Date.now();
  const answer=await bucReadings({topics:['Mobility'],context:'console'},{feed:{recommend:()=>new Promise(()=>{})},waitMs:30});
  assert.ok(Date.now()-started<1000);
  assert.equal(answer.source,'links');assert.deepEqual(answer.links.map(link=>link.category),[7]);
  // With the feed off, the readings are links without asking anything.
  assert.equal((await bucReadings({topics:['Mobility'],context:'console'},{feed:OFF})).source,'links');
  assert.equal((await bucReadings({topics:['Mobility'],context:'console'})).source,'links','no feed at all');
});
