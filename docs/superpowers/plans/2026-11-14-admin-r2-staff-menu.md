# Admin R2: Staff Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the same staff bar (Publishing, Festival, Courses, Sign out) on the desk, the festival panel and the teaching workspace, and make the desk ask before unsaved news is lost, with the three tools otherwise behaving exactly as before.

**Architecture:** One static `<nav class="staff-nav">` pasted as the element just before `<main>` on three pages, one small script (`admin-nav.js`) that owns its labels in three languages and the sign-out, and one self-contained stylesheet (`admin-nav.css`). The public header, the tools' scripts and the dictionaries are not touched; the only edit inside a tool is one `beforeunload` listener in `admin.js`.

**Tech Stack:** Static HTML under a strict CSP, vanilla JS (`sourceType: script`), `node:test` with `node:vm` fakes, no dependency added.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md` (approved 14 Nov 2026), section "R2. Staff menu", plus its "Constraints from the codebase", "Tests" (the R2 bullet and the R2 row of "Existing tests and files that must change"), "Release order" and "Departures" (C1, M3, M11). This plan covers R2 only. R1 (visit counter) and R3 (home) have their own plans.

**Releases around this one.** R2 ships after R1 and before R3. It has **no migration, no table, no API route and no privacy text**: nothing for the owner to apply or repair in Supabase, and no read-only check file. It consumes two things from R1 (see Task 1 and Task 3 Interfaces) and produces the bar that R3 extends.

**Owner answers that gate this plan** (spec "Open questions for the owner"; none is answered yet, so the plan uses the spec's defaults):

| Question | Default planned on | Gates |
|---|---|---|
| 1 Retention, 2 Legal look, 3 Vercel cost | they gate R1, not R2 | Task 7 only: R2 is cut from R1's branch, so its push waits until R1 is pushed |
| 4, last sentence: "May R2 show its menu names before question 7 is answered?" (sheet question 7, `docs/metrics/indicadores-nodal.es.md:169`) | yes: "R2 does not wait" | Task 1 (the label table) and Task 7 (the push). A later rename costs the label table, a new `?v=` for `admin-nav.js` on three pages and the pins of Task 3 |
| 4, the reply-by date | not needed | nothing in R2 |
| 6 Will the report leave the team, 7 Non-admin team accounts | R3 only | nothing in R2 |
| Not in the spec: should "Sign out" ask **before** it closes the session when a tool has unsaved work? | no: the bar signs out first and the browser asks after (Review Focus 6). Asking first needs an edit inside the tools or the bar reading their state, both outside R2 | Task 7 Step 1 (put to the owner before the push). A yes is a spec change and new tasks, not a tweak here |

**Code in this plan is exact.** The test code of Tasks 1 to 4 and the stylesheet values of Task 2 are to be typed as written, not paraphrased: the regular expressions pin spacing and order. A reviewer applied Tasks 1 to 4 on a scratch copy of `82971df` before the review edits of 14 Nov (red, then green, lint clean); the edits made since (`min-width`, the status line kept rendered, two assertions after sign-out) have not been run, so Step 2 of each task is the check.

## Global Constraints

- Branch `admin-r2-staff-menu`, cut from R1's branch if R1 is not on `main` yet, else from `main`. Commit per task. **Never push**: the owner pushes.
- Line numbers below were checked on `82971df` (before R1). R1 adds one `<script>` to each head and one `visit.js` key to each pin line of `tests/deploy.test.js`; find each place by the quoted text and **add** to what R1 left, never replace it.
- The bar's markup is fixed by the spec, byte for byte (`BAR` in Task 1). No `<li>`, no `data-i18n`, no `id` inside it. In R2 it has three links: the fourth, `<a href="admin-home.html" data-staff="home">Metrics</a>`, is R3's.
- Labels, from the spec: EN Metrics, Publishing, Festival, Courses, Sign out, aria Administration; ES Indicadores, Publicación, Festival, Cursos, Cerrar sesión, aria Administración; PT Indicadores, Publicação, Festival, Cursos, Sair, aria Administração. The two status lines copy the desk's existing wording (`web/scripts/i18n-dashboard.js:704`, `:706`, `:1585`, `:1587`, `:2464`, `:2466`): Signing out… / Cerrando sesión… / Saindo…, and Sign out failed. / No se pudo cerrar la sesión. / Não foi possível sair.
- `admin-nav.js` holds its own labels: no function named `t`, no `t('…')`, no quoted `d.`/`p.`/`y.`/`ops.` key, no id lookup (`tests/deploy.test.js:381-410`, `:503-528`; `tests/i18n-split.test.js:44-56`). `web/scripts/i18n.js` (76,611 bytes, cap 80,000 at `tests/i18n-split.test.js:68`) and `i18n-dashboard.js` are not edited; `fiiu-admin.html` must still not load `i18n-dashboard.js` (`tests/i18n-split.test.js:92`).
- Scripts go in the head with `defer`, never `async` (`tests/page-loading.test.js:21-35`). `admin-nav.js` goes **before** `i18n.js`; it is the stated exception to "subscribers follow `i18n.js`" and is **not** added to the list at `tests/page-loading.test.js:41`.
- A new script is registered in `server/server.js:69`, `scripts/build-static.js:13`, `vercel.json:40`; a new stylesheet in `server/server.js:78`, `scripts/build-static.js:49`, `vercel.json:48`.
- CSP: no inline script or style, no `style=` attribute; DOM text only through `textContent`.
- Cache keys: the two new files get `?v=20261114a`, always: they have no earlier key to collide with. `admin.js` gets `?v=20261114a` too; only if `grep -n 'admin.js?v=20261114a' web/pages/admin.html` already finds it when Task 4 starts (today `:22` has `20261109a`, and R1 changes no `admin.js` key), use `20261114b` for `admin.js` alone and in its two pins of Task 4 Step 3. No other existing `?v=` changes.
- Not changed in R2: `web/scripts/fiiu-admin.js`, `web/scripts/teaching.js`, `web/scripts/pilot.js`, `web/pages/fiiu-qr.html`, `web/styles/admin.css`, `web/styles/fiiu.css`, `web/styles/courses.css`, `web/styles/styles.css`, the public header on any page, the desk's tab row and its two "away" links.
- Must pass untouched: `tests/fiiu-ui.test.js:939-946` (first `.nav-main` link), `tests/catalog-ui.test.js:1139` (the sign-out's place) and `:1744-1763`, `tests/founders-desk-ui.test.js:114-115` (every `<li><a href` on the desk), `tests/page-loading.test.js:36-44` and `:99-108` (the pilot banner directly after `</header>` on teaching).
- Montserrat only; no left accent bar; whitespace before rules; touch targets never under 44px in either direction (`min-width` and `min-height`: "Sair" alone is narrower than 44px).
- Tests must not read the real clock or the network. The Vercel build runs lint and the whole suite with production env, so the last code task runs both ways.

## Review Focus

1. **Browser storage is blocked** (Safari private mode, a managed browser): `localStorage.removeItem` throws. Sign-out must still end on the sign-in page (Task 1, `a browser that refuses storage still signs out`).
2. **Sign-out is refused or the network is down, or the button is pressed twice:** the button comes back, the line says so in the page's language, the person stays on the tool, and one request is sent (Task 1, `a refused or failed sign-out…` and `a second press while signing out sends nothing`).
3. **The page language is not one of the three when the script runs** (`lang=""`, `fr`): the bar reads English, never blank and never "undefined" (Task 1, `paints the page language at evaluation…`).
4. **A phone in Spanish or Portuguese:** the bar wraps to a second line, never clips, folds or pans the page sideways, and each item is a 44px target in both directions (Task 2 CSS test; Task 6 at 375px).
5. **Leaving the desk through the new bar with unsaved news,** including the "deleted elsewhere" state where the text is still on screen: the browser asks; an untouched or saved editor does not ask (Task 4, `the desk asks before leaving only while the news editor has unsaved text`).
6. **"Sign out" pressed with unsaved work** (desk news after Task 4; a teaching edit, `web/scripts/teaching.js:9`, on a page that had no sign-out before R2): the session is closed **first**, then `location.assign` makes the browser ask. Choosing "Stay" leaves the person on the tool with a closed session: saving answers 401, the bar's button stays disabled and its line keeps "Signing out…"; the text on screen can only be copied, and any bar link then leads to sign-in. This is a stated limit of R2, not a bug to fix here: `admin-nav.js` may not read the tools' state. Before R2 the desk's own sign-out lost unsaved news with no prompt at all. Covered by Task 1 (`sign-out POSTs…`, the two assertions after the redirect) and Task 6 Step 6; the owner is asked in Task 7 Step 1.

## File map

| File | Change | Responsibility |
|---|---|---|
| `web/scripts/admin-nav.js` | create (about 60 lines) | paint the bar's labels, follow language changes, sign out |
| `web/styles/admin-nav.css` | create | every rule of the bar, self-contained |
| `tests/admin-nav.test.js` | create | script, stylesheet, markup, head order, registration |
| `web/pages/admin.html` | modify | bar after `</header>` (`:40`), two tags, `hidden` on `#adminSignOut` (`:50`), `admin.js` key (`:22`) |
| `web/pages/fiiu-admin.html` | modify | bar between `</header>` and `<main` (`:20`), two tags (`:4`, `:5`) |
| `web/pages/teaching.html` | modify | bar between the `.pilot-notice` element and `<main` (`:12`), two tags (`:6`, `:7`) |
| `web/scripts/admin.js` | modify | one `beforeunload` listener after `newsDirty` (`:917`) |
| `server/server.js`, `scripts/build-static.js`, `vercel.json` | modify | register the two files |
| `tests/deploy.test.js`, `tests/founders-desk-ui.test.js`, `tests/catalog-ui.test.js` | modify | cache-key pins; the desk prompt test and its harness option |
| `README.md`, `docs/course-pilot-operations.md`, `docs/implementation/fiiu-2026.md` | modify | say the bar exists |

---

### Task 1: `admin-nav.js`: labels, language, sign-out

**Files:**
- Create: `web/scripts/admin-nav.js`
- Create: `tests/admin-nav.test.js`
- Modify: `server/server.js:69` (`STATIC_SCRIPTS`), `scripts/build-static.js:13-48` (`STATIC_SCRIPTS`), `vercel.json:40` (the `.js` header source)

**Interfaces:**
- Consumes (R1, by name only): the staff marker `localStorage['nodal.staff']`, set by R1's `visit.js` on a page whose tag carries `data-staff`. R2 only removes it. Nothing here fails if R1 is absent.
- Consumes (existing): `POST /api/auth/logout` (`server/server.js:1969-1973`: 200 `{ok:true}`, 403 cross-origin); `window.nodalI18n.onChange(fn)` and `document.documentElement.lang` (`web/scripts/i18n.js:1117-1123`, `web/scripts/locale.js:65`).
- Produces: a classic script with no export and no global. Its whole contract with the page, which the test's fake DOM implements and nothing more:
  - `document.querySelector('[data-staff-nav]')` → the bar, or `null` (then the script does nothing).
  - `nav.querySelectorAll('[data-staff]')` → the links and the button; each is painted by its `dataset.staff` key (`home`, `desk`, `festival`, `courses`, `signOut`) through `textContent`; a key with no label is left as it is.
  - `nav.setAttribute('aria-label', …)`; `nav.querySelector('[data-staff-status]')` → the status `<span>`, painted through `textContent` (empty when idle).
  - Language: `document.documentElement.lang`, read on every paint; anything but `es` or `pt` is English.
  - `document.addEventListener('DOMContentLoaded', fn, { once: true })`, whose `fn` calls `window.nodalI18n?.onChange(paint)`.
  - Sign-out: a `click` listener on the `signOut` element; `fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })`; then `localStorage.removeItem('nodal.staff')` and `location.assign('/login.html')`.
  - After an OK answer nothing is repainted: the button stays disabled and the status line keeps the "signing out" text. That is also what remains if the browser's leave prompt (a tool's `beforeunload`) is answered "Stay": the session is already closed and the script does not try to detect or undo it (Review Focus 6).
  - R3 relies on: the `home` label already in the table, and painting any element carrying `data-staff` inside the bar.

- [ ] **Step 1: Write the failing tests** in new `tests/admin-nav.test.js`. Header and harness:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const script = () => read('web', 'scripts', 'admin-nav.js');
// The spec's markup, byte for byte (R2: three links).
const BAR = '<nav class="staff-nav" data-staff-nav aria-label="Administration"><a href="admin.html" data-staff="desk">Publishing</a><a href="fiiu-admin.html" data-staff="festival">Festival</a><a href="teaching.html" data-staff="courses">Courses</a><button type="button" data-staff="signOut">Sign out</button><span role="status" aria-live="polite" data-staff-status></span></nav>';
const WORDS = {
  en: [['Publishing', 'Festival', 'Courses', 'Sign out'], 'Administration', 'Signing out…', 'Sign out failed.', 'Metrics'],
  es: [['Publicación', 'Festival', 'Cursos', 'Cerrar sesión'], 'Administración', 'Cerrando sesión…', 'No se pudo cerrar la sesión.', 'Indicadores'],
  pt: [['Publicação', 'Festival', 'Cursos', 'Sair'], 'Administração', 'Saindo…', 'Não foi possível sair.', 'Indicadores'],
};

// The bar as fake elements, admin-nav.js run in a vm, and optionally the real i18n.js after it in the same context.
function mount({ bar = BAR, lang = 'en', fetch = async () => ({ ok: true, status: 200 }), removeItem = null, withI18n = false } = {}) {
  const node = (tag, attributes, text) => {
    const attrs = Object.fromEntries([...attributes.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']));
    return { tag, attrs, textContent: text, disabled: false, listeners: new Map(),
      dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase()), v])),
      setAttribute(name, value) { this.attrs[name] = String(value); }, getAttribute(name) { return this.attrs[name] ?? null; },
      addEventListener(name, fn) { this.listeners.set(name, fn); } };
  };
  const children = [...bar.matchAll(/<(a|button|span)\b([^>]*)>([^<]*)<\/\1>/g)].map((m) => node(m[1], m[2], m[3]));
  const nav = bar ? Object.assign(node('nav', bar.match(/^<nav\b([^>]*)>/)[1], ''), {
    querySelectorAll: (selector) => (selector === '[data-staff]' ? children.filter((child) => 'staff' in child.dataset) : []),
    querySelector: (selector) => (selector === '[data-staff-status]' ? children.find((child) => 'staffStatus' in child.dataset) : null),
  }) : null;
  const ready = [];
  const removed = [];
  const document = {
    body: { dataset: {} }, documentElement: { lang, dataset: {} },
    querySelector: (selector) => (selector === '[data-staff-nav]' ? nav : null),
    querySelectorAll: () => [],
    addEventListener(name, fn, options) { if (name === 'DOMContentLoaded') ready.push({ fn, options }); },
  };
  const context = { URLSearchParams, document, console, fetch,
    localStorage: { getItem: () => lang, setItem() {}, removeItem: removeItem || ((key) => { removed.push(key); }) },
    location: { search: '', assigned: '', assign(value) { this.assigned = value; } } };
  context.window = context;
  vm.runInNewContext(script(), context, { filename: 'admin-nav.js' });
  if (withI18n) vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  const by = (key) => children.find((child) => child.dataset.staff === key);
  return { context, nav, ready, removed, by, location: context.location,
    labels: () => ['desk', 'festival', 'courses', 'signOut'].map((key) => by(key).textContent),
    status: () => children.find((child) => 'staffStatus' in child.dataset).textContent,
    press: () => by('signOut').listeners.get('click')() };
}
```

  The tests (the harness starts the real `i18n.js` in `lang` through `localStorage.getItem`, as `locale.js` does on a page):

```js
test('paints the page language at evaluation, before i18n.js exists, and reads English for any other language', () => {
  for (const lang of ['en', 'es', 'pt', 'fr', '']) {
    const [labels, aria] = WORDS[lang] || WORDS.en;
    const h = mount({ lang });
    assert.deepEqual(h.labels(), labels, lang);
    assert.equal(h.nav.getAttribute('aria-label'), aria, lang);
    assert.equal(h.status(), '', 'the status line is empty until sign-out starts');
    assert.equal(h.context.nodalI18n, undefined);
  }
});

test('subscribes once the document is ready and follows the real i18n.js', () => {
  const h = mount({ lang: 'es', withI18n: true });
  assert.equal(h.ready.length, 1);
  assert.equal(h.ready[0].options?.once, true);
  h.context.nodalI18n.apply('pt');
  assert.deepEqual(h.labels(), WORDS.es[0], 'not subscribed before DOMContentLoaded');
  h.ready[0].fn();
  h.context.nodalI18n.apply('en');
  assert.deepEqual(h.labels(), WORDS.en[0]);
  assert.equal(h.nav.getAttribute('aria-label'), 'Administration');
  h.context.nodalI18n.apply('pt');
  assert.deepEqual(h.labels(), WORDS.pt[0]);
  assert.equal(h.nav.getAttribute('aria-label'), 'Administração');
});

test('already names the home link R3 adds, and leaves an unknown key alone', () => {
  const bar = BAR.replace('<a href="admin.html"', '<a href="admin-home.html" data-staff="home">Metrics</a><a href="x.html" data-staff="later">Later</a><a href="admin.html"');
  for (const lang of ['en', 'es', 'pt']) {
    const h = mount({ bar, lang });
    assert.equal(h.by('home').textContent, WORDS[lang][4], lang);
    assert.equal(h.by('later').textContent, 'Later');
  }
});

test('a page without the bar: the script does nothing', () => {
  const h = mount({ bar: '' });
  assert.equal(h.ready.length, 0);
});

test('sign-out POSTs, clears the staff marker and opens the sign-in page', async () => {
  const calls = [];
  let release;
  const h = mount({ lang: 'es', fetch: (url, options) => { calls.push([url, options]); return new Promise((resolve) => { release = resolve; }); } });
  const done = h.press();
  assert.equal(h.by('signOut').disabled, true);
  assert.equal(h.status(), 'Cerrando sesión…');
  assert.deepEqual(h.removed, [], 'the marker stays until the session is closed');
  release({ ok: true, status: 200 });
  await done;
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }]]);
  assert.deepEqual(h.removed, ['nodal.staff']);
  assert.equal(h.location.assigned, '/login.html');
  // If a tool's leave prompt is answered "Stay", this is what remains on screen (Review Focus 6).
  assert.equal(h.by('signOut').disabled, true);
  assert.equal(h.status(), 'Cerrando sesión…');
});

test('a second press while signing out sends nothing', async () => {
  let count = 0;
  let release;
  const h = mount({ fetch: () => { count += 1; return new Promise((resolve) => { release = resolve; }); } });
  const first = h.press();
  const second = h.press();
  release({ ok: true, status: 200 });
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('a refused or failed sign-out gives the button back and says so in the page language', async () => {
  for (const fetch of [async () => ({ ok: false, status: 403 }), async () => { throw new TypeError('offline'); }]) {
    const h = mount({ lang: 'pt', fetch, withI18n: true });
    h.ready[0].fn();
    await h.press();
    assert.equal(h.by('signOut').disabled, false);
    assert.equal(h.status(), 'Não foi possível sair.');
    assert.equal(h.location.assigned, '');
    assert.deepEqual(h.removed, []);
    h.context.nodalI18n.apply('en');
    assert.equal(h.status(), 'Sign out failed.', 'the line follows a language change');
    assert.deepEqual(h.labels(), WORDS.en[0]);
  }
});

test('a browser that refuses storage still signs out', async () => {
  const h = mount({ removeItem: () => { throw new Error('SecurityError'); } });
  await h.press();
  assert.equal(h.location.assigned, '/login.html');
});

test('admin-nav.js keeps its own labels and looks nothing up by id', () => {
  const js = script();
  assert.doesNotMatch(js, /\bt\(/, 'no function named t: deploy.test.js reads t(\'…\') as a dictionary key');
  assert.doesNotMatch(js, /['"`](?:d|p|y|ops)\./, 'no dictionary key');
  assert.doesNotMatch(js, /getElementById|\bbyId\(|querySelector\(\s*['"]#/);
  assert.doesNotMatch(js, /innerHTML|\.style\b|document\.cookie|sendBeacon/);
  assert.ok(js.length < 4000, 'about 60 lines');
});

test('admin-nav.js is served, built and cached like the desk script', () => {
  const serverSource = read('server', 'server.js');
  const buildSource = read('scripts', 'build-static.js');
  const vercel = JSON.parse(read('vercel.json'));
  const list = (source, name) => source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))?.[1] || '';
  const merged = (url) => Object.fromEntries(vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(url)).flatMap((r) => r.headers.map(({ key, value }) => [key, value])));
  assert.ok(existsSync(path.join(ROOT, 'web', 'scripts', 'admin-nav.js')));
  assert.ok(list(serverSource, 'STATIC_SCRIPTS').includes("'admin-nav.js'"));
  assert.ok(list(buildSource, 'STATIC_SCRIPTS').includes("'admin-nav.js'"));
  assert.deepEqual(merged('/admin-nav.js'), merged('/admin.js'));
});
```

- [ ] **Step 2: Run** `node --test tests/admin-nav.test.js`. Expected: every test FAILS (`ENOENT … web/scripts/admin-nav.js`; the last one on the missing file and registration).
- [ ] **Step 3: Implement** `web/scripts/admin-nav.js` as one IIFE that returns at once when the bar is absent. One label table keyed by the eight names (`home`, `desk`, `festival`, `courses`, `signOut`, the aria label and the two status lines), each an `[en, es, pt]` row with the exact words of Global Constraints. One `paint()` that takes no argument it depends on (`onChange` passes the language; read `document.documentElement.lang` instead), writes the labels, the aria label and the current status line. The click handler returns when the button is already disabled; on a non-OK answer or a thrown `fetch` it re-enables the button and shows the failure line; the marker is removed only after an OK answer, inside its own `try`; after an OK answer the button is not re-enabled and the status line is not cleared. Call `paint()` at evaluation, then register the `DOMContentLoaded` listener. Add `'admin-nav.js'` to the two `STATIC_SCRIPTS` lists and `admin-nav` to the alternation in `vercel.json:40`.
- [ ] **Step 4: Run** `node --test tests/admin-nav.test.js tests/deploy.test.js tests/i18n-split.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add web/scripts/admin-nav.js tests/admin-nav.test.js server/server.js scripts/build-static.js vercel.json`; message "Add the staff bar's script: its own labels in three languages and sign-out".

### Task 2: `admin-nav.css`: the bar's own, self-contained styles

**Files:**
- Create: `web/styles/admin-nav.css`
- Modify: `server/server.js:78` (`STATIC_STYLES`), `scripts/build-static.js:49` (`STATIC_STYLES`), `vercel.json:48` (the `.css` header source)
- Test: `tests/admin-nav.test.js`

**Interfaces:**
- Consumes: the markup `BAR` of Task 1 (`.staff-nav`, `a`, `a[aria-current="page"]`, `button`, `[data-staff-status]`); the body classes `admin-page`, `f-page`, `pilot-page` of the three pages.
- Produces: the stylesheet Task 3 links last on each page. One custom property, `--staff-gutter`, private to this file.

Values this task fixes (the page's own variables are not used: teaching loads no `styles.css` and neither `admin.css` nor `fiiu.css`):

- `.staff-nav`: `display: flex; flex-wrap: wrap; align-items: center; gap: 0 24px; padding: 0 var(--staff-gutter); font: 500 .9375rem/1.4 Montserrat, sans-serif; color: #3d5c38;` with `--staff-gutter: clamp(20px, 4vw, 56px)`, the public header's side padding (`web/styles/styles.css:104`). No background, border, shadow or `position`.
- `.pilot-page .staff-nav`: `--staff-gutter: max(28px, calc((100vw - 1320px) / 2))`, the teaching header's side padding (`web/styles/courses.css:22`); inside `@media (max-width: 760px)` it is `20px` (`courses.css:224`).
- `.staff-nav a, .staff-nav button`: `display: inline-flex; align-items: center; min-width: 44px; min-height: 44px; margin: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-decoration: none; cursor: pointer;`
- `.staff-nav a:hover, .staff-nav button:hover`: `text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 6px;`
- `.staff-nav a[aria-current="page"]`: `font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 6px;`
- `.staff-nav button`: `margin-left: auto; justify-content: flex-end;` (sign-out sits at the far end; when the row wraps it stays at the end of its line; a label narrower than 44px, "Sair", keeps its text on the gutter edge). `.staff-nav button:disabled`: `opacity: .5; cursor: wait;`
- `.staff-nav :focus-visible`: `outline: 2px solid #286998; outline-offset: 3px; border-radius: 4px;` (the staff pages' ring, `web/styles/admin.css:21`).
- `.staff-nav [data-staff-status]`: `flex-basis: 100%; padding-bottom: 8px; font-size: .875rem; text-align: right;` and `.staff-nav [data-staff-status]:empty`: `padding-bottom: 0;`. The line is never `display: none`: it is a live region (`role="status"`), and one that is not rendered when its text arrives is often not announced. Empty, with no padding and the bar's row gap of 0, it takes a line of zero height.

- [ ] **Step 1: Write the failing tests** in `tests/admin-nav.test.js`:

```js
test('admin-nav.css is scoped to the bar, self-contained, wraps and never sticks or folds', () => {
  const css = read('web', 'styles', 'admin-nav.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim());
  assert.ok(selectors.length >= 9);
  for (const selector of selectors) assert.match(selector, /\.staff-nav\b/, selector);
  // Not sticky (the offsets at admin.css:24 and fiiu.css:74 hold), nothing clipped, no borrowed variable, no accent bar.
  assert.doesNotMatch(css, /position\s*:|overflow|nowrap/);
  assert.doesNotMatch(css, /border-left|box-shadow|@import|url\(|!important|var\(--(?!staff-gutter\))/);
  assert.match(css, /\.staff-nav\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.staff-nav\s*\{[^}]*font:\s*500 \.9375rem\/1\.4 Montserrat, sans-serif;/);
  assert.match(css, /\.staff-nav\s*\{[^}]*--staff-gutter:\s*clamp\(20px, 4vw, 56px\);/);
  assert.match(css, /\.pilot-page \.staff-nav\s*\{\s*--staff-gutter:\s*max\(28px, calc\(\(100vw - 1320px\) \/ 2\)\);\s*\}/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.pilot-page \.staff-nav\s*\{\s*--staff-gutter:\s*20px;\s*\}\s*\}/);
  assert.match(css, /\.staff-nav a,\s*\.staff-nav button\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px;[^}]*border:\s*0;[^}]*background:\s*none;[^}]*font:\s*inherit;/);
  assert.match(css, /\.staff-nav a\[aria-current="page"\]\s*\{\s*font-weight:\s*700;\s*text-decoration:\s*underline;\s*text-decoration-thickness:\s*1px;/);
  assert.match(css, /\.staff-nav button\s*\{\s*margin-left:\s*auto;\s*justify-content:\s*flex-end;\s*\}/);
  assert.match(css, /\.staff-nav :focus-visible\s*\{\s*outline:\s*2px solid #286998;/);
  assert.match(css, /\.staff-nav \[data-staff-status\]:empty\s*\{\s*padding-bottom:\s*0;\s*\}/);
  assert.doesNotMatch(css, /display:\s*none|visibility\s*:/, 'nothing is hidden: the bar never folds and the status line stays a rendered live region');
});

test('admin-nav.css is served, built and cached like the desk stylesheet', () => {
  const serverSource = read('server', 'server.js');
  const buildSource = read('scripts', 'build-static.js');
  const vercel = JSON.parse(read('vercel.json'));
  const list = (source, name) => source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))?.[1] || '';
  const merged = (url) => Object.fromEntries(vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(url)).flatMap((r) => r.headers.map(({ key, value }) => [key, value])));
  assert.ok(list(serverSource, 'STATIC_STYLES').includes("'admin-nav.css'"));
  assert.ok(list(buildSource, 'STATIC_STYLES').includes("'admin-nav.css'"));
  assert.deepEqual(merged('/admin-nav.css'), merged('/admin.css'));
});
```

- [ ] **Step 2: Run** `node --test tests/admin-nav.test.js`. Expected: the two new tests FAIL (`ENOENT … admin-nav.css`); Task 1's still PASS.
- [ ] **Step 3: Write** `web/styles/admin-nav.css` with exactly the rules listed above, one comment at the top saying the file is self-contained because teaching loads no site stylesheet. Add `'admin-nav.css'` to the two `STATIC_STYLES` lists and `admin-nav` to the alternation in `vercel.json:48`.
- [ ] **Step 4: Run** `node --test tests/admin-nav.test.js tests/deploy.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add web/styles/admin-nav.css tests/admin-nav.test.js server/server.js scripts/build-static.js vercel.json`; message "Style the staff bar on its own, so it reads the same on the three staff pages".

### Task 3: The bar on the three staff pages, with its tags and cache keys

**Files:**
- Modify: `web/pages/admin.html` (`:16` stylesheet, `:20` script, `:40` `</header>`), `web/pages/fiiu-admin.html` (`:4`, `:5`, `:20`), `web/pages/teaching.html` (`:6`, `:7`, `:12`)
- Modify: `tests/deploy.test.js:332`, `:335`, `:338` (the `admin.html`, `teaching.html`, `fiiu-admin.html` rows of `required`)
- Test: `tests/admin-nav.test.js`

**Interfaces:**
- Consumes: `BAR`, `admin-nav.js` (Task 1), `admin-nav.css` (Task 2).
- Consumes (R1): the tag `<script defer src="visit.js?v=…" data-staff>`, last in the head of the three pages and of `fiiu-qr.html`. R2 leaves it last. The bar's links and button also carry a `data-staff` attribute, with a value; R1's tag carries it bare.
- Produces (for R3): on each page exactly one `<nav class="staff-nav" data-staff-nav …>` as the element just before `<main>`; the page's own link carries `aria-current="page"` directly after its `data-staff` attribute (`<a href="admin.html" data-staff="desk" aria-current="page">`). R3 inserts its link as the bar's first child on the three pages and reuses the bar on `admin-home.html`.

- [ ] **Step 1: Write the failing tests** in `tests/admin-nav.test.js`:

```js
const STAFF_PAGES = { 'admin.html': 'desk', 'fiiu-admin.html': 'festival', 'teaching.html': 'courses' };
const page = (name) => read('web', 'pages', name);

test('the bar is the same on every staff page but for aria-current, and is the element just before <main>', () => {
  assert.doesNotMatch(BAR, /<li\b|data-i18n|\bid=/);
  for (const [name, own] of Object.entries(STAFF_PAGES)) {
    const html = page(name);
    const bars = html.match(/<nav class="staff-nav"[\s\S]*?<\/nav>/g) || [];
    assert.equal(bars.length, 1, name);
    assert.equal(bars[0].replace(` data-staff="${own}" aria-current="page"`, ` data-staff="${own}"`), BAR, name);
    assert.equal((bars[0].match(/aria-current/g) || []).length, 1, name);
    const at = html.indexOf(bars[0]);
    assert.match(html.slice(at + bars[0].length), /^\s*<main\b/, `${name}: <main> follows the bar`);
    const before = name === 'teaching.html'
      ? /<div class="pilot-notice" data-pilot-banner hidden>[\s\S]*?<\/div>\s*$/
      : /<\/header>\s*$/;
    assert.match(html.slice(0, at), before, `${name}: what the bar follows`);
  }
  // The pilot banner keeps its place (tests/page-loading.test.js:107) and the public header its first link (tests/fiiu-ui.test.js:939-946).
  assert.match(page('teaching.html'), /<\/header>\s*<div class="pilot-notice" data-pilot-banner/);
});

test('each staff page loads admin-nav.js deferred before the dictionaries and admin-nav.css last', () => {
  for (const name of Object.keys(STAFF_PAGES)) {
    const html = page(name);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script defer src="admin-nav\.js\?v=20261114a"><\/script>/, name);
    const scripts = [...head.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map((m) => m[1]);
    const next = name === 'admin.html' ? 'i18n-dashboard.js' : 'i18n.js';
    assert.equal(scripts[scripts.indexOf('admin-nav.js') + 1], next, `${name}: directly before ${next}`);
    assert.ok(scripts.indexOf('admin-nav.js') < scripts.indexOf('i18n.js'), name);
    const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sheets.at(-1), 'admin-nav.css?v=20261114a', name);
  }
});

test('the door-screen list has no bar', () => {
  assert.doesNotMatch(page('fiiu-qr.html'), /staff-nav|admin-nav\.(?:js|css)/);
});
```

- [ ] **Step 2: Add the pins** in `tests/deploy.test.js`: `'admin-nav.js': '20261114a', 'admin-nav.css': '20261114a'` in the `'admin.html'` row (`:332`), the `'teaching.html'` row (`:335`) and the `'fiiu-admin.html'` row (`:338`). Keep every key already there (R1's `visit.js` among them).
- [ ] **Step 3: Run** `node --test tests/admin-nav.test.js tests/deploy.test.js`. Expected: the first two new tests and `changed one-hour-cached clients use new URLs on every consuming page` FAIL; the rest PASS, `the door-screen list has no bar` among them (it passes before and after: it is a guard, not a red test).
- [ ] **Step 4: Edit the three pages.**
  - Bar: paste `BAR` with `aria-current="page"` on the page's own link. `admin.html`: on its own line after `</header>` (`:40`), before `<main class="admin-shell" id="adminMain">`. `fiiu-admin.html`: between `</header>` and `<main class="f-shell" id="fiiuMain">` (`:20`). `teaching.html`: between the closing `</div>` of `<div class="pilot-notice" data-pilot-banner hidden>` and `<main class="pilot-main" id="pilotMain">` (`:12`).
  - Script tag `<script defer src="admin-nav.js?v=20261114a"></script>`: `admin.html` directly before the `i18n-dashboard.js` tag (`:20`); `fiiu-admin.html` directly before the `i18n.js` tag (`:5`); `teaching.html` directly before the `i18n.js` tag (`:7`).
  - Stylesheet tag `<link rel="stylesheet" href="admin-nav.css?v=20261114a" />` (on `fiiu-admin.html` written `<link rel="stylesheet" href="admin-nav.css?v=20261114a">`, the page's own form): after `admin.css` (`admin.html:16`), after `fiiu.css` (`fiiu-admin.html:4`), after `courses.css` (`teaching.html:6`).
- [ ] **Step 5: Run** `node --test tests/admin-nav.test.js tests/deploy.test.js tests/page-loading.test.js tests/i18n-split.test.js tests/fiiu-ui.test.js tests/catalog-ui.test.js tests/founders-desk-ui.test.js tests/page-csp.test.js`. Expected: PASS, with no edit to any of the last six files.
- [ ] **Step 6: If R1 is on this branch, run** `node --test tests/visit-script.test.js`. Expected: PASS. If it fails because it counts a bare `data-staff` anywhere in a page, anchor that test's pattern to the tag (`<script[^>]*\bsrc="visit\.js[^>]*\bdata-staff\b`); the bar's markup is the spec's and does not change.
- [ ] **Step 7: Commit**: `git add web/pages/admin.html web/pages/fiiu-admin.html web/pages/teaching.html tests/admin-nav.test.js tests/deploy.test.js` (and `tests/visit-script.test.js` if Step 6 changed it); message "Put the staff bar on the desk, the festival panel and the teaching workspace".

### Task 4: Desk: sign-out moves to the bar, and a prompt before unsaved news is lost

**Files:**
- Modify: `web/pages/admin.html:50` (`hidden` on `#adminSignOut`), `:22` (`admin.js?v=20261114a`)
- Modify: `web/scripts/admin.js` (one statement directly after `const newsDirty = …`, `:917`)
- Modify: `tests/catalog-ui.test.js` (`adminHarness`, `:176`; one new test after `desk deletes a news post only after confirmation and guards unsaved edits`, `:2089-2121`), `tests/deploy.test.js:332` (`'admin.js': '20261114a'`), `tests/founders-desk-ui.test.js:133`
- Not modified: `web/styles/admin.css` (its `[hidden] { display: none !important; }` at `:45` already hides the button, so the spec's open choice "whether `.admin-textbutton[hidden]` needs a rule" is answered no) and therefore its pins at `tests/founders-desk-ui.test.js:132` and `tests/node-requests-desk-ui.test.js:390`.

**Interfaces:**
- Consumes: `newsDirty()` (`web/scripts/admin.js:917`: true when the news form differs from `news.snapshot`; `''` after "deleted elsewhere", `:1086`, so that state is dirty); the bar of Task 3, which now offers sign-out on the desk.
- Produces: `adminHarness(fetchImpl, { lang, confirm, windowListeners })`: when `windowListeners` is a `Map`, the vm context gets `addEventListener(name, handler)` that stores into it. Without it the context still has no `window.addEventListener`, as today (`tests/catalog-ui.test.js:184-199`).

- [ ] **Step 1: Extend the harness** in `tests/catalog-ui.test.js`: add `windowListeners = null` to `adminHarness`'s options and, before `context.window = context`, `if (windowListeners) context.addEventListener = (name, handler) => windowListeners.set(name, handler);`.
- [ ] **Step 2: Write the failing tests** in `tests/catalog-ui.test.js`:

```js
test('the desk asks before leaving only while the news editor has unsaved text', () => {
  const listeners = new Map();
  const h = adminHarness(undefined, { windowListeners: listeners });
  const leave = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    listeners.get('beforeunload')(event);
    return event;
  };
  h.api.fillNews(null);
  assert.equal(leave().prevented, false, 'an untouched editor lets the page go');
  assert.equal('returnValue' in leave(), false);
  h.ids.get('adminNewsTitle').value = 'Borrador';
  const asked = leave();
  assert.deepEqual([asked.prevented, asked.returnValue], [true, ''], 'unsaved news asks');
  h.api.fillNews(newsItem('n1'));
  assert.equal(leave().prevented, false, 'a loaded post with no edit lets the page go');
  // M11: the prompt covers the news editor only.
  h.ids.get('adminOrganization').value = 'Unsaved catalog text';
  assert.equal(leave().prevented, false);
  // Deleted elsewhere: the text is still on screen and unsaved.
  h.api.news.snapshot = '';
  assert.equal(leave().prevented, true);
});

test('the desk still loads where window has no addEventListener, and its own sign-out is hidden, not removed', () => {
  const js = adminScript();
  const at = js.indexOf("window.addEventListener?.('beforeunload'");
  assert.ok(at > js.indexOf('const newsDirty = ') && at < js.lastIndexOf('\n  bootstrap();'), 'after newsDirty, before bootstrap()');
  assert.equal(js.split("'beforeunload'").length, 2, 'one listener');
  assert.match(js, /\n  bootstrap\(\);\s*\n\}\)\(\);\s*$/);
  assert.ok(adminHarness().api, 'no window.addEventListener in this context');
  const html = adminPage();
  assert.match(html, /<button class="admin-textbutton" id="adminSignOut" type="button" data-i18n="ops\.signOut" hidden>Sign out<\/button>/);
  assert.match(html, /<div class="admin-head-side">[\s\S]*?id="adminSignOut"[\s\S]*?<\/div>/);
  assert.match(adminStyles(), /\[hidden\] \{ display: none !important; \}/);
});
```

- [ ] **Step 3: Move the pins** (first the one-line `grep` of Global Constraints, "Cache keys"): `'admin.js': '20261114a'` in the `'admin.html'` row of `tests/deploy.test.js` (`:332`); `src="admin\.js\?v=20261114a"` at `tests/founders-desk-ui.test.js:133`.
- [ ] **Step 4: Run** `node --test tests/catalog-ui.test.js tests/deploy.test.js tests/founders-desk-ui.test.js`. Expected: the two new tests, the cache-key test and `the desk has a Founder Membership tab…` FAIL; the rest PASS.
- [ ] **Step 5: Implement.** In `admin.js`, directly after the `newsDirty` line: `window.addEventListener?.('beforeunload', (event) => { … })`, which does nothing unless `newsDirty()` and then calls `event.preventDefault()` and sets `event.returnValue = ''` (the pattern of `web/scripts/fiiu.js:30`). In `admin.html` add the `hidden` attribute as the last attribute of `#adminSignOut` and change the `admin.js` tag to `?v=20261114a`. The button's listener in `admin.js:1396-1409` and its entry at `:90` stay.
- [ ] **Step 6: Run** `node --test tests/catalog-ui.test.js tests/deploy.test.js tests/founders-desk-ui.test.js tests/node-requests-desk-ui.test.js`. Expected: PASS (the existing `…and signs out` test at `tests/catalog-ui.test.js:1211` still drives the hidden button's listener).
- [ ] **Step 7: Commit**: `git add web/pages/admin.html web/scripts/admin.js tests/catalog-ui.test.js tests/deploy.test.js tests/founders-desk-ui.test.js`; message "Ask before unsaved news is lost on the desk, and leave sign-out to the staff bar".

### Task 5: Docs, the untouched-files check, and the whole suite both ways

**Files:**
- Modify: `README.md:124-132` (section "Publishing desk"), `docs/course-pilot-operations.md:7`, `docs/implementation/fiiu-2026.md` (new last section)
- Not modified, on purpose: `DEPLOYMENT.md` (R2 has no migration and no setting, so it gets no "migration before `main`" section), `docs/architecture.md` (`:22`, `:36` and `:108` concern R1 and R3), the three privacy policies and `docs/privacy/implementation-review.md` (R2 collects and stores nothing; R1's section 8 sentence, "removed when the sign-in page is opened there", stays true because the bar's sign-out lands on that page).

- [ ] **Step 1: Write the docs.**
  - `README.md`, new paragraph at the end of "Publishing desk": the three staff pages (`/admin.html`, `/fiiu-admin.html`, `/teaching.html`) carry the same staff bar under their header, with Publishing, Festival, Courses and Sign out in EN/ES/PT; its labels live in `web/scripts/admin-nav.js`, not in the dictionaries, and its styles in `web/styles/admin-nav.css`; the door-screen list (`/fiiu-qr.html`) has none; the desk asks before a page with unsaved news is left.
  - `docs/course-pilot-operations.md:7`, one sentence after "…open `/teaching.html`.": the bar under the header leads to the Publishing desk and the festival panel and signs out.
  - `docs/implementation/fiiu-2026.md`, new section `## Staff bar on the organiser dashboard (November 2026)`: the bar sits between the site header and the dashboard, is not sticky (the section row keeps `top: var(--f-header)`), the public header is unchanged, `fiiu-admin.js` is unchanged, `fiiu-qr.html` has no bar.
- [ ] **Step 2: Check what must not have changed**: `git diff --stat main -- web/scripts/fiiu-admin.js web/scripts/teaching.js web/scripts/pilot.js web/scripts/i18n.js web/scripts/i18n-dashboard.js web/pages/fiiu-qr.html web/styles/admin.css web/styles/fiiu.css web/styles/courses.css web/styles/styles.css`. Expected: no line from an R2 commit (R1's `visit.js` tag on `fiiu-qr.html` is R1's). And `git diff main -- web/pages | grep -E '^[-+].*\?v=' | grep -v -E 'admin-nav\.(js|css)|admin\.js|visit\.js'`. Expected: no output.
- [ ] **Step 3: Run** `npm run lint` then `npm test`. Expected: 0 lint warnings, 0 failing tests.
- [ ] **Step 4: Run with Vercel-like env**: `env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://example.org EMAIL_SMTP_URL=smtps://u:p@smtp.example.invalid:465 EMAIL_FROM="FIIU Fest 11 <fest@example.invalid>" npm run build`. Expected: lint, the suite and the static build all succeed.
- [ ] **Step 5: Commit**: `git add README.md docs/course-pilot-operations.md docs/implementation/fiiu-2026.md`; message "Document the staff bar on the three staff pages".

### Task 6: Local preview check on 127.0.0.1

No file in the repository changes. Use `http://127.0.0.1:<port>`, never `localhost` (cookies ignore ports and other agents share the pane).

- [ ] **Step 1: Start a preview.** Add a configuration `nodal-admin-r2` to `.claude/launch.json` (git-ignored) modelled on `nodal-sponsorship`: `DATA_BACKEND=sqlite`, a `DATABASE_PATH` in the session scratchpad, `PORT=4183`, `PUBLIC_BASE_URL=http://127.0.0.1:4183`. Seed that database once with `SEED_ADMIN_EMAIL` and a generated `SEED_ADMIN_PASSWORD` through `npm run seed:dev` (`README.md:160-165`), start it with the preview tool, and sign in at `/login.html` with that local account. Restart the preview after any edit under `server/`.
- [ ] **Step 2: Desktop, on `/admin.html`, `/fiiu-admin.html` and `/teaching.html`, in EN, ES and PT (nine views).** Expected on each: the bar between the header (on teaching, the pilot strip when shown) and the page's first heading; its left edge on the header's left edge; the page's own item bold with a thin underline; labels as in Global Constraints; switching language with the page's own buttons repaints the bar with no reload; a reload in ES or PT shows no English flash; no console error; `admin-nav.js?v=20261114a` and `admin-nav.css?v=20261114a` answer 200.
- [ ] **Step 3: Nothing moved.** Scroll each page: the bar scrolls away, the desk's tab row still sticks directly under the site header, the festival panel's section row likewise, and `/admin.html` → "Festival news →" still lands on `#content` at the right offset. The public header's links and "My console" are as before; the teaching header shows no new link. `/fiiu-qr.html` has no bar.
- [ ] **Step 4: 375px (mobile preset; reload after switching), the same nine views.** Expected: the bar wraps onto further lines and never folds behind the menu button; every item is at least 44px in both directions (in PT, "Sair" is 44px wide with its text on the right edge); `innerWidth <= visualViewport.width` in the console (no sideways pan); the public header still folds its own links.
- [ ] **Step 5: Sign-out and the prompt.** From each of the three pages "Sign out" ends on `/login.html`, and opening any of the three again, signed out, redirects to `/login.html?next=…` as before R2 (`server/server.js:1469-1473`; 403 is what a signed-in member gets, not a signed-out browser). With R1 present, `localStorage.getItem('nodal.staff')` is `null` afterwards. On the desk: type a news title and press "Festival" in the bar: the browser asks; staying keeps the text; after "Save draft" the same click leaves without asking. The desk head shows "View public catalog" and no second "Sign out". On teaching, an unsaved module edit still prompts on a bar link (its own guard, `web/scripts/teaching.js:9`).
- [ ] **Step 6: Sign-out with unsaved work (Review Focus 6).** Sign in again. On the desk type a news title, press "Sign out" in the bar, and choose "Stay" when the browser asks. Expected, as the stated limit: the title is still on screen, the bar's button is disabled and its line reads "Signing out…", "Save draft" fails with the desk's own error line (the session is closed), and pressing "Festival" then "Leave" ends on sign-in. Repeat on teaching with an unsaved module edit. Then the same press with "Leave": it ends on `/login.html`. Record what each page shows; anything worse than this (a blank page, a script error, the text gone while staying) is a failed step.
- [ ] **Step 7: Keyboard.** Tab from the header reaches the bar before the page's content, the focus ring is visible on all three pages (teaching included), and Enter on "Sign out" works. With a screen reader at hand (VoiceOver), "Signing out…" is announced when the button is pressed; without one, check in the inspector that the status `<span>` is rendered (not `display: none`) while empty and adds no height.
- [ ] **Step 8: Reset the viewport** to the desktop preset and stop the preview. Record any difference from the expectations as a failed step; fix it in the task that owns the file and rerun that task's tests.

### Task 7: Release checklist

- [ ] **Step 1: Owner answer.** Confirm with the owner that the menu may show its names before sheet question 7 is answered (open question 4; the plan's default is yes). If the answer renames an item, change the label table of Task 1 and the `WORDS` rows of its test before the push; no key changes while nothing has shipped. Also show the owner Review Focus 6 and the result of Task 6 Step 6: R2 ships with sign-out closing the session before the browser's leave prompt, unless the owner wants the prompt first, which is a spec change (an edit inside the tools) and holds the push.
- [ ] **Step 2: Migration.** None in R2: there is no file to apply with `supabase db query --linked -f`, nothing to `migration repair`, no check file to run. If R1's commits ride in the same push, R1's own apply-check-repair steps for `<ts>_visit_counts.sql` come first, by its plan.
- [ ] **Step 3: Whole-branch review**, then hand the owner the branch. The owner merges and runs `git push` (the agent does not).
- [ ] **Step 4: After the push**, check that the Production deployment of the pushed commit is `success` in the commit's status, not only that pages answer 200 (a failed build keeps serving the old one). If it failed, ask the owner for `npx vercel inspect <dpl_id> --logs`.
- [ ] **Step 5: Read-only production checks.** `curl -sI "https://sistema-urbano-nodal-ten.vercel.app/admin-nav.js?v=20261114a"` and the same for `admin-nav.css`: `200` with `cache-control: public, max-age=3600, stale-while-revalidate=86400`. `curl -sI https://sistema-urbano-nodal-ten.vercel.app/fiiu-admin.html` signed out: `302` to sign-in, as before. Then the owner, signed in as an administrator, opens the three pages: the bar is there in the chosen language, and "Sign out" ends on the sign-in page.
- [ ] **Step 6: Rollback, if needed:** revert the R2 commits and push; there is no data and no migration to undo.
- [ ] **Step 7: Hold.** R3's push waits for the sheet answers (spec "What waits for the sheet"); R3 adds the fourth link, so C1's four-item menu holds only from R3.
