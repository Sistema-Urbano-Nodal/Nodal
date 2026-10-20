# Supporting membership through Mercado Pago links

Date: 20 Oct 2026. Status: building, no questions round (the user asked for sensible defaults).

## Why

NODAL's Supporting membership needs a way to take money in Peru. Stripe cannot onboard a Peruvian business, and a full Mercado Pago API integration needs credentials that Mariana's Peruvian account cannot share with the developer's foreign account. Mercado Pago lets a seller create payment links in its own panel with no code. NODAL only has to send members to those links. The team adds each payer by hand, as it already can in the teaching workspace.

The user decided: NODAL only offers the Mercado Pago link, and people pay through it. The membership is **annual**, and it can be paid **in two installments**.

## Goals

- A signed-in member can open the payments page, see the annual price, and go to Mercado Pago to pay it, either all at once or in two installments.
- Mariana creates and changes the links and prices herself in Mercado Pago and Vercel, with no code change.
- Before paying, the member knows what happens next: they pay with the email of their NODAL account, and the team adds them within two working days.
- The closed Supporter course points people to the payments page.
- The privacy policy names Mercado Pago before anyone pays.
- The team has a written routine for adding payers and for removing people whose membership ended or whose second installment failed.

## Non-goals

- No Mercado Pago API calls, webhooks, credentials or automatic access. That is the later full integration researched on 19-20 Oct 2026, once the number of Supporters makes manual work hurt.
- No monthly plan.
- No change to the dormant Stripe server routes. They stay unreachable without Stripe configuration and are removed when the full integration lands.
- No SUNAT receipts from NODAL. Mercado Pago emails a payment receipt; invoices are the team's (and their accountant's) job.

## Anti-goals

- A price or link that reads as an offer when it cannot be paid.
- A link to anything other than Mercado Pago.
- Pilot banners or course-pilot behaviour changing as a side effect.

## Design

**Configuration (Vercel env).** An option is offered only when both its link and its price are set and the link is valid.

| Variable | Example | Meaning |
|---|---|---|
| `MERCADOPAGO_LINK_ANNUAL` | `https://link.mercadopago.com.pe/nodal` | Pay the year at once |
| `SUBSCRIPTION_PRICE_ANNUAL_LABEL` | `S/ 240` | Its price, shown as written (already exists) |
| `MERCADOPAGO_LINK_INSTALLMENTS` | `https://www.mercadopago.com.pe/subscriptions/checkout?preapproval_plan_id=…` | Pay in two installments |
| `SUBSCRIPTION_PRICE_INSTALLMENTS_LABEL` | `2 × S/ 120` | Its price, shown as written |

A valid link is `https:` on `mercadopago.com.pe` or one of its subdomains, or on Mercado Pago's short-link hosts `mpago.la` and `mpago.li`, with no credentials in it (my call). An invalid link is treated as unset and logged once at start-up, so a typo hides the button rather than breaking the page (my call).

**`GET /api/billing/config`.** It returns `checkout: true` when at least one option is offered, plus `annual` (amount, period) and `options` (id `once` or `installments`, url, amount). While nothing is offered it keeps today's "Soon" answer. The links are public: they are the same links Mariana would share on WhatsApp.

**Pilot mode.** `/payments.html` stops redirecting to the courses page once an option is offered. Everything else the pilot switch does stays as it is (my call).

**Payments page** (EN/ES/PT, member-only as today):
- The monthly/annual toggle goes. One Supporter card shows the annual price and a button per offered option: "Pay the year" and "Pay in two installments". Each opens the link in a new tab, so the "what happens next" panel stays on screen (my call).
- The side panel becomes "How it works":
  1. pay on Mercado Pago with your NODAL email, shown on the page when known;
  2. the team adds you as a Supporter within two working days;
  3. the membership lasts 12 months from the payment.
- The FAQ answers what changed: soles; card or Mercado Pago balance; Mercado Pago's receipt, with invoices on request; what happens if the second installment fails; and that NODAL never sees card numbers.

**Landing page.** The Supporter price slot shows the annual amount with "/ year", and the "See supporting membership" button appears as soon as an option is offered.

**Closed Supporter course.** Next to "Este curso forma parte de la membresía de apoyo…", a "Become a Supporter" link to the payments page, shown only while an option is offered. The note's "which opens soon" wording changes once payments are open (my call).

**Privacy policy.** Section 7 names Mercado Pago, in all three languages:
- the payer gives their payment details to Mercado Pago, never to NODAL;
- the team sees the payer's name, email and payment status in Mercado Pago, to grant the membership;
- these are kept as long as the membership and the tax rules require.

**Team routine** (`docs/supporter-payments.md`):
- where Mariana creates both links (Link de pago, and a subscription plan limited to 2 charges for installments);
- which Vercel variables to set;
- how to add a payer in the teaching workspace (Participants → add by email);
- what to do when a payer used a different email;
- a monthly check for failed second installments and ended memberships.

## Left to the builder

Exact copy wording within the meaning above, the CSS, and how the existing tests that pin the monthly/Stripe payments page are rewritten.
