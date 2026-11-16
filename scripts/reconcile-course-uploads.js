import {pathToFileURL} from 'node:url';
import {createRepository} from '../server/repository.js';
import {createCourseStore} from '../server/courses-repository.js';
import {defaultDatabasePath} from '../server/db.js';
import {dataBackend,resolveSupabaseEnv} from '../server/supabase.js';

const DAY_MS=24*60*60*1000;

// Every row matching the filters, page by page in the store's (createdAt, id) order.
async function* rows(store,name,filters) {
  let after;
  for(;;) {
    const page=await store.find(name,filters,{limit:100,...(after?{after}:{})});
    if(!page.length)return;
    yield* page;
    after={id:page.at(-1).id,createdAt:page.at(-1).createdAt};
  }
}
async function livePosts(store,moduleId,userId) {
  const found=[];
  for await (const post of rows(store,'posts',{moduleId,userId,deletedAt:null}))found.push(post);
  return found;
}
const shows=(post,id)=>(post.attachmentIds??[]).some(reference=>typeof reference==='string'&&reference.toLowerCase()===id.toLowerCase());

/* Operator reconciliation after ambiguous Storage responses or worker termination. Dry run is the default; --apply
   acts. Three kinds of leftover file are reported separately:
   - stale: an upload still 'pending' a day after it started (a full day separates this from the 20-second upload
     timeout);
   - deleting: a file whose removal from Storage failed after its row was marked 'deleting' (a withdrawn post, or a
     deleted material). Such a row is never downloadable; finishing it frees the space;
   - orphaned: a member's post upload, 'ready' for over a day, that no live post of theirs in that module shows (an
     upload whose post was never sent, or a withdrawal whose clean-up was cut short). It still counts against the
     member's upload allowance, so it is flipped to 'deleting' and removed like the rest.
   A Storage failure stops the run and keeps the row, so a later run finishes it. */
export async function reconcileCourseUploads(store,{apply=false,now=Date.now()}={}) {
  const result={examined:0,stale:0,removed:0,deleting:0,deletingRemoved:0,orphaned:0,orphansRemoved:0,dryRun:!apply};
  for await (const attachment of rows(store,'attachments',{status:'pending'})) {
    result.examined++;
    if(now-Date.parse(attachment.createdAt)<DAY_MS)continue;
    result.stale++;
    if(apply){await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'pending'});result.removed++;}
  }
  for await (const attachment of rows(store,'attachments',{status:'deleting'})) {
    result.deleting++;
    if(apply){await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'deleting'});result.deletingRemoved++;}
  }
  const live=new Map();
  for await (const attachment of rows(store,'attachments',{purpose:'post',status:'ready'})) {
    if(now-Date.parse(attachment.createdAt)<DAY_MS||!attachment.userId)continue;
    const key=`${attachment.moduleId}:${attachment.userId}`;
    if(!live.has(key))live.set(key,await livePosts(store,attachment.moduleId,attachment.userId));
    if(live.get(key).some(post=>shows(post,attachment.id)))continue;
    result.orphaned++;
    if(!apply)continue;
    // Only a row still 'ready' is taken, so a concurrent withdrawal or a second run never removes it twice.
    if(!await store.update('attachments',{id:attachment.id,status:'ready'},{status:'deleting'}))continue;
    await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'deleting'});result.orphansRemoved++;
  }
  return result;
}
/* Course certificates (server/course-final-survey.js) leave the same two kinds of row behind: an upload still
   'pending' a day after it started, and a replaced or deleted certificate whose Storage object could not be removed
   ('deleting', never downloadable). Certificates are never "orphaned": a ready one belongs to its person until an
   organiser replaces or deletes it. Same rules as above: dry run by default, a Storage failure keeps the row. */
export async function reconcileCourseCertificates(store,{apply=false,now=Date.now()}={}) {
  const result={pending:0,pendingRemoved:0,deleting:0,deletingRemoved:0,dryRun:!apply};
  for await (const certificate of rows(store,'certificates',{status:'pending'})) {
    if(now-Date.parse(certificate.createdAt)<DAY_MS)continue;
    result.pending++;
    if(apply){await store.deleteCertificate(certificate);await store.remove('certificates',{id:certificate.id,status:'pending'});result.pendingRemoved++;}
  }
  for await (const certificate of rows(store,'certificates',{status:'deleting'})) {
    result.deleting++;
    if(apply){await store.deleteCertificate(certificate);await store.remove('certificates',{id:certificate.id,status:'deleting'});result.deletingRemoved++;}
  }
  return result;
}
/* The data a run reads, chosen as the server chooses it (DATA_BACKEND, else Supabase on Vercel, else the local SQLite
   file): {backend:'supabase', host} or {backend:'sqlite', database}. The report starts with it. */
export function reconcileSource(env=process.env){
  return dataBackend(env)==='supabase'
    ?{backend:'supabase',host:new URL(resolveSupabaseEnv(env).url).host}
    :{backend:'sqlite',database:defaultDatabasePath(env)};
}
/* `npm run uploads:reconcile` (add `-- --apply` to act) prints one JSON report. Production's leftovers are in Supabase,
   so run it with the production Supabase variables loaded. Without them it reads the local SQLite file (creating it if
   missing), whose empty report says nothing about production; it says so on stderr. */
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const source=reconcileSource();
  if(source.backend==='sqlite')console.error(`Reading the local SQLite file ${source.database}, not production. To check production, run it with DATA_BACKEND=supabase, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY set.`);
  const repository=createRepository();
  try{
    const store=createCourseStore({db:repository.database}),options={apply:process.argv.includes('--apply')};
    console.log(JSON.stringify({...source,...await reconcileCourseUploads(store,options),certificates:await reconcileCourseCertificates(store,options)}));
  }
  finally{repository.close?.();}
}
