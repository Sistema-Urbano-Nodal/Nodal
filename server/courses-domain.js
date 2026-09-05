import { randomUUID } from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const FEEDBACK_ACTIONS = ['profile', 'matching', 'content', 'recording', 'assignment', 'discussion', 'course'];
export const INTAKE_FIELDS = ['fullName', 'profession', 'city', 'motivation', 'experience', 'expectations', 'caseStudy', 'digitalFamiliarity'];
export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const newId = () => randomUUID();
export function identifier(value) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) fail('invalid identifier');
  return value;
}
export function text(value, field, max = 2000, required = false) {
  if (value !== undefined && typeof value !== 'string') fail(`${field} must be text`);
  const clean = String(value ?? '').trim();
  if (clean.length > max) fail(`${field} is too long`);
  if (required && !clean) fail(`${field} is required`);
  return clean;
}
function choice(value, allowed, fallback, name) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) fail(`invalid ${name}`);
  return value;
}
export function httpsUrl(value) {
  let u;
  try { u = new URL(text(value, 'URL', 2000, true)); } catch { fail('a valid HTTPS URL is required'); }
  if (u.protocol !== 'https:' || u.username || u.password) fail('a public HTTPS URL is required');
  return u.href;
}
function date(value, name) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`invalid ${name} date`);
  return value;
}
// Translations replace the supplied map; omitted maps preserve existing values
// through the normalizers' current/input merge. Empty fields mean base fallback.
export function normalizeTranslations(value = {}, fields = {title:180,description:6000}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('translations must be an object');
  const result = {};
  for (const [locale, translated] of Object.entries(value)) {
    if (!['en','es','pt'].includes(locale)) fail('unsupported translation locale');
    if (!translated || typeof translated !== 'object' || Array.isArray(translated)) fail('locale translation must be an object');
    result[locale] = {};
    for (const [field, content] of Object.entries(translated)) {
      if (!Object.hasOwn(fields, field)) fail('unsupported translation field');
      if (typeof content !== 'string') fail('translation must be text');
      result[locale][field] = text(content, `${locale} ${field}`, fields[field]);
    }
  }
  return result;
}
export function normalizeCourse(input = {}, current = {}) {
  const src = { ...current, ...input };
  const out = {
    title: text(src.title, 'title', 180, true), description: text(src.description, 'description', 6000),
    translations: normalizeTranslations(src.translations),
    status: choice(src.status, ['draft', 'published', 'archived'], 'draft', 'status'),
    startsOn: date(src.startsOn, 'start'), endsOn: date(src.endsOn, 'end'),
    enrollmentOpen: src.enrollmentOpen === undefined ? true : src.enrollmentOpen,
  };
  if (typeof out.enrollmentOpen !== 'boolean') fail('enrollmentOpen must be true or false');
  if (out.startsOn && out.endsOn && out.endsOn < out.startsOn) fail('end date must follow start date');
  return out;
}
export function normalizeLinks(value = [], materials = false) {
  if (!Array.isArray(value) || value.length > 12) fail('up to 12 links are allowed');
  return value.map(item => ({
    title: text(item?.title, 'link title', 180, true), url: httpsUrl(item?.url),
    ...(materials && item?.translations !== undefined ? {translations:normalizeTranslations(item.translations,{title:180})} : {}),
    ...(materials ? { kind: choice(item.kind, ['slides', 'reading', 'link', 'recording'], 'link', 'resource kind') } : {}),
  }));
}
export function normalizeModule(input = {}, current = {}) {
  const src = { ...current, ...input };
  const position = src.position ?? 1;
  if (!Number.isInteger(position) || position < 1 || position > 100) fail('position must be between 1 and 100');
  return {
    title: text(src.title, 'title', 180, true), description: text(src.description, 'description', 6000),
    objectives: text(src.objectives, 'objectives', 6000), instructions: text(src.instructions, 'instructions', 10000),
    translations: normalizeTranslations(src.translations,{title:180,description:6000,objectives:6000,instructions:10000}),
    sessionDate: date(src.sessionDate, 'session'), position,
    status: choice(src.status, ['draft', 'published'], 'draft', 'module status'),
    resources: normalizeLinks(src.resources, true),
  };
}
export function normalizeIntake(input = {}) {
  return Object.fromEntries(INTAKE_FIELDS.map(key => [key, text(input[key], key, ['fullName', 'profession', 'city'].includes(key) ? 160 : 2000, true)]));
}
export function normalizePost(input = {}) {
  const kind = choice(input.kind, ['assignment', 'question', 'comment'], 'question', 'post kind');
  const parentId = input.parentId ? identifier(input.parentId) : null;
  if ((kind === 'comment') !== Boolean(parentId)) fail('comments require a parent post');
  if (!Array.isArray(input.attachmentIds ?? []) || (input.attachmentIds ?? []).length > 3) fail('up to 3 attachments are allowed');
  return {
    kind, parentId, body: text(input.body, 'post', 6000, true), links: normalizeLinks(input.links),
    clientId: identifier(input.clientId), attachmentIds: [...new Set((input.attachmentIds ?? []).map(identifier))],
  };
}
export function normalizeFeedback(input = {}) {
  if (!FEEDBACK_ACTIONS.includes(input.action)) fail('invalid feedback action');
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) fail('rating must be between 1 and 5');
  return { action: input.action, rating: input.rating, comment: text(input.comment, 'comment', 2000), courseId: input.courseId ? identifier(input.courseId) : null, moduleId: input.moduleId ? identifier(input.moduleId) : null };
}
export function decodeAttachment(input = {}) {
  const name = text(input.name, 'filename', 160, true).replace(/[\x00-\x1f\x7f/\\]/g, '_');
  const mime = input.mime;
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'].includes(mime)) fail('unsupported file type: use JPG, PNG, WebP, PDF or text');
  const data = input.data;
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) fail('file exceeds 3 MB', 413);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('invalid file encoding');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString('base64') !== data) fail('invalid file size or encoding', 413);
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : mime === 'application/pdf' ? bytes.toString('ascii', 0, 5) === '%PDF-'
          : !bytes.includes(0) && !bytes.toString('utf8').includes('\uFFFD');
  if (!valid) fail('file content does not match its type');
  return { name, mime, size: bytes.length, bytes };
}
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = value === null || value === undefined ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
export function encodeCursor(row) { return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id })).toString('base64url'); }
export function decodeCursor(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string' || raw.length > 240 || !/^[\w-]+$/.test(raw)) fail('invalid cursor');
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    identifier(v.id);
    if (typeof v.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v.createdAt) || !Number.isFinite(Date.parse(v.createdAt))) fail('invalid cursor');
    return { createdAt: v.createdAt, id: v.id };
  } catch { fail('invalid cursor'); }
}
