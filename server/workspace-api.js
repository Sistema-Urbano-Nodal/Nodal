import { downloadWorkspaceAttachment, normalizeWorkspaceAttachments, WORKSPACE_JSON_LIMIT } from './workspace-attachments.js';
import { createSupabaseClients } from './supabase.js';

export const WORKSPACE_FILE = /^\/api\/(workspace|me\/export)\/attachments\/([^/]+)$/;
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
    async execute(actorId, op, data) {
      clients ??= createSupabaseClients();
      const result = await clients.admin.rest('rpc/member_workspace', {
        method: 'POST', body: { p_actor: actorId, p_op: op, p_data: data },
      });
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
  if (fileRoute && req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request rejected' });
  if (!allowed()) return;
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
