# BUC publication feed for NODAL

For the maintainers of the Biblioteca Urbana Colaborativa (https://buc.sistemaurbano.org/). NODAL (https://sistema-urbano-nodal-ten.vercel.app) recommends BUC publications to its members — in their console, on festival session pages, on course pages and when members ask each other for readings. Today it can only link into BUC's search page. This feed lets NODAL show the actual publications, each linking to BUC's own page for it (or to the author's portal, as BUC does).

## What to publish

One URL, for example `https://buc.sistemaurbano.org/api/publicaciones.json`, that answers `GET` with the whole public catalogue as JSON. No authentication: it is the same public information the site already shows.

```json
{
  "version": 1,
  "generatedAt": "2026-10-16T12:00:00Z",
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
      "sourceUrl": "https://www.limacomovamos.org/...",
      "summary": "Two or three sentences, plain text.",
      "language": "es",
      "updatedAt": "2026-09-30T00:00:00Z"
    }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Stable string, unique, never reused |
| `title` | yes | Plain text, 1–300 characters |
| `authors` | no | List of plain-text names (organisations allowed) |
| `year` | no | 1900–2100, or null |
| `country` | no | Country name as shown on BUC, or null |
| `category` | yes | BUC category id: 1 Infancia, 2 Espacio público, 3 Ambiente, 4 Metodologías, 5 Cultura, 6 Gobernanza, 7 Movilidad, 8 Inclusión |
| `format` | no | As on BUC: Documento, Guía, Estudio de caso, Memoria, Experiencia |
| `url` | yes | `https://` link to the publication's page on BUC (preferred) or to where BUC sends readers |
| `sourceUrl` | no | `https://` link to the author's portal |
| `summary` | no | Plain text, up to 600 characters, no HTML |
| `language` | no | `es`, `en`, `pt` or another ISO code |
| `updatedAt` | no | ISO 8601 date-time |

Items that break a rule are skipped by NODAL and counted in its logs; the rest are used.

## How NODAL reads it

- At most once every 6 hours per server, with `If-None-Match` when the feed sends an `ETag` (please send one, and `Cache-Control: public, max-age=3600`). A `304 Not Modified` keeps NODAL's copy.
- 10-second timeout, 5 MB limit. If the feed is slow, broken or missing, NODAL keeps its last good copy, or falls back to links into BUC's search.
- Links from NODAL carry `utm_source=nodal&utm_medium=<console|knowledge|session|course|chat>`, so BUC's analytics can see the traffic.
- Members' data is never sent to BUC.

## Questions for the BUC team

1. Does every publication have its own page on BUC to link to, or should `url` be the author's portal?
2. Can summaries be included, and in which language?
3. Who is the contact for changes to this feed?

Once the feed is live, NODAL turns it on by setting one environment variable (`BUC_FEED_URL`) — no release is needed.
