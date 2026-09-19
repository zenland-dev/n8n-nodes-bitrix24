import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asNodeError } from '../../../shared/errors';
import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import { positiveInt, rows } from '../../../shared/props';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24FileRequest, bitrix24Request } from '../../../shared/transport';
import type { CatalogKind, ItemKind } from '../shared/helpers';
import { catalogId, catalogProperty, itemFields, itemFieldsProperty, propertyFields } from '../shared/helpers';

/**
 * Products, variations, products with variations and services are four method families with one
 * shape (catalog.product[.offer|.sku|.service].*), different result keys and different fields.
 */
interface KindConfig {
	kind: ItemKind;
	value: string;
	name: string;
	description: string;
	noun: string;
	plural: string;
	prefix: string;
	/** Result key of add and update. */
	writeKey: string;
	/** Result key of get and of getFieldsByFilter. */
	readKey: string;
	listKey: string;
	catalog: CatalogKind;
}

const KINDS: KindConfig[] = [
	{
		kind: 'product',
		value: 'product',
		name: 'Product',
		description: 'Products of the catalog. Get Many returns every kind — simple products, products with variations and services.',
		noun: 'product',
		plural: 'products',
		prefix: 'catalog.product',
		writeKey: 'element',
		readKey: 'product',
		listKey: 'products',
		catalog: 'product',
	},
	{
		kind: 'variation',
		value: 'variation',
		name: 'Variation',
		description: 'Variations of a product — sizes, colors — each with its own prices and stock',
		noun: 'variation',
		plural: 'variations',
		prefix: 'catalog.product.offer',
		writeKey: 'offer',
		readKey: 'offer',
		listKey: 'offers',
		catalog: 'variation',
	},
	{
		kind: 'parentProduct',
		value: 'parentProduct',
		name: 'Product With Variations',
		description: 'The card variations belong to. It has no price or stock of its own.',
		noun: 'product with variations',
		plural: 'products with variations',
		prefix: 'catalog.product.sku',
		writeKey: 'sku',
		readKey: 'sku',
		listKey: 'units',
		catalog: 'product',
	},
	{
		kind: 'service',
		value: 'service',
		name: 'Service',
		description: 'Services of the catalog: sold like products, without stock or measurements',
		noun: 'service',
		plural: 'services',
		prefix: 'catalog.product.service',
		writeKey: 'service',
		readKey: 'service',
		listKey: 'services',
		catalog: 'product',
	},
];

const propertyValuesProperty: INodeProperties = {
	displayName: 'Property Values (JSON)',
	name: 'propertyValues',
	type: 'json',
	default: '{}',
	description:
		'Values of catalog properties, keyed by property ID or code, e.g. {"258": "Oak", "COLOR": ["Red", "Blue"]}. A multiple property takes an array, a list property the ID of its value — except a list with a single value, which Bitrix24 treats as a checkbox: "Y" or "N". An empty string clears a value, an empty array a multiple one. Property → Get Many lists IDs and codes.',
};

const moreFieldsProperty: INodeProperties = {
	displayName: 'More Fields (JSON)',
	name: 'moreFields',
	type: 'json',
	default: '{}',
	description: 'Any other field by its API name, e.g. {"dateActiveFrom": "2026-10-01T00:00:00", "quantityTrace": "Y"}. Get Fields lists every one.',
};

function idProperty(config: KindConfig): INodeProperties {
	return {
		displayName: `${config.name} ID`,
		name: 'itemId',
		type: 'number',
		required: true,
		default: 0,
		description: `ID of the ${config.noun}`,
	};
}

async function fieldsFrom(ctx: IExecuteFunctions, itemIndex: number, config: KindConfig, collection: string): Promise<IDataObject> {
	const iblockId = await catalogId(ctx, itemIndex, config.catalog);
	const typed = itemFields((ctx.getNodeParameter(collection, itemIndex, {}) ?? {}) as IDataObject);
	const more = jsonParameter<IDataObject>(ctx, 'moreFields', itemIndex, {});
	const properties = await propertyFields(ctx, itemIndex, iblockId, jsonParameter<IDataObject>(ctx, 'propertyValues', itemIndex, {}));
	return { ...more, ...typed, ...properties };
}

/** Every field of the catalog, for a Get Many that names none: the list method has no "all". */
async function allFields(ctx: IExecuteFunctions, config: KindConfig, iblockId: number, itemIndex: number): Promise<string[]> {
	const body = await bitrix24Request.call(ctx, `${config.prefix}.getFieldsByFilter`, { filter: { iblockId } }, { itemIndex });
	const fields = ((body.result as IDataObject)?.[config.readKey] ?? {}) as IDataObject;
	return Object.keys(fields);
}

function kindOperations(config: KindConfig): Operation[] {
	const id = idProperty(config);
	const catalog = catalogProperty(config.catalog);
	const variation = config.kind === 'variation';

	const create: Operation = {
		value: 'create',
		name: 'Create',
		action: `Create a ${config.noun}`,
		description: `Add a ${config.noun} to the catalog`,
		properties: [
			catalog,
			{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '', description: `Name of the ${config.noun}` },
			...(variation
				? [{ displayName: 'Parent Product ID', name: 'parentId', type: 'number', required: true, default: 0, description: 'The product with variations this variation belongs to' } as INodeProperties]
				: []),
			itemFieldsProperty(config.kind, 'additionalFields', 'Additional Fields'),
			propertyValuesProperty,
			moreFieldsProperty,
		],
		async execute(itemIndex) {
			const iblockId = await catalogId(this, itemIndex, config.catalog);
			const fields: IDataObject = { ...(await fieldsFrom(this, itemIndex, config, 'additionalFields')), iblockId, name: this.getNodeParameter('name', itemIndex) };
			if (variation) fields.parentId = positiveInt(this, 'parentId', itemIndex, 'Parent Product ID');
			const body = await bitrix24Request.call(this, `${config.prefix}.add`, { fields }, { itemIndex });
			return rows(body.result, config.writeKey);
		},
	};

	const get: Operation = {
		value: 'get',
		name: 'Get',
		action: `Get a ${config.noun}`,
		description: `Read one ${config.noun} with every field and property value`,
		properties: [id],
		async execute(itemIndex) {
			const body = await bitrix24Request.call(this, `${config.prefix}.get`, { id: positiveInt(this, 'itemId', itemIndex, `${config.name} ID`) }, { itemIndex });
			return rows(body.result, config.readKey);
		},
	};

	const getMany: Operation = {
		value: 'getMany',
		name: 'Get Many',
		action: `Get many ${config.plural}`,
		description: `Read ${config.plural} of a catalog, all of them or the ones a filter names`,
		properties: [
			catalog,
			...returnAllProperties(config.plural),
			...(variation
				? [{ displayName: 'Parent Product ID', name: 'parentId', type: 'number', default: 0, description: 'Only the variations of this product. 0 reads every variation of the catalog.' } as INodeProperties]
				: []),
			{
				displayName: 'Filter (JSON)',
				name: 'filterJson',
				type: 'json',
				default: '{}',
				description:
					'Filter by field names as Get Fields spells them. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, ! or % (contains), e.g. {"%name": "chair", "active": "Y", "iblockSectionId": 12}.' +
					(config.kind === 'product' ? ' Type is 1 for a simple product, 3 for a product with variations, 7 for a service.' : ''),
			},
			{ displayName: 'Order (JSON)', name: 'orderJson', type: 'json', default: '{}', description: 'Sort object, e.g. {"name": "ASC"}. Leave empty for the fastest paging by ID.' },
			{
				displayName: 'Fields to Return',
				name: 'select',
				type: 'string',
				default: '',
				placeholder: 'name, xmlId, property258',
				description: 'Comma-separated field names. Leave empty for every field and property. ID and catalog are always returned.',
			},
		],
		async execute(itemIndex) {
			const iblockId = await catalogId(this, itemIndex, config.catalog);
			const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
			const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
			const filter: IDataObject = { ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}), iblockId };
			if (variation) {
				const parentId = Number(this.getNodeParameter('parentId', itemIndex, 0)) || 0;
				if (parentId > 0) filter.parentId = parentId;
			}
			const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
			let select = stringList(this.getNodeParameter('select', itemIndex, ''));
			if (select.length === 0) select = await allFields(this, config, iblockId, itemIndex);
			// The list method refuses a select without these two.
			select = [...new Set(['id', 'iblockId', ...select])];
			const params: IDataObject = { select, filter };
			if (Object.keys(order).length > 0) params.order = order;
			return await listAll.call(this, `${config.prefix}.list`, params, { itemsKey: config.listKey, idField: 'id', limit, itemIndex });
		},
	};

	const update: Operation = {
		value: 'update',
		name: 'Update',
		action: `Update a ${config.noun}`,
		description: `Change fields and property values of a ${config.noun}; what is not given stays as it is`,
		properties: [
			id,
			{ ...catalog, description: `${String(catalog.description)} Only needed to find properties by code.` },
			itemFieldsProperty(config.kind, 'updateFields', 'Update Fields', true),
			propertyValuesProperty,
			moreFieldsProperty,
		],
		async execute(itemIndex) {
			const itemId = positiveInt(this, 'itemId', itemIndex, `${config.name} ID`);
			const fields = await fieldsFrom(this, itemIndex, config, 'updateFields');
			if (Object.keys(fields).length === 0) {
				throw new NodeOperationError(this.getNode(), 'Nothing to update', { itemIndex, description: 'Add a field or a property value.' });
			}
			const body = await bitrix24Request.call(this, `${config.prefix}.update`, { id: itemId, fields }, { itemIndex });
			return rows(body.result, config.writeKey);
		},
	};

	const remove: Operation = {
		value: 'delete',
		name: 'Delete',
		action: `Delete a ${config.noun}`,
		description:
			config.kind === 'parentProduct'
				? 'Delete a product with variations together with its variations'
				: `Delete a ${config.noun} with its prices and images`,
		properties: [id],
		async execute(itemIndex) {
			const itemId = positiveInt(this, 'itemId', itemIndex, `${config.name} ID`);
			await bitrix24Request.call(this, `${config.prefix}.delete`, { id: itemId }, { itemIndex });
			return { id: itemId, deleted: true };
		},
	};

	const getFields: Operation = {
		value: 'getFields',
		name: 'Get Fields',
		action: `Get ${config.noun} fields`,
		description: `Describe every field and property a ${config.noun} of the catalog has`,
		properties: [catalog],
		async execute(itemIndex) {
			const iblockId = await catalogId(this, itemIndex, config.catalog);
			const body = await bitrix24Request.call(this, `${config.prefix}.getFieldsByFilter`, { filter: { iblockId } }, { itemIndex });
			const fields = ((body.result as IDataObject)?.[config.readKey] ?? {}) as IDataObject;
			// Each description carries its own "name" (the title), so the API name goes under "field".
			return Object.entries(fields).map(([field, meta]) => ({ field, ...(meta !== null && typeof meta === 'object' ? (meta as IDataObject) : { value: meta as string }) }));
		},
	};

	const download: Operation = {
		value: 'downloadFile',
		name: 'Download File',
		action: `Download a file of a ${config.noun}`,
		description: `Fetch a picture or a file property of a ${config.noun} into binary data`,
		properties: [
			id,
			{
				displayName: 'Field',
				name: 'fileField',
				type: 'options',
				default: 'detailPicture',
				options: [
					{ name: 'Detail Picture', value: 'detailPicture' },
					{ name: 'File Property', value: 'property' },
					{ name: 'Preview Picture', value: 'previewPicture' },
				],
				description: 'Where the file is kept. Images added through Product Image sit in a file property (usually MORE_PHOTO).',
			},
			{
				displayName: 'Property ID or Code',
				name: 'fileProperty',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { fileField: ['property'] } },
				description: 'The file property, e.g. 258 or MORE_PHOTO',
			},
			{
				displayName: 'File ID',
				name: 'fileId',
				type: 'number',
				required: true,
				default: 0,
				description: 'ID of the file, as Get returns it inside the picture field or as the value of a file property',
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryProperty',
				type: 'string',
				required: true,
				default: 'data',
				hint: 'The name of the output binary field to put the file in',
			},
		],
		async executeAll(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
			const out: INodeExecutionData[] = [];
			const items = this.getInputData();
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const productId = positiveInt(this, 'itemId', itemIndex, `${config.name} ID`);
					const fileId = positiveInt(this, 'fileId', itemIndex, 'File ID');
					const which = String(this.getNodeParameter('fileField', itemIndex));
					let fieldName = which;
					if (which === 'property') {
						const key = String(this.getNodeParameter('fileProperty', itemIndex, '')).trim();
						const iblockId = await catalogId(this, itemIndex, config.catalog);
						fieldName = Object.keys(await propertyFields(this, itemIndex, iblockId, { [key]: true }))[0];
					}
					// The API names the field as its links do: detailPicture, property258. The documented
					// DETAIL_PICTURE answers "Name file field is not available" (live portal, 19.09.2026).
					const file = await bitrix24FileRequest.call(this, `${config.prefix}.download`, { fields: { fileId, productId, fieldName } }, { itemIndex });
					const fileName = fileNameFrom(file.headers['content-disposition']) ?? `file-${fileId}`;
					const mimeType = String(file.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
					const binaryProperty = String(this.getNodeParameter('binaryProperty', itemIndex));
					out.push({
						json: { productId, fileId, fieldName, fileName, mimeType, size: file.buffer.length },
						binary: { [binaryProperty]: await this.helpers.prepareBinaryData(file.buffer, fileName, mimeType) },
						pairedItem: { item: itemIndex },
					});
				} catch (error) {
					if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
					out.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
				}
			}
			return out;
		},
	};

	return [create, get, getMany, update, remove, getFields, download];
}

/** The file name from a Content-Disposition header, RFC 5987 form first. */
function fileNameFrom(disposition: unknown): string | undefined {
	const text = String(disposition ?? '');
	const extended = text.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
	if (extended) {
		try {
			return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
		} catch {
			return undefined;
		}
	}
	const plain = text.match(/filename="?([^";]+)"?/i);
	return plain ? plain[1] : undefined;
}

export const itemResources: Resource[] = KINDS.map((config) => ({
	value: config.value,
	name: config.name,
	description: config.description,
	operations: kindOperations(config),
}));
