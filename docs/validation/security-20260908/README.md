# Security remediation validation — 8 September 2026

This records the changes and their validation after the standard source review
of `817d7a5`. The canonical Codex Security scan is
`92faa50f-dae8-483b-a915-c22d003341d5`; its original report is not replaced by this
release note. The review covered 86 source files and recorded three findings
(two medium, one low). It was a bounded review, not an exhaustive security guarantee.

## Changes

- Follow and interaction endpoints spend their request budget before database
  work. They look up the target member directly and require an active account
  with directory consent, avoiding full-network reads for each write.
- Recommendations have a separate request budget. Existing authoritative
  database revisions continue to invalidate cached results after privacy changes.
- Supabase retains the newest 50 interactions per directed member pair. A new
  follow and its single event commit together; duplicate follows add no event.
- Upload reservations serialize the 100-file/30-MiB allowance per course and
  owner, including pending files. A database trigger also protects the previous
  application's direct INSERT path during rollout. Personal quota bookkeeping
  is deleted with the account; course-owned materials have a separate allowance.
- The map reconciles visible names against the latest member IDs, clears removed
  selections, discards stale topic responses and erases private map state on 401.
- City search has bounded cache/queue sizes, request deduplication and an upstream
  timeout. Valid zero coordinates are preserved. Non-object JSON is rejected with
  400 instead of causing route errors.
- Invitation foreign keys have covering indexes. Deployment instructions now
  describe the actual location permissions, private tables and cache behavior.

## Reproducible verification

`npm run build` runs the complete Node suite and generates static assets. The
standard suite skips the two PostgreSQL tests unless explicit local disposable
database URLs are provided. On a busy development machine, the same suite can run
with `node --test --test-concurrency=2 tests/*.test.js`, followed by
`node scripts/build-static.js` after success. CI and Vercel run the full default
suite independently; their revision and result are checked during release.

Both PostgreSQL integrations were run successfully on disposable PostgreSQL 15:

- `tests/supabase-interactions.test.js`: use
  `NODAL_INTERACTION_TEST_DATABASE_URL` pointing to an empty local database named
  `nodal_interaction_test_<suffix>`. Covers exact backfill retention, concurrent
  batches, opposite pair ordering, duplicate follows, rollback on event failure,
  browser privileges and a stale REPEATABLE READ snapshot followed by a fresh retry.
- `tests/courses-upload-quota-postgres.test.js`: use
  `NODAL_COURSE_QUOTA_TEST_DATABASE_URL` pointing to an empty local UTF-8 database
  named `nodal_course_quota_test_<suffix>`. Covers eight combinations of
  READ COMMITTED/REPEATABLE READ, RPC/legacy INSERT and personal/material quota.
  Exactly one competing reservation commits; the other is rejected with
  `PCA01` or rolled back with `40001`. Also checks file counts, bytes, grants,
  pending status and account-deletion cleanup.

The test runners reject remote hosts and connection-query overrides. They install
their own fixtures; never point them at a database containing real data.

Targeted HTTP and client-script regressions passed for privacy, throttling,
malformed JSON, geocoder failures, map updates and separate SQLite connections
racing for the last upload allowance. `npm audit --audit-level=low` reported zero
known dependency vulnerabilities.

## Production database verification

The retention, upload-quota and invitation-index migrations were applied before
the new server rollout. Read-only checks confirmed:

- All public application tables have RLS enabled. Browser roles cannot directly
  read profiles, course responses, feedback or the private upload-lock table.
- The attachments bucket remains private. The quota RPC is SECURITY INVOKER and
  executable by the service role, not anonymous or authenticated browser roles.
- Both retention/follow triggers and the quota trigger are enabled. The service
  role was not granted DELETE on interaction history.
- No existing upload quota was exceeded; the eight existing interaction events
  were within the retention bound. No current interaction data was removed.
- The performance advisor no longer reports unindexed foreign keys. Newly
  created or infrequently used indexes may still appear as informational
  "unused index" notices; those notices alone do not justify removing them.

Apply migrations before the server on other deployments too. Rolling back the
application remains operational, but the old follow writer temporarily records
duplicate, bounded events until upgraded again.

## Limits and operational follow-up

- The production organization is on Supabase Free. Its advisor reports leaked
  password protection disabled; that feature is available on Pro and above.
  See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- RLS-without-policy informational notices refer to tables intentionally
  accessible only through authorized server code. Do not add browser grants or
  permissive policies merely to clear those notices.
- Request budgets remain per warm function instance. Redis cache configuration
  does not turn them into global rate limits. A shared limiter or deployment
  firewall is needed for a global abuse budget.
- The global graph read cap is unchanged. Arbitrary multi-statement database
  transactions can still encounter deadlocks and must be retried; current
  repository REST writes use one row per transaction.
- A 300-user local load run encountered transport timeouts under severe host
  contention. A separate Node server returning only HTTP 204, with no NODAL or
  SQLite code, also had 94 transport timeouts out of 300 requests. The diagnostic
  script now records safe error codes without URLs,
  cookies or error messages. These local runs do not establish production
  capacity, and a successful functional suite is not a concurrency guarantee.
- The review did not validate inbox delivery, external backup/log retention,
  production load or every possible attack. Protected scan-output access could
  not be verified because that connector was disconnected during preflight.

The scan tool reported 15,460,139 total tokens, including 14,748,928 cached input
tokens, 43,877 output tokens and 9,227 reasoning tokens across four task threads.
These are tool-reported scan accounting figures, not NODAL API usage or a cost
estimate.
