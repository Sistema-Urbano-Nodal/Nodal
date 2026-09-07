import {newId, fail} from './courses-domain.js';
import {validateEmail} from './auth.js';

const stamp = () => new Date().toISOString();
const invitationError = (code, status) => { throw Object.assign(new Error(code), {code, status}); };
export function participantEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !validateEmail(email)) invitationError('participant_email', 400);
  return email;
}

export function createCourseParticipants({store, userRepository}) {
  const one = async (name, filter) => (await store.find(name, filter, {limit:1}))[0] ?? null;
  async function enroll(courseId, userId) {
    const current = await one('enrollments', {courseId,userId});
    if (current) return {enrollment:current, added:false};
    try {
      return {enrollment:await store.insert('enrollments',{id:newId(),courseId,userId,createdAt:stamp()}), added:true};
    } catch (error) {
      if (error.status !== 409) throw error;
      const existing = await one('enrollments',{courseId,userId});
      if (!existing) throw error;
      return {enrollment:existing,added:false};
    }
  }
  async function accountFor(email) {
    if (!userRepository.findCourseAccount) invitationError('participant_unavailable',503);
    const account = await userRepository.findCourseAccount(email);
    if (account && (!account.active || account.email?.toLowerCase() !== email)) invitationError('participant_unavailable',403);
    return account;
  }
  async function addKnown(courseId, account) {
    const {enrollment,added} = await enroll(courseId, account.id);
    await store.update('invitations',{courseId,email:account.email.toLowerCase(),acceptedAt:null},{userId:account.id,acceptedAt:stamp(),updatedAt:stamp()});
    return {result:added?'enrolled':'already_enrolled',participant:{userId:account.id,name:account.name,email:account.email,enrolledAt:enrollment.createdAt}};
  }
  async function eligible(authUser) {
    if (!authUser?.id || !authUser.email_confirmed_at || authUser.is_anonymous) return [];
    const email=participantEmail(authUser.email), rows=[];let after;
    for (;;) {
      const page=await store.find('invitations',{email,acceptedAt:null},{limit:100,after});
      for(const row of page) {
        if(row.deliveryStatus==='failed' || (row.userId && row.userId!==authUser.id))continue;
        const course=await one('courses',{id:row.courseId});
        if(course?.status==='published')rows.push(row);
      }
      if(!page.length)break;
      after={createdAt:page.at(-1).createdAt,id:page.at(-1).id};
    }
    return rows;
  }
  return {
    async add(course, rawEmail) {
      if(course.status!=='published')invitationError('participant_course_unavailable',409);
      const email=participantEmail(rawEmail), account=await accountFor(email);
      if(!account)invitationError('participant_not_found',404);
      if(!account.confirmed)invitationError('participant_unconfirmed',409);
      return addKnown(course.id,account);
    },
    async invite(course, rawEmail, createdBy) {
      if(course.status!=='published')invitationError('participant_course_unavailable',409);
      const email=participantEmail(rawEmail), account=await accountFor(email);
      if(account?.confirmed)return addKnown(course.id,account);
      if(!userRepository.sendCourseInvitation)invitationError('invitation_unavailable',503);
      const time=stamp();let invitation=await one('invitations',{courseId:course.id,email});
      const previousDelivery=invitation?.deliveryStatus;
      if(invitation) {
        if(Date.now()-Date.parse(invitation.updatedAt)<60000)invitationError('invitation_rate',429);
        // Compare-and-set across instances: only one request reserves a send.
        invitation=await store.update('invitations',{id:invitation.id,updatedAt:invitation.updatedAt},{deliveryStatus:'pending',acceptedAt:null,updatedAt:time});
        if(!invitation)invitationError('invitation_rate',429);
      } else {
        try { invitation=await store.insert('invitations',{id:newId(),courseId:course.id,email,userId:account?.id??null,createdBy,deliveryStatus:'pending',acceptedAt:null,createdAt:time,updatedAt:time}); }
        catch(error) {if(error.status===409)invitationError('invitation_rate',429);throw error;}
      }
      try {
        const invited=await userRepository.sendCourseInvitation({email});
        if(!invited?.id || invited.email?.toLowerCase()!==email)throw new Error('Invitation recipient mismatch');
        // If acceptance raced the provider response, do not overwrite it.
        const updated=await store.update('invitations',{id:invitation.id,updatedAt:time,acceptedAt:null},{userId:invited.id,deliveryStatus:'sent',updatedAt:stamp()});
        return {result:'invited',invitation:updated??await one('invitations',{id:invitation.id})};
      } catch(error) {
        const uncertain=!error.status || error.status>=500;
        // A rejected resend does not revoke the older link in the inbox.
        const deliveryStatus=uncertain?'uncertain':['sent','uncertain','pending'].includes(previousDelivery)?previousDelivery:'failed';
        await store.update('invitations',{id:invitation.id,updatedAt:time,acceptedAt:null},{deliveryStatus,updatedAt:stamp()});
        invitationError(uncertain?'invitation_uncertain':'invitation_unavailable',503);
      }
    },
    async authorize(authUser) {return (await eligible(authUser)).length>0;},
    async accept(authUser) {
      const invitations=await eligible(authUser), ids=[];
      if(!invitations.length)fail('invitation_invalid',403);
      for(const invitation of invitations) {
        await enroll(invitation.courseId,authUser.id);
        await store.update('invitations',{id:invitation.id,acceptedAt:null},{userId:authUser.id,acceptedAt:stamp(),updatedAt:stamp()});
        ids.push(invitation.courseId);
      }
      return [...new Set(ids)];
    },
  };
}
