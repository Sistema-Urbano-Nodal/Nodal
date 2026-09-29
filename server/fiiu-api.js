import {randomUUID} from 'node:crypto';
import {fail,identifier,csv} from './courses-domain.js';
import {EVENT_ID,FIIU_EVENT,DEFAULT_CONFIG,normalizeRegistration,applicationStatus,version,normalizeContent,contentView,normalizeConfig} from './fiiu-domain.js';
const now=()=>new Date().toISOString();
async function body(req){
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail('JSON request required',415);
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24576)fail('request too large',413);chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))fail('JSON object required');return value;}catch(err){if(err.status)throw err;fail('invalid JSON');}
}
export async function exportFiiuData(store,userId){
 const registration=(await store.find('registrations',{eventId:EVENT_ID,userId},{limit:1}))[0]??null;
 const attendance=registration?await store.find('attendance',{registrationId:registration.id}):[];
 return {registration,attendance:attendance.map(({activityId,createdAt})=>({activityId,createdAt}))};
}
export function createFiiuApi({store,sameOrigin,send,rateLimit=()=>true}){
 const one=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
 const config=async()=>{const row=await one('config',{id:EVENT_ID});return {...DEFAULT_CONFIG,...row?.data,version:row?.version??0};};
 const publications=async(url,onlyPublished)=>{
  const after=url.searchParams.get('cursor');let previous;
  if(after){previous=await one('content',{id:identifier(after),eventId:EVENT_ID});if(!previous)fail('invalid content cursor');}
  const rows=await store.find('content',{eventId:EVENT_ID,...(onlyPublished?{status:'published'}:{})},{newest:true,after,afterCreatedAt:previous?.createdAt,limit:100});
  return {content:rows.map(contentView),nextCursor:rows.length===100?rows.at(-1).id:null};
 };
 return async({req,res,url,user})=>{
  const path=url.pathname;
  if(!/^\/api\/(?:fiiu(?:\/|$)|admin\/fiiu(?:\/|$))/.test(path))return false;
  const staff=path.startsWith('/api/admin/');
  if(!(path==='/api/fiiu'&&req.method==='GET')&&!user){send(res,401,{error:'sign in required'});return true;}
  if(staff&&user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
  if(!['GET','HEAD'].includes(req.method)&&!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
  if(!rateLimit(req,res,user))return true;
  if(path==='/api/fiiu'&&req.method==='GET'){
   const [settings,page]=await Promise.all([config(),publications(url,true)]);
   send(res,200,{event:FIIU_EVENT,config:settings,...page});return true;
  }
  if(path==='/api/fiiu/registration'){
   if(req.method==='GET'){send(res,200,{...await exportFiiuData(store,user.id),user:{name:user.name,email:user.email,city:user.city},isAdmin:user.permission==='admin'});return true;}
   if(req.method==='PUT'){
    if(!(await config()).registrationOpen)fail('registration is closed',403);
    const input=await body(req),expected=version(input.version),answers=normalizeRegistration(input);
    const existing=await one('registrations',{eventId:EVENT_ID,userId:user.id});
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before saving',409);
    const patch={email:user.email,answers,labStatus:applicationStatus(answers,existing),version:expected+1,updatedAt:now()};
    const registration=existing?await store.update('registrations',{id:existing.id,userId:user.id,version:expected},patch):await store.insert('registrations',{id:randomUUID(),eventId:EVENT_ID,userId:user.id,...patch,createdAt:now()});
    if(!registration)fail('registration changed; reload before saving',409);
    send(res,200,{registration});return true;
   }
   if(req.method==='DELETE'){
    const input=await body(req),expected=version(input.version),existing=await one('registrations',{eventId:EVENT_ID,userId:user.id});
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before cancelling',409);
    if(existing&&!await store.remove('registrations',{id:existing.id,userId:user.id,version:expected}))fail('registration changed; reload before cancelling',409);
    send(res,200,{ok:true});return true;
   }
  }
  if(path==='/api/admin/fiiu/config'){
   if(req.method==='GET'){send(res,200,{config:await config()});return true;}
   if(req.method==='PUT'){
    const input=await body(req),expected=version(input.version),data=normalizeConfig(input);
    const row=expected?await store.update('config',{id:EVENT_ID,version:expected},{data,version:expected+1}):await store.insert('config',{id:EVENT_ID,data,version:1});
    if(!row)fail('configuration changed; reload before saving',409);send(res,200,{config:{...row.data,version:row.version}});return true;
   }
  }
  if(path==='/api/admin/fiiu/registrations'&&req.method==='GET'){
   const after=url.searchParams.get('cursor');if(after)identifier(after);
   const registrations=await store.find('registrations',{eventId:EVENT_ID},{after,limit:100});
   send(res,200,{registrations,nextCursor:registrations.length===100?registrations.at(-1).id:null});return true;
  }
  if(path==='/api/admin/fiiu/export'&&req.method==='GET'){
   const rows=[['registrationId','email','firstName','lastName','country','city','profile','publicOfficial','activities','labStatus','institution','position','nationalId','gender','age','accessibility','accessibilityOther','motivation','motivationOther','previousAttendance','registeredAt']];let after;
   do{const page=await store.find('registrations',{eventId:EVENT_ID},{after});for(const r of page){const a=r.answers;rows.push([r.id,r.email,a.firstName,a.lastName,a.country,a.city,a.profile,a.publicOfficial,a.activities.join('; '),r.labStatus,a.institution,a.position,a.nationalId,a.gender,a.age,a.accessibility.join('; '),a.accessibilityOther,a.motivation,a.motivationOther,a.previousAttendance,r.createdAt]);}after=page.length===200?page.at(-1).id:null;}while(after);
   send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fiiu-2026-registrations.csv"'});return true;
  }
  let match=path.match(/^\/api\/admin\/fiiu\/registrations\/([^/]+)(\/attendance)?$/);
  if(match){
   const registration=await one('registrations',{id:identifier(match[1]),eventId:EVENT_ID});if(!registration)fail('registration unavailable',404);
   if(!match[2]&&req.method==='GET'){send(res,200,{registration,attendance:await store.find('attendance',{registrationId:registration.id})});return true;}
   if(!match[2]&&req.method==='PATCH'){
    const input=await body(req),expected=version(input.version);
    if(!registration.answers.publicOfficial||!registration.answers.applyLab||!['pending','accepted','declined'].includes(input.labStatus))fail('invalid laboratory review');
    const updated=await store.update('registrations',{id:registration.id,version:expected},{labStatus:input.labStatus,version:expected+1,updatedAt:now()});
    if(!updated)fail('registration changed; reload before reviewing',409);send(res,200,{registration:updated});return true;
   }
   if(match[2]&&req.method==='PUT'){
    const input=await body(req),activity=FIIU_EVENT.activities.find(a=>a.id===input.activityId);
    if(!activity||typeof input.attended!=='boolean')fail('invalid attendance');
    if(input.attended&&((activity.registration==='general'&&!registration.answers.activities.includes(activity.id))||(activity.registration==='application'&&registration.labStatus!=='accepted')))fail('participant is not registered for this activity');
    const filters={registrationId:registration.id,activityId:activity.id};
    if(!input.attended)await store.remove('attendance',filters);
    else if(!await one('attendance',filters)){try{await store.insert('attendance',{id:randomUUID(),...filters,confirmedBy:user.id,createdAt:now()});}catch(err){if(err.status!==409||!await one('attendance',filters))throw err;}}
    send(res,200,{attendance:await store.find('attendance',{registrationId:registration.id})});return true;
   }
  }
  if(path==='/api/admin/fiiu/content'){
   if(req.method==='GET'){send(res,200,await publications(url,false));return true;}
   if(req.method==='POST'){const input=normalizeContent(await body(req));const content=await store.insert('content',{id:randomUUID(),eventId:EVENT_ID,...input,version:1,createdAt:now(),updatedAt:now()});send(res,201,{content:contentView(content)});return true;}
  }
  match=path.match(/^\/api\/admin\/fiiu\/content\/([^/]+)$/);
  if(match&&req.method==='PATCH'){
   const input=await body(req),expected=version(input.version),content=await store.update('content',{id:identifier(match[1]),eventId:EVENT_ID,version:expected},{...normalizeContent(input),version:expected+1,updatedAt:now()});
   if(!content)fail('content changed; reload before saving',409);send(res,200,{content:contentView(content)});return true;
  }
  send(res,404,{error:'not found'});return true;
 };
}
