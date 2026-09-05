import { pathToFileURL } from 'node:url';
import { createRepository } from '../server/repository.js';
import { createCourseStore } from '../server/courses-repository.js';
import { normalizeCourse, normalizeModule } from '../server/courses-domain.js';

// Stable operational IDs make repeat runs safe. Content and dates are editable thereafter.
export const PILOT_COURSE_ID = '72e3cc56-a506-4a1b-97b5-9333e8d283ca';
const MODULE_IDS=['9a3e58ed-44b1-4706-8791-f375135d0661','36986386-cd68-42ad-9fb8-930e621018d1','2a14e8f5-48a3-46f5-a5db-1b8bff6c7d97','7d01edba-149b-4d8b-9395-26539c4c2e70'];
export async function setupCoursePilot(store) {
  const stamp=new Date().toISOString();
  let course=(await store.find('courses',{id:PILOT_COURSE_ID},{limit:1}))[0];
  if(!course)course=await store.insert('courses',{id:PILOT_COURSE_ID,...normalizeCourse({title:'Curso Movilidad Nivel 2',description:'Piloto NODAL: observación en campo, registro fotográfico y análisis de un punto de conexión multimodal.',startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true}),version:1,createdAt:stamp,updatedAt:stamp});
  for(const [i,date]of ['2026-09-09','2026-09-14','2026-09-16','2026-09-21'].entries()) {
    if((await store.find('modules',{id:MODULE_IDS[i]},{limit:1})).length)continue;
    await store.insert('modules',{id:MODULE_IDS[i],courseId:course.id,...normalizeModule({title:`Sesión ${i+1}`,position:i+1,sessionDate:date,status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
  }
  return course;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const repository=createRepository();
  try {
    const store=createCourseStore({db:repository.database});
    const course=await setupCoursePilot(store);
    console.log(JSON.stringify({courseId:course.id,title:course.title,path:`/course.html?id=${course.id}`,note:'Course shell ready. Staff must publish their materials in the teaching workspace.'}));
  } finally { repository.close?.(); }
}
