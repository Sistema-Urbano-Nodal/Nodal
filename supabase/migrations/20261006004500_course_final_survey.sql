BEGIN;
-- Final survey and certificates for Curso Movilidad Nivel 2 (pilot course 72e3cc56-a506-4a1b-97b5-9333e8d283ca),
-- read and written only by server/course-final-survey.js through NODAL's own API.
-- Additive: two new server-only tables. No existing table, row, function, policy or bucket changes, and the code live
-- before this release never reads them, so applying this first is safe. It MUST be applied before the code deploys:
-- the new server reads these tables for every course data export and account erasure, not only for this course.
-- Production migration history differs from these file versions. Apply by hand with
--   npx --no-install supabase db query --linked -f supabase/migrations/20261006004500_course_final_survey.sql
-- then the project owner records it with supabase migration repair --status applied 20261006004500.
-- Never supabase db push. A second run fails on the existing tables and rolls back, changing nothing.
-- Timestamps are ISO-8601 UTC text written by the server, like the other course tables (cursors need the Z form).

-- One row per participant. The server inserts it when the person continues past the first screen, holding only the
-- first answer, which is locked from then on. submitted_at marks a complete response, which enables the certificate.
CREATE TABLE public.course_survey_responses (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='object'),
 submitted_at text,
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(course_id,user_id)
);
CREATE INDEX course_survey_responses_page ON public.course_survey_responses(course_id,created_at,id);
-- The member's data export and account erasure look rows up by person.
CREATE INDEX course_survey_responses_user ON public.course_survey_responses(user_id);

-- One PDF per upload, written by NODAL administrators to the private course-attachments bucket under
-- certificates/<course>/<user>/<id>.pdf (the bucket already allows application/pdf up to 3 MB). A replacement is a
-- new row and a new object, and the previous row goes 'deleting' first, so at most one row per person is 'ready'.
-- Both foreign keys RESTRICT, like course_attachments: a row always tracks a private file, so neither the account
-- nor the course can disappear while one exists. server/courses-privacy.js removes the object and the row before
-- the account.
CREATE TABLE public.course_certificates (
 id uuid PRIMARY KEY,
 course_id uuid NOT NULL REFERENCES public.pilot_courses(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 size integer NOT NULL CHECK(size BETWEEN 1 AND 3145728),
 storage_path text NOT NULL UNIQUE CHECK(storage_path LIKE 'certificates/%'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','deleting')),
 created_at text NOT NULL
);
CREATE UNIQUE INDEX course_certificates_one_ready ON public.course_certificates(course_id,user_id) WHERE status='ready';
CREATE INDEX course_certificates_page ON public.course_certificates(course_id,created_at,id);
CREATE INDEX course_certificates_user ON public.course_certificates(user_id);

-- No browser role reads or writes these tables. PostgREST still applies object privileges to service-role calls,
-- so the server gets exactly the four operations it uses.
ALTER TABLE public.course_survey_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.course_survey_responses FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.course_survey_responses FROM service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.course_survey_responses TO service_role;
ALTER TABLE public.course_certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.course_certificates FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.course_certificates FROM service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.course_certificates TO service_role;
COMMIT;
