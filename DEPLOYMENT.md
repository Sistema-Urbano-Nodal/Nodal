# NODAL Deployment Checklist

For the September course pilot, follow [course pilot operations](docs/course-pilot-operations.md) and apply all pending migrations before deploying the server. The guide covers internal-team forms/feedback exports, course setup, upload reconciliation, and capacity acceptance.

## October 1 release: three migrations before `main`

Merging to `main` deploys Production. Apply these three migrations to the
production Supabase project **before** that merge, one file at a time in
timestamp order (see "SQL Migration Steps": never `supabase db push` against
production). Each one is safe for the code that is
live today, so applying them first never breaks the current site; deploying the
code first does.

1. `20261001011348_close_mobility_pilot_enrollment.sql`: data only. Closes
   enrolment on "Curso Movilidad Nivel 2" (`72e3cc56-a506-4a1b-97b5-9333e8d283ca`)
   and does nothing if the course is already closed or has another id. Run
   `select id, title, enrollment_open, version from pilot_courses order by created_at;`
   first to confirm the id. Unticking "Enrollment open" in the teaching workspace
   has the same effect without a deploy.
2. `20261001011356_nodal_news.sql`: the `nodal_news` table for NODAL-wide news
   (RLS on, no browser grants, service role limited to select/insert/update/delete).
   Without it every `/api/news` and `/api/admin/news` request fails with
   404 `{"error":"request failed"}` (PostgREST reports the missing table as 404,
   and the server passes that status on with a masked message).
3. `20261001011759_fiiu_checkin.sql`: adds `fiiu_attendance.method`
   (`'staff'` or `'qr'`, existing rows become `'staff'`), an `activity_id` index,
   and replaces `fiiu_event_summary` with the same signature and grants plus the
   check-in figures. The new server selects `method` on every attendance read and
   write, so until this is applied those requests fail with 400
   `{"error":"request failed"}` (PostgREST's answer to the unknown column): the
   FIIU registration load for anyone who has registered, `/api/me/export`, the
   organiser's registration detail and attendance toggle (an untick deletes the
   row and then reports the error), self check-in and the participant CSV.

Confirm after applying:

```sql
select id, enrollment_open, version from pilot_courses where id = '72e3cc56-a506-4a1b-97b5-9333e8d283ca';
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'fiiu_attendance' and column_name = 'method';
select has_table_privilege('anon', 'public.nodal_news', 'select'),
       has_table_privilege('service_role', 'public.nodal_news', 'truncate');  -- both false
```

Record the applied versions (`npx supabase migration list`) in
`docs/course-pilot-validation.md`. Only then merge to `main`.

## FIIU registration summary email: one migration before `main`

After a person's **first** FIIU registration the server emails them a summary
(see "FIIU registration summary email" below). Apply
`20261003013301_fiiu_confirmation_email.sql` to the production Supabase project
**before** merging. It only adds three columns to `fiiu_registrations`
(`confirmation_status`, default `'none'`, `confirmation_language` and
`confirmation_sent_at`) with CHECK constraints: existing rows become `'none'`,
and the code live today never reads them, so applying it first is safe. The new
server selects these columns on every registration read, so deploying the code
first breaks the FIIU registration, `/api/me/export`, the organiser list and
detail and the CSV with 400 `{"error":"request failed"}` until it is applied.

```sql
select column_name, column_default, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'fiiu_registrations' and column_name like 'confirmation_%';
-- confirmation_language | (null) | YES
-- confirmation_sent_at  | (null) | YES
-- confirmation_status   | 'none'::text | NO
```

Merging without the email variables below is fine: the email is simply off and
registrations behave as before (status `none`).

## October 3 full review: two migrations, applied by hand

Both files are additive and idempotent and safe for the code that is live
today: the server reaches these objects only as `service_role`, and the
trigger change keeps what the function does. Apply them one at a time with
`npx --no-install supabase db query --linked -f supabase/migrations/<file>.sql`
(never `supabase db push`, see "SQL Migration Steps"), then the project owner
records each version with `supabase migration repair --status applied <version>`.

1. `20261003201144_course_posts_revision_definer.sql`: runs the
   `course_posts_revision()` trigger as its owner (`SECURITY DEFINER`, empty
   `search_path`). Until it is applied, deleting the account of anyone who ever
   posted in a course fails (Supabase Auth deletes as `supabase_auth_admin`,
   which cannot update `course_modules`), and `DELETE /api/me` answers 500 after
   part of that member's course data is already gone.
2. `20261003201338_close_client_grants_on_server_tables.sql`: revokes the
   browser roles' default rights on `organizations`, `organization_memberships`
   and `stripe_events`, `EXECUTE` on `set_updated_at()` and the sequence
   `member_interactions_id_seq`. Revokes only.

Read-only checks, before and after:

```sql
select prosecdef from pg_proc where proname = 'course_posts_revision';   -- false before, true after
select has_table_privilege('supabase_auth_admin', 'public.course_modules', 'UPDATE');  -- false
select has_table_privilege('anon', 'public.stripe_events', 'SELECT'),
       has_table_privilege('authenticated', 'public.organizations', 'SELECT');        -- false, false after
```

## Final survey (Curso Movilidad Nivel 2): one migration, applied by hand, before `main`

The final survey and certificates for *Curso Movilidad Nivel 2* (see
[docs/implementation/course-final-survey.md](docs/implementation/course-final-survey.md))
add two server-only tables. Apply
`20261006004500_course_final_survey.sql` to the production Supabase project
**before** merging, then merge. It is additive and wrapped in a transaction:
it creates `course_survey_responses` and `course_certificates` (RLS on, no
browser grants, `service_role` limited to select/insert/update/delete) and
changes nothing that exists, so the code live today is unaffected. A second
run fails on "already exists" and changes nothing.

**Do not deploy the code first.** The new server reads these tables for
*every* member's `GET /api/me/export` and `DELETE /api/me` (course data export
and erasure), not only on this course: until the migration is applied those
fail for everyone, and the course page and the organiser tab of this course
fail too. `npm run uploads:reconcile` also reads them.

```sh
npx --no-install supabase db query --linked -f supabase/migrations/20261006004500_course_final_survey.sql
# the project owner then records it (never `supabase db push`):
supabase migration repair --status applied 20261006004500
```

Read-only checks after applying:

```sql
select relname, relrowsecurity from pg_class
 where oid in ('public.course_survey_responses'::regclass, 'public.course_certificates'::regclass);  -- both true
select has_table_privilege('anon', 'public.course_survey_responses', 'SELECT'),
       has_table_privilege('authenticated', 'public.course_certificates', 'SELECT');                -- false, false
select to_regclass('public.course_certificates_one_ready');                                         -- not null
```

Also confirm through the Data API (not only SQL) that PostgREST sees the new
tables: a service-role `GET /rest/v1/course_survey_responses?select=id&limit=0`
and the same for `course_certificates` must answer 200. If they answer 404, run
`NOTIFY pgrst, 'reload schema';` and check again.

Before the survey is announced, run two read-only checks and share the results
with the organiser:

```sql
-- 1. Who holds app_role admin. Every administrator can read individual answers, while the survey tells
--    participants that teachers only receive grouped results: no teacher of the course may be on this list.
select id, full_name, email from profiles where app_role = 'admin' order by full_name;
-- 2. Enrolled administrators. They are organisers: they get a read-only preview and are left out of every
--    count, list, CSV and certificate (expected today: 3 of the 20 enrolled, so 17 participants).
select p.full_name, p.email from course_enrollments e join profiles p on p.id = e.user_id
 where e.course_id = '72e3cc56-a506-4a1b-97b5-9333e8d283ca' and p.app_role = 'admin';
```

After the merge, check the Vercel deployment status (the build runs the
tests), then smoke-test as a non-enrolled administrator: the teaching
workspace lists the participants with 0 answered, both CSVs download, and the
course page shows the read-only preview. Do not enrol staff accounts in
production for testing.

Afterwards:

- The form closes by itself at `2026-10-24T05:00:00Z` (end of 23 October in
  Lima). No deploy is needed.
- **Keep the course published.** Participants reach the survey and download
  their certificate only while *Curso Movilidad Nivel 2* is `published`.
  Archiving it or setting it to draft hides both, including certificates of
  people who already answered. Leave it published for as long as certificates
  should stay downloadable.
- If an upload or a deletion of a certificate failed with a Storage error, run
  `npm run uploads:reconcile` (dry run; see its `certificates` part), then
  `npm run uploads:reconcile -- --apply`.
- Retention of the responses (including started-only rows) is not decided yet;
  record the decision with the other course categories in `docs/privacy/`.

## Supabase Setup

1. Create a Supabase project.
2. Open Project Settings -> API Keys.
3. Copy the Project URL into `NEXT_PUBLIC_SUPABASE_URL`.
4. Prefer the new `sb_publishable_...` key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Prefer the new Supabase secret key for `SUPABASE_SECRET_KEY`.
6. Legacy projects may use `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
7. Never put `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in browser code.

## SQL Migration Steps

Migration directory:

```text
supabase/migrations/
```

**Never run `supabase db push` against production.** The production project's
migration history (`supabase_migrations.schema_migrations`) records most of the
schema under different version numbers than the files here, because earlier
releases applied them by other means. `npx supabase migration list --linked`
therefore shows many already-applied files as pending; `db push` refuses, and
"repairing" those versions as reverted to make it proceed would re-run
already-applied migrations against the live database and fail partway through
(`20260905175135_network_revision.sql`, for one, creates its table and
triggers without `IF NOT EXISTS`), leaving the history half-repaired.

Apply only the new files, one at a time and in timestamp order, from a machine
whose Supabase CLI is linked to the production project:

```sh
npx --no-install supabase db query --linked -f supabase/migrations/<file>.sql
```

Before each one, check that the code live at that moment tolerates the change
(the release sections above say so for each file). Afterwards, verify with
read-only queries (`npx --no-install supabase db query --linked "<select ...>"`,
such as the checks listed with each release), and then the project owner
records the applied versions in the history table:

```sh
npx supabase migration repair --status applied <version> [<version> ...]
```

The SQL Editor in the Supabase dashboard is an alternative for a single file.
`supabase db push` is only for a fresh preview project whose history matches
these files from the start (see README.md).

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

Amounts appear only when checkout can actually run. `GET /api/billing/config`
returns `checkout: true` only when `PILOT_MODE=false` (exactly that value;
unset, empty, `0` or `off` all keep the pilot on) **and** the four Stripe
variables below are configured. Otherwise it returns `checkout: false`
and `Soon` in every price slot, with no period or badge, even when the
`SUBSCRIPTION_*` labels are set, and the landing page hides its Supporter button.
So setting the labels alone never publishes a price. Switching to
`PAYMENTS_MODE=live` is what makes a price mandatory: the deployment then refuses
to boot until both `*_LABEL` variables are set, so a paid tier can never go live
nameless:

```text
SUBSCRIPTION_PRICE_MONTHLY_LABEL=US$10
SUBSCRIPTION_MONTHLY_PERIOD=/ month
SUBSCRIPTION_PRICE_ANNUAL_LABEL=US$100
SUBSCRIPTION_ANNUAL_PERIOD=/ year
```

Do not set `NODE_ENV` as a project variable: the Vercel runtime sets it for the
functions, and a project value also reaches the build, where `npm ci` would then
skip the devDependencies the build runs (ESLint and the tests). `vercel.json`
installs with `npm ci --include=dev` so a stray value cannot break the build.

The server refuses to boot on Vercel Production (`VERCEL_ENV=production`) unless
`TRUST_PROXY=true` and `PUBLIC_BASE_URL` (or `NEXT_PUBLIC_APP_URL`) is an
explicit `https` origin without credentials; `VERCEL_URL` does not count there.
Anywhere, `TRUST_PROXY` must be `true`, `false` or unset: any other spelling
would key every per-client limit on the platform's own address.

Optional limits (defaults shown; each is per server instance):

```text
AUTH_RATE_LIMIT=10               # wrong passwords per account and client address per 5 min
AUTH_ACCOUNT_RATE_LIMIT=50       # wrong passwords per account from all addresses per 5 min
AUTH_IP_RATE_LIMIT=800           # sign-ups and sign-ins per address per 5 min (invitation acceptances get their own)
SIGNUP_EMAIL_HOURLY_LIMIT=200    # anonymous sign-ups (each can send a confirmation email) per hour
SESSION_REFRESH_FAILURE_LIMIT=30 # session refreshes Supabase rejects, per client address per 5 min
NETWORK_GEOCODE_BUDGET_MS=2000   # time one globe poll may wait on the city geocoder
```

Only wrong passwords count against the sign-in limits; a successful sign-in
clears that requester's count. Sign-ups stop at `SIGNUP_EMAIL_HOURLY_LIMIT` an
hour with 429 "Confirmation email is temporarily unavailable", which keeps the
rest of Supabase's 300 emails an hour for password recovery and course
invitations. A class signing up together therefore gets 200 sign-ups an hour
per instance, not the whole 800-request classroom budget. Password-recovery
emails are limited to 3 per address and requester and 10 per address from
everyone per 15 minutes; over that the request answers 429 `recovery_rate`
("Too many attempts") instead of a silent "sent".

Set the Supabase URL and publishable key for both Production and Preview when preview deployments need working authentication. Scope the server credential only to trusted preview branches. Set `PUBLIC_BASE_URL` or `NEXT_PUBLIC_APP_URL` explicitly for each environment: password recovery and invitations require that configured origin and do not fall back to `VERCEL_URL`. Add each intended callback URL to Supabase's redirect allowlist.

Optional, for festival check-in (see "FIIU check-in on the day" below):

```text
FIIU_CHECKIN_SECRET=<server-only, at least 32 random characters>
```

Without it the check-in secret is derived from the Supabase server key, which
is fine; set it only if you want to rotate check-in codes independently. A value
shorter than 32 characters stops the deployment from booting. Never set
`FIIU_CHECKIN_NOW` on Vercel: it is a local rehearsal clock, and production
refuses to boot with it.

Optional, for the FIIU registration summary email (see "FIIU registration
summary email" below). **Production scope only, never Preview**: preview
deployments that share the production database would email real people. The
code enforces this too: on any Vercel deployment whose `VERCEL_ENV` is not
`production` the email is off even when the variables are set, and
`GET /api/admin/fiiu/confirmations` reports `configured: false`.

```text
EMAIL_SMTP_URL=smtps://<user>:<password>@<host>:465
EMAIL_FROM=FIIU Fest 11 <address the provider lets you send from>
EMAIL_REPLY_TO=fiiu@ocupatucalle.com
```

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
2. Apply every pending Supabase migration (the three listed under "October 1
   release" and the one under "FIIU registration summary email" above) one file
   at a time as described in "SQL Migration Steps" (never `supabase db push`
   against production) and confirm them.
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
13. Confirm `/api/billing/config` returns `"checkout": false` and `Soon` while
    `PILOT_MODE=true`, and that the landing membership card shows "Soon!".
14. Confirm `/api/news` returns 200, and that `/fiiu-qr.html` and
    `/fiiu-admin.html` show "Organisers only" (status 403) to a member account
    and the real pages to an administrator.

## FIIU check-in on the day

Any administrator account (`app_role = 'admin'`) runs check-in; there is no
separate organiser role. Only the six NODAL blocks can be checked in: the
20 October laboratory and the five conference blocks (21 Oct morning and
evening, 22 Oct morning and evening, 23 Oct morning). Workshops and routes are
registered with their facilitators and are never checked in here.

1. On the laptop connected to the venue screen, sign in, open
   `/fiiu-admin.html#checkin` and choose "Open check-in screen" for the block.
   That opens `/fiiu-qr.html?a=<block>` in a new tab; choose "Full screen".
   The screen keeps the display awake where the browser allows it, refreshes
   every 30 seconds, and shows the QR, the address to type and a 6-character
   code, plus a live "checked in" count. The code rotates every minute and a
   code stays valid for about 5 minutes, so a photo of the screen soon stops
   working.
2. Attendees scan the QR with their phone camera. The link opens
   `/fiiu-checkin.html`; a signed-out attendee sees "Sign in to check in" for
   that session, signs in and comes back to the same link. Without a camera, they open `/fiiu-checkin.html` and type the
   6-character code.
3. A scan counts only inside the block's window, from 30 minutes before it
   starts to 30 minutes after it ends, Lima time. The laboratory has no time yet,
   so its window is the whole of 20 October in Lima. The person must have that
   block in their registration (for the laboratory, an accepted application).
   Otherwise the page says why and, while registration is open, links to the
   registration so they can add the block and scan again. A laboratory refusal
   sends the person to the registration desk instead, since the laboratory
   cannot be added from the registration.
4. Scanning twice is harmless: the first confirmation is kept, even when the
   second scan comes after the window has closed. Reloading the confirmation
   page shows the confirmation again.
5. The team can still confirm or remove attendance by hand in the participant
   detail. Each row says whether it came from the QR or the team.

Certificate hours count conference blocks only: 4 h for a morning block, 2 h for
an evening block. The laboratory counts for attendance and badges but adds 0 h
until its length is confirmed. A person's total is rounded half up to whole
hours. The participant CSV adds attended blocks, days, minutes, certificate
hours, check-in methods and a Lima check-in time for each block.

The QR encodes `PUBLIC_BASE_URL` (then `NEXT_PUBLIC_APP_URL`, then
`https://VERCEL_URL`). Production sets `PUBLIC_BASE_URL`; on a Preview
deployment without it, the QR would point at the protected per-deployment URL.

To rehearse locally, start a SQLite server with a festival time, for example
`DATA_BACKEND=sqlite FIIU_CHECKIN_NOW=2026-10-21T09:10:00-05:00 npm start`
(the 21 October morning window is open). The clock runs on from that moment, and
check-ins written under it carry the rehearsal time.

## FIIU registration summary email

What it does: after a person's first FIIU registration, NODAL emails the
account address a summary in the language of the page they registered on
(English, Spanish or Portuguese; Spanish when unknown): their conference blocks
by Lima date, time and venue, the laboratory application and its status, each
workshop and route saved as an interest with its Google Form and the reminder
that only that form confirms the place (without any, one general line that
workshops and routes are booked through their own Google Form, linked to the
NODAL programme), the shared festival Google Calendar
(`FIIU_EVENT.calendarUrl` in `server/fiiu-domain.js`), a link back to
`/fiiu.html#registration` and a note that the live programme is the reference.
It never contains the national ID, age, gender, accessibility or other private
answers. Edits and later saves send nothing.

How it behaves:

- The save waits for the email, at most 8 seconds (Vercel gives no work time
  after the response). The registration is saved first; an email problem never
  fails or undoes it. The page then says "We emailed a summary to <address>",
  "Your registration is saved. We could not send the summary email." (`failed`),
  or "Your registration is saved. The summary email may be delayed or may not
  arrive." (`uncertain`); the last two in the amber warning style.
- Each registration records `confirmation_status`: `sent`, `failed` (the
  provider refused it or could not be reached, so it cannot have the message),
  `uncertain` (the whole message went out but no final, well-formed answer came
  back), `skipped` (a reserved test or example address: `.test`, `.example`,
  `.invalid`, `.localhost`, `example.com`, `example.net`, `example.org`),
  `pending` (a send that never reported back) or `none` (no email yet:
  registered before this existed, email was off, or over the sending limit).
  Organisers see it as one line in the participant detail and in the
  `confirmationEmail` column of the CSV.
- Sending limits, counted per server instance and per hour: 3 summary emails
  per account (cancelling and registering again sends a new one) and 60 across
  all accounts, well under Google's daily quota. A registration over either
  limit is saved as usual and stays `none`, so the dashboard's "Send the
  summary" (the backfill below) can send it.
- Server logs name only the registration id, the stage and the SMTP code.

Configuration (Vercel, **Production scope only**; `PUBLIC_BASE_URL` must be set,
since the links in the email use it and never `VERCEL_URL`):

- `EMAIL_SMTP_URL`: `smtps://user:password@host:465`. Implicit TLS only, with
  the certificate verified. Percent-encode reserved characters in the user and
  password (`@` is `%40`).
  - Google Workspace or Gmail: turn on 2-Step Verification for the sending
    account, create an app password, and use
    `smtps://account%40yourdomain.org:<16-letter app password, no spaces>@smtp.gmail.com:465`.
    `EMAIL_FROM` must be that account or one of its verified "Send mail as"
    addresses. Google limits sending to about 500 messages a day for Gmail and
    2,000 for Workspace, well above FIIU's volume.
  - Resend (or another SMTP relay): `smtps://resend:<API key>@smtp.resend.com:465`,
    with `EMAIL_FROM` on a domain verified in Resend.
- `EMAIL_FROM`: `FIIU Fest 11 <address>` or a bare address.
- `EMAIL_REPLY_TO`: optional, defaults to `fiiu@ocupatucalle.com`, so replies
  reach the organisers.

Missing `EMAIL_SMTP_URL` or `EMAIL_FROM` turns the email off. A malformed value
also turns it off and logs `FIIU confirmation email is off: <reason>` once at
start-up, without the secret; registrations keep working either way. To turn the
email off, remove `EMAIL_SMTP_URL` and redeploy. A local SQLite server only ever
sends to a loopback mail catcher (`smtp://127.0.0.1:<port>`), never to a real
provider, and the test suite uses an in-memory outbox.

Sending a test:

1. Layout and provider settings, from a trusted machine, without touching any
   data (export the production values in that shell only; never save them to a
   file in the repository):

   ```sh
   EMAIL_SMTP_URL='smtps://…' EMAIL_FROM='FIIU Fest 11 <…>' PUBLIC_BASE_URL=https://your-domain.example \
   node scripts/send-fiiu-confirmations.js --test-to <an inbox you read> --language es
   ```

   It prints `sample summary (es): sent` and a sample registration arrives. Use
   a real inbox you can open: reserved example addresses (`example.org` and the
   like) are skipped, and anything else that cannot receive mail bounces
   against the sending account.
2. End to end on production after the deploy: create a fresh NODAL account with
   an address you read, register for FIIU, check the notice under "Your FIIU
   registration", the email, and the line in the organiser participant detail.
   Cancel that registration afterwards.

Backfill (optional; the owner decides): people who registered before the email
existed, while it was off, or over the hourly limit have
`confirmation_status = 'none'` and receive nothing automatically. Send it to
them from the organiser dashboard, since the email credentials live only in
Vercel:

1. Open `/fiiu-admin.html#settings` as an administrator. Under "Registration
   and links", **Summary emails** says, for example, "46 registrations have not
   received the summary email · 31 sent · 2 failed". If it says the email is
   off, set the variables above and redeploy first.
2. Press **Send the summary to 46 people**, then **Confirm: send 46 emails**.
   The page sends a small batch per request (at most 4 emails at once, each
   capped at 8 seconds, so every request ends well inside the function time
   limit) and shows "Sent 12 of 46…" until it ends with "Sent 44 · Failed 2".
   **Stop** finishes the batch in flight and sends nothing more; pressing the
   button again later continues with whoever is still waiting.
3. **Retry failed (N)** sends again to the `failed` rows only (the provider
   refused or never received those messages). `uncertain` rows are never
   retried.

Every row is claimed with a compare-and-set (`none` or `failed` to `pending`)
before its email goes out, so a double click, two organisers at once, or the
dashboard and the script together never email anyone twice. Each person gets
the summary in the language stored with the registration, else Spanish;
reserved test addresses end as `skipped`. A daily safety cap stops the button
once **150 summary emails** have gone out in the current UTC day (counted from
`confirmation_sent_at` in the database, sign-up emails included, so every server
instance agrees); the page then says sending can continue after 19:00 Lima time.
Every send that may have reached Gmail counts: `confirmation_sent_at` is stamped
when a send starts and kept for `sent` and `uncertain` (only `failed` and
`skipped` clear it), so a slow mail server cannot push the button past the cap.
Sign-ups are never held back by it. The requests spend the organiser write
budget (30 a minute); when it runs out the page pauses half a minute and carries
on. API: `GET /api/admin/fiiu/confirmations` answers
`{configured, counts, dailyCap, sentToday, resetsAt}`, and
`POST /api/admin/fiiu/confirmations` with `{retryFailed?, after?}` sends one
batch and answers `{sent, failed, uncertain, skipped, claimedElsewhere,
remaining, next, counts, ...}`, 503 `email_not_configured` without a sender, or
429 `daily_cap`. Administrators only, same-origin.

The same sending is also available from a trusted machine that has the
production Supabase and email variables in the shell:
`node scripts/send-fiiu-confirmations.js` lists who is waiting (masked
addresses, writes nothing); add `--send` to email them one at a time with the
same compare-and-set (`server/fiiu-confirmations.js` is shared by both);
`--retry-failed` also retries `failed` rows, and `--limit N` (or `--limit=N`)
caps a run, so `--send --limit 1` is a safe first canary. The command stops
before sending anything if it does not understand an argument: an unknown flag,
a missing value, a `--limit` that is not a positive whole number, or
`--test-to` together with `--send`. The script applies the same daily cap as
the dashboard, counting today's sends again before every email (the dashboard's
included), and stops with `"capped": true`, the cap, today's count and
`resetsAt` once it is reached; rerun it after that time for the rest.
`--send --ignore-cap` overrides the cap on purpose (Gmail's daily quota also
carries sign-up and password mail); `--ignore-cap` without `--send` is refused.

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
  after committed profile, consent and graph changes. While the revision stands,
  a server instance keeps its directory and graph (rereading them at most every
  10 minutes as a backstop), so a poll that ends in 304 reads the revision, not
  the five network tables.
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
  membership page. A saved choice takes precedence over `?lang=en|es|pt`;
  the URL language is used when the visitor has not saved a preference.
- Subscription **amounts** are shown exactly as configured in
  `SUBSCRIPTION_PRICE_*_LABEL`, in every language, and only while checkout can
  run; otherwise every language shows its own "Soon!". The wording around the amount
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
