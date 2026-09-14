import type { INodeProperties } from 'n8n-workflow';

/**
 * The zones Bitrix24 serves cloud portals on. The list being closed is the whole
 * point: a portal address assembled from a free-form string can be pointed at any
 * server, and a webhook URL carries its secret in the path — whoever controls the
 * host reads the key straight out of the request line.
 *
 * Taken on 14.09.2026 by resolving a random subdomain in each candidate zone: a
 * Bitrix24 zone has wildcard DNS and answers such a host with 403. `.ua`, `.am`,
 * `.az`, `.ge` and `.kg` do not resolve; `.cz` and `.au` resolve to parking pages
 * and are not Bitrix24's. `.site` hosts Bitrix24 Sites, not portals.
 */
export const PORTAL_DOMAINS = [
	'bitrix24.ae',
	'bitrix24.by',
	'bitrix24.cn',
	'bitrix24.co',
	'bitrix24.com',
	'bitrix24.com.br',
	'bitrix24.com.tr',
	'bitrix24.de',
	'bitrix24.es',
	'bitrix24.eu',
	'bitrix24.fr',
	'bitrix24.id',
	'bitrix24.in',
	'bitrix24.it',
	'bitrix24.jp',
	'bitrix24.kz',
	'bitrix24.md',
	'bitrix24.mx',
	'bitrix24.pl',
	'bitrix24.ru',
	'bitrix24.uk',
	'bitrix24.uz',
	'bitrix24.vn',
] as const;

/** Everything a host label may contain. Anything else is dropped, not rejected. */
const SUBDOMAIN_ALLOWED = /[^a-z0-9-]/g;

/** `<user id>/<code>` — the part of an incoming webhook URL after `/rest/`. */
const WEBHOOK_TOKEN = /^[0-9]+\/[A-Za-z0-9]+$/;

/**
 * Builds the portal host from the two address fields, as an n8n expression.
 *
 * The domain is checked against the list here as well as in the dropdown, because
 * a credential's `options` are only a hint to the editor: stored values reach the
 * node through the expression engine and can be set by anything that can write the
 * credential. An unknown domain yields an empty host, which fails the request
 * loudly instead of sending the webhook somewhere unintended.
 */
export function portalHostExpression(subdomainRef: string, domainRef: string): string {
	const domains = JSON.stringify([...PORTAL_DOMAINS]);
	const subdomain = `String(${subdomainRef} || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "")`;
	return `(${domains}.includes(String(${domainRef} || "")) && ${subdomain} !== "" ? ${subdomain} + "." + String(${domainRef}) : "")`;
}

/**
 * The webhook token as an n8n expression, with the same normalisation as
 * `normalizeWebhookToken`. A pasted full URL is reduced to its tail; the host in
 * it is ignored, never used.
 */
export function webhookTokenExpression(tokenRef: string): string {
	const tail = `String(${tokenRef} || "").trim().replace(/^.*\\/rest\\//, "").replace(/^\\/+|\\/+$/g, "")`;
	return `(/^[0-9]+\\/[A-Za-z0-9]+$/.test(${tail}) ? ${tail} : "")`;
}

/** The portal origin in plain TypeScript, for the transport. '' when unusable. */
export function portalBaseUrl(credentials: { subdomain?: unknown; domain?: unknown }): string {
	const domain = String(credentials.domain ?? '');
	if (!(PORTAL_DOMAINS as readonly string[]).includes(domain)) return '';

	const subdomain = String(credentials.subdomain ?? '')
		.trim()
		.toLowerCase()
		.replace(SUBDOMAIN_ALLOWED, '');

	return subdomain === '' ? '' : `https://${subdomain}.${domain}`;
}

/**
 * Reduces whatever was pasted into the token field to `<user id>/<code>`.
 *
 * People paste the whole webhook URL more often than not. Only the part after
 * `/rest/` is kept, and the host in front of it is thrown away rather than
 * compared: the portal address comes from the two address fields and nowhere else.
 */
export function normalizeWebhookToken(raw: unknown): string {
	const tail = String(raw ?? '')
		.trim()
		.replace(/^.*\/rest\//, '')
		.replace(/^\/+|\/+$/g, '');

	return WEBHOOK_TOKEN.test(tail) ? tail : '';
}

/** Address fields, shared by every credential type so they cannot drift apart. */
export const portalAddressProperties: INodeProperties[] = [
	{
		displayName: 'Portal Subdomain',
		name: 'subdomain',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'mycompany',
		description:
			'The part of the portal address in front of the domain — for mycompany.bitrix24.com that is mycompany. Only letters, digits and hyphens are kept.',
	},
	{
		displayName: 'Portal Domain',
		name: 'domain',
		type: 'options',
		default: 'bitrix24.com',
		required: true,
		options: PORTAL_DOMAINS.map((domain) => ({ name: domain, value: domain })),
		description:
			'The Bitrix24 cloud zone the portal lives in. The list is closed on purpose: these nodes only ever call Bitrix24, so a credential cannot be aimed at another server. Self-hosted Bitrix24 is not supported.',
	},
];

/**
 * Pins n8n's own domain-restriction field to "none" and hides it.
 *
 * n8n injects this field into credentials that carry an `authenticate` block or
 * descend from `oAuth2Api`, defaulting to "all" — enough for anyone who can edit a
 * workflow to select the credential in an HTTP Request node and point it anywhere.
 * Declaring the property ourselves skips that injection, so the editor offers no
 * switch to flip. The webhook credential has no `authenticate` block at all, since
 * its secret lives in the URL path; the field is pinned there too, so a later
 * change to how it authenticates cannot silently open that door.
 */
export const pinnedHttpRequestDomains: INodeProperties = {
	displayName: 'Allowed HTTP Request Domains',
	name: 'allowedHttpRequestDomains',
	type: 'hidden',
	default: 'none',
};

/** Shared by every credential type: the rate budget is the portal's, not ours. */
export const requestsPerSecondProperty: INodeProperties = {
	displayName: 'Requests per Second',
	name: 'requestsPerSecond',
	type: 'number',
	typeOptions: { minValue: 1, maxValue: 10 },
	default: 2,
	description:
		'How fast these nodes may call the portal. Bitrix24 allows 2 requests per second on most plans and 5 on Enterprise, counted per portal and per IP address, so every workflow on this n8n instance shares one budget.',
};
