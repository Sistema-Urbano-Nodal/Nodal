import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const databaseUrl=process.env.NODAL_FIIU_TEST_DATABASE_URL;
test('PostgreSQL festival migrations enforce private access, conditional writes, account erasure and complete summaries',{skip:!databaseUrl,timeout:30000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.match(url.pathname,/^\/nodal_fiiu_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=async text=>(await execute('psql',[...args,'-c',text])).stdout.trim();
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$; CREATE TABLE profiles(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await execute('psql',[...args,'-f',new URL('../supabase/migrations/20260928233515_fiiu_festival.sql',import.meta.url).pathname]);
 await execute('psql',[...args,'-f',new URL('../supabase/migrations/20260929194059_fiiu_event_summary.sql',import.meta.url).pathname]);
 for(const name of ['registrations','attendance','config','content']){
  assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='fiiu_${name}'::regclass`),'t');
  for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await sql(`SELECT has_table_privilege('${role}','fiiu_${name}','${privilege}')`),'f');
 }
 const person='11111111-1111-4111-8111-111111111111',reg='22222222-2222-4222-8222-222222222222';
 await sql(`INSERT INTO profiles VALUES('${person}'); SET ROLE service_role;
 INSERT INTO fiiu_registrations VALUES('${reg}','fiiu-2026','${person}','fixture@example.test','{}','none',1,now(),now());`);
 const update=()=>sql(`SET ROLE service_role; UPDATE fiiu_registrations SET version=version+1 WHERE id='${reg}' AND version=1 RETURNING version;`);
 const results=await Promise.all([update(),update()]);assert.deepEqual(results.sort(),['','2']);
 assert.equal(await sql(`SET ROLE service_role; DELETE FROM fiiu_registrations WHERE id='${reg}' AND version=1 RETURNING id;`),'');
 await assert.rejects(sql(`SET ROLE authenticated; SELECT * FROM fiiu_registrations;`),/permission denied/);
 await assert.rejects(sql(`SET ROLE service_role; INSERT INTO fiiu_registrations VALUES(gen_random_uuid(),'fiiu-2026','${person}','fixture@example.test','{}','none',1,now(),now());`),/duplicate key/);
 await assert.rejects(sql(`SET ROLE service_role; UPDATE fiiu_registrations SET answers='[]' WHERE id='${reg}';`),/check constraint/);
 await sql(`SET ROLE service_role; INSERT INTO fiiu_attendance VALUES(gen_random_uuid(),'${reg}','day1-am','${person}',now());`);
 await sql(`DELETE FROM profiles WHERE id='${person}';`);
 assert.equal(await sql('SELECT count(*) FROM fiiu_registrations'),'0');assert.equal(await sql('SELECT count(*) FROM fiiu_attendance'),'0');
 const summaryFunction='public.fiiu_event_summary(text,jsonb)';
 assert.equal(await sql(`SELECT provolatile::text||':'||prosecdef::text FROM pg_proc WHERE oid='${summaryFunction}'::regprocedure`),'s:false');
 assert.equal(await sql(`SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${summaryFunction}'::regprocedure`),'t');
 assert.equal(await sql(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='${summaryFunction}'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'`),'0');
 for(const role of ['anon','authenticated']){
  assert.equal(await sql(`SELECT has_function_privilege('${role}','${summaryFunction}','EXECUTE')`),'f');
  await assert.rejects(sql(`SET ROLE ${role}; SELECT public.fiiu_event_summary('fiiu-2026','[]');`),/permission denied for function fiiu_event_summary/);
 }
 assert.equal(await sql(`SELECT has_function_privilege('service_role','${summaryFunction}','EXECUTE')`),'t');
 const catalog=[
  {id:'day0-lab',date:'2026-10-20',registration:'application'},
  {id:'day1-am',date:'2026-10-21',registration:'general'},
  {id:'day1-pm',date:'2026-10-21',registration:'general'},
  {id:'workshop-day1',date:'2026-10-21',registration:'external'},
  {id:'day2-am',date:'2026-10-22',registration:'general'},
  {id:'route-day4',date:'2026-10-24',registration:'external'},
  {id:'route-day5',date:'2026-10-25',registration:'external'},
 ];
 const summary=async(eventId='fiiu-2026')=>JSON.parse(await sql(`SET ROLE service_role; SELECT public.fiiu_event_summary('${eventId}','${JSON.stringify(catalog)}'::jsonb);`));
 const emptySummary={totalRegistrations:0,publicOfficials:0,lab:{pending:0,accepted:0,declined:0},activities:catalog.map(a=>({activityId:a.id,registrations:0,externalInterests:0,attendance:0})),days:[...new Set(catalog.map(a=>a.date))].map(date=>({date,registrations:0,attendance:0})),profiles:[]};
 assert.deepEqual(await summary(),emptySummary);
 await sql(`INSERT INTO public.profiles SELECT md5('summary-person-'||n)::uuid FROM generate_series(1,205) n;
 INSERT INTO public.fiiu_registrations
 SELECT md5('summary-registration-'||n)::uuid,'fiiu-2026',md5('summary-person-'||n)::uuid,'fixture@example.test',
 CASE WHEN n<=201 THEN jsonb_build_object('profile',CASE WHEN n%2=1 THEN 'student' ELSE 'professional' END,
  'publicOfficial',n<=3,'applyLab',n<=3,
  'activities',CASE WHEN n<=101 THEN '["day1-am","day1-am","day1-pm"]'::jsonb ELSE '["day2-am"]'::jsonb END,
  'externalActivities',CASE WHEN n<=2 THEN '["workshop-day1","workshop-day1","route-day4"]'::jsonb ELSE '[]'::jsonb END)
 WHEN n=202 THEN '{}'::jsonb
 WHEN n=203 THEN '{"profile":"","activities":null,"externalActivities":null,"publicOfficial":"true","applyLab":"true"}'::jsonb
 WHEN n=204 THEN '{"profile":{"nested":"student"},"activities":{},"externalActivities":"workshop-day1"}'::jsonb
 ELSE '{"profile":"activist","externalActivities":["workshop-day1","workshop-day1"]}'::jsonb END,
 CASE n WHEN 1 THEN 'pending' WHEN 2 THEN 'accepted' WHEN 3 THEN 'declined' ELSE 'none' END,1,now(),now()
 FROM generate_series(1,205) n;
 INSERT INTO public.fiiu_attendance
 SELECT gen_random_uuid(),md5('summary-registration-'||n)::uuid,activity_id,NULL,now()
 FROM (VALUES (1,'day1-am'),(1,'day1-pm'),(1,'workshop-day1'),(1,'route-day4'),(2,'day1-am'),(2,'route-day4'),(204,'day1-pm')) attendance(n,activity_id);`);
 assert.deepEqual(await summary(),{
  totalRegistrations:205,publicOfficials:3,lab:{pending:1,accepted:1,declined:1},
  activities:[
   {activityId:'day0-lab',registrations:3,externalInterests:0,attendance:0},
   {activityId:'day1-am',registrations:101,externalInterests:0,attendance:2},
   {activityId:'day1-pm',registrations:101,externalInterests:0,attendance:2},
   {activityId:'workshop-day1',registrations:0,externalInterests:3,attendance:1},
   {activityId:'day2-am',registrations:100,externalInterests:0,attendance:0},
   {activityId:'route-day4',registrations:0,externalInterests:2,attendance:2},
   {activityId:'route-day5',registrations:0,externalInterests:0,attendance:0},
  ],
  days:[
   {date:'2026-10-20',registrations:3,attendance:0},
   {date:'2026-10-21',registrations:102,attendance:3},
   {date:'2026-10-22',registrations:100,attendance:0},
   {date:'2026-10-24',registrations:2,attendance:2},
   {date:'2026-10-25',registrations:0,attendance:0},
  ],
  profiles:[{profile:'',count:3},{profile:'activist',count:1},{profile:'professional',count:100},{profile:'student',count:101}],
 });
 assert.deepEqual(await summary('other-event'),emptySummary,'summary must remain scoped to the requested event');
 assert.equal(await sql(`SELECT count(*) FROM public.fiiu_registrations WHERE id=md5('summary-registration-202')::uuid AND answers='{}'::jsonb`),'1','summaries do not normalize or modify historical records');
});
