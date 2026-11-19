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
 removeAttribute(k){delete this.attributes[k];}
 focus(){this.focused=true;}
 addEventListener(k,f){this.listeners[k]=f;}
 closest(selector){let n=this;while(n){if(n.matches(selector))return n;n=n.parent;}return null;}
 matches(selector){return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));}
}
const all=node=>node.children.flatMap(n=>typeof n==='object'?[n,...all(n)]:[]);

function page({lang='es',me,other,people=[],photoWrite}={}){
 const body=new Node('body'),ids={};
 const add=(parent,tag,className='',id)=>{const n=new Node(tag,className);if(id){n.id=id;ids[id]=n;}parent.append(n);return n;};
 const hero=add(body,'section','pf-hero'),card=add(hero,'div','pf-hero-card');
 add(card,'span','pf-coord','pfCoord');const avatar=add(card,'div','pf-avatar');add(avatar,'span','leader-initial','pfInitial').textContent='N';
 add(avatar,'img','','pfPhoto').hidden=true;
 const tools=add(card,'div','pf-photo-tools','pfPhotoTools');tools.hidden=true;
 add(tools,'input','','pfPhotoFile');
 for(const id of ['pfChoosePhoto','pfSavePhoto','pfRemovePhoto','pfCancelPhoto'])add(tools,'button','pf-photo-action',id);
 add(tools,'p','pf-photo-status','pfPhotoStatus');
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
  fetch:async (path,options)=>{
   if(path==='/api/me/photo'&&photoWrite)return photoWrite(options);
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
 assert.ok(all(other.ids.pfBtns).some(n=>n.href==='messages.html?to=ana-id'&&n.textContent==='Enviar mensaje'));
 assert.match(other.ids.pfProjects.textContent,/visibles para quienes se unen/);
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

// Availability is stored as the console's English option value (code overview M45): the profile shows the three options in
// the page language, on your own card and on another member's, and anything else as it was written.
test('availability reads in the page language on your own card and on another member’s, and anything else as written',async()=>{
 const availability=h=>all(h.body).filter(n=>n.tagName==='p'&&/^(Disponibilidad|Disponibilidade|Availability): /.test(n.textContent)).map(n=>n.textContent);
 const me={...ana,partC:{consent:true,availability:'4 h / month'}};
 const own=page({me});await flush();
 assert.deepEqual(availability(own),['Disponibilidad: 4 h / mes']);
 own.setLang('pt');assert.deepEqual(availability(own),['Disponibilidade: 4 h / mês']);
 own.setLang('en');assert.deepEqual(availability(own),['Availability: 4 h / month']);
 const other=page({me:{...me,partC:{consent:true,availability:'8+ h / month'}},other:'ana-id'});await flush();
 assert.deepEqual(availability(other),['Disponibilidad: 8+ h / mes']);
 other.setLang('en');assert.deepEqual(availability(other),['Availability: 8+ h / month']);
 const written=page({me:{...me,partC:{consent:true,availability:'Fines de semana'}}});await flush();
 assert.deepEqual(availability(written),['Disponibilidad: Fines de semana']);
 const none=page({me:{...me,partC:{consent:true,availability:''}}});await flush();
 assert.deepEqual(availability(none),['Disponibilidad: Aún sin declarar']);
});

// Your own card used to say members see all your signals; another member's card shows only city, availability and LinkedIn
// (GET /api/users/:id blanks references and portfolio), and only while you are in the directory (code overview M54).
test('your own card says which signals members see, the three another member’s card shows, in every language',async()=>{
 const me={...ana,partC:{consent:true,availability:'4 h / month',references:'Two referees',portfolio:'https://example.test/work',linkedin:'https://www.linkedin.com/in/ana'}};
 const signals=h=>all(h.body).filter(n=>n.tagName==='p'&&/^[^:]+: /.test(n.textContent)&&n.children[0]?.tagName==='strong').map(n=>n.children[0].textContent.replace(/: $/,''));
 const note=h=>all(h.body).filter(n=>n.className==='pf-quote'&&n.id!=='pfQuote').map(n=>n.textContent);
 const other=page({me,other:'ana-id'});await flush();
 other.setLang('en');assert.deepEqual(signals(other),['City','Availability','LinkedIn'],'what another member sees');
 const own=page({me});await flush();
 assert.deepEqual(note(own),['Estas señales ayudan a que la comunidad conecte con cuidado. Mientras estés en el directorio, los miembros ven tu ciudad, tu disponibilidad y tu LinkedIn; tus referencias y tu portafolio no se les muestran.']);
 own.setLang('pt');assert.deepEqual(note(own),['Estes sinais ajudam a comunidade a conectar com cuidado. Enquanto você estiver no diretório, os membros veem sua cidade, sua disponibilidade e seu LinkedIn; suas referências e seu portfólio não são mostrados a eles.']);
 own.setLang('en');assert.deepEqual(note(own),['These signals help the community connect with care. While you are in the directory, members see your city, availability and LinkedIn; your references and portfolio are not shown to them.']);
});


test('a profile photo appears on a member card with controls only for its owner', async () => {
 const photoUrl='/api/users/ana-id/photo?v=one';
 const owner=page({me:{...ana,photoUrl}});
 await flush();
 assert.equal(owner.ids.pfPhoto.getAttribute('src'),photoUrl);
 assert.equal(owner.ids.pfPhotoTools.hidden,false);
 assert.equal(owner.ids.pfChoosePhoto.textContent,'Cambiar foto');
 owner.ids.pfPhoto.listeners.load();
 assert.equal(owner.ids.pfPhoto.hidden,false);
 owner.ids.pfPhoto.listeners.error();
 assert.equal(owner.ids.pfPhoto.hidden,true,'initials stay in place if the member photo cannot load');
 owner.setLang('pt');
 assert.equal(owner.ids.pfChoosePhoto.textContent,'Alterar foto');

 let writes=0;
 const other=page({me:{...ana,photoUrl},other:ana.id,photoWrite:()=>{writes++;}});
 await flush();
 assert.equal(other.ids.pfPhoto.getAttribute('src'),photoUrl);
 assert.equal(other.ids.pfPhotoTools.hidden,true);
 await other.ids.pfRemovePhoto.listeners.click();
 assert.equal(writes,0);

 const external=page({me:{...ana,photoUrl:'https://elsewhere.example/api/users/ana-id/photo?v=one'},other:ana.id});
 await flush();
 assert.equal(external.ids.pfPhoto.getAttribute('src'),null);
});

test('photo preview sends a bounded JPEG only after Save, survives a failed upload and can be removed', async () => {
 const saved='/api/users/ana-id/photo?v=saved',writes=[];
 const h=page({me:ana,photoWrite:async options=>{
   writes.push(options);
   if(writes.length===1)return {status:503,ok:false,json:async()=>({})};
   return {status:200,ok:true,json:async()=>({photoUrl:options.method==='DELETE'?null:saved})};
 }});
 await flush();
 assert.equal(h.ids.pfChoosePhoto.textContent,'Añadir foto');
 assert.equal(h.ids.pfRemovePhoto.hidden,true);
 const file={name:'site.png',type:'image/png'};
 const jpeg=new Blob(['normalized'],{type:'image/jpeg'});
 let draw,closed=false,encoded=0;
 h.context.createImageBitmap=async()=>({width:900,height:600,close(){closed=true;}});
 h.context.FileReader=class {readAsDataURL(){this.result='data:image/jpeg;base64,bm9ybWFsaXplZA==';this.onload();}};
 const create=h.context.document.createElement;
 h.context.document.createElement=tag=>tag!=='canvas'?create(tag):{
   getContext:()=>({fillRect(){},drawImage(...args){draw=args.slice(1);}}),
   toBlob(fn,type){assert.equal(type,'image/jpeg');fn(++encoded===1?new Blob([new Uint8Array(140000)],{type}):jpeg);},
 };
 h.ids.pfPhotoFile.files=[file];
 await h.ids.pfPhotoFile.listeners.change();
 assert.deepEqual(draw,[150,0,600,600,0,0,512,512]);
 assert.ok(closed);
 assert.equal(encoded,2);
 assert.equal(writes.length,0);
 assert.equal(h.ids.pfSavePhoto.hidden,false);
 assert.equal(h.ids.pfSavePhoto.focused,true);
 await h.ids.pfSavePhoto.listeners.click();
 assert.equal(h.ids.pfSavePhoto.hidden,false,'a failed save keeps the prepared photo');
 assert.equal(h.ids.pfPhotoStatus.dataset.error,'true');
 await h.ids.pfSavePhoto.listeners.click();
 assert.equal(writes[1].method,'PUT');
 assert.equal(writes[1].headers['Content-Type'],'image/jpeg');
 assert.equal(writes[1].body,jpeg);
 assert.equal(h.ids.pfPhoto.getAttribute('src'),saved);
 assert.equal(h.ids.pfRemovePhoto.hidden,false);
 await h.ids.pfRemovePhoto.listeners.click();
 assert.equal(writes[2].method,'DELETE');
 assert.equal(h.ids.pfPhoto.getAttribute('src'),null);
 assert.equal(h.ids.pfChoosePhoto.textContent,'Añadir foto');
 assert.equal(h.ids.pfPhotoStatus.textContent,'Foto eliminada.');
 h.ids.pfPhotoFile.files=[{type:'text/plain',name:'not-a-picture.txt'}];
 await h.ids.pfPhotoFile.listeners.change();
 assert.equal(h.ids.pfPhotoStatus.dataset.error,'true');
 assert.equal(writes.length,3);
});
