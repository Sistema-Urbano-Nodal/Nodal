/* The Founder Membership 2027 (Membresía Fundador 2027), the paid membership as its commercial terms fix it
   (web/pages/terminos-fundadores.html, spec docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md). Prices,
   dates and the seller come from this terms version, never from a setting: a change is a new version, which every
   acceptance records. Lima is UTC-05:00 all year. effectiveFromAt is the first moment of effectiveFrom there: the
   terms apply to purchases from then on, so nothing is sold before it. endsAt is the first moment of 1 Jan 2027;
   first payments are accepted until just before it. */
export const FUNDADORES_2027 = Object.freeze({
  name: 'Membresía Fundador 2027', version: 'FUNDADORES-2027-v1', effectiveFrom: '2026-10-21', effectiveFromAt: '2026-10-21T05:00:00.000Z',
  endsAt: '2027-01-01T05:00:00.000Z', earlyAccessUntil: '2026-12-31', membershipFrom: '2027-01-01', membershipTo: '2027-12-31',
  renewalFrom: '2028-01-01', renewalDiscountPercent: 5, gracePeriodDays: 10, additionalTrainingDiscountPercent: 20,
  options: Object.freeze({
    once: Object.freeze({ amount: 'S/ 499' }),
    installments: Object.freeze({ each: 'S/ 275', total: 'S/ 550', count: 2, monthsApart: 2 }),
  }),
  seller: Object.freeze({ name: 'Sistema Urbano', ruc: '20605878815', address: 'Calle General Varela 154 A, Miraflores' }),
});

const { options } = FUNDADORES_2027;

// What GET /api/billing/config publishes about the offer: its dates and the seller, not the internal percentages.
export const OFFER_VIEW = Object.freeze({
  ...Object.fromEntries(['name', 'version', 'effectiveFrom', 'endsAt', 'earlyAccessUntil', 'membershipFrom', 'membershipTo', 'renewalFrom'].map((key) => [key, FUNDADORES_2027[key]])),
  seller: FUNDADORES_2027.seller,
});

// Each option as the config lists it ('amount' is what the member pays in all), and as an acceptance records it.
export const OPTION_VIEWS = Object.freeze({
  once: Object.freeze({ id: 'once', amount: options.once.amount }),
  installments: Object.freeze({ id: 'installments', amount: options.installments.total, each: options.installments.each, count: options.installments.count, monthsApart: options.installments.monthsApart }),
});
export const OPTION_AMOUNT_TEXT = Object.freeze({
  once: options.once.amount,
  installments: `${options.installments.count} × ${options.installments.each} (${options.installments.total})`,
});
