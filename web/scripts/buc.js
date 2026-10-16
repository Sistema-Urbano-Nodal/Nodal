(() => {
 'use strict';
 /* BUC, the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/), Sistema Urbano's open library of urbanism publications, is NODAL's source
    of readings. This file draws them where NODAL suggests readings: the console's Learning band, the knowledge hub, FIIU session pages and course pages.
    Everything comes from NODAL's own GET /api/readings (server/buc.js): the topic and festival-block maps, the links into BUC's search and, once BUC
    publishes its feed (docs/integrations/buc-feed.md), the publications themselves. The browser never talks to BUC: a member's topics reach it only in
    a link the member chooses to follow. When members ask each other for readings (FIIU chats, course discussions), suggest() puts a quiet line of BUC
    suggestions under the message, for the topic it names from NODAL's vocabulary, never from its words: shown to everyone reading, never posted. One
    read per distinct query per page, shared by every block and line (a failed one is asked again a minute later); a failed or odd answer draws nothing,
    so a page without readings looks as it did. The labels here are BUC's own (its eight categories and the links into it), shared by every page that
    loads this file; each page's heading comes from that page's dictionary and is handed over as a node. */
 const rows={
  cat1:['Childhood','Infancia','Infância'],cat2:['Public space','Espacio público','Espaço público'],cat3:['Environment','Ambiente','Ambiente'],cat4:['Methods','Metodologías','Metodologias'],
  cat5:['Culture','Cultura','Cultura'],cat6:['Governance','Gobernanza','Governança'],cat7:['Mobility','Movilidad','Mobilidade'],cat8:['Inclusion','Inclusión','Inclusão'],
  // A link into BUC's search with words and no category, the feed's way on to the rest, and the console's way in before any topic is chosen.
  search:['Search “{words}” on BUC','Buscar «{words}» en la BUC','Buscar “{words}” na BUC'],more:['See more on BUC','Ver más en la BUC','Ver mais na BUC'],
  explore:['Explore BUC','Explora la BUC','Explore a BUC'],
  // The line under a message asking for readings, with the name of the topic it asks about when it names one.
  suggest:['BUC suggestions','Sugerencias de la BUC','Sugestões da BUC'],suggestOn:['BUC suggestions on “{words}”','Sugerencias de la BUC sobre «{words}»','Sugestões da BUC sobre “{words}”'],
 };
 /* What members may ask BUC about: an identical copy of BUC_VOCABULARY in server/buc.js (where each q's check against BUC's search is recorded;
    tests/buc-ui.test.js compares the two). terms are whole words or phrases in ES/EN/PT, matched without accents or case; category and q are what
    /api/readings is asked for, and the server refuses any other q; label names the topic in English, Spanish and Portuguese. */
 const VOCABULARY=[
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
  {terms:['datos','data','dados','tecnología','tecnologías','technology','technologies'],category:4,q:'datos',label:['data','datos','dados']},
  {terms:['planificación','planning','planejamento','planeamiento','planeación','uso de suelo','uso del suelo','land use','uso do solo','ordenamiento territorial'],category:4,q:'planificación',label:['planning','planificación','planejamento']},
  {terms:['medio ambiente','ambiente','ambiental','ambientales','environment','environmental','meio ambiente','naturaleza','nature','natureza','árboles','trees','árvores','bosques urbanos','urban forests'],category:3,q:'ambiente',label:['environment','medio ambiente','meio ambiente']},
  {terms:['infancia','childhood','niñez','niños','niñas','children','crianças'],category:1,q:'infancia',label:['childhood','infancia','infância']},
  {terms:['cultura','culturas','culture','cultures','cultural','culturales'],category:5,q:'cultura',label:['culture','cultura','cultura']},
  {terms:['metodología','metodologías','methodology','methodologies','method','methods','método','métodos'],category:4,q:'metodología',label:['methods','metodologías','metodologias']},
  {terms:['inclusión','inclusão','diversidad','diversity','diversidade'],category:8,q:'inclusión',label:['inclusion','inclusión','inclusão']},
 ];
 const LANGS=['en','es','pt'],CONTEXTS=['console','knowledge','session','course','chat'],BLOCK=/^[a-z0-9-]{1,60}$/,HOME='https://buc.sistemaurbano.org/';
 const lang=()=>window.nodalI18n?.lang||document.documentElement?.lang||'en';
 const say=(key,words='')=>(rows[key]?.[Math.max(0,LANGS.indexOf(lang()))]||key).replace('{words}',words);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 // A label keeps its key, and the words it quotes or the vocabulary topic it names, on the node, so the language switch rewrites it in place.
 const topicName=at=>VOCABULARY[at]?.label[Math.max(0,LANGS.indexOf(lang()))]||'';
 const said=n=>say(n.dataset.bucKey,n.dataset.bucTopic!==undefined?topicName(Number(n.dataset.bucTopic)):n.dataset.bucWords||'');
 function label(key,words='',cls='',topic=-1){const n=el('span','buc-t'+(cls?' '+cls:''));n.dataset.bucKey=key;if(words)n.dataset.bucWords=words;if(topic>=0)n.dataset.bucTopic=String(topic);n.textContent=said(n);return n;}
 function relabel(){document.querySelectorAll('.buc-t').forEach(n=>{n.textContent=said(n);});}
 const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
 const fold=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 // A q as the vocabulary writes it, from any case, accents or spacing; '' for anything else, which is never sent.
 const QUERIES=new Map(VOCABULARY.filter(entry=>entry.q).map(entry=>[clean(fold(entry.q)),entry.q]));
 const vocabularyQ=value=>typeof value==='string'?QUERIES.get(clean(fold(value)))||'':'';
 // BUC's own links (its search, its home) stay on BUC; a publication may live on its author's portal (the feed allows it), so any https address does for one.
 function safeUrl(value,bucOnly){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!bucOnly||u.hostname==='buc.sistemaurbano.org')?u.href:null;}catch{return null;}}
 const category=value=>{const n=Number(value);return value!==null&&value!==''&&Number.isInteger(n)&&n>=1&&n<=8?n:null;};

 /* The query, in one order, so the same readings are one address for the CDN and one read here: the context (which also tags BUC's links), NODAL topic
    names, BUC category ids, a festival block (the server knows its categories), a vocabulary q and how many publications. Anything the contract does
    not take is left out, and so are words that are not a vocabulary q: what a member wrote never goes into the address. */
 function query({topics,categories,block,words,context,limit}={}){
  const q=new URLSearchParams();if(CONTEXTS.includes(context))q.set('context',context);
  const names=[...new Set((Array.isArray(topics)?topics:[]).map(clean).filter(Boolean))];if(names.length)q.set('topics',names.join(','));
  const ids=[...new Set((Array.isArray(categories)?categories:[]).map(category).filter(Boolean))];if(ids.length)q.set('categories',ids.join(','));
  if(typeof block==='string'&&BLOCK.test(block))q.set('block',block);
  const search=vocabularyQ(words);if(search)q.set('q',search);
  if(Number.isInteger(limit)&&limit>=1&&limit<=12)q.set('limit',String(limit));
  return '/api/readings?'+q;
 }
 // Only what can be drawn safely is kept: links into BUC, publications with a title and an https address. The feed's way on to the rest of BUC is the
 // link the server marks more.
 function linkOf(raw){const url=safeUrl(raw?.url,true);return url?{url,category:category(raw.category),words:clean(new URL(url).searchParams.get('q')||''),more:raw.more===true}:null;}
 function itemOf(raw){
  const url=safeUrl(raw?.url,false),title=clean(raw?.title);if(!url||!title||title.length>300)return null;
  const authors=(Array.isArray(raw.authors)?raw.authors:[]).map(clean).filter(Boolean);
  return {url,title,authors,year:Number.isInteger(raw.year)&&raw.year>=1900&&raw.year<=2100?raw.year:null,category:category(raw.category)};
 }
 function answer(data){
  if(!data||typeof data!=='object'||!['feed','links'].includes(data.source))return null;
  const items=(Array.isArray(data.items)?data.items:[]).map(itemOf).filter(Boolean).slice(0,12),links=(Array.isArray(data.links)?data.links:[]).map(linkOf).filter(Boolean).slice(0,12);
  return items.length||links.length?{source:data.source,items,links}:null;
 }
 /* Every block asking the same thing shares one read, and an answer is kept for the life of the page. A failure (a timeout, a lost connection, a 429)
    is kept for a minute: a page that redraws within it asks nothing again, and a page left open for hours at the venue gets its readings back with the
    next block or redraw once the connection is. An answer with nothing to show (the party's block) is an answer, and kept. The read carries no cookie:
    the answer is public, the same for everyone. */
 const reads=new Map(),RETRY_MS=60000;
 const current=path=>{const entry=reads.get(path);return entry&&!(entry.failedAt!==undefined&&Date.now()-entry.failedAt>RETRY_MS)?entry:null;};
 function read(path){
  let entry=current(path);
  if(!entry){
   const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(10000):undefined,own={};
   own.answer=Promise.resolve().then(()=>fetch(path,{credentials:'omit',...(signal?{signal}:{})})).then(r=>{if(!r.ok)throw new Error('readings '+r.status);return r.json();})
    .then(answer,()=>{own.failedAt=Date.now();return null;}).catch(()=>null);
   reads.set(path,entry=own);
  }
  return entry;
 }
 // A host keeps what it drew while its query and that query's read are the same.
 const kept=(last,path)=>last?.path===path&&(!last.read||last.read===current(path));

 const away=(a,url)=>{a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 // The separator is text, so screen readers and copied text keep the words apart ("Inclusión · vivienda", "Lima Cómo Vamos · 2025").
 const sep=()=>el('span','buc-sep',' · ');
 const extra=(words,own)=>{const known=new Set(clean(own).toLowerCase().split(' '));return words.split(' ').filter(w=>w&&!known.has(w.toLowerCase())).join(' ');};
 /* A link names its BUC category, then the search words the server added for a topic ("Inclusión · vivienda"), except a q the suggestion line already
    names (own). A link with words only is a search ("Buscar «…» en la BUC"), and the link the server marks more the way on ("Ver más en la BUC"). */
 function linkNode(link,{own='',more=false}={}){
  const a=away(el('a','buc-link'),link.url);
  if(more||(!link.category&&!link.words)){a.className='buc-link buc-more';a.append(label('more'));}
  else if(!link.category)a.append(label('search',link.words));
  else{a.append(label('cat'+link.category));const words=extra(link.words,own);if(words){const w=el('span','buc-words',words);w.lang='es';a.append(sep(),w);}}
  return a;
 }
 // A publication: its title (content, so a browser may translate it), then who, when and which category.
 function itemNode(item){
  const li=el('li','buc-item'),a=away(el('a','buc-link buc-title',item.title),item.url),parts=[];a.translate=true;li.append(a);
  if(item.authors.length)parts.push(el('span','',item.authors.slice(0,2).join(', ')+(item.authors.length>2?' et al.':'')));
  if(item.year)parts.push(el('span','',String(item.year)));if(item.category)parts.push(label('cat'+item.category));
  if(parts.length){const meta=el('span','buc-meta');parts.forEach((part,i)=>{if(i)meta.append(sep());meta.append(part);});li.append(meta);}
  return li;
 }
 // The publications (with the feed), then the feed's way on; any other links (BUC's categories, when nothing in particular was asked for) are a list of
 // their own, as they are without the feed.
 function linkList(links){const list=el('ul','buc-list is-links');for(const link of links){const li=el('li');li.append(linkNode(link,{more:link.more}));list.append(li);}return list;}
 function draw(data){
  if(!data.items.length)return [linkList(data.links)];
  const list=el('ul','buc-list is-items'),more=data.links.find(link=>link.more),rest=data.links.filter(link=>!link.more);list.append(...data.items.map(itemNode));
  return [list,...(more?[linkNode(more,{more:true})]:[]),...(rest.length?[linkList(rest)]:[])];
 }

 /* host: the block a page keeps for its readings, hidden until they arrive. heading: the page's own nodes to put first (a heading, a summary, a hint).
    The same query again keeps what is drawn (the console redraws often); a newer query wins over one still on its way; nothing to show hides the
    block. Resolves whether readings are shown. */
 const drawn=new WeakMap();
 function mount(host,{heading,...filters}={}){
  if(!host)return Promise.resolve(false);
  const path=query(filters),last=drawn.get(host);if(kept(last,path))return last.done;
  const mine={path,read:read(path)};drawn.set(host,mine);
  return mine.done=mine.read.answer.then(data=>{
   if(drawn.get(host)!==mine)return false;
   if(!data){host.replaceChildren();host.hidden=true;return false;}
   host.replaceChildren(...[heading].flat().filter(Boolean),...draw(data));host.hidden=false;return true;
  });
 }
 // One way into BUC itself, and nothing to read: the console before a member has chosen topics, and a request in a chat with nothing to ask for.
 function exploreLink(context,otherwise){const a=away(el('a','buc-link buc-explore'),HOME+'?'+new URLSearchParams({utm_source:'nodal',utm_medium:CONTEXTS.includes(context)?context:otherwise}));a.append(label('explore'));return a;}
 function explore(host,context='console'){
  if(!host)return Promise.resolve(false);
  const done=Promise.resolve(true);drawn.set(host,{path:'explore',done});host.replaceChildren(exploreLink(context,'console'));host.hidden=false;return done;
 }

 /* Contact details are taken out of a message before anything is looked for in it, so an address cannot make a request ("…/libros/…") or name a topic
    ("@movilidad_lima", "vivienda.pe"): every piece holding an @, an underscore (a handle), a scheme, www. or a dot between letters (a site, a dotted
    handle, an email). */
 const CONTACT=/\S*(?:@|_|:\/\/|\bwww\.|[\p{L}\p{N}]\.\p{L}{2,})\S*/giu;
 const withoutContacts=text=>String(text).normalize('NFC').replace(CONTACT,' ');
 /* A message asks for readings when one of its sentences names a reading and asks: a question mark, or a word that asks the others ("¿alguien…",
    "recomiendan", "recomiéndame", "anyone", "alguém", "busco"), or "any" opening it ("Any books on housing", "Hi all, any readings…"). Or when it asks
    what to read ("¿qué leer?", "¿qué debería leer?", "algo para leer", "o que devo ler", "what should I read", "anything to read", "recomendaciones de
    lectura", "recommendations for books"). Whole words only, in any case and with or without accents, so "Booking", "Facebook", "librería" or "lectora"
    are nothing. A reading named alone is no request: "Mi lectura de la sesión…", "Presentaremos el libro…", "Ya terminé de leer la bibliografía", "Te
    recomiendo el libro…", "I recommend the book…". Nor is a reading the venue or an answer states: "hay" and "tienen" only ask with a question mark
    ("Hay libros gratis en la mesa", "Hay un libro de Gehl que me cambió…"), and the plural "algunos libros…" or "alguns livros…" is a quantity, not a
    question (the singular "¿algún libro…?" asks). The festival's errands use the same words and are taken out first: an obligation ("hay que leer el
    libro…", "tienen que leer el texto"), the QR check-in ("no me funciona la lectura del QR"), the reading of the minutes or the conclusions, the
    venue's complaints, visitors' or sign-in book ("el libro de reclamaciones"), the reading room, booking a taxi, a room or tickets ("can we book the
    room?", "where do I book?"), reading something now ("I'm reading the agenda", "who's reading the minutes?"), a book's launch, signing, fair, sale,
    price or where to buy it ("¿a qué hora es la presentación del libro?", "how much is the book?"), a book lost or left behind ("¿alguien vio mi
    libro?", "alguien dejó un libro en la sala 2"), an article of the rules ("el artículo 5 del reglamento") and paper for the workshop ("paper and
    markers"). So a request next to one is still a request, and "book" after a word like "the" or "any" stays a book ("any book the speaker
    mentioned?"). An offer made on a condition ("tengo el libro si alguien lo quiere") still reads as a request: its words are a request's ("si alguien
    tiene libros sobre vivienda, avísenme"). */
 const READING=/\b(?:libros?|lecturas?|bibliografias?|textos?|articulos?|books?|readings?|papers?|articles?|bibliograph(?:y|ies)|livros?|leituras?|artigos?)\b/;
 const ASK=/[?¿]|\b(?:recomienda[ns]?|recomiendas|recomienden|recomiend(?:a|e|en)(?:me|nos)|sugiere[ns]?|sugieres|sugier(?:a|e|an)(?:me|nos)|alguien|algun[oa]?|conocen|conoces|me pasan|me pasas|pasenme|compartan|busco|buscamos|recommend|suggest|anyone|anybody|know of|looking for|recomendam|recomenda|recomendem|sugerem|alguem|algum|alguma|indicam|indiquem|procuro|procuramos)\b/;
 const OPENING_ANY=/(?:^|[,;:])\s*any\b/;
 const WHAT_TO_READ=[/(?<!\blo )\bque (?:leer|leo)\b/,
  /\bque (?:me |nos |les |te )?(?:recomienda[ns]?|recomiendas|sugiere[ns]?|sugieres|aconseja[ns]?|aconsejas|deberia(?:mos)?|debo|debemos|puedo|podemos|podria(?:mos)?|conviene)\b[^.?!\n]{0,30}\bleer\b/,
  /\b(?:recomienda[ns]?|recomiendas|recomienden|sugiere[ns]?|sugieres)\b[^.?!\n]{0,40}\bleer\b/,/\balgo (?:para|pra|de|que) (?:leer|ler)\b/,
  /(?<!\bdo )\bque (?:ler|leio)\b/,/\bque (?:me |nos )?(?:devo|devemos|posso|podemos|deveria(?:mos)?|voces (?:recomendam|sugerem|indicam))\b[^.?!\n]{0,30}\bler\b/,
  /\b(?:recomenda[ms]?|indica[ms]?|sugere[ms]?)\b[^.?!\n]{0,40}\bler\b/,/\b(?:what|something|anything) to read\b/,/\bwhat (?:should|could|can|would|do|might|shall) (?:i|we|you) (?:\w+ )?read\b/,
  /\brecommend\w*\b[^.?!\n]{0,40}\bread\b/,/(?<!\b(?:mis|nuestras|my|our|minhas|nossas) )\b(?:recomendaciones|sugerencias|recomendacoes|sugestoes|indicacoes) de (?:lecturas?|libros?|leituras?|livros?)\b/,
  /(?<!\b(?:my|our) )\b(?:book|reading) (?:recommendations|suggestions)\b/,
  /(?<!\b(?:my|our|your|the|these|those|his|her|their) )\b(?:recommendations?|suggestions?) (?:for|of|on|about) (?:(?:good|some|any|great|new|more|other|a few) )?(?:books?|readings?|papers?|articles?|texts?|bibliograph(?:y|ies))\b/];
 // Reading, and a suggestion asked for, in a question: "Quisiera leer más sobre caminabilidad, ¿alguna sugerencia?".
 const READ=/\b(?:leer|read|ler)\b/,SUGGESTION=/\b(?:sugerencias?|recomendacion(?:es)?|suggestions?|recommendations?|sugestao|sugestoes|indicacao|indicacoes|recomendacao|recomendacoes)\b/;
 const NOUN=new Set('a an the this that any some good great best new old first last one which what whose my your our his her their favourite favorite'.split(' '));
 // A book (libro, book, livro) as the errands name it.
 const BOOK='(?:libros?|books?|livros?)';
 const ERRANDS=[/\b(?:hay|tengo|tienes|tiene|tenemos|tienen|tem|tenho|temos|tens) que\b/g,
  /\b(?:lectura|leitura) (?:del?|de la|de los|de las|do|da|dos|das) (?:qr|codigo|actas?|atas?|asistencia|presenca|acuerdos?|conclusiones|conclusoes|declaracion|declaracao)\b/g,
  /\b(?:libro|livro) de (?:reclamaciones|reclamacoes|actas|atas|visitas|asistencia|presenca|firmas|assinaturas|registro)\b/g,/\b(?:salas? de (?:lectura|leitura)|reading rooms?)\b/g,
  /\b(?:to|can|could|should|will|i|we|you|they|i['’]?ll|we['’]?ll|let['’]?s) book\b/g,/\b(?:i['’]?m|im|i am|we['’]?re|we are|you['’]?re|you are|they['’]?re|they are|is|are|was|were|been) reading\b/g,
  /\breading (?:the|this|that|these|those|my|your|our|his|her|their|it|them|a|an)\b/g,
  // A book's launch, signing, fair or sale, its price, where to buy the one presented, and one's own (lost) book.
  new RegExp(`\\b(?:presentacion|lanzamiento|lancamento|presentation|feria|feira|venta|venda|firma) (?:del?|de los|de las|de la|do|dos|da|das|of the|of) (?:(?:mi|su|sus|nuestro|nuestros|nuevo|este|meu|seu|nosso|novo|esse|my|our|new|this) )?${BOOK}\\b`,'g'),
  /\bbooks? (?:launch(?:es)?|signings?|fairs?|sales?|stands?)\b/g,
  new RegExp(`\\b(?:cuanto (?:cuesta|cuestan|vale|valen)|precios? (?:del?|de los)|how much (?:is|are|does|do|for)|prices? (?:of|for)|quanto (?:custa|custam)|precos? (?:do|dos))\\b[^.?!\\n]{0,20}?\\b${BOOK}\\b`,'g'),
  new RegExp(`\\b(?:buy|purchase|comprar|compro|compramos|venden|vende|vendem) (?:el|los|la|the|this|that|o|os|ese|este|esse) ${BOOK}\\b`,'g'),
  new RegExp(`\\b(?:mi|mis|my|meu|meus) ${BOOK}\\b`,'g'),
  new RegExp(`\\b(?:dejo|dejaron|olvido|olvidaron|perdio|perdi|encontre|encontro|left|forgot|lost|found|deixou|deixaram|esqueceu|esqueceram|perdeu|achei|achou)(?: (?:un|una|el|su|sus|a|an|the|his|her|their|um|uma|o|seu))? ${BOOK}\\b`,'g'),
  // An article of the rules, and paper as a workshop material ("paper and markers"; "papers" stays a reading).
  /\b(?:articulos?|articles?|artigos?) \d+/g,/\bpaper (?:and|or|y|e|markers|plates|cups|towels|bags|clips|sheets)\b/g,
  // Recommending a book yourself answers a request; it does not make one. Only the verb: "I need recommendations for books" asks.
  /\b(?:i|we)(?:['’](?:d|ll))?(?: (?:would|will|also|can|could|do|did|just|still|always|\w+ly|like to|love to|want to))* (?:recommend|suggest)(?:ed)?\b/g];
 const BOOK_SOMETHING=/(\b[a-z]+ )?\bbook (?:a|an|the|my|our|your|it|them|tickets?|seats?|rooms?)\b/g,SENTENCE=/[^.!?\n]*[.!?\n]+|[^.!?\n]+$/g;
 function asks(text){
  if(typeof text!=='string')return false;
  const rest=ERRANDS.reduce((value,errand)=>value.replace(errand,' '),fold(withoutContacts(text))).replace(BOOK_SOMETHING,(match,before)=>before&&NOUN.has(before.trim())?match:' ');
  return (rest.match(SENTENCE)||[]).some(sentence=>WHAT_TO_READ.some(pattern=>pattern.test(sentence))||(ASK.test(sentence)||OPENING_ANY.test(sentence))&&(READING.test(sentence)||READ.test(sentence)&&SUGGESTION.test(sentence)));
 }
 /* The vocabulary topics a message names, in the order it names them, once its contact details are out: "¿libros sobre vivienda y movilidad?" is
    vivienda, then movilidad. Nothing else of the message is used. */
 const plainWords=value=>' '+fold(value).replace(/[^a-z0-9]+/g,' ').trim()+' ';
 const TERMS=VOCABULARY.flatMap(entry=>entry.terms.map(term=>[plainWords(term),entry]));
 function topicsIn(text){
  const words=plainWords(withoutContacts(text)),first=new Map();
  for(const [term,entry] of TERMS){const at=words.indexOf(term);if(at>=0&&!(first.get(entry)<=at))first.set(entry,at);}
  return [...first].sort((a,b)=>a[1]-b[1]).map(([entry])=>entry);
 }
 /* host: the slot under one message. text: the message. filters: the session's block, or the course's topics. A message that does not ask clears the slot
    and reads nothing. One that does asks for the first topic it names (its category and q) and a second topic's category, with the block's or course's
    own; one that names no topic asks for those alone. Its words never travel: they could be a name, and BUC would search them as one phrase and find
    nothing. The same message drawn again (a live update, an edit) keeps its line, and every message naming the same topics shares one read. The caller
    never calls this for a hidden or withdrawn message. Resolves whether a line is shown. */
 function suggest(host,text,{context='chat',...filters}={}){
  if(!host)return Promise.resolve(false);
  if(!asks(text)){drawn.delete(host);host.replaceChildren();host.hidden=true;return Promise.resolve(false);}
  const [first,second]=topicsIn(text),own=[first,second].filter(Boolean).map(entry=>entry.category);
  const path=query({...filters,categories:[...own,...(Array.isArray(filters.categories)?filters.categories:[])],words:first?.q||'',context,limit:3}),last=drawn.get(host);
  if(kept(last,path))return last.done;
  // Nothing to ask for (no topic named, no block, no topic: "¿Alguna bibliografía?" in General): no read, which the server would refuse, and one way into
  // BUC itself.
  const sent=new URLSearchParams(path.slice(path.indexOf('?')+1));
  if(!['topics','categories','block','q'].some(name=>sent.has(name))){
   const line=el('p','buc-suggest'),done=Promise.resolve(true);line.append(label('suggest','','buc-suggest-label'),exploreLink(context,'chat'));
   drawn.set(host,{path,done});host.replaceChildren(line);host.hidden=false;return done;
  }
  const mine={path,read:read(path)};drawn.set(host,mine);
  return mine.done=mine.read.answer.then(data=>{
   if(drawn.get(host)!==mine)return false;
   if(!data){host.replaceChildren();host.hidden=true;return false;}
   // The line names the topic asked about, in the reader's language: the links search its q first, and publications are the ones matching it (a topic
   // without a q has only its category's newest, so the plain label). Its q is said by the line, so a link to its category does not repeat it.
   const topic=first&&(data.source==='links'||first.q)?VOCABULARY.indexOf(first):-1,line=el('p','buc-suggest');
   line.append(topic>=0?label('suggestOn','','buc-suggest-label',topic):label('suggest','','buc-suggest-label'));
   if(data.items.length){
    for(const item of data.items.slice(0,3)){const a=away(el('a','buc-link buc-title',item.title),item.url);a.translate=true;line.append(a);}
    const more=data.links.find(link=>link.more);if(more)line.append(linkNode(more,{more:true}));
   }else line.append(...data.links.slice(0,3).map(link=>linkNode(link,{own:first?.q||'',more:link.more})));
   host.replaceChildren(line);host.hidden=false;return true;
  });
 }
 window.Buc={mount,explore,suggest,asks,rows,vocabulary:VOCABULARY};
 window.nodalI18n?.onChange?.(relabel);
})();
