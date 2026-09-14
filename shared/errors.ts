import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/**
 * What a catch block rethrows. Errors from the transport and from parameter reading
 * are already n8n errors carrying a message the user can act on, and pass through
 * untouched; anything else is wrapped so n8n can show it against the node.
 */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error instanceof Error ? error : String(error), { itemIndex });
}

/** A Bitrix24 failure, read from the body rather than the status. */
export interface Bitrix24Failure {
	code: string;
	description: string;
	status: number;
}

/**
 * Reads a failure out of a response body, or returns undefined for a success.
 *
 * Bitrix24 says an error happened by the *presence* of the `error` key, not by its
 * value: method-level validation errors often arrive with `error` empty and the
 * reason only in `error_description`. REST 3.0 nests both under an `error` object
 * as `code` and `message`.
 */
export function readFailure(body: unknown, status: number): Bitrix24Failure | undefined {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return status >= 400 ? { code: '', description: `HTTP ${status}`, status } : undefined;
	}

	const data = body as IDataObject;
	if (!('error' in data)) {
		return status >= 400 ? { code: '', description: `HTTP ${status}`, status } : undefined;
	}

	const error = data.error;
	if (error !== null && typeof error === 'object') {
		const nested = error as IDataObject;
		return {
			code: String(nested.code ?? ''),
			description: String(nested.message ?? nested.description ?? ''),
			status,
		};
	}

	return {
		code: String(error ?? ''),
		description: String(data.error_description ?? ''),
		status,
	};
}

/** What to tell a person, per system code. Method codes fall through to Bitrix24's text. */
const HINTS: Record<string, string> = {
	INVALID_CREDENTIALS:
		'No active inbound webhook matches the token. Check the Webhook Token in the credential and that the webhook was not deleted or regenerated in Bitrix24.',
	NO_AUTH_FOUND:
		'The request reached Bitrix24 without a webhook token. Check the Webhook Token in the credential.',
	insufficient_scope:
		'The webhook lacks the permission this method needs. Open the webhook in Bitrix24 and tick the module the method belongs to (crm, task, disk…).',
	ERROR_METHOD_NOT_FOUND:
		'Bitrix24 does not know this method — the name is misspelled, the method does not exist on this portal, or the webhook lacks the permission for its module.',
	QUERY_LIMIT_EXCEEDED:
		'Bitrix24 refused the request: too many requests per second for this portal from this address. Lower Requests per Second in the credential or spread the workflows out.',
	OPERATION_TIME_LIMIT:
		'Bitrix24 blocked this method for the webhook: its accumulated execution time over the last ten minutes passed the limit. It unblocks on its own; narrow the filters or select fewer fields to make each call cheaper.',
	OVERLOAD_LIMIT:
		'Bitrix24 has blocked the REST API on this portal by hand. Only Bitrix24 support can lift it; retrying will not help.',
	ACCESS_DENIED:
		'Access denied. Either the portal plan does not include REST, or the user the webhook acts as has no right to this data.',
	expired_token: 'The access token has expired. Reconnect the credential.',
	user_access_error:
		'The application is installed, but the portal administrator has not given this user access to it.',
	WRONG_AUTH_TYPE:
		'This method works only for an installed Bitrix24 application and refuses inbound webhooks.',
	PORTAL_DELETED: 'The portal is deleted or closed.',
	NOT_FOUND: 'Nothing with this ID exists, or the webhook user cannot see it.',
};

/** Turns a Bitrix24 failure into the error n8n shows, with advice where there is any. */
export function toNodeApiError(
	node: INode,
	method: string,
	failure: Bitrix24Failure,
	body: unknown,
	itemIndex?: number,
): NodeApiError {
	const code = failure.code;
	const text = failure.description !== '' ? failure.description : code || 'Unknown error';
	const message = code !== '' && code !== text ? `${text} [${code}]` : text;

	return new NodeApiError(node, (body ?? {}) as JsonObject, {
		message: `Bitrix24 ${method}: ${message}`,
		description: HINTS[code] ?? HINTS[code.toUpperCase()],
		httpCode: String(failure.status),
		itemIndex,
	});
}
