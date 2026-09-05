import { pathToFileURL } from 'node:url';
import { createRepository } from '../server/repository.js';
import { createCourseStore } from '../server/courses-repository.js';
import { normalizeCourse, normalizeModule } from '../server/courses-domain.js';

// Stable operational IDs make repeat runs safe. Content and dates are editable thereafter.
export const PILOT_COURSE_ID = '72e3cc56-a506-4a1b-97b5-9333e8d283ca';
const MODULE_IDS=['9a3e58ed-44b1-4706-8791-f375135d0661','36986386-cd68-42ad-9fb8-930e621018d1','2a14e8f5-48a3-46f5-a5db-1b8bff6c7d97','7d01edba-149b-4d8b-9395-26539c4c2e70'];
const PILOT_CONTENT={title:'Curso Movilidad Nivel 2',description:'Piloto NODAL: observación en campo, registro fotográfico y análisis de un punto de conexión multimodal.'};
const PILOT_TRANSLATIONS={
  en:{title:'Mobility Level 2 Course',description:'NODAL pilot: field observation, photographic documentation, and analysis of a multimodal connection point.'},
  es:{...PILOT_CONTENT},
  pt:{title:'Curso de Mobilidade Nível 2',description:'Piloto NODAL: observação em campo, registro fotográfico e análise de um ponto de conexão multimodal.'},
};
async function enrichTranslations(store,name,row,base,translations,stamp) {
  const merged=structuredClone(row.translations??{});let changed=false;
  for(const [locale,fields]of Object.entries(translations))for(const [field,value]of Object.entries(fields)) {
    // Translate only the exact original shell text. Staff edits and intentional
    // empty translations remain theirs, even when setup is rerun after release.
    if(row[field]!==base[field]||Object.hasOwn(merged[locale]??{},field))continue;
    (merged[locale]??={})[field]=value;changed=true;
  }
  if(!changed)return row;
  const updated=await store.update(name,{id:row.id,version:row.version},{translations:merged,version:row.version+1,updatedAt:stamp});
  if(!updated)throw new Error('Pilot content changed during translation setup; retry safely');
  return updated;
}
export async function setupCoursePilot(store) {
  const stamp=new Date().toISOString();
  let course=(await store.find('courses',{id:PILOT_COURSE_ID},{limit:1}))[0];
  if(!course)course=await store.insert('courses',{id:PILOT_COURSE_ID,...normalizeCourse({...PILOT_CONTENT,translations:PILOT_TRANSLATIONS,startsOn:'2026-09-09',endsOn:'2026-09-21',status:'published',enrollmentOpen:true}),version:1,createdAt:stamp,updatedAt:stamp});
  else course=await enrichTranslations(store,'courses',course,PILOT_CONTENT,PILOT_TRANSLATIONS,stamp);
  for(const [i,date]of ['2026-09-09','2026-09-14','2026-09-16','2026-09-21'].entries()) {
    const base={title:`Sesión ${i+1}`},translations={en:{title:`Session ${i+1}`},es:{title:base.title},pt:{title:`Sessão ${i+1}`}};
    const existing=(await store.find('modules',{id:MODULE_IDS[i],courseId:course.id},{limit:1}))[0];
    if(existing){await enrichTranslations(store,'modules',existing,base,translations,stamp);continue;}
    await store.insert('modules',{id:MODULE_IDS[i],courseId:course.id,...normalizeModule({...base,translations,position:i+1,sessionDate:date,status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
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
