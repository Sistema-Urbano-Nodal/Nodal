# BUC readings: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BUC NODAL's source of readings: links into BUC wherever NODAL suggests readings and when members ask for them, plus a switched-off feed reader for when BUC publishes its feed.

**Architecture:** `server/buc.js` owns the topic/category map, link building, the feed reader (6 h memo) and ranking; `GET /api/readings` exposes it publicly with a CDN cache. `web/scripts/buc.js` renders readings blocks and the chat suggestion, used by the console, the knowledge hub, FIIU session pages, course pages and course discussions.

**Tech Stack:** Node (zero-dependency server), vanilla browser JS in IIFEs under a strict CSP, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-buc-readings-design.md`; feed: `docs/integrations/buc-feed.md`.

## Global Constraints

- No database migration. No scraping of BUC. Links only (no BUC images; `img-src 'self' data:`).
- EN/ES/PT strings; 44 px targets on coarse pointers; no sideways scroll at 360 px; no left accent bars; reuse existing type and spacing.
- A new browser script is registered in `server/server.js` `STATIC_SCRIPTS`, `scripts/build-static.js` and the `vercel.json` script regex, and loaded with a `?v=` key on every page that uses it; do not bump other keys or deploy pins (the integrator does).
- Tests first; `npm test` and `npx eslint . --max-warnings=0` pass at every commit.

## Review Focus

1. A readings query never carries member data to BUC except in links the member follows; `/api/readings` reads no session and sets no cookie.
2. The feed reader can never break a page: off, slow, oversize, malformed or failing → links, quietly.
3. The chat suggestion appears only for reading requests, once per message, never under hidden/deleted messages, and costs at most one cached read per distinct query.
4. Every BUC link is a valid `https://buc.sistemaurbano.org/busqueda?...` with an allowed category id and URL-encoded words.

## Lanes

| Lane | Owns | Tasks |
|---|---|---|
| A: server | new `server/buc.js`, the `/api/readings` route and wiring in `server/server.js` (not the STATIC lists), `DEPLOYMENT.md` (the `BUC_FEED_URL` variable), new `tests/buc.test.js` | A1–A3 |
| B: client | new `web/scripts/buc.js`, its registration (STATIC_SCRIPTS, build-static, vercel.json) and script tags, mounts in `web/scripts/dashboard.js` (Learning band), `web/scripts/fiiu-hubs.js` (knowledge hub), `web/scripts/fiiu-talk.js` (session page block + chat suggestion), `web/scripts/courses.js` / `web/scripts/pilot.js` (course page block + discussion suggestion), strings in `i18n-dashboard.js` (console), `fiiu-ui.js` rows (festival pages) and `pilot-i18n.js` (courses), CSS in the matching stylesheets, new `tests/buc-ui.test.js` | B1–B3 |

## Contract (`GET /api/readings`)

Query: `topics` (comma list of NODAL topic names from the spec table), `categories` (comma list of 1–8), `block` (a FIIU activity id; the server adds that block's categories from `BLOCK_TO_BUC`), `q` (one of the vocabulary's q values, `BUC_VOCABULARY` in `server/buc.js`; any other is a 400, see the spec's section 1b), `limit` (1–12, default 4), `context` (`console|knowledge|session|course|chat`). At least one of topics/categories/block/q, except `context=knowledge` which may be empty (all categories). Answer `{source:'feed'|'links', items:[…], links:[{label, url, category}]}` with `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=600`; 400 `{code:'invalid_readings_query'}` for bad input. `label` is a server-chosen Spanish category name (the client localises by `category` id: Infancia/Childhood/Infância, Espacio público/Public space/Espaço público, Ambiente/Environment/Ambiente, Metodologías/Methods/Metodologias, Cultura/Culture/Cultura, Gobernanza/Governance/Governança, Movilidad/Mobility/Mobilidade, Inclusión/Inclusion/Inclusão; a link with only words reads "Buscar «words» en la BUC").

## Lane A: server

### Task A1: The map and the links
- [ ] Failing tests: every NODAL topic maps per the spec table; FIIU block categories; link URLs (category, words, encoding, utm, dedupe, at most 4); unknown topics ignored.
- [ ] Implement `server/buc.js` exports `BUC_CATEGORIES`, `TOPIC_TO_BUC`, `BLOCK_TO_BUC`, `bucLinks({topics,categories,words,context})`; commit.

### Task A2: The feed reader (switched off by default)
- [ ] Failing tests with a fake fetch: env unset → no request; fixture feed → validated items (each rule from the feed spec); ETag 304 keeps the copy; 10 s timeout; 5 MB cap; failure keeps the last copy; no copy → null; 6 h memo with a fake clock; shared promise; ranking by words then newest.
- [ ] Implement `createBucFeed({url,fetchImpl,clock,ttlMs,log})` → `{items(), recommend({categories,words,limit})}`; commit.

### Task A3: The route
- [ ] Failing tests: shapes for links and feed; `block` adds that block's categories and an unknown block is a 400; validation codes; cache header; no session read (a request with a bad cookie is not slowed or 401'd); `context=knowledge` with no filters.
- [ ] Implement in `server/server.js` (route near `/api/fiiu`), env `BUC_FEED_URL`; document it in `DEPLOYMENT.md`; commit.

## Lane B: client

### Task B1: The renderer and the console / knowledge placements
- [ ] Failing tests: `window.Buc.mount(host,{topics,categories,words,context,heading})` renders links (stubbed links answer) and items (stubbed feed answer) with localised category names, nothing on failure; console Learning band from the member's topics (one "Explora la BUC" link without topics); knowledge hub block with the 8 categories.
- [ ] Implement `web/scripts/buc.js`, registration, script tags (dashboard.html, knowledge.html, fiiu-session.html, course.html, courses.html), mounts; commit.

### Task B2: Session and course pages
- [ ] Failing tests: the session page block asks with `block=<activity id>` (the map stays on the server only; General asks with `context=session` and no filters → all categories); course page block asks with the course topic (`topics=Mobility` for Curso Movilidad).
- [ ] Implement; commit.

### Task B3: The chat suggestion
- [ ] Failing tests: reading-request detection (positive/negative cases in ES/EN/PT, accents and case); the line under the message in FIIU chats and course discussions; once per message; not for hidden/deleted; one cached read per distinct query; language switch relabels.
- [ ] Implement `Buc.suggest(messageNode, text, {categories, context})` in `buc.js`, called from `fiiu-talk.js` and the course discussion render; commit.

## Integration (the orchestrator)

- [ ] Merge, resolve, bump keys/pins, browser pass, whole-branch review, builds, report with the feed spec to share with BUC's maintainers.
