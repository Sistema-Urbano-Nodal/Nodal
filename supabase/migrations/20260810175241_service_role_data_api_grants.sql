-- PostgREST still applies PostgreSQL object privileges to service-role calls.
-- Keep this list aligned with the operations used by server/supabase.js.
revoke all on table public.profiles from service_role;
revoke all on table public.profile_preferences from service_role;
revoke all on table public.onboarding_responses from service_role;
revoke all on table public.member_follows from service_role;
revoke all on table public.member_interactions from service_role;
revoke all on table public.stripe_customers from service_role;
revoke all on sequence public.member_interactions_id_seq from service_role;
revoke all on table public.catalog_items from service_role;
revoke all on table public.catalog_interests from service_role;

grant select, insert, update on table public.profiles to service_role;
grant select, insert, update on table public.profile_preferences to service_role;
grant select, insert, update on table public.onboarding_responses to service_role;
grant select, insert on table public.member_follows to service_role;
grant select, insert on table public.member_interactions to service_role;
grant select on table public.stripe_customers to service_role;
grant usage, select on sequence public.member_interactions_id_seq to service_role;
grant select, insert, update on table public.catalog_items to service_role;
grant select, insert, update on table public.catalog_interests to service_role;

-- Catalog data remains server-mediated, and operational/billing event tables
-- are outside the repository's Data API surface.
revoke all on table public.profiles from anon;
revoke all on table public.profile_preferences from anon;
revoke all on table public.onboarding_responses from anon;
revoke all on table public.member_follows from anon;
revoke all on table public.member_interactions from anon;
revoke all on table public.stripe_customers from anon;
revoke all on table public.catalog_items from anon;
revoke all on table public.catalog_interests from anon;
revoke all on table public.profiles from authenticated;
revoke all on table public.profile_preferences from authenticated;
revoke all on table public.onboarding_responses from authenticated;
revoke all on table public.member_follows from authenticated;
revoke all on table public.member_interactions from authenticated;
revoke all on table public.stripe_customers from authenticated;
revoke all on table public.catalog_items from authenticated;
revoke all on table public.catalog_interests from authenticated;
revoke all on table public.organizations from service_role;
revoke all on table public.organization_memberships from service_role;
revoke all on table public.stripe_events from service_role;
