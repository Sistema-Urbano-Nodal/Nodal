-- Account deletion and invite-owner lookups should not scan every invitation.
CREATE INDEX course_invitations_user_id_idx ON public.course_invitations(user_id);
CREATE INDEX course_invitations_created_by_idx ON public.course_invitations(created_by);
