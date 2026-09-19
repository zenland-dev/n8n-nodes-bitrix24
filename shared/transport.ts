import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import { normalizeWebhookToken, portalBaseUrl } from '../credentials/portalAddress';
import { readFailure, toNodeApiError } from './errors';
import { acquireSlot } from './rateLimiter';

/** Every context these nodes make API calls from. */
export type Bitrix24Context =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions
	| IPollFunctions;

export const WEBHOOK_CREDENTIAL = 'bitrix24WebhookApi';

/** The webhook credential with a chatbot token next to it, for the chatbot nodes. */
export const CHATBOT_CREDENTIAL = 'bitrix24ChatbotWebhookApi';

export interface Bitrix24RequestOptions {
	/** Call REST 3.0 (`/rest/api/…`) instead of the classic REST. */
	v3?: boolean;
	/** Total attempts, including the first one. */
	maxAttempts?: number;
	/** Item the call is made for, so an error points at it. */
	itemIndex?: number;
	/** The credential type to take the portal and webhook from. */
	credentialType?: string;
}

/** A method name as Bitrix24 spells them. Anything else never reaches the URL. */
const METHOD_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

/**
 * Methods whose name says they only read. Server errors on these are retried;
 * on anything else they are not, because a 500 after a write may have written.
 */
const READ_METHOD =
	/(^|\.)(fields|list|get|getlist|getfields|getchildren|gettypes|getall|search|count|tail)$|^(scope|methods|method\.get|profile|server\.time|feature\.get|user\.current)$/i;

export function isReadMethod(method: string): boolean {
	return READ_METHOD.test(method);
}

interface PortalConnection {
	baseUrl: string;
	token: string;
	requestsPerSecond: number;
}

async function resolvePortal(this: Bitrix24Context, credentialType: string): Promise<PortalConnection> {
	const credentials = await this.getCredentials(credentialType);

	// Rebuilt from the credential fields rather than taken as typed: the domain
	// dropdown is only an editor hint, and stored values reach us through the
	// expression engine. An address outside Bitrix24 yields '' and stops here,
	// before the webhook secret is put into any URL.
	const baseUrl = portalBaseUrl(credentials);
	const token = normalizeWebhookToken(credentials.webhookToken);

	if (baseUrl === '' || token === '') {
		throw new NodeOperationError(this.getNode(), 'The Bitrix24 credential is incomplete', {
			description:
				baseUrl === ''
					? 'Fill in the portal subdomain and pick its domain, for example mycompany and bitrix24.com.'
					: 'Webhook Token must look like 1/abcdef0123456789 — the part of the inbound webhook URL after /rest/.',
		});
	}

	return { baseUrl, token, requestsPerSecond: Number(credentials.requestsPerSecond) || 2 };
}

/** Identifies the portal for caches, without exposing the webhook token. */
export async function portalKey(this: Bitrix24Context, credentialType = WEBHOOK_CREDENTIAL): Promise<string> {
	const credentials = await this.getCredentials(credentialType);
	return portalBaseUrl(credentials);
}

function backoffDelay(attempt: number): number {
	return Math.min(2 ** (attempt - 1) * 1000, 16_000) + randomInt(250);
}

const RETRY_ALWAYS = new Set(['QUERY_LIMIT_EXCEEDED']);
const RETRY_READS = new Set(['INTERNAL_SERVER_ERROR', 'ERROR_UNEXPECTED_ANSWER']);

/**
 * One call to a Bitrix24 REST method, rate-limited and retried where that is safe.
 *
 * Returns the whole response body — `result` together with `next`, `total` and
 * `time` — because list callers need the paging fields next to the data.
 *
 * `QUERY_LIMIT_EXCEEDED` is retried for every method: Bitrix24 rejects such a call
 * before running it. Server errors are retried for reads only. `OPERATION_TIME_LIMIT`
 * is never waited out here — the block lasts up to ten minutes, longer than any
 * execution should silently hang.
 */
export async function bitrix24Request(
	this: Bitrix24Context,
	method: string,
	params: IDataObject = {},
	options: Bitrix24RequestOptions = {},
): Promise<IDataObject> {
	if (!METHOD_NAME.test(method)) {
		throw new NodeOperationError(this.getNode(), `"${method}" is not a Bitrix24 method name`, {
			description: 'A method name is dot-separated words, for example crm.item.list.',
			itemIndex: options.itemIndex,
		});
	}

	const portal = await resolvePortal.call(this, options.credentialType ?? WEBHOOK_CREDENTIAL);
	const url = options.v3
		? `${portal.baseUrl}/rest/api/${portal.token}/${method}`
		: `${portal.baseUrl}/rest/${portal.token}/${method}.json`;

	const request: IHttpRequestOptions = {
		method: 'POST',
		url,
		body: params,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { Accept: 'application/json' },
	};

	const maxAttempts = options.maxAttempts ?? 4;
	const read = isReadMethod(method);

	for (let attempt = 1; ; attempt++) {
		// The limit is counted per portal and per source IP, so every credential of
		// one portal on this instance draws from the same window.
		await acquireSlot(portal.baseUrl, portal.requestsPerSecond, 1000);

		let response: IDataObject;
		try {
			response = (await this.helpers.httpRequest(request)) as IDataObject;
		} catch (error) {
			if (read && attempt < maxAttempts) {
				await sleep(backoffDelay(attempt));
				continue;
			}
			// The URL holds the webhook secret; never let it travel in the error.
			throw new NodeApiError(
				this.getNode(),
				{ message: 'Network error' },
				{
					message: `Bitrix24 ${method}: the portal could not be reached`,
					description: error instanceof Error ? error.message.split(portal.token).join('***') : undefined,
					itemIndex: options.itemIndex,
				},
			);
		}

		const status = Number(response.statusCode) || 0;
		const body = response.body;
		const failure = readFailure(body, status);

		if (failure === undefined) return body as IDataObject;

		const retryable =
			RETRY_ALWAYS.has(failure.code) || (read && (RETRY_READS.has(failure.code) || status >= 502));

		if (retryable && attempt < maxAttempts) {
			await sleep(backoffDelay(attempt));
			continue;
		}

		throw toNodeApiError(this.getNode(), method, failure, body, options.itemIndex);
	}
}

/** A file a REST method answered with instead of JSON. */
export interface Bitrix24FileAnswer {
	buffer: Buffer;
	headers: IDataObject;
}

/**
 * One call to a REST method that answers with the file itself, e.g. catalog.product.download
 * (seen on a live portal, 19.09.2026: the body is the image, with Content-Disposition). A JSON
 * body is an error and is raised as one. Only reads take this path, so they are retried like
 * reads.
 */
export async function bitrix24FileRequest(
	this: Bitrix24Context,
	method: string,
	params: IDataObject,
	options: Bitrix24RequestOptions = {},
): Promise<Bitrix24FileAnswer> {
	if (!METHOD_NAME.test(method)) {
		throw new NodeOperationError(this.getNode(), `"${method}" is not a Bitrix24 method name`, { itemIndex: options.itemIndex });
	}
	const portal = await resolvePortal.call(this, options.credentialType ?? WEBHOOK_CREDENTIAL);
	const request: IHttpRequestOptions = {
		method: 'POST',
		url: `${portal.baseUrl}/rest/${portal.token}/${method}.json`,
		body: params,
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { 'Content-Type': 'application/json' },
	};
	const maxAttempts = options.maxAttempts ?? 4;

	for (let attempt = 1; ; attempt++) {
		await acquireSlot(portal.baseUrl, portal.requestsPerSecond, 1000);
		let response: IDataObject;
		try {
			response = (await this.helpers.httpRequest(request)) as IDataObject;
		} catch (error) {
			if (attempt < maxAttempts) {
				await sleep(backoffDelay(attempt));
				continue;
			}
			throw new NodeApiError(
				this.getNode(),
				{ message: 'Network error' },
				{
					message: `Bitrix24 ${method}: the portal could not be reached`,
					description: error instanceof Error ? error.message.split(portal.token).join('***') : undefined,
					itemIndex: options.itemIndex,
				},
			);
		}

		const status = Number(response.statusCode) || 0;
		const headers = (response.headers ?? {}) as IDataObject;
		const buffer = Buffer.from(response.body as ArrayBuffer);
		const json = String(headers['content-type'] ?? '').includes('json');
		if (!json && status >= 200 && status < 300) return { buffer, headers };

		let body: unknown = undefined;
		if (json) {
			try {
				body = JSON.parse(buffer.toString('utf8'));
			} catch {
				body = undefined;
			}
		}
		const failure = readFailure(body, status) ?? { code: '', description: `HTTP ${status}`, status };
		if ((RETRY_ALWAYS.has(failure.code) || RETRY_READS.has(failure.code) || status >= 502) && attempt < maxAttempts) {
			await sleep(backoffDelay(attempt));
			continue;
		}
		throw toNodeApiError(this.getNode(), method, failure, body, options.itemIndex);
	}
}
