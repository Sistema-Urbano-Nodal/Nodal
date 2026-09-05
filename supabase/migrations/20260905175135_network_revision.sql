-- Global network revision: every committed visibility/profile/graph mutation
-- invalidates snapshots across app instances, including direct Data API writes.
CREATE TABLE public.network_revision (
  id integer PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 1
);
INSERT INTO public.network_revision (id) VALUES (1);
ALTER TABLE public.network_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.network_revision FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.network_revision TO service_role;

-- Triggers run for authenticated profile writes too. Keep the privileged
-- counter-only function in a non-exposed schema and revoke direct execution.
CREATE SCHEMA IF NOT EXISTS nodal_private;
REVOKE ALL ON SCHEMA nodal_private FROM PUBLIC, anon, authenticated;
CREATE FUNCTION nodal_private.bump_network_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.network_revision SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION nodal_private.bump_network_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER network_revision_profiles AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION nodal_private.bump_network_revision();
CREATE TRIGGER network_revision_preferences AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.profile_preferences
FOR EACH STATEMENT EXECUTE FUNCTION nodal_private.bump_network_revision();
CREATE TRIGGER network_revision_onboarding AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.onboarding_responses
FOR EACH STATEMENT EXECUTE FUNCTION nodal_private.bump_network_revision();
CREATE TRIGGER network_revision_follows AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.member_follows
FOR EACH STATEMENT EXECUTE FUNCTION nodal_private.bump_network_revision();
CREATE TRIGGER network_revision_interactions AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.member_interactions
FOR EACH STATEMENT EXECUTE FUNCTION nodal_private.bump_network_revision();
