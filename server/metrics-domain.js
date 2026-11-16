// Pure rules for the admin home's indicators (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md,
// "Indicator catalogue"): the Lima calendar, windows, country folding and the small-group rule. No clock, no display word.

export const LIMA_OFFSET_MS = 18000000;
export const FIRST_MONTH = '2026-07';
export const SMALL_GROUP = 3;
export const READING_PARTS = ['accounts', 'members', 'festival', 'courses', 'visits', 'readings'];

const DAY_MS = 86400000;
const dayMs = day => Date.parse(`${day}T00:00:00Z`);
const dayAt = (day, back) => new Date(dayMs(day) - back * DAY_MS).toISOString().slice(0, 10);

export function limaDay(ms) { return new Date(ms - LIMA_OFFSET_MS).toISOString().slice(0, 10); }
export function limaStamp(ms) { return new Date(ms - LIMA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' '); }

export function windowsFor(day) {
  return { d7: { from: dayAt(day, 6), to: day }, d30: { from: dayAt(day, 29), to: day } };
}

export function sumSeries(rows, day) {
  if (!Array.isArray(rows)) return null;
  const { d7, d30 } = windowsFor(day);
  const months = {};
  const lastMonth = day.slice(0, 7);
  for (let y = +FIRST_MONTH.slice(0, 4), m = +FIRST_MONTH.slice(5); ; m++) {
    if (m > 12) { m = 1; y++; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > lastMonth) break;
    months[key] = 0;
  }
  const out = { total: 0, d30: 0, d7: 0, last: null, months };
  for (const [d, n] of rows) {
    out.total += n;
    if (d >= d30.from && d <= d30.to) out.d30 += n;
    if (d >= d7.from && d <= d7.to) out.d7 += n;
    if (n > 0 && d <= day && (out.last === null || d > out.last)) out.last = d;
    const mo = d.slice(0, 7);
    if (mo in months) months[mo] += n;
  }
  return out;
}

const ZERO_WIDTH = /[​-‍﻿]/g;
const UNICODE_SPACE = /[\p{Z}\s]+/gu;
const ALLOWED = /^[\p{L}\p{M} \-'’.]+$/u;
const byLabel = (a, b) => a.localeCompare(b, 'es');

function foldKey(text) { return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es'); }
function upperFirst(text) { return text.charAt(0).toLocaleUpperCase('es') + text.slice(1); }

export function foldCountries(rows) {
  const groups = new Map();
  let none = 0;
  let other = 0;
  for (const [raw, count] of rows) {
    const n = Number(count) || 0;
    const text = String(raw ?? '').normalize('NFC').replace(ZERO_WIDTH, '').replace(UNICODE_SPACE, ' ').trim();
    if (!text) { none += n; continue; }
    if (text.length > 40 || !ALLOWED.test(text)) { other += n; continue; }
    const key = foldKey(text);
    const g = groups.get(key) || { n: 0, spellings: new Map() };
    g.n += n;
    g.spellings.set(text, (g.spellings.get(text) || 0) + n);
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.n < SMALL_GROUP) { other += g.n; continue; }
    const best = [...g.spellings].sort((a, b) => b[1] - a[1] || byLabel(a[0], b[0]))[0][0];
    out.push({ text: upperFirst(best), n: g.n });
  }
  out.sort((a, b) => b.n - a.n || byLabel(a.text, b.text));
  if (none >= SMALL_GROUP) out.push({ key: '_none', n: none }); else other += none;
  if (other > 0) out.push({ key: '_other', n: other });
  return out;
}

export function smallGroups(items) {
  const sums = new Map();
  for (const item of items) {
    const key = item.key ? String(item.key) : '_none';
    sums.set(key, (sums.get(key) || 0) + (Number(item.n) || 0));
  }
  let other = sums.get('_other') || 0;
  const none = sums.get('_none') || 0;
  sums.delete('_other');
  sums.delete('_none');
  const out = [];
  for (const [key, n] of sums) {
    if (n < SMALL_GROUP) other += n; else out.push({ key, n });
  }
  out.sort((a, b) => b.n - a.n);
  if (none >= SMALL_GROUP) out.push({ key: '_none', n: none }); else other += none;
  if (other > 0) out.push({ key: '_other', n: other });
  return out;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const REQUIRED = {
  accounts: v => Array.isArray(v.days),
  members: v => isObj(v.days) && isObj(v.now) && isObj(v.active) && isObj(v.active.d7) && isObj(v.active.d30) && isObj(v.lists),
  visits: v => Array.isArray(v.days) && isObj(v.pages) && isObj(v.sources),
};
export function validPart(name, value) {
  return isObj(value) && value.v === 1 && !!REQUIRED[name]?.(value);
}

// The one key rule of the saved figures: the total under the key, a window under `<key>.d30` / `<key>.d7`.
export function figureKey(key, field) { return field === 'total' ? key : `${key}.${field}`; }

export function figuresOf(indicators) {
  const out = {};
  const num = v => typeof v === 'number' && Number.isFinite(v);
  for (const ind of indicators) {
    if (ind.state || ind.key.startsWith('visits.') || ind.key === 'memberships.views') continue;
    for (const field of ['total', 'd30', 'd7']) if (num(ind[field])) out[figureKey(ind.key, field)] = ind[field];
    if (ind.key === 'activity.kinds' && Array.isArray(ind.items)) {
      for (const it of ind.items) {
        if (num(it.n)) out[figureKey(`activity.kinds.${it.key}`, 'd30')] = it.n;
        if (num(it.d7)) out[figureKey(`activity.kinds.${it.key}`, 'd7')] = it.d7;
      }
    }
  }
  return out;
}

export function readingComplete(states) {
  return READING_PARTS.every(p => states?.[p] === 'ok' || (p === 'visits' && states?.[p] === 'not_yet_counted'));
}
