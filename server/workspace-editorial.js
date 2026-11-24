// Capture the first eligible publication once. Private email tests and preexisting
// publications never receive a bell timestamp. Read receipts disappear with their source or member.
export const SQLITE_EDITORIAL_BELL = `
CREATE TABLE IF NOT EXISTS workspace_editorial_events (
  event_id TEXT PRIMARY KEY REFERENCES news_email_events(event_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS workspace_editorial_recent ON workspace_editorial_events(created_at DESC,event_id DESC);
CREATE TABLE IF NOT EXISTS workspace_editorial_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES workspace_editorial_events(event_id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS workspace_editorial_read_event ON workspace_editorial_reads(event_id);
CREATE TRIGGER IF NOT EXISTS workspace_record_editorial AFTER INSERT ON news_email_events
WHEN NEW.event_id='n:'||NEW.news_id OR NEW.event_id='c:'||NEW.catalog_id BEGIN
  INSERT INTO workspace_editorial_events(event_id) VALUES(NEW.event_id);
END;
CREATE VIEW IF NOT EXISTS workspace_visible_editorial AS
  SELECT e.event_id,e.created_at,n.id,'news' AS type,json_quote(n.title) AS title
  FROM workspace_editorial_events e JOIN news_email_events source USING(event_id)
  JOIN nodal_news n ON n.id=source.news_id AND n.status='published'
  UNION ALL
  SELECT e.event_id,e.created_at,c.id,'opportunity',json_object(
    'en',json_extract(c.translations_json,'$.en.title'),'es',json_extract(c.translations_json,'$.es.title'),
    'pt',json_extract(c.translations_json,'$.pt.title'))
  FROM workspace_editorial_events e JOIN news_email_events source USING(event_id)
  JOIN catalog_items c ON c.id=source.catalog_id AND c.status='published' AND c.visibility='public'
    AND c.featured AND c.kind='opportunity';
`;

const forMember = `FROM workspace_visible_editorial e JOIN users u ON u.id=? AND e.created_at>=u.created_at`;

export function readEditorial(query, actor, eventId) {
  query(`INSERT INTO workspace_editorial_reads(user_id,event_id)
    SELECT u.id,e.event_id ${forMember} WHERE e.event_id=? ON CONFLICT DO NOTHING`).run(actor,eventId);
  return {ok:true};
}

export function combinedBell(query, actor, workspace) {
  const rows = query(`SELECT e.id,e.type,e.created_at AS createdAt,e.title,count(*) OVER() AS total ${forMember}
    WHERE NOT EXISTS(SELECT 1 FROM workspace_editorial_reads r WHERE r.user_id=u.id AND r.event_id=e.event_id)
    ORDER BY e.created_at DESC,e.id DESC,e.type DESC LIMIT 20`).all(actor);
  const items = [...workspace.items, ...rows.map(({id,type,createdAt,title}) => ({id,type,createdAt,title:JSON.parse(title)}))];
  const descending = (a,b) => a < b ? 1 : a > b ? -1 : 0;
  items.sort((a,b) => descending(a.createdAt || '',b.createdAt || '') || descending(a.id,b.id) || descending(a.type,b.type));
  return {workspaceTotal:workspace.total,total:workspace.total+(rows[0]?.total || 0),items:items.slice(0,20)};
}
