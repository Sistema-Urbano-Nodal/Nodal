BEGIN;

-- A canonical publication event exists even when nobody has opted into email.
-- Timestamp only new publications; old events and private delivery probes stay out of the bell.
CREATE TABLE member_work.editorial_events (
  event_id text PRIMARY KEY REFERENCES public.news_email_events(event_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX editorial_bell_recent ON member_work.editorial_events(created_at DESC,event_id DESC);
CREATE TABLE member_work.editorial_reads (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES member_work.editorial_events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id,event_id)
);
CREATE INDEX editorial_reads_event ON member_work.editorial_reads(event_id);
ALTER TABLE member_work.editorial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.editorial_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_work.editorial_events,member_work.editorial_reads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON member_work.editorial_events,member_work.editorial_reads TO service_role;

CREATE FUNCTION member_work.record_editorial_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  INSERT INTO member_work.editorial_events(event_id) VALUES(NEW.event_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION member_work.record_editorial_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER record_editorial_bell AFTER INSERT ON public.news_email_events FOR EACH ROW
  WHEN (NEW.event_id='n:'||NEW.news_id OR NEW.event_id='c:'||NEW.catalog_id)
  EXECUTE FUNCTION member_work.record_editorial_event();

CREATE VIEW member_work.visible_editorial_notifications WITH (security_invoker = true) AS
  SELECT e.event_id,e.created_at,n.id,'news'::text AS type,to_jsonb(n.title) AS title
  FROM member_work.editorial_events e JOIN public.news_email_events source USING(event_id)
  JOIN public.nodal_news n ON n.id=source.news_id AND n.status='published'
  UNION ALL
  SELECT e.event_id,e.created_at,c.id,'opportunity',jsonb_build_object(
    'en',c.translations->'en'->>'title','es',c.translations->'es'->>'title','pt',c.translations->'pt'->>'title')
  FROM member_work.editorial_events e JOIN public.news_email_events source USING(event_id)
  JOIN public.catalog_items c ON c.id=source.catalog_id AND c.status='published' AND c.visibility='public'
    AND c.featured AND c.kind='opportunity';
REVOKE ALL ON member_work.visible_editorial_notifications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON member_work.visible_editorial_notifications TO service_role;

-- Keep the chat-only function intact for older clients, including cached assets during rollout.
CREATE FUNCTION public.member_workspace_bell(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE chat jsonb := public.member_workspace_notifications(p_actor);
BEGIN
  IF chat ? 'error' THEN RETURN chat; END IF;
  RETURN (
    WITH editorial AS MATERIALIZED (
      SELECT e.*,count(*) OVER() AS total FROM member_work.visible_editorial_notifications e
      JOIN public.profiles u ON u.id=p_actor AND (u.created_at IS NULL OR e.created_at>=u.created_at)
      WHERE NOT EXISTS (SELECT FROM member_work.editorial_reads r WHERE r.user_id=p_actor AND r.event_id=e.event_id)
      ORDER BY e.created_at DESC,e.id DESC,e.type DESC LIMIT 20
    ), combined AS (
      SELECT value AS item FROM jsonb_array_elements(chat->'items')
      UNION ALL
      SELECT jsonb_build_object('type',e.type,'id',e.id,'createdAt',e.created_at,'title',e.title) FROM editorial e
    ), page AS (
      SELECT item,(item->>'createdAt')::timestamptz AS at FROM combined
      ORDER BY at DESC NULLS LAST,item->>'id' DESC,item->>'type' DESC LIMIT 20
    )
    SELECT jsonb_build_object('workspaceTotal',(chat->>'total')::bigint,
      'total',(chat->>'total')::bigint+coalesce((SELECT max(total) FROM editorial),0),
      'items',coalesce(jsonb_agg(item ORDER BY at DESC NULLS LAST,item->>'id' DESC,item->>'type' DESC),'[]'::jsonb))
    FROM page
  );
END $$;

CREATE FUNCTION public.read_editorial_notification(p_actor uuid,p_event text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE joined_at timestamptz;
BEGIN
  SELECT created_at INTO joined_at FROM public.profiles WHERE id=p_actor AND account_status='active';
  IF NOT FOUND THEN RETURN member_work.refusal(403,'inactive member'); END IF;
  INSERT INTO member_work.editorial_reads(user_id,event_id)
    SELECT p_actor,e.event_id FROM member_work.visible_editorial_notifications e
    WHERE e.event_id=p_event AND (joined_at IS NULL OR e.created_at>=joined_at)
    ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN foreign_key_violation THEN
  -- The source or member was erased between the visibility check and receipt insertion.
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.member_workspace_bell(uuid),public.read_editorial_notification(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_workspace_bell(uuid),public.read_editorial_notification(uuid,text) TO service_role;

COMMIT;
