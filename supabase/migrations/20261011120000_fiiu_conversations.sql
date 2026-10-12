-- FIIU block conversations: organiser questions on festival blocks, participant chat messages with likes, and the
-- images and PDFs attached to them. Server-only like every FIIU table: RLS on, no client policies, browser roles
-- hold nothing. Additive; apply BEFORE deploying the code that selects these tables, with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261011120000_fiiu_conversations.sql`,
-- then `supabase migration repair --status applied 20261011120000`. Never `db push` (history differs).
BEGIN;
CREATE TABLE public.fiiu_questions (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),activity_id text NOT NULL CHECK(activity_id ~ '^[a-z0-9-]{1,60}$'),
 talk text CHECK(talk IS NULL OR char_length(talk) BETWEEN 1 AND 180),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500),
 status text NOT NULL CHECK(status IN ('open','closed','hidden')),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 message_count integer NOT NULL DEFAULT 0 CHECK(message_count>=0),created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 version integer NOT NULL CHECK(version>0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL
);
CREATE INDEX fiiu_questions_activity ON public.fiiu_questions(event_id,activity_id,created_at);
CREATE INDEX fiiu_questions_creator ON public.fiiu_questions(created_by);
CREATE TABLE public.fiiu_messages (
 id uuid PRIMARY KEY,question_id uuid NOT NULL REFERENCES public.fiiu_questions(id) ON DELETE RESTRICT,
 user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,author_name text NOT NULL CHECK(char_length(author_name)<=120),
 author_full text NOT NULL CHECK(char_length(author_full)<=240),organiser boolean NOT NULL DEFAULT false,
 body text NOT NULL CHECK(char_length(body)<=1000),client_id uuid NOT NULL,like_count integer NOT NULL DEFAULT 0 CHECK(like_count>=0),
 seq bigint NOT NULL DEFAULT 0,hidden_at timestamptz,hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 deleted_at timestamptz,created_at timestamptz NOT NULL,UNIQUE(user_id,client_id)
);
CREATE INDEX fiiu_messages_changes ON public.fiiu_messages(question_id,seq);
CREATE INDEX fiiu_messages_page ON public.fiiu_messages(question_id,created_at,id);
CREATE INDEX fiiu_messages_hider ON public.fiiu_messages(hidden_by);
CREATE TABLE public.fiiu_message_likes (
 message_id uuid NOT NULL REFERENCES public.fiiu_messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,created_at timestamptz NOT NULL,PRIMARY KEY(message_id,user_id)
);
CREATE INDEX fiiu_message_likes_user ON public.fiiu_message_likes(user_id);
CREATE TABLE public.fiiu_files (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 message_id uuid REFERENCES public.fiiu_messages(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 3145728),width integer CHECK(width BETWEEN 1 AND 20000),height integer CHECK(height BETWEEN 1 AND 20000),
 thumb_size integer CHECK(thumb_size BETWEEN 1 AND 102400),storage_path text NOT NULL UNIQUE CHECK(storage_path LIKE 'fiiu/%'),
 status text NOT NULL CHECK(status IN ('pending','ready','deleting')),created_at timestamptz NOT NULL
);
CREATE INDEX fiiu_files_user ON public.fiiu_files(user_id);
CREATE INDEX fiiu_files_message ON public.fiiu_files(message_id);

-- Every message write moves its question's revision (what /api/fiiu/pulse publishes) and stamps the message with it
-- (seq), so a browser fetches only rows changed since its revision. SECURITY DEFINER: GoTrue's account deletion
-- reaches these through foreign-key actions as supabase_auth_admin (see 20261003201144).
CREATE FUNCTION public.fiiu_message_sequence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_visible integer:=0; after_visible integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.body IS NOT DISTINCT FROM OLD.body AND NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
   AND NEW.like_count=OLD.like_count AND NEW.author_name IS NOT DISTINCT FROM OLD.author_name AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  before_visible:=CASE WHEN OLD.hidden_at IS NULL AND OLD.deleted_at IS NULL THEN 1 ELSE 0 END;
 END IF;
 after_visible:=CASE WHEN NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL THEN 1 ELSE 0 END;
 UPDATE public.fiiu_questions SET revision=revision+1,message_count=message_count+after_visible-before_visible WHERE id=NEW.question_id RETURNING revision INTO NEW.seq;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_message_sequence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_message_sequence BEFORE INSERT OR UPDATE ON public.fiiu_messages FOR EACH ROW EXECUTE FUNCTION public.fiiu_message_sequence();

CREATE FUNCTION public.fiiu_like_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN UPDATE public.fiiu_messages SET like_count=like_count+1 WHERE id=NEW.message_id; RETURN NEW; END IF;
 UPDATE public.fiiu_messages SET like_count=greatest(0,like_count-1) WHERE id=OLD.message_id; RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_like_count() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_like_count AFTER INSERT OR DELETE ON public.fiiu_message_likes FOR EACH ROW EXECUTE FUNCTION public.fiiu_like_count();

CREATE FUNCTION public.fiiu_question_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.body IS DISTINCT FROM OLD.body OR NEW.talk IS DISTINCT FROM OLD.talk OR NEW.status IS DISTINCT FROM OLD.status THEN NEW.revision:=OLD.revision+1; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_question_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_question_revision BEFORE UPDATE ON public.fiiu_questions FOR EACH ROW EXECUTE FUNCTION public.fiiu_question_revision();

-- Attaching files is a second write after the message insert (or a retry finishing an interrupted send), so it
-- restamps the message too: a browser that synced the message before its files fetches it again with them. The
-- message row is locked before the question, the order every message write takes, so an attach and a like cannot
-- deadlock; the seq it writes is not a watched column, so fiiu_message_sequence lets it through unchanged.
CREATE FUNCTION public.fiiu_file_attached() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent uuid; stamp bigint;
BEGIN
 IF NEW.message_id IS NULL OR NEW.message_id IS NOT DISTINCT FROM OLD.message_id THEN RETURN NEW; END IF;
 SELECT question_id INTO parent FROM public.fiiu_messages WHERE id=NEW.message_id FOR NO KEY UPDATE;
 UPDATE public.fiiu_questions SET revision=revision+1 WHERE id=parent RETURNING revision INTO stamp;
 UPDATE public.fiiu_messages SET seq=stamp WHERE id=NEW.message_id;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_file_attached() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_file_attached AFTER UPDATE OF message_id ON public.fiiu_files FOR EACH ROW EXECUTE FUNCTION public.fiiu_file_attached();

-- Account erasure: the text and name go, a placeholder keeps the conversation's shape. Files are removed by the
-- application first (fiiu_files.user_id is RESTRICT), likes cascade.
CREATE FUNCTION public.erase_fiiu_messages_on_account_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.fiiu_messages SET body='',author_name='',author_full='',deleted_at=coalesce(deleted_at,now()) WHERE user_id=OLD.id;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_fiiu_messages_on_account_delete() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_messages_account_erasure BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.erase_fiiu_messages_on_account_delete();

-- Upload allowance per person for the festival: 30 files, 30 MB, pending uploads included. Serialized per person.
CREATE SCHEMA IF NOT EXISTS nodal_private;
REVOKE ALL ON SCHEMA nodal_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA nodal_private TO service_role;
CREATE TABLE nodal_private.fiiu_upload_locks (user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 1);
ALTER TABLE nodal_private.fiiu_upload_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nodal_private.fiiu_upload_locks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE nodal_private.fiiu_upload_locks TO service_role;
CREATE FUNCTION nodal_private.guard_fiiu_upload_quota() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE file_count bigint; byte_count bigint;
BEGIN
 INSERT INTO nodal_private.fiiu_upload_locks AS locks(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO UPDATE SET revision=locks.revision+1;
 SELECT count(*),coalesce(sum(size),0) INTO file_count,byte_count FROM public.fiiu_files WHERE user_id=NEW.user_id AND event_id=NEW.event_id;
 IF file_count>=30 OR byte_count+NEW.size>31457280 THEN RAISE EXCEPTION 'festival upload allowance reached' USING ERRCODE='PFU01'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.guard_fiiu_upload_quota() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_upload_quota BEFORE INSERT ON public.fiiu_files FOR EACH ROW EXECUTE FUNCTION nodal_private.guard_fiiu_upload_quota();
CREATE FUNCTION public.reserve_fiiu_file(p_file jsonb) RETURNS SETOF public.fiiu_files LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.fiiu_files(id,event_id,user_id,message_id,name,mime,size,width,height,thumb_size,storage_path,status,created_at)
 SELECT id,event_id,user_id,NULL,name,mime,size,width,height,thumb_size,storage_path,'pending',created_at
 FROM jsonb_populate_record(NULL::public.fiiu_files,p_file) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.reserve_fiiu_file(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fiiu_file(jsonb) TO service_role;

-- Organiser totals per question: distinct authors and likes over visible messages (message_count is on the question).
CREATE FUNCTION public.fiiu_question_stats(p_event_id text) RETURNS TABLE(question_id uuid,people bigint,likes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT m.question_id,count(DISTINCT m.user_id),coalesce(sum(m.like_count),0)
 FROM public.fiiu_messages m JOIN public.fiiu_questions q ON q.id=m.question_id
 WHERE q.event_id=p_event_id AND m.hidden_at IS NULL AND m.deleted_at IS NULL GROUP BY m.question_id;
$$;
REVOKE ALL ON FUNCTION public.fiiu_question_stats(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiiu_question_stats(text) TO service_role;

ALTER TABLE public.fiiu_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiiu_questions,public.fiiu_messages,public.fiiu_message_likes,public.fiiu_files FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.fiiu_questions,public.fiiu_messages,public.fiiu_message_likes,public.fiiu_files TO service_role;
COMMIT;
