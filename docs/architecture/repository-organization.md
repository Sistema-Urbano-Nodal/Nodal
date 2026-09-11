# Repository Organization

## Objective

Organize the NODAL repository by responsibility without changing the website's public URLs, API contracts, authentication behavior, database schema, visual presentation, or deployment model.

The reorganization must remain a structural change. Existing functionality and production data are out of scope.

## Compatibility Contract

The following behavior must remain unchanged:

- Public pages continue to use their current URLs, including `/`, `/index.html`, `/login.html`, `/dashboard.html`, `/profile.html`, and `/payments.html`.
- Browser assets continue to use root-level public URLs such as `/styles.css`, `/dashboard.js`, and `/assets/nodal-wordmark.webp`.
- All `/api/*` routes retain their current methods, request shapes, response shapes, cookies, and authorization rules.
- Unauthenticated requests to private pages continue to redirect to `/login.html` with a safe `next` parameter.
- Supabase migrations remain in their existing order and are not rewritten.
- Vercel continues to serve browser assets from its static filesystem before forwarding page and API requests to the Node adapter.
- SQLite remains the local development and automated-test fallback.

## Target Layout

```text
.
|-- .github/workflows/       CI configuration
|-- api/                     Vercel serverless adapter
|-- docs/architecture/       Maintainer-facing architecture documentation
|-- scripts/                 Build, migration, and development utilities
|-- server/                  Production backend runtime modules
|-- supabase/migrations/     Ordered database migrations
|-- tests/                   Automated test suite
|-- web/
|   |-- assets/
|   |   |-- optimized/       Production WebP assets
|   |   `-- source/          Original editable artwork
|   |-- pages/               HTML source pages
|   |-- scripts/             Browser JavaScript
|   `-- styles/              Browser stylesheets
|-- public/                  Ignored generated Vercel static output
|-- .env.example             Safe environment variable template
|-- .gitignore               Secret, build, and local-data exclusions
|-- DEPLOYMENT.md            Production setup checklist
|-- README.md                Project overview and contributor entry point
|-- package.json             Node commands and runtime metadata
`-- vercel.json              Vercel routing, headers, and function settings
```

Root-level files are limited to conventional repository entry points and platform configuration. Generated files remain ignored and are never treated as source.

## Source And Runtime Mapping

The source layout is independent from the public URL layout.

| Public request | Source location | Production delivery |
| --- | --- | --- |
| `/` or `/index.html` | `web/pages/index.html` | Node adapter |
| `/login.html` | `web/pages/login.html` | Node adapter |
| `/dashboard.html` | `web/pages/dashboard.html` | Authenticated Node adapter |
| `/profile.html` | `web/pages/profile.html` | Authenticated Node adapter |
| `/payments.html` | `web/pages/payments.html` | Authenticated Node adapter |
| `/*.css` | `web/styles/` | Vercel static filesystem |
| `/*.js` | `web/scripts/` | Vercel static filesystem |
| `/assets/*.webp` | `web/assets/optimized/` | Vercel static filesystem |

`scripts/build-static.js` rebuilds `public/` from the browser scripts, styles, optimized images, and local fonts. Only `opportunities.html` is copied as static HTML; the other pages stay on the Node server for authorization, recovery redirects, and runtime configuration. Source files are validated before removing old output, and `.gitkeep` is preserved. Generated documents belong in the ignored `output/` directory.

For local development, the Node static handler resolves requests through an explicit allowlist that mirrors the table above. It does not expose arbitrary repository paths.

## Backend And Operational Boundaries

`server/` contains only modules required by the running application. Build and maintenance commands move to `scripts/`:

- `scripts/build-static.js`
- `scripts/migrate.js`
- `scripts/seed-dev.js`

The test suite moves to `tests/`, with imports updated to reference runtime modules under `server/`. Vercel function packaging therefore excludes tests and operational utilities.

## Asset Policy

Original artwork and production assets have different ownership:

- `web/assets/source/` keeps original PNG files for future editing.
- `web/assets/optimized/` keeps the WebP files referenced by the website.
- The production build copies only optimized assets.
- HTML continues to reference `/assets/<name>.webp`; source-directory names never appear in public URLs.

## Security Requirements

- `.env`, `.env.local`, `.env.production`, `.vercel/`, `data/`, and generated `public/` files remain ignored.
- Requests for `/server/*`, `/scripts/*`, `/tests/*`, `/web/*`, `/docs/*`, `/supabase/*`, package metadata, or dotfiles return `404`.
- The Vercel function includes only runtime server modules and HTML page sources that cannot be served statically.
- Service-role credentials remain server-only and no environment variable naming changes are introduced.
- Existing CSP, HSTS, cookie, CSRF, input-validation, RLS, and Stripe-signature behavior remains unchanged.

## Migration Sequence

1. Move tests to `tests/` and update test imports and the `npm test` command.
2. Move build and maintenance entry points to `scripts/` and update package commands.
3. Move browser files into `web/pages`, `web/scripts`, `web/styles`, and the two asset directories.
4. Replace root-based static lookup with the explicit source map while preserving public request paths.
5. Update Vercel includes and the static build script for the new source locations.
6. Update README and deployment documentation to describe the source layout without changing operational commands.

Each stage must leave the full automated suite passing before the next stage begins.

## Verification

The reorganization is complete only after all of the following pass:

- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `git diff --check`
- Production-mode `vercel build --prod`
- Local HTTP checks for every public page, asset family, API health route, protected-page redirect, and blocked source path
- Browser screenshots at desktop and mobile widths with no visual differences caused by missing assets or styles
- Browser network verification showing static files served without serverless asset invocations
- A Vercel preview deployment before production promotion
- Production health, authentication redirect, cache-header, sensitive-path, and runtime-error checks after merge

## Rollback

The work is performed on a dedicated branch. The production deployment remains on the current main commit until the branch passes all verification. If preview verification fails, the branch is corrected or abandoned without changing production. If a post-merge regression appears, Vercel can immediately restore the previous production deployment while the Git commit is reverted normally.
