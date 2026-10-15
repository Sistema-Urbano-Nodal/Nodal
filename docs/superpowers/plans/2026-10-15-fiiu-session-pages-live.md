# FIIU session pages, chat fixes and the live window: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put each session's questions and chat inside a per-session page, fix the audited chat bugs, and add a registration-gated live window to the festival page and console.

**Architecture:** `fiiu-session.html` reuses `web/scripts/fiiu-talk.js`, which gains a session header and an in-page question switcher; the old `fiiu-talk.html` addresses redirect on the server. A new `GET /api/fiiu/live` aggregates programme, attendance and conversation data behind a 15 s per-instance memo; a new `web/scripts/fiiu-live.js` renders it on `fiiu.html` and in the console's festival block.

**Tech Stack:** Node (zero-dependency server, `node --test`), node:sqlite locally, Supabase PostgREST in production, vanilla browser JS in IIFEs under a strict CSP.

**Spec:** `docs/superpowers/specs/2026-10-15-fiiu-session-pages-live-design.md`. **Audit findings** (index = finding number, with reproductions and verifier evidence): `/private/tmp/claude-501/-Users-joaolucas-main-nodal-v2/9d02e662-e6c2-4f02-92e9-41252465bb2f/scratchpad/chat-audit-findings.json`.

## Global Constraints

- Vanilla JS in IIFEs; strict CSP (no inline style or script, no `blob:`, no `innerHTML` with data); style through classes or CSSOM writes.
- EN/ES/PT for every string; festival pages add strings with `Object.assign(Fiiu.rows,{...})` in their own file or in `fiiu-ui.js` rows; `tests/deploy.test.js` reads those blocks.
- 44×44 px targets on coarse pointers; no sideways scroll at 360 px; no left accent bars; few rules; reuse the `fiiu.css` `--f-sp-*` scale.
- Never expose another person's user id, clientId or attendance; counts only for attendance and milestones.
- No database migration. Do not bump `?v=` keys or edit `tests/deploy.test.js` pins (the integrator does). A NEW script must be registered in `server/server.js` `STATIC_SCRIPTS`, `scripts/build-static.js` and the `vercel.json` script regex (lane C does this for `fiiu-live.js`; lane B for nothing, since `fiiu-session.html` reuses existing scripts).
- Tests first; `npm test` and `npx eslint . --max-warnings=0` pass at every commit.

## Review Focus

1. **A person's own clientId only:** `messageView` must add `clientId` only when the viewer authored the message; a test reads another person's message and finds no clientId. (Lane A)
2. **Live endpoint access and load:** signed out 401, unregistered 403, registered and organisers 200; two calls inside 15 s read the stores once; the 30 s session memo applies to `/api/fiiu/live`; `private, no-store`. (Lane A)
3. **Hidden things never leak into the live window:** hidden questions, hidden and deleted messages never appear in `conversations`. (Lane A)
4. **Old links:** every alias in the spec redirects with its query; `?q=` alone resolves its session; the projector still works. (Lanes A and B)
5. **A reader at the end stays at the end** through keyboard, rotation, rebuilds and new messages, and a reader who scrolled up is never pulled down. (Lane B)

## Lanes

| Lane | Owns | Tasks |
|---|---|---|
| A: server | `server/fiiu-talk-api.js`, `server/fiiu-talk-domain.js`, `server/fiiu-talk-repository.js` (only if a read is missing), new `server/fiiu-live.js`, `server/server.js` (the talk aliases, the live route in the session memo, wiring), their tests | A1–A4 |
| B: session page and chat | new `web/pages/fiiu-session.html`, `web/pages/fiiu-talk.html` (left as a copy or redirect shell), `web/scripts/fiiu-talk.js`, `web/styles/fiiu-talk.css`, the session/General link helper in `web/scripts/fiiu-ui.js` (`talkLink` and friends only), the link text in `web/scripts/fiiu.js` and `web/scripts/fiiu-hubs.js` (card links only), `tests/fiiu-talk-ui.test.js`, `tests/fiiu-ui.test.js` (link tests) | B1–B4 |
| C: live window and organiser picker | new `web/scripts/fiiu-live.js`, the band mount in `web/scripts/fiiu.js` and the compact mount in `web/scripts/fiiu-hubs.js` (mount points only), `web/pages/fiiu.html` and `web/pages/dashboard.html` (script tag), `web/styles/fiiu.css` (a block appended at the very end under `/* Live window */`), `web/scripts/fiiu-admin.js` (talk picker, finding 13), `server/server.js` `STATIC_SCRIPTS` line, `scripts/build-static.js`, `vercel.json`, new `tests/fiiu-live-ui.test.js`, `tests/fiiu-admin-ui.test.js` | C1–C3 |

`tests/helpers/fiiu-ui-harness.js` may get additive changes from B and C. Lanes B and C build against the contracts below and stub them in harness tests.

## Contracts

**Redirects (lane A):** GET/HEAD `/fiiu-talk.html`, `/fiiu-talk`, `/fiiu-talk.htm`, with or without a trailing slash, any case → 302 `Location: /fiiu-session.html<same query>`. `/fiiu-session.html` is served like other pages (it is a new file in `web/pages`, lane B).

**Own clientId (lane A):** `messageView(m,{viewer,…})` adds `clientId:m.clientId` only when `viewer===m.userId`; every message answer (full read, `?since=`, send, earlier page) carries it on the viewer's own messages and never on anyone else's.

**Projector top answers (lane A):** `GET /api/fiiu/questions/:id/top?limit=12` (organisers only, 1 ≤ limit ≤ 50, default 12) → `{messages:[view…]}` of visible messages ordered by `likeCount` desc, then `createdAt` desc; 403 for others.

**Live (lane A → lane C):** `GET /api/fiiu/live` → the shape in the spec section 3. `now`/`next` consider check-in sessions (`registration` `general` or `application`) of the merged programme, Lima time (UTC−05:00), a session "under way" from its start to its end; `next` is the next start after now (null after the last). `conversations` are open, non-hidden questions ordered by revision desc, at most 5, `body` cut to 180 characters, `latest.body` to 140, `rating` only for `kind:'rating'` (average to one decimal, count). `badges` counts people (registrations) whose attendance reaches each milestone exactly as `Fiiu.festivalBadges` defines them (first: ≥1 attended block of any kind; three: ≥3; conferences: all five `general` conference blocks of the event; lab: attended `day0-lab`). `pulse.checkedInToday` = attendance rows created since Lima midnight; `messages` = visible messages across non-hidden questions; `ratings` = rating rows across non-hidden questions.

**Session page address (lane B):** `fiiu-session.html?a=<id>[&q=<uuid>][&present=1]`; links built by `Fiiu.sessionLink(activityId, questionId?)` in `fiiu-ui.js` (lane B adds it; lane C uses it for the live band's links — until merged, lane C builds the same URL inline behind a one-line fallback `(Fiiu.sessionLink||((a,q)=>'fiiu-session.html?a='+encodeURIComponent(a)+(q?'&q='+encodeURIComponent(q):'')))`).

---

## Lane A: server

### Task A1: Talk aliases → session page
- [ ] Failing tests (HTTP harness in `tests/fiiu-talk-api.test.js` or the server routing tests): each alias and case redirects 302 with the query kept; HEAD too; POST is not redirected; `/fiiu-session.html` serves the page once lane B adds it (test the redirect only).
- [ ] Implement next to `CHECKIN_ALIASES` in `server/server.js`; commit `Send old conversation links to the session page`.

### Task A2: The viewer's own clientId
- [ ] Failing tests (Review Focus 1): own message views carry `clientId` in the full read, since, send and earlier pages; another person's never do; organisers see others' messages without clientId too.
- [ ] Implement in `messageView` and its callers; commit `Return a person's own clientId so the page can match a lost send`.

### Task A3: Projector top answers
- [ ] Failing tests: organisers get the 12 (or `limit`) most liked visible messages across the whole question, ties newest first; hidden/deleted excluded; participants 403; limit bounds.
- [ ] Implement (SQLite query and Supabase PostgREST `order=like_count.desc,created_at.desc` with the visible filters); commit `Rank the projector's most liked answers across the whole question`.

### Task A4: The live endpoint
- [ ] Failing tests (Review Focus 2 and 3): access codes; the shape; now/next with a fake clock in Lima across day boundaries and evening sessions; counts against seeded attendance (milestones exactly as the client rule; a shared fixture file used by a client test of `Fiiu.festivalBadges` and this server test proves they agree); hidden questions/messages excluded; cut lengths; organiser preview `active:true` outside the dates; memo (two calls in 15 s, one store read; after 15 s a new read; concurrent calls share one promise; a failed read with a previous value serves it); `private, no-store`; `/api/fiiu/live` uses the 30 s verified-session memo.
- [ ] Implement `server/fiiu-live.js` (`createLive({fiiuStore,talkStore,programme,clock,ttlMs=15000})` → `{read(user)}`), the route in `fiiu-talk-api.js` or `fiiu-api.js` (whichever already resolves registration access for festival reads), wiring in `server/server.js`; commit `Serve a registration-gated live view of the festival`.

## Lane B: session page and chat

### Task B1: The session page
- [ ] Failing harness tests: `fiiu-session.html?a=day1-am` shows the kicker, title, time, venue, description and talks from `/api/fiiu`; the person's statuses (registered, checked in with time, badge state from `Fiiu.festivalBadges`); questions listed open first; the selected question's chat opens in place; picking another swaps the chat and pushes `?a=&q=`; Back restores; `?q=` alone resolves its session and replaces the address; General shows its description; guest → sign-in prompt with `next`; unregistered → the register explanation naming the account, open/closed state, switch account, return link (finding 15); landing shows the header and question first with "Ver las últimas respuestas ↓" (finding 16).
- [ ] Implement: `web/pages/fiiu-session.html` (same head/assets as `fiiu-talk.html`, new title), the header and switcher in `fiiu-talk.js`, styles in `fiiu-talk.css`; `fiiu-talk.html` stays in the repo unchanged (the server redirects it); commit `Give every session its own page with its questions and chat inside`.

### Task B2: Links to the session page
- [ ] Failing tests: programme cards and the console block say "Ver sesión" (EN "View session", PT "Ver sessão") with the open-question count and link to `Fiiu.sessionLink(id)`; General links to `?a=general`.
- [ ] Implement `Fiiu.sessionLink` in `fiiu-ui.js` and the link changes in `fiiu.js`/`fiiu-hubs.js`; commit `Link programme cards and the console to the session page`.

### Task B3: Chat fixes, sending and reading
Findings 0/6/18 (match attempts by own clientId), 1 (keep the end through viewport changes; viewport meta), 2 (clear the composer error on success), 3 (keep the text of photo attempts), 4 (keep focus in the textarea on tap-send), 7 (rebuild after >200 changes), 8/17 (401 → sign-in state with `next`, draft kept), 9/14 (only newer messages count as new), 10 (like races), 19 (re-arm the pulse watch on visibility).
- [ ] One failing harness test per finding, reproducing its audit repro; implement; one commit per finding group.

### Task B4: Projector fixes
Findings 5/12 (use `GET …/top` for "Con más me gusta", refreshed with the poll) and 11 (a hidden question shows "Esta pregunta no está disponible" with no answers on the projector).
- [ ] Failing tests; implement; commit `Rank the projector across the whole question and take hidden questions off it`.

## Lane C: live window and organiser picker

### Task C1: The live band
- [ ] Failing tests (`tests/fiiu-live-ui.test.js`): `Fiiu.live.mount(host,{compact:false})` renders the four parts from a stubbed `/api/fiiu/live`; "Vista previa" when `active` and the date is outside the festival (organiser); hidden when `active:false`; 401/403 → the one-line register prompt (403) or nothing (401 on the console); refresh every 30 s while visible, paused when hidden, resumed with an immediate read on visible; no live-region chatter; links via `Fiiu.sessionLink`; numbers formatted per locale; EN/ES/PT.
- [ ] Implement `web/scripts/fiiu-live.js`, register it (STATIC_SCRIPTS, build-static, vercel.json), add the script tag to `fiiu.html` (after `fiiu-ui.js`) and `dashboard.html` (after `fiiu-hubs.js`), mount at the top of the festival page (`id="en-vivo"`), CSS block at the end of `fiiu.css`; commit `Show the festival live on the festival page`.

### Task C2: The console line
- [ ] Failing tests: compact mount in the console festival block (Ahora/A continuación, checked in today, open conversations, "Ver en vivo" to `fiiu.html#en-vivo`), nothing without a registration; implement in `fiiu-hubs.js` (mount point only) + `fiiu-live.js`; commit `Show the festival live in the console`.

### Task C3: Organiser talk picker (finding 13)
- [ ] Failing test: renaming a talk in the Programme section, then opening the new-question form, offers the new name; `invalid_talk` shows its own translated message; implement in `fiiu-admin.js`; commit `Keep the organiser's talk picker in step with the programme`.

## Integration (the orchestrator)

- [ ] Merge A, B, C; resolve conflicts; `npm test`, eslint.
- [ ] Bump `?v=` keys of every changed web asset on every page that loads it, and the deploy pins; register the new page if any list needs it.
- [ ] Browser pass on the seeded local server (375 and 1280; organiser, ana, beto, carla, guest): session pages for a conference block, the lab, the party and General; question switching and Back; old links; projector; the live band (seed attendance and messages) and the console line; the chat fixes reproduced from the audit repros.
- [ ] Whole-branch review with adversarial verification; fix; both builds; report.
