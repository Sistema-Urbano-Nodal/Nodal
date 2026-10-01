import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createFiiuApi} from '../server/fiiu-api.js';
import {createCheckinCodes} from '../server/fiiu-checkin.js';

// In-memory PostgREST for the festival tables: eq/gt/lt/in filters, the store's keyset `or`, order, limit, a response
// row cap, exact counts (Content-Range) and constraint errors shaped like server/supabase.js responseError().
function postgrest({cap=Infinity,count=true,afterRead}={}){
 const tables={fiiu_registrations:[],fiiu_attendance:[],fiiu_config:[],fiiu_content:[]},calls=[];
 const byText=(a,b)=>a<b?-1:a>b?1:0;
 const matches=(row,query)=>Object.entries(query).every(([key,expr])=>{
  if(['select','order','limit'].includes(key))return true;
  if(key==='or'){const [,lt,eq,id]=/^\(created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)\)$/.exec(expr);return row.created_at<lt||(row.created_at===eq&&row.id<id);}
  const [op,...rest]=expr.split('.'),value=rest.join('.'),actual=String(key==='data->>kind'?row.data?.kind:row[key]);
  return op==='eq'?actual===value:op==='gt'?actual>value:op==='lt'?actual<value:op==='in'?value.slice(1,-1).split(',').includes(actual):assert.fail('unsupported filter '+expr);
 });
 const error=(code,message)=>Object.assign(Error(message),{status:409,expose:false,code});
 async function rest(table,options={}){
  calls.push({table,...options});const query=options.query??{};
  if(!options.method){
   const found=tables[table].filter(row=>matches(row,query)).sort(query.order==='id.asc'?(a,b)=>byText(a.id,b.id):(a,b)=>byText(b.created_at,a.created_at)||byText(b.id,a.id));
   const page=structuredClone(found.slice(0,Math.min(query.limit,cap))),total=count&&options.headers?.Prefer==='count=exact'?found.length:'*';
   afterRead?.({table,tables,count:calls.length});
   return options.includeRange?{rows:page,contentRange:page.length?`0-${page.length-1}/${total}`:`*/${total}`}:page;
  }
  if(options.method==='POST'){
   const row=structuredClone(options.body);
   if(tables[table].some(r=>r.id===row.id))throw error('23505','duplicate key value violates unique constraint');
   if(table==='fiiu_attendance'&&!tables.fiiu_registrations.some(r=>r.id===row.registration_id))throw error('23503','insert or update violates foreign key constraint');
   tables[table].push(row);return [structuredClone(row)];
  }
  const hit=tables[table].filter(row=>matches(row,query));
  if(options.method==='PATCH'){hit.forEach(row=>Object.assign(row,structuredClone(options.body)));return structuredClone(hit);}
  tables[table]=tables[table].filter(row=>!hit.includes(row));return structuredClone(hit);
 }
 return {tables,calls,clients:{admin:{rest}}};
}
const uuid=n=>`${n}0000000-0000-4000-8000-000000000000`;
const registration=n=>({id:uuid(n),event_id:'fiiu-2026',user_id:'u'+n,email:'x',answers:{},lab_status:'none',version:1,created_at:'2026-09-29T00:00:00+00:00',updated_at:'x'});
const post=(n,day)=>({id:uuid(n),event_id:'fiiu-2026',data:{title:'T'+n,kind:'news'},status:'published',version:1,created_at:`2026-09-${day}T00:00:00+00:00`,updated_at:'x'});

test('Supabase festival adapter fills capped pages by keyset and scopes versioned writes and deletion',async()=>{
 const pg=postgrest({cap:1}),calls=pg.calls;
 pg.tables.fiiu_registrations.push({id:'a',user_id:'owner',answers:{city:'Lima'},version:1},{id:'b',user_id:'owner',answers:{city:'Callao'},version:1},{id:'c',user_id:'someone-else',answers:{city:'Cusco'},version:1});
 const store=createFiiuStore({clients:pg.clients});
 assert.deepEqual((await store.find('registrations',{userId:'owner'},{limit:3})).map(r=>r.answers.city),['Lima','Callao']);
 assert.deepEqual(calls.map(c=>[c.query.id,c.query.limit]),[[undefined,3],['gt.a',2]],'a capped page continues after its last row');
 assert.ok(calls.every(c=>c.query.user_id==='eq.owner'&&c.query.offset===undefined&&c.headers.Prefer==='count=exact'));
 await store.update('registrations',{id:'a',userId:'owner',version:1},{version:2,answers:{city:'Cusco'}});
 assert.deepEqual(calls.at(-1).query,{id:'eq.a',user_id:'eq.owner',version:'eq.1'});assert.deepEqual(calls.at(-1).body.answers,{city:'Cusco'});
 assert.equal(await store.remove('registrations',{id:'a',userId:'owner',version:1}),0);
 assert.equal(calls.at(-1).headers.Prefer,'return=representation');assert.equal(calls.at(-1).query.version,'eq.1');
 await store.find('content',{status:'published'},{limit:1,newest:true,after:'a',afterCreatedAt:'2026-09-28T12:00:00+00:00'});
 assert.equal(calls.at(-1).query.order,'created_at.desc,id.desc');assert.equal(calls.at(-1).query.or,'(created_at.lt.2026-09-28T12:00:00+00:00,and(created_at.eq.2026-09-28T12:00:00+00:00,id.lt.a))');
 assert.equal(calls.at(-1).headers,undefined,'a single-row lookup needs no count');
 await store.find('content',{status:'published'},{limit:1,newest:true,kind:'news'});
 assert.equal(calls.at(-1).query['data->>kind'],'eq.news');assert.equal(calls.at(-1).query.status,'eq.published');
 await store.find('content',{status:'published'},{newest:true,kind:'materials'});
 assert.equal(calls.at(-1).query['data->>kind'],'in.(recording,material)');
});

test('Supabase festival reads answer a short page in one request and a write between capped requests cannot repeat or skip rows',async()=>{
 const quiet=postgrest();quiet.tables.fiiu_registrations.push(...[3,5,7].map(registration));
 assert.equal((await createFiiuStore({clients:quiet.clients}).find('registrations',{eventId:'fiiu-2026'},{limit:100})).length,3);
 assert.equal(quiet.calls.length,1,'the usual short page costs one request');
 // A registration sorting before the cursor arrives between two capped requests.
 const busy=postgrest({cap:2,afterRead:({tables,count})=>{if(count===1)tables.fiiu_registrations.push(registration(2));}});
 busy.tables.fiiu_registrations.push(...[1,3,5,7].map(registration));
 assert.deepEqual((await createFiiuStore({clients:busy.clients}).find('registrations',{eventId:'fiiu-2026'},{limit:100})).map(r=>r.id[0]),['1','3','5','7']);
 // A newer publication arrives while the feed page is being filled.
 const feed=postgrest({cap:2,afterRead:({tables,count})=>{if(count===1)tables.fiiu_content.push(post(9,30));}});
 feed.tables.fiiu_content.push(post(1,20),post(2,21),post(3,22));
 assert.deepEqual((await createFiiuStore({clients:feed.clients}).find('content',{eventId:'fiiu-2026',status:'published'},{newest:true,limit:100})).map(r=>r.id[0]),['3','2','1']);
 assert.equal(feed.calls[1].query.or,`(created_at.lt.2026-09-21T00:00:00+00:00,and(created_at.eq.2026-09-21T00:00:00+00:00,id.lt.${uuid(2)}))`);
 // Without an exact count a short page is not trusted to be the last: read on until an empty page.
 const uncounted=postgrest({cap:2,count:false});uncounted.tables.fiiu_registrations.push(...[1,3,5].map(registration));
 assert.deepEqual((await createFiiuStore({clients:uncounted.clients}).find('registrations',{eventId:'fiiu-2026'},{limit:100})).map(r=>r.id[0]),['1','3','5']);
 assert.deepEqual(uncounted.calls.map(c=>c.query.id),[undefined,`gt.${uuid(3)}`,`gt.${uuid(5)}`]);
 await assert.rejects(createFiiuStore({clients:{admin:{async rest(){return [];}}}}).find('registrations',{},{limit:2}),error=>error.status===502);
});

test('Supabase festival writes map a vanished registration to 404 and a reused id to a conflict',async()=>{
 const pg=postgrest(),store=createFiiuStore({clients:pg.clients});
 await assert.rejects(store.insert('attendance',{id:'a1',registrationId:'gone',activityId:'day1-am',confirmedBy:null,createdAt:'x'}),error=>error.status===404&&error.message==='related record unavailable');
 const row={id:'c1',eventId:'fiiu-2026',data:{},status:'draft',version:1,createdAt:'x',updatedAt:'x'};await store.insert('content',row);
 await assert.rejects(store.insert('content',row),error=>error.status===409);
});

test('Supabase-backed festival API retries publications idempotently, lists materials and reports a check-in after cancellation',async()=>{
 let cancel=false;
 const pg=postgrest({cap:1,afterRead:({table,tables})=>{if(cancel&&table==='fiiu_attendance'){cancel=false;tables.fiiu_registrations.length=0;}}});
 const api=createFiiuApi({store:createFiiuStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body)=>Object.assign(res,{status,body})});
 const call=async(method,path,body,user={id:'admin',email:'admin@example.test',permission:'admin'})=>{
  const res={},req={method,headers:body===undefined?{}:{'content-type':'application/json'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  try{await api({req,res,url:new URL('http://nodal.test'+path),user});}catch(error){Object.assign(res,{status:error.status??500,body:{error:error.message}});}
  return res;
 };
 const id=crypto.randomUUID(),material={id,title:'Slides',body:'',status:'published',kind:'material',url:'https://example.test/slides',activityId:''};
 assert.equal((await call('POST','/api/admin/fiiu/content',material)).status,201);
 const retry=await call('POST','/api/admin/fiiu/content',material);assert.equal(retry.status,200);assert.equal(retry.body.content.id,id);
 assert.equal(pg.tables.fiiu_content.length,1);
 pg.tables.fiiu_content.push(post(1,20),{...post(2,21),data:{title:'T2',kind:'recording'}});
 const page=await call('GET','/api/fiiu?kind=materials',undefined,null);assert.equal(page.status,200);
 assert.deepEqual(page.body.content.map(c=>c.title),['Slides','T2']);assert.equal(page.body.nextCursor,null);
 pg.tables.fiiu_registrations.push({...registration(4),answers:{activities:['day1-am']}});cancel=true;
 const checkIn=await call('PUT',`/api/admin/fiiu/registrations/${uuid(4)}/attendance`,{activityId:'day1-am',attended:true});
 assert.deepEqual([checkIn.status,checkIn.body.error],[404,'registration unavailable']);
});

test('Supabase organizer summary uses one restricted aggregate RPC instead of downloading questionnaires',async()=>{
 const calls=[],summary={totalRegistrations:205,publicOfficials:3,lab:{pending:1,accepted:1,declined:1},activities:[],days:[],profiles:[]};
 const store=createFiiuStore({clients:{admin:{async rest(path,options){calls.push({path,...options});return summary;}}}});
 const catalog=[{id:'day1-am',date:'2026-10-21',registration:'general',title:'Ignored display text',formUrl:'https://example.test'}];
 assert.deepEqual(await store.summary('fiiu-2026',catalog),summary);
 assert.deepEqual(calls,[{path:'rpc/fiiu_event_summary',method:'POST',body:{p_event_id:'fiiu-2026',p_activities:[{id:'day1-am',date:'2026-10-21',registration:'general'}]}}]);
 const broken=createFiiuStore({clients:{admin:{async rest(){return null;}}}});
 await assert.rejects(broken.summary('fiiu-2026',catalog),error=>error.status===502);
});

test('Supabase festival counts use one exact-count request and never download rows',async()=>{
 const pg=postgrest(),store=createFiiuStore({clients:pg.clients});
 pg.tables.fiiu_attendance.push(...['day1-am','day1-am','day1-pm'].map((activity_id,i)=>({id:`a${i}`,registration_id:'r'+i,activity_id,confirmed_by:null,created_at:'x',method:'qr'})));
 assert.equal(await store.count('attendance',{activityId:'day1-am'}),2);
 assert.deepEqual(pg.calls.at(-1),{table:'fiiu_attendance',query:{select:'id',limit:1,activity_id:'eq.day1-am'},includeRange:true,headers:{Prefer:'count=exact'}});
 assert.equal(await store.count('attendance',{activityId:'day2-am'}),0);
 await assert.rejects(createFiiuStore({clients:postgrest({count:false}).clients}).count('attendance',{}),error=>error.status===502,'an uncounted answer is not a zero');
 await assert.rejects(store.count('attendance',{nationalId:'x'}),/unknown festival field/);
});

test('Supabase-backed QR check-in writes one qr row for the attendee and reports a racing cancellation',async()=>{
 const secret='fiiu-supabase-checkin-secret-012345',now=()=>Date.parse('2026-10-21T14:00:00Z');
 let cancel=false;
 const pg=postgrest({afterRead:({table,tables})=>{if(cancel&&table==='fiiu_attendance'){cancel=false;tables.fiiu_registrations.length=0;}}});
 const api=createFiiuApi({store:createFiiuStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body)=>Object.assign(res,{status,body}),checkin:{secret,now},publicOrigin:'https://nodal.example'});
 const member={id:'member',email:'member@example.test',permission:'member'},admin={id:'admin',email:'admin@example.test',permission:'admin'};
 const call=async(method,path,body,user=member)=>{
  const res={},req={method,headers:body===undefined?{}:{'content-type':'application/json'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  try{await api({req,res,url:new URL('http://nodal.test'+path),user});}catch(error){Object.assign(res,{status:error.status??500,body:{error:error.message}});}
  return res;
 };
 const code=createCheckinCodes({secret,now}).current('day1-am').code;
 pg.tables.fiiu_registrations.push({...registration(4),user_id:'member',answers:{activities:['day1-am']}});
 const first=await call('POST','/api/fiiu/checkin',{activityId:'day1-am',code});assert.equal(first.status,201);assert.equal(first.body.result,'checked_in');
 assert.deepEqual(pg.tables.fiiu_attendance.map(({registration_id,activity_id,confirmed_by,method,created_at})=>({registration_id,activity_id,confirmed_by,method,created_at})),[{registration_id:uuid(4),activity_id:'day1-am',confirmed_by:'member',method:'qr',created_at:'2026-10-21T14:00:00.000Z'}]);
 const again=await call('POST','/api/fiiu/checkin',{activityId:'day1-am',code});assert.deepEqual([again.status,again.body.result],[200,'already_checked_in']);
 assert.equal(pg.tables.fiiu_attendance.length,1);
 const screen=await call('GET','/api/admin/fiiu/checkin?activityId=day1-am',undefined,admin);
 assert.deepEqual([screen.status,screen.body.checkedIn,screen.body.qr,new URL(screen.body.url).origin],[200,1,null,'https://nodal.example']);
 // A staff confirmation is recorded as such.
 pg.tables.fiiu_registrations[0].answers.activities.push('day2-am');
 assert.equal((await call('PUT',`/api/admin/fiiu/registrations/${uuid(4)}/attendance`,{activityId:'day2-am',attended:true},admin)).status,200);
 assert.equal(pg.tables.fiiu_attendance.find(row=>row.activity_id==='day2-am').method,'staff');
 pg.tables.fiiu_attendance.length=0;cancel=true;
 const raced=await call('POST','/api/fiiu/checkin',{activityId:'day1-am',code});
 assert.deepEqual([raced.status,raced.body.code],[404,'not_registered']);assert.equal(pg.tables.fiiu_attendance.length,0);
});

test('the Supabase summary accepts the check-in figures, tolerates their absence before the migration and rejects malformed ones',async()=>{
 const base={totalRegistrations:2,publicOfficials:1,lab:{pending:0,accepted:0,declined:0},activities:[],days:[],profiles:[]};
 const storeFor=result=>createFiiuStore({clients:{admin:{async rest(){return result;}}}});
 assert.deepEqual(await storeFor(base).summary('fiiu-2026',[]),base);
 const full={...base,attendedPeople:1,qrPeople:1,lastCheckInAt:'2026-10-21T14:00:00.000Z'};assert.deepEqual(await storeFor(full).summary('fiiu-2026',[]),full);
 assert.deepEqual(await storeFor({...full,lastCheckInAt:null}).summary('fiiu-2026',[]),{...full,lastCheckInAt:null});
 for(const broken of [{attendedPeople:'1'},{qrPeople:1.5},{lastCheckInAt:42}])await assert.rejects(storeFor({...base,...broken}).summary('fiiu-2026',[]),error=>error.status===502,JSON.stringify(broken));
});
