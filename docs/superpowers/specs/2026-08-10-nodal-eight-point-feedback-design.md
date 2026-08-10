# NODAL Eight-Point Feedback Design

## Objective

Turn the eight validated feedback points into a real, trilingual visitor and member experience without fabricated proof or client-only catalog records. NODAL will lead with the concrete promise “Find the people and opportunities to turn urban knowledge into action,” then let visitors browse verified opportunities, projects, learning circles, resources, and case studies backed by the same SQLite/Supabase data model.

## Experience

The landing page order is hero, three concrete actions, featured open work, verified case studies, the problem and how NODAL works, membership/resources, and the final call to action. The existing visual language remains recognizable; the signature interaction is a sourced “open work” stream that moves the page from abstract network language to things a person can act on now.

The hero promise is fixed in all visitor languages:

- EN: “Find the people and opportunities to turn urban knowledge into action.”
- ES: “Encuentra a las personas y las oportunidades para convertir el conocimiento urbano en acción.”
- PT: “Encontre as pessoas e as oportunidades para transformar o conhecimento urbano em ação.”

`/opportunities.html` is the canonical catalog surface. It supports filtering and `?id=` permalink details. External actions use the verified official HTTPS URL. Internal actions require a session and disclose that NODAL staff receive the member’s name, email, and message. Members can see and withdraw their own interests. Honest translated empty and error states replace demo fallbacks.

The landing role graph may remain only as a clearly labelled illustration. Fixed actor counts, unsourced quotes, generic leader cards, and hardcoded catalog results are removed. Featured public content and cases come only from published catalog records.

## Data and editorial model

`catalog_items` stores operator-curated records with kind, optional opportunity subtype, draft/published/archived status, public/members visibility, EN/ES/PT translated JSON, organization, location, topics, dates, verified source metadata, action configuration, featured state, optimistic version, and creator/editor/publisher audit fields. There are no production demo seeds.

`catalog_interests` stores one historical record per member and item. A PUT creates or reopens it, DELETE marks it withdrawn, and staff may move it through new, contacted, closed, or withdrawn. A member sees only their own interest; public catalog payloads never include identities, emails, editor IDs, or aggregate interest data.

Drafts may be incomplete. Publishing validates every required field atomically: all three translations; organization; a verified HTTPS source and date; a valid action mode; and type-appropriate fields. Content is plain text with fixed limits: title 120, summary 320, body 5,000, CTA 60, interest message 1,000, and at most eight topics of 60 characters each.

SQLite and Supabase implement the same repository contract. Supabase gains the server-owned `profiles.app_role` field so admin authorization matches SQLite. The field is not accepted by profile writes. Public catalog records remain separate from directory consent. Account export includes interests; account deletion removes interests while catalog audit references become null.

## HTTP contract

- `GET /api/catalog` accepts `lang`, comma-separated `kind`, `subtype`, `q`, `topic`, `location`, `featured`, `state=open|all`, `cursor`, and `limit` capped at 24. Anonymous callers receive published/public records; authenticated callers can also receive published/member records. Ordering is featured first, nearest deadline, newest publication, then stable ID.
- `GET /api/catalog/:id?lang=en` returns a localized record, derived `isClosed`, and the current member’s interest status only when authenticated.
- `GET /api/me/catalog-interests?lang=en` returns the signed-in member’s records and statuses.
- `PUT /api/catalog/:id/interest` idempotently creates or reopens internal interest. It is authenticated, same-origin protected, validated, and rate-limited.
- `DELETE /api/catalog/:id/interest` marks interest withdrawn without deleting history.
- Admin-only routes are `GET|POST /api/admin/catalog`, `PATCH /api/admin/catalog/:id`, `GET /api/admin/interests`, and `PATCH /api/admin/interests/:id`. PATCH requires the current version and returns 409 when stale.

Anonymous catalog reads receive deterministic ETags and short public caching. Authenticated, interest, and admin responses remain `no-store`.

## Administration

`/admin.html` is protected by server authorization rather than hidden navigation alone. Its English interface provides catalog filtering; EN/ES/PT record editing and preview; publish, archive, and feature controls; stale-version recovery; and the interest review queue. Catalog records are never hard-deleted.

## Safety and verification

Supabase tables use RLS and explicit grants, with writes restricted to the server/service path and user-owned interest reads protected. Admin permission is derived from server-owned profile state, never user-editable metadata. Text and URLs are normalized and validated at the server boundary.

Automated tests cover publication validation, localization, filters, pagination, visibility, closure, HTTPS enforcement, optimistic conflicts, caching, authorization, same-origin protection, rate limits, export/deletion, adapter parity, translations, and every serving/build boundary. The release gates are `npm test`, `npm run build`, `npm audit --audit-level=low`, and `git diff --check`, followed by a real preview Supabase migration smoke and role-based browser acceptance. Live production acceptance remains a separate gate and requires staff-supplied sourced records in all three languages.

## Boundaries

The frontend stays plain HTML/CSS/JS and the backend stays the existing Node server with no new runtime dependency, framework, CMS, email provider, rich-text editor, upload flow, or application management system. Members cannot create catalog items. Staff contacts interested members outside NODAL and records only queue status. Existing directory, recommendations, billing, consent, and privacy behavior remains unchanged except for adding interests to export and deletion.
