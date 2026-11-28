import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTrainingStore} from '../../server/training-store.js';
import {trainingCases} from './training-cases.js';

export async function postgresTraining({sql,apply}) {
  await apply('../supabase/migrations/20261128193756_training_benefits_2027.sql');
  const literal=v=>v==null?'NULL':"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
  // Run every hosted adapter call through a separate psql connection under the actual service role.
  const admin={async rest(path,{body}) {
    const name=path.slice(4);assert.match(name,/^training_2027_[a-z_]+$/);
    const args=Object.entries(body).map(([k,v])=>{assert.match(k,/^p_[a-z_]+$/);return k+'=>'+literal(v);}).join(',');
    try {const value=await sql(`SET ROLE service_role; SELECT to_jsonb(public.${name}(${args}))`);return value?JSON.parse(value):null;}
    catch(err){const code=err.stderr?.match(/ERROR:\s+(?:[A-Z\d]{5}:\s+)?(training_[a-z_]+)/)?.[1];if(code)throw Error(code);throw err;}
  }};
  for (const role of ['anon','authenticated']) {
    const grants=await sql(`SELECT EXISTS(SELECT FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND left(p.proname,14)='training_2027_' AND has_function_privilege('${role}',p.oid,'EXECUTE'))`);
    assert.equal(grants,'f');
    assert.equal(await sql(`SELECT has_table_privilege('${role}','public.training_reservations_2027','SELECT,INSERT,UPDATE,DELETE')`),'f');
  }
  const store=createTrainingStore({clients:{admin}});
  await trainingCases({store,
    member:async()=>{const id=randomUUID();await sql(`INSERT INTO auth.users VALUES('${id}','${id}@example.test');
      INSERT INTO public.profiles(id,email) VALUES('${id}','${id}@example.test')`);return id;},
    course:async(year='2027')=>{const id=randomUUID();await sql(`INSERT INTO public.pilot_courses(id,title,status,starts_on,created_at,updated_at)
      VALUES('${id}','Test','published','${year}-12-01','2026-11-01','2026-11-01')`);return id;},
    legacySeat:(user,id)=>sql(`SET ROLE service_role; INSERT INTO public.course_enrollments(id,course_id,user_id,created_at) VALUES(gen_random_uuid(),'${id}','${user}','2026-11-01')`),
    moveDate:(id,year)=>sql(`SET ROLE service_role; UPDATE public.pilot_courses SET starts_on='${year}-09-01' WHERE id='${id}'`),
    erase:user=>sql(`DELETE FROM public.profiles WHERE id='${user}'`),
  });
}
