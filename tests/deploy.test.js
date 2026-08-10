import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

test('Vercel serves generated frontend assets before the Node serverless adapter', () => {
  const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const staticBuild = readFileSync(path.join(ROOT, 'scripts', 'build-static.js'), 'utf8');
  assert.equal(vercel.framework, null);
  assert.equal(vercel.outputDirectory, 'public');
  assert.ok(readdirSync(path.join(ROOT, vercel.outputDirectory)).length > 0);
  assert.match(packageJson.scripts.build, /scripts\/build-static\.js/);
  assert.match(packageJson.scripts.migrate, /scripts\/migrate\.js/);
  assert.match(packageJson.scripts['seed:dev'], /scripts\/seed-dev\.js/);
  assert.match(staticBuild, /assets/);
  assert.match(staticBuild, /styles\.css/);
  assert.match(staticBuild, /dashboard\.js/);
  assert.ok(!('runtime' in vercel.functions['api/index.js']), 'Node runtime should be configured through package.json engines, not functions.runtime');
  assert.equal(typeof vercel.functions['api/index.js'].includeFiles, 'string');
  assert.equal(vercel.functions['api/index.js'].includeFiles, 'web/pages/**');
  assert.ok(!vercel.functions['api/index.js'].includeFiles.includes('tests/**'));
  assert.ok(!vercel.functions['api/index.js'].includeFiles.includes('scripts/**'));
  assert.ok(vercel.rewrites.some((route) => route.source === '/' && route.destination === '/api/index.js'));
  assert.ok(vercel.rewrites.some((route) => route.source === '/:path*' && route.destination === '/api/index.js'));
  assert.ok(vercel.headers.some((route) => route.source === '/assets/(.*)'));
  assert.ok(vercel.headers.some((route) => route.source.endsWith('.js')));
  assert.ok(vercel.headers.some((route) => route.source.endsWith('.css')));
});

test('repository layout separates deployable code, source assets, operations, and tests', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const deployment = readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');

  for (const directory of [
    'api',
    'docs',
    'scripts',
    'server',
    'supabase',
    'tests',
    'web/assets/optimized',
    'web/assets/source',
    'web/pages',
    'web/scripts',
    'web/styles',
  ]) {
    assert.ok(existsSync(path.join(ROOT, directory)), `expected ${directory}`);
  }

  for (const formerRootFile of [
    'index.html',
    'dashboard.html',
    'app.js',
    'dashboard.js',
    'styles.css',
  ]) {
    assert.equal(existsSync(path.join(ROOT, formerRootFile)), false, `${formerRootFile} belongs under web/`);
  }

  assert.match(packageJson.scripts.test, /tests\/\*\.test\.js/);
  assert.match(readme, /## Repository Layout/);
  assert.match(readme, /`web\/pages\/`/);
  assert.match(deployment, /generated `public\/` assets/);
});

test('Supabase migration creates required tables with RLS policies and indexes', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const migrationName = readdirSync(dir).find((name) => name.endsWith('_production_core.sql'));
  assert.ok(migrationName, 'expected production Supabase migration');
  const sql = readFileSync(path.join(dir, migrationName), 'utf8');

  for (const table of [
    'profiles',
    'profile_preferences',
    'onboarding_responses',
    'organizations',
    'organization_memberships',
    'stripe_customers',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'));
  }

  for (const policy of [
    'profiles_select_own',
    'profile_preferences_select_own',
    'onboarding_responses_select_own',
    'stripe_customers_select_own',
  ]) {
    assert.match(sql, new RegExp(`create policy "${policy}"`, 'i'));
  }

  for (const index of [
    'profile_preferences_user_id_idx',
    'onboarding_responses_user_id_idx',
    'organization_memberships_organization_id_idx',
    'organization_memberships_user_id_idx',
    'stripe_customers_user_id_idx',
    'stripe_customers_stripe_customer_id_idx',
  ]) {
    assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'));
  }

  for (const serverOwnedPolicy of [
    'profiles_insert_own',
    'profiles_update_own',
    'profile_preferences_insert_own',
    'profile_preferences_update_own',
    'onboarding_responses_insert_own',
    'onboarding_responses_update_own',
  ]) {
    assert.doesNotMatch(sql, new RegExp(`create policy "${serverOwnedPolicy}"`, 'i'));
  }

  assert.match(sql, /profile_preferences_directory_public_boolean/i);
  assert.match(sql, /jsonb_typeof\s*\(\s*data_consent\s*->\s*'directoryPublic'\s*\)\s*=\s*'boolean'/i);
  assert.doesNotMatch(sql, /directoryPublic'\)\s*::\s*boolean/i);
  assert.match(sql, /stripe_latest_event_rank\s+integer\s+not null\s+default\s+0/i);
  assert.match(sql, /stripe_latest_event_id\s+text\s+not null\s+default\s+''/i);
  assert.match(sql, /create or replace function public\.apply_stripe_event\b/i);
  assert.match(sql, /on conflict\s*\(user_id\)\s*do update/i);

  assert.doesNotMatch(sql, /credit_card|card_number|cvc|stripe_secret/i);
});

test('Supabase advisor hardening keeps public data invoker-scoped and server ledgers private', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = readdirSync(dir)
    .sort()
    .map((name) => readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');

  assert.match(sql, /create or replace view public\.public_profiles\s+with\s*\(security_invoker\s*=\s*true\)/i);
  assert.match(sql, /alter function public\.set_updated_at\(\)\s+set search_path\s*=\s*public,\s*pg_temp/i);
  assert.match(sql, /create policy "stripe_events_deny_client"/i);
  assert.match(sql, /on public\.stripe_events\s+for all\s+to anon, authenticated\s+using \(false\)\s+with check \(false\)/i);
  assert.match(sql, /create index if not exists member_follows_target_user_id_idx\s+on public\.member_follows\s*\(target_user_id\)/i);
  for (const policy of [
    'profiles_select_own',
    'profile_preferences_select_own',
    'onboarding_responses_select_own',
    'organization_memberships_select_own',
    'organizations_select_member',
    'stripe_customers_select_own',
    'member_follows_select_participant',
    'member_interactions_select_own',
  ]) {
    assert.match(sql, new RegExp(`create policy "${policy}"[\\s\\S]*?\\(select auth\\.uid\\(\\)\\)`,'i'));
  }
});

test('catalog migration keeps catalog and interest data behind the server service role', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const migrationName = readdirSync(dir).find((name) => name.endsWith('_catalog_and_admin_roles.sql'));
  assert.ok(migrationName, 'expected generated catalog migration');
  const sql = readFileSync(path.join(dir, migrationName), 'utf8');
  for (const table of ['catalog_items', 'catalog_interests']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
  }
  for (const index of [
    'catalog_items_listing_idx', 'catalog_items_created_by_idx', 'catalog_items_updated_by_idx', 'catalog_items_published_by_idx',
    'catalog_interests_item_id_idx', 'catalog_interests_user_id_idx', 'catalog_interests_queue_idx', 'catalog_interests_updated_by_idx',
  ]) assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'));
  assert.match(sql, /unique\s*\(\s*user_id\s*,\s*item_id\s*\)/i);
  assert.match(sql, /references public\.profiles\(id\) on delete set null/i);
  assert.match(sql, /references public\.profiles\(id\) on delete cascade/i);
  assert.match(sql, /alter table public\.profiles\s+add column if not exists app_role text not null default 'member'/i);
  assert.match(sql, /check \(app_role in \('member', 'admin'\)\)/i);
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete|all)\s+on\s+(table\s+)?public\.(catalog_items|catalog_interests)\s+to\s+(anon|authenticated)/i);
});

test('CI uses immutable action revisions and supports pre-main validation refs', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.doesNotMatch(workflow, /uses:\s+actions\/(checkout|setup-node)@v\d+/);
  assert.match(workflow, /release-validation-\*/);
  assert.match(workflow, /npm audit --audit-level=low/);
});

test('release tree excludes internal process artifacts and unused integration placeholders', () => {
  const publicDocs = [
    readFileSync(path.join(ROOT, '.env.example'), 'utf8'),
    readFileSync(path.join(ROOT, 'README.md'), 'utf8'),
    readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(publicDocs, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(publicDocs, /LINKEDIN_CLIENT_(ID|SECRET)/);
});

/* A page and the script that drives it are edited independently, and a removed
   element leaves no trace in the JS. Deleting one <p> in 15916ec took the whole
   globe detail panel down, because its guard demanded an element that no longer
   existed and showPlace() became a silent no-op. */
test('every element a script looks up exists on a page that loads the script', () => {
  const pagesDir = path.join(ROOT, 'web', 'pages');
  const idsOnPage = new Map();
  const pagesForScript = new Map();
  for (const page of readdirSync(pagesDir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(path.join(pagesDir, page), 'utf8');
    idsOnPage.set(page, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
    for (const m of html.matchAll(/<script[^>]+src="([^"?]+)/g)) {
      const script = m[1].replace(/^\.?\//, '');
      if (!pagesForScript.has(script)) pagesForScript.set(script, []);
      pagesForScript.get(script).push(page);
    }
  }
  assert.ok(pagesForScript.size >= 10, 'expected every page to declare its scripts');

  const dangling = [];
  for (const [script, pages] of pagesForScript) {
    const js = readFileSync(path.join(ROOT, 'web', 'scripts', script), 'utf8');
    const referenced = new Set([
      ...[...js.matchAll(/getElementById\(\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...js.matchAll(/\bbyId\(\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...js.matchAll(/querySelector\(\s*'#([A-Za-z0-9_-]+)'/g)].map((m) => m[1]),
    ]);
    for (const id of referenced) {
      if (!pages.some((page) => idsOnPage.get(page).has(id))) dangling.push(`${script} -> #${id}`);
    }
  }
  assert.deepEqual(dangling, [], `scripts reference ids no page they load on defines:\n${dangling.join('\n')}`);
});

test('every translation key a script asks for resolves in all three languages', () => {
  const src = readFileSync(path.join(ROOT, 'web', 'scripts', 'i18n.js'), 'utf8');
  const dictionary = (name) => {
    const start = src.indexOf(`const ${name} = {`);
    assert.notEqual(start, -1, `${name} dictionary is missing`);
    let depth = 0;
    let end = start;
    for (let i = src.indexOf('{', start); i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (!depth) { end = i; break; } }
    }
    const body = src.slice(start, end + 1);
    return new Set([
      ...[...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]),
      ...[...body.matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]),
    ]);
  };
  // English is DASH_EN plus whatever the pages carry in data-i18n
  const english = dictionary('DASH_EN');
  for (const page of readdirSync(path.join(ROOT, 'web', 'pages')).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(path.join(ROOT, 'web', 'pages', page), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) english.add(m[1]);
  }
  const spanish = new Set([...dictionary('ES'), ...dictionary('DASH_ES')]);
  const portuguese = new Set([...dictionary('PT'), ...dictionary('DASH_PT')]);

  const missing = [];
  for (const file of readdirSync(path.join(ROOT, 'web', 'scripts')).filter((f) => f.endsWith('.js'))) {
    const js = readFileSync(path.join(ROOT, 'web', 'scripts', file), 'utf8');
    for (const m of js.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = m[1];
      // a key absent from English renders as the raw key; the others fall back
      if (!english.has(key)) missing.push(`${file}: '${key}' has no English text`);
      if (!spanish.has(key)) missing.push(`${file}: '${key}' is missing from Spanish`);
      if (!portuguese.has(key)) missing.push(`${file}: '${key}' is missing from Portuguese`);
    }
  }
  assert.deepEqual(missing, [], `untranslated keys:\n${missing.join('\n')}`);
});

test('the committed coastline carries islands, lakes and usable precision', () => {
  const source = readFileSync(path.join(ROOT, 'web', 'scripts', 'coastline.js'), 'utf8');
  const match = source.match(/window\.NODAL_COASTLINE = '([^']*)'/);
  assert.ok(match, 'coastline.js must assign a single quoted string');
  const polygons = match[1].split(';').filter(Boolean);

  assert.ok(polygons.length > 600, `expected the finer set to keep far more land, got ${polygons.length}`);
  assert.ok(polygons.some((p) => p.includes('|')), 'at least one polygon must carry a lake as an interior ring');

  const coords = match[1].split(/[;| ]/).filter(Boolean);
  assert.ok(coords.every((pair) => /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/.test(pair)),
    'every point is lon,lat with at most 2 decimals');
  // 1 decimal is an 11km grid — coarser than the 0.08 tolerance, which would
  // round the finer simplification straight back off
  assert.ok(coords.some((pair) => /\.\d{2},|,-?\d+\.\d{2}/.test(pair)),
    'coordinates must actually use the second decimal');

  for (const polygon of polygons) {
    for (const ring of polygon.split('|')) {
      assert.ok(ring.split(' ').length >= 4, 'every ring keeps at least 4 points');
    }
  }
});

/* A new client script has to be listed in four places or it 404s in
   production while working perfectly in dev. Nothing caught that before. */
test('every script a page loads is registered everywhere it must be', () => {
  const serverSource = readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const buildSource = readFileSync(path.join(ROOT, 'scripts', 'build-static.js'), 'utf8');
  const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const scriptHeader = vercel.headers.find((h) => h.source.endsWith('.js'));
  assert.ok(scriptHeader, 'vercel.json must set caching headers for scripts');

  const allowList = serverSource.slice(
    serverSource.indexOf('const STATIC_SCRIPTS'),
    serverSource.indexOf('const STATIC_STYLES'),
  );

  const loaded = new Set();
  for (const page of readdirSync(path.join(ROOT, 'web', 'pages')).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(path.join(ROOT, 'web', 'pages', page), 'utf8');
    for (const m of html.matchAll(/<script[^>]+src="([^"?]+)/g)) loaded.add(m[1].replace(/^\.?\//, ''));
  }
  assert.ok(loaded.size >= 11);

  const missing = [];
  for (const script of loaded) {
    if (!allowList.includes(`'${script}'`)) missing.push(`${script}: server.js STATIC_SCRIPTS`);
    if (!buildSource.includes(`'${script}'`)) missing.push(`${script}: build-static.js`);
    if (!new RegExp(scriptHeader.source).test(`/${script}`)) missing.push(`${script}: vercel.json headers`);
  }
  assert.deepEqual(missing, [], `scripts missing from a registration list:\n${missing.join('\n')}`);
});
