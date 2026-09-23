# Changelog

## 0.10.0 — 22.09.2026

- **New node: Bitrix24 Event Log.** 5 operations in 2 resources, one for each documented
  `main.eventlog.*` method: entries for a period or an event type, one entry by ID, the entries that
  appeared after a cursor, and the field descriptions. The methods belong to REST 3.0; the node
  addresses and unwraps them. The webhook needs the `main` permission and an administrator behind it.
- **New node: Bitrix24 Consents.** 3 operations: the agreements of the portal, the text of one with
  the company details filled in, and the record of a consent given to it. Agreements are written in
  the Bitrix24 interface — the API has no method that creates one, and none that deletes a consent.
- **New node: Bitrix24 AI.** 3 operations: register an AI service of your own, list what is
  registered, remove one by its code. The node connects the service; Bitrix24 calls it when a person
  uses AI in a CRM card, a chat or an automation rule.
- **Only five fields of a log entry can be filtered or sorted** — `id`, `timestampX`, `auditTypeId`,
  `userId`, `guestId`. A condition on any of the other eight fails the whole call instead of being
  ignored, and the node now shows which field REST 3.0 refused and why: the field-by-field reasons
  used to be dropped, leaving only "Error validating request object."
- **The event log refuses a date with milliseconds**, which is exactly the form a JavaScript date
  produces. The node cuts them off before the call.
- `entity.*` (application data storage, 17 methods) and `messageservice.*` (SMS and message
  providers, 5) got no node: every method of both answers `ACCESS_DENIED Application context
  required` to a webhook. They wait for the OAuth2 credential of a local application.
- **CRM → Delivery names the right record types.** It said deliveries belong to deals, invoices and
  smart process items; the Bitrix24 documentation now says only deals and invoices have them, and
  Get Many answers an empty list for any other type. Get Many also says why a delivery can be
  missing from it: system shipments and shipments without a delivery service are left out, while
  Get by ID reads them.
- **Tasks → Scrum Task → Update: Backlog or Sprint ID is required for a task not yet in the scrum.**
  The hint used to say such a task lands in the backlog by itself; the documentation of
  `tasks.api.scrum.task.update` no longer says so and lists `Entity id not found` for this case.
- The group picker of Bitrix24 Tasks marks an archived group whether `CLOSED` comes as `Y` or as
  `true`. The documentation of `socialnetwork.api.workgroup.list` now types it as boolean, while a
  live portal still answers `Y` and `N`. Filters keep sending `Y` and `N`: with `true` and `false`
  the same portal selected other groups.
- Checked on a live portal: all 8 reading operations of the three nodes. Not run: Consent → Create,
  which writes a record no method removes, and the two AI writes, which need an endpoint of your own
  and would show the service to everyone on the portal.

## 0.9.0 — 19.09.2026

- **New node: Bitrix24 Catalog.** 148 operations across 26 resources, one for each of the 145
  working `catalog.*` methods and three more: products, variations, products with variations and
  services; their images and files; prices and price types with their names, access and rounding;
  markups; sections; properties with list values, features and smart filter settings; units of
  measure, VAT rates and unit ratios; stores and stock; inventory documents with their items,
  suppliers and custom fields; the catalogs themselves. **Catalog** can be left empty everywhere —
  the node takes the catalog the CRM uses, or the variations catalog tied to it.
- Property values go in by property ID or code. The node wraps each one as `{"value": …}`:
  `catalog.product.update` ignores a bare text value and clears a bare number while answering success.
- **Set Product Prices** sets prices by price type and keeps their IDs; **Replace Product Prices**
  replaces the whole set through `catalog.price.modify`, which refuses any price that names its ID
  ("Catalog price group is wrong") in spite of the documentation.
- **Download File** fetches a picture or a file property through `catalog.product.download`, with
  the field named `detailPicture` or `property258`; the documented `DETAIL_PICTURE` and
  `PROPERTY_258` are refused. **Product Image → Download** fetches the public `detailUrl`: the
  `downloadUrl` Bitrix24 gives carries the webhook secret and answers `ERROR_METHOD_NOT_FOUND`, so it
  never reaches the output.
- **Bitrix24 Trigger** lists the 15 catalog events, `CATALOG.PRODUCT.ON.ADD` and the like, which the
  event list extracted from the documentation had missed for their dotted spelling.
- Checked on a live portal: 140 operations. Not run through: conducting and cancelling inventory
  documents, which move stock. Not run: supplier links, which need a CRM record of the Supplier
  category, custom field values of documents and reading one markup.

## 0.8.3 — 19.09.2026

- **Bitrix24 Trigger warns that chat events do not come through it.** The Bitrix24 documentation
  now says outright that `ONIMV2JOINCHAT`, `ONIMV2MESSAGEADD`, `ONIMV2MESSAGEDELETE`,
  `ONIMV2MESSAGEUPDATE` and `ONIMV2REACTIONCHANGE` never call a handler: they wait in the event
  queue of the user who subscribed and are read with `im.v2.Event.get`. A workflow with one of them
  selected in Bitrix24 Trigger never starts. The five stay in the list, so a workflow that has them
  keeps a valid value, and each now says to use Bitrix24 Messenger Trigger, which reads that queue.

## 0.8.2 — 18.09.2026

The first published version of the two new nodes: 0.8.0 and 0.8.1 below were written and tested but
never released, and everything in them is part of this one.

- **Field → Create of the lists node takes a Field Code**, and requires it: `lists.field.add`
  refuses a field without one — `ERROR_SAVE_FIELD`, "Please fill the code fields" — although the
  documentation marks `CODE` optional.
- **Template → Get Many and Workflow → Get Instances ask for fields by default.** Given no field
  list, Bitrix24 answers templates as rows of `ID` alone and running processes as `ID`, `MODIFIED`
  and `OWNED_UNTIL`. Left empty, **Fields to Return** now sends the usual fields instead.
- **Only a business process that is still waiting can be stopped.** A process whose template runs
  straight through is over before the next request arrives, and Terminate and Delete then answer
  "The business process is not found". The README says so next to both.
- Checked on a live portal: all 19 operations of the lists node, on a list the run created and
  deleted, a file field and its link included; 7 of the 10 of the business process node, on a deal
  the run created in its own pipeline with a template made for the test — three processes started,
  one answered through Task → Complete, one terminated, one deleted, each confirmed by Get
  Instances. Delegate needs a second person and the two Event operations the event token of an
  installed application, so those three are unproven.


## 0.8.1 — 17.09.2026

- **Drive → Folder → Create takes Access Rights for a folder inside another folder.**
  `disk.folder.addSubFolder` began accepting `rights` on 17.09.2026, and the field, which until
  now only showed for a folder at the root of a drive, is offered for both. Nothing changes for a
  workflow that leaves it empty: without a filled-in row the request goes out as before.
- **An access right can now deny instead of grant.** The new Deny switch sends `NEGATIVE`, which
  takes the level away from whoever the access code names and overrides what the parent folder
  passes down. It is there for a folder, for a drive root and for an uploaded file.
- Bitrix24 checks each right now and answers an unusable one with an empty error code and the
  reason in the description alone — `Invalid format: Right 0 should contain known TASK_ID` for an
  access level the portal does not have. The node shows that text, so pick the level from the list
  rather than typing an ID from another portal.
- **Calendar → Event → Get Upcoming really reads the calendar you pick.** Bitrix24 answers
  `calendar.event.get.nearest` with the webhook user's own calendar unless `type` and `ownerId`
  arrive together *and* `forCurrentUser` is off — a missing `forCurrentUser` counts as on. The node
  used to send the type alone, so Calendar Type looked like it worked and changed nothing. It now
  sends the owner with the type and turns `forCurrentUser` off unless the option is set by hand;
  a group calendar without Owner ID is refused the way the other operations refuse it.
  **This changes what the operation returns** for a workflow that picked Company or Group and left
  For the Webhook User alone: it was answering the personal calendar and now answers the one asked
  for.

## 0.8.0 — 16.09.2026

- **Bitrix24 Business Processes**, a new node: 10 operations across 4 resources. A business process
  started from a template on one record, the running processes listed and filtered, one of them
  terminated with a line for the log or deleted with its data. The tasks a process puts in front of
  people — read, answered for the webhook user, or delegated to somebody else. The templates of the
  portal, filtered by the kind of record they run on. And the answer back to a process that waits on
  an automation rule: a result, or a line in its log.
- The record a process runs on is picked as a type and an ID, and the node writes out the three
  strings Bitrix24 wants: `['crm', 'CCrmDocumentDeal', 'DEAL_777']` for a deal,
  `['crm', 'Bitrix\Crm\Integration\BizProc\Document\Dynamic', 'DYNAMIC_147_1']` for a smart
  process item. A smart process item, a list element and a Drive file also need the ID of the
  process, the list or the storage they belong to.
- Most `bizproc.*` methods are documented as administrator-only, so a webhook made by anyone else
  gets `ACCESS_DENIED` from Bitrix24. The README says so next to the node.
- Not included: automation rules, actions and template writing. `bizproc.robot.*`,
  `bizproc.activity.*` except the log, and `bizproc.workflow.template.add/update/delete` answer
  `ACCESS_DENIED Application context required` to a webhook — they need an installed application.
- **Bitrix24 Lists**, a new node: 19 operations across 4 resources, one per documented `lists.*`
  method. Elements read with a filter by field code, created, changed and deleted; the links of
  their file fields. Lists themselves created, renamed and deleted, and the type of one found from
  its ID. Fields with their codes and types, which is what every element operation needs, and the
  types a list allows. Sections, the folders elements are grouped into.
- Both nodes were written from the REST documentation read on 16.09.2026, and 26 offline checks in
  `_probes` read the request each operation builds.
- No change to any published parameter, operation or credential of the other nodes.


## 0.7.0 — 16.09.2026

- **Bitrix24 Employees**, a new node: 32 operations across 6 resources. Employees found by any field
  of their card or by one search phrase, invited, updated and dismissed; custom fields of the card;
  the classic company structure of departments; the working day opened, paused and closed, with its
  settings and schedules; the time control module — a month of worked hours, who may read whose
  reports, and the portal settings behind it; the office address ranges.
- Employee filters are sent flat, the way `user.get` and `department.get` read them, so any field
  can be filtered with a comparison in front of its name.
- Checked on a live portal: 20 reading operations as they are, the writing ones on the webhook user
  alone — a test department with nobody in it, a custom field of the run, one field of that user's
  own card put back afterwards, and that user's own working day. Nobody else was touched; an
  invitation was not sent to anyone.
- Not included: the newer `humanresources.*` org structure, which answers `ERROR_METHOD_NOT_FOUND`
  on a portal without it, and `timeman.record.*`, which answers the same.
- No change to any published parameter, operation or credential of the other nodes.

## 0.6.0 — 16.09.2026

- **Bitrix24 Calendar**, a new node: 21 operations across 4 resources, one per documented
  `calendar.*` method. Events in the calendar of a user, a workgroup or the company — created with
  participants, reminders and a repeat rule, read one by one, over a period or as the days ahead,
  updated in whole or one occurrence of a series at a time, and deleted. Participation answered for
  the webhook user, and the availability of a list of people over a period, for finding a free
  slot. The calendars themselves: added, renamed, recoloured, exported as an iCal link, deleted.
  Booking resources and their bookings, by resource or by the IDs a CRM resource booking field
  holds. The calendar settings of the portal and of the webhook user.
- Event times are sent as plain local time next to the zone they belong to, converted from the
  workflow's time zone or from **Time Zone** in the additional fields. An all-day event sends dates
  alone.
- A weekly recurrence always names its weekdays, and with none picked it repeats on the weekday the
  event starts on. Bitrix24 left to itself stores `{MO: MO}` for an event starting on any other day,
  and such an event then disappears from every list — created, readable by ID, never returned by
  `calendar.event.get`. Found on a live portal and fixed before this version.
- **Event → Get** of an event that was deleted now says `Bitrix24 has no event <ID>`. The method
  answers an empty object rather than an error.
- Checked on a live portal, all 21 operations, in a calendar created for the webhook user and
  deleted afterwards; no event had participants, so nobody was invited. Three operations work with
  a limitation of Bitrix24: both meeting-status operations need an event that is a meeting, and
  Get Availability counts only events that take up time.
- No change to any published parameter, operation or credential of the other nodes.

## 0.5.0 — 15.09.2026

- **Bitrix24 Drive**, a new node: 36 operations across 4 resources. Files uploaded from binary data
  into a folder or a drive root, downloaded into binary data, searched by name and text, renamed,
  copied, moved, put into the trash and back, deleted for good; new versions, reading and
  restoring versions; public links; folders with the same operations and sharing with a user;
  drives by owner (the webhook user, a user, a workgroup, the company) with their root folders;
  files attached to feed posts, comments and list items. Download links never reach the output:
  for a webhook they carry the webhook code.
- **Security:** a CRM file field comes with `urlMachine`, a download link that holds the webhook
  code, and the CRM node put it into its output since 0.1.0, as did the Bitrix24 Trigger's Fetch
  the Changed CRM Record. Every node now replaces any output value that holds the webhook code or
  a bot token with `[removed: it contained the webhook secret]`. If executions with such records
  were shared or exported, replace the webhook.
- Checked on a live portal: all 36 Drive operations, including uploads, copying and moving between
  drives, sharing and access rights.
  - Examples and placeholders in the CRM, tasks, messenger and chatbot nodes use invented names and
  IDs. The issue forms list every node.
  - No change to any published parameter, operation or credential.

## 0.4.1 — 15.09.2026

Fixes that came out of Bitrix24's rebuilt documentation of CRM fields, each checked on a live portal.

- **Import** of a lead, contact or company failed with error 100, `The value of an argument 'value'
  must be of type Bitrix\Crm\Multifield\Collection`, whenever Phones, Emails and Messengers was
  filled in: `crm.item.import` does not take `fm`. The node now sends contact details as the
  `PHONE`, `EMAIL`, `WEB` and `IM` lists that method takes, `fm` from Fields (JSON) included.
- The field mapper of Create, Update and Import no longer offers `contacts` and `companies`.
  `crm.item.fields` lists them as writable, under the same titles as `contactIds` and
  `companyIds`, and writing them fails with error 100.
- Phones, Emails and Messengers said an existing value could be changed or removed by its ID in
  `fm`. `crm.item.update` ignores that ID and adds the value again. The description and the README
  now point to `crm.contact.update`, `crm.lead.update` or `crm.company.update` through the Bitrix24
  node, which change and delete a value by its ID.
- Get Many of leads, contacts and companies: Fields to Return says `fm` comes back only when it is
  empty or `*`.
- Bitrix24 Trigger: the three task comment events carry the documentation's warning for the new
  task card: no update or delete events, and the message ID in `MESSAGE_ID`.
- No change to any published parameter, operation or credential.

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
- Checked on a live portal: all 34 chatbot operations and the trigger. The messenger's Message →
  Run Bot Command, left unchecked in 0.3.0, was checked too.
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
  and the trigger.
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
  scrum task operations were not checked.
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

All 277 operations were run on a live portal before release. See
"What was checked" in the README.
