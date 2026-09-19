import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import { positiveInt, rows } from '../../../shared/props';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList } from '../../../shared/values';
import { catalogCrud } from '../shared/helpers';

export const storeResource: Resource = {
	value: 'store',
	name: 'Store',
	description: 'Warehouses and pickup points stock is kept in',
	operations: catalogCrud({
		prefix: 'catalog.store',
		key: 'store',
		noun: 'store',
		plural: 'stores',
		fieldsExample: '{"title": "Main warehouse", "address": "1 Harbour Road", "active": "Y", "issuingCenter": "N"}',
		descriptions: { create: 'Add a store; address is required' },
	}),
};

export const stockResource: Resource = {
	value: 'stock',
	name: 'Stock',
	description: 'How much of each product every store holds and how much is reserved',
	operations: catalogCrud({
		prefix: 'catalog.storeproduct',
		key: 'storeProduct',
		noun: 'stock record',
		plural: 'stock records',
		kinds: ['get', 'getMany', 'getFields'],
		fieldsExample: '{}',
		descriptions: { getMany: 'Read stock, e.g. of one product with the filter {"productId": 101} or of one store with {"storeId": 1}' },
	}),
};

// ── Inventory documents ────────────────────────────────────────────────────

const documentIdProperty: INodeProperties = {
	displayName: 'Document ID',
	name: 'documentId',
	type: 'number',
	required: true,
	default: 0,
	description: 'ID of the inventory document',
};

const documentIdsProperty: INodeProperties = {
	displayName: 'Document IDs',
	name: 'documentIds',
	type: 'string',
	required: true,
	default: '',
	placeholder: '12, 13, 14',
	description: 'Comma-separated IDs of inventory documents, or an array from an expression',
};

function documentFieldsProperty(name: string, displayName: string, withRequired: boolean): INodeProperties {
	const options: INodeProperties[] = [
		{ displayName: 'Comment', name: 'commentary', type: 'string', default: '' },
		{ displayName: 'Document Date', name: 'dateDocument', type: 'dateTime', default: '' },
		{ displayName: 'Document Number', name: 'docNumber', type: 'string', default: '', description: 'Internal number of the document' },
		{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		{ displayName: 'Total', name: 'total', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0, description: 'Total amount of the items' },
	];
	if (!withRequired) {
		options.push({ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', default: 0 });
	}
	options.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return { displayName, name, type: 'collection', placeholder: 'Add Field', default: {}, options };
}

function documentFields(chosen: IDataObject): IDataObject {
	const out = compact({ ...chosen });
	if (out.responsibleId !== undefined && !(Number(out.responsibleId) > 0)) delete out.responsibleId;
	if (out.total === 0) delete out.total;
	return out;
}

function documentAction(value: string, name: string, action: string, description: string, method: string, many: boolean): Operation {
	return {
		value,
		name,
		action,
		description,
		properties: [many ? documentIdsProperty : documentIdProperty],
		async execute(itemIndex) {
			if (many) {
				const documentIds = idList(this, this.getNodeParameter('documentIds', itemIndex), 'Document IDs', itemIndex);
				await bitrix24Request.call(this, method, { documentIds }, { itemIndex });
				return { documentIds, success: true };
			}
			const id = positiveInt(this, 'documentId', itemIndex, 'Document ID');
			await bitrix24Request.call(this, method, { id }, { itemIndex });
			return { id, success: true };
		},
	};
}

export const documentResource: Resource = {
	value: 'document',
	name: 'Inventory Document',
	description: 'Receipts, transfers, write-offs and stock adjustments; they move stock once conducted, with inventory management on',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create an inventory document',
			description: 'Start an inventory document; add its items with Document Item, then conduct it',
			properties: [
				{
					displayName: 'Document Type Name or ID',
					name: 'docType',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getDocumentTypes' },
					required: true,
					default: '',
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Currency Name or ID',
					name: 'currency',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCurrencies' },
					required: true,
					default: '',
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{ displayName: 'Responsible User ID', name: 'responsibleId', type: 'number', required: true, default: 0, description: 'The employee the document is assigned to' },
				documentFieldsProperty('additionalFields', 'Additional Fields', true),
			],
			async execute(itemIndex) {
				const fields: IDataObject = {
					...documentFields((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject),
					docType: String(this.getNodeParameter('docType', itemIndex)),
					currency: String(this.getNodeParameter('currency', itemIndex)).toUpperCase(),
					responsibleId: positiveInt(this, 'responsibleId', itemIndex, 'Responsible User ID'),
				};
				const body = await bitrix24Request.call(this, 'catalog.document.add', { fields }, { itemIndex });
				return rows(body.result, 'document');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an inventory document',
			description: 'Read one inventory document',
			properties: [documentIdProperty],
			async execute(itemIndex) {
				// There is no catalog.document.get; the list method filtered by ID stands in for it.
				const id = positiveInt(this, 'documentId', itemIndex, 'Document ID');
				const body = await bitrix24Request.call(this, 'catalog.document.list', { filter: { id } }, { itemIndex });
				const found = (((body.result as IDataObject)?.documents ?? []) as IDataObject[])[0];
				if (found === undefined) throw new NodeOperationError(this.getNode(), `No inventory document ${id}`, { itemIndex });
				return found;
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many inventory documents',
			description: 'Read inventory documents, all of them or the ones a filter names',
			properties: [
				...returnAllProperties('documents'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Filter object, e.g. {"docType": "A", "status": "N"}. Status is Y once conducted, N for a draft, C when cancelled.' },
				{ displayName: 'Order (JSON)', name: 'orderJson', type: 'json', default: '{}', description: 'Sort object, e.g. {"dateCreate": "DESC"}' },
				{ displayName: 'Fields to Return', name: 'select', type: 'string', default: '', placeholder: 'docType, status, title, total', description: 'Comma-separated field names. Leave empty for the default set.' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const params: IDataObject = {};
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				if (Object.keys(filter).length > 0) params.filter = filter;
				if (Object.keys(order).length > 0) params.order = order;
				if (select.length > 0) params.select = select;
				return await listAll.call(this, 'catalog.document.list', params, { itemsKey: 'documents', limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update an inventory document',
			description: 'Change fields of a draft inventory document',
			properties: [documentIdProperty, documentFieldsProperty('updateFields', 'Update Fields', false)],
			async execute(itemIndex) {
				const id = positiveInt(this, 'documentId', itemIndex, 'Document ID');
				const fields = documentFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject);
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update', { itemIndex });
				const body = await bitrix24Request.call(this, 'catalog.document.update', { id, fields }, { itemIndex });
				return rows(body.result, 'document');
			},
		},
		documentAction('delete', 'Delete', 'Delete an inventory document', 'Delete a draft inventory document', 'catalog.document.delete', false),
		documentAction('deleteMany', 'Delete Many', 'Delete many inventory documents', 'Delete several draft inventory documents at once', 'catalog.document.deleteList', true),
		documentAction('conduct', 'Conduct', 'Conduct an inventory document', 'Post a document so its items move stock', 'catalog.document.conduct', false),
		documentAction('conductMany', 'Conduct Many', 'Conduct many inventory documents', 'Post several documents at once', 'catalog.document.conductList', true),
		documentAction('cancel', 'Cancel', 'Cancel an inventory document', 'Undo the posting of a conducted document and return the stock', 'catalog.document.cancel', false),
		documentAction('cancelMany', 'Cancel Many', 'Cancel many inventory documents', 'Undo the posting of several documents at once', 'catalog.document.cancelList', true),
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get inventory document fields',
			description: 'Describe the fields an inventory document has',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.document.getFields', {}, { itemIndex });
				const fields = ((body.result as IDataObject)?.document ?? {}) as IDataObject;
				return Object.entries(fields).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
		{
			value: 'getTypes',
			name: 'Get Types',
			action: 'Get the inventory document types',
			description: 'List the kinds of inventory document REST can create',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.enum.getStoreDocumentTypes', {}, { itemIndex });
				return rows(body.result, 'enum');
			},
		},
		{
			value: 'getMode',
			name: 'Get Inventory Mode',
			action: 'Check whether inventory management is on',
			description: 'Tell whether the portal keeps stock through inventory documents',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'catalog.document.mode.status', {}, { itemIndex });
				return { inventoryManagement: body.result === true || body.result === 'Y' };
			},
		},
	],
};

// ── Items of a document ────────────────────────────────────────────────────

const storePicker = (displayName: string, name: string, description: string): INodeProperties => ({
	displayName,
	name,
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getStores' },
	default: '',
	description: `${description} Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>`,
});

function itemFields(chosen: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(chosen)) {
		if (key === 'storeFrom' || key === 'storeTo') {
			const id = Number(value);
			if (Number.isInteger(id) && id > 0) out[key] = id;
		} else if (value !== '' && value !== undefined) out[key] = value;
	}
	return out;
}

const itemFieldOptions: INodeProperties[] = [
	{ displayName: 'Purchasing Price', name: 'purchasingPrice', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0, description: 'Price in the currency of the document' },
	{ displayName: 'Quantity', name: 'amount', type: 'number', typeOptions: { numberPrecision: 2 }, default: 0 },
	storePicker('Source Store Name or ID', 'storeFrom', 'Store the goods leave: for a transfer and a write-off.'),
	storePicker('Target Store Name or ID', 'storeTo', 'Store the goods arrive at: for a receipt and a transfer.'),
];

export const documentItemResource: Resource = {
	value: 'documentItem',
	name: 'Document Item',
	description: 'Products listed in an inventory document, with quantities and stores',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add an item to an inventory document',
			description: 'Add a product to an inventory document',
			properties: [
				documentIdProperty,
				{ displayName: 'Product ID', name: 'productId', type: 'number', required: true, default: 0, description: 'ID of the product or variation' },
				{ displayName: 'Item Fields', name: 'itemFields', type: 'collection', placeholder: 'Add Field', default: {}, options: itemFieldOptions },
			],
			async execute(itemIndex) {
				const fields = {
					...itemFields((this.getNodeParameter('itemFields', itemIndex, {}) ?? {}) as IDataObject),
					docId: positiveInt(this, 'documentId', itemIndex, 'Document ID'),
					elementId: positiveInt(this, 'productId', itemIndex, 'Product ID'),
				};
				const body = await bitrix24Request.call(this, 'catalog.document.element.add', { fields }, { itemIndex });
				return rows(body.result, 'documentElement');
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update an item of an inventory document',
			description: 'Change the quantity, price or stores of a document item',
			properties: [
				{ displayName: 'Item ID', name: 'objectId', type: 'number', required: true, default: 0, description: 'ID of the item within the document, as Get Many returns it' },
				{ displayName: 'Update Fields', name: 'itemFields', type: 'collection', placeholder: 'Add Field', default: {}, options: itemFieldOptions },
			],
			async execute(itemIndex) {
				const id = positiveInt(this, 'objectId', itemIndex, 'Item ID');
				const fields = itemFields((this.getNodeParameter('itemFields', itemIndex, {}) ?? {}) as IDataObject);
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update', { itemIndex });
				const body = await bitrix24Request.call(this, 'catalog.document.element.update', { id, fields }, { itemIndex });
				return rows(body.result, 'documentElement');
			},
		},
		...catalogCrud({
			prefix: 'catalog.document.element',
			key: 'documentElement',
			noun: 'document item',
			plural: 'document items',
			kinds: ['getMany', 'delete', 'getFields'],
			fieldsExample: '{}',
			descriptions: { getMany: 'Read document items, e.g. of one document with the filter {"docId": 12}' },
		}),
	],
};

export const documentSupplierResource: Resource = {
	value: 'documentSupplier',
	name: 'Document Supplier',
	description: 'The CRM contact or company a receipt is bought from',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Link a supplier to a receipt',
			description: 'Name the CRM contact or company a receipt document comes from',
			properties: [
				{ ...documentIdProperty, description: 'ID of a receipt document (type A)' },
				{
					displayName: 'Supplier Type',
					name: 'entityTypeId',
					type: 'options',
					default: 4,
					options: [
						{ name: 'Company', value: 4 },
						{ name: 'Contact', value: 3 },
					],
				},
				{ displayName: 'Supplier ID', name: 'entityId', type: 'number', required: true, default: 0, description: 'ID of the CRM company or contact, from the Supplier category' },
			],
			async execute(itemIndex) {
				const fields = {
					documentId: positiveInt(this, 'documentId', itemIndex, 'Document ID'),
					entityTypeId: Number(this.getNodeParameter('entityTypeId', itemIndex)),
					entityId: positiveInt(this, 'entityId', itemIndex, 'Supplier ID'),
				};
				const body = await bitrix24Request.call(this, 'catalog.documentcontractor.add', { fields }, { itemIndex });
				return rows(body.result, 'documentContractor');
			},
		},
		...catalogCrud({
			prefix: 'catalog.documentcontractor',
			key: 'documentContractor',
			noun: 'supplier link',
			plural: 'supplier links',
			kinds: ['getMany', 'delete', 'getFields'],
			fieldsExample: '{}',
			descriptions: { getMany: 'Read supplier links, e.g. of one document with the filter {"documentId": 12}' },
		}),
	],
};

// ── Custom fields of documents ─────────────────────────────────────────────

const documentTypeProperty: INodeProperties = {
	displayName: 'Document Type Name or ID',
	name: 'docType',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getDocumentTypes' },
	required: true,
	default: '',
	description: 'Custom fields are set up per document type. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

export const documentCustomFieldResource: Resource = {
	value: 'documentCustomField',
	name: 'Document Custom Field Value',
	description: 'Values of the custom fields of inventory documents',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get custom field values of inventory documents',
			description: 'Read the custom field values of documents of one type',
			properties: [
				documentTypeProperty,
				...returnAllProperties('documents'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Filter object, e.g. {"documentId": 12}' },
				{ displayName: 'Fields to Return', name: 'select', type: 'string', default: '', placeholder: 'documentId, field287', description: 'Comma-separated field names. Leave empty for every one.' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter = { ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}), documentType: String(this.getNodeParameter('docType', itemIndex)) };
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				const params: IDataObject = { filter };
				if (select.length > 0) params.select = select;
				return await listAll.call(this, 'catalog.userfield.document.list', params, { itemsKey: 'documents', limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update custom field values of an inventory document',
			description: 'Set custom field values of one inventory document',
			properties: [
				documentIdProperty,
				documentTypeProperty,
				{ displayName: 'Values (JSON)', name: 'valuesJson', type: 'json', required: true, default: '{}', description: 'Custom field values by field, e.g. {"field287": "Contract 15"}' },
			],
			async execute(itemIndex) {
				const documentId = positiveInt(this, 'documentId', itemIndex, 'Document ID');
				const values = jsonParameter<IDataObject>(this, 'valuesJson', itemIndex, {});
				if (Object.keys(values).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update', { itemIndex });
				const fields = { ...values, documentType: String(this.getNodeParameter('docType', itemIndex)) };
				const body = await bitrix24Request.call(this, 'catalog.userfield.document.update', { documentId, fields }, { itemIndex });
				return rows(body.result, 'document');
			},
		},
	],
};
