/* NODAL member console.
   The authenticated API user drives every field: identity, roles, trust ladder,
   route spine, paths, recognition, completeness, timeline. State persists in the
   server database. Every user-facing string goes through t() so the language
   chosen at sign-in carries through. All DOM is createElement/textContent —
   no HTML injection. */
(() => {
  'use strict';

  /* ================= i18n ================= */
  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const localeTag = () => ({ en: 'en-GB', es: 'es-ES', pt: 'pt-BR' }[I18N?.lang] ?? 'en-GB');

  /* ================= persisted state ================= */
  const DEFAULT_PART_C = { bio: '', linkedin: '', portfolio: '', references: '', availability: '', consent: false };
  const DEFAULT_INDICATORS = { leadership: 'No', transmission: 'No' };
  const state = { user: null, notifRead: false };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (res.status === 401) {
      location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`);
      throw new Error('authentication required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `api ${res.status}`);
    return data;
  }

  function normalizeApiUser(user) {
    const partC = { ...DEFAULT_PART_C, ...(user.partC || {}) };
    return {
      kind: 'member',
      id: user.id,
      name: user.fullName || user.name || '',
      role: user.title || user.role || 'Member',
      city: user.city || '',
      active: Array.isArray(user.active) ? user.active : [],
      assessed: Boolean(user.assessed),
      topics: Array.isArray(user.topics) ? user.topics : [],
      skills: Array.isArray(user.skills) ? user.skills : [],
      indicators: { ...DEFAULT_INDICATORS, ...(user.indicators || {}) },
      partC,
      requests: user.requests && typeof user.requests === 'object' ? user.requests : {},
      mentorApplied: Boolean(user.mentorApplied),
      notifRead: Boolean(user.notifRead),
    };
  }

  function serializeUser(user) {
    return {
      fullName: user.name,
      title: user.role,
      city: user.city,
      interests: user.topics.map((t2) => String(t2.name || t2).toLowerCase()).filter(Boolean),
      active: user.active,
      topics: user.topics,
      skills: user.skills,
      indicators: user.indicators,
      partC: user.partC,
      requests: user.requests,
      mentorApplied: user.mentorApplied,
      assessed: user.assessed,
      notifRead: state.notifRead,
    };
  }

  /* ================= model ================= */
  const LEVEL_KEYS = ['d.level.1', 'd.level.2', 'd.level.3', 'd.level.4'];
  const levelName = (level) => t(LEVEL_KEYS[Math.min(Math.max(level, 1), 4) - 1]);
  /* The stored topic name is the canonical English one — it is the join key for
     interests, matching and saved levels. Only the label is translated. */
  const TOPIC_KEYS = new Map([
    ['Mobility', 'mobility'], ['Public space', 'publicSpace'], ['Housing', 'housing'],
    ['Climate & resilience', 'climate'], ['Care & gender', 'care'],
    ['Governance & participation', 'governance'], ['Safety', 'safety'],
    ['Informality', 'informality'], ['Heritage', 'heritage'],
    ['Urban data & tech', 'urbanData'], ['Land use & planning', 'landUse'],
    ['Environment & nature', 'environment'],
  ]);
  const TAXONOMY = [...TOPIC_KEYS.keys()];
  const topicLabel = (name) => (TOPIC_KEYS.has(name) ? t(`d.topic.${TOPIC_KEYS.get(name)}`) : name);
  const blankPartC = () => ({ bio: '', linkedin: '', portfolio: '', references: '', availability: '', consent: false });
  const makeTopic = (name, level = 1) => ({ name, level, validatedAt: 0, endorsedAt: 0 });
  const cleanCity = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const cleanRole = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  function newUser(name, city, role, topicNames) {
    return {
      kind: 'member',
      name, role, city,
      assessed: false,
      topics: topicNames.map((n) => makeTopic(n)),
      skills: [],
      indicators: { leadership: 'No', transmission: 'No' },
      partC: blankPartC(),
      requests: {}, mentorApplied: false,
    };
  }

  let U = null;
  const maxLevel = () => Math.max(0, ...U.topics.map((x) => x.level));
  const cityLabel = () => U.city || t('d.sheet.cityPending');

  function setUser(user, persist = true) {
    U = user;
    if (persist) { state.user = user; touchUser(); }
    applyAll();
  }
  /* Every edit fires its own PATCH without waiting for the last one, so two
     quick changes are in flight together and the answers can land in either
     order. Only the newest save is allowed to write its answer back — an
     earlier, slower one would otherwise put the pre-edit state on screen while
     the server holds the newer one, and the two would disagree until reload. */
  let saveSeq = 0;
  async function saveProfile() {
    if (!U) return;
    const seq = saveSeq + 1;
    saveSeq = seq;
    const data = await api('/api/me', { method: 'PATCH', body: JSON.stringify(serializeUser(U)) });
    if (seq !== saveSeq) return;
    U = normalizeApiUser(data.user);
    state.user = U;
    state.notifRead = U.notifRead;
  }
  /* A failed PATCH used to be swallowed: the change stayed on screen and never
     reached the server, which reads exactly like success. Now it says so. */
  function reportSave(ok, retrying) {
    const box = document.getElementById('saveAlert');
    if (!box) return;
    if (ok) { box.hidden = true; return; }
    setText('saveAlertText', t(retrying ? 'd.save.stillFailing' : 'd.save.failed'));
    setText('saveRetry', t('d.save.retry'));
    box.hidden = false;
  }
  function touchUser() {
    if (state.user) state.user = U;
    saveProfile().then(() => reportSave(true)).catch(() => reportSave(false));
  }

  const stageOf = (x) => (x.validatedAt >= x.level ? 'validated' : x.endorsedAt >= x.level ? 'endorsed' : 'self');
  const stageName = (stage) => t(`d.stage.${stage}`);

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const byId = (id) => document.getElementById(id);
  const setText = (id, text) => { const node = byId(id); if (node) node.textContent = text; };

  /* ================= identity + title block ================= */
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  function renderIdentity() {
    const hour = new Date().getHours();
    setText('greetWord', t(hour < 12 ? 'd.greet.morning' : hour < 18 ? 'd.greet.afternoon' : 'd.greet.evening'));
    setText('userName', U.name);
    setText('sheetCity', cityLabel());
    setText('sheetRole', U.role);
    setText('metaTopics', String(U.topics.length));
    setText('metaLevel', U.assessed && maxLevel() > 0 ? levelName(maxLevel()) : t('d.meta.levelNone'));
    const avatar = byId('userBtn');
    if (avatar) avatar.textContent = initials(U.name);
    setText('greetSub', t(U.assessed ? 'd.greet.subAssessed' : 'd.greet.subNew'));

    const liChip = byId('userLinkedIn');
    const liText = byId('userLinkedInText');
    if (liChip && liText) {
      const url = U.partC?.linkedin ?? '';
      const safe = /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/.test(url);
      liChip.hidden = !safe;
      if (safe) {
        liChip.href = url;
        const m = url.match(/linkedin\.com\/((?:in|company)\/[A-Za-z0-9_-]+)/);
        liText.textContent = m ? m[1] : 'LinkedIn';
      }
    }
  }

  /* ================= route spine =================
     The member's actual sequence through the network. Every stop is a control
     that opens the work it describes. */
  function spineStops() {
    const partCount = partCCount();
    const mentorReady = U.assessed && maxLevel() >= 3 && U.indicators.transmission !== 'No';
    // the API returns every branch key, most of them false — count real ones
    const roleRequested = Object.values(U.requests).some(Boolean) || U.mentorApplied;
    return [
      {
        label: t('d.spine.profile'),
        meta: t('d.spine.profileMeta'),
        done: true,
        go: () => openUserDialog(),
      },
      {
        label: t('d.spine.assess'),
        meta: t(U.assessed ? 'd.spine.assessDone' : 'd.spine.assessTodo'),
        done: U.assessed,
        go: () => goTo('assessment'),
      },
      {
        label: t('d.spine.depth'),
        meta: partCDone() ? t('d.spine.depthDone') : t('d.spine.depthCount', { n: partCount, total: partCTotal }),
        done: partCDone(),
        go: () => openPartC(),
      },
      {
        label: t('d.spine.contribution'),
        meta: t('d.spine.contributionMeta'),
        done: false,
        go: () => goTo('badges'),
      },
      {
        label: t('d.spine.role'),
        meta: t(roleRequested ? 'd.spine.roleReview' : mentorReady ? 'd.spine.roleOpen' : 'd.spine.roleLocked'),
        done: false,
        go: () => goTo('growth'),
      },
    ];
  }

  function renderSpine() {
    const host = byId('spineStops');
    const fill = byId('spineFill');
    if (!host) return;
    const stops = spineStops();
    // you are at the first stop that is not done yet
    const at = stops.findIndex((s) => !s.done);
    const now = at === -1 ? stops.length - 1 : at;

    host.replaceChildren(...stops.map((stop, i) => {
      const li = document.createElement('li');
      const btn = el('button', 'stop');
      btn.type = 'button';
      if (stop.done) btn.classList.add('is-done');
      if (i === now) btn.classList.add('is-now');
      const mark = el('span', 'stop-mark');
      mark.setAttribute('aria-hidden', 'true');
      const text = el('span', 'stop-text');
      text.append(el('b', null, stop.label), el('em', null, stop.meta));
      btn.append(mark, text);
      btn.addEventListener('click', stop.go);
      li.appendChild(btn);
      return li;
    }));

    // the drawn line runs from the first stop to where you are now
    if (fill) {
      const span = Math.max(stops.length - 1, 1);
      fill.style.setProperty('--spine-pct', `${Math.round((now / span) * 100)}%`);
    }
    host.setAttribute('aria-label', t('d.spine.aria', { n: now + 1, total: stops.length }));
  }

  const calmly = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function goTo(id) {
    const target = byId(id);
    // scrollIntoView's behavior option wins over the stylesheet's opt-out
    if (target) target.scrollIntoView({ behavior: calmly() ? 'auto' : 'smooth', block: 'start' });
  }

  /* ================= roles ================= */
  function userRoles() {
    const roles = [{ label: t('d.role.member'), scope: t('d.role.memberScope'), cls: 'r-validated' }];
    roles.push({ label: t('d.role.contributor'), scope: t('d.role.contributorScope'), cls: 'r-path' });
    if (U.assessed && maxLevel() >= 3 && U.indicators.transmission !== 'No') {
      roles.push({ label: t('d.role.mentor'), scope: t('d.role.mentorScope'), cls: 'r-path' });
    } else if (U.assessed && maxLevel() >= 2) {
      const top = U.topics.find((x) => x.level === maxLevel());
      roles.push({ label: t('d.role.practitioner'), scope: t('d.role.practitionerScope', { topic: topicLabel(top.name) }), cls: 'r-path' });
    }
    return roles;
  }

  function renderRoles() {
    const list = byId('roleList');
    if (!list) return;
    const roles = userRoles();
    list.replaceChildren(...roles.map((r) => {
      const li = document.createElement('li');
      li.append(el('span', `role-pill ${r.cls}`, r.label), el('span', 'role-scope', r.scope));
      return li;
    }));
    setText('standingEyebrow', t('d.eyebrow.standing', { n: roles.length }));
  }

  /* ================= trust ladder ================= */
  function renderTrust() {
    const list = byId('trustList');
    if (!list) return;
    const groups = [[t('d.trust.topics'), U.topics]];
    if (U.skills.length) groups.push([t('d.trust.skills'), U.skills]);
    const items = [];
    groups.forEach(([title, entries]) => {
      const cap = document.createElement('li');
      cap.className = 't-group';
      cap.textContent = title;
      items.push(cap);
      entries.forEach((topic) => {
        const row = document.createElement('li');
        const stage = stageOf(topic);
        const dots = el('span', 't-dots');
        dots.setAttribute('aria-label', t('d.trust.aria', { n: topic.level, stage: stageName(stage) }));
        for (let i = 1; i <= 4; i += 1) {
          const dot = document.createElement('i');
          dot.className = i <= topic.validatedAt ? 'f' : i <= topic.endorsedAt ? 'h' : i <= topic.level ? 'd' : 'o';
          dots.appendChild(dot);
        }
        row.append(
          el('span', 't-name', topicLabel(topic.name)),
          dots,
          el('span', `t-level tag-${stage}`, `${levelName(topic.level)} · ${stageName(stage)}`),
        );
        items.push(row);
      });
    });
    list.replaceChildren(...items);
  }

  /* ================= activity =================
     The API has no contribution feed yet, so the plot shows what is true:
     six empty slots waiting for a first action. */
  const CONTRIBUTIONS = [0, 0, 0, 0, 0, 0];
  const SVGNS = 'http://www.w3.org/2000/svg';
  // palette lives in the stylesheet; the plot reads it rather than repeating it
  const brand = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#3d5c38';
  const svgEl = (tag, attrs) => {
    const node = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  function renderActivity() {
    const stats = byId('activityStats');
    if (stats) {
      const rows = [
        { n: '0', label: t('d.activity.actions') },
        { n: '0', label: t('d.activity.resources') },
        { n: '0', label: t('d.activity.streak') },
      ];
      stats.replaceChildren(...rows.map((row) => {
        const wrap = el('div', `stat${row.n === '0' ? ' is-zero' : ''}`);
        wrap.append(el('span', 'stat-n', row.n), el('span', 'stat-l', row.label));
        return wrap;
      }));
    }

    const plot = byId('activityPlot');
    if (plot) {
      const W = 280;
      const H = 74;
      const base = H - 2;
      const peak = Math.max(1, ...CONTRIBUTIONS);
      const slot = W / CONTRIBUTIONS.length;
      const ink = brand('--forest');
      const accent = brand('--green');
      const nodes = [svgEl('line', {
        x1: 0, y1: base, x2: W, y2: base, stroke: ink, 'stroke-width': 1.5, opacity: '.45',
      })];
      CONTRIBUTIONS.forEach((value, i) => {
        const height = value === 0 ? 3 : Math.round((value / peak) * (H - 14));
        nodes.push(svgEl('rect', {
          x: (i * slot + slot * 0.28).toFixed(1),
          y: (base - height).toFixed(1),
          width: (slot * 0.44).toFixed(1),
          height: String(height),
          fill: value === 0 ? ink : accent,
          opacity: value === 0 ? '.22' : '1',
        }));
      });
      plot.replaceChildren(...nodes);
      plot.setAttribute('aria-label', t('d.activity.aria'));
    }

    const axis = byId('plotAxis');
    if (axis) {
      const fmt = new Intl.DateTimeFormat(localeTag(), { month: 'short' });
      const now = new Date();
      const months = [];
      for (let i = CONTRIBUTIONS.length - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(el('span', null, fmt.format(d).replace('.', '')));
      }
      axis.replaceChildren(...months);
    }

    const note = byId('plotNote');
    if (note) {
      const link = el('a', null, t('d.activity.emptyCta'));
      link.href = '#badges';
      note.replaceChildren(`${t('d.activity.empty')} `, link);
    }
  }

  /* ================= mentoring ================= */
  function renderMentorCard() {
    setText('mentorHours', '00:00');
    setText('mentorMentees', '0');
    const qualifies = U.assessed && maxLevel() >= 3 && U.indicators.transmission !== 'No';
    setText('mentorNote', t(qualifies ? 'd.mentor.ready' : 'd.mentor.notYet'));
    const cta = byId('mentorCta');
    if (cta) cta.textContent = t(U.assessed ? 'd.mentor.ctaReview' : 'd.mentor.ctaStart');
  }

  /* ================= community paths ================= */
  function branchDefs() {
    const teaches = U.indicators.transmission !== 'No';
    const top = U.topics.find((x) => x.level === maxLevel());
    const city = cityLabel();
    const mentorReady = U.assessed && maxLevel() >= 3 && teaches;
    return {
      knowledge: {
        route: t('d.br.knowledge.route'),
        stateLabel: t(mentorReady ? 'd.br.knowledge.stateReady' : 'd.br.knowledge.stateOpen'),
        stateCls: mentorReady ? 'st-ready' : 'st-next',
        kicker: t('d.br.knowledge.kicker'),
        title: t('d.br.knowledge.title'),
        now: t('d.br.now', { role: t('d.role.member') }),
        criteria: [
          { label: t('d.br.knowledge.c1'), done: U.assessed && maxLevel() >= 3 },
          { label: t('d.br.knowledge.c2'), done: U.assessed && teaches },
          { label: t('d.br.knowledge.c3'), done: U.partC.availability !== '' },
          { label: t('d.br.knowledge.c4'), done: U.partC.references !== '' },
        ],
        unlock: t('d.br.knowledge.unlock'),
        cta: t('d.br.knowledge.cta'),
        requested: t('d.br.knowledge.sent'),
      },
      project: {
        route: t('d.br.project.route'),
        stateLabel: null, stateCls: null,
        kicker: t('d.br.project.kicker'),
        title: t('d.br.project.title'),
        now: t('d.br.now', { role: t('d.role.member') }),
        criteria: [
          { label: t('d.br.project.c1'), done: U.assessed && maxLevel() >= 2 },
          { label: t('d.br.project.c2'), done: U.partC.portfolio !== '' || U.partC.linkedin !== '' },
          { label: t('d.br.project.c3'), done: partCDone() },
          { label: t('d.br.project.c4'), done: false },
        ],
        unlock: top ? t('d.br.project.unlockTopic', { topic: topicLabel(top.name) }) : t('d.br.project.unlock'),
        cta: t('d.br.project.cta'),
        requested: t('d.br.project.sent'),
      },
      territory: {
        route: t('d.br.territory.route'),
        stateLabel: t('d.br.territory.state'), stateCls: 'st-next',
        kicker: t('d.br.territory.kicker'),
        title: t('d.br.territory.title', { city }),
        now: t('d.br.now', { role: t('d.role.member') }),
        criteria: [
          { label: t('d.br.territory.c1', { city }), done: U.city !== '' },
          { label: t('d.br.territory.c2'), done: false },
          { label: t('d.br.territory.c3'), done: false },
        ],
        unlock: t('d.br.territory.unlock'),
        cta: t('d.br.territory.cta'),
        requested: t('d.br.territory.sent'),
      },
      community: {
        route: t('d.br.community.route'),
        stateLabel: t('d.br.community.state', { n: 0 }), stateCls: 'st-next',
        kicker: t('d.br.community.kicker'),
        title: t('d.br.community.title'),
        now: t('d.br.now', { role: t('d.role.member') }),
        criteria: [
          { label: t('d.br.community.c1', { n: 0 }), done: false },
          { label: t('d.br.community.c2', { n: 0 }), done: false },
        ],
        unlock: t('d.br.community.unlock'),
        cta: t('d.br.community.cta'),
      },
    };
  }

  let currentBranch = 'knowledge';
  const pd = {
    kicker: byId('pdKicker'),
    title: byId('pdTitle'),
    now: byId('pdNow'),
    criteria: byId('pdCriteria'),
    unlock: byId('pdUnlock'),
    cta: byId('pdCta'),
  };

  function showBranch(key) {
    const b = branchDefs()[key];
    if (!b || !pd.criteria) return;
    currentBranch = key;
    pd.kicker.textContent = b.kicker;
    pd.title.textContent = b.title;
    pd.now.textContent = b.now;
    pd.unlock.textContent = b.unlock;
    pd.criteria.replaceChildren(...b.criteria.map((c) => {
      const li = el('li', c.done ? 'done' : null, c.label);
      return li;
    }));
    pd.cta.disabled = false;
    pd.cta.classList.remove('is-sent');
    if (U.requests[key]) {
      // an already-submitted request stays acknowledged, even if Part C later
      // gains new fields and drops below "complete"
      pd.cta.textContent = b.requested ?? t('d.common.done');
      pd.cta.classList.add('is-sent');
      pd.cta.disabled = true;
    } else if (key === 'project' && !partCDone()) {
      pd.cta.textContent = t('d.path.completeFirst');
    } else {
      pd.cta.textContent = b.cta;
    }
  }

  function renderPaths() {
    const defs = branchDefs();
    let open = 0;
    document.querySelectorAll('#pathList .path-row').forEach((row) => {
      const def = defs[row.dataset.branch];
      if (!def) return;
      const em = row.querySelector('em');
      if (em) em.textContent = def.route;
      const pill = row.querySelector('.path-state');
      if (pill) {
        let label = def.stateLabel;
        let cls = def.stateCls;
        if (label === null) {           // practice: derived from remaining steps
          const remaining = def.criteria.filter((c) => !c.done).length;
          label = remaining === 0 ? t('d.path.ready')
            : remaining === 1 ? t('d.path.stepLeft')
              : t('d.path.stepsLeft', { n: remaining });
          cls = remaining === 0 ? 'st-ready' : 'st-next';
        }
        if (cls === 'st-ready') open += 1;
        pill.textContent = label;
        pill.className = `path-state ${cls}`;
      }
    });
    setText('pathsEyebrow', t('d.eyebrow.paths', { n: Object.keys(defs).length, ready: open }));
    showBranch(currentBranch);
  }

  const pathList = byId('pathList');
  if (pathList && pd.criteria && pd.cta) {
    pathList.querySelectorAll('.path-row').forEach((row) => {
      row.addEventListener('click', () => {
        pathList.querySelectorAll('.path-row').forEach((r) => r.classList.toggle('is-on', r === row));
        showBranch(row.dataset.branch);
      });
    });
    pd.cta.addEventListener('click', () => {
      if (currentBranch === 'project' && !partCDone()) { openPartC(); return; }
      if (currentBranch === 'community') { goTo('badges'); return; }
      U.requests[currentBranch] = true;
      touchUser();
      showBranch(currentBranch);
      renderSpine();
    });
  }

  /* ================= recognition ================= */
  function familyMark(fam) {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    const add = (tag, attrs) => svg.appendChild(svgEl(tag, attrs));
    if (fam === 'role') {
      add('line', { x1: 12.5, y1: 10.6, x2: 16, y2: 8.6, stroke: 'currentColor', 'stroke-width': 1.8 });
      add('circle', { cx: 9, cy: 12.5, r: 4.5, fill: 'currentColor' });
      add('circle', { cx: 17.5, cy: 7.8, r: 2.6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 });
    } else if (fam === 'recognition') {
      add('circle', { cx: 12, cy: 12, r: 3.6, fill: 'currentColor' });
      [[12, 4.5, 12, 7.5], [12, 16.5, 12, 19.5], [4.5, 12, 7.5, 12], [16.5, 12, 19.5, 12]].forEach(([x1, y1, x2, y2]) =>
        add('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    } else {
      add('line', { x1: 9, y1: 14.2, x2: 14.8, y2: 9.8, stroke: 'currentColor', 'stroke-width': 1.8 });
      add('circle', { cx: 7.2, cy: 15.8, r: 3, fill: 'currentColor' });
      add('circle', { cx: 16.8, cy: 8.2, r: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 });
    }
    return svg;
  }

  function badgeData() {
    const mentorReady = U.assessed && maxLevel() >= 3 && U.indicators.transmission !== 'No';
    const B = (fam, id, scope, state2) => ({
      fam,
      name: t(`d.badge.${id}.name`),
      scope,
      unlock: t(`d.badge.${id}.unlock`),
      state: state2,
    });
    return [
      B('contribution', 'pioneer', t(U.assessed ? 'd.badge.pioneer.scopeDone' : 'd.badge.pioneer.scopeTodo'), U.assessed ? 'earned' : 'progress'),
      B('contribution', 'first', t('d.badge.first.scope'), 'locked'),
      B('contribution', 'sharer', t('d.badge.sharer.scope', { n: 0 }), 'locked'),
      B('contribution', 'host', t('d.badge.host.scope'), 'locked'),
      B('contribution', 'connector', t('d.badge.connector.scope', { n: 0 }), 'locked'),
      B('contribution', 'graduate', t('d.badge.graduate.scope'), 'locked'),
      B('contribution', 'consistent', t('d.badge.consistent.scope', { n: 0 }), 'locked'),
      B('role', 'practitioner', t('d.badge.practitioner.scope'), 'locked'),
      B('role', 'mentor', t(mentorReady ? 'd.badge.mentor.scopeReady' : 'd.badge.mentor.scopeTodo'), mentorReady ? 'progress' : 'locked'),
      B('role', 'local', cityLabel(), 'locked'),
      B('recognition', 'founding', t('d.badge.founding.scope'), 'locked'),
    ];
  }

  function renderBadges() {
    const grid = byId('badgeGrid');
    if (!grid) return;
    const badges = badgeData();
    grid.replaceChildren(...badges.map((b) => {
      const tile = el('article', `badge is-${b.state}`);
      const top = el('div', 'badge-top');
      const ico = el('span', 'badge-ico');
      ico.appendChild(familyMark(b.fam));
      const famName = t(`d.badge.fam.${b.fam}`);
      const fam = el('span', 'badge-fam', b.state === 'locked' ? `${famName} · ${t('d.badge.locked')}`
        : b.state === 'progress' ? `${famName} · ${t('d.badge.progress')}` : famName);
      top.append(ico, fam);
      const name = el('h3', 'badge-name', b.name);
      name.appendChild(el('small', null, b.scope));
      const unlock = el('p', 'badge-unlock');
      unlock.append(el('strong', null, t('d.badge.opens')), b.unlock);
      tile.append(top, name, unlock);
      return tile;
    }));
    const earned = badges.filter((b) => b.state === 'earned').length;
    setText('badgesEyebrow', t('d.eyebrow.recognition', { n: earned, total: badges.length }));
  }

  /* ================= self-assessment ================= */
  function evaluateTrack() {
    const teaches = U.indicators.transmission !== 'No';
    const leads = U.indicators.leadership !== 'No';
    let key;
    if (!U.assessed) key = 'pending';
    else if (maxLevel() >= 3 && teaches) key = 'leader';
    else if (maxLevel() >= 3 && leads) key = 'specialist';
    else if (maxLevel() >= 2) key = 'practitioner';
    else key = 'learner';
    setText('trackName', t(`d.track.${key}.name`));
    setText('trackWhy', t(`d.track.${key}.why`));
    const fastTrack = byId('fastTrack');
    if (fastTrack) fastTrack.hidden = key !== 'leader';
  }

  function markAssessed() {
    if (!U.assessed) U.assessed = true;
    touchUser();
  }

  function renderAssessment() {
    const host = byId('assessTopics');
    if (!host) return;
    host.replaceChildren(...U.topics.map((topic) => {
      const wrap = el('div', 'assess-topic');
      const head = el('div', 'assess-head');
      head.append(
        el('strong', null, topicLabel(topic.name)),
        el('span', null, `${levelName(topic.level)} · ${stageName(stageOf(topic))}`),
      );
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', topicLabel(topic.name));
      LEVEL_KEYS.forEach((levelKey, i) => {
        const level = i + 1;
        const btn = el('button', level === topic.level ? 'is-on' : null, t(levelKey));
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(level === topic.level));
        if (level === 4 && topic.validatedAt < 4) {
          btn.disabled = true;
          btn.title = t('d.assess.referenceLocked');
        }
        btn.addEventListener('click', () => {
          topic.level = level;
          markAssessed();
          renderAssessment();
          renderTrust();
          evaluateTrack();
          renderCompleteness();
          renderRoles();
          renderIdentity();
          renderMentorCard();
          renderBadges();
          renderPaths();
          renderSpine();
        });
        seg.appendChild(btn);
      });
      wrap.append(head, seg);
      return wrap;
    }));
    // reflect the stored indicator answers
    document.querySelectorAll('.seg[data-ind]').forEach((seg) => {
      const saved = U.indicators[seg.dataset.ind];
      seg.querySelectorAll('button').forEach((btn) => {
        const on = btn.dataset.val === saved;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    });
    setText('assessEyebrow', t('d.eyebrow.assessment', { n: U.topics.length }));
  }

  document.querySelectorAll('.seg[data-ind]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('is-on', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        U.indicators[seg.dataset.ind] = btn.dataset.val;
        markAssessed();
        evaluateTrack();
        renderRoles();
        renderMentorCard();
        renderBadges();
        renderPaths();
        renderCompleteness();
        renderSpine();
      });
    });
  });

  const fastBtn = byId('fastTrackBtn');
  function renderFastBtn() {
    if (!fastBtn) return;
    fastBtn.disabled = U.mentorApplied;
    fastBtn.classList.toggle('is-sent', U.mentorApplied);
    fastBtn.textContent = t(U.mentorApplied ? 'd.fast.sent' : 'd.fast.start');
  }
  fastBtn?.addEventListener('click', () => {
    U.mentorApplied = true;
    touchUser();
    renderFastBtn();
    renderSpine();
  });

  /* ================= Part C + completeness ================= */
  const partCFields = ['bio', 'linkedin', 'portfolio', 'references', 'availability'];
  const partCTotal = partCFields.length;
  const partCCount = () => partCFields.filter((f) => String(U.partC[f] ?? '').trim() !== '').length;
  const partCDone = () => partCCount() === partCTotal;

  function renderCompleteness() {
    const pct = 30 + (U.assessed ? 30 : 0) + Math.round(40 * (partCCount() / partCTotal));
    const ringVal = byId('ringVal');
    if (ringVal) {
      const C = 2 * Math.PI * 34;
      const on = (C * pct) / 100;
      ringVal.setAttribute('stroke-dasharray', `${on.toFixed(1)} ${(C - on).toFixed(1)}`);
    }
    setText('ringText', `${pct}%`);
    byId('ringSvg')?.setAttribute('aria-label', t('d.ring.aria', { n: pct }));

    const partB = byId('partBStatus');
    if (partB) {
      partB.classList.toggle('done', U.assessed);
      partB.textContent = t(U.assessed ? 'd.parts.b' : 'd.parts.bPending');
    }
    const partC = byId('partCStatus');
    if (partC) {
      partC.classList.toggle('done', partCDone());
      partC.textContent = partCDone() ? t('d.parts.c') : t('d.parts.cCount', { n: partCCount(), total: partCTotal });
    }
    setText('partCNote', t(partCDone() ? 'd.ctx.noteDone' : 'd.ctx.noteTodo'));
    const btn = byId('partCBtn');
    if (btn) btn.textContent = t(partCDone() ? 'd.ctx.btnEdit' : 'd.ctx.btnDo');
  }

  const pcDialog = byId('partCDialog');
  const pcForm = byId('partCForm');
  const pc = {
    bio: byId('pcBio'),
    linkedin: byId('pcLinkedin'),
    portfolio: byId('pcPortfolio'),
    references: byId('pcRefs'),
    availability: byId('pcAvail'),
    consent: byId('pcConsent'),
    listName: byId('pcListName'),
    error: byId('pcError'),
  };
  const LINKEDIN_RE = /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/;
  function openPartC() {
    if (!pcDialog || !pcForm || !U) return;
    pc.bio.value = U.partC.bio;
    pc.linkedin.value = U.partC.linkedin;
    pc.portfolio.value = U.partC.portfolio;
    pc.references.value = U.partC.references;
    pc.availability.value = U.partC.availability;
    pc.consent.checked = U.partC.consent;
    // absent on older profiles, which means named
    pc.listName.checked = U.partC.listName !== false;
    pc.error.hidden = true;
    if (typeof pcDialog.showModal === 'function') pcDialog.showModal();
  }
  if (pcDialog && pcForm) {
    byId('partCBtn')?.addEventListener('click', openPartC);
    byId('pcCancel')?.addEventListener('click', () => pcDialog.close());
    pcForm.addEventListener('submit', (e) => {
      const url = pc.portfolio.value.trim();
      if (url && !/^https?:\/\/\S+\.\S+/.test(url)) {
        e.preventDefault();
        pc.error.textContent = t('d.pc.errPortfolio');
        pc.error.hidden = false;
        return;
      }
      const li = pc.linkedin.value.trim();
      if (li && !LINKEDIN_RE.test(li)) {
        e.preventDefault();
        pc.error.textContent = t('d.pc.errLinkedin');
        pc.error.hidden = false;
        return;
      }
      U.partC = {
        bio: pc.bio.value.trim(),
        linkedin: li,
        portfolio: url,
        references: pc.references.value.trim(),
        availability: pc.availability.value,
        consent: pc.consent.checked,
        listName: pc.listName.checked,
      };
      touchUser();
      renderIdentity();
      renderCompleteness();
      renderPaths();
      renderSpine();
    });
  }

  /* ================= profile dialog ================= */
  const userDialog = byId('userDialog');
  const userForm = byId('userForm');
  let openUserDialog = () => {};
  const uc = {
    name: byId('ucName'),
    city: byId('ucCity'),
    cityOptions: byId('ucCityOptions'),
    role: byId('ucRole'),
    topics: byId('ucTopics'),
    error: byId('ucError'),
    dataControls: byId('ucDataControls'),
    exportData: byId('ucExport'),
    deleteAccount: byId('ucDelete'),
  };
  if (userDialog && userForm) {
    let cityTimer = null;
    let cityAbort = null;
    const setCityOptions = (cities) => {
      if (!uc.cityOptions) return;
      uc.cityOptions.replaceChildren(...cities.map((city) => {
        const option = document.createElement('option');
        option.value = city.label || city.name;
        option.label = city.region ? `${city.name} · ${city.region}` : city.name;
        return option;
      }));
    };
    const scheduleCitySearch = () => {
      clearTimeout(cityTimer);
      const query = cleanCity(uc.city.value);
      if (query.length < 2) {
        setCityOptions([]);
        return;
      }
      cityTimer = setTimeout(async () => {
        if (cityAbort) cityAbort.abort();
        cityAbort = new AbortController();
        try {
          const data = await api(`/api/cities?q=${encodeURIComponent(query)}`, { signal: cityAbort.signal });
          setCityOptions(Array.isArray(data.cities) ? data.cities : []);
        } catch (err) {
          if (err.name !== 'AbortError') setCityOptions([]);
        }
      }, 280);
    };
    uc.city?.addEventListener('input', scheduleCitySearch);
    TAXONOMY.forEach((topic) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = topic;
      input.addEventListener('change', () => {
        const checked = uc.topics.querySelectorAll('input:checked');
        if (checked.length > 3) {
          input.checked = false;
          uc.error.textContent = t('d.uc.errTopicMax');
          uc.error.hidden = false;
        } else if (checked.length) {
          uc.error.hidden = true;
        }
      });
      label.append(input, topicLabel(topic));
      uc.topics.appendChild(label);
    });

    const ucTitle = byId('ucTitle');
    const ucSub = byId('ucSub');
    const ucSubmit = byId('ucSubmit');
    openUserDialog = () => {
      if (!U) return;
      uc.error.hidden = true;
      // members edit in place; a fresh account completes its profile first
      const editing = Boolean(U.city && U.role && U.topics.length);
      if (ucTitle) ucTitle.textContent = t(editing ? 'd.uc.titleEdit' : 'd.uc.titleNew');
      if (ucSub) ucSub.textContent = t(editing ? 'd.uc.subEdit' : 'd.uc.subNew');
      if (ucSubmit) ucSubmit.textContent = t(editing ? 'd.uc.submitSave' : 'd.uc.submitCreate');
      if (uc.dataControls) uc.dataControls.hidden = !editing;
      uc.name.value = U.name;
      uc.city.value = U.city;
      uc.role.value = U.kind === 'member' && U.role !== 'Member' ? U.role : '';
      setCityOptions(U.city ? [{ name: U.city, label: U.city }] : []);
      const current = new Set(U.topics.map((x) => x.name));
      uc.topics.querySelectorAll('input').forEach((i) => { i.checked = current.has(i.value); });
      if (typeof userDialog.showModal === 'function' && !userDialog.open) userDialog.showModal();
    };
    byId('userBtn')?.addEventListener('click', openUserDialog);
    byId('ucCancel')?.addEventListener('click', () => userDialog.close());

    userForm.addEventListener('submit', (e) => {
      const name = uc.name.value.trim();
      const city = cleanCity(uc.city.value);
      const role = cleanRole(uc.role.value);
      const topics = [...uc.topics.querySelectorAll('input:checked')].map((i) => i.value);
      if (!name || !city || !role || topics.length === 0) {
        e.preventDefault();
        uc.error.textContent = !name ? t('d.uc.errName')
          : !city ? t('d.uc.errCity')
            : !role ? t('d.uc.errRole')
              : t('d.uc.errTopic');
        uc.error.hidden = false;
        return;
      }
      if (U.kind === 'member') {
        // edit in place — keep levels and validation for topics that stay
        U.name = name;
        U.city = city;
        U.role = role;
        const byName = new Map(U.topics.map((x) => [x.name, x]));
        U.topics = topics.map((n) => byName.get(n) ?? makeTopic(n));
        setUser(U);
      } else {
        setUser(newUser(name, city, role, topics));
      }
    });

    uc.exportData?.addEventListener('click', async () => {
      try {
        const exported = await api('/api/me/export');
        const blob = new Blob([JSON.stringify(exported.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'nodal-member-data.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        uc.error.textContent = err.message || t('d.uc.exportFail');
        uc.error.hidden = false;
      }
    });

    uc.deleteAccount?.addEventListener('click', async () => {
      const email = prompt(t('d.uc.deletePrompt'));
      if (!email) return;
      try {
        await api('/api/me', { method: 'DELETE', body: JSON.stringify({ confirmEmail: email }) });
        location.assign('/login.html');
      } catch (err) {
        uc.error.textContent = err.message || t('d.uc.deleteFail');
        uc.error.hidden = false;
      }
    });
  }

  byId('logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } finally {
      location.assign('/login.html');
    }
  });

  /* ================= this week + timeline ================= */
  function timelineData() {
    const first = U.topics[0] ? topicLabel(U.topics[0].name) : t('d.tl.yourTopic');
    return [
      { time: t('d.tl.today'), name: t('d.tl.createdName'), sub: t('d.tl.createdSub'), cls: 'tl-strong' },
      { time: t('d.tl.next'), name: t(U.assessed ? 'd.tl.assessedName' : 'd.tl.assessName'), sub: t('d.tl.assessSub') },
      { time: t('d.tl.suggested'), name: t('d.tl.feedName', { topic: first }), sub: t('d.tl.feedSub') },
      { time: t('d.tl.suggested'), name: t('d.tl.circleName', { city: cityLabel() }), sub: t('d.tl.circleSub'), cls: 'tl-soft' },
      { time: t('d.tl.later'), name: t('d.tl.mentorName'), sub: t('d.tl.mentorSub'), cls: 'tl-soft', extra: true },
      { time: t('d.tl.locked'), name: t('d.tl.introName'), sub: t('d.tl.introSub'), cls: 'tl-soft', extra: true },
    ];
  }

  function renderTimeline() {
    const tline = byId('tline');
    const more = byId('tlMore');
    if (!tline) return;
    const expanded = more?.getAttribute('aria-expanded') === 'true';
    tline.replaceChildren(...timelineData().map((item) => {
      const li = el('li', item.cls);
      if (item.extra) { li.classList.add('tl-extra'); li.hidden = !expanded; }
      li.append(
        el('span', 'tl-time', item.time),
        el('p', 'tl-name', item.name),
        el('p', 'tl-sub', item.sub),
      );
      return li;
    }));
    if (more) more.textContent = t(expanded ? 'd.tl.less' : 'd.tl.more');
  }

  const tlMore = byId('tlMore');
  tlMore?.addEventListener('click', () => {
    const expand = tlMore.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('.tl-extra').forEach((li) => { li.hidden = !expand; });
    tlMore.setAttribute('aria-expanded', String(expand));
    tlMore.textContent = t(expand ? 'd.tl.less' : 'd.tl.more');
  });

  function renderWeek() {
    const strip = byId('weekStrip');
    if (!strip) return;
    const fmt = new Intl.DateTimeFormat(localeTag(), { weekday: 'short' });
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const li = document.createElement('li');
      if (d.toDateString() === today.toDateString()) li.classList.add('is-today');
      li.append(
        el('span', 'w-day', fmt.format(d).replace('.', '').slice(0, 3)),
        el('span', 'w-num', String(d.getDate())),
      );
      days.push(li);
    }
    strip.replaceChildren(...days);
  }

  /* ================= search =================
     People keep using the consent-gated member directory. Every other scope
     uses the same published catalog API as the public open-work page. */
  const CATALOG_SCOPE_KINDS = Object.freeze({
    Projects: 'project',
    Knowledge: 'learning_circle,resource,case_study',
    Opportunities: 'opportunity',
  });

  const searchInput = byId('searchInput');
  const searchPop = byId('searchPop');
  const chipHost = byId('searchChips');
  const activeScope = () => chipHost?.querySelector('.chip.is-on')?.dataset.scope ?? 'People';
  const scopeLabel = () => chipHost?.querySelector('.chip.is-on')?.textContent ?? 'People';

  let peopleQuery = '';
  let peopleHits = [];
  let peopleTimer = null;
  let peopleAbort = null;
  let peopleSequence = 0;
  let catalogQuery = '';
  let catalogScope = '';
  let catalogHits = [];
  let catalogReady = false;
  let catalogTimer = null;
  let catalogAbort = null;
  let catalogSequence = 0;

  function cancelPeopleLookup() {
    clearTimeout(peopleTimer);
    peopleTimer = null;
    if (peopleAbort) peopleAbort.abort();
    peopleAbort = null;
    peopleSequence += 1;
  }

  function lookUpPeople(query) {
    cancelPeopleLookup();
    const normalizedQuery = query.toLowerCase();
    const sequence = peopleSequence;
    peopleTimer = setTimeout(async () => {
      peopleTimer = null;
      if (sequence !== peopleSequence || activeScope() !== 'People') return;
      const controller = new AbortController();
      peopleAbort = controller;
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (sequence !== peopleSequence || activeScope() !== 'People'
          || searchInput.value.trim().toLowerCase() !== normalizedQuery) return;
        const hits = (Array.isArray(data.users) ? data.users : []).map((u) => ({
          label: u.name,
          meta: [u.role, u.city].filter(Boolean).join(' · '),
          href: `profile.html?id=${encodeURIComponent(u.id)}`,
        }));
        peopleHits = hits;
        peopleQuery = normalizedQuery;
        paint(peopleHits);
      } catch (err) {
        if (err.name === 'AbortError' || sequence !== peopleSequence
          || activeScope() !== 'People'
          || searchInput.value.trim().toLowerCase() !== normalizedQuery) return;
        peopleQuery = normalizedQuery;
        peopleHits = [];
        paint([]);                       // static hosting has no directory
      } finally {
        if (peopleAbort === controller) peopleAbort = null;
      }
    }, 220);
  }

  function lookUpCatalog(scope, query) {
    clearTimeout(catalogTimer);
    catalogTimer = setTimeout(async () => {
      if (catalogAbort) catalogAbort.abort();
      catalogAbort = new AbortController();
      const sequence = catalogSequence + 1;
      catalogSequence = sequence;
      const params = new URLSearchParams({
        lang: I18N?.lang || 'en',
        kind: CATALOG_SCOPE_KINDS[scope],
        q: query,
        state: 'open',
        limit: '6',
      });
      try {
        const data = await api(`/api/catalog?${params}`, { signal: catalogAbort.signal });
        if (sequence !== catalogSequence) return;
        catalogHits = (Array.isArray(data.items) ? data.items : []).map((item) => ({
          label: item.title,
          meta: [item.organization, item.location, t(`catalog.kind.${item.kind}`)].filter(Boolean).join(' · '),
          href: `opportunities.html?${new URLSearchParams({ id: item.id })}`,
        }));
        catalogQuery = query.toLowerCase();
        catalogScope = scope;
        catalogReady = true;
        if (activeScope() === scope && searchInput.value.trim().toLowerCase() === catalogQuery) paint(catalogHits);
      } catch (err) {
        if (err.name === 'AbortError' || sequence !== catalogSequence) return;
        catalogReady = false;
        catalogQuery = '';
        catalogScope = '';
        catalogHits = [];
        if (activeScope() === scope && searchInput.value.trim().toLowerCase() === query.toLowerCase()) paint([], 'catalog-error');
      }
    }, 220);
  }

  function paint(hits, mode = 'ready') {
    if (!searchPop) return;
    const typed = searchInput.value.trim();
    if (hits === null) {
      const key = activeScope() === 'People' ? 'd.search.searching' : 'd.search.catalogSearching';
      searchPop.replaceChildren(el('p', 'search-empty', t(key)));
      searchPop.hidden = false;
      return;
    }
    if (mode === 'catalog-error') {
      searchPop.replaceChildren(el('p', 'search-empty', t('d.search.catalogUnavailable')));
      searchPop.hidden = false;
      return;
    }
    if (!hits.length) {
      const people = activeScope() === 'People';
      const key = people ? 'd.search.noMatch' : 'd.search.catalogEmpty';
      const empty = el('p', 'search-empty', t(key, { q: typed, scope: scopeLabel() }));
      if (people) empty.append(el('small', null, t('d.search.directoryNote')));
      searchPop.replaceChildren(empty);
      searchPop.hidden = false;
      return;
    }
    searchPop.replaceChildren(...hits.map((item) => {
      const a = el('a', 'search-hit');
      a.href = item.href;
      a.append(el('strong', null, item.label), el('span', null, item.meta));
      return a;
    }));
    searchPop.hidden = false;
  }

  function runSearch() {
    if (!searchInput || !searchPop) return;
    const typed = searchInput.value.trim();
    const q = typed.toLowerCase();
    const scope = activeScope();
    if (scope !== 'People') cancelPeopleLookup();
    if (q.length < 2) { searchPop.hidden = true; return; }
    if (scope === 'People') {
      if (catalogAbort) catalogAbort.abort();
      catalogSequence += 1;
      if (peopleQuery === q) { cancelPeopleLookup(); paint(peopleHits); return; }
      lookUpPeople(typed);
      paint(null);
      return;
    }
    if (catalogReady && catalogScope === scope && catalogQuery === q) { paint(catalogHits); return; }
    lookUpCatalog(scope, typed);
    paint(null);
  }

  if (searchInput && searchPop && chipHost) {
    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') searchPop.hidden = true; });
    chipHost.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chipHost.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === chip));
        runSearch();
        searchInput.focus();
      });
    });
  }

  /* ================= notifications ================= */
  function notifData() {
    return [
      { title: t('d.notif.welcome.t'), sub: t('d.notif.welcome.s') },
      {
        title: t(U.assessed ? 'd.notif.path.tDone' : 'd.notif.path.tTodo'),
        sub: t(U.assessed ? 'd.notif.path.sDone' : 'd.notif.path.sTodo'),
      },
      { title: t('d.notif.cohort.t'), sub: t('d.notif.cohort.s') },
    ];
  }
  const notifBtn = byId('notifBtn');
  const notifPop = byId('notifPop');
  const notifDot = byId('notifDot');
  const notifList = byId('notifList');
  const notifClear = byId('notifClear');
  function renderNotifs() {
    if (!notifList) return;
    notifList.replaceChildren(...notifData().map((n) => {
      const li = document.createElement('li');
      li.append(el('strong', null, n.title), el('span', null, n.sub));
      return li;
    }));
    if (notifDot) notifDot.hidden = state.notifRead;
    if (notifClear) {
      notifClear.disabled = state.notifRead;
      notifClear.textContent = t(state.notifRead ? 'd.notif.clearDone' : 'd.notif.clear');
    }
  }
  if (notifBtn && notifPop) {
    notifBtn.addEventListener('click', () => {
      notifPop.hidden = !notifPop.hidden;
      notifBtn.setAttribute('aria-expanded', String(!notifPop.hidden));
    });
    notifClear?.addEventListener('click', () => {
      state.notifRead = true;
      touchUser();
      renderNotifs();
    });
  }
  document.addEventListener('click', (e) => {
    if (searchPop && !searchPop.hidden && !e.target.closest('.search')) searchPop.hidden = true;
    if (notifPop && !notifPop.hidden && !e.target.closest('.top-actions')) {
      notifPop.hidden = true;
      notifBtn?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (searchPop) searchPop.hidden = true;
    if (notifPop) { notifPop.hidden = true; notifBtn?.setAttribute('aria-expanded', 'false'); }
  });

  /* ================= scroll spy ================= */
  const sections = ['overview', 'network', 'growth', 'badges', 'assessment']
    .map((id) => byId(id)).filter(Boolean);
  const links = new Map(
    [...document.querySelectorAll('.side-link[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
  );
  if (sections.length && links.size) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a, id) => a.classList.toggle('is-active', id === entry.target.id));
      });
    }, { rootMargin: '-25% 0px -60% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  /* ================= apply everything ================= */
  function relabelTopicChips() {
    uc.topics?.querySelectorAll('label').forEach((label) => {
      const input = label.querySelector('input');
      if (input) label.replaceChildren(input, topicLabel(input.value));
    });
  }

  function applyAll() {
    if (!U) return;
    relabelTopicChips();
    renderIdentity();
    renderSpine();
    renderRoles();
    renderTrust();
    renderActivity();
    renderMentorCard();
    renderAssessment();
    evaluateTrack();
    renderFastBtn();
    renderCompleteness();
    renderBadges();
    renderPaths();
    renderWeek();
    renderTimeline();
    renderNotifs();
  }
  const saveRetry = byId('saveRetry');
  saveRetry?.addEventListener('click', () => {
    saveRetry.disabled = true;
    saveProfile()
      .then(() => { reportSave(true); applyAll(); })
      .catch(() => reportSave(false, true))
      .finally(() => { saveRetry.disabled = false; });
  });

  document.querySelectorAll('.side-link, .side-out').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--gx', `${e.clientX - r.left}px`);
      btn.style.setProperty('--gy', `${e.clientY - r.top}px`);
      btn.classList.remove('glint');
      void btn.offsetWidth;              // restart the animation
      btn.classList.add('glint');
    });
    btn.addEventListener('animationend', () => btn.classList.remove('glint'));
  });

  I18N?.onChange(() => {
    applyAll();
    catalogReady = false;
    catalogQuery = '';
    if (searchInput?.value.trim().length >= 2 && activeScope() !== 'People') runSearch();
  });

  async function init() {
    try {
      const data = await api('/api/auth/me');
      U = normalizeApiUser(data.user);
      state.user = U;
      state.notifRead = U.notifRead;
      applyAll();
      if (!U.city || !U.role || U.topics.length === 0) openUserDialog();
    } catch {
      // api() handles the login redirect for 401. Other failures leave the page
      // quiet instead of showing stale hardcoded state.
    }
  }
  init();
})();
