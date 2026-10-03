import {pathToFileURL} from 'node:url';
import {createRepository} from '../server/repository.js';
import {createCourseStore} from '../server/courses-repository.js';

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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const repository=createRepository();
  try{console.log(JSON.stringify(await reconcileCourseUploads(createCourseStore({db:repository.database}),{apply:process.argv.includes('--apply')})));}
  finally{repository.close?.();}
}
