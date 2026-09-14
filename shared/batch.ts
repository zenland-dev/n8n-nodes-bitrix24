import type { IDataObject } from 'n8n-workflow';

import type { Bitrix24Context } from './transport';
import { bitrix24Request } from './transport';

/** Bitrix24 refuses more than 50 commands in one batch. */
export const BATCH_LIMIT = 50;

/**
 * Encodes parameters the way PHP's `http_build_query` does, which is what
 * Bitrix24 parses each batch command with: `filter[>id]=5&select[0]=id`.
 * Booleans become 1 and 0, null an empty value.
 */
export function encodeQuery(params: IDataObject): string {
	const parts: string[] = [];

	const walk = (prefix: string, value: unknown): void => {
		if (value === undefined) return;
		if (value === null) {
			parts.push(`${encodeURIComponent(prefix)}=`);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((entry, index) => walk(`${prefix}[${index}]`, entry));
			return;
		}
		if (typeof value === 'object') {
			for (const [key, entry] of Object.entries(value as IDataObject)) walk(`${prefix}[${key}]`, entry);
			return;
		}
		const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
		parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(text)}`);
	};

	for (const [key, value] of Object.entries(params)) walk(key, value);
	return parts.join('&');
}

export interface BatchCommand {
	method: string;
	params?: IDataObject;
}

export interface BatchOutcome {
	key: string;
	method: string;
	result?: unknown;
	error?: unknown;
	total?: unknown;
	next?: unknown;
	time?: unknown;
}

/**
 * Runs named commands through `batch`, fifty per request, and returns one outcome
 * per command in the order given.
 *
 * A command may refer to an earlier one's result with `$result[key][path]`, but only
 * inside the same request — keep dependent commands within one chunk of fifty.
 * With `halt` a failed command stops the rest of its chunk; later chunks still run.
 */
export async function runBatch(
	this: Bitrix24Context,
	commands: Array<[string, BatchCommand]>,
	options: { halt?: boolean; itemIndex?: number } = {},
): Promise<BatchOutcome[]> {
	const outcomes: BatchOutcome[] = [];

	for (let offset = 0; offset < commands.length; offset += BATCH_LIMIT) {
		const chunk = commands.slice(offset, offset + BATCH_LIMIT);
		const cmd: IDataObject = {};
		for (const [key, command] of chunk) {
			const query = encodeQuery(command.params ?? {});
			cmd[key] = query === '' ? command.method : `${command.method}?${query}`;
		}

		const body = await bitrix24Request.call(
			this,
			'batch',
			{ halt: options.halt === true ? 1 : 0, cmd },
			{ itemIndex: options.itemIndex },
		);

		const result = (body.result ?? {}) as IDataObject;
		const pick = (field: string, key: string): unknown => {
			const bucket = result[field];
			return bucket !== null && typeof bucket === 'object' ? (bucket as IDataObject)[key] : undefined;
		};

		for (const [key, command] of chunk) {
			const outcome: BatchOutcome = { key, method: command.method };
			const error = pick('result_error', key);
			if (error !== undefined) outcome.error = error;
			const value = pick('result', key);
			if (value !== undefined) outcome.result = value;
			for (const field of ['total', 'next', 'time'] as const) {
				const extra = pick(`result_${field}`, key);
				if (extra !== undefined) outcome[field] = extra;
			}
			outcomes.push(outcome);
		}
	}

	return outcomes;
}
