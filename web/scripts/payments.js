/* payments: the annual Supporting membership, paid on Mercado Pago through the
   links the team sets in the environment (GET /api/billing/config). NODAL never
   sees the payment: each offered option opens Mercado Pago in a new tab, and the
   page says what happens next, with the member's NODAL email to pay with. */
(() => {
  'use strict';
  const I18N = window.nodalI18n;
  const t = (key) => (I18N ? I18N.t(key) : key);

  // The deploy template's period wordings; any other is the operator's own and is shown as written.
  const COPY = new Map([['Soon', 'y.soon'], ['/ year', 'y.perYear'], ['/year', 'y.perYear'], ['/ yr', 'y.perYear']]);
  const localise = (value) => (COPY.has(value) ? t(COPY.get(value)) : value);
  const LABELS = { once: 'y.mp.payOnce', installments: 'y.mp.payInstallments' };
  // The server only offers https Mercado Pago Peru links; the page checks again before making one a button.
  const MERCADO_PAGO = /^(?:[a-z0-9-]+\.)*mercadopago\.com\.pe$|^mpago\.l[ai]$/;
  const mercadoPagoLink = (value) => {
    try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && MERCADO_PAGO.test(url.hostname) ? url.href : null; } catch { return null; }
  };

  const els = {
    amount: document.getElementById('proPrice'),
    per: document.getElementById('proPer'),
    options: document.getElementById('payOptions'),
    soon: document.getElementById('paySoon'),
    email: document.getElementById('payEmail'),
    emailStep: document.getElementById('payEmailStep'),
  };
  // bail out cleanly if the page structure changes — never throw on load
  if (Object.values(els).some((el) => !el)) return;

  let annual = { amount: 'Soon', per: '' }, options = [];

  function clean(data) {
    if (!data || typeof data !== 'object' || data.checkout !== true || !Array.isArray(data.options)) return;
    options = data.options.flatMap((option) => {
      const url = mercadoPagoLink(option?.url), amount = typeof option?.amount === 'string' ? option.amount.trim() : '';
      return Object.hasOwn(LABELS, option?.id) && url && amount ? [{ id: option.id, url, amount }] : [];
    });
    if (options.length) annual = { amount: String(data.annual?.amount || options[0].amount), per: String(data.annual?.per || '') };
  }

  function render() {
    const open = options.length > 0;
    els.amount.textContent = open ? annual.amount : localise('Soon');
    els.per.textContent = open ? localise(annual.per) : '';
    els.soon.hidden = open;
    els.options.replaceChildren(...options.map((option, index) => {
      const link = document.createElement('a'), label = document.createElement('span'), amount = document.createElement('span');
      link.className = index === 0 && option.id === 'once' ? 'btn btn-primary' : 'btn btn-ghost';
      link.href = option.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.dataset.option = option.id;
      label.textContent = t(LABELS[option.id]); amount.className = 'pay-option-amount'; amount.textContent = option.amount;
      link.append(label, amount);
      return link;
    }));
  }

  async function load() {
    try {
      const res = await fetch('/api/billing/config', { headers: { Accept: 'application/json' } });
      if (res.ok) clean(await res.json());
    } catch {
      // Static hosting or offline demos keep "Soon".
    }
    render();
  }

  async function showEmail() {
    let email = '';
    try {
      const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
      if (res.ok) { const data = await res.json(); if (typeof data?.user?.email === 'string') email = data.user.email; }
    } catch {
      // Without it the step still reads correctly, only without the address.
    }
    els.email.textContent = email;
    els.emailStep.hidden = !email;
  }

  render();
  load();
  showEmail();
  I18N?.onChange(render);
})();
