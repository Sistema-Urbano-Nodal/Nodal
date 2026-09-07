import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourseApi} from '../server/courses-api.js';
import {createCourseStore} from '../server/courses-repository.js';

const COURSE='10000000-0000-4000-8000-000000000001';
const STAFF='10000000-0000-4000-8000-000000000002';
const MEMBER='10000000-0000-4000-8000-000000000003';
const stamp='2026-09-07T12:00:00.000Z';
const course={id:COURSE,status:'published',title:'Course'};
const invoke=async(api,path,user)=>{
  const result={};
  await api({req:{method:'GET',headers:{}},res:{writeHead:(status)=>{result.status=status;},end:body=>{result.body=JSON.parse(body);}},url:new URL(path,'https://nodal.test'),user});
  return result;
};

test('course access reads run together but membership and private intake remain viewer-scoped',async()=>{
  const calls=[];let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const store={find:async(name,filter)=>{
    calls.push({name,filter});
    if(name==='courses'){await blocked;return[course];}
    if(name==='enrollments')return filter.userId===MEMBER?[{userId:MEMBER,courseId:COURSE}]:[];
    if(name==='intakes')return filter.userId===MEMBER?[{answers:{fullName:'Private member'}}]:[];
    return[{id:'module',title:'Title',status:'published',instructions:'Private teaching content',translations:{pt:{title:'Título',instructions:'Privado'}}}];
  }};
  const api=createCourseApi({store});
  const pending=invoke(api,'/api/courses/'+COURSE,{id:MEMBER,permission:'member'});
  const initial=calls.map(c=>c.name);release();const member=await pending;
  assert.deepEqual(initial,['courses','enrollments','intakes']);
  assert.equal(member.body.intake.fullName,'Private member');assert.equal(member.body.modules[0].instructions,'Private teaching content');
  const outsider=await invoke(api,'/api/courses/'+COURSE,{id:STAFF,permission:'member'});
  assert.equal(outsider.body.intake,null);assert.equal(outsider.body.enrollment,null);
  assert.equal(outsider.body.modules[0].instructions,undefined);assert.deepEqual(outsider.body.modules[0].translations.pt,{title:'Título'});
  assert.deepEqual(calls.filter(c=>c.name==='intakes').map(c=>c.filter.userId),[MEMBER,STAFF]);
  course.status='draft';try{await assert.rejects(invoke(api,'/api/courses/'+COURSE,{id:MEMBER,permission:'member'}),{status:404});}finally{course.status='published';}
});

test('staff report stops exhausted logical pages without probing each table again',async()=>{
  const calls=[];
  const data={enrollments:[{id:'enrollment',userId:MEMBER,createdAt:stamp}],intakes:[{id:'intake',userId:MEMBER,answers:{city:'Private city'}}],feedback:[{id:'feedback',userId:MEMBER,createdAt:stamp,rating:4}],invitations:[{id:'invitation',email:'new@example.test',createdAt:stamp}]};
  const api=createCourseApi({store:{find:async(name,filter,options)=>{
    calls.push({name,filter,options});
    if(name==='courses')return[course];
    if(filter.userId===STAFF)return[];
    return options.after?[]:data[name]??[];
  },count:async()=>1,getMembers:async()=>[{id:MEMBER,name:'Member',email:'member@example.test'}]}});
  const result=await invoke(api,'/api/admin/courses/'+COURSE+'/report',{id:STAFF,permission:'admin'});
  assert.equal(result.body.participants[0].intake.city,'Private city');assert.equal(result.body.feedback[0].rating,4);assert.equal(result.body.invitations.length,1);
  const reads=calls.filter(c=>c.filter.userId!==STAFF&&c.name!=='courses');
  assert.deepEqual(Object.fromEntries(Object.keys(data).map(name=>[name,reads.filter(c=>c.name===name).length])),{enrollments:1,intakes:1,feedback:1,invitations:1});
});

test('full CSV keeps all rows past a complete page then stops on the exhausted tail',async()=>{
  const rows=Array.from({length:503},(_,i)=>({id:String(i).padStart(4,'0'),userId:MEMBER,createdAt:stamp,action:'course',rating:4,comment:'Comment '+i}));const calls=[];
  const api=createCourseApi({store:{find:async(name,filter,options)=>{
    calls.push(options);const start=options.after?Number(options.after.id)+1:0;return rows.slice(start,start+options.limit);
  },getMembers:async()=>[{id:MEMBER,name:'Member',email:'member@example.test'}]},send:(res,status,body)=>{res.status=status;res.body=body;}});
  const res={};await api({req:{method:'GET'},res,url:new URL('https://nodal.test/api/admin/feedback/export'),user:{id:STAFF,permission:'admin'}});
  assert.equal(res.status,200);assert.match(res.body,/Comment 502/);assert.equal(res.body.trim().split('\n').length,504);assert.equal(calls.length,2);
});

test('known member ID batches avoid an empty Supabase request without truncating capped pages',async()=>{
  for(const cap of[2,100]){
    const rows=Array.from({length:5},(_,i)=>({id:String(i),full_name:'Member '+i,email:i+'@example.test'})),calls=[];
    const store=createCourseStore({clients:{admin:{rest:async(table,{query})=>{
      calls.push(query);return{rows:rows.slice(query.offset,query.offset+Math.min(cap,query.limit)),contentRange:'0-4/*'};
    }}}});
    const members=await store.getMembers(rows.map(r=>r.id));assert.equal(members.length,5);
    assert.equal(calls.length,cap===2?3:1);assert.equal(calls[0].limit,5);
  }
});

test('course directory reports the current viewer role with its existing data response',async()=>{
  const calls=[];const api=createCourseApi({store:{find:async(name,filter)=>{calls.push(filter);return[course];}}});
  for(const permission of['admin','member','admin']){
    const result=await invoke(api,'/api/courses',{id:STAFF,permission});
    assert.equal(result.body.isAdmin,permission==='admin');assert.equal(result.body.courses[0].id,COURSE);
  }
  assert.deepEqual(calls,[{status:'published'},{status:'published'},{status:'published'}]);
});
