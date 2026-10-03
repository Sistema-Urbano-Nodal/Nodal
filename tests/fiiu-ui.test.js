import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createFiiuHarness,key,field,descendants,content,flush,Node} from './helpers/fiiu-ui-harness.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,applyLab:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST123',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
const user={id:'00000000-0000-4000-8000-000000000001',email:'ana@example.test',name:'Ana Test',city:'Lima'};
const saved={userId:user.id,id:'00000000-0000-4000-8000-000000000002',version:1,email:user.email,answers,labStatus:'none'};
const self=registration=>({user,registration,attendance:[],isAdmin:false});
const publicData={event:FIIU_EVENT,config:{registrationOpen:true,programUrl:'https://canva.link/ficmkatcg9fudwk'},content:[],nextCursor:null};
// The page reads the news page (which carries the event and settings) and the materials page separately.
async function harness({registration=null,write=async()=>({status:503,data:{error:'unavailable'}}),read,publicRead=()=>publicData,materialsRead=()=>publicData,context}={}){
 let registrationReads=0;
 const h=await createFiiuHarness(request=>request.method!=='GET'?write(request):request.path==='/api/fiiu?kind=news'?publicRead():request.path==='/api/fiiu?kind=materials'?materialsRead():request.path==='/api/auth/state'?{authenticated:true}:read?read(++registrationReads):self(registration),{context});
 const form=()=>h.root.querySelector('form');
 const fill=()=>{for(const input of descendants(form()).filter(node=>node.name)){const value=answers[input.name];if(value!==undefined){if(input.type==='checkbox')input.checked=Array.isArray(value)?value.includes(input.value):value===true;else input.value=String(value);}}field(form(),'publicOfficial').value='no';};
 return{...h,form,fill,submit:()=>form().listeners.submit({preventDefault(){}})};
}

test('registration saving locks the full form, ignores duplicate submits and restores disabled controls after failure',async()=>{
 let finish;const h=await harness({write:()=>new Promise(resolve=>{finish=resolve;})});h.fill();const form=h.form(),name=field(form,'firstName'),lab=field(form,'applyLab'),institution=field(form,'institution');
 assert.equal(lab.disabled,true);assert.equal(institution.disabled,true);const pending=h.submit(),duplicate=h.submit();
 assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);assert.equal(name.disabled,true);assert.equal(field(form,'activities').disabled,true);assert.equal(form['aria-busy'],'true');
 assert.equal(h.requests.at(-1).body.firstName,'Ana');assert.deepEqual(h.requests.at(-1).body.activities,['day1-am']);assert.equal(h.requests.at(-1).body.expectedUserId,user.id);
 finish({status:503,data:{error:'unavailable'}});await Promise.all([pending,duplicate]);assert.equal(name.value,'Ana');assert.equal(name.disabled,false);assert.equal(lab.disabled,true);assert.equal(institution.disabled,true);assert.equal(form['aria-busy'],'false');assert.equal(key(form,'save').disabled,false);
});

test('cancellation prevents duplicate mutations and editing until its response arrives',async()=>{
 let finish;const h=await harness({registration:saved,write:()=>new Promise(resolve=>{finish=resolve;})});const cancel=key(h.root,'cancel'),edit=key(h.root,'edit');const pending=cancel.listeners.click(),duplicate=cancel.listeners.click(),save=h.submit();
 assert.equal(h.requests.filter(request=>request.method!=='GET').length,1);assert.equal(edit.disabled,true);assert.equal(cancel.disabled,true);assert.equal(h.requests.at(-1).body.expectedUserId,user.id);
 finish({status:503,data:{error:'unavailable'}});await Promise.all([pending,duplicate,save]);assert.equal(edit.disabled,false);assert.equal(cancel.disabled,false);assert.equal(field(h.form(),'applyLab').disabled,true);
});

test('a stale cancellation offers visible saved-state recovery and requires another cancellation decision',async()=>{
 let deletes=0;const latest={...saved,version:2,answers:{...answers,city:'Callao'}};
 const h=await harness({registration:saved,read:count=>self(count===1?saved:latest),write:()=>++deletes===1?{status:409,data:{error:'registration changed; reload before cancelling'}}:{ok:true}});
 await key(h.root,'cancel').listeners.click();const reload=key(h.root,'reloadSaved');assert.ok(reload);for(let node=reload;node;node=node.parent)assert.equal(node.hidden,false,'the recovery action must not be inside the hidden edit form');
 await reload.listeners.click();assert.equal(deletes,1);assert.equal(field(h.form(),'city').value,'Callao');await key(h.root,'cancel').listeners.click();assert.equal(deletes,2);const deletion=h.requests.filter(request=>request.method==='DELETE').at(-1);assert.equal(deletion.body.version,2);assert.equal(deletion.body.registrationId,saved.id);assert.ok(!key(h.root,'cancel'));
});

test('account changes preserve drafts and offer a distinct explicit reload instead of adopting another registration',async()=>{
 const h=await harness({write:()=>({status:409,data:{error:'account changed; reload before continuing'}})});h.fill();field(h.form(),'firstName').value='Unsaved Ana';await h.submit();
 assert.equal(field(h.form(),'firstName').value,'Unsaved Ana');assert.ok(!key(h.root,'viewSaved'));assert.ok(key(h.root,'accountChanged'));const reload=key(h.root,'reloadAccount');assert.ok(reload);assert.equal(h.reloads(),0);await reload.listeners.click();assert.equal(h.reloads(),1);
});

test('conflict recovery rejects an account switch between saving and reviewing the current registration',async()=>{
 const other={...user,id:'00000000-0000-4000-8000-000000000003',email:'other@example.test'};
 const h=await harness({write:()=>({status:409,data:{error:'registration changed; reload before saving'}}),read:count=>count===1?self(null):{...self(saved),user:other}});h.fill();await h.submit();await key(h.root,'viewSaved').listeners.click();
 assert.equal(field(h.form(),'firstName').value,'Ana');assert.ok(!key(h.root,'useLatest'));assert.ok(key(h.root,'reloadAccount'));assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
});

test('a cancelled registration can be reconciled after an ambiguous network failure without resubmitting deletion',async()=>{
 const h=await harness({registration:saved,read:count=>self(count===1?saved:null),write:()=>{throw new TypeError('connection lost after deletion');}});await key(h.root,'cancel').listeners.click();await key(h.root,'reloadSaved').listeners.click();assert.ok(!key(h.root,'cancel'));assert.equal(h.requests.filter(request=>request.method==='DELETE').length,1);assert.equal(h.form().hidden,false);
});


test('the programme, both feeds and self-registration start together (three requests) without an auth-state round trip',async()=>{
 let finish;const h=await harness({publicRead:()=>new Promise(resolve=>{finish=resolve;})});
 assert.deepEqual(h.requests.map(request=>request.path).sort(),['/api/fiiu/registration','/api/fiiu?kind=materials','/api/fiiu?kind=news']);finish(publicData);
});

test('only a registration 401 becomes a guest view; service failures remain retryable errors',async()=>{
 const guest=await harness({read:()=>({status:401,data:{error:'sign in required'}})});assert.ok(key(guest.root,'signin'));assert.equal(guest.form(),null);assert.ok(!key(guest.root,'retry'));assert.ok(!guest.requests.some(request=>request.path==='/api/auth/state'));
 const outage=await harness({read:()=>({status:503,data:{error:'unavailable'}}),materialsRead:()=>({status:503,data:{error:'unavailable'}})});assert.ok(key(outage.root,'retry'));assert.ok(!key(outage.root,'signin'));assert.equal(outage.form(),null);
});

test('the programme is a prominent action and the laboratory card omits unknown time and venue',async()=>{
 const h=await harness(),actions=h.root.querySelector('.f-hero-copy').querySelector('.f-actions');
 assert.equal(key(actions,'officialProgram').href,'https://canva.link/ficmkatcg9fudwk');
 const lab=h.root.querySelectorAll('.f-activity').find(node=>content(node).includes('Gestión urbana en acción'));
 assert.ok(key(lab,'apply'));assert.equal(key(lab,'timePending'),undefined);assert.equal(key(lab,'venuePending'),undefined);
 assert.equal(lab.querySelector('.f-period'),null,'the laboratory card should contain its title and application action only');
 for(const lang of ['en','es','pt']){h.lang(lang);assert.doesNotMatch(content(h.root),/pre-register|pre-registration|preinscri|pré-inscri/i);}
});

test('external-only interest saves separately from conferences and keeps its required Google Form link',async()=>{
 const activity={id:'workshop-test',date:'2026-10-22',period:'workshop',registration:'external',title:'Taller de prueba',time:'',venue:'',sessions:[],formUrl:'https://forms.gle/testActivity'};
 const event={...FIIU_EVENT,activities:[...FIIU_EVENT.activities.filter(item=>item.registration!=='external'),activity]};
 const h=await harness({publicRead:()=>({...publicData,event}),write:request=>({registration:{...saved,answers:request.body}})});h.fill();
 for(const input of descendants(h.form()).filter(node=>node.name==='activities'))input.checked=false;
 const interest=field(h.form(),'externalActivities');assert.ok(interest);interest.checked=true;
 const activityLink=h.form().querySelectorAll('a').find(node=>node.href===activity.formUrl);
 assert.ok(activityLink);assert.equal(activityLink.target,'_blank');
 await h.submit();
 const body=h.requests.find(request=>request.method==='PUT').body;
 assert.deepEqual(body.activities,[]);assert.deepEqual(body.externalActivities,['workshop-test']);assert.equal(body.externalCompleted,undefined);
 const summary=h.root.querySelector('.f-saved');assert.ok(key(summary,'externalActivities'));assert.ok(key(summary,'externalInterestHint'));
 assert.ok(summary.querySelectorAll('a').some(node=>node.href===activity.formUrl));
});

test('questionnaire requirements stay visible and Other text is required only when selected',async()=>{
 const h=await harness();h.fill();
 for(const name of ['nationalId','age','gender','motivation','previousAttendance']){const input=field(h.form(),name);assert.equal(input.required,true,name);for(let node=input;node;node=node.parent)assert.notEqual(node.tagName,'details','required questions must not be hidden in a closed disclosure');}
 const nationalId=field(h.form(),'nationalId');nationalId.value='';await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);nationalId.value='TEST123';
 const accessibility=descendants(h.form()).filter(node=>node.name==='accessibility');accessibility.forEach(input=>{input.checked=false;});await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0,'accessibility requires an explicit answer');
 const other=accessibility.find(input=>input.value==='other');other.checked=true;other.listeners.change();
 const accessText=field(h.form(),'accessibilityOther');assert.equal(accessText.required,true);assert.equal(accessText.disabled,false);
 await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);accessText.value='Support requested';
 const motivation=field(h.form(),'motivation');motivation.value='other';motivation.listeners.change();const motivationText=field(h.form(),'motivationOther');assert.equal(motivationText.required,true);
 await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);motivationText.value='Another reason';
 await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);assert.equal(h.requests.at(-1).body.accessibilityOther,'Support requested');
 motivation.value='learn';motivation.listeners.change();assert.equal(motivationText.disabled,true);assert.equal(motivationText.required,false);
 const none=accessibility.find(input=>input.value==='none');none.checked=true;none.listeners.change();assert.equal(other.checked,false);assert.equal(accessText.disabled,true);assert.equal(accessText.required,false);
});

test('historical incomplete registrations remain readable without silently discarding their saved state',async()=>{
 const old={...saved,answers:{firstName:'Ana',lastName:'Test',activities:['day1-am'],privacyAccepted:true}};
 const h=await harness({registration:old});assert.ok(h.root.querySelector('.f-saved'));assert.ok(key(h.root,'cancel'));
 assert.equal(field(h.form(),'nationalId').value,'');assert.equal(field(h.form(),'nationalId').required,true);assert.equal(h.requests.filter(request=>request.method!=='GET').length,0);
});

test('saved workshop and route interests are listed chronologically, not in id order',async()=>{
 const h=await harness({registration:{...saved,answers:{...answers,externalActivities:['route-amancaes','workshop-calles-gente']}}});
 const lists=h.root.querySelector('.f-saved').querySelectorAll('.f-itinerary');assert.equal(lists.length,2);
 assert.deepEqual(lists[1].querySelectorAll('.f-itinerary-row').map(row=>row.querySelector('[data-fiiu-date]').dataset.fiiuDate),['2026-10-22','2026-10-24']);
 assert.ok(lists[1].querySelectorAll('a').every(node=>node.target==='_blank'&&node['aria-describedby'].split(' ').includes('f-newtab')));
});

test('a registration without any conference, interest or laboratory choice is blocked before it reaches the server',async()=>{
 const h=await harness();h.fill();
 for(const input of descendants(h.form()).filter(node=>['activities','externalActivities','applyLab'].includes(node.name)))input.checked=false;
 await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);
 assert.equal(field(h.form(),'activities').validationMessage,h.ctx.window.Fiiu.t('chooseActivity'));
 field(h.form(),'externalActivities').checked=true;await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
});

test('a successful cancellation announces itself and returns the page to its unregistered state',async()=>{
 const h=await harness({registration:saved,write:()=>({ok:true})});
 assert.ok(key(h.root.querySelector('.f-hero'),'viewRegistration'));
 await key(h.root,'cancel').listeners.click();
 assert.ok(key(h.root,'cancelled'));assert.ok(!key(h.root,'cancel'));
 const hero=h.root.querySelector('.f-hero');assert.ok(key(hero,'register'));assert.ok(!key(hero,'viewRegistration'));assert.ok(!key(hero,'statusRegistered'));
});

test('programme cards reflect the saved registration and pre-select a conference block in the form',async()=>{
 const card=(h,title)=>h.root.querySelectorAll('.f-activity').find(node=>content(node).includes(title));
 const registered=await harness({registration:{...saved,labStatus:'pending'}}),mine=card(registered,'El poder de lo local');
 assert.ok(key(mine,'statusRegistered'));assert.ok(!key(mine,'addToRegistration'));
 const lab=card(registered,'Gestión urbana en acción');assert.ok(key(lab,'pendingShort'));assert.ok(!key(lab,'apply'));
 const status=registered.root.querySelector('.f-hero-status');assert.ok(key(status,'statusRegistered'));assert.ok(key(status,'pendingShort'));
 const fresh=await harness(),other=card(fresh,'Cuidar y transformar la ciudad'),input=descendants(fresh.form()).find(node=>node.name==='activities'&&node.value==='day2-am');
 assert.equal(input.checked,false);await key(other,'addToRegistration').listeners.click();assert.equal(input.checked,true);assert.equal(input.focused,true);
 assert.equal(fresh.requests.filter(request=>request.method!=='GET').length,0);
});

test('external links are described as opening a new tab and the note exists once',async()=>{
 const h=await harness(),notes=descendants(h.root).filter(node=>node.id==='f-newtab');assert.equal(notes.length,1);
 const external=descendants(h.root).filter(node=>node.tagName==='a'&&node.target==='_blank');assert.ok(external.length>14);
 for(const node of external)assert.ok(node['aria-describedby'].split(' ').includes('f-newtab'),node.href);
 const forms=h.root.querySelector('.f-programme').querySelectorAll('a').filter(node=>node.dataset.fiiuText==='activityForm');
 assert.equal(new Set(forms.map(node=>node['aria-describedby'])).size,forms.length,'each activity form link is described by its own title');
});

test('answers start explicitly valid, and an auto-answered official question drops its earlier error before saving',async()=>{
 const h=await harness(),form=h.form(),official=field(form,'publicOfficial'),profile=field(form,'profile');
 assert.equal(form.noValidate,true,'the submit handler validates, so every rule is reported in one pass');
 assert.ok(descendants(form).filter(node=>['input','select','textarea'].includes(node.tagName)).every(node=>node['aria-invalid']==='false'),'nothing is announced as invalid before the person interacts');
 official.validity={valueMissing:true};form.listeners.invalid({target:official});
 assert.equal(official.validationMessage,h.ctx.window.Fiiu.t('requiredField'));assert.equal(official['aria-invalid'],'true');
 h.fill();delete official.validity;official.value='';profile.value='public_official';profile.listeners.change();
 assert.equal(official.value,'yes');assert.equal(official.validationMessage,'');assert.equal(official['aria-invalid'],'false');
 await h.submit();const put=h.requests.filter(request=>request.method==='PUT');assert.equal(put.length,1);assert.equal(put[0].body.publicOfficial,true);
});

test('keeping the current version after a conflict updates the hero and programme and returns focus to Save',async()=>{
 const h=await harness({registration:saved,read:count=>self(count===1?saved:null),write:()=>({status:409,data:{error:'registration changed; reload before saving'}})});
 key(h.root,'edit').listeners.click();await h.submit();await key(h.form(),'viewSaved').listeners.click();
 const use=key(h.form(),'useLatest');assert.equal(use.focused,true,'focus moves to the new action instead of falling to the page');assert.ok(key(h.form().querySelector('.f-selection'),'saveFailed'));use.listeners.click();assert.equal(key(h.form().querySelector('.f-selection'),'saveFailed'),undefined,'choosing the current version clears the failed-save cue');
 const hero=h.root.querySelector('.f-hero');assert.ok(key(hero,'register'));assert.ok(!key(hero,'statusRegistered'));assert.ok(!key(h.root.querySelector('.f-programme'),'statusRegistered'));
 assert.ok(key(h.form(),'latestCreate'));assert.equal(key(h.form(),'save').focused,true);assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
});

test('only short guest panels stay pinned; saved summaries scroll with the page and are named regions',async()=>{
 const guest=await harness({read:()=>({status:401,data:{error:'sign in required'}})});assert.equal(guest.root.querySelector('.f-registration').className,'f-registration is-compact');
 const member=await harness({registration:saved}),summary=member.root.querySelector('.f-saved');assert.equal(member.root.querySelector('.f-registration').className,'f-registration');
 assert.equal(summary['aria-labelledby'],descendants(summary).find(node=>node.dataset.fiiuText==='saved').id);
});

test('completed steps and session disclosures carry text for assistive technology',async()=>{
 const h=await harness();h.fill();h.form().listeners.change({target:field(h.form(),'firstName')});
 assert.ok(h.form().querySelectorAll('.f-step').every(step=>step['aria-describedby']==='f-step-done'));assert.ok(descendants(h.form()).find(node=>node.id==='f-step-done').hidden);
 const summaries=h.root.querySelector('.f-programme').querySelectorAll('summary');assert.ok(summaries.length>=3);
 assert.equal(new Set(summaries.map(node=>node['aria-describedby'])).size,summaries.length,'each sessions toggle is described by its own activity title');
});

test('news and materials page separately: newer materials never hide the news, and Load more stays focusable per section',async()=>{
 const item=(id,kind='news')=>({id,kind,title:'Item '+id,body:'',url:'',createdAt:'2026-09-29T12:00:00.000Z'});let fail=true;
 const materials=Array.from({length:100},(_,i)=>item('m'+i,i%2?'recording':'material'));
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{...publicData,content:[item('n1')],nextCursor:'c1'}:request.path==='/api/fiiu?kind=materials'?{...publicData,content:materials,nextCursor:'m99'}:request.path==='/api/fiiu?kind=news&cursor=c1'?(fail?{status:503,data:{error:'unavailable'}}:{content:[item('n2')],nextCursor:null}):request.path==='/api/fiiu?kind=materials&cursor=m99'?{content:[item('m100','material')],nextCursor:null}:self(null));
 assert.equal(h.requests.length,3);assert.ok(!h.requests.some(request=>request.path==='/api/fiiu'),'the mixed first page is no longer read');
 const [news,library]=['news','materials'].map(id=>descendants(h.root).find(node=>node.id===id)),titles=section=>section.querySelectorAll('h3').map(node=>node.textContent);
 assert.deepEqual(titles(news),['Item n1'],'100 newer materials leave the news in place');assert.equal(titles(library).length,100);assert.match(content(h.root.querySelector('.f-latest')),/Item n1/);
 const more=key(news,'loadMore'),feedback=news.querySelector('.f-load-more-status'),pending=more.listeners.click(),duplicate=more.listeners.click();
 assert.equal(more.disabled,false);assert.equal(more['aria-disabled'],'true');await Promise.all([pending,duplicate]);
 assert.equal(h.requests.filter(request=>request.path==='/api/fiiu?kind=news&cursor=c1').length,1);assert.equal(feedback.dataset.fiiuText,'error');assert.equal(h.message.dataset.fiiuText,'');assert.equal(more['aria-disabled'],undefined);
 assert.equal(key(library,'loadMore').hidden,false,'each section keeps its own Load more');assert.deepEqual([more,key(library,'loadMore')].map(button=>button['aria-describedby']),['f-news-heading','f-materials-heading'],'each Load more names its section');
 fail=false;await more.listeners.click();assert.equal(more.hidden,true);assert.equal(feedback.dataset.fiiuText,'');
 const heading=news.querySelectorAll('h3').find(node=>node.textContent==='Item n2');assert.equal(heading.focused,true);assert.equal(heading.tabIndex,-1);
 await key(library,'loadMore').listeners.click();assert.equal(titles(library).length,101);assert.equal(key(library,'loadMore').hidden,true);assert.deepEqual(titles(news),['Item n1','Item n2']);
});

test('a materials feed that fails leaves the programme, registration and news working, and offers Try again in place',async()=>{
 let fail=true;const recording={id:'r1',kind:'recording',title:'Opening recording',body:'',url:'https://example.test/recording',createdAt:'2026-10-21T12:00:00.000Z'};
 const h=await harness({publicRead:()=>({...publicData,content:[{id:'n1',kind:'news',title:'Festival announcement',body:'',url:''}]}),materialsRead:()=>fail?{status:503,data:{error:'unavailable'}}:{...publicData,content:[recording,{id:'n9',kind:'news',title:'Stray news',body:'',url:''}],nextCursor:null}});
 assert.ok(h.root.querySelector('.f-programme'));assert.ok(h.form());assert.equal(h.message.dataset.fiiuText,'');assert.ok(!key(h.root.querySelector('.f-programme'),'loadError'));assert.ok(!key(h.root.querySelector('.f-registration'),'loadError'));
 const library=descendants(h.root).find(node=>node.id==='materials'),news=descendants(h.root).find(node=>node.id==='news');
 assert.match(content(news),/Festival announcement/);assert.ok(key(library,'loadError'));const retry=key(library,'retry');assert.equal(retry.hidden,false);
 fail=false;await retry.listeners.click();assert.doesNotMatch(content(library),/Stray news/,'each section keeps to its own kinds');assert.equal(key(library,'retry'),undefined);assert.equal(key(library,'loadError'),undefined);assert.equal(key(library,'loadMore').hidden,true);assert.match(content(library),/Opening recording/);
 assert.equal(h.requests.filter(request=>request.path==='/api/fiiu?kind=materials').length,2);
});

test('answers hidden again drop their error, so the save bar and status never report a problem the person cannot see',async()=>{
 const h=await harness();h.fill();const form=h.form(),official=field(form,'publicOfficial'),apply=field(form,'applyLab'),institution=field(form,'institution'),motivation=field(form,'motivation'),other=field(form,'motivationOther'),selection=form.querySelector('.f-selection');
 official.value='yes';official.listeners.change();apply.checked=true;apply.listeners.change();motivation.value='other';motivation.listeners.change();
 for(const control of [institution,other]){control.validity={valueMissing:true};form.listeners.invalid({target:control});delete control.validity;}
 assert.equal(institution['aria-invalid'],'true');assert.equal(institution.validationMessage,h.ctx.window.Fiiu.t('requiredField'));
 assert.ok(key(selection,'answersNeedAttention'));assert.ok(key(form,'reviewErrors'));
 motivation.value='learn';motivation.listeners.change();form.listeners.change({target:motivation});apply.checked=false;apply.listeners.change();form.listeners.change({target:apply});
 for(const control of [institution,other]){assert.equal(control.disabled,true);assert.equal(control['aria-invalid'],'false');assert.equal(control.validationMessage,'');}
 assert.ok(!key(selection,'answersNeedAttention'),'the bar no longer says answers need attention');assert.equal(key(form,'reviewErrors'),undefined,'the hidden status line clears with the last error');
 apply.checked=true;apply.listeners.change();assert.equal(institution.disabled,false);assert.equal(institution['aria-invalid'],'false','a field shown again starts without its old error');
});

test('a programme shortcut shows that its box is ticked in the form and reverts when the box is cleared',async()=>{
 const h=await harness(),card=h.root.querySelectorAll('.f-activity').find(node=>content(node).includes('Cuidar y transformar la ciudad')),input=descendants(h.form()).find(node=>node.name==='activities'&&node.value==='day2-am');
 const action=key(card,'addToRegistration');await action.listeners.click();
 assert.equal(input.checked,true);assert.equal(action.dataset.fiiuText,'choiceAdded');assert.match(action.className,/\bis-added\b/);
 input.checked=false;h.form().listeners.change({target:input});assert.equal(action.dataset.fiiuText,'addToRegistration');assert.doesNotMatch(action.className,/is-added/);
 assert.equal(h.requests.filter(request=>request.method!=='GET').length,0);
});

test('once registration closes, an incomplete saved registration points to the organisers instead of a missing Edit button',async()=>{
 const old={...saved,answers:{firstName:'Ana',lastName:'Test',activities:['day1-am'],privacyAccepted:true}};
 const h=await harness({registration:old,publicRead:()=>({...publicData,config:{...publicData.config,registrationOpen:false}})}),summary=h.root.querySelector('.f-saved');
 assert.ok(key(summary,'incompleteClosedNotice'));assert.equal(key(summary,'incompleteNotice'),undefined);assert.equal(key(h.root,'edit'),undefined);
 const open=await harness({registration:old});assert.ok(key(open.root.querySelector('.f-saved'),'incompleteNotice'));
});

test('Edit moves focus to the first answer, and badges inside the saved summary sit one heading level below it',async()=>{
 const h=await harness({registration:saved,read:()=>({...self(saved),attendance:[{activityId:'day1-am'}]})});
 key(h.root,'edit').listeners.click();assert.equal(field(h.form(),'firstName').focused,true);assert.equal(h.form().hidden,false);
 const box=h.root.querySelector('.f-saved').querySelector('.f-badges');assert.equal(box.children[0].tagName,'h4');assert.equal(box.children[0].dataset.fiiuText,'badges');
});

test('the sticky step bar uses short names while the fieldsets keep full legends, and the accessibility group says it is required',async()=>{
 const h=await harness(),form=h.form(),steps=form.querySelector('.f-steps').querySelectorAll('.f-step');
 assert.deepEqual(steps.map(step=>step.children[0].dataset.fiiuText),['personal','stepChoices','stepQuestions','stepConsent']);
 assert.deepEqual(form.querySelectorAll('fieldset').filter(set=>set.id?.startsWith('f-step-')).map(set=>set.children[0].children[0].dataset.fiiuText),['personal','choices','questionnaire','consentStep']);
 const legend=form.querySelector('.f-access').children[0];assert.ok(key(legend,'requiredGroup'));assert.equal(key(legend,'requiredGroup').className,'f-sr-only');
 assert.equal(field(form,'gender').autocomplete,'sex');assert.equal(field(form,'institution').autocomplete,'organization');assert.equal(field(form,'position').autocomplete,'organization-title');
});

async function widgetHarness(respond){
 const body=new Node('body'),widget=new Node(),requests=[];body.append(widget);
 const document={body,documentElement:{lang:'en'},getElementById:id=>id==='fiiuDashboardBody'?widget:null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx={document,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date,Error,AbortSignal,fetch:async path=>{requests.push(path);const result=await respond(path);return{ok:!result.status||result.status<400,status:result.status||200,json:async()=>result.data??result};}};
 vm.createContext(ctx);for(const name of ['fiiu-ui','fiiu-hubs'])vm.runInContext(readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8'),ctx);await flush();
 return{widget,requests};
}
// The news page carries the event and the settings too, so the widget needs no other festival request.
const widgetFeed=(path,config=publicData.config)=>path==='/api/fiiu?kind=news'?{...publicData,config,content:[{id:'n1',kind:'news',title:'Festival announcement',body:'Published news',url:'',createdAt:'2026-09-29T12:00:00.000Z'}],nextCursor:null}:path==='/api/fiiu'?{...publicData,content:[{kind:'material',title:'Recent material',body:'',url:''}]}:null;

test('dashboard widget shows registration state, the next activity and the organiser queue before festival news',async()=>{
 const registration={...saved,labStatus:'pending',answers:{...answers,activities:['day1-am']}};
 const {widget,requests}=await widgetHarness(path=>widgetFeed(path)||(path==='/api/fiiu/registration'?{...self(registration),isAdmin:true}:{summary:{lab:{pending:3}}}));
 const text=content(widget),upcoming=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Lima'}).format(new Date())<='2026-10-21';
 assert.equal(key(widget,'statusRegistered').className,'f-pill is-ok');assert.equal(key(widget,'pendingShort').className,'f-pill is-pending');
 assert.equal(key(widget,'viewRegistration').href,'fiiu.html#registration');assert.equal(key(widget,'register'),undefined);
 assert.equal(Boolean(key(widget,'nextForYou')),upcoming);if(upcoming)assert.match(text,/El poder de lo local/);
 assert.equal(key(widget,'admin').href,'fiiu-admin.html#participants');assert.ok(key(widget,'pendingReviewMany'));assert.match(text,/\b3\b/);
 assert.equal(key(widget,'allNews').href,'fiiu.html#news');assert.match(text,/Festival announcement/);assert.doesNotMatch(text,/Recent material/);
 assert.ok(key(widget,'badges'));assert.ok(key(widget,'badgesHintShort'),'the widget keeps the badge hint to one short line');assert.equal(key(widget,'badgesHint'),undefined);assert.ok(requests.includes('/api/admin/fiiu/summary'));
 assert.deepEqual(requests.filter(path=>path.startsWith('/api/fiiu')&&path!=='/api/fiiu/registration'),['/api/fiiu?kind=news'],'one news request serves the list, the next activity and the badges');
 const order=['dates','statusRegistered','viewRegistration','news'].map(name=>descendants(widget).indexOf(key(widget,name)));assert.deepEqual([...order].sort((a,b)=>a-b),order,'meta, state and CTA come before the news');
});

test('dashboard widget invites members without a registration to register and skips organiser requests',async()=>{
 const {widget,requests}=await widgetHarness(path=>widgetFeed(path)||self(null));
 assert.equal(key(widget,'statusNotRegistered').className,'f-pill');assert.equal(key(widget,'register').href,'fiiu.html#registration');
 assert.equal(key(widget,'viewRegistration'),undefined);assert.equal(key(widget,'nextForYou'),undefined);assert.equal(key(widget,'admin'),undefined);
 assert.deepEqual(requests.filter(path=>path!=='/api/fiiu?kind=news').sort(),['/api/fiiu/registration']);
});

test('the page loads and saves where AbortSignal has no timeout (Safari before 16, every iOS 15 browser)',async()=>{
 const h=await harness({context:{AbortSignal:{}},write:request=>({registration:{...saved,answers:request.body}})});
 assert.equal(h.message.dataset.fiiuText,'');assert.ok(h.root.querySelector('.f-programme'));assert.ok(!key(h.root,'retry'));assert.equal(h.requests.length,3);
 h.fill();await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);assert.ok(h.root.querySelector('.f-saved'));
});

test('generated symbols keep a plain content value for browsers without alt text (Safari before 17.4, Firefox before 128)',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8'),alt=css.match(/content:"[^"]*"\/""/g)||[],guarded=css.match(/content:("[^"]*");content:\1\/""/g)||[];
 assert.ok(alt.length>=15);assert.equal(guarded.length,alt.length,'each alt-text declaration follows its plain fallback');
});

test('a running or failed save is visible beside Save, and focus moves to the feedback at the end of the form',async()=>{
 let finish;const h=await harness({write:()=>new Promise(resolve=>{finish=resolve;})});h.fill();const form=h.form(),selection=form.querySelector('.f-selection');
 const pending=h.submit();assert.ok(key(selection,'saving'));assert.doesNotMatch(selection.className,/is-error/);
 finish({status:409,data:{error:'registration changed; reload before saving'}});await pending;
 assert.ok(key(selection,'saveFailed'));assert.match(selection.className,/\bis-error\b/);assert.equal(key(form,'viewSaved').focused,true,'the recovery action takes focus');
 const limited=await harness({write:()=>({status:429,data:{error:'too many requests'}})});limited.fill();await limited.submit();
 const note=key(limited.form(),'rate');assert.equal(note.focused,true,'without an action the message itself takes focus');assert.equal(note.tabIndex,-1);assert.ok(key(limited.form().querySelector('.f-selection'),'saveFailed'));
 const expired=await harness({write:()=>({status:401,data:{error:'sign in required'}})});expired.fill();await expired.submit();assert.equal(key(expired.form(),'signin').focused,true);
 const closed=await harness({write:()=>({status:403,data:{error:'registration is closed'}})});closed.fill();await closed.submit();assert.equal(key(closed.form(),'closed').focused,true);
});

test('free text saved without Other stays shown, optional and is sent again, so a later save keeps it',async()=>{
 const legacy={...saved,answers:{...answers,accessibility:['mobility'],accessibilityOther:'Uso silla de ruedas: necesito acceso sin escalones',motivation:'learn',motivationOther:'Conocer a gestores de otras ciudades'}};
 const h=await harness({registration:legacy,write:request=>({registration:{...legacy,version:2,answers:request.body}})});key(h.root,'edit').listeners.click();
 for(const name of ['accessibilityOther','motivationOther']){const input=field(h.form(),name);assert.equal(input.disabled,false,name);assert.equal(input.required,false,name);assert.equal(input.parent.hidden,false,name);assert.equal(input.value,legacy.answers[name]);}
 const motivation=field(h.form(),'motivation');motivation.value='other';motivation.listeners.change();assert.equal(field(h.form(),'motivationOther').required,true,'Other still makes the text required');motivation.value='learn';motivation.listeners.change();
 assert.equal(field(h.form(),'motivationOther').disabled,false,'switching away from Other keeps saved text');
 await h.submit();const body=h.requests.find(request=>request.method==='PUT').body;assert.equal(body.accessibilityOther,legacy.answers.accessibilityOther);assert.equal(body.motivationOther,legacy.answers.motivationOther);
});

test('Next for you skips a block that already ended today and keeps an accepted laboratory for its whole day',async()=>{
 const registration={...saved,answers:{...answers,activities:['day1-am','day1-pm','day2-am']}},lab={...saved,labStatus:'accepted',answers:{...answers,activities:['day1-am']}};
 const {nextFor}=(await harness()).ctx.window.Fiiu,at=(value,iso)=>nextFor(value,FIIU_EVENT,new Date(iso))?.id??null;
 assert.equal(at(registration,'2026-10-21T08:00:00-05:00'),'day1-am');assert.equal(at(registration,'2026-10-21T12:59:00-05:00'),'day1-am');
 assert.equal(at(registration,'2026-10-21T15:00:00-05:00'),'day1-pm');assert.equal(at(registration,'2026-10-21T20:30:00-05:00'),'day1-pm');assert.equal(at(registration,'2026-10-21T23:30:00-05:00'),'day2-am');
 assert.equal(at({...registration,answers:{...answers,activities:['day1-am']}},'2026-10-21T14:00:00-05:00'),null,'a finished last block leaves nothing next');
 assert.equal(at(lab,'2026-10-20T23:00:00-05:00'),'day0-lab');assert.equal(at(lab,'2026-10-21T00:10:00-05:00'),'day1-am');
 const T=Date.parse('2026-10-21T15:00:00-05:00');class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[T]));}static now(){return T;}}
 const hero=(await harness({registration,context:{Date:FrozenDate}})).root.querySelector('.f-next');assert.match(content(hero),/Intervenir para activar/);assert.match(content(hero),/19:00–21:00/);
});

test('answers made only of spaces count as missing, in the step bar and before anything is sent',async()=>{
 const h=await harness();h.fill();const form=h.form(),country=field(form,'country'),first=form.querySelector('.f-steps').querySelectorAll('.f-step')[0],{t}=h.ctx.window.Fiiu;
 form.listeners.input({target:country});assert.match(first.className,/is-done/);
 country.value='   ';form.listeners.input({target:country});assert.doesNotMatch(first.className,/is-done/);
 await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);assert.equal(country.validationMessage,t('requiredField'));
 country.validity={customError:true,valueMissing:false};form.listeners.invalid({target:country});delete country.validity;assert.equal(country['aria-invalid'],'true');assert.ok(key(form.querySelector('.f-selection'),'answersNeedAttention'));
 country.value='Perú';form.listeners.input({target:country});assert.equal(country.validationMessage,'');await h.submit();assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
});

test('once registration closes, the calls to action lead to the programme and the guest panel stops inviting new registrations',async()=>{
 const closed=()=>({...publicData,config:{...publicData.config,registrationOpen:false}}),guestRead=()=>({status:401,data:{error:'sign in required'}});
 for(const read of [guestRead,undefined]){const hero=(await harness({publicRead:closed,read})).root.querySelector('.f-hero');assert.equal(key(hero,'register'),undefined);assert.equal(key(hero,'viewProgramme').href,'#programme');}
 const panel=(await harness({publicRead:closed,read:guestRead})).root.querySelector('.f-registration');
 assert.ok(key(panel,'signinClosedHint'));assert.equal(key(panel,'signinHint'),undefined);assert.equal(key(panel,'privateHint'),undefined);assert.ok(key(panel,'signin'));
 assert.ok(key((await harness({publicRead:closed,registration:saved})).root.querySelector('.f-hero'),'viewRegistration'),'a registration keeps its way back');
 const open=await harness({read:guestRead});assert.ok(key(open.root.querySelector('.f-hero'),'register'));assert.ok(key(open.root.querySelector('.f-registration'),'signinHint'));
});

test('workshops show their venue and routes their starting point, in the programme and in saved interests',async()=>{
 const external=(id,period,date,venue)=>({id,date,period,registration:'external',title:'Actividad '+id,time:'',venue,sessions:[],formUrl:'https://forms.gle/'+id});
 // A conference block whose venue is not announced yet keeps 'Venue to be confirmed' (the 23 October morning here, as a test double).
 const pending=activity=>activity.id==='day3-am'?{...activity,venue:''}:activity;
 const event={...FIIU_EVENT,activities:[...FIIU_EVENT.activities.filter(activity=>activity.registration!=='external').map(pending),external('workshop-a','workshop','2026-10-22','MALI, Cercado de Lima'),external('workshop-b','workshop','2026-10-22',''),external('route-a','route','2026-10-24','Plaza San Martín, Cercado de Lima')]};
 const h=await harness({publicRead:()=>({...publicData,event}),registration:{...saved,answers:{...answers,externalActivities:['workshop-a','route-a']}}});
 const rows=h.root.querySelector('.f-programme').querySelectorAll('.f-compact'),row=id=>rows.find(node=>descendants(node).some(child=>child.id==='f-act-'+id+'-title')),venue=id=>row(id).querySelector('.f-compact-venue');
 assert.equal(content(venue('workshop-a')).trim(),'MALI, Cercado de Lima');assert.equal(key(venue('workshop-a'),'startingPoint'),undefined);assert.equal(venue('workshop-a').lang,'es');
 assert.ok(key(venue('route-a'),'startingPoint'));assert.match(content(venue('route-a')),/Plaza San Martín, Cercado de Lima/);assert.equal(venue('workshop-b'),null,'no venue, no line');
 const block=title=>h.root.querySelectorAll('.f-activity').find(node=>content(node).includes(title));
 assert.ok(key(block('Territorio, resiliencia'),'venuePending'),'conference blocks keep Venue to be confirmed');
 assert.match(content(block('Intervenir para activar')),/Auditorio Taulichusco, Museo Metropolitano de Lima, Cercado de Lima/);assert.equal(key(block('Intervenir para activar'),'venuePending'),undefined,'the 21 October evening venue is confirmed');
 const itinerary=h.root.querySelector('.f-saved').querySelectorAll('.f-itinerary-venue');assert.equal(itinerary.length,2);assert.equal(content(itinerary[0]).trim(),'MALI, Cercado de Lima');assert.ok(key(itinerary[1],'startingPoint'));
 h.lang('es');assert.equal(key(venue('route-a'),'startingPoint').textContent,'Punto de inicio:');h.lang('pt');assert.equal(key(venue('route-a'),'startingPoint').textContent,'Ponto de partida:');
});

test('the consent and privacy wording name NODAL administrators, who can also read the answers',async()=>{
 const {rows}=(await harness()).ctx.window.Fiiu;
 for(const name of ['privacyAccepted','privateHint'])rows[name].forEach((text,i)=>assert.match(text,[/FIIU organising team and NODAL administrators/,/equipo organizador del FIIU y la administración de NODAL/,/equipe organizadora do FIIU e a administração da NODAL/][i],name));
});

test('date and number formatters are built once per locale and style',()=>{
 let made=0;const counted=Base=>new Proxy(Base,{construct(target,args){made++;return new target(...args);}});
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[],createElement:tag=>new Node(tag)},Intl:Object.create(Intl,{DateTimeFormat:{value:counted(Intl.DateTimeFormat)},NumberFormat:{value:counted(Intl.NumberFormat)}}),Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);const ui=context.window.Fiiu;
 for(let i=0;i<200;i++){ui.dateNode('2026-10-21','span','short');ui.dateNode('2026-10-22');ui.rangeNode('2026-10-20','2026-10-25');ui.limaDate(new Date());ui.countLabel(i,'sessionOne','sessions');}
 assert.equal(made,5);context.window.nodalI18n.lang='es';assert.equal(ui.dateNode('2026-10-21').textContent,'Miércoles, 21 de octubre');assert.equal(made,6);
});

test('the festival date range follows a language change',async()=>{
 const h=await harness(),range=h.root.querySelector('.f-hero').querySelector('.f-range'),english=range.textContent;
 h.lang('es');assert.match(range.textContent,/octubre de 2026/);h.lang('pt');assert.match(range.textContent,/outubro de 2026/);h.lang('en');assert.equal(range.textContent,english);
});

async function hubHarness(page,respond){
 const body=new Node('body'),hub=new Node(),message=new Node(),requests=[];hub.dataset.hub=page;body.append(hub,message);
 const document={body,documentElement:{lang:'en'},getElementById:id=>({fiiuHub:hub,fiiuStatus:message})[id]||null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx={document,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date,Error,AbortSignal,fetch:async path=>{requests.push(path);const result=await respond(path);return{ok:!result.status||result.status<400,status:result.status||200,json:async()=>result.data??result};}};
 vm.createContext(ctx);for(const name of ['fiiu-ui','fiiu-hubs'])vm.runInContext(readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8'),ctx);await flush();
 return{hub,requests};
}

test('the dashboard widget and the community card follow the registration settings',async()=>{
 const closed={...publicData.config,registrationOpen:false};
 const member=await widgetHarness(path=>widgetFeed(path,closed)||self(null));assert.equal(key(member.widget,'register'),undefined);assert.equal(key(member.widget,'viewProgramme').href,'fiiu.html#programme');
 assert.deepEqual(member.requests.sort(),['/api/fiiu/registration','/api/fiiu?kind=news']);
 assert.ok(key((await widgetHarness(path=>widgetFeed(path,closed)||self(saved))).widget,'viewRegistration'),'a registration keeps its way back');
 const community=await hubHarness('community',path=>widgetFeed(path,closed));assert.equal(key(community.hub,'register'),undefined);assert.equal(key(community.hub,'viewProgramme').href,'fiiu.html#programme');
 const open=await hubHarness('community',path=>widgetFeed(path));assert.equal(key(open.hub,'register').href,'fiiu.html');assert.deepEqual(open.requests,['/api/fiiu?kind=news']);
 const offline=await hubHarness('community',()=>({status:503,data:{error:'unavailable'}}));assert.equal(key(offline.hub,'register').href,'fiiu.html','without the settings the card keeps Register');
});

test('badge hints say badges come from the session QR code or the team, in every language',()=>{
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);const {rows}=context.window.Fiiu;
 for(const [i,word] of ['QR','QR','QR'].entries()){assert.match(rows.badgesHint[i],new RegExp(word));assert.match(rows.badgesHintShort[i],new RegExp(word));}
 assert.match(rows.badgesHint[0],/team confirms/);assert.match(rows.attendanceHint[0],/QR check-ins/);
});

test('the saved registration shows the confirmed hours under the badges, and cancelling warns that attendance goes too',async()=>{
 const registration={...saved,answers:{...answers,activities:['day1-am','day1-pm']}};let asked='';
 const h=await harness({registration,read:()=>({...self(registration),attendance:[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'},{activityId:'day1-pm',createdAt:'2026-10-22T00:40:00.000Z',method:'staff'}]}),write:()=>({ok:true})});
 const box=h.root.querySelector('.f-saved').querySelector('.f-badges'),hours=box.querySelector('.f-hours');
 assert.equal(box.children.at(-1),hours,'the hours line closes the badges');assert.ok(key(hours,'hoursConfirmed'));assert.match(content(hours),/\b6\b/);assert.equal(key(hours,'labHoursPending'),undefined);
 h.ctx.window.confirm=message=>{asked=message;return false;};await key(h.root,'cancel').listeners.click();
 assert.equal(asked,h.ctx.window.Fiiu.t('cancelConfirm')+' '+h.ctx.window.Fiiu.t('cancelWithAttendance'));
 const none=await harness({registration:saved,write:()=>({ok:true})});none.ctx.window.confirm=message=>{asked=message;return false;};await key(none.root,'cancel').listeners.click();
 assert.equal(asked,none.ctx.window.Fiiu.t('cancelConfirm'),'without attendance the question stays as it was');assert.equal(none.root.querySelector('.f-hours'),null);
});

test('an accepted laboratory counts for badges but its hours are pending until its length is known',async()=>{
 const registration={...saved,labStatus:'accepted',answers:{...answers,publicOfficial:true,applyLab:true,institution:'City',position:'Planner'}};
 const h=await harness({registration,read:()=>({...self(registration),attendance:[{activityId:'day0-lab',createdAt:'2026-10-20T15:00:00.000Z',method:'qr'}]})});
 const hours=h.root.querySelector('.f-saved').querySelector('.f-hours');assert.match(content(hours),/\b0\b/);assert.ok(key(hours,'labHoursPending'));
});

test('the organiser link appears only for organisers, never for a member or a guest',async()=>{
 const member=await harness({registration:saved});assert.equal(key(member.root,'admin'),undefined);
 const guest=await harness({read:()=>({status:401,data:{error:'sign in required'}})});assert.equal(key(guest.root,'admin'),undefined);assert.ok(key(guest.root,'signin'));
 const organiser=await harness({read:()=>({...self(saved),isAdmin:true})});assert.equal(key(organiser.root,'admin').href,'fiiu-admin.html');
});

test('dashboard widget adds the confirmed hours under its badges once a session is confirmed',async()=>{
 const registration={...saved,answers:{...answers,activities:['day1-am']}};
 const {widget}=await widgetHarness(path=>widgetFeed(path)||{...self(registration),attendance:[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}]});
 const box=widget.querySelector('.f-badges');assert.match(content(box),/✓ El poder de lo local/);assert.ok(key(box.querySelector('.f-hours'),'hoursConfirmed'));assert.match(content(box.querySelector('.f-hours')),/\b4\b/);
 const empty=await widgetHarness(path=>widgetFeed(path)||self(registration));assert.equal(empty.widget.querySelector('.f-hours'),null,'no hours line before any confirmed session');assert.ok(key(empty.widget,'badgesHintShort'));
});

test('the organisers-only page names itself in the reader language, in the tab title too',()=>{
 const listeners=[],document={title:'NODAL · Organisers only',body:{dataset:{page:'organisers-only'}},documentElement:{lang:'en'},querySelectorAll:()=>[]};
 const ctx={document,Intl,Date,Error,URL,URLSearchParams,window:{nodalI18n:{lang:'es',onChange:listener=>listeners.push(listener)}}};
 vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),ctx);
 assert.equal(document.title,'NODAL · Solo para la organización');
 ctx.window.nodalI18n.lang='pt';listeners.forEach(listener=>listener());assert.equal(document.title,'NODAL · Apenas para a organização');
 ctx.window.nodalI18n.lang='en';listeners.forEach(listener=>listener());assert.equal(document.title,'NODAL · Organisers only');
 // Every other page keeps the title its own script sets.
 const other={...document,title:'NODAL · FIIU',body:{dataset:{page:'fiiu'}}};vm.runInContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),vm.createContext({...ctx,document:other}));
 assert.equal(other.title,'NODAL · FIIU');
});

test('festival layout rules: footer at the bottom, natural profile rows, stacked check-in rows on phones, a portrait QR that leaves the code in view',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8');
 assert.match(css,/\.f-page\{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh\}\.f-page>\.f-shell\{flex:1 0 auto\}/,'short pages keep the footer at the bottom of the screen');
 assert.match(css,/\.f-summary-grid\{[^}]*align-items:start\}/);assert.doesNotMatch(css,/\.f-summary-col \.f-summary-table\{height:100%\}/,'a short profiles table is not stretched into a blank band');
 const phone=css.match(/@media\(max-width:799px\)\{\n\.f-summary-table\.is-checkin[\s\S]*?\n\}/)?.[0]||'';
 assert.match(phone,/\.f-summary-table\.is-checkin tr\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/,'check-in rows stack below 800px');
 assert.match(phone,/td\.f-col-action\{grid-column:1\/-1/,'the screen button gets its own line instead of scrolling off');
 assert.doesNotMatch(phone,/min-width:200px/);assert.match(phone,/\.f-cell-label\{display:inline\}/);assert.match(css,/\.f-cell-label,\.f-cell-unit\{display:none\}/);
 assert.match(css,/@media\(max-width:900px\) and \(orientation:portrait\)\{\.f-qr-code\{width:min\(90vw,calc\(100vh - var\(--f-header\) - 27rem\)\)\}\}/);
 assert.match(css,/\.f-qr-note\{[^}]*text-wrap:balance\}/,'the screen note never ends on a lone word');
 assert.match(css,/@media\(min-width:1280px\)\{\.f-admin-settings form\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/,'the settings fill the wide column');
 // Wide screens: the capped organiser sheets sit centred, the QR may pass 820px, and the news editor column stops at its form.
 assert.match(css,/\.f-page:is\(\[data-page="fiiu-admin"\],\[data-page="fiiu-qr"\]\) \.f-shell\{max-width:calc\(1760px \+ 2\*var\(--f-gutter\)\);margin-inline:auto\}/,'no empty band on one side past 1760px');
 assert.match(css,/\.f-qr-code\{width:min\(calc\(100vh - var\(--f-header\) - 120px\),50vw,1080px\)/);
 assert.match(css,/@media\(min-width:1380px\)\{\.f-content-layout\{grid-template-columns:minmax\(0,650px\) minmax\(0,1fr\)\}\}/,'no blank strip between the editor form and the publication list');
 assert.match(css,/\.f-content-editor form\{max-width:650px\}/,'the column cap matches the form cap');
 // The dashboard widget's badges are plain rows across the column, like the FIIU page: space separates them, not rules.
 assert.match(css,/\.f-widget-status>\.f-badges\{justify-self:stretch\}/);assert.match(css,/\.f-page \.f-badge,\.f-news-widget \.f-badge\{(?![^}]*border)[^}]*\}/,'badges carry no rule');assert.doesNotMatch(css,/\.f-badges>:is\(h2,h3,h4\)\+\.f-badge/);
 // Fewer lines: days break on their heading and space, the step row stays on its one hairline, and the save bar keeps a single firmer hairline (not the 2px ink rule).
 assert.doesNotMatch(css,/\.f-day\+\.f-day\{[^}]*border/);assert.match(css,/\.f-steps ol\{(?![^}]*flex-wrap:wrap)[^}]*overflow-x:auto/);assert.match(css,/\.f-submit-bar\{[^}]*border-top:1px solid #aab6a4\}/);
 // Short page headings never break mid-word at a hyphen.
 assert.match(css,/\.f-page \.f-locked h1\{[^}]*hyphens:manual/);assert.match(css,/\.f-page \.f-checkin-title\{[^}]*hyphens:manual/);
});

test('after the first save the page says where the summary went, that it could not be sent, or that it may be late; edits and an email that is off say nothing',async()=>{
 const notice=h=>h.root.querySelector('.f-notice');
 const sent=await harness({write:()=>({registration:saved,confirmationEmail:'sent'})});sent.fill();await sent.submit();
 const put=sent.requests.find(request=>request.method==='PUT');assert.equal(put.body.language,'en','the email follows the page language');
 assert.ok(key(notice(sent),'emailSent'));assert.match(notice(sent).className,/\bis-ok\b/);assert.match(content(notice(sent)),/We emailed a summary to\s+ana@example\.test\./);assert.equal(notice(sent).dataset.fiiuText,undefined,'the address is not replaced on a language change');
 sent.lang('es');assert.match(content(notice(sent)),/Te enviamos un resumen a\s+ana@example\.test\./);
 // 'failed': the provider never had it. 'uncertain' (or a send that never reported back) usually still arrives, so the
 // page does not say it was not sent. Both are warnings, not the green confirmation.
 for(const [outcome,expected,text] of [['failed','emailNotSent','Your registration is saved. We could not send the summary email.'],['uncertain','emailDelayed','Your registration is saved. The summary email may be delayed or may not arrive.'],['pending','emailDelayed','Your registration is saved. The summary email may be delayed or may not arrive.']]){
  const h=await harness({write:()=>({registration:saved,confirmationEmail:outcome})});h.fill();await h.submit();
  assert.equal(notice(h).dataset.fiiuText,expected,outcome);assert.equal(content(notice(h)).trim(),text);assert.match(notice(h).className,/\bis-warning\b/,outcome);assert.doesNotMatch(notice(h).className,/\bis-ok\b/,outcome);
 }
 for(const outcome of ['none','skipped',undefined]){const h=await harness({write:()=>({registration:saved,...(outcome?{confirmationEmail:outcome}:{})})});h.fill();await h.submit();assert.equal(content(notice(h)).trim(),'',String(outcome));}
 // The Spanish page asks for a Spanish email.
 const spanish=await harness({write:()=>({registration:saved,confirmationEmail:'sent'})});spanish.lang('es');spanish.fill();await spanish.submit();
 assert.equal(spanish.requests.find(request=>request.method==='PUT').body.language,'es');
 // An edit of a saved registration gets no confirmationEmail back, so no email notice.
 const edit=await harness({registration:saved,write:()=>({registration:{...saved,version:2}})});key(edit.root,'edit').listeners.click();edit.fill();await edit.submit();
 assert.ok(!key(edit.root,'emailSent'));assert.notEqual(notice(edit).dataset.fiiuText,'emailNotSent');assert.equal(content(notice(edit)).trim(),'');
});
