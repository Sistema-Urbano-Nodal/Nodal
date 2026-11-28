(() => {
  'use strict';
  const { api, dynamic, el, bind, source, tr, date } = window.nodalPilot;
  const words = {
    directoryTitle: ['Courses and masterclasses', 'Cursos y masterclasses', 'Cursos e masterclasses'],
    agenda: ['Schedule', 'Agenda', 'Agenda'],
    filters: ['Activity type', 'Tipo de actividad', 'Tipo de atividade'],
    all: ['All', 'Todas', 'Todas'],
    courses: ['Courses', 'Cursos', 'Cursos'],
    masterclasses: ['Masterclasses', 'Masterclasses', 'Masterclasses'],
    credits: ['Your 2027 Founder places', 'Tus cupos Fundador 2027', 'Suas vagas de Fundador em 2027'],
    coursesLeft: ['courses available', 'cursos disponibles', 'cursos disponíveis'],
    oneCourseLeft: ['course available', 'curso disponible', 'curso disponível'],
    mastersLeft: ['masterclasses available', 'masterclasses disponibles', 'masterclasses disponíveis'],
    oneMasterLeft: ['masterclass available', 'masterclass disponible', 'masterclass disponível'],
    includedPlace: ['Included place', 'Cupo incluido', 'Vaga incluída'],
    awaiting: ['Payment pending', 'Pago pendiente', 'Pagamento pendente'],
    booked: ['Enrolled', 'Inscripción confirmada', 'Inscrição confirmada'],
    until: ['Through {date}', 'Hasta el {date}', 'Até {date}'],
    undated: ['Date to be announced', 'Fecha por confirmar', 'Data a confirmar'],
    photoCredit: ['Photo, cropped', 'Foto recortada', 'Foto recortada'],
    course: ['Course', 'Curso', 'Curso'],
    masterclass: ['Masterclass', 'Masterclass', 'Masterclass'],
    inactive: ['Included places and the Founder price require an active Founder membership.', 'Los cupos incluidos y el precio Fundador requieren una membresía Fundador activa.', 'As vagas incluídas e o preço Fundador exigem uma membresia Fundador ativa.'],
    suspended: ['Your Founder training benefits are suspended.', 'Tus beneficios de formación Fundador están suspendidos.', 'Seus benefícios de formação Fundador estão suspensos.'],
    expired: ['The 2027 training benefit has ended.', 'El beneficio de formación 2027 ha finalizado.', 'O benefício de formação de 2027 terminou.'],
    emptyAgenda: ['No activities have been published yet.', 'Aún no hay actividades publicadas.', 'Ainda não há atividades publicadas.'],
    noOfferings: ['No published activities currently offer the 2027 Founder benefit.', 'Aún no hay actividades publicadas con el beneficio Fundador 2027.', 'Ainda não há atividades publicadas com o benefício de Fundador de 2027.'],
    full: ['Full', 'Sin cupos', 'Sem vagas'],
    closed: ['Reservations closed', 'Reservas cerradas', 'Reservas encerradas'],
    regular: ['Regular price', 'Precio regular', 'Preço regular'],
    promo: ['Promotional price', 'Precio promocional', 'Preço promocional'],
    price: ['Your price', 'Tu precio', 'Seu preço'],
    founderRate: ['20% Founder discount', '20% de descuento Fundador', '20% de desconto Fundador'],
    betterPromo: ['Promotion beats the 20% Founder rate', 'La promoción supera el descuento Fundador del 20%', 'A promoção supera o desconto Fundador de 20%'],
    free: ['Free enrollment', 'Inscripción gratuita', 'Inscrição gratuita'],
    includedAction: ['Use an included place', 'Usar un cupo incluido', 'Usar uma vaga incluída'],
    additionalAction: ['Reserve an additional place', 'Reservar un cupo adicional', 'Reservar uma vaga adicional'],
    reserve: ['Reserve a place', 'Reservar un cupo', 'Reservar uma vaga'],
    enrollFree: ['Enroll for free', 'Inscribirme gratis', 'Inscrever-me gratuitamente'],
    confirmFree: ['Confirm your free enrollment in this activity?', '¿Confirmar tu inscripción gratuita en esta actividad?', 'Confirmar sua inscrição gratuita nesta atividade?'],
    keepsBalance: ['Free enrollment preserves your included place.', 'La inscripción gratuita conserva tu cupo incluido.', 'A inscrição gratuita preserva sua vaga incluída.'],
    confirmCourse: ['Use your included course for this activity?', '¿Quieres usar tu curso incluido en esta actividad?', 'Quer usar seu curso incluído nesta atividade?'],
    confirmMaster: ['Use your included masterclass for this activity?', '¿Quieres usar tu masterclass incluida en esta actividad?', 'Quer usar sua masterclass incluída nesta atividade?'],
    confirmAdditional: ['Reserve this place for {price}? The team will confirm payment separately. You can cancel while it is pending.', '¿Reservar este cupo por {price}? El equipo confirmará el pago por separado. Puedes cancelar la reserva mientras esté pendiente.', 'Reservar esta vaga por {price}? A equipe confirmará o pagamento separadamente. Você pode cancelar enquanto a reserva estiver pendente.'],
    confirmCancel: ['Cancel this reservation and release your place?', '¿Cancelar esta reserva y liberar el cupo?', 'Cancelar esta reserva e liberar a vaga?'],
    confirm: ['Confirm', 'Confirmar', 'Confirmar'],
    back: ['Go back', 'Volver', 'Voltar'],
    cancel: ['Cancel reservation', 'Cancelar reserva', 'Cancelar reserva'],
    pending: ['Reservation pending payment confirmation', 'Reserva pendiente de confirmación del pago', 'Reserva pendente de confirmação do pagamento'],
    reservedPrice: ['Reserved price', 'Precio reservado', 'Preço reservado'],
    enrolled: ['Your enrollment is confirmed.', 'Tu inscripción está confirmada.', 'Sua inscrição está confirmada.'],
    accessPaused: ['Access to this included activity is paused.', 'El acceso a esta actividad incluida está en pausa.', 'O acesso a esta atividade incluída está pausado.'],
    quota: ['You have used your included place for this type of activity.', 'Ya usaste el cupo incluido para este tipo de actividad.', 'Você já usou a vaga incluída para este tipo de atividade.'],
    retry: ['Try again', 'Volver a intentar', 'Tentar novamente'],
    loadError: ['Training benefits could not be loaded.', 'No se pudieron cargar los beneficios de formación.', 'Não foi possível carregar os benefícios de formação.'],
    conflict: ['Your reservation details changed. Review the current price, places and membership balance.', 'Las condiciones de la reserva cambiaron. Revisa el precio, los cupos y tu saldo de beneficios.', 'As condições da reserva mudaram. Confira o preço, as vagas e seu saldo de benefícios.'],
    uncertain: ['We could not confirm the result. Check your reservation before trying again.', 'No pudimos confirmar el resultado. Revisa tu reserva antes de volver a intentarlo.', 'Não foi possível confirmar o resultado. Confira sua reserva antes de tentar novamente.'],
    check: ['Check reservation', 'Consultar reserva', 'Consultar reserva'],
    released: ['Reservation cancelled.', 'Reserva cancelada.', 'Reserva cancelada.'],
    booking: ['Enrollment', 'Inscripción', 'Inscrição'],
    includedCourse: ['Your included course', 'Tu curso incluido', 'Seu curso incluído'],
    includedMaster: ['Your included masterclass', 'Tu masterclass incluida', 'Sua masterclass incluída'],
    additionalSeat: ['Additional place', 'Cupo adicional', 'Vaga adicional'],
    founderPrice: ['Founder price', 'Precio Fundador', 'Preço Fundador'],
    oneSeat: ['1 place left', 'Queda 1 cupo', 'Resta 1 vaga'],
    remainingSeats: ['{n} places left', 'Quedan {n} cupos', 'Restam {n} vagas'],
  };
  const locale = () => window.nodalI18n?.lang || 'en';
  const text = key => words[key][({ en: 0, es: 1, pt: 2 })[locale()] ?? 0];
  const label = (tag, key, cls) => dynamic(tag, () => text(key), cls);
  const money = cents => new Intl.NumberFormat(({ en: 'en-US', es: 'es-PE', pt: 'pt-BR' })[locale()] || 'en-US', {
    style: 'currency', currency: 'PEN',
  }).format(cents / 100);
  function action(key, handler, secondary = false) {
    const b = label('button', key, secondary ? 'pilot-button secondary' : 'pilot-button');
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }
  function termNotice(term) {
    if (term.phase === 'expired') return 'expired';
    return term.status === 'suspended' ? 'suspended' : 'inactive';
  }
  function betterPromotion(state) {
    const o = state.offering;
    return o.promoCents === state.quoteCents && state.quoteCents < Math.round(o.regularCents * 80 / 100);
  }

  function catalogCover(data) {
    const cover = el('header', 'training-cover');
    const panel = el('div', 'training-cover-panel');
    panel.append(label('h1', 'directoryTitle'));
    if (data?.term.active) {
      const allowance = el('section', 'training-allowance');
      allowance.append(label('h2', 'credits'));
      const balances = el('ul');
      for (const [kind, singular, plural] of [['course', 'oneCourseLeft', 'coursesLeft'], ['masterclass', 'oneMasterLeft', 'mastersLeft']]) {
        const n = Math.max(0, 1 - data.used[kind]);
        const line = el('li');
        line.append(el('strong', '', String(n)), label('span', n === 1 ? singular : plural));
        balances.append(line);
      }
      allowance.append(balances);
      panel.append(allowance);
    } else if (data?.term.status === 'suspended' || (data?.term.status === 'active' && data.term.phase === 'expired')) {
      panel.append(label('p', termNotice(data.term), 'training-term-note'));
    }
    const figure = el('figure', 'training-cover-photo');
    const image = el('img');
    image.alt = '';
    image.width = 1368;
    image.height = 720;
    image.srcset = '/assets/training-city-684.webp 684w, /assets/training-city.webp 1368w';
    image.sizes = '(max-width: 660px) 100vw, (max-width: 1250px) 52vw, 650px';
    image.src = '/assets/training-city.webp';
    const caption = el('figcaption');
    const origin = el('a', '', 'Steffen Schmitz');
    origin.href = 'https://commons.wikimedia.org/wiki/File:Medell%C3%ADn,_San_Javier,_2023-07_CN-07.jpg';
    const license = el('a', '', 'CC BY-SA 4.0');
    license.href = 'https://creativecommons.org/licenses/by-sa/4.0/';
    const credit = el('span', 'training-photo-credit');
    credit.append(label('span', 'photoCredit'), ' © ', origin, ' / ', license);
    caption.append(el('span', 'training-photo-place', 'San Javier, Medellín'), credit);
    figure.append(image, caption);
    cover.append(panel, figure);
    return cover;
  }

  function calendarDate(course, showYear) {
    const value = course.startsOn || course.endsOn;
    if (!value) return label('span', 'undated', 'training-undated');
    const day = new Date(value + 'T12:00:00Z');
    const time = el('time', 'training-calendar-date');
    time.dateTime = value;
    const month = () => new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(day).replace(/\.$/, '');
    time.append(el('span', 'training-day', String(day.getUTCDate())), dynamic('span', month, 'training-month'));
    if (showYear) time.append(el('span', 'training-year', value.slice(0, 4)));
    return time;
  }
  function placeInfo(state) {
    const box = el('div', 'training-place');
    if (state.reservation?.status === 'pending') {
      box.append(label('strong', 'awaiting'), dynamic('span', () => money(state.reservation.priceCents)));
    } else if (state.enrolled) {
      box.append(label('strong', state.canAccess ? 'booked' : 'accessPaused'));
    } else if (!state.offering.open || !state.offering.available) {
      box.append(label('strong', state.offering.open ? 'full' : 'closed'));
    } else {
      if (state.canInclude) box.append(label('strong', 'includedPlace', 'training-included'));
      else if (state.quoteCents === 0) box.append(label('strong', 'free'));
      else if (state.quoteCents !== null) {
        box.append(dynamic('strong', () => money(state.quoteCents)));
        if (state.offering.promoCents === state.quoteCents && (!state.term.active || betterPromotion(state))) box.append(label('span', 'promo'));
        else if (state.term.active) box.append(label('span', 'founderPrice'));
      }
      const n = state.offering.available;
      box.append(dynamic('small', () => text(n === 1 ? 'oneSeat' : 'remainingSeats').replace('{n}', n)));
    }
    return box;
  }
  function agendaRow(course, state, legacyStatus, showYear) {
    const row = el('article', 'training-agenda-row');
    const link = el('a', 'training-activity-link');
    link.href = 'course.html?id=' + encodeURIComponent(course.id);
    const heading = source('h3', course, 'title');
    heading.id = 'activity-' + course.id;
    link.setAttribute('aria-labelledby', heading.id);
    const copy = el('div', 'training-activity-copy');
    if (state?.offering || !course.trainingConfigured) copy.append(label('span', state?.offering?.kind || 'course', 'training-format'));
    copy.append(heading, source('p', course, 'description'));
    if (course.startsOn && course.endsOn && course.startsOn !== course.endsOn) {
      copy.append(dynamic('small', () => text('until').replace('{date}', date(course.endsOn)), 'training-end'));
    }
    const info = state ? placeInfo(state) : el('div', 'training-place');
    if (!state && legacyStatus) info.append(tr('strong', legacyStatus));
    const arrow = el('span', 'training-row-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(calendarDate(course, showYear), copy, info, arrow);
    row.append(link);
    return row;
  }

  async function catalogue(root, courses, initial, legacyStatus) {
    let data = initial;
    let loadFailed = false;
    if (!data) {
      try { data = await api('/api/training'); }
      catch { loadFailed = true; }
    }
    const states = new Map((data?.offerings || []).map(s => [s.offering.courseId, s]));
    const ordered = [...courses].sort((a, b) => {
      if (a.trainingConfigured !== b.trainingConfigured) return Number(!!b.trainingConfigured) - Number(!!a.trainingConfigured);
      return (a.startsOn || '9999').localeCompare(b.startsOn || '9999');
    });
    const years = new Set(courses.map(c => (c.startsOn || c.endsOn || '').slice(0, 4)));
    const year = years.size === 1 ? [...years][0] : '';
    const agenda = el('section', 'training-agenda');
    const toolbar = el('div', 'training-agenda-header');
    const title = dynamic('h2', () => [text('agenda'), year].filter(Boolean).join(' '));
    title.id = 'agenda-title';
    agenda.setAttribute('aria-labelledby', title.id);
    toolbar.append(title);
    agenda.append(toolbar);
    const rows = ordered.map(c => {
      const state = states.get(c.id);
      const row = agendaRow(c, state, legacyStatus(c), !year);
      agenda.append(row);
      return {row, kind: state?.offering.kind || (c.trainingConfigured ? null : 'course')};
    });
    if (rows.some(r => r.kind === 'course') && rows.some(r => r.kind === 'masterclass')) {
      const controls = el('div', 'training-filters');
      controls.setAttribute('role', 'group');
      bind(controls, () => controls.setAttribute('aria-label', text('filters')));
      const buttons = [];
      for (const [kind, key] of [['all', 'all'], ['course', 'courses'], ['masterclass', 'masterclasses']]) {
        const button = label('button', key);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(kind === 'all'));
        button.addEventListener('click', () => {
          for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
          for (const item of rows) item.row.hidden = kind !== 'all' && kind !== item.kind;
        });
        buttons.push(button);
        controls.append(button);
      }
      toolbar.append(controls);
    }
    if (loadFailed) {
      const warning = el('div', 'training-load-error');
      const retry = action('retry', () => { retry.disabled = true; return catalogue(root, courses, null, legacyStatus); }, true);
      warning.append(label('p', 'loadError'), retry);
      toolbar.after(warning);
    } else if (!courses.length) toolbar.after(label('p', 'emptyAgenda'));
    else if (data.term.active && !states.size) toolbar.after(label('p', 'noOfferings'));
    const page = el('div', 'training-catalog');
    page.append(catalogCover(data), agenda);
    root.replaceChildren(page);
  }

  const endpoint = courseId => '/api/training/' + encodeURIComponent(courseId);
  const read = courseId => api(endpoint(courseId), undefined, undefined, { redirectOnUnauthorized: false });

  function detail(container, state, courseId, refreshCourse, initialMessage) {
    const offering = state.offering;
    if (!offering) return;
    let busy = false;
    const reservation = state.reservation;
    const pending = reservation?.status === 'pending';
    const free = state.quoteCents === 0;
    container.className = 'training-booking';
    const header = el('div', 'booking-header');
    const heading = label('h2', 'booking');
    heading.id = 'training-booking-title';
    container.setAttribute('aria-labelledby', heading.id);
    header.append(heading);
    if (!pending && !state.enrolled) {
      const count = dynamic('span', () => {
        if (!offering.open) return text('closed');
        if (!offering.available) return text('full');
        return text(offering.available === 1 ? 'oneSeat' : 'remainingSeats').replace('{n}', offering.available);
      }, 'booking-availability');
      header.append(count);
    }
    const actions = el('div', 'training-actions');
    const notice = el('p', 'pilot-status');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    const say = key => bind(notice, () => { notice.textContent = key ? text(key) : ''; });
    container.replaceChildren(header, actions, notice);
    if (initialMessage) { say(initialMessage); notice.tabIndex = -1; notice.focus(); }
    function priceLine(title, cents) {
      const row = el('dl', 'booking-price');
      row.append(label('dt', title), dynamic('dd', () => money(cents)));
      return row;
    }
    function drawActions(focusMode) {
      actions.replaceChildren();
      if (pending) {
        actions.append(label('p', 'pending', 'booking-state'), priceLine('reservedPrice', reservation.priceCents));
        addButton(actions, 'cancel', 'cancel', true);
        return;
      }
      if (state.enrolled) {
        actions.append(label('p', state.canAccess ? 'enrolled' : 'accessPaused', 'booking-state'));
        return;
      }
      if (state.term.status === 'suspended' || state.term.phase === 'expired') {
        actions.append(label('p', termNotice(state.term), 'booking-note'));
      }
      if (state.canInclude) {
        const included = el('div', 'booking-option');
        included.append(label('h3', offering.kind === 'course' ? 'includedCourse' : 'includedMaster'));
        actions.append(included);
        addButton(included, 'includedAction', 'included');
      }
      const rate = el('div', 'booking-option');
      if (free) {
        rate.append(label('h3', 'free'));
        if (state.term.active) rate.append(label('p', 'keepsBalance', 'booking-note'));
      } else if (state.quoteCents !== null) {
        const title = state.canInclude ? 'additionalSeat' : state.term.active && !betterPromotion(state) ? 'founderPrice' : 'price';
        rate.append(priceLine(title, state.quoteCents));
        if (state.quoteCents < offering.regularCents) {
          const original = el('p', 'booking-original');
          const reason = state.term.active ? (betterPromotion(state) ? 'betterPromo' : 'founderRate') : 'promo';
          const was = el('span', 'booking-was');
          was.append(label('span', 'regular', 'booking-price-caption'), dynamic('s', () => money(offering.regularCents)));
          original.append(label('span', reason), was);
          rate.append(original);
        }
      }
      if (!free && state.term.active && offering.includedEligible && state.used[offering.kind] >= 1) {
        rate.append(label('p', 'quota', 'booking-note'));
      }
      actions.append(rate);
      if (state.canReserveAdditional) {
        addButton(rate, free ? 'enrollFree' : state.term.active ? 'additionalAction' : 'reserve', 'additional', state.canInclude);
      }
      function addButton(parent, key, mode, secondary = false) {
        const button = action(key, () => review(mode), secondary);
        parent.append(button);
        if (focusMode === mode) button.focus();
      }
    }
    async function reload(message, mode) {
      try {
        const fresh = await read(courseId);
        if (fresh.enrolled && fresh.canAccess) { await refreshCourse(true); return; }
        if (!fresh.offering) { await refreshCourse(); return; }
        if (mode === 'cancel' && !fresh.reservation) message = 'released';
        if (mode === 'additional' && fresh.reservation?.status === 'pending') message = undefined;
        detail(container, fresh, courseId, refreshCourse, message);
        if (!message) { container.tabIndex = -1; container.focus(); }
      } catch {
        actions.replaceChildren(action('check', () => reload(message, mode), true));
        say('uncertain');
      }
    }
    function review(mode) {
      if (busy) return;
      const key = mode === 'additional' ? (free ? 'confirmFree' : 'confirmAdditional') : mode === 'cancel' ? 'confirmCancel' : offering.kind === 'course' ? 'confirmCourse' : 'confirmMaster';
      const prompt = dynamic('p', () => mode === 'additional' ? text(key).replace('{price}', money(state.quoteCents)) : text(key), 'booking-prompt');
      prompt.tabIndex = -1;
      const ok = action('confirm', async () => {
        if (busy) return;
        busy = true; ok.disabled = true; back.disabled = true; actions.setAttribute('aria-busy', 'true');
        let fresh;
        try {
          const url = endpoint(courseId) + '/reservations';
          fresh = mode === 'cancel'
            ? await api(url + '/' + encodeURIComponent(reservation.id), {}, 'DELETE', { redirectOnUnauthorized: false })
            : await api(url, mode === 'additional' ? { mode, expectedPriceCents: state.quoteCents } : { mode }, 'POST', { redirectOnUnauthorized: false });
        } catch (error) {
          await reload(error.status === 403 || error.status === 409 ? 'conflict' : 'uncertain', mode);
          return;
        } finally { actions.removeAttribute('aria-busy'); }
        if (fresh.enrolled && fresh.canAccess) {
          try { await refreshCourse(true); } catch { actions.replaceChildren(action('check', () => reload(), true)); say('uncertain'); }
        } else {
          detail(container, fresh, courseId, refreshCourse, mode === 'cancel' ? 'released' : undefined);
          if (mode !== 'cancel') { container.tabIndex = -1; container.focus(); }
        }
      });
      const back = action('back', () => drawActions(mode), true);
      const controls = el('div', 'booking-controls');
      controls.append(ok, back);
      actions.replaceChildren(prompt, controls);
      prompt.focus();
    }
    drawActions();
  }
  function failed(container, reload) {
    const retry = action('retry', async () => { retry.disabled = true; try { await reload(); } finally { retry.disabled = false; } }, true);
    container.replaceChildren(label('p', 'loadError'), retry);
  }
  window.nodalTraining = { catalogue, read, detail, failed, label, text };
})();
