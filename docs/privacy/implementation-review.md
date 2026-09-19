# NODAL privacy implementation review

19 September 2026 · Source reviewed: `bd02dc4` · Internal working document

This review separates behavior observed in the repository from proposed commitments and unresolved organizational facts. It is not a legal opinion, live configuration audit, or certification of compliance. The policy drafts are deliverables for review, not a reason to delay addressing existing collection practices.

## 1. What the code supports

| Finding | Evidence | Policy implication |
| --- | --- | --- |
| Directory membership is optional and defaults off. | `server/profile-policy.js`; `server/supabase.js` maps `data_consent.directoryPublic`; `server/server.js` directory routes. | Explain member visibility separately from course contributions. “Nothing is public without consent” in the existing profile copy is too broad for all sharing contexts. |
| Feedback is identifiable and administrators can export it with names and emails. | `server/courses-api.js`, `feedbackForStaff`, `feedbackCsv`, admin feedback routes. | Say explicitly that feedback is not anonymous. Establish rules for staff CSV handling. |
| The same global admin permission gates course administration and reporting. | `server/courses-api.js`, `isStaff`. | Do not promise that only the assigned instructor sees a course's intake. Consider course-specific staff roles as the team grows. |
| All eight intake answers are currently required; a missing/deleted intake blocks student access to module content. | `server/courses-domain.js`, `normalizeIntake`; `server/courses-api.js`, `courseAccess`. | Review whether motivation, expectations, case study and digital familiarity truly need to be mandatory. Do not label the current intake wholly optional. |
| Location lookup rounds coordinates before transmission and requires confirmation to update the city. | `web/scripts/location-check.js`; `server/location.js`. | Explain optional lookup, automatic preference, GeoDB disclosure, and stored city coordinates. This does not prove absence of location metadata in uploaded photographs or provider logs. |
| Matching includes a learned logistic ranking layer based on member interactions. | `server/learn.js`; `server/engine.js`. | “We never train models with user data” would be inaccurate. Distinguish this existing feature from a future external generative-AI assistant. |
| Account export includes profile/network data and course records; attachments are exported as metadata. | `server/supabase.js`, `exportUserData`; `server/courses-privacy.js`, `exportCourseData`. | Do not call the JSON download a complete copy of every file or every provider-held record. Offer a manual request route. |
| Account deletion handles personal files, intakes, feedback, events and invitations; post structure can survive without body/author name. | `server/courses-privacy.js`; database deletion triggers. | Do not promise deletion of all thread references, third-party copies or course-owned materials. Pending upload reconciliation can require support before deletion completes. |
| Session, refresh, recovery and language cookies exist; local preferences persist. | `server/auth.js`; `server/supabase.js`; `web/scripts/locale.js`; `web/scripts/location-check.js`. | Publish an accurate storage notice. No first-party advertising tracker was identified in these reviewed paths; that is not an audit of all provider behavior. |
| Video embeds are inserted on user action. | `web/scripts/pilot.js`, `recordingPreview`. | Preserve this behavior and add a short provider disclosure before activation. Privacy-enhanced embeds still contact third parties. |

## 2. Priority actions before adopting the policy

1. **Identify the controller and activate the request channel.** Obtain registered entity name, address, registration details and an accountable privacy lead. Clarify whether course partners act under instructions, independently, or jointly. Confirm the countries served; residence alone is not a universal test of which law applies.
2. **Make the notice available at collection.** After approval, publish accessible PT/ES/EN pages; link from registration, invitations, intake, feedback, uploads and the account menu. Give existing users a clear notice. Acknowledging receipt of a policy is different from consenting to optional purposes. Do not infer retroactive consent from continued use.
3. **Record optional choices properly.** Current directory consent is a boolean plus a general update timestamp, not a versioned history of the notice and each choice. Add purpose, notice version, language, decision, timestamp, source and withdrawal evidence with restricted access and its own retention period. Do not store full request bodies or precise location as consent evidence.
4. **Minimize forms and clarify audience.** Review every required intake field. Label private intake, identifiable staff feedback and course-visible posts at the point of submission. Provide a way to report third-party personal data. File type checks do not remove image EXIF or prove a file contains no personal data.
5. **Approve and implement retention.** Time-based expiry was not identified for course responses, feedback, unused invitations and course events. The interaction cap of 50 events per pair is a count limit, not a retention period. Build deletion jobs, legal-hold handling, retry/reconciliation and a restore procedure that reapplies deletions.
6. **Verify processors and international flows.** Inventory Vercel, Supabase, the actual SMTP service, GeoDB, video providers, staff exports and any active Redis provider. Confirm countries for storage, support, logs, backups and onward transfers. `vercel.json` names `pdx1`; that is not evidence that every copy stays in that region. Review vendor agreements rather than assuming their public DPAs are already accepted or sufficient. [Vercel DPA](https://vercel.com/legal/dpa), [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum).
7. **Operate rights and incident handling.** Assign an owner and backup, triage requests daily, verify identity proportionately, record deadlines by jurisdiction, and coordinate requests across databases, files, providers and staff exports. Test a complete access/deletion request with disposable data before making a completion promise. Keep incident contacts and a notification decision process ready.
8. **Resolve research, minors and future AI.** Confirm whether identifiable data has already been shared for research. Define age policy and assess actual minor access, rather than adding an unsupported “18+” sentence. Before generative AI, define approved documents, access controls, prompt logging, vendor retention, model-training settings, separate purposes and applicable consent. Do not treat academic affiliation as an automatic research-law exemption.

The proposed product changes above are not implemented by this documentation task. Stripe integration also exists in the repository; verify whether it is active or holds historical records. If so, add billing purposes, recipient information and applicable financial retention rather than asserting the service never processes billing data.

## 3. Proposed retention schedule for discussion

These are design proposals, not current settings or statutory periods. Review utility, legal duties and provider capabilities before putting them in the public policy. Apply deletion earlier when the purpose ends or a valid request requires it.

| Data | Proposed rule | Implementation/approval requirement |
| --- | --- | --- |
| Account and professional profile | While the account is used; review after 24 months of inactivity and notify before closure. | Agree on what counts as activity, notice period and account closure process. |
| Course intake, submissions, attachments and identifiable feedback | Up to 12 months after the course ends, unless a documented need supports a different period. | Separate learning access from evaluation/research retention; delete or robustly anonymize afterward. |
| Raw course access events and recommendation interaction events | Rolling 90 days for ordinary product analysis. | Keep only genuinely non-identifying aggregate statistics afterward; assess small cohorts and free text. |
| Unaccepted invitations | 30 days after the last authorized invitation, then remove unnecessary contact records. | Align invitation/token expiry; do not refresh indefinitely without a legitimate need. |
| Staff CSV exports | Delete within 30 days after the specific operational task ends. | Approved storage, limited access, no personal/shared public drives; handle rights requests against surviving copies. |
| Diagnostic logs | Target 30 days, minimized and redacted. | Verify legal requirements separately from debugging needs. Do not log credentials, recovery URLs, form bodies or coordinates. |
| Backups | Aim for the shortest workable cycle, ideally 30 days. | Verify actual vendor limits and restoration behavior; use the real confirmed period in the notice. |
| Consent, requests, incidents and legal holds | A separately approved period tied to accountability or the specific legal duty. | Keep minimum evidence with restricted access; no blanket indefinite retention. |

Brazil's Marco Civil can require six months of application-access logs for providers meeting Article 15's criteria. Counsel must determine whether NODAL qualifies and how court preservation orders apply. Those logs must be distinguished from course telemetry; the 30/90-day proposals must not override a binding obligation. [Marco Civil, Article 15](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm).

## 4. Cookies and browser storage inventory

These values come from source code; verify the production configuration and actual browser behavior before publication.

| Item | Purpose | Observed code lifetime |
| --- | --- | --- |
| `nodal_session` | Authentication, HttpOnly | Supabase uses the issued token expiry, falling back to one hour; the local SQLite implementation defaults to seven days. |
| `nodal_refresh` | Session renewal, HttpOnly | Thirty days when set/renewed. |
| `nodal_recovery` | Password recovery, HttpOnly | Up to one hour when set/renewed; path restricted to recovery API. |
| `nodal.lang` cookie | Chosen language | One year when set/renewed. |
| `nodal.lang` local storage | Chosen language | No automatic expiry found. |
| `nodal.location-check.v1:<userId>` local storage | Automatic-check preference and last check day | No automatic expiry found; account deletion on the server does not automatically prove cleanup on every device. |

Classify essential and optional technologies by purpose and applicable law. Preserve the no-embed-before-activation design; explain the provider before activating it. Do not add a decorative “accept all” banner that neither controls third parties nor records choices. [ANPD cookie guidance](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf).

## 5. Jurisdiction review and rights handling

This is a selected-country starting point, not a full Latin American survey. Confirm territorial/material applicability, sector rules and any legal exceptions before relying on a deadline. Extensions require the particular law's conditions and notice; they are not the default. Publish the relevant local information in the user's language, including authority complaint routes.

| Country | Framework and authority | Initial response rules and preparation |
| --- | --- | --- |
| Brazil | LGPD, ANPD. | Simplified confirmation/access immediately, or full declaration within 15 days under Article 19. Other rights need their own analysis. Assess DPO arrangements, documented purposes and cross-border safeguards. [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). |
| Peru | Law 29733 and DS 016-2024-JUS; Peruvian ANPD. | Article 69: information within 8 business days, access within 20, other listed rights such as rectification/cancellation/opposition within 10, counted from the following day. Review personal-data-bank registration, required notices and international flows. [Official regulation](https://www3.congreso.gob.pe/Docs/DGP/DIDP/files/ds_016-2024-jus.pdf). The new regulation took effect on 31 March 2025. [ANPD announcement](https://www.gob.pe/institucion/anpd/campa%C3%B1as/128319-nuevo-reglamento-de-proteccion-de-datos-personales). |
| Colombia | Law 1581 of 2012; SIC. | Consultations: 10 business days, with up to 5 additional under the statutory conditions. Claims: 15 business days, with up to 8 additional under the statutory conditions. Document authorization or the applicable exception; assess registration duties and local transfer/transmission rules. [Law 1581, Articles 9, 14–15](https://cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm). |
| Mexico | Current LFPDPPP enacted in 2025, amended 14 November 2025; Secretaría Anticorrupción y Buen Gobierno. | ARCO determination within 20 business days; if appropriate, implement within the following 15 business days. Conditional one-time extensions exist. Review the notice, optional-purpose refusal, consent and transfers under this law; do not name the former INAI as the current authority. [Current law, Articles 2, 14–16 and 31](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf). |
| Argentina | Law 25.326; AAIP. | Access within 10 calendar days; rectification/update/deletion within 5 business days. Include the AAIP complaint route and assess registration and transfer requirements. [AAIP rights guidance](https://www.argentina.gob.ar/aaip/datospersonales/derechos), [current statute](https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion). |
| Uruguay | Law 18.331; URCDP. | The authority's guidance gives 5 business days for access and rectification/update/inclusion/deletion. Review the local registration, accountability and transfer framework. [URCDP guidance](https://www.gub.uy/unidad-reguladora-control-datos-personales/comunicacion/publicaciones/guia-proteccion-datos-personales-para-empresas-especial-micro-pequenas-1). |
| Ecuador | LOPDP; SPDP. | Prepare access, correction, deletion, objection, portability and automated-decision handling; apply each right's statutory conditions and deadline, rather than copying a Brazilian deadline. Review DPO/representative and transfer obligations for the actual operation. [Official LOPDP](https://spdp.gob.ec/wp-content/uploads/2024/12/03.pdf.pdf), [SPDP regulations](https://spdp.gob.ec/resoluciones2/). |
| Chile | Law 19.628 currently; Law 21.719 reforms take effect on 1 December 2026. | Review existing access/correction/deletion rights now, and prepare the new framework and agency procedures before the effective date. Do not describe the future regime as already fully in force on this draft's date. [Current Law 19.628](https://www.bcn.cl/leychile/Navegar?idNorma=141599&idParte=8642680), [Law 21.719 and transitional provisions](https://www.bcn.cl/leychile/navegar?i=1209272). |

Other Latin American countries require a separate applicability review before targeted rollout; one Spanish translation does not resolve their legal differences. Geographic expansion should trigger review of this register, not an unsupported blanket compliance statement.

## 6. Incidents, transfers and special cases

- **Brazilian international transfers:** select and document a valid mechanism for each flow. An EU DPA or EU standard clauses are not, by themselves, proof of a Brazilian mechanism. Review onward transfers and the actual contracting entities. [ANPD transfer guidance](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados/transferencia-internacional-de-datos).
- **Brazilian incidents:** assess relevant risk/harm promptly. The general notification period is three business days for reportable incidents; check specific rules and any legitimately applicable regime before relying on an exception. [ANPD incident instructions](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis).
- **Peruvian incidents:** Article 34 provides a 48-hour authority-notification rule for incidents meeting its criteria, and includes additional digital-security and affected-person requirements. Build a country-specific assessment; do not reuse Brazil's clock. [DS 016-2024-JUS, Article 34](https://www3.congreso.gob.pe/Docs/DGP/DIDP/files/ds_016-2024-jus.pdf).
- **Children and teenagers in Brazil:** review both LGPD child protections and the ECA Digital, already effective since 17 March 2026. Intended adult use alone does not establish that a service is outside its scope. Confirm actual likely access and the appropriate safeguards before drafting an age restriction. [ANPD ECA Digital guidance](https://www.gov.br/anpd/pt-br/assuntos/eca-digital).
- **Research and analytics:** a small cohort, a persistent pseudonym or a distinctive free-text answer can remain identifiable. Define an approved de-identification method and disclosure review. “For research” is a purpose description, not a universal exemption or automatic legal basis.

## 7. Adoption checklist

- [ ] Legal controller, countries served, privacy channel and accountable staff confirmed.
- [ ] Purposes and lawful bases approved for each applicable country; optional purposes separated.
- [ ] Every policy placeholder replaced with verified information in both drafts.
- [ ] Retention periods approved, implemented and tested across active records, files, backups and exports.
- [ ] Vendor inventory, actual contracts and cross-border mechanisms reviewed.
- [ ] Rights workflow, complaint links and incident deadlines assigned and exercised.
- [ ] Audience/age and research policy approved; no unreviewed AI reuse authorized.
- [ ] Necessary application changes tested with isolated data, including withdrawal and deletion failures.
- [ ] Public PT/ES/EN texts and local addenda checked for equivalent meaning and accessibility.
- [ ] Version/effective date recorded; users notified; policy published only after the remaining factual and legal review.

No boxes are pre-marked complete solely because this package has been drafted.
