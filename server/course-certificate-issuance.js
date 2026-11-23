import {renderCourseCertificate} from './course-certificate-pdf.js';

// Enrollment identifies the recipient. For ordinary courses only an explicit staff confirmation
// of completion authorizes issuance. The survey pilot instead retains its original cohort rule.
const cleanName=value=>typeof value==='string'?value.trim():'';
const certificateName=(member,intake)=>cleanName(intake?.answers?.fullName)||cleanName(member?.name);
const reference=({id,userId,size,createdAt})=>({id,userId,size,createdAt});

export function createCertificateIssuance({store,surveyCourse,findOne,all,activeMembers,joinedLater,
  prepare,discard,refuse,send,render=renderCourseCertificate}){
  const published=course=>{
    if(course.status!=='published')refuse(409,'certificate_course_unpublished','publish the course before issuing a certificate');
  };
  async function roster(course){
    published(course);
    const courseId=course.id,pilot=courseId===surveyCourse;
    const [enrolled,intakes,files,responses]=await Promise.all([
      all('enrollments',{courseId}),all('intakes',{courseId}),all('certificates',{courseId,status:'ready'}),
      pilot?all('surveys',{courseId}):[],
    ]);
    const members=await activeMembers(enrolled),forms=new Map(intakes.map(row=>[row.userId,row]));
    const issued=new Set(files.map(row=>row.userId)),submitted=new Set(responses.filter(row=>row.submittedAt).map(row=>row.userId));
    const participants=[];
    for(const enrollment of enrolled){
      const userId=enrollment.userId,member=members.get(userId);
      if(!member||member.staff||(pilot&&joinedLater(courseId,enrollment)))continue;
      const name=certificateName(member,forms.get(userId));
      participants.push({userId,name,email:member.email??'',eligible:Boolean(name)&&(!pilot||submitted.has(userId)),issued:issued.has(userId)});
    }
    participants.sort((a,b)=>a.name.localeCompare(b.name,'es')||a.userId.localeCompare(b.userId));
    return {rule:pilot?'survey':'staff',participants};
  }
  async function issue({course,userId,input,res}){
    published(course);
    const courseId=course.id,filters={courseId,userId},pilot=courseId===surveyCourse;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='approved')||
      (Object.hasOwn(input,'approved')&&input.approved!==true)||(!pilot&&input.approved!==true)){
      refuse(400,'certificate_approval_required','confirm completion for this participant before issuing a certificate');
    }
    const [enrollment,members,intake,response,existing]=await Promise.all([
      findOne('enrollments',filters),store.getMembers([userId],{activeOnly:true}),findOne('intakes',filters),
      pilot?findOne('surveys',filters):null,findOne('certificates',{...filters,status:'ready'}),
    ]);
    const member=members.find(row=>row.id===userId);
    if(!enrollment||!member||member.staff||(pilot&&joinedLater(courseId,enrollment))){
      refuse(404,'certificate_not_enrolled','this person is not an active participant of this course');
    }
    if(pilot&&!response?.submittedAt)refuse(409,'certificate_survey_required','the participant must submit the final survey');
    if(existing){send(res,200,{certificate:reference(existing),created:false});return;}
    const name=certificateName(member,intake);
    if(!name)refuse(422,'certificate_name_missing','a registered participant name is required');
    let bytes;
    try{bytes=await render({name,course:course.title});}
    catch(error){if(error.code==='certificate_text_unsupported')refuse(422,error.code,'the certificate cannot represent the registered name or course title');throw error;}
    const pending=await prepare(courseId,userId,bytes);
    // Never demote a previous PDF. The database's partial unique index selects the winner
    // if another issuer or manual upload reached ready while this file was being rendered.
    let ready;
    try{ready=await store.update('certificates',{id:pending.id,status:'pending'},{status:'ready'});}
    catch(error){if(error.status!==409)throw error;}
    if(ready){send(res,201,{certificate:reference(ready),created:true});return;}
    await discard(pending,'pending');
    const winner=await findOne('certificates',{...filters,status:'ready'});
    if(!winner)refuse(409,'certificate_changed','the certificate changed; reload and try again');
    send(res,200,{certificate:reference(winner),created:false});
  }
  return {roster,issue};
}
