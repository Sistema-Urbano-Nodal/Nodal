-- Account erasure for anyone who has ever posted in a course.
--
-- GoTrue deletes auth.users as supabase_auth_admin. The cascade removes the
-- profile, and the profile's foreign key sets course_posts.user_id to NULL.
-- Postgres runs that SET NULL as the table owner, but queues the AFTER trigger
-- course_posts_revision() it causes and fires it at the end of the outer DELETE
-- as the deleting role. supabase_auth_admin has no UPDATE on
-- public.course_modules, so the trigger failed with 42501 and the whole account
-- deletion was rolled back ("Database error deleting user").
--
-- The trigger only bumps a cache counter on the post's module, so it runs as its
-- owner, like nodal_private.bump_network_revision(). The body already qualifies
-- every table, so the search path can be empty. Additive and idempotent: safe to
-- run again. Apply with `supabase db query --linked -f`, never `db push`.
ALTER FUNCTION public.course_posts_revision() SECURITY DEFINER;
ALTER FUNCTION public.course_posts_revision() SET search_path = '';
-- Trigger firing never checks EXECUTE; nobody may call it directly.
REVOKE ALL ON FUNCTION public.course_posts_revision() FROM PUBLIC, anon, authenticated;
