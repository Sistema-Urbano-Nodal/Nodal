# Organisation node requests: design

Date: 3 November 2026. Status: draft for the owner's approval.

## Intent

The NODAL team (Flavia and Mariana) asked for a third option in the landing page's membership section, aimed at
organisations rather than people. In their words:

> **Para organizaciones NODAL**
> Activa un Nodo territorial y/o temático
> Si eres una organización interesada en promover un nodo en tu área de influencia y/o quieres contribuir a dar
> visibilidad a un tema urbano. Contáctanos para conversar.
> (Y que nos lleve a un form simple de interés: nombre, contacto, organización y brevemente qué te interesa)

The point is to start conversations with organisations that could host or champion a NODAL node, for a territory or
a theme. Success is that an interested organisation can say so in under a minute, without creating a NODAL account,
and that Flavia and Mariana hear about it at once and can answer it from their own inbox. Nothing is sold, booked or
promised by the form: it only opens a conversation.

## Decided by the owner

- The option is a **third card beside the two existing ones** ("Acceso comunitario" and "Membresía Fundador"), the
  same size, so the three read as equal ways in. Mockup option A of the brainstorm.
- The card's button opens the form **in a window over the landing page** (a modal dialog), not a page of its own.
- **No account** is needed to send it.
- Each request reaches **Flavia and Mariana by email**, and is listed **in the organiser desk** (admin.html).
- The emails go out through **the existing production mail account** (the one that sent the FIIU confirmations,
  `EMAIL_SMTP_URL`/`EMAIL_FROM` in Vercel), which stays configured after the festival; a copy of each request in its
  Sent folder is accepted.

## Goals

- A visitor to the landing page sees the third card, opens the form, sends it and is thanked, in their language
  (ES, EN or PT, as the rest of the landing page).
- Every accepted request is stored, emailed to both team members, and shown in a new desk tab where an admin marks it
  new, contacted or closed.
- A failed or skipped email never loses a request: it is still stored and still listed in the desk, which says the
  email did not go out.

## Non-goals

- No account creation, sign-in, or link between a request and a NODAL profile.
- No confirmation email to the organisation (see Protection).
- No CRM features: no notes, assignment, reminders or replies from inside NODAL. The team answers from their inbox.
- No change to the two existing cards, the Founder Membership or its payments.

## Anti-goals (a failure even if it works)

- The form becomes a way to send email to arbitrary addresses, or a spam channel that exhausts the SMTP account's
  daily quota (the same account sends the FIIU and other transactional mail).
- Requests silently disappear (an email failure that loses the request, or a bot filter that drops real people).
- The landing page gets heavier or breaks without JavaScript or without the API: the cards must still render and
  "Contáctanos" must still give the visitor a way to reach the team.
- Personal data of people without an account is collected without the privacy policy saying so.

## What visitors see

### The card

A third `<article class="plan …">` in `.plans` on `web/pages/index.html`, after the Founder card:

- Title: **Para organizaciones NODAL**, exactly as given.
- Line under the title, in the `.price` position: **Activa un Nodo territorial y/o temático**.
- Body: the paragraph as given, ending "Contáctanos para conversar."
- Button: **Contáctanos**.
- Visually it is an outlined card like "Acceso comunitario" with the pastel-green accent from the mockup, not a
  second beige card, so the Founder card stays the highlighted one. No checklist; one paragraph.
- Spanish copy is the team's wording; the English and Portuguese versions are written by the builder in the same
  register (owner reviews them in the final check).

### The window

"Contáctanos" opens a native `<dialog>` (showModal) over the landing page, following the dashboard's existing dialog
pattern (`web/pages/dashboard.html` `.partc`, `web/scripts/dashboard.js` showModal/close/cancel):

- Heading: "Para organizaciones NODAL" as a kicker, then "Activa un Nodo territorial y/o temático", then one line:
  "Cuéntanos quién eres y qué te interesa; te escribiremos para conversar."
- Fields, all labelled, in this order:
  1. **Nombre y apellido**: required, up to 120 characters.
  2. **Organización**: required, up to 160 characters.
  3. **Correo electrónico**: required, a valid address up to 254 characters (same check as sign-up).
  4. **Teléfono** (opcional): up to 40 characters of digits, spaces and `+ ( ) -`. This is the owner's "contacto"
     read as email plus an optional phone.
  5. **¿Qué te interesa?** (Cuéntanos brevemente): required, up to 1000 characters.
- A privacy line under the fields: "Usamos estos datos solo para responderte." with a link to `privacy.html`.
- Buttons: **Enviar** and a close control (× and Escape). Focus goes to the first field on open and back to the
  "Contáctanos" button on close.
- While sending, the button is disabled. On success the form is replaced, inside the same window, by a thank-you:
  "Gracias. Recibimos tu mensaje y te escribiremos pronto." with a close button.
- Errors appear in one `role="alert"` line inside the window, in the visitor's language: a field problem (named), too
  many attempts ("Intenta de nuevo más tarde"), or the service being unavailable. For too many attempts, and when
  the API cannot be reached at all (static preview, network failure), the error line also gives the two team
  addresses already in the footer so the visitor still has a way in.
- **Shareable link**: opening the landing page with `#nodos` (e.g. `https://…/#nodos`) opens the window on load, so
  the team can send organisations a direct link. Closing it removes the hash without a reload. (A call made while
  designing, listed below for the owner to confirm.)

### Without JavaScript

The cards render as today. "Contáctanos" is a real link to `#nodos` that does nothing harmful without JS; the
footer's two addresses stay on the page as the way in. That is acceptable.

## What the team gets

### Email

One plain message per accepted request, sent to each of the two addresses already published in the site footer:
`fmuro@sistemaurbano.org` and `malegre@sistemaurbano.org` (one SMTP send per recipient: the mailer sends one `RCPT`
per connection; send both in parallel within the request).

- Language: Spanish (the team's working language), whatever language the visitor used; the visitor's language is
  shown in the body.
- Subject: `Solicitud de Nodo: <organización>` (the organisation name encoded by the mailer, CR/LF stripped).
- Body: every field, the received time in Lima, the visitor's language, and a link to the desk tab.
- **Reply-To: the organisation's address** (a `{name, address}` mailbox, name = the person's name, address checked
  with the mailer's `validAddress`), so replying writes straight to them.
- **From: "NODAL" as the display name, with the configured `EMAIL_FROM` address.** Production's `EMAIL_FROM` reads
  "FIIU Fest 11 <…>"; `server/mailer.js` `send()` gains an optional `fromName` that replaces only the display name
  (the address must stay the account's), with mailer tests.
- The recipients live in a server constant next to the feature (the way prices live in `server/membership-offer.js`),
  not in an env var: changing them is a reviewed commit, and nothing needs configuring in Vercel to turn it on.
- Same gate as the FIIU mail (`mailGate` semantics in `server/fiiu-email.js`): off outside Vercel Production, off
  without `EMAIL_SMTP_URL`/`EMAIL_FROM`/`PUBLIC_BASE_URL`, loopback-only for a local SQLite server. Export or share the
  gate rather than copying it.
- The outcome is stored on the request: `sent` (both accepted), `partial` (one accepted, the other failed or
  uncertain), `uncertain` (none accepted, at least one uncertain), `failed` (both failed), or `off` (email not
  configured, gated, or over the daily ceiling). Never retried automatically; the desk shows anything but `sent`.
  The daily ceiling counts requests with `email_status` other than `off` since midnight in Lima.
- At most **40 requests a day are emailed** (80 messages), counted in the database like the FIIU `DAILY_CAP`, so the
  ceiling holds across Vercel instances. Beyond it requests are still stored, marked `off` for email, and listed in
  the desk. This protects the SMTP account's daily quota, which other NODAL mail shares.

### Desk tab

A new band in `web/pages/admin.html`, tab label **Nodos** (ES) / "Nodes" (EN) / "Nós" (PT), placed right after
Interests and before Founders (so Founders stays the last band), built like the Interests band (`#interests`,
`web/scripts/admin.js` interest queue):

- Lists requests, newest first, 24 per page with a "more" button; filter by status (all / new / contacted / closed).
- Each item shows: organisation, person's name, email as a `mailto:` link, phone if given, the message, the visitor's
  language, the received date (Lima), and a warning line when the team email was not `sent`.
- Status select (new → contacted → closed, any direction) with an Update button, compare-and-swap on `version`, the
  same 409 "changed by someone else" handling as Interests.
- A **Delete** button on each request (with a confirm), for when someone asks to be forgotten. Admin-only.

## Protection against misuse

All of these, none of them visible to a real visitor:

- `sameOrigin` check and JSON-only body (`readJsonBody`, 32 KiB cap, 413 handling as today).
- The route is sessionless (add it to `SESSIONLESS_API`), so an anonymous POST never costs a GoTrue call or fails
  when the session service is down.
- Rate limits with the existing `createWindowRateLimiter`: 20 requests per hour per IP (`clientIp(req)`), generous
  because a room on shared Wi-Fi or a Peruvian mobile carrier's NAT shares one address, and 3 per day per email
  address (sha256 key, like `authAccountKey`). Answers 429 with `Retry-After`. Per warm instance, as every limiter in
  NODAL (documented caveat); the database-counted email ceiling is the global backstop. A 429 in the window shows
  the two team addresses too, so a real person turned away by a shared address still has a way in.
- A honeypot field (a visually hidden, `aria-hidden`, `tabindex="-1"`, autocomplete-off text input, e.g. `website`):
  when filled, answer exactly as a success but store and send nothing.
- Length and format limits on every field, server-side (the client mirrors them for messages only).
- No captcha. No confirmation email to the sender, so the form can never be used to mail someone else.

## API

- `POST /api/node-requests` (public): body `{name, organization, email, phone?, message, language, website?}`.
  `language` is `es|en|pt` (default `es`). Answers `202 {ok:true}` for accepted and honeypot requests alike; 400 with
  a field-specific error code for invalid input; 429; 503 when storage fails (nothing stored, nothing sent). The email
  is awaited inside the request (Vercel gives no work time after the response), bounded by the mailer's 8 s timeout;
  the request is stored *before* the email is attempted, and the stored outcome is updated after.
- `GET /api/admin/node-requests?status=&limit=&cursor=` (admin): `{requests, nextCursor}`, same query rules as
  `/api/admin/interests`.
- `PATCH /api/admin/node-requests/:id` (admin, sameOrigin, throttled): `{status, version}` → `{request}`, 404, or
  409 `{error, code:'version_conflict', request}` (the news desk's shape).
- `DELETE /api/admin/node-requests/:id` (admin, sameOrigin, throttled): 204, also when it was already gone (as news).
- Admin routes go in `ID_ONLY_API`. All endpoints are listed in README.md where the catalog Interest endpoints are.

## Storage

A new table, `node_requests`, in both backends:

- SQLite: the table's own schema in its own store module, the way `server/news-repository.js` declares
  `nodal_news` (`CREATE TABLE IF NOT EXISTS` run by the store), not a new `server/db.js` `MIGRATIONS` entry.
- Supabase: a new file `supabase/migrations/<14-digit timestamp>_node_requests.sql`, sorted after `20261023000000`,
  in the latest header style (server-only: RLS on, no client policies; `REVOKE ALL … FROM PUBLIC, anon,
  authenticated, service_role`; `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`; additive; apply before
  pushing `main` with `npx --no-install supabase db query --linked -f …`, then `supabase migration repair --status
  applied <ts>`; never `db push`). The owner applies it.
- Columns: `id uuid` (default `gen_random_uuid()`), `name`, `organization`, `email`, `phone` (nullable), `message`,
  `language` (`es|en|pt`), `status` (`new|contacted|closed`, default `new`), `email_status`
  (`sent|partial|failed|uncertain|off`, nullable until the attempt ends), `version` (int, default 1),
  `created_at`/`updated_at` (timestamptz, `set_updated_at` trigger), `updated_by` (FK to profiles, `on delete set
  null`). Length checks matching the limits above. Index for the desk list `(created_at desc, id)` and for the status
  filter.
- One store module serving both backends, like `createNewsStore` (see the plan for its methods).

## Privacy

The privacy policy (`docs/privacy/privacy-policy.{en,es,pt-BR}.md`, regenerated with
`node scripts/build-privacy-page.js`, dates bumped) gets a new §2 row, **Organisation node requests** / "Solicitudes
de Nodo de organizaciones" / "Solicitações de Nó de organizações":

- What: name, organisation, email, optional phone and message, sent by anyone through the landing page form, with or
  without an account; the language used and when it was sent.
- Why: to answer the request and talk about a NODAL node; nothing else (no newsletter, no profile).
- Who sees it: NODAL's administrators, in the desk, and the two team members by email. Each request therefore also
  exists as an email in their two inboxes and in the sending account's Sent folder (its mailbox provider is covered by
  §7). The policy says so plainly.
- Retention: deleted when the person asks (from the desk, and the team deletes the email copies by hand), and
  automatically 12 months after the request was closed. The policy states that the automatic rule covers NODAL's own
  records and that email copies are deleted by the team on request; it promises nothing more. The desk's Delete
  confirmation reminds the admin to delete the two emails as well.
  The automatic purge runs lazily: whenever the desk list loads or a new request arrives, closed requests whose
  `updated_at` is older than 12 months are deleted. Requests never closed stay until someone closes or deletes them.
- Not part of any member's export or account deletion (they are not tied to an account).
- §9 (retention) gains the 12-month rule; `docs/privacy/implementation-review.md` gains the table's row.

## Constraints from the codebase

- CSP: `script-src 'self'`, `style-src 'self'`, no inline script or style attributes; DOM built with
  createElement/textContent. `connect-src 'self'` and `form-action 'self'` already allow the same-origin POST.
- Landing translations: EN is captured from the markup, ES/PT go in `HOME_ES`/`HOME_PT` in `web/scripts/i18n.js`
  (home-only), JS-only strings in `DASH_*`. Mind `tests/home-i18n.test.js` hashes and `tests/i18n-split.test.js`
  (i18n.js under 80,000 bytes, currently 72,887: put long dialog copy in its own dictionary if needed). Desk copy goes
  in `web/scripts/i18n-dashboard.js` under `ops.*`.
- A new script or stylesheet must be registered in the page, `server/server.js` `STATIC_SCRIPTS`/styles,
  `scripts/build-static.js` and the `vercel.json` header regex (`tests/deploy.test.js:558`). Every changed asset gets
  a new `?v=` and its pins in `tests/deploy.test.js` (and `tests/fundadores-page.test.js` for shared ones) are
  updated.
- `tests/landing-membership.test.js` runs `app.js` against a fake document without `addEventListener`, finds the two
  cards by exact class strings, and forbids prices in `index.html`; `tests/founders-desk-ui.test.js` pins the desk
  tab order and assumes Founders is the last band; `tests/catalog-ui.test.js` pins the desk sections and checks every
  `ops.*` key resolves in three languages. Update these deliberately, not by loosening them.
- Vercel's build runs lint and the whole suite with production env (`VERCEL=1`, `VERCEL_ENV=production`): inject
  env, clocks and the mail transport; never read the real date or send real mail in tests (`tests/helpers/
  fake-smtp.js`).
- DEPLOYMENT.md gets a `## Organisation node requests: one migration before main` section placed outside the two
  slices that tests cut by heading (`## Founder Membership acceptances` → `## Founder badge` in
  `tests/membership-fundadores.test.js`, `## Founder badge` → `## Supabase Setup` in `tests/founder-badge.test.js`).
- docs/architecture.md: add the rate limits and the email to its tables.

## Left to the builder

- English and Portuguese wording of the card, the window, its errors and the thank-you, in the register of the
  existing landing copy.
- The exact card styling within the landing's tokens (outlined card, pastel-green accent), and how three cards wrap
  between 820 and 980 px (two plus one, or the third spanning both columns).
- Whether the dialog code lives in `app.js` or a new `web/scripts/node-request.js` (with its registrations).
- Error codes, log lines (never addresses or message text in logs), and the desk's exact layout within the
  Interests band's pattern.
- Test design, following the existing harnesses.

## Builder's calls already made (owner to confirm when reviewing)

- Phone as an optional extra field; email required.
- Reply-To set to the organisation; recipients in code, not env.
- Team email in Spanish; visitor-facing copy in ES/EN/PT.
- No confirmation email to the sender; no captcha; honeypot (`website`) plus rate limits (20/hour per IP, 3/day per
  email) plus a 40-a-day email ceiling.
- Sender display name "NODAL" instead of "FIIU Fest 11".
- The privacy policy names the email copies and promises only that the team deletes them on request.
- `#nodos` opens the window directly.
- A Delete button and a 12-month automatic purge of closed requests, stated in the privacy policy.
