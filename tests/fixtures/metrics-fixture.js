/* One set of rows for the metrics, read by both stores: tests/metrics-postgres.test.js loads it into PostgreSQL with
   plain INSERTs (loadPostgres) and checks public.metrics_member_days against expectedMemberDays; the SQLite twin's tests
   load the same rows through the repository's and the stores' own functions (loadSqlite).
   Each row carries only what the metrics read: `user` (a key of `users`, or null), its instants as ISO strings under the
   column's name in camel case, and the field the SQL filters on. Lima is UTC-5 all year; METRICS_TODAY's 7 days are the
   Lima days 2026-11-08 ... 2026-11-14 (from 2026-11-08T05:00:00Z) and its 30 days 2026-10-16 ... 2026-11-14 (from
   2026-10-16T05:00:00Z), both ending before 2026-11-15T05:00:00Z. */
import {randomUUID} from 'node:crypto';
import {FINAL_SURVEY} from '../../server/course-final-survey.js';
import {addFollowDb, createUser, grantFounder, recordInteractionDb, recordMembershipAcceptance, updateCatalogInterest,
 updateUserProfile, upsertCatalogInterest} from '../../server/db.js';
import {createTalkStore} from '../../server/fiiu-talk-repository.js';

export const METRICS_TODAY = '2026-11-14';

// The instants every row is placed at.
const IN7 = '2026-11-10T15:00:00.000Z';      // Lima 2026-11-10: inside 7 days
const EDGE7 = '2026-11-08T05:00:00.000Z';    // Lima 2026-11-08, the first instant of the 7 days
const BEFORE7 = '2026-11-08T04:59:59.000Z';  // Lima 2026-11-07: inside 30 days only
const IN30 = '2026-10-20T15:00:00.000Z';     // Lima 2026-10-20: inside 30 days only
const EDGE30 = '2026-10-16T05:00:00.000Z';   // Lima 2026-10-16, the first instant of the 30 days
const BEFORE30 = '2026-10-16T04:59:59.000Z'; // Lima 2026-10-15: outside
const OLD = '2026-09-20T15:00:00.000Z';      // Lima 2026-09-20: outside
const LATER = '2026-10-25T15:00:00.000Z';    // Lima 2026-10-25: inside 30 days only

const profile = (city, interests, bio, assessed, directory) => ({city, interests, bio, assessed, directory});

export const metricsFixture = Object.freeze({
 // One row feeds auth.users and profiles (Postgres) or users (SQLite). Two admins, six members.
 users: [
  {key: 'a1', role: 'admin', createdAt: '2026-07-10T15:00:00.000Z', confirmedAt: '2026-07-10T16:00:00.000Z', profile: profile('Lima', ['movilidad'], 'Equipo NODAL', true, true), founderSince: null},
  {key: 'a2', role: 'admin', createdAt: '2026-09-01T15:00:00.000Z', confirmedAt: null, profile: profile('', [], '', false, false), founderSince: null},
  {key: 'm1', role: 'member', createdAt: OLD, confirmedAt: OLD, profile: profile('Cusco', ['transporte', 'datos'], 'Urbanista', true, true), founderSince: IN30},
  {key: 'm2', role: 'member', createdAt: BEFORE30, confirmedAt: BEFORE30, profile: profile('  ', ['datos'], '', false, true), founderSince: null},
  {key: 'm3', role: 'member', createdAt: EDGE30, confirmedAt: null, profile: profile('Arequipa', [], '  ', false, false), founderSince: null},
  {key: 'm4', role: 'member', createdAt: BEFORE7, confirmedAt: BEFORE7, profile: profile('Lima', ['movilidad'], '', true, false), founderSince: IN7},
  {key: 'm5', role: 'member', createdAt: EDGE7, confirmedAt: EDGE7, profile: profile('Bogotá', ['datos'], 'Investigadora', false, true), founderSince: null},
  {key: 'm6', role: 'member', createdAt: '2026-11-14T15:00:00.000Z', confirmedAt: null, profile: profile('', [], '', false, false), founderSince: null},
 ],
 // Perfil: created_at or updated_at. A user's interests and self-assessment live in this row on Postgres.
 onboarding_responses: [
  {user: 'a1', createdAt: IN7, updatedAt: IN7},          // the team: left out of activity
  {user: 'm1', createdAt: OLD, updatedAt: IN7},          // 7 days, by updated_at
  {user: 'm2', createdAt: IN30, updatedAt: LATER},       // 30 days
  {user: 'm3', createdAt: BEFORE30, updatedAt: BEFORE30},// outside
  {user: 'm4', createdAt: EDGE7, updatedAt: EDGE7},      // 7 days, by created_at: m4's only activity in 7 days
  {user: 'm5', createdAt: OLD, updatedAt: OLD},          // outside
 ],
 // action 'profile' is Perfil, 'matching' Red, the rest Cursos.
 pilot_feedback: [
  {user: 'm5', action: 'profile', createdAt: EDGE30},
  {user: 'm6', action: 'profile', createdAt: BEFORE30},
  {user: 'a2', action: 'profile', createdAt: IN7},
  {user: 'm3', action: 'matching', createdAt: IN7},
  {user: 'm6', action: 'matching', createdAt: IN30},
  {user: 'm2', action: 'matching', createdAt: OLD},
  {user: 'm3', action: 'content', createdAt: IN30},
  {user: 'm4', action: 'recording', createdAt: IN30},
  {user: 'm1', action: 'course', createdAt: OLD},
 ],
 // Red. The team's follows count in the total.
 member_follows: [
  {user: 'm1', target: 'm2', createdAt: IN7},
  {user: 'm2', target: 'm3', createdAt: IN30},
  {user: 'm3', target: 'm1', createdAt: OLD},
  {user: 'a1', target: 'm1', createdAt: IN7},
 ],
 // Red: type 'skip' only. Left out on purpose: 'follow' (the follow trigger's copies) and the other types.
 member_interactions: [
  {user: 'm5', target: 'm1', type: 'skip', createdAt: IN7},
  {user: 'm6', target: 'm1', type: 'skip', createdAt: EDGE30},
  {user: 'm4', target: 'm1', type: 'skip', createdAt: OLD},
  {user: 'm2', target: 'm1', type: 'follow', createdAt: IN7},
  {user: 'm3', target: 'm2', type: 'like', createdAt: IN7},
 ],
 // Oportunidades: created_at; updated_at only where updated_by is the member. `status` is what the totals filter on
 // (not withdrawn; 'new' for "Por atender").
 catalog_interests: [
  {user: 'm1', status: 'new', createdAt: IN7, updatedAt: IN7, updatedBy: 'm1'},
  {user: 'm2', status: 'withdrawn', createdAt: OLD, updatedAt: IN30, updatedBy: 'm2'},
  {user: 'm3', status: 'contacted', createdAt: OLD, updatedAt: IN7, updatedBy: 'a1'},  // a staff update: left out
  {user: 'm4', status: 'new', createdAt: IN30, updatedAt: IN30, updatedBy: 'm4'},
  {user: 'm5', status: 'closed', createdAt: OLD, updatedAt: OLD, updatedBy: 'm5'},
  {user: 'a2', status: 'new', createdAt: IN7, updatedAt: IN7, updatedBy: 'a2'},
 ],
 // Festival: created_at only (updated_at moves on staff review: left out). Five spellings of one country.
 fiiu_registrations: [
  {key: 'r-a1', user: 'a1', createdAt: OLD, updatedAt: OLD, country: 'Perú', profileType: 'organization'},
  {key: 'r-a2', user: 'a2', createdAt: OLD, updatedAt: OLD, country: 'Perú', profileType: 'organization'},
  {key: 'r-m1', user: 'm1', createdAt: IN7, updatedAt: IN7, country: 'peru', profileType: 'student'},
  {key: 'r-m2', user: 'm2', createdAt: OLD, updatedAt: IN7, country: ' Perú ', profileType: 'student'},
  {key: 'r-m3', user: 'm3', createdAt: IN30, updatedAt: IN30, country: 'Colombia', profileType: 'academic'},
  {key: 'r-m4', user: 'm4', createdAt: BEFORE30, updatedAt: BEFORE30, country: 'PERU', profileType: 'student'},
  {key: 'r-m5', user: 'm5', createdAt: OLD, updatedAt: OLD, country: 'Lima', profileType: 'professional'},
  {key: 'r-m6', user: 'm6', createdAt: EDGE30, updatedAt: EDGE30, country: '', profileType: ''},
 ],
 // Festival: method 'qr' only; a check-in by staff is left out.
 fiiu_attendance: [
  {user: 'm5', activity: 'conferencia-1', method: 'qr', createdAt: IN7},
  {user: 'm4', activity: 'conferencia-1', method: 'qr', createdAt: IN30},
  {user: 'm2', activity: 'conferencia-1', method: 'staff', createdAt: IN7},
  {user: 'a1', activity: 'conferencia-1', method: 'qr', createdAt: IN7},
  {user: 'm3', activity: 'conferencia-1', method: 'qr', createdAt: OLD},
 ],
 // The parents of the conversation rows below (not read by the metrics).
 fiiu_questions: [
  {key: 'q-chat', kind: 'chat', activity: 'conferencia-1', user: 'a1', createdAt: OLD},
  {key: 'q-rating', kind: 'rating', activity: 'conferencia-1', user: 'a1', createdAt: OLD},
 ],
 // Festival: organiser false only.
 fiiu_messages: [
  {key: 'msg-m6', question: 'q-chat', user: 'm6', organiser: false, createdAt: IN7},
  {key: 'msg-a1', question: 'q-chat', user: 'a1', organiser: true, createdAt: IN7},
  {key: 'msg-m1', question: 'q-chat', user: 'm1', organiser: false, createdAt: IN30},
  {key: 'msg-m2', question: 'q-chat', user: 'm2', organiser: false, createdAt: OLD},
 ],
 fiiu_message_likes: [
  {message: 'msg-a1', user: 'm3', createdAt: IN7},
  {message: 'msg-m6', user: 'm5', createdAt: BEFORE7},
  {message: 'msg-m6', user: 'm4', createdAt: OLD},
 ],
 // Festival: created_at or updated_at.
 fiiu_ratings: [
  {question: 'q-rating', user: 'm2', createdAt: OLD, updatedAt: IN7},
  {question: 'q-rating', user: 'm6', createdAt: IN30, updatedAt: IN30},
  {question: 'q-rating', user: 'm1', createdAt: OLD, updatedAt: OLD},
  {question: 'q-rating', user: 'a2', createdAt: IN7, updatedAt: IN7},
 ],
 // The survey course every course row belongs to (its title avoids the page's display words).
 pilot_courses: [{id: FINAL_SURVEY.courseId, title: 'Curso de movilidad urbana', createdAt: '2026-08-01T15:00:00.000Z'}],
 // Not activity (staff can add people): learners are the distinct non-admin accounts here. m4 joined inside 7 days.
 course_enrollments: [
  {user: 'm1', createdAt: OLD},
  {user: 'm2', createdAt: OLD},
  {user: 'm3', createdAt: OLD},
  {user: 'm4', createdAt: IN7},
  {user: 'a1', createdAt: OLD},
 ],
 // Cursos ("abrió"); openers are the distinct non-admin accounts here.
 course_events: [
  {user: 'm1', kind: 'module_open', createdAt: IN7},
  {user: 'm2', kind: 'content_open', createdAt: BEFORE7},
  {user: 'm3', kind: 'recording_open', createdAt: OLD},
  {user: 'a1', kind: 'module_open', createdAt: IN7},
 ],
 // Cursos: staff false, deleted ones included.
 course_posts: [
  {user: 'm5', staff: false, deletedAt: LATER, createdAt: IN30},
  {user: 'a1', staff: true, deletedAt: null, createdAt: IN7},
  {user: 'm6', staff: false, deletedAt: null, createdAt: OLD},
 ],
 // Cursos: created_at or submitted_at.
 course_survey_responses: [
  {user: 'm6', createdAt: OLD, updatedAt: IN7, submittedAt: IN7},
  {user: 'm2', createdAt: IN30, updatedAt: IN30, submittedAt: null},
  {user: 'm3', createdAt: OLD, updatedAt: OLD, submittedAt: OLD},
 ],
 // Membresía: two acceptances by one person, and one whose account is gone.
 membership_acceptances: [
  {user: 'm1', acceptedAt: IN7},
  {user: 'm1', acceptedAt: IN30},
  {user: null, acceptedAt: OLD},
  {user: 'm5', acceptedAt: BEFORE30},
 ],
 node_requests: [
  {user: null, status: 'new', createdAt: IN7},
  {user: null, status: 'closed', createdAt: OLD},
  {user: null, status: 'contacted', createdAt: IN30},
 ],
});

/* What metrics_member_days('2026-11-14') answers on Postgres for the rows above (worked by hand from the catalogue):
   7 days  - Perfil m1 m4 · Red m1 m3 m5 · Oportunidades m1 · Festival m1 m2 m3 m5 m6 · Cursos m1 m6 · Membresía m1
   30 days - Perfil m1 m2 m4 m5 · Red m1 m2 m3 m5 m6 · Oportunidades m1 m2 m4 · Festival and Cursos all six · Membresía m1 */
export const expectedMemberDays = Object.freeze({
 v: 1,
 days: {
  entered: [['2026-07-10', 1], ['2026-09-01', 1], ['2026-09-20', 1], ['2026-10-15', 1], ['2026-10-16', 1], ['2026-11-07', 1], ['2026-11-08', 1], ['2026-11-14', 1]],
  profileSaves: [['2026-09-20', 2], ['2026-10-15', 1], ['2026-10-20', 1], ['2026-11-08', 1], ['2026-11-10', 1]],
  follows: [['2026-09-20', 1], ['2026-10-20', 1], ['2026-11-10', 2]],
  interests: [['2026-09-20', 2], ['2026-10-20', 1], ['2026-11-10', 2]],
  registrations: [['2026-09-20', 4], ['2026-10-15', 1], ['2026-10-16', 1], ['2026-10-20', 1], ['2026-11-10', 1]],
  acceptances: [['2026-09-20', 1], ['2026-10-15', 1], ['2026-10-20', 1], ['2026-11-10', 1]],
  founders: [['2026-10-20', 1], ['2026-11-10', 1]],
  orgRequests: [['2026-09-20', 1], ['2026-10-20', 1], ['2026-11-10', 1]],
 },
 now: {
  admins: 2, basic: 4, city: 5, interests: 5, bio: 3, assessed: 3, directory: 4,
  acceptors: 3, unbadged: 2, interestsNew: 3, orgRequestsNew: 1, learners: 4, openers: 3, teamRegistrations: 2,
 },
 active: {
  d7: {members: 6, profile: 2, network: 3, opportunities: 1, festival: 5, courses: 2, membership: 1},
  d30: {members: 6, profile: 4, network: 5, opportunities: 3, festival: 6, courses: 6, membership: 1},
 },
 lists: {
  countries: [['Perú', 2], ['', 1], ['Colombia', 1], ['Lima', 1], ['PERU', 1], ['Perú', 1], ['peru', 1]],
 },
});

/* The twin reads the profile kind from users.updated_at, which the users_updated_at trigger (server/db.js) stamps with
   the wall clock on every UPDATE of users, so it always lands after METRICS_TODAY: profile is 0 in both windows, and
   members loses m4, whose only activity in 7 days is a profile save. */
export const sqliteProfile = Object.freeze({d7: {profile: 0, members: 5}, d30: {profile: 0, members: 6}});

// Deterministic ids for Postgres: users, then every other keyed row.
const uuid = (group, n) => `00000000-0000-4000-8${String(group).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
const idsOf = (rows, group) => new Map(rows.map((row, i) => [row.key, uuid(group, i + 1)]));
const lit = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const textArray = list => `ARRAY[${list.map(lit).join(',')}]::text[]`;
const jsonLit = value => `${lit(JSON.stringify(value))}::jsonb`;
const MODULE_ID = uuid(90, 1), ITEM_ID = uuid(91, 1), EVENT = 'fiiu-2026';

// Inserts the rows with plain INSERTs through the sql(text) runner of tests/metrics-postgres.test.js, as its role.
export async function loadPostgres(sql) {
 const f = metricsFixture;
 const users = idsOf(f.users, 1), registrations = idsOf(f.fiiu_registrations, 2), questions = idsOf(f.fiiu_questions, 3), messages = idsOf(f.fiiu_messages, 4);
 const u = key => key === null ? 'NULL' : lit(users.get(key));
 const statements = [];
 const add = (table, columns, rows) => { if (rows.length) statements.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${rows.map(r => `(${r.join(',')})`).join(',')};`); };
 add('auth.users', ['id', 'email', 'created_at', 'email_confirmed_at'], f.users.map(r => [u(r.key), lit(`${r.key}@example.test`), lit(r.createdAt), lit(r.confirmedAt)]));
 add('public.profiles', ['id', 'full_name', 'email', 'city_region', 'bio', 'app_role', 'founder_since', 'created_at', 'updated_at'],
  f.users.map(r => [u(r.key), lit(`Persona ${r.key}`), lit(`${r.key}@example.test`), lit(r.profile.city), lit(r.profile.bio), lit(r.role), lit(r.founderSince), lit(r.createdAt), lit(r.createdAt)]));
 add('public.profile_preferences', ['user_id', 'data_consent'], f.users.map(r => [u(r.key), jsonLit({directoryPublic: r.profile.directory})]));
 const byKey = new Map(f.users.map(r => [r.key, r]));
 add('public.onboarding_responses', ['user_id', 'interests', 'raw_answers', 'created_at', 'updated_at'], f.onboarding_responses.map(r => {
  const p = byKey.get(r.user).profile;
  return [u(r.user), textArray(p.interests), jsonLit({assessed: p.assessed, partC: {bio: p.bio, consent: p.directory}}), lit(r.createdAt), lit(r.updatedAt)];
 }));
 add('public.member_follows', ['user_id', 'target_user_id', 'created_at'], f.member_follows.map(r => [u(r.user), u(r.target), lit(r.createdAt)]));
 add('public.member_interactions', ['from_user_id', 'to_user_id', 'type', 'created_at'], f.member_interactions.map(r => [u(r.user), u(r.target), lit(r.type), lit(r.createdAt)]));
 statements.push(`INSERT INTO public.catalog_items (id, kind, status, action_mode) VALUES (${lit(ITEM_ID)}, 'opportunity', 'published', 'interest');`);
 add('public.catalog_interests', ['item_id', 'user_id', 'status', 'created_at', 'updated_at', 'updated_by'], f.catalog_interests.map(r => [lit(ITEM_ID), u(r.user), lit(r.status), lit(r.createdAt), lit(r.updatedAt), u(r.updatedBy)]));
 add('public.fiiu_registrations', ['id', 'event_id', 'user_id', 'email', 'answers', 'lab_status', 'version', 'created_at', 'updated_at'], f.fiiu_registrations.map(r =>
  [lit(registrations.get(r.key)), lit(EVENT), u(r.user), lit(`${r.user}@example.test`), jsonLit({country: r.country, profile: r.profileType}), "'none'", '1', lit(r.createdAt), lit(r.updatedAt)]));
 const registrationOf = new Map(f.fiiu_registrations.map(r => [r.user, registrations.get(r.key)]));
 add('public.fiiu_attendance', ['id', 'registration_id', 'activity_id', 'method', 'created_at'], f.fiiu_attendance.map((r, i) => [lit(uuid(5, i + 1)), lit(registrationOf.get(r.user)), lit(r.activity), lit(r.method), lit(r.createdAt)]));
 add('public.fiiu_questions', ['id', 'event_id', 'activity_id', 'body', 'status', 'kind', 'rating_counts', 'created_by', 'version', 'created_at', 'updated_at'], f.fiiu_questions.map(r =>
  [lit(questions.get(r.key)), lit(EVENT), lit(r.activity), lit(`Pregunta ${r.key}`), "'open'", lit(r.kind), r.kind === 'rating' ? "'{0,0,0,0,0,0,0,0,0,0}'::integer[]" : 'NULL', u(r.user), '1', lit(r.createdAt), lit(r.createdAt)]));
 add('public.fiiu_messages', ['id', 'question_id', 'user_id', 'author_name', 'author_full', 'organiser', 'body', 'client_id', 'created_at'], f.fiiu_messages.map((r, i) =>
  [lit(messages.get(r.key)), lit(questions.get(r.question)), u(r.user), lit(r.user), lit(r.user), String(r.organiser), lit(`Mensaje ${r.key}`), lit(uuid(6, i + 1)), lit(r.createdAt)]));
 add('public.fiiu_message_likes', ['message_id', 'user_id', 'created_at'], f.fiiu_message_likes.map(r => [lit(messages.get(r.message)), u(r.user), lit(r.createdAt)]));
 add('public.fiiu_ratings', ['question_id', 'user_id', 'score', 'created_at', 'updated_at'], f.fiiu_ratings.map((r, i) => [lit(questions.get(r.question)), u(r.user), String(1 + i), lit(r.createdAt), lit(r.updatedAt)]));
 add('public.pilot_courses', ['id', 'title', 'status', 'created_at', 'updated_at'], f.pilot_courses.map(r => [lit(r.id), lit(r.title), "'published'", lit(r.createdAt), lit(r.createdAt)]));
 const course = lit(f.pilot_courses[0].id);
 statements.push(`INSERT INTO public.course_modules (id, course_id, title, position, status, created_at, updated_at) VALUES (${lit(MODULE_ID)}, ${course}, 'Sesión 1', 1, 'published', ${lit(f.pilot_courses[0].createdAt)}, ${lit(f.pilot_courses[0].createdAt)});`);
 add('public.course_enrollments', ['id', 'course_id', 'user_id', 'created_at'], f.course_enrollments.map((r, i) => [lit(uuid(7, i + 1)), course, u(r.user), lit(r.createdAt)]));
 add('public.course_events', ['id', 'course_id', 'module_id', 'user_id', 'kind', 'created_at'], f.course_events.map((r, i) => [lit(uuid(8, i + 1)), course, lit(MODULE_ID), u(r.user), lit(r.kind), lit(r.createdAt)]));
 add('public.course_posts', ['id', 'course_id', 'module_id', 'user_id', 'author_name', 'staff', 'client_id', 'kind', 'body', 'deleted_at', 'created_at'], f.course_posts.map((r, i) =>
  [lit(uuid(9, i + 1)), course, lit(MODULE_ID), u(r.user), lit(r.user), String(r.staff), lit(uuid(10, i + 1)), "'comment'", lit(r.deletedAt ? '' : 'Comentario'), lit(r.deletedAt), lit(r.createdAt)]));
 add('public.course_survey_responses', ['id', 'course_id', 'user_id', 'answers', 'submitted_at', 'created_at', 'updated_at'], f.course_survey_responses.map((r, i) =>
  [lit(uuid(11, i + 1)), course, u(r.user), "'{}'::jsonb", lit(r.submittedAt), lit(r.createdAt), lit(r.updatedAt)]));
 add('public.pilot_feedback', ['id', 'user_id', 'action', 'course_id', 'rating', 'created_at'], f.pilot_feedback.map((r, i) =>
  [lit(uuid(12, i + 1)), u(r.user), lit(r.action), ['profile', 'matching'].includes(r.action) ? 'NULL' : course, '4', lit(r.createdAt)]));
 add('public.membership_acceptances', ['id', 'user_id', 'email', 'full_name', 'option', 'terms_version', 'amount_text', 'authorizations', 'accepted_at'], f.membership_acceptances.map((r, i) =>
  [lit(uuid(13, i + 1)), u(r.user), lit(`${r.user ?? 'gone'}@example.test`), lit(`Persona ${r.user ?? 'gone'}`), "'once'", "'2026-10-21'", "'S/ 100'", "'{}'::jsonb", lit(r.acceptedAt)]));
 add('public.node_requests', ['id', 'name', 'organization', 'email', 'message', 'language', 'status', 'created_at', 'updated_at'], f.node_requests.map((r, i) =>
  [lit(uuid(14, i + 1)), "'Ana'", "'Colectivo'", "'ana@example.test'", "'Hola'", "'es'", lit(r.status), lit(r.createdAt), lit(r.createdAt)]));
 await sql(`BEGIN;\n${statements.join('\n')}\nCOMMIT;`);
 return {users};
}

/* Loads the same rows into the app's SQLite database through the repository's and the stores' own functions, then sets
   with direct UPDATEs the dates those functions do not take (they stamp the wall clock). Never sets users.updated_at:
   the users_updated_at trigger rewrites it on every UPDATE of users (see sqliteProfile). Returns the ids by key. */
export async function loadSqlite({db, fiiuStore, courseStore, nodeRequestStore, talkStore = createTalkStore({db})}) {
 const f = metricsFixture;
 const users = new Map();
 for (const r of f.users) {
  const row = createUser(db, {fullName: `Persona ${r.key}`, email: `${r.key}@example.test`, passwordHash: 'unused', role: r.role});
  users.set(r.key, row.id);
  updateUserProfile(db, row.id, {city: r.profile.city, interests: r.profile.interests, assessed: r.profile.assessed, partC: {bio: r.profile.bio, consent: r.profile.directory}});
  if (r.founderSince) grantFounder(db, row.id, r.founderSince);
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(r.createdAt, row.id);
 }
 const u = key => key === null ? null : users.get(key);
 for (const r of f.member_follows) {
  addFollowDb(db, u(r.user), u(r.target));
  db.prepare('UPDATE follows SET created_at = ? WHERE user_id = ? AND target_user_id = ?').run(r.createdAt, u(r.user), u(r.target));
 }
 for (const r of f.member_interactions) {
  recordInteractionDb(db, u(r.user), u(r.target), r.type);
  db.prepare('UPDATE interactions SET created_at = ? WHERE id = (SELECT max(id) FROM interactions WHERE from_user_id = ? AND to_user_id = ? AND type = ?)').run(r.createdAt, u(r.user), u(r.target), r.type);
 }
 // The catalog item is only the interests' parent.
 const itemId = randomUUID();
 db.prepare("INSERT INTO catalog_items (id, kind, status, visibility, action_mode) VALUES (?, 'opportunity', 'published', 'public', 'interest')").run(itemId);
 for (const r of f.catalog_interests) {
  let interest = upsertCatalogInterest(db, itemId, u(r.user), '');
  if (r.status !== 'new') interest = updateCatalogInterest(db, interest.id, {status: r.status}, interest.version, u(r.updatedBy));
  db.prepare('UPDATE catalog_interests SET created_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(r.createdAt, r.updatedAt, u(r.updatedBy), interest.id);
 }
 for (const [i, r] of f.membership_acceptances.entries()) {
  recordMembershipAcceptance(db, {id: randomUUID(), userId: u(r.user), email: `${r.user ?? 'gone'}@example.test`, fullName: `Persona ${r.user ?? 'gone'}`,
   option: 'once', termsVersion: '2026-10-21', amountText: 'S/ 100', authorizations: {n: i}, acceptedAt: r.acceptedAt});
 }
 const registrations = new Map();
 for (const r of f.fiiu_registrations) {
  const saved = await fiiuStore.insert('registrations', {id: randomUUID(), eventId: 'fiiu-2026', userId: u(r.user), email: `${r.user}@example.test`,
   answers: {country: r.country, profile: r.profileType}, labStatus: 'none', version: 1, createdAt: r.createdAt, updatedAt: r.updatedAt});
  registrations.set(r.user, saved.id);
 }
 for (const r of f.fiiu_attendance) {
  await fiiuStore.insert('attendance', {id: randomUUID(), registrationId: registrations.get(r.user), activityId: r.activity, method: r.method, createdAt: r.createdAt});
 }
 const questions = new Map(), messages = new Map();
 for (const r of f.fiiu_questions) {
  const id = randomUUID();
  await talkStore.insertQuestion({id, eventId: 'fiiu-2026', activityId: r.activity, talk: null, body: `Pregunta ${r.key}`, status: 'open', kind: r.kind, createdBy: u(r.user), createdAt: r.createdAt});
  questions.set(r.key, id);
 }
 for (const r of f.fiiu_messages) {
  const id = randomUUID();
  await talkStore.insertMessage({id, questionId: questions.get(r.question), userId: u(r.user), authorName: r.user, authorFull: r.user, organiser: r.organiser,
   body: `Mensaje ${r.key}`, clientId: randomUUID(), createdAt: r.createdAt});
  messages.set(r.key, id);
 }
 for (const r of f.fiiu_message_likes) await talkStore.like(messages.get(r.message), u(r.user), r.createdAt);
 for (const [i, r] of f.fiiu_ratings.entries()) {
  await talkStore.setRating(questions.get(r.question), u(r.user), 1 + i, r.createdAt);
  if (r.updatedAt !== r.createdAt) await talkStore.setRating(questions.get(r.question), u(r.user), 10 - i, r.updatedAt);
 }
 const course = f.pilot_courses[0];
 await courseStore.insert('courses', {id: course.id, title: course.title, status: 'published', createdAt: course.createdAt, updatedAt: course.createdAt});
 const moduleId = randomUUID();
 await courseStore.insert('modules', {id: moduleId, courseId: course.id, title: 'Sesión 1', position: 1, status: 'published', createdAt: course.createdAt, updatedAt: course.createdAt});
 for (const r of f.course_enrollments) await courseStore.insert('enrollments', {id: randomUUID(), courseId: course.id, userId: u(r.user), createdAt: r.createdAt});
 for (const r of f.course_events) await courseStore.insert('events', {id: randomUUID(), courseId: course.id, moduleId, userId: u(r.user), kind: r.kind, createdAt: r.createdAt});
 for (const r of f.course_posts) {
  await courseStore.insert('posts', {id: randomUUID(), courseId: course.id, moduleId, userId: u(r.user), authorName: r.user, staff: r.staff, clientId: randomUUID(),
   kind: 'comment', body: r.deletedAt ? '' : 'Comentario', deletedAt: r.deletedAt, createdAt: r.createdAt});
 }
 for (const r of f.course_survey_responses) {
  await courseStore.insert('surveys', {id: randomUUID(), courseId: course.id, userId: u(r.user), answers: {}, submittedAt: r.submittedAt, createdAt: r.createdAt, updatedAt: r.updatedAt});
 }
 for (const r of f.pilot_feedback) {
  const courseFields = ['profile', 'matching'].includes(r.action) ? {} : {courseId: course.id};
  await courseStore.insert('feedback', {id: randomUUID(), userId: u(r.user), action: r.action, ...courseFields, rating: 4, comment: '', createdAt: r.createdAt});
 }
 for (const r of f.node_requests) {
  await nodeRequestStore.insert({id: randomUUID(), name: 'Ana', organization: 'Colectivo', email: 'ana@example.test', message: 'Hola', language: 'es',
   status: r.status, createdAt: r.createdAt, updatedAt: r.createdAt, version: 1});
 }
 return {users, talkStore};
}
