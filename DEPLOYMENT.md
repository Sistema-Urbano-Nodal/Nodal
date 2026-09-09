# NODAL Deployment Checklist

For the September course pilot, follow [course pilot operations](docs/course-pilot-operations.md) and apply all pending migrations before deploying the server. The guide covers internal-team forms/feedback exports, course setup, upload reconciliation, and capacity acceptance.

## Supabase Setup

1. Create a Supabase project.
2. Open Project Settings -> API Keys.
3. Copy the Project URL into `NEXT_PUBLIC_SUPABASE_URL`.
4. Prefer the new `sb_publishable_...` key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Prefer the new Supabase secret key for `SUPABASE_SECRET_KEY`.
6. Legacy projects may use `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
7. Never put `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in browser code.

## SQL Migration Steps

Apply this migration in Supabase SQL Editor or through the Supabase CLI:

```sh
supabase db push
```

Migration directory:

```text
supabase/migrations/
```

Confirm after applying:

- RLS is enabled on every app table.
- Browser roles cannot read `public.public_profiles` or the underlying member/course tables directly. The server returns only authorized projections.
- No card data, Stripe secrets, passwords, or raw payment details are stored.
- `profile_preferences`, `onboarding_responses`, and `stripe_customers` have `user_id` indexes.
- Supabase `profiles` (SQLite `users`) has `city_lat`, `city_lon` and `city_label`
  (`20260727000000_member_location.sql`). The server writes them when a member
  saves a city and never accepts them from a request body; existing rows fill in
  the first time each member saves their profile, and any row still missing
  coordinates is geocoded on read, so no backfill is required.

## Vercel Environment Variables

Set these in Vercel Project Settings:

```text
NODE_ENV=production
DATA_BACKEND=supabase
NEXT_PUBLIC_APP_URL=https://your-domain.example
PUBLIC_BASE_URL=https://your-domain.example
COOKIE_SECURE=true
TRUST_PROXY=true
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=<server-only Supabase secret key>
PAYMENTS_MODE=preview
PILOT_MODE=true
```

Leave the `SUBSCRIPTION_*` price variables unset while launch pricing is not announced: the UI then shows `Soon` in every price slot. Setting them is what publishes a real amount. Switching to `PAYMENTS_MODE=live` is what makes a price mandatory — the deployment then refuses to boot until both `*_LABEL` variables are set, so a paid tier can never go live nameless:

```text
SUBSCRIPTION_PRICE_MONTHLY_LABEL=US$10
SUBSCRIPTION_MONTHLY_PERIOD=/ month
SUBSCRIPTION_PRICE_ANNUAL_LABEL=US$100
SUBSCRIPTION_ANNUAL_PERIOD=/ year
```

Set the Supabase URL and publishable key for both Production and Preview when preview deployments need working authentication. Scope the server credential only to trusted preview branches. Set `PUBLIC_BASE_URL` or `NEXT_PUBLIC_APP_URL` explicitly for each environment: password recovery and invitations require that configured origin and do not fall back to `VERCEL_URL`. Add each intended callback URL to Supabase's redirect allowlist.

Add these when Stripe goes live:

```text
PAYMENTS_MODE=live
STRIPE_SECRET_KEY=<server-only Stripe live secret key>
STRIPE_WEBHOOK_SECRET=<server-only Stripe webhook signing secret>
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_ANNUAL=price_...
```

## Auth Redirect URL Setup

In Supabase Auth URL configuration:

- Site URL: `https://your-domain.example`
- Redirect URLs:
  - `https://your-domain.example/login.html`
  - `https://your-domain.example/dashboard.html`
  - `https://your-domain.example/profile.html`
  - `https://your-domain.example/reset-password.html`
  - `https://your-domain.example/accept-invitation.html`

If email confirmations are enabled, keep the Supabase confirmation template pointed at the production domain.

## Local Development Setup

SQLite fallback:

```sh
npm install
DATA_BACKEND=sqlite npm run migrate
DATA_BACKEND=sqlite npm start
```

Supabase-backed local run:

```sh
DATA_BACKEND=supabase \
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
SUPABASE_SECRET_KEY=<server-only Supabase secret key> \
PUBLIC_BASE_URL=http://127.0.0.1:4173 \
npm start
```

## Production Deployment Steps

1. Confirm `.env`, `.env.local`, `.env.production`, `.vercel/`, and `data/` are not committed.
2. Apply the Supabase migration.
3. Configure Vercel environment variables.
4. Run `npm ci` and `npm run build`; verify generated `public/` assets exist and no source PNG files are copied there.
5. Connect the Git repository to Vercel.
6. Keep Framework Preset as Other or use the committed `vercel.json`.
7. Deploy. Vercel serves generated `public/` assets directly and routes HTML/API requests through `api/index.js`.
8. Visit `/api/health`.
9. Create a test account.
10. Confirm `/dashboard.html` redirects unauthenticated users to `/login.html`.
11. Confirm profile edits persist after refresh.
12. Confirm pilot checkout is unavailable while `PILOT_MODE=true`. `PAYMENTS_MODE=preview` alone does not disable checkout when Stripe credentials are configured.

## Security Checklist

- No real secrets in Git.
- Supabase secret/service-role key exists only in Vercel server env.
- RLS remains enabled on all Supabase tables.
- Public directory data is served only from intentional fields.
- Member directory visibility is opt-in: only members whose Part C `consent` is
  true appear in `GET /api/users`, `GET /api/users/search` and `GET /api/users/:id`.
  A member who never consented returns 404 from the card endpoint, so it cannot be
  used to confirm that an account exists.
- `GET /api/users/search` matches name, role and city on substring but requires a
  full registration email to match by address, and never returns an email. It is
  rate limited per session (`MEMBER_SEARCH_RATE_LIMIT`, default 40/min).
- Every globe node represents a member's saved profile city. A member can edit
  that city manually or accept an optional location suggestion. The dashboard
  requests browser location permission, rounds coordinates to two decimal places
  before transmission, and sends them through NODAL to the configured GeoDB
  provider. Precise browser position and location history are not stored by NODAL.
  Automatic checks default off, require existing browser permission, and run at
  most once per local day while the network view is visible. A detected city
  changes the saved profile only after the member accepts it.
  A card names the member, their role, a link to their member page and their
  LinkedIn if they added one; an email address is never in the payload.
- A member's pin is resolved server-side at save time and stored in
  `city_lat`/`city_lon`/`city_label`. `PATCH /api/me` ignores those fields in the
  request body - they are not in the profile allow-list - so a member cannot
  place their own pin anywhere except by naming a city the geocoder recognises.
- Named globe listings respect Part C's "list my name" choice (`partC.listName`)
  in addition to directory consent. An absent legacy value defaults to named;
  clearing the checkbox keeps the member in
  the city count but drops their name, role and links from the payload entirely.
- The lines between cities are aggregate. They come from the follow graph reduced
  to city-pair counts, so a line says two cities are connected and how strongly,
  never which two members.
- Updates are polled while visible, roughly every 15 seconds plus jitter, with
  backoff after provider errors. Revision checks invalidate cached snapshots
  after committed profile, consent and graph changes.
- `GET /api/network/places` feeds the globe. It groups consenting members by city
  and resolves each city through the same provider the profile form uses, so any
  city on Earth can appear - not a hardcoded list. Coordinates are cached for a
  month (city centers do not move). Responses include the viewer's listing
  status and use private/no-store caching. Named people include member IDs,
  names, roles, joining dates and profile links, never email addresses.
  `?topic=` filters the roll-up to one area of work; the value is compared
  against the member's own topics and is never interpolated into a query.
- Auth cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Stripe webhook signature verification is configured before live billing.
- Production logs do not include passwords, access tokens, service keys, or raw profile payloads.
- Every endpoint that leaves the building or reads the whole directory is rate
  limited per session: the geocoder proxy, the globe roll-up, the member
  directory, profile saves, data export and Stripe checkout. Limits are keyed by
  account when there is one, by address otherwise.
- Rate limits are keyed on `X-Real-IP`, or the rightmost `X-Forwarded-For` hop -
  never the leftmost, which the caller controls. `TRUST_PROXY=true` is required
  behind Vercel for this to read the real address.
- **Serverless caveat:** rate-limit buckets live in the function instance's
  memory, so limits apply per warm instance rather than globally. `REDIS_URL`
  shares recommendation/city cache values only; it does not share request
  budgets. Global enforcement needs an explicit shared limiter or deployment
  firewall configuration.
- Interaction history retains at most 50 events per directed pair. Follow
  events are recorded only when a new edge is inserted. Apply the retention
  migration before deploying the corresponding Supabase writer.
- Upload allowances include pending reservations and are checked atomically
  by course and owner: 100 files and 30 MiB. Official materials use the course's
  separate allowance. Keep uncertain uploads reserved until reconciliation.

## Interface Language

- Members pick EN / ES / PT at sign-in; the choice persists in `localStorage`
  under `nodal.lang` and carries into the console, the member profile and the
  membership page. `?lang=en|es|pt` overrides it for a direct link.
- Subscription **amounts** are shown exactly as configured in
  `SUBSCRIPTION_PRICE_*_LABEL`, in every language. The wording around the amount
  (cycle name, period suffix, renewal and cancellation notes) is translated when
  it matches the English default; set `SUBSCRIPTION_MONTHLY_*` /
  `SUBSCRIPTION_ANNUAL_*` to anything else and that text is shown verbatim, so
  write it in the language members should read.

## Manual External Configuration Still Required

- Supabase project creation and SQL migration execution.
- Supabase Auth email settings.
- Stripe products, prices, Checkout configuration, and webhook endpoint.
- Vercel project env vars, production domain, TLS, and deployment protection.
- Optional Redis cache with `rediss://` if remote caching is needed.
