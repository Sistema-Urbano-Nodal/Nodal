BEGIN;

CREATE TABLE member_work.notifications (
  room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz,
  post_id uuid REFERENCES member_work.posts ON DELETE CASCADE,
  PRIMARY KEY(room_id,user_id),
  FOREIGN KEY(room_id,user_id) REFERENCES member_work.members(room_id,user_id) ON DELETE CASCADE
);
CREATE INDEX workspace_notification_recipient ON member_work.notifications(user_id,created_at DESC NULLS LAST,event_id DESC);
CREATE INDEX workspace_notification_post ON member_work.notifications(post_id) WHERE post_id IS NOT NULL;
ALTER TABLE member_work.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_work.notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON member_work.notifications TO service_role;

CREATE FUNCTION member_work.notify_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  INSERT INTO member_work.notifications(room_id,user_id,event_id,created_at,post_id)
    SELECT m.room_id,m.user_id,NEW.id,NEW.created_at,NEW.id FROM member_work.members m
    WHERE m.room_id=NEW.room_id AND m.status='active' AND m.user_id<>NEW.author
    ON CONFLICT(room_id,user_id) DO UPDATE SET event_id=excluded.event_id,
      created_at=excluded.created_at,post_id=excluded.post_id;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_notify_chat AFTER INSERT ON member_work.posts
  FOR EACH ROW WHEN (NEW.project_id IS NULL) EXECUTE FUNCTION member_work.notify_chat();

CREATE FUNCTION member_work.notify_invitation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  INSERT INTO member_work.notifications(room_id,user_id,created_at) VALUES(NEW.room_id,NEW.user_id,clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_notify_invitation AFTER INSERT ON member_work.members
  FOR EACH ROW WHEN (NEW.status='invited') EXECUTE FUNCTION member_work.notify_invitation();

CREATE FUNCTION member_work.clear_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  DELETE FROM member_work.notifications WHERE room_id=NEW.room_id AND user_id=NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_clear_notification AFTER UPDATE OF status,unread ON member_work.members
  FOR EACH ROW WHEN (NEW.status<>OLD.status OR (NEW.status='active' AND NOT NEW.unread))
  EXECUTE FUNCTION member_work.clear_notification();
REVOKE ALL ON FUNCTION member_work.notify_chat(), member_work.notify_invitation(), member_work.clear_notification()
  FROM PUBLIC,anon,authenticated,service_role;

-- Pending invitations predate timestamp tracking. Direct unread proves a chat arrived.
-- Old group unread flags also represent project/membership activity, so cannot prove a chat is unread.
INSERT INTO member_work.notifications(room_id,user_id)
  SELECT room_id,user_id FROM member_work.members WHERE status='invited';
INSERT INTO member_work.notifications(room_id,user_id,event_id,created_at,post_id)
  SELECT m.room_id,m.user_id,p.id,p.created_at,p.id
  FROM member_work.members m JOIN member_work.rooms r ON r.id=m.room_id
  CROSS JOIN LATERAL (
    SELECT p.id,p.created_at FROM member_work.posts p WHERE p.room_id=m.room_id AND p.project_id IS NULL AND p.author<>m.user_id
    ORDER BY p.created_at DESC,p.id DESC LIMIT 1
  ) p WHERE m.status='active' AND m.unread AND r.kind='direct' AND r.status<>'blocked';

CREATE FUNCTION public.member_workspace_notifications(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN NOT EXISTS (SELECT FROM public.profiles WHERE id=p_actor AND account_status='active')
    THEN member_work.refusal(403,'inactive member')
    ELSE (
      SELECT jsonb_build_object('total',coalesce(max(total),0),'items',coalesce(jsonb_agg(
        jsonb_build_object('id',event_id,'type',type,'threadId',room_id,'threadKind',kind,
          'groupName',name,'actorName',actor_name,'createdAt',created_at)
        ORDER BY created_at DESC NULLS LAST,event_id DESC),'[]'::jsonb))
      FROM (
        SELECT n.event_id,CASE WHEN n.post_id IS NULL THEN 'invitation' ELSE 'message' END AS type,
          n.room_id,r.kind,r.name,coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.preferred_name),''),'Member') AS actor_name,
          n.created_at,count(*) OVER() AS total
        FROM member_work.notifications n JOIN member_work.members m ON m.room_id=n.room_id AND m.user_id=n.user_id
        JOIN member_work.rooms r ON r.id=n.room_id LEFT JOIN member_work.posts p ON p.id=n.post_id
        JOIN public.profiles u ON u.id=coalesce(p.author,m.invited_by) AND u.account_status='active'
        WHERE n.user_id=p_actor AND r.status<>'blocked' AND ((m.status='invited' AND n.post_id IS NULL)
          OR (m.status='active' AND m.unread AND n.post_id IS NOT NULL))
        ORDER BY n.created_at DESC NULLS LAST,n.event_id DESC LIMIT 20
      ) page
    ) END
$$;
REVOKE ALL ON FUNCTION public.member_workspace_notifications(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_workspace_notifications(uuid) TO service_role;

COMMIT;
