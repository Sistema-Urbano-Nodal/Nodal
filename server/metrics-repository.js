import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {validPart} from './metrics-domain.js';

/* The admin home's figures (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R3. The home").
   Supabase: one call each to public.metrics_account_days() and public.metrics_member_days(p_today)
   (supabase/migrations/20261114010000_metrics.sql), and the metrics_readings table. SQLite: a hand-written twin that
   answers the same shapes on the local tables, 0 (or an empty series) for a table another store has not created, and
   the readings table created here. Built last in createApp, so the other stores' tables exist. */
export const METRICS_READINGS_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS metrics_readings (day TEXT PRIMARY KEY,taken_at TEXT NOT NULL,defs INTEGER NOT NULL,figures TEXT NOT NULL);
`;
const PAGE=1000;
const unavailable=part=>fail(`metrics ${part} unavailable`,502);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const shift=(day,n)=>new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
// A Lima day starts at 05:00:00 UTC; local instants are 24-character ISO text, compared as text.
const limaStart=day=>`${day}T05:00:00.000Z`;
const LIMA_DAY=column=>`date(${column},'-5 hours')`;

/* The twin's sources, each usable only when every table it names exists. The activity kinds follow C2 as
   metrics_member_days does, except the profile kind: SQLite has no onboarding_responses, so it reads users.updated_at
   (approximate: the users_updated_at trigger also moves it on a staff Founder grant), and pilot_feedback 'profile'
   rows are not read. */
const ACTIVITY=[
 {tables:['users'],sql:"SELECT id AS user_id,'profile' AS kind,updated_at AS at FROM users"},
 {tables:['follows'],sql:"SELECT user_id,'network',created_at FROM follows"},
 {tables:['interactions'],sql:"SELECT from_user_id,'network',created_at FROM interactions WHERE type='skip'"},
 {tables:['pilot_feedback'],sql:"SELECT user_id,'network',created_at FROM pilot_feedback WHERE action='matching'"},
 {tables:['catalog_interests'],sql:"SELECT user_id,'opportunities',created_at FROM catalog_interests"},
 {tables:['catalog_interests'],sql:"SELECT user_id,'opportunities',updated_at FROM catalog_interests WHERE updated_by=user_id"},
 {tables:['fiiu_registrations'],sql:"SELECT user_id,'festival',created_at FROM fiiu_registrations"},
 {tables:['fiiu_attendance','fiiu_registrations'],sql:"SELECT r.user_id,'festival',a.created_at FROM fiiu_attendance a JOIN fiiu_registrations r ON r.id=a.registration_id WHERE a.method='qr'"},
 {tables:['fiiu_messages'],sql:"SELECT user_id,'festival',created_at FROM fiiu_messages WHERE organiser=0"},
 {tables:['fiiu_message_likes'],sql:"SELECT user_id,'festival',created_at FROM fiiu_message_likes"},
 {tables:['fiiu_ratings'],sql:"SELECT user_id,'festival',created_at FROM fiiu_ratings"},
 {tables:['fiiu_ratings'],sql:"SELECT user_id,'festival',updated_at FROM fiiu_ratings"},
 {tables:['course_events'],sql:"SELECT user_id,'courses',created_at FROM course_events"},
 {tables:['course_posts'],sql:"SELECT user_id,'courses',created_at FROM course_posts WHERE staff=0"},
 {tables:['course_survey_responses'],sql:"SELECT user_id,'courses',created_at FROM course_survey_responses"},
 {tables:['course_survey_responses'],sql:"SELECT user_id,'courses',submitted_at FROM course_survey_responses WHERE submitted_at IS NOT NULL"},
 {tables:['pilot_feedback'],sql:"SELECT user_id,'courses',created_at FROM pilot_feedback WHERE action NOT IN ('profile','matching')"},
 {tables:['membership_acceptances'],sql:"SELECT user_id,'membership',accepted_at FROM membership_acceptances"},
];
const KINDS=['profile','network','opportunities','festival','courses','membership'];
// Dated series per Lima day, every row (the team's included), in the order metrics_member_days writes them.
const SERIES=[
 ['entered','users','created_at'],
 ['profileSaves',null,null], // production only: onboarding_responses has no SQLite twin
 ['follows','follows','created_at'],
 ['interests','catalog_interests','created_at',"status<>'withdrawn'"],
 ['registrations','fiiu_registrations','created_at'],
 ['acceptances','membership_acceptances','accepted_at'],
 ['founders','users','founder_since'],
 ['orgRequests','node_requests','created_at'],
];
// As the baseline (docs/ops/2026-11-14-metrics-baseline.sql): an account that exists and whose role is not admin.
const NOT_ADMIN=column=>`${column} IN (SELECT id FROM users WHERE role<>'admin')`;
const BIO="trim(COALESCE(json_extract(part_c_json,'$.bio'),''))<>''";
const NOW=[
 ['admins',['users'],"SELECT count(*) FROM users WHERE role='admin'"],
 ['basic',['users'],"SELECT count(*) FROM users WHERE trim(city)<>'' AND json_array_length(interests_json)>0"],
 ['city',['users'],"SELECT count(*) FROM users WHERE trim(city)<>''"],
 ['interests',['users'],'SELECT count(*) FROM users WHERE json_array_length(interests_json)>0'],
 ['bio',['users'],`SELECT count(*) FROM users WHERE ${BIO}`],
 ['assessed',['users'],'SELECT count(*) FROM users WHERE assessed=1'],
 ['directory',['users'],"SELECT count(*) FROM users WHERE account_status='active' AND json_type(part_c_json,'$.consent')='true'"],
 ['acceptors',['membership_acceptances'],'SELECT count(DISTINCT user_id)+count(*) FILTER (WHERE user_id IS NULL) FROM membership_acceptances'],
 ['unbadged',['membership_acceptances','users'],`SELECT count(DISTINCT a.user_id) FILTER (WHERE u.founder_since IS NULL AND a.user_id IS NOT NULL)
  +count(*) FILTER (WHERE a.user_id IS NULL) FROM membership_acceptances a LEFT JOIN users u ON u.id=a.user_id`],
 ['interestsNew',['catalog_interests'],"SELECT count(*) FROM catalog_interests WHERE status='new'"],
 ['orgRequestsNew',['node_requests'],"SELECT count(*) FROM node_requests WHERE status='new'"],
 ['learners',['course_enrollments'],`SELECT count(DISTINCT user_id) FROM course_enrollments WHERE ${NOT_ADMIN('user_id')}`],
 ['openers',['course_events'],`SELECT count(DISTINCT user_id) FROM course_events WHERE ${NOT_ADMIN('user_id')}`],
 ['teamRegistrations',['fiiu_registrations'],"SELECT count(*) FROM fiiu_registrations WHERE user_id IN (SELECT id FROM users WHERE role='admin')"],
];

function sqliteMemberDays(db,today){
 const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 const has=tables=>tables.every(t=>present.has(t));
 const days={};
 for(const [key,table,column,where] of SERIES){
  days[key]=table&&has([table])?db.prepare(`SELECT ${LIMA_DAY(column)} AS day,count(*) AS n FROM ${table}
   WHERE ${column} IS NOT NULL${where?` AND ${where}`:''} GROUP BY 1 ORDER BY 1`).all().map(r=>[r.day,r.n]):[];
 }
 const now={};
 for(const [key,tables,sql] of NOW)now[key]=has(tables)?Object.values(db.prepare(sql).get())[0]:0;
 const active={d7:{members:0,...Object.fromEntries(KINDS.map(k=>[k,0]))},d30:{members:0,...Object.fromEntries(KINDS.map(k=>[k,0]))}};
 const sources=ACTIVITY.filter(s=>has(s.tables)).map(s=>s.sql);
 if(sources.length&&present.has('users')){
  const t7=limaStart(shift(today,-6)),t30=limaStart(shift(today,-29)),te=limaStart(shift(today,1));
  const row=db.prepare(`WITH hits(user_id,kind,at) AS (${sources.join(' UNION ALL ')}),
   member_hits AS (SELECT user_id,kind,at>=? AS in7 FROM hits WHERE at>=? AND at<? AND user_id IS NOT NULL AND ${NOT_ADMIN('user_id')})
   SELECT count(DISTINCT user_id) FILTER (WHERE in7) AS d7_members,count(DISTINCT user_id) AS d30_members,
   ${KINDS.map(k=>`count(DISTINCT user_id) FILTER (WHERE in7 AND kind='${k}') AS d7_${k},count(DISTINCT user_id) FILTER (WHERE kind='${k}') AS d30_${k}`).join(',')}
   FROM member_hits`).get(t7,t30,te);
  for(const w of ['d7','d30'])for(const k of ['members',...KINDS])active[w][k]=row[`${w}_${k}`];
 }
 const countries=has(['fiiu_registrations'])?db.prepare(`SELECT text,count(*) AS n FROM
  (SELECT trim(COALESCE(json_extract(answers,'$.country'),'')) AS text FROM fiiu_registrations) GROUP BY text ORDER BY n DESC,text`).all().map(r=>[r.text,r.n]):[];
 return {v:1,days,now,active,lists:{countries}};
}

export function createMetricsStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)db.exec(METRICS_READINGS_SQLITE_SCHEMA);
 // No timeout of its own: the caller's signal reaches rest (which falls back to 15 s without one).
 const supa=db?null:clients??createSupabaseClients({env,fetchImpl});
 const checked=(part,value)=>validPart(part,value)?value:unavailable(part);
 return {
  kind:db?'sqlite':'supabase',
  async accountDays({signal}={}){
   if(db)return {v:1,days:db.prepare(`SELECT ${LIMA_DAY('created_at')} AS day,count(*) AS n FROM users GROUP BY 1 ORDER BY 1`).all().map(r=>[r.day,r.n,r.n])};
   return checked('accounts',await supa.admin.rest('rpc/metrics_account_days',{method:'POST',body:{},signal}));
  },
  async memberDays(today,{signal}={}){
   if(typeof today!=='string'||!DAY.test(today))fail('invalid metrics day');
   if(db)return sqliteMemberDays(db,today);
   return checked('members',await supa.admin.rest('rpc/metrics_member_days',{method:'POST',body:{p_today:today},signal}));
  },
  // First write wins: true only when this call stored the day's row.
  async saveReading(day,at,figures,defs){
   if(db)return db.prepare('INSERT OR IGNORE INTO metrics_readings (day,taken_at,defs,figures) VALUES (?,?,?,?)').run(day,at,defs,JSON.stringify(figures)).changes===1;
   const rows=await supa.admin.rest('metrics_readings',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:[{day,taken_at:at,defs,figures}]});
   if(!Array.isArray(rows))unavailable('readings');
   return rows.length>0;
  },
  // Oldest first. The Data API cuts a table read at the project's row cap with no error, so it pages by day until an
  // empty page (as server/fiiu-repository.js scans).
  async readings({signal}={}){
   if(db)return db.prepare('SELECT day,taken_at,defs,figures FROM metrics_readings ORDER BY day').all().map(r=>{
    // A cell that is not a JSON object fails the read as the Data API would, never as a bare SyntaxError.
    let figures;
    try{figures=JSON.parse(r.figures);}catch{figures=null;}
    if(figures===null||typeof figures!=='object'||Array.isArray(figures))unavailable('readings');
    return {day:r.day,takenAt:r.taken_at,defs:r.defs,figures};
   });
   const out=[];
   for(let cursor=null;;){
    const page=await supa.admin.rest('metrics_readings',{query:{select:'day,taken_at,defs,figures',order:'day.asc',limit:PAGE,...(cursor?{day:`gt.${cursor}`}:{})},signal});
    if(!Array.isArray(page))unavailable('readings');
    if(!page.length)return out;
    for(const r of page)out.push({day:r.day,takenAt:r.taken_at,defs:r.defs,figures:r.figures});
    cursor=page.at(-1).day;
   }
  },
 };
}
