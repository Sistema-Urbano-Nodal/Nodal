import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,createUser} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {FIIU_EVENT,checkinWindow} from '../server/fiiu-domain.js';
import {mergeProgramme,createProgramme} from '../server/fiiu-programme.js';

const builtIn=id=>FIIU_EVENT.activities.find(a=>a.id===id);
const merged=(event,id)=>event.activities.find(a=>a.id===id);

test('without edits the merged programme is the built-in one, with an empty description and edited false on every block',()=>{
 const before=structuredClone(FIIU_EVENT),event=mergeProgramme([]);
 assert.deepEqual(event.activities.map(a=>a.id),FIIU_EVENT.activities.map(a=>a.id));
 for(const a of event.activities){const {description,edited,...rest}=a;assert.deepEqual([description,edited],['',false],a.id);assert.deepEqual(rest,builtIn(a.id),a.id);}
 for(const key of Object.keys(FIIU_EVENT).filter(k=>k!=='activities'))assert.deepEqual(event[key],FIIU_EVENT[key],key);
 assert.deepEqual(FIIU_EVENT,before,'the built-in programme is never changed');
});

test('an edit replaces only the fields it holds, marks the block edited, and its check-in window and minutes follow the new time',()=>{
 const event=mergeProgramme([
  {id:'day1-am',eventId:'fiiu-2026',data:{title:'Nuevo título',time:'10:00–15:00',date:'2026-10-22'},version:2},
  {id:'day1-pm',eventId:'fiiu-2026',data:{description:'Línea 1\nLínea 2',formUrl:'https://forms.gle/not-for-a-conference'},version:1},
  {id:'route-arcoiris',eventId:'fiiu-2026',data:{formUrl:'https://forms.gle/nuevo',time:'08:30'},version:1},
  {id:'no-such-block',eventId:'fiiu-2026',data:{title:'Ignored'},version:1},
 ]);
 const am=merged(event,'day1-am');
 assert.deepEqual([am.title,am.time,am.date,am.venue,am.sessions,am.edited,am.description],['Nuevo título','10:00–15:00','2026-10-22',builtIn('day1-am').venue,builtIn('day1-am').sessions,true,'']);
 assert.equal(am.minutes,300,'five hours');assert.deepEqual(am.checkin,checkinWindow({date:'2026-10-22',time:'10:00–15:00'}));
 assert.deepEqual(am.checkin,{closesAt:'2026-10-22T20:30:00.000Z'});
 const pm=merged(event,'day1-pm');assert.equal(pm.description,'Línea 1\nLínea 2');assert.equal(Object.hasOwn(pm,'formUrl'),false,'a conference block never takes a form link');
 const route=merged(event,'route-arcoiris');assert.deepEqual([route.formUrl,route.time,route.checkin,route.minutes,route.edited],['https://forms.gle/nuevo','08:30',null,null,true]);
 assert.equal(event.activities.length,FIIU_EVENT.activities.length,'an unknown row adds nothing');
 assert.equal(merged(event,'day2-am').edited,false);
 // An untimed conference block closes at the end of its Lima day and counts no minutes, like the lab.
 const untimed=merged(mergeProgramme([{id:'day2-am',data:{time:''},version:1}]),'day2-am');
 assert.deepEqual([untimed.minutes,untimed.checkin],[null,{closesAt:'2026-10-23T05:00:00.000Z'}]);
});

test('the programme is read once per 30 seconds per instance, at once after clear(), and a failed read serves the last one',async()=>{
 let now=1e12,reads=0,rows=[],broken=false;
 const store={async find(name,filters,options){assert.deepEqual([name,filters,options],['programme',{eventId:'fiiu-2026'},{limit:200}]);reads++;await null;if(broken)throw Error('database unavailable');return rows;}};
 const programme=createProgramme({store,now:()=>now});
 assert.equal(merged(await programme.event(),'day1-am').title,builtIn('day1-am').title);assert.equal(reads,1);
 rows=[{id:'day1-am',data:{title:'Editado'},version:1}];
 now+=29999;assert.equal(merged(await programme.event(),'day1-am').title,builtIn('day1-am').title,'inside the 30 s the memo answers');assert.equal(reads,1);
 now+=1;assert.equal(merged(await programme.event(),'day1-am').title,'Editado');assert.equal(reads,2);
 rows=[];programme.clear();assert.equal(merged(await programme.event(),'day1-am').edited,false,'clear() reads again at once');assert.equal(reads,3);
 // Two requests arriving together share one read.
 programme.clear();const [a,b]=await Promise.all([programme.event(),programme.event()]);assert.equal(a,b);assert.equal(reads,4);
 // A failed read keeps serving the last programme and tries again on the next request.
 broken=true;rows=[{id:'day1-am',data:{title:'Nunca'},version:2}];now+=30000;
 assert.equal(merged(await programme.event(),'day1-am').edited,false);assert.equal(reads,5);
 broken=false;assert.equal(merged(await programme.event(),'day1-am').title,'Nunca','the failure is not memoised');assert.equal(reads,6);
 assert.deepEqual(await programme.rows(),rows);
 // The very first read has nothing to fall back on.
 const fresh=createProgramme({store:{find:async()=>{throw Error('database unavailable');}}});
 await assert.rejects(fresh.event(),/database unavailable/);
});

test('the local database keeps programme edits as the migration does: one row per block, JSON data, versioned, the editor id kept only while the account exists',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const store=createFiiuStore({db});
 const columns=db.prepare('PRAGMA table_info(fiiu_programme)').all().map(c=>c.name);
 assert.deepEqual(columns,['id','event_id','data','version','updated_by','updated_at']);
 const editor=createUser(db,{fullName:'Org',email:'org@example.test',passwordHash:'unused',role:'admin'});
 const row=await store.insert('programme',{id:'day1-am',eventId:'fiiu-2026',data:{title:'Uno',sessions:[['09:00','Charla']]},version:1,updatedBy:editor.id,updatedAt:'2026-10-13T12:00:00.000Z'});
 assert.deepEqual(row,{id:'day1-am',eventId:'fiiu-2026',data:{title:'Uno',sessions:[['09:00','Charla']]},version:1,updatedBy:editor.id,updatedAt:'2026-10-13T12:00:00.000Z'});
 await assert.rejects(store.insert('programme',{...row,version:1}),err=>err.status===409,'one row per block');
 assert.equal(await store.update('programme',{id:'day1-am',eventId:'fiiu-2026',version:2},{data:{title:'Stale'},version:3}),null,'an old version changes nothing');
 const updated=await store.update('programme',{id:'day1-am',eventId:'fiiu-2026',version:1},{data:{title:'Dos'},version:2,updatedAt:'2026-10-13T12:05:00.000Z'});
 assert.deepEqual([updated.data,updated.version],[{title:'Dos'},2]);
 assert.deepEqual((await store.find('programme',{eventId:'fiiu-2026'},{limit:200})).map(r=>[r.id,r.data.title,r.version]),[['day1-am','Dos',2]]);
 assert.throws(()=>db.prepare("INSERT INTO fiiu_programme VALUES ('day1-pm','fiiu-2026','{}',0,NULL,'x')").run(),/CHECK constraint/);
 db.prepare('DELETE FROM users WHERE id=?').run(editor.id);
 assert.equal((await store.find('programme',{id:'day1-am'}))[0].updatedBy,null,'deleting the editor keeps the edit');
 assert.equal(await store.remove('programme',{id:'day1-am',eventId:'fiiu-2026',version:1}),0);
 assert.equal(await store.remove('programme',{id:'day1-am',eventId:'fiiu-2026',version:2}),1);
 assert.deepEqual(await store.find('programme',{eventId:'fiiu-2026'}),[]);
});
