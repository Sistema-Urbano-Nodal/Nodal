import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createCourseStore} from '../server/courses-repository.js';
import {setupCoursePilot} from './setup-course-pilot.js';

const users=Number(process.argv.find(arg=>arg.startsWith('--users='))?.split('=')[1]??200);
if(!Number.isInteger(users)||users<1||users>500)throw new Error('--users must be 1 through 500');
const dir=await mkdtemp(join(tmpdir(),'nodal-course-load-'));
const db=createDatabase({filename:join(dir,'load.sqlite')}),store=createCourseStore({db});
const server=createApp({db,pilotMode:true});
const percentile=(values,p)=>Math.round([...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]*100)/100;
try{
  const course=await setupCoursePilot(store),module=(await store.find('modules',{courseId:course.id}))[0];
  const cookies=Array.from({length:users},(_,i)=>createSession(db,createUser(db,{fullName:`Load participant ${i}`,email:`load-${i}@example.test`,passwordHash:'unused'}).id).cookie.split(';')[0]);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`,coursePath=`/api/courses/${course.id}`,modulePath=coursePath+`/modules/${module.id}`;
  const phases=[
    ['enrollment',coursePath+'/enroll','POST',()=>({})],
    ['intake',coursePath+'/intake','PUT',i=>({fullName:`Load participant ${i}`,profession:'Planner',city:'Lima',motivation:'Test',experience:'Test',expectations:'Test',caseStudy:'Test',digitalFamiliarity:'Test'})],
    ['module',modulePath,'GET'],
    ['assignment',modulePath+'/posts','POST',()=>({clientId:randomUUID(),kind:'assignment',body:'Synthetic load-test observation'})],
    ['feedback','/api/feedback','POST',()=>({action:'assignment',rating:4,comment:'Synthetic load test',courseId:course.id,moduleId:module.id})],
  ];
  const results=[],started=performance.now();let errors=0;
  for(const [phase,path,method,body]of phases){
    const latency=[],statuses={};
    await Promise.all(cookies.map(async(cookie,i)=>{
      const start=performance.now();
      try{const response=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body(i)):undefined,signal:AbortSignal.timeout(30000)});await response.arrayBuffer();statuses[response.status]=(statuses[response.status]??0)+1;if(!response.ok)errors++;}
      catch{errors++;statuses.networkError=(statuses.networkError??0)+1;}
      latency.push(performance.now()-start);
    }));
    results.push({phase,requests:users,statuses,p50:percentile(latency,.5),p95:percentile(latency,.95),p99:percentile(latency,.99)});
  }
  const persisted={};for(const name of ['enrollments','intakes','posts','feedback'])persisted[name]=await store.count(name,{courseId:course.id});
  if(Object.values(persisted).some(n=>n!==users))errors++;
  console.log(JSON.stringify({environment:'local HTTP / disposable file-backed SQLite',timestamp:new Date().toISOString(),users,requests:users*phases.length,errors,elapsedMs:Math.round(performance.now()-started),persisted,results,limitations:'Five bounded bursts with pre-created sessions. Does not test Supabase, Vercel, email signup, attachments, or sustained real-world concurrency.'},null,2));
  if(errors)process.exitCode=1;
}finally{
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  db.close();await rm(dir,{recursive:true,force:true});
}
