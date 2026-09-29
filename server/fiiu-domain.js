import {fail,text,httpsUrl} from './courses-domain.js';

export const EVENT_ID='fiiu-2026';
export const LEGACY_FIIU_ACTIVITIES=[
 ...[1,2,3].map(day=>({id:`workshop-day${day}`,date:`2026-10-${20+day}`,period:'workshop',registration:'external',title:'Talleres',time:'',venue:'',sessions:[],legacy:true})),
 ...[4,5].map(day=>({id:`route-day${day}`,date:`2026-10-${20+day}`,period:'route',registration:'external',title:'Rutas urbanas',time:'',venue:'',sessions:[],legacy:true})),
];
const externalActivities=[
 ['workshop-espacios-comunidad','2026-10-21','workshop','Espacios que sostienen comunidad. Herramientas ecopsicológicas para fortalecer vínculo, participación y sostenibilidad social en el espacio público','FXAqd25wao7QpcPA6'],
 ['workshop-bosques-urbanos','2026-10-21','workshop','Bosques urbanos que respiran: estimando servicios ecosistémicos con i-Tree Canopy','797LUygbLnP4uYvH6'],
 ['workshop-poder-local','2026-10-21','workshop','La ruta del poder local: Herramientas ciudadanas para incidir en las decisiones del barrio','SrCpasJDNxbSC2jX7'],
 ['workshop-calles-gente','2026-10-22','workshop','Calles para la gente: co-diseñando la caminabilidad en ciudades latinoamericanas','AaLSiocE3w6EHhKh6'],
 ['workshop-mapa-empatia','2026-10-22','workshop','Mapa de Empatía y Periscopio Inverso: exploración urbana desde la mirada de la infancia','e3ZVaKtaht8uoDJb6'],
 ['workshop-vivero-lomita','2026-10-22','workshop','Acercamiento al Vivero Móvil “Lomita”: Metodología de talleres “Guardianes del Arbolito”','Uf9CrCCXziSjbyiH6'],
 ['workshop-norma-territorio','2026-10-23','workshop','De la norma al territorio: cómo activar proyectos urbanos reales desde lo colectivo','wF2aXwdq2x1oPPsD6'],
 ['workshop-diseno-cuidado','2026-10-23','workshop','Herramientas para el diseño participativo de infraestructuras del cuidado de escala barrial','1gwkXWuek6MwRQ5v5'],
 ['workshop-guardianes','2026-10-23','workshop','Guardianes del territorio: pedagogías para la educación ambiental desde el barrio','gSahReCNtQcnFEje8'],
 ['route-comunidad-arte-naturaleza','2026-10-24','route','Comunidad, Arte y Naturaleza','WHXGNaEoQ36XCTVw8'],
 ['route-amancaes','2026-10-24','route','En comunidad por las Lomas de Amancaes Bella Durmiente: biodiversidad, memoria y resistencia territorial','JM7MMs2UzZod2M397'],
 ['route-restauracion-chl','2026-10-24','route','Proyectos de restauración y espacio público en el CHL','zdLQ5vm8o6bq9dbp9'],
 ['route-arcoiris','2026-10-25','route','Arcoíris sobre ruedas: memoria, diversidad y espacio público en Lima','Z36Ds9eAjhoiFAbp7'],
 ['route-lima-cromatica','2026-10-25','route','Lima cromática','p3cvfgmntgczom1z5'],
].map(([id,date,period,title,form])=>({id,date,period,title,registration:'external',formUrl:`https://forms.gle/${form}`,time:'',venue:'',sessions:[]}));
export const FIIU_EVENT={
 id:EVENT_ID,title:'FIIU Fest 11',theme:'El poder de lo local',city:'Lima, Perú',startsOn:'2026-10-20',endsOn:'2026-10-25',timeZone:'America/Lima',website:'https://fiiu.sistemaurbano.org/',contact:'fiiu@ocupatucalle.com',
 legacyActivities:LEGACY_FIIU_ACTIVITIES,
 activities:[
  {id:'day0-lab',date:'2026-10-20',period:'lab',registration:'application',title:'Gestión urbana en acción: nuevas herramientas para la gestión local',time:'',venue:'',sessions:[]},
  {id:'day1-am',date:'2026-10-21',period:'morning',registration:'general',title:'El poder de lo local',time:'09:00–13:00',venue:'',sessions:[['09:00–10:00','¡Bienvenidos al FIIU 11!'],['10:00–11:00','El poder de lo local: ciudadanía activa'],['11:00–13:00','Gobernanza colaborativa: una oportunidad para las nuevas autoridades']]},
  {id:'day1-pm',date:'2026-10-21',period:'evening',registration:'general',title:'Intervenir para activar: Acupuntura urbana, microinfraestructura y acción comunitaria',time:'19:00–21:00',venue:'',sessions:[]},
  {id:'day2-am',date:'2026-10-22',period:'morning',registration:'general',title:'Cuidar y transformar la ciudad',time:'09:00–13:00',venue:'Auditorio, NOS PUCP, San Isidro',sessions:[['09:00–10:30','Movilidad y entornos sensibles al cuidado'],['10:30–12:00','Hacer ciudad en alianza'],['12:00–13:00','Transformar para habitar mejor: Respuestas urbanas frente a la vulnerabilidad']]},
  {id:'day2-pm',date:'2026-10-22',period:'evening',registration:'general',title:'El espacio público como escenario para expresar, cuestionar y movilizar',time:'19:00–21:00',venue:'',sessions:[]},
  {id:'day3-am',date:'2026-10-23',period:'morning',registration:'general',title:'Territorio, resiliencia y adaptación climática',time:'09:00–13:00',venue:'Auditorio, NOS PUCP, San Isidro',sessions:[['09:00–10:30','Decisiones desde el territorio: Transformación y planificación urbana desde el gobierno local'],['10:30–11:00','Reporte de percepciones sobre cambio climático y riesgos en Lima y Callao'],['11:00–13:00','Resiliencia urbana y adaptación climática']]},
  ...externalActivities,
 ],
};
export const ALL_FIIU_ACTIVITIES=[...FIIU_EVENT.activities,...LEGACY_FIIU_ACTIVITIES];
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
  accessibility:[...new Set(accessibility)],accessibilityOther:accessibility.includes('other')?text(input.accessibilityOther,'accessibilityOther',500,true):'',
  motivation:choices(input.motivation,['learn','career','network','explore','other'],'motivation'),motivationOther:input.motivation==='other'?text(input.motivationOther,'motivationOther',500,true):'',
  previousAttendance:choices(input.previousAttendance,['all','some','no'],'previousAttendance'),
  publicOfficial,applyLab,institution:applyLab?text(input.institution,'institution',200,true):'',position:applyLab?text(input.position,'position',200,true):'',
  activities:[...new Set(activities)].sort(),externalActivities:[...new Set(external)].sort(),privacyAccepted:true,
 };
}
export function applicationStatus(answers,existing){
 if(!answers.applyLab)return 'none';
 if(!existing?.answers.applyLab||['institution','position','publicOfficial','firstName','lastName','nationalId'].some(k=>answers[k]!==existing.answers[k]))return 'pending';
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
export const contentView=row=>({id:row.id,...row.data,status:row.status,version:row.version,createdAt:row.createdAt,updatedAt:row.updatedAt});
