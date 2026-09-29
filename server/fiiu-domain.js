import {fail,text,httpsUrl} from './courses-domain.js';

export const EVENT_ID='fiiu-2026';
export const FIIU_EVENT={
 id:EVENT_ID,title:'FIIU Fest 11',theme:'El poder de lo local',city:'Lima, Perú',startsOn:'2026-10-20',endsOn:'2026-10-25',timeZone:'America/Lima',website:'https://fiiu.sistemaurbano.org/',contact:'fiiu@ocupatucalle.com',
 activities:[
  {id:'day0-lab',date:'2026-10-20',period:'lab',registration:'application',title:'Gestión urbana en acción: nuevas herramientas para la gestión local',time:'',venue:'',sessions:[]},
  {id:'day1-am',date:'2026-10-21',period:'morning',registration:'general',title:'El poder de lo local',time:'09:00–13:00',venue:'',sessions:[['09:00–10:00','¡Bienvenidos al FIIU 11!'],['10:00–11:00','El poder de lo local: ciudadanía activa'],['11:00–13:00','Gobernanza colaborativa: una oportunidad para las nuevas autoridades']]},
  {id:'day1-pm',date:'2026-10-21',period:'evening',registration:'general',title:'Intervenir para activar: Acupuntura urbana, microinfraestructura y acción comunitaria',time:'19:00–21:00',venue:'',sessions:[]},
  {id:'day2-am',date:'2026-10-22',period:'morning',registration:'general',title:'Cuidar y transformar la ciudad',time:'09:00–13:00',venue:'Auditorio, NOS PUCP, San Isidro',sessions:[['09:00–10:30','Movilidad y entornos sensibles al cuidado'],['10:30–12:00','Hacer ciudad en alianza'],['12:00–13:00','Transformar para habitar mejor: Respuestas urbanas frente a la vulnerabilidad']]},
  {id:'day2-pm',date:'2026-10-22',period:'evening',registration:'general',title:'El espacio público como escenario para expresar, cuestionar y movilizar',time:'19:00–21:00',venue:'',sessions:[]},
  {id:'day3-am',date:'2026-10-23',period:'morning',registration:'general',title:'Territorio, resiliencia y adaptación climática',time:'09:00–13:00',venue:'Auditorio, NOS PUCP, San Isidro',sessions:[['09:00–10:30','Decisiones desde el territorio: Transformación y planificación urbana desde el gobierno local'],['10:30–11:00','Reporte de percepciones sobre cambio climático y riesgos en Lima y Callao'],['11:00–13:00','Resiliencia urbana y adaptación climática']]},
  ...[1,2,3].map(day=>({id:`workshop-day${day}`,date:`2026-10-${20+day}`,period:'workshop',registration:'external',title:'Talleres',time:'',venue:'',sessions:[],linkKey:'workshopsUrl'})),
  ...[4,5].map(day=>({id:`route-day${day}`,date:`2026-10-${20+day}`,period:'route',registration:'external',title:'Rutas urbanas',time:'',venue:'',sessions:[],linkKey:'routesUrl'})),
 ],
};
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
 if(!activities.length&&!applyLab)fail('select an activity or apply for the laboratory');
 const accessibility=input.accessibility??[];
 if(!Array.isArray(accessibility)||accessibility.length>6||accessibility.some(value=>!['none','mobility','visual','hearing','communication','other'].includes(value))||(accessibility.includes('none')&&accessibility.length>1))fail('invalid accessibility');
 const age=input.age===undefined||input.age===''||input.age===null?null:input.age;
 if(age!==null&&(!Number.isInteger(age)||age<1||age>120))fail('invalid age');
 return {
  firstName:text(input.firstName,'firstName',100,true),lastName:text(input.lastName,'lastName',120,true),
  country:text(input.country,'country',120,true),city:text(input.city,'city',160,true),
  profile:choices(input.profile,['student','academic','researcher','professional','entrepreneur','activist','organization','public_official','other'],'profile'),
  nationalId:text(input.nationalId,'nationalId',50),gender:choices(input.gender,['female','male','other','prefer_not'],'gender',true),age,
  accessibility:[...new Set(accessibility)],accessibilityOther:text(input.accessibilityOther,'accessibilityOther',500),
  motivation:choices(input.motivation,['learn','career','network','explore','other'],'motivation',true),motivationOther:text(input.motivationOther,'motivationOther',500),
  previousAttendance:choices(input.previousAttendance,['all','some','no'],'previousAttendance',true),
  publicOfficial,applyLab,institution:applyLab?text(input.institution,'institution',200,true):'',position:applyLab?text(input.position,'position',200,true):'',
  activities:[...new Set(activities)].sort(),privacyAccepted:true,
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
 if(activityId&&!FIIU_EVENT.activities.some(a=>a.id===activityId))fail('invalid activityId');
 const kind=choices(input.kind,['news','recording','material'],'kind');
 return {status:choices(input.status,['draft','published','archived'],'status'),data:{title:text(input.title,'title',180,true),body:text(input.body,'body',5000),kind,activityId,url:input.url?httpsUrl(input.url):kind!=='news'?fail('URL is required'):''}};
}
export const contentView=row=>({id:row.id,...row.data,status:row.status,version:row.version,createdAt:row.createdAt,updatedAt:row.updatedAt});
