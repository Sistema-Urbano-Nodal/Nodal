/* Language and topic changes reuse the current metrics response. Paired monthly
   series share one scale. Saved readings keep their original definitions. */
(() => {
  const el = {
    title: document.getElementById('homeTitle'),
    main: document.getElementById('homeMain'),
    views: document.getElementById('homeViews'),
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
    overview: ['Overview', 'Resumen', 'Visão geral'],
    indicators: ['Indicators', 'Indicadores', 'Indicadores'],
    history: ['Monthly history', 'Historial mensual', 'Histórico mensal'],
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
    lastSignup: ['Latest sign-up', 'Último registro', 'Último cadastro'],
    inactive: ['Tracking inactive', 'Seguimiento inactivo', 'Coleta inativa'],
    route: ['Member participation', 'Participación de los miembros', 'Participação dos membros'],
    pending: ['Needs attention', 'Por atender', 'Pendências'],
    nothingPending: ['Nothing waiting', 'Nada por atender', 'Nada para atender'],
    team: ['includes {n} from the team', 'incluye {n} del equipo', 'inclui {n} da equipe'],
    of: ['{a} of {b}', '{a} de {b}', '{a} de {b}'],
    oneCourse: ['One course: {name}', 'Un curso: {name}', 'Um curso: {name}'],
    perMonth: ['{name} by month', '{name}, por mes', '{name}, por mês'],
    monthlyTrend: ['Monthly trend', 'Evolución mensual', 'Evolução mensal'],
    monthMissing: ['No data for this month', 'Sin datos para este mes', 'Sem dados para este mês'],
    inMonth: ['in {month}', 'en {month}', 'em {month}'],
    explore: ['Topics', 'Temas', 'Temas'],
    total: ['Total', 'Total', 'Total'],
    d30: ['30 days', '30 días', '30 dias'],
    d7: ['7 days', '7 días', '7 dias'],
    notApplicable: ['Not applicable', 'No aplica', 'Não se aplica'],
    status: ['Status', 'Estado', 'Situação'],
    tracking: ['Monthly readings', 'Lecturas mensuales', 'Leituras mensais'],
    monthsTable: ['Months table', 'Tabla por mes', 'Tabela por mês'],
    indicator: ['Indicator', 'Indicador', 'Indicador'],
    readOn: ['read on day {day}', 'leído el {day}', 'lido no dia {day}'],
    olderDefs: ['read with earlier definitions', 'leído con definiciones anteriores', 'lido com definições anteriores'],
    notReadThen: ['—: not read that month', '—: no se leía ese mes', '—: não era lido nesse mês'],
    noReadings: ['No reading has been saved yet.', 'Aún no hay lecturas guardadas.', 'Ainda não há leituras salvas.'],
    notSaved: ['Today’s record is missing data from {part}.', 'Faltan datos de {part} para el registro de hoy.', 'Faltam dados de {part} para o registro de hoje.'],
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
  let switches = [];
  let selectedFamily = null;

  const words = () => answer.texts[lang()] ?? answer.texts.en;
  const indicators = () => new Map(answer.families.flatMap((family) => family.indicators).map((ind) => [ind.key, ind]));
  const nameOf = (key) => words().indicators[key]?.name ?? key;
  const familyName = (key) => words().families[key] ?? key;
  // A figure's name with its window in words: "Llegadas en 30 días"; a total carries no window.
  const withField = (key, field) => (field === 'total' ? nameOf(key) : `${nameOf(key)} ${say(IN[field])}`);
  // Visit figures while the counter is younger than the window they are printed under.
  const visitFamily = (key) => answer.families.some((family) => family.key === 'visits' && family.indicators.some((ind) => ind.key === key));
  const youngCounter = (field) => typeof answer.visitsSince === 'string' && own(answer.windows, field) && answer.visitsSince > answer.windows[field].from;
  // Older responses can omit the participation measures, series-to-indicator map or part/whole pairs.
  const routeStops = () => (Array.isArray(answer.route) ? answer.route.filter(Array.isArray) : []);
  const seriesIndicator = () => (answer.seriesIndicator && typeof answer.seriesIndicator === 'object' && !Array.isArray(answer.seriesIndicator) ? answer.seriesIndicator : {});
  const ofPairs = () => (Array.isArray(answer.pairs) ? answer.pairs.filter(Array.isArray) : []);

  // The words for a state; visits not yet counted name their first day, or say none is counted yet.
  function reason(state) {
    const states = words().states;
    if (state === 'not_activated') return say('inactive');
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

  function paintStatus() {
    el.status.textContent = statusRow ? say(statusRow) : '';
  }

  function paintChrome() {
    const view = el.main.dataset.view || 'overview';
    const title = say(view === 'overview' ? 'title' : view);
    el.title.textContent = title;
    document.title = `${title} · NODAL`;
    for (const link of el.views.querySelectorAll('[data-view]')) link.textContent = say(link.dataset.view);
    const skip = document.querySelector('.admin-skip');
    if (skip) skip.textContent = say('skip');
    for (const [node, row] of [[el.reportsLabel, 'export'], [el.periodTitle, 'periods'], [el.csvLabel, 'csvLabel'], [el.csv, 'csvIndicators'], [el.monthsCsv, 'monthsCsv'], [el.readingsCsv, 'readingsCsv'], [el.compare, 'compare'], [el.print, 'print'], [el.refresh, 'refresh'], [el.retry, 'retry'], [el.printHead, 'printHead'], [el.signIn, 'signIn']]) {
      if (node) node.textContent = say(row);
    }
    // Each download says in full what it downloads, for a screen reader that reaches it on its own.
    for (const [node, row] of [[el.csv, 'csvIndicatorsFull'], [el.monthsCsv, 'csvMonthsFull'], [el.readingsCsv, 'csvReadingsFull']]) node?.setAttribute('aria-label', say(row));
    paintStatus();
  }

  // Use real fragments for section links so the browser can restore a topic on Back or reload.
  function showView(hash) {
    const topicLink = hash.startsWith('#home-b-');
    let family = topicLink && switches.find(({ section }) => `#${section.id}` === hash);
    if (topicLink && !family) {
      family = switches[0];
      window.history.replaceState(null, '', family ? `#${family.section.id}` : '#homeBlocks');
    }
    const view = topicLink || hash === '#homeBlocks' ? 'indicators' : hash === '#homeTracking' ? 'history' : 'overview';
    el.main.dataset.view = view;
    if (family) selectFamily(family.section.dataset.family);
    for (const link of el.views.querySelectorAll('[data-view]')) {
      if (link.dataset.view === view) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    paintChrome();
    layout();
  }

  function navigate(hash) {
    if (location.hash !== hash) window.history.pushState(null, '', hash);
    showView(hash);
  }

  function rememberFamily(key) {
    const hash = `#home-b-${key}`;
    if (el.main.dataset.view === 'indicators' && location.hash !== hash) window.history.replaceState(null, '', hash);
  }

  for (const link of [...el.views.querySelectorAll('[data-view]'), el.compare]) {
    link.addEventListener('click', (event) => {
      if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return;
      event?.preventDefault();
      navigate(link.getAttribute('href'));
      if (link === el.compare) el.views.querySelector('[data-view="history"]').focus();
    });
  }
  window.addEventListener('hashchange', () => { if (answer) showView(location.hash); });

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
    const latest = answer.families.flatMap((family) => family.indicators).find((ind) => !ind.state && isNum(ind.daysSince) && ind.last);
    if (latest) {
      const entry = make('div');
      entry.append(make('dt', '', say('lastSignup')), make('dd', '', fullDay(latest.last)));
      periods.append(entry);
    }
    el.windows.replaceChildren(periods);
    const missing = failedParts();
    el.partial.textContent = missing.length ? say('partial', { parts: missing.join(', ') }) : '';
    el.partial.hidden = !missing.length;
  }

  // One lead line: figure, name with its window, and the reason when the figure could not be computed.
  function leadLine(map, key, field, family) {
    const ind = map.get(key) ?? { state: 'unavailable' };
    const row = make(family ? 'button' : 'p', 'home-fig home-lead-main');
    if (family) {
      row.type = 'button';
      row.title = say('exploreFamily', { family: familyName(family.key) });
      row.setAttribute('aria-controls', `home-b-${family.key}`);
      row.addEventListener('click', () => {
        const entry = switches.find(({ section }) => section.dataset.family === family.key);
        if (!entry) return;
        navigate(`#${entry.section.id}`);
        entry.tab.focus();
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
    route.forEach(([key, field]) => {
      const ind = map.get(key) ?? { state: 'unavailable' };
      const value = valueAt([key, field]);
      const stop = make('li', 'home-stop');
      stop.dataset.key = key;
      if (field !== 'total') stop.classList.add('is-window');
      const column = make('span', 'home-stop-fig');
      const bar = hide(make('span', 'home-stop-bar'));
      if (isNum(value) && scale > 0) bar.style.setProperty('--f', (value / scale).toFixed(4));
      column.append(figure(value, 'home-stop-n'), bar);
      // A stop that could not be computed says why where its column would stand.
      if (ind.state) column.append(make('span', 'home-stop-why home-reason', reason(ind.state)));
      stop.append(make('span', 'home-stop-name', withField(key, field)), column);
      stops.append(stop);
    });
    el.route.replaceChildren(title, stops);
    // Older catalogues can omit the path.
    el.route.hidden = route.length === 0;
    el.top.classList.toggle('no-route', route.length === 0);

    const headlines = lead.map(({ key, field }) => {
      const group = make('div', 'home-lead-item');
      group.dataset.key = key;
      const family = answer.families.find((group) => group.indicators.includes(map.get(key)));
      group.append(leadLine(map, key, field, family));
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

  const supportsField = (ind, field) => own(ind, field) || (Array.isArray(ind.fields) && ind.fields.includes(field));

  function metricCell(ind, field, whole) {
    const cell = make('td');
    cell.dataset.field = field;
    if (!supportsField(ind, field)) {
      cell.className = 'home-not-applicable';
      cell.append(make('span', 'admin-sr', say('notApplicable')));
    } else if (ind.state || !isNum(ind[field])) {
      cell.className = 'home-unavailable';
      cell.title = reason(ind.state ?? 'unavailable');
      cell.append(figure(undefined));
    } else if (whole && field === 'total') {
      cell.append(...sayNodes('of', { a: figure(ind.total), b: figure(whole.total) }));
    } else {
      cell.append(figure(ind[field]));
    }
    return cell;
  }

  function metricRow(ind, whole, fields, quiet) {
    const row = make('tr', whole ? 'home-pair' : '');
    row.dataset.key = ind.key;
    if (whole) row.dataset.of = whole.key;
    const label = make('th', '', nameOf(ind.key));
    label.setAttribute('scope', 'row');
    row.append(label);
    if (ind.state && !quiet) label.append(make('small', 'home-metric-note', reason(ind.state)));
    if (isNum(ind.team) && ind.team > 0) label.append(make('small', 'home-metric-note', say('team', { n: number(ind.team) })));
    const series = seriesOf(ind.key);
    if (!ind.state && series && !series.values.state && series.months.length === 1) {
      const [month] = series.months;
      const note = make('small', 'home-metric-note');
      note.append(figure(series.values[month]), ' ', say('inMonth', { month: monthYear(month) }));
      label.append(note);
    }
    if (ind.state && !Array.isArray(ind.fields)) {
      const cell = make('td', 'home-unavailable');
      cell.setAttribute('colspan', String(fields.length || 1));
      cell.title = reason(ind.state);
      cell.append(figure(undefined));
      row.append(cell);
    } else {
      row.append(...fields.map((field) => metricCell(ind, field, whole)));
    }
    return row;
  }

  function metricTable(family, title, once) {
    // Older responses omitted field information for a failed indicator. Its status spans the value columns.
    const unknownFields = (ind) => ind.state && !Array.isArray(ind.fields);
    const scalars = family.indicators.filter((ind) => unknownFields(ind) || FIELDS.some((field) => supportsField(ind, field)));
    if (!scalars.length) return null;
    const fields = FIELDS.filter((field) => scalars.some((ind) => supportsField(ind, field)));
    const table = make('table', 'home-metrics');
    table.setAttribute('aria-labelledby', title.id);
    const header = make('tr');
    for (const label of ['indicator', ...(fields.length ? fields : ['status'])]) {
      const column = make('th', '', say(label));
      column.setAttribute('scope', 'col');
      header.append(column);
    }
    const head = make('thead');
    head.append(header);
    const body = make('tbody');

    // Preserve the catalogue's true part/whole counts in a single Total cell.
    const paired = new Map();
    const byKey = new Map(scalars.map((ind) => [ind.key, ind]));
    for (const [part, whole] of ofPairs()) {
      const a = byKey.get(part);
      const b = byKey.get(whole);
      if (a && b && !a.state && !b.state && isNum(a.total) && isNum(b.total)) {
        paired.set(part, [a, b]);
        paired.set(whole, [a, b]);
      }
    }
    const done = new Set();
    for (const candidate of scalars) {
      if (done.has(candidate.key)) continue;
      const [ind, whole] = paired.get(candidate.key) ?? [candidate];
      if (whole) done.add(ind.key).add(whole.key);
      body.append(metricRow(ind, whole, fields, once(ind)));
    }
    table.append(head, body);
    const wrap = make('div', 'home-metric-wrap');
    wrap.append(table);
    return wrap;
  }

  // A list as ranked rows: figure, label, and a thin bar on the list's own scale (its largest item). A list that also
  // counts the last 7 days (activity by kind) says that figure after each label, or once under its title when it is 0
  // for every row.
  function rankList(ind, quiet) {
    const wrap = make('div', 'home-list');
    wrap.dataset.list = ind.key;
    const title = make('h4', 'home-sub', D30_LISTS.has(ind.key) ? withField(ind.key, 'd30') : nameOf(ind.key));
    title.id = `home-l-${ind.key.replace(/\W/g, '-')}`;
    wrap.append(title);
    if (ind.state) {
      const status = make('p', 'home-note');
      status.append(figure(undefined));
      if (!quiet) status.append(' ', reason(ind.state));
      wrap.append(status);
      return wrap;
    }
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
    const entries = family.indicators.map((ind) => ({ ind, series: seriesOf(ind.key) }));
    // These two comparisons have a common scale: account events, or web traffic counts.
    // Historical/unmapped series still use independent charts.
    const names = { signups: ['accounts', 'entered'], visits: ['views', 'arrivals'] }[family.key];
    const pair = names?.map((name) => entries.find(({ series }) => series?.name === name)?.series);
    const compare = pair?.every((series) => series && !series.values.state && series.months.length)
      && new Set(pair.flatMap((series) => series.months)).size > 1;
    return entries.flatMap(({ ind, series }) => {
      if (!series) return [];
      if (compare && pair.includes(series)) return series === pair[0] ? [chart(series, 'h4', pair[1])] : [];
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

  function chart(series, heading = 'h4', partner = null) {
    const entries = partner ? [series, partner] : [series];
    const months = [...new Set(entries.flatMap((entry) => entry.months))].sort().slice(-MAX_MONTHS);
    const counts = entries.flatMap(({ values }) => months.map((month) => values[month])).filter(isNum);
    const max = Math.max(0, ...counts);
    const widest = Math.max(1, ...counts.map((value) => number(value).length));
    const crosses = months.length > 1 && months[0].slice(0, 4) !== months.at(-1).slice(0, 4);
    const wrap = make('div', 'home-chart');
    wrap.dataset.series = entries.map((entry) => entry.name).join('-');
    const title = make(heading, 'home-sub', partner ? say('monthlyTrend') : say('perMonth', { name: series.label }));
    title.id = `home-s-${wrap.dataset.series}`;
    wrap.append(title);
    if (partner) {
      wrap.classList.add('home-comparison');
      const legend = make('ul', 'home-series-key');
      for (const entry of entries) legend.append(make('li', '', entry.label));
      wrap.append(legend);
    }
    const list = make('ol', 'home-months');
    list.setAttribute('aria-labelledby', title.id);
    list.style.setProperty('--n', String(months.length));
    list.style.setProperty('--mw', String(widest));
    // A series inside one year reads its year from the date at the top; one that crosses a year names each year once.
    if (crosses) list.classList.add('has-years');
    let missing = false;
    months.forEach((month, i) => {
      const item = make('li', 'home-month');
      item.dataset.month = month;
      const when = make('span', 'home-month-label', monthShort(month));
      if ((crosses || partner) && (i === 0 || month.slice(0, 4) !== months[i - 1].slice(0, 4))) when.append(' ', make('span', 'home-month-year', yearOf(month)));
      item.append(when);
      for (const entry of entries) {
        const value = entry.values[month];
        const bar = hide(make('span', 'home-month-bar'));
        if (max > 0 && isNum(value)) bar.style.setProperty('--f', (value / max).toFixed(4));
        const point = partner ? make('span', 'home-month-point') : item;
        if (partner) {
          point.dataset.seriesKey = entry.name;
          point.append(make('span', 'admin-sr', entry.label + ' '));
          item.append(point);
        }
        point.append(figure(value), bar);
        if (!isNum(value)) missing = true;
      }
      list.append(item);
    });
    // Wider than its column (a long series on a phone), the months scroll in their own box, opened on the latest.
    const box = make('div', 'home-months-box');
    box.dataset.title = title.id;
    box.append(list);
    wrap.append(box);
    if (missing) wrap.append(make('p', 'home-note', '— ' + say('monthMissing')));
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
    head.append(title);
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

    const table = metricTable(family, title, once);
    if (table) section.append(table);
    for (const ind of family.indicators) {
      if (!supportsField(ind, 'items')) continue;
      // Course lists break a scalar into courses; a single course is already identified above the table.
      if (FIELDS.some((field) => supportsField(ind, field)) && (ind.state || ind.items.length < 2)) continue;
      section.append(rankList(ind, once(ind)));
    }
    const charts = familyCharts(family, notes);
    if (charts.length) section.append(chartRow(charts, family.indicators.map((ind) => seriesOf(ind.key)).filter((series) => series && !series.values.state)));
    switches.push({ section, tab });
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

  const familyRail = window.matchMedia?.('(min-width: 901px)');
  const familyOrientation = () => familyRail?.matches ? 'vertical' : 'horizontal';
  familyRail?.addEventListener('change', () => {
    el.blocks.querySelector('.home-family-tabs')?.setAttribute('aria-orientation', familyOrientation());
  });

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
    tabs.setAttribute('aria-orientation', familyOrientation());
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
        if (selectedFamily !== family.key) {
          selectFamily(family.key);
          placeCharts(panel);
        }
        rememberFamily(family.key);
      });
      tab.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        let next;
        switch (event.key) {
          case 'ArrowUp':
          case 'ArrowLeft': next = (index + families.length - 1) % families.length; break;
          case 'ArrowDown':
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

  // Each month has one column. Family and indicator labels stay visible while scrolling horizontally.
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
    head.append(title);
    if (!readings.today) {
      const failed = failedParts();
      if (failed.length) head.append(make('p', 'home-note', say('notSaved', { part: failed.join(', ') })));
      else if (!months.length) head.append(make('p', 'home-note', say('noReadings')));
    }
    const parts = [head];
    if (months.length && tracked.length) parts.push(...trackingTable(months, tracked));
    parts.push(...strayCharts());
    el.tracking.replaceChildren(...parts);
    if (el.readingsCsv) el.readingsCsv.hidden = months.length === 0;
    // Offer the month comparison once the table has at least two readings.
    if (el.compare) el.compare.hidden = months.length < 2 || !tracked.length;
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
    renderTop();
    renderHead();
    renderBlocks();
    renderTracking();
    el.views.hidden = false;
    showView(location.hash);
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
      || [el.reports, el.views, el.top, el.blocks, el.tracking].some((area) => area?.contains(focused)));
    accessGeneration += 1;
    answer = null;
    confirmedReading = null;
    readingSentFor = null;
    beforeDownload = null;
    selectedFamily = null;
    switches = [];
    loading = false;
    busy(false);
    el.top.hidden = true;
    el.views.hidden = true;
    delete el.main.dataset.view;
    paintChrome();
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
  paintChrome();
  load(false);
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(() => {
    if (answer) render();
    else paintChrome();
  }), { once: true });
})();
