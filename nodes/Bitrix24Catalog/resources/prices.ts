import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows, listAll } from '../../../shared/list';
import { positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { catalogCrud } from '../shared/helpers';

const productIdProperty: INodeProperties = {
	displayName: 'Product ID',
	name: 'productId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the product, variation or service the price belongs to',
};

const priceTypeProperty: INodeProperties = {
	displayName: 'Price Type Name or ID',
	name: 'priceTypeId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getPriceTypes' },
	required: true,
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

const currencyProperty: INodeProperties = {
	displayName: 'Currency Name or ID',
	name: 'currency',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCurrencies' },
	required: true,
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

const amountProperty: INodeProperties = {
	displayName: 'Price',
	name: 'price',
	type: 'number',
	typeOptions: { numberPrecision: 2, minValue: 0 },
	required: true,
	default: 0,
};

function currencyOf(value: unknown): string {
	return String(value ?? '').trim().toUpperCase();
}

const pricesProperty: INodeProperties = {
	displayName: 'Prices',
	name: 'prices',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Price',
	default: {},
	options: [
		{
			displayName: 'Price',
			name: 'price',
			values: [
				{ ...priceTypeProperty, required: false },
				{ ...amountProperty, required: false },
				{ ...currencyProperty, required: false },
			],
		},
	],
};

/** The Prices collection as API prices, one per row; a row without a type or currency is refused. */
function givenPrices(ctx: IExecuteFunctions, itemIndex: number): Array<{ catalogGroupId: number; price: number; currency: string }> {
	const rowsGiven = ((ctx.getNodeParameter('prices', itemIndex, {}) as IDataObject).price ?? []) as IDataObject[];
	if (rowsGiven.length === 0) throw new NodeOperationError(ctx.getNode(), 'Add at least one price', { itemIndex });
	return rowsGiven.map((row, index) => {
		const catalogGroupId = Number(row.priceTypeId);
		if (!Number.isInteger(catalogGroupId) || catalogGroupId <= 0) {
			throw new NodeOperationError(ctx.getNode(), `Price ${index + 1} has no price type`, { itemIndex });
		}
		const currency = currencyOf(row.currency);
		if (currency === '') throw new NodeOperationError(ctx.getNode(), `Price ${index + 1} has no currency`, { itemIndex });
		return { catalogGroupId, price: Number(row.price ?? 0), currency };
	});
}

export const priceResource: Resource = {
	value: 'price',
	name: 'Price',
	description: 'Selling prices of products, one per price type',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a price',
			description: 'Give a product a price of one price type',
			properties: [productIdProperty, priceTypeProperty, amountProperty, currencyProperty],
			async execute(itemIndex) {
				const fields = {
					productId: positiveInt(this, 'productId', itemIndex, 'Product ID'),
					catalogGroupId: positiveInt(this, 'priceTypeId', itemIndex, 'Price type'),
					price: Number(this.getNodeParameter('price', itemIndex)),
					currency: currencyOf(this.getNodeParameter('currency', itemIndex)),
				};
				const body = await bitrix24Request.call(this, 'catalog.price.add', { fields }, { itemIndex });
				return rows(body.result, 'price');
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a price',
			description: 'Change the amount and currency of one price',
			properties: [
				{ displayName: 'Price ID', name: 'objectId', type: 'number', required: true, default: 0, description: 'ID of the price, as Get Many returns it' },
				amountProperty,
				currencyProperty,
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'objectId', itemIndex, 'Price ID');
				const fields = { price: Number(this.getNodeParameter('price', itemIndex)), currency: currencyOf(this.getNodeParameter('currency', itemIndex)) };
				const body = await bitrix24Request.call(this, 'catalog.price.update', { id, fields }, { itemIndex });
				return rows(body.result, 'price');
			},
		},
		{
			value: 'setPrices',
			name: 'Set Product Prices',
			action: 'Set the prices of a product',
			description: 'Set one or more prices of a product by price type: an existing price of that type is changed and keeps its ID, a missing one is added',
			properties: [
				productIdProperty,
				pricesProperty,
				{
					displayName: 'Remove Other Prices',
					name: 'removeOthers',
					type: 'boolean',
					default: false,
					description: 'Whether prices of the product that are not listed above are deleted. Off keeps them as they are.',
				},
			],
			async execute(itemIndex) {
				const productId = positiveInt(this, 'productId', itemIndex, 'Product ID');
				const given = givenPrices(this, itemIndex);
				const removeOthers = this.getNodeParameter('removeOthers', itemIndex, false) as boolean;

				// catalog.price.modify would do this in one call, but it refuses every price that names its ID
				// ("Validate price error. Catalog price group is wrong", live portal, 19.09.2026), and without IDs
				// it replaces the whole set. So a price of a listed type is changed in place, a missing one added.
				const current = await listAll.call(this, 'catalog.price.list', { filter: { productId } }, { itemsKey: 'prices', itemIndex });
				const plain = (p: IDataObject): boolean => (p.quantityFrom ?? null) === null && (p.quantityTo ?? null) === null;
				const touched = new Set<number>();
				for (const price of given) {
					const existing = current.find((p) => Number(p.catalogGroupId) === price.catalogGroupId && plain(p) && !touched.has(Number(p.id)));
					if (existing !== undefined) {
						touched.add(Number(existing.id));
						await bitrix24Request.call(this, 'catalog.price.update', { id: Number(existing.id), fields: { price: price.price, currency: price.currency } }, { itemIndex });
					} else {
						await bitrix24Request.call(this, 'catalog.price.add', { fields: { productId, ...price } }, { itemIndex });
					}
				}
				if (removeOthers) {
					for (const p of current) {
						if (!touched.has(Number(p.id))) await bitrix24Request.call(this, 'catalog.price.delete', { id: Number(p.id) }, { itemIndex });
					}
				}
				return await listAll.call(this, 'catalog.price.list', { filter: { productId } }, { itemsKey: 'prices', itemIndex });
			},
		},
		{
			value: 'replacePrices',
			name: 'Replace Product Prices',
			action: 'Replace every price of a product',
			description: 'Replace the whole price set of a product in one call: prices not listed are deleted, and every price gets a new ID',
			properties: [productIdProperty, pricesProperty],
			async execute(itemIndex) {
				const productId = positiveInt(this, 'productId', itemIndex, 'Product ID');
				const body = await bitrix24Request.call(this, 'catalog.price.modify', { fields: { product: { id: productId, prices: givenPrices(this, itemIndex) } } }, { itemIndex });
				return extractRows(body.result, 'prices');
			},
		},
		...catalogCrud({
			prefix: 'catalog.price',
			key: 'price',
			noun: 'price',
			plural: 'prices',
			kinds: ['get', 'getMany', 'delete', 'getFields'],
			fieldsExample: '{}',
			descriptions: { getMany: 'Read prices, e.g. of one product with the filter {"productId": 101}' },
		}),
	],
};

export const priceTypeResource: Resource = {
	value: 'priceType',
	name: 'Price Type',
	description: 'Kinds of price a product can have — retail, wholesale; one of them is the base price',
	operations: catalogCrud({
		prefix: 'catalog.priceType',
		key: 'priceType',
		noun: 'price type',
		plural: 'price types',
		fieldsExample: '{"name": "Wholesale", "base": "N", "sort": 200, "xmlId": "wholesale"}',
	}),
};

export const priceTypeAccessResource: Resource = {
	value: 'priceTypeAccess',
	name: 'Price Type Access',
	description: 'Which customer groups may see a price type or buy at it',
	operations: catalogCrud({
		prefix: 'catalog.priceTypeGroup',
		key: 'priceTypeGroup',
		noun: 'price type access',
		plural: 'price type accesses',
		kinds: ['create', 'getMany', 'delete', 'getFields'],
		fieldsExample: '{"catalogGroupId": 2, "groupId": 2, "access": "Y"}',
		descriptions: {
			create: 'Let a customer group see a price type (access N) or buy at it (access Y). A new price type already has both for the default groups, and a pair that exists is refused.',
		},
	}),
};

export const priceTypeNameResource: Resource = {
	value: 'priceTypeName',
	name: 'Price Type Name',
	description: 'Names of a price type in each interface language',
	operations: [
		...catalogCrud({
			prefix: 'catalog.priceTypeLang',
			key: 'priceTypeLang',
			noun: 'price type name',
			plural: 'price type names',
			fieldsExample: '{"catalogGroupId": 2, "lang": "en", "name": "Wholesale"}',
		}),
		{
			value: 'getLanguages',
			name: 'Get Languages',
			action: 'Get the languages a price type can be named in',
			description: 'List the languages a price type name can be given in',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.priceTypeLang.getLanguages', {}, { itemIndex });
				return rows(body.result, 'languages');
			},
		},
	],
};

export const markupResource: Resource = {
	value: 'markup',
	name: 'Markup',
	description: 'Markups a price type can be calculated with from the base price',
	operations: catalogCrud({
		prefix: 'catalog.extra',
		key: 'extra',
		noun: 'markup',
		plural: 'markups',
		kinds: ['get', 'getMany', 'getFields'],
		fieldsExample: '{}',
	}),
};

export const roundingRuleResource: Resource = {
	value: 'roundingRule',
	name: 'Rounding Rule',
	description: 'How prices of a price type are rounded from a given amount up',
	operations: [
		...catalogCrud({
			prefix: 'catalog.roundingRule',
			key: 'roundingRule',
			noun: 'rounding rule',
			plural: 'rounding rules',
			fieldsExample: '{"catalogGroupId": 2, "price": 1000, "roundType": 1, "roundPrecision": 10}',
			descriptions: { create: 'Add a rounding rule. Get Rounding Types lists the values roundType takes.' },
		}),
		{
			value: 'getRoundTypes',
			name: 'Get Rounding Types',
			action: 'Get the rounding types',
			description: 'List the ways a price can be rounded, for the roundType field',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.enum.getRoundTypes', {}, { itemIndex });
				return rows(body.result, 'enum');
			},
		},
	],
};
