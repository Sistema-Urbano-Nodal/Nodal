# Second demo-readiness pass — 7 September 2026

Baseline: `fbd6a681f1b4b899428be63c388c60c22588671e`, confirmed on remote main and the canonical production alias.

## Reproduced issues and fixes

- Production `GET /api/catalog?lang=en&limit=1` returned 400 three times. Vercel compiled the named catch-all rewrite to `/api/index.js?path=$1`; the catalog correctly rejected this unintended query parameter. The unnamed `/(.*)` catch-all compiles to `/api/index.js`, retaining the same endpoint coverage. Verified with the official `@vercel/routing-utils` 6.5.0 compiler before and after the change. The same fix removes injected routing metadata from new login return URLs.
- Teacher create/save forms could send duplicate requests while saving. A logical pending guard and disabled controls now protect course/session saves and prevent overlapping file uploads.
- A truncated successful API response could incorrectly display a feedback save confirmation. It now produces a localized connection error and preserves the draft.
- Background activity authentication failures could navigate away from an unsent contribution. Activity calls now report the error without forcing navigation, and stale session events cannot overwrite the current session's message.
- A failed refresh after saving an intake could leave the existing discussion controls inactive. Conversation disposal now waits for the replacement course response.
- CSV exports read unrelated report tables and counts, so a feedback query failure could break a participant export. Each export now reads only its required data. Staff reports share identity lookups and fetch invitations in parallel. Official material validation checks the bounded set of up to twelve attachments concurrently before any publication write.

## Verification before deployment

- Full `npm run build`: **467 tests passed**, zero failed, skipped or cancelled; static build succeeded.
- Production dependency audit: zero vulnerabilities. `git diff --check` clean.
- New regression tests reproduced frontend and backend failures before fixes. Existing permission, publication, privacy and complete-CSV pagination tests passed.
- Deterministic backend tests reduced one-page export reads (after access checks): participants/intake 13 to 3; feedback 13 to 2; activity 15 to 2. These are query counts, not a measured production latency improvement.
- Disposable local browser journey: student login, open enrollment, all eight intake fields saved, course access, assignment persisted after reload, and feedback save. Portuguese labels were checked. No browser errors in the isolated preview. Test records stayed in a temporary in-memory database.
- Live authenticated course and teaching workspace loaded before the patch. Extension-origin console messages in Edge were distinguished from application errors.
- Live serial baseline: public/protected HTML first-byte samples approximately 133–230 ms. Static assets returned 200 with compression and caching. This is not a sustained load test or a complete page-render benchmark.

## Remaining demo preparation

At the live database check around 22:11 UTC, the course was published with open enrollment and four published sessions plus general discussion, but no learning resources had been added. The teaching team still needs to publish its materials. A real email invitation acceptance remains untested pending an authorized test recipient; no email was sent in this pass. This pass does not establish capacity for 200 simultaneous production users.

## Routing reference

[Vercel configuration documentation](https://vercel.com/docs/project-configuration/vercel-json#route-parameters) describes named rewrite parameters being passed through to the destination query string.
