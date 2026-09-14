import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';

/**
 * Reads a JSON parameter that may arrive as text (typed into the editor) or as an
 * object (produced by an expression). Empty text is `fallback`.
 */
export function jsonParameter<T = IDataObject>(
	ctx: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback: T,
): T {
	const raw = ctx.getNodeParameter(name, itemIndex, fallback) as unknown;

	if (raw === undefined || raw === null) return fallback;
	if (typeof raw !== 'string') return raw as T;
	if (raw.trim() === '') return fallback;

	try {
		return jsonParse<T>(raw);
	} catch {
		throw new NodeOperationError(ctx.getNode(), `"${name}" is not valid JSON`, {
			itemIndex,
			description: 'Check the brackets and quotes, or build the value with an expression instead.',
		});
	}
}

/** The same for a JSON value nested inside a collection parameter. */
export function jsonValue<T = IDataObject>(
	ctx: IExecuteFunctions,
	raw: unknown,
	label: string,
	itemIndex: number,
	fallback: T,
): T {
	if (raw === undefined || raw === null) return fallback;
	if (typeof raw !== 'string') return raw as T;
	if (raw.trim() === '') return fallback;

	try {
		return jsonParse<T>(raw);
	} catch {
		throw new NodeOperationError(ctx.getNode(), `"${label}" is not valid JSON`, { itemIndex });
	}
}

/** Drops keys whose value is undefined, null or an empty string. */
export function compact(object: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(object)) {
		if (value === undefined || value === null || value === '') continue;
		out[key] = value;
	}
	return out;
}

/** Splits "a, b,c" or an array into trimmed non-empty strings. */
export function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v !== '');
	if (value === undefined || value === null) return [];
	return String(value)
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v !== '');
}

/** An integer ID parameter, refused when it is not a positive number. */
export function idParameter(ctx: IExecuteFunctions, name: string, itemIndex: number): number {
	const raw = ctx.getNodeParameter(name, itemIndex) as unknown;
	const id = Number(typeof raw === 'object' && raw !== null ? (raw as IDataObject).value : raw);

	if (!Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(ctx.getNode(), `"${name}" must be a positive whole number`, {
			itemIndex,
		});
	}
	return id;
}

// ── Reusable parameter descriptions ────────────────────────────────────────

export function returnAllProperties(what: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			displayOptions: { show: { returnAll: [false] } },
			description: `Max number of ${what} to return`,
		},
	];
}

export function filterJsonProperty(example: string, extra = ''): INodeProperties {
	return {
		displayName: 'Filter (JSON)',
		name: 'filterJson',
		type: 'json',
		default: '{}',
		description: `Bitrix24 filter object. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, !, @ (in list), !@ (not in list) or % (contains), e.g. ${example}.${extra}`,
	};
}

export function orderJsonProperty(example: string): INodeProperties {
	return {
		displayName: 'Order (JSON)',
		name: 'orderJson',
		type: 'json',
		default: '{}',
		description: `Sort object of field names and ASC or DESC, e.g. ${example}. Leave empty for the fastest paging by ID.`,
	};
}

export function selectProperty(example: string): INodeProperties {
	return {
		displayName: 'Fields to Return',
		name: 'select',
		type: 'string',
		default: '',
		placeholder: example,
		description:
			'Comma-separated field names to return. Leave empty for the default set; use * for every field.',
	};
}
