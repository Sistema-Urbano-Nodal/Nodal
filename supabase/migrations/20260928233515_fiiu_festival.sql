BEGIN;
CREATE TABLE public.fiiu_registrations (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 email text NOT NULL,answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='object'),
 lab_status text NOT NULL CHECK(lab_status IN ('none','pending','accepted','declined')),
 version integer NOT NULL CHECK(version>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 UNIQUE(event_id,user_id)
);
CREATE INDEX fiiu_registration_user ON public.fiiu_registrations(user_id);
CREATE INDEX fiiu_registration_page ON public.fiiu_registrations(event_id,id);
CREATE TABLE public.fiiu_attendance (
 id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES public.fiiu_registrations(id) ON DELETE CASCADE,
 activity_id text NOT NULL,confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL,UNIQUE(registration_id,activity_id)
);
CREATE INDEX fiiu_attendance_confirmer ON public.fiiu_attendance(confirmed_by);
CREATE TABLE public.fiiu_config (
 id text PRIMARY KEY CHECK(id='fiiu-2026'),data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),version integer NOT NULL CHECK(version>0)
);
CREATE TABLE public.fiiu_content (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 status text NOT NULL CHECK(status IN ('draft','published','archived')),version integer NOT NULL CHECK(version>0),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL
);
CREATE INDEX fiiu_content_page ON public.fiiu_content(event_id,status,id);
CREATE INDEX fiiu_content_recent ON public.fiiu_content(event_id,created_at DESC,id DESC);
-- All access goes through NODAL's authenticated API. No public directory access
-- to government identifiers, accessibility answers, applications or attendance.
ALTER TABLE public.fiiu_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiiu_registrations,public.fiiu_attendance,public.fiiu_config,public.fiiu_content FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.fiiu_registrations,public.fiiu_attendance,public.fiiu_config,public.fiiu_content TO service_role;
COMMIT;
