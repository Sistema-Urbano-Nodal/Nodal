-- The admin home's indicators (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R3. The home"
-- and "Indicator catalogue"). Two functions and one table, all server-only:
-- metrics_account_days() counts accounts per Lima day (created, and of those the ones with a confirmed email). It is the
-- only function that reads the auth schema, so it runs as its owner (postgres) with an empty search path and answers
-- counts only. metrics_member_days(p_today) runs as the caller (service_role) on public tables: first entries, profile
-- saves, follows, interest requests, festival registrations, acceptances, Founder badges and organisation requests per
-- Lima day; current-state counts; distinct non-admin members with recorded activity per kind in the 7 and 30 Lima days
-- ending p_today; and the festival country answers by trimmed text. metrics_readings keeps one saved reading per Lima day
-- (first write wins: no UPDATE or DELETE grant). RLS on with no policy; the browser roles hold nothing. Additive, so
-- applying it first is safe.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261114010000_metrics.sql`,
-- then `npx --no-install supabase migration repair --status applied 20261114010000`. Never `db push` (history differs).
-- Until it is applied, the home shows "Aún no está activado en la base de datos" in the affected blocks and saves no reading.
BEGIN;

-- {"v":1,"days":[[lima_day, created, confirmed], ...]}: counts per day, nothing else. confirmed counts by the day the
-- account was created, so the sum of confirmed is "Con correo confirmado".
CREATE FUNCTION public.metrics_account_days() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT pg_catalog.jsonb_build_object(
 'v', 1,
 'days', COALESCE((
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.day, d.created, d.confirmed) ORDER BY d.day)
  FROM (
   SELECT ((u.created_at AT TIME ZONE 'UTC') - interval '5 hours')::date AS day,
    pg_catalog.count(*) AS created,
    pg_catalog.count(*) FILTER (WHERE u.email_confirmed_at IS NOT NULL) AS confirmed
   FROM auth.users u
   WHERE u.created_at IS NOT NULL
   GROUP BY 1
  ) d
 ), '[]'::jsonb)
)
$$;
REVOKE ALL ON FUNCTION public.metrics_account_days() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_account_days() TO service_role;

-- {"v":1,"days":{...},"now":{...},"active":{"d7":{...},"d30":{...}},"lists":{...}}. Every series ascending by day, one
-- row per day with a count; countries by n descending, then by text in byte order. 7 days are the Lima days
-- p_today-6 ... p_today and 30 days p_today-29 ... p_today, each from 05:00:00 UTC, both ending before p_today+1 at
-- 05:00:00 UTC. Course and feedback dates are 24-character ISO text, compared as text against the same bounds.
-- Activity (C2): user_id not null and the account's current role not admin. Left out on purpose:
-- fiiu_registrations.updated_at, attendance by staff, 'follow' interactions, catalog updates by staff,
-- profiles.updated_at, course_enrollments, certificates.
CREATE FUNCTION public.metrics_member_days(p_today date) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
WITH
bounds AS (
 SELECT
  ((p_today - 6)::timestamp + interval '5 hours') AT TIME ZONE 'UTC' AS s7,
  ((p_today - 29)::timestamp + interval '5 hours') AT TIME ZONE 'UTC' AS s30,
  ((p_today + 1)::timestamp + interval '5 hours') AT TIME ZONE 'UTC' AS e,
  pg_catalog.to_char(p_today - 6, 'YYYY-MM-DD') || 'T05:00:00.000Z' AS t7,
  pg_catalog.to_char(p_today - 29, 'YYYY-MM-DD') || 'T05:00:00.000Z' AS t30,
  pg_catalog.to_char(p_today + 1, 'YYYY-MM-DD') || 'T05:00:00.000Z' AS te
),
admins AS (SELECT p.id FROM public.profiles p WHERE p.app_role = 'admin'),
-- Sources dated with timestamptz.
stamped (user_id, kind, at) AS (
 SELECT o.user_id, 'profile', o.created_at FROM public.onboarding_responses o
 UNION ALL SELECT o.user_id, 'profile', o.updated_at FROM public.onboarding_responses o
 UNION ALL SELECT f.user_id, 'network', f.created_at FROM public.member_follows f
 UNION ALL SELECT i.from_user_id, 'network', i.created_at FROM public.member_interactions i WHERE i.type = 'skip'
 UNION ALL SELECT c.user_id, 'opportunities', c.created_at FROM public.catalog_interests c
 UNION ALL SELECT c.user_id, 'opportunities', c.updated_at FROM public.catalog_interests c WHERE c.updated_by = c.user_id
 UNION ALL SELECT r.user_id, 'festival', r.created_at FROM public.fiiu_registrations r
 UNION ALL SELECT r.user_id, 'festival', a.created_at FROM public.fiiu_attendance a
  JOIN public.fiiu_registrations r ON r.id = a.registration_id WHERE a.method = 'qr'
 UNION ALL SELECT m.user_id, 'festival', m.created_at FROM public.fiiu_messages m WHERE NOT m.organiser
 UNION ALL SELECT l.user_id, 'festival', l.created_at FROM public.fiiu_message_likes l
 UNION ALL SELECT g.user_id, 'festival', g.created_at FROM public.fiiu_ratings g
 UNION ALL SELECT g.user_id, 'festival', g.updated_at FROM public.fiiu_ratings g
 UNION ALL SELECT a.user_id, 'membership', a.accepted_at FROM public.membership_acceptances a
),
-- Sources dated with ISO text.
written (user_id, kind, at) AS (
 SELECT p.user_id, CASE p.action WHEN 'profile' THEN 'profile' WHEN 'matching' THEN 'network' ELSE 'courses' END, p.created_at
  FROM public.pilot_feedback p
 UNION ALL SELECT e.user_id, 'courses', e.created_at FROM public.course_events e
 UNION ALL SELECT c.user_id, 'courses', c.created_at FROM public.course_posts c WHERE NOT c.staff
 UNION ALL SELECT s.user_id, 'courses', s.created_at FROM public.course_survey_responses s
 UNION ALL SELECT s.user_id, 'courses', s.submitted_at FROM public.course_survey_responses s WHERE s.submitted_at IS NOT NULL
),
hits AS (
 SELECT s.user_id, s.kind, s.at >= b.s7 AS in7
  FROM stamped s, bounds b WHERE s.at >= b.s30 AND s.at < b.e
 UNION ALL
 SELECT w.user_id, w.kind, (w.at COLLATE "C") >= b.t7
  FROM written w, bounds b WHERE (w.at COLLATE "C") >= b.t30 AND (w.at COLLATE "C") < b.te
),
member_hits AS (
 SELECT h.user_id, h.kind, h.in7 FROM hits h
 WHERE h.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM admins x WHERE x.id = h.user_id)
),
-- Dated series per Lima day, every row (the team's included).
dated (series, at) AS (
 SELECT 'entered', p.created_at FROM public.profiles p
 UNION ALL SELECT 'profileSaves', o.created_at FROM public.onboarding_responses o
 UNION ALL SELECT 'follows', f.created_at FROM public.member_follows f
 UNION ALL SELECT 'interests', c.created_at FROM public.catalog_interests c WHERE c.status <> 'withdrawn'
 UNION ALL SELECT 'registrations', r.created_at FROM public.fiiu_registrations r
 UNION ALL SELECT 'acceptances', a.accepted_at FROM public.membership_acceptances a
 UNION ALL SELECT 'founders', p.founder_since FROM public.profiles p
 UNION ALL SELECT 'orgRequests', n.created_at FROM public.node_requests n
),
per_day AS (
 SELECT d.series, ((d.at AT TIME ZONE 'UTC') - interval '5 hours')::date AS day, pg_catalog.count(*) AS n
 FROM dated d WHERE d.at IS NOT NULL GROUP BY 1, 2
),
series AS (
 SELECT pd.series, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(pd.day, pd.n) ORDER BY pd.day) AS rows
 FROM per_day pd GROUP BY pd.series
),
onboarding AS (
 SELECT p.id, p.city_region, p.bio, p.account_status, o.interests, o.raw_answers, pp.data_consent
 FROM public.profiles p
 LEFT JOIN public.onboarding_responses o ON o.user_id = p.id
 LEFT JOIN public.profile_preferences pp ON pp.user_id = p.id
)
SELECT pg_catalog.jsonb_build_object(
 'v', 1,
 'days', pg_catalog.jsonb_build_object(
  'entered', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'entered'), '[]'::jsonb),
  'profileSaves', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'profileSaves'), '[]'::jsonb),
  'follows', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'follows'), '[]'::jsonb),
  'interests', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'interests'), '[]'::jsonb),
  'registrations', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'registrations'), '[]'::jsonb),
  'acceptances', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'acceptances'), '[]'::jsonb),
  'founders', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'founders'), '[]'::jsonb),
  'orgRequests', COALESCE((SELECT s.rows FROM series s WHERE s.series = 'orgRequests'), '[]'::jsonb)
 ),
 'now', pg_catalog.jsonb_build_object(
  'admins', (SELECT pg_catalog.count(*) FROM admins),
  'basic', (SELECT pg_catalog.count(*) FROM onboarding x
   WHERE pg_catalog.btrim(COALESCE(x.city_region, '')) <> '' AND COALESCE(pg_catalog.cardinality(x.interests), 0) > 0),
  'city', (SELECT pg_catalog.count(*) FROM onboarding x WHERE pg_catalog.btrim(COALESCE(x.city_region, '')) <> ''),
  'interests', (SELECT pg_catalog.count(*) FROM onboarding x WHERE COALESCE(pg_catalog.cardinality(x.interests), 0) > 0),
  'bio', (SELECT pg_catalog.count(*) FROM onboarding x
   WHERE pg_catalog.btrim(COALESCE(NULLIF(pg_catalog.btrim(COALESCE(x.bio, '')), ''), x.raw_answers->'partC'->>'bio', '')) <> ''),
  'assessed', (SELECT pg_catalog.count(*) FROM onboarding x WHERE x.raw_answers->'assessed' = 'true'::jsonb),
  'directory', (SELECT pg_catalog.count(*) FROM onboarding x
   WHERE x.account_status = 'active' AND (x.data_consent->'directoryPublic' = 'true'::jsonb
    OR (NOT COALESCE(x.data_consent ? 'directoryPublic', false) AND x.raw_answers->'partC'->'consent' = 'true'::jsonb))),
  'acceptors', (SELECT pg_catalog.count(DISTINCT a.user_id) + pg_catalog.count(*) FILTER (WHERE a.user_id IS NULL)
   FROM public.membership_acceptances a),
  'unbadged', (SELECT pg_catalog.count(DISTINCT a.user_id) FILTER (WHERE p.founder_since IS NULL AND a.user_id IS NOT NULL)
    + pg_catalog.count(*) FILTER (WHERE a.user_id IS NULL)
   FROM public.membership_acceptances a LEFT JOIN public.profiles p ON p.id = a.user_id),
  'interestsNew', (SELECT pg_catalog.count(*) FROM public.catalog_interests c WHERE c.status = 'new'),
  'orgRequestsNew', (SELECT pg_catalog.count(*) FROM public.node_requests n WHERE n.status = 'new'),
  'learners', (SELECT pg_catalog.count(DISTINCT e.user_id) FROM public.course_enrollments e
   WHERE NOT EXISTS (SELECT 1 FROM admins x WHERE x.id = e.user_id)),
  'openers', (SELECT pg_catalog.count(DISTINCT e.user_id) FROM public.course_events e
   WHERE NOT EXISTS (SELECT 1 FROM admins x WHERE x.id = e.user_id)),
  'teamRegistrations', (SELECT pg_catalog.count(*) FROM public.fiiu_registrations r
   WHERE EXISTS (SELECT 1 FROM admins x WHERE x.id = r.user_id))
 ),
 'active', pg_catalog.jsonb_build_object(
  'd7', (SELECT pg_catalog.jsonb_build_object(
   'members', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7),
   'profile', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'profile'),
   'network', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'network'),
   'opportunities', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'opportunities'),
   'festival', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'festival'),
   'courses', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'courses'),
   'membership', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.in7 AND h.kind = 'membership')
  ) FROM member_hits h),
  'd30', (SELECT pg_catalog.jsonb_build_object(
   'members', pg_catalog.count(DISTINCT h.user_id),
   'profile', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'profile'),
   'network', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'network'),
   'opportunities', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'opportunities'),
   'festival', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'festival'),
   'courses', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'courses'),
   'membership', pg_catalog.count(DISTINCT h.user_id) FILTER (WHERE h.kind = 'membership')
  ) FROM member_hits h)
 ),
 'lists', pg_catalog.jsonb_build_object(
  'countries', COALESCE((
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.text, c.n) ORDER BY c.n DESC, c.text COLLATE "C")
   FROM (
    SELECT pg_catalog.btrim(COALESCE(r.answers->>'country', '')) AS text, pg_catalog.count(*) AS n
    FROM public.fiiu_registrations r GROUP BY 1
   ) c
  ), '[]'::jsonb)
 )
)
$$;
REVOKE ALL ON FUNCTION public.metrics_member_days(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_member_days(date) TO service_role;

-- One saved reading per Lima day: the 63 figures of the catalogue under their keys, and the catalogue version (defs).
CREATE TABLE public.metrics_readings (day date PRIMARY KEY, taken_at timestamptz NOT NULL,
 defs smallint NOT NULL, figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'object'));
ALTER TABLE public.metrics_readings ENABLE ROW LEVEL SECURITY; -- no policy: only the service role reads or writes
REVOKE ALL ON public.metrics_readings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.metrics_readings TO service_role;

COMMIT;
