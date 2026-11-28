// The annual training entitlement is separate from the permanent Founder badge.
(() => {
  'use strict';
  const words = {
    term: ['2027 training membership', 'Membresía de formación 2027', 'Membresia de formação 2027'],
    email: ['Member email', 'Correo del miembro', 'E-mail do membro'],
    lookup: ['Look up membership', 'Consultar membresía', 'Consultar membresia'],
    termStatus: ['Training access', 'Acceso a formación', 'Acesso à formação'],
    active: ['Active', 'Activo', 'Ativo'],
    suspended: ['Suspended', 'Suspendido', 'Suspenso'],
    inactive: ['Inactive', 'Inactivo', 'Inativo'],
    activate: ['Activate verified membership', 'Activar membresía verificada', 'Ativar membresia verificada'],
    suspend: ['Suspend training benefits', 'Suspender beneficios de formación', 'Suspender benefícios de formação'],
    verifyActive: ['Have you verified that this member accepted the terms and their first payment was approved by December 31, 2026?', '¿Verificaste que esta persona aceptó las condiciones y que su primer pago se aprobó a más tardar el 31 de diciembre de 2026?', 'Você verificou que esta pessoa aceitou os termos e que o primeiro pagamento foi aprovado até 31 de dezembro de 2026?'],
    verifySuspended: ['Have you verified that access has ended, including any applicable grace period?', '¿Verificaste que terminó el derecho de acceso, incluido el plazo de gracia aplicable?', 'Você verificou o encerramento do direito de acesso, incluindo o prazo de carência aplicável?'],
    managed: ['Members enroll through the 2027 training catalog. Verify payments for additional reservations in Course setup.', 'Los miembros se inscriben en el catálogo de formación 2027. Los pagos de reservas adicionales se verifican en la configuración de la actividad.', 'Os membros se inscrevem no catálogo de formação 2027. Verifique os pagamentos das reservas adicionais na configuração da atividade.'],
    settings: ['2027 training and reservations', 'Formación 2027 y reservas', 'Formação 2027 e reservas'],
    dateHint: ['Set the activity start date in 2027 to configure its training benefits.', 'Define una fecha de inicio en 2027 para configurar los beneficios de esta actividad.', 'Defina uma data de início em 2027 para configurar os benefícios desta atividade.'],
    kind: ['Activity type', 'Tipo de actividad', 'Tipo de atividade'],
    course: ['Course', 'Curso', 'Curso'],
    masterclass: ['Masterclass', 'Masterclass', 'Masterclass'],
    included: ['Eligible for an included Founder place', 'Elegible para una plaza incluida de Fundador', 'Elegível para uma vaga incluída de Fundador'],
    regular: ['General fee (S/)', 'Tarifa general (S/)', 'Tarifa geral (S/)'],
    promo: ['Promotional fee (S/, optional)', 'Tarifa promocional (S/, opcional)', 'Tarifa promocional (S/, opcional)'],
    capacity: ['Places', 'Cupos', 'Vagas'],
    save: ['Save training settings', 'Guardar condiciones', 'Salvar condições'],
    saved: ['Settings saved.', 'Condiciones guardadas.', 'Condições salvas.'],
    pending: ['Pending payment verification', 'Reservas pendientes de verificar', 'Reservas pendentes de verificação'],
    refresh: ['Refresh reservations', 'Actualizar reservas', 'Atualizar reservas'],
    none: ['No payments awaiting verification.', 'No hay pagos pendientes de verificar.', 'Não há pagamentos pendentes de verificação.'],
    confirm: ['Confirm verified payment', 'Confirmar pago verificado', 'Confirmar pagamento verificado'],
    verifyPayment: ['Have you verified receipt of this amount for this account?', '¿Verificaste la recepción de este importe para esta cuenta?', 'Você verificou o recebimento deste valor para esta conta?'],
    confirmed: ['Payment confirmed. The place is enrolled.', 'Pago confirmado. La plaza está inscrita.', 'Pagamento confirmado. A inscrição foi efetuada.'],
    error: ['Could not complete the request. Please retry.', 'No se pudo completar la solicitud. Vuelve a intentarlo.', 'Não foi possível concluir a solicitação. Tente novamente.'],
    invalid: ['Check the dates, prices and available places.', 'Revisa las fechas, tarifas y cupos.', 'Verifique as datas, os preços e as vagas.'],
    conflict: ['The record has changed or is unavailable. Reload it before continuing.', 'El registro cambió o no está disponible. Vuelve a consultarlo.', 'O registro mudou ou está indisponível. Consulte-o novamente.'],
    missing: ['No matching record was found.', 'No se encontró el registro.', 'Registro não encontrado.'],
    load: ['Load settings', 'Cargar condiciones', 'Carregar condições'],
  };
  const lang = () => window.nodalI18n?.lang || document.documentElement.lang;
  const staffText = key => words[key][({ es: 1, pt: 2 })[lang()] || 0];
  function labelText(node, key) {
    node.dataset.trainingAdminWord = key;
    node.textContent = staffText(key);
    return node;
  }
  function element(tag, key, className) {
    const node = document.createElement(tag);
    if (key) labelText(node, key);
    if (className) node.className = className;
    return node;
  }
  function button(key, className) {
    const node = element('button', key, className || 'pilot-button secondary');
    node.type = 'button';
    return node;
  }
  function line() {
    const node = element('p');
    node.setAttribute('role', 'status');
    return node;
  }
  function field(container, key, type) {
    const label = element('label');
    const input = element(type === 'select' ? 'select' : 'input');
    if (type !== 'select') input.type = type;
    input.name = key;
    label.append(element('span', key), input);
    container.append(label);
    return input;
  }
  async function request(path, method = 'GET', body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(), { status: res.status });
    return res.json();
  }
  function failure(node, err) {
    labelText(node, ({ 400: 'invalid', 404: 'missing', 409: 'conflict', 422: 'invalid' })[err.status] || 'error');
  }
  function money(cents) {
    return new Intl.NumberFormat(lang(), { style: 'currency', currency: 'PEN' }).format(cents / 100);
  }
  function membershipPanel(host) {
    const form = element('form', null, 'admin-founder-form');
    const email = field(form, 'email', 'email');
    email.required = true;
    email.autocomplete = 'off';
    const lookup = button('lookup', 'admin-button');
    lookup.type = 'submit';
    const msg = line(), settings = element('div');
    const path = '/api/admin/training/membership';
    let busy = false;
    function show(member, status) {
      settings.replaceChildren();
      const state = element('p');
      state.append(element('span', 'termStatus'), document.createTextNode(' · '), element('strong', ['active', 'suspended'].includes(status) ? status : 'inactive'));
      const next = status === 'active' ? 'suspended' : 'active';
      const save = button(next === 'active' ? 'activate' : 'suspend', 'admin-button admin-button-accent');
      save.addEventListener('click', async () => {
        if (busy || email.value.trim() !== member) return;
        if (!window.confirm(member + '\n' + staffText(next === 'active' ? 'verifyActive' : 'verifySuspended'))) return;
        busy = true; lookup.disabled = save.disabled = email.disabled = true;
        try {
          const { term } = await request(path, 'PUT', { email: member, status: next, verified: true });
          show(member, term.status);
        } catch (err) { failure(msg, err); }
        finally { busy = false; lookup.disabled = save.disabled = email.disabled = false; }
      });
      settings.append(state, save);
    }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const member = email.value.trim();
      busy = true; lookup.disabled = email.disabled = true;
      msg.replaceChildren(); delete msg.dataset.trainingAdminWord;
      settings.replaceChildren();
      try {
        const { term } = await request(path + '/lookup', 'POST', { email: member });
        show(member, term.status);
      } catch (err) { failure(msg, err); }
      finally { busy = false; lookup.disabled = email.disabled = false; }
    });
    email.addEventListener('input', () => { settings.replaceChildren(); msg.replaceChildren(); delete msg.dataset.trainingAdminWord; });
    form.append(lookup, msg, settings);
    host.append(element('h3', 'term'), form);
  }

  function coursePanel(course, dirty, onConfigured) {
    const details = element('details', null, 'pilot-editor-section');
    details.append(element('summary', 'settings'));
    const base = '/api/admin/training/' + encodeURIComponent(course.id);
    const content = element('div', null, 'pilot-form');
    const notice = line(), reload = button('load');
    details.append(content, reload, notice);
    let loaded = false, loading = false;
    function editor(config) {
      const form = element('form', null, 'pilot-form');
      const kind = field(form, 'kind', 'select');
      for (const key of ['course','masterclass']) {
        const option = element('option', key); option.value = key; kind.append(option);
      }
      kind.value = config?.kind || 'course';
      const included = field(form, 'included', 'checkbox');
      included.checked = config?.includedEligible ?? true;
      const centsField = (key, cents) => {
        const input = field(form, key, 'number');
        input.step = '0.01'; input.min = '0'; input.max = '1000000'; input.required = key === 'regular';
        if (cents != null) input.value = (cents / 100).toFixed(2);
        return input;
      };
      const regular = centsField('regular', config?.regularCents);
      const promo = centsField('promo', config?.promoCents);
      const capacity = field(form, 'capacity', 'number');
      capacity.required = true; capacity.min = '1'; capacity.max = '100000'; capacity.step = '1';
      if (config) capacity.value = config.capacity;
      const save = button('save', 'pilot-button');
      save.type = 'submit';
      const result = line();
      form.addEventListener('input', () => dirty.add(form));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (save.disabled) return;
        const offering = { kind: kind.value, includedEligible: included.checked,
          regularCents: Math.round(regular.valueAsNumber * 100),
          promoCents: promo.value === '' ? null : Math.round(promo.valueAsNumber * 100),
          capacity: capacity.valueAsNumber };
        const controls = [...form.elements]; controls.forEach(control => { control.disabled = true; });
        try {
          await request(base + '/offering', 'PUT', offering);
          dirty.delete(form); labelText(result, 'saved'); onConfigured();
        } catch (err) { failure(result, err); }
        finally { controls.forEach(control => { control.disabled = false; }); }
      });
      form.append(save, result);
      return form;
    }
    function pending() {
      const section = element('section'), list = element('ul'), result = line(), refresh = button('refresh');
      let revision = 0;
      async function update() {
        const sequence = ++revision;
        refresh.disabled = true;
        list.replaceChildren();
        try {
          const { reservations } = await request(base + '/reservations');
          if (sequence !== revision) return;
          for (const row of reservations) {
            const li = element('li');
            const description = row.email + ' · ' + money(row.priceCents);
            const confirm = button('confirm');
            confirm.addEventListener('click', async () => {
              if (confirm.disabled || !window.confirm(description + '\n' + staffText('verifyPayment'))) return;
              confirm.disabled = true;
              try {
                await request(base + '/confirm', 'POST', { email: row.email, reservationId: row.id, expectedPriceCents: row.priceCents, verified: true });
                li.remove(); labelText(result, 'confirmed');
              } catch (err) { failure(result, err); confirm.disabled = false; }
            });
            li.append(document.createTextNode(description + ' '), confirm);
            list.append(li);
          }
          if (!reservations.length) labelText(result, 'none');
          else { delete result.dataset.trainingAdminWord; result.replaceChildren(); }
        } catch (err) { if (sequence === revision) failure(result, err); }
        finally { if (sequence === revision) refresh.disabled = false; }
      }
      refresh.addEventListener('click', update);
      section.append(element('h3', 'pending'), refresh, list, result);
      update();
      return section;
    }
    async function load() {
      if (loaded || loading || !details.open) return;
      if (!String(course.startsOn).startsWith('2027-')) {
        labelText(notice, 'dateHint'); reload.hidden = true; return;
      }
      loading = true; reload.hidden = true;
      try {
        const { offering } = await request(base + '/offering');
        content.replaceChildren(editor(offering), pending());
        notice.replaceChildren(); delete notice.dataset.trainingAdminWord; loaded = true;
      } catch (err) { failure(notice, err); reload.hidden = false; }
      finally { loading = false; }
    }
    reload.addEventListener('click', load);
    details.addEventListener('toggle', load);
    return details;
  }

  window.nodalTrainingAdmin = { coursePanel, participantNote: () => element('p', 'managed', 'pilot-data-note') };
  const host = document.getElementById('trainingMembershipAdmin');
  if (host) membershipPanel(host);
  window.nodalI18n?.onChange(() => {
    for (const node of document.querySelectorAll('[data-training-admin-word]')) {
      node.textContent = staffText(node.dataset.trainingAdminWord);
    }
  });
})();
