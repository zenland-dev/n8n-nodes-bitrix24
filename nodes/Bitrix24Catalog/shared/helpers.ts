import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../../shared/cache';
import type { CrudConfig } from '../../../shared/crud';
import { crudOperations } from '../../../shared/crud';
import { extractRows, listAll } from '../../../shared/list';
import { compact } from '../../../shared/params';
import type { Operation } from '../../../shared/spec';
import type { Bitrix24Context } from '../../../shared/transport';
import { bitrix24Request, portalKey } from '../../../shared/transport';

/**
 * A portal has one product catalog and, when variations are on, a second catalog for them whose
 * productIblockId points back at the first (seen on a live portal, 19.09.2026). The catalog ID is
 * the ID of its information block; every product method wants it as iblockId.
 */
export async function catalogRows(ctx: Bitrix24Context): Promise<IDataObject[]> {
	const portal = await portalKey.call(ctx);
	return await cached(
		`catalog:catalogs:${portal}`,
		async () => {
			const body = await bitrix24Request.call(ctx, 'catalog.catalog.list', {});
			return extractRows(body.result, 'catalogs');
		},
		CONFIG_TTL_MS,
	);
}

const idOf = (row: IDataObject): number => Number(row.iblockId ?? row.id);
const isVariations = (row: IDataObject): boolean => Number(row.productIblockId) > 0;

export type CatalogKind = 'product' | 'variation';

/**
 * The catalog chosen in `name`, or the portal's own when the parameter is left empty: the product
 * catalog, or the variations catalog that belongs to it.
 */
export async function catalogId(ctx: IExecuteFunctions, itemIndex: number, kind: CatalogKind, name = 'catalogId'): Promise<number> {
	const chosen = Number(ctx.getNodeParameter(name, itemIndex, '') ?? 0) || 0;
	if (chosen > 0) return chosen;
	const rows = await catalogRows(ctx);
	const products = rows.filter((row) => !isVariations(row));
	if (kind === 'product') {
		if (products.length === 0) throw new NodeOperationError(ctx.getNode(), 'The portal has no product catalog', { itemIndex });
		return idOf(products[0]);
	}
	const variations = rows.find((row) => isVariations(row) && products.some((p) => idOf(p) === Number(row.productIblockId)));
	if (variations === undefined) {
		throw new NodeOperationError(ctx.getNode(), 'The portal has no variations catalog', {
			itemIndex,
			description: 'Variations appear once a product with variations has been created in the Bitrix24 catalog.',
		});
	}
	return idOf(variations);
}

export function catalogProperty(kind: CatalogKind): INodeProperties {
	return {
		displayName: 'Catalog Name or ID',
		name: 'catalogId',
		type: 'options',
		typeOptions: { loadOptionsMethod: kind === 'product' ? 'getProductCatalogs' : 'getVariationCatalogs' },
		default: '',
		description:
			kind === 'product'
				? 'The product catalog. Leave empty for the one the CRM uses. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.'
				: 'The catalog variations live in. Leave empty for the one tied to the CRM product catalog. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	};
}

// ── Product properties by ID or code ───────────────────────────────────────

/** Codes of the properties of one catalog, lower-cased, to their IDs. */
async function propertyIdsByCode(ctx: IExecuteFunctions, iblockId: number): Promise<Map<string, number>> {
	const portal = await portalKey.call(ctx);
	return await cached(
		`catalog:properties:${portal}:${iblockId}`,
		async () => {
			const rows = await listAll.call(ctx, 'catalog.productProperty.list', { select: ['id', 'code'], filter: { iblockId } }, { itemsKey: 'productProperties' });
			const map = new Map<string, number>();
			for (const row of rows) {
				const code = String(row.code ?? '').trim();
				if (code !== '') map.set(code.toLowerCase(), Number(row.id));
			}
			return map;
		},
		CONFIG_TTL_MS,
	);
}

/**
 * A property value the way update takes it. A bare value on update does not write: a text keeps
 * its old value and a number is cleared (live portal, 19.09.2026). `{"value": …}` and arrays of it
 * work on add and on update alike, so every value goes in wrapped.
 */
function wrapped(value: unknown): unknown {
	const one = (v: unknown): unknown => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : { value: v });
	return Array.isArray(value) ? value.map(one) : one(value);
}

/**
 * Property values keyed the way the API wants them, `property<ID>`. Accepted keys: the ID (`258`),
 * `property258`, `PROPERTY_258`, or the property's code, looked up in the catalog.
 */
export async function propertyFields(ctx: IExecuteFunctions, itemIndex: number, iblockId: number | undefined, values: IDataObject): Promise<IDataObject> {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		const id = key.match(/^(?:property_?)?(\d+)$/i);
		if (id) {
			out[`property${id[1]}`] = wrapped(value) as IDataObject;
			continue;
		}
		if (iblockId === undefined) {
			throw new NodeOperationError(ctx.getNode(), `Property "${key}" must be given by ID here, e.g. property258`, { itemIndex });
		}
		const found = (await propertyIdsByCode(ctx, iblockId)).get(key.toLowerCase());
		if (found === undefined) {
			throw new NodeOperationError(ctx.getNode(), `The catalog has no property with the code "${key}"`, {
				itemIndex,
				description: 'Property → Get Many lists the properties with their IDs and codes.',
			});
		}
		out[`property${found}`] = wrapped(value) as IDataObject;
	}
	return out;
}

// ── Fields every kind of catalog item shares ───────────────────────────────

export type ItemKind = 'product' | 'variation' | 'parentProduct' | 'service';

const yesNo = (value: unknown): 'Y' | 'N' | undefined => (value === undefined ? undefined : value === true ? 'Y' : 'N');

/** The Additional Fields collection of Create and Update, trimmed to what the kind accepts. */
export function itemFieldsProperty(kind: ItemKind, name: string, displayName: string, withName = false): INodeProperties {
	const goods = kind !== 'service';
	const options: INodeProperties[] = [
		{ displayName: 'Active', name: 'active', type: 'boolean', default: true, description: 'Whether the item can be picked and sold' },
		{ displayName: 'Code', name: 'code', type: 'string', default: '', description: 'Symbolic code, the part of the address a store page uses' },
		{ displayName: 'Detail Text', name: 'detailText', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Full description' },
		{ displayName: 'External ID', name: 'xmlId', type: 'string', default: '', description: 'ID of the item in the system it came from; handy for matching on the next sync' },
		{ displayName: 'Preview Text', name: 'previewText', type: 'string', typeOptions: { rows: 2 }, default: '', description: 'Short description' },
		{
			displayName: 'Section Name or ID',
			name: 'iblockSectionId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getSections', loadOptionsDependsOn: ['catalogId'] },
			default: '',
			description: 'Section the item is shown in. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
		{ displayName: 'Sort Order', name: 'sort', type: 'number', default: 500, description: 'Position among the others; smaller comes first' },
		{
			displayName: 'VAT Rate Name or ID',
			name: 'vatId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getVatRates' },
			default: '',
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{ displayName: 'VAT Included', name: 'vatIncluded', type: 'boolean', default: false, description: 'Whether the price already holds the VAT' },
	];
	if (goods) {
		options.push(
			{ displayName: 'Can Buy When Out of Stock', name: 'canBuyZero', type: 'boolean', default: false, description: 'Whether an order may take the item when none is left' },
			{ displayName: 'Height', name: 'height', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
			{ displayName: 'Length', name: 'length', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
			{
				displayName: 'Unit of Measure Name or ID',
				name: 'measure',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMeasures' },
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Purchasing Currency Name or ID',
				name: 'purchasingCurrency',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCurrencies' },
				default: '',
				description: 'Currency of Purchasing Price. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{ displayName: 'Purchasing Price', name: 'purchasingPrice', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0, description: 'What the item costs to buy in. The selling price is a Price, not a field.' },
			{ displayName: 'Quantity', name: 'quantity', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0, description: 'Stock on hand when inventory management is off; with it on, stock moves through inventory documents' },
			{ displayName: 'Weight', name: 'weight', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0, description: 'Weight in grams' },
			{ displayName: 'Width', name: 'width', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
		);
	}
	if (withName) options.push({ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'New name' });
	if (kind === 'variation') {
		options.push({ displayName: 'Parent Product ID', name: 'parentId', type: 'number', default: 0, description: 'The product with variations this one belongs to' });
	}
	options.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return { displayName, name, type: 'collection', placeholder: 'Add Field', default: {}, options };
}

const BOOLEAN_FIELDS = new Set(['active', 'vatIncluded', 'canBuyZero']);

/** The collection above as API fields: flags as Y/N, empty pickers dropped. */
export function itemFields(chosen: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(chosen)) {
		if (BOOLEAN_FIELDS.has(key)) out[key] = yesNo(value);
		else if (key === 'iblockSectionId' || key === 'measure' || key === 'vatId' || key === 'parentId') {
			const id = Number(value);
			if (Number.isInteger(id) && id > 0) out[key] = id;
		} else out[key] = value;
	}
	return compact(out);
}

// ── Pickers ────────────────────────────────────────────────────────────────

/** Rows of a small catalog list for a dropdown, cached for a couple of minutes. */
export async function pickerRows(ctx: ILoadOptionsFunctions, method: string, key: string, params: IDataObject = {}): Promise<IDataObject[]> {
	const portal = await portalKey.call(ctx);
	return await cached(
		`catalog:picker:${portal}:${method}:${JSON.stringify(params)}`,
		async () => await listAll.call(ctx, method, params, { itemsKey: key }),
		CONFIG_TTL_MS,
	);
}

// ── Administrative objects ─────────────────────────────────────────────────

/**
 * The catalog's many small objects (VAT rates, units, price types, stores…) all answer the same
 * way: the object under its own key ({vat: {…}}), rows under a plural key, and field descriptions
 * from getFields rather than fields.
 */
export function catalogCrud(config: Omit<CrudConfig, 'methods' | 'fieldsResultKey' | 'resultKey'> & { key: string }): Operation[] {
	const { key, ...rest } = config;
	return crudOperations({ ...rest, resultKey: key, fieldsResultKey: key, methods: { getFields: 'getFields' } });
}

/** Any catalog, products or variations, for objects that belong to either. */
export const anyCatalogProperty: INodeProperties = {
	displayName: 'Catalog Name or ID',
	name: 'catalogId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCatalogs' },
	default: '',
	description:
		'Leave empty for the product catalog the CRM uses. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

/** The catalog above as the iblockId an object is created in or filtered by. */
export async function catalogFilter(ctx: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	return { iblockId: await catalogId(ctx, itemIndex, 'product') };
}
