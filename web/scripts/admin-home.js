/* The staff overview renders the server's indicator catalogue in EN, ES and PT.
   Language and family changes reuse the current response. Charts use a common
   scale within each series, and older readings retain their original definitions. */
(() => {
  const el = {
    title: document.getElementById('homeTitle'),
    reports: document.getElementById('homeReports'),
    reportsLabel: document.getElementById('homeReportsLabel'),
    periodTitle: document.getElementById('homePeriodTitle'),
    partial: document.getElementById('homePartial'),
    asOf: document.getElementById('homeAsOf'),
    windows: document.getElementById('homeWindows'),
    refresh: document.getElementById('homeRefresh'),
    status: document.getElementById('homeStatus'),
    retry: document.getElementById('homeRetry'),
    signIn: document.getElementById('homeSignIn'),
    csvLabel: document.getElementById('homeCsvLabel'),
    csv: document.getElementById('homeCsv'),
    monthsCsv: document.getElementById('homeMonthsCsv'),
    readingsCsv: document.getElementById('homeReadingsCsv'),
    compare: document.getElementById('homeCompare'),
    print: document.getElementById('homePrint'),
    top: document.getElementById('homeTop'),
    route: document.getElementById('homeRoute'),
    lead: document.getElementById('homeLead'),
    pending: document.getElementById('homePending'),
    blocks: document.getElementById('homeBlocks'),
    tracking: document.getElementById('homeTracking'),
    printHead: document.getElementById('homePrintHead'),
  };
  if (!el.blocks || !el.tracking || !el.route || !el.lead || !el.top || !el.pending) return;

  const LANGS = ['en', 'es', 'pt'];
  const CHROME = {
    title: ['Network overview', 'Resumen de la red', 'Visão geral da rede'],
    exploreFamily: ['Explore {family}', 'Explorar {family}', 'Explorar {family}'],
    export: ['Export report', 'Exportar reporte', 'Exportar relatório'],
    periods: ['Reporting periods', 'Períodos del reporte', 'Períodos do relatório'],
    partial: ['Incomplete data for {parts}.', 'Datos incompletos de {parts}.', 'Dados incompletos de {parts}.'],
    skip: ['Skip to content', 'Saltar al contenido', 'Pular para o conteúdo'],
    loading: ['Loading…', 'Cargando…', 'Carregando…'],
    csvLabel: ['Download CSV:', 'Descargar CSV:', 'Baixar CSV:'],
    csvIndicators: ['Indicators', 'Indicadores', 'Indicadores'],
    monthsCsv: ['By month', 'Por mes', 'Por mês'],
    readingsCsv: ['Readings', 'Lecturas', 'Leituras'],
    csvIndicatorsFull: ['Download indicators (CSV)', 'Descargar indicadores (CSV)', 'Baixar indicadores (CSV)'],
    csvMonthsFull: ['Download figures by month (CSV)', 'Descargar cifras por mes (CSV)', 'Baixar números por mês (CSV)'],
    csvReadingsFull: ['Download saved readings (CSV)', 'Descargar lecturas guardadas (CSV)', 'Baixar leituras salvas (CSV)'],
    compare: ['Compare months', 'Comparar meses', 'Comparar meses'],
    print: ['Print or save as PDF', 'Imprimir o guardar como PDF', 'Imprimir ou salvar como PDF'],
    asOf: ['Data as of {when} (Lima time)', 'Datos al {when} (hora de Lima)', 'Dados de {when} (hora de Lima)'],
    refresh: ['Refresh', 'Actualizar', 'Atualizar'],
    last7: ['Last 7 days', 'Últimos 7 días', 'Últimos 7 dias'],
    last30: ['Last 30 days', 'Últimos 30 días', 'Últimos 30 dias'],
    in30: ['in 30 days', 'en 30 días', 'em 30 dias'],
    in7: ['in 7 days', 'en 7 días', 'em 7 dias'],
    kindsNoneWeek: ['0 in 7 days for every kind', '0 en 7 días en todos los tipos', '0 em 7 dias em todos os tipos'],
    noNew: ['{n} days without new accounts (last: {day})', '{n} días sin cuentas nuevas (última: {day})', '{n} dias sem contas novas (última: {day})'],
    noNewOne: ['{n} day without new accounts (last: {day})', '{n} día sin cuentas nuevas (última: {day})', '{n} dia sem contas novas (última: {day})'],
    route: ['Member participation', 'Participación de los miembros', 'Participação dos membros'],
    routeNote: [
      'Each bar counts members at that stage. The groups can overlap.',
      'Cada barra cuenta a los miembros de esa etapa. Los grupos pueden superponerse.',
      'Cada barra conta os membros daquela etapa. Uma pessoa pode estar em mais de um grupo.',
    ],
    pending: ['Needs attention', 'Por atender', 'Para atender'],
    nothingPending: ['Nothing waiting', 'Nada por atender', 'Nada para atender'],
    team: ['includes {n} from the team', 'incluye {n} del equipo', 'inclui {n} da equipe'],
    of: ['{a} of {b}', '{a} de {b}', '{a} de {b}'],
    oneCourse: ['One course: {name}', 'Un curso: {name}', 'Um curso: {name}'],
    perMonth: ['{name} by month', '{name}, por mes', '{name}, por mês'],
    inMonth: ['in {month}', 'en {month}', 'em {month}'],
    explore: ['Indicators', 'Indicadores', 'Indicadores'],
    howCounted: ['How it is counted', 'Cómo se cuenta', 'Como se conta'],
    hideHow: ['Hide', 'Ocultar', 'Ocultar'],
    source: ['Source', 'Fuente', 'Fonte'],
    limits: ['Limits', 'Límites', 'Limites'],
    tracking: ['Monthly readings', 'Lecturas mensuales', 'Leituras mensais'],
    trackingIntro: ['Each month\'s latest saved reading, to compare months.', 'La última lectura guardada de cada mes, para comparar los meses.', 'A última leitura salva de cada mês, para comparar os meses.'],
    monthsTable: ['Months table', 'Tabla por mes', 'Tabela por mês'],
    seeReading: ['See the {month} reading', 'Ver la lectura de {month}', 'Ver a leitura de {month}'],
    indicator: ['Indicator', 'Indicador', 'Indicador'],
    readOn: ['read on day {day}', 'leído el {day}', 'lido no dia {day}'],
    olderDefs: ['read with earlier definitions', 'leído con definiciones anteriores', 'lido com definições anteriores'],
    notReadThen: ['—: not read that month', '—: no se leía ese mes', '—: não era lido nesse mês'],
    readingsSince: ['Readings since {month}.', 'Lecturas desde {month}.', 'Leituras desde {month}.'],
    noReadings: ['No reading has been saved yet.', 'Aún no hay lecturas guardadas.', 'Ainda não há leituras salvas.'],
    notSaved: [
      'Today\'s reading has not been saved yet. Missing: {part}. It will be saved when this page is opened with all the data.',
      'La lectura de hoy aún no se guardó. Falta: {part}. Se guardará al abrir esta página con todos los datos.',
      'A leitura de hoje ainda não foi salva. Falta: {part}. Será salva ao abrir esta página com todos os dados.',
    ],
    failed: ['The metrics could not be loaded.', 'No se pudieron cargar los indicadores.', 'Não foi possível carregar os indicadores.'],
    retry: ['Try again', 'Reintentar', 'Tentar de novo'],
    expired: ['Your session ended. Sign in again.', 'Tu sesión terminó. Inicia sesión de nuevo.', 'Sua sessão terminou. Entre de novo.'],
    signIn: ['Sign in', 'Iniciar sesión', 'Entrar'],
    denied: ['Your account no longer has admin access.', 'Tu cuenta ya no tiene acceso de administración.', 'Sua conta não tem mais acesso de administração.'],
    tooMany: ['Too many requests. Wait a minute and try again.', 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.', 'Muitas solicitações. Espere um minuto e tente de novo.'],
    notHere: ['Metrics are not available in this installation.', 'Los indicadores no están disponibles en esta instalación.', 'Os indicadores não estão disponíveis nesta instalação.'],
    printHead: ['NODAL · Metrics report', 'NODAL · Reporte de indicadores', 'NODAL · Relatório de indicadores'],
    seeFestival: ['See in Festival', 'Ver en Festival', 'Ver em Festival'],
    seeCourses: ['See in Courses', 'Ver en Cursos', 'Ver em Cursos'],
  };
  // Where a block or a queue is worked on.
  const SEE = { festival: ['fiiu-admin.html', 'seeFestival'], courses: ['teaching.html', 'seeCourses'] };
  const PENDING = [['interests', 'activity.interests', 'admin.html#interests'], ['orgRequests', 'memberships.orgRequests', 'admin.html#nodes'], ['lab', 'festival.labApplications', 'fiiu-admin.html#pending-lab']];
  // The lists that count the last 30 days: their name says so.
  const D30_LISTS = new Set(['activity.kinds', 'visits.topPages', 'visits.sources', 'memberships.views']);
  const FIELDS = ['total', 'd30', 'd7'];
  const IN = { d30: 'in30', d7: 'in7' };
  const WINDOWED = /^(.+)\.(d30|d7)$/;
  const SVG = 'http://www.w3.org/2000/svg';

  const lang = () => (LANGS.includes(document.documentElement.lang) ? document.documentElement.lang : 'en');
  const say = (row, vars = {}) => CHROME[row][LANGS.indexOf(lang())].replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  // A chrome row as text and nodes: a {name} given a node is put in as that node (a bold figure inside a sentence).
  function sayNodes(row, vars) {
    const text = CHROME[row][LANGS.indexOf(lang())];
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(/\{(\w+)\}/g)) {
      parts.push(text.slice(last, match.index));
      const value = vars[match[1]];
      parts.push(value === undefined ? match[0] : (typeof value === 'object' ? value : String(value)));
      last = match.index + match[0].length;
    }
    parts.push(text.slice(last));
    return parts.filter((part) => part !== '');
  }
  const own = (object, key) => object != null && Object.hasOwn(object, key);
  const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  const hide = (node) => { node.setAttribute('aria-hidden', 'true'); return node; };

  // Lima dates: a day is read at noon UTC, which is 07:00 in Lima the same day.
  const noon = (day) => Date.parse(`${day}T12:00:00Z`);
  const dates = (options) => new Intl.DateTimeFormat(lang(), { timeZone: 'America/Lima', ...options });
  const fullDay = (day) => dates({ day: 'numeric', month: 'short', year: 'numeric' }).format(noon(day));
  const shortDay = (day) => dates({ day: 'numeric', month: 'short' }).format(noon(day));
  const monthYear = (month) => dates({ month: 'short', year: 'numeric' }).format(noon(`${month}-15`));
  const monthShort = (month) => dates({ month: 'short' }).format(noon(`${month}-15`));
  const yearOf = (month) => dates({ year: 'numeric' }).format(noon(`${month}-15`));
  function range({ from, to }) {
    const format = dates({ day: 'numeric', month: 'short' });
    if (from.slice(0, 7) === to.slice(0, 7) && typeof format.formatRange === 'function') return format.formatRange(noon(from), noon(to));
    return `${shortDay(from)}–${shortDay(to)}`;
  }
  const number = (n) => new Intl.NumberFormat(lang()).format(n);

  let answer = null;
  let statusRow = 'loading';
  let loading = false;
  let readingSentFor = null;
  let confirmedReading = null;
  let accessGeneration = 0;
  // The status the page had before a download failed (null: no download has failed since); a download that works puts it back.
  let beforeDownload = null;
  // The families whose definitions are open, kept across a re-render; each family's section with its switch.
  const openFamilies = new Set();
  let switches = [];
  let selectedFamily = null;
  let readingOpen = false;
  let openBeforePrint = null;

  const words = () => answer.texts[lang()] ?? answer.texts.en;
  const indicators = () => new Map(answer.families.flatMap((family) => family.indicators).map((ind) => [ind.key, ind]));
  const nameOf = (key) => words().indicators[key]?.name ?? key;
  const familyName = (key) => words().families[key] ?? key;
  // A figure's name with its window in words: "Llegadas en 30 días"; a total carries no window.
  const withField = (key, field) => (field === 'total' ? nameOf(key) : `${nameOf(key)} ${say(IN[field])}`);
  // Visit figures while the counter is younger than the window they are printed under.
  const visitFamily = (key) => answer.families.some((family) => family.key === 'visits' && family.indicators.some((ind) => ind.key === key));
  const youngCounter = (field) => typeof answer.visitsSince === 'string' && own(answer.windows, field) && answer.visitsSince > answer.windows[field].from;
  /* The catalogue's lists the page is laid out by, as the answer brings them (server/metrics-catalog.js). route: the
     members' path, one stop per [key, field] in order, 'apart' marking a stop that is not one more step after the one
     before it (the segment into it is dotted). seriesIndicator: the indicator each month series splits by month (its
     chart stands in that indicator's family; a series of one month is said on its row). pairs: [part, whole], two totals
     printed as one row "9 de 17". An answer without one is laid out without it: no path (the lead figures stand in a
     row), every month series in Seguimiento, each figure on its own row. */
  const routeStops = () => (Array.isArray(answer.route) ? answer.route.filter(Array.isArray) : []);
  const seriesIndicator = () => (answer.seriesIndicator && typeof answer.seriesIndicator === 'object' && !Array.isArray(answer.seriesIndicator) ? answer.seriesIndicator : {});
  const ofPairs = () => (Array.isArray(answer.pairs) ? answer.pairs.filter(Array.isArray) : []);

  // The words for a state; visits not yet counted name their first day, or say none is counted yet.
  function reason(state) {
    const states = words().states;
    if (state === 'not_yet_counted') return answer.visitsSince ? states.not_yet_counted.replace('{day}', fullDay(answer.visitsSince)) : states.no_visits_yet;
    return own(states, state) ? states[state] : states.unavailable;
  }

  // A figure: a zero prints as 0 in muted ink; anything that is not a number prints as a dash.
  function figure(value, extra) {
    const node = isNum(value) ? make('span', value === 0 ? 'home-num is-zero' : 'home-num', number(value)) : make('span', 'home-num home-dash', '—');
    if (extra) node.classList.add(extra);
    return node;
  }
  // "58 en 30 días": a window figure said in words, next to the figure it belongs to.
  function windowed(value, field) {
    const span = make('span', 'home-win');
    span.append(figure(value), ` ${say(IN[field])}`);
    return span;
  }

  function trackedName(key) {
    const windowedKey = WINDOWED.exec(key);
    return own(words().indicators, key) || !windowedKey ? nameOf(key) : withField(windowedKey[1], windowedKey[2]);
  }

  // The days since the latest new account, when there has been none today: "23 días sin cuentas nuevas (última: 24 oct)",
  // the count of days set as a figure so it reads at a glance.
  function noNewLine(className) {
    const latest = answer.families.flatMap((family) => family.indicators).find((ind) => isNum(ind.daysSince));
    if (!latest || latest.state || !(latest.daysSince > 0) || !latest.last) return null;
    const line = make('span', className);
    line.append(...sayNodes(latest.daysSince === 1 ? 'noNewOne' : 'noNew', { n: figure(latest.daysSince), day: shortDay(latest.last) }));
    return line;
  }

  function paintStatus() {
    el.status.textContent = statusRow ? say(statusRow) : '';
  }

  function paintChrome() {
    const title = say('title');
    el.title.textContent = title;
    document.title = `${title} · NODAL`;
    const skip = document.querySelector('.admin-skip');
    if (skip) skip.textContent = say('skip');
    for (const [node, row] of [[el.reportsLabel, 'export'], [el.periodTitle, 'periods'], [el.csvLabel, 'csvLabel'], [el.csv, 'csvIndicators'], [el.monthsCsv, 'monthsCsv'], [el.readingsCsv, 'readingsCsv'], [el.compare, 'compare'], [el.print, 'print'], [el.refresh, 'refresh'], [el.retry, 'retry'], [el.printHead, 'printHead'], [el.signIn, 'signIn']]) {
      if (node) node.textContent = say(row);
    }
    // Each download says in full what it downloads, for a screen reader that reaches it on its own.
    for (const [node, row] of [[el.csv, 'csvIndicatorsFull'], [el.monthsCsv, 'csvMonthsFull'], [el.readingsCsv, 'csvReadingsFull']]) node?.setAttribute('aria-label', say(row));
    paintStatus();
  }

  function closeReports(restoreFocus) {
    if (!el.reports.open) return;
    el.reports.open = false;
    if (restoreFocus) el.reportsLabel.focus();
  }
  document.addEventListener('click', (event) => {
    if (!el.reports.contains(event.target)) closeReports(false);
    else if (event.target.closest('button')) closeReports(true);
  });
  el.reports.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !el.reports.open) return;
    event.preventDefault();
    closeReports(true);
  });
  el.reports.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !el.reports.contains(event.relatedTarget)) closeReports(false);
  });

  function renderHead() {
    el.asOf.textContent = say('asOf', { when: dates({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.parse(answer.asOf)) });
    const periods = make('dl', 'home-period-list');
    for (const [field, label] of [['d30', 'last30'], ['d7', 'last7']]) {
      const entry = make('div');
      entry.append(make('dt', '', say(label)), make('dd', '', range(answer.windows[field])));
      periods.append(entry);
    }
    const noNew = noNewLine('home-silence');
    el.windows.replaceChildren(periods);
    if (noNew) el.windows.append(noNew);
    const missing = failedParts();
    el.partial.textContent = missing.length ? say('partial', { parts: missing.join(', ') }) : '';
    el.partial.hidden = !missing.length;
  }

  // One lead line: figure, name with its window, and the reason when the figure could not be computed.
  function leadLine(map, key, field, className, family) {
    const ind = map.get(key) ?? { state: 'unavailable' };
    const row = make(family ? 'button' : 'p', `home-fig ${className}`);
    if (family) {
      row.type = 'button';
      row.title = say('exploreFamily', { family: familyName(family.key) });
      row.setAttribute('aria-controls', `home-b-${family.key}`);
      row.addEventListener('click', () => {
        const entry = switches.find(({ section }) => section.dataset.family === family.key);
        if (!entry) return;
        entry.tab.click();
        entry.tab.focus();
        entry.tab.scrollIntoView({ block: 'center' });
      });
    }
    row.dataset.key = key;
    row.append(figure(ind.state ? undefined : ind[field]));
    const body = make('span', 'home-fig-body');
    body.append(make('span', 'home-fig-name', withField(key, field)));
    if (ind.state) body.append(make('span', 'home-fig-more home-reason', reason(ind.state)));
    // A visit figure never stands under a window without the day its count began.
    else if (visitFamily(key) && youngCounter(field)) body.append(make('span', 'home-fig-more home-reason', reason('not_yet_counted')));
    row.append(' ', body);
    return row;
  }

  // A stop's node: a ring drawn in SVG (filled for a window stop by the stylesheet).
  function stopNode() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'home-stop-node');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('cx', '9');
    ring.setAttribute('cy', '9');
    ring.setAttribute('r', '7.5');
    svg.append(ring);
    return svg;
  }

  function renderTop() {
    const map = indicators();
    const lead = Array.isArray(answer.lead) ? answer.lead : [];
    const route = routeStops();
    const valueAt = ([key, field]) => {
      const ind = map.get(key);
      return ind && !ind.state && isNum(ind[field]) ? ind[field] : undefined;
    };
    const scale = route.reduce((largest, stop) => Math.max(largest, valueAt(stop) ?? 0), 0);

    const title = make('h2', 'home-route-title', say('route'));
    title.id = 'homeRouteTitle';
    const stops = make('ol', 'home-stops');
    stops.setAttribute('aria-labelledby', title.id);
    route.forEach(([key, field], i) => {
      const ind = map.get(key) ?? { state: 'unavailable' };
      const value = valueAt([key, field]);
      const stop = make('li', 'home-stop');
      stop.dataset.key = key;
      if (field !== 'total') stop.classList.add('is-window');
      // The segment into a stop that is not one more step (a consent, a window) is dotted.
      const next = route[i + 1];
      if (next && next[2] === 'apart') stop.classList.add('to-apart');
      const column = make('span', 'home-stop-fig');
      const bar = hide(make('span', 'home-stop-bar'));
      if (isNum(value) && scale > 0) bar.style.setProperty('--f', (value / scale).toFixed(4));
      column.append(figure(value, 'home-stop-n'), bar);
      // A stop that could not be computed says why where its column would stand.
      if (ind.state) column.append(make('span', 'home-stop-why home-reason', reason(ind.state)));
      stop.append(column, stopNode(), make('span', 'home-stop-name', withField(key, field)));
      stops.append(stop);
    });
    // The caption says what the path is not; the dotted segments are said in the answer's own words (they change with
    // its route), after a sample of the line. Without those words there is no key.
    const note = make('p', 'home-route-note', say('routeNote'));
    const apart = typeof words().routeApart === 'string' ? words().routeApart.trim() : '';
    if (apart && route.some((stop, i) => i > 0 && stop[2] === 'apart')) {
      // The sample and the sentence's first word never part at a line end.
      const cut = apart.indexOf(' ');
      const lead = make('span', 'home-key-lead');
      lead.append(hide(make('span', 'home-key-dash')), cut < 0 ? apart : apart.slice(0, cut));
      const key = make('span', 'home-route-key');
      key.append(lead);
      if (cut >= 0) key.append(apart.slice(cut));
      note.append(' ', key);
    }
    el.route.replaceChildren(title, stops, note);
    // Older catalogues can omit the path.
    el.route.hidden = route.length === 0;
    el.top.classList.toggle('no-route', route.length === 0);

    const headlines = lead.map(({ key, field, second }) => {
      const group = make('div', 'home-lead-item');
      group.dataset.key = key;
      const family = answer.families.find((group) => group.indicators.includes(map.get(key)));
      group.append(leadLine(map, key, field, 'home-lead-main', family));
      for (const [k, f] of Array.isArray(second) ? second : []) group.append(leadLine(map, k, f, 'home-lead-second'));
      return group;
    });
    el.lead.replaceChildren(...headlines);
    el.lead.hidden = !headlines.length;
    renderPending();
    el.top.hidden = false;
  }

  // The queues waiting on the team: one line each, the figure first, the name a link to where it is worked on. A queue
  // with something in it is said in alert ink; an empty one stays a quiet link. A queue whose part is not activated is
  // not drawn; one that could not be read is a dash with its reason, and then nothing claims that none waits.
  function renderPending() {
    const pending = answer.pending ?? {};
    const map = indicators();
    const queues = PENDING.filter(([, key]) => map.get(key)?.state !== 'not_activated');
    const known = queues.filter(([field]) => isNum(pending[field]));
    const waiting = known.some(([field]) => pending[field] > 0);
    el.top.classList.toggle('is-waiting', waiting);
    if (!queues.length) { el.pending.replaceChildren(); el.pending.hidden = true; return; }
    const title = make('h2', 'home-pending-title', say(waiting || known.length < queues.length ? 'pending' : 'nothingPending'));
    title.id = 'homePendingTitle';
    const list = make('ul', 'home-figs home-queues');
    list.setAttribute('aria-labelledby', title.id);
    for (const [field, key, href] of queues) {
      const count = pending[field];
      const item = make('li', isNum(count) && count > 0 ? 'is-waiting' : '');
      const link = make('a', 'home-fig home-queue');
      link.href = href;
      const body = make('span', 'home-fig-body');
      body.append(make('span', 'home-fig-name', nameOf(key)));
      if (!isNum(count)) body.append(' ', make('span', 'home-reason', reason(map.get(key)?.state || 'unavailable')));
      link.append(figure(count), body);
      item.append(link);
      list.append(item);
    }
    el.pending.replaceChildren(title, list);
    el.pending.hidden = false;
  }

  /* ---------- the families ---------- */

  function itemLabel(ind, item) {
    const lists = words().lists;
    if (own(item, 'text')) return String(item.text);
    if (own(lists.reserved, item.key)) return lists.reserved[item.key];
    if (ind.vocabulary && own(lists[ind.vocabulary], item.key)) return lists[ind.vocabulary][item.key];
    if (own(answer.courseNames, item.key)) return answer.courseNames[item.key];
    return String(item.key);
  }

  // An indicator's definition, source and limits, under its own row: shown while its family is explained, always in print.
  function definition(key, named) {
    const text = words().indicators[key];
    const box = make('div', 'home-def');
    box.dataset.def = key;
    if (!text) return box;
    const first = make('p', 'home-def-text');
    if (named) first.append(make('strong', 'home-def-name', `${text.name}. `));
    first.append(text.definition);
    box.append(first, make('p', 'home-def-meta', `${say('source')}: ${text.source}`), make('p', 'home-def-meta', `${say('limits')}: ${text.caveat}`));
    return box;
  }

  // A figure row: the widest figure the indicator has (total, else 30 days, else 7 days), its name with the window in
  // words, the other windows on a second line, then its definition. Nothing is printed for a window it does not have.
  function figureRow(ind, quiet) {
    const row = make('li', 'home-fig');
    row.dataset.key = ind.key;
    const body = make('div', 'home-fig-body');
    if (ind.state) {
      row.append(figure(undefined));
      body.append(make('span', 'home-fig-name', nameOf(ind.key)));
      if (!quiet) body.append(make('span', 'home-fig-more home-reason', reason(ind.state)));
    } else {
      const main = FIELDS.find((f) => isNum(ind[f]));
      row.append(figure(ind[main]));
      const name = make('span', 'home-fig-name', withField(ind.key, main));
      // The team's own rows inside a figure that is not filtered (the festival's registrations).
      if (isNum(ind.team) && ind.team > 0) name.append(' ', make('span', 'home-reason', `(${say('team', { n: number(ind.team) })})`));
      body.append(name);
      const parts = FIELDS.slice(FIELDS.indexOf(main) + 1).filter((f) => isNum(ind[f])).map((f) => windowed(ind[f], f));
      const series = seriesOf(ind.key);
      if (series && !series.values.state && series.months.length === 1) {
        const [month] = series.months;
        const span = make('span', 'home-win');
        span.append(figure(series.values[month]), ` ${say('inMonth', { month: monthYear(month) })}`);
        parts.push(span);
      }
      if (parts.length) {
        const more = make('span', 'home-fig-more');
        parts.forEach((part, i) => { if (i) more.append(', '); more.append(part); });
        body.append(more);
      }
    }
    body.append(definition(ind.key));
    row.append(body);
    return row;
  }

  // Two figures where one truly contains the other: "9 de 17  Encuesta final: respondieron", both definitions under it.
  function pairRow(part, whole) {
    const row = make('li', 'home-fig home-pair');
    row.dataset.key = part.key;
    row.dataset.of = whole.key;
    const figures = make('span', 'home-of');
    figures.append(...sayNodes('of', { a: figure(part.total), b: figure(whole.total) }).map((bit) => (typeof bit === 'string' ? make('span', 'home-of-word', bit) : bit)));
    const body = make('div', 'home-fig-body');
    body.append(make('span', 'home-fig-name', nameOf(part.key)), definition(part.key, true), definition(whole.key, true));
    row.append(figures, body);
    return row;
  }

  // A list as ranked rows: figure, label, and a thin bar on the list's own scale (its largest item). A list that also
  // counts the last 7 days (activity by kind) says that figure after each label, or once under its title when it is 0
  // for every row.
  function rankList(ind, withDefinition) {
    const wrap = make('div', 'home-list');
    wrap.dataset.list = ind.key;
    const title = make('h4', 'home-sub', D30_LISTS.has(ind.key) ? withField(ind.key, 'd30') : nameOf(ind.key));
    title.id = `home-l-${ind.key.replace(/\W/g, '-')}`;
    wrap.append(title);
    if (withDefinition) wrap.append(definition(ind.key));
    // The Founders and payment page views, outside the Visitas block, carry the counter's first day themselves.
    if (ind.key === 'memberships.views' && youngCounter('d30')) wrap.append(make('p', 'home-note', reason('not_yet_counted')));
    // An empty list is a zero, never a bare name.
    if (!ind.items.length) {
      const none = make('p', 'home-fig');
      none.append(figure(0));
      wrap.append(none);
      return wrap;
    }
    // A week with nothing in any row is one muted line, not "0 en 7 días" repeated on each.
    const quietWeek = ind.items.every((item) => item.d7 === 0);
    if (quietWeek) wrap.append(make('p', 'home-note home-none-week', say('kindsNoneWeek')));
    const max = ind.items.reduce((most, item) => Math.max(most, isNum(item.n) ? item.n : 0), 0);
    const list = make('ol', 'home-rank');
    list.setAttribute('aria-labelledby', title.id);
    for (const item of ind.items) {
      const row = make('li');
      const bar = hide(make('span', 'home-rank-bar'));
      if (max > 0 && isNum(item.n)) bar.style.setProperty('--f', (item.n / max).toFixed(4));
      const label = make('span', 'home-rank-label', itemLabel(ind, item));
      if (isNum(item.d7) && !quietWeek) {
        const more = make('span', 'home-rank-more');
        more.append(windowed(item.d7, 'd7'));
        label.append(', ', more);
      }
      row.append(figure(item.n), label, bar);
      list.append(row);
    }
    wrap.append(list);
    return wrap;
  }

  const monthKeys = (values) => Object.keys(values).filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();

  // The month series that splits an indicator by month, in the page language.
  function seriesOf(key) {
    const map = seriesIndicator();
    const name = Object.keys(map).find((n) => map[n] === key);
    const series = answer.months?.series ?? {};
    const labels = words().series ?? {};
    if (!name || !own(series, name) || !own(labels, name)) return null;
    const values = series[name] ?? {};
    return { name, label: labels[name], values, months: monthKeys(values) };
  }

  /* The month charts of a family: every series of two months or more whose indicator stands in it. A series that could
     not be read says why where its chart would stand, unless the block already said that reason once. */
  function familyCharts(family, said) {
    return family.indicators.flatMap((ind) => {
      const series = seriesOf(ind.key);
      if (!series) return [];
      const { values, months } = series;
      if (!values.state && months.length > 1) return [chart(series)];
      if (!values.state && months.length === 1) return ind.state ? [chart(series)] : [];
      const why = reason(values.state ?? 'not_yet_counted');
      return said.has(why) ? [] : [missingChart(series, why)];
    });
  }

  /* A chart draws a series' latest twelve months (the CSV keeps them all). No month's column is narrower than its
     widest figure: --mw, that figure's count of characters, reaches the stylesheet beside the count of months. */
  const MAX_MONTHS = 12;
  function drawn({ values, months }) {
    const shown = months.slice(-MAX_MONTHS);
    return {
      shown,
      crosses: shown.length > 1 && shown[0].slice(0, 4) !== shown[shown.length - 1].slice(0, 4),
      widest: shown.reduce((most, month) => Math.max(most, isNum(values[month]) ? number(values[month]).length : 1), 1),
    };
  }

  function chart(series, heading = 'h4') {
    const { name, label, values } = series;
    const { shown: months, crosses, widest } = drawn(series);
    const wrap = make('div', 'home-chart');
    wrap.dataset.series = name;
    const title = make(heading, 'home-sub', say('perMonth', { name: label }));
    title.id = `home-s-${name}`;
    const max = months.reduce((most, month) => Math.max(most, isNum(values[month]) ? values[month] : 0), 0);
    const list = make('ol', 'home-months');
    list.setAttribute('aria-labelledby', title.id);
    list.style.setProperty('--n', String(months.length));
    list.style.setProperty('--mw', String(widest));
    // A series inside one year reads its year from the date at the top; one that crosses a year names each year once.
    if (crosses) list.classList.add('has-years');
    months.forEach((month, i) => {
      const item = make('li', 'home-month');
      const when = make('span', 'home-month-label', monthShort(month));
      if (crosses && (i === 0 || month.endsWith('-01'))) when.append(' ', make('span', 'home-month-year', yearOf(month)));
      const bar = hide(make('span', 'home-month-bar'));
      if (max > 0 && isNum(values[month])) bar.style.setProperty('--f', (values[month] / max).toFixed(4));
      item.append(when, figure(values[month]), bar);
      list.append(item);
    });
    // Wider than its column (a long series on a phone), the months scroll in their own box, opened on the latest.
    const box = make('div', 'home-months-box');
    box.dataset.title = title.id;
    box.append(list);
    wrap.append(title, box);
    return wrap;
  }

  // The charts of a family (or of Seguimiento) side by side: as many in a row as their months and figures leave room for.
  function chartRow(charts, series) {
    const shapes = series.map(drawn);
    const box = make('div', 'home-charts');
    box.style.setProperty('--months', String(shapes.reduce((most, shape) => Math.max(most, shape.shown.length), 1)));
    box.style.setProperty('--mw', String(shapes.reduce((most, shape) => Math.max(most, shape.widest), 1)));
    if (shapes.some((shape) => shape.crosses)) box.classList.add('has-years');
    box.append(...charts);
    return box;
  }

  function missingChart({ name, label }, why, heading = 'h4') {
    const wrap = make('div', 'home-chart is-missing');
    wrap.dataset.series = name;
    const line = make('p', 'home-chart-why');
    line.append(figure(undefined), ' ', make('span', 'home-reason', why));
    wrap.append(make(heading, 'home-sub', say('perMonth', { name: label })), line);
    return wrap;
  }

  // "How it is counted" open or closed for one family: every definition under its own row, and the switch says what it
  // will do. `remember` is false while printing opens them all.
  function explain(section, toggle, open, remember = true) {
    section.classList.toggle('is-explained', open);
    if (remember) {
      if (open) openFamilies.add(section.dataset.family);
      else openFamilies.delete(section.dataset.family);
    }
    toggle.setAttribute('aria-expanded', String(open));
    toggle.replaceChildren(say(open ? 'hideHow' : 'howCounted'), make('span', 'admin-sr', ` (${familyName(section.dataset.family)})`));
  }

  function block(family, tab) {
    const section = make('section', 'home-block');
    section.id = `home-b-${family.key}`;
    section.dataset.family = family.key;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', tab.id);
    section.tabIndex = 0;
    const head = make('div', 'home-block-head');
    const title = make('h3', 'home-block-title', familyName(family.key));
    title.id = `home-h-${family.key}`;
    const toggle = make('button', 'admin-textbutton home-how');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', section.id);
    toggle.addEventListener('click', () => explain(section, toggle, !section.classList.contains('is-explained')));
    head.append(title, toggle);
    if (own(SEE, family.key)) {
      const [href, row] = SEE[family.key];
      const link = make('a', 'home-see', say(row));
      link.href = href;
      head.append(link);
    }
    section.append(head);

    // A part not activated, and visits before their first day, are said once for the block; anything else per row.
    const once = (ind) => ind.state === 'not_activated' || (ind.state === 'not_yet_counted' && family.key === 'visits');
    const notes = new Set(family.indicators.filter(once).map((ind) => reason(ind.state)));
    if (family.key === 'visits' && family.indicators.some((ind) => !ind.state)) notes.add(reason('not_yet_counted'));
    // Course figures add up the courses: with one course, the block names it.
    const courses = new Set(family.indicators.flatMap((ind) => (!ind.state && isNum(ind.total) && Array.isArray(ind.items) ? ind.items.map((item) => item.key) : [])));
    const [course] = courses;
    const oneCourse = courses.size === 1 && own(answer.courseNames, course) ? say('oneCourse', { name: answer.courseNames[course] }) : null;
    for (const note of [...notes, ...(oneCourse ? [oneCourse] : [])]) section.append(make('p', 'home-note', note));

    const byKey = new Map(family.indicators.map((ind) => [ind.key, ind]));
    // A pair the catalogue names as truly nested is one row, when both of its figures are there.
    const pairOf = new Map();
    for (const [part, whole] of ofPairs()) {
      const a = byKey.get(part);
      const b = byKey.get(whole);
      if (a && b && !a.state && !b.state && isNum(a.total) && isNum(b.total)) { pairOf.set(part, [a, b]); pairOf.set(whole, [a, b]); }
    }
    const isList = (ind) => !ind.state && Array.isArray(ind.items) && !FIELDS.some((f) => isNum(ind[f]));
    const rows = [];
    const done = new Set();
    for (const ind of family.indicators) {
      if (done.has(ind.key) || !(ind.state || FIELDS.some((f) => isNum(ind[f])))) continue;
      if (pairOf.has(ind.key)) {
        const [a, b] = pairOf.get(ind.key);
        done.add(a.key).add(b.key);
        rows.push(pairRow(a, b));
        continue;
      }
      rows.push(figureRow(ind, once(ind)));
    }
    if (rows.length) {
      const list = make('ul', 'home-figs');
      list.setAttribute('aria-labelledby', title.id);
      list.append(...rows);
      section.append(list);
    }
    // Lists: a course list only when there is more than one course (one course repeats the total).
    for (const ind of family.indicators) {
      if (ind.state || !Array.isArray(ind.items)) continue;
      if (!isList(ind) && ind.items.length < 2) continue;
      section.append(rankList(ind, isList(ind)));
    }
    const charts = familyCharts(family, notes);
    if (charts.length) section.append(chartRow(charts, family.indicators.map((ind) => seriesOf(ind.key)).filter((series) => series && !series.values.state)));
    switches.push({ section, tab, toggle });
    explain(section, toggle, openFamilies.has(family.key));
    return section;
  }

  function selectFamily(key) {
    selectedFamily = key;
    for (const { section, tab } of switches) {
      const selected = section.dataset.family === key;
      section.hidden = !selected;
      tab.tabIndex = selected ? 0 : -1;
      tab.setAttribute('aria-selected', String(selected));
    }
  }

  function renderBlocks() {
    const keepTabFocus = switches.some(({ tab }) => tab === document.activeElement);
    switches = [];
    if (!answer.families.length) {
      selectedFamily = null;
      el.blocks.replaceChildren();
      return;
    }

    const title = make('h2', 'home-explorer-title', say('explore'));
    title.id = 'homeExplorerTitle';
    const tabs = make('div', 'home-family-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-labelledby', title.id);
    const panels = make('div', 'home-family-panels');
    const families = answer.families;
    families.forEach((family, index) => {
      const tab = make('button', 'home-family-tab', familyName(family.key));
      tab.id = `home-tab-${family.key}`;
      tab.type = 'button';
      tab.dataset.family = family.key;
      tab.setAttribute('role', 'tab');
      const panel = block(family, tab);
      tab.setAttribute('aria-controls', panel.id);
      tab.addEventListener('click', () => {
        if (selectedFamily === family.key) return;
        selectFamily(family.key);
        placeCharts(panel);
      });
      tab.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        let next;
        switch (event.key) {
          case 'ArrowLeft': next = (index + families.length - 1) % families.length; break;
          case 'ArrowRight': next = (index + 1) % families.length; break;
          case 'Home': next = 0; break;
          case 'End': next = families.length - 1; break;
          default: return;
        }
        event.preventDefault();
        switches[next].tab.click();
        switches[next].tab.focus();
      });
      tabs.append(tab);
      panels.append(panel);
    });
    el.blocks.replaceChildren(title, tabs, panels);
    const selected = switches.find(({ tab }) => tab.dataset.family === selectedFamily) ?? switches[0];
    selectFamily(selected.tab.dataset.family);
    if (keepTabFocus) selected.tab.focus();
  }

  // Only visible charts have meaningful dimensions. Size a newly selected panel after revealing it.
  function placeCharts(area) {
    for (const box of area.querySelectorAll('.home-months-box')) placeMonths(box);
  }

  function layout() {
    for (const { section } of switches) if (!section.hidden) placeCharts(section);
    placeCharts(el.tracking);
    placeTable();
  }

  let measuredWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === measuredWidth) return;
      measuredWidth = width;
      requestAnimationFrame(layout);
    }).observe(el.blocks);
  }
  document.fonts?.ready.then(() => { if (answer) layout(); });

  /* A month chart wider than its column scrolls: then it is reachable and named for the keyboard, and opens on its
     latest whole months, with room after the last month (--tail) when the scroll cannot reach that far, as the month
     table does. One that fits is no stop for the keyboard. The chart's name is said once: by the box while it is the
     stop, by its list otherwise. */
  function placeMonths(box) {
    const list = box.querySelector('.home-months');
    box.style.removeProperty('--tail');
    if (box.scrollWidth <= box.clientWidth) {
      for (const name of ['tabindex', 'role', 'aria-labelledby']) box.removeAttribute(name);
      list?.setAttribute('aria-labelledby', box.dataset.title);
      return;
    }
    box.setAttribute('tabindex', '0');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', box.dataset.title);
    list?.removeAttribute('aria-labelledby');
    const months = [...box.querySelectorAll('.home-month')];
    const first = months.find((month) => box.scrollWidth - month.offsetLeft <= box.clientWidth) ?? months[months.length - 1];
    const reach = box.scrollWidth - box.clientWidth;
    const target = first ? first.offsetLeft : reach;
    if (target > reach) box.style.setProperty('--tail', `${Math.ceil(target - reach)}px`);
    box.scrollLeft = target;
  }

  /* ---------- Seguimiento ---------- */

  // Every failed part, in the order of the parts' labels (the server's READING_PARTS), joined with a comma.
  function failedParts() {
    const parts = words().parts;
    const failed = new Set([...answer.unavailable.map((entry) => entry.part), ...answer.notActivated]);
    return Object.keys(parts).filter((part) => failed.has(part)).map((part) => parts[part]);
  }

  // Month series that no indicator on the page takes stay here, so none is lost (all of them when the answer does not
  // say which indicator each one splits); one that could not be read says why, as it would in a family.
  function strayCharts() {
    const keys = new Set(answer.families.flatMap((family) => family.indicators).map((ind) => ind.key));
    const map = seriesIndicator();
    const series = answer.months?.series ?? {};
    const labels = words().series ?? {};
    const strays = Object.keys(series).filter((name) => own(labels, name) && !(own(map, name) && keys.has(map[name]))).map((name) => {
      const values = series[name] ?? {};
      return { name, label: labels[name], values, months: monthKeys(values) };
    });
    if (!strays.length) return [];
    const charts = strays.map((stray) => (stray.values.state || stray.months.length === 0 ? missingChart(stray, reason(stray.values.state ?? 'not_yet_counted'), 'h3') : chart(stray, 'h3')));
    return [chartRow(charts, strays.filter((stray) => !stray.values.state))];
  }

  // A reading's month and the day it was read ("nov 2026, leído el 16"), and a note when older definitions applied.
  function readOnLabel(reading) {
    const head = make('span', 'home-read');
    head.append(make('span', 'home-read-month', monthYear(reading.month)), make('span', 'home-read-on', say('readOn', { day: Number(String(reading.day).slice(8, 10)) })));
    if (isNum(reading.defs) && isNum(answer.defs) && reading.defs < answer.defs) head.append(make('span', 'home-read-on', say('olderDefs')));
    return head;
  }

  // The family a tracked key belongs to ("activity.members.d30" belongs to activity).
  function familyOfTracked(key) {
    const windowedKey = WINDOWED.exec(key);
    const base = windowedKey && !answer.families.some((family) => family.indicators.some((ind) => ind.key === key)) ? windowedKey[1] : key;
    return answer.families.find((family) => family.indicators.some((ind) => ind.key === base))?.key ?? base.split('.')[0];
  }

  /* Two or more readings: the page's one table, a column per month, the tracked rows grouped by family. The names and
     the family labels stay at the left edge while the months scroll under them on a narrow screen. */
  function trackingTable(months, tracked) {
    const headRow = make('tr');
    const corner = make('th', 'home-corner');
    corner.setAttribute('scope', 'col');
    corner.append(make('span', 'admin-sr', say('indicator')));
    headRow.append(corner);
    for (const reading of months) {
      const th = make('th');
      th.setAttribute('scope', 'col');
      th.dataset.month = reading.month;
      th.append(readOnLabel(reading));
      headRow.append(th);
    }
    const thead = make('thead');
    thead.append(headRow);
    const table = make('table', 'home-table home-tracking-table');
    table.append(thead);
    const groups = new Map();
    for (const key of tracked) {
      const family = familyOfTracked(key);
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(key);
    }
    let missing = false;
    for (const [family, keys] of groups) {
      const body = make('tbody');
      const groupRow = make('tr', 'home-group');
      const groupHead = make('th');
      groupHead.setAttribute('scope', 'rowgroup');
      groupHead.setAttribute('colspan', String(months.length + 1));
      groupHead.append(make('span', 'home-group-name', familyName(family)));
      groupRow.append(groupHead);
      body.append(groupRow);
      for (const key of keys) {
        const row = make('tr');
        row.dataset.key = key;
        const name = make('th', '', trackedName(key));
        name.setAttribute('scope', 'row');
        row.append(name);
        for (const reading of months) {
          const cell = make('td');
          // A reading saved before a key existed shows a dash, never 0; the note under the table says why.
          const has = own(reading.figures, key) && isNum(reading.figures[key]);
          if (!has) missing = true;
          cell.append(figure(has ? reading.figures[key] : undefined));
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
    }
    const scroller = make('div', 'home-scroll');
    // A wide table scrolls sideways: reachable and named for the keyboard, inside the Seguimiento region (no second one).
    // The name is the scroller's alone: the table inside repeats neither it nor the region's.
    scroller.setAttribute('tabindex', '0');
    scroller.setAttribute('role', 'group');
    scroller.setAttribute('aria-label', say('monthsTable'));
    scroller.append(table);
    return missing ? [scroller, make('p', 'home-note', say('notReadThen'))] : [scroller];
  }

  function renderTracking() {
    const readings = answer.readings;
    const months = readings.months;
    const tracked = Array.isArray(answer.tracked) ? answer.tracked : [];
    const title = make('h2', 'home-block-title', say('tracking'));
    title.id = 'homeTrackingTitle';
    const head = make('div', 'home-tracking-head');
    head.append(title, make('p', 'home-note', say('trackingIntro')));
    if (months.length > 1) head.append(make('p', 'home-note', say('readingsSince', { month: monthYear(months[0].month) })));
    if (!readings.today) {
      const failed = failedParts();
      if (failed.length) head.append(make('p', 'home-note', say('notSaved', { part: failed.join(', ') })));
      else if (!months.length) head.append(make('p', 'home-note', say('noReadings')));
    }
    const parts = [head];
    const table = months.length > 1 && tracked.length > 0;
    if (months.length === 1 && tracked.length) {
      // One reading: it is today's figures again, so it waits behind one click (print opens it).
      const [reading] = months;
      const box = make('details', 'home-reading');
      box.open = readingOpen;
      box.addEventListener('toggle', () => { readingOpen = box.open; });
      box.append(make('summary', '', say('seeReading', { month: monthYear(reading.month) })));
      const list = make('ul', 'home-figs home-reading-list');
      list.setAttribute('aria-label', monthYear(reading.month));
      for (const key of tracked) {
        const row = make('li', 'home-fig');
        row.dataset.key = key;
        // A reading saved before a key existed shows a dash, never 0.
        const has = own(reading.figures, key) && isNum(reading.figures[key]);
        const body = make('span', 'home-fig-body');
        body.append(make('span', 'home-fig-name', trackedName(key)));
        row.append(figure(has ? reading.figures[key] : undefined), body);
        list.append(row);
      }
      const when = make('p', 'home-note');
      when.append(readOnLabel(reading));
      box.append(when, list);
      parts.push(box);
    } else if (table) {
      parts.push(...trackingTable(months, tracked));
    }
    parts.push(...strayCharts());
    el.tracking.replaceChildren(...parts);
    if (el.readingsCsv) el.readingsCsv.hidden = months.length === 0;
    // Offer the month comparison once the table has at least two readings.
    if (el.compare) el.compare.hidden = !table;
    layout();
  }

  /* The month table wider than the screen opens on its latest whole months: the first month shown starts right where
     the names that stay at the left end. When the scroll cannot reach that far, the table gets that much room after its
     last month (--tail), so no sliver of the month before shows beside the names. */
  function placeTable() {
    const scroller = el.tracking.querySelector('.home-scroll');
    if (!scroller) return;
    scroller.style.removeProperty('--tail');
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const names = scroller.querySelector('thead th')?.getBoundingClientRect().width ?? 0;
    const heads = [...scroller.querySelectorAll('thead th[data-month]')];
    const first = heads.find((th) => scroller.scrollWidth - th.offsetLeft <= scroller.clientWidth - names) ?? heads[heads.length - 1];
    if (!first) return;
    const target = Math.max(0, first.offsetLeft - names);
    const reach = scroller.scrollWidth - scroller.clientWidth;
    if (target > reach) scroller.style.setProperty('--tail', `${Math.ceil(target - reach)}px`);
    scroller.scrollLeft = target;
  }

  function render() {
    paintChrome();
    renderTop();
    renderHead();
    renderBlocks();
    renderTracking();
  }

  const usable = (body) => body && typeof body === 'object' && Array.isArray(body.families) && body.texts?.en && typeof body.asOf === 'string'
    && typeof body.limaDay === 'string' && body.windows?.d7 && body.windows?.d30 && Array.isArray(body.unavailable) && Array.isArray(body.notActivated)
    && body.readings && Array.isArray(body.readings.months);
  const complete = (held) => held.unavailable.length === 0 && held.notActivated.length === 0;
  const rowFor = (status) => ({ 401: 'expired', 403: 'denied', 404: 'notHere', 429: 'tooMany' })[status] ?? 'failed';

  function report(row) {
    statusRow = row;
    // The sign-in link comes back here once the session is open again.
    if (row === 'expired') el.signIn.setAttribute('href', 'login.html?next=%2Fadmin-home.html');
    el.signIn.hidden = row !== 'expired';
    paintStatus();
  }

  function busy(on) {
    el.retry.disabled = on;
    el.refresh.disabled = on;
  }

  // A denied request invalidates every outstanding response, including CSV bodies still streaming.
  function loseAccess(status) {
    const focused = document.activeElement;
    const moveFocus = focused && (focused === el.refresh || focused === el.retry
      || [el.reports, el.top, el.blocks, el.tracking].some((area) => area?.contains(focused)));
    accessGeneration += 1;
    answer = null;
    confirmedReading = null;
    readingSentFor = null;
    beforeDownload = null;
    readingOpen = false;
    openBeforePrint = null;
    openFamilies.clear();
    selectedFamily = null;
    switches = [];
    loading = false;
    busy(false);
    el.top.hidden = true;
    el.pending.hidden = true;
    el.partial.textContent = '';
    el.partial.hidden = true;
    el.asOf.textContent = '';
    for (const area of [el.route, el.lead, el.pending, el.windows, el.blocks, el.tracking]) area.replaceChildren();
    el.tracking.hidden = true;
    el.blocks.hidden = true;
    el.retry.hidden = true;
    el.reports.open = false;
    el.reports.hidden = true;
    if (el.compare) el.compare.hidden = true;
    if (el.readingsCsv) el.readingsCsv.hidden = true;
    for (const button of [el.csv, el.monthsCsv, el.readingsCsv]) if (button) button.disabled = false;
    report(rowFor(status));
    if (moveFocus) (status === 401 ? el.signIn : el.status).focus();
  }

  function mergeReading(held, reading) {
    if (!reading || held.readings.today || reading.day !== held.limaDay) return;
    const months = held.readings.months.filter((row) => row.month !== reading.month);
    months.push(reading);
    months.sort((a, b) => a.month.localeCompare(b.month));
    held.readings = { ...held.readings, months, today: true };
  }

  async function load(fresh) {
    if (loading) return;
    const generation = accessGeneration;
    loading = true;
    busy(true);
    // A retry on an empty page says it is working.
    if (answer === null) report('loading');
    let outcome = 'failed';
    try {
      const res = await fetch(fresh ? '/api/admin/metrics?fresh=1' : '/api/admin/metrics', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) outcome = res.status;
      else {
        const body = await res.json();
        if (usable(body)) outcome = body;
      }
    } catch { outcome = 'failed'; }
    if (generation !== accessGeneration) return;
    if (outcome === 401 || outcome === 403) { loseAccess(outcome); return; }
    loading = false;
    busy(false);
    if (typeof outcome === 'object') {
      answer = outcome;
      // A concurrent refresh may have fetched history just before the server confirmed today's reading.
      if (confirmedReading?.day !== answer.limaDay) confirmedReading = null;
      mergeReading(answer, confirmedReading);
      el.tracking.hidden = false;
      el.blocks.hidden = false;
      el.reports.hidden = false;
      statusRow = '';
      beforeDownload = null;
      el.retry.hidden = true;
      el.signIn.hidden = true;
      render();
      saveReading();
      return;
    }
    const row = rowFor(outcome);
    beforeDownload = null;
    // Keep the last successful snapshot when a refresh fails.
    el.retry.hidden = answer !== null || row === 'notHere';
    report(row);
  }

  // A complete dashboard asks once per Lima day. The first writer may be another admin, so show the server's
  // persisted figures even if this page lost the insert race. Older servers expose history on the next refresh.
  async function saveReading() {
    const day = answer.limaDay;
    if (readingSentFor === day || !complete(answer) || answer.readings.today) return;
    const generation = accessGeneration;
    readingSentFor = day;
    let saved;
    try {
      const res = await fetch('/api/admin/metrics/readings?include=reading', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (generation !== accessGeneration) return;
      if (res.status === 401 || res.status === 403) { loseAccess(res.status); return; }
      if (!res.ok) return;
      saved = await res.json();
    } catch { return; }
    const reading = saved?.reading;
    if (generation !== accessGeneration || day !== answer?.limaDay || saved?.day !== day || reading?.day !== day
      || reading.month !== day.slice(0, 7) || !isNum(reading.defs) || !reading.figures
      || typeof reading.figures !== 'object' || Array.isArray(reading.figures)) return;
    confirmedReading = reading;
    if (!answer.readings.today) {
      mergeReading(answer, reading);
      renderTracking();
    }
  }

  function downloadFailed(row) {
    if (beforeDownload === null) beforeDownload = statusRow;
    report(row);
  }

  async function download(button, table) {
    if (!answer || !button || button.disabled || button.hidden) return;
    const generation = accessGeneration;
    button.disabled = true;
    try {
      const res = await fetch(`/api/admin/metrics/export?table=${table}&lang=${lang()}`, { credentials: 'same-origin' });
      if (generation !== accessGeneration) return;
      if (res.status === 401 || res.status === 403) { loseAccess(res.status); return; }
      if (!res.ok) { downloadFailed(rowFor(res.status)); return; }
      const blob = await res.blob();
      if (generation !== accessGeneration) return;
      // A successful download restores the previous dashboard status.
      if (beforeDownload !== null) { const row = beforeDownload; beforeDownload = null; report(row); }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `nodal-${table}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (generation === accessGeneration) downloadFailed('failed');
    } finally {
      if (generation === accessGeneration) button.disabled = false;
    }
  }

  el.retry.addEventListener('click', () => load(false));
  el.refresh.addEventListener('click', () => load(true));
  el.csv.addEventListener('click', () => download(el.csv, 'indicators'));
  el.readingsCsv?.addEventListener('click', () => download(el.readingsCsv, 'readings'));
  el.monthsCsv?.addEventListener('click', () => download(el.monthsCsv, 'months'));
  el.print.addEventListener('click', () => { if (answer) window.print(); });
  // Print opens every definition and the folded reading (a stylesheet cannot open a closed <details> in every
  // browser), then puts each back as it was.
  window.addEventListener('beforeprint', () => {
    if (openBeforePrint) return;
    const boxes = [...el.tracking.querySelectorAll('details')];
    openBeforePrint = boxes.map((box) => [box, box.open]);
    for (const box of boxes) box.open = true;
    for (const { section, toggle } of switches) {
      section.hidden = false;
      explain(section, toggle, true, false);
    }
  });
  window.addEventListener('afterprint', () => {
    if (openBeforePrint) for (const [box, wasOpen] of openBeforePrint) box.open = wasOpen;
    openBeforePrint = null;
    selectFamily(selectedFamily);
    for (const { section, toggle } of switches) explain(section, toggle, openFamilies.has(section.dataset.family), false);
  });

  paintChrome();
  load(false);
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(() => {
    if (answer) render();
    else paintChrome();
  }), { once: true });
})();
