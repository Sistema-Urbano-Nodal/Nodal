# Organisation Node Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third landing card, "Para organizaciones NODAL", opens a no-account form in a dialog; each request is stored, emailed to Flavia and Mariana, and listed in a new "Nodos" band of the organiser desk.

**Architecture:** A self-contained feature module set copied from the News feature: a store serving SQLite and Supabase (`server/node-requests-repository.js`, like `server/news-repository.js`), an API handler (`server/node-requests-api.js`, like `server/news-api.js`) wired into `createApp`, and a team notifier (`server/node-requests-email.js`) built on `server/mailer.js` and the FIIU mail gate. The landing page gets a card, a `<dialog>` and one new script and stylesheet; the desk gets one band built like Interests.

**Tech Stack:** Node 22 with no dependencies, `node --test`, SQLite (tests and local), Supabase PostgREST (production), vanilla browser JS under a strict CSP.

**Spec:** `docs/superpowers/specs/2026-11-03-organisation-node-requests-design.md`

## Global Constraints

- No new dependencies. Lint runs with `--max-warnings=0`.
- CSP: `script-src 'self'`, `style-src 'self'`; no inline script, no `style=` attributes, DOM built with `createElement`/`textContent` only. Untrusted text (names, messages) is never set with `innerHTML`.
- Limits (server-enforced, client mirrors for messages only): name 1–120, organization 1–160, email ≤254 (sign-up's `validateEmail`, trimmed, lower-cased), phone 0–40 of `0-9 + ( ) -` and spaces (empty → `null`), message 1–1000, language `es|en|pt` (default `es`). Strings are trimmed first.
- Rate limits: 20 POSTs per hour per IP (`clientIp`), 3 per day per email (sha256 key), via `createWindowRateLimiter`; at most 40 requests emailed per Lima day, counted in the database.
- Honeypot field `website`: non-empty → answer `202 {ok:true}`, store nothing, send nothing.
- Team recipients: `fmuro@sistemaurbano.org`, `malegre@sistemaurbano.org`, as a constant. Email in Spanish, From display name `NODAL`, Reply-To the organisation (`{name, address}`). Off outside Vercel Production (FIIU `mailGate` semantics). Never retried.
- `email_status` values: `sent | partial | failed | uncertain | off`, `null` until the attempt ends.
- Retention: closed requests are deleted 12 months (calendar) after their `updated_at`; the purge is best-effort and never fails a request.
- Supabase migration: `supabase/migrations/20261103000000_node_requests.sql`, RLS on, no policies, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`. Applied by the owner with `npx --no-install supabase db query --linked -f …` then `supabase migration repair --status applied 20261103000000`. Never `db push`.
- Every changed web asset gets a new `?v=` (use `20261103a`) on every page that loads it, with its pins in `tests/deploy.test.js` (and `tests/fundadores-page.test.js` where pinned).
- Tests inject env, clocks and mail transports; Vercel runs the suite with `VERCEL=1 VERCEL_ENV=production`. No test sends real mail or reads the real date.
- Logs never contain an address, a name, a phone or message text.

## Review Focus

- A visitor switches language with the dialog open, after an error: labels and the shown error re-render in the new language and nothing typed is lost (test in Task 5).
- A double click on Enviar or a slow network: one POST only; the button stays disabled until the answer (test in Task 5).
- Accents, emoji, `<script>` and CR/LF in name, organization or message: the email subject is one encoded line, the body is text, and the desk shows them as text (tests in Tasks 3 and 6).
- Both team sends hit the 8 s mailer timeout: they run in parallel, the request was stored before, and `email_status` ends `uncertain` or `failed` and shows in the desk (tests in Tasks 3 and 4).
- A phone of only spaces or `+`, or a message of only whitespace: phone becomes `null` / the message is rejected as missing (test in Task 4).

---

### Task 1: Mailer display-name override

**Files:**
- Modify: `server/mailer.js` (`send()` in `createMailTransport`, ~:120; `buildMessage` ~:56)
- Test: `tests/mailer.test.js`

**Interfaces:**
- Produces: `transport.send({to, subject, text, html, language, replyTo, fromName})`. `fromName` (optional string) replaces only the From display name; the address stays `config.from.address`. Absent or empty → unchanged behaviour.

- [ ] **Step 1: Write the failing tests** in `tests/mailer.test.js`, using the file's existing fake-socket pattern: `'fromName replaces only the From display name'` asserts the From header is `NODAL <` + the configured address + `>` and the envelope `MAIL FROM` is unchanged; `'fromName with CR/LF or non-ASCII stays one encoded header line'` asserts no bare CR/LF in headers and an RFC 2047 word for `Núcleo\r\nBcc: x@y.z`; `'no fromName keeps EMAIL_FROM as it is'`.
- [ ] **Step 2: Run** `node --test tests/mailer.test.js` → the three new tests FAIL, the rest pass.
- [ ] **Step 3: Implement** `fromName` in `send()`: when it is a non-empty string, pass `{name: fromName, address: config.from.address}` as `from` to `buildMessage` (which already encodes names with `encodeWords`). Update the `send` doc comment above `createMailTransport`.
- [ ] **Step 4: Run** `node --test tests/mailer.test.js tests/review-fix-2-mailer.test.js` → all PASS.
- [ ] **Step 5: Commit** `git commit -m "Let a mail send replace the From display name, for the team's node-request notices"`

### Task 2: Node request store and migration

**Files:**
- Create: `server/node-requests-repository.js`
- Create: `supabase/migrations/20261103000000_node_requests.sql`
- Test: `tests/node-requests-store.test.js` (SQLite store + Supabase store with an injected `fetchImpl`, following `tests/news.test.js`), and a migration-shape test in the same file following `tests/membership-fundadores.test.js:427-458`.

**Interfaces:**
- Produces `createNodeRequestStore({db, env, clients, fetchImpl})` (SQLite when `db` is given, else Supabase, exactly like `createNewsStore`), exporting `NODE_REQUESTS_SQLITE_SCHEMA` and `NODE_REQUEST_FIELDS = ['id','name','organization','email','phone','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version']`. Records use camelCase keys; rows are snake_case. Methods, all async:
  - `insert(record) → record` (record has every field; `status:'new'`, `emailStatus:null`, `version:1`).
  - `get(id) → record | null`.
  - `list({status = null, after = null, limit}) → record[]` newest first by `(createdAt DESC, id DESC)`; `after = {createdAt, id}` of the previous page's last row; `status` filters when given.
  - `update(id, version, patch) → record | null` (compare-and-swap on `version`; `null` on mismatch or missing; `patch` may hold `status`, `updatedAt`, `updatedBy`, `version`).
  - `setEmailStatus(id, emailStatus) → void` (no version change).
  - `countEmailedSince(iso) → number`: rows with `created_at >= iso` whose `email_status IS DISTINCT FROM 'off'` (null = a send in flight counts; ruling during Task 4).
  - `remove(id) → void` (no error when already gone).
  - `purgeClosedBefore(iso) → number`: deletes rows with `status = 'closed' AND updated_at < iso`, returns how many.
- Table `node_requests` exactly as the spec's Storage section: CHECKs repeat the Global Constraints limits and the two enums; `updated_by` references `users(id)` in SQLite and `public.profiles(id)` in Supabase, `ON DELETE SET NULL`; Supabase uses `uuid` + `gen_random_uuid()`, `timestamptz`, the `set_updated_at` trigger; indexes `(created_at DESC, id DESC)` and `(status, created_at DESC, id DESC)`.

- [ ] **Step 1: Write the failing tests:** `'stores, reads and lists node requests newest first, by page'`, `'filters the list by status'`, `'update is a compare-and-swap on version'` (stale version → `null`, row unchanged), `'counts only requests whose email was attempted since a time'` (`off` and `null` excluded), `'purges only closed requests older than the cutoff'`, `'remove of a missing request is not an error'`, `'the CHECKs refuse an oversized message and an unknown status'`; the same behaviours for the Supabase store asserting the PostgREST requests it makes (table `node_requests`, `Prefer: return=representation`, `order=created_at.desc,id.desc`, `version=eq.N` on update); and `'the node_requests migration is server-only, additive and documented'` (header names the two commands, `BEGIN`/`COMMIT`, `ENABLE ROW LEVEL SECURITY`, the exact REVOKE and GRANT, no `CREATE POLICY`, sorts after `20261023000000_founder_badge.sql`).
- [ ] **Step 2: Run** `node --test tests/node-requests-store.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** the store and the migration following `server/news-repository.js` and `supabase/migrations/20261021000000_membership_acceptances.sql`'s header. The migration header also says that until it is applied, only `POST /api/node-requests` and the desk's Nodos band fail (503); nothing else reads the table.
- [ ] **Step 4: Run** `node --test tests/node-requests-store.test.js tests/deploy.test.js tests/review-fix-4-grants.test.js` → PASS (the migration-parsing tests in `deploy.test.js` and `review-fix-4-grants.test.js` must still pass with the new file).
- [ ] **Step 5: Commit** `git commit -m "Store organisation node requests in both backends, with a server-only Supabase table"`

### Task 3: Team notifier

**Files:**
- Create: `server/node-requests-email.js`
- Modify: `server/fiiu-email.js` (export `mailGate`; no behaviour or log-string change)
- Test: `tests/node-requests-email.test.js` (with `tests/helpers/fake-smtp.js` and injected transports)

**Interfaces:**
- Consumes: Task 1's `send({…, replyTo, fromName})`.
- Produces: `NODE_REQUEST_RECIPIENTS` (the two addresses, frozen array) and `createNodeRequestNotice({env = process.env, transport, origin = emailOrigin(env), loopbackOnly = false, log = console.warn, recipients = NODE_REQUEST_RECIPIENTS}) → null | async ({request}) → 'sent' | 'partial' | 'failed' | 'uncertain'`. `null` means email is off (gated); the API then stores `off`. It never throws.
- Message (Spanish, whatever `request.language`): subject `Solicitud de Nodo: ${organization}`; text and a simple html body listing Nombre, Organización, Correo, Teléfono (or "no indicado"), Idioma (Español / English / Português), Recibida (Lima time, `YYYY-MM-DD HH:MM`), the message, and the desk link `${origin}/admin.html#nodes`; `fromName: 'NODAL'`; `replyTo: {name: request.name, address: request.email}` (only when the mailer's `validAddress(request.email)`; otherwise no per-message replyTo).
- Outcome: both recipients sent in parallel (`Promise.allSettled`); `sent` = both accepted; `partial` = one accepted; `uncertain` = none accepted and at least one with `delivery !== 'no'`; `failed` = both refused. One log line per non-`sent` outcome with the request id and the SMTP stage/code only.

- [ ] **Step 1: Write the failing tests:** `'is off outside Vercel Production and without mail settings'` (asserting the gate's log line, label `Node request email`), `'sends one message to each team address with the organisation as Reply-To and NODAL as sender'` (fake SMTP: two messages, `To`, `Reply-To`, From display name, subject, desk link, Lima time from an injected request `createdAt`), `'reports partial, uncertain and failed outcomes'` (injected transport rejecting with `delivery:'no'` / `'unknown'`), `'keeps a CR/LF or emoji organisation name to one subject line and escapes html'` (`<script>` appears escaped in html and verbatim in text), `'never logs an address, name or message'`.
- [ ] **Step 2: Run** `node --test tests/node-requests-email.test.js` → FAIL.
- [ ] **Step 3: Implement** the notifier; reuse `mailGate` and `emailOrigin` from `server/fiiu-email.js` and `limaTime` from `server/course-final-survey.js` if its format fits, else a local Lima formatter with the fixed `-05:00` offset.
- [ ] **Step 4: Run** `node --test tests/node-requests-email.test.js tests/fiiu-email.test.js tests/fiiu-notices.test.js tests/mailer.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Email each organisation node request to Flavia and Mariana, replying straight to the organisation"`

### Task 4: Public and desk API, wired into the server

**Files:**
- Create: `server/node-requests-api.js`
- Modify: `server/server.js` (imports; `SESSIONLESS_API` gains `/api/node-requests`; `ID_ONLY_API` gains `admin/node-requests(?:/.*)?`; `createApp` options `nodeRequestStore`, `nodeRequestNotice`, `nodeRequestLimits`; limiters; the handler call next to `newsApi`)
- Modify: `README.md` (endpoint list beside the catalog Interest endpoints), `docs/architecture.md` (rate-limit table, outside services: team email), `DEPLOYMENT.md` (new `## Organisation node requests: one migration before main` section, placed outside the two slices `tests/membership-fundadores.test.js` and `tests/founder-badge.test.js` cut), `.env.example` only if a test requires it (no new env var).
- Test: `tests/node-requests-api.test.js` (through `createApp` with SQLite and an injected notifier, like `tests/news.test.js`)

**Interfaces:**
- Consumes: Task 2's store, Task 3's notifier.
- Produces `createNodeRequestApi({store, notify, sameOrigin, send, now = () => Date.now(), ipAllowed, emailAllowed, adminRateLimit}) → async ({req, res, url, user}) → boolean` (true when it answered). `ipAllowed(req, res)` and `emailAllowed(email, res)` and `adminRateLimit(req, res, user)` return booleans and have already sent 429 when false. Exports `NODE_REQUEST_LIMITS = {name:120, organization:160, email:254, phone:40, message:1000, page:24, emailsPerDay:40, retentionMonths:12}`, `limaDayStart(ms) → ISO string` (00:00 in Lima of that instant), `nodeRequestAdminView(record)` = `{id, name, organization, email, phone, message, language, status, emailStatus, createdAt, updatedAt, version}`.
- Routes (contract Tasks 5 and 6 rely on):
  - `POST /api/node-requests` body `{name, organization, email, phone?, message, language?, website?}`. Order: `sameOrigin` (403) → `ipAllowed` → `bodyJson(req, 16384)` (413/400/415 as `bodyJson` does) → validate (400 `{error, field}`, field ∈ `name|organization|email|phone|message|language`) → honeypot → `emailAllowed(sha-keyed email)` → best-effort `purgeClosedBefore(now − 12 months)` → `insert` (failure → 503 `{error:'service unavailable'}`, nothing sent) → if `countEmailedSince(limaDayStart(now)) >= 40` or `notify` is null → `setEmailStatus('off')`, else `setEmailStatus(await notify({request}))` (a failing `setEmailStatus` is logged, not fatal) → `202 {ok:true}`. Other methods → 405 `Allow: POST`.
  - `GET /api/admin/node-requests?status=&cursor=` (admin) → `{requests:[view], nextCursor}`; 24 per page; unknown query keys or values → 400; runs the best-effort purge first.
  - `PATCH /api/admin/node-requests/:id` (admin, `sameOrigin`, `adminRateLimit`) `{status, version}` → 200 `{request}`; 400 bad status/version; 404; 409 `{error:'node request changed; reload before saving', code:'version_conflict', request}`.
  - `DELETE /api/admin/node-requests/:id` (admin, `sameOrigin`, `adminRateLimit`) → 204, also when already gone.
  - Admin routes: 401 `{error:'sign in required'}` without a user, 403 unless `user.permission === 'admin'` (as `news-api.js`).
- Wiring: limiters built in `createApp` with `createWindowRateLimiter`: IP `{windowMs: 3600000, limit: 20}` through `throttle(limiter, res, req, null, 'node-request')`; email `{windowMs: 86400000, limit: 3}` keyed `node-request-email:` + sha256(email), answering 429 `{error:'too many requests'}` with `Retry-After`; admin writes reuse the news write budget pattern. `nodeRequestStore` defaults like `newsStore` (`repository.database` → SQLite store; `repository.kind === 'supabase'` → Supabase store); `nodeRequestNotice` defaults to `createNodeRequestNotice({loopbackOnly: repository?.kind !== 'supabase'})`.

- [ ] **Step 1: Write the failing tests** (clock injected via `now`): `'accepts a request without an account, stores it and emails the team once'`; `'trims fields, stores a blank phone as null and refuses a blank message'`; `'names the field for each invalid input'` (one case per limit, a bad email, a bad phone character, an unknown language); `'answers a filled honeypot like a success and stores nothing'`; `'limits requests per address and per email'` (21st from one IP → 429, 4th for one email → 429); `'stores off and sends nothing past 40 emailed requests in a Lima day'` (counter resets at Lima midnight, not UTC); `'stores the outcome the notifier reports, and off when email is gated'`; `'answers 503 and sends nothing when the store refuses the insert'`; `'refuses a cross-origin post'`; `'never resolves a session for the public post'` (a repository whose session lookup throws still gets 202); `'lists, filters, pages, updates and deletes requests for admins only'` (401, 403, 400 on bad query, 409 shape, DELETE twice → 204); `'purges closed requests older than 12 months when the desk lists or a request arrives'`; `'README names every node-request endpoint'` if `tests/deploy.test.js:220`'s check does not already cover it.
- [ ] **Step 2: Run** `node --test tests/node-requests-api.test.js` → FAIL.
- [ ] **Step 3: Implement** `server/node-requests-api.js` after `server/news-api.js`, then the wiring and docs.
- [ ] **Step 4: Run** `node --test tests/node-requests-api.test.js tests/news.test.js tests/api.test.js tests/deploy.test.js tests/founder-badge.test.js tests/membership-fundadores.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Accept organisation node requests without an account and list them for the desk"`

### Task 5: Landing card and dialog

**Files:**
- Modify: `web/pages/index.html` (third card after the Founder card; `<dialog id="nodeRequest">`; new script and stylesheet tags; `i18n.js` key bump), `web/scripts/i18n.js` (`HOME_ES`, `HOME_PT` keys `mem.org.*`; EN is the markup), `server/server.js` `STATIC_SCRIPTS` and styles list, `scripts/build-static.js`, `vercel.json` header regexes, every page loading `i18n.js` (new `?v=`).
- Create: `web/scripts/node-request.js`, `web/styles/node-request.css`
- Test: `tests/node-request-ui.test.js` (fake DOM harness in the style of `tests/news-ui.test.js`); update `tests/landing-membership.test.js`, `tests/home-i18n.test.js` (only if a pinned hash legitimately changes: recapture with a dated comment), `tests/deploy.test.js` pins, `tests/fundadores-page.test.js` pins, `tests/page-loading.test.js` (script order).

**Interfaces:**
- Consumes: Task 4's `POST /api/node-requests` contract and its error shapes.
- Markup ids: card `article.plan.plan-org` with `a#nodeRequestOpen[href="#nodos"]`; `dialog#nodeRequest` (`aria-labelledby`), `form#nodeRequestForm[novalidate]` with inputs `#nodeRequestName[name=name]`, `#nodeRequestOrganization[name=organization]`, `#nodeRequestEmail[name=email][type=email]`, `#nodeRequestPhone[name=phone][type=tel]`, `textarea#nodeRequestMessage[name=message][maxlength=1000]`, honeypot `#nodeRequestWebsite[name=website][tabindex=-1][autocomplete=off]` inside an `aria-hidden` wrapper hidden by CSS, `p#nodeRequestError[role=alert][hidden]`, `button#nodeRequestSend[type=submit]`, `button#nodeRequestClose[type=button]`, `div#nodeRequestThanks[hidden]` with `button#nodeRequestDone`.
- Copy: Spanish exactly as the spec's "What visitors see" (card title, line, paragraph, button "Contáctanos"; window kicker, heading, line, labels, privacy line linking `privacy.html`, "Enviar", thank-you). English and Portuguese in the same register, written here. Dynamic strings (sending, field errors, too many attempts, unavailable, unreachable + the two footer addresses) live in `node-request.js` as `[en, es, pt]` rows read through `window.nodalI18n.lang` and re-rendered on `nodalI18n.onChange`.
- Behaviour: click on `#nodeRequestOpen` (or `location.hash === '#nodos'` on load) → `showModal()`, focus `#nodeRequestName`; close (button, Escape via `cancel`, `#nodeRequestDone`) → `close()`, focus back on `#nodeRequestOpen`, `history.replaceState` drops `#nodos`; submit → one `fetch('/api/node-requests', {method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'}, body})` with `language` from `nodalI18n.lang`, button disabled until the answer; 202 → thanks; 400 → the field's message and focus that field; 429 or a network/no-API failure → message plus the two team addresses; other → unavailable. Without `HTMLDialogElement.prototype.showModal` the link stays a plain `#nodos` link (no crash).
- Layout: three columns above 980 px; between 820 and 980 px the third card spans both columns; one column below 820 px (`.plans` rules stay in `styles.css`, overrides in `node-request.css`). Outlined card with the pastel-green border; the Founder card stays the highlighted one.

- [ ] **Step 1: Write the failing tests:** `'the landing page has a third card that links to #nodos and a dialog with every field'`; `'opens on Contáctanos and on #nodos, and gives focus back when closed'`; `'sends one POST with the typed fields and the page language, and thanks'`; `'ignores a second submit while the first is pending'`; `'shows the field error for a 400 and keeps what was typed'`; `'shows the team addresses on 429 and when the API is unreachable'`; `'re-renders labels and the shown error when the language changes'`; `'puts untrusted text on the page as text only'`; plus the updated pins and the `landing-membership.test.js` card checks (two existing cards unchanged, a third `plan plan-org`).
- [ ] **Step 2: Run** `node --test tests/node-request-ui.test.js` → FAIL.
- [ ] **Step 3: Implement** markup, CSS, script, translations, registrations and cache keys.
- [ ] **Step 4: Run** `node --test tests/node-request-ui.test.js tests/landing-membership.test.js tests/home-i18n.test.js tests/i18n-split.test.js tests/page-csp.test.js tests/page-loading.test.js tests/deploy.test.js tests/fundadores-page.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the organisations card to the landing page and its request form in a window"`

### Task 6: Desk band "Nodos"

**Files:**
- Modify: `web/pages/admin.html` (tab `a#adminTabNodes[href="#nodes"][data-i18n="ops.index.nodes"]` after Interests; `section.admin-band#nodes` after `#interests`, before `#founders`, with `select#adminNodeFilter` (all/new/contacted/closed), `p#adminNodeStatus[role=status][aria-live=polite]` without `data-i18n`, `div#adminNodeList`, `button#adminNodeMore[hidden]`; asset `?v=` bumps), `web/scripts/admin.js` (`elements`, `state`, the node queue, `trackSections` map, `I18N.onChange`, `bootstrap`), `web/scripts/i18n-dashboard.js` (`ops.nodes.*`, `ops.index.nodes` in en/es/pt), `web/styles/admin.css` if needed; pages loading `i18n-dashboard.js` get its new `?v=`.
- Test: `tests/node-requests-desk-ui.test.js` (harness of `tests/catalog-ui.test.js` `adminHarness`); update `tests/founders-desk-ui.test.js` (tab order now `['#news','#catalog','#interests','#nodes','#founders','fiiu-admin.html#content','teaching.html']`), `tests/catalog-ui.test.js` (section list; key-resolution `families` if keys are built from templates), `tests/deploy.test.js` pins.

**Interfaces:**
- Consumes: Task 4's admin routes and `nodeRequestAdminView` shape.
- Each item: organisation (heading), name, `mailto:` email link, phone when present, message (text, line breaks kept with CSS), language name, received date in Lima, a warning line when `emailStatus` is not `sent` (wording per value: `off` "no se envió el correo al equipo", `failed`, `partial`, `uncertain`, `null` "aún sin resultado"), status `<select>` + Update (PATCH `{status, version}`; 409 → `ops.nodes.changed` and reload), Delete (confirm text reminds to delete the two emails too; DELETE then reload).

- [ ] **Step 1: Write the failing tests:** `'lists node requests newest first with every field as text'`, `'filters by status and pages with the cursor'`, `'updates the status with the version and reloads on a conflict'`, `'deletes after a confirm that mentions the team emails'`, `'warns when the team email was not sent'`, `'re-renders the band when the language changes'`, `'marks the Nodos tab while its band is on screen'`.
- [ ] **Step 2: Run** `node --test tests/node-requests-desk-ui.test.js` → FAIL.
- [ ] **Step 3: Implement** the band after the Interests queue's pattern.
- [ ] **Step 4: Run** `node --test tests/node-requests-desk-ui.test.js tests/founders-desk-ui.test.js tests/catalog-ui.test.js tests/deploy.test.js tests/home-i18n.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Show organisation node requests in a Nodos band of the organiser desk"`

### Task 7: Privacy policy

**Files:**
- Modify: `docs/privacy/privacy-policy.en.md`, `.es.md`, `.pt-BR.md` (§2 row after the Founder rows: "Organisation node requests" / "Solicitudes de Nodo de organizaciones" / "Solicitações de Nó de organizações"; §9 retention sentence; §4 audience if it lists who sees data), `scripts/build-privacy-page.js` dates (`3 November 2026` / `3 de noviembre de 2026` / `3 de novembro de 2026`), regenerate `web/pages/privacy.html` with `node scripts/build-privacy-page.js`, `docs/privacy/implementation-review.md` (one row for `node_requests`).
- Test: `tests/privacy-page.test.js` (a pinned-row test like the existing per-row tests: the row's plain cell names the fields, that no account is needed, the two inboxes and the Sent folder, deletion on request including the email copies by the team, the 12-month automatic deletion of closed requests, and that it is not part of an account export).

**Interfaces:** none (documentation only).

- [ ] **Step 1: Write the failing test** `'the policy describes organisation node requests in all three languages'`.
- [ ] **Step 2: Run** `node --test tests/privacy-page.test.js` → FAIL.
- [ ] **Step 3: Write** the rows (one plain cell each: no bold, no links, no `|`), the §9 sentence, the dates, regenerate the page.
- [ ] **Step 4: Run** `node --test tests/privacy-page.test.js tests/fundadores-copy.test.js tests/course-final-survey.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Describe organisation node requests in the privacy policy"`

### Finish

- [ ] `npm run lint` → exit 0; `npm test` → 0 failures; then the Vercel-like run `env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://example.org EMAIL_SMTP_URL='smtps://user:pass@smtp.example.invalid:465' EMAIL_FROM='FIIU Fest 11 <fest@example.invalid>' npm run build` (dummy mail settings, as Vercel has real ones: every gate that is off logs) → same failures as `main` before this work (record any pre-existing ones by name).
- [ ] Local preview on 127.0.0.1 with a loopback mail catcher: send a request in ES and EN, see the desk band, update and delete; screenshot the card at 1280, 900 and 375 px.
- [ ] Hand the owner the migration commands; push only on their word, then verify the deploy and one live request (theirs).
