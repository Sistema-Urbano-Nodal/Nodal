-- First-party visit counter (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R1. Visit counter").
-- visit_counts holds one row per Lima day, kind ('view' for every page view, 'arrival' for the first page of a visit),
-- page key (a file name) and, for an arrival, one of eleven sources: a daily total, never a visitor, a cookie, an address
-- or a referrer. count_visit(p_hit) adds one view and, for an arrival, one arrival in a single upsert; visit_totals(p_range)
-- returns every day of the table plus the pages and sources of the range {from, to}. Server-only: RLS on with no policy,
-- and the browser roles hold nothing on the table or either function. Additive, so applying it first is safe.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261114000000_visit_counts.sql`,
-- then `npx --no-install supabase migration repair --status applied 20261114000000`. Never `db push` (history differs).
-- Until it is applied, POST /api/visit answers 204 and counts nothing, and every day lost stays lost.
BEGIN;

CREATE TABLE public.visit_counts (
 day date NOT NULL,
 kind text NOT NULL CHECK (kind IN ('view','arrival')),
 page text NOT NULL CHECK (char_length(page) BETWEEN 1 AND 80),
 source text NOT NULL CHECK (char_length(source) <= 20), -- '' for a view
 n bigint NOT NULL CHECK (n > 0),
 PRIMARY KEY (day, kind, page, source)
);
ALTER TABLE public.visit_counts ENABLE ROW LEVEL SECURITY; -- no policy: only the service role reads or writes
REVOKE ALL ON TABLE public.visit_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.visit_counts TO service_role;

-- p_hit = {day, page, arrival, source}; the alias because the search path is empty.
CREATE FUNCTION public.count_visit(p_hit jsonb) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
INSERT INTO public.visit_counts AS c (day, kind, page, source, n)
SELECT (p_hit->>'day')::date, v.kind, p_hit->>'page', v.source, 1
FROM (VALUES ('view', ''), ('arrival', COALESCE(p_hit->>'source', ''))) AS v(kind, source)
WHERE v.kind = 'view' OR p_hit->'arrival' = 'true'::jsonb
ON CONFLICT (day, kind, page, source) DO UPDATE SET n = c.n + 1
$$;
REVOKE ALL ON FUNCTION public.count_visit(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_visit(jsonb) TO service_role;

-- p_range = {from, to}; days covers the whole table, pages and sources the inclusive range.
CREATE FUNCTION public.visit_totals(p_range jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
SELECT pg_catalog.jsonb_build_object(
 'v', 1,
 'days', COALESCE((
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.day, d.views, d.arrivals) ORDER BY d.day)
  FROM (
   SELECT c.day,
    COALESCE(pg_catalog.sum(c.n) FILTER (WHERE c.kind = 'view'), 0)::bigint AS views,
    COALESCE(pg_catalog.sum(c.n) FILTER (WHERE c.kind = 'arrival'), 0)::bigint AS arrivals
   FROM public.visit_counts c GROUP BY c.day
  ) d
 ), '[]'::jsonb),
 'pages', COALESCE((
  SELECT pg_catalog.jsonb_object_agg(p.page, p.n)
  FROM (
   SELECT c.page, pg_catalog.sum(c.n)::bigint AS n FROM public.visit_counts c
   WHERE c.kind = 'view' AND c.day BETWEEN (p_range->>'from')::date AND (p_range->>'to')::date GROUP BY c.page
  ) p
 ), '{}'::jsonb),
 'sources', COALESCE((
  SELECT pg_catalog.jsonb_object_agg(s.source, s.n)
  FROM (
   SELECT c.source, pg_catalog.sum(c.n)::bigint AS n FROM public.visit_counts c
   WHERE c.kind = 'arrival' AND c.day BETWEEN (p_range->>'from')::date AND (p_range->>'to')::date GROUP BY c.source
  ) s
 ), '{}'::jsonb)
)
$$;
REVOKE ALL ON FUNCTION public.visit_totals(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visit_totals(jsonb) TO service_role;

COMMIT;
