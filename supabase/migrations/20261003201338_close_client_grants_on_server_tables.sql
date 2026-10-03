-- Close the Data API grants that 20260810175241_service_role_data_api_grants.sql left to the browser roles.
-- That migration removed organizations, organization_memberships and stripe_events from service_role but never from
-- anon and authenticated, so Supabase's default table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER) still stand for them, with RLS as the only barrier. Every other table is server-only through
-- service_role; these three now match. The browser never holds a Supabase key, and nothing in the app reads these
-- tables as anon or authenticated: apply_stripe_event() writes stripe_events as SECURITY DEFINER (its owner), and the
-- member-select RLS policies stay in place as a second line.
--
-- Also closed: EXECUTE on the trigger function set_updated_at() (a trigger function cannot be called directly, and
-- PostgreSQL checks EXECUTE only when a trigger is created, which migrations do as the owner, never when it fires)
-- and the browser roles' default rights on member_interactions_id_seq (service_role keeps USAGE, SELECT).
--
-- Revokes only: idempotent, no schema or data change. Production migration history differs from these file versions,
-- so apply this file by hand (supabase db query --linked -f <this file>), then record it with supabase migration
-- repair; never supabase db push.
revoke all on table public.organizations from anon;
revoke all on table public.organization_memberships from anon;
revoke all on table public.stripe_events from anon;
revoke all on table public.organizations from authenticated;
revoke all on table public.organization_memberships from authenticated;
revoke all on table public.stripe_events from authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on sequence public.member_interactions_id_seq from anon, authenticated;
