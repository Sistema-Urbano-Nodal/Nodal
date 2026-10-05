import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createFiiuApi} from '../server/fiiu-api.js';
import {createCheckinCodes} from '../server/fiiu-checkin.js';

// In-memory PostgREST for the festival tables: eq/gt/gte/lt/in filters, the store's keyset `or`, order, limit, a response
// row cap, exact counts (Content-Range) and constraint errors shaped like server/supabase.js responseError().
function postgrest({cap=Infinity,count=true,afterRead}={}){
 const tables={fiiu_registrations:[],fiiu_attendance:[],fiiu_config:[],fiiu_content:[]},calls=[];
 const byText=(a,b)=>a<b?-1:a>b?1:0;
 const matches=(row,query)=>Object.entries(query).every(([key,expr])=>{
  if(['select','order','limit'].includes(key))return true;
  if(key==='or'){const [,lt,eq,id]=/^\(created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)\)$/.exec(expr);return row.created_at<lt||(row.created_at===eq&&row.id<id);}
  const [op,...rest]=expr.split('.'),value=rest.join('.'),actual=String(key==='data->>kind'?row.data?.kind:row[key]);
  return op==='eq'?actual===value:op==='gt'?actual>value:op==='gte'?row[key]!=null&&actual>=value:op==='lt'?actual<value:op==='in'?value.slice(1,-1).split(',').includes(actual):assert.fail('unsupported filter '+expr);
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

test('Supabase: a first registration over the sending limit stays none for the backfill, without an email, a write or a version bump',async()=>{
 const pg=postgrest(),outbox=[];
 const api=createFiiuApi({store:createFiiuStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body)=>Object.assign(res,{status,body}),
  confirmation:async args=>{outbox.push(args);return {status:'sent'};},emailAllowed:()=>false});
 const member={id:'11111111-1111-4111-8111-111111111111',email:'ana@fiiu-inbox.dev',permission:'member'};
 const res={},body={version:0,firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
 const req={method:'PUT',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
 await api({req,res,url:new URL('http://nodal.test/api/fiiu/registration'),user:member});
 assert.equal(res.status,200);assert.equal(res.body.confirmationEmail,'none');assert.equal(outbox.length,0);
 assert.equal(pg.calls.filter(c=>c.table==='fiiu_registrations'&&c.method==='PATCH').length,0,'nothing to undo');
 assert.deepEqual([pg.tables.fiiu_registrations[0].confirmation_status,pg.tables.fiiu_registrations[0].confirmation_sent_at??null,pg.tables.fiiu_registrations[0].version],['none',null,1]);
});

test('Supabase first registration stores the email as none, claims it and settles it by status alone without touching the version',async()=>{
 const pg=postgrest(),outbox=[];
 const api=createFiiuApi({store:createFiiuStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body)=>Object.assign(res,{status,body}),
  confirmation:async args=>{outbox.push(args);assert.equal(pg.tables.fiiu_registrations[0].confirmation_status,'pending','stored before the send');return {status:'sent',sentAt:'2026-10-02T15:00:00.000Z'};}});
 const member={id:'11111111-1111-4111-8111-111111111111',email:'ana@fiiu-inbox.dev',permission:'member'};
 const call=async(method,path,body,cookie='')=>{
  const res={},req={method,headers:{'content-type':'application/json',cookie},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  try{await api({req,res,url:new URL('http://nodal.test'+path),user:member});}catch(error){Object.assign(res,{status:error.status??500,body:{error:error.message}});}
  return res;
 };
 const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:['route-arcoiris'],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
 const first=await call('PUT','/api/fiiu/registration',{version:0,...answers},'nodal.lang=pt');
 assert.equal(first.status,200);assert.equal(first.body.confirmationEmail,'sent');assert.equal(first.body.registration.version,1);assert.equal(outbox[0].language,'pt');
 const insert=pg.calls.find(c=>c.table==='fiiu_registrations'&&c.method==='POST');
 assert.deepEqual([insert.body.confirmation_status,insert.body.confirmation_language,insert.body.confirmation_sent_at],['none','pt',null],'a lost insert answer leaves a row the button can send');
 const [claim,settle]=pg.calls.filter(c=>c.table==='fiiu_registrations'&&c.method==='PATCH');
 assert.deepEqual(claim.query,{id:`eq.${first.body.registration.id}`,confirmation_status:'eq.none'},'claimed by a compare-and-set on the status, never on the version');
 assert.equal(claim.body.confirmation_status,'pending');assert.match(claim.body.confirmation_sent_at,/^\d{4}-\d\d-\d\dT/,'the send is stamped when it starts, so the daily cap counts it');
 assert.deepEqual(settle.query,{id:`eq.${first.body.registration.id}`,confirmation_status:'eq.pending'},'compare-and-set on the status, never on the version');
 assert.deepEqual(settle.body,{confirmation_status:'sent',confirmation_sent_at:'2026-10-02T15:00:00.000Z'});
 assert.deepEqual([pg.tables.fiiu_registrations[0].confirmation_status,pg.tables.fiiu_registrations[0].version],['sent',1]);
 // Every registration read selects the new columns (so the migration must be applied before this code is deployed).
 const read=pg.calls.find(c=>c.table==='fiiu_registrations'&&!c.method);assert.match(read.query.select,/confirmation_status,confirmation_language,confirmation_sent_at/);
 // An edit sends nothing and leaves the email columns alone.
 const edit=await call('PUT','/api/fiiu/registration',{version:1,registrationId:first.body.registration.id,...answers,activities:['day2-am']});
 assert.equal(edit.status,200);assert.equal(outbox.length,1);assert.equal(edit.body.confirmationEmail,undefined);
 const editPatch=pg.calls.filter(c=>c.table==='fiiu_registrations'&&c.method==='PATCH').at(-1);
 assert.equal(editPatch.query.version,'eq.1');assert.ok(!Object.keys(editPatch.body).some(key=>key.startsWith('confirmation_')));
 assert.equal(pg.tables.fiiu_registrations[0].confirmation_status,'sent');
});

test('Supabase: the organiser summary button counts with exact-count requests, claims by status and walks the list by keyset',async()=>{
 const pg=postgrest({cap:2}),outbox=[],now=Date.parse('2026-10-02T18:00:00.000Z');
 const api=createFiiuApi({store:createFiiuStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body)=>Object.assign(res,{status,body}),backfill:{now:()=>now,dailyCap:6},
  confirmation:async args=>{outbox.push(args);assert.equal(pg.tables.fiiu_registrations.find(r=>r.id===args.registration.id).confirmation_status,'pending','claimed before the send');return {status:'sent',sentAt:'2026-10-02T17:00:00.000Z'};}});
 const call=async(method,body)=>{
  const res={},req={method,headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  try{await api({req,res,url:new URL('http://nodal.test/api/admin/fiiu/confirmations'),user:{id:'admin',email:'admin@example.test',permission:'admin'}});}catch(error){Object.assign(res,{status:error.status??500,body:{error:error.message}});}
  return res;
 };
 const row=(n,status,extra={})=>({...registration(n),email:`p${n}@fiiu-inbox.dev`,confirmation_status:status,confirmation_language:null,confirmation_sent_at:null,...extra});
 pg.tables.fiiu_registrations.push(row(1,'none',{confirmation_language:'pt'}),row(2,'none'),row(3,'sent',{confirmation_sent_at:'2026-10-02T08:00:00+00:00'}),row(4,'none'),row(5,'sent',{confirmation_sent_at:'2026-10-01T22:00:00+00:00'}),row(6,'none'),row(7,'failed'),row(8,'none'),row(9,'none'));
 const state=await call('GET');
 assert.deepEqual(state.body,{configured:true,counts:{none:6,pending:0,sent:2,failed:1,uncertain:0,skipped:0},dailyCap:6,sentToday:1,resetsAt:'2026-10-03T00:00:00.000Z'});
 const counts=pg.calls.filter(c=>c.table==='fiiu_registrations');
 assert.ok(counts.every(c=>c.query.select==='id'&&c.query.limit===1&&c.headers.Prefer==='count=exact'),'counts never download rows');
 assert.ok(counts.some(c=>c.query.confirmation_sent_at==='gte.2026-10-02T00:00:00.000Z'&&c.query.confirmation_status==='in.(sent,uncertain,pending)'),'today’s sends that may have reached the provider are counted in the database');
 pg.calls.length=0;
 const first=await call('POST',{});
 assert.equal(first.status,200);assert.deepEqual([first.body.sent,first.body.next,first.body.remaining],[4,uuid(6),2]);
 assert.deepEqual(outbox.map(m=>[m.registration.id,m.language]),[[uuid(1),'pt'],[uuid(2),'es'],[uuid(4),'es'],[uuid(6),'es']]);
 const patches=pg.calls.filter(c=>c.method==='PATCH');
 assert.deepEqual(patches.filter(c=>c.body.confirmation_status==='pending').map(c=>c.query),[1,2,4,6].map(n=>({id:`eq.${uuid(n)}`,confirmation_status:'eq.none'})),'each claim is a compare-and-set on the status');
 assert.ok(patches.filter(c=>c.body.confirmation_status==='pending').every(c=>c.body.confirmation_sent_at==='2026-10-02T18:00:00.000Z'),'each claim stamps when its send starts');
 assert.deepEqual(patches.find(c=>c.query.id===`eq.${uuid(1)}`&&c.body.confirmation_status==='sent'),{table:'fiiu_registrations',method:'PATCH',query:{id:`eq.${uuid(1)}`,confirmation_status:'eq.pending'},headers:{Prefer:'return=representation'},body:{confirmation_status:'sent',confirmation_sent_at:'2026-10-02T17:00:00.000Z'}});
 assert.ok(pg.calls.some(c=>!c.method&&c.query.id===`gt.${uuid(6)}`&&c.headers?.Prefer==='count=exact'),'what is left is counted after the cursor');
 // Two of today's six remain: the next batch sends one (the cap), then the cap answers 429.
 const second=await call('POST',{after:first.body.next});assert.deepEqual([second.status,second.body.sent,second.body.sentToday],[200,1,6]);
 assert.equal(pg.calls.filter(c=>!c.method&&c.query.id===`gt.${uuid(6)}`&&c.query.confirmation_status==='eq.none'&&c.query.select!=='id').length,1,'the batch reads after the cursor');
 const capped=await call('POST',{after:second.body.next});assert.deepEqual([capped.status,capped.body.code,capped.body.counts.none],[429,'daily_cap',1]);
 assert.equal(outbox.length,5);assert.equal(pg.tables.fiiu_registrations.find(r=>r.id===uuid(7)).confirmation_status,'failed','failed rows wait for a retry');
});
