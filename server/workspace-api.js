import { createDirectEmailStore } from './direct-email.js';
import { downloadWorkspaceAttachment, normalizeWorkspaceAttachments, WORKSPACE_JSON_LIMIT } from './workspace-attachments.js';
import { createSupabaseClients } from './supabase.js';

const WORKSPACE_FILE = /^\/api\/(workspace|me\/export)\/attachments\/([^/]+)$/;
const EMAIL_PREFERENCE = '/api/workspace/email-preference';
const NOTIFICATIONS_PATH = '/api/workspace/notifications';
const EDITORIAL_READ_PATH = NOTIFICATIONS_PATH + '/read';
export function isWorkspaceRoute(pathname) {
  return pathname === '/api/workspace' || pathname === NOTIFICATIONS_PATH || pathname === EMAIL_PREFERENCE || pathname === EDITORIAL_READ_PATH || WORKSPACE_FILE.test(pathname);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(field) {
  throw Object.assign(new Error(`Invalid ${field}`), { status: 400 });
}
function id(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(field);
  return value.toLowerCase();
}
function textField(value, field, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      value.includes('\0') || !value.isWellFormed()) invalid(field);
  return value.trim();
}
function documentLink(value) {
  if (value === '') return '';
  const text = textField(value, 'link', 2048);
  let url;
  try { url = new URL(text); } catch { invalid('link'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('link');
  return text;
}
const fields = {
  clientId: id, targetId: id, threadId: id, projectId: id, stepId: id,
  assigneeId: (v, k) => v == null ? null : id(v, k),
  body: (v, k) => textField(v, k, 4000), description: (v, k) => textField(v, k, 320),
  name: (v, k) => textField(v, k, 100), title: (v, k) => textField(v, k, 120),
  goal: (v, k) => textField(v, k, 2000), link: documentLink,
  done: (v, k) => typeof v === 'boolean' ? v : invalid(k),
  revision: (v, k) => Number.isSafeInteger(v) && v >= 0 ? v : invalid(k),
  targetIds(values, k) {
    if (!Array.isArray(values) || values.length < 1 || values.length > 20) invalid(k);
    return [...new Set(values.map(v => id(v, k)))];
  },
};
const commands = {
  direct: ['targetId', 'body', 'clientId'], send: ['threadId', 'body', 'clientId'],
  block: ['threadId'], read: ['threadId', 'revision'], accept: ['threadId'], decline: ['threadId'], leave: ['threadId'],
  group: ['name', 'targetIds', 'clientId'], invite: ['threadId', 'targetId', 'clientId'],
  createProject: ['threadId', 'title', 'goal', 'clientId'], link: ['threadId', 'projectId', 'link'],
  step: ['threadId', 'projectId', 'description', 'assigneeId', 'clientId'],
  toggle: ['threadId', 'projectId', 'stepId', 'done'], update: ['threadId', 'projectId', 'body', 'clientId'],
};
const fileOperations = { direct: 'directFiles', send: 'sendFiles' };

export function createHostedWorkspace(clients) {
  return {
    emailAlerts: createDirectEmailStore({clients}),
    async execute(actorId, op, data) {
      clients ??= createSupabaseClients();
      let rpc = 'member_workspace', body = {p_actor:actorId, p_op:op, p_data:data};
      if (op === 'notifications' || op === 'combinedBell') {
        rpc = op === 'combinedBell' ? 'member_workspace_bell' : 'member_workspace_notifications';
        body = {p_actor:actorId};
      } else if (op === 'readPublication') {
        rpc = 'read_editorial_notification';
        body = {p_actor:actorId, p_event:data.eventId};
      }
      const result = await clients.admin.rest('rpc/' + rpc, {method:'POST', body});
      if (result?.error && [400, 403, 404, 409, 413].includes(result.status)) {
        throw Object.assign(new Error(result.error), { status: result.status });
      }
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.error) {
        throw Object.assign(new Error('Workspace unavailable'), { status: 502 });
      }
      return result;
    },
  };
}

export async function serveWorkspace({ req, res, url, actor, store, send, sameOrigin, readJsonBody, allowed, downloads }) {
  if (!actor) return send(res, 401, { error: 'Authentication required' });
  if (!store) return send(res, 503, { error: 'Workspace unavailable' });
  const fileRoute = url.pathname.match(WORKSPACE_FILE);
  const feed = url.pathname === NOTIFICATIONS_PATH;
  const readPublication = url.pathname === EDITORIAL_READ_PATH;
  if (readPublication && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if ((fileRoute || feed) && req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request rejected' });
  if (!allowed()) return;
  if (url.pathname === EMAIL_PREFERENCE) {
    if (!store.emailAlerts) return send(res,503,{error:'Message email preferences unavailable'});
    if (req.method === 'GET') return send(res,200,{enabled:Boolean(await store.emailAlerts.preference(actor.id))});
    const input = await readJsonBody(req,1024);
    if (typeof input?.enabled !== 'boolean' || !['es','en','pt'].includes(input.language) ||
        Object.keys(input).some(key => !['enabled','language'].includes(key))) invalid('email preference');
    await store.emailAlerts.setPreference(actor.id,input.enabled,input.language);
    return send(res,200,{enabled:input.enabled});
  }
  if (feed) {
    const op = url.searchParams.get('editorial') === '1' ? 'combinedBell' : 'notifications';
    return send(res, 200, await store.execute(actor.id, op, {}));
  }
  if (readPublication) {
    const input = await readJsonBody(req, 1024);
    if (input?.type !== 'news' && input?.type !== 'opportunity') invalid('publication type');
    const prefix = input.type === 'news' ? 'n:' : 'c:';
    return send(res, 200, await store.execute(actor.id, 'readPublication', {eventId:prefix + id(input.id, 'id')}));
  }
  if (fileRoute) {
    const attachmentId = id(fileRoute[2], 'attachmentId');
    const op = fileRoute[1] === 'workspace' ? 'attachment' : 'exportAttachment';
    const file = await store.execute(actor.id, op, {attachmentId});
    return downloadWorkspaceAttachment({res,send,file,inline:url.searchParams.get('inline')==='1',actorId:actor.id,downloads});
  }
  let op, data;
  if (req.method === 'GET') {
    const thread = url.searchParams.get('threadId');
    op = thread === null ? 'inbox' : 'thread';
    data = thread === null ? {} : { threadId: id(thread, 'threadId') };
    if (url.searchParams.has('beforeMessageId')) {
      if (op !== 'thread') invalid('threadId');
      data.beforeMessageId = id(url.searchParams.get('beforeMessageId'), 'beforeMessageId');
    }
  } else {
    const body = await readJsonBody(req, WORKSPACE_JSON_LIMIT);
    const requested = body.op;
    op = requested === 'directFiles' ? 'direct' : requested === 'sendFiles' ? 'send' : requested;
    if (typeof op !== 'string' || !Object.hasOwn(commands, op)) invalid('operation');
    const chat = Object.hasOwn(fileOperations, op);
    if (!chat && body.attachments !== undefined) invalid('attachments');
    const files = chat && body.attachments !== undefined ? await normalizeWorkspaceAttachments(body.attachments) : [];
    if (requested !== op && !files.length) invalid('attachments');
    data = Object.fromEntries(commands[op].map(key => {
      if (key === 'body' && files.length && body.body === '') return [key, ''];
      return [key, fields[key](body[key], key)];
    }));
    if (files.length) {
      data.attachments = files;
      op = fileOperations[op];
    }
    if (data.targetId === actor.id || data.targetIds?.includes(actor.id)) invalid('recipient');
  }
  send(res, 200, await store.execute(actor.id, op, data));
}
