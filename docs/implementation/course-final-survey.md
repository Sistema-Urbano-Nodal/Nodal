# Final survey and certificates: Curso Movilidad Nivel 2

## What it is

One survey for one course: *Curso Movilidad Nivel 2* (`pilot_courses` `72e3cc56-a506-4a1b-97b5-9333e8d283ca`). Every enrolled participant answers it once, and everyone who sends it gets a certificate, downloaded only through NODAL. It is not a survey builder: the approved Spanish wording, the validation, the deadline and the organiser CSVs all live in `server/course-final-survey.js`. The page chrome (buttons, errors, states) is translated in EN/ES/PT. The survey content is shown in Spanish only.

- **Who.** Enrolled members who are not administrators. Administrators (`app_role` admin) are organisers: on the course page they get a read-only preview, and they are left out of every count, the status list, both CSVs and certificates. In production 3 of the 20 enrolled accounts are administrators, so the survey has 17 participants. Enrolment being closed does not matter, and the course form (intake) is not required.
- **When.** Open until the end of 23 October 2026 in Lima: the server closes it at `2026-10-24T05:00:00Z` (Lima is UTC-05:00 all year). After that the form is closed, and certificates of people who sent the survey stay downloadable. No deploy is needed at the close.
- **Two screens.** Question 1 is alone on screen 1. Continuing stores it (`PUT …/survey/start`) and it can no longer change. Screen 2 says only that the first answer was saved, without its value, and holds questions 2 to 15. Sending it (`POST …/survey`) marks the response submitted. Only a submitted response counts as answered and enables the certificate.
- **Q12 name.** "Sí, como: …" shows the name the message would be published under: the course form's full name and profession, or, without a course form, the profile's own full name without a profession. It is never a name derived from the email address. With no name at all, consent to be named is refused. The server stores the exact name shown and answers 409 `survey_changed` if it changed in between.
- **Certificates.** Administrators upload one PDF per participant (the content must start with `%PDF-`, 3 MB at most), and can replace or delete it. A participant sees "Listo" once a certificate exists and they have sent the survey, and "Se está preparando" before that. Only the owner (`GET /api/courses/:id/certificate`, with no user parameter) and administrators can download it. It is served as an attachment with `no-store` and a sandbox CSP, never as a public or signed link.

## Data

| Table | Holds |
| --- | --- |
| `course_survey_responses` | One row per person and course: `answers` (JSON object), `submitted_at` (null until sent), `created_at` = when screen 1 was saved. Cascades with the account. |
| `course_certificates` | One row per uploaded PDF: `size`, `storage_path` = `certificates/<course>/<user>/<id>.pdf` in the private `course-attachments` bucket, `status` pending/ready/deleting. At most one `ready` row per person (partial unique index). The account and course foreign keys are RESTRICT, so no tracked file loses its row. |

SQLite mirrors both tables in `server/courses-schema.js` and keeps the PDF bytes in `course_certificate_bytes`. Existing local databases pick the tables up on the next start (`CREATE TABLE IF NOT EXISTS`). Both stores expose the same `putCertificate(record, bytes)`, `getCertificate(record)` and `deleteCertificate(record)`. Every one of them refuses a path that is not the server's own `certificates/<uuid>/<uuid>/<uuid>.pdf`. A replacement is a new row and a new object: the previous `ready` row goes `deleting` first, and a concurrent replacement loses with 409 `certificate_changed` and cleans up its own object. Any other failure in between (a timeout, a dropped connection, a 5xx) puts the previous row back to `ready` before answering the error, so the person keeps a downloadable certificate; the new row stays `pending` for reconciliation. Leftover `pending` (over a day old) and `deleting` rows are finished by `npm run uploads:reconcile` (the `certificates` part of its output).

## API

Every route sits under the existing course prefixes. Each therefore needs a session (401 otherwise) and passes the same-origin check for writes and the per-account course limiters. The organiser routes live under `/api/admin/` and also check the administrator role in the survey module itself. The same suffixes under `/api/courses/…` answer 404. Refusals carry a `code`. Error messages never contain answers, names or emails.

| Route | Who | Answer |
| --- | --- | --- |
| `GET /api/courses/:id` | signed in | adds `finalSurvey` for this course only: to enrolled participants, or as `preview: true` to administrators |
| `PUT /api/courses/:id/survey/start` `{overall}` | enrolled participant, while open | `{finalSurvey}` |
| `POST /api/courses/:id/survey` `{answers, publishAs}` | the same, after start | `{finalSurvey}` |
| `GET /api/courses/:id/certificate` | the owner, after sending | the PDF (download budget applies) |
| `GET /api/admin/courses/:id/final-survey` | administrator | counts and one row per participant |
| `GET /api/admin/courses/:id/export?type=survey` | administrator | `encuesta-final-respuestas.csv`: every submitted response |
| `GET /api/admin/courses/:id/export?type=survey-status` | administrator | `encuesta-final-estado.csv`: reminder list with the course-form name |
| `PUT /api/admin/courses/:id/certificates/:userId` `{mime:'application/pdf', data}` | administrator | 201 `{certificate, replaced}` |
| `GET` / `DELETE /api/admin/courses/:id/certificates/:userId` | administrator | the PDF, named after the person's profile name (ASCII, never the email) so two downloads never share a name / `{ok:true}` |

The CSVs use the Spanish labels, show times in Lima, and neutralise spreadsheet formulas like every other export.

## Pages

- **Course page** (`web/scripts/courses.js`). An "Encuesta final" section sits under the course title, before the course form, so enrolled people without a course form see it too. Everything comes from `finalSurvey`: the page never reads its own clock. The states are open (intro and a button that opens screen 1, or screen 2 once question 1 is saved), sent ("Mi certificado": *Listo* with the download, or *Se está preparando* with the contact address), closed ("La encuesta cerró el 23 de octubre."), and the organiser preview (the same screens with no send button, or the closed line after the deadline). Members who are not enrolled see nothing. One controller owns the section across re-renders: answers typed on screen 2, the random order of question 8 and the open screen survive a course-form save, and each state the server returns is written back to the page's snapshot. The reminder link `&encuesta=1` opens the form once and is then removed from the address.
- **Validation** mirrors the server: every required question, each row of questions 3 and 4, the "Otro (¿cuál?)" texts, the age (a whole number from 1 to 120), and question 12 only once question 11 has text. Errors sit under each question and are linked to its controls (`aria-describedby`, `aria-invalid`); a polite live region gives the summary and focus moves to the first missing answer. Questions 8 and 10 refuse a fourth or third tick with a message instead of disabling boxes; focus stays on the box, so the screen's polite status line repeats the message, and no box is marked invalid. Question 9 is optional, so a "Clear selection" button (chrome) appears while a format is chosen. Question 12's note under the options is linked to them (`aria-describedby`).
- **Language.** The survey content is shown in Spanish with `lang="es"`; buttons, steps, errors and states are translated (`web/scripts/pilot-i18n.js`). The only Spanish added inside the questions is the approved "Elige hasta 3." and "Elige hasta 2."; the country placeholder is chrome.
- **Teaching workspace** (`web/scripts/teaching.js`). A "Encuesta final" tab appears only for the course whose `GET /api/courses/:id` carries `finalSurvey`, and reads its list the first time it opens. It shows the counts (participants only), the deadline, the reminder link, both CSVs, and a table with each participant's survey and certificate status and Subir / Reemplazar / Eliminar. Bulk upload matches `<email>.pdf` to the participant list in the browser, ignoring case and spaces, and lists each file next to the person it goes to before anything is sent. Duplicates and unknown emails are listed and never sent. PDFs go one per request, each checked in the browser first (up to 3 MB, starts with `%PDF-`). A refused file is reported and the run continues; a session, rate-limit or server error stops it, and pressing the button again skips the files already uploaded. A pressed button is disabled while its request runs, which drops keyboard focus; afterwards focus returns to that button or to the same person's row.

## Privacy

The approved introduction tells participants that their answers are linked to their account, that only the NODAL team sees them individually, and that teachers receive grouped results. That promise holds only while no teacher holds `app_role` admin, because every administrator can open the status list and both CSVs. Check the administrator list with the organiser before the survey opens (see DEPLOYMENT.md). Responses and certificate records are in the member's data export (`coursePilot.surveys`, `coursePilot.certificates`, without storage paths). Account erasure removes each certificate object, then its row, then the responses. An upload that started less than 15 minutes ago makes erasure answer 409 (try again), so no object is ever left without a row. Logs carry only a certificate id and a provider status text. The privacy policy's data table has a "Course final survey and certificate" row. Retention for responses (including started-only rows) is not decided yet, like the other course categories (docs/privacy/implementation-review.md).

## Rollout

1. **Migration first.** Apply `supabase/migrations/20261006004500_course_final_survey.sql` to production by hand before the code deploys (DEPLOYMENT.md, "Final survey"). It is additive and safe for the code live today. The new code needs it everywhere: every member's data export and account erasure read these tables, not only this course's page.
2. **Keep the course published.** A member reaches the survey and their certificate only while the course is `published`. Archiving it or returning it to draft hides both (404), even for people who already sent the survey. Leave *Curso Movilidad Nivel 2* published after 23 October for as long as certificates should stay downloadable.
3. Hand over to the organiser: the reminder link `course.html?id=72e3cc56-a506-4a1b-97b5-9333e8d283ca&encuesta=1`, the reminder CSV for her own emails (NODAL sends none), and the file naming for the bulk certificate upload (`<NODAL email>.pdf`, one PDF of up to 3 MB per person).
