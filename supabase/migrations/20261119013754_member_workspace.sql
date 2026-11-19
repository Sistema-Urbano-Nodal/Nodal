BEGIN;

-- The application supplies the authenticated actor. Browser roles have no privileges
-- on the RPC or its private storage.
CREATE SCHEMA member_work;
REVOKE ALL ON SCHEMA member_work FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA member_work TO service_role;

CREATE TABLE member_work.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('direct','group')),
  name text NOT NULL DEFAULT '',
  creator uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  peer_low uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  peer_high uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending','active','blocked')),
  revision bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (peer_low, peer_high)
);
CREATE TABLE member_work.members (
  room_id uuid NOT NULL REFERENCES member_work.rooms ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active','invited')),
  invited_by uuid REFERENCES public.profiles ON DELETE SET NULL,
  unread boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id,user_id)
);
CREATE INDEX workspace_inbox ON member_work.members(user_id, status);
CREATE INDEX workspace_invites ON member_work.members(invited_by,user_id) WHERE status='invited';

CREATE TABLE member_work.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES member_work.rooms ON DELETE CASCADE,
  author uuid REFERENCES public.profiles ON DELETE SET NULL,
  title text NOT NULL,
  goal text NOT NULL,
  link text NOT NULL DEFAULT '',
  link_author uuid REFERENCES public.profiles ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (room_id,id)
);
CREATE TABLE member_work.steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES member_work.projects ON DELETE CASCADE,
  author uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  description text NOT NULL,
  assignee uuid REFERENCES public.profiles ON DELETE SET NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workspace_project_steps ON member_work.steps(project_id,created_at,id);
CREATE TABLE member_work.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES member_work.rooms ON DELETE CASCADE,
  project_id uuid,
  author uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (room_id,project_id) REFERENCES member_work.projects(room_id,id) ON DELETE CASCADE
);
CREATE INDEX workspace_post_history ON member_work.posts(room_id,project_id,created_at,id);
CREATE INDEX workspace_posts_author ON member_work.posts(author);
CREATE TABLE member_work.receipts (
  author uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  operation text NOT NULL,
  client_id uuid NOT NULL,
  digest bytea NOT NULL,
  room_id uuid REFERENCES member_work.rooms ON DELETE SET NULL,
  project_id uuid REFERENCES member_work.projects ON DELETE SET NULL,
  PRIMARY KEY(author,operation,client_id)
);

-- GoTrue may delete a profile through auth.users. Its role has no direct access
-- to this schema; the trigger owns only this fixed cleanup, without a public entry point.
CREATE FUNCTION member_work.erase_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM r.id FROM member_work.rooms r JOIN member_work.members m ON m.room_id=r.id
    WHERE m.user_id=OLD.id ORDER BY r.id FOR UPDATE OF r;
  UPDATE member_work.rooms r SET revision=revision+1,changed_at=clock_timestamp()
    WHERE r.creator=OLD.id OR EXISTS (SELECT FROM member_work.members m WHERE m.room_id=r.id AND
      (m.user_id=OLD.id OR (m.invited_by=OLD.id AND m.status='invited')))
      OR EXISTS (SELECT FROM member_work.posts p WHERE p.room_id=r.id AND p.author=OLD.id)
      OR EXISTS (SELECT FROM member_work.projects p WHERE p.room_id=r.id AND
        (p.author=OLD.id OR p.link_author=OLD.id OR EXISTS (SELECT FROM member_work.steps s
        WHERE s.project_id=p.id AND (s.author=OLD.id OR s.assignee=OLD.id))));
  DELETE FROM member_work.members WHERE invited_by=OLD.id AND status='invited';
  DELETE FROM member_work.rooms r WHERE EXISTS (
    SELECT FROM member_work.members m WHERE m.room_id=r.id AND m.user_id=OLD.id
  ) AND NOT EXISTS (
    SELECT FROM member_work.members m WHERE m.room_id=r.id AND m.status='active' AND m.user_id<>OLD.id
  );
  UPDATE member_work.rooms SET status='blocked' WHERE OLD.id IN (peer_low,peer_high);
  UPDATE member_work.rooms SET name='' WHERE creator=OLD.id AND kind='group';
  UPDATE member_work.projects SET title='',goal='' WHERE author=OLD.id;
  UPDATE member_work.projects SET link='' WHERE link_author=OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER workspace_profile_erasure BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION member_work.erase_profile();

CREATE FUNCTION member_work.eligible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT FROM public.profiles p
    LEFT JOIN public.profile_preferences f ON f.user_id=p.id
    LEFT JOIN public.onboarding_responses o ON o.user_id=p.id
    WHERE p.id=target AND p.account_status='active' AND
      (f.data_consent->'directoryPublic'='true'::jsonb OR
       (NOT coalesce(f.data_consent ? 'directoryPublic',false) AND o.raw_answers->'partC'->'consent'='true'::jsonb))
  )
$$;

CREATE FUNCTION member_work.display_name(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(nullif(btrim(full_name),''),nullif(btrim(preferred_name),''),'Member')
  FROM public.profiles WHERE id=target
$$;

CREATE FUNCTION member_work.summary(r member_work.rooms, actor uuid, unread boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'unread',unread,'revision',r.revision) ||
    CASE WHEN r.kind='group' THEN jsonb_build_object('name',r.name)
    ELSE jsonb_build_object('name',coalesce(member_work.display_name(peer.id),''),
                            'peerId',peer.id,'initiatorId',r.creator) END
  FROM (SELECT CASE WHEN actor=r.peer_low THEN r.peer_high ELSE r.peer_low END AS id) peer
$$;

CREATE FUNCTION member_work.history(room uuid, project uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'authorId',author,'authorName',member_work.display_name(author),'body',body,'createdAt',created_at
  ) ORDER BY created_at,id),'[]'::jsonb) FROM member_work.posts
  WHERE room_id=room AND project_id IS NOT DISTINCT FROM project
$$;

-- Return the newest 50 before the cursor, ordered for display. The extra
-- candidate determines whether the client can request an older page.
CREATE FUNCTION member_work.chat_page(room uuid, before_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH candidates AS (
    SELECT p.*,row_number() OVER (ORDER BY p.created_at DESC,p.id DESC) AS position
    FROM member_work.posts p WHERE p.room_id=room AND p.project_id IS NULL
      AND (before_id IS NULL OR (p.created_at,p.id) <
        (SELECT c.created_at,c.id FROM member_work.posts c WHERE c.id=before_id))
    ORDER BY p.created_at DESC,p.id DESC LIMIT 51
  )
  SELECT jsonb_build_object('moreMessages',count(*)>50,'messages',
    coalesce(jsonb_agg(jsonb_build_object('id',id,'authorId',author,'authorName',member_work.display_name(author),
      'body',body,'createdAt',created_at) ORDER BY created_at,id) FILTER (WHERE position<=50),'[]'::jsonb))
  FROM candidates
$$;

CREATE FUNCTION member_work.project_list(room uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'title',p.title,'goal',p.goal,'link',p.link,
    'steps',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'description',s.description,'assigneeId',s.assignee,'done',s.done
    ) ORDER BY s.created_at,s.id),'[]'::jsonb) FROM member_work.steps s WHERE s.project_id=p.id),
    'updates',member_work.history(room,p.id)
  ) ORDER BY p.created_at,p.id),'[]'::jsonb) FROM member_work.projects p WHERE p.room_id=room
$$;

CREATE FUNCTION member_work.own_data(actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'memberships',coalesce((SELECT jsonb_agg(jsonb_build_object('threadId',m.room_id,'kind',r.kind,'status',m.status))
      FROM member_work.members m JOIN member_work.rooms r ON r.id=m.room_id WHERE m.user_id=actor),'[]'),
    'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name))
      FROM member_work.rooms WHERE creator=actor AND kind='group'),'[]'),
    'messages',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'threadId',room_id,'body',body,'createdAt',created_at))
      FROM member_work.posts WHERE author=actor AND project_id IS NULL),'[]'),
    'projects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'threadId',room_id,'title',title,'goal',goal))
      FROM member_work.projects WHERE author=actor),'[]'),
    'links',coalesce((SELECT jsonb_agg(jsonb_build_object('projectId',id,'link',link))
      FROM member_work.projects WHERE link_author=actor),'[]'),
    'steps',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'projectId',project_id,'description',description,'done',done))
      FROM member_work.steps WHERE author=actor),'[]'),
    'updates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'projectId',project_id,'body',body,'createdAt',created_at))
      FROM member_work.posts WHERE author=actor AND project_id IS NOT NULL),'[]')
  )
$$;

CREATE FUNCTION member_work.refusal(code integer, msg text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('status',code,'error',msg)
$$;

CREATE FUNCTION public.member_workspace(p_actor uuid, p_op text, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,member_work AS $$
DECLARE
  rid uuid := (p_data->>'threadId')::uuid;
  pid uuid := (p_data->>'projectId')::uuid;
  cid uuid := (p_data->>'clientId')::uuid;
  target uuid := (p_data->>'targetId')::uuid;
  assignee_id uuid := (p_data->>'assigneeId')::uuid;
  targets uuid[];
  peer uuid;
  before_id uuid := (p_data->>'beforeMessageId')::uuid;
  r rooms;
  m members;
  previous receipts;
  request_digest bytea;
  fresh boolean := false;
  notify_members boolean := false;
BEGIN
  IF NOT EXISTS (SELECT FROM public.profiles WHERE id=p_actor AND account_status='active') THEN
    RETURN refusal(403,'inactive member');
  END IF;
  IF p_op='inbox' THEN
    RETURN jsonb_build_object(
      'threads',coalesce((SELECT jsonb_agg(summary(t,p_actor,mem.unread) ORDER BY t.changed_at DESC,t.id)
        FROM members mem JOIN rooms t ON t.id=mem.room_id WHERE mem.user_id=p_actor AND mem.status='active'),'[]'),
      'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'inviterName',display_name(mem.invited_by))
          ORDER BY t.changed_at DESC,t.id) FROM members mem JOIN rooms t ON t.id=mem.room_id
        WHERE mem.user_id=p_actor AND mem.status='invited'),'[]')
    );
  ELSIF p_op='export' THEN
    RETURN own_data(p_actor);
  END IF;

  IF p_op IN ('direct','send','group','invite','createProject','step','update') AND cid IS NULL THEN
    RETURN refusal(400,'client id required');
  END IF;
  IF cid IS NOT NULL THEN
    -- A retry with the same key waits for the first commit even for operations that create a new room.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_op||cid::text,0));
    request_digest := sha256(convert_to(p_data::text,'UTF8'));
    SELECT * INTO previous FROM receipts WHERE author=p_actor AND operation=p_op AND client_id=cid;
    IF FOUND THEN
      IF NOT EXISTS (SELECT FROM members WHERE room_id=previous.room_id AND user_id=p_actor AND status='active') THEN
        RETURN refusal(404,'conversation unavailable');
      END IF;
      IF previous.digest<>request_digest THEN RETURN refusal(409,'client id reused'); END IF;
      RETURN jsonb_strip_nulls(jsonb_build_object('threadId',previous.room_id,'projectId',previous.project_id));
    END IF;
  END IF;

  -- Invitations and contacts use the same pair lock as a block. Lock multiple
  -- invitees in a deterministic order before taking a room lock.
  IF p_op='group' THEN
    SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO targets
      FROM jsonb_array_elements_text(p_data->'targetIds') AS x;
  ELSIF p_op IN ('direct','invite') THEN
    targets := ARRAY[target];
  ELSIF p_op='block' THEN
    SELECT CASE WHEN peer_low=p_actor THEN peer_high ELSE peer_low END INTO peer FROM rooms
      WHERE id=rid AND kind='direct' AND p_actor IN (peer_low,peer_high);
    IF peer IS NOT NULL THEN targets:=ARRAY[peer]; END IF;
  END IF;
  IF targets IS NOT NULL THEN
    FOREACH target IN ARRAY targets LOOP
      IF target=p_actor THEN RETURN refusal(400,'choose another member'); END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(least(p_actor,target)::text||greatest(p_actor,target)::text,1));
    END LOOP;
  END IF;

  IF p_op='direct' THEN
    SELECT * INTO r FROM rooms WHERE peer_low=least(p_actor,target) AND peer_high=greatest(p_actor,target) FOR UPDATE;
    IF NOT FOUND THEN
      -- A concurrent suspension or erasure settles before we decide whether the
      -- introduction can start. Hold the target's active status until commit.
      PERFORM p.id FROM public.profiles p WHERE p.id=target AND p.account_status='active' FOR SHARE;
      IF NOT FOUND THEN RETURN refusal(404,'member unavailable'); END IF;
      IF NOT eligible(target) THEN RETURN refusal(404,'member unavailable'); END IF;
      INSERT INTO rooms(kind,creator,peer_low,peer_high,status)
        VALUES('direct',p_actor,least(p_actor,target),greatest(p_actor,target),'pending') RETURNING * INTO r;
      INSERT INTO members(room_id,user_id,status) VALUES(r.id,p_actor,'active'),(r.id,target,'active');
      fresh:=true;
    END IF;
    rid:=r.id;
  ELSIF p_op='group' THEN
    IF coalesce(cardinality(targets),0)=0 THEN RETURN refusal(400,'choose at least one member'); END IF;
    FOREACH target IN ARRAY targets LOOP
      IF NOT eligible(target) THEN RETURN refusal(404,'member unavailable'); END IF;
      IF EXISTS (SELECT FROM rooms WHERE peer_low=least(p_actor,target) AND peer_high=greatest(p_actor,target) AND status='blocked') THEN
        RETURN refusal(403,'contact unavailable');
      END IF;
    END LOOP;
    INSERT INTO rooms(kind,creator,name,status,revision) VALUES ('group',p_actor,p_data->>'name','active',cardinality(targets)) RETURNING id INTO rid;
    INSERT INTO members(room_id,user_id,status) VALUES(rid,p_actor,'active');
    INSERT INTO members(room_id,user_id,status,invited_by) SELECT rid,invitee,'invited',p_actor FROM unnest(targets) AS invitee;
  ELSE
    IF p_op='thread' THEN
      SELECT * INTO r FROM rooms WHERE id=rid FOR SHARE;
      SELECT * INTO m FROM members WHERE room_id=rid AND user_id=p_actor FOR SHARE;
    ELSE
      SELECT * INTO r FROM rooms WHERE id=rid FOR UPDATE;
      SELECT * INTO m FROM members WHERE room_id=rid AND user_id=p_actor FOR UPDATE;
    END IF;
    IF m.user_id IS NULL OR (m.status='invited' AND p_op NOT IN ('accept','decline')) THEN
      RETURN refusal(404,'conversation unavailable');
    END IF;
  END IF;

  IF p_op='thread' THEN
    IF before_id IS NOT NULL AND NOT EXISTS
      (SELECT FROM posts WHERE id=before_id AND room_id=rid AND project_id IS NULL) THEN
      RETURN refusal(404,'message unavailable');
    END IF;
    RETURN jsonb_build_object('thread',summary(r,p_actor,m.unread),'members',
      (SELECT jsonb_agg(jsonb_build_object('id',mem.user_id,'name',display_name(mem.user_id),'status',mem.status)
        ORDER BY mem.status,display_name(mem.user_id),mem.user_id) FROM members mem WHERE mem.room_id=rid),
      'projects',project_list(rid)) || chat_page(rid,before_id);
  ELSIF p_op='read' THEN
    IF (p_data->>'revision')::bigint=r.revision THEN
      UPDATE members SET unread=false WHERE room_id=rid AND user_id=p_actor;
    END IF;
  ELSIF p_op IN ('send','direct') THEN
    IF r.kind='direct' THEN
      peer:=CASE WHEN r.peer_low=p_actor THEN r.peer_high ELSE r.peer_low END;
      IF r.status='blocked' THEN RETURN refusal(403,'contact unavailable'); END IF;
      IF NOT fresh AND NOT EXISTS (SELECT FROM public.profiles WHERE id=peer AND account_status='active') THEN RETURN refusal(403,'contact unavailable'); END IF;
      IF r.status='pending' AND NOT fresh THEN
        IF r.creator=p_actor THEN RETURN refusal(409,'waiting for reply'); END IF;
        UPDATE rooms SET status='active' WHERE id=rid;
      END IF;
    END IF;
    INSERT INTO posts(room_id,author,body) VALUES(rid,p_actor,p_data->>'body');
    notify_members:=true;
  ELSIF p_op='block' THEN
    IF r.kind<>'direct' THEN RETURN refusal(400,'direct conversation required'); END IF;
    IF r.status='blocked' THEN RETURN jsonb_build_object('threadId',rid); END IF;
    UPDATE rooms SET status='blocked',revision=revision+1,changed_at=clock_timestamp() WHERE id=rid AND status<>'blocked';
    UPDATE members SET unread=false WHERE room_id=rid;
    -- Group operations acquire the room before its membership. Use that order
    -- here too, including when an invitee accepts while the inviter is blocked.
    PERFORM g.id FROM rooms g WHERE EXISTS (SELECT FROM members i WHERE i.room_id=g.id AND i.status='invited'
      AND ((i.user_id=p_actor AND i.invited_by=peer) OR (i.user_id=peer AND i.invited_by=p_actor)))
      ORDER BY g.id FOR UPDATE OF g;
    WITH revoked AS (
      DELETE FROM members WHERE status='invited' AND
        ((user_id=p_actor AND invited_by=peer) OR (user_id=peer AND invited_by=p_actor)) RETURNING room_id
    ), changed_groups AS (
      UPDATE rooms SET revision=revision+1,changed_at=clock_timestamp() WHERE id IN (SELECT room_id FROM revoked)
      RETURNING id
    )
    UPDATE members SET unread=true WHERE room_id IN (SELECT id FROM changed_groups) AND user_id<>p_actor AND status='active';
  ELSIF p_op='invite' THEN
    IF r.kind<>'group' THEN RETURN refusal(400,'group required'); END IF;
    IF NOT eligible(target) THEN RETURN refusal(404,'member unavailable'); END IF;
    IF EXISTS (SELECT FROM rooms WHERE peer_low=least(p_actor,target) AND peer_high=greatest(p_actor,target) AND status='blocked') THEN
      RETURN refusal(403,'contact unavailable');
    END IF;
    INSERT INTO members(room_id,user_id,status,invited_by) VALUES(rid,target,'invited',p_actor) ON CONFLICT DO NOTHING;
    notify_members:=FOUND;
  ELSIF p_op IN ('accept','decline','leave') THEN
    IF p_op IN ('accept','decline') AND m.status<>'invited' THEN RETURN refusal(404,'invitation unavailable'); END IF;
    IF r.kind<>'group' THEN RETURN refusal(400,'group required'); END IF;
    IF p_op='accept' THEN
      UPDATE members SET status='active',invited_by=NULL WHERE room_id=rid AND user_id=p_actor;
      notify_members:=true;
    ELSE
      UPDATE steps s SET assignee=NULL FROM projects p WHERE s.project_id=p.id AND p.room_id=rid AND s.assignee=p_actor;
      DELETE FROM members WHERE room_id=rid AND (user_id=p_actor OR (status='invited' AND invited_by=p_actor));
      IF NOT EXISTS(SELECT FROM members WHERE room_id=rid AND status='active') THEN
        DELETE FROM rooms WHERE id=rid;
      ELSE
        notify_members:=true;
      END IF;
    END IF;
  ELSIF p_op IN ('createProject','link','step','toggle','update') THEN
    IF r.kind<>'group' THEN RETURN refusal(400,'group required'); END IF;
    IF p_op='createProject' THEN
      INSERT INTO projects(room_id,author,title,goal) VALUES(rid,p_actor,p_data->>'title',p_data->>'goal') RETURNING id INTO pid;
    ELSE
      IF NOT EXISTS (SELECT FROM projects WHERE id=pid AND room_id=rid) THEN RETURN refusal(404,'project unavailable'); END IF;
      IF p_op='link' THEN
        UPDATE projects SET link=p_data->>'link',link_author=p_actor WHERE id=pid;
      ELSIF p_op='step' THEN
        IF assignee_id IS NOT NULL AND NOT EXISTS(SELECT FROM members WHERE room_id=rid AND user_id=assignee_id AND status='active') THEN
          RETURN refusal(400,'choose a group participant');
        END IF;
        INSERT INTO steps(project_id,author,description,assignee) VALUES(pid,p_actor,p_data->>'description',assignee_id);
      ELSIF p_op='toggle' THEN
        UPDATE steps SET done=(p_data->>'done')::boolean WHERE id=(p_data->>'stepId')::uuid AND project_id=pid;
        IF NOT FOUND THEN RETURN refusal(404,'step unavailable'); END IF;
      ELSE
        INSERT INTO posts(room_id,project_id,author,body) VALUES(rid,pid,p_actor,p_data->>'body');
      END IF;
    END IF;
    notify_members:=true;
  ELSIF p_op<>'group' THEN
    RETURN refusal(400,'unknown operation');
  END IF;

  IF notify_members THEN
    UPDATE rooms SET changed_at=clock_timestamp(),revision=revision+1 WHERE id=rid;
    UPDATE members SET unread=true WHERE room_id=rid AND user_id<>p_actor AND status='active';
  END IF;
  IF cid IS NOT NULL THEN
    INSERT INTO receipts(author,operation,client_id,digest,room_id,project_id)
      VALUES(p_actor,p_op,cid,request_digest,rid,CASE WHEN p_op='createProject' THEN pid END);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('threadId',rid,'projectId',CASE WHEN p_op='createProject' THEN pid END));
END $$;

ALTER TABLE member_work.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA member_work FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA member_work TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA member_work FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA member_work TO service_role;
REVOKE EXECUTE ON FUNCTION member_work.erase_profile() FROM service_role;
REVOKE ALL ON FUNCTION public.member_workspace(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_workspace(uuid,text,jsonb) TO service_role;

COMMIT;
