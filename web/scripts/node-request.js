/* The landing page's request window for organisations (specs: docs/superpowers/specs/2026-11-03-organisation-node-
   requests-design.md and, for the kind question and the sponsor fields, 2026-11-09-sponsored-memberships-design.md).
   "Contáctanos" on the third membership card opens #nodeRequest as a modal with no kind chosen; arriving at /#nodos or
   /#patrocinio (the links the team shares), or the address changing to one of them, opens it with that kind chosen.
   Closing it gives the focus back to the card and drops the hash from the address. Without <dialog> (or without this
   script) the button stays a plain #nodos link and the footer's two addresses are the way in. The form's first question
   is the kind: a Nodo request, or sponsoring memberships, which shows two more fields (community, how many) and
   relabels the message as the topic. The form posts once to /api/node-requests, with the page's language, and thanks in
   place. Labels are the page's data-i18n copy; the lines this script writes (sending, errors) are the rows below,
   re-rendered when the language changes. Nothing the visitor typed or the server answered is put on the page: the error
   line is chosen by the answer's status and a known field, and the team's addresses are constants. */
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const opener = byId('nodeRequestOpen'), dialog = byId('nodeRequest'), form = byId('nodeRequestForm');
  if (!opener || !dialog || !form || typeof dialog.showModal !== 'function') return;
  const error = byId('nodeRequestError'), send = byId('nodeRequestSend'), thanks = byId('nodeRequestThanks');
  const done = byId('nodeRequestDone'), trap = byId('nodeRequestWebsite');
  // The kind question: the fieldset, its two radios, the sponsor-only fields and the message's two labels.
  const kindGroup = byId('nodeRequestKind'), sponsor = byId('nodeRequestSponsor');
  const RADIOS = new Map([['node', byId('nodeRequestKindNode')], ['sponsorship', byId('nodeRequestKindSponsor')]]);
  const messageLabel = byId('nodeRequestMessageLabel'), topicLabel = byId('nodeRequestTopicLabel');
  // The server's field names, in the form's order; a 400 names one of them. The sponsor fields are sent only on a sponsorship.
  const FIELDS = new Map([['name', byId('nodeRequestName')], ['organization', byId('nodeRequestOrganization')], ['email', byId('nodeRequestEmail')], ['phone', byId('nodeRequestPhone')],
    ['community', byId('nodeRequestCommunity')], ['memberships', byId('nodeRequestMemberships')], ['message', byId('nodeRequestMessage')]]);
  const SPONSOR_FIELDS = ['community', 'memberships'];
  // The addresses that open the window with a kind chosen.
  const HASHES = new Map([['#nodos', 'node'], ['#patrocinio', 'sponsorship']]);
  // The two addresses of the site footer, for when the window cannot send.
  const TEAM = ['fmuro@sistemaurbano.org', 'malegre@sistemaurbano.org'];
  // A request still unanswered after this long is given up, as if the API were unreachable (the server's own mail
  // timeout is 8 s a send, so a stored request answers well before).
  const TIMEOUT_MS = 25000;

  const LANGS = ['en', 'es', 'pt'];
  // [en, es, pt]
  const ROWS = {
    sending: ['Sending…', 'Enviando…', 'Enviando…'],
    kind: ['Choose whether you want to activate a Node or sponsor memberships.', 'Elige si quieren activar un Nodo o patrocinar membresías.', 'Escolha se querem ativar um Nó ou patrocinar membresias.'],
    name: ['Write your full name, up to 120 characters.', 'Escribe tu nombre y apellido, hasta 120 caracteres.', 'Escreva seu nome e sobrenome, até 120 caracteres.'],
    organization: ['Write the name of your organization, up to 160 characters.', 'Escribe el nombre de tu organización, hasta 160 caracteres.', 'Escreva o nome da sua organização, até 160 caracteres.'],
    email: ['Write a valid email address.', 'Escribe un correo electrónico válido.', 'Escreva um e-mail válido.'],
    phone: ['The phone number can only have digits, spaces and + ( ) -, up to 40 characters.', 'El teléfono solo puede tener números, espacios y + ( ) -, hasta 40 caracteres.', 'O telefone só pode ter números, espaços e + ( ) -, até 40 caracteres.'],
    community: ['Write the community you would like to support, up to 200 characters.', 'Escribe la comunidad que quieren apoyar, hasta 200 caracteres.', 'Escreva a comunidade que querem apoiar, até 200 caracteres.'],
    memberships: ['Choose roughly how many memberships.', 'Elige cuántas membresías, aproximadamente.', 'Escolha quantas membresias, aproximadamente.'],
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
  let shown = null; // null, 'kind', a FIELDS key, 'tooMany', 'unreachable' or 'unavailable'
  let unseen = false; // a thank-you that came while the window was closed

  // The kind chosen, or null; choosing shows or hides the sponsor fields and swaps the message's label.
  const chosen = () => [...RADIOS].find(([, radio]) => radio.checked)?.[0] ?? null;
  function choose(kind) {
    for (const [name, radio] of RADIOS) radio.checked = name === kind;
    showKind();
  }
  function showKind() {
    const sponsorship = chosen() === 'sponsorship';
    if (sponsor) sponsor.hidden = !sponsorship;
    if (messageLabel) messageLabel.hidden = sponsorship;
    if (topicLabel) topicLabel.hidden = !sponsorship;
  }
  for (const radio of RADIOS.values()) radio?.addEventListener('change', showKind);
  // A browser may restore a checked radio before this script runs (Firefox does on a soft reload, and a page shown
  // again from the back-forward cache keeps it): the sponsor fields follow the radio, not the markup's `hidden`.
  showKind();
  window.addEventListener?.('pageshow', showKind);

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
  // The control a problem is about: the kind group for 'kind', else the field; marked as invalid and described by the line.
  const control = (key) => (key === 'kind' ? kindGroup : FIELDS.get(key));
  function clearMarks() {
    for (const node of [kindGroup, ...FIELDS.values()]) { node?.removeAttribute('aria-invalid'); node?.removeAttribute('aria-describedby'); }
  }
  function mark(key) {
    const node = control(key);
    if (!node) return;
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-describedby', error.id);
    if (dialog.open) (key === 'kind' ? RADIOS.get('node') : node).focus();
  }

  function openWindow(kind) {
    // A request already thanked for: opened again, it is a new form, unless the visitor closed the window while it
    // was sending and has not seen the thanks yet.
    if (!thanks.hidden && !unseen) { thanks.hidden = true; form.hidden = false; }
    // A link's kind wins over an unsent one; the card chooses nothing, so an unsent choice stays.
    if (kind) choose(kind);
    if (!dialog.open) dialog.showModal();
    if (unseen) { unseen = false; done.focus(); return; }
    // The first question still open, or the first field once it is answered.
    (chosen() ? FIELDS.get('name') : RADIOS.get('node')).focus();
  }
  opener.setAttribute('aria-haspopup', 'dialog');
  opener.addEventListener('click', (event) => { event.preventDefault(); openWindow(); });
  // Every way out (×, Escape, the thank-you's button) ends in the dialog's close event.
  dialog.addEventListener('close', () => {
    opener.focus();
    if (!HASHES.has(window.location.hash)) return;
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
    return field === 'kind' || FIELDS.has(field) ? field : 'unavailable';
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const kind = chosen();
    clearMarks();
    // The first question unanswered: nothing is sent (the server would take a missing kind as a Nodo request).
    if (!kind) { shown = 'kind'; render(); mark('kind'); return; }
    busy = true;
    send.disabled = true;
    shown = null;
    render();
    const fields = [...FIELDS].filter(([field]) => kind === 'sponsorship' || !SPONSOR_FIELDS.includes(field));
    const body = { kind, ...Object.fromEntries(fields.map(([field, input]) => [field, input.value])), language: lang(), website: trap ? trap.value : '' };
    let response = null, timer;
    const controller = new AbortController();
    // Raced as well as aborted, so the limit holds even for a fetch that ignores its signal.
    const expired = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, TIMEOUT_MS); });
    try {
      response = await Promise.race([fetch('/api/node-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: controller.signal }), expired]);
    } catch { /* offline or aborted: the error line gives the team's addresses */ }
    clearTimeout(timer);
    const result = response?.status === 202 ? 'thanked' : await outcome(response);
    busy = false;
    send.disabled = false;
    if (result === 'thanked') {
      form.reset();
      showKind();
      render();
      form.hidden = true;
      thanks.hidden = false;
      // The close button is described by the thanks, so focusing it reads both; closed meanwhile, it waits for the next opening.
      if (dialog.open) done.focus();
      else unseen = true;
      return;
    }
    shown = result;
    render();
    mark(result);
  });

  window.nodalI18n?.onChange(render);
  // The links the team shares, on arrival and when the address changes while the page is open.
  const fromHash = () => { const kind = HASHES.get(window.location.hash); if (kind) openWindow(kind); };
  window.addEventListener?.('hashchange', fromHash);
  fromHash();
})();
