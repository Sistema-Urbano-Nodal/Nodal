import test from 'node:test';
import assert from 'node:assert/strict';
import {BUC_CATEGORIES,TOPIC_TO_BUC,BLOCK_TO_BUC,bucLinks,searchWords} from '../server/buc.js';
import {ALL_FIIU_ACTIVITIES} from '../server/fiiu-domain.js';

/* BUC (https://buc.sistemaurbano.org/) is never contacted from these tests: links are only strings, and the feed reader
   runs on fake fetches with fixtures. */
const SEARCH='https://buc.sistemaurbano.org/busqueda';
const params=link=>Object.fromEntries(new URL(link.url).searchParams);

test('the eight BUC categories carry their Spanish names under BUC ids', () => {
  assert.deepEqual({...BUC_CATEGORIES},{1:'Infancia',2:'Espacio público',3:'Ambiente',4:'Metodologías',5:'Cultura',6:'Gobernanza',7:'Movilidad',8:'Inclusión'});
});

test('every NODAL topic maps onto a BUC category and, where the spec says so, extra Spanish search words', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TOPIC_TO_BUC).map(([name,{category,words}])=>[name,[category,words]])),{
    'Mobility':[7,''],
    'Public space':[2,''],
    'Housing':[8,'vivienda'],
    'Climate & resilience':[3,'clima'],
    'Care & gender':[8,'cuidado'],
    'Governance & participation':[6,''],
    'Safety':[2,'seguridad'],
    'Informality':[8,'informalidad'],
    'Heritage':[5,'patrimonio'],
    'Urban data & tech':[4,'datos'],
    'Land use & planning':[4,'planificación'],
    'Environment & nature':[3,''],
  });
});

test('every festival block has its BUC categories, in one place, and only known ids', () => {
  assert.deepEqual(Object.keys(BLOCK_TO_BUC).sort(),ALL_FIIU_ACTIVITIES.map(activity=>activity.id).sort(),'a block added to the programme needs a line here');
  for(const [id,categories] of Object.entries(BLOCK_TO_BUC)){
    assert.ok(Array.isArray(categories),id);
    for(const category of categories)assert.ok(Object.hasOwn(BUC_CATEGORIES,category),`${id}: ${category}`);
  }
  // The conference blocks follow the spec.
  assert.deepEqual(BLOCK_TO_BUC['day0-lab'],[6]);
  assert.deepEqual(BLOCK_TO_BUC['day1-am'],[6]);
  assert.deepEqual(BLOCK_TO_BUC['day1-pm'],[2]);
  assert.deepEqual(BLOCK_TO_BUC['day2-am'],[8,7]);
  assert.deepEqual(BLOCK_TO_BUC['day2-pm'],[5,2]);
  assert.deepEqual(BLOCK_TO_BUC['day3-am'],[3]);
  // The party has no readings; workshops and routes take the category closest to their titles.
  assert.deepEqual(BLOCK_TO_BUC['closing-party'],[]);
  assert.deepEqual(BLOCK_TO_BUC['workshop-mapa-empatia'],[1],'the view of a city from childhood');
  assert.deepEqual(BLOCK_TO_BUC['workshop-bosques-urbanos'],[3],'urban forests');
  assert.deepEqual(BLOCK_TO_BUC['workshop-calles-gente'],[7],'walkability');
  assert.deepEqual(BLOCK_TO_BUC['route-restauracion-chl'],[5],'restoring the historic centre');
});

test('a topic link searches its category with its words, labelled with the category, tagged for BUC analytics', () => {
  const [link]=bucLinks({topics:['Housing'],context:'console'});
  assert.equal(link.url.split('?')[0],SEARCH);
  assert.deepEqual(params(link),{q:'vivienda',c:'8',utm_source:'nodal',utm_medium:'console'});
  assert.deepEqual({label:link.label,category:link.category,words:link.words},{label:'Inclusión',category:8,words:'vivienda'});
  // A topic without extra words searches the whole category; the empty q is what BUC's own form sends.
  const [mobility]=bucLinks({topics:['Mobility'],context:'course'});
  assert.equal(mobility.url,`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=course`);
  assert.deepEqual({label:mobility.label,category:mobility.category,words:mobility.words},{label:'Movilidad',category:7,words:''});
});

test('words are URL-encoded, accents included, and a words-only link searches every category', () => {
  const [land]=bucLinks({topics:['Land use & planning'],context:'console'});
  assert.match(land.url,/\?q=planificaci%C3%B3n&c=4&/);
  const [only]=bucLinks({words:'espacio público & niñez',context:'chat'});
  assert.equal(only.url,`${SEARCH}?q=espacio+p%C3%BAblico+ni%C3%B1ez&c=&utm_source=nodal&utm_medium=chat`);
  assert.deepEqual({label:only.label,category:only.category,words:only.words},{label:'Buscar «espacio público niñez» en la BUC',category:null,words:'espacio público niñez'});
  const tricky=bucLinks({words:'calle=plaza&c=7 #barrio ?ruta',categories:[2],context:'chat'});
  assert.deepEqual(tricky.map(link=>link.words),['calle plaza barrio ruta','calle plaza barrio ruta']);
  for(const link of tricky){
    const url=new URL(link.url);
    assert.equal(url.origin+url.pathname,SEARCH);assert.equal(url.hash,'');
    assert.deepEqual([...url.searchParams.keys()],['q','c','utm_source','utm_medium'],'no word can add a parameter');
  }
});

test('a reading request keeps only its subject words: the request itself and small words are dropped', () => {
  assert.equal(searchWords('¿Qué libros me recomiendan sobre vivienda social?'),'vivienda social');
  assert.equal(searchWords('Any good books or readings about public space?'),'public space');
  assert.equal(searchWords('Vocês recomendam livros ou leituras sobre mobilidade urbana?'),'mobilidade urbana');
  assert.equal(searchWords('Bibliografía de MOVILIDAD, movilidad y Movilidad'),'movilidad','case- and accent-insensitive, once each');
  assert.equal(searchWords('¿Alguien me recomienda libros?'),'');
  assert.equal(searchWords('calles plazas parques barrios mercados'),'calles plazas parques barrios','at most four words');
  assert.ok(searchWords('x'.repeat(70)+' '+'y'.repeat(70)).length<=80);
  assert.equal(searchWords(undefined),'');
});

test('categories search with the words, then one words-only link; duplicates collapse; at most four links', () => {
  const links=bucLinks({categories:[8,7],words:'¿libros sobre cuidado?',context:'chat'});
  assert.deepEqual(links.map(link=>[link.category,link.words]),[[8,'cuidado'],[7,'cuidado'],[null,'cuidado']]);
  // A topic and its own category, asked twice, are one link.
  assert.deepEqual(bucLinks({topics:['Mobility','Mobility'],categories:[7,7],context:'course'}).map(link=>link.url),[`${SEARCH}?q=&c=7&utm_source=nodal&utm_medium=course`]);
  // Words asked with topics replace the topics' own words, so each link stays one short search.
  assert.deepEqual(bucLinks({topics:['Housing'],words:'Lima',context:'chat'}).map(link=>[link.category,link.words]),[[8,'lima'],[null,'lima']]);
  const many=bucLinks({topics:['Housing','Care & gender','Informality','Heritage','Safety'],context:'console'});
  assert.equal(many.length,4);
  assert.deepEqual(many.map(link=>link.words),['vivienda','cuidado','informalidad','patrimonio'],'in the order asked');
});

test('unknown topics and categories are ignored; nothing specific opens all eight categories', () => {
  assert.deepEqual(bucLinks({topics:['Transporte','__proto__','constructor'],categories:[0,9,'7x'],context:'knowledge'}).map(link=>link.category),[1,2,3,4,5,6,7,8]);
  const all=bucLinks({context:'knowledge'});
  assert.deepEqual(all.map(link=>link.label),Object.values(BUC_CATEGORIES));
  assert.deepEqual(all.map(link=>params(link)),[1,2,3,4,5,6,7,8].map(c=>({q:'',c:String(c),utm_source:'nodal',utm_medium:'knowledge'})));
  // A request whose words are only the request itself is just as unspecific.
  assert.equal(bucLinks({words:'¿me recomiendan libros?',context:'chat'}).length,8);
});

test('without a context the links still say they come from NODAL', () => {
  assert.deepEqual(params(bucLinks({topics:['Mobility']})[0]),{q:'',c:'7',utm_source:'nodal'});
  assert.deepEqual(params(bucLinks({topics:['Mobility'],context:'elsewhere'})[0]),{q:'',c:'7',utm_source:'nodal'});
});
