// Explicit domain tables; this metadata also constrains every repository query.
export const COURSE_TABLES = {
  courses: { table: 'pilot_courses', fields: ['id','title','description','translations','status','startsOn','endsOn','enrollmentOpen','version','createdAt','updatedAt'], json: ['translations'], bool: ['enrollmentOpen'] },
  modules: { table: 'course_modules', fields: ['id','courseId','kind','postsRevision','title','description','objectives','instructions','translations','sessionDate','position','status','resources','version','createdAt','updatedAt'], json: ['resources','translations'] },
  enrollments: { table: 'course_enrollments', fields: ['id','courseId','userId','createdAt'], json: [] },
  intakes: { table: 'course_intakes', fields: ['id','courseId','userId','answers','updatedAt'], json: ['answers'] },
  posts: { table: 'course_posts', fields: ['id','courseId','moduleId','userId','authorName','staff','clientId','parentId','kind','threadKind','body','links','attachmentIds','deletedAt','createdAt'], json: ['links','attachmentIds'], bool: ['staff'] },
  attachments: { table: 'course_attachments', fields: ['id','courseId','moduleId','userId','purpose','name','mime','size','storagePath','status','createdAt'], json: [] },
  feedback: { table: 'pilot_feedback', fields: ['id','userId','action','courseId','moduleId','rating','comment','createdAt'], json: [] },
  events: { table: 'course_events', fields: ['id','courseId','moduleId','userId','kind','resourceUrl','createdAt'], json: [] },
};
export const snake = key => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

export const COURSE_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS pilot_courses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', translations TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 starts_on TEXT NOT NULL DEFAULT '', ends_on TEXT NOT NULL DEFAULT '', enrollment_open INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_modules (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT 'session' CHECK(kind IN ('session','discussion')), posts_revision INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', objectives TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', translations TEXT NOT NULL DEFAULT '{}',
 session_date TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
 resources TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_enrollments (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS course_intakes (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, answers TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS course_attachments (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE RESTRICT, user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL DEFAULT 'post' CHECK((purpose='post' AND user_id IS NOT NULL) OR (purpose='material' AND user_id IS NULL)),
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 3145728), storage_path TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','deleting')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_attachment_bytes (id TEXT PRIMARY KEY REFERENCES course_attachments(id) ON DELETE CASCADE, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS course_posts (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 author_name TEXT NOT NULL, staff INTEGER NOT NULL DEFAULT 0, client_id TEXT NOT NULL, parent_id TEXT REFERENCES course_posts(id),
 thread_kind TEXT NOT NULL DEFAULT 'discussion' CHECK(thread_kind IN ('assignment','discussion')),
 kind TEXT NOT NULL CHECK(kind IN ('assignment','question','comment')), body TEXT NOT NULL, links TEXT NOT NULL DEFAULT '[]',
 attachment_ids TEXT NOT NULL DEFAULT '[]', deleted_at TEXT, created_at TEXT NOT NULL, UNIQUE(user_id,client_id)
);
CREATE TABLE IF NOT EXISTS pilot_feedback (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN ('profile','matching','content','recording','assignment','discussion','course')),
 course_id TEXT REFERENCES pilot_courses(id) ON DELETE CASCADE, module_id TEXT REFERENCES course_modules(id) ON DELETE CASCADE,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_events (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES pilot_courses(id) ON DELETE CASCADE,
 module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('module_open','content_open','recording_open')), resource_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_courses_page ON pilot_courses(status,created_at,id);
CREATE INDEX IF NOT EXISTS course_modules_course ON course_modules(course_id,position,id);
CREATE INDEX IF NOT EXISTS course_enrollments_user ON course_enrollments(user_id,course_id);
CREATE INDEX IF NOT EXISTS course_enrollments_page ON course_enrollments(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_intakes_user ON course_intakes(user_id,course_id);
CREATE INDEX IF NOT EXISTS course_posts_page ON course_posts(module_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_posts_course ON course_posts(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_posts_parent ON course_posts(parent_id);
CREATE INDEX IF NOT EXISTS course_posts_user ON course_posts(user_id);
CREATE INDEX IF NOT EXISTS course_attachments_user ON course_attachments(user_id);
CREATE INDEX IF NOT EXISTS course_attachments_course_owner ON course_attachments(course_id,user_id);
CREATE INDEX IF NOT EXISTS course_attachments_module ON course_attachments(module_id);
CREATE INDEX IF NOT EXISTS pilot_feedback_course ON pilot_feedback(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS pilot_feedback_user ON pilot_feedback(user_id);
CREATE INDEX IF NOT EXISTS pilot_feedback_module ON pilot_feedback(module_id);
CREATE INDEX IF NOT EXISTS course_events_course ON course_events(course_id,created_at,id);
CREATE INDEX IF NOT EXISTS course_events_user ON course_events(user_id);
CREATE INDEX IF NOT EXISTS course_events_module ON course_events(module_id);
CREATE TRIGGER IF NOT EXISTS course_posts_account_erasure BEFORE DELETE ON users BEGIN
 UPDATE course_posts SET body='',links='[]',attachment_ids='[]',author_name='',staff=0,
 deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=OLD.id;
END;
`;

// Applied after additive upgrades, so existing SQLite pilot databases also migrate.
export const COURSE_SQLITE_DISCUSSION_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS course_one_discussion ON course_modules(course_id) WHERE kind='discussion';
CREATE INDEX IF NOT EXISTS course_posts_thread_page ON course_posts(module_id,thread_kind,created_at,id);
CREATE TRIGGER IF NOT EXISTS course_discussion_create AFTER INSERT ON pilot_courses BEGIN
 INSERT INTO course_modules(id,course_id,kind,title,translations,status,position,created_at,updated_at)
 VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),NEW.id,'discussion','General discussion','{"es":{"title":"Conversación general"},"pt":{"title":"Conversa geral"}}','published',100,NEW.created_at,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS course_posts_revision_insert AFTER INSERT ON course_posts BEGIN
 UPDATE course_modules SET posts_revision=posts_revision+1 WHERE id=NEW.module_id;
END;
CREATE TRIGGER IF NOT EXISTS course_posts_revision_update AFTER UPDATE ON course_posts BEGIN
 UPDATE course_modules SET posts_revision=posts_revision+1 WHERE id=NEW.module_id;
END;
CREATE TRIGGER IF NOT EXISTS course_posts_revision_delete AFTER DELETE ON course_posts BEGIN
 UPDATE course_modules SET posts_revision=posts_revision+1 WHERE id=OLD.module_id;
END;
CREATE TRIGGER IF NOT EXISTS course_resources_validate BEFORE UPDATE OF resources ON course_modules BEGIN
 SELECT RAISE(ABORT,'official resource attachment unavailable') WHERE EXISTS (
 SELECT 1 FROM json_each(NEW.resources) r WHERE json_extract(r.value,'$.attachmentId') IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM course_attachments a WHERE a.id=json_extract(r.value,'$.attachmentId') AND a.module_id=NEW.id AND a.course_id=NEW.course_id AND a.purpose='material' AND a.status='ready'));
END;
CREATE TRIGGER IF NOT EXISTS course_material_delete_guard BEFORE UPDATE OF status ON course_attachments WHEN NEW.status='deleting' BEGIN
 SELECT RAISE(ABORT,'remove the material from module resources before deleting') WHERE EXISTS (
 SELECT 1 FROM course_modules m,json_each(m.resources) r WHERE m.id=NEW.module_id AND json_extract(r.value,'$.attachmentId')=NEW.id);
END;
`;
