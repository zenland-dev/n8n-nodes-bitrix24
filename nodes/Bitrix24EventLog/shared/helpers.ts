import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { jsonParameter, stringList } from '../../../shared/params';

/** Every field a log entry has, as `main.eventlog.field.list` answers them. */
export const ENTRY_FIELDS =
	'id, timestampX, severity, auditTypeId, moduleId, itemId, remoteAddr, userAgent, requestUri, siteId, userId, guestId, description';

/**
 * The five fields Bitrix24 will filter and sort by. Asking for any of the other eight
 * fails the whole call with "requires attribute Filterable" (checked on a live portal,
 * 22.09.2026), so the node names them wherever a filter or a sort is typed.
 */
export const FILTERABLE_FIELDS = 'id, timestampX, auditTypeId, userId, guestId';

/** The rows of a REST 3.0 answer, or the single object it wrapped in `item`. */
export function v3Item(body: IDataObject, key: 'item' | 'items'): IDataObject | IDataObject[] {
	const result = body.result;
	if (result === null || typeof result !== 'object') return { result: result as string };
	const wrapped = (result as IDataObject)[key];
	if (wrapped !== undefined && wrapped !== null) return wrapped as IDataObject | IDataObject[];
	return result as IDataObject;
}

/**
 * A date as the event log takes it: ISO 8601 down to the second, with an offset.
 *
 * Milliseconds are refused — `2026-09-01T00:00:00.000Z`, which is what
 * `Date.toISOString()` and n8n's own date picker produce, fails validation, while
 * `2026-09-01T00:00:00Z` passes (checked on a live portal, 22.09.2026).
 */
export function eventLogDate(
	ctx: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	const text = String(value ?? '').trim();
	const date = new Date(text);
	if (text === '' || Number.isNaN(date.getTime())) {
		throw new NodeOperationError(ctx.getNode(), `${label} is not a date`, {
			itemIndex,
			description: 'Give a date and time, for example 2026-09-01T00:00:00+03:00.',
		});
	}
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const selectEntryProperty: INodeProperties = {
	displayName: 'Fields to Return',
	name: 'select',
	type: 'string',
	default: '',
	placeholder: 'timestampX, severity, auditTypeId, userId',
	description: `Comma-separated field names. Leave empty for all of them: ${ENTRY_FIELDS}.`,
};

export const entryFilterProperty: INodeProperties = {
	displayName: 'Filter',
	name: 'filter',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	options: [
		{
			displayName: 'Event Type',
			name: 'auditTypeId',
			type: 'string',
			default: '',
			placeholder: 'USER_AUTHORIZE',
			description: 'Code of the event, as the auditTypeId field of an entry spells it',
		},
		{
			displayName: 'From',
			name: 'from',
			type: 'dateTime',
			default: '',
			description: 'Entries from this moment on',
		},
		{
			displayName: 'Guest ID',
			name: 'guestId',
			type: 'number',
			default: 0,
			description: 'Only entries of this guest',
		},
		{
			displayName: 'To',
			name: 'to',
			type: 'dateTime',
			default: '',
			description: 'Entries before this moment',
		},
		{
			displayName: 'User ID',
			name: 'userId',
			type: 'number',
			default: 0,
			description: 'Only entries of this user',
		},
	],
};

export const filterJsonProperty: INodeProperties = {
	displayName: 'Extra Conditions (JSON)',
	name: 'filterJson',
	type: 'json',
	default: '[]',
	description: `Conditions added to the ones above, as an array of ["field", "operator", value] or ["field", value] triples, e.g. [["timestampX", "&gt;=", "2026-09-01T00:00:00+03:00"]]. Only ${FILTERABLE_FIELDS} can be filtered.`,
};

/** The Filter collection and the typed conditions as one REST 3.0 filter array. */
export function entryFilter(ctx: IExecuteFunctions, itemIndex: number): unknown[] {
	const collection = ctx.getNodeParameter('filter', itemIndex, {}) as IDataObject;
	const conditions: unknown[] = [];

	const from = String(collection.from ?? '').trim();
	if (from !== '') conditions.push(['timestampX', '>=', eventLogDate(ctx, from, 'From', itemIndex)]);

	const to = String(collection.to ?? '').trim();
	if (to !== '') conditions.push(['timestampX', '<', eventLogDate(ctx, to, 'To', itemIndex)]);

	const auditTypeId = String(collection.auditTypeId ?? '').trim();
	if (auditTypeId !== '') conditions.push(['auditTypeId', auditTypeId]);

	for (const [name, label] of [
		['userId', 'User ID'],
		['guestId', 'Guest ID'],
	] as const) {
		const value = Number(collection[name] ?? 0);
		if (value === 0) continue;
		if (!Number.isInteger(value) || value < 0) {
			throw new NodeOperationError(ctx.getNode(), `${label} must be a whole number`, { itemIndex });
		}
		conditions.push([name, value]);
	}

	const extra = jsonParameter<unknown[]>(ctx, 'filterJson', itemIndex, []);
	if (!Array.isArray(extra)) {
		throw new NodeOperationError(ctx.getNode(), 'Extra Conditions (JSON) must be an array of conditions', {
			itemIndex,
			description: 'One condition is ["field", "operator", value] or ["field", value].',
		});
	}
	conditions.push(...extra);

	return conditions;
}

/** Fields the caller asked for, as the select array of a REST 3.0 call. */
export function selectFields(ctx: IExecuteFunctions, itemIndex: number): string[] | undefined {
	const select = stringList(ctx.getNodeParameter('select', itemIndex, ''));
	return select.length > 0 ? select : undefined;
}
