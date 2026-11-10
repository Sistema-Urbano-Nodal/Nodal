# Sponsored memberships request: design

Date: 9 November 2026. Status: draft for the owner's approval.

## Intent

The team's strategy notes of 17 October 2026 ("NODAL — Strategic Insights, Recommendations & Launch Priorities",
from conversations with Mariana Costa of Laboratoria) propose a **Sponsored Membership Program**: organisations
(companies, foundations, universities, NGOs) pay for NODAL memberships for a community they care about. There is a
precedent: SPDA sponsored 20 places for cyclists in a NODAL course. The notes give João one task:

> Create a simple section, landing page, or form inviting organizations to sponsor memberships.
> Suggested message: "Support a Community. Activate a Network."
> The form should capture the organization's interests, target community, potential number of memberships, and
> contact details. This would allow us to begin testing institutional demand without developing a complex
> sponsorship system.

So the point is to **measure whether organisations want this** and to start conversations with the ones that do.
Success is that an organisation can say "we would like to sponsor memberships for this community, roughly this many"
in under a minute without an account, that Flavia and Mariana hear about it at once, and that the team can count
sponsorship requests apart from Nodo requests.

The landing page already has the pipeline for exactly this kind of request: the third membership card, "Para
organizaciones NODAL", opens a no-account form in a window, stores the request, emails Flavia and Mariana, and lists
it in the organiser desk's Nodos band (spec: `docs/superpowers/specs/2026-11-03-organisation-node-requests-design.md`,
LIVE since 4 November 2026). This design extends that pipeline instead of building a second one.

## Decided by the owner (9 November 2026)

- It lives in the **existing "Para organizaciones NODAL" card**, not a fourth card.
- The form that card opens **starts by asking what the organisation wants**: **activate a Nodo** (today's form,
  unchanged) or **sponsor memberships** (new).
- A sponsor gives the same contact details as today (name, organisation, email, optional phone) plus **which
  community** they want to support, **roughly how many memberships**, and **what topic or urban challenge** they
  care about.
- Headline for the sponsorship choice: the notes' line, **"Apoya una comunidad. Activa una red."**
- After sending, as today: an **email to Flavia and Mariana** ("Una organización quiere patrocinar membresías") and
  the request **in the desk** next to the Nodo requests, **marked as a sponsorship**.
- **No prices, no payment, no memberships created automatically.** The team follows up by hand.

## Goals

- A visitor opens the organisations window, picks "Patrocinar membresías", fills the sponsor fields and is thanked,
  in ES, EN or PT like the rest of the landing page.
- The team gets each sponsorship request by email and in the desk, visibly different from a Nodo request, and can
  filter the desk list to sponsorships only (that filter is how the team counts demand).
- A shareable link opens the window with sponsorship already chosen, so the team can send it to organisations, the
  way `/#nodos` works for Nodos today.
- Everything the Nodo request already guarantees holds for sponsorships too: stored even when the email fails, rate
  limits, honeypot, the shared 40-a-day email ceiling, 12-month purge of closed requests, Delete for erasure, privacy
  policy coverage.

## Non-goals

- No price, sum or cost anywhere (the landing card is tested to hold no `S/ <digit>`; the team finds the price
  "muy alto y asusta" on the landing page).
- No payment, invoice, sponsor account, sponsor codes or vouchers, and no automatic creation of memberships or
  Founder badges for sponsored people. When a sponsor says yes, the team handles it with its existing manual
  routine (`docs/supporter-payments.md`); how sponsored places are granted is a later decision.
- No reporting to sponsors about who used their places.
- No page of its own for sponsorships, and no fourth card.
- No confirmation email to the sender (same as Nodo requests).

## Anti-goals (a failure even if it works)

- The Nodo form gets longer or harder for an organisation that only wants a Nodo: the sponsor fields appear only
  when sponsorship is chosen.
- Anything on the card or in the window reads as a promise: a number of places, a discount, a date, a price.
- A sponsorship request that cannot be told apart from a Nodo request in the email subject or in the desk.
- A sponsorship request lost because the email failed.

## What visitors see

### The card

The third card keeps its title ("Para organizaciones NODAL"), its line under the title ("Activa un Nodo territorial
y/o temático"), its paragraph and its one button ("Contáctanos"). One sentence is added at the end of the paragraph
so organisations know sponsorship exists:

- ES: "También puedes patrocinar membresías para una comunidad."
- EN: "You can also sponsor memberships for a community."
- PT: "Você também pode patrocinar membresias para uma comunidade."

(Builder's call; the owner confirms the wording. Still one button, so the card does not grow a second call to
action.)

### The window

The same `<dialog id="nodeRequest">`, with a fixed heading and the choice as its first question:

- The heading is **"Para organizaciones NODAL"** (the card's title). The separate kicker line above it goes, since
  it would repeat the heading.
- The intro line stays: "Cuéntanos quién eres y qué te interesa; te escribiremos para conversar."
- Then a required radio group, before the name field:
  - Legend: **"¿Qué les interesa?"** (EN "What are you interested in?", PT "O que interessa a vocês?")
  - **Activar un Nodo**, with the line "Activa un Nodo territorial y/o temático" under it (EN "Activate a Node", PT
    "Ativar um Nó"; the lines are the card's existing tagline in each language).
  - **Patrocinar membresías**, with the line **"Apoya una comunidad. Activa una red."** under it (EN "Sponsor
    memberships" / "Support a community. Activate a network.", PT "Patrocinar membresias" / "Apoie uma comunidade.
    Ative uma rede.").

So the owner's headline is the sponsorship option's own line, and the heading never has to swap language keys when
the choice changes.

**Nothing is preselected when the window opens from the card**, so the organisation has to pick and a sponsor
cannot send a sponsorship as a Nodo request by leaving a default untouched. The kind filter in the desk is how the
team counts demand, so a wrong label would skew the count. `/#nodos` (the link the team already shares) opens with
"Activar un Nodo" chosen; `/#patrocinio` opens with "Patrocinar membresías" chosen. Sending with no choice shows a
field error on the group, "Elige si quieren activar un Nodo o patrocinar membresías." (EN "Choose whether you want
to activate a Node or sponsor memberships.", PT "Escolha se querem ativar um Nó ou patrocinar membresias."), checked
in the browser before sending, because the server treats a missing kind as a Nodo request so that cached pages keep
working.

Choosing or switching changes the fields below, without clearing what was typed:

| | No choice yet | Activar un Nodo (today) | Patrocinar membresías (new) |
|---|---|---|---|
| Sponsor fields | hidden | hidden, not sent | shown, required |
| Message label | ¿Qué te interesa? (Cuéntanos brevemente) | same | ¿Qué tema o desafío urbano les interesa? (Cuéntanos brevemente) |

Reopening: after a thank-you, the next opening is a fresh form with no choice (unless it opens from one of the two
links). A window closed before sending keeps its choice and what was typed, as today.

The sponsor fields, placed after the phone and before the message:

1. **¿A qué comunidad les gustaría apoyar?** with the hint "(por ejemplo: ciclistas de Lima, su equipo, una red
   profesional)". One line of text, required, up to 200 characters.
2. **¿Cuántas membresías, aproximadamente?** A `<select>`, required, with: "1 a 10", "11 a 25", "26 a 50", "Más de
   50", "Aún no lo sabemos". Stored as the codes `1-10`, `11-25`, `26-50`, `50+`, `unsure`. A range rather than a
   number, so an organisation that has not decided can still send (builder's call).

The sponsor fields are hidden with the `hidden` attribute (not just CSS) when Nodo is chosen, so they are skipped by
keyboard and screen readers and their `required` does not block a Nodo send.

Sending, errors and the thank-you behave exactly as today; the two new fields join the field-error list (a 400 that
names `community` or `memberships` marks that field). The thank-you text is the same for both choices.

**Shareable link**: `/#patrocinio` opens the window on load with sponsorship chosen; closing removes the hash, as
`#nodos` does. Both hashes also open the window when they change while the page is open (a `hashchange` listener,
which `#nodos` lacks today). The card's button stays `href="#nodos"` (the no-JavaScript fallback is unchanged)
but, with JavaScript, opens the window with no choice made.

## What the team gets

### Email

Same recipients, sender name, Reply-To, timeout, never-retried behaviour and daily ceiling as Nodo requests (the 40
a Lima day is shared by both kinds). For a sponsorship:

- Subject: **"Patrocinio de membresías: {organización}"** (Nodo stays "Solicitud de Nodo: {organización}").
- First line: **"Una organización quiere patrocinar membresías."** (Nodo stays "Una organización quiere conversar
  sobre un Nodo.")
- Two extra rows after Teléfono: **"Comunidad a apoyar"** and **"Membresías (aprox.)"**, the latter in words ("11 a
  25", "Aún no lo saben").
- The message block is headed **"Tema o desafío urbano:"** instead of "Mensaje:".
- The desk link stays `/admin.html#nodes`.

### Desk

The Nodos band becomes the band for both kinds:

- Title "Solicitudes de organizaciones" (EN "Organization requests", PT "Solicitações de organizações"); the lead line
  says organisations asked about a Nodo **or about sponsoring memberships**.
- Each request shows its kind as a short label next to the organisation: **Nodo** or **Patrocinio**.
- A sponsorship request also shows "Comunidad: …" and "Membresías: …" (in words) above its message.
- A second filter beside "Mostrar [estado]": **"Tipo: Todos / Nodo / Patrocinio"**. The two filters combine.
- Status, Update, Delete, pagination, the version check and the email warnings are unchanged.
- The kind cannot be changed in the desk. The no-preselection rule above is what keeps labels right; if an
  organisation still files under the wrong kind, the message shows it, and at pilot volumes the team can allow for
  it when counting. (Changing the kind would need a sponsorship row without community or memberships, which weakens
  the storage check, plus a kind control and a PATCH change.)
- The band keeps its id `#nodes` (the emails link to it) and its tab position; its tab label becomes
  **"Organizaciones"** (EN "Organizations", PT "Organizações") instead of "Nodos".

## API

`POST /api/node-requests` takes three more optional fields:

- `kind`: `"node"` or `"sponsorship"`. Missing means `"node"`, so a landing page cached before this release still
  works. Anything else is a 400 with `field: "kind"`.
- `community`: for `"sponsorship"`, required text, trimmed, 1–200 characters, one line (same control/bidi rule as
  name and organisation). For `"node"`, ignored and not stored.
- `memberships`: for `"sponsorship"`, required, one of `1-10`, `11-25`, `26-50`, `50+`, `unsure`. For `"node"`,
  ignored and not stored.

Validation order follows the form: kind, name, organization, email, phone, community, memberships, message, language.
Everything else (same-origin check, honeypot, 20/hour per IP, 3/day per email, 202 for a trapped send, 503 when
nothing was stored) is unchanged.

`GET /api/admin/node-requests` accepts a `kind` query parameter (`node` | `sponsorship`), under the same strict rules
as `status`. The admin view adds `kind`, `community` and `memberships` (null for Nodo requests).

## Storage

One additive migration on `public.node_requests` (no new table):

- `kind text NOT NULL DEFAULT 'node' CHECK (kind IN ('node','sponsorship'))`; existing rows become `node`.
- `community text`, `memberships text`, both NULL for a Nodo request.
- A CHECK that ties them: a `node` row has both NULL; a `sponsorship` row has `community` of 1–200 characters and
  `memberships` in the five codes.
- An index for the kind filter: `(kind, created_at DESC, id DESC)`.
- The `updated_at` trigger stays on `status, version` only. RLS and grants are unchanged.

The SQLite schema in `server/node-requests-repository.js` gets the same columns and checks (for existing local
databases, added with `ALTER TABLE` when missing). `NODE_REQUEST_FIELDS` gains the three fields.

**Deploy order** (as for every migration, see the node-requests release): the owner applies the migration with
`npx --no-install supabase db query --linked -f supabase/migrations/<file>.sql` and then `supabase migration repair
--status applied <version>` **before** pushing `main`. Never `supabase db push`. If the code were deployed first,
every POST would answer 503 (column missing) and the desk band would fail to load, so the order matters.

## Privacy

The "Solicitudes de Nodo de organizaciones" row in the privacy policy (ES, EN, PT, then `node
scripts/build-privacy-page.js`) is widened to cover both kinds: it adds that a sponsorship request also stores the
community the organisation wants to support and the approximate number of memberships, and that the purpose is to
answer and talk about a NODAL node **or sponsoring memberships**. Sections 4 and 9 (who sees it, retention) say
"solicitudes de organizaciones" where they now say "solicitudes de Nodo". `docs/privacy/implementation-review.md`
and the email row of `docs/architecture.md` are updated to match. Nothing about a sponsored community's members is
collected: the form names a community, not people.

## Constraints from the codebase

All the constraints listed in the node-requests spec still apply (CSP with no inline script or style, DOM built
with createElement/textContent, landing translations in `HOME_ES`/`HOME_PT` with the `i18n.js` size budget and
`tests/home-i18n.test.js` hashes, desk copy in `web/scripts/i18n-dashboard.js` under `ops.*` in three languages,
asset `?v=` bumps with their pins in `tests/deploy.test.js`, `tests/landing-membership.test.js` forbidding prices
and finding the cards by class, Vercel's build running the suite with production env and the fake SMTP transport).
In particular:

- Every changed asset (`node-request.js`, `node-request.css`, `i18n.js`, `admin.js`, `i18n-dashboard.js`, and any
  other touched file) gets a new `?v=` and its test pins.
- `DEPLOYMENT.md` gets the migration step, placed outside the slices tests cut by heading.
- The release checklist names this migration as the newest one.

## Left to the builder

- Exact EN and PT wording beyond what is given above, in the register of the existing landing copy.
- The radio group's look within `node-request.css` (it should read as the form's first question, not a tab bar).
- The migration's file name and timestamp, constraint names, and how the SQLite table is upgraded in place.
- Whether the email's range words live in the email module or a shared map.
- Test design, following the existing harnesses (`tests/node-request*.test.js`).

## Builder's calls already made (owner to confirm when approving this document)

These are confirmed when the owner approves this document, **before the migration is written**: the ranges, the
community limit and the one-table choice go into a production CHECK, so changing them later means another migration.

- One added sentence on the card, still one button.
- The window's heading is fixed ("Para organizaciones NODAL"); each option carries its own line, the sponsorship
  one being "Apoya una comunidad. Activa una red."
- Nothing preselected from the card; `/#nodos` preselects Nodo and `/#patrocinio` preselects sponsorship.
- Memberships as five ranges including "Aún no lo sabemos", not a free number.
- Community limited to 200 characters, one line.
- The topic is the existing message field with a different label, not a new column.
- One table and one desk band for both kinds, renamed "Solicitudes de organizaciones" (tab "Organizaciones"); table
  name and band id stay.
- The kind cannot be changed in the desk.
- The 40-a-day email ceiling is shared by both kinds.
