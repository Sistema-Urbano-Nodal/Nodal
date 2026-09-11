/* authenticated member profile: renders the current database user.
   All writes via textContent/createElement — never innerHTML (CSP). */
(() => {
  'use strict';

  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const DEFAULT_PART_C = { bio: '', linkedin: '', portfolio: '', references: '', availability: '', consent: false };
  const LEVEL_KEYS = ['d.level.1', 'd.level.2', 'd.level.3', 'd.level.4'];
  const TOPIC_KEYS = new Map([
    ['Mobility', 'mobility'], ['Public space', 'publicSpace'], ['Housing', 'housing'],
    ['Climate & resilience', 'climate'], ['Care & gender', 'care'],
    ['Governance & participation', 'governance'], ['Safety', 'safety'],
    ['Informality', 'informality'], ['Heritage', 'heritage'],
    ['Urban data & tech', 'urbanData'], ['Land use & planning', 'landUse'],
    ['Environment & nature', 'environment'],
  ]);
  const topicLabel = (name) => (TOPIC_KEYS.has(name) ? t(`d.topic.${TOPIC_KEYS.get(name)}`) : name);
  let currentProfile = null, profileFailed = false, networkPeople = [];
  let signalsHost = document.querySelector('.pf-locked');

  const $ = (id) => document.getElementById(id);
  const set = (id, text) => { const node = $(id); if (node) node.textContent = text; };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function api(path) {
    const res = await fetch(path);
    if (res.status === 401) {
      location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`);
      throw new Error('authentication required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `api ${res.status}`);
    return data;
  }

  function normalize(user) {
    return {
      ...user,
      fullName: user.fullName || user.name || 'Member',
      title: user.title || user.role || 'Member',
      city: user.city || '',
      interests: Array.isArray(user.interests) ? user.interests : [],
      topics: Array.isArray(user.topics) ? user.topics : [],
      partC: { ...DEFAULT_PART_C, ...(user.partC || {}) },
    };
  }

  function render(user, isSelf) {
    document.title = `${user.fullName} · ${t('p.title')}`;
    set('pfName', user.fullName);
    set('pfKicker', t(isSelf ? 'p.kickerSelf' : 'p.kicker'));
    set('pfRole', `${user.title}${user.city ? ` · ${user.city}` : ''}`);
    const parts = user.fullName.trim().split(/\s+/);
    set('pfInitial', (parts[0]?.[0] + (parts[1]?.[0] ?? '')).toUpperCase() || 'N');
    set('pfCoord', user.city || t('p.cityPending'));

    const tags = $('pfTags');
    const topics = user.topics.length ? user.topics : user.interests.map((name) => ({ name }));
    if (tags) {
      tags.replaceChildren(...topics.slice(0, 4).map((x) => el('span', '', topicLabel(x.name || String(x)))));
    }

    const top = [...topics].sort((a, b) => (b.level || 0) - (a.level || 0))[0];
    set('pfMeta', top?.level
      ? t('p.meta', {
        topic: topicLabel(top.name),
        level: t(LEVEL_KEYS[Math.min(Math.max(top.level, 1), 4) - 1]),
        state: t(user.assessed ? 'p.assessDone' : 'p.assessPending'),
      })
      : t('p.metaNew'));

    const li = $('pfLinkedin');
    const liUrl = (user.partC.linkedin || user.linkedin || '').trim();
    const LI_OK = /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/;
    if (li) {
      if (liUrl && LI_OK.test(liUrl)) {
        li.hidden = false;
        li.href = liUrl;
        set('pfLinkedinText', liUrl.replace(/^https:\/\/(www\.)?/, ''));
      } else {
        li.hidden = true;
      }
    }

    const match = $('pfMatch');
    if (match) {
      match.replaceChildren(t(isSelf ? 'p.cardSelf' : 'p.card'));
      match.append(el('small', '', t(isSelf
        ? (user.partC.consent ? 'p.listed' : 'p.unlisted')
        : 'p.listed')));
    }
    const btns = $('pfBtns');
    if (btns) {
      btns.replaceChildren();
      const edit = el('a', 'btn btn-primary', t(isSelf ? 'p.edit' : 'p.back'));
      edit.href = 'dashboard.html';
      const share = el('button', 'btn btn-ghost', t('p.copy'));
      share.type = 'button';
      share.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          share.textContent = t('p.copied');
        } catch {
          share.textContent = location.href;
        }
        setTimeout(() => { share.textContent = t('p.copy'); }, 2200);
      });
      btns.append(edit, share);
    }

    set('pfAbout', user.partC.bio || t(isSelf ? 'p.noBioSelf' : 'p.noBio'));
    const quote = $('pfQuote');
    if (quote) quote.hidden = true;

    const projects = $('pfProjects');
    if (projects) {
      const item = el('li');
      const head = el('div', 'pf-proj-head');
      head.append(el('h3', '', t('p.noProjects')), el('span', 'pf-status', t('p.open')));
      item.append(head, el('p', '', t('p.noProjectsBody')));
      projects.replaceChildren(item);
    }

    const locked = signalsHost;
    if (locked) {
      const fresh = el('article', 'pf-card');
      const num = el('span', 'pf-num', 'P.03');
      num.setAttribute('aria-hidden', 'true');
      fresh.append(num, el('h2', '', t('p.signals')));
      const none = t('p.notAdded');
      const rows = isSelf ? [
        [t('p.sAvail'), user.partC.availability || t('p.notDeclared')],
        [t('p.sRefs'), user.partC.references ? t('p.onFile') : none],
        [t('p.sPortfolio'), user.partC.portfolio || none],
        ['LinkedIn', liUrl ? t('p.linked') : none],
        [t('p.sConsent'), t(user.partC.consent ? 'p.listed' : 'p.unlistedShort')],
      ] : [
        [t('p.sCity'), user.city || t('p.notShared')],
        [t('p.sAvail'), user.partC.availability || t('p.notDeclared')],
        ['LinkedIn', liUrl ? t('p.linked') : none],
      ];
      rows.forEach(([k, v]) => {
        const p = el('p');
        p.append(el('strong', '', `${k}: `), v);
        fresh.append(p);
      });
      fresh.append(el('p', 'pf-quote', t(isSelf ? 'p.signalsSelf' : 'p.signalsOther')));
      locked.replaceWith(fresh);
      signalsHost = fresh;
    }

    set('pfActConn', '0');
    set('pfActProj', '0');
    set('pfActCourses', '0');
    set('pfActSince', new Date(user.createdAt || Date.now()).getFullYear());
    renderConnections(user);
  }
  function renderConnections(user) {
    const list = $('pfConnList');
    if (list) {
      const empty = el('li');
          empty.append(el('span', '', t('p.noConnections')));
      list.replaceChildren(empty);
      const people = networkPeople.filter((u) => u.id !== user.id).slice(0, 4);
      if (people.length) {
        const head = el('li');
        head.append(el('span', '', t('p.onNetwork')));
        list.replaceChildren(head, ...people.map((u) => {
          const row = el('li');
          row.append(el('span', '', `${u.name} · ${u.role}`));
          return row;
        }));
      }
    }
  }

  function renderFailure() {
    document.title = t('p.title');
    set('pfName', t('p.notFound'));
    set('pfKicker', t('p.kicker'));
    set('pfRole', t('p.notFoundWhy'));
    set('pfAbout', t('p.notFoundBody'));
    const btns = $('pfBtns');
    if (btns) {
      const back = el('a', 'btn btn-primary', t('p.back'));
      back.href = 'dashboard.html';
      btns.replaceChildren(back);
    }
  }
  I18N?.onChange(() => {
    if (currentProfile) render(currentProfile.user, currentProfile.isSelf);
    else if (profileFailed) renderFailure();
  });

  /* ?id=<member> opens that member's card; no id opens your own */
  const wanted = new URLSearchParams(location.search).get('id');
  const endpoint = wanted ? `/api/users/${encodeURIComponent(wanted)}` : '/api/auth/me';
  api(endpoint)
    .then((data) => {
      currentProfile = {user: normalize(data.user), isSelf: data.self !== false};
      render(currentProfile.user, currentProfile.isSelf);
      if ($('pfConnList')) api('/api/users').then((data) => {
        networkPeople = Array.isArray(data.users) ? data.users : [];
        renderConnections(currentProfile.user);
      }).catch(() => {});
    })
    .catch((err) => {
      if (String(err.message).includes('authentication')) return;   // redirecting
      profileFailed = true;
      renderFailure();
    });
})();
