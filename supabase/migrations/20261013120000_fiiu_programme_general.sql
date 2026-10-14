-- FIIU programme edits, one-off festival notices and rating questions (spec:
-- docs/superpowers/specs/2026-10-13-fiiu-programme-general-design.md). Server-only like every FIIU table: RLS on, no
-- client policies, browser roles hold nothing. Additive; apply BEFORE deploying the code that selects these tables
-- and columns, with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261013120000_fiiu_programme_general.sql`,
-- then `supabase migration repair --status applied 20261013120000`. Never `db push` (history differs).
BEGIN;

-- Organisers' edits to a built-in programme block: one row per edited block (id is the block id), holding the full
-- set of edited fields. No row: the block shows its built-in values.
CREATE TABLE public.fiiu_programme (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9-]{1,60}$'),event_id text NOT NULL CHECK(event_id='fiiu-2026'),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),version integer NOT NULL CHECK(version>0),
 updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL
);
CREATE INDEX fiiu_programme_editor ON public.fiiu_programme(updated_by);

-- One-off festival notices (the closing-party announcement): one row per person and notice, claimed ('pending')
-- before its email goes out, so nobody gets the same notice twice. sent_at is stamped at the claim and counts toward
-- the organisers' daily email cap with the summary emails.
CREATE TABLE public.fiiu_notices (
 id uuid PRIMARY KEY,event_id text NOT NULL CHECK(event_id='fiiu-2026'),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('closing-party')),
 status text NOT NULL CHECK(status IN ('pending','sent','failed','uncertain','skipped')),
 language text CHECK(language IN ('en','es','pt')),sent_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 UNIQUE(event_id,user_id,kind)
);
CREATE INDEX fiiu_notices_user ON public.fiiu_notices(user_id);
CREATE INDEX fiiu_notices_sent ON public.fiiu_notices(event_id,sent_at);

-- Rating questions: a question is a conversation ('chat') or a 1–10 rating. The ten totals live on the question,
-- kept by the trigger below, so the existing revision sync carries them; scores are per person (changeable) and
-- never leave the server except as these totals and the person's own score.
ALTER TABLE public.fiiu_questions
 ADD COLUMN kind text NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat','rating')),
 ADD COLUMN rating_counts integer[];
ALTER TABLE public.fiiu_questions ADD CONSTRAINT fiiu_questions_rating_counts CHECK(
 (kind='chat' AND rating_counts IS NULL) OR (kind='rating' AND rating_counts IS NOT NULL AND cardinality(rating_counts)=10));
CREATE TABLE public.fiiu_ratings (
 question_id uuid NOT NULL REFERENCES public.fiiu_questions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 score smallint NOT NULL CHECK(score BETWEEN 1 AND 10),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(question_id,user_id)
);
CREATE INDEX fiiu_ratings_user ON public.fiiu_ratings(user_id);

-- A question's type is set when it is created.
CREATE FUNCTION public.fiiu_question_kind_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'question type cannot change' USING ERRCODE='PFR04'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_question_kind_lock() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_question_kind_lock BEFORE UPDATE OF kind ON public.fiiu_questions FOR EACH ROW EXECUTE FUNCTION public.fiiu_question_kind_lock();

-- Every score written, changed or removed (an account deletion cascades) moves the question's totals and revision,
-- so /api/fiiu/pulse and ?since= pick the change up. SECURITY DEFINER: GoTrue's account deletion reaches it through
-- the foreign-key cascade as supabase_auth_admin (see 20261003201144). Arrays are 1-based, so a score is its index.
CREATE FUNCTION public.fiiu_rating_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.score=OLD.score THEN RETURN NEW; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  UPDATE public.fiiu_questions SET rating_counts[OLD.score]=greatest(0,rating_counts[OLD.score]-1),revision=revision+1
   WHERE id=OLD.question_id AND kind='rating';
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  UPDATE public.fiiu_questions SET rating_counts[NEW.score]=rating_counts[NEW.score]+1,revision=revision+1
   WHERE id=NEW.question_id AND kind='rating';
 END IF;
 RETURN coalesce(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.fiiu_rating_count() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fiiu_rating_count AFTER INSERT OR UPDATE OR DELETE ON public.fiiu_ratings FOR EACH ROW EXECUTE FUNCTION public.fiiu_rating_count();

-- One person's score on an open rating question, written or changed in one transaction that answers the new totals
-- and revision. The question row is locked first, the order every message write takes. Refusals carry codes the API
-- translates: PFR01 no such question, PFR02 not a rating question, PFR03 not open.
CREATE FUNCTION public.set_fiiu_rating(p_question_id uuid,p_user_id uuid,p_score smallint,p_at timestamptz)
RETURNS TABLE(counts integer[],rev bigint) LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE q_kind text; q_status text;
BEGIN
 SELECT kind,status INTO q_kind,q_status FROM public.fiiu_questions WHERE id=p_question_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'question unavailable' USING ERRCODE='PFR01'; END IF;
 IF q_kind<>'rating' THEN RAISE EXCEPTION 'not a rating question' USING ERRCODE='PFR02'; END IF;
 IF q_status<>'open' THEN RAISE EXCEPTION 'question closed' USING ERRCODE='PFR03'; END IF;
 INSERT INTO public.fiiu_ratings AS r(question_id,user_id,score,created_at,updated_at) VALUES(p_question_id,p_user_id,p_score,p_at,p_at)
  ON CONFLICT(question_id,user_id) DO UPDATE SET score=EXCLUDED.score,updated_at=EXCLUDED.updated_at WHERE r.score IS DISTINCT FROM EXCLUDED.score;
 RETURN QUERY SELECT fq.rating_counts,fq.revision FROM public.fiiu_questions fq WHERE fq.id=p_question_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_fiiu_rating(uuid,uuid,smallint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_fiiu_rating(uuid,uuid,smallint,timestamptz) TO service_role;

ALTER TABLE public.fiiu_programme ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiiu_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiiu_programme,public.fiiu_notices,public.fiiu_ratings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.fiiu_programme,public.fiiu_notices,public.fiiu_ratings TO service_role;
COMMIT;
