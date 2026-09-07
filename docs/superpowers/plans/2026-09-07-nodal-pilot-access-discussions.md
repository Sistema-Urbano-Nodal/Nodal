# NODAL pilot access and discussions implementation plan

> **For agentic workers:** Use subagent-driven development with separate auth, course backend, and course UI ownership. Root reviews integration and release evidence.

**Goal:** Give the approved internal team admin access, recover forgotten passwords, and support course-wide conversations, assignment threads, and official teaching files.

**Architecture:** Extend the existing Node server, Supabase GoTrue authentication, and private course repository. General discussions reuse module access checks; course-owned files reuse authenticated attachment delivery. Recovery uses a dedicated signed HttpOnly PKCE cookie and the provider's standard email flow.

**Tech Stack:** Node 22, vanilla HTML/CSS/JavaScript, SQLite for isolated tests, Supabase Auth/Postgres/Storage, Vercel.

**Spec:** User-approved September 7 request and Flavia's course-pilot feedback. Mariana Alegre was explicitly confirmed as the intended Mariana.

## Global constraints

- Preserve the public homepage and the existing course/student privacy boundaries.
- Deliver EN/ES/PT text and accessible, responsive course controls.
- Admin is the server-managed `profiles.app_role`; self-registration cannot grant it.
- Keep the AI assistant out of this release.
- Use only disposable accounts/course data for release acceptance; never reset staff passwords.
- Deploy only the revision that passes the full regression/build and release checks.

## Task 1: Internal-team access

- [x] Identify confirmed Flavia Muro and Mariana accounts; obtain clarification for the different Mariana surname.
- [x] Guard role updates by exact account ID/email and confirm `app_role='admin'` for Flavia Muro Doig and Mariana Alegre.
- [x] Confirm the production application reads current roles without changes to personal profile or passwords.

## Task 2: Password recovery

Files: `server/supabase.js`, `server/server.js`, login/reset pages, recovery scripts, static build/deployment allowlists, `tests/password-recovery.test.js`.

- [x] Implement `POST /api/auth/recovery/request` with fixed callback, provider PKCE challenge, generic account-neutral response and request limits.
- [x] Implement `POST /api/auth/recovery/complete` with signed verifier cookie, trusted provider recovery proof, password validation and session cleanup.
- [x] Add translated request/reset forms, same-browser guidance, expired-link recovery, and honest failure messages after a consumed code.
- [x] Verify existing custom SMTP and add the exact production `/reset-password.html` callback.
- [x] Run recovery/auth regressions and real-provider acceptance with disposable identities; report SMTP acceptance separately from mailbox delivery.

## Task 3: Discussions and official materials

Files: course domain/schema/repository/API/privacy, upload reconciliation, new Supabase migration, backend tests.

- [x] Add `course_modules.kind`, one general discussion per course, and inherited post thread kinds.
- [x] Add bounded latest/history filtering and revision metadata for conversation refresh.
- [x] Add staff-only material upload/list/delete and attachment-backed module resources.
- [x] Keep official materials course-owned through staff account deletion; enforce publication/access/reference checks on download.
- [x] Preserve durable pending/deleting records for storage reconciliation and protect publication against concurrent file deletion.
- [x] Apply all migration files to a fresh local PostgreSQL database.
- [x] Verify backfill, role privileges, revisions, retention and concurrent resource/deletion behavior.

## Task 4: Course interface

Files: course/teaching pages, courses/teaching/pilot scripts, pilot dictionaries, course styles and frontend tests.

- [x] Expose general conversation independently of the session rail.
- [x] Separate Discussion and Assignments with keyboard-accessible tabs and preserved drafts.
- [x] Add official file controls to Course setup, including removal of unused uploads.
- [x] Poll only visible active conversations every 30 seconds; show an explicit refresh action without replacing drafts.
- [x] Verify all three languages, mobile layout, keyboard behavior, thread replies and staff upload/download.

## Task 5: Release

- [x] Review changes and run `npm run build` plus dependency audit.
- [x] Apply the reviewed additive database migration before promoting the application.
- [x] Run synthetic real-Supabase API acceptance and cleanup.
- [ ] Push a release-validation branch, verify GitHub CI and Vercel preview, then promote that same commit to main.
- [ ] Verify production deployment SHA, protected routes, assets, and authenticated acceptance.
- [ ] Record actual results and remaining limitations in the operations/validation documentation.

Recovery provider/session acceptance passed without email delivery. Full emailed PKCE/inbox acceptance remains a separate check requiring a designated test mailbox.
