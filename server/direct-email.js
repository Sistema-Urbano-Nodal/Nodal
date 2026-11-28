import { createSupabaseClients } from './supabase.js';
import { createMailTransport } from './mailer.js';
import { emailLetter } from './email-letter.js';

const queueNotice = `
  INSERT INTO direct_email_outbox(thread_id,user_id,event_id)
    SELECT t.id,p.user_id,NEW.message_id FROM workspace_threads t
    JOIN direct_email_preferences p ON p.user_id=NEW.user_id
    JOIN workspace_messages m ON m.id=NEW.message_id AND m.author_id<>p.user_id AND m.project_id IS NULL
    WHERE t.id=NEW.thread_id AND t.kind='direct' AND t.status<>'blocked'
  ON CONFLICT(thread_id,user_id) DO UPDATE SET event_id=excluded.event_id,status='queued',
    attempts=0,available_at=unixepoch() WHERE direct_email_outbox.event_id<>excluded.event_id;`;

export const SQLITE_DIRECT_EMAIL = `
  CREATE TABLE IF NOT EXISTS direct_email_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users ON DELETE CASCADE,
    language TEXT NOT NULL CHECK(language IN ('es','en','pt')),
    subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS direct_email_outbox (
    thread_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES direct_email_preferences ON DELETE CASCADE,
    event_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','uncertain','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY(thread_id,user_id),
    FOREIGN KEY(thread_id,user_id) REFERENCES workspace_notifications(thread_id,user_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS direct_email_queue ON direct_email_outbox(available_at,event_id) WHERE status='queued';
  CREATE INDEX IF NOT EXISTS direct_email_recipient ON direct_email_outbox(user_id);
  CREATE TRIGGER IF NOT EXISTS direct_email_enqueue AFTER INSERT ON workspace_notifications
    WHEN NEW.message_id IS NOT NULL BEGIN ${queueNotice} END;
  CREATE TRIGGER IF NOT EXISTS direct_email_replace AFTER UPDATE OF event_id ON workspace_notifications
    WHEN NEW.message_id IS NOT NULL AND NEW.event_id<>OLD.event_id BEGIN ${queueNotice} END;
`;

export function createDirectEmailStore({ db, clients, env } = {}) {
  if (db) {
    const preference = db.prepare('SELECT language,subscribed_at FROM direct_email_preferences WHERE user_id=?');
    const claim = db.prepare(`UPDATE direct_email_outbox SET status='sending',attempts=attempts+1
      WHERE (thread_id,user_id)=(SELECT thread_id,user_id FROM direct_email_outbox
        WHERE status='queued' AND available_at<=unixepoch() ORDER BY available_at,event_id LIMIT 1)
      RETURNING thread_id,user_id,event_id,attempts`);
    const recipient = db.prepare(`SELECT u.email,p.language FROM direct_email_outbox o
      JOIN direct_email_preferences p ON p.user_id=o.user_id JOIN users u ON u.id=p.user_id
      JOIN workspace_threads t ON t.id=o.thread_id JOIN workspace_members m ON m.thread_id=t.id AND m.user_id=u.id
      JOIN workspace_notifications n ON n.thread_id=m.thread_id AND n.user_id=u.id AND n.message_id=o.event_id
      JOIN workspace_messages msg ON msg.id=n.message_id AND msg.author_id<>u.id AND msg.project_id IS NULL
      JOIN users sender ON sender.id=msg.author_id AND sender.account_status='active'
      WHERE o.thread_id=? AND o.user_id=? AND o.event_id=? AND o.attempts=? AND o.status='sending'
        AND u.account_status='active' AND t.kind='direct' AND t.status<>'blocked' AND m.status='active' AND m.unread=1`);
    const jobKey = job => [job.thread_id, job.user_id, job.event_id, job.attempts];
    return {
      preference: user => preference.get(user) ?? null,
      setPreference(user, enabled, language) {
        if (enabled) {
          db.prepare(`INSERT INTO direct_email_preferences(user_id,language) VALUES(?,?)
            ON CONFLICT(user_id) DO UPDATE SET language=excluded.language`).run(user, language);
        } else {
          db.prepare('DELETE FROM direct_email_preferences WHERE user_id=?').run(user);
        }
      },
      claim: () => claim.get(),
      recipient: job => recipient.get(...jobKey(job)),
      settle: (job,status) => db.prepare(`UPDATE direct_email_outbox SET status=?,available_at=unixepoch()+900
        WHERE thread_id=? AND user_id=? AND event_id=? AND attempts=? AND status='sending'`).run(status,...jobKey(job)),
      exportFor: user => ({
        subscription: preference.get(user) ?? null,
        deliveries: db.prepare('SELECT event_id,status,attempts FROM direct_email_outbox WHERE user_id=? ORDER BY event_id').all(user),
      }),
    };
  }
  const rest = (path, options) => {
    clients ??= createSupabaseClients({ env });
    return clients.admin.rest(path, options);
  };
  return {
    async preference(user) {
      const rows = await rest('direct_email_preferences', {query: {select: 'language,subscribed_at', user_id: 'eq.' + user, limit: 1}});
      return rows[0] ?? null;
    },
    setPreference(user, enabled, language) {
      if (!enabled) return rest('direct_email_preferences', {method: 'DELETE', query: {user_id: 'eq.' + user}});
      return rest('direct_email_preferences', {
        method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}, body: {user_id: user, language},
      });
    },
    claim: async () => (await rest('rpc/claim_direct_email', {method: 'POST', body: {}}))[0],
    async recipient(job) {
      const rows = await rest('rpc/direct_email_recipient', {method: 'POST', body: {
        p_thread: job.thread_id, p_user: job.user_id, p_event: job.event_id, p_attempt: job.attempts,
      }});
      return rows[0];
    },
    settle: (job, status) => rest('direct_email_outbox', {
      method: 'PATCH',
      query: {
        thread_id: 'eq.' + job.thread_id, user_id: 'eq.' + job.user_id, event_id: 'eq.' + job.event_id,
        attempts: 'eq.' + job.attempts, status: 'eq.sending',
      },
      body: {status, available_at: new Date(Date.now() + 15 * 60_000).toISOString()},
    }),
    exportFor: user => rest('rpc/export_direct_email', {method: 'POST', body: {p_user: user}}),
  };
}

const copy = {
  en: ['New private message on NODAL','You have a new private message. Sign in to read it.','Open messages','Manage email notifications'],
  es: ['Nuevo mensaje privado en NODAL','Tienes un nuevo mensaje privado. Inicia sesión para leerlo.','Abrir mensajes','Configurar avisos por correo'],
  pt: ['Nova mensagem privada na NODAL','Você recebeu uma nova mensagem privada. Entre na sua conta para ler.','Abrir mensagens','Ajustar avisos por e-mail'],
};

export function directMessageEmail(language, origin) {
  const [subject, body, open, manage] = copy[language] ?? copy.es;
  const inbox = new URL('/messages.html', origin);
  const settings = inbox.href + '?settings=email';
  const letter = emailLetter(language, inbox.origin);
  const html = letter.document({
    subject, preheader: body,
    body: letter.lockup + letter.p(body) + letter.pressPlate(inbox.href, open) + letter.p(letter.a(settings, manage)),
  });
  return {subject, language, text: [body, open + ' — ' + inbox.href, manage + ' — ' + settings].join('\n\n'), html};
}

export function createDirectEmailSender(env = process.env) {
  const transport = createMailTransport({env});
  if (!transport || !env.PUBLIC_BASE_URL) throw Error('Configure SMTP and PUBLIC_BASE_URL before enabling delivery');
  const site = new URL(env.PUBLIC_BASE_URL);
  const preview = transport.loopback && env.NODE_ENV !== 'production' && ['localhost','127.0.0.1','[::1]'].includes(site.hostname);
  if (site.username || site.password || (site.protocol !== 'https:' && !(preview && site.protocol === 'http:'))) throw Error('A public HTTPS origin is required');
  const replyTo = env.EMAIL_REPLY_TO ? transport.replyTo : transport.from;
  return (store, options) => deliverDirectEmail({
    ...options, store, origin: site.origin,
    send: message => transport.send({...message, fromName: 'NODAL', replyTo}),
  });
}

export async function deliverDirectEmail({store, send, origin, limit = 10, deadline = Infinity}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid batch size');
  const counts = {sent: 0, failed: 0, uncertain: 0, deferred: 0, skipped: 0};
  for (let i = 0; i < limit && Date.now() < deadline; i++) {
    const job = await store.claim();
    if (!job) break;
    let status = 'skipped';
    let attempted = false;
    try {
      // A read, block, new message or opt-out may have arrived between enqueue and claim.
      const recipient = await store.recipient(job);
      if (recipient) {
        const mail = directMessageEmail(recipient.language, origin);
        attempted = true;
        await send({to: recipient.email, ...mail});
        status = 'sent';
      }
    } catch (err) {
      // A lost acknowledgement could mean SMTP already accepted the mail. Never replay it automatically.
      if (attempted && err.delivery !== 'no') status = 'uncertain';
      else status = !err.permanent && job.attempts < 3 ? 'queued' : 'failed';
    }
    await store.settle(job, status);
    counts[status === 'queued' ? 'deferred' : status]++;
  }
  return counts;
}
