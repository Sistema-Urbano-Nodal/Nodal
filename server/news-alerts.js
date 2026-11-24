import {createSupabaseClients} from './supabase.js';
import {createMailTransport} from './mailer.js';
import {publicationEmail} from './publication-email.js';

// Membership in this table is a voluntary preference for news published after the member joined.
export const SQLITE_NEWS_ALERTS = `
CREATE TABLE IF NOT EXISTS news_email_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'es' CHECK(language IN ('en','es','pt')),
  subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, notice_version TEXT NOT NULL DEFAULT 'news-v1'
);
CREATE TABLE IF NOT EXISTS news_email_events (
  event_id TEXT PRIMARY KEY,
  news_id TEXT UNIQUE REFERENCES nodal_news(id) ON DELETE CASCADE,
  catalog_id TEXT UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
  CHECK((news_id IS NULL) <> (catalog_id IS NULL))
);
CREATE TABLE IF NOT EXISTS news_email_outbox (
  event_id TEXT NOT NULL REFERENCES news_email_events(event_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES news_email_preferences(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS news_email_dispatch ON news_email_outbox(status,available_at);
CREATE INDEX IF NOT EXISTS news_email_user ON news_email_outbox(user_id);
CREATE TRIGGER IF NOT EXISTS news_email_enqueue AFTER INSERT ON news_email_events
WHEN NEW.event_id='n:'||NEW.news_id OR NEW.event_id='c:'||NEW.catalog_id BEGIN
  INSERT INTO news_email_outbox(event_id,user_id) SELECT NEW.event_id,user_id FROM news_email_preferences WHERE notice_version NOT LIKE 'qa:%';
END;
CREATE TRIGGER IF NOT EXISTS news_email_publish_insert AFTER INSERT ON nodal_news
WHEN NEW.status='published' BEGIN
  INSERT INTO news_email_events(event_id,news_id) VALUES('n:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS news_email_publish_update AFTER UPDATE OF status ON nodal_news
WHEN NEW.status='published' AND OLD.published_at IS NULL BEGIN
  INSERT INTO news_email_events(event_id,news_id) VALUES('n:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS news_email_catalog_insert AFTER INSERT ON catalog_items
WHEN NEW.status='published' AND NEW.visibility='public' AND NEW.featured AND NEW.kind='opportunity' BEGIN
  INSERT INTO news_email_events(event_id,catalog_id) VALUES('c:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS news_email_catalog_update AFTER UPDATE OF status,visibility,featured,kind ON catalog_items
WHEN NEW.status='published' AND NEW.visibility='public' AND NEW.featured AND NEW.kind='opportunity'
 AND NOT(OLD.status='published' AND OLD.visibility='public' AND OLD.featured AND OLD.kind='opportunity') BEGIN
  INSERT INTO news_email_events(event_id,catalog_id) VALUES('c:'||NEW.id,NEW.id) ON CONFLICT DO NOTHING;
END;`;

export function createNewsAlerts({db,clients,env,fetchImpl}){
  if(db){
    // Each SQLite write statement is atomic. Resolve content again after the claim before building the email.
    const eligible=` FROM news_email_outbox o JOIN news_email_events e ON e.event_id=o.event_id
      JOIN users u ON u.id=o.user_id JOIN news_email_preferences p ON p.user_id=o.user_id
      LEFT JOIN nodal_news n ON n.id=e.news_id LEFT JOIN catalog_items c ON c.id=e.catalog_id
      WHERE u.account_status='active' AND (
        (p.notice_version NOT LIKE 'qa:%' AND e.event_id='n:'||n.id AND n.status='published') OR
        (p.notice_version NOT LIKE 'qa:%' AND e.event_id='c:'||c.id AND c.status='published' AND c.visibility='public' AND c.featured AND c.kind='opportunity') OR
        (e.event_id='test:'||o.user_id||':'||n.id AND n.status='draft'))`;
    const claim=db.prepare(`UPDATE news_email_outbox SET status='sending',attempts=attempts+1
      WHERE (event_id,user_id)=(SELECT o.event_id,o.user_id ${eligible} AND o.status='queued' AND o.available_at<=unixepoch()
        ORDER BY o.available_at,o.event_id,o.user_id LIMIT 1) RETURNING event_id,user_id`);
    const details=db.prepare(`SELECT o.event_id,o.user_id,o.attempts,e.news_id,e.catalog_id,u.email,p.language,
      coalesce(n.title,json_extract(c.translations_json,'$.'||p.language||'.title')) AS title,n.url,
      coalesce(n.body,nullif(trim(json_extract(c.translations_json,'$.'||p.language||'.summary')),''),
        json_extract(c.translations_json,'$.'||p.language||'.body'),'') AS excerpt,
      coalesce(n.public_byline,c.public_byline,'') AS byline,coalesce(c.organization,'') AS organization,
      CASE WHEN n.status='published' AND n.cover_revision<>'' THEN '/api/publication-covers/news/'||n.id||'/'||n.cover_revision||'.jpg'
           WHEN c.cover_revision<>'' THEN '/api/publication-covers/opportunity/'||c.id||'/'||c.cover_revision||'.jpg'
           ELSE '' END AS cover_url,
      CASE WHEN n.status='published' THEN n.cover_alt ELSE coalesce(c.cover_alt,'') END AS cover_alt
      ${eligible} AND o.event_id=? AND o.user_id=?`);
    return {
      async exportFor(user){
        return {subscription:db.prepare("SELECT language,subscribed_at,notice_version FROM news_email_preferences WHERE user_id=? AND notice_version NOT LIKE 'qa:%'").get(user)??null,
          deliveries:db.prepare('SELECT e.news_id,e.catalog_id,o.status,o.attempts FROM news_email_outbox o JOIN news_email_events e USING(event_id) WHERE o.user_id=? ORDER BY o.event_id').all(user)};
      },
      async preference(user){return Boolean(db.prepare("SELECT 1 FROM news_email_preferences WHERE user_id=? AND notice_version NOT LIKE 'qa:%'").get(user));},
      async subscribe(user,enabled,language='es'){
        if(enabled)db.prepare(`INSERT INTO news_email_preferences(user_id,language) VALUES(?,?)
          ON CONFLICT(user_id) DO UPDATE SET language=excluded.language,subscribed_at=excluded.subscribed_at,notice_version=excluded.notice_version
          WHERE news_email_preferences.notice_version LIKE 'qa:%'`).run(user,language);
        else db.prepare('DELETE FROM news_email_preferences WHERE user_id=?').run(user);
      },
      async claim(){const job=claim.get();return job?details.get(job.event_id,job.user_id)??null:null;},
      async settle(job,status){db.prepare(`UPDATE news_email_outbox SET status=?,available_at=unixepoch()+900
        WHERE event_id=? AND user_id=? AND status='sending' AND attempts=?`).run(status,job.event_id,job.user_id,job.attempts);},
    };
  }
  const {admin}=clients??createSupabaseClients({env,fetchImpl});
  return {
    async exportFor(user){return admin.rest('rpc/export_news_email',{method:'POST',body:{p_user:user}});},
    async preference(user){const rows=await admin.rest('news_email_preferences',{query:{select:'user_id',user_id:'eq.'+user,notice_version:'not.like.qa:*',limit:1}});return rows.length>0;},
    async subscribe(user,enabled,language='es'){
      if(enabled)await admin.rest('rpc/subscribe_news_email',{method:'POST',body:{p_user:user,p_language:language}});
      else await admin.rest('news_email_preferences',{method:'DELETE',query:{user_id:'eq.'+user}});
    },
    async claim(){const rows=await admin.rest('rpc/claim_publication_email_with_cover',{method:'POST',body:{}});return rows[0]??null;},
    async settle(job,status){await admin.rest('news_email_outbox',{method:'PATCH',
      query:{event_id:'eq.'+job.event_id,user_id:'eq.'+job.user_id,status:'eq.sending',attempts:'eq.'+job.attempts},
      body:{status,available_at:new Date(Date.now()+900000).toISOString()}});},
  };
}

export function createNewsEmailSender(env=process.env){
  const transport=createMailTransport({env});
  if(!transport||!env.PUBLIC_BASE_URL)throw Error('Configure SMTP and PUBLIC_BASE_URL before enabling delivery');
  const replyTo=env.EMAIL_REPLY_TO?transport.replyTo:transport.from;
  return (alerts,options)=>deliverBatch({...options,alerts,origin:env.PUBLIC_BASE_URL,
    send:message=>transport.send({...message,replyTo})});
}

export async function deliverBatch({alerts,send,origin,limit=10,deadline=Infinity}){
  const site=new URL(origin);
  if(site.protocol!=='https:'||site.username||site.password)throw Error('a public HTTPS origin is required');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('invalid batch size');
  const counts={sent:0,failed:0,uncertain:0,deferred:0};
  for(let i=0;i<limit&&Date.now()<deadline;i++){
    const job=await alerts.claim();
    if(!job)break;
    let status='sent';
    try{
      const title=job.title.trim();
      const deliveryTest=job.event_id.startsWith('test:');
      let destination=job.catalog_id
        ?new URL('/opportunities.html?id='+encodeURIComponent(job.catalog_id),site).href
        :new URL('/community.html?news='+encodeURIComponent(job.news_id)+'#nodal-news',site).href;
      if(deliveryTest)destination=new URL('/community.html#nodal-news',site).href;
      else if(job.url){
        const link=new URL(job.url);
        if(link.protocol==='https:'&&!link.username&&!link.password)destination=link.href;
      }
      const message=publicationEmail({
        language:job.language,title,opportunity:Boolean(job.catalog_id),destination,origin:site.origin,
        excerpt:job.excerpt,authorName:job.byline,organizationName:job.organization,
        coverUrl:job.cover_url,coverAlt:job.cover_alt,
      });
      await send({to:job.email,fromName:'NODAL',...message});
    }catch(error){
      // A lost acknowledgement may already be in the inbox. Retry only confirmed, temporary refusals.
      status=error.delivery!=='no'?'uncertain':!error.permanent&&job.attempts<3?'queued':'failed';
    }
    await alerts.settle(job,status);
    counts[status==='queued'?'deferred':status]++;
  }
  return counts;
}
