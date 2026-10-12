import {fail,text,identifier,decodeAttachment,attachmentFilename} from './courses-domain.js';
import {FIIU_EVENT} from './fiiu-domain.js';

// FIIU block conversations: organisers ask a question on a festival block, registered people answer in a chat.
// The limits mirror the CHECKs in 20261011120000_fiiu_conversations.sql; the 3 MB file fits Vercel's ~4.5 MB body
// once base64 makes it ~4 MB, and the per-person allowance counts pending uploads too.
export const TALK_LIMITS={question:500,talk:180,message:1000,files:3,fileBytes:3*1024*1024,thumbBytes:100*1024,quotaFiles:30,quotaBytes:30*1024*1024,page:100,changes:200};
export const TALK_FILE_TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
// Legacy activities (the old workshop and route days) cannot get questions; only the live catalogue can.
export const talkActivity=id=>FIIU_EVENT.activities.find(a=>a.id===id)??null;
// The chat pages translate refusals by this code rather than by the English message.
const failCode=(message,code,status=400)=>{try{fail(message,status);}catch(err){throw Object.assign(err,{code});}};
const points=value=>[...value].length,cap=(value,max)=>[...value].slice(0,max).join('');
/* PostgreSQL cannot store U+0000 in text (PostgREST answers an opaque 400) while SQLite cut the text there, and JSON can
   carry a lone surrogate neither stores as sent. Other C0 controls are invisible in the composer, so a retry would fail
   the same way: they go too, before the limits are checked. Tab, newline and carriage return stay. */
const plain=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').toWellFormed():value;
// A downloaded report can carry a long name the person cannot change from the chat: it is cut to the column's 160
// characters, extension kept and never inside an emoji, rather than refused.
// One pass that stops at the limit: the upload body may carry a name of megabytes, and the cut must cost the same as a short one.
function shortName(name){
 if(typeof name!=='string')return name;
 const clean=name.trim();if(clean.length<=160)return name;
 const ext=clean.match(/\.[\p{L}\p{N}]{1,10}$/u)?.[0]??'';
 let stem='';for(const ch of clean.slice(0,clean.length-ext.length)){if(stem.length+ch.length+ext.length>160)break;stem+=ch;}
 return stem.trimEnd()+ext;
}
const dimension=value=>Number.isInteger(value)&&value>=1&&value<=20000?value:null;
// Width and height only size the image box before it loads, so one without the other is dropped with it.
const dimensions=(input,image)=>{const width=image?dimension(input?.width):null,height=image?dimension(input?.height):null;return width&&height?{width,height}:{width:null,height:null};};

/* Create (no current): the activity must be live, the status open or hidden (a hidden question is a prepared draft).
   Edit: the merged row is re-checked, the activity cannot move, and closed becomes possible. A talk is re-checked only
   when the edit supplies a different one, so closing a question survives a talk renamed in the catalogue since. */
export function normalizeQuestion(raw={},current=null){
 const input={...raw,body:plain(raw.body),talk:plain(raw.talk)};
 if(current&&input.activityId!==undefined&&input.activityId!==current.activityId)failCode('activity cannot change','invalid_activity');
 const activityId=current?current.activityId:input.activityId,activity=talkActivity(activityId);
 if(!activity)failCode('invalid activity','invalid_activity');
 let talk=current?.talk??null;
 if(!current||input.talk!==undefined){
  talk=text(input.talk??undefined,'talk',TALK_LIMITS.talk)||null;
  if(talk&&talk!==current?.talk&&!activity.sessions.some(session=>session[1]===talk))failCode('invalid talk','invalid_talk');
 }
 const body=text(input.body===undefined?current?.body:input.body,'question',TALK_LIMITS.question,true);
 const status=input.status===undefined?current?.status??'open':input.status;
 if(!(current?['open','closed','hidden']:['open','hidden']).includes(status))fail('invalid status');
 return {activityId,talk,body,status};
}
// The limit counts code points like Postgres char_length, so 1000 emoji fit as they do in the column.
export function normalizeMessage(input={}){
 const clientId=identifier(input.clientId);
 if(input.body!==undefined&&input.body!==null&&typeof input.body!=='string')fail('message must be text');
 const body=plain(String(input.body??'')).trim();
 if(points(body)>TALK_LIMITS.message)failCode('message is too long','message_too_long');
 if(!Array.isArray(input.fileIds??[]))fail('fileIds must be a list');
 const fileIds=[...new Set((input.fileIds??[]).map(identifier))];
 if(fileIds.length>TALK_LIMITS.files)failCode('up to 3 files per message','too_many_files');
 if(!body&&!fileIds.length)failCode('write a message or attach a file','empty_message');
 return {clientId,body,fileIds};
}
// The phone sends the full image and, for images it could decode, a small JPEG or WebP preview (never for PDFs).
export function decodeTalkFile(input={}){
 const file=decodeAttachment({...input,name:shortName(input.name)},{types:TALK_FILE_TYPES,max:TALK_LIMITS.fileBytes}),image=file.mime.startsWith('image/');
 let thumb=null;
 if(input.thumb!==undefined&&input.thumb!==null){
  if(!image)fail('only images have a thumbnail');
  if(typeof input.thumb!=='object'||Array.isArray(input.thumb))fail('invalid thumbnail');
  const decoded=decodeAttachment({name:'thumb.jpg',mime:input.thumb.mime??'image/jpeg',data:input.thumb.data},{types:['image/jpeg','image/webp'],max:TALK_LIMITS.thumbBytes});
  thumb={bytes:decoded.bytes,size:decoded.size,...dimensions(input.thumb,true)};
 }
 return {name:file.name,mime:file.mime,size:file.size,bytes:file.bytes,...dimensions(input,image),thumb};
}
/* 'María G.': names are shown to everyone in the chat and on the projector, so control characters become spaces and
   direction overrides go (they could reorder the text after the name); the 60 character cap counts code points. */
export function displayName(first,last){
 const clean=value=>String(value??'').normalize('NFC').replace(/[‪-‮⁦-⁩]/g,'').replace(/[\p{Cc}\s]+/gu,' ').trim();
 const name=cap(clean(first),60).trim()||'Participante',initial=clean(last).match(/\p{L}/u)?.[0];
 return initial?`${name} ${initial.toLocaleUpperCase('es')}.`:name;
}
// The registration answers name participants (the store's flat record or the raw answers); an organiser without one
// is named from the profile, first word plus the last word's initial. Both are snapshotted on each message.
export function namesFor(user,registration){
 const answers=registration?(registration.answers??registration):null;
 if(answers){const first=String(answers.firstName??''),last=String(answers.lastName??'');return {authorName:cap(displayName(first,last),120),authorFull:cap(`${first} ${last}`.trim(),240)};}
 const full=String(user?.name??user?.fullName??'').trim(),words=full.split(/\s+/).filter(Boolean);
 return {authorName:cap(displayName(words[0],words.length>1?words.at(-1):''),120),authorFull:cap(full,240)};
}
export const questionView=(q,{organiser=false}={})=>({id:q.id,activityId:q.activityId,talk:q.talk??null,body:q.body,status:q.status,revision:Number(q.revision),messageCount:Number(q.messageCount),createdAt:q.createdAt,...(organiser?{version:q.version}:{})});
/* Peers see a display name and whether the message is theirs, never the author's id or a storage path. liked: null
   leaves the viewer's like out, for answers shared between viewers (the page keeps its own). A participant is only
   given a hidden message that is their own (the API sends everyone else its gone view), marked so they can delete it. */
export function messageView(m,{viewer=null,organiser=false,files=[],liked=false}={}){
 return {id:m.id,author:m.authorName,organiser:Boolean(m.organiser),mine:Boolean(viewer)&&viewer===m.userId,body:m.body,
  files:files.map(f=>({id:f.id,name:attachmentFilename(f.name,f.mime),mime:f.mime,size:f.size,width:f.width??null,height:f.height??null,thumb:Boolean(f.thumbSize)})),
  likeCount:Number(m.likeCount??0),...(liked===null?{}:{liked:Boolean(liked)}),createdAt:m.createdAt,seq:Number(m.seq),
  ...(organiser?{authorFull:m.authorFull,hidden:Boolean(m.hiddenAt)}:m.hiddenAt?{hidden:true}:{})};
}
export const goneView=m=>({id:m.id,seq:Number(m.seq),gone:true});
export const activityView=({id,title,date,time,venue,sessions,registration,period})=>({id,title,date,time,venue,sessions,registration,period});
