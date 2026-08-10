# NODAL Eight-Point Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace abstract and fabricated landing/catalog content with a real trilingual, operator-curated catalog, protected administration, and trackable member interest flows.

**Architecture:** Add a focused catalog domain module behind the existing repository contract, with equivalent SQLite and Supabase adapters. The Node server owns publication, authorization, localization, caching, and interest privacy; plain HTML/CSS/JS clients consume those APIs without fallback demo data.

**Tech Stack:** Node.js 22, `node:sqlite`, Supabase/Postgres/PostgREST, plain HTML/CSS/JavaScript, Node test runner, existing zero-runtime-dependency build.

## Global Constraints

- Preserve the plain HTML/CSS/JS frontend and Node server; introduce no framework, external CMS, email provider, rich-text editor, file upload, or new runtime dependency.
- Publishable visitor content is required in EN, ES, and PT and is stored atomically as translated JSON.
- The exact hero copy is EN “Find the people and opportunities to turn urban knowledge into action.”, ES “Encuentra a las personas y las oportunidades para convertir el conocimiento urbano en acción.”, and PT “Encontre as pessoas e as oportunidades para transformar o conhecimento urbano em ação.”
- Catalog kinds are `opportunity | project | learning_circle | resource | case_study`; opportunity subtypes are `job | consulting | grant | open_call | fellowship | other`.
- Catalog statuses are `draft | published | archived`; visibility is `public | members`; action modes are `external | interest | none`.
- Interest statuses are `new | contacted | closed | withdrawn` and one historical record exists per member/item.
- Title is at most 120 characters, summary 320, body 5,000, CTA 60, message 1,000; at most eight topics of 60 characters each. Content remains plain text.
- Publishing requires all three translations, organization, verified HTTPS source, verification date, valid action configuration, and type-appropriate fields. Drafts may be incomplete.
- Anonymous public payloads never expose editor IDs, member identities, emails, or interest details. Member-directory consent semantics remain unchanged.
- `profiles.app_role` is server-owned `member | admin` in both backends and is never writable through profile APIs.
- Catalog records are never hard-deleted. Account deletion removes interests and nulls administrator audit references; export includes the member’s interests.
- Anonymous catalog reads receive deterministic ETags and short public caching. Authenticated, interest, and admin responses remain `no-store`.
- Members cannot create catalog items. Internal interest is not application management; staff contact members outside NODAL and record only queue status.
- Continue generating `public/` through `scripts/build-static.js`; do not edit generated files directly.
- No fabricated production seeds or fallback catalog records.

---

### Task 1: Catalog domain and dual-backend persistence

**Files:**
- Create: `server/catalog.js`
- Modify: `server/db.js`
- Modify: `server/repository.js`
- Modify: `server/supabase.js`
- Create: `supabase/migrations/*_catalog_and_admin_roles.sql` using `npx supabase migration new catalog_and_admin_roles`
- Create: `tests/catalog.test.js`
- Modify: `tests/supabase.test.js`
- Modify: `tests/deploy.test.js`

**Interfaces:**
- Produces: `validateCatalogDraft(input)`, `validateCatalogPublication(input)`, `localizeCatalogItem(item, lang)`, `encodeCatalogCursor(sortTuple)`, `decodeCatalogCursor(value)`, and `isCatalogItemClosed(item, now)` from `server/catalog.js`.
- Produces repository methods `listCatalogItems(query, viewer)`, `getCatalogItem(id, viewer)`, `createCatalogItem(input, actorId)`, `updateCatalogItem(id, input, version, actorId)`, `upsertCatalogInterest(itemId, userId, message)`, `withdrawCatalogInterest(itemId, userId)`, `listCatalogInterestsForUser(userId, query)`, `listAdminInterests(query)`, and `updateCatalogInterest(id, patch, version, actorId)`.
- Produces adapter export/deletion behavior that includes interests and preserves catalog items with null audit references.

- [ ] **Step 1: Write failing domain tests**

Create literal fixtures in `tests/catalog.test.js` that prove a complete trilingual opportunity publishes, an incomplete draft persists, publication rejects a missing locale/organization/verified HTTPS source/type field/action URL, limits are enforced, invalid JSON/cursors fail closed, localization selects only the requested visitor fields, and closure is derived from deadline/end date.

```js
test('publication rejects an external action without an HTTPS URL', () => {
  const input = completeCatalogInput({ actionMode: 'external', actionUrl: 'http://example.test/apply' });
  assert.throws(() => validateCatalogPublication(input), /HTTPS/);
});
```

- [ ] **Step 2: Run domain tests and observe RED**

Run: `node --test tests/catalog.test.js`

Expected: FAIL because `server/catalog.js` and the new validation/localization functions do not exist.

- [ ] **Step 3: Implement the minimal domain module**

Use explicit allowlists, Unicode-trimmed plain strings, `URL` parsing with `https:` enforcement, stable cursor JSON encoded as base64url, and a single normalized internal record shape. Do not sanitize HTML into another representation; reject/escape at rendering boundaries and persist plain text.

```js
export function localizeCatalogItem(item, lang = 'en') {
  const locale = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
  return { id: item.id, kind: item.kind, ...item.translations[locale] };
}
```

- [ ] **Step 4: Run domain tests and observe GREEN**

Run: `node --test tests/catalog.test.js`

Expected: PASS with no warnings other than Node’s existing SQLite experimental warning.

- [ ] **Step 5: Write failing SQLite persistence tests**

Use a temporary real SQLite database to prove forward migration, create/update optimistic version conflict, deterministic featured/deadline/published/id ordering, cursor continuation without duplicates, anonymous/public versus member visibility, internal interest idempotent reopen/withdraw, admin queue update conflict, export inclusion, deletion cascade, and audit foreign keys set to null.

- [ ] **Step 6: Run SQLite persistence tests and observe RED**

Run: `node --test tests/catalog.test.js`

Expected: FAIL on missing tables/repository functions.

- [ ] **Step 7: Implement SQLite schema and repository methods**

Add a forward-only SQLite migration after the current schema version. Use JSON text columns for translations/topics, `ON DELETE SET NULL` for audit users, `ON DELETE CASCADE` for interests, a unique `(user_id, item_id)` constraint, check constraints for enums, indexes matching list/order/ownership queries, and explicit transaction boundaries for versioned updates.

- [ ] **Step 8: Run SQLite persistence tests and observe GREEN**

Run: `node --test tests/catalog.test.js`

Expected: PASS.

- [ ] **Step 9: Write failing Supabase parity and migration tests**

Extend the existing complete PostgREST fake shape in `tests/supabase.test.js`. Prove Supabase maps `app_role` instead of hardcoding member, sends equivalent catalog filters/order/cursors, performs version-guarded updates, and never places role in profile update payloads. Extend deployment SQL behavior tests for tables, constraints, indexes, grants, RLS, revoked browser access, and service-owned catalog/interest writes.

- [ ] **Step 10: Run Supabase tests and observe RED**

Run: `node --test tests/supabase.test.js tests/deploy.test.js`

Expected: FAIL on missing migration and adapter behavior.

- [ ] **Step 11: Generate and implement the Supabase migration and adapter**

Run `npx supabase migration new catalog_and_admin_roles` from the repository root, then fill only the generated migration. Enable RLS on both catalog tables, revoke `anon`/`authenticated` base-table access, keep catalog and interest reads/writes behind the Node service-role adapter, index all ownership/foreign-key/query columns, and keep `app_role` server-owned. Implement the existing service-role adapter with the same repository surface and normalized return shapes as SQLite.

- [ ] **Step 12: Run persistence/parity tests and observe GREEN**

Run: `node --test tests/catalog.test.js tests/supabase.test.js tests/deploy.test.js`

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add server/catalog.js server/db.js server/repository.js server/supabase.js supabase/migrations tests/catalog.test.js tests/supabase.test.js tests/deploy.test.js
git commit -m "feat: add catalog persistence"
```

### Task 2: Catalog HTTP APIs, authorization, caching, and privacy

**Files:**
- Modify: `server/server.js`
- Modify: `server/repository.js` only if an API-required boundary was omitted in Task 1
- Create: `tests/catalog-api.test.js`
- Modify: `tests/api.test.js`

**Interfaces:**
- Consumes all Task 1 repository methods and catalog localization/validation helpers.
- Produces the public/member/admin HTTP routes named in the approved design.
- Preserves the existing server factory/test harness contract and all existing routes.

- [ ] **Step 1: Write failing public read API tests**

Use the real server with a temporary SQLite repository. Prove query validation, comma-separated kinds, subtype/topic/location/query filters, `limit` cap 24, `state=open|all`, stable cursor pagination, anonymous public filtering, authenticated members-only visibility, localized list/detail shapes, detail `isClosed`, and 404 for invisible/draft records. Assert anonymous ETag/304 and short public cache headers; assert authenticated reads are `no-store` and only they may receive their own interest status.

- [ ] **Step 2: Run public API tests and observe RED**

Run: `node --test tests/catalog-api.test.js`

Expected: FAIL with 404 routes.

- [ ] **Step 3: Implement public catalog reads**

Parse/validate query parameters at the HTTP boundary, pass a viewer descriptor into the repository, localize after authorization, and hash a deterministic serialized response for ETag. Do not resolve or expose profiles for public catalog payloads.

- [ ] **Step 4: Run public API tests and observe GREEN**

Run: `node --test tests/catalog-api.test.js`

Expected: public read tests PASS.

- [ ] **Step 5: Write failing interest API tests**

Prove sign-in is required, external/none/closed items reject internal interest, same-origin is required, message limits are enforced, the write rate limit follows the account, PUT is idempotent and reopens withdrawn rows, DELETE withdraws without deletion, disclosure-relevant returned data contains only the member’s own item/status/message, and `/api/me/catalog-interests` cannot leak another member.

- [ ] **Step 6: Run interest API tests and observe RED**

Run: `node --test tests/catalog-api.test.js`

Expected: interest tests FAIL on missing routes.

- [ ] **Step 7: Implement interest APIs**

Reuse existing same-origin/session/rate-limit helpers. Return stable 400/401/403/404/409/429 errors in the server’s existing safe error envelope. PUT and DELETE responses and all `/api/me` responses use `Cache-Control: no-store`.

- [ ] **Step 8: Run interest API tests and observe GREEN**

Run: `node --test tests/catalog-api.test.js`

Expected: interest tests PASS.

- [ ] **Step 9: Write failing admin and privacy tests**

Prove `/admin.html` and `/api/admin/*` deny anonymous and member sessions server-side, Supabase/SQLite `app_role=admin` grants access, create/update use publication validation, stale versions return 409, archive replaces deletion, feature is server-owned, interest review accepts only valid statuses, profile PATCH cannot write `app_role`, export includes interests, and account deletion removes them while preserving catalog records.

- [ ] **Step 10: Run admin/privacy tests and observe RED**

Run: `node --test tests/catalog-api.test.js tests/api.test.js`

Expected: admin/privacy additions FAIL.

- [ ] **Step 11: Implement admin and privacy routes**

Add `admin.html` to the protected-page decision before static serving. Authorize every admin API independently from page navigation. Pass expected version into versioned writes, return 409 with the current sanitized record, and never implement DELETE for catalog items. Extend export/delete through repository methods rather than raw backend access in the server.

- [ ] **Step 12: Run API suites and observe GREEN**

Run: `node --test tests/catalog-api.test.js tests/api.test.js`

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add server/server.js server/repository.js tests/catalog-api.test.js tests/api.test.js
git commit -m "feat: expose catalog and interest APIs"
```

### Task 3: Public landing and catalog experience

**Files:**
- Modify: `web/pages/index.html`
- Create: `web/pages/opportunities.html`
- Create: `web/scripts/catalog.js`
- Create: `web/styles/catalog.css`
- Modify: `web/scripts/i18n.js`
- Modify: `web/styles/styles.css`
- Create: `tests/catalog-ui.test.js`

**Interfaces:**
- Consumes Task 2 public catalog/detail, auth-state, member interest, and `/api/me/catalog-interests` routes.
- Produces stable DOM IDs/data-i18n keys for the landing featured work/cases and the complete catalog/member-interest UI.

- [ ] **Step 1: Write failing static and client behavior tests**

Test real rendered/client behavior where practical and parse static assets for cross-file contracts. Prove the exact hero copy resolves in EN/ES/PT; section order is hero/actions/open work/cases/problem/how/membership/final CTA; no fixed actor counts, unsourced quotes, generic leader cards, or known hardcoded catalog titles remain; the catalog script has matching DOM targets; every dynamic key resolves in all languages; and empty/error/loading states have translated visible guidance without demo fallback records.

- [ ] **Step 2: Run UI tests and observe RED**

Run: `node --test tests/catalog-ui.test.js`

Expected: FAIL because the new page/script and revised contract do not exist.

- [ ] **Step 3: Implement the landing information architecture**

Reorder `index.html` to the approved sequence. Use the exact hero promise and concrete “you can” verbs. Add three actions for profile, discovery, and acting; API-backed featured open work and verified case-study containers; keep only a visibly labelled illustrative graph without numeric claims or quotes; remove generic leaders and place membership/resources after the concrete catalog proof.

- [ ] **Step 4: Implement the catalog page and visual system**

Create accessible filter controls for all five kinds, query/topic/location, and open/all state; a results region; detail panel driven by `?id=`; external official-link CTA; internal interest disclosure/form; and a signed-in “My interests” view with new/contacted/closed/withdrawn states. Use the existing NODAL palette/type decisions, make the sourced open-work stream the signature element, maintain visible focus, support reduced motion, and verify responsive layouts at 1440×900, 1024×768, and 390×844.

- [ ] **Step 5: Implement API-backed client states**

`catalog.js` must debounce filters, preserve query state, use `AbortController` to prevent stale results, escape all content via DOM text APIs, send same-origin JSON writes, handle 401 with a login redirect carrying a safe local `next`, and never synthesize catalog records when fetches fail or return empty.

- [ ] **Step 6: Add complete translations**

Extend `i18n.js` so every new visible and asynchronous string resolves in EN/ES/PT. Language changes must refresh localized catalog data without losing filters/detail state.

- [ ] **Step 7: Run UI tests and observe GREEN**

Run: `node --test tests/catalog-ui.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/pages/index.html web/pages/opportunities.html web/scripts/catalog.js web/styles/catalog.css web/styles/styles.css web/scripts/i18n.js tests/catalog-ui.test.js
git commit -m "feat: add sourced public catalog experience"
```

### Task 4: Admin workspace, dashboard search, honest recommendations, and deployment boundaries

**Files:**
- Create: `web/pages/admin.html`
- Create: `web/scripts/admin.js`
- Create: `web/styles/admin.css`
- Modify: `web/scripts/dashboard.js`
- Modify: `web/scripts/recs.js`
- Modify: `web/scripts/i18n.js`
- Modify: `scripts/build-static.js`
- Modify: `server/server.js`
- Modify: `vercel.json`
- Modify: `tests/catalog-ui.test.js`
- Modify: `tests/deploy.test.js`
- Modify: `README.md` or the repository’s existing operations documentation if catalog operation needs documenting

**Interfaces:**
- Consumes Task 2 admin APIs and Task 3 translations/catalog rendering conventions.
- Produces protected staff catalog editing and interest review, API-backed dashboard catalog search, and complete asset registration through source serving, generated `public/`, Vercel, and deployment tests.

- [ ] **Step 1: Write failing admin/dashboard/deployment tests**

Prove admin form controls have matching script lookups; all EN/ES/PT translation inputs serialize atomically; preview/publish/archive/feature and interest queue states map to the admin APIs; stale 409 preserves unsaved content and offers reload; dashboard Project/Knowledge/Opportunity searches call `/api/catalog` while People remains `/api/users/search`; `recs.js` has translated honest unauthenticated/loading/empty/error states; and every new page/script/style is present in server allowlists, build copy lists, Vercel cache routes, and deployment regression coverage.

- [ ] **Step 2: Run integration tests and observe RED**

Run: `node --test tests/catalog-ui.test.js tests/deploy.test.js`

Expected: FAIL on missing admin assets and hardcoded dashboard records.

- [ ] **Step 3: Implement the protected admin workspace**

Create English staff chrome with filters, record list, all three locale fields, plain-text preview, source/action/date/topic controls, draft save, publish/archive/feature actions, version display/conflict recovery, and interest review queue. Render values with `textContent`/form values only. Do not add a hard-delete action.

- [ ] **Step 4: Replace dashboard hardcoded catalog entries**

Map Projects to `project`, Knowledge to `learning_circle,resource,case_study`, and Opportunities to `opportunity`. Debounce and abort stale searches, render real localized API results and honest empty/error states, and build record links with `new URLSearchParams({ id: record.id })`. Keep consent-gated People behavior unchanged.

- [ ] **Step 5: Translate recommendation asynchronous states**

Replace English-only strings in `recs.js` with `i18n` keys for unauthenticated, loading, unavailable, empty, and retry states. Never add demo recommendation records.

- [ ] **Step 6: Register and document every deployable asset**

Update source static maps/allowlists, `scripts/build-static.js`, Vercel cache rules, and deploy tests in the same change. Document how an administrator is created, migration commands, publication requirements, and the pre-production requirement for one sourced case, opportunity, project, and learning-circle-or-resource in all three languages. Do not include sample/fabricated production data.

- [ ] **Step 7: Run integration tests and observe GREEN**

Run: `node --test tests/catalog-ui.test.js tests/deploy.test.js`

Expected: PASS.

- [ ] **Step 8: Build generated assets**

Run: `npm run build`

Expected: all tests PASS and `public/` is regenerated with the new source assets.

- [ ] **Step 9: Commit**

```bash
git add web/pages/admin.html web/scripts/admin.js web/styles/admin.css web/scripts/dashboard.js web/scripts/recs.js web/scripts/i18n.js scripts/build-static.js server/server.js vercel.json tests/catalog-ui.test.js tests/deploy.test.js README.md public
git commit -m "feat: add catalog operations workspace"
```

### Task 5: Whole-feature verification and acceptance tooling

**Files:**
- Modify only files needed to fix failures found by the verification gates.
- Add browser/test fixtures only when they exercise real behavior and contain no production catalog seeds.

**Interfaces:**
- Consumes the complete Tasks 1–4 feature.
- Produces fresh automated evidence and a documented list of preview/live gates that cannot be completed without external credentials/content.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS with no failure or unexpected warning.

- [ ] **Step 2: Build from source**

Run: `npm run build`

Expected: PASS and generated `public/` matches source registrations.

- [ ] **Step 3: Run dependency and diff gates**

Run: `npm audit --audit-level=low`

Expected: zero known vulnerabilities at the configured threshold.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Validate Supabase migrations locally or against an explicitly configured preview**

Run `npx supabase db reset` when the local Docker stack is available, followed by the catalog API smoke against Supabase. If preview credentials/Docker are unavailable, record this as an unproven external gate rather than claiming parity from mocked tests.

- [ ] **Step 5: Run role/language/responsive browser acceptance**

Exercise anonymous, member, and admin flows at 1440×900, 1024×768, and 390×844 in EN/ES/PT, covering populated, empty, expired, unavailable, external-action, internal-interest, conflict, and withdrawn states. Use temporary test-only records through the admin API and remove/archive them afterward; do not ship seeds.

- [ ] **Step 6: Verify absence of fabricated proof**

Inspect generated production HTML/JS and confirm there are no fixed catalog titles, actor counts, unsourced quotes, generic leader cards, or fallback demo records. Confirm the landing API containers render an honest empty state when no content is published.

- [ ] **Step 7: Commit verification fixes if any**

```bash
git add -u
git commit -m "test: complete catalog acceptance gates"
```

Do not mark preview Supabase, Vercel preview, production same-SHA, or staff-content publication accepted unless those external actions were actually performed and observed.
