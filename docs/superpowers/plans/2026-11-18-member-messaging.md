# Member messaging and project groups implementation plan

> Agentic execution uses parallel workers for the two storage backends and the member interface. The integration owner tests them together.

**Goal** — Search by name, exchange private messages, invite a group and coordinate projects in NODAL.

**Architecture** — The signed-in dashboard and profile open a private Messages page. A session-scoped HTTP handler validates commands and calls a transactional SQLite store locally or a service-only PostgreSQL function through the existing server client.

**Tech stack** — Node, native browser JavaScript, SQLite, PostgreSQL and PostgREST.

**Spec** — `docs/superpowers/specs/2026-11-18-member-messaging-and-project-groups.md`.

## Global constraints

Use directory eligibility for new contact and membership for ongoing access. Keep the original direct exchange private. Use EN, ES and PT. Verify locally and show the member experience before deployment.

## Review focus

Exercise simultaneous first messages, duplicate client submissions, stale directory matches, pending invitations, and access after leaving. Verify that a member's export includes only their own contributions.

## Shared contract

Store signature: `execute(actorId, op, data)` returning JSON, or an error with a public HTTP status. PostgreSQL exposes `public.member_workspace(p_actor uuid, p_op text, p_data jsonb)` to service_role only; expected refusals return `{error, status}`. Each command executes atomically. The API derives the actor from the current session and supplies validated data. IDs for recipients are the existing member IDs. Client IDs are UUIDs and are scoped to their author and operation.

Read operations:

- `inbox {}` → `{threads, invitations}`. Thread summaries are `{id,kind:'direct'|'group',name,status:'pending'|'active'|'blocked',peerId?,initiatorId?,unread:boolean}`. Invitations are `{id,name,inviterName}` where id identifies the group.
- `thread {threadId,beforeMessageId?}` → `{thread,members,messages,projects,moreMessages}` (up to 50 chat messages per page, with a revision on the thread). Members are `{id,name,status:'active'|'invited'}`. Messages are `{id,authorId,authorName,body,createdAt}` in chronological order. Projects have `{id,title,goal,link,steps,updates}`. Steps have `{id,description,assigneeId,done}`; updates use the message shape. Return only to participants; opening clears unread for the viewer using an explicit `read` command.
- `export {}` returns the account's own contributions and memberships, used internally.

The browser reads `GET /api/workspace` for inbox or `GET /api/workspace?threadId=...` for a thread. Mutations use `POST /api/workspace` with `{op,...data}`. Successful writes return `{threadId}` (also `projectId` for createProject). The client refreshes the relevant view.

| Operation | Data |
| --- | --- |
| direct | targetId, body, clientId |
| send | threadId, body, clientId |
| read | threadId, revision (clear unread only if the revision still matches) |
| block, accept, decline, leave | threadId (decline addresses a group invitation; block also declines direct introductions) |
| group | name, targetIds[], clientId |
| invite | threadId, targetId, clientId |
| createProject | threadId, title, goal, clientId |
| link | threadId, projectId, link |
| step | threadId, projectId, description, assigneeId or null, clientId |
| toggle | threadId, projectId, stepId, done |
| update | threadId, projectId, body, clientId |

## Tasks

- [x] Implement the contract in `server/workspace-sqlite.js` with normalized storage, foreign keys and erasure via user deletion. Verify direct inbox, authorization, invitations and idempotency with SQLite.
- [x] Implement the same operations, membership rules and erasure guarantees in a Supabase migration. Exercise the function and permissions in a disposable PostgreSQL instance.
- [x] Build `web/pages/messages.html`, `web/scripts/messages*.js` and `web/styles/messages.css`. Exercise search, replies, invitations, project actions and error recovery on desktop and phone.
- [x] Integrate the authenticated HTTP handler, dashboard search actions, profile actions, account export, page/asset manifests and privacy copy. Test end to end, run the build and open a local preview with fictitious accounts.
