# From a name to a conversation in NODAL

Design proposal, November 18, 2026

## What members should be able to do

A member who met Ana at a workshop remembers her name. They search for Ana in NODAL, recognize her by her role and city, and ask if she wants to compare notes. Ana sees the message the next time she opens NODAL. They can invite another member into a new group and work on a project there. Each step happens inside the platform.

## Where to start

The dashboard already opens search in **People**. After two characters it searches the member directory and shows a name, role and city. Selecting the name opens the matching profile by member ID. Today the recommendation deck’s **Connect** action records a follow, and the profile’s Projects section displays an empty state. Neither gives Ana a place to reply.

Start with the existing People results. Keep the name as a profile link and put **Message** beside it, also available on the profile itself. A profile-only entry would add a step for someone who recognizes the name. A group directory would help someone exploring a topic, but a member looking for Ana already knows where to begin.

## The conversation

1. **Find Ana.** Show the same role and city in the result and at the top of the composer. Select the recipient by member ID, including when two names match. Opening a composer starts a draft. Sending the first message creates the conversation and puts it in Ana’s **Messages** inbox on the dashboard.
2. **Get a reply.** Ana can read the introduction, reply or decline. One introduction can be pending per pair. A reply opens the conversation for both members. Declining closes the request and prevents repeat introductions from the sender. Following someone, exchanging email addresses and staff intervention are unnecessary. Searching for Ana again opens the same thread.
3. **Form a group.** Either participant can choose **Create group**, name it, and search for people to invite. Also offer **New group** in Messages for people who already know whom they want to bring together. The creator sees who has accepted. Each invitee, including Ana when starting from a direct conversation, decides whether to join. The group opens its own conversation. The original two-person exchange stays between its participants.
4. **Work on a project.** A group member can create a project with a title and a short goal. The group’s Projects list opens a shared page where members post progress, pin a link to their working document and maintain a list of next steps. A next step has a description, an optional group member responsible for it, and a completion checkbox. Multiple projects can belong to the same group. Returning members can reach them through **Messages → Group → Projects**.

## Proposed defaults

- **Access.** Active signed-in members can contact someone who is currently listed in the directory. Starting a message or sending a group invitation shows how the sender’s name will appear. Recheck eligibility when sending. Removing a directory listing prevents new contact through search. Existing accepted conversations and groups remain available until the member leaves or blocks further direct contact.
- **Contact controls.** Declining a first message also dismisses pending group invitations from that sender and prevents them from inviting the recipient again. A member can block direct contact after a conversation has started, with the same restriction on invitations. Explain at the action that both people can still see and participate in groups they already share. Leaving a shared group is a separate choice.
- **Groups.** Groups are private and invitation-only. Any current participant can invite another listed member. An invitation shows the group name and inviter. Acceptance opens the group's shared history and projects. Members can leave, and leaving revokes access to both. Group membership grants the same project editing rights to each participant. Closing the last membership removes the empty group and its projects.
- **Inbox.** Keep private messages, group conversations and invitations reachable from the member dashboard on phones and desktops. Show unread activity and distinguish pending invitations from messages. Keep message bodies inside signed-in views. Use plain text, keyboard-accessible actions and interface labels in NODAL’s three languages.
- **Project visibility.** The group chooses its own work. Member-created projects belong to the private group. The dashboard’s public catalog search continues to return published listings. A public group directory, publishing group projects, file uploads and external notifications are outside this first version.

## Implementation notes

Use the existing People search endpoint and directory consent rules. The dashboard search is in `web/scripts/dashboard.js`; profile actions are in `web/scripts/profile.js`. Give private conversations, group membership and projects their own stored records and server-side access checks. Both the local SQLite and hosted PostgreSQL paths need the same behavior. FIIU’s message handling provides patterns for retry-safe sends and fetching newer messages. Its event access and organiser exports apply only to the festival.

Store one direct conversation per pair even when both people send at once. A deliberate send, invitation or project creation should survive a retry without duplication. Keep private content out of public listings and shared caches. Extend the existing account export and erasure flows to cover the member’s authored contributions and membership records. On erasure remove the member’s text and attribution in conversations, clear their assignments and preserve the remaining members’ work.

## How to tell it works

- Two members with the same name appear as distinct results. A sender selects the intended person by role and city, sends a message and gets a reply in their NODAL inbox. Reopening from either profile or search returns to that exchange.
- Three members can form a group by searching for names. An invitee can decline. An accepted invitee sees group messages and projects. The original direct messages remain visible only to their two participants.
- One member creates a project and assigns a next step. Another opens NODAL later, reads the goal, posts an update and marks the step complete. Both see the result after refreshing.
- Unlisting prevents a new introduction, leaving a group revokes access even through a saved project link, and retrying a send delivers only one message.
