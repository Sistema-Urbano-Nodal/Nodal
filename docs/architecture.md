# NODAL architecture and security

How NODAL is built, where it runs, how it protects accounts and data, and what is still on the roadmap. Last checked 20 Oct 2026, against the code on `main` and the live deployment.

## Where it runs

| Part | Service | Region |
|---|---|---|
| Pages, scripts, styles, fonts | Vercel CDN | edge locations worldwide, so visitors in Lima, Santiago and São Paulo load them from nearby |
| Server (every `/api/*` request and every private page) | Vercel Functions, Node 22 | `pdx1`, Portland, Oregon |
| Database, sign-in and file storage | Supabase: Postgres, Auth and Storage | `us-west-2`, Oregon |

- **The server and database are close together.** They sit in the same region, so each database call the server makes takes a few milliseconds.
- **Visitors in Lima wait about 150 ms per data request.** That's the round trip to Oregon; static files come from the nearby CDN.
- **Moving closer to Latin America would mean São Paulo.** That needs a new Supabase project and a data migration, so it's only worth doing if that latency becomes a real problem.
- **One database.** It is a single Postgres primary with no read replica, and Supabase handles backups according to the project's plan (check it in the Supabase dashboard). At NODAL's size a replica wouldn't help.

## Stack

- **Server:** a Node.js HTTP server with no runtime dependencies (`server/`), deployed through `api/index.js`. Every outside service is called with plain `fetch`.
- **Pages:** HTML in `web/pages` and plain JavaScript in `web/scripts`, with no framework and no third-party scripts.
- **Build:** each Vercel deploy runs lint and the whole test suite (about 1,900 tests) with the production environment, then builds the static files. A failing test stops the deploy.
- **Development:** locally the same server runs on SQLite instead of Supabase.

## Accounts, sign-in and sessions

- **Sign-in:** email and password through Supabase Auth, with email confirmation and password recovery.
- **Sessions:** the access and refresh tokens live in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Page scripts can never read them. The server checks every request with Supabase Auth, renews the access token when it expires, and signing out ends only that browser's session.
- **Data access:** the browser never talks to the database. The server holds Supabase's secret key and enforces who may read or change what. Row-level security is on for every table exposed through Supabase's API, as a second barrier.
- **Two-factor sign-in:** not built yet. Supabase supports authenticator-app codes (TOTP). The plan is to offer them first to organiser and admin accounts.

## Protection against abuse

**Rate limits** (defaults, each changeable in Vercel; see `.env.example`):

| What | Limit |
|---|---|
| Wrong passwords | 10 per email and client every 5 minutes |
| | 50 per email from all clients every 5 minutes |
| Sign-ups and sign-ins | 800 per client address every 5 minutes |
| Anonymous sign-ups | 200 an hour |
| Rejected session renewals | 30 per client every 5 minutes |
| Directory, map and city lookups | 60 a minute |
| Member searches | 40 a minute |
| Profile saves | 60 a minute |
| Follows and other interactions | 60 a minute |
| Exports and other costly actions | 10 every 10 minutes |
| Map refreshes | 40 a minute |

Supabase Auth adds its own limits on sign-ins and token renewals (raised to 600 every 5 minutes on 7 Sep 2026).

Other protections:
- **CSRF:** every request that changes something must come from NODAL's own pages.
- **Request size:** request bodies are capped at 32 KB, and uploads have their own size and type checks.
- **Known gap:** the counters are kept per server instance. Under heavy traffic Vercel runs several instances, so the limits are per instance, not global. A Redis store (`REDIS_URL`, for example Upstash) would make them global.

## Browser security

Every page is served with:

- **A strict Content Security Policy:** scripts, styles, fonts and connections from NODAL itself only; `object-src 'none'`; `frame-ancestors 'none'`.
- **The standard protective headers:** Strict-Transport-Security, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off the camera, microphone and payment APIs, and same-origin `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **No caching of private pages:** `Cache-Control: no-store` on HTML and the API, so no CDN keeps a signed-in page.

Payments don't need any change to these rules. The Supporting membership is paid through Mercado Pago links ([supporter-payments.md](supporter-payments.md)), which open Mercado Pago's own page, and the policy restricts what NODAL's pages load, not where their links lead. Only embedding a third-party form or script would need its domain added, and only that one domain.

## Outside services

| Service | Used for | What it receives |
|---|---|---|
| Vercel | hosting and CDN | every request |
| Supabase | database, sign-in, file storage | all stored data |
| Email over SMTP (`EMAIL_SMTP_URL`) | confirmations, password recovery, festival emails | the recipient's address and the message |
| GeoDB Cities | city search and placing members on the map | the typed city or approximate coordinates |
| Mercado Pago | Supporting membership payments, on its own page | what the payer enters there; NODAL sends nothing |
| Sentry (optional) | server error reports | see *Errors and monitoring* |

The privacy policy (`docs/privacy/`, published at `/privacy.html`) names each of them.

## Errors and monitoring

- **Logs:** every server error is written to the Vercel function logs.
- **Sentry:** once `SENTRY_DSN` is set, errors also go to Sentry (`server/error-report.js`, over Sentry's plain HTTP API). Two kinds are sent: answers of 500 and above, and errors from the database that the server hides behind "request failed".
- **What a report contains:** the error's type, its message with emails, keys and ids removed, the code location, the request method, the route with ids replaced, and the status.
- **What a report never contains:** a query string, a header, a cookie, a request body, an IP address or an account.
- **Limits:** each server instance sends at most 20 reports a minute, and the same error on the same route once a minute. A report waits at most 1.5 s.
- **Where reporting is on:** only the deployed entry points (`api/index.js`, `npm start`). An app built inside a test never reports, so a Vercel build sends nothing.

## Security reviews

- **July 2026:** two multi-agent security audits. Their findings were fixed, covering forwarded-address rate-limit keys, unlimited costly endpoints and session amplification.
- **19-20 Oct 2026:** a pre-festival audit of security, bugs and load, with 49 confirmed findings and none critical. The festival-relevant ones were fixed and deployed the same day.
- **Deferred:** the remaining items are recorded for after the festival (internal notes).

## Roadmap

1. **Two-factor sign-in,** for organiser and admin accounts first.
2. **Global rate limits** through Redis.
3. **Aggregate, cookie-free analytics** (Plausible or Vercel Web Analytics): page views and clicks on the payment buttons, with no tracking of individuals. It needs a privacy policy update.
4. **A way for staff to remove a course participant.** It's needed before the first memberships end, around 2027.
5. **The full Mercado Pago integration,** once Supporters are too many to add by hand ([integrations/mercadopago-subscriptions.md](integrations/mercadopago-subscriptions.md)).
6. **A load test** against a preview deployment, never production.
