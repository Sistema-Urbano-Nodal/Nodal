-- Course pilot: all access through authenticated NODAL server routes.

CREATE TABLE IF NOT EXISTS public.pilot_courses (
 id UUID PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 starts_on TEXT NOT NULL DEFAULT '', ends_on TEXT NOT NULL DEFAULT '', enrollment_open BOOLEAN NOT NULL DEFAULT true,
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public.course_modules (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', objectives TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
 session_date TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
 resources JSONB NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public.course_enrollments (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.course_intakes (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, answers JSONB NOT NULL, updated_at TEXT NOT NULL, UNIQUE(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.course_attachments (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE RESTRICT, user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 3145728), storage_path TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.course_posts (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE, user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
 author_name TEXT NOT NULL, staff BOOLEAN NOT NULL DEFAULT false, client_id UUID NOT NULL, parent_id UUID REFERENCES public.course_posts(id),
 kind TEXT NOT NULL CHECK(kind IN ('assignment','question','comment')), body TEXT NOT NULL, links JSONB NOT NULL DEFAULT '[]',
 attachment_ids JSONB NOT NULL DEFAULT '[]', deleted_at TEXT, created_at TEXT NOT NULL, UNIQUE(user_id,client_id)
);
CREATE TABLE IF NOT EXISTS public.pilot_feedback (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN ('profile','matching','content','recording','assignment','discussion','course')),
 course_id UUID REFERENCES public.pilot_courses(id) ON DELETE CASCADE, module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public.course_events (
 id UUID PRIMARY KEY, course_id UUID NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('module_open','content_open','recording_open')), resource_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_courses_page ON pilot_courses(status,created_at,id);
CREATE INDEX IF NOT EXISTS course_modules_course ON course_modules(course_id,position,id);
CREATE INDEX IF NOT EXISTS course_enrollments_user ON course_enrollments(user_id,course_id);
CREATE INDEX IF NOT EXISTS course_enrollments_page ON course_enrollments(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_intakes_user ON course_intakes(user_id,course_id);
CREATE INDEX IF NOT EXISTS course_posts_page ON course_posts(module_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_posts_course ON course_posts(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_posts_parent ON course_posts(parent_id);
CREATE INDEX IF NOT EXISTS course_posts_user ON course_posts(user_id);
CREATE INDEX IF NOT EXISTS course_attachments_user ON course_attachments(user_id);
CREATE INDEX IF NOT EXISTS course_attachments_module ON course_attachments(module_id);
CREATE INDEX IF NOT EXISTS pilot_feedback_course ON pilot_feedback(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS pilot_feedback_user ON pilot_feedback(user_id);
CREATE INDEX IF NOT EXISTS pilot_feedback_module ON pilot_feedback(module_id);
CREATE INDEX IF NOT EXISTS course_events_course ON course_events(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_events_user ON course_events(user_id);
CREATE INDEX IF NOT EXISTS course_events_module ON course_events(module_id);

ALTER TABLE public.pilot_courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_courses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_courses TO service_role;

ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_modules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_modules TO service_role;

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_enrollments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_enrollments TO service_role;

ALTER TABLE public.course_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_intakes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_intakes TO service_role;

ALTER TABLE public.course_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_posts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_posts TO service_role;

ALTER TABLE public.course_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_attachments TO service_role;

ALTER TABLE public.pilot_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_feedback FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_feedback TO service_role;

ALTER TABLE public.course_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_events TO service_role;

-- Scrub even a post committed after the application cleanup and before the
-- account deletion acquires its row lock. Pending files restrict deletion.
CREATE OR REPLACE FUNCTION public.erase_course_posts_on_account_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.course_posts SET body='',links='[]'::jsonb,attachment_ids='[]'::jsonb,
 author_name='',staff=false,deleted_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE user_id=OLD.id;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_course_posts_on_account_delete() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_posts_account_erasure BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.erase_course_posts_on_account_delete();

-- Files remain private; the server validates course membership before delivery.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('course-attachments','course-attachments',false,3145728,ARRAY['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=3145728,allowed_mime_types=EXCLUDED.allowed_mime_types;
