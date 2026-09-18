import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { compact, jsonParameter, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { iblockTypeCustomProperty, iblockTypeProperty, listTarget, listTargetProperties } from '../shared/helpers';

/** FIELDS of lists.add and lists.update, the handful Bitrix24 documents. */
const listFieldsProperty = {
	displayName: 'Fields',
	name: 'fields',
	type: 'collection' as const,
	placeholder: 'Add Field',
	default: {},
	options: [
		{
			displayName: 'Business Processes',
			name: 'BIZPROC',
			type: 'boolean' as const,
			default: false,
			description: 'Whether business processes can run on the elements of this list',
		},
		{
			displayName: 'Description',
			name: 'DESCRIPTION',
			type: 'string' as const,
			typeOptions: { rows: 2 },
			default: '',
			description: 'Description shown under the name of the list',
		},
		{
			displayName: 'Sort Order',
			name: 'SORT',
			type: 'number' as const,
			default: 500,
			description: 'Where the list stands among the others; smaller comes first',
		},
	],
};

const messagesProperty = {
	displayName: 'Labels (JSON)',
	name: 'messagesJson',
	type: 'json' as const,
	default: '{}',
	description:
		'What an element and a section are called in the interface of this list, e.g. {"ELEMENT_NAME": "Request", "SECTION_NAME": "Folder"}',
};

const rightsProperty = {
	displayName: 'Access Rights (JSON)',
	name: 'rightsJson',
	type: 'json' as const,
	default: '{}',
	description:
		'Who may do what with the list, by access code, e.g. {"U1": "X", "G2": "R"}. Left empty, Bitrix24 applies the defaults of the type.',
};

function fieldsFrom(chosen: IDataObject): IDataObject {
	const fields = compact({
		DESCRIPTION: chosen.DESCRIPTION,
		SORT: chosen.SORT,
	});
	if (chosen.BIZPROC !== undefined) fields.BIZPROC = chosen.BIZPROC === true ? 'Y' : 'N';
	return fields;
}

export const listResource: Resource = {
	value: 'list',
	name: 'List',
	description: 'The universal lists themselves: what exists, and creating, renaming or deleting one',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many lists',
			description: 'List the universal lists of a type, or read one of them by ID or code',
			properties: [
				...returnAllProperties('lists'),
				iblockTypeProperty,
				iblockTypeCustomProperty,
				{
					displayName: 'List ID',
					name: 'iblockId',
					type: 'number',
					default: 0,
					description: 'Only this list. Leave at 0 for every list of the type.',
				},
				{
					displayName: 'List Code',
					name: 'iblockCode',
					type: 'string',
					default: '',
					description: 'Only the list with this code, instead of its ID',
				},
				{
					displayName: 'Workgroup ID',
					name: 'socnetGroupId',
					type: 'number',
					default: 0,
					displayOptions: { show: { iblockType: ['lists_socnet'] } },
					description: 'Only the lists of this workgroup. Group lists live inside one group each.',
				},
				{
					displayName: 'Order (JSON)',
					name: 'orderJson',
					type: 'json',
					default: '{}',
					description: 'Sort object of list fields, e.g. {"SORT": "asc", "NAME": "asc"}',
				},
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex, false);
				const groupId = Number(this.getNodeParameter('socnetGroupId', itemIndex, 0));
				if (Number.isInteger(groupId) && groupId > 0) params.SOCNET_GROUP_ID = groupId;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				if (Object.keys(order).length > 0) params.IBLOCK_ORDER = order;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				return await listAll.call(this, 'lists.get', params, { limit, itemIndex });
			},
		},
		{
			value: 'create',
			name: 'Create',
			action: 'Create a list',
			description: 'Create a universal list; its fields are added afterwards with Field → Create',
			properties: [
				iblockTypeProperty,
				iblockTypeCustomProperty,
				{
					displayName: 'List Code',
					name: 'iblockCode',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'vacation_requests',
					description: 'Symbolic code of the new list, unique within its type',
				},
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Name of the list, as people see it',
				},
				{
					displayName: 'Workgroup ID',
					name: 'socnetGroupId',
					type: 'number',
					default: 0,
					displayOptions: { show: { iblockType: ['lists_socnet'] } },
					description: 'Workgroup the list belongs to. A group list without it has nowhere to live.',
				},
				listFieldsProperty,
				messagesProperty,
				rightsProperty,
			],
			async execute(itemIndex) {
				const custom = String(this.getNodeParameter('iblockTypeCustom', itemIndex, '')).trim();
				const code = String(this.getNodeParameter('iblockCode', itemIndex, '')).trim();
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();
				if (code === '' || name === '') {
					throw new NodeOperationError(this.getNode(), 'List Code and Name are both required', { itemIndex });
				}

				const chosen = (this.getNodeParameter('fields', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = {
					IBLOCK_TYPE_ID: custom !== '' ? custom : String(this.getNodeParameter('iblockType', itemIndex, 'lists')),
					IBLOCK_CODE: code,
					FIELDS: { NAME: name, ...fieldsFrom(chosen) },
				};

				const groupId = Number(this.getNodeParameter('socnetGroupId', itemIndex, 0));
				if (Number.isInteger(groupId) && groupId > 0) params.SOCNET_GROUP_ID = groupId;
				const messages = jsonParameter<IDataObject>(this, 'messagesJson', itemIndex, {});
				if (Object.keys(messages).length > 0) params.MESSAGES = messages;
				const rights = jsonParameter<IDataObject>(this, 'rightsJson', itemIndex, {});
				if (Object.keys(rights).length > 0) params.RIGHTS = rights;

				const body = await bitrix24Request.call(this, 'lists.add', params, { itemIndex });
				return { listId: Number(body.result) || null, code, name };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a list',
			description: 'Change the name, description or settings of a list; what you leave out stays as it is',
			properties: [
				...listTargetProperties(),
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					default: '',
					description: 'New name of the list. Leave empty to keep the current one.',
				},
				listFieldsProperty,
				messagesProperty,
				rightsProperty,
			],
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const chosen = (this.getNodeParameter('fields', itemIndex, {}) ?? {}) as IDataObject;
				const name = String(this.getNodeParameter('name', itemIndex, '')).trim();

				const fields = fieldsFrom(chosen);
				if (name !== '') fields.NAME = name;
				if (Object.keys(fields).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Nothing to update: set a name or at least one field', {
						itemIndex,
					});
				}
				params.FIELDS = fields;

				const messages = jsonParameter<IDataObject>(this, 'messagesJson', itemIndex, {});
				if (Object.keys(messages).length > 0) params.MESSAGES = messages;
				const rights = jsonParameter<IDataObject>(this, 'rightsJson', itemIndex, {});
				if (Object.keys(rights).length > 0) params.RIGHTS = rights;

				const body = await bitrix24Request.call(this, 'lists.update', params, { itemIndex });
				return { listId: params.IBLOCK_ID ?? null, code: params.IBLOCK_CODE ?? null, updated: body.result === true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a list',
			description: 'Delete a list with every element, section and field in it. Bitrix24 has no undo for this.',
			properties: listTargetProperties(),
			async execute(itemIndex) {
				const params = listTarget(this, itemIndex);
				const body = await bitrix24Request.call(this, 'lists.delete', params, { itemIndex });
				return { listId: params.IBLOCK_ID ?? null, code: params.IBLOCK_CODE ?? null, deleted: body.result === true };
			},
		},
		{
			value: 'getType',
			name: 'Get Type',
			action: 'Get the type of a list',
			description: 'Find which information block type a list belongs to, when only its ID or code is known',
			properties: [
				{
					displayName: 'List ID',
					name: 'iblockId',
					type: 'number',
					default: 0,
					description: 'ID of the list. Give this or List Code.',
				},
				{
					displayName: 'List Code',
					name: 'iblockCode',
					type: 'string',
					default: '',
					description: 'Symbolic code of the list, instead of its ID',
				},
			],
			async execute(itemIndex) {
				const id = Number(this.getNodeParameter('iblockId', itemIndex, 0));
				const code = String(this.getNodeParameter('iblockCode', itemIndex, '')).trim();
				const params: IDataObject = {};
				if (Number.isInteger(id) && id > 0) params.IBLOCK_ID = id;
				if (code !== '') params.IBLOCK_CODE = code;
				if (Object.keys(params).length === 0) {
					throw new NodeOperationError(this.getNode(), 'Name the list by List ID or List Code', { itemIndex });
				}

				const body = await bitrix24Request.call(this, 'lists.get.iblock.type.id', params, { itemIndex });
				return { iblockTypeId: body.result ?? null, listId: params.IBLOCK_ID ?? null, code: params.IBLOCK_CODE ?? null };
			},
		},
	],
};
