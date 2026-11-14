-- Read-only check that supabase/migrations/20261114000000_visit_counts.sql is applied in production.
-- One query, because `supabase db query` prints only the last statement's result. Run from the repository root:
--   npx --no-install supabase db query --linked -f docs/ops/2026-11-14-visit-counts-check.sql
-- Expected one row: rls_on true · browser_grants 0 · functions_invoker 2 · functions_closed 0 · migration_row 1 (after
-- `supabase migration repair --status applied 20261114000000`) · last_7_days like "2026-11-14:120/45, 2026-11-13:98/40"
-- (day:views/arrivals, newest first, Lima days) or "no visits yet". A day far above its neighbours is an inflated day:
-- correct it with docs/ops/2026-11-14-visit-counts-correct.sql.
-- If the table is missing the query fails with "relation public.visit_counts does not exist" instead of printing a row.
select
 (select relrowsecurity from pg_class where oid = 'public.visit_counts'::regclass) as rls_on,
 (select count(*) from unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
   where has_table_privilege(r.role, 'public.visit_counts', p.priv)) as browser_grants,
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('count_visit', 'visit_totals') and not p.prosecdef) as functions_invoker,
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join unnest(array['anon', 'authenticated']) as r(role)
   where n.nspname = 'public' and p.proname in ('count_visit', 'visit_totals')
   and has_function_privilege(r.role, p.oid, 'EXECUTE')) as functions_closed,
 (select count(*) from supabase_migrations.schema_migrations where version = '20261114000000') as migration_row,
 coalesce((select string_agg(d.day || ':' || d.views || '/' || d.arrivals, ', ' order by d.day desc)
   from (select day, coalesce(sum(n) filter (where kind = 'view'), 0) as views, coalesce(sum(n) filter (where kind = 'arrival'), 0) as arrivals
     from public.visit_counts where day >= (now() at time zone 'America/Lima')::date - 6 group by day) d), 'no visits yet') as last_7_days;
