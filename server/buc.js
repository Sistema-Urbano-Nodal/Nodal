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
