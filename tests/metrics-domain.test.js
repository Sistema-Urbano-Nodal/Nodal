import test from 'node:test';
import assert from 'node:assert/strict';
import { limaDay, limaStamp, windowsFor, sumSeries, foldCountries, smallGroups, validPart, figuresOf, figureKey } from '../server/metrics-domain.js';

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
test('a row that is not a day and a finite count is a failed read, never a wrong number', () => {
  for (const row of [['2026-11-14', '7'], ['2026-11-14', Number.NaN], ['2026-11-14', null], ['2026-11-14'], ['14/11/2026', 1], [20261114, 1], null]) {
    assert.throws(() => sumSeries([['2026-11-13', 1], row], '2026-11-14'), TypeError, JSON.stringify(row));
  }
  assert.equal(sumSeries([['2026-11-14', 0]], '2026-11-14').total, 0, 'a zero is a count');
});
test('folds, labels and guards festival countries', () => {
  assert.deepEqual(foldCountries([['perú', 230], ['peru', 103], ['Perú', 2], ['lima', 8], ['Colombia', 7], ['méxico', 2], ['Mexico', 2],
    ['Chile', 2], ['x'.repeat(41), 5], ['Per1', 4], ['', 1]]),
    [{ text: 'Per\u00FA', n: 335 }, { text: 'Lima', n: 8 }, { text: 'Colombia', n: 7 }, { text: 'Mexico', n: 4 }, { key: '_other', n: 12 }]);
  assert.deepEqual(foldCountries([['', 3], ["Côte d'Ivoire", 3], ['St. Lucia', 3], ['Guinea-Bissau', 3]]).map(i => i.text ?? i.key),
    ["Côte d'Ivoire", 'Guinea-Bissau', 'St. Lucia', '_none']);
});
test('folds Unicode spellings of one country together', () => {
  // Written as escapes on purpose: a combining accent, a non-breaking space, a zero-width space. Never paste the characters themselves.
  assert.deepEqual(foldCountries([['Peru\u0301', 1], ['Per\u00FA\u00A0', 1], ['Peru\u200B', 1]]), [{ text: 'Per\u00FA', n: 3 }]);
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
  // Every per-day row is [Lima day, finite counts]: two counts for accounts and visits, one for each member series.
  assert.equal(validPart('accounts', { v: 1, days: [['2026-11-14', 2, 1]] }), true);
  for (const row of [['2026-11-14', 2], ['2026-11-14', '2', 1], ['2026-11-14', 2, Number.NaN], ['14/11/2026', 2, 1], null]) {
    assert.equal(validPart('accounts', { v: 1, days: [row] }), false, JSON.stringify(row));
    assert.equal(validPart('visits', { v: 1, days: [row], pages: {}, sources: {} }), false, JSON.stringify(row));
  }
  const members = days => ({ v: 1, days, now: {}, active: { d7: {}, d30: {} }, lists: {} });
  assert.equal(validPart('members', members({ entered: [['2026-11-14', 3]], later: 'ignored' })), true);
  assert.equal(validPart('members', members({ entered: [['2026-11-14', 3]], follows: [['2026-11-14', '3']] })), false);
});
test('builds the flat figures map, leaving out a figure that has a state', () => {
  assert.deepEqual(figuresOf([{ key: 'signups.accounts', total: 525 }, { key: 'signups.entered', total: 486, d30: 2, d7: 0 },
    { key: 'activity.kinds', items: [{ key: 'profile', n: 4, d7: 1 }] }, { key: 'visits.views', d30: 9, d7: 1 },
    { key: 'memberships.views', items: [{ key: 'payments.html', n: 3 }] }, { key: 'festival.countries', items: [{ text: 'Per\u00FA', n: 335 }] },
    { key: 'festival.registrations', total: 375, team: 2 }, { key: 'signups.new', d30: 0, d7: 0, last: '2026-10-26', daysSince: 19 }]),
    { 'signups.accounts': 525, 'signups.entered': 486, 'signups.entered.d30': 2, 'signups.entered.d7': 0, 'activity.kinds.profile.d30': 4,
      'activity.kinds.profile.d7': 1, 'festival.registrations': 375, 'signups.new.d30': 0, 'signups.new.d7': 0 });
  assert.equal(figureKey('a.b', 'total'), 'a.b');
  assert.equal(figureKey('a.b', 'd30'), 'a.b.d30');
  assert.equal(figuresOf([{ key: 'signups.entered', state: 'unavailable', total: 1 }])['signups.entered'], undefined);
});
