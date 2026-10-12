# FIIU block conversations

Source: conversation of 11 Oct 2026. The festival runs 20–25 Oct 2026 in Lima, so the target is code complete by 15 Oct and in production by 17 Oct, which leaves time for an organiser rehearsal. The branch is `feature/fiiu-conversations`, built on `feature/ui-speed-round`, which is not deployed yet and must ship first or together.

## Decisions made with the user

- **Scope:** FIIU festival blocks only, not course sessions. The course pilot keeps its own discussion.
- **Questions:** organisers post questions on a block, and a block can have several. Each question has its own chat. Organisers can close a question (read-only) or hide it.
- **Who takes part:** any signed-in account with a FIIU registration can read and take part on every block. Organisers (`permission === 'admin'`) can too, with or without a registration.
- **Interaction:** a chat of replies with likes. Messages carry text, images or PDFs. People delete their own messages; there is no editing, no nesting, and participants cannot start questions.
- **Names:** participants appear as first name plus surname initial ("María G."), taken from the registration. Organisers see the full name.
- **Approach:** reuse the course upload and discussion machinery (approach A), with new FIIU tables. Live updates come from polling a CDN-cached revision feed.
- **Projector:** a projector view is included.
- **File size (the user delegated this):**
  - 3 MB per file, at most 3 files per message, at most 30 files and 30 MB per person for the festival.
  - Accepted types: JPG, PNG, WebP and PDF.
  - Images are re-encoded on the phone to a long edge of at most 1,600 px, with a thumbnail of at most 480 px.
  - Why 3 MB: Vercel caps request bodies near 4.5 MB, and base64 makes 3 MB about 4 MB. Larger files would need direct-to-Storage uploads and a CSP change, which is too much risk this close to the festival.

## Participant experience

### Entry points

All of these come from the public pulse (below), so guests see them too:
- **FIIU page:** a block with visible questions shows "Conversación · N" on its programme card (`conferenceCard`, `labCard`, `typeGroup` rows) and on its "Tu programa" itinerary row.
- **Dashboard widget:** "Lo próximo" (`fiiu-hubs.js`) shows the same link.

### Chat page: `fiiu-talk.html`

**Addresses**
- `?a=<activityId>` lists the block's visible questions, newest open question first. If there is exactly one, it opens it.
- `?q=<questionId>` opens one question. The projector QR uses this address.

**Header**
- The block's title, Lima date and time, and venue, taken from the catalogue.
- The talk name, if the question is tied to one.
- The question text.
- Links to the block's other questions.

**Messages**
- Shown oldest first: the first page holds the latest 100 visible messages, and "Load earlier" pages back by `(createdAt, id)`.
- Each message shows:
  - the display name, with an "Organización FIIU" label on organiser messages;
  - the time in Lima (`Intl.DateTimeFormat` with `timeZone: 'America/Lima'`);
  - the text, where https URLs become links that open in a new tab with `rel="noopener noreferrer"`;
  - files: image thumbnails in a fixed aspect box with lazy loading, where a tap opens the full image; PDFs as download links with name and size;
  - a like button with `aria-pressed` and its count, hidden on your own messages;
  - "Delete" on your own messages.
- A deleted or hidden message vanishes for participants.

**Composer**
- Pinned at the bottom: a text area (at most 1,000 characters, with a counter near the limit), an attach button and Send.
- Text, at least one file, or both are required.
- On send, the message appears at once with a "sending" state. On failure it shows "Retry". Each draft has a `clientId` (`crypto.randomUUID()`), so a retry never duplicates the post.
- Files upload one at a time with an "Uploading 1 of 2…" status. Uploaded file ids are kept across retries while the selection is unchanged, which is the `courses.js` composer pattern.

**Live updates**
- The page polls the pulse every 4 s while visible, with exponential backoff to 60 s on errors. It pauses when hidden and polls at once when visible again.
- When the question's revision moves past the local one, the page fetches only the changes since then and patches the DOM in place. The composer, focus and scroll position are never touched.
- When the reader is more than about 120 px above the bottom, new messages raise a "New messages ↓" pill, which is the only `aria-live="polite"` node, instead of scrolling. Otherwise the page stays pinned to the bottom.

**Access states**
- **Signed out:** sign in, then come back here (`login.html?next=` the current URL).
- **Signed in without a registration:** "Register for FIIU to join", linking to `fiiu.html#registration`.
- **Closed question:** readable, with a "This conversation is closed" note. There is no composer and likes are disabled, but you can always delete your own messages.
- **Hidden or unknown question:** a "This conversation isn't available" note with a link back to the block.
- **Outages:** reported as errors, never as "signed out" (the `fiiu.js` `unread()` rule).

### Projector view: `fiiu-talk.html?q=<id>&present=1`

This view is for organisers only. Anyone else gets the normal page.
- **Layout:** large question text, a big QR code for the absolute `?q=` URL, and a "Latest / Most liked" switch showing about 12 messages (text clamped; images as thumbnails).
- **Controls:** a fullscreen button. No composer, likes or moderation controls.
- **Updates:** the same pulse loop.
- **QR:** the server builds it with `server/qr.js` (`encodeQr` and `packBits`, as on the check-in screen) from `PUBLIC_BASE_URL`, and the browser draws it as one SVG path using the `fiiu-qr.js` method.

## Organiser experience

### Conversaciones section in `fiiu-admin.js`

The section sits between News and Settings: an entry in `SECTIONS`, its own host, added to `lockOut` and to `observeSections`.

**Create form**
- **Block:** every current activity. Legacy activities are excluded.
- **Talk (optional):** shown when the block has `sessions`; the value must be one of those talk names.
- **Question:** 1–500 characters, with a counter.
- **"Publish now" or "Save hidden":** a hidden question is a prepared draft that is opened when the talk starts.
- **Draft safety:** the client sends a UUID per draft, as the publication editor does with `draftId`. An unsent question joins the existing `beforeunload` guard.

**Question list, grouped by block in programme order**
- Each question shows its text, talk, status, and counts: visible messages, distinct participants, and total likes.
- Counts refresh with the existing 60 s summary timer.
- **Actions:** Edit (text and talk), **Open / Closed / Hidden** (versioned PATCH; a 409 offers "reload latest"), Open chat, Present, and Download CSV.

**Moderation** happens on the chat page itself:
- Organisers see every message, including hidden ones, which are greyed with a "Hidden" tag.
- Each message gets **Hide** or **Unhide**. Organisers can post; their messages carry the organiser label.

**CSV export** has one row per message: question, block, talk, created at (Lima), full name, email, organiser flag, text, file names, likes, hidden and deleted flags.
- Formula injection is neutralised with the existing CSV helper.
- Organisers only.

## Data model

There are four new tables in one additive migration, `supabase/migrations/20261011120000_fiiu_conversations.sql`, plus matching SQLite DDL appended to `FIIU_SQLITE_SCHEMA`.
- Every table is `ENABLE ROW LEVEL SECURITY` with no client policies and `REVOKE ALL … FROM PUBLIC, anon, authenticated`.
- Grants go to `service_role`, as in the FIIU and final-survey migrations.
- Activity ids are text with no foreign key, because the catalogue lives in code (`ALL_FIIU_ACTIVITIES`). The server validates them.

**fiiu_questions**

| Column | Type and rule |
|---|---|
| id | uuid |
| event_id | text, `CHECK = 'fiiu-2026'` |
| activity_id | text |
| talk | text null, ≤180 |
| body | text, 1–500 |
| status | text, `open \| closed \| hidden` |
| revision | bigint ≥ 0, default 0 |
| message_count | int ≥ 0, visible messages |
| created_by | uuid, profiles, `ON DELETE SET NULL` |
| version | int > 0 |
| created_at, updated_at | timestamps |

Index: `(event_id, activity_id, created_at)`.

**fiiu_messages**

| Column | Type and rule |
|---|---|
| id | uuid |
| question_id | uuid, questions, `ON DELETE RESTRICT`; questions are never deleted, only hidden |
| user_id | uuid null, profiles, `ON DELETE SET NULL` |
| author_name | text ≤120, display name |
| author_full | text ≤240, full name for organisers |
| organiser | boolean |
| body | text ≤1000 |
| client_id | uuid |
| like_count | int ≥ 0 |
| seq | bigint |
| hidden_at | timestamptz null |
| hidden_by | uuid null, profiles, `SET NULL` |
| deleted_at | timestamptz null |
| created_at | timestamptz |

- `UNIQUE (user_id, client_id)`.
- Indexes: `(question_id, seq)`, `(question_id, created_at, id)`, `(user_id)`.

**fiiu_message_likes**

| Column | Type and rule |
|---|---|
| message_id | messages, `ON DELETE CASCADE` |
| user_id | profiles, `ON DELETE CASCADE` |
| created_at | timestamptz |

Primary key `(message_id, user_id)`; index `(user_id)`.

**fiiu_files**

| Column | Type and rule |
|---|---|
| id | uuid |
| event_id | text |
| user_id | profiles, `ON DELETE RESTRICT`; the application removes files before the account |
| message_id | uuid null, messages, `ON DELETE RESTRICT` |
| name | text ≤160, cleaned |
| mime | jpeg, png, webp or pdf |
| size | 1–3145728 |
| width, height | int null |
| thumb_size | int null, ≤ 102400 |
| storage_path | text |
| status | `pending \| ready \| deleting` |
| created_at | timestamptz |

Indexes: `(user_id)`, `(message_id)`.

**Revision and counters** are maintained by triggers, so every path that writes (including the account-deletion cascade) stays consistent.
- **Postgres:** the trigger functions are `SECURITY DEFINER SET search_path = ''`, as `20261003201144` requires for GoTrue cascades.
- **SQLite:** equivalent `AFTER` triggers. `recursive_triggers` is off, and the update triggers watch named columns, never `seq`.
- **Insert message:** `revision = revision + 1` on the question, `seq = new revision`, and `message_count + 1`.
- **Update message** (`body`, `hidden_at`, `deleted_at`, `like_count`, `author_name`): bump the revision, set `seq`, and change `message_count` when the message moves between visible and hidden or deleted.
- **Insert or delete a like:** change `like_count` on the message by one, which fires the message update trigger.
- **Update question** (`body`, `talk`, `status` only): bump the revision.
- **Profile delete** (Postgres `BEFORE DELETE ON profiles`, mirroring `erase_course_posts_on_account_delete`): blank `body`, `author_name` and `author_full`, and set `deleted_at`. The foreign key then nulls `user_id`, and the likes cascade.

**Quota:** at most 30 files or 30 MB per user per event, counting pending and ready rows.
- Postgres: a reservation RPC `reserve_fiiu_file(jsonb)` with a lock and trigger, copied from `20260909005100_course_upload_quota.sql`. It raises its own SQLSTATE, which maps to a translated 413 "festival upload allowance reached".
- SQLite: a `BEGIN IMMEDIATE` count.

**Storage**
- Bucket: the existing private `course-attachments` bucket, under `fiiu/<userId>/<fileId>` with the thumbnail at `fiiu/<userId>/<fileId>.thumb`. Its 3 MB limit and MIME list already fit.
- Local: SQLite keeps bytes in a `fiiu_file_bytes(file_id, variant, bytes)` table.

## API

Routes live in `server/fiiu-api.js`, plus a small `server/fiiu-conversations.js` module if `fiiu-api.js` grows past readability.
- Routes inherit the existing FIIU gate: 401 without a user (except the pulse), admin-only `/api/admin/`, `sameOrigin` on writes, then rate limits.
- Bodies use `bodyJson`: 24 KB for JSON writes, and 4 MiB + 160 KiB for file uploads.
- Errors carry a machine `code` the client translates: `not_registered`, `question_closed`, `question_unavailable`, `upload_allowance`, `file_type`, `file_size`.

**Access rule:** registered means a `fiiu_registrations` row exists for `(EVENT_ID, user.id)`.
- A per-instance memo caches positive answers for 60 s, so a burst of polls does not re-read the registration.
- Cancelling a registration removes access within that window.
- Organisers always pass.

**Public**

| Route | Behaviour |
|---|---|
| GET `/api/fiiu/pulse` | Sessionless: added to `SESSIONLESS_API`, so it never sets a cookie. Returns `{questions: [[id, activityId, revision, status], …]}` for questions that are not hidden. |

- Headers: `Cache-Control: public, max-age=0, s-maxage=2, stale-while-revalidate=4`.
- It contains no text or names, only which blocks have conversations and whether they changed.
- Organisers viewing a hidden question get live updates from the admin question list (`GET /api/admin/fiiu/questions` returns revisions) instead of the pulse.
- It is exempt from the per-IP public read limiter, because venue Wi-Fi puts hundreds of people behind one address. A per-instance memo of 1 s backs it up in case the CDN misses.

**Participants** (registered, or organisers)

| Route | Behaviour |
|---|---|
| GET `/api/fiiu/questions?activityId=` | The block's visible questions: `{id, activityId, talk, body, status, revision, messageCount, createdAt}` |
| GET `/api/fiiu/questions/:id` | `{question, messages, before, revision, liked: [ids], me: {organiser, canPost}}` with the latest 100 visible messages, oldest first. Organisers also get hidden messages. |
| GET `/api/fiiu/questions/:id/messages?since=<revision>` | `{revision, changes, liked}`: every message with `seq > since`, including `{id, deleted: true}` / `{id, hidden: true}` for participants, at most 200 rows. More returns `{reset: true}` and the client reloads. |
| GET `/api/fiiu/questions/:id/messages?before=<cursor>` | An older page of 100 |
| POST `/api/fiiu/questions/:id/messages` | `{clientId, body, fileIds}`. Returns 201 with the message. An identical retry returns 200. A reused `clientId` with different content returns 409. A closed question returns 403 `question_closed`. Files must be the poster's own, ready and not yet attached. |
| DELETE `/api/fiiu/messages/:id` | Own message only, allowed even on a closed question. Tombstones it (`body = ''`, `deleted_at`) and releases its files (the `releasePostFiles` pattern). |
| PUT / DELETE `/api/fiiu/messages/:id/like` | `{likeCount, liked}`. Idempotent. Not allowed on your own message or on a closed question. |
| POST `/api/fiiu/files` | `{name, mime, data, width?, height?, thumb?: {data, width, height}}`. `decodeAttachment` checks the magic bytes and the 3 MB limit, with types limited to the four allowed. The thumbnail must be JPEG or WebP and at most 100 KB. The row is reserved as pending, the bytes are stored, then the row is marked ready. Returns 201 `{file: {id, name, mime, size, width, height, thumb}}`. |
| GET `/api/fiiu/files/:id[?size=thumb]` | Registered or organiser. Another person's file is served only when attached to a message that is visible, or to organisers. |

File download headers:
- Images: `Content-Disposition: inline`. PDFs: `attachment` (Chrome blocks its PDF viewer under a sandbox CSP).
- Always `CSP: default-src 'none'; sandbox`, `nosniff`, `Cache-Control: private, max-age=86400, immutable`, an ETag, and `Vary: Cookie`.
- Downloads count against the shared course byte budget (64 MiB per 10 min, 512 MiB per day per account); organisers are exempt.

**Organisers**

| Route | Behaviour |
|---|---|
| GET `/api/admin/fiiu/questions` | Every question with its counts: visible messages, distinct authors, sum of likes |
| POST `/api/admin/fiiu/questions` | `{id?, activityId, talk?, body, status: 'open' \| 'hidden'}`. Idempotent by client id, like content. |
| PATCH `/api/admin/fiiu/questions/:id` | `{version, body?, talk?, status?}` |
| PUT / DELETE `/api/admin/fiiu/messages/:id/hidden` | Hide or unhide, recording `hidden_by` |
| GET `/api/admin/fiiu/questions/:id/export` | CSV |
| GET `/api/admin/fiiu/questions/:id/qr` | `{size, bits, url}` for the projector |

**Message view**
- Fields: `{id, author, organiser, mine, body, files, likeCount, createdAt, seq}`, plus `hidden` and `authorFull` for organisers.
- `userId` is never sent to peers.

**Display name**
- Participants: registration `answers.firstName` plus the first letter of `answers.lastName` and a full stop.
- Organisers without a registration: the profile name, split the same way.
- Both forms are snapshotted when the message is written.

**Rate limits** are per account and per instance, set in `server.js` next to the FIIU limiters:

| Action | Limit |
|---|---|
| Messages | 10 per minute |
| Uploads | 6 per minute |
| Likes | 60 per minute |
| Organiser hide / unhide | 120 per minute |
| Other writes | the existing 30 per minute |
| Reads | the existing 120 per minute |

## Client files and loading

**New files**
- `web/pages/fiiu-talk.html`: same head and CSP as `fiiu-checkin.html`, root `fiiuTalkRoot`.
- `web/scripts/fiiu-talk.js`: chat, polling, uploads and projector.
- `web/styles/fiiu-talk.css`: chat and projector styles, loaded only there, following the `f-` scope rule.

**Strings and styles**
- Strings shared with the FIIU page, the dashboard and the admin (link labels, section names) go in the `fiiu-ui.js` `rows` dictionary as `[en, es, pt]`.
- Chat-only strings stay in `fiiu-talk.js` and register with the same translator, so the shared `fiiu-ui.js` stays small.
- Organiser styles go in `fiiu.css`.

**Registration of the new page and script:** `STATIC_PAGES` / `SERVER_PAGES` (protected: no-store, noindex), `STATIC_SCRIPTS` in both `server.js` and `build-static.js`, the `vercel.json` script regex, the `?v=` pins in `deploy.test.js`, and the root id in `tests/helpers/fiiu-ui-harness.js`.

**Cache keys:** bump `?v=` on every page that loads changed CSS or JS.

**Image preparation in the browser**
- `createImageBitmap(file, {imageOrientation: 'from-image'})`, drawn on a canvas.
- Full image: `toBlob('image/jpeg', 0.85)` at a long edge of at most 1,600 px.
- Thumbnail: `toBlob('image/jpeg', 0.7)` at a long edge of at most 480 px.
- Both are sent as base64 read through `FileReader` (the CSP has no `blob:`).
- Re-encoding also strips EXIF, including GPS.
- If decoding fails, the original is sent when it is at most 3 MB, with no thumbnail, and the server falls back to the full image.

## Privacy, export and deletion

**Privacy policy** (`docs/privacy/privacy-policy.{en,es,pt-BR}.md`)
- A new "FIIU conversations" row in the data table: messages, display name, images and PDFs, and likes are visible to people registered for FIIU and to administrators, and organisers see the full name.
- A festival bullet in section 4.
- Export and deletion behaviour.
- A note that cancelling a registration keeps your messages.
- The existing metadata caution, extended to PDFs.
- Also: regenerate `privacy.html` with a new date, add rows to `implementation-review.md`, and pin the new row in a test in all three languages.

**Account export:** `exportFiiuData` adds your messages (question text, body, created at, deleted and hidden flags), your file metadata (no storage path) and the ids of messages you liked.

**Account deletion:** a new `deleteFiiuData` runs before the account is deleted (`server.js` next to `deleteCourseData`).
- It returns 409 while one of your uploads is pending.
- It blanks your messages, removes your likes, then deletes your Storage objects and file rows.
- The Postgres profile trigger is the safety net for deletions made outside the application.

**Cancelling a registration:** messages are kept, and the cancel confirmation says so.

## Testing

| File | What it covers |
|---|---|
| `tests/fiiu-conversations.test.js` | The real app against SQLite: the access matrix (signed out, not registered, registered, organiser), questions CRUD and statuses, idempotent posts, since-sync including tombstones and `reset`, likes (own and closed refused, idempotent), hide and unhide visibility, files (types, magic bytes, size, thumbnail, quota, attach rules, download authorisation and headers), deletion and export, rate limits, the pulse (sessionless, no Set-Cookie, cache header, hidden excluded, no text), CSV neutralisation |
| `tests/fiiu-conversations-supabase.test.js` | The PostgREST adapter with a fake fetch, including the quota RPC error mapping |
| `tests/fiiu-conversations-postgres.test.js` | Opt-in, against a disposable local database: the triggers (revision, seq, like_count, message_count), the erasure cascade as the auth role, the quota lock, RLS and grants closed, and an additive-only allow-list entry in `review-fix-4-grants.test.js` |
| `tests/fiiu-talk-ui.test.js` | The vm harness: rendering, the pulse loop with fake timers and backoff, sending (optimistic, retry, idempotent), likes, the scroll pill, every access state, organiser hide, the projector |
| `tests/fiiu-admin-ui.test.js` | The Conversaciones section (create, edit, status, export link, beforeunload), plus default stubs for the new GET |
| Existing suites | Deploy, page-loading and static-build checks stay green, along with both builds: plain, and with Vercel's production environment |

**Browser checks** on `127.0.0.1`: the chat at 375 px, two accounts talking with likes and a hide, the projector at 1920×1080, and the admin section.

**Local load check:** a script with 300 simulated pollers shows that pulse reads stay bounded. This is not a claim about production capacity.

## Release order

1. Deploy the UI round, or ship it together with this.
2. With the user's explicit approval, apply the migration to production with `supabase db query --linked -f`. The user runs `migration repair --status applied <version>`. Never run `db push`.
3. Deploy the code. The Supabase adapter selects the new tables, so the migration must already be applied.
4. Verify `x-vercel-cache: HIT` on `/api/fiiu/pulse` and the read-only pages. The first question is created by organisers. NODAL makes no production test writes.

## Out of scope

- Nested replies and editing messages
- Questions started by participants
- Reactions other than like
- Notifications by push or email
- WebSockets and Supabase Realtime
- Search, and translating messages
- Participants reporting messages
- Files over 3 MB, and audio or video

## Risks and checks

- **CDN caching** is unproven in production until the UI round's `s-maxage` deploys. The per-instance memo limits database reads if the CDN does not cache.
- **Latency:** functions run in `pdx1` (Oregon). Uncached requests from Lima cost about 150–200 ms each way, which is fine for chat.
- **Rate limits and download budgets** are held in memory per instance, as today.
- **Metadata:** EXIF is stripped only when the browser re-encodes, and PDFs keep their metadata. The privacy policy states this.
- **Schedule:** the timeline is tight, so the projector is built last and can be cut without affecting the chat.
