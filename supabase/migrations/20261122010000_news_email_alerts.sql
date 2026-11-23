BEGIN;
CREATE TABLE public.news_email_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'es' CHECK(language IN ('en','es','pt')),
  subscribed_at timestamptz NOT NULL DEFAULT now(), notice_version text NOT NULL DEFAULT 'news-v1'
);
CREATE TABLE public.news_email_events (
  event_id text PRIMARY KEY, news_id uuid UNIQUE REFERENCES public.nodal_news(id) ON DELETE CASCADE,
  catalog_id uuid UNIQUE REFERENCES public.catalog_items(id) ON DELETE CASCADE,
  CHECK((news_id IS NULL) <> (catalog_id IS NULL))
);
CREATE TABLE public.news_email_outbox (
  event_id text NOT NULL REFERENCES public.news_email_events(event_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.news_email_preferences(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','uncertain')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX news_email_dispatch ON public.news_email_outbox(status,available_at);
CREATE INDEX news_email_user ON public.news_email_outbox(user_id);
ALTER TABLE public.news_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.news_email_preferences,public.news_email_outbox,public.news_email_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON public.news_email_preferences TO service_role;
GRANT UPDATE (language,subscribed_at,notice_version) ON public.news_email_preferences TO service_role;
GRANT SELECT,INSERT ON public.news_email_events TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.news_email_outbox TO service_role;

-- A real opt-in can replace a temporary, single-test consent without overwriting
-- an existing subscriber's original opt-in date on an ordinary repeated request.
CREATE FUNCTION public.subscribe_news_email(p_user uuid,p_language text) RETURNS void
LANGUAGE sql SET search_path='' AS $$
  INSERT INTO public.news_email_preferences AS p (user_id,language) VALUES (p_user,p_language)
  ON CONFLICT(user_id) DO UPDATE SET language=EXCLUDED.language,
    subscribed_at=EXCLUDED.subscribed_at,notice_version=EXCLUDED.notice_version
  WHERE p.notice_version LIKE 'qa:%';
$$;
REVOKE ALL ON FUNCTION public.subscribe_news_email(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscribe_news_email(uuid,text) TO service_role;

CREATE FUNCTION public.queue_news_emails() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.published_at IS NULL) THEN
    INSERT INTO public.news_email_events(event_id,news_id) VALUES('n:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_news_emails() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER news_email_first_publication AFTER INSERT OR UPDATE OF status ON public.nodal_news
  FOR EACH ROW EXECUTE FUNCTION public.queue_news_emails();

CREATE FUNCTION public.queue_catalog_email() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.status='published' AND NEW.visibility='public' AND NEW.featured AND NEW.kind='opportunity' AND
    (TG_OP='INSERT' OR NOT(OLD.status='published' AND OLD.visibility='public' AND OLD.featured AND OLD.kind='opportunity')) THEN
    INSERT INTO public.news_email_events(event_id,catalog_id) VALUES('c:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_catalog_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER catalog_featured_email AFTER INSERT OR UPDATE OF kind,visibility,status,featured ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.queue_catalog_email();

CREATE FUNCTION public.queue_email_recipients() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Serialize recipient selection with a simultaneous unsubscribe. The foreign key
  -- can then cascade normally without making the editor's publication fail.
  INSERT INTO public.news_email_outbox(event_id,user_id)
    SELECT NEW.event_id,p.user_id FROM public.news_email_preferences p
    WHERE p.notice_version NOT LIKE 'qa:%' ORDER BY p.user_id FOR KEY SHARE OF p;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_email_recipients() FROM PUBLIC,anon,authenticated;
-- A privately addressed delivery test never fans out to subscribers.
CREATE TRIGGER news_email_enqueue AFTER INSERT ON public.news_email_events FOR EACH ROW
  WHEN (NEW.event_id='n:'||NEW.news_id OR NEW.event_id='c:'||NEW.catalog_id)
  EXECUTE FUNCTION public.queue_email_recipients();

-- Reading the current, verified address and locking the next delivery are one private server operation.
CREATE FUNCTION public.claim_news_email()
RETURNS TABLE(event_id text,news_id uuid,catalog_id uuid,user_id uuid,attempts integer,email text,title text,url text,language text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH candidate AS (
    SELECT o.event_id,e.news_id,e.catalog_id,o.user_id,u.email::text AS address,
      coalesce(n.title,c.translations->p.language->>'title') AS title,n.url,p.language
    FROM public.news_email_outbox o JOIN public.news_email_events e ON e.event_id=o.event_id
    LEFT JOIN public.nodal_news n ON n.id=e.news_id LEFT JOIN public.catalog_items c ON c.id=e.catalog_id
    JOIN public.news_email_preferences p ON p.user_id=o.user_id
    JOIN public.profiles profile ON profile.id=o.user_id
    JOIN auth.users u ON u.id=o.user_id
    WHERE o.status='queued' AND o.available_at<=now() AND (
      (p.notice_version NOT LIKE 'qa:%' AND e.event_id='n:'||n.id AND n.status='published') OR
      (p.notice_version NOT LIKE 'qa:%' AND e.event_id='c:'||c.id AND c.status='published' AND c.visibility='public' AND c.featured AND c.kind='opportunity') OR
      (e.event_id='test:'||o.user_id||':'||n.id AND n.status='draft'))
      AND profile.account_status='active' AND u.email_confirmed_at IS NOT NULL
      AND u.email IS NOT NULL AND u.email<>''
    ORDER BY o.available_at,o.event_id,o.user_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.news_email_outbox o SET status='sending',attempts=o.attempts+1
  FROM candidate c WHERE o.event_id=c.event_id AND o.user_id=c.user_id
  RETURNING o.event_id,c.news_id,c.catalog_id,o.user_id,o.attempts,c.address,c.title,c.url,c.language;
$$;
REVOKE ALL ON FUNCTION public.claim_news_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_news_email() TO service_role;
CREATE FUNCTION public.export_news_email(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'subscription',(SELECT jsonb_build_object('language',language,'subscribed_at',subscribed_at,'notice_version',notice_version)
      FROM public.news_email_preferences WHERE user_id=p_user AND notice_version NOT LIKE 'qa:%'),
    'deliveries',coalesce((SELECT jsonb_agg(jsonb_build_object('news_id',e.news_id,'catalog_id',e.catalog_id,'status',o.status,'attempts',o.attempts) ORDER BY o.event_id)
      FROM public.news_email_outbox o JOIN public.news_email_events e USING(event_id) WHERE o.user_id=p_user),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.export_news_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_news_email(uuid) TO service_role;
COMMIT;
