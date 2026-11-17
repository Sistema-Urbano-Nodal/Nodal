# Admin Link in Mi panel's Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins see a distinct "Indicadores y gestión" link at the top of Mi panel's left rail, first on phones too.

**Architecture:** Move the existing admin-only link (`#publishLink`) out of Herramientas into a new first group of
`.side-nav` (label `#staffLabel` + link), both `hidden` in the markup and revealed together by the existing admin check in
`dashboard.js` `init()`. A modifier class gives it the beige look. No server change.

**Tech Stack:** Plain HTML/CSS/JS under a strict CSP (no inline script or style), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-admin-rail-link-design.md`

## Global Constraints

- Words: label `d.nav.team` = Team / Equipo / Equipe; link `d.nav.publish` = Metrics and tools / Indicadores y gestión / Indicadores e gestão.
- Link keeps `id="publishLink"`, `href="admin-home.html"`; shown only when `/api/auth/me` answers `permission === 'admin'`.
- Look: background and border `var(--beige)` (#f2ecec), text and icon `var(--forest)` (#3d5c38); same pill, size, focus ring and 44px touch targets as other rail links.
- Icon: trend line on two axes, not the bar icon (that is "Rutas comunitarias").
- Members see nothing new and their rail looks exactly as before (General label keeps its first-group spacing).
- Bump `?v=` on every changed asset on every page that loads it, and the pins in `tests/deploy.test.js`: `dashboard.css` 42→43; `dashboard.js` and `i18n-dashboard.js` → `20261117a` (i18n-dashboard.js is on dashboard, payments, profile and admin pages).
- Body text ≥ .875rem is not touched; no new lines or left bars.

## Review Focus

- A member (or a failed session read): no Equipo label, no link, and the General label still has no top rule/margin.
- A touch phone ≤760px: the admin link is the first chip of the sideways row, in view without scrolling, and its keyboard focus ring is visible on beige (the phone rule makes rail rings white).
- Portuguese at the 246px rail and in the ≤980px row: the label wraps on the rail, never truncates, and causes no sideways page pan.
- The course pilot's "Cursos" link (added by pilot.js) still lands among the tools, not inside the staff group.
- Hover and pressed states stay in the brand palette and never look like the bright-green "you are here" link.

---

### Task 1: Staff group at the top of the rail

**Files:**
- Modify: `web/pages/dashboard.html` (rail markup; `?v=` keys)
- Modify: `web/scripts/dashboard.js` (`init()`: reveal the label with the link)
- Modify: `web/scripts/i18n-dashboard.js` (`d.nav.publish` words; new `d.nav.team` in en/es/pt)
- Modify: `web/styles/dashboard.css` (`.side-link-staff` look, first-label rule, phone focus ring)
- Modify: `web/pages/payments.html`, `web/pages/profile.html`, `web/pages/admin.html` (`i18n-dashboard.js?v=`)
- Test: `tests/dashboard-publishing.test.js`, `tests/home-i18n.test.js` (`later` list gets `d.nav.team`), `tests/deploy.test.js` (pins)

**Interfaces:**
- Consumes: `byId`, `api('/api/auth/me')` in `init()`.
- Produces: `#staffLabel` (`<p class="side-label" id="staffLabel" data-i18n="d.nav.team" hidden>`) as the first child of
  `.side-nav`, then `<a class="side-link side-link-staff" href="admin-home.html" id="publishLink" hidden>` with the new icon
  and `<span data-i18n="d.nav.publish">`.

- [ ] **Step 1: Write the failing tests** in `tests/dashboard-publishing.test.js`
  - `consoleFor` returns both nodes (`publishLink`, `staffLabel`); test "the console shows the staff group to admins only":
    admin → both `hidden === false`; member, no permission, `role: 'admin'` job title, api throws → both `true`.
  - "the staff group opens the rail, hidden until dashboard.js reveals it": in `dashboard.html`, the first element inside
    `<nav class="side-nav"` is `#staffLabel` (`hidden`, `data-i18n="d.nav.team"`), immediately followed by
    `<a class="side-link side-link-staff" href="admin-home.html" id="publishLink" hidden>`, then the General label;
    `admin-home.html` appears nowhere under Herramientas; the link's svg is not the bar path `M4 20V10M12 20V4M20 20v-7`.
  - CSS: `.side-link[hidden]` and `.side-label[hidden]` → `display: none`; a rule styles `.side-link-staff` with
    `var(--beige)` background and `var(--forest)` colour; the first-label rule also matches `.side-link[hidden] + .side-label`;
    inside the `max-width: 760px` block, `.side .side-link-staff:focus-visible` sets `outline-color: var(--forest)`.
  - Words: `d.nav.publish` and `d.nav.team` equal the Global Constraints values in en/es/pt.
- [ ] **Step 2: Run** `node --test tests/dashboard-publishing.test.js` — expected FAIL on the new markup/words.
- [ ] **Step 3: Implement** the markup move, `init()` (`staffLabel.hidden = publish.hidden` after the existing line, both
  null-safe), the dictionary values, and the CSS (hover: `var(--pastel)` background/border, `var(--forest)` text).
- [ ] **Step 4: Bump** `?v=` keys per Global Constraints in the four pages and `tests/deploy.test.js`; add `d.nav.team`
  to the `later` list in `tests/home-i18n.test.js` (covered by dashboard-publishing).
- [ ] **Step 5: Run** `npm test` and `npm run lint` — expected 0 failures; then the Vercel-like build
  (`env VERCEL=1 VERCEL_ENV=production PUBLIC_BASE_URL=https://example.org EMAIL_SMTP_URL=smtps://u:p@smtp.example.invalid:465 EMAIL_FROM="FIIU Fest 11 <fest@example.invalid>" npm run build`).
- [ ] **Step 6: Look** signed in as the local test admin and as a member at 1280, 980 and 375 (touch) in es/en/pt;
  check the Review Focus items.
- [ ] **Step 7: Commit.**
