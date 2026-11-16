import {EVENT_ID,LEGACY_FIIU_ACTIVITIES,isCheckinActivity,activityMinutes} from './fiiu-domain.js';

/* The festival's organiser summary, in one place: the panel (GET /api/admin/fiiu/summary) and the admin home read it
   through festivalSummary, so the two can never disagree. */

// The programme as it stands plus the legacy blocks a stored id may still name. The summary tags every ticked block
// 'general' (the Postgres function too), so the party joins the catalogue as one.
export const summaryCatalogue=event=>[...event.activities,...LEGACY_FIIU_ACTIVITIES].map(activity=>activity.registration==='social'?{...activity,registration:'general'}:activity);

export async function festivalSummary({store,programme}){
 const event=await programme.event();
 return {event,summary:await store.summary(EVENT_ID,summaryCatalogue(event))};
}

/* Certificate hours the organisers' screen shows: attendance x minutes / 60 over the blocks that take a check-in, as
   web/scripts/fiiu-ui.js minutesOf counts them (a block without minutes adds nothing), rounded half up to whole hours. */
export function festivalHours(summary,event){
 const byId=new Map(event.activities.map(activity=>[activity.id,activity]));
 let minutes=0;
 for(const row of summary?.activities??[]){
  const activity=byId.get(row.activityId);
  if(!isCheckinActivity(activity))continue;
  const own=activity.minutes!==undefined?activity.minutes:activityMinutes(activity);
  if(Number.isFinite(own)&&own>0)minutes+=(Number(row.attendance)||0)*own;
 }
 return Math.floor(minutes/60+0.5);
}
