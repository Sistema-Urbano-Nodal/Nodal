-- Read-only check that supabase/migrations/20261114000000_visit_counts.sql is applied in production.
-- One query, because `supabase db query` prints only the last statement's result. Run from the repository root:
--   npx --no-install supabase db query --linked -f docs/ops/2026-11-14-visit-counts-check.sql
-- Expected one row: table_exists true · functions 2 · rls_on true · policies 0 · browser_grants 0 · rows_total a count (0 until the first visit).
-- If the table is missing the query fails with "relation public.visit_counts does not exist" instead of printing a row.
select
 (select count(*) from public.visit_counts) as rows_total,
 to_regclass('public.visit_counts') is not null as table_exists,
 (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('count_visit', 'visit_totals')) as functions,
 (select relrowsecurity from pg_class where oid = 'public.visit_counts'::regclass) as rls_on,
 (select count(*) from pg_policies where schemaname = 'public' and tablename = 'visit_counts') as policies,
 (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'visit_counts' and grantee in ('anon', 'authenticated')) as browser_grants;
