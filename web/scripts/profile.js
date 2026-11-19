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
  // 'Member' is the server's no-title sentinel; the console shows it translated too.
  const roleLabel = (role) => (!role || role === 'Member' ? t('d.role.member') : role);
  // Availability is stored as the console's option value, in English: those three read in the page language, anything else as written.
  const AVAILABILITY_KEYS = new Map([['2 h / month', 'd.pc.avail2'], ['4 h / month', 'd.pc.avail4'], ['8+ h / month', 'd.pc.avail8']]);
  const availabilityLabel = (value) => (AVAILABILITY_KEYS.has(value) ? t(AVAILABILITY_KEYS.get(value)) : value);
  /* One profile-only line in en/es/pt, picked by the page language like auth.js's messages, so the console
     dictionary and its cache key stay as they are. */
  const SHARE_HIDDEN = [
    'To share your profile, opt into the directory in Part C.',
    'Para compartir tu perfil, autoriza el directorio en la Parte C.',
    'Para compartilhar seu perfil, autorize o diretório na Parte C.',
  ];
  const shareHidden = () => SHARE_HIDDEN[({ en: 0, es: 1, pt: 2 })[I18N?.lang] ?? 0];
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

  async function api(path, options) {
    const res = await fetch(path, options);
    if (res.status === 401) {
      location.assign(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
      throw new Error('authentication required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `api ${res.status}`), { status: res.status });
    return data;
  }

  let photoDraft = null, photoBusy = false, photoNotice = '', photoError = false;
  function memberPhotoUrl(value, memberId) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value, location.origin);
      if (url.origin === location.origin && url.pathname === '/api/users/' + encodeURIComponent(memberId) + '/photo') {
        return url.pathname + url.search;
      }
    } catch { /* Keep the initials when there is no usable member photo. */ }
    return '';
  }
  function renderPhoto(user, isSelf) {
    const photo = $('pfPhoto'), tools = $('pfPhotoTools');
    if (!photo || !tools) return;
    const saved = memberPhotoUrl(user.photoUrl, user.id);
    const source = isSelf && photoDraft ? photoDraft.preview : saved;
    if (source !== (photo.getAttribute('src') || '')) {
      photo.hidden = true;
      if (source) photo.setAttribute('src', source);
      else photo.removeAttribute('src');
    }
    tools.hidden = !isSelf;
    if (!isSelf) return;
    const choose = $('pfChoosePhoto'), remove = $('pfRemovePhoto'), save = $('pfSavePhoto'), cancel = $('pfCancelPhoto');
    choose.dataset.i18n = saved ? 'p.photoChange' : 'p.photoAdd';
    choose.textContent = t(choose.dataset.i18n);
    choose.hidden = Boolean(photoDraft);
    remove.hidden = !saved || Boolean(photoDraft);
    save.hidden = cancel.hidden = !photoDraft;
    for (const control of [choose, remove, save, cancel]) control.disabled = photoBusy;
    $('pfPhotoStatus').dataset.error = String(photoError);
    set('pfPhotoStatus', photoNotice ? t(photoNotice) : '');
  }
  function photoStatus(key, busy = false, error = false) {
    photoNotice = key;
    photoBusy = busy;
    photoError = error;
    renderPhoto(currentProfile.user, true);
  }
  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function preparePhoto(file) {
    const supported = /^image\/(?:jpeg|png|webp|avif|heic|heif)$/i;
    if (!(supported.test(file.type) || (!file.type && /\.(?:jpe?g|png|webp|avif|heic|heif)$/i.test(file.name)))) {
      throw new Error('unsupported image');
    }
    let image;
    try {
      image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some phone browsers can display a camera photo but cannot decode it with createImageBitmap.
      image = new Image();
      image.src = await dataUrl(file);
      await image.decode();
    }
    try {
      const crop = Math.min(image.width, image.height);
      const size = Math.min(512, crop);
      if (!size) throw new Error('empty image');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, size, size);
      // Exporting the pixels also discards the original image's camera and location metadata.
      for (const quality of [0.88, 0.72, 0.5, 0.32]) {
        const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (jpeg && jpeg.type === 'image/jpeg' && jpeg.size <= 128 * 1024) return { jpeg, preview: await dataUrl(jpeg) };
      }
      throw new Error('image too large');
    } finally { image.close?.(); }
  }

  $('pfPhoto')?.addEventListener('load', () => { $('pfPhoto').hidden = false; });
  $('pfPhoto')?.addEventListener('error', () => { $('pfPhoto').hidden = true; });
  $('pfChoosePhoto')?.addEventListener('click', () => {
    if (currentProfile?.isSelf && !photoBusy) $('pfPhotoFile').click();
  });
  $('pfPhotoFile')?.addEventListener('change', async () => {
    const picker = $('pfPhotoFile'), file = picker.files[0];
    picker.value = '';
    if (!currentProfile?.isSelf || photoBusy || !file) return;
    photoStatus('p.photoPreparing', true);
    try {
      photoDraft = await preparePhoto(file);
      photoStatus('p.photoPreview');
      $('pfSavePhoto').focus();
    } catch { photoStatus('p.photoInvalid', false, true); }
  });
  $('pfCancelPhoto')?.addEventListener('click', () => {
    if (!currentProfile?.isSelf || photoBusy) return;
    photoDraft = null;
    photoStatus('');
    $('pfChoosePhoto').focus();
  });
  async function writePhoto(remove) {
    if (!currentProfile?.isSelf || photoBusy || (!remove && !photoDraft)) return;
    photoStatus(remove ? 'p.photoRemoving' : 'p.photoUploading', true);
    try {
      const result = await api('/api/me/photo', remove ? { method: 'DELETE' } : {
        method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: photoDraft.jpeg
      });
      const saved = memberPhotoUrl(result.photoUrl, currentProfile.user.id);
      if (remove ? result.photoUrl !== null : !saved) throw new Error('unexpected photo response');
      currentProfile.user.photoUrl = saved;
      photoDraft = null;
      photoStatus(remove ? 'p.photoRemoved' : 'p.photoSaved');
      $('pfChoosePhoto').focus();
    } catch (err) { photoStatus(err.status === 429 ? 'p.photoWait' : 'p.photoFailed', false, true); }
  }
  $('pfSavePhoto')?.addEventListener('click', () => writePhoto(false));
  $('pfRemovePhoto')?.addEventListener('click', () => writePhoto(true));

  function normalize(user) {
    return {
      ...user,
      fullName: user.fullName || user.name || 'Member',
      title: user.title || user.role || 'Member',
      city: user.city || '',
      interests: Array.isArray(user.interests) ? user.interests : [],
      topics: Array.isArray(user.topics) ? user.topics : [],
      partC: { ...DEFAULT_PART_C, ...(user.partC || {}) },
      // Only an administrator gives the Founder badge; the server sends it on your own card and on another member's.
      founder: user.founder === true,
    };
  }

  /* The Founder badge of the Membresía Fundador, which stays on the profile for as long as the member keeps their NODAL account
     (fundadores.html): pilot.js draws the large stamp, and its caption comes from the same rows, so both follow a language switch. */
  function renderFounder(user) {
    const line = $('pfFounder');
    if (!line) return;
    const pilot = window.nodalPilot;
    const shown = Boolean(user?.founder && pilot?.founderBadge);
    line.replaceChildren(...(shown ? [pilot.founderBadge({ large: true }), pilot.tr('span', 'founderCaption', 'pf-founder-note')] : []));
    line.hidden = !shown;
  }

  function render(user, isSelf) {
    document.title = `${user.fullName} · ${t('p.title')}`;
    set('pfName', user.fullName);
    renderFounder(user);
    renderPhoto(user, isSelf);
    set('pfKicker', t(isSelf ? 'p.kickerSelf' : 'p.kicker'));
    set('pfRole', `${roleLabel(user.title)}${user.city ? ` · ${user.city}` : ''}`);
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
    $('pfShareHint')?.remove();
    if (btns) {
      const edit = el('a', 'btn btn-primary', t(isSelf ? 'p.edit' : 'p.back'));
      edit.href = 'dashboard.html';
      btns.replaceChildren(edit);
      if (!isSelf) {
        edit.className = 'btn btn-ghost';
        const message = el('a', 'btn btn-primary', t('d.search.message'));
        message.href = `messages.html?to=${encodeURIComponent(user.id)}`;
        btns.replaceChildren(message, edit);
      }
      /* Until you opt into the directory, your link opens "Member not found" for everyone else
         (the server answers 404), so it is not offered; a line says how to make it shareable. */
      if (isSelf && !user.partC.consent) {
        const hint = el('p', 'pf-meta', shareHidden());
        hint.id = 'pfShareHint';
        btns.closest('.pf-actions')?.append(hint);
      } else {
        const share = el('button', 'btn btn-ghost', t('p.copy'));
        const profileUrl = new URL('/profile.html', location.origin);
        profileUrl.searchParams.set('id', user.id);
        share.type = 'button';
        share.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(profileUrl.href);
            share.textContent = t('p.copied');
          } catch {
            share.textContent = profileUrl.href;
          }
          setTimeout(() => { share.textContent = t('p.copy'); }, 2200);
        });
        btns.append(share);
      }
    }

    set('pfAbout', user.partC.bio || t(isSelf ? 'p.noBioSelf' : 'p.noBio'));
    const quote = $('pfQuote');
    if (quote) quote.hidden = true;

    const projects = $('pfProjects');
    if (projects) {
      projects.replaceChildren(el('p', '', t('p.groupVisibility')));
      if (isSelf) {
        const groups = el('a', 'btn btn-ghost', t('d.nav.messages'));
        groups.href = 'messages.html';
        projects.append(groups);
      }
    }

    const locked = signalsHost;
    if (locked) {
      const fresh = el('article', 'pf-card');
      const num = el('span', 'pf-num', 'P.03');
      num.setAttribute('aria-hidden', 'true');
      fresh.append(num, el('h2', '', t('p.signals')));
      const none = t('p.notAdded');
      const rows = isSelf ? [
        [t('p.sAvail'), availabilityLabel(user.partC.availability) || t('p.notDeclared')],
        [t('p.sRefs'), user.partC.references ? t('p.onFile') : none],
        [t('p.sPortfolio'), user.partC.portfolio || none],
        ['LinkedIn', liUrl ? t('p.linked') : none],
        [t('p.sConsent'), t(user.partC.consent ? 'p.listed' : 'p.unlistedShort')],
      ] : [
        [t('p.sCity'), user.city || t('p.notShared')],
        [t('p.sAvail'), availabilityLabel(user.partC.availability) || t('p.notDeclared')],
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
          row.append(el('span', '', `${u.name} · ${roleLabel(u.role)}`));
          return row;
        }));
      }
    }
  }

  function renderFailure() {
    document.title = t('p.title');
    set('pfName', t('p.notFound'));
    renderFounder(null);
    set('pfKicker', t('p.kicker'));
    set('pfRole', t('p.notFoundWhy'));
    set('pfAbout', t('p.notFoundBody'));
    /* The page shell is a member's card. Without a member, its placeholders ("…" badge,
       empty projects, activity and connections written to "you") would describe nobody, so they go.
       Removed, not hidden: styles.css gives the members-only card display:grid, which beats [hidden]. */
    for (const node of [$('pfMatch'), $('pfProjects')?.closest('.pf-card'),
      signalsHost, document.querySelector('.pf-side')]) {
      node?.remove();
    }
    // Without the side column the About card takes the whole row rather than sitting beside an empty one.
    const grid = document.querySelector('.pf-grid');
    if (grid) grid.style.gridTemplateColumns = '1fr';
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
  const profileRequest = api(endpoint);
  /* the sidebar shows four people: ask for a few, alongside the profile; a plain fetch so a 401 redirects only once */
  const peopleRequest = $('pfConnList') ? fetch('/api/users?limit=5').then((r) => (r.ok ? r.json() : {})).catch(() => ({})) : null;
  profileRequest
    .then((data) => {
      currentProfile = {user: normalize(data.user), isSelf: wanted ? data.self === true : data.self !== false};
      render(currentProfile.user, currentProfile.isSelf);
      if (currentProfile.isSelf && location.hash === '#pfChoosePhoto') $('pfChoosePhoto')?.focus();
      peopleRequest?.then((data) => {
        networkPeople = Array.isArray(data?.users) ? data.users : [];
        renderConnections(currentProfile.user);
      }).catch(() => {});
    })
    .catch((err) => {
      if (String(err.message).includes('authentication')) return;   // redirecting
      profileFailed = true;
      renderFailure();
    });
})();
