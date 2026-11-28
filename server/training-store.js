import { randomUUID } from 'node:crypto';
import { createSupabaseClients } from './supabase.js';

const YEAR = 2027;
const START = Date.parse('2027-01-01T05:00:00Z');
const END = Date.parse('2028-01-01T05:00:00Z');
const PILOT = '72e3cc56-a506-4a1b-97b5-9333e8d283ca';
const kinds = ['course', 'masterclass'];
const statuses = ['active', 'suspended', 'inactive'];
const limits = {capacity: 100000, money: 100000000};
function fail(code, status = 409) { throw Object.assign(new Error(code), {code, status}); }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function instant(at) {
  const date = at === undefined ? new Date() : new Date(at);
  if (!Number.isFinite(date.getTime())) fail('training_invalid', 400);
  return date.toISOString();
}
function termView(record, at) {
  const status = record?.status ?? 'inactive';
  const ms = Date.parse(at);
  const phase = ms < START ? 'early' : ms < END ? 'annual' : 'expired';
  const activatedAt = record?.activated_at ? new Date(record.activated_at).toISOString() : null;
  return {status, active: status === 'active' && activatedAt !== null && Date.parse(activatedAt) <= ms && ms < END,
    phase, activatedAt};
}
function offeringView(row) {
  return row ? {courseId: row.course_id, kind: row.kind, includedEligible: Boolean(row.included_eligible),
    regularCents: row.regular_cents, promoCents: row.promo_cents, capacity: row.capacity} : null;
}
function reservationView(row) {
  return row ? {id: row.id, userId: row.user_id, courseId: row.course_id, kind: row.kind, mode: row.mode,
    status: row.status, priceCents: row.price_cents, createdAt: new Date(row.created_at).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null} : null;
}
function datesInProgram(course) {
  return /^2027-\d\d-\d\d$/.test(course?.starts_on ?? '') &&
    (!course.ends_on || (/^2027-\d\d-\d\d$/.test(course.ends_on) && course.ends_on >= course.starts_on));
}
function stateView(raw, at) {
  const term = termView(raw.term, at);
  const used = {course: raw.used.course, masterclass: raw.used.masterclass};
  const reservation = reservationView(raw.reservation);
  const enrolled = Boolean(raw.enrollment);
  const canAccess = enrolled && (reservation?.mode !== 'included' || term.active);
  const state = {year: YEAR, term, used, offering: null, reservation, enrolled, canAccess,
    canInclude: false, canReserveAdditional: false, quoteCents: null};
  if (!raw.offering) return state;
  const day = new Date(Date.parse(at) - 5 * 3600000).toISOString().slice(0,10);
  const c = raw.course;
  const open = term.phase !== 'expired' && c.status === 'published' && Boolean(c.enrollment_open) &&
    datesInProgram(c) && day <= (c.ends_on || c.starts_on);
  const offering = {...offeringView(raw.offering), title: c.title, open, occupied: raw.occupied,
    available: Math.max(0, raw.offering.capacity - raw.occupied)};
  const bookable = raw.member_active && open && offering.available > 0 && !enrolled && !reservation;
  // Amounts are integer céntimos. Round the final 80% tariff to the nearest céntimo.
  const tariff = term.active ? Math.round(offering.regularCents * 80 / 100) : offering.regularCents;
  const quoteCents = Math.min(tariff, offering.promoCents ?? offering.regularCents);
  return {...state, offering, canInclude: Boolean(bookable && quoteCents > 0 && term.active && offering.includedEligible && !used[offering.kind]),
    canReserveAdditional: Boolean(bookable), quoteCents};
}

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS training_terms_2027 (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('active','inactive','suspended')),
 activated_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS training_offerings_2027 (
 course_id TEXT PRIMARY KEY REFERENCES pilot_courses(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('course','masterclass')),
 included_eligible INTEGER NOT NULL CHECK(included_eligible IN (0,1)), regular_cents INTEGER NOT NULL CHECK(regular_cents BETWEEN 0 AND 100000000),
 promo_cents INTEGER CHECK(promo_cents BETWEEN 0 AND 100000000), capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100000)
);
CREATE TABLE IF NOT EXISTS training_reservations_2027 (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL REFERENCES training_offerings_2027(course_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('course','masterclass')), mode TEXT NOT NULL CHECK(mode IN ('included','additional')),
 status TEXT NOT NULL CHECK(status IN ('enrolled','pending')),price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 100000000),
 created_at TEXT NOT NULL, confirmed_at TEXT,
 enrollment_id TEXT UNIQUE REFERENCES course_enrollments(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(user_id,course_id), CHECK(mode<>'included' OR (price_cents=0 AND status='enrolled')),
 CHECK((status='pending' AND confirmed_at IS NULL AND enrollment_id IS NULL) OR
       (status='enrolled' AND confirmed_at IS NOT NULL AND enrollment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS training_included_2027 ON training_reservations_2027(user_id,kind) WHERE mode='included';
CREATE INDEX IF NOT EXISTS training_roster_2027 ON training_reservations_2027(course_id,status);
CREATE TRIGGER IF NOT EXISTS training_guard_enrollment_2027 BEFORE INSERT ON course_enrollments
 WHEN EXISTS (SELECT 1 FROM training_offerings_2027 WHERE course_id=NEW.course_id)
 AND NOT EXISTS (SELECT 1 FROM training_reservations_2027 WHERE course_id=NEW.course_id AND user_id=NEW.user_id
  AND enrollment_id=NEW.id AND status='enrolled')
 BEGIN SELECT RAISE(ABORT,'training_reservation_required'); END;
CREATE TRIGGER IF NOT EXISTS training_guard_enrollment_move_2027 BEFORE UPDATE OF id,course_id,user_id ON course_enrollments
 WHEN (OLD.id<>NEW.id OR OLD.course_id<>NEW.course_id OR OLD.user_id<>NEW.user_id)
 AND (EXISTS (SELECT 1 FROM training_offerings_2027 WHERE course_id IN (OLD.course_id,NEW.course_id)))
 BEGIN SELECT RAISE(ABORT,'training_reservation_required'); END;
`;
const occupied = `SELECT count(*) AS n FROM (SELECT user_id FROM course_enrollments WHERE course_id=?
  UNION SELECT user_id FROM training_reservations_2027 WHERE course_id=?)`;
function sqliteTraining(db) {
  if (!db.prepare('PRAGMA busy_timeout').get().timeout) db.exec('PRAGMA busy_timeout=5000');
  db.exec(sqliteSchema);
  const one = (sql,...params) => db.prepare(sql).get(...params) ?? null;
  const run = (sql,...params) => db.prepare(sql).run(...params);
  const term = user => one('SELECT * FROM training_terms_2027 WHERE user_id=?',user);
  const offering = course => one('SELECT * FROM training_offerings_2027 WHERE course_id=?',course);
  function snapshot(user, course) {
    return {term:term(user),member_active:Boolean(one("SELECT 1 FROM users WHERE id=? AND account_status='active'",user)),
      used:one(`SELECT count(*) FILTER(WHERE kind='course') AS course,count(*) FILTER(WHERE kind='masterclass') AS masterclass
        FROM training_reservations_2027 WHERE user_id=? AND mode='included'`,user),
      offering:offering(course),course:one('SELECT id,title,status,enrollment_open,starts_on,ends_on FROM pilot_courses WHERE id=?',course),
      occupied:one(occupied,course,course).n, enrollment:one('SELECT id FROM course_enrollments WHERE course_id=? AND user_id=?',course,user)?.id ?? null,
      reservation:one('SELECT * FROM training_reservations_2027 WHERE course_id=? AND user_id=?',course,user)};
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result = fn(); db.exec('COMMIT'); return result;} catch (err) {db.exec('ROLLBACK'); throw err;}
  }
  return {
    term,offering,snapshot,
    listing(user) {
      const courses=db.prepare(`SELECT o.course_id FROM training_offerings_2027 o JOIN pilot_courses c ON c.id=o.course_id
        WHERE c.status='published' ORDER BY c.starts_on,c.id`).all();
      return courses.map(c=>snapshot(user,c.course_id));
    },
    pending: course => db.prepare("SELECT * FROM training_reservations_2027 WHERE course_id=? AND status='pending' ORDER BY created_at,id").all(course),
    reservations: user => db.prepare('SELECT * FROM training_reservations_2027 WHERE user_id=? ORDER BY created_at,id').all(user),
    setTerm(user,status,at) {
      return transaction(()=>{
        if (!one("SELECT id FROM users WHERE id=? AND (?<>'active' OR account_status='active')",user,status)) fail('training_member_missing',404);
        run(`INSERT INTO training_terms_2027(user_id,status,activated_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE
          SET status=excluded.status,activated_at=coalesce(training_terms_2027.activated_at,excluded.activated_at),updated_at=excluded.updated_at`,
        user,status,status==='active'?at:null,at);
        return term(user);
      });
    },
    configure(course, config) {
      return transaction(()=>{
        const row=one('SELECT * FROM pilot_courses WHERE id=?',course);
        if (!row) fail('training_offering_missing',404);
        if (!datesInProgram(row) || course.toLowerCase()===PILOT) fail('training_invalid',400);
        if (config.capacity < one(occupied,course,course).n ||
          (offering(course)?.kind!==config.kind && one('SELECT id FROM training_reservations_2027 WHERE course_id=? LIMIT 1',course))) fail('training_conflict');
        run(`INSERT INTO training_offerings_2027 VALUES(?,?,?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET kind=excluded.kind,
          included_eligible=excluded.included_eligible,regular_cents=excluded.regular_cents,promo_cents=excluded.promo_cents,capacity=excluded.capacity`,
        course,config.kind,+config.includedEligible,config.regularCents,config.promoCents,config.capacity);
        return offering(course);
      });
    },
    async apply(user,course,expected,command) {
      return transaction(()=>{
        if (JSON.stringify(snapshot(user,course))!==JSON.stringify(expected)) return false;
        const j=command;
        if (j.action==='cancel') run('DELETE FROM training_reservations_2027 WHERE id=?',j.id);
        else {
          if (j.action==='confirm') run("UPDATE training_reservations_2027 SET status='enrolled',confirmed_at=?,enrollment_id=? WHERE id=?",j.at,j.enrollment,j.id);
          else run('INSERT INTO training_reservations_2027(id,user_id,course_id,kind,mode,status,price_cents,created_at,confirmed_at,enrollment_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
            j.id,user,course,expected.offering.kind,j.mode,j.enrollment?'enrolled':'pending',j.price,j.at,j.enrollment?j.at:null,j.enrollment);
          if (j.enrollment) run('INSERT INTO course_enrollments(id,course_id,user_id,created_at,access_basis) VALUES(?,?,?,?,?)',j.enrollment,course,user,j.at,j.mode==='included'?'founder':'independent');
        }
        return true;
      });
    },
  };
}
function hostedTraining(clients,env) {
  async function rpc(name,body) {
    clients ??= createSupabaseClients({env});
    try {
      return await clients.admin.rest('rpc/training_2027_'+name,{method:'POST',body});
    } catch (err) {
      if (/^training_[a-z_]+$/.test(err.message)) {
        const status = err.message.endsWith('_missing') ? 404 : err.message==='training_invalid'?400:409;
        fail(err.message,status);
      }
      throw err;
    }
  }
  return {
    term:user=>rpc('term',{p_user:user}),offering:course=>rpc('offering',{p_course:course}),
    snapshot:(user,course)=>rpc('snapshot',{p_user:user,p_course:course}),listing:user=>rpc('listing',{p_user:user}),
    pending:course=>rpc('pending',{p_course:course}),setTerm:(user,status,at)=>rpc('set_term',{p_user:user,p_status:status,p_at:at}),
    reservations:user=>rpc('user_reservations',{p_user:user}),
    configure:(course,config)=>rpc('configure',{p_course:course,p_config:config}),
    apply:(user,course,expected,command)=>rpc('apply',{p_user:user,p_course:course,p_expected:expected,p_command:command}),
  };
}

// A single pricing and eligibility implementation serves both stores. Each mutation compares the snapshot
// again under database locks before committing, so a stale quote, suspension or competing hold cannot win.
export function createTrainingStore({db,clients,env}={}) {
  const store=db?sqliteTraining(db):hostedTraining(clients,env);
  async function mutate(user,course,at,choose) {
    for (let i=0;i<6;i++) {
      const old=await store.snapshot(user,course);
      const state=stateView(old,at);
      if (!old.member_active) fail('training_member_missing',404);
      if (!state.offering) fail('training_offering_missing',404);
      const command=choose(state);
      if (!command) return state;
      if (await store.apply(user,course,old,{...command,at})) return stateView(await store.snapshot(user,course),at);
    }
    fail('training_conflict');
  }
  return {
    getTerm:async(user,at)=>termView(await store.term(user),instant(at)),
    async setMemberTerm(user,status,at) {
      if (!statuses.includes(status)) fail('training_invalid',400);
      const time=instant(at);
      return termView(await store.setTerm(user,status,time),time);
    },
    getOffering:async course=>offeringView(await store.offering(course)),
    async upsertOffering(course,config={}) {
      if (!kinds.includes(config.kind) || typeof config.includedEligible!=='boolean' ||
          !integer(config.regularCents,0,limits.money) || !(config.promoCents===null || integer(config.promoCents,0,limits.money)) ||
          !integer(config.capacity,1,limits.capacity)) fail('training_invalid',400);
      return offeringView(await store.configure(course,config));
    },
    getState:async(user,course,at)=>stateView(await store.snapshot(user,course),instant(at)),
    async listState(user,at) {
      const time=instant(at), rows=await store.listing(user);
      const summary=stateView(rows[0]??await store.snapshot(user,null),time);
      return {year:YEAR,term:summary.term,used:summary.used,offerings:rows.map(raw=>stateView(raw,time))};
    },
    listPending:async course=>(await store.pending(course)).map(reservationView),
    async exportMember(user,at) {
      const [term,rows]=await Promise.all([store.term(user),store.reservations(user)]);
      return {year:YEAR,term:termView(term,instant(at)),reservations:rows.map(reservationView)};
    },
    async reserve(user,course,mode,at,expectedPriceCents) {
      if (!['included','additional'].includes(mode) || (mode==='additional'&&!integer(expectedPriceCents,0,limits.money))) fail('training_invalid',400);
      return mutate(user,course,instant(at),s=>{
        if (s.reservation) {
          if (s.reservation.mode!==mode) fail('training_reserved');
          if (mode==='additional' && s.reservation.priceCents!==expectedPriceCents) fail('training_price_changed');
          return null;
        }
        if (s.enrolled) fail('training_already_enrolled');
        if (!s.offering.open) fail('training_closed');
        if (mode==='included') {
          if (s.quoteCents===0) fail('training_free_offering');
          if (!s.term.active) fail('training_term_inactive',403);
          if (!s.offering.includedEligible) fail('training_ineligible',403);
          if (s.used[s.offering.kind]) fail('training_quota_used');
        } else if (s.quoteCents!==expectedPriceCents) fail('training_price_changed');
        if (!s.offering.available) fail('training_full');
        const price = mode==='included' ? 0 : s.quoteCents;
        return {action:'reserve',id:randomUUID(),mode,price,enrollment:price===0 ? randomUUID() : null};
      });
    },
    async confirmAdditional(user,course,reservationId,at,expectedPriceCents) {
      if (!integer(expectedPriceCents,0,limits.money)) fail('training_invalid',400);
      return mutate(user,course,instant(at),s=>{
        const r=s.reservation;
        if (!r) fail('training_reservation_missing',404);
        if (r.id!==reservationId || r.mode!=='additional') fail('training_reserved');
        if (r.priceCents!==expectedPriceCents) fail('training_price_changed');
        if (r.status==='enrolled') return null;
        return {action:'confirm',id:r.id,mode:'additional',price:r.priceCents,enrollment:randomUUID()};
      });
    },
    async cancelAdditional(user,course,reservationId,at) {
      return mutate(user,course,instant(at),s=>{
        const r=s.reservation;
        if (!r) return null;
        if (r.id!==reservationId || r.status!=='pending') fail('training_reserved');
        return {action:'cancel',id:r.id};
      });
    },
  };
}
