-- Read-only check that supabase/migrations/20261109000000_node_request_kinds.sql is applied in production.
-- One query, because `supabase db query` prints only the last statement's result. Run from the repository root:
--   npx --no-install supabase db query --linked -f docs/ops/2026-11-09-node-request-kinds-check.sql
-- Expected one row: new_columns 3 · null_kind 0 · kind_check 1 · kind_index 1 · migration_row 1 · by_kind like "node:12".
-- If the columns are missing the query fails with "column kind does not exist" instead of printing a row.
select
 (select count(*) from information_schema.columns
   where table_schema='public' and table_name='node_requests' and column_name in ('kind','community','memberships')) as new_columns,
 (select count(*) from public.node_requests where kind is null) as null_kind,
 (select count(*) from pg_constraint
   where conrelid='public.node_requests'::regclass and conname='node_requests_kind_fields') as kind_check,
 (select count(*) from pg_indexes where tablename='node_requests' and indexname='node_requests_kind') as kind_index,
 (select count(*) from supabase_migrations.schema_migrations where version='20261109000000') as migration_row,
 (select coalesce(string_agg(kind||':'||n, ', '), 'no requests yet')
   from (select kind, count(*) as n from public.node_requests group by kind order by kind) as k) as by_kind;
