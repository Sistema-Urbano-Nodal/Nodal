export async function exportCourseData(store,userId) {
  const result={};
  for(const name of ['enrollments','intakes','posts','attachments','feedback','events']) {
    const rows=[];let after;
    const order=name==='intakes'?['id']:['createdAt','id'];
    for(;;) {
      const page=await store.find(name,{userId},{limit:500,order,after});rows.push(...page);
      if(!page.length)break;
      after={id:page.at(-1).id,...(name==='intakes'?{}:{createdAt:page.at(-1).createdAt})};
    }
    result[name]=name==='attachments'?rows.map(({storagePath,...attachment})=>attachment):rows;
  }
  return result;
}

export async function deleteCourseData(store,userId) {
  // Remove private blobs before deleting the account so a storage failure remains retryable.
  for(;;) {
    const attachments=await store.find('attachments',{userId},{limit:100});
    for(const attachment of attachments) {
      if(attachment.status==='pending')fail('An upload is awaiting reconciliation. Contact the teaching team before retrying account deletion.',409);
      await store.deleteFile(attachment);await store.remove('attachments',{id:attachment.id,userId});
    }
    if(!attachments.length)break;
  }
  // Keep a tombstone for replies without retaining the departing person's content.
  await store.update('posts',{userId},{body:'',links:[],attachmentIds:[],authorName:'',staff:false,deletedAt:new Date().toISOString()});
  for(const name of ['enrollments','intakes','feedback','events'])await store.remove(name,{userId});
}
import {fail} from './courses-domain.js';
