import {pathToFileURL} from 'node:url';
import {createRepository} from '../server/repository.js';
import {createCourseStore} from '../server/courses-repository.js';

// Operator reconciliation after ambiguous Storage responses or worker termination.
// A full day separates cleanup from the 20-second upload timeout. Dry run is default.
export async function reconcileCourseUploads(store,{apply=false,now=Date.now()}={}) {
  let after,examined=0,stale=0,removed=0;
  for(;;) {
    const page=await store.find('attachments',{status:'pending'},{limit:100,after});
    if(!page.length)break;
    for(const attachment of page){
      examined++;
      if(now-Date.parse(attachment.createdAt)<24*60*60*1000)continue;
      stale++;
      if(apply){await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,status:'pending'});removed++;}
    }
    after={id:page.at(-1).id,createdAt:page.at(-1).createdAt};
  }
  return {examined,stale,removed,dryRun:!apply};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const repository=createRepository();
  try{console.log(JSON.stringify(await reconcileCourseUploads(createCourseStore({db:repository.database}),{apply:process.argv.includes('--apply')})));}
  finally{repository.close?.();}
}
