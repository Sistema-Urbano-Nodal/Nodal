/* payments: Nodal Fundadores 2027, the annual membership paid on Mercado Pago
   (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md). The page carries the text of one terms version;
   GET /api/billing/config says whether sign-ups are open, which payment options are offered at what amounts, and the
   contact details. Continuing records the member's three acceptances (POST /api/membership/acceptances), whose answer
   is the Mercado Pago link for the chosen option, opened in this tab. NODAL never sees the payment. */
(() => {
  'use strict';
  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);

  // The terms version this page's text describes. An answer on another version is not sold from it: the member reloads.
  const TERMS = 'FUNDADORES-2027-v1';
  const OPTIONS = ['once', 'installments'];
  const AUTHORIZATION = { once: 'y.fund.authOnce', installments: 'y.fund.authTwice' };
  // What the box says when there is nothing to buy. Until the offer is read it says only that it is loading.
  const CLOSED = { loading: 'y.fund.loading', failed: 'y.fund.loadError', soon: 'y.fund.soon', ended: 'y.fund.ended', outdated: 'y.fund.outdated' };
  const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  // An amount is printed with no-break spaces, so a line never ends between the currency sign and its number.
  const amountText = (value) => text(value).replace(/\s+/g, '\u00a0');
  const nothing = (state) => ({ state, offers: {}, contact: null, seller: null, version: null });
  const httpsUrl = (value) => {
    try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  };

  const IDS = {
    form: 'fundForm', choose: 'modalidad', closed: 'payClosed', purchase: 'payPurchase',
    choiceOnce: 'payChoiceOnce', choiceInstallments: 'payChoiceInstallments', radioOnce: 'payOptionOnce', radioInstallments: 'payOptionInstallments',
    onceAmount: 'payOnceAmount', installmentsTotal: 'payInstallmentsTotal', installmentsText: 'payInstallmentsText',
    terms: 'payAcceptTerms', payment: 'payAcceptPayment', renewal: 'payAcceptRenewal', paymentRow: 'payPaymentRow', paymentText: 'payPaymentText', paymentHint: 'payPaymentHint',
    email: 'payEmail', emailStep: 'payEmailStep', submit: 'payContinue', hint: 'payHint', status: 'payStatus', retry: 'payRetry',
    seller: 'paySellerName', ruc: 'paySellerRuc', address: 'paySellerAddress', contact: 'payContactEmail', contactPending: 'payContactPending', complaints: 'payComplaints', complaintsPending: 'payComplaintsPending',
  };
  const els = Object.fromEntries(Object.entries(IDS).map(([name, id]) => [name, document.getElementById(id)]));
  // bail out cleanly if the page structure changes — never throw on load
  if (Object.values(els).some((el) => !el)) return;
  const choice = { once: els.choiceOnce, installments: els.choiceInstallments }, radio = { once: els.radioOnce, installments: els.radioInstallments };
  const boxes = [els.terms, els.payment, els.renewal];
  // Every acceptance is ticked on the visit that sends it: never one a browser brings back from an earlier visit.
  const untick = () => { for (const input of [...boxes, ...Object.values(radio)]) input.checked = false; };

  let offer = nothing('loading'), notice = '', busy = false;

  // What the page may sell from an answer: only this page's terms version, with an offered option and both contact details.
  function read(data) {
    const valid = Boolean(data) && typeof data === 'object';
    const email = text(data?.contact?.email), complaints = httpsUrl(data?.contact?.complaintsUrl);
    const contact = valid && EMAIL.test(email) && complaints ? { email, complaints } : null;
    const offers = {};
    for (const option of valid && Array.isArray(data.options) ? data.options : []) {
      const amount = amountText(option?.amount), each = amountText(option?.each);
      if (option?.id === 'once' && amount) offers.once = { amount };
      if (option?.id === 'installments' && amount && each) offers.installments = { total: amount, each };
    }
    let state = valid && data.state === 'ended' ? 'ended' : 'soon';
    if (valid && data.state === 'open' && data.checkout === true && contact && Object.keys(offers).length) state = data.offer?.version === TERMS ? 'open' : 'outdated';
    return { state, offers: state === 'open' ? offers : {}, contact, seller: valid ? data.offer?.seller : null, version: valid ? data.offer?.version : null };
  }

  const chosen = () => OPTIONS.find((option) => radio[option].checked && !radio[option].disabled) ?? null;

  function gate() {
    const ready = offer.state === 'open' && Boolean(chosen()) && boxes.every((box) => box.checked);
    els.submit.disabled = busy || !ready;
    els.hint.hidden = ready;
  }

  function render() {
    const { state, offers, contact, seller } = offer, open = state === 'open';
    els.choose.hidden = !open;
    els.purchase.hidden = !open;
    els.closed.hidden = open;
    els.closed.textContent = open ? '' : t(CLOSED[state]);
    els.retry.hidden = state !== 'failed';
    for (const option of OPTIONS) {
      choice[option].hidden = !offers[option];
      radio[option].disabled = !offers[option];
      if (!offers[option]) radio[option].checked = false;
    }
    els.onceAmount.textContent = offers.once?.amount ?? '';
    els.installmentsTotal.textContent = offers.installments ? t('y.fund.twiceTotal', { total: offers.installments.total }) : '';
    els.installmentsText.textContent = offers.installments ? t('y.fund.twiceText', { each: offers.installments.each }) : '';
    // The payment authorization is the chosen option's own, with its amounts.
    const option = chosen();
    if (!option) els.payment.checked = false;
    els.paymentRow.hidden = !option;
    els.paymentHint.hidden = Boolean(option);
    els.paymentText.textContent = option ? t(AUTHORIZATION[option], offers[option]) : '';
    // The seller's details come with the offer; the markup's copy stands in on static hosting.
    for (const [el, value] of [[els.seller, seller?.name], [els.ruc, seller?.ruc], [els.address, seller?.address]]) if (text(value)) el.textContent = text(value);
    els.contact.hidden = els.complaints.hidden = !contact;
    els.contactPending.hidden = els.complaintsPending.hidden = Boolean(contact);
    if (contact) { els.contact.href = `mailto:${contact.email}`; els.contact.textContent = contact.email; els.complaints.href = contact.complaints; }
    els.status.textContent = notice ? t(notice) : '';
    els.status.dataset.tone = notice === 'y.fund.error' ? 'error' : '';
    gate();
  }

  function say(key) { notice = key; render(); }

  // After an answer that changes the box under the member, focus moves to the message that says what happened: the
  // button they pressed is off or gone, and the page body would say nothing.
  const focusMessage = () => (els.purchase.hidden ? els.closed : els.status).focus();

  async function load() {
    let next;
    try {
      const res = await fetch('/api/billing/config', { headers: { Accept: 'application/json' } });
      // Static hosting has no API, and reads as sign-ups opening soon. Any other refusal is a failure the member can retry.
      next = res.ok ? read(await res.json()) : res.status === 404 ? read(null) : nothing('failed');
    } catch {
      next = nothing('failed');   // offline, or an answer that is not JSON
    }
    offer = next;
    render();
  }

  els.retry.addEventListener('click', async () => {
    offer = nothing('loading');
    render();
    els.closed.focus();   // the button is hidden while the offer loads
    await load();
    if (!els.purchase.hidden) (radio.once.disabled ? radio.installments : radio.once).focus();
    else els.closed.focus();
  });

  async function accept(option) {
    try {
      const res = await fetch('/api/membership/acceptances', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ option, version: offer.version, accept: { terms: true, payment: true, renewal: true } }),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    } catch {
      return { status: 0, data: null };
    }
  }

  // A new option comes with its own authorization, which the member ticks again.
  els.form.addEventListener('change', (event) => {
    if (event.target?.name === 'option') els.payment.checked = false;
    render();
  });

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const option = chosen();
    if (busy || els.submit.disabled || !option) return;
    busy = true;
    say('y.fund.sending');
    const { status, data } = await accept(option);
    // The server only answers with Mercado Pago links; the page still follows nothing but https. The button stays off while the browser leaves.
    const url = status === 201 ? httpsUrl(data?.url) : null;
    if (url) { location.assign(url); return; }
    if (status === 401) { location.assign(`/login.html?next=${encodeURIComponent(location.pathname)}`); return; }
    busy = false;
    if (status === 409) {
      // The terms changed since the page read them: nothing accepted before stands.
      untick();
      notice = 'y.fund.changed';
      await load();
    } else if (status === 410) {
      offer = { ...offer, state: 'ended', offers: {} };
      say('');
    } else {
      say('y.fund.error');
    }
    focusMessage();
  });

  // A page brought back from the back/forward cache (Back from Mercado Pago) keeps its script state: its ticks, and the
  // button off while the browser was leaving. The member starts the acceptance again.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    untick();
    busy = false;
    notice = '';
    render();
  });

  async function showEmail() {
    let email = '';
    try {
      const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
      if (res.ok) { const data = await res.json(); if (typeof data?.user?.email === 'string') email = data.user.email; }
    } catch {
      // Without it the line is hidden, never shown without the address.
    }
    els.email.textContent = email;
    els.emailStep.hidden = !email;
  }

  // A browser that restored the form's saved state did so while parsing it, before this deferred script.
  untick();
  render();
  load();
  showEmail();
  I18N?.onChange(render);
})();
