-- Run only against the disposable migration-validation database. Rolls back fixtures.
BEGIN;
DO $$
DECLARE
 person uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 module uuid:=gen_random_uuid(); post uuid:=gen_random_uuid();
 rpc text:='public.edit_own_course_post(uuid,uuid,uuid,text,text)';
 stamp text:='2026-09-08T00:00:00.000Z';
 original text:=repeat('界',6000); revised text:=repeat('界',5999)||'新';
 affected integer; revision bigint;
BEGIN
 IF has_function_privilege('anon',rpc,'EXECUTE') OR has_function_privilege('authenticated',rpc,'EXECUTE') THEN RAISE EXCEPTION 'Owner edit RPC exposed to browser roles'; END IF;
 IF NOT has_function_privilege('service_role',rpc,'EXECUTE') THEN RAISE EXCEPTION 'Owner edit RPC server grant missing'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid=rpc::regprocedure) THEN RAISE EXCEPTION 'RPC unexpectedly security definer'; END IF;
 INSERT INTO auth.users(id,email) VALUES(person,'owner-edit-check@example.test');
 INSERT INTO public.profiles(id,full_name,email) VALUES(person,'Owner check','owner-edit-check@example.test');
 INSERT INTO public.pilot_courses(id,title,status,created_at,updated_at) VALUES(course,'Owner check','published',stamp,stamp);
 INSERT INTO public.course_modules(id,course_id,title,position,status,created_at,updated_at) VALUES(module,course,'Session',1,'published',stamp,stamp);
 INSERT INTO public.course_posts(id,course_id,module_id,user_id,author_name,client_id,kind,body,created_at)
 VALUES(post,course,module,person,'Original author',gen_random_uuid(),'question',original,stamp);
 SELECT posts_revision INTO revision FROM public.course_modules WHERE id=module;
 SET LOCAL ROLE service_role;
 SELECT count(*) INTO affected FROM public.edit_own_course_post(post,course,gen_random_uuid(),original,revised);
 IF affected<>0 THEN RAISE EXCEPTION 'Another owner changed post'; END IF;
 SELECT count(*) INTO affected FROM public.edit_own_course_post(post,gen_random_uuid(),person,original,revised);
 IF affected<>0 THEN RAISE EXCEPTION 'Wrong course changed post'; END IF;
 SELECT count(*) INTO affected FROM public.edit_own_course_post(post,course,person,original,revised);
 IF affected<>1 THEN RAISE EXCEPTION 'Long Unicode owner edit failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.course_posts WHERE id=post AND body=revised AND user_id=person AND kind='question' AND author_name='Original author') THEN RAISE EXCEPTION 'Edit changed protected fields'; END IF;
 IF (SELECT posts_revision FROM public.course_modules WHERE id=module)<=revision THEN RAISE EXCEPTION 'Edit did not invalidate discussion'; END IF;
 SELECT count(*) INTO affected FROM public.edit_own_course_post(post,course,person,original,'Stale');
 IF affected<>0 THEN RAISE EXCEPTION 'Stale edit overwrote newer body'; END IF;
 UPDATE public.course_posts SET body='',links='[]',attachment_ids='[]',deleted_at=stamp WHERE id=post;
 SELECT count(*) INTO affected FROM public.edit_own_course_post(post,course,person,'','Resurrection');
 IF affected<>0 OR (SELECT body FROM public.course_posts WHERE id=post)<>'' THEN RAISE EXCEPTION 'Deleted post resurrected'; END IF;
 RESET ROLE;
END $$;
ROLLBACK;
