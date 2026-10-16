(() => {
 'use strict';
 /* BUC, the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/), Sistema Urbano's open library of urbanism publications, is NODAL's source
    of readings. This file draws them where NODAL suggests readings: the console's Learning band, the knowledge hub, FIIU session pages and course pages.
    Everything comes from NODAL's own GET /api/readings (server/buc.js): the topic and festival-block maps, the links into BUC's search and, once BUC
    publishes its feed (docs/integrations/buc-feed.md), the publications themselves. The browser never talks to BUC: a member's topics reach it only in
    a link the member chooses to follow. When members ask each other for readings (FIIU chats, course discussions), suggest() puts a quiet line of BUC
    suggestions under the message, built from its own words: shown to everyone reading, never posted. One read per distinct query per page, shared by every
    block and line; a failed or odd answer draws nothing, so a page without readings looks as it did. The labels are BUC's own (its eight categories and the links into it), shared by every page that loads this file;
    each page's heading comes from that page's dictionary and is handed over as a node. */
 const rows={
  cat1:['Childhood','Infancia','Infância'],cat2:['Public space','Espacio público','Espaço público'],cat3:['Environment','Ambiente','Ambiente'],cat4:['Methods','Metodologías','Metodologias'],
  cat5:['Culture','Cultura','Cultura'],cat6:['Governance','Gobernanza','Governança'],cat7:['Mobility','Movilidad','Mobilidade'],cat8:['Inclusion','Inclusión','Inclusão'],
  // A link into BUC's search with words and no category, the feed's way on to the rest, and the console's way in before any topic is chosen.
  search:['Search “{words}” on BUC','Buscar «{words}» en la BUC','Buscar “{words}” na BUC'],more:['See more on BUC','Ver más en la BUC','Ver mais na BUC'],
  explore:['Explore BUC','Explora la BUC','Explore a BUC'],
  // The line under a message asking for readings, with the message's own search words when it has some.
  suggest:['BUC suggestions','Sugerencias de la BUC','Sugestões da BUC'],suggestOn:['BUC suggestions on “{words}”','Sugerencias de la BUC sobre «{words}»','Sugestões da BUC sobre “{words}”'],
 };
 const LANGS=['en','es','pt'],CONTEXTS=['console','knowledge','session','course','chat'],BLOCK=/^[a-z0-9-]{1,60}$/,WORDS=80,HOME='https://buc.sistemaurbano.org/';
 const lang=()=>window.nodalI18n?.lang||document.documentElement?.lang||'en';
 const say=(key,words='')=>(rows[key]?.[Math.max(0,LANGS.indexOf(lang()))]||key).replace('{words}',words);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 // A label keeps its key (and the words it quotes) on the node, so the language switch rewrites it in place.
 function label(key,words='',cls=''){const n=el('span','buc-t'+(cls?' '+cls:''),say(key,words));n.dataset.bucKey=key;if(words)n.dataset.bucWords=words;return n;}
 function relabel(){document.querySelectorAll('.buc-t').forEach(n=>{n.textContent=say(n.dataset.bucKey,n.dataset.bucWords||'');});}
 const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
 // Search words stop at 80 characters, on a word.
 function cut(value){const text=clean(value);if(text.length<=WORDS)return text;const head=text.slice(0,WORDS+1),at=head.lastIndexOf(' ');return (at>0?head.slice(0,at):text.slice(0,WORDS)).trim();}
 // BUC's own links (its search, its home) stay on BUC; a publication may live on its author's portal (the feed allows it), so any https address does for one.
 function safeUrl(value,bucOnly){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!bucOnly||u.hostname==='buc.sistemaurbano.org')?u.href:null;}catch{return null;}}
 const category=value=>{const n=Number(value);return value!==null&&value!==''&&Number.isInteger(n)&&n>=1&&n<=8?n:null;};

 /* The query, in one order, so the same readings are one address for the CDN and one read here: the context (which also tags BUC's links), NODAL topic
    names, BUC category ids, a festival block (the server knows its categories), search words and how many publications. Anything the contract does
    not take is left out. */
 function query({topics,categories,block,words,context,limit}={}){
  const q=new URLSearchParams();if(CONTEXTS.includes(context))q.set('context',context);
  const names=[...new Set((Array.isArray(topics)?topics:[]).map(clean).filter(Boolean))];if(names.length)q.set('topics',names.join(','));
  const ids=[...new Set((Array.isArray(categories)?categories:[]).map(category).filter(Boolean))];if(ids.length)q.set('categories',ids.join(','));
  if(typeof block==='string'&&BLOCK.test(block))q.set('block',block);
  const search=cut(words);if(search)q.set('q',search);
  if(Number.isInteger(limit)&&limit>=1&&limit<=12)q.set('limit',String(limit));
  return '/api/readings?'+q;
 }
 // Only what can be drawn safely is kept: links into BUC, publications with a title and an https address.
 function linkOf(raw){const url=safeUrl(raw?.url,true);return url?{url,category:category(raw.category),words:clean(new URL(url).searchParams.get('q')||'')}:null;}
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
 // Every block asking the same thing shares one read; a failure is remembered too, so a page that redraws never asks again for nothing.
 // The read carries no cookie: the answer is public, the same for everyone.
 const reads=new Map();
 function read(path){
  if(!reads.has(path)){
   const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(10000):undefined;
   reads.set(path,Promise.resolve().then(()=>fetch(path,{credentials:'omit',...(signal?{signal}:{})})).then(r=>r.ok?r.json():null).then(answer).catch(()=>null));
  }
  return reads.get(path);
 }

 const away=(a,url)=>{a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const extra=(words,own)=>{const known=new Set(clean(own).toLowerCase().split(' '));return words.split(' ').filter(w=>w&&!known.has(w.toLowerCase())).join(' ');};
 /* A link names its BUC category, then the search words the server added for a topic ("Inclusión · vivienda"); words the reader brought are already said
    around it (own). A link with words only is a search ("Buscar «…» en la BUC"), and the feed's single link the way on ("Ver más en la BUC"). */
 function linkNode(link,{own='',more=false}={}){
  const a=away(el('a','buc-link'),link.url);
  if(more||(!link.category&&!link.words)){a.className='buc-link buc-more';a.append(label('more'));}
  else if(!link.category)a.append(label('search',link.words));
  else{a.append(label('cat'+link.category));const words=extra(link.words,own);if(words){const w=el('span','buc-words',words);w.lang='es';a.append(w);}}
  return a;
 }
 // A publication: its title (content, so a browser may translate it), then who, when and which category.
 function itemNode(item){
  const li=el('li','buc-item'),a=away(el('a','buc-link buc-title',item.title),item.url),meta=el('span','buc-meta');a.translate=true;li.append(a);
  if(item.authors.length)meta.append(el('span','',item.authors.slice(0,2).join(', ')+(item.authors.length>2?' et al.':'')));
  if(item.year)meta.append(el('span','',String(item.year)));if(item.category)meta.append(label('cat'+item.category));
  if(meta.children.length)li.append(meta);return li;
 }
 // The publications (with the feed) or the links (without it), then the feed's way on.
 function draw(data){
  if(data.items.length){const list=el('ul','buc-list is-items');list.append(...data.items.map(itemNode));return [list,...data.links.map(link=>linkNode(link,{more:data.links.length===1}))];}
  const list=el('ul','buc-list is-links');for(const link of data.links){const li=el('li');li.append(linkNode(link,{more:data.source==='feed'&&data.links.length===1}));list.append(li);}
  return [list];
 }

 /* host: the block a page keeps for its readings, hidden until they arrive. heading: the page's own nodes to put first (a heading, a summary, a hint).
    The same query again keeps what is drawn (the console redraws often); a newer query wins over one still on its way; nothing to show hides the
    block. Resolves whether readings are shown. */
 const drawn=new WeakMap();
 function mount(host,{heading,...filters}={}){
  if(!host)return Promise.resolve(false);
  const path=query(filters),last=drawn.get(host);if(last?.path===path)return last.done;
  const done=read(path).then(data=>{
   if(drawn.get(host)?.path!==path)return false;
   if(!data){host.replaceChildren();host.hidden=true;return false;}
   host.replaceChildren(...[heading].flat().filter(Boolean),...draw(data));host.hidden=false;return true;
  });
  drawn.set(host,{path,done});return done;
 }
 // The console before a member has chosen topics: one way into BUC itself, and nothing to read.
 function explore(host,context='console'){
  if(!host)return Promise.resolve(false);
  const a=away(el('a','buc-link buc-explore'),HOME+'?'+new URLSearchParams({utm_source:'nodal',utm_medium:CONTEXTS.includes(context)?context:'console'}));a.append(label('explore'));
  const done=Promise.resolve(true);drawn.set(host,{path:'explore',done});host.replaceChildren(a);host.hidden=false;return done;
 }

 /* A message asks for readings when it names books, readings or a bibliography, or asks what to read: "libro(s)", "lectura(s)", "bibliografía",
    "¿qué (me) recomiendan leer?", "reading(s)", "book(s)", "livro(s)", "leitura(s)", "bibliografia", in any case and with or without accents. Whole words
    only, so "Booking", "Facebook", "librería" or "lectora" are not requests. */
 const fold=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const ASKS=[/\b(?:libros?|lecturas?|bibliografias?|readings?|books?|livros?|leituras?)\b/,/\brecomienda[ns]?\b[^.?!\n]{0,40}\bleer\b/,
  /\brecommend\w*\b[^.?!\n]{0,40}\bread\b/,/\bwhat (?:should|could|can) (?:i|we) read\b/,/\b(?:recomenda[ms]?|indica[ms]?|sugere[ms]?)\b[^.?!\n]{0,40}\bler\b/];
 const asks=text=>typeof text==='string'&&ASKS.some(pattern=>pattern.test(fold(text)));
 // The message's own words for BUC's search: three at most, in its order, leaving out the asking, the small words and the city words every BUC
 // publication shares; addresses and bare numbers too. The words are compared without accents and kept as written.
 const STOP=new Set(('libro libros lectura lecturas bibliografia bibliografias leer recomiendan recomienda recomiendas recomendar recomiendo recomendacion recomendaciones '+
  'sugieren sugieres sugerir sugerencia sugerencias busco buscan buscando book books ebook ebooks reading readings read recommend recommends recommended recommendation '+
  'recommendations suggest suggested suggestion suggestions looking livro livros leitura leituras recomendam recomenda recomendacao recomendacoes indicam indica indicar '+
  'sugerem sugere sugestao sugestoes procuro procurando ciudad ciudades cidade cidades city cities urbano urbana urbanos urbanas urban urbanismo urbanism tema temas topic '+
  'topics hola gracias favor alguien alguna alguno algunas algunos algun algo sobre acerca para pero como cual cuales donde cuando quien quienes porque tambien esta este '+
  'esto estas estos ese esos esa esas eso aqui otro otra otros otras todo todos toda todas mucho mucha muchos muchas puede pueden podria podrian quisiera quiero queria '+
  'bueno buena buenos buenas mejor mejores interesante interesantes tienen tiene tengo nosotros ustedes nuestro nuestra cada entre desde hasta antes despues durante segun '+
  'hacia what which about anyone someone some good great would could should with from that this these those have please thanks hello there their them they your into '+
  'also more alguem algum alguma alguns algumas voce voces vcs tambem muito muita obrigado obrigada pessoal gente qual quais onde quando isso essa esse este esta').split(' '));
 function wordsOf(text){
  const out=[],seen=new Set();
  for(const word of String(text).replace(/https?:\/\/\S+/gi,' ').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]){
   const key=fold(word);if(key.length<4||/^\d+$/.test(key)||STOP.has(key)||seen.has(key))continue;seen.add(key);out.push(word);if(out.length===3)break;
  }
  return out.join(' ');
 }
 /* host: the slot under one message. text: the message. filters: the session's block, or the course's topics. A message that does not ask clears the slot
    and reads nothing; the same message drawn again (a live update, an edit) keeps its line, and every message with the same words shares one read. The
    caller never calls this for a hidden or withdrawn message. Resolves whether a line is shown. */
 function suggest(host,text,{context='chat',...filters}={}){
  if(!host)return Promise.resolve(false);
  if(!asks(text)){drawn.delete(host);host.replaceChildren();host.hidden=true;return Promise.resolve(false);}
  const words=wordsOf(text),path=query({...filters,words,context,limit:3}),last=drawn.get(host);if(last?.path===path)return last.done;
  const done=read(path).then(data=>{
   if(drawn.get(host)?.path!==path)return false;
   if(!data){host.replaceChildren();host.hidden=true;return false;}
   const line=el('p','buc-suggest');line.append(words?label('suggestOn',words,'buc-suggest-label'):label('suggest','','buc-suggest-label'));
   if(data.items.length){
    for(const item of data.items.slice(0,3)){const a=away(el('a','buc-link buc-title',item.title),item.url);a.translate=true;line.append(a);}
    if(data.links[0])line.append(linkNode(data.links[0],{more:true}));
   }else line.append(...data.links.slice(0,3).map(link=>linkNode(link,{own:words,more:data.source==='feed'&&data.links.length===1})));
   host.replaceChildren(line);host.hidden=false;return true;
  });
  drawn.set(host,{path,done});return done;
 }
 window.Buc={mount,explore,suggest,asks,rows};
 window.nodalI18n?.onChange?.(relabel);
})();
