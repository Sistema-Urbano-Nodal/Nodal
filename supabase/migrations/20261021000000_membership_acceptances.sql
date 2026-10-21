-- Nodal Fundadores 2027 purchase acceptances (spec: docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md).
-- One row per acceptance a member gives before they are sent to Mercado Pago: the account's email and name at that
-- moment, the option and its amount, the terms version and the three authorizations. It is contract evidence, so
-- erasing the account only clears user_id (the profile's foreign key) and keeps the rest. Server-only: RLS on, no
-- client policies, browser roles hold nothing, and the server may only insert and read. Additive.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261021000000_membership_acceptances.sql`,
-- then `supabase migration repair --status applied 20261021000000`. Never `db push` (history differs).
-- Until it is applied, the deployed code fails on Supabase: every POST /api/membership/acceptances answers 503 (no
-- Mercado Pago link goes out), every member's data download (GET /api/me/export) fails, and so does the team's CSV
-- (GET /api/admin/membership/acceptances).
BEGIN;

CREATE TABLE public.membership_acceptances (
 id uuid PRIMARY KEY,
 user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 email text NOT NULL,
 full_name text NOT NULL,
 option text NOT NULL CHECK(option IN ('once','installments')),
 terms_version text NOT NULL,
 amount_text text NOT NULL,
 authorizations jsonb NOT NULL CHECK(jsonb_typeof(authorizations)='object'),
 accepted_at timestamptz NOT NULL
);
CREATE INDEX membership_acceptances_user ON public.membership_acceptances(user_id);
CREATE INDEX membership_acceptances_accepted ON public.membership_acceptances(accepted_at DESC);

ALTER TABLE public.membership_acceptances ENABLE ROW LEVEL SECURITY;
-- service_role too: Supabase's default privileges give it everything on a new table, and it keeps only these two.
REVOKE ALL ON TABLE public.membership_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.membership_acceptances TO service_role;
COMMIT;
