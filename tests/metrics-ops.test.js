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
