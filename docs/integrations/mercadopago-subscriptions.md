# Mercado Pago subscriptions: notes for the full integration

Researched 19-20 Oct 2026 from the Peru developer docs (`mercadopago.com.pe/developers`, `.md` exports) and the official Node SDK source (`mercadopago/sdk-nodejs`, v3.6.1). None of Mercado Pago's pages carries a date, so re-check before building. Until then, NODAL sells the Supporting membership through payment links ([supporter-payments.md](../supporter-payments.md)).

## Accounts and credentials

- **Whose account.** The application must live in the seller's own Peru account, which is Mariana's: whoever owns the access token collects the money, and Mercado Pago Peru only lets Peru residents withdraw.
- **Developer access.** A developer gets in through a *Colaboradores* invite or *Compartir credenciales*. Sharing credentials with a non-Peruvian account failed in practice (20 Oct 2026).
- **Test accounts.** A test seller and a test buyer, both set to Peru; the country can't be changed later. A test seller's access token starts with `APP_USR-`, so the prefix doesn't tell test from live: configure the mode explicitly.

## The flow (subscription without a plan)

1. `POST https://api.mercadopago.com/preapproval` with headers `Authorization: Bearer <token>` and `Content-Type: application/json`, and this body:
   - `reason`;
   - `external_reference` (the NODAL user id);
   - `payer_email` (it must match the email the payer uses at checkout, or the payment is rejected);
   - `auto_recurring {frequency, frequency_type: "months"|"days", transaction_amount, currency_id: "PEN"}`;
   - `back_url` (https);
   - `status: "pending"`.

   No `card_token_id` is needed while pending. A plan-linked subscription created by API needs one.
2. Redirect to `init_point` (`…/subscriptions/checkout?preapproval_id=…`). The buyer adds a card or account balance there.
3. Truth comes from `GET /preapproval/{id}`, never from the `back_url` return or a webhook body.
4. Cancel with `PUT /preapproval/{id}` and `{"status":"canceled"}`, spelled with one L; it can't be undone. Pause with `"paused"`. Accept both spellings when reading.
5. Invoices: `GET /authorized_payments/{id}`, or `/authorized_payments/search?preapproval_id=…` (also `?payment_id=…` to map a payment back to its invoice).

**Statuses.**
- *Subscription:* `pending` (no payment method yet), `authorized` (charging), `paused`, `canceled`.
- *Invoice:* `scheduled`, `processed`, `recycling` (retrying), `canceled`.
- *Retries:* a rejected installment is retried up to 4 times within 10 days. After 3 rejected installments, Mercado Pago cancels the subscription and emails the seller.
- *`summarized.semaphore`:* green (all collected), yellow (retrying), red (unpaid).

## Webhooks

- **Setup.** Configure them in *Tus integraciones → app → Webhooks*, with separate test and production URLs. Enable *Planes y suscripciones* (`subscription_preapproval`, `subscription_authorized_payment`) and *Pagos* (`payment`). Saving shows the secret signature.
- **The request.** Mercado Pago POSTs JSON, with `data.id` and `type` also in the query string. Headers: `x-signature: ts=…,v1=…` and `x-request-id`.
- **Verification.** Compute HMAC-SHA256 hex with the secret over the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, then compare with `v1` in constant time.
- **Handling.** Answer 200/201 within 22 s. Then re-read the resource, and treat notifications as unordered and possibly duplicated.

## Still to settle in a sandbox run

- Whether a pending preapproval paid through `init_point` becomes `authorized` and renews by itself in Peru, and when the first charge happens.
- Which credentials create preapprovals in test mode, and whether webhooks fire for test subscriptions. One `.md` export says the dashboard webhook setup is "not available for Subscriptions integrations"; the rendered page lists the topics.
- The real webhook body and query string for the subscription topics; the `ts` unit (seconds or milliseconds); whether `x-request-id` is always present.
- Whether `X-Idempotency-Key` is honoured on `POST /preapproval`, and whether `/preapproval/search` filters by `external_reference` (undocumented). Until that's known, store the preapproval id.
- What `back_url` receives on return, and whether Yape or guest checkout can renew automatically.

## NODAL code it would reuse

The Stripe-era plumbing is mostly provider-neutral:
- `/api/checkout`, `/api/billing/status`;
- the idempotent, ordered subscription ledger: SQLite in `server/db.js`, plus the `apply_stripe_event` RPC in Supabase;
- the second-checkout and account-deletion guards.

Mercado Pago statuses must be mapped onto the ledger's Stripe words first. An unknown status is stored as `pending`, which blocks account deletion and new checkouts. A provider-neutral migration has to be applied by hand (never `supabase db push`).
