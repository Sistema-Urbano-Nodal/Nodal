BEGIN;

-- A file exists for exactly as long as the chat post that owns it. Its payload
-- stays off ordinary inbox, project, page and export queries.
CREATE TABLE member_work.message_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES member_work.posts ON DELETE CASCADE,
  author uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  position smallint NOT NULL CHECK(position BETWEEN 0 AND 3),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 160),
  mime text NOT NULL CHECK(char_length(mime) BETWEEN 1 AND 128),
  size integer NOT NULL CHECK(size BETWEEN 1 AND 3145728),
  content bytea NOT NULL CHECK(octet_length(content)=size),
  UNIQUE(post_id,position)
);
CREATE INDEX workspace_file_author ON member_work.message_files(author);
-- Every inbox entry needs one newest chat post, including rooms with long project histories.
CREATE INDEX workspace_latest_chat ON member_work.posts(room_id,created_at DESC,id DESC) WHERE project_id IS NULL;
CREATE TABLE member_work.file_usage (
  author uuid PRIMARY KEY REFERENCES public.profiles ON DELETE CASCADE,
  bytes bigint NOT NULL CHECK(bytes BETWEEN 0 AND 67108864)
);
ALTER TABLE member_work.message_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work.file_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON member_work.message_files,member_work.file_usage FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON member_work.message_files TO service_role;
GRANT SELECT,INSERT,UPDATE ON member_work.file_usage TO service_role;

-- Cascading room/post/account erasure releases capacity. An auth deletion can
-- be initiated by GoTrue, whose role has no direct access to private tables.
CREATE FUNCTION member_work.release_file_bytes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE member_work.file_usage SET bytes=bytes-OLD.size WHERE author=OLD.author;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION member_work.release_file_bytes() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER workspace_release_file_bytes AFTER DELETE ON member_work.message_files
  FOR EACH ROW EXECUTE FUNCTION member_work.release_file_bytes();

CREATE FUNCTION member_work.store_files(actor uuid, message uuid, files jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,member_work AS $$
DECLARE
  file jsonb;
  n integer := 0;
  total integer := 0;
  byte_count integer;
  decoded bytea;
BEGIN
  IF jsonb_typeof(files) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid attachments' USING ERRCODE='WM400'; END IF;
  IF jsonb_array_length(files)>4 THEN RAISE EXCEPTION 'too many attachments' USING ERRCODE='WM413'; END IF;
  IF jsonb_array_length(files)=0 THEN RETURN; END IF;
  FOR file IN SELECT value FROM jsonb_array_elements(files) LOOP
    IF jsonb_typeof(file->'size') IS DISTINCT FROM 'number' OR (file->>'size') !~ '^[1-9][0-9]{0,6}$'
      OR jsonb_typeof(file->'name') IS DISTINCT FROM 'string' OR length(btrim(file->>'name'))=0 OR length(file->>'name')>160
      OR jsonb_typeof(file->'mime') IS DISTINCT FROM 'string' OR length(file->>'mime') NOT BETWEEN 1 AND 128
      OR jsonb_typeof(file->'data') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid attachment' USING ERRCODE='WM400';
    END IF;
    byte_count:=(file->>'size')::integer;
    total:=total+byte_count;
    IF total>3145728 THEN RAISE EXCEPTION 'attachments too large' USING ERRCODE='WM413'; END IF;
    IF length(file->>'data')<>4*((byte_count+2)/3) THEN RAISE EXCEPTION 'invalid attachment bytes' USING ERRCODE='WM400'; END IF;
    BEGIN
      decoded:=decode(file->>'data','base64');
    EXCEPTION WHEN invalid_parameter_value THEN RAISE EXCEPTION 'invalid attachment bytes' USING ERRCODE='WM400';
    END;
    IF octet_length(decoded)<>byte_count OR replace(encode(decoded,'base64'),chr(10),'')<>file->>'data' THEN
      RAISE EXCEPTION 'invalid attachment bytes' USING ERRCODE='WM400';
    END IF;
    INSERT INTO message_files(post_id,author,position,name,mime,size,content)
    VALUES(message,actor,n,file->>'name',file->>'mime',byte_count,decoded);
    n:=n+1;
  END LOOP;
  -- The upsert serializes this author's allocations even across different rooms.
  INSERT INTO file_usage(author,bytes) VALUES(actor,total)
  ON CONFLICT(author) DO UPDATE SET bytes=file_usage.bytes+EXCLUDED.bytes
    WHERE file_usage.bytes+EXCLUDED.bytes<=67108864;
  IF NOT FOUND THEN RAISE EXCEPTION 'attachment storage full' USING ERRCODE='WM413'; END IF;
END $$;
REVOKE ALL ON FUNCTION member_work.store_files(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION member_work.store_files(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION member_work.summary(r member_work.rooms, actor uuid, unread boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'unread',unread,'revision',r.revision,
    'lastMessage',(SELECT jsonb_build_object('body',left(p.body,180),'authorId',p.author,'createdAt',p.created_at,
      'hasAttachments',EXISTS (SELECT FROM member_work.message_files f WHERE f.post_id=p.id))
      FROM member_work.posts p WHERE p.room_id=r.id AND p.project_id IS NULL ORDER BY p.created_at DESC,p.id DESC LIMIT 1)) ||
    CASE WHEN r.kind='group' THEN jsonb_build_object('name',r.name)
    ELSE jsonb_build_object('name',coalesce(member_work.display_name(peer.id),''),
                            'peerId',peer.id,'initiatorId',r.creator) END ||
    CASE WHEN r.kind='direct' AND profile.photo_revision IS NOT NULL AND member_work.eligible(peer.id)
      THEN jsonb_build_object('photoUrl','/api/users/' || peer.id::text || '/photo?v=' || profile.photo_revision::text)
      ELSE '{}'::jsonb END
  FROM (SELECT CASE WHEN actor=r.peer_low THEN r.peer_high ELSE r.peer_low END AS id) peer
  LEFT JOIN public.profiles profile ON profile.id=peer.id
$$;

CREATE OR REPLACE FUNCTION member_work.chat_page(room uuid, before_id uuid) RETURNS jsonb
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
      'body',body,'createdAt',created_at,'attachments',coalesce((
        SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size) ORDER BY f.position)
        FROM member_work.message_files f WHERE f.post_id=candidates.id),'[]'::jsonb)) ORDER BY created_at,id) FILTER (WHERE position<=50),'[]'::jsonb))
  FROM candidates
$$;

CREATE OR REPLACE FUNCTION member_work.own_data(actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'messageId',p.id,'threadId',p.room_id,
      'name',f.name,'mime',f.mime,'size',f.size,'downloadUrl','/api/me/export/attachments/' || f.id::text)
      ORDER BY p.created_at,p.id,f.position) FROM member_work.message_files f JOIN member_work.posts p ON p.id=f.post_id
      WHERE p.author=actor),'[]'),
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

CREATE OR REPLACE FUNCTION public.member_workspace(p_actor uuid, p_op text, p_data jsonb) RETURNS jsonb
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
  posted_id uuid;
  attachment jsonb;
  request_digest bytea;
  fresh boolean := false;
  notify_members boolean := false;
BEGIN
  IF NOT EXISTS (SELECT FROM public.profiles WHERE id=p_actor AND account_status='active') THEN
    RETURN refusal(403,'inactive member');
  END IF;
  -- Older RPC versions reject these operations. A file-bearing write cannot silently turn into a text send.
  IF p_op IN ('directFiles','sendFiles') THEN
    IF jsonb_typeof(p_data->'attachments') IS DISTINCT FROM 'array' OR p_data->'attachments'='[]'::jsonb THEN
      RETURN refusal(400,'attachments required');
    END IF;
    p_op:=CASE WHEN p_op='sendFiles' THEN 'send' ELSE 'direct' END;
  END IF;
  IF p_op='inbox' THEN
    RETURN jsonb_build_object(
      'threads',coalesce((SELECT jsonb_agg(summary(t,p_actor,mem.unread) ORDER BY t.changed_at DESC,t.id)
        FROM members mem JOIN rooms t ON t.id=mem.room_id WHERE mem.user_id=p_actor AND mem.status='active'),'[]'),
      'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'inviterName',display_name(mem.invited_by))
          ORDER BY t.changed_at DESC,t.id) FROM members mem JOIN rooms t ON t.id=mem.room_id
        WHERE mem.user_id=p_actor AND mem.status='invited'),'[]')
    );
  ELSIF p_op IN ('attachment','exportAttachment') THEN
    SELECT jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,
      'data',replace(encode(f.content,'base64'),chr(10),'')) INTO attachment
    FROM message_files f JOIN posts p ON p.id=f.post_id
    WHERE f.id=(p_data->>'attachmentId')::uuid AND (
      (p_op='exportAttachment' AND p.author=p_actor) OR (p_op='attachment' AND EXISTS
        (SELECT FROM members mem WHERE mem.room_id=p.room_id AND mem.user_id=p_actor AND mem.status='active')));
    RETURN coalesce(attachment,refusal(404,'attachment unavailable'));
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
    IF coalesce(btrim(p_data->>'body'),'')='' AND coalesce(p_data->'attachments','[]'::jsonb)='[]'::jsonb THEN
      RAISE EXCEPTION 'empty message' USING ERRCODE='WM400';
    END IF;
    INSERT INTO posts(room_id,author,body) VALUES(rid,p_actor,coalesce(p_data->>'body','')) RETURNING id INTO posted_id;
    IF p_data ? 'attachments' THEN PERFORM store_files(p_actor,posted_id,p_data->'attachments'); END IF;
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
-- Roll back the entire command before returning a business refusal, including a
-- newly created introduction or a pending exchange opened by this reply.
EXCEPTION WHEN SQLSTATE 'WM400' THEN RETURN refusal(400,SQLERRM);
          WHEN SQLSTATE 'WM413' THEN RETURN refusal(413,SQLERRM);
END $$;

COMMIT;
