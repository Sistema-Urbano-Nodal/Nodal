import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';

/* Who may join Curso Movilidad Nivel 2 now that it is closed (server/course-perks.js): FIIU Fest 11 registrants
   registered by the end of 25 Oct in Lima, and the 1 Oct boundary of the September group. */
const COURSE='72e3cc56-a506-4a1b-97b5-9333e8d283ca',member={id:'10000000-0000-4000-8000-000000000001',permission:'member'};
// A FIIU store holding `rows` as registrations; it answers by equality on every filter and records each read.
function fiiuStore(rows=[]) {
 const reads=[];
 return {reads,find:async(name,filters,options)=>{reads.push([name,filters,options]);return rows.filter(row=>name==='registrations'&&Object.entries(filters).every(([key,value])=>row[key]===value)).slice(0,options?.limit);}};
}
const registration=(createdAt,patch={})=>({id:'20000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',userId:member.id,createdAt,...patch});
const eligible=(rows,user=member)=>createCoursePerks({fiiuStore:fiiuStore(rows)}).fiiuEligible(user);

test('the perk names one course, one festival and two instants, frozen',()=>{
 assert.deepEqual({...FIIU_COURSE_PERK},{courseId:COURSE,eventId:'fiiu-2026',registeredBefore:'2026-10-26T05:00:00Z',septemberBefore:'2026-10-01T00:00:00Z'});
 assert.ok(Object.isFrozen(FIIU_COURSE_PERK));assert.ok(Object.isFrozen(createCoursePerks()));
});

test('the rules apply to the perk course only, whatever the case of its id',()=>{
 const perks=createCoursePerks();
 assert.equal(perks.courseId,COURSE);
 assert.equal(perks.applies(COURSE),true);assert.equal(perks.applies(COURSE.toUpperCase()),true);
 for(const id of ['10000000-0000-4000-8000-000000000009','',null,undefined,42])assert.equal(perks.applies(id),false,String(id));
});

test('the September group is the enrolments made before 1 Oct UTC; an unreadable date is not',()=>{
 const {inSeptemberGroup}=createCoursePerks();
 assert.equal(inSeptemberGroup({createdAt:'2026-09-13T23:40:33.765Z'}),true);
 assert.equal(inSeptemberGroup({createdAt:'2026-09-30T23:59:59.999Z'}),true);
 assert.equal(inSeptemberGroup({createdAt:'2026-10-01T00:00:00.000Z'}),false);
 assert.equal(inSeptemberGroup({createdAt:'2026-10-19T14:00:00.000Z'}),false);
 for(const enrollment of [{createdAt:'garbage'},{createdAt:''},{createdAt:null},{},null,undefined])assert.equal(inSeptemberGroup(enrollment),false,JSON.stringify(enrollment));
});

test('September posts are the ones written before 1 Oct UTC; an unreadable date stays with the September group',()=>{
 const {septemberPost}=createCoursePerks();
 assert.equal(septemberPost({createdAt:'2026-09-20T14:05:00.000Z'}),true);
 assert.equal(septemberPost({createdAt:'2026-10-01T00:00:00.000Z'}),false);
 assert.equal(septemberPost({createdAt:'2026-10-19T09:30:00.000Z'}),false);
 for(const post of [{createdAt:'garbage'},{createdAt:''},{},null,undefined])assert.equal(septemberPost(post),true,JSON.stringify(post));
});

test('a FIIU Fest 11 registration made before the end of 25 Oct in Lima makes a member eligible, read once',async()=>{
 const store=fiiuStore([registration('2026-10-26T04:59:59.999999+00:00')]);
 assert.equal(await createCoursePerks({fiiuStore:store}).fiiuEligible(member),true);
 assert.deepEqual(store.reads,[['registrations',{eventId:'fiiu-2026',userId:member.id},{limit:1}]]);
 assert.equal(await eligible([registration('2026-09-28T16:12:00.000Z')]),true);
 // At or after the deadline, in both text forms, is too late.
 for(const createdAt of ['2026-10-26T05:00:00Z','2026-10-26T05:00:00.000Z','2026-10-26T05:00:00.000001+00:00','2026-10-26T05:00:01.000000+00:00'])assert.equal(await eligible([registration(createdAt)]),false,createdAt);
 assert.equal(await eligible([registration('garbage')]),false);
 // No registration (never made, or cancelled: cancelling removes the row), another festival's, or another person's.
 assert.equal(await eligible([]),false);
 assert.equal(await eligible([registration('2026-10-10T12:00:00.000Z',{eventId:'fiiu-2025'})]),false);
 assert.equal(await eligible([registration('2026-10-10T12:00:00.000Z',{userId:'10000000-0000-4000-8000-000000000002'})]),false);
});

test('staff, a missing account and a server without the FIIU store are never eligible, and a failed read is not swallowed',async()=>{
 const store=fiiuStore([registration('2026-10-10T12:00:00.000Z')]),perks=createCoursePerks({fiiuStore:store});
 assert.equal(await perks.fiiuEligible({...member,permission:'admin'}),false);
 assert.equal(await perks.fiiuEligible(null),false);assert.equal(await perks.fiiuEligible({permission:'member'}),false);
 assert.deepEqual(store.reads,[],'nothing is read for them');
 assert.equal(await createCoursePerks().fiiuEligible(member),false);
 const broken=createCoursePerks({fiiuStore:{find:async()=>{throw Object.assign(new Error('FIIU unavailable'),{status:503});}}});
 await assert.rejects(broken.fiiuEligible(member),{message:'FIIU unavailable',status:503});
});

test('the local FIIU store answers the perk read',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const store=createFiiuStore({db}),perks=createCoursePerks({fiiuStore:store});
 const [early,late,elsewhere,none]=['early','late','elsewhere','none'].map(name=>toApiUser(createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused'})));
 const add=(user,eventId,createdAt)=>store.insert('registrations',{id:randomUUID(),eventId,userId:user.id,email:user.email,answers:{},labStatus:'none',version:1,createdAt,updatedAt:createdAt});
 await add(early,'fiiu-2026','2026-10-20T15:00:00.000Z');await add(late,'fiiu-2026','2026-10-26T05:00:00.000Z');await add(elsewhere,'fiiu-2025','2026-10-20T15:00:00.000Z');
 assert.deepEqual(await Promise.all([early,late,elsewhere,none].map(user=>perks.fiiuEligible(user))),[true,false,false,false]);
});

test('the course API runs on its default perks, and the server builds them from its FIIU store',async()=>{
 const api=createCourseApi({store:{find:async name=>name==='courses'?[{id:COURSE,status:'published',title:'Curso Movilidad Nivel 2'}]:[]},send:(res,status,body)=>Object.assign(res,{status,body})});
 const res={};await api({req:{method:'GET',headers:{}},res,url:new URL('https://nodal.test/api/courses'),user:member});
 assert.equal(res.status,200);assert.equal(res.body.courses[0].id,COURSE);
 const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),server=read('server/server.js'),courses=read('server/courses-api.js');
 // The wiring, checked in the source (assert.ok, since a failed assert.match would print the whole file).
 assert.ok(/^import \{ createCoursePerks \} from '\.\/course-perks\.js';$/m.test(server),'server.js imports createCoursePerks');
 assert.ok(/createCourseApi\(\{store:courseStore,[^}]*\bperks:createCoursePerks\(\{fiiuStore\}\),/.test(server),'createApp builds the perks from its FIIU store');
 assert.ok(/export function createCourseApi\(\{[^}]*\bperks=createCoursePerks\(\)\}=\{\}\)/.test(courses),'createCourseApi defaults to perks without a FIIU store');
 assert.ok(/createFinalSurvey\(\{[^}]*\bperks\}\)/.test(courses),'the final survey gets the same perks');
 assert.ok(/export function createFinalSurvey\(\{[^}]*\bperks=createCoursePerks\(\)\}\)/.test(read('server/course-final-survey.js')),'createFinalSurvey takes perks');
});
