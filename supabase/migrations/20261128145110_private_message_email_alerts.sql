BEGIN;

CREATE TABLE public.direct_email_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','es','pt')),
  subscribed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.direct_email_outbox (
  thread_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES public.direct_email_preferences(user_id) ON DELETE CASCADE,
  event_id uuid NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','uncertain','skipped')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(thread_id,user_id),
  FOREIGN KEY(thread_id,user_id) REFERENCES member_work.notifications(room_id,user_id) ON DELETE CASCADE
);
CREATE INDEX direct_email_queue ON public.direct_email_outbox(available_at,event_id) WHERE status='queued';
CREATE INDEX direct_email_recipient_idx ON public.direct_email_outbox(user_id);
ALTER TABLE public.direct_email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_email_preferences,public.direct_email_outbox FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.direct_email_preferences TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.direct_email_outbox TO service_role;

-- The bell holds the newest unread message. Coalesce a burst into one delivery per recipient and room.
-- Unsubscribe and marking a conversation read remove its queued mail through the two foreign keys.
CREATE FUNCTION member_work.enqueue_direct_email() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.post_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.direct_email_outbox(thread_id,user_id,event_id)
    SELECT r.id,p.user_id,NEW.post_id FROM member_work.rooms r
      JOIN public.direct_email_preferences p ON p.user_id=NEW.user_id
      JOIN member_work.posts msg ON msg.id=NEW.post_id AND msg.author<>p.user_id AND msg.project_id IS NULL
    WHERE r.id=NEW.room_id AND r.kind='direct' AND r.status<>'blocked' FOR KEY SHARE OF p
    ON CONFLICT(thread_id,user_id) DO UPDATE SET event_id=excluded.event_id,status='queued',attempts=0,available_at=now()
    WHERE public.direct_email_outbox.event_id<>excluded.event_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION member_work.enqueue_direct_email() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER direct_email_enqueue AFTER INSERT OR UPDATE OF event_id ON member_work.notifications
  FOR EACH ROW EXECUTE FUNCTION member_work.enqueue_direct_email();

CREATE FUNCTION public.claim_direct_email()
RETURNS TABLE(thread_id uuid,user_id uuid,event_id uuid,attempts integer)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  WITH next_job AS (
    SELECT o.thread_id,o.user_id FROM public.direct_email_outbox o WHERE o.status='queued' AND o.available_at<=now()
    ORDER BY o.available_at,o.event_id LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.direct_email_outbox o SET status='sending',attempts=o.attempts+1
    FROM next_job n WHERE o.thread_id=n.thread_id AND o.user_id=n.user_id
    RETURNING o.thread_id,o.user_id,o.event_id,o.attempts;
$$;

-- Read the current confirmed address from Auth at handoff. Never project message text or attachment fields.
CREATE FUNCTION public.direct_email_recipient(p_thread uuid,p_user uuid,p_event uuid,p_attempt integer)
RETURNS TABLE(email text,language text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT u.email::text,p.language FROM public.direct_email_outbox o
    JOIN public.direct_email_preferences p ON p.user_id=o.user_id
    JOIN public.profiles member ON member.id=o.user_id AND member.account_status='active'
    JOIN auth.users u ON u.id=member.id AND u.email_confirmed_at IS NOT NULL AND coalesce(u.email,'')<>''
    JOIN member_work.rooms r ON r.id=o.thread_id AND r.kind='direct' AND r.status<>'blocked'
    JOIN member_work.members m ON m.room_id=r.id AND m.user_id=o.user_id AND m.status='active' AND m.unread
    JOIN member_work.notifications n ON n.room_id=r.id AND n.user_id=m.user_id AND n.post_id=o.event_id
    JOIN member_work.posts msg ON msg.id=n.post_id AND msg.project_id IS NULL AND msg.author<>o.user_id
    JOIN public.profiles sender ON sender.id=msg.author AND sender.account_status='active'
  WHERE o.thread_id=p_thread AND o.user_id=p_user AND o.event_id=p_event AND o.attempts=p_attempt AND o.status='sending';
$$;
-- Aggregate the member's complete export in one snapshot, independent of the Data API row limit.
CREATE FUNCTION public.export_direct_email(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'subscription',(SELECT jsonb_build_object('language',language,'subscribed_at',subscribed_at)
      FROM public.direct_email_preferences WHERE user_id=p_user),
    'deliveries',coalesce((SELECT jsonb_agg(jsonb_build_object('event_id',event_id,'status',status,'attempts',attempts)
      ORDER BY event_id) FROM public.direct_email_outbox WHERE user_id=p_user),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.claim_direct_email(), public.direct_email_recipient(uuid,uuid,uuid,integer),
  public.export_direct_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_direct_email(), public.direct_email_recipient(uuid,uuid,uuid,integer),
  public.export_direct_email(uuid) TO service_role;
COMMIT;
