import type { IDataObject } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../../shared/cache';
import { listAll } from '../../../shared/list';
import type { Bitrix24Context } from '../../../shared/transport';
import { bitrix24Request, portalKey } from '../../../shared/transport';

/**
 * Portal configuration the editor reads to fill dropdowns: smart process types,
 * pipelines, stages, currencies and field schemas. It changes when an administrator
 * edits settings, not per request, so each read is shared for a couple of minutes
 * per portal — opening a node with several pickers would otherwise spend the whole
 * two-requests-a-second budget on reading the same lists again.
 */

export interface FieldMeta {
	type: string;
	title?: string;
	listLabel?: string;
	formLabel?: string;
	isRequired?: boolean;
	isReadOnly?: boolean;
	isImmutable?: boolean;
	isMultiple?: boolean;
	isDynamic?: boolean;
	statusType?: string;
	items?: Array<{ ID: string | number; VALUE: string }>;
	upperName?: string;
}

async function key(ctx: Bitrix24Context, what: string): Promise<string> {
	return `${await portalKey.call(ctx)}|crm|${what}`;
}

export async function smartProcessTypes(this: Bitrix24Context): Promise<IDataObject[]> {
	return await cached(
		await key(this, 'types'),
		async () => await listAll.call(this, 'crm.type.list', {}, { itemsKey: 'types' }),
		CONFIG_TTL_MS,
	);
}

export async function itemFields(this: Bitrix24Context, entityTypeId: number): Promise<Record<string, FieldMeta>> {
	return await cached(
		await key(this, `fields:${entityTypeId}`),
		async () => {
			const body = await bitrix24Request.call(this, 'crm.item.fields', { entityTypeId });
			return ((body.result as IDataObject)?.fields ?? {}) as Record<string, FieldMeta>;
		},
		CONFIG_TTL_MS,
	);
}

export async function categories(this: Bitrix24Context, entityTypeId: number): Promise<IDataObject[]> {
	return await cached(
		await key(this, `categories:${entityTypeId}`),
		async () => {
			const body = await bitrix24Request.call(this, 'crm.category.list', { entityTypeId });
			return ((body.result as IDataObject)?.categories ?? []) as IDataObject[];
		},
		CONFIG_TTL_MS,
	);
}

/** Every reference-book entry of the portal: stages, sources, contact types and the rest. */
export async function statuses(this: Bitrix24Context): Promise<IDataObject[]> {
	return await cached(
		await key(this, 'statuses'),
		async () => await listAll.call(this, 'crm.status.list', { order: { SORT: 'ASC' } }),
		CONFIG_TTL_MS,
	);
}

export async function currencies(this: Bitrix24Context): Promise<IDataObject[]> {
	return await cached(
		await key(this, 'currencies'),
		async () => {
			const body = await bitrix24Request.call(this, 'crm.currency.list', {});
			return (body.result ?? []) as IDataObject[];
		},
		CONFIG_TTL_MS,
	);
}

/**
 * Status entries for one reference book. Stage books are split per pipeline —
 * DEAL_STAGE for the default one, DEAL_STAGE_5 for pipeline 5 — so a base type
 * also takes in its per-pipeline siblings.
 */
export function statusesOfType(all: IDataObject[], statusType: string): IDataObject[] {
	return all.filter((s) => {
		const entity = String(s.ENTITY_ID ?? '');
		return entity === statusType || entity.startsWith(`${statusType}_`);
	});
}
