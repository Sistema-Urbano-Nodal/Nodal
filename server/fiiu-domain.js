import {fail,text,httpsUrl} from './courses-domain.js';

export const EVENT_ID='fiiu-2026';
export const LEGACY_FIIU_ACTIVITIES=[
 ...[1,2,3].map(day=>({id:`workshop-day${day}`,date:`2026-10-${20+day}`,period:'workshop',registration:'external',title:'Talleres',time:'',venue:'',sessions:[],legacy:true})),
 ...[4,5].map(day=>({id:`route-day${day}`,date:`2026-10-${20+day}`,period:'route',registration:'external',title:'Rutas urbanas',time:'',venue:'',sessions:[],legacy:true})),
];
// Venues and route starting points follow the organisers' live programme (Canva, 30 Sep 2026); 21 Oct evening is still to be confirmed there.
const externalActivities=[
 ['workshop-espacios-comunidad','2026-10-21','workshop','Espacios que sostienen comunidad. Herramientas ecopsicológicas para fortalecer vínculo, participación y sostenibilidad social en el espacio público','FXAqd25wao7QpcPA6','MALI, Cercado de Lima'],
 ['workshop-bosques-urbanos','2026-10-21','workshop','Bosques urbanos que respiran: estimando servicios ecosistémicos con i-Tree Canopy','797LUygbLnP4uYvH6','MALI, Cercado de Lima'],
 ['workshop-poder-local','2026-10-21','workshop','La ruta del poder local: Herramientas ciudadanas para incidir en las decisiones del barrio','SrCpasJDNxbSC2jX7','MALI, Cercado de Lima'],
 ['workshop-calles-gente','2026-10-22','workshop','Calles para la gente: co-diseñando la caminabilidad en ciudades latinoamericanas','AaLSiocE3w6EHhKh6','Escuela de Posgrado, Universidad Continental, Jr. Junín 355, Miraflores'],
 ['workshop-mapa-empatia','2026-10-22','workshop','Mapa de Empatía y Periscopio Inverso: exploración urbana desde la mirada de la infancia','e3ZVaKtaht8uoDJb6','Escuela de Posgrado, Universidad Continental, Jr. Junín 355, Miraflores'],
 ['workshop-vivero-lomita','2026-10-22','workshop','Acercamiento al Vivero Móvil “Lomita”: Metodología de talleres “Guardianes del Arbolito”','Uf9CrCCXziSjbyiH6','Escuela de Posgrado, Universidad Continental, Jr. Junín 355, Miraflores'],
 ['workshop-norma-territorio','2026-10-23','workshop','De la norma al territorio: cómo activar proyectos urbanos reales desde lo colectivo','wF2aXwdq2x1oPPsD6','MALI, Cercado de Lima'],
 ['workshop-diseno-cuidado','2026-10-23','workshop','Herramientas para el diseño participativo de infraestructuras del cuidado de escala barrial','1gwkXWuek6MwRQ5v5','MALI, Cercado de Lima'],
 ['workshop-guardianes','2026-10-23','workshop','Guardianes del territorio: pedagogías para la educación ambiental desde el barrio','gSahReCNtQcnFEje8','Parque Zonal Mayta Cápac, San Martín de Porres'],
 ['route-comunidad-arte-naturaleza','2026-10-24','route','Comunidad, Arte y Naturaleza','WHXGNaEoQ36XCTVw8','Universidad Ricardo Palma, Santiago de Surco'],
 ['route-amancaes','2026-10-24','route','En comunidad por las Lomas de Amancaes Bella Durmiente: biodiversidad, memoria y resistencia territorial','JM7MMs2UzZod2M397','Explanada de la Municipalidad de Independencia, Independencia'],
 ['route-restauracion-chl','2026-10-24','route','Proyectos de restauración y espacio público en el CHL','zdLQ5vm8o6bq9dbp9','Plazuela del Teatro, Centro Histórico de Lima'],
 ['route-arcoiris','2026-10-25','route','Arcoíris sobre ruedas: memoria, diversidad y espacio público en Lima','Z36Ds9eAjhoiFAbp7','Parque Kennedy, Miraflores'],
 ['route-lima-cromatica','2026-10-25','route','Lima cromática','p3cvfgmntgczom1z5','Plaza San Martín, Cercado de Lima'],
].map(([id,date,period,title,form,venue])=>({id,date,period,title,registration:'external',formUrl:`https://forms.gle/${form}`,time:'',venue,sessions:[]}));
export const FIIU_EVENT={
 id:EVENT_ID,title:'FIIU Fest 11',theme:'El poder de lo local',city:'Lima, Perú',startsOn:'2026-10-20',endsOn:'2026-10-25',timeZone:'America/Lima',website:'https://fiiu.sistemaurbano.org/',contact:'fiiu@ocupatucalle.com',
 legacyActivities:LEGACY_FIIU_ACTIVITIES,
 activities:[
  {id:'day0-lab',date:'2026-10-20',period:'lab',registration:'application',title:'Gestión urbana en acción: nuevas herramientas para la gestión local',time:'',venue:'',sessions:[]},
  {id:'day1-am',date:'2026-10-21',period:'morning',registration:'general',title:'El poder de lo local',time:'09:00–13:00',venue:'Auditorio MALI, Cercado de Lima',sessions:[['09:00–10:00','¡Bienvenidos al FIIU 11!'],['10:00–11:00','El poder de lo local: ciudadanía activa'],['11:00–13:00','Gobernanza colaborativa: una oportunidad para las nuevas autoridades']]},
  {id:'day1-pm',date:'2026-10-21',period:'evening',registration:'general',title:'Intervenir para activar: Acupuntura urbana, microinfraestructura y acción comunitaria',time:'19:00–21:00',venue:'Auditorio Taulichusco, Museo Metropolitano de Lima, Cercado de Lima',sessions:[]},
  {id:'day2-am',date:'2026-10-22',period:'morning',registration:'general',title:'Cuidar y transformar la ciudad',time:'09:00–13:00',venue:'Auditorio NOS PUCP, Av. Camino Real 1037, San Isidro',sessions:[['09:00–10:30','Movilidad y entornos sensibles al cuidado'],['10:30–12:00','Hacer ciudad en alianza'],['12:00–13:00','Transformar para habitar mejor: Respuestas urbanas frente a la vulnerabilidad']]},
  {id:'day2-pm',date:'2026-10-22',period:'evening',registration:'general',title:'El espacio público como escenario para expresar, cuestionar y movilizar',time:'19:00–21:00',venue:'Hall Segundo Piso, MALI, Cercado de Lima',sessions:[]},
  {id:'day3-am',date:'2026-10-23',period:'morning',registration:'general',title:'Territorio, resiliencia y adaptación climática',time:'09:00–13:00',venue:'Auditorio NOS PUCP, Av. Camino Real 1037, San Isidro',sessions:[['09:00–10:30','Decisiones desde el territorio: Transformación y planificación urbana desde la gobernanza colaborativa'],['10:30–11:00','Reporte de percepciones sobre cambio climático y riesgos en Lima y Callao'],['11:00–13:00','Resiliencia urbana y adaptación climática']]},
  ...externalActivities,
 ],
};
// Check-in and certificate rules. Lima keeps UTC-05:00 all year (no DST), so a fixed offset is exact.
// Only NODAL's own blocks (the lab and the five conference blocks) take a QR check-in; facilitators run the
// workshops and routes through their Google Forms. A block's window opens 30 minutes before its start and closes
// 30 minutes after its end; an untimed block (the lab, until its hours are known) is open its whole Lima day.
export const LIMA_OFFSET='-05:00',CHECKIN_OPENS_BEFORE_MS=30*60000,CHECKIN_CLOSES_AFTER_MS=30*60000;
const span=time=>{const m=/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(String(time??'').trim());if(!m)return null;const start=m[1]*60+ +m[2],end=m[3]*60+ +m[4];return end>start&&end<=1440?[start,end]:null;};
export const activityMinutes=activity=>{const s=span(activity?.time);return s?s[1]-s[0]:null;};
export const isCheckinActivity=activity=>Boolean(activity)&&!activity.legacy&&['general','application'].includes(activity.registration);
export function checkinWindow(activity){
 const s=span(activity.time),day=Date.parse(`${activity.date}T00:00:00${LIMA_OFFSET}`);
 const [opens,closes]=s?[day+s[0]*60000-CHECKIN_OPENS_BEFORE_MS,day+s[1]*60000+CHECKIN_CLOSES_AFTER_MS]:[day,day+1440*60000];
 return {opensAt:new Date(opens).toISOString(),closesAt:new Date(closes).toISOString()};
}
// The browser never parses times: every current activity carries its certificate minutes (null when it does not count
// or its duration is unknown) and its check-in window (null for workshops and routes). Legacy activities are untouched.
for(const activity of FIIU_EVENT.activities)Object.assign(activity,{minutes:isCheckinActivity(activity)?activityMinutes(activity):null,checkin:isCheckinActivity(activity)?checkinWindow(activity):null});
export const CHECKIN_ACTIVITIES=FIIU_EVENT.activities.filter(isCheckinActivity);
export const ALL_FIIU_ACTIVITIES=[...FIIU_EVENT.activities,...LEGACY_FIIU_ACTIVITIES];
// The organiser rule for confirming attendance, shared by the staff checkbox and the QR check-in: a conference block
// must be in the person's plan, the lab needs an accepted application, and external activities are always allowed.
export function canAttend(registration,activity){
 if(activity.registration==='general')return Array.isArray(registration.answers?.activities)&&registration.answers.activities.includes(activity.id);
 if(activity.registration==='application')return registration.labStatus==='accepted';
 return true;
}
// Certificate hours: one scan or confirmation counts the whole block; only NODAL blocks count; an untimed block adds 0
// and is listed in untimed; the person's total is rounded half up to whole hours.
export function attendanceHours(attendance,activities=ALL_FIIU_ACTIVITIES){
 let minutes=0;const untimed=[];
 for(const id of new Set(attendance.map(row=>row.activityId))){const activity=activities.find(a=>a.id===id);if(!isCheckinActivity(activity))continue;const m=activityMinutes(activity);if(m===null)untimed.push(id);else minutes+=m;}
 return {minutes,hours:Math.floor(minutes/60+0.5),untimed};
}
export const DEFAULT_CONFIG={registrationOpen:true,programUrl:'https://canva.link/ficmkatcg9fudwk',workshopsUrl:'',routesUrl:'',partyUrl:''};
const choices=(value,allowed,name,optional=false)=>{if(optional&&(value===undefined||value===''))return '';if(!allowed.includes(value))fail(`invalid ${name}`);return value;};
export function normalizeRegistration(input){
 if(typeof input.publicOfficial!=='boolean')fail('publicOfficial is required');
 if(input.applyLab!==undefined&&typeof input.applyLab!=='boolean')fail('invalid applyLab');
 if(input.privacyAccepted!==true)fail('privacyAccepted is required');
 const publicOfficial=input.publicOfficial,applyLab=input.applyLab===true;
 if(applyLab&&!publicOfficial)fail('laboratory applications are for public officials');
 const activities=input.activities;
 if(!Array.isArray(activities)||activities.length>5||activities.some(id=>!FIIU_EVENT.activities.some(a=>a.id===id&&a.registration==='general')))fail('invalid activities');
 const external=input.externalActivities??[];
 if(!Array.isArray(external)||external.length>14||external.some(id=>!externalActivities.some(a=>a.id===id)))fail('invalid externalActivities');
 if(!activities.length&&!external.length&&!applyLab)fail('select an activity or apply for the laboratory');
 const accessibility=input.accessibility??[];
 if(!Array.isArray(accessibility)||!accessibility.length||accessibility.length>6||accessibility.some(value=>!['none','mobility','visual','hearing','communication','other'].includes(value))||(accessibility.includes('none')&&accessibility.length>1))fail('invalid accessibility');
 const age=input.age===undefined||input.age===''||input.age===null?null:input.age;
 if(!Number.isInteger(age)||age<1||age>120)fail('invalid age');
 return {
  firstName:text(input.firstName,'firstName',100,true),lastName:text(input.lastName,'lastName',120,true),
  country:text(input.country,'country',120,true),city:text(input.city,'city',160,true),
  profile:choices(input.profile,['student','academic','researcher','professional','entrepreneur','activist','organization','public_official','other'],'profile'),
  nationalId:text(input.nationalId,'nationalId',50,true),gender:choices(input.gender,['female','male','other','prefer_not'],'gender'),age,
  // Details stay optional free text (the first release saved them that way); choosing 'other' makes them required.
  accessibility:[...new Set(accessibility)],accessibilityOther:text(input.accessibilityOther,'accessibilityOther',500,accessibility.includes('other')),
  motivation:choices(input.motivation,['learn','career','network','explore','other'],'motivation'),motivationOther:text(input.motivationOther,'motivationOther',500,input.motivation==='other'),
  previousAttendance:choices(input.previousAttendance,['all','some','no'],'previousAttendance'),
  publicOfficial,applyLab,institution:applyLab?text(input.institution,'institution',200,true):'',position:applyLab?text(input.position,'position',200,true):'',
  activities:[...new Set(activities)].sort(),externalActivities:[...new Set(external)].sort(),privacyAccepted:true,
 };
}
export function applicationStatus(answers,existing){
 if(!answers.applyLab)return 'none';
 // Filling in the national ID the first release left optional completes the application; replacing one is an identity change.
 if(!existing?.answers.applyLab||['institution','position','publicOfficial','firstName','lastName','nationalId'].some(k=>answers[k]!==existing.answers[k]&&(k!=='nationalId'||existing.answers[k])))return 'pending';
 return existing.labStatus;
}
export function version(value){if(!Number.isSafeInteger(value)||value<0)fail('version is required');return value;}
export function normalizeConfig(input){
 if(typeof input.registrationOpen!=='boolean')fail('registrationOpen is required');
 return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key=>[key,key==='registrationOpen'?input[key]:input[key]?httpsUrl(input[key]):'']));
}
export function normalizeContent(input){
 const activityId=text(input.activityId,'activityId',50);
 if(activityId&&!ALL_FIIU_ACTIVITIES.some(a=>a.id===activityId))fail('invalid activityId');
 const kind=choices(input.kind,['news','recording','material'],'kind');
 return {status:choices(input.status,['draft','published','archived'],'status'),data:{title:text(input.title,'title',180,true),body:text(input.body,'body',5000),kind,activityId,url:input.url?httpsUrl(input.url):kind!=='news'?fail('URL is required'):''}};
}
// data.publishedAt is the server's first-publication marker (see the content PATCH), not part of the publication.
export const contentView=({id,data:{publishedAt,...data},status,version,createdAt,updatedAt})=>({id,...data,status,version,createdAt,updatedAt});
