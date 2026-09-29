import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeAbbr } from '../shared/entityTypes';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows } from '../shared/props';

const owner: INodeProperties[] = [
	entityTypeProperty('Type of the record the products belong to — lead, deal, quote, invoice or a smart process with products enabled'),
	numberProperty('Record ID', 'ownerId', 'ID of the lead, deal or other record'),
];

const rowFields: INodeProperties[] = [
	{
		displayName: 'Product ID',
		name: 'productId',
		type: 'number',
		default: 0,
		description: 'Catalog product ID. 0 for a free-text row with only a name.',
	},
	{
		displayName: 'Product Name',
		name: 'productName',
		type: 'string',
		default: '',
		description: 'Row name. With a Product ID and no name, the catalog name is used.',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		typeOptions: { numberPrecision: 2 },
		default: 0,
		description: 'Price per unit, discounts and taxes included, in the currency of the record',
		hint: 'Bitrix24 does not take the price from the catalog: a row without one costs 0, Product ID or not',
	},
	{ displayName: 'Quantity', name: 'quantity', type: 'number', typeOptions: { numberPrecision: 3 }, default: 1 },
];

// Update sends only what is filled in. Price and Quantity are text fields here so that empty can mean
// "keep": until 0.11.1 they were numbers defaulting to 0 and 1, and every Update reset the price and
// quantity of the row. n8n saves no parameter left at its default, so a workflow that never touched
// them now keeps the row's values, and one that set a price still sends it.
const updateRowFields: INodeProperties[] = [
	{
		displayName: 'Product ID',
		name: 'productId',
		type: 'number',
		default: 0,
		description: 'Catalog product to put in the row. 0 keeps the product.',
		hint: 'A new product brings its catalog name unless Product Name is set, but neither its price nor its unit of measure',
	},
	{ displayName: 'Product Name', name: 'productName', type: 'string', default: '', description: 'New row name. Empty keeps the name.' },
	{ displayName: 'Price', name: 'price', type: 'string', default: '', placeholder: '1500.50', description: 'New price per unit, discounts and taxes included. Empty keeps the price.' },
	{ displayName: 'Quantity', name: 'quantity', type: 'string', default: '', placeholder: '2', description: 'New quantity. Empty keeps the quantity.' },
];

function rowOptions(forUpdate: boolean): INodeProperties {
	return {
		displayName: forUpdate ? 'Update Fields' : 'Additional Fields',
		name: 'rowOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: [
			{ displayName: 'Discount Amount', name: 'discountSum', type: 'number', default: 0, description: 'Absolute discount per unit; sets the discount type to amount' },
			{ displayName: 'Discount Percent', name: 'discountRate', type: 'number', default: 0, description: 'Percentage discount; sets the discount type to percent' },
			{ displayName: 'Measure Code', name: 'measureCode', type: 'number', default: 796, description: 'Unit of measure code from the catalog, 796 is pieces' },
			{ displayName: 'Sort', name: 'sort', type: 'number', default: 10 },
			{ displayName: 'Tax Included', name: 'taxIncluded', type: 'boolean', default: false, description: 'Whether the price already contains the tax' },
			{
				displayName: 'Tax Name',
				name: 'taxName',
				type: 'string',
				default: '',
				placeholder: 'VAT 20',
				description: forUpdate
					? 'Name of the tax rate, kept as written. Bitrix24 calculates with Tax Rate only.'
					: 'Name of the tax rate, kept as written. Bitrix24 calculates with Tax Rate only, and names a row without a tax "No VAT".',
			},
			{ displayName: 'Tax Rate', name: 'taxRate', type: 'number', default: 0, description: 'Tax rate in percent' },
		],
	};
}

function optionsBody(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const o = (ctx.getNodeParameter('rowOptions', itemIndex, {}) ?? {}) as IDataObject;
	const body = compact({
		measureCode: o.measureCode,
		sort: o.sort,
		taxRate: o.taxRate,
		taxIncluded: o.taxIncluded === undefined ? undefined : o.taxIncluded ? 'Y' : 'N',
		taxName: o.taxName,
	});
	if (o.discountSum !== undefined) Object.assign(body, { discountTypeId: 1, discountSum: o.discountSum });
	else if (o.discountRate !== undefined) Object.assign(body, { discountTypeId: 2, discountRate: o.discountRate });
	return body;
}

function rowBody(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return {
		...compact({
			productId: Number(ctx.getNodeParameter('productId', itemIndex, 0)) || undefined,
			productName: ctx.getNodeParameter('productName', itemIndex, '') as string,
			price: ctx.getNodeParameter('price', itemIndex, undefined) as number | undefined,
			quantity: ctx.getNodeParameter('quantity', itemIndex, undefined) as number | undefined,
		}),
		...optionsBody(ctx, itemIndex),
	};
}

/** A number typed into a text field of Update; empty means "keep". Workflows from before 0.11.1 hold a number here. */
function optionalAmount(ctx: IExecuteFunctions, name: string, label: string, itemIndex: number): number | undefined {
	const raw = ctx.getNodeParameter(name, itemIndex, '');
	if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
	const value = Number(String(raw).trim().replace(',', '.'));
	if (!Number.isFinite(value)) throw new NodeOperationError(ctx.getNode(), `${label} must be a number, not "${String(raw)}"`, { itemIndex });
	return value;
}

function updateBody(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const body: IDataObject = {
		...compact({
			productId: Number(ctx.getNodeParameter('productId', itemIndex, 0)) || undefined,
			productName: ctx.getNodeParameter('productName', itemIndex, '') as string,
			price: optionalAmount(ctx, 'price', 'Price', itemIndex),
			quantity: optionalAmount(ctx, 'quantity', 'Quantity', itemIndex),
		}),
		...optionsBody(ctx, itemIndex),
	};
	// An empty fields object is accepted, changes nothing and answers null.
	if (Object.keys(body).length === 0) throw new NodeOperationError(ctx.getNode(), 'Nothing to update: fill in a field to change', { itemIndex });
	return body;
}

function ownerParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return {
		ownerId: positiveInt(ctx, 'ownerId', itemIndex, 'Record ID'),
		ownerType: entityTypeAbbr(positiveInt(ctx, 'entityTypeId', itemIndex, 'Entity type')),
	};
}

export const productRowResource: Resource = {
	value: 'productRow',
	name: 'Product Row',
	description: 'Products and services listed in a lead, deal, quote, invoice or smart process item',
	operations: [
		{
			value: 'add',
			name: 'Add',
			action: 'Add a product row',
			description: 'Add one product row to a record, keeping the rows it already has',
			properties: [...owner, ...rowFields, rowOptions(false)],
			async execute(itemIndex) {
				const fields = { ...ownerParams(this, itemIndex), ...rowBody(this, itemIndex) };
				const body = await bitrix24Request.call(this, 'crm.item.productrow.add', { fields }, { itemIndex });
				return rows(body.result, 'productRow');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a product row',
			description: 'Retrieve one product row by its ID',
			properties: [numberProperty('Product Row ID', 'rowId', 'ID of the product row')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.productrow.get', { id: positiveInt(this, 'rowId', itemIndex, 'Product Row ID') }, { itemIndex });
				return rows(body.result, 'productRow');
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get product rows of a record',
			description: 'List the product rows of one record',
			properties: [
				...owner,
				...returnAllProperties('product rows'),
				{
					displayName: 'Filters',
					name: 'rowFilters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Product ID', name: 'productId', type: 'number', default: 0, description: 'Only the rows of this catalog product. 0 for the free-text rows.' },
					],
				},
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const { ownerId, ownerType } = ownerParams(this, itemIndex);
				const filter: IDataObject = { '=ownerType': ownerType, '=ownerId': ownerId };
				// Bitrix24 filters rows by id and productId only, and returns every row for a condition on anything else.
				const f = (this.getNodeParameter('rowFilters', itemIndex, {}) ?? {}) as IDataObject;
				if (f.productId !== undefined && f.productId !== '') filter['=productId'] = Number(f.productId);
				return await listAll.call(this, 'crm.item.productrow.list', { filter }, { itemsKey: 'productRows', limit, itemIndex });
			},
		},
		{
			value: 'replaceAll',
			name: 'Replace All',
			action: 'Replace all product rows of a record',
			description: 'Overwrite the whole product list of a record; rows not given are removed. An empty list clears it.',
			properties: [
				...owner,
				{
					...jsonProperty(
						'Product Rows (JSON)',
						'productRows',
						'Array of rows, e.g. [{"productName": "Consulting", "price": 1500, "quantity": 2}, {"productId": 17, "price": 990, "quantity": 1}]',
						'[]',
					),
					hint: 'Each row is written whole: a price left out is 0, even with a Product ID. Every row comes back under a new ID, one sent with its old ID too. To change one row and keep its ID, use Update.',
				},
			],
			async execute(itemIndex) {
				const productRows = jsonParameter<IDataObject[]>(this, 'productRows', itemIndex, []);
				const body = await bitrix24Request.call(this, 'crm.item.productrow.set', { ...ownerParams(this, itemIndex), productRows }, { itemIndex });
				return rows(body.result, 'productRows');
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a product row',
			description: 'Change the product, price, quantity, discount or tax of one row. Fields left empty keep their values.',
			properties: [numberProperty('Product Row ID', 'rowId', 'ID of the product row'), ...updateRowFields, rowOptions(true)],
			async execute(itemIndex) {
				const fields = updateBody(this, itemIndex);
				const body = await bitrix24Request.call(this, 'crm.item.productrow.update', { id: positiveInt(this, 'rowId', itemIndex, 'Product Row ID'), fields }, { itemIndex });
				return rows(body.result, 'productRow');
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a product row',
			description: 'Remove one product row from its record',
			properties: [numberProperty('Product Row ID', 'rowId', 'ID of the product row')],
			async execute(itemIndex) {
				const id = positiveInt(this, 'rowId', itemIndex, 'Product Row ID');
				await bitrix24Request.call(this, 'crm.item.productrow.delete', { id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get product row fields',
			description: 'Describe the fields a product row has',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.productrow.fields', {}, { itemIndex });
				const fields = ((body.result as IDataObject)?.fields ?? body.result ?? {}) as IDataObject;
				return Object.entries(fields).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
		{
			value: 'getAvailableForPayment',
			name: 'Get Available for Payment',
			action: 'Get product rows not yet in a payment',
			description: 'List the rows of a record that are not yet included in any payment',
			properties: [...owner],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.productrow.getAvailableForPayment', ownerParams(this, itemIndex), { itemIndex });
				return rows(body.result, 'productRows');
			},
		},
	],
};
