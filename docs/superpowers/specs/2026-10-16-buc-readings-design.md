# BUC readings in NODAL

Source: a team task ("integrate BUC within NODAL; any time we ask for book recommendations it should integrate BUC") and the design the user approved on 16 Oct 2026. BUC is the Biblioteca Urbana Colaborativa, https://buc.sistemaurbano.org/, an open library of urbanism publications run by the same organisation; someone else maintains its code. Branch `feature/buc-readings` on production `main` (664fdba). No database migration. Phase 1 ships before the FIIU festival (20 Oct).

## Decisions made with the user

- BUC is NODAL's source for readings in three situations: where NODAL itself suggests readings; when members ask each other for readings; and a future NODAL assistant.
- BUC's maintainers will add a small data feed; NODAL defines it (`docs/integrations/buc-feed.md`) and builds against it, with links into BUC search as the fallback until it is live.
- Phase 1 (links everywhere + chat suggestions + the feed reader, switched off) ships before the festival. Phase 2 is turning the feed on. Phase 3, the NODAL assistant, gets its own design after the festival.

## What BUC offers today

- Search: `https://buc.sistemaurbano.org/busqueda?q=<words>&c=<category id>` (GET, server-rendered HTML). Categories: 1 Infancia, 2 Espacio público, 3 Ambiente, 4 Metodologías, 5 Cultura, 6 Gobernanza, 7 Movilidad, 8 Inclusión.
- No public JSON; `robots.txt` asks for `Crawl-delay: 10`. NODAL never scrapes BUC.

## 1. Topic map (server/buc.js, one table)

| NODAL topic | BUC category | Extra search words (ES) |
|---|---|---|
| Mobility | 7 Movilidad | — |
| Public space | 2 Espacio público | — |
| Housing | 8 Inclusión | vivienda |
| Climate & resilience | 3 Ambiente | clima |
| Care & gender | 8 Inclusión | cuidado |
| Governance & participation | 6 Gobernanza | — |
| Safety | 2 Espacio público | seguridad |
| Informality | 8 Inclusión | informalidad |
| Heritage | 5 Cultura | patrimonio |
| Urban data & tech | 4 Metodologías | datos |
| Land use & planning | 4 Metodologías | planificación |
| Environment & nature | 3 Ambiente | — |

FIIU blocks carry their own BUC categories in the same file (day0-lab → 6; day1-am → 6; day1-pm → 2; day2-am → 8, 7; day2-pm → 5, 2; day3-am → 3; closing party and workshops/routes → by their titles' closest category, or none), editable in one place.

## 2. Readings API

`GET /api/readings?topics=<comma list of NODAL topic names>&categories=<comma list of BUC ids>&block=<FIIU activity id>&q=<words>&limit=<1–12>&context=<console|knowledge|session|course|chat>`

- Public (BUC is public), same answer for everyone for the same query: `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=600`. No session read, no cookies.
- Answer: `{source:'feed'|'links', items:[{id,title,authors,year,country,category,format,url,summary}], links:[{label, url, category}]}`.
  - `source:'links'` (feed off or failing): `items` empty; `links` = up to 4 BUC search links (category + words), each `url` with `utm_source=nodal&utm_medium=<context>`.
  - `source:'feed'`: `items` = up to `limit` publications from the cached feed, filtered by the categories (from the topics and/or `categories`) and words, ranked by matching words in title/summary, then newest; `links` = one "Ver más en la BUC" search link.
- Input is validated (known topics only, ids 1–8, words ≤ 80 characters, limit 1–12); a bad query → 400.
- Only the server talks to the feed; a member's topics never leave NODAL unless the member follows a link.

## 3. The feed reader (Phase 2, switched off until `BUC_FEED_URL` is set)

- `BUC_FEED_URL` env var (https only). Unset → `source:'links'` everywhere.
- The whole catalogue is read at most every 6 h per server instance (in-memory, shared promise, `If-None-Match` with the feed's ETag), with a 10 s timeout and a 5 MB cap; a failed read keeps the last good copy and logs one line; no copy → links.
- Every item is validated (`docs/integrations/buc-feed.md`): https url, title 1–300, known category, year 1900–2100 or null; invalid items are dropped and counted in the log line.

## 4. Where readings show

- **Console, Learning band (`#growth`):** "Lecturas de la BUC" from the member's profile topics (up to 3); nothing before topics are set except one "Explora la BUC" link.
- **Knowledge hub (`knowledge.html`):** a "Biblioteca Urbana Colaborativa" block with the 8 categories as links (and, with the feed, the newest publications).
- **FIIU session pages:** a short "Lecturas de la BUC" block under the session details, from the block's categories.
- **Course pages:** from the course's topic (Curso Movilidad → Movilidad), under the course header.
- **When members ask each other** (FIIU chats and course discussions): a message whose text asks for readings (ES/EN/PT patterns: "libro(s)", "lectura(s)", "bibliografía", "¿qué (me) recomiendan leer", "recomendaciones de lectura", "reading(s)", "book(s)", "livro(s)", "leitura(s)", "bibliografia"; case- and accent-insensitive) gets a quiet "Sugerencias de la BUC" line under it, built from the message's words and the session/course categories. Shown to everyone reading the thread, never posted as a message, never shown under a hidden or deleted message, at most one per message, no extra network reads per message beyond one cached `/api/readings` call per distinct query.

All of this is EN/ES/PT, 44 px targets, CSP-safe (links only, no BUC images), and fails quietly (no block) if the readings API is unavailable.

## 5. Phase 3 note (not built here)

The NODAL assistant will answer reading questions through this same readings layer (a tool that calls the same server function), so its answers stay grounded in BUC.

## 6. Testing

- Server: the topic map; link building (categories, words, utm); query validation; the cache header; the feed reader (env off → links; fixture feed → items; ETag 304; timeout; oversize; invalid items dropped; failure keeps the last copy; 6 h memo with a fake clock; shared promise); ranking.
- Client harness: each placement renders links (and items with a stubbed feed answer), fails quietly, strings in three languages; the chat suggestion appears only for reading-request messages (positive and negative examples in three languages), once per message, not for hidden/deleted ones, with one cached read per query.
- Browser pass on the seeded server (console as ana with topics, knowledge, a session page, a course page, a chat message asking for books), 375 and 1280.
- Whole-branch review with adversarial verification; both builds.
