-- Read-only check that supabase/migrations/20261114010000_metrics.sql is applied in production, and the raw counts the
-- admin home must agree with on the same Lima day. One query, because `supabase db query` prints only the last
-- statement's result. Run from the repository root:
--   npx --no-install supabase db query --linked -f docs/ops/2026-11-14-metrics-check.sql
-- Expected one row, after `supabase migration repair --status applied 20261114010000`:
--   account_days_definer true · member_days_invoker true · functions_closed 0 · readings_browser_grants 0 ·
--   readings_server "SELECT, INSERT" · account_days_owner postgres · owner_reads_auth_users true ·
--   service_role_cannot_read "none" · readings_rls true · migration_row 1 ·
--   and the known values of 14 November 2026 (they only grow, except what a deleted account takes with it):
--   accounts 525 · confirmed 494 · profiles 486 · admins 5 · with_city 210 · with_bio 17 · assessed 33 ·
--   onboarding_rows 210 · registrations 375 · checkins 90 · checkin_people 62 · enrolments 21 · admin_enrolments 3 ·
--   surveys_submitted 9 · certificates_ready 17 · follows 14 · acceptances 1 · badges 0.
-- owner_reads_auth_users false means metrics_account_days cannot read the accounts: the home's Registros block shows
-- "Aún no está activado en la base de datos" until the function belongs to a role that can (postgres).
-- service_role_cannot_read names every table metrics_member_days reads that the server role cannot: the function runs
-- as the caller, so each one named there fails the whole members part.
-- If the migration is missing the query fails with "function public.metrics_account_days() does not exist" instead.
select
 (select prosecdef from pg_proc where oid = 'public.metrics_account_days()'::regprocedure) as account_days_definer,
 (select not prosecdef from pg_proc where oid = 'public.metrics_member_days(date)'::regprocedure) as member_days_invoker,
 (select count(*) from unnest(array['public.metrics_account_days()', 'public.metrics_member_days(date)']) as f(fn)
   cross join unnest(array['anon', 'authenticated']) as r(role)
   where has_function_privilege(r.role, f.fn, 'EXECUTE')) as functions_closed,
 (select count(*) from unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
   where has_table_privilege(r.role, 'public.metrics_readings', p.priv)) as readings_browser_grants,
 (select string_agg(p.priv, ', ' order by p.n) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) with ordinality as p(priv, n)
   where has_table_privilege('service_role', 'public.metrics_readings', p.priv)) as readings_server,
 (select proowner::regrole::text from pg_proc where oid = 'public.metrics_account_days()'::regprocedure) as account_days_owner,
 (select has_table_privilege(proowner,'auth.users','SELECT') from pg_proc where oid = 'public.metrics_account_days()'::regprocedure) as owner_reads_auth_users,
 (select coalesce(string_agg(t.name, ', ' order by t.name), 'none')
   from unnest(array['profiles', 'profile_preferences', 'onboarding_responses', 'pilot_feedback', 'member_follows',
     'member_interactions', 'catalog_interests', 'fiiu_registrations', 'fiiu_attendance', 'fiiu_messages',
     'fiiu_message_likes', 'fiiu_ratings', 'course_enrollments', 'course_events', 'course_posts',
     'course_survey_responses', 'membership_acceptances', 'node_requests']) as t(name)
   where not has_table_privilege('service_role', 'public.' || t.name, 'SELECT')) as service_role_cannot_read,
 (select relrowsecurity from pg_class where oid = 'public.metrics_readings'::regclass) as readings_rls,
 (select count(*) from supabase_migrations.schema_migrations where version = '20261114010000') as migration_row,
 (select count(*) from auth.users) as accounts,
 (select count(*) from auth.users where email_confirmed_at is not null) as confirmed,
 (select count(*) from public.profiles) as profiles,
 (select count(*) from public.profiles where app_role = 'admin') as admins,
 (select count(*) from public.profiles where btrim(coalesce(city_region, '')) <> '') as with_city,
 (select count(*) from public.profiles p left join public.onboarding_responses o on o.user_id = p.id
   where btrim(coalesce(nullif(btrim(coalesce(p.bio, '')), ''), o.raw_answers->'partC'->>'bio', '')) <> '') as with_bio,
 (select count(*) from public.onboarding_responses where raw_answers->'assessed' = 'true'::jsonb) as assessed,
 (select count(*) from public.onboarding_responses) as onboarding_rows,
 (select count(*) from public.fiiu_registrations) as registrations,
 (select count(*) from public.fiiu_attendance) as checkins,
 (select count(distinct registration_id) from public.fiiu_attendance) as checkin_people,
 (select count(*) from public.course_enrollments) as enrolments,
 (select count(*) from public.course_enrollments e join public.profiles p on p.id = e.user_id where p.app_role = 'admin') as admin_enrolments,
 (select count(*) from public.course_survey_responses where submitted_at is not null) as surveys_submitted,
 (select count(*) from public.course_certificates where status = 'ready') as certificates_ready,
 (select count(*) from public.member_follows) as follows,
 (select count(*) from public.membership_acceptances) as acceptances,
 (select count(*) from public.profiles where founder_since is not null) as badges;
