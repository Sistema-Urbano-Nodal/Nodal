import {parentPort,workerData} from 'node:worker_threads';
import {createDatabase} from '../../server/db.js';
import {createCourseStore} from '../../server/courses-repository.js';

const db=createDatabase({filename:workerData.filename,migrate:false});
db.exec('PRAGMA busy_timeout=5000');
const store=createCourseStore({db});
parentPort.postMessage({ready:true});
Atomics.wait(new Int32Array(workerData.barrier),0,0);
try {
 await store.reserveAttachment(workerData.attachment);
 parentPort.postMessage({status:201});
} catch(error) {parentPort.postMessage({status:error.status??500,message:error.message});}
finally {db.close();}
