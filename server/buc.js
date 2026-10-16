/* BUC, the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/), is NODAL's source of readings: wherever
   NODAL suggests readings, and when members ask each other for them. This module is the one place that knows BUC:
   its categories, which of them each NODAL topic and festival block belongs to, and how to build a link into BUC's
   search. Only links leave NODAL, and only when a member follows one; nothing here contacts BUC.

   BUC's search is its own form: GET /busqueda?q=<words>&c=<category id>, where an empty c means any category (the form
   sends both fields, empty or not, and so do these links). */

export const BUC_ORIGIN='https://buc.sistemaurbano.org';
export const BUC_CATEGORIES=Object.freeze({1:'Infancia',2:'Espacio público',3:'Ambiente',4:'Metodologías',5:'Cultura',6:'Gobernanza',7:'Movilidad',8:'Inclusión'});
const CATEGORY_IDS=Object.keys(BUC_CATEGORIES).map(Number);
const isCategory=value=>Number.isInteger(value)&&Object.hasOwn(BUC_CATEGORIES,value);

/* Each NODAL topic (its canonical English name, the profile's join key) searches one BUC category, some with a Spanish
   word that narrows it (Housing is BUC's Inclusión, searched for "vivienda"). */
const topic=(category,words='')=>Object.freeze({category,words});
export const TOPIC_TO_BUC=Object.freeze({
  'Mobility':topic(7),
  'Public space':topic(2),
  'Housing':topic(8,'vivienda'),
  'Climate & resilience':topic(3,'clima'),
  'Care & gender':topic(8,'cuidado'),
  'Governance & participation':topic(6),
  'Safety':topic(2,'seguridad'),
  'Informality':topic(8,'informalidad'),
  'Heritage':topic(5,'patrimonio'),
  'Urban data & tech':topic(4,'datos'),
  'Land use & planning':topic(4,'planificación'),
  'Environment & nature':topic(3),
});
export const isBucTopic=name=>typeof name==='string'&&Object.hasOwn(TOPIC_TO_BUC,name);

/* The BUC categories of every festival block (server/fiiu-domain.js ids, legacy ones included), edited here and only
   here. The conference blocks follow the programme's themes; a workshop or route takes the category closest to its
   title; the party and the legacy placeholders have none, so their pages show no readings. */
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

/* Accent- and case-free form for comparisons. */
export const foldText=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/* Words that say "I am asking for readings" or hold a sentence together, in ES/EN/PT (folded). A chat message asking
   "¿Qué libros me recomiendan sobre vivienda?" searches BUC for "vivienda", not for the whole question. */
const STOPWORDS=new Set(`
  libro libros lectura lecturas leer lean leyendo bibliografia bibliografias recomendacion recomendaciones recomienda
  recomiendan recomiendas recomiendo recomendar recomendarian recomendarias recomendaria sugerencia sugerencias sugieren
  sugiere sugerir texto textos articulo articulos material materiales referencia referencias autor autores
  alguien alguna alguno algunas algunos algun buen buena buenas buenos mejor mejores tema temas acerca sobre para por
  con sin que cual cuales como donde cuando quien quienes este esta estos estas ese esa esos esas eso esto otro otra
  otros otras una uno unos unas los las del muy mas tambien pero porque hay tienen tiene tengo saben sabe conocen
  conoce alguno favor gracias hola ustedes vosotros nosotros ellos ellas usted todo todos toda todas
  book books reading readings read recommend recommends recommended recommendation recommendations suggest suggestion
  suggestions text texts article articles paper papers anyone someone any some good great best the and for with about
  what which who whom where when how that this these those there their them they you your can could would should
  please thanks hello have has know topic topics references
  livro livros leitura leituras ler leiam recomendam recomenda recomendo recomendar recomendacao recomendacoes
  sugestao sugestoes sugerem textos artigo artigos alguem algum alguma alguns algumas bom boa bons boas melhor
  melhores sobre voce voces vcs obrigado obrigada ola oi tem temos sabem conhecem quem qual quais onde quando
  pra pro uma umas uns dos das nos nas pelo pela pelos pelas tambem mas porque isso isto esse essa este esta
`.trim().split(/\s+/));
const MAX_SEARCH_WORDS=4,MAX_SEARCH_LENGTH=80;
const tokens=text=>String(text??'').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)??[];
// The subject words of a text, once each (by folded form), in order, without the request words or ones under 3 letters.
export function keywords(text,max=MAX_SEARCH_WORDS){
  const seen=new Set(),out=[];
  for(const token of tokens(text)){
    const key=foldText(token);
    if(key.length<3||STOPWORDS.has(key)||seen.has(key))continue;
    seen.add(key);out.push(token);
    if(out.length===max)break;
  }
  return out;
}
// What a BUC search asks for: at most four subject words, at most 80 characters.
export function searchWords(text){
  const words=keywords(text);
  while(words.join(' ').length>MAX_SEARCH_LENGTH)words.pop();
  return words.join(' ');
}

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
/* Links into BUC's search for a request: one per topic (its category and words), one per category, then one for the
   words alone across every category; duplicates collapse and at most four are kept, in that order. Words asked for
   replace a topic's own words, so each link stays one short search. A request with nothing specific (no known topic,
   no category, no subject word) opens all eight categories. Unknown topics and categories are ignored. */
export function bucLinks({topics=[],categories=[],words='',context}={}){
  const subject=searchWords(words),pairs=[];
  for(const name of topics)if(isBucTopic(name))pairs.push([TOPIC_TO_BUC[name].category,subject||TOPIC_TO_BUC[name].words]);
  for(const category of categories)if(isCategory(category))pairs.push([category,subject]);
  if(!pairs.length&&!subject)return CATEGORY_IDS.map(category=>link(category,'',context));
  if(subject)pairs.push([null,subject]);
  const seen=new Set(),links=[];
  for(const [category,text] of pairs){
    const key=`${category}|${text}`;
    if(seen.has(key))continue;
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
// One feed publication as NODAL shows it, with what ranking needs, or null when it breaks a rule of the feed spec.
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
  if(raw.sourceUrl!=null&&!httpsAddress(raw.sourceUrl))return null;
  if(raw.language!=null&&!(typeof raw.language==='string'&&/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw.language)))return null;
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
      try{data=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/,''));}catch{throw new Error('not JSON');}
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
    /* Up to `limit` publications in the asked categories (all when none), ranked by how many of the subject words
       (folded, at word starts) their title and summary contain, then newest year, then latest update. Words without
       categories keep only publications that match one. Null when there is no copy. */
    async recommend({categories=[],words='',limit=4}={}){
      const found=await current();
      if(!found)return null;
      const wanted=new Set(categories.filter(isCategory));
      const keys=keywords(words,8).map(word=>searchable(word).trimEnd());
      let scored=found.records.filter(record=>!wanted.size||wanted.has(record.item.category))
        .map((record,index)=>({record,index,score:keys.filter(key=>record.text.includes(key)).length}));
      if(!wanted.size&&keys.length)scored=scored.filter(entry=>entry.score>0);
      scored.sort((a,b)=>b.score-a.score||(b.record.item.year??-1)-(a.record.item.year??-1)||b.record.updated-a.record.updated||a.index-b.index);
      return scored.slice(0,Number.isInteger(limit)&&limit>0?limit:4).map(entry=>entry.record.item);
    },
    // Resolves once no read is running (scripts and tests).
    whenIdle:()=>inflight?inflight.then(()=>{}):Promise.resolve(),
  };
}
export const bucFeedFromEnv=(env=process.env,options={})=>createBucFeed({...options,url:env.BUC_FEED_URL});
