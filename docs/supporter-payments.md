# Nodal Fundadores payments (Mercado Pago links)

**Nodal Fundadores 2027** is NODAL's paid annual membership. Its commercial terms are at `/terminos-fundadores.html` (version `FUNDADORES-2027-v1`, source text in [membership/terminos-fundadores-2027.md](membership/terminos-fundadores-2027.md)). This routine follows them. "Section 7" and the like are sections of the terms.

- **Pago único:** S/ 499, through a Mercado Pago payment link.
- **Dos pagos:** S/ 275 at sign-up and S/ 275 two calendar months after the first payment is approved, S/ 550 in total, through a Mercado Pago subscription plan that stops after 2 charges.
- **Dates:** the offer is for people whose first payment is approved by 31 December 2026. They get early access from that approval until 31 December 2026, then the membership runs from 1 January to 31 December 2027. It renews on 1 January 2028 unless the member asks for it not to (section 11).

Members pay on Mercado Pago, through links Mariana creates in her own Mercado Pago account. NODAL never handles the payment. Before a member pays, the payments page shows the terms and asks for three unticked authorizations: the terms, the payment for the option chosen, and automatic renewal. NODAL records that acceptance, then sends the member to the Mercado Pago link for that option. The team adds each payer by hand.

## 1. Create the links (Mariana, in Mercado Pago)

- **Pago único:** create a payment link (*Link de pago*) for **S/ 499**. At checkout Mercado Pago may offer "hasta 3 cuotas con interés" on a credit card. That is Mercado Pago's card option, with any interest between the payer and Mercado Pago or their card. It is not NODAL's two-payment option: for NODAL it is still one payment of S/ 499. A member who asks to split the price can be pointed to *Dos pagos*.
- **Dos pagos:** create a subscription plan (*Suscripciones → Crear plan*) that charges **S/ 275 every 2 months** (bimestral) and stops after **2 charges**. A plan accepts cards and Mercado Pago balance.
- Give each a clear title, such as "NODAL · Nodal Fundadores 2027 · Pago único" and "NODAL · Nodal Fundadores 2027 · Dos pagos". Mercado Pago shows the title at checkout.
- Before publishing, open each link in a private window (signed out of Mercado Pago) and check that it shows the right amount in soles. A subscription plan may ask the payer to sign in to Mercado Pago.
- **Check the second-charge date once.** The terms promise the date in section 7 (see *Add each payer*, step 4). On the first real subscription, look at the next charge date Mercado Pago shows for that subscriber and check that it is the same, especially for a first payment on the 29th, 30th or 31st of a month. If Mercado Pago would charge on a different day, tell the developer before the next sale.

## 2. Put them on NODAL (Vercel → Settings → Environment Variables, Production)

| Variable | What it holds | Used for |
|---|---|---|
| `MERCADOPAGO_LINK_ANNUAL` | the S/ 499 payment link | the *Pago único* option |
| `MERCADOPAGO_LINK_INSTALLMENTS` | the 2-charge plan's link | the *Dos pagos* option |
| `MEMBERSHIP_CONTACT_EMAIL` | the team's contact email | questions, non-renewal, changes and refund requests; shown on the payments page and the terms |
| `MEMBERSHIP_COMPLAINTS_URL` | the `https` address of the Libro de Reclamaciones | the Libro de Reclamaciones link on the payments page and the terms |

Then redeploy so the settings take effect. `.env.example` lists the same settings for a local run.

- **The buttons stay closed until both contact settings are set.** With `MEMBERSHIP_CONTACT_EMAIL` or `MEMBERSHIP_COMPLAINTS_URL` missing or invalid, the payments page says "Las inscripciones abren pronto", whatever links are set. The terms page then says "pendiente de publicación" where the email and the Libro de Reclamaciones go. The email must be a valid address and the Libro an `https` address.
- **Prices are in the code, not in the settings.** They belong to the terms version (`server/membership-offer.js`). `SUBSCRIPTION_PRICE_ANNUAL_LABEL` and `SUBSCRIPTION_PRICE_INSTALLMENTS_LABEL` are no longer used and can be deleted. Changing a price means new terms: a new version of the terms page and the code, then new Mercado Pago links.
- **Only real Mercado Pago links work.** An option appears only when its link is an `https` address on `mercadopago.com.pe` (or `mpago.la` / `mpago.li`). A link that isn't a Mercado Pago Peru address is named in the Vercel log and its option stays hidden.
- **The links are never on the page.** NODAL gives a member the link for their option only after recording their acceptance. Anyone who already has a link can still pay with it in Mercado Pago, without accepting anything on NODAL (see *Add each payer*, step 2).
- **Removing a link only hides its option.** To stop payments, first deactivate the payment link or pause the plan in Mercado Pago, then delete the setting and redeploy.

## 3. Add each payer (team, within two working days)

1. **Find the payment.** In Mercado Pago, open the payment (*Actividad*) or the plan's subscribers (*Suscripciones → Suscriptores*). Note the payer's email, the amount and the date the payment was approved. Add only payments marked approved (*Aprobado* / *Acreditado*), and only subscribers whose first charge was approved: rejected and pending attempts also appear there, and they don't start a membership (section 13).
2. **Check the acceptance.** Signed in to NODAL as an administrator, open `/api/admin/membership/acceptances` on the NODAL site. It downloads a CSV of every acceptance, newest first, with `accepted_at`, `full_name`, `email`, `option`, `amount` and `terms_version`. Find the row whose email is the payer's and whose option is what they paid: `once` for the S/ 499 payment, `installments` for the S/ 275 subscription. The acceptance should be from before the payment.
   - **No row for that email:** the payer may have used another email on Mercado Pago, or paid with a link someone shared. Don't add them yet. Write to the payer and ask which email their NODAL account uses. If that account has no acceptance either, ask them to accept the terms for the option they paid on the payments page, signed in with that account, and then close the Mercado Pago page without paying again.
   - **A row for the other option:** ask them to accept again for the option they actually paid, in the same way.
   - **A version other than `FUNDADORES-2027-v1`:** tell the developer before adding them.
3. **Add them.** In NODAL's teaching workspace (*Espacio docente*), open the Supporter course (*Curso Movilidad Nivel 2*) → **Participants** → *Agregar participante*. Use the email of the payer's NODAL account. This sends no email.
4. **Send the confirmation (section 7 and 16).** From the contact email, the day you add them, write to the member with:
   - the option they chose and the amount paid;
   - early access from the approval of the first payment until 31 December 2026, and the membership from 1 January to 31 December 2027;
   - for *Dos pagos*, **the exact date of the second S/ 275 charge**.

   The second charge is due two calendar months after the date the first payment was **approved**. Keep the day number and move it two months on. If that month has no such day, use its last day. It is not a fixed 60 days, and the start is never the account's creation or a rejected or pending attempt.

   | First payment approved | Second payment due |
   |---|---|
   | 20 October 2026 | 20 December 2026 |
   | 30 November 2026 | 30 January 2027 |
   | 31 December 2026 | 28 February 2027 |

   Anyone who accepted an earlier two-payment offer with the second payment six months later keeps that date (section 10). Don't move it to two months.

## 4. On 1 January 2027: close the links

The offer is for first payments approved by 31 December 2026. From 1 January 2027 (Lima time) the site closes it by itself and says the offer has closed, but the links keep working in Mercado Pago:

- **Deactivate the S/ 499 payment link** first thing on 1 January 2027. It has no expiry date of its own.
- **Pause the plan** so nobody new can subscribe. Before you do, check that pausing the plan only stops new subscriptions and does not pause the existing subscribers' second charge, which runs until 28 February 2027 for a first payment on 31 December 2026. If it would, ask Mariana how to close the plan to new subscribers only.
- Then delete `MERCADOPAGO_LINK_ANNUAL` and `MERCADOPAGO_LINK_INSTALLMENTS` in Vercel and redeploy.
- A first payment approved on 1 January 2027 or later is outside the offer. Write to the person and decide with Mariana whether to accept it or refund it.

## 5. Second charges and the grace period (section 13)

- **On each second-charge date,** check *Suscripciones* for the charge.
- **A failed charge:** write to the member the same day. They have a **grace period of 10 calendar days** counted from the date of the failed charge, and they keep their benefits during it. Mercado Pago's retries of the same charge don't restart the 10 days and are not extra charges.
- **Still unpaid after the 10 days:** the Fundadores benefits can be suspended until the payment is made (see *Removing someone*). The suspension doesn't cancel what the member owes for 2027. They keep their account and the free community access (section 14).
- **A subscription cancelled before the second charge:** the second payment is still part of the annual membership (sections 6 and 12). Write to the member, then treat it like a failed charge.

## 6. Requests to the contact email (sections 11, 12 and 17)

Questions, non-renewal, changes of payment option and refund requests come to the contact email (`MEMBERSHIP_CONTACT_EMAIL`). Answer from it and keep the thread.

- **Non-renewal:** note it and confirm it in writing. The membership stays until 31 December 2027. It does not cancel payments still due for 2027 and does not by itself mean a refund.
- **Refunds or early termination:** decide with Mariana under the accepted terms and consumer law; the terms never exclude a refund the law gives. A refund is made from the payment in Mercado Pago.
- **Complaints:** they arrive through the Libro de Reclamaciones, which has its own legal deadline for the answer (15 working days in Peru at the time of writing; check it with the accountant).

## 7. Once a month

- **Receipts:** Mercado Pago emails each payer a payment receipt. Invoices (SUNAT *boleta* or *factura*) are issued by the team's accountant when someone asks.
- **Removing someone:** the teaching workspace cannot remove a participant yet. Ask the developer, who removes the enrollment in the database. A second charge can fail from late December 2026, and its grace period ends 10 days later, so a remove button is needed by then. Every 2027 membership ends on 31 December 2027.
- **Renewal on 1 January 2028:** the terms promise to tell each member, before the renewal, the price (the regular price with 5% off), the charge dates and how to ask for non-renewal (section 11). Neither link can charge in 2028: the payment link is one-off and the plan stops after 2 charges. The renewal needs its own setup, and a message to members, well before December 2027.

## Later

This works while there are few members. Once adding and removing people by hand becomes a burden, switch to the full Mercado Pago integration (subscriptions created and checked by NODAL; notes in [integrations/mercadopago-subscriptions.md](integrations/mercadopago-subscriptions.md)). It needs Mariana's credentials and a webhook.
