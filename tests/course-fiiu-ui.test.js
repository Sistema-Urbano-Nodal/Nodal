import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {FIIU_COURSE_PERK} from '../server/course-perks.js';

// What each viewer of the closed perk course sees (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, section 2),
// on the minimal DOM of tests/courses-ui.test.js.
const script=name=>readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8');
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.hidden=false;this.textContent='';this.value='';this.files=[];this.classList={toggle(){}};}
 append(...nodes){nodes.forEach(n=>{if(typeof n==='object'){detach(n);n.parent=this;}this.children.push(n);});}
 prepend(...nodes){nodes.forEach(n=>{detach(n);n.parent=this;});this.children.unshift(...nodes);}
 after(node){const p=this.parent;if(p){detach(node);node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
 get firstElementChild(){return this.children.find(n=>typeof n==='object')||null;}
 get nextElementSibling(){const siblings=this.parent?.children.filter(n=>typeof n==='object')||[],at=siblings.indexOf(this);return at<0?null:siblings[at+1]||null;}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this[k]=v;}
 getAttribute(k){return this[k]??null;}
 removeAttribute(k){delete this[k];}
 addEventListener(k,f){this.listeners[k]=f;}
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){this.focused=true;}
 scrollIntoView(){}
 reset(){}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const detach=node=>{if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);};
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
const keys=node=>descendants(node).map(n=>n.dataset.pilotText).filter(Boolean);
const find=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(respond,{page='course',search='?id=c1'}={}){
 const body=new Node('body');body.dataset.page=page;const html=new Node('html');const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[];
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign(){},replace(){}},fetch:async(path,opts)=>{requests.push({path,method:opts?.method});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},window:{addEventListener(){},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,run:name=>vm.runInContext(script(name),ctx),lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
}
const course={id:'c1',title:'Curso Movilidad Nivel 2',description:'Curso',startsOn:'2026-09-09',endsOn:'2026-09-30',status:'published',enrollmentOpen:false};
const modules=[{id:'m1',title:'Published session',sessionDate:'2026-09-09'}];
const preview=join=>({course,modules,enrollment:null,intake:null,isAdmin:false,perkCourse:true,join});
const member=answer=>(path,opts)=>path==='/api/auth/me'?{user:{permission:'member'}}:answer(path,opts);

test('a FIIU Fest 11 registrant is told the closed perk course is included, and joining leads to the intake form',async()=>{
 let enrolled=false;
 const h=harness(member(path=>{if(path.endsWith('/enroll')){enrolled=true;return{enrollment:{id:'e1'}};}return enrolled?{course,modules,enrollment:{id:'e1'},intake:null,isAdmin:false,perkCourse:true}:preview('fiiu');}));h.run('courses');await flush();
 assert.ok(keys(h.body).includes('fiiuIncluded'));
 for(const key of ['closed','closedNote','enroll','supportersOnly','supportersNote','switchAccount'])assert.equal(keys(h.body).includes(key),false,key);
 assert.match(content(h.body),/Included with your FIIU Fest 11 registration\./);assert.match(content(h.body),/1\. Published session/);
 const join=find(h.body,'joinCourse');assert.equal(join.tagName,'button');assert.equal(join.textContent,'Join the course');
 h.lang('es');assert.match(content(h.body),/Incluido con tu inscripción al FIIU Fest 11\./);assert.equal(join.textContent,'Unirme al curso');
 h.lang('pt');assert.match(content(h.body),/Incluído na sua inscrição no FIIU Fest 11\./);assert.equal(join.textContent,'Entrar no curso');
 h.lang('en');assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
 await join.listeners.click();await flush();
 assert.deepEqual(h.requests.filter(r=>r.method).map(r=>[r.method,r.path]),[['POST','/api/courses/c1/enroll']]);
 assert.match(content(h.body),/Your intake is private/);assert.equal(descendants(h.body).filter(n=>n.tagName==='form').length,1);
 assert.equal(keys(h.body).includes('joinCourse'),false);assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
});

test('anyone else sees the closed perk course is for members of the Founder Membership, with no way to join and no payment link',async()=>{
 const h=harness(member(()=>preview('supporters')));h.run('courses');await flush();
 for(const key of ['supportersOnly','supportersNote'])assert.ok(keys(h.body).includes(key),key);
 for(const key of ['enroll','joinCourse','fiiuIncluded','closed','closedNote','switchAccount'])assert.equal(keys(h.body).includes(key),false,key);
 assert.deepEqual(descendants(h.body).filter(n=>n.tagName==='a').map(n=>n.href),['courses.html']);
 assert.match(content(h.body),/For members of the Founder Membership/);// The course is a 2026 one: members join it during their early access, and it is not the course the membership includes in 2027 (terms, sections 4 and 15).
 assert.match(content(h.body),/Members of the Founder Membership can join this course during their 2026 early access, which opens soon; it is not the course included in 2027\. People already enrolled keep full access\./);assert.match(content(h.body),/1\. Published session/);
 h.lang('es');assert.match(content(h.body),/Para miembros de la Membresía Fundador/);assert.match(content(h.body),/Los miembros de la Membresía Fundador pueden sumarse a este curso durante su acceso anticipado de 2026, que abre pronto; no reemplaza el curso incluido en 2027\. Quienes ya están inscritos conservan el acceso completo\./);
 h.lang('pt');assert.match(content(h.body),/Para membros da Membresia Fundador/);assert.match(content(h.body),/Os membros da Membresia Fundador podem entrar neste curso durante o acesso antecipado de 2026, que abre em breve; ele não substitui o curso incluído em 2027\. Quem já está inscrito mantém o acesso completo\./);
 assert.doesNotMatch(content(h.body),/Supporter|membresía de apoyo|assinatura de apoio/);
 assert.equal(h.requests.some(r=>r.method||r.path.includes('/modules/')),false);
});

test('after the Founder Membership 2027 offer closed, the note says so and links nowhere',async()=>{
 const ended={checkout:false,provider:null,state:'ended',offer:{name:'Membresía Fundador 2027',version:'FUNDADORES-2027-v1'},annual:{amount:'Soon',per:''},options:[],contact:null};
 const h=harness(member(path=>path==='/api/billing/config'?ended:preview('supporters')));h.run('courses');await flush();
 for(const key of ['supportersOnly','supportersNoteEnded'])assert.ok(keys(h.body).includes(key),key);
 for(const key of ['supportersNote','supportersNoteOpen','becomeSupporter'])assert.equal(keys(h.body).includes(key),false,key);
 assert.deepEqual(descendants(h.body).filter(n=>n.tagName==='a').map(n=>n.href),['courses.html']);
 assert.match(content(h.body),/Members of the Founder Membership could join this course during their 2026 early access, which ended on 31 December 2026; it is not the course included in 2027\. People already enrolled keep full access\./);
 h.lang('es');assert.match(content(h.body),/Los miembros de la Membresía Fundador podían sumarse a este curso durante su acceso anticipado de 2026, que terminó el 31 de diciembre de 2026; no reemplaza el curso incluido en 2027\. Quienes ya están inscritos conservan el acceso completo\./);
 h.lang('pt');assert.match(content(h.body),/Os membros da Membresia Fundador podiam entrar neste curso durante o acesso antecipado de 2026, encerrado em 31 de dezembro de 2026; ele não substitui o curso incluído em 2027\. Quem já está inscrito mantém o acesso completo\./);
});

test('while Founder Membership sign-ups are open, the note says so and its button leads to the payments page',async()=>{
 const open={checkout:true,provider:'mercadopago',state:'open',offer:{name:'Membresía Fundador 2027',version:'FUNDADORES-2027-v1'},annual:{amount:'S/ 499',per:''},options:[{id:'once',amount:'S/ 499'}],contact:{email:'membresia@sistemaurbano.org',complaintsUrl:'https://reclamos.example.pe'}};
 const h=harness(member(path=>path==='/api/billing/config'?open:preview('supporters')));h.run('courses');await flush();
 for(const key of ['supportersOnly','supportersNoteOpen','becomeSupporter'])assert.ok(keys(h.body).includes(key),key);
 assert.equal(keys(h.body).includes('supportersNote'),false,'it no longer says the membership opens soon');
 const join=find(h.body,'becomeSupporter');assert.equal(join.tagName,'a');assert.equal(join.href,'payments.html');
 // The course pilot hides every link to the payments page (courses.css) except this one, which exists only while a link takes payments.
 assert.equal(join.dataset.supporterLink,'');
 const css=readFileSync(new URL('../web/styles/courses.css',import.meta.url),'utf8');
 assert.match(css,/html:not\(\[data-pilot="false"\]\) a\[href\*="payments\.html"\]:not\(\[data-supporter-link\]\)/);
 assert.match(content(h.body),/Members of the Founder Membership can join this course during their 2026 early access; it is not the course included in 2027\. People already enrolled keep full access\./);assert.equal(join.textContent,'Join the Founder Membership');
 h.lang('es');assert.match(content(h.body),/Los miembros de la Membresía Fundador pueden sumarse a este curso durante su acceso anticipado de 2026; no reemplaza el curso incluido en 2027\. Quienes ya están inscritos conservan el acceso completo\./);assert.equal(join.textContent,'Únete a la Membresía Fundador');
 h.lang('pt');assert.match(content(h.body),/Os membros da Membresia Fundador podem entrar neste curso durante o acesso antecipado de 2026; ele não substitui o curso incluído em 2027\. Quem já está inscrito mantém o acesso completo\./);assert.equal(join.textContent,'Junte-se à Membresia Fundador');
 assert.equal(h.requests.filter(r=>r.path==='/api/billing/config').length,1);assert.equal(h.requests.some(r=>r.method),false);
});

test('the survey reminder link opened with a FIIU-registered account that is not enrolled offers another account, never Join',async()=>{
 const h=harness(member(()=>preview('fiiu')),{search:'?id=c1&encuesta=1'});h.run('courses');await flush();
 for(const key of ['fiiuIncluded','surveyUnavailable','surveyOtherAccount','switchAccount'])assert.ok(keys(h.body).includes(key),key);
 for(const key of ['joinCourse','enroll','closed','closedNote'])assert.equal(keys(h.body).includes(key),false,key);
 // The Supporters state keeps the helper too, as any closed course does.
 const supporters=harness(member(()=>preview('supporters')),{search:'?id=c1&encuesta=1'});supporters.run('courses');await flush();
 for(const key of ['supportersNote','switchAccount'])assert.ok(keys(supporters.body).includes(key),key);
 assert.equal(keys(supporters.body).includes('joinCourse'),false);
 assert.equal([...h.requests,...supporters.requests].some(r=>r.method),false);
});

test('a Join refused because the registration no longer qualifies reads the course again instead of keeping the old offer',async()=>{
 let reads=0;
 const h=harness(member((path,opts)=>{if(opts?.method==='POST')return{status:403,data:{error:'enrollment is closed',code:'enrollment_closed'}};reads++;return preview(reads===1?'fiiu':'supporters');}));h.run('courses');await flush();
 await find(h.body,'joinCourse').listeners.click();await flush();
 assert.equal(h.requests.filter(r=>r.path.endsWith('/enroll')).length,1);assert.equal(h.requests.filter(r=>r.path==='/api/courses/c1').length,2);
 for(const key of ['supportersOnly','supportersNote'])assert.ok(keys(h.body).includes(key),key);
 for(const key of ['joinCourse','fiiuIncluded','closed'])assert.equal(keys(h.body).includes(key),false,key);
 // If that read fails too, the offer stays with its button enabled and the status line says why.
 let failing=0;
 const offline=harness(member((path,opts)=>opts?.method==='POST'?{status:403,data:{error:'enrollment is closed',code:'enrollment_closed'}}:++failing===1?preview('fiiu'):{status:503,data:{error:'unavailable'}}));offline.run('courses');await flush();
 const join=find(offline.body,'joinCourse');await join.listeners.click();await flush();
 assert.equal(find(offline.body,'joinCourse'),join);assert.equal(join.disabled,false);assert.equal(offline.ids.pilotStatus.textContent,'Could not complete this request.');
});

test('each course card says where the viewer stands: enrolled, included with FIIU, for Supporters or closed',async()=>{
 const card={...course,enrollmentOpen:true,enrolled:false};
 const courses=[{...card,id:'open'},{...card,id:'mine',enrollmentOpen:false,enrolled:true},{...card,id:'perk',enrollmentOpen:false,join:'fiiu'},{...card,id:'paid',enrollmentOpen:false,join:'supporters'},{...card,id:'finished',enrollmentOpen:false},{...card,id:'joined',enrolled:true}];
 const LABELS=['enrolledTag','fiiuTag','supportersOnly','closed'];
 const labels=body=>descendants(body).filter(n=>n.className==='pilot-course-row').map(row=>descendants(row).filter(n=>LABELS.includes(n.dataset.pilotText)));
 const h=harness(member(()=>({courses,isAdmin:false})),{page:'courses',search:''});h.run('courses');await flush();
 assert.deepEqual(labels(h.body).map(row=>row.map(n=>n.dataset.pilotText)),[[],['enrolledTag'],['fiiuTag'],['supportersOnly'],['closed'],['enrolledTag']]);
 assert.ok(labels(h.body).flat().every(n=>n.className==='pilot-date'));
 const texts=()=>labels(h.body).flat().map(n=>n.textContent);
 assert.deepEqual(texts(),['Enrolled','Included with FIIU','For members of the Founder Membership','Enrollment closed','Enrolled']);
 h.lang('es');assert.deepEqual(texts(),['Inscrito','Incluido con el FIIU','Para miembros de la Membresía Fundador','Inscripciones cerradas','Inscrito']);
 h.lang('pt');assert.deepEqual(texts(),['Inscrito','Incluído com o FIIU','Para membros da Membresia Fundador','Inscrições encerradas','Inscrito']);
 // Staff see the cards as before: closed or nothing, enrolled or not (the server sends them no join).
 const staff=harness(member(()=>({courses:courses.map(({join,...c})=>c),isAdmin:true})),{page:'courses',search:''});staff.run('courses');await flush();
 assert.deepEqual(labels(staff.body).map(row=>row.map(n=>n.dataset.pilotText)),[[],['closed'],['closed'],['closed'],['closed'],[]]);
});

test('on the perk course the conversation says, above its posts, that September contributions stay with the September group',async()=>{
 const module={id:'m1',title:'Session',resources:[]};
 const open=(viewer,perkCourse=true)=>{const h=harness(member(path=>path.endsWith('/events')?{ok:true}:path.includes('/posts')?{posts:[],nextCursor:null}:{course:{...course,enrollmentOpen:true},modules:[module],...viewer,...(perkCourse?{perkCourse:true}:{})}));h.run('courses');return h;};
 const september={enrollment:{id:'e1',createdAt:'2026-09-06T15:00:00Z'},intake:{fullName:'Member'},isAdmin:false},october={enrollment:{id:'e2',createdAt:'2026-10-19T15:00:00Z'},intake:{fullName:'Member'},isAdmin:false},staff={enrollment:null,intake:null,isAdmin:true};
 for(const viewer of [september,october,staff]){
  const h=open(viewer);await flush();
  for(const pane of ['discussion','assignment']){
   const section=h.ctx.document.getElementById('module-pane-'+pane),note=find(section,'sharedSince'),list=section.querySelector('.pilot-post-list');
   assert.ok(note&&list,pane);assert.equal(note.parent,section);assert.ok(section.children.indexOf(note)<section.children.indexOf(list),pane);
  }
  const note=find(h.ctx.document.getElementById('module-pane-discussion'),'sharedSince');
  assert.equal(note.textContent,'Since October, new participants join this conversation. Contributions from September stay visible to the September group only.');
  h.lang('es');assert.equal(note.textContent,'Desde octubre se suman nuevas personas a esta conversación. Las contribuciones de septiembre solo las ve el grupo de septiembre.');
  h.lang('pt');assert.equal(note.textContent,'Desde outubro, novas pessoas entram nesta conversa. As contribuições de setembro ficam visíveis só para a turma de setembro.');
 }
 const other=open(september,false);await flush();
 assert.ok(other.ctx.document.getElementById('module-pane-discussion'));assert.equal(keys(other.body).includes('sharedSince'),false);
});

test('the course answer marks the perk course, and no other, for members and staff',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const store=createCourseStore({db}),stamp='2026-09-01T12:00:00.000Z',other=randomUUID(),answers=[];
 for(const id of [FIIU_COURSE_PERK.courseId,other])await store.insert('courses',{id,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:stamp,updatedAt:stamp});
 const api=createCourseApi({store,sameOrigin:()=>true,send:(res,status,body)=>{answers.push({status,body});}});
 const read=async(id,user)=>{await api({req:{method:'GET',headers:{}},res:{},url:new URL('http://nodal.test/api/courses/'+id),user});return answers.at(-1);};
 for(const user of [{id:randomUUID(),permission:'member'},{id:randomUUID(),permission:'admin'}]){
  const perk=await read(FIIU_COURSE_PERK.courseId,user),plain=await read(other,user);
  assert.equal(perk.status,200);assert.equal(perk.body.perkCourse,true,user.permission);
  assert.equal(plain.status,200);assert.equal(Object.hasOwn(plain.body,'perkCourse'),false,user.permission);
 }
});
