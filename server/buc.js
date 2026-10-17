/* BUC, the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/), is NODAL's source of readings: wherever
   NODAL suggests readings, and when members ask each other for them. This module is the one place that knows BUC:
   its categories, which of them each NODAL topic and festival block belongs to, the vocabulary members' questions are
   matched against, and how to build a link into BUC's search. Only links leave NODAL, and only when a member follows
   one; nothing here contacts BUC.

   BUC's search is its own form: GET /busqueda?q=<words>&c=<category id>, where an empty c means any category (the form
   sends both fields, empty or not, and so do these links). */

import {GENERAL_SPACE} from './fiiu-talk-domain.js';

export const BUC_ORIGIN='https://buc.sistemaurbano.org';
export const BUC_CATEGORIES=Object.freeze({1:'Infancia',2:'Espacio público',3:'Ambiente',4:'Metodologías',5:'Cultura',6:'Gobernanza',7:'Movilidad',8:'Inclusión'});
const CATEGORY_IDS=Object.keys(BUC_CATEGORIES).map(Number);
const isCategory=value=>Number.isInteger(value)&&Object.hasOwn(BUC_CATEGORIES,value);

/* Accent- and case-free form for comparisons. */
export const foldText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

/* What members may ask BUC about, and the only words NODAL ever searches BUC for. A chat message never leaves the
   browser: web/scripts/buc.js (which carries an identical copy; tests/buc-ui.test.js compares the two) finds these terms
   in it, as whole words or phrases in ES/EN/PT, singular and plural, accent- and case-free, and asks GET /api/readings
   with the entry's BUC category and its q. q is the Spanish word or phrase BUC's search finds in that category, or ''
   when it finds none (the category alone); the server refuses any other q, so no name, handle or free text reaches a
   BUC link, NODAL's request logs or the CDN's cache keys. label is the topic's name in English, Spanish and Portuguese,
   for the line under the message.

   Every q was checked by hand on BUC's public search (a plain GET of /busqueda?q=<q>&c=<category>, one request every
   10 s as its robots.txt asks) on 16 Oct 2026; publications found ("Se encontraron N publicacion(es)"):
     movilidad c7 58, caminabilidad c7 20, espacio público c2 72, acupuntura c2 1 ("acupuntura urbana" 0), seguridad c2 32,
     vivienda c8 21, cuidado c8 1 ("cuidados" 0), género c8 17, asentamientos c8 2 (the review found "informalidad" 0),
     inclusión c8 8, clima c3 14, resiliencia c3 9, ambiente c3 41 ("árboles" 0, "educación ambiental" 0),
     gobernanza c6 13, participación c6 24, gestión urbana c6 1, histórico c5 3 (the review found "patrimonio" 0),
     cultura c5 30, datos c4 6 ("tecnología" 1), planificación c4 8, metodología c4 24, infancia c1 20.
   BUC matches q as one phrase ("vivienda social" finds nothing where "vivienda" finds 21), so a q is one word or a
   phrase BUC's titles carry. A term can be added freely, as long as it means the topic in every language a member
   may write: "data" alone is Portuguese for a date ("a data do lançamento") and Spanish "de larga data", so English
   names data as a phrase ("urban data", "open data"). A new q is checked the same way first. */
export const BUC_VOCABULARY=Object.freeze([
  {terms:['movilidad','mobility','mobilidade','transporte','transportes','transport','transportation'],category:7,q:'movilidad',label:['mobility','movilidad','mobilidade']},
  {terms:['caminabilidad','walkability','caminhabilidade','peatones','pedestrians','pedestres'],category:7,q:'caminabilidad',label:['walkability','caminabilidad','caminhabilidade']},
  {terms:['espacio público','espacios públicos','public space','public spaces','espaço público','espaços públicos'],category:2,q:'espacio público',label:['public space','espacio público','espaço público']},
  {terms:['acupuntura urbana','urban acupuncture','acupuntura'],category:2,q:'acupuntura',label:['urban acupuncture','acupuntura urbana','acupuntura urbana']},
  {terms:['vivienda','viviendas','housing','moradia','moradias','habitação','habitações'],category:8,q:'vivienda',label:['housing','vivienda','moradia']},
  {terms:['clima','climate','cambio climático','climate change','mudança climática','mudanças climáticas','climático','climática','climáticos','climáticas'],category:3,q:'clima',label:['climate','clima','clima']},
  {terms:['resiliencia','resilience','resiliente','resilient'],category:3,q:'resiliencia',label:['resilience','resiliencia','resiliência']},
  {terms:['cuidado','cuidados','care','cuidar'],category:8,q:'cuidado',label:['care','cuidados','cuidados']},
  {terms:['género','gender','feminismo','feminism','feminista','feminist'],category:8,q:'género',label:['gender','género','gênero']},
  {terms:['gobernanza','governance','governança','gobierno local','local government','governo local'],category:6,q:'gobernanza',label:['governance','gobernanza','governança']},
  {terms:['participación','participation','participação','participativo','participativa','participatory'],category:6,q:'participación',label:['participation','participación','participação']},
  {terms:['gestión urbana','gestión local','urban management','gestão urbana','gestão local'],category:6,q:'gestión urbana',label:['urban management','gestión urbana','gestão urbana']},
  {terms:['seguridad','seguridad ciudadana','safety','security','segurança'],category:2,q:'seguridad',label:['safety','seguridad','segurança']},
  {terms:['informalidad','informality','informalidade','asentamientos','asentamientos informales','informal settlements','assentamentos','assentamentos informais','favela','favelas'],category:8,q:'asentamientos',label:['informality','informalidad','informalidade']},
  {terms:['patrimonio','heritage','centro histórico','centros históricos','historic centre','historic center'],category:5,q:'histórico',label:['heritage','patrimonio','patrimônio']},
  {terms:['datos','urban data','open data','big data','data science','dados','tecnología','tecnologías','technology','technologies'],category:4,q:'datos',label:['urban data','datos','dados']},
  {terms:['planificación','planning','planejamento','planeamiento','planeación','uso de suelo','uso del suelo','land use','uso do solo','ordenamiento territorial'],category:4,q:'planificación',label:['planning','planificación','planejamento']},
  {terms:['medio ambiente','ambiente','ambiental','ambientales','environment','environmental','meio ambiente','naturaleza','nature','natureza','árboles','trees','árvores','bosques urbanos','urban forests'],category:3,q:'ambiente',label:['environment','medio ambiente','meio ambiente']},
  {terms:['infancia','childhood','niñez','niños','niñas','children','crianças'],category:1,q:'infancia',label:['childhood','infancia','infância']},
  {terms:['cultura','culturas','culture','cultures','cultural','culturales'],category:5,q:'cultura',label:['culture','cultura','cultura']},
  {terms:['metodología','metodologías','methodology','methodologies','method','methods','método','métodos'],category:4,q:'metodología',label:['methods','metodologías','metodologias']},
  {terms:['inclusión','inclusão','diversidad','diversity','diversidade'],category:8,q:'inclusión',label:['inclusion','inclusión','inclusão']},
].map(entry=>Object.freeze({...entry,terms:Object.freeze(entry.terms),label:Object.freeze(entry.label)})));
const spaced=value=>foldText(value).replace(/\s+/g,' ').trim();
const BY_QUERY=new Map(BUC_VOCABULARY.filter(entry=>entry.q).map(entry=>[spaced(entry.q),entry]));
// The vocabulary entry whose q this is, in any case, accents or spacing; null for anything else.
export const vocabularyEntry=value=>typeof value==='string'?BY_QUERY.get(spaced(value))??null:null;

/* Each NODAL topic (its canonical English name, the profile's join key) searches one BUC category, some with the
   topic's own Spanish word where BUC finds it there (Housing is BUC's Inclusión, searched for "vivienda"); Informality
   and Heritage find nothing for theirs ("informalidad", "patrimonio"), so they open their whole category. A topic's word
   is always a vocabulary q of the same category, so it was checked like the others. */
const topic=(category,words='')=>Object.freeze({category,words});
export const TOPIC_TO_BUC=Object.freeze({
  'Mobility':topic(7),
  'Public space':topic(2),
  'Housing':topic(8,'vivienda'),
  'Climate & resilience':topic(3,'clima'),
  'Care & gender':topic(8,'género'),
  'Governance & participation':topic(6),
  'Safety':topic(2,'seguridad'),
  'Informality':topic(8),
  'Heritage':topic(5),
  'Urban data & tech':topic(4,'datos'),
  'Land use & planning':topic(4,'planificación'),
  'Environment & nature':topic(3),
});
export const isBucTopic=name=>typeof name==='string'&&Object.hasOwn(TOPIC_TO_BUC,name);

/* The BUC categories of every festival block (server/fiiu-domain.js ids, legacy ones included), edited here and only
   here. The conference blocks follow the programme's themes; a workshop or route takes the category closest to its
   title; the party and the legacy placeholders have none, so their pages show no readings. The festival's General
   space (GENERAL_SPACE, not a programme block) is all of BUC, like the knowledge hub. */
export const BLOCK_TO_BUC=Object.freeze(Object.fromEntries(Object.entries({
  'day0-lab':[6],                          // Gestión urbana en acción: herramientas para la gestión local
  'day1-am':[6],                           // El poder de lo local; gobernanza colaborativa
  'day1-pm':[2],                           // Acupuntura urbana, microinfraestructura y acción comunitaria
  'day2-am':[8,7],                         // Cuidar y transformar la ciudad; movilidad y cuidado
  'day2-pm':[5,2],                         // El espacio público para expresar, cuestionar y movilizar
  'day3-am':[3],                           // Territorio, resiliencia y adaptación climática
  'closing-party':[],
  'workshop-espacios-comunidad':[2],       // espacios que sostienen comunidad en el espacio público
  'workshop-bosques-urbanos':[3],          // bosques urbanos y servicios ecosistémicos
  'workshop-poder-local':[6],              // incidir en las decisiones del barrio
  'workshop-calles-gente':[7],             // caminabilidad
  'workshop-mapa-empatia':[1],             // la ciudad desde la mirada de la infancia
  'workshop-vivero-lomita':[3],            // vivero móvil, guardianes del arbolito
  'workshop-norma-territorio':[6],         // de la norma al territorio, desde lo colectivo
  'workshop-diseno-cuidado':[8],           // infraestructuras del cuidado
  'workshop-guardianes':[3],               // educación ambiental desde el barrio
  'route-comunidad-arte-naturaleza':[5],   // comunidad, arte y naturaleza
  'route-amancaes':[3],                    // lomas, biodiversidad y territorio
  'route-restauracion-chl':[5],            // restauración del Centro Histórico
  'route-arcoiris':[8],                    // memoria y diversidad
  'route-lima-cromatica':[5],              // Lima cromática
  'workshop-day1':[],'workshop-day2':[],'workshop-day3':[],'route-day4':[],'route-day5':[],
}).map(([id,categories])=>[id,Object.freeze(categories)])));
export const isBucBlock=id=>typeof id==='string'&&Object.hasOwn(BLOCK_TO_BUC,id);

export const READINGS_CONTEXTS=Object.freeze(['console','knowledge','session','course','chat']);

const MAX_LINKS=4;
export function bucSearchUrl({category=null,words='',context}={}){
  const query=new URLSearchParams({q:words,c:isCategory(category)?String(category):'',utm_source:'nodal'});
  if(READINGS_CONTEXTS.includes(context))query.set('utm_medium',context);
  return `${BUC_ORIGIN}/busqueda?${query}`;
}
const link=(category,words,context)=>({
  label:category===null?`Buscar «${words}» en la BUC`:BUC_CATEGORIES[category],
  url:bucSearchUrl({category,words,context}),
  category,words,
});
/* Links into BUC's search for a request: its q (a vocabulary q, or none) in the q's own category, one link per category
   asked for, one per topic (its category and its own word), then the q alone across every category; duplicates
   collapse and at most four are kept, in that order. A q goes only where it was checked, its own category or all of
   BUC, so any other category is opened whole ("vivienda" may find nothing in Gobernanza), and the q's own category is
   not also opened whole. A request with nothing specific (no known topic, no category, no q) opens all eight
   categories. Unknown topics and categories are ignored, and so are words that are not a vocabulary q. */
export function bucLinks({topics=[],categories=[],words='',context}={}){
  const entry=vocabularyEntry(words),subject=entry?.q??'',pairs=[];
  for(const category of [...(entry?[entry.category]:[]),...categories])if(isCategory(category))pairs.push([category,category===entry?.category?subject:'']);
  for(const name of topics)if(isBucTopic(name))pairs.push([TOPIC_TO_BUC[name].category,TOPIC_TO_BUC[name].words]);
  if(!pairs.length)return CATEGORY_IDS.map(category=>link(category,'',context));
  if(subject)pairs.push([null,subject]);
  const seen=new Set(),links=[];
  for(const [category,text] of pairs){
    const key=`${category}|${text}`;
    if(seen.has(key)||(entry&&category===entry.category&&!text))continue;
    seen.add(key);links.push(link(category,text,context));
    if(links.length===MAX_LINKS)break;
  }
  return links;
}

/* ---------------------------------------------------------------- the feed (docs/integrations/buc-feed.md)

   When BUC publishes its catalogue as JSON and BUC_FEED_URL points at it, NODAL can show the publications themselves
   instead of search links. Until then the reader is off and makes no request. On, the whole catalogue is read at most
   every 6 hours per server instance (If-None-Match with the feed's ETag; a 304 keeps the copy), with a 10 s timeout
   and a 5 MB cap. Requests arriving during a read share it; a copy past its 6 hours is served while the next is read,
   so only an instance's very first read is ever waited for. A failed read logs one line, keeps the last good copy and
   is retried after 15 minutes; with no copy, callers fall back to links. Each publication is checked against the feed
   spec, and those that break a rule are skipped and counted in the read's log line. */
export const BUC_FEED_LIMITS=Object.freeze({ttlMs:6*60*60*1000,timeoutMs:10000,maxBytes:5*1024*1024,retryMs:15*60*1000});

function httpsAddress(value){
  if(typeof value!=='string')return null;
  try{const url=new URL(value.trim());return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
const plain=value=>value.replace(/\p{Cc}/gu,' ').replace(/\s+/g,' ').trim();
const HTML_TAG=/<\/?[a-z][^>]*>/i;
// An optional plain-text field: null when missing or empty, undefined when it breaks its rule.
function optionalText(value,max){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string')return undefined;
  const text=plain(value);
  if(!text)return null;
  return text.length>max||HTML_TAG.test(text)?undefined:text;
}
const searchable=text=>` ${foldText(text).replace(/[^a-z0-9]+/g,' ').trim()} `;
// Search phrases as the feed's text holds them, each starting at a word: " espacio publico".
const phrases=value=>[...new Set((Array.isArray(value)?value:[value]).filter(phrase=>typeof phrase==='string').map(phrase=>searchable(phrase).trimEnd()).filter(Boolean))];
/* One feed publication as NODAL shows it, with what ranking needs, or null when it breaks a rule of the feed spec.
   language and sourceUrl are never read: NODAL does not use them, so a malformed one costs nothing. */
function feedRecord(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const id=typeof raw.id==='string'?raw.id.trim():Number.isSafeInteger(raw.id)&&raw.id>=0?String(raw.id):'';
  if(!id||id.length>100)return null;
  const title=typeof raw.title==='string'?plain(raw.title):'';
  if(!title||title.length>300||HTML_TAG.test(title))return null;
  if(!isCategory(raw.category))return null;
  const url=httpsAddress(raw.url);
  if(!url)return null;
  const year=raw.year??null;
  if(year!==null&&!(Number.isInteger(year)&&year>=1900&&year<=2100))return null;
  const authors=raw.authors??[];
  if(!Array.isArray(authors)||authors.length>50)return null;
  const names=authors.map(name=>typeof name==='string'?plain(name):'');
  if(names.some(name=>!name||name.length>200))return null;
  const country=optionalText(raw.country,100),format=optionalText(raw.format,60),summary=optionalText(raw.summary,600);
  if(country===undefined||format===undefined||summary===undefined)return null;
  let updated=0;
  if(raw.updatedAt!=null){
    updated=typeof raw.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}/.test(raw.updatedAt)?Date.parse(raw.updatedAt):NaN;
    if(!Number.isFinite(updated))return null;
  }
  const item=Object.freeze({id,title,authors:Object.freeze(names),year,country,category:raw.category,format,url,summary});
  return {item,text:searchable(`${title} ${summary??''}`),updated};
}
const failure=err=>String(err?.cause?.code||err?.cause?.message||err?.message||'error').slice(0,120);

export function createBucFeed({url,fetchImpl=globalThis.fetch,clock=Date.now,log=line=>console.warn(line),...limits}={}){
  const {ttlMs,timeoutMs,maxBytes,retryMs}={...BUC_FEED_LIMITS,...limits};
  const given=typeof url==='string'?url.trim():'';
  const address=given?httpsAddress(given):null;
  if(given&&!address)log('BUC_FEED_URL is not an https address without credentials; the BUC feed is off');
  let copy=null,etag=null,nextReadAt=-Infinity,inflight=null;

  async function read(){
    const controller=new AbortController();
    let timer,response=null,reader=null;
    const expired=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timed out'));},timeoutMs);});
    expired.catch(()=>{});
    try{
      const headers={Accept:'application/json'};
      if(etag&&copy)headers['If-None-Match']=etag;
      response=await Promise.race([fetchImpl(address,{method:'GET',headers,redirect:'error',signal:controller.signal}),expired]);
      if(response.status===304&&copy){nextReadAt=clock()+ttlMs;return;}
      if(!response.ok)throw new Error(`status ${response.status}`);
      const declared=Number(response.headers?.get?.('content-length')??NaN);
      if(Number.isFinite(declared)&&declared>maxBytes)throw new Error('too large');
      const chunks=[];
      let size=0;
      if(response.body){
        reader=response.body.getReader();
        for(;;){
          const {done,value}=await Promise.race([reader.read(),expired]);
          if(done){reader=null;break;}
          size+=value.byteLength;
          if(size>maxBytes)throw new Error('too large');
          chunks.push(value);
        }
      }
      let data;
      try{data=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));}catch{throw new Error('not JSON');}
      if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.items)||(data.version!==undefined&&data.version!==1))throw new Error('not a BUC feed');
      const seen=new Set(),records=[];
      let skipped=0;
      for(const raw of data.items){
        const record=feedRecord(raw);
        if(!record||seen.has(record.item.id)){skipped++;continue;}
        seen.add(record.item.id);records.push(record);
      }
      copy={records,items:Object.freeze(records.map(record=>record.item))};
      etag=response.headers?.get?.('etag')||null;
      nextReadAt=clock()+ttlMs;
      log(`BUC feed: ${records.length} publication${records.length===1?'':'s'}, ${skipped} skipped`);
    }catch(err){
      nextReadAt=clock()+retryMs;
      log(`BUC feed read failed (${failure(err)}); ${copy?'keeping the last copy':'serving links'}`);
    }finally{
      clearTimeout(timer);
      // A body left unread (a 304, an error status, a timeout or the cap) is released rather than left open.
      if(reader)reader.cancel().catch(()=>{});
      else if(response?.body&&!response.bodyUsed)response.body.cancel().catch(()=>{});
    }
  }
  // The current copy, starting a read when one is due; waits only when there is no copy yet.
  function current(){
    if(!address)return Promise.resolve(null);
    if(!inflight&&clock()>=nextReadAt)inflight=read().finally(()=>{inflight=null;});
    if(copy)return Promise.resolve(copy);
    return inflight?inflight.then(()=>copy):Promise.resolve(null);
  }
  return {
    enabled:Boolean(address),
    // Every valid publication, in feed order, or null (off, or no good read yet).
    items:()=>current().then(found=>found?.items??null),
    /* Up to `limit` publications in the asked categories (all when none). words (phrases, or one phrase as a string;
       folded and matched whole at word starts, as BUC's search matches its q) keep only the publications whose title or
       summary has one, in categories too, so a line about them shows nothing else; more of them rank first. rank
       (a topic's own words) only puts matches first. Then newest year, then latest update. Null when there is no copy. */
    async recommend({categories=[],words=[],rank=[],limit=4}={}){
      const found=await current();
      if(!found)return null;
      const wanted=new Set(categories.filter(isCategory));
      const must=phrases(words),also=phrases(rank);
      const hits=(keys,record)=>keys.filter(key=>record.text.includes(key)).length;
      let scored=found.records.filter(record=>!wanted.size||wanted.has(record.item.category))
        .map((record,index)=>({record,index,score:hits(must,record),rank:hits(also,record)}));
      if(must.length)scored=scored.filter(entry=>entry.score>0);
      scored.sort((a,b)=>b.score-a.score||b.rank-a.rank||(b.record.item.year??-1)-(a.record.item.year??-1)||b.record.updated-a.record.updated||a.index-b.index);
      return scored.slice(0,Number.isInteger(limit)&&limit>0?limit:4).map(entry=>entry.record.item);
    },
    // Resolves once no read is running (scripts and tests).
    whenIdle:()=>inflight?inflight.then(()=>{}):Promise.resolve(),
  };
}
export const bucFeedFromEnv=(env=process.env,options={})=>createBucFeed({...options,url:env.BUC_FEED_URL});

/* ---------------------------------------------------------------- readings (GET /api/readings)

   One answer for a request from any placement (and, later, from a NODAL assistant): the BUC search links, and with
   the feed on, the publications themselves plus one link to see more in BUC. The answer depends on the query only, so
   it is the same for everyone and safe for the CDN; nothing about the member is sent anywhere. */
export const READINGS_FEED_WAIT_MS=2000;
export const READINGS_ERROR='invalid_readings_query';
const refuse=()=>Object.assign(new Error('invalid readings query'),{status:400,code:READINGS_ERROR});

/* The query string of GET /api/readings: topics (up to 12 names of up to 60 characters; ones NODAL does not know are
   skipped later, since profile topics are free text), categories (up to 8 BUC ids), block (a festival activity id, or
   the General space's, which is no block: all of BUC), q (one of the vocabulary's q values, in any case or accents;
   anything else is refused, so a crafted page cannot put a name or free text into a BUC link, NODAL's logs or the CDN's
   keys either), limit (1–12, default 4) and context
   (where the links are shown, for BUC's analytics). Each at most once; an empty value counts as missing. At least one
   of topics, categories, block or q is needed, except on the knowledge hub and a session page, which may ask for all
   of BUC with nothing. Throws READINGS_ERROR. */
export function parseReadingsQuery(params){
  const one=name=>{
    const values=params.getAll(name);
    if(values.length>1)throw refuse();
    return values[0]?.trim()||null;
  };
  const list=(value,max)=>{
    if(value===null)return [];
    const parts=value.split(',').map(part=>part.trim());
    if(parts.length>max||parts.some(part=>!part))throw refuse();
    return parts;
  };
  const topics=list(one('topics'),12);
  if(topics.some(name=>name.length>60))throw refuse();
  const categories=list(one('categories'),8).map(part=>{if(!/^[1-8]$/.test(part))throw refuse();return Number(part);});
  const block=one('block');
  if(block!==null&&block!==GENERAL_SPACE.id&&!isBucBlock(block))throw refuse();
  const q=one('q'),entry=q===null?null:vocabularyEntry(q);
  if(q!==null&&!entry)throw refuse();
  const limit=one('limit');
  if(limit!==null&&!/^(?:[1-9]|1[0-2])$/.test(limit))throw refuse();
  const context=one('context');
  if(context!==null&&!READINGS_CONTEXTS.includes(context))throw refuse();
  if(!topics.length&&!categories.length&&block===null&&q===null&&context!=='knowledge'&&context!=='session')throw refuse();
  return {topics,categories,block:block===GENERAL_SPACE.id?null:block,q:entry?.q??'',limit:limit===null?4:Number(limit),context:context??undefined};
}

// The feed's answer if it comes within waitMs; null when it is late, fails or has nothing.
async function feedWithin(feed,request,waitMs){
  if(!feed||feed.enabled===false)return null;
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(()=>feed.recommend(request)).catch(()=>null),
      new Promise(resolve=>{timer=setTimeout(resolve,waitMs,null);}),
    ]);
  }finally{clearTimeout(timer);}
}

// A publication on BUC's own pages carries the same tags as its search links, for BUC's analytics; one on an author's portal is left as it is.
function tagged(item,context){
  const url=new URL(item.url);
  if(url.origin!==BUC_ORIGIN)return item;
  url.searchParams.set('utm_source','nodal');
  if(READINGS_CONTEXTS.includes(context))url.searchParams.set('utm_medium',context);
  return {...item,url:url.href};
}

/* {source, items, links} for a parsed query. source 'links': the feed is off, failing, late or has no match, items is
   empty and links are up to four searches (all eight categories when nothing specific was asked). source 'feed': up to
   `limit` publications, and one "Ver más en la BUC" link (more: true), or the eight categories. A q (a vocabulary q;
   any other is ignored) brings its own category, keeps only publications that match it, and with none the answer is
   the links. "See more" searches what the publications were drawn from: their category, or all of BUC when they come
   from several, with the q, else the topics' own word when they share one. A block without categories asked for alone
   (the party) has no readings at all. */
export async function bucReadings({topics=[],categories=[],block=null,q='',limit=4,context}={},{feed=null,waitMs=READINGS_FEED_WAIT_MS}={}){
  // Any other block (the General space) is no block at all.
  const blockCategories=isBucBlock(block)?BLOCK_TO_BUC[block]:null;
  const entry=vocabularyEntry(q),words=entry?.q??'';
  if(blockCategories?.length===0&&!topics.length&&!categories.length&&!words)return {source:'links',items:[],links:[]};
  const known=topics.filter(isBucTopic);
  const asked=[...new Set([...(entry?[entry.category]:[]),...categories.filter(isCategory),...blockCategories??[]])];
  const links=bucLinks({topics:known,categories:asked,words,context});
  const searched=[...new Set([...asked,...known.map(name=>TOPIC_TO_BUC[name].category)])];
  const topicWords=[...new Set(known.map(name=>TOPIC_TO_BUC[name].words))];
  // A q must match; the topics' own words only rank, so a member's Mobility publications stay next to the Housing ones.
  const items=await feedWithin(feed,{categories:searched,words:words?[words]:[],rank:words?[]:topicWords,limit},waitMs);
  if(!Array.isArray(items)||!items.length)return {source:'links',items:[],links};
  const shown=items.slice(0,limit).map(item=>tagged(item,context));
  if(!searched.length&&!words)return {source:'feed',items:shown,links};
  const category=searched.length===1?searched[0]:null;
  const more=link(category,words||(category!==null&&topicWords.length===1?topicWords[0]:''),context);
  return {source:'feed',items:shown,links:[{...more,label:'Ver más en la BUC',more:true}]};
}
