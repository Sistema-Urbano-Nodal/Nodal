# FIIU session pages, group chat fixes and the live window

Source: the user's review of 15 Oct 2026 ("fix placement so session conversations and Q&A live within each event session page; refine group chat and address key bugs"; "build the community online tracker / live window gated by registration") and the design approved the same day. The festival runs 20–25 Oct 2026 in Lima; the target is production by 19 Oct. Branch `feature/fiiu-session-live`, built on production `main` (dc26810). No database migration.

## Decisions made with the user

- **Session pages:** one page per session. Its details and the person's status sit at the top; its questions and their chat sit below on the same page. Programme cards and the console link to it.
- **Chat bugs:** a read-only audit of the live chat on 15 Oct (21 confirmed findings, about 16 distinct problems) is the list to fix; each fix gets a failing test first. The findings, with reproductions and verifier evidence, are in the session scratchpad file `chat-audit-findings.json` (index = finding number).
- **Live window contents:** happening now, live conversations, badges and milestones (counts only), community pulse.
- **Live window placement:** a band at the top of the festival page during the festival, a compact version in the console's festival block. Registered people and organisers only; others see a prompt to register.

## 1. The session page

**Address:** `fiiu-session.html?a=<activityId>[&q=<questionId>][&present=1]`. `a=general` is the festival-wide General space.

**Old addresses keep working:** `/fiiu-talk.html`, `/fiiu-talk`, `/fiiu-talk.htm` and a trailing slash, any letter case, redirect (302, GET/HEAD) to `/fiiu-session.html` with the same query, like the existing check-in aliases. A `?q=` without `?a=` opens the question and the page replaces its address with `?a=<its activity>&q=<id>`. An activity id in another letter case is lowered before use.

**Top of the page (everyone, guests included):**
- Kicker "FIIU Fest 11 · <weekday, date>", the session title (h1), time (or "Desde las 17:00"), venue, description, the talk lines; all from the merged programme `/api/fiiu` serves, so organiser edits show.
- The person's status, when signed in: registered for this session or not (with "Añadir a mi inscripción" linking to `fiiu.html#add-<id>` while registration is open); checked in or not (with the time, or "Registra tu asistencia con el QR en la sala" for a check-in session); the session's badge from `Fiiu.festivalBadges` (locked/earned, "Nueva" not repeated here).
- General has a short description of the space instead of session details.

**Q&A below:**
- The session's questions as a compact list (open first, then closed; hidden only for organisers), each with its type (conversation or rating), status and answer count. The selected question (from `&q=`, else the most recent open one, else the most recent) opens its chat right there; picking another question swaps the chat in place and updates the address (`history.pushState`, Back returns to the previous question).
- The chat, composer, ratings, likes, files and moderation behave as today, with the audit fixes below.
- Arriving from a link shows the session header and the selected question first, with a "Ver las últimas respuestas ↓" control; once the reader reaches the end, new messages follow as today (audit #16).
- Signed out: the details show, the Q&A area shows the sign-in prompt with `next` back to the same address. Signed in without a registration: the details show, the Q&A area explains how to register, says whether registration is open (audit #15), names the signed-in account and offers to switch accounts, and returns to the same address after registering.

**Links:** programme cards on `fiiu.html` and the console festival block say "Ver sesión" (with the open-question count as today) and point to the session page; the General link points to `fiiu-session.html?a=general`. The projector stays `&present=1` on the session page, organisers only.

## 2. Group chat fixes (from the audit)

| # | Problem | Fix |
|---|---|---|
| 0, 6, 18 | A send whose answer is lost (timeout, reload, Back, tab discard) shows twice: posted and "No enviado" | The server returns `clientId` on the viewer's OWN messages only; the page matches a stored or failed attempt to the real row by clientId and drops the attempt |
| 1 | Keyboard or rotation resizes the viewport and the reader loses the end; new answers raise the pill | Track "at end"; on `resize`, `orientationchange` and `visualViewport` resize keep a reader who was at the end at the end; `interactive-widget=resizes-content` in the page's viewport meta |
| 2 | A like or delete error stays red under the composer after later success | Clear the composer status on the next successful action, like the dock note |
| 3 | A failed message with a photo or PDF loses its text on reload | Keep the text of every unsent attempt; after a reload a photo attempt comes back as a text-only failed row that says the file must be attached again |
| 4 | Tapping Enviar closes the Android keyboard | Keep focus in the textarea when sending by tap (the button does not take focus) |
| 5, 12 | The projector's "Con más me gusta" ranks only the latest 100 answers | A server read of the top answers by likes for the projector |
| 7 | After more than 200 changes the chat is rebuilt and the reader stays mid-list with no pill | After a rebuild, a reader who was following goes to the end; anyone else gets the pill and an announcement |
| 8, 17 | An expired session makes Send/Like/Rate say "Vuelve a iniciar sesión" with no way to sign in | Any 401 switches the page to its sign-in state with a sign-in link back to the same address; the draft is kept |
| 9, 14 | Unhiding an old message is announced as new and raises the pill | Only messages newer than the newest the page has seen count as new |
| 10 | A late like answer overwrites a newer count; the person's own like counts twice while sending | Ignore a like answer older than the row's last sync; show the optimistic count from the server count, not on top of it |
| 11 | Hiding a live question leaves it on the projector | The projector replaces a hidden question with "Esta pregunta no está disponible" and no answers |
| 13 | The organiser's talk picker keeps talk names from page load; a renamed talk is refused with an unrelated message | Rebuild the picker from the current programme when the form opens and after a programme save; translate `invalid_talk` |
| 15 | The not-registered screen is a dead end | See the session page, above |
| 16 | Arriving lands 100 messages below the question | See the session page, above |
| 19 | Block pages stop following the pulse after two hours | Re-arm the watch when the tab becomes visible again |
| 20 | A typed `/fiiu-talk?a=day1-am`, `.htm`, trailing slash or capital letters returns raw JSON | The redirects in section 1 |

## 3. The live window

**Server:** `GET /api/fiiu/live`, signed-in people with a festival registration and organisers (`permission === 'admin'`); 401 signed out, 403 `{code:'not_registered'}` otherwise. Same answer for every allowed person, built at most every 15 s per server instance (in-memory memo, shared promise), `Cache-Control: private, no-store`. The route joins the 30 s verified-session memo the chat poll already uses, so polling phones do not each call the auth provider.

```js
{active, generatedAt,                      // active: Lima date within startsOn..endsOn, or the reader is an organiser (preview)
 now:  {activity:{id,title,date,time,venue}, checkedIn} | null,   // a check-in session under way now (Lima time)
 next: {activity:{id,title,date,time,venue}} | null,             // the next one to start
 sessions:[{activityId, checkedIn}],       // every check-in session, attendance count
 conversations:[{questionId, activityId, activityTitle, body, kind, messageCount,
   latest:{author, body, likeCount, createdAt} | null,          // newest visible message, body cut to 140 characters
   rating:{average, count} | null}],        // ≤ 5 open questions, most recently active first; never hidden questions or hidden/deleted messages
 badges:{first, three, conferences, lab},   // people who reached each milestone (counts only)
 pulse:{registered, checkedInToday, checkedInTotal, messages, ratings}}
```

- Counts come from attendance rows (paged reads) and the existing summary and question-stats reads; the milestones use `festivalBadges`' own rules on the server (one shared definition: the counting rules live in a server module mirroring the client rule, with a test that both agree on the same fixtures).
- Names never appear except a message author's display name ("María G."), which registered people already see in the chats.

**Festival page:** an "En vivo" band (`#en-vivo`) directly under the hero of `fiiu.html`, so the page's h1 stays its first heading, while `active` (20–25 Oct, Lima), always for organisers (marked "Vista previa" outside the dates). Four parts: Ahora / A continuación (session, venue, "N personas registraron su asistencia"), Conversaciones en vivo (up to 5, each linking into its session page and question, with the latest answer or the rating average), Insignias (milestone counts), El festival hoy (pulse numbers). It refreshes every 30 s while visible and pauses when hidden. Guests and signed-in people without a registration see one line: "Inscríbete para ver el FIIU en vivo" with the registration link.

**Console:** a compact line in the festival block while `active`: Ahora/A continuación, the check-ins today, the open conversations, and "Ver en vivo" to `fiiu.html#en-vivo`. Nothing for people without a registration.

**Accessibility and layout:** no live-region announcements for the band's refreshes (it would talk every 30 s); numbers change in place; headings in order; 44 px targets; no sideways scroll at 360 px; EN/ES/PT.

## 4. Testing

- Test first for every audit fix and every new rule; each new test is seen failing first.
- Server: the redirects (each alias, case, query kept); own-message clientId (never another person's); the projector top-likes read (organisers only, ordering, limit); the live endpoint (access, 15 s memo with a fake clock, shared promise, counts against fixtures, active window in Lima, hidden questions and messages excluded, body cut, organiser preview, no-store header, the session memo applies).
- Client harness tests for the session page (header from the merged programme, statuses, question switching and history, landing, guest and unregistered states), each chat fix, the live band and the console line (refresh pause, preview label, prompt for non-registered), the organiser talk picker.
- Browser pass on the seeded local server at 375 and 1280 as organiser, registered participant, unregistered member and guest; projector at 1280; no console errors, no sideways scroll, 44 px targets.
- Whole-branch review with adversarial verification; both builds.

## 5. Out of scope

Push notifications, a public (unregistered) live view, named leaderboards, new database tables, post-festival emails (see the journey doc).
