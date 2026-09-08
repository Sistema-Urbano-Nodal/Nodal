const ATTRIBUTION='GeoDB Cities';
const error=(code,status)=>Object.assign(new Error(code),{code,status});
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function validatePosition(input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw error('location_invalid',400);
 if(!finite(input.latitude,-90,90)||!finite(input.longitude,-180,180))throw error('location_invalid',400);
 for(const key of ['accuracyMeters','accuracy'])if(input[key]!==undefined&&!finite(input[key],0,10000))throw error('location_invalid',400);
 return {latitude:Number(input.latitude.toFixed(2)),longitude:Number(input.longitude.toFixed(2))};
}
export function validateCityId(value) {
 if(typeof value!=='string'||!/^(?:[1-9]\d{0,9}|Q[1-9]\d{0,11})$/.test(value))throw error('location_invalid',400);
 return value;
}
function cityView(row) {
 if(!row||!finite(row.latitude,-90,90)||!finite(row.longitude,-180,180)||row.type&&row.type!=='CITY')return null;
 const name=String(row.city||row.name||'').trim(),countryCode=String(row.countryCode||'').toUpperCase();
 if(!name||name.length>120||! /^[A-Z]{2}$/.test(countryCode))return null;
 const id=String(row.wikiDataId||row.id||'');try{validateCityId(id);}catch{return null;}
 const label=[...new Set([name,row.region,row.country].filter(Boolean).map(String))].join(', ').slice(0,120);
 return {id,name,label,countryCode,lat:row.latitude,lon:row.longitude};
}
const iso=(value,width)=>(value<0?'-':'+')+Math.abs(value).toFixed(2).padStart(width+3,'0');
export function createLocationProvider({fetchImpl=fetch,baseUrl=process.env.CITY_SEARCH_URL||'https://geodb-free-service.wirefreethought.com/v1/geo/cities',minIntervalMs=1000,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
 const base=new URL(baseUrl),details=new Map();let nextRequestAt=0;
 async function request(path,query={}) {
  if(base.protocol!=='https:'||!base.pathname.endsWith('/cities'))throw error('location_unavailable',503);
  const delay=Math.max(0,nextRequestAt-now());if(delay>2000)throw error('location_unavailable',503);
  nextRequestAt=Math.max(now(),nextRequestAt)+minIntervalMs;if(delay)await wait(delay);
  const url=new URL(base);url.pathname=base.pathname.replace(/\/cities$/,path);url.search=new URLSearchParams(query).toString();
  try {
   const response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'NODAL city location/1.0'},signal:AbortSignal.timeout(4500)});
   if(!response.ok)throw error('location_unavailable',503);
   return await response.json();
  } catch {throw error('location_unavailable',503);}
 }
 return {
  async suggest(input) {
   const {latitude,longitude}=validatePosition(input);
   const payload=await request(`/locations/${iso(latitude,2)}${iso(longitude,3)}/nearbyCities`,{radius:'50',distanceUnit:'KM',limit:'10',types:'CITY'});
   // GeoDB's nearby endpoint defaults to ascending distance; sort=distance is rejected.
   const cities=(Array.isArray(payload.data)?payload.data:[]).map(row=>({city:cityView(row),distance:row.distance})).filter(entry=>entry.city);
   cities.sort((a,b)=>(Number.isFinite(a.distance)?a.distance:Infinity)-(Number.isFinite(b.distance)?b.distance:Infinity));
   return {city:cities[0]?.city??null,attribution:ATTRIBUTION};
  },
  async city(cityId) {
   const id=validateCityId(cityId),cached=details.get(id);if(cached&&cached.expires>now())return cached.city;
   const payload=await request(`/cities/${id}`),row=payload.data;
   if(row&&![String(row.id),String(row.wikiDataId)].includes(id))throw error('location_unavailable',503);
   const city=cityView(row);if(!city)throw error('location_unavailable',503);
   if(details.size>=128)details.delete(details.keys().next().value);
   details.set(id,{city,expires:now()+86400000});return city;
  }
 };
}
