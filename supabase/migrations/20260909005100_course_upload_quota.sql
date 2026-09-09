-- Serialize quota reservations by course and owner. Pending uploads count until
-- reconciliation removes them; material uploads share the null-owner quota.
CREATE SCHEMA IF NOT EXISTS nodal_private;
REVOKE ALL ON SCHEMA nodal_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nodal_private TO service_role;
CREATE TABLE nodal_private.course_upload_locks (
 course_id uuid NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
 owner_key text GENERATED ALWAYS AS (coalesce(user_id::text,'material')) STORED,
 revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(course_id,owner_key)
);
CREATE INDEX course_upload_locks_user ON nodal_private.course_upload_locks(user_id);
ALTER TABLE nodal_private.course_upload_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nodal_private.course_upload_locks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON nodal_private.course_upload_locks TO service_role;

-- The trigger also protects an older server still using direct INSERT during
-- rollout. The migration is additive and must precede the new server code.
CREATE FUNCTION nodal_private.guard_course_upload_quota()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 file_count bigint;
 byte_count bigint;
BEGIN
 -- A real row update is essential: at REPEATABLE READ a stale transaction
 -- aborts instead of acquiring an advisory lock and counting an old snapshot.
 INSERT INTO nodal_private.course_upload_locks AS locks(course_id,user_id)
 VALUES(NEW.course_id,NEW.user_id)
 ON CONFLICT(course_id,owner_key) DO UPDATE SET revision=locks.revision+1;
 -- VOLATILE gives this statement a fresh READ COMMITTED snapshot after waiting.
 SELECT count(*),coalesce(sum(size),0) INTO file_count,byte_count
 FROM public.course_attachments
 WHERE course_id=NEW.course_id AND user_id IS NOT DISTINCT FROM NEW.user_id;
 IF file_count>=100 OR byte_count+NEW.size>31457280 THEN
  RAISE EXCEPTION 'course upload allowance reached; use a link instead' USING ERRCODE='PCA01';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.guard_course_upload_quota() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_upload_quota BEFORE INSERT ON public.course_attachments
FOR EACH ROW EXECUTE FUNCTION nodal_private.guard_course_upload_quota();

CREATE FUNCTION public.reserve_course_attachment(p_attachment jsonb)
RETURNS SETOF public.course_attachments
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.course_attachments(id,course_id,module_id,user_id,purpose,name,mime,size,storage_path,status,created_at)
 SELECT id,course_id,module_id,user_id,purpose,name,mime,size,storage_path,'pending',created_at
 FROM jsonb_populate_record(NULL::public.course_attachments,p_attachment)
 RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.reserve_course_attachment(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_course_attachment(jsonb) TO service_role;
