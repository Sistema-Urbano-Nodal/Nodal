import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {attendanceHours} from '../server/fiiu-domain.js';
import {mergeProgramme} from '../server/fiiu-programme.js';

/* The FIIU badges: one pure rule in fiiu-ui.js (Fiiu.festivalBadges) that the console's Recognition ledger and the
   check-in page both use, so a badge the check-in page announces is the badge the console shows. */
function fiiu(){
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);
 // The page's objects come from another realm; a JSON copy compares as plain data.
 const Fiiu=context.window.Fiiu;return {...Fiiu,festivalBadges:(...args)=>JSON.parse(JSON.stringify(Fiiu.festivalBadges(...args)))};
}
// The programme as GET /api/fiiu serves it: built-in blocks with the organisers' edits laid over them.
const programme=(rows=[])=>JSON.parse(JSON.stringify(mergeProgramme(rows)));
const EVENT=programme();
const row=(activityId,method='qr')=>({activityId,createdAt:'2026-10-21T14:12:00.000Z',method});
const registration=answers=>({id:'r1',version:1,labStatus:'none',answers:{activities:[],externalActivities:[],applyLab:false,...answers}});
// ana: two conference blocks and the party in her plan, a workshop interest, checked in to day1-am.
const ana=registration({activities:['day1-am','day2-am','closing-party'],externalActivities:['workshop-espacios-comunidad']});
// beto: a public official who applied to the laboratory.
const beto={...registration({publicOfficial:true,applyLab:true,activities:['day1-am','day3-am']}),labStatus:'pending'};
const ids=list=>list.map(badge=>badge.id);
const earned=list=>list.filter(badge=>badge.state==='earned').map(badge=>badge.id);
const byId=(list,id)=>list.find(badge=>badge.id===id);

test('every block in the plan that takes a check-in is a session badge, locked until its attendance row exists, then earned',()=>{
 const {festivalBadges}=fiiu();
 const locked=festivalBadges(ana,[],EVENT);
 assert.deepEqual(ids(locked.filter(badge=>badge.kind==='session')),['session:day1-am','session:day2-am'],'the party never takes a check-in, and a workshop interest is not attendance');
 assert.ok(locked.filter(badge=>badge.kind==='session').every(badge=>badge.state==='locked'),'registration alone earns nothing');
 const badges=festivalBadges(ana,[row('day1-am')],EVENT),day1=byId(badges,'session:day1-am');
 assert.equal(day1.state,'earned');assert.equal(day1.activityId,'day1-am');assert.equal(byId(badges,'session:day2-am').state,'locked');
 assert.equal(day1.activity.title,'El poder de lo local','the row carries its block for the title, date, time and venue');
 assert.equal(day1.minutes,240,'its certificate minutes come from the shared hours helper');
});

test('the laboratory is a session badge and a milestone only for people who applied, and attendance earns both',()=>{
 const {festivalBadges}=fiiu();
 const applied=festivalBadges(beto,[],EVENT);
 assert.deepEqual(ids(applied.filter(badge=>badge.kind==='session')),['session:day0-lab','session:day1-am','session:day3-am'],'in programme order, the laboratory first (20 October)');
 assert.deepEqual(byId(applied,'milestone:lab'),{id:'milestone:lab',kind:'milestone',state:'locked',meter:{done:0,total:1}});
 assert.equal(byId(applied,'session:day0-lab').minutes,0,'the laboratory has no certificate minutes while its length is unknown');
 const attended=festivalBadges({...beto,labStatus:'accepted'},[row('day0-lab','staff')],EVENT);
 assert.equal(byId(attended,'session:day0-lab').state,'earned');assert.equal(byId(attended,'milestone:lab').state,'earned');
 assert.equal(byId(attended,'milestone:lab').meter,undefined,'an earned milestone carries no meter');
 const notApplied=festivalBadges(ana,[row('day1-am')],EVENT);
 assert.equal(notApplied.some(badge=>badge.activityId==='day0-lab'||badge.id==='milestone:lab'),false,'no laboratory badge for someone who did not apply');
});

test('four milestones count the attended blocks, with a meter while unearned',()=>{
 const {festivalBadges}=fiiu();
 const none=festivalBadges(ana,[],EVENT).filter(badge=>badge.kind==='milestone');
 assert.deepEqual(none,[
  {id:'milestone:first',kind:'milestone',state:'locked',meter:{done:0,total:1}},
  {id:'milestone:three',kind:'milestone',state:'locked',meter:{done:0,total:3}},
  {id:'milestone:conferences',kind:'milestone',state:'locked',meter:{done:0,total:5}},
 ]);
 const one=festivalBadges(ana,[row('day1-am')],EVENT);
 assert.equal(byId(one,'milestone:first').state,'earned');assert.deepEqual(byId(one,'milestone:three').meter,{done:1,total:3});
 // A staff-confirmed workshop is an attended block too; it is not a conference.
 const three=festivalBadges(ana,[row('day1-am'),row('day1-pm'),row('workshop-espacios-comunidad','staff')],EVENT);
 assert.equal(byId(three,'milestone:three').state,'earned');assert.deepEqual(byId(three,'milestone:conferences').meter,{done:2,total:5});
 const five=festivalBadges(ana,['day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>row(id)),EVENT);
 assert.equal(byId(five,'milestone:conferences').state,'earned');
 // The five conferences are the event's 'general' blocks, so the total follows the programme the API serves.
 assert.equal(EVENT.activities.filter(activity=>activity.registration==='general').length,5);
});

test('workshops and routes appear only once staff confirm attendance, as participation without hours; the party is never a badge',()=>{
 const {festivalBadges,hoursOf}=fiiu();
 // An organiser gave the workshop a time range: it still adds no certificate hours, as on the server.
 const event=programme([{id:'workshop-espacios-comunidad',data:{time:'10:00–12:00'}}]);
 assert.equal(festivalBadges(ana,[],event).some(badge=>badge.activityId==='workshop-espacios-comunidad'),false,'an interest alone shows nothing');
 const attendance=[row('day1-am'),row('workshop-espacios-comunidad','staff'),row('closing-party','staff')],badges=festivalBadges(ana,attendance,event);
 const workshop=byId(badges,'session:workshop-espacios-comunidad');
 assert.equal(workshop.state,'earned');assert.equal(workshop.minutes,0);assert.equal(workshop.activity.time,'10:00–12:00');
 assert.equal(badges.some(badge=>badge.activityId==='closing-party'),false,'the closing party never takes a check-in and is never a badge');
 // The badge minutes add up to the hours the server certifies.
 const minutes=badges.filter(badge=>badge.state==='earned').reduce((sum,badge)=>sum+(badge.minutes||0),0);
 assert.equal(minutes,attendanceHours(attendance,event.activities).minutes);assert.equal(minutes,hoursOf(attendance,event).minutes);
});

test('the badges follow the merged programme, so an organiser’s edit shows on the badge',()=>{
 const {festivalBadges}=fiiu();
 const event=programme([{id:'day2-pm',data:{title:'El espacio público como escenario',date:'2026-10-22',time:'19:00–21:30',venue:'Hall Segundo Piso, MALI'}}]);
 const badge=byId(festivalBadges(registration({activities:['day2-pm']}),[row('day2-pm')],event),'session:day2-pm');
 assert.equal(badge.activity.venue,'Hall Segundo Piso, MALI');assert.equal(badge.minutes,150);
});

test('an attended block stays earned when it leaves the plan, repeated and unknown rows count once or not at all, and the order is the programme’s',()=>{
 const {festivalBadges}=fiiu();
 const badges=festivalBadges(registration({activities:['day3-am']}),[row('day2-am'),row('day2-am','staff'),row('no-such-block'),row('day1-am')],EVENT);
 assert.deepEqual(ids(badges.filter(badge=>badge.kind==='session')),['session:day1-am','session:day2-am','session:day3-am']);
 assert.deepEqual(earned(badges),['session:day1-am','session:day2-am','milestone:first']);
 assert.deepEqual(byId(badges,'milestone:three').meter,{done:2,total:3});
});

test('what is earned depends on the attendance alone, so the check-in page, which has no registration, agrees with the console',()=>{
 const {festivalBadges}=fiiu();
 const sets=[[],[row('day1-am')],[row('day0-lab'),row('day1-am'),row('day3-am')],[row('route-amancaes','staff'),row('day2-pm')],['day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>row(id))];
 for(const attendance of sets)for(const person of [ana,beto,null])assert.deepEqual(earned(festivalBadges(person,attendance,EVENT)),earned(festivalBadges(null,attendance,EVENT)));
 // Without a registration the plan is unknown: only attended blocks are listed, and the laboratory milestone once it is attended
 // (only an accepted application checks in to it).
 const before=festivalBadges(null,[],EVENT),after=festivalBadges(null,[row('day0-lab')],EVENT);
 assert.deepEqual(ids(before),['milestone:first','milestone:three','milestone:conferences']);
 assert.deepEqual(earned(after),['session:day0-lab','milestone:first','milestone:lab']);
 assert.doesNotThrow(()=>festivalBadges(null,undefined,{activities:[]}));
});
