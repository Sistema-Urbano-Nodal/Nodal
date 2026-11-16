import { randomUUID } from 'node:crypto';
import { createDatabase, createUser, getUserByEmail, updateUserProfile, addFollowDb, recordInteractionDb, recordMembershipAcceptance, grantFounder } from '../server/db.js';
import { createFiiuStore } from '../server/fiiu-repository.js';
import { hashPassword } from '../server/auth.js';
import { createCourseStore } from '../server/courses-repository.js';
import { createVisitStore } from '../server/visits-repository.js';
import { createMetricsStore } from '../server/metrics-repository.js';
import { EVENT_ID } from '../server/fiiu-domain.js';
import { seedData } from '../server/store.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed:dev is for development only; refusing to modify a production database');
}

const db = createDatabase();

const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@nodal.local';
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (adminPassword && !getUserByEmail(db, adminEmail)) {
  const admin = createUser(db, {
    fullName: process.env.SEED_ADMIN_NAME || 'NODAL Admin',
    email: adminEmail,
    passwordHash: await hashPassword(adminPassword),
    role: 'admin',
    title: 'NODAL Admin',
    city: 'Lima',
  });
  updateUserProfile(db, admin.id, {
    interests: ['community engagement', 'public policy'],
    active: ['am', 'pm'],
    topics: [{ name: 'Governance & participation', level: 3, validatedAt: 0, endorsedAt: 0 }],
    assessed: true,
  });
  console.log(`created admin: ${adminEmail}`);
} else if (!adminPassword) {
  console.log('skipped admin: set SEED_ADMIN_PASSWORD to create one');
}

const seed = seedData();
const idMap = new Map();
for (const persona of seed.users.filter((u) => u.id !== 'you')) {
  const email = `${persona.id}@seed.nodal.local`;
  let row = getUserByEmail(db, email);
  if (!row) {
    row = createUser(db, {
      fullName: persona.name,
      email,
      passwordHash: await hashPassword(`seed-${randomUUID()}`),
      title: persona.role,
      city: persona.city,
    });
    updateUserProfile(db, row.id, {
      interests: persona.interests,
      active: persona.active,
      linkedin: persona.linkedin || '',
      topics: persona.interests.slice(0, 4).map((name, i) => ({ name, level: i === 0 ? 3 : 2, validatedAt: 0, endorsedAt: 0 })),
      partC: { linkedin: persona.linkedin || '', bio: '', portfolio: '', references: '', availability: '', consent: true },
      assessed: true,
    });
  }
  idMap.set(persona.id, row.id);
}

for (const [from, targets] of Object.entries(seed.follows)) {
  if (!idMap.has(from)) continue;
  for (const target of targets) if (idMap.has(target)) addFollowDb(db, idMap.get(from), idMap.get(target));
}
for (const interaction of seed.interactions) {
  if (idMap.has(interaction.from) && idMap.has(interaction.to)) {
    recordInteractionDb(db, idMap.get(interaction.from), idMap.get(interaction.to), interaction.type);
  }
}

// Rows for every block of the admin home (/admin-home.html), so the local preview shows numbers, not dashes. Fixed ids and
// INSERT OR IGNORE make a second run add nothing; dates are relative to this run, in whole days. SEED_NOW (an ISO
// instant) fixes "this run" so two runs seed the same days (the seed's test passes it; never needed by hand).
createFiiuStore({ db });
createCourseStore({ db });
createVisitStore({ db });
createMetricsStore({ db });
const DAY_MS = 86400000;
const startedAt = process.env.SEED_NOW ? Date.parse(process.env.SEED_NOW) : Date.now();
if (!Number.isFinite(startedAt)) throw new Error('SEED_NOW must be an ISO instant');
const ago = (days) => new Date(startedAt - days * DAY_MS).toISOString();
const limaDay = (days) => new Date(startedAt - days * DAY_MS - 5 * 3600000).toISOString().slice(0, 10);
const personas = [...idMap.values()];
const adminRow = getUserByEmail(db, adminEmail);

// Accounts opened over the last weeks (createUser takes no date). This also stamps updated_at, so they read as profile activity.
personas.forEach((id, i) => db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(ago([1, 2, 4, 6, 9, 13, 18, 24, 31, 45, 60][i % 11]), id));
personas.slice(0, 4).forEach((id) => updateUserProfile(db, id, {
  partC: { linkedin: '', bio: 'Local seed biography for the preview.', portfolio: '', references: '', availability: '', consent: true },
}));

// Festival: eleven registrations, five country spellings (Colombia, México and Argentina are under three people), two profile types.
const countries = ['Perú', 'Perú', 'Perú', 'Perú', 'Chile', 'Chile', 'Chile', 'Colombia', 'Colombia', 'México', 'Argentina'];
const insertRegistration = db.prepare(`INSERT OR IGNORE INTO fiiu_registrations (id, event_id, user_id, email, answers, lab_status, version, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
const insertAttendance = db.prepare('INSERT OR IGNORE INTO fiiu_attendance (id, registration_id, activity_id, created_at, method) VALUES (?, ?, ?, ?, ?)');
personas.forEach((userId, i) => {
  const id = `seed-registration-${i}`;
  const at = ago([1, 1, 2, 3, 3, 4, 5, 6, 8, 9, 12][i % 11]);
  const answers = { country: countries[i % countries.length], city: 'Lima', profile: i % 3 === 0 ? 'student' : 'professional', activities: ['day1-am', 'day2-am'] };
  insertRegistration.run(id, EVENT_ID, userId, `${userId}@seed.nodal.local`, JSON.stringify(answers), i === 0 ? 'pending' : 'none', at, at);
  if (i < 7) insertAttendance.run(`seed-attendance-${i}-a`, id, 'day1-am', at, 'qr');
  if (i < 4) insertAttendance.run(`seed-attendance-${i}-b`, id, 'day2-am', at, 'staff');
});

// Course: one published course with two modules, enrolments (the administrator is one) and module, content and recording opens.
const courseAt = ago(20);
db.prepare(`INSERT OR IGNORE INTO pilot_courses (id, title, description, status, enrollment_open, created_at, updated_at)
  VALUES ('seed-course', 'Seed course', 'Local seed course for the preview.', 'published', 1, ?, ?)`).run(courseAt, courseAt);
for (const [n, id] of [[1, 'seed-module-1'], [2, 'seed-module-2']]) {
  db.prepare(`INSERT OR IGNORE INTO course_modules (id, course_id, title, position, status, created_at, updated_at)
    VALUES (?, 'seed-course', ?, ?, 'published', ?, ?)`).run(id, `Seed module ${n}`, n, courseAt, courseAt);
}
const learners = [...personas.slice(0, 3), ...(adminRow ? [adminRow.id] : [])];
learners.forEach((userId, i) => {
  db.prepare("INSERT OR IGNORE INTO course_enrollments (id, course_id, user_id, created_at) VALUES (?, 'seed-course', ?, ?)").run(`seed-enrolment-${i}`, userId, ago(10 - i));
  db.prepare("INSERT OR IGNORE INTO course_intakes (id, course_id, user_id, answers, updated_at) VALUES (?, 'seed-course', ?, '{}', ?)").run(`seed-intake-${i}`, userId, ago(9 - i));
  ['module_open', 'content_open', 'recording_open'].forEach((kind, k) => {
    db.prepare("INSERT OR IGNORE INTO course_events (id, course_id, module_id, user_id, kind, created_at) VALUES (?, 'seed-course', ?, ?, ?, ?)")
      .run(`seed-event-${i}-${k}`, `seed-module-${(k % 2) + 1}`, userId, kind, ago(1 + k));
  });
});

// Membership: one acceptance and one Founder badge (a second acceptance stays unbadged).
personas.slice(0, 2).forEach((userId, i) => {
  if (db.prepare('SELECT 1 FROM membership_acceptances WHERE id = ?').get(`seed-acceptance-${i}`)) return;
  const user = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId);
  recordMembershipAcceptance(db, {
    id: `seed-acceptance-${i}`, userId, email: user.email, fullName: user.full_name, option: 'once', termsVersion: 'seed',
    amountText: 'seed', authorizations: {}, acceptedAt: ago(2 + i),
  });
});
if (personas[0]) grantFounder(db, personas[0], ago(1));

// Visits: the last ten Lima days.
const insertVisit = db.prepare('INSERT OR IGNORE INTO visit_counts (day, kind, page, source, n) VALUES (?, ?, ?, ?, ?)');
for (let d = 0; d < 10; d++) {
  const day = limaDay(d);
  insertVisit.run(day, 'view', 'index.html', '', 40 + d * 3);
  insertVisit.run(day, 'view', 'fundadores.html', '', 6 + d);
  insertVisit.run(day, 'arrival', 'index.html', 'direct', 12 + d);
  insertVisit.run(day, 'arrival', 'index.html', 'search', 5 + d);
}

db.close();
console.log('dev seed complete');
