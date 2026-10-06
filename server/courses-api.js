import { newId, identifier, fail, normalizeCourse, normalizeModule, normalizeIntake, normalizePost, normalizeFeedback, decodeAttachment, attachmentFilename, text, csv, INTAKE_FIELDS, FEEDBACK_ACTIONS, decodeCursor, encodeCursor } from './courses-domain.js';
import {createCourseParticipants} from './course-participants.js';
import {createFinalSurvey, FINAL_SURVEY} from './course-final-survey.js';
import {createHash} from 'node:crypto';

const now = () => new Date().toISOString();
const isStaff = user => user?.permission === 'admin';
// Rows stored before upload names were cleaned may still carry bidi controls or an executable extension.
const attachmentView = ({id,name,mime,size}) => ({id,name:attachmentFilename(name,mime),mime,size});
// UUID columns are canonical, but older JSON references may retain uppercase.
const sameIdentifier = (reference, id) => typeof reference === 'string' && reference.toLowerCase() === id.toLowerCase();
const referencesMaterial = (module, id) => module.resources.some(resource => sameIdentifier(resource.attachmentId, id));
const writeMethods = new Set(['POST','PUT','PATCH','DELETE']);
// Stored feedback per account. The form is one rating per course, session or area, so this is far above real use,
// and it keeps one account from filling the shared database with 2,000-character comments.
export const FEEDBACK_LIMIT = 200;
/* Bytes of course files one member account may download, per server instance: a short window and a day (staff are
   not budgeted; see the download route). Attachments are immutable per id and the browser keeps them, so ordinary
   repeat views cost nothing; the budget only stops one account from turning Supabase Storage egress (5 GB a month
   on Free) into a loop. */
export const DOWNLOAD_LIMITS = [{windowMs:10*60*1000,bytes:64*1024*1024},{windowMs:24*60*60*1000,bytes:512*1024*1024}];
function createByteBudget(windows) {
  const buckets=windows.map(()=>new Map());let sweptAt=0;
  return {
    take(key,amount,at=Date.now()) {
      // Buckets are only ever added; drop the expired ones as we go so rotating accounts cannot grow the maps.
      if(at-sweptAt>60000){sweptAt=at;for(const map of buckets)for(const [k,b] of map)if(at>=b.resetAt)map.delete(k);}
      const current=windows.map(({windowMs},i)=>{const b=buckets[i].get(key);return b&&at<b.resetAt?b:{used:0,resetAt:at+windowMs};});
      // The first file of a window always fits, so a budget smaller than one file can never lock it out for good.
      const wait=Math.max(0,...current.map((b,i)=>b.used>0&&b.used+amount>windows[i].bytes?Math.ceil((b.resetAt-at)/1000):0));
      if(wait)return {ok:false,retryAfter:wait};
      current.forEach((b,i)=>{b.used+=amount;buckets[i].set(key,b);});
      return {ok:true,retryAfter:0};
    },
  };
}
// If-None-Match against one strong ETag; weak and listed forms match too, as RFC 9110 allows for GET.
const matchesEtag = (header, etag) => typeof header === 'string' && header.split(',').some(tag => { const value=tag.trim().replace(/^W\//,''); return value==='*'||value===etag; });
/* Activity events are counted, not replayed: one row per person, session, kind, resource and UTC hour. The id is
   derived from those, so repeated opens within the hour hit the primary key and are answered as already recorded,
   and no client can choose (or exhaust) identifiers. */
function eventId({userId,courseId,moduleId,kind,resourceUrl,createdAt}) {
  const hex=createHash('sha256').update(JSON.stringify(['course-event-v1',userId,courseId,moduleId,kind,resourceUrl,createdAt.slice(0,13)])).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-${(8|parseInt(hex[16],16)&3).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
const errorText = error => error instanceof Error ? error.message : String(error ?? 'unknown error');
function samePost(post, input, courseId, moduleId) {
  return post && post.courseId === courseId && post.moduleId === moduleId &&
    ['kind','body','parentId'].every(key => post[key] === input[key]) &&
    ['links','attachmentIds'].every(key => JSON.stringify(post[key]) === JSON.stringify(input[key]));
}
export async function bodyJson(req, limit = 64 * 1024) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail('JSON request required',415);
  let length=0;const chunks=[];
  for await(const chunk of req) { length+=chunk.length;if(length>limit) fail('request too large',413);chunks.push(chunk); }
  try { const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body || typeof body!=='object' || Array.isArray(body))fail('JSON object required');return body; }
  catch(err) { if(err.status)throw err;fail('invalid JSON'); }
}
function respond(res,status,body,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
}

// finalSurvey and clock exist for tests: the survey's course and deadline are fixed in production.
export function createCourseApi({store,userRepository,sameOrigin,send=respond,rateLimit=()=>true,downloadLimits=DOWNLOAD_LIMITS,log=console.error,finalSurvey=FINAL_SURVEY,clock=Date.now}={}) {
  const participants=createCourseParticipants({store,userRepository});
  const downloads=createByteBudget(downloadLimits);
  const findOne=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
  async function all(name,filters={},max=Infinity) {
    let rows=[],after=null;
    while(rows.length<max) {
      const order=name==='intakes'?['id']:['createdAt','id'];
      const limit=Math.min(500,max-rows.length);
      const page=await store.find(name,filters,{limit,order,...(after?{after}:{})});
      // The store already fills logical pages across smaller provider row caps.
      rows.push(...page);if(page.length<limit)break;after={...(name==='intakes'?{}:{createdAt:page.at(-1).createdAt}),id:page.at(-1).id};
    }
    return rows;
  }
  async function courseAccess(id,user,{content=false}={}) {
    identifier(id);
    // Independent reads share only this request; always validate access before
    // returning either content or the current viewer's private intake.
    const [course,enrollment,intake]=await Promise.all([
      findOne('courses',{id}),findOne('enrollments',{courseId:id,userId:user.id}),findOne('intakes',{courseId:id,userId:user.id}),
    ]);
    if(!course || (!isStaff(user) && course.status!=='published'))fail('course unavailable',404);
    if(content && !isStaff(user) && (!enrollment || !intake))fail('enroll and complete the intake before opening modules',403);
    return {course,enrollment:enrollment?{...enrollment,intakeCompleted:Boolean(intake)}:null,intake:intake?.answers??null};
  }
  async function moduleAccess(courseId,moduleId,user,knownAccess) {
    // Reuse checks already performed in this request; never share membership
    // or intake across requests or viewers.
    const access=knownAccess??await courseAccess(courseId,user,{content:true});
    if(!isStaff(user)&&(!access.enrollment||!access.intake))fail('enroll and complete the intake before opening modules',403);
    const module=await findOne('modules',{id:identifier(moduleId),courseId});
    if(!module || (!isStaff(user)&&module.status!=='published'))fail('module unavailable',404);
    return {...access,module};
  }
  async function validateMaterials(resources,module) {
    // Normalized resources are bounded to twelve; validate every reference before writing.
    await Promise.all(resources.filter(resource=>resource.attachmentId).map(async resource=>{
      if(!await findOne('attachments',{id:resource.attachmentId,courseId:module.courseId,moduleId:module.id,purpose:'material',status:'ready'}))fail('official resource attachment unavailable');
    }));
  }
  async function postView(post,user,knownAttachments) {
    const deleted=Boolean(post.deletedAt)||!post.userId;
    const owned=!deleted&&post.userId===user?.id;
    const attachments=deleted?[]:(await Promise.all((post.attachmentIds??[]).map(id=>knownAttachments?knownAttachments.get(id.toLowerCase()):findOne('attachments',{id,courseId:post.courseId,moduleId:post.moduleId,userId:post.userId,status:'ready'}))))
      .filter(file=>file&&file.courseId===post.courseId&&file.moduleId===post.moduleId&&file.userId===post.userId&&file.status==='ready').map(attachmentView);
    return {id:post.id,courseId:post.courseId,moduleId:post.moduleId,userId:deleted?null:post.userId,authorName:deleted?'':post.authorName,staff:deleted?false:post.staff,parentId:post.parentId,kind:post.kind,body:deleted?'':post.body,links:deleted?[]:post.links,attachments,createdAt:post.createdAt,deleted,canEdit:owned,canDelete:owned};
  }
  async function postPageView(posts,user,module) {
    const ids=[...new Set(posts.filter(post=>!post.deletedAt&&post.userId).flatMap(post=>post.attachmentIds??[]))];
    const files=ids.length?await store.getPostAttachments({ids,courseId:module.courseId,moduleId:module.id}):[];
    const attachments=new Map(files.map(file=>[file.id.toLowerCase(),file]));
    return Promise.all(posts.map(post=>postView(post,user,attachments)));
  }
  /* After a post is withdrawn (by its author or by staff), its author's files go with it, as the delete confirmation
     promises: unless another live post of theirs still shows a file, the file is marked 'deleting', removed from
     Storage and then from the table, which also returns it to the author's upload allowance. A Storage failure leaves
     the row 'deleting' (never downloadable, and erased with the account) for scripts/reconcile-course-uploads.js;
     the withdrawal itself has already succeeded, so it is reported, not undone. */
  async function releasePostFiles(post) {
    const ids=[...new Set((post.attachmentIds??[]).map(id=>id.toLowerCase()))];
    if(!ids.length||!post.userId)return;
    const live=await all('posts',{moduleId:post.moduleId,userId:post.userId,deletedAt:null});
    for(const id of ids) {
      if(live.some(other=>other.id!==post.id&&(other.attachmentIds??[]).some(reference=>sameIdentifier(reference,id))))continue;
      try {
        const attachment=await findOne('attachments',{id,courseId:post.courseId,moduleId:post.moduleId,userId:post.userId,purpose:'post'});
        if(!attachment||attachment.status==='pending')continue;
        if(attachment.status==='ready'&&!await store.update('attachments',{id:attachment.id,status:'ready'},{status:'deleting'}))continue;
        await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'deleting'});
      } catch(error) { log('course attachment cleanup failed:',id,errorText(error)); }
    }
  }
  async function membersForRows(rows) {
    const ids=[...new Set(rows.map(row=>row.userId))],members=new Map();
    for(let offset=0;offset<ids.length;offset+=100)for(const member of await store.getMembers(ids.slice(offset,offset+100)))members.set(member.id,member);
    return members;
  }
  async function feedbackForStaff(rows,members=undefined) {
    members??=await membersForRows(rows);
    return rows.map(row=>({...row,name:members.get(row.userId)?.name??'',email:members.get(row.userId)?.email??''}));
  }
  const feedbackCsv = rows => [['date','userId','name','email','action','courseId','moduleId','rating','comment'],...rows.map(f=>[f.createdAt,f.userId,f.name,f.email,f.action,f.courseId,f.moduleId,f.rating,f.comment])];
  async function report(courseId,exportType=null) {
    const max=exportType?Infinity:500;
    const needsParticipants=!exportType||['participants','intake'].includes(exportType);
    const needsFeedback=!exportType||exportType==='feedback';
    const [enrollments,intakes,events,posts,feedback,counts,invitations]=await Promise.all([
      needsParticipants?all('enrollments',{courseId},max):[],needsParticipants?all('intakes',{courseId}):[],exportType==='activity'?all('events',{courseId}):[],exportType==='activity'?all('posts',{courseId}):[],needsFeedback?all('feedback',{courseId},max):[],
      exportType?[]:Promise.all([store.count('enrollments',{courseId}),store.count('intakes',{courseId}),...['module_open','content_open','recording_open'].map(kind=>store.count('events',{courseId,kind})),...['assignment','comment'].map(kind=>store.count('posts',{courseId,kind,deletedAt:null})),store.count('feedback',{courseId})]),
      exportType?[]:all('invitations',{courseId,acceptedAt:null},500),
    ]);
    const answers=new Map(intakes.map(row=>[row.userId,row.answers]));
    const members=await membersForRows([...enrollments,...feedback]);
    const participants=enrollments.map(enrollment=>{
      const user=members.get(enrollment.userId);
      return {userId:enrollment.userId,name:user?.name??'',email:user?.email??'',enrolledAt:enrollment.createdAt,intake:answers.get(enrollment.userId)??null};
    });
    const livePosts=posts.filter(post=>!post.deletedAt&&post.userId);
    return {
      summary:Object.fromEntries(['enrolled','intakeCompleted','moduleOpens','contentOpens','recordingOpens','assignments','comments'].map((key,i)=>[key,counts[i]])),
      participants,feedback:await feedbackForStaff(feedback,members),events,posts:livePosts,invitations,
      truncated:!exportType&&(counts[0]>500||counts[7]>500),
    };
  }
  function sendCsv(res,name,rows) { send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`}); }
  const survey=createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config:finalSurvey,clock,log});

  return async function handle({req,res,url,user}) {
    const path=url.pathname;
    if(!/^\/api\/(?:courses(?:\/|$)|admin\/courses(?:\/|$)|course-attachments\/|feedback(?:\/|$)|admin\/feedback(?:\/|$))/.test(path))return false;
    if(!user){send(res,401,{error:'sign in required'});return true;}
    const adminPath=path.startsWith('/api/admin/');
    if(adminPath&&!isStaff(user)){send(res,403,{error:'administrator access required'});return true;}
    if(writeMethods.has(req.method)&&!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
    if(!rateLimit(req,res,user,path))return true;

    if(path==='/api/feedback'&&req.method==='POST') {
      const input=normalizeFeedback(await bodyJson(req));
      if(input.moduleId&&!input.courseId)fail('course is required for module feedback');
      const feedbackAccess=input.courseId?await courseAccess(input.courseId,user,{content:true}):null;
      if(input.moduleId) await moduleAccess(input.courseId,input.moduleId,user,feedbackAccess);
      if(await store.count('feedback',{userId:user.id})>=FEEDBACK_LIMIT){send(res,409,{error:'feedback limit reached; edit or delete earlier feedback',code:'feedback_limit'});return true;}
      const feedback=await store.insert('feedback',{id:newId(),userId:user.id,...input,createdAt:now()});
      send(res,201,{feedback});return true;
    }
    if(path==='/api/feedback'&&req.method==='GET') {
      const action=url.searchParams.get('action'),filters={userId:user.id};
      if(action!==null) {
        if(!FEEDBACK_ACTIONS.includes(action))fail('invalid feedback action');
        Object.assign(filters,{action,courseId:url.searchParams.has('courseId')?identifier(url.searchParams.get('courseId')):null,moduleId:url.searchParams.has('moduleId')?identifier(url.searchParams.get('moduleId')):null});
        if(filters.moduleId&&!filters.courseId)fail('course is required for module feedback');
      } else if(url.searchParams.has('courseId')||url.searchParams.has('moduleId'))fail('action is required for context filtering');
      const rows=await store.find('feedback',filters,{limit:21,desc:true,after:decodeCursor(url.searchParams.get('cursor'))}),page=rows.slice(0,20);
      send(res,200,{feedback:page,nextCursor:rows.length>20?encodeCursor(page.at(-1)):null});return true;
    }
    const ownFeedback=path.match(/^\/api\/feedback\/([^/]+)$/);
    if(ownFeedback&&['PATCH','DELETE'].includes(req.method)) {
      const filters={id:identifier(ownFeedback[1]),userId:user.id};
      const existing=await findOne('feedback',filters);if(!existing)fail('feedback unavailable',404);
      if(req.method==='DELETE') {await store.remove('feedback',filters);send(res,200,{ok:true});return true;}
      const input=normalizeFeedback({...await bodyJson(req),action:existing.action,courseId:existing.courseId,moduleId:existing.moduleId});
      const feedback=await store.update('feedback',filters,{rating:input.rating,comment:input.comment});
      if(!feedback)fail('feedback unavailable',404);
      send(res,200,{feedback});return true;
    }
    if(path.startsWith('/api/admin/feedback')&&req.method==='GET') {
      const exporting=path==='/api/admin/feedback/export';
      const feedback=await feedbackForStaff(await all('feedback',{},exporting?Infinity:500));
      if(path==='/api/admin/feedback/export')sendCsv(res,'nodal-feedback',feedbackCsv(feedback));
      else if(path==='/api/admin/feedback')send(res,200,{feedback,truncated:(await store.count('feedback'))>500});
      else send(res,404,{error:'not found'});
      return true;
    }
    const root=adminPath?'/api/admin/courses':'/api/courses';
    if(path===root) {
      if(req.method==='GET') { send(res,200,{courses:await store.find('courses',adminPath?{}:{status:'published'},{limit:100}),isAdmin:isStaff(user)});return true; }
      if(adminPath&&req.method==='POST') {
        const course=await store.insert('courses',{id:newId(),...normalizeCourse(await bodyJson(req)),version:1,createdAt:now(),updatedAt:now()});
        send(res,201,{course});return true;
      }
    }
    let match=path.match(/^\/api\/course-attachments\/([^/]+)$/);
    if(match&&req.method==='GET') {
      const attachment=await findOne('attachments',{id:identifier(match[1])});
      if(!attachment||attachment.status!=='ready')fail('file unavailable',404);
      const {module}=await moduleAccess(attachment.courseId,attachment.moduleId,user);
      if(attachment.purpose==='material'&&!isStaff(user)&&!referencesMaterial(module,attachment.id))fail('file unavailable',404);
      if(attachment.purpose!=='material'&&!isStaff(user)&&attachment.userId!==user.id) {
        const posts=await all('posts',{moduleId:attachment.moduleId,userId:attachment.userId,deletedAt:null});
        if(!posts.some(post=>!post.deletedAt&&post.attachmentIds.some(id=>sameIdentifier(id,attachment.id))))fail('file unavailable',404);
      }
      // An id never names other bytes, so after the access checks above the browser may keep the file privately and
      // revalidate with its id: a 304 then costs no Storage read.
      const etag=`"${attachment.id.toLowerCase()}"`,caching={'Cache-Control':'private, max-age=86400, immutable',ETag:etag,Vary:'Cookie'};
      if(matchesEtag(req.headers['if-none-match'],etag)){send(res,304,'',caching);return true;}
      // The teaching team opens every participant's files, often in one sitting (a class's assignments easily pass
      // 64 MB in ten minutes), so staff accounts are not budgeted.
      const budget=isStaff(user)?{ok:true}:downloads.take(`download:${user.id}`,attachment.size);
      if(!budget.ok){send(res,429,{error:'download limit reached; try again later',code:'download_rate'},{'Retry-After':String(budget.retryAfter)});return true;}
      const bytes=await store.getFile(attachment);
      const filename=attachmentFilename(attachment.name,attachment.mime);
      send(res,200,bytes,{...caching,'Content-Type':attachment.mime,'Content-Disposition':`attachment; filename="${filename.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Length':String(bytes.length)});
      return true;
    }
    match=path.match(/^\/api\/(admin\/)?courses\/([^/]+)(.*)$/);
    if(!match){send(res,404,{error:'not found'});return true;}
    const courseId=identifier(match[2]),suffix=match[3];
    /* A person's own contribution: reading it back and withdrawing it are authorised by authorship alone, so they
       still work after the person deletes their intake, after staff unpublish the session or archive the course
       (the privacy policy lets members delete their contributions). Editing keeps the full content checks below. */
    const ownPost=!adminPath&&['GET','DELETE'].includes(req.method)?suffix.match(/^\/posts\/([^/]+)$/):null;
    if(ownPost) {
      const filters={id:identifier(ownPost[1]),courseId,userId:user.id};
      const post=await findOne('posts',filters);if(!post||(req.method==='DELETE'&&post.deletedAt))fail('post unavailable',404);
      if(req.method==='GET'){send(res,200,{post:await postView(post,user)});return true;}
      if(!await store.update('posts',{...filters,deletedAt:null},{body:'',links:[],attachmentIds:[],deletedAt:now()}))fail('post changed; reload before saving',409);
      await releasePostFiles(post);
      send(res,200,{ok:true});return true;
    }
    const access=await courseAccess(courseId,user);
    if(adminPath&&['/participants','/invitations'].includes(suffix)&&req.method==='POST') {
      const input=await bodyJson(req);
      try {
        const result=suffix==='/participants'?await participants.add(access.course,input.email):await participants.invite(access.course,input.email,user.id);
        send(res,result.result==='invited'?202:result.result==='enrolled'?201:200,result);
      } catch(error) {
        const expected=/^(participant|invitation)_[a-z_]+$/.test(error.code??''),code=expected?error.code:'participant_unavailable',status=error.status??503;
        // This answer replaces the global error handler, so log here what it would have: unexpected errors and every
        // provider or server failure (an uncertain invitation, a broken account lookup), never the address.
        // A provider message can quote the address it refused, so anything shaped like one is masked.
        const masked=value=>errorText(value).replace(/[^\s@"'<>]+@[^\s@"'<>]+/g,'<address>');
        if(!expected||status>=500)log('course participant request failed:',code,status,masked(error),...(error.cause?[masked(error.cause),error.cause.status??'',error.cause.code??'']:[]));
        send(res,status,{error:code,code},status===429?{'Retry-After':'60'}:{});
      }
      return true;
    }
    // The final survey and certificates of one course (server/course-final-survey.js); false for anything else.
    if(await survey.handle({req,res,url,user,access,courseId,suffix,adminPath}))return true;
    if(!suffix&&req.method==='GET') {
      let [modules,finalSurvey]=await Promise.all([store.find('modules',{courseId,...(isStaff(user)?{}:{status:'published'})},{limit:101,order:['position','sessionDate','id']}),survey.snapshot({courseId,user,access})]);
      if(!isStaff(user)&&(!access.enrollment||!access.intake)) modules=modules.map(({id,kind,title,position,sessionDate,status,translations={}})=>({
        id,kind,title,position,sessionDate,status,
        // Preview only localized titles; gated teaching content stays private.
        translations:Object.fromEntries(Object.entries(translations).map(([locale,fields])=>[locale,typeof fields.title==='string'?{title:fields.title}:{}])),
      }));
      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{})});return true;
    }
    if(adminPath&&!suffix&&req.method==='PATCH') {
      const input=await bodyJson(req);
      if(!Number.isInteger(input.version)||input.version<1)fail('version is required');
      const updated=await store.update('courses',{id:courseId,version:input.version},{...normalizeCourse(input,access.course),version:input.version+1,updatedAt:now()});
      if(!updated)fail('course changed; reload before saving',409);
      send(res,200,{course:updated});return true;
    }
    if(!adminPath&&suffix==='/enroll'&&req.method==='POST') {
      if(access.enrollment){send(res,200,{enrollment:access.enrollment});return true;}
      if(!access.course.enrollmentOpen){send(res,403,{error:'enrollment is closed',code:'enrollment_closed'});return true;}
      let enrollment;
      try { enrollment=await store.insert('enrollments',{id:newId(),courseId,userId:user.id,createdAt:now()}); }
      catch(err) { if(err.status!==409)throw err;enrollment=await findOne('enrollments',{courseId,userId:user.id});if(!enrollment)throw err; }
      send(res,200,{enrollment:{...enrollment,intakeCompleted:Boolean(access.intake)}});return true;
    }
    if(!adminPath&&suffix==='/intake'&&req.method==='PUT') {
      if(!access.enrollment)fail('enroll before completing the intake',403);
      const answers=normalizeIntake(await bodyJson(req));
      const existing=await findOne('intakes',{courseId,userId:user.id});
      if(existing) {
        if(!await store.update('intakes',{id:existing.id,courseId,userId:user.id},{answers,updatedAt:now()}))fail('intake changed; reload before saving',409);
      }
      else {
        try { await store.insert('intakes',{id:newId(),courseId,userId:user.id,answers,updatedAt:now()}); }
        catch(err) { if(err.status!==409)throw err;if(!await store.update('intakes',{courseId,userId:user.id},{answers,updatedAt:now()}))fail('intake changed; reload before saving',409); }
      }
      send(res,200,{intake:answers,enrollment:{...access.enrollment,intakeCompleted:true}});return true;
    }
    if(!adminPath&&suffix==='/intake'&&req.method==='DELETE') {
      await store.remove('intakes',{courseId,userId:user.id});send(res,200,{ok:true});return true;
    }
    if(adminPath&&suffix==='/modules'&&req.method==='POST') {
      const count=await store.find('modules',{courseId,kind:'session'},{limit:100});if(count.length>=100)fail('course module limit reached');
      const input=normalizeModule(await bodyJson(req));if(input.kind!=='session')fail('general discussion is created automatically');
      const record={id:newId(),courseId,...input,version:1,createdAt:now(),updatedAt:now()};await validateMaterials(input.resources,record);
      const module=await store.insert('modules',record);
      send(res,201,{module});return true;
    }
    if(adminPath&&['/report','/export'].includes(suffix)&&req.method==='GET') {
      const type=url.searchParams.get('type')||'participants';
      if(suffix==='/export'&&!['participants','intake','feedback','activity'].includes(type))fail('invalid export type');
      const result=await report(courseId,suffix==='/export'?type:null);
      if(suffix==='/report') { const {events,posts,...view}=result;send(res,200,view);return true; }
      if(type==='intake')sendCsv(res,'course-intake',[['userId','name','email',...INTAKE_FIELDS],...result.participants.map(p=>[p.userId,p.name,p.email,...INTAKE_FIELDS.map(k=>p.intake?.[k]??'')])]);
      else if(type==='participants')sendCsv(res,'course-participants',[['userId','name','email','enrolledAt','intakeCompleted'],...result.participants.map(p=>[p.userId,p.name,p.email,p.enrolledAt,Boolean(p.intake)])]);
      else if(type==='feedback')sendCsv(res,'course-feedback',feedbackCsv(result.feedback));
      else if(type==='activity')sendCsv(res,'course-activity',[['date','userId','moduleId','action','resourceUrl'],...result.events.map(e=>[e.createdAt,e.userId,e.moduleId,e.kind,e.resourceUrl]),...result.posts.map(p=>[p.createdAt,p.userId,p.moduleId,p.kind,''])]);
      else fail('invalid export type');return true;
    }
    const moderation=suffix.match(/^\/posts\/([^/]+)$/);
    if(!adminPath&&moderation&&req.method==='PATCH') {
      const post=await findOne('posts',{id:identifier(moderation[1]),courseId,userId:user.id});if(!post||post.deletedAt)fail('post unavailable',404);
      await moduleAccess(courseId,post.moduleId,user,access);
      const input=await bodyJson(req);
      if(typeof input.expectedBody!=='string'||input.expectedBody.length>6000)fail('expected post text is required');
      const updated=await store.editPost({id:post.id,courseId,userId:user.id,expectedBody:input.expectedBody,body:text(input.body,'post',6000,true)});
      if(!updated)fail('post changed; reload before saving',409);
      send(res,200,{post:await postView(updated,user)});return true;
    }
    if(adminPath&&moderation&&req.method==='DELETE') {
      const post=await findOne('posts',{id:identifier(moderation[1]),courseId});if(!post)fail('post unavailable',404);
      await store.update('posts',{id:post.id},{body:'',links:[],attachmentIds:[],deletedAt:now()});
      await releasePostFiles(post);
      send(res,200,{ok:true});return true;
    }
    if(!adminPath&&suffix==='/events'&&req.method==='POST') {
      // Older pages still send a random id; it is checked but no longer used (see eventId).
      const input=await bodyJson(req);if(input.id!==undefined)identifier(input.id);
      const {module}=await moduleAccess(courseId,identifier(input.moduleId),user,access);
      if(!['module_open','content_open','recording_open'].includes(input.kind))fail('invalid activity type');
      const resourceUrl=input.kind==='module_open'?'':text(input.resourceUrl,'resource URL',2000,true);
      if(input.kind!=='module_open'&&!module.resources.some(r=>(r.url||(r.attachmentId?`/api/course-attachments/${r.attachmentId}`:''))===resourceUrl&&(input.kind==='recording_open'?r.kind==='recording':r.kind!=='recording')))fail('resource is not in this module');
      const createdAt=now(),fields={courseId,moduleId:module.id,userId:user.id,kind:input.kind,resourceUrl},id=eventId({...fields,createdAt});
      const event={id,...fields,createdAt};
      try { await store.insert('events',event); }
      catch(err) { if(err.status!==409)throw err;const old=await findOne('events',{id,userId:user.id,courseId,moduleId:module.id,kind:input.kind,resourceUrl});if(!old)fail('event identifier is already used',409); }
      send(res,200,{ok:true});return true;
    }
    const moduleMatch=suffix.match(/^\/modules\/([^/]+)(\/posts|\/attachments(?:\/[^/]+)?)?$/);
    if(moduleMatch) {
      const {module}=await moduleAccess(courseId,identifier(moduleMatch[1]),user,access);
      const operation=moduleMatch[2]||'';
      if(!operation&&req.method==='GET'){send(res,200,{module});return true;}
      if(adminPath&&!operation&&req.method==='PATCH') {
        const input=await bodyJson(req);if(!Number.isInteger(input.version)||input.version<1)fail('version is required');
        const normalized=normalizeModule(input,module);await validateMaterials(normalized.resources,module);
        const updated=await store.update('modules',{id:module.id,courseId,version:input.version},{...normalized,version:input.version+1,updatedAt:now()});
        if(!updated)fail('module changed; reload before saving',409);
        send(res,200,{module:updated});return true;
      }
      if(adminPath&&operation==='/attachments'&&req.method==='GET') {
        const rows=await store.find('attachments',{courseId,moduleId:module.id,purpose:'material'},{limit:100});
        send(res,200,{attachments:rows.map(a=>({...attachmentView(a),status:a.status,referenced:referencesMaterial(module,a.id)}))});return true;
      }
      if(adminPath&&operation.startsWith('/attachments/')&&req.method==='DELETE') {
        const attachment=await findOne('attachments',{id:identifier(operation.split('/')[2]),courseId,moduleId:module.id,purpose:'material'});
        if(!attachment)fail('file unavailable',404);
        if(attachment.status==='pending')fail('pending uploads must be reconciled before deletion',409);
        if(referencesMaterial(module,attachment.id))fail('remove the material from module resources before deleting',409);
        if(attachment.status!=='deleting')await store.update('attachments',{id:attachment.id,status:'ready'},{status:'deleting'});
        await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'deleting'});
        send(res,200,{ok:true});return true;
      }
      if(operation==='/attachments'&&req.method==='POST') {
        const input=decodeAttachment(await bodyJson(req,4*1024*1024+4096));
        const id=newId();const attachment={id,courseId,moduleId:module.id,userId:adminPath?null:user.id,purpose:adminPath?'material':'post',name:input.name,mime:input.mime,size:input.size,storagePath:adminPath?`courses/${courseId}/${module.id}/${id}`:`${user.id}/${id}`,status:'pending',createdAt:now()};
        await store.reserveAttachment(attachment);
        // A failed response does not prove Storage rejected the object. Keep the
        // pending record for reconciliation, including when a worker terminates.
        await store.putFile(attachment,input.bytes);
        await store.update('attachments',{id,status:'pending'},{status:'ready'});
        send(res,201,{attachment:attachmentView(attachment)});return true;
      }
      if(!adminPath&&operation==='/posts'&&req.method==='GET') {
        const kind=url.searchParams.get('kind');if(kind&&!['assignment','discussion'].includes(kind))fail('invalid post filter');
        // The open conversation polls latest=1 every 30 seconds only to learn whether anything changed: the module's
        // post revision answers that without reading posts or their files.
        if(url.searchParams.get('latest')==='1'){send(res,200,{revision:module.postsRevision});return true;}
        const desc=url.searchParams.get('order')==='desc';
        // Keep tombstones for reply integrity and owner conflict recovery, but
        // exclude them before pagination so history pages contain live posts.
        const filters={courseId,moduleId:module.id,deletedAt:null,...(kind?{threadKind:kind}:{})};
        const rows=await store.find('posts',filters,{limit:31,desc,after:decodeCursor(url.searchParams.get('cursor'))});
        const page=rows.slice(0,30);
        send(res,200,{posts:await postPageView(page,user,module),nextCursor:rows.length>30?encodeCursor(page.at(-1)):null,revision:module.postsRevision});return true;
      }
      if(!adminPath&&operation==='/posts'&&req.method==='POST') {
        const input=normalizePost(await bodyJson(req));
        if(module.kind==='discussion'&&input.kind==='assignment')fail('assignments belong to a session');
        let threadKind=input.kind==='assignment'?'assignment':'discussion';
        const old=await findOne('posts',{userId:user.id,clientId:input.clientId});
        if(old) {
          if(!samePost(old,input,courseId,module.id))fail('post identifier is already used',409);
          send(res,200,{post:await postView(old,user)});return true;
        }
        if(input.parentId) {
          const parent=await findOne('posts',{id:input.parentId,courseId,moduleId:module.id});if(!parent||parent.deletedAt)fail('parent post unavailable');threadKind=parent.threadKind;
        }
        for(const id of input.attachmentIds) if(!await findOne('attachments',{id,userId:user.id,courseId,moduleId:module.id,purpose:'post',status:'ready'}))fail('attachment is unavailable or belongs to another member');
        const record={id:newId(),courseId,moduleId:module.id,userId:user.id,authorName:user.fullName,staff:isStaff(user),...input,threadKind,deletedAt:null,createdAt:now()};
        let post;
        try {post=await store.insert('posts',record);}catch(err){if(err.status!==409)throw err;post=await findOne('posts',{userId:user.id,clientId:input.clientId});if(!samePost(post,input,courseId,module.id))throw err;}
        send(res,201,{post:await postView(post,user)});return true;
      }
    }
    send(res,404,{error:'not found'});return true;
  };
}
