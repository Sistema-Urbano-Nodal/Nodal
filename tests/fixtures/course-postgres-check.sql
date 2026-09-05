-- Run only against the disposable migration-validation database. Rolls back fixtures.
BEGIN;
DO $$
DECLARE
 person uuid := gen_random_uuid(); course uuid := gen_random_uuid();
 module uuid := gen_random_uuid(); attachment uuid := gen_random_uuid(); post uuid := gen_random_uuid();
 t text;
BEGIN
 FOR t IN SELECT unnest(ARRAY['pilot_courses','course_modules','course_enrollments','course_intakes','course_posts','course_attachments','pilot_feedback','course_events']) LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS missing %',t; END IF;
  IF has_table_privilege('anon','public.'||t,'SELECT') OR has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'Private table exposed %',t; END IF;
  IF NOT has_table_privilege('service_role','public.'||t,'INSERT') THEN RAISE EXCEPTION 'Server grant missing %',t; END IF;
 END LOOP;
 IF (SELECT public FROM storage.buckets WHERE id='course-attachments') THEN RAISE EXCEPTION 'Public attachment bucket'; END IF;
 INSERT INTO auth.users(id,email) VALUES(person,'pg-check@example.test');
 INSERT INTO public.profiles(id,full_name,email) VALUES(person,'PG check','pg-check@example.test');
 INSERT INTO public.pilot_courses(id,title,status,created_at,updated_at) VALUES(course,'Test course','published','2026-09-05T00:00:00Z','2026-09-05T00:00:00Z');
 INSERT INTO public.course_modules(id,course_id,title,position,status,created_at,updated_at) VALUES(module,course,'Test module',1,'published','2026-09-05T00:00:00Z','2026-09-05T00:00:00Z');
 INSERT INTO public.course_attachments(id,course_id,module_id,user_id,name,mime,size,storage_path,status,created_at)
 VALUES(attachment,course,module,person,'pending.txt','text/plain',5,'test/pending','pending','2026-09-05T00:00:00Z');
 BEGIN
  DELETE FROM public.profiles WHERE id=person;
  RAISE EXCEPTION 'Pending attachment allowed account deletion';
 EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
 END;
 DELETE FROM public.course_attachments WHERE id=attachment;
 INSERT INTO public.course_posts(id,course_id,module_id,user_id,author_name,client_id,kind,body,created_at)
 VALUES(post,course,module,person,'Private author',gen_random_uuid(),'question','Late private content','2026-09-05T00:00:00Z');
 DELETE FROM public.profiles WHERE id=person;
 IF EXISTS(SELECT 1 FROM public.course_posts WHERE id=post AND (body<>'' OR author_name<>'' OR user_id IS NOT NULL OR deleted_at IS NULL)) THEN
  RAISE EXCEPTION 'Account deletion retained course content';
 END IF;
END $$;
ROLLBACK;
