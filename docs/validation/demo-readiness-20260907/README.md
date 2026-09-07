# NODAL demo verification — September 7, 2026

## Verified fixes

- Sign-in preserves the selected course, module and view query parameters.
- Course/HTML authorization reads a fresh profile without fetching unrelated onboarding/preferences. Existing-account authorization uses two provider requests instead of four; full-profile endpoints retain full data and role/suspension changes take effect on the next request.
- Existing-account login avoids two redundant profile initialization writes. Sign-in, recovery and invitation completion do not first validate a stale browser session.
- Independent course access reads run together. Short logical pages stop promptly; staff report and member lookups avoid empty follow-up reads, with complete CSV pagination preserved.
- Course directory no longer fetches a second full user profile just to display the staff link.
- Re-selecting the current session preserves the draft. Intake, feedback and contribution forms prevent overlapping submissions. Requests have bounded timeouts; temporary Auth outages preserve session cookies.
- Signup/login retain 10 attempts per normalized email/action per five minutes. A separate shared-IP budget permits 800 combined attempts per five minutes, allowing a 300-person cohort to sign up and sign in with retry headroom. Limits remain per app instance; Supabase also applies its own quotas.
- Vercel function region changed from observed `iad1` to `pdx1`, near the live Supabase database in `us-west-2`. Public homepage appearance was preserved.

## Verification

- `npm run build`: 460 tests passed, zero failed or skipped; static build succeeded.
- Local 200-user course test: 1,000 HTTP requests, zero errors, all 200 enrollments/intakes/assignments/feedback records persisted. This uses disposable SQLite and pre-created sessions, not a production capacity test. Details in `course-load.json`.
- The load harness previously selected the general-discussion module and incorrectly attempted assignments there. It now selects a published session. Original failure and diagnosis are preserved in `course-load-harness-failure.json`.
- Local browser walkthrough with a disposable student: preserved course destination through login, open enrollment, all eight intake fields saved, session access, assignment submission after re-selecting the current session, and feedback confirmation. Reload retained the assignment.
- Local HTTP acceptance: an ordinary student received 403 for admin exports; an admin exported CSV containing the browser-saved intake, feedback and participant.
- Pre-release production logs: no runtime error clusters or 5xx observed in the preceding 24 hours. This is a historical sample, not monitoring or a guarantee.
- `production-before.json` records serial public/invalid-session timing probes only. It is not an authenticated page-load benchmark.

## Live configuration adjustments

Saved and reloaded Supabase settings verified email quota 300/hour (previously 30), sign-up/sign-in 600 requests/five minutes per IP (previously 30), verification 600/five minutes (previously 30), and refresh 600/five minutes (previously 150). Email confirmation, 60-second per-user email cooldown, Gmail SMTP and other quotas were preserved. No email was sent as part of these configuration checks.

## Remaining demo preparation and limits

The live course is published with enrollment open. The four published sessions have titles and dates, but no descriptions, objectives, assignment instructions, resources or uploaded teaching files. Staff need to publish the actual materials for the demo.

Actual inbox delivery, password recovery and invitation acceptance through a real emailed link have not been verified end to end in this pass. Have participants register and confirm before class where possible. The Gmail account has separate sending/deliverability limits; increasing the Supabase quota does not increase Gmail's allowance. Supabase also documents a 30-request burst capacity despite higher sustained quotas, and Auth IP forwarding remains disabled. Do not claim that 200–300 simultaneous production signups have been proven.

References: [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region), [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Gmail sending limits](https://support.google.com/mail/answer/22839).
