# FIIU block conversations: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organisers post questions on FIIU festival blocks. Registered participants answer in a live chat with likes, images and PDFs, and organisers can moderate and project it.

**Architecture:**
- **Tables:** four new server-only tables (`fiiu_questions`, `fiiu_messages`, `fiiu_message_likes`, `fiiu_files`). Database triggers keep a per-question `revision` and a per-message `seq` in both Postgres and SQLite.
- **Live updates:** a public, CDN-cached `/api/fiiu/pulse` lists each question's revision. Browsers poll it every 4 s and fetch `?since=<revision>` changes only when their question moved.
- **Uploads:** reuse the course pipeline (`decodeAttachment`, the private `course-attachments` bucket, the download byte budget) through small shared seams.
- **Pages:** a new phone-first page `fiiu-talk.html`, plus a projector mode on it. A new section in the organiser dashboard.

**Tech stack:**
- Node 22, zero dependencies, `node:sqlite` locally.
- Supabase PostgREST and Storage REST in production.
- Vanilla browser JS (`sourceType: script`, IIFE, no modules) under a strict CSP: no inline script or style, `img-src 'self' data:`, `connect-src 'self'`.
- `node --test`, ESLint with `--max-warnings=0`.

**Spec:** `docs/superpowers/specs/2026-10-11-fiiu-conversations-design.md`. Read it first; this plan argues from it.

## Global constraints

- **Branch:** `feature/fiiu-conversations`, built on the undeployed `feature/ui-speed-round`. Never commit to `main`, never push, never deploy, never touch production. Never run `supabase db push`.
- **Event:** `EVENT_ID = 'fiiu-2026'` from `server/fiiu-domain.js`. Activities come from `FIIU_EVENT.activities` (current only); `LEGACY_FIIU_ACTIVITIES` cannot get questions.
- **Organiser:** `user.permission === 'admin'`. **Registered:** a `fiiu_registrations` row exists for `(EVENT_ID, user.id)`.
- **Display name:** first name plus surname initial ("María G."). Organisers additionally see `authorFull`. `userId` is never sent to peers.
- **Limits:**
  - question text 1–500 characters; talk ≤ 180; message text ≤ 1000;
  - 3 files per message; a file ≤ 3,145,728 bytes; a thumbnail ≤ 102,400 bytes;
  - per user per event: 30 files and 31,457,280 bytes;
  - types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (no `text/plain`).
- **Rate limits** (per account, per minute): messages 10, uploads 6, likes 60, organiser hide/unhide 120, other writes 30, reads 120. The pulse is exempt from the per-IP public limiter.
- **Pulse header:** `Cache-Control: public, max-age=0, s-maxage=2, stale-while-revalidate=4`, with no `Set-Cookie` and no text or names in the body.
- **Polling:** every 4 s while the page is visible; exponential backoff to 60 s on errors; paused while hidden.
- **Images in the browser:** long edge ≤ 1600 px for the full image (JPEG at 0.85) and ≤ 480 px for the thumbnail (JPEG at 0.7). Fill white before drawing so PNG transparency does not turn black. Use `FileReader` for base64; `blob:` URLs are forbidden by the CSP.
- **Times:** shown in Lima (`America/Lima`, a fixed UTC−05:00). Store UTC ISO strings.
- **Client strings:** EN, ES (Peru, informal "tú") and PT-BR. Every key has three non-empty strings. Spanish is the festival's main language.
- **Code style:**
  - follow the surrounding style (compact one-line functions in `fiiu-*` files; JSDoc-free comments that explain *why*);
  - no new dependencies;
  - comment density similar to neighbouring code.
- **Tests:** every test that reads env must save, clear and restore it, because Vercel runs `npm run build` with production env.
- **Cache keys:** any edited CSS or JS gets a new `?v=` on every page that loads it, and `tests/deploy.test.js` pins are updated. Task 11 does this in one place. Other tasks must not bump keys.

## Review focus

These are the failure modes most likely to bite real people. Each has a test in the task that owns the code.

1. **A phone loses its connection mid-send.** The message stays on screen as "Not sent · Retry", and a retry with the same `clientId` never duplicates it (Task 6 and Task 5).
2. **Venue Wi-Fi puts 300 phones behind one IP.** The pulse is never throttled by the per-IP public limiter, and per-account limits apply only to signed-in requests (Task 5).
3. **An organiser hides a message while people are reading.** Within one poll it disappears from participants' screens without a reload and without disturbing a half-typed draft (Task 5 and Task 6).
4. **A photo the browser cannot decode** (HEIC on Chrome, a corrupt file) or that is over 3 MB after a failed decode gets a clear, translated error, and the rest of the draft survives (Task 6).
5. **The same person likes from two devices at once.** PUT and DELETE are idempotent, and the count never goes negative or double counts (Task 4 and Task 5).

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `server/object-storage.js` | Supabase Storage REST put/get/remove for one bucket. Shared by the course and festival repositories. |
| `server/fiiu-talk-domain.js` | Validation, display names, views and constants for conversations. Pure functions. |
| `server/fiiu-talk-repository.js` | `createTalkStore({db}|{clients,env,fetchImpl})`: the SQLite schema and triggers, plus every query (SQLite and PostgREST). |
| `server/fiiu-talk-api.js` | `createTalkApi(...)` HTTP handler, `exportTalkData`, `deleteTalkData`. |
| `supabase/migrations/20261011120000_fiiu_conversations.sql` | Tables, triggers, quota RPC, stats RPC, grants. |
| `web/pages/fiiu-talk.html` | Page shell (root `fiiuTalkRoot`). |
| `web/scripts/fiiu-talk.js` | Chat page, polling, uploads and projector mode. Page-only strings are merged into `Fiiu.rows`. |
| `web/styles/fiiu-talk.css` | Chat and projector styles, `f-` scoped. |

Tests created:
- `tests/fiiu-talk-domain.test.js`
- `tests/fiiu-talk-repository.test.js` (SQLite plus a fake-fetch Supabase adapter)
- `tests/fiiu-talk-api.test.js`
- `tests/fiiu-talk-postgres.test.js` (opt-in)
- `tests/fiiu-talk-ui.test.js`
- `tests/object-storage.test.js`

**Modified**

| File | Change |
|---|---|
| `server/courses-domain.js` | `decodeAttachment(input, {types, max})` options |
| `server/courses-repository.js` | Use `createObjectStorage` |
| `server/courses-api.js` | Export `createByteBudget`, `matchesEtag`, `DOWNLOAD_LIMITS`; accept a `downloads` option |
| `server/server.js` | Wiring, sessionless pulse, limiters, export and delete, static lists |
| `scripts/build-static.js`, `vercel.json` | Page, script and style registration |
| `web/scripts/fiiu-ui.js` | Shared conversation strings, `pulse()`, `talkLink()`, cancel-confirmation wording |
| `web/scripts/fiiu.js`, `web/scripts/fiiu-hubs.js` | Entry links |
| `web/scripts/fiiu-admin.js` | Conversaciones section |
| `web/styles/fiiu.css` | Entry links and admin section |
| `tests/helpers/fiiu-ui-harness.js` | Root id |
| `tests/fiiu-admin-ui.test.js`, `tests/fiiu-ui.test.js`, `tests/review-fix-4-grants.test.js`, `tests/deploy.test.js` | New and updated cases |
| `docs/privacy/privacy-policy.{en,es,pt-BR}.md`, `docs/privacy/implementation-review.md`, `scripts/build-privacy-page.js`, `web/pages/privacy.html` | Privacy policy |
| `docs/implementation/fiiu-2026.md` | Implementation notes |

---

### Task 1: Shared upload and storage seams

**Files:**
- Modify: `server/courses-domain.js:124-140` (`decodeAttachment`)
- Create: `server/object-storage.js`
- Modify: `server/courses-repository.js:194-205` (`storage` and `removeObject` delegate)
- Modify: `server/courses-api.js:21-38,65-67` (exports; `downloads` option)
- Test: `tests/object-storage.test.js`, plus a new case in `tests/courses-domain.test.js` (create the file if missing; otherwise append)

**Interfaces**

Produces:
- `decodeAttachment(input, {types = COURSE_ATTACHMENT_TYPES, max = MAX_ATTACHMENT_BYTES} = {}) → {name, mime, size, bytes}`
  - Behaviour is unchanged with no options.
  - With `types` it rejects other types: `fail('unsupported file type', 400)` with `code: 'file_type'` attached to the error.
  - With `max` it rejects larger files with 413, `code: 'file_size'`.
- `export const COURSE_ATTACHMENT_TYPES = ['image/jpeg','image/png','image/webp','application/pdf','text/plain']`
- `createObjectStorage({env: {url, serverKey}, fetchImpl, bucket}) → {put(path, mime, bytes), get(path) → Buffer, remove(paths: string[])}`
  - Same HTTP calls as today's course `storage()` and `removeObject()`.
  - Each path segment is encoded with `encodeURIComponent`.
  - Headers: `apikey`, `Authorization: Bearer`, `Content-Type`, `x-upsert: false`, and a 20 s `AbortSignal.timeout`.
  - Errors: a non-OK put or get gives `fail('attachment storage unavailable', 502)`; a non-OK remove gives `fail('attachment cleanup unavailable', 502)`.
  - A 404 on `remove` counts as success, because Storage answers 200 with an empty list for missing prefixes.
- From `server/courses-api.js`: `export function createByteBudget(windows)`, `export const matchesEtag`, `export const DOWNLOAD_LIMITS` (already exported).
- `createCourseApi({..., downloads = createByteBudget(downloadLimits)})`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/object-storage.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectStorage} from '../server/object-storage.js';

test('object storage puts, gets and removes inside one bucket with the server key and encoded paths',async()=>{
 const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('hi').buffer};};
 const storage=createObjectStorage({env:{url:'https://p.supabase.co',serverKey:'service-key'},fetchImpl,bucket:'course-attachments'});
 await storage.put('fiiu/u 1/f#1','image/jpeg',Buffer.from('x'));
 assert.equal(calls[0].url,'https://p.supabase.co/storage/v1/object/course-attachments/fiiu/u%201/f%231');
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['x-upsert'],'false');assert.equal(calls[0].init.headers.Authorization,'Bearer service-key');
 assert.equal((await storage.get('fiiu/u/f')).toString(),'hi');
 await storage.remove(['fiiu/u/f','fiiu/u/f.thumb']);
 assert.equal(calls[2].url,'https://p.supabase.co/storage/v1/object/course-attachments');assert.deepEqual(JSON.parse(calls[2].init.body),{prefixes:['fiiu/u/f','fiiu/u/f.thumb']});
});
test('object storage reports provider failures as 502 without leaking the provider text',async()=>{
 const storage=createObjectStorage({env:{url:'https://p',serverKey:'k'},fetchImpl:async()=>({ok:false,status:500}),bucket:'b'});
 await assert.rejects(storage.put('a','image/png',Buffer.from('x')),err=>err.status===502&&err.message==='attachment storage unavailable');
 await assert.rejects(storage.remove(['a']),err=>err.status===502&&err.message==='attachment cleanup unavailable');
});
```

```js
// tests/courses-domain.test.js (append)
import {decodeAttachment} from '../server/courses-domain.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64');
test('decodeAttachment keeps its course defaults and accepts narrower types and limits',()=>{
 assert.equal(decodeAttachment({name:'a.txt',mime:'text/plain',data:Buffer.from('hello').toString('base64')}).mime,'text/plain');
 assert.throws(()=>decodeAttachment({name:'a.txt',mime:'text/plain',data:Buffer.from('hello').toString('base64')},{types:['image/png']}),err=>err.status===400&&err.code==='file_type');
 assert.throws(()=>decodeAttachment({name:'a.png',mime:'image/png',data:png},{types:['image/png'],max:4}),err=>err.status===413&&err.code==='file_size');
 assert.equal(decodeAttachment({name:'a.png',mime:'image/png',data:png},{types:['image/png'],max:10}).size,10);
});
```

- [ ] **Step 2: Run them to confirm they fail.**
  - Run: `node --test tests/object-storage.test.js tests/courses-domain.test.js`
  - Expected: FAIL (module not found; `code` undefined).

- [ ] **Step 3: Implement.**
  - **`decodeAttachment`:** add the options, compute the base64 ceiling from `max` (`Math.ceil(max/3)*4`), and attach `code` with `Object.assign(err, {code})`. Wrap `fail` in a small helper that does this: `const failCode=(message,status,code)=>{try{fail(message,status);}catch(err){throw Object.assign(err,{code});}}`.
  - **`object-storage.js`:** move the bodies of `storage` and `removeObject` out of `courses-repository.js`.
  - **Course repository:** `courses-repository.js` builds `const objects=createObjectStorage({env:supa.env,fetchImpl,bucket:BUCKET})` and the existing `putFile`/`getFile`/`deleteFile`/certificate methods call `objects.put/get/remove`. The paths and error messages stay identical.

- [ ] **Step 4: Run the course and new tests.**
  - Run: `node --test tests/object-storage.test.js tests/courses-domain.test.js tests/courses-*.test.js tests/course-*.test.js`
  - Expected: PASS, with zero changes to existing course assertions.

- [ ] **Step 5: Commit.** `git commit -m "Share the upload decoder, object storage and download budget with the festival"`

---

### Task 2: Conversation domain

**Files:**
- Create: `server/fiiu-talk-domain.js`
- Test: `tests/fiiu-talk-domain.test.js`

**Interfaces**

Consumes:
- `fail`, `text`, `identifier`, `decodeAttachment` from `courses-domain.js`
- `FIIU_EVENT`, `EVENT_ID` from `fiiu-domain.js`

Produces:
```js
export const TALK_LIMITS={question:500,talk:180,message:1000,files:3,fileBytes:3*1024*1024,thumbBytes:100*1024,quotaFiles:30,quotaBytes:30*1024*1024,page:100,changes:200};
export const TALK_FILE_TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
export const talkActivity=id=>FIIU_EVENT.activities.find(a=>a.id===id)??null;   // current activities only
export function normalizeQuestion(input,current)        // → {activityId,talk,body,status}; current = existing row for PATCH (activityId cannot change)
export function normalizeMessage(input)                 // → {clientId,body,fileIds}; body trimmed; empty body with no files → fail 400 code 'empty_message'
export function decodeTalkFile(input)                   // → {name,mime,size,bytes,width,height,thumb:{bytes,size,width,height}|null}
export function displayName(first,last)                 // 'María G.'; no letters in last → 'María'; empty first → 'Participante'
export function namesFor(user,registration)             // → {authorName,authorFull}; registration answers first, else user.name split
export function questionView(q,{organiser})              // → {id,activityId,talk,body,status,revision,messageCount,createdAt,...(organiser?{version:q.version}:{})}
export function messageView(m,{viewer,organiser,files,liked}) // see below
export function goneView(m)                             // → {id:m.id,seq:m.seq,gone:true}
export function activityView(a)                          // → {id,title,date,time,venue,sessions,registration,period}
```

Rules:
- **`normalizeQuestion`:**
  - `activityId` must satisfy `talkActivity()`; otherwise `fail('invalid activity',400)` with `code:'invalid_activity'`.
  - `talk` is optional. When given, it must equal one of `activity.sessions[i][1]`; otherwise `code:'invalid_talk'`.
  - `body` is `text(input.body,'question',500,true)` after trimming.
  - `status` is one of `open|closed|hidden`. On create only `open|hidden` are allowed; the default is `open`.
- **`normalizeMessage`:**
  - `clientId` is `identifier(input.clientId)`.
  - `body` is `String(input.body??'').trim()`; more than 1000 characters (code points) fails with `code:'message_too_long'`.
  - `fileIds` is an array of at most 3 distinct identifiers; otherwise `code:'too_many_files'`.
  - Text, files, or both are required.
- **`decodeTalkFile`:**
  - Calls `decodeAttachment(input,{types:TALK_FILE_TYPES,max:TALK_LIMITS.fileBytes})`.
  - `width`/`height`, when present, are integers from 1 to 20000; otherwise they are dropped.
  - `thumb`, when present, is only accepted for image files. It runs through `decodeAttachment({name:'thumb.jpg',mime:input.thumb.mime??'image/jpeg',data:input.thumb.data},{types:['image/jpeg','image/webp'],max:TALK_LIMITS.thumbBytes})`.
- **`displayName`:** collapse whitespace, cap at 60 characters, take the first letter (`\p{L}`) of `last`, upper-case it with the `es` locale, and add a full stop.
- **`namesFor`:**
  - With a registration: `authorName = displayName(answers.firstName, answers.lastName)` and `authorFull = (first+' '+last).trim()`.
  - Without one: split `user.name` on whitespace; first token plus the initial of the last token. `authorFull = user.name`.
  - Cap `authorName` at 120 and `authorFull` at 240 characters.
- **`messageView`:**
  - Returns `{id, author: m.authorName, organiser: !!m.organiser, mine: viewer===m.userId, body: m.body, files: files.map(f=>({id:f.id, name:attachmentFilename(f.name,f.mime), mime:f.mime, size:f.size, width:f.width??null, height:f.height??null, thumb:Boolean(f.thumbSize)})), likeCount: m.likeCount, liked: Boolean(liked), createdAt: m.createdAt, seq: m.seq}`.
  - Organisers also get `{authorFull: m.authorFull, hidden: Boolean(m.hiddenAt)}`.
  - `mine` uses the user id for comparison, but the id itself is never emitted.

- [ ] **Step 1: Write the failing tests.** Cover each rule above with concrete inputs. Required cases:

```js
import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeQuestion,normalizeMessage,decodeTalkFile,displayName,namesFor,messageView,goneView,TALK_LIMITS} from '../server/fiiu-talk-domain.js';
test('display names keep a first name and a surname initial',()=>{
 assert.equal(displayName('María José','  gonzález  '),'María José G.');
 assert.equal(displayName('Ana','123'),'Ana');assert.equal(displayName('','Pérez'),'Participante P.');
 assert.equal(displayName('Łukasz','éclair'),'Łukasz É.');
});
test('organisers without a registration are named from their profile',()=>{
 assert.deepEqual(namesFor({name:'Flavia  Ramírez Soto'},null),{authorName:'Flavia S.',authorFull:'Flavia  Ramírez Soto'});
 assert.deepEqual(namesFor({name:'x'},{answers:{firstName:'Ana',lastName:'Test'}}),{authorName:'Ana T.',authorFull:'Ana Test'});
});
test('questions belong to a current activity and an optional talk of that block',()=>{
 assert.equal(normalizeQuestion({activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:' ¿Qué te llevas? '}).body,'¿Qué te llevas?');
 assert.throws(()=>normalizeQuestion({activityId:'workshop-day1',body:'x'}),e=>e.code==='invalid_activity');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',talk:'Other',body:'x'}),e=>e.code==='invalid_talk');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x'.repeat(501)}),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',status:'closed'}),e=>e.status===400,'a new question is open or hidden');
 assert.equal(normalizeQuestion({body:'y',status:'closed'},{activityId:'day1-am',talk:null,body:'x',status:'open'}).status,'closed');
 assert.throws(()=>normalizeQuestion({activityId:'day2-am',body:'y'},{activityId:'day1-am',body:'x',status:'open'}),e=>e.status===400,'activity cannot change');
});
test('messages need text or files and stay within the limits',()=>{
 const clientId='11111111-1111-4111-8111-111111111111',file='22222222-2222-4222-8222-222222222222';
 assert.throws(()=>normalizeMessage({clientId,body:'   '}),e=>e.code==='empty_message');
 assert.deepEqual(normalizeMessage({clientId,body:'',fileIds:[file,file.toUpperCase()]}).fileIds,[file]);
 assert.throws(()=>normalizeMessage({clientId,body:'😀'.repeat(1001)}),e=>e.code==='message_too_long');
 assert.equal(normalizeMessage({clientId,body:'😀'.repeat(1000)}).body.length,2000,'counts code points, not UTF-16 units');
 assert.throws(()=>normalizeMessage({clientId,body:'x',fileIds:Array.from({length:4},(_,i)=>`2222222${i}-2222-4222-8222-222222222222`)}),e=>e.code==='too_many_files');
});
test('festival files are images or PDFs within 3 MB, and a thumbnail is a small JPEG or WebP of an image',()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16]).toString('base64'),pdf=Buffer.from('%PDF-1.4').toString('base64');
 const f=decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:jpeg,width:1600,height:900,thumb:{mime:'image/jpeg',data:jpeg}});
 assert.equal(f.thumb.size,6);assert.equal(f.width,1600);
 assert.throws(()=>decodeTalkFile({name:'a.txt',mime:'text/plain',data:Buffer.from('hi').toString('base64')}),e=>e.code==='file_type');
 assert.throws(()=>decodeTalkFile({name:'a.pdf',mime:'application/pdf',data:pdf,thumb:{mime:'image/jpeg',data:jpeg}}),e=>e.status===400,'PDFs carry no thumbnail');
 assert.equal(decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:jpeg,width:0}).width,null);
});
test('message views never reveal ids and show organisers the full name and hidden state',()=>{
 const m={id:'m',userId:'u',authorName:'Ana T.',authorFull:'Ana Test',organiser:0,body:'hola',likeCount:2,createdAt:'2026-10-21T14:00:00.000Z',seq:7,hiddenAt:null};
 const view=messageView(m,{viewer:'u',organiser:false,files:[],liked:true});
 assert.deepEqual(view,{id:'m',author:'Ana T.',organiser:false,mine:true,body:'hola',files:[],likeCount:2,liked:true,createdAt:m.createdAt,seq:7});
 assert.equal(messageView({...m,hiddenAt:'x'},{viewer:'o',organiser:true,files:[],liked:false}).hidden,true);
 assert.deepEqual(goneView(m),{id:'m',seq:7,gone:true});
});
```

- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-talk-domain.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `server/fiiu-talk-domain.js`** following the rules above.
- [ ] **Step 4: Run them to confirm they pass.** `node --test tests/fiiu-talk-domain.test.js` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the festival conversation domain rules"`

---

### Task 3: Postgres migration

**Files:**
- Create: `supabase/migrations/20261011120000_fiiu_conversations.sql`
- Create: `tests/fiiu-talk-postgres.test.js` (opt-in through `NODAL_FIIU_TALK_TEST_DATABASE_URL`)
- Modify: `tests/review-fix-4-grants.test.js` (append one test)

**Interfaces**

Produces (the column names are the contract for Task 4's Supabase adapter):
- the tables `public.fiiu_questions`, `public.fiiu_messages`, `public.fiiu_message_likes`, `public.fiiu_files`;
- the RPCs `public.reserve_fiiu_file(p_file jsonb) RETURNS SETOF public.fiiu_files`, which raises SQLSTATE `PFU01` over quota, and `public.fiiu_question_stats(p_event_id text) RETURNS TABLE(question_id uuid, people bigint, likes bigint)`.

- [ ] **Step 1: Write the migration.** This is the full content:

```sql
-- FIIU block conversations: organiser questions on festival blocks, participant chat messages with likes, and the
-- images and PDFs attached to them. Server-only like every FIIU table: RLS on, no client policies, browser roles
-- hold nothing. Additive; apply BEFORE deploying the code that selects these tables, with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261011120000_fiiu_conversations.sql`,
-- then `supabase migration repair --status applied 20261011120000`. Never `db push` (history differs).
BEGIN;
CREATE TABLE public.fiiu_questions (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),activity_id text NOT NULL CHECK(activity_id ~ '^[a-z0-9-]{1,60}$'),
 talk text CHECK(talk IS NULL OR char_length(talk) BETWEEN 1 AND 180),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500),
 status text NOT NULL CHECK(status IN ('open','closed','hidden')),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 message_count integer NOT NULL DEFAULT 0 CHECK(message_count>=0),created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 version integer NOT NULL CHECK(version>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL
);
CREATE INDEX fiiu_questions_activity ON public.fiiu_questions(event_id,activity_id,created_at);
CREATE INDEX fiiu_questions_creator ON public.fiiu_questions(created_by);
CREATE TABLE public.fiiu_messages (
 id uuid PRIMARY KEY,question_id uuid NOT NULL REFERENCES public.fiiu_questions(id) ON DELETE RESTRICT,
 user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,author_name text NOT NULL CHECK(char_length(author_name)<=120),
 author_full text NOT NULL CHECK(char_length(author_full)<=240),organiser boolean NOT NULL DEFAULT false,
 body text NOT NULL CHECK(char_length(body)<=1000),client_id uuid NOT NULL,like_count integer NOT NULL DEFAULT 0 CHECK(like_count>=0),
 seq bigint NOT NULL DEFAULT 0,hidden_at timestamptz,hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 deleted_at timestamptz,created_at timestamptz NOT NULL,UNIQUE(user_id,client_id)
);
CREATE INDEX fiiu_messages_changes ON public.fiiu_messages(question_id,seq);
CREATE INDEX fiiu_messages_page ON public.fiiu_messages(question_id,created_at,id);
CREATE INDEX fiiu_messages_hider ON public.fiiu_messages(hidden_by);
CREATE TABLE public.fiiu_message_likes (
 message_id uuid NOT NULL REFERENCES public.fiiu_messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,created_at timestamptz NOT NULL,PRIMARY KEY(message_id,user_id)
);
CREATE INDEX fiiu_message_likes_user ON public.fiiu_message_likes(user_id);
CREATE TABLE public.fiiu_files (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 message_id uuid REFERENCES public.fiiu_messages(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 3145728),width integer CHECK(width BETWEEN 1 AND 20000),height integer CHECK(height BETWEEN 1 AND 20000),
 thumb_size integer CHECK(thumb_size BETWEEN 1 AND 102400),storage_path text NOT NULL UNIQUE CHECK(storage_path LIKE 'fiiu/%'),
 status text NOT NULL CHECK(status IN ('pending','ready','deleting')),created_at timestamptz NOT NULL
);
CREATE INDEX fiiu_files_user ON public.fiiu_files(user_id);
CREATE INDEX fiiu_files_message ON public.fiiu_files(message_id);

-- Every message write moves its question's revision (what /api/fiiu/pulse publishes) and stamps the message with it
-- (seq), so a browser fetches only rows changed since its revision. SECURITY DEFINER: GoTrue's account deletion
-- reaches these through foreign-key actions as supabase_auth_admin (see 20261003201144).
CREATE FUNCTION public.fiiu_message_sequence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_visible integer:=0; after_visible integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.body IS NOT DISTINCT FROM OLD.body AND NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
   AND NEW.like_count=OLD.like_count AND NEW.author_name IS NOT DISTINCT FROM OLD.author_name AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  before_visible:=CASE WHEN OLD.hidden_at IS NULL AND OLD.deleted_at IS NULL THEN 1 ELSE 0 END;
 END IF;
 after_visible:=CASE WHEN NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL THEN 1 ELSE 0 END;
 UPDATE public.fiiu_questions SET revision=revision+1,message_count=message_count+after_visible-before_visible WHERE id=NEW.question_id RETURNING revision INTO NEW.seq;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_message_sequence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_message_sequence BEFORE INSERT OR UPDATE ON public.fiiu_messages FOR EACH ROW EXECUTE FUNCTION public.fiiu_message_sequence();

CREATE FUNCTION public.fiiu_like_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN UPDATE public.fiiu_messages SET like_count=like_count+1 WHERE id=NEW.message_id; RETURN NEW; END IF;
 UPDATE public.fiiu_messages SET like_count=greatest(0,like_count-1) WHERE id=OLD.message_id; RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_like_count() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_like_count AFTER INSERT OR DELETE ON public.fiiu_message_likes FOR EACH ROW EXECUTE FUNCTION public.fiiu_like_count();

CREATE FUNCTION public.fiiu_question_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.body IS DISTINCT FROM OLD.body OR NEW.talk IS DISTINCT FROM OLD.talk OR NEW.status IS DISTINCT FROM OLD.status THEN NEW.revision:=OLD.revision+1; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_question_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_question_revision BEFORE UPDATE ON public.fiiu_questions FOR EACH ROW EXECUTE FUNCTION public.fiiu_question_revision();

-- Account erasure: the text and name go, a placeholder keeps the conversation's shape. Files are removed by the
-- application first (fiiu_files.user_id is RESTRICT), likes cascade.
CREATE FUNCTION public.erase_fiiu_messages_on_account_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.fiiu_messages SET body='',author_name='',author_full='',deleted_at=coalesce(deleted_at,now()) WHERE user_id=OLD.id;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_fiiu_messages_on_account_delete() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_messages_account_erasure BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.erase_fiiu_messages_on_account_delete();

-- Upload allowance per person for the festival: 30 files, 30 MB, pending uploads included. Serialized per person.
CREATE SCHEMA IF NOT EXISTS nodal_private;
REVOKE ALL ON SCHEMA nodal_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nodal_private TO service_role;
CREATE TABLE nodal_private.fiiu_upload_locks (user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 1);
ALTER TABLE nodal_private.fiiu_upload_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nodal_private.fiiu_upload_locks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE nodal_private.fiiu_upload_locks TO service_role;
CREATE FUNCTION nodal_private.guard_fiiu_upload_quota() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE file_count bigint; byte_count bigint;
BEGIN
 INSERT INTO nodal_private.fiiu_upload_locks AS locks(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO UPDATE SET revision=locks.revision+1;
 SELECT count(*),coalesce(sum(size),0) INTO file_count,byte_count FROM public.fiiu_files WHERE user_id=NEW.user_id AND event_id=NEW.event_id;
 IF file_count>=30 OR byte_count+NEW.size>31457280 THEN RAISE EXCEPTION 'festival upload allowance reached' USING ERRCODE='PFU01'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.guard_fiiu_upload_quota() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_upload_quota BEFORE INSERT ON public.fiiu_files FOR EACH ROW EXECUTE FUNCTION nodal_private.guard_fiiu_upload_quota();
CREATE FUNCTION public.reserve_fiiu_file(p_file jsonb) RETURNS SETOF public.fiiu_files LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.fiiu_files(id,event_id,user_id,message_id,name,mime,size,width,height,thumb_size,storage_path,status,created_at)
 SELECT id,event_id,user_id,NULL,name,mime,size,width,height,thumb_size,storage_path,'pending',created_at
 FROM jsonb_populate_record(NULL::public.fiiu_files,p_file) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.reserve_fiiu_file(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fiiu_file(jsonb) TO service_role;

-- Organiser totals per question: distinct authors and likes over visible messages (message_count is on the question).
CREATE FUNCTION public.fiiu_question_stats(p_event_id text) RETURNS TABLE(question_id uuid,people bigint,likes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT m.question_id,count(DISTINCT m.user_id),coalesce(sum(m.like_count),0)
 FROM public.fiiu_messages m JOIN public.fiiu_questions q ON q.id=m.question_id
 WHERE q.event_id=p_event_id AND m.hidden_at IS NULL AND m.deleted_at IS NULL GROUP BY m.question_id;
$$;
REVOKE ALL ON FUNCTION public.fiiu_question_stats(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiiu_question_stats(text) TO service_role;

ALTER TABLE public.fiiu_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiiu_questions,public.fiiu_messages,public.fiiu_message_likes,public.fiiu_files FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.fiiu_questions,public.fiiu_messages,public.fiiu_message_likes,public.fiiu_files TO service_role;
COMMIT;
```

- [ ] **Step 2: Write `tests/fiiu-talk-postgres.test.js`.**
  - Model it on `tests/fiiu-postgres.test.js`: the same URL guards, an empty-database check, the role creation, and `CREATE TABLE profiles(id uuid PRIMARY KEY)`. Apply the 4 earlier FIIU migrations and then the new one.
  - Also create a role `supabase_auth_admin NOLOGIN` with only `DELETE ON profiles`, plus a deletion run as that role (`SET ROLE supabase_auth_admin; DELETE FROM profiles …`). This proves the SECURITY DEFINER triggers let erasure succeed.
  - Assert:
    - RLS is on and anon/authenticated hold no privileges on the four tables. `has_function_privilege` is false for anon/authenticated on both RPCs and true for service_role.
    - **Insert and revision:** insert a question (revision 0), then insert 2 messages. The revisions are 1 and 2, `seq` is 1 and 2, and `message_count` is 2.
    - **Likes:** a like makes `like_count` 1 and the revision 3. A duplicate like fails with `duplicate key`. Unliking brings `like_count` to 0.
    - **Hide:** hiding a message makes `message_count` 1, moves the revision, and sets the message's `seq` to the new revision.
    - **Question edits:** editing the question body moves the revision; updating `updated_at` alone does not.
    - **Quota:** 30 `reserve_fiiu_file` calls succeed and the 31st raises `PFU01`. A file of 31,457,281 bytes in total raises `PFU01`.
    - **Erasure:** deleting a profile that still has a `fiiu_files` row fails (RESTRICT). After that row is deleted, deletion as `supabase_auth_admin` succeeds; the messages are blanked with `deleted_at` set, `user_id` is NULL and the likes are gone.
    - **Stats:** `fiiu_question_stats('fiiu-2026')` returns people and likes over visible messages only.
  - Run locally against a disposable database:
    ```bash
    createdb -h 127.0.0.1 nodal_fiiu_test_talk$$ && NODAL_FIIU_TALK_TEST_DATABASE_URL=postgresql://127.0.0.1/nodal_fiiu_test_talk$$ node --test tests/fiiu-talk-postgres.test.js; dropdb -h 127.0.0.1 nodal_fiiu_test_talk$$
    ```
  - If no Postgres server is running, start a scratch cluster in the scratchpad: `initdb`, then `pg_ctl -o "-p 55432 -k /tmp"`, and use port 55432.
  - The URL path must match `/^\/nodal_fiiu_test_[a-z0-9_]+$/`.

- [ ] **Step 3: Append the grants test.** Copy the final-survey block's shape:
  - **Server-only:** for the four `public.fiiu_*` tables, `stateFor` is `revoked` for anon/authenticated and `granted` for service_role.
  - **Ordering:** the file name matches `/^\d{14}_fiiu_conversations\.sql$/` and sorts after `20261006004500_course_final_survey.sql`.
  - **Additive only:** every statement matches an allow-list: begin/commit; `create table (public\.fiiu_(questions|messages|message_likes|files)|nodal_private\.fiiu_upload_locks)`; `create index … on` those; `create function (public|nodal_private)\.(fiiu_\w+|erase_fiiu_messages_on_account_delete|reserve_fiiu_file|guard_fiiu_upload_quota)`; `create trigger`; `create schema if not exists nodal_private`; `alter table … enable row level security`; `revoke all on (table|function|schema) …`; `grant … to service_role`.
  - **No destructive SQL:** there is no `drop`, no `delete from` and no `alter table … drop`.
  - **Note:** split statements on `;` only outside `$$` bodies. Strip the `$$…$$` bodies before splitting with `sql.replace(/\$\$[\s\S]*?\$\$/g,'$$body$$')`.

- [ ] **Step 4: Run the tests.** `node --test tests/review-fix-4-grants.test.js` → PASS. Then run the Postgres test with the local database → PASS (report the output).
- [ ] **Step 5: Commit.** `git commit -m "Add the festival conversations migration with triggers, quota and grants"`

---

### Task 4: Conversation repository (SQLite and Supabase)

**Files:**
- Create: `server/fiiu-talk-repository.js`
- Test: `tests/fiiu-talk-repository.test.js`

**Interfaces**

Consumes: `createObjectStorage` (Task 1); `createSupabaseClients` and `snake` from `courses-schema.js`; the `fail` helper.

Produces: `createTalkStore({db, env, clients, fetchImpl})`. All records are camelCase. Methods:

```text
// registrations (read-only view of fiiu_registrations)
findRegistration(eventId,userId) → {id,email,firstName,lastName}|null
registrationEmails(eventId,userIds[]) → Map<userId,email>             // ≤100 ids per provider call, chunked
// questions
insertQuestion({id,eventId,activityId,talk,body,status,createdBy,createdAt}) → row   // version 1, revision 0, updatedAt=createdAt; 409 on duplicate id
getQuestion(id) → row|null
listQuestions(eventId,{activityId,includeHidden}) → rows ordered created_at asc
updateQuestion(id,version,patch{body?,talk?,status?,updatedAt}) → row|null   // compare-and-set on version; version+1
pulse(eventId) → [{id,activityId,revision,status}] for status<>'hidden', ordered by created_at
questionStats(eventId) → Map<questionId,{people,likes}>
// messages
insertMessage({id,questionId,userId,authorName,authorFull,organiser,body,clientId,createdAt}) → row (with seq from trigger); 409 on (userId,clientId)
findMessage(id) → row|null
findMessageByClient(userId,clientId) → row|null
latestMessages(questionId,{includeHidden,before:{createdAt,id}|null,limit}) → {rows (oldest first), more:boolean}   // excludes deleted always; hidden unless includeHidden
messagesSince(questionId,since,{limit}) → rows ordered by seq asc (all states)          // caller asks limit+1 to detect reset
updateMessage(filters{id,userId?,deletedAt:null?,hiddenAt:null?},patch) → row|null    // null-valued filters mean IS NULL
allMessages(questionId) → rows ordered created_at,id (export; pages internally)
userMessages(userId) → rows
scrubUserMessages(userId,at) → number                    // body='',authorName='',authorFull='',deletedAt=coalesce(deletedAt,at)
// likes
like(messageId,userId,at) → boolean created
unlike(messageId,userId) → boolean removed
likedAmong(userId,messageIds[]) → Set<messageId>
userLikes(userId) → messageId[]
removeUserLikes(userId) → number
// files
reserveFile({id,eventId,userId,name,mime,size,width,height,thumbSize,storagePath,createdAt}) → row   // quota → fail 413 'festival upload allowance reached' code 'upload_allowance'
setFileStatus(id,from,to) → row|null
findFile(id) → row|null
filesByIds(ids[]) → rows
filesForMessages(messageIds[]) → rows (status ready)
attachFiles(ids[],messageId,userId) → number             // compare-and-set: status ready, user matches, message_id IS NULL
userFiles(userId,{limit}) → rows
removeFile(id) → number
putBytes(file,variant('full'|'thumb'),bytes) ; getBytes(file,variant) → Buffer ; deleteBytes(file)   // deleteBytes removes both variants
```

**SQLite.** The constructor runs `FIIU_TALK_SQLITE_SCHEMA`. The `users` table is the local profile table, and the triggers mirror Postgres:

```sql
CREATE TABLE IF NOT EXISTS fiiu_questions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,activity_id TEXT NOT NULL,talk TEXT,body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','closed','hidden')),revision INTEGER NOT NULL DEFAULT 0,message_count INTEGER NOT NULL DEFAULT 0,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fiiu_questions_activity ON fiiu_questions(event_id,activity_id,created_at);
CREATE TABLE IF NOT EXISTS fiiu_messages (id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES fiiu_questions(id) ON DELETE RESTRICT,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,author_name TEXT NOT NULL,author_full TEXT NOT NULL,organiser INTEGER NOT NULL DEFAULT 0,
 body TEXT NOT NULL,client_id TEXT NOT NULL,like_count INTEGER NOT NULL DEFAULT 0 CHECK(like_count>=0),seq INTEGER NOT NULL DEFAULT 0,
 hidden_at TEXT,hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL,deleted_at TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,client_id));
CREATE INDEX IF NOT EXISTS fiiu_messages_changes ON fiiu_messages(question_id,seq);
CREATE INDEX IF NOT EXISTS fiiu_messages_page ON fiiu_messages(question_id,created_at,id);
CREATE TABLE IF NOT EXISTS fiiu_message_likes (message_id TEXT NOT NULL REFERENCES fiiu_messages(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id));
CREATE TABLE IF NOT EXISTS fiiu_files (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 message_id TEXT REFERENCES fiiu_messages(id) ON DELETE RESTRICT,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER,height INTEGER,
 thumb_size INTEGER,storage_path TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','ready','deleting')),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fiiu_files_user ON fiiu_files(user_id);
CREATE INDEX IF NOT EXISTS fiiu_files_message ON fiiu_files(message_id);
CREATE TABLE IF NOT EXISTS fiiu_file_bytes (file_id TEXT NOT NULL REFERENCES fiiu_files(id) ON DELETE CASCADE,variant TEXT NOT NULL CHECK(variant IN ('full','thumb')),bytes BLOB NOT NULL,PRIMARY KEY(file_id,variant));
CREATE TRIGGER IF NOT EXISTS fiiu_message_insert AFTER INSERT ON fiiu_messages BEGIN
 UPDATE fiiu_questions SET revision=revision+1,message_count=message_count+(NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL) WHERE id=NEW.question_id;
 UPDATE fiiu_messages SET seq=(SELECT revision FROM fiiu_questions WHERE id=NEW.question_id) WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_message_change AFTER UPDATE OF body,hidden_at,deleted_at,like_count,author_name,user_id ON fiiu_messages
 WHEN NEW.body IS NOT OLD.body OR NEW.hidden_at IS NOT OLD.hidden_at OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.like_count IS NOT OLD.like_count OR NEW.author_name IS NOT OLD.author_name OR NEW.user_id IS NOT OLD.user_id BEGIN
 UPDATE fiiu_questions SET revision=revision+1,message_count=message_count+(NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL)-(OLD.hidden_at IS NULL AND OLD.deleted_at IS NULL) WHERE id=NEW.question_id;
 UPDATE fiiu_messages SET seq=(SELECT revision FROM fiiu_questions WHERE id=NEW.question_id) WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_like_insert AFTER INSERT ON fiiu_message_likes BEGIN UPDATE fiiu_messages SET like_count=like_count+1 WHERE id=NEW.message_id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_like_delete AFTER DELETE ON fiiu_message_likes BEGIN UPDATE fiiu_messages SET like_count=max(0,like_count-1) WHERE id=OLD.message_id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_question_change AFTER UPDATE OF body,talk,status ON fiiu_questions
 WHEN NEW.body IS NOT OLD.body OR NEW.talk IS NOT OLD.talk OR NEW.status IS NOT OLD.status BEGIN UPDATE fiiu_questions SET revision=revision+1 WHERE id=NEW.id; END;
```

**Booleans:** `organiser` maps to 0/1 on SQLite and true/false on Postgres. `from()` returns `Boolean`.

**SQLite quota:** in `reserveFile`, `BEGIN IMMEDIATE`, then a count and sum over `(user_id, event_id)`, then fail or insert, then `COMMIT`. Use `ROLLBACK` on error.

**SQLite insert race:** `insertMessage` / `insertQuestion` map the UNIQUE or PRIMARY KEY constraint to `fail('record changed; reload before saving', 409)` with `code: 'conflict'`.

**Supabase**
- **Reads:** PostgREST through `clients.admin.rest(table, {query, ...})`, the same pattern as `fiiu-repository.js` `find`.
- **`select` on registrations:** `select: 'id,email,first_name:answers->>firstName,last_name:answers->>lastName'`.
- **Null filters:** `is.null`.
- **Cursor:** `or=(created_at.lt.X,and(created_at.eq.X,id.lt.Y))` with `order=created_at.desc,id.desc`. Reverse the rows to oldest first.
- **`like`:** `POST fiiu_message_likes` with `Prefer: resolution=ignore-duplicates,return=representation`; created = `rows.length === 1`.
- **`unlike` / `remove*`:** `DELETE` with `return=representation`; return the length.
- **`attachFiles`:** `PATCH fiiu_files?id=in.(…)&user_id=eq.U&status=eq.ready&message_id=is.null` with body `{message_id}` and `return=representation`; return the length.
- **`reserveFile`:** `rpc/reserve_fiiu_file` with `{p_file: snakeRow}`.
  - Error `PFU01` → `fail('festival upload allowance reached', 413)` with `code: 'upload_allowance'`.
  - `23505` → 409.
  - `40P01` / `40001` → 409 `'upload changed; retry'`.
- **`questionStats`:** `rpc/fiiu_question_stats` with `{p_event_id}`.
- **Bytes:** `createObjectStorage({env: clients.env, fetchImpl, bucket: 'course-attachments'})`, at path `file.storagePath` and `file.storagePath + '.thumb'`.
  - `deleteBytes` calls `remove([path, path + '.thumb'])` in one call.
  - The thumbnail is stored with mime `image/jpeg`.
- **Page sizes:** cap every `limit` at 201. Methods that read everything (`allMessages`, `userMessages`, `userFiles`, `userLikes`) page with a keyset of `(created_at, id)`, 200 at a time.
- **Insert mapping:** map `23505` on insert to 409 `code: 'conflict'` and `23503` to 404.

- [ ] **Step 1: Write the failing SQLite tests** in `tests/fiiu-talk-repository.test.js`.
  - Use `createDatabase({filename: ':memory:'})` and `createUser` from `server/db.js` for 3 users, plus a `fiiu_registrations` row inserted through `createFiiuStore({db}).insert('registrations', …)`.
  - Cases:
    - **Revision and seq:** after 2 inserts, `revision` is 2, `seq` is 1 and 2, and `messageCount` is 2.
    - **`messagesSince`:** `messagesSince(q, 1)` returns only the second message. After `updateMessage({id: m1}, {hiddenAt})`, `messagesSince(q, 2)` returns m1 with its new `seq` of 3, and `messageCount` is 1.
    - **Likes:** `like` is true then false (idempotent), `likeCount` is 1, and the revision moves. `unlike` is true then false, and `likeCount` is 0, never negative.
    - **`latestMessages`:** excludes hidden messages unless `includeHidden`, always excludes deleted ones, returns oldest first with `more` when over the limit, and honours `before`.
    - **`updateQuestion`:** a stale version returns null; changing the body or status moves the revision; setting the same values again does not move it.
    - **`pulse`:** excludes hidden questions.
    - **`reserveFile`:** the 31st file fails with 413 `upload_allowance`; files at 30 MB in total plus 1 byte fail.
    - **`attachFiles`:** returns 0 for another user's file or an already attached file.
    - **`scrubUserMessages` then deleting the user:** messages keep their rows with an empty body and author, `deletedAt` set, and `userId` null; likes cascade.
    - **Duplicate `(userId, clientId)`:** fails with 409.
    - **`questionStats`:** counts people and likes over visible messages.
    - **Bytes:** a `putBytes` / `getBytes` / `deleteBytes` round trip for both variants.

- [ ] **Step 2: Write the failing Supabase adapter tests** with a recording fake `fetchImpl`, following `tests/fiiu-supabase.test.js`.
  - Assert the exact path and query for `messagesSince` (`question_id=eq.Q&seq=gt.5&order=seq.asc&limit=201`).
  - `like` sends `Prefer: resolution=ignore-duplicates,return=representation`.
  - `attachFiles` sends `message_id=is.null` and `status=eq.ready`.
  - A `PFU01` RPC error maps to 413 `upload_allowance`.
  - `findRegistration` selects the JSON paths and never `answers` whole, so the national ID never leaves the database.
  - Storage paths are `fiiu/<userId>/<id>` and `.thumb`.

- [ ] **Step 3: Run them to confirm they fail.** `node --test tests/fiiu-talk-repository.test.js` → FAIL.
- [ ] **Step 4: Implement `server/fiiu-talk-repository.js`.**
- [ ] **Step 5: Run them to confirm they pass.** Run `node --test tests/fiiu-talk-repository.test.js tests/fiiu*.test.js` and then `npx eslint server tests --max-warnings=0` → PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add the festival conversation store for SQLite and Supabase"`

---

### Task 5: Conversation API and server wiring

**Files:**
- Create: `server/fiiu-talk-api.js`
- Modify: `server/server.js` (imports, `createApp` option `talkStore`, limiters, dispatch before `fiiuApi`, `SESSIONLESS_API`, export and delete routes, a shared `downloads` budget)
- Test: `tests/fiiu-talk-api.test.js`

**Interfaces**

Consumes: the Task 2 domain, the Task 4 store, `createByteBudget`/`matchesEtag`/`DOWNLOAD_LIMITS` and `bodyJson` from `courses-api.js`, `encodeCursor`/`decodeCursor`/`csv`/`attachmentFilename`/`identifier`/`fail` from `courses-domain.js`, `packBits` from `qr.js`.

Produces:
- `createTalkApi({store, sameOrigin, send, rateLimit = () => true, downloads, encodeQr = null, publicOrigin, clock = Date.now, log = console.error}) → async ({req, res, url, user}) → boolean`
- `exportTalkData(store, userId) → {messages: [{id, questionId, question, body, createdAt, deleted, hidden}], files: [{id, messageId, name, mime, size, createdAt}], likedMessageIds: [...]}`
- `deleteTalkData(store, userId, {now = Date.now()} = {})`

**Route contract.** Paths are matched exactly; anything else under these prefixes returns `false`, so `fiiuApi` handles it.

| Method and path | Who | Response |
|---|---|---|
| GET/HEAD `/api/fiiu/pulse` | anyone | `200 {questions: [[id, activityId, revision, status], …]}` with the pulse Cache-Control. A 1 s per-instance memo. Any other method returns 405 with `Allow: GET, HEAD`. |
| GET `/api/fiiu/questions?activityId=` | registered or organiser | `200 {activity: activityView, questions: [questionView]}`; organisers also see hidden questions. Unknown activity: `400 {code: 'invalid_activity'}`. |
| GET `/api/fiiu/questions/:id` | registered or organiser | `200 {question, activity, messages, before, revision, me: {organiser, canPost: status === 'open'}}`. Read the question first; its revision is the baseline. Hidden or unknown for a participant: `404 {code: 'question_unavailable'}`. |
| GET `/api/fiiu/questions/:id/messages?since=N` | same | `200 {revision, changes, liked: [ids]}`, or `{reset: true, revision}` when more than 200 rows changed. A change is `messageView`, or `goneView` when deleted (and when hidden, for participants). |
| GET `/api/fiiu/questions/:id/messages?before=<cursor>` | same | `200 {messages, before}` |
| POST `/api/fiiu/questions/:id/messages` | same | `201 {message}`. An identical retry (same `clientId`, body and file ids) returns `200 {message}`. A `clientId` reused with different content: `409 {code: 'client_id_reused'}`. Closed: `403 {code: 'question_closed'}`. Files not the poster's, not ready or already attached: `400 {code: 'file_unavailable'}`. |
| DELETE `/api/fiiu/messages/:id` | the author | `200 {ok: true}`. Allowed whatever the question's status. Releases the files. Someone else's or already gone: `404`. |
| PUT/DELETE `/api/fiiu/messages/:id/like` | registered or organiser | `200 {likeCount, liked}`. Own message: `403 {code: 'own_message'}`. Closed: `403 {code: 'question_closed'}`. Hidden, deleted, or the question hidden for a participant: `404`. |
| POST `/api/fiiu/files` | registered or organiser | `201 {file: {id, name, mime, size, width, height, thumb}}`. The body limit is `bodyJson(req, 4*1024*1024 + 160*1024)`. Sequence: `reserveFile` (pending), then `putBytes` for the full image and the thumbnail, then `setFileStatus` pending→ready. |
| GET `/api/fiiu/files/:id[?size=thumb]` | registered or organiser | The bytes. Access is open to the owner and to organisers. Anyone else needs the file attached to a message that is not hidden or deleted, in a question that is not hidden. Missing: `404`. A thumbnail request for a file without one serves the full image. Images use `inline`, PDFs `attachment`. Download headers as in the spec. The `downloads.take(\`download:${user.id}\`, bytes.length)` budget is skipped for organisers. A 304 on `If-None-Match` uses the ETag `"<id>"` or `"<id>-thumb"`. |
| GET `/api/admin/fiiu/questions` | organiser | `200 {questions: [questionView + {version, stats: {messages: messageCount, people, likes}}]}` |
| POST `/api/admin/fiiu/questions` | organiser | `201 {question}`. The optional client `id` is idempotent: an identical retry returns 200, a mismatch 409 `{question}`. |
| PATCH `/api/admin/fiiu/questions/:id` | organiser | `200 {question}`. A stale version: `409 {question: current}`. |
| PUT/DELETE `/api/admin/fiiu/messages/:id/hidden` | organiser | `200 {message}`, with `hiddenBy = user.id` and `hiddenAt = now`, or both null. |
| GET `/api/admin/fiiu/questions/:id/export` | organiser | CSV through `csv()`, with the header `['question', 'block', 'talk', 'createdAtLima', 'author', 'email', 'organiser', 'text', 'files', 'likes', 'hidden', 'deleted']`. Emails come from `registrationEmails`. Filename `fiiu-conversation-<id8>.csv`. |
| GET `/api/admin/fiiu/questions/:id/qr` | organiser | `200 {url: \`${origin}/fiiu-talk.html?q=${id}\`, qr: {size, bits} or null}`, built with the same qrOf/qrView logic as `fiiu-api.js:16,41` |

**Gate order** (mirrors `fiiu-api.js:66-74`): own the path, then require a user (except on the pulse) or 401, then 403 for a non-organiser on `/api/admin/`, then the same-origin check on writes or 403, then `rateLimit(req, res, user, path, kind)`.
- `kind` is one of `'read'`, `'message'`, `'upload'`, `'like'`, `'moderate'`, `'write'`.
- The pulse never calls `rateLimit`.

**Registered check:** `access(user)` returns `{organiser, registration}`. It uses a 60 s memo, `Map<userId, {at, registration}>`, holding positive answers only and capped at 5,000 entries (evict the oldest). A user who is neither registered nor an organiser gets `403 {error: 'festival registration required', code: 'not_registered'}`.

**Server wiring** (`server/server.js`)
- **Imports and option:** `createTalkStore`, `createTalkApi`, `exportTalkData`, `deleteTalkData`. Add `createApp` option `talkStore = repository?.database ? createTalkStore({db: repository.database}) : repository?.kind === 'supabase' ? createTalkStore() : null`.
- **Sessionless:** add `'/api/fiiu/pulse'` to `SESSIONLESS_API`.
- **Shared budget:** `const downloads = createByteBudget(DOWNLOAD_LIMITS);`, passed to `createCourseApi({..., downloads})` and `createTalkApi`.
- **Limiters:**
  ```js
  const talkMessageLimiter=createWindowRateLimiter({windowMs:60000,limit:10}),talkUploadLimiter=createWindowRateLimiter({windowMs:60000,limit:6}),talkLikeLimiter=createWindowRateLimiter({windowMs:60000,limit:60}),talkModerateLimiter=createWindowRateLimiter({windowMs:60000,limit:120});
  ```
  `rateLimit: (req, res, user, path, kind) => throttle({read: fiiuReadLimiter, message: talkMessageLimiter, upload: talkUploadLimiter, like: talkLikeLimiter, moderate: talkModerateLimiter}[kind] ?? fiiuWriteLimiter, res, req, user, 'fiiu-talk-' + kind)`
- **Dispatch:** `if(talkApi && await talkApi({...})) return;` placed **before** the `fiiuApi` line.
- **Export:** `if(talkStore)data.fiiuConversations=await exportTalkData(talkStore,sessionUser.id);`
- **Delete:** `if(talkStore)await deleteTalkData(talkStore,sessionUser.id);` before `deleteCourseData`.
- **`publicOrigin`:** pass the same `fiiuPublicOrigin` the FIIU API gets.

**`deleteTalkData`**
1. Page `userFiles`. A `pending` file younger than 10 minutes gives `fail('An upload is in progress. Try again in a few minutes.', 409)`. For any other file, `setFileStatus(id, status, 'deleting')` (skip if it changed), then `deleteBytes`, then `removeFile`.
2. `scrubUserMessages(userId, nowIso)`.
3. `removeUserLikes(userId)`.

**Releasing a deleted message's files:** `ready → deleting`, then `deleteBytes`, then `removeFile`. A failure is logged and leaves the row `deleting`, which is never served.

- [ ] **Step 1: Write the failing API tests** in `tests/fiiu-talk-api.test.js`.
  - Reuse the `setup()` shape from `tests/fiiu.test.js:21-30`: `createApp({db, fiiuStore: createFiiuStore({db}), talkStore: createTalkStore({db})})`, with users member, other, admin and guest; `member` and `other` register through `PUT /api/fiiu/registration`.
  - Helper: `const jpeg = Buffer.from([255,216,255,224,...Array(60).fill(0)]).toString('base64')`.
  - Required cases (one `test()` each):
    1. **Access matrix:** the pulse answers guests with 200, the cache header and no `set-cookie`. Questions return 401 for a guest, 403 `not_registered` for a signed-in account with no registration, 200 for `member` and 200 for `admin` without a registration.
    2. **Organiser lifecycle:**
       - Create an open question, then create a hidden one with a client id.
       - An identical retry returns 200 and a changed retry 409.
       - The pulse lists only the open question, and the participant list hides the hidden one.
       - A PATCH to closed moves the revision.
       - A stale version returns 409 with the current question.
    3. **Message flow:**
       - `member` posts and gets 201. The same `clientId` with the same body returns 200 and the same id; a different body returns 409 `client_id_reused`.
       - `other` sees the message with `author: 'Ana T.'`, no `userId` and `mine: false`.
       - `since` returns only the new message, and the revision equals the pulse's revision for the question.
    4. **Likes:**
       - `other` likes `member`'s message: PUT returns `likeCount` 1 and a second PUT stays at 1. DELETE returns 0 and a second DELETE stays at 0.
       - `member` liking their own message gets 403 `own_message`.
       - A closed question returns 403 `question_closed` on like and on post.
       - Delete-own still works on a closed question.
    5. **Moderation:**
       - Admin hides the message. For `other`, `since` reports `{id, gone: true}`; `latest` excludes it; admin's view has `hidden: true` and `authorFull`.
       - Unhiding brings it back in `since` as a full message.
    6. **Files:**
       - An upload returns 201. Text or other types return 400 `file_type`; over 3 MB returns 413.
       - A PDF with a thumbnail returns 400.
       - Attaching someone else's file returns 400 `file_unavailable`. An attached file cannot be attached again.
       - **Downloads:** the owner gets 200 before attaching. `other` gets 404 before attaching and 200 after.
       - **Thumbnails:** `?size=thumb` serves the thumbnail bytes.
       - **Download headers:** `Content-Disposition` starts with `inline` for images and `attachment` for PDFs, plus `content-security-policy: default-src 'none'; sandbox`. A matching `If-None-Match` returns 304.
       - Hiding the message makes the download 404 for `other` and 200 for admin.
       - Deleting the message removes the file row and its bytes.
    7. **Quota:** a test-only store wrapper (or 30 real tiny uploads) shows the 31st upload returns 413 `upload_allowance`.
    8. **Export and deletion:**
       - `/api/me/export` contains `fiiuConversations` with the person's messages, file metadata without `storagePath`, and liked ids.
       - `DELETE /api/me` for `member` scrubs the messages (`other` sees no message, since it is gone) and removes their files and likes. The question's `messageCount` drops.
       - A pending file younger than 10 minutes blocks deletion with 409.
    9. **Rate limits:** with a 3-message limiter injected through `createApp` options, the 4th post returns 429. With the public read limiter set to 2, 10 pulse GETs from one IP all return 200 (exempt).
    10. **CSV:** the admin export has the header row; a message body starting with `=` is neutralised to `'=`; the email column is filled; a member gets 403.
    11. **QR:** admin gets `url` ending `fiiu-talk.html?q=<id>` and a `qr` object; a member gets 403.
    12. **Cancellation keeps messages:** `member` cancels their registration (`DELETE /api/fiiu/registration`). Their message is still visible to `other`, and `member` now gets 403 `not_registered` after the memo is cleared. The test injects `clock` to pass the 60 s memo.
  - To make limiters injectable for test 9, add `createApp` options `talkLimits = {message: 10, upload: 6, like: 60, moderate: 120}` and reuse the existing `fiiuPublicReadLimiter` construction. If that limiter is not injectable, the test proves the exemption by asserting the pulse branch never calls `rateLimit`: inject `talkApi` with a spying `rateLimit` into `createTalkApi` directly.

- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-talk-api.test.js` → FAIL.
- [ ] **Step 3: Implement `server/fiiu-talk-api.js` and the wiring.**
- [ ] **Step 4: Run the server suites.** `node --test tests/fiiu*.test.js tests/courses*.test.js tests/course-*.test.js tests/deploy.test.js tests/page-loading.test.js` → PASS. `npx eslint . --max-warnings=0` → clean.
- [ ] **Step 5: Commit.** `git commit -m "Serve festival conversations: pulse, questions, chat, likes, files, moderation, export and erasure"`

---

### Task 6: Participant chat page

**Files:**
- Create: `web/pages/fiiu-talk.html`, `web/scripts/fiiu-talk.js`, `web/styles/fiiu-talk.css`
- Modify: `tests/helpers/fiiu-ui-harness.js:44` (add `'fiiuTalkRoot'` to the root ids)
- Test: `tests/fiiu-talk-ui.test.js`

**Interfaces**

Consumes: `window.Fiiu` (`t, el, tr, button, link, source, api, status, dateNode, limaClock, newTabNote, rows, locale`), the Task 5 API contract, `window.nodalI18n`.

Produces: none for other tasks. Task 7 extends this same file.

**Page shell:** copy `web/pages/fiiu-checkin.html` exactly, changing:
- the title to `NODAL · Conversación`;
- `data-page="fiiu-talk"`;
- the root `<div id="fiiuTalkRoot"></div>`;
- the extra stylesheet `<link rel="stylesheet" href="fiiu-talk.css?v=20261011a">` after `fiiu.css`;
- the script `<script defer src="fiiu-talk.js?v=20261011a"></script>` after `fiiu-ui.js`;
- a noscript text in 3 languages ("Enable JavaScript to join the conversation.").

Use the same CSP meta and header markup.

**Script structure** (`fiiu-talk.js`, an IIFE, `'use strict'`):
- **Strings:** `Object.assign(Fiiu.rows, {...})` with every page string, as `key: [en, es, pt]`. Required keys and English text:

| Key | English |
|---|---|
| talkPage | Conversation |
| talkQuestions | Questions on this block |
| talkOtherQuestions | More questions on this block |
| talkEmpty | No messages yet. Be the first to answer. |
| talkPlaceholder | Write your answer… |
| talkSend | Send |
| talkSending | Sending… |
| talkNotSent | Not sent |
| talkRetry | Retry |
| talkAttach | Add image or PDF |
| talkRemoveFile | Remove |
| talkUploading | Uploading {current} of {total}… |
| talkFileType | Use JPG, PNG, WebP or PDF. |
| talkFileSize | Each file can be up to 3 MB. |
| talkTooManyFiles | Up to 3 files per message. |
| talkAllowance | You have reached the festival upload limit (30 files or 30 MB). |
| talkCharsLeft | {n} characters left |
| talkLike | Like |
| talkLikes | {n} likes |
| talkDelete | Delete |
| talkDeleteConfirm | Delete this message for everyone? |
| talkOrganiser | FIIU organisers |
| talkClosed | This conversation is closed. You can still read it. |
| talkUnavailable | This conversation isn't available. |
| talkSignIn | Sign in to join the conversation |
| talkSignInHint | Conversations are open to people registered for FIIU Fest 11. |
| talkRegister | Register for FIIU to join |
| talkRegisterHint | Registering is free and takes two minutes. |
| talkNew | New messages ↓ |
| talkLoadEarlier | Load earlier messages |
| talkPaused | Live updates paused. Reconnecting… |
| talkHide | Hide |
| talkUnhide | Unhide |
| talkHidden | Hidden |
| talkBackToBlock | All questions on this block |
| talkOpenFull | Open full image |
| talkError | Something went wrong. Try again. |
| talkRate | Too many messages at once. Wait a moment and try again. |

  - **Spanish wording** (informal "tú"):

| Key | Spanish |
|---|---|
| talkPage | Conversación |
| talkEmpty | Todavía no hay mensajes. Sé la primera persona en responder. |
| talkPlaceholder | Escribe tu respuesta… |
| talkSend | Enviar |
| talkOrganiser | Organización FIIU |
| talkClosed | Esta conversación está cerrada. Puedes seguir leyéndola. |
| talkSignIn | Inicia sesión para participar |
| talkRegister | Inscríbete en el FIIU para participar |
| talkNew | Mensajes nuevos ↓ |

  - **Portuguese** is PT-BR in the same register.
- **Address:** `params = new URLSearchParams(location.search)`; `q` matches the UUID regex; `a` matches `/^[a-z0-9-]{1,60}$/`; `present = params.get('present') === '1'` (Task 7).
- **Load:**
  - With `q`: `api('/api/fiiu/questions/' + q)`.
  - With `a`: `api('/api/fiiu/questions?activityId=' + a)`. Exactly one visible question goes straight to `history.replaceState` with `?q=`, then loads it. Several render a list ordered open first, then newest. None shows `talkEmptyBlock` ("No questions yet for this block") with a link to `fiiu.html#programme`.
  - **Errors:** 401 → the sign-in block (`login.html?next=` + `encodeURIComponent(location.pathname + location.search)`); 403 `not_registered` → the register block (`fiiu.html#registration`); 404 → unavailable; anything else → an error block with Retry.
- **Layout** (`section.f-talk`):
  - **Header:**
    - the block title (`source('h1', activity.title)`);
    - a line with the date (`dateNode(activity.date, 'span', 'short')`), the time and the venue;
    - the talk name, when set;
    - the question in a `blockquote.f-talk-question` (`source`);
    - when there are sibling questions, a "More questions on this block" `<details>` with links.
  - **Message list:** `ol.f-talk-log` with `role="log"`, `aria-live="off"` and `aria-label` = talkPage.
  - **Earlier messages:** a "Load earlier" button above the list when `before` is set.
  - **New-messages pill:** `button.f-talk-new[hidden]` with `aria-live="polite"`.
  - **Composer:** `form.f-talk-composer`, sticky at the bottom.
- **Message row** (`li.f-talk-msg`, with `data-id` and `data-seq`):
  - a header with the author (`strong`) and the organiser chip (`talkOrganiser`, class `f-talk-org`), then `time.f-talk-time` showing `limaClock(createdAt)` with `dateTime` set (add the short Lima date when it isn't today in Lima);
  - the body as a `p.f-talk-body` built by `linkify(text)`, which splits on `/(https?:\/\/[^\s<>"]+)/g` and creates an `a` (`target=_blank`, `rel=noopener noreferrer`) only when `new URL(part)` parses with `http:` or `https:`; everything else is a text node, and `innerHTML` is never used;
  - files: images as `a.f-talk-image[href=/api/fiiu/files/<id>][target=_blank]` wrapping `img[src=/api/fiiu/files/<id>?size=thumb][loading=lazy][alt=name][width][height]`, and PDFs as `a.f-talk-file` with the name and size (KB/MB);
  - the like button (`button.f-talk-like`, `aria-pressed`, label `talkLike`, visible count), hidden when `mine`;
  - Delete when `mine`;
  - Hide/Unhide when `me.organiser` (Task 7 tests cover the organiser view; build the buttons here).
- **Patching:** `upsert(view)` replaces the row with the same `data-id`, or inserts it in `createdAt`/id order. `remove(id)` handles `gone`. Each patch keeps the composer and focus as they are.
- **Scrolling:** before a patch, measure `nearBottom = scrollHeight - scrollTop - clientHeight < 120` on the document scrolling element. After the patch, scroll to the bottom when near it or when the message is your own; otherwise show the pill. Clicking the pill scrolls down and hides it.
- **Polling:**
  - `setInterval(tick, 4000)`.
  - `tick` returns early when `document.visibilityState !== 'visible'`, when busy, or when `Date.now() < nextAt`.
  - It calls `api('/api/fiiu/pulse')`, finds `[q, , revision, status]`, and fetches `?since=` when `revision > known`.
  - A missing question in the pulse (hidden) re-fetches the question, which then shows unavailable.
  - A `reset` re-runs the initial load and keeps the composer draft.
  - Errors set `failures++` and `nextAt = Date.now() + Math.min(60000, 4000 * 2 ** failures)`, and show `talkPaused` in `#fiiuStatus`. Success resets both.
  - `visibilitychange` to visible runs a tick at once.
  - 401/403 stop polling and show the matching block.
- **Status changes:** when the pulse status differs from the shown one (open↔closed), refresh the question header and composer state.
- **Composer:**
  - a `textarea` (`maxLength` 2000 as a coarse limit; the code-point count is checked in JS against 1000; `talkCharsLeft` appears under 100 left);
  - a hidden `input[type=file][multiple][accept="image/jpeg,image/png,image/webp,application/pdf"]` behind a `talkAttach` button;
  - chips for chosen files with Remove;
  - Send, and Enter+Ctrl/⌘ submits;
  - closed questions get no composer, only the `talkClosed` note.
- **Sending:**
  - Create `clientId = crypto.randomUUID()`, falling back to a v4 built from `crypto.getRandomValues`.
  - Append an optimistic row with class `is-pending` ("Sending…"), then upload the files one at a time (prepared by `prepareFile`).
  - Upload ids are cached by file signature (`name:size:lastModified`), so a retry does not upload twice.
  - Then POST. Success replaces the pending row with the server view, clears the draft and keeps focus in the textarea.
  - Failure marks the row `is-failed` with "Not sent" and a Retry button that repeats the same `clientId`, and keeps the draft.
  - Error mapping: 429 → `talkRate`; 413 `upload_allowance` → `talkAllowance`; `file_type` → `talkFileType`; 413 → `talkFileSize`; 403 `question_closed` → switch to closed.
- **`prepareFile(file)`:** implement the rules in Global constraints.
  - Use `createImageBitmap(file, {imageOrientation: 'from-image'})` and a `document.createElement('canvas')`, then `canvas.toBlob(resolve, 'image/jpeg', q)`, then `FileReader.readAsDataURL`, then `split(',')[1]`.
  - A thumbnail over 100 KB is re-encoded at 0.5. The name becomes `<base>.jpg`.
  - **When decoding fails:** an image of 3 MB or less is sent as is with no thumbnail; a larger one throws `talkFileSize`. A PDF over 3 MB throws `talkFileSize`. Other types throw `talkFileType`.
  - **Pre-checks** run before any work, then the error shows in the composer status (`p.f-talk-status[role=status]`): more than 3 files gives `talkTooManyFiles`.
- **Likes:** an optimistic toggle with `aria-pressed` and the count, then `PUT` or `DELETE /api/fiiu/messages/<id>/like`. Failure reverts and shows the error; the server's `likeCount` wins.
- **Delete:** `window.confirm(t('talkDeleteConfirm'))`, then `DELETE`, then remove the row.
- **Language switch:** `nodalI18n.onChange` re-renders the dynamic labels (counts, times) through `data-fiiu-text`; `refresh()` in `fiiu-ui.js` covers static ones.
- **Page title:** `document.title = 'NODAL · ' + t('talkPage')`.

**CSS** (`fiiu-talk.css`, every selector under `.f-page` or starting with `.f-talk`):
- **Phone first:** `.f-talk` with `max-width: 760px`, centred, using the `--f-sp-*` scale. Messages are ruled rows with whitespace between them: no cards, no shadows, no left accent bars, and a thin `--f-line` separator only between messages.
- **Own messages:** a pale tint background (`color-mix(in srgb, var(--f-leaf) 10%, transparent)`), not a bubble.
- **Composer:** sticky at `bottom: 0` with a white background, a top border and `env(safe-area-inset-bottom)` padding. Targets are at least 44 px. The textarea grows to 6 lines.
- **Thumbnails:** `max-width: min(240px, 60vw)`, `border-radius: 6px`, `aspect-ratio` from the width and height attributes.
- **Wrapping:** `.f-talk-body { overflow-wrap: anywhere; white-space: pre-wrap; }`.
- **Pending and failed:** `.is-pending { opacity: .6 }` and `.is-failed` with the `--f-error` colour on its status.
- **Pill:** fixed above the composer, centred.
- **Motion:** `@media (prefers-reduced-motion: reduce)` removes the smooth scroll.
- **Width:** no horizontal overflow at 360 px.

- [ ] **Step 1: Write the failing UI tests** in `tests/fiiu-talk-ui.test.js` with `createFiiuHarness(respond, {page: 'fiiu-talk', search: '?q=<uuid>'})`.
  - Provide in `context`: `crypto: {randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-' + String(n++).padStart(12, '0')}`, and a `createImageBitmap` and `FileReader` stub when testing files.
  - Required cases:
    1. Renders the block title, question, messages oldest first, "FIIU organisers" on an organiser message, and the Lima time.
    2. A guest (401) sees the sign-in link with `next` set to the page address; `not_registered` sees the register link; 404 sees unavailable.
    3. Sending appends a pending row, then the server row. A failure shows Retry, and retrying sends the same `clientId`. The draft text survives a failure.
    4. Polling:
       - `tickTimers()` with an unchanged pulse revision makes no `since` request.
       - A higher revision makes one `since` request; it upserts a new message and removes a `gone` one.
       - The textarea value and focus are untouched.
       - With the tab hidden there is no pulse request.
       - After 2 errors, `nextAt` backs off: the next tick is skipped by stubbing `Date.now` through `context.Date`.
    5. **Likes:** optimistic `aria-pressed`, then the server count, and a revert on failure. Own messages have no like button.
    6. **Files:**
       - 4 files show `talkTooManyFiles`, and a `text/plain` file shows `talkFileType`.
       - A `createImageBitmap` rejection with a 4 MB image shows `talkFileSize` and sends nothing.
       - A 2 MB image whose decode fails is uploaded as is, without `thumb`.
       - A successful decode uploads a JPEG plus a thumbnail.
    7. **Links:** `linkify` makes an `<a>` only for http and https and never for `javascript:` text.
    8. **Closed:** a closed question renders no composer and the closed note, and the like buttons are disabled. A pulse status change to closed removes the composer.
    9. **Block list:** `?a=day1-am` with two questions renders both links. With one question, `replaceState` goes to `?q=`.
    10. **Translations:** every string key added by `fiiu-talk.js` has three non-empty strings. Parse `Fiiu.rows` after the script runs, for the keys that start with `talk`.

- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-talk-ui.test.js` → FAIL.
- [ ] **Step 3: Implement the HTML, JS and CSS.**
- [ ] **Step 4: Run the suites.** Run `node --test tests/fiiu-talk-ui.test.js tests/fiiu*-ui.test.js` and `npx eslint web tests --max-warnings=0` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the festival conversation page for participants"`

---

### Task 7: Organiser moderation and the projector view on the chat page

**Files:**
- Modify: `web/scripts/fiiu-talk.js`, `web/styles/fiiu-talk.css`
- Test: `tests/fiiu-talk-ui.test.js` (append)

**Interfaces**

Consumes: the Task 6 page internals; `GET /api/admin/fiiu/questions/:id/qr`; `PUT/DELETE /api/admin/fiiu/messages/:id/hidden`.

**Behaviour**

**Moderation** (`me.organiser`)
- Every row shows Hide or Unhide. Hidden rows get class `is-hidden` with a `talkHidden` chip.
- Hiding sends `PUT` and unhiding `DELETE` to `.../hidden`, then upserts the returned message.
- Organisers also see hidden messages in `since` results (the server sends full views with `hidden: true`).

**Hidden questions:** an organiser viewing a hidden question still sees it. Because the pulse omits hidden questions, live updates come from polling `GET /api/fiiu/questions/:id/messages?since=` every 4 s directly.

**Projector** (`present` and `me.organiser`; otherwise the normal page renders)
- Add `body.classList.add('f-talk-present')`.
- **Layout:** a grid with the question at 3–5vw (`clamp`), block and talk lines, and a QR panel. The SVG is drawn from `{size, bits}` with a 4-module quiet zone, using the same algorithm as `fiiu-qr.js:31-41`. Copy the function; never import from or edit `fiiu-qr.js`, because the check-in QR is on the festival's critical path. Under the QR, show the short URL text.
- **Messages:** the latest 12 visible messages with text clamped to 4 lines and images as thumbnails. A switch "Latest / Most liked" (keys `talkLatest`, `talkTop`) sorts by `likeCount` then `createdAt`.
- **Controls:** a fullscreen button (`talkFullscreen`, `document.documentElement.requestFullscreen?.()`). No composer, likes or moderation controls.
- **Updates:** the pulse loop from Task 6.
- **Wake lock:** `navigator.wakeLock?.request('screen')` while visible, re-requested on `visibilitychange`, as in fiiu-qr.
- **Strings:** add `talkPresent`, `talkLatest`, `talkTop`, `talkFullscreen`, `talkScanToJoin` ("Scan to join the conversation") in three languages.

- [ ] **Step 1: Write the failing tests.**
  1. An organiser sees Hide; clicking it sends PUT and the row shows the Hidden chip; Unhide sends DELETE.
  2. A member sees no Hide.
  3. `?q=…&present=1` as organiser requests `/qr`, renders an `svg` with one `path`, has no composer form or like buttons, and the Most-liked switch reorders the rows.
  4. `present=1` as a member renders the normal page and makes no `/qr` request.
  5. The wake lock is requested in projector mode (`h.locks.length === 1`).
- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-talk-ui.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to confirm they pass.** `node --test tests/fiiu-talk-ui.test.js` → PASS. Run eslint.
- [ ] **Step 5: Commit.** `git commit -m "Let organisers hide messages and project a conversation with a join QR"`

---

### Task 8: Organiser Conversaciones section

**Files:**
- Modify: `web/scripts/fiiu-admin.js`
- Modify: `web/styles/fiiu.css` (admin section styles, `f-` scoped, appended at the end)
- Test: `tests/fiiu-admin-ui.test.js`

**Interfaces**

Consumes: the admin API from Task 5; `window.Fiiu` helpers; the existing admin patterns (`action`, `lockForm`, `reportError`, `guard`, `fetchInto`, `clearLater`, the `editors` beforeunload guard, `SECTIONS`, `lockOut`, `observeSections`).

**Behaviour**

**Strings:** add the section's keys with `Object.assign(rows, {...})` at the top of `fiiu-admin.js`, in three languages. Do not edit `fiiu-ui.js`. Keys:

| Key | English |
|---|---|
| conversations | Conversations |
| conversationsHint | Post a question on a block. Registered participants answer in a live chat. |
| newQuestion | New question |
| questionBlock | Block |
| questionTalk | Talk (optional) |
| questionText | Question |
| publishNow | Publish now |
| saveHidden | Save hidden |
| questionOpen | Open |
| questionClosed | Closed |
| questionHidden | Hidden |
| openChat | Open chat |
| present | Present |
| downloadCsv | Download CSV |
| editQuestion | Edit |
| questionMessages | {n} messages |
| questionPeople | {n} people |
| questionLikes | {n} likes |
| noQuestions | No questions yet. |
| questionSaved | Question saved |

**Section placement**
- Add `['conversations', 'conversations']` to `SECTIONS` after `content`.
- Create `conversationsHost = el('section', 'f-admin-conversations')` with `id = 'conversations'`.
- Append it in `load()` after `contentPanel()`.
- Add it to the `lockOut` empty list and to the `observeSections` host list.

**Load:** `api('/api/admin/fiiu/questions')` runs in parallel with the existing reads in `load()`. A failure renders the section with a retry, not a page failure. Refresh it in the 60 s summary timer, with the same skip rules.

**Create form**
- **Block:** a select over `chronological(festival.event.activities)`, labelled `DD/MM · title` as the publication editor labels them.
- **Talk:** a select filled from `activity.sessions[i][1]`, hidden when the block has none.
- **Question:** a textarea with `maxLength` 500 and a counter.
- **Buttons:** Publish now (status `open`) and Save hidden (status `hidden`).
- **Submit:** `lockForm`, then a POST with `{id: draftId, activityId, talk, body, status}`. Use `draftId ??= uuid()` per draft and reset it after success.
- **Unsaved drafts:** the beforeunload guard also counts a question draft with text.

**List**
- Questions are grouped by block in programme order, with the block title as a sub-heading.
- Each row shows the question text, the talk, a status segmented control (Open / Closed / Hidden), the counts, and the actions Edit, Open chat (`fiiu-talk.html?q=<id>`, new tab), Present (`fiiu-talk.html?q=<id>&present=1`, new tab) and Download CSV (`/api/admin/fiiu/questions/<id>/export`).
- **Status changes:** a PATCH with `{version, status}` through `action(control, fn, {feedback: rowNote})`. On 409, show the `reloadLatest` button that re-reads the list.
- **Closing:** a confirm (`closeQuestionConfirm`: "Close this question? People can still read it but not answer.").
- **Edit:** turns the row into the same form, pre-filled. The block cannot change. Saving sends a PATCH with `{version, body, talk}`.

- [ ] **Step 1: Write the failing tests.**
  - First extend the file's `harness()` helper with a default stub for `GET /api/admin/fiiu/questions` → `{questions: []}`, so the ~60 existing tests keep passing.
  - New cases:
    1. The section renders under its heading and nav entry.
    2. Creating a question POSTs the payload with a UUID `id`; a retry after a failure reuses the same id; after success the form clears and the list shows it.
    3. The talk select appears only for blocks with sessions.
    4. A status change PATCHes the version; a 409 shows `reloadLatest`.
    5. Closing asks for confirmation (`window.confirm` returning false sends nothing).
    6. beforeunload blocks while a question draft has text.
    7. A 403 lock empties the conversations host.
    8. The links have the right hrefs.
- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-admin-ui.test.js` → the new tests FAIL and the old ones PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to confirm they pass.** `node --test tests/fiiu-admin-ui.test.js` → PASS. Run eslint.
- [ ] **Step 5: Commit.** `git commit -m "Add the Conversaciones section to the organiser dashboard"`

---

### Task 9: Entry links and shared strings

**Files:**
- Modify: `web/scripts/fiiu-ui.js` (rows: `talkLink`, `talkLinkCount`, the `cancelConfirm` wording; helpers `pulse()` and `talkLink()`)
- Modify: `web/scripts/fiiu.js` (programme cards, compact rows, itinerary rows), `web/scripts/fiiu-hubs.js` ("Lo próximo")
- Modify: `web/styles/fiiu.css` (`.f-talk-link`)
- Test: `tests/fiiu-ui.test.js` (append); the hubs test file if one exists (`grep -l fiiu-hubs tests/*.js`)

**Interfaces**

Produces, in `window.Fiiu`:
- `pulse() → Promise<Map<activityId, number>>`: visible question counts per block, memoised for the page's life with a single in-flight request; any error resolves to an empty Map.
- `talkLink(activityId, count, cls = 'f-text-link f-talk-link') → HTMLAnchorElement`, pointing to `fiiu-talk.html?a=<id>` with the text "Conversación · N" (`talkLink` + `' · '` + N).

**Behaviour**
- **Rows:** insert the new keys immediately after the existing `nextForYou` key line in `rows`, so the anchor is stable:
  - `talkLink`: `['Conversation', 'Conversación', 'Conversa']`
  - `talkLinkCount`: `['{n} questions', '{n} preguntas', '{n} perguntas']` (the singular uses `talkLinkOne`: `['1 question', '1 pregunta', '1 pergunta']`)
- **Cancel confirmation:** change `cancelConfirm` (all three languages) to add "Your conversation messages stay; delete them first if you want them removed."
  - ES: "Tus mensajes en las conversaciones se mantienen; bórralos antes si quieres eliminarlos."
  - PT: "Suas mensagens nas conversas permanecem; apague-as antes se quiser removê-las."
- **`fiiu.js`:**
  - Call `pulse()` in parallel with the existing three requests in `load()`. Never await it before the first render; re-render the programme and summary links when it resolves.
  - `conferenceCard` and `labCard` foot: when `count > 0`, add `talkLink`.
  - `typeGroup` compact rows: the same, in `.f-compact-actions`.
  - `itineraryRow`: the same, after the venue.
  - The links show for guests too, because the chat page explains sign-in.
- **`fiiu-hubs.js`:** when `nextFor()` returns a block with `count > 0`, add `talkLink` next to it.
- **CSS:** `.f-talk-link` is a small inline link with a speech glyph made in CSS (`::before` content `'💬'` is fine, or a CSS-drawn bubble). It wraps on phones and has a 44 px target height on touch (`@media (pointer: coarse)`).

- [ ] **Step 1: Write the failing tests.**
  1. With the pulse stub `{questions: [[id1, 'day1-am', 3, 'open'], [id2, 'day1-am', 1, 'closed']]}`, the `day1-am` card shows "Conversation · 2" linking to `fiiu-talk.html?a=day1-am`, and other cards show none.
  2. A pulse failure shows no links and no error.
  3. The itinerary row for `day1-am` has the link.
  4. A guest still sees the card link.
  5. The `cancelConfirm` text includes the messages sentence in all three languages.
  6. The dashboard widget: "Lo próximo" for `day1-am` shows the link.
- [ ] **Step 2: Run them to confirm they fail.** `node --test tests/fiiu-ui.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to confirm they pass.** `node --test tests/fiiu-ui.test.js tests/fiiu-admin-ui.test.js` → PASS. Run eslint.
- [ ] **Step 5: Commit.** `git commit -m "Link festival blocks to their conversations"`

---

### Task 10: Privacy policy and documentation

**Files:**
- Modify: `docs/privacy/privacy-policy.en.md`, `privacy-policy.es.md`, `privacy-policy.pt-BR.md` (the data table, section 4, section 9 deletion paragraph)
- Modify: `docs/privacy/implementation-review.md` (rows for the four tables and the `fiiu/` storage prefix)
- Modify: `scripts/build-privacy-page.js` (the date strings: 11 October 2026 / 11 de octubre de 2026 / 11 de outubro de 2026, as formatted there)
- Regenerate: `web/pages/privacy.html` with `node scripts/build-privacy-page.js`
- Modify: `docs/implementation/fiiu-2026.md` (a new dated section: What / API / Privacy / Tests / Release order, summarising the spec)
- Test: append to `tests/privacy-page.test.js`

**Content**
- **New data-table row** after "FIIU festival":
  - **EN:** "FIIU conversations: the questions organisers post on festival blocks, and your messages, likes, images and PDFs. People registered for FIIU and administrators can see your messages, files and likes, with your first name and surname initial; administrators also see your full name. Photos you attach are resized on your device, which removes their location and camera data; PDFs keep any data they contain. You can delete your own messages. Your account export includes your messages, file details and likes. Cancelling your registration keeps your messages; deleting your account deletes your files, likes and the text and name of your messages, leaving a 'deleted message' placeholder."
  - Translate faithfully into ES (PE) and PT-BR.
- **Section 4:** a bullet saying that people registered for the FIIU festival see the conversation messages described above.
- **Section 9:** add that account deletion removes festival conversation files and blanks their messages.

- [ ] **Step 1: Write the failing test.** The generated page contains, in each language, the conversation row's key phrase: EN "FIIU conversations", ES "Conversaciones del FIIU", PT "Conversas do FIIU". Each article still has exactly 12 sections.
- [ ] **Step 2: Run it to confirm it fails.** `node --test tests/privacy-page.test.js` → FAIL.
- [ ] **Step 3: Edit the sources, regenerate the page, and update the docs.**
- [ ] **Step 4: Run it to confirm it passes.** `node --test tests/privacy-page.test.js` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Describe festival conversations in the privacy policy and the FIIU notes"`

---

### Task 11: Registration, cache keys and full builds (integration)

**Files:**
- Modify: `server/server.js` (`STATIC_PAGES += 'fiiu-talk.html'`; `STATIC_SCRIPTS += 'fiiu-talk.js'`; `STATIC_STYLES += 'fiiu-talk.css'`)
- Modify: `scripts/build-static.js` (`SERVER_PAGES += 'fiiu-talk.html'`; `STATIC_SCRIPTS += 'fiiu-talk.js'`; the styles list `+= 'fiiu-talk.css'`)
- Modify: `vercel.json`:
  - the script regex `+= fiiu-talk`;
  - the style regex `+= fiiu-talk`;
  - the no-store/noindex page regex `+= fiiu-talk`.
- Modify: every page loading a changed asset. The new key is `20261011a` for `fiiu-ui.js`, `fiiu.css`, `fiiu.js`, `fiiu-admin.js` and `fiiu-hubs.js`, across `dashboard.html`, `community.html`, `knowledge.html`, `resources.html`, `organisers-only.html`, `fiiu.html`, `fiiu-admin.html`, `fiiu-qr.html` and `fiiu-checkin.html`.
- Modify: `tests/deploy.test.js`:
  - the `festival` pins, `fiiu.js`, `fiiu-admin.js` and `fiiu-hubs.js`;
  - add `'fiiu-talk.html': {'i18n.js': '20261009a', ...festival, 'fiiu-talk.js': '20261011a', 'fiiu-talk.css': '20261011a'}` and include it in the pages list;
  - extend the "festival organiser and check-in pages" test page list with `fiiu-talk.html`, and make sure it is not in `PRIVATE_PAGES`.

Steps:
- [ ] **Step 1: Make the edits.** Run `node --test tests/deploy.test.js tests/page-loading.test.js` → PASS.
- [ ] **Step 2: Run the plain build.** `npm run build` → lint, tests and the static build all pass. Report the totals.
- [ ] **Step 3: Run the Vercel-env build.**
  ```bash
  env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://nodal.example DATA_BACKEND=supabase EMAIL_SMTP_URL='smtps://u:p@smtp.example.invalid:465' EMAIL_FROM='NODAL <a@example.org>' npm run build
  ```
  Expected: PASS.
- [ ] **Step 4: Commit.** `git commit -m "Register the conversation page and bump festival cache keys"`

---

### Task 12: Browser verification and local load check

Steps:
- [ ] **Step 1: Seed the preview.**
  - Using a scratchpad script, add two registered test members and one admin to the preview SQLite database (`.claude/launch.json` `nodal-fiiu-preview`, port 4180) with `server/db.js` `createUser` and `server/auth.js` `createSession`, as recorded in the memory note "local-preview-verification".
  - Restart the preview server.
  - Use `http://127.0.0.1:4180` only.
- [ ] **Step 2: Organiser.** In `fiiu-admin.html#conversations`, create a question on `day1-am` for talk 1. It appears in the list.
- [ ] **Step 3: Participants.** At 375×812, open `fiiu-talk.html?q=…` as member A and send text plus an image. As member B, in a second tab, the message appears within about 5 s. B likes it and A sees the count. As admin, hide it and B loses it.
  - Check there is no horizontal pan (`innerWidth === visualViewport.width`).
  - Check the composer stays sticky and long URLs wrap.
- [ ] **Step 4: Projector.** At 1920×1080 with `&present=1`, the QR renders and Most liked reorders.
- [ ] **Step 5: Entry links.** `fiiu.html` shows "Conversación · 1" on the `day1-am` card.
- [ ] **Step 6: Load check.** A scratchpad script fires 300 concurrent pulse GETs, 5 rounds, against the local server, with a wrapped talk store that counts `pulse()` calls.
  - Report the store reads per round: the 1 s memo should keep it at about 1.
  - This is not a production capacity claim.
- [ ] **Step 7: Proof.** Take screenshots of the chat at 375 px, the projector and the admin section, and send them to the user.

---

## Self-review

| Spec item | Task |
|---|---|
| Spec sections: decisions, participant, projector, organiser, data, API, client, privacy, testing, release | Tasks 1–12 |
| Pulse CDN header | Task 5, test 1 |
| Hidden questions for organisers | Task 7 |
| Cancel keeps messages | Task 5, test 12, and Task 9 copy |
| Download budget shared | Task 1 and Task 5 |
| Quota | Task 3, Task 4, Task 5 test 7 |
| EXIF claim (re-encoded on device) | Task 6 `prepareFile`, Task 10 copy |
| Review focus items | 1 → Task 6 test 3 and Task 5 test 3; 2 → Task 5 test 9; 3 → Task 5 test 5 and Task 6 test 4; 4 → Task 6 test 6; 5 → Task 4 likes and Task 5 test 4 |
