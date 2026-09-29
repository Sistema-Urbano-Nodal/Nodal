BEGIN;

-- Aggregate inside PostgreSQL so organizer summaries never fetch participant
-- answers or depend on the first page of the registration directory. The
-- authenticated server supplies its catalog, including historical activity IDs.
CREATE FUNCTION public.fiiu_event_summary(p_event_id text, p_activities jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH catalog AS (
 SELECT DISTINCT ON (item->>'id')
  item->>'id' AS id, item->>'date' AS date,
  item->>'registration' AS registration, ordinal
 FROM pg_catalog.jsonb_array_elements(
  CASE WHEN pg_catalog.jsonb_typeof(p_activities)='array' THEN p_activities ELSE '[]'::jsonb END
 ) WITH ORDINALITY AS activity(item, ordinal)
 WHERE pg_catalog.jsonb_typeof(item)='object'
  AND COALESCE(item->>'id','')<>'' AND COALESCE(item->>'date','')<>''
  AND item->>'registration' IN ('general','application','external')
 ORDER BY item->>'id', ordinal
), registrations AS (
 SELECT r.id, r.answers, r.lab_status
 FROM public.fiiu_registrations r
 WHERE r.event_id=p_event_id
), selections AS (
 SELECT r.id AS registration_id, c.id AS activity_id, c.date, c.registration
 FROM registrations r
 JOIN catalog c ON (
  (c.registration='general' AND
   CASE WHEN pg_catalog.jsonb_typeof(r.answers->'activities')='array'
    THEN r.answers->'activities' ELSE '[]'::jsonb END ? c.id)
  OR (c.registration='application' AND c.id='day0-lab' AND r.answers->'applyLab'='true'::jsonb)
  OR (c.registration='external' AND
   CASE WHEN pg_catalog.jsonb_typeof(r.answers->'externalActivities')='array'
    THEN r.answers->'externalActivities' ELSE '[]'::jsonb END ? c.id)
 )
), participation AS (
 SELECT a.registration_id, c.id AS activity_id, c.date
 FROM public.fiiu_attendance a
 JOIN registrations r ON r.id=a.registration_id
 JOIN catalog c ON c.id=a.activity_id
), selection_counts AS (
 SELECT s.activity_id,
  pg_catalog.count(*) FILTER (WHERE s.registration<>'external') AS registrations,
  pg_catalog.count(*) FILTER (WHERE s.registration='external') AS external_interests
 FROM selections s GROUP BY s.activity_id
), attendance_counts AS (
 SELECT p.activity_id, pg_catalog.count(DISTINCT p.registration_id) AS attendance
 FROM participation p GROUP BY p.activity_id
), day_selections AS (
 SELECT s.date, pg_catalog.count(DISTINCT s.registration_id) AS registrations
 FROM selections s GROUP BY s.date
), day_attendance AS (
 SELECT p.date, pg_catalog.count(DISTINCT p.registration_id) AS attendance
 FROM participation p GROUP BY p.date
), profile_counts AS (
 SELECT CASE WHEN pg_catalog.jsonb_typeof(r.answers->'profile')='string'
  THEN r.answers->>'profile' ELSE '' END AS profile, pg_catalog.count(*) AS count
 FROM registrations r GROUP BY 1
)
SELECT pg_catalog.jsonb_build_object(
 'totalRegistrations', (SELECT pg_catalog.count(*) FROM registrations),
 'publicOfficials', (SELECT pg_catalog.count(*) FROM registrations r WHERE r.answers->'publicOfficial'='true'::jsonb),
 'lab', (SELECT pg_catalog.jsonb_build_object(
  'pending', pg_catalog.count(*) FILTER (WHERE r.lab_status='pending'),
  'accepted', pg_catalog.count(*) FILTER (WHERE r.lab_status='accepted'),
  'declined', pg_catalog.count(*) FILTER (WHERE r.lab_status='declined')
 ) FROM registrations r),
 'activities', COALESCE((
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'activityId', c.id, 'registrations', COALESCE(s.registrations,0),
   'externalInterests', COALESCE(s.external_interests,0), 'attendance', COALESCE(a.attendance,0)
  ) ORDER BY c.ordinal)
  FROM catalog c
  LEFT JOIN selection_counts s ON s.activity_id=c.id
  LEFT JOIN attendance_counts a ON a.activity_id=c.id
 ), '[]'::jsonb),
 'days', COALESCE((
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'date', d.date, 'registrations', COALESCE(s.registrations,0), 'attendance', COALESCE(a.attendance,0)
  ) ORDER BY d.date)
  FROM (SELECT DISTINCT c.date FROM catalog c) d
  LEFT JOIN day_selections s ON s.date=d.date
  LEFT JOIN day_attendance a ON a.date=d.date
 ), '[]'::jsonb),
 'profiles', COALESCE((
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('profile', p.profile, 'count', p.count) ORDER BY p.profile)
  FROM profile_counts p
 ), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.fiiu_event_summary(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiiu_event_summary(text,jsonb) TO service_role;

COMMIT;
