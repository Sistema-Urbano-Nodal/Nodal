-- The Founder badge web/pages/fundadores.html promises every Membresía Fundador member: it stays on their profile for
-- as long as they keep their NODAL account, even if they do not renew. profiles.founder_since is when an administrator
-- gave it, null for no badge. NODAL never sees the Mercado Pago payment, so the server sets it only through
-- /api/admin/membership/founders (administrators, after checking the payment), never from a request body; a second
-- grant keeps the first date. Deleting the account deletes the profile row, and the badge with it. Additive: a
-- nullable column with no default, so every existing row reads as no badge, and the code live today (which reads
-- profiles with select=*) is unaffected.
-- No grant or view change: service_role already holds SELECT, INSERT, UPDATE on public.profiles at table level
-- (20260810175241_service_role_data_api_grants.sql), and a table-level privilege covers columns added later; anon and
-- authenticated hold nothing on the table and no policy lets a member update a profile, so no member can set it
-- through the Data API. public_profiles names its columns, so the view does not gain this one.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261023000000_founder_badge.sql`,
-- then `supabase migration repair --status applied 20261023000000`. Never `db push` (history differs).
-- Until it is applied, the badge desk (/api/admin/membership/founders) answers 503, and course posts and the teaching
-- report show no badge (their badge read fails apart, logged). Nothing else reads the column by name.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS founder_since timestamptz;
COMMENT ON COLUMN public.profiles.founder_since IS
 'When an administrator gave the Founder badge (Membresía Fundador). Null: no badge. Set only by an administrator through /api/admin/membership/founders, never from a request body.';
COMMIT;
