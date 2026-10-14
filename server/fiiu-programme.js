import {EVENT_ID,FIIU_EVENT,isCheckinActivity,activityMinutes,checkinWindow} from './fiiu-domain.js';

/* The festival programme as people see it: the built-in blocks of FIIU_EVENT with the organisers' edits (table
   fiiu_programme, one row per edited block holding its full set of edited fields) laid over them. Every reader takes it
   from here: the public and organiser programme, check-in windows, certificate hours, the export and the emails.
   Registration rules and canAttend keep the built-in list, since they use only ids and kinds, which never change. */
export const PROGRAMME_FIELDS=['title','date','time','venue','description','sessions','formUrl'];

// One block with its edit (or none). A block that takes a check-in carries its minutes and check-in window computed
// from its current date and time, as the built-in ones do (the browser never parses times).
export function mergeActivity(activity,row){
 const data=row?.data??{},edit=Object.fromEntries(PROGRAMME_FIELDS.filter(k=>Object.hasOwn(data,k)&&(k!=='formUrl'||activity.registration==='external')).map(k=>[k,data[k]]));
 const block={...activity,description:activity.description??'',...edit,edited:Boolean(row)};
 return isCheckinActivity(block)?{...block,minutes:activityMinutes(block),checkin:checkinWindow(block)}:block;
}
// The event shaped exactly like FIIU_EVENT, every block with a description and edited flag. Rows for unknown ids are ignored.
export function mergeProgramme(rows=[],base=FIIU_EVENT){
 const byId=new Map(rows.map(row=>[row.id,row]));
 return {...base,activities:base.activities.map(activity=>mergeActivity(activity,byId.get(activity.id)))};
}
const readRows=store=>store.find('programme',{eventId:EVENT_ID},{limit:200});
// One fresh read, for the scripts that run outside a server instance.
export const readProgramme=async store=>mergeProgramme(await readRows(store));

/* The merged programme for one server instance: read at most once every ttlMs, with concurrent requests sharing the
   read; an edit saved through this instance calls clear(), so it shows here at once and on other instances within ttlMs
   (plus the CDN's 15 s on GET /api/fiiu). A failed read serves the last programme and is tried again on the next
   request; the first read has nothing to fall back on, so it fails. */
export function createProgramme({store,ttlMs=30000,now=()=>Date.now()}){
 let memo=null,last=null;
 const rows=()=>readRows(store);
 return {
  rows,clear(){memo=null;},
  event(){
   const t=now();if(memo&&t-memo.at<ttlMs)return memo.promise;
   const promise=rows().then(list=>(last=mergeProgramme(list)),err=>{if(memo?.promise===promise)memo=null;if(last)return last;throw err;});
   memo={at:t,promise};return promise;
  },
 };
}
