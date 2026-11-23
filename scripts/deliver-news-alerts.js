// Run a bounded delivery batch from the operator command line.
// Without --send it exits before opening any connection or reading credentials.
import {parseArgs} from 'node:util';
import {dataBackend} from '../server/supabase.js';
import {createDatabase} from '../server/db.js';
import {createNewsStore} from '../server/news-repository.js';
import {createNewsEmailSender} from '../server/news-alerts.js';

const {values}=parseArgs({options:{send:{type:'boolean'},limit:{type:'string',default:'10'}}});
if(!/^([1-9][0-9]?|100)$/.test(values.limit))throw Error('use --limit 1 through 100');
if(!values.send){
  console.log('Preview only. No connection or delivery requested.');
}else{
  const sendBatch=createNewsEmailSender();
  const db=dataBackend()==='sqlite'?createDatabase():null;
  try{
    const {alerts}=createNewsStore({db});
    console.log(await sendBatch(alerts,{limit:Number(values.limit)}));
  }finally{db?.close();}
}
