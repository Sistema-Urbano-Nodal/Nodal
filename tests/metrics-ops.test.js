import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the baseline is one read-only query that needs no migration', () => {
  const sql = read('docs/ops/2026-11-14-metrics-baseline.sql').replace(/--[^\n]*/g, '');
  assert.equal(sql.split(';').filter(s => s.trim()).length, 1);
  assert.match(sql.trim(), /^select\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
  assert.doesNotMatch(sql, /metrics_account_days|metrics_member_days|metrics_readings|visit_counts/);
  for (const column of ['lima_day', 'accounts', 'confirmed', 'basic_profile', 'interests_not_null', 'with_interests', 'survey_n', 'active_30d', 'active_membership_7d', 'countries']) {
    assert.match(sql, new RegExp(`\\bas ${column}\\b`, 'i'));
  }
});

const MIGRATION = 'supabase/migrations/20261114010000_metrics.sql';
const oneLine = text => text.replace(/\s+/g, ' ');

test('the metrics migration is one transaction, server-only and documented', () => {
  const text = read(MIGRATION);
  const begin = text.indexOf('BEGIN;');
  assert.ok(begin > 0, 'a header, then BEGIN;');
  const header = oneLine(text.slice(0, begin).replace(/^--/gm, ''));
  assert.ok(header.includes('npx --no-install supabase db query --linked -f supabase/migrations/20261114010000_metrics.sql'));
  assert.ok(header.includes('npx --no-install supabase migration repair --status applied 20261114010000'));
  assert.ok(header.includes('Never `db push`'));
  assert.ok(header.includes('BEFORE pushing `main`'));
  assert.ok(header.includes('"Aún no está activado en la base de datos" in the affected blocks and saves no reading'), header);

  const body = text.slice(begin).replace(/--[^\n]*/g, '');
  assert.match(body, /^BEGIN;/);
  assert.match(body.trimEnd(), /COMMIT;$/);
  const flat = oneLine(body);
  assert.equal(flat.match(/SECURITY DEFINER/g)?.length, 1);
  assert.ok(flat.includes("CREATE FUNCTION public.metrics_account_days() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''"));
  assert.ok(flat.includes("CREATE FUNCTION public.metrics_member_days(p_today date) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''"));
  assert.ok(flat.includes("CREATE TABLE public.metrics_readings (day date PRIMARY KEY, taken_at timestamptz NOT NULL, defs smallint NOT NULL, figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'object'))"));
  assert.ok(flat.includes('ALTER TABLE public.metrics_readings ENABLE ROW LEVEL SECURITY'));
  assert.doesNotMatch(flat, /CREATE POLICY/i);

  // auth.users is read by metrics_account_days alone: only between that function's $$ markers.
  const start = body.indexOf('CREATE FUNCTION public.metrics_account_days()');
  const open = body.indexOf('$$', start);
  const close = body.indexOf('$$', open + 2);
  assert.ok(start > 0 && open > start && close > open);
  assert.match(body.slice(open, close), /auth\.users/);
  assert.doesNotMatch(body.slice(0, open) + body.slice(close + 2), /auth\.users/);

  const grants = body.split(';').map(oneLine).map(s => s.trim()).filter(s => /^GRANT\b/i.test(s));
  assert.ok(grants.includes('GRANT SELECT, INSERT ON public.metrics_readings TO service_role'), grants.join('\n'));
  assert.ok(!grants.some(s => /metrics_readings/.test(s) && /\b(UPDATE|DELETE|TRUNCATE)\b/i.test(s)), 'no UPDATE, DELETE or TRUNCATE on the readings');
  assert.ok(!grants.some(s => /\b(profiles|profile_preferences|onboarding_responses)\b/.test(s)), 'no grant on the profile tables');
  assert.doesNotMatch(flat, /RETURNS TABLE/i);
  const functions = [...flat.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\(([^)]*)\)/gi)];
  assert.equal(functions.length, 2);
  for (const [, name, params] of functions) assert.ok(params.split(',').filter(p => p.trim()).length <= 1, name);
});

test('the check and reset files', () => {
  const raw = read('docs/ops/2026-11-14-metrics-check.sql');
  const header = raw.slice(0, raw.search(/^select\b/im));
  const sql = raw.replace(/--[^\n]*/g, '');
  assert.equal(sql.split(';').filter(s => s.trim()).length, 1);
  assert.match(sql.trim(), /^select\b/i);
  assert.doesNotMatch(sql.replace(/'[^']*'/g, "''"), /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);   // quoted text emptied first: privilege names are literals
  assert.ok(sql.includes("has_table_privilege(proowner,'auth.users','SELECT')"));
  for (const known of ['525', '494', '486', '210', '375']) assert.match(header, new RegExp(`\\b${known}\\b`), known);

  const reset = read('docs/ops/2026-11-14-metrics-reading-reset.sql').replace(/--[^\n]*/g, '');
  assert.equal(reset.split(';').filter(s => s.trim()).length, 1);
  assert.equal(reset.trim(), "delete from public.metrics_readings where day = '<day>' returning day, taken_at;");
});

test('DEPLOYMENT.md applies the metrics migration before main', () => {
  const deployment = read('DEPLOYMENT.md');
  const start = deployment.indexOf('## Admin home and metrics: one migration before `main`');
  assert.ok(start > 0);
  assert.ok(start < deployment.indexOf('## Founder Membership acceptances'));
  const step = deployment.slice(start, deployment.indexOf('\n## ', start + 1));
  assert.ok(step.includes('npx --no-install supabase db query --linked -f supabase/migrations/20261114010000_metrics.sql'));
  assert.ok(step.includes('npx --no-install supabase migration repair --status applied 20261114010000'));
  assert.ok(step.includes('docs/ops/2026-11-14-metrics-check.sql'));
  assert.ok(step.includes('/api/admin/metrics'));
  assert.match(step, /before pushing `main`/);
  const steps = deployment.slice(deployment.indexOf('## Production Deployment Steps'));
  const apply = oneLine(steps.slice(steps.indexOf('\n2. '), steps.indexOf('\n3. ')));
  assert.ok(apply.includes('most recently `20261114010000_metrics.sql` under "Admin home and metrics"'), apply);
});
