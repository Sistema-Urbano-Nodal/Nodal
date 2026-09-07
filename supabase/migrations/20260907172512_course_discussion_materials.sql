-- General discussion shares the module/post security boundary. Course materials
-- belong to the course from upload time; no departing account owns these blobs.
ALTER TABLE public.course_modules ADD COLUMN kind text NOT NULL DEFAULT 'session' CHECK(kind IN ('session','discussion'));
ALTER TABLE public.course_modules ADD COLUMN posts_revision bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX course_one_discussion ON public.course_modules(course_id) WHERE kind='discussion';
ALTER TABLE public.course_posts ADD COLUMN thread_kind text NOT NULL DEFAULT 'discussion' CHECK(thread_kind IN ('assignment','discussion'));
WITH RECURSIVE threads(id,thread_kind) AS (
 SELECT id,CASE WHEN kind='assignment' THEN 'assignment' ELSE 'discussion' END FROM public.course_posts WHERE parent_id IS NULL
 UNION ALL SELECT p.id,t.thread_kind FROM public.course_posts p JOIN threads t ON p.parent_id=t.id
) UPDATE public.course_posts p SET thread_kind=t.thread_kind FROM threads t WHERE p.id=t.id;
CREATE INDEX course_posts_thread_page ON public.course_posts(module_id,thread_kind,created_at,id);
ALTER TABLE public.course_attachments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.course_attachments ADD COLUMN purpose text NOT NULL DEFAULT 'post'
 CHECK((purpose='post' AND user_id IS NOT NULL) OR (purpose='material' AND user_id IS NULL));
ALTER TABLE public.course_attachments DROP CONSTRAINT course_attachments_status_check;
ALTER TABLE public.course_attachments ADD CONSTRAINT course_attachments_status_check CHECK(status IN ('pending','ready','deleting'));

CREATE FUNCTION public.create_course_discussion() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.course_modules(id,course_id,kind,title,translations,status,position,created_at,updated_at)
 VALUES(gen_random_uuid(),NEW.id,'discussion','General discussion','{"es":{"title":"Conversación general"},"pt":{"title":"Conversa geral"}}','published',100,NEW.created_at,NEW.updated_at);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_course_discussion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_discussion_create AFTER INSERT ON public.pilot_courses FOR EACH ROW EXECUTE FUNCTION public.create_course_discussion();
INSERT INTO public.course_modules(id,course_id,kind,title,translations,status,position,created_at,updated_at)
SELECT gen_random_uuid(),id,'discussion','General discussion','{"es":{"title":"Conversación general"},"pt":{"title":"Conversa geral"}}','published',100,created_at,updated_at FROM public.pilot_courses;

CREATE FUNCTION public.course_posts_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE public.course_modules SET posts_revision=posts_revision+1 WHERE id=OLD.module_id;
  RETURN OLD;
 END IF;
 UPDATE public.course_modules SET posts_revision=posts_revision+1 WHERE id=NEW.module_id;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.course_posts_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_posts_revision AFTER INSERT OR UPDATE OR DELETE ON public.course_posts FOR EACH ROW EXECUTE FUNCTION public.course_posts_revision();

-- Lock referenced attachment rows while publishing, so a concurrently reclaimed
-- file cannot become an official resource after its deletion claim succeeds.
CREATE FUNCTION public.validate_course_materials() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE resource jsonb; found_id uuid;
BEGIN
 FOR resource IN SELECT value FROM jsonb_array_elements(NEW.resources) LOOP
  IF resource ? 'attachmentId' THEN
   SELECT id INTO found_id FROM public.course_attachments WHERE id=(resource->>'attachmentId')::uuid
    AND course_id=NEW.course_id AND module_id=NEW.id AND purpose='material' AND status='ready' FOR SHARE;
   IF found_id IS NULL THEN RAISE EXCEPTION 'official resource attachment unavailable' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_course_materials() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_resources_validate BEFORE INSERT OR UPDATE OF resources ON public.course_modules FOR EACH ROW EXECUTE FUNCTION public.validate_course_materials();
CREATE FUNCTION public.guard_course_material_deletion() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE material_resources jsonb;
BEGIN
 IF NEW.status='deleting' THEN
  SELECT resources INTO material_resources FROM public.course_modules WHERE id=NEW.module_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(material_resources) r WHERE r->>'attachmentId'=NEW.id::text) THEN
   RAISE EXCEPTION 'remove the material from module resources before deleting' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_course_material_deletion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER course_material_delete_guard BEFORE UPDATE OF status ON public.course_attachments FOR EACH ROW EXECUTE FUNCTION public.guard_course_material_deletion();
-- Existing service-only table grants, RLS and private bucket remain unchanged.
