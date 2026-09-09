-- Disposable database only; requires the complete course migrations. Rolls back.
BEGIN;
DO $$
DECLARE
 person uuid:=gen_random_uuid(); other_person uuid:=gen_random_uuid();
 course uuid:=gen_random_uuid(); other_course uuid:=gen_random_uuid();
 module uuid:=gen_random_uuid(); other_module uuid:=gen_random_uuid();
 owner uuid; attachment_id uuid; item jsonb;
 stamp text:='2026-09-09T00:00:00.000Z';
 rpc text:='public.reserve_course_attachment(jsonb)';
BEGIN
 IF has_function_privilege('anon',rpc,'EXECUTE') OR has_function_privilege('authenticated',rpc,'EXECUTE') THEN RAISE EXCEPTION 'Quota RPC exposed'; END IF;
 IF NOT has_function_privilege('service_role',rpc,'EXECUTE') THEN RAISE EXCEPTION 'Quota RPC server grant missing'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid=rpc::regprocedure) THEN RAISE EXCEPTION 'Quota RPC unexpectedly privileged'; END IF;
 IF has_schema_privilege('anon','nodal_private','USAGE') OR has_schema_privilege('authenticated','nodal_private','USAGE') THEN RAISE EXCEPTION 'Quota lock schema exposed'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='nodal_private.course_upload_locks'::regclass) THEN RAISE EXCEPTION 'Quota lock table missing RLS'; END IF;
 INSERT INTO auth.users(id,email) VALUES(person,'quota-check@example.test'),(other_person,'other-quota-check@example.test');
 INSERT INTO public.profiles(id,email) VALUES(person,'quota-check@example.test'),(other_person,'other-quota-check@example.test');
 INSERT INTO public.pilot_courses(id,title,status,created_at,updated_at) VALUES(course,'Quota check','published',stamp,stamp),(other_course,'Other quota check','published',stamp,stamp);
 INSERT INTO public.course_modules(id,course_id,title,position,status,created_at,updated_at) VALUES(module,course,'Session',1,'published',stamp,stamp),(other_module,other_course,'Session',1,'published',stamp,stamp);
 SET LOCAL ROLE service_role;
 FOREACH owner IN ARRAY ARRAY[person,NULL::uuid] LOOP
  item:=jsonb_build_object('course_id',course,'module_id',module,'user_id',owner,'purpose',CASE WHEN owner IS NULL THEN 'material' ELSE 'post' END,'name','quota.txt','mime','text/plain','size',3145728,'storage_path','test/quota','status','ready','created_at',stamp);
  FOR i IN 1..10 LOOP
   attachment_id:=gen_random_uuid();
   PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',attachment_id));
   IF (SELECT status FROM public.course_attachments WHERE id=attachment_id)<>'pending' THEN RAISE EXCEPTION 'Reservation skipped pending state'; END IF;
  END LOOP;
  BEGIN
   PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',gen_random_uuid(),'size',1));
   RAISE EXCEPTION 'Byte allowance exceeded';
  EXCEPTION WHEN SQLSTATE 'PCA01' THEN NULL;
  END;
  IF (SELECT sum(size) FROM public.course_attachments WHERE course_id=course AND user_id IS NOT DISTINCT FROM owner)<>31457280 THEN RAISE EXCEPTION 'Unexpected reserved bytes'; END IF;
  -- The same owner may use another course; another owner has a separate quota.
  PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',gen_random_uuid(),'course_id',other_course,'module_id',other_module));
  DELETE FROM public.course_attachments WHERE course_id=course AND user_id IS NOT DISTINCT FROM owner;
  FOR i IN 1..100 LOOP
   PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',gen_random_uuid(),'size',1));
  END LOOP;
  BEGIN
   PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',gen_random_uuid(),'size',1));
   RAISE EXCEPTION 'File-count allowance exceeded';
  EXCEPTION WHEN SQLSTATE 'PCA01' THEN NULL;
  END;
 END LOOP;
 PERFORM public.reserve_course_attachment(item||jsonb_build_object('id',gen_random_uuid(),'user_id',other_person,'purpose','post'));
 RESET ROLE;
END;
$$;
ROLLBACK;
