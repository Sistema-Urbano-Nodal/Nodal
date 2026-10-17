# BUC publication feed for NODAL

For the maintainers of the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/). NODAL (https://sistema-urbano-nodal-ten.vercel.app) recommends BUC publications to its members — in their console (Mi panel), on the Knowledge page, on festival session pages, on course pages and when members ask each other for readings. Today it can only link into BUC's search page. This feed lets NODAL show the actual publications, each linking to BUC's own page for it (or to wherever BUC sends readers).

## What to publish

One fixed `https://` URL, for example `https://buc.sistemaurbano.org/api/publicaciones.json`, that answers `GET` with the whole public catalogue as JSON in UTF-8. A static file regenerated whenever the catalogue changes (or nightly) is enough; it does not need to be an API.

- No authentication: it is the same public information the site already shows. NODAL's server reads it, not members' browsers, so no CORS headers are needed.
- No redirect: give the exact final address, the one that answers without redirecting (mind whether it has `www` and whether it ends in a slash). NODAL follows no redirect, and a redirect counts as a failed read.
- Answer fast, within 2 seconds: a static file, gzipped if possible. While a NODAL server instance reads the feed for the first time, each page waits for it at most 2 seconds; a slower feed means that page shows search links, and NODAL's CDN can keep that answer for up to 15 minutes.
- One document, no pagination, at most 5 MB uncompressed (gzip on the wire is fine, but the limit applies to the decoded JSON). The sample item below is about 0.5 KB, so roughly 10,000 publications fit; with 600-character summaries, about 5,000 (the cap counts bytes, and an accented letter takes two). If the catalogue gets close to that size, please tell NODAL.
- Please send an `ETag`: NODAL sends it back as `If-None-Match`, and a `304 Not Modified` keeps its copy without a download. NODAL ignores `Cache-Control`, `Expires`, `Last-Modified`, `Retry-After` and `Content-Type`: it always decodes the body as UTF-8 (a byte-order mark is fine), so a Latin-1 file is not refused but shows broken accents.

```json
{
  "version": 1,
  "items": [
    {
      "id": "1234",
      "title": "Clima y resiliencia en la mirada urbana. Segundo reporte de percepciones sobre cambio climático y riesgos en Lima y Callao 2025",
      "authors": ["Lima Cómo Vamos"],
      "year": 2025,
      "country": "Perú",
      "category": 3,
      "format": "Documento",
      "url": "https://buc.sistemaurbano.org/publicacion/1234",
      "summary": "Two or three sentences, plain text.",
      "language": "es",
      "updatedAt": "2026-09-30"
    }
  ]
}
```

At the top level, `items` (a list) is required and `version` may be left out; when present it must be the number `1`, and any other value (`"1"`, `2`, `null`) fails the whole read. Any other top-level field is ignored.

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Stable and unique: a string of 1–100 characters or a non-negative integer (`7` and `"7"` are the same id). A slug is fine if it fits in 100 characters (the example title's would be 126); use the numeric id if slugs can run long. When two publications share an id, only the first is used |
| `title` | yes | 1–300 characters |
| `category` | yes | One BUC category id, as a JSON number (`3`, not `"3"` or `[3, 7]`): 1 Infancia, 2 Espacio público, 3 Ambiente, 4 Metodologías, 5 Cultura, 6 Gobernanza, 7 Movilidad, 8 Inclusión. Any other number skips the publication, so a new BUC category needs NODAL first. A publication in several categories gets its main one; NODAL shows it where readings of that category are asked for, and on the Knowledge page |
| `url` | yes | A full address starting with `https://` (not `http://`, not a relative path such as `/publicacion/1234`) to the publication's page on BUC, or, when it has none, to where BUC sends readers (the author's portal, a PDF) |
| `authors` | no | A list of names (people or organisations), at most 50, each 1–200 characters: `["Ana García", "Juan Pérez"]`, not `"Ana García; Juan Pérez"`. No empty entries (splitting `"A; B;"` leaves a `""` that skips the publication). Names as read, "Ana García" not "García, Ana", main authors first: members see the first two |
| `year` | no | A whole number from 1900 to 2100 (`2025`, not `"2025"`). Unknown ("s.f.") or earlier: leave it out |
| `country` | no | Up to 100 characters |
| `format` | no | Free text, up to 60 characters (for example Documento, Guía, Estudio de caso, Memoria, Experiencia) |
| `summary` | no | Up to 600 characters. Not shown yet, but NODAL searches it with the title for its Spanish topic words, so a Spanish summary helps a publication be found |
| `language` | no | Preferably one language tag, with a hyphen: `es`, `en`, `pt`, `es-PE`. NODAL does not use it yet and ignores whatever it holds (`es_PE`, `Español`) |
| `updatedAt` | no | A date, `2026-09-30`, or a date-time, `2026-09-30T12:00:00Z` |

Rules for every field:

- Texts (`title`, `summary`, `country`, `format`) are plain text, with no HTML tags or entities. If BUC's CMS stores HTML, replace each tag with a space (deleting it glues words: `de<br>movilidad` becomes `demovilidad`) and decode entities (`&oacute;` → ó, `&nbsp;` → space, `&amp;` → &). NODAL does neither: a tag (`<br>`, `<p>`, `<em>`) left in any of these fields skips the whole publication, even in the summary, which is not shown yet, and an entity stays as typed (a title would show `&oacute;`).
- When a field has no value, leave it out or send `null`, never `""`.
- A publication with a field that breaks its rule (a text over its limit, an HTML tag in a text, more than 50 authors, a year out of range, a malformed date) is skipped whole and counted in NODAL's log; the rest are used. `language` is the exception: NODAL does not check it. NODAL truncates nothing, so trim texts on BUC's side.
- Any other field in a publication is ignored, so BUC may add its own (a PDF link, the author's portal, all its categories).

## What members see

Each publication shows its title (a link that opens in a new tab) and, below it, the first two authors ("et al." when there are more), the year and the category. Mi panel shows up to 4, the Knowledge page 6, session and course pages 3; under a chat message that asks for readings, up to 3, titles only. A "Ver más en la BUC" link into BUC's search follows them; on the Knowledge page and in the festival's General space the eight category links follow instead.

Publications whose title or summary names the requested topic come first (in a chat line, only those), then the newest `year` (none last), then the latest `updatedAt`. When no publication fits a request, members see the search links.

## How NODAL reads it

- NODAL runs on Vercel, which starts and recycles server instances with traffic. Each instance reads the feed on its first readings request, then at most once every 6 hours after a good read or a 304, and every 15 minutes while reads fail. A new instance has no copy, so its first read downloads the whole file: expect several full downloads a day, and more while the feed is failing.
- Each read has 10 seconds in all, headers and body.
- A read that times out, is redirected, gets an error status, is over 5 MB, is not JSON, has no `items` list or has another `version` fails: NODAL keeps its last good copy (or, with none yet, shows links into BUC's search) and tries again in 15 minutes. A failing feed never breaks a NODAL page.
- A valid file whose `items` list is empty (`[]`), or in which no publication passes the rules, counts as a good read: it replaces NODAL's copy, NODAL shows search links only, and it does not read the feed again for 6 hours, even if BUC fixes the file sooner. If generating the file goes wrong, answer with an error status (for example `503`) rather than an empty list.
- To remove a publication, publish the file without it: it leaves NODAL within about 6 hours, plus up to 15 minutes of NODAL's CDN cache (a page already open keeps it until reloaded). That needs a good read; while reads fail, NODAL keeps its last copy, the publication included.
- Links from NODAL to BUC carry `utm_source=nodal&utm_medium=<console|knowledge|session|course|chat>`, so BUC's analytics can see the traffic: search links, "see more" links, and each publication's `url` that starts with exactly `https://buc.sistemaurbano.org/` (a PDF hosted there included). NODAL replaces any `utm_source` and `utm_medium` already in it. A `url` with `www` or on another domain is left untagged. NODAL builds search links as `/busqueda?q=<words>&c=<category>`, so please keep those parameters.
- Members' data is never sent to BUC. Reading the feed is NODAL's only request to BUC; its search links carry only words from a fixed list of Spanish topic words, never what a member wrote, and a search runs only when a member follows one.

## Questions for the BUC team

1. Does every publication have its own page on BUC to link to, or should `url` be the author's portal for some?
2. Who is the contact for changes to this feed?

When a first version is ready, even at a test `https://` address, send NODAL its address and NODAL will try it before turning the feed on. Turning it on is only setting one environment variable (`BUC_FEED_URL`); no code change is needed. Until then NODAL keeps linking into BUC's search, so there is no rush.
