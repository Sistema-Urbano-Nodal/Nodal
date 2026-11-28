import {validateEmail} from './auth.js';
import {bodyJson} from './courses-api.js';
import {identifier} from './courses-domain.js';

export const isTrainingRoute = path => /^\/api\/(?:admin\/)?training(?:\/|$)/.test(path);
const reject = (code, status = 400) => { throw Object.assign(new Error(code), {code, status}); };
const cents = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;

async function inputOf(req, allowed) {
  const input = await bodyJson(req, 2048);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key))) reject('training_invalid');
  return input;
}

export function createTrainingApi({store, courses, users, sameOrigin, send, now=Date.now, allowed}) {
  async function account(email) {
    if (!validateEmail(email) || email.length > 254) reject('training_invalid');
    const result = await users.findCourseAccount(email.trim().toLowerCase());
    if (!result) reject('training_member_missing', 404);
    return result;
  }

  async function route(req, path, user, staff) {
    const method = req.method;
    const at = new Date(now()).toISOString();
    if (!staff && !path && method === 'GET') return store.listState(user.id, at);

    if (staff && path === 'membership' && method === 'PUT') {
      const input = await inputOf(req, ['email', 'status', 'verified']);
      if (!['active','suspended'].includes(input.status) || input.verified !== true) reject('training_invalid');
      const member = await account(input.email);
      if (input.status === 'active' && (!member.active || !member.confirmed)) reject('training_ineligible', 409);
      return {term:await store.setMemberTerm(member.id, input.status, at)};
    }
    if (staff && path === 'membership/lookup' && method === 'POST') {
      const input = await inputOf(req, ['email']);
      return {term:await store.getTerm((await account(input.email)).id, at)};
    }

    const [id, action, receipt, ...rest] = path.split('/');
    if (rest.length || !/^[\da-f-]{36}$/i.test(id || '')) reject('training_not_found', 404);
    const courseId = identifier(id);
    const [course] = await courses.find('courses', {id:courseId}, {limit:1});
    if (!course) reject('training_offering_missing', 404);
    if (!staff && course.status !== 'published') {
      // The holder can release a seat using their receipt even after staff withdraw the course from the catalog.
      if (action !== 'reservations' || !receipt || method !== 'DELETE') reject('training_offering_missing', 404);
      const state = await store.getState(user.id, courseId, at);
      const reservationId = identifier(receipt);
      if (state.reservation?.id !== reservationId) reject('training_offering_missing', 404);
      const released = await store.cancelAdditional(user.id, courseId, reservationId, at);
      return {...released, offering:null, quoteCents:null, canInclude:false, canReserveAdditional:false};
    }
    if (!staff) {
      if (!action && method === 'GET') return store.getState(user.id, courseId, at);
      if (action === 'reservations' && !receipt && method === 'POST') {
        const {mode, expectedPriceCents} = await inputOf(req, ['mode', 'expectedPriceCents']);
        if (!['included', 'additional'].includes(mode) || (mode === 'additional' && !cents(expectedPriceCents))) reject('training_invalid');
        return store.reserve(user.id, courseId, mode, at, expectedPriceCents);
      }
      if (action === 'reservations' && receipt && method === 'DELETE') {
        return store.cancelAdditional(user.id, courseId, identifier(receipt), at);
      }
    } else if (!receipt) {
      if (action === 'offering' && method === 'GET') return {offering:await store.getOffering(courseId)};
      if (action === 'offering' && method === 'PUT') {
        const config = await inputOf(req, ['kind','includedEligible','regularCents','promoCents','capacity']);
        if (!['course','masterclass'].includes(config.kind) || typeof config.includedEligible !== 'boolean' ||
            !cents(config.regularCents) || (config.promoCents != null && !cents(config.promoCents)) ||
            !Number.isSafeInteger(config.capacity) || config.capacity < 1) reject('training_invalid');
        if (!/^2027-/.test(course.startsOn || '')) reject('training_ineligible', 409);
        return {offering:await store.upsertOffering(courseId, {...config,promoCents:config.promoCents ?? null})};
      }
      if (action === 'reservations' && method === 'GET') {
        const reservations = await store.listPending(courseId);
        const people = new Map();
        for (let i = 0; i < reservations.length; i += 100) {
          for (const member of await courses.getMembers(reservations.slice(i, i+100).map(row => row.userId))) people.set(member.id, member);
        }
        return {reservations:reservations.map(row => ({...row, name:people.get(row.userId)?.name || '', email:people.get(row.userId)?.email || ''}))};
      }
      if (action === 'confirm' && method === 'POST') {
        const input = await inputOf(req, ['email','verified','reservationId','expectedPriceCents']);
        if (input.verified !== true || !cents(input.expectedPriceCents)) reject('training_invalid');
        const member = await account(input.email);
        if (!member.active || !member.confirmed) reject('training_ineligible', 409);
        return store.confirmAdditional(member.id, courseId, identifier(input.reservationId), at, input.expectedPriceCents);
      }
    }
    reject('training_not_found', 404);
  }

  return async function handle({req,res,url,user}) {
    if (!isTrainingRoute(url.pathname)) return false;
    const staff = url.pathname.startsWith('/api/admin/');
    const path = url.pathname.slice((staff ? '/api/admin/training' : '/api/training').length).replace(/^\//, '');
    if (!user) { send(res,401,{code:'training_sign_in'}); return true; }
    if (staff && user.permission !== 'admin') { send(res,403,{code:'training_forbidden'}); return true; }
    if (req.method !== 'GET' && !sameOrigin(req)) { send(res,403,{code:'training_forbidden'}); return true; }
    if (!allowed(req,res,user)) return true;
    try {
      const result = await route(req,path,user,staff);
      send(res,200,result);
    } catch (error) {
      if (error.expose === false || !(error.status >= 400 && error.status < 500)) throw error;
      const code = /^training_[a-z_]+$/.test(error.code || '') ? error.code : error.status === 409 ? 'training_conflict' : 'training_invalid';
      send(res,error.status,{code});
    }
    return true;
  };
}
