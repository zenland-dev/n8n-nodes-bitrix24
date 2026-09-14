import type { IDataObject } from 'n8n-workflow';

/**
 * Segments a crafted key must never reach: assigning through them would touch
 * `Object.prototype` for the whole process. The body arrives from the open
 * internet before its token is checked, so every segment is checked before use.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

const INDEX_KEY = /^(?:0|[1-9]\d*)$/;

/**
 * Percent-decoding that cannot throw.
 *
 * `decodeURIComponent` raises a URIError on a malformed sequence, and a throwing
 * decoder would cost the whole delivery. Bytes are gathered by hand and handed to
 * Buffer, which substitutes what it cannot decode instead of giving up.
 */
function decodeFormComponent(input: string): string {
	const text = input.replace(/\+/g, ' ');
	if (!text.includes('%')) return text;

	const bytes: number[] = [];
	let literal = '';

	const flushLiteral = (): void => {
		if (literal === '') return;
		for (const byte of Buffer.from(literal, 'utf8')) bytes.push(byte);
		literal = '';
	};

	for (let index = 0; index < text.length; index++) {
		const pair = text.slice(index + 1, index + 3);

		if (text[index] === '%' && HEX_PAIR.test(pair)) {
			flushLiteral();
			bytes.push(parseInt(pair, 16));
			index += 2;
			continue;
		}

		literal += text[index];
	}

	flushLiteral();

	return Buffer.from(bytes).toString('utf8');
}

/** `data[FIELDS][ID]` → `['data', 'FIELDS', 'ID']`. */
function bracketPath(key: string): string[] {
	const start = key.indexOf('[');
	if (start === -1 || !key.endsWith(']')) return [key];

	const segments = [key.slice(0, start)];
	const brackets = key.slice(start);
	const pattern = /\[([^[\]]*)\]/g;

	for (let match = pattern.exec(brackets); match !== null; match = pattern.exec(brackets)) {
		segments.push(match[1]);
	}

	return segments;
}

/** Writes `value` at `segments`, creating the objects on the way. */
function setDeep(root: IDataObject, segments: string[], value: unknown): void {
	let node: IDataObject = root;

	for (let depth = 0; depth < segments.length; depth++) {
		const segment = segments[depth];
		if (UNSAFE_SEGMENTS.has(segment)) return;

		// PHP's `key[]=` means "append".
		const key = segment === '' ? String(Object.keys(node).length) : segment;

		if (depth === segments.length - 1) {
			node[key] = value as IDataObject[string];
			return;
		}

		const existing = node[key];
		if (existing === null || typeof existing !== 'object') node[key] = {};

		node = node[key] as IDataObject;
	}
}

/**
 * Turns `{ "0": …, "1": … }` into an array — but only a dense sequence from zero,
 * so an object keyed by record IDs keeps its keys.
 */
function indexedObjectsToArrays(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(indexedObjectsToArrays);
	if (value === null || typeof value !== 'object') return value;

	const entries = Object.entries(value as IDataObject);
	const indices = entries.map(([key]) => Number(key)).sort((left, right) => left - right);
	const isDenseIndex =
		entries.length > 0 &&
		entries.every(([key]) => INDEX_KEY.test(key)) &&
		indices.every((index, position) => index === position);

	if (isDenseIndex) {
		return entries
			.sort(([left], [right]) => Number(left) - Number(right))
			.map(([, entry]) => indexedObjectsToArrays(entry));
	}

	const output: IDataObject = {};
	for (const [key, entry] of entries) {
		output[key] = indexedObjectsToArrays(entry) as IDataObject[string];
	}

	return output;
}

/**
 * Decodes a Bitrix24 outgoing webhook body into nested JSON.
 *
 * **Bitrix24 does not post JSON.** It posts `application/x-www-form-urlencoded`
 * with PHP-style bracket keys — `event=ONCRMDEALUPDATE&data[FIELDS][ID]=345&
 * auth[application_token]=…` — so the nesting has to be rebuilt here. Do not
 * replace this with `JSON.parse`.
 */
export function parseFormBody(raw: string): IDataObject {
	const decoded: IDataObject = {};

	for (const pair of raw.split('&')) {
		if (pair === '') continue;

		const separator = pair.indexOf('=');
		const key = decodeFormComponent(separator === -1 ? pair : pair.slice(0, separator));
		if (key === '') continue;

		const value = separator === -1 ? '' : decodeFormComponent(pair.slice(separator + 1));
		setDeep(decoded, bracketPath(key), value);
	}

	return indexedObjectsToArrays(decoded) as IDataObject;
}

/**
 * The same rebuild, for a body n8n's HTTP layer already split into key/value pairs.
 *
 * Whether the brackets survive inside the key names depends on which form parser the
 * n8n instance runs, so both shapes are expanded the same way.
 */
export function expandFormBody(body: IDataObject): IDataObject {
	const expandEntry = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(expandEntry);
		if (value === null || typeof value !== 'object') return value;

		const nested: IDataObject = {};
		for (const [key, entry] of Object.entries(value as IDataObject)) {
			setDeep(nested, bracketPath(key), expandEntry(entry));
		}

		return nested;
	};

	return indexedObjectsToArrays(expandEntry(body)) as IDataObject;
}
