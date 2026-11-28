import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createTrainingStore} from '../server/training-store.js';
import {trainingCases} from './helpers/training-cases.js';

test('SQLite keeps annual kind quotas, prices, holds, existing seats and payment confirmation consistent',async t=>{
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  createCourseStore({db});const store=createTrainingStore({db});
  await trainingCases({store,
    member:async()=>createUser(db,{fullName:'Synthetic',email:randomUUID()+'@example.test',passwordHash:'unused'}).id,
    course:async(year='2027')=>{const id=randomUUID();db.prepare(`INSERT INTO pilot_courses(id,title,status,starts_on,created_at,updated_at)
      VALUES(?,'Test','published',?,'2026-11-01','2026-11-01')`).run(id,year+'-12-01');return id;},
    legacySeat:async(user,id)=>db.prepare("INSERT INTO course_enrollments(id,course_id,user_id,created_at) VALUES(?,?,?,'2026-11-01')").run(randomUUID(),id,user),
    moveDate:async(id,year)=>db.prepare('UPDATE pilot_courses SET starts_on=? WHERE id=?').run(year+'-09-01',id),
    erase:async user=>db.prepare('DELETE FROM users WHERE id=?').run(user),
  });
});
