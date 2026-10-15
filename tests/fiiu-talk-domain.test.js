import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeQuestion,normalizeMessage,decodeTalkFile,displayName,namesFor,messageView,goneView,questionView,activityView,talkActivity,GENERAL_SPACE,TALK_LIMITS,TALK_FILE_TYPES} from '../server/fiiu-talk-domain.js';
import {FIIU_EVENT} from '../server/fiiu-domain.js';

test('display names keep a first name and a surname initial',()=>{
 assert.equal(displayName('María José','  gonzález  '),'María José G.');
 assert.equal(displayName('Ana','123'),'Ana');assert.equal(displayName('','Pérez'),'Participante P.');
 assert.equal(displayName('Łukasz','éclair'),'Łukasz É.');
});
test('display names collapse whitespace, cap the first name at 60 characters and drop direction overrides',()=>{
 assert.equal(displayName(' Ana \n  Lucía\t','  ruiz'),'Ana Lucía R.');
 assert.equal(displayName('A'.repeat(80),'B'),'A'.repeat(60)+' B.');
 assert.equal(displayName('😀'.repeat(61),''),'😀'.repeat(60),'the cap counts code points, so it never splits an emoji');
 assert.equal(displayName('Ana‮','‮perez'),'Ana P.','a right-to-left override cannot reorder the name or what follows it');
 assert.equal(displayName(undefined,undefined),'Participante');assert.equal(displayName('ana','ñandú'),'ana Ñ.');
});
test('organisers without a registration are named from their profile',()=>{
 assert.deepEqual(namesFor({name:'Flavia  Ramírez Soto'},null),{authorName:'Flavia S.',authorFull:'Flavia  Ramírez Soto'});
 assert.deepEqual(namesFor({name:'x'},{answers:{firstName:'Ana',lastName:'Test'}}),{authorName:'Ana T.',authorFull:'Ana Test'});
});
test('names come from the store\'s flat registration record too, a one-word profile name has no initial, and both are capped',()=>{
 assert.deepEqual(namesFor({name:'x'},{id:'r',email:'a@example.org',firstName:'Ana',lastName:'Test'}),{authorName:'Ana T.',authorFull:'Ana Test'});
 assert.deepEqual(namesFor({name:'Flavia'},null),{authorName:'Flavia',authorFull:'Flavia'});
 assert.deepEqual(namesFor({fullName:'Flavia Soto'},null),{authorName:'Flavia S.',authorFull:'Flavia Soto'});
 assert.deepEqual(namesFor({},null),{authorName:'Participante',authorFull:''});
 const long=namesFor({name:'x'},{answers:{firstName:'A'.repeat(100),lastName:'B'.repeat(200)}});
 assert.equal(long.authorName,'A'.repeat(60)+' B.');assert.equal([...long.authorFull].length,240);
});
test('only current festival activities can carry questions',()=>{
 assert.equal(talkActivity('day1-am').id,'day1-am');
 assert.equal(talkActivity('workshop-day1'),null,'legacy activities are excluded');
 assert.equal(talkActivity('nope'),null);assert.equal(talkActivity(undefined),null);
});
test('General is a festival-wide space next to the blocks, with no date, time, venue or talks',()=>{
 const general={id:'general',period:'general',title:'FIIU General',date:null,time:'',venue:'',sessions:[],registration:'general-space'};
 assert.deepEqual(GENERAL_SPACE,general);assert.deepEqual(talkActivity('general'),general);
 assert.deepEqual(activityView(talkActivity('general')),general,'the view carries every field the chat header reads');
 assert.equal(FIIU_EVENT.activities.some(a=>a.id==='general'),false,'it is not part of the programme');
 assert.deepEqual(normalizeQuestion({activityId:'general',body:'¿Cómo va el festival?'}),{activityId:'general',talk:null,body:'¿Cómo va el festival?',status:'open',kind:'chat'});
 for(const talk of ['¡Bienvenidos al FIIU 11!','Otra'])assert.throws(()=>normalizeQuestion({activityId:'general',body:'x',talk}),e=>e.code==='invalid_talk',talk);
});
test('blocks and their talks come from the programme the server serves, so organiser edits apply',()=>{
 const event={...FIIU_EVENT,activities:FIIU_EVENT.activities.map(a=>a.id==='day1-am'?{...a,title:'Lo local, editado',sessions:[['09:00–10:00','Bienvenida renombrada']]}:a)};
 assert.equal(talkActivity('day1-am',event).title,'Lo local, editado');assert.equal(talkActivity('day1-am').title,'El poder de lo local','the built-in programme by default');
 assert.equal(talkActivity('general',event),GENERAL_SPACE);assert.equal(talkActivity('workshop-day1',event),null);
 assert.equal(normalizeQuestion({activityId:'day1-am',body:'x',talk:'Bienvenida renombrada'},null,event).talk,'Bienvenida renombrada');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',talk:'¡Bienvenidos al FIIU 11!'},null,event),e=>e.code==='invalid_talk','a talk renamed since is no longer offered');
});
test('questions belong to a current activity and an optional talk of that block',()=>{
 assert.equal(normalizeQuestion({activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:' ¿Qué te llevas? '}).body,'¿Qué te llevas?');
 assert.throws(()=>normalizeQuestion({activityId:'workshop-day1',body:'x'}),e=>e.code==='invalid_activity');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',talk:'Other',body:'x'}),e=>e.code==='invalid_talk');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x'.repeat(501)}),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',status:'closed'}),e=>e.status===400,'a new question is open or hidden');
 assert.equal(normalizeQuestion({body:'y',status:'closed'},{activityId:'day1-am',talk:null,body:'x',status:'open'}).status,'closed');
 assert.throws(()=>normalizeQuestion({activityId:'day2-am',body:'y'},{activityId:'day1-am',body:'x',status:'open'}),e=>e.status===400,'activity cannot change');
});
test('a new question defaults to open, may be saved hidden, and needs a body',()=>{
 assert.deepEqual(normalizeQuestion({activityId:'day1-pm',body:'¿Qué intervendrías?'}),{activityId:'day1-pm',talk:null,body:'¿Qué intervendrías?',status:'open',kind:'chat'});
 assert.equal(normalizeQuestion({activityId:'day1-pm',body:'x',status:'hidden'}).status,'hidden');
 for(const talk of ['',null,'   '])assert.equal(normalizeQuestion({activityId:'day1-am',body:'x',talk}).talk,null,JSON.stringify(talk));
 assert.equal(normalizeQuestion({activityId:'day1-am',body:'x',talk:' El poder de lo local: ciudadanía activa '}).talk,'El poder de lo local: ciudadanía activa');
 assert.throws(()=>normalizeQuestion({activityId:'day1-pm',body:'x',talk:'¡Bienvenidos al FIIU 11!'}),e=>e.code==='invalid_talk','a talk of another block');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',talk:3}),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'   '}),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',status:'draft'}),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({body:'x'}),e=>e.code==='invalid_activity');
 assert.equal(normalizeQuestion({activityId:'day1-am',body:'x'.repeat(500)}).body.length,500);
});
test('an edit keeps what it does not change and validates what it does',()=>{
 const current={activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'x',status:'closed',version:3};
 assert.deepEqual(normalizeQuestion({version:3,status:'hidden'},current),{activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'x',status:'hidden',kind:'chat'});
 assert.deepEqual(normalizeQuestion({body:'y',talk:null},current),{activityId:'day1-am',talk:null,body:'y',status:'closed',kind:'chat'});
 assert.equal(normalizeQuestion({activityId:'day1-am',status:'open'},current).status,'open','repeating the same activity is fine');
 assert.throws(()=>normalizeQuestion({talk:'Other'},current),e=>e.code==='invalid_talk');
 assert.throws(()=>normalizeQuestion({body:''},current),e=>e.status===400);
 assert.throws(()=>normalizeQuestion({status:'archived'},current),e=>e.status===400);
 assert.equal(normalizeQuestion({status:'open'},{...current,talk:'A talk renamed since'}).talk,'A talk renamed since','a status change does not re-check a talk the catalogue renamed');
});
test('messages need text or files and stay within the limits',()=>{
 const clientId='11111111-1111-4111-8111-111111111111',file='22222222-2222-4222-8222-222222222222';
 assert.throws(()=>normalizeMessage({clientId,body:'   '}),e=>e.code==='empty_message');
 assert.deepEqual(normalizeMessage({clientId,body:'',fileIds:[file,file.toUpperCase()]}).fileIds,[file]);
 assert.throws(()=>normalizeMessage({clientId,body:'😀'.repeat(1001)}),e=>e.code==='message_too_long');
 assert.equal(normalizeMessage({clientId,body:'😀'.repeat(1000)}).body.length,2000,'counts code points, not UTF-16 units');
 assert.throws(()=>normalizeMessage({clientId,body:'x',fileIds:Array.from({length:4},(_,i)=>`2222222${i}-2222-4222-8222-222222222222`)}),e=>e.code==='too_many_files');
});
test('a message has a client id, trimmed text and up to three distinct file ids',()=>{
 const clientId='11111111-1111-4111-8111-111111111111',files=Array.from({length:3},(_,i)=>`2222222${i}-2222-4222-8222-222222222222`);
 assert.deepEqual(normalizeMessage({clientId:clientId.toUpperCase(),body:'  hola \n'}),{clientId,body:'hola',fileIds:[]});
 assert.deepEqual(normalizeMessage({clientId,fileIds:files}),{clientId,body:'',fileIds:files},'files alone are a message');
 assert.equal(normalizeMessage({clientId,body:'x'.repeat(1000)}).body.length,1000);
 assert.throws(()=>normalizeMessage({clientId,body:'x'.repeat(1001)}),e=>e.code==='message_too_long'&&e.status===400);
 assert.throws(()=>normalizeMessage({body:'hola'}),e=>e.status===400,'a client id is required');
 assert.throws(()=>normalizeMessage({clientId,body:'hola',fileIds:['nope']}),e=>e.status===400);
 assert.throws(()=>normalizeMessage({clientId,body:'hola',fileIds:'x'}),e=>e.status===400);
 assert.throws(()=>normalizeMessage({clientId,body:{}}),e=>e.status===400,'text must be text');
 assert.throws(()=>normalizeMessage({clientId}),e=>e.code==='empty_message');
});
test('festival files are images or PDFs within 3 MB, and a thumbnail is a small JPEG or WebP of an image',()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16]).toString('base64'),pdf=Buffer.from('%PDF-1.4').toString('base64');
 const f=decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:jpeg,width:1600,height:900,thumb:{mime:'image/jpeg',data:jpeg}});
 assert.equal(f.thumb.size,6);assert.equal(f.width,1600);
 assert.throws(()=>decodeTalkFile({name:'a.txt',mime:'text/plain',data:Buffer.from('hi').toString('base64')}),e=>e.code==='file_type');
 assert.throws(()=>decodeTalkFile({name:'a.pdf',mime:'application/pdf',data:pdf,thumb:{mime:'image/jpeg',data:jpeg}}),e=>e.status===400,'PDFs carry no thumbnail');
 assert.equal(decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:jpeg,width:0}).width,null);
});
test('file sizes, dimensions and thumbnails are checked against the festival limits',()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16]).toString('base64'),webp=Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64'),png=Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64');
 const big=Buffer.alloc(TALK_LIMITS.fileBytes+1,0);big[0]=255;big[1]=216;big[2]=255;
 assert.throws(()=>decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:big.toString('base64')}),e=>e.status===413&&e.code==='file_size');
 const full=Buffer.alloc(TALK_LIMITS.fileBytes,0);full[0]=255;full[1]=216;full[2]=255;
 assert.equal(decodeTalkFile({name:'a.jpg',mime:'image/jpeg',data:full.toString('base64')}).size,TALK_LIMITS.fileBytes,'exactly 3 MB is allowed');
 const thumb=Buffer.alloc(TALK_LIMITS.thumbBytes+1,0);thumb[0]=255;thumb[1]=216;thumb[2]=255;
 assert.throws(()=>decodeTalkFile({name:'a.png',mime:'image/png',data:png,thumb:{data:thumb.toString('base64')}}),e=>e.status===413&&e.code==='file_size','a thumbnail is at most 100 KB');
 assert.throws(()=>decodeTalkFile({name:'a.png',mime:'image/png',data:png,thumb:{mime:'image/png',data:png}}),e=>e.code==='file_type','a thumbnail is JPEG or WebP');
 assert.throws(()=>decodeTalkFile({name:'a.png',mime:'image/png',data:png,thumb:'x'}),e=>e.status===400);
 const p=decodeTalkFile({name:'a.png',mime:'image/png',data:png,width:1600,height:900.5,thumb:{data:jpeg,width:480,height:270}});
 assert.deepEqual({name:p.name,mime:p.mime,size:p.size,width:p.width,height:p.height},{name:'a.png',mime:'image/png',size:10,width:null,height:null},'dimensions are whole numbers, and come as a pair');
 assert.equal(decodeTalkFile({name:'a.png',mime:'image/png',data:png,width:'1600',height:'900'}).width,null,'numbers, not numeric text');
 assert.deepEqual({size:p.thumb.size,width:p.thumb.width,height:p.thumb.height},{size:6,width:480,height:270});assert.ok(Buffer.isBuffer(p.thumb.bytes));
 const w=decodeTalkFile({name:'a.webp',mime:'image/webp',data:webp,width:20000,height:1,thumb:{mime:'image/webp',data:webp,width:20001,height:1}});
 assert.deepEqual([w.width,w.height,w.thumb.width,w.thumb.height],[20000,1,null,null]);
 const d=decodeTalkFile({name:'notes',mime:'application/pdf',data:Buffer.from('%PDF-1.4').toString('base64'),width:10,height:10,thumb:null});
 assert.deepEqual({name:d.name,width:d.width,height:d.height,thumb:d.thumb},{name:'notes.pdf',width:null,height:null,thumb:null},'a PDF has no dimensions; a null thumbnail is no thumbnail');
 assert.deepEqual(TALK_FILE_TYPES,['image/jpeg','image/png','image/webp','application/pdf']);
});
test('message views never reveal ids and show organisers the full name and hidden state',()=>{
 const m={id:'m',userId:'u',authorName:'Ana T.',authorFull:'Ana Test',organiser:0,body:'hola',clientId:'c-ana',likeCount:2,createdAt:'2026-10-21T14:00:00.000Z',seq:7,hiddenAt:null};
 const view=messageView(m,{viewer:'u',organiser:false,files:[],liked:true});
 assert.deepEqual(view,{id:'m',author:'Ana T.',organiser:false,mine:true,clientId:'c-ana',body:'hola',files:[],likeCount:2,liked:true,createdAt:m.createdAt,seq:7},'the author gets back the clientId their own phone made, to match a send whose answer was lost');
 const organiser=messageView({...m,hiddenAt:'x'},{viewer:'o',organiser:true,files:[],liked:false});
 assert.equal(organiser.hidden,true);assert.equal('clientId' in organiser,false,'nobody else gets it, organisers included');
 assert.equal('clientId' in messageView(m,{viewer:'b',organiser:false}),false);assert.equal('clientId' in messageView(m,{organiser:false}),false,'nor a view without a viewer');
 assert.deepEqual(goneView(m),{id:'m',seq:7,gone:true});
});
test('message views list files by safe name and mark organiser authors and thumbnails',()=>{
 const m={id:'m',userId:'o',authorName:'Flavia S.',authorFull:'Flavia Soto',organiser:true,body:'',clientId:'c-flavia',likeCount:0,createdAt:'2026-10-21T14:00:00.000Z',seq:'9',hiddenAt:null,storagePath:'fiiu/o/f'};
 const files=[{id:'f1',name:'foto',mime:'image/jpeg',size:900,width:1600,height:900,thumbSize:120,storagePath:'fiiu/o/f1',userId:'o'},{id:'f2',name:'deck.pdf',mime:'application/pdf',size:4000,thumbSize:null}];
 const view=messageView(m,{viewer:'u',organiser:true,files,liked:false});
 assert.deepEqual(view,{id:'m',author:'Flavia S.',organiser:true,mine:false,body:'',likeCount:0,liked:false,createdAt:m.createdAt,seq:9,authorFull:'Flavia Soto',hidden:false,
  files:[{id:'f1',name:'foto.jpg',mime:'image/jpeg',size:900,width:1600,height:900,thumb:true},{id:'f2',name:'deck.pdf',mime:'application/pdf',size:4000,width:null,height:null,thumb:false}]});
 assert.equal(messageView({...m,userId:null},{organiser:false}).mine,false,'an erased author is nobody\'s message, not the signed-out viewer\'s');
 assert.equal(JSON.stringify(messageView(m,{viewer:'u',organiser:false,files})).includes('fiiu/'),false,'storage paths never leave the server');
});
test('question and activity views carry what the chat header needs and the version only for organisers',()=>{
 const q={id:'q',eventId:'fiiu-2026',activityId:'day1-am',talk:null,body:'¿Qué te llevas?',status:'open',revision:'4',messageCount:2,createdBy:'u',version:2,createdAt:'2026-10-21T14:00:00.000Z',updatedAt:'x'};
 assert.deepEqual(questionView(q,{organiser:false}),{id:'q',activityId:'day1-am',talk:null,body:'¿Qué te llevas?',status:'open',kind:'chat',revision:4,messageCount:2,createdAt:q.createdAt});
 assert.deepEqual(questionView(q,{organiser:true}),{id:'q',activityId:'day1-am',talk:null,body:'¿Qué te llevas?',status:'open',kind:'chat',revision:4,messageCount:2,createdAt:q.createdAt,version:2});
 const a=FIIU_EVENT.activities.find(x=>x.id==='day1-am');
 assert.deepEqual(activityView(a),{id:'day1-am',title:a.title,date:'2026-10-21',time:'09:00–13:00',venue:a.venue,sessions:a.sessions,registration:'general',period:'morning'});
});
test('a question is a conversation or a 1–10 rating, chosen when it is created and never changed',()=>{
 assert.equal(normalizeQuestion({activityId:'day1-am',body:'x'}).kind,'chat');assert.equal(normalizeQuestion({activityId:'day1-am',body:'x',kind:null}).kind,'chat');
 assert.equal(normalizeQuestion({activityId:'general',body:'Del 1 al 10, ¿cuánto te sirvió?',kind:'rating'}).kind,'rating');
 for(const kind of ['poll','Rating','',1,{}])assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'x',kind}),e=>e.status===400&&e.code==='invalid_kind',JSON.stringify(kind));
 const current={activityId:'day1-am',talk:null,body:'x',status:'open',kind:'rating'};
 assert.equal(normalizeQuestion({body:'y'},current).kind,'rating');assert.equal(normalizeQuestion({body:'y',kind:'rating'},current).kind,'rating','repeating the same type is fine');
 assert.throws(()=>normalizeQuestion({kind:'chat'},current),e=>e.status===400&&e.code==='kind_locked');
 assert.throws(()=>normalizeQuestion({kind:'rating'},{...current,kind:'chat'}),e=>e.code==='kind_locked');
 assert.throws(()=>normalizeQuestion({kind:'poll'},current),e=>e.code==='kind_locked');
 assert.equal(normalizeQuestion({status:'closed'},{...current,kind:undefined}).kind,'chat','a row from before question types is a conversation');
});
test('question views carry the type, and a rating question its ten totals, score 1 first',()=>{
 const q={id:'q',eventId:'fiiu-2026',activityId:'general',talk:null,body:'¿Del 1 al 10?',status:'open',kind:'rating',ratingCounts:['0',1,0,0,0,0,0,2,0,0],revision:3,messageCount:0,version:1,createdAt:'2026-10-21T14:00:00.000Z'};
 assert.deepEqual(questionView(q),{id:'q',activityId:'general',talk:null,body:'¿Del 1 al 10?',status:'open',kind:'rating',ratingCounts:[0,1,0,0,0,0,0,2,0,0],revision:3,messageCount:0,createdAt:q.createdAt});
 assert.deepEqual(questionView({...q,ratingCounts:null}).ratingCounts,Array(10).fill(0));
 const chat=questionView({...q,kind:'chat',ratingCounts:null},{organiser:true});
 assert.equal(chat.kind,'chat');assert.equal('ratingCounts' in chat,false,'a conversation has no totals');
});
test('the limits match the migration and the spec',()=>{
 assert.deepEqual(TALK_LIMITS,{question:500,talk:180,message:1000,files:3,fileBytes:3145728,thumbBytes:102400,quotaFiles:30,quotaBytes:31457280,page:100,changes:200});
});
test('control characters are stripped from messages and questions before the limits, so both backends store the same text',()=>{
 const clientId='11111111-1111-4111-8111-111111111111';
 // PostgreSQL cannot store U+0000 in text; SQLite cut the text there. Tab, newline and carriage return stay.
 assert.equal(normalizeMessage({clientId,body:'a\u0000b\u0007c\td\ne\r\nf\u001F'}).body,'abc\td\ne\r\nf');
 assert.throws(()=>normalizeMessage({clientId,body:'\u0000\u0001 '}),e=>e.code==='empty_message','only control characters is an empty message');
 assert.equal(normalizeMessage({clientId,body:'x'.repeat(1000)+'\u0000'.repeat(5)}).body.length,1000,'stripped before the length check');
 assert.equal(normalizeMessage({clientId,body:'a\uD800b'}).body,'a�b','a lone surrogate (JSON allows one) becomes the replacement character');
 const q=normalizeQuestion({activityId:'day1-am',body:'¿Qué\u0000 te llevas?\u0008',talk:'¡Bienvenidos al FIIU 11!\u0000'});
 assert.equal(q.body,'¿Qué te llevas?');assert.equal(q.talk,'¡Bienvenidos al FIIU 11!');
 assert.equal(normalizeQuestion({body:'y\u0000'},{activityId:'day1-am',talk:null,body:'x',status:'open'}).body,'y');
 assert.throws(()=>normalizeQuestion({activityId:'day1-am',body:'\u0000'}),e=>e.status===400,'a question of control characters has no body');
});
test('a file name over 160 characters is shortened, keeping its extension, rather than refused',()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16]).toString('base64'),pdf=Buffer.from('%PDF-1.4').toString('base64');
 const report=decodeTalkFile({name:'Informe '.repeat(30)+'final.pdf',mime:'application/pdf',data:pdf});
 assert.equal(report.name.length,160);assert.ok(report.name.endsWith('.pdf'));assert.ok(report.name.startsWith('Informe Informe'));
 const photo=decodeTalkFile({name:'😀'.repeat(100)+'.jpeg',mime:'image/jpeg',data:jpeg});
 assert.ok(photo.name.length<=160&&photo.name.endsWith('.jpeg'));assert.equal(photo.name.isWellFormed(),true,'an emoji is never split');
 assert.equal(decodeTalkFile({name:'x'.repeat(200),mime:'application/pdf',data:pdf}).name,'x'.repeat(156)+'.pdf','no extension: the type adds one');
 assert.equal(decodeTalkFile({name:'a'.repeat(160),mime:'application/pdf',data:pdf}).name.length,160);
 assert.throws(()=>decodeTalkFile({name:'',mime:'application/pdf',data:pdf}),e=>e.status===400,'a name is still required');
});
test('message views can leave the viewer\'s like out, and show authors their own hidden message as hidden',()=>{
 const m={id:'m',userId:'u',authorName:'Ana T.',authorFull:'Ana Test',organiser:0,body:'hola',likeCount:2,createdAt:'2026-10-21T14:00:00.000Z',seq:7,hiddenAt:null};
 assert.equal('liked' in messageView(m,{viewer:'u',liked:null}),false,'a shared answer carries no per-viewer like');
 const hidden=messageView({...m,hiddenAt:'x'},{viewer:'u',organiser:false});
 assert.equal(hidden.hidden,true);assert.equal(hidden.mine,true);assert.equal('authorFull' in hidden,false);
 assert.equal('hidden' in messageView(m,{viewer:'u'}),false,'a shown message says nothing to a participant');
});

test('shortening a file name costs the same for a name of megabytes, so one upload cannot stall the server',()=>{
 const pdf=Buffer.from('%PDF-1.4').toString('base64'),started=performance.now();
 const f=decodeTalkFile({name:'a'.repeat(4e6)+'.pdf',mime:'application/pdf',data:pdf});
 assert.ok(performance.now()-started<200,'the cut stops at the limit');
 assert.equal(f.name.length,160);assert.ok(f.name.endsWith('.pdf'));
});
