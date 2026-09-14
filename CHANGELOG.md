# Changelog

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
