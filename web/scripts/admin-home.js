/* The admin home (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R3. The home").
   One GET of /api/admin/metrics, rendered in the page language; the answer brings every indicator's words (texts), the
   lead row (lead) and the rows of "Seguimiento" (tracked), so this file holds only its own chrome as [en, es, pt] rows.
   A language change re-renders the held answer and never asks again. Today's reading is sent once per Lima day of the
   page view, only after a complete answer whose day has none. DOM built with createElement/textContent only. */
(() => {
  const el = {
    title: document.getElementById('homeTitle'),
    asOf: document.getElementById('homeAsOf'),
    refresh: document.getElementById('homeRefresh'),
    windows: document.getElementById('homeWindows'),
    status: document.getElementById('homeStatus'),
    retry: document.getElementById('homeRetry'),
    signIn: document.getElementById('homeSignIn'),
    csv: document.getElementById('homeCsv'),
    print: document.getElementById('homePrint'),
    lead: document.getElementById('homeLead'),
    pending: document.getElementById('homePending'),
    blocks: document.getElementById('homeBlocks'),
    tracking: document.getElementById('homeTracking'),
    readingsCsv: document.getElementById('homeReadingsCsv'),
    monthsCsv: document.getElementById('homeMonthsCsv'),
    printHead: document.getElementById('homePrintHead'),
  };
  if (!el.blocks || !el.tracking || !el.lead) return;

  const LANGS = ['en', 'es', 'pt'];
  const CHROME = {
    title: ['NODAL metrics', 'Indicadores de NODAL', 'Indicadores da NODAL'],
    skip: ['Skip to content', 'Saltar al contenido', 'Pular para o conteúdo'],
    loading: ['Loading…', 'Cargando…', 'Carregando…'],
    csv: ['Download CSV', 'Descargar CSV', 'Baixar CSV'],
    print: ['Print or save as PDF', 'Imprimir o guardar como PDF', 'Imprimir ou salvar como PDF'],
    asOf: ['Data as of {when} (Lima time)', 'Datos al {when} (hora de Lima)', 'Dados de {when} (hora de Lima)'],
    refresh: ['Refresh', 'Actualizar', 'Atualizar'],
    last7: ['Last 7 days: {range}', 'Últimos 7 días: {range}', 'Últimos 7 dias: {range}'],
    last30: ['Last 30 days: {range}', 'Últimos 30 días: {range}', 'Últimos 30 dias: {range}'],
    noNew: ['{n} days without new accounts (last: {day})', '{n} días sin cuentas nuevas (última: {day})', '{n} dias sem contas novas (última: {day})'],
    noNewOne: ['1 day without new accounts (last: {day})', '1 día sin cuentas nuevas (última: {day})', '1 dia sem contas novas (última: {day})'],
    pending: ['Needs attention', 'Por atender', 'Para atender'],
    team: ['includes {n} from the team', 'incluye {n} del equipo', 'inclui {n} da equipe'],
    howCounted: ['How it is counted', 'Cómo se cuenta', 'Como se conta'],
    limits: ['Limits', 'Límites', 'Limites'],
    tracking: ['Tracking', 'Seguimiento', 'Acompanhamento'],
    readOn: ['read on day {day}', 'leído el {day}', 'lido no dia {day}'],
    olderDefs: ['read with earlier definitions', 'leído con definiciones anteriores', 'lido com definições anteriores'],
    readingsSince: ['Readings since {month}.', 'Lecturas desde {month}.', 'Leituras desde {month}.'],
    noReadings: ['No reading has been saved yet.', 'Aún no hay lecturas guardadas.', 'Ainda não há leituras salvas.'],
    readingsCsv: ['Download readings CSV', 'Descargar lecturas CSV', 'Baixar leituras CSV'],
    monthsCsv: ['Download monthly CSV', 'Descargar por mes CSV', 'Baixar por mês CSV'],
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
    total: ['Total', 'Total', 'Total'],
    d30: ['30 days', '30 días', '30 dias'],
    d7: ['7 days', '7 días', '7 dias'],
  };
  // Where a block or a waiting queue is worked on.
  const SEE = { festival: ['fiiu-admin.html', 'seeFestival'], courses: ['teaching.html', 'seeCourses'] };
  const PENDING = [['interests', 'activity.interests', 'admin.html#interests'], ['orgRequests', 'memberships.orgRequests', 'admin.html#nodes'], ['lab', 'festival.labApplications', 'fiiu-admin.html']];
  // The lists that count the last 30 days: their name says so, under tables that have a total and two windows.
  const D30_LISTS = new Set(['activity.kinds', 'visits.topPages', 'visits.sources', 'memberships.views']);
  const FIELDS = ['total', 'd30', 'd7'];
  const WINDOWED = /^(.+)\.(d30|d7)$/;

  const lang = () => (LANGS.includes(document.documentElement.lang) ? document.documentElement.lang : 'en');
  const say = (row, vars = {}) => CHROME[row][LANGS.indexOf(lang())].replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  const own = (object, key) => object != null && Object.hasOwn(object, key);
  const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  // Lima dates: a day is read at noon UTC, which is 07:00 in Lima the same day.
  const noon = (day) => Date.parse(`${day}T12:00:00Z`);
  const dates = (options) => new Intl.DateTimeFormat(lang(), { timeZone: 'America/Lima', ...options });
  const fullDay = (day) => dates({ day: 'numeric', month: 'short', year: 'numeric' }).format(noon(day));
  const shortDay = (day) => dates({ day: 'numeric', month: 'short' }).format(noon(day));
  const monthYear = (month) => dates({ month: 'short', year: 'numeric' }).format(noon(`${month}-15`));
  const monthOnly = (month) => (month.endsWith('-01') ? monthYear(month) : dates({ month: 'short' }).format(noon(`${month}-15`)));
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
  let downloadFailed = false;
  let details = [];
  let openBeforePrint = null;

  const words = () => answer.texts[lang()] ?? answer.texts.en;
  const indicators = () => new Map(answer.families.flatMap((family) => family.indicators).map((ind) => [ind.key, ind]));
  const nameOf = (key) => words().indicators[key]?.name ?? key;
  const withField = (key, field) => (field === 'total' ? nameOf(key) : `${nameOf(key)} · ${say(field)}`);
  const separator = () => make('span', 'home-sep', ' · ');
  // Visit figures while the counter is younger than the window they are printed under.
  const visitFamily = (key) => answer.families.some((family) => family.key === 'visits' && family.indicators.some((ind) => ind.key === key));
  const youngCounter = (field) => typeof answer.visitsSince === 'string' && own(answer.windows, field) && answer.visitsSince > answer.windows[field].from;

  // The words for a state; visits not yet counted name their first day, or say none is counted yet.
  function reason(state) {
    const states = words().states;
    if (state === 'not_yet_counted') return answer.visitsSince ? states.not_yet_counted.replace('{day}', fullDay(answer.visitsSince)) : states.no_visits_yet;
    return own(states, state) ? states[state] : states.unavailable;
  }

  // A figure: a zero prints as 0 in muted ink; anything that is not a number prints as a dash.
  function figure(value) {
    if (isNum(value)) return make('span', value === 0 ? 'home-num is-zero' : 'home-num', number(value));
    return make('span', 'home-num home-dash', '—');
  }

  // The saved-figures key rule: <key> is the total, <key>.d30 and <key>.d7 the windows. An indicator with a state has none.
  function valueOf(map, key) {
    const windowed = WINDOWED.exec(key);
    const [base, field] = map.has(key) || !windowed ? [key, 'total'] : [windowed[1], windowed[2]];
    const ind = map.get(base);
    return ind && !ind.state && isNum(ind[field]) ? ind[field] : undefined;
  }
  function trackedName(key) {
    const windowed = WINDOWED.exec(key);
    return own(words().indicators, key) || !windowed ? nameOf(key) : withField(windowed[1], windowed[2]);
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
    for (const [node, row] of [[el.csv, 'csv'], [el.print, 'print'], [el.refresh, 'refresh'], [el.retry, 'retry'], [el.readingsCsv, 'readingsCsv'], [el.monthsCsv, 'monthsCsv'], [el.printHead, 'printHead'], [el.signIn, 'signIn']]) {
      if (node) node.textContent = say(row);
    }
    paintStatus();
  }

  function renderHead() {
    el.asOf.textContent = say('asOf', { when: dates({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(Date.parse(answer.asOf)) });
    const lines = [make('span', '', say('last7', { range: range(answer.windows.d7) })), make('span', '', say('last30', { range: range(answer.windows.d30) }))];
    const latest = answer.families.flatMap((family) => family.indicators).find((ind) => isNum(ind.daysSince));
    if (latest && !latest.state && latest.daysSince > 0 && latest.last) lines.push(make('span', '', say(latest.daysSince === 1 ? 'noNewOne' : 'noNew', { n: number(latest.daysSince), day: shortDay(latest.last) })));
    el.windows.replaceChildren(...lines);
  }

  function leadLine(map, key, field, className) {
    const ind = map.get(key) ?? { state: 'unavailable' };
    const line = make('span', className);
    line.append(figure(ind.state ? undefined : ind[field]), ' ', make('span', 'home-lead-name', withField(key, field)));
    if (ind.state) line.append(' ', make('span', 'home-reason', reason(ind.state)));
    // A visit figure never stands under "30 días" or "7 días" without the day its count began.
    else if (visitFamily(key) && youngCounter(field)) line.append(' ', make('span', 'home-reason', reason('not_yet_counted')));
    return line;
  }

  function renderLead() {
    const map = indicators();
    el.lead.replaceChildren(...(Array.isArray(answer.lead) ? answer.lead : []).map(({ key, field, second }) => {
      const group = make('span', 'home-lead-item');
      group.dataset.key = key;
      group.append(leadLine(map, key, field, 'home-lead-main'), ...(Array.isArray(second) ? second : []).map(([k, f]) => leadLine(map, k, f, 'home-lead-second')));
      return group;
    }));
  }

  function renderPending() {
    const pending = answer.pending ?? {};
    const links = PENDING.filter(([field]) => isNum(pending[field])).map(([field, key, href]) => {
      const link = make('a', 'home-pending-link');
      link.href = href;
      link.append(figure(pending[field]), ' ', make('span', '', `${nameOf(key)} →`));
      const item = make('span', 'home-item');
      item.append(link);
      return item;
    });
    el.pending.replaceChildren(make('span', 'home-pending-name', say('pending')), ' ', ...links.flatMap((link, i) => (i ? [separator(), link] : [link])));
    el.pending.hidden = links.length === 0;
  }

  function itemLabel(ind, item) {
    const lists = words().lists;
    if (own(item, 'text')) return String(item.text);
    if (own(lists.reserved, item.key)) return lists.reserved[item.key];
    if (ind.vocabulary && own(lists[ind.vocabulary], item.key)) return lists[ind.vocabulary][item.key];
    if (own(answer.courseNames, item.key)) return answer.courseNames[item.key];
    return String(item.key);
  }

  // Label, a real space, number; a real " · " between items, so copied text and screen readers get them apart.
  function items(list) {
    return list.flatMap(({ label, n }, i) => {
      const item = make('span', 'home-item');
      item.append(make('span', '', label), ' ', figure(n));
      return i ? [separator(), item] : [item];
    });
  }

  function definitions(family, wasOpen) {
    const box = make('details', 'home-how');
    box.dataset.family = family.key;
    box.open = wasOpen;
    box.append(make('summary', '', say('howCounted')));
    for (const ind of family.indicators) {
      const text = words().indicators[ind.key];
      if (!text) continue;
      const entry = make('div', 'home-def');
      entry.append(make('h3', 'home-def-name', text.name), make('p', '', text.definition), make('p', 'home-def-source', text.source), make('p', 'home-def-caveat', `${say('limits')}: ${text.caveat}`));
      box.append(entry);
    }
    details.push(box);
    return box;
  }

  function block(family, opened) {
    const section = make('section', 'home-block');
    section.dataset.family = family.key;
    const head = make('div', 'home-block-head');
    const title = make('h2', 'home-block-title', words().families[family.key] ?? family.key);
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
    for (const note of notes) section.append(make('p', 'home-note', note));

    const rows = family.indicators.filter((ind) => ind.state || FIELDS.some((f) => isNum(ind[f])));
    const columns = FIELDS.filter((f) => family.indicators.some((ind) => isNum(ind[f])));
    if (rows.length) {
      const table = make('table', 'home-table');
      table.setAttribute('aria-labelledby', title.id);
      const headRow = make('tr');
      headRow.append(make('th', 'home-corner'), ...columns.map((f) => { const th = make('th', '', say(f)); th.setAttribute('scope', 'col'); return th; }));
      const thead = make('thead');
      thead.append(headRow);
      const tbody = make('tbody');
      for (const ind of rows) {
        const row = make('tr');
        row.dataset.key = ind.key;
        const name = make('th', '', nameOf(ind.key));
        name.setAttribute('scope', 'row');
        // The team's own rows inside a figure that is not filtered (the festival's registrations).
        if (!ind.state && isNum(ind.team) && ind.team > 0) name.append(' ', make('span', 'home-reason', `(${say('team', { n: number(ind.team) })})`));
        row.append(name);
        if (ind.state) {
          const cell = make('td', 'home-failed');
          cell.setAttribute('colspan', String(Math.max(columns.length, 1)));
          cell.append(figure(undefined));
          if (!once(ind)) cell.append(make('span', 'home-reason', reason(ind.state)));
          row.append(cell);
        } else {
          for (const f of columns) {
            const cell = make('td');
            cell.dataset.label = say(f);
            if (isNum(ind[f])) cell.append(figure(ind[f]));
            row.append(cell);
          }
        }
        tbody.append(row);
      }
      table.append(thead, tbody);
      section.append(table);
    }

    // Lists: a course list only when there is more than one course (one course repeats the total).
    for (const ind of family.indicators) {
      if (ind.state || !Array.isArray(ind.items)) continue;
      if (isNum(ind.total) && ind.items.length < 2) continue;
      const line = make('p', 'home-list');
      line.dataset.list = ind.key;
      line.append(make('span', 'home-list-name', D30_LISTS.has(ind.key) ? withField(ind.key, 'd30') : nameOf(ind.key)), ' ');
      // An empty list is a zero, never a bare name.
      if (ind.items.length) line.append(...items(ind.items.map((item) => ({ label: itemLabel(ind, item), n: item.n }))));
      else line.append(figure(0));
      // The Founders and payment page views, outside the Visitas block, carry the counter's first day themselves.
      if (ind.key === 'memberships.views' && youngCounter('d30')) line.append(' ', make('span', 'home-reason', reason('not_yet_counted')));
      section.append(line);
    }
    section.append(definitions(family, opened.has(family.key)));
    return section;
  }

  function renderBlocks() {
    const opened = new Set(details.filter((box) => box.open).map((box) => box.dataset.family));
    details = [];
    el.blocks.replaceChildren(...answer.families.map((family) => block(family, opened)));
  }

  // Every failed part, in the order of the parts' labels (the server's READING_PARTS), joined with a comma.
  function failedParts() {
    const parts = words().parts;
    const failed = new Set([...answer.unavailable.map((entry) => entry.part), ...answer.notActivated]);
    return Object.keys(parts).filter((part) => failed.has(part)).map((part) => parts[part]);
  }

  function seriesLines() {
    const series = answer.months?.series ?? {};
    const labels = words().series ?? {};
    return Object.keys(labels).filter((name) => own(series, name)).map((name) => {
      const values = series[name];
      const line = make('p', 'home-series');
      line.dataset.series = name;
      line.append(make('span', 'home-list-name', labels[name]), ' ');
      const months = Object.keys(values).filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();
      if (values.state || !months.length) {
        line.append(figure(undefined), make('span', 'home-reason', reason(values.state ?? 'not_yet_counted')));
      } else {
        line.append(...items(months.map((month) => ({ label: monthOnly(month), n: values[month] }))));
      }
      return line;
    });
  }

  function renderTracking() {
    const readings = answer.readings;
    const months = readings.months;
    const tracked = Array.isArray(answer.tracked) ? answer.tracked : [];
    const parts = [make('h2', 'home-block-title', say('tracking'))];
    if (months.length && tracked.length) {
      const headRow = make('tr');
      headRow.append(make('th', 'home-corner'));
      for (const reading of months) {
        const th = make('th');
        th.setAttribute('scope', 'col');
        th.dataset.month = reading.month;
        th.append(make('span', 'home-month', monthYear(reading.month)), make('span', 'home-read-on', say('readOn', { day: Number(String(reading.day).slice(8, 10)) })));
        if (isNum(reading.defs) && isNum(answer.defs) && reading.defs < answer.defs) th.append(make('span', 'home-read-on', say('olderDefs')));
        headRow.append(th);
      }
      const thead = make('thead');
      thead.append(headRow);
      const tbody = make('tbody');
      for (const key of tracked) {
        const row = make('tr');
        row.dataset.key = key;
        const name = make('th', '', trackedName(key));
        name.setAttribute('scope', 'row');
        row.append(name);
        for (const reading of months) {
          const cell = make('td');
          cell.dataset.label = monthYear(reading.month);
          // A reading saved before a key existed leaves its cell blank, never 0.
          if (own(reading.figures, key) && isNum(reading.figures[key])) cell.append(figure(reading.figures[key]));
          row.append(cell);
        }
        tbody.append(row);
      }
      const table = make('table', 'home-table home-tracking-table');
      table.append(thead, tbody);
      const scroller = make('div', 'home-scroll');
      // A wide table scrolls sideways: reachable and named for the keyboard.
      scroller.setAttribute('tabindex', '0');
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', say('tracking'));
      scroller.append(table);
      parts.push(scroller);
    }
    if (months.length) parts.push(make('p', 'home-note', say('readingsSince', { month: monthYear(months[0].month) })));
    if (!readings.today) {
      const failed = failedParts();
      if (failed.length) parts.push(make('p', 'home-note', say('notSaved', { part: failed.join(', ') })));
      else if (!months.length) parts.push(make('p', 'home-note', say('noReadings')));
    }
    parts.push(...seriesLines());
    el.tracking.replaceChildren(...parts);
    if (el.readingsCsv) el.readingsCsv.hidden = months.length === 0;
  }

  function render() {
    paintChrome();
    renderHead();
    renderLead();
    renderPending();
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
      downloadFailed = false;
      el.retry.hidden = true;
      el.signIn.hidden = true;
      render();
      saveReading();
      return;
    }
    const row = rowFor(outcome);
    downloadFailed = false;
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

  async function download(button, table) {
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const res = await fetch(`/api/admin/metrics/export?table=${table}&lang=${lang()}`, { credentials: 'same-origin' });
      if (!res.ok) { downloadFailed = true; report(rowFor(res.status)); return; }
      // What an earlier failed download said no longer holds.
      if (downloadFailed) { downloadFailed = false; report(''); }
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
      downloadFailed = true;
      report('failed');
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
  // A stylesheet cannot open a closed <details> in every browser: open them all for print, then put each back.
  window.addEventListener('beforeprint', () => {
    openBeforePrint = details.map((box) => box.open);
    for (const box of details) box.open = true;
  });
  window.addEventListener('afterprint', () => {
    if (openBeforePrint) details.forEach((box, i) => { box.open = openBeforePrint[i] ?? false; });
    openBeforePrint = null;
  });

  paintChrome();
  load(false);
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(() => {
    if (answer) render();
    else paintChrome();
  }), { once: true });
})();
