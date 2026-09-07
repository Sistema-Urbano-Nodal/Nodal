# Course pilot operations

The course pilot adds persistent enrollment, private intake, editable modules, activities and replies, private attachments, action feedback, and staff reports. It does not include an AI assistant.

## Internal team: forms and feedback

Sign in with a NODAL administrator account and open `/teaching.html`. Members cannot open this page or its reporting APIs.

- **Responses** shows ratings and comments from course actions. **All platform feedback** includes profile and matching feedback too.
- **Participants** shows enrollments and the eight intake answers for each person.
- CSV links download the complete dataset, including responses beyond the 500-record on-screen preview. Feedback includes date, participant ID/name/email, action, course and module IDs, rating, and comment. Intake, participant and activity exports are separate.
- Staff manage descriptions, objectives, assignment instructions, HTTPS material links, uploaded teaching files, recordings, session dates and publication status in **Course setup**. A version conflict preserves unsaved text and requires a reload before saving again.
- Staff can reply to assignments and questions, or remove a contribution from the course conversation. A tombstone preserves the structure of replies.

The administrator role is server-managed (`profiles.app_role` in Supabase). Assign it only to verified internal-team accounts through a trusted administrator/database workflow; participant registration cannot grant it. Existing Google Forms responses are not imported or synchronized by this feature.

## Password recovery

Use **Forgot your password?** on the sign-in page. Enter the account email and open the newest link promptly in the same browser where it was requested. The browser holds a dedicated HttpOnly recovery cookie for one hour; the provider's one-use link/code has its own expiry. A new password requires 8–160 characters. After a successful reset, sign in again; the provider invalidates the account's earlier sessions.

The production Supabase project has custom SMTP enabled. Its allowlist includes the exact production `/reset-password.html` URL. `PUBLIC_BASE_URL` (or `NEXT_PUBLIC_APP_URL`) must match that origin. A new hostname needs its own exact allowed callback. The local SQLite backend reports email recovery unavailable. Email acceptance and inbox delivery must be checked separately; do not use a staff account for automated reset testing.

## Course conversations and teaching files

Each course has an automatic **General discussion**, separate from its dated sessions. Session tabs separate **Materials**, **Discussion**, and **Assignments**; replies stay with their thread. Students must enroll and complete intake before participating and cannot edit course content. The active conversation checks for changes every 30 seconds, backing off after failures and pausing while hidden. A notice lets participants refresh without losing an open draft.

In **Course setup**, save a session before opening **Manage uploaded files**. Upload a PDF, image or text file, then save the module to publish it as a resource. Files are private and students can download only resources currently linked to an accessible module. Course files belong to the course and remain available if the staff uploader deletes their personal account. Recordings should remain external links; PPTX/DOCX may be linked externally or exported to PDF.

The file library can reuse previously uploaded files. Remove a resource and save the module before permanently deleting its unused file. Failed deletions remain retryable; pending uploads use the operator reconciliation procedure below. The course-owned library has a 100-file / 30 MB allowance per course, separate from each student's allowance.

## Activate on the intended deployment

1. Apply all pending Supabase migrations before deploying the new server. `20260905175135_network_revision.sql` is required by directory/matching privacy checks. `20260905175209_course_pilot.sql` creates private course tables, the private Storage bucket and deletion protections. `20260907172512_course_discussion_materials.sql` adds the general discussion, filtered thread history and course-owned files. Missing revision support returns 503 instead of sharing an unverifiable snapshot.
2. Set `PILOT_MODE=true`. This is also the default. It hides billing/price/membership offers, labels the prototype, redirects the payment page and rejects checkout creation. `PILOT_MODE=false` restores the existing billing experience.
3. With the intended server environment loaded, run `npm run setup:course-pilot`. It creates only the supplied course shell and the September 9, 14, 16 and 21 session dates. Repeat runs preserve staff edits. There are no fabricated teaching materials, participants or outcomes.
4. Staff add the real teaching materials in the workspace. Use externally hosted video links for recordings; this pilot does not upload/stream course videos. Check the linked service's participant permissions separately.
5. Verify signup/email confirmation and the full student/staff journey on the deployed revision before inviting the cohort. Do not use production credentials for untrusted previews.

Local setup uses the existing SQLite workflow plus `DATA_BACKEND=sqlite npm run setup:course-pilot`. Production uses Supabase; Vercel's temporary filesystem is not a database or upload store.

## Files and account erasure

Participants may attach up to three JPEG/PNG/WebP/PDF/text files per post, 3 MB each. Each participant/course has a 100-file / 30 MB allowance. Files are delivered through an authenticated API after checking membership, intake and module access; a pending upload cannot be published or downloaded.

An upload is recorded before sending bytes to Storage. If the worker loses the response or terminates, the pending record remains so the private file cannot become untracked. Account deletion pauses with a retryable error while an upload is pending. Database constraints prevent a concurrent upload from losing its cleanup record, and database triggers erase even a post written during account deletion.

An operator can inspect stale pending uploads with `npm run uploads:reconcile` (dry run). `npm run uploads:reconcile -- --apply` deletes pending objects older than 24 hours and then their records. This delay is deliberately much longer than the upload timeout. If Storage deletion fails, the record remains for retry. Run this after an upload outage or when an account deletion reports a pending upload. No recurring job is provisioned automatically.

## Capacity and free-tier limits

The local tests exercise 200 simultaneous requests in bounded bursts. They do not establish a sustained production concurrency guarantee. Warm shared directory/graph snapshots, cached ranking structures, pagination and 15-second map polling with jitter reduce repeated work. Visibility revisions remain authoritative, and private viewer graphs are kept separate.

Published limits checked September 5, 2026:

- Supabase Free includes 50,000 monthly active users, 500 MB database, 1 GB file storage and 5 GB egress. These are usage allowances, not a promise about 200 concurrent users. [Supabase pricing](https://supabase.com/pricing)
- Two hundred participants each uploading two 3 MB files would exceed 1 GB of file storage. Keep images small and recordings external, and monitor storage/egress during the pilot.
- Supabase's default email service has restricted delivery. Custom SMTP was verified enabled on September 7 for NODAL, with a 60-second per-user send interval. Confirm inbox delivery and the provider's aggregate limits before a public cohort signup. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- Vercel Hobby permits personal, non-commercial use. Confirm that the organization's planned use fits its plan; code optimization does not change plan eligibility. [Vercel Hobby](https://vercel.com/docs/plans/hobby)

## Evidence and acceptance

`npm run build` runs the full regression suite and builds CDN assets without copying protected HTML into the public directory. `npm run load:network` and `npm run load:courses` default to isolated local tests with synthetic accounts. The network script also has an explicit staging mode; never direct a capacity test at production implicitly.

Release evidence is in `docs/course-pilot-validation.md`. Before launch, validate the deployed system with staff and member accounts: email signup, enrollment/intake, all module links, one real photo upload/download, assignment, teacher reply, feedback, full CSV downloads, account export/deletion, and the behavior of an unauthorized member. Compare error rates and p95 latency while ramping the intended staging workload. Module/resource counts measure access only, not attendance, completed viewing, or learning outcomes.
