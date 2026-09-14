import type { IDataObject } from 'n8n-workflow';

import type { Bitrix24Context } from './transport';
import { bitrix24Request } from './transport';

/** Rows of an answer that may be an array or an object keyed by ID. */
export function valuesOf(result: unknown): IDataObject[] {
	if (Array.isArray(result)) return result.map((v) => (v !== null && typeof v === 'object' ? (v as IDataObject) : { value: v as string }));
	if (result !== null && typeof result === 'object') {
		return Object.values(result as IDataObject).map((v) => (v !== null && typeof v === 'object' ? (v as IDataObject) : { value: v as string }));
	}
	return [];
}

export interface OffsetPaging {
	/** Largest LIMIT the method takes. */
	pageSize: number;
	/** Stop after this many rows; undefined for all. */
	limit?: number;
	/** Where the rows sit inside `result`; undefined when `result` is the list itself. */
	itemsKey?: string;
	/** Parameter names, when the method spells them in lower case. */
	offsetKey?: string;
	limitKey?: string;
	itemIndex: number;
	/** Name of the object the paging keys go inside, e.g. PARAMS for imopenlines.config.list.get. */
	nestedIn?: string;
}

/** A runaway guard for offset paging: 2 000 pages of up to 200 rows. */
const MAX_PAGES = 2_000;

/**
 * Pages a method that takes OFFSET and LIMIT. Stops on a short page, on an empty
 * one, or when `hasMore`, `hasNextPage` or `next` says there is nothing further.
 */
export async function offsetList(this: Bitrix24Context, method: string, params: IDataObject, paging: OffsetPaging): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	const offsetKey = paging.offsetKey ?? 'OFFSET';
	const limitKey = paging.limitKey ?? 'LIMIT';
	for (let page = 0; page < MAX_PAGES; page++) {
		const want = paging.limit === undefined ? paging.pageSize : Math.min(paging.pageSize, paging.limit - rows.length);
		const pageWindow = { [offsetKey]: page * paging.pageSize, [limitKey]: paging.pageSize };
		const request = paging.nestedIn === undefined ? { ...params, ...pageWindow } : { ...params, [paging.nestedIn]: { ...((params[paging.nestedIn] as IDataObject) ?? {}), ...pageWindow } };
		const body = await bitrix24Request.call(this, method, request, { itemIndex: paging.itemIndex });
		const result = body.result;
		const container = paging.itemsKey !== undefined && result !== null && typeof result === 'object' && !Array.isArray(result) ? (result as IDataObject)[paging.itemsKey] : result;
		const pageRows = valuesOf(container);
		rows.push(...pageRows.slice(0, want));
		if (paging.limit !== undefined && rows.length >= paging.limit) break;
		if (pageRows.length < paging.pageSize || pageRows.length === 0) break;
		const envelope = result !== null && typeof result === 'object' && !Array.isArray(result) ? (result as IDataObject) : {};
		if (envelope.hasMore === false || envelope.hasNextPage === false || envelope.hasMorePages === false) break;
		if (body.next === undefined && body.total !== undefined && rows.length >= Number(body.total)) break;
	}
	return rows;
}
