/* payments: billing cycle toggle + order summary + provider seam.
   Stripe checkout is created server-side. The local fallback only appears
   when the current environment is intentionally not configured for payments. */
(() => {
  const I18N = window.nodalI18n;
  const t = (key) => (I18N ? I18N.t(key) : key);

  
  const BILLING_COPY = new Map([
    ['Monthly', 'y.cycleMonthly'],
    ['Annual', 'y.cycleAnnual'],
    ['Free', 'y.free'],
    ['Soon', 'y.soon'],
    ['Cancel anytime.', 'y.cancelAnytime'],
    ['Every month, until you cancel', 'y.renewsMonthly'],
    ['Every 12 months, until you cancel', 'y.renewsAnnual'],
    // the period suffix the deploy template suggests; any other wording is the
    // operator's own and is shown exactly as they wrote it
    ['/ month', 'y.perMonth'], ['/month', 'y.perMonth'], ['/ mo', 'y.perMonth'],
    ['/ year', 'y.perYear'], ['/year', 'y.perYear'], ['/ yr', 'y.perYear'],
  ]);
  const localise = (value) => (BILLING_COPY.has(value) ? t(BILLING_COPY.get(value)) : value);

  let pricing = {
    monthly: {
      label: 'Monthly',
      amount: 'Soon',
      per: '',
      note: 'Cancel anytime.',
      renews: 'Every month, until you cancel',
      badge: '',
    },
    annual: {
      label: 'Annual',
      amount: 'Soon',
      per: '',
      note: '',
      renews: 'Every 12 months, until you cancel',
      badge: '',
    },
  };

  const els = {
    monthly: document.getElementById('cycleMonthly'),
    annual:  document.getElementById('cycleAnnual'),
    amount:  document.getElementById('proPrice'),
    per:     document.getElementById('proPer'),
    note:    document.getElementById('proNote'),
    cycle:   document.getElementById('sumCycle'),
    price:   document.getElementById('sumPrice'),
    renews:  document.getElementById('sumRenews'),
    annualBadge: document.getElementById('cycleAnnualBadge'),
  };
  // bail out cleanly if the page structure changes — never throw on load
  if (Object.values(els).some((el) => !el)) return;

  let currentCycle = 'monthly';

  function setCycle(key) {
    currentCycle = key;
    const p = pricing[key];
    const amount = localise(p.amount);
    els.amount.textContent = amount;
    const per = localise(p.per);
    els.per.textContent = per;
    els.note.textContent = localise(p.note);
    els.cycle.textContent = localise(p.label);
    els.price.textContent = [amount, per].filter(Boolean).join(' ');
    els.renews.textContent = localise(p.renews);

    const on = key === 'monthly';
    els.monthly.classList.toggle('is-on', on);
    els.annual.classList.toggle('is-on', !on);
    els.monthly.setAttribute('aria-pressed', String(on));
    els.annual.setAttribute('aria-pressed', String(!on));
    if (els.annualBadge) {
      els.annualBadge.textContent = pricing.annual.badge || '';
      els.annualBadge.hidden = !pricing.annual.badge;
    }
  }

  function cleanCycle(raw, fallback) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      label: String(value.label || fallback.label),
      amount: String(value.amount || fallback.amount),
      per: String(value.per || fallback.per),
      note: String(value.note || fallback.note),
      renews: String(value.renews || fallback.renews),
      badge: String(value.badge || fallback.badge),
    };
  }

  async function loadBillingConfig() {
    try {
      const res = await fetch('/api/billing/config', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      pricing = {
        monthly: cleanCycle(data.cycles?.monthly, pricing.monthly),
        annual: cleanCycle(data.cycles?.annual, pricing.annual),
      };
      setCycle(currentCycle);
    } catch {
      // Static hosting or offline demos keep the neutral "configured at checkout" copy.
    }
  }

  els.monthly.addEventListener('click', () => setCycle('monthly'));
  els.annual.addEventListener('click', () => setCycle('annual'));
  setCycle(currentCycle);
  loadBillingConfig();

  /* payment providers, tried in order; the fallback only reports local misconfiguration */
  const PROVIDERS = [
    {
      id: 'stripe',
      async checkout({ plan, cycle }) {
        let res;
        try {
          res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, cycle }),
            signal: AbortSignal.timeout(8000),   // a hung request must not strand the button
          });
        } catch { return { status: 'unavailable' }; }       // static hosting / timeout
        if (res.status === 401) return { status: 'auth' };
        if (!res.ok) return { status: 'unavailable' };       // 501 = not configured
        const data = await res.json().catch(() => null);
        if (!data || typeof data.url !== 'string') return { status: 'unavailable' };
        let host;
        try { host = new URL(data.url).hostname; } catch { return { status: 'unavailable' }; }
        if (host !== 'checkout.stripe.com') return { status: 'unavailable' };
        return { status: 'redirect', url: data.url };
      },
    },
    { id: 'local-fallback', async checkout() { return { status: 'local-fallback' }; } },
  ];

  const selectPro = document.getElementById('selectPro');
  const summaryCheckout = document.getElementById('summaryCheckout');
  const summary = document.querySelector('.pay-summary');
  const payNote = document.getElementById('payCheckoutNote');

  const setNote = (message) => {
    if (!payNote) return;
    payNote.textContent = message;
    payNote.hidden = false;
  };

  const setBusy = (busy) => {
    if (selectPro) selectPro.disabled = busy;
    if (summaryCheckout) summaryCheckout.disabled = busy;
  };

  async function refreshBillingStatus() {
    try {
      const res = await fetch('/api/billing/status', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (!res.ok) throw new Error('status unavailable');
      const data = await res.json();
      if (data.subscription?.active) {
        setNote(t('y.confirmed'));
      } else if (data.subscription?.status && data.subscription.status !== 'none') {
        setNote(`${t('y.returned')} ${t('y.pending')} ${data.subscription.status}.`);
      } else {
        setNote(t('y.returnedWait'));
      }
    } catch {
      setNote(t('y.returnedUnknown'));
    }
  }

  // returning from a hosted checkout (?checkout=success|cancelled)
  const backFrom = new URLSearchParams(location.search).get('checkout');
  if (payNote && (backFrom === 'success' || backFrom === 'cancelled')) {
    if (backFrom === 'success') refreshBillingStatus();
    else setNote(t('y.cancelled'));
  }

  async function startCheckout() {
    setBusy(true);
    for (const provider of PROVIDERS) {
      const result = await provider.checkout({ plan: 'membership', cycle: currentCycle });
      if (result.status === 'auth') {
        location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (result.status === 'redirect') { location.assign(result.url); return; }
      if (result.status === 'local-fallback') break;
    }
    setBusy(false);
    setNote(t('y.notConfigured'));
    summary?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  selectPro?.addEventListener('click', () => { startCheckout(); });
  summaryCheckout?.addEventListener('click', () => { startCheckout(); });
  I18N?.onChange(() => setCycle(currentCycle));
})();
