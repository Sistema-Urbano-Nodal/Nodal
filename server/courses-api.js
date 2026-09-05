import { newId, identifier, fail, normalizeCourse, normalizeModule, normalizeIntake, normalizePost, normalizeFeedback, decodeAttachment, text, csv, INTAKE_FIELDS, decodeCursor, encodeCursor } from './courses-domain.js';

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
  const findOne=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
  async function all(name,filters={},max=Infinity) {
    let rows=[],after=null;
    while(rows.length<max) {
      const order=name==='intakes'?['id']:['createdAt','id'];
      const page=await store.find(name,filters,{limit:Math.min(500,max-rows.length),order,...(after?{after}:{})});
      rows.push(...page);if(!page.length)break;after={...(name==='intakes'?{}:{createdAt:page.at(-1).createdAt}),id:page.at(-1).id};
    }
    return rows;
  }
  async function courseAccess(id,user,{content=false}={}) {
    const course=await findOne('courses',{id:identifier(id)});
    if(!course || (!isStaff(user) && course.status!=='published'))fail('course unavailable',404);
    const [enrollment,intake]=await Promise.all([findOne('enrollments',{courseId:id,userId:user.id}),findOne('intakes',{courseId:id,userId:user.id})]);
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
  async function postView(post) {
    const deleted=Boolean(post.deletedAt)||!post.userId;
    const attachments=deleted?[]:(await Promise.all((post.attachmentIds??[]).map(id=>findOne('attachments',{id,moduleId:post.moduleId,userId:post.userId,status:'ready'})))).filter(Boolean).map(attachmentView);
    return {id:post.id,courseId:post.courseId,moduleId:post.moduleId,userId:deleted?null:post.userId,authorName:deleted?'':post.authorName,staff:deleted?false:post.staff,parentId:post.parentId,kind:post.kind,body:deleted?'':post.body,links:deleted?[]:post.links,attachments,createdAt:post.createdAt,deleted};
  }
  async function feedbackForStaff(rows) {
    const ids=[...new Set(rows.map(row=>row.userId))],members=new Map();
    for(let offset=0;offset<ids.length;offset+=100)for(const member of await store.getMembers(ids.slice(offset,offset+100)))members.set(member.id,member);
    return rows.map(row=>({...row,name:members.get(row.userId)?.name??'',email:members.get(row.userId)?.email??''}));
  }
  const feedbackCsv = rows => [['date','userId','name','email','action','courseId','moduleId','rating','comment'],...rows.map(f=>[f.createdAt,f.userId,f.name,f.email,f.action,f.courseId,f.moduleId,f.rating,f.comment])];
  async function report(courseId,exportType=null) {
    const max=exportType?Infinity:500;
    const [enrollments,intakes,events,posts,feedback,counts]=await Promise.all([
      all('enrollments',{courseId},max),all('intakes',{courseId}),exportType==='activity'?all('events',{courseId}):[],exportType==='activity'?all('posts',{courseId}):[],all('feedback',{courseId},max),
      Promise.all([store.count('enrollments',{courseId}),store.count('intakes',{courseId}),...['module_open','content_open','recording_open'].map(kind=>store.count('events',{courseId,kind})),...['assignment','comment'].map(kind=>store.count('posts',{courseId,kind,deletedAt:null})),store.count('feedback',{courseId})]),
    ]);
    const answers=new Map(intakes.map(row=>[row.userId,row.answers]));
    const members=new Map();
    for(let offset=0;offset<enrollments.length;offset+=100)for(const member of await store.getMembers(enrollments.slice(offset,offset+100).map(e=>e.userId)))members.set(member.id,member);
    const participants=enrollments.map(enrollment=>{
      const user=members.get(enrollment.userId);
      return {userId:enrollment.userId,name:user?.name??'',email:user?.email??'',enrolledAt:enrollment.createdAt,intake:answers.get(enrollment.userId)??null};
    });
    const livePosts=posts.filter(post=>!post.deletedAt&&post.userId);
    return {
      summary:Object.fromEntries(['enrolled','intakeCompleted','moduleOpens','contentOpens','recordingOpens','assignments','comments'].map((key,i)=>[key,counts[i]])),
      participants,feedback:await feedbackForStaff(feedback),events,posts:livePosts,
      truncated:!exportType&&(counts[0]>500||counts[7]>500),
    };
  }
  function sendCsv(res,name,rows) { send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`}); }

  return async function handle({req,res,url,user}) {
    const path=url.pathname;
    if(!/^\/api\/(?:courses(?:\/|$)|admin\/courses(?:\/|$)|course-attachments\/|feedback$|admin\/feedback(?:\/|$))/.test(path))return false;
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
      if(req.method==='GET') { send(res,200,{courses:await store.find('courses',adminPath?{}:{status:'published'},{limit:100})});return true; }
      if(adminPath&&req.method==='POST') {
        const course=await store.insert('courses',{id:newId(),...normalizeCourse(await bodyJson(req)),version:1,createdAt:now(),updatedAt:now()});
        send(res,201,{course});return true;
      }
    }
    let match=path.match(/^\/api\/course-attachments\/([^/]+)$/);
    if(match&&req.method==='GET') {
      const attachment=await findOne('attachments',{id:identifier(match[1])});
      if(!attachment||attachment.status!=='ready')fail('file unavailable',404);
      await moduleAccess(attachment.courseId,attachment.moduleId,user);
      if(!isStaff(user)&&attachment.userId!==user.id) {
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
    if(!suffix&&req.method==='GET') {
      let modules=await store.find('modules',{courseId,...(isStaff(user)?{}:{status:'published'})},{limit:100,order:['position','id']});
      if(!isStaff(user)&&(!access.enrollment||!access.intake)) modules=modules.map(({id,title,position,sessionDate,status,translations={}})=>({
        id,title,position,sessionDate,status,
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
      if(existing)await store.update('intakes',{id:existing.id},{answers,updatedAt:now()});
      else {
        try { await store.insert('intakes',{id:newId(),courseId,userId:user.id,answers,updatedAt:now()}); }
        catch(err) { if(err.status!==409)throw err;await store.update('intakes',{courseId,userId:user.id},{answers,updatedAt:now()}); }
      }
      send(res,200,{intake:answers,enrollment:{...access.enrollment,intakeCompleted:true}});return true;
    }
    if(adminPath&&suffix==='/modules'&&req.method==='POST') {
      const count=await store.find('modules',{courseId},{limit:100});if(count.length>=100)fail('course module limit reached');
      const module=await store.insert('modules',{id:newId(),courseId,...normalizeModule(await bodyJson(req)),version:1,createdAt:now(),updatedAt:now()});
      send(res,201,{module});return true;
    }
    if(adminPath&&['/report','/export'].includes(suffix)&&req.method==='GET') {
      const type=url.searchParams.get('type')||'participants';
      const result=await report(courseId,suffix==='/export'?type:null);
      if(suffix==='/report') { const {events,posts,...view}=result;send(res,200,view);return true; }
      if(type==='intake')sendCsv(res,'course-intake',[['userId','name','email',...INTAKE_FIELDS],...result.participants.map(p=>[p.userId,p.name,p.email,...INTAKE_FIELDS.map(k=>p.intake?.[k]??'')])]);
      else if(type==='participants')sendCsv(res,'course-participants',[['userId','name','email','enrolledAt','intakeCompleted'],...result.participants.map(p=>[p.userId,p.name,p.email,p.enrolledAt,Boolean(p.intake)])]);
      else if(type==='feedback')sendCsv(res,'course-feedback',feedbackCsv(result.feedback));
      else if(type==='activity')sendCsv(res,'course-activity',[['date','userId','moduleId','action','resourceUrl'],...result.events.map(e=>[e.createdAt,e.userId,e.moduleId,e.kind,e.resourceUrl]),...result.posts.map(p=>[p.createdAt,p.userId,p.moduleId,p.kind,''])]);
      else fail('invalid export type');return true;
    }
    const moderation=suffix.match(/^\/posts\/([^/]+)$/);
    if(adminPath&&moderation&&req.method==='DELETE') {
      const post=await findOne('posts',{id:identifier(moderation[1]),courseId});if(!post)fail('post unavailable',404);
      await store.update('posts',{id:post.id},{body:'',links:[],attachmentIds:[],deletedAt:now()});send(res,200,{ok:true});return true;
    }
    if(!adminPath&&suffix==='/events'&&req.method==='POST') {
      const input=await bodyJson(req);const id=identifier(input.id);
      const {module}=await moduleAccess(courseId,identifier(input.moduleId),user,access);
      if(!['module_open','content_open','recording_open'].includes(input.kind))fail('invalid activity type');
      const resourceUrl=input.kind==='module_open'?'':text(input.resourceUrl,'resource URL',2000,true);
      if(input.kind!=='module_open'&&!module.resources.some(r=>r.url===resourceUrl&&(input.kind==='recording_open'?r.kind==='recording':r.kind!=='recording')))fail('resource is not in this module');
      const event={id,courseId,moduleId:module.id,userId:user.id,kind:input.kind,resourceUrl,createdAt:now()};
      try { await store.insert('events',event); }
      catch(err) { if(err.status!==409)throw err;const old=await findOne('events',{id,userId:user.id,courseId,moduleId:module.id,kind:input.kind,resourceUrl});if(!old)fail('event identifier is already used',409); }
      send(res,200,{ok:true});return true;
    }
    const moduleMatch=suffix.match(/^\/modules\/([^/]+)(\/posts|\/attachments)?$/);
    if(moduleMatch) {
      const {module}=await moduleAccess(courseId,identifier(moduleMatch[1]),user,access);
      const operation=moduleMatch[2]||'';
      if(!operation&&req.method==='GET'){send(res,200,{module});return true;}
      if(adminPath&&!operation&&req.method==='PATCH') {
        const input=await bodyJson(req);if(!Number.isInteger(input.version)||input.version<1)fail('version is required');
        const updated=await store.update('modules',{id:module.id,courseId,version:input.version},{...normalizeModule(input,module),version:input.version+1,updatedAt:now()});
        if(!updated)fail('module changed; reload before saving',409);
        send(res,200,{module:updated});return true;
      }
      if(!adminPath&&operation==='/attachments'&&req.method==='POST') {
        const input=decodeAttachment(await bodyJson(req,4*1024*1024+4096));
        const existing=await store.find('attachments',{userId:user.id,courseId},{limit:100});
        if(existing.length>=100||existing.reduce((n,a)=>n+a.size,0)+input.size>30*1024*1024)fail('course upload allowance reached; use a link instead',413);
        const id=newId();const attachment={id,courseId,moduleId:module.id,userId:user.id,name:input.name,mime:input.mime,size:input.size,storagePath:`${user.id}/${id}`,status:'pending',createdAt:now()};
        await store.insert('attachments',attachment);
        // A failed response does not prove Storage rejected the object. Keep the
        // pending record for reconciliation, including when a worker terminates.
        await store.putFile(attachment,input.bytes);
        await store.update('attachments',{id,status:'pending'},{status:'ready'});
        send(res,201,{attachment:attachmentView(attachment)});return true;
      }
      if(!adminPath&&operation==='/posts'&&req.method==='GET') {
        const rows=await store.find('posts',{courseId,moduleId:module.id},{limit:31,after:decodeCursor(url.searchParams.get('cursor'))});
        const page=rows.slice(0,30);
        send(res,200,{posts:await Promise.all(page.map(postView)),nextCursor:rows.length>30?encodeCursor(page.at(-1)):null});return true;
      }
      if(!adminPath&&operation==='/posts'&&req.method==='POST') {
        const input=normalizePost(await bodyJson(req));
        const old=await findOne('posts',{userId:user.id,clientId:input.clientId});
        if(old) {
          if(!samePost(old,input,courseId,module.id))fail('post identifier is already used',409);
          send(res,200,{post:await postView(old)});return true;
        }
        if(input.parentId) {
          const parent=await findOne('posts',{id:input.parentId,courseId,moduleId:module.id});if(!parent||parent.deletedAt)fail('parent post unavailable');
        }
        for(const id of input.attachmentIds) if(!await findOne('attachments',{id,userId:user.id,courseId,moduleId:module.id,status:'ready'}))fail('attachment is unavailable or belongs to another member');
        const record={id:newId(),courseId,moduleId:module.id,userId:user.id,authorName:user.fullName,staff:isStaff(user),...input,deletedAt:null,createdAt:now()};
        let post;
        try {post=await store.insert('posts',record);}catch(err){if(err.status!==409)throw err;post=await findOne('posts',{userId:user.id,clientId:input.clientId});if(!samePost(post,input,courseId,module.id))throw err;}
        send(res,201,{post:await postView(post)});return true;
      }
    }
    send(res,404,{error:'not found'});return true;
  };
}
