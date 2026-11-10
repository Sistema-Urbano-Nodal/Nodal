# Sponsored memberships request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organisation ask, from the landing page's "Para organizaciones NODAL" window, to sponsor memberships for a community, and give the team that request by email and in the desk, apart from Nodo requests.

**Architecture:** Extend the existing node-request pipeline (one table, one API, one email module, one landing window, one desk band) with a `kind` (`node` | `sponsorship`) and two sponsor-only fields. One additive Supabase migration; everything else is code in the existing files.

**Tech Stack:** Node.js `node:test`, SQLite (local) and Supabase PostgREST (production), vanilla JS front end under a strict CSP, i18n dictionaries in `web/scripts/i18n.js` and `web/scripts/i18n-dashboard.js`.

**Spec:** `docs/superpowers/specs/2026-11-09-sponsored-memberships-design.md` (approved 9 Nov 2026). The original pipeline's spec, whose constraints still hold: `docs/superpowers/specs/2026-11-03-organisation-node-requests-design.md`.

## Global Constraints

- Work on branch `sponsored-memberships` cut from `main`; commit per task; **never push** (the owner pushes after applying the migration).
- Kinds: `node`, `sponsorship`. A missing `kind` in a POST means `node`.
- Membership codes, in this order: `1-10`, `11-25`, `26-50`, `50+`, `unsure`.
- `community`: trimmed, 1–200 characters, one line (same control/bidi rule as `name`), required for `sponsorship`; `community` and `memberships` are ignored and never stored for `node`.
- The 40-a-Lima-day email ceiling, 20/hour per IP, 3/day per email, honeypot, 12-month purge: unchanged and shared by both kinds.
- No price, sum or `S/ <digit>` anywhere on the landing page.
- CSP: no inline script or style; DOM built with createElement/textContent; visitor text only ever as text.
- Every changed asset gets `?v=20261109a` on every page that loads it, with its pins in `tests/deploy.test.js` (and `tests/fundadores-page.test.js` where it pins shared assets).
- `web/scripts/i18n.js` stays under 80,000 bytes (74,932 now). Landing EN copy lives in the markup, ES/PT in `HOME_ES`/`HOME_PT`; desk copy in `web/scripts/i18n-dashboard.js` under `ops.*` in en, es and pt.
- Tests must not read the real clock or send real mail (fake SMTP helper); Vercel's build runs the whole suite with production env.

Landing copy (EN markup / ES / PT), keys under `mem.org.`:

| key | EN | ES | PT |
|---|---|---|---|
| `p` (sentence appended) | You can also sponsor memberships for a community. | También puedes patrocinar membresías para una comunidad. | Você também pode patrocinar membresias para uma comunidade. |
| `kind` | What are you interested in? | ¿Qué les interesa? | O que interessa a vocês? |
| `kindNode` | Activate a Node | Activar un Nodo | Ativar um Nó |
| `kindSponsor` | Sponsor memberships | Patrocinar membresías | Patrocinar membresias |
| `kindSponsorLine` | Support a community. Activate a network. | Apoya una comunidad. Activa una red. | Apoie uma comunidade. Ative uma rede. |
| `fCommunity` | Which community would you like to support? | ¿A qué comunidad les gustaría apoyar? | Que comunidade vocês gostariam de apoiar? |
| `fCommunityHint` | (for example: cyclists in Lima, your team, a professional network) | (por ejemplo: ciclistas de Lima, su equipo, una red profesional) | (por exemplo: ciclistas de Lima, sua equipe, uma rede profissional) |
| `fMemberships` | Roughly how many memberships? | ¿Cuántas membresías, aproximadamente? | Quantas membresias, aproximadamente? |
| `mChoose` | Choose one | Elige una opción | Escolha uma opção |
| `m1` … `m4` | 1 to 10 · 11 to 25 · 26 to 50 · More than 50 | 1 a 10 · 11 a 25 · 26 a 50 · Más de 50 | 1 a 10 · 11 a 25 · 26 a 50 · Mais de 50 |
| `mUnsure` | We don't know yet | Aún no lo sabemos | Ainda não sabemos |
| `fTopic` | What topic or urban challenge do you care about? | ¿Qué tema o desafío urbano les interesa? | Que tema ou desafio urbano interessa a vocês? |

Script-only error rows in `node-request.js` `ROWS` ([en, es, pt]):
- `kind`: "Choose whether you want to activate a Node or sponsor memberships." / "Elige si quieren activar un Nodo o patrocinar membresías." / "Escolha se querem ativar um Nó ou patrocinar membresias."
- `community`: "Write the community you would like to support, up to 200 characters." / "Escribe la comunidad que quieren apoyar, hasta 200 caracteres." / "Escreva a comunidade que querem apoiar, até 200 caracteres."
- `memberships`: "Choose roughly how many memberships." / "Elige cuántas membresías, aproximadamente." / "Escolha quantas membresias, aproximadamente."

## Review Focus

1. **A landing page cached before this release** posts with no `kind`, `community` or `memberships`: it must be stored as a `node` request exactly as today (Task 2 test `a request without kind is a Nodo request`).
2. **A visitor who typed sponsor fields, then switched to Nodo** and sent: the POST carries `kind:'node'` and no `community`/`memberships`; and a hand-made POST with `kind:'node'` plus those fields stores them as null (Task 2 `ignores sponsor fields on a Nodo request`, Task 4 `switching to Nodo sends no sponsor fields`).
3. **The migration applied while the old code is still live**: an insert without the new columns must still satisfy the CHECK through the `'node'` default (Task 1 `rows written without kind are Nodo rows`).
4. **A community with a line break or a bidi override** pasted in: 400 with `field:'community'`, nothing stored (Task 2 `refuses an unsafe or oversized community`).
5. **Desk kind and status filters combined with paging**: the cursor's next page stays inside the chosen kind (Task 1 `filters by kind and status together, by page`; Task 5 `filters by kind`).

---

### Task 1: Storage — kind and sponsor columns, migration, deploy note

**Files:**
- Create: `supabase/migrations/20261109000000_node_request_kinds.sql`
- Modify: `server/node-requests-repository.js` (schema string, fields, `list`, in-place SQLite upgrade)
- Modify: `tests/helpers/node-requests-postgrest.js` (the kind CHECK)
- Modify: `DEPLOYMENT.md` (new section after `## Organisation node requests: one migration before main`; release checklist step 2)
- Test: `tests/node-requests-store.test.js`, `tests/node-requests-api.test.js` (the DEPLOYMENT.md test at its end)

**Interfaces:**
- Produces: `NODE_REQUEST_FIELDS = ['id','kind','name','organization','email','phone','community','memberships','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version']`; `store.list({status=null, kind=null, after=null, limit})`. Every other store method keeps its signature.

- [ ] **Step 1: Write the failing tests** in `tests/node-requests-store.test.js`:
  - Update the field assertion to the list above; `record()` gains `kind:'node', community:null, memberships:null`.
  - `rows written without kind are Nodo rows`: on SQLite, `db.prepare('INSERT INTO node_requests (id,name,organization,email,message,language,created_at,updated_at) VALUES (...)')` without `kind` → `store.get(id)` has `kind:'node'`, `community:null`, `memberships:null`.
  - `stores a sponsorship and refuses a mixed row`: insert `record(1,{kind:'sponsorship',community:'Ciclistas de Lima',memberships:'11-25'})` round-trips; SQLite rejects (CHECK) `kind:'node'` with a community, `kind:'sponsorship'` without memberships, `memberships:'5'`, and a 201-character community.
  - `filters by kind and status together, by page`: four rows mixing kinds and statuses; `list({kind:'sponsorship',status:'new',limit:1})` then its `after` page returns only matching rows, newest first; the Supabase store sends `kind:'eq.sponsorship'` and the select string now lists the new columns in field order.
  - `upgrades an existing local table in place`: create the `node_requests` table by hand with `NODE_REQUESTS_SQLITE_SCHEMA` exactly as it is in `server/node-requests-repository.js` before this task (pasted into the test as a literal), insert one row, then `createNodeRequestStore({db})` → the row reads back with `kind:'node'`, and a sponsorship insert works.
  - `the node_request_kinds migration is additive, server-only and documented`: file sorts after `20261103000000_node_requests.sql`; header has the `db query --linked -f supabase/migrations/20261109000000_node_request_kinds.sql` and `migration repair --status applied 20261109000000` commands, `Never \`db push\``, `BEFORE pushing \`main\``, and says POST `/api/node-requests` answers 503 and the desk's band fails to load until applied; statements are exactly: `BEGIN`, one `ALTER TABLE public.node_requests ADD COLUMN kind text NOT NULL DEFAULT 'node' CHECK(kind IN ('node','sponsorship')), ADD COLUMN community text, ADD COLUMN memberships text, ADD CONSTRAINT node_requests_kind_fields CHECK(...)`, `CREATE INDEX node_requests_kind ON public.node_requests(kind,created_at DESC,id DESC)`, `COMMIT` (no grant, policy or trigger change).
- [ ] **Step 2: Add to the DEPLOYMENT.md test** at the end of `tests/node-requests-api.test.js`: a `## Sponsorship requests: one migration before \`main\`` section exists outside the slices other tests cut, holds both commands above, and release step 2 now reads ``most recently `20261109000000_node_request_kinds.sql` under "Sponsorship requests", before pushing `main` ``.
- [ ] **Step 3: Run** `node --test tests/node-requests-store.test.js tests/node-requests-api.test.js` — expected: the new tests FAIL (unknown fields, missing file).
- [ ] **Step 4: Implement.** The CHECK, written identically in SQL and SQLite:
  ```sql
  (kind='node' AND community IS NULL AND memberships IS NULL) OR
  (kind='sponsorship' AND char_length(community) BETWEEN 1 AND 200 AND memberships IN ('1-10','11-25','26-50','50+','unsure'))
  ```
  (`length()` in SQLite.) New SQLite tables get the columns and a table-level CHECK; an existing table without `kind` is upgraded with `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` (pattern: `server/courses-repository.js:67`), attaching the tying CHECK to the `memberships` column, plus `CREATE INDEX IF NOT EXISTS node_requests_kind`. `list` adds `kind=?` / `kind:'eq.<kind>'` like `status`. The fake PostgREST refuses a row whose `kind` is not `node`/`sponsorship` with `23514`, and fills `kind:'node'`, `community:null`, `memberships:null` when the body leaves them out (PostgreSQL's defaults). DEPLOYMENT.md section modelled on the 3 Nov one, with verification SQL `select count(*) from public.node_requests where kind is null; -- 0`.
- [ ] **Step 5: Run** the same command plus `node --test tests/membership-fundadores.test.js tests/founder-badge.test.js` (they slice DEPLOYMENT.md) — expected: PASS.
- [ ] **Step 6: Commit** — `git add` the five files; message "Store a request's kind and a sponsor's community and memberships range".

### Task 2: API — accept sponsorships, filter by kind

**Files:**
- Modify: `server/node-requests-api.js`
- Test: `tests/node-requests-api.test.js`

**Interfaces:**
- Consumes: Task 1's fields and `store.list({status,kind,after,limit})`.
- Produces: exports `NODE_REQUEST_KINDS=['node','sponsorship']`, `SPONSOR_MEMBERSHIPS=['1-10','11-25','26-50','50+','unsure']`; `NODE_REQUEST_LIMITS` gains `community:200`; `nodeRequestAdminView` adds `kind`, `community`, `memberships`; POST accepts `kind`, `community`, `memberships`; GET accepts `kind`. Error body for a bad field stays `{error, field}` with `field` in `kind|community|memberships` for the new ones.

- [ ] **Step 1: Write the failing tests** (reuse `setup`, `valid`):
  - Update `exports the limits…`: `NODE_REQUEST_LIMITS` deep-equals the old object plus `community:200`; `VIEW_KEYS` gains `community`, `kind`, `memberships`.
  - `stores a sponsorship request with its community and range`: POST `valid({kind:'sponsorship',community:'  Ciclistas de Lima ',memberships:'11-25',message:'Movilidad activa'})` → 202; the row has `kind:'sponsorship'`, `community:'Ciclistas de Lima'`, `memberships:'11-25'`; the notifier got the same request.
  - `a request without kind is a Nodo request`: POST `valid()` (no kind) → row `kind:'node'`, nulls.
  - `ignores sponsor fields on a Nodo request`: POST `valid({kind:'node',community:'X',memberships:'50+'})` → 202, row nulls.
  - `refuses a bad kind, a missing community or range, an unsafe or oversized community`: each → 400 with the field named and no row: `kind:'patrocinio'`, `kind:1`; sponsorship without `community`, with `'   '`, with `'a'.repeat(201)`, with `'Lima\nNorte'`, with `'‮abc'`; sponsorship without `memberships`, with `'5'`, with `11`.
  - `reports the first problem in form order`: sponsorship with a bad email and no community → `field:'email'`; with no community and a bad range → `field:'community'`.
  - `filters the desk list by kind`: seed both kinds; `list('?kind=sponsorship')` returns only sponsorships with the three new keys; `?kind=x`, `?kind=node&kind=node` → 400 `field:'kind'`; `?kind=sponsorship&status=new` combines.
- [ ] **Step 2: Run** `node --test tests/node-requests-api.test.js` — expected: new tests FAIL.
- [ ] **Step 3: Implement** in `normalizeNodeRequest`: read `kind` first (missing → `'node'`; anything not in `NODE_REQUEST_KINDS`, including non-strings → `invalid('kind')`), then name, organization, email, phone, then for `sponsorship` only `community` via `text(input,'community')` and `memberships` (must be a string in `SPONSOR_MEMBERSHIPS`, else `invalid('memberships')`), then message and language; return `{kind,name,organization,email,phone,community,memberships,message,language}` with `community`/`memberships` null for `node`. `QUERY_KEYS` gains `'kind'`, validated like `status`, passed to `store.list`.
- [ ] **Step 4: Run** `node --test tests/node-requests-api.test.js tests/node-requests-store.test.js` — expected: PASS.
- [ ] **Step 5: Commit** — "Accept sponsorship requests and filter the desk list by kind".

### Task 3: Team email — the sponsorship notice

**Files:**
- Modify: `server/node-requests-email.js`
- Test: `tests/node-requests-email.test.js`

**Interfaces:**
- Consumes: a stored request from Task 2 (`kind`, `community`, `memberships`).
- Produces: nothing new for other tasks; `createNodeRequestNotice` keeps its signature and outcomes.

- [ ] **Step 1: Write the failing tests:**
  - `writes a sponsorship notice with its own subject, opening line and rows`: with the fake SMTP, a request `{kind:'sponsorship',organization:'SPDA',community:'Ciclistas de Lima',memberships:'11-25',…}` → subject `Patrocinio de membresías: SPDA`; text starts `Una organización quiere patrocinar membresías.`; rows `Comunidad a apoyar: Ciclistas de Lima` and `Membresías (aprox.): 11 a 25` come right after `Teléfono:`; the message block is headed `Tema o desafío urbano:`; html carries the same rows escaped; the desk link is still `/admin.html#nodes`.
  - `words every range`: `1-10`→`1 a 10`, `11-25`→`11 a 25`, `26-50`→`26 a 50`, `50+`→`Más de 50`, `unsure`→`Aún no lo saben`.
  - `a Nodo notice is unchanged`: an existing test's request with `kind:'node'` still produces `Solicitud de Nodo: …`, `Una organización quiere conversar sobre un Nodo.`, `Mensaje:` and no community rows.
  - Extend `never logs an address, name or message` to a sponsorship whose community is a sentinel string: the sentinel never appears in logs.
- [ ] **Step 2: Run** `node --test tests/node-requests-email.test.js` — expected: new tests FAIL.
- [ ] **Step 3: Implement** in `noticeMessage`: branch on `request.kind==='sponsorship'` for subject, first line, the two extra rows (community through `oneLine`) and the message heading; range words in a module-level map.
- [ ] **Step 4: Run** `node --test tests/node-requests-email.test.js tests/node-requests-api.test.js` — expected: PASS.
- [ ] **Step 5: Commit** — "Tell the team in the email when an organisation wants to sponsor memberships".

### Task 4: Landing window — the choice, the sponsor fields, `#patrocinio`

**Files:**
- Modify: `web/pages/index.html` (card paragraph unchanged in markup except its English text; dialog), `web/styles/node-request.css`, `web/scripts/node-request.js`, `web/scripts/i18n.js` (`HOME_ES`, `HOME_PT`)
- Modify: every `web/pages/*.html` that loads `i18n.js` (version bump), `tests/deploy.test.js`, `tests/fundadores-page.test.js` (pins)
- Test: `tests/node-request-ui.test.js`

**Interfaces:**
- Consumes: Task 2's POST contract.
- Produces: markup ids `nodeRequestKind` (the `<fieldset>`), radios `nodeRequestKindNode` / `nodeRequestKindSponsor` (`name="kind"`, values `node` / `sponsorship`), `nodeRequestSponsor` (wrapper of the two sponsor labels, `hidden` by default), `nodeRequestCommunity` (`type="text"`, `maxlength="200"`), `nodeRequestMemberships` (`<select>` whose first option is `value=""` `mem.org.mChoose`, then the five codes with `mem.org.m1`…`m4`, `mUnsure`), message label spans `data-i18n="mem.org.fMessage"` and `data-i18n="mem.org.fTopic"` (the second `hidden`).

- [ ] **Step 1: Extend the harness** in `tests/node-request-ui.test.js`: fake elements get `checked` (from the attribute), `form.reset` clears inputs, unchecks radios and puts selects back to `''`; `window` gets `addEventListener` recording `hashchange` handlers; `FIELDS` gains `community`, `memberships`; helpers `choose(kind)` (sets `checked` and dispatches `change` on the radio).
- [ ] **Step 2: Write the failing tests:**
  - Markup: the dialog's heading is `<h2 … data-i18n="mem.org.name">`, no kicker; the fieldset comes before the name field with legend `mem.org.kind`, two required radios, the Nodo option's line is `mem.org.tagline`, the sponsor option's is `mem.org.kindSponsorLine`; the sponsor wrapper is `hidden`; the card still has one button, `href="#nodos"`; no `S/ <digit>` in the card or window.
  - Copy: the `COPY` table pins every new `mem.org.*` key in en/es/pt as in Global Constraints, and `mem.org.p` ends with the appended sentence in each language.
  - `opens with no choice from the card, Nodo from #nodos, sponsorship from #patrocinio`: card click → both radios unchecked, sponsor wrapper hidden; `mount({hash:'#nodos'})` → Nodo checked; `mount({hash:'#patrocinio'})` → sponsorship checked and wrapper shown; closing either removes the hash via `replaceState`; firing the recorded `hashchange` handler with `location.hash='#patrocinio'` opens the window with sponsorship chosen.
  - `asks for a choice before sending`: submit with no choice → no request, error text is the `kind` row in the page language, the fieldset has `aria-invalid="true"` and focus is on the first radio.
  - `sends a sponsorship with its community and range`: choose sponsorship, fill all → one POST whose JSON body is `{kind:'sponsorship',name,organization,email,phone,community,memberships,message,language,website}`; thanks as today.
  - `switching to Nodo sends no sponsor fields`: fill the sponsor fields, choose Nodo, send → body has `kind:'node'` and no `community`/`memberships` keys; switching back shows the typed values again (not cleared).
  - `swaps the message label with the choice`: sponsorship shows the `mem.org.fTopic` span and hides `mem.org.fMessage`; Nodo or no choice the reverse.
  - `marks community and memberships from a 400`: a 400 `{field:'community'}` / `{field:'memberships'}` marks that control and shows its row.
  - `a fresh form after thanks has no choice; an unsent one keeps it`: after a thanked sponsorship, opening from the card shows no choice; closing an unsent sponsorship and reopening keeps it.
  - `re-renders on language change` covers the `kind` error row.
- [ ] **Step 3: Run** `node --test tests/node-request-ui.test.js` — expected: new tests FAIL.
- [ ] **Step 4: Implement** markup, CSS (the fieldset reads as the form's first question: two stacked options, each a label with its line beneath in the hint colour at ≥4.5:1 like `.nr-hint`; the `<select>` takes the text inputs' look), and the script: `chosen()` returns the checked radio's value or `null`; a `change` listener toggles `nodeRequestSponsor.hidden` and the two message spans; `openWindow(kind)` sets the choice when given one; the submit guard shows `kind` before any fetch; the body adds `community`/`memberships` only for sponsorship; `FIELDS`-driven 400 handling covers the two new ids; hash handling for `#nodos` and `#patrocinio` on load and on `hashchange`; close removes either hash. Add the ES/PT keys to `HOME_ES`/`HOME_PT`.
- [ ] **Step 5: Bump versions:** `node-request.js`, `node-request.css` and `i18n.js` to `?v=20261109a` on every page that loads them, and their pins in `tests/deploy.test.js` / `tests/fundadores-page.test.js`.
- [ ] **Step 6: Run** `node --test tests/node-request-ui.test.js tests/home-i18n.test.js tests/i18n-split.test.js tests/landing-membership.test.js tests/deploy.test.js tests/fundadores-page.test.js` — expected: PASS (i18n.js still under 80,000 bytes).
- [ ] **Step 7: Commit** — "Ask organisations whether they want a Nodo or to sponsor memberships, and open on #patrocinio".

### Task 5: Desk — kind label, sponsor lines, kind filter

**Files:**
- Modify: `web/pages/admin.html` (band title/lead keys unchanged, kind filter `<select id="adminNodeKind">` beside `adminNodeFilter`), `web/scripts/admin.js`, `web/scripts/i18n-dashboard.js`, `web/styles/admin.css` only if the label needs a rule
- Modify: pages loading `admin.js` / `i18n-dashboard.js` (version bump), `tests/deploy.test.js`
- Test: `tests/node-requests-desk-ui.test.js`

**Interfaces:**
- Consumes: Task 2's admin view (`kind`, `community`, `memberships`) and `GET ?kind=`.

New and changed `ops.*` copy (en / es / pt):
- `ops.index.nodes`: Organizations / Organizaciones / Organizações
- `ops.nodes.title`: Organization requests / Solicitudes de organizaciones / Solicitações de organizações
- `ops.nodes.lead`: today's line with "asked about a NODAL node **or about sponsoring memberships**" (es "preguntaron por un Nodo NODAL o por patrocinar membresías", pt "perguntaram por um Nó NODAL ou por patrocinar membresias"); the rest unchanged.
- `ops.nodes.kindShow`: Type / Tipo / Tipo; `ops.nodes.allKinds`: All types / Todos los tipos / Todos os tipos
- `ops.nodes.kind.node`: Node / Nodo / Nó; `ops.nodes.kind.sponsorship`: Sponsorship / Patrocinio / Patrocínio
- `ops.nodes.community`: Community: {community} / Comunidad: {community} / Comunidade: {community}
- `ops.nodes.memberships`: Memberships: {range} / Membresías: {range} / Membresias: {range}
- `ops.nodes.m1`…`m4`, `ops.nodes.mUnsure`: 1 to 10 · 11 to 25 · 26 to 50 · More than 50 · They don't know yet / 1 a 10 · 11 a 25 · 26 a 50 · Más de 50 · Aún no lo saben / 1 a 10 · 11 a 25 · 26 a 50 · Mais de 50 · Ainda não sabem
- `ops.nodes.empty`: No requests match these filters. / Ninguna solicitud coincide con estos filtros. / Nenhuma solicitação corresponde a estes filtros.

- [ ] **Step 1: Write the failing tests:**
  - `labels each request with its kind and shows a sponsor's community and range as text`: a list with one Nodo and one sponsorship (community `<b>Ciclistas</b>`, memberships `unsure`) renders `Nodo`/`Patrocinio` labels, `Comunidad: <b>Ciclistas</b>` as text, `Membresías: Aún no lo saben`, and no sponsor lines on the Nodo request.
  - `filters by kind`: choosing `sponsorship` in `adminNodeKind` requests `/api/admin/node-requests?kind=sponsorship`; with status `new` too, both parameters; "Load more" keeps both; an empty result shows `ops.nodes.empty`.
  - The tab test now expects the tab text `Organizaciones` in es; the language re-render test covers the kind label.
- [ ] **Step 2: Run** `node --test tests/node-requests-desk-ui.test.js` — expected: new tests FAIL.
- [ ] **Step 3: Implement** in `renderNodeRequest`: a `p.admin-node-kind` before the `h3`; for sponsorships, `p.admin-node-community` and `p.admin-node-memberships` before the message; `nodeFilterSnapshot()` returns `{status, kind}` (only non-empty ones are sent, as today); the kind select reloads like the status select.
- [ ] **Step 4: Bump** `admin.js` and `i18n-dashboard.js` (and `admin.css` if touched) to `?v=20261109a` on every page that loads them, with their pins.
- [ ] **Step 5: Run** `node --test tests/node-requests-desk-ui.test.js tests/catalog-ui.test.js tests/founders-desk-ui.test.js tests/deploy.test.js tests/home-i18n.test.js` — expected: PASS (catalog-ui checks every `ops.*` key resolves in three languages).
- [ ] **Step 6: Commit** — "Show and filter sponsorship requests in the desk's organisations band".

### Task 6: Privacy policy and docs

**Files:**
- Modify: `docs/privacy/privacy-policy.es.md`, `privacy-policy.en.md`, `privacy-policy.pt-BR.md` (the organisation-requests row, section 4 bullet, section 9 retention lines), the built privacy page via `node scripts/build-privacy-page.js`, `docs/privacy/implementation-review.md` (node_requests row), `docs/architecture.md` (email row)
- Test: `tests/privacy-page.test.js`

- [ ] **Step 1: Write the failing test** in `tests/privacy-page.test.js`: in each language the organisation-requests row names sponsoring memberships (es `patrocinar membresías`, en `sponsoring memberships`, pt `patrocinar membresias`), the community and the approximate number of memberships, and says no data about the community's members is collected; the row's heading is "Solicitudes de organizaciones" / "Organisation requests" / "Solicitações de organizações"; the built page contains the same text.
- [ ] **Step 2: Run** `node --test tests/privacy-page.test.js` — expected: FAIL.
- [ ] **Step 3: Edit** the three policies (sections 2, 4 and 9 say "solicitudes de organizaciones" where they now say "solicitudes de Nodo"), rebuild the page, update the implementation review and architecture rows.
- [ ] **Step 4: Run** `npm test` (whole suite) and `npm run lint` — expected: PASS, 0 failures.
- [ ] **Step 5: Commit** — "Cover sponsorship requests in the privacy policy and the architecture notes".

### After the tasks

- Browser check on the local preview (127.0.0.1): the window with no choice, both choices, `#patrocinio`, a sponsorship send stored locally, the desk band's label, lines and kind filter, at phone width too.
- Whole-branch review, then hand the owner: the migration commands from DEPLOYMENT.md (apply before pushing `main`), and the branch to merge.
