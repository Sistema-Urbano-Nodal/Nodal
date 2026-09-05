# NODAL course pilot implementation plan

> For agentic workers: use superpowers:subagent-driven-development. Keep disjoint ownership and task review. Read each supplied task brief, not unrelated history.

**Goal:** deliver a persistent course demo, staff workflows, feedback and scalable matching without an AI assistant.
**Architecture:** existing Node/HTML app; separate course domain, persistence, API and UI modules. SQLite/Supabase parity.
**Tech Stack:** Node 22, native HTTP, SQLite, Supabase REST/Storage, plain JS/CSS/HTML.
**Spec:** docs/superpowers/specs/2026-09-05-nodal-course-pilot-design.md

## Global Constraints
- No production changes, push or paid services. Preserve local catalog and production matching.
- No invented materials or participants. Pilot course metadata uses only supplied facts.
- No AI agent. EN/ES/PT interface; course text as authored.
- Authenticate and authorize every private resource; preserve directory consent and immediate withdrawal.
- PILOT_MODE=true by default; false retains billing behavior.
- File cap 3 MB; private attachments; recordings use external links.
- Meaningful behavioral tests, full regression/build and browser proof; capacity estimates labeled by environment.

### Task 1: Capacity and professional matching
Files: server/supabase.js, server/server.js (network/recommendation routes only), server/engine.js, server/store.js, new server/network-cache.js, web/scripts/globe.js, tests/capacity.test.js, tests/engine.test.js, scripts/load-test.js. Repository additions root-owned; coordinate before touching shared files.
- [ ] Test concurrent viewers coalesce shared reads, no personalized response leakage, privacy withdrawal is immediate, repeated profile lookups minimized, graph handling bounded and caches expire.
- [ ] Share snapshots and deduplicate work, preserving consent checks. Never retain stale personally identifying rows after consent withdrawal. Design SQL revision/visibility read if needed, document semantics.
- [ ] Make polling 15s with jitter and visibility/backoff guards.
- [ ] Improve matching with useful explanations and controlled diversity, respecting skips, existing follows and multilingual profession/topic normalization. Preserve deployed learned model safeguards.
- [ ] Implement controlled load runner for a local seeded real HTTP/SQLite environment at 200 concurrent users and output requests, errors and p50/p95/p99. Allow explicit staging URL but never run on production automatically.
- [ ] Run targeted tests; write task report. Root reviews integration and requests independent review.

### Task 2: Persistent course domain and API
Files: new server/courses-domain.js, server/courses-repository.js, server/courses-api.js, tests/courses.test.js, tests/courses-api.test.js; integration in server/repository.js/server/supabase.js/server/db.js/server/server.js; new migration from Supabase CLI.
- [ ] Specify and test normalized course/module/enrollment/intake/post/attachment/feedback/event resources.
- [ ] Implement SQLite and Supabase stores and private attachment storage.
- [ ] Implement the API contract below with auth/admin/ownership/same-origin/rate and size checks. Persist only valid writes, preserve retry idempotency, filter drafts, paginate posts, export CSV safely.
- [ ] Seed an explicit idempotent real mobility course shell via operational script; no automatic fake content.
- [ ] Add pilot config and server checkout gating. Add account export/deletion coverage for new data.
- [ ] Verify SQLite flows and Supabase parity/schema; produce API report.

### Task 3: Course, staff and feedback interfaces
Files: new web/pages/courses.html, web/pages/course.html, web/pages/teaching.html, web/scripts/courses.js, web/scripts/teaching.js, web/scripts/pilot.js, web/scripts/pilot-i18n.js, web/styles/courses.css; integrations in nav/dashboard/profile/recs and HTML script manifests. Root owns server/build registration.
- [ ] Build course directory and module route, explicit enrollment, private intake, materials/recordings, post/reply/upload and feedback flows using the API below.
- [ ] Build staff course/module publishing/editor, enrollment/intake review, activity/feedback report/export and moderation.
- [ ] Hide all membership/payment presentation in pilot mode, expose prototype label, add navigation from existing pages. Retain existing billing when disabled.
- [ ] Improve matching presentation with clear reasons and useful states. Persist action feedback via API.
- [ ] EN/ES/PT strings, responsive and keyboard accessible. Avoid unsafe HTML from users.
- [ ] Test required UI behavior and report. Root runs browser member/staff acceptance.

### Task 4: Integration and acceptance
- [ ] Register private pages and public assets in server/build/Vercel configuration; bump changed cached URLs.
- [ ] Validate migration and adapter parity, full tests, build, dependency audit, request/caching/security checks.
- [ ] Run member/admin course journey including file upload, refresh persistence, reply, feedback and export, and responsive visual checks.
- [ ] Run local capacity test and write limitations in DEPLOYMENT.md.
- [ ] Independent code review then fix verified findings, rerun relevant checks. Leave reviewable feature branch; report deployment/migration gates separately.

## Course API contract
All IDs UUID except feedback action enums. JSON is camelCase except store boundary. Success wrappers below. Mutations same-origin authenticated; administrator = repository user.permission==='admin'. Errors {error:string}. Staff routes /api/admin/courses. Profile access existing /api/me.

Course: {id,title,description,status:'draft'|'published'|'archived',startsOn:'YYYY-MM-DD',endsOn:'YYYY-MM-DD',enrollmentOpen:boolean,createdAt,updatedAt,version:number}. Module: {id,courseId,title,description,objectives,instructions,sessionDate:'YYYY-MM-DD',position:number,status:'draft'|'published',resources:[{title,url,kind:'slides'|'reading'|'link'|'recording'}],version,createdAt,updatedAt}. Course content remains staff-authored; render plain text.
Enrollment: {id,courseId,userId,createdAt,intakeCompleted:boolean}. Intake body/response {fullName,profession,city,motivation,experience,expectations,caseStudy,digitalFamiliarity}; strings max 2000 (name/profession/city 160). Post {id,courseId,moduleId,userId,authorName,staff:boolean,parentId:null|uuid,kind:'assignment'|'question'|'comment',body,links:[{title,url}],attachments:[{id,name,mime,size}],createdAt}. Feedback {id,action:'profile'|'matching'|'content'|'recording'|'assignment'|'discussion'|'course',courseId?:uuid,moduleId?:uuid,rating:1..5,comment?:string,createdAt}. Event {id:uuid,moduleId,kind:'module_open'|'content_open'|'recording_open',resourceUrl?:string}. Attendance or completion is never inferred from opening a link.

GET /api/config -> {pilotMode:true}
GET /api/courses -> {courses:[...Course]}
GET /api/courses/:id -> {course,modules:[...Module summaries before intake, complete after],enrollment:null|Enrollment,intake:null|Intake,isAdmin:boolean}; resource/body details only after enrollment+intake or admin.
POST /api/courses/:id/enroll {} -> {enrollment}
PUT /api/courses/:id/intake Intake -> {intake,enrollment}
GET /api/courses/:id/modules/:moduleId -> {module}
GET /api/courses/:id/modules/:moduleId/posts?cursor=... -> {posts,nextCursor}; limit 30; includes all kinds chronological, parentId linkage.
POST /api/courses/:id/modules/:moduleId/posts {kind,body,links,attachmentIds:[],parentId?,clientId:uuid} -> {post}; repeated clientId same author idempotent.
POST /api/courses/:id/modules/:moduleId/attachments {name,mime,data:base64} -> {attachment:{id,name,mime,size}}; 3 MB binary cap, HTTP envelope bounded separately; post owns attachments; private.
GET /api/course-attachments/:id -> file with attachment disposition, nosniff; enrolled+intake or staff, pending uploads owner-only.
POST /api/courses/:id/events Event -> {ok:true}; dedupe UUID per actor.
POST /api/feedback Feedback -> {feedback}; optional module/course validated.
GET /api/admin/courses -> {courses}
POST /api/admin/courses Course edit fields -> {course}
PATCH /api/admin/courses/:id {version,...edit fields} -> {course}; 409 conflict.
POST /api/admin/courses/:id/modules Module edit fields -> {module}
PATCH /api/admin/courses/:id/modules/:moduleId {version,...edit fields} -> {module}
DELETE /api/admin/courses/:id/posts/:postId -> {ok:true}; moderation tombstone preserving replies.
GET /api/admin/courses/:id/report -> {summary:{enrolled,intakeCompleted,moduleOpens,contentOpens,recordingOpens,assignments,comments},participants:[{userId,name,email,enrolledAt,intake}],feedback:[Feedback]}; bounded 500 participant rows, export supports all pagination.
GET /api/admin/courses/:id/export?type=intake|activity|feedback|participants -> CSV attachment.
GET /api/admin/feedback -> {feedback:[...]}; GET /api/admin/feedback/export -> CSV.
