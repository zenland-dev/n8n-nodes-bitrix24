import type { IDataObject } from 'n8n-workflow';

import type { Bitrix24Context } from './transport';
import { bitrix24Request } from './transport';

/** Bitrix24 list methods return a fixed page of 50. */
export const PAGE_SIZE = 50;

/** A runaway guard: 20 000 pages is a million records. */
const MAX_PAGES = 20_000;

export interface ListOptions {
	/** Where the rows live inside `result`: '' for a bare array, 'items', 'tasks'… */
	itemsKey?: string;
	/**
	 * Page by ID instead of by offset — `order: {id: ASC}`, `filter: {'>id': last}`,
	 * `start: -1`. Bitrix24 then skips counting the total, which on a large portal makes
	 * each page many times faster. Only possible when the caller
	 * has not asked for its own sort order.
	 */
	idField?: string;
	/**
	 * Key of the ID inside a returned row, when it is spelled differently from the
	 * filter field: tasks.task.list filters and sorts by ID but answers with id.
	 */
	rowIdKey?: string;
	/** Stop after this many rows. Undefined means all. */
	limit?: number;
	v3?: boolean;
	itemIndex?: number;
}

/** Finds the rows in a list answer, whichever envelope the method uses. */
export function extractRows(result: unknown, itemsKey?: string): IDataObject[] {
	if (Array.isArray(result)) return result as IDataObject[];
	if (result === null || typeof result !== 'object') return [];

	const object = result as IDataObject;
	if (itemsKey !== undefined && itemsKey !== '') {
		const rows = object[itemsKey];
		if (Array.isArray(rows)) return rows as IDataObject[];
		// Some methods key their rows by ID: {"12": {...}, "13": {...}}.
		if (rows !== null && typeof rows === 'object') return Object.values(rows) as IDataObject[];
		return [];
	}

	const arrays = Object.values(object).filter(Array.isArray);
	return arrays.length === 1 ? (arrays[0] as IDataObject[]) : [];
}

function hasCustomOrder(order: unknown): boolean {
	return order !== undefined && order !== null && typeof order === 'object' && Object.keys(order).length > 0;
}

/**
 * Reads a list method page by page.
 *
 * Keyset paging is used when `idField` is given and the caller sets no order;
 * otherwise Bitrix24's own `start`/`next` offsets, which also make it count `total`.
 */
export async function listAll(
	this: Bitrix24Context,
	method: string,
	params: IDataObject,
	options: ListOptions = {},
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	const limit = options.limit;
	const request = { v3: options.v3, itemIndex: options.itemIndex };

	if (options.idField !== undefined && !hasCustomOrder(params.order)) {
		const idField = options.idField;
		const filter = { ...((params.filter as IDataObject) ?? {}) };
		const floorKey = `>${idField}`;
		let lastId = Number(filter[floorKey] ?? 0) || 0;

		for (let page = 0; page < MAX_PAGES; page++) {
			const body = await bitrix24Request.call(
				this,
				method,
				{ ...params, order: { [idField]: 'ASC' }, filter: { ...filter, [floorKey]: lastId }, start: -1 },
				request,
			);
			const pageRows = extractRows(body.result, options.itemsKey);
			rows.push(...pageRows);

			if (limit !== undefined && rows.length >= limit) return rows.slice(0, limit);
			if (pageRows.length < PAGE_SIZE) break;

			const nextId = Number(pageRows[pageRows.length - 1][options.rowIdKey ?? idField]);
			// A method that ignores the ID filter would loop forever on the same page.
			if (!Number.isFinite(nextId) || nextId <= lastId) break;
			lastId = nextId;
		}
		return rows;
	}

	let start: number | undefined = 0;
	for (let page = 0; page < MAX_PAGES && start !== undefined; page++) {
		const body: IDataObject = await bitrix24Request.call(this, method, { ...params, start }, request);
		const pageRows = extractRows(body.result, options.itemsKey);
		rows.push(...pageRows);

		if (limit !== undefined && rows.length >= limit) return rows.slice(0, limit);

		const next: number = Number(body.next);
		start = Number.isFinite(next) && next > start && pageRows.length > 0 ? next : undefined;
	}
	return rows;
}

export interface ListV3Options {
	/** Where the rows live inside `result`. Every REST 3.0 list method seen so far uses `items`. */
	itemsKey?: string;
	/** Stop after this many rows. Undefined means all. */
	limit?: number;
	/** Rows per request. Bitrix24 defaults to 50 and served 100 when asked (22.09.2026). */
	pageSize?: number;
	itemIndex?: number;
}

/**
 * Reads a REST 3.0 list method page by page.
 *
 * REST 3.0 pages differently from the classic API: no `next` offset comes back, the
 * caller asks for `pagination: {page, limit}` and stops when a short page arrives.
 * The page size stays the same across the whole run — Bitrix24 works the offset out
 * of `page` and `limit`, so shrinking the limit on the last page would skip rows.
 */
export async function listAllV3(
	this: Bitrix24Context,
	method: string,
	params: IDataObject,
	options: ListV3Options = {},
): Promise<IDataObject[]> {
	const pageSize = options.pageSize ?? PAGE_SIZE;
	const rows: IDataObject[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const body = await bitrix24Request.call(
			this,
			method,
			{ ...params, pagination: { page, limit: pageSize } },
			{ v3: true, itemIndex: options.itemIndex },
		);
		const pageRows = extractRows(body.result, options.itemsKey ?? 'items');
		rows.push(...pageRows);

		if (pageRows.length < pageSize) break;
		if (options.limit !== undefined && rows.length >= options.limit) break;
	}

	return options.limit === undefined ? rows : rows.slice(0, options.limit);
}
