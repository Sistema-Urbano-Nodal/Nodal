import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFS, FAMILIES, INDICATORS, LEAD, LEAD_SECOND, TRACKED, MONTH_SERIES, TEXTS } from '../server/metrics-catalog.js';
import { READING_PARTS } from '../server/metrics-domain.js';

test('every indicator has a name, a definition, a source and a caveat in three languages', () => {
  assert.equal(DEFS, 1); assert.equal(INDICATORS.length, 47);
  assert.equal(new Set(INDICATORS.map(i => i.key)).size, 47);
  const fieldsOf = Object.fromEntries(INDICATORS.map(i => [i.key, i.fields]));
  for (const [key, field] of [...LEAD, ...Object.values(LEAD_SECOND).flat()]) assert.ok(fieldsOf[key].includes(field), `lead ${key} ${field}`);
  for (const key of Object.keys(LEAD_SECOND)) assert.ok(LEAD.some(([lead]) => lead === key), key);
  for (const key of TRACKED) { const [, base, field = 'total'] = key.match(/^(.*?)(?:\.(d30|d7))?$/); assert.ok(fieldsOf[base].includes(field), `tracked ${key}`); }
  for (const lang of ['es', 'en', 'pt']) {
    assert.deepEqual(Object.keys(TEXTS[lang].families), FAMILIES);
    for (const { key, family } of INDICATORS) {
      assert.ok(FAMILIES.includes(family), key);
      for (const field of ['name', 'definition', 'source', 'caveat']) assert.ok(TEXTS[lang].indicators[key][field].trim(), `${lang} ${key} ${field}`);
    }
    assert.equal(TEXTS[lang].csv.indicators.length, 11);
    assert.equal(TEXTS[lang].csv.months.length, 1 + MONTH_SERIES.length);
    assert.equal(TEXTS[lang].csv.readings.length, 3);
    assert.deepEqual(Object.keys(TEXTS[lang].series), MONTH_SERIES);
    assert.deepEqual(Object.keys(TEXTS[lang].states), ['not_activated', 'unavailable', 'not_yet_counted', 'no_visits_yet']);
    assert.match(TEXTS[lang].states.not_yet_counted, /\{day\}/);
  }
});

test('the names the sheet and the spec fix', () => {
  const es = TEXTS.es;
  assert.deepEqual(Object.values(es.families), ['Visitas', 'Registros', 'Perfiles', 'Actividad', 'Membresías', 'Festival', 'Cursos']);
  assert.equal(es.indicators['profiles.basic'].name, 'Perfil básico completo');
  assert.equal(es.indicators['profiles.saved'].name, 'Perfil guardado');
  assert.equal(es.indicators['memberships.acceptances'].name, 'Aceptaciones antes de pagar (veces)');
  assert.match(es.indicators['profiles.saved'].caveat, /Nunca una autoevaluación/i);
  assert.equal(es.lists.reserved._other, 'otros (menos de 3)');
  assert.notEqual(es.lists.profileTypes.other, es.lists.reserved._other);
  assert.match(es.lists.kinds.profile + ' ' + es.indicators['activity.kinds'].definition, /guardó su perfil o marcó avisos como leídos/);
  assert.deepEqual(es.states, { not_activated: 'Aún no está activado en la base de datos', unavailable: 'No disponible en este momento', not_yet_counted: 'Se cuenta desde el {day}', no_visits_yet: 'Aún no hay visitas contadas' });
  assert.deepEqual(es.parts, { accounts: 'cuentas', members: 'datos de miembros', festival: 'festival', courses: 'cursos', visits: 'visitas', readings: 'lecturas guardadas' });
  assert.equal(TEXTS.en.states.no_visits_yet, 'No visits counted yet');
  assert.equal(TEXTS.pt.states.no_visits_yet, 'Ainda não há visitas contadas');
  for (const lang of ['en', 'pt']) assert.deepEqual(Object.keys(TEXTS[lang].parts), READING_PARTS);
  assert.deepEqual(TEXTS.en.parts, { accounts: 'accounts', members: 'member data', festival: 'festival', courses: 'courses', visits: 'visits', readings: 'saved readings' });
  assert.deepEqual(TEXTS.pt.parts, { accounts: 'contas', members: 'dados de membros', festival: 'festival', courses: 'cursos', visits: 'visitas', readings: 'leituras salvas' });
});

test('the vocabularies match their owners', () => {
  assert.deepEqual(Object.keys(TEXTS.en.lists.profileTypes), ['student', 'academic', 'researcher', 'professional', 'entrepreneur', 'activist', 'organization', 'public_official', 'other']);
  assert.deepEqual(Object.keys(TEXTS.en.lists.sources).sort(), ['direct', 'email', 'facebook', 'instagram', 'linkedin', 'other', 'qr', 'search', 'sistemaurbano', 'whatsapp', 'x']);
  assert.equal(Object.keys(TEXTS.en.lists.pages).length, 14);
  assert.deepEqual(Object.keys(TEXTS.es.lists.kinds), ['profile', 'network', 'opportunities', 'festival', 'courses', 'membership']);
  for (const lang of ['es', 'en', 'pt']) for (const list of ['pages', 'sources', 'kinds', 'profileTypes']) {
    assert.deepEqual(Object.keys(TEXTS[lang].lists[list]), Object.keys(TEXTS.en.lists[list]), `${lang} ${list}`);
  }
  for (const i of INDICATORS.filter(i => i.vocabulary)) assert.ok(TEXTS.es.lists[i.vocabulary], i.key);
});

test('the seven course totals carry the teaching workspace\'s own labels', () => {
  const pilot = readFileSync(new URL('../web/scripts/pilot-i18n.js', import.meta.url), 'utf8');
  for (const [key, row] of [['enrolled', 'participants'], ['intakeCompleted', 'intakeCompleted'], ['moduleOpens', 'moduleOpens'], ['contentOpens', 'contentOpens'], ['recordingOpens', 'recordingOpens'], ['assignments', 'assignments'], ['comments', 'comments']]) {
    const [en, es, pt] = JSON.parse(pilot.match(new RegExp(`\\b${row}:(\\[[^\\]]*\\])`))[1].replaceAll("'", '"'));
    assert.deepEqual(['en', 'es', 'pt'].map(l => TEXTS[l].indicators[`courses.${key}`].name), [en, es, pt], key);
  }
});

test('no indicator key is an interface dictionary key', () => {
  const dictionaries = ['i18n.js', 'i18n-dashboard.js'].map(f => readFileSync(new URL(`../web/scripts/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const { key } of INDICATORS) assert.ok(!dictionaries.includes(`'${key}'`), key);
});
