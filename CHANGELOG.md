# Changelog

## 0.4.0 — 15.09.2026

- **Bitrix24 Chatbot**, a new node on Chatbots 2.0 (`imbot.v2`): 34 operations across 7 resources.
  Registering, changing and deleting bots of four types; messages with attachments, keyboards,
  replies and forwards, reactions and read marks; reading a message and the messages around it
  (supervisor and personal assistant bots); group chats the bot creates, their members, managers
  and owner; the activity indicator and turning typing off; slash commands and answers to them;
  files uploaded from binary data and downloaded into it; the bot's event queue.
- **Bitrix24 Chatbot Trigger**, a new polling trigger: messages to the bot, commands and button
  presses, reactions, being added to a chat and a chat opened with context. It refuses a bot that
  posts its events to a URL.
- **Bitrix24 Chatbot Webhook API**, a new credential: the webhook fields plus the bot token, so the
  token stays out of workflow parameters. Tokens over 40 characters are refused.
- Checked on a live portal: all 34 chatbot operations and the trigger, with hidden test bots. The
  messenger's Message → Run Bot Command, left unchecked in 0.3.0, was checked on a test bot too.
- The download code of the messenger node moved into `shared/`, and the transport can take its
  portal from either credential. No change to any published parameter, operation or credential.

## 0.3.0 — 14.09.2026

- **Bitrix24 Messenger**, a new node: 63 operations across 10 resources. Messages with
  attachments, keyboards and context menus, edits, likes, read marks and search; group chats and
  their members; the recent chats list; files uploaded from binary data and downloaded into it;
  notifications; users, their status and colleagues; departments; the search history; the event
  queue of the webhook user (`im.v2.Event`).
- **Bitrix24 Open Lines**, a new node: 43 operations across 6 resources. Dialogs and sessions,
  operator actions, chats of CRM records, open line settings, contact center statistics
  (`imopenlines.v2`) and actions of a line chatbot.
- **Bitrix24 Messenger Trigger**, a new polling trigger: new, edited and deleted messages,
  reactions and new members in the chats of the webhook user, without a public URL.
- File downloads never output the link Bitrix24 returns: for a webhook it contains the webhook code.
- Checked on a live portal: 56 of the 63 messenger operations, 14 of the 43 open lines operations,
  and the trigger. The open lines operations that reach real clients were not run.
- Shared helpers for Y/N flags, ID lists, offset paging and message JSON moved into `shared/`. No
  change to any published parameter, operation or credential.

## 0.2.0 — 14.09.2026

- **Bitrix24 Tasks**, a new node: 129 operations across 17 resources. Tasks with their status
  changes, comments in the task chat, history, counters and access checks; checklists, time
  entries, results and Gantt dependencies; kanban and My Plan stages; task custom fields;
  templates with their checklists; flows; workgroups and their members; scrum sprints, epics,
  backlogs, sprint kanbans and scrum task data. REST 3.0 is used where the classic API has no
  method: the task chat, results and dependency lists. Workgroup Member → Request to Join refuses
  a user who is already in the group, because Bitrix24 takes them out; Remove refuses the owner.
- Checked on a live portal: 116 of the 129 operations. The 13 scrum sprint, sprint kanban and
  scrum task operations had no scrum to run on.
- Shared parameter helpers moved out of the CRM node into `shared/`. No change to any
  published parameter, operation or credential.

## 0.1.0 — 14.09.2026

First version. Three nodes, one credential.

- **Bitrix24 Webhook API** credential: portal subdomain, a closed list of 23 cloud zones, and
  the webhook token. Pinned out of the HTTP Request node.
- **Bitrix24**: call any REST method (classic or REST 3.0) with three paging modes; batches of
  up to 50 named commands; one call per input item packed 50 to a request; portal permissions,
  methods, current user, server time, access names.
- **Bitrix24 CRM**: 268 operations across 42 resources on the universal `crm.item` API: leads,
  deals, contacts, companies, quotes, invoices, smart processes and everything around them.
- **Bitrix24 Trigger**: outgoing webhooks with an application-token check, an event filter and
  an optional read of the changed CRM record.

All 277 operations were run on a live portal before release, writes on throwaway records. See
"What was checked" in the README.
