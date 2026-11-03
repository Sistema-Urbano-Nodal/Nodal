/* The landing page's request window for organisations (spec: docs/superpowers/specs/2026-11-03-organisation-node-
   requests-design.md). "Contáctanos" on the third membership card opens #nodeRequest as a modal, and so does arriving at
   /#nodos, the link the team shares; closing it gives the focus back to the card and drops #nodos from the address.
   Without <dialog> (or without this script) the button stays a plain #nodos link and the footer's two addresses are
   the way in. The form posts once to /api/node-requests, with the page's language, and thanks in place. Labels are
   the page's data-i18n copy; the lines this script writes (sending, errors) are the rows below, re-rendered when the
   language changes. Nothing the visitor typed or the server answered is put on the page: the error line is chosen by
   the answer's status and a known field, and the team's addresses are constants. */
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const opener = byId('nodeRequestOpen'), dialog = byId('nodeRequest'), form = byId('nodeRequestForm');
  if (!opener || !dialog || !form || typeof dialog.showModal !== 'function') return;
  const error = byId('nodeRequestError'), send = byId('nodeRequestSend'), thanks = byId('nodeRequestThanks');
  const done = byId('nodeRequestDone'), trap = byId('nodeRequestWebsite');
  // The server's field names, in the form's order; a 400 names one of them.
  const FIELDS = new Map([['name', byId('nodeRequestName')], ['organization', byId('nodeRequestOrganization')], ['email', byId('nodeRequestEmail')], ['phone', byId('nodeRequestPhone')], ['message', byId('nodeRequestMessage')]]);
  // The two addresses of the site footer, for when the window cannot send.
  const TEAM = ['fmuro@sistemaurbano.org', 'malegre@sistemaurbano.org'];

  const LANGS = ['en', 'es', 'pt'];
  // [en, es, pt]
  const ROWS = {
    sending: ['Sending…', 'Enviando…', 'Enviando…'],
    name: ['Write your full name, up to 120 characters.', 'Escribe tu nombre y apellido, hasta 120 caracteres.', 'Escreva seu nome e sobrenome, até 120 caracteres.'],
    organization: ['Write the name of your organization, up to 160 characters.', 'Escribe el nombre de tu organización, hasta 160 caracteres.', 'Escreva o nome da sua organização, até 160 caracteres.'],
    email: ['Write a valid email address.', 'Escribe un correo electrónico válido.', 'Escreva um e-mail válido.'],
    phone: ['The phone number can only have digits, spaces and + ( ) -, up to 40 characters.', 'El teléfono solo puede tener números, espacios y + ( ) -, hasta 40 caracteres.', 'O telefone só pode ter números, espaços e + ( ) -, até 40 caracteres.'],
    message: ['Tell us what you are interested in, in up to 1000 characters.', 'Cuéntanos qué te interesa, en hasta 1000 caracteres.', 'Conte o que te interessa, em até 1000 caracteres.'],
    tooMany: ['Too many attempts. Try again later, or write to us at', 'Demasiados intentos. Intenta de nuevo más tarde o escríbenos a', 'Muitas tentativas. Tente novamente mais tarde ou escreva para'],
    unreachable: ['We could not send your message from here. Write to us at', 'No pudimos enviar tu mensaje desde aquí. Escríbenos a', 'Não conseguimos enviar sua mensagem daqui. Escreva para'],
    unavailable: ['The service is not available right now. Try again in a few minutes.', 'El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.', 'O serviço não está disponível no momento. Tente novamente em alguns minutos.'],
    or: ['or', 'o', 'ou'],
  };
  // The page shows its English markup until i18n.js has a language.
  const lang = () => (LANGS.includes(window.nodalI18n?.lang) ? window.nodalI18n.lang : 'en');
  const say = (key) => ROWS[key][LANGS.indexOf(lang())];
  const sendLabel = send.textContent;

  let busy = false;
  let shown = null; // null, a FIELDS key, 'tooMany', 'unreachable' or 'unavailable'

  function mailto(address) {
    const link = document.createElement('a');
    link.href = `mailto:${address}`;
    link.textContent = address;
    return link;
  }
  function render() {
    send.textContent = busy ? say('sending') : (window.nodalI18n?.t('mem.org.send') ?? sendLabel);
    error.hidden = !shown;
    if (!shown) error.replaceChildren();
    else if (shown === 'tooMany' || shown === 'unreachable') error.replaceChildren(`${say(shown)} `, mailto(TEAM[0]), ` ${say('or')} `, mailto(TEAM[1]), '.');
    else error.textContent = say(shown);
  }

  function openWindow() {
    // A request already thanked for: opened again, it is a new form.
    if (!thanks.hidden) { thanks.hidden = true; form.hidden = false; }
    if (!dialog.open) dialog.showModal();
    FIELDS.get('name').focus();
  }
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.addEventListener('click', (event) => { event.preventDefault(); openWindow(); });
  // Every way out (×, Escape, the thank-you's button) ends in the dialog's close event.
  dialog.addEventListener('close', () => {
    opener.focus();
    if (window.location.hash !== '#nodos') return;
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`); } catch { /* the window is closed either way */ }
  });
  byId('nodeRequestClose').addEventListener('click', () => dialog.close());
  done.addEventListener('click', () => dialog.close());

  // 404 or 405: no API behind this host (a static preview), so the request never reached the team.
  const outcome = async (response) => {
    if (!response || response.status === 404 || response.status === 405) return 'unreachable';
    if (response.status === 429) return 'tooMany';
    if (response.status !== 400) return 'unavailable';
    let field = null;
    try { field = (await response.json())?.field; } catch { /* not the API's answer */ }
    return FIELDS.has(field) ? field : 'unavailable';
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    send.disabled = true;
    shown = null;
    for (const input of FIELDS.values()) input.removeAttribute('aria-invalid');
    render();
    const body = { ...Object.fromEntries([...FIELDS].map(([field, input]) => [field, input.value])), language: lang(), website: trap ? trap.value : '' };
    let response = null;
    try {
      response = await fetch('/api/node-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    } catch { /* offline: the error line gives the team's addresses */ }
    const result = response?.status === 202 ? 'thanked' : await outcome(response);
    busy = false;
    send.disabled = false;
    if (result === 'thanked') {
      form.reset();
      render();
      form.hidden = true;
      thanks.hidden = false;
      if (dialog.open) done.focus();
      return;
    }
    shown = result;
    render();
    const input = FIELDS.get(result);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    if (dialog.open) input.focus();
  });

  window.nodalI18n?.onChange(render);
  if (window.location.hash === '#nodos') openWindow();
})();
