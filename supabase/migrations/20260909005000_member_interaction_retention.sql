-- Bound stored history before graph loading, which has a separate global cap.
-- Triggers cover server inserts without granting the service role DELETE.
-- Apply before the app version that delegates follow events to this trigger.
-- Older app versions remain compatible but append a second, bounded follow
-- event until upgraded; do not drop the trigger when rolling back the app.
BEGIN;
LOCK TABLE public.member_follows, public.member_interactions IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA IF NOT EXISTS nodal_private;
REVOKE ALL ON SCHEMA nodal_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION nodal_private.retain_member_interactions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Retention DELETEs already update this row through the existing revision
  -- trigger. Acquire it first so multi-pair batches cannot invert the order
  -- between a pair lock and the shared revision lock. At REPEATABLE READ a
  -- stale revision row raises a serialization failure, rolling back the write.
  PERFORM id FROM public.network_revision WHERE id = 1 FOR UPDATE;
  -- Serialize the directed pair until commit, including concurrent requests
  -- from separate server instances. Hash collisions only serialize extra pairs.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'nodal-member-interactions:' || NEW.from_user_id::text || ':' || NEW.to_user_id::text, 0));
  DELETE FROM public.member_interactions
  WHERE id IN (
    SELECT id FROM public.member_interactions
    WHERE from_user_id = NEW.from_user_id AND to_user_id = NEW.to_user_id
    ORDER BY created_at DESC NULLS LAST, id DESC OFFSET 50
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.retain_member_interactions() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER member_interactions_retention AFTER INSERT ON public.member_interactions
FOR EACH ROW EXECUTE FUNCTION nodal_private.retain_member_interactions();

CREATE FUNCTION nodal_private.record_new_member_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- ON CONFLICT DO NOTHING fires no row trigger, so retries create no event.
  -- The edge and its event commit or roll back together.
  INSERT INTO public.member_interactions(from_user_id,to_user_id,type)
  VALUES(NEW.user_id,NEW.target_user_id,'follow');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.record_new_member_follow() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER member_follows_interaction AFTER INSERT ON public.member_follows
FOR EACH ROW EXECUTE FUNCTION nodal_private.record_new_member_follow();

-- Existing excess history must not leave deployed graph reads over their cap.
WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY from_user_id,to_user_id ORDER BY created_at DESC NULLS LAST,id DESC
  ) AS position FROM public.member_interactions
)
DELETE FROM public.member_interactions WHERE id IN (SELECT id FROM ranked WHERE position > 50);
COMMIT;
