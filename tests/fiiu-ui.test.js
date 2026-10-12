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
// The conversation pulse answers on its own path, so it never uses up one of the registration reads a test counts.
async function harness({registration=null,write=async()=>({status:503,data:{error:'unavailable'}}),read,publicRead=()=>publicData,materialsRead=()=>publicData,pulseRead=()=>({questions:[]}),context}={}){
 let registrationReads=0;
 const h=await createFiiuHarness(request=>request.method!=='GET'?write(request):request.path==='/api/fiiu?kind=news'?publicRead():request.path==='/api/fiiu?kind=materials'?materialsRead():request.path==='/api/fiiu/pulse'?pulseRead():request.path==='/api/auth/state'?{authenticated:true}:read?read(++registrationReads):self(registration),{context});
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


test('the programme, both feeds, self-registration and the conversation pulse start together (four requests) without an auth-state round trip',async()=>{
 let finish;const h=await harness({publicRead:()=>new Promise(resolve=>{finish=resolve;})});
 assert.deepEqual(h.requests.map(request=>request.path).sort(),['/api/fiiu/pulse','/api/fiiu/registration','/api/fiiu?kind=materials','/api/fiiu?kind=news']);finish(publicData);
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

test('the privacy policy link in the consent step opens in a new tab, so reading it never drops the draft',async()=>{
 const h=await harness(),consent=descendants(h.form()).find(node=>node.id==='f-step-consent'),policy=consent.querySelectorAll('a').find(node=>node.dataset.fiiuText==='privacy');
 assert.equal(policy.href,'privacy.html');assert.equal(policy.target,'_blank');assert.equal(policy.rel,'noopener');assert.ok(policy['aria-describedby'].split(' ').includes('f-newtab'));
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
 assert.equal(h.requests.filter(request=>request.path!=='/api/fiiu/pulse').length,3);assert.ok(!h.requests.some(request=>request.path==='/api/fiiu'),'the mixed first page is no longer read');
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

// context adds or replaces globals (a Date frozen at a festival hour).
async function widgetHarness(respond,context={}){
 const body=new Node('body'),widget=new Node(),requests=[];body.append(widget);
 const document={body,documentElement:{lang:'en'},getElementById:id=>id==='fiiuDashboardBody'?widget:null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx={document,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date,Error,AbortSignal,fetch:async path=>{requests.push(path);const result=await respond(path);return{ok:!result.status||result.status<400,status:result.status||200,json:async()=>result.data??result};},...context};
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
 assert.deepEqual(requests.filter(path=>path.startsWith('/api/fiiu')&&!['/api/fiiu/registration','/api/fiiu/pulse'].includes(path)),['/api/fiiu?kind=news'],'one news request serves the list, the next activity and the badges');
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
 assert.equal(h.message.dataset.fiiuText,'');assert.ok(h.root.querySelector('.f-programme'));assert.ok(!key(h.root,'retry'));assert.equal(h.requests.length,4);
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
 assert.match(content(hero.querySelector('.f-next-venue')),/Museo Metropolitano de Lima/,'the next block says where it is');
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
 const itinerary=h.root.querySelector('.f-saved').querySelectorAll('.f-itinerary-venue');assert.equal(itinerary.length,3,'registered conference blocks show their venue too');
 assert.equal(content(itinerary[0]).trim(),'Auditorio MALI, Cercado de Lima');assert.equal(content(itinerary[1]).trim(),'MALI, Cercado de Lima');assert.ok(key(itinerary[2],'startingPoint'));
 h.lang('es');assert.equal(key(venue('route-a'),'startingPoint').textContent,'Punto de inicio:');h.lang('pt');assert.equal(key(venue('route-a'),'startingPoint').textContent,'Ponto de partida:');
});

test('the consent and privacy wording name NODAL administrators, who can also read the answers',async()=>{
 const {rows}=(await harness()).ctx.window.Fiiu;
 for(const name of ['privacyAccepted','privateHint'])rows[name].forEach((text,i)=>assert.match(text,[/FIIU organising team and NODAL administrators/,/equipo organizador del FIIU y la administración de NODAL/,/equipe organizadora do FIIU e a administração da NODAL/][i],name));
});

test('api() takes a per-call timeout and keeps 20 s for every other call',async()=>{
 const limits=[],context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},Intl,Date,Error,
  AbortSignal:{timeout:ms=>{limits.push(ms);return {ms};}},fetch:async()=>({ok:true,status:200,json:async()=>({ok:true})})};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);const {api}=context.window.Fiiu;
 await api('/api/fiiu/pulse');await api('/api/fiiu/files',{name:'a.pdf'},'POST',{timeout:120000});await api('/api/fiiu/messages/m/like',{},'PUT');
 assert.deepEqual(limits,[20000,120000,20000]);
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
 assert.doesNotMatch(phone,/min-width:200px/);assert.match(phone,/\.f-cell-unit\{display:inline;/);assert.match(css,/\.f-cell-unit\{display:none\}/);
 // Only a closed block is marked in the lists; the door screen alone colours the open state.
 assert.match(css,/\.f-window\.is-closed\{color:var\(--f-muted\)\}/);assert.doesNotMatch(css.replace(/\.f-qr-window \.f-window\.is-open/g,''),/\.f-window\.is-open/,'no open mark on every block still to come');
 assert.match(css,/@media\(max-width:900px\) and \(orientation:portrait\)\{\.f-qr-code\{width:min\(90vw,calc\(100vh - var\(--f-header\) - 27rem\)\)\}\}/);
 assert.match(css,/\.f-qr-note\{[^}]*text-wrap:balance\}/,'the screen note never ends on a lone word');
 assert.match(css,/@media\(min-width:1280px\)\{\.f-admin-settings form\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/,'the settings fill the wide column');
 // Wide screens: the capped organiser sheets sit centred, the QR may pass 820px, and the news editor column stops at its form.
 // width:100% keeps the centred shell a full-width flex item: with auto side margins alone the column-flex body sizes it
 // to its content, so on a phone the one-line section nav widened the dashboard past the screen, out of reach.
 assert.match(css,/\.f-page:is\(\[data-page="fiiu-admin"\],\[data-page="fiiu-qr"\]\) \.f-shell\{width:100%;max-width:calc\(1760px \+ 2\*var\(--f-gutter\)\);margin-inline:auto\}/,'no empty band on one side past 1760px, and never wider than the screen');
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

test('an accepted laboratory place asks before a save that sends it back to review or gives it up; other edits save without asking',async()=>{
 const accepted={...saved,labStatus:'accepted',answers:{...answers,publicOfficial:true,applyLab:true,institution:'City',position:'Planner'}};
 const open=async()=>{const asked=[];let answer=false;const h=await harness({registration:accepted,write:request=>({registration:{...accepted,version:2,labStatus:'pending',answers:request.body}})});h.ctx.window.confirm=message=>{asked.push(message);return answer;};key(h.root,'edit').listeners.click();return{h,asked,agree:()=>{answer=true;}};};
 const puts=h=>h.requests.filter(request=>request.method==='PUT').length;
 const name=await open();field(name.h.form(),'lastName').value='Testa';await name.h.submit();
 assert.deepEqual(name.asked,[name.h.ctx.window.Fiiu.t('labReReview')]);assert.equal(puts(name.h),0,'declining keeps the draft and sends nothing');assert.equal(field(name.h.form(),'lastName').value,'Testa');
 name.agree();await name.h.submit();assert.equal(puts(name.h),1,'agreeing saves');
 const role=await open();field(role.h.form(),'position').value='Director';role.agree();await role.h.submit();assert.equal(role.asked.length,1);assert.equal(puts(role.h),1);
 const withdraw=await open(),apply=field(withdraw.h.form(),'applyLab');apply.checked=false;apply.listeners.change();await withdraw.h.submit();
 assert.deepEqual(withdraw.asked,[withdraw.h.ctx.window.Fiiu.t('labWithdrawConfirm')]);assert.equal(puts(withdraw.h),0);
 const city=await open();field(city.h.form(),'city').value='Callao';field(city.h.form(),'lastName').value=' Test ';await city.h.submit();assert.deepEqual(city.asked,[],'the city and surrounding spaces do not touch the review');assert.equal(puts(city.h),1);
 // A pending application has nothing confirmed to lose.
 const pending=await harness({registration:{...accepted,labStatus:'pending'},write:request=>({registration:{...accepted,version:2,labStatus:'pending',answers:request.body}})});let asked=0;pending.ctx.window.confirm=()=>{asked++;return false;};
 key(pending.root,'edit').listeners.click();field(pending.form(),'lastName').value='Testa';await pending.submit();assert.equal(asked,0);assert.equal(puts(pending),1);
});

test('a failed registration read keeps the programme and shows its error and Try again in the registration panel only',async()=>{
 let replies=[{status:503,data:{error:'unavailable'}},self(saved)];
 const h=await harness({read:()=>replies.shift()}),panel=h.root.querySelector('.f-registration');
 assert.ok(h.root.querySelectorAll('.f-day').length>=4,'the programme is shown');assert.ok(h.root.querySelector('.f-hero'));assert.equal(h.message.dataset.fiiuText,'');
 assert.ok(key(panel,'registrationLoadError'));assert.ok(key(panel,'retry'));assert.equal(h.form(),null);assert.equal(key(h.root,'signin'),undefined,'an outage never reads as signed out');
 assert.equal(key(h.root,'register'),undefined,'no guest call to action while the registration is unknown');assert.ok(key(h.root.querySelector('.f-hero'),'viewProgramme'));
 await key(panel,'retry').listeners.click();
 assert.ok(h.root.querySelector('.f-saved'),'Try again reads the registration once more');assert.equal(key(h.root,'registrationLoadError'),undefined);assert.ok(key(h.root.querySelector('.f-hero'),'viewRegistration'));
 assert.equal(h.requests.filter(request=>request.path==='/api/fiiu/registration').length,2);assert.equal(h.requests.filter(request=>request.path==='/api/fiiu?kind=news').length,1,'only the registration is read again');
 const limited=await harness({read:()=>({status:429,data:{error:'too many requests'}})});assert.ok(key(limited.root.querySelector('.f-registration'),'rate'));assert.ok(key(limited.root.querySelector('.f-registration'),'retry'));
});

test('#add-<block> ticks that block in the form without saving, and the address goes back to #registration',async()=>{
 const at=hash=>({location:{hash,search:'',pathname:'/fiiu.html',reload(){}}}),box=(h,id)=>descendants(h.form()).find(node=>node.value===id&&['activities','externalActivities'].includes(node.name));
 const card=(h,title)=>h.root.querySelectorAll('.f-activity').find(node=>content(node).includes(title));
 // Saved registration: the edit form opens on the ticked block, and the programme button says it is selected.
 const member=await harness({registration:saved,context:at('#add-day2-am')});
 assert.equal(member.form().hidden,false);assert.equal(box(member,'day2-am').checked,true);assert.equal(box(member,'day2-am').focused,true);
 assert.equal(key(card(member,'Cuidar y transformar la ciudad'),'choiceAdded').dataset.fiiuText,'choiceAdded');assert.equal(member.requests.filter(request=>request.method!=='GET').length,0,'saving stays an explicit tap');
 assert.deepEqual(member.replaced,['/fiiu.html#registration']);
 // No registration yet: the block is ticked, but the form starts at its first step.
 const fresh=await harness({context:at('#add-day2-am')});assert.equal(box(fresh,'day2-am').checked,true);assert.notEqual(box(fresh,'day2-am').focused,true,'the personal answers are not skipped');assert.deepEqual(fresh.replaced,['/fiiu.html#registration']);
 // A block already in the plan, or the laboratory, only scrolls to the panel.
 const planned=await harness({registration:saved,context:at('#add-day1-am')});assert.equal(planned.form().hidden,true);assert.notEqual(box(planned,'day1-am').focused,true);
 const lab=await harness({context:at('#add-day0-lab')});assert.equal(field(lab.form(),'applyLab').checked,false);assert.equal(field(lab.form(),'applyLab').focused,undefined);
 // A guest has no form; the hash is still replaced.
 const guest=await harness({read:()=>({status:401,data:{error:'sign in required'}}),context:at('#add-day2-am')});assert.equal(guest.form(),null);assert.deepEqual(guest.replaced,['/fiiu.html#registration']);
 // A failed registration read keeps the block for Try again, which then opens the form on it.
 const replies=[{status:503,data:{error:'unavailable'}},self(saved)];
 const outage=await harness({read:()=>replies.shift(),context:at('#add-day2-am')});assert.equal(outage.form(),null);
 await key(outage.root.querySelector('.f-registration'),'retry').listeners.click();
 assert.equal(outage.form().hidden,false);assert.equal(box(outage,'day2-am').checked,true);assert.equal(box(outage,'day2-am').focused,true);
 assert.equal(outage.requests.filter(request=>request.method!=='GET').length,0);
});

test('a guest who chooses a block from its card signs in and comes back with that block ticked',async()=>{
 const h=await harness({read:()=>({status:401,data:{error:'sign in required'}})}),signin=key(h.root.querySelector('.f-registration'),'signin');
 assert.equal(signin.href,'login.html?next='+encodeURIComponent('/fiiu.html#registration'));
 const card=h.root.querySelectorAll('.f-activity').find(node=>content(node).includes('Cuidar y transformar la ciudad')),register=key(card,'register');
 assert.equal(register.href,'#registration','the card still leads to the panel’s explanation first');register.listeners.click();
 assert.equal(signin.href,'login.html?next='+encodeURIComponent('/fiiu.html#add-day2-am'));
});

test('the community events card has its own copy and leads to the festival programme',async()=>{
 const {hub}=await hubHarness('community',path=>widgetFeed(path)),events=hub.querySelectorAll('.f-hub-card').find(node=>key(node,'events'));
 assert.ok(key(events,'eventsHint'));assert.equal(key(events,'communityIntro'),undefined,'the intro is not repeated');assert.equal(key(events,'viewProgramme').href,'fiiu.html#programme');assert.equal(key(events,'circles'),undefined);
 assert.equal(hub.querySelectorAll('[data-fiiu-text]').filter(node=>node.dataset.fiiuText==='communityIntro').length,1);
});

test('the dashboard widget names the venue of the next block',async()=>{
 const T=Date.parse('2026-10-21T15:00:00-05:00');class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[T]));}static now(){return T;}}
 const registration={...saved,answers:{...answers,activities:['day1-pm']}},body=new Node('body'),widget=new Node();body.append(widget);
 const document={body,documentElement:{lang:'en'},getElementById:id=>id==='fiiuDashboardBody'?widget:null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
 const ctx={document,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date:FrozenDate,Error,AbortSignal,fetch:async path=>{const result=widgetFeed(path)||self(registration);return{ok:true,status:200,json:async()=>result};}};
 vm.createContext(ctx);for(const name of ['fiiu-ui','fiiu-hubs'])vm.runInContext(readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8'),ctx);await flush();
 assert.match(content(widget.querySelector('.f-next').querySelector('.f-next-venue')),/Museo Metropolitano de Lima/);
});

// The public conversation pulse lists [id, activityId, revision, status] for every question that is not hidden: two on the 21 October morning here.
const pulseData={questions:[['10000000-0000-4000-8000-000000000001','day1-am',3,'open'],['10000000-0000-4000-8000-000000000002','day1-am',1,'closed']]};
const talkLinks=node=>node.querySelectorAll('.f-talk-link');
const cardOf=(h,title)=>h.root.querySelectorAll('.f-activity').find(node=>content(node).includes(title));

test('a block with conversations links to them from its programme card when the pulse answers, which never holds up the page',async()=>{
 let answer;const h=await harness({pulseRead:()=>new Promise(resolve=>{answer=resolve;})});
 assert.ok(h.root.querySelector('.f-programme'),'the programme is drawn before the pulse answers');assert.deepEqual(talkLinks(h.root),[]);
 answer(pulseData);await flush();
 const links=talkLinks(h.root);assert.equal(links.length,1,'only the block with questions has a link');assert.ok(descendants(cardOf(h,'El poder de lo local')).includes(links[0]),'the link sits on its own block’s card');
 assert.equal(links[0].href,'fiiu-talk.html?a=day1-am');assert.match(content(links[0]),/Conversation\s+·\s+2/);assert.equal(links[0].target,undefined,'the chat opens in the same tab');
 assert.equal(links[0]['aria-describedby'],'f-act-day1-am-title','each link is described by its block title');
 // Assistive technology hears "Conversation, 2 questions" instead of the bare count, in the reader's language.
 const spoken=links[0].querySelector('.f-talk-spoken');assert.equal(links[0].querySelector('.f-talk-count')['aria-hidden'],'true');assert.equal(spoken.textContent,', 2 questions');
 h.lang('es');assert.match(content(links[0]),/Conversación\s+·\s+2/);assert.equal(spoken.textContent,', 2 preguntas');h.lang('pt');assert.match(content(links[0]),/Conversa\s+·\s+2/);assert.equal(spoken.textContent,', 2 perguntas');
 assert.equal(h.requests.filter(request=>request.path==='/api/fiiu/pulse').length,1);
});

test('a pulse that fails or answers oddly shows no conversation links and no error',async()=>{
 for(const pulseRead of [()=>({status:503,data:{error:'unavailable'}}),()=>({questions:'none'}),()=>({questions:[null,'day1-am',{1:'day1-am'}]})]){
  const h=await harness({registration:saved,pulseRead});
  assert.deepEqual(talkLinks(h.root),[]);assert.ok(h.root.querySelector('.f-programme'));assert.ok(h.root.querySelector('.f-saved'));assert.equal(h.message.dataset.fiiuText,'');
  for(const name of ['error','loadError','retry'])assert.equal(key(h.root,name),undefined,name);
 }
});

test('the saved itinerary links a registered block to its conversation after the venue, and the links survive a re-render',async()=>{
 const h=await harness({registration:saved,pulseRead:()=>pulseData,write:()=>({ok:true})});
 const row=h.root.querySelector('.f-saved').querySelectorAll('.f-itinerary-row').find(node=>descendants(node).some(child=>child.id==='f-it-day1-am')),link=row.querySelector('.f-talk-link');
 assert.equal(link.href,'fiiu-talk.html?a=day1-am');assert.ok(row.querySelector('.f-itinerary-venue'));assert.equal(row.children.at(-1),link,'the link closes the row, after the venue');assert.equal(link['aria-describedby'],'f-it-day1-am');
 // Cancelling redraws the programme from the pulse already read: the card keeps its link and nothing is requested again.
 await key(h.root,'cancel').listeners.click();assert.equal(h.root.querySelector('.f-saved'),null);
 assert.equal(talkLinks(cardOf(h,'El poder de lo local')).length,1);assert.equal(h.requests.filter(request=>request.path==='/api/fiiu/pulse').length,1);
});

test('guests see conversation links too, on conference and laboratory cards and on workshop and route rows',async()=>{
 const pulse={questions:[...pulseData.questions,['10000000-0000-4000-8000-000000000003','workshop-calles-gente',1,'open'],['10000000-0000-4000-8000-000000000004','day0-lab',2,'closed']]};
 const h=await harness({read:()=>({status:401,data:{error:'sign in required'}}),pulseRead:()=>pulse});assert.ok(key(h.root,'signin'),'this is the guest view');
 const card=talkLinks(cardOf(h,'El poder de lo local'));assert.equal(card.length,1);assert.equal(card[0].href,'fiiu-talk.html?a=day1-am');
 const lab=cardOf(h,'Gestión urbana en acción').querySelector('.f-activity-foot');assert.equal(talkLinks(lab)[0].href,'fiiu-talk.html?a=day0-lab');assert.equal(talkLinks(lab)[0]['aria-describedby'],'f-act-day0-lab-title');
 const row=h.root.querySelectorAll('.f-compact').find(node=>descendants(node).some(child=>child.id==='f-act-workshop-calles-gente-title')),link=row.querySelector('.f-compact-actions').querySelector('.f-talk-link');
 assert.equal(link.href,'fiiu-talk.html?a=workshop-calles-gente');assert.match(content(link),/Conversation\s+·\s+1/);assert.equal(link.querySelector('.f-talk-spoken').textContent,', 1 question');
 assert.equal(talkLinks(h.root).length,3);
});

test('the cancel question says conversation messages stay, in every language',()=>{
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);const {rows}=context.window.Fiiu;
 const said=['Your conversation messages stay; delete them first if you want them removed.','Tus mensajes en las conversaciones se mantienen; bórralos antes si quieres eliminarlos.','Suas mensagens nas conversas permanecem; apague-as antes se quiser removê-las.'];
 rows.cancelConfirm.forEach((text,i)=>{assert.ok(text.endsWith(' '+said[i]),text);assert.match(text,[/^Cancel your registration/,/^¿Cancelar tu inscripción/,/^Cancelar sua inscrição/][i]);});
 for(const name of ['talkLink','talkLinkOne','talkLinkCount'])assert.ok(rows[name].length===3&&rows[name].every(text=>typeof text==='string'&&text.trim()),name);
});

test('the dashboard widget links the next block to its conversation',async()=>{
 const T=Date.parse('2026-10-21T08:00:00-05:00');class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[T]));}static now(){return T;}}
 const registration={...saved,answers:{...answers,activities:['day1-am']}};
 const {widget,requests}=await widgetHarness(path=>path==='/api/fiiu/pulse'?pulseData:widgetFeed(path)||self(registration),{Date:FrozenDate});
 const link=widget.querySelector('.f-next').querySelector('.f-talk-link');assert.equal(link.href,'fiiu-talk.html?a=day1-am');assert.match(content(link),/Conversation\s+·\s+2/);
 assert.equal(requests.filter(path=>path==='/api/fiiu/pulse').length,1);
 // A next block without questions has no link.
 const quiet=await widgetHarness(path=>path==='/api/fiiu/pulse'?{questions:[['10000000-0000-4000-8000-000000000005','day2-am',1,'open']]}:widgetFeed(path)||self(registration),{Date:FrozenDate});
 assert.ok(quiet.widget.querySelector('.f-next'));assert.equal(quiet.widget.querySelector('.f-talk-link'),null);
});

test('conversation links are small inline links with a CSS-drawn bubble and a 44px target on touch screens',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8');
 assert.match(css,/:is\(\.f-page,\.f-news-widget\) \.f-talk-link\{display:inline-flex;/);assert.match(css,/:is\(\.f-page,\.f-news-widget\) \.f-talk-link::before\{content:"";/);
 assert.match(css,/@media\(pointer:coarse\)\{:is\(\.f-page,\.f-news-widget\) \.f-talk-link\{min-height:44px\}\}/);
});

test('the new-tab note describes links but is hidden, so it is never read in page order',async()=>{
 const h=await harness(),note=descendants(h.root).find(node=>node.id==='f-newtab');
 assert.equal(note.hidden,true);assert.equal(note.dataset.fiiuText,'newTab');assert.equal(h.ctx.window.Fiiu.newTabNote().hidden,true);
});

test('lab status pills and form errors read naturally in Spanish and Portuguese',()=>{
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);const {rows}=context.window.Fiiu;
 assert.deepEqual([...rows.acceptedShort.slice(1)],['Laboratorio: aceptado/a','Laboratório: aceito/a']);assert.deepEqual([...rows.declinedShort.slice(1)],['Laboratorio: no seleccionado/a','Laboratório: não selecionado/a']);
 assert.equal(rows.requiredField[1],'Completa este campo para continuar.');assert.equal(rows.requiredField[2],'Preencha este campo para continuar.');
 assert.equal(rows.privacyRequired[1],'Marca esta casilla para guardar tu inscripción.');
 assert.equal(rows.accessibilityRequired[1],'Elige al menos una opción. Si no necesitas apoyo, marca «No necesito apoyo adicional».');assert.ok(rows.accessibilityRequired[1].includes('«'+rows.none[1]+'»'),'the option is quoted by its own label');
 assert.ok(rows.accessibilityRequired[2].includes('“'+rows.none[2]+'”'));
});

test('programme and registration actions are at least 44px tall on touch screens, with the text size unchanged',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8'),touch=[...css.matchAll(/@media\(pointer:coarse\)\{([^\n]*)\}\n/g)].map(match=>match[1]).join('');
 const rule=selector=>[...touch.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([,list])=>list.split(/,(?![^()]*\))/).includes(selector)).map(([,,body])=>body).join(';');
 for(const selector of ['.f-programme .f-button.secondary.f-small','.f-registration .f-button.f-small','.f-shell .f-steps .f-step','.f-registration .f-form .f-check'])assert.match(rule(selector),/min-height:44px/,selector);
 for(const selector of [':is(.f-hero,.f-compact-actions,.f-activity-foot,.f-external-meta) .f-text-link','.f-itinerary-row>.f-text-link','.f-stepped>fieldset>.f-text-link','.f-news-item>.f-text-link'])assert.match(rule(selector),/display:inline-flex;align-items:center;min-height:44px/,selector);
 // The session disclosure grows by padding: display:flex would drop its ▸ marker.
 assert.match(rule('.f-sessions>summary'),/padding-block:11px/);assert.doesNotMatch(rule('.f-sessions>summary'),/display/);
 // A multi-line checkbox label keeps its box at the first line, and the organiser's checkboxes are left alone.
 assert.doesNotMatch(rule('.f-registration .f-form .f-check'),/align-items/);assert.doesNotMatch(touch,/(^|[},])\.f-check\{/);
 assert.doesNotMatch(touch,/font-size/);
});

// One browser tab's sessionStorage: a second harness given the same one is a reload of that tab.
const tabStorage=()=>{const data=new Map();return{data,getItem:name=>data.has(name)?data.get(name):null,setItem:(name,value)=>{data.set(name,String(value));},removeItem:name=>{data.delete(name);}};};
const leave=h=>{let prevented=false;for(const listener of h.windowListeners.beforeunload||[])listener({preventDefault(){prevented=true;}});return prevented;};
const typeInto=(form,name,value)=>{const control=field(form,name);control.value=value;form.listeners.input({target:control});};
const tick=(form,name,value)=>{const box=descendants(form).find(node=>node.name===name&&node.value===value);box.checked=true;form.listeners.change({target:box});return box;};
const box=(form,name,value)=>descendants(form).find(node=>node.name===name&&node.value===value);
// A Date whose "now" the test moves (clock.at = …).
const movableClock=iso=>{const clock={at:Date.parse(iso)};clock.Date=class extends Date{constructor(...args){super(...(args.length?args:[clock.at]));}static now(){return clock.at;}};return clock;};

test('the hero, programme and news appear from the public read while the registration is still loading, with no guest calls to action',async()=>{
 let answer;const news={...publicData,content:[{id:'n1',kind:'news',title:'Cambio de sala',body:'Texto',url:'',createdAt:'2026-10-20T12:00:00.000Z'}]};
 const h=await harness({read:()=>new Promise(resolve=>{answer=resolve;}),publicRead:()=>news}),panel=h.root.querySelector('.f-registration'),hero=h.root.querySelector('.f-hero');
 assert.ok(hero);assert.ok(h.root.querySelectorAll('.f-day').length>=4);assert.ok(descendants(h.root).some(node=>node.id==='news'));assert.equal(h.message.dataset.fiiuText,'','the page is no longer loading');
 assert.ok(key(panel,'registrationLoading'));assert.equal(key(panel,'signin'),undefined);assert.ok(key(hero,'viewProgramme'));
 for(const name of ['register','apply','addToRegistration','saveInterest'])assert.equal(key(h.root,name),undefined,name+' waits for the registration');
 answer({...self(saved),isAdmin:true});await flush();
 assert.ok(h.root.querySelector('.f-saved'));assert.equal(key(h.root,'registrationLoading'),undefined);assert.ok(key(h.root.querySelector('.f-hero'),'viewRegistration'));
 const admin=h.root.children.findIndex(node=>node.dataset.fiiuText==='admin');assert.equal(admin,1,'the organiser link sits under the hero once the account is known');
 assert.ok(key(h.root,'saveInterest'));
});

test('Back to the festival page returns to the same place: the position is kept on pagehide and restored once the page is drawn',async()=>{
 const storage=tabStorage(),scrolls=[];
 const page=(type,{y=0,read}={})=>harness({registration:saved,read,context:{sessionStorage:storage,scrollY:y,scrollTo:options=>scrolls.push({...options}),performance:{getEntriesByType:kind=>kind==='navigation'?[{type}]:[]}}});
 const first=await page('navigate',{y:2080});assert.deepEqual(scrolls,[],'a new visit starts at the top');
 for(const listener of first.windowListeners.scroll)listener({});for(const listener of first.windowListeners.pagehide)listener({persisted:false});
 let answer;await page('back_forward',{read:()=>new Promise(resolve=>{answer=resolve;})});assert.deepEqual(scrolls,[],'it waits until the registration is drawn');
 answer(self(saved));await flush();assert.deepEqual(scrolls,[{top:2080,behavior:'instant'}],'instant: the page scrolls smoothly otherwise');
 scrolls.length=0;await page('reload');assert.deepEqual(scrolls,[{top:2080,behavior:'instant'}],'a reload keeps the place too');
 scrolls.length=0;await page('navigate');assert.deepEqual(scrolls,[]);
});

test('a half-filled registration comes back after a reload in the same tab, without the ID number, and leaving asks first',async()=>{
 const storage=tabStorage(),context={sessionStorage:storage};
 const first=await harness({context}),form=first.form();assert.equal(leave(first),false,'an untouched form lets the page go');
 typeInto(form,'firstName','Carla');typeInto(form,'nationalId','12345678');tick(form,'activities','day1-am');tick(form,'accessibility','none');
 assert.equal(leave(first),true,'unsaved answers ask before the page goes');assert.doesNotMatch([...storage.data.values()].join(' '),/12345678/,'the ID number is never kept in storage');
 const second=await harness({context,write:request=>({registration:{...saved,answers:request.body}})}),again=second.form();
 assert.equal(field(again,'firstName').value,'Carla');assert.equal(field(again,'nationalId').value,'');assert.equal(box(again,'activities','day1-am').checked,true);assert.equal(box(again,'accessibility','none').checked,true);
 assert.match(content(again.querySelector('.f-selection')),/1\s+conference block/,'the save bar counts the restored choice');
 assert.ok(key(second.root.querySelector('.f-registration'),'draftRestored'),'the panel says the answers were kept');assert.equal(leave(second),true,'restored answers are still unsaved');
 // A successful save drops the draft, and the page goes without asking.
 second.fill();await second.submit();assert.ok(second.root.querySelector('.f-saved'));assert.equal(storage.data.size,0);assert.equal(leave(second),false);
 const third=await harness({context});assert.equal(field(third.form(),'firstName').value,'');assert.equal(key(third.root,'draftRestored'),undefined);
});

test('a restored new-registration draft can be discarded, and another account in the tab drops it instead of seeing it',async()=>{
 const storage=tabStorage(),context={sessionStorage:storage};
 const first=await harness({context});typeInto(first.form(),'firstName','Carla');
 const other={...user,id:'00000000-0000-4000-8000-000000000009',email:'beto@example.test'};
 const beto=await harness({context,read:()=>({user:other,registration:null,attendance:[],isAdmin:false})});
 assert.equal(field(beto.form(),'firstName').value,'','another account never sees the draft');assert.equal(storage.data.size,0,'a shared phone keeps no one else’s answers');
 typeInto(beto.form(),'firstName','Beto');
 const again=await harness({context,read:()=>({user:other,registration:null,attendance:[],isAdmin:false})});assert.equal(field(again.form(),'firstName').value,'Beto');
 let asked=0;again.ctx.window.confirm=()=>{asked++;return asked>1;};
 await key(again.form(),'discardDraft').listeners.click();assert.equal(field(again.form(),'firstName').value,'Beto','declining keeps the answers');
 await key(again.form(),'discardDraft').listeners.click();
 assert.equal(asked,2);assert.equal(field(again.form(),'firstName').value,'');assert.equal(key(again.root,'discardDraft'),undefined);assert.equal(storage.data.size,0);assert.equal(leave(again),false);
});

test('Back to my registration asks before dropping unsaved edits, and an edit restored after a reload opens the form on it',async()=>{
 const storage=tabStorage(),context={sessionStorage:storage};let asked=0,agree=false;
 const h=await harness({registration:saved,context});h.ctx.window.confirm=()=>{asked++;return agree;};
 await key(h.root,'edit').listeners.click();await key(h.form(),'backToSaved').listeners.click();assert.equal(asked,0,'an untouched edit goes back without asking');assert.equal(h.form().hidden,true);
 await key(h.root,'edit').listeners.click();await key(cardOf(h,'Cuidar y transformar la ciudad'),'addToRegistration').listeners.click();typeInto(h.form(),'firstName','Ana Cambiada');
 await key(h.form(),'backToSaved').listeners.click();assert.equal(asked,1);assert.equal(h.form().hidden,false,'declining keeps the edit open');assert.equal(field(h.form(),'firstName').value,'Ana Cambiada');
 const again=await harness({registration:saved,context});
 assert.equal(again.form().hidden,false,'a restored edit opens the form');assert.equal(again.root.querySelector('.f-saved').hidden,true);assert.equal(field(again.form(),'firstName').value,'Ana Cambiada');
 assert.equal(box(again.form(),'activities','day2-am').checked,true,'a block added from the programme comes back too');assert.equal(key(cardOf(again,'Cuidar y transformar la ciudad'),'choiceAdded').dataset.fiiuText,'choiceAdded');
 assert.ok(key(again.root.querySelector('.f-registration'),'draftRestored'));
 again.ctx.window.confirm=()=>true;await key(again.form(),'backToSaved').listeners.click();assert.equal(again.form().hidden,true);assert.equal(storage.data.size,0,'discarding drops the draft');
 // A draft made against an older saved version (an edit from another device since) is stale and dropped.
 const typed=await harness({registration:saved,context});await key(typed.root,'edit').listeners.click();typeInto(typed.form(),'city','Callao');
 const newer=await harness({registration:{...saved,version:2},context});assert.equal(newer.form().hidden,true);assert.equal(field(newer.form(),'city').value,'Lima');assert.equal(storage.data.size,0);
});

test('with registration closed, cancelling warns there is no way back, the summary points to the organisers, and the interests hint drops the save step',async()=>{
 const closed={...publicData,config:{...publicData.config,registrationOpen:false}},registration={...saved,answers:{...answers,externalActivities:['workshop-calles-gente']}};let question='';
 const h=await harness({registration,publicRead:()=>closed});h.ctx.window.confirm=text=>{question=text;return false;};const {t,rows}=h.ctx.window.Fiiu;
 await key(h.root,'cancel').listeners.click();assert.ok(question.endsWith(' '+t('cancelClosed')),question);assert.ok(question.startsWith(t('cancelConfirm')));
 const summary=h.root.querySelector('.f-saved');assert.ok(key(summary,'externalInterestClosedHint'));assert.equal(key(summary,'externalInterestHint'),undefined);assert.ok(key(summary,'closedChanges'));
 assert.equal(rows.cancelClosed[1],'La inscripción está cerrada: no podrás volver a inscribirte.');assert.doesNotMatch(rows.externalInterestClosedHint[1],/Guarda/);
 const open=await harness({registration});open.ctx.window.confirm=text=>{question=text;return false;};await key(open.root,'cancel').listeners.click();
 assert.ok(!question.includes(t('cancelClosed')));assert.ok(key(open.root.querySelector('.f-saved'),'externalInterestHint'));assert.equal(key(open.root,'closedChanges'),undefined);
 // An incomplete registration already names the address in its notice, so it is not repeated.
 const old=await harness({registration:{...saved,answers:{firstName:'Ana',lastName:'Test',activities:['day1-am'],privacyAccepted:true}},publicRead:()=>closed});
 assert.ok(key(old.root,'incompleteClosedNotice'));assert.equal(key(old.root,'closedChanges'),undefined);
});

test('during a block, the hero says it is happening now and links to its conversation and its day; a minute timer moves it on',async()=>{
 const clock=movableClock('2026-10-22T11:30:00-05:00'),registration={...saved,answers:{...answers,activities:['day2-am','day2-pm']}};
 const pulse={questions:[['10000000-0000-4000-8000-000000000007','day2-am',1,'open']]};
 const h=await harness({registration,pulseRead:()=>pulse,context:{Date:clock.Date}}),next=()=>h.root.querySelector('.f-next');
 assert.ok(key(next(),'nowForYou'));assert.equal(key(next(),'nextForYou'),undefined);
 const talk=next().querySelector('.f-talk-link');assert.equal(talk.href,'fiiu-talk.html?a=day2-am');assert.equal(talk['aria-describedby'],'f-next-title');
 const day=next().querySelectorAll('a').find(node=>node.href==='#day-2026-10-22');assert.ok(day,'the block links to its day in the programme');assert.match(content(day),/Cuidar y transformar la ciudad/);
 assert.ok(h.timers.some(timer=>timer.delay===60000),'the hero is checked every minute during the festival');
 const same=next();await h.tickTimers();assert.equal(next(),same,'nothing is redrawn while the block and its state stay the same');
 clock.at=Date.parse('2026-10-22T13:05:00-05:00');await h.tickTimers();assert.ok(key(next(),'nextForYou'));assert.match(content(next()),/El espacio público/);assert.equal(next().querySelector('.f-talk-link'),null,'a block without questions has no conversation link');
 // Before the block starts it is "next", and an untimed accepted laboratory is never "now".
 const early=await harness({registration,context:{Date:movableClock('2026-10-22T08:30:00-05:00').Date}});assert.ok(key(early.root.querySelector('.f-next'),'nextForYou'));
 const lab=await harness({registration:{...saved,labStatus:'accepted',answers:{...answers,activities:[]}},context:{Date:movableClock('2026-10-20T11:00:00-05:00').Date}});assert.ok(key(lab.root.querySelector('.f-next'),'nextForYou'));
 const after=await harness({registration,context:{Date:movableClock('2026-10-26T10:00:00-05:00').Date}});assert.ok(!after.timers.some(timer=>timer.delay===60000),'no timer once the festival is over');
 assert.deepEqual([...h.ctx.window.Fiiu.rows.nowForYou],['Happening now','Ahora','Agora']);
});

test('coming back to the tab picks up new conversations and news at most once a minute, and never redraws a form being filled in',async()=>{
 const clock=movableClock('2026-10-21T08:00:00-05:00'),registration={...saved,answers:{...answers,activities:['day1-am','day1-pm']}};
 let questions=[['10000000-0000-4000-8000-000000000001','day1-am',1,'open']],news=[{id:'n1',kind:'news',title:'Cambio de sala para el bloque del jueves',body:'Sala B',url:'',createdAt:'2026-10-20T12:00:00.000Z'}],pulseFails=false;
 const h=await harness({registration,publicRead:()=>({...publicData,content:news}),pulseRead:()=>pulseFails?{status:503,data:{error:'unavailable'}}:{questions},context:{Date:clock.Date}});
 const links=node=>talkLinks(node).map(link=>link.href),reads=path=>h.requests.filter(request=>request.path===path).length,back=async()=>{await h.visible(false);await h.visible(true);await flush();};
 const newsTitles=()=>descendants(descendants(h.root).find(node=>node.id==='news')).filter(node=>node.tagName==='h3').map(node=>node.textContent);
 assert.deepEqual(links(h.root.querySelector('.f-programme')),['fiiu-talk.html?a=day1-am']);
 questions=[...questions,['10000000-0000-4000-8000-000000000002','day1-pm',1,'open']];news=[{id:'n2',kind:'news',title:'Nueva sala para el bloque de la noche',body:'Sala C',url:'',createdAt:'2026-10-21T12:00:00.000Z'},...news];
 clock.at+=30000;await back();assert.equal(reads('/api/fiiu/pulse'),1,'within a minute nothing is read again');
 clock.at+=61000;await back();
 assert.deepEqual(links(h.root.querySelector('.f-programme')),['fiiu-talk.html?a=day1-am','fiiu-talk.html?a=day1-pm']);
 assert.deepEqual(links(h.root.querySelector('.f-saved')),['fiiu-talk.html?a=day1-am','fiiu-talk.html?a=day1-pm'],'the saved itinerary, not being edited, follows too');
 assert.deepEqual(newsTitles(),['Nueva sala para el bloque de la noche','Cambio de sala para el bloque del jueves']);assert.match(content(h.root.querySelector('.f-latest')),/Nueva sala/);
 // A failed read keeps what is shown; a back/forward-cache restore counts as a return.
 pulseFails=true;clock.at+=61000;await back();assert.equal(links(h.root.querySelector('.f-programme')).length,2);
 pulseFails=false;questions=[...questions,['10000000-0000-4000-8000-000000000003','day2-am',1,'open']];clock.at+=61000;
 for(const listener of h.windowListeners.pageshow||[])listener({persisted:true});await flush();assert.equal(links(h.root.querySelector('.f-programme')).length,3);
 // An edit in progress keeps its form, draft and focus; only the programme and hero follow.
 await key(h.root,'edit').listeners.click();const form=h.form();typeInto(form,'city','Callao');
 questions=[...questions,['10000000-0000-4000-8000-000000000004','day3-am',1,'open']];clock.at+=61000;await back();
 assert.equal(h.form(),form);assert.equal(field(form,'city').value,'Callao');assert.equal(form.hidden,false);assert.equal(links(h.root.querySelector('.f-programme')).length,4);
});

// Records the ids of the nodes scrollIntoView lands on, and lets document.querySelector find a node by its id as a browser does.
function watchScrolls(){
 const seen=[],{scrollIntoView,querySelectorAll}=Node.prototype;
 Node.prototype.scrollIntoView=function(){seen.push(this.id);};
 Node.prototype.querySelectorAll=function(selector){return /^#[\w-]+$/.test(selector)?descendants(this).filter(node=>node.id===selector.slice(1)):querySelectorAll.call(this,selector);};
 return{seen,restore(){Node.prototype.scrollIntoView=scrollIntoView;Node.prototype.querySelectorAll=querySelectorAll;}};
}
const at=hash=>({location:{hash,search:'',pathname:'/fiiu.html'}});

test('a link to the news, the materials, the programme or a day lands there again once the registration redraws the page above it, unless the person has moved',async()=>{
 const scrolls=watchScrolls();
 try{
  for(const hash of ['#news','#materials','#programme','#day-2026-10-23']){
   let answer;scrolls.seen.length=0;await harness({read:()=>new Promise(resolve=>{answer=resolve;}),context:at(hash)});
   assert.deepEqual(scrolls.seen,[hash.slice(1)],hash+': the programme and feeds are drawn, so the link scrolls at once');
   answer(self(saved));await flush();assert.deepEqual(scrolls.seen,[hash.slice(1),hash.slice(1)],hash+' is at the top again after the registration redraw');
  }
  // A registration that answers at once still redraws the programme and panel, so the scroll follows that redraw too.
  scrolls.seen.length=0;await harness({registration:saved,context:at('#programme')});assert.equal(scrolls.seen.at(-1),'programme');assert.equal(scrolls.seen.length,2);
  // Someone who scrolled, tapped or typed meanwhile stays where they went.
  for(const type of ['wheel','touchstart','pointerdown','keydown']){
   let answer;scrolls.seen.length=0;const h=await harness({read:()=>new Promise(resolve=>{answer=resolve;}),context:at('#news')});
   for(const listener of h.windowListeners[type]||[])listener({type});
   answer(self(saved));await flush();assert.deepEqual(scrolls.seen,['news'],type);
  }
 }finally{scrolls.restore();}
});

test('Back after a link inside the page is the browser’s own restore: only a Back or reload being rebuilt turns it off, and only until the page is drawn',async()=>{
 const storage=tabStorage(),scrolls=[];storage.setItem('fiiu.place:/fiiu.html','2080');
 const page=(type,read)=>harness({registration:saved,read,context:{sessionStorage:storage,scrollTo:options=>scrolls.push({...options}),performance:{getEntriesByType:kind=>kind==='navigation'?[{type}]:[]}}});
 const fresh=await page('navigate');assert.notEqual(fresh.ctx.history.scrollRestoration,'manual','a new visit leaves the browser in charge');
 let answer;const back=await page('back_forward',()=>new Promise(resolve=>{answer=resolve;}));assert.equal(back.ctx.history.scrollRestoration,'manual','the browser does not jump about while the page is rebuilt');
 answer(self(saved));await flush();assert.deepEqual(scrolls,[{top:2080,behavior:'instant'}]);
 // Day chips, "Ver mi inscripción", "Última novedad" and the step links make history entries that copy this setting, so Back from them works again.
 assert.equal(back.ctx.history.scrollRestoration,'auto');
 const reload=await page('reload');assert.equal(reload.ctx.history.scrollRestoration,'auto');
 const failed=await harness({publicRead:()=>({status:503,data:{error:'unavailable'}}),context:{sessionStorage:storage,scrollTo(){},performance:{getEntriesByType:()=>[{type:'reload'}]}}});
 assert.ok(key(failed.root,'retry'));assert.equal(failed.ctx.history.scrollRestoration,'auto','a page that could not be drawn gives the restore back too');
});
