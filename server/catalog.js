const KINDS = new Set(['opportunity', 'project', 'learning_circle', 'resource', 'case_study']);
const OPPORTUNITY_SUBTYPES = new Set(['job', 'consulting', 'grant', 'open_call', 'fellowship', 'other']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const VISIBILITIES = new Set(['public', 'members']);
const ACTION_MODES = new Set(['external', 'interest', 'none']);
const SUPPORTED_LANGS = ['en', 'es', 'pt'];

const LIMITS = { title: 120, summary: 320, body: 5000, cta: 60, organization: 180, location: 180, topic: 60, topics: 8, message: 1000 };

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

function optionalDate(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${name} must be a valid date`);
  return text;
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
  return {
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
    endDate: optionalDate(source.endDate, 'endDate'),
    sourceUrl: httpsUrl(source.sourceUrl, 'source URL'),
    sourceVerifiedAt: optionalDate(source.sourceVerifiedAt, 'source verified date'),
    actionMode: enumValue(source.actionMode, 'action mode', ACTION_MODES, 'none'),
    actionUrl: httpsUrl(source.actionUrl, 'action URL'),
    featured: Boolean(source.featured),
  };
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
  if (!record.sourceUrl) throw new Error('verified HTTPS source URL is required');
  if (!record.sourceVerifiedAt) throw new Error('source verified date is required');
  if (record.kind === 'opportunity' && !record.subtype) throw new Error('opportunity subtype is required');
  if (record.actionMode === 'external' && !record.actionUrl) throw new Error('external action URL is required');
  if (record.actionMode !== 'external' && record.actionUrl) throw new Error('only external actions may have an action URL');
  return record;
}

export function validateCatalogInterestMessage(value) {
  return plainString(value, 'interest message', LIMITS.message);
}

export function localizeCatalogItem(item, lang = 'en') {
  const locale = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
  const translations = readObject(item?.translations, 'translations');
  const translation = translations[locale];
  if (!translation || typeof translation !== 'object') throw new Error(`${locale.toUpperCase()} translation is required`);
  return { id: item.id, kind: item.kind, subtype: item.subtype ?? null, ...translation };
}

export function encodeCatalogCursor(sortTuple) {
  if (!Array.isArray(sortTuple) || sortTuple.length !== 4) throw new Error('catalog cursor is invalid');
  return Buffer.from(JSON.stringify(sortTuple), 'utf8').toString('base64url');
}

export function decodeCatalogCursor(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('catalog cursor is invalid');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const [featured, deadlineAt, publishedAt, id] = parsed;
    const validDate = (part) => typeof part === 'string' && part && Number.isFinite(Date.parse(part));
    const validId = typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
    if (!Array.isArray(parsed) || parsed.length !== 4 || ![0, 1].includes(featured)
      || !(deadlineAt === '\uffff' || validDate(deadlineAt)) || !validDate(publishedAt) || !validId) {
      throw new Error('catalog cursor is invalid');
    }
    return parsed;
  } catch (err) {
    if (err.message === 'catalog cursor is invalid') throw err;
    throw new Error('catalog cursor is invalid');
  }
}

export function isCatalogItemClosed(item, now = new Date()) {
  const deadline = item?.deadlineAt ? Date.parse(item.deadlineAt) : NaN;
  if (Number.isFinite(deadline)) return deadline < new Date(now).getTime();
  const endDate = item?.endDate ? Date.parse(item.endDate) : NaN;
  return Number.isFinite(endDate) && endDate < new Date(now).getTime();
}

export const CATALOG_LIMITS = Object.freeze({ ...LIMITS });
