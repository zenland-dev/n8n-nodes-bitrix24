# @zenland-dev/n8n-nodes-bitrix24

n8n community nodes for [Bitrix24](https://www.bitrix24.com): a CRM node with 268 operations
across 42 resources, a tasks node with 129 operations across 17 resources, a messenger node with
63 operations, an open lines node with 43, a chatbot node with 34, a node that calls any of the
~1400 REST methods by name or in batches, a trigger for outgoing webhooks, and two triggers that
need no public URL: one for chat messages, one for messages and commands sent to a bot.

Written from scratch against the official REST documentation
([bitrix24/b24restdocs](https://github.com/bitrix24/b24restdocs), read on 14.09.2026). No code
from any other package.

**Status: 0.4.0.** Every operation of the CRM and chatbot nodes was run on a live production
portal, 116 of the 129 of the tasks node, 57 of the 63 of the messenger node and 14 of the 43 of
the open lines node: reads as they are, writes on objects the test created and deleted. What was not run, and
why, is under [What was checked](#what-was-checked). Operations that work with a limitation of
Bitrix24 itself are listed under [Quirks](#quirks-worth-knowing).

- [Installation](#installation)
- [Credentials](#credentials)
- [Bitrix24 node](#bitrix24-node)
- [Bitrix24 CRM](#bitrix24-crm)
- [Bitrix24 Tasks](#bitrix24-tasks)
- [Bitrix24 Messenger](#bitrix24-messenger)
- [Bitrix24 Open Lines](#bitrix24-open-lines)
- [Bitrix24 Chatbot](#bitrix24-chatbot)
- [Bitrix24 Trigger](#bitrix24-trigger)
- [Bitrix24 Messenger Trigger](#bitrix24-messenger-trigger)
- [Bitrix24 Chatbot Trigger](#bitrix24-chatbot-trigger)
- [Rate limits](#rate-limits)
- [Quirks worth knowing](#quirks-worth-knowing)
- [What was checked](#what-was-checked)
- [What is not here yet](#what-is-not-here-yet)

## Installation

In n8n: **Settings → Community nodes → Install**, then enter `@zenland-dev/n8n-nodes-bitrix24`.

Self-hosted, from the command line:

```bash
npm install @zenland-dev/n8n-nodes-bitrix24
```

Requires n8n 2.x and Node 20.19 or newer.

## Credentials

Seven of the nine nodes use **Bitrix24 Webhook API**, built from an inbound webhook. The chatbot
node and its trigger use **Bitrix24 Chatbot Webhook API**: the same fields plus a bot token, see
[below](#bitrix24-chatbot-webhook-api).

Create the webhook in Bitrix24 under **Developer resources → Other → Inbound webhook** and tick
the permissions the workflows need: `crm` for the CRM node; `task`, `tasks` and `sonet_group`
for the tasks node; `im` for the messenger node and its trigger; `imopenlines` for the open lines
node, plus `crm` for its CRM chats; plus whatever modules you call through the Bitrix24 node. The webhook acts as the user who created it and sees only what that
user may see, so a webhook made by a sales manager cannot read another manager's deals.

The credential has three fields instead of one URL.

**Portal Subdomain** and **Portal Domain.** `mycompany` and `bitrix24.com` for
`mycompany.bitrix24.com`. The domain is a closed list of the 23 zones Bitrix24 serves cloud
portals on (`.com`, `.eu`, `.de`, `.ru`, `.kz`, `.com.br` and so on). A webhook URL carries
its secret in the path, so a free-form address would let anyone who can edit the credential
send that secret to their own server. The list is enforced again inside the nodes, not only in
the dropdown. Self-hosted Bitrix24 on its own domain is not supported for the same reason.

The zones were found by resolving a random subdomain in each candidate: Bitrix24 zones answer
with wildcard DNS, `.ua`, `.am`, `.az`, `.ge` and `.kg` do not resolve, and `.cz` and `.au`
resolve to parking pages that have nothing to do with Bitrix24.

**Webhook Token.** The part of the webhook URL after `/rest/`, like `1/abcdef0123456789`.
Pasting the whole URL works: only the tail is kept, and the host in it is ignored.

**Requests per Second** defaults to 2, the limit on every plan below Enterprise.

The credential is pinned out of the HTTP Request node (`Allowed HTTP Request Domains` is fixed
to none), and it has no `authenticate` block, so even a credential selected there would add
nothing to a request.

### Bitrix24 Chatbot Webhook API

Through a webhook, Bitrix24 tells bots apart by `botToken`: a string you make up when the bot is
registered and send with every later call. Whoever has the webhook and the token can act as the
bot, so the token is a secret, and it lives in the credential rather than in a node parameter,
where it would travel inside every exported workflow.

- The webhook needs the `imbot` permission, plus `im` if a bot should also read the webhook user's
  own events.
- **Bot Token**: up to 40 characters; the documentation announces that registration refuses longer
  ones from 06.08.2026, and the node refuses them already. 32 random letters and digits from a
  password generator do.
- Keep the token once a bot is registered with it. Another token cannot reach that bot, and the
  node does not offer rotating it: the new token would have to be typed into a workflow.
- One token can hold several bots. Every operation picks the bot from a list of the token's bots.

**Test** calls `imbot.v2.Revision.get`, which checks the portal, the webhook and its `imbot`
permission. It cannot check the token: before a bot is registered with it, any token is as good
as another.

## Bitrix24 node

The escape hatch. Anything the CRM node lacks, and every module that has no node yet, is one
call away here.

| Resource | Operations |
|---|---|
| **Method** | Call |
| **Batch** | Execute Commands, Call for Each Item |
| **Portal** | Get Permissions, Get Methods, Check Method, Get Current User, Get Server Time, Get Access Names |

**Call** takes a method name and a JSON body, for example `crm.item.list` with
`{"entityTypeId": 2, "select": ["title", "stageId"]}`. Pagination has three modes. *First
Page Only* sends one request. *Follow Pages* repeats with `start` until Bitrix24 stops
sending `next`. *Page by ID* filters by the last ID received with `start: -1`, which tells
Bitrix24 not to count the total. On the portal these nodes were tested on, a first page with
the count took 1.7 s and without it a fraction of that, for the same 50 deals.

**API Version** switches to REST 3.0 (`/rest/api/`). Some newer methods exist only there:
`main.eventlog.*`, `mail.mailbox.*`, `note.*`, `humanresources.*`, `timeman.record.*`.

**Execute Commands** sends up to 50 named calls in one request, and a later command can use an
earlier result: `{"id": "$result[list][items][0][id]"}`. Such references only work inside one
request, which is why the node refuses a 51st command instead of splitting the list.

**Call for Each Item** is for bulk work. It makes the same kind of call once per input item and
packs them 50 to a request, so 500 new leads cost 10 requests instead of 500. Output items stay
paired with their inputs. With Continue On Fail on, a failed call becomes an error item and the
rest go through; with it off, the node stops, but every call of that run has already been sent.

## Bitrix24 CRM

Built on the universal `crm.item.*` API, so field names are camelCase (`title`, `stageId`,
`assignedById`) and custom fields are `ufCrm…`. The older per-entity methods (`crm.deal.add`
and friends) are frozen by Bitrix24 and are not wrapped; call them through the Bitrix24 node if
an old integration needs their exact behaviour.

| Resource | Operations |
|---|---|
| **Lead, Deal, Contact, Company, Quote, Invoice** | Create, Get, Get Many, Update, Delete, Get Fields, Import, Merge |
| **Smart Process Item** | the same, for any smart process picked from a list |
| **Product Row** | Add, Get, Get Many, Update, Replace All, Delete, Get Fields, Get Available for Payment |
| **Activity** | Create To-Do, Update To-Do, Set Deadline, Set Description, Set Responsible, Set Color, Complete, Get, Get Many, Delete, Get Fields, Get Call Transcript, Link to Record, Unlink From Record, Get Links, Move |
| **Timeline Comment** | Create, Get, Get Many, Update, Delete |
| **Timeline Note** | Save, Get, Delete |
| **Timeline Log Entry** | Create, Get, Get Many, Delete |
| **Timeline Entry** | Link to Record, Unlink From Record, Get Links, Pin, Unpin |
| **Linked Contact** | Add, Remove, Get Many, Replace All, Remove All (on leads, deals, quotes, companies) |
| **Linked Company** | the same, on contacts |
| **Duplicate** | Find by Phone or Email, Get Extra Search Fields, Get Addable Search Fields, Add Search Field, Remove Search Field |
| **Pipeline** | Create, Get, Get Many, Update, Delete, Get Fields |
| **Reference Book** | Create, Get, Get Many, Update, Delete, Get Fields, Get Reference Books, Get Book Entries |
| **Smart Process Type** | Create, Get, Get Many, Update, Delete, Get Fields, Get by Entity Type ID |
| **Custom Field** | Create, Get, Get Many, Update, Delete (leads, deals, contacts, companies, quotes, requisites) |
| **Custom Field Config** | Create, Get, Get Many, Update, Delete, Get Field Types (any CRM type, smart processes included) |
| **Requisite, Bank Detail** | Create, Get, Get Many, Update, Delete, Get Fields |
| **Address** | Create, Get Many, Update, Delete, Get Fields |
| **Requisite Link** | Get, Get Many, Set, Remove, Get Fields |
| **Requisite Template, Requisite Template Field** | Create, Get, Get Many, Update, Delete, Get Fields (+ Get Available to Add) |
| **Document** | Generate, Get, Get Many, Update, Delete, Set Public Link, Get Placeholders, Upload |
| **Document Template, Document Numerator** | Create, Get, Get Many, Update, Delete |
| **Payment** | Create, Get, Get Many, Update, Delete, Mark as Paid, Mark as Unpaid, Get Payment Link, and products and deliveries inside a payment |
| **Delivery** | Get, Get Many |
| **Recurring Deal** | Create, Get, Get Many, Update, Delete, Get Fields, Create Deal Now |
| **Order Link** | Create, Delete, Get Many, Get Fields |
| **Call List** | Create, Get, Get Many, Update, Get Entries, Get Statuses |
| **Stage History** | Get Many |
| **Automation Trigger** | Fire |
| **Sales Intelligence Trace** | Create, Delete |
| **Currency** | Create, Get, Get Many, Update, Delete, Get Fields, Get or Set Base Currency, Get, Set or Delete Localizations |
| **Digital Workplace** | Create, Get, Get Many, Update, Delete, Get Fields |
| **Card Layout** | Get, Set, Reset, Force Common for All |
| **Dictionary** | eleven read-only lists: entity types, address types, CRM mode, custom field types and their settings |

### Fields come from the portal

Create, Update and Import show a field mapper filled from `crm.item.fields`. Custom fields are
in it with their labels, list fields become dropdowns with the portal's own values, and stage
IDs come with the pipeline in front (`Partners / Negotiation`). On the test portal a deal had
384 fields and 170 stages across 15 pipelines, so the mapper adds nothing by default: pick the
fields you need. Nothing is required on Update. Read-only fields are left out, and so are
`contacts` and `companies`: `crm.item.fields` lists them as writable, under the same titles as
`contactIds` and `companyIds`, but writing them fails with error 100.

Anything the mapper cannot express goes into **Fields (JSON)**, which is merged last and wins.
Clearing a field is done there too: the mapper skips empty inputs rather than sending blanks.

Leads, contacts and companies have a separate **Phones, Emails and Messengers** list. On Update
it only adds. `crm.item.update` ignores the ID of an existing value in `fm`, and an empty value
removes nothing, so a phone cannot be changed or deleted through this node. The older
per-entity methods can, through **Bitrix24 → Method → Call**: `crm.contact.update` (or
`crm.lead.update`, `crm.company.update`) with

```json
{"id": 15, "fields": {"PHONE": [{"ID": 711, "VALUE": "+49 30 7654321"}]}}
```

and `"DELETE": "Y"` in place of `VALUE` to remove one. The value IDs are in `fm` of **Get**, and
of **Get Many** when **Fields to Return** is empty or `*`; with a list of fields Bitrix24 leaves
`fm` out.

### Create runs automation, Import does not

**Create** behaves like a person pressing Save: automation rules, workflows, notifications to
the responsible user. **Import** (`crm.item.import`) creates the record without automation
rules and workflows. Use it for tests on a portal where a new deal would send a client an SMS.

Import takes phones, emails and messengers too, but not in `fm`: `crm.item.import` answers
`The value of an argument 'value' must be of type Bitrix\Crm\Multifield\Collection` to the form
every other `crm.item` method uses. The node sends them as `PHONE`, `EMAIL`, `WEB` and `IM`
lists instead, including `fm` written into Fields (JSON). Before 0.4.1 an Import with contact
details failed.

The documentation also promises that Import keeps historical `createdTime`. On a live portal it
does not: any `createdTime` older than records the portal already has, even by an hour, is
refused with `The value of "Date created" cannot be less than that of any other items`
(`CRM_FIELD_ERROR_VALUE_NOT_VALID`). Migrating old data with its dates needs a portal that is
still empty.

### Get Many reads by ID

Get Many sorts by ID and asks for the next 50 above the last one, with no total count. Set
**Order (JSON)** and it falls back to Bitrix24's offset paging, which counts the total on
every page and gets slower as the portal grows.

Before creating a client, **Duplicate → Find by Phone or Email** answers `found`, plus lead,
contact and company IDs. Bitrix24 itself returns `[]` for no match and an object for a match;
the node smooths that into one shape.

## Bitrix24 Tasks

Tasks, and everything a task lives in: checklists, time, results, dependencies, kanban
stages, templates, flows, workgroups and scrum. The webhook needs the `task` permission, plus
`sonet_group` for workgroups and `tasks` for the operations marked REST 3.0 below.

| Resource | Operations |
|---|---|
| **Task** | Create, Get, Get Many, Update, Delete, Get Fields, Start, Pause, Defer, Complete, Reopen, Approve, Return for Rework, Delegate, Start Watching, Stop Watching, Add to Favorites, Remove From Favorites, Pin, Unpin, Mute, Unmute, Add Comment, Get History, Get Counters, Check Access, Attach File, Get Daily Plan |
| **Checklist Item** | Create, Get, Get Many, Update, Delete, Complete, Reopen, Move After |
| **Time Entry** | Create, Get, Get Many, Update, Delete |
| **Result** | Create, Create From Chat Message, Get Many, Update, Delete |
| **Dependency** | Create, Delete, Get Many |
| **Kanban Stage** | Create, Get Many, Update, Delete, Move Task, Check Move Permission (group kanbans and My Plan) |
| **Custom Field** | Create, Get, Get Many, Update, Delete, Get Types, Get Fields |
| **Task Template** | Create, Get, Update, Delete, Get Fields |
| **Template Checklist Item** | Create, Get, Get Many, Update, Delete, Complete, Reopen, Move After, Move Before, Attach Drive Files, Remove Attachments |
| **Flow** | Create, Get, Update, Delete, Activate, Deactivate, Toggle Pin, Check Name |
| **Workgroup** | Create, Get, Get Many, Get My Groups, Update, Delete, Set Owner, Check Feature Access |
| **Workgroup Member** | Add, Invite, Request to Join, Get Many, Set Role, Remove |
| **Scrum Sprint** | Create, Get, Get Many, Update, Delete, Start, Complete Active Sprint, Get Fields |
| **Scrum Epic, Scrum Backlog** | Create, Get, (Get Many), Update, Delete, Get Fields |
| **Scrum Kanban Stage** | Create, Get Many, Update, Delete, Add Task, Remove Task, Get Fields |
| **Scrum Task** | Get, Update, Get Fields |

### Two APIs under one node

Bitrix24 is moving tasks to REST 3.0, and on a cloud portal in September 2026 both answer. The
node uses the classic `tasks.task.*` for almost everything, because REST 3.0 cannot yet filter a
task list by anything but ID. REST 3.0 is used where the classic API has nothing: **Add
Comment**, **Result → Create / Update / Delete / Create From Chat Message** and
**Dependency → Get Many**.

Fields are written in UPPER_CASE and come back in camelCase: `RESPONSIBLE_ID` goes in,
`responsibleId` comes out. That is Bitrix24, not the node.

### Comments are chat messages now

Since the new task card (module `tasks` 25.700), a task's discussion is a chat. **Add Comment**
posts into it. The old comment methods (`task.commentitem.*`) no longer read, change or delete
anything on such portals, so the node does not wrap them. The chat is read with **Bitrix24
Messenger → Message → Get Many** and the Dialog ID `chat<chatId>`; `chatId` is in every task.

The comment events of the **Bitrix24 Trigger** changed with it. According to the documentation,
Task Comment Updated and Task Comment Deleted are not sent for such tasks, and Task Comment Added
comes with `ID` 0 and the message ID in `MESSAGE_ID`. A delivery from the portal was not tried.

### Statuses

`status` is a number: 2 pending, 3 in progress, 4 awaiting control, 5 completed, 6 deferred,
7 declined. Change it with the operations, not by writing `STATUS`: they run the checks a
person pressing the button would. A task with **Require Result** does not complete until
**Result → Create**; a task with **Task Control** goes to 4 and waits for **Approve** or
**Return for Rework** by its creator.

### Get Many reads by ID

As in the CRM node: sorted by ID, the next 50 above the last one, no total. **Order (JSON)**
switches to offset paging, which counts the total on every page. On the test portal, with 69 000
tasks, that is the difference between a quarter and half a second per page.

## Bitrix24 Messenger

Chats, messages, files and notifications, as the user who owns the webhook. Everything this node
sends comes from that user, and everything it reads is what that user sees: a chat they are not
in does not open.

| Resource | Operations |
|---|---|
| **Message** | Send, Update, Delete, Get Many, Search, Like, Mark as Read, Mark as Unread, Mark All as Read, Send Typing Indicator, Create Object From Message, Run Bot Command |
| **Chat** | Create, Get, Find by Linked Object, Search, Update, Set Owner, Mute or Unmute, Leave |
| **Chat Member** | Add, Remove, Get Many, Get IDs |
| **Recent Chat** | Get Many, Get Changes, Pin or Unpin, Hide, Set Unread Mark |
| **File** | Upload, Download, Attach Drive Files, Save to Drive, Delete, Get Chat Folder |
| **Notification** | Send, Get Many, Search, Delete, Mark as Read, Mark All as Read, Answer, Press Button, Get Types |
| **User** | Get, Get Many, Search, Get Colleagues, Get Status, Set Status, Set Away, Clear Away, Get Unread Counters |
| **Department** | Get, Get Employees, Get Heads, Search |
| **Search History** | Add, Remove, Get Many |
| **Event Queue** | Subscribe, Unsubscribe, Get Many |

### Dialog ID

A conversation has one address in three spellings: `chat123` for group chat 123, `sg12` for the
chat of workgroup 12, and a plain user ID such as `7` for the private chat with user 7. Operations
that only make sense for group chats take **Chat ID**, a number, and accept `chat123` as well.

**Chat → Find by Linked Object** gets the chat of a task (`TASKS_TASK` and the task ID), a CRM
record (`CRM` and `DEAL|1663`), a workgroup, a calendar event or a call. **Create** refuses to bind a
new chat to a workgroup: every group already has its chat, and the documentation warns that a
second one breaks the chats of the group's tasks.

### Sending

**Message → Send** takes text with BB codes (`[B]bold[/B]`, `[USER=7]Anna[/USER]`,
`[URL=https://example.com]link[/URL]`), plus optional **Attachment (JSON)**, **Keyboard (JSON)** and
**Context Menu (JSON)**. Keyboard buttons that only run a bot command are dropped by Bitrix24 when a
user sends the message; links and `ACTION` buttons stay.

**Update** refuses an empty text. Bitrix24 treats an empty `MESSAGE` as "delete this message", and a
field mapped from an empty expression should not do that silently.

**Notification → Send** puts a notice into a user's bell instead of a chat, from the webhook user or
as a system notice. The documented tags that replace or group notifications do nothing through a
webhook: Bitrix24 does not store them, so the node does not offer them.

### Reading

**Message → Get Many** reads the latest messages, or pages back from a message or forward from it,
50 per request. Each message gets its `author` and `files` joined in, which Bitrix24 returns as
separate lists. **Search** finds messages in one chat by text and dates, 200 per request.

On the test portal, reading messages and notifications did not change any unread counter. Marking
is done only by the Mark operations.

### Files

**Upload** sends binary data into a chat in one request (`im.v2.File.upload`, up to 100 MB).
**Download** puts a chat file into binary data. There is no "get download link" operation on purpose:
the link Bitrix24 returns to a webhook is `/rest/<user>/<webhook code>/download/…`, so it carries the
webhook secret. The node fetches it inside the operation, only from the portal it came from, and
keeps it out of the output and out of error messages.

### Event Queue

Bitrix24 can record the messenger events of a user and hand them out on request, which needs no
public address. **Subscribe** starts recording new messages, deletions, reactions and new members in
every chat of the webhook user. **Get Many** reads them; passing the `nextOffset` of the previous read
confirms, and deletes, what came before. Events are kept for 24 hours. The **Bitrix24 Messenger
Trigger** does all of this by itself.

## Bitrix24 Open Lines

The contact center: conversations with clients who write from a website chat, Telegram, WhatsApp
and other connected channels. Messages sent here reach clients in their messenger.

| Resource | Operations |
|---|---|
| **Dialog** | Get, Get Chat by User Code, Get History, Start Session, Start Session From Message, Join, Take Over, Pin or Unpin, Pin All, Unpin All, Set Silent Mode, Rate as Supervisor, Create Lead, Save as Quick Answer |
| **Operator** | Take, Skip, Transfer, Finish, Finish Another Operator's, Mark as Spam |
| **CRM Chat** | Get Many, Get Latest Chat ID, Add User, Remove User, Send Message |
| **Open Line** | Create, Get, Get Many, Update, Delete, Get Public Page Link, Connect Network Line, Send Network Message |
| **Statistics** | Get Summary, Get Sessions, Get Session Metrics, Get Transfers, Get Ratings, Get Operator Load |
| **Bot Dialog** | Send Automatic Message, Hand to Free Operator, Transfer, Finish |

A conversation is an open channel chat (**Chat ID**), and each round of it, from the first client
message to closing, is a session (**Session ID**). To reach the client of a deal, find the chat with
**CRM Chat → Get Many** or **Get Latest Chat ID**, then **CRM Chat → Send Message** from an employee who
is in that chat.

**Open Line → Create** and **Update** show the settings people usually change: queue, distribution,
working hours, days off, welcome message, rating request. The other sixty or so settings of
`imopenlines.config.add` go into **Other Settings (JSON)** by their names.

**Statistics** reads the `imopenlines.v2` reports: totals for a period with breakdowns by channel,
hour and operator; sessions with filters; per-session metrics and transfer history (any number of
IDs, split into the batches Bitrix24 allows); client ratings; the current load of operators. A period
is at most 366 days. These methods need access to open channel reports on the plan and for the user.

**Bot Dialog** acts for a chatbot connected to a line. Through a webhook Bitrix24 must be told which
bot: give the `botToken` it was registered with in `imbot.v2`, the Bot Token of the Bitrix24 Chatbot
Webhook API credential.

Connectors (`imconnector.*`) are not here: Bitrix24 does not let a webhook call them.

## Bitrix24 Chatbot

A bot of your own in the Bitrix24 messenger (Chatbots 2.0, `imbot.v2`): it has its own name and
avatar, people write to it privately or mention it in group chats, and it answers with text,
cards, buttons and files. Everything it sends comes from the bot, not from the webhook user.

| Resource | Operations |
|---|---|
| **Message** | Send, Update, Delete, Mark as Read, Get, Get Context, Add Reaction, Remove Reaction |
| **Chat** | Create, Get, Update, Leave, Set Owner, Add Managers, Remove Managers, Show Activity Indicator, Set Input Field |
| **Chat Member** | Add, Remove, Get Many |
| **Command** | Register, Update, Get Many, Unregister, Answer |
| **File** | Upload, Download |
| **Bot** | Register, Get, Get Many, Update, Unregister, Get API Revision |
| **Event** | Get Many |

### Getting a bot going

1. Create the **Bitrix24 Chatbot Webhook API** credential with a token of your own.
2. Run **Bot → Register** once, with a code such as `support_bot` and a name. Registering the same
   code again returns the existing bot unchanged, so leaving this node in a workflow does no harm.
3. Put a **Bitrix24 Chatbot Trigger** on the bot, and answer with **Message → Send** to the
   `chat.dialogId` of the event.

A conversation is a **Dialog ID**: `chat123` for group chat 123, or a user ID such as `7` for the
private chat of the bot with user 7. In an event from a private chat, `chat.dialogId` is already the
other person's ID, so it goes straight back into Send.

### Bot types

**Type** is set at registration and cannot be changed later.

- **Bot** gets every message of its private chats, and in group chats only the messages that mention
  it (`[USER=<bot id>]…[/USER]`). This is the one most bots need.
- **Supervisor** and **Personal Assistant** get every message of every chat they are in, and only
  they may read with **Message → Get** and **Get Context**. A plain bot asking gets
  `BOT_TYPE_NOT_ALLOWED`. Get Context returns up to 50 messages on each side of one, with authors,
  which is what an AI agent needs to see the conversation.
- **Open Channel Bot** answers clients in open channels and otherwise behaves like Bot.

### Buttons and commands

**Keyboard (JSON)** puts buttons under a message. A button with `LINK` opens a page, one with
`ACTION` inserts or sends text on the person's side, and one with `COMMAND` runs a slash command of
the bot:

```json
[{"TEXT": "Talk to a manager", "COMMAND": "manager", "COMMAND_PARAMS": "sales", "BLOCK": "Y"},
 {"TYPE": "NEWLINE"},
 {"TEXT": "Price list", "LINK": "https://example.com/prices"}]
```

The command has to exist: **Command → Register** it first (`manager`, with a title for the command
list). Typing `/manager` and pressing the button both arrive as a **Command Called** event; the
event's `command.context` says which, `textarea` or `keyboard`. **Command → Answer** replies in the
chat the command came from. According to the documentation that works even in a chat the bot is not
in, as a system line; on the test portal only answers in the bot's own chats were tried.

The node adds the bot's ID to every keyboard it sends, because Bitrix24 warns that an updated
keyboard without one may send the press to the wrong bot.

**Chat → Set Input Field** turns typing off in a chat, so people can only press buttons.
**Show Activity Indicator** shows "typing…" or an agent status such as "Agent is searching for
information…" for up to 600 seconds while a workflow prepares the answer.

### Events and files

**Event → Get Many** reads the bot's queue by hand; the trigger does the same on a schedule. Passing
an offset deletes the events before it for every reader of that bot. **Include Webhook User Events**
adds the webhook user's own messenger events (`ONIMV2…`) to the same read; that needs the `im`
permission and **Bitrix24 Messenger → Event Queue → Subscribe** first.

**File → Download** puts a chat file into binary data. The one-time link Bitrix24 hands out for it
contains the webhook code, as it does in the messenger node, so it is fetched inside the operation
and never shown.

**Bot → Update** changes the name, profile, flags and background, and can switch **Event Delivery**
to a webhook URL of your own. Bitrix24 then posts each event there with an OAuth token of the bot
inside, and does not retry a failed delivery. The trigger needs the default, **Keep for Polling**.

## Bitrix24 Trigger

Starts a workflow when Bitrix24 posts an outgoing webhook.

1. In n8n, copy the trigger's **Production URL**.
2. In Bitrix24, **Developer resources → Other → Outgoing webhook**: paste the URL, tick the
   events, save.
3. Copy the **Application token** Bitrix24 shows into the trigger.

It has to be done by hand. The method that would subscribe the URL automatically, `event.bind`,
answers `WRONG_AUTH_TYPE` to inbound webhooks: only an installed application may call it.

Requests without the right application token get `403` and never start the workflow, and the
token is removed from the output. The **Events** list has 181 event codes from the
documentation; codes it lacks go into **Other Event Codes**. Events not selected are answered
`OK` and dropped.

Bitrix24 sends only IDs, for example `data.FIELDS.ID` on `ONCRMDEALUPDATE`. **Fetch the Changed
CRM Record** reads the whole lead, deal, contact, company, quote or smart process item after an
add or update event and puts it under `record`. If that read fails, the workflow still starts,
with the reason in `recordError`.

## Bitrix24 Messenger Trigger

Starts a workflow on new, edited or deleted messages, reactions and new members in the chats of the
webhook user. It polls Bitrix24's event queue on n8n's schedule, so it works on an n8n without a
public address and needs no setup in Bitrix24.

- On activation it subscribes the webhook user and skips whatever is already queued, so turning the
  workflow on does not replay the last day.
- **Dialog IDs** narrows it to some conversations: `chat123` for a group chat, a user ID for a
  private one.
- The webhook user's own messages and reactions are dropped unless **Include Own Events** is on, so a
  workflow that answers in the same chat does not start itself.
- A manual test run reads what is queued without confirming it; the active workflow still gets it.

Bitrix24 keeps one queue per user. A second workflow, or another application reading the same user,
takes events away from this one: use a separate webhook user per listener. Deactivating the workflow
does not unsubscribe; **Messenger → Event Queue → Unsubscribe** does.

On the test portal an edit made through the REST API did not reach the queue, while new messages,
reactions and deletions did. Edits made in the Bitrix24 apps were not tried.

## Bitrix24 Chatbot Trigger

Starts a workflow on messages to a bot, slash commands and button presses, reactions to the bot's
messages, the bot being added to a chat, and a chat opened through a link with `BOT_CONTEXT` data.
It polls the bot's event queue on n8n's schedule, so it works on an n8n without a public address.

- **Events** defaults to New Message and Command Called.
- On activation it checks that the bot keeps its events for polling, and fails with the reason if the
  bot posts them to a URL instead. Then it skips whatever is already queued, so turning the workflow
  on does not answer a backlog.
- Messages, commands and reactions of bots, the bot itself included, are dropped unless **Include
  Events From Bots** is on. Two bots in one chat cannot talk to each other forever that way.
- **Dialog IDs** narrows it to some conversations.
- A manual test run reads what is queued without confirming it.

Each event is one item: `eventId`, `type`, `date`, and the event's own data — `message`, `chat`,
`user`, and `command` or `reaction` where they apply. Bitrix24 keeps one queue per bot: a second
workflow reading the same bot takes events away from this one.

## Rate limits

Bitrix24 has two limits, and they punish different things.

**Requests per second.** 2 per second on most plans and 5 on Enterprise, as a leaky bucket
with a burst of 50 (250 on Enterprise), counted per portal **and per source IP**. Every
workflow on one n8n instance shares it, so the nodes queue requests per portal. Over the limit,
Bitrix24 answers `QUERY_LIMIT_EXCEEDED` before running anything, and the node retries that
with backoff.

**Execution time.** Each method has a budget of server time per ten minutes, per webhook. The
exact figure is set by Bitrix24 per portal; the documentation's own example uses 480 seconds. Past that, the method answers `OPERATION_TIME_LIMIT` for up to ten minutes for
everyone using that webhook. The node does not wait that out; it fails with the reason. Heavy
filters, `select: ["*"]` on large lists and offset paging burn this budget. A separate webhook
per integration keeps one runaway workflow from blocking the others.

## Quirks worth knowing

- `methods` lists 1171 names on the test portal and misses every controller method:
  `crm.item.*`, `tasks.task.*`, `catalog.*` are absent from it and work fine.
- `method.get` compares in lower case and says `booking.v1.resourceType.list` does not exist,
  though calling it works. **Check Method** lower-cases the name before asking.
- REST 3.0 method URLs have no `.json` suffix. With it, the answer is 404.
- The default deal pipeline has ID `0`, so pipeline operations accept 0 where other IDs must be
  positive.
- Custom boolean fields are filtered with `1` and `0`, though they are read and written as `Y`
  and `N`.
- Timeline comments want the entity type as a word (`deal`, `dynamic_1042`), product rows as a
  short code (`D`, `T412` for smart process 1042), and most other methods as a number. The
  nodes take the number everywhere and convert.
- Errors with an empty `error` code are normal: method-level failures often carry only
  `error_description`. The node shows both when there are both.
- A timeline log entry written through a webhook cannot be deleted through one:
  `REMOVING_DISABLED`, only the application that wrote it may. Write log entries you will want
  to remove as comments instead.
- Requisites attach to a deal only once the deal has its client set: otherwise
  `Requisite with ID … can not be tied to the Deal in which the client is not selected`.
- A pipeline can be deleted while its deleted deals still sit in the recycle bin.
- A recurring deal template is created active even with `ACTIVE: N`. Its setting cannot be
  deleted once a deal was made from it, even a deleted deal: `Connected recurring deal exists`.
  Deleting the template deal removes the setting with it.
- `crm.item.delivery.list` returned nothing for a shipment added through `sale.shipment.add`,
  while Get by ID read it.
- A payment updates only `paySystemId` and `paid`; anything else answers `Empty fields`.
- A digital workplace created with `typeIds` came back with none attached.
- A pipeline without its own card layout returns `null`: the built-in layout is not readable.
- Call lists cannot be deleted through the API.
- Creating or changing a lead starts the portal's lead business processes, like a person would.

Tasks and workgroups:

- **Request to Join from someone already in the group takes them out of it**, and the answer
  is `true`. Tried on the owner: after the request the group had no members at all. The node
  refuses the request for a member.
- The node also refuses to **Remove** an owner: move ownership with **Set Owner** first. What
  Bitrix24 itself does with that request was not tried on a group that still had its owner.
- Add, Invite and Set Role on the owner answer an empty list and change nothing.
- Approve and Return for Rework need two people. On a task whose creator is also its responsible
  user, control is skipped: Complete goes straight to completed, and both answer
  `Action unavailable`.
- On a task with time tracking, Start and Pause write time entries by themselves (1 second on
  the test run).
- Time Entry → Get Many across all tasks includes entries of deleted tasks; Get on those answers
  `Task not found or not accessible`.
- A dependency lives on the dependent task: after Dependency → Create from A to B, Get Many of B
  lists A and Get Many of A is empty.
- A kanban stage that still holds tasks is not deleted: `NO_EMPTY`. The first stage of a group
  kanban is a system one and is never deleted: `IS_SYSTEM`.
- A file attached to a task in a group is copied to the group's Drive, and a group with files on
  its Drive cannot be deleted: `DISK_NOT_EMPTY`.
- Flow → Update resets settings the request leaves out: the flow's template went back to 0.
  Toggle Pin answers the new state, `pinned: true` or `false`.
- A sprint needs start, end and status (`Incorrect dateStart format`, `Incorrect sprint status`
  otherwise), and a real scrum. On the test portal every group created through the API came out
  as a collab with the scrum master dropped, so sprints could not be created there (`Unable to
  add sprint`). Epics and backlogs work on such a group anyway.
- The ID of a message in the task chat is not in the task history; a result from a chat message
  needs the ID from Bitrix24 Messenger → Message → Get Many or from `MESSAGE_ID` of the Task
  Comment Added trigger event.
- `tasks.task.add` once answered with an internal PHP error
  (`Workgroup::getUserMemberIds(): Return value must be of type array`) for a group whose owner
  had been taken out by Request to Join, and saved the task all the same.

Messenger and open lines:

- The download link Bitrix24 gives a webhook (`im.v2.File.download`) contains the webhook code in
  its path. Anything that prints it hands the secret over, which is why the node has no Get Download
  Link.
- Tags on notifications (`TAG`, `SUB_TAG` with `CLIENT_ID`) are ignored through a webhook: a second
  notification with the same tag did not replace the first, the tag was not stored, and Delete by
  tag answered `true` and removed nothing.
- Get IDs of chat members (`im.chat.user.list`) answers `ACCESS_ERROR` on the company-wide general
  chat even for its members; Get Many (`im.dialog.users.list`) works there.
- A chat cannot be deleted through the API, only left. A system message in it cannot be deleted
  either: `CANT_EDIT_MESSAGE`.
- An edit through `im.message.update` did not produce `ONIMV2MESSAGEUPDATE` in the event queue
  within 12 seconds; the send, the reaction and the deletion around it did.
- Reading messages, notifications and recent chats did not change unread counters.
- `imconnector.*` does not work with webhooks at all (stated in the documentation), so custom
  open channel connectors need an application.

Chatbots:

- A bot's chat background cannot be reset to each person's own once it is set. The documentation
  says `null` resets it and an unknown value becomes `null`; on the test portal `null`, an empty
  string and an unknown value all left it as it was. The node offers no reset.
- `imbot.v2.Command.list` returns the messenger's six built-in commands (`/me` and others, bot ID
  `0`, IDs like `def0`) together with the bot's own. **Command → Get Many** leaves them out unless
  **Include Built-In Commands** is on.
- A system line the bot sent (`authorId` 0) cannot be deleted by the bot, and not by the chat owner
  either: `CANT_EDIT_MESSAGE`.
- The same reaction twice is `REACTION_ALREADY_SET`, not a quiet success.
- The bot's own edits reach its own queue as Message Edited events, unlike REST edits in the
  messenger queue. The trigger drops them with the other bot events.
- In a response with no forwarded messages, `uuidMap` is an empty array; the node turns it into an
  empty object, the shape it has with forwards.

## What was checked

On a live production portal, 14.09.2026, through a harness that runs the compiled nodes with a
fake n8n context. Reads went through as they are. Writes went through a guard that let a write
through only for records the same run had created and marked `[n8n-test]`, deals only inside a
pipeline the run created, portal settings only in forms that change nothing (base currency set
to the one already set, card layouts of the test pipeline). Everything was deleted at the end,
and a final search found nothing marked left outside the recycle bin, except one call list:
Bitrix24 has no method to delete those.

| | Operations |
|---|---|
| Write, checked | 137 |
| Read, checked | 123 |
| Works, with a Bitrix24 limitation | 17 |
| Not checked | 0 |

The live runs found four bugs in the node, fixed before this version: `crm.currency.update`
takes `ID` where every other currency method takes `id`; `userfieldconfig.add` and
`update` take `field`, not `fields`; adding a product to a payment needs `quantity`; and
a payment accepts only `paySystemId` and `paid` on update.

On 15.09.2026, after Bitrix24 rebuilt its page on CRM fields, three more runs on imported test
leads, contacts and companies checked what the page says about writing fields, and found three
bugs, fixed in 0.4.1. The mapper offered `contacts` and `companies`, which fail on write. Import
failed whenever phones or emails were given. And the node's own hint said an existing phone could
be changed through its ID in `fm`, which Bitrix24 ignores: the phone was added a second time.

The tasks node was checked the same way on the same portal, on the owner's go-ahead: tasks, a
custom field, hidden workgroups, flows, templates, My Plan stages and scratch files on the
webhook user's Drive, all marked, all deleted at the end. Every person on every test object was
the webhook user, so nobody else was notified, and nothing was linked to CRM records. A final
search found nothing marked outside the task recycle bin.

| Bitrix24 Tasks | Operations |
|---|---|
| Write, checked | 64 |
| Read, checked | 36 |
| Works, with a Bitrix24 limitation | 16 |
| Not checked: no scrum to run on | 13 |

Those runs changed the node before this version: Request to Join refuses a member (Bitrix24
takes the member out instead), Remove refuses a group owner, Sprint → Create requires start, end
and status, Dependency → Get Many says which task holds the link, and Toggle Pin answers the
state instead of a success flag.

The messenger node read real chats and notifications of the webhook user, printing only counts and
field names, and wrote into a closed chat marked `[n8n-test]` with the webhook user as its only
member: messages, edits, likes, files, marks, pins, the event queue. Notifications went to the
webhook user, the status was changed and put back. The harness checked every output for the webhook
code. At the end messages, files, notifications and the Drive copy were deleted and the chat was
left; Bitrix24 has no way to delete a chat.

| Bitrix24 Messenger | Operations |
|---|---|
| Write, checked | 29 |
| Read, checked | 23 |
| Works, with a Bitrix24 limitation | 5 |
| Not run: would touch every real chat, create a feed post, or needs another person | 6 |

The open lines node read line settings, CRM chats and statistics, and created, changed and deleted
an inactive test line. Dialogs, operator actions, CRM chat writes and bot dialogs work on
conversations with real clients, and the portal has no test client, so they were not run.

| Bitrix24 Open Lines | Operations |
|---|---|
| Write, checked | 3 |
| Read, checked | 11 |
| Not run: they reach real clients | 29 |

Those runs changed the messenger node before this version: Get Download Link was removed because
the link carries the webhook code, and notification tags were removed because a webhook cannot use
them. The Message Edited option of the trigger now says that REST edits did not arrive.

The Messenger Trigger was run on the same chat: the first poll skips what is queued, a manual run
confirms nothing, the dialog filter and the own-message filter work.

The chatbot node was checked on 15.09.2026 with two hidden test bots marked `[n8n-test]`, a plain
one and a supervisor, registered with a token made for the run. The bot created a group chat with
the webhook user as the only person in it, and the webhook user produced the events: private
messages, a message with and without a mention, a typed command, a button press, a like, an edit, a
chat opened with context. The guard let no webhook URL be set and no token rotated. At the end the
messages, the command and both bots were deleted and the chat was left; one system line of the bot
stays in it, since Bitrix24 lets nobody delete it. Every output was checked for the webhook code and
for the bot token.

| Bitrix24 Chatbot | Operations |
|---|---|
| Write, checked | 21 |
| Read, checked | 7 |
| Works, with a Bitrix24 limitation | 6 |

The same run pressed a bot button through **Bitrix24 Messenger → Message → Run Bot Command**, which
had waited for a bot since 0.3.0. The Chatbot Trigger was run on the plain bot: the delivery mode
check, skipping the queue on activation, a manual run, the dialog filter, dropping bot messages and
not delivering an event twice. Its refusal of a bot in webhook mode was checked on a faked answer.

Those runs changed the chatbot node before this version: the background reset option was removed,
Command → Get Many filters out built-in commands, and Send without forwards returns an empty object.

The trigger was fed hand-made deliveries (10 checks, including a wrong token and `__proto__`
keys) and fetched a real deal. A delivery from Bitrix24 itself needs an n8n with a public
address. Offline, every operation runs with sample parameters, and every method the nodes call
exists in the documentation.

## What is not here yet

- Nodes for drive, calendar, telephony, business processes and lists, the store and catalog,
  sites, booking, mail and BI. Until then, the Bitrix24 node calls their methods directly.
- A chatbot trigger for bots that post their events to a webhook URL. The polling trigger covers
  every event; a webhook one would save the polling delay on an n8n with a public address.
- In the CRM node: changing or deleting one phone, email or messenger of a record. `crm.item.update`
  cannot do it; until an operation over the older per-entity methods exists, **Method → Call** does
  (see [Fields come from the portal](#fields-come-from-the-portal)).
- In the tasks node: legacy task comments (`task.commentitem.*`, gone from the new task card) and a
  trigger read of the changed task like the one the trigger does for CRM records.
- An OAuth2 credential for a local application, and with it everything Bitrix24 reserves for
  applications: `event.bind`, custom automation robots, placements, open-channel connectors.
- Timeline layout blocks, icons and logos, configurable activities and activity badges, which
  only make sense inside an application.

## Feedback and bugs

[GitHub issues](https://github.com/zenland-dev/n8n-nodes-bitrix24/issues). Issues are public:
remove the webhook token and client data from anything you paste.

## License

[MIT](LICENSE.md). Bitrix24 is a trademark of its owner; see the trademark note in the licence.
