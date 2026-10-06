-- Disposable database only; requires 20261006004500_course_final_survey.sql applied over Supabase-like default
-- privileges (every new table granted to anon, authenticated and service_role). Rolls back.
BEGIN;
DO $$
DECLARE
 person uuid:=gen_random_uuid(); other_person uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 first_certificate uuid:=gen_random_uuid(); stamp text:='2026-10-10T15:00:00.000Z';
 t text; p text;
BEGIN
 FOR t IN SELECT unnest(ARRAY['course_survey_responses','course_certificates']) LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS missing %',t; END IF;
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('anon','public.'||t,p) OR has_table_privilege('authenticated','public.'||t,p) THEN RAISE EXCEPTION 'Private table % exposed: %',t,p; END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   IF NOT has_table_privilege('service_role','public.'||t,p) THEN RAISE EXCEPTION 'Server grant missing on %: %',t,p; END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('service_role','public.'||t,p) THEN RAISE EXCEPTION 'Server holds more than it uses on %: %',t,p; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO auth.users(id,email) VALUES(person,'survey-check@example.test'),(other_person,'other-survey-check@example.test');
 INSERT INTO public.profiles(id,email) VALUES(person,'survey-check@example.test'),(other_person,'other-survey-check@example.test');
 INSERT INTO public.pilot_courses(id,title,status,created_at,updated_at) VALUES(course,'Survey check','published',stamp,stamp);
 SET LOCAL ROLE service_role;
 INSERT INTO public.course_survey_responses(id,course_id,user_id,answers,submitted_at,created_at,updated_at)
 VALUES(gen_random_uuid(),course,person,'{"overall":"buena"}',NULL,stamp,stamp);
 BEGIN
  INSERT INTO public.course_survey_responses(id,course_id,user_id,answers,created_at,updated_at) VALUES(gen_random_uuid(),course,person,'{"overall":"regular"}',stamp,stamp);
  RAISE EXCEPTION 'Second response for one person allowed';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.course_survey_responses(id,course_id,user_id,answers,created_at,updated_at) VALUES(gen_random_uuid(),course,other_person,'[]',stamp,stamp);
  RAISE EXCEPTION 'Non-object answers allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at)
 VALUES(first_certificate,course,person,10,'certificates/'||course||'/'||person||'/'||first_certificate||'.pdf','ready',stamp);
 BEGIN
  INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES(gen_random_uuid(),course,person,10,'certificates/'||course||'/'||person||'/second.pdf','ready',stamp);
  RAISE EXCEPTION 'Second ready certificate for one person allowed';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 -- Replacements in flight ('pending') and leftovers ('deleting') may coexist with the ready one.
 INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES
  (gen_random_uuid(),course,person,10,'certificates/'||course||'/'||person||'/pending.pdf','pending',stamp),
  (gen_random_uuid(),course,person,10,'certificates/'||course||'/'||person||'/deleting.pdf','deleting',stamp);
 BEGIN
  INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES(gen_random_uuid(),course,person,10,'certificates/'||course||'/'||person||'/x.pdf','x',stamp);
  RAISE EXCEPTION 'Unknown certificate status allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES(gen_random_uuid(),course,person,0,'certificates/'||course||'/'||person||'/empty.pdf','pending',stamp);
  RAISE EXCEPTION 'Empty certificate allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES(gen_random_uuid(),course,person,10,person||'/post-file','pending',stamp);
  RAISE EXCEPTION 'Certificate outside certificates/ allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 RESET ROLE;
 -- A tracked file blocks deleting the account and the course; the response goes with the account.
 BEGIN
  DELETE FROM public.profiles WHERE id=person;
  RAISE EXCEPTION 'Certificate allowed account deletion';
 EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
 END;
 BEGIN
  DELETE FROM public.pilot_courses WHERE id=course;
  RAISE EXCEPTION 'Certificate allowed course deletion';
 EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
 END;
 DELETE FROM public.course_certificates WHERE user_id=person;
 DELETE FROM public.profiles WHERE id=person;
 IF EXISTS(SELECT 1 FROM public.course_survey_responses WHERE user_id=person) THEN RAISE EXCEPTION 'Account deletion retained the survey response'; END IF;
END $$;
ROLLBACK;
