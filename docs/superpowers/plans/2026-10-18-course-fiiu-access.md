# Course Access for FIIU Registrants: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FIIU Fest 11 registrants (registered before the end of 25 Oct, Lima) can join the closed "Curso Movilidad Nivel 2". The September group keeps its conversation, survey, certificates and any materials the teaching team ticks. Everyone else sees a "for Supporters" preview, and the plans stop promising free courses.

**Architecture:** One constant and helper module (`server/course-perks.js`) names the course, the festival, the FIIU deadline and the 1 Oct September boundary. `createApp` builds it from the FIIU store and hands it to the course API and the final survey. Every rule applies to that one course id. Only joining depends on `enrollmentOpen`. The cohort rules (posts, ticked items, survey, report) always hold. The client reads three new answer fields (`join`, `enrolled`, `perkCourse`). There is no database migration, and the JSONB `resources` column carries the new `septemberOnly` tick.

**Tech Stack:** Zero-dependency Node server (SQLite locally, Supabase PostgREST in production), vanilla JS clients under a strict CSP, `node --test`, eslint, Vercel (whose build runs the whole suite).

**Spec:** [docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md](../specs/2026-10-18-course-fiiu-access-design.md) (approved 18 Oct 2026, commit dc04465).

**How this plan was verified:** each task's tests and code were drafted test-first in an isolated worktree. The eight tasks were then replayed in order on a copy of `dc04465`. After every task the full suite and eslint pass: 1846, 1852, 1857, 1863, 1868, 1872, 1879, then 1880 tests, 0 failures, 6 skipped. `npm run build` and the Vercel-env build both pass on the final state. The patches below are exactly those commits, so applied in order they go in cleanly. If one does not apply, the branch has moved: stop and re-plan that task rather than editing around it.

**Deviation from the spec, deliberate:** the spec names one helper `september(row)`. The code splits it in two. `inSeptemberGroup(enrollment)` treats an unreadable date as *not* September, so that viewer gets the filtered view. `septemberPost(post)` treats an unreadable date as September, so the post stays hidden. Both fail closed. For staff, spec section 1 governs: staff get no `join` field, and the section 7 line that lists staff among the 403 cases only means staff cannot use the perk.

## Global Constraints

- **No migrations or switches:** no database migration, no change to `PILOT_MODE`, Stripe or billing. No production writes; the user pushes and deploys.
- **One course:** every rule applies only to course `72e3cc56-a506-4a1b-97b5-9333e8d283ca`. Other courses behave exactly as on `main`.
- **Dates:** FIIU registrations count if created before `2026-10-26T05:00:00Z`, the end of 25 Oct in Lima. The September group is enrolments and posts created before `2026-10-01T00:00:00Z`, a UTC instant. Dates are always compared with `Date.parse`, never as strings.
- **Joining:** only joining depends on `enrollmentOpen`. Posts, ticked items, the survey, certificates and the report keep the September boundary when enrolment is reopened.
- **Wording:** every member-facing string exists in EN, ES and PT, worded exactly as in spec sections 2 and 3.
- **Cache keys:** each changed client file gets a new `?v=` on every page that loads it, and `tests/deploy.test.js` pins them. `courses.js`, `pilot-i18n.js`, `teaching.js`, `i18n.js` and `i18n-dashboard.js` all move to `20261018a`.
- **Build gate:** both `npm run build` and the Vercel-env build pass:
  `env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://nodal.example DATA_BACKEND=supabase EMAIL_SMTP_URL='smtps://u:p@smtp.example.invalid:465' EMAIL_FROM='NODAL <a@example.org>' npm run build`.
- **Style:** match the surrounding compact vanilla JS. No new dependencies.

## Review Focus

These five inputs are the most likely to hurt a real person. Each is pinned by a test in the task that owns the code.

1. **Supabase timestamps around the deadline.** Supabase returns FIIU `created_at` as `…+00:00` with microseconds. A registration one microsecond after the deadline must not count. Task 1, `tests/course-perks.test.js`.
2. **Teaching-team replies under a September post.** A reply written in October under a September learner's post can quote that learner, so it must stay hidden from new joiners, along with its file, including behind `If-None-Match: *`. Task 3, `tests/course-fiiu-posts.test.js`.
3. **Reopening enrolment.** An admin reopens enrolment to add someone by hand. The September boundary must still hold for posts, ticked items and the survey. Tasks 3, 4 and 5, the "after reopening" tests.
4. **Wrong-account survey link.** A September learner follows the survey's `?encuesta=1` link while signed into a second, FIIU-registered account. No Join button may appear. Task 7, `tests/course-fiiu-ui.test.js`.
5. **Cancelled registration with the page still open.** A registration is cancelled while the course page is open. The join is refused, and the page reloads instead of showing the Join button again. Tasks 2 and 7.

---

### Task 1: The perk rule and its wiring

**Files:**
- Modify: `server/course-final-survey.js`
- Create: `server/course-perks.js`
- Modify: `server/courses-api.js`
- Modify: `server/server.js`
- Test (new): `tests/course-perks.test.js`

**Interfaces:**
- Consumes: the FIIU store's `find(name, filters, {limit})` (`server/fiiu-repository.js`, the same read as `server/fiiu-api.js:30`): `find('registrations', {eventId, userId}, {limit:1})` → `[{id, eventId, userId, createdAt, …}]`. The local store returns `createdAt` as `…Z` text; Supabase returns `…+00:00` with microseconds.
- Produces:
  - `export const FIIU_COURSE_PERK`: frozen `{courseId:'72e3cc56-a506-4a1b-97b5-9333e8d283ca', eventId:'fiiu-2026', registeredBefore:'2026-10-26T05:00:00Z', septemberBefore:'2026-10-01T00:00:00Z'}`.
  - `export function createCoursePerks({fiiuStore=null, perk=FIIU_COURSE_PERK}={})` returns a frozen object:
    - `courseId: string` (lower case)
    - `applies(id) → boolean`: true only for the perk course id, in any case.
    - `inSeptemberGroup(enrollment) → boolean`: `createdAt` before 1 Oct UTC. An unreadable date gives false, so that viewer gets the filtered view.
    - `septemberPost(post) → boolean`: `createdAt` before 1 Oct UTC. An unreadable date gives true, so the post stays hidden from new joiners.
    - `fiiuEligible(user) → Promise<boolean>`: false with no store, no `user.id`, or an admin, and nothing is read. Otherwise it makes one registration read and returns `createdAt < registeredBefore`. A failed read rejects (the error is not swallowed).
  - `createCourseApi({..., perks=createCoursePerks()})`: the default has no FIIU store. It passes the same `perks` to `createFinalSurvey({..., perks})`, which also defaults to `createCoursePerks()`.
  - `createApp` passes `perks:createCoursePerks({fiiuStore})`.
  - Tasks 3 and 4 define this inside `createCourseApi`, near `courseAccess`: `const newJoinerView=(courseId,user,access)=>perks.applies(courseId)&&!isStaff(user)&&!(access?.enrollment&&perks.inSeptemberGroup(access.enrollment));`. This task does not define it.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task1-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task1-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-perks.test.js b/tests/course-perks.test.js
new file mode 100644
index 0000000..015127f
--- /dev/null
+++ b/tests/course-perks.test.js
@@ -0,0 +1,94 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import {readFileSync} from 'node:fs';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createFiiuStore} from '../server/fiiu-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';
+
+/* Who may join Curso Movilidad Nivel 2 now that it is closed (server/course-perks.js): FIIU Fest 11 registrants
+   registered by the end of 25 Oct in Lima, and the 1 Oct boundary of the September group. */
+const COURSE='72e3cc56-a506-4a1b-97b5-9333e8d283ca',member={id:'10000000-0000-4000-8000-000000000001',permission:'member'};
+// A FIIU store holding `rows` as registrations; it answers by equality on every filter and records each read.
+function fiiuStore(rows=[]) {
+ const reads=[];
+ return {reads,find:async(name,filters,options)=>{reads.push([name,filters,options]);return rows.filter(row=>name==='registrations'&&Object.entries(filters).every(([key,value])=>row[key]===value)).slice(0,options?.limit);}};
+}
+const registration=(createdAt,patch={})=>({id:'20000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',userId:member.id,createdAt,...patch});
+const eligible=(rows,user=member)=>createCoursePerks({fiiuStore:fiiuStore(rows)}).fiiuEligible(user);
+
+test('the perk names one course, one festival and two instants, frozen',()=>{
+ assert.deepEqual({...FIIU_COURSE_PERK},{courseId:COURSE,eventId:'fiiu-2026',registeredBefore:'2026-10-26T05:00:00Z',septemberBefore:'2026-10-01T00:00:00Z'});
+ assert.ok(Object.isFrozen(FIIU_COURSE_PERK));assert.ok(Object.isFrozen(createCoursePerks()));
+});
+
+test('the rules apply to the perk course only, whatever the case of its id',()=>{
+ const perks=createCoursePerks();
+ assert.equal(perks.courseId,COURSE);
+ assert.equal(perks.applies(COURSE),true);assert.equal(perks.applies(COURSE.toUpperCase()),true);
+ for(const id of ['10000000-0000-4000-8000-000000000009','',null,undefined,42])assert.equal(perks.applies(id),false,String(id));
+});
+
+test('the September group is the enrolments made before 1 Oct UTC; an unreadable date is not',()=>{
+ const {inSeptemberGroup}=createCoursePerks();
+ assert.equal(inSeptemberGroup({createdAt:'2026-09-13T23:40:33.765Z'}),true);
+ assert.equal(inSeptemberGroup({createdAt:'2026-09-30T23:59:59.999Z'}),true);
+ assert.equal(inSeptemberGroup({createdAt:'2026-10-01T00:00:00.000Z'}),false);
+ assert.equal(inSeptemberGroup({createdAt:'2026-10-19T14:00:00.000Z'}),false);
+ for(const enrollment of [{createdAt:'garbage'},{createdAt:''},{createdAt:null},{},null,undefined])assert.equal(inSeptemberGroup(enrollment),false,JSON.stringify(enrollment));
+});
+
+test('September posts are the ones written before 1 Oct UTC; an unreadable date stays with the September group',()=>{
+ const {septemberPost}=createCoursePerks();
+ assert.equal(septemberPost({createdAt:'2026-09-20T14:05:00.000Z'}),true);
+ assert.equal(septemberPost({createdAt:'2026-10-01T00:00:00.000Z'}),false);
+ assert.equal(septemberPost({createdAt:'2026-10-19T09:30:00.000Z'}),false);
+ for(const post of [{createdAt:'garbage'},{createdAt:''},{},null,undefined])assert.equal(septemberPost(post),true,JSON.stringify(post));
+});
+
+test('a FIIU Fest 11 registration made before the end of 25 Oct in Lima makes a member eligible, read once',async()=>{
+ const store=fiiuStore([registration('2026-10-26T04:59:59.999999+00:00')]);
+ assert.equal(await createCoursePerks({fiiuStore:store}).fiiuEligible(member),true);
+ assert.deepEqual(store.reads,[['registrations',{eventId:'fiiu-2026',userId:member.id},{limit:1}]]);
+ assert.equal(await eligible([registration('2026-09-28T16:12:00.000Z')]),true);
+ // At or after the deadline, in both text forms, is too late.
+ for(const createdAt of ['2026-10-26T05:00:00Z','2026-10-26T05:00:00.000Z','2026-10-26T05:00:00.000001+00:00','2026-10-26T05:00:01.000000+00:00'])assert.equal(await eligible([registration(createdAt)]),false,createdAt);
+ assert.equal(await eligible([registration('garbage')]),false);
+ // No registration (never made, or cancelled: cancelling removes the row), another festival's, or another person's.
+ assert.equal(await eligible([]),false);
+ assert.equal(await eligible([registration('2026-10-10T12:00:00.000Z',{eventId:'fiiu-2025'})]),false);
+ assert.equal(await eligible([registration('2026-10-10T12:00:00.000Z',{userId:'10000000-0000-4000-8000-000000000002'})]),false);
+});
+
+test('staff, a missing account and a server without the FIIU store are never eligible, and a failed read is not swallowed',async()=>{
+ const store=fiiuStore([registration('2026-10-10T12:00:00.000Z')]),perks=createCoursePerks({fiiuStore:store});
+ assert.equal(await perks.fiiuEligible({...member,permission:'admin'}),false);
+ assert.equal(await perks.fiiuEligible(null),false);assert.equal(await perks.fiiuEligible({permission:'member'}),false);
+ assert.deepEqual(store.reads,[],'nothing is read for them');
+ assert.equal(await createCoursePerks().fiiuEligible(member),false);
+ const broken=createCoursePerks({fiiuStore:{find:async()=>{throw Object.assign(new Error('FIIU unavailable'),{status:503});}}});
+ await assert.rejects(broken.fiiuEligible(member),{message:'FIIU unavailable',status:503});
+});
+
+test('the local FIIU store answers the perk read',async t=>{
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const store=createFiiuStore({db}),perks=createCoursePerks({fiiuStore:store});
+ const [early,late,elsewhere,none]=['early','late','elsewhere','none'].map(name=>toApiUser(createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused'})));
+ const add=(user,eventId,createdAt)=>store.insert('registrations',{id:randomUUID(),eventId,userId:user.id,email:user.email,answers:{},labStatus:'none',version:1,createdAt,updatedAt:createdAt});
+ await add(early,'fiiu-2026','2026-10-20T15:00:00.000Z');await add(late,'fiiu-2026','2026-10-26T05:00:00.000Z');await add(elsewhere,'fiiu-2025','2026-10-20T15:00:00.000Z');
+ assert.deepEqual(await Promise.all([early,late,elsewhere,none].map(user=>perks.fiiuEligible(user))),[true,false,false,false]);
+});
+
+test('the course API runs on its default perks, and the server builds them from its FIIU store',async()=>{
+ const api=createCourseApi({store:{find:async name=>name==='courses'?[{id:COURSE,status:'published',title:'Curso Movilidad Nivel 2'}]:[]},send:(res,status,body)=>Object.assign(res,{status,body})});
+ const res={};await api({req:{method:'GET',headers:{}},res,url:new URL('https://nodal.test/api/courses'),user:member});
+ assert.equal(res.status,200);assert.equal(res.body.courses[0].id,COURSE);
+ const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),server=read('server/server.js'),courses=read('server/courses-api.js');
+ // The wiring, checked in the source (assert.ok, since a failed assert.match would print the whole file).
+ assert.ok(/^import \{ createCoursePerks \} from '\.\/course-perks\.js';$/m.test(server),'server.js imports createCoursePerks');
+ assert.ok(/createCourseApi\(\{store:courseStore,[^}]*\bperks:createCoursePerks\(\{fiiuStore\}\),/.test(server),'createApp builds the perks from its FIIU store');
+ assert.ok(/export function createCourseApi\(\{[^}]*\bperks=createCoursePerks\(\)\}=\{\}\)/.test(courses),'createCourseApi defaults to perks without a FIIU store');
+ assert.ok(/createFinalSurvey\(\{[^}]*\bperks\}\)/.test(courses),'the final survey gets the same perks');
+ assert.ok(/export function createFinalSurvey\(\{[^}]*\bperks=createCoursePerks\(\)\}\)/.test(read('server/course-final-survey.js')),'createFinalSurvey takes perks');
+});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-perks.test.js`
Expected: the whole file fails to load. `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/server/course-perks.js' imported from …/tests/course-perks.test.js`, then `not ok 1 - tests/course-perks.test.js`, `# tests 1`, `# pass 0`, `# fail 1`.
(If you create only `server/course-perks.js` first, tests 1-7 pass and test 8 fails with `error: 'server.js imports createCoursePerks'`, `actual: false`. That run was also verified.)

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task1-impl.patch` and apply it with `git apply /tmp/nodal-task1-impl.patch`. It touches only `server/course-final-survey.js`, `server/course-perks.js`, `server/courses-api.js`, `server/server.js`.

```diff
diff --git a/server/course-final-survey.js b/server/course-final-survey.js
index 44554e3..f535ffe 100644
--- a/server/course-final-survey.js
+++ b/server/course-final-survey.js
@@ -1,4 +1,5 @@
 import {newId, identifier, decodeAttachment} from './courses-domain.js';
+import {createCoursePerks} from './course-perks.js';
 
 /* The final survey and certificates of one course, Curso Movilidad Nivel 2 (docs/implementation/course-final-survey.md).
    It is not a survey builder: the approved Spanish wording lives here once, the server validates against it, the
@@ -169,7 +170,7 @@ export const surveyStatusCsv = people => [
 const slug = value => String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60).replace(/^-+|-+$/g,'');
 const personalFilename = (filename,name,userId) => filename.replace(/\.pdf$/,'')+'-'+(slug(name)||userId.slice(0,8))+'.pdf';
 
-export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config=FINAL_SURVEY,clock=Date.now,log=console.error}) {
+export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config=FINAL_SURVEY,clock=Date.now,log=console.error,perks=createCoursePerks()}) {
   const surveyCourse=config.courseId.toLowerCase(),closes=Date.parse(config.closesAt),lastDay=lastDayOf(config.closesAt);
   const isOpen=()=>clock()<closes,stamp=()=>new Date(clock()).toISOString();
   const errorText=error=>error instanceof Error?error.message:String(error??'unknown error');
diff --git a/server/course-perks.js b/server/course-perks.js
new file mode 100644
index 0000000..31c8cbf
--- /dev/null
+++ b/server/course-perks.js
@@ -0,0 +1,27 @@
+/* Who may join Curso Movilidad Nivel 2 now that it is closed, and where its September group ends
+   (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md). One course, one festival, two instants; phase 2
+   replaces this with a per-course setting. Dates are compared as instants: Supabase returns FIIU created_at as
+   '…+00:00' with microseconds, course rows use the '…Z' text form. */
+export const FIIU_COURSE_PERK = Object.freeze({
+  courseId:'72e3cc56-a506-4a1b-97b5-9333e8d283ca',
+  eventId:'fiiu-2026',
+  registeredBefore:'2026-10-26T05:00:00Z', // end of 25 Oct 2026 in Lima (UTC-05:00, no DST)
+  septemberBefore:'2026-10-01T00:00:00Z',  // a UTC instant: enrolments and posts before it are the September group's
+});
+const instant=value=>Date.parse(value??'');
+export function createCoursePerks({fiiuStore=null,perk=FIIU_COURSE_PERK}={}) {
+  const courseId=perk.courseId.toLowerCase(),registeredBefore=instant(perk.registeredBefore),septemberBefore=instant(perk.septemberBefore);
+  return Object.freeze({
+    courseId,
+    applies:id=>typeof id==='string'&&id.toLowerCase()===courseId,
+    // An enrolment whose date cannot be read is not the September group's: its holder gets the filtered view.
+    inSeptemberGroup:enrollment=>instant(enrollment?.createdAt)<septemberBefore,
+    // A post whose date cannot be read stays with the September group: new joiners never see it.
+    septemberPost:post=>!(instant(post?.createdAt)>=septemberBefore),
+    async fiiuEligible(user) {
+      if(!fiiuStore||!user?.id||user.permission==='admin')return false;
+      const [registration]=await fiiuStore.find('registrations',{eventId:perk.eventId,userId:user.id},{limit:1});
+      return instant(registration?.createdAt)<registeredBefore;
+    },
+  });
+}
diff --git a/server/courses-api.js b/server/courses-api.js
index 5c994d2..3f9cc16 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -1,6 +1,7 @@
 import { newId, identifier, fail, normalizeCourse, normalizeModule, normalizeIntake, normalizePost, normalizeFeedback, decodeAttachment, attachmentFilename, text, csv, INTAKE_FIELDS, FEEDBACK_ACTIONS, decodeCursor, encodeCursor } from './courses-domain.js';
 import {createCourseParticipants} from './course-participants.js';
 import {createFinalSurvey, FINAL_SURVEY} from './course-final-survey.js';
+import {createCoursePerks} from './course-perks.js';
 import {createHash} from 'node:crypto';
 
 const now = () => new Date().toISOString();
@@ -64,7 +65,7 @@ function respond(res,status,body,headers={}) {
 }
 
 // finalSurvey and clock exist for tests: the survey's course and deadline are fixed in production.
-export function createCourseApi({store,userRepository,sameOrigin,send=respond,rateLimit=()=>true,downloadLimits=DOWNLOAD_LIMITS,downloads=createByteBudget(downloadLimits),log=console.error,finalSurvey=FINAL_SURVEY,clock=Date.now}={}) {
+export function createCourseApi({store,userRepository,sameOrigin,send=respond,rateLimit=()=>true,downloadLimits=DOWNLOAD_LIMITS,downloads=createByteBudget(downloadLimits),log=console.error,finalSurvey=FINAL_SURVEY,clock=Date.now,perks=createCoursePerks()}={}) {
   const participants=createCourseParticipants({store,userRepository});
   const findOne=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
   async function all(name,filters={},max=Infinity) {
@@ -170,7 +171,7 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     };
   }
   function sendCsv(res,name,rows) { send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`}); }
-  const survey=createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config:finalSurvey,clock,log});
+  const survey=createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config:finalSurvey,clock,log,perks});
 
   return async function handle({req,res,url,user}) {
     const path=url.pathname;
diff --git a/server/server.js b/server/server.js
index 23d08a5..80b3810 100644
--- a/server/server.js
+++ b/server/server.js
@@ -12,6 +12,7 @@ import { createCache, MemoryCache } from './cache.js';
 import { createNetworkSnapshots } from './network-cache.js';
 import { createCourseStore } from './courses-repository.js';
 import { createCourseApi, createByteBudget, DOWNLOAD_LIMITS } from './courses-api.js';
+import { createCoursePerks } from './course-perks.js';
 import { createFiiuStore } from './fiiu-repository.js';
 import { createFiiuApi, exportFiiuData } from './fiiu-api.js';
 import { createProgramme } from './fiiu-programme.js';
@@ -1263,7 +1264,7 @@ export function createApp({
     rateLimit:(req,res,user)=>['GET','HEAD'].includes(req.method)?throttle(user?newsReadLimiter:newsPublicReadLimiter,res,req,user,'news')
       :throttle(newsWriteLimiter,res,req,user,'news-write'),
   }):null;
-  const courseApi=courseStore?createCourseApi({store:courseStore,userRepository:repository,sameOrigin,send,downloads,
+  const courseApi=courseStore?createCourseApi({store:courseStore,userRepository:repository,sameOrigin,send,downloads,perks:createCoursePerks({fiiuStore}),
     // Only an upload spends the upload budget; staff list the file library after every upload, use and delete.
     rateLimit:(req,res,user,pathname)=>throttle(pathname.endsWith('/invitations')?courseInvitationLimiter:req.method==='POST'&&pathname.endsWith('/attachments')?courseUploadLimiter:['GET','HEAD'].includes(req.method)?courseReadLimiter:courseWriteLimiter,res,req,user,'course'),
   }):null;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-perks.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/course-final-survey.js server/course-perks.js server/courses-api.js server/server.js tests/course-perks.test.js
git commit -m "Add the FIIU course perk rule and hand it to the course API and the final survey" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: FIIU registrants can join the closed course

**Files:**
- Modify: `server/courses-api.js`
- Test (new): `tests/course-fiiu-access.test.js`
- Test (modify): `tests/courses-performance.test.js`

**Interfaces:**
- Consumes (from Task 1): `perks` inside `createCourseApi` (`perks.applies(id)`, `async perks.fiiuEligible(user)`, which answers false without a FIIU store and for `permission==='admin'`, and throws when the FIIU read fails); the existing `isStaff`, `all(name,filters)`, `log`, and the module-level `errorText`.
- Produces:
  - `async joinFor(course,user)` inside `createCourseApi`, resolving to `'fiiu' | 'supporters' | null`. It is null for staff, an open course and any course `perks.applies` rejects. A failed FIIU read is logged once (`log('course FIIU perk check failed:', message)`) and gives `'supporters'`. Callers pass it only viewers who are not enrolled.
  - `GET /api/courses`: every course gains `enrolled: boolean` for this viewer. The closed perk course also gains `join: 'fiiu'|'supporters'` when the viewer is neither enrolled nor staff. It reads the courses and `all('enrollments',{userId})` together, plus at most one FIIU read. `GET /api/admin/courses` is unchanged.
  - `GET /api/courses/:id`: adds `join: 'fiiu'|'supporters'` for a non-staff viewer who is not enrolled, on the closed perk course only. The FIIU read runs alongside the modules and survey reads.
  - `POST /api/courses/:id/enroll`: on the closed perk course it enrols the caller when `perks.fiiuEligible(user)`; otherwise it answers 403 `{error:'enrollment is closed',code:'enrollment_closed'}`. A failed FIIU read throws through to the caller.
  - Tasks 3 and 4 still define `newJoinerView`; this task does not need it.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task2-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task2-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-fiiu-access.test.js b/tests/course-fiiu-access.test.js
new file mode 100644
index 0000000..f30e549
--- /dev/null
+++ b/tests/course-fiiu-access.test.js
@@ -0,0 +1,147 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import http from 'node:http';
+import {once} from 'node:events';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {normalizeCourse} from '../server/courses-domain.js';
+import {createCoursePerks,FIIU_COURSE_PERK} from '../server/course-perks.js';
+
+// The perk course (closed), another closed course and an open one; the perk is pointed at the first.
+const PERK='30000000-0000-4000-8000-000000000001',CLOSED='30000000-0000-4000-8000-000000000002',OPEN='30000000-0000-4000-8000-000000000003';
+const SEPTEMBER='2026-09-08T15:00:00.000Z';
+const closed={error:'enrollment is closed',code:'enrollment_closed'};
+
+async function setup(t,{fiiu=true}={}) {
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const users={};for(const [key,role] of [['staff','admin'],['learner','member'],['member','member'],['outsider','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
+ const store=createCourseStore({db});
+ // The festival store as the perk reads it: registrations by event and account; cancelling removes the row.
+ const fiiuState={registrations:[],reads:[],broken:false};
+ const fiiuStore={find:async(name,filters,options)=>{
+  fiiuState.reads.push({name,filters,options});
+  if(fiiuState.broken)throw Object.assign(new Error('festival data unavailable'),{status:503});
+  return fiiuState.registrations.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)).slice(0,options?.limit??Infinity);
+ }};
+ const register=(user,createdAt,eventId=FIIU_COURSE_PERK.eventId)=>fiiuState.registrations.push({id:randomUUID(),eventId,userId:users[user].id,createdAt});
+ const logged=[];
+ const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,log:(...args)=>logged.push(args),
+  perks:createCoursePerks({fiiuStore:fiiu?fiiuStore:null,perk:{...FIIU_COURSE_PERK,courseId:PERK}})});
+ const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
+ server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
+ const base=`http://127.0.0.1:${server.address().port}`;
+ const call=async(path,{actor='member',method='GET',body,origin=base}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
+ for(const [id,title,enrollmentOpen] of [[PERK,'Movilidad',false],[CLOSED,'Closed',false],[OPEN,'Open',true]]) await store.insert('courses',{id,...normalizeCourse({title,status:'published',enrollmentOpen}),version:1,createdAt:SEPTEMBER,updatedAt:SEPTEMBER});
+ // The September group: enrolled before the course closed.
+ await store.insert('enrollments',{id:randomUUID(),courseId:PERK,userId:users.learner.id,createdAt:SEPTEMBER});
+ const detail=async(id,actor)=>(await call(`/api/courses/${id}`,{actor})).json();
+ const enroll=(id,actor)=>call(`/api/courses/${id}/enroll`,{actor,method:'POST',body:{}});
+ const list=async actor=>Object.fromEntries((await(await call('/api/courses',{actor})).json()).courses.map(course=>[course.id,course]));
+ return {call,store,users,fiiuState,register,logged,detail,enroll,list};
+}
+
+test('a FIIU Fest 11 registrant joins the closed perk course, and only that course',async t=>{
+ const {call,store,users,fiiuState,register,detail,enroll}=await setup(t);
+ // Supabase's form of the last microsecond before the deadline.
+ register('member','2026-10-26T04:59:59.999999+00:00');
+ const preview=await detail(PERK,'member');
+ assert.equal(preview.course.enrollmentOpen,false);assert.equal(preview.enrollment,null);assert.equal(preview.join,'fiiu');
+ assert.deepEqual(fiiuState.reads,[{name:'registrations',filters:{eventId:'fiiu-2026',userId:users.member.id},options:{limit:1}}]);
+ // Another closed course keeps today's answer, without a festival read.
+ assert.equal((await detail(CLOSED,'member')).join,undefined);
+ const other=await enroll(CLOSED,'member');assert.equal(other.status,403);assert.deepEqual(await other.json(),closed);
+ assert.equal(fiiuState.reads.length,1);
+ const joined=await enroll(PERK,'member');assert.equal(joined.status,200);
+ const {enrollment}=await joined.json();assert.equal(enrollment.courseId,PERK);assert.equal(enrollment.userId,users.member.id);assert.equal(enrollment.intakeCompleted,false);
+ // Joining again answers the same enrolment, as for any member.
+ const again=await enroll(PERK,'member');assert.equal(again.status,200);assert.equal((await again.json()).enrollment.id,enrollment.id);
+ const member=await detail(PERK,'member');assert.equal(member.enrollment.id,enrollment.id);assert.equal(member.join,undefined);
+ // The join leads to the intake form, as on an open course.
+ const intake={fullName:'Member',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Beginner',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
+ assert.equal((await call(`/api/courses/${PERK}/intake`,{method:'PUT',body:intake})).status,200);
+ assert.equal((await store.find('enrollments',{courseId:PERK})).length,2);assert.equal((await store.find('enrollments',{courseId:CLOSED})).length,0);
+});
+
+test('a late, foreign, cancelled or missing registration leaves the closed course closed',async t=>{
+ const cases=[
+  ['at the deadline',[['2026-10-26T05:00:00Z']]],
+  ['one second after it, as Supabase writes it',[['2026-10-26T05:00:01.000000+00:00']]],
+  ['for another event',[['2026-10-10T12:00:00.000Z','fiiu-2025']]],
+  ['none',[]],
+ ];
+ for(const [label,rows] of cases) {
+  const {store,register,detail,enroll}=await setup(t);
+  for(const [createdAt,eventId] of rows)register('member',createdAt,eventId);
+  assert.equal((await detail(PERK,'member')).join,'supporters',label);
+  const refused=await enroll(PERK,'member');assert.equal(refused.status,403,label);assert.deepEqual(await refused.json(),closed,label);
+  // Only the September learner's enrolment.
+  assert.equal((await store.find('enrollments',{courseId:PERK})).length,1,label);
+ }
+ // Cancelling the registration (the festival store removes the row) takes the offer away before joining.
+ const {store,users,fiiuState,register,detail,enroll}=await setup(t);
+ register('member','2026-10-17T14:03:22.123456+00:00');assert.equal((await detail(PERK,'member')).join,'fiiu');
+ fiiuState.registrations.length=0;
+ assert.equal((await detail(PERK,'member')).join,'supporters');
+ const refused=await enroll(PERK,'member');assert.equal(refused.status,403);assert.deepEqual(await refused.json(),closed);
+ assert.equal((await store.find('enrollments',{userId:users.member.id})).length,0);
+});
+
+test('staff and a server without the festival store get no perk',async t=>{
+ const {store,users,fiiuState,register,detail,enroll,list}=await setup(t);
+ register('staff','2026-10-17T14:03:22.123456+00:00');
+ const staff=await detail(PERK,'staff');assert.equal(staff.join,undefined);assert.equal(staff.enrollment,null);
+ assert.equal((await list('staff'))[PERK].join,undefined);
+ const refused=await enroll(PERK,'staff');assert.equal(refused.status,403);assert.deepEqual(await refused.json(),closed);
+ assert.deepEqual(fiiuState.reads,[]);
+ assert.equal((await store.find('enrollments',{userId:users.staff.id})).length,0);
+
+ const bare=await setup(t,{fiiu:false});
+ bare.register('member','2026-10-17T14:03:22.123456+00:00');
+ assert.equal((await bare.detail(PERK,'member')).join,'supporters');assert.equal((await bare.list('member'))[PERK].join,'supporters');
+ const none=await bare.enroll(PERK,'member');assert.equal(none.status,403);assert.deepEqual(await none.json(),closed);
+ assert.deepEqual(bare.fiiuState.reads,[]);
+});
+
+test('a failed festival read keeps the preview and fails the join, which a retry completes',async t=>{
+ const {store,users,fiiuState,register,logged,detail,enroll,list}=await setup(t);
+ register('member','2026-10-17T14:03:22.123456+00:00');fiiuState.broken=true;
+ const preview=await detail(PERK,'member');assert.equal(preview.join,'supporters');assert.equal(preview.course.id,PERK);
+ assert.equal(logged.length,1);assert.match(logged[0].join(' '),/festival data unavailable/);
+ assert.equal((await list('member'))[PERK].join,'supporters');assert.equal(logged.length,2);
+ const failed=await enroll(PERK,'member');assert.equal(failed.status,503);
+ assert.equal((await store.find('enrollments',{userId:users.member.id})).length,0);
+ fiiuState.broken=false;
+ assert.equal((await enroll(PERK,'member')).status,200);
+ assert.equal((await store.find('enrollments',{userId:users.member.id})).length,1);
+});
+
+test('reopening enrolment restores open joining for everyone, without festival reads',async t=>{
+ const {call,fiiuState,detail,enroll,list}=await setup(t);
+ assert.equal((await call(`/api/admin/courses/${PERK}`,{actor:'staff',method:'PATCH',body:{version:1,enrollmentOpen:true}})).status,200);
+ const preview=await detail(PERK,'outsider');assert.equal(preview.course.enrollmentOpen,true);assert.equal(preview.join,undefined);
+ assert.equal((await list('outsider'))[PERK].join,undefined);
+ assert.equal((await enroll(PERK,'outsider')).status,200);
+ assert.equal((await detail(PERK,'outsider')).enrollment.courseId,PERK);
+ assert.deepEqual(fiiuState.reads,[]);
+});
+
+test('the course list says who is enrolled and how the closed perk course is joined, with at most one festival read',async t=>{
+ const {store,users,fiiuState,register,detail,enroll,list}=await setup(t);
+ await store.insert('enrollments',{id:randomUUID(),courseId:OPEN,userId:users.learner.id,createdAt:SEPTEMBER});
+ register('member','2026-10-17T14:03:22.123456+00:00');
+ const shape=courses=>Object.fromEntries(Object.entries(courses).map(([id,course])=>[id,{enrolled:course.enrolled,join:course.join}]));
+ assert.deepEqual(shape(await list('learner')),{[PERK]:{enrolled:true,join:undefined},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:true,join:undefined}});
+ assert.deepEqual(fiiuState.reads,[]);
+ assert.equal((await detail(PERK,'learner')).join,undefined);assert.deepEqual(fiiuState.reads,[]);
+ assert.deepEqual(shape(await list('member')),{[PERK]:{enrolled:false,join:'fiiu'},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
+ assert.equal(fiiuState.reads.length,1);
+ assert.deepEqual(shape(await list('outsider')),{[PERK]:{enrolled:false,join:'supporters'},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
+ assert.equal(fiiuState.reads.length,2);
+ assert.deepEqual(shape(await list('staff')),{[PERK]:{enrolled:false,join:undefined},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
+ assert.equal(fiiuState.reads.length,2);
+ assert.equal((await enroll(PERK,'member')).status,200);
+ assert.deepEqual(shape(await list('member'))[PERK],{enrolled:true,join:undefined});
+ assert.equal(fiiuState.reads.length,3);
+});
diff --git a/tests/courses-performance.test.js b/tests/courses-performance.test.js
index 9693d1f..f2c4410 100644
--- a/tests/courses-performance.test.js
+++ b/tests/courses-performance.test.js
@@ -101,13 +101,13 @@ test('known member ID batches avoid an empty Supabase request without truncating
   }
 });
 
-test('course directory reports the current viewer role with its existing data response',async()=>{
-  const calls=[];const api=createCourseApi({store:{find:async(name,filter)=>{calls.push(filter);return[course];}}});
+test('course directory reports the current viewer role and enrolments with one read of each',async()=>{
+  const calls=[];const api=createCourseApi({store:{find:async(name,filter)=>{calls.push([name,filter]);return name==='enrollments'?[{id:'enrollment',courseId:COURSE,userId:STAFF,createdAt:stamp}]:[course];}}});
   for(const permission of['admin','member','admin']){
     const result=await invoke(api,'/api/courses',{id:STAFF,permission});
-    assert.equal(result.body.isAdmin,permission==='admin');assert.equal(result.body.courses[0].id,COURSE);
+    assert.equal(result.body.isAdmin,permission==='admin');assert.equal(result.body.courses[0].id,COURSE);assert.equal(result.body.courses[0].enrolled,true);
   }
-  assert.deepEqual(calls,[{status:'published'},{status:'published'},{status:'published'}]);
+  assert.deepEqual(calls,Array(3).fill([['courses',{status:'published'}],['enrollments',{userId:STAFF}]]).flat());
 });
 
 test('course CSV exports read only their own data and do not depend on unrelated reports',async()=>{
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-fiiu-access.test.js tests/courses-performance.test.js`

Expected: 17 tests, 11 pass, 6 fail.
- `a FIIU Fest 11 registrant joins…` fails with `expected: 'fiiu'`.
- `a late, foreign, cancelled or missing…` fails with `expected: 'supporters'`.
- `staff and a server without the festival store…` fails with `expected: 'supporters'`.
- `a failed festival read…` fails with `expected: 'supporters'`.
- `the course list says who is enrolled…` fails because `enrolled` and `join` are missing.
- `course directory reports the current viewer role and enrolments with one read of each` fails with `expected: true`.
- `reopening enrolment restores open joining…` already passes. It guards today's behaviour.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task2-impl.patch` and apply it with `git apply /tmp/nodal-task2-impl.patch`. It touches only `server/courses-api.js`.

```diff
diff --git a/server/courses-api.js b/server/courses-api.js
index 3f9cc16..496713d 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -90,6 +90,14 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     if(content && !isStaff(user) && (!enrollment || !intake))fail('enroll and complete the intake before opening modules',403);
     return {course,enrollment:enrollment?{...enrollment,intakeCompleted:Boolean(intake)}:null,intake:intake?.answers??null};
   }
+  /* How a member who is not enrolled may join the closed perk course (server/course-perks.js): 'fiiu' with an eligible
+     FIIU Fest 11 registration, else 'supporters'; null for staff, an open course and any other course. A failed
+     festival read here counts as not eligible, so the preview never breaks; the join itself lets that error through. */
+  async function joinFor(course,user) {
+    if(isStaff(user)||course.enrollmentOpen||!perks.applies(course.id))return null;
+    try { return await perks.fiiuEligible(user)?'fiiu':'supporters'; }
+    catch(error) { log('course FIIU perk check failed:',errorText(error));return 'supporters'; }
+  }
   async function moduleAccess(courseId,moduleId,user,knownAccess,prefetched) {
     // Reuse checks already performed in this request; never share membership
     // or intake across requests or viewers. prefetched: this request's own read
@@ -221,7 +229,16 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     }
     const root=adminPath?'/api/admin/courses':'/api/courses';
     if(path===root) {
-      if(req.method==='GET') { send(res,200,{courses:await store.find('courses',adminPath?{}:{status:'published'},{limit:100}),isAdmin:isStaff(user)});return true; }
+      if(req.method==='GET'&&adminPath) { send(res,200,{courses:await store.find('courses',{},{limit:100}),isAdmin:isStaff(user)});return true; }
+      if(req.method==='GET') {
+        // One read of the viewer's enrolments marks each card; only the closed perk course can add a festival read.
+        const [courses,enrollments]=await Promise.all([store.find('courses',{status:'published'},{limit:100}),all('enrollments',{userId:user.id})]);
+        const enrolled=new Set(enrollments.map(enrollment=>enrollment.courseId));
+        send(res,200,{courses:await Promise.all(courses.map(async course=>{
+          const join=enrolled.has(course.id)?null:await joinFor(course,user);
+          return {...course,enrolled:enrolled.has(course.id),...(join?{join}:{})};
+        })),isAdmin:isStaff(user)});return true;
+      }
       if(adminPath&&req.method==='POST') {
         const course=await store.insert('courses',{id:newId(),...normalizeCourse(await bodyJson(req)),version:1,createdAt:now(),updatedAt:now()});
         send(res,201,{course});return true;
@@ -290,13 +307,13 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     // The final survey and certificates of one course (server/course-final-survey.js); false for anything else.
     if(await survey.handle({req,res,url,user,access,courseId,suffix,adminPath}))return true;
     if(!suffix&&req.method==='GET') {
-      let [modules,finalSurvey]=await Promise.all([store.find('modules',{courseId,...(isStaff(user)?{}:{status:'published'})},{limit:101,order:['position','sessionDate','id']}),survey.snapshot({courseId,user,access})]);
+      let [modules,finalSurvey,join]=await Promise.all([store.find('modules',{courseId,...(isStaff(user)?{}:{status:'published'})},{limit:101,order:['position','sessionDate','id']}),survey.snapshot({courseId,user,access}),access.enrollment?null:joinFor(access.course,user)]);
       if(!isStaff(user)&&(!access.enrollment||!access.intake)) modules=modules.map(({id,kind,title,position,sessionDate,status,translations={}})=>({
         id,kind,title,position,sessionDate,status,
         // Preview only localized titles; gated teaching content stays private.
         translations:Object.fromEntries(Object.entries(translations).map(([locale,fields])=>[locale,typeof fields.title==='string'?{title:fields.title}:{}])),
       }));
-      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{})});return true;
+      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{}),...(join?{join}:{})});return true;
     }
     if(adminPath&&!suffix&&req.method==='PATCH') {
       const input=await bodyJson(req);
@@ -307,7 +324,9 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     }
     if(!adminPath&&suffix==='/enroll'&&req.method==='POST') {
       if(access.enrollment){send(res,200,{enrollment:access.enrollment});return true;}
-      if(!access.course.enrollmentOpen){send(res,403,{error:'enrollment is closed',code:'enrollment_closed'});return true;}
+      // The closed perk course still admits an eligible FIIU Fest 11 registrant; a failed festival read is an error to
+      // retry, never a refusal.
+      if(!access.course.enrollmentOpen&&!(perks.applies(courseId)&&await perks.fiiuEligible(user))){send(res,403,{error:'enrollment is closed',code:'enrollment_closed'});return true;}
       let enrollment;
       try { enrollment=await store.insert('enrollments',{id:newId(),courseId,userId:user.id,createdAt:now()}); }
       catch(err) { if(err.status!==409)throw err;enrollment=await findOne('enrollments',{courseId,userId:user.id});if(!enrollment)throw err; }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-fiiu-access.test.js tests/courses-performance.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/courses-api.js tests/course-fiiu-access.test.js tests/courses-performance.test.js
git commit -m "Let FIIU Fest 11 registrants join the closed course and tell the course list who is enrolled" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: New joiners see the conversation from October only

**Files:**
- Modify: `server/courses-api.js`
- Test (new): `tests/course-fiiu-posts.test.js`

**Interfaces:**
- Consumes (from Task 1, BASE):
  - the `perks` option of `createCourseApi` (default `createCoursePerks()`; `server.js` passes `createCoursePerks({fiiuStore})`)
  - `perks.applies(courseId) → boolean`
  - `perks.inSeptemberGroup(enrollment) → boolean` (`createdAt < 2026-10-01T00:00:00Z`)
  - `perks.septemberPost(post) → boolean` (true unless `createdAt >= 2026-10-01T00:00:00Z`)
  - from inside `createCourseApi`:
    - `isStaff`, `all(name, filters)`, `findOne`, `store.find`
    - the access object `{course, enrollment, intake}` returned by `courseAccess`; `moduleAccess` returns `{...access, module}`
- Produces (inside `createCourseApi`):
  - `newJoinerView(courseId, user, access) → boolean`: the viewer gets the filtered view on this course. Defined once here; Task 4 reuses it, so do not add it a second time.
  - `async hiddenFromNewJoiner(module) → (post) => boolean`: reads the module's live posts once with `all('posts', {courseId: module.courseId, moduleId: module.id, deletedAt: null})`. A post is hidden if `perks.septemberPost(post)` is true, or if its parent is hidden, or if its parent is not among the live posts (fails closed).
- HTTP behaviour on the perk course, for a viewer who is neither staff nor enrolled before 1 Oct:
  - `GET .../modules/:mid/posts`: hidden posts are left out. The route reads batches of 31 until it has 31 visible posts or a batch comes back short, and returns the first 30. `nextCursor` is `encodeCursor(30th visible)` only when a 31st visible post exists, otherwise `null`.
  - `GET /api/course-attachments/:id`, for another member's post file: 404 `{error:'file unavailable'}` unless a live post that carries the file is visible. The check runs before the ETag/304 branch.
  - `POST .../modules/:mid/posts` with a hidden `parentId`: 400 `{error:'parent post unavailable'}`, the same answer as for a missing parent.
- Unchanged:
  - `?latest=1` does no new reads.
  - The own-post routes, staff, September learners and every other course.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task3-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task3-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-fiiu-posts.test.js b/tests/course-fiiu-posts.test.js
new file mode 100644
index 0000000..f2e63e4
--- /dev/null
+++ b/tests/course-fiiu-posts.test.js
@@ -0,0 +1,145 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import http from 'node:http';
+import {once} from 'node:events';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {encodeCursor} from '../server/courses-domain.js';
+import {setupCoursePilot} from '../scripts/setup-course-pilot.js';
+
+// The September conversation of the perk course stays with the September group
+// (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, "Posts: hidden by date, by thread").
+const SEPTEMBER='2026-09-07T12:00:00.000Z',OCTOBER='2026-10-18T12:00:00.000Z';
+const intake={fullName:'Member',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
+
+// The pilot shell is the perk course; the API keeps its default perks (no FIIU store), as createApp({fiiuStore:null}) does.
+async function setup(t) {
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const users={};for(const [key,role] of [['staff','admin'],['september','member'],['joiner','member'],['peer','member'],['late','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
+ const store=createCourseStore({db}),course=await setupCoursePilot(store);
+ await store.update('courses',{id:course.id},{enrollmentOpen:false});
+ const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`});
+ const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
+ server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
+ const base=`http://127.0.0.1:${server.address().port}`;
+ const call=async(path,{actor='joiner',method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
+ // September learners enrolled before 1 October; the joiner and the peer since, as FIIU registrants will.
+ for(const [key,createdAt] of [['september',SEPTEMBER],['joiner',OCTOBER],['peer',OCTOBER]]) {
+  await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
+  await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users[key].id,answers:intake,updatedAt:createdAt});
+ }
+ const [module]=await store.find('modules',{courseId:course.id,kind:'session'},{order:['position','sessionDate','id'],limit:1});
+ const prefix=`/api/courses/${course.id}/modules/${module.id}`;
+ const post=(actor,createdAt,fields={})=>store.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:users[actor].id,authorName:actor,staff:actor==='staff',clientId:randomUUID(),parentId:null,kind:fields.parentId?'comment':'question',threadKind:'discussion',body:`${actor} at ${createdAt}`,links:[],attachmentIds:[],deletedAt:null,createdAt,...fields});
+ const upload=async(actor,text)=>{const response=await call(prefix+'/attachments',{actor,method:'POST',body:{name:'notes.txt',mime:'text/plain',data:Buffer.from(text).toString('base64')}});assert.equal(response.status,201);return (await response.json()).attachment;};
+ const ids=async(actor,query='')=>{const response=await call(prefix+'/posts'+query,{actor});assert.equal(response.status,200);return (await response.json()).posts.map(p=>p.id);};
+ const download=(id,actor,headers={})=>call(`/api/course-attachments/${id}`,{actor,headers});
+ const reply=(parentId,actor='joiner')=>call(prefix+'/posts',{actor,method:'POST',body:{clientId:randomUUID(),kind:'comment',body:'A reply',parentId}});
+ return {call,course,module,prefix,post,upload,ids,download,reply,store,users};
+}
+// A September thread with an October teaching-team reply and a reply under that, and an October thread.
+async function conversation({post,upload}) {
+ const [septemberFile,staffFile,octoberFile]=[await upload('september','September photo'),await upload('staff','Teaching notes'),await upload('september','October answer')];
+ const september=await post('september','2026-09-10T15:00:00.000Z',{attachmentIds:[septemberFile.id]});
+ const lastSeptember=await post('september','2026-09-30T23:59:59.999Z');
+ const teaching=await post('staff','2026-10-05T10:00:00.000Z',{parentId:september.id,attachmentIds:[staffFile.id]});
+ const nested=await post('september','2026-10-06T10:00:00.000Z',{parentId:teaching.id});
+ const first=await post('staff','2026-10-01T00:00:00.000Z');
+ const answer=await post('september','2026-10-03T10:00:00.000Z',{parentId:first.id,attachmentIds:[octoberFile.id]});
+ return {septemberFile,staffFile,octoberFile,september,lastSeptember,teaching,nested,first,answer};
+}
+
+test('a new joiner never receives a September post, a reply under one, or their files, and cannot answer them',async t=>{
+ const context=await setup(t),{ids,download,reply,post,upload,store}=context;
+ const c=await conversation(context);
+ for(const actor of ['joiner','peer']) {
+  assert.deepEqual(await ids(actor),[c.first.id,c.answer.id]);
+  assert.deepEqual(await ids(actor,'?kind=discussion&order=desc'),[c.answer.id,c.first.id]);
+ }
+ // September learners and the teaching team see everything, as today.
+ for(const actor of ['september','staff'])assert.deepEqual(await ids(actor),[c.september.id,c.lastSeptember.id,c.first.id,c.answer.id,c.teaching.id,c.nested.id]);
+ // Neither a cached copy nor a guessed ETag reveals a hidden file: the refusal comes before the 304.
+ for(const file of [c.septemberFile,c.staffFile])for(const headers of [{},{'If-None-Match':'*'},{'If-None-Match':`"${file.id}"`}]) {
+  const refused=await download(file.id,'joiner',headers);assert.equal(refused.status,404);assert.deepEqual(await refused.json(),{error:'file unavailable'});
+ }
+ const shown=await download(c.octoberFile.id,'joiner');assert.equal(shown.status,200);assert.equal(await shown.text(),'October answer');
+ assert.equal((await download(c.octoberFile.id,'joiner',{'If-None-Match':shown.headers.get('etag')})).status,304);
+ assert.equal((await download(c.staffFile.id,'september')).status,200);assert.equal((await download(c.septemberFile.id,'staff')).status,200);
+ // A missing parent and a hidden one get the same refusal, whoever wrote the hidden post.
+ const missing=await reply(randomUUID());assert.equal(missing.status,400);const refusal=await missing.json();assert.deepEqual(refusal,{error:'parent post unavailable'});
+ for(const parentId of [c.september.id,c.teaching.id,c.nested.id]){const refused=await reply(parentId);assert.equal(refused.status,400);assert.deepEqual(await refused.json(),refusal);}
+ assert.equal((await reply(c.answer.id)).status,201);
+ assert.equal((await reply(c.september.id,'september')).status,201);assert.equal((await reply(c.teaching.id,'staff')).status,201);
+ // A new joiner's own file stays theirs even under a hidden thread; it is hidden from the other new joiners only.
+ const own=await upload('joiner','Mine');await post('joiner','2026-10-07T10:00:00.000Z',{parentId:c.september.id,attachmentIds:[own.id]});
+ assert.equal((await download(own.id,'joiner')).status,200);assert.equal((await download(own.id,'peer')).status,404);assert.equal((await download(own.id,'september')).status,200);
+ // A file its owner also shows in an October post is shown there.
+ await post('september','2026-10-08T10:00:00.000Z',{attachmentIds:[c.septemberFile.id]});
+ assert.equal((await download(c.septemberFile.id,'peer')).status,200);
+ // Withdrawing the September post does not release the replies under it.
+ await store.update('posts',{id:c.september.id},{body:'',attachmentIds:[],deletedAt:OCTOBER});
+ const listed=await ids('peer');assert.ok(listed.includes(c.answer.id));assert.ok(![c.teaching.id,c.nested.id].some(id=>listed.includes(id)));
+ assert.equal((await download(c.staffFile.id,'peer')).status,404);assert.equal((await reply(c.teaching.id,'peer')).status,400);
+});
+
+test('new joiners get full pages of October posts, and a page followed only by hidden posts has no next page',async t=>{
+ const {call,prefix,post,store}=await setup(t);
+ const root=await post('september','2026-09-08T00:00:00.000Z'),visible=[];
+ // 75 October posts. The first 30 are visible, so the first batch holds exactly 30 visible posts and the page still
+ // reads on for a 31st; after them, two in every five answer the September thread and are hidden.
+ for(let i=0;i<75;i++){const createdAt=new Date(Date.UTC(2026,9,2,0,0,i)).toISOString();if(i>=30&&i%5<2)await post('staff',createdAt,{parentId:root.id});else visible.push(await post('september',createdAt));}
+ const page=async(actor,query)=>{const response=await call(prefix+'/posts?kind=discussion'+query,{actor});assert.equal(response.status,200);return response.json();};
+ for(const [order,expected] of [['',visible],['&order=desc',[...visible].reverse()]]) {
+  const first=await page('joiner',order);
+  assert.deepEqual(first.posts.map(p=>p.id),expected.slice(0,30).map(p=>p.id));assert.equal(first.nextCursor,encodeCursor(expected[29]));
+  const second=await page('joiner',order+'&cursor='+first.nextCursor);
+  assert.deepEqual(second.posts.map(p=>p.id),expected.slice(30).map(p=>p.id));assert.equal(second.nextCursor,null);
+ }
+ for(const actor of ['september','staff']){const first=await page(actor,'');assert.equal(first.posts.length,30);assert.equal(first.posts[0].id,root.id);assert.ok(first.nextCursor);}
+ // Withdraw every visible post after the 30th: only hidden posts follow the page, so "load more" is not offered.
+ for(const row of visible.slice(30))await store.update('posts',{id:row.id},{deletedAt:OCTOBER});
+ for(const order of ['','&order=desc']){const only=await page('joiner',order);assert.equal(only.posts.length,30);assert.equal(only.nextCursor,null);}
+});
+
+test('the poll reads no posts, and only a new joiner\'s page reads the module conversation, once',async t=>{
+ const {call,course,module,prefix,post,store}=await setup(t);
+ const root=await post('september','2026-09-08T00:00:00.000Z');await post('staff','2026-10-02T00:00:00.000Z',{parentId:root.id});
+ const reads=[],find=store.find;store.find=async(name,filters,options)=>{reads.push({name,filters,options});return find(name,filters,options);};
+ const request=async(actor,query)=>{reads.length=0;const response=await call(prefix+'/posts'+query,{actor});assert.equal(response.status,200);return response.json();};
+ for(const actor of ['joiner','september','staff']) {
+  const poll=await request(actor,'?latest=1&kind=discussion');
+  assert.deepEqual(Object.keys(poll),['revision']);assert.deepEqual(reads.map(r=>r.name).sort(),['courses','enrollments','intakes','modules']);
+ }
+ for(const actor of ['september','staff']){const listed=await request(actor,'?kind=discussion');assert.equal(listed.posts.length,2);assert.equal(reads.filter(r=>r.name==='posts').length,1);}
+ const listed=await request('joiner','?kind=discussion');assert.deepEqual(listed.posts,[]);assert.equal(listed.nextCursor,null);
+ const posts=reads.filter(r=>r.name==='posts');
+ assert.deepEqual(posts.filter(r=>r.options.limit!==31).map(r=>r.filters),[{courseId:course.id,moduleId:module.id,deletedAt:null}]);
+});
+
+test('after enrolment reopens, members who join and earlier new joiners still see the conversation from October only',async t=>{
+ const context=await setup(t),{call,course,ids,download,reply,store}=context;
+ const c=await conversation(context);
+ await store.update('courses',{id:course.id},{enrollmentOpen:true});
+ assert.equal((await call(`/api/courses/${course.id}/enroll`,{actor:'late',method:'POST',body:{}})).status,200);
+ assert.equal((await call(`/api/courses/${course.id}/intake`,{actor:'late',method:'PUT',body:intake})).status,200);
+ for(const actor of ['joiner','late']) {
+  assert.deepEqual(await ids(actor),[c.first.id,c.answer.id]);
+  assert.equal((await download(c.septemberFile.id,actor,{'If-None-Match':'*'})).status,404);
+  assert.equal((await reply(c.teaching.id,actor)).status,400);
+ }
+ assert.deepEqual(await ids('september'),[c.september.id,c.lastSeptember.id,c.first.id,c.answer.id,c.teaching.id,c.nested.id]);
+});
+
+test('other courses keep the whole conversation for members who joined in October',async t=>{
+ const {call,store,users}=await setup(t);
+ const {course}=await(await call('/api/admin/courses',{actor:'staff',method:'POST',body:{title:'Other course',status:'published'}})).json();
+ const {module}=await(await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'Session',status:'published'}})).json();
+ await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users.joiner.id,createdAt:OCTOBER});
+ await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users.joiner.id,answers:intake,updatedAt:OCTOBER});
+ const old=await store.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:users.staff.id,authorName:'staff',staff:true,clientId:randomUUID(),parentId:null,kind:'question',threadKind:'discussion',body:'September question',links:[],attachmentIds:[],deletedAt:null,createdAt:SEPTEMBER});
+ const path=`/api/courses/${course.id}/modules/${module.id}/posts`;
+ assert.deepEqual((await(await call(path)).json()).posts.map(p=>p.id),[old.id]);
+ assert.equal((await call(path,{method:'POST',body:{clientId:randomUUID(),kind:'comment',body:'A reply',parentId:old.id}})).status,201);
+});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-fiiu-posts.test.js`

Expected: `# tests 5`, `# pass 1`, `# fail 4`.
- Tests 1–4 fail with `AssertionError`. For example, test 1's first `deepEqual` gets the September post ids as well as `[first, answer]`, and test 3 gets the September posts where it expects `[]`.
- Test 5 ("other courses keep the whole conversation…") already passes. It guards the behaviour that must stay unchanged.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task3-impl.patch` and apply it with `git apply /tmp/nodal-task3-impl.patch`. It touches only `server/courses-api.js`.

```diff
diff --git a/server/courses-api.js b/server/courses-api.js
index 496713d..2429f36 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -98,6 +98,7 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     try { return await perks.fiiuEligible(user)?'fiiu':'supporters'; }
     catch(error) { log('course FIIU perk check failed:',errorText(error));return 'supporters'; }
   }
+  const newJoinerView=(courseId,user,access)=>perks.applies(courseId)&&!isStaff(user)&&!(access?.enrollment&&perks.inSeptemberGroup(access.enrollment));
   async function moduleAccess(courseId,moduleId,user,knownAccess,prefetched) {
     // Reuse checks already performed in this request; never share membership
     // or intake across requests or viewers. prefetched: this request's own read
@@ -127,6 +128,25 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     const attachments=new Map(files.map(file=>[file.id.toLowerCase(),file]));
     return Promise.all(posts.map(post=>postView(post,user,attachments)));
   }
+  /* The September conversation stays with the September group (course-perks.js). For a new joiner a post is hidden
+     when it was written before October or answers a hidden post, so an October reply in a September thread is hidden
+     too, whoever wrote it. Threads resolve through the module's live posts, read once per request; a parent missing
+     from them (withdrawn) hides its replies, so the rule fails closed. */
+  async function hiddenFromNewJoiner(module) {
+    const posts=new Map((await all('posts',{courseId:module.courseId,moduleId:module.id,deletedAt:null})).map(post=>[post.id,post])),known=new Map();
+    return post=>{
+      const thread=new Set();let hidden=false;
+      for(let current=post;;current=posts.get(current.parentId)) {
+        if(!current||thread.has(current.id)){hidden=true;break;}
+        if(known.has(current.id)){hidden=known.get(current.id);break;}
+        thread.add(current.id);
+        if(perks.septemberPost(current)){hidden=true;break;}
+        if(!current.parentId)break;
+      }
+      for(const id of thread)known.set(id,hidden);
+      return hidden;
+    };
+  }
   /* After a post is withdrawn (by its author or by staff), its author's files go with it, as the delete confirmation
      promises: unless another live post of theirs still shows a file, the file is marked 'deleting', removed from
      Storage and then from the table, which also returns it to the author's upload allowance. A Storage failure leaves
@@ -248,11 +268,12 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     if(match&&req.method==='GET') {
       const attachment=await findOne('attachments',{id:identifier(match[1])});
       if(!attachment||attachment.status!=='ready')fail('file unavailable',404);
-      const {module}=await moduleAccess(attachment.courseId,attachment.moduleId,user);
+      const {module,...fileAccess}=await moduleAccess(attachment.courseId,attachment.moduleId,user);
       if(attachment.purpose==='material'&&!isStaff(user)&&!referencesMaterial(module,attachment.id))fail('file unavailable',404);
       if(attachment.purpose!=='material'&&!isStaff(user)&&attachment.userId!==user.id) {
-        const posts=await all('posts',{moduleId:attachment.moduleId,userId:attachment.userId,deletedAt:null});
-        if(!posts.some(post=>!post.deletedAt&&post.attachmentIds.some(id=>sameIdentifier(id,attachment.id))))fail('file unavailable',404);
+        const [posts,hidden]=await Promise.all([all('posts',{moduleId:attachment.moduleId,userId:attachment.userId,deletedAt:null}),newJoinerView(attachment.courseId,user,fileAccess)?hiddenFromNewJoiner(module):null]);
+        // A new joiner gets a file only from a post they can see.
+        if(!posts.some(post=>!post.deletedAt&&post.attachmentIds.some(id=>sameIdentifier(id,attachment.id))&&!hidden?.(post)))fail('file unavailable',404);
       }
       // An id never names other bytes, so after the access checks above the browser may keep the file privately and
       // revalidate with its id: a 304 then costs no Storage read.
@@ -438,7 +459,14 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
         // Keep tombstones for reply integrity and owner conflict recovery, but
         // exclude them before pagination so history pages contain live posts.
         const filters={courseId,moduleId:module.id,deletedAt:null,...(kind?{threadKind:kind}:{})};
-        const rows=await store.find('posts',filters,{limit:31,desc,after:decodeCursor(url.searchParams.get('cursor'))});
+        const read=after=>store.find('posts',filters,{limit:31,desc,after});
+        let [rows,hidden]=await Promise.all([read(decodeCursor(url.searchParams.get('cursor'))),newJoinerView(courseId,user,access)?hiddenFromNewJoiner(module):null]);
+        /* A new joiner's pages leave hidden posts out and stay full: batches of 31 follow the last row read until 31
+           posts are visible or a batch comes back short, and only a visible post ever becomes the cursor. */
+        if(hidden) {
+          let batch=rows;rows=batch.filter(post=>!hidden(post));
+          while(rows.length<31&&batch.length===31){batch=await read({createdAt:batch.at(-1).createdAt,id:batch.at(-1).id});rows.push(...batch.filter(post=>!hidden(post)));}
+        }
         const page=rows.slice(0,30);
         send(res,200,{posts:await postPageView(page,user,module),nextCursor:rows.length>30?encodeCursor(page.at(-1)):null,revision:module.postsRevision});return true;
       }
@@ -452,7 +480,9 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
           send(res,200,{post:await postView(old,user)});return true;
         }
         if(input.parentId) {
-          const parent=await findOne('posts',{id:input.parentId,courseId,moduleId:module.id});if(!parent||parent.deletedAt)fail('parent post unavailable');threadKind=parent.threadKind;
+          const [parent,hidden]=await Promise.all([findOne('posts',{id:input.parentId,courseId,moduleId:module.id}),newJoinerView(courseId,user,access)?hiddenFromNewJoiner(module):null]);
+          // A new joiner cannot answer a post they cannot see; the refusal is the one for a missing post.
+          if(!parent||parent.deletedAt||hidden?.(parent))fail('parent post unavailable');threadKind=parent.threadKind;
         }
         for(const id of input.attachmentIds) if(!await findOne('attachments',{id,userId:user.id,courseId,moduleId:module.id,purpose:'post',status:'ready'}))fail('attachment is unavailable or belongs to another member');
         const record={id:newId(),courseId,moduleId:module.id,userId:user.id,authorName:user.fullName,staff:isStaff(user),...input,threadKind,deletedAt:null,createdAt:now()};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-fiiu-posts.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/courses-api.js tests/course-fiiu-posts.test.js
git commit -m "Keep the September course conversation with the September group: new joiners see it from October on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The "September group only" tick on materials

**Files:**
- Modify: `server/courses-api.js`
- Modify: `server/courses-domain.js`
- Test (new): `tests/course-september-items.test.js`
- Test (modify): `tests/courses-ui.test.js`
- Test (modify): `tests/deploy.test.js`
- Modify: `web/pages/course.html`
- Modify: `web/pages/courses.html`
- Modify: `web/pages/dashboard.html`
- Modify: `web/pages/opportunities.html`
- Modify: `web/pages/payments.html`
- Modify: `web/pages/profile.html`
- Modify: `web/pages/teaching.html`
- Modify: `web/scripts/pilot-i18n.js`
- Modify: `web/scripts/teaching.js`

**Interfaces:**
- Consumes (Task 1): the `perks` option of `createCourseApi` (`perks.applies(courseId)`, `perks.inSeptemberGroup(enrollment)`), the file's `isStaff`, and `FIIU_COURSE_PERK.courseId` from `server/course-perks.js`, which the test uses.
- Reuses `newJoinerView(courseId,user,access)` from Task 3.
- Produces:
  - **Module resource shape (materials only):** `{title, url | attachmentId, translations?, kind, septemberOnly?: true}`.
    - `septemberOnly` appears only when it is `true`. `false` or no value stores no key.
    - Any non-boolean value fails with 400 `septemberOnly must be true or false`.
    - A post's links (`normalizeLinks(value)` without `materials`) drop the key.
  - **`withoutSeptemberItems(module)`** (inside `createCourseApi`) returns `{...module, resources: resources without septemberOnly}`.
  - **`moduleAccess(...)` filters for new joiners.** For a `newJoinerView` viewer it returns the module with ticked items removed, so:
    - `GET /api/courses/:id/modules/:mid` leaves them out;
    - `GET /api/course-attachments/:id` gives 404 `file unavailable` for a material referenced only by ticked items (the `referencesMaterial` check, before the ETag/304 branch);
    - `POST /api/courses/:id/events` refuses them with 400 `resource is not in this module`.
  - **`GET /api/courses/:id`:**
    - Enrolled new joiners with an intake get `modules[].resources` without ticked items.
    - The answer gains `perkCourse: true` only for staff and only on the perk course (Task 7 widens it to every viewer on the perk course), whether reached by `/api/courses/:id` or `/api/admin/courses/:id`. Everyone else gets no `perkCourse` key. The teaching workspace reads it from `/api/courses/:id`.
  - **`web/scripts/teaching.js`:**
    - New signatures: `makeEditor(record,module,courseId,onSaved,septemberTick=false)` and `setupView(course,modules,id,onCourseSaved,septemberTick=false)`.
    - A checkbox named `septemberOnly` is added per resource row when `septemberTick`.
    - The PATCH/POST body adds `septemberOnly:true` to ticked resources only.
  - **i18n:** pilot-i18n key `septemberOnly`.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task4-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task4-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-september-items.test.js b/tests/course-september-items.test.js
new file mode 100644
index 0000000..4a98c93
--- /dev/null
+++ b/tests/course-september-items.test.js
@@ -0,0 +1,108 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import http from 'node:http';
+import {once} from 'node:events';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {normalizeCourse,normalizeLinks,normalizeModule} from '../server/courses-domain.js';
+import {FIIU_COURSE_PERK} from '../server/course-perks.js';
+
+// Items ticked "September group only" (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md).
+const SEPTEMBER='2026-09-05T15:00:00.000Z',OCTOBER='2026-10-18T15:00:00.000Z';
+const INTAKE={fullName:'Ana',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
+const EVERY_ITEM=['Class recording','Reading','Field photos','Slides'],OPEN_ITEMS=['Reading','Slides'];
+
+async function setup(t) {
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const users={};for(const [key,role] of [['staff','admin'],['september','member'],['joiner','member']])users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
+ const store=createCourseStore({db});
+ const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`});
+ const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
+ server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
+ const base=`http://127.0.0.1:${server.address().port}`;
+ const call=async(path,{actor='joiner',method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
+ /* A closed course with one session, as production holds it, plus one person who joined in October. The teaching team
+    ticks a recording and a file through the workspace routes; a reading and the slides stay open. */
+ async function course(id) {
+  await store.insert('courses',{id,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:SEPTEMBER,updatedAt:SEPTEMBER});
+  for(const [key,createdAt] of [['september',SEPTEMBER],['joiner',OCTOBER]]) {
+   await store.insert('enrollments',{id:randomUUID(),courseId:id,userId:users[key].id,createdAt});
+   await store.insert('intakes',{id:randomUUID(),courseId:id,userId:users[key].id,answers:INTAKE,updatedAt:createdAt});
+  }
+  const made=await call(`/api/admin/courses/${id}/modules`,{actor:'staff',method:'POST',body:{title:'Session 1',status:'published',resources:[{title:'Class recording',url:'https://example.test/recording',kind:'recording',septemberOnly:true},{title:'Reading',url:'https://example.test/reading',kind:'reading'}]}});
+  assert.equal(made.status,201);let {module}=await made.json();
+  const files=[];
+  for(const name of ['field-photos.pdf','slides.pdf']) {
+   const uploaded=await call(`/api/admin/courses/${id}/modules/${module.id}/attachments`,{actor:'staff',method:'POST',body:{name,mime:'application/pdf',data:Buffer.from('%PDF-1.4 '+name).toString('base64')}});
+   assert.equal(uploaded.status,201);files.push((await uploaded.json()).attachment);
+  }
+  const saved=await call(`/api/admin/courses/${id}/modules/${module.id}`,{actor:'staff',method:'PATCH',body:{version:module.version,resources:[...module.resources,{title:'Field photos',attachmentId:files[0].id,kind:'reading',septemberOnly:true},{title:'Slides',attachmentId:files[1].id,kind:'slides'}]}});
+  assert.equal(saved.status,200);({module}=await saved.json());
+  return {id,module,photos:files[0],slides:files[1]};
+ }
+ return {call,store,course};
+}
+const titles=resources=>resources.map(resource=>resource.title);
+
+test('only module materials carry the September group tick, and only as true',()=>{
+ const [ticked,open]=normalizeLinks([{title:'Class recording',url:'https://example.test/rec',kind:'recording',septemberOnly:true},{title:'Slides',url:'https://example.test/slides',kind:'slides',septemberOnly:false}],true);
+ assert.deepEqual(ticked,{title:'Class recording',url:'https://example.test/rec',kind:'recording',septemberOnly:true});
+ assert.equal('septemberOnly' in open,false,'an open item stores no tick');
+ assert.equal('septemberOnly' in normalizeLinks([{title:'Slides',url:'https://example.test/slides'}],true)[0],false);
+ for(const value of ['true',1,null,{}])assert.throws(()=>normalizeLinks([{title:'Slides',url:'https://example.test/slides',septemberOnly:value}],true),/septemberOnly must be true or false/);
+ // A contribution's links are not course materials, so they never keep a tick.
+ assert.deepEqual(normalizeLinks([{title:'Link',url:'https://example.test/x',septemberOnly:true}]),[{title:'Link',url:'https://example.test/x'}]);
+ // Saving a session without sending its materials keeps the stored ticks.
+ assert.equal(normalizeModule({title:'Renamed'},{title:'Session',resources:[ticked]}).resources[0].septemberOnly,true);
+});
+
+test('a new joiner on the perk course gets neither ticked item in the course page or the session',async t=>{
+ const {call,store,course}=await setup(t);
+ const perk=await course(FIIU_COURSE_PERK.courseId),other=await course(randomUUID());
+ const views=async(actor,{id,module})=>{
+  const page=await(await call(`/api/courses/${id}`,{actor})).json(),session=await(await call(`/api/courses/${id}/modules/${module.id}`,{actor})).json();
+  return [titles(page.modules.find(m=>m.id===module.id).resources),titles(session.module.resources)];
+ };
+ assert.deepEqual(await views('joiner',perk),[OPEN_ITEMS,OPEN_ITEMS]);
+ for(const actor of ['september','staff'])assert.deepEqual(await views(actor,perk),[EVERY_ITEM,EVERY_ITEM],actor);
+ // Only the perk course has a September group: elsewhere an October enrolment sees everything.
+ assert.deepEqual(await views('joiner',other),[EVERY_ITEM,EVERY_ITEM]);
+ // The stored session keeps every item and both ticks.
+ const [stored]=await store.find('modules',{id:perk.module.id});
+ assert.deepEqual(stored.resources.map(r=>[r.title,r.septemberOnly===true]),[['Class recording',true],['Reading',false],['Field photos',true],['Slides',false]]);
+});
+
+test('a ticked file answers 404 to a new joiner before any cache validation, and stays open to the September group and staff',async t=>{
+ const {call,course}=await setup(t);const {photos,slides}=await course(FIIU_COURSE_PERK.courseId);
+ const file=id=>`/api/course-attachments/${id}`;
+ for(const headers of [{},{'If-None-Match':'*'},{'If-None-Match':`"${photos.id}"`}]) {
+  const refused=await call(file(photos.id),{headers});
+  assert.equal(refused.status,404,JSON.stringify(headers));assert.deepEqual(await refused.json(),{error:'file unavailable'});
+ }
+ const open=await call(file(slides.id));assert.equal(open.status,200);assert.match(await open.text(),/slides\.pdf/);
+ assert.equal((await call(file(photos.id),{actor:'september',headers:{'If-None-Match':`"${photos.id}"`}})).status,304);
+ for(const actor of ['september','staff']) {
+  const served=await call(file(photos.id),{actor});assert.equal(served.status,200,actor);assert.match(await served.text(),/field-photos\.pdf/);
+ }
+});
+
+test('a new joiner cannot record opening a ticked item, and the September group can',async t=>{
+ const {call,course}=await setup(t);const {id,module,photos,slides}=await course(FIIU_COURSE_PERK.courseId);
+ const open=(actor,kind,resourceUrl)=>call(`/api/courses/${id}/events`,{actor,method:'POST',body:{moduleId:module.id,kind,resourceUrl}});
+ for(const [kind,url] of [['recording_open','https://example.test/recording'],['content_open',`/api/course-attachments/${photos.id}`]]) {
+  const refused=await open('joiner',kind,url);
+  assert.equal(refused.status,400,url);assert.deepEqual(await refused.json(),{error:'resource is not in this module'});
+  assert.equal((await open('september',kind,url)).status,200,url);
+ }
+ for(const url of ['https://example.test/reading',`/api/course-attachments/${slides.id}`])assert.equal((await open('joiner','content_open',url)).status,200,url);
+});
+
+test('the tick holds after enrolment reopens, and only staff learn which course has a September group',async t=>{
+ const {call,store,course}=await setup(t);const perk=await course(FIIU_COURSE_PERK.courseId),other=await course(randomUUID());
+ await store.update('courses',{id:perk.id},{enrollmentOpen:true});
+ assert.deepEqual(titles((await(await call(`/api/courses/${perk.id}/modules/${perk.module.id}`)).json()).module.resources),OPEN_ITEMS);
+ for(const path of [`/api/courses/${perk.id}`,`/api/admin/courses/${perk.id}`])assert.equal((await(await call(path,{actor:'staff'})).json()).perkCourse,true,path);
+ for(const [actor,id] of [['staff',other.id],['joiner',perk.id],['september',perk.id]])assert.equal('perkCourse' in await(await call(`/api/courses/${id}`,{actor})).json(),false,actor);
+});
diff --git a/tests/courses-ui.test.js b/tests/courses-ui.test.js
index aa5332d..fe11a58 100644
--- a/tests/courses-ui.test.js
+++ b/tests/courses-ui.test.js
@@ -758,3 +758,26 @@ test('text fields on a phone are 16px so iPhone Safari does not zoom into them',
  const fields=':is(.pilot-form,.pilot-feedback,.pilot-response-filters,.pilot-survey-reminder) :is(input:not([type=file]):not([type=checkbox]):not([type=radio]),textarea,select)';
  assert.equal(styleAt(375,fields)['font-size'],'16px');assert.equal(styleAt(1280,fields)['font-size'],undefined);
 });
+test('the September group tick shows only on the perk course and round-trips through a session save',async()=>{
+ for(const perkCourse of [true,false]){
+  let module={id:'m1',title:'Session',kind:'session',version:1,resources:[{title:'Class recording',url:'https://example.test/recording',kind:'recording',septemberOnly:true},{title:'Reading',url:'https://example.test/reading',kind:'reading'}]};
+  const h=harness((path,opts)=>{
+   if(opts?.method==='PATCH'){module={...module,...JSON.parse(opts.body),version:2};return{module};}
+   if(path==='/api/admin/courses')return{courses:[course]};if(path.endsWith('/report'))return{summary:{},participants:[],feedback:[]};
+   return{course:{...course,version:1},modules:[module],...(perkCourse?{perkCourse}:{})};
+  },{page:'teaching'});h.run('teaching');await flush();
+  const form=descendants(h.body).filter(n=>n.tagName==='form'&&descendants(n).some(x=>x.name==='title'))[1],ticks=descendants(form).filter(n=>n.name==='septemberOnly');
+  if(!perkCourse){
+   assert.equal(ticks.length,0,'other courses have no September group');assert.equal(findKey(form,'septemberOnly'),undefined);
+   await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.find(r=>r.method==='PATCH').body.resources.some(r=>'septemberOnly' in r),false);continue;
+  }
+  assert.deepEqual(ticks.map(n=>[n.type,n.checked]),[['checkbox',true],['checkbox',false]]);
+  const label=findKey(form,'septemberOnly');assert.equal(label.textContent,'September group only');
+  h.lang('es');assert.equal(label.textContent,'Solo grupo de septiembre');h.lang('pt');assert.equal(label.textContent,'Só turma de setembro');
+  ticks[0].checked=false;ticks[1].checked=true;await form.listeners.submit({preventDefault(){}});
+  const patch=h.requests.find(r=>r.method==='PATCH');assert.equal(patch.path,'/api/admin/courses/c1/modules/m1');
+  assert.deepEqual(patch.body.resources.map(r=>[r.title,r.septemberOnly]),[['Class recording',undefined],['Reading',true]]);
+  assert.equal('septemberOnly' in patch.body.resources[0],false,'an open item sends no tick');
+  assert.deepEqual(module.resources.map(r=>r.septemberOnly===true),[false,true]);
+ }
+});
diff --git a/tests/deploy.test.js b/tests/deploy.test.js
index 30a1d39..5d26442 100644
--- a/tests/deploy.test.js
+++ b/tests/deploy.test.js
@@ -318,7 +318,7 @@ test('Supabase Data API smoke exercises reads, constrained inserts, updates, and
 test('changed one-hour-cached clients use new URLs on every consuming page', () => {
   const pages = Object.fromEntries(['index.html', 'opportunities.html', 'dashboard.html', 'login.html', 'reset-password.html', 'payments.html', 'profile.html', 'admin.html', 'course.html', 'courses.html', 'teaching.html', 'accept-invitation.html', 'fiiu.html', 'fiiu-admin.html', 'fiiu-qr.html', 'fiiu-checkin.html', 'fiiu-talk.html', 'fiiu-session.html', 'organisers-only.html', 'community.html', 'knowledge.html', 'resources.html']
     .map((name) => [name, readFileSync(path.join(ROOT, 'web', 'pages', name), 'utf8')]));
-  const pilot = { 'pilot-i18n.js': '20261016b', 'pilot.js': '20261005s', 'courses.css': '20261016b' };
+  const pilot = { 'pilot-i18n.js': '20261018a', 'pilot.js': '20261005s', 'courses.css': '20261016b' };
   const festival = { 'fiiu.css': '20261018b', 'fiiu-ui.js': '20261018b' };
   const required = {
     'index.html': { 'styles.css': '32', 'i18n.js': '20261013b', 'app.js': '21', 'recs.js': '5', 'script.js': '18', 'hero-network.js': '2' },
@@ -331,7 +331,7 @@ test('changed one-hour-cached clients use new URLs on every consuming page', ()
     'admin.html': { 'i18n-dashboard.js': '20261017a', 'styles.css': '32', 'admin.css': '5', 'admin.js': '6', 'i18n.js': '20261013b', 'locale.css': '20260929a', 'locale.js': '20261009a', 'nav.js': '20261013b', 'script.js': '18' },
     'course.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261016b', ...pilot },
     'courses.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261016b', ...pilot },
-    'teaching.html': { 'i18n.js': '20261013b', 'teaching.js': '20261009a', ...pilot },
+    'teaching.html': { 'i18n.js': '20261013b', 'teaching.js': '20261018a', ...pilot },
     'accept-invitation.html': { 'accept-invitation.js': '20261013b', 'invitation-i18n.js': '20261013b' },
     'fiiu.html': { 'styles.css': '32', 'i18n.js': '20261013b', ...festival, 'fiiu-live.js': '20261017a', 'fiiu.js': '20261015b' },
     'fiiu-admin.html': { 'styles.css': '32', 'i18n.js': '20261013b', ...festival, 'fiiu-admin.js': '20261015b' },
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-september-items.test.js`
Expected: `# pass 0`, `# fail 5`:
- test 1: deepEqual is missing `septemberOnly: true`;
- tests 2 and 5: `Class recording` and `Field photos` are still listed for the joiner;
- test 3: expected 404, actual 200;
- test 4: expected 400, actual 200.

Run: `node --test --test-name-pattern="September group tick" tests/courses-ui.test.js`
Expected: `# fail 1`. The `ticks.map(...)` deepEqual gets `[]` because no checkbox exists yet.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task4-impl.patch` and apply it with `git apply /tmp/nodal-task4-impl.patch`. It touches only `server/courses-api.js`, `server/courses-domain.js`, `web/pages/course.html`, `web/pages/courses.html`, `web/pages/dashboard.html`, `web/pages/opportunities.html`, `web/pages/payments.html`, `web/pages/profile.html`, `web/pages/teaching.html`, `web/scripts/pilot-i18n.js`, `web/scripts/teaching.js`.

```diff
diff --git a/server/courses-api.js b/server/courses-api.js
index 2429f36..3d07eef 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -99,6 +99,8 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     catch(error) { log('course FIIU perk check failed:',errorText(error));return 'supporters'; }
   }
   const newJoinerView=(courseId,user,access)=>perks.applies(courseId)&&!isStaff(user)&&!(access?.enrollment&&perks.inSeptemberGroup(access.enrollment));
+  // Items the teaching team ticked "September group only" reach no one else: not in a module, a file or an event.
+  const withoutSeptemberItems=module=>({...module,resources:module.resources.filter(resource=>!resource.septemberOnly)});
   async function moduleAccess(courseId,moduleId,user,knownAccess,prefetched) {
     // Reuse checks already performed in this request; never share membership
     // or intake across requests or viewers. prefetched: this request's own read
@@ -107,7 +109,7 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     if(!isStaff(user)&&(!access.enrollment||!access.intake))fail('enroll and complete the intake before opening modules',403);
     const module=await (prefetched??findOne('modules',{id:identifier(moduleId),courseId}));
     if(!module || (!isStaff(user)&&module.status!=='published'))fail('module unavailable',404);
-    return {...access,module};
+    return {...access,module:newJoinerView(courseId,user,access)?withoutSeptemberItems(module):module};
   }
   async function validateMaterials(resources,module) {
     // Normalized resources are bounded to twelve; validate every reference before writing.
@@ -334,7 +336,9 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
         // Preview only localized titles; gated teaching content stays private.
         translations:Object.fromEntries(Object.entries(translations).map(([locale,fields])=>[locale,typeof fields.title==='string'?{title:fields.title}:{}])),
       }));
-      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{}),...(join?{join}:{})});return true;
+      else if(newJoinerView(courseId,user,access))modules=modules.map(withoutSeptemberItems);
+      // perkCourse tells the teaching workspace to offer the "September group only" tick, on this course alone.
+      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{}),...(join?{join}:{}),...(isStaff(user)&&perks.applies(courseId)?{perkCourse:true}:{})});return true;
     }
     if(adminPath&&!suffix&&req.method==='PATCH') {
       const input=await bodyJson(req);
diff --git a/server/courses-domain.js b/server/courses-domain.js
index a46f49b..2a93f04 100644
--- a/server/courses-domain.js
+++ b/server/courses-domain.js
@@ -69,6 +69,8 @@ export function normalizeLinks(value = [], materials = false) {
     ...(materials && item?.attachmentId ? (item.url ? fail('resource must have a URL or attachment, not both') : {attachmentId:identifier(item.attachmentId)}) : {url:httpsUrl(item?.url)}),
     ...(materials && item?.translations !== undefined ? {translations:normalizeTranslations(item.translations,{title:180})} : {}),
     ...(materials ? { kind: choice(item.kind, ['slides', 'reading', 'link', 'recording', 'activity'], 'link', 'resource kind') } : {}),
+    // Ticked "September group only" by the teaching team (server/course-perks.js); an open item stores no flag.
+    ...(materials && item.septemberOnly !== undefined ? (typeof item.septemberOnly !== 'boolean' ? fail('septemberOnly must be true or false') : item.septemberOnly ? { septemberOnly: true } : {}) : {}),
   }));
 }
 export function normalizeModule(input = {}, current = {}) {
diff --git a/web/pages/course.html b/web/pages/course.html
index 5d3336f..9dfb9d3 100644
--- a/web/pages/course.html
+++ b/web/pages/course.html
@@ -5,7 +5,7 @@
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
   <script defer src="courses.js?v=20261016b"></script>
diff --git a/web/pages/courses.html b/web/pages/courses.html
index c420b51..309c8c2 100644
--- a/web/pages/courses.html
+++ b/web/pages/courses.html
@@ -5,7 +5,7 @@
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
   <script defer src="courses.js?v=20261016b"></script>
diff --git a/web/pages/dashboard.html b/web/pages/dashboard.html
index 9af9657..d7196dc 100644
--- a/web/pages/dashboard.html
+++ b/web/pages/dashboard.html
@@ -19,7 +19,7 @@
   <script defer src="i18n.js?v=20261013b"></script>
   <script defer src="location-i18n.js?v=20260918b"></script>
   <script defer src="location-check.js?v=20260908b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
   <script defer src="dashboard.js?v=20261018b"></script>
diff --git a/web/pages/opportunities.html b/web/pages/opportunities.html
index f7d54a1..b130c06 100644
--- a/web/pages/opportunities.html
+++ b/web/pages/opportunities.html
@@ -18,7 +18,7 @@
 
   <script defer src="nav.js?v=20261013b"></script>
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="catalog.js?v=7"></script>
 </head>
diff --git a/web/pages/payments.html b/web/pages/payments.html
index 57574ac..b7f64cb 100644
--- a/web/pages/payments.html
+++ b/web/pages/payments.html
@@ -17,7 +17,7 @@
 
   <script defer src="i18n-dashboard.js?v=20261017a"></script>
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="nav.js?v=20261013b"></script>
   <script defer src="payments.js?v=18"></script>
diff --git a/web/pages/profile.html b/web/pages/profile.html
index 26cca84..25f1a6f 100644
--- a/web/pages/profile.html
+++ b/web/pages/profile.html
@@ -17,7 +17,7 @@
 
   <script defer src="i18n-dashboard.js?v=20261017a"></script>
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="nav.js?v=20261013b"></script>
   <script defer src="profile.js?v=20261013b"></script>
diff --git a/web/pages/teaching.html b/web/pages/teaching.html
index 3bf3048..8f67fcd 100644
--- a/web/pages/teaching.html
+++ b/web/pages/teaching.html
@@ -5,8 +5,8 @@
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
   <script defer src="i18n.js?v=20261013b"></script>
-  <script defer src="pilot-i18n.js?v=20261016b"></script>
+  <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
-  <script defer src="teaching.js?v=20261009a"></script>
+  <script defer src="teaching.js?v=20261018a"></script>
 </head>
 <body class="pilot-page" data-page="teaching"><a class="pilot-skip" data-pilot-text="skipContent" href="#pilotMain">Skip to content</a><header class="pilot-header"><a class="pilot-brand" href="index.html"><img src="assets/nodal-wordmark.webp" width="360" height="143" alt="NODAL"></a><nav aria-label="Main navigation" data-pilot-aria="mainNavigation"><a href="community.html" data-i18n="nav.community">Community</a><a href="fiiu.html">FIIU Fest</a><a href="courses.html" data-pilot-text="courses">Courses</a><a href="dashboard.html" data-pilot-text="console">My console</a><a href="teaching.html" id="teachingLink" hidden data-pilot-text="teaching">Teaching workspace</a></nav><div class="pilot-langs" role="group" aria-label="Language" data-pilot-aria="language"><button class="lang-btn" data-lang="en" type="button" aria-label="English" data-pilot-aria="english">EN</button><button class="lang-btn" data-lang="es" type="button" aria-label="Español" data-pilot-aria="spanish">ES</button><button class="lang-btn" data-lang="pt" type="button" aria-label="Português" data-pilot-aria="portuguese">PT</button></div></header><div class="pilot-notice" data-pilot-banner hidden><strong data-pilot-text="prototype">Course pilot · Prototype</strong><span data-pilot-text="notice">We are testing this learning space together. Share feedback as you go.</span></div><main class="pilot-main" id="pilotMain"><p class="pilot-status" id="pilotStatus" role="status" aria-live="polite">Loading…</p><div id="pilotRoot"></div></main><footer class="pilot-footer"><a href="privacy.html" data-i18n="nav.privacy">Privacy policy</a></footer></body></html>
diff --git a/web/scripts/pilot-i18n.js b/web/scripts/pilot-i18n.js
index d746306..42923b2 100644
--- a/web/scripts/pilot-i18n.js
+++ b/web/scripts/pilot-i18n.js
@@ -194,6 +194,8 @@ const rows = {
  confirmDeleteFile:["Permanently delete this unlinked course file? This cannot be undone.", "¿Borrar definitivamente este archivo sin vincular? Esta acción no se puede deshacer.", "Excluir definitivamente este arquivo não vinculado? Esta ação não pode ser desfeita."],
  fileDeleted:["File deleted.", "Archivo eliminado.", "Arquivo excluído."],
  noUploadedFiles:["No files have been uploaded to this module.", "No se han subido archivos a este módulo.", "Nenhum arquivo foi enviado para este módulo."],
+ // A material only the course's September group sees (teaching.js, on the FIIU perk course only).
+ septemberOnly:['September group only','Solo grupo de septiembre','Só turma de setembro'],
 
  invalidInput:['Review the fields and try again.','Revisa los campos e inténtalo de nuevo.','Revise os campos e tente novamente.'],
  accessDenied:['You do not have access to this action.','No tienes acceso a esta acción.','Você não tem acesso a esta ação.'],
diff --git a/web/scripts/teaching.js b/web/scripts/teaching.js
index 360c227..157e2c3 100644
--- a/web/scripts/teaching.js
+++ b/web/scripts/teaching.js
@@ -36,7 +36,8 @@ function translationEditor(record,keys){
   return{section,value:()=>Object.fromEntries(Object.entries(inputs).map(([lang,fields])=>[lang,Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]))]))};
 }
 
-function makeEditor(record,module,courseId,onSaved){
+// septemberTick: the course has a September group (perkCourse from the server), so each material can be kept to it.
+function makeEditor(record,module,courseId,onSaved,septemberTick=false){
   const form=el('form','pilot-form'),inputs={};
   form.addEventListener('input',e=>{const n=e.target;if(n?.name==='translationLanguage'||n?.type==='file')return;dirty.add(form);});
   const contentKeys=module?['title','description','objectives','instructions']:['title','description'];
@@ -67,10 +68,11 @@ function makeEditor(record,module,courseId,onSaved){
       const row=el('div','pilot-resource-edit'),title=field('title',r.title||''),url=field('url',r.url||'','url'),kind=select('kind',['slides','reading','link','recording','activity'],r.kind||'link');
       title.input.required=true;url.input.required=!r.attachmentId;title.input.maxLength=180;url.input.maxLength=2000;
       const translated=translationEditor(r,['title']),details=el('details');details.append(tr('summary','translations'),translated.section);
-      const entry={title:title.input,url:url.input,attachmentId:r.attachmentId,kind:kind.input,translations:translated.value};resourceInputs.push(entry);
+      const september=septemberTick?field('septemberOnly',r.septemberOnly===true,'checkbox'):null;
+      const entry={title:title.input,url:url.input,attachmentId:r.attachmentId,kind:kind.input,translations:translated.value,septemberOnly:september?.input};resourceInputs.push(entry);
       row.append(title.wrap);
       if(r.attachmentId){const download=tr('a','downloadFile');download.href='/api/course-attachments/'+encodeURIComponent(r.attachmentId);row.append(download);}else row.append(url.wrap);
-      row.append(kind.wrap,details,button('remove',()=>{row.remove();resourceInputs=resourceInputs.filter(x=>x!==entry);dirty.add(form);},true));rows.append(row);
+      row.append(kind.wrap,...(september?[september.wrap]:[]),details,button('remove',()=>{row.remove();resourceInputs=resourceInputs.filter(x=>x!==entry);dirty.add(form);},true));rows.append(row);
     }
     for(const resource of record?.resources||[])add(resource,false);
     resources.append(rows,button('addResource',()=>add(),true));
@@ -123,7 +125,7 @@ function makeEditor(record,module,courseId,onSaved){
     try{
       const body=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value]));
       body.translations=translations.value();if(record)body.version=record.version;
-      if(module){body.resources=resourceInputs.map(r=>({title:r.title.value,...(r.attachmentId?{attachmentId:r.attachmentId}:{url:r.url.value}),kind:r.kind.value,translations:r.translations()}));if(body.resources.some(r=>!r.attachmentId&&!window.nodalPilot.safeUrl(r.url)))throw new Error(t('urlError'));}
+      if(module){body.resources=resourceInputs.map(r=>({title:r.title.value,...(r.attachmentId?{attachmentId:r.attachmentId}:{url:r.url.value}),kind:r.kind.value,translations:r.translations(),...(r.septemberOnly?.checked?{septemberOnly:true}:{})}));if(body.resources.some(r=>!r.attachmentId&&!window.nodalPilot.safeUrl(r.url)))throw new Error(t('urlError'));}
       const path=module?endpoint(courseId)+'/modules'+(record?'/'+record.id:''):endpoint(record?.id);
       const result=await api(path,body,record?'PATCH':'POST'),saved=result.course||result.module;if(record)Object.assign(record,saved);else record=saved;submit.dataset.pilotText='save';submit.textContent=t('save');status(local,t('saved'));dirty.delete(form);await onSaved(saved);await refreshFiles();
     }catch(err){
@@ -134,7 +136,7 @@ function makeEditor(record,module,courseId,onSaved){
           try{
             const result=await api(module?'/api/courses/'+courseId+'/modules/'+record.id:'/api/courses/'+record.id);
             const fresh=result.module||result.course;
-            dirty.delete(form);form.replaceWith(makeEditor(fresh,module,courseId,onSaved));await onSaved(fresh);
+            dirty.delete(form);form.replaceWith(makeEditor(fresh,module,courseId,onSaved,septemberTick));await onSaved(fresh);
           }catch(error){status(local,error);reload.disabled=false;}
         },true);reload.dataset.reload='true';form.append(reload);
       }
@@ -397,7 +399,7 @@ function finalSurveyView(id,version){
   return {element:pane,open(){if(busy||(requested&&Date.now()-loadedAt<60000))return;requested=true;load().then(ok=>{if(!ok)requested=false;});}};
 }
 
-function setupView(course,modules,id,onCourseSaved){
+function setupView(course,modules,id,onCourseSaved,septemberTick=false){
   const pane=el('section','pilot-setup');
   const courseDetails=el('details','pilot-editor-section');
   courseDetails.append(tr('summary','courseSetup'),makeEditor(course,false,null,onCourseSaved));
@@ -413,7 +415,7 @@ function setupView(course,modules,id,onCourseSaved){
       if(current)Object.assign(current,saved);else current=saved;
       updateSummary();
       if(!initial&&!created){created=true;pane.append(moduleEditor());}
-    }));
+    },septemberTick));
     return details;
   }
   for(const module of modules)pane.append(moduleEditor(module));
@@ -423,7 +425,7 @@ function setupView(course,modules,id,onCourseSaved){
 async function showCourse(id,selected='responses',participantNotice=null){
   const version=++selectionVersion;selectedId=id;status(msg,t('loading'));
   try{
-    const [{course,modules,finalSurvey},data]=await Promise.all([api('/api/courses/'+id),api(endpoint(id)+'/report')]);
+    const [{course,modules,finalSurvey,perkCourse},data]=await Promise.all([api('/api/courses/'+id),api(endpoint(id)+'/report')]);
     if(version!==selectionVersion)return;
     workspace.replaceChildren();dirty.clear();
     const header=el('header','pilot-teaching-course');
@@ -455,7 +457,7 @@ async function showCourse(id,selected='responses',participantNotice=null){
     }
     // The course page sends finalSurvey only for the one course that has the survey, so only that course gets the tab.
     const survey=finalSurvey?finalSurveyView(id,version):null;
-    const panes={responses:responseView(data.feedback,id,new Map(modules.map(m=>[m.id,m]))),participants:participantView(data,id,version,participantNotice,refreshParticipants,paneClosed),...(survey?{finalSurvey:survey.element}:{}),courseSetup:setupView(course,modules,id,updateCourse)};
+    const panes={responses:responseView(data.feedback,id,new Map(modules.map(m=>[m.id,m]))),participants:participantView(data,id,version,participantNotice,refreshParticipants,paneClosed),...(survey?{finalSurvey:survey.element}:{}),courseSetup:setupView(course,modules,id,updateCourse,perkCourse===true)};
     const buttons={};
     function activate(key){
       for(const name of Object.keys(panes)){
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-september-items.test.js tests/courses-ui.test.js tests/deploy.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/courses-api.js server/courses-domain.js tests/course-september-items.test.js tests/courses-ui.test.js tests/deploy.test.js web/pages/course.html web/pages/courses.html web/pages/dashboard.html web/pages/opportunities.html web/pages/payments.html web/pages/profile.html web/pages/teaching.html web/scripts/pilot-i18n.js web/scripts/teaching.js
git commit -m "Let the teaching team keep course materials to the September group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The final survey stays with the September group

**Files:**
- Modify: `server/course-final-survey.js`
- Test (new): `tests/course-fiiu-survey.test.js`

**Interfaces:**
- Consumes (from Task 1): the `perks` option that `createCourseApi` already passes to `createFinalSurvey({...,log,perks})`, with `perks.applies(courseId) -> boolean` and `perks.inSeptemberGroup(enrollment) -> boolean` (true when `Date.parse(enrollment.createdAt) < Date.parse('2026-10-01T00:00:00Z')`; an unreadable date is not September). Also `createCoursePerks({perk})` and `FIIU_COURSE_PERK` from `server/course-perks.js` (tests only), plus `createCourseApi({store,userRepository,sameOrigin,finalSurvey,clock,perks})`.
- Produces: one internal helper in `createFinalSurvey`, `joinedLater(courseId,enrollment) -> boolean` = `perks.applies(courseId)&&!perks.inSeptemberGroup(enrollment)`. No new exports. Behaviour on the perk course for a non-staff enrolment that is not the September group's:
  - `snapshot(...)` returns `null`, so `GET /api/courses/:id` has no `finalSurvey` key and the surveys/certificates reads are skipped.
  - `PUT /api/courses/:id/survey/start` and `POST /api/courses/:id/survey` answer `403 {code:'survey_unavailable'}`. This comes before the `survey_closed` check, so it is the same answer after the close.
  - `PUT /api/admin/courses/:id/certificates/:userId` answers `404 {code:'certificate_not_enrolled'}`.
  - `roster()` drops those enrolments before it reads any profiles. That covers `GET /api/admin/courses/:id/final-survey` (`total/answered/started/certificates/participants`) and both CSV exports (`type=survey`, `type=survey-status`).
- Not changed: the member route `GET .../certificate` (a later joiner can never get a submitted response, so it stays `404 certificate_unavailable`, which is tested), the organiser GET/DELETE certificate routes, staff behaviour, and every other course.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task5-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task5-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-fiiu-survey.test.js b/tests/course-fiiu-survey.test.js
new file mode 100644
index 0000000..8dd09e1
--- /dev/null
+++ b/tests/course-fiiu-survey.test.js
@@ -0,0 +1,134 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import http from 'node:http';
+import {once} from 'node:events';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {normalizeCourse} from '../server/courses-domain.js';
+import {FINAL_SURVEY} from '../server/course-final-survey.js';
+import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';
+
+/* The final survey and its certificates stay with the September group of the perk course
+   (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, "Final survey and certificates"). */
+const OPEN_AT=Date.parse('2026-10-20T15:00:00.000Z'),CLOSES=Date.parse(FINAL_SURVEY.closesAt);
+const pdf=text=>Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
+const upload=bytes=>({mime:'application/pdf',data:bytes.toString('base64')});
+const ANSWERS=Object.freeze({
+ overallWithoutSchedule:'muy_buena',
+ aspects:{content:'satisfecho',teachers:'muy_satisfecho',fieldwork:'no_aplica',schedule:'insatisfecho',access:'neutral',materials:'satisfecho',value:'satisfecho'},
+ pace:{difficulty:'adecuado',sessions:'insuficiente',sessionLength:'adecuada'},
+ application:'bastante',topics:[],valued:[],testimonial:'',gender:'female',age:34,country:'PE',
+});
+// Around the boundary: the last September instant, the first October one, a festival-week joiner, and staff enrolled in October.
+const ENROLLED={ana:'2026-09-05T14:00:00.000Z',bruno:'2026-09-30T23:59:59.999Z',carla:'2026-10-01T00:00:00.000Z',dario:'2026-10-20T14:00:00.000Z',staff:'2026-10-02T00:00:00.000Z'};
+const emails=text=>[...text.matchAll(/\b[a-z]+@example\.test/g)].map(match=>match[0]);
+
+async function setup(t,{enrollmentOpen=false,perkCourse}={}) {
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const users={};
+ for(const [key,fullName,role] of [['staff','Organizer','admin'],['ana','Ana Pérez','member'],['bruno','Bruno Díaz','member'],['carla','Carla Soto','member'],['dario','Darío Ríos','member']])
+  users[key]=toApiUser(createUser(db,{fullName,email:`${key}@example.test`,passwordHash:'test',role}));
+ const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
+ const course=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen}),version:1,createdAt:stamp,updatedAt:stamp});
+ for(const [key,createdAt] of Object.entries(ENROLLED))await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
+ for(const key of ['ana','carla'])await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users[key].id,answers:{fullName:users[key].fullName,profession:'Arquitecta'},updatedAt:stamp});
+ const clock={now:OPEN_AT};
+ const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,
+  finalSurvey:{...FINAL_SURVEY,courseId:course.id},clock:()=>clock.now,perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:perkCourse??course.id}})});
+ const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
+ server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
+ const base=`http://127.0.0.1:${server.address().port}`;
+ const call=async(path,{actor='ana',method='GET',body}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
+ const json=async(...args)=>{const response=await call(...args);return {status:response.status,body:await response.json()};};
+ const p=`/api/courses/${course.id}`,admin=`/api/admin/courses/${course.id}`;
+ const page=async actor=>(await json(p,{actor})).body;
+ const start=(actor,overall='buena')=>json(p+'/survey/start',{actor,method:'PUT',body:{overall}});
+ const submit=actor=>json(p+'/survey',{actor,method:'POST',body:{answers:structuredClone(ANSWERS)}});
+ const put=(actor,key)=>json(`${admin}/certificates/${users[key].id}`,{actor,method:'PUT',body:upload(pdf(key))});
+ const bytesRows=()=>db.prepare('SELECT count(*) AS n FROM course_certificate_bytes').get().n;
+ return {store,users,course,clock,call,json,p,admin,page,start,submit,put,bytesRows};
+}
+const refusal=response=>[response.status,response.body.code];
+
+test('a new joiner gets no survey on the perk course, and start and submit answer 403 survey_unavailable',async t=>{
+ const {store,course,clock,json,p,page,start,submit}=await setup(t);
+ for(const actor of ['carla','dario']) {
+  const body=await page(actor);
+  assert.ok(body.enrollment,actor);assert.equal('finalSurvey' in body,false,actor);
+  assert.deepEqual(refusal(await start(actor)),[403,'survey_unavailable'],actor);
+  assert.deepEqual(refusal(await submit(actor)),[403,'survey_unavailable'],actor);
+  assert.deepEqual(refusal(await json(p+'/certificate',{actor})),[404,'certificate_unavailable'],actor);
+ }
+ // Carla completed the course form: the course is hers, the survey is not.
+ assert.equal((await page('carla')).enrollment.intakeCompleted,true);
+ assert.equal(await store.count('surveys',{courseId:course.id}),0);
+ // The September group, up to its last instant, answers as before; staff keep the preview whenever they enrolled.
+ for(const actor of ['ana','bruno']) {
+  const state=(await page(actor)).finalSurvey;
+  assert.equal(state.preview,false,actor);assert.ok(state.survey,actor);
+  assert.equal((await start(actor)).status,200,actor);assert.equal((await submit(actor)).status,200,actor);
+ }
+ assert.equal((await page('staff')).finalSurvey.preview,true);
+ // After the close a new joiner is still told the survey is not theirs, not that it closed.
+ clock.now=CLOSES;
+ assert.deepEqual(refusal(await start('carla')),[403,'survey_unavailable']);
+ assert.equal('finalSurvey' in await page('carla'),false);
+});
+
+test('the organiser cannot upload a certificate for a new joiner',async t=>{
+ const {store,users,course,json,admin,put,bytesRows}=await setup(t);
+ for(const key of ['carla','dario'])assert.deepEqual(refusal(await put('staff',key)),[404,'certificate_not_enrolled'],key);
+ assert.equal(await store.count('certificates',{courseId:course.id}),0);assert.equal(bytesRows(),0);
+ assert.deepEqual(refusal(await json(`${admin}/certificates/${users.carla.id}`,{actor:'staff'})),[404,'certificate_unavailable']);
+ for(const key of ['ana','bruno'])assert.equal((await put('staff',key)).status,201,key);
+ assert.equal(await store.count('certificates',{courseId:course.id,status:'ready'}),2);
+});
+
+test('the organiser roster, CSVs and counts hold the September group only',async t=>{
+ const {store,users,course,call,json,admin,start,submit,put}=await setup(t);
+ await start('ana');await submit('ana');await start('bruno');await put('staff','ana');
+ // A later joiner's response cannot be made through the API; one stored another way is still left out.
+ const at='2026-10-20T15:00:00.000Z';
+ await store.insert('surveys',{id:randomUUID(),courseId:course.id,userId:users.dario.id,answers:{overall:'buena',...structuredClone(ANSWERS)},submittedAt:at,createdAt:at,updatedAt:at});
+ const status=await json(admin+'/final-survey',{actor:'staff'});
+ assert.equal(status.status,200);
+ assert.deepEqual([status.body.total,status.body.answered,status.body.started,status.body.certificates],[2,1,1,1]);
+ assert.deepEqual(status.body.participants.map(person=>person.email),['ana@example.test','bruno@example.test']);
+ const responses=await call(admin+'/export?type=survey',{actor:'staff'});
+ assert.equal(responses.status,200);assert.deepEqual(emails(await responses.text()),['ana@example.test']);
+ const reminders=await call(admin+'/export?type=survey-status',{actor:'staff'});
+ assert.equal(reminders.status,200);assert.deepEqual(emails(await reminders.text()),['ana@example.test','bruno@example.test']);
+});
+
+test('the September boundary holds with enrolment reopened, and only on the perk course',async t=>{
+ const reopened=await setup(t,{enrollmentOpen:true});
+ assert.equal((await reopened.page('carla')).course.enrollmentOpen,true);
+ assert.equal('finalSurvey' in await reopened.page('carla'),false);
+ assert.deepEqual(refusal(await reopened.start('carla')),[403,'survey_unavailable']);
+ assert.deepEqual(refusal(await reopened.put('staff','dario')),[404,'certificate_not_enrolled']);
+ assert.equal((await reopened.json(reopened.admin+'/final-survey',{actor:'staff'})).body.total,2);
+ // When the survey's course is not the perk course, an October enrolment takes the survey as before.
+ const elsewhere=await setup(t,{perkCourse:randomUUID()});
+ assert.ok((await elsewhere.page('carla')).finalSurvey.survey);
+ assert.equal((await elsewhere.start('carla')).status,200);assert.equal((await elsewhere.submit('carla')).status,200);
+ assert.equal((await elsewhere.put('staff','dario')).status,201);
+ assert.equal((await elsewhere.json(elsewhere.admin+'/final-survey',{actor:'staff'})).body.total,4);
+});
+
+test('the course page reads no survey state for a new joiner or an undated enrolment',async()=>{
+ const COURSE='10000000-0000-4000-8000-000000000001',SEPTEMBER='10000000-0000-4000-8000-000000000003',OCTOBER='10000000-0000-4000-8000-000000000004',UNDATED='10000000-0000-4000-8000-000000000005';
+ const enrolled={[SEPTEMBER]:'2026-09-05T14:00:00.000Z',[OCTOBER]:'2026-10-01T00:00:00.000Z',[UNDATED]:undefined};
+ const calls=[];
+ const store={find:async(name,filter)=>{calls.push(name);if(name==='courses')return[{id:filter.id,status:'published',title:'Course'}];if(name==='enrollments')return filter.userId in enrolled?[{userId:filter.userId,courseId:filter.courseId,createdAt:enrolled[filter.userId]}]:[];if(name==='intakes')return[{answers:{fullName:'Ana',profession:'Arquitecta'}}];return[];},getMembers:async()=>{calls.push('members');return[];}};
+ const api=createCourseApi({store,finalSurvey:{...FINAL_SURVEY,courseId:COURSE},clock:()=>OPEN_AT,perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:COURSE}})});
+ const view=async user=>{calls.length=0;const result={};await api({req:{method:'GET',headers:{}},res:{writeHead:status=>{result.status=status;},end:body=>{result.body=JSON.parse(body);}},url:new URL('/api/courses/'+COURSE,'https://nodal.test'),user});return {...result,reads:[...calls].sort()};};
+ const september=await view({id:SEPTEMBER,permission:'member'});
+ assert.deepEqual(september.reads,['certificates','courses','enrollments','intakes','modules','surveys']);assert.ok(september.body.finalSurvey);
+ for(const id of [OCTOBER,UNDATED]) {
+  const later=await view({id,permission:'member'});
+  assert.equal(later.status,200,id);assert.equal('finalSurvey' in later.body,false,id);
+  assert.deepEqual(later.reads,['courses','enrollments','intakes','modules'],id);
+ }
+});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-fiiu-survey.test.js`
Expected: `# tests 5`, `# pass 0`, `# fail 5`. All five fail on their first perk assertion, not on setup:
1. `carla` / `true !== false`: the new joiner still gets `finalSurvey`.
2. `carla`: `[201, undefined]` where `[404, 'certificate_not_enrolled']` was expected.
3. `[4, …]` where `[2, 1, 1, 1]` was expected: carla and dario are counted in the roster.
4. `true !== false`: the reopened course still gives carla `finalSurvey`.
5. `true !== false`: the October and undated enrolments still get `finalSurvey`.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task5-impl.patch` and apply it with `git apply /tmp/nodal-task5-impl.patch`. It touches only `server/course-final-survey.js`.

```diff
diff --git a/server/course-final-survey.js b/server/course-final-survey.js
index f535ffe..40a740f 100644
--- a/server/course-final-survey.js
+++ b/server/course-final-survey.js
@@ -175,6 +175,8 @@ export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRow
   const isOpen=()=>clock()<closes,stamp=()=>new Date(clock()).toISOString();
   const errorText=error=>error instanceof Error?error.message:String(error??'unknown error');
   const base=()=>({closesAt:config.closesAt,lastDay,open:isOpen(),contactEmail:config.contactEmail});
+  // On the perk course the survey and certificates stay with the September group: a later enrolment has neither.
+  const joinedLater=(courseId,enrollment)=>perks.applies(courseId)&&!perks.inSeptemberGroup(enrollment);
   async function publishAsFor(user,access) {
     return access.intake?publishName(access.intake):publishName(null,(await store.getMembers([user.id]))[0]?.name);
   }
@@ -190,14 +192,14 @@ export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRow
   async function snapshot({courseId,user,access}) {
     if(courseId!==surveyCourse)return null;
     if(isStaff(user)){const state=base();return {...state,preview:true,response:null,certificate:null,publishAs:state.open?publishName(access.intake,user.fullName):'',...(state.open?{survey:SURVEY}:{})};}
-    if(!access.enrollment)return null;
+    if(!access.enrollment||joinedLater(courseId,access.enrollment))return null;
     const [row,ready]=await Promise.all([findOne('surveys',{courseId,userId:user.id}),findOne('certificates',{courseId,userId:user.id,status:'ready'})]);
     return participantState(user,access,row,ready);
   }
   // Enrolled people who are not administrators, with their response, ready certificate and course-form name.
   async function roster(courseId,{forms=false}={}) {
-    const [enrollments,responses,certificates,intakes]=await Promise.all([all('enrollments',{courseId}),all('surveys',{courseId}),all('certificates',{courseId,status:'ready'}),forms?all('intakes',{courseId}):[]]);
-    const members=await membersForRows(enrollments),byUser=rows=>new Map(rows.map(row=>[row.userId,row]));
+    const [enrolled,responses,certificates,intakes]=await Promise.all([all('enrollments',{courseId}),all('surveys',{courseId}),all('certificates',{courseId,status:'ready'}),forms?all('intakes',{courseId}):[]]);
+    const enrollments=enrolled.filter(e=>!joinedLater(courseId,e)),members=await membersForRows(enrollments),byUser=rows=>new Map(rows.map(row=>[row.userId,row]));
     const response=byUser(responses),certificate=byUser(certificates),intake=byUser(intakes);
     return enrollments.filter(e=>!members.get(e.userId)?.staff).map(e=>({userId:e.userId,name:members.get(e.userId)?.name??'',email:members.get(e.userId)?.email??'',enrolledAt:e.createdAt,
       formName:intake.get(e.userId)?.answers?.fullName??'',response:response.get(e.userId)??null,certificate:certificate.get(e.userId)??null}))
@@ -223,7 +225,7 @@ export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRow
   async function upload(req,res,courseId,userId) {
     const input=await bodyJson(req,4*1024*1024+4096);
     const [enrollment,member]=await Promise.all([findOne('enrollments',{courseId,userId}),store.getMembers([userId]).then(rows=>rows[0])]);
-    if(!enrollment||!member||member.staff)refuse(404,'certificate_not_enrolled','this person is not a participant of this course');
+    if(!enrollment||!member||member.staff||joinedLater(courseId,enrollment))refuse(404,'certificate_not_enrolled','this person is not a participant of this course');
     if(input.mime!=='application/pdf'||typeof input.data!=='string')refuse(400,'certificate_invalid','a PDF of up to 3 MB is required');
     let file;
     try { file=decodeAttachment({name:'certificado.pdf',mime:'application/pdf',data:input.data}); }
@@ -260,7 +262,7 @@ export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRow
     if(adminPath&&!isStaff(user))refuse(403,'admin_required','administrator access required');
     if(courseId!==surveyCourse)refuse(404,'survey_unavailable','survey unavailable');
     if(['start','submit'].includes(name)) {
-      if(isStaff(user)||!access.enrollment)refuse(403,'survey_unavailable','the survey is for enrolled participants');
+      if(isStaff(user)||!access.enrollment||joinedLater(courseId,access.enrollment))refuse(403,'survey_unavailable','the survey is for enrolled participants');
       if(!isOpen())refuse(403,'survey_closed','the survey is closed');
       const body=await bodyJson(req),filters={courseId,userId:user.id};
       if(name==='start') {
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-fiiu-survey.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/course-final-survey.js tests/course-fiiu-survey.test.js
git commit -m "Keep the course's final survey and certificates with its September group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Organisers can tell the two groups apart

**Files:**
- Modify: `server/courses-api.js`
- Test (new): `tests/course-fiiu-report.test.js`
- Test (modify): `tests/course-participants-ui.test.js`
- Modify: `web/scripts/pilot-i18n.js`
- Modify: `web/scripts/teaching.js`

**Interfaces:**
- Consumes (from Task 1, inside `createCourseApi`):
  - `perks.applies(courseId) -> boolean`
  - `perks.inSeptemberGroup({createdAt}) -> boolean`
- Consumes (in tests): `FIIU_COURSE_PERK` and `createCoursePerks({perk})` from `server/course-perks.js`.
- Produces:
  - **Report.** On the perk course only, each `report().participants[i]` gains `group: 'september' | 'october'`, decided by enrolment `createdAt` before or after `2026-10-01T00:00:00Z`. On every other course the key is absent. This shows in `GET /api/admin/courses/:id/report`.
  - **CSV.** On the perk course only, `GET /api/admin/courses/:id/export?type=participants` gains a trailing `group` column whose values are the spec's labels, `September 2026` / `From October`. On every other course the header stays exactly `userId,name,email,enrolledAt,intakeCompleted`. The intake CSV is unchanged.
  - **Teaching table.** The table shows a Group column (after Enrolled) only when some participant carries `group`. Each cell is the `groupSeptember` or `groupOctober` key.
  - **i18n.** New pilot-i18n keys `group`, `groupSeptember` and `groupOctober`.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task6-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task6-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-fiiu-report.test.js b/tests/course-fiiu-report.test.js
new file mode 100644
index 0000000..e42678b
--- /dev/null
+++ b/tests/course-fiiu-report.test.js
@@ -0,0 +1,77 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import http from 'node:http';
+import {once} from 'node:events';
+import {randomUUID} from 'node:crypto';
+import {createDatabase,createUser,toApiUser} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {normalizeCourse} from '../server/courses-domain.js';
+import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';
+
+// CSV bodies start with a UTF-8 byte order mark (Excel then reads them as UTF-8); fetch's text() would drop it.
+async function parseCsv(response) {
+ const bytes=Buffer.from(await response.arrayBuffer());
+ assert.deepEqual([...bytes.subarray(0,3)],[0xef,0xbb,0xbf]);
+ const text=bytes.toString('utf8',3),rows=[];let row=[],cell='',quoted=false;
+ for(let i=0;i<text.length;i++){
+  const c=text[i];
+  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
+  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;
+ }
+ row.push(cell);rows.push(row);return rows;
+}
+
+/* The perk course (its real id) and another course. Ana and Bruno enrolled in September, Bruno at the last instant
+   before the boundary; Carla exactly at it and Dora during the festival. Ana and Carla are on the other course too. */
+const ENROLLED={ana:'2026-09-05T14:00:00.000Z',bruno:'2026-09-30T23:59:59.999Z',carla:'2026-10-01T00:00:00.000Z',dora:'2026-10-19T15:30:00.000Z'};
+const OTHER_COURSE=randomUUID();
+async function setup(t,apiOptions={}) {
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const users={};
+ for(const [key,fullName,role] of [['staff','Organizer','admin'],['ana','Ana Pérez','member'],['bruno','Bruno Díaz','member'],['carla','Carla Soto','member'],['dora','Dora Ruiz','member']])
+  users[key]=toApiUser(createUser(db,{fullName,email:`${key}@example.test`,passwordHash:'test',role}));
+ const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
+ const course=await store.insert('courses',{id:FIIU_COURSE_PERK.courseId,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:stamp,updatedAt:stamp});
+ const otherCourse=await store.insert('courses',{id:OTHER_COURSE,...normalizeCourse({title:'Otro curso',status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
+ for(const [key,createdAt] of Object.entries(ENROLLED))await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
+ for(const key of ['ana','carla'])await store.insert('enrollments',{id:randomUUID(),courseId:otherCourse.id,userId:users[key].id,createdAt:ENROLLED[key]});
+ const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,...apiOptions});
+ const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
+ server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
+ const base=`http://127.0.0.1:${server.address().port}`;
+ const call=(path,actor='staff')=>fetch(base+path,{headers:{Cookie:actor,Origin:base}});
+ const report=async id=>(await(await call(`/api/admin/courses/${id}/report`)).json()).participants;
+ const exported=async(id,type)=>{const response=await call(`/api/admin/courses/${id}/export?type=${type}`);assert.equal(response.status,200);return parseCsv(response);};
+ return {users,course,otherCourse,call,report,exported};
+}
+
+test('on the perk course the report puts each participant in the September group or From October, by enrolment date',async t=>{
+ const {users,course,otherCourse,call,report}=await setup(t);
+ assert.deepEqual((await report(course.id)).map(p=>[p.name,p.enrolledAt,p.group]),[
+  ['Ana Pérez',ENROLLED.ana,'september'],['Bruno Díaz',ENROLLED.bruno,'september'],['Carla Soto',ENROLLED.carla,'october'],['Dora Ruiz',ENROLLED.dora,'october'],
+ ]);
+ // Another course reports no group at all, and members still cannot read the report.
+ const other=await report(otherCourse.id);
+ assert.deepEqual(other.map(p=>p.userId),[users.ana.id,users.carla.id]);assert.ok(other.every(p=>!('group' in p)));
+ assert.equal((await call(`/api/admin/courses/${course.id}/report`,'ana')).status,403);
+});
+
+test('the participants CSV ends with a group column on the perk course only, and the intake CSV is unchanged',async t=>{
+ const {users,course,otherCourse,exported}=await setup(t);
+ const rows=await exported(course.id,'participants');
+ assert.deepEqual(rows[0],['userId','name','email','enrolledAt','intakeCompleted','group']);
+ assert.deepEqual(rows.slice(1).map(row=>[row[0],row[3],row[4],row[5]]),[
+  [users.ana.id,ENROLLED.ana,'false','September 2026'],[users.bruno.id,ENROLLED.bruno,'false','September 2026'],[users.carla.id,ENROLLED.carla,'false','From October'],[users.dora.id,ENROLLED.dora,'false','From October'],
+ ]);
+ const other=await exported(otherCourse.id,'participants');
+ assert.deepEqual(other[0],['userId','name','email','enrolledAt','intakeCompleted']);assert.ok(other.slice(1).every(row=>row.length===5));
+ assert.equal((await exported(course.id,'intake'))[0].includes('group'),false);
+});
+
+test('the group follows the course the perk names, in any letter case',async t=>{
+ const {course,otherCourse,report,exported}=await setup(t,{perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:OTHER_COURSE.toUpperCase()}})});
+ assert.ok((await report(course.id)).every(p=>!('group' in p)));assert.equal((await exported(course.id,'participants'))[0].length,5);
+ assert.deepEqual((await report(otherCourse.id)).map(p=>p.group),['september','october']);
+ assert.deepEqual((await exported(otherCourse.id,'participants')).slice(1).map(row=>row[5]),['September 2026','From October']);
+});
diff --git a/tests/course-participants-ui.test.js b/tests/course-participants-ui.test.js
index a9062a6..b27baa6 100644
--- a/tests/course-participants-ui.test.js
+++ b/tests/course-participants-ui.test.js
@@ -37,8 +37,8 @@ const course={id:'c1',title:'Mobility course',description:'Course',status:'publi
 const findKey=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
 const byName=(node,name)=>descendants(node).find(n=>n.name===name);
 const participantForm=h=>descendants(h.body).find(n=>n.className==='pilot-form pilot-participant-form');
-function teachingHarness(write,{invitations=[],courses=[course]}={}){
- const h=harness((path,options)=>options?.method==='POST'?write(path,JSON.parse(options.body)):path==='/api/admin/courses'?{courses}:path.endsWith('/report')?{summary:{enrolled:0},participants:[],feedback:[],invitations}:{course:courses.find(c=>path.endsWith('/'+c.id))||course,modules:[]},{page:'teaching'});h.run('teaching');return h;
+function teachingHarness(write,{invitations=[],courses=[course],participants=[]}={}){
+ const h=harness((path,options)=>options?.method==='POST'?write(path,JSON.parse(options.body)):path==='/api/admin/courses'?{courses}:path.endsWith('/report')?{summary:{enrolled:participants.length},participants,feedback:[],invitations}:{course:courses.find(c=>path.endsWith('/'+c.id))||course,modules:[]},{page:'teaching'});h.run('teaching');return h;
 }
 test('adding a participant performs only explicit enrollment and preserves translated success after refresh',async()=>{
  const h=teachingHarness(()=>({result:'enrolled',participant:{id:'u1'}}));await flush();h.ctx.document.getElementById('staff-tab-participants').listeners.click();const form=participantForm(h);assert.notEqual(form.parent.open,true,'the add panel starts closed');byName(form,'email').value=' person@example.test ';await form.listeners.submit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.requests.find(r=>r.method==='POST').path,'/api/admin/courses/c1/participants');assert.deepEqual(h.requests.find(r=>r.method==='POST').body,{email:'person@example.test'});assert.equal(h.ctx.document.getElementById('staff-pane-participants').hidden,false);assert.match(content(h.body),/Participant added with student access/);h.lang('pt');assert.match(content(h.body),/Participante adicionado como estudante/);
@@ -111,6 +111,18 @@ test('saving the Enrollment open toggle refreshes the participants pane and cour
  byName(again,'enrollmentOpen').checked=true;await again.listeners.submit({preventDefault(){}});await flush();
  assert.deepEqual(reports,[true,false,true]);assert.ok(participantForm(h));assert.doesNotMatch(content(h.body),/Enrollment closed/);
 });
+test('the perk course table shows each participant\'s group in three languages, and other courses keep three columns',async()=>{
+ const people=[{userId:'u1',name:'Ana',email:'ana@example.test',enrolledAt:'2026-09-05T14:00:00.000Z',intake:null},{userId:'u2',name:'Dora',email:'dora@example.test',enrolledAt:'2026-10-19T15:30:00.000Z',intake:null}];
+ const table=h=>descendants(h.ctx.document.getElementById('staff-pane-participants')).find(n=>n.tagName==='table');
+ const heads=h=>table(h).children[0].children.map(n=>n.textContent),groups=h=>table(h).children.slice(1).map(row=>row.children[2].textContent);
+ const h=teachingHarness(()=>({}),{participants:people.map((p,i)=>({...p,group:['september','october'][i]}))});await flush();
+ assert.deepEqual(heads(h),['Participant','Enrolled','Group','Intake responses']);assert.deepEqual(groups(h),['September 2026','From October']);
+ h.lang('es');assert.deepEqual(heads(h),['Participante','Inscrito','Grupo','Respuestas del formulario inicial']);assert.deepEqual(groups(h),['Septiembre 2026','Desde octubre']);
+ h.lang('pt');assert.deepEqual(heads(h),['Participante','Inscrito','Turma','Respostas do formulário inicial']);assert.deepEqual(groups(h),['Setembro 2026','Desde outubro']);
+ const plain=teachingHarness(()=>({}),{participants:people});await flush();
+ assert.deepEqual(heads(plain),['Participant','Enrolled','Intake responses']);assert.ok(table(plain).children.slice(1).every(row=>row.children.length===3));
+ assert.equal(findKey(plain.body,'group'),undefined);
+});
 
 // transport: errors the next requests' fetch rejects with, in order (a dropped connection, a timeout), before any reply.
 function acceptanceHarness({hash='#token_hash='+ 'a'.repeat(56),reply=async()=>({passwordChanged:true,courseIds:['00000000-0000-4000-8000-000000000001']}),transport=[]}={}){
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test tests/course-fiiu-report.test.js tests/course-participants-ui.test.js
```
Expected: `# tests 28`, `# pass 24`, `# fail 4`.
- All three tests in `course-fiiu-report.test.js` fail with `AssertionError`:
  - In the report, `p.group` is `undefined` where `'september'`/`'october'` was expected.
  - The participants CSV header has no `'group'`.
- The new UI test fails because the header is `['Participant','Enrolled','Intake responses']` and is missing `'Group'`.
- The 24 existing UI tests still pass with the new `participants=[]` default.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task6-impl.patch` and apply it with `git apply /tmp/nodal-task6-impl.patch`. It touches only `server/courses-api.js`, `web/scripts/pilot-i18n.js`, `web/scripts/teaching.js`.

```diff
diff --git a/server/courses-api.js b/server/courses-api.js
index 3d07eef..b23c072 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -178,6 +178,8 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     return rows.map(row=>({...row,name:members.get(row.userId)?.name??'',email:members.get(row.userId)?.email??''}));
   }
   const feedbackCsv = rows => [['date','userId','name','email','action','courseId','moduleId','rating','comment'],...rows.map(f=>[f.createdAt,f.userId,f.name,f.email,f.action,f.courseId,f.moduleId,f.rating,f.comment])];
+  // The group column (perk course only) comes last, so spreadsheets built on the older export keep their column positions.
+  const participantsCsv = (rows,grouped) => [['userId','name','email','enrolledAt','intakeCompleted',...(grouped?['group']:[])],...rows.map(p=>[p.userId,p.name,p.email,p.enrolledAt,Boolean(p.intake),...(grouped?[p.group==='september'?'September 2026':'From October']:[])])];
   async function report(courseId,exportType=null) {
     const max=exportType?Infinity:500;
     const needsParticipants=!exportType||['participants','intake'].includes(exportType);
@@ -189,9 +191,12 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
     ]);
     const answers=new Map(intakes.map(row=>[row.userId,row.answers]));
     const members=await membersForRows([...enrollments,...feedback]);
+    // The perk course tells its September group from later joiners by enrolment date, not by FIIU: a reopened course admits anyone.
+    const grouped=perks.applies(courseId);
     const participants=enrollments.map(enrollment=>{
       const user=members.get(enrollment.userId);
-      return {userId:enrollment.userId,name:user?.name??'',email:user?.email??'',enrolledAt:enrollment.createdAt,intake:answers.get(enrollment.userId)??null};
+      return {userId:enrollment.userId,name:user?.name??'',email:user?.email??'',enrolledAt:enrollment.createdAt,intake:answers.get(enrollment.userId)??null,
+        ...(grouped?{group:perks.inSeptemberGroup(enrollment)?'september':'october'}:{})};
     });
     const livePosts=posts.filter(post=>!post.deletedAt&&post.userId);
     return {
@@ -386,7 +391,7 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
       const result=await report(courseId,suffix==='/export'?type:null);
       if(suffix==='/report') { const {events,posts,...view}=result;send(res,200,view);return true; }
       if(type==='intake')sendCsv(res,'course-intake',[['userId','name','email',...INTAKE_FIELDS],...result.participants.map(p=>[p.userId,p.name,p.email,...INTAKE_FIELDS.map(k=>p.intake?.[k]??'')])]);
-      else if(type==='participants')sendCsv(res,'course-participants',[['userId','name','email','enrolledAt','intakeCompleted'],...result.participants.map(p=>[p.userId,p.name,p.email,p.enrolledAt,Boolean(p.intake)])]);
+      else if(type==='participants')sendCsv(res,'course-participants',participantsCsv(result.participants,perks.applies(courseId)));
       else if(type==='feedback')sendCsv(res,'course-feedback',feedbackCsv(result.feedback));
       else if(type==='activity')sendCsv(res,'course-activity',[['date','userId','moduleId','action','resourceUrl'],...result.events.map(e=>[e.createdAt,e.userId,e.moduleId,e.kind,e.resourceUrl]),...result.posts.map(p=>[p.createdAt,p.userId,p.moduleId,p.kind,''])]);
       else fail('invalid export type');return true;
diff --git a/web/scripts/pilot-i18n.js b/web/scripts/pilot-i18n.js
index 42923b2..9282eea 100644
--- a/web/scripts/pilot-i18n.js
+++ b/web/scripts/pilot-i18n.js
@@ -241,6 +241,10 @@ const rows = {
  intakeResponses:['Intake responses','Respuestas del formulario inicial','Respostas do formulário inicial'],
  intakeComplete:['Your intake is complete','Tu formulario está completo','Seu formulário está completo'],
  participant:['Participant','Participante','Participante'],
+ // The FIIU perk course's participants table (teaching.js): who enrolled in September and who joined from October.
+ group:['Group','Grupo','Turma'],
+ groupSeptember:['September 2026','Septiembre 2026','Setembro 2026'],
+ groupOctober:['From October','Desde octubre','Desde outubro'],
  feedbackDate:['Date','Fecha','Data'],
  feedbackAction:['Action','Acción','Ação'],
  skipContent:['Skip to content','Saltar al contenido','Pular para o conteúdo'],
diff --git a/web/scripts/teaching.js b/web/scripts/teaching.js
index 157e2c3..8701891 100644
--- a/web/scripts/teaching.js
+++ b/web/scripts/teaching.js
@@ -245,10 +245,13 @@ function participantView(data,id,version,notice,onRefresh,closed=false){
     pending.append(list);section.append(pending);
   }
   const wrap=el('div','pilot-table-wrap'),table=el('table','pilot-table'),head=el('tr');
-  ['participant','enrolled','intakeResponses'].forEach(k=>head.append(tr('th',k)));table.append(head);
+  // Only the FIIU perk course reports a group (September 2026 or From October), so only its table has the column.
+  const grouped=data.participants.some(p=>p.group);
+  ['participant','enrolled',...(grouped?['group']:[]),'intakeResponses'].forEach(k=>head.append(tr('th',k)));table.append(head);
   for(const p of data.participants){
     const row=el('tr'),who=el('td');who.append(el('strong',null,p.name||''),el('div','pilot-response-email',p.email||''));
     row.append(who,dynamic('td',()=>new Date(p.enrolledAt).toLocaleDateString(window.nodalI18n?.lang||'en')));
+    if(grouped)row.append(tr('td',p.group==='september'?'groupSeptember':'groupOctober'));
     const intake=el('td');
     if(p.intake){
       const details=el('details','pilot-intake-response'),dl=el('dl');details.append(tr('summary','intakeResponses'));
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-fiiu-report.test.js tests/course-participants-ui.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/courses-api.js tests/course-fiiu-report.test.js tests/course-participants-ui.test.js web/scripts/pilot-i18n.js web/scripts/teaching.js
git commit -m "Show the September group and the October joiners in the teaching workspace report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The course page and list tell each viewer where they stand

**Files:**
- Modify: `server/courses-api.js`
- Test (new): `tests/course-fiiu-ui.test.js`
- Test (modify): `tests/course-september-items.test.js`
- Test (modify): `tests/deploy.test.js`
- Modify: `web/pages/course.html`
- Modify: `web/pages/courses.html`
- Modify: `web/scripts/courses.js`
- Modify: `web/scripts/pilot-i18n.js`

**Interfaces:**
- **Consumes, from Task 1:** `perks` inside `createCourseApi`. This task only uses `perks.applies(courseId)`. It also uses `FIIU_COURSE_PERK` from `server/course-perks.js`, in the test.
- **Consumes, from Task 2:**
  - `GET /api/courses/:id` carries `join:'fiiu'|'supporters'` only on the closed perk course, for a viewer who is neither staff nor enrolled. Every other answer has no `join`.
  - `GET /api/courses` gives every course `enrolled:boolean`. The closed perk course also carries the same `join` for viewers who are neither staff nor enrolled.
  - `POST /api/courses/:id/enroll` answers 403 `{error:'enrollment is closed',code:'enrollment_closed'}` when the caller is not eligible.
- **Produces, server:** `GET /api/courses/:id` carries `perkCourse:true` on the perk course for every viewer (Task 4 added it for staff only; this task widens it and updates Task 4's test to match): member, staff, enrolled or not, preview or full. The field is absent on every other course.
- **Produces, client (`pilot-i18n.js`):** the keys `fiiuIncluded`, `joinCourse`, `supportersOnly`, `supportersNote`, `fiiuTag`, `enrolledTag` and `sharedSince`. The spec's `septemberOnly`, `groupSeptember`, `groupOctober` and `group` belong to the teaching and report tasks and are **not** added here.
- **Produces, client (`courses.js`):** a module-level helper, `cardLabel(c,staff)`. It returns `'enrolledTag'|'fiiuTag'|'supportersOnly'|'closed'|''`.
- **Cache key:** `courses.js?v=20261018a` on course.html and courses.html, pinned in `tests/deploy.test.js`.

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task7-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task7-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/course-fiiu-ui.test.js b/tests/course-fiiu-ui.test.js
new file mode 100644
index 0000000..877b459
--- /dev/null
+++ b/tests/course-fiiu-ui.test.js
@@ -0,0 +1,152 @@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import vm from 'node:vm';
+import {readFileSync} from 'node:fs';
+import {randomUUID} from 'node:crypto';
+import {createDatabase} from '../server/db.js';
+import {createCourseStore} from '../server/courses-repository.js';
+import {createCourseApi} from '../server/courses-api.js';
+import {normalizeCourse} from '../server/courses-domain.js';
+import {FIIU_COURSE_PERK} from '../server/course-perks.js';
+
+// What each viewer of the closed perk course sees (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, section 2),
+// on the minimal DOM of tests/courses-ui.test.js.
+const script=name=>readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8');
+class Node {
+ constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.hidden=false;this.textContent='';this.value='';this.files=[];this.classList={toggle(){}};}
+ append(...nodes){nodes.forEach(n=>{if(typeof n==='object'){detach(n);n.parent=this;}this.children.push(n);});}
+ prepend(...nodes){nodes.forEach(n=>{detach(n);n.parent=this;});this.children.unshift(...nodes);}
+ after(node){const p=this.parent;if(p){detach(node);node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
+ get firstElementChild(){return this.children.find(n=>typeof n==='object')||null;}
+ get nextElementSibling(){const siblings=this.parent?.children.filter(n=>typeof n==='object')||[],at=siblings.indexOf(this);return at<0?null:siblings[at+1]||null;}
+ replaceChildren(...nodes){this.children=[];this.append(...nodes);}
+ setAttribute(k,v){this[k]=v;}
+ getAttribute(k){return this[k]??null;}
+ removeAttribute(k){delete this[k];}
+ addEventListener(k,f){this.listeners[k]=f;}
+ querySelectorAll(selector){return descendants(this).filter(n=>selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
+ querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
+ remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
+ focus(){this.focused=true;}
+ scrollIntoView(){}
+ reset(){}
+}
+const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
+const detach=node=>{if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);};
+const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
+const keys=node=>descendants(node).map(n=>n.dataset.pilotText).filter(Boolean);
+const find=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
+const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
+function harness(respond,{page='course',search='?id=c1'}={}){
+ const body=new Node('body');body.dataset.page=page;const html=new Node('html');const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
+ const requests=[],listeners=[];
+ const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){}};
+ const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000001'},history:{replaceState(){}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign(){},replace(){}},fetch:async(path,opts)=>{requests.push({path,method:opts?.method});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>result.data??result};},window:{addEventListener(){},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
+ vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
+ return{ctx,body,ids,requests,run:name=>vm.runInContext(script(name),ctx),lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());}};
+}
+const course={id:'c1',title:'Curso Movilidad Nivel 2',description:'Curso',startsOn:'2026-09-09',endsOn:'2026-09-30',status:'published',enrollmentOpen:false};
+const modules=[{id:'m1',title:'Published session',sessionDate:'2026-09-09'}];
+const preview=join=>({course,modules,enrollment:null,intake:null,isAdmin:false,perkCourse:true,join});
+const member=answer=>(path,opts)=>path==='/api/auth/me'?{user:{permission:'member'}}:answer(path,opts);
+
+test('a FIIU Fest 11 registrant is told the closed perk course is included, and joining leads to the intake form',async()=>{
+ let enrolled=false;
+ const h=harness(member(path=>{if(path.endsWith('/enroll')){enrolled=true;return{enrollment:{id:'e1'}};}return enrolled?{course,modules,enrollment:{id:'e1'},intake:null,isAdmin:false,perkCourse:true}:preview('fiiu');}));h.run('courses');await flush();
+ assert.ok(keys(h.body).includes('fiiuIncluded'));
+ for(const key of ['closed','closedNote','enroll','supportersOnly','supportersNote','switchAccount'])assert.equal(keys(h.body).includes(key),false,key);
+ assert.match(content(h.body),/Included with your FIIU Fest 11 registration\./);assert.match(content(h.body),/1\. Published session/);
+ const join=find(h.body,'joinCourse');assert.equal(join.tagName,'button');assert.equal(join.textContent,'Join the course');
+ h.lang('es');assert.match(content(h.body),/Incluido con tu inscripción al FIIU Fest 11\./);assert.equal(join.textContent,'Unirme al curso');
+ h.lang('pt');assert.match(content(h.body),/Incluído na sua inscrição no FIIU Fest 11\./);assert.equal(join.textContent,'Entrar no curso');
+ h.lang('en');assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
+ await join.listeners.click();await flush();
+ assert.deepEqual(h.requests.filter(r=>r.method).map(r=>[r.method,r.path]),[['POST','/api/courses/c1/enroll']]);
+ assert.match(content(h.body),/Your intake is private/);assert.equal(descendants(h.body).filter(n=>n.tagName==='form').length,1);
+ assert.equal(keys(h.body).includes('joinCourse'),false);assert.equal(h.requests.some(r=>r.path.includes('/modules/')),false);
+});
+
+test('anyone else sees the closed perk course is for Supporters, with no way to join and no payment link',async()=>{
+ const h=harness(member(()=>preview('supporters')));h.run('courses');await flush();
+ for(const key of ['supportersOnly','supportersNote'])assert.ok(keys(h.body).includes(key),key);
+ for(const key of ['enroll','joinCourse','fiiuIncluded','closed','closedNote','switchAccount'])assert.equal(keys(h.body).includes(key),false,key);
+ assert.deepEqual(descendants(h.body).filter(n=>n.tagName==='a').map(n=>n.href),['courses.html']);
+ assert.match(content(h.body),/For Supporters/);assert.match(content(h.body),/This course is part of the Supporting membership, which opens soon\. People already enrolled keep full access\./);assert.match(content(h.body),/1\. Published session/);
+ h.lang('es');assert.match(content(h.body),/Para la membresía de apoyo/);assert.match(content(h.body),/Este curso forma parte de la membresía de apoyo, que abre pronto\. Quienes ya están inscritos conservan el acceso completo\./);
+ h.lang('pt');assert.match(content(h.body),/Para a assinatura de apoio/);assert.match(content(h.body),/Este curso faz parte da assinatura de apoio, que abre em breve\. Quem já está inscrito mantém o acesso completo\./);
+ assert.equal(h.requests.some(r=>r.method||r.path.includes('/modules/')),false);
+});
+
+test('the survey reminder link opened with a FIIU-registered account that is not enrolled offers another account, never Join',async()=>{
+ const h=harness(member(()=>preview('fiiu')),{search:'?id=c1&encuesta=1'});h.run('courses');await flush();
+ for(const key of ['fiiuIncluded','surveyUnavailable','surveyOtherAccount','switchAccount'])assert.ok(keys(h.body).includes(key),key);
+ for(const key of ['joinCourse','enroll','closed','closedNote'])assert.equal(keys(h.body).includes(key),false,key);
+ // The Supporters state keeps the helper too, as any closed course does.
+ const supporters=harness(member(()=>preview('supporters')),{search:'?id=c1&encuesta=1'});supporters.run('courses');await flush();
+ for(const key of ['supportersNote','switchAccount'])assert.ok(keys(supporters.body).includes(key),key);
+ assert.equal(keys(supporters.body).includes('joinCourse'),false);
+ assert.equal([...h.requests,...supporters.requests].some(r=>r.method),false);
+});
+
+test('a Join refused because the registration no longer qualifies reads the course again instead of keeping the old offer',async()=>{
+ let reads=0;
+ const h=harness(member((path,opts)=>{if(opts?.method==='POST')return{status:403,data:{error:'enrollment is closed',code:'enrollment_closed'}};reads++;return preview(reads===1?'fiiu':'supporters');}));h.run('courses');await flush();
+ await find(h.body,'joinCourse').listeners.click();await flush();
+ assert.equal(h.requests.filter(r=>r.path.endsWith('/enroll')).length,1);assert.equal(h.requests.filter(r=>r.path==='/api/courses/c1').length,2);
+ for(const key of ['supportersOnly','supportersNote'])assert.ok(keys(h.body).includes(key),key);
+ for(const key of ['joinCourse','fiiuIncluded','closed'])assert.equal(keys(h.body).includes(key),false,key);
+ // If that read fails too, the offer stays with its button enabled and the status line says why.
+ let failing=0;
+ const offline=harness(member((path,opts)=>opts?.method==='POST'?{status:403,data:{error:'enrollment is closed',code:'enrollment_closed'}}:++failing===1?preview('fiiu'):{status:503,data:{error:'unavailable'}}));offline.run('courses');await flush();
+ const join=find(offline.body,'joinCourse');await join.listeners.click();await flush();
+ assert.equal(find(offline.body,'joinCourse'),join);assert.equal(join.disabled,false);assert.equal(offline.ids.pilotStatus.textContent,'Could not complete this request.');
+});
+
+test('each course card says where the viewer stands: enrolled, included with FIIU, for Supporters or closed',async()=>{
+ const card={...course,enrollmentOpen:true,enrolled:false};
+ const courses=[{...card,id:'open'},{...card,id:'mine',enrollmentOpen:false,enrolled:true},{...card,id:'perk',enrollmentOpen:false,join:'fiiu'},{...card,id:'paid',enrollmentOpen:false,join:'supporters'},{...card,id:'finished',enrollmentOpen:false},{...card,id:'joined',enrolled:true}];
+ const LABELS=['enrolledTag','fiiuTag','supportersOnly','closed'];
+ const labels=body=>descendants(body).filter(n=>n.className==='pilot-course-row').map(row=>descendants(row).filter(n=>LABELS.includes(n.dataset.pilotText)));
+ const h=harness(member(()=>({courses,isAdmin:false})),{page:'courses',search:''});h.run('courses');await flush();
+ assert.deepEqual(labels(h.body).map(row=>row.map(n=>n.dataset.pilotText)),[[],['enrolledTag'],['fiiuTag'],['supportersOnly'],['closed'],['enrolledTag']]);
+ assert.ok(labels(h.body).flat().every(n=>n.className==='pilot-date'));
+ const texts=()=>labels(h.body).flat().map(n=>n.textContent);
+ assert.deepEqual(texts(),['Enrolled','Included with FIIU','For Supporters','Enrollment closed','Enrolled']);
+ h.lang('es');assert.deepEqual(texts(),['Inscrito','Incluido con el FIIU','Para la membresía de apoyo','Inscripciones cerradas','Inscrito']);
+ h.lang('pt');assert.deepEqual(texts(),['Inscrito','Incluído com o FIIU','Para a assinatura de apoio','Inscrições encerradas','Inscrito']);
+ // Staff see the cards as before: closed or nothing, enrolled or not (the server sends them no join).
+ const staff=harness(member(()=>({courses:courses.map(({join,...c})=>c),isAdmin:true})),{page:'courses',search:''});staff.run('courses');await flush();
+ assert.deepEqual(labels(staff.body).map(row=>row.map(n=>n.dataset.pilotText)),[[],['closed'],['closed'],['closed'],['closed'],[]]);
+});
+
+test('on the perk course the conversation says, above its posts, that September contributions stay with the September group',async()=>{
+ const module={id:'m1',title:'Session',resources:[]};
+ const open=(viewer,perkCourse=true)=>{const h=harness(member(path=>path.endsWith('/events')?{ok:true}:path.includes('/posts')?{posts:[],nextCursor:null}:{course:{...course,enrollmentOpen:true},modules:[module],...viewer,...(perkCourse?{perkCourse:true}:{})}));h.run('courses');return h;};
+ const september={enrollment:{id:'e1',createdAt:'2026-09-06T15:00:00Z'},intake:{fullName:'Member'},isAdmin:false},october={enrollment:{id:'e2',createdAt:'2026-10-19T15:00:00Z'},intake:{fullName:'Member'},isAdmin:false},staff={enrollment:null,intake:null,isAdmin:true};
+ for(const viewer of [september,october,staff]){
+  const h=open(viewer);await flush();
+  for(const pane of ['discussion','assignment']){
+   const section=h.ctx.document.getElementById('module-pane-'+pane),note=find(section,'sharedSince'),list=section.querySelector('.pilot-post-list');
+   assert.ok(note&&list,pane);assert.equal(note.parent,section);assert.ok(section.children.indexOf(note)<section.children.indexOf(list),pane);
+  }
+  const note=find(h.ctx.document.getElementById('module-pane-discussion'),'sharedSince');
+  assert.equal(note.textContent,'Since October, new participants join this conversation. Contributions from September stay visible to the September group only.');
+  h.lang('es');assert.equal(note.textContent,'Desde octubre se suman nuevas personas a esta conversación. Las contribuciones de septiembre solo las ve el grupo de septiembre.');
+  h.lang('pt');assert.equal(note.textContent,'Desde outubro, novas pessoas entram nesta conversa. As contribuições de setembro ficam visíveis só para a turma de setembro.');
+ }
+ const other=open(september,false);await flush();
+ assert.ok(other.ctx.document.getElementById('module-pane-discussion'));assert.equal(keys(other.body).includes('sharedSince'),false);
+});
+
+test('the course answer marks the perk course, and no other, for members and staff',async t=>{
+ const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
+ const store=createCourseStore({db}),stamp='2026-09-01T12:00:00.000Z',other=randomUUID(),answers=[];
+ for(const id of [FIIU_COURSE_PERK.courseId,other])await store.insert('courses',{id,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:stamp,updatedAt:stamp});
+ const api=createCourseApi({store,sameOrigin:()=>true,send:(res,status,body)=>{answers.push({status,body});}});
+ const read=async(id,user)=>{await api({req:{method:'GET',headers:{}},res:{},url:new URL('http://nodal.test/api/courses/'+id),user});return answers.at(-1);};
+ for(const user of [{id:randomUUID(),permission:'member'},{id:randomUUID(),permission:'admin'}]){
+  const perk=await read(FIIU_COURSE_PERK.courseId,user),plain=await read(other,user);
+  assert.equal(perk.status,200);assert.equal(perk.body.perkCourse,true,user.permission);
+  assert.equal(plain.status,200);assert.equal(Object.hasOwn(plain.body,'perkCourse'),false,user.permission);
+ }
+});
diff --git a/tests/course-september-items.test.js b/tests/course-september-items.test.js
index 4a98c93..a12c4a1 100644
--- a/tests/course-september-items.test.js
+++ b/tests/course-september-items.test.js
@@ -99,10 +99,11 @@ test('a new joiner cannot record opening a ticked item, and the September group
  for(const url of ['https://example.test/reading',`/api/course-attachments/${slides.id}`])assert.equal((await open('joiner','content_open',url)).status,200,url);
 });
 
-test('the tick holds after enrolment reopens, and only staff learn which course has a September group',async t=>{
+test('the tick holds after enrolment reopens, and only the perk course is marked as having a September group',async t=>{
  const {call,store,course}=await setup(t);const perk=await course(FIIU_COURSE_PERK.courseId),other=await course(randomUUID());
  await store.update('courses',{id:perk.id},{enrollmentOpen:true});
  assert.deepEqual(titles((await(await call(`/api/courses/${perk.id}/modules/${perk.module.id}`)).json()).module.resources),OPEN_ITEMS);
  for(const path of [`/api/courses/${perk.id}`,`/api/admin/courses/${perk.id}`])assert.equal((await(await call(path,{actor:'staff'})).json()).perkCourse,true,path);
- for(const [actor,id] of [['staff',other.id],['joiner',perk.id],['september',perk.id]])assert.equal('perkCourse' in await(await call(`/api/courses/${id}`,{actor})).json(),false,actor);
+ for(const actor of ['joiner','september'])assert.equal((await(await call(`/api/courses/${perk.id}`,{actor})).json()).perkCourse,true,actor);
+ for(const actor of ['staff','joiner'])assert.equal('perkCourse' in await(await call(`/api/courses/${other.id}`,{actor})).json(),false,actor);
 });
diff --git a/tests/deploy.test.js b/tests/deploy.test.js
index 5d26442..ed112c6 100644
--- a/tests/deploy.test.js
+++ b/tests/deploy.test.js
@@ -329,8 +329,8 @@ test('changed one-hour-cached clients use new URLs on every consuming page', ()
     'payments.html': { 'i18n-dashboard.js': '20261017a', 'i18n.js': '20261013b', 'payments.js': '18', ...pilot },
     'profile.html': { 'i18n-dashboard.js': '20261017a', 'i18n.js': '20261013b', 'profile.js': '20261013b', 'styles.css': '32', ...pilot },
     'admin.html': { 'i18n-dashboard.js': '20261017a', 'styles.css': '32', 'admin.css': '5', 'admin.js': '6', 'i18n.js': '20261013b', 'locale.css': '20260929a', 'locale.js': '20261009a', 'nav.js': '20261013b', 'script.js': '18' },
-    'course.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261016b', ...pilot },
-    'courses.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261016b', ...pilot },
+    'course.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261018a', ...pilot },
+    'courses.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261018a', ...pilot },
     'teaching.html': { 'i18n.js': '20261013b', 'teaching.js': '20261018a', ...pilot },
     'accept-invitation.html': { 'accept-invitation.js': '20261013b', 'invitation-i18n.js': '20261013b' },
     'fiiu.html': { 'styles.css': '32', 'i18n.js': '20261013b', ...festival, 'fiiu-live.js': '20261017a', 'fiiu.js': '20261015b' },
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/course-fiiu-ui.test.js`

Expected: `# tests 7`, `# pass 0`, `# fail 7`. The UI tests fail on the missing keys, for example `'supportersOnly'`, `'fiiuIncluded'` and `'discussion'`, and test 4 cannot find a `joinCourse` button. The server test fails with `member … + undefined - true` on `perkCourse`.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task7-impl.patch` and apply it with `git apply /tmp/nodal-task7-impl.patch`. It touches only `server/courses-api.js`, `web/pages/course.html`, `web/pages/courses.html`, `web/scripts/courses.js`, `web/scripts/pilot-i18n.js`.

```diff
diff --git a/server/courses-api.js b/server/courses-api.js
index b23c072..ce86e12 100644
--- a/server/courses-api.js
+++ b/server/courses-api.js
@@ -342,8 +342,9 @@ export function createCourseApi({store,userRepository,sameOrigin,send=respond,ra
         translations:Object.fromEntries(Object.entries(translations).map(([locale,fields])=>[locale,typeof fields.title==='string'?{title:fields.title}:{}])),
       }));
       else if(newJoinerView(courseId,user,access))modules=modules.map(withoutSeptemberItems);
-      // perkCourse tells the teaching workspace to offer the "September group only" tick, on this course alone.
-      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{}),...(join?{join}:{}),...(isStaff(user)&&perks.applies(courseId)?{perkCourse:true}:{})});return true;
+      // perkCourse marks the course with a September group: the teaching workspace offers the "September group only"
+      // tick, and the conversation shows the sharedSince note.
+      send(res,200,{...access,modules,isAdmin:isStaff(user),...(finalSurvey?{finalSurvey}:{}),...(join?{join}:{}),...(perks.applies(courseId)?{perkCourse:true}:{})});return true;
     }
     if(adminPath&&!suffix&&req.method==='PATCH') {
       const input=await bodyJson(req);
diff --git a/web/pages/course.html b/web/pages/course.html
index 9dfb9d3..797b241 100644
--- a/web/pages/course.html
+++ b/web/pages/course.html
@@ -8,6 +8,6 @@
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
-  <script defer src="courses.js?v=20261016b"></script>
+  <script defer src="courses.js?v=20261018a"></script>
 </head>
 <body class="pilot-page" data-page="course"><a class="pilot-skip" data-pilot-text="skipContent" href="#pilotMain">Skip to content</a><header class="pilot-header"><a class="pilot-brand" href="index.html"><img src="assets/nodal-wordmark.webp" width="360" height="143" alt="NODAL"></a><nav aria-label="Main navigation" data-pilot-aria="mainNavigation"><a href="community.html" data-i18n="nav.community">Community</a><a href="fiiu.html">FIIU Fest</a><a href="courses.html" data-pilot-text="courses">Courses</a><a href="dashboard.html" data-pilot-text="console">My console</a><a href="teaching.html" id="teachingLink" hidden data-pilot-text="teaching">Teaching workspace</a></nav><div class="pilot-langs" role="group" aria-label="Language" data-pilot-aria="language"><button class="lang-btn" data-lang="en" type="button" aria-label="English" data-pilot-aria="english">EN</button><button class="lang-btn" data-lang="es" type="button" aria-label="Español" data-pilot-aria="spanish">ES</button><button class="lang-btn" data-lang="pt" type="button" aria-label="Português" data-pilot-aria="portuguese">PT</button></div></header><div class="pilot-notice" data-pilot-banner hidden><strong data-pilot-text="prototype">Course pilot · Prototype</strong><span data-pilot-text="notice">We are testing this learning space together. Share feedback as you go.</span></div><main class="pilot-main" id="pilotMain"><p class="pilot-status" id="pilotStatus" role="status" aria-live="polite">Loading…</p><div id="pilotRoot"></div></main><footer class="pilot-footer"><a href="privacy.html" data-i18n="nav.privacy">Privacy policy</a></footer></body></html>
diff --git a/web/pages/courses.html b/web/pages/courses.html
index 309c8c2..56737cb 100644
--- a/web/pages/courses.html
+++ b/web/pages/courses.html
@@ -8,6 +8,6 @@
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
-  <script defer src="courses.js?v=20261016b"></script>
+  <script defer src="courses.js?v=20261018a"></script>
 </head>
 <body class="pilot-page" data-page="courses"><a class="pilot-skip" data-pilot-text="skipContent" href="#pilotMain">Skip to content</a><header class="pilot-header"><a class="pilot-brand" href="index.html"><img src="assets/nodal-wordmark.webp" width="360" height="143" alt="NODAL"></a><nav aria-label="Main navigation" data-pilot-aria="mainNavigation"><a href="community.html" data-i18n="nav.community">Community</a><a href="fiiu.html">FIIU Fest</a><a href="courses.html" data-pilot-text="courses">Courses</a><a href="dashboard.html" data-pilot-text="console">My console</a><a href="teaching.html" id="teachingLink" hidden data-pilot-text="teaching">Teaching workspace</a></nav><div class="pilot-langs" role="group" aria-label="Language" data-pilot-aria="language"><button class="lang-btn" data-lang="en" type="button" aria-label="English" data-pilot-aria="english">EN</button><button class="lang-btn" data-lang="es" type="button" aria-label="Español" data-pilot-aria="spanish">ES</button><button class="lang-btn" data-lang="pt" type="button" aria-label="Português" data-pilot-aria="portuguese">PT</button></div></header><div class="pilot-notice" data-pilot-banner hidden><strong data-pilot-text="prototype">Course pilot · Prototype</strong><span data-pilot-text="notice">We are testing this learning space together. Share feedback as you go.</span></div><main class="pilot-main" id="pilotMain"><p class="pilot-status" id="pilotStatus" role="status" aria-live="polite">Loading…</p><div id="pilotRoot"></div></main><footer class="pilot-footer"><a href="privacy.html" data-i18n="nav.privacy">Privacy policy</a></footer></body></html>
diff --git a/web/scripts/courses.js b/web/scripts/courses.js
index 269e6b4..e62e5c8 100644
--- a/web/scripts/courses.js
+++ b/web/scripts/courses.js
@@ -21,7 +21,9 @@ function courseTopics(c){
   const titles=[c?.title,...Object.values(c?.translations||{}).map(fields=>fields?.title)].filter(value=>typeof value==='string').join(' \n ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   return COURSE_TOPICS.filter(([,words])=>words.test(titles)).map(([name])=>name).slice(0,3);
 }
-async function directory(){setPageTitle('courses');const {courses,isAdmin}=await api('/api/courses');document.getElementById('teachingLink').hidden=isAdmin!==true;root.replaceChildren();const hero=el('header','pilot-hero');hero.append(tr('p','courses','pilot-context'),tr('h1','intro'),tr('p','directory'));const list=el('div','pilot-directory');if(!courses.length)list.append(tr('p','emptyCourses','pilot-empty'));courses.forEach(c=>{const row=el('article','pilot-course-row'),meta=el('div'),content=el('div');meta.append(tr('span',c.status,'pilot-tag'),dynamic('div',()=>dates(c),'pilot-date'));if(c.enrollmentOpen===false)meta.append(tr('div','closed','pilot-date'));content.append(source('h2',c,'title'),source('p',c,'description'));const link=tr('a','open','pilot-button');link.href='course.html?id='+encodeURIComponent(c.id);row.append(meta,content,link);list.append(row);});root.append(hero,list);status(msg,'');}
+// One label per card: where this viewer stands on the course. Staff see only whether it is closed, as before.
+const cardLabel=(c,staff)=>staff?(c.enrollmentOpen===false?'closed':''):c.enrolled?'enrolledTag':c.join==='fiiu'?'fiiuTag':c.join==='supporters'?'supportersOnly':c.enrollmentOpen===false?'closed':'';
+async function directory(){setPageTitle('courses');const {courses,isAdmin}=await api('/api/courses');document.getElementById('teachingLink').hidden=isAdmin!==true;root.replaceChildren();const hero=el('header','pilot-hero');hero.append(tr('p','courses','pilot-context'),tr('h1','intro'),tr('p','directory'));const list=el('div','pilot-directory');if(!courses.length)list.append(tr('p','emptyCourses','pilot-empty'));courses.forEach(c=>{const row=el('article','pilot-course-row'),meta=el('div'),content=el('div'),label=cardLabel(c,isAdmin===true);meta.append(tr('span',c.status,'pilot-tag'),dynamic('div',()=>dates(c),'pilot-date'));if(label)meta.append(tr('div',label,'pilot-date'));content.append(source('h2',c,'title'),source('p',c,'description'));const link=tr('a','open','pilot-button');link.href='course.html?id='+encodeURIComponent(c.id);row.append(meta,content,link);list.append(row);});root.append(hero,list);status(msg,'');}
 // course() draws the page again after a save, so the confirmation goes to the status line above the course title, brought
 // into view, and focus to a real element instead of <body>. A session that failed to open keeps its error there.
 function confirmSaved(key,target){if(!msg.textContent)status(msg,t(key));msg.scrollIntoView({block:'start'});target?.focus({preventScroll:true});}
@@ -39,9 +41,13 @@ async function course(fresh){
   const topics=courseTopics(c);
   if(topics.length&&window.Buc){const readings=el('section','pilot-buc');readings.hidden=true;root.append(readings);window.Buc.mount(readings,{topics,context:'course',limit:3,heading:tr('h2','bucReadings')});}
   if(!snapshot.enrollment&&!snapshot.isAdmin){
-    // Closed courses keep their route preview but offer no way in.
-    if(!c.enrollmentOpen){const closed=el('div','pilot-actions');closed.append(tr('strong','closed'),tr('span','closedNote'));if(new URLSearchParams(location.search).get('encuesta')==='1')closed.append(...otherAccount());hero.append(closed);renderRoutePreview();return;}
-    const enroll=button('enroll',async()=>{if(enroll.disabled)return;enroll.disabled=true;try{await api(base()+'/enroll',{});await course();}catch(err){if(err.code==='enrollment_closed')return course({...snapshot,course:{...c,enrollmentOpen:false}});status(msg,err);enroll.disabled=false;}});
+    const fiiu=snapshot.join==='fiiu',reminderLink=new URLSearchParams(location.search).get('encuesta')==='1';
+    // Closed courses keep their route preview but offer no way in, except the perk course to a FIIU Fest 11 registrant
+    // (server/course-perks.js). Never under the survey's reminder link: a September learner's other account must not join by mistake.
+    if(!c.enrollmentOpen&&(!fiiu||reminderLink)){const closed=el('div','pilot-actions');closed.append(...fiiu?[tr('strong','fiiuIncluded')]:snapshot.join==='supporters'?[tr('strong','supportersOnly'),tr('span','supportersNote')]:[tr('strong','closed'),tr('span','closedNote')]);if(reminderLink)closed.append(...otherAccount());hero.append(closed);renderRoutePreview();return;}
+    // A FIIU registrant refused here no longer qualifies (a registration cancelled since this page loaded): read the course again.
+    const enroll=button(fiiu?'joinCourse':'enroll',async()=>{if(enroll.disabled)return;enroll.disabled=true;try{await api(base()+'/enroll',{});await course();}catch(err){if(err.code==='enrollment_closed'&&fiiu)return course().catch(error=>{status(msg,error);enroll.disabled=false;});if(err.code==='enrollment_closed')return course({...snapshot,course:{...c,enrollmentOpen:false}});status(msg,err);enroll.disabled=false;}});
+    if(fiiu){const perk=el('div','pilot-actions');perk.append(tr('strong','fiiuIncluded'));hero.append(perk);}
     hero.append(enroll);renderRoutePreview();return;
   }
   // The final survey comes before the intake gate: an enrolled person without a course form answers it too.
@@ -400,7 +406,9 @@ function createConversation(moduleId,sequence,kind){
   const posts=el('div','pilot-post-list'),updates=el('p','pilot-conversation-updates');updates.setAttribute('role','status');updates.setAttribute('aria-live','polite');
   const refresh=button('refreshConversation',()=>loadPosts(true),true),more=button('loadOlder',()=>loadPosts(false),true);more.hidden=true;
   const composer=makeComposer(moduleId,()=>loadPosts(true,'postPublished'),{kind});
-  heading.append(refresh);section.append(heading,tr('p',kind==='assignment'?'assignmentHelp':'discussionHelp','pilot-data-note'),composer,updates,posts,more);
+  // On the perk course the September posts stay with the September group (server/course-perks.js), and everyone reading is told so.
+  const shared=snapshot.perkCourse?[tr('p','sharedSince','pilot-data-note')]:[];
+  heading.append(refresh);section.append(heading,tr('p',kind==='assignment'?'assignmentHelp':'discussionHelp','pilot-data-note'),...shared,composer,updates,posts,more);
   let cursor=null,loading=false,refreshPending=false,pendingNotice='',loaded=false,active=false,disposed=false,baseline=null,timer=null,pollController=null,pollErrors=0,hasUpdates=false;
   const known=new Set();
   const alive=()=>!disposed&&sequence===loadSequence;
diff --git a/web/scripts/pilot-i18n.js b/web/scripts/pilot-i18n.js
index 9282eea..5488ae8 100644
--- a/web/scripts/pilot-i18n.js
+++ b/web/scripts/pilot-i18n.js
@@ -155,6 +155,14 @@ const rows = {
  invitationUnavailable:["The invitation email could not be sent. Try again later.", "No se pudo enviar el correo de invitación. Inténtalo más tarde.", "Não foi possível enviar o e-mail de convite. Tente novamente mais tarde."],
  invitationUncertain:["We could not confirm whether the invitation was sent. Check with the participant before sending another email.", "No pudimos confirmar si la invitación se envió. Consulta con el participante antes de enviar otro correo.", "Não foi possível confirmar se o convite foi enviado. Consulte a pessoa antes de enviar outro e-mail."],
  closedNote:['This course is no longer accepting new participants. Enrolled participants keep full access to sessions and materials.','Este curso ya no recibe nuevas inscripciones. Las personas inscritas conservan el acceso a las sesiones y materiales.','Este curso não recebe mais novas inscrições. Quem já está inscrito mantém o acesso às sessões e materiais.'],
+ // Curso Movilidad Nivel 2 after its September group (server/course-perks.js): who may still join, and the shared conversation.
+ fiiuIncluded:['Included with your FIIU Fest 11 registration.','Incluido con tu inscripción al FIIU Fest 11.','Incluído na sua inscrição no FIIU Fest 11.'],
+ joinCourse:['Join the course','Unirme al curso','Entrar no curso'],
+ supportersOnly:['For Supporters','Para la membresía de apoyo','Para a assinatura de apoio'],
+ supportersNote:['This course is part of the Supporting membership, which opens soon. People already enrolled keep full access.','Este curso forma parte de la membresía de apoyo, que abre pronto. Quienes ya están inscritos conservan el acceso completo.','Este curso faz parte da assinatura de apoio, que abre em breve. Quem já está inscrito mantém o acesso completo.'],
+ fiiuTag:['Included with FIIU','Incluido con el FIIU','Incluído com o FIIU'],
+ enrolledTag:['Enrolled','Inscrito','Inscrito'],
+ sharedSince:['Since October, new participants join this conversation. Contributions from September stay visible to the September group only.','Desde octubre se suman nuevas personas a esta conversación. Las contribuciones de septiembre solo las ve el grupo de septiembre.','Desde outubro, novas pessoas entram nesta conversa. As contribuições de setembro ficam visíveis só para a turma de setembro.'],
  participantsClosed:['Enrollment is closed. Current participants keep their access. To add someone, turn on Enrollment open in Course setup.','Las inscripciones están cerradas. Los participantes actuales conservan su acceso. Para agregar a alguien, activa Inscripciones abiertas en Configurar curso.','As inscrições estão encerradas. Os participantes atuais mantêm o acesso. Para adicionar alguém, ative Inscrições abertas em Configurar curso.'],
  participantEnrollmentClosed:['Enrollment for this course is closed, so no one was added or invited. Turn on Enrollment open in Course setup first.','Las inscripciones de este curso están cerradas, así que no se agregó ni invitó a nadie. Primero activa Inscripciones abiertas en Configurar curso.','As inscrições deste curso estão encerradas, então ninguém foi adicionado nem convidado. Primeiro ative Inscrições abertas em Configurar curso.'],
  participantCourseUnavailable:['Publish this course before adding participants.','Publica este curso antes de agregar participantes.','Publique este curso antes de adicionar participantes.'],
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/course-fiiu-ui.test.js tests/course-september-items.test.js tests/deploy.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/courses-api.js tests/course-fiiu-ui.test.js tests/course-september-items.test.js tests/deploy.test.js web/pages/course.html web/pages/courses.html web/scripts/courses.js web/scripts/pilot-i18n.js
git commit -m "Show each viewer where they stand on the closed course" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The plans stop promising free courses

**Files:**
- Test (modify): `tests/deploy.test.js`
- Test (modify): `tests/home-i18n.test.js`
- Modify: `web/pages/admin.html`
- Modify: `web/pages/community.html`
- Modify: `web/pages/course.html`
- Modify: `web/pages/courses.html`
- Modify: `web/pages/dashboard.html`
- Modify: `web/pages/fiiu-admin.html`
- Modify: `web/pages/fiiu-checkin.html`
- Modify: `web/pages/fiiu-qr.html`
- Modify: `web/pages/fiiu-session.html`
- Modify: `web/pages/fiiu-talk.html`
- Modify: `web/pages/fiiu.html`
- Modify: `web/pages/index.html`
- Modify: `web/pages/knowledge.html`
- Modify: `web/pages/login.html`
- Modify: `web/pages/opportunities.html`
- Modify: `web/pages/organisers-only.html`
- Modify: `web/pages/payments.html`
- Modify: `web/pages/profile.html`
- Modify: `web/pages/reset-password.html`
- Modify: `web/pages/resources.html`
- Modify: `web/pages/teaching.html`
- Modify: `web/scripts/i18n-dashboard.js`
- Modify: `web/scripts/i18n.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–7. This is copy only, and BASE (Task 1) does not touch these files. The pilot-i18n.js keys from other tasks are not loaded by `tests/home-i18n.test.js`, so they cannot move its hashes.
- Produces:
  - i18n key `mem.p7`: ES/PT in `i18n.js`, EN in the `index.html` markup.
  - i18n key `y.p6`: es/pt in `i18n-dashboard.js`, EN in the `payments.html` markup.
  - Changed copy for `mem.f1` and `y.f1`.
  - Cache keys `i18n.js?v=20261018a` (21 pages) and `i18n-dashboard.js?v=20261018a` (4 pages).

- [ ] **Step 1: Write the failing tests**

Save the patch below as `/tmp/nodal-task8-tests.patch` and apply it from the repository root with `git apply /tmp/nodal-task8-tests.patch`. It adds or changes only test files.

```diff
diff --git a/tests/deploy.test.js b/tests/deploy.test.js
index ed112c6..64506a1 100644
--- a/tests/deploy.test.js
+++ b/tests/deploy.test.js
@@ -321,28 +321,28 @@ test('changed one-hour-cached clients use new URLs on every consuming page', ()
   const pilot = { 'pilot-i18n.js': '20261018a', 'pilot.js': '20261005s', 'courses.css': '20261016b' };
   const festival = { 'fiiu.css': '20261018b', 'fiiu-ui.js': '20261018b' };
   const required = {
-    'index.html': { 'styles.css': '32', 'i18n.js': '20261013b', 'app.js': '21', 'recs.js': '5', 'script.js': '18', 'hero-network.js': '2' },
-    'opportunities.html': { 'catalog.css': '7', 'i18n.js': '20261013b', 'catalog.js': '7', ...pilot },
-    'dashboard.html': { 'buc.js': '20261016c', 'i18n-dashboard.js': '20261017a', 'i18n.js': '20261013b', ...festival, 'fiiu-live.js': '20261017a', 'fiiu-hubs.js': '20261016b', 'news-feed.js': '20261001b', 'dashboard.js': '20261018b', 'dashboard.css': '41', 'location-check.js': '20260908b', ...pilot },
-    'login.html': { 'i18n.js': '20261013b', 'auth.js': '20261013b', 'recovery-i18n.js': '20261013b' },
-    'reset-password.html': { 'i18n.js': '20261013b', 'recovery-i18n.js': '20261013b', 'password-recovery.js': '20261013b' },
-    'payments.html': { 'i18n-dashboard.js': '20261017a', 'i18n.js': '20261013b', 'payments.js': '18', ...pilot },
-    'profile.html': { 'i18n-dashboard.js': '20261017a', 'i18n.js': '20261013b', 'profile.js': '20261013b', 'styles.css': '32', ...pilot },
-    'admin.html': { 'i18n-dashboard.js': '20261017a', 'styles.css': '32', 'admin.css': '5', 'admin.js': '6', 'i18n.js': '20261013b', 'locale.css': '20260929a', 'locale.js': '20261009a', 'nav.js': '20261013b', 'script.js': '18' },
-    'course.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261018a', ...pilot },
-    'courses.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', 'courses.js': '20261018a', ...pilot },
-    'teaching.html': { 'i18n.js': '20261013b', 'teaching.js': '20261018a', ...pilot },
+    'index.html': { 'styles.css': '32', 'i18n.js': '20261018a', 'app.js': '21', 'recs.js': '5', 'script.js': '18', 'hero-network.js': '2' },
+    'opportunities.html': { 'catalog.css': '7', 'i18n.js': '20261018a', 'catalog.js': '7', ...pilot },
+    'dashboard.html': { 'buc.js': '20261016c', 'i18n-dashboard.js': '20261018a', 'i18n.js': '20261018a', ...festival, 'fiiu-live.js': '20261017a', 'fiiu-hubs.js': '20261016b', 'news-feed.js': '20261001b', 'dashboard.js': '20261018b', 'dashboard.css': '41', 'location-check.js': '20260908b', ...pilot },
+    'login.html': { 'i18n.js': '20261018a', 'auth.js': '20261013b', 'recovery-i18n.js': '20261013b' },
+    'reset-password.html': { 'i18n.js': '20261018a', 'recovery-i18n.js': '20261013b', 'password-recovery.js': '20261013b' },
+    'payments.html': { 'i18n-dashboard.js': '20261018a', 'i18n.js': '20261018a', 'payments.js': '18', ...pilot },
+    'profile.html': { 'i18n-dashboard.js': '20261018a', 'i18n.js': '20261018a', 'profile.js': '20261013b', 'styles.css': '32', ...pilot },
+    'admin.html': { 'i18n-dashboard.js': '20261018a', 'styles.css': '32', 'admin.css': '5', 'admin.js': '6', 'i18n.js': '20261018a', 'locale.css': '20260929a', 'locale.js': '20261009a', 'nav.js': '20261013b', 'script.js': '18' },
+    'course.html': { 'buc.js': '20261016c', 'i18n.js': '20261018a', 'courses.js': '20261018a', ...pilot },
+    'courses.html': { 'buc.js': '20261016c', 'i18n.js': '20261018a', 'courses.js': '20261018a', ...pilot },
+    'teaching.html': { 'i18n.js': '20261018a', 'teaching.js': '20261018a', ...pilot },
     'accept-invitation.html': { 'accept-invitation.js': '20261013b', 'invitation-i18n.js': '20261013b' },
-    'fiiu.html': { 'styles.css': '32', 'i18n.js': '20261013b', ...festival, 'fiiu-live.js': '20261017a', 'fiiu.js': '20261015b' },
-    'fiiu-admin.html': { 'styles.css': '32', 'i18n.js': '20261013b', ...festival, 'fiiu-admin.js': '20261015b' },
-    'fiiu-qr.html': { 'i18n.js': '20261013b', ...festival, 'fiiu-qr.js': '20261013b' },
-    'fiiu-checkin.html': { 'i18n.js': '20261013b', ...festival, 'fiiu-checkin.js': '20261018b' },
-    'fiiu-talk.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', ...festival, 'fiiu-talk.js': '20261016c', 'fiiu-talk.css': '20261016b' },
-    'fiiu-session.html': { 'buc.js': '20261016c', 'i18n.js': '20261013b', ...festival, 'fiiu-talk.js': '20261016c', 'fiiu-talk.css': '20261016b' },
-    'organisers-only.html': { 'i18n.js': '20261013b', ...festival },
-    'community.html': { 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261013b', ...festival, 'fiiu-hubs.js': '20261016b', 'news-feed.js': '20261001b' },
-    'knowledge.html': { 'buc.js': '20261016c', 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261013b', ...festival, 'fiiu-hubs.js': '20261016b' },
-    'resources.html': { 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261013b', ...festival, 'fiiu-hubs.js': '20261016b' },
+    'fiiu.html': { 'styles.css': '32', 'i18n.js': '20261018a', ...festival, 'fiiu-live.js': '20261017a', 'fiiu.js': '20261015b' },
+    'fiiu-admin.html': { 'styles.css': '32', 'i18n.js': '20261018a', ...festival, 'fiiu-admin.js': '20261015b' },
+    'fiiu-qr.html': { 'i18n.js': '20261018a', ...festival, 'fiiu-qr.js': '20261013b' },
+    'fiiu-checkin.html': { 'i18n.js': '20261018a', ...festival, 'fiiu-checkin.js': '20261018b' },
+    'fiiu-talk.html': { 'buc.js': '20261016c', 'i18n.js': '20261018a', ...festival, 'fiiu-talk.js': '20261016c', 'fiiu-talk.css': '20261016b' },
+    'fiiu-session.html': { 'buc.js': '20261016c', 'i18n.js': '20261018a', ...festival, 'fiiu-talk.js': '20261016c', 'fiiu-talk.css': '20261016b' },
+    'organisers-only.html': { 'i18n.js': '20261018a', ...festival },
+    'community.html': { 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261018a', ...festival, 'fiiu-hubs.js': '20261016b', 'news-feed.js': '20261001b' },
+    'knowledge.html': { 'buc.js': '20261016c', 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261018a', ...festival, 'fiiu-hubs.js': '20261016b' },
+    'resources.html': { 'styles.css': '32', 'script.js': '18', 'i18n.js': '20261018a', ...festival, 'fiiu-hubs.js': '20261016b' },
   };
   for (const [page, assets] of Object.entries(required)) {
     for (const [asset, version] of Object.entries(assets)) {
diff --git a/tests/home-i18n.test.js b/tests/home-i18n.test.js
index e8b5d3a..90bcaf7 100644
--- a/tests/home-i18n.test.js
+++ b/tests/home-i18n.test.js
@@ -9,6 +9,8 @@ const SCRIPT=readFileSync(new URL('../web/scripts/i18n.js',import.meta.url),'utf
 const CONSOLE=readFileSync(new URL('../web/scripts/i18n-dashboard.js',import.meta.url),'utf8');
 // These 223 keys and the home hashes are captured from the runtime dictionaries
 // at 6ab93f9, including text created lazily by the original homepage graph.
+// One line moved on purpose since: the free plan stopped offering courses on
+// 18 Oct 2026 (mem.f1 here, y.f1 in the nonhome hashes), so all four were redone.
 const HOME_KEYS=[
   "about.eyebrow",
   "about.lead1",
@@ -236,12 +238,12 @@ const HOME_KEYS=[
 ];
 const SNAPSHOTS={
   "home": {
-    "es": "853f02d6acabeefabad1e5b100ed35f1a9616b9871871e7e9e0d72b113d1e8c6",
-    "pt": "77b244c716beb1956f020d7a452cb20727334b3beed4468028834c7ce83a40f0"
+    "es": "079660e2411ca2fa9e8c0295b913fe7b5fc0f8bf63a8bb726f7bf218e97db9cb",
+    "pt": "26f40677f81266699adc35dcfa26089f09b73c8749cbee8a8a79d2910beefda3"
   },
   "nonhome": {
-    "es": "bdb99eba47e951a598eb1ab91b2a0e746c68d7a4980a0700169d50977bbb76f6",
-    "pt": "f31575be665935bfa608a66e89b65e4a045a4b7003fd647b059622d85602edcf"
+    "es": "c86b92ceabd9185366a45be631735dbd471a7523b0f8d80b43f5042aef21509b",
+    "pt": "660dd0cfc74939fb3455bfc0de4269451941b05494d51c4ba9330097561e158d"
   }
 };
 
@@ -272,8 +274,9 @@ for(const lang of ['es','pt']){
       // the membership and account-deletion refusals (October 3 review) by review-fix-5-integration;
       // the console's loading/failure lines and accessible names (d.aria.*) by dashboard-publishing,
       // the catalog's nothing-published state by catalog-ui, and the console's Show more / Show less (d.news.*) and FIIU badges
-      // (d.badge.fiiu.*) by dashboard-console-ui, and the Learning band's readings from BUC (d.buc.*) by buc-ui.
-      const later=key=>['nav.privacy','catalog.retry','catalog.moreError','nav.program','nav.community','nav.learn','nav.fiiu','d.nav.publish','y.alreadyMember','d.uc.deleteSubscription','d.greet.hello','d.greet.loading','d.load.failed','catalog.emptyNothingPublished','catalog.nextFiiu','catalog.nextCourses'].includes(key)||/^(?:ops|news|d\.aria|d\.news|d\.badge\.fiiu|d\.buc)\./.test(key);
+      // (d.badge.fiiu.*) by dashboard-console-ui, the Learning band's readings from BUC (d.buc.*) by buc-ui, and the
+      // Supporter plans' courses line (mem.p7, y.p6) by the plan copy test at the end of this file.
+      const later=key=>['nav.privacy','catalog.retry','catalog.moreError','nav.program','nav.community','nav.learn','nav.fiiu','d.nav.publish','y.alreadyMember','d.uc.deleteSubscription','d.greet.hello','d.greet.loading','d.load.failed','catalog.emptyNothingPublished','catalog.nextFiiu','catalog.nextCourses','mem.p7','y.p6'].includes(key)||/^(?:ops|news|d\.aria|d\.news|d\.badge\.fiiu|d\.buc)\./.test(key);
       const actual=Object.entries(dictionaries[lang]).filter(([key])=>!later(key)).sort(([a],[b])=>a.localeCompare(b,'en'));
       assert.equal(hash(actual),SNAPSHOTS.nonhome[lang],String(page));
       assert.equal(api.t('nav.privacy'),lang==='es'?'Política de privacidad':'Política de privacidade');
@@ -313,3 +316,27 @@ test('landing leader titles, lab chips and accessible names switch language inst
   api.apply('es');assert.equal(api.t('lead.n3'),'Urbanista');assert.equal(api.t('part.l4'),'Co-crear');assert.equal(api.t('graph.aria'),'Red interactiva de actores');
   api.apply('pt');assert.equal(api.t('part.l6'),'Agir');assert.equal(api.t('platform.tabsLabel'),'Como a NODAL funciona');
 });
+test('the free plans stop offering courses and the Supporter plans list them, in English, Spanish and Portuguese',()=>{
+  // [en, es, pt]; English is the markup's own text.
+  const COPY={
+    'mem.f1':['Open labs and community sessions','Laboratorios abiertos y sesiones comunitarias','Laboratórios abertos e encontros comunitários'],
+    'mem.p7':['Supporter courses with the teaching team','Cursos de la membresía con el equipo docente','Cursos da assinatura com a equipe docente'],
+    'y.f1':['Community sessions and open resources','Sesiones comunitarias y recursos abiertos','Encontros da comunidade e recursos abertos'],
+    'y.p6':['Supporter courses with the teaching team','Cursos de la membresía con el equipo docente','Cursos da assinatura com a equipe docente'],
+  };
+  const page=name=>readFileSync(new URL('../web/pages/'+name,import.meta.url),'utf8');
+  const landing=page('index.html'),payments=page('payments.html');
+  // The <ul> of the plan card with exactly this class.
+  const list=(html,card)=>{const at=html.indexOf(`<article class="${card}">`);assert.notEqual(at,-1,card);return html.slice(html.indexOf('<ul>',at),html.indexOf('</ul>',at));};
+  const keys=part=>[...part.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);
+  for(const [html,free,pro,order] of [[landing,'plan','plan plan-pro',['mem.p1','mem.p2a','mem.p2b','mem.p3','mem.p4','mem.p5','mem.p7','mem.p6']],[payments,'pay-plan','pay-plan pay-plan-pro',['y.p1','y.p2','y.p3','y.p4','y.p5','y.p6']]]){
+    assert.doesNotMatch(list(html,free),/course/i,free+': the free plan no longer offers courses');
+    assert.deepEqual(keys(list(html,pro)),order,pro);
+  }
+  for(const [key,[en]] of Object.entries(COPY))assert.ok((key.startsWith('mem.')?landing:payments).includes(`<li data-i18n="${key}">${en}</li>`),key);
+  const home=load('home').api,console_=load(undefined,[],{withConsole:true}).api;
+  for(const [index,lang] of [[1,'es'],[2,'pt']]){
+    home.apply(lang);console_.apply(lang);
+    for(const [key,copy] of Object.entries(COPY))assert.equal((key.startsWith('mem.')?home:console_).t(key),copy[index],`${lang} ${key}`);
+  }
+});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test tests/home-i18n.test.js
```
Expected: `# tests 8`, `# pass 3`, `# fail 5`.
- `original homepage runtime copy matches 6ab93f9 in es|pt` fails with actual `853f02d6…` / `77b244c7…`.
- `nonhome catalog and console dictionaries remain unchanged in es|pt` fails with actual `bdb99eba…` / `f31575be…`.
- The new test fails with `plan: the free plan no longer offers courses`.

```bash
node --test --test-name-pattern="changed one-hour-cached clients" tests/deploy.test.js
```
Expected: `# fail 1`, with `index.html must load the new i18n.js cache key`.

- [ ] **Step 3: Implement**

Save the patch below as `/tmp/nodal-task8-impl.patch` and apply it with `git apply /tmp/nodal-task8-impl.patch`. It touches only `web/pages/admin.html`, `web/pages/community.html`, `web/pages/course.html`, `web/pages/courses.html`, `web/pages/dashboard.html`, `web/pages/fiiu-admin.html`, `web/pages/fiiu-checkin.html`, `web/pages/fiiu-qr.html`, `web/pages/fiiu-session.html`, `web/pages/fiiu-talk.html`, `web/pages/fiiu.html`, `web/pages/index.html`, `web/pages/knowledge.html`, `web/pages/login.html`, `web/pages/opportunities.html`, `web/pages/organisers-only.html`, `web/pages/payments.html`, `web/pages/profile.html`, `web/pages/reset-password.html`, `web/pages/resources.html`, `web/pages/teaching.html`, `web/scripts/i18n-dashboard.js`, `web/scripts/i18n.js`.

```diff
diff --git a/web/pages/admin.html b/web/pages/admin.html
index 4e17e9a..97a84c2 100644
--- a/web/pages/admin.html
+++ b/web/pages/admin.html
@@ -17,8 +17,8 @@
 
   <script defer src="nav.js?v=20261013b"></script>
   <script defer src="script.js?v=18"></script>
-  <script defer src="i18n-dashboard.js?v=20261017a"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n-dashboard.js?v=20261018a"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="admin.js?v=6"></script>
 </head>
 <body class="admin-page" data-page="admin">
diff --git a/web/pages/community.html b/web/pages/community.html
index 6e20181..4afce4f 100644
--- a/web/pages/community.html
+++ b/web/pages/community.html
@@ -1,7 +1,7 @@
 <!DOCTYPE html>
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Community</title>
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-hubs.js?v=20261016b"></script><script defer src="news-feed.js?v=20261001b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-hubs.js?v=20261016b"></script><script defer src="news-feed.js?v=20261001b"></script>
 </head><body class="f-page" data-page="community"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/course.html b/web/pages/course.html
index 797b241..b40426a 100644
--- a/web/pages/course.html
+++ b/web/pages/course.html
@@ -4,7 +4,7 @@
   <link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin />
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
diff --git a/web/pages/courses.html b/web/pages/courses.html
index 56737cb..1cca2f9 100644
--- a/web/pages/courses.html
+++ b/web/pages/courses.html
@@ -4,7 +4,7 @@
   <link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin />
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="buc.js?v=20261016c"></script>
diff --git a/web/pages/dashboard.html b/web/pages/dashboard.html
index d7196dc..ca0c11d 100644
--- a/web/pages/dashboard.html
+++ b/web/pages/dashboard.html
@@ -15,8 +15,8 @@
   <link rel="stylesheet" href="dashboard.css?v=41" />
   <link rel="stylesheet" href="courses.css?v=20261016b" />
 
-  <script defer src="i18n-dashboard.js?v=20261017a"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n-dashboard.js?v=20261018a"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="location-i18n.js?v=20260918b"></script>
   <script defer src="location-check.js?v=20260908b"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
diff --git a/web/pages/fiiu-admin.html b/web/pages/fiiu-admin.html
index b7adeb5..c43f5c8 100644
--- a/web/pages/fiiu-admin.html
+++ b/web/pages/fiiu-admin.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Manage FIIU</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-admin.js?v=20261015b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-admin.js?v=20261015b"></script>
 </head><body class="f-page" data-page="fiiu-admin"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/fiiu-checkin.html b/web/pages/fiiu-checkin.html
index 69c16de..6a73c80 100644
--- a/web/pages/fiiu-checkin.html
+++ b/web/pages/fiiu-checkin.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Check-in</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-checkin.js?v=20261018b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-checkin.js?v=20261018b"></script>
 </head><body class="f-page" data-page="fiiu-checkin"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/fiiu-qr.html b/web/pages/fiiu-qr.html
index 8cc6514..ce01f8c 100644
--- a/web/pages/fiiu-qr.html
+++ b/web/pages/fiiu-qr.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Check-in screen</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-qr.js?v=20261013b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-qr.js?v=20261013b"></script>
 </head><body class="f-page" data-page="fiiu-qr"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/fiiu-session.html b/web/pages/fiiu-session.html
index 03fe2f6..d3e6ad0 100644
--- a/web/pages/fiiu-session.html
+++ b/web/pages/fiiu-session.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Sesión</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b"><link rel="stylesheet" href="fiiu-talk.css?v=20261016b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-talk.js?v=20261016c"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-talk.js?v=20261016c"></script>
 </head><body class="f-page" data-page="fiiu-session"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/fiiu-talk.html b/web/pages/fiiu-talk.html
index 76d7a95..2fb3645 100644
--- a/web/pages/fiiu-talk.html
+++ b/web/pages/fiiu-talk.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Conversación</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b"><link rel="stylesheet" href="fiiu-talk.css?v=20261016b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-talk.js?v=20261016c"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-talk.js?v=20261016c"></script>
 </head><body class="f-page" data-page="fiiu-talk"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/fiiu.html b/web/pages/fiiu.html
index 7481d3d..09ce567 100644
--- a/web/pages/fiiu.html
+++ b/web/pages/fiiu.html
@@ -3,7 +3,7 @@
 <link rel="preload" href="/api/fiiu?kind=news" as="fetch" crossorigin>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-live.js?v=20261017a"></script><script defer src="fiiu.js?v=20261015b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-live.js?v=20261017a"></script><script defer src="fiiu.js?v=20261015b"></script>
 </head><body class="f-page" data-page="fiiu"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/index.html b/web/pages/index.html
index d56cf8e..7f3f232 100644
--- a/web/pages/index.html
+++ b/web/pages/index.html
@@ -17,7 +17,7 @@
   <link rel="stylesheet" href="styles.css?v=32" />
 
   <script defer src="nav.js?v=20261013b"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="script.js?v=18"></script>
   <script defer src="hero-network.js?v=2"></script>
   <script defer src="app.js?v=21"></script>
@@ -451,7 +451,7 @@
         <article class="plan">
           <header><h3 data-i18n="mem.freeName">Community access</h3><p class="price" data-i18n="mem.freePrice">Free, always</p></header>
           <ul>
-            <li data-i18n="mem.f1">Open courses, labs and community sessions</li>
+            <li data-i18n="mem.f1">Open labs and community sessions</li>
             <li data-i18n="mem.f2">Shared resources, cases and reading circles</li>
             <li data-i18n="mem.f3">Learning paths, calls and opportunity updates</li>
             <li data-i18n="mem.f4">Community connections and experience exchange</li>
@@ -469,6 +469,7 @@
             <li data-i18n="mem.p3">Guided discovery of people, projects, mentors and practical knowledge</li>
             <li data-i18n="mem.p4">Member directory and deeper profile for better matching</li>
             <li data-i18n="mem.p5">Early access to labs, thematic routes and co-creation formats</li>
+            <li data-i18n="mem.p7">Supporter courses with the teaching team</li>
             <li data-i18n="mem.p6">Help sustain the care, data and coordination behind the regional network</li>
           </ul>
           <a class="btn btn-primary" href="payments.html" data-billing-cta hidden data-i18n="mem.proCta">See supporting membership</a>
diff --git a/web/pages/knowledge.html b/web/pages/knowledge.html
index 3186c2f..5ca1191 100644
--- a/web/pages/knowledge.html
+++ b/web/pages/knowledge.html
@@ -1,7 +1,7 @@
 <!DOCTYPE html>
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Knowledge</title>
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-hubs.js?v=20261016b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="buc.js?v=20261016c"></script><script defer src="fiiu-hubs.js?v=20261016b"></script>
 </head><body class="f-page" data-page="knowledge"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/login.html b/web/pages/login.html
index 99d638b..a6f4f58 100644
--- a/web/pages/login.html
+++ b/web/pages/login.html
@@ -15,7 +15,7 @@
   <link rel="stylesheet" href="styles.css?v=32" />
   <link rel="stylesheet" href="auth.css?v=20261013b" />
 
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="recovery-i18n.js?v=20261013b"></script>
   <script defer src="nav.js?v=20261013b"></script>
   <script defer src="auth.js?v=20261013b"></script>
diff --git a/web/pages/opportunities.html b/web/pages/opportunities.html
index b130c06..7e550cd 100644
--- a/web/pages/opportunities.html
+++ b/web/pages/opportunities.html
@@ -17,7 +17,7 @@
   <link rel="stylesheet" href="courses.css?v=20261016b" />
 
   <script defer src="nav.js?v=20261013b"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="catalog.js?v=7"></script>
diff --git a/web/pages/organisers-only.html b/web/pages/organisers-only.html
index 86556ea..260f42e 100644
--- a/web/pages/organisers-only.html
+++ b/web/pages/organisers-only.html
@@ -2,7 +2,7 @@
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Organisers only</title>
 <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cline x1='20' y1='22' x2='44' y2='42' stroke='%2359bc53' stroke-width='5'/%3E%3Ccircle cx='20' cy='22' r='11' fill='%233d5c38'/%3E%3Ccircle cx='44' cy='42' r='8' fill='%2359bc53'/%3E%3C/svg%3E" />
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script>
 </head><body class="f-page" data-page="organisers-only"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/payments.html b/web/pages/payments.html
index b7f64cb..85b506a 100644
--- a/web/pages/payments.html
+++ b/web/pages/payments.html
@@ -15,8 +15,8 @@
   <link rel="stylesheet" href="styles.css?v=32" />
   <link rel="stylesheet" href="courses.css?v=20261016b" />
 
-  <script defer src="i18n-dashboard.js?v=20261017a"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n-dashboard.js?v=20261018a"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="nav.js?v=20261013b"></script>
@@ -65,7 +65,7 @@
               <p class="pay-price"><span class="pay-amount" data-i18n="y.free">Free</span></p>
             </header>
             <ul>
-              <li data-i18n="y.f1">Open courses and community sessions</li>
+              <li data-i18n="y.f1">Community sessions and open resources</li>
               <li data-i18n="y.f2">Library resources and shared reading circles</li>
               <li data-i18n="y.f3">Learning and opportunity updates</li>
               <li data-i18n="y.f4">Calls and opportunities in your region</li>
@@ -89,6 +89,7 @@
               <li data-i18n="y.p3">Guided discovery of people, projects &amp; knowledge</li>
               <li data-i18n="y.p4">Member directory and deeper community profile</li>
               <li data-i18n="y.p5">Early access to labs, circles and co-creation formats</li>
+              <li data-i18n="y.p6">Supporter courses with the teaching team</li>
             </ul>
             <button type="button" class="btn btn-primary" id="selectPro" data-i18n="y.support">Support the community</button>
           </article>
diff --git a/web/pages/profile.html b/web/pages/profile.html
index 25f1a6f..fe84490 100644
--- a/web/pages/profile.html
+++ b/web/pages/profile.html
@@ -15,8 +15,8 @@
   <link rel="stylesheet" href="styles.css?v=32" />
   <link rel="stylesheet" href="courses.css?v=20261016b" />
 
-  <script defer src="i18n-dashboard.js?v=20261017a"></script>
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n-dashboard.js?v=20261018a"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="nav.js?v=20261013b"></script>
diff --git a/web/pages/reset-password.html b/web/pages/reset-password.html
index 1a7e3a6..2f613f4 100644
--- a/web/pages/reset-password.html
+++ b/web/pages/reset-password.html
@@ -12,7 +12,7 @@
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="recovery.css?v=20261013b" />
 
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="recovery-i18n.js?v=20261013b"></script>
   <script defer src="password-recovery.js?v=20261013b"></script>
 </head>
diff --git a/web/pages/resources.html b/web/pages/resources.html
index 1be1cdb..a462feb 100644
--- a/web/pages/resources.html
+++ b/web/pages/resources.html
@@ -1,7 +1,7 @@
 <!DOCTYPE html>
 <html lang="en" translate="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>NODAL · Resources</title>
 <link rel="stylesheet" href="locale.css?v=20260929a"><script src="locale.js?v=20261009a"></script><link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="fonts.css?v=20260911b"><link rel="stylesheet" href="styles.css?v=32"><link rel="stylesheet" href="fiiu.css?v=20261018b">
-<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261013b"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-hubs.js?v=20261016b"></script>
+<script defer src="nav.js?v=20261013b"></script><script defer src="script.js?v=18"></script><script defer src="i18n.js?v=20261018a"></script><script defer src="fiiu-ui.js?v=20261018b"></script><script defer src="fiiu-hubs.js?v=20261016b"></script>
 </head><body class="f-page" data-page="resources"><a class="f-skip" href="#fiiuMain" data-fiiu-text="skip">Skip to content</a><header class="navbar">
     <a class="brand" href="index.html#top" id="brand">
       <svg id="net" class="brand-mark" viewBox="0 0 120 130" aria-hidden="true"></svg>
diff --git a/web/pages/teaching.html b/web/pages/teaching.html
index 8f67fcd..e947341 100644
--- a/web/pages/teaching.html
+++ b/web/pages/teaching.html
@@ -4,7 +4,7 @@
   <link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin />
   <link rel="stylesheet" href="fonts.css?v=20260911b" />
   <link rel="stylesheet" href="courses.css?v=20261016b">
-  <script defer src="i18n.js?v=20261013b"></script>
+  <script defer src="i18n.js?v=20261018a"></script>
   <script defer src="pilot-i18n.js?v=20261018a"></script>
   <script defer src="pilot.js?v=20261005s"></script>
   <script defer src="teaching.js?v=20261018a"></script>
diff --git a/web/scripts/i18n-dashboard.js b/web/scripts/i18n-dashboard.js
index 39e917e..fb8a1e9 100644
--- a/web/scripts/i18n-dashboard.js
+++ b/web/scripts/i18n-dashboard.js
@@ -993,7 +993,7 @@ window.NODAL_I18N_DASH = {
     'y.sub': 'NODAL empieza gratis. La membresía de apoyo ayuda a sostener el trabajo cívico compartido detrás de los cursos, los círculos comunitarios y las oportunidades regionales.',
     'y.secure': 'Pago seguro',
     'y.freeName': 'Acceso comunitario',
-    'y.f1': 'Cursos abiertos y sesiones comunitarias',
+    'y.f1': 'Sesiones comunitarias y recursos abiertos',
     'y.f2': 'Recursos de biblioteca y círculos de lectura',
     'y.f3': 'Novedades de aprendizaje y oportunidades',
     'y.f4': 'Convocatorias y oportunidades en tu región',
@@ -1005,6 +1005,7 @@ window.NODAL_I18N_DASH = {
     'y.p3': 'Descubrimiento guiado de personas, proyectos y conocimiento',
     'y.p4': 'Directorio de miembros y perfil comunitario más profundo',
     'y.p5': 'Acceso temprano a laboratorios, círculos y formatos de cocreación',
+    'y.p6': 'Cursos de la membresía con el equipo docente',
     'y.support': 'Apoya a la comunidad',
     'y.summary': 'Resumen del apoyo',
     'y.dtCycle': 'Ciclo de cobro',
@@ -1709,7 +1710,7 @@ window.NODAL_I18N_DASH = {
     'y.sub': 'A NODAL começa de graça. A assinatura de apoio ajuda a sustentar o trabalho cívico compartilhado por trás dos cursos, dos círculos comunitários e das oportunidades regionais.',
     'y.secure': 'Pagamento seguro',
     'y.freeName': 'Acesso comunitário',
-    'y.f1': 'Cursos abertos e encontros da comunidade',
+    'y.f1': 'Encontros da comunidade e recursos abertos',
     'y.f2': 'Recursos da biblioteca e círculos de leitura',
     'y.f3': 'Novidades de aprendizagem e oportunidades',
     'y.f4': 'Chamadas e oportunidades na sua região',
@@ -1721,6 +1722,7 @@ window.NODAL_I18N_DASH = {
     'y.p3': 'Descoberta guiada de pessoas, projetos e conhecimento',
     'y.p4': 'Diretório de membros e perfil comunitário mais profundo',
     'y.p5': 'Acesso antecipado a laboratórios, círculos e formatos de cocriação',
+    'y.p6': 'Cursos da assinatura com a equipe docente',
     'y.support': 'Apoie a comunidade',
     'y.summary': 'Resumo do apoio',
     'y.dtCycle': 'Ciclo de cobrança',
diff --git a/web/scripts/i18n.js b/web/scripts/i18n.js
index 87e34ab..9d14af6 100644
--- a/web/scripts/i18n.js
+++ b/web/scripts/i18n.js
@@ -75,7 +75,7 @@
     'mem.title': 'Empieza gratis. Ayuda a sostener la infraestructura que hace crecer la red.',
     'mem.freeName': 'Acceso comunitario',
     'mem.freePrice': 'Gratis, siempre',
-    'mem.f1': 'Cursos abiertos, laboratorios y sesiones comunitarias',
+    'mem.f1': 'Laboratorios abiertos y sesiones comunitarias',
     'mem.f2': 'Recursos, casos y círculos de lectura compartida',
     'mem.f3': 'Rutas de aprendizaje, convocatorias y oportunidades',
     'mem.f4': 'Conexiones comunitarias e intercambio de experiencias',
@@ -91,6 +91,7 @@
     'mem.p3': 'Descubrimiento guiado de personas, proyectos, mentores y conocimiento práctico',
     'mem.p4': 'Directorio de miembros y perfil más profundo para mejores conexiones',
     'mem.p5': 'Acceso temprano a laboratorios, rutas temáticas y formatos de cocreación',
+    'mem.p7': 'Cursos de la membresía con el equipo docente',
     'mem.p6': 'Ayuda a sostener el cuidado, los datos y la coordinación detrás de la red regional',
     'mem.proCta': 'Ver membresía de apoyo',
     'lead.eyebrow': 'Comunidad en LATAM',
@@ -282,7 +283,7 @@
     'mem.title': 'Comece grátis. Ajude a sustentar a infraestrutura que faz a rede crescer.',
     'mem.freeName': 'Acesso comunitário',
     'mem.freePrice': 'Grátis, sempre',
-    'mem.f1': 'Cursos abertos, laboratórios e encontros comunitários',
+    'mem.f1': 'Laboratórios abertos e encontros comunitários',
     'mem.f2': 'Recursos, casos e círculos de leitura compartilhada',
     'mem.f3': 'Rotas de aprendizagem, chamadas e oportunidades',
     'mem.f4': 'Conexões comunitárias e troca de experiências',
@@ -298,6 +299,7 @@
     'mem.p3': 'Descoberta guiada de pessoas, projetos, mentores e conhecimento prático',
     'mem.p4': 'Diretório de membros e perfil mais profundo para melhores conexões',
     'mem.p5': 'Acesso antecipado a laboratórios, rotas temáticas e formatos de cocriação',
+    'mem.p7': 'Cursos da assinatura com a equipe docente',
     'mem.p6': 'Ajude a sustentar o cuidado, os dados e a coordenação por trás da rede regional',
     'mem.proCta': 'Ver assinatura de apoio',
     'lead.eyebrow': 'Comunidade na LATAM',
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/deploy.test.js tests/home-i18n.test.js
node --test tests/*.test.js
npx eslint --max-warnings=0 server web/scripts tests
```

Expected: the first command reports `# fail 0`. The full suite reports `# fail 0` (6 tests are skipped, as on `main`). eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add tests/deploy.test.js tests/home-i18n.test.js web/pages/admin.html web/pages/community.html web/pages/course.html web/pages/courses.html web/pages/dashboard.html web/pages/fiiu-admin.html web/pages/fiiu-checkin.html web/pages/fiiu-qr.html web/pages/fiiu-session.html web/pages/fiiu-talk.html web/pages/fiiu.html web/pages/index.html web/pages/knowledge.html web/pages/login.html web/pages/opportunities.html web/pages/organisers-only.html web/pages/payments.html web/pages/profile.html web/pages/reset-password.html web/pages/resources.html web/pages/teaching.html web/scripts/i18n-dashboard.js web/scripts/i18n.js
git commit -m "Move courses from the free plan to the Supporting membership on the landing and payments pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Operations note, full verification and hand-off

**Files:**
- Modify: `docs/course-pilot-operations.md` (new section after the paragraph that starts "The first pilot course")
- Scratch only, never committed: a local seed server, `<scratchpad>/perkcheck/serve-course-perk.mjs`

**Interfaces:**
- Consumes: Tasks 1–8 as committed.
- Produces: the documented operating procedure for the teaching team, and the evidence that the branch is ready to merge.

- [ ] **Step 1: Write the operations note**

In `docs/course-pilot-operations.md`, insert this section right after the paragraph that starts "The first pilot course (`72e3cc56-a506-4a1b-97b5-9333e8d283ca`, *Curso Movilidad Nivel 2*) is closed by the data-only migration":

```markdown
## FIIU Fest 11 registrants and the September group (from 19 October 2026)

*Curso Movilidad Nivel 2* stays closed, with the rules decided on 18 October 2026 ([the design](superpowers/specs/2026-10-18-course-fiiu-access-design.md)):

- **FIIU registrants can join.** A member whose FIIU Fest 11 registration was created before the end of 25 October 2026 in Lima sees **Join the course** on the course page and can enrol themselves at any time. Everyone else who is not enrolled sees "For Supporters" and no button. Admins still admit anyone else by reopening enrolment.
- **The September group keeps its space.** The people enrolled before 1 October are the **September group**. Their posts and the replies under them, the final survey, the certificates and any material ticked **September group only** stay with them. People enrolled from 1 October see the conversation from October on.
- **Tick materials before announcing the perk.** Open each session in **Course setup** and tick **September group only** on every recording or file that shows learners (faces, voices, names, field-exercise photos). Unticked items are open to new joiners. NODAL cannot revoke a Drive, YouTube or Vimeo link someone already holds.
- **The groups show in Participants.** The participants table has a **Group** column (September 2026 or From October), and the participants CSV ends with a `group` column.
- **Reopening keeps the boundary.** Reopening **Enrollment open** lets anyone join, as before. The September group's posts, survey and ticked materials stay theirs either way.
```

- [ ] **Step 2: Run both builds**

```bash
npm run build
env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://nodal.example DATA_BACKEND=supabase EMAIL_SMTP_URL='smtps://u:p@smtp.example.invalid:465' EMAIL_FROM='NODAL <a@example.org>' npm run build
```

Expected: both exit 0 with `# tests 1880`, `# fail 0` (6 skipped).

- [ ] **Step 3: Check the four viewers on a local server**

Save this as `<scratchpad>/perkcheck/serve-course-perk.mjs` (outside the repository) and start it with `node serve-course-perk.mjs 4811 /Users/joaolucas/main-nodal-v2`:

```js
// Usage: node serve-course-perk.mjs <port> [repo root] — a seeded local NODAL for checking the course perk by hand.
// Accounts (cookies in cookies-<port>.json): admin; ana (FIIU-registered, not enrolled); beto (no FIIU registration);
// carla (enrolled 10 Sep, with an intake and a September post). The pilot course is closed.
import {randomUUID} from 'node:crypto';
import {writeFileSync,rmSync} from 'node:fs';
const repo=(process.argv[3]||'/Users/joaolucas/main-nodal-v2').replace(/\/?$/,'/');
const {createDatabase,createUser}=await import(repo+'server/db.js');
const {createSession}=await import(repo+'server/auth.js');
const {createApp}=await import(repo+'server/server.js');
const {createFiiuStore}=await import(repo+'server/fiiu-repository.js');
const {createCourseStore}=await import(repo+'server/courses-repository.js');
const {setupCoursePilot}=await import(repo+'scripts/setup-course-pilot.js');
const port=Number(process.argv[2]||4800),dir=new URL('.',import.meta.url).pathname,file=`${dir}perk-${port}.sqlite`;
for(const f of [file,file+'-wal',file+'-shm'])rmSync(f,{force:true});
const db=createDatabase({filename:file}),fiiu=createFiiuStore({db}),courses=createCourseStore({db});
const users={},cookies={};
for(const [k,name,role] of [['admin','Flavia Ramírez','admin'],['ana','Ana FIIU','member'],['beto','Beto Sin FIIU','member'],['carla','Carla Septiembre','member']]){
 users[k]=createUser(db,{fullName:name,email:`${k}@example.test`,passwordHash:'unused',role,city:'Lima'});cookies[k]=createSession(db,users[k].id).cookie.split(';')[0].split('=')[1];
}
const course=await setupCoursePilot(courses);
await courses.update('courses',{id:course.id},{enrollmentOpen:false});
const SEPT='2026-09-10T15:00:00.000Z';
await courses.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users.carla.id,createdAt:SEPT});
await courses.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users.carla.id,answers:{fullName:'Carla Septiembre',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'},updatedAt:SEPT});
const [module]=await courses.find('modules',{courseId:course.id,kind:'session'},{order:['position','sessionDate','id'],limit:1});
await courses.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:users.carla.id,authorName:'Carla Septiembre',staff:false,clientId:randomUUID(),parentId:null,kind:'question',threadKind:'discussion',body:'Pregunta de septiembre: solo el grupo de septiembre debe verla.',links:[],attachmentIds:[],deletedAt:null,createdAt:SEPT});
const at=new Date().toISOString(),base={country:'Perú',city:'Lima',profile:'professional',nationalId:'TEST-1',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
await fiiu.insert('registrations',{id:randomUUID(),eventId:'fiiu-2026',userId:users.ana.id,email:'ana@example.test',answers:{...base,firstName:'Ana',lastName:'FIIU',publicOfficial:false,activities:['day1-am'],externalActivities:[]},labStatus:'none',version:1,createdAt:at,updatedAt:at,confirmationStatus:'skipped',confirmationLanguage:'es',confirmationSentAt:null});
const server=createApp({db,fiiuConfirmation:null});
server.listen(port,'127.0.0.1',()=>{
 writeFileSync(`${dir}cookies-${port}.json`,JSON.stringify({base:`http://127.0.0.1:${port}`,cookieName:'nodal_session',cookies,courseId:course.id,moduleId:module.id},null,1));
 console.log(`ready http://127.0.0.1:${port}`);
});
```

Then, with the cookies it writes, check `GET /api/courses/<courseId>` and `GET /api/courses` for each account. Expected:
- **ana** (FIIU registrant): `join: 'fiiu'`, `perkCourse: true`, not enrolled. List: `enrolled: false, join: 'fiiu'`.
- **beto** (no registration): `join: 'supporters'`. List: `enrolled: false, join: 'supporters'`.
- **carla** (September learner): no `join`, enrolled. List: `enrolled: true`.
- **admin:** no `join`, `isAdmin: true`.

Open `/course.html?id=<courseId>` at 375 px wide, in Spanish, as ana and as beto, using the headless Edge probe or the in-app browser on 127.0.0.1.
- **ana:** "Incluido con tu inscripción al FIIU Fest 11." and **Unirme al curso**.
- **beto:** "Para la membresía de apoyo" and its note, with no button.
- **Joining:** as ana, press **Unirme al curso**, fill in the intake, open Sesión 1. Carla's September question must not appear, and the "Desde octubre…" note must.
- **As carla:** the September question still appears.
- **As admin:** each resource row in the teaching workspace has the "Solo grupo de septiembre" checkbox, and Participants shows the Grupo column.

Stop the server afterwards.

- [ ] **Step 4: Review the whole branch**

Run a code review of `main..feature/course-fiiu-access` focused on the Review Focus list above. Fix confirmed findings test-first, and rerun Step 2 after any fix.

- [ ] **Step 5: Commit and hand off**

```bash
git add docs/course-pilot-operations.md
git commit -m "Document the FIIU course perk and the September group for the teaching team" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git checkout main && git merge --ff-only feature/course-fiiu-access
```

The user pushes `main`. After the Vercel deploy succeeds:
- **Check the deploy:** confirm it with `gh api repos/Sistema-Urbano-Nodal/Nodal/commits/<sha>/statuses`, and that `courses.js?v=20261018a` is served.
- **Ask the teaching team** to do the Step 1 tick review before the perk is announced.
