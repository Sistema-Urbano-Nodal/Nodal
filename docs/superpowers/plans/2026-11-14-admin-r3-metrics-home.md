# Admin home with metrics (R3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the team one admin home, `/admin-home.html`, that shows the brief's five families plus festival and courses with definitions, downloads them as CSV, prints them, and saves one reading per Lima day.

**Architecture:** A new admin-only page reads one language-neutral answer from `GET /api/admin/metrics`, computed from six parts in parallel, each able to fail alone: two new SQL functions (one DEFINER for `auth.users`, one INVOKER), the festival panel's and the teaching workspace's own summaries, R1's visit totals, and a new `metrics_readings` table. One pure calendar module, one server catalogue in three languages, a SQLite twin, a 5-minute per-instance memo. The three tools are touched only by one more link in their staff bar.

**Tech Stack:** Node.js 22 `node:test`, SQLite (local) and Supabase PostgREST (production), vanilla JS under a strict CSP, no runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md` (approved 14 Nov 2026), sections "R3. The home", "Indicator catalogue", "Privacy and security", "Tests", "Release order". The Spanish sheet for Flavia and Mariana: `docs/metrics/indicadores-nodal.es.md`.

**This plan is R3 only.** It starts from a `main` that already holds R1 (`docs/superpowers/plans/2026-11-14-admin-r1-visit-counter.md`) and R2 (`docs/superpowers/plans/2026-11-14-admin-r2-staff-menu.md`). It consumes, under the spec's names:

- R1: `createVisitStore({db,env,clients,fetchImpl})` → `{kind, count(hit), totals(fromDay, toDay)}` in `server/visits-repository.js`; `totals` answers `{"v":1,"days":[[day, views, arrivals], …],"pages":{page: views},"sources":{source: arrivals}}` (`days` for the whole table, `pages` and `sources` for the range); `createApp({visitStore})`; `VISIT_PAGES` (pathname → page key, 14 distinct keys) and `VISIT_SOURCES` (the eleven) from `server/visits-api.js`; `web/scripts/visit.js` and its `data-staff` attribute; the migration `20261114000000_visit_counts.sql`; `tests/metrics-postgres.test.js` on `NODAL_METRICS_TEST_DATABASE_URL` / `nodal_metrics_test_ci`; `tests/visit-script.test.js`; the `readdir` assertion that `DEPLOYMENT.md` names the newest migration; and, from R1's Task 7, `docs/ops/2026-11-14-metrics-baseline.sql` with its test in `tests/metrics-ops.test.js` (the owner ran it at R1's release to fill the sheet; Task 1 here only confirms it).
- R2: `web/scripts/admin-nav.js`, `web/styles/admin-nav.css`, the `<nav class="staff-nav" data-staff-nav aria-label="Administration">` bar on `admin.html`, `fiiu-admin.html` and `teaching.html`, its label table (which already holds Indicadores / Metrics / Indicadores, painted by each element's `dataset.staff`, `home` included), and `tests/admin-nav.test.js` with its `STAFF_PAGES` map.

**Additions to the spec's answer, agreed and written back into the spec** ("Routes" and "States"). `GET /api/admin/metrics` carries more than the spec first listed, all of it defined in Task 7: per indicator an optional `state` (absent means ok), `last` and `daysSince` on `signups.new`, `team` on `festival.registrations`; at the top level `visitsSince` (the first counted Lima day, or `null`), `courseNames`, and `lead` and `tracked` (the catalogue's lead row and "Seguimiento" rows, as keys, so the page script holds no copy of them). The states gain a fourth text, `no_visits_yet`, printed in place of "Se cuenta desde el {day}" while the visit table is empty; the `state` value stays `not_yet_counted` (Task 3).

**Owner answers that gate tasks** (spec "Open questions"; question 5 is answered). Build on the default; the answer changes only the task named:

| Question | Default this plan builds on | Gates |
|---|---|---|
| 1. Retention | saved readings are kept without a time limit, no purge | Task 4 (no purge in the migration), Task 13 (the section 9 paragraph, in its Interfaces table and in the changed R1 test) |
| 2. Legal look | not waited for | nothing in R3; the policy stays a draft (Task 13) |
| 3. Vercel cost | inside the plan | Task 14 Step 7: confirm the function's maximum duration is at least 10 seconds |
| 4. The sheet (its questions 1, 2, 4, 5, 6) | the sheet's defaults: the names, lead row and families written below | Task 3 (`LEAD`, Spanish names, families), Task 4 if a new indicator needs SQL, and **the push in Task 14**: it waits for the answers or for the date the owner sets |
| 6. Will the report leave the team | yes | Task 13: "and may share them outside the team" is dropped if the answer is no; the small-group rule stays either way |
| 7. Team accounts that are not admin | none: only `app_role = 'admin'` is left out | Task 4 (the SQL's admin filter), Task 3 (the "sin el equipo" wording) |

## Global Constraints

- Line numbers below were checked on `82971df`, before R1 and R2. R1 adds a tag to every head, a `visit.js` key to each pin line of `tests/deploy.test.js`, a `DEPLOYMENT.md` section and privacy rows; R2 adds two tags and a bar to the three tools and changes the lists of `server/server.js`. Find each place by its quoted text and **add** to what R1 and R2 left, never replace it.
- Work on branch `admin-r3-metrics-home` cut from `main` after R1 and R2 are merged; commit per task; **never push** (the owner pushes after applying the migration).
- Zero runtime dependencies, no framework, no third-party script, CSP unchanged: no inline script or style, DOM built with `createElement`/`textContent`.
- The only gate is `profiles.app_role = 'admin'`. No GET changes state. Nothing a part throws reaches the global handler (`server/server.js:2437`).
- Lima is UTC−5 all year. Day bucket: Postgres `((ts AT TIME ZONE 'UTC') - interval '5 hours')::date`, SQLite `date(ts,'-5 hours')`. 7 days is Lima days `p_today − 6 … p_today`, 30 days is `p_today − 29 … p_today`, each starting at 05:00:00 UTC. Course dates are 24-character ISO text in both stores and are compared as strings, never cast.
- Each SQL function takes at most one argument and returns `jsonb` (never `RETURNS TABLE`); every object schema-qualified; `SET search_path = ''`.
- Small-group rule: fewer than 3 people. Reserved list keys `_other` and `_none`. It applies to festival country and festival profile type only.
- Part deadline 6 seconds; memo 5 minutes; a result with anything unavailable or not activated is kept 30 seconds and never saved; limits 60 a minute per account, 6 a minute for `fresh=1` and the POST.
- No percentage change anywhere. A zero prints as `0`; a figure that could not be computed prints as a dash with its reason, never `0` or `''`.
- Screen rules (M12): Montserrat with `tabular-nums`, right-aligned numbers; no cards; a hairline only under a table's header row; no left border of 3px or more; spacing on `--f-sp-*` (`web/styles/admin.css:26-32`); body text never smaller than the desk's; under 640px the tables stack.
- `web/scripts/i18n.js` is not edited (76,611 of 80,000 bytes). `admin-home.html` does not load `i18n-dashboard.js`, so its markup carries no `ops.*`, `d.*`, `p.*` or `y.*` key; `admin-home.js` holds its chrome strings as `[en, es, pt]` rows, defines no function named `t`, and no indicator key may equal a key of `i18n.js` or `i18n-dashboard.js`.
- Every changed CSS or JS file gets a new `?v=` on every page that loads it, with its pins. `V3` below means one value, `<YYYYMMDD>a` of the day Task 9 is done (R1 and R2 use `20261114a`: on that same day `V3` is `20261114b`).
- Must pass untouched: `tests/fiiu.test.js:336-358`, `tests/review-fix-3-courses.test.js:162`, `tests/course-perks.test.js:90-91`, `tests/fiiu-ui.test.js:939-946`, `tests/catalog-ui.test.js:1139` and `:1744-1763`, `tests/founders-desk-ui.test.js:114-115`, `tests/page-loading.test.js:36-44` and `:99-108`, and the final-survey tests. Not edited: `fiiu-admin.js`, `teaching.js`, `pilot.js`, `admin.js`.
- Tests never read the real clock (`now` is injected) and save, clear and restore every env variable they depend on: Vercel's build runs the whole suite with production env.
- Migration file name: `20261114010000_metrics.sql`, after R1's `20261114000000_visit_counts.sql`. If R1 shipped under another timestamp that sorts later, pick a later one and use it everywhere this plan writes `20261114010000`.

### Indicator keys (stable: the CSV `key` column, the `figures` map, the catalogue)

`part` is the part whose failure blanks the indicator. Fields: T total, 30, 7, L list (`items`).

| Family key (ES label) | Indicator key | Fields | Part | Read from |
|---|---|---|---|---|
| `visits` (Visitas) | `visits.views` · `visits.arrivals` | 30, 7 | visits | Σ of `days` |
| | `visits.topPages` · `visits.sources` | L | visits | `pages` (ten highest) · `sources` (n > 0), 30 days |
| `signups` (Registros) | `signups.accounts` · `signups.confirmed` | T | accounts | Σ created · Σ confirmed |
| | `signups.new` | 30, 7, plus `last` (day) and `daysSince` | accounts | created per day |
| | `signups.entered` | T, 30, 7 | members | `days.entered` |
| | `signups.team` | T | members | `now.admins` |
| `profiles` (Perfiles) | `profiles.basic` · `.city` · `.interests` · `.bio` · `.assessed` · `.directory` | T | members | `now.<same name>` |
| | `profiles.saved` | T | members | Σ `days.profileSaves` (SQLite: 0) |
| `activity` (Actividad) | `activity.members` | 30, 7 | members | `active.d30.members`, `active.d7.members` |
| | `activity.kinds` | L of `{key, n, d7}`, `n` = 30 days; keys `profile`, `network`, `opportunities`, `festival`, `courses`, `membership` | members | `active` |
| | `activity.follows` · `activity.interests` | T, 30, 7 | members | `days.follows` · `days.interests` |
| `memberships` (Membresías) | `memberships.founders` · `memberships.acceptances` | T, 30, 7 | members | `days.founders` · `days.acceptances` |
| | `memberships.acceptors` · `memberships.unbadged` | T | members | `now.acceptors` · `now.unbadged` |
| | `memberships.orgRequests` | T | members | Σ `days.orgRequests` |
| | `memberships.views` | L, keys `fundadores.html`, `payments.html` | visits | `pages`, 30 days |
| `festival` (Festival) | `festival.registrations` | T, plus `team` when members answered | festival | `totalRegistrations`; `team` = `now.teamRegistrations` |
| | `festival.blockRegistrations` · `festival.attendances` | T | festival | Σ `activities[].registrations` · Σ `activities[].attendance` |
| | `festival.attendedPeople` · `festival.qrPeople` | T | festival | the summary's optional counts |
| | `festival.hours` · `festival.labApplications` | T | festival | `festivalHours` · `lab.pending + accepted + declined` |
| | `festival.profileTypes` | L | festival | `profiles[]` |
| | `festival.countries` | L of `{text, n}` or `{key, n}` | members | `lists.countries` |
| `courses` (Cursos) | `courses.enrolled` · `.intakeCompleted` · `.moduleOpens` · `.contentOpens` · `.recordingOpens` · `.assignments` · `.comments` | T = Σ over courses, L of `{key: courseId, n}` | courses | `courseSummary` per course |
| | `courses.surveyTotal` · `.surveyAnswered` · `.certificates` | T | courses | `finalSurveyCounts` of the survey course |
| | `courses.learners` · `courses.openers` | T | members | `now.learners` · `now.openers` |

`figures` key rule: `<key>` for T, `<key>.d30`, `<key>.d7`; the kinds as `activity.kinds.<kind>.d30` and `.d7`. Saved: every T, 30 and 7 above whose part is not `visits`, and the twelve kind figures (63 integers; `festival.hours` is a whole number). Not saved: every other list, `visits.*`, `memberships.views`, `last`, `daysSince`, `team`.

## Review Focus

1. **Lima midnight between the GET and the POST.** The memo holds figures computed on day D; the POST arrives at 00:01 of D+1. It must not store D's figures under D+1: it recomputes, or answers `{saved:false}` (Task 8 `never saves one day's figures under the next day`).
2. **More than 1,000 saved readings** (three years of daily opens): the Data API cuts a table read at the row cap with no error, so `readings()` pages until an empty page (Task 6 `reads every reading past the row cap`).
3. **A reading saved before an indicator existed** (or under an older `DEFS`) has no value for a key the page now tracks: the cell is blank in "Seguimiento" and in the `readings` CSV, never `0` or `undefined` (Task 8 and Task 10 `a reading without a key leaves the cell blank`).
4. **A country typed with a combining accent, a non-breaking or a zero-width space** (`'Peru\u0301'`, `'Per\u00fa\u00a0'`, `'Peru\u200b'`) must fold into "Perú" (`'Per\u00fa'`), not fail the character check and inflate `_other` (Task 2 `folds Unicode spellings of one country together`).
5. **The language is changed while the first request is in flight,** or twice quickly after it: the page renders once in the current language, sends one GET and at most one POST (Task 10 `a language change during the first load neither repeats the request nor the reading`).

---

### Before Task 1: confirm the ground

- [ ] `git log --oneline -5` shows R1 and R2 on `main`; these exist: `server/visits-repository.js`, `web/scripts/visit.js`, `web/scripts/admin-nav.js`, `web/styles/admin-nav.css`, `tests/metrics-postgres.test.js`, `tests/admin-nav.test.js`, `tests/visit-script.test.js`. If one is missing, stop: this plan cannot start.
- [ ] Confirm three facts the tasks below use, as the R1 and R2 plans state them: `createApp({visitStore})`; `totals(fromDay, toDay)` takes no signal (Task 7 adds one); `admin-nav.js` paints every `[data-staff]` element by its `dataset.staff` key, `home` included (so the new link needs no script change). If the code differs, follow the code and say so in the task's commit.
- [ ] `ls supabase/migrations | tail -1` is R1's `20261114000000_visit_counts.sql`, which sorts before `20261114010000_metrics.sql`.

### Task 1: Confirm the baseline file from R1

The file and its test were written in R1 (its Task 7), from the spec's "Indicator catalogue" only and before any metrics function existed, and the owner ran it at R1's release to fill the sheet. The home is accepted against it (Task 14), so this task never rewrites its definitions from Task 4's SQL; whoever extends it must not have read that SQL.

**Files:**
- Confirm: `docs/ops/2026-11-14-metrics-baseline.sql`, `tests/metrics-ops.test.js` (both from R1)
- Modify, only if Step 2 finds a gap: the same two files

**Interfaces:**
- Consumes: R1's file as it is, one read-only SELECT of scalar subselects computing the Lima day itself, with these columns: `lima_day`, `accounts`, `confirmed`, `last_signup_day`, `accounts_by_month` (text, `2026-07:9, …`), `profiles`, `profiles_7d`, `profiles_30d`, `admins`, `with_city`, `interests_not_null`, `with_interests`, `basic_profile`, `with_bio`, `assessed`, `directory_visible`, `onboarding_rows`, `course_openers_non_admin`, `survey_n` (non-admin enrolments before `2026-10-01T00:00:00Z`), `active_7d`, `active_30d`, and per kind `active_<kind>_7d` / `active_<kind>_30d` for `profile`, `network`, `opportunities`, `festival`, `courses`, `membership`, and `countries` (text: `lower(btrim(country))` with its count, most frequent first). "Inscripciones a bloques" and "Horas de asistencia" are not here: they are read from the festival panel the same day.
- Produces: the test `the baseline is one read-only query that needs no migration`, to which Task 4 adds its tests in the same file.

- [ ] **Step 1: Run** `ls docs/ops/2026-11-14-metrics-baseline.sql && node --test tests/metrics-ops.test.js` — expected: the file is listed and the baseline test PASSES. If either file is missing (R1 shipped without its Task 7), do that task of the R1 plan here as written, Steps 1 to 5, before going on.
- [ ] **Step 2: Compare the columns** with the list above and with the sheet's answers (open question 4). Every column of the list is in the file; if an answer added an indicator that SQL can count, it needs a column, defined from the spec's catalogue wording. No gap: nothing to change, go to Step 5.
- [ ] **Step 3: Only for a gap, extend the test first:** add the missing column's name to the `for (const column of […])` list of the baseline test, run `node --test tests/metrics-ops.test.js` — expected: FAIL on that column. Then add the scalar subselect to the file, as one more `as <column>` of the same SELECT.
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** only if Step 3 changed the files — "Extend the baseline the admin home is accepted against"; otherwise note in the task report that R1's file was confirmed unchanged. An extended file is run again by the owner in Task 14, Step 6, as every baseline is.

### Task 2: Calendar and rules — `server/metrics-domain.js`

**Files:**
- Create: `server/metrics-domain.js`
- Test: `tests/metrics-domain.test.js`

**Interfaces:**
- Produces (pure, no clock of its own, no display word):
  - `LIMA_OFFSET_MS = 18000000`, `FIRST_MONTH = '2026-07'`, `SMALL_GROUP = 3`
  - `READING_PARTS = ['accounts','members','festival','courses','visits','readings']`
  - `limaDay(ms: number): string` (`'YYYY-MM-DD'`); `limaStamp(ms: number): string` (`'YYYY-MM-DD HH:MM'`)
  - `windowsFor(day: string): {d7:{from,to}, d30:{from,to}}`
  - `sumSeries(rows: Array<[string, number]>|null, day: string): {total, d30, d7, last: string|null, months: Record<string, number>}|null` — `months` holds every Lima month from `FIRST_MONTH` to `day`'s month, zeros included; `null` in gives `null` out
  - `foldCountries(rows: Array<[string, number]>): Array<{text: string, n: number}|{key: '_none'|'_other', n: number}>`
  - `smallGroups(items: Array<{key: string, n: number}>): Array<{key: string, n: number}>` — an empty or missing key is `_none`
  - `validPart(name: 'accounts'|'members'|'visits', value: unknown): boolean` — `v === 1` plus the required containers (`accounts`: array `days`; `members`: objects `days`, `now`, `active.d7`, `active.d30`, `lists`; `visits`: array `days`, objects `pages`, `sources`), extra keys ignored; a key missing inside a container leaves its indicator without a figure, never `0`
  - `figuresOf(indicators: Array<{key, state?, total?, d30?, d7?, items?}>): Record<string, number>` — the key rule above; it skips an indicator whose `state` is set, any key starting `visits.`, and `memberships.views`; of the lists only `activity.kinds` is saved
  - `readingComplete(states: Record<string, string>): boolean` — every part of `READING_PARTS` is `ok` (for `visits`, `not_yet_counted` also passes)

- [ ] **Step 1: Write the failing tests:**
  ```js
  test('a Lima day turns at 05:00:00 UTC', () => {
    assert.equal(limaDay(Date.parse('2026-11-14T04:59:59.999Z')), '2026-11-13');
    assert.equal(limaDay(Date.parse('2026-11-14T05:00:00.000Z')), '2026-11-14');
    assert.equal(limaStamp(Date.parse('2026-11-14T13:36:00Z')), '2026-11-14 08:36');
    assert.deepEqual(windowsFor('2026-11-14'), { d7: { from: '2026-11-08', to: '2026-11-14' }, d30: { from: '2026-10-16', to: '2026-11-14' } });
    assert.deepEqual(windowsFor('2026-03-01').d7.from, '2026-02-23');
  });
  test('sums a per-day series into windows and Lima months', () => {
    const s = sumSeries([['2026-07-31', 9], ['2026-09-30', 40], ['2026-10-16', 400], ['2026-10-26', 76]], '2026-11-14');
    assert.deepEqual([s.total, s.d30, s.d7, s.last], [525, 476, 0, '2026-10-26']);
    assert.deepEqual(s.months, { '2026-07': 9, '2026-08': 0, '2026-09': 40, '2026-10': 476, '2026-11': 0 });
    assert.equal(sumSeries([['2026-10-15', 1]], '2026-11-14').d30, 0, 'day 31 back is outside');
    assert.equal(sumSeries([['2026-11-15', 5]], '2026-11-14').total, 5, 'a later day still counts in the total, in no window');
  });
  test('a series that was not read stays missing, never zeros', () => { assert.equal(sumSeries(null, '2026-11-14'), null); });
  test('folds, labels and guards festival countries', () => {
    assert.deepEqual(foldCountries([['perú', 230], ['peru', 103], ['Perú', 2], ['lima', 8], ['Colombia', 7], ['méxico', 2], ['Mexico', 2],
      ['Chile', 2], ['x'.repeat(41), 5], ['Per1', 4], ['', 1]]),
      [{ text: 'Perú', n: 335 }, { text: 'Lima', n: 8 }, { text: 'Colombia', n: 7 }, { text: 'Mexico', n: 4 }, { key: '_other', n: 12 }]);
    assert.deepEqual(foldCountries([['', 3], ["Côte d'Ivoire", 3], ['St. Lucia', 3], ['Guinea-Bissau', 3]]).map(i => i.text ?? i.key),
      ["Côte d'Ivoire", 'Guinea-Bissau', 'St. Lucia', '_none']);
  });
  test('folds Unicode spellings of one country together', () => {
    // Written as escapes on purpose: a combining accent, a non-breaking space, a zero-width space. Never paste the characters themselves.
    assert.deepEqual(foldCountries([['Peru\u0301', 1], ['Per\u00fa\u00a0', 1], ['Peru\u200b', 1]]), [{ text: 'Per\u00fa', n: 3 }]);
  });
  test('groups small values, and a profile "other" of 3 or more stays apart from _other', () => {
    assert.deepEqual(smallGroups([{ key: 'professional', n: 82 }, { key: 'other', n: 34 }, { key: 'activist', n: 2 }, { key: '', n: 1 }]),
      [{ key: 'professional', n: 82 }, { key: 'other', n: 34 }, { key: '_other', n: 3 }]);
    assert.deepEqual(smallGroups([{ key: '', n: 3 }]), [{ key: '_none', n: 3 }]);
    assert.deepEqual(smallGroups([{ key: 'student', n: 1 }]), [{ key: '_other', n: 1 }], '_other may itself hold 1 or 2');
  });
  test('validates by version and required keys, ignoring extras', () => {
    assert.equal(validPart('accounts', { v: 1, days: [], later: true }), true);
    assert.equal(validPart('accounts', { v: 2, days: [] }), false);
    assert.equal(validPart('members', { v: 1, days: {}, now: {}, active: { d7: {} } }), false);
    assert.equal(validPart('visits', { v: 1, days: [], pages: {}, sources: {} }), true);
    assert.equal(validPart('visits', null), false);
  });
  test('builds the flat figures map and refuses a partial reading', () => {
    assert.deepEqual(figuresOf([{ key: 'signups.accounts', total: 525 }, { key: 'signups.entered', total: 486, d30: 2, d7: 0 },
      { key: 'activity.kinds', items: [{ key: 'profile', n: 4, d7: 1 }] }, { key: 'visits.views', d30: 9, d7: 1 },
      { key: 'memberships.views', items: [{ key: 'payments.html', n: 3 }] }, { key: 'festival.countries', items: [{ text: 'Perú', n: 335 }] },
      { key: 'festival.registrations', total: 375, team: 2 }, { key: 'signups.new', d30: 0, d7: 0, last: '2026-10-26', daysSince: 19 }]),
      { 'signups.accounts': 525, 'signups.entered': 486, 'signups.entered.d30': 2, 'signups.entered.d7': 0, 'activity.kinds.profile.d30': 4,
        'activity.kinds.profile.d7': 1, 'festival.registrations': 375, 'signups.new.d30': 0, 'signups.new.d7': 0 });
    const ok = Object.fromEntries(READING_PARTS.map(p => [p, 'ok']));
    assert.equal(readingComplete(ok), true);
    assert.equal(readingComplete({ ...ok, visits: 'not_yet_counted' }), true);
    for (const state of ['unavailable', 'not_activated']) assert.equal(readingComplete({ ...ok, courses: state }), false);
    assert.equal(readingComplete({ ...ok, members: undefined }), false);
  });
  ```
- [ ] **Step 2: Run** `node --test tests/metrics-domain.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Country folding, the only algorithm the tests do not fully determine:
  1. Clean each text: NFC, remove zero-width characters (`\u200B-\u200D` and `\uFEFF`, written as escapes in the source), turn every Unicode space into a plain space, trim. Empty → `_none`.
  2. Longer than 40 characters, or anything but letters (`\p{L}`), combining marks, spaces, hyphens, apostrophes and periods → `_other`.
  3. Group key: NFD, marks removed, lower-cased with the `es` locale. The label is the group's most frequent cleaned spelling (ties: first by `localeCompare(…, 'es')`), first letter upper-cased with the `es` locale.
  4. Small-group rule: a group or `_none` with fewer than 3 joins `_other`. Order: `n` descending, ties by label with `localeCompare(…, 'es')`, then `_none`, then `_other`.
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** — "Add the Lima calendar, the country folding and the small-group rule for the metrics".

### Task 3: The catalogue — `server/metrics-catalog.js`

**Files:**
- Create: `server/metrics-catalog.js`
- Test: `tests/metrics-catalog.test.js`

**Interfaces:**
- Produces:
  - `DEFS = 1` — bumped in the same commit as any change to what an existing key counts
  - `FAMILIES = ['visits','signups','profiles','activity','memberships','festival','courses']`
  - `INDICATORS: ReadonlyArray<{key: string, family: string, order: number, part: string, fields: Array<'total'|'d30'|'d7'|'items'>, vocabulary?: 'pages'|'sources'|'kinds'|'profileTypes'}>` — exactly the "Indicator keys" table
  - `LEAD = [['visits.arrivals','d30'], ['signups.accounts','total'], ['profiles.basic','total'], ['activity.members','d30'], ['memberships.founders','total']]`, and the sketch's second lines as `LEAD_SECOND = {'signups.accounts': [['signups.new','d7'], ['signups.confirmed','total']], 'profiles.basic': [['profiles.assessed','total']], 'activity.members': [['activity.members','d7']], 'memberships.founders': [['memberships.acceptances','total']]}` (`visits.arrivals` has none: its second line is the `not_yet_counted` text). Task 7 sends both to the page as the answer's `lead`
  - `TRACKED` (the rows of "Seguimiento", as `figures` keys, in order): `signups.accounts`, `signups.confirmed`, `signups.entered`, `profiles.basic`, `profiles.city`, `profiles.interests`, `profiles.bio`, `profiles.assessed`, `profiles.directory`, `profiles.saved`, `activity.members.d30`, `activity.members.d7`, `activity.follows`, `memberships.founders`, `memberships.acceptances`, `memberships.acceptors`, `festival.registrations`, `festival.attendedPeople`, `festival.attendances`, `courses.enrolled`, `courses.learners`, `courses.certificates`. Task 7 sends it to the page as the answer's `tracked`
  - `MONTH_SERIES = ['accounts','entered','registrations','views','arrivals']`
  - `TEXTS: {es, en, pt}`, each `{families: {[key]: label}, indicators: {[key]: {name, definition, source, caveat}}, lists: {pages, sources, kinds, profileTypes, reserved: {_other, _none}}, parts: {accounts, members, festival, courses, visits, readings} (one label per entry of `READING_PARTS`: a part is not a family, `members` feeds five of them), states: {not_activated, unavailable, not_yet_counted, no_visits_yet}, csv: {indicators: string[11], months: string[6], readings: string[3]}, series: {[MONTH_SERIES key]: label}}`

- [ ] **Step 1: Write the failing tests:**
  ```js
  test('every indicator has a name, a definition, a source and a caveat in three languages', () => {
    assert.equal(DEFS, 1); assert.equal(INDICATORS.length, 47);
    assert.equal(new Set(INDICATORS.map(i => i.key)).size, 47);
    const fieldsOf = Object.fromEntries(INDICATORS.map(i => [i.key, i.fields]));
    for (const [key, field] of [...LEAD, ...Object.values(LEAD_SECOND).flat()]) assert.ok(fieldsOf[key].includes(field), `lead ${key} ${field}`);
    for (const key of Object.keys(LEAD_SECOND)) assert.ok(LEAD.some(([lead]) => lead === key), key);
    for (const key of TRACKED) { const [, base, field = 'total'] = key.match(/^(.*?)(?:\.(d30|d7))?$/); assert.ok(fieldsOf[base].includes(field), `tracked ${key}`); }
    for (const lang of ['es', 'en', 'pt']) {
      assert.deepEqual(Object.keys(TEXTS[lang].families), FAMILIES);
      for (const { key, family } of INDICATORS) {
        assert.ok(FAMILIES.includes(family), key);
        for (const field of ['name', 'definition', 'source', 'caveat']) assert.ok(TEXTS[lang].indicators[key][field].trim(), `${lang} ${key} ${field}`);
      }
      assert.equal(TEXTS[lang].csv.indicators.length, 11);
    }
  });
  test('the names the sheet and the spec fix', () => {
    const es = TEXTS.es;
    assert.deepEqual(Object.values(es.families), ['Visitas', 'Registros', 'Perfiles', 'Actividad', 'Membresías', 'Festival', 'Cursos']);
    assert.equal(es.indicators['profiles.basic'].name, 'Perfil básico completo');
    assert.equal(es.indicators['profiles.saved'].name, 'Perfil guardado');
    assert.equal(es.indicators['memberships.acceptances'].name, 'Aceptaciones antes de pagar (veces)');
    assert.match(es.indicators['profiles.saved'].caveat, /Nunca una autoevaluación/i);
    assert.equal(es.lists.reserved._other, 'otros (menos de 3)');
    assert.notEqual(es.lists.profileTypes.other, es.lists.reserved._other);
    assert.match(es.lists.kinds.profile + ' ' + es.indicators['activity.kinds'].definition, /guardó su perfil o marcó avisos como leídos/);
    assert.deepEqual(es.states, { not_activated: 'Aún no está activado en la base de datos', unavailable: 'No disponible en este momento', not_yet_counted: 'Se cuenta desde el {day}', no_visits_yet: 'Aún no hay visitas contadas' });
    assert.deepEqual(es.parts, { accounts: 'cuentas', members: 'datos de miembros', festival: 'festival', courses: 'cursos', visits: 'visitas', readings: 'lecturas guardadas' });
    for (const lang of ['en', 'pt']) assert.deepEqual(Object.keys(TEXTS[lang].parts), READING_PARTS);
  });
  test('the vocabularies match their owners', () => {
    assert.deepEqual(Object.keys(TEXTS.en.lists.profileTypes), ['student','academic','researcher','professional','entrepreneur','activist','organization','public_official','other']);
    assert.deepEqual(Object.keys(TEXTS.en.lists.sources).sort(), ['direct','email','facebook','instagram','linkedin','other','qr','search','sistemaurbano','whatsapp','x']);
    assert.equal(Object.keys(TEXTS.en.lists.pages).length, 14);
  });
  test('the seven course totals carry the teaching workspace\'s own labels', () => {
    const pilot = readFileSync(new URL('../web/scripts/pilot-i18n.js', import.meta.url), 'utf8');
    for (const [key, row] of [['enrolled', 'participants'], ['intakeCompleted', 'intakeCompleted'], ['moduleOpens', 'moduleOpens'], ['contentOpens', 'contentOpens'], ['recordingOpens', 'recordingOpens'], ['assignments', 'assignments'], ['comments', 'comments']]) {
      const [en, es, pt] = JSON.parse(pilot.match(new RegExp(`\\b${row}:(\\[[^\\]]*\\])`))[1].replaceAll("'", '"'));
      assert.deepEqual(['en', 'es', 'pt'].map(l => TEXTS[l].indicators[`courses.${key}`].name), [en, es, pt], key);
    }
  });
  test('no indicator key is an interface dictionary key', () => {
    const dictionaries = ['i18n.js', 'i18n-dashboard.js'].map(f => readFileSync(new URL(`../web/scripts/${f}`, import.meta.url), 'utf8')).join('\n');
    for (const { key } of INDICATORS) assert.ok(!dictionaries.includes(`'${key}'`), key);
  });
  ```
- [ ] **Step 2: Run** `node --test tests/metrics-catalog.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Write the catalogue.** Spanish names, definitions, sources and "no dice" lines come from the spec's catalogue table and the sheet (`docs/metrics/indicadores-nodal.es.md:33-135`), one indicator per key of the table above; EN and PT in the desk's register. The page and source key lists come from `VISIT_PAGES` and `VISIT_SOURCES` (`server/visits-api.js`), not retyped. The six kind labels follow "What counts as activity (C2)". Course totals are labelled "con el equipo"; `signups.team`, `activity.follows` and `activity.interests` say the team is included; `festival.registrations` says team registrations are included, not filtered. The `visits.views` caveat carries the spec's sentence on staff browsers after a sign-in. `{day}` in `not_yet_counted` is filled by the caller with `visitsSince`; when `visitsSince` is `null` (an empty visit table) there is no day to print, and the home and the CSV use `no_visits_yet` instead (EN "No visits counted yet", PT "Ainda não há visitas contadas"): the `state` stays `not_yet_counted` either way. Part labels in EN: accounts, member data, festival, courses, visits, saved readings; in PT: contas, dados de membros, festival, cursos, visitas, leituras salvas.
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** — "Add the indicator catalogue in three languages".

### Task 4: The migration, its Postgres checks and its ops files

**Files:**
- Create: `supabase/migrations/20261114010000_metrics.sql`
- Create: `docs/ops/2026-11-14-metrics-check.sql`, `docs/ops/2026-11-14-metrics-reading-reset.sql`
- Create: `tests/fixtures/metrics-fixture.js`
- Modify: `tests/metrics-postgres.test.js` (R1's file), `tests/review-fix-4-grants.test.js` (where `stateFor` lives, `:14-23`), `tests/metrics-ops.test.js`, `DEPLOYMENT.md` (new section before `## Founder Membership acceptances`, `:269`; release step 2, `:582-584`), `scripts/smoke-supabase-data-api.js:38-41`

**Interfaces:**
- Produces (signatures verbatim from the spec):
  ```sql
  CREATE FUNCTION public.metrics_account_days() RETURNS jsonb
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ … $$;
  -- auth.users only. {"v":1,"days":[[lima_day, created, confirmed], …]}: counts per day, nothing else.
  CREATE FUNCTION public.metrics_member_days(p_today date) RETURNS jsonb
   LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ … $$;
  CREATE TABLE public.metrics_readings (day date PRIMARY KEY, taken_at timestamptz NOT NULL,
   defs smallint NOT NULL, figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'object'));
  ```
  `confirmed` counts by the day the account was created (so Σ confirmed is "Con correo confirmado").
- `metrics_member_days` answers `{"v":1,"days":{…},"now":{…},"active":{"d7":{…},"d30":{…}},"lists":{…}}` with exactly these keys (the parity test in Task 6 reads them from here):
  - `days` (each `[[lima_day, n], …]`): `entered` (`profiles.created_at`), `profileSaves` (`onboarding_responses.created_at`), `follows`, `interests` (not withdrawn), `registrations`, `acceptances` (`accepted_at`), `founders` (`founder_since`), `orgRequests`
  - `now`: `admins`, `basic`, `city`, `interests`, `bio`, `assessed`, `directory`, `acceptors`, `unbadged`, `interestsNew`, `orgRequestsNew`, `learners`, `openers`, `teamRegistrations`
  - `active.d7` and `active.d30`: `members`, `profile`, `network`, `opportunities`, `festival`, `courses`, `membership`
  - `lists`: `countries` (`[[trimmed text, n], …]`, the only free text that leaves the database)
- Order, the same in both stores because the results are compared with deep-equal: every `days` series ascending by day, one row per day that has a count; `lists.countries` by `n` descending, then by text in byte order (Postgres `COLLATE "C"`, SQLite's default `BINARY`).
- `tests/fixtures/metrics-fixture.js` exports:
  - `METRICS_TODAY = '2026-11-14'`
  - `metricsFixture`: plain rows keyed by the production table they stand for: `users` (`{key, role: 'admin'|'member', createdAt, confirmedAt, profile: {city, interests, bio, assessed, directory}, founderSince}`; one row feeds `auth.users` and `profiles`), then `onboarding_responses`, `pilot_feedback`, `member_follows`, `member_interactions`, `catalog_interests`, `fiiu_registrations`, `fiiu_attendance`, `fiiu_messages`, `fiiu_message_likes`, `fiiu_ratings`, `course_enrollments`, `course_events`, `course_posts`, `course_survey_responses`, `membership_acceptances` and `node_requests`. Each of those rows carries only what the metrics read: `user` (a `key` of `users`, or `null`), its instants as ISO strings under the column's name in camel case (`createdAt`, `updatedAt`, `acceptedAt`, `submittedAt`), and the field the SQL filters on (`action`, `type`, `method`, `organiser`, `staff`, `updatedBy`, `withdrawn`, `country`, `profileType`). Content: 2 admins and 6 members with dates either side of 05:00:00Z, one of each activity source of C2 inside 7 days, inside 30 and outside, one row of each "left out on purpose" kind, two acceptances by one person and one whose account is gone, five country spellings.
  - `expectedMemberDays`: the full object `metrics_member_days('2026-11-14')` returns on Postgres.
  - `sqliteProfile = {d7: {profile, members}, d30: {profile, members}}`: the four values the twin reports instead, because it reads the profile kind from `users.updated_at`. The twin's expected object is `expectedMemberDays` with `days.profileSaves` set to `[]` and these four values put over `active.d7` and `active.d30`.
  - `loadPostgres(sql)`: inserts the rows with plain `INSERT`s through the `sql(text)` runner `tests/metrics-postgres.test.js` already has (stub `auth.users` rows first). Used by Task 4.
  - `loadSqlite({db, fiiuStore, courseStore, nodeRequestStore})`: loads the same rows through the repository's and the stores' own functions (profile saves through `updateUserProfile`, never a bare `PATCH {}`), then sets the dates the functions do not take with direct `UPDATE`s. Used by Tasks 6 and 7.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/review-fix-4-grants.test.js`, `the metrics functions and the readings table are closed to the browser roles`:
    ```js
    for (const role of ['anon', 'authenticated']) {
      assert.equal(stateFor('function', 'public.metrics_account_days()', role), 'revoked');
      assert.equal(stateFor('function', 'public.metrics_member_days(date)', role), 'revoked');
      assert.equal(stateFor('table', 'public.metrics_readings', role), 'revoked');
    }
    assert.equal(stateFor('function', 'public.metrics_account_days()', 'service_role'), 'granted');
    assert.equal(stateFor('function', 'public.metrics_member_days(date)', 'service_role'), 'granted');
    assert.equal(stateFor('table', 'public.metrics_readings', 'service_role'), 'granted');
    ```
  - In `tests/metrics-ops.test.js`, `the metrics migration is one transaction, server-only and documented`: the header (text before `BEGIN;`) holds `npx --no-install supabase db query --linked -f supabase/migrations/20261114010000_metrics.sql`, `npx --no-install supabase migration repair --status applied 20261114010000`, ``Never `db push` ``, ``BEFORE pushing `main` ``, and says that until it is applied the home shows "Aún no está activado en la base de datos" in the affected blocks and saves no reading; the body starts `BEGIN;` and ends `COMMIT;`; on the body (the text from `BEGIN;` on) with `--` comments stripped, as the baseline test of the same file (from R1) strips them, `SECURITY DEFINER` appears exactly once and `/auth\.users/` appears only inside `metrics_account_days`, meaning between that function's `$$` markers; `GRANT SELECT, INSERT ON public.metrics_readings TO service_role` and no `UPDATE`, `DELETE` or `TRUNCATE` grant on it; no `GRANT` names `profiles`, `profile_preferences` or `onboarding_responses`; no `RETURNS TABLE`; each `CREATE FUNCTION` has at most one parameter.
  - Same file, `the check and reset files`: the check file is one `select` with no write keyword and names `has_table_privilege(proowner,'auth.users','SELECT')` and the known values `525`, `494`, `486`, `210`, `375` in its header's expected row; the reset file holds `delete from public.metrics_readings where day = '<day>' returning day, taken_at;` and no other statement.
  - Same file, `DEPLOYMENT.md applies the metrics migration before main`: a ``## Admin home and metrics: one migration before `main` `` section starts before `## Founder Membership acceptances`, holds both commands and `/api/admin/metrics`; R1's `readdir` assertion (newest migration named in release step 2) passes with the new file.
  - In `tests/metrics-postgres.test.js` (skipped without `NODAL_METRICS_TEST_DATABASE_URL`), after R1's setup has applied every migration: `service_role` can `select public.metrics_account_days()`; `anon` and `authenticated` get `permission denied` on both functions and on `metrics_readings`; `service_role` can INSERT and SELECT a reading and gets `permission denied` on UPDATE and DELETE; a second INSERT for the same `day` fails on the primary key; `metrics_account_days()` on three stub `auth.users` rows at `2026-11-14T04:59:59Z`, `05:00:00Z` (confirmed) and `05:00:01Z` answers `{"v":1,"days":[["2026-11-13",1,0],["2026-11-14",2,1]]}`; and `twin equality`: after `loadPostgres(sql)`, `select public.metrics_member_days('2026-11-14')` deep-equals `expectedMemberDays`.
- [ ] **Step 2: Run** `node --test tests/metrics-ops.test.js tests/review-fix-4-grants.test.js` — expected: the new tests FAIL (file missing).
- [ ] **Step 3: Write the migration.** Header in the house form (`supabase/migrations/20261109000000_node_request_kinds.sql:1-12`). One `BEGIN; … COMMIT;`; each object is created and closed in the same transaction: `REVOKE ALL … FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE … TO service_role` for both functions (as `supabase/migrations/20260929194059_fiiu_event_summary.sql:96-97`); for the table `ENABLE ROW LEVEL SECURITY`, no policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, `GRANT SELECT, INSERT … TO service_role`. Bodies follow the spec's catalogue and C2 list: the account's current role not admin for `active`, `learners` and `openers`; `catalog_interests.updated_at` only where `updated_by = user_id`; `fiiu_attendance` only with method `qr`; `fiiu_messages` only with `organiser` false; `course_posts` with `staff` false, deleted ones included; nothing from `fiiu_registrations.updated_at`, `profiles.updated_at`, `course_enrollments` or certificates. No purge of readings (open question 1).
- [ ] **Step 4: Write the ops files** (model `docs/ops/2026-11-09-node-request-kinds-check.sql`). The check file's one row: both functions with their security mode; closed to anon and authenticated; the owner of `metrics_account_days` and `has_table_privilege(proowner,'auth.users','SELECT')`; `has_table_privilege('service_role', <each table the INVOKER function reads>, 'SELECT')`; RLS on the readings table; the migration row; and the known values as raw counts: accounts 525, confirmed 494, profiles 486, admins 5, with a city 210, with a biography 17, assessed 33, onboarding rows 210, registrations 375, check-ins 90 by 62 people, enrolments 21 (3 by admins), submitted surveys 9, ready certificates 17, follows 14, acceptances 1, badges 0.
- [ ] **Step 5: Write the DEPLOYMENT.md section** (modelled on `:240-268`: what ships, the apply command, the check file, the repair command, what fails until applied) and change release step 2 to name `20261114010000_metrics.sql` under "Admin home and metrics". Add `'metrics_readings'` to the readable list of `scripts/smoke-supabase-data-api.js`.
- [ ] **Step 6: Run** `node --test tests/metrics-ops.test.js tests/review-fix-4-grants.test.js tests/node-requests-api.test.js tests/membership-fundadores.test.js tests/founder-badge.test.js` (the last three slice DEPLOYMENT.md) — expected: PASS. With a disposable database, also `NODAL_METRICS_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nodal_metrics_test_1 node --test tests/metrics-postgres.test.js` — expected: PASS, with the pass count pasted in the task report. Without a local PostgreSQL it reports the tests as skipped: say so in the task report. CI only runs them after a push, which comes after the production apply, so Task 14 Step 5 does not let the migration be applied until this file has passed on a real Postgres.
- [ ] **Step 7: Commit** — "Add the metrics functions, the readings table and their production checks".

### Task 5: Reuse the tools' own summaries (C5)

**Files:**
- Create: `server/fiiu-summary.js`
- Modify: `server/fiiu-api.js:293-296` (the summary route), `server/courses-api.js:76-92` and `:213-238` (`all`, `membersForRows`, `report`), `server/course-final-survey.js:200-207` and `:304-307` (`roster`, the status route)
- Test: `tests/metrics-summaries.test.js`

**Interfaces:**
- Produces:
  - `server/fiiu-summary.js`: `summaryCatalogue(event) → Array<activity>` (programme plus `LEGACY_FIIU_ACTIVITIES`, `registration: 'social'` re-tagged `'general'`); `festivalSummary({store, programme}) → Promise<{event, summary}>`; `festivalHours(summary, event) → number` (Σ `attendance` × `minutes` / 60 over check-in blocks, a block without minutes adding nothing; rounded half up to a whole number, as `server/fiiu-domain.js:74`)
  - `server/courses-api.js`: `COURSE_SUMMARY_KEYS = ['enrolled','intakeCompleted','moduleOpens','contentOpens','recordingOpens','assignments','comments']`; `courseSummary(store, courseId) → Promise<Record<key, number>>`
  - `server/course-final-survey.js`: `finalSurveyCounts({store, courseId, perks = createCoursePerks()}) → Promise<{total, answered, started, certificates}>`; module-level `allRows(store, name, filters = {}, max = Infinity)` and `membersForRows(store, rows)`, which `courses-api.js` imports and wraps in its existing closures (`all`, `membersForRows`), so `createFinalSurvey` keeps its parameters. `ALL_ROWS_MAX = 50_000` (`server/courses-api.js:19`) moves with `allRows` and is exported; `allRows` keeps the ceiling exactly as `all` has it today (`cap = Math.min(max, ALL_ROWS_MAX + 1)`, then `fail('course data exceeds supported size', 503)` past it, `fail` imported from `courses-domain.js`). `courses-api.js` imports the constant back; `course-final-survey.js` never imports from `courses-api.js` (that would be a cycle)
- Unchanged: `createCourseApi`'s parameter list (`perks` last), the keys of `report().summary`, the body of `GET /api/admin/fiiu/summary`.

- [ ] **Step 1: Write the failing tests** (festival setup as `tests/fiiu.test.js:329-336`, course fixture as `tests/review-fix-3-courses.test.js`):
  - `the festival summary the home reads is the panel's own`: `(await festivalSummary({store, programme})).summary` deep-equals the `summary` of `GET /api/admin/fiiu/summary`, and `summary.activities.find(a => a.activityId === 'closing-party')` exists after one registration ticks the party.
  - `festival hours follow the browser's rule`: for a summary with attendance 2 on `day1-am` (09:00–13:00, 240 minutes), 2 on a workshop and 1 on the laboratory, `festivalHours(summary, event) === 8`; a block whose time is edited to `null` adds 0. The rule matches `minutesOf` in `web/scripts/fiiu-ui.js:361-362`: only blocks where `isCheckinActivity` holds.
  - `the course summary is the report's own`: `await courseSummary(store, course.id)` deep-equals `report.summary` of `GET /api/admin/courses/:id/report`, and `Object.keys` of both equal `COURSE_SUMMARY_KEYS`.
  - `survey counts equal the status route`: on a fixture with one staff enrolment, one enrolment from `2026-10-02T00:00:00.000Z`, three September enrolments, one submitted response, one started and one ready certificate, `finalSurveyCounts({store, courseId})` deep-equals `{total: 3, answered: 1, started: 1, certificates: 1}` and equals the four fields of `GET /api/admin/courses/:id/final-survey`.
  - `the shared pager keeps its ceiling`: `ALL_ROWS_MAX === 50000`; with a fake store whose `find` answers full pages of new ids without end, `allRows(store, 'events', {})` rejects with `status === 503` and the message `course data exceeds supported size` after reading 50,001 rows, and `allRows(store, 'events', {}, 10)` resolves with 10 rows. No existing test covers this ceiling.
  - `only counts cross into the metrics module`: `JSON.stringify(await finalSurveyCounts(…))` holds no `@`, no participant name.
- [ ] **Step 2: Run** `node --test tests/metrics-summaries.test.js` — expected: FAIL (exports missing).
- [ ] **Step 3: Implement.** `server/fiiu-api.js:295` becomes `(await festivalSummary({store,programme})).summary`. `report()` calls `courseSummary` for its first seven counts and keeps its own feedback count and `truncated`. The status route (`course-final-survey.js:305`) calls `finalSurveyCounts` for its four numbers; `roster` and `finalSurveyCounts` share one module-level function for "September enrolments that are not administrators".
- [ ] **Step 4: Run** `node --test tests/metrics-summaries.test.js tests/fiiu.test.js tests/review-fix-3-courses.test.js tests/course-perks.test.js tests/course-final-survey.test.js tests/course-fiiu-survey.test.js tests/course-fiiu-report.test.js tests/courses-api.test.js` — expected: PASS, none of the existing files edited.
- [ ] **Step 5: Commit** — "Let the festival panel, the course report and the survey status share their summaries".

### Task 6: The metrics store and its SQLite twin

**Files:**
- Create: `server/metrics-repository.js`
- Test: `tests/metrics-store.test.js`
- Modify (only if Step 4 shows a request reaching it): `tests/supabase.test.js:144`

**Interfaces:**
- Consumes: Task 4's keys and fixture; `validPart` from Task 2.
- Produces: `createMetricsStore({db,env,clients,fetchImpl})` → `{kind, accountDays({signal}?), memberDays(today, {signal}?), saveReading(day, at, figures, defs), readings({signal}?)}`:
  - `accountDays()` → `{v:1, days:[[day, created, confirmed], …]}`; SQLite from `users.created_at`, confirmed = created
  - `memberDays(today: 'YYYY-MM-DD')` → the object of Task 4; SQLite hand-written, reporting 0 (or an empty series) for a table that is absent (`sqlite_master`), `days.profileSaves` always `[]`, the profile kind from `users.updated_at`
  - `saveReading(day, at: ISO string, figures: object, defs: number)` → `Promise<boolean>`: true when this call stored the row; first write wins (`Prefer: resolution=ignore-duplicates,return=representation`, precedent `server/supabase.js:741`; SQLite `INSERT OR IGNORE`)
  - `readings()` → `Promise<Array<{day, takenAt, defs, figures}>>`, oldest first
  - Each Supabase read throws what `rest` throws (the API maps it); a shape `validPart` refuses throws an error with `status: 502`.

- [ ] **Step 1: Write the failing tests:**
  - `the twin answers the fixture`: a `createDatabase({filename:':memory:'})` with the festival, course and node-request stores built first, loaded with the fixture's `loadSqlite({db, fiiuStore, courseStore, nodeRequestStore})`, then `store.memberDays(METRICS_TODAY)` deep-equals `expectedMemberDays` with `days.profileSaves` set to `[]` and the fixture's `sqliteProfile` values put over `active.d7` and `active.d30`; the order of every series and of `lists.countries` is Task 4's; `store.accountDays()` has `created === confirmed` on every row.
  - `an absent table counts as zero`: a database where only `createDatabase` ran (no festival or course store): `memberDays` resolves, `days.registrations` is `[]`, `now.learners === 0`, `active.d30.festival === 0`.
  - `key parity with the SQL`: every key this plan lists for `days`, `now`, `active.d7` and `lists` appears as a quoted JSON key in `supabase/migrations/20261114010000_metrics.sql`, and `Object.keys` of the twin's four objects equal those lists.
  - `asks Supabase for one function call each`: with a recording `fetchImpl`, `accountDays()` makes exactly one `POST …/rest/v1/rpc/metrics_account_days`, `memberDays('2026-11-14')` one `POST …/rpc/metrics_member_days` with body `{"p_today":"2026-11-14"}`, and neither makes a GET; a passed `signal` is the one `fetchImpl` receives.
  - `refuses an answer of the wrong shape`: `{v:2, days:[]}` → rejects with `status === 502`.
  - `the first reading of a day wins`: `saveReading('2026-11-14', at, {a:1}, 1)` → `true`; again with `{a:2}` → `false`; `readings()` → `[{day:'2026-11-14', takenAt: at, defs: 1, figures: {a:1}}]`. On Supabase the POST carries `Prefer: resolution=ignore-duplicates,return=representation` and an empty array answer means `false`.
  - `reads every reading past the row cap`: a fake PostgREST that returns at most 1,000 rows per request over 1,200 stored days: `readings()` returns 1,200 rows in day order (keyset on `day`, ending on an empty page, as `server/fiiu-repository.js:86-93`).
  - `passes provider errors through`: fakes answering `PGRST202`, `42883`, `PGRST205`, `42P01`, `42501`, a 503 and a 429 each reject with that `code` or `status` intact.
- [ ] **Step 2: Run** `node --test tests/metrics-store.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Implement** on the pattern of `server/node-requests-repository.js:43-46` (`db` → SQLite, else `clients ?? createSupabaseClients({env,fetchImpl})`). SQLite creates `metrics_readings (day TEXT PRIMARY KEY, taken_at TEXT NOT NULL, defs INTEGER NOT NULL, figures TEXT NOT NULL)` in the factory. Do not wrap `fetchImpl` with a timeout of its own: the caller's `signal` must reach `rest` (`server/supabase.js:179`).
- [ ] **Step 4: Run** `node --test tests/metrics-store.test.js tests/supabase.test.js` — expected: PASS. `tests/supabase.test.js` needs a branch for the two rpc paths only if it fails with `unexpected Supabase request` (`:144`).
- [ ] **Step 5: Commit** — "Read account and member days and keep daily readings, on Supabase and SQLite".

### Task 7: `GET /api/admin/metrics` — parts, states, memo

**Files:**
- Create: `server/metrics-api.js`
- Modify: `server/server.js` (`ID_ONLY_API` `:135` gains `admin\/metrics(?:\/.*)?`; a `metricsStore` and a `metricsOptions` option of `createApp` beside `:1134`; limiters and `createMetricsApi` beside `:1355`/`:1376`, with `report` wired to `reportAnswer` (`:1147`); dispatch beside `:1519`), `server/visits-repository.js` (`totals` gains an optional third parameter `{signal}`, passed to `rest`; R1's two-argument calls keep working)
- Test: `tests/metrics-api.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3 (`TEXTS`, `LEAD`, `LEAD_SECOND`, `TRACKED` among its exports), 5, 6; R1's `visitStore.totals(fromDay, toDay)`, extended here to `totals(fromDay, toDay, {signal} = {})`.
- Produces:
  - `createMetricsApi({store, visitStore, fiiuStore, fiiuProgramme, courseStore, sameOrigin, send, now = () => Date.now(), rateLimit = () => true, report = async (error, part) => false, deadlineMs = 6000, memoMs = 300000, partialMemoMs = 30000})` → `async ({req, res, url, user}) => boolean` (false for a path that is not `/api/admin/metrics` or under it)
  - `report(error: Error, part: string)`: called for a refused part and for an unexpected throw (Step 3). In `createApp` it is `report: error => reportAnswer({method: 'GET', url: '/api/admin/metrics'}, 503, error)`: the computation is shared by the memo, the export and the POST, so the report names the metrics route, not the request that happened to start it. Left at the default, production would send no report at all.
  - `rateLimit(req, res, user, kind: 'read'|'heavy')`; in `createApp`: `createWindowRateLimiter({windowMs:60000,limit:60})` and `({windowMs:60000,limit:6})`, per account
  - `createApp({…, metricsStore, metricsOptions})`: `metricsStore` defaults like `nodeRequestStore` (`server/server.js:1134`) and is built last, after the festival, course, node-request and visit stores; `metricsOptions` is spread into `createMetricsApi` (tests shorten `deadlineMs`)
  - Each list indicator in `families` also carries `vocabulary` (`'pages'|'sources'|'kinds'|'profileTypes'`, copied from `INDICATORS[].vocabulary`), so the page looks its item labels up in `texts[lang][vocabulary]` without holding its own mapping; the shape test asserts it on one list indicator of each vocabulary.
  - `GET /api/admin/metrics` → 200:
    ```js
    { asOf,                       // ISO instant of the computation
      limaDay, defs: DEFS,
      windows: { d7: {from, to}, d30: {from, to} },
      families: [{ key, indicators: [{ key, state?, total?, d30?, d7?, items?, last?, daysSince?, team? }] }],   // state absent means ok
      courseNames: { [courseId]: title },            // not in the spec's list: see Step 3
      texts: TEXTS,
      lead: [{ key, field: 'total'|'d30'|'d7', second: [[key, field], …] }],   // LEAD in order, each with its LEAD_SECOND pairs or []
      tracked: TRACKED,                              // the rows of "Seguimiento", as figures keys, in order
      months: { from: '2026-07', series: { accounts, entered, registrations, views, arrivals } },   // each {'YYYY-MM': n} or {state}
      readings: { today: boolean, months: [{ month, day, defs, figures }] },                    // each month's latest reading
      pending: { interests, orgRequests, lab },      // a number, or null when its part failed
      visitsSince: 'YYYY-MM-DD' | null,
      unavailable: [{ part, reason: 'timeout'|'error'|'refused' }], notActivated: [part] }
    ```
  - `texts`, `lead` and `tracked` are the catalogue's constants, not results: `computeAnswer` does not return them and the memo does not hold them. The GET attaches the three after the memo; the export and the POST never read `lead` or `tracked`, and neither is part of the saved `figures`.
  - A module-level `computeAnswer(deps, at)` is what the memo, the export and the POST of Task 8 share.

- [ ] **Step 1: Write the failing tests** through `createApp` on SQLite (harness as `tests/node-requests-api.test.js:28-37`: users `member` and `admin`, an injected clock at `2026-11-14T13:36:00.000Z`, `call(path, {actor, method, body, origin})`), with stub stores passed as `metricsStore`, `fiiuStore`, `courseStore` and the visit store where a test needs a failure:
  - `is for administrators`: guest → 401; member → 403 `{error:'administrator access required'}`; `POST /api/admin/metrics` → 405; a path such as `/api/admin/metricsx` → 404.
  - `answers the whole shape in three languages`: admin → 200; `limaDay === '2026-11-14'`; `defs === 1`; `windows` equals `windowsFor('2026-11-14')`; `families.map(f => f.key)` equals `FAMILIES`; every key of `INDICATORS` appears once; `Object.keys(texts)` is `['es','en','pt']`; `unavailable` and `notActivated` are `[]`; `Cache-Control` is `no-store`; and the catalogue's two lists travel with it:
    ```js
    assert.deepEqual(body.lead, LEAD.map(([key, field]) => ({ key, field, second: LEAD_SECOND[key] ?? [] })));
    assert.deepEqual(body.lead.map(l => l.key), ['visits.arrivals', 'signups.accounts', 'profiles.basic', 'activity.members', 'memberships.founders']);
    assert.deepEqual(body.lead[1], { key: 'signups.accounts', field: 'total', second: [['signups.new', 'd7'], ['signups.confirmed', 'total']] });
    assert.deepEqual(body.tracked, TRACKED);
    assert.equal(body.tracked.length, 22);
    ```
  - `the memoised data holds no display word`: with `texts` removed, `JSON.stringify(body)` matches none of `/Perfil|Cuentas|otros|Other|Outros|Visitas/` (`lead` and `tracked` stay in: they hold keys only); a typed country appears only as `{text, n}`.
  - `counts on seeded rows`: after the fixture's `loadSqlite(…)` on the app's database and stores, and two saved visit days, `signups.accounts.total`, `signups.entered.d30`, `activity.kinds` (six items with `n` and `d7`), `memberships.unbadged.total` and `festival.countries.items` equal the fixture's expected values; `Σ months.series.registrations` equals `festival.registrations.total`; `courses.enrolled.total − (staff enrolments in the fixture) === courses.learners.total`.
  - `agrees with the tools`: `festival.registrations.total`, `festival.attendedPeople.total` and `festival.attendances.total` equal the same figures of `GET /api/admin/fiiu/summary`; `courses.surveyTotal`, `courses.surveyAnswered` and `courses.certificates` equal `GET /api/admin/courses/:id/final-survey` for the survey course.
  - `memoises for five minutes and shares one computation`: two GETs 10 seconds apart call `store.memberDays` once; two concurrent GETs call it once; after the clock moves 5 minutes and 1 ms, twice; `?fresh=1` calls it again at once.
  - `limits`: the 61st GET inside a minute → 429 with `Retry-After`; the 7th `?fresh=1` → 429 while a plain GET still answers 200.
  - `each state` (one stub failing per case; the other blocks stay filled):
    | The stub | Expected |
    |---|---|
    | `memberDays` rejects with `code:'PGRST202'` (also `42883`, `PGRST205`, `42P01`) | `notActivated` equals `['members']`; every indicator whose part is `members` has `state:'not_activated'` and no `total`; `pending.interests === null` |
    | `accountDays` rejects with `status:503` (also 500, 429, `upstream:'TimeoutError'`) | `unavailable` equals `[{part:'accounts', reason:'error'}]`; `months.series.accounts` equals `{state:'unavailable'}` |
    | `accountDays` rejects with `code:'42501'` | reason `'refused'`; `report` called once across three fresh GETs |
    | `fiiuStore: null` (`server/server.js:1099-1100`) | `unavailable` holds `{part:'festival', reason:'error'}`; no throw |
    | the course store's `count` never resolves, `metricsOptions:{deadlineMs:50}` | 200 in under 1 second; `{part:'courses', reason:'timeout'}`; the timer is cleared (the test's server closes without a pending handle) |
    | the course store rejects with a bare `DOMException` named `TimeoutError` | `{part:'courses', reason:'timeout'}` |
    | a part throws `new Error('boom')` | 200, `reason:'error'`, `report` called once, the response body holds no `boom` |
    | the visit store answers `{v:1, days:[], pages:{}, sources:{}}` | `visitsSince === null`; `visits.views` has `state:'not_yet_counted'`, no `d30`, no `0`; `notActivated` and `unavailable` stay `[]` |
  - `a failed part reaches error reporting through the app`: `createApp` with `errorReport: {enabled: true, report: async (error, context) => { reports.push({message: error.message, ...context}); return true; }}` (as `tests/error-report.test.js:107`), no `report` in `metricsOptions`, and a `metricsStore` whose `memberDays` throws `new Error('boom')`: one GET → 200 and `reports` equals one entry with `message: 'boom'`, `route: '/api/admin/metrics'`, `status: 503`; with `memberDays` rejecting `{status: 503}` instead, `reports` stays empty.
  - `an indicator whose own source is missing does not blank its part`: with a course list that does not hold `FINAL_SURVEY.courseId`, and a festival summary without `attendedPeople` and `qrPeople` → `courses.surveyTotal`, `courses.surveyAnswered`, `courses.certificates`, `festival.attendedPeople` and `festival.qrPeople` each carry `state: 'unavailable'` and no `total`; `courses.enrolled` and `festival.registrations` are filled; `unavailable` and `notActivated` stay `[]`; a POST (Task 8) saves the reading, and its `figures` hold none of those five keys.
  - `a partial result is kept 30 seconds`: with `accountDays` failing once, a second GET 29 seconds later does not recompute; one 31 seconds later does and is complete.
  - `the visit read can be cut short`: `createVisitStore({clients})` with a recording `rest`: `totals('2026-10-16','2026-11-14',{signal})` hands that `signal` to `rest`; without the third argument the call is R1's own.
  - `visits are summed from the day series`: visit days `[['2026-10-20',10,4],['2026-11-10',5,2]]` → `visits.views` `{d30:15, d7:5}`, `visits.arrivals` `{d30:6, d7:2}`, `visitsSince === '2026-10-20'`, `months.series.views` equals `{'2026-10':10,'2026-11':5}`: a month before `visitsSince`'s month is absent, never `0`.
  - `no database, no API`: an app built with no database (`useDb` false, `server/server.js:1144`) → `GET /api/admin/metrics` 404.
  - `the readings table down`: `store.readings` rejecting → 200, `readings` equals `{today:false, months:[], state:'unavailable'}`, `unavailable` holds `{part:'readings', reason:'error'}`, every indicator still filled.
- [ ] **Step 2: Run** `node --test tests/metrics-api.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Decisions the tests do not show:
  - Six parts in `Promise.allSettled`. `accounts`, `members`, `readings` and `visits` get an `AbortController` signal aborted at `deadlineMs`; `festival` (two calls in a row) and `courses` are raced against a `setTimeout` cleared in `finally` (precedent `server/error-report.js:103-106`), measured by the timer firing, never by comparing `Date.now()` values.
  - `visits`: one call `visitStore.totals(d30.from, limaDay, {signal})`.
  - `courses`: `courseStore.find('courses', {}, {limit: 100})`, then `courseSummary` per course; `finalSurveyCounts` for `FINAL_SURVEY.courseId` only, when that course is in the list (the status route refuses any other course, `server/course-final-survey.js:264`). `courseNames` carries each course's stored title: with more than one course the page needs a name for each list row, and the spec's answer has no place for it.
  - Error mapping, in this order: code `PGRST202`, `42883`, `PGRST205` or `42P01` → `not_activated`; code `42501` → `unavailable`/`refused` plus one report per instance and part; the deadline or an error named `TimeoutError`/`AbortError` → `timeout`; status 5xx or 429, `upstream` set, a null store → `error`; anything else → `error` plus one report.
  - The memo is a promise memo copied from `server/fiiu-programme.js:29-39`; its lifetime is chosen when the promise settles (`memoMs` when complete, else `partialMemoMs`); `texts`, `lead` and `tracked` are attached after the memo, on the GET only. They are not put inside it because they never change between computations and a partial result must still carry them: built once at module level from `LEAD`, `LEAD_SECOND` and `TRACKED`, they are the same objects on every answer.
  - `pending.lab` is `summary.lab.pending`.
  - A part that answered but lacks one indicator's own source (no survey course in the list; the summary's optional `attendedPeople` or `qrPeople` absent, `server/fiiu-repository.js:110-111`; a key missing inside a container `validPart` accepted): that indicator alone carries `state: 'unavailable'` and no figure. The part stays `ok`, so nothing is added to `unavailable` or `notActivated`, no report is sent, the memo lasts its 5 minutes, `figuresOf` skips the indicator (it has a `state`) and the reading is still saved; the home and the CSV show it as any unavailable indicator, and "Seguimiento" leaves its cell blank (Review Focus 3).
- [ ] **Step 4: Run** `node --test tests/metrics-api.test.js tests/deploy.test.js tests/api.test.js` — expected: PASS.
- [ ] **Step 5: Commit** — "Answer the admin home's metrics from six parts that can fail alone".

### Task 8: CSV export and the daily reading

**Files:**
- Modify: `server/metrics-api.js`
- Test: `tests/metrics-api.test.js`

**Interfaces:**
- Consumes: `computeAnswer` and the memo of Task 7; `csv()` (`server/courses-domain.js:153`); `store.saveReading`, `store.readings`.
- Produces:
  - `GET /api/admin/metrics/export?table=indicators|months|readings&lang=es|en|pt` → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="nodal-indicadores-YYYY-MM-DD.csv"` (`nodal-indicadores-por-mes-YYYY-MM-DD.csv`, `nodal-indicadores-lecturas-YYYY-MM-DD.csv`), the date being `limaDay`
  - `POST /api/admin/metrics/readings` → 200 `{saved: boolean, day}`

- [ ] **Step 1: Write the failing tests:**
  - `the export is for administrators and needs both parameters`: 401, 403; missing or unknown `table` → 400; missing or unknown `lang` → 400; two `lang` values → 400; `POST` → 405.
  - `indicators CSV, byte for byte`: on the fixture, `lang=es`: the body starts with the byte order mark (`'\uFEFF'`, written as an escape), the header row equals `TEXTS.es.csv.indicators` (11 columns: key, state, family, indicator, total, 30 days, 7 days, definition, source, what it does not tell, read at (Lima)); the row for `signups.accounts` is `"signups.accounts","ok","Registros","Cuentas","<n>","","","<definition>","<source>","<caveat>","2026-11-14 08:36"`; a list item row has key `festival.countries#Perú` (a keyed item: `festival.profileTypes#student`), its label in the indicator column and `n` in the total column (`activity.kinds#profile`: `n` under 30 days, `d7` under 7 days); `lang=pt` changes headers and texts and leaves the `key` and `state` columns identical.
  - `a failed part is written in words`: with `memberDays` not activated, the `profiles.city` row has `state` `not_activated` and `Aún no está activado en la base de datos` in the total cell, never `""` or `"0"`; no `festival.countries#…` row exists; with `accounts` unavailable the `signups.new` row carries `No disponible en este momento` in both window cells; with an empty visit table (`visitsSince === null`) the `visits.views` row has `state` `not_yet_counted` and `Aún no hay visitas contadas` in both window cells, and with `visitsSince: '2026-11-17'` it has `Se cuenta desde el 17 nov 2026`.
  - `the formula guard holds`: a course titled `=HYPERLINK("x")` appears in its list rows as `"'=HYPERLINK(""x"")"`.
  - `months CSV`: one row per Lima month from `2026-07`, columns month then `MONTH_SERIES`; a failed series carries the state text in every cell and no `0`; a month before `visitsSince`'s month carries the `not_yet_counted` text (with the day) in `views` and `arrivals`; with no visit day at all every `views` and `arrivals` cell carries the `no_visits_yet` text.
  - `readings CSV`: one row per saved day: day, read at (Lima), defs, then one column per key of the catalogue's saved figures in catalogue order; `a reading without a key leaves the cell blank` (`""`, not `0`); with `store.readings` rejecting → 503 and no CSV body.
  - `saves the first complete reading of the day`: POST as admin with `Origin` → `{saved:true, day:'2026-11-14'}`; the stored row has `defs === 1`, `takenAt` the clock's instant and `figures` equal to `figuresOf` of the GET's indicators (63 keys on the fixture, none starting `visits.` or `memberships.views`, no list text); a second POST → `{saved:false, day:'2026-11-14'}` and the row is unchanged; the next GET has `readings.today === true`.
  - `ignores its body`: a POST with body `{"figures":{"signups.accounts":1}}`, and one with `Content-Type: text/plain` and body `x`, both answer 200 and store the server's own figures.
  - `refuses another origin and limits`: `Origin: https://evil.example` → 403, nothing stored; guest 401; member 403; the 7th POST in a minute → 429.
  - `never saves a partial answer`: with any part unavailable or not activated → `{saved:false, day}`; `store.saveReading` not called.
  - `uses the memo or the shared computation`: a POST right after a GET does not call `memberDays` again; a POST with no memo computes once, shared with a concurrent GET.
  - `never saves one day's figures under the next day`: GET at `2026-11-15T04:59:00Z`, then the clock moves to `05:00:30Z`; the POST answers `{saved:true, day:'2026-11-15'}` only after a new computation (`memberDays` called with `'2026-11-15'`).
- [ ] **Step 2: Run** `node --test tests/metrics-api.test.js` — expected: the new tests FAIL (404 on both routes).
- [ ] **Step 3: Implement.** The export joins the language-neutral answer with `TEXTS[lang]` and sends through `send()` with the two headers (`server/courses-api.js:239`). `readings` reads the table itself (`store.readings()`), not the memo's month view. The POST never reads the request body; after a successful save the memo is dropped. Neither route is added to `LOGGED_DOWNLOADS` (`server/server.js:388`).
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** — "Export the indicators as CSV and save one reading per Lima day".

### Task 9: The page shell and its registration

**Files:**
- Create: `web/pages/admin-home.html`, `web/scripts/admin-home.js` (a stub that looks up nothing yet), `web/styles/admin-home.css` (empty but for a comment)
- Modify: `server/server.js` (`PRIVATE_PAGES` `:67`, `STATIC_PAGES` `:68`, `STATIC_SCRIPTS` `:69`, `STATIC_STYLES` `:78`, the admin-only array `:1475`), `scripts/build-static.js` (`SERVER_PAGES` `:12`, `STATIC_SCRIPTS` `:13`, `STATIC_STYLES` `:49`), `vercel.json` (the script rule `:40`, the stylesheet rule `:48`, the no-store rule `:69`)
- Modify: `web/pages/admin.html`, `web/pages/fiiu-admin.html`, `web/pages/teaching.html` (one more link in each staff bar)
- Modify: `tests/deploy.test.js` (`:319` page list and key map, `:641` gate regex), `tests/visit-script.test.js` (R1: the `data-staff` page list), `tests/admin-nav.test.js` (R2: `STAFF_PAGES` gains `'admin-home.html': 'home'`, the expected bar gains the link, and the script-order test learns the home's next script)
- Test: `tests/admin-home-page.test.js`

**Interfaces:**
- Consumes: R2's bar markup; R1's `visit.js` tag.
- Produces: `<a href="admin-home.html" data-staff="home">Metrics</a>` as the first link of every staff bar; the ids `admin-home.js` looks up in Task 10: `homeMain`, `homeTitle`, `homeAsOf`, `homeRefresh`, `homeWindows`, `homeStatus` (`role="status"`), `homeRetry`, `homeSignIn`, `homeCsv`, `homePrint`, `homeLead`, `homePending`, `homeBlocks`, `homeTracking`, `homeReadingsCsv`, `homePrintHead`.

- [ ] **Step 1: Write the failing tests:**
  - `the page is the desk's frame with the home's assets`: `<body class="admin-page" data-page="admin-home">`; the `<header class="navbar">…</header>` block equals `admin.html`'s byte for byte; the element after it is the staff bar and the element after that is `<main class="admin-shell" id="homeMain">`; stylesheets in order `locale.css`, `fonts.css`, `styles.css`, `admin.css`, `admin-home.css`, `admin-nav.css`; `locale.js` not deferred; deferred scripts in order `nav.js`, `script.js`, `admin-nav.js`, `admin-home.js`, `i18n.js`, `visit.js`, the last tag carrying `data-staff`; no `i18n-dashboard.js`; no `data-i18n` value starting `ops.`, `d.`, `p.` or `y.`; `<meta name="robots" content="noindex, nofollow" />`; every id listed above exists exactly once.
  - `the staff bar on the home marks Metrics as current`: the bar's first link is `<a href="admin-home.html" data-staff="home" aria-current="page">Metrics</a>`, followed by R2's three links, the sign-out button and the status span; no `<li>`, no `data-i18n`, no id inside it.
  - In `tests/admin-nav.test.js`: on `admin.html`, `fiiu-admin.html`, `teaching.html` and `admin-home.html` the bar has four links in the order `home`, `desk`, `festival`, `courses`, identical on the four pages but for `aria-current`, and still the element just before `<main>`; with the real `i18n.js` and `apply('es')` the first link reads `Indicadores`, with `'en'` `Metrics`, with `'pt'` `Indicadores`; `fiiu-qr.html` still has no bar.
  - Same file, R2's test `each staff page loads admin-nav.js deferred before the dictionaries and admin-nav.css last` loops over every key of `STAFF_PAGES`, so it now reads the home too. Its `next` becomes `name === 'admin.html' ? 'i18n-dashboard.js' : name === 'admin-home.html' ? 'admin-home.js' : 'i18n.js'` (the home's script paints before `i18n.js`, like the bar's); its `admin-nav.js` before `i18n.js` assertion and its `admin-nav.css` last assertion stay as they are and hold for the home. Without this change Step 4 cannot pass.
  - `the home is gated like the desk` (through `createApp` on SQLite): signed out, `GET /admin-home.html` → 302 to `/login.html?next=%2Fadmin-home.html`; a member → 403 `{error:'administrator access required'}`; an admin → 200 with `Cache-Control: no-store`.
  - In `tests/deploy.test.js`: `admin-home.html` joins the page list (`:319`) with `'admin-home.css': 'V3'`, `'admin-home.js': 'V3'` and, for every other asset it loads (`styles.css`, `admin.css`, `admin-nav.js`, `admin-nav.css`, `i18n.js`, `visit.js`, `locale.css`, `locale.js`, `nav.js`, `script.js`), the value the `admin.html` entry carries on that day; the gate regex (`:641`) becomes `\['\/admin\.html','\/teaching\.html','\/fiiu-admin\.html','\/fiiu-qr\.html','\/admin-home\.html'\]\.includes\(canonical\)`; a registration test modelled on `:603-613` for `['admin-home.js','STATIC_SCRIPTS','/admin.js']` and `['admin-home.css','STATIC_STYLES','/admin.css']`; `/admin-home.html` matches the no-store, noindex rule.
- [ ] **Step 2: Run** `node --test tests/admin-home-page.test.js tests/deploy.test.js` — expected: the new tests FAIL (page missing).
- [ ] **Step 3: Write the page and register it.** The skip link, `<title>` and `<h1 id="homeTitle">` carry English text and no `data-i18n` (Task 10 paints them). `#homePrintHead` holds the print-only heading; `#homeRetry` and `#homeSignIn` are `hidden`. The admin-only array becomes `['/admin.html','/teaching.html','/fiiu-admin.html','/fiiu-qr.html','/admin-home.html']`. Add the `home` link as the first link of the bar on the three tools, so the bar is identical on four pages from this commit on; `admin-nav.js` already paints `home`, so it is not edited and its `?v=` does not move. Add `admin-home.html` to R1's `data-staff` list in `tests/visit-script.test.js`.
- [ ] **Step 4: Run** `node --test tests/admin-home-page.test.js tests/admin-nav.test.js tests/deploy.test.js tests/page-loading.test.js tests/page-csp.test.js tests/i18n-split.test.js tests/visit-script.test.js tests/build-static.test.js tests/fiiu-ui.test.js tests/catalog-ui.test.js tests/founders-desk-ui.test.js tests/course-participants-ui.test.js` — expected: PASS (the public header, the desk's tab list and sign-out, and the teaching banner pins untouched).
- [ ] **Step 5: Commit** — "Add the admin home page behind the administrator gate, with its link in every staff menu".

### Task 10: The home's script and stylesheet

**Files:**
- Modify: `web/scripts/admin-home.js`, `web/styles/admin-home.css`
- Test: `tests/admin-home-ui.test.js`

**Interfaces:**
- Consumes: Task 7's answer, Task 8's two routes, Task 9's ids, `window.nodalI18n?.onChange`. The lead row and the rows of "Seguimiento" are read from the answer's `lead` and `tracked`: `LEAD` and `TRACKED` live in `server/metrics-catalog.js`, which the browser never loads, and the script holds no copy of either list.
- Produces: nothing other tasks call. Behaviour, in order: paint the chrome from `document.documentElement.lang` at evaluation; `GET /api/admin/metrics` once; render; then `POST /api/admin/metrics/readings` only if the answer is complete (`unavailable` and `notActivated` empty) and `readings.today` is false; when that POST answers `{saved: true, day}` with `day` equal to the held answer's `limaDay`, add today's reading to the held answer and re-render "Seguimiento", with no second GET (Step 3); subscribe to language changes inside a `DOMContentLoaded` listener, once.

Chrome rows (`[en, es, pt]`), the only strings the script owns; every other word comes from `texts`:

| Row | EN | ES | PT |
|---|---|---|---|
| `title` | NODAL metrics | Indicadores de NODAL | Indicadores da NODAL |
| `skip` | Skip to content | Saltar al contenido | Pular para o conteúdo |
| `csv` | Download CSV | Descargar CSV | Baixar CSV |
| `print` | Print or save as PDF | Imprimir o guardar como PDF | Imprimir ou salvar como PDF |
| `asOf` | Data as of {when} (Lima time) | Datos al {when} (hora de Lima) | Dados de {when} (hora de Lima) |
| `refresh` | Refresh | Actualizar | Atualizar |
| `last7` / `last30` | Last 7 days: {range} / Last 30 days: {range} | Últimos 7 días: {range} / Últimos 30 días: {range} | Últimos 7 dias: {range} / Últimos 30 dias: {range} |
| `noNew` | {n} days without new accounts (last: {day}) | {n} días sin cuentas nuevas (última: {day}) | {n} dias sem contas novas (última: {day}) |
| `pending` | To attend to | Por atender | Para atender |
| `howCounted` | How it is counted | Cómo se cuenta | Como se conta |
| `notTell` | It does not tell | No dice | Não diz |
| `tracking` | Tracking | Seguimiento | Acompanhamento |
| `readOn` | read on the {day} | leído el {day} | lido em {day} |
| `olderDefs` | read with earlier definitions | leído con definiciones anteriores | lido com definições anteriores |
| `readingsSince` | Readings since {month}. | Lecturas desde {month}. | Leituras desde {month}. |
| `noReadings` | No reading has been saved yet. | Aún no hay lecturas guardadas. | Ainda não há leituras salvas. |
| `readingsCsv` | Download readings CSV | Descargar lecturas CSV | Baixar leituras CSV |
| `notSaved` | Today's reading has not been saved yet: {part} not available. It will be saved when this page is opened with all the data. | La lectura de hoy aún no se guardó: {part} no disponible. Se guardará al abrir esta página con todos los datos. | A leitura de hoje ainda não foi salva: {part} não disponível. Será salva ao abrir esta página com todos os dados. |
| `failed` | The metrics could not be loaded. | No se pudieron cargar los indicadores. | Não foi possível carregar os indicadores. |
| `retry` | Try again | Reintentar | Tentar de novo |
| `expired` | Your session ended. Sign in again. | Tu sesión terminó. Inicia sesión de nuevo. | Sua sessão terminou. Entre de novo. |
| `tooMany` | Too many requests. Wait a minute and try again. | Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo. | Muitas solicitações. Espere um minuto e tente de novo. |
| `notHere` | Metrics are not available in this installation. | Los indicadores no están disponibles en esta instalación. | Os indicadores não estão disponíveis nesta instalação. |
| `printHead` | NODAL · Metrics report | NODAL · Reporte de indicadores | NODAL · Relatório de indicadores |
| `seeFestival` / `seeCourses` | See in Festival / See in Courses | Ver en Festival / Ver en Cursos | Ver em Festival / Ver em Cursos |
| `total` / `d30` / `d7` | Total / 30 days / 7 days | Total / 30 días / 7 días | Total / 30 dias / 7 dias |

- [ ] **Step 1: Write the failing tests** (the page's ids as `FakeNode`s in a vm context, the fake pattern of `tests/founders-desk-ui.test.js:15-48`; the real `i18n.js` run after the script in the same context, as `tests/catalog-ui.test.js:160-173`; `fetch` a recording stub answering a fixture answer the test builds from `TEXTS`, `LEAD`, `LEAD_SECOND` and `TRACKED`, imported from `server/metrics-catalog.js` and shaped as Task 7's `texts`, `lead` and `tracked`):
  - `renders the five lead numbers and every block in the page language` for `es`, `en`, `pt`: `#homeLead` holds five groups in the order of the answer's `lead`, each with the number of its `key` and `field`, `texts[lang].indicators[key].name`, and under it one line per pair of its `second` (for `signups.accounts`: the 7-day figure of `signups.new` and the total of `signups.confirmed`, each with its name); `#homeBlocks` has one block per family in the order of `FAMILIES`, each with a `details` whose summary is the `howCounted` row and whose body holds every indicator's definition, source and caveat; `#homeAsOf` reads `Datos al 14 nov 2026, 08:36 (hora de Lima)` in `es`; `#homeWindows` holds `8–14 nov`, `16 oct–14 nov` and `19 días sin cuentas nuevas (última: 26 oct)`.
  - `a zero is 0 and a failure is a dash with its reason`: an indicator with `total: 0` renders `0` with the muted class; one with `state:'unavailable'` renders `—` followed by `No disponible en este momento`; one with `state:'not_activated'` shows `Aún no está activado en la base de datos` once for its block; `visits.views` with `state:'not_yet_counted'` and `visitsSince: null` shows no digit at all and the visits block is headed `Aún no hay visitas contadas` (`states.no_visits_yet`), never `Se cuenta desde el` with an empty day; with `visitsSince: '2026-11-17'` the visits block is headed `Se cuenta desde el 17 nov 2026`.
  - `the lead row and the tracking rows come from the answer`: the same fixture with `lead` reversed and cut to three entries and `tracked` set to `['courses.enrolled', 'signups.accounts']` → `#homeLead` holds those three groups in that order and "Seguimiento" those two rows in that order; with `lead: []` and `tracked: []` both are empty and nothing throws. In the source, `admin-home.js` holds neither `'profiles.basic'` (a key only the lead row needs) nor `'memberships.acceptors'` (one only "Seguimiento" needs).
  - `lists are labelled after the fact`: `{key:'_other', n:1}` renders `otros (menos de 3)`; `{key:'other', n:34}` renders the festival's own `otro`; `{text:'Perú', n:335}` renders as text (a `{text:'<b>x</b>'}` item appears literally, no element created).
  - `a language change re-renders without a request`: after the first render, fire the captured `DOMContentLoaded` listener, call `nodalI18n.apply('pt')`: labels are Portuguese, the numbers identical, and `fetch` was called for the GET and the POST only.
  - `a language change during the first load neither repeats the request nor the reading`: `apply('en')` then `apply('pt')` before the GET resolves → one GET, one render in `pt`, one POST.
  - `the reading is sent only when today has none and the answer is complete`: `readings.today: true` → no POST; `unavailable: [{part:'courses', reason:'timeout'}]` → no POST and `#homeTracking` holds the `notSaved` row with `{part}` filled from `texts[lang].parts` (`cursos`); `notActivated: ['members']` → `datos de miembros`; `accounts` unavailable and `members` not activated together → `cuentas, datos de miembros` (every failed part, in the order of `READING_PARTS`, joined with a comma); complete and `today: false` → one `POST /api/admin/metrics/readings` with `credentials: 'same-origin'` and no body; a rejected POST shows nothing and is not retried in this page view.
  - `a saved reading appears in Seguimiento at once`: a complete answer with `readings: {today: false, months: []}` and the POST answering `{saved: true, day: '2026-11-14'}` → `#homeTracking` has one column headed `nov 2026` with `leído el 14`, each row of the answer's `tracked` holding the figure the blocks show (`signups.accounts` the total, `activity.members.d30` the 30-day value), and `fetch` was called twice (the GET, the POST); a later language change keeps the column. The POST answering `{saved: false, day}`, rejecting, or answering a `day` other than the held `limaDay` → no column is added; with no reading at all `#homeTracking` holds the `noReadings` row, and the per-month series still render. With `readings.months` holding an earlier November day, the saved reading replaces that column (a month shows its latest reading).
  - `tracking shows one column per month that has a reading`: `readings.months` of `[{month:'2026-11', day:'2026-11-14', defs:1, figures}, {month:'2026-12', day:'2026-12-02', defs:2, figures}]` → two columns headed with the month and the `readOn` row; rows in the order of the answer's `tracked`; the November column carries the `olderDefs` footnote when `defs` is below the answer's `defs`; `a reading without a key leaves the cell blank`; the per-month series render back to July 2026 with a series in `{state}` shown as a dash, not zeros.
  - `the whole answer failed`: `fetch` rejecting, answering 500, answering non-JSON, 429, 503 → `#homeStatus` holds the `failed` row (the `tooMany` row for 429), `#homeRetry` is shown and disabled while a request is in flight, and a click sends the plain GET (no `fresh=1`); 401 → the `expired` row and `#homeSignIn` shown with `href` `login.html?next=%2Fadmin-home.html`; 404 → the `notHere` row and no retry.
  - `Refresh asks for fresh figures`: a click on `#homeRefresh` requests `/api/admin/metrics?fresh=1`, disables the control until it settles, and a 429 there leaves the old figures on screen under the `tooMany` row.
  - `the CSV is fetched as a blob and failures are said on the page`: a click on `#homeCsv` requests `/api/admin/metrics/export?table=indicators&lang=es` (the page language); a 200 creates an object URL and clicks a temporary `<a download="nodal-indicadores-2026-11-14.csv">` (the name from `Content-Disposition`); 401 shows the `expired` row, 429 the `tooMany` row, and no link is clicked; `#homeReadingsCsv` asks for `table=readings`.
  - `printing opens every definition and closes them again`: the captured `beforeprint` listener sets `open` on every `details`, `afterprint` restores each to what it was (one opened by hand stays open); `#homePrint` calls `window.print()`.
  - Source rules: `admin-home.js` has no `t(` call, no `'ops.`, `'d.`, `'p.` or `'y.` literal, no `innerHTML`; `admin-home.css` has no `border-left` of 3px or more, no `box-shadow`, no `border-radius` on a block, no `font-family` other than inheriting, contains `font-variant-numeric: tabular-nums`, an `@media (max-width: 640px)` block and an `@media print` block that hides `.navbar`, `.staff-nav`, the buttons and `#homePending` and shows `#homePrintHead`.
- [ ] **Step 2: Run** `node --test tests/admin-home-ui.test.js` — expected: FAIL (the stub renders nothing).
- [ ] **Step 3: Implement.** Dates are formatted with `Intl.DateTimeFormat(lang, {timeZone: 'America/Lima', …})` from `asOf`, `limaDay` and `windows`; numbers with `Intl.NumberFormat(lang)`. The answer is kept in one variable and every language change re-renders from it. After `{saved: true, day}` with `day === limaDay`, the script pushes `{month: day.slice(0, 7), day, defs, figures}` into the held `readings.months` (replacing that month's entry if there is one) and sets `readings.today = true`; `figures` holds the keys of the answer's `tracked` only, read from the held indicators by the key rule (`<key>` is `total`, `<key>.d30`, `<key>.d7`), skipping an indicator with a `state`. The POST's answer stays `{saved, day}` as the spec has it. An empty "Seguimiento" shows the `notSaved` row when the answer is partial and the `noReadings` row otherwise. "Por atender" links: `admin.html#interests`, `admin.html#nodes`, `fiiu-admin.html`. "Ver en Festival" and "Ver en Cursos" link to `fiiu-admin.html` and `teaching.html`. With several courses, each course list row is labelled from `courseNames`. "Por mes" is plain text (`jul 9 · ago 0 · …`). Layout per the spec's sketch and Global Constraints; where the layout leaves a choice, follow `web/styles/admin.css` and keep whitespace before rules.
- [ ] **Step 4: Run** `node --test tests/admin-home-ui.test.js tests/admin-home-page.test.js tests/deploy.test.js tests/i18n-split.test.js tests/page-csp.test.js` — expected: PASS (`tests/deploy.test.js:381-410` now checks every id the script looks up).
- [ ] **Step 5: Commit** — "Render the admin home: lead numbers, blocks, tracking, CSV and print".

### Task 11: The front door — `/admin` and the console link

**Files:**
- Modify: `server/server.js` (`ADMIN_ALIASES` beside `:73`; one line beside `:1490`), `web/pages/dashboard.html:72-74`, `web/scripts/i18n-dashboard.js` (`:733`, `:1612`, `:2491`), `web/pages/admin.html`, `web/pages/payments.html`, `web/pages/profile.html` (the `i18n-dashboard.js` tag, with `dashboard.html`), `README.md:124-132`
- Modify: `tests/dashboard-publishing.test.js:110-126`, `tests/deploy.test.js` (`:327`, `:330`, `:331`, `:332`), `tests/founders-desk-ui.test.js:134`
- Test: `tests/admin-home-page.test.js`

**Interfaces:**
- Produces: `ADMIN_ALIASES = new Set(['/admin'])`; the console link `<a class="side-link" href="admin-home.html" id="publishLink" hidden>` with `d.nav.publish` = `Admin` / `Administración` / `Administração`.

- [ ] **Step 1: Write the failing tests:**
  - `/admin opens the home` (through `createApp`): for `/admin`, `/admin/` and `/ADMIN`, GET and HEAD as an admin → 302 with `Location: /admin-home.html`; signed out, `/admin` → 302 to `/admin-home.html`, and following it → 302 to `/login.html?next=%2Fadmin-home.html`; `POST /admin` is not redirected; `/admin.html`, `/admin.html#nodes` and `/admin.html#founders` still serve the desk.
  - In `tests/dashboard-publishing.test.js`: the link regex (`:115`) expects `href="admin-home\.html" id="publishLink" hidden` and `<span data-i18n="d\.nav\.publish">Admin<\/span>`; the labels (`:122`) become `en: ['Admin', 'NODAL news'], es: ['Administración', 'Noticias NODAL'], pt: ['Administração', 'Notícias NODAL']`.
  - Pins: `i18n-dashboard.js` is `V3` on dashboard, payments, profile and admin (`tests/deploy.test.js:327`, `:330`, `:331`, `:332`; `tests/founders-desk-ui.test.js:134`).
- [ ] **Step 2: Run** `node --test tests/admin-home-page.test.js tests/dashboard-publishing.test.js tests/deploy.test.js tests/founders-desk-ui.test.js` — expected: the changed assertions FAIL.
- [ ] **Step 3: Implement.** The alias line: GET or HEAD whose path, lower-cased and without trailing slashes, is in `ADMIN_ALIASES` → `redirect(res, '/admin-home.html')`, placed where `/admin` reaches it before any 404. The side link keeps `id="publishLink"`, its icon and its key; only `href`, the markup's English text and the three values change. Bump `i18n-dashboard.js` to `V3` on its four pages. In `README.md:124-132` the console's link is "Admin" and opens the admin home, whose menu leads to the desk.
- [ ] **Step 4: Run** the same command plus `node --test tests/catalog-ui.test.js tests/page-loading.test.js tests/membership-terms-page.test.js tests/i18n-split.test.js tests/dashboard-console-ui.test.js` — expected: PASS.
- [ ] **Step 5: Commit** — "Open the admin home from /admin and from the console".

### Task 12: Local preview data (M13)

**Files:**
- Modify: `scripts/seed-dev.js`
- Test: `tests/seed-safety.test.js`

**Interfaces:**
- Consumes: `createFiiuStore({db})`, `createCourseStore({db})`, R1's `createVisitStore({db})`, `createMetricsStore({db})`, `recordMembershipAcceptance`, `grantFounder` (`server/db.js:897`, `:919`).

- [ ] **Step 1: Write the failing test** `the dev seed gives every block of the admin home something to show`: run the seed against a temporary `DATABASE_PATH` with `SEED_ADMIN_PASSWORD` set (the file's existing child-process pattern), then with the stores on that file: `memberDays(today)` has `days.registrations`, `days.acceptances` and `days.founders` non-empty, `now.bio > 0`, `now.learners > 0`, `active.d30.members > 0`; `accountDays().days.length >= 3` (back-dated accounts); `visitStore.totals(...)` has at least 5 days; a second run adds nothing (idempotent); with `NODE_ENV=production` it still refuses.
- [ ] **Step 2: Run** `node --test tests/seed-safety.test.js` — expected: the new test FAILS.
- [ ] **Step 3: Implement:** festival registrations with five country spellings (one group under 3) and two profile types, check-ins with method `qr`, one course with enrolments (one by the admin) and course events, one acceptance, one Founder badge, bios, visit rows for the last 10 days, and some accounts back-dated by direct `UPDATE users SET created_at = …` (`createUser`, `server/db.js:424`, takes no date).
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** — "Seed festival, course, membership and visit rows for the local admin home".

### Task 13: Privacy text and docs

**Files:**
- Modify: `docs/privacy/privacy-policy.en.md`, `privacy-policy.es.md`, `privacy-policy.pt-BR.md`, `web/pages/privacy.html` (generated), `scripts/build-privacy-page.js` (`:9`, `:20`, `:31`: the date), `docs/privacy/implementation-review.md` (`:19`, section 1), `docs/architecture.md` (`:22` the test count, `:36` the limits table, `:108`), `README.md` (`:167`, `:234-246`: the home and its three routes), `docs/course-pilot-operations.md:7`, `docs/implementation/fiiu-2026.md` (a new dated entry)
- Test: `tests/privacy-page.test.js`

**Interfaces:**
- Consumes: R1's policy text and R1's test `visit counting is described in every language: what is stored, what is not, the staff marker and how long totals are kept` (R1 plan, Task 5, Step 1) in `tests/privacy-page.test.js`. Three of the sentences that test pins are rewritten here, and its check that no article speaks of saved totals or reports is now false by design, so **that test must change in this task**, in the same commit as the text.
- Produces: the R3 wording of the spec's "Policy text", "With R3". Where it goes in sections 3 and 9 (each replaces R1's sentence in place; found by its text, since R1 moved the line numbers):

| Where | EN | ES | PT |
|---|---|---|---|
| Section 3, the sentence directly after "must be validated before adopting this draft." (R1: "Visit counts are part of that usage analysis.") | Visit counts and reports of totals are part of that usage analysis. | Los conteos de visitas y los reportes de totales forman parte de ese análisis de uso. | As contagens de visitas e os relatórios de totais fazem parte dessa análise de uso. |
| Section 9, first paragraph, the list (R1: "usage events, daily visit totals, logs"): "and saved daily totals" goes directly after "daily visit totals", whose comma moves behind it | usage events, daily visit totals and saved daily totals, logs, | eventos de uso, totales diarios de visitas y totales diarios guardados, registros técnicos, | eventos de uso, totais diários de visitas e totais diários salvos, logs, |
| Section 9, R1's own paragraph after the `**{{RETENCAO}}**` paragraph (R1: "Daily visit totals contain no personal data and are kept without a time limit."): the new words go directly after its subject — **open question 1** | Daily visit totals and the totals the team saves at most once a day to compare months contain no personal data and are kept without a time limit. | Los totales diarios de visitas y los totales que el equipo guarda como máximo una vez al día para comparar meses no contienen datos personales y se conservan sin límite de tiempo. | Os totais diários de visitas e os totais que a equipe salva no máximo uma vez por dia para comparar meses não contêm dados pessoais e são mantidos sem limite de tempo. |

  The list edit sits after "unaccepted invitations," so the phrase pinned at `tests/privacy-page.test.js:256` stays contiguous. Sections 2, 4 and 8 keep every R1 sentence; this task only adds to sections 2 and 4.

- [ ] **Step 1: Write the failing tests.** First change R1's test `visit counting is described in every language…`: its section 2 and section 8 assertions stay; its section 3 and section 9 assertions are replaced by the block below; and its last assertion, that no section of any article mentions readings or reports of totals (EN `/saved daily totals|reports of totals/` absent), is **deleted**. With that test's `articles`/`section`/`escape` helpers:
  ```js
  const visitsR3 = {
    en: ['Visit counts and reports of totals are part of that usage analysis.', 'usage events, daily visit totals and saved daily totals, logs',
      'Daily visit totals and the totals the team saves at most once a day to compare months contain no personal data and are kept without a time limit.',
      'Visit counts are part of that usage analysis.', 'Daily visit totals contain no personal data'],
    es: ['Los conteos de visitas y los reportes de totales forman parte de ese análisis de uso.', 'eventos de uso, totales diarios de visitas y totales diarios guardados, registros técnicos',
      'Los totales diarios de visitas y los totales que el equipo guarda como máximo una vez al día para comparar meses no contienen datos personales y se conservan sin límite de tiempo.',
      'Los conteos de visitas forman parte de ese análisis de uso.', 'Los totales diarios de visitas no contienen datos personales'],
    pt: ['As contagens de visitas e os relatórios de totais fazem parte dessa análise de uso.', 'eventos de uso, totais diários de visitas e totais diários salvos, logs',
      'Os totais diários de visitas e os totais que a equipe salva no máximo uma vez por dia para comparar meses não contêm dados pessoais e são mantidos sem limite de tempo.',
      'As contagens de visitas fazem parte dessa análise de uso.', 'Os totais diários de visitas não contêm dados pessoais'],
  };
  for (const [lang, [analysis, list, kept, oldAnalysis, oldKept]] of Object.entries(visitsR3)) {
    assert.ok(section(lang, 3).includes(escape(analysis)), `${lang}: section 3`);
    assert.ok(section(lang, 9).includes(escape(list)), `${lang}: the section 9 list`);
    assert.ok(section(lang, 9).includes(`<p>${escape(kept)}</p>`), `${lang}: the section 9 paragraph, in its own <p>`);
    assert.ok(!articles[lang].includes(oldAnalysis) && !articles[lang].includes(oldKept), `${lang}: R1's two sentences were replaced, not kept beside the new ones`);
  }
  ```
  Then add the new test `the policy covers reports of totals in three languages`: in the English policy (and the same sentences, translated sentence for sentence, in `es` and `pt-BR`):
  - section 2, the "Usage and connections" row (`:32`) ends with: "We also count, as totals only, the records described in this table (accounts, profiles and self-assessment, festival registrations, check-ins and conversations, courses, surveys and certificates, feedback, interest requests, Founder Membership acceptances and badges, and organisation requests) to see how the network is used; section 4 says who sees those totals."
  - the festival row (`:21`), after "Only you and administrators can access these answers": "Totals by country and attendee profile may appear in reports, as section 4 describes."
  - the organisation-requests row (`:31`), after its "used only" sentence: "We also count how many requests arrive; that count contains none of the details you wrote."
  - section 4 has the bullet: "Reports of totals: the team prepares reports made only of totals (accounts per month, festival registrations by country and attendee profile, visits per page) and may share them outside the team. They contain no names, emails or individual answers. Where a report lists people by an answer they gave (country, attendee profile), answers given by fewer than three people are shown together as “other”. Other figures are plain counts and can be small, including one or two."
  - sections 3 and 9 are covered by the changed R1 test above, with the strings of the Interfaces table; this test does not repeat them.
  - Still true: 12 sections per language, the draft banner, every phrase `tests/privacy-page.test.js` already pins (`:256` among them) contiguous, `web/pages/privacy.html` equal to the generator's output, no bold, link or `|` inside a table row.
- [ ] **Step 2: Run** `node --test tests/privacy-page.test.js` — expected: the changed R1 test and the new test FAIL; the rest pass.
- [ ] **Step 3: Edit** the three policies (sections 3 and 9 exactly as the Interfaces table, in all three files), set the three dates in `scripts/build-privacy-page.js`, run `node scripts/build-privacy-page.js`, and update the review and the docs: `docs/architecture.md` names the home, the six parts, the memo and the per-account limits (60 and 6 a minute); `README.md` lists `GET /api/admin/metrics`, `GET /api/admin/metrics/export` and `POST /api/admin/metrics/readings`; `docs/course-pilot-operations.md:7` says the workspace is also reached from the admin menu. The index page's form notice (`web/pages/index.html:538`) is left as it is.
- [ ] **Step 4: Run** `node --test tests/privacy-page.test.js tests/page-csp.test.js` — expected: PASS.
- [ ] **Step 5: Commit** — "Say in the privacy policy and the docs what the admin home counts and who sees it".

### Task 14: Release (no code)

- [ ] **Step 1: The whole suite and lint, twice.** `npm run lint && npm test` — expected: 0 failures. Then with Vercel-like env: `env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://example.org EMAIL_SMTP_URL=smtps://u:p@smtp.example.invalid:465 EMAIL_FROM="FIIU Fest 11 <fest@example.invalid>" npm run build` — expected: lint clean, 0 failures, static build written. A red run with 0 test failures is the audit or lint step.
- [ ] **Step 2: Local preview on 127.0.0.1** (a `.claude/launch.json` entry on a scratch SQLite file, seeded with `SEED_ADMIN_PASSWORD=… npm run seed:dev`; restart the preview after any server edit). In `es`, `en` and `pt`, at desktop width and at 375px:
  - `/admin` → the home; signed out → sign-in and back; a member → the plain 403.
  - Five lead numbers, seven blocks, "Por atender", "Seguimiento" with one column after the first load (added from the POST's answer, without a second GET); a reload sends no second POST (network panel). The three survey rows of Cursos show a dash unless the seeded course is the survey course: that is Task 7's missing-source case, not a fault.
  - `innerWidth` equals the viewport at 375px (no side pan); tables stack; no card, shadow or left bar.
  - Both CSV buttons download; the file opens with accents intact; print preview starts with "NODAL · Reporte de indicadores", shows every definition and hides the header, the bar and the buttons.
  - The four menu items work from all four pages; the desk's tabs, the festival panel's sticky rows and the teaching header look as before.
  - The console's side link reads "Administración" for the admin and is absent for a member.
- [ ] **Step 3: Whole-branch review** against the spec's "Anti-goals" and this plan's Review Focus.
- [ ] **Step 4: Hold for the sheet.** Do not hand over for the push until the owner has the answers to sheet questions 1, 2, 4, 5 and 6, or says the date he set has passed (open question 4). An answer that renames or moves an indicator changes `TEXTS`, `LEAD` or `FAMILIES` in Task 3 before the first reading is saved; one that adds an indicator may change Task 4's file, which is still unapplied.
- [ ] **Step 5: The SQL on a real Postgres, before production sees it.** `tests/metrics-postgres.test.js` is the only place the two functions run, and the twin equality and DEFINER grant checks live there; Vercel's build skips it, and CI (`.github/workflows/ci.yml:3-9`) runs only after a push. After Step 4 (an answer may have changed the migration), one of these, with its result pasted in the hand-over:
  - locally: `createdb nodal_metrics_test_r3 && NODAL_METRICS_TEST_DATABASE_URL=postgresql://127.0.0.1/nodal_metrics_test_r3 node --test tests/metrics-postgres.test.js` — expected: PASS, 0 skipped (then `dropdb nodal_metrics_test_r3`); or
  - with no local PostgreSQL: the owner pushes the branch as `release-validation-admin-r3` (a push CI runs on, and not `main`, so nothing deploys to production) and the CI run is green.
  Do not go on to Step 6 on a skipped run.
- [ ] **Step 6: The owner applies the migration, before the push.** From the repository root, in this order:
  ```bash
  npx --no-install supabase db query --linked -f supabase/migrations/20261114010000_metrics.sql
  npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-check.sql
  npx --no-install supabase migration repair --status applied 20261114010000
  npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-baseline.sql
  ```
  The last command is the baseline of R1 (its Task 7), run again: R1's reading filled the sheet, this one is the acceptance reading of Step 8 and must be of the same Lima day as the first open of the home. Expected: the check row shows one DEFINER and one INVOKER function, both closed to anon and authenticated, `true` for the owner's read of `auth.users`, RLS on, and the known values; any movement from 525 / 494 / 486 / 210 / 375 is explained before going on. Never `supabase db push`. The code live before the push does not call the new objects, so applying first is safe.
- [ ] **Step 7: The owner pushes `main`.** Then check that the Vercel Production deployment status is `success`, not only that the page answers 200, and that the function's maximum duration in the project settings is at least 10 seconds.
- [ ] **Step 8: Acceptance in production, the same Lima day as the baseline.** Open `/admin` as an administrator: every figure SQL can count equals the baseline row; "Inscripciones a bloques" and "Horas de asistencia" equal the festival panel; festival and course totals equal their tools. Opening the home saved that day's reading: if a definition has to be fixed, the owner runs `docs/ops/2026-11-14-metrics-reading-reset.sql` with the day filled in, the fix ships with `DEFS` bumped, and the next complete open saves the first accepted reading.
- [ ] **Step 9: Afterwards.** Replace each `n` in the spec's catalogue with the baseline's values. The sheet's "por confirmar" and "por calcular" were filled at R1's release (R1 plan, Task 9, step 5): correct there any value this baseline shows has moved, with its new day; tell Flavia and Mariana the address (`/admin`) only once acceptance holds.
