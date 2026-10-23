import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../web/scripts/'+file,import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};

// Just enough DOM for profile.js and pilot.js (which draws the Founder badge): ids, class lookups, closest() and replaceWith().
class Node {
 constructor(tag='div',className=''){this.tagName=tag;this.className=className;this.children=[];this.attributes={};this.listeners={};this.hidden=false;this._text='';this.href='';this.style={};this.dataset={};}
 get textContent(){return this._text+this.children.map(n=>typeof n==='string'?n:n.textContent).join('');}
 set textContent(value){this._text=String(value);this.children=[];}
 append(...nodes){for(const n of nodes){if(typeof n==='object')n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 replaceWith(node){const list=this.parent.children;node.parent=this.parent;list.splice(list.indexOf(this),1,node);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return this.attributes[k]??null;}
 addEventListener(k,f){this.listeners[k]=f;}
 closest(selector){let n=this;while(n){if(n.matches(selector))return n;n=n.parent;}return null;}
 matches(selector){return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));}
}
const all=node=>node.children.flatMap(n=>typeof n==='object'?[n,...all(n)]:[]);

function page({lang='es',me,other,people=[]}={}){
 const body=new Node('body'),ids={};
 const add=(parent,tag,className='',id)=>{const n=new Node(tag,className);if(id){n.id=id;ids[id]=n;}parent.append(n);return n;};
 const hero=add(body,'section','pf-hero'),card=add(hero,'div','pf-hero-card');
 add(card,'span','pf-coord','pfCoord');const avatar=add(card,'div','pf-avatar');add(avatar,'span','leader-initial','pfInitial').textContent='N';
 const id=add(card,'div','pf-id');for(const [tag,cls,key] of [['p','pf-kicker','pfKicker'],['h1','','pfName'],['div','pf-founder','pfFounder'],['p','pf-role','pfRole'],['div','tags','pfTags'],['p','pf-meta','pfMeta']])add(id,tag,cls,key);ids.pfFounder.hidden=true;
 const li=add(id,'a','pf-linkedin','pfLinkedin');add(li,'span','','pfLinkedinText');
 const actions=add(card,'div','pf-actions');add(actions,'span','pf-match','pfMatch').textContent='…';add(actions,'div','pf-btns','pfBtns');
 const grid=add(add(body,'section','pf-body'),'div','wrap pf-grid'),main=add(grid,'div','pf-main');
 const about=add(main,'article','pf-card');add(about,'p','','pfAbout');add(about,'p','pf-quote','pfQuote');
 add(add(main,'article','pf-card'),'ul','pf-projects','pfProjects');
 const locked=add(main,'article','pf-card pf-locked');
 const side=add(grid,'aside','pf-side');const activity=add(side,'div','pf-panel');for(const key of ['pfActConn','pfActProj','pfActCourses','pfActSince'])add(activity,'dd','',key);
 add(add(side,'div','pf-panel'),'ul','pf-links','pfConnList');
 const listeners=[],dict={};
 const context={window:{},document:{title:'',body,documentElement:{dataset:{pilot:'false'}},readyState:'complete',createElement:tag=>new Node(tag),getElementById:key=>all(body).find(n=>n.id===key)||null,querySelector:selector=>all(body).find(n=>n.matches(selector))||null,
  querySelectorAll:selector=>all(body).filter(n=>selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:false)},
  URL,URLSearchParams,setTimeout,location:{origin:'https://nodal.test',pathname:'/profile.html',search:other?'?id='+other:'',assign(){}},navigator:{clipboard:{writeText:async()=>{}}},
  fetch:async path=>{
   const reply=path==='/api/auth/me'?{status:200,data:{user:me,self:true}}:path.startsWith('/api/users?')?{status:200,data:{users:people}}:path===`/api/users/${other}`&&me?{status:200,data:{user:me,self:false}}:{status:404,data:{error:'unknown user'}};
   return {status:reply.status,ok:reply.status<400,json:async()=>reply.data};
  }};
 vm.createContext(context);vm.runInContext(read('i18n-dashboard.js'),context);Object.assign(dict,context.window.NODAL_I18N_DASH);
 const state={lang};
 context.window.nodalI18n={get lang(){return state.lang;},t:(key,vars)=>String(dict[state.lang][key]??dict.en[key]??key).replace(/\{(\w+)\}/g,(m,k)=>vars&&k in vars?vars[k]:m),onChange:fn=>listeners.push(fn)};
 for(const file of ['pilot-i18n.js','pilot.js','profile.js'])vm.runInContext(read(file),context);
 return {ids,body,side,actions,grid,locked,context,setLang(value){state.lang=value;listeners.forEach(fn=>fn(value));},buttons:()=>all(ids.pfBtns).filter(n=>n.tagName==='button'),cards:()=>all(main).filter(n=>n.matches('.pf-card'))};
}
const ana={id:'ana-id',fullName:'Ana María Gonzales',title:'Member',role:'Member',city:'Lima',partC:{consent:false}};

test('the server’s "Member" role reads as a community member in the page language, on the card and in the connections list',async()=>{
 const h=page({me:ana,people:[{id:'beto-id',name:'Beto Quispe',role:'Member'},{id:'carla-id',name:'Carla Ruiz',role:'Urbanista'}]});await flush();
 assert.equal(h.ids.pfRole.textContent,'Miembro de la comunidad · Lima');
 assert.match(h.ids.pfConnList.textContent,/Beto Quispe · Miembro de la comunidad/);assert.match(h.ids.pfConnList.textContent,/Carla Ruiz · Urbanista/);
 assert.doesNotMatch(h.ids.pfRole.textContent+h.ids.pfConnList.textContent,/\bMember\b/);
 h.setLang('pt');assert.equal(h.ids.pfRole.textContent,'Membro da comunidade · Lima');
 h.setLang('en');assert.equal(h.ids.pfRole.textContent,'Community Member · Lima');
});

test('your own hidden profile offers no link to copy, and says how to make it shareable',async()=>{
 const h=page({me:ana});await flush();
 assert.match(h.ids.pfMatch.textContent,/oculto hasta que lo autorices/);
 assert.deepEqual(h.buttons(),[],'no "Copiar enlace del perfil" while only you can open the link');
 assert.match(h.actions.textContent,/Para compartir tu perfil, autoriza el directorio en la Parte C\./);
 assert.ok(all(h.ids.pfBtns).some(n=>n.tagName==='a'&&n.href==='dashboard.html'&&n.textContent==='Editar perfil'),'Edit profile leads to Part C');
 h.setLang('pt');assert.match(h.actions.textContent,/Para compartilhar seu perfil/);assert.equal(all(h.actions).filter(n=>n.id==='pfShareHint').length,1,'a language change does not repeat the hint');
 // Once listed, the link works for other members and the copy button comes back.
 const listed=page({me:{...ana,partC:{consent:true}}});await flush();
 assert.deepEqual(listed.buttons().map(b=>b.textContent),['Copiar enlace del perfil']);assert.doesNotMatch(listed.actions.textContent,/Para compartir/);
 const other=page({me:{...ana,partC:{consent:false}},other:'ana-id'});await flush();
 assert.deepEqual(other.buttons().map(b=>b.textContent),['Copiar enlace del perfil'],'another member’s listed profile can be shared');
});

/* The placeholders leave the page rather than being hidden: styles.css gives the members-only card display:grid,
   which beats [hidden], so with the pilot off (courses.css no longer hides [data-billing-only]) it still showed. */
test('a profile that is not found removes the placeholder badge and empty panels, and uses the full width',async()=>{
 const h=page({other:'hidden-id'});await flush();
 const onPage=node=>all(h.body).includes(node);
 const about=h.cards()[0];
 assert.equal(h.ids.pfName.textContent,'Miembro no encontrado');
 assert.equal(onPage(h.ids.pfMatch),false,'no "…" badge');
 assert.equal(onPage(h.side),false,'no Activity or Connections panels');
 assert.equal(onPage(h.locked),false,'no members-only card, whatever the stylesheet says about [hidden]');
 assert.deepEqual(h.cards(),[about],'no Projects or members-only cards');assert.equal(about.hidden,false);assert.match(h.ids.pfAbout.textContent,/Parte C/);
 // With the side column gone, the About card takes the whole row instead of sitting beside an empty column.
 assert.equal(h.grid.style.gridTemplateColumns,'1fr');
 h.setLang('en');assert.equal(h.ids.pfName.textContent,'Member not found');assert.deepEqual(h.cards(),[about]);assert.equal(onPage(h.side),false);
});

// The "active this week" dot sat on every profile with no data behind it, in English only; the footer link stayed English.
test('the profile page carries no unbacked online dot, and its footer link follows the page language',()=>{
 const html=readFileSync(new URL('../web/pages/profile.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/pf-online/);
 assert.match(html,/<a class="footer-old" href="https:\/\/sistemaurbano\.org\/nodal\/"[^>]*data-i18n="foot\.old">/);
});

/* The Founder badge (fundadores.html: it stays on the profile for as long as the member keeps their NODAL account): the server's
   founder flag, on your own card (GET /api/auth/me) and on another member's (GET /api/users/:id), shows the large stamp with a caption. */
test('a Founder member’s profile shows the large Founder badge and its caption, on their own card and to other members',async()=>{
 const badge=h=>all(h.ids.pfFounder).find(n=>n.className==='founder-badge is-large');
 const caption=h=>all(h.ids.pfFounder).find(n=>n.className==='pf-founder-note');
 for(const other of [undefined,'ana-id']){
  const h=page({me:{...ana,founder:true,founderSince:'2026-10-21T15:00:00.000Z'},other});await flush();
  assert.equal(h.ids.pfFounder.hidden,false,String(other));
  assert.equal(badge(h).textContent,'Founder');assert.equal(badge(h).title,'Founder · parte de la comunidad fundadora de Nodal');
  assert.equal(caption(h).textContent,'Parte de la comunidad fundadora');
  assert.deepEqual(h.ids.pfFounder.children.map(n=>n.className),['founder-badge is-large','pf-founder-note'],'the stamp, then its caption');
  h.setLang('pt');
  assert.equal(caption(h).textContent,'Parte da comunidade fundadora');assert.equal(badge(h).title,'Founder · parte da comunidade fundadora da Nodal');
  assert.equal(badge(h).textContent,'Founder','the word stays Founder in every language');
  assert.equal(all(h.ids.pfFounder).filter(n=>n.className==='founder-badge is-large').length,1,'a language change does not repeat the badge');
  h.setLang('en');assert.equal(caption(h).textContent,'Part of the founding community');
 }
});

test('a member without the Founder badge, or a profile that is not found, shows no badge',async()=>{
 for(const me of [ana,{...ana,founder:false,founderSince:null},{...ana,founder:'true'}]){
  for(const other of [undefined,'ana-id']){
   const h=page({me,other});await flush();
   assert.equal(h.ids.pfFounder.hidden,true,JSON.stringify(me.founder)+' '+other);assert.equal(all(h.ids.pfFounder).length,0);
  }
 }
 // A profile that is not found describes nobody, so it never shows a badge.
 const missing=page({other:'hidden-id'});await flush();assert.equal(missing.ids.pfFounder.hidden,true);
 assert.doesNotMatch(missing.body.textContent,/Founder/);
});
