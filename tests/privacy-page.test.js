import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import vm from 'node:vm';
import {renderPrivacyPage} from '../scripts/build-privacy-page.js';
import {createApp} from '../server/server.js';
import {createDatabase} from '../server/db.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('published policy matches reviewed source files with complete, linked translations and explicit draft status', async () => {
  const html = read('web/pages/privacy.html');
  assert.equal(html, await renderPrivacyPage(), 'regenerate the page after editing a policy');
  assert.doesNotMatch(html, /\{\{|\}\}|undefined/);
  const articles = [...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(articles.length, 3);
  for (const [ , lang, body] of articles) {
    assert.equal((body.match(/<section /g) || []).length, 12);
    assert.match(body, /class="policy-draft"/);
    for (let n = 1; n <= 12; n++) {
      assert.ok(body.includes(`id="${lang}-${n}"`));
      assert.ok(body.includes(`href="#${lang}-${n}"`));
    }
    assert.match(body, /href="index.html#contact"/);
  }
});

test('privacy page and all its resources are accessible without an account, including in the CDN build', async t => {
  const db = createDatabase({filename:':memory:'});
  const server = createApp({db});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/privacy.html', {redirect:'manual'});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const html = await response.text();
  assert.match(html, /<h1>Privacy policy<\/h1>/);
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|woff2|webp)(?:\?[^"#]*)?)"/g)].map(match => match[1]);
  for (const asset of assets) assert.equal((await fetch(base + '/' + asset)).status, 200, asset);
  const deployment = JSON.parse(read('vercel.json'));
  const policyHeaders = deployment.headers.find(route => new RegExp(`^${route.source}$`).test('/privacy.html'));
  assert.ok(policyHeaders.headers.some(({key,value}) => key === 'Content-Security-Policy' && value.includes("frame-ancestors 'none'")));
  assert.ok(policyHeaders.headers.some(({key,value}) => key === 'Cache-Control' && value.includes('public')));
});

function browser({saved='pt', cookie='', url='https://nodal.test/privacy.html#en-10', blocked=false, navigator}={}) {
  const storage = new Map(saved ? [['nodal.lang',saved]] : []);
  const events = new Map();
  const html = {lang:'en',dataset:{}};
  const buttons = ['en','es','pt'].map(lang => ({dataset:{lang}, attributes:{}, setAttribute(key,value){this.attributes[key]=value;}, addEventListener(name,fn){this[name]=fn;}}));
  const titles = {en:'Privacy policy',es:'Política de privacidad',pt:'Política de privacidade'};
  const scrolls = [];
  const document = {
    documentElement:html, cookie, readyState:'loading',
    addEventListener(){},
    querySelectorAll(selector){return selector==='[data-lang]' ? buttons : [];},
    querySelector(selector){
      if(selector==='[data-policy-label="language"]')return {setAttribute(){}};
      return {dataset:{title:titles[selector.match(/"(en|es|pt)"/)[1]]}};
    },
    getElementById(id){return {scrollIntoView(){scrolls.push(id);}};},
  };
  const window = {
    location:new URL(url),
    history:{state:null,replaceState(state,title,next){window.location=new URL(next,window.location);}},
    addEventListener(name,fn){events.set(name,[...(events.get(name)||[]),fn]);},
  };
  const context = vm.createContext({document,window,URL,URLSearchParams,localStorage:{
    getItem(key){if(blocked)throw Error('blocked'); return storage.get(key);},
    setItem(key,value){if(blocked)throw Error('blocked');storage.set(key,value);},
  },...(navigator ? {navigator} : {})});
  vm.runInContext(read('web/scripts/locale.js'),context);
  const bootLanguage = html.lang;
  document.readyState='interactive';
  vm.runInContext(read('web/scripts/privacy.js'),context);
  return {document,window,html,storage,bootLanguage,scrolls,click:lang=>buttons.find(b=>b.dataset.lang===lang).click(),buttons,
    restore:()=>events.get('pageshow').forEach(fn=>fn({persisted:true}))};
}

test('saved language wins on arrival, switches persist, and deep links retain their policy section', () => {
  const h = browser({url:'https://nodal.test/privacy.html?lang=es#en-10'});
  assert.equal(h.bootLanguage, 'pt');
  assert.equal(h.html.lang, 'pt');
  assert.equal(h.document.title, 'NODAL · Política de privacidade');
  assert.equal(h.window.location.hash, '#pt-10');
  assert.equal(h.html.dataset.localePending, undefined);
  h.click('es');
  assert.equal(h.storage.get('nodal.lang'),'es');
  assert.match(h.document.cookie,/nodal.lang=es/);
  assert.equal(h.window.location.search,'?lang=es');
  assert.equal(h.window.location.hash,'#es-10');
  assert.equal(h.scrolls.at(-1),'es-10');
  assert.equal(h.buttons.find(b=>b.dataset.lang==='es').attributes['aria-pressed'],'true');
  const reload = browser({saved:h.storage.get('nodal.lang'),url:h.window.location.href});
  assert.equal(reload.document.title,'NODAL · Política de privacidad');
  h.storage.set('nodal.lang','en'); h.restore();
  assert.equal(h.html.lang,'en');
  assert.equal(h.document.title,'NODAL · Privacy policy');
  assert.equal(h.window.location.hash,'#en-10');
});

test('cookie language works when browser storage is blocked and first visits can choose a language through the URL', () => {
  const h = browser({saved:null,blocked:true,cookie:'nodal.lang=es'});
  assert.equal(h.html.lang,'es');
  h.click('pt');
  const reload = browser({saved:null,blocked:true,cookie:h.document.cookie});
  assert.equal(reload.html.lang,'pt');
  const first = browser({saved:null,url:'https://nodal.test/privacy.html?lang=pt'});
  assert.equal(first.bootLanguage,'pt');
});

test('a first visit reads the policy in the browser language without saving it, and a click saves the choice', () => {
  const h = browser({saved:null,navigator:{languages:['es-PE','es']}});
  assert.equal(h.html.lang,'es');
  assert.equal(h.document.title,'NODAL · Política de privacidad');
  assert.equal(h.window.location.hash,'#es-10');
  assert.equal(h.storage.size,0);
  assert.equal(h.document.cookie,'');
  h.restore();
  assert.equal(h.storage.size,0);
  assert.equal(h.document.cookie,'');
  h.click('en');
  assert.equal(h.storage.get('nodal.lang'),'en');
  assert.equal(h.storage.get('nodal.lang.chosen'),'1');
  assert.equal(h.document.title,'NODAL · Privacy policy');
});

test('festival conversations are described in every language: their data row after the festival, who sees them and what account deletion does', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  for (const [lang, festival, row, audience, deletion] of [
    ['en', 'FIIU festival', 'FIIU conversations', 'People registered for the FIIU festival', 'In FIIU conversations'],
    ['es', 'Festival FIIU', 'Conversaciones del FIIU', 'Personas inscritas en el festival FIIU', 'En las conversaciones del FIIU'],
    ['pt', 'Festival FIIU', 'Conversas do FIIU', 'Pessoas inscritas no festival FIIU', 'Nas conversas do FIIU'],
  ]) {
    assert.equal((articles[lang].match(/<section /g) || []).length, 12, lang);
    const rowOf = category => table.indexOf(`<tr role="row"><td role="cell">${category}</td>`);
    const table = section(lang, 2), before = rowOf(festival), at = rowOf(row);
    assert.ok(before > -1 && at > before, `${lang}: the conversations row follows the festival row`);
    assert.equal(table.slice(before, at).match(/<tr[\s>]/g).length, 1, `${lang}: directly after it`);
    assert.ok(section(lang, 4).includes(`<strong>${audience}:</strong>`), `${lang}: section 4 names who sees the messages`);
    assert.ok(section(lang, 9).includes(deletion), `${lang}: section 9 says what account deletion does to them`);
  }
  // The row promises only what the chat page does: authors keep and can delete their hidden messages, and after cancelling (the page then needs a
  // registration, which may be closed) the way to remove them is deleting the account, not registering again.
  for (const [lang, hidden, own, cancel, never] of [
    ['en', 'it then stays visible only to you and to administrators', 'You can delete your own messages, including hidden ones', 'after canceling, the way to remove them is deleting your account', 'registering again'],
    ['es', 'desde entonces solo lo ven tú y los administradores', 'Puedes eliminar tus propios mensajes, también los ocultos', 'Después de cancelar, la forma de borrarlos es eliminar tu cuenta', 'volver a inscribirte'],
    ['pt', 'a partir daí, só você e os administradores a veem', 'Você pode excluir suas próprias mensagens, inclusive as ocultas', 'Depois de cancelar, a forma de removê-las é excluir sua conta', 'se inscrever de novo'],
  ]) {
    const table = section(lang, 2);
    for (const phrase of [hidden, own, cancel]) assert.ok(table.includes(phrase), `${lang}: ${phrase}`);
    assert.ok(!table.includes(never), `${lang}: no promise the page cannot keep`);
  }
});

test('rating answers and one-off festival notices are described in every language', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const table = lang => articles[lang].match(new RegExp(`<section id="${lang}-2">([\\s\\S]*?)</section>`))[1];
  for (const [lang, ratings, notices] of [
    ['en', 'Rating answers are stored with your account so you can change them, and are only ever shown as anonymous totals.', 'We record one-off festival notices sent to you, so nobody receives the same one twice.'],
    ['es', 'Las valoraciones se guardan con tu cuenta para que puedas cambiarlas, y solo se muestran como totales anónimos.', 'Registramos los avisos puntuales del festival que te enviamos, para que nadie reciba el mismo dos veces.'],
    ['pt', 'As avaliações são guardadas com a sua conta para que você possa alterá-las, e só aparecem como totais anônimos.', 'Registramos os avisos pontuais do festival enviados a você, para que ninguém receba o mesmo duas vezes.'],
  ]) {
    assert.ok(table(lang).includes(ratings), `${lang}: ratings`);
    assert.ok(table(lang).includes(notices), `${lang}: notices`);
  }
});

test('Mercado Pago is named, in every language, as the processor of the Founder Membership payments', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const providers = lang => articles[lang].match(new RegExp(`<section id="${lang}-7">([\\s\\S]*?)</section>`))[1];
  for (const [lang, sentence] of [
    ['en', 'Mercado Pago processes the Founder Membership payments: you pay on its page and give your payment details to Mercado Pago, never to NODAL.'],
    ['es', 'Mercado Pago procesa los pagos de la Membresía Fundador: pagas en su página y entregas tus datos de pago a Mercado Pago, nunca a NODAL.'],
    ['pt', 'O Mercado Pago processa os pagamentos da Membresia Fundador: você paga na página dele e entrega seus dados de pagamento ao Mercado Pago, nunca à NODAL.'],
  ]) assert.ok(providers(lang).includes(sentence), lang);
  // In Portuguese too it is a membership (membresia), the terms' word, never a subscription.
  assert.doesNotMatch(providers('pt'), /assinatura/i);
});

/* Before paying for the Founder Membership a member accepts its terms, and NODAL keeps that record as contract evidence
   (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md): deleting the account removes only its link to the account. */
test('the Founder Membership acceptance record is described in every language: what is kept and why, who sees it, how long, and that it outlives account deletion', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  for (const [lang, category, kept, why, deletion, seen, retention] of [
    ['en', 'Founder Membership',
      'your name, your account email, the option you chose and its amount, the terms version, the three authorizations you ticked (the terms, the payment and automatic renewal) and the date and time',
      'as evidence of the contract you accepted before paying',
      'The record of your Founder Membership acceptance is kept after you delete your account, as evidence of the contract you accepted, with your name and email but without its link to the account.',
      'Only NODAL administrators see it, and they can download it as a list (name, email, option, amount, terms version and date) to match payments to accounts. Your account export includes it.',
      'It is kept for as long as it is needed to evidence the contract and to answer claims about it, and is then deleted.'],
    ['es', 'Membresía Fundador',
      'tu nombre, el correo de tu cuenta, la modalidad elegida y su importe, la versión de los términos, las tres autorizaciones que marcaste (los términos, el pago y la renovación automática) y la fecha y la hora',
      'como prueba del contrato que aceptaste antes de pagar',
      'El registro de tu aceptación de la Membresía Fundador se conserva después de eliminar tu cuenta, como prueba del contrato que aceptaste, con tu nombre y tu correo pero sin su vínculo con la cuenta.',
      'Solo las personas administradoras de NODAL lo ven, y pueden descargarlo como lista (nombre, correo, modalidad, importe, versión de los términos y fecha) para vincular los pagos con las cuentas. La exportación de tu cuenta lo incluye.',
      'Se conserva mientras sea necesario para acreditar el contrato y atender reclamos sobre él, y luego se elimina.'],
    ['pt', 'Membresia Fundador',
      'seu nome, o e-mail da sua conta, a modalidade escolhida e o valor, a versão dos termos, as três autorizações que você marcou (os termos, o pagamento e a renovação automática) e a data e a hora',
      'como prova do contrato que você aceitou antes de pagar',
      'O registro da sua aceitação da Membresia Fundador é mantido depois que você exclui sua conta, como prova do contrato que você aceitou, com seu nome e e-mail, mas sem o vínculo com a conta.',
      'Somente administradores da NODAL o veem, e podem baixá-lo como lista (nome, e-mail, modalidade, valor, versão dos termos e data) para vincular os pagamentos às contas. A exportação da conta o inclui.',
      'Ele é mantido enquanto for necessário para comprovar o contrato e responder a reclamações sobre ele, e depois é excluído.'],
  ]) {
    const row = section(lang, 2).match(new RegExp(`<tr role="row"><td role="cell">${category}</td><td role="cell">([^<]*)</td></tr>`))?.[1];
    assert.ok(row, `${lang}: a data row for the acceptance record`);
    assert.ok(row.includes(kept), `${lang}: what is kept`);
    assert.ok(row.includes(why), `${lang}: why`);
    assert.ok(section(lang, 9).includes(deletion), `${lang}: section 9 says it outlives account deletion`);
    assert.ok(row.includes(seen), `${lang}: who sees it, the list and the export`);
    assert.ok(row.includes(retention) && section(lang, 9).includes(retention), `${lang}: how long, in the row and in section 9`);
  }
});

// The Founder badge an administrator gives each Membresía Fundador payer is shown to other people, so the policy says where.
test('the Founder badge is described in every language: who gives it, where it shows, the export, and how it goes', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  for (const [lang, category, given, shown, posts, directory] of [
    ['en', 'Founder badge', 'an administrator gives your account the Founder badge, and we store the date it was given',
      'on your course posts, older ones included', 'If you hold the Founder badge, it shows next to your name on your posts, whether or not you appear in the directory.', 'professional links and the Founder badge'],
    ['es', 'Badge Founder', 'una persona administradora da a tu cuenta el badge Founder, y guardamos la fecha en que se dio',
      'en tus publicaciones de los cursos, incluidas las anteriores', 'Si tienes el badge Founder, aparece junto a tu nombre en tus publicaciones, aparezcas o no en el directorio.', 'enlaces profesionales y el badge Founder'],
    ['pt', 'Badge Founder', 'um administrador dá à sua conta o badge Founder, e guardamos a data em que ele foi dado',
      'nas suas publicações nos cursos, inclusive as anteriores', 'Se você tem o badge Founder, ele aparece junto ao seu nome nas suas publicações, apareça você ou não no diretório.', 'links profissionais e o badge Founder'],
  ]) {
    const row = section(lang, 2).match(new RegExp(`<tr role="row"><td role="cell">${category}</td><td role="cell">([^<]*)</td></tr>`))?.[1];
    assert.ok(row, `${lang}: a data row for the badge`);
    assert.ok(row.includes(given) && row.includes(shown), `${lang}: who gives it and where it shows`);
    assert.ok(section(lang, 4).includes(posts), `${lang}: course participants see it on posts`);
    assert.ok(section(lang, 4).includes(directory), `${lang}: directory members see it on the profile`);
  }
});

// Organisation node requests are stored without an account and emailed to two inboxes, so the policy says who sees them and what deletion really covers.
test('the policy describes organisation node requests in all three languages', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  const escape = text => text.replace(/'/g, '&#39;');
  for (const [lang, category, fields, noAccount, inboxes, onRequest, closed, notExport, retention, schedule, audience] of [
    ['en', 'Organisation requests', 'the name, organisation, email, phone (optional) and message you write', 'no account is needed',
      'fmuro@sistemaurbano.org and malegre@sistemaurbano.org, through the outgoing email account NODAL uses, so copies also sit in those two inboxes and in the Sent folder of that account',
      'You can ask us to delete your request, and the team deletes it and the email copies by hand.', 'Closed requests are deleted automatically 12 months after their last change',
      'Requests are not part of any account export or account deletion.',
      "Organisation requests are deleted automatically 12 months after they are closed, counted from their last change; requests never closed stay until an administrator closes or deletes them, and an administrator can delete one at any time. The emails sent to the team, and their copies in the sending account's Sent folder, are not deleted automatically: the team deletes them by hand when you ask.",
      'feedback, Founder Membership acceptances, organisation requests, unaccepted invitations,',
      '<strong>Organisations that write to us:</strong> the request you send through the landing page form is seen by two NODAL team members, by the administrators in the organiser desk and by the email service that delivers it, as described in section 2. It is not shown to other members.'],
    ['es', 'Solicitudes de organizaciones', 'el nombre, la organización, el correo, el teléfono (opcional) y el mensaje que escribes', 'no hace falta una cuenta',
      'fmuro@sistemaurbano.org y malegre@sistemaurbano.org, desde la cuenta de correo saliente de NODAL, de modo que también quedan copias en esas dos bandejas y en la carpeta de enviados de esa cuenta',
      'Puedes pedirnos que eliminemos tu solicitud, y el equipo la elimina junto con las copias de los correos, a mano.', 'Las solicitudes cerradas se eliminan automáticamente 12 meses después de su último cambio',
      'Las solicitudes no forman parte de la exportación de ninguna cuenta ni de su eliminación.',
      'Las solicitudes de organizaciones se eliminan automáticamente 12 meses después de cerrarse, contados desde su último cambio; las que nunca se cierran permanecen hasta que una persona administradora las cierra o las elimina, y una persona administradora puede eliminar una en cualquier momento. Los correos enviados al equipo, y sus copias en la carpeta de enviados de la cuenta que los envía, no se eliminan automáticamente: el equipo los elimina a mano cuando lo pides.',
      'feedback, aceptaciones de la Membresía Fundador, solicitudes de organizaciones, invitaciones no aceptadas,',
      '<strong>Organizaciones que nos escriben:</strong> la solicitud que envías con el formulario de la página de inicio la ven dos personas del equipo de NODAL, las personas administradoras en el panel de organización y el servicio de correo que la entrega, como se describe en la sección 2. No se muestra a otras personas de la red.'],
    ['pt', 'Solicitações de organizações', 'o nome, a organização, o e-mail, o telefone (opcional) e a mensagem que você escreve', 'não é preciso ter conta',
      'fmuro@sistemaurbano.org e malegre@sistemaurbano.org, pela conta de e-mail de saída da NODAL, de modo que também ficam cópias nessas duas caixas de entrada e na pasta de enviados dessa conta',
      'Você pode pedir que excluamos a sua solicitação, e a equipe a exclui junto com as cópias dos e-mails, manualmente.', 'As solicitações encerradas são excluídas automaticamente 12 meses depois da última alteração',
      'As solicitações não fazem parte da exportação de nenhuma conta nem da sua exclusão.',
      'As solicitações de organizações são excluídas automaticamente 12 meses depois de encerradas, contados a partir da última alteração; as que nunca são encerradas permanecem até que um administrador as encerre ou exclua, e um administrador pode excluir uma a qualquer momento. Os e-mails enviados à equipe, e as cópias deles na pasta de enviados da conta que os envia, não são excluídos automaticamente: a equipe os exclui manualmente quando você pede.',
      'feedback, aceitações da Membresia Fundador, solicitações de organizações, convites não aceitos,',
      '<strong>Organizações que nos escrevem:</strong> a solicitação que você envia pelo formulário da página inicial é vista por duas pessoas da equipe da NODAL, pelos administradores no painel de organização e pelo serviço de e-mail que a entrega, como descrito na seção 2. Ela não é exibida a outros membros.'],
  ]) {
    const row = section(lang, 2).match(new RegExp(`<tr role="row"><td role="cell">${category}</td><td role="cell">([^<]*)</td></tr>`))?.[1];
    assert.ok(row, `${lang}: a data row for node requests`);
    for (const [what, text] of [['fields', fields], ['no account', noAccount], ['the two inboxes and the Sent folder', inboxes], ['deletion on request', onRequest], ['12-month deletion of closed requests', closed], ['not in the export', notExport]]) assert.ok(row.includes(text), `${lang}: ${what}`);
    assert.ok(section(lang, 9).includes(`<p>${escape(retention)}</p>`), `${lang}: section 9 gives node requests their own paragraph, Sent-folder copies included`);
    assert.ok(section(lang, 9).includes(escape(schedule)), `${lang}: section 9's schedule names node requests`);
    assert.ok(!section(lang, 9).match(/<p>[^<]*(?:When you delete your account|Al eliminar tu cuenta|Ao excluir sua conta)[^<]*<\/p>/)[0].match(/Nod[oe]|Nó/), `${lang}: not inside the account-deletion paragraph`);
    assert.ok(section(lang, 4).includes(`<li>${audience}</li>`), `${lang}: section 4 names who sees the requests`);
  }
});

// Sponsorship requests share the row (spec: docs/superpowers/specs/2026-11-09-sponsored-memberships-design.md, "Privacy").
test('the policy describes sponsorship requests in all three languages: the purpose, the two extra fields, and that nothing is collected about the community', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  for (const [lang, category, old, purpose, community, number, nobody, kind] of [
    ['en', 'Organisation requests', 'Organisation node requests', 'talk about a NODAL node or about sponsoring memberships', 'the community you want to support', 'the approximate number of memberships', 'we collect no data about the people in that community', 'whether the request is about a node or about sponsorship'],
    ['es', 'Solicitudes de organizaciones', 'Solicitudes de Nodo de organizaciones', 'conversar sobre un nodo de NODAL o sobre patrocinar membresías', 'la comunidad que quieren apoyar', 'el número aproximado de membresías', 'no recogemos ningún dato de las personas de esa comunidad', 'si la solicitud es sobre un Nodo o sobre patrocinio'],
    ['pt', 'Solicitações de organizações', 'Solicitações de Nó de organizações', 'conversar sobre um Nó da NODAL ou sobre patrocinar membresias', 'a comunidade que querem apoiar', 'o número aproximado de membresias', 'não coletamos nenhum dado das pessoas dessa comunidade', 'se a solicitação é sobre um Nó ou sobre patrocínio'],
  ]) {
    const section2 = articles[lang].match(new RegExp(`<section id="${lang}-2">([\\s\\S]*?)</section>`))[1];
    const row = section2.match(new RegExp(`<tr role="row"><td role="cell">${category}</td><td role="cell">([^<]*)</td></tr>`))?.[1];
    assert.ok(row, `${lang}: the organisation requests row`);
    assert.ok(!articles[lang].includes(old), `${lang}: the row is no longer only about Nodo requests`);
    for (const [what, text] of [['purpose', purpose], ['community', community], ['number', number], ['nobody', nobody], ['kind', kind]]) assert.ok(row.includes(text), `${lang}: ${what}`);
    assert.doesNotMatch(row, /S\/\s?\d|precio|price|preço/, `${lang}: no price in the policy row`);
  }
  // The source documents say the same (the first test pins the page to them), and the review and architecture notes follow.
  for (const file of ['docs/privacy/privacy-policy.en.md', 'docs/privacy/privacy-policy.es.md', 'docs/privacy/privacy-policy.pt-BR.md']) assert.doesNotMatch(read(file), /Solicitudes de Nodo de organizaciones|Organisation node requests|Solicitações de Nó de organizações/, file);
  assert.match(read('docs/privacy/implementation-review.md'), /`node_requests`[^\n]*`kind`[^\n]*community[^\n]*memberships[^\n]*20261109000000_node_request_kinds\.sql/);
  assert.match(read('docs/architecture.md'), /sponsor/i);
});

test('Sentry is named, in every language, as the recipient of technical server error reports, and what it never receives', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const providers = lang => articles[lang].match(new RegExp(`<section id="${lang}-7">([\\s\\S]*?)</section>`))[1];
  for (const [lang, receives, never] of [
    ['en', 'When error tracking is on, Sentry receives technical reports about server errors', 'It never receives passwords, cookies, form contents or IP addresses.'],
    ['es', 'Cuando el seguimiento de errores está activo, Sentry recibe informes técnicos sobre errores del servidor', 'Nunca recibe contraseñas, cookies, contenidos de formularios ni direcciones IP.'],
    ['pt', 'Quando o rastreamento de erros está ativo, o Sentry recebe relatórios técnicos sobre erros do servidor', 'Ele nunca recebe senhas, cookies, conteúdos de formulários nem endereços IP.'],
  ]) { assert.ok(providers(lang).includes(receives), lang); assert.ok(providers(lang).includes(never), lang + ' never'); }
});

// The stylesheet's rules, with the media query each sits in ('' at the top level).
function cssRules(css) {
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i); if (open === -1) break;
      const head = text.slice(i, open).trim();
      if (head.startsWith('@media')) {
        let depth = 1, j = open + 1;
        for (; depth && j < text.length; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
        walk(text.slice(open + 1, j - 1), head); i = j;
      } else {
        const close = text.indexOf('}', open);
        rules.push({media, selectors: head.split(',').map(s => s.trim()), body: text.slice(open + 1, close)}); i = close + 1;
      }
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  return rules;
}
const declarations = (rules, selector, media) => rules.filter(rule => rule.selectors.includes(selector) && media(rule.media)).map(rule => rule.body).join(';');

test('on phones the data table reflows at body size, and the policy links and buttons are full touch targets', () => {
  const css = read('web/styles/privacy.css'), rules = cssRules(css);
  const phone = media => /max-width:\s*600px/.test(media);
  // Each row stacks: the category over its explanation, full width, instead of a 99px column of 13px text broken mid-word.
  for (const element of ['table', 'tbody', 'tr', 'td']) assert.match(declarations(rules, element, phone), /display:\s*block/, element);
  assert.match(declarations(rules, 'thead', phone), /position:\s*absolute/, 'the header row stays for screen readers only');
  assert.doesNotMatch(declarations(rules, 'thead', phone), /display:\s*none/);
  const cells = declarations(rules, 'td', phone) + ';' + declarations(rules, 'td:first-child', phone);
  assert.doesNotMatch(cells, /font-size:\s*1[0-4]px|overflow-wrap:\s*anywhere/, 'no shrunken text or broken words');
  assert.match(declarations(rules, 'td:first-child', phone), /width:\s*auto/);
  // Phone-sized or touch: every target is at least 44px.
  const touch = media => phone(media) || /pointer:\s*coarse/.test(media);
  for (const selector of ['.policy-contents a', '.policy-languages button', '.policy-home', '.policy-footer a', '.policy-top']) {
    assert.match(declarations(rules, selector, touch), /min-height:\s*44px/, selector);
  }
  assert.match(declarations(rules, '.policy-contents a', touch), /display:\s*(?:block|flex)/);
  assert.match(declarations(rules, '.policy-languages button', touch), /min-width:\s*44px/);
  assert.doesNotMatch(declarations(rules, '.policy-home', phone), /font-size:\s*1[0-2]px/);
  assert.doesNotMatch(css, /border-left/, 'no left accent bars');
});

/* On phones the stacked rows use display:block, which can strip a table's semantics (Safari and VoiceOver), and the
   visually hidden header row then names no cell. Explicit roles keep the table, its rows, headers and cells. */
test('the data table keeps explicit table roles, so its stacked phone layout is still read as a table', async () => {
  const html = read('web/pages/privacy.html');
  const count = pattern => (html.match(pattern) || []).length;
  const tables = count(/<table[\s>]/g);
  assert.ok(tables >= 3, 'one table per language at least');
  assert.equal(count(/<table role="table">/g), tables);
  assert.equal(count(/<thead role="rowgroup">/g), tables);
  assert.equal(count(/<tbody role="rowgroup">/g), tables);
  assert.equal(count(/<tr role="row">/g), count(/<tr[\s>]/g));
  assert.equal(count(/<th role="columnheader" scope="col">/g), count(/<th[\s>]/g));
  assert.equal(count(/<td role="cell">/g), count(/<td[\s>]/g));
});

// R1 visit counter: the policy says what is stored, what is not, the staff marker and how long totals are kept.
test('visit counting is described in every language: what is stored, what is not, the staff marker and how long totals are kept', () => {
  const html = read('web/pages/privacy.html');
  const articles = Object.fromEntries([...html.matchAll(/<article data-policy-lang="(en|es|pt)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, lang, body]) => [lang, body]));
  const section = (lang, n) => articles[lang].match(new RegExp(`<section id="${lang}-${n}">([\\s\\S]*?)</section>`))[1];
  const escape = text => text.replace(/'/g, '&#39;');
  for (const [lang, category, cell, technical, usage, marker, list, retention] of [
    ['en', 'Visit counts',
      'When a NODAL page opens, a small script from NODAL itself tells our server which page was opened and the name of the site you came from, which our server reduces at once to a kind of source (a search engine, a social network, a link the team shared, or directly) and does not store. We add one to that day\'s total for the page and for that kind of source. We store only these daily totals: no cookie, no IP address, no visitor or account identifier. They count page openings and arrivals, not people, cannot be linked to you, and so are not part of an account export or deletion. Password-reset, invitation and staff pages are not counted.',
      'Our server uses the IP address of a request briefly to limit abuse and does not save it with visit counts.',
      'Visit counts are part of that usage analysis.',
      'Visit counting uses no cookie. On browsers used to open NODAL\'s staff pages, a marker is saved in browser storage so the team\'s own visits are not counted; it has no expiry, stays in that browser and is removed when the sign-in page is opened there.',
      'usage events, daily visit totals, logs',
      'Daily visit totals contain no personal data and are kept without a time limit.'],
    ['es', 'Conteo de visitas',
      'Cuando se abre una página de NODAL, un pequeño script de la propia NODAL le indica a nuestro servidor qué página se abrió y el nombre del sitio desde el que llegaste, que nuestro servidor reduce de inmediato a un tipo de origen (un buscador, una red social, un enlace compartido por el equipo o directamente) y no guarda. Sumamos uno al total de ese día para la página y para ese tipo de origen. Guardamos solo esos totales diarios: sin cookie, sin dirección IP, sin identificador de visitante ni de cuenta. Cuentan aperturas de página y llegadas, no personas, no pueden vincularse contigo y por eso no forman parte de la exportación ni de la eliminación de una cuenta. Las páginas de restablecimiento de contraseña, de invitación y del equipo no se cuentan.',
      'Nuestro servidor usa brevemente la dirección IP de una solicitud para limitar abusos y no la guarda con los conteos de visitas.',
      'Los conteos de visitas forman parte de ese análisis de uso.',
      'El conteo de visitas no usa cookies. En los navegadores con los que se abren las páginas del equipo de NODAL se guarda una marca en el almacenamiento del navegador para que las visitas del propio equipo no se cuenten; no tiene vencimiento, permanece en ese navegador y se elimina cuando se abre allí la página de inicio de sesión.',
      'eventos de uso, totales diarios de visitas, registros técnicos',
      'Los totales diarios de visitas no contienen datos personales y se conservan sin límite de tiempo.'],
    ['pt', 'Contagem de visitas',
      'Quando uma página da NODAL é aberta, um pequeno script da própria NODAL informa ao nosso servidor qual página foi aberta e o nome do site de onde você veio, que o nosso servidor reduz imediatamente a um tipo de origem (um buscador, uma rede social, um link compartilhado pela equipe ou diretamente) e não guarda. Somamos um ao total daquele dia para a página e para esse tipo de origem. Guardamos apenas esses totais diários: sem cookie, sem endereço IP, sem identificador de visitante ou de conta. Eles contam aberturas de página e chegadas, não pessoas, não podem ser vinculados a você e, por isso, não fazem parte da exportação nem da exclusão de uma conta. As páginas de redefinição de senha, de convite e da equipe não são contadas.',
      'Nosso servidor usa brevemente o endereço IP de uma requisição para limitar abusos e não o guarda com as contagens de visitas.',
      'As contagens de visitas fazem parte dessa análise de uso.',
      'A contagem de visitas não usa cookies. Nos navegadores usados para abrir as páginas da equipe da NODAL, uma marca é salva no armazenamento do navegador para que as visitas da própria equipe não sejam contadas; ela não expira, fica nesse navegador e é removida quando a página de login é aberta nele.',
      'eventos de uso, totais diários de visitas, logs',
      'Os totais diários de visitas não contêm dados pessoais e são mantidos sem limite de tempo.'],
  ]) {
    assert.ok(section(lang, 2).includes(`<td role="cell">${category}</td><td role="cell">${escape(cell)}</td>`), `${lang}: section 2 has the visit counts row`);
    assert.ok(section(lang, 2).includes(escape(technical)), `${lang}: the technical information row says the IP is not saved with counts`);
    assert.ok(section(lang, 3).includes(escape(usage)), `${lang}: section 3 names visit counts as usage analysis`);
    assert.ok(section(lang, 8).includes(escape(marker)), `${lang}: section 8 says no cookie and describes the staff marker`);
    assert.ok(section(lang, 9).includes(escape(list)), `${lang}: section 9 lists daily visit totals`);
    assert.ok(section(lang, 9).includes(`<p>${escape(retention)}</p>`), `${lang}: section 9 gives totals their own paragraph`);
  }
  assert.ok(!/saved daily totals|reports of totals/.test(articles.en), 'no readings or reports of totals yet');
});
