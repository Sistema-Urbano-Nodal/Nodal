import { combinedBell, readEditorial } from './workspace-editorial.js';
import { createHash, randomUUID } from 'node:crypto';
import { profilePhotoFields } from './profile-policy.js';

const invitationId = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||
  '-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`;

const schema = `
  CREATE TABLE IF NOT EXISTS workspace_threads (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
    name TEXT NOT NULL DEFAULT '',
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    peer_low TEXT REFERENCES users(id) ON DELETE SET NULL,
    peer_high TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'blocked')),
    touched_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE (peer_low, peer_high)
  );
  CREATE TABLE IF NOT EXISTS workspace_members (
    thread_id TEXT NOT NULL REFERENCES workspace_threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active', 'invited')),
    inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    unread INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members(user_id, status);
  CREATE INDEX IF NOT EXISTS workspace_members_inviter ON workspace_members(inviter_id);
  CREATE TABLE IF NOT EXISTS workspace_projects (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES workspace_threads(id) ON DELETE CASCADE,
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL, goal TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    link_author TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS workspace_projects_thread ON workspace_projects(thread_id);
  CREATE TABLE IF NOT EXISTS workspace_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES workspace_threads(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES workspace_projects(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workspace_messages_thread ON workspace_messages(thread_id, project_id);
  CREATE INDEX IF NOT EXISTS workspace_messages_author ON workspace_messages(author_id);
  CREATE TABLE IF NOT EXISTS workspace_notifications (
    thread_id TEXT NOT NULL, user_id TEXT NOT NULL, event_id TEXT NOT NULL, created_at TEXT,
    message_id TEXT REFERENCES workspace_messages(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id,user_id),
    FOREIGN KEY (thread_id,user_id) REFERENCES workspace_members(thread_id,user_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS workspace_notifications_user ON workspace_notifications(user_id,created_at DESC,event_id DESC);
  CREATE INDEX IF NOT EXISTS workspace_notifications_message ON workspace_notifications(message_id) WHERE message_id IS NOT NULL;
  CREATE TRIGGER IF NOT EXISTS workspace_chat_notice AFTER INSERT ON workspace_messages WHEN NEW.project_id IS NULL
  BEGIN
    INSERT INTO workspace_notifications(thread_id,user_id,event_id,created_at,message_id)
      SELECT thread_id,user_id,NEW.id,NEW.created_at,NEW.id FROM workspace_members
      WHERE thread_id=NEW.thread_id AND status='active' AND user_id<>NEW.author_id
      ON CONFLICT(thread_id,user_id) DO UPDATE SET event_id=excluded.event_id,
        created_at=excluded.created_at,message_id=excluded.message_id;
  END;
  CREATE TRIGGER IF NOT EXISTS workspace_invite_notice AFTER INSERT ON workspace_members WHEN NEW.status='invited'
  BEGIN
    INSERT INTO workspace_notifications(thread_id,user_id,event_id,created_at)
      VALUES(NEW.thread_id,NEW.user_id,${invitationId},strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  END;
  CREATE TRIGGER IF NOT EXISTS workspace_clear_notice AFTER UPDATE OF status,unread ON workspace_members
  WHEN NEW.status<>OLD.status OR (NEW.status='active' AND NEW.unread=0)
  BEGIN
    DELETE FROM workspace_notifications WHERE thread_id=NEW.thread_id AND user_id=NEW.user_id;
  END;
  CREATE TABLE IF NOT EXISTS workspace_message_files (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES workspace_messages(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
    name TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 3145728 AND size=length(content)),
    content BLOB NOT NULL,
    UNIQUE (message_id,position)
  );
  CREATE INDEX IF NOT EXISTS workspace_file_author ON workspace_message_files(author_id);
  CREATE TABLE IF NOT EXISTS workspace_file_usage (
    author_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 67108864)
  );
  CREATE TRIGGER IF NOT EXISTS workspace_release_file_bytes AFTER DELETE ON workspace_message_files
  BEGIN
    UPDATE workspace_file_usage SET bytes=bytes-OLD.size WHERE author_id=OLD.author_id;
  END;
  CREATE TABLE IF NOT EXISTS workspace_steps (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    description TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS workspace_steps_project ON workspace_steps(project_id);
  CREATE TABLE IF NOT EXISTS workspace_receipts (
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation TEXT NOT NULL, client_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    thread_id TEXT REFERENCES workspace_threads(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES workspace_projects(id) ON DELETE SET NULL,
    PRIMARY KEY (actor_id, operation, client_id)
  );
  CREATE INDEX IF NOT EXISTS workspace_receipts_thread ON workspace_receipts(thread_id);
  CREATE TRIGGER IF NOT EXISTS workspace_empty_thread AFTER DELETE ON workspace_members
  WHEN OLD.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM workspace_members WHERE thread_id = OLD.thread_id AND status = 'active'
  )
  BEGIN
    DELETE FROM workspace_threads WHERE id = OLD.thread_id;
  END;
  CREATE TRIGGER IF NOT EXISTS workspace_erase_user BEFORE DELETE ON users
  BEGIN
    UPDATE workspace_threads SET revision=revision+1 WHERE creator_id=OLD.id OR id IN (
      SELECT thread_id FROM workspace_members WHERE user_id=OLD.id OR inviter_id=OLD.id
      UNION SELECT thread_id FROM workspace_messages WHERE author_id=OLD.id
      UNION SELECT thread_id FROM workspace_projects WHERE creator_id=OLD.id OR link_author=OLD.id
      UNION SELECT p.thread_id FROM workspace_steps s JOIN workspace_projects p ON p.id=s.project_id
        WHERE s.author_id=OLD.id OR s.assignee_id=OLD.id
    );
    UPDATE workspace_threads SET status='blocked' WHERE kind='direct' AND (peer_low=OLD.id OR peer_high=OLD.id);
    UPDATE workspace_threads SET name='' WHERE kind='group' AND creator_id=OLD.id;
    DELETE FROM workspace_members WHERE status='invited' AND inviter_id=OLD.id;
    UPDATE workspace_projects SET title='', goal='' WHERE creator_id=OLD.id;
    UPDATE workspace_projects SET link='' WHERE link_author=OLD.id;
  END;
`;

const receiptOperations = new Set(['direct', 'send', 'group', 'invite', 'createProject', 'step', 'update']);
const readOperations = new Set(['inbox', 'thread', 'export', 'attachment', 'exportAttachment', 'notifications', 'combinedBell']);
const MAX_FILE_TOTAL = 3 * 1024 * 1024;
const AUTHOR_FILE_QUOTA = 64 * 1024 * 1024;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export function createSqliteWorkspace(db) {
  if (!db.prepare('PRAGMA busy_timeout').get().timeout) db.exec('PRAGMA busy_timeout=5000');
  db.exec('BEGIN IMMEDIATE');
  try {
    const installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_notifications'").get();
    db.exec(schema);
    if (!installed) {
      // Older group unread flags also represent projects and membership. Only directs prove an incoming chat.
      // Historic invitation timestamps were never recorded.
      db.exec(`INSERT INTO workspace_notifications(thread_id,user_id,event_id)
        SELECT thread_id,user_id,${invitationId} FROM workspace_members WHERE status='invited';
        INSERT INTO workspace_notifications(thread_id,user_id,event_id,created_at,message_id)
        SELECT m.thread_id,m.user_id,p.id,p.created_at,p.id FROM workspace_members m
        JOIN workspace_threads t ON t.id=m.thread_id JOIN workspace_messages p ON p.rowid=(
          SELECT q.rowid FROM workspace_messages q WHERE q.thread_id=m.thread_id AND q.project_id IS NULL AND q.author_id<>m.user_id
          ORDER BY q.rowid DESC LIMIT 1)
        WHERE m.status='active' AND m.unread=1 AND t.kind='direct' AND t.status<>'blocked'`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const statements = new Map();
  function query(sql) {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  }
  const active = (id, actor) => query(`SELECT t.* FROM workspace_threads t JOIN workspace_members m ON m.thread_id=t.id
    WHERE t.id=? AND m.user_id=? AND m.status='active'`).get(id, actor);
  function requireMember(id, actor) {
    return active(id, actor) || fail(404, 'thread unavailable');
  }
  function requireGroup(thread) {
    if (thread.kind !== 'group') fail(400, 'a group is required');
  }
  function requireListed(id) {
    if (!query(`SELECT 1 FROM users WHERE id=? AND account_status='active'
      AND json_type(part_c_json,'$.consent')='true'`).get(id)) fail(404, 'member unavailable');
  }
  const pair = (a, b) => [a, b].sort();
  function directBetween(a, b) {
    return query('SELECT * FROM workspace_threads WHERE peer_low=? AND peer_high=?').get(...pair(a, b));
  }
  function notify(threadId, actor) {
    query('UPDATE workspace_threads SET touched_at=?,revision=revision+1 WHERE id=?').run(new Date().toISOString(), threadId);
    query("UPDATE workspace_members SET unread=1 WHERE thread_id=? AND user_id<>? AND status='active'").run(threadId, actor);
  }
  function invite(threadId, actor, target) {
    if (target === actor) fail(400, 'choose another member');
    requireListed(target);
    if (directBetween(actor, target)?.status === 'blocked') fail(403, 'contact unavailable');
    const result = query(`INSERT INTO workspace_members(thread_id,user_id,status,inviter_id) VALUES (?,?,'invited',?)
      ON CONFLICT(thread_id,user_id) DO NOTHING`).run(threadId, target, actor);
    if (result.changes) notify(threadId, actor);
  }
  function storeFiles(id, actor, files) {
    if (!Array.isArray(files)) fail(400, 'invalid attachments');
    if (files.length > 4) fail(413, 'too many attachments');
    if (!files.length) return;
    let total = 0;
    const prepared = files.map(file => {
      if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 160
          || typeof file.mime !== 'string' || !file.mime || file.mime.length > 128
          || !Number.isInteger(file.size) || file.size < 1 || typeof file.data !== 'string') fail(400, 'invalid attachment');
      total += file.size;
      if (total > MAX_FILE_TOTAL) fail(413, 'attachments too large');
      if (file.data.length !== 4 * Math.ceil(file.size / 3)) fail(400, 'invalid attachment bytes');
      const bytes = Buffer.from(file.data, 'base64');
      if (bytes.length !== file.size || bytes.toString('base64') !== file.data) fail(400, 'invalid attachment bytes');
      return bytes;
    });
    // One atomic reservation per message, even when the author's sends target different rooms.
    const reserved = query(`INSERT INTO workspace_file_usage(author_id,bytes) VALUES (?,?)
      ON CONFLICT(author_id) DO UPDATE SET bytes=workspace_file_usage.bytes+excluded.bytes
      WHERE workspace_file_usage.bytes+excluded.bytes<=?`).run(actor, total, AUTHOR_FILE_QUOTA);
    if (!reserved.changes) fail(413, 'attachment storage full');
    const insert = query(`INSERT INTO workspace_message_files(id,message_id,author_id,position,name,mime,size,content)
      VALUES (?,?,?,?,?,?,?,?)`);
    files.forEach((file, index) => insert.run(randomUUID(), id, actor, index, file.name, file.mime, file.size, prepared[index]));
  }
  function getFile(actor, id, own) {
    const scope = own ? 'm.author_id=?' : `EXISTS (SELECT 1 FROM workspace_members cm
      WHERE cm.thread_id=m.thread_id AND cm.user_id=? AND cm.status='active')`;
    const row = query(`SELECT f.id,f.name,f.mime,f.size,f.content FROM workspace_message_files f
      JOIN workspace_messages m ON m.id=f.message_id WHERE f.id=? AND ` + scope).get(id, actor);
    if (!row) fail(404, 'attachment unavailable');
    const { content, ...file } = row;
    return { ...file, data: Buffer.from(content).toString('base64') };
  }
  function message(thread, actor, body, files) {
    if (thread.kind === 'direct') {
      const peer = actor === thread.peer_low ? thread.peer_high : thread.peer_low;
      if (thread.status === 'blocked' || !query("SELECT 1 FROM users WHERE id=? AND account_status='active'").get(peer)) {
        fail(403, 'contact unavailable');
      }
      if (thread.status === 'pending') {
        if (thread.creator_id === actor) fail(409, 'awaiting a reply');
        query("UPDATE workspace_threads SET status='active' WHERE id=?").run(thread.id);
      }
    }
    appendMessage(thread.id, actor, body, null, files);
  }
  function appendMessage(threadId, actor, body = '', projectId = null, files = []) {
    if (typeof body !== 'string' || (!body.trim() && !files?.length)) fail(400, 'empty message');
    const id = randomUUID();
    query(`INSERT INTO workspace_messages(id, thread_id, project_id, author_id, body, created_at)
      VALUES (?,?,?,?,?,?)`).run(id, threadId, projectId, actor, body, new Date().toISOString());
    storeFiles(id, actor, files);
    notify(threadId, actor);
  }
  const summaries = `SELECT t.id,t.kind,t.status,t.revision,t.creator_id AS initiatorId,
    CASE WHEN t.kind='direct' THEN peer.full_name ELSE t.name END AS name, peer.id AS peerId, m.unread,
    CASE WHEN peer.account_status='active' AND json_type(peer.part_c_json,'$.consent')='true' THEN peer.photo_revision END AS photoRevision,
    substr(latest.body,1,180) AS preview, latest.author_id AS lastAuthor, latest.created_at AS lastAt,
    EXISTS (SELECT 1 FROM workspace_message_files f WHERE f.message_id=latest.id) AS hasFiles
    FROM workspace_members m JOIN workspace_threads t ON t.id=m.thread_id
    LEFT JOIN workspace_messages latest ON latest.rowid=(SELECT p.rowid FROM workspace_messages p
      WHERE p.thread_id=t.id AND p.project_id IS NULL ORDER BY p.rowid DESC LIMIT 1)
    LEFT JOIN users peer ON peer.id=CASE WHEN m.user_id=t.peer_low THEN t.peer_high ELSE t.peer_low END
    WHERE m.user_id=? AND m.status='active'`;
  function summary(row) {
    const { id, kind, status, revision, unread } = row;
    const result = { id, kind, status, revision, name: row.name || '', unread: Boolean(unread) };
    result.lastMessage = row.lastAt ? { body: row.preview, authorId: row.lastAuthor, createdAt: row.lastAt,
      hasAttachments: Boolean(row.hasFiles) } : null;
    if (kind === 'direct') Object.assign(result, { peerId: row.peerId, initiatorId: row.initiatorId }, profilePhotoFields(row.peerId, row.photoRevision));
    return result;
  }
  function inbox(actor) {
    const threads = query(summaries + ' ORDER BY t.touched_at DESC,t.rowid DESC').all(actor).map(summary);
    const invitations = query(`SELECT t.id,t.name,u.full_name AS inviterName FROM workspace_members m
      JOIN workspace_threads t ON t.id=m.thread_id JOIN users u ON u.id=m.inviter_id
      WHERE m.user_id=? AND m.status='invited' ORDER BY m.rowid DESC`).all(actor);
    return { threads, invitations };
  }
  function notifications(actor) {
    const rows = query(`SELECT n.event_id AS id, CASE WHEN n.message_id IS NULL THEN 'invitation' ELSE 'message' END AS type,
      t.id AS threadId,t.kind AS threadKind,t.name AS groupName,u.full_name AS actorName,n.created_at AS createdAt,count(*) OVER() AS total
      FROM workspace_notifications n JOIN workspace_members m ON m.thread_id=n.thread_id AND m.user_id=n.user_id
      JOIN workspace_threads t ON t.id=n.thread_id LEFT JOIN workspace_messages p ON p.id=n.message_id
      JOIN users u ON u.id=coalesce(p.author_id,m.inviter_id) AND u.account_status='active'
      WHERE n.user_id=? AND t.status<>'blocked' AND ((m.status='invited' AND n.message_id IS NULL)
        OR (m.status='active' AND m.unread=1 AND n.message_id IS NOT NULL))
      ORDER BY n.created_at DESC,n.event_id DESC LIMIT 20`).all(actor);
    return { total: rows[0]?.total || 0, items: rows.map(row => {
      const { id, type, threadId, threadKind, groupName, actorName, createdAt } = row;
      return { id, type, threadId, threadKind, groupName, actorName, createdAt };
    }) };
  }
  const contentRows = `SELECT m.id,m.author_id AS authorId,u.full_name AS authorName,m.body,m.created_at AS createdAt
    FROM workspace_messages m JOIN users u ON u.id=m.author_id`;
  function detail(actor, id, beforeMessageId) {
    const row = query(summaries + ' AND t.id=?').get(actor, id);
    if (!row) fail(404, 'thread unavailable');
    const members = query(`SELECT u.id,u.full_name AS name,m.status FROM workspace_members m
      JOIN users u ON u.id=m.user_id WHERE m.thread_id=? ORDER BY m.rowid`).all(id);
    const messageScope = contentRows + ' WHERE m.thread_id=? AND m.project_id IS NULL';
    let page;
    if (beforeMessageId) {
      const cursor = query('SELECT rowid FROM workspace_messages WHERE id=? AND thread_id=? AND project_id IS NULL').get(beforeMessageId, id);
      if (!cursor) fail(404, 'message unavailable');
      page = query(messageScope + ' AND m.rowid < ? ORDER BY m.rowid DESC LIMIT 51').all(id, cursor.rowid);
    } else {
      page = query(messageScope + ' ORDER BY m.rowid DESC LIMIT 51').all(id);
    }
    const moreMessages = page.length > 50;
    const messages = page.slice(0, 50).reverse();
    for (const item of messages) item.attachments = [];
    if (messages.length) {
      const byId = new Map(messages.map(item => [item.id, item]));
      const files = query(`SELECT id,message_id AS messageId,name,mime,size FROM workspace_message_files
        WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY message_id,position`)
        .all(JSON.stringify(messages.map(item => item.id)));
      for (const { messageId, ...file } of files) byId.get(messageId).attachments.push(file);
    }
    const projects = query('SELECT id,title,goal,link FROM workspace_projects WHERE thread_id=? ORDER BY rowid').all(id);
    if (projects.length) {
      const byId = new Map(projects.map(project => [project.id, Object.assign(project, { steps: [], updates: [] })]));
      const steps = query(`SELECT s.project_id AS projectId,s.id,s.description,s.assignee_id AS assigneeId,s.done
        FROM workspace_steps s JOIN workspace_projects p ON p.id=s.project_id WHERE p.thread_id=? ORDER BY s.rowid`).all(id);
      for (const { projectId, done, ...step } of steps) byId.get(projectId).steps.push({ ...step, done: Boolean(done) });
      const updates = query(contentRows.replace('SELECT ', 'SELECT m.project_id AS projectId, ')
        + ' WHERE m.thread_id=? AND m.project_id IS NOT NULL ORDER BY m.rowid').all(id);
      for (const { projectId, ...update } of updates) byId.get(projectId).updates.push(update);
    }
    return { thread: summary(row), members, messages, projects, moreMessages };
  }
  function exportOwn(actor) {
    const memberships = query(`SELECT m.thread_id AS threadId,t.kind,m.status FROM workspace_members m
      JOIN workspace_threads t ON t.id=m.thread_id WHERE m.user_id=? ORDER BY m.rowid`).all(actor);
    const messages = query(`SELECT id,thread_id AS threadId,body,created_at AS createdAt FROM workspace_messages
      WHERE author_id=? AND project_id IS NULL ORDER BY rowid`).all(actor);
    const groups = query("SELECT id,name FROM workspace_threads WHERE creator_id=? AND kind='group' ORDER BY rowid").all(actor);
    const projects = query('SELECT id,thread_id AS threadId,title,goal FROM workspace_projects WHERE creator_id=? ORDER BY rowid').all(actor);
    const links = query('SELECT id AS projectId,link FROM workspace_projects WHERE link_author=? ORDER BY rowid').all(actor);
    const steps = query('SELECT id,project_id AS projectId,description,done FROM workspace_steps WHERE author_id=? ORDER BY rowid')
      .all(actor).map(row => ({ ...row, done: Boolean(row.done) }));
    const updates = query(`SELECT id,project_id AS projectId,body,created_at AS createdAt FROM workspace_messages
      WHERE author_id=? AND project_id IS NOT NULL ORDER BY rowid`).all(actor);
    const attachments = query(`SELECT f.id,f.message_id AS messageId,m.thread_id AS threadId,f.name,f.mime,f.size,
      '/api/me/export/attachments/' || f.id AS downloadUrl FROM workspace_messages m
      JOIN workspace_message_files f ON f.message_id=m.id WHERE m.author_id=? ORDER BY m.rowid,f.position`).all(actor);
    return { memberships, messages, groups, projects, links, steps, updates, attachments };
  }
  function write(actor, op, data) {
    if (op === 'direct') {
      const { targetId, body } = data;
      if (actor === targetId) fail(400, 'choose another member');
      const existing = directBetween(actor, targetId);
      if (existing) {
        message(existing, actor, body, data.attachments);
        return { threadId: existing.id };
      }
      requireListed(targetId);
      const threadId = randomUUID();
      query(`INSERT INTO workspace_threads(id,kind,creator_id,peer_low,peer_high,status,touched_at)
        VALUES (?,'direct',?,?,?,'pending',?)`).run(threadId, actor, ...pair(actor, targetId), new Date().toISOString());
      query("INSERT INTO workspace_members(thread_id,user_id,status) VALUES (?,?,'active'),(?,?,'active')")
        .run(threadId, actor, threadId, targetId);
      appendMessage(threadId, actor, body, null, data.attachments);
      return { threadId };
    }
    if (op === 'group') {
      const threadId = randomUUID();
      query(`INSERT INTO workspace_threads(id,kind,name,creator_id,status,touched_at)
        VALUES (?,'group',?,?,'active',?)`).run(threadId, data.name, actor, new Date().toISOString());
      query("INSERT INTO workspace_members(thread_id,user_id,status) VALUES (?,?,'active')").run(threadId, actor);
      for (const target of new Set(data.targetIds)) invite(threadId, actor, target);
      return { threadId };
    }
    const { threadId, projectId } = data;
    if (op === 'accept' || op === 'decline') {
      const invitation = query("SELECT 1 FROM workspace_members WHERE thread_id=? AND user_id=? AND status='invited'").get(threadId, actor);
      if (!invitation) fail(404, 'invitation unavailable');
      if (op === 'accept') {
        query("UPDATE workspace_members SET status='active',inviter_id=NULL WHERE thread_id=? AND user_id=?").run(threadId, actor);
      } else {
        query('DELETE FROM workspace_members WHERE thread_id=? AND user_id=?').run(threadId, actor);
      }
      notify(threadId, actor);
      return { threadId };
    }
    const thread = requireMember(threadId, actor);
    if (op === 'send') message(thread, actor, data.body, data.attachments);
    else if (op === 'read') {
      if (thread.revision === data.revision) {
        query('UPDATE workspace_members SET unread=0 WHERE thread_id=? AND user_id=?').run(threadId, actor);
      }
    }
    else if (op === 'block') {
      if (thread.kind !== 'direct') fail(400, 'a direct conversation is required');
      if (thread.status === 'blocked') return { threadId };
      const peer = actor === thread.peer_low ? thread.peer_high : thread.peer_low;
      query("UPDATE workspace_threads SET status='blocked',revision=revision+1 WHERE id=?").run(threadId);
      const removed = query(`DELETE FROM workspace_members WHERE status='invited' AND
        ((user_id=? AND inviter_id=?) OR (user_id=? AND inviter_id=?)) RETURNING thread_id`).all(actor, peer, peer, actor);
      for (const { thread_id: groupId } of removed) notify(groupId, actor);
      query('UPDATE workspace_members SET unread=0 WHERE thread_id=?').run(threadId);
    } else {
      requireGroup(thread);
      if (op === 'invite') invite(threadId, actor, data.targetId);
      else if (op === 'leave') {
        query("DELETE FROM workspace_members WHERE thread_id=? AND status='invited' AND inviter_id=?").run(threadId, actor);
        query(`UPDATE workspace_steps SET assignee_id=NULL WHERE assignee_id=?
          AND project_id IN (SELECT id FROM workspace_projects WHERE thread_id=?)`).run(actor, threadId);
        query('DELETE FROM workspace_members WHERE thread_id=? AND user_id=?').run(threadId, actor);
        notify(threadId, actor);
      } else if (op === 'createProject') {
        const id = randomUUID();
        query('INSERT INTO workspace_projects(id,thread_id,creator_id,title,goal) VALUES (?,?,?,?,?)')
          .run(id, threadId, actor, data.title, data.goal);
        notify(threadId, actor);
        return { threadId, projectId: id };
      } else {
        if (!query('SELECT 1 FROM workspace_projects WHERE id=? AND thread_id=?').get(projectId, threadId)) fail(404, 'project unavailable');
        if (op === 'step') {
          if (data.assigneeId && !active(threadId, data.assigneeId)) fail(400, 'choose a group member');
          query('INSERT INTO workspace_steps(id,project_id,author_id,assignee_id,description) VALUES (?,?,?,?,?)')
            .run(randomUUID(), projectId, actor, data.assigneeId ?? null, data.description);
        } else if (op === 'toggle') {
          const updated = query('UPDATE workspace_steps SET done=? WHERE project_id=? AND id=?').run(Number(data.done), projectId, data.stepId);
          if (!updated.changes) fail(404, 'step unavailable');
        } else if (op === 'link') {
          query('UPDATE workspace_projects SET link=?,link_author=? WHERE id=?').run(data.link, actor, projectId);
        } else if (op === 'update') {
          appendMessage(threadId, actor, data.body, projectId);
          return { threadId };
        } else fail(400, 'unknown operation');
        notify(threadId, actor);
      }
    }
    return { threadId };
  }
  function perform(actor, op, data) {
    if (!query("SELECT 1 FROM users WHERE id=? AND account_status='active'").get(actor)) fail(403, 'account unavailable');
    if (op === 'sendFiles' || op === 'directFiles') {
      if (!Array.isArray(data.attachments) || !data.attachments.length) fail(400, 'attachments required');
      // Both wire forms share one receipt for a deliberate send.
      op = op === 'sendFiles' ? 'send' : 'direct';
    }
    if (op === 'inbox') return inbox(actor);
    if (op === 'notifications') return notifications(actor);
    if (op === 'combinedBell') return combinedBell(query, actor, notifications(actor));
    if (op === 'readPublication') return readEditorial(query, actor, data.eventId);
    if (op === 'export') return exportOwn(actor);
    if (op === 'attachment' || op === 'exportAttachment') return getFile(actor, data.attachmentId, op === 'exportAttachment');
    if (op === 'thread') return detail(actor, data.threadId, data.beforeMessageId);
    if (!receiptOperations.has(op)) return write(actor, op, data);
    // Save a digest so receipts can detect a changed retry without retaining duplicate private text.
    const canonical = JSON.stringify(data, (_key, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    });
    const fingerprint = createHash('sha256').update(canonical).digest('hex');
    const receipt = query(`SELECT thread_id AS threadId,project_id AS projectId,fingerprint FROM workspace_receipts
      WHERE actor_id=? AND operation=? AND client_id=?`).get(actor, op, data.clientId);
    if (receipt) {
      requireMember(receipt.threadId, actor);
      if (receipt.fingerprint !== fingerprint) fail(409, 'client ID already used');
      return receipt.projectId ? { threadId: receipt.threadId, projectId: receipt.projectId } : { threadId: receipt.threadId };
    }
    const result = write(actor, op, data);
    query(`INSERT INTO workspace_receipts(actor_id,operation,client_id,fingerprint,thread_id,project_id)
      VALUES (?,?,?,?,?,?)`).run(actor, op, data.clientId, fingerprint, result.threadId, result.projectId ?? null);
    return result;
  }
  return {
    execute(actor, op, data = {}) {
      db.exec(readOperations.has(op) ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try {
        const result = perform(actor, op, data);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
