import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mergeProgramme} from '../server/fiiu-programme.js';
import {createFiiuHarness,flush} from './helpers/fiiu-ui-harness.js';

/* Sharing a badge: one control in fiiu-ui.js (Fiiu.shareControl) used by the check-in confirmation and the console's
   Recognition ledger. It hands a short text with the public festival site to the phone's share sheet, or copies it. */
const SITE='https://fiiu.sistemaurbano.org/';
const CODE='Ab3dEf6hIj9kLm2nOp5qRs';
const EVENT=JSON.parse(JSON.stringify(mergeProgramme()));
const FIVE=['day1-am','day1-pm','day2-am','day2-pm','day3-am'];
const rows=(...ids)=>ids.map((activityId,i)=>({activityId,createdAt:`2026-10-2${1+(i%5)}T14:12:00.000Z`,method:'qr'}));
function fiiu(lang){
 const context={window:{nodalI18n:{lang,onChange(){}}},document:{documentElement:{lang},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);
 return context.window.Fiiu;
}
const frozen=iso=>{const at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};};
const publicData={event:EVENT,config:{registrationOpen:true,programUrl:''},content:[],nextCursor:null};
const scan=(activityId,list,result='checked_in')=>({status:result==='checked_in'?201:200,data:{result,activityId,checkedInAt:list.find(r=>r.activityId===activityId).createdAt,method:'qr',attendance:list,hours:{minutes:0,hours:0,untimed:[]}}});
// A check-in page on a phone: navigator as given (share sheet, clipboard), the rest as the harness makes it.
async function checkin(answer,navigator,{activity='day1-am'}={}){
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?publicData:answer,{page:'fiiu-checkin',search:`?a=${activity}&c=${CODE}`,context:{Date:frozen('2026-10-21T09:12:00-05:00'),navigator:{wakeLock:{request:async()=>({release:async()=>{},addEventListener(){}})},...navigator}}});
 await flush();return h;
}
const shareButton=h=>h.root.querySelector('.f-unlocked')?.querySelector('.f-share-button')??null;
const press=async node=>{await node.listeners.click();await flush();};
const sheet=()=>{const shared=[];return {shared,share:async data=>{shared.push(data);}};};

test('every earned FIIU badge has a short text to share in the reader’s language: the block’s title, the public festival site and #FIIU11, nothing personal',()=>{
 const attended=rows(...FIVE,'day0-lab','workshop-calles-gente','workshop-mapa-empatia','route-arcoiris','route-lima-cromatica');
 for(const lang of ['en','es','pt']){
  const Fiiu=fiiu(lang),badges=Fiiu.festivalBadges(null,attended,EVENT),earned=badges.filter(badge=>badge.state==='earned');
  assert.equal(earned.length,14,'ten sessions and four milestones');
  for(const badge of earned){
   const text=Fiiu.shareText(badge,badges);
   assert.ok(text.includes(SITE)&&text.endsWith('#FIIU11'),`${lang} ${badge.id}: ${text}`);
   assert.doesNotMatch(text,/@|\{|\}|undefined|null|nodal_|\?c=/,`${lang} ${badge.id}: no placeholder, address or code`);
   assert.deepEqual([...text.match(/https?:\/\/\S+/g)],[SITE],`${lang} ${badge.id}: the festival site is its only address`);
   assert.doesNotMatch(text.replace(SITE,''),/https?:|www\.|\.html\b|\b[a-z0-9-]+\.(?:org|com|pe|net|app)\b/i,`${lang} ${badge.id}: no other address`);
   if(badge.kind==='session')assert.ok(badge.activity.registration==='application'||text.includes(badge.activity.title),`${lang} ${badge.id} names its block`);
  }
 }
 const es=fiiu('es'),badges=es.festivalBadges(null,attended,EVENT),of=id=>es.shareText(badges.find(badge=>badge.id===id),badges);
 assert.equal(of('session:day1-am'),`Estuve en «El poder de lo local» del FIIU Fest 11 en Lima. Ideas para la ciudad que nacen de lo local. Programa: ${SITE} #FIIU11`);
 assert.equal(of('session:route-arcoiris').startsWith('Participé en «'),true,'a workshop or route');
 assert.equal(of('session:day0-lab'),`Participé en el laboratorio para funcionarios públicos del FIIU Fest 11. Gestión pública pensada desde lo local. ${SITE} #FIIU11`);
 assert.equal(of('milestone:first'),`Mi primera actividad del FIIU Fest 11 fue «Gestión urbana en acción: nuevas herramientas para la gestión local». ${SITE} #FIIU11`,'the first attended block in programme order');
 assert.equal(of('milestone:four'),`Asistí a cuatro de los cinco paneles del FIIU Fest 11 en Lima. ${SITE} #FIIU11`,'nothing that reads wrong after the festival');
 assert.equal(of('milestone:conferences'),`Completé los cinco paneles del FIIU Fest 11. Tres días de ideas sobre el poder de lo local. ${SITE} #FIIU11`);
 assert.equal(of('milestone:full'),`Completé el FIIU Fest 11: los cinco paneles, talleres y rutas urbanas por Lima. ${SITE} #FIIU11`);
 // A title is put in as written: its own “ ” become ‘ ’ inside the English and Portuguese “ ”, and "$&" or "{site}" in it stay as they are.
 const en=fiiu('en'),odd={kind:'session',state:'earned',activity:{registration:'external',period:'workshop',title:'Vivero “Lomita” $& {site}'}};
 assert.equal(en.shareText(odd,[odd]),`I took part in “Vivero ‘Lomita’ $& {site}” at FIIU Fest 11: learning by doing, out in the city. See the programme: ${SITE} #FIIU11`);
 assert.equal(es.shareText(odd,[odd]),`Participé en «Vivero “Lomita” $& {site}» del FIIU Fest 11: aprender haciendo, en la ciudad. Mira el programa: ${SITE} #FIIU11`);
 // Every share string exists in English, Spanish and Portuguese.
 const strings=es.rows,keys=Object.keys(strings).filter(name=>/^share|^copyBadgeText$/.test(name));
 assert.ok(keys.length>=11,keys.join());
 for(const name of keys)assert.ok(strings[name].length===3&&strings[name].every(text=>typeof text==='string'&&text.trim()),name);
});

test('after a first scan the confirmation offers Share, which opens the phone’s share sheet with the first-activity text, never the check-in code',async()=>{
 const phone=sheet(),h=await checkin(scan('day1-am',rows('day1-am')),phone);
 const button=shareButton(h);assert.ok(button,'a share button under the unlocked badge');
 assert.deepEqual(h.root.querySelector('.f-share').children.filter(node=>node.tagName==='button').map(node=>node.dataset.fiiuText),['shareBadge','copyBadgeText'],'Copy text sits next to Share');
 assert.equal(button.tagName,'button');assert.equal(button.type,'button');assert.equal(button.dataset.fiiuText,'shareBadge');assert.equal(button.textContent,'Share');
 const box=h.root.querySelector('.f-unlocked'),order=box.children.map(node=>node.className.split(' ')[0]);
 assert.ok(order.indexOf('f-share')<order.indexOf('f-text-link'),'before the way to the console');
 await press(button);
 assert.deepEqual(JSON.parse(JSON.stringify(phone.shared)),[{title:'FIIU Fest 11',text:`My first FIIU Fest 11 activity was “El poder de lo local”. ${SITE} #FIIU11`}]);
 assert.ok(phone.shared.every(data=>!JSON.stringify(data).includes(CODE)&&!('url' in data)),'the code and the page address never travel');
 h.lang('es');assert.equal(button.textContent,'Compartir');
 await press(button);assert.equal(phone.shared[1].text,`Mi primera actividad del FIIU Fest 11 fue «El poder de lo local». ${SITE} #FIIU11`,'the text follows the language at the moment of sharing');
});

test('a scan that reaches a milestone shares the furthest one, else the block itself; a repeat scan has nothing new, so nothing to share',async()=>{
 const four=sheet(),panels=rows(...FIVE.slice(0,4)),h4=await checkin(scan('day2-pm',panels),four,{activity:'day2-pm'});
 await press(shareButton(h4));assert.match(four.shared[0].text,/^I went to four of the five FIIU Fest 11 panels in Lima\./);
 const five=sheet(),h5=await checkin(scan('day3-am',rows(...FIVE)),five,{activity:'day3-am'});
 await press(shareButton(h5));assert.match(five.shared[0].text,/^I went to all five FIIU Fest 11 panels\./,'All five panels before the block itself');
 // The most common scan: a panel after the first reaches no milestone, so it shares the block.
 const second=sheet(),h2=await checkin(scan('day1-pm',rows('day1-am','day1-pm')),second,{activity:'day1-pm'}),title=EVENT.activities.find(a=>a.id==='day1-pm').title;
 await press(shareButton(h2));
 assert.equal(second.shared[0].text,`I was at “${title}” at FIIU Fest 11 in Lima. Ideas for the city that start at the local level. Programme: ${SITE} #FIIU11`);
 const full=sheet(),journey=rows('workshop-calles-gente','workshop-mapa-empatia','route-arcoiris','route-lima-cromatica',...FIVE),hf=await checkin(scan('day3-am',journey),full,{activity:'day3-am'});
 await press(shareButton(hf));assert.match(full.shared[0].text,/^I completed FIIU Fest 11: all five panels, workshops and urban routes around Lima\./,'Full FIIU before All five panels');
 const again=await checkin(scan('day1-am',rows('day1-am'),'already_checked_in'),sheet());
 assert.equal(shareButton(again),null);assert.equal(again.root.querySelector('.f-share'),null);
});

test('without a share sheet the button copies the text and says so; a refused clipboard shows the text to copy by hand',async()=>{
 const copied=[],h=await checkin(scan('day1-am',rows('day1-am')),{clipboard:{writeText:async text=>{copied.push(text);}}});
 const button=shareButton(h);assert.equal(button.dataset.fiiuText,'copyBadgeText');assert.equal(button.textContent,'Copy text');
 await press(button);
 assert.deepEqual(copied,[`My first FIIU Fest 11 activity was “El poder de lo local”. ${SITE} #FIIU11`]);
 assert.equal(h.root.querySelector('.f-share').children.filter(node=>node.tagName==='button').length,1,'no share sheet: Copy text alone');
 const note=h.root.querySelector('.f-share-note');assert.equal(note.dataset.fiiuText,'shareCopied');assert.equal(note.role,'status');
 const refused=await checkin(scan('day1-am',rows('day1-am')),{clipboard:{writeText:async()=>{throw new Error('denied');}}});
 await press(shareButton(refused));
 const area=refused.root.querySelector('.f-share-text');assert.equal(area.tagName,'textarea');assert.equal(area.readOnly,true);
 assert.match(area.value,/^My first FIIU Fest 11 activity/);assert.equal(refused.root.querySelector('.f-share-note').dataset.fiiuText,'shareManual');
 assert.equal(area['aria-labelledby'],refused.root.querySelector('.f-share-note').id,'the note names the text box, in the language on screen');
 refused.lang('es');assert.equal(refused.root.querySelector('.f-share-note').textContent,'Copia este texto:');
 assert.match(refused.root.querySelector('.f-share-text').value,/^Mi primera actividad del FIIU Fest 11/,'the text to copy follows a language switch');
 refused.lang('en');
 // Pressing again does not pile up a second copy of the text.
 await press(shareButton(refused));assert.equal(refused.root.querySelectorAll('.f-share-text').length,1);
 const bare=await checkin(scan('day1-am',rows('day1-am')),{});await press(shareButton(bare));
 assert.ok(bare.root.querySelector('.f-share-text'),'no share sheet and no clipboard: the text by hand');
});

test('closing the share sheet does nothing more; a share sheet that fails falls back to copying',async()=>{
 const copied=[],cancelled=await checkin(scan('day1-am',rows('day1-am')),{share:async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});},clipboard:{writeText:async text=>{copied.push(text);}}});
 await press(shareButton(cancelled));assert.deepEqual(copied,[],'the person closed it: nothing is copied');
 assert.equal(cancelled.root.querySelector('.f-share-note').textContent,'');
 const failing=await checkin(scan('day1-am',rows('day1-am')),{share:async()=>{throw Object.assign(new Error('nope'),{name:'NotAllowedError'});},clipboard:{writeText:async text=>{copied.push(text);}}});
 await press(shareButton(failing));assert.equal(copied.length,1);assert.equal(failing.root.querySelector('.f-share-note').dataset.fiiuText,'shareCopied');
});

test('Copy text works next to the share sheet, and a second tap while the sheet is open does nothing',async()=>{
 const copied=[];let open=0,finish;
 const h=await checkin(scan('day1-am',rows('day1-am')),{share:()=>{open++;return new Promise(resolve=>{finish=resolve;});},clipboard:{writeText:async text=>{copied.push(text);}}});
 const [share,copy]=h.root.querySelector('.f-share').children.filter(node=>node.tagName==='button');
 const first=share.listeners.click();await share.listeners.click();assert.equal(open,1,'one sheet at a time');
 await press(copy);assert.equal(copied.length,1,'Copy text works while a share sheet is still open');
 finish();await first;await flush();assert.equal(copied.length,1,'sharing itself copies nothing');
 await press(copy);assert.equal(copied.length,2,'a laptop’s share window lists apps; the text can still be copied');
 assert.equal(h.root.querySelector('.f-share-note').dataset.fiiuText,'shareCopied');
});

test('the share control is a 44px target on touch screens, and the text box never makes a phone zoom',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8');
 assert.match(css,/@media\(pointer:coarse\)\{[^}]*\.f-share-button\{[^}]*min-height:44px;min-width:44px/);
 assert.doesNotMatch(css,/\.f-share-note:empty\{display:none\}/,'the status line stays in the accessibility tree, emptied, not hidden');
 assert.match(css,/\.dash-page \.f-share-button:focus-visible/,'the check-in page keeps its own focus ring');
 assert.match(css,/\.f-share-text\{[^}]*font-size:16px/);
 assert.match(css,/\.f-share-button\{[^}]*background:none/,'a text button, like the way to the console');
});
