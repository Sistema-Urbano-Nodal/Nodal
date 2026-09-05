/* Explicit local/staging load acceptance. Never reads production DB variables.
   Local default creates and removes its own SQLite file and loopback server.
   Example: node scripts/load-test.js --users=200 --members=1000 --rounds=6
   Staging is GET-only and requires an explicit URL, matching host confirmation,
   and a JSON file with one existing session cookie per simulated member. */
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/server.js';
import { createDatabase, createUser, updateUserProfile, setUserLocation, addFollowDb, recordInteractionDb } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createRepository } from '../server/repository.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  if (!arg.startsWith('--') || !arg.includes('=')) throw new Error('Use --name=value options');
  const split = arg.indexOf('='); return [arg.slice(2,split),arg.slice(split+1)];
}));
const integer = (key, fallback, min, max) => {
  const value=Number(args[key] ?? fallback);
  if (!Number.isInteger(value)||value<min||value>max) throw new Error(`${key} must be ${min}..${max}`);
  return value;
};
const users=integer('users',200,1,500), members=integer('members',1000,users,5000), rounds=integer('rounds',6,1,20);
const routes=['/api/recommendations/me','/api/network/places','/api/recommendations/me','/api/network/places','/api/users?limit=100','/api/auth/me'];
let server, db, temp, base, cookies;
const counts={directoryReads:0,graphReads:0,revisionReads:0};
const percentile=(values,p)=>values.length?Number(values[Math.min(values.length-1,Math.ceil(values.length*p)-1)].toFixed(2)):null;
const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:percentile(sorted,0.50),p95:percentile(sorted,0.95),p99:percentile(sorted,0.99)};};
try {
  if (args['staging-url']) {
    const url=new URL(args['staging-url']);
    if (url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||args['confirm-staging-host']!==url.host) {
      throw new Error('Staging requires an HTTPS origin and --confirm-staging-host matching its exact host');
    }
    if (!args['sessions-file']) throw new Error('Staging requires --sessions-file with existing test session cookies');
    base=url.origin;
    cookies=JSON.parse(readFileSync(args['sessions-file'],'utf8'));
    if (!Array.isArray(cookies)||cookies.length<users||cookies.some(c=>typeof c!=='string'||!c||/[\r\n]/.test(c))||new Set(cookies).size<cookies.length) {
      throw new Error('Provide distinct, nonempty cookie strings for every simulated user');
    }
    cookies=cookies.slice(0,users);
  } else {
    temp=mkdtempSync(path.join(tmpdir(),'nodal-capacity-'));
    db=createDatabase({filename:path.join(temp,'load.sqlite')});
    const cities=[['Lima',-12.04,-77.04],['Bogotá',4.71,-74.07],['São Paulo',-23.55,-46.63],['Quito',-0.18,-78.47]];
    const roles=['Urban Researcher','Civil Engineer','City Planner','Civic Designer','Community Leader'];
    const ids=[];
    db.exec('BEGIN');
    for(let i=0;i<members;i++) {
      const [city,lat,lon]=cities[i%cities.length];
      const row=createUser(db,{fullName:`Synthetic Load Member ${i}`,email:`load-${i}@invalid.test`,passwordHash:'unusable-load-fixture',title:roles[i%roles.length],city});
      updateUserProfile(db,row.id,{interests:['transport',i%2?'housing':'public policy'],active:['am','pm'],partC:{consent:true},topics:[{name:'Mobility',level:2}]});
      setUserLocation(db,row.id,{lat,lon,label:city});ids.push(row.id);
    }
    db.exec('COMMIT');
    for(let i=0;i<ids.length;i++) {
      for(const delta of [1,7,19]) if (ids[(i+delta)%members]!==ids[i]) addFollowDb(db,ids[i],ids[(i+delta)%members]);
      if(members>1) recordInteractionDb(db,ids[i],ids[(i+3)%members],'skip');
    }
    cookies=ids.slice(0,users).map(id=>createSession(db,id,{env:{}}).cookie.split(';')[0]);
    const repository=createRepository({db});
    for(const [method,counter] of [['listDirectoryUsers','directoryReads'],['loadGraphStore','graphReads'],['getNetworkRevision','revisionReads']]) {
      const original=repository[method].bind(repository);
      repository[method]=async(...input)=>{counts[counter]++;return original(...input);};
    }
    server=createApp({repository,citySearch:{search:async()=>{throw new Error('Load fixture must not call an external geocoder');}}});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    base=`http://127.0.0.1:${server.address().port}`;
  }
  const measurements=[],waves=[],statuses={};const etags=new Map();
  const started=performance.now();
  for(let round=0;round<rounds;round++) {
    const route=routes[round%routes.length];const waveStart=performance.now();
    const results=await Promise.all(cookies.map(async(cookie,i)=>{
      const begin=performance.now();let status=0,error=null;
      try {
        const headers={cookie,Accept:'application/json'};
        if(route==='/api/network/places'&&etags.has(i)) headers['If-None-Match']=etags.get(i);
        const response=await fetch(`${base}${route}`,{headers,signal:AbortSignal.timeout(30000)});status=response.status;
        if(status!==304) {
          const body=await response.json();
          if(!response.ok) error=`HTTP ${status}`;
          else if(route.includes('recommendations')&&!Array.isArray(body.recommendations)) error='invalid recommendations response';
          else if(route.includes('network/places')&&!Array.isArray(body.places)) error='invalid map response';
          else if(route.includes('/api/users')&&!Array.isArray(body.users)) error='invalid directory response';
          else if(route==='/api/auth/me'&&!body.user) error='invalid session response';
        }
        if(route==='/api/network/places'&&response.headers.get('etag')) etags.set(i,response.headers.get('etag'));
      } catch(cause) {error=cause.name||'request error';}
      return {route,status,error,ms:performance.now()-begin};
    }));
    measurements.push(...results);
    waves.push({round:round+1,route,concurrency:users,requests:results.length,errors:results.filter(x=>x.error).length,elapsedMs:Math.round(performance.now()-waveStart),latencyMs:summarize(results.map(x=>x.ms))});
  }
  for(const item of measurements) statuses[item.status]=(statuses[item.status]||0)+1;
  const errors=measurements.filter(x=>x.error);
  const report={timestamp:new Date().toISOString(),environment:args['staging-url']?'explicit staging':'local HTTP / isolated file-backed SQLite',node:process.version,users,members:args['staging-url']?null:members,rounds,requests:measurements.length,errors:errors.length,errorTypes:[...new Set(errors.map(x=>x.error))],statuses,elapsedMs:Math.round(performance.now()-started),latencyMs:summarize(measurements.map(x=>x.ms)),databaseReads:args['staging-url']?null:counts,waves,limitations:'Synthetic bounded waves using existing seeded sessions. Excludes signup/login hashing, real user pacing, network RTT, Supabase and deployed infrastructure. Local results do not prove production capacity.'};
  if(args.output) writeFileSync(path.resolve(args.output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(errors.length) process.exitCode=1;
} finally {
  if(server) await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  db?.close();
  if(temp) rmSync(temp,{recursive:true,force:true});
}
