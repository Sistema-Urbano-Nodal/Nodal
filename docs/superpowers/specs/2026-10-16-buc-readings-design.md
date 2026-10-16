# BUC readings in NODAL

Source: a team task ("integrate BUC within NODAL; any time we ask for book recommendations it should integrate BUC") and the design the user approved on 16 Oct 2026. BUC is the Biblioteca Urbana Colaborativa, https://buc.sistemaurbano.org/, an open library of urbanism publications run by the same organisation; someone else maintains its code. Branch `feature/buc-readings` on production `main` (664fdba). No database migration. Phase 1 ships before the FIIU festival (20 Oct).

## Decisions made with the user

- BUC is NODAL's source for readings in three situations: where NODAL itself suggests readings; when members ask each other for readings; and a future NODAL assistant.
- BUC's maintainers will add a small data feed; NODAL defines it (`docs/integrations/buc-feed.md`) and builds against it, with links into BUC search as the fallback until it is live.
- Phase 1 (links everywhere + chat suggestions + the feed reader, switched off) ships before the festival. Phase 2 is turning the feed on. Phase 3, the NODAL assistant, gets its own design after the festival.

## What BUC offers today

- Search: `https://buc.sistemaurbano.org/busqueda?q=<words>&c=<category id>` (GET, server-rendered HTML). Categories: 1 Infancia, 2 Espacio público, 3 Ambiente, 4 Metodologías, 5 Cultura, 6 Gobernanza, 7 Movilidad, 8 Inclusión.
- BUC matches `q` as one phrase (checked by hand): "vivienda" finds 21 publications in Inclusión, "vivienda social" none, and "calidad vida" one where "calidad de vida" finds 26. English and Portuguese words ("housing", "mobilidade") find nothing. So NODAL searches only for Spanish words checked against BUC (the vocabulary, section 1b).
- No public JSON; `robots.txt` asks for `Crawl-delay: 10`. NODAL never scrapes BUC.

## 1. Topic map (server/buc.js, one table)

| NODAL topic | BUC category | Extra search words (ES) |
|---|---|---|
| Mobility | 7 Movilidad | — |
| Public space | 2 Espacio público | — |
| Housing | 8 Inclusión | vivienda |
| Climate & resilience | 3 Ambiente | clima |
| Care & gender | 8 Inclusión | género ("cuidado" finds only 1) |
| Governance & participation | 6 Gobernanza | — |
| Safety | 2 Espacio público | seguridad |
| Informality | 8 Inclusión | — ("informalidad" finds nothing) |
| Heritage | 5 Cultura | — ("patrimonio" finds nothing) |
| Urban data & tech | 4 Metodologías | datos |
| Land use & planning | 4 Metodologías | planificación |
| Environment & nature | 3 Ambiente | — |

A topic's word is always a vocabulary q of the same category (a test checks it), so it was checked against BUC like the others.

FIIU blocks carry their own BUC categories in the same file (day0-lab → 6; day1-am → 6; day1-pm → 2; day2-am → 8, 7; day2-pm → 5, 2; day3-am → 3; closing party and workshops/routes → by their titles' closest category, or none), editable in one place.

## 1b. The vocabulary (server/buc.js `BUC_VOCABULARY`, copied in web/scripts/buc.js)

One list of what members may ask BUC about, and the only words NODAL ever searches BUC for. Each entry is `{terms, category, q, label}`:

- `terms`: the ES/EN/PT words and short phrases, singular and plural, that name the topic in a message (matched as whole words, case- and accent-insensitive): for example vivienda/viviendas/housing/moradia/habitação, espacio público/public space/espaço público, informalidad/informality/asentamientos informales/informal settlements/favela.
- `category`: the BUC category (1–8) it belongs to.
- `q`: one Spanish word or short phrase BUC's search finds in that category, or `''` for the category alone.
- `label`: the topic's name in English, Spanish and Portuguese, for the line under a message («vivienda», “housing”, “moradia”).

It covers the twelve NODAL topics, BUC's eight categories and the festival's themes (22 entries: movilidad, caminabilidad, espacio público, acupuntura urbana, vivienda, clima, resiliencia, cuidado, género, gobernanza, participación, gestión urbana, seguridad, informalidad, patrimonio, datos, planificación, medio ambiente, infancia, cultura, metodologías, inclusión).

Every `q` was checked by hand on 16 Oct 2026 with a plain GET of `/busqueda?q=<q>&c=<category>`, one request every 10 s as BUC's robots.txt asks, reading "Se encontraron N publicacion(es)". A `q` is kept only when it finds at least one publication in its category; otherwise the entry uses a related word that does ("asentamientos" for informalidad, "histórico" for patrimonio) or the category alone. The counts and the date are in the comment above the list. Neither NODAL's code nor its tests ever call BUC. A term can be added freely when it means the topic in every language a member may write (bare "data" is Portuguese for a date, so English data is "urban data", "open data", "big data" or "data science"), but a new `q` is checked the same way first. The browser's copy must stay identical, and `tests/buc-ui.test.js` compares the two.

## 2. Readings API

`GET /api/readings?topics=<comma list of NODAL topic names>&categories=<comma list of BUC ids>&block=<FIIU activity id>&q=<a vocabulary q>&limit=<1–12>&context=<console|knowledge|session|course|chat>`

- Public (BUC is public), same answer for everyone for the same query: `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=600`. No session read, no cookies.
- Answer: `{source:'feed'|'links', items:[{id,title,authors,year,country,category,format,url,summary}], links:[{label, url, category}]}`.
  - `source:'links'` (feed off or failing): `items` empty; `links` = up to 4 BUC search links, each `url` with `utm_source=nodal&utm_medium=<context>`. In order: the `q` in the q's own category; each other category asked for (`categories`, then the block's) opened whole; each topic with its own word; then the `q` alone across BUC. A `q` goes only where it was checked, its own category or all of BUC, because it may find nothing in another category ("vivienda" in Gobernanza).
  - `source:'feed'`: `items` = up to `limit` publications from the cached feed, filtered by the categories (from the `q`, the topics, `categories` and the block). With a `q`, only the publications whose title or summary has it (as a phrase at word starts) are kept; with none matching, the answer is the links. The topics' own words only rank. Then newest first. A publication on BUC's own pages gets the same utm tags as the search links; one on an author's portal is left as it is. `links` = one "Ver más en la BUC" search link.
- Input is validated: known topics only, ids 1–8, limit 1–12, and `q` must be exactly one of the vocabulary's `q` values (case- and accent-insensitive). Any other `q`, such as free text, a name or an English word, gets a 400 `invalid_readings_query`. So no name or free text can enter NODAL's request logs, the CDN cache or BUC links, even from a crafted page. Any other bad query also gets a 400.
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
- **When members ask each other** (FIIU chats and course discussions): a message that asks for readings gets a quiet "Sugerencias de la BUC" line under it. It is shown to everyone reading the thread, never posted as a message, never shown under a hidden or deleted message, at most one per message, and costs no network read beyond one cached `/api/readings` call per distinct query.
  - *Detection* (`Buc.asks`; case- and accent-insensitive, whole words). URLs, emails, handles and bare domains are removed first, and so are the festival's errands: an obligation ("hay/tengo/tienen que…", "tem/temos que…"), the QR check-in, the reading of the minutes or conclusions, the complaints, visitors' or sign-in book, the reading room, booking a taxi or room ("where do I book?"), reading something now, a book's launch, signing, fair, sale, price or where to buy it, a book lost or left behind ("mi libro", "my book", "alguien dejó un libro"), an article of the rules ("artículo 5") and paper as a material ("paper and markers"). A message then asks when one sentence has a reading noun (libro, lectura, bibliografía, texto, artículo; book, reading, paper, article, bibliography; livro, leitura, bibliografia, texto, artigo; singular or plural) and an ask: a question mark, or a request word: recomiendan/recomiendas/recomienda/recomienden, recomiéndame/recomiéndenme, sugieren/sugieres, sugiéranme, alguien, algún/alguna/alguno, conocen/conoces, me pasan/me pasas/pásenme, compartan, busco/buscamos; recommend, suggest, anyone/anybody, know of, looking for, and "any" opening the sentence or a clause ("Any books on housing", "Hi all, any readings…"); recomendam/recomenda/recomendem, sugerem, alguém, algum/alguma, indicam/indiquem, procuro/procuramos. "Hay", "tienen", "tienes" and "any" elsewhere ask only with a question mark ("Hay libros gratis en la mesa" is news), and the plurals algunos/algunas/alguns/algumas never do ("Algunos libros estarán a la venta"). A message also asks when it asks what to read: "¿qué leer?", "¿qué debería/puedo/me sugieren leer?", "algo para leer", "o que devo/posso ler", "what should I read", "what/something/anything to read", "recomendaciones de lectura", "recommendations/suggestions for books". Reading in a sentence that asks for a suggestion counts too ("Quiero leer sobre vivienda, ¿alguna recomendación?"). A noun alone is no request, and neither is first-person recommending ("I recommend the book…", "I'd strongly recommend…", "te recomiendo…") or an obligation.
  - *What is asked*: the message's own words never travel. `Buc.suggest` finds the vocabulary's terms in the message (after the same address removal) and asks with the first topic's `category` and `q`, plus a second topic's category when it differs, together with the session block or the course topics. A message naming no topic asks for the block or course alone. With neither, it reads nothing and shows one "Explora la BUC" link.
  - *The line* names the matched topic in the reader's language («vivienda», “housing”, “moradia”), never the person's words, followed by up to three links: the topic's category (searching its `q`), the block's or course's categories, and "Buscar «q» en la BUC". With the feed it shows the matching publications and "Ver más". When no topic is named, the line is the plain "Sugerencias de la BUC".
  - The console, session, course and knowledge placements send no `q` (topics, categories or a block only). The client drops any `q` that is not in the vocabulary before it builds an address.

All of this is EN/ES/PT, 44 px targets, CSP-safe (links only, no BUC images), and fails quietly (no block) if the readings API is unavailable.

## 5. Phase 3 note (not built here)

The NODAL assistant will answer reading questions through this same readings layer (a tool that calls the same server function), so its answers stay grounded in BUC.

## 6. Testing

- Server: the topic map and the vocabulary (shape, coverage of the topics and themes, each topic word a checked q); link building (a q only in its own category or all of BUC, utm); query validation (any q outside the vocabulary refused); the cache header; the feed reader (env off → links; fixture feed → items; ETag 304; timeout; oversize; invalid items dropped; failure keeps the last copy; 6 h memo with a fake clock; shared promise); ranking.
- Client harness: each placement renders links (and items with a stubbed feed answer), fails quietly, strings in three languages; the client's vocabulary equals the server's; the chat suggestion appears only for reading-request messages (positive and negative examples in three languages, including errands, addresses, answers and interpretations), asks with the vocabulary topic and never the message's words (names, handles, sites, filler), names the topic in the reader's language, once per message, not for hidden/deleted ones, with one cached read per query, and keeps focus on its link through a live update.
- Browser pass on the seeded server (console as ana with topics, knowledge, a session page, a course page, a chat message asking for books), 375 and 1280.
- Whole-branch review with adversarial verification; both builds.
