/* The admin home (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R3. The home").
   One GET of /api/admin/metrics, rendered in the page language; the answer brings every indicator's words (texts), the
   lead figures (lead), the rows of "Seguimiento" (tracked) and the lists the page is laid out by (route, seriesIndicator,
   pairs), so this file holds only its own chrome as [en, es, pt] rows.
   Layout: the member path drawn as a route under the title (its stops carry the lead figures that are stages), the
   other lead figures and the queues beside it, then the seven families in explicit columns that keep the catalogue's
   order, each built the same way: figures with their window in words, ranked rows with thin bars, month bars, and
   "How it is counted" opening each definition under its own row.
   A language change re-renders the held answer and never asks again. Today's reading is sent once per Lima day of the
   page view, only after a complete answer whose day has none. DOM built with createElement/createElementNS and
   textContent only; sizes that come from the data reach CSS as custom properties through the CSSOM. */
(() => {
  const el = {
    title: document.getElementById('homeTitle'),
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
    title: ['NODAL metrics', 'Indicadores de NODAL', 'Indicadores da NODAL'],
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
    last7: ['Last 7 days: {range}', 'Últimos 7 días: {range}', 'Últimos 7 dias: {range}'],
    last30: ['Last 30 days: {range}', 'Últimos 30 días: {range}', 'Últimos 30 dias: {range}'],
    in30: ['in 30 days', 'en 30 días', 'em 30 dias'],
    in7: ['in 7 days', 'en 7 días', 'em 7 dias'],
    kindsNoneWeek: ['0 in 7 days for every kind', '0 en 7 días en todos los tipos', '0 em 7 dias em todos os tipos'],
    noNew: ['{n} days without new accounts (last: {day})', '{n} días sin cuentas nuevas (última: {day})', '{n} dias sem contas novas (última: {day})'],
    noNewOne: ['{n} day without new accounts (last: {day})', '{n} día sin cuentas nuevas (última: {day})', '{n} dia sem contas novas (última: {day})'],
    route: ['The members’ path', 'Recorrido de los miembros', 'Percurso dos membros'],
    routeNote: [
      'Counts per stage, not conversion rates: a stage does not always contain the next.',
      'Conteos por etapa, no tasas de paso: una etapa no siempre contiene a la siguiente.',
      'Contagens por etapa, não taxas de passagem: uma etapa nem sempre contém a seguinte.',
    ],
    pending: ['Needs attention', 'Por atender', 'Para atender'],
    nothingPending: ['Nothing waiting', 'Nada por atender', 'Nada para atender'],
    team: ['includes {n} from the team', 'incluye {n} del equipo', 'inclui {n} da equipe'],
    of: ['{a} of {b}', '{a} de {b}', '{a} de {b}'],
    oneCourse: ['One course: {name}', 'Un curso: {name}', 'Um curso: {name}'],
    perMonth: ['{name} by month', '{name}, por mes', '{name}, por mês'],
    inMonth: ['in {month}', 'en {month}', 'em {month}'],
    howCounted: ['How it is counted', 'Cómo se cuenta', 'Como se conta'],
    hideHow: ['Hide', 'Ocultar', 'Ocultar'],
    source: ['Source', 'Fuente', 'Fonte'],
    limits: ['Limits', 'Límites', 'Limites'],
    tracking: ['Tracking', 'Seguimiento', 'Acompanhamento'],
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
  const PENDING = [['interests', 'activity.interests', 'admin.html#interests'], ['orgRequests', 'memberships.orgRequests', 'admin.html#nodes'], ['lab', 'festival.labApplications', 'fiiu-admin.html']];
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
  // The status the page had before a download failed (null: no download has failed since); a download that works puts it back.
  let beforeDownload = null;
  // The families whose definitions are open, kept across a re-render; each family's section with its switch.
  const openFamilies = new Set();
  let switches = [];
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

  // The saved-figures key rule: <key> is the total, <key>.d30 and <key>.d7 the windows. An indicator with a state has none.
  function valueOf(map, key) {
    const windowedKey = WINDOWED.exec(key);
    const [base, field] = map.has(key) || !windowedKey ? [key, 'total'] : [windowedKey[1], windowedKey[2]];
    const ind = map.get(base);
    return ind && !ind.state && isNum(ind[field]) ? ind[field] : undefined;
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
    return { key: latest.key, line };
  }

  function paintStatus() {
    el.status.textContent = statusRow ? say(statusRow) : '';
  }

  function paintChrome() {
    const title = say('title');
    el.title.textContent = title;
    document.title = title;
    const skip = document.querySelector('.admin-skip');
    if (skip) skip.textContent = say('skip');
    for (const [node, row] of [[el.csvLabel, 'csvLabel'], [el.csv, 'csvIndicators'], [el.monthsCsv, 'monthsCsv'], [el.readingsCsv, 'readingsCsv'], [el.compare, 'compare'], [el.print, 'print'], [el.refresh, 'refresh'], [el.retry, 'retry'], [el.printHead, 'printHead'], [el.signIn, 'signIn']]) {
      if (node) node.textContent = say(row);
    }
    // Each download says in full what it downloads, for a screen reader that reaches it on its own.
    for (const [node, row] of [[el.csv, 'csvIndicatorsFull'], [el.monthsCsv, 'csvMonthsFull'], [el.readingsCsv, 'csvReadingsFull']]) node?.setAttribute('aria-label', say(row));
    paintStatus();
  }

  function renderHead(noNewPlaced) {
    el.asOf.textContent = say('asOf', { when: dates({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.parse(answer.asOf)) });
    const lines = [make('span', '', say('last30', { range: range(answer.windows.d30) })), make('span', '', say('last7', { range: range(answer.windows.d7) }))];
    // The days without new accounts stand at the route's first stop; here only when the route does not show them.
    const noNew = noNewPlaced ? null : noNewLine('');
    if (noNew) lines.push(noNew.line);
    el.windows.replaceChildren(...lines);
  }

  /* ---------- the top: the member path, the other lead figures, the queues ---------- */

  // One lead line: figure, name with its window, and the reason when the figure could not be computed.
  function leadLine(map, key, field, className) {
    const ind = map.get(key) ?? { state: 'unavailable' };
    const row = make('p', `home-fig ${className}`);
    row.dataset.key = key;
    row.append(figure(ind.state ? undefined : ind[field]));
    const body = make('span', 'home-fig-body');
    body.append(make('span', 'home-fig-name', withField(key, field)));
    if (ind.state) body.append(make('span', 'home-fig-more home-reason', reason(ind.state)));
    // A visit figure never stands under a window without the day its count began.
    else if (visitFamily(key) && youngCounter(field)) body.append(make('span', 'home-fig-more home-reason', reason('not_yet_counted')));
    row.append(body);
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
    const onRoute = (key, field) => route.some(([k, f]) => k === key && f === field);
    const valueAt = ([key, field]) => { const ind = map.get(key); return ind && !ind.state && isNum(ind[field]) ? ind[field] : undefined; };
    const values = route.map(valueAt).filter(isNum);
    // One scale for every stop: each column is that stage's own count, never a share of the stop before.
    const scale = values.reduce((max, value) => Math.max(max, value), 0);
    const noNew = noNewLine('home-stop-more home-silence');
    let noNewPlaced = false;

    // The second lines of a lead figure that is a stop, except those that are stops themselves. A second line that
    // failed for the same reason as its stop does not say the reason twice.
    function seconds(key, field, stopState) {
      const item = lead.find((entry) => entry.key === key && entry.field === field);
      const second = item && Array.isArray(item.second) ? item.second : [];
      return second.filter(([k, f]) => !onRoute(k, f)).flatMap(([k, f]) => {
        const ind = map.get(k) ?? { state: 'unavailable' };
        const line = make('span', 'home-stop-more');
        line.dataset.key = k;
        if (ind.state) {
          line.append(figure(undefined), ` ${withField(k, f)}`);
          if (ind.state !== stopState) line.append(' ', make('span', 'home-reason', reason(ind.state)));
        }
        // The same indicator in another window says only the window: "0 en 7 días".
        else if (k === key) line.append(windowed(ind[f], f));
        else line.append(figure(ind[f]), ` ${withField(k, f)}`);
        const lines = [line];
        if (noNew && noNew.key === k && !ind.state) {
          lines.push(noNew.line);
          noNewPlaced = true;
        }
        return lines;
      });
    }

    const title = make('h2', 'home-route-title', say('route'));
    title.id = 'homeRouteTitle';
    const stops = make('ol', 'home-stops');
    stops.setAttribute('aria-labelledby', title.id);
    stops.style.setProperty('--stops', String(route.length));
    // The stop figures are sized to the longest one, so five digits still fit their stop.
    stops.style.setProperty('--digits', String(values.reduce((most, value) => Math.max(most, number(value).length), 3)));
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
      const more = seconds(key, field, ind.state);
      if (more.length) {
        const box = make('span', 'home-stop-mores');
        box.append(...more);
        stop.append(box);
      }
      stops.append(stop);
    });
    // A stop's second lines may run right, under the stops that have none, instead of piling up in one narrow column.
    const items = [...stops.children];
    items.forEach((stop, i) => {
      const box = stop.querySelector('.home-stop-mores');
      if (!box) return;
      let span = 1;
      while (i + span < items.length && !items[i + span].querySelector('.home-stop-mores')) span += 1;
      if (span > 1) {
        box.classList.add('is-wide');
        box.style.setProperty('--span', String(Math.min(span, 3)));
      }
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
    el.route.replaceChildren(title, note, stops);
    // Without a path in the answer the top keeps only the lead figures (in a row) and the queues.
    el.route.hidden = route.length === 0;
    el.top.classList.toggle('no-route', route.length === 0);

    // The lead figures that are not stages of the path stand beside it, with their own second lines.
    const extras = lead.filter(({ key, field }) => !onRoute(key, field)).map(({ key, field, second }) => {
      const group = make('div', 'home-lead-item');
      group.dataset.key = key;
      group.append(leadLine(map, key, field, 'home-lead-main'));
      for (const [k, f] of Array.isArray(second) ? second : []) if (!onRoute(k, f)) group.append(leadLine(map, k, f, 'home-lead-second'));
      return group;
    });
    el.lead.replaceChildren(...extras);
    el.lead.hidden = extras.length === 0;
    const waiting = renderPending();
    // The queues come first when one waits, on the page and for the keyboard; otherwise they close the top.
    const order = waiting ? [el.pending, el.route, el.lead] : [el.route, el.lead, el.pending];
    if (order.some((node, i) => el.top.children[i] !== node)) el.top.append(...order);
    el.top.hidden = false;
    return noNewPlaced;
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
    if (!known.length) { el.pending.replaceChildren(); el.pending.hidden = true; return false; }
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
    return waiting;
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
    const title = make('h3', 'home-sub', D30_LISTS.has(ind.key) ? withField(ind.key, 'd30') : nameOf(ind.key));
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

  function chart(series) {
    const { name, label, values } = series;
    const { shown: months, crosses, widest } = drawn(series);
    const wrap = make('div', 'home-chart');
    wrap.dataset.series = name;
    const title = make('h3', 'home-sub', say('perMonth', { name: label }));
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

  function missingChart({ name, label }, why) {
    const wrap = make('div', 'home-chart is-missing');
    wrap.dataset.series = name;
    const line = make('p', 'home-chart-why');
    line.append(figure(undefined), ' ', make('span', 'home-reason', why));
    wrap.append(make('h3', 'home-sub', say('perMonth', { name: label })), line);
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

  function block(family, index) {
    const section = make('section', 'home-block');
    section.id = `home-b-${family.key}`;
    section.dataset.family = family.key;
    section.dataset.index = String(index);
    // Print and one column read the families in the catalogue's order.
    section.style.order = String(index);
    const head = make('div', 'home-block-head');
    const title = make('h2', 'home-block-title', familyName(family.key));
    title.id = `home-h-${family.key}`;
    section.setAttribute('aria-labelledby', title.id);
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
    switches.push({ section, toggle });
    explain(section, toggle, openFamilies.has(family.key));
    return section;
  }

  function renderBlocks() {
    switches = [];
    const sections = answer.families.map((family, i) => block(family, i));
    const column = make('div', 'home-col');
    column.append(...sections);
    el.blocks.replaceChildren(column);
  }

  /* ---------- columns ---------- */

  /* The families stand in explicit columns (the count comes from the stylesheet's --cols) and keep the catalogue's order,
     read down a column and then across: only where each column ends is chosen. Every cut is tried (C(n−1, k−1): 35 for
     eight blocks in four columns); the best is the one whose tallest column is shortest, the most even ends breaking a
     near tie. The cut last used on this screen for as many columns is kept while its tallest column stays within
     max(15%, 120px) of the best, so a family keeps its column from one day to the next and across languages; it moves
     only to the foot of the column before or the head of the next, and only when keeping it would leave a large hole. */
  const CUTS_KEY = 'nodal.home.cuts';
  function rememberedCuts() {
    try {
      const held = JSON.parse(localStorage.getItem(CUTS_KEY) ?? '{}');
      return held && typeof held === 'object' ? held : {};
    } catch { return {}; }
  }
  function cutColumns(heights, count, gap) {
    const n = heights.length;
    const k = Math.min(count, n);
    const columnOf = new Array(n).fill(0);
    if (k <= 1) return columnOf;
    const options = [];
    const ends = [];
    const visit = (start, left) => {
      if (left === 1) {
        const bounds = [0, ...ends, n];
        let tallest = 0;
        let shortest = Infinity;
        for (let c = 0; c + 1 < bounds.length; c += 1) {
          let total = gap * (bounds[c + 1] - bounds[c] - 1);
          for (let i = bounds[c]; i < bounds[c + 1]; i += 1) total += heights[i];
          tallest = Math.max(tallest, total);
          shortest = Math.min(shortest, total);
        }
        options.push({ tallest, spread: tallest - shortest, bounds });
        return;
      }
      for (let end = start + 1; end <= n - left + 1; end += 1) {
        ends.push(end);
        visit(end, left - 1);
        ends.pop();
      }
    };
    visit(0, k);
    let least = Infinity;
    for (const option of options) least = Math.min(least, option.tallest);
    let best = null;
    for (const option of options) if (option.tallest <= least + 24 && (!best || option.spread < best.spread)) best = option;
    const key = `${k}:${n}`;
    const held = rememberedCuts();
    const kept = Array.isArray(held[key]) ? options.find((option) => option.bounds.join() === held[key].join()) : null;
    const chosen = kept && kept.tallest <= least + Math.max(least * 0.15, 120) ? kept : best;
    if (chosen !== kept) {
      try { localStorage.setItem(CUTS_KEY, JSON.stringify({ ...held, [key]: chosen.bounds })); } catch { /* without storage the best cut is taken each time */ }
    }
    for (let c = 0; c + 1 < chosen.bounds.length; c += 1) for (let i = chosen.bounds[c]; i < chosen.bounds[c + 1]; i += 1) columnOf[i] = c;
    return columnOf;
  }

  /* Measured once per layout (a render, a new width, the fonts) with every definition closed, so opening "How it is
     counted" only lengthens its own column and never moves a family. A short "Seguimiento" then closes the shortest
     column; print and one column read everything in the catalogue's order. */
  function balance() {
    const sections = [...el.blocks.querySelectorAll('.home-block')].filter((node) => node !== el.tracking).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    if (!sections.length) return;
    const cols = Math.max(1, Math.round(Number.parseFloat(getComputedStyle(el.blocks).getPropertyValue('--cols')) || 1));
    const inFlow = el.blocks.contains(el.tracking);
    let columns = [...el.blocks.children];
    if (columns.length !== cols) {
      columns = Array.from({ length: cols }, () => make('div', 'home-col'));
      sections.forEach((section, i) => columns[i % cols].append(section));
      if (inFlow) columns[0].append(el.tracking);
      el.blocks.replaceChildren(...columns);
    }
    el.blocks.classList.add('is-measuring');
    const heights = sections.map((section) => section.getBoundingClientRect().height);
    el.blocks.classList.remove('is-measuring');
    const gap = Number.parseFloat(getComputedStyle(columns[0]).rowGap) || 0;
    const columnOf = cutColumns(heights, cols, gap);
    const totals = columns.map(() => -gap);
    sections.forEach((section, i) => { totals[columnOf[i]] += heights[i] + gap; });
    const shortest = totals.indexOf(Math.min(...totals));
    columns.forEach((column, k) => {
      const mine = sections.filter((section, i) => columnOf[i] === k);
      if (inFlow && k === shortest) mine.push(el.tracking);
      if (mine.some((node, i) => column.children[i] !== node) || column.children.length !== mine.length) column.replaceChildren(...mine);
    });
  }

  /* A layout pass (a render, a new width, the fonts): the columns, then each box that scrolls sideways opened on its
     latest months. */
  function layout() {
    balance();
    for (const box of document.querySelectorAll('#homeMain .home-months-box')) placeMonths(box);
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
    const charts = strays.map((stray) => (stray.values.state || stray.months.length === 0 ? missingChart(stray, reason(stray.values.state ?? 'not_yet_counted')) : chart(stray)));
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
    // "Compare months" in the tools jumps to the table once there is one.
    if (el.compare) el.compare.hidden = !table;
    placeTracking(!table);
  }

  /* With one reading or none, "Seguimiento" is a few lines: it joins the columns as one more block (it closes the
     shortest column, and print keeps it last). With two or more it is the month table across the whole width, opened on
     its latest months when it is wider than the screen. Either way the page is laid out again. */
  function placeTracking(compact) {
    const index = answer.families.length;
    if (compact) {
      el.tracking.classList.add('home-block');
      el.tracking.dataset.index = String(index);
      el.tracking.style.order = String(index);
      if (!el.blocks.contains(el.tracking)) (el.blocks.lastElementChild ?? el.blocks).append(el.tracking);
    } else {
      el.tracking.classList.remove('home-block');
      delete el.tracking.dataset.index;
      el.tracking.style.removeProperty('order');
      if (el.tracking.previousElementSibling !== el.blocks) el.blocks.after(el.tracking);
    }
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
    const noNewPlaced = renderTop();
    renderHead(noNewPlaced);
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

  async function load(fresh) {
    if (loading) return;
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
    loading = false;
    busy(false);
    if (typeof outcome === 'object') {
      answer = outcome;
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
    // Figures already on screen stay there; only a page with none offers the retry.
    el.retry.hidden = answer !== null || row === 'expired' || row === 'notHere' || row === 'denied';
    report(row);
  }

  /* The reading of the held answer's Lima day, sent at most once per day of this page view: only for a complete answer
     whose day has none. A failure is silent and is not sent again for that day from this page view (the next opening of
     the page sends it); a page left open into the next Lima day sends that day's on its next refresh. A saved reading of
     the held answer's own day joins "Seguimiento" without a second GET. */
  async function saveReading() {
    if (readingSentFor === answer.limaDay || !complete(answer) || answer.readings.today) return;
    readingSentFor = answer.limaDay;
    let saved;
    try {
      const res = await fetch('/api/admin/metrics/readings', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      saved = await res.json();
    } catch { return; }
    if (saved?.saved !== true || saved.day !== answer.limaDay || answer.readings.today) return;
    const map = indicators();
    const figures = {};
    for (const key of Array.isArray(answer.tracked) ? answer.tracked : []) {
      const value = valueOf(map, key);
      if (value !== undefined) figures[key] = value;
    }
    const month = saved.day.slice(0, 7);
    // A month shows its latest reading.
    const months = answer.readings.months.filter((reading) => reading.month !== month);
    months.push({ month, day: saved.day, defs: answer.defs, figures });
    months.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    answer.readings.months = months;
    answer.readings.today = true;
    renderTracking();
  }

  function downloadFailed(row) {
    if (beforeDownload === null) beforeDownload = statusRow;
    report(row);
  }

  async function download(button, table) {
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const res = await fetch(`/api/admin/metrics/export?table=${table}&lang=${lang()}`, { credentials: 'same-origin' });
      if (!res.ok) { downloadFailed(rowFor(res.status)); return; }
      // What an earlier failed download said no longer holds: the page says again what it said before (a first load
      // that failed keeps its words beside the retry button; a page with figures is quiet).
      if (beforeDownload !== null) { const row = beforeDownload; beforeDownload = null; report(row); }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `nodal-${table}.csv`;
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      downloadFailed('failed');
    } finally {
      button.disabled = false;
    }
  }

  el.retry.addEventListener('click', () => load(false));
  el.refresh.addEventListener('click', () => load(true));
  el.csv.addEventListener('click', () => download(el.csv, 'indicators'));
  el.readingsCsv?.addEventListener('click', () => download(el.readingsCsv, 'readings'));
  el.monthsCsv?.addEventListener('click', () => download(el.monthsCsv, 'months'));
  el.print.addEventListener('click', () => window.print());
  // Print opens every definition and the folded reading (a stylesheet cannot open a closed <details> in every
  // browser), then puts each back as it was.
  window.addEventListener('beforeprint', () => {
    const boxes = [...document.querySelectorAll('#homeMain details')];
    openBeforePrint = boxes.map((box) => [box, box.open]);
    for (const box of boxes) box.open = true;
    for (const { section, toggle } of switches) explain(section, toggle, true, false);
  });
  window.addEventListener('afterprint', () => {
    if (openBeforePrint) for (const [box, wasOpen] of openBeforePrint) box.open = wasOpen;
    openBeforePrint = null;
    for (const { section, toggle } of switches) explain(section, toggle, openFamilies.has(section.dataset.family), false);
  });

  paintChrome();
  load(false);
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(() => {
    if (answer) render();
    else paintChrome();
  }), { once: true });
})();
