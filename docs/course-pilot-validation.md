# Course pilot validation — September 5, 2026

Work is on `feat/nodal-course-pilot`. This combines the previously divergent local catalog and production network/profile implementations, then adds the course pilot. No production deployment or remote database mutation was performed.

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

The deployable code, migrations and operational scripts are prepared. Production still requires applying migrations, creating the course shell in the intended Supabase project, adding real course materials, confirming email/plan configuration and testing the deployed participant/staff journey. See [operations](course-pilot-operations.md). The AI agent is excluded from this pilot.
