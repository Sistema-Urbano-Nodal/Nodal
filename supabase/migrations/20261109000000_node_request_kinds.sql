-- Sponsorship requests (spec: docs/superpowers/specs/2026-11-09-sponsored-memberships-design.md, "Storage").
-- The landing page's "Para organizaciones NODAL" form now asks whether the organisation wants to activate a Nodo or to
-- sponsor memberships for a community. node_requests gains the request's kind ('node' or 'sponsorship', every existing
-- row becomes 'node'), the community a sponsor wants to support (1-200 characters) and roughly how many memberships
-- ('1-10', '11-25', '26-50', '50+' or 'unsure'); both are NULL on a Nodo request, and a check ties them to the kind.
-- An index serves the desk's kind filter. Additive: no grant, policy or trigger changes (the updated_at trigger stays on
-- status and version), and the code live before this release inserts no kind, so its rows get the 'node' default.
-- Apply it BEFORE pushing `main` (Vercel deploys on push), with
-- `npx --no-install supabase db query --linked -f supabase/migrations/20261109000000_node_request_kinds.sql`,
-- then `npx --no-install supabase migration repair --status applied 20261109000000`. Never `db push` (history differs).
-- Until it is applied, the deployed code fails on Supabase: every POST /api/node-requests answers 503 (nothing stored,
-- nothing sent) and the desk's organisations band fails to load.
BEGIN;

ALTER TABLE public.node_requests
 ADD COLUMN kind text NOT NULL DEFAULT 'node' CHECK(kind IN ('node','sponsorship')),
 ADD COLUMN community text,
 ADD COLUMN memberships text,
 -- IS NOT NULL is spelled out: a CHECK that comes out NULL passes, and NULL IN (...) is NULL.
 ADD CONSTRAINT node_requests_kind_fields CHECK((kind='node' AND community IS NULL AND memberships IS NULL) OR
  (kind='sponsorship' AND community IS NOT NULL AND memberships IS NOT NULL AND char_length(community) BETWEEN 1 AND 200
   AND memberships IN ('1-10','11-25','26-50','50+','unsure')));
-- The desk list filtered by kind, newest first.
CREATE INDEX node_requests_kind ON public.node_requests(kind,created_at DESC,id DESC);
COMMIT;
