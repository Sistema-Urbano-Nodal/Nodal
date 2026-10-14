import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT,CHECKIN_ACTIVITIES,activityMinutes,checkinWindow,canAttend,attendanceHours,isCheckinActivity,normalizeRegistration,REGISTERED_KINDS,canonicalTime,normalizeProgrammeEdit} from '../server/fiiu-domain.js';

const find=id=>FIIU_EVENT.activities.find(a=>a.id===id);

test('activity durations are parsed from the programme time with an en dash or a hyphen',()=>{
 for(const [time,minutes] of [['09:00–13:00',240],['19:00–21:00',120],['09:00-13:00',240],[' 9:30 – 11:00 ',90],['',null],[undefined,null],['13:00–09:00',null],['09:00',null],['tbc',null],['09:00–25:00',null]])
  assert.equal(activityMinutes({time}),minutes,String(time));
 assert.equal(activityMinutes(null),null);
 assert.deepEqual(['day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>activityMinutes(find(id))),[240,120,240,120,240]);
 assert.equal(CHECKIN_ACTIVITIES.reduce((sum,a)=>sum+(a.minutes??0),0),960,'the conference adds up to 16 hours');
});

test('check-in has no opening time and closes in Lima time 30 minutes after a block, or at the end of its Lima day when untimed',()=>{
 assert.deepEqual(checkinWindow(find('day1-am')),{closesAt:'2026-10-21T18:30:00.000Z'});
 assert.deepEqual(checkinWindow(find('day1-pm')),{closesAt:'2026-10-22T02:30:00.000Z'});
 assert.deepEqual(checkinWindow(find('day0-lab')),{closesAt:'2026-10-21T05:00:00.000Z'});
 for(const activity of CHECKIN_ACTIVITIES)assert.equal(Object.hasOwn(activity.checkin,'opensAt'),false,activity.id);
});

test('only NODAL blocks take a check-in and carry their window; workshops, routes and legacy activities do not',()=>{
 assert.deepEqual(CHECKIN_ACTIVITIES.map(a=>a.id),['day0-lab','day1-am','day1-pm','day2-am','day2-pm','day3-am']);
 for(const activity of FIIU_EVENT.activities){
  if(isCheckinActivity(activity))assert.deepEqual(activity.checkin,checkinWindow(activity),activity.id);
  else assert.deepEqual([activity.checkin,activity.minutes],[null,null],activity.id);
 }
 assert.equal(find('day0-lab').minutes,null,'the lab duration is not known yet');
 assert.ok(FIIU_EVENT.legacyActivities.every(a=>!isCheckinActivity(a)&&!Object.hasOwn(a,'checkin')));
});

test('attendance eligibility matches the organiser rule',()=>{
 const registration=(activities,labStatus='none')=>({answers:{activities},labStatus});
 assert.equal(canAttend(registration(['day1-am']),find('day1-am')),true);
 assert.equal(canAttend(registration(['day1-am']),find('day1-pm')),false);
 assert.equal(canAttend({answers:{},labStatus:'none'},find('day1-am')),false,'a historical answer without a plan is not eligible');
 assert.deepEqual(['accepted','pending','declined','none'].map(status=>canAttend(registration([],status),find('day0-lab'))),[true,false,false,false]);
 assert.equal(canAttend(registration([]),find('workshop-espacios-comunidad')),true,'external activities stay open to staff confirmation');
});

test('certificate hours sum timed NODAL blocks once each and round the person total half up',()=>{
 assert.deepEqual(attendanceHours([{activityId:'day1-am'},{activityId:'day1-pm'},{activityId:'day1-am'}]),{minutes:360,hours:6,untimed:[]});
 assert.deepEqual(attendanceHours([{activityId:'day0-lab'},{activityId:'workshop-espacios-comunidad'},{activityId:'workshop-day1'},{activityId:'removed'}]),{minutes:0,hours:0,untimed:['day0-lab']});
 assert.deepEqual(attendanceHours([]),{minutes:0,hours:0,untimed:[]});
 const block=(id,time)=>({id,date:'2026-10-21',registration:'general',time});
 for(const [time,hours] of [['09:00–11:30',3],['09:00–10:30',2],['09:00–10:29',1],['09:00–09:29',0],['09:00–09:30',1]])
  assert.equal(attendanceHours([{activityId:'a'}],[block('a',time)]).hours,hours,time);
 assert.equal(attendanceHours([{activityId:'e'}],[{id:'e',date:'2026-10-21',registration:'external',time:'09:00–13:00'}]).minutes,0,'external activities never add certificate hours');
});

// The smallest valid registration body, as tests/fiiu.test.js sends it.
const validInput={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};

test('the closing party is a register-only block: never checked in, never counted, valid alone in a registration',()=>{
 const party=FIIU_EVENT.activities.find(a=>a.id==='closing-party');
 assert.deepEqual({date:party.date,registration:party.registration,time:party.time,period:party.period},{date:'2026-10-25',registration:'social',time:'17:00',period:'party'});
 assert.equal(party.title,'¡Fiesta de cierre y Chelas Urbanas!');assert.match(party.venue,/La Vermut Bar, Av\. Francisco Bolognesi 235, Barranco 15063/);
 assert.deepEqual(party.sessions,[['17:00–19:00','Chelas Urbanas'],['19:00 en adelante','Fiesta de cierre']]);
 assert.equal(isCheckinActivity(party),false);assert.equal(CHECKIN_ACTIVITIES.some(a=>a.id==='closing-party'),false);
 assert.deepEqual([party.checkin,party.minutes],[null,null]);
 assert.equal(canAttend({answers:{activities:['closing-party']}},party),false,'staff can never confirm attendance at the party, even for someone who added it');
 assert.deepEqual(attendanceHours([{activityId:'closing-party'}]),{minutes:0,hours:0,untimed:[]});
 assert.deepEqual(REGISTERED_KINDS,['general','social']);
 const answers=normalizeRegistration({...validInput,activities:['closing-party'],externalActivities:[],applyLab:false});assert.deepEqual(answers.activities,['closing-party']);
 assert.equal(normalizeRegistration({...validInput,activities:['day1-am','day1-pm','day2-am','day2-pm','day3-am','closing-party']}).activities.length,6);
 assert.throws(()=>normalizeRegistration({...validInput,activities:['day1-am','day1-pm','day2-am','day2-pm','day3-am','closing-party','day0-lab']}),/invalid activities/);
 for(const id of ['day0-lab','workshop-bosques-urbanos','workshop-day1'])assert.throws(()=>normalizeRegistration({...validInput,activities:[id]}),/invalid activities/,id);
 // It sits after the last conference block, before the workshops and routes.
 const ids=FIIU_EVENT.activities.map(a=>a.id);assert.equal(ids.indexOf('closing-party'),ids.indexOf('day3-am')+1);
});

// Organiser edits to a programme block (server/fiiu-programme.js stores them). Each refusal is a 400 with its own code.
const refused=(fn,code)=>assert.throws(fn,err=>err.status===400&&err.code===code,code);
const edit=(id,changes={})=>{const a=find(id);return normalizeProgrammeEdit(a,{title:a.title,date:a.date,time:a.time,venue:a.venue,description:'',sessions:a.sessions,...(a.formUrl?{formUrl:a.formUrl}:{}),...changes});};

test('a programme time is empty, a start (party, workshops, routes only) or a range with the start first, saved with an en dash',()=>{
 for(const [value,expected] of [['',''],['  ',''],[undefined,''],[null,''],['17:00','17:00'],['09:00-13:00','09:00–13:00'],['09:00 – 13:00','09:00–13:00'],['09:00–13:00','09:00–13:00'],
  ['9:00',null],['13:00–09:00',null],['09:00–09:00',null],['24:00',null],['09:60',null],['09:00–13:00–14:00',null],['nine',null],[900,null],[{},null]])
  assert.equal(canonicalTime(value),expected,JSON.stringify(value));
 refused(()=>edit('day1-am',{time:'17:00'}),'invalid_time');
 refused(()=>edit('day0-lab',{time:'17:00'}),'invalid_time');
 refused(()=>edit('day1-am',{time:'13:00–09:00'}),'invalid_time');
 assert.equal(edit('closing-party',{time:'18:00'}).time,'18:00');
 assert.equal(edit('workshop-bosques-urbanos',{time:'15:00'}).time,'15:00');
 assert.equal(edit('route-arcoiris',{time:'08:30'}).time,'08:30');
 assert.equal(edit('day1-am',{time:''}).time,'','a conference block may be untimed, like the lab');
 assert.equal(edit('day1-am',{time:'10:00-14:00'}).time,'10:00–14:00');
});

test('programme titles, dates, venues, descriptions, session lines and form links follow the editor rules',()=>{
 for(const title of ['','   ','x'.repeat(201),'😀'.repeat(201),'Línea\nnueva','Línea\rnueva',42])refused(()=>edit('day1-am',{title}),'invalid_title');
 assert.equal(edit('day1-am',{title:'  Nuevo título  '}).title,'Nuevo título');
 assert.equal(edit('day1-am',{title:'😀'.repeat(200)}).title,'😀'.repeat(200),'200 characters, counted as code points');
 for(const date of ['2026-10-19','2026-10-26','2026-02-30','25/10/2026','2026-10-2','',undefined,20261020])refused(()=>edit('day1-am',{date}),'invalid_date');
 for(const date of ['2026-10-20','2026-10-25'])assert.equal(edit('day1-am',{date}).date,date);
 for(const venue of ['x'.repeat(201),'Sala\n2',7])refused(()=>edit('day1-am',{venue}),'invalid_venue');
 assert.equal(edit('day1-am',{venue:''}).venue,'');assert.equal(edit('day1-am',{venue:undefined}).venue,'');
 for(const description of ['x'.repeat(1501),42,{}])refused(()=>edit('day1-am',{description}),'invalid_description');
 assert.equal(edit('day1-am',{description:'  Uno\r\nDos\rTres\tcuatro\u0000\u0007\u001b fin  '}).description,'Uno\nDos\nTres\tcuatro fin','line breaks kept as \\n, tabs kept, other controls dropped, trimmed');
 assert.equal(edit('day1-am',{description:'x'.repeat(1500)}).description.length,1500);assert.equal(edit('day1-am',{description:undefined}).description,'');
 for(const sessions of ['09:00 Charla',{},Array.from({length:13},()=>['09:00','Charla']),[['09:00']],[['09:00','Charla','extra']],['09:00 Charla'],[['09:00','']],[['x'.repeat(41),'Charla']],[['09:00','x'.repeat(201)]],[['09:00\n10:00','Charla']],[[9,'Charla']]])
  refused(()=>edit('day1-am',{sessions}),'invalid_sessions');
 assert.deepEqual(edit('closing-party',{sessions:[[' 17:00–19:00 ',' Chelas Urbanas '],['','Fiesta de cierre'],['19:00 en adelante','Baile']]}).sessions,[['17:00–19:00','Chelas Urbanas'],['','Fiesta de cierre'],['19:00 en adelante','Baile']]);
 assert.deepEqual(edit('day1-am',{sessions:[]}).sessions,[]);assert.equal(edit('day1-am',{sessions:Array.from({length:12},()=>['','Charla'])}).sessions.length,12);
 // Workshops and routes keep a required https form link; every other block ignores one.
 for(const formUrl of ['http://forms.gle/x','',undefined,'javascript:alert(1)','https://user:pass@forms.gle/x'])refused(()=>edit('workshop-bosques-urbanos',{formUrl}),'invalid_form_url');
 assert.equal(edit('route-arcoiris',{formUrl:'https://forms.gle/nuevo'}).formUrl,'https://forms.gle/nuevo');
 assert.equal(Object.hasOwn(edit('day1-am',{formUrl:'https://forms.gle/x'}),'formUrl'),false);
 assert.equal(Object.hasOwn(edit('closing-party',{formUrl:'http://x'}),'formUrl'),false);
 assert.deepEqual(Object.keys(edit('day1-am')),['title','date','time','venue','description','sessions']);
});
