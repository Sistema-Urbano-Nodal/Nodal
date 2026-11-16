import test from 'node:test';
import assert from 'node:assert/strict';
import { limaDay, limaStamp, windowsFor, sumSeries, foldCountries, smallGroups, validPart, figuresOf, figureKey, readingComplete, READING_PARTS } from '../server/metrics-domain.js';

test('a Lima day turns at 05:00:00 UTC', () => {
  assert.equal(limaDay(Date.parse('2026-11-14T04:59:59.999Z')), '2026-11-13');
  assert.equal(limaDay(Date.parse('2026-11-14T05:00:00.000Z')), '2026-11-14');
  assert.equal(limaStamp(Date.parse('2026-11-14T13:36:00Z')), '2026-11-14 08:36');
  assert.deepEqual(windowsFor('2026-11-14'), { d7: { from: '2026-11-08', to: '2026-11-14' }, d30: { from: '2026-10-16', to: '2026-11-14' } });
  assert.deepEqual(windowsFor('2026-03-01').d7.from, '2026-02-23');
});
test('sums a per-day series into windows and Lima months', () => {
  const s = sumSeries([['2026-07-31', 9], ['2026-09-30', 40], ['2026-10-16', 400], ['2026-10-26', 76]], '2026-11-14');
  assert.deepEqual([s.total, s.d30, s.d7, s.last], [525, 476, 0, '2026-10-26']);
  assert.deepEqual(s.months, { '2026-07': 9, '2026-08': 0, '2026-09': 40, '2026-10': 476, '2026-11': 0 });
  assert.equal(sumSeries([['2026-10-15', 1]], '2026-11-14').d30, 0, 'day 31 back is outside');
  assert.equal(sumSeries([['2026-11-15', 5]], '2026-11-14').total, 5, 'a later day still counts in the total, in no window');
});
test('a series that was not read stays missing, never zeros', () => { assert.equal(sumSeries(null, '2026-11-14'), null); });
test('folds, labels and guards festival countries', () => {
  assert.deepEqual(foldCountries([['perú', 230], ['peru', 103], ['Perú', 2], ['lima', 8], ['Colombia', 7], ['méxico', 2], ['Mexico', 2],
    ['Chile', 2], ['x'.repeat(41), 5], ['Per1', 4], ['', 1]]),
    [{ text: 'Perú', n: 335 }, { text: 'Lima', n: 8 }, { text: 'Colombia', n: 7 }, { text: 'Mexico', n: 4 }, { key: '_other', n: 12 }]);
  assert.deepEqual(foldCountries([['', 3], ["Côte d'Ivoire", 3], ['St. Lucia', 3], ['Guinea-Bissau', 3]]).map(i => i.text ?? i.key),
    ["Côte d'Ivoire", 'Guinea-Bissau', 'St. Lucia', '_none']);
});
test('folds Unicode spellings of one country together', () => {
  // Written as escapes on purpose: a combining accent, a non-breaking space, a zero-width space. Never paste the characters themselves.
  assert.deepEqual(foldCountries([['Perú', 1], ['Perú ', 1], ['Peru​', 1]]), [{ text: 'Perú', n: 3 }]);
});
test('groups small values, and a profile "other" of 3 or more stays apart from _other', () => {
  assert.deepEqual(smallGroups([{ key: 'professional', n: 82 }, { key: 'other', n: 34 }, { key: 'activist', n: 2 }, { key: '', n: 1 }]),
    [{ key: 'professional', n: 82 }, { key: 'other', n: 34 }, { key: '_other', n: 3 }]);
  assert.deepEqual(smallGroups([{ key: '', n: 3 }]), [{ key: '_none', n: 3 }]);
  assert.deepEqual(smallGroups([{ key: 'student', n: 1 }]), [{ key: '_other', n: 1 }], '_other may itself hold 1 or 2');
});
test('validates by version and required keys, ignoring extras', () => {
  assert.equal(validPart('accounts', { v: 1, days: [], later: true }), true);
  assert.equal(validPart('accounts', { v: 2, days: [] }), false);
  assert.equal(validPart('members', { v: 1, days: {}, now: {}, active: { d7: {} } }), false);
  assert.equal(validPart('members', { v: 1, days: {}, now: {}, active: { d7: {}, d30: {} }, lists: {} }), true);
  assert.equal(validPart('visits', { v: 1, days: [], pages: {}, sources: {} }), true);
  assert.equal(validPart('visits', null), false);
});
test('builds the flat figures map and refuses a partial reading', () => {
  assert.deepEqual(figuresOf([{ key: 'signups.accounts', total: 525 }, { key: 'signups.entered', total: 486, d30: 2, d7: 0 },
    { key: 'activity.kinds', items: [{ key: 'profile', n: 4, d7: 1 }] }, { key: 'visits.views', d30: 9, d7: 1 },
    { key: 'memberships.views', items: [{ key: 'payments.html', n: 3 }] }, { key: 'festival.countries', items: [{ text: 'Perú', n: 335 }] },
    { key: 'festival.registrations', total: 375, team: 2 }, { key: 'signups.new', d30: 0, d7: 0, last: '2026-10-26', daysSince: 19 }]),
    { 'signups.accounts': 525, 'signups.entered': 486, 'signups.entered.d30': 2, 'signups.entered.d7': 0, 'activity.kinds.profile.d30': 4,
      'activity.kinds.profile.d7': 1, 'festival.registrations': 375, 'signups.new.d30': 0, 'signups.new.d7': 0 });
  assert.equal(figureKey('a.b', 'total'), 'a.b');
  assert.equal(figureKey('a.b', 'd30'), 'a.b.d30');
  assert.equal(figuresOf([{ key: 'signups.entered', state: 'unavailable', total: 1 }])['signups.entered'], undefined);
  const ok = Object.fromEntries(READING_PARTS.map(p => [p, 'ok']));
  assert.equal(readingComplete(ok), true);
  assert.equal(readingComplete({ ...ok, visits: 'not_yet_counted' }), true);
  for (const state of ['unavailable', 'not_activated']) assert.equal(readingComplete({ ...ok, courses: state }), false);
  assert.equal(readingComplete({ ...ok, members: undefined }), false);
});
