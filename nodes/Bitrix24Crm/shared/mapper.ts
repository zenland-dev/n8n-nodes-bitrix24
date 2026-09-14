import type {
	FieldType,
	IDataObject,
	IExecuteFunctions,
	INodePropertyOptions,
	ResourceMapperField,
} from 'n8n-workflow';

import { jsonValue } from '../../../shared/params';
import type { Bitrix24Context } from '../../../shared/transport';
import type { FieldMeta } from './dictionaries';
import { categories, currencies, statuses, statusesOfType } from './dictionaries';

/**
 * Bitrix24 field types rendered as something other than a text box. Anything not
 * listed — string, text, url, location, address, crm_* links, rest_* app types —
 * is a string, which Bitrix24 accepts for all of them.
 */
const FIELD_TYPES: Record<string, FieldType> = {
	integer: 'number',
	double: 'number',
	user: 'number',
	employee: 'number',
	boolean: 'boolean',
	date: 'dateTime',
	datetime: 'dateTime',
	file: 'object',
	crm_category: 'options',
	crm_currency: 'options',
	crm_status: 'options',
	enumeration: 'options',
};

/** Fields the mapper leaves out: phones and e-mails have their own collection. */
const OWN_EDITOR = new Set(['fm']);

function label(key: string, meta: FieldMeta): string {
	const title = meta.title || meta.formLabel || meta.listLabel || key;
	return key.startsWith('uf') ? `${title} (${key})` : title;
}

async function optionsFor(
	ctx: Bitrix24Context,
	entityTypeId: number,
	meta: FieldMeta,
): Promise<INodePropertyOptions[] | undefined> {
	if (meta.type === 'enumeration') {
		return (meta.items ?? []).map((item) => ({ name: String(item.VALUE), value: String(item.ID) }));
	}
	if (meta.type === 'crm_currency') {
		return (await currencies.call(ctx)).map((c) => ({
			name: `${String(c.CURRENCY)}${c.FULL_NAME ? ` — ${String(c.FULL_NAME)}` : ''}`,
			value: String(c.CURRENCY),
		}));
	}
	if (meta.type === 'crm_category') {
		return (await categories.call(ctx, entityTypeId)).map((c) => ({
			name: String(c.name),
			value: Number(c.id),
		}));
	}
	const statusType = meta.statusType;
	if (meta.type === 'crm_status' && statusType !== undefined && statusType !== '') {
		const entries = statusesOfType(await statuses.call(ctx), statusType);
		const books = new Set(entries.map((e) => String(e.ENTITY_ID)));
		// Stages of several pipelines share one field; say which pipeline each is in.
		// DEAL_STAGE is pipeline 0, DEAL_STAGE_5 is pipeline 5.
		let pipelineNames = new Map<string, string>();
		if (books.size > 1) {
			const list = await categories.call(ctx, entityTypeId).catch(() => [] as IDataObject[]);
			pipelineNames = new Map(list.map((c) => [String(c.id), String(c.name)]));
		}
		return entries.map((e) => {
			const categoryId = String(e.ENTITY_ID).slice(statusType.length + 1) || '0';
			const prefix = books.size > 1 ? `${pipelineNames.get(categoryId) ?? categoryId} / ` : '';
			return { name: `${prefix}${String(e.NAME)}`, value: String(e.STATUS_ID) };
		});
	}
	return undefined;
}

/**
 * Turns `crm.item.fields` into resource mapper fields.
 *
 * Read-only fields are hidden. For an update, fields that cannot change after
 * creation are hidden too and nothing is required, since only the fields a person
 * adds are sent.
 */
export async function toMapperFields(
	ctx: Bitrix24Context,
	entityTypeId: number,
	fields: Record<string, FieldMeta>,
	purpose: 'create' | 'update',
): Promise<ResourceMapperField[]> {
	const result: ResourceMapperField[] = [];

	for (const [key, meta] of Object.entries(fields)) {
		if (OWN_EDITOR.has(key) || meta.isReadOnly) continue;
		if (purpose === 'update' && meta.isImmutable) continue;

		let type: FieldType = FIELD_TYPES[meta.type] ?? 'string';
		if (meta.isMultiple && type !== 'object') type = 'array';

		const field: ResourceMapperField = {
			id: key,
			displayName: label(key, meta),
			required: purpose === 'create' && meta.isRequired === true,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			type,
		};

		if (type === 'options') {
			const options = await optionsFor(ctx, entityTypeId, meta).catch(() => undefined);
			if (options !== undefined && options.length > 0) field.options = options;
			else field.type = 'string';
		}

		result.push(field);
	}

	return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Reads a resource mapper value into Bitrix24 fields.
 *
 * Empty inputs are skipped rather than sent as blanks — clearing a field is done
 * through Fields (JSON). Booleans become Y and N, which is how crm.item takes them;
 * array fields accept a JSON array or a comma-separated list.
 */
export function mapperValues(ctx: IExecuteFunctions, name: string, itemIndex: number): IDataObject {
	const raw = ctx.getNodeParameter(`${name}.value`, itemIndex, {}) as IDataObject | null;
	const schema = (ctx.getNodeParameter(`${name}.schema`, itemIndex, []) ?? []) as ResourceMapperField[];
	const types = new Map(schema.map((f) => [f.id, f.type]));
	const out: IDataObject = {};

	for (const [key, value] of Object.entries(raw ?? {})) {
		if (value === undefined || value === null || value === '') continue;
		const type = types.get(key);

		if (type === 'boolean' || typeof value === 'boolean') {
			out[key] = value === true || value === 'true' || value === 'Y' ? 'Y' : 'N';
		} else if (type === 'array' && typeof value === 'string') {
			const text = value.trim();
			out[key] = text.startsWith('[')
				? jsonValue<IDataObject[]>(ctx, text, key, itemIndex, [])
				: text.split(',').map((v) => v.trim()).filter((v) => v !== '');
		} else if (type === 'object' && typeof value === 'string') {
			out[key] = jsonValue<IDataObject>(ctx, value, key, itemIndex, {});
		} else {
			out[key] = value as IDataObject[keyof IDataObject];
		}
	}

	return out;
}
