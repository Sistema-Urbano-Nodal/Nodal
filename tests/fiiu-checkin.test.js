import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createCheckinCodes,resolveCheckinSecret,checkinClock,SHORT_CODE_ALPHABET,CODE_LENGTH,SHORT_CODE_LENGTH} from '../server/fiiu-checkin.js';
import {CHECKIN_ACTIVITIES} from '../server/fiiu-domain.js';
import {validateRuntimeConfig} from '../server/server.js';

const SECRET='a-fixed-test-secret-of-32-characters!';
const at=(iso)=>{const clock={now:Date.parse(iso)};return {clock,codes:createCheckinCodes({secret:SECRET,now:()=>clock.now})};};
const SUPABASE={NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_public123',SUPABASE_SECRET_KEY:'sb_secret_server123'};

test('a code is accepted for about five minutes and rotates every minute',()=>{
 const {clock,codes}=at('2026-10-21T14:00:30Z'),issued=codes.current('day1-am');
 assert.match(issued.code,/^[A-Za-z0-9_-]{22}$/);assert.equal(issued.code.length,CODE_LENGTH);
 assert.deepEqual([issued.rotatesAt,issued.validUntil],['2026-10-21T14:01:00.000Z','2026-10-21T14:05:00.000Z']);
 clock.now+=4*60000;assert.equal(codes.verify('day1-am',issued.code),issued.slot,'four minutes old');assert.equal(codes.verify('day1-am',issued.shortCode),issued.slot);
 assert.notEqual(codes.current('day1-am').code,issued.code);
 clock.now=Date.parse('2026-10-21T14:05:00Z');assert.equal(codes.verify('day1-am',issued.code),null,'the advertised validUntil is exclusive');
 clock.now+=60000;assert.equal(codes.verify('day1-am',issued.code),null,'six minutes old');
 clock.now=Date.parse('2026-10-21T13:59:59Z');assert.equal(codes.verify('day1-am',issued.code),null,'a code from the future is not accepted');
});

test('a code belongs to one activity block and one secret',()=>{
 const {codes}=at('2026-10-21T14:00:00Z'),{code,shortCode}=codes.current('day1-am');
 assert.equal(codes.verify('day1-pm',code),null);assert.equal(codes.verify('day1-pm',shortCode),null);
 const other=createCheckinCodes({secret:'another-fixed-secret-of-32-characters',now:()=>Date.parse('2026-10-21T14:00:00Z')});
 assert.equal(other.verify('day1-am',code),null);assert.notEqual(other.current('day1-am').code,code);
 assert.deepEqual(codes.find(shortCode,CHECKIN_ACTIVITIES),{activity:CHECKIN_ACTIVITIES.find(a=>a.id==='day1-am'),slot:codes.current('day1-am').slot});
 assert.equal(codes.find(shortCode,CHECKIN_ACTIVITIES.filter(a=>a.id!=='day1-am')),null);
 assert.throws(()=>createCheckinCodes({secret:'short'}),/at least 32/);
});

test('malformed codes are rejected without throwing',()=>{
 const {codes}=at('2026-10-21T14:00:00Z'),{code}=codes.current('day1-am');
 for(const value of [undefined,null,42,{},[],'',code.slice(1),code+'x','x'.repeat(1000),'ÿ'.repeat(22),'é'.repeat(6),'12345','1234567'])
  assert.equal(codes.verify('day1-am',value),null,JSON.stringify(value)?.slice(0,30));
});

test('short codes use six characters from an unambiguous 30-symbol alphabet and accept typed variations',()=>{
 assert.equal(SHORT_CODE_ALPHABET.length,30);assert.equal(new Set(SHORT_CODE_ALPHABET).size,30);assert.doesNotMatch(SHORT_CODE_ALPHABET,/[01IOSZ]/);
 const {clock,codes}=at('2026-10-21T14:00:00Z'),seen=new Set();
 for(let i=0;i<300;i++){const {shortCode}=codes.current(i%2?'day1-am':'day2-pm');assert.equal(shortCode.length,SHORT_CODE_LENGTH);for(const c of shortCode){assert.ok(SHORT_CODE_ALPHABET.includes(c),c);seen.add(c);}clock.now+=60000;}
 assert.equal(seen.size,30,'every symbol is used');
 clock.now=Date.parse('2026-10-21T14:00:00Z');const {shortCode,slot}=codes.current('day1-am');
 for(const typed of [shortCode.toLowerCase(),`${shortCode.slice(0,3)}-${shortCode.slice(3)}`,` ${shortCode.slice(0,3)} ${shortCode.slice(3)} `])assert.equal(codes.verify('day1-am',typed),slot,typed);
});

test('the check-in secret comes from FIIU_CHECKIN_SECRET, then the Supabase server key, then a random per-process value',()=>{
 const configured='c'.repeat(32);
 assert.equal(resolveCheckinSecret({FIIU_CHECKIN_SECRET:configured},'sqlite'),configured);
 assert.equal(resolveCheckinSecret({...SUPABASE,FIIU_CHECKIN_SECRET:configured},'supabase'),configured,'an explicit secret wins');
 assert.throws(()=>resolveCheckinSecret({FIIU_CHECKIN_SECRET:'c'.repeat(31)},'sqlite'),/at least 32 characters/);
 assert.throws(()=>resolveCheckinSecret({FIIU_CHECKIN_SECRET:` ${'c'.repeat(30)} `},'sqlite'),/at least 32 characters/);
 const derived=resolveCheckinSecret(SUPABASE,'supabase');
 assert.deepEqual(derived,createHmac('sha256','sb_secret_server123').update('nodal-fiiu-checkin-secret:v1').digest(),'stable across serverless instances');
 assert.notDeepEqual(resolveCheckinSecret({...SUPABASE,SUPABASE_SECRET_KEY:'sb_secret_other456'},'supabase'),derived);
 assert.throws(()=>resolveCheckinSecret({...SUPABASE,SUPABASE_SECRET_KEY:''},'supabase'),/FIIU_CHECKIN_SECRET or SUPABASE_SECRET_KEY/);
 const a=resolveCheckinSecret({},'sqlite'),b=resolveCheckinSecret({},'sqlite');
 assert.equal(a.length,32);assert.notDeepEqual(a,b);assert.doesNotThrow(()=>createCheckinCodes({secret:a}));
});

test('FIIU_CHECKIN_NOW moves the clock only on a local SQLite server and is refused in production',()=>{
 assert.equal(checkinClock({},'sqlite'),Date.now);
 assert.equal(checkinClock({FIIU_CHECKIN_NOW:'2026-10-21T09:00:00-05:00',NODE_ENV:'production'},'sqlite'),Date.now);
 assert.equal(checkinClock({FIIU_CHECKIN_NOW:'2026-10-21T09:00:00-05:00'},'supabase'),Date.now);
 const clock=checkinClock({FIIU_CHECKIN_NOW:'2026-10-21T09:00:00-05:00'},'sqlite');
 assert.ok(Math.abs(clock()-Date.parse('2026-10-21T14:00:00Z'))<1000,'starts at the given moment and keeps running');
 assert.throws(()=>checkinClock({FIIU_CHECKIN_NOW:'next tuesday'},'sqlite'),/ISO time/);
 const production={NODE_ENV:'production',DATA_BACKEND:'sqlite',DATABASE_PATH:'/var/lib/nodal/nodal.sqlite',PUBLIC_BASE_URL:'https://nodal.example',COOKIE_SECURE:'true',PAYMENTS_MODE:'preview'};
 assert.doesNotThrow(()=>validateRuntimeConfig(production));
 assert.throws(()=>validateRuntimeConfig({...production,FIIU_CHECKIN_NOW:'2026-10-21T09:00:00-05:00'}),/FIIU_CHECKIN_NOW must not be set in production/);
 assert.throws(()=>validateRuntimeConfig({...production,FIIU_CHECKIN_SECRET:'too-short'}),/FIIU_CHECKIN_SECRET must be at least 32 characters/);
 assert.doesNotThrow(()=>validateRuntimeConfig({...production,FIIU_CHECKIN_SECRET:'s'.repeat(40)}));
 assert.throws(()=>validateRuntimeConfig({DATA_BACKEND:'sqlite',FIIU_CHECKIN_NOW:'soon'}),/ISO time/);
 assert.doesNotThrow(()=>validateRuntimeConfig({DATA_BACKEND:'sqlite',FIIU_CHECKIN_NOW:'2026-10-21T09:00:00-05:00'}));
});
