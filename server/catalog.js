const KINDS = new Set(['opportunity', 'project', 'learning_circle', 'resource', 'case_study']);
const OPPORTUNITY_SUBTYPES = new Set(['job', 'consulting', 'grant', 'open_call', 'fellowship', 'other']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const VISIBILITIES = new Set(['public', 'members']);
const ACTION_MODES = new Set(['external', 'interest', 'none']);
const SUPPORTED_LANGS = ['en', 'es', 'pt'];

const LIMITS = { title: 120, summary: 320, body: 5000, cta: 60, sourceLabel: 120, organization: 180, location: 180, topic: 60, topics: 8, message: 1000 };

function plainString(value, name, max, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${name} must be plain text`);
  const normalized = value.trim();
  if (/<(?:[a-z!/]|\?xml)[^>]*>/i.test(normalized)) throw new Error(`${name} must be plain text`);
  if (normalized.length > max) throw new Error(`${name} must be at most ${max} characters`);
  if (required && !normalized) throw new Error(`${name} is required`);
  return normalized;
}

function enumValue(value, name, values, fallback = '') {
  const normalized = value === undefined || value === null || value === '' ? fallback : String(value).trim();
  if (!values.has(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

function validCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function optionalDate(value, name, { endOfDay = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a valid date`);
  const text = value.trim();
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    if (!validCalendarDate(Number(year), Number(month), Number(day))) throw new Error(`${name} must be a valid date`);
    return `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  }
  const timestamp = RFC3339.exec(text);
  if (!timestamp) throw new Error(`${name} must be a valid date`);
  const [, year, month, day, hours, minutes, seconds, , offset] = timestamp;
  if (!validCalendarDate(Number(year), Number(month), Number(day))
    || Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59
    || offset === '-00:00') {
    throw new Error(`${name} must be a valid date`);
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid date`);
  return new Date(parsed).toISOString();
}

function httpsUrl(value, name, { required = false } = {}) {
  const text = plainString(value, name, 2000, { required });
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`${name} must be a valid HTTPS URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  return parsed.toString();
}

function readObject(value, name) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON`); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function normalizeTranslations(value) {
  const translations = readObject(value ?? {}, 'translations');
  const result = {};
  for (const [lang, raw] of Object.entries(translations)) {
    if (!SUPPORTED_LANGS.includes(lang)) throw new Error('translation locale is invalid');
    const row = readObject(raw, `translations.${lang}`);
    result[lang] = {
      title: plainString(row.title, `${lang} title`, LIMITS.title),
      summary: plainString(row.summary, `${lang} summary`, LIMITS.summary),
      body: plainString(row.body, `${lang} body`, LIMITS.body),
      cta: plainString(row.cta, `${lang} CTA`, LIMITS.cta),
    };
  }
  return result;
}

function normalizeTopics(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('topics must be valid JSON'); }
  }
  if (!Array.isArray(value)) throw new Error('topics must be an array');
  if (value.length > LIMITS.topics) throw new Error(`topics must contain at most ${LIMITS.topics} entries`);
  return value.map((topic) => plainString(topic, 'topic', LIMITS.topic, { required: true }));
}

export function validateCatalogDraft(input = {}) {
  const source = readObject(input, 'catalog item');
  const kind = enumValue(source.kind, 'kind', KINDS, 'resource');
  const subtype = source.subtype === undefined || source.subtype === null || source.subtype === '' ? null : String(source.subtype).trim();
  if (subtype !== null && (!OPPORTUNITY_SUBTYPES.has(subtype) || kind !== 'opportunity')) throw new Error('subtype is invalid');
  const record = {
    kind,
    subtype,
    status: enumValue(source.status, 'status', STATUSES, 'draft'),
    visibility: enumValue(source.visibility, 'visibility', VISIBILITIES, 'public'),
    translations: normalizeTranslations(source.translations),
    organization: plainString(source.organization, 'organization', LIMITS.organization),
    location: plainString(source.location, 'location', LIMITS.location),
    topics: normalizeTopics(source.topics),
    startsAt: optionalDate(source.startsAt, 'startsAt'),
    deadlineAt: optionalDate(source.deadlineAt, 'deadlineAt'),
    endDate: optionalDate(source.endDate, 'endDate', { endOfDay: true }),
    sourceLabel: plainString(source.sourceLabel, 'source label', LIMITS.sourceLabel),
    sourceUrl: httpsUrl(source.sourceUrl, 'source URL'),
    sourceVerifiedAt: optionalDate(source.sourceVerifiedAt, 'source verified date'),
    actionMode: enumValue(source.actionMode, 'action mode', ACTION_MODES, 'none'),
    actionUrl: httpsUrl(source.actionUrl, 'action URL'),
    featured: Boolean(source.featured),
  };
  const deadline = record.deadlineAt ? Date.parse(record.deadlineAt) : null;
  const start = record.startsAt ? Date.parse(record.startsAt) : null;
  const end = record.endDate ? Date.parse(record.endDate) : null;
  if (deadline !== null && start !== null && deadline > start) throw new Error('deadline must be on or before start');
  if (start !== null && end !== null && start > end) throw new Error('start must be on or before end');
  if (deadline !== null && end !== null && deadline > end) throw new Error('deadline must be on or before end');
  return record;
}

export function validateCatalogPublication(input = {}) {
  const record = validateCatalogDraft(input);
  if (record.status !== 'published') throw new Error('published catalog item must have published status');
  for (const lang of SUPPORTED_LANGS) {
    const translation = record.translations[lang];
    if (!translation) throw new Error(`${lang.toUpperCase()} translation is required`);
    for (const [field, value] of Object.entries(translation)) {
      if (!value) throw new Error(`${lang.toUpperCase()} ${field} is required`);
    }
  }
  if (!record.organization) throw new Error('organization is required');
  if (!record.sourceLabel) throw new Error('source label is required');
  if (!record.sourceUrl) throw new Error('verified HTTPS source URL is required');
  if (!record.sourceVerifiedAt) throw new Error('source verified date is required');
  if (record.kind === 'opportunity' && !record.subtype) throw new Error('opportunity subtype is required');
  if (record.kind === 'opportunity' && !record.deadlineAt) throw new Error('opportunity deadline is required');
  if (record.actionMode === 'external' && !record.actionUrl) throw new Error('external action URL is required');
  if (record.actionMode !== 'external' && record.actionUrl) throw new Error('only external actions may have an action URL');
  return record;
}

export function validateCatalogInterestMessage(value) {
  return plainString(value, 'interest message', LIMITS.message);
}

export function localizeCatalogItem(item, lang = 'en', { fallback = false } = {}) {
  const locale = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
  const translations = readObject(item?.translations, 'translations');
  const translation = translations[locale]
    || (fallback ? translations.en || SUPPORTED_LANGS.map((candidate) => translations[candidate]).find(Boolean) : null);
  if (!translation || typeof translation !== 'object') throw new Error(`${locale.toUpperCase()} translation is required`);
  return { id: item.id, kind: item.kind, subtype: item.subtype ?? null, ...translation };
}

export function encodeCatalogCursor(sortTuple) {
  if (!Array.isArray(sortTuple) || sortTuple.length !== 4) throw new Error('catalog cursor is invalid');
  return Buffer.from(JSON.stringify(sortTuple), 'utf8').toString('base64url');
}

function validCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function decodeCatalogCursor(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('catalog cursor is invalid');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const [featured, deadlineAt, publishedAt, id] = parsed;
    const validId = typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
    if (!Array.isArray(parsed) || parsed.length !== 4 || ![0, 1].includes(featured)
      || !(deadlineAt === '\uffff' || validCanonicalTimestamp(deadlineAt)) || !(publishedAt === '' || validCanonicalTimestamp(publishedAt)) || !validId) {
      throw new Error('catalog cursor is invalid');
    }
    return parsed;
  } catch (err) {
    if (err.message === 'catalog cursor is invalid') throw err;
    throw new Error('catalog cursor is invalid');
  }
}

export function encodeCatalogInterestCursor(sortTuple) {
  if (!Array.isArray(sortTuple) || sortTuple.length !== 2) throw new Error('interest cursor is invalid');
  return Buffer.from(JSON.stringify(sortTuple), 'utf8').toString('base64url');
}

export function decodeCatalogInterestCursor(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('interest cursor is invalid');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !validCanonicalTimestamp(parsed[0])
      || typeof parsed[1] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed[1])) {
      throw new Error('interest cursor is invalid');
    }
    return parsed;
  } catch (err) {
    if (err.message === 'interest cursor is invalid') throw err;
    throw new Error('interest cursor is invalid');
  }
}

export function isCatalogItemClosed(item, now = new Date()) {
  const deadline = item?.deadlineAt ? Date.parse(item.deadlineAt) : NaN;
  if (Number.isFinite(deadline)) return deadline < new Date(now).getTime();
  const endDate = item?.endDate ? Date.parse(item.endDate) : NaN;
  return Number.isFinite(endDate) && endDate < new Date(now).getTime();
}

export const CATALOG_LIMITS = Object.freeze({ ...LIMITS });
