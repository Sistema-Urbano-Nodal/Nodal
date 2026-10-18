# Course access for FIIU registrants, and the course as a Supporter benefit

Source: Mariana wants the NODAL premium subscription (the Supporting membership) to work through Mercado Pago. On 18 Oct 2026 the user decided that the current course becomes a Supporter benefit: people who joined it in the past keep it, people who registered for FIIU Fest 11 by a deadline get it too, and everyone else will need a membership. Branch `feature/course-fiiu-access` on production `main` (111cfd3). No database migration. Phase 1 ships before the festival opens on 20 Oct.

## Decisions made with the user

- Past learners are the people enrolled in the course before the paywall: in production, the 20 enrolments of "Curso Movilidad Nivel 2" (`72e3cc56-a506-4a1b-97b5-9333e8d283ca`), all made 5–13 Sep 2026. They keep access for good.
- FIIU Fest 11 registrants whose registration was created before the end of 25 Oct 2026 in Lima (`2026-10-26T05:00:00Z`) may join the course as a festival perk, starting now. Joining is permanent, like the past learners. The date is set in one place.
- Roll-out: the course is closed now, and payments come later. Mercado Pago, not Stripe (Stripe does not onboard businesses in Peru, https://stripe.com/global), is a separate design after the festival.
- Anyone else who is not enrolled sees the course as a preview with a "for Supporters, memberships open soon" note. The course is not hidden.
- The September conversation stays with the September group, **by date**. New joiners see only posts written from 1 October on and the replies in those threads. From October there is one shared conversation, and a note says so.
- The teaching team reviews each recording and file. An item that shows learners gets a "September group only" tick and is hidden from new joiners. Items stay open until ticked, so the review is done on deploy day.
- For phase 2 (recorded here, built later): a per-course "Supporters only" switch; a Supporter keeps access only while the membership is active; admins can grant complimentary access.

## What production holds today (read-only queries, 18 Oct)

- **The course:** one course, published, with `enrollment_open = false` since 29 Sep (version 3). It has 20 enrolments (the last on 13 Sep, none since 1 Oct), 17 intakes and no pending invitations.
- **Posts:** 14 live posts in the course, all created before 1 Oct; 2 of them are by the teaching team.
- **FIIU registrations:** 241 for FIIU Fest 11 (241 accounts), and registration is still open. 5 of those accounts are already enrolled in the course.

So "closed to new people, past learners keep access" is already true. Phase 1 adds one way in (FIIU registrants), the wording and the September boundary.

## 1. The rule (server)

### The constant and the helper

A new module, `server/course-perks.js`:

```js
export const FIIU_COURSE_PERK = Object.freeze({
  courseId: '72e3cc56-a506-4a1b-97b5-9333e8d283ca',
  eventId: 'fiiu-2026',
  registeredBefore: '2026-10-26T05:00:00Z', // end of 25 Oct 2026 in Lima (UTC-05:00, no DST)
  septemberBefore: '2026-10-01T00:00:00Z',  // a UTC instant: enrolments and posts before it belong to the September group
});
export function createCoursePerks({ fiiuStore = null, perk = FIIU_COURSE_PERK } = {}) { … }
```

`createCoursePerks` returns:

- `applies(courseId)`: true only for `perk.courseId`. Every rule below runs only on that course; other courses are untouched.
- `september(enrollmentOrPost)`: `Date.parse(row.createdAt) < Date.parse(perk.septemberBefore)`. It needs no FIIU store.
- `fiiuEligible(user)`: true when the user is not staff and the FIIU store holds a registration `{eventId, userId: user.id}` with `Date.parse(createdAt) < Date.parse(perk.registeredBefore)`. That is one read, as `server/fiiu-api.js:30` does. Without a FIIU store it answers false. Dates are always compared with `Date.parse`: Supabase returns FIIU `created_at` as `…+00:00` with microseconds, while course rows use the `…Z` text form.

### Wiring

- `createApp` (`server/server.js:1266`) builds `createCoursePerks({fiiuStore})` and passes it as `perks` to `createCourseApi`. `createCourseApi`'s own default is `createCoursePerks()` (no FIIU store), which is also what `createApp({fiiuStore: null})` gives.
- `createCourseApi` passes `perks` on to `createFinalSurvey` (`server/courses-api.js:173`).

### Who may do what on the perk course

| Viewer | Course page | Join | Sessions and materials | Posts |
|---|---|---|---|---|
| Admin | full, as today | — | all | all |
| Enrolled before 1 Oct (September group) | full, as today | — | all | all |
| Enrolled on or after 1 Oct (new joiner) | full | — | all except items ticked "September group only" (after the intake) | from 1 Oct on only (rule below) |
| Not enrolled, FIIU-eligible, enrolment closed | preview + "Included with your FIIU Fest 11 registration" | yes | after joining and the intake | as a new joiner |
| Not enrolled, not eligible, enrolment closed | preview + "For Supporters" note | no (403 `enrollment_closed`, as today) | no | no |

**Only joining depends on `enrollmentOpen`.** If an admin reopens enrolment, anyone may join as today. The September boundary still applies to every rule below (posts, ticked items, survey, report), open or closed, and does not depend on the FIIU store.

### Joining (`server/courses-api.js`)

- **`POST /api/courses/:id/enroll`** (today `:307-314`). On a closed perk course, it enrols the caller if `fiiuEligible(user)`; otherwise it answers 403 `enrollment_closed` as today. The insert, the duplicate handling and the response are unchanged. A failed FIIU read lets the error through (the member can retry).
- **`GET /api/courses/:id`**. On a closed perk course, a non-staff viewer who is not enrolled gets `join: 'fiiu'` when eligible and `join: 'supporters'` otherwise. A failed FIIU read here counts as not eligible, so the preview never breaks. Enrolled viewers, staff and every other course get no `join`. The preview itself is unchanged (`:293-297`).
- **`GET /api/courses`**. Each course gains `enrolled: true|false` for this viewer, and the closed perk course also gains the same `join`. The new reads are the viewer's enrolments plus at most one FIIU registration read. They replace the pinned read list at `tests/courses-performance.test.js:110`.
- **Other ways in.** Admin add and invite (`server/course-participants.js:57`) and invitation acceptance (`:47`, `:103`) stay refused while the course is closed. The perk is self-service only.

### Posts: hidden by date, by thread

For a viewer on the perk course who is neither staff nor in the September group:

- **A post is hidden** if it was created before 1 Oct, or if its parent is hidden. A reply written in October inside a September thread is therefore hidden too, whoever wrote it, including the teaching team. This fails closed and needs no list of September learners.
- **`GET .../modules/:mid/posts`** leaves hidden posts out, and pages stay full. The route reads batches of 31 after the cursor and filters each one. It stops once it has 31 visible posts or a batch comes back short. It returns the first 30, and sets `nextCursor` from the 30th visible post only when a 31st exists. A hidden row never becomes a cursor, and a "load more" never returns an empty page. Resolving parents uses the module's live posts (`id`, `parentId`, `createdAt`), read once per request and only for these viewers.
- **`GET /api/course-attachments/:id`** for a post file applies the same rule to the post carrying it. It answers 404 `file unavailable`, and the check sits inside the existing `purpose !== 'material'` block, before the ETag/304 branch, so `If-None-Match` (even `*`) never reveals a hidden file.
- **`POST .../posts`** with a hidden `parentId` answers `parent post unavailable`, as for a missing one.
- **`latest=1`** (the 30-second poll) is unchanged and does no new reads. An edit or a reply in a September thread can still announce "new contributions" that a new joiner then cannot see. That is accepted: it is metadata only, and rare now that the cohort has finished.
- **A member's own posts** (`:255-266`) keep their authorship-only route.

September learners and staff see everything, as today.

### Items ticked "September group only"

- **Storage.** A material or recording in a module's `resources` (JSON, `server/courses-domain.js:65-72`) may carry `septemberOnly: true`. `normalizeLinks` accepts it for materials only. No migration is needed: `resources` is a JSONB column.
- **New joiners.** For a new joiner on the perk course, ticked items are removed from the module rows in `GET /api/courses/:id` and `GET .../modules/:mid`. A ticked attachment answers 404 `file unavailable` (`referencesMaterial` checks only the visible items, before the ETag branch). `POST .../events` refuses a ticked item as "resource is not in this module".
- **Teaching workspace.** Each resource row gets a "September group only" checkbox, shown only on the perk course (`web/scripts/teaching.js:67-73`, saved at `:126`).

### Final survey and certificates (`server/course-final-survey.js`)

They stay with the September group. For an enrolment on or after 1 Oct on the perk course:

- **Snapshot:** none. `snapshot` returns null, so no form and no `publishAs`.
- **Start and submit:** `PUT …/survey/start` and `POST …/survey` answer 403 `survey_unavailable`.
- **Certificate upload:** the organiser's upload (`:225`) refuses 404 `certificate_not_enrolled`.
- **Roster** (`:197-203`): organiser CSVs, response counts and the certificate matcher count only the September group.

The survey closes on 24 Oct anyway; this keeps its figures and certificates unchanged.

### Teaching workspace report

The participants table and its CSV gain a "Group" value per enrolment on the perk course: "September 2026" or "From October" (by the boundary, not by FIIU, since a reopened course also admits non-FIIU people). New keys in `web/scripts/pilot-i18n.js`, a new column in the participants CSV (`server/courses-api.js:344`), and the table in `web/scripts/teaching.js:249`. Admins still see every post.

### Edge cases (decided)

- **Re-registering for FIIU.** Eligibility uses the registration that exists at join time. Cancelling and re-registering after 25 Oct gives a new date and so no perk.
- **Cancelling FIIU after joining.** A person who joined and then cancels their FIIU registration keeps the course: the enrolment is not linked to the registration.
- **Registering only to get the course.** Registering for FIIU just to get the course is accepted: the perk is meant to reward registering.
- **No join deadline.** Phase 2 replaces the constant and may set one.
- **Wrong-account survey link.** With `?encuesta=1` (the survey's wrong-account link), the `join: 'fiiu'` view shows the wrong-account helper and **no** Join button. A September learner signed into a second, FIIU-registered account must not enrol it by mistake.
- **Late refusal.** If `/enroll` answers `enrollment_closed` while the page shows `join: 'fiiu'` (the registration was cancelled after the page loaded), the page reloads the course instead of re-rendering the old state.

## 2. What members see (web/scripts/courses.js, pilot-i18n.js)

The closed branch (`web/scripts/courses.js:43`) splits on `join`:

- **`join: 'fiiu'`:** "Included with your FIIU Fest 11 registration." and a **Join the course** button. This is the existing enrol flow: join, then the intake form, then the materials.
- **`join: 'supporters'`:** "For Supporters" and "This course is part of the Supporting membership, which opens soon. People already enrolled keep full access." No button and no payments link: payments stay hidden in pilot mode.
- **No `join`** (any other closed course): the existing `closed` / `closedNote`.

In the conversation, September learners and new joiners see one line above the posts on the perk course: "Since October, new participants join this conversation. Contributions from September stay visible to the September group only."

The course list (`directory()` in `web/scripts/courses.js:24`) shows one short label per card. Enrolled viewers see "Enrolled", which is new. On the closed perk course, other viewers see "Included with FIIU" or "For Supporters". Other closed courses keep "Enrollment closed", and open courses show no label. Staff see the cards as today.

New keys in `web/scripts/pilot-i18n.js` (EN / ES / PT):

| Key | EN | ES | PT |
|---|---|---|---|
| `fiiuIncluded` | Included with your FIIU Fest 11 registration. | Incluido con tu inscripción al FIIU Fest 11. | Incluído na sua inscrição no FIIU Fest 11. |
| `joinCourse` | Join the course | Unirme al curso | Entrar no curso |
| `supportersOnly` | For Supporters | Para la membresía de apoyo | Para a assinatura de apoio |
| `supportersNote` | This course is part of the Supporting membership, which opens soon. People already enrolled keep full access. | Este curso forma parte de la membresía de apoyo, que abre pronto. Quienes ya están inscritos conservan el acceso completo. | Este curso faz parte da assinatura de apoio, que abre em breve. Quem já está inscrito mantém o acesso completo. |
| `fiiuTag` | Included with FIIU | Incluido con el FIIU | Incluído com o FIIU |
| `enrolledTag` | Enrolled | Inscrito | Inscrito |
| `sharedSince` | Since October, new participants join this conversation. Contributions from September stay visible to the September group only. | Desde octubre se suman nuevas personas a esta conversación. Las contribuciones de septiembre solo las ve el grupo de septiembre. | Desde outubro, novas pessoas entram nesta conversa. As contribuições de setembro ficam visíveis só para a turma de setembro. |
| `septemberOnly` | September group only | Solo grupo de septiembre | Só turma de setembro |
| `groupSeptember` / `groupOctober` / `group` | September 2026 / From October / Group | Septiembre 2026 / Desde octubre / Grupo | Setembro 2026 / Desde outubro / Turma |

## 3. Plan wording (landing and payments pages)

The free plan stops promising courses, and the Supporter plan gains them.

| Key | Where | EN | ES | PT |
|---|---|---|---|---|
| `mem.f1` | index.html:454; ES/PT in i18n.js | Open labs and community sessions | Laboratorios abiertos y sesiones comunitarias | Laboratórios abertos e encontros comunitários |
| `y.f1` | payments.html:68; ES/PT in i18n-dashboard.js | Community sessions and open resources | Sesiones comunitarias y recursos abiertos | Encontros da comunidade e recursos abertos |
| `mem.p7` (new, after `mem.p5`) | index.html Supporter list; i18n.js | Supporter courses with the teaching team | Cursos de la membresía con el equipo docente | Cursos da assinatura com a equipe docente |
| `y.p6` (new, after `y.p5`) | payments.html Supporter list; i18n-dashboard.js | Supporter courses with the teaching team | Cursos de la membresía con el equipo docente | Cursos da assinatura com a equipe docente |

`tests/home-i18n.test.js` fingerprints the ES and PT dictionaries. The changed `mem.f1` and `y.f1` move the home and non-home snapshots for es and pt, so those hashes are updated. The new `mem.p7` and `y.p6` go in the file's `later` list with their own coverage test, as its convention asks. No price appears, so the landing price test still holds.

## 4. Not in phase 1

- **Out of scope:** no database change, no Mercado Pago, no Stripe change, and no change to `PILOT_MODE`, which keeps the prototype banner and hides billing.
- **External recording links:** recordings on Drive, YouTube or Vimeo stay reachable by anyone who already holds a link. NODAL only stops showing ticked items to new joiners.
- **No announcement:** no email or console announcement of the perk. It can be added later as one line in the console's FIIU hub.

## 5. Phase 2 (after the festival; its own spec)

- **Mercado Pago subscriptions** through Mariana's account:
  - NODAL creates each member's subscription, on Mercado Pago's hosted checkout, with `external_reference` = NODAL user id.
  - A signed webhook, with the status read back from Mercado Pago.
  - Self-serve cancellation.
  - A provider-neutral membership record instead of the Stripe-named one.
- **Course switch and access basis:** a per-course "Supporters only" switch in the teaching workspace, replacing the constant, and an access basis per enrolment: September group, FIIU, complimentary (admin grant), Supporter.
- **How long access lasts:** a Supporter's access lasts while the membership is active. FIIU joiners, past learners and complimentary grants keep theirs.
- **Open questions for Mariana:**
  - whose Mercado Pago account receives the money (personal with DNI, or business with RUC);
  - the prices in soles;
  - whether Lima Cómo Vamos agrees to its materials being part of a paid membership;
  - whether only Peruvian payers can use a Peruvian Mercado Pago account;
  - how NODAL issues SUNAT receipts.
- **Privacy policy:** it must name Mercado Pago before anyone pays.

## 6. Operations on deploy day

1. Deploy (no migration).
2. The teaching team opens each of the four sessions in the teaching workspace. They tick "September group only" on every recording or file that shows learners (faces, voices, names, field-exercise photos).
3. Check as a FIIU-registered test account on a local server, never in production: the join button, the intake, the materials without ticked items, and no September posts.

## 7. Testing

- **Joining:**
  - Joining works for an eligible registrant on the closed perk course only.
  - These all leave the course closed, with `join: 'supporters'` and a 403:
    - a registration created at or after the deadline, including a `+00:00` microsecond timestamp one second after it;
    - another event's registration, or none;
    - a cancelled registration;
    - a staff account;
    - no FIIU store.
  - A failed FIIU read gives `join: 'supporters'` on GET and an error on POST.
  - Reopening enrolment restores today's joining.
  - The `join` and `enrolled` values in the course and list answers.
- **Posts:**
  - A new joiner never receives a pre-October post, a reply under one (including a teaching-team reply), or any of their files (list; attachment, including `If-None-Match: *` and the file's ETag; reply parent).
  - New joiners get October posts and full pages; a page boundary followed only by hidden posts gives `nextCursor: null`.
  - September learners and staff see everything.
  - The poll does no new reads.
  - All of this still holds after enrolment is reopened.
- **Ticked items:**
  - Absent for new joiners in both module views.
  - The attachment answers 404, and the event is refused.
  - Present for the September group and staff.
  - The checkbox appears only on the perk course and round-trips through save.
- **Survey:**
  - A new joiner gets no snapshot, and 403 on start and submit.
  - Certificate upload for them is refused.
  - Roster, CSVs and counts are unchanged.
- **Report:** the Group value in the table and the CSV.
- **UI:**
  - Both closed-branch states.
  - The `?encuesta=1` variant.
  - The late-refusal reload.
  - The card labels.
  - The conversation note, in EN/ES/PT.
  - The join flow leads to the intake form.
- **Copy:** the plan strings in three languages, and the fingerprints.
- **Builds and screenshots:**
  - Both builds pass (`npm run build`, and the Vercel-env build).
  - A local seeded server, checked in headless Edge at phone width for each viewer state.
