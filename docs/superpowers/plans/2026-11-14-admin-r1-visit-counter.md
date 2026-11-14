# Admin front door R1: visit counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From its first day in production, count every page view and arrival on NODAL's public and member pages as daily totals, with no cookie, address or visitor id stored, and publish the privacy text that says so.

**Architecture:** A same-origin script (`web/scripts/visit.js`) posts `{p,r,v}` to a sessionless route (`POST /api/visit`, `server/visits-api.js`), which reduces the hit to a page key and one of eleven sources and makes one atomic upsert through `server/visits-repository.js` (Supabase function `count_visit`, SQLite twin). One hand-applied migration creates the table and two INVOKER functions. R1 has no screen: the owner reads totals with a check file until R3.

**Tech Stack:** Node.js `node:test`, SQLite (local) and Supabase PostgREST rpc (production), PostgreSQL 15 in CI (`psql`), vanilla JS under a strict CSP, Markdown policies built by `scripts/build-privacy-page.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md` (approved 14 Nov 2026), sections "R1. Visit counter", "Privacy and security", "Tests", "Release order", "Ops files". This plan covers R1 only; R2 (staff menu) and R3 (home) have their own plans.

**Owner answers that gate this plan** (spec "Open questions"; each task below is planned on the spec's default):

| Question | Default planned on | Gates |
|---|---|---|
| 1. Retention: visit totals "kept without a time limit"? | Yes: no period, no purge | Task 5 (the section 9 sentence) and the push (Task 9). A period adds a purge task and changes the published text |
| 2. Does R1 wait for a legal look at cookie-free counting (Peru, Brazil)? | No: D3 says ship first | Task 9, step 4 (the push) only. Step 2 collects the answer before step 3 too, so the migration is not applied ahead of it |
| 3. Is one function call per page view inside the Vercel plan? | Yes | Task 9, step 4 (the push) only; collected in step 2, as above |
| 4. The sheet: by what date must Flavia and Mariana answer? | The owner sets the date on the day R1 ships | Task 9, step 5 only (the sheet goes out with that reply-by date). It does not gate the push |
| 6, 7 (reports leaving the team, non-admin team accounts) | — | Nothing in R1 |

**Also in this plan, though it is not part of the counter:** `docs/ops/2026-11-14-metrics-baseline.sql` and its test (Task 7). The spec ("Indicator catalogue", "Ops files", "Proposed dates") has the owner run it before the indicator sheet goes out, the same day as R1, and the R3 plan (`2026-11-14-admin-r3-metrics-home.md`) only starts once R1 and R2 are on `main`. The file needs no migration and does not gate the push: the owner runs it in Task 9, step 5, fills `docs/metrics/indicadores-nodal.es.md` and sends the sheet. R3's Task 1 then only confirms the file, and R3 is accepted against it.

## Global Constraints

- Work on branch `admin-r1-visit-counter` cut from `main`; commit per task; **never push** and never run the supabase CLI (the owner applies the migration, then pushes: Task 9).
- Zero runtime dependencies, no third-party script, strict CSP (no inline script or style).
- Migration file: `supabase/migrations/20261114000000_visit_counts.sql`. Applied by hand before the push with `npx --no-install supabase db query --linked -f …`, then `supabase migration repair --status applied 20261114000000`. Never `db push`.
- Cache key for the new script: `visit.js?v=20261114a` on all 19 pages. No other asset changes, so no other key moves.
- The script goes in the head, `defer`, never `async`, last script of the head; it is listed in `server/server.js:69` (`STATIC_SCRIPTS`), `scripts/build-static.js:13` and `vercel.json:40`.
- Stored per hit: a Lima day, a page key (file name) and one of eleven sources. Never: a cookie, the client address, a visitor or account id, a raw referrer host, a query string or fragment.
- Page keys (14), from the exact pathname as sent, no decoding or folding: `/` and `/index.html` → `index.html`; `/login.html`, `/fundadores.html`, `/opportunities.html`, `/community.html`, `/resources.html`, `/knowledge.html`, `/fiiu.html`, `/fiiu-session.html`, `/dashboard.html`, `/profile.html`, `/payments.html`, `/courses.html`, `/course.html` → their file name. `/fiiu-talk.html` is not a key.
- Sources (11): `direct`, `search`, `whatsapp`, `email`, `linkedin`, `instagram`, `facebook`, `x`, `qr`, `sistemaurbano`, `other`. Valid `via` values (7): `whatsapp`, `email`, `linkedin`, `instagram`, `facebook`, `x`, `qr`, after trimming and lower-casing.
- Limits: 600 a minute per client address (429); request body 1024 bytes; store call 2 seconds (one value, `VISIT_WRITE_MS`, applied twice on purpose: Task 1's abort signal frees the socket, Task 3's timer bounds the answer); 60-second pause after a store failure; per-instance ceiling 1,200 accepted writes a minute (builder's value, "well above real traffic"). The route never answers 5xx.
- Lima is UTC−5 all year: the server computes the day (`limaDayStart(ms).slice(0,10)`, `server/node-requests-api.js:22`).
- Supabase and SQLite return the same shapes. Tests never read the real clock for a day boundary, save and restore any env they rely on, and pass under Vercel's build env (lint plus the whole suite run on every deploy; Postgres suites are skipped there).
- The privacy policy stays a draft with exactly 12 sections; no bold, link or `|` inside a table row; every pinned phrase stays contiguous; `web/pages/privacy.html` equals the generator's output.

## Review Focus

1. **Browser storage blocked** (Safari private mode, site data refused): `localStorage` throws. The script must not throw; a public page still counts, a staff page still sends nothing (Task 4 `a browser that refuses storage neither breaks nor miscounts`).
2. **In-app browsers and link previewers**: Instagram, Facebook and LinkedIn in-app browsers are people and count; `facebookexternalhit`, `WhatsApp/2.x` previewers, crawlers and an empty User-Agent do not (Task 3 `counts in-app browsers and ignores previewers and crawlers`).
3. **A hand-made or odd `r`** (`'<script>'`, 300 characters, a number, `android-app://` hosts, upper case): the stored source is always one of the eleven, never the text sent (Task 3 `whatever r holds, only a fixed source is stored`).
4. **The Lima day boundary**: a hit at `04:59:59Z` belongs to the previous Lima day, one at `05:00:00Z` to the new one (Task 3 `a hit is counted on its Lima day`).
5. **A referrer the browser cannot parse, or `via` typed with capitals, spaces or 500 characters**: the hit still counts; `' WhatsApp '` is `whatsapp`, an overlong `via` is absent. The body limit is 1024 bytes, so a `via` near 950 characters would answer 413 and lose the hit: the script sends `''` for any `via` longer than 20 characters (the longest valid one has 9), and the server still treats whatever arrives as absent unless it is one of the seven (Task 3 `reduces via and referrer to a source`; Task 4 `an unparseable referrer is sent as no referrer` and `a via too long to be one of the seven is sent as none`).

## File map

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20261114000000_visit_counts.sql` (new) | table `visit_counts`, functions `count_visit`, `visit_totals`, grants | 1 |
| `server/visits-repository.js` (new) | `createVisitStore`: SQLite twin and the two rpc calls | 1 |
| `tests/visits-store.test.js` (new) | store, twin shape, migration text, grants | 1 |
| `DEPLOYMENT.md`, `tests/deploy.test.js`, `tests/node-requests-store.test.js`, `tests/node-requests-api.test.js`, `scripts/smoke-supabase-data-api.js` | release section; the newest-migration pin moves to one readdir assertion | 1 |
| `tests/metrics-postgres.test.js` (new), `.github/workflows/ci.yml`, `README.md` | real-Postgres checks on a fifth CI database | 2 |
| `server/visits-api.js` (new), `server/server.js`, `tests/visits-api.test.js` (new) | classification, the route, its wiring | 3 |
| `web/scripts/visit.js` (new), 19 pages, `scripts/build-static.js`, `vercel.json`, `tests/visit-script.test.js` (new), `tests/deploy.test.js`, `tests/fundadores-page.test.js` | the script, its tag, registration, cache keys | 4 |
| `docs/privacy/privacy-policy.{en,es,pt-BR}.md`, `scripts/build-privacy-page.js`, `web/pages/privacy.html`, `docs/privacy/implementation-review.md`, `docs/implementation/fiiu-2026.md`, `docs/architecture.md`, `README.md`, `tests/privacy-page.test.js` | policy text and docs | 5 |
| `docs/ops/2026-11-14-visit-counts-check.sql`, `docs/ops/2026-11-14-visit-counts-correct.sql` (new) | owner's read-only check; owner's correction of an inflated day | 6 |
| `docs/ops/2026-11-14-metrics-baseline.sql`, `tests/metrics-ops.test.js` (new) | the read-only baseline that fills the indicator sheet and that R3 is accepted against | 7 |
| `docs/metrics/indicadores-nodal.es.md` | its "por confirmar" and "por calcular" values, filled by the owner from the baseline | 9 (step 5) |

---

### Task 1: Storage — migration, store with its SQLite twin, deployment note

**Files:**
- Create: `supabase/migrations/20261114000000_visit_counts.sql`, `server/visits-repository.js`, `tests/visits-store.test.js`
- Modify: `DEPLOYMENT.md` (new section after `## Sponsorship requests: one migration before \`main\`` at `:240`, before `## Founder Membership acceptances` at `:269`; checklist step 2 at `:582-584`)
- Modify: `tests/node-requests-store.test.js:240`, `tests/node-requests-api.test.js:511-523`, `tests/deploy.test.js` (one new test), `scripts/smoke-supabase-data-api.js:38-41`

**Interfaces:**
- Consumes: `createSupabaseClients({env,fetchImpl})` (`server/supabase.js`), whose `admin.rest(path,{method,body,signal})` waits 15 s unless given a `signal` (`:179`); `fail(message,status)` (`server/courses-domain.js`).
- Produces: `createVisitStore({db,env,clients,fetchImpl})` → `{kind:'sqlite'|'supabase', count(hit): Promise<void>, totals(fromDay, toDay): Promise<Totals>}`.
  - `hit` = `{day:'YYYY-MM-DD', page:string, arrival:boolean, source:string}`; `source` is `''` when `arrival` is false.
  - `Totals` = `{v:1, days:[[day, views, arrivals], …], pages:{[page]: views}, sources:{[source]: arrivals}}`; `days` covers the whole table in ascending order, `pages` and `sources` the inclusive range `fromDay…toDay`.
  - Exported `VISIT_COUNTS_SQLITE_SCHEMA` (string) and `VISIT_WRITE_MS = 2000`, the only place the 2-second limit is written: the Supabase `count` aborts its own request on it (the client would otherwise hold the socket 15 s), and Task 3's route imports it as the default of its timer.
  - SQL: `public.count_visit(p_hit jsonb) RETURNS void`, `public.visit_totals(p_range jsonb) RETURNS jsonb` with `p_range` = `{from, to}`. R3 consumes `visitStore.totals()` and sums windows and months from `days` in `server/metrics-domain.js`.

- [ ] **Step 1: Write the failing tests** in `tests/visits-store.test.js` (SQLite through `createDatabase({filename:':memory:'})`, as `tests/node-requests-store.test.js:11`):

```js
const HIT={day:'2026-11-14',page:'index.html',arrival:true,source:'search'},VIEW={...HIT,arrival:false,source:''};
const rows=db=>db.prepare('SELECT day,kind,page,source,n FROM visit_counts ORDER BY kind DESC,page,source').all().map(Object.values);

test('counts a view and, for an arrival, its source, adding to the same daily rows',async t=>{
 await store.count(HIT);await store.count(HIT);await store.count(VIEW);
 assert.deepEqual(rows(db),[['2026-11-14','view','index.html','',3],['2026-11-14','arrival','index.html','search',2]]);
 assert.equal(store.kind,'sqlite');
});
test('totals gives every day of the table, and pages and sources for the range',async t=>{
 // 13 Nov: index 1 arrival (direct); 14 Nov: index 2 arrivals (search), fundadores 1 view; 1 Oct: index 1 arrival (qr)
 assert.deepEqual(await store.totals('2026-11-13','2026-11-14'),{v:1,
  days:[['2026-10-01',1,1],['2026-11-13',1,1],['2026-11-14',3,2]],
  pages:{'index.html':3,'fundadores.html':1},sources:{direct:1,search:2}});
 assert.deepEqual(await createVisitStore({db:empty}).totals('2026-11-13','2026-11-14'),{v:1,days:[],pages:{},sources:{}});
});
test('the local table refuses what the production table refuses',()=>{/* n=0, kind 'click', page '' , an 81-character page, a 21-character source: each INSERT throws /CHECK constraint/ */});
test('on Supabase each method is one rpc call and the table is never read',async()=>{
 // clients double {admin:{rest}} recording {path,method,body,signal} (pattern tests/fiiu-supabase.test.js:113-118)
 await store.count(HIT);
 assert.deepEqual([calls[0].path,calls[0].method,calls[0].body],['rpc/count_visit','POST',{p_hit:HIT}]);
 assert.ok(calls[0].signal instanceof AbortSignal,'its own 2-second limit, not the client default of 15');
 const totals={v:1,days:[['2026-11-14',3,2]],pages:{'index.html':3},sources:{search:2}};
 assert.deepEqual(await store.totals('2026-11-01','2026-11-14'),totals);
 assert.deepEqual(calls.slice(1).map(c=>[c.path,c.method,c.body]),[['rpc/visit_totals','POST',{p_range:{from:'2026-11-01',to:'2026-11-14'}}]]);
 assert.ok(calls.every(c=>!c.path.startsWith('visit_counts')));
 // an answer without v:1, or whose days is not an array or pages/sources not objects, rejects with status 502
});
test('the visit_counts migration is one transaction, server-only and documented',()=>{/* below */});
test('grants: the browser roles hold nothing, the server exactly what it uses',()=>{/* below */});
```

  - Migration text test: the file name sorts after `20261109000000_node_request_kinds.sql`; the header (text before `BEGIN;`) matches `/npx --no-install supabase db query --linked -f supabase\/migrations\/20261114000000_visit_counts\.sql/`, `/supabase migration repair --status applied 20261114000000/`, ``/Never `db push`/``, ``/BEFORE pushing `main`/`` and says `POST /api/visit answers 204 and counts nothing` until applied; with comments stripped the first statement is `BEGIN` and the last `COMMIT`; the text holds `CREATE TABLE public.visit_counts`, `ALTER TABLE public.visit_counts ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`, and for both functions `SECURITY INVOKER` and `SET search_path = ''`, with `VOLATILE` on `count_visit` and `STABLE` on `visit_totals`; no `SECURITY DEFINER`, no `auth.`.
  - Grants test: copy `stateFor` from `tests/review-fix-4-grants.test.js:11-24` (it is not exported). `stateFor('table','public.visit_counts',role)` is `'revoked'` for `anon` and `authenticated` and `'granted'` for `service_role`; `stateFor('function','public.count_visit(jsonb)',role)` and `…'public.visit_totals(jsonb)'…` likewise. Also assert the statement `GRANT SELECT, INSERT, UPDATE ON TABLE public.visit_counts TO service_role` exists and no `DELETE` or `TRUNCATE` is granted.

- [ ] **Step 2: Add** to `tests/deploy.test.js` the test that replaces both "newest" pins for good:

```js
test("DEPLOYMENT.md's release checklist names the newest migration", () => {
  const newest = readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort().at(-1);
  const deployment = readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');
  const steps = deployment.slice(deployment.indexOf('## Production Deployment Steps'));
  const apply = steps.slice(steps.indexOf('\n2. '), steps.indexOf('\n3. ')).replace(/\s+/g, ' ');
  assert.ok(apply.includes(`most recently \`${newest}\``), apply);
  assert.ok(deployment.includes(`supabase/migrations/${newest}`), 'a release section applies it');
});
```

  and, beside the DEPLOYMENT.md tests at the end of `tests/visits-store.test.js`, `DEPLOYMENT.md applies the visit_counts migration before main, outside the Founder sections`: a `## Visit counter: one migration before \`main\`` section exists outside both Founder slices (the loop at `tests/node-requests-api.test.js:503-505`), holds both commands of Global Constraints, `before pushing \`main\``, `/api/visit` and `docs/ops/2026-11-14-visit-counts-check.sql`.

- [ ] **Step 3: Drop the two old pins.** `tests/node-requests-store.test.js:240`: remove only `assert.equal(names.at(-1),name,'the newest migration');`. `tests/node-requests-api.test.js:511-523`: rename the test to end `…before main` and remove its last two lines (the `steps`/`apply` slice and the `most recently` match).

- [ ] **Step 4: Run** `node --test tests/visits-store.test.js tests/deploy.test.js` — expected: the new tests FAIL (module and file missing; step 2 of the checklist still names `20261109000000_node_request_kinds.sql`, which is still the newest, so that one test passes until the migration file exists).

- [ ] **Step 5: Write the migration**, modelled on `supabase/migrations/20260929194059_fiiu_event_summary.sql` (one `BEGIN; … COMMIT;`) with the house header of `20261109000000_node_request_kinds.sql:1-12`. Table and function signatures verbatim from the spec:

```sql
CREATE TABLE public.visit_counts (
 day date NOT NULL, kind text NOT NULL CHECK (kind IN ('view','arrival')),
 page text NOT NULL CHECK (char_length(page) BETWEEN 1 AND 80),
 source text NOT NULL CHECK (char_length(source) <= 20),            -- '' for a view
 n bigint NOT NULL CHECK (n > 0), PRIMARY KEY (day, kind, page, source));
ALTER TABLE public.visit_counts ENABLE ROW LEVEL SECURITY;           -- no policy
REVOKE ALL ON TABLE public.visit_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.visit_counts TO service_role;
CREATE FUNCTION public.count_visit(p_hit jsonb) RETURNS void
 LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ … $$;   -- {day, page, arrival, source}
CREATE FUNCTION public.visit_totals(p_range jsonb) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ … $$;     -- {from, to}
-- each function: REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION … TO service_role;
```

  `count_visit` is a single `INSERT INTO public.visit_counts AS c … SELECT` yielding the view row `(day,'view',page,'',1)` and, when `arrival` is true, the arrival row `(day,'arrival',page,source,1)`, `ON CONFLICT (day,kind,page,source) DO UPDATE SET n = c.n + 1` (one statement, so the body holds no inner `;` for the statement-splitting tests; the alias because the search path is empty). `visit_totals` returns the `Totals` shape with `pg_catalog.jsonb_build_object`, empty table → `{"v":1,"days":[],"pages":{},"sources":{}}`. Every object schema-qualified.

- [ ] **Step 6: Implement `createVisitStore`** in `server/visits-repository.js`, on the factory pattern of `server/node-requests-repository.js:43-46`: with `db`, `db.exec(VISIT_COUNTS_SQLITE_SCHEMA)` (same columns and CHECKs, `length()` for `char_length()`, `day TEXT`, `n INTEGER`, `CREATE TABLE IF NOT EXISTS`) and the same upsert in one transaction; without, `supa.admin.rest('rpc/count_visit',{method:'POST',body:{p_hit:hit},signal:AbortSignal.timeout(VISIT_WRITE_MS)})` and `supa.admin.rest('rpc/visit_totals',{method:'POST',body:{p_range:{from:fromDay,to:toDay}}})`, the answer checked (`v===1`, `days` an array, `pages` and `sources` plain objects) or `fail('visit totals unavailable',502)`.

- [ ] **Step 7: Docs and smoke list.** `DEPLOYMENT.md`: the new section (what the migration creates; that it is additive and safe to apply first; "Apply it before pushing `main`"; until applied `POST /api/visit` answers 204 and counts nothing, and every day lost stays lost; the two commands; then `npx --no-install supabase db query --linked -f docs/ops/2026-11-14-visit-counts-check.sql`; nothing changes in Vercel). Checklist step 2 (`:582-584`) now reads ``most recently `20261114000000_visit_counts.sql` under "Visit counter", before pushing `main` ``. `scripts/smoke-supabase-data-api.js:38-41`: add `'visit_counts'` to `readable`.

- [ ] **Step 8: Run** `node --test tests/visits-store.test.js tests/deploy.test.js tests/node-requests-store.test.js tests/node-requests-api.test.js tests/membership-fundadores.test.js tests/founder-badge.test.js tests/review-fix-4-grants.test.js tests/review-fix-4-smoke-entry.test.js` — expected: PASS (the last four slice `DEPLOYMENT.md` or read every migration and the smoke script).

- [ ] **Step 9: Commit** — `git add` the files above; message "Store daily visit totals: the visit_counts table, its two functions and the local twin".

### Task 2: Real-Postgres checks and the fifth CI database

**Files:**
- Create: `tests/metrics-postgres.test.js`
- Modify: `.github/workflows/ci.yml` (after `:61` and after `:69`), `README.md:47-62`

**Interfaces:**
- Consumes: Task 1's migration. Env `NODAL_METRICS_TEST_DATABASE_URL`, database name `nodal_metrics_test_<suffix>` (`nodal_metrics_test_ci` in CI).
- Produces: the file R3 extends (its `auth` stub, the "apply every migration" setup and the `sql` helper).

- [ ] **Step 1: Write the test** `PostgreSQL visit counts: server-only table, atomic increments, summed totals` with `{skip:!databaseUrl,timeout:120000}`. Guards as `tests/fiiu-postgres.test.js:10-15` (local host only, path `/^\/nodal_metrics_test_[a-z0-9_]+$/`, no query, database empty). Setup as `tests/review-fix-2-erasure-postgres.test.js:52-64` (the three roles, `auth` and `storage` schemas, `auth.users`, `auth.uid()`, `storage.buckets`, `GRANT USAGE ON SCHEMA public`), then Supabase's defaults before any migration (precedent `tests/membership-postgres.test.js:22`): `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;`. Then apply **every** file of `supabase/migrations` in sorted order with `psql -f`. If an older migration needs more from a stub, extend the stub, never a migration. Assertions:

```js
assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.visit_counts'::regclass`),'t');
for(const role of ['anon','authenticated'])for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await sql(`SELECT has_table_privilege('${role}','public.visit_counts','${p}')`),'f');
for(const [p,held] of [['SELECT','t'],['INSERT','t'],['UPDATE','t'],['DELETE','f'],['TRUNCATE','f']])assert.equal(await sql(`SELECT has_table_privilege('service_role','public.visit_counts','${p}')`),held);
for(const [fn,volatility] of [['public.count_visit(jsonb)','v'],['public.visit_totals(jsonb)','s']]){
 assert.equal(await sql(`SELECT provolatile::text||':'||prosecdef::text FROM pg_proc WHERE oid='${fn}'::regprocedure`),`${volatility}:false`);
 assert.equal(await sql(`SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${fn}'::regprocedure`),'t');
 for(const role of ['anon','authenticated'])assert.equal(await sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`),'f');
 assert.equal(await sql(`SELECT has_function_privilege('service_role','${fn}','EXECUTE')`),'t');
}
await assert.rejects(sql(`SET ROLE anon; SELECT public.count_visit('{}');`),/permission denied for function count_visit/);
await assert.rejects(sql(`SET ROLE authenticated; SELECT public.visit_totals('{}');`),/permission denied for function visit_totals/);
const hit=`SET ROLE service_role; SELECT public.count_visit('{"day":"2026-11-14","page":"index.html","arrival":true,"source":"search"}');`;
await Promise.all(Array.from({length:20},()=>sql(hit)));   // 20 independent sessions
assert.equal(await sql(`SELECT string_agg(kind||':'||source||':'||n,',' ORDER BY kind) FROM public.visit_counts`),'arrival:search:20,view::20');
// + one view-only hit on fundadores.html the same day, one arrival (qr) on index.html on 2026-10-01
assert.deepEqual(JSON.parse(await sql(`SET ROLE service_role; SELECT public.visit_totals('{"from":"2026-11-14","to":"2026-11-14"}');`)),
 {v:1,days:[['2026-10-01',1,1],['2026-11-14',21,20]],pages:{'index.html':20,'fundadores.html':1},sources:{search:20}});
await assert.rejects(sql(`SET ROLE service_role; DELETE FROM public.visit_counts;`),/permission denied/);
await assert.rejects(sql(`SET ROLE service_role; INSERT INTO public.visit_counts VALUES('2026-11-14','click','index.html','',1);`),/check constraint/);
```

  The test also runs the SQLite store of Task 1 over the same hits (the 20 arrivals, the view-only hit and the 1 October arrival) and asserts `deepEqual` between its `totals('2026-11-14','2026-11-14')` and the function's answer (the twin).

- [ ] **Step 2: Run** `node --test tests/metrics-postgres.test.js` — expected without the variable: 1 test, skipped. With a local empty database (`createdb nodal_metrics_test_run` then `NODAL_METRICS_TEST_DATABASE_URL=postgresql://127.0.0.1/nodal_metrics_test_run node --test tests/metrics-postgres.test.js`): PASS. If no local PostgreSQL is available, say so in the task report: CI is then the first real run.
- [ ] **Step 3: CI.** `.github/workflows/ci.yml`: after `:61` add `CREATE DATABASE nodal_metrics_test_ci TEMPLATE template0 ENCODING 'UTF8';`; after `:69` add `NODAL_METRICS_TEST_DATABASE_URL: postgresql://postgres@127.0.0.1:5432/nodal_metrics_test_ci`. `README.md:47-62`: "five empty UTF-8 databases", the visit-count integration named, the fifth variable and `nodal_metrics_test_<suffix>` added to both lists.
- [ ] **Step 4: Run** `node --test tests/deploy.test.js` — expected: PASS (it reads `ci.yml` and `README.md`).
- [ ] **Step 5: Commit** — "Check visit counts on a real PostgreSQL in CI, on a database of their own".

### Task 3: The route — `POST /api/visit`

**Files:**
- Create: `server/visits-api.js`, `tests/visits-api.test.js`
- Modify: `server/server.js` (imports after `:29`; `SESSIONLESS_API` `:109`; a `VISIT_RATE_LIMITS` constant beside `NODE_REQUEST_RATE_LIMITS` `:120`; `createApp` parameters after `:1139`; limiters and the API after `:1384`; dispatch directly after the `/api/readings` block, `:1501-1508`, before `LOGGED_DOWNLOADS`)

**Interfaces:**
- Consumes: Task 1's `createVisitStore` and `hit` shape; `bodyJson(req, limit)` (`server/courses-api.js:59`, answers 415, 413, 400 by throwing `{status}`); `limaDayStart(ms)` (`server/node-requests-api.js:22`); `createWindowRateLimiter`, `throttle`, `sameOrigin`, `send` (`server/server.js:260`, `:1302`, `:657`, `:613`).
- Produces, from `server/visits-api.js`:
  - `VISIT_PAGES`: a frozen object, pathname → page key, the 15 entries of Global Constraints.
  - `VISIT_SOURCES` (the eleven, in the order of Global Constraints) and `VISIT_VIAS` (the seven).
  - `classifyVisit(input, userAgent): {page, arrival, source} | null` — pure; `null` means "answer 204, store nothing".
  - `visitDay(ms): 'YYYY-MM-DD'`.
  - `createVisitApi({store, send, sameOrigin, now, addressAllowed(req,res): boolean, ceilingAllowed(): boolean, writeMs=VISIT_WRITE_MS, pauseMs=60000, log=console.error})` → `async({req,res,url}) => boolean` (true when it answered).
- Produces, in `server/server.js`: `const VISIT_RATE_LIMITS = { perAddress: 600, ceiling: 1200, writeMs: VISIT_WRITE_MS, pauseMs: 60000 }` (`VISIT_WRITE_MS` imported from `server/visits-repository.js`; the store's signal and this timer are both kept: the signal ends the request, the timer bounds the answer for any store, a test double included; `visitLimits.writeMs` moves the timer only); `createApp({visitStore, visitLimits})`, `visitStore` defaulting as `nodeRequestStore` does at `:1134`, `visitLimits` merged over the constant as at `:1372`. The API is built even when `visitStore` is null (an app with no database answers 204 and stores nothing).

Classification rules (`classifyVisit`):
- `null` when `input.p`, `input.r` or `input.v` is not a string, when `p` is not an own key of `VISIT_PAGES`, or when the User-Agent is empty or matches `/bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptimerobot|facebookexternalhit|whatsapp\/|curl\/|wget\/|python-requests|go-http-client/i`.
- `r === 'self'` → `{page, arrival:false, source:''}`.
- Otherwise `arrival:true` and `source` is: `via` = `v.trim().toLowerCase()` when it is one of `VISIT_VIAS`; else by `r.trim().toLowerCase()`: `''` → `direct`; a host that is, or is a subdomain of, a listed domain → that source; anything else (including text that is no host name) → `other`.
- Host lists (suffix match on a dot boundary): `search`: `google.<tld>` (`/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/`), `bing.com`, `duckduckgo.com`, `yahoo.com`, `ecosia.org`, `brave.com`, `yandex.com`, `startpage.com`, `com.google.android.googlequicksearchbox`; `whatsapp`: `whatsapp.com`, `wa.me`, `com.whatsapp`; `email`: `mail.google.com` (checked before `search`), `outlook.live.com`, `outlook.office.com`, `mail.yahoo.com` (before `search`), `com.google.android.gm`; `linkedin`: `linkedin.com`, `lnkd.in`, `com.linkedin.android`; `instagram`: `instagram.com`, `com.instagram.android`; `facebook`: `facebook.com`, `fb.com`, `messenger.com`, `com.facebook.katana`; `x`: `x.com`, `twitter.com`, `t.co`, `com.twitter.android`; `sistemaurbano`: `sistemaurbano.org`.

Route order, exactly: path is `/api/visit` or return false → method not POST: 405 `{error:'method not allowed'}` with `Allow: POST` → `sameOrigin(req)` false, or no `Origin` header, or `new URL(origin).host !== req.headers.host`, or a `Sec-Fetch-Site` header other than `same-origin`: 403 `{error:'cross-origin request rejected'}` → `addressAllowed(req,res)` false: return (429 already sent) → `bodyJson(req,1024)`, its 415, 413 and 400 answered with `send(res,err.status,{error:err.message})` → `classifyVisit` null: 204 → inside the pause: 204 → `ceilingAllowed()` false: 204 → `store.count({day:visitDay(now()),…})` raced against a `writeMs` timer cleared in `finally` (precedent `server/error-report.js:103-106`; the injected `now` is used for the day and the pause only, never to measure the timer) → on failure start the pause (`now()+pauseMs`) and `log` once per instance `Visit count failed: <err.code || err.upstream || err.status || err.name>` → 204. The 204 is `send(res,204,'')` (empty, `Cache-Control: no-store`). A null store skips the store call. Nothing thrown leaves the handler.

- [ ] **Step 1: Write the failing tests** in `tests/visits-api.test.js`. Harness: `createApp({db,now:()=>clock.at,…})` on SQLite as `tests/node-requests-api.test.js:29-36`; `hit(body,{origin=base,type='application/json',ua=CHROME,headers}={})` posts to `/api/visit`; `rows()` reads `visit_counts` in the order of Task 1's `rows` (views first); `START='2026-11-14T15:00:00.000Z'`; `CHROME` is a desktop Chrome User-Agent. For requests that must carry no `Origin`, or a header `fetch` will not send as given (`Sec-Fetch-Site`), use `node:http` `request`.

```js
test('exports the page map, the eleven sources and the seven via values',()=>{
 assert.equal(Object.keys(VISIT_PAGES).length,15);assert.equal(new Set(Object.values(VISIT_PAGES)).size,14);
 assert.equal(VISIT_PAGES['/'],'index.html');assert.equal(VISIT_PAGES['/index.html'],'index.html');assert.equal(VISIT_PAGES['/fiiu-talk.html'],undefined);
 assert.deepEqual(VISIT_SOURCES,['direct','search','whatsapp','email','linkedin','instagram','facebook','x','qr','sistemaurbano','other']);
 assert.deepEqual(VISIT_VIAS,['whatsapp','email','linkedin','instagram','facebook','x','qr']);
 for(const page of new Set(Object.values(VISIT_PAGES)))assert.ok(existsSync(path.join(ROOT,'web','pages',page)),page);   // the tag on each is Task 4's test
});
test('counts a view for an internal move and a view plus an arrival otherwise',async t=>{
 assert.equal((await hit({p:'/fundadores.html',r:'self',v:''})).status,204);
 const res=await hit({p:'/fundadores.html',r:'www.google.com',v:''});
 assert.deepEqual([res.status,await res.text(),res.headers.get('cache-control')],[204,'','no-store']);
 assert.deepEqual(rows(),[['2026-11-14','view','fundadores.html','',2],['2026-11-14','arrival','fundadores.html','search',1]]);
});
test('/ and /index.html add to one index.html row, and the session page counts',…);          // then /fiiu-session.html → its own row
test('addresses off the list answer 204 and store nothing',…);   // '/fiiu-talk.html','/admin.html','/index.html/','/Index.html','/index.html?x=1','/privacy.html','/%69ndex.html'
test('reduces via and referrer to a source',…);
// [r,v]→source: ['','']→direct; ['','whatsapp']→whatsapp; ['',' WhatsApp ']→whatsapp; ['www.google.com.pe','']→search; ['mail.google.com','']→email;
// ['l.instagram.com','']→instagram; ['t.co','']→x; ['www.sistemaurbano.org','']→sistemaurbano; ['example.org','']→other; ['notgoogle.com','']→other;
// ['www.google.com','qr']→qr (via wins); ['www.google.com','tiktok']→search (unknown via is absent, the hit still counts); ['','x'.repeat(500)… within 1024 bytes]→direct
test('whatever r holds, only a fixed source is stored',…);        // '<script>', 'A'.repeat(300), 'WWW.GOOGLE.COM'→search, 'com.google.android.gm'→email: every stored source ∈ VISIT_SOURCES; {p,r:123,v:''} and {p} alone → 204, no row
test('the query, the referrer and the address are never stored',…);  // after hits with r 'secret.example.org' and v 'whatsapp': JSON.stringify(rows()) holds none of 'secret', 'example.org', '127.0.0.1', '?'
test('a hit is counted on its Lima day',…);                       // clock 2026-11-15T04:59:59.000Z → day '2026-11-14'; 2026-11-15T05:00:00.000Z → '2026-11-15'
test('counts in-app browsers and ignores previewers and crawlers',…);
// count: UAs containing 'Instagram 300.0', 'FBAN/FBIOS', 'LinkedInApp'; ignore (204, no row): 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Googlebot/2.1', 'HeadlessChrome', '' (no User-Agent)
test('refuses other methods, other origins and other content types',…);
// GET → 405 with Allow 'POST'; no Origin → 403; Origin 'https://evil.example' → 403; Sec-Fetch-Site 'cross-site' → 403, 'none' → 403, 'same-origin' → 204;
// Content-Type 'text/plain' (what sendBeacon sends) → 415; a 2,000-byte body → 413; '[]' → 400; no row from any of them
test('limits one address to 600 a minute',…);                    // createApp({visitLimits:{perAddress:3}}): the 4th answers 429 {error:'too many requests'} with Retry-After
test('past the per-instance ceiling it answers 204 and stores nothing',…); // visitLimits:{ceiling:2}: three hits → all 204, view n=2
test('a failing store answers 204, is asked nothing for 60 seconds, and is logged once without the address',…);
// visitStore double whose count throws Object.assign(new Error('x'),{code:'PGRST202'}) and counts calls: hit → 204, calls 1; hit → 204, calls 1;
// clock +60001 ms → hit → 204, calls 2. The log: createApp passes no log, so the route's default is console.error: const logged=t.mock.method(console,'error',()=>{});
// the calls whose first argument starts 'Visit count failed' are exactly one, that argument matches /^Visit count failed: PGRST202$/ and no logged argument holds '127.0.0.1'
test('a missing table answers 204',…);                            // db.exec('DROP TABLE visit_counts') → 204
test('a store that never answers is given up after the write limit',…); // visitLimits:{writeMs:50}, count returns new Promise(()=>{}): 204 within 1 s
test('never answers 5xx',…);                                      // every status collected in this file is < 500
test('never resolves a session',…);                               // repository double whose resolveSession throws and counts (tests/node-requests-api.test.js:285-296), stale cookies sent: 204, lookups 0
test('an app with no database answers 204',…);                    // createApp({store:createStore()}) as tests/api.test.js:32
```

- [ ] **Step 2: Run** `node --test tests/visits-api.test.js` — expected: FAIL (`server/visits-api.js` not found).
- [ ] **Step 3: Implement `server/visits-api.js`** to the Interfaces block, the classification rules and the route order above. `visitDay = ms => limaDayStart(ms).slice(0,10)`.
- [ ] **Step 4: Wire it in `server/server.js`**: add `'/api/visit'` to `SESSIONLESS_API` (extend its comment: a visit never reads the session); the constant, the two `createApp` parameters, `visitAddressLimiter` (`windowMs:60000`, `limit:perAddress`, taken through `throttle(…,res,req,null,'visit')`) and `visitCeiling` (`windowMs:60000`, `limit:ceiling`, one key `'visit:all'`, the `signupEmailCeiling` pattern at `:1171` and `:1860`); `const visitApi=createVisitApi({…})`; and `if(await visitApi({req,res,url}))return;` directly after the `/api/readings` block.
- [ ] **Step 5: Run** `node --test tests/visits-api.test.js tests/visits-store.test.js tests/node-requests-api.test.js tests/api.test.js` — expected: PASS.
- [ ] **Step 6: Commit** — "Count a page view and its arrival source at POST /api/visit".

### Task 4: The script, its tag on 19 pages, registration and cache keys

**Files:**
- Create: `web/scripts/visit.js`, `tests/visit-script.test.js`
- Modify (tag, no `data-staff`, 15): `web/pages/index.html`, `login.html`, `fundadores.html`, `opportunities.html`, `community.html`, `resources.html`, `knowledge.html`, `fiiu.html`, `fiiu-session.html`, `fiiu-talk.html`, `dashboard.html`, `profile.html`, `payments.html`, `courses.html`, `course.html`
- Modify (tag with `data-staff`, 4): `web/pages/admin.html`, `fiiu-admin.html`, `teaching.html`, `fiiu-qr.html`
- Modify: `server/server.js:69`, `scripts/build-static.js:13`, `vercel.json:40` (add `visit` to the script source list), `tests/deploy.test.js:319-347`, `tests/fundadores-page.test.js:318`

**Interfaces:**
- Consumes: Task 3's `POST /api/visit` and `VISIT_PAGES`.
- Produces: the tag, exactly `<script defer src="visit.js?v=20261114a"></script>` or `<script defer src="visit.js?v=20261114a" data-staff></script>`, the last `<script>` of each head; the marker `localStorage['nodal.staff']='1'`, which R2's sign-out removes and R3's `admin-home.html` sets through the same `data-staff` tag.

Behaviour (spec "R1. Visit counter", steps 1-3; about 40 lines, one IIFE, no function named `t`, no id lookup):
1. `document.currentScript` has `data-staff` → set the marker (inside `try`), send nothing.
2. `location.pathname === '/login.html'` → remove the marker (inside `try`), go on.
3. Unless the marker reads `'1'` (a read that throws counts as no marker), `navigator.webdriver` is true or `document.prerendering` is true, send exactly:

```js
fetch('/api/visit',{method:'POST',keepalive:true,credentials:'omit',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({p,r,v})}).catch(()=>{})
```

`p` = `location.pathname`; `r` = `''` when `document.referrer` is empty or cannot be parsed by `new URL`, `'self'` when its `host` equals `location.host`, else its `hostname`; `v` = `new URLSearchParams(location.search).get('via')` or `''`, and `''` too when it is longer than 20 characters (the spec gives `v` uncut and says a malformed `via` is treated as absent with the hit still counted; uncut, a very long one would pass the route's 1024 bytes and be refused with 413, so the cut is what keeps the spec's promise). A `fetch` that throws synchronously is caught too.

- [ ] **Step 1: Write the failing tests** in `tests/visit-script.test.js` (the script run with `vm.runInNewContext` over a context `{document:{currentScript:{hasAttribute},referrer,prerendering},location:{pathname,search,host},navigator:{webdriver},localStorage,fetch,URL,URLSearchParams}` whose `fetch` records `[url,JSON.parse(JSON.stringify(init))]` and returns a resolved promise. The copy matters in every test that compares `calls`: the script runs in another realm, its objects have that realm's prototypes, and `node:assert/strict` `deepEqual` refuses them against literals written here. Values read back from the context's `localStorage` double are strings, so they compare as they are):

```js
test('a public page sends its path, referrer host and via',()=>{
 const {calls}=run({pathname:'/fundadores.html',search:'?via=whatsapp&x=1',referrer:'https://www.google.com/search?q=nodal'});
 assert.deepEqual(calls,[['/api/visit',{method:'POST',keepalive:true,credentials:'omit',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({p:'/fundadores.html',r:'www.google.com',v:'whatsapp'})}]]);
});
test('a move inside the site is sent as self, and no referrer as empty',…);   // referrer 'https://nodal.example/index.html' with host 'nodal.example' → r 'self'; '' → r '', v ''
test('an unparseable referrer is sent as no referrer',…);                     // referrer 'not a url' → r '', one call, nothing thrown
test('a via too long to be one of the seven is sent as none',…);              // search '?via='+'x'.repeat(2000) → one call, v '', body under 1024 bytes; '?via=%20WhatsApp%20' → v ' WhatsApp ' (the server trims)
test('a staff page sets the marker and sends nothing',…);                     // staff:true → calls [], storage['nodal.staff']==='1'
test('a marked browser sends nothing, and neither does an automated or prerendering one',…); // three runs, calls [] each
test('the sign-in page clears the marker, then counts',…);                    // marker '1', pathname '/login.html' → marker removed, one call with p '/login.html'
test('a browser that refuses storage neither breaks nor miscounts',…);        // getItem/setItem/removeItem throw: public → one call; staff → no call; login → one call
test('a failed or throwing fetch never reaches the page',…);                  // fetch returning Promise.reject(new Error('offline')), and fetch that throws: no exception, no unhandled rejection
test('the source reads nothing else from the address',()=>{
 const js=read('web/scripts/visit.js');
 for(const word of ['location.href','location.hash','document.cookie','sendBeacon'])assert.ok(!js.includes(word),word);
 assert.doesNotMatch(js,/\bt\(|getElementById|querySelector/);assert.ok(js.split('\n').length<=60);
});
test('the tag is on exactly the listed pages, last in the head, and the page map matches it',()=>{
 // over readdirSync('web/pages'): files with the plain tag deepEqual the 15 above (sorted); files with data-staff deepEqual the 4;
 // none on accept-invitation, reset-password, fiiu-checkin, organisers-only, privacy, terminos-fundadores;
 // on each of the 19 the tag is the last <script> and precedes </head>; every tag is spelled exactly as in Interfaces;
 // new Set(Object.values(VISIT_PAGES)) equals the 15 plain files minus 'fiiu-talk.html'
});
```

- [ ] **Step 2: Update the pins.** `tests/deploy.test.js:319-347`: add `const visit = { 'visit.js': '20261114a' };` beside `pilot` and spread `...visit` into the 19 pages' entries (`index`, `fundadores`, `opportunities`, `dashboard`, `login`, `payments`, `profile`, `admin`, `course`, `courses`, `teaching`, `fiiu`, `fiiu-admin`, `fiiu-qr`, `fiiu-talk`, `fiiu-session`, `community`, `knowledge`, `resources`). `tests/fundadores-page.test.js:318`: the list gains a fifth entry, `'defer src="visit.js?v=20261114a"'`.
- [ ] **Step 3: Run** `node --test tests/visit-script.test.js tests/deploy.test.js tests/fundadores-page.test.js` — expected: FAIL (no script, no tag).
- [ ] **Step 4: Implement** `web/scripts/visit.js`, add the tag to the 19 pages (on the one-line heads, e.g. `community.html:4`, append it after the last `</script>` of that line; `fiiu-session.html` and `fiiu-talk.html` get the identical tag, `tests/fiiu-talk-ui.test.js:1607`), and register `'visit.js'` in the three lists.
- [ ] **Step 5: Grep for other literal pins** of a script list on the 19 pages: `grep -n "matchAll(/<script" tests/*.test.js`. Checked on 14 Nov 2026: besides the two in step 2, only `tests/membership-terms-page.test.js:135` pins a full list, for a page R1 does not touch. Fix any new one the same way.
- [ ] **Step 6: Run** `node --test tests/visit-script.test.js tests/visits-api.test.js tests/deploy.test.js tests/fundadores-page.test.js tests/page-loading.test.js tests/fiiu-talk-ui.test.js tests/i18n-split.test.js tests/buc-ui.test.js tests/fiiu-live-ui.test.js tests/privacy-page.test.js tests/catalog-ui.test.js tests/founders-desk-ui.test.js tests/fiiu-ui.test.js` — expected: PASS. Then `npm run lint` — expected: 0 problems.
- [ ] **Step 7: Commit** — "Load the visit counter on public and member pages, and mark staff browsers so the team is not counted".

### Task 5: Privacy text in three languages, and the docs

**Files:**
- Modify: `docs/privacy/privacy-policy.en.md`, `privacy-policy.es.md`, `privacy-policy.pt-BR.md` (lines `:32`, `:33`, `:43`, `:86`, `:94`, `:96` in each: the three files are line-aligned), `scripts/build-privacy-page.js:9`, `:20`, `:31` (the date), `web/pages/privacy.html` (regenerated, never edited by hand)
- Modify: `docs/privacy/implementation-review.md` (`:19`, the storage table `:69-79`, sections 1 and 3), `docs/implementation/fiiu-2026.md`, `docs/architecture.md` (`:22`, the limits table from `:36`, `:56`, `:108`), `README.md` (API list near `:236-246`)
- Test: `tests/privacy-page.test.js`

**Interfaces:**
- Consumes: the behaviour of Tasks 3 and 4 (what is stored, the marker and when it is cleared).
- Produces: the R1 sentences R3 later extends (spec "With R3"); nothing here mentions saved readings or reports. R3's Task 13 rewrites four assertions of Step 1's test when it changes those sentences: the section 3 sentence, the section 9 list, the section 9 paragraph, and the "no reports of totals" check, which it removes.

Text, sentence for sentence (EN from the spec, verbatim):

| Where | EN | ES | PT |
|---|---|---|---|
| Section 2, new row after "Usage and connections" (`:32`), category | Visit counts | Conteo de visitas | Contagem de visitas |
| its second cell | When a NODAL page opens, a small script from NODAL itself tells our server which page was opened and the name of the site you came from, which our server reduces at once to a kind of source (a search engine, a social network, a link the team shared, or directly) and does not store. We add one to that day's total for the page and for that kind of source. We store only these daily totals: no cookie, no IP address, no visitor or account identifier. They count page openings and arrivals, not people, cannot be linked to you, and so are not part of an account export or deletion. Password-reset, invitation and staff pages are not counted. | Cuando se abre una página de NODAL, un pequeño script de la propia NODAL le indica a nuestro servidor qué página se abrió y el nombre del sitio desde el que llegaste, que nuestro servidor reduce de inmediato a un tipo de origen (un buscador, una red social, un enlace compartido por el equipo o directamente) y no guarda. Sumamos uno al total de ese día para la página y para ese tipo de origen. Guardamos solo esos totales diarios: sin cookie, sin dirección IP, sin identificador de visitante ni de cuenta. Cuentan aperturas de página y llegadas, no personas, no pueden vincularse contigo y por eso no forman parte de la exportación ni de la eliminación de una cuenta. Las páginas de restablecimiento de contraseña, de invitación y del equipo no se cuentan. | Quando uma página da NODAL é aberta, um pequeno script da própria NODAL informa ao nosso servidor qual página foi aberta e o nome do site de onde você veio, que o nosso servidor reduz imediatamente a um tipo de origem (um buscador, uma rede social, um link compartilhado pela equipe ou diretamente) e não guarda. Somamos um ao total daquele dia para a página e para esse tipo de origem. Guardamos apenas esses totais diários: sem cookie, sem endereço IP, sem identificador de visitante ou de conta. Eles contam aberturas de página e chegadas, não pessoas, não podem ser vinculados a você e, por isso, não fazem parte da exportação nem da exclusão de uma conta. As páginas de redefinição de senha, de convite e da equipe não são contadas. |
| "Technical information" row (`:33`), appended | Our server uses the IP address of a request briefly to limit abuse and does not save it with visit counts. | Nuestro servidor usa brevemente la dirección IP de una solicitud para limitar abusos y no la guarda con los conteos de visitas. | Nosso servidor usa brevemente o endereço IP de uma requisição para limitar abusos e não o guarda com as contagens de visitas. |
| Section 3 (`:43`), directly after the "must be validated" sentence | Visit counts are part of that usage analysis. | Los conteos de visitas forman parte de ese análisis de uso. | As contagens de visitas fazem parte dessa análise de uso. |
| Section 8, end of its first paragraph (`:86`) | Visit counting uses no cookie. On browsers used to open NODAL's staff pages, a marker is saved in browser storage so the team's own visits are not counted; it has no expiry, stays in that browser and is removed when the sign-in page is opened there. | El conteo de visitas no usa cookies. En los navegadores con los que se abren las páginas del equipo de NODAL se guarda una marca en el almacenamiento del navegador para que las visitas del propio equipo no se cuenten; no tiene vencimiento, permanece en ese navegador y se elimina cuando se abre allí la página de inicio de sesión. | A contagem de visitas não usa cookies. Nos navegadores usados para abrir as páginas da equipe da NODAL, uma marca é salva no armazenamento do navegador para que as visitas da própria equipe não sejam contadas; ela não expira, fica nesse navegador e é removida quando a página de login é aberta nele. |
| Section 9 list (`:94`), inserted after "usage events," | daily visit totals, | totales diarios de visitas, | totais diários de visitas, |
| Section 9, new paragraph directly after the `**{{RETENCAO}}**` paragraph (`:96`) — **open question 1** | Daily visit totals contain no personal data and are kept without a time limit. | Los totales diarios de visitas no contienen datos personales y se conservan sin límite de tiempo. | Os totais diários de visitas não contêm dados pessoais e são mantidos sem limite de tempo. |

Dates in `scripts/build-privacy-page.js`: `Updated 14 November 2026`, `Actualizado el 14 de noviembre de 2026`, `Atualizado em 14 de novembro de 2026` (the day the text is written; change all three together if the task runs later).

- [ ] **Step 1: Write the failing test** `visit counting is described in every language: what is stored, what is not, the staff marker and how long totals are kept` in `tests/privacy-page.test.js`, with the `articles`/`section`/`escape` helpers of `:246-249`. For each language, with the strings of the table above (through `escape`, for the apostrophes): section 2 holds the category as a table cell and the whole second cell; holds the appended "Technical information" sentence; section 3 holds its sentence; section 8 holds both sentences; section 9 holds `usage events, daily visit totals, logs` (ES `eventos de uso, totales diarios de visitas, registros técnicos`; PT `eventos de uso, totais diários de visitas, logs`) and the new paragraph inside its own `<p>`; no section of any article mentions readings or reports of totals (EN `/saved daily totals|reports of totals/` absent). The existing tests keep the 12 sections, the draft status and the pinned section 9 phrase (`:256`).
- [ ] **Step 2: Run** `node --test tests/privacy-page.test.js` — expected: the new test FAILS, the rest pass.
- [ ] **Step 3: Edit** the three policies and the three dates, then run `node scripts/build-privacy-page.js`.
- [ ] **Step 4: Edit the docs.** `docs/privacy/implementation-review.md`: `:19` says a first-party visit counter now exists, cookie-free, storing daily totals only (`web/scripts/visit.js`, `server/visits-api.js`); the storage table gains `| \`nodal.staff\` local storage | Marks a browser that opened a staff page, so the team's visits are not counted | No expiry; removed when the sign-in page opens in that browser. |`; section 1 gains a row for `visit_counts` (what it holds, that it holds no personal data, the files); section 3's proposed schedule gains "daily visit totals: no time limit (no personal data)". `docs/implementation/fiiu-2026.md`: a dated entry that the festival pages now load `visit.js` (`fiiu.html` and the session page counted, `fiiu-admin.html` and `fiiu-qr.html` staff-marked, `fiiu-checkin.html` never). `docs/architecture.md`: `:22` the test count as the suite reports it after this task; the limits table gains `| Visit counts (every public and member page, no account; fixed in code) | 600 a minute per client address; 1,200 counted a minute per instance, the rest answered and not counted |`; `:56` adds "visit counts at 1 KB"; `:108` becomes the first-party counter that shipped (page views and arrivals as daily totals, no payment-button clicks), no longer a roadmap item to adopt Plausible or Vercel Web Analytics. `README.md`, after the node-request endpoints: `POST /api/visit` `{p, r, v}` answers 204 whether counted or ignored, 403, 405, 415 or 429, never reads the session, stores daily totals only (`server/visits-api.js`, `server/visits-repository.js`).
- [ ] **Step 5: Run** `node --test tests/privacy-page.test.js tests/deploy.test.js tests/node-requests-api.test.js` — expected: PASS (the last reads `README.md`).
- [ ] **Step 6: Commit** — "Say in the privacy policy, in three languages, that NODAL counts visits as daily totals".

### Task 6: Ops files — the owner's check and the correction of an inflated day

**Files:**
- Create: `docs/ops/2026-11-14-visit-counts-check.sql`, `docs/ops/2026-11-14-visit-counts-correct.sql`
- Test: `tests/visits-store.test.js` (one more test)

**Interfaces:**
- Consumes: Task 1's objects. The check file's path is already named in `DEPLOYMENT.md` (Task 1, step 7), five commits before the file exists; nothing tests that the path exists and the branch is not pushed in between, so the order stays.

- [ ] **Step 1: Write the failing test** `the ops files: one read-only check, and a correction that fails until a day is typed`:

```js
const strip=sql=>sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
const check=strip(read('docs/ops/2026-11-14-visit-counts-check.sql'));
assert.equal(check.length,1);assert.match(check[0],/^select /i);
assert.doesNotMatch(check[0].replace(/'[^']*'/g,"''"),/\b(insert|update|delete|truncate|alter|drop|grant|revoke|create)\b/i);   // quoted text emptied first: the privilege names below are literals, not statements
for(const alias of ['rls_on','browser_grants','functions_invoker','functions_closed','migration_row','last_7_days'])assert.match(check[0],new RegExp(` as ${alias}\\b`));
assert.match(read('docs/ops/2026-11-14-visit-counts-check.sql'),/npx --no-install supabase db query --linked -f docs\/ops\/2026-11-14-visit-counts-check\.sql/);
const correct=strip(read('docs/ops/2026-11-14-visit-counts-correct.sql'));
assert.equal(correct.length,1);assert.ok(correct[0].includes("'<YYYY-MM-DD>'::date"),'fails on the cast until edited');
assert.match(correct[0],/^delete from public\.visit_counts where day = /i);assert.match(correct[0],/ returning /i);
```

- [ ] **Step 2: Run** `node --test tests/visits-store.test.js` — expected: this test FAILS (files missing).
- [ ] **Step 3: Write the check file** on the model of `docs/ops/2026-11-09-node-request-kinds-check.sql`: a header with the command and the expected row, then one `select` of scalar subselects: `rls_on` (`relrowsecurity` of `public.visit_counts`, expected `true`), `browser_grants` (count of privileges `anon` and `authenticated` hold on the table, via `has_table_privilege(role,'public.visit_counts',…)` over SELECT, INSERT, UPDATE, DELETE, TRUNCATE, the five names written only as quoted literals so Step 1's word check passes: expected 0), `functions_invoker` (count of the two functions with `prosecdef` false: 2), `functions_closed` (count of function × browser-role pairs with EXECUTE: 0), `migration_row` (`supabase_migrations.schema_migrations` where `version='20261114000000'`: 1 after the repair), `last_7_days` (a `string_agg` of `day:views/arrivals` for the last 7 Lima days, newest first, or `'no visits yet'`; an inflated day shows here).
- [ ] **Step 4: Write the correction file** on the model of `docs/ops/2026-10-29-confirmation-sessions.sql`: a header saying what it is for (a day a script inflated; spec "Privacy and security"), that it is not a migration, that the owner runs it by hand as `postgres` after reading the day in the check file, and that readings are never touched because visit figures are always summed again from this table; then the single statement `delete from public.visit_counts where day = '<YYYY-MM-DD>'::date returning kind, page, source, n;`. In comments (so they are not statements), the variant that sets one row instead: `update public.visit_counts set n = <n> where day = … and kind = … and page = … and source = … returning *`.
- [ ] **Step 5: Run** `node --test tests/visits-store.test.js` — expected: PASS.
- [ ] **Step 6: Commit** — "Add the owner's read-only check for visit counts and the correction for an inflated day".

### Task 7: The baseline file for the indicator sheet

Not part of the counter, and nothing in Tasks 1 to 6 depends on it. It is here because the sheet goes out the day R1 ships and the owner needs its values first (Task 9, step 5). Written from the spec's "Indicator catalogue" and "What counts as activity (C2)" only, before any metrics function exists: R3's home is later accepted against it, so it must not be rewritten from R3's SQL.

**Files:**
- Create: `docs/ops/2026-11-14-metrics-baseline.sql`
- Create: `tests/metrics-ops.test.js` (R3's Task 4 adds its migration and ops tests to this file)

**Interfaces:**
- Consumes: nothing of Tasks 1 to 6; no migration (it reads tables that exist in production today, and never `visit_counts`).
- Produces: one read-only SELECT of scalar subselects, computing the Lima day itself, with these columns: `lima_day`, `accounts`, `confirmed`, `last_signup_day`, `accounts_by_month` (text, `2026-07:9, …`), `profiles`, `profiles_7d`, `profiles_30d`, `admins`, `with_city`, `interests_not_null`, `with_interests`, `basic_profile`, `with_bio`, `assessed`, `directory_visible`, `onboarding_rows`, `course_openers_non_admin`, `survey_n` (non-admin enrolments before `2026-10-01T00:00:00Z`), `active_7d`, `active_30d`, and per kind `active_<kind>_7d` / `active_<kind>_30d` for `profile`, `network`, `opportunities`, `festival`, `courses`, `membership`, and `countries` (text: `lower(btrim(country))` with its count, most frequent first). "Inscripciones a bloques" and "Horas de asistencia" are not here: they are read from the festival panel the same day.

- [ ] **Step 1: Write the failing test** `the baseline is one read-only query that needs no migration` in `tests/metrics-ops.test.js`:
  ```js
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const sql = read('docs/ops/2026-11-14-metrics-baseline.sql').replace(/--[^\n]*/g, '');
  assert.equal(sql.split(';').filter(s => s.trim()).length, 1);
  assert.match(sql.trim(), /^select\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
  assert.doesNotMatch(sql, /metrics_account_days|metrics_member_days|metrics_readings|visit_counts/);
  for (const column of ['lima_day','accounts','confirmed','basic_profile','interests_not_null','with_interests','survey_n','active_30d','active_membership_7d','countries']) assert.match(sql, new RegExp(`\\bas ${column}\\b`, 'i'));
  ```
- [ ] **Step 2: Run** `node --test tests/metrics-ops.test.js` — expected: FAIL (file missing).
- [ ] **Step 3: Write the file.** Header as `docs/ops/2026-11-09-node-request-kinds-check.sql:1-5`: what it is, the command (`npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-baseline.sql`), and that its values replace each `n` of the spec's catalogue and each "por confirmar" and "por calcular" of the sheet. Definitions row by row from the catalogue and from "What counts as activity (C2)", including its "left out on purpose" list. No write keyword anywhere outside the `--` comments, a quoted literal included (Step 1 strips comments only).
- [ ] **Step 4: Run** the same command — expected: PASS.
- [ ] **Step 5: Commit** — "Add the read-only baseline the indicator sheet and the admin home are checked against".

### Task 8: Whole suite, Vercel-like build, local preview on 127.0.0.1

**Files:**
- Modify: `.claude/launch.json` (one configuration; the file is git-ignored, `.gitignore:10`, so nothing is committed)

**Interfaces:**
- Consumes: everything above. Produces the evidence the release hand-off (Task 9) quotes.

- [ ] **Step 1: Run** `npm run lint` and `npm test` — expected: 0 problems; 0 failures (Postgres suites skipped without their variables).
- [ ] **Step 2: Run the build as Vercel does**: `env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://example.org EMAIL_SMTP_URL=smtps://u:p@smtp.example.invalid:465 EMAIL_FROM="FIIU Fest 11 <fest@example.invalid>" npm run build` — expected: lint clean, 0 failures, `public/visit.js` exists.
- [ ] **Step 3: Start a preview.** Add to `.claude/launch.json` a configuration `nodal-visits` on the pattern of `nodal-sponsorship` (`DATA_BACKEND=sqlite`, a `DATABASE_PATH` in the session scratchpad, `PORT=4183`, `PUBLIC_BASE_URL=http://127.0.0.1:4183`, `url` `http://127.0.0.1:4183`), seed it (`DATABASE_PATH=… npm run seed:dev`) and start it. Use `127.0.0.1`, never `localhost`; restart the preview after any server edit.
- [ ] **Step 4: Check in the browser**, in EN, ES and PT, at desktop width and at 375px (R1 has no screen, so the check is that nothing visible changed and the network behaves):
  - `/`, `/fundadores.html?via=whatsapp`, `/fiiu.html`, `/login.html`: each sends one `POST /api/visit` answered 204; no console error; no layout change against `main`.
  - `sqlite3 <DATABASE_PATH> "select * from visit_counts"` (or the same query through `node:sqlite`): `index.html` and `fundadores.html` views; a `whatsapp` arrival on `fundadores.html`; navigating from `/` to `/fiiu.html` adds a view and no arrival.
  - Signed in as an admin (a session made with `createUser` and `createSession`, cookie set on 127.0.0.1): `/admin.html`, `/fiiu-admin.html`, `/teaching.html`, `/fiiu-qr.html` send no `POST /api/visit` and `localStorage['nodal.staff']` is `'1'`; then `/dashboard.html` sends none; the three tools look and work as on `main` (desk tabs load, festival panel sticky offsets hold, teaching header unchanged).
  - Sign out: `/login.html` sends one POST and the marker is gone.
  - `/privacy.html` in three languages shows the "Visit counts" row and the new sentences; `/reset-password.html`, `/accept-invitation.html`, `/fiiu-checkin.html`, `/privacy.html`, `/terminos-fundadores.html` send no POST.
- [ ] **Step 5: Record** in the task report the test totals of steps 1 and 2 and the rows seen in step 4. Nothing to commit unless a check found a defect; a defect goes back to its task with a failing test first.

### Task 9: Release — the owner's steps, in this order

**Files:** no code (hand-off); step 5 edits `docs/metrics/indicadores-nodal.es.md`. **Interfaces:** consumes the branch, `DEPLOYMENT.md`'s "Visit counter" section, the two ops files of Task 6 and the baseline file of Task 7.

- [ ] **Step 1: Whole-branch review**, then hand the owner the branch and this checklist. Do not merge, push or run the supabase CLI.
- [ ] **Step 2: Owner, before any push** — confirm or change the three defaults of the header table (retention wording, legal look, Vercel cost). A changed retention answer returns to Task 5 before going on.
- [ ] **Step 3: Owner applies the migration** to production, then checks, then repairs the history:

```bash
npx --no-install supabase db query --linked -f supabase/migrations/20261114000000_visit_counts.sql
npx --no-install supabase db query --linked -f docs/ops/2026-11-14-visit-counts-check.sql
npx --no-install supabase migration repair --status applied 20261114000000
```

  Expected from the check before the repair: `rls_on` true · `browser_grants` 0 · `functions_invoker` 2 · `functions_closed` 0 · `migration_row` 0 · `last_7_days` "no visits yet"; `migration_row` is 1 when the check is run again after the repair. The code live before the push never calls these objects, so applying first is safe.
- [ ] **Step 4: Owner merges and pushes `main`.** Then: the Vercel Production deployment status is `success` (not only a 200); `https://sistema-urbano-nodal-ten.vercel.app/visit.js?v=20261114a` answers 200; opening the landing page in a browser that never opened a staff page sends `POST /api/visit` → 204; the check file run again shows today's Lima day in `last_7_days`; `/privacy.html` shows the new row in three languages.
- [ ] **Step 5: Owner, the same day — the baseline and the sheet.** It reads production and changes nothing, so it does not gate step 4 and may be done before it:

```bash
npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-baseline.sql
```

  Expected: one row. Its known columns agree with the spec's "14 Nov" column (`accounts` 525, `confirmed` 494, `profiles` 486, `admins` 5, `with_city` 210, `with_bio` 17, `assessed` 33, `onboarding_rows` 210); a difference is explained before the sheet goes out. The same day, read "Inscripciones a bloques", "Horas de asistencia" and the laboratory applications from the festival panel, and the course totals from the teaching workspace: the baseline has no column for them. Then, in `docs/metrics/indicadores-nodal.es.md`, replace every "por confirmar" and "por calcular" with its value (on 14 Nov 2026: lines `:25`, `:27`, `:71`, `:72`, `:74`, `:112`, `:116`, `:127`, `:131`, `:133`; `grep -n "por confirmar\|por calcular" docs/metrics/indicadores-nodal.es.md` must find nothing afterwards) and write the Lima day of the reading beside them. Commit the sheet ("Fill the indicator sheet with the baseline of <day>"), keep the baseline row for R3's acceptance, and send the sheet to Flavia and Mariana with the reply-by date of open question 4. The `n` values of the spec's catalogue are replaced in R3 (its Task 14, step 9).
- [ ] **Step 6: Note the first counted Lima day** (R3 prints "se cuenta desde el <día de R1>" from the first row of `visit_counts`; nothing to store by hand) and tell the team the share-link form: `…/fundadores.html?via=whatsapp` (also `email`, `linkedin`, `instagram`, `facebook`, `x`, `qr`).
