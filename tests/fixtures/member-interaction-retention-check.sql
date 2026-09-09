-- Run only against a disposable migrated validation database. Rolls back data.
BEGIN;
CREATE FUNCTION pg_temp.reject_interaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Injected interaction failure' USING ERRCODE='23514';
END $$;
DO $$
DECLARE
  person uuid:=gen_random_uuid(); target uuid:=gen_random_uuid();
  before_revision bigint;
BEGIN
  IF has_table_privilege('anon','public.member_interactions','INSERT')
    OR has_table_privilege('authenticated','public.member_interactions','INSERT')
    OR has_table_privilege('service_role','public.member_interactions','DELETE') THEN
    RAISE EXCEPTION 'Interaction privileges were broadened';
  END IF;
  IF has_function_privilege('anon','nodal_private.retain_member_interactions()','EXECUTE')
    OR has_function_privilege('authenticated','nodal_private.retain_member_interactions()','EXECUTE')
    OR has_function_privilege('service_role','nodal_private.retain_member_interactions()','EXECUTE')
    OR has_function_privilege('anon','nodal_private.record_new_member_follow()','EXECUTE')
    OR has_function_privilege('authenticated','nodal_private.record_new_member_follow()','EXECUTE')
    OR has_function_privilege('service_role','nodal_private.record_new_member_follow()','EXECUTE') THEN
    RAISE EXCEPTION 'Internal trigger functions may not be called directly';
  END IF;
  INSERT INTO auth.users(id) VALUES(person),(target);
  SELECT revision INTO before_revision FROM public.network_revision WHERE id=1;
  SET LOCAL ROLE service_role;
  INSERT INTO public.member_follows(user_id,target_user_id) VALUES(person,target) ON CONFLICT DO NOTHING;
  INSERT INTO public.member_follows(user_id,target_user_id) VALUES(person,target) ON CONFLICT DO NOTHING;
  IF (SELECT count(*) FROM public.member_interactions WHERE from_user_id=person AND to_user_id=target AND type='follow')<>1 THEN
    RAISE EXCEPTION 'Repeated follow was not idempotent';
  END IF;
  INSERT INTO public.member_interactions(from_user_id,to_user_id,type)
  SELECT person,target,'skip' FROM generate_series(1,80);
  IF (SELECT count(*) FROM public.member_interactions WHERE from_user_id=person AND to_user_id=target)<>50 THEN
    RAISE EXCEPTION 'History exceeded 50 records';
  END IF;
  IF (SELECT revision FROM public.network_revision WHERE id=1)<=before_revision THEN
    RAISE EXCEPTION 'Interaction changes did not invalidate snapshots';
  END IF;
  RESET ROLE;
  -- A failure while recording the event must also roll back the new edge.
  -- The temporary failure trigger is itself rolled back by the subtransaction.
  BEGIN
    CREATE TRIGGER retention_test_reject_interaction BEFORE INSERT ON public.member_interactions
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_interaction();
    SET LOCAL ROLE service_role;
    INSERT INTO public.member_follows(user_id,target_user_id) VALUES(target,person);
    RAISE EXCEPTION 'Follow succeeded despite the injected interaction failure';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.member_follows WHERE user_id=target AND target_user_id=person)
    OR EXISTS(SELECT 1 FROM public.member_interactions WHERE from_user_id=target AND to_user_id=person) THEN
    RAISE EXCEPTION 'Failed interaction left a partial follow behind';
  END IF;
END $$;
ROLLBACK;
