# Supporting membership payments (Mercado Pago links)

The Supporting membership is **annual**. Members pay it on Mercado Pago, either all at once or in two installments, through links Mariana creates in her own Mercado Pago account. NODAL never handles the payment. It shows the links on the payments page, and the team adds each payer by hand.

## 1. Create the links (Mariana, in Mercado Pago)

- **Pay the year at once:** create a payment link (*Link de pago*) for the annual price in soles.
- **Pay in two installments:** create a subscription plan (*Suscripciones → Crear plan*) that charges half the price and stops after **2 charges**. Pick the interval between charges, for example 6 months, and share the plan's link. A plan accepts cards and Mercado Pago balance; card installments (*cuotas*) on a payment link would accept credit cards only.
- Give both links a clear title, such as "NODAL · Membresía de apoyo anual". Mercado Pago shows the title at checkout.

## 2. Put them on NODAL (Vercel → Settings → Environment Variables, Production)

| Variable | Example | Shown as |
|---|---|---|
| `MERCADOPAGO_LINK_ANNUAL` | `https://link.mercadopago.com.pe/nodal` | the "Pay the year" button |
| `SUBSCRIPTION_PRICE_ANNUAL_LABEL` | `S/ 240` | the year's price, written exactly like this |
| `MERCADOPAGO_LINK_INSTALLMENTS` | the plan's link | the "Pay in two installments" button |
| `SUBSCRIPTION_PRICE_INSTALLMENTS_LABEL` | `2 × S/ 120` | its price, written exactly like this |

Then redeploy so the settings take effect.

- **Only real Mercado Pago links work.** An option appears only when both its link and its price are set, and the link is an `https` address on `mercadopago.com.pe` (or `mpago.la` / `mpago.li`). Anything else hides that button, and the Vercel log says which setting was ignored.
- **Nothing set means "Soon".** With neither option set, the site keeps saying "Soon" and the course pilot keeps the payments page closed.
- **Removing a link stops new payments.** Delete its setting and redeploy.

## 3. Add each payer (team, within two working days)

1. In Mercado Pago, open the payment (*Actividad*) or the plan's subscribers (*Suscripciones → Suscriptores*), and note the payer's email.
2. In NODAL's teaching workspace (*Espacio docente*), open the Supporter course → **Participants** → *Agregar participante*. Use the email of the payer's NODAL account. This sends no email, so tell the person they're in.
3. **If the payer used a different email:** the payments page asks members to pay with their NODAL email, but some won't. Write to the payer and ask which email their NODAL account uses. The payments FAQ tells them to do the same.

## 4. Once a month

- **Failed second installments:** for the installment plan, check *Suscripciones* for a second charge that failed. Write to the person before removing them, as the FAQ promises (see *Removing someone*).
- **Ended memberships:** a membership lasts 12 months from the payment. A month before it ends, invite the person to renew.
- **Removing someone:** the teaching workspace cannot remove a participant yet. Ask the developer, who removes the enrollment in the database. The first memberships can't end before October 2027, and a failed second installment comes months after the first payment, so there's time to add a button before it's needed.
- **Receipts:** Mercado Pago emails each payer a payment receipt. Invoices (SUNAT *boleta* or *factura*) are issued by the team's accountant when someone asks.

## Later

This works while there are few Supporters. Once adding and removing people by hand becomes a burden, switch to the full Mercado Pago integration (subscriptions created and checked by NODAL; notes in [integrations/mercadopago-subscriptions.md](integrations/mercadopago-subscriptions.md)). It needs Mariana's credentials and a webhook.
