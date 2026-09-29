import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,descendants,content} from './helpers/fiiu-ui-harness.js';

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
