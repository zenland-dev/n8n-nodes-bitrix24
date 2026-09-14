import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { crudOperations } from '../../../shared/crud';
import { listAll } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeName } from '../shared/entityTypes';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows, stringProperty } from '../shared/props';

const record: INodeProperties[] = [
	entityTypeProperty('Type of the record — deal, invoice or a smart process with payments enabled'),
	numberProperty('Record ID', 'entityId', 'ID of that record'),
];

function recordParams(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	return {
		entityTypeId: positiveInt(ctx, 'entityTypeId', itemIndex, 'Entity type'),
		entityId: positiveInt(ctx, 'entityId', itemIndex, 'Record ID'),
	};
}

/** An operation that sends a few ID parameters and returns what Bitrix24 answers. */
function call(
	value: string,
	name: string,
	action: string,
	description: string,
	method: string,
	properties: INodeProperties[],
	params: (ctx: IExecuteFunctions, itemIndex: number) => IDataObject,
	resultKey?: string,
): Operation {
	return {
		value,
		name,
		action,
		description,
		properties,
		async execute(itemIndex) {
			const body = await bitrix24Request.call(this, method, params(this, itemIndex), { itemIndex });
			const result = body.result;
			if (result === true || result === null) return { success: true };
			if (typeof result === 'number') return { id: result };
			return rows(result, resultKey);
		},
	};
}

const paymentId = numberProperty('Payment ID', 'paymentId', 'ID of the payment');
const idOf = (name: string, label: string) => (ctx: IExecuteFunctions, i: number) => positiveInt(ctx, name, i, label);

export const paymentResource: Resource = {
	value: 'payment',
	name: 'Payment',
	description: 'Payments of deals, invoices and smart process items, with their products and deliveries',
	operations: [
		call('create', 'Create', 'Create a payment', 'Create a payment for a record, covering its products not yet paid for', 'crm.item.payment.add', record, recordParams),
		call('get', 'Get', 'Get a payment', 'Retrieve a payment with its sum, status and payment system', 'crm.item.payment.get', [paymentId], (c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i) })),
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the payments of a record',
			description: 'List the payments of one record',
			properties: [...record, jsonProperty('Filter (JSON)', 'filterJson', 'Extra filter, e.g. {"paid": "N"}')],
			async execute(itemIndex) {
				const params: IDataObject = recordParams(this, itemIndex);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.filter = filter;
				const body = await bitrix24Request.call(this, 'crm.item.payment.list', params, { itemIndex });
				return rows(body.result);
			},
		},
		call(
			'update',
			'Update',
			'Update a payment',
			'Change the payment system or paid flag of a payment — the only two fields Bitrix24 lets change',
			'crm.item.payment.update',
			[paymentId, jsonProperty('Fields (JSON)', 'fieldsJson', 'Fields to change: paySystemId and paid (Y or N), e.g. {"paySystemId": 3}')],
			(c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i), fields: jsonParameter<IDataObject>(c, 'fieldsJson', i, {}) }),
		),
		call('delete', 'Delete', 'Delete a payment', 'Delete a payment of a record', 'crm.item.payment.delete', [paymentId], (c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i) })),
		call('markPaid', 'Mark as Paid', 'Mark a payment as paid', 'Mark a payment as paid, as when money arrived outside Bitrix24', 'crm.item.payment.pay', [paymentId], (c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i) })),
		call('markUnpaid', 'Mark as Unpaid', 'Mark a payment as unpaid', 'Take the paid mark off a payment', 'crm.item.payment.unpay', [paymentId], (c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i) })),
		call('getPublicUrl', 'Get Payment Link', 'Get the payment link', 'Get the page address a client pays the payment on', 'salescenter.payment.getPublicUrl', [paymentId], (c, i) => ({ id: idOf('paymentId', 'Payment ID')(c, i) })),
		call(
			'addProduct',
			'Add Product',
			'Add a product row to a payment',
			'Include one product row of the record in a payment',
			'crm.item.payment.product.add',
			[
				paymentId,
				numberProperty('Product Row ID', 'rowId', 'ID of the product row of the record'),
				{ displayName: 'Quantity', name: 'quantity', type: 'number', required: true, default: 1, description: 'How many units of the row the payment covers' },
			],
			(c, i) => ({
				paymentId: idOf('paymentId', 'Payment ID')(c, i),
				rowId: idOf('rowId', 'Product Row ID')(c, i),
				quantity: Number(c.getNodeParameter('quantity', i)),
			}),
		),
		call(
			'setProductQuantity',
			'Set Product Quantity',
			'Change a product quantity in a payment',
			'Change how many units of a product row a payment covers',
			'crm.item.payment.product.setQuantity',
			[numberProperty('Payment Product ID', 'paymentProductId', 'ID of the product entry in the payment'), { displayName: 'Quantity', name: 'quantity', type: 'number', required: true, default: 1 }],
			(c, i) => ({ id: idOf('paymentProductId', 'Payment Product ID')(c, i), quantity: Number(c.getNodeParameter('quantity', i)) }),
		),
		call(
			'removeProduct',
			'Remove Product',
			'Remove a product from a payment',
			'Take a product entry out of a payment',
			'crm.item.payment.product.delete',
			[numberProperty('Payment Product ID', 'paymentProductId', 'ID of the product entry in the payment')],
			(c, i) => ({ id: idOf('paymentProductId', 'Payment Product ID')(c, i) }),
		),
		{
			value: 'getProducts',
			name: 'Get Products',
			action: 'Get the products of a payment',
			description: 'List the product entries a payment covers',
			properties: [paymentId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.payment.product.list', { paymentId: positiveInt(this, 'paymentId', itemIndex, 'Payment ID'), filter: {} }, { itemIndex });
				return rows(body.result);
			},
		},
		call(
			'addDelivery',
			'Add Delivery',
			'Add a delivery to a payment',
			'Include a delivery of the record in a payment',
			'crm.item.payment.delivery.add',
			[paymentId, numberProperty('Delivery ID', 'deliveryId', 'ID of the delivery')],
			(c, i) => ({ paymentId: idOf('paymentId', 'Payment ID')(c, i), deliveryId: idOf('deliveryId', 'Delivery ID')(c, i) }),
		),
		call(
			'replaceDelivery',
			'Replace Delivery',
			'Swap the delivery in a payment',
			'Point a delivery entry of a payment at another delivery',
			'crm.item.payment.delivery.setDelivery',
			[numberProperty('Payment Delivery ID', 'paymentDeliveryId', 'ID of the delivery entry in the payment'), numberProperty('Delivery ID', 'deliveryId', 'ID of the new delivery')],
			(c, i) => ({ id: idOf('paymentDeliveryId', 'Payment Delivery ID')(c, i), deliveryId: idOf('deliveryId', 'Delivery ID')(c, i) }),
		),
		call(
			'removeDelivery',
			'Remove Delivery',
			'Remove a delivery from a payment',
			'Take a delivery entry out of a payment',
			'crm.item.payment.delivery.delete',
			[numberProperty('Payment Delivery ID', 'paymentDeliveryId', 'ID of the delivery entry in the payment')],
			(c, i) => ({ id: idOf('paymentDeliveryId', 'Payment Delivery ID')(c, i) }),
		),
		{
			value: 'getDeliveries',
			name: 'Get Deliveries',
			action: 'Get the deliveries of a payment',
			description: 'List the delivery entries a payment covers',
			properties: [paymentId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.payment.delivery.list', { paymentId: positiveInt(this, 'paymentId', itemIndex, 'Payment ID'), filter: {} }, { itemIndex });
				return rows(body.result);
			},
		},
	],
};

export const deliveryResource: Resource = {
	value: 'delivery',
	name: 'Delivery',
	description: 'Deliveries (shipments) of deals, invoices and smart process items',
	operations: [
		call('get', 'Get', 'Get a delivery', 'Retrieve a delivery with its price, service and status', 'crm.item.delivery.get', [numberProperty('Delivery ID', 'deliveryId', 'ID of the delivery')], (c, i) => ({ id: idOf('deliveryId', 'Delivery ID')(c, i) })),
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the deliveries of a record',
			description: 'List the deliveries of one record. Shipments added outside CRM, through sale.shipment.add, may not be listed; Get by ID still reads them.',
			properties: [...record, jsonProperty('Filter (JSON)', 'filterJson', 'Extra filter, e.g. {"deducted": "Y"}')],
			async execute(itemIndex) {
				const params: IDataObject = recordParams(this, itemIndex);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.filter = filter;
				const body = await bitrix24Request.call(this, 'crm.item.delivery.list', params, { itemIndex });
				return rows(body.result);
			},
		},
	],
};

export const recurringDealResource: Resource = {
	value: 'recurringDeal',
	name: 'Recurring Deal',
	description: 'Templates that create a deal again on a schedule',
	operations: [
		...crudOperations({
			prefix: 'crm.deal.recurring',
			noun: 'recurring deal template',
			plural: 'recurring deal templates',
			listIdField: 'ID',
			listParams: ['filter', 'order'],
			fieldsExample: '{"DEAL_ID": 15, "CATEGORY_ID": 0, "IS_LIMIT": "N", "START_DATE": "2026-10-01", "PARAMS": {"MODE": "multiple", "MULTIPLE_TYPE": "month", "MULTIPLE_INTERVAL": 1}}',
			descriptions: {
				create: 'Make a deal repeat on a schedule; DEAL_ID is the deal to copy. The template starts active whatever ACTIVE says.',
				delete: 'Delete a recurring template setting. Bitrix24 refuses once a deal has been made from it, even a deleted one — delete the template deal instead, which removes the setting with it.',
			},
		}),
		call(
			'createNow',
			'Create Deal Now',
			'Create a deal from a recurring template now',
			'Create the next deal from a template immediately, outside its schedule',
			'crm.deal.recurring.expose',
			[numberProperty('Template ID', 'objectId', 'ID of the recurring deal template')],
			(c, i) => ({ id: idOf('objectId', 'Template ID')(c, i) }),
		),
	],
};

export const orderLinkResource: Resource = {
	value: 'orderLink',
	name: 'Order Link',
	description: 'Links between online store orders and CRM records',
	operations: [
		call(
			'create',
			'Create',
			'Link an order to a record',
			'Link an online store order to a deal or other record',
			'crm.orderentity.add',
			[numberProperty('Order ID', 'orderId', 'ID of the order'), ...record],
			(c, i) => ({ fields: { orderId: idOf('orderId', 'Order ID')(c, i), ownerTypeId: idOf('entityTypeId', 'Entity type')(c, i), ownerId: idOf('entityId', 'Record ID')(c, i) } }),
			'orderEntity',
		),
		call(
			'delete',
			'Delete',
			'Unlink an order from a record',
			'Remove the link between an order and a record',
			'crm.orderentity.deleteByFilter',
			[numberProperty('Order ID', 'orderId', 'ID of the order'), ...record],
			(c, i) => ({ fields: { orderId: idOf('orderId', 'Order ID')(c, i), ownerTypeId: idOf('entityTypeId', 'Entity type')(c, i), ownerId: idOf('entityId', 'Record ID')(c, i) } }),
		),
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many order links',
			description: 'List order links, e.g. the orders of one deal',
			properties: [...returnAllProperties('links'), jsonProperty('Filter (JSON)', 'filterJson', 'Filter, e.g. {"ownerTypeId": 2, "ownerId": 15}')],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				return await listAll.call(this, 'crm.orderentity.list', Object.keys(filter).length > 0 ? { filter } : {}, { itemsKey: 'orderEntity', limit, itemIndex });
			},
		},
		call('getFields', 'Get Fields', 'Get order link fields', 'Describe the fields of an order link', 'crm.orderentity.getFields', [], () => ({}), 'orderEntity'),
	],
};

const listId = numberProperty('Call List ID', 'callListId', 'ID of the call list');

export const callListResource: Resource = {
	value: 'callList',
	name: 'Call List',
	description: 'Lists of contacts or companies for operators to call through',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a call list',
			description: 'Create a call list from contact or company IDs. Bitrix24 has no method to delete a call list.',
			properties: [
				{ displayName: 'Of', name: 'listEntity', type: 'options', default: 'CONTACT', options: [{ name: 'Companies', value: 'COMPANY' }, { name: 'Contacts', value: 'CONTACT' }] },
				stringProperty('IDs', 'entityIds', 'Comma-separated contact or company IDs', true, '5, 9, 12'),
				{ displayName: 'CRM Form ID', name: 'webformId', type: 'number', default: 0, description: 'Form shown to the operator during the call; 0 for none' },
			],
			async execute(itemIndex) {
				const params = compact({
					ENTITY_TYPE: this.getNodeParameter('listEntity', itemIndex) as string,
					ENTITIES: stringList(this.getNodeParameter('entityIds', itemIndex)).map(Number),
					WEBFORM_ID: Number(this.getNodeParameter('webformId', itemIndex)) || undefined,
				});
				const body = await bitrix24Request.call(this, 'crm.calllist.add', params, { itemIndex });
				return { id: body.result as number };
			},
		},
		call('get', 'Get', 'Get a call list', 'Retrieve a call list', 'crm.calllist.get', [listId], (c, i) => ({ ID: idOf('callListId', 'Call List ID')(c, i) })),
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many call lists',
			description: 'List call lists',
			properties: [...returnAllProperties('call lists'), jsonProperty('Filter (JSON)', 'filterJson', 'Filter, e.g. {"ENTITY_TYPE_ID": 3}')],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				return await listAll.call(this, 'crm.calllist.list', Object.keys(filter).length > 0 ? { FILTER: filter } : {}, { limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Replace the entries of a call list',
			description: 'Replace the contacts or companies of a call list',
			properties: [
				listId,
				{ displayName: 'Of', name: 'listEntity', type: 'options', default: 'CONTACT', options: [{ name: 'Companies', value: 'COMPANY' }, { name: 'Contacts', value: 'CONTACT' }] },
				stringProperty('IDs', 'entityIds', 'Comma-separated contact or company IDs', true, '5, 9, 12'),
				{ displayName: 'CRM Form ID', name: 'webformId', type: 'number', default: 0 },
			],
			async execute(itemIndex) {
				const params = compact({
					LIST_ID: positiveInt(this, 'callListId', itemIndex, 'Call List ID'),
					ENTITY_TYPE: this.getNodeParameter('listEntity', itemIndex) as string,
					ENTITIES: stringList(this.getNodeParameter('entityIds', itemIndex)).map(Number),
					WEBFORM_ID: Number(this.getNodeParameter('webformId', itemIndex)) || undefined,
				});
				await bitrix24Request.call(this, 'crm.calllist.update', params, { itemIndex });
				return { id: params.LIST_ID, updated: true };
			},
		},
		{
			value: 'getEntries',
			name: 'Get Entries',
			action: 'Get the entries of a call list',
			description: 'List the contacts or companies of a call list with their call status',
			properties: [listId, stringProperty('Status', 'callStatus', 'Only entries in this call status, e.g. IN_WORK, SUCCESS; empty for all')],
			async execute(itemIndex) {
				const status = String(this.getNodeParameter('callStatus', itemIndex, '')).trim();
				const params: IDataObject = { LIST_ID: positiveInt(this, 'callListId', itemIndex, 'Call List ID') };
				if (status !== '') params.FILTER = { STATUS: status };
				const body = await bitrix24Request.call(this, 'crm.calllist.items.get', params, { itemIndex });
				return rows(body.result);
			},
		},
		call('getStatuses', 'Get Statuses', 'Get call list statuses', 'List the statuses an entry of a call list can have', 'crm.calllist.statuslist', [], () => ({})),
	],
};

export const stageHistoryResource: Resource = {
	value: 'stageHistory',
	name: 'Stage History',
	description: 'When records moved between stages — the data behind funnel reports',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get stage changes',
			description: 'List stage changes of leads, deals, invoices or smart process items, e.g. everything moved to won this month',
			properties: [
				entityTypeProperty('Type of records whose stage changes to read'),
				...returnAllProperties('changes'),
				jsonProperty('Filter (JSON)', 'filterJson', 'Filter, e.g. {"OWNER_ID": 15} or {"&gt;=CREATED_TIME": "2026-09-01T00:00:00", "STAGE_SEMANTIC_ID": "S"}'),
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const params: IDataObject = { entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type') };
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) params.filter = filter;
				return await listAll.call(this, 'crm.stagehistory.list', params, { itemsKey: 'items', idField: 'ID', limit, itemIndex });
			},
		},
	],
};

export const automationResource: Resource = {
	value: 'automation',
	name: 'Automation Trigger',
	description: 'Firing the "Incoming webhook" automation trigger of a record',
	operations: [
		{
			value: 'fire',
			name: 'Fire',
			action: 'Fire the webhook trigger of a record',
			description: 'Fire the automation trigger "Webhook received" for a lead, deal, invoice or smart process item, so its automation rules move on',
			properties: [entityTypeProperty('Type of the record'), numberProperty('Record ID', 'entityId', 'ID of the record')],
			async execute(itemIndex) {
				const target = `${entityTypeName(positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'))}_${positiveInt(this, 'entityId', itemIndex, 'Record ID')}`;
				await bitrix24Request.call(this, 'crm.automation.trigger', { target }, { itemIndex });
				return { fired: true, target };
			},
		},
	],
};

export const trackingResource: Resource = {
	value: 'tracking',
	name: 'Sales Intelligence Trace',
	description: 'Visit traces that tie records to their advertising source',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Add a sales intelligence trace',
			description: 'Record the source of a visit (UTM tags, pages, device) and link it to CRM records',
			properties: [
				jsonProperty('Trace (JSON)', 'trace', 'Trace data, e.g. {"url": "https://site/?utm_source=google", "ref": "", "device": {"isMobile": false}, "tags": {"ts": 1789380000, "list": {"utm_source": "google"}}, "pages": {"list": []}}'),
				jsonProperty('Records (JSON)', 'entities', 'Records to link by type name, e.g. [{"TYPE": "DEAL", "ID": 15}] — LEAD, DEAL, CONTACT, COMPANY or QUOTE; leave [] for none', '[]'),
			],
			async execute(itemIndex) {
				const trace = jsonParameter<IDataObject>(this, 'trace', itemIndex, {});
				const params: IDataObject = { TRACE: JSON.stringify(trace) };
				const entities = jsonParameter<IDataObject[]>(this, 'entities', itemIndex, []);
				if (Array.isArray(entities) && entities.length > 0) params.ENTITIES = entities;
				const body = await bitrix24Request.call(this, 'crm.tracking.trace.add', params, { itemIndex });
				return { id: body.result as number };
			},
		},
		call('delete', 'Delete', 'Delete a sales intelligence trace', 'Delete a trace', 'crm.tracking.trace.delete', [numberProperty('Trace ID', 'traceId', 'ID of the trace')], (c, i) => ({ id: idOf('traceId', 'Trace ID')(c, i) })),
	],
};
