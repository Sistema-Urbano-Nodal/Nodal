-- Organisation node requests (spec: docs/superpowers/specs/2026-11-03-organisation-node-requests-design.md).
-- One row per request sent through the landing page's "Para organizaciones NODAL" form, with or without an account:
-- name, organisation, email, optional phone, message and language, the desk's status, and how the team email ended.
-- Not tied to any account (updated_by only names the administrator who last changed it). Server-only: RLS on, no
-- client policies, browser roles hold nothing, and the server keeps only what server/node-requests-repository.js uses.
-- Closed requests are deleted 12 months after their updated_at by the server's lazy purge. Additive.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261103000000_node_requests.sql`,
-- then `supabase migration repair --status applied 20261103000000`. Never `db push` (history differs).
-- Until it is applied, the deployed code fails on Supabase in two places only: POST /api/node-requests and the desk's
-- Nodos band. Nothing else reads the table.
BEGIN;

CREATE TABLE public.node_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
 organization text NOT NULL CHECK(char_length(organization) BETWEEN 1 AND 160),
 email text NOT NULL CHECK(char_length(email)<=254),
 phone text CHECK(phone IS NULL OR char_length(phone)<=40),
 message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 1000),
 language text NOT NULL CHECK(language IN ('es','en','pt')),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
 -- NULL until the team email attempt ends.
 email_status text CHECK(email_status IS NULL OR email_status IN ('sent','partial','failed','uncertain','off')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
-- The desk list, newest first, and the same list filtered by status.
CREATE INDEX node_requests_recent ON public.node_requests(created_at DESC,id DESC);
CREATE INDEX node_requests_status ON public.node_requests(status,created_at DESC,id DESC);
-- Account erasure sets updated_by to NULL without scanning the table.
CREATE INDEX node_requests_updated_by ON public.node_requests(updated_by);
CREATE TRIGGER node_requests_updated_at BEFORE UPDATE ON public.node_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.node_requests ENABLE ROW LEVEL SECURITY;
-- service_role too: Supabase's default privileges give it everything on a new table, and it keeps only these four.
REVOKE ALL ON TABLE public.node_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.node_requests TO service_role;
COMMIT;
