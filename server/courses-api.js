import { newId, identifier, fail, normalizeCourse, normalizeModule, normalizeIntake, normalizePost, normalizeFeedback, decodeAttachment, text, csv, INTAKE_FIELDS, FEEDBACK_ACTIONS, decodeCursor, encodeCursor } from './courses-domain.js';
import {createCourseParticipants} from './course-participants.js';

const now = () => new Date().toISOString();
const isStaff = user => user?.permission === 'admin';
const attachmentView = ({id,name,mime,size}) => ({id,name,mime,size});
const writeMethods = new Set(['POST','PUT','PATCH','DELETE']);
function samePost(post, input, courseId, moduleId) {
  return post && post.courseId === courseId && post.moduleId === moduleId &&
    ['kind','body','parentId'].every(key => post[key] === input[key]) &&
    ['links','attachmentIds'].every(key => JSON.stringify(post[key]) === JSON.stringify(input[key]));
}
async function bodyJson(req, limit = 64 * 1024) {
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

export function createCourseApi({store,userRepository,sameOrigin,send=respond,rateLimit=()=>true}={}) {
  const participants=createCourseParticipants({store,userRepository});
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
      if(attachment.purpose==='material'&&!isStaff(user)&&!module.resources.some(r=>r.attachmentId===attachment.id))fail('file unavailable',404);
      if(attachment.purpose!=='material'&&!isStaff(user)&&attachment.userId!==user.id) {
        const posts=await all('posts',{moduleId:attachment.moduleId,userId:attachment.userId});
        if(!posts.some(post=>!post.deletedAt&&post.attachmentIds.includes(attachment.id)))fail('file unavailable',404);
      }
      const bytes=await store.getFile(attachment);
      send(res,200,bytes,{'Content-Type':attachment.mime,'Content-Disposition':`attachment; filename="${attachment.name.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Length':String(bytes.length)});
      return true;
    }
    match=path.match(/^\/api\/(admin\/)?courses\/([^/]+)(.*)$/);
    if(!match){send(res,404,{error:'not found'});return true;}
    const courseId=identifier(match[2]),suffix=match[3];
    const access=await courseAccess(courseId,user);
    if(adminPath&&['/participants','/invitations'].includes(suffix)&&req.method==='POST') {
      const input=await bodyJson(req);
      try {
        const result=suffix==='/participants'?await participants.add(access.course,input.email):await participants.invite(access.course,input.email,user.id);
        send(res,result.result==='invited'?202:result.result==='enrolled'?201:200,result);
      } catch(error) {
        const code=/^(participant|invitation)_[a-z_]+$/.test(error.code??'')?error.code:'participant_unavailable';
        send(res,error.status??503,{error:code,code},error.status===429?{'Retry-After':'60'}:{});
      }
      return true;
    }
    if(!suffix&&req.method==='GET') {
      let modules=await store.find('modules',{courseId,...(isStaff(user)?{}:{status:'published'})},{limit:101,order:['position','sessionDate','id']});
      if(!isStaff(user)&&(!access.enrollment||!access.intake)) modules=modules.map(({id,kind,title,position,sessionDate,status,translations={}})=>({
        id,kind,title,position,sessionDate,status,
        // Preview only localized titles; gated teaching content stays private.
        translations:Object.fromEntries(Object.entries(translations).map(([locale,fields])=>[locale,typeof fields.title==='string'?{title:fields.title}:{}])),
      }));
      send(res,200,{...access,modules,isAdmin:isStaff(user)});return true;
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
      if(!access.course.enrollmentOpen)fail('enrollment is closed',403);
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
    if(!adminPath&&moderation&&['GET','PATCH','DELETE'].includes(req.method)) {
      const filters={id:identifier(moderation[1]),courseId,userId:user.id};
      const post=await findOne('posts',filters);if(!post||(req.method!=='GET'&&post.deletedAt))fail('post unavailable',404);
      await moduleAccess(courseId,post.moduleId,user,access);
      if(req.method==='GET'){send(res,200,{post:await postView(post,user)});return true;}
      let patch;
      if(req.method==='PATCH') {
        const input=await bodyJson(req);
        if(typeof input.expectedBody!=='string'||input.expectedBody.length>6000)fail('expected post text is required');
        filters.body=input.expectedBody;patch={body:text(input.body,'post',6000,true)};
      } else patch={body:'',links:[],attachmentIds:[],deletedAt:now()};
      const updated=req.method==='PATCH'
        ?await store.editPost({id:post.id,courseId,userId:user.id,expectedBody:filters.body,body:patch.body})
        :await store.update('posts',{...filters,deletedAt:null},patch);
      if(!updated)fail('post changed; reload before saving',409);
      send(res,200,req.method==='DELETE'?{ok:true}:{post:await postView(updated,user)});return true;
    }
    if(adminPath&&moderation&&req.method==='DELETE') {
      const post=await findOne('posts',{id:identifier(moderation[1]),courseId});if(!post)fail('post unavailable',404);
      await store.update('posts',{id:post.id},{body:'',links:[],attachmentIds:[],deletedAt:now()});send(res,200,{ok:true});return true;
    }
    if(!adminPath&&suffix==='/events'&&req.method==='POST') {
      const input=await bodyJson(req);const id=identifier(input.id);
      const {module}=await moduleAccess(courseId,identifier(input.moduleId),user,access);
      if(!['module_open','content_open','recording_open'].includes(input.kind))fail('invalid activity type');
      const resourceUrl=input.kind==='module_open'?'':text(input.resourceUrl,'resource URL',2000,true);
      if(input.kind!=='module_open'&&!module.resources.some(r=>(r.url||(r.attachmentId?`/api/course-attachments/${r.attachmentId}`:''))===resourceUrl&&(input.kind==='recording_open'?r.kind==='recording':r.kind!=='recording')))fail('resource is not in this module');
      const event={id,courseId,moduleId:module.id,userId:user.id,kind:input.kind,resourceUrl,createdAt:now()};
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
        send(res,200,{attachments:rows.map(a=>({...attachmentView(a),status:a.status,referenced:module.resources.some(r=>r.attachmentId===a.id)}))});return true;
      }
      if(adminPath&&operation.startsWith('/attachments/')&&req.method==='DELETE') {
        const attachment=await findOne('attachments',{id:identifier(operation.split('/')[2]),courseId,moduleId:module.id,purpose:'material'});
        if(!attachment)fail('file unavailable',404);
        if(attachment.status==='pending')fail('pending uploads must be reconciled before deletion',409);
        if(module.resources.some(r=>r.attachmentId===attachment.id))fail('remove the material from module resources before deleting',409);
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
        const latest=url.searchParams.get('latest')==='1',desc=latest||url.searchParams.get('order')==='desc';
        const filters={courseId,moduleId:module.id,...(kind?{threadKind:kind}:{})};
        const rows=await store.find('posts',filters,{limit:latest?1:31,desc,after:latest?null:decodeCursor(url.searchParams.get('cursor'))});
        const page=rows.slice(0,latest?1:30);
        send(res,200,{posts:await postPageView(page,user,module),nextCursor:!latest&&rows.length>30?encodeCursor(page.at(-1)):null,revision:module.postsRevision});return true;
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
