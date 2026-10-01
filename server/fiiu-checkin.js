import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {EVENT_ID} from './fiiu-domain.js';
import {resolveSupabaseEnv} from './supabase.js';

/* Stateless rotating check-in codes: nothing is stored or shared between server instances. Each activity block gets a
   new code every minute, accepted for the current minute and the four before it (about five minutes), so a photo of
   the screen goes stale quickly. The 22-character code (about 132 bits) rides in the QR link; the 6-character code
   (30 unambiguous symbols, about 7×10^8 values) is for phones that will not scan, and the per-account limiter
   makes guessing it impractical. */
export const SLOT_MS=60000,ACCEPTED_SLOTS=5,CODE_LENGTH=22,SHORT_CODE_LENGTH=6;
export const SHORT_CODE_ALPHABET='23456789ABCDEFGHJKLMNPQRTUVWXY';
const LONG_LABEL='nodal-fiiu-checkin:v1',SHORT_LABEL='nodal-fiiu-checkin-short:v1';
// Typed codes may carry spaces or a dash between the two groups of three, and lower case.
export const normalizeShortCode=value=>String(value??'').replace(/[\s-]/g,'').toUpperCase();
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function createCheckinCodes({secret=randomBytes(32),now=Date.now}={}){
 if(!secret||secret.length<32)throw Error('check-in secret must be at least 32 bytes');
 const mac=(label,activityId,slot)=>createHmac('sha256',secret).update(`${label}:${EVENT_ID}:${activityId}:${slot}`).digest();
 const long=(activityId,slot)=>mac(LONG_LABEL,activityId,slot).toString('base64url').slice(0,CODE_LENGTH);
 const short=(activityId,slot)=>{let n=mac(SHORT_LABEL,activityId,slot).readBigUInt64BE(0),out='';for(let i=0;i<SHORT_CODE_LENGTH;i++){out+=SHORT_CODE_ALPHABET[Number(n%30n)];n/=30n;}return out;};
 const slotAt=time=>Math.floor(time/SLOT_MS);
 // The matching slot, or null. Wrong types and lengths are rejected before any comparison; every accepted slot is
 // compared in constant time.
 function verify(activityId,code){
  if(typeof code!=='string'||code.length>32)return null;
  let value=code,make=long;
  if(code.length!==CODE_LENGTH){value=normalizeShortCode(code);make=value.length===SHORT_CODE_LENGTH?short:null;}
  if(!make)return null;
  const current=slotAt(now());let found=null;
  for(let slot=current;slot>current-ACCEPTED_SLOTS;slot--)if(same(make(activityId,slot),value)&&found===null)found=slot;
  return found;
 }
 return {
  now,verify,
  current(activityId){
   const slot=slotAt(now());
   return {code:long(activityId,slot),shortCode:short(activityId,slot),slot,rotatesAt:new Date((slot+1)*SLOT_MS).toISOString(),validUntil:new Date((slot+ACCEPTED_SLOTS)*SLOT_MS).toISOString()};
  },
  // A code sent without its activity: try each candidate block. Returns {activity, slot} or null.
  find(code,activities){for(const activity of activities){const slot=verify(activity.id,code);if(slot!==null)return {activity,slot};}return null;},
 };
}
/* FIIU_CHECKIN_SECRET when set (at least 32 characters). Otherwise, on Supabase, derive a stable secret from the server
   key (the same pattern as signRecovery in supabase.js) so every serverless instance agrees. On SQLite, a random
   per-process secret: a restart only voids the code currently on screen, which refreshes every 30 seconds. */
export function resolveCheckinSecret(env=process.env,backend='sqlite'){
 const configured=String(env.FIIU_CHECKIN_SECRET??'');
 if(configured){if(configured.trim().length<32)throw Error('FIIU_CHECKIN_SECRET must be at least 32 characters');return configured;}
 if(backend==='supabase'){
  const {serverKey}=resolveSupabaseEnv(env);
  if(!serverKey)throw Error('FIIU check-in requires FIIU_CHECKIN_SECRET or SUPABASE_SECRET_KEY');
  return createHmac('sha256',serverKey).update('nodal-fiiu-checkin-secret:v1').digest();
 }
 return randomBytes(32);
}
/* Development only: FIIU_CHECKIN_NOW (an ISO time) starts the check-in clock at that moment and lets it run in real
   time, so reviewers can rehearse a block on a local SQLite preview before the festival. It is ignored in production
   and on Supabase, and validateRuntimeConfig refuses it in production. */
export function checkinClock(env=process.env,backend='sqlite'){
 const value=String(env.FIIU_CHECKIN_NOW??'').trim();
 if(!value||env.NODE_ENV==='production'||backend!=='sqlite')return Date.now;
 const start=Date.parse(value);if(!Number.isFinite(start))throw Error('FIIU_CHECKIN_NOW must be an ISO time');
 const startedAt=Date.now();return ()=>start+(Date.now()-startedAt);
}
