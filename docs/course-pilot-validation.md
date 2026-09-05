# Course pilot validation — September 5, 2026

Work is on `feat/nodal-course-pilot`. This combines the previously divergent local catalog and production network/profile implementations, then adds the course pilot. The original implementation was verified locally; the subsequent authorized release checks are recorded below.

## Authorized release verification

- Fresh full build after the final review: **336 tests passed**, zero failures. Five additional regression cases cover removed-post replies, discussion failure/retry, duplicate recommendation actions, recommendation error controls and saving while discussion pagination is in flight. The deployment test verifies the updated recommendation asset URL.
- Both isolated 200-user load scenarios passed again: **2,200 requests, zero errors**. These remain local burst tests, not a production concurrency guarantee.
- All seven pending schema migrations were applied to the intended Supabase project. Live queries verified the network revision singleton and five triggers, RLS and restricted browser grants for all eight course tables, service access, and the private 3 MB attachment bucket.
- The production Data API privilege smoke passed. The actual Supabase integration passed **25 acceptance checks** through the reviewed local server: authentication, role isolation, draft and intake gates, enrollment/intake persistence, private file round trip, idempotent assignments, teacher replies, feedback, four staff CSV exports, personal export, and account/file erasure. Both generated accounts and the temporary course were removed, with no cleanup errors. [Sanitized evidence](validation/course-pilot/real-supabase-smoke.json).
- Supabase Auth already has custom SMTP enabled and email confirmation required. Inbox delivery and a simultaneous cohort signup burst were not tested; the acceptance accounts were explicitly confirmed without sending email.
- Security advisors reported no new warning/error for the schema. Informational notices about RLS without policies are expected: these tables intentionally deny direct browser access. The existing leaked-password-protection warning remains unchanged.

Release `9512852` was subsequently verified on Vercel production with 25 authenticated acceptance checks, successful main CI and complete temporary-data cleanup.

## Scroll, localization and performance follow-up

- Final combined build: **354 tests passed**, no failures; dependency audit reported zero vulnerabilities.
- The dashboard notice now belongs to the main scroll area. The sidebar paints its own background instead of a separate fixed layer. Browser checks at 1504, 1100 and 390 px verified aligned scrolling and no horizontal overflow.
- Course, session and resource text supports persisted EN/ES/PT translations with original-content fallback. The translation migration and the supplied pilot title, description and four session titles were applied to the intended Supabase project. Existing staff edits are preserved. Restricted module previews include translated titles only.
- Browser checks verified Portuguese course content, English/Portuguese session titles, responsive course/staff pages and contribution/editor drafts surviving language changes. Saving one staff editor now updates only that editor and its displayed metadata, preserving drafts in other open editors. Staff exports retain the original participant answers.
- The updated server passed 40 acceptance checks against real Supabase through a local HTTP server, including translation create/update/preservation, title-only previews before intake, private uploads, feedback and all four staff CSV exports. Temporary accounts, files and course were removed with no cleanup errors.
- Own-profile reads use the profile freshly resolved within the same request (7 to 4 backend calls). Warm map/matching responses retain their initial and final authoritative revision checks while removing one redundant intermediate read (7 to 6 backend calls). A controlled 30 ms/backend-request experiment reduced mean route latency from 97 to 64 ms for own-profile reads and approximately 160 to 127 ms for map/matching reads. This is a simulated network experiment, not measured production latency.
- An isolated 200-session network run completed 1,200 requests with no errors and one shared directory/graph load. Revision reads fell from 2,601 to 1,801. Local bursts do not certify sustained production capacity.

## Automated verification

- Final full build: **331 tests passed**, zero failures. Includes existing authentication, profile, catalog, billing, consent, network and matching regressions plus course domain/API/Supabase adapter/UI checks.
- `npm audit --audit-level=low`: **0 vulnerabilities**.
- All **11 Supabase migration files** executed against a fresh local PostgreSQL 18 database. A transactional SQL check verified private table grants/RLS, private bucket configuration, pending-file account-deletion restrictions and final post erasure. Auth/Storage schemas were minimal test stubs; this is SQL evidence, not a live Supabase acceptance test.
- Supabase adapter tests cover lower PostgREST row caps, JSON values, version guards, service credentials, binary Storage bytes and exact totals.
- A fixture containing **503 feedback records** proves full staff CSV downloads exceed the 500-row preview and remain forbidden to members.
- Lost upload response, pending-file deletion and late-post account-erasure regressions pass. An independent backend review accepted the fixes.

## Local capacity evidence

| Scenario | Requests | Errors | Relevant latency |
| --- | ---: | ---: | --- |
| 200 simultaneous sessions, 1,000 directory members, six network/matching/read bursts | 1,200 | 0 | Overall p95 955 ms; cold matching wave p95 1,259 ms; warm matching p95 49 ms |
| 200 simultaneous sessions, enrollment → intake → module → assignment → feedback | 1,000 | 0 | Per-phase latency recorded in the attached JSON evidence |

The network test performed one directory load and one graph load, with 2,601 lightweight revision reads retaining privacy checks. The course test persisted 200 enrollments, 200 intakes, 200 assignments and 200 feedback records. These are short local HTTP bursts against disposable file-backed SQLite with pre-created sessions. They exclude WAN latency, signup/email throughput, sustained user pacing, Supabase/Vercel infrastructure and file-transfer load. They cannot certify 200 sustained production users.

Reproduce with `npm run load:network` and `npm run load:courses`. All generated users and data belong only to isolated local tests.

## Browser acceptance

The local preview uses disposable participant/staff accounts and the real APIs. Verified before the visual refinement: sign-in, EN/ES/PT switching, explicit enrollment, all eight private intake fields, access after saving, dated module navigation, assignment persistence, explicit 4-star feedback, and the staff report displaying the saved response and intake state.

After the visual refinement, browser acceptance verified: staff Responses/Participants/Course setup tabs, participant names and intake details, intake CSV download event, module objective/resource save followed by reopening the course, teacher reply with an uploaded disposable text file, attachment download event, contextual feedback, and Spanish UI. No browser console errors were recorded in the final review tab. Course and staff pages were inspected at desktop width and 390 px; both report document scroll width equal to viewport width at 390 px. The session rail scrolls within the layout.

The supplied private Google Drive folder was not added: automatic approval review rejected that link publication due to potential exposure. Editor acceptance used a clearly labelled public example URL in the disposable localhost preview. Real teaching materials remain a staff setup step.

Raw capacity evidence: [network bursts](validation/course-pilot/network-load.json), [course bursts](validation/course-pilot/course-load.json). SQL assertion fixture: [PostgreSQL checks](../tests/fixtures/course-postgres-check.sql).

## Release boundary

The pilot schema and translated course shell are present in the intended Supabase project. Teaching staff still need to add their real course materials. Each subsequent web release must verify its Vercel commit and repeat authenticated acceptance against the published site. See [operations](course-pilot-operations.md). The AI agent is excluded from this pilot.
