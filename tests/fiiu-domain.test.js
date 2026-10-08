import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT,CHECKIN_ACTIVITIES,activityMinutes,checkinWindow,canAttend,attendanceHours,isCheckinActivity} from '../server/fiiu-domain.js';

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
