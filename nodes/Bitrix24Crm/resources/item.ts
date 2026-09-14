import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import {
	compact,
	idParameter,
	jsonParameter,
	orderJsonProperty,
	returnAllProperties,
	selectProperty,
	stringList,
} from '../../../shared/params';
import type { Operation, Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { itemEntityTypeId, MULTIFIELD_TYPES } from '../shared/entityTypes';
import { mapperValues } from '../shared/mapper';

interface ItemResourceConfig {
	value: string;
	name: string;
	/** Singular noun for texts: "deal", "smart process item". */
	noun: string;
	plural: string;
	description: string;
	/** The fixed entity type, or undefined for smart processes (picked per node). */
	entityTypeId?: number;
}

const smartProcessTypeProperty: INodeProperties = {
	displayName: 'Smart Process Name or ID',
	name: 'smartProcessType',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getSmartProcessTypes' },
	required: true,
	default: '',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'Smart process entity type IDs are 1000 and above',
};

function itemIdProperty(noun: string): INodeProperties {
	return {
		displayName: `${noun[0].toUpperCase()}${noun.slice(1)} ID`,
		name: 'itemId',
		type: 'number',
		required: true,
		default: 0,
		description: `ID of the ${noun}`,
	};
}

function fieldsMapperProperty(purpose: 'create' | 'update'): INodeProperties {
	return {
		displayName: 'Fields',
		name: 'fields',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: purpose === 'create',
		typeOptions: {
			loadOptionsDependsOn: ['smartProcessType'],
			resourceMapper: {
				resourceMapperMethod: purpose === 'create' ? 'getFieldsForCreate' : 'getFieldsForUpdate',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: false,
				multiKeyMatch: false,
				supportAutoMap: false,
			},
		},
	};
}

const VALUE_TYPES: Record<string, string[]> = {
	PHONE: ['WORK', 'MOBILE', 'HOME', 'FAX', 'PAGER', 'MAILING', 'OTHER'],
	EMAIL: ['WORK', 'HOME', 'MAILING', 'OTHER'],
	WEB: ['WORK', 'HOME', 'OTHER'],
	IM: ['TELEGRAM', 'WHATSAPP', 'VIBER', 'VK', 'SKYPE', 'IMOL', 'OTHER'],
};

const communicationsProperty: INodeProperties = {
	displayName: 'Phones, Emails and Messengers',
	name: 'communications',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Contact Detail',
	default: {},
	description:
		'Added to the ones the record already has. To change or remove an existing value, send its ID in fm through Fields (JSON).',
	options: [
		{
			displayName: 'Contact Detail',
			name: 'entry',
			values: [
				{
					displayName: 'Kind',
					name: 'typeId',
					type: 'options',
					default: 'PHONE',
					options: [
						{ name: 'Email', value: 'EMAIL' },
						{ name: 'Messenger', value: 'IM' },
						{ name: 'Phone', value: 'PHONE' },
						{ name: 'Website', value: 'WEB' },
					],
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					placeholder: '+49 30 1234567',
				},
				{
					displayName: 'Label',
					name: 'valueType',
					type: 'options',
					default: 'WORK',
					description: 'What the value is — work, mobile, Telegram…. Pick one that fits the kind.',
					options: [
						{ name: 'Fax', value: 'FAX' },
						{ name: 'Home', value: 'HOME' },
						{ name: 'Mailing', value: 'MAILING' },
						{ name: 'Mobile', value: 'MOBILE' },
						{ name: 'Open Channel', value: 'IMOL' },
						{ name: 'Other', value: 'OTHER' },
						{ name: 'Pager', value: 'PAGER' },
						{ name: 'Skype', value: 'SKYPE' },
						{ name: 'Telegram', value: 'TELEGRAM' },
						{ name: 'Viber', value: 'VIBER' },
						{ name: 'VK', value: 'VK' },
						{ name: 'WhatsApp', value: 'WHATSAPP' },
						{ name: 'Work', value: 'WORK' },
					],
				},
			],
		},
	],
};

const fieldsJsonProperty: INodeProperties = {
	displayName: 'Fields (JSON)',
	name: 'fieldsJson',
	type: 'json',
	default: '{}',
	description:
		'More fields as a JSON object in crm.item format (camelCase names, ufCrm… for custom fields). Merged over the fields above, so it wins on conflicts.',
};

function communications(ctx: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const entries = (ctx.getNodeParameter('communications.entry', itemIndex, []) ?? []) as IDataObject[];
	return entries
		.filter((e) => String(e.value ?? '').trim() !== '')
		.map((e) => {
			const typeId = String(e.typeId ?? 'PHONE');
			const allowed = VALUE_TYPES[typeId] ?? [];
			const valueType = allowed.includes(String(e.valueType)) ? String(e.valueType) : allowed[0] ?? 'OTHER';
			return { typeId, valueType, value: String(e.value).trim() };
		});
}

/** Mapper fields, contact details and JSON fields, merged in that order. */
function collectFields(ctx: IExecuteFunctions, entityTypeId: number, itemIndex: number): IDataObject {
	const fields: IDataObject = mapperValues(ctx, 'fields', itemIndex);

	if (MULTIFIELD_TYPES.includes(entityTypeId)) {
		const fm = communications(ctx, itemIndex);
		if (fm.length > 0) fields.fm = fm;
	}

	const extra = jsonParameter<IDataObject>(ctx, 'fieldsJson', itemIndex, {});
	if (Array.isArray(extra.fm) && Array.isArray(fields.fm)) {
		extra.fm = [...(fields.fm as IDataObject[]), ...(extra.fm as IDataObject[])];
	}
	return { ...fields, ...extra };
}

function filtersProperty(config: ItemResourceConfig): INodeProperties {
	return {
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
			},
			{
				displayName: 'Pipeline Name or ID',
				name: 'categoryId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCategories', loadOptionsDependsOn: ['smartProcessType'] },
				default: '',
				description:
					'Only items in this pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Responsible User IDs',
				name: 'assignedById',
				type: 'string',
				default: '',
				placeholder: '1, 25',
				description: `Only ${config.plural} one of these users is responsible for`,
			},
			{
				displayName: 'Stage Names or IDs',
				name: 'stageId',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['smartProcessType'] },
				default: [],
				description:
					'Only items in one of these stages. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Title Contains',
				name: 'titleContains',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Updated After',
				name: 'updatedAfter',
				type: 'dateTime',
				default: '',
			},
			{
				displayName: 'Updated Before',
				name: 'updatedBefore',
				type: 'dateTime',
				default: '',
			},
		],
	};
}

function buildFilter(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const f = (ctx.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
	const filter: IDataObject = compact({
		'>=createdTime': f.createdAfter,
		'<=createdTime': f.createdBefore,
		'>=updatedTime': f.updatedAfter,
		'<=updatedTime': f.updatedBefore,
		'%title': f.titleContains,
		categoryId: f.categoryId === '' ? undefined : f.categoryId,
	});
	const stages = stringList(f.stageId);
	if (stages.length > 0) filter['@stageId'] = stages;
	const users = stringList(f.assignedById).map(Number).filter(Number.isFinite);
	if (users.length > 0) filter['@assignedById'] = users;

	return { ...filter, ...jsonParameter<IDataObject>(ctx, 'filterJson', itemIndex, {}) };
}

function item(result: unknown): IDataObject {
	return (((result ?? {}) as IDataObject).item ?? result ?? {}) as IDataObject;
}

export function itemResource(config: ItemResourceConfig): Resource {
	const { noun, plural } = config;
	const spa = config.entityTypeId === undefined;
	const lead = spa ? [smartProcessTypeProperty] : [];
	const hasContactDetails = config.entityTypeId !== undefined && MULTIFIELD_TYPES.includes(config.entityTypeId);
	const writeExtras = hasContactDetails ? [communicationsProperty, fieldsJsonProperty] : [fieldsJsonProperty];

	const entity = (ctx: IExecuteFunctions, itemIndex: number): number =>
		itemEntityTypeId(ctx, config.value, itemIndex);

	const operations: Operation[] = [
		{
			value: 'create',
			name: 'Create',
			action: `Create a ${noun}`,
			description: `Create a ${noun}. Automation rules and workflows set up for new ${plural} run as usual.`,
			properties: [...lead, fieldsMapperProperty('create'), ...writeExtras],
			async execute(itemIndex) {
				const entityTypeId = entity(this, itemIndex);
				const fields = collectFields(this, entityTypeId, itemIndex);
				const body = await bitrix24Request.call(this, 'crm.item.add', { entityTypeId, fields }, { itemIndex });
				return item(body.result);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: `Get a ${noun}`,
			description: `Retrieve one ${noun} by ID with all its fields`,
			properties: [...lead, itemIdProperty(noun)],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'crm.item.get',
					{ entityTypeId: entity(this, itemIndex), id: idParameter(this, 'itemId', itemIndex) },
					{ itemIndex },
				);
				return item(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: `Get many ${plural}`,
			description: `List ${plural} matching filters, 50 per request, reading by ID for speed unless a sort order is set`,
			properties: [
				...lead,
				...returnAllProperties(plural),
				filtersProperty(config),
				{
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description:
						'Extra crm.item filter, merged over Filters. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, !, @ (in list), !@ or % (contains), e.g. {"&gt;opportunity": 1000, "@sourceId": ["WEB", "CALL"]}.',
				},
				orderJsonProperty('{"createdTime": "DESC"}'),
				selectProperty('title, stageId, opportunity, ufCrm_123'),
			],
			async execute(itemIndex) {
				const entityTypeId = entity(this, itemIndex);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));

				const params: IDataObject = { entityTypeId, filter: buildFilter(this, itemIndex) };
				if (Object.keys(order).length > 0) params.order = order;
				if (select.length > 0) params.select = select.includes('*') || select.includes('id') ? select : ['id', ...select];

				return await listAll.call(this, 'crm.item.list', params, { itemsKey: 'items', idField: 'id', limit, itemIndex });
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: `Update a ${noun}`,
			description: `Change fields of a ${noun}. Only the fields you add are sent; the rest stay as they are.`,
			properties: [...lead, itemIdProperty(noun), fieldsMapperProperty('update'), ...writeExtras],
			async execute(itemIndex) {
				const entityTypeId = entity(this, itemIndex);
				const id = idParameter(this, 'itemId', itemIndex);
				const fields = collectFields(this, entityTypeId, itemIndex);
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to update', {
						itemIndex,
						description: 'Add at least one field, contact detail or Fields (JSON) entry.',
					});
				}
				const body = await bitrix24Request.call(this, 'crm.item.update', { entityTypeId, id, fields }, { itemIndex });
				return item(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: `Delete a ${noun}`,
			description: `Delete a ${noun}. It goes to the CRM recycle bin if the portal keeps one.`,
			properties: [...lead, itemIdProperty(noun)],
			async execute(itemIndex) {
				const id = idParameter(this, 'itemId', itemIndex);
				await bitrix24Request.call(this, 'crm.item.delete', { entityTypeId: entity(this, itemIndex), id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: `Get the fields of ${plural}`,
			description: `Describe every field ${plural} have on this portal — names, types, required flags, list values — including custom fields`,
			properties: [...lead],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.item.fields', { entityTypeId: entity(this, itemIndex) }, { itemIndex });
				const fields = ((body.result as IDataObject)?.fields ?? {}) as IDataObject;
				return Object.entries(fields).map(([name, meta]) => ({ name, ...(meta as IDataObject) }));
			},
		},
		{
			value: 'import',
			name: 'Import',
			action: `Import a ${noun}`,
			description: `Create a ${noun} as a data import: automation rules and workflows do not run. Bitrix24 refuses a createdTime older than records the portal already has.`,
			properties: [...lead, fieldsMapperProperty('create'), ...writeExtras],
			async execute(itemIndex) {
				const entityTypeId = entity(this, itemIndex);
				const fields = collectFields(this, entityTypeId, itemIndex);
				const body = await bitrix24Request.call(this, 'crm.item.import', { entityTypeId, fields }, { itemIndex });
				return item(body.result);
			},
		},
		{
			value: 'merge',
			name: 'Merge',
			action: `Merge duplicate ${plural}`,
			description: `Merge ${plural} into the first one listed; the others are deleted. Answers CONFLICT when values differ and need a person.`,
			properties: [
				...lead,
				{
					displayName: `${noun[0].toUpperCase()}${noun.slice(1)} IDs`,
					name: 'mergeIds',
					type: 'string',
					required: true,
					default: '',
					placeholder: '12, 57, 58',
					description: 'Comma-separated IDs, at least two. The first one is kept and receives the data of the rest.',
				},
			],
			async execute(itemIndex) {
				const entityIds = stringList(this.getNodeParameter('mergeIds', itemIndex)).map(Number);
				if (entityIds.length < 2 || entityIds.some((id) => !Number.isInteger(id) || id <= 0)) {
					throw new NodeOperationError(this.getNode(), 'Give at least two numeric IDs to merge', { itemIndex });
				}
				const body = await bitrix24Request.call(
					this,
					'crm.entity.mergeBatch',
					{ params: { entityTypeId: entity(this, itemIndex), entityIds } },
					{ itemIndex },
				);
				return body.result as IDataObject;
			},
		},
	];

	return { value: config.value, name: config.name, description: config.description, operations };
}
