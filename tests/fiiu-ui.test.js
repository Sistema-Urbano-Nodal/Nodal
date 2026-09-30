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
async function harness({registration=null,write=async()=>({status:503,data:{error:'unavailable'}}),read,publicRead=()=>publicData}={}){
 let registrationReads=0;
 const h=await createFiiuHarness(request=>request.method!=='GET'?write(request):request.path==='/api/fiiu'?publicRead():request.path==='/api/auth/state'?{authenticated:true}:read?read(++registrationReads):self(registration));
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


test('public programme and self-registration start together without an auth-state round trip',async()=>{
 let finish;const h=await harness({publicRead:()=>new Promise(resolve=>{finish=resolve;})});
 assert.deepEqual(h.requests.map(request=>request.path),['/api/fiiu','/api/fiiu/registration']);finish(publicData);
});

test('only a registration 401 becomes a guest view; service failures remain retryable errors',async()=>{
 const guest=await harness({read:()=>({status:401,data:{error:'sign in required'}})});assert.ok(key(guest.root,'signin'));assert.equal(guest.form(),null);assert.ok(!key(guest.root,'retry'));assert.ok(!guest.requests.some(request=>request.path==='/api/auth/state'));
 const outage=await harness({read:()=>({status:503,data:{error:'unavailable'}})});assert.ok(key(outage.root,'retry'));assert.ok(!key(outage.root,'signin'));assert.equal(outage.form(),null);
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
 const use=key(h.form(),'useLatest');assert.equal(use.focused,true,'focus moves to the new action instead of falling to the page');use.listeners.click();
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

test('loading more news stays focusable, reports failures beside the button and moves focus to the first new item on the last page',async()=>{
 const item=id=>({id,kind:'news',title:'Item '+id,body:'',url:'',createdAt:'2026-09-29T12:00:00.000Z'});let fail=true;
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu'?{...publicData,content:[item('n1')],nextCursor:'c1'}:request.path==='/api/fiiu?cursor=c1'?(fail?{status:503,data:{error:'unavailable'}}:{content:[item('n2')],nextCursor:null}):self(null));
 const more=key(h.root,'loadMore'),feedback=h.root.querySelector('.f-load-more-status'),pending=more.listeners.click(),duplicate=more.listeners.click();
 assert.equal(more.disabled,false);assert.equal(more['aria-disabled'],'true');await Promise.all([pending,duplicate]);
 assert.equal(h.requests.filter(request=>request.path==='/api/fiiu?cursor=c1').length,1);assert.equal(feedback.dataset.fiiuText,'error');assert.equal(h.message.dataset.fiiuText,'');assert.equal(more['aria-disabled'],undefined);
 fail=false;await more.listeners.click();assert.equal(more.hidden,true);assert.equal(feedback.dataset.fiiuText,'');
 const heading=h.root.querySelector('.f-news').querySelectorAll('h3').find(node=>node.textContent==='Item n2');assert.equal(heading.focused,true);assert.equal(heading.tabIndex,-1);
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
 assert.deepEqual(steps.map(step=>step.children[1].dataset.fiiuText),['personal','stepChoices','stepQuestions','stepConsent']);
 assert.deepEqual(form.querySelectorAll('fieldset').filter(set=>set.id?.startsWith('f-step-')).map(set=>set.children[0].children[1].dataset.fiiuText),['personal','choices','questionnaire','consentStep']);
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
const widgetFeed=path=>path==='/api/fiiu?kind=news'?{content:[{id:'n1',kind:'news',title:'Festival announcement',body:'Published news',url:'',createdAt:'2026-09-29T12:00:00.000Z'}],nextCursor:null}:path==='/api/fiiu'?{...publicData,content:[{kind:'material',title:'Recent material',body:'',url:''}]}:null;

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
 const order=['dates','statusRegistered','viewRegistration','news'].map(name=>descendants(widget).indexOf(key(widget,name)));assert.deepEqual([...order].sort((a,b)=>a-b),order,'meta, state and CTA come before the news');
});

test('dashboard widget invites members without a registration to register and skips organiser requests',async()=>{
 const {widget,requests}=await widgetHarness(path=>widgetFeed(path)||self(null));
 assert.equal(key(widget,'statusNotRegistered').className,'f-pill');assert.equal(key(widget,'register').href,'fiiu.html#registration');
 assert.equal(key(widget,'viewRegistration'),undefined);assert.equal(key(widget,'nextForYou'),undefined);assert.equal(key(widget,'admin'),undefined);
 assert.deepEqual(requests.filter(path=>path!=='/api/fiiu?kind=news').sort(),['/api/fiiu/registration']);
});
