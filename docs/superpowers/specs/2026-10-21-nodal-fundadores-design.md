# Nodal Fundadores 2027: membership page, commercial terms and purchase acceptance

Date: 21 Oct 2026. The source is the team's document "Condiciones de pago y membresía de pago" (11 pages; text in `terms-source.txt`). It has three parts:
- section 1: web text for the membership page;
- section 2: the full commercial terms;
- section 3: the acceptance text.

The user chose defaults for what the document leaves open, as listed below.

## Why

The Supporting membership on NODAL becomes **Nodal Fundadores 2027**, paid on Mercado Pago through two links:
- **Pago único:** S/ 499.
- **Dos pagos:** S/ 275 now plus S/ 275 two calendar months later, S/ 550 in total, through a subscription plan limited to 2 charges.

The team's document fixes the prices, the benefits and the validity, along with the renewal, grace-period and refund rules. Its "PARA NOSOTRAS" note asks that before anyone pays:
- the page shows the full information;
- the purchase asks for unticked acceptances, showing only the payment authorization for the option chosen;
- NODAL keeps an identifiable record of what each person accepted.

The current payments page contradicts the terms ("12 months from your payment", "doesn't renew"), so it must be replaced in the same deploy that turns the links on. The links are already set in Vercel.

## Decisions (defaults the user accepted)

- **Effective date:** 21 October 2026. **Terms version:** `FUNDADORES-2027-v1`.
- **General conditions of use:** NODAL has none yet. The terms keep the sentence that mentions them but without a link. The privacy-policy link is `/privacy.html`.
- **Settings in Vercel:**
  - `MEMBERSHIP_CONTACT_EMAIL` (a valid email): the contact for questions, non-renewal and refunds.
  - `MEMBERSHIP_COMPLAINTS_URL` (an https URL): the Libro de Reclamaciones link.
  - The payment buttons stay closed ("Soon") until both are set.
- **Prices come from the terms version in code,** not from `SUBSCRIPTION_PRICE_*_LABEL`; those settings become unused. A price change means a new terms version.
- **Offer deadline.** The offer ends for first payments after 31 Dec 2026, 23:59:59 Lima, which is `endsAt` `2027-01-01T05:00:00.000Z`. From then on, the server offers nothing and the page says the offer has closed.
- **Address:** section 1 says "Calle General Varela 154 A, Miraflores" and section 2 says "Calle General Varela 154, Miraflores". Use "154 A" everywhere, and the final report asks the user to confirm.
- **Language:**
  - The legal terms page is in Spanish only, with a one-line note in EN/PT saying the binding text is in Spanish.
  - The membership page is in ES (from the document) plus EN/PT translations, which are the builder's work.
  - The acceptance checkboxes use the document's Spanish text, with EN/PT translations.

## The offer, in code (`server/membership-offer.js`, new)

```js
export const FUNDADORES_2027 = Object.freeze({
  name: 'Nodal Fundadores 2027', version: 'FUNDADORES-2027-v1', effectiveFrom: '2026-10-21',
  endsAt: '2027-01-01T05:00:00.000Z', earlyAccessUntil: '2026-12-31', membershipFrom: '2027-01-01', membershipTo: '2027-12-31',
  renewalFrom: '2028-01-01', renewalDiscountPercent: 5, gracePeriodDays: 10, additionalTrainingDiscountPercent: 20,
  options: Object.freeze({
    once: Object.freeze({ amount: 'S/ 499' }),
    installments: Object.freeze({ each: 'S/ 275', total: 'S/ 550', count: 2, monthsApart: 2 }),
  }),
  seller: Object.freeze({ name: 'Sistema Urbano', ruc: '20605878815', address: 'Calle General Varela 154 A, Miraflores' }),
});
```

## API contract

**`GET /api/billing/config`** (sessionless, as today). Any client of the old shape (`annual`, `options`, `checkout`, `provider`) keeps working.

```json
{ "checkout": true, "provider": "mercadopago", "state": "open",
  "offer": { "name": "Nodal Fundadores 2027", "version": "FUNDADORES-2027-v1", "effectiveFrom": "2026-10-21", "endsAt": "2027-01-01T05:00:00.000Z",
             "earlyAccessUntil": "2026-12-31", "membershipFrom": "2027-01-01", "membershipTo": "2027-12-31", "renewalFrom": "2028-01-01",
             "seller": { "name": "Sistema Urbano", "ruc": "20605878815", "address": "Calle General Varela 154 A, Miraflores" } },
  "annual": { "amount": "S/ 499", "per": "" },
  "options": [ { "id": "once", "amount": "S/ 499" }, { "id": "installments", "amount": "S/ 550", "each": "S/ 275", "count": 2, "monthsApart": 2 } ],
  "contact": { "email": "…", "complaintsUrl": "https://…" } }
```

- **When it is open:** an option appears only when its Mercado Pago link (validated as today: https, Mercado Pago Peru hosts) is set. `checkout` is true and `state` is `open` only when at least one option is offered, both contact settings are valid, and now < `endsAt`.
- **When it is not open:** `state` is `soon` (nothing offered, or contact missing) or `ended` (after `endsAt`), with `checkout: false`, `options: []`, `annual: {amount: 'Soon', per: ''}`. `offer` is always present. `contact` is present only when both contact settings are valid, otherwise null.
- **No links in the answer:** the response never contains the Mercado Pago links. They come only from the acceptance answer below.
- **Pilot mode:** the course pilot keeps `/payments.html` redirecting to `/courses.html` only while `state` is `soon`. With `open` or `ended` the page is served, so the "offer closed" message can show.

**`POST /api/membership/acceptances`** (signed in; `sameOrigin`; write rate limit as for profile saves). Body:

```json
{ "option": "once" | "installments", "version": "FUNDADORES-2027-v1", "accept": { "terms": true, "payment": true, "renewal": true } }
```

| Answer | When |
|---|---|
| `201 { url, acceptance: { id, option, version, acceptedAt } }` | after storing the record; `url` is the Mercado Pago link for that option |
| `401` | not signed in |
| `403` | cross-origin |
| `400 { code: 'acceptance_invalid' }` | an `accept` flag is not exactly true, or the option is unknown |
| `409 { code: 'terms_changed', version: current }` | a different version |
| `410 { code: 'offer_ended' }` | after `endsAt` |
| `503 { code: 'membership_unavailable' }` | the option is not offered, or contact is missing |
| `429` | rate limited |

**`GET /api/admin/membership/acceptances`** (platform admin only, the same check as other `/api/admin/*` CSV exports). A CSV with the columns `accepted_at`, `full_name`, `email`, `option`, `amount`, `terms_version`, newest first. It uses the existing CSV helper with formula-injection protection.

## Storage

**One record per acceptance:**
- `id` (uuid), `user_id`, `email` (account email at the time), `full_name`;
- `option` (`once` | `installments`), `terms_version`;
- `amount_text` (`S/ 499`, or `2 × S/ 275 (S/ 550)`);
- `authorizations` (JSON `{terms:true, payment:true, renewal:true}`);
- `accepted_at`.

**SQLite:** migration `version: 9` in `server/db.js`, with `user_id REFERENCES users(id) ON DELETE SET NULL`.

**Supabase:** `supabase/migrations/20261021000000_membership_acceptances.sql`.
- **Table:** `public.membership_acceptances`, with `user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL`, a CHECK on `option`, and indexes on `(user_id)` and `(accepted_at DESC)`.
- **Access:** RLS enabled with no policies; `REVOKE ALL` from `anon` and `authenticated`; `GRANT SELECT, INSERT` to `service_role`.
- **Applying it:** the header comment says to apply it by hand before deploying, the way other migrations say it.

**Repository methods** (in `server/repository.js` and `server/supabase.js`):
- `recordMembershipAcceptance(record)`;
- `listMembershipAcceptances({ limit = 500 })`;
- `exportUserData` adds `membershipAcceptances`.

**Retention:** a record is contract evidence. Deleting an account clears its `user_id` but keeps the email and name, and the privacy policy says so.

## Pages

**Payments page (`/payments.html`, member-only as today), from section 1:**
- **Head:** the title "Nodal Fundadores" and the intro.
- **"Elige tu modalidad de pago":** two radio choices with their texts.
  - The two-payment text includes the rule for a missing day of the month.
  - Then the notes "Ambas opciones incluyen los mismos beneficios. Todos los precios incluyen IGV." and "La modalidad de dos pagos… no es una suscripción mensual…".
- **"Tu membresía incluye":** the 7 bullets, plus the course and masterclass paragraph.
- **The terms sections:** "Vigencia y pagos" and "Renovación automática".
- **Seller block:** name, RUC, address, contact email (mailto), the Libro de Reclamaciones link, and a link to `/terminos-fundadores.html`.
- **Purchase box,** using section 3's texts:
  - three checkboxes, all unticked: the terms; the payment authorization for the chosen option only, swapping when the option changes; and automatic renewal;
  - the member's NODAL email ("Paga en Mercado Pago con el correo de tu cuenta de NODAL: …");
  - a "Continuar a Mercado Pago" button, enabled only when an option is chosen and all three are ticked.
- **On click:** POST the acceptance, then `location.assign(url)` in the same tab.
- **Error handling:**
  - `terms_changed` reloads the configuration;
  - `offer_ended` shows the closed message;
  - `401` goes to the login page;
  - anything else shows a retryable error;
  - `state` `soon` shows "Las inscripciones abren pronto" and `ended` shows "La oferta Nodal Fundadores 2027 cerró el 31 de diciembre de 2026".
- **FAQ:** rewritten so it never contradicts the terms. It covers the two payments and the 10-day grace period, soles and IGV, receipts, paying with a different email, automatic renewal on 1 Jan 2028 with how to ask for non-renewal, and refunds per section 12.

**Landing card** (`index.html`, `app.js`, `i18n.js`):
- the name "Nodal Fundadores";
- the price from `annual.amount`, with "o 2 pagos de S/ 275" when that option is offered;
- benefits: the 4 pillars, early access and the 20% discount;
- the CTA "Conoce Nodal Fundadores".

**Supporter course note** (`courses.js`, `pilot-i18n.js`): it names Nodal Fundadores, and the button reads "Únete a Nodal Fundadores".

**Terms page** (`/terminos-fundadores.html`, new, public, served like `privacy.html`):
- **The text:** section 2 in full, in Spanish, with the version and effective date as above.
- **Contact details:** the email and Libro de Reclamaciones link are filled in by a small script from `/api/billing/config` `contact`. Until they are set, it says "pendiente de publicación".
- **Links:**
  - the two benefit placeholders go to `/payments.html#beneficios` and `/payments.html#gratis`;
  - "la programación 2026" goes to `/courses.html`;
  - the general conditions stay without a link, and privacy links to `/privacy.html`.
- **Leave out:** the document's internal intro and its "PARA NOSOTRAS" note.

**Privacy policy** (`docs/privacy/*.md`, regenerated `privacy.html`, EN/ES/PT): one sentence on the acceptance record (what is kept, why, and that it outlives account deletion as contract evidence), in the data and retention sections.

**Team routine** (`docs/supporter-payments.md`): rewrite it for Nodal Fundadores.
- the S/ 499 link and the bimestral plan with 2 charges;
- deactivate the link and pause the plan on 1 Jan 2027;
- check the acceptances CSV before adding a payer;
- after the first payment, send the confirmation with the second-payment date (rule in section 7);
- the 10-day grace period;
- non-renewal and refund requests through the contact email.

## Ownership (parallel builders)

- **Server:**
  - `server/membership-offer.js`, `server/server.js` (config, routes, the `terminos-fundadores.html` STATIC_PAGES entry), `server/db.js`, `server/repository.js`, `server/supabase.js`;
  - the migration, `.env.example`, `DEPLOYMENT.md`;
  - server tests.
- **Pages:**
  - `web/pages/payments.html`, `web/scripts/payments.js`, `web/scripts/i18n-dashboard.js`, `web/styles/styles.css`;
  - `web/pages/index.html`, `web/scripts/app.js`, `web/scripts/i18n.js`, `web/scripts/courses.js`, `web/scripts/pilot-i18n.js`;
  - client tests.
- **Terms and docs:**
  - `web/pages/terminos-fundadores.html`, `web/scripts/membership-terms.js`, `web/styles/terms.css`;
  - `vercel.json` (header lists for the new script and style), `docs/membership/terminos-fundadores-2027.md` (the Spanish source text);
  - `docs/privacy/*`, `web/pages/privacy.html`, `docs/supporter-payments.md`;
  - their tests.
- **Cache keys:** no builder bumps `?v=` keys or edits `tests/deploy.test.js` pins. The integrator does that.
