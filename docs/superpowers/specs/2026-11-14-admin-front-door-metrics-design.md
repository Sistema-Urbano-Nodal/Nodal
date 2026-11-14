# Admin front door and metrics: design

Date: 14 November 2026. Status: draft for the owner's approval, revised after a builder's read and three reviews.
Nothing is built yet. Companion for Flavia and Mariana, in Spanish, to review before the home is built (C8):
`docs/metrics/indicadores-nodal.es.md`.

## Intent

The team brief, verbatim:

> Joao identifica indicadores verificables sobre visitas, registros, perfiles, actividad y membresias; Flavia y
> Mariana revisan requerimientos. Priorizar un reporte exportable o panel administrativo sencillo. Entregable:
> reporte de metricas y mecanismo de seguimiento. Fecha propuesta sujeta a validacion.

NODAL has three staff screens that do not know about each other: the desk (`web/pages/admin.html`), the festival
organiser panel (`web/pages/fiiu-admin.html`) and the course teaching workspace (`web/pages/teaching.html`). The
last two have no link back to the desk and no sign-out. No screen shows how NODAL is doing as a whole, and nothing
counts visits. The owner does not want one more admin per event or per course: he wants **one admin area** whose
first page answers the brief.

Success: Flavia or Mariana open one address, see the brief's five families with numbers they can explain to someone
else, download or print them, come back next month and see what changed, and reach the three tools from the same
menu without anything in those tools having moved.

## Decided by the owner

- **D1. One front door.** A single admin area whose home is the metrics overview with export; the desk, festival
  and course tools are its sections. Not in scope: generic events or courses, rewriting the tools' internals, new
  roles or permissions.
- **D2. Shared menu and home.** `/admin.html`, `/fiiu-admin.html` and `/teaching.html` stay separate pages, each
  with the same four-item staff menu; a new page is the home. Rejected: the desk becomes the home with in-page
  sections.
- **D3. Visits: NODAL's own counter, shipped first.** A small same-origin script tells NODAL's server which page was
  opened and where the visitor came from. Only daily totals are stored; no cookie, no address, no visitor id. It
  counts page views and arrivals, not unique people. It needs new privacy text in three languages. It ships before
  the menu and the home, because nothing before its first day can be recovered.

Calls put to the owner and not corrected (treated as decided):

- **C1.** Menu: Indicadores, Publicación, Festival, Cursos on all four staff pages, with sign-out on each. The desk
  keeps its name "Mesa de publicación".
- **C2.** Activity = members who did something recorded, for 7 and 30 days, staff excluded. No per-member "last
  seen".
- **C3.** The password sign-in figure (`auth.users.last_sign_in_at`) is left out.
- **C4.** Memberships: Founder badges (`profiles.founder_since`) are the count; acceptances sit beside it, labelled
  as given before paying and not a payment.
- **C5.** Festival and course figures come from the tools' own summaries, so the home and the tool never disagree.
- **C6.** Any list value with fewer than 3 people is grouped as "otros" on screen, in the CSV and in print, on the
  server.
- **C7.** Tracking: one saved reading per Lima day when someone opens the home, with the month-by-month table from
  the first release. Cron or a monthly email is a later decision.
- **C8.** A Spanish indicator sheet goes to Flavia and Mariana before the build.

Everything else here is a call with its reason, listed again at the end.

## Goals

- From R1 on, every page view and arrival on public and member pages is counted as a daily total, with no personal
  data stored.
- Every staff page carries the same menu and a sign-out, and the three tools behave exactly as before.
- `/admin-home.html` shows the brief's five families plus festival and courses; each figure has a name, a
  definition and a line on what it does not tell.
- The same figures download as CSV and print as a PDF that explains itself to an outsider.
- One reading is saved per Lima day on which someone opens the home; a month-by-month table exists from day one.
- Every figure can be checked: its definition names its source; a read-only SQL file written apart from the
  functions reproduces every figure SQL can count; the festival panel gives the two that need the programme; the
  home must equal both on the same Lima day.

## Non-goals

No generic events or courses, no change to the tools' internals, no new role: the only gate stays
`profiles.app_role = 'admin'`, so everyone who can publish can read the metrics. No unique visitors, no per-person
visit history, no third-party analytics. No revenue figure (NODAL never sees the Mercado Pago payment). No
drill-down from a count to people and no members list. The full list is under "Out of scope".

## Anti-goals (a failure even if it works)

- **A misleading figure.** 210 presented as self-assessments (it is saved profile forms; self-assessments are 33).
  Acceptances read as memberships, "active" as "visited", visits as people, course opens as study.
- **A home that disagrees with a tool** on festival registrations or course enrolments.
- **A regression in tools that ran a live festival:** the desk going blank because an id moved, the festival panel
  losing its sticky offsets, the teaching header gaining a stray link.
- **Personal data leaking through small groups:** a country or a spelling that points at one or two people in a
  file that leaves the team.
- **A reading that lies later:** a partial reading saved as whole, or a zero stored for a part that was down.
- **A counter that costs trust:** a cookie, a stored address, a check-in code or sign-in token written to the
  database, or a failed count that breaks a page.

## Constraints from the codebase

House rules: zero runtime dependencies, no framework, no third-party script, strict CSP (no inline script or style),
DOM built with `createElement`/`textContent`, pages in EN/ES/PT, Supabase and SQLite kept in step, lint and about
2,235 tests on every deploy (with production env on Vercel), migrations applied by hand before the push
(`supabase db query --linked -f`, never `db push`), a new `?v=` for every changed CSS or JS file.

Traps, checked in the code unless a line says otherwise:

- `web/scripts/admin.js:107` returns silently if any looked-up element is missing. Tests pin the desk's tab list
  (`tests/founders-desk-ui.test.js:114-115`: every `<li><a href` in `admin.html`), the sign-out's place
  (`tests/catalog-ui.test.js:1139`) and its `?v=` keys: `admin.js` at `tests/deploy.test.js:332` and
  `tests/founders-desk-ui.test.js:133`; `admin.css` at `tests/founders-desk-ui.test.js:132` and
  `tests/node-requests-desk-ui.test.js:390`.
- `fiiu-admin.js` and `teaching.js` run on load and own their document; they cannot be mounted in another page.
- The public header on staff pages must stay as it is: `tests/fiiu-ui.test.js:939-946` requires the first
  `.nav-main` link on `fiiu-admin.html` to be `nav.program`. At 1080px and below that header folds its links behind
  the menu button (`web/styles/styles.css:805-807`); teaching has no such header (`web/pages/teaching.html:2-12`).
- `web/scripts/i18n.js` is 76,611 bytes against a cap of 80,000 (`tests/i18n-split.test.js:68`). `ops.*` strings
  live in `i18n-dashboard.js`, which `fiiu-admin.html` must not load (`:91-93`). A script with its own labels must
  not call `t('…')` (`tests/deploy.test.js:503-528`) or hold a quoted `d.`/`p.`/`y.`/`ops.` key
  (`tests/i18n-split.test.js:44-56`).
- A new script goes in the head, `defer`, never `async` (`tests/page-loading.test.js:21-35`) and in three lists:
  `server/server.js:69`, `scripts/build-static.js:13`, `vercel.json:40` (`tests/deploy.test.js:558-584`). A
  stylesheet: `server/server.js:78`, `scripts/build-static.js:49`, `vercel.json:48`. An id a script looks up must
  exist on a page that loads it (`tests/deploy.test.js:381-410`).
- `window.nodalI18n` exists only once `i18n.js` has run (`web/scripts/i18n.js:1117-1123`), so every existing
  subscriber loads after it (`tests/page-loading.test.js:40-42`, `tests/catalog-ui.test.js:1756-1758`). A page that
  loads `pilot.js` must have its banner directly after `</header>` (`tests/page-loading.test.js:99-108`);
  `teaching.html` is one.
- Both JSON body readers answer 415 unless Content-Type is `application/json` (`server/server.js:673`,
  `server/courses-api.js:59-60`); `sendBeacon` with a string sends `text/plain`. An `/api` path outside
  `SESSIONLESS_API` (`server/server.js:109`) costs a session lookup (`:1433`). Limiters are per-instance memory
  (`:260`). An answer of 500 or more goes to error reporting (`:2445`).
- The REST client waits 15 seconds by default (`server/supabase.js:179`); the festival and course stores overwrite
  any signal with their own 15 seconds (`server/fiiu-repository.js:85`, `server/courses-repository.js:164`). A
  table read through the Data API is cut at the project's row cap with no error (`server/fiiu-repository.js:86-93`).
- No migration reads or grants `auth.users` (foreign keys and one trigger only). Whether `service_role` may read
  it is set by Supabase outside the repo and was not checked: open question 5. The migrations give `service_role`
  SELECT on the public tables the report needs; the check file confirms production matches them.
- `onboarding_responses` gets a row on any console save, even "mark notifications read"
  (`web/scripts/dashboard.js:1552-1554`; only writer `server/supabase.js:770`, from `PATCH /api/me`,
  `server/server.js:2059-2066`). SQLite has no such table. The self-assessment is `raw_answers.assessed`
  (`server/supabase.js:778`; SQLite `users.assessed`, `server/db.js:68`). `profiles.created_at` is the first
  sign-in, not the sign-up (`server/supabase.js:731-750`); `profiles.updated_at` also moves on a staff Founder
  grant.
- The festival summary has one caller (`server/fiiu-api.js:295`), which must re-tag "social" items as "general" or
  the party disappears. The course summary is private to `createCourseApi` (`server/courses-api.js:213-238`);
  `perks` must stay its last parameter (`tests/course-perks.test.js:90-91`); `web/scripts/teaching.js:275-276`
  renders every key of `summary`, so none may be added. The workspace has a second summary, for the final survey
  (`total`, `answered`, `certificates`, `server/course-final-survey.js:305`), over a roster that leaves out
  administrators and people who joined from 1 October (`:200-207`, `server/course-perks.js:9`).
- `membership_acceptances` has no uniqueness per account: every accepted POST is a new row
  (`supabase/migrations/20261021000000_membership_acceptances.sql:14-26`, `server/server.js:1729-1750`).
- `tests/node-requests-store.test.js:240` and `tests/node-requests-api.test.js:522` (with `DEPLOYMENT.md:582-584`)
  pin `20261109000000_node_request_kinds.sql` as the newest migration.
- The privacy policy is a draft (`docs/privacy/privacy-policy.en.md:3`) with exactly 12 sections
  (`tests/privacy-page.test.js:19`), a page that must equal the generator's output (`:14`), and pinned phrases in
  sections 2 and 9. It says the basis for usage analysis must still be validated (`privacy-policy.en.md:43`).
- CI has four Postgres databases, one per suite, each required to be empty (`.github/workflows/ci.yml:58-61`,
  `:66-69`; `tests/fiiu-postgres.test.js:11-15`). Vercel's build skips Postgres suites.
- `scripts/seed-dev.js:15-68` seeds users, follows and interactions only. Montserrat is the only typeface.

## Approaches considered

Three designs were written against the code and judged by three reviewers (feasibility, fit to the brief,
privacy). **A, shared frame:** a new home page beside the tools; least regression risk, but a monthly record
only. **B, one page with sections:** the desk becomes the home; edits `admin.js` and rewrites about twenty pinned
assertions. **C, user first:** the brief's order and the sheet first, but one DEFINER function reading everything.

The owner picked the **shared menu and home** (D2): A's frame with C's home. B edits the one script that stops
silently on a missing id, for a result a menu also gives. Kept from B: per-part states, the real self-assessment
flag, an always-visible menu row, sign-out everywhere. From A: only a tiny function touches `auth.users`, the
panel's own summary, the tracking table in the first release, the `/admin` address. From C: the brief's order, one
calendar module, the server catalogue and CSV, the small-group rule, `visit.js` as its own file, the sheet.

## The design

Three releases, each shippable alone, each migration applied by hand before its code.

| | Ships | Migration | Touches the three tools |
|---|---|---|---|
| R1 | Visit counter | `<ts>_visit_counts.sql` | one script tag in each head |
| R2 | Staff menu, sign-out, desk draft prompt | none | one `<nav>` and two tags each; one listener in `admin.js` |
| R3 | Home, metrics API, CSV, print, daily readings | `<ts>_metrics.sql` | one more link in each `<nav>` |

### R1. Visit counter

**Script.** New `web/scripts/visit.js` (about 40 lines), `<script defer src="visit.js?v=…">`, last in the head:

1. On a page whose tag carries `data-staff`: sets `localStorage['nodal.staff']='1'` and sends nothing.
2. On `/login.html`: removes that marker, then goes on to step 3, so the sign-in page is counted like any other.
   Every sign-out lands there (`web/scripts/admin.js:1404`, `dashboard.js:1279`, `courses.js:118`,
   `fiiu-checkin.js:171`, `fiiu-talk.js:587`) and a signed-in browser never sees that page
   (`server/server.js:1483`), so the marker is cleared on sign-out without editing any handler.
3. Unless the marker is set or `navigator.webdriver` is true (a prerendering page waits for its
   `prerenderingchange` event, so it sends once when the visitor opens it, and never if nobody does):

```js
fetch('/api/visit',{method:'POST',keepalive:true,credentials:'omit',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({p,r,v})}).catch(()=>{})
```

`p` is `location.pathname`. `r` is `''` when `document.referrer` is empty, `'self'` when its host is this site,
otherwise the referrer's host name only. `v` is `new URLSearchParams(location.search).get('via')` or `''`. The
script reads nothing else from the address; a source test forbids `location.href`, `location.hash` and
`document.cookie` in the file. A consequence of step 2: after a sign-in, a team member's views (the sign-in page,
the console, anything else) are counted until that browser opens a staff page. The refresh cookie lasts 30 days,
so sign-ins are occasional; the catalogue and the sheet say it.

**Tag on (15 files):** index, login, fundadores, opportunities, community, resources, knowledge, fiiu,
fiiu-session and its twin fiiu-talk, dashboard, profile, payments, courses, course. **With `data-staff`:** admin,
fiiu-admin, teaching, fiiu-qr, and admin-home in R3. **Never:** reset-password and accept-invitation (tokens in
the address), fiiu-checkin (a code in the address; each scan is already a check-in), organisers-only (served under
staff addresses), privacy, terminos-fundadores.

**Route.** `POST /api/visit`, added to `SESSIONLESS_API`, in new `server/visits-api.js`, wired like node requests
(`server/server.js:1134`, `:1376`, `:1519`) and dispatched after `/api/readings` (`:1501`). In order: method (405,
`Allow: POST`); `sameOrigin`, plus, in this module only, an `Origin` header whose host equals `Host` and a
`Sec-Fetch-Site` that is absent or `same-origin` (403; a browser sends `Origin` on every POST `fetch`); its own
limiter, 600 a minute per address, the shared-Wi-Fi precedent at `:1321` (429); `bodyJson(req, 1024)`; the
allow-lists; a per-instance ceiling on accepted writes per minute (the `signupEmailCeiling` pattern, `:1171`);
one awaited store call with a 2-second timeout. The answer is 204, empty, `no-store`, when counted and when
ignored: a path outside the allow-list, a bot-like User-Agent, the ceiling reached, or the 60 seconds after a
store call failed, when none is made. A failure is logged once per instance, without the address. The route
never answers 5xx.

**Page allow-list.** An exact-match map from the pathname as sent to the stored page key (a file name), with no
decoding or folding. `/` and `/index.html` both map to `index.html`: one file serves both
(`server/server.js:1061`). The other 13 served addresses map to their file name. `/fiiu-talk.html` is not a key:
the server redirects it to `/fiiu-session.html` (`:1491`). So 15 tagged files give 14 page keys.

**What is counted.** Each accepted hit adds one **view** for its page. When `r` is not `'self'` it also adds one
**arrival** for its page and source. The server picks the source from eleven fixed categories: a valid `via`
(`whatsapp`, `email`, `linkedin`, `instagram`, `facebook`, `x`, `qr`, after trimming and lower-casing) wins; else
by referrer host (`search`, the six networks, `sistemaurbano`, `other`); else `direct`. An unknown or malformed
`via` is treated as absent: the hit still counts, with the source taken from the referrer. No raw host is stored.
`?via=` exists because WhatsApp and mail apps send no referrer: the team shares `…/fundadores.html?via=whatsapp`
and the arrival is attributed. Three cases count a view without an arrival, because the referrer they carry is
not a new arrival: a reload and a back/forward navigation (the script sends `r: 'self'` when the Navigation Timing
type is `reload` or `back_forward`; a browser without that API sends the referrer as usual), and a return from the
payment provider (the server treats `mercadopago.com`, `mercadopago.com.pe`, `mercadolibre.com` and
`mercadolibre.com.pe` and their subdomains like `'self'`). The bot pattern matches `bot` only as a word or a
crawler's name token (`Googlebot/`, `AhrefsBot;`, `TelegramBot (`), so a phone model such as `CUBOT X30` counts.

**Storage.** `supabase/migrations/<ts>_visit_counts.sql`, with the house header (apply and repair commands, what
fails until applied), wrapped in `BEGIN; … COMMIT;` so each object is created and closed to PUBLIC, anon and
authenticated in one transaction (as `supabase/migrations/20260929194059_fiiu_event_summary.sql`):

```sql
CREATE TABLE public.visit_counts (
 day date NOT NULL, kind text NOT NULL CHECK (kind IN ('view','arrival')),
 page text NOT NULL CHECK (char_length(page) BETWEEN 1 AND 80),
 source text NOT NULL CHECK (char_length(source) <= 20),            -- '' for a view
 n bigint NOT NULL CHECK (n > 0), PRIMARY KEY (day, kind, page, source));
-- RLS on, no policy. REVOKE ALL FROM PUBLIC, anon, authenticated, service_role. GRANT SELECT, INSERT, UPDATE TO service_role.
CREATE FUNCTION public.count_visit(p_hit jsonb) RETURNS void
 LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$ … $$;   -- {day, page, arrival, source}
CREATE FUNCTION public.visit_totals(p_range jsonb) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ … $$;     -- {from, to}
-- {"v":1,"days":[[day, views, arrivals], …],"pages":{page: views},"sources":{source: arrivals}}
-- Both functions: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role.
```

`count_visit` is one `INSERT … ON CONFLICT … DO UPDATE SET n = visit_counts.n + 1` for the view row and, when
`arrival` is true, the arrival row. The server computes the Lima day. The table cannot pass 14 pages × 12 keys a
day. `visit_totals` returns `days` for the whole table (one element per day inside one value, so no row cap
applies) and `pages` and `sources` for the range. `server/visits-repository.js` exports
`createVisitStore({db,env,clients,fetchImpl})` → `{kind, count(hit), totals(fromDay, toDay)}`. `totals` is one
`rpc/visit_totals` call and never a table read through the Data API, whose row cap would cut the sums with no
error. The two windows, the months and the first counted day are summed from `days` in
`server/metrics-domain.js` (R3). SQLite creates the table in the factory
(`server/node-requests-repository.js:44` pattern), runs the same upsert and returns the same shape.

Before the migration is applied the route answers 204 and counts nothing: harmless, but every day lost stays lost.
R1 has no screen; until R3 the owner reads the totals with the check file, and corrects a day a script inflated
with the correction file (both under "Ops files"). The privacy text ships with R1.

### R2. Staff menu

A separate bar, identical on every staff page, placed as the element just before `<main>`: directly after
`</header>` on the desk and the festival panel, and after the `.pilot-notice` element on teaching, whose banner
must stay next to its header (`tests/page-loading.test.js:99-108`). The public header is not touched.

```html
<nav class="staff-nav" data-staff-nav aria-label="Administration"><a href="admin.html" data-staff="desk">Publishing</a><a href="fiiu-admin.html" data-staff="festival">Festival</a><a href="teaching.html" data-staff="courses">Courses</a><button type="button" data-staff="signOut">Sign out</button><span role="status" aria-live="polite" data-staff-status></span></nav>
```

The page's own link carries `aria-current="page"`. No `<li>`, no `data-i18n`, no ids. R3 adds
`<a href="admin-home.html" data-staff="home">Metrics</a>` as the first link. In Spanish, on the desk:

```
[NODAL]  Programa  Comunidad  Recursos  Conocimiento             EN ES PT   Mi consola     ← public header, unchanged
Indicadores   Publicación   Festival   Cursos                               Cerrar sesión  ← staff bar (Indicadores from R3)
              ───────────
Mesa de publicación
```

- **`web/scripts/admin-nav.js`** (about 60 lines), `defer`, before `i18n.js`. Its own label table: ES Indicadores,
  Publicación, Festival, Cursos, Cerrar sesión, aria Administración; EN Metrics, Publishing, Festival, Courses, Sign
  out, Administration; PT Indicadores, Publicação, Festival, Cursos, Sair, Administração; plus "signing out" and
  "could not sign out" lines. It paints from `document.documentElement.lang` (`web/scripts/locale.js:65`) at
  evaluation and subscribes inside a `DOMContentLoaded` listener (`window.nodalI18n?.onChange(paint)`, once):
  deferred scripts all run before that event, so `nodalI18n` exists by then, while a subscription at evaluation
  would find it undefined. The script stays before `i18n.js` so the labels are written before `locale.js` reveals
  the page; it is the stated exception to "subscribers follow `i18n.js`" and is not added to the list at
  `tests/page-loading.test.js:41`. Sign-out copies `web/scripts/admin.js:1396-1409`:
  `POST /api/auth/logout` (`server/server.js:1969-1973`), then `/login.html`; it also removes the staff marker. No
  id lookup, no function named `t`.
- **`web/styles/admin-nav.css`**, linked last. Every rule under `.staff-nav`, self-contained (font, colour, button
  reset) because teaching loads no `styles.css`. Not sticky, so the offsets at `web/styles/admin.css:24` and
  `web/styles/fiiu.css:74` hold. It wraps on phones and never folds. The current link is marked by weight and a
  thin underline.
- **Desk sign-out.** `#adminSignOut` (`web/pages/admin.html:50`) stays in `.admin-head-side` with the `hidden`
  attribute: `admin.js:90` and the guard at `:107` need the element, and the bar now offers sign-out.
- **Desk draft prompt (M11).** One listener in `admin.js`, after `newsDirty` (`:917`) and before `bootstrap()`:
  `window.addEventListener?.('beforeunload', …)`, asking when `newsDirty()` is true. The optional call is needed:
  the desk test contexts have no `window.addEventListener` (`tests/catalog-ui.test.js:184-199`). The file must
  still end `bootstrap();` then `})();` (`:203-206`). It covers the news editor only.

Not changed in R2: `fiiu-admin.js`, `teaching.js`, `pilot.js`, `fiiu-qr.html`, the desk's tab row and its two
"away" links, every existing `?v=` except `admin.js`.

### R3. The home

**Page.** `web/pages/admin-home.html`, `<body class="admin-page" data-page="admin-home">`: the public header as on
the desk, the staff bar, `<main class="admin-shell">`. Head: `locale.css`, `locale.js` (not deferred), font
preload, `fonts.css`, `styles.css`, `admin.css`, `admin-home.css`, `admin-nav.css`; deferred `nav.js`,
`script.js`, `admin-nav.js`, `admin-home.js`, `i18n.js`, `visit.js` with `data-staff`. No `i18n-dashboard.js`.
`admin-home.js` paints and subscribes the way `admin-nav.js` does.
Registered in `PRIVATE_PAGES` (`server/server.js:67`), `STATIC_PAGES` (`:68`), the admin-only array (`:1475`),
`SERVER_PAGES` (`scripts/build-static.js:12`) and the no-store/noindex rule (`vercel.json:69`). Signed out: 302 to
sign-in. A member: the desk's JSON 403.

**Addresses.** `ADMIN_ALIASES = new Set(['/admin'])` beside `CHECKIN_ALIASES` (`server/server.js:73`) and one line
beside `:1490`: GET or HEAD of `/admin`, `/admin/` or `/ADMIN` answers 302 to `/admin-home.html`. The console's
side link (`web/pages/dashboard.html:72-74`) keeps `id="publishLink"` and key `d.nav.publish`; its `href` becomes
`admin-home.html` and its values (`web/scripts/i18n-dashboard.js:733`, `:1612`, `:2491`) become Administración /
Admin / Administração. `/admin.html`, `#nodes` and `#founders` keep working.

**Sketch**, in Spanish, with the figures of 14 November 2026 (`n` = filled by the baseline file before the sheet
goes out; visit figures exist from R1):

```
Indicadores   Publicación   Festival   Cursos                                              Cerrar sesión
Indicadores de NODAL                                 [Descargar CSV]  [Imprimir o guardar como PDF]
Datos al 14 nov 2026, 08:36 (hora de Lima) · Actualizar
Últimos 7 días: 8–14 nov · Últimos 30 días: 16 oct–14 nov · 19 días sin cuentas nuevas (última: 26 oct)

VISITAS            REGISTROS         PERFILES                ACTIVIDAD               MEMBRESÍAS
n llegadas, 30 d   525 cuentas       n con perfil básico     n miembros con          0 Fundadores
se cuenta desde    0 nuevas en 7 d   (ciudad e intereses)    actividad, 30 d         1 aceptación antes de
el <día de R1>     494 confirmadas   33 con autoevaluación   7 d: n                  pagar (no es un pago)

Por atender: 0 solicitudes de interés → · 0 solicitudes de organizaciones → · n postulaciones al laboratorio →

Visitas (desde el <día de R1>)      30 días  7 días      Registros                     Total  30 días  7 días
  Páginas vistas                       n        n          Cuentas                       525     n       0
  Llegadas                             n        n          Con correo confirmado         494
  Más vistas: Inicio n · FIIU n · …                        Entraron al menos una vez     486     n       n
  De dónde llegan: directo n · buscadores n · WhatsApp n · …        Por mes: jul 9 · ago 0 · sep 40 · oct 476 · nov 0
                                                           Incluye 5 cuentas del equipo
Perfiles (de 486 que entraron)       Total              Actividad                      30 días  7 días
  Perfil básico completo                n                 Miembros con actividad, sin el equipo  n     n
  Con ciudad                          210                   perfil n · red n · oportunidades n ·
  Con intereses                         n                   festival n · cursos n · membresía n
  Con biografía                        17                 Con el equipo:
  Autoevaluación hecha                 33                   Conexiones (seguir)    total 14   0        0
  Visibles en el directorio             n                   Solicitudes de interés total 0    0        0
  Perfil guardado (cualquier formulario) 210

Membresías                           Total  30 días     Festival · FIIU Fest 2026            Ver en Festival →
  Fundadores (insignias)                0      0          Inscripciones 375 (incluye 2 del equipo)
  Aceptaciones antes de pagar (veces)   1      1          Inscripciones a bloques n · Horas de asistencia n · Postulaciones al laboratorio n
  Personas que aceptaron                1                 Personas con asistencia registrada 62 · asistencias 90
  Aceptaciones sin insignia (personas)  1                 Tipo de perfil: profesional 82 · estudiante 76 ·
  Solicitudes de organizaciones         0                   organización 53 · función pública 39 · otro 34 ·
  Vistas: Fundadores n · página de pago n                   investigación 33 · academia 32 · emprendimiento 13 ·
                                                            activismo 12 · otros (menos de 3) 1
Cursos · Movilidad Nivel 2            Ver en Cursos →     País: Perú 333 o más · Lima 8 · Colombia 7 ·
  Con el equipo, como en el espacio docente:                México 4 · otros (menos de 3) n
    Participantes 21 · Formularios completos n · Accesos a módulos n · Accesos a materiales n ·
    Accesos a grabaciones n · Actividades n · Comentarios n
  Personas inscritas, sin el equipo: 18 · abrieron contenido n
  Encuesta final (grupo de septiembre): respondieron 9 de N · certificados subidos 17

Seguimiento                          nov 2026 (leído el 14)   dic 2026 …    una columna por mes
  Cuentas                               525
  Con ciudad                            210
  … unas 20 filas …                  Lecturas desde <mes de R3>.  [Descargar lecturas CSV]
```

Under each block a "Cómo se cuenta" `<details>` holds its definitions, sources and "no dice" lines. Rules of the
screen (M12): the five lead numbers stand on whitespace, not in cards; Montserrat with `tabular-nums`,
right-aligned; a hairline only under a table's header row; no thick left bars; spacing on the `--f-sp-*` scale;
body text never smaller than the desk's. A zero prints as `0` in muted ink; a figure that could not be computed
prints as a dash with its reason. No percentage change anywhere. Under 640px the tables stack.

**Catalogue.** `server/metrics-catalog.js` holds per indicator: key, family, order, name, definition, source and
"does not tell", in ES, EN and PT; the labels of the reserved list keys `_other` and `_none` and of the fixed
vocabularies (festival profile types, visit pages and sources, activity kinds); and one constant `DEFS`, bumped in
the same commit as any change to what an existing key counts (a new indicator gets a new key and no bump). The
seven course totals copy the workspace's own labels in three languages (`web/scripts/pilot-i18n.js:279`, with
`enrolled` shown as `participants`, as `teaching.js:276` does); a test compares the two files. The page, the CSV
and print use the same texts. `admin-home.js` holds only its own chrome strings as `[en, es, pt]` rows.

**Routes** (new `server/metrics-api.js`, node-requests pattern; `admin\/metrics(?:\/.*)?` added to `ID_ONLY_API`,
`server/server.js:135`). The path must not begin with `/api/admin/fiiu`, `/api/admin/courses` or
`/api/admin/feedback`, which other handlers claim (`server/fiiu-api.js:139`, `server/courses-api.js:244`).

| Route | Answer |
|---|---|
| `GET /api/admin/metrics` | 200 `{asOf, limaDay, defs, windows, families:[{key,indicators:[{key,state,total,d30,d7,items:[{key or text, n}],last,daysSince,team}]}], courseNames, texts:{es,en,pt}, lead, tracked, months, readings, pending, visitsSince, unavailable:[…], notActivated:[…]}`; `texts` gives, per language, the name, definition, source and caveat of every indicator and the label of every family and list key; an indicator's `state` is absent when its figure was computed, else `not_activated`, `unavailable` or `not_yet_counted`, and then it carries no figure; `last` and `daysSince` (the latest sign-up day and the Lima days since) come only with "Cuentas nuevas", `team` (the team's registrations) only with the festival's "Inscripciones"; `visitsSince` is the first counted Lima day, or `null` while the visit table is empty; `courseNames` maps each course id to its stored title, for the course lists; `lead` and `tracked` are the catalogue's lead row and "Seguimiento" rows as keys, attached with `texts` after the memo, so `admin-home.js` holds no copy of them; `?fresh=1` skips the memo |
| `GET /api/admin/metrics/export?table=indicators\|months\|readings&lang=es\|en\|pt` | `text/csv` through `csv()` (`server/courses-domain.js:153`) and `send()`; attachment `nodal-indicadores-YYYY-MM-DD.csv` (`-por-mes`, `-lecturas`); a missing or unknown `table` or `lang` answers 400 |
| `POST /api/admin/metrics/readings` | saves today's reading if none exists and the answer is complete; the body is ignored and the figures are the server's own, from the memo or the shared in-flight computation; 200 `{saved, day}`; `sameOrigin` required |

All three: 401 signed out, 403 not admin (the wording of `requireAdmin`, `server/server.js:851`), 405, 429. Their
own `createWindowRateLimiter`: 60 a minute per account; 6 a minute for `fresh=1` and the POST. Not in
`LOGGED_DOWNLOADS` (`:388`): totals only. With no database (`useDb` false, `:1144`) the API answers 404 and the
page says the indicators are not available in this installation.

**Languages.** The GET takes no `lang`: the three languages travel in one answer. `admin-home.js` renders from
`document.documentElement.lang` and, on a language change, re-renders from the answer it holds with no request,
so the numbers cannot move and the reading is not re-sent. The export joins the same texts for its one language.

**Computation.** Six parts, in parallel, each able to fail alone:

| Part | Supabase | SQLite twin |
|---|---|---|
| `accounts` | `rpc/metrics_account_days` (DEFINER, `auth.users`) | `users.created_at`; confirmed = created |
| `members` | `rpc/metrics_member_days` (INVOKER, public tables) | hand-written; reports 0 for an absent table (`sqlite_master`) |
| `festival` | `festivalSummary()`, the panel's own | same |
| `courses` | `courseSummary()` and `finalSurveyCounts()` per course, the workspace's own | same |
| `visits` | `visitStore.totals()` | same |
| `readings` | `metrics_readings` | same |

Each part has one deadline of 6 seconds for the whole part (festival is two calls in a row); a part that loses is
unavailable with reason `timeout`, so the answer leaves in about 7 seconds. `accounts`, `members`, `readings` and
`visits` pass a real `signal` to `rest`. `festival` and `courses` are raced against a `setTimeout` cleared in
`finally` (precedent `server/error-report.js:103-106`): their stores overwrite any signal and are not changed.

In `supabase/migrations/<ts>_metrics.sql`:

```sql
CREATE FUNCTION public.metrics_account_days() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ … $$;
-- auth.users only. {"v":1,"days":[[lima_day, created, confirmed], …]}: counts per day, nothing else.
CREATE FUNCTION public.metrics_member_days(p_today date) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ … $$;
-- {"v":1,"days":{…},"now":{…},"active":{"d7":{…},"d30":{…}},"lists":{…}}
-- Both: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role
-- (as supabase/migrations/20260929194059_fiiu_event_summary.sql:96-97). Every object schema-qualified.
CREATE TABLE public.metrics_readings (day date PRIMARY KEY, taken_at timestamptz NOT NULL,
 defs smallint NOT NULL, figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'object'));
-- RLS on, no policy. REVOKE ALL FROM PUBLIC, anon, authenticated, service_role. GRANT SELECT, INSERT TO service_role.
-- The whole file is one BEGIN; … COMMIT; as in R1.
```

- `days`: counts per Lima day for each dated source: first entries (`profiles.created_at`), first profile saves,
  follows, interest requests, festival registrations, acceptances, Founder badges, organisation requests.
- `now`: current-state counts: the profile rows of the catalogue, admin accounts, non-admin learners and openers,
  distinct accepting accounts, pending queues. Survey and certificate counts are not here: they come from the
  workspace's own summary.
- `active`: distinct members overall and per kind for the two windows, computed inside the function: 7 days is
  Lima days `p_today − 6 … p_today`, 30 days is `p_today − 29 … p_today`, each starting at 05:00:00 UTC.
- `lists`: the festival country answers grouped by trimmed text. It is the only free text that leaves the
  database; `metrics-domain.js` decides how much of it is shown.

Each function takes at most one argument (`stateFor` in `tests/review-fix-4-grants.test.js:14-18` splits on commas
and cannot see a grant on a function with two) and returns `jsonb`, not `RETURNS TABLE` (the row cap, as for
`visit_totals`). Day bucket: Postgres `((ts AT TIME ZONE 'UTC') - interval '5 hours')::date`, SQLite
`date(ts,'-5 hours')`; Lima is UTC−5 all year. Course dates are 24-character ISO text in both stores and are
compared as strings, never cast.

`server/metrics-domain.js` is one pure module with `now` injected: the Lima day; sums of the per-day series into 7
days, 30 days and Lima months, with zero months filled only for a series that was read (a missing series stays
missing, never zeros); country folding, labelling and the character check; the small-group rule; the flat
`figures` map; and the validator (the `v` field plus required keys, extra keys ignored, so a later `CREATE OR
REPLACE` can be applied before its code). It holds no display words: a list item is `{key, n}` or, for a typed
country, `{text, n}`. `server/metrics-repository.js` exports `createMetricsStore({db,env,clients,fetchImpl})` →
`{kind, accountDays(), memberDays(today), saveReading(day, at, figures, defs), readings()}`, built last in
`createApp` so the other stores' SQLite tables exist. `saveReading` is first-write-wins (`Prefer:
resolution=ignore-duplicates`, precedent `server/supabase.js:741`; SQLite `INSERT OR IGNORE`).

**Reusing the tools' summaries (C5).**

- New `server/fiiu-summary.js`: `summaryCatalogue(event)` (programme plus legacy activities, "social" re-tagged),
  `festivalSummary({store, programme}) → {event, summary}`, `festivalHours(summary, event)` (Σ attendance ×
  minutes / 60 over check-in blocks). `server/fiiu-api.js:295` becomes `(await
  festivalSummary({store,programme})).summary`, output unchanged (`tests/fiiu.test.js:336-358`). `attendedPeople`,
  `qrPeople` and `lastCheckInAt` are optional (`server/fiiu-repository.js:110-111`).
- `server/courses-api.js` exports `COURSE_SUMMARY_KEYS` and `courseSummary(store, courseId)`; `report()` calls it
  and keeps its own feedback count (`tests/review-fix-3-courses.test.js:162` keeps passing). No parameter is added
  to `createCourseApi`, no key to `summary`.
- `server/course-final-survey.js` gains a module-level export `finalSurveyCounts({store, courseId, perks =
  createCoursePerks()}) → {total, answered, started, certificates}`, and the status route (`:305`) calls it, so
  there is one definition. The pager and `membersForRows` move to module level or are passed in (both need only
  `store`). Only the four counts cross into the metrics module: the roster holds names, emails and answers.
- `createMetricsApi({store, visitStore, fiiuStore, fiiuProgramme, courseStore, …})` is built in `createApp` beside
  `server/server.js:1355` and dispatched beside `:1519`.

**States.** The answer is 200 once the caller is known to be an admin and inside the limit; nothing a part throws
reaches the global handler (`:2437`).

| Case | Recognised by | The home shows | The CSV holds |
|---|---|---|---|
| Not activated | `PGRST202`, `42883`, `PGRST205`, `42P01` | "Aún no está activado en la base de datos" in that block; the others filled | that text; `state` = `not_activated` |
| Unavailable | status 503 or 5xx, 429, `upstream` set (`server/supabase.js:139-142`), a null store (`server/server.js:1099-1100`), the part's deadline, or any other thrown error (plus one error report) | a dash and "No disponible en este momento" | that text; `unavailable` |
| Refused | `42501` | as unavailable, plus one error report per instance and part | as unavailable |
| Visits before their first day | a window or month before `visitsSince` | "Se cuenta desde el <día>" (`visitsSince`), never a zero | that text; `not_yet_counted` |
| No visit counted yet | the visit table has no rows: `visitsSince` is `null` | "Aún no hay visitas contadas" (the fourth state text, `no_visits_yet`), never a zero and never "Se cuenta desde el" without a day | that text; `state` stays `not_yet_counted` |
| The whole answer failed | a non-200 or non-JSON answer, a network error, 401 after expiry, 429, 503 from the session lookup | one message and a retry control (the plain GET, disabled while a request is in flight); for 401 a link to sign-in. The bar is static HTML and stays usable | no file; the page reports it |

**Memo.** A per-instance promise memo of 5 minutes, copied from `server/fiiu-programme.js:29-39` (not
`server/cache.js`). Concurrent requests share one in-flight computation. It holds language-neutral data only. A
result with anything unavailable or not activated is kept for 30 seconds and is never saved as a reading. The
page always prints the time of calculation.

**Daily reading (C7).** `admin-home.js` sends `POST /api/admin/metrics/readings` only when it has rendered a
complete answer and the GET's `readings` has no row for `limaDay`; a failure of this POST is silent and retried
on the next load. If today's Lima day has no row, the server stores `DEFS` and the `figures` map: every scalar of
the catalogue except the visit figures (total, 30 days and 7 days where they exist, the six activity kinds for
both windows, the course and survey counts), about 60 integers, the lead numbers of registros, perfiles,
actividad and membresías among them. The four lists stay out (no free text or small group in a table kept
without a time limit), and so do visit figures, which are always summed again from `visit_counts`, so a corrected
day touches no reading. "Complete" means every part of a fixed `READING_PARTS` list answered; a partial answer
is never stored, and while today has no reading "Seguimiento" says "La lectura de hoy aún no se guardó: <parte>
no disponible. Se guardará al abrir esta página con todos los datos." "Seguimiento" shows about 20 of the keys
(accounts, the profile rows, active members, connections, Founders, acceptances, festival and course totals), one
column per Lima month that has a reading, holding that month's latest reading and headed with its date; a month
read under an older `DEFS` carries the footnote "leído con definiciones anteriores". Dated series (accounts,
first entries, festival registrations, and visits from R1) are also shown per month back to July 2026, so the
page is not empty on day one. A reading is never edited: it stays under its `DEFS`, or the owner deletes its day.

**Export and print (M6).** "Descargar CSV" fetches the file as a blob, so an expired session or a 429 is reported
on the page. `indicators`: one row per indicator and one per list item; columns key, state, family, indicator,
total, 30 days, 7 days, definition, source, what it does not tell, read at (Lima); headers and texts in the chosen
language; `key` and `state` stable. A row whose part is not `ok` carries the state text of the table above, in
words (`csv()` prefixes a leading hyphen), in each numeric cell it normally fills, never `''` or `0`; its list
rows are absent. `months`: one row per Lima month, one column per dated series; a failed series carries the state
text in every cell. `readings`: one row per saved day, with `defs`; if that table cannot be read the route
answers 503, never a headers-only file. "Imprimir o guardar como PDF" calls `window.print()`; `admin-home.js`
opens every definition block on `beforeprint` and restores it on `afterprint`, because a stylesheet cannot open a
closed `<details>` in every browser. `@media print` in `admin-home.css` hides the header, the bar, the buttons and
"Por atender"; the page starts with "NODAL · Reporte de indicadores", the Lima date and time and both periods.

**Local preview (M13).** `scripts/seed-dev.js` builds the festival and course stores and adds registrations,
check-ins, enrolments, course events, one acceptance, one Founder badge, bios and visit rows, and back-dates some
accounts by direct UPDATE (`createUser`, `server/db.js:424`, takes no date).

## Indicator catalogue

"Parity" = whether SQLite gives the same answer as Postgres on the same data. "14 Nov" is the dated reference, from
count-only queries. `n` = not queried on 14 November: the owner runs `docs/ops/2026-11-14-metrics-baseline.sql`
once before the sheet goes out (it does not gate R1), and its values replace each `n` here and each "por
confirmar" in the sheet. The month values and "last 26 Oct" came with no stated time zone; the baseline gives them
as Lima days and they are corrected here if they differ.

| Family | Nombre | Exact definition | Source | Parity | Does not tell | 14 Nov |
|---|---|---|---|---|---|---|
| Visitas | Páginas vistas | Σ `n`, kind `view`, in the window (7 and 30 Lima days; by month) | `visit_counts` | same | People. Reloads count; blocked scripts are missed. Flagged staff browsers are left out, but after a sign-in the team's views count until a staff page is opened. Not protected against a script that inflates a day | from R1 |
| Visitas | Llegadas | Σ `n`, kind `arrival`: a view whose referrer is empty or another site | `visit_counts` | same | People: one person on two days is two arrivals | from R1 |
| Visitas | Páginas más vistas | The ten pages with most views in 30 days | `visit_counts` | same | What was read | from R1 |
| Visitas | De dónde llegan | Arrivals in 30 days by the eleven sources | `visit_counts.source` | same | The exact site. WhatsApp and mail read "directo" without `?via=` | from R1 |
| Registros | Cuentas | Rows in `auth.users`, the team's and any non-active account included (all 486 profiles are active today) | `metrics_account_days` | same (`users`) | People who came in. A deleted account leaves the total | 525 |
| Registros | Con correo confirmado | `email_confirmed_at` not null | `auth.users` | SQLite = Cuentas | Use | 494 |
| Registros | Entraron al menos una vez | Rows in `profiles` (written at the first session); new by `created_at` in 7 and 30 days | `profiles` | SQLite = Cuentas | That they came back | 486 · windows n (39 accounts have not entered yet) |
| Registros | Cuentas nuevas | `auth.users.created_at` in 7 and 30 days, and by Lima month; latest day and days since | `auth.users` | same | Why they joined | 7 d: 0 · Jul 9, Sep 40, Oct 476, Nov 0 · last 26 Oct |
| Registros | Cuentas del equipo | `profiles.app_role = 'admin'` | `profiles` / `users.role` | same | — | 5 |
| Perfiles | Perfil básico completo | City not blank AND at least one interest: two of the four things the first-run dialog demands (it also requires a name and a role, `web/scripts/dashboard.js:1210`) | `profiles`, `onboarding_responses` / `users` | same | Quality | n (210 expected, to confirm) |
| Perfiles | Con ciudad | `btrim(coalesce(city_region,'')) <> ''` / `trim(city) <> ''` | `profiles` / `users` | same | That the city is placed on the map | 210 |
| Perfiles | Con intereses | `cardinality(interests) > 0` / `json_array_length(interests_json) > 0` | `onboarding_responses` / `users` | same | — | n (the earlier 210 may have counted non-null; re-run) |
| Perfiles | Con biografía | Trimmed `profiles.bio`, else `raw_answers.partC.bio`, not empty / `part_c_json.bio` | both | same | — | 17 |
| Perfiles | Autoevaluación hecha | `raw_answers->'assessed' = 'true'::jsonb` / `users.assessed = 1` | `onboarding_responses` / `users` | same | When (no date). That it was finished: set on the first answer | 33 |
| Perfiles | Visibles en el directorio | Account active AND consent true (`server/supabase.js:302`, `:1205`; `server/db.js:360-361`) | `profile_preferences` / `part_c_json` | same | That anyone looked | n |
| Perfiles | Perfil guardado | Rows in `onboarding_responses`; first saves by Lima month | `onboarding_responses` | **production only**; twin 0 | Any saved console form, even "mark notifications read". Never a self-assessment | 210 |
| Actividad | Miembros con actividad, 30 y 7 días | Distinct non-admin accounts with at least one member-made row in the window (list below) | `metrics_member_days.active` | same, except the profile kind | Visits or reading. Undercounts: unlikes, deleted feedback, cancelled registrations, deleted accounts | n |
| Actividad | Actividad por tipo | The same per kind: perfil, red, oportunidades, festival, cursos, membresía | same | same, except perfil | A sum: the kinds overlap | n |
| Actividad | Conexiones (seguir) | Rows in `member_follows`, the team's included and labelled so; new in the window | `member_follows` / `follows` | same | — | 14 · 30 d: 0 |
| Actividad | Solicitudes de interés | Rows in `catalog_interests` not withdrawn, the team's included; `new` feeds "Por atender" | `catalog_interests` | same | — | 0 |
| Membresías | Fundadores (insignias) | `profiles.founder_since` not null; new by that date | `profiles` / `users` | same | A payment record: the team gives the badge by hand after checking Mercado Pago | 0 |
| Membresías | Aceptaciones antes de pagar (veces) · Personas que aceptaron | Rows in `membership_acceptances`, new by `accepted_at`: one person who starts the payment twice is two rows. Beside it, the distinct accepting accounts plus acceptances whose account is gone | same name | same | A payment or a membership | 1 · 30 d: 1 · personas 1 |
| Membresías | Aceptaciones sin insignia | Distinct accepting accounts with no `founder_since`, plus acceptances whose account is gone | join | same | Whether they paid | 1 |
| Membresías | Solicitudes de organizaciones | Rows in `node_requests`, one total; status `new` feeds "Por atender". No split by kind or status on the home | `node_requests` | same | Closed ones are purged after 12 months | 0 |
| Membresías | Vistas de Fundadores y de la página de pago | Views of `/fundadores.html` and `/payments.html`, 30 days | `visit_counts` | same | People | from R1 |
| Festival | Inscripciones | `totalRegistrations`; by Lima month from `fiiu_registrations.created_at` (the sum must match) | `festivalSummary`; `member_days` | same | Attendance | 375 (2 by admins) |
| Festival | Inscripciones a bloques | Σ `activities[].registrations` (conference ticks, laboratory applications, the party); external interests apart | `festivalSummary` | same | People: one person counts once per block | n (from the panel) |
| Festival | Personas con asistencia registrada | `attendedPeople`, with `qrPeople` | `festivalSummary` | same | Full attendance: door check-in was partial | 62 (62 by QR) |
| Festival | Asistencias registradas | Σ `activities[].attendance` | `festivalSummary` | same | — | 90 |
| Festival | Horas de asistencia · Postulaciones al laboratorio | `festivalHours`; laboratory applications as one total, `lab.pending` for "Por atender"; accepted and declined stay on the panel | `server/fiiu-summary.js` | same | Time really spent | n (from the panel) |
| Festival | Tipo de perfil | `profiles[]` by key; the empty answer is `_none`; small-group rule | `festivalSummary` | same | — | 82 · 76 · 53 · 39 · 34 · 33 · 32 · 13 · 12 · `_other` 1 (the one empty answer) |
| Festival | País (respuesta de inscripción) | The required country answer, trimmed, case and accents folded, merged. A group is labelled with its most frequent original spelling (ties: the first in alphabetical order), first letter upper-cased with the `es` locale. Empty answers (door walk-ins, `server/fiiu-api.js:82`) are `_none`. An answer longer than 40 characters or holding anything but letters, spaces, hyphens, apostrophes and periods joins `_other`. Small-group rule | `fiiu_registrations.answers.country` | same (folded in JS) | Members who did not register. Free text: "Lima" stays "Lima", it is not turned into Peru | Perú ≥ 333 · Lima 8 · Colombia 7 · México 4 · `_other` n; the groups sum to 375 |
| Cursos | Totales del curso | The workspace's seven totals per course, unchanged and under the workspace's names, labelled "con el equipo" | `courseSummary` | same | Study: an access is one row per person, item and hour. "Actividades" are submissions posted in the course, not the Actividad family | Participantes 21 · the other six n; check: the three access counts over all courses sum to 767 (rows in `course_events`) |
| Cursos | Personas inscritas, sin el equipo | Distinct non-admin `user_id` in `course_enrollments` | `member_days.now` | same | Participation | 18 (21 − 3) |
| Cursos | Abrieron contenido | Distinct non-admin `user_id` in `course_events` | same | same | Reading or watching | n (21 with the team) |
| Cursos | Encuesta final · Certificados | `answered` of `total`, and `certificates`, as the workspace prints them: the September group without administrators | `finalSurveyCounts` | same | Downloads. `total` leaves out people who joined from October, so it can be below 18 | 9 de N · 17; N from the baseline (17 or 18) |

**What counts as activity (C2).** `user_id` not null, the account's current role not admin, and one of these in
the window:

- **Perfil:** `onboarding_responses.created_at` or `updated_at`; `pilot_feedback.created_at` with action
  `profile`. Labelled "guardó su perfil o marcó avisos como leídos": the two cannot be told apart. SQLite uses
  `users.updated_at`, documented as approximate (it also moves on a staff Founder grant, `server/db.js:921`).
- **Red:** `member_follows.created_at`; `member_interactions.created_at` with type `skip`; `pilot_feedback` with
  action `matching`.
- **Oportunidades:** `catalog_interests.created_at`; `updated_at` only where `updated_by = user_id`.
- **Festival:** `fiiu_registrations.created_at`; `fiiu_attendance.created_at` with method `qr`;
  `fiiu_messages.created_at` with `organiser` false; `fiiu_message_likes.created_at`; `fiiu_ratings.created_at`
  or `updated_at`.
- **Cursos:** `course_events.created_at` ("abrió"); `course_posts.created_at` with `staff` false, deleted ones
  included; `course_survey_responses.created_at` or `submitted_at`; the remaining `pilot_feedback`.
- **Membresía:** `membership_acceptances.accepted_at`.

Left out on purpose: `fiiu_registrations.updated_at` (moves on staff review: 264 rows in 30 days), attendance with
method `staff`, `follow` interactions (trigger copies), catalog updates by staff, `profiles.updated_at`,
`course_enrollments` (staff can add people, `server/course-participants.js:19`), certificates.

## Privacy and security

**Not collected, on purpose:** no cookie; no address stored (the limiter holds it in memory for up to a minute, as
on every route); no visitor or account id on a visit; no raw referrer host; no query string or fragment; nothing
from token pages; no per-member day log; no password sign-in dates.

**Small-group rule (C6).** In `server/metrics-domain.js`, before the memo, the API, the CSV and print. It covers
lists that split people by something they answered: festival country and festival profile type. A value with
fewer than 3 people, an empty answer (`_none`) with fewer than 3 and a country answer that fails the character
check merge into the reserved key `_other`. Its label ("otros (menos de 3)" and its EN and PT forms) is added per
language after the memo, so it cannot be confused with the festival's own answer `other` ("otro") or a typed
"otros". `_other` may itself hold 1 or 2: it names no value. Scalar indicators and the six activity kinds are
plain counts and are not grouped; the laboratory and organisation-request splits are not shown on the home.

**Grants and access.** All four functions: EXECUTE for `service_role` only. `metrics_account_days` is the only
function that reads the `auth` schema and the second non-trigger SECURITY DEFINER function, after
`apply_stripe_event()` of the retired Stripe path (`supabase/migrations/20260710000000_security_hardening.sql:60-75`);
empty search path, counts only. Both tables: RLS on, no policy, no browser grants. No grant is added on
`profiles`, `profile_preferences` or `onboarding_responses` (`tests/deploy.test.js:226-243`). The page and its
routes are admin-only. No GET changes state. `POST /api/visit` is the one unauthenticated write. The allow-lists
bound the table's size; the per-address limit, the ceiling and the pause bound database load per instance
(`docs/architecture.md:57`); the `Origin` check stops only scripts that send no headers (`sameOrigin` alone
passes them, `server/server.js:657-665`). None of these bounds the count: one address under the limit could add
864,000 views in a day. The worst abuse is an inflated visit figure, seen as a spike in the check file and
corrected by hand with the correction file. CSP unchanged.

**Policy text.** In `docs/privacy/privacy-policy.en.md` and its `.es.md` and `.pt-BR.md` twins, sentence for
sentence; then `node scripts/build-privacy-page.js`, the date (`scripts/build-privacy-page.js:9`, `:20`, `:31`),
`docs/privacy/implementation-review.md` (`:19`, `:69-79`, section 1) and `docs/architecture.md:108`. No new
section; no bold, link or `|` inside a table row; every pinned phrase stays contiguous. The policy stays a draft.

With R1 (nothing here speaks of saved readings or reports, which do not exist until R3):

- Section 2, new row after "Usage and connections" (`:32`): "Visit counts | When a NODAL page opens, a small script
  from NODAL itself tells our server which page was opened and the name of the site you came from, which our
  server reduces at once to a kind of source (a search engine, a social network, a link the team shared, or
  directly) and does not store. We add one to that day's total for the page and for that kind of source. We store
  only these daily totals: no cookie, no IP address, no visitor or account identifier. They count page openings
  and arrivals, not people, cannot be linked to you, and so are not part of an account export or deletion.
  Password-reset, invitation and staff pages are not counted."
- `:33`, add: "Our server uses the IP address of a request briefly to limit abuse and does not save it with visit
  counts."
- `:43`, add: "Visit counts are part of that usage analysis."
- Section 8 (`:86`), add: "Visit counting uses no cookie. On browsers used to open NODAL's staff pages, a marker is
  saved in browser storage so the team's own visits are not counted; it has no expiry, stays in that browser and
  is removed when the sign-in page is opened there." The marker joins the storage table of
  `implementation-review.md` (`:69-79`) with that lifetime.
- Section 9 (`:94`): append "daily visit totals" after "usage events,", leaving the pinned phrase contiguous
  (`tests/privacy-page.test.js:256`); new paragraph: "Daily visit totals contain no personal data and are kept
  without a time limit." This is the default of open question 1.

With R3:

- `:32`, one more sentence: "We also count, as totals only, the records described in this table (accounts,
  profiles and self-assessment, festival registrations, check-ins and conversations, courses, surveys and
  certificates, feedback, interest requests, Founder Membership acceptances and badges, and organisation requests)
  to see how the network is used; section 4 says who sees those totals."
- `:21`, after "Only you and administrators can access these answers": "Totals by country and attendee profile may
  appear in reports, as section 4 describes."
- `:31`, after the "used only" sentence: "We also count how many requests arrive; that count contains none of the
  details you wrote." Row `:29` needs no change. The notice on the form itself (`web/pages/index.html:538`) is
  left as it is.
- `:43` becomes "Visit counts and reports of totals are part of that usage analysis." Section 9 gains "and saved
  daily totals" in its list and "and the totals the team saves at most once a day to compare months" in its new
  paragraph.
- Section 4, new bullet: "Reports of totals: the team prepares reports made only of totals (accounts per month,
  festival registrations by country and attendee profile, visits per page) and may share them outside the team.
  They contain no names, emails or individual answers. Where a report lists people by an answer they gave
  (country, attendee profile), answers given by fewer than three people are shown together as “other”. Other
  figures are plain counts and can be small, including one or two." If the owner answers that reports stay
  inside the team (open question 6), "and may share them outside the team" is dropped and nothing stronger is
  promised.

## Tests

**New.**

- R1: `tests/visits-store.test.js` (SQLite upsert; `totals()` makes exactly one POST to `rpc/visit_totals` and no
  GET on `visit_counts`; the twin returns the function's shape and sums; migration text; grants through
  `stateFor`); `tests/visits-api.test.js` (405, 403 with no `Origin`, 429, 415, query never stored, 204 when the
  store throws or the table is missing, the pause, the ceiling, never 5xx, no session lookup; `/` and
  `/index.html` add to one `index.html` row; `/fiiu-session.html` counts; `/fiiu-talk.html`, `/admin.html`,
  `/index.html/`, `/Index.html` and `/index.html?x=1` answer 204 and store nothing; an unknown `via` still
  counts); `tests/visit-script.test.js` (three modes in a vm, the sign-in page clears then counts; forbidden
  source words; the tag on exactly the listed pages); a three-language policy test.
- R1: `tests/metrics-postgres.test.js` on `NODAL_METRICS_TEST_DATABASE_URL` / `nodal_metrics_test_ci`: applies
  every migration over `auth` and `storage` stubs with default privileges granted first; checks atomic
  increments, the sums of `visit_totals`, and that anon and authenticated can execute neither function. Extended
  in R3.
- R1: one assertion computed from `readdir` that `DEPLOYMENT.md` names the newest migration. It replaces both
  "newest" pins for good.
- R2: `tests/admin-nav.test.js`: the bar is identical on every staff page but for `aria-current` and is the
  element just before `<main>`; no `<li>`, `data-i18n` or id; the real `i18n.js` runs after the script in one vm
  context (precedent `tests/catalog-ui.test.js:160-173`), the test fires the captured `DOMContentLoaded`
  listener, calls `nodalI18n.apply('pt')` and sees the labels change; no `ops.` literal, no `t(`; sign-out POSTs
  and clears the marker; `admin-nav.js` precedes `i18n.js`; `fiiu-qr.html` has no bar. A stylesheet registration
  test modelled on `tests/deploy.test.js:603-613`. A desk test that the prompt asks only when news is dirty.
- R3: `tests/metrics-domain.test.js` (either side of 05:00:00Z, month ends, sums, country folding, labels and
  character check, small groups, a profile `other` of 3 or more stays apart from `_other`, a missing series is
  not zero-filled, a partial reading refused); `tests/metrics-store.test.js` (twin on seeded rows, saves made
  through `updateUserProfile` and never `PATCH {}`, absent table = 0, key parity with the SQL, error mapping,
  grants); `tests/metrics-api.test.js` through `createApp` (401, 403, shape with three languages and no display
  word in the memoised data, 429, memo, shared in-flight, a partial result kept 30 seconds and never saved, a
  part that never resolves gives 200 inside the deadline, a bare `TimeoutError` from the course store is
  unavailable, first reading wins, the POST ignores its body, `defs` saved, CSV bytes, formula guard and state
  cells, no `0` in a failed `months` series, `readings` 503 with its table down, `/admin` → 302 and the
  signed-out second hop, page gate, no-database 404); `tests/admin-home-ui.test.js` (three languages, a language
  change re-renders without a fetch, each state and the whole-answer failure, the POST only when today has no
  reading, `beforeprint` opens the definitions, ids exist, no left border of 3px or more); the catalogue's seven
  course labels equal `pilot-i18n.js`; the policy test covers the R3 sentences. In the Postgres file:
  `service_role` can call the definer; anon and authenticated can call none of the functions; twin equality on
  one fixture. Its `auth` stub says nothing about production's grants (open question 5).
- R3 agreement tests: festival totals equal `/api/admin/fiiu/summary`; `festivalHours` equals the browser's rule
  (`web/scripts/fiiu-ui.js:362`); enrolled − staff enrolments = learners; survey `total`, `answered` and
  `certificates` equal `GET /api/admin/courses/:id/final-survey` on a fixture with one staff enrolment and one
  enrolment from October 2026; Σ registrations by month = `totalRegistrations`.

**Existing tests and files that must change.**

| | Where | Change |
|---|---|---|
| R1 | `tests/node-requests-store.test.js:240`; `tests/node-requests-api.test.js:522` with `DEPLOYMENT.md:582-584` | drop "newest" (moved to the readdir assertion) |
| R1 | `tests/fundadores-page.test.js:318` | the fifth script tag |
| R1 | `tests/fiiu-talk-ui.test.js:1607` | holds only if `fiiu-session.html` and `fiiu-talk.html` get the same tag |
| R1 | `tests/deploy.test.js:319-347` | a `visit.js` key on each page that loads it |
| R1 | `tests/privacy-page.test.js` | regenerate the page; three-language assertions |
| R1 | `.github/workflows/ci.yml` after `:61` and `:69`; `README.md:48-62` | the fifth database and its variable |
| R2 | `tests/deploy.test.js:332`, `:335`, `:338`; `tests/founders-desk-ui.test.js:133` | `admin-nav.js` and `admin-nav.css` keys; the new `admin.js` key (pinned at `deploy:332` and `founders-desk-ui:133` only). `tests/node-requests-desk-ui.test.js:390` and `tests/founders-desk-ui.test.js:132` pin `admin.css?v=20261109a`, which R2 does not change: they stay as they are |
| R3 | `tests/deploy.test.js:641`, `:319` | the gate array gains `/admin-home.html`; page list and key map |
| R3 | `tests/dashboard-publishing.test.js:115`, `:121-126` | the new `href` and three labels |
| R3 | `tests/deploy.test.js:327`, `:330`, `:331`, `:332`; `tests/founders-desk-ui.test.js:134` | the new `i18n-dashboard.js` key, with the tag bumped on dashboard, payments, profile and admin |
| R1 | `scripts/smoke-supabase-data-api.js:38-41` | `visit_counts` in the readable list |
| R3 | `tests/supabase.test.js:144`; `scripts/smoke-supabase-data-api.js:38-41` | fakes for the new rpc paths; `metrics_readings` in the readable list |

Must pass untouched: `tests/fiiu.test.js:336-358`, `tests/review-fix-3-courses.test.js:162`,
`tests/course-perks.test.js:90-91`, `tests/fiiu-ui.test.js:939-946`, `tests/catalog-ui.test.js:1139` and
`:1744-1763`, `tests/founders-desk-ui.test.js:114-115`, `tests/membership-terms-page.test.js:135`,
`tests/course-participants-ui.test.js:237`, `tests/page-loading.test.js:36-44` and `:99-108`, and the final-survey
tests.

## Release order

For each release:

1. Code and tests; lint, the suite, then one run with Vercel-like env.
2. Preview on 127.0.0.1 in three languages at desktop and 375px; restart the preview after server edits.
3. The owner applies the migration (`npx --no-install supabase db query --linked -f supabase/migrations/<file>`),
   runs the check file, then `supabase migration repair --status applied <version>`.
4. The owner pushes. Check the Vercel deployment status, not only a 200.
5. Docs: one "migration before main" section per release in `DEPLOYMENT.md`, outside the Founder sections
   (`tests/node-requests-api.test.js:503`); `README.md:124-132`, `:167`, `:234-246`; `docs/architecture.md:22`,
   `:36`, `:108`; `docs/course-pilot-operations.md:7`; an entry in `docs/implementation/fiiu-2026.md`.

**What waits for the sheet.** R1 does not wait: no screen, no indicator names, and D3 says ship first. R2 does
not wait either; renaming a menu item later costs the label table in `admin-nav.js`, a new `?v=` on each staff
page and the pinned keys in four test files. R3 can be built in parallel, but its push waits for the answers to
sheet questions 1, 2, 4, 5 and 6: they fix the Spanish names, the lead row, each indicator's family and whether
one is missing, and the first saved reading freezes that day's keys and values. So the plan holds between R2 and
R3. If no answer has come by the date the owner sets (open question 4), R3 ships with the sheet's defaults.

**Proposed dates (to validate).** The brief asks for a proposed date; the owner fixes the calendar dates and puts
them to Flavia and Mariana. Sequence: R1 as soon as the owner approves and answers open questions 1 to 3; the
sheet goes out the same day with a reply-by date; R2 follows R1; R3 follows the replies. Effort is not verified:
the three source designs estimated 4-5, 5-6 and 8-9 working days in total and none counted the CI database, the
preview seed or the desk draft prompt, so read it as a lower bound. 11 working days remain in November 2026; if
R3's first reading is saved after 30 November, the first column of "Seguimiento" is December.

**Ops files** in `docs/ops/` (model: `2026-11-09-node-request-kinds-check.sql`; the CLI prints only the last
result, so each check file is one read-only SELECT of scalar subselects):

- `<date>-visit-counts-check.sql`: RLS on and no browser grants; both functions INVOKER and closed to anon and
  authenticated; the migration row; views and arrivals per day for the last 7 days, where an inflated day shows.
- `<date>-visit-counts-correct.sql`: owner-run, modelled on `2026-10-29-confirmation-sessions.sql`: a day
  placeholder that makes the file fail until edited, and one statement that deletes or sets that day's rows.
- `2026-11-14-metrics-baseline.sql`: runs today, needs no migration, written from the catalogue definitions
  before the functions exist, computing the Lima day itself. It is written and tested in R1
  (`tests/metrics-ops.test.js`), run by the owner at R1's release to fill the sheet, and run again on R3's
  acceptance day. One column per `n` of the catalogue that SQL can
  count (profile rows, with non-null interests beside `cardinality > 0`; profiles created in 7 and 30 days;
  accounts by Lima month and the last sign-up day; non-admin course openers; non-admin enrolments before
  `2026-10-01T00:00:00Z`, the survey's N; non-admin active members for both windows, overall and per kind) and a
  raw `lower(btrim(country))` group count. "Inscripciones a bloques" and "Horas de asistencia" need the
  programme, so they are read from the festival panel on the same day.
- `<date>-metrics-check.sql`: both functions with their security mode, closed to anon and authenticated; the
  owner of `metrics_account_days` and `has_table_privilege(proowner,'auth.users','SELECT')`;
  `has_table_privilege('service_role', <each table read>, 'SELECT')`; RLS on the readings table; and the
  known-value row, as raw counts: accounts 525, confirmed 494, profiles 486, admins 5, with a city 210, with a
  biography 17, assessed 33, onboarding rows 210, registrations 375, check-ins 90 by 62 people, enrolments 21 (3
  by admins), submitted surveys 9, ready certificates 17, follows 14, acceptances 1, badges 0.
- `<date>-metrics-reading-reset.sql`: owner-run: `delete from public.metrics_readings where day = '<day>'
  returning day, taken_at;`.

**Acceptance for R3:** the home in production equals the baseline file and the festival panel read on the same
Lima day; the "14 Nov" column is the dated reference, and any movement from it is explained before the team is
told. Opening the home saves that day's reading: if acceptance finds a definition to fix, the owner runs the
reset file, the fix ships with `DEFS` bumped, and the next complete open saves the first accepted reading. Also
confirm that the function's maximum duration in the Vercel project settings is at least 10 seconds.

## Out of scope

Generic events or courses; members administration (roles, suspension); removing a course participant; two-factor
sign-in; per-member "last seen"; password sign-ins; cron or a monthly email; aligning the look of the teaching
workspace's header (it keeps its own header, width, text size and "Piloto de cursos · Prototipo" strip under the
shared bar); staff navigation on the door-screen list (`fiiu-qr.html`); moving the organiser tools that live on
member pages (message moderation on `fiiu-session.html`, post moderation on `course.html`) or changing the staff
entry links there (`web/scripts/fiiu.js:562`, `fiiu-hubs.js:80`, `courses.js:40`), which still open the tools
directly; a lighter post-festival mode for the festival panel; admin work done only by script (festival blocks,
confirmation emails, course setup, upload reconciliation); sign-ups by origin (festival, course invitation,
neither); `auth.audit_log_entries` as a source of history; views of the terms page in the membership funnel; a
fixed table of countries; Stripe figures; a members list or drill-down; unique visitors; a country guessed from a
profile's city text; adopting the privacy policy.

## Departures from the decisions

Where the code forced the spec away from a D, C or M:

- **D3:** "no address" is "no address stored" (the limiter keeps it in memory for up to a minute). "A new
  paragraph" is one table row plus sentences in sections 2, 3, 8 and 9, and more in sections 2, 3, 4 and 9 with R3.
- **C1:** holds from R3. In R2 the bar has three links, because the home does not exist yet.
- **C2:** the "perfil" kind includes "marked notifications as read"; it cannot be filtered, so it is labelled.
- **C5 against M4:** the workspace's course totals include the team (21 participantes; its three access counts
  sum to 767) and are shown unchanged under the workspace's names, as is its survey line (the September group, no
  administrators). Only "personas inscritas, sin el equipo" and "abrieron contenido" come from the home's SQL,
  tied by a test. Festival totals include 2 team registrations: said, not filtered.
- **C6:** `_other` can itself hold 1 or 2 people, and reads "otros (menos de 3)" because the festival's own
  answer is "otro". Scalars and the activity kinds are not grouped, and the policy sentence says so. The
  laboratory and organisation-request splits are left off the home instead of grouped.
- **C7:** opening the page does not save (a GET must not change state). The page sends a POST after it loads; the
  first complete reading of the day wins.
- **C8:** "before the build" is read as before the home (R3) is pushed; the counter and the menu ship earlier.
- **M3:** no menu-button fold (teaching has no such header; the fold hides the menu on tablets). A separate bar.
- **M5:** distinct members over 7 and 30 days cannot come from per-day counts; the INVOKER function returns them.
  An incomplete result is memoised for 30 seconds. R1 adds two more INVOKER functions, `count_visit` and `visit_totals` (four in all).
- **M7:** "Perfil guardado" has no SQLite twin (0, marked production-only). The headline is "Perfil básico
  completo".
- **M8:** an answer that is not a country ("lima", 8 people) is shown as typed, with a capital, not corrected.
- **M9:** the payment-button click is dropped: the server already stores one acceptance per successful click
  (`server/server.js:1729-1750`), shown as "veces". `visit.js` is loaded on staff pages, only to set the marker;
  the marker is cleared on `/login.html`, and that view is counted. The page check is an exact map.
- **M11:** the prompt covers the news editor only; the catalog editor would need a second change in `admin.js`.
- **M13:** "non-zero locally" cannot hold for production-only figures. The CI database arrives in R1.

## Calls made for the owner to check

- **M1.** Three releases (counter, menu, home), migrations first: each is useful alone and R1 cannot wait.
- **M2.** Home at `/admin-home.html`, `/admin` redirects, console link "Administración": old addresses stay valid.
- **M3.** Menu labels and sign-out in `admin-nav.js` and `admin-nav.css`, not `i18n.js` (the byte cap); no fold.
- **M4.** Totals count every account; activity and learner figures exclude the 5 admin accounts, which hold 3
  enrolments and 276 of 767 course events.
- **M5.** One DEFINER function for `auth.users`, one INVOKER function, one JS calendar module, a SQLite twin, 200
  with per-part states, a 5-minute memo, its own limiter: the smallest privileged surface, the least drift.
- **M6.** One server catalogue in three languages, server-built CSV, print as the PDF: one copy of each definition.
- **M7.** Profile rows as in the catalogue; 210 is never presented as self-assessments.
- **M8.** Countries from the festival's country answer, folded, small groups merged; typed answers shown as typed.
- **M9.** Counter details: own `visit.js`, page allow-list, eleven fixed sources, `?via=`, staff marker, 600 a
  minute per address, 2-second write, atomic increments; no payment-button click.
- **M10.** Stripe is retired and not reported (0 rows).
- **M11.** A draft prompt on the desk for the news editor, the only change inside `admin.js`; the "away" links stay.
- **M12.** Montserrat with tabular numerals, no second typeface, no left accent bars, whitespace before rules.
- **M13.** A Postgres test with its own CI database (from R1), key-parity and grants tests, an extended dev seed.
- **M14.** The out-of-scope list above, with the items added in this revision.

M3, M5, M7, M8, M9, M11 and M13 differ from their first wording: see Departures. Further calls, by area:

- **Counter.** `fetch` with `keepalive`, not `sendBeacon` (the 415 rule). `r` tells "no referrer" from "this
  site". A reload counts again. The privacy page, the Founder terms and the check-in page are never counted.
- **Counter.** The staff marker is cleared when the sign-in page opens and that view is counted, so the team is
  counted from a sign-in until it opens a staff page. The alternative (clear only in the bar's sign-out, from R2)
  undercounts on a shared computer and leaves "removed on sign-out" untrue until R2.
- **Counter.** A required `Origin`, a per-instance ceiling, a pause after a failure, totals summed in SQL and a
  hand-run correction file: a script can still inflate a day, so the design makes that visible and correctable.
- **Retention.** Visit totals and saved readings are kept without a time limit (open question 1).
- **Menu.** The desk's own sign-out button is hidden, not removed. The Festival link opens the panel as it is
  today, loading every registration's answers on each open. R2 shows its names before sheet question 7 is
  answered.
- **Home.** A member gets the desk's plain 403. The public header plus the bar, like the desk. A "Por atender"
  row. No percentage change. Metrics downloads are not logged like the two personal-data exports.
- **Home.** Three indicators nobody asked for: "Visibles en el directorio", "Cuentas del equipo", "Personas que
  aceptaron" (acceptances are rows, so times and people are shown apart).
- **Home.** Organisation requests sit under Membresías as one total. The form's notice ("We use these details
  only to reply to you") stays, on the reading that a count holds none of the typed details; the alternative is
  to keep that count on screen only.
- **Home.** Survey and certificate figures are the workspace's own. A typed country is shown once three people
  share it and it passes a character check; no fixed table of countries.
- **API.** One argument per SQL function (the grants test). Three languages in one answer. A 6-second deadline per
  part. CSV headers in the chosen language with stable `key` and `state` columns.
- **Readings.** The first reading of the day wins. The INSERT-only grant binds the app; the owner can delete a
  day by hand. Each reading carries `DEFS`. No switch delays saving: a forgotten switch would lose months. Lists
  and visit figures are not saved.
- **Checks and dates.** A baseline SQL file gives every `n` a value the home did not compute, and R3 is accepted
  against it. The spec gives a sequence and an unverified effort range; the owner fixes the calendar dates.

## Left to the builder

- Migration timestamps, constraint names and SQL bodies; the bot User-Agent pattern; the referrer host lists; the
  visit route's per-minute ceiling, well above real traffic.
- `?v=` values, and a grep for every literal pin of a script list on the 19 pages R1 touches.
- EN and PT wording of the catalogue in the desk's register; Spanish follows the sheet once reviewed; the labels
  of the 14 visit pages (Inicio, FIIU, …).
- The layout of `admin-home.css` within the rules above; whether "Por mes" is text or thin bars built with DOM
  attributes; whether `texts` is one map per language or sits beside each indicator.
- The names of the `figures` keys (which figures are saved is fixed in "Daily reading"), before the first reading.
- Whether `.admin-textbutton[hidden]` needs a rule (the `.side-link[hidden]` precedent,
  `tests/dashboard-publishing.test.js:117`).

## Open questions for the owner

Only those the owner alone can answer and that change what gets built, most urgent first. 1 to 3 gate R1.

1. **Retention.** Is "kept without a time limit" confirmed for the policy sentence that ships with R1 (visit
   totals), and later for saved readings? R1 is planned on it: no period, no purge. A period changes R1's scope
   and the published text; with no scheduler in the codebase, a purge is pruning on write or a hand-run SQL step.
2. **Does R1 wait for a legal look** at cookie-free counting in Peru and Brazil? The policy is a draft and says the
   basis for usage analysis must be validated. D3 says ship first, and R1 is planned that way.
3. **Vercel cost.** R1 adds one function call per page view. Is that inside the plan? Not in the repo.
4. **The sheet.** By what date must Flavia and Mariana answer, and if they have not, does R3 ship with the
   sheet's defaults? Nothing in this run shows an answer. Questions 1, 2, 4 and 5 change names, the lead row and
   families; a new indicator (question 6) can change the R3 migration. May R2 show its menu names before
   question 7 is answered?
5. **Pre-flight before the R3 migration: answered on 14 November 2026.** The read-only privilege query was run
   with `supabase db query --linked`: `current_user` is `postgres` and can read `auth.users`; `service_role`
   cannot read it but has USAGE on the `auth` schema. So the design holds as written: the accounts function must
   be SECURITY DEFINER, created by the hand-applied migration (owner `postgres`). Nothing for the owner to decide.
6. **Will the report leave the team** (partners, funders)? The design assumes yes: the small-group rule and the
   section 4 sentence. Asked before, not answered.
7. **Are there team or test accounts that are not admin?** Only `app_role = 'admin'` is left out of activity and
   learner figures; any other team account counts as a member.
