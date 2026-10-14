# FIIU closing party, editable programme, General space and rating questions

Source: a message from Flavia Muro (FIIU organisers) relayed on 13 Oct 2026, and the design conversation that followed. The festival runs 20–25 Oct 2026 in Lima. The branch is `feature/fiiu-programme-general`, built on `feature/ui-round-3`. Round 3 ships first, on its own; this work does not depend on it being live.

## Decisions made with the user

- **Closing event:** renamed "¡Fiesta de cierre y Chelas Urbanas!", on **Sun 25 Oct**. Chelas Urbanas 17:00–19:00, the closing party from 19:00 onwards. Venue: La Vermut Bar, Av. Francisco Bolognesi 235, Barranco 15063. Registration goes through NODAL.
- **Party is register only:** people add it to their festival registration so organisers get a headcount and a list. It never takes a QR check-in and never adds certificate hours.
- **Party email:** a one-off announcement to every registrant who has not added the party yet, started by an organiser from the panel. No duplicates.
- **Programme editing:** organisers edit the details of every existing block from the panel. New blocks still come from a code change; there is no adding or removing.
- **Storage:** approach A, a new `fiiu_programme` table, one row per edited block with its own version (not a field inside the settings record).
- **General space:** a festival-wide conversation space next to the per-block ones. Registered participants and organisers take part, as on blocks.
- **Rating questions:** organisers can create a question of type "Rating 1–10" in General or in any block. People tap one number (changeable while open) and may comment in the chat below. Everyone sees the average and the 1–10 spread once they have rated. Scores are anonymous to everyone, organisers included.

## 1. The closing party block

A new built-in activity in `server/fiiu-domain.js`:

```js
{id:'closing-party',date:'2026-10-25',period:'party',registration:'social',
 title:'¡Fiesta de cierre y Chelas Urbanas!',time:'17:00',
 venue:'La Vermut Bar, Av. Francisco Bolognesi 235, Barranco 15063',
 sessions:[['17:00–19:00','Chelas Urbanas'],['19:00 en adelante','Fiesta de cierre']]}
```

- **A new registration kind, `social`.** Every check-in, attendance and hours path already filters on `['general','application']`, so `social` is excluded by default: `isCheckinActivity`, `CHECKIN_ACTIVITIES`, the staff attendance checkboxes, the QR screen and `attendanceHours` need no special case. A test pins that the party can never be checked in or counted.
- **Registration form and validation:** the blocks a person ticks are those with `registration` in `['general','social']`. `normalizeRegistration` accepts both kinds and the limit goes from 5 to 6. A registration with only the party is valid. The festival page shows the party with the same "Add to my registration" action as a conference block (`fiiu.html#add-closing-party` works).
- **Organiser panel:** the party has a headcount and appears in the participant filter and CSV like any block. It has no attendance column.
- **Conversations:** the party has a block conversation like any other block.
- **Removed:** the "Closing party / separate registration" aside on `fiiu.html`, its strings (`party`, `partyHint`, `partyRegister`, `partyDetails`), and the `partyUrl` link field in organiser settings. `partyUrl` leaves `DEFAULT_CONFIG` and `normalizeConfig`; a stored value is ignored.
- **Programme display:** the party sits on the 25 Oct day in time order. A start-only time reads "Desde las 17:00 / From 17:00 / A partir das 17:00".

## 2. The editable programme

### What can change

For every block (conference, lab, party, workshop, route):

| Field | Rule |
|---|---|
| `title` | 1–200 characters, trimmed, one line |
| `date` | `YYYY-MM-DD` between the festival's `startsOn` and `endsOn` (20–25 Oct) |
| `time` | see below |
| `venue` | 0–200 characters, one line |
| `description` | new, optional, 0–1,500 characters, line breaks kept, shown as plain text (no HTML, links made clickable like chat bodies) |
| `sessions` | 0–12 lines, each a time label (0–40 characters, free text such as "19:00 en adelante") and a title (1–180 characters, the limit of a conversation talk, so any session can carry a question) |
| `formUrl` | workshops and routes only, an `https://` URL |

The block's `id`, `period` and `registration` kind never change: registrations, check-ins and conversations point at them.

**Time:**
- A block that takes a check-in (`general`, `application`) has either no time (untimed, as the lab is today: it closes at the end of its Lima day and counts 0 hours) or a full range `HH:MM–HH:MM` with the start before the end. Check-in windows and hours are computed from it.
- The party, workshops and routes may also have a start only (`HH:MM`).
- The editor saves the canonical form (`09:00–13:00`, en dash).

### Storage and merging

- **Table `fiiu_programme`:** one row per block an organiser has edited, holding the full set of edited fields (not a diff), its own `version`, `updated_by` and `updated_at`. No row means the block shows its built-in values.
- **A new server module, `server/fiiu-programme.js`:**
  - `effectiveEvent(rows)` merges each row over the built-in block and returns an event shaped exactly like `FIIU_EVENT` (same keys plus `description`, and `edited:true` on edited blocks).
  - `createProgramme({store, ttlMs=30000})` returns `{event(), save(id,input,version,userId), restore(id,version)}`. `event()` reads the table at most once per 30 s per server instance and serves the merged event from memory in between; a save or restore in that instance clears it at once. Other instances catch up within 30 s.
  - `normalizeProgrammeEdit(activity,input)` applies the rules above and throws the usual 400 with a `code` for each refusal.
- **Every reader switches to the merged event:**
  - `GET /api/fiiu` (public, CDN-cached 15 s) and `GET /api/admin/fiiu/config`.
  - The check-in window for the QR screen and for scans (`checkinWindow` gets the merged activity).
  - Certificate hours (`attendanceHours(attendance, merged activities)`), in the person's FIIU page and the organiser export.
  - The registration summary email and the party email (`registrationEmail({event})` already takes an event).
  - Conversations (`activityView` and the block pages).
  - The organiser participant CSV.
- Registration validation and `canAttend` use only ids and kinds, which never change, so they keep the built-in list.
- **Propagation:** an edit reaches every page within about 45 s at worst (30 s instance memo plus 15 s CDN).

### Effects people should know about

- Hours are always computed from the current programme. Changing a conference block's time after people have checked in changes their hours. The editor says so before saving when the block has check-ins.
- Changing a conference block's date or time moves its check-in window. The editor says so for a block whose day has started.

## 3. The organiser's programme editor

A new **"Programme"** section in `fiiu-admin.js`, between "Registration and links" and "Conversations", with an entry in the section menu (`#programme`).

- **List:** blocks grouped by festival day, in time order. Each row shows the time (or "Untimed"), the title, the kind (Conference, Lab, Party, Workshop, Route) and an "Edited" pill for a block with a `fiiu_programme` row.
- **Edit:** "Edit" opens a form under the row:
  - Title; date (a date input limited to 20–25 Oct); start and end time (two time inputs; the end is optional only where the rules allow a start only); venue; description (textarea with a character count); session lines (time label and title per line, with Add line, Remove, Move up and Move down); form link for workshops and routes.
  - "Save" and "Cancel". Save sends the full set of fields with the version read.
  - "Restore original" (only for an edited block) asks for confirmation and deletes the row.
  - One form open at a time; opening another block with unsaved changes asks first.
- **Conflicts:** a save against an older version answers 409. The form offers "Reload the latest version", which re-reads that block only and keeps what the organiser typed in the fields they changed, like the question editor's reload.
- **Warnings:** shown inline before Save, as described in section 2.
- **Leaving:** unsaved edits trigger the page's existing `beforeunload` question.
- **Language:** labels, hints and errors in EN/ES/PT. Block texts are single-language data written by the organisers, as today.
- **Phones:** the list is one column; inputs are 44 px targets; no sideways scroll at 360 px.
- **Access:** `permission === 'admin'`, like every `/api/admin/fiiu` route.

## 4. The party announcement email

- **Panel:** in the Programme section, directly under the party's row, an "Announce the party" block shows: how many registrants have not added the party, how many announcements have gone out, how many are left today under the daily cap. The button asks for confirmation with the number of people.
- **Sending:** the same batch mechanism as the summary-email backfill. Each press sends batch after batch (4 per request) until done, stopped, or the daily cap is reached. Each row is claimed (`pending`) before its email goes out, so a double click or a second organiser never emails anyone twice. Retry covers `failed`; `uncertain` is never resent automatically, as with confirmations.
- **Daily cap:** party emails count toward the existing 150-a-day cap, shared with summary emails, so the counter in both places includes both.
- **Recipients:** registrations whose `answers.activities` does not include `closing-party` at the moment of the claim, with no notice row in `sent`, `pending` or `uncertain`. Reserved test domains (`example.*`, `.test`, …) are marked `skipped`.
- **Content:** subject "¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11" (localised). The party's title, date, session lines, venue and a button "Añadir a mi inscripción" linking to `/fiiu.html#add-closing-party`. Built from the merged programme, so edits show. Same lockup, layout and plain-text part as the summary email. Language: the registration's `confirmation_language`, else Spanish.
- **Storage:** `fiiu_notices`, one row per person per notice kind (`kind` is `'closing-party'` for now), with status, language and `sent_at`.

## 5. The General space

- **Identity:** a pseudo-block with id `general`, `period:'general'`, title "FIIU General" (localised label in the UI; the stored id is the key). `talkActivity('general')` returns it; it has no date, time or venue and is not part of the programme or registration.
- **Entry points:** a "Conversación general" link at the top of the programme on `fiiu.html` and in the console's festival block (`fiiu-hubs.js`), each with the count of open questions like block links. The page is `fiiu-talk.html?a=general`, with the same list, chat, live updates and projector as a block.
- **Organisers:** the block picker in the panel's Conversations section starts with "General (whole festival)". Questions there are created, edited, opened, closed and hidden like block questions.
- **Who takes part:** registered participants and organisers, the same `access()` rule as blocks.
- **Pulse:** general questions appear in the public pulse with activity id `general`, like any block.

## 6. Rating questions

### Organiser side

- The question form gains a type choice: "Conversation" (default) or "Rating 1–10". The type is set at creation and cannot change.
- A rating question's row in the panel shows the average (one decimal), the number of people and a 1–10 bar strip, and offers a CSV of the ten counts.

### Participant side

- Under the question: ten buttons, 1 to 10, as a single row on wide screens and two rows of five on phones, each at least 44×44 px, in a `role="radiogroup"` with the chosen one `aria-checked="true"`. A label under the scale reads "1 = lowest, 10 = highest".
- One tap saves the score (`PUT`). Tapping another number changes it. While saving the scale shows the choice at once; a failure puts the previous choice back and says why, like likes.
- Once the person has rated: "Your rating: 8 · Average 7.6 from 42 people" and a bar strip of the ten counts, with a text alternative ("8 people chose 10, …") for screen readers.
- Before rating, the results are not shown on that person's screen. The totals still travel in the shared live updates (they are not secret: one answer serves every phone), but the page holds them back until the person rates, which is what avoids anchoring their score.
- The chat below works as on any question and is optional.
- Closed: the scale is disabled and the results are shown to everyone who rated and to organisers. Hidden: as for any question.
- Projector: the question, the live average in large type, the bar strip and the count; comments scroll beside it as today.

### Rules

- Anyone who may post on the question may rate it, organisers included; one score per person per question; only while the question is open.
- Scores are anonymous to everyone. No API returns who gave which score; organisers see only totals. A person's own score comes back to them only.
- Rate limit: the same per-user budget as likes.

## 7. Data model

One additive migration, `supabase/migrations/20261013120000_fiiu_programme_general.sql`, applied with `supabase db query --linked -f`, then `migration repair --status applied`. Never `db push`.

```sql
CREATE TABLE public.fiiu_programme (
 event_id text NOT NULL CHECK(event_id='fiiu-2026'),activity_id text NOT NULL CHECK(activity_id ~ '^[a-z0-9-]{1,60}$'),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),version integer NOT NULL CHECK(version>0),
 updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(event_id,activity_id)
);
ALTER TABLE public.fiiu_questions
 ADD COLUMN kind text NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat','rating')),
 ADD COLUMN rating_counts integer[] CHECK(rating_counts IS NULL OR cardinality(rating_counts)=10);
CREATE TABLE public.fiiu_ratings (
 question_id uuid NOT NULL REFERENCES public.fiiu_questions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 score smallint NOT NULL CHECK(score BETWEEN 1 AND 10),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(question_id,user_id)
);
CREATE INDEX fiiu_ratings_user ON public.fiiu_ratings(user_id);
CREATE TABLE public.fiiu_notices (
 event_id text NOT NULL CHECK(event_id='fiiu-2026'),user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('closing-party')),
 status text NOT NULL CHECK(status IN ('pending','sent','failed','uncertain','skipped')),
 language text CHECK(language IN ('en','es','pt')),sent_at timestamptz,created_at timestamptz NOT NULL,
 PRIMARY KEY(event_id,user_id,kind)
);
```

- **Trigger on `fiiu_ratings`** (insert, update of score, delete): adjusts `fiiu_questions.rating_counts` for the question (initialised to ten zeros on first use) and bumps its `revision` in the same transaction, so `?since=` and the pulse pick the change up. `SECURITY DEFINER`, `search_path ''`, like the existing triggers. A rating on a question that is not `open` or not `kind='rating'` is refused by the trigger as well as by the API.
- **Questions:** the existing revision and `message_count` triggers are untouched. `kind` is set by insert only; an update that changes it is refused.
- **Security:** RLS on for the three new tables, no policies, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role`, as for every FIIU table.
- **Local SQLite** (`server/fiiu-repository.js`, `server/fiiu-talk-repository.js`): the same tables and columns; counts kept by the repository in the same transaction (SQLite has no `integer[]`: a JSON text column).

## 8. API

| Route | Who | Does |
|---|---|---|
| `GET /api/admin/fiiu/programme` | organisers | built-in and edited values per block, with versions |
| `PUT /api/admin/fiiu/programme/:activityId` | organisers | `{...fields, version}`; 0 creates; 409 on an old version |
| `DELETE /api/admin/fiiu/programme/:activityId?version=n` | organisers | restore the original |
| `GET /api/admin/fiiu/notices/closing-party` | organisers | `counts` (waiting, pending, sent, failed, uncertain, skipped), `sentToday`, `dailyCap`, `resetsAt` |
| `POST /api/admin/fiiu/notices/closing-party` | organisers | `{retryFailed?, after?}`: one batch, like the backfill |
| `PUT /api/fiiu/questions/:id/rating` | participants and organisers who may post | `{score}` → `{score, ratingCounts, revision}` |

- Question views gain `kind` and, for ratings, `ratingCounts` (ten integers). The full question read adds `me.score` (or `null`). `?since=` answers carry `kind` and `ratingCounts` on the question, as they carry its status today.
- `POST /api/admin/fiiu/questions` accepts `kind` (`chat` default, or `rating`); `PATCH` refuses a `kind` change.
- `GET /api/fiiu/questions?activityId=general` works like a block.
- All writes are same-origin and rate-limited like the existing routes.

## 9. Client files and loading

- `web/scripts/fiiu-admin.js`: the Programme section, the party announcement controls, the General entry in the conversation block picker, the question type choice and rating summaries.
- `web/scripts/fiiu.js`: the party in the programme and the registration form, the removed aside, block descriptions, the General link, start-only times.
- `web/scripts/fiiu-talk.js` and `fiiu-talk.css`: the General space, the rating scale, results and projector view.
- `web/scripts/fiiu-hubs.js`: the General link in the console block.
- `web/scripts/fiiu-ui.js`: shared strings (EN/ES/PT) and the start-only time formatting.
- Every changed asset gets a new `?v=` key on every page that loads it, with the `tests/deploy.test.js` pins updated.

## 10. Privacy, export and deletion

- `exportFiiuData` adds the person's own ratings (question text, score, date) and the notices sent to them.
- Account deletion: ratings and notices cascade; programme edits keep the edit and drop the editor's id.
- The privacy page (`scripts/build-privacy-page.js`, then `web/pages/privacy.html` regenerated) gains two lines in EN/ES/PT: rating scores are stored per person so they can be changed, and are only ever shown as anonymous totals; one-off festival notices are recorded so nobody gets the same one twice.
- `docs/implementation/fiiu-2026.md` documents the programme editor, the party, the announcement, General and ratings.

## 11. Testing

Test first for every rule; each new test is seen failing before the code that passes it.

- **Domain:** each programme field rule and refusal code; the time rules per kind; merging; the party is `social`, never in `CHECKIN_ACTIVITIES`, never counted in hours, valid alone in a registration, and the 6-block limit.
- **Programme API and effect:** a save shows on `/api/fiiu`, in the check-in window, in hours, in the email and in conversation views; the 30 s memo clears on a local write; 409 on an old version; restore; organisers only; same-origin.
- **Party notice:** eligibility; claim before send; no duplicate under two concurrent batches; the shared daily cap; reserved domains skipped; failed retry; content in three languages built from the merged programme.
- **General:** access for registered people and organisers, refusal for others; pulse; block page and projector.
- **Ratings:** create with kind; no kind change; one score per person, changeable; open only; counts and revision kept in the same transaction (the SQLite repository in unit tests; a test pins the Postgres trigger's statements, and a read-only query checks the trigger and RLS after the user applies the migration); results held back on screen until the person rates; anonymity (no route returns who rated what); rate limit.
- **UI harness tests** for the editor (conflict reload keeps typed fields, unsaved-leave guard, warnings), the scale (radiogroup semantics, optimistic save and rollback), the General link, the removed party aside, strings in three languages.
- **Browser pass** on the seeded local server at 375 and 1280 as organiser, registered participant, unregistered member and guest; no console errors, no sideways scroll, 44 px targets.
- **Whole-branch review** with adversarial verification, both builds (plain and Vercel-production), before reporting.

## 12. Release order

1. Round 3 (`feature/ui-round-3`) ships on its own as soon as the user approves: fast-forward `main`, the user pushes.
2. This branch is built in this order, so the most urgent parts are ready first: the party block and the programme editor; the party email; the General space; rating questions.
3. To release: the user applies the migration (`supabase db query --linked -f …`, then `supabase migration repair --status applied …`), **then** pushes the code. The code reads the new tables, so the migration must come first.
4. After the push: check the live cache keys, `/api/fiiu` shows the party, and the panel's Programme section loads.

## 13. Out of scope

- Adding or removing blocks from the panel.
- Per-language block texts.
- Capacity limits or a waiting list for the party; QR check-in for the party.
- Rating scales other than 1–10; per-person scores for organisers.
- Automatic emails when a block's details change.

## 14. Risks and checks

- **Editing during the festival:** a date or time change moves a check-in window and changes hours. Mitigated by the inline warnings, and by the change applying within 45 s rather than instantly everywhere (an organiser should edit before a block, not during it).
- **Instance memo:** two server instances can serve different programme versions for up to 30 s. Acceptable for display; check-in decisions use the instance's view, which is at most 30 s old.
- **Email volume:** the shared cap of 150 a day means a large registrant list takes several days to reach; the panel shows what is left today. If the list is large, start the announcement early.
- **Migration first:** the talk store selects `kind` and `rating_counts`; deploying the code before the migration breaks conversations. The release checklist and the migration header say so.
