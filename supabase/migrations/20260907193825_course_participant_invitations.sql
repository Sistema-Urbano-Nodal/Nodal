-- Invitations are administrative records. Browser roles use the authorized
-- NODAL API, never direct table access. Auth tokens are not stored here.
CREATE TABLE public.course_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 course_id uuid NOT NULL REFERENCES public.pilot_courses(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 delivery_status text NOT NULL CHECK(delivery_status IN ('pending','sent','failed','uncertain')),
 accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,email)
);
CREATE INDEX course_invitations_email ON public.course_invitations(email,accepted_at);
CREATE INDEX course_invitations_page ON public.course_invitations(course_id,created_at,id);
ALTER TABLE public.course_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_invitations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.course_invitations TO service_role;

-- Final account erasure also removes an invitation whose provider user ID was
-- not saved yet (for example, a timed-out send). The trigger runs in the Auth
-- deletion transaction, closing the window after application-level cleanup.
CREATE FUNCTION public.erase_course_invitations_for_deleted_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 DELETE FROM public.course_invitations WHERE user_id=OLD.id OR email=lower(OLD.email);
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_course_invitations_for_deleted_auth_user() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER course_invitations_target_erasure BEFORE DELETE ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.erase_course_invitations_for_deleted_auth_user();
