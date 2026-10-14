# FIIU closing party, editable programme, General space and ratings: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the closing-party block (register only), organiser-editable programme details, a one-off party announcement email, a festival-wide General conversation space and 1–10 rating questions.

**Architecture:** A new `server/fiiu-programme.js` merges organiser edits (table `fiiu_programme`) over the built-in `FIIU_EVENT` and memoises the result per instance for 30 s; every programme reader switches to it. The party is a new built-in block with a new registration kind, `social`, which every check-in and hours path already excludes. One-off notices reuse the summary-email claim-and-send pattern on a new `fiiu_notices` table. General is a pseudo-block id `general` in the existing conversation tables; ratings add `kind` and `rating_counts` to questions, a `fiiu_ratings` table, a counting trigger and a `set_fiiu_rating` RPC.

**Tech Stack:** Node (zero-dependency server, `node --test`), node:sqlite locally, Supabase PostgREST in production, vanilla browser JS in IIFEs under a strict CSP.

**Spec:** `docs/superpowers/specs/2026-10-13-fiiu-programme-general-design.md` (read it with this plan).

## Global Constraints

- Browser code: vanilla JS in IIFEs, no modules, no inline style or script, no `blob:`, `img-src 'self' data:`. Style changes go through classes or CSSOM writes (`el.style.x=`), never `style=""` attributes.
- Every user-facing string exists in EN, ES and PT (`[en, es, pt]` rows). Festival pages add strings with `Object.assign(Fiiu.rows,{...})` in their own file; `tests/deploy.test.js` reads those blocks.
- Touch targets at least 44×44 px on coarse pointers; no horizontal page scroll at 360 px; no thick left accent bars; reuse the `fiiu.css` `--f-sp-*` density scale.
- Server code never exposes user ids in festival conversation answers; scores are only ever exposed as totals and the person's own score.
- Never print secrets; never touch production; never run `supabase db push`; never `git push`.
- Do not bump `?v=` cache keys or edit `tests/deploy.test.js` pins (the integrator does it once).
- Tests first: each new test is run and seen failing before the code that makes it pass. `npm test` and `npx eslint . --max-warnings=0` pass at every commit.
- The migration `supabase/migrations/20261013120000_fiiu_programme_general.sql` is already written and verified on Postgres 15; do not change it without a test that shows why.

## Review Focus

1. **An edit that breaks check-in:** a conference block saved with a start-only time or an end before its start must be refused (`invalid_time`), or its check-in window and hours become wrong. Test in Task A2.
2. **The party leaking into check-in or hours:** a `social` block must never be in `CHECKIN_ACTIVITIES`, never accepted by `/api/fiiu/checkin` or the staff attendance PUT, never counted by `attendanceHours`, even when someone registered for it. Test in Task A1.
3. **Two organisers or a double click on "Announce the party":** nobody may get two announcements; concurrent batches must each claim distinct people. Test in Task A5.
4. **A rating from someone who may not post** (no registration, hidden question, closed question, chat question, score 0/11/"8"/8.5): refused with the right code and no change to totals. Test in Task B3.
5. **Anonymity:** no answer (question read, `?since=`, organiser list, export, CSV) carries another person's score or a user id next to a score. Test in Task B3.

## Lanes and order

Four lanes run in parallel in separate worktrees, each with review and fixes, then the integrator merges them:

| Lane | Owns | Tasks |
|---|---|---|
| A: server programme, party, notices | `server/fiiu-domain.js`, `server/fiiu-programme.js` (new), `server/fiiu-api.js`, `server/fiiu-repository.js`, `server/fiiu-email.js`, `server/fiiu-confirmations.js`, `server/fiiu-notices.js` (new), `server/server.js`, `scripts/build-privacy-page.js` + regenerated `web/pages/privacy.html`, `docs/implementation/fiiu-2026.md`, their tests | A1–A7 |
| B: server General and ratings | `server/fiiu-talk-domain.js`, `server/fiiu-talk-api.js`, `server/fiiu-talk-repository.js`, `tests/fiiu-talk-*.test.js`, `tests/fiiu-talk-postgres.test.js` | B1–B4 |
| C: organiser panel | `web/scripts/fiiu-admin.js`, organiser CSS appended at the very end of `web/styles/fiiu.css` under `/* Organiser: programme, party announcement, ratings */`, `tests/fiiu-admin-ui.test.js` | C1–C4 |
| D: participant pages | `web/scripts/fiiu.js`, `web/scripts/fiiu-ui.js`, `web/scripts/fiiu-hubs.js`, `web/scripts/fiiu-talk.js`, `web/styles/fiiu-talk.css`, `web/styles/fiiu.css` (not its last block), `tests/fiiu-ui.test.js`, `tests/fiiu-talk-ui.test.js`, `tests/fiiu-hubs*.test.js`, `tests/language-ui.test.js` | D1–D4 |

`tests/helpers/fiiu-ui-harness.js` may receive additive changes from C and D only. Lanes C and D build against the API contracts below and stub them in harness tests; lanes A and B implement them.

## API contracts (shared by all lanes)

**Programme block shape** (in `event.activities` from `GET /api/fiiu` and `GET /api/admin/fiiu/config`): the existing fields plus `description` (string, may be empty) and `edited` (boolean). The party:

```js
{id:'closing-party',date:'2026-10-25',period:'party',registration:'social',
 title:'¡Fiesta de cierre y Chelas Urbanas!',time:'17:00',
 venue:'La Vermut Bar, Av. Francisco Bolognesi 235, Barranco 15063',
 sessions:[['17:00–19:00','Chelas Urbanas'],['19:00 en adelante','Fiesta de cierre']],description:'',edited:false}
```

`time` is `''` (untimed), `'HH:MM'` (start only; only for `social` and `external`) or `'HH:MM–HH:MM'` (en dash). `config` no longer has `partyUrl`.

**Organiser programme routes** (organisers only, same-origin writes):
- `GET /api/admin/fiiu/programme` → `200 {activities:[{...block, version, original:{title,date,time,venue,description,sessions,formUrl?}, checkedIn}]}`, where `version` is 0 for an unedited block and `checkedIn` is that block's attendance count (0 for blocks without check-in).
- `PUT /api/admin/fiiu/programme/:id` with `{title,date,time,venue,description,sessions:[[time,title],...],formUrl?,version}` → `200 {activity}` (same item shape); `409 {error,code:'programme_conflict',activity}` (the current item) on an old version; `400 {error,code}` with `code` one of `invalid_title`, `invalid_date`, `invalid_time`, `invalid_venue`, `invalid_description`, `invalid_sessions`, `invalid_form_url`; `404` for an unknown id.
- `DELETE /api/admin/fiiu/programme/:id?version=n` → `200 {activity}` (built-in values, `version:0`, `edited:false`); `409` as above.

**Party notice routes** (organisers only):
- `GET /api/admin/fiiu/notices/closing-party` → `200 {configured, counts:{waiting,pending,sent,failed,uncertain,skipped}, dailyCap, sentToday, resetsAt}`. `waiting` = registrations without the party in their plan and without a notice row.
- `POST /api/admin/fiiu/notices/closing-party` with `{retryFailed?:boolean, after?:id}` → `200 {sent,failed,uncertain,skipped,claimedElsewhere,next,dailyCap,sentToday,resetsAt,counts}` (`next` null when the pass is done); `429 {code:'daily_cap',dailyCap,sentToday,resetsAt,counts,sent,failed,uncertain,skipped,claimedElsewhere}` (what the batch sent before it reached the cap; zeros when it sent nothing); `503 {code:'email_not_configured'}`.

**Conversations:**
- `activityId:'general'` is accepted wherever a block id is. `GET /api/fiiu/questions?activityId=general` answers `activity:{id:'general',period:'general',title:'FIIU General',date:null,time:'',venue:'',sessions:[],registration:'general-space'}`.
- Question views gain `kind` (`'chat'` or `'rating'`) and, for ratings, `ratingCounts` (ten integers, index 0 = score 1). `?since=` answers carry them on the question.
- The full question read (`GET /api/fiiu/questions/:id`) adds `me.score` (integer 1–10 or `null`) for rating questions.
- `PUT /api/fiiu/questions/:id/rating` with `{score}` → `200 {score, ratingCounts, revision}`; `400 {code:'invalid_score'}`, `400 {code:'not_rating'}`, `409 {code:'question_closed'}`, `403 {code:'not_registered'}`, `404` for a question the person cannot see.
- `POST /api/admin/fiiu/questions` accepts `kind` (default `'chat'`); `PATCH` with a different `kind` → `400 {code:'kind_locked'}`. Organiser question lists carry `kind` and `ratingCounts`.

---

## Lane A: server programme, party and notices

### Task A1: The party block and the `social` registration kind

**Files:** Modify `server/fiiu-domain.js`; Test `tests/fiiu-domain.test.js` (create if absent, else the existing domain test file).

**Interfaces:** Produces `FIIU_EVENT.activities` including the party; `REGISTERED_KINDS=['general','social']`; `canAttend` refuses `social`.

- [ ] **Step 1: failing tests**

```js
test('the closing party is a register-only block: never checked in, never counted, valid alone in a registration',()=>{
 const party=FIIU_EVENT.activities.find(a=>a.id==='closing-party');
 assert.deepEqual({date:party.date,registration:party.registration,time:party.time,period:party.period},{date:'2026-10-25',registration:'social',time:'17:00',period:'party'});
 assert.equal(party.title,'¡Fiesta de cierre y Chelas Urbanas!');assert.match(party.venue,/La Vermut Bar, Av\. Francisco Bolognesi 235, Barranco 15063/);
 assert.equal(isCheckinActivity(party),false);assert.equal(CHECKIN_ACTIVITIES.some(a=>a.id==='closing-party'),false);
 assert.equal(canAttend({answers:{activities:['closing-party']}},party),false);
 assert.deepEqual(attendanceHours([{activityId:'closing-party'}]),{minutes:0,hours:0,untimed:[]});
 const answers=normalizeRegistration({...validInput,activities:['closing-party'],externalActivities:[],applyLab:false});assert.deepEqual(answers.activities,['closing-party']);
 assert.equal(normalizeRegistration({...validInput,activities:['day1-am','day1-pm','day2-am','day2-pm','day3-am','closing-party']}).activities.length,6);
});
```
(`validInput` is the smallest valid registration body the existing tests use; reuse their helper.)

- [ ] **Step 2:** run `node --test tests/fiiu-domain.test.js`; expect failures (no party).
- [ ] **Step 3: implement.** Add the party object (API contract above, without `description`/`edited`) to `FIIU_EVENT.activities` after the last conference block and before `...externalActivities`. Export `REGISTERED_KINDS`. In `normalizeRegistration`, accept ids whose `registration` is in `REGISTERED_KINDS`, limit 6. In `canAttend`, return `false` for `social`. Leave `isCheckinActivity` as is (it already lists only `general` and `application`).
- [ ] **Step 4:** the summary: `store.summary(EVENT_ID,activities)` matches selections tagged `'general'` against the catalogue's `registration`, so pass the party as `'general'` in the catalogue built in `fiiu-api.js` (`registration:a.registration==='social'?'general':a.registration`). Test: the organiser summary counts a party registration (`activities[].registrations` for `closing-party` is 1 after one registration with it).
- [ ] **Step 5:** run the suite, commit: `Add the closing party as a register-only block`.

### Task A2: Programme edit rules

**Files:** Modify `server/fiiu-domain.js`; Test the domain test file.

**Interfaces:** Produces `canonicalTime(value)` and `normalizeProgrammeEdit(activity,input,event=FIIU_EVENT)` returning `{title,date,time,venue,description,sessions,formUrl?}`; refusals throw an Error with `status:400` and `code`.

- [ ] **Step 1: failing tests** covering each rule from the spec table:
  - title: `''`, 201 code points, a newline → `invalid_title`; surrounding spaces trimmed.
  - date: `'2026-10-19'`, `'2026-10-26'`, `'2026-02-30'`, `'25/10/2026'` → `invalid_date`; `'2026-10-20'` and `'2026-10-25'` pass.
  - time: `canonicalTime('9:00')` → null; `'09:00-13:00'` → `'09:00–13:00'`; `'13:00–09:00'` → null; `'17:00'` → `'17:00'`; `''` → `''`. A conference block with `'17:00'` → `invalid_time`; the party and a workshop with `'17:00'` pass; a conference block with `''` passes (untimed, like the lab).
  - venue: 201 code points or a newline → `invalid_venue`.
  - description: 1,501 code points → `invalid_description`; `\r\n` becomes `\n`; C0 controls other than `\n` and `\t` removed; trimmed.
  - sessions: not an array, 13 lines, a line that is not a 2-item array, an empty title, a 41-character time → `invalid_sessions`.
  - formUrl: required `https://` for `registration:'external'` (`http://x` → `invalid_form_url`); ignored (not returned) for other kinds.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3: implement** (helpers local to `fiiu-domain.js`):

```js
const CLOCK=/^([01]\d|2[0-3]):([0-5]\d)$/,minutes=t=>{const m=CLOCK.exec(t);return m?Number(m[1])*60+Number(m[2]):null;};
export function canonicalTime(value){
 if(value===undefined||value===null)return '';if(typeof value!=='string')return null;
 const parts=value.trim().split(/\s*[–-]\s*/);if(parts.length===1&&!parts[0])return '';
 if(parts.length===1)return minutes(parts[0])===null?null:parts[0];
 if(parts.length!==2)return null;const [a,b]=parts.map(minutes);
 return a===null||b===null||a>=b?null:`${parts[0]}–${parts[1]}`;
}
const codeFail=code=>{throw Object.assign(new Error(code.replace(/_/g,' ')),{status:400,code});};
const visible=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').toWellFormed():value;
const oneLine=(value,max,code,required)=>{if(value!==undefined&&value!==null&&typeof value!=='string')codeFail(code);const v=visible(value??'').trim();if(/[\r\n]/.test(v)||[...v].length>max||(required&&!v))codeFail(code);return v;};
export function normalizeProgrammeEdit(activity,input={},event=FIIU_EVENT){
 const title=oneLine(input.title,200,'invalid_title',true),venue=oneLine(input.venue,200,'invalid_venue',false);
 const date=typeof input.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)&&!Number.isNaN(Date.parse(input.date+'T12:00:00Z'))&&new Date(input.date+'T12:00:00Z').toISOString().slice(0,10)===input.date&&input.date>=event.startsOn&&input.date<=event.endsOn?input.date:codeFail('invalid_date');
 const time=canonicalTime(input.time);if(time===null||(time&&!time.includes('–')&&!['social','external'].includes(activity.registration)))codeFail('invalid_time');
 if(input.description!==undefined&&input.description!==null&&typeof input.description!=='string')codeFail('invalid_description');
 const description=visible(String(input.description??'')).replace(/\r\n?/g,'\n').trim();if([...description].length>1500)codeFail('invalid_description');
 const raw=input.sessions??[];if(!Array.isArray(raw)||raw.length>12)codeFail('invalid_sessions');
 const sessions=raw.map(line=>{if(!Array.isArray(line)||line.length!==2)codeFail('invalid_sessions');return [oneLine(line[0],40,'invalid_sessions',false),oneLine(line[1],200,'invalid_sessions',true)];});
 const edit={title,date,time,venue,description,sessions};
 if(activity.registration==='external'){let formUrl;try{formUrl=httpsUrl(input.formUrl);}catch{codeFail('invalid_form_url');}if(!formUrl)codeFail('invalid_form_url');edit.formUrl=formUrl;}
 return edit;
}
```
- [ ] **Step 4:** run, pass; commit: `Validate organiser edits to programme blocks`.

### Task A3: Storage and the merged programme

**Files:** Create `server/fiiu-programme.js`; Modify `server/fiiu-repository.js`; Test `tests/fiiu-programme.test.js` (new).

**Interfaces:** Produces `mergeProgramme(rows,base=FIIU_EVENT)`, `createProgramme({store,ttlMs=30000,now})` → `{event(), rows(), clear()}`; store table `'programme'` with fields `['id','eventId','data','version','updatedBy','updatedAt']`, json `['data']`.

- [ ] **Step 1: failing tests:**
  - `mergeProgramme([])` keeps every block, adds `description:''` and `edited:false`; a row `{id:'day1-am',data:{title:'X',...},version:2}` replaces only the listed fields and sets `edited:true`; `formUrl` in a row is ignored for a non-external block; the event keeps every other key (`theme`, `calendarUrl`, …).
  - `createProgramme` reads the store once inside the TTL (count `store.find` calls with a fake clock), again after it, again after `clear()`; two concurrent `event()` calls share one read; a failed read with a previous value serves the previous value; a failed first read rejects.
  - The SQLite store creates `fiiu_programme` (same columns as the migration, `data` as JSON text) and round-trips insert/update/find/remove for `'programme'`.
- [ ] **Step 2:** run, see failures.
- [ ] **Step 3: implement** `fiiu-programme.js`:

```js
import {EVENT_ID,FIIU_EVENT} from './fiiu-domain.js';
export const PROGRAMME_FIELDS=['title','date','time','venue','description','sessions','formUrl'];
export function mergeProgramme(rows=[],base=FIIU_EVENT){
 const byId=new Map(rows.map(row=>[row.id,row]));
 return {...base,activities:base.activities.map(a=>{
  const row=byId.get(a.id),edit=row?Object.fromEntries(PROGRAMME_FIELDS.filter(k=>Object.hasOwn(row.data??{},k)&&(k!=='formUrl'||a.registration==='external')).map(k=>[k,row.data[k]])):{};
  return {...a,description:a.description??'',...edit,edited:Boolean(row)};
 })};
}
export function createProgramme({store,ttlMs=30000,now=()=>Date.now()}){
 let memo=null,last=null;
 const rows=()=>store.find('programme',{eventId:EVENT_ID},{limit:200});
 return {
  rows,clear(){memo=null;},
  event(){
   const t=now();if(memo&&t-memo.at<ttlMs)return memo.promise;
   const promise=rows().then(list=>(last=mergeProgramme(list)),err=>{if(memo?.promise===promise)memo=null;if(last)return last;throw err;});
   memo={at:t,promise};return promise;
  },
 };
}
```
Add the `fiiu_programme` SQLite table to `FIIU_SQLITE_SCHEMA` (`id TEXT PRIMARY KEY,event_id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,updated_at TEXT NOT NULL`) and `programme` to `TABLES`.
- [ ] **Step 4:** run, pass; commit: `Merge organiser programme edits over the built-in programme`.

### Task A4: Every reader uses the merged programme, and the programme routes

**Files:** Modify `server/fiiu-api.js`, `server/server.js`, `server/fiiu-email.js` (only if the summary email filters blocks by `registration==='general'`); Test `tests/fiiu-api.test.js` (or the existing festival API test file) and `tests/fiiu-programme.test.js`.

**Interfaces:** `createFiiuApi({...,programme})` (default `createProgramme({store})`); routes per the API contract.

- [ ] **Step 1: failing tests** (through the HTTP harness the festival API tests already use):
  - Organiser `PUT /api/admin/fiiu/programme/day1-am` with a new title and time `10:00–14:00` → 200; then `GET /api/fiiu` shows the new title, time and `edited:true`; `GET /api/admin/fiiu/checkin?activityId=day1-am` window follows the new time; a participant's hours for a check-in on `day1-am` become 4 h; the registration summary email built for that person shows the new title.
  - PUT with `version:0` on an edited block → 409 `programme_conflict` with the current item; PUT on an unknown id → 404; a non-organiser → 403; cross-origin → 403; each 400 code reaches the client.
  - `DELETE …?version=1` restores built-in values (`edited:false`, `version:0`).
  - `GET /api/admin/fiiu/programme` lists every block with `original`, `version` and `checkedIn`.
  - A save clears this instance's memo at once (the next `GET /api/fiiu` shows it without waiting 30 s).
  - The QR check-in (`POST /api/fiiu/checkin`) and the staff attendance PUT refuse `closing-party` (400 `invalid_activity` / 400 `participant is not registered for this activity`), even for someone with the party in their plan.
  - `GET /api/fiiu` and `GET /api/admin/fiiu/config` carry no `partyUrl`; a stored `partyUrl` is dropped by `normalizeConfig`.
- [ ] **Step 2:** run, see failures.
- [ ] **Step 3: implement.**
  - In `fiiu-api.js` add `const live=async()=>{const event=await programme.event();return {event,all:[...event.activities,...LEGACY_FIIU_ACTIVITIES],checkin:event.activities.filter(isCheckinActivity)};};` and use it for: the public and admin event payloads, check-in (`checkin` list and `checkinWindow`), every `attendanceHours(…, all)` call, the export's block columns and day lookup, the summary catalogue, and the summary email (`registrationEmail({...,event})` through `deliverConfirmation`'s `config` path: pass the merged event down; add an `event` parameter where needed).
  - Programme routes: `PUT` reads the current row (`store.find('programme',{id,eventId},{limit:1})`), checks `version` (0 means no row), normalises with `normalizeProgrammeEdit(builtInActivity,input,FIIU_EVENT)`, then `insert` (version 1) or `update({id,eventId,version:expected},{data,version:expected+1,updatedBy:user.id,updatedAt})`; a lost race (insert 409, update null) answers 409 with the current item; then `programme.clear()`. `DELETE` removes `{id,eventId,version}`; 0 rows → 409.
  - `server.js`: create one `programme=createProgramme({store:fiiuStore})` and pass it to `createFiiuApi` and `createTalkApi` (`programme` option; lane B adds it).
  - Remove `partyUrl` from `DEFAULT_CONFIG`.
- [ ] **Step 4:** run, pass; commit: `Serve the merged programme everywhere and let organisers edit it`.

### Task A5: The party announcement

**Files:** Create `server/fiiu-notices.js`; Modify `server/fiiu-repository.js`, `server/fiiu-confirmations.js` (`sentSince`), `server/fiiu-email.js`, `server/fiiu-api.js`, `server/server.js`; Test `tests/fiiu-notices.test.js` (new).

**Interfaces:** store table `'notices'` (`['id','eventId','userId','kind','status','language','sentAt','createdAt','updatedAt']`); `partyEmail({event,language,origin})` → `{subject,text,html}`; `createPartyNotice({env,transport,origin,loopbackOnly,log})` → `async ({registration,event,language})=>({status,sentAt?})` or null, with the same gating as `createRegistrationConfirmation` (share the gating in one helper rather than copying it); `noticeState(store,{dailyCap,now})`; `sendNoticeBatch({store,notify,event,retryFailed,after,size,dailyCap,now})`.

- [ ] **Step 1: failing tests:**
  - Eligibility: registrations without `closing-party` in `answers.activities` and with no notice row; a registration with the party is never sent; a person already `sent`/`pending`/`uncertain`/`skipped` is never sent again; reserved test domains become `skipped`.
  - Claim before send: a notice row `pending` with `sentAt` = attempt time exists while `notify` runs; two concurrent `sendNoticeBatch` calls over the same registrations send each person exactly once (`claimedElsewhere` counts the losers).
  - Outcomes: `sent` keeps the provider time; `uncertain` keeps the attempt time; `failed` clears `sentAt`; `retryFailed` sends only `failed` rows, claimed with a compare-and-set `failed→pending`.
  - Shared cap: confirmations and notices together never exceed `dailyCap` in a UTC day (`sentSince` counts both); a capped batch answers `capped` without sending.
  - Content: `partyEmail` in `es`, `en` and `pt` names the merged party title, date, both session lines, the venue and links to `${origin}/fiiu.html#add-closing-party`; an edited party title shows in the email.
  - Routes: GET state and POST batch per the contract; organisers only; `503 email_not_configured` without a sender; `429 daily_cap`.
- [ ] **Step 2:** run, see failures.
- [ ] **Step 3: implement** following `sendConfirmationBatch` and `deliverConfirmation` line by line (same cursor, cap and outcome-write rules), with these differences: candidates come from registrations paged by id after the cursor, skipping those with the party in their plan; the claim is `store.insert('notices',{id:randomUUID(),eventId,userId:registration.userId,kind:'closing-party',status:'pending',language,sentAt:attemptAt,createdAt,updatedAt})`, where a 409 means claimed elsewhere; a batch keeps paging until it has `room` claims or reaches the end. Add the SQLite table (same columns as the migration, `UNIQUE(event_id,user_id,kind)`). `sentSince` adds `store.count('notices',{eventId:EVENT_ID},{atLeast:{sentAt:since},oneOf:{status:ATTEMPTED}})`.
- [ ] **Step 4:** run, pass; commit: `Announce the closing party once to everyone who has not added it`.

### Task A6: Data export, deletion and privacy

**Files:** Modify `server/fiiu-api.js` (`exportFiiuData`), `scripts/build-privacy-page.js`, regenerate `web/pages/privacy.html`; Test the export and privacy tests.

- [ ] **Step 1: failing tests:** `exportFiiuData` returns the person's notices (`kind`, `status`, `sentAt`); deleting a profile in SQLite removes their notices and nulls `updated_by` on programme rows; the privacy page (EN/ES/PT) contains the two new sentences below.
- [ ] **Step 2–4:** implement; add to the privacy page's FIIU section:
  - EN: "Rating answers are stored with your account so you can change them, and are only ever shown as anonymous totals." / ES: "Las valoraciones se guardan con tu cuenta para que puedas cambiarlas, y solo se muestran como totales anónimos." / PT: "As avaliações são guardadas com a sua conta para que você possa alterá-las, e só aparecem como totais anônimos."
  - EN: "We record one-off festival notices sent to you, so nobody receives the same one twice." / ES: "Registramos los avisos puntuales del festival que te enviamos, para que nadie reciba el mismo dos veces." / PT: "Registramos os avisos pontuais do festival enviados a você, para que ninguém receba o mesmo duas vezes."
  Run `node scripts/build-privacy-page.js`; commit: `Export notices and describe ratings and notices in the privacy policy`.

### Task A7: Documentation

- [ ] Update `docs/implementation/fiiu-2026.md`: the programme editor (fields, rules, 30 s propagation, hours follow edits), the party (social, register only), the announcement (claim, cap), General, ratings (trigger, RPC, anonymity), and the release order with the migration. Commit: `Document the programme editor, party, General and ratings`.

---

## Lane B: server General space and ratings

### Task B1: The General space

**Files:** Modify `server/fiiu-talk-domain.js`, `server/fiiu-talk-api.js`; Test `tests/fiiu-talk-api.test.js`, `tests/fiiu-talk-domain.test.js` (or wherever `normalizeQuestion` is tested).

**Interfaces:** `GENERAL_SPACE` constant; `talkActivity(id,event=FIIU_EVENT)` returns it for `'general'`; `createTalkApi({...,programme={event:async()=>FIIU_EVENT}})`.

- [ ] **Step 1: failing tests:** an organiser creates a question with `activityId:'general'` (and `talk` must be null: any talk → `invalid_talk`); `GET /api/fiiu/questions?activityId=general` answers the General activity view and the question for a registered participant and for an organiser without a registration; a signed-in person without a registration gets the same refusal as on a block; the pulse lists the question with activity id `general`; a participant posts a message there; the question CSV names the block "FIIU General".
  - Activity views come from the injected programme: with a programme whose `day1-am` title is edited, `GET /api/fiiu/questions?activityId=day1-am` shows the edited title.
- [ ] **Step 2–4:** implement; `activityView` is built from `(await programme.event())` for blocks and from `GENERAL_SPACE` for General; commit: `Add a festival-wide General conversation space`.

### Task B2: Question kinds in the stores

**Files:** Modify `server/fiiu-talk-repository.js` (SQLite schema and Supabase adapter), `server/fiiu-talk-domain.js` (`normalizeQuestion`, `questionView`); Test the talk repository and API tests.

**Interfaces:** questions gain fields `kind`, `ratingCounts`; `insertQuestion` writes `ratingCounts:Array(10).fill(0)` for ratings and `null` for chat; `normalizeQuestion(raw,current)` returns `kind` (create: `'chat'` default, `'rating'` allowed, anything else → `invalid_kind`; edit: a different kind → `kind_locked`).

- [ ] **Step 1: failing tests:** create a rating question (organiser POST with `kind:'rating'`) → the view has `kind:'rating'`, `ratingCounts:[0,…,0]`; chat questions have `kind:'chat'` and no `ratingCounts`; PATCH with another kind → 400 `kind_locked`; PATCH of body/status still works on a rating question; organiser lists and `?since=` carry `kind` and `ratingCounts`.
- [ ] **Step 2–4:** SQLite: add `kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat','rating'))` and `rating_counts TEXT` (JSON) to `fiiu_questions` in the schema and through `addColumn` for old local databases; a trigger refusing a kind change (`BEFORE UPDATE OF kind … RAISE(ABORT,'question type cannot change')`). Supabase: add the two columns to the selected fields (they exist after the migration). Commit: `Give conversation questions a type: conversation or rating`.

### Task B3: Rating answers

**Files:** Modify `server/fiiu-talk-repository.js`, `server/fiiu-talk-api.js`; Test `tests/fiiu-talk-api.test.js`, `tests/fiiu-talk-repository.test.js` (if present).

**Interfaces:** store `setRating(questionId,userId,score,at)` → `{ratingCounts,revision}` (throws `Object.assign(Error,{code:'question_closed'|'not_rating'|'question_unavailable'})`); `ratingOf(questionId,userId)` → score or null; `userRatings(userId)` → `[{questionId,score,updatedAt}]`; `removeUserRatings(userId)`.

- [ ] **Step 1: failing tests** (Review Focus 4 and 5):
  - A registered participant rates 8 → `{score:8,ratingCounts:[0,0,0,0,0,0,0,1,0,0]}` and the question revision moved; rating 8 again changes nothing (same revision); rating 3 moves the count; a second person's 8 adds to it.
  - The full question read answers `me.score` (8, then 3); another person's read answers `me.score:null` and the same totals.
  - Refusals with no change to totals: no registration → 403 `not_registered`; a chat question → 400 `not_rating`; closed → 409 `question_closed`; hidden (participant) → 404; `score` 0, 11, `"8"`, 8.5, missing → 400 `invalid_score`; cross-origin → 403; over the like rate budget → 429.
  - Anonymity: no answer (question read, since, organiser list, CSV, pulse) contains a user id or a per-person score other than the reader's own `me.score`.
  - Account deletion (SQLite) removes the person's ratings and their totals drop; `exportTalkData` includes the person's ratings (question text, score, date); `deleteTalkData` removes them.
- [ ] **Step 2:** run, see failures.
- [ ] **Step 3: implement.** SQLite: `fiiu_ratings` (as the migration, JSON-free) plus triggers on insert/update/delete that rewrite `rating_counts` (JSON array) and bump `revision` exactly as the Postgres trigger does; `setRating` runs in one transaction that checks the question (exists, `kind='rating'`, `status='open'`) then upserts with `ON CONFLICT(question_id,user_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at WHERE score<>excluded.score`, and reads back `rating_counts, revision`. Supabase: `supa.admin.rest('rpc/set_fiiu_rating',{method:'POST',body:{p_question_id,p_user_id,p_score,p_at}})` → first row `{counts,rev}`; map errors by SQLSTATE `PFR01`→`question_unavailable` (404), `PFR02`→`not_rating`, `PFR03`→`question_closed`. Route `PUT /api/fiiu/questions/:id/rating` uses the same access and rate-limit path as likes (`kindOf` 'like'), and clears the pulse memo after a write, like other writes.
- [ ] **Step 4:** run, pass; commit: `Let registered people rate 1–10 questions anonymously`.

### Task B4: Postgres check of the migration

**Files:** Modify `tests/fiiu-talk-postgres.test.js` (opt-in, skipped without `NODAL_FIIU_TALK_TEST_DATABASE_URL`).

- [ ] Add `20261013120000_fiiu_programme_general` to `migrations`; extend the test: RLS on and no browser privileges for `fiiu_programme`, `fiiu_notices`, `fiiu_ratings` and the three new functions; `set_fiiu_rating` as `service_role` moves totals and revision, is a no-op for the same score, refuses closed (`PFR03`), chat (`PFR02`), missing (`PFR01`); a kind change raises `PFR04`; deleting a profile as `supabase_auth_admin` removes the score from the totals.
- [ ] Run it against a disposable database on the local Postgres at `127.0.0.1:54329` (user `postgres`): `createdb -h 127.0.0.1 -p 54329 -U postgres nodal_fiiu_test_b<n>`, run with `NODAL_FIIU_TALK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/nodal_fiiu_test_b<n>`, then `dropdb`. Commit: `Check the programme, notices and ratings migration on PostgreSQL`.

---

## Lane C: organiser panel (`web/scripts/fiiu-admin.js`)

### Task C1: The Programme section

**Interfaces:** consumes the organiser programme routes; strings added in `fiiu-admin.js`'s own `Object.assign` block.

- [ ] **Step 1: failing harness tests** (stubbing `/api/admin/fiiu/programme`):
  - The section menu lists "Programme" between "Registration and links" and "Conversations"; `#programme` reaches it.
  - Rows grouped by day in time order, each with time (or "Untimed"/"From 17:00"), title, kind label (Conference, Lab, Party, Workshop, Route) and an "Edited" pill for `edited:true`.
  - Edit opens one form under the row with the fields of the spec; the end time is optional only for party, workshop and route rows; the date input has `min="2026-10-20"` and `max="2026-10-25"`; session lines can be added (up to 12), removed and moved; workshops and routes show the form link field.
  - Save sends `PUT` with every field and the version, shows "Changes saved", updates the row (Edited pill) and closes the form; each 400 `code` shows its message next to the form and keeps the typed values.
  - 409 shows "Reload the latest version"; reloading takes the server's item but keeps fields the organiser changed since opening.
  - "Restore original" asks first, sends `DELETE …?version=`, and shows the built-in values.
  - A conference or lab row with `checkedIn>0` shows the hours warning when its date or time changed in the form; opening another row with unsaved changes asks first; leaving the page with unsaved changes triggers the existing `beforeunload` guard.
  - Strings in EN/ES/PT; on a 375 px harness width every control is reachable (no fixed widths over the column).
- [ ] **Step 2–4:** implement with the panel's existing helpers (`field`, `button`, `action`, `lockForm`, `localiseValidation`, conflict box pattern); commit: `Let organisers edit programme blocks from the panel`.

### Task C2: The party announcement block

- [ ] **Step 1: failing tests:** under the party's row, "Announce the party" shows waiting / sent / left today from `GET …/notices/closing-party`; the button asks for confirmation with the waiting number, then sends batch after batch (`POST` with the previous `next`) until `next` is null, showing progress; Stop stops after the current batch; `429 daily_cap` shows when it resets; failed rows get "Retry failed"; `503 email_not_configured` shows that email is off; nothing sends without confirmation.
- [ ] **Step 2–4:** implement by reusing the summary-email backfill controller in `fiiu-admin.js` (generalise it to take the endpoint and strings rather than copying it); commit: `Send the party announcement from the panel`.

### Task C3: Settings without the party link

- [ ] **Step 1: failing tests:** the settings form shows only the programme link; saving does not send `partyUrl`; the existing settings tests are updated accordingly.
- [ ] **Step 2–4:** implement; commit: `Drop the party link from organiser settings`.

### Task C4: General and rating questions in the Conversations section

- [ ] **Step 1: failing tests:**
  - The block picker starts with "General (whole festival)" (`activityId:'general'`).
  - The new-question form has a type choice (radio group: Conversation, Rating 1–10), default Conversation, sent as `kind`; an existing question shows its type and offers no way to change it.
  - A rating question row shows the average to one decimal, the number of people, a 1–10 bar strip (a list of ten counts with a text alternative) and "Download counts (CSV)" producing `score,count` rows 1–10 through the same download path the panel already uses; a rating question with no answers shows "No ratings yet".
  - The party appears in the per-block summary counts and in the participant block filter, and has no attendance checkbox.
- [ ] **Step 2–4:** implement; organiser CSS for this lane goes only in the last block of `fiiu.css`; commit: `Organise General and rating questions from the panel`.

---

## Lane D: participant pages

### Task D1: The party in the programme and registration (`fiiu.js`, `fiiu-ui.js`)

- [ ] **Step 1: failing tests:**
  - The "Closing party / separate registration" aside and the strings `party`, `partyHint`, `partyRegister`, `partyDetails` are gone.
  - The party appears on 25 Oct in time order with its venue, its two session lines and "From 17:00" (`timeLabel` in `fiiu-ui.js`: `'HH:MM'` → "From {time}" / "Desde las {time}" / "A partir das {time}"; ranges unchanged; `''` unchanged behaviour).
  - The registration form lists blocks with `registration` in `['general','social']`; the party has its own label ("Closing party · register only") and is counted apart from conference blocks in the status pills; `fiiu.html#add-closing-party` opens the registration (edit mode for an existing registrant) with the party ticked; saving sends it in `activities`.
  - Block descriptions show under the title as plain text with line breaks and clickable `https://` links (reuse the chat's linkify helper if it is in `fiiu-ui.js`, otherwise add one there), never as HTML.
- [ ] **Step 2–4:** implement; commit: `Show the closing party and block descriptions, and take party sign-ups in the NODAL registration`.

### Task D2: General entry points (`fiiu.js`, `fiiu-hubs.js`)

- [ ] **Step 1: failing tests:** a "General conversation" link (`fiiu-talk.html?a=general`) at the top of the programme on `fiiu.html` and in the console festival block, with the open-question count from the pulse like block links; hidden when the pulse lists no open General question; strings in three languages.
- [ ] **Step 2–4:** implement; commit: `Link the festival-wide General conversation from the festival page and the console`.

### Task D3: General on the chat page (`fiiu-talk.js`)

- [ ] **Step 1: failing tests:** `fiiu-talk.html?a=general` lists General questions with the heading "FIIU General" and no date line; a General question page shows "FIIU General" in its head and its back link returns to `?a=general`; the projector works for a General question.
- [ ] **Step 2–4:** implement; commit: `Open General questions on the chat page`.

### Task D4: The rating scale (`fiiu-talk.js`, `fiiu-talk.css`)

- [ ] **Step 1: failing tests:**
  - A `kind:'rating'` question shows a `role="radiogroup"` of ten buttons labelled 1–10 with `aria-checked`, and "1 = lowest, 10 = highest"; at 375 px two rows of five, each at least 44×44 px; on wide screens one row.
  - Before the person rates: no average or bars are rendered (even though `ratingCounts` is in the data).
  - Tapping 8 marks it at once and sends `PUT …/rating {score:8}`; the answer's totals replace the shown ones and the results appear ("Your rating: 8 · Average 7.6 from 42 people" with the bar strip and a text alternative); a failure restores the previous choice and shows the error; a second tap while saving queues the latest choice only.
  - A full read with `me.score` shows the results at once; `?since=` totals update the bars live without a re-render of the chat.
  - Closed: the scale is disabled and results show to people who rated; the chat below still works as on any question.
  - Projector for a rating question: the live average in large type, the bars and the count.
  - Keyboard: arrow keys move between numbers inside the radiogroup, Enter/Space choose.
- [ ] **Step 2–4:** implement with the existing like-style optimistic pattern; CSS in `fiiu-talk.css` (no left bars, `--f-sp-*` spacing); commit: `Let participants rate 1–10 questions and see the results after rating`.

---

## Integration (the orchestrator)

- [ ] Merge lanes A, B, C, D into `feature/fiiu-programme-general`; resolve conflicts (`fiiu.css`, the harness helper); run `npm test` and eslint.
- [ ] Bump `?v=` keys for every changed web asset on every page that loads it, and the `tests/deploy.test.js` pins.
- [ ] Seed the round-3 probe server with a General question, a rating question and an edited block; browser pass at 375 and 1280 as admin, ana, beto, carla and a guest: the party on the programme and in registration, the editor (edit, conflict, restore), the announcement (with a loopback mail transport), General, rating before/after, projector; no console errors, no sideways scroll, 44 px targets.
- [ ] Whole-branch review with adversarial verification; fix what it confirms.
- [ ] Both builds (plain and Vercel-production environment).
- [ ] Report to the user with the exact migration commands; nothing is pushed.
