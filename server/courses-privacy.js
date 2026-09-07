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
  const member=(await store.getMembers([userId]))[0];
  result.invitations=[];
  if(member?.email){
    let after;
    for(;;){
      const page=await store.find('invitations',{email:member.email.toLowerCase()},{limit:500,after});
      result.invitations.push(...page.map(({createdBy,...invitation})=>invitation));
      if(!page.length)break;after={id:page.at(-1).id,createdAt:page.at(-1).createdAt};
    }
  }
  return result;
}

export async function deleteCourseData(store,userId) {
  const member=(await store.getMembers([userId]))[0];
  if(member?.email)await store.remove('invitations',{email:member.email.toLowerCase()});
  await store.remove('invitations',{userId});
  // Official materials are course-owned (purpose=material, userId=null) from
  // upload time. Staff account erasure retains them; private post files still
  // belong to the person and must be removed before deleting the account.
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
