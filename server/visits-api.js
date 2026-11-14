import {bodyJson} from './courses-api.js';
import {limaDayStart} from './node-requests-api.js';
import {VISIT_WRITE_MS} from './visits-repository.js';

// POST /api/visit (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R1. Visit counter").
// A hit stores a Lima day, a page key and one of a fixed set of sources: never the referrer, the query, the address or a visitor.
const PAGES=['login','fundadores','opportunities','community','resources','knowledge','fiiu','fiiu-session','dashboard','profile','payments','courses','course'];
export const VISIT_PAGES=Object.freeze({'/':'index.html','/index.html':'index.html',...Object.fromEntries(PAGES.map(name=>[`/${name}.html`,`${name}.html`]))});
export const VISIT_SOURCES=Object.freeze(['direct','search','whatsapp','email','linkedin','instagram','facebook','x','qr','sistemaurbano','other']);
export const VISIT_VIAS=Object.freeze(['whatsapp','email','linkedin','instagram','facebook','x','qr']);
const IGNORED_AGENT=/bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptimerobot|facebookexternalhit|whatsapp\/|curl\/|wget\/|python-requests|go-http-client/i;
const GOOGLE=/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/;
// In the order they are tried: the mail hosts that sit under a search host come before it.
const HOSTS=[
 ['email',['mail.google.com','outlook.live.com','outlook.office.com','mail.yahoo.com','com.google.android.gm']],
 ['search',['bing.com','duckduckgo.com','yahoo.com','ecosia.org','brave.com','yandex.com','startpage.com','com.google.android.googlequicksearchbox']],
 ['whatsapp',['whatsapp.com','wa.me','com.whatsapp']],
 ['linkedin',['linkedin.com','lnkd.in','com.linkedin.android']],
 ['instagram',['instagram.com','com.instagram.android']],
 ['facebook',['facebook.com','fb.com','messenger.com','com.facebook.katana']],
 ['x',['x.com','twitter.com','t.co','com.twitter.android']],
 ['sistemaurbano',['sistemaurbano.org']],
];
const under=(host,domain)=>host===domain||host.endsWith(`.${domain}`);
function sourceOf(referrer){
 if(referrer==='')return 'direct';
 if(!/^[a-z0-9.-]+$/.test(referrer))return 'other';
 for(const [source,domains] of HOSTS){
  if(domains.some(domain=>under(referrer,domain)))return source;
  // google.<tld> is a search host, tried only once the mail hosts (first in the list) are ruled out.
  if(source==='email'&&GOOGLE.test(referrer))return 'search';
 }
 return 'other';
}
export function classifyVisit(input,userAgent){
 if(!input||typeof input.p!=='string'||typeof input.r!=='string'||typeof input.v!=='string')return null;
 if(!Object.hasOwn(VISIT_PAGES,input.p))return null;
 if(typeof userAgent!=='string'||userAgent===''||IGNORED_AGENT.test(userAgent))return null;
 const page=VISIT_PAGES[input.p];
 if(input.r==='self')return {page,arrival:false,source:''};
 const via=input.v.trim().toLowerCase();
 return {page,arrival:true,source:VISIT_VIAS.includes(via)?via:sourceOf(input.r.trim().toLowerCase())};
}
export const visitDay=ms=>limaDayStart(ms).slice(0,10);

export function createVisitApi({store,send,sameOrigin,now,addressAllowed,ceilingAllowed,writeMs=VISIT_WRITE_MS,pauseMs=60000,log=console.error}){
 let pausedUntil=0,logged=false;
 const done=(res)=>send(res,204,'');
 return async({req,res,url})=>{
  if(url.pathname!=='/api/visit')return false;
  try{
   if(req.method!=='POST'){send(res,405,{error:'method not allowed'},{Allow:'POST'});return true;}
   const origin=req.headers.origin;
   let sameSite=Boolean(origin)&&sameOrigin(req)&&[undefined,'same-origin'].includes(req.headers['sec-fetch-site']);
   if(sameSite){try{sameSite=new URL(origin).host===req.headers.host;}catch{sameSite=false;}}
   if(!sameSite){send(res,403,{error:'cross-origin request rejected'});return true;}
   if(!addressAllowed(req,res))return true;
   let body;
   try{body=await bodyJson(req,1024);}catch(err){send(res,err.status??400,{error:err.message});return true;}
   const hit=classifyVisit(body,req.headers['user-agent']);
   if(!hit||now()<pausedUntil||!ceilingAllowed()||!store){done(res);return true;}
   let timer;
   try{
    await Promise.race([store.count({day:visitDay(now()),...hit}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('visit count timed out'),{code:'VISIT_TIMEOUT'})),writeMs);})]);
   }catch(err){
    pausedUntil=now()+pauseMs;
    if(!logged){logged=true;log(`Visit count failed: ${err?.code||err?.upstream||err?.status||err?.name}`);}
   }finally{clearTimeout(timer);}
   done(res);return true;
  }catch{
   if(!res.headersSent)done(res);
   return true;
  }
 };
}
